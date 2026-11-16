import type { FastifyInstance } from 'fastify';
import { and, eq, gte, lte } from 'drizzle-orm';
import { auditEvents, dailyMetrics, users, type Db } from '@clickerfree/db';
import { z } from 'zod';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../auth/totp.js';
import { markTotpVerified, requireAdmin, requireAdminRole, totpSessionVerified } from './guard.js';

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const roleSchema = z.object({ role: z.enum(['user', 'admin']) });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(
  query: Record<string, string | undefined>,
): { from: string; to: string } | null {
  const today = new Date().toISOString().slice(0, 10);
  const to = query.to ?? today;
  const from = query.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to) || from > to) return null;
  return { from, to };
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  { db }: { config: ApiConfig; db: Db },
): void {
  app.get('/api/admin/totp/status', async (request, reply) => {
    const auth = requireAdminRole(request, reply);
    if (!auth) return;
    return { enabled: auth.totpEnabled, verified: totpSessionVerified(auth.sessionId) };
  });

  app.post('/api/admin/totp/setup', async (request, reply) => {
    const auth = requireAdminRole(request, reply);
    if (!auth) return;
    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ totpSecret: secret, totpEnabled: false })
      .where(eq(users.id, auth.userId));
    return { secret, otpauthUrl: otpauthUrl(secret, auth.userId) };
  });

  app.post('/api/admin/totp/verify', async (request, reply) => {
    const auth = requireAdminRole(request, reply);
    if (!auth) return;
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'code' });
    const rows = await db
      .select({ secret: users.totpSecret })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    const secret = rows[0]?.secret;
    if (!secret) return sendError(reply, 400, 'validation_failed', { field: 'code' });
    if (!verifyTotp(secret, parsed.data.code)) return sendError(reply, 403, 'totp_invalid', {});
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, auth.userId));
    markTotpVerified(auth.sessionId);
    await db.insert(auditEvents).values({
      actorUserId: auth.userId,
      action: 'totp_enabled',
      target: auth.userId,
    });
    return { status: 'ok' };
  });

  app.post('/api/admin/totp/authenticate', async (request, reply) => {
    const auth = requireAdminRole(request, reply);
    if (!auth) return;
    if (!auth.totpEnabled) return sendError(reply, 400, 'validation_failed', { field: 'code' });
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'code' });
    const rows = await db
      .select({ secret: users.totpSecret })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    const secret = rows[0]?.secret;
    if (!secret || !verifyTotp(secret, parsed.data.code)) {
      return sendError(reply, 403, 'totp_invalid', {});
    }
    markTotpVerified(auth.sessionId);
    return { status: 'ok' };
  });

  app.get('/api/admin/stats', async (request, reply) => {
    if (!(await requireAdmin(request, reply, db))) return;
    const range = parseRange(request.query as Record<string, string | undefined>);
    if (!range) return sendError(reply, 400, 'validation_failed', { field: 'from/to' });
    const rows = await db
      .select()
      .from(dailyMetrics)
      .where(and(gte(dailyMetrics.day, range.from), lte(dailyMetrics.day, range.to)))
      .orderBy(dailyMetrics.day, dailyMetrics.metric, dailyMetrics.dimension);
    return { from: range.from, to: range.to, rows };
  });

  app.get('/api/admin/stats.csv', async (request, reply) => {
    if (!(await requireAdmin(request, reply, db))) return;
    const range = parseRange(request.query as Record<string, string | undefined>);
    if (!range) return sendError(reply, 400, 'validation_failed', { field: 'from/to' });
    const rows = await db
      .select()
      .from(dailyMetrics)
      .where(and(gte(dailyMetrics.day, range.from), lte(dailyMetrics.day, range.to)))
      .orderBy(dailyMetrics.day, dailyMetrics.metric, dailyMetrics.dimension);
    const lines = ['day,metric,dimension,value'];
    for (const row of rows) {
      lines.push([row.day, row.metric, row.dimension, row.value].map(csvField).join(','));
    }
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="clickerfree-stats.csv"')
      .send(lines.join('\n') + '\n');
  });

  app.get('/api/admin/users', async (request, reply) => {
    if (!(await requireAdmin(request, reply, db))) return;
    const rows = await db
      .select({
        id: users.id,
        role: users.role,
        totpEnabled: users.totpEnabled,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);
    return { users: rows };
  });

  app.post('/api/admin/users/:id/role', async (request, reply) => {
    const auth = await requireAdmin(request, reply, db, { fresh: true });
    if (!auth) return;
    const { id } = request.params as { id: string };
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'role' });
    const [row] = await db
      .update(users)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) return sendError(reply, 404, 'not_found', {});
    await db.insert(auditEvents).values({
      actorUserId: auth.userId,
      action: 'role_change',
      target: id,
      details: { role: parsed.data.role },
    });
    return { status: 'ok' };
  });
}
