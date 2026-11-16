import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import {
  createScratchDatabase,
  loadTestEnv,
  type ScratchDatabase,
} from '../../../db/test/helpers.js';
import { cookieJar, login, makeTestApp, mutationHeaders } from './helpers.js';

loadTestEnv();

let scratch: ScratchDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  scratch = await createScratchDatabase();
  app = makeTestApp(scratch.url, { ALLOWED_DOWNLOAD_HOSTS: 'github.com,localhost' });
});

afterAll(async () => {
  await app.close();
  await scratch.drop();
});

async function adminQuery(sql: string, params: unknown[] = []) {
  const admin = new Pool({ connectionString: scratch.url, max: 1 });
  try {
    return await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

const RELEASE = {
  version: '1.0.0',
  os: 'macos',
  arch: 'arm64',
  protocolVersion: 1,
  downloadUrl: 'https://github.com/clickerfree/releases/download/v1.0.0/worker-macos-arm64',
  manifestUrl: 'http://localhost:8088/manifest-macos-arm64.json',
  sha256: 'b'.repeat(64),
  descriptionKey: 'releases.v1_0_0.description',
  minSupportedVersion: '0.1.0',
};

async function makeAdmin(jar: ReturnType<typeof cookieJar>) {
  const me = (
    await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: jar.header() } })
  ).json();
  await adminQuery(`update users set role = 'admin' where id = $1`, [me.id]);
}

describe('release administration', () => {
  it('rejects non-admins and unauthenticated requests', async () => {
    const jar = cookieJar();
    await login(app, jar);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/admin/releases',
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: RELEASE,
    });
    expect(forbidden.statusCode).toBe(403);
    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/releases' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('admin creates, publishes and unpublishes a release; version endpoint reflects it', async () => {
    const jar = cookieJar();
    await login(app, jar);
    await makeAdmin(jar);

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/releases',
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: RELEASE,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;

    const beforePublish = (
      await app.inject({
        method: 'GET',
        url: '/api/worker/version?os=macos&arch=arm64&appVersion=0.1.0&protocolVersion=1',
      })
    ).json();
    expect(beforePublish.downloadUrl).toBeNull();

    const published = await app.inject({
      method: 'POST',
      url: `/api/admin/releases/${id}/publish`,
      headers: mutationHeaders(jar),
    });
    expect(published.statusCode).toBe(200);

    const version = (
      await app.inject({
        method: 'GET',
        url: '/api/worker/version?os=macos&arch=arm64&appVersion=0.1.0&protocolVersion=1',
      })
    ).json();
    expect(version).toMatchObject({
      latestVersion: '1.0.0',
      minSupportedVersion: '0.1.0',
      downloadUrl: RELEASE.downloadUrl,
      manifestUrl: RELEASE.manifestUrl,
      sha256: RELEASE.sha256,
    });

    const audit = await adminQuery(`select action from audit_events where target = $1`, [id]);
    expect(audit.rows.map((row: { action: string }) => row.action)).toContain('release_publish');

    const unpublished = await app.inject({
      method: 'POST',
      url: `/api/admin/releases/${id}/unpublish`,
      headers: mutationHeaders(jar),
    });
    expect(unpublished.statusCode).toBe(200);
    const download = await app.inject({ method: 'GET', url: '/api/download/macos/arm64' });
    expect(download.statusCode).toBe(404);

    await app.inject({
      method: 'POST',
      url: `/api/admin/releases/${id}/publish`,
      headers: mutationHeaders(jar),
    });
  });

  it('rejects download hosts outside the allowlist', async () => {
    const jar = cookieJar();
    await login(app, jar);
    await makeAdmin(jar);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/releases',
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { ...RELEASE, version: '2.0.0', downloadUrl: 'https://evil.example/file' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('download accounting', () => {
  it('redirects to the release file and records one event per eventId', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/download/macos/arm64' });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe(RELEASE.downloadUrl);

    const eventId = randomUUID();
    for (let i = 0; i < 2; i += 1) {
      await app.inject({
        method: 'GET',
        url: `/api/download/macos/arm64?eventId=${eventId}`,
      });
    }
    const rows = await adminQuery(
      `select count(*)::int as n from download_events where event_id = $1`,
      [eventId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('rate limits download requests without creating events', async () => {
    const jar = cookieJar();
    await login(app, jar);
    const before = await adminQuery(`select count(*)::int as n from download_events`);
    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/download/macos/arm64',
        headers: { cookie: jar.header() },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
    const after = await adminQuery(`select count(*)::int as n from download_events`);
    expect(after.rows[0].n).toBe(before.rows[0].n + 10);
  });

  it('deduplicates first-run events by eventId', async () => {
    const eventId = randomUUID();
    const payload = {
      installId: randomUUID(),
      eventId,
      os: 'windows',
      arch: 'x64',
      appVersion: '0.1.0',
    };
    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/worker/first-run',
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    const rows = await adminQuery(
      `select count(*)::int as n from usage_events where event_id = $1 and kind = 'first_run'`,
      [eventId],
    );
    expect(rows.rows[0].n).toBe(1);
  });
});
