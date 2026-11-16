import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { SESSION_COOKIE } from '../src/auth/cookies.js';
import {
  createScratchDatabase,
  loadTestEnv,
  type ScratchDatabase,
} from '../../../db/test/helpers.js';

loadTestEnv();

const BASE = 'http://localhost:3000';
const SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';

let scratch: ScratchDatabase;
const openApps: FastifyInstance[] = [];

beforeAll(async () => {
  scratch = await createScratchDatabase();
});

afterAll(async () => {
  await scratch.drop();
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function fakeFetch(identities: { vk?: string; yandex?: string }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('id.vk.com/oauth2/auth')) {
      return Response.json({ access_token: 't', user_id: identities.vk ?? 'vk-1' });
    }
    if (url.includes('oauth.yandex.ru/token')) {
      return Response.json({ access_token: 't' });
    }
    if (url.includes('login.yandex.ru/info')) {
      return Response.json({ id: identities.yandex ?? 'ya-1' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function makeApp(
  overrides: Record<string, string> = {},
  identities: { vk?: string; yandex?: string } = {},
) {
  // Уникальные идентичности на каждый app: тесты делят одну временную базу.
  const runId = randomBytes(4).toString('hex');
  const app = buildApp({
    config: loadConfig({
      ...process.env,
      DATABASE_URL: scratch.url,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      APP_BASE_URL: BASE,
      SESSION_SECRET: SECRET,
      VK_ID_CLIENT_ID: 'test-vk',
      VK_ID_CLIENT_SECRET: 'test-vk-secret',
      YANDEX_ID_CLIENT_ID: 'test-yandex',
      YANDEX_ID_CLIENT_SECRET: 'test-yandex-secret',
      OAUTH_DEV_ENABLED: 'true',
      ...overrides,
    }),
    fetchImpl: fakeFetch({ vk: `vk-${runId}`, yandex: `ya-${runId}`, ...identities }),
  });
  openApps.push(app);
  return app;
}

function cookieJar() {
  const cookies = new Map<string, string>();
  return {
    header(): string {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    get(name: string): string | undefined {
      return cookies.get(name);
    },
    set(name: string, value: string): void {
      cookies.set(name, value);
    },
    absorb(response: { headers: Record<string, unknown> }): void {
      const raw = response.headers['set-cookie'];
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const entry of list) {
        const pair = String(entry).split(';')[0] ?? '';
        const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    },
  };
}

type Jar = ReturnType<typeof cookieJar>;

async function startFlow(app: FastifyInstance, jar: Jar, provider: string, query = '') {
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/${provider}/start${query}`,
    headers: { cookie: jar.header() },
  });
  jar.absorb(response);
  return response;
}

async function completeCallback(
  app: FastifyInstance,
  jar: Jar,
  provider: string,
  authorizeLocation: string,
) {
  const authorizeUrl = new URL(authorizeLocation);
  let callbackUrl: URL;
  if (provider === 'dev') {
    const hop = await app.inject({
      method: 'GET',
      url: `${authorizeUrl.pathname}${authorizeUrl.search}`,
      headers: { cookie: jar.header() },
    });
    jar.absorb(hop);
    expect(hop.statusCode).toBe(302);
    callbackUrl = new URL(String(hop.headers.location));
  } else {
    callbackUrl = new URL('/api/auth/dev/callback', BASE);
    callbackUrl.pathname = `/api/auth/${provider}/callback`;
    callbackUrl.searchParams.set('code', 'test-code');
    callbackUrl.searchParams.set('state', authorizeUrl.searchParams.get('state') ?? '');
    callbackUrl.searchParams.set('device_id', 'device-1');
  }
  const response = await app.inject({
    method: 'GET',
    url: `${callbackUrl.pathname}${callbackUrl.search}`,
    headers: { cookie: jar.header() },
  });
  jar.absorb(response);
  return response;
}

async function login(app: FastifyInstance, jar: Jar, provider: string, query = '') {
  const start = await startFlow(app, jar, provider, query);
  expect(start.statusCode).toBe(302);
  return completeCallback(app, jar, provider, String(start.headers.location));
}

function mutationHeaders(jar: Jar) {
  return {
    cookie: jar.header(),
    origin: BASE,
    'x-csrf-token': jar.get('cf_csrf') ?? '',
  };
}

async function me(app: FastifyInstance, jar: Jar) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: jar.header() },
  });
  return response;
}

describe('oauth login', () => {
  it('lists enabled providers', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(response.json().providers).toEqual(['vk', 'yandex', 'dev']);
  });

  it('creates an account on first VK login and a session on repeat login', async () => {
    const app = makeApp();
    const jar = cookieJar();
    const first = await login(app, jar, 'vk');
    expect(first.statusCode).toBe(302);
    expect(String(first.headers.location)).toBe(`${BASE}/ru/cabinet`);
    const profile = (await me(app, jar)).json();
    expect(profile.providers).toEqual(['vk']);

    const jar2 = cookieJar();
    await login(app, jar2, 'vk');
    const repeat = (await me(app, jar2)).json();
    expect(repeat.id).toBe(profile.id);
    expect(jar2.get(SESSION_COOKIE)).not.toBe(jar.get(SESSION_COOKIE));
  });

  it('isolates users of different providers and different identities', async () => {
    const app = makeApp();
    const vkJar = cookieJar();
    await login(app, vkJar, 'vk');
    const yandexJar = cookieJar();
    await login(app, yandexJar, 'yandex');
    const vkProfile = (await me(app, vkJar)).json();
    const yandexProfile = (await me(app, yandexJar)).json();
    expect(vkProfile.id).not.toBe(yandexProfile.id);
    expect(vkProfile.providers).toEqual(['vk']);
    expect(yandexProfile.providers).toEqual(['yandex']);
  });

  it('rejects a tampered state', async () => {
    const app = makeApp();
    const jar = cookieJar();
    const start = await startFlow(app, jar, 'vk');
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/vk/callback?code=test-code&state=wrong-state',
      headers: { cookie: jar.header() },
    });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain('error=oauth_state_invalid');
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    void start;
  });

  it('supports the dev provider outside production only', async () => {
    const app = makeApp();
    const jar = cookieJar();
    const callback = await login(app, jar, 'dev', '?dev_user=alice');
    expect(callback.statusCode).toBe(302);
    const profile = (await me(app, jar)).json();
    expect(profile.providers).toEqual(['dev']);

    const prodApp = makeApp({ NODE_ENV: 'production' });
    const start = await startFlow(prodApp, cookieJar(), 'dev');
    expect(String(start.headers.location)).toContain('error=oauth_provider_unavailable');
  });

  it('limits OAuth starts per browser', async () => {
    const app = makeApp();
    const jar = cookieJar();
    for (let i = 0; i < 10; i += 1) {
      const response = await startFlow(app, jar, 'vk');
      expect(response.statusCode).toBe(302);
    }
    const blocked = await startFlow(app, jar, 'vk');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
    // Callback учитывается отдельно и не блокируется лимитом начала.
    const start = await startFlow(app, cookieJar(), 'vk');
    expect(start.statusCode).toBe(302);
  });
});

describe('provider linking', () => {
  it('links a second provider only with an active session', async () => {
    const app = makeApp();
    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/yandex/start?mode=link' });
    expect(anonymous.statusCode).toBe(401);

    const jar = cookieJar();
    await login(app, jar, 'vk');
    const callback = await login(app, jar, 'yandex', '?mode=link');
    expect(String(callback.headers.location)).toBe(`${BASE}/ru/cabinet`);
    const profile = (await me(app, jar)).json();
    expect(profile.providers.sort()).toEqual(['vk', 'yandex']);
  });

  it('refuses to link an identity owned by another account', async () => {
    const app = makeApp();
    const owner = cookieJar();
    await login(app, owner, 'vk');
    const other = cookieJar();
    await login(app, other, 'yandex');
    const callback = await login(app, other, 'vk', '?mode=link');
    expect(String(callback.headers.location)).toContain('error=oauth_account_conflict');
    const profile = (await me(app, other)).json();
    expect(profile.providers).toEqual(['yandex']);
  });

  it('unlinks a provider but never the last one', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar, 'vk');
    await login(app, jar, 'yandex', '?mode=link');

    const unlink = await app.inject({
      method: 'DELETE',
      url: '/api/me/providers/yandex',
      headers: mutationHeaders(jar),
    });
    expect(unlink.statusCode).toBe(200);
    expect((await me(app, jar)).json().providers).toEqual(['vk']);

    const last = await app.inject({
      method: 'DELETE',
      url: '/api/me/providers/vk',
      headers: mutationHeaders(jar),
    });
    expect(last.statusCode).toBe(400);
    expect(last.json().error.code).toBe('last_provider_required');
  });
});

describe('sessions and csrf', () => {
  it('rejects mutating requests without CSRF proof', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar, 'vk');
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: jar.header(), 'x-csrf-token': jar.get('cf_csrf') ?? '' },
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json().error.code).toBe('csrf_invalid');

    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...mutationHeaders(jar), origin: 'https://evil.example' },
    });
    expect(wrongOrigin.statusCode).toBe(403);
  });

  it('logout revokes the session immediately', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar, 'vk');
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: mutationHeaders(jar),
    });
    expect(logout.statusCode).toBe(200);
    expect((await me(app, jar)).statusCode).toBe(401);
  });

  it('revoke-others kills older sessions but keeps the current one', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar, 'vk');
    const oldToken = jar.get(SESSION_COOKIE) ?? '';
    await login(app, jar, 'vk');
    const currentToken = jar.get(SESSION_COOKIE) ?? '';
    expect(oldToken).not.toBe(currentToken);

    const revoke = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-others',
      headers: mutationHeaders(jar),
    });
    expect(revoke.statusCode).toBe(200);

    const oldJar = cookieJar();
    oldJar.set(SESSION_COOKIE, oldToken);
    expect((await me(app, oldJar)).statusCode).toBe(401);
    expect((await me(app, jar)).statusCode).toBe(200);
  });

  it('rejects expired sessions', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar, 'vk');
    const token = jar.get(SESSION_COOKIE) ?? '';
    const admin = new Pool({ connectionString: scratch.url, max: 1 });
    await admin.query(
      `update sessions set expires_at = now() - interval '1 day' where token_hash = $1`,
      [hashToken(token)],
    );
    await admin.end();
    expect((await me(app, jar)).statusCode).toBe(401);
  });
});

describe('account language', () => {
  it('changes the site language and validates the value', async () => {
    const app = makeApp();
    const jar = cookieJar();
    await login(app, jar, 'vk');
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/me/language',
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { lang: 'en' },
    });
    expect(changed.statusCode).toBe(200);
    expect((await me(app, jar)).json().siteLang).toBe('en');

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/me/language',
      headers: { ...mutationHeaders(jar), 'content-type': 'application/json' },
      payload: { lang: 'de' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('validation_failed');
  });
});
