import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { Pool } from 'pg';
import { PROTOCOL_VERSION } from '@clickerfree/contracts';
import {
  createScratchDatabase,
  loadTestEnv,
  type ScratchDatabase,
} from '../../../db/test/helpers.js';
import { cookieJar, login, makeTestApp, mutationHeaders, type Jar } from './helpers.js';
import { totpCode } from '../src/auth/totp.js';
import { aggregateDay, cleanupAnalytics, closeIdleUsageSessions } from '../src/analytics/jobs.js';
import { createDb } from '@clickerfree/db';

loadTestEnv();

let scratch: ScratchDatabase;
let app: FastifyInstance;
let baseUrl: string;
const openSockets: Socket[] = [];
const testPools: Pool[] = [];

function testDb() {
  const pool = new Pool({ connectionString: scratch.url, max: 1 });
  testPools.push(pool);
  return createDb(pool);
}

beforeAll(async () => {
  scratch = await createScratchDatabase();
  app = makeTestApp(scratch.url);
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await Promise.all(testPools.map((pool) => pool.end()));
  await scratch.drop();
});

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.disconnect();
});

async function adminQuery(sql: string, params: unknown[] = []) {
  const admin = new Pool({ connectionString: scratch.url, max: 1 });
  try {
    return await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

async function makeAdmin(jar: Jar): Promise<string> {
  const me = (
    await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: jar.header() } })
  ).json();
  await adminQuery(`update users set role = 'admin' where id = $1`, [me.id]);
  return me.id as string;
}

function currentTotp(secret: string): string {
  return totpCode(secret, Math.floor(Date.now() / 1000 / 30));
}

async function setupTotp(jar: Jar): Promise<string> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/admin/totp/setup',
    headers: mutationHeaders(jar),
  });
  expect(setup.statusCode).toBe(200);
  const { secret } = setup.json();
  const verify = await app.inject({
    method: 'POST',
    url: '/api/admin/totp/verify',
    headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
    payload: { code: currentTotp(secret) },
  });
  expect(verify.statusCode).toBe(200);
  return secret;
}

const WORKER_SECRET = randomBytes(32).toString('base64url');

