import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const BASE = 'http://localhost:3000';
export const SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';

export function fakeFetch(identities: { vk?: string; yandex?: string } = {}): typeof fetch {
  // Идентичность привязана к коду обмена: каждый login с уникальным кодом = новый пользователь.
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();
    const code = body.get('code') ?? 'default';
    if (url.includes('id.vk.com/oauth2/auth')) {
      return Response.json({ access_token: 't', user_id: identities.vk ?? code });
    }
    if (url.includes('oauth.yandex.ru/token')) {
      return Response.json({ access_token: 't' });
    }
    if (url.includes('login.yandex.ru/info')) {
      return Response.json({ id: identities.yandex ?? code });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

export function makeTestApp(
  scratchUrl: string,
  overrides: Record<string, string> = {},
  identities: { vk?: string; yandex?: string } = {},
): FastifyInstance {
  return buildApp({
    config: loadConfig({
      ...process.env,
      DATABASE_URL: scratchUrl,
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
    fetchImpl: fakeFetch(identities),
  });
}

export function cookieJar() {
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

export type Jar = ReturnType<typeof cookieJar>;

export async function login(app: FastifyInstance, jar: Jar, provider = 'vk'): Promise<void> {
  const start = await app.inject({
    method: 'GET',
    url: `/api/auth/${provider}/start`,
    headers: { cookie: jar.header() },
  });
  jar.absorb(start);
  if (start.statusCode !== 302) throw new Error(`start failed: ${start.statusCode}`);
  const location = new URL(String(start.headers.location));
  let callbackPath: string;
  if (provider === 'dev') {
    const hop = await app.inject({
      method: 'GET',
      url: `${location.pathname}${location.search}`,
      headers: { cookie: jar.header() },
    });
    jar.absorb(hop);
    const cb = new URL(String(hop.headers.location));
    callbackPath = `${cb.pathname}${cb.search}`;
  } else {
    const state = location.searchParams.get('state') ?? '';
    const code = `test-code-${randomBytes(6).toString('hex')}`;
    callbackPath = `/api/auth/${provider}/callback?code=${code}&state=${state}&device_id=d1`;
  }
  const callback = await app.inject({
    method: 'GET',
    url: callbackPath,
    headers: { cookie: jar.header() },
  });
  jar.absorb(callback);
  if (callback.statusCode !== 302) throw new Error(`callback failed: ${callback.statusCode}`);
}

export function mutationHeaders(jar: Jar): Record<string, string> {
  return {
    cookie: jar.header(),
    origin: BASE,
    'x-csrf-token': jar.get('cf_csrf') ?? '',
  };
}
