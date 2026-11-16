import { z } from 'zod';

// Стабильные коды ошибок. Сервер передаёт код и параметры, клиент выбирает перевод.
// Ключ перевода: errors.<code>. Параметры обязаны совпадать со словарями ru/en.
export const errorCatalog = {
  internal_error: [],
  service_unavailable: [],
  validation_failed: ['field'],
  payload_too_large: ['limitBytes'],
  rate_limited: ['retryAfterSeconds'],
  origin_forbidden: [],
  csrf_invalid: [],
  unauthorized: [],
  forbidden: [],
  not_found: [],
  session_revoked: [],
  oauth_state_invalid: [],
  oauth_provider_error: ['provider'],
  pairing_code_invalid: [],
  pairing_code_expired: [],
  pairing_code_exhausted: [],
  pairing_secret_invalid: [],
  device_limit_reached: ['limit'],
  device_revoked: [],
  device_already_connected: [],
  connection_superseded: [],
  invitation_invalid: [],
  invitation_expired: [],
  invitation_revoked: [],
  invitation_password_invalid: [],
  invitation_password_locked: ['retryAfterSeconds'],
  invitation_limit_reached: ['limit'],
  remote_limit_reached: ['limit'],
  control_session_required: [],
  control_takeover_required: [],
  command_rate_limited: [],
  command_expired: [],
  command_duplicate: [],
  worker_version_unsupported: ['minSupportedVersion'],
  version_check_unavailable: [],
} as const satisfies Record<string, readonly string[]>;

export type ErrorCode = keyof typeof errorCatalog;

export const errorCodes = Object.keys(errorCatalog) as [ErrorCode, ...ErrorCode[]];

type ParamName<C extends ErrorCode> = (typeof errorCatalog)[C][number];

export type ErrorParams<C extends ErrorCode> = {
  [K in ParamName<C>]: string | number;
};

export type ApiError = {
  [C in ErrorCode]: { code: C; params: ErrorParams<C> };
}[ErrorCode];

export const apiErrorSchema = z.object({
  code: z.enum(errorCodes),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

export function missingErrorParams(code: ErrorCode, params: Record<string, unknown>): string[] {
  return errorCatalog[code].filter((name) => !(name in params));
}
