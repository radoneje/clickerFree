import type { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { and, eq, isNull } from 'drizzle-orm';
import { controlSessions, devices, type Db } from '@clickerfree/db';
import {
  remoteCommandSchema,
  socketEvents,
  takeoverDecisionSchema,
  timerSetSchema,
} from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { findSession } from '../auth/sessions.js';
import { INVITATION_COOKIE, SESSION_COOKIE } from '../auth/cookies.js';
import { findInvitationSession } from '../invitations/sessions.js';
import { endUsageSession, markUsageStarted, recordCommandEvent } from '../analytics/events.js';
import { getConnection, isOnline } from './registry.js';
import {
  addRemote,
  controllerForDevice,
  getRemote,
  removeRemote,
  remotesForDevice,
  takeCommandToken,
  trackAck,
} from '../control/state.js';
import {
  approveTakeover,
  denyTakeover,
  deviceOwner,
  deviceRoom,
  grantControl,
  readTimer,
  releaseControl,
  requestTakeover,
  setTimer,
} from '../control/service.js';

const MAX_REMOTES_PER_DEVICE = 5;
const COMMAND_TTL_MS = 2000;

export function registerRemoteNamespace(io: Server, { db }: { config: ApiConfig; db: Db }) {
  const namespace = io.of('/remote');

  namespace.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const handshakeAuth = socket.handshake.auth as {
        deviceId?: string;
        sessionToken?: string;
        invitationToken?: string;
      };
      // Браузер шлёт cookie; нативные клиенты могут передать токен в auth.
      const token = cookies[SESSION_COOKIE] ?? handshakeAuth.sessionToken;
      const userAuth = token ? await findSession(db, token) : null;
      const invitationToken = cookies[INVITATION_COOKIE] ?? handshakeAuth.invitationToken;
      const invitationAuth =
        !userAuth && invitationToken ? await findInvitationSession(db, invitationToken) : null;
      if (!userAuth && !invitationAuth) return next(new Error('unauthorized'));
      const deviceId = handshakeAuth.deviceId;
      if (typeof deviceId !== 'string') return next(new Error('validation_failed'));
      if (invitationAuth && invitationAuth.deviceId !== deviceId) {
        return next(new Error('forbidden'));
      }
      const rows = await db
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.id, deviceId),
            isNull(devices.revokedAt),
            ...(userAuth ? [eq(devices.userId, userAuth.userId)] : []),
          ),
        )
        .limit(1);
      if (!rows[0]) return next(new Error('forbidden'));
      if (remotesForDevice(deviceId).length >= MAX_REMOTES_PER_DEVICE) {
        return next(new Error('remote_limit_reached'));
      }
      socket.data.userId = userAuth?.userId ?? null;
      socket.data.invitationId = invitationAuth?.invitationId ?? null;
      socket.data.deviceId = deviceId;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  namespace.on('connection', async (socket) => {
    const deviceId = socket.data.deviceId as string;
    const userId = socket.data.userId as string | null;
    await socket.join(deviceRoom(deviceId));
    const remote = { socket, deviceId, userId, controlSessionId: null as string | null };
    addRemote(remote);

    socket.on(socketEvents.controlCommand, async (payload) => {
      const receivedAt = Date.now();
      const parsed = remoteCommandSchema.safeParse(payload);
      if (!parsed.success) return;
      const current = getRemote(socket.id);
      console.error('[remote-cmd] received', { socketId: socket.id, hasSession: Boolean(current?.controlSessionId), commandId: parsed.data.commandId });
      if (!current?.controlSessionId) {
        socket.emit(socketEvents.controlAck, {
          commandId: parsed.data.commandId,
          status: 'rejected',
          errorCode: 'control_session_required',
        });
        void recordCommandEvent(db, {
          deviceId,
          controlSessionId: 'none',
          commandId: parsed.data.commandId,
          action: parsed.data.action,
          processingMs: Date.now() - receivedAt,
          rejected: true,
          errorCode: 'control_session_required',
        });
        return;
      }
      if (!takeCommandToken(deviceId)) {
        socket.emit(socketEvents.controlAck, {
          commandId: parsed.data.commandId,
          status: 'rejected',
          errorCode: 'command_rate_limited',
        });
        void recordCommandEvent(db, {
          deviceId,
          controlSessionId: current.controlSessionId,
          commandId: parsed.data.commandId,
          action: parsed.data.action,
          processingMs: Date.now() - receivedAt,
          rejected: true,
          errorCode: 'command_rate_limited',
        });
        return;
      }
      const worker = getConnection(deviceId);
      if (!worker) {
        socket.emit(socketEvents.controlAck, {
          commandId: parsed.data.commandId,
          status: 'rejected',
          errorCode: 'device_offline',
        });
        void recordCommandEvent(db, {
          deviceId,
          controlSessionId: current.controlSessionId,
          commandId: parsed.data.commandId,
          action: parsed.data.action,
          processingMs: Date.now() - receivedAt,
          rejected: true,
          errorCode: 'device_offline',
        });
        return;
      }
      trackAck(parsed.data.commandId, socket.id);
      console.error('[remote-cmd] forwarding', { deviceId, workerPresent: Boolean(worker), controlSessionId: current.controlSessionId });
      worker.socket.emit(socketEvents.controlCommand, {
        commandId: parsed.data.commandId,
        action: parsed.data.action,
        controlSessionId: current.controlSessionId,
        expiresAt: Date.now() + COMMAND_TTL_MS,
      });
      await db
        .update(controlSessions)
        .set({ lastCommandAt: new Date() })
        .where(eq(controlSessions.id, current.controlSessionId));
      void markUsageStarted(db, current.controlSessionId);
      void recordCommandEvent(db, {
        deviceId,
        controlSessionId: current.controlSessionId,
        commandId: parsed.data.commandId,
        action: parsed.data.action,
        processingMs: Date.now() - receivedAt,
      });
    });

    socket.on(socketEvents.controlRequest, async () => {
      const current = getRemote(socket.id);
      if (!current) return;
      const owner = await deviceOwner(db, deviceId);
      if (!controllerForDevice(deviceId) && current.userId === owner) {
        await grantControl(db, io, deviceId, current);
        return;
      }
      if (owner) requestTakeover(io, deviceId, current, owner);
    });

    socket.on(socketEvents.controlApprove, async (payload) => {
      const parsed = takeoverDecisionSchema.safeParse(payload);
      if (!parsed.success || userId === null) return;
      await approveTakeover(db, io, parsed.data.requestId, userId);
    });

    socket.on(socketEvents.controlDeny, async (payload) => {
      const parsed = takeoverDecisionSchema.safeParse(payload);
      if (!parsed.success || userId === null) return;
      await denyTakeover(db, parsed.data.requestId, userId);
    });

    socket.on(socketEvents.timerSet, async (payload) => {
      const parsed = timerSetSchema.safeParse(payload);
      if (!parsed.success) return;
      const current = getRemote(socket.id);
      const owner = await deviceOwner(db, deviceId);
      // Спикер видит таймер, но не устанавливает его.
      if (!current || current.userId === null || current.userId !== owner) return;
      await setTimer(db, io, deviceId, parsed.data.endAt);
    });

    socket.on('disconnect', async () => {
      const current = getRemote(socket.id);
      removeRemote(socket.id);
      if (current?.controlSessionId) {
        void endUsageSession(db, current.controlSessionId);
        await releaseControl(db, io, deviceId);
      }
    });

    // Обработчики зарегистрированы до выдачи состояния: клиент может слать
    // команды сразу после получения control:state.
    if (!controllerForDevice(deviceId)) {
      await grantControl(db, io, deviceId, remote);
    } else {
      socket.emit(socketEvents.controlState, {
        role: 'viewer',
        controlSessionId: null,
        deviceOnline: isOnline(deviceId),
      });
    }
    socket.emit(socketEvents.timerState, await readTimer(db, deviceId));
  });

  return namespace;
}
