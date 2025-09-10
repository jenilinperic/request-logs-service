import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const exec = promisify(_exec);

/*
 Database Backup Module
 - Supports Postgres (pg_dump) and MongoDB (mongodump) by dumping the entire database.
 - Compresses output (.tar.gz) for mongo or .sql.gz for postgres.
 - Uploads to S3 compatible storage (AWS S3 or DigitalOcean Spaces) if env configured.
 - Retains only the most recent N backups (default 7) remotely & locally.

 ENV Variables (add to .env):
 BACKUP_ENABLED=true            # master switch
 BACKUP_CRON=0 2 * * *          # default daily at 02:00 UTC
 BACKUP_RETENTION_DAYS=7        # number of daily files to keep

 # S3 / Spaces
 BACKUP_S3_ENDPOINT=            # optional, e.g. https://nyc3.digitaloceanspaces.com
 BACKUP_S3_REGION=us-east-1
 BACKUP_S3_BUCKET=              # required to upload
 BACKUP_S3_ACCESS_KEY=          # required to upload
 BACKUP_S3_SECRET_KEY=          # required to upload
 BACKUP_S3_PREFIX=request-logs-service/backups  # optional key prefix
*/

const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/db_backups';

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

function buildS3Client() {
  const { BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY, BACKUP_S3_REGION, BACKUP_S3_ENDPOINT } = process.env;
  if (!BACKUP_S3_ACCESS_KEY || !BACKUP_S3_SECRET_KEY) return null;
  return new S3Client({
    region: BACKUP_S3_REGION || 'us-east-1',
    endpoint: BACKUP_S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.BACKUP_S3_ENDPOINT, // spaces compatibility
    credentials: {
      accessKeyId: BACKUP_S3_ACCESS_KEY,
      secretAccessKey: BACKUP_S3_SECRET_KEY
    }
  });
}

async function backupPostgres() {
  const fileBase = `pg-${process.env.PG_DATABASE || 'request_logs'}-${timestamp()}`;
  const outFile = path.join(BACKUP_DIR, `${fileBase}.sql.gz`);
  // Build pg_dump command
  const args = [
    `PGPASSWORD='${process.env.PG_PASSWORD || ''}' pg_dump`,
    '-h', process.env.PG_HOST || 'localhost',
    '-p', process.env.PG_PORT || '5432',
    '-U', process.env.PG_USER || 'postgres',
    '--format=plain', '--no-owner', '--clean',
    process.env.PG_DATABASE || 'request_logs',
    '| gzip >', outFile
  ];
  const cmd = args.join(' ');
  await exec(cmd);
  return outFile;
}

async function backupMongo() {
  const db = process.env.MONGO_DB || 'request_logs';
  const fileBase = `mongo-${db}-${timestamp()}`;
  const tmpDir = path.join(BACKUP_DIR, `tmp-${fileBase}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const archive = path.join(BACKUP_DIR, `${fileBase}.tar.gz`);
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const cmd = `mongodump --uri='${uri}/${db}' --archive='${archive}' --gzip`;
  await exec(cmd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return archive;
}

async function uploadAndRetain(localPath) {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return; // no upload configured
  const client = buildS3Client();
  if (!client) return;
  const prefix = (process.env.BACKUP_S3_PREFIX || 'request-logs-service/backups').replace(/\/$/, '');
  const key = `${prefix}/${path.basename(localPath)}`;
  const body = fs.readFileSync(localPath);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  // Retention: list existing & delete older than retention count
  const retention = +(process.env.BACKUP_RETENTION_DAYS || 7);
  try {
    const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix + '/' }));
    const files = (list.Contents || []).filter(o => /pg-|mongo-/.test(o.Key || ''))
      .sort((a,b) => new Date(b.LastModified) - new Date(a.LastModified));
    const excess = files.slice(retention);
    for (const f of excess) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: f.Key }));
    }
  } catch (e) { /* ignore retention errors */ }
}

function pruneLocal() {
  const retention = +(process.env.BACKUP_RETENTION_DAYS || 7);
  const entries = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.match(/\.(sql|tar)\.gz$/))
    .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a,b) => b.t - a.t);
  const excess = entries.slice(retention);
  for (const e of excess) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, e.f)); } catch (_) {}
  }
}

export async function runBackup(logger = console) {
  if (!process.env.BACKUP_ENABLED || !/^true$/i.test(process.env.BACKUP_ENABLED)) {
    logger.info?.('Backup skipped (disabled)');
    return;
  }
  ensureDir();
  try {
    const driver = (process.env.DB_DRIVER || 'postgres').toLowerCase();
    logger.info?.(`Starting backup for driver=${driver}`);
    const localPath = driver.startsWith('mongo') ? await backupMongo() : await backupPostgres();
    logger.info?.(`Backup created at ${localPath}`);
    await uploadAndRetain(localPath);
    pruneLocal();
    logger.info?.('Backup complete');
  } catch (err) {
    logger.error?.({ err }, 'Backup failed');
  }
}

export function scheduleBackups(logger = console) {
  if (!process.env.BACKUP_ENABLED || !/^true$/i.test(process.env.BACKUP_ENABLED)) return;
  const cronExpr = process.env.BACKUP_CRON || '0 2 * * *'; // 02:00 UTC daily
  const cron = require('node-cron');
  if (!cron.validate(cronExpr)) {
    logger.error?.('Invalid BACKUP_CRON expression, skipping schedule');
    return;
  }
  logger.info?.(`Scheduling database backups with cron: ${cronExpr}`);
  cron.schedule(cronExpr, () => runBackup(logger));
}
