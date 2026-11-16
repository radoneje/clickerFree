import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  createScratchDatabase,
  loadTestEnv,
  type ScratchDatabase,
} from '../../../db/test/helpers.js';

loadTestEnv();

let scratch: ScratchDatabase;

beforeAll(async () => {
  scratch = await createScratchDatabase();
});

afterAll(async () => {
  await scratch.drop();
});

const openApps: FastifyInstance[] = [];

function makeApp(overrides: Record<string, string> = {}) {
  const app = buildApp({
    config: loadConfig({
      ...process.env,
      DATABASE_URL: scratch.url,
      LOG_LEVEL: 'silent',
      ...overrides,
    }),
  });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('health endpoints', () => {
  it('live reports process health without touching the database', async () => {
    const app = makeApp({ DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' });
    const response = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('ready succeeds against a migrated database', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('ready returns 503 when the database is unreachable', async () => {
    const app = makeApp({ DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' });
    const response = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('service_unavailable');
  });
});

describe('error format', () => {
  it('returns a stable code for unknown routes', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'not_found', params: {} } });
  });

  it('rejects bodies over the 64 KB limit', async () => {
    const app = makeApp();
    app.post('/api/test-echo', async (request) => request.body ?? null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'x'.repeat(70000) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('payload_too_large');
    expect(response.json().error.params.limitBytes).toBe(65536);
  });

  it('maps unexpected failures to internal_error', async () => {
    const app = makeApp();
    app.get('/api/test-boom', async () => {
      throw new Error('boom');
    });
    const response = await app.inject({ method: 'GET', url: '/api/test-boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
  });
});

describe('proxy trust', () => {
  it('ignores forwarded headers from untrusted sources', async () => {
    const app = makeApp();
    app.get('/api/test-ip', async (request) => ({ ip: request.ip }));
    const spoofed = await app.inject({
      method: 'GET',
      url: '/api/test-ip',
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    expect(spoofed.json().ip).toBe('203.0.113.7');

    const proxied = await app.inject({
      method: 'GET',
      url: '/api/test-ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    expect(proxied.json().ip).toBe('198.51.100.9');
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const app = makeApp({ API_RATE_LIMIT_IP_PER_MIN: '3' });
    app.get('/api/test-ping', async () => ({ ok: true }));
    // Отдельный IP: бакет general:ip:127.0.0.1 уже расходовали другие тесты.
    const source = { remoteAddress: '10.9.0.1' };
    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/test-ping', ...source });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: 'GET', url: '/api/test-ping', ...source });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.json().error.code).toBe('rate_limited');
    expect(blocked.json().error.params.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  // Последний тест файла: таблица бакетов удаляется и не восстанавливается.
  it('fails closed when the limit storage is unavailable', async () => {
    const admin = new Pool({ connectionString: scratch.url, max: 1 });
    await admin.query('drop table rate_limit_buckets');
    await admin.end();

    const app = makeApp();
    app.get('/api/test-ping', async () => ({ ok: true }));
    const response = await app.inject({ method: 'GET', url: '/api/test-ping' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('service_unavailable');
  });
});
