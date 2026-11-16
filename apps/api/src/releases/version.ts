import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { workerReleases, type Db } from '@clickerfree/db';
import {
  PROTOCOL_VERSION,
  versionCheckRequestSchema,
  type VersionCheckResponse,
} from '@clickerfree/contracts';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';

export async function latestRelease(db: Db, os: 'windows' | 'macos', arch: 'x64' | 'arm64') {
  const rows = await db
    .select()
    .from(workerReleases)
    .where(
      and(
        eq(workerReleases.os, os),
        eq(workerReleases.arch, arch),
        eq(workerReleases.isAvailable, true),
      ),
    )
    .orderBy(desc(workerReleases.publishedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function minSupportedVersion(
  db: Db,
  os: 'windows' | 'macos',
  arch: 'x64' | 'arm64',
): Promise<string> {
  const release = await latestRelease(db, os, arch);
  return release?.minSupportedVersion ?? '0.0.0';
}

export function registerVersionRoute(app: FastifyInstance, { db }: { config: ApiConfig; db: Db }) {
  app.get('/api/worker/version', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const parsed = versionCheckRequestSchema.safeParse({
      os: query.os,
      arch: query.arch,
      appVersion: query.appVersion,
      protocolVersion: Number(query.protocolVersion),
    });
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'query' });

    const release = await latestRelease(db, parsed.data.os, parsed.data.arch);
    const response: VersionCheckResponse = {
      latestVersion: release?.version ?? parsed.data.appVersion,
      minSupportedVersion: release?.minSupportedVersion ?? '0.0.0',
      protocolVersion: PROTOCOL_VERSION,
      downloadUrl: release?.downloadUrl ?? null,
      manifestUrl: release?.manifestUrl ?? null,
      sha256: release?.sha256 ?? null,
      descriptionKey: release?.descriptionKey ?? null,
    };
    return response;
  });
}
