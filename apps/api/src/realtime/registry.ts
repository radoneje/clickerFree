import type { Socket } from 'socket.io';

export interface WorkerConnection {
  socket: Socket;
  generation: number;
}

// Единственный процесс API: учёт соединений и выдача ключей живут в памяти.
const connections = new Map<string, WorkerConnection>();
const pendingCredentials = new Map<string, { deviceId: string; credential: string }>();
let generationCounter = 0;

export function registerConnection(deviceId: string, socket: Socket): number {
  generationCounter += 1;
  const previous = connections.get(deviceId);
  connections.set(deviceId, { socket, generation: generationCounter });
  if (previous && previous.socket.id !== socket.id) {
    previous.socket.disconnect(true);
  }
  return generationCounter;
}

export function removeConnection(deviceId: string, socketId: string): void {
  const current = connections.get(deviceId);
  if (current && current.socket.id === socketId) connections.delete(deviceId);
}

export function isOnline(deviceId: string): boolean {
  return connections.has(deviceId);
}

export function disconnectDevice(deviceId: string): void {
  const current = connections.get(deviceId);
  connections.delete(deviceId);
  current?.socket.disconnect(true);
}

export function storePendingCredential(
  pairingId: string,
  value: { deviceId: string; credential: string },
): void {
  pendingCredentials.set(pairingId, value);
}

export function takePendingCredential(
  pairingId: string,
): { deviceId: string; credential: string } | undefined {
  const value = pendingCredentials.get(pairingId);
  pendingCredentials.delete(pairingId);
  return value;
}
