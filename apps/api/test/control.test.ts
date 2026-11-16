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

async function pairedDevice(jar: Jar): Promise<{ deviceId: string; credential: string }> {
  const installId = randomUUID();
  const codeResponse = await app.inject({
    method: 'POST',
    url: '/api/pairing/code',
    headers: { 'x-worker-secret': WORKER_SECRET, 'content-type': 'application/json' },
    payload: {
      installId,
      name: 'Control PC',
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
  const { deviceId } = confirmed.json();
  const result = await app.inject({
    method: 'GET',
    url: `/api/pairing/result?installId=${installId}`,
    headers: { 'x-worker-secret': WORKER_SECRET },
  });
  return { deviceId, credential: result.json().credential };
}

function track(socket: Socket): Socket {
  openSockets.push(socket);
  return socket;
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

function connectRemote(jar: Jar, deviceId: string): Socket {
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

function collect(socket: Socket, event: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  socket.on(event, (data) => items.push(data as Record<string, unknown>));
  return items;
}

async function setup() {
  const jar = cookieJar();
  await login(app, jar);
  const { deviceId, credential } = await pairedDevice(jar);
  return { jar, deviceId, credential };
}

describe('control sessions and commands', () => {
  it('first remote controls, second watches; commands reach the worker and acks return', async () => {
    const { jar, deviceId, credential } = await setup();
    const worker = connectWorker(deviceId, credential);
    await once(worker, 'worker:connected');
    const workerCommands = collect(worker, 'control:command');

    const first = connectRemote(jar, deviceId);
    const firstState = await once(first, 'control:state');
    expect(firstState.role).toBe('controller');
    expect(firstState.deviceOnline).toBe(true);

    const second = connectRemote(jar, deviceId);
    const secondState = await once(second, 'control:state');
    expect(secondState.role).toBe('viewer');

    const acks = collect(first, 'control:ack');
    const commandId = randomUUID();
    first.emit('control:command', { commandId, action: 'next' });
    await expect.poll(() => workerCommands.length).toBe(1);
    expect(workerCommands[0]).toMatchObject({ commandId, action: 'next' });
    expect(workerCommands[0].controlSessionId).toBe(firstState.controlSessionId);
    expect(workerCommands[0].expiresAt).toBeGreaterThan(Date.now());
    expect(workerCommands[0].expiresAt - Date.now()).toBeLessThanOrEqual(2000);

    worker.emit('control:ack', { commandId, status: 'executed' });
    await expect.poll(() => acks.length).toBe(1);
    expect(acks[0]).toMatchObject({ commandId, status: 'executed' });

    const viewerAck = collect(second, 'control:ack');
    second.emit('control:command', { commandId: randomUUID(), action: 'next' });
    await expect.poll(() => viewerAck.length).toBe(1);
    expect(viewerAck[0].errorCode).toBe('control_session_required');
    expect(workerCommands.length).toBe(1);
  });

  it('drops commands above the burst limit', async () => {
    const { jar, deviceId, credential } = await setup();
    const worker = connectWorker(deviceId, credential);
    await once(worker, 'worker:connected');
    const workerCommands = collect(worker, 'control:command');
    worker.on('control:command', (cmd) => {
      worker.emit('control:ack', { commandId: cmd.commandId, status: 'executed' });
    });
    const remote = connectRemote(jar, deviceId);
    await once(remote, 'control:state');
    const acks = collect(remote, 'control:ack');

    for (let i = 0; i < 12; i += 1) {
      remote.emit('control:command', { commandId: randomUUID(), action: 'next' });
    }
    await expect.poll(() => acks.length).toBe(12);
    const rejected = acks.filter((ack) => ack.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    expect(rejected.every((ack) => ack.errorCode === 'command_rate_limited')).toBe(true);
    expect(workerCommands.length).toBeLessThanOrEqual(10);
  });

  it('rejects commands when the worker is offline', async () => {
    const { jar, deviceId } = await setup();
    const remote = connectRemote(jar, deviceId);
    await once(remote, 'control:state');
    const acks = collect(remote, 'control:ack');
    remote.emit('control:command', { commandId: randomUUID(), action: 'next' });
    await expect.poll(() => acks.length).toBe(1);
    expect(acks[0].errorCode).toBe('device_offline');
  });

  it('transfers control only after owner approval', async () => {
    const { jar, deviceId, credential } = await setup();
    const worker = connectWorker(deviceId, credential);
    await once(worker, 'worker:connected');

    const controller = connectRemote(jar, deviceId);
    await once(controller, 'control:state');
    const viewer = connectRemote(jar, deviceId);
    await once(viewer, 'control:state');

    const requests = collect(controller, 'control:takeover-request');
    const viewerStates = collect(viewer, 'control:state');
    const controllerStates = collect(controller, 'control:state');
    viewer.emit('control:request');
    await expect.poll(() => requests.length).toBe(1);

    controller.emit('control:approve', { requestId: requests[0].requestId });
    await expect.poll(() => viewerStates.length).toBeGreaterThanOrEqual(1);
    expect(viewerStates.at(-1).role).toBe('controller');
    expect(controllerStates.at(-1).role).toBe('viewer');

    const workerCommands = collect(worker, 'control:command');
    viewer.emit('control:command', { commandId: randomUUID(), action: 'previous' });
    await expect.poll(() => workerCommands.length).toBe(1);
    expect(workerCommands[0].action).toBe('previous');
  });

  it('approves takeover from the cabinet over HTTP', async () => {
    const { jar, deviceId } = await setup();
    const controller = connectRemote(jar, deviceId);
    await once(controller, 'control:state');
    const viewer = connectRemote(jar, deviceId);
    await once(viewer, 'control:state');

    viewer.emit('control:request');
    await expect
      .poll(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/devices/${deviceId}/control/requests`,
          headers: { cookie: jar.header() },
        });
        return response.json().requests.length;
      })
      .toBe(1);
    const list = (
      await app.inject({
        method: 'GET',
        url: `/api/devices/${deviceId}/control/requests`,
        headers: { cookie: jar.header() },
      })
    ).json();

    const viewerStates = collect(viewer, 'control:state');
    const approve = await app.inject({
      method: 'POST',
      url: `/api/devices/${deviceId}/control/approve`,
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { requestId: list.requests[0].requestId },
    });
    expect(approve.statusCode).toBe(200);
    await expect.poll(() => viewerStates.length).toBeGreaterThanOrEqual(1);
    expect(viewerStates.at(-1).role).toBe('controller');
  });

  it('releases control when the controller disconnects', async () => {
    const { jar, deviceId } = await setup();
    const controller = connectRemote(jar, deviceId);
    await once(controller, 'control:state');
    const viewer = connectRemote(jar, deviceId);
    await once(viewer, 'control:state');

    const released = once(viewer, 'control:released');
    controller.disconnect();
    await released;

    const states = collect(viewer, 'control:state');
    viewer.emit('control:request');
    await expect.poll(() => states.length).toBeGreaterThanOrEqual(1);
    expect(states.at(-1).role).toBe('controller');
  });

  it('limits remotes per device to five', async () => {
    const { jar, deviceId } = await setup();
    for (let i = 0; i < 5; i += 1) {
      const remote = connectRemote(jar, deviceId);
      await once(remote, 'control:state');
    }
    const sixth = connectRemote(jar, deviceId);
    await expect(once(sixth, 'control:state')).rejects.toThrow('remote_limit_reached');
  });
});

describe('timer', () => {
  it('persists endAt, broadcasts to remotes and survives reconnect', async () => {
    const { jar, deviceId } = await setup();
    const first = connectRemote(jar, deviceId);
    await once(first, 'control:state');
    const second = connectRemote(jar, deviceId);
    await once(second, 'control:state');

    const firstTimers = collect(first, 'timer:state');
    const secondTimers = collect(second, 'timer:state');
    const endAt = Date.now() + 5 * 60000;
    first.emit('timer:set', { endAt });
    await expect.poll(() => firstTimers.length).toBeGreaterThanOrEqual(1);
    expect(firstTimers.at(-1).endAt).toBe(endAt);
    await expect.poll(() => secondTimers.length).toBeGreaterThanOrEqual(1);
    expect(secondTimers.at(-1).endAt).toBe(endAt);

    const httpTimer = (
      await app.inject({
        method: 'GET',
        url: `/api/devices/${deviceId}/timer`,
        headers: { cookie: jar.header() },
      })
    ).json();
    expect(httpTimer.endAt).toBe(endAt);

    const third = connectRemote(jar, deviceId);
    await once(third, 'control:state');
    const thirdTimer = await once(third, 'timer:state');
    expect(thirdTimer.endAt).toBe(endAt);

    first.emit('timer:set', { endAt: null });
    await expect.poll(() => firstTimers.at(-1).endAt).toBeNull();
  });

  it('timer zero does not block commands', async () => {
    const { jar, deviceId, credential } = await setup();
    const worker = connectWorker(deviceId, credential);
    await once(worker, 'worker:connected');
    const workerCommands = collect(worker, 'control:command');
    const remote = connectRemote(jar, deviceId);
    await once(remote, 'control:state');
    remote.emit('timer:set', { endAt: Date.now() - 1000 });
    remote.emit('control:command', { commandId: randomUUID(), action: 'next' });
    await expect.poll(() => workerCommands.length).toBe(1);
  });
});

describe('device status broadcasts', () => {
  it('notifies remotes when the worker connects and disconnects', async () => {
    const { jar, deviceId, credential } = await setup();
    const remote = connectRemote(jar, deviceId);
    await once(remote, 'control:state');
    const statuses = collect(remote, 'device:status');

    const worker = connectWorker(deviceId, credential);
    await once(worker, 'worker:connected');
    await expect.poll(() => statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses.at(-1).online).toBe(true);

    worker.disconnect();
    await expect.poll(() => statuses.at(-1).online).toBe(false);
  });
});
