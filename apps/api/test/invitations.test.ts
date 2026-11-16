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

loadTestEnv();

let scratch: ScratchDatabase;
let app: FastifyInstance;
let baseUrl: string;
const openSockets: Socket[] = [];

beforeAll(async () => {
  scratch = await createScratchDatabase();
  app = makeTestApp(scratch.url);
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await scratch.drop();
});

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.disconnect();
});

const WORKER_SECRET = randomBytes(32).toString('base64url');

async function adminQuery(sql: string, params: unknown[] = []) {
  const admin = new Pool({ connectionString: scratch.url, max: 1 });
  try {
    return await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

async function pairDevice(
  jar: Jar,
  name = 'Invite PC',
): Promise<{ deviceId: string; credential: string }> {
  const installId = randomUUID();
  const codeResponse = await app.inject({
    method: 'POST',
    url: '/api/pairing/code',
    headers: { 'x-worker-secret': WORKER_SECRET, 'content-type': 'application/json' },
    payload: {
      installId,
      name,
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
  return {
    deviceId: confirmed.json().deviceId as string,
    credential: result.json().credential as string,
  };
}

async function createInvitation(jar: Jar, deviceId: string, lang: 'ru' | 'en' = 'en', hours = 2) {
  return app.inject({
    method: 'POST',
    url: `/api/devices/${deviceId}/invitations`,
    headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
    payload: { lang, hours },
  });
}

async function exchange(token: string) {
  return app.inject({ method: 'POST', url: '/api/invitations/exchange', payload: { token } });
}

function invitationJar(response: { headers: Record<string, unknown> }): Jar {
  const jar = cookieJar();
  jar.absorb(response);
  return jar;
}

function track(socket: Socket): Socket {
  openSockets.push(socket);
  return socket;
}

function connectSpeaker(jar: Jar, deviceId: string): Socket {
  return track(
    ioClient(`${baseUrl}/remote`, {
      auth: { deviceId },
      extraHeaders: { Cookie: jar.header() },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    }),
  );
}

function connectWorker(deviceId: string, credential: string): Socket {
  return track(
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
      timeout: 5000,
    }),
  );
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

async function setup() {
  const jar = cookieJar();
  await login(app, jar);
  const { deviceId, credential } = await pairDevice(jar);
  return { jar, deviceId, credential };
}

describe('invitation lifecycle', () => {
  it('creates a long GUID token and exchanges it for a speaker session', async () => {
    const { jar, deviceId } = await setup();
    const created = await createInvitation(jar, deviceId, 'en', 2);
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toContain(`/en/i?token=${body.token}`);

    const exchanged = await exchange(body.token);
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json()).toMatchObject({ deviceId, lang: 'en' });
    const speaker = invitationJar(exchanged);

    const session = await app.inject({
      method: 'GET',
      url: '/api/invitations/session',
      headers: { cookie: speaker.header() },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().deviceId).toBe(deviceId);
  });

  it('rejects guessed tokens and expired or revoked invitations', async () => {
    const { jar, deviceId } = await setup();
    const guessed = await exchange(randomBytes(32).toString('hex'));
    expect(guessed.statusCode).toBe(400);
    expect(guessed.json().error.code).toBe('invitation_invalid');

    const { token } = (await createInvitation(jar, deviceId)).json();
    await adminQuery(
      `update invitations set expires_at = now() - interval '1 minute' where device_id = $1`,
      [deviceId],
    );
    const expired = await exchange(token);
    expect(expired.json().error.code).toBe('invitation_expired');

    const fresh = (await createInvitation(jar, deviceId)).json();
    const speaker = invitationJar(await exchange(fresh.token));
    const list = (
      await app.inject({
        method: 'GET',
        url: `/api/devices/${deviceId}/invitations`,
        headers: { cookie: jar.header() },
      })
    ).json();
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/invitations/${list.invitations[0].id}`,
      headers: mutationHeaders(jar),
    });
    expect(revoke.statusCode).toBe(200);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/invitations/session',
      headers: { cookie: speaker.header() },
    });
    expect(afterRevoke.statusCode).toBe(401);
    const reExchange = await exchange(fresh.token);
    expect(reExchange.json().error.code).toBe('invitation_revoked');
  });

  it('enforces active invitations per device and creation rate per account', async () => {
    const { jar, deviceId } = await setup();
    for (let i = 0; i < 10; i += 1) {
      expect((await createInvitation(jar, deviceId)).statusCode).toBe(200);
    }
    const second = await pairDevice(jar, 'Second PC');
    for (let i = 0; i < 9; i += 1) {
      expect((await createInvitation(jar, second.deviceId)).statusCode).toBe(200);
    }
    // Отклонённая попытка тоже расходует токен лимита создания.
    const overDevice = await createInvitation(jar, deviceId);
    expect(overDevice.statusCode).toBe(400);
    expect(overDevice.json().error.code).toBe('invitation_limit_reached');

    const overAccount = await createInvitation(jar, second.deviceId);
    expect(overAccount.statusCode).toBe(429);
    expect(overAccount.json().error.code).toBe('rate_limited');
  });
});

describe('speaker permissions', () => {
  it('speaker controls the device but cannot access account or set the timer', async () => {
    const { jar, deviceId } = await setup();
    const { token } = (await createInvitation(jar, deviceId)).json();
    const speaker = invitationJar(await exchange(token));

    for (const url of ['/api/me', '/api/devices']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: speaker.header() },
      });
      expect(response.statusCode).toBe(401);
    }

    const speakerSocket = connectSpeaker(speaker, deviceId);
    const state = await once(speakerSocket, 'control:state');
    expect(state.role).toBe('controller');

    const timerEvents: Array<Record<string, unknown>> = [];
    // Начальный timer:state при подключении не считаем: проверяем именно рассылку.
    speakerSocket.on('timer:state', (data) => {
      if (data.endAt !== null) timerEvents.push(data);
    });
    speakerSocket.emit('timer:set', { endAt: Date.now() + 60000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(timerEvents.length).toBe(0);

    const endAt = Date.now() + 5 * 60000;
    const setByOwner = await app.inject({
      method: 'POST',
      url: `/api/devices/${deviceId}/timer`,
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { endAt },
    });
    expect(setByOwner.statusCode).toBe(200);
    await expect.poll(() => timerEvents.length).toBeGreaterThanOrEqual(1);
    expect(timerEvents.at(-1)?.endAt).toBe(endAt);
  });

  it('speaker commands reach the worker; revocation disconnects the speaker', async () => {
    const { jar, deviceId, credential } = await setup();
    const worker = connectWorker(deviceId, credential);
    await once(worker, 'worker:connected');
    const workerCommands: Array<Record<string, unknown>> = [];
    worker.on('control:command', (cmd) => {
      workerCommands.push(cmd);
      worker.emit('control:ack', { commandId: cmd.commandId, status: 'executed' });
    });

    const { token, id } = (await createInvitation(jar, deviceId)).json();
    const speaker = invitationJar(await exchange(token));
    const speakerSocket = connectSpeaker(speaker, deviceId);
    await once(speakerSocket, 'control:state');
    const acks: Array<Record<string, unknown>> = [];
    speakerSocket.on('control:ack', (ack) => acks.push(ack));

    speakerSocket.emit('control:command', { commandId: randomUUID(), action: 'next' });
    await expect.poll(() => workerCommands.length).toBe(1);
    expect(workerCommands[0].action).toBe('next');
    await expect.poll(() => acks.length).toBe(1);
    expect(acks[0].status).toBe('executed');

    const disconnected = new Promise<void>((resolve) =>
      speakerSocket.once('disconnect', () => resolve()),
    );
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/invitations/${id}`,
      headers: mutationHeaders(jar),
    });
    expect(revoke.statusCode).toBe(200);
    await disconnected;
  });

  it('speaker cannot open another device', async () => {
    const { jar, deviceId } = await setup();
    const other = await pairDevice(jar, 'Other PC');
    const { token } = (await createInvitation(jar, deviceId)).json();
    const speaker = invitationJar(await exchange(token));
    const socket = connectSpeaker(speaker, other.deviceId);
    await expect(once(socket, 'control:state')).rejects.toThrow('forbidden');
  });
});
