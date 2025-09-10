# Request Logs Service

Ultra-minimal microservice to persist request/response logs into either Postgres or MongoDB.

## Features
- Single POST `/log` endpoint.
- Accepts: `apiUrl`, `headers`, `requestBody`, `responseBody`, `userId`.
- Stores plus server timestamp `ts`.
- Never throws to client: always responds `{ "success": true }` even if DB insert fails.
- Pluggable DB driver selected via `DB_DRIVER` env (`postgres` (default) or `mongo`).
- Auto-creates table / collection & basic index.

## Environment Variables
See `.env.example` for the full list. Copy it:
```
cp .env.example .env
```
Adjust the values you need.

## Run with Docker Compose
```
docker compose up --build
```
Then POST a log:
```
curl -X POST http://localhost:3000/log \
  -H 'Content-Type: application/json' \
  -d '{"apiUrl":"/v1/users","headers":{"x":"y"},"requestBody":{"a":1},"responseBody":{"ok":true},"userId":"123"}'
```
Response:
```
{"success":true}
```

## Notes
- For production you may supply your own external Postgres / Mongo endpoints and skip the compose services you don't need.
- Errors during insert are only logged on server side.
