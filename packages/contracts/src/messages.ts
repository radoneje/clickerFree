import { z } from 'zod';
import { errorCodes } from './errors.js';

export const commandActionSchema = z.enum(['previous', 'next']);
export type CommandAction = z.infer<typeof commandActionSchema>;

export const commandSchema = z.object({
  commandId: z.uuid(),
  action: commandActionSchema,
  controlSessionId: z.uuid(),
});
export type Command = z.infer<typeof commandSchema>;

// Сервер назначает срок действия (TTL 2 секунды) при пересылке воркеру.
export const workerCommandSchema = commandSchema.extend({
  expiresAt: z.number().int(),
});
export type WorkerCommand = z.infer<typeof workerCommandSchema>;

export const commandAckSchema = z.object({
  commandId: z.uuid(),
  status: z.enum(['executed', 'rejected']),
  errorCode: z.enum(errorCodes).optional(),
});
export type CommandAck = z.infer<typeof commandAckSchema>;

export const workerOsSchema = z.enum(['windows', 'macos']);
export type WorkerOs = z.infer<typeof workerOsSchema>;

export const workerArchSchema = z.enum(['x64', 'arm64']);
export type WorkerArch = z.infer<typeof workerArchSchema>;

export const workerAuthSchema = z.object({
  deviceId: z.uuid(),
  credential: z.string().min(1),
  appVersion: z.string().min(1),
  os: workerOsSchema,
  arch: workerArchSchema,
  protocolVersion: z.number().int().positive(),
});
export type WorkerAuth = z.infer<typeof workerAuthSchema>;

export const versionCheckRequestSchema = workerAuthSchema.pick({
  os: true,
  arch: true,
  appVersion: true,
  protocolVersion: true,
});
export type VersionCheckRequest = z.infer<typeof versionCheckRequestSchema>;

export const versionCheckResponseSchema = z.object({
  latestVersion: z.string().min(1),
  minSupportedVersion: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  downloadUrl: z.url({ protocol: /^https$/ }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  descriptionKey: z.string().min(1),
});
export type VersionCheckResponse = z.infer<typeof versionCheckResponseSchema>;

export const timerStateSchema = z.object({
  endAt: z.number().int().nullable(),
  serverTime: z.number().int(),
});
export type TimerState = z.infer<typeof timerStateSchema>;

export const socketEvents = {
  controlCommand: 'control:command',
  controlAck: 'control:ack',
  timerState: 'timer:state',
} as const;