async function pairDevice(jar: Jar): Promise<{ deviceId: string; credential: string }> {
  const installId = randomUUID();
  const codeResponse = await app.inject({
    method: 'POST',
    url: '/api/pairing/code',
    headers: { 'x-worker-secret': WORKER_SECRET, 'content-type': 'application/json' },
    payload: {
      installId,
      name: 'Analytics PC',
      os: 'windows',
      arch: 'x64',
      appVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  const { code } = codeResponse.json();
  const confirmed = await app.inject({
    method: 'POST',
    url: '/api/pairing/confirm',
    headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
    payload: { code },
  });
  const result = await app.inject({
    method: 'GET',
    url: `/api/pairing/result?installId=${installId}`,
    headers: { 'x-worker-secret': WORKER_SECRET },
  });
  return { deviceId: confirmed.json().deviceId, credential: result.json().credential };
}

function track(socket: Socket): Socket {
  openSockets.push(socket);
  return socket;
}

function once(socket: Socket, event: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 5000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data as Record<string, unknown>);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('admin TOTP', () => {
  it('requires admin role and protects stats with TOTP after enable', async () => {
    const user = cookieJar();
    await login(app, user);
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { cookie: user.header() },
    });
    expect(forbidden.statusCode).toBe(403);

    const jar = cookieJar();
    await login(app, jar, 'dev');
    await makeAdmin(jar);

    const before = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { cookie: jar.header() },
    });
    expect(before.statusCode).toBe(200);

    const secret = await setupTotp(jar);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/admin/totp/authenticate',
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('totp_invalid');

    // Новая сессия того же пользователя без подтверждения TOTP не получает доступ.
    const fresh = cookieJar();
    await login(app, fresh, 'dev');
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { cookie: fresh.header() },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('totp_required');

    const auth = await app.inject({
      method: 'POST',
      url: '/api/admin/totp/authenticate',
      headers: { ...mutationHeaders(fresh), 'content-type': 'application/json' },
      payload: { code: currentTotp(secret) },
    });
    expect(auth.statusCode).toBe(200);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { cookie: fresh.header() },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('exports CSV and audits role changes with fresh TOTP', async () => {
    const jar = cookieJar();
    await login(app, jar);
    const adminId = await makeAdmin(jar);
    await setupTotp(jar);

    const csv = await app.inject({
      method: 'GET',
      url: '/api/admin/stats.csv',
      headers: { cookie: jar.header() },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('day,metric,dimension,value')).toBe(true);

    const target = cookieJar();
    await login(app, target);
    const targetId = (
      await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: target.header() } })
    ).json().id as string;
    const roleChange = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${targetId}/role`,
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { role: 'admin' },
    });
    expect(roleChange.statusCode).toBe(200);
    const audit = await adminQuery(
      `select action from audit_events where actor_user_id = $1 and action = 'role_change'`,
      [adminId],
    );
    expect(audit.rows.length).toBe(1);
  });
});

describe('usage analytics', () => {
  it('records commands, starts usage on first command and closes idle sessions', async () => {
    const jar = cookieJar();
    await login(app, jar);
    const { deviceId, credential } = await pairDevice(jar);

    const worker = track(
      ioClient(`${baseUrl}/worker`, {
        auth: {
          deviceId,
          credential,
          appVersion: '1.0.0',
          os: 'windows',
          arch: 'x64',
          protocolVersion: PROTOCOL_VERSION,
        },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      }),
    );
    await once(worker, 'worker:connected');
    const remote = track(
      ioClient(`${baseUrl}/remote`, {
        auth: { deviceId },
        extraHeaders: { Cookie: jar.header() },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      }),
    );
    const state = await once(remote, 'control:state');
    const commandId = randomUUID();
    remote.emit('control:command', { commandId, action: 'next' });
    await once(worker, 'control:command');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const events = await adminQuery(`select kind, action from usage_events where event_id = $1`, [
      commandId,
    ]);
    expect(events.rows[0]).toMatchObject({ kind: 'command', action: 'next' });
    const session = await adminQuery(
      `select usage_started_at, usage_ended_at from control_sessions where id = $1`,
      [state.controlSessionId],
    );
    expect(session.rows[0].usage_started_at).not.toBeNull();
    expect(session.rows[0].usage_ended_at).toBeNull();

    // 15 минут без команд: сеанс использования закрывается границей idle.
    await adminQuery(
      `update control_sessions set usage_started_at = now() - interval '25 minutes', last_command_at = now() - interval '20 minutes' where id = $1`,
      [state.controlSessionId],
    );
    await closeIdleUsageSessions(testDb());
    const closed = await adminQuery(
      `select extract(epoch from (usage_ended_at - usage_started_at))::int as duration from control_sessions where id = $1`,
      [state.controlSessionId],
    );
    expect(closed.rows[0].duration).toBeGreaterThanOrEqual(1195);
    expect(closed.rows[0].duration).toBeLessThanOrEqual(1205);
  });

  it('aggregates idempotently and cleans up old raw events', async () => {
    const db = testDb();
    const today = new Date().toISOString().slice(0, 10);
    await aggregateDay(db, today);
    const first = await adminQuery(
      `select metric, dimension, value from daily_metrics where day = $1 order by metric, dimension`,
      [today],
    );
    await aggregateDay(db, today);
    const second = await adminQuery(
      `select metric, dimension, value from daily_metrics where day = $1 order by metric, dimension`,
      [today],
    );
    expect(second.rows).toEqual(first.rows);
    expect(first.rows.some((row: { metric: string }) => row.metric === 'commands')).toBe(true);

    await adminQuery(
      `insert into usage_events (event_id, kind, created_at) values ($1, 'command', now() - interval '40 days')`,
      [randomUUID()],
    );
    await cleanupAnalytics(db);
    const old = await adminQuery(
      `select count(*)::int as n from usage_events where created_at < now() - interval '35 days'`,
    );
    expect(old.rows[0].n).toBe(0);
  });

  // Последний тест: таблица событий удаляется, восстановление не требуется.
  it('analytics failure does not block command delivery', async () => {
    const jar = cookieJar();
    await login(app, jar);
    const { deviceId, credential } = await pairDevice(jar);
    const worker = track(
      ioClient(`${baseUrl}/worker`, {
        auth: {
          deviceId,
          credential,
          appVersion: '1.0.0',
          os: 'windows',
          arch: 'x64',
          protocolVersion: PROTOCOL_VERSION,
        },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      }),
    );
    await once(worker, 'worker:connected');
    const received = once(worker, 'control:command');
    const remote = track(
      ioClient(`${baseUrl}/remote`, {
        auth: { deviceId },
        extraHeaders: { Cookie: jar.header() },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      }),
    );
    await once(remote, 'control:state');
    await adminQuery(`drop table usage_events`);
    remote.emit('control:command', { commandId: randomUUID(), action: 'next' });
    const command = await received;
    expect(command.action).toBe('next');
  });
});
