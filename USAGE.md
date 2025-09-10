# Request Logs Service Usage Guide

Minimal service to record API request/response data to Postgres or MongoDB.

## 1. Data Model Stored
Each POST `/log` call stores a document with server timestamp `ts` plus either:

Legacy flat fields:
- `apiUrl` (string or null)
- `headers` (object or null)
- `requestBody` (any JSON or null)
- `responseBody` (any JSON or null)
- `userId` (string or null)

Or the structured event shape (new):
- `event` (string)
- `entity` (string)
- `entityId` (string)
- `actor` (object: `{ id, name, role }`)
- `request` (object: `{ method, path, headers, body }`)
- `response` (object: `{ status, body }`)
- `metadata` (free object)

For compatibility the service also populates legacy fields from structured payload (`apiUrl` from `request.path`, `headers` from `request.headers`, etc.).

Response is always:
```
{ "success": true }
```
No errors are propagated to the caller; failures are only logged server‑side.

## 2. Environment Configuration
Copy and edit:
```
cp .env.example .env
```
Key variables:
- `PORT` (default 6000)
- `DB_DRIVER` = `postgres` (default) or `mongo`
- Postgres: `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`, `PG_SSL`
- Mongo: `MONGO_URI`, `MONGO_DB`
- `LOG_LEVEL` = `silent|error|info`

## 3. Run (Docker Compose)
```
docker compose up --build
```
This starts Postgres, Mongo, and the service (you can comment out the DB you don't need).

## 4. Run (Local Node Only)
Install deps and start (expects an external DB):
```
npm install
npm start
```

## 5. Switch Database
Postgres (default):
```
DB_DRIVER=postgres
```
Mongo:
```
DB_DRIVER=mongo
```
## Example `.env` File

Copy to `.env` and adjust as needed. Only fill in the section for the database you use.

```
PORT=3000
NODE_ENV=production

# Choose either 'postgres' or 'mongo'
DB_DRIVER=postgres

# Postgres settings (if using Postgres)
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=request_logs
PG_USER=postgres
PG_PASSWORD=postgres
PG_SSL=false

# Mongo settings (if using MongoDB)
MONGO_URI=mongodb://mongo:27017
MONGO_DB=request_logs

# Optional log level: silent, error, or info
LOG_LEVEL=info
```


Restart the service after changing.

## 6. Send a Log Entry (Legacy Shape, cURL)
```
curl -X POST http://localhost:3000/log \
  -H 'Content-Type: application/json' \
  -d '{
    "apiUrl":"/v1/users/42",
    "headers":{"authorization":"Bearer <token>"},
    "requestBody":{"email":"a@b.com"},
    "responseBody":{"status":"ok"},
    "userId":"user-42"
  }'
```
Response:
```
{"success":true}
```

## 7. Send a Structured Event Log Entry (cURL)
```
curl -X POST http://localhost:6000/log \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "candidate.created",
    "entity": "candidate",
    "entityId": "cand-123",
    "actor": { "id": "user-42", "name": "Jane Doe", "role": "user" },
    "request": {
      "method": "POST",
      "path": "/api/candidates",
      "headers": { "user-agent": "Mozilla/5.0" },
      "body": { "firstName": "Jane", "lastName": "Doe" }
    },
    "response": {
      "status": 201,
      "body": { "id": "cand-123", "status": "created" }
    },
    "metadata": { "traceId": "abc-123" }
  }'
```
Response:
```
{"success":true}
```

## 8. Integrating From Another Service (Node Example)
```js
import fetch from 'node-fetch';

async function logCall(ctx) {
  const payload = ctx.structured ? {
    event: ctx.event,
    entity: ctx.entity,
    entityId: ctx.entityId,
    actor: ctx.actor,            // { id, name, role }
    request: ctx.request,        // { method, path, headers, body }
    response: ctx.response,      // { status, body }
    metadata: ctx.metadata
  } : {
    apiUrl: ctx.apiUrl,
    headers: ctx.headers,
    requestBody: ctx.requestBody,
    responseBody: ctx.responseBody,
    userId: ctx.userId
  };
  await fetch(process.env.REQUEST_LOG_SERVICE_URL + '/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {}); // intentionally ignore any errors
}
```

## 9. Database Artifacts
Postgres table: `api_logs`
Columns: `id, ts, api_url, headers, request_body, response_body, user_id, event, entity, entity_id, actor, request, response, metadata`
Mongo collection: `api_logs` with an index on `ts` (all fields stored verbatim).

## 10. Operational Notes
- Endpoint is intentionally forgiving: missing fields stored as null.
- Insert is fire‑and‑forget; response is returned without waiting for DB success.
- Keep payloads small for speed; large blobs increase storage and latency.

## 11. Health & Monitoring
No explicit health endpoint; basic check:
```
curl -X POST http://localhost:3000/log -d '{}' -H 'Content-Type: application/json'
```
If you get `{"success":true}` the process is up.

## 12. Production Tips
- Place behind an internal network or auth proxy if data is sensitive.
- Consider batching or async queue if write volume becomes high.
- Add retention/archival logic externally if needed.

## 13. Troubleshooting
| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Immediate exit on start (Postgres) | Bad credentials | Verify `PG_*` vars |
| Inserts not appearing | Wrong DB driver | Check `DB_DRIVER` |
| Slow startup (Mongo) | Network / DNS | Test `MONGO_URI` with a mongo shell |

## 14. License
MIT (see `package.json`).

## 15. Automated Backups (Optional)
Set these in `.env` to enable daily backups:
```
BACKUP_ENABLED=true
BACKUP_CRON=0 2 * * *
BACKUP_RETENTION_DAYS=7
BACKUP_S3_BUCKET=your-bucket
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY=AKIA...
BACKUP_S3_SECRET_KEY=...secret...
# For DigitalOcean Spaces (example):
# BACKUP_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
```
Behavior:
- Creates compressed dumps (.sql.gz for Postgres or .tar.gz for Mongo) in `BACKUP_DIR` (default `/tmp/db_backups`).
- Uploads to S3 / compatible endpoint if bucket & credentials provided.
- Retains only newest N files (local + remote) where N = `BACKUP_RETENTION_DAYS`.
- Can trigger a one-off backup at startup with `BACKUP_RUN_ON_START=true`.

Cron Expression Notes:
- Defaults to `0 2 * * *` (02:00 UTC daily). Use https://crontab.guru to adjust.

Validate Manually (inside container):
```
node -e "import('./src/backup.js').then(m=>m.runBackup(console))"
```

Troubleshooting:
- Ensure `pg_dump` or `mongodump` installed (added via Dockerfile using alpine packages).
- Check logs for `Backup failed` messages (enable higher verbosity with `LOG_LEVEL=info`).
