import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { createDb, createPool } from '@clickerfree/db';
import type { Pool } from 'pg';
import type { ApiConfig } from './config.js';
import { sendError } from './errors.js';
import { takeRateLimit } from './rate-limit.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerPairingRoutes } from './pairing/routes.js';
import { registerDeviceRoutes } from './devices/routes.js';
import { registerVersionRoute } from './releases/version.js';
import { attachRealtime } from './realtime/gateway.js';
import { registerRemoteNamespace } from './realtime/remote.js';
import { registerControlRoutes } from './control/routes.js';
import { BROWSER_COOKIE, CSRF_COOKIE, SESSION_COOKIE } from './auth/cookies.js';
import { findSession } from './auth/sessions.js';
import './types.js';

export interface BuildAppOptions {
  config: ApiConfig;
  pool?: Pool;
  fetchImpl?: typeof fetch;
}

const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

export function buildApp({ config, pool, fetchImpl }: BuildAppOptions): FastifyInstance {
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

  app.register(cookie, { secret: config.SESSION_SECRET, hook: 'onRequest' });
  app.decorateRequest('auth', null);
  app.decorateRequest('browserId', '');

  // Идентификатор браузера выдаётся до проверки лимитов, чтобы первый запрос
  // не попадал в общий бакет с пустым ключом.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const secure = config.NODE_ENV === 'production';
    request.browserId = request.cookies[BROWSER_COOKIE] ?? randomUUID();
    if (!request.cookies[BROWSER_COOKIE]) {
      reply.setCookie(BROWSER_COOKIE, request.browserId, {
        path: '/',
        sameSite: 'lax',
        secure,
        httpOnly: true,
        maxAge: 31536000,
      });
    }
    if (!request.cookies[CSRF_COOKIE]) {
      reply.setCookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
        path: '/',
        sameSite: 'lax',
        secure,
        httpOnly: false,
        maxAge: 31536000,
      });
    }
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

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await findSession(db, token) : null;
  });

  // CSRF применяется к cookie-сессиям. Эндпоинты воркера аутентифицируются
  // секретом x-worker-secret, а не cookie, и от CSRF не зависят.
  app.addHook('onRequest', async (request, reply) => {
    if (!MUTATING_METHODS.includes(request.method) || !request.auth) return;
    if (
      request.url.startsWith('/api/pairing/code') ||
      request.url.startsWith('/api/pairing/result')
    ) {
      return;
    }
    const csrfCookie = request.cookies[CSRF_COOKIE];
    const csrfHeader = request.headers['x-csrf-token'];
    if (
      request.headers.origin !== config.APP_BASE_URL ||
      !csrfCookie ||
      csrfHeader !== csrfCookie
    ) {
      return sendError(reply, 403, 'csrf_invalid', {});
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

  registerAuthRoutes(app, { config, db, fetchImpl: fetchImpl ?? globalThis.fetch });
  registerPairingRoutes(app, { db });
  registerDeviceRoutes(app, { db });
  registerVersionRoute(app, { config, db });
  const io = attachRealtime(app, { config, db });
  registerRemoteNamespace(io, { config, db });
  registerControlRoutes(app, { config, db, io });

  return app;
}
