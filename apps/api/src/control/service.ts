import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { and, eq, isNull } from 'drizzle-orm';
import { controlSessions, devices, timers, type Db } from '@clickerfree/db';
import { socketEvents, type ControlState } from '@clickerfree/contracts';
import { isOnline } from '../realtime/registry.js';
import {
  addTakeover,
  getRemote,
  getTakeover,
  remotesForDevice,
  removeTakeover,
  type RemoteInfo,
} from './state.js';

export function deviceRoom(deviceId: string): string {
  return `device:${deviceId}`;
}

export async function readTimer(db: Db, deviceId: string) {
  const rows = await db.select().from(timers).where(eq(timers.deviceId, deviceId)).limit(1);
  const endAt = rows[0]?.endAt ? rows[0].endAt.getTime() : null;
  return { endAt, serverTime: Date.now() };
}

export async function setTimer(db: Db, io: Server, deviceId: string, endAt: number | null) {
  const value = endAt === null ? null : new Date(endAt);
  await db
    .insert(timers)
    .values({ deviceId, endAt: value })
    .onConflictDoUpdate({ target: timers.deviceId, set: { endAt: value, updatedAt: new Date() } });
  io.of('/remote')
    .to(deviceRoom(deviceId))
    .emit(socketEvents.timerState, { endAt, serverTime: Date.now() });
}

function emitState(remote: RemoteInfo): void {
  const state: ControlState = {
    role: remote.controlSessionId ? 'controller' : 'viewer',
    controlSessionId: remote.controlSessionId,
    deviceOnline: isOnline(remote.deviceId),
  };
  remote.socket.emit(socketEvents.controlState, state);
}

export async function grantControl(
  db: Db,
  io: Server,
  deviceId: string,
  target: RemoteInfo,
): Promise<string> {
  await db
    .update(controlSessions)
    .set({ endedAt: new Date() })
    .where(and(eq(controlSessions.deviceId, deviceId), isNull(controlSessions.endedAt)));
  const [session] = await db
    .insert(controlSessions)
    .values({ deviceId, isController: true })
    .returning({ id: controlSessions.id });
  if (!session) throw new Error('control session insert returned no row');
  for (const remote of remotesForDevice(deviceId)) {
    remote.controlSessionId = remote.socket.id === target.socket.id ? session.id : null;
    emitState(remote);
  }
  return session.id;
}

export async function releaseControl(db: Db, io: Server, deviceId: string): Promise<void> {
  await db
    .update(controlSessions)
    .set({ endedAt: new Date() })
    .where(and(eq(controlSessions.deviceId, deviceId), isNull(controlSessions.endedAt)));
  for (const remote of remotesForDevice(deviceId)) {
    remote.controlSessionId = null;
    emitState(remote);
  }
  io.of('/remote').to(deviceRoom(deviceId)).emit(socketEvents.controlReleased, {});
}

export async function deviceOwner(db: Db, deviceId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

export function requestTakeover(
  io: Server,
  deviceId: string,
  from: RemoteInfo,
  ownerUserId: string,
): string {
  const requestId = randomUUID();
  addTakeover({
    requestId,
    deviceId,
    fromSocketId: from.socket.id,
    fromUserId: from.userId,
    expiresAt: Date.now() + 60000,
  });
  for (const remote of remotesForDevice(deviceId)) {
    if (remote.userId === ownerUserId) {
      remote.socket.emit(socketEvents.takeoverRequest, { requestId });
    }
  }
  return requestId;
}

export async function approveTakeover(
  db: Db,
  io: Server,
  requestId: string,
  ownerUserId: string,
): Promise<boolean> {
  const request = getTakeover(requestId);
  if (!request) return false;
  const owner = await deviceOwner(db, request.deviceId);
  if (owner !== ownerUserId) return false;
  const target = getRemote(request.fromSocketId);
  removeTakeover(requestId);
  if (!target) return false;
  await grantControl(db, io, request.deviceId, target);
  return true;
}

export async function denyTakeover(
  db: Db,
  requestId: string,
  ownerUserId: string,
): Promise<boolean> {
  const request = getTakeover(requestId);
  if (!request) return false;
  const owner = await deviceOwner(db, request.deviceId);
  if (owner !== ownerUserId) return false;
  removeTakeover(requestId);
  return true;
}
