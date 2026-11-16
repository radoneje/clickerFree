import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { auditEvents, workerReleases, type Db } from '@clickerfree/db';
import { releaseUpsertSchema } from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';
import { requireAdmin } from '../admin/guard.js';

function allowedHosts(config: ApiConfig): string[] {
  return config.ALLOWED_DOWNLOAD_HOSTS.split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

export function registerReleaseAdminRoutes(
  app: FastifyInstance,
  { config, db }: { config: ApiConfig; db: Db },
): void {
  app.get('/api/admin/releases', async (request, reply) => {
    if (!(await requireAdmin(request, reply, db))) return;
    const rows = await db.select().from(workerReleases).orderBy(desc(workerReleases.createdAt));
    return { releases: rows };
  });

  app.post('/api/admin/releases', async (request, reply) => {
    const auth = await requireAdmin(request, reply, db);
    if (!auth) return;
    const parsed = releaseUpsertSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'body' });
    const host = new URL(parsed.data.downloadUrl).hostname;
    if (!allowedHosts(config).includes(host)) {
      return sendError(reply, 400, 'validation_failed', { field: 'downloadUrl' });
    }
    const [row] = await db
      .insert(workerReleases)
      .values(parsed.data)
      .onConflictDoUpdate({
        target: [workerReleases.os, workerReleases.arch, workerReleases.version],
        set: { ...parsed.data },
      })
      .returning();
    await db.insert(auditEvents).values({
      actorUserId: auth.userId,
      action: 'release_upsert',
      target: row?.id ?? null,
      details: { version: parsed.data.version, os: parsed.data.os, arch: parsed.data.arch },
    });
    return row;
  });

  app.post('/api/admin/releases/:id/publish', async (request, reply) => {
    const auth = await requireAdmin(request, reply, db);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const [row] = await db
      .update(workerReleases)
      .set({ isAvailable: true, publishedAt: new Date() })
      .where(eq(workerReleases.id, id))
      .returning();
    if (!row) return sendError(reply, 404, 'not_found', {});
    await db.insert(auditEvents).values({
      actorUserId: auth.userId,
      action: 'release_publish',
      target: id,
      details: { version: row.version, minSupportedVersion: row.minSupportedVersion },
    });
    return row;
  });

  app.post('/api/admin/releases/:id/unpublish', async (request, reply) => {
    const auth = await requireAdmin(request, reply, db);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const [row] = await db
      .update(workerReleases)
      .set({ isAvailable: false })
      .where(eq(workerReleases.id, id))
      .returning();
    if (!row) return sendError(reply, 404, 'not_found', {});
    await db.insert(auditEvents).values({
      actorUserId: auth.userId,
      action: 'release_unpublish',
      target: id,
      details: { version: row.version },
    });
    return row;
  });
}
