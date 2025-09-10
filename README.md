# Request Logs Service

Minimal microservice to persist API request / response and domain event logs into Postgres or MongoDB.

## ✨ Features
- Single POST `/log` endpoint (idempotent style; always returns `{ "success": true }`).
- Supports two payload shapes: legacy flat and new structured event schema.
- Fire‑and‑forget persistence (non-blocking insert; caller never receives DB errors).
- Postgres (default) or MongoDB selectable via `DB_DRIVER` env var.
- Auto-creates table / collection and an index on timestamp.
- Safe schema evolution: new columns added automatically (Postgres) if missing.

## 📦 Payload Schemas
### 1. Structured Event (recommended)
```json
{
  "event": "candidate.created",
  "entity": "candidate",
  "entityId": "cand-123",
  "actor": { "id": "user-42", "name": "Jane Doe", "role": "user" },
  "request": {
    "method": "POST",
    "path": "/api/candidates",
    "headers": { "user-agent": "Mozilla/5.0" },
    "body": { "firstName": "Jane" }
  },
  "response": {
    "status": 201,
    "body": { "id": "cand-123", "status": "created" }
  },
  "metadata": { "traceId": "abc-123" }
}
```
The service will also auto-populate legacy fields (`apiUrl`, `headers`, `requestBody`, `responseBody`, `userId`) for backward compatibility.

### 2. Legacy Flat Shape
```json
{
  "apiUrl": "/v1/users/42",
  "headers": { "authorization": "Bearer <token>" },
  "requestBody": { "email": "a@b.com" },
  "responseBody": { "status": "ok" },
  "userId": "user-42"
}
```

In either case the server appends `ts` (UTC timestamp) at ingestion.

## 🗄️ Persistence Model
Postgres table `api_logs` columns:
`id, ts, api_url, headers, request_body, response_body, user_id, event, entity, entity_id, actor, request, response, metadata`

Mongo collection `api_logs` documents store all supplied fields plus `ts` (index created on `ts`).

## ⚙️ Environment Variables
Create your env file:
```
cp .env.example .env
```
Key variables (defaults in parentheses):
- `PORT` (3000) – HTTP listen port
- `LOG_LEVEL` (info) – fastify logger level
- `DB_DRIVER` (postgres) – `postgres` or `mongo`
- Postgres: `PG_HOST` (localhost), `PG_PORT` (5432), `PG_DATABASE` (request_logs), `PG_USER` (postgres), `PG_PASSWORD` (postgres), `PG_SSL` (false|true)
- Mongo: `MONGO_URI` (mongodb://localhost:27017), `MONGO_DB` (request_logs)

Secrets (passwords, tokens) should live only in `.env` (which should NOT be committed).

## 🚀 Run (Docker Compose)
```
docker compose up --build
```
This launches Postgres, Mongo, and the service on `localhost:3000` (container port 3000).

Disable an unused DB by commenting it out in `docker-compose.yml` to save resources.

## 💻 Run (Local Node Only)
Requires an accessible DB (e.g. local Postgres):
```
npm install
npm start
```
Or for development with hot reload (if you add nodemon script):
```
npm run dev
```

## 🧪 cURL Examples
### Legacy Flat Log
```
curl -X POST http://localhost:3000/log \
  -H 'Content-Type: application/json' \
  -d '{
    "apiUrl":"/v1/users",
    "headers":{"x":"y"},
    "requestBody":{"a":1},
    "responseBody":{"ok":true},
    "userId":"123"
  }'
```
### Structured Event Log
```
curl -X POST http://localhost:3000/log \
  -H 'Content-Type: application/json' \
  -d '{
    "event":"candidate.created",
    "entity":"candidate",
    "entityId":"cand-123",
    "actor":{"id":"user-42","name":"Jane Doe","role":"user"},
    "request":{"method":"POST","path":"/api/candidates","headers":{"user-agent":"Mozilla/5.0"},"body":{"firstName":"Jane"}},
    "response":{"status":201,"body":{"id":"cand-123","status":"created"}},
    "metadata":{"traceId":"abc-123"}
  }'
```
Both return:
```
{"success":true}
```

## 🔍 Querying Data
Postgres (recent 20 structured events):
```sql
select ts, event, entity, entity_id, (actor->>'id') as actor_id
from api_logs
where event is not null
order by ts desc
limit 20;
```
Mongo (same idea):
```js
db.api_logs.find({ event: { $ne: null } }, { ts:1, event:1, entity:1, entityId:1, 'actor.id':1 })
  .sort({ ts: -1 }).limit(20);
```

## 🛡️ Operational Notes
- Insert is fire-and-forget: failures are logged internally; client still gets success.
- Keep payloads modest; very large blobs increase storage cost and write latency.
- Add external retention / archival if high volume (e.g. nightly delete older than 90d).

## 🔄 Migration & Backward Compatibility
Old clients sending only legacy fields continue to work; new clients can adopt the structured schema incrementally. Legacy fields are derived automatically from structured logs.

## 🧰 Integration Snippet (Node)
```js
import fetch from 'node-fetch';

export async function logEvent(evt) {
  const url = process.env.REQUEST_LOG_SERVICE_URL + '/log';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt)
    });
  } catch (_) { /* intentionally ignore */ }
}
```

## 🩺 Health Check
Simple liveness probe (always returns success):
```
curl -X POST http://localhost:3000/log -H 'Content-Type: application/json' -d '{}'
```

## 📏 Performance Considerations
- Postgres JSONB indexes are not added automatically except timestamp index; add targeted GIN indexes if you need query performance.
- Mongo: consider TTL or capped collections for auto-purge if desired.

## 🧾 License
MIT – see `package.json`.

---
Feel free to open issues or PRs to enhance validation, batching, or retention tooling.
