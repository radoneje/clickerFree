import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { devices, invitations, type Db } from '@clickerfree/db';
import { invitationCreateSchema, invitationExchangeSchema } from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';
import { takeRateLimit } from '../rate-limit.js';
import { hashToken } from '../auth/sessions.js';
import { INVITATION_COOKIE } from '../auth/cookies.js';
import {
  createInvitationSession,
  findInvitationSession,
  revokeInvitationSessions,
} from './sessions.js';

const MAX_ACTIVE_PER_DEVICE = 10;

// Длинный GUID-токен: два UUIDv4 без дефисов, 244 бита энтропии.
function generateToken(): string {
  return (randomUUID() + randomUUID()).replace(/-/g, '');
}

export function disconnectInvitationSockets(io: Server, invitationId: string): void {
  for (const [, socket] of io.of('/remote').sockets) {
    if (socket.data.invitationId === invitationId) socket.disconnect(true);
  }
}

export function registerInvitationRoutes(
  app: FastifyInstance,
  { config, db, io }: { config: ApiConfig; db: Db; io: Server },
): void {
  async function ownedDevice(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ deviceId: string; userId: string } | null> {
    const auth = request.auth;
    if (!auth) {
      sendError(reply, 401, 'unauthorized', {});
      return null;
    }
    const { id } = request.params as { id: string };
    const rows = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, auth.userId), isNull(devices.revokedAt)))
      .limit(1);
    if (!rows[0]) {
      sendError(reply, 404, 'not_found', {});
      return null;
    }
    return { deviceId: id, userId: auth.userId };
  }

  app.post('/api/devices/:id/invitations', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    let limitResult;
    try {
      limitResult = await takeRateLimit(db, `invitations:user:${owned.userId}`, 20, 3600);
    } catch {
      return sendError(reply, 503, 'service_unavailable', {});
    }
    if (!limitResult.allowed) {
      reply.header('Retry-After', String(limitResult.retryAfterSeconds));
      return sendError(reply, 429, 'rate_limited', {
        retryAfterSeconds: limitResult.retryAfterSeconds,
      });
    }
    const parsed = invitationCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'body' });

    const active = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.deviceId, owned.deviceId),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    if (active.length >= MAX_ACTIVE_PER_DEVICE) {
      return sendError(reply, 400, 'invitation_limit_reached', { limit: MAX_ACTIVE_PER_DEVICE });
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + parsed.data.hours * 3600000);
    const [created] = await db
      .insert(invitations)
      .values({
        deviceId: owned.deviceId,
        createdBy: owned.userId,
        tokenHash: hashToken(token),
        lang: parsed.data.lang,
        expiresAt,
      })
      .returning({ id: invitations.id });
    if (!created) throw new Error('invitation insert returned no row');
    return {
      id: created.id,
      token,
      url: `${config.APP_BASE_URL}/${parsed.data.lang}/i?token=${token}`,
      expiresAt: expiresAt.getTime(),
    };
  });

  app.get('/api/devices/:id/invitations', async (request, reply) => {
    const owned = await ownedDevice(request, reply);
    if (!owned) return;
    const rows = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.deviceId, owned.deviceId),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    return {
      invitations: rows.map((row) => ({
        id: row.id,
        lang: row.lang,
        expiresAt: row.expiresAt.getTime(),
        createdAt: row.createdAt.getTime(),
      })),
    };
  });

  app.delete('/api/invitations/:id', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return sendError(reply, 401, 'unauthorized', {});
    const { id } = request.params as { id: string };
    const rows = await db
      .select({ invitationId: invitations.id, deviceId: devices.id })
      .from(invitations)
      .innerJoin(devices, eq(invitations.deviceId, devices.id))
      .where(and(eq(invitations.id, id), eq(devices.userId, auth.userId)))
      .limit(1);
    if (!rows[0]) return sendError(reply, 404, 'not_found', {});
    await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id));
    await revokeInvitationSessions(db, id);
    disconnectInvitationSockets(io, id);
    return { status: 'ok' };
  });

  // Обмен токена на сессию спикера. Открытие страницы ссылки сессию не создаёт.
  app.post('/api/invitations/exchange', async (request, reply) => {
    let limitResult;
    try {
      limitResult = await takeRateLimit(db, `inv_exchange:ip:${request.ip}`, 100, 900);
    } catch {
      return sendError(reply, 503, 'service_unavailable', {});
    }
    if (!limitResult.allowed) {
      reply.header('Retry-After', String(limitResult.retryAfterSeconds));
      return sendError(reply, 429, 'rate_limited', {
        retryAfterSeconds: limitResult.retryAfterSeconds,
      });
    }
    const parsed = invitationExchangeSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'token' });
    const rows = await db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(parsed.data.token)))
      .limit(1);
    const invitation = rows[0];
    if (!invitation) return sendError(reply, 400, 'invitation_invalid', {});
    if (invitation.revokedAt) return sendError(reply, 400, 'invitation_revoked', {});
    if (invitation.expiresAt.getTime() < Date.now()) {
      return sendError(reply, 400, 'invitation_expired', {});
    }
    const token = await createInvitationSession(db, invitation.id, invitation.expiresAt);
    reply.setCookie(INVITATION_COOKIE, token, {
      path: '/',
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: Math.max(1, Math.floor((invitation.expiresAt.getTime() - Date.now()) / 1000)),
    });
    return {
      deviceId: invitation.deviceId,
      lang: invitation.lang,
      expiresAt: invitation.expiresAt.getTime(),
    };
  });

  app.get('/api/invitations/session', async (request, reply) => {
    const token = request.cookies[INVITATION_COOKIE];
    const session = token ? await findInvitationSession(db, token) : null;
    if (!session) return sendError(reply, 401, 'unauthorized', {});
    return { deviceId: session.deviceId, lang: session.lang, expiresAt: session.expiresAt };
  });
}
