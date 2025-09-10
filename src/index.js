import Fastify from 'fastify';
import dotenv from 'dotenv';
import { initDb, insertLog } from './persistence.js';

dotenv.config();

const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

fastify.post('/log', async (request, reply) => {
  // Accept legacy body or the new structured event shape documented by the user.
  const payload = request.body || {};

  // Detect structured event by presence of 'event' or 'entity' or nested request/response objects.
  const isStructured = typeof payload === 'object' && (
    payload.event || payload.entity || payload.request || payload.response || payload.metadata || payload.actor
  );

  let doc;
  if (isStructured) {
    doc = {
      ts: new Date(),
      // New structured fields
      event: payload.event || null,
      entity: payload.entity || null,
      entityId: payload.entityId || null,
      actor: payload.actor || null,           // { id, name, role }
      request: payload.request || null,       // { method, path, headers, body }
      response: payload.response || null,     // { status, body }
      metadata: payload.metadata || null,
      // For backward compatibility also map some legacy-friendly aliases
      apiUrl: payload.request?.path || null,
      headers: payload.request?.headers || null,
      requestBody: payload.request?.body || null,
      responseBody: payload.response?.body || null,
      userId: payload.actor?.id || null
    };
  } else {
    // Legacy flat shape
    doc = {
      ts: new Date(),
      apiUrl: payload.apiUrl || null,
      headers: payload.headers || null,
      requestBody: payload.requestBody || null,
      responseBody: payload.responseBody || null,
      userId: payload.userId || null
    };
  }

  try {
    insertLog(doc).catch(err => fastify.log.error({ err }, 'Insert failed (non-blocking)'));
  } catch (e) {
    // Swallow errors intentionally; always return true per requirements
    fastify.log.error({ e }, 'Unexpected synchronous error adding log');
  }
  return { success: true };
});

const start = async () => {
  await initDb();
  const port = process.env.PORT || 6000;
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
