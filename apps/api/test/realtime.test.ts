import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION } from '@clickerfree/contracts';
import {
  createScratchDatabase,
  loadTestEnv,
  type ScratchDatabase,
} from '../../../db/test/helpers.js';
import { cookieJar, login, makeTestApp, mutationHeaders } from './helpers.js';

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

async function pairedDevice(): Promise<{
  deviceId: string;
  credential: string;
  jar: ReturnType<typeof cookieJar>;
}> {
  const jar = cookieJar();
  await login(app, jar);
  const installId = randomUUID();
  const codeResponse = await app.inject({
    method: 'POST',
    url: '/api/pairing/code',
    headers: { 'x-worker-secret': WORKER_SECRET, 'content-type': 'application/json' },
    payload: {
      installId,
      name: 'Realtime PC',
      os: 'macos',
      arch: 'arm64',
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
  const { deviceId } = confirmed.json();
  const result = await app.inject({
    method: 'GET',
    url: `/api/pairing/result?installId=${installId}`,
    headers: { 'x-worker-secret': WORKER_SECRET },
  });
  const { credential } = result.json();
  return { deviceId, credential, jar };
}

function connectWorker(
  deviceId: string,
  credential: string,
  overrides: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Socket {
  const socket = ioClient(`${baseUrl}/worker`, {
    auth: {
      deviceId,
      credential,
      appVersion: '1.0.0',
      os: 'macos',
      arch: 'arm64',
      protocolVersion: PROTOCOL_VERSION,
      ...overrides,
    },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 5000,
    extraHeaders,
  });
  openSockets.push(socket);
  return socket;
}

function once(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 5000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('worker realtime gateway', () => {
  it('accepts a paired worker and marks the device online', async () => {
    const { deviceId, credential, jar } = await pairedDevice();
    const socket = connectWorker(deviceId, credential);
    const payload = (await once(socket, 'worker:connected')) as { generation: number };
    expect(payload.generation).toBeGreaterThanOrEqual(1);

    const list = (
      await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie: jar.header() } })
    ).json();
    expect(list.devices[0].online).toBe(true);
  });

  it('rejects a wrong credential', async () => {
    const { deviceId } = await pairedDevice();
    const socket = connectWorker(deviceId, randomBytes(32).toString('base64url'));
    await expect(once(socket, 'worker:connected')).rejects.toThrow('unauthorized');
  });

  it('rejects an unsupported protocol version', async () => {
    const { deviceId, credential } = await pairedDevice();
    const socket = connectWorker(deviceId, credential, { protocolVersion: PROTOCOL_VERSION + 1 });
    await expect(once(socket, 'worker:connected')).rejects.toThrow('worker_version_unsupported');
  });

  it('disconnects immediately when the device is unlinked', async () => {
    const { deviceId, credential, jar } = await pairedDevice();
    const socket = connectWorker(deviceId, credential);
    await once(socket, 'worker:connected');

    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceId}`,
      headers: mutationHeaders(jar),
    });
    expect(response.statusCode).toBe(200);
    await disconnected;
  });

  it('supersedes the previous connection with a new generation', async () => {
    const { deviceId, credential } = await pairedDevice();
    const first = connectWorker(deviceId, credential);
    const firstPayload = (await once(first, 'worker:connected')) as { generation: number };
    const firstDisconnected = new Promise<void>((resolve) =>
      first.once('disconnect', () => resolve()),
    );

    const second = connectWorker(deviceId, credential);
    const secondPayload = (await once(second, 'worker:connected')) as { generation: number };
    expect(secondPayload.generation).toBeGreaterThan(firstPayload.generation);
    await firstDisconnected;
  });

  it('rejects a foreign Origin and accepts the API own origin', async () => {
    const { deviceId, credential } = await pairedDevice();
    const foreign = connectWorker(deviceId, credential, {}, { Origin: 'https://evil.example' });
    await expect(once(foreign, 'worker:connected')).rejects.toThrow();

    const own = connectWorker(deviceId, credential, {}, { Origin: baseUrl });
    const payload = (await once(own, 'worker:connected')) as { generation: number };
    expect(payload.generation).toBeGreaterThanOrEqual(1);
  });

  it('rate limits repeated connections per device', async () => {
    const { deviceId, credential } = await pairedDevice();
    const errors: Array<{ i: number; message: string }> = [];
    for (let i = 0; i < 11; i += 1) {
      const socket = connectWorker(deviceId, credential);
      try {
        await once(socket, 'worker:connected');
      } catch (err) {
        errors.push({ i, message: (err as Error).message });
        break;
      }
    }
    expect(errors).toEqual([{ i: 10, message: 'rate_limited' }]);
  });
});
