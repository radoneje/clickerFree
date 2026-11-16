import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { createDb, createPool } from '@clickerfree/db';
import type { Pool } from 'pg';
import type { ApiConfig } from './config.js';
import { sendError } from './errors.js';
import { takeRateLimit } from './rate-limit.js';

export interface BuildAppOptions {
  config: ApiConfig;
  pool?: Pool;
}

export function buildApp({ config, pool }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: config.API_BODY_LIMIT_BYTES,
    // Forwarded-заголовки принимаются только от локального Nginx.
    trustProxy: '127.0.0.1',
    logger: { level: config.LOG_LEVEL },
  });

  const ownPool = pool ?? createPool(config.DATABASE_URL);
  const db = createDb(ownPool);
  app.addHook('onClose', async () => {
    await ownPool.end();
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || request.url.startsWith('/api/health/')) return;
    let result;
    try {
      result = await takeRateLimit(
        db,
        `general:ip:${request.ip}`,
        config.API_RATE_LIMIT_IP_PER_MIN,
        60,
      );
    } catch (err) {
      // Fail-closed: недоступность хранилища лимитов не открывает неограниченный доступ.
      request.log.error({ err }, 'rate limit storage unavailable');
      return sendError(reply, 503, 'service_unavailable', {});
    }
    if (!result.allowed) {
      reply.header('Retry-After', String(result.retryAfterSeconds));
      return sendError(reply, 429, 'rate_limited', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status === 413) {
      return sendError(reply, 413, 'payload_too_large', {
        limitBytes: config.API_BODY_LIMIT_BYTES,
      });
    }
    if (status === 400) {
      return sendError(reply, 400, 'validation_failed', { field: 'body' });
    }
    request.log.error({ err: error }, 'request failed');
    return sendError(reply, 500, 'internal_error', {});
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'not_found', {}));

  app.get('/api/health/live', async () => ({ status: 'ok' }));

  app.get('/api/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      await db.execute(sql`select count(*) from drizzle.__drizzle_migrations`);
      return { status: 'ok' };
    } catch {
      return sendError(reply, 503, 'service_unavailable', {});
    }
  });

  return app;
}
