import { randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { deviceCredentials, devices, pairingRequests, type Db } from '@clickerfree/db';
import { pairingCodeRequestSchema, pairingConfirmSchema } from '@clickerfree/contracts';
import { sendError } from '../errors.js';
import { takeRateLimit } from '../rate-limit.js';
import { hashToken } from '../auth/sessions.js';
import { storePendingCredential, takePendingCredential } from '../realtime/registry.js';

// Алфавит без неоднозначных символов (I, L, O, 0, 1).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_SECONDS = 300;
const MAX_CODE_ATTEMPTS = 10;
const MAX_DEVICES_PER_USER = 10;

function generateCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

function workerSecret(request: { headers: Record<string, unknown> }): string | null {
  const value = request.headers['x-worker-secret'];
  return typeof value === 'string' && value.length >= 32 ? value : null;
}

export function registerPairingRoutes(app: FastifyInstance, { db }: { db: Db }): void {
  app.post('/api/pairing/code', async (request, reply) => {
    const secret = workerSecret(request);
    if (!secret) return sendError(reply, 400, 'validation_failed', { field: 'x-worker-secret' });
    const parsed = pairingCodeRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'body' });

    const limits: Array<[string, number]> = [
      [`pairing_code:install:${parsed.data.installId}`, 5],
      [`pairing_code:ip:${request.ip}`, 100],
    ];
    for (const [key, limit] of limits) {
      let result;
      try {
        result = await takeRateLimit(db, key, limit, 3600);
      } catch {
        return sendError(reply, 503, 'service_unavailable', {});
      }
      if (!result.allowed) {
        reply.header('Retry-After', String(result.retryAfterSeconds));
        return sendError(reply, 429, 'rate_limited', {
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    await db.insert(pairingRequests).values({
      installId: parsed.data.installId,
      codeHash: hashToken(code),
      workerSecretHash: hashToken(secret),
      name: parsed.data.name,
      os: parsed.data.os,
      arch: parsed.data.arch,
      appVersion: parsed.data.appVersion,
      protocolVersion: parsed.data.protocolVersion,
      expiresAt,
    });
    return { code, expiresAt: expiresAt.getTime() };
  });

  app.get('/api/pairing/result', async (request, reply) => {
    const secret = workerSecret(request);
    const query = request.query as { installId?: string };
    if (!secret || !query.installId) {
      return sendError(reply, 400, 'validation_failed', { field: 'installId' });
    }
    const rows = await db
      .select()
      .from(pairingRequests)
      .where(eq(pairingRequests.installId, query.installId))
      .orderBy(desc(pairingRequests.createdAt))
      .limit(1);
    const pairing = rows[0];
    if (!pairing) return sendError(reply, 404, 'not_found', {});
    if (pairing.workerSecretHash !== hashToken(secret)) {
      return sendError(reply, 403, 'pairing_secret_invalid', {});
    }
    if (!pairing.consumedAt) {
      if (pairing.expiresAt.getTime() < Date.now()) return { status: 'expired' };
      return { status: 'pending' };
    }
    // Ключ выдаётся воркеру один раз; после перезапуска API до выдачи — повторная привязка.
    const pending = takePendingCredential(pairing.id);
    if (!pending) return { status: 'expired' };
    return { status: 'confirmed', deviceId: pending.deviceId, credential: pending.credential };
  });

  app.post('/api/pairing/confirm', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return sendError(reply, 401, 'unauthorized', {});
    const parsed = pairingConfirmSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'code' });

    let limitResult;
    try {
      limitResult = await takeRateLimit(db, `pairing_confirm:user:${auth.userId}`, 5, 600);
    } catch {
      return sendError(reply, 503, 'service_unavailable', {});
    }
    if (!limitResult.allowed) {
      reply.header('Retry-After', String(limitResult.retryAfterSeconds));
      return sendError(reply, 429, 'rate_limited', {
        retryAfterSeconds: limitResult.retryAfterSeconds,
      });
    }

    const codeHash = hashToken(parsed.data.code.toUpperCase());
    const rows = await db
      .select()
      .from(pairingRequests)
      .where(eq(pairingRequests.codeHash, codeHash))
      .orderBy(desc(pairingRequests.createdAt))
      .limit(1);
    const pairing = rows[0];
    if (!pairing || pairing.consumedAt || pairing.expiresAt.getTime() < Date.now()) {
      return sendError(reply, 400, 'pairing_code_invalid', {});
    }
    if (pairing.attempts >= MAX_CODE_ATTEMPTS) {
      await db
        .update(pairingRequests)
        .set({ consumedAt: new Date() })
        .where(eq(pairingRequests.id, pairing.id));
      return sendError(reply, 400, 'pairing_code_exhausted', {});
    }
    await db
      .update(pairingRequests)
      .set({ attempts: pairing.attempts + 1 })
      .where(eq(pairingRequests.id, pairing.id));

    const owned = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, auth.userId), isNull(devices.revokedAt)));
    const existing = await db
      .select()
      .from(devices)
      .where(eq(devices.installId, pairing.installId))
      .limit(1);
    const sameDevice = existing[0];
    if (sameDevice && sameDevice.userId !== auth.userId) {
      return sendError(reply, 403, 'forbidden', {});
    }
    if (!sameDevice && owned.length >= MAX_DEVICES_PER_USER) {
      return sendError(reply, 400, 'device_limit_reached', { limit: MAX_DEVICES_PER_USER });
    }

    const credential = randomBytes(32).toString('base64url');
    const credentialHash = hashToken(credential);

    const deviceId = await db.transaction(async (tx) => {
      let id: string;
      if (sameDevice) {
        // Повторная привязка того же компьютера: устройство сохраняется, ключ ротируется.
        await tx
          .update(deviceCredentials)
          .set({ revokedAt: new Date() })
          .where(
            and(eq(deviceCredentials.deviceId, sameDevice.id), isNull(deviceCredentials.revokedAt)),
          );
        await tx
          .update(devices)
          .set({
            revokedAt: null,
            name: pairing.name,
            os: pairing.os,
            arch: pairing.arch,
            appVersion: pairing.appVersion,
            protocolVersion: pairing.protocolVersion,
            updatedAt: new Date(),
          })
          .where(eq(devices.id, sameDevice.id));
        id = sameDevice.id;
      } else {
        const [created] = await tx
          .insert(devices)
          .values({
            userId: auth.userId,
            installId: pairing.installId,
            name: pairing.name,
            os: pairing.os,
            arch: pairing.arch,
            appVersion: pairing.appVersion,
            protocolVersion: pairing.protocolVersion,
          })
          .returning({ id: devices.id });
        if (!created) throw new Error('device insert returned no row');
        id = created.id;
      }
      await tx.insert(deviceCredentials).values({ deviceId: id, credentialHash });
      await tx
        .update(pairingRequests)
        .set({ consumedAt: new Date() })
        .where(eq(pairingRequests.id, pairing.id));
      return id;
    });

    storePendingCredential(pairing.id, { deviceId, credential });
    return { status: 'ok', deviceId };
  });
}
