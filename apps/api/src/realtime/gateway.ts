import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { deviceCredentials, devices, type Db } from '@clickerfree/db';
import {
  PROTOCOL_VERSION,
  commandAckSchema,
  isVersionSupported,
  socketEvents,
  workerAuthSchema,
} from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { takeRateLimit } from '../rate-limit.js';
import { hashToken } from '../auth/sessions.js';
import { minSupportedVersion } from '../releases/version.js';
import { registerConnection, removeConnection } from './registry.js';

export function attachRealtime(
  app: FastifyInstance,
  { config, db }: { config: ApiConfig; db: Db },
) {
  const io = new Server(app.server, {
    cors: { origin: false },
    // Разрешены Origin сервиса и самого API (воркер ходит напрямую в локальной
    // разработке); чужие Origin отклоняются. Отсутствие Origin допустимо:
    // воркер аутентифицируется ключом, не браузером.
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const proto = (request.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
      const ownOrigin = `${proto}://${request.headers.host}`;
      callback(null, !origin || origin === config.APP_BASE_URL || origin === ownOrigin);
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  const workerNamespace = io.of('/worker');

  workerNamespace.use(async (socket, next) => {
    const parsed = workerAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) return next(new Error('unauthorized'));
    const auth = parsed.data;

    const limits: Array<[string, number, number]> = [
      [`reconnect:device:${auth.deviceId}`, 10, 60],
      [`reconnect:ip:${socket.handshake.address}`, 300, 60],
    ];
    for (const [key, limit, window] of limits) {
      let result;
      try {
        result = await takeRateLimit(db, key, limit, window);
      } catch {
        return next(new Error('service_unavailable'));
      }
      if (!result.allowed) return next(new Error('rate_limited'));
    }

    const deviceRows = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, auth.deviceId), isNull(devices.revokedAt)))
      .limit(1);
    const device = deviceRows[0];
    if (!device) return next(new Error('device_revoked'));

    const credentialRows = await db
      .select({ id: deviceCredentials.id })
      .from(deviceCredentials)
      .where(
        and(
          eq(deviceCredentials.deviceId, device.id),
          eq(deviceCredentials.credentialHash, hashToken(auth.credential)),
          isNull(deviceCredentials.revokedAt),
        ),
      )
      .limit(1);
    if (credentialRows.length === 0) return next(new Error('unauthorized'));

    if (auth.protocolVersion !== PROTOCOL_VERSION) {
      return next(new Error('worker_version_unsupported'));
    }
    const minVersion = await minSupportedVersion(db, device.os, device.arch);
    if (!isVersionSupported(auth.appVersion, minVersion)) {
      return next(new Error('worker_version_unsupported'));
    }

    socket.data.deviceId = device.id;
    socket.data.appVersion = auth.appVersion;
    return next();
  });

  workerNamespace.on('connection', async (socket) => {
    const deviceId = socket.data.deviceId as string;
    const generation = registerConnection(deviceId, socket);
    await db
      .update(devices)
      .set({ lastSeenAt: new Date(), appVersion: socket.data.appVersion as string })
      .where(eq(devices.id, deviceId));
    socket.emit(socketEvents.workerConnected, { generation });

    socket.on(socketEvents.controlAck, (payload) => {
      const parsed = commandAckSchema.safeParse(payload);
      if (!parsed.success) return;
      // Маршрутизация подтверждений в управляющий сеанс появится на этапе 5.
    });

    socket.on('disconnect', async () => {
      removeConnection(deviceId, socket.id);
      await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, deviceId));
    });
  });

  app.addHook('onClose', async () => {
    await io.close();
  });

  return io;
}
