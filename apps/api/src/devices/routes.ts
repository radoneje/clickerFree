import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { deviceCredentials, devices, type Db } from '@clickerfree/db';
import { z } from 'zod';
import { sendError } from '../errors.js';
import { disconnectDevice, isOnline } from '../realtime/registry.js';

const renameSchema = z.object({ name: z.string().trim().min(1).max(64) });

export function registerDeviceRoutes(app: FastifyInstance, { db }: { db: Db }): void {
  app.get('/api/devices', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return sendError(reply, 401, 'unauthorized', {});
    const rows = await db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, auth.userId), isNull(devices.revokedAt)));
    return {
      devices: rows.map((device) => ({
        id: device.id,
        name: device.name,
        os: device.os,
        arch: device.arch,
        appVersion: device.appVersion,
        protocolVersion: device.protocolVersion,
        lastSeenAt: device.lastSeenAt ? device.lastSeenAt.getTime() : null,
        online: isOnline(device.id),
      })),
    };
  });

  app.patch('/api/devices/:id', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return sendError(reply, 401, 'unauthorized', {});
    const { id } = request.params as { id: string };
    const parsed = renameSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    const updated = await db
      .update(devices)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.userId, auth.userId), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    if (updated.length === 0) return sendError(reply, 404, 'not_found', {});
    return { status: 'ok' };
  });

  app.delete('/api/devices/:id', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return sendError(reply, 401, 'unauthorized', {});
    const { id } = request.params as { id: string };
    const revoked = await db
      .update(devices)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.userId, auth.userId), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    if (revoked.length === 0) return sendError(reply, 404, 'not_found', {});
    await db
      .update(deviceCredentials)
      .set({ revokedAt: new Date() })
      .where(and(eq(deviceCredentials.deviceId, id), isNull(deviceCredentials.revokedAt)));
    // Отзыв действует сразу: активное соединение воркера разрывается.
    disconnectDevice(id);
    return { status: 'ok' };
  });
}
