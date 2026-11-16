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
  // До публикации первого релиза ссылки и контрольные суммы отсутствуют.
  downloadUrl: z.url({ protocol: /^https$/ }).nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  descriptionKey: z.string().min(1).nullable(),
});
export type VersionCheckResponse = z.infer<typeof versionCheckResponseSchema>;

export const pairingCodeRequestSchema = z.object({
  installId: z.uuid(),
  name: z.string().min(1).max(64),
  os: workerOsSchema,
  arch: workerArchSchema,
  appVersion: z.string().min(1),
  protocolVersion: z.number().int().positive(),
});
export type PairingCodeRequest = z.infer<typeof pairingCodeRequestSchema>;

export const pairingCodeResponseSchema = z.object({
  code: z.string().length(8),
  expiresAt: z.number().int(),
});
export type PairingCodeResponse = z.infer<typeof pairingCodeResponseSchema>;

export const pairingConfirmSchema = z.object({
  code: z.string().length(8),
});
export type PairingConfirm = z.infer<typeof pairingConfirmSchema>;

export const pairingResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('confirmed'),
    deviceId: z.uuid(),
    credential: z.string().min(1),
  }),
  z.object({ status: z.literal('expired') }),
]);
export type PairingResult = z.infer<typeof pairingResultSchema>;

export const deviceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  os: workerOsSchema,
  arch: workerArchSchema,
  appVersion: z.string(),
  protocolVersion: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
  online: z.boolean(),
});
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;

export const timerStateSchema = z.object({
  endAt: z.number().int().nullable(),
  serverTime: z.number().int(),
});
export type TimerState = z.infer<typeof timerStateSchema>;

export const socketEvents = {
  controlCommand: 'control:command',
  controlAck: 'control:ack',
  controlState: 'control:state',
  controlRequest: 'control:request',
  controlApprove: 'control:approve',
  controlDeny: 'control:deny',
  controlReleased: 'control:released',
  takeoverRequest: 'control:takeover-request',
  timerState: 'timer:state',
  timerSet: 'timer:set',
  deviceStatus: 'device:status',
  workerConnected: 'worker:connected',
} as const;

export const remoteCommandSchema = z.object({
  commandId: z.uuid(),
  action: commandActionSchema,
});
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;

export const controlStateSchema = z.object({
  role: z.enum(['controller', 'viewer']),
  controlSessionId: z.uuid().nullable(),
  deviceOnline: z.boolean(),
});
export type ControlState = z.infer<typeof controlStateSchema>;

export const timerSetSchema = z.object({
  endAt: z.number().int().nullable(),
});
export type TimerSet = z.infer<typeof timerSetSchema>;

export const takeoverDecisionSchema = z.object({
  requestId: z.uuid(),
});
export type TakeoverDecision = z.infer<typeof takeoverDecisionSchema>;
