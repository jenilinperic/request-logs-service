import { MongoClient } from 'mongodb';
import pkg from 'pg';
const { Pool } = pkg;

let driver = process.env.DB_DRIVER || 'postgres';
let mongoClient; let mongoDb; let pgPool; let ready = false;

export async function initDb() {
  if (ready) return; // idempotent
  driver = (process.env.DB_DRIVER || 'postgres').toLowerCase();
  if (driver === 'mongo' || driver === 'mongodb') {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
    mongoClient = new MongoClient(uri, { maxPoolSize: 10 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGO_DB || 'request_logs');
    await mongoDb.collection('api_logs').createIndex({ ts: -1 });
  } else { // postgres default
    pgPool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: +(process.env.PG_PORT || 5432),
      database: process.env.PG_DATABASE || 'request_logs',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      ssl: (/^true$/i).test(process.env.PG_SSL || '') ? { rejectUnauthorized: false } : false,
      max: 10
    });
    await pgPool.query(`create table if not exists api_logs (
      id bigserial primary key,
      ts timestamptz not null,
      api_url text,
      headers jsonb,
      request_body jsonb,
      response_body jsonb,
      user_id text,
      event text,
      entity text,
      entity_id text,
      actor jsonb,
      request jsonb,
      response jsonb,
      metadata jsonb
    );`);
    await pgPool.query('create index if not exists idx_api_logs_ts on api_logs(ts desc);');
    // Attempt to add new columns if the table existed previously (ignore errors)
    const alterStatements = [
      "alter table api_logs add column if not exists event text",
      "alter table api_logs add column if not exists entity text",
      "alter table api_logs add column if not exists entity_id text",
      "alter table api_logs add column if not exists actor jsonb",
      "alter table api_logs add column if not exists request jsonb",
      "alter table api_logs add column if not exists response jsonb",
      "alter table api_logs add column if not exists metadata jsonb"
    ];
    for (const stmt of alterStatements) {
      try { await pgPool.query(stmt); } catch (_) { /* ignore */ }
    }
  }
  ready = true;
}

export async function insertLog(doc) {
  if (!ready) await initDb();
  if (driver === 'mongo' || driver === 'mongodb') {
    return mongoDb.collection('api_logs').insertOne(doc);
  } else {
    const q = `insert into api_logs (
      ts, api_url, headers, request_body, response_body, user_id,
      event, entity, entity_id, actor, request, response, metadata
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;
    const params = [
      doc.ts, doc.apiUrl, doc.headers, doc.requestBody, doc.responseBody, doc.userId,
      doc.event || null, doc.entity || null, doc.entityId || null, doc.actor || null,
      doc.request || null, doc.response || null, doc.metadata || null
    ];
    return pgPool.query(q, params).catch(e => { /* swallow; requirement: never throw */ });
  }
}

