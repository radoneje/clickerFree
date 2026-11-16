import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import {
  createScratchDatabase,
  loadTestEnv,
  type ScratchDatabase,
} from '../../../db/test/helpers.js';
import { cookieJar, login, makeTestApp, mutationHeaders, type Jar } from './helpers.js';

loadTestEnv();

let scratch: ScratchDatabase;
const openApps: FastifyInstance[] = [];

beforeAll(async () => {
  scratch = await createScratchDatabase();
});

afterAll(async () => {
  await scratch.drop();
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function makeApp(): FastifyInstance {
  const app = makeTestApp(scratch.url);
  openApps.push(app);
  return app;
}

const WORKER_SECRET = randomBytes(32).toString('base64url');

function pairingBody(installId: string) {
  return {
    installId,
    name: 'Test PC',
    os: 'macos',
    arch: 'arm64',
    appVersion: '1.0.0',
    protocolVersion: 1,
  };
}

async function requestCode(app: FastifyInstance, installId: string, secret = WORKER_SECRET) {
  return app.inject({
    method: 'POST',
    url: '/api/pairing/code',
    headers: { 'x-worker-secret': secret, 'content-type': 'application/json' },
    payload: pairingBody(installId),
  });
}

async function confirm(app: FastifyInstance, jar: Jar, code: string) {
  return app.inject({
    method: 'POST',
    url: '/api/pairing/confirm',
    headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
    payload: { code },
  });
}

async function pairingResult(app: FastifyInstance, installId: string, secret = WORKER_SECRET) {
  return app.inject({
    method: 'GET',
    url: `/api/pairing/result?installId=${installId}`,
    headers: { 'x-worker-secret': secret },
  });
}

async function adminQuery(sql: string, params: unknown[] = []) {
  const admin = new Pool({ connectionString: scratch.url, max: 1 });
  try {
    return await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

describe('pairing flow', () => {
  it('pairs a computer end to end and delivers the credential once', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar);
    const installId = randomUUID();

    const codeResponse = await requestCode(app, installId);
    expect(codeResponse.statusCode).toBe(200);
    const code = codeResponse.json().code as string;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);

    expect((await pairingResult(app, installId)).json()).toEqual({ status: 'pending' });

    const confirmed = await confirm(app, jar, code);
    expect(confirmed.statusCode).toBe(200);
    const deviceId = confirmed.json().deviceId as string;

    const result = (await pairingResult(app, installId)).json();
    expect(result.status).toBe('confirmed');
    expect(result.deviceId).toBe(deviceId);
    expect((result.credential as string).length).toBeGreaterThanOrEqual(32);

    // Повторная выдача ключа невозможна.
    expect((await pairingResult(app, installId)).json()).toEqual({ status: 'expired' });

    const list = (
      await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie: jar.header() } })
    ).json();
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]).toMatchObject({
      id: deviceId,
      name: 'Test PC',
      os: 'macos',
      arch: 'arm64',
      appVersion: '1.0.0',
      online: false,
    });
  });

  it('rejects a wrong worker secret', async () => {
    const app = makeApp();
    const installId = randomUUID();
    await requestCode(app, installId);
    const response = await pairingResult(app, installId, randomBytes(32).toString('base64url'));
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('pairing_secret_invalid');
  });

  it('rejects invalid and expired codes', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar);
    const installId = randomUUID();
    const { code } = (await requestCode(app, installId)).json();

    const invalid = await confirm(app, jar, 'AAAAAAAA');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('pairing_code_invalid');

    await adminQuery(
      `update pairing_requests set expires_at = now() - interval '1 minute' where install_id = $1`,
      [installId],
    );
    const expired = await confirm(app, jar, code);
    expect(expired.statusCode).toBe(400);
    expect((await pairingResult(app, installId)).json()).toEqual({ status: 'expired' });
  });

  it('invalidates a code after the attempt limit', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar);
    const installId = randomUUID();
    const { code } = (await requestCode(app, installId)).json();
    await adminQuery(`update pairing_requests set attempts = 10 where install_id = $1`, [
      installId,
    ]);
    const response = await confirm(app, jar, code);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('pairing_code_exhausted');
    expect((await pairingResult(app, installId)).json()).toEqual({ status: 'expired' });
  });

  it('limits code creation per installation', async () => {
    const app = makeApp();
    const installId = randomUUID();
    for (let i = 0; i < 5; i += 1) {
      expect((await requestCode(app, installId)).statusCode).toBe(200);
    }
    const blocked = await requestCode(app, installId);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
  });

  it('re-pairing the same installation keeps the device and rotates the key', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar);
    const installId = randomUUID();

    const first = (await requestCode(app, installId)).json();
    const firstConfirm = await confirm(app, jar, first.code);
    const deviceId = firstConfirm.json().deviceId as string;
    const firstCredential = (await pairingResult(app, installId)).json().credential as string;

    const second = (await requestCode(app, installId)).json();
    const secondConfirm = await confirm(app, jar, second.code);
    expect(secondConfirm.json().deviceId).toBe(deviceId);
    const secondCredential = (await pairingResult(app, installId)).json().credential as string;
    expect(secondCredential).not.toBe(firstCredential);

    const list = (
      await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie: jar.header() } })
    ).json();
    expect(list.devices).toHaveLength(1);
  });

  it('refuses an installation owned by another account and enforces the device limit', async () => {
    const app = makeApp();
    const owner = cookieJar();
    await login(app, owner);
    const installId = randomUUID();
    const { code } = (await requestCode(app, installId)).json();
    await confirm(app, owner, code);

    const other = cookieJar();
    await login(app, other, 'yandex');
    const otherCode = (await requestCode(app, installId)).json().code;
    const conflict = await confirm(app, other, otherCode);
    expect(conflict.statusCode).toBe(403);

    const userId = (
      await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: other.header() } })
    ).json().id as string;
    for (let i = 0; i < 10; i += 1) {
      await adminQuery(
        `insert into devices (user_id, install_id, name, os, arch, app_version, protocol_version) values ($1, $2, 'PC', 'windows', 'x64', '1.0.0', 1)`,
        [userId, randomUUID()],
      );
    }
    const freshInstall = randomUUID();
    const freshCode = (await requestCode(app, freshInstall)).json().code;
    const limited = await confirm(app, other, freshCode);
    expect(limited.statusCode).toBe(400);
    expect(limited.json().error.code).toBe('device_limit_reached');
  });
});

describe('device management', () => {
  it('renames and unlinks only own devices', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar);
    const installId = randomUUID();
    const { code } = (await requestCode(app, installId)).json();
    const deviceId = (await confirm(app, jar, code)).json().deviceId as string;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/devices/${deviceId}`,
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { name: 'Stage PC' },
    });
    expect(renamed.statusCode).toBe(200);

    const stranger = cookieJar();
    await login(app, stranger, 'yandex');
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceId}`,
      headers: mutationHeaders(stranger),
    });
    expect(foreign.statusCode).toBe(404);

    const unlinked = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceId}`,
      headers: mutationHeaders(jar),
    });
    expect(unlinked.statusCode).toBe(200);
    const list = (
      await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie: jar.header() } })
    ).json();
    expect(list.devices).toHaveLength(0);
  });
});
