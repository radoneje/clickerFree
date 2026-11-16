import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { and, eq, isNull } from 'drizzle-orm';
import { devices, type Db } from '@clickerfree/db';
import { takeoverDecisionSchema, timerSetSchema } from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';
import { takeoversForDevice } from './state.js';
import { approveTakeover, denyTakeover, readTimer, setTimer } from './service.js';

export function registerControlRoutes(
  app: FastifyInstance,
  { config, db, io }: { config: ApiConfig; db: Db; io: Server },
): void {
  // Публичная конфигурация для браузера: адрес Socket.IO (пусто = тот же origin).
  app.get('/api/config', async () => ({ socketUrl: config.SOCKET_PUBLIC_URL }));

  async function ownedDevice(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ deviceId: string; userId: string } | null> {
    const auth = request.auth;
    if (!auth) {
      sendError(reply, 401, 'unauthorized', {});
      return null;
    }
    const { id } = request.params as { id: string };
    const rows = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, auth.userId), isNull(devices.revokedAt)))
      .limit(1);
    if (!rows[0]) {
      sendError(reply, 404, 'not_found', {});
      return null;
    }
    return { deviceId: id, userId: auth.userId };
  }

  app.get('/api/devices/:id/control/requests', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    return {
      requests: takeoversForDevice(owned.deviceId).map((request) => ({
        requestId: request.requestId,
        expiresAt: request.expiresAt,
      })),
    };
  });

  app.post('/api/devices/:id/control/approve', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    const parsed = takeoverDecisionSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'requestId' });
    const ok = await approveTakeover(db, io, parsed.data.requestId, owned.userId);
    if (!ok) return sendError(reply, 404, 'not_found', {});
    return { status: 'ok' };
  });

  app.post('/api/devices/:id/control/deny', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    const parsed = takeoverDecisionSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'requestId' });
    const ok = await denyTakeover(db, parsed.data.requestId, owned.userId);
    if (!ok) return sendError(reply, 404, 'not_found', {});
    return { status: 'ok' };
  });

  app.get('/api/devices/:id/timer', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    return readTimer(db, owned.deviceId);
  });

  app.post('/api/devices/:id/timer', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    const parsed = timerSetSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'endAt' });
    await setTimer(db, io, owned.deviceId, parsed.data.endAt);
    return { status: 'ok' };
  });
}
