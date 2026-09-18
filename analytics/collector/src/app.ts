import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { normalizeTrackingEvent, validateTrackingEvent } from './event.js';
import { insertTrackingEvent } from './store.js';
import { normalizeWorkflowEvent, validateWorkflowEvent } from './workflow.js';
import { insertWorkflowEvent } from './workflowStore.js';

export function createApp(pool: Pool, trustProxy: boolean) {
  const app = Fastify({
    trustProxy,
    bodyLimit: 64 * 1024,
    logger: true,
  });

  void app.register(cors, { origin: true, methods: ['POST', 'GET'] });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.code(500).send({ code: 500, message: 'internal error' });
  });

  app.get('/health', async () => ({ code: 0, status: 'ok' }));

  app.post('/track', async (request, reply) => {
    const event = normalizeTrackingEvent(request.body, request.ip);
    const validationError = validateTrackingEvent(event);
    if (validationError) {
      return reply.code(400).send({ code: 400, message: validationError });
    }

    await insertTrackingEvent(pool, event);
    return { code: 0 };
  });

  app.post('/workflow-events', async (request, reply) => {
    const event = normalizeWorkflowEvent(request.body, request.ip);
    const validationError = validateWorkflowEvent(event);
    if (validationError) {
      return reply.code(400).send({ code: 400, message: validationError });
    }

    await insertWorkflowEvent(pool, event);
    return { code: 0 };
  });

  return app;
}
