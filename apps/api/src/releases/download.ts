import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { downloadEvents, usageEvents, workerReleases, type Db } from '@clickerfree/db';
import { firstRunSchema, workerArchSchema, workerOsSchema } from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';
import { takeRateLimit } from '../rate-limit.js';
import { hashToken } from '../auth/sessions.js';

export function registerDownloadRoutes(
  app: FastifyInstance,
  { db }: { config: ApiConfig; db: Db },
): void {
  // Учитываемый запрос ссылки: редирект на файл релиза, событие создаётся один раз.
  app.get('/api/download/:os/:arch', async (request, reply) => {
    const params = request.params as { os: string; arch: string };
    const os = workerOsSchema.safeParse(params.os);
    const arch = workerArchSchema.safeParse(params.arch);
    if (!os.success || !arch.success) {
      return sendError(reply, 400, 'validation_failed', { field: 'os/arch' });
    }
    const limits: Array<[string, number]> = [
      [`download:browser:${request.browserId}`, 10],
      [`download:ip:${request.ip}`, 300],
    ];
    for (const [key, limit] of limits) {
      let result;
      try {
        result = await takeRateLimit(db, key, limit, 600);
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
    const rows = await db
      .select()
      .from(workerReleases)
      .where(
        and(
          eq(workerReleases.os, os.data),
          eq(workerReleases.arch, arch.data),
          eq(workerReleases.isAvailable, true),
        ),
      )
      .orderBy(desc(workerReleases.publishedAt))
      .limit(1);
    const release = rows[0];
    if (!release) return sendError(reply, 404, 'not_found', {});

    const query = request.query as { eventId?: string; installId?: string; appVersion?: string };
    const eventId =
      query.eventId && /^[0-9a-f-]{36}$/i.test(query.eventId) ? query.eventId : randomUUID();
    await db
      .insert(downloadEvents)
      .values({
        eventId,
        os: os.data,
        arch: arch.data,
        appVersion: query.appVersion ?? null,
        installId: query.installId ?? null,
        ipHash: hashToken(request.ip),
      })
      .onConflictDoNothing();
    return reply.redirect(release.downloadUrl, 302);
  });

  // Первый запуск установки: идемпотентно по eventId, не доказательство уникального человека.
  app.post('/api/worker/first-run', async (request, reply) => {
    const parsed = firstRunSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'body' });
    await db
      .insert(usageEvents)
      .values({
        eventId: parsed.data.eventId,
        kind: 'first_run',
        installId: parsed.data.installId,
        action: null,
        processingMs: null,
      })
      .onConflictDoNothing();
    return { status: 'ok' };
  });
}
