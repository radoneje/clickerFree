import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@clickerfree/db';
import { sendError } from '../errors.js';
import type { SessionAuth } from '../auth/sessions.js';

// Единственный процесс API: подтверждения TOTP живут в памяти сессии.
const verifiedAt = new Map<string, number>();
const SESSION_MAX_AGE_MS = 12 * 3600000;
const FRESH_MAX_AGE_MS = 5 * 60000;

export function markTotpVerified(sessionId: string): void {
  verifiedAt.set(sessionId, Date.now());
}

export function totpVerifiedWithin(sessionId: string, maxAgeMs: number): boolean {
  const at = verifiedAt.get(sessionId);
  return at !== undefined && Date.now() - at <= maxAgeMs;
}

export function totpSessionVerified(sessionId: string): boolean {
  return totpVerifiedWithin(sessionId, SESSION_MAX_AGE_MS);
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  _db: Db,
  opts: { fresh?: boolean } = {},
): Promise<SessionAuth | null> {
  const auth = request.auth;
  if (!auth) {
    sendError(reply, 401, 'unauthorized', {});
    return null;
  }
  if (auth.role !== 'admin') {
    sendError(reply, 403, 'forbidden', {});
    return null;
  }
  if (auth.totpEnabled) {
    const maxAge = opts.fresh ? FRESH_MAX_AGE_MS : SESSION_MAX_AGE_MS;
    if (!totpVerifiedWithin(auth.sessionId, maxAge)) {
      sendError(reply, 403, 'totp_required', {});
      return null;
    }
  }
  return auth;
}

export function requireAdminRole(request: FastifyRequest, reply: FastifyReply): SessionAuth | null {
  const auth = request.auth;
  if (!auth) {
    sendError(reply, 401, 'unauthorized', {});
    return null;
  }
  if (auth.role !== 'admin') {
    sendError(reply, 403, 'forbidden', {});
    return null;
  }
  return auth;
}
