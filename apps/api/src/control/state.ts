import type { Socket } from 'socket.io';

export interface RemoteInfo {
  socket: Socket;
  deviceId: string;
  userId: string | null;
  controlSessionId: string | null;
}

export interface TakeoverRequest {
  requestId: string;
  deviceId: string;
  fromSocketId: string;
  fromUserId: string | null;
  expiresAt: number;
}

// Единственный процесс API: пульты, токены команд и запросы передачи живут в памяти.
const remotes = new Map<string, RemoteInfo>();
const buckets = new Map<string, { tokens: number; last: number }>();
const takeovers = new Map<string, TakeoverRequest>();
const pendingAcks = new Map<string, string>();

const BUCKET_CAPACITY = 10;
const REFILL_PER_SECOND = 5;

export function addRemote(info: RemoteInfo): void {
  remotes.set(info.socket.id, info);
}

export function getRemote(socketId: string): RemoteInfo | undefined {
  return remotes.get(socketId);
}

export function removeRemote(socketId: string): void {
  remotes.delete(socketId);
  for (const [id, request] of takeovers) {
    if (request.fromSocketId === socketId) takeovers.delete(id);
  }
}

export function remotesForDevice(deviceId: string): RemoteInfo[] {
  return [...remotes.values()].filter((remote) => remote.deviceId === deviceId);
}

export function controllerForDevice(deviceId: string): RemoteInfo | undefined {
  return remotesForDevice(deviceId).find((remote) => remote.controlSessionId !== null);
}

// Токен-бакет: 5 команд/с, всплеск до 10; излишнее отбрасывается.
export function takeCommandToken(deviceId: string, now = Date.now()): boolean {
  const bucket = buckets.get(deviceId) ?? { tokens: BUCKET_CAPACITY, last: now };
  const elapsed = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsed * REFILL_PER_SECOND);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(deviceId, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(deviceId, bucket);
  return true;
}

export function addTakeover(request: TakeoverRequest): void {
  takeovers.set(request.requestId, request);
}

export function getTakeover(requestId: string): TakeoverRequest | undefined {
  const request = takeovers.get(requestId);
  if (!request) return undefined;
  if (request.expiresAt < Date.now()) {
    takeovers.delete(requestId);
    return undefined;
  }
  return request;
}

export function removeTakeover(requestId: string): void {
  takeovers.delete(requestId);
}

export function takeoversForDevice(deviceId: string): TakeoverRequest[] {
  const now = Date.now();
  return [...takeovers.values()].filter(
    (request) => request.deviceId === deviceId && request.expiresAt >= now,
  );
}

export function trackAck(commandId: string, socketId: string): void {
  pendingAcks.set(commandId, socketId);
}

export function takeAck(commandId: string): string | undefined {
  const socketId = pendingAcks.get(commandId);
  pendingAcks.delete(commandId);
  return socketId;
}
