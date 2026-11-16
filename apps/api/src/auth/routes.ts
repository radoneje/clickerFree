import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { oauthAccounts, users, type Db } from '@clickerfree/db';
import { z } from 'zod';
import type { ApiConfig } from '../config.js';
import { sendError } from '../errors.js';
import { takeRateLimit } from '../rate-limit.js';
import { FLOW_COOKIE, LANG_COOKIE, SESSION_COOKIE } from './cookies.js';
import { createFlow, type OAuthFlow } from './oauth.js';
import { buildAuthorizeUrl, enabledProviders, exchangeCode, isProviderId } from './providers.js';
import { createSession, revokeOtherSessions, revokeSession, type SessionAuth } from './sessions.js';

export interface AuthDeps {
  config: ApiConfig;
  db: Db;
  fetchImpl: typeof fetch;
}

function cookieDefaults(config: ApiConfig) {
  return { path: '/', sameSite: 'lax' as const, secure: config.NODE_ENV === 'production' };
}

function redirectWithError(
  reply: FastifyReply,
  config: ApiConfig,
  lang: string,
  code: string,
  provider?: string,
): FastifyReply {
  const url = new URL(`/${lang}/login`, config.APP_BASE_URL);
  url.searchParams.set('error', code);
  if (provider) url.searchParams.set('provider', provider);
  return reply.redirect(url.toString());
}

function requireAuth(request: FastifyRequest, reply: FastifyReply): SessionAuth | null {
  if (!request.auth) {
    sendError(reply, 401, 'unauthorized', {});
    return null;
  }
  return request.auth;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  { config, db, fetchImpl }: AuthDeps,
): void {
  app.get('/api/auth/providers', async () => ({ providers: enabledProviders(config) }));

  app.get('/api/auth/:provider/start', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const lang = request.cookies[LANG_COOKIE] === 'en' ? 'en' : 'ru';
    if (!isProviderId(provider) || !enabledProviders(config).includes(provider)) {
      return redirectWithError(reply, config, lang, 'oauth_provider_unavailable', provider);
    }

    // Лимиты начала входа: браузер и IP считаются отдельно от callback.
    const limits: Array<[string, number]> = [
      [`oauth_start:browser:${request.browserId}`, 10],
      [`oauth_start:ip:${request.ip}`, 100],
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

    const query = request.query as { mode?: string; dev_user?: string };
    const mode = query.mode === 'link' ? 'link' : 'login';
    if (mode === 'link' && !request.auth) return sendError(reply, 401, 'unauthorized', {});

    const { flow, codeChallenge } = createFlow(provider, mode, lang, request.auth?.userId);
    const redirectUri = `${config.APP_BASE_URL}/api/auth/${provider}/callback`;
    const url = buildAuthorizeUrl(config, provider, {
      redirectUri,
      state: flow.state,
      codeChallenge,
      devUser: query.dev_user,
    });
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
      ...cookieDefaults(config),
      httpOnly: true,
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(url);
  });

  app.get('/api/auth/:provider/callback', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const query = request.query as { code?: string; state?: string; device_id?: string };

    try {
      const result = await takeRateLimit(db, `oauth_callback:ip:${request.ip}`, 100, 600);
      if (!result.allowed) {
        reply.header('Retry-After', String(result.retryAfterSeconds));
        return sendError(reply, 429, 'rate_limited', {
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    } catch {
      return sendError(reply, 503, 'service_unavailable', {});
    }

    const rawFlow = request.cookies[FLOW_COOKIE];
    const unsigned = rawFlow ? request.unsignCookie(rawFlow) : null;
    let flow: OAuthFlow | null = null;
    if (unsigned?.valid && unsigned.value) {
      try {
        flow = JSON.parse(unsigned.value) as OAuthFlow;
      } catch {
        flow = null;
      }
    }
    const lang = flow?.lang ?? 'ru';
    reply.clearCookie(FLOW_COOKIE, { path: '/' });

    if (
      !isProviderId(provider) ||
      !flow ||
      flow.provider !== provider ||
      !query.state ||
      query.state !== flow.state ||
      !query.code
    ) {
      return redirectWithError(reply, config, lang, 'oauth_state_invalid');
    }

    let providerUserId: string;
    try {
      providerUserId = await exchangeCode(config, provider, {
        code: query.code,
        codeVerifier: flow.verifier,
        redirectUri: `${config.APP_BASE_URL}/api/auth/${provider}/callback`,
        deviceId: query.device_id,
        fetchImpl,
      });
    } catch (err) {
      request.log.error({ err }, 'oauth code exchange failed');
      return redirectWithError(reply, config, lang, 'oauth_provider_error', provider);
    }

    const existing = await db
      .select()
      .from(oauthAccounts)
      .where(
        and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)),
      )
      .limit(1);
    const identity = existing[0];

    if (flow.mode === 'link') {
      const auth = request.auth;
      if (!auth || auth.userId !== flow.userId) {
        return redirectWithError(reply, config, lang, 'unauthorized');
      }
      if (identity && identity.userId !== auth.userId) {
        return redirectWithError(reply, config, lang, 'oauth_account_conflict');
      }
      if (!identity) {
        await db.insert(oauthAccounts).values({ userId: auth.userId, provider, providerUserId });
      }
      return reply.redirect(`${config.APP_BASE_URL}/${auth.siteLang}/cabinet`);
    }

    let userId: string;
    let siteLang: 'ru' | 'en';
    if (identity) {
      const userRows = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
      const user = userRows[0];
      if (!user) return redirectWithError(reply, config, lang, 'internal_error');
      userId = user.id;
      siteLang = user.siteLang;
    } else {
      // Новый аккаунт создаётся только после подтверждённого входа у провайдера.
      const created = await db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ siteLang: flow.lang }).returning();
        if (!user) throw new Error('user insert returned no row');
        await tx.insert(oauthAccounts).values({ userId: user.id, provider, providerUserId });
        return user;
      });
      userId = created.id;
      siteLang = created.siteLang;
    }

    const token = await createSession(db, userId, config.SESSION_TTL_DAYS);
    reply.setCookie(SESSION_COOKIE, token, {
      ...cookieDefaults(config),
      httpOnly: true,
      maxAge: config.SESSION_TTL_DAYS * 86400,
    });
    return reply.redirect(`${config.APP_BASE_URL}/${siteLang}/cabinet`);
  });

  // Тестовый провайдер: мгновенный возврат кода, только вне продакшена.
  app.get('/api/auth/dev/authorize', async (request, reply) => {
    if (!enabledProviders(config).includes('dev')) return sendError(reply, 404, 'not_found', {});
    const query = request.query as { state?: string; redirect_uri?: string; dev_user?: string };
    const devUser =
      query.dev_user && /^[a-zA-Z0-9_-]{1,64}$/.test(query.dev_user) ? query.dev_user : 'dev-user';
    if (!query.redirect_uri || !query.redirect_uri.startsWith(`${config.APP_BASE_URL}/`)) {
      return sendError(reply, 400, 'validation_failed', { field: 'redirect_uri' });
    }
    const url = new URL(query.redirect_uri);
    url.searchParams.set('code', `dev:${devUser}`);
    if (query.state) url.searchParams.set('state', query.state);
    return reply.redirect(url.toString());
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    await revokeSession(db, auth.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { status: 'ok' };
  });

  app.post('/api/auth/sessions/revoke-others', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    await revokeOtherSessions(db, auth.userId, auth.sessionId);
    return { status: 'ok' };
  });

  app.get('/api/me', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const rows = await db
      .select({ provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, auth.userId));
    return {
      id: auth.userId,
      role: auth.role,
      siteLang: auth.siteLang,
      providers: rows.map((row) => row.provider),
    };
  });

  const languageSchema = z.object({ lang: z.enum(['ru', 'en']) });
  app.patch('/api/me/language', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const parsed = languageSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', { field: 'lang' });
    await db
      .update(users)
      .set({ siteLang: parsed.data.lang, updatedAt: new Date() })
      .where(eq(users.id, auth.userId));
    return { siteLang: parsed.data.lang };
  });

  app.delete('/api/me/providers/:provider', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const { provider } = request.params as { provider: string };
    if (!isProviderId(provider)) {
      return sendError(reply, 400, 'validation_failed', { field: 'provider' });
    }
    const rows = await db
      .select({ id: oauthAccounts.id, provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, auth.userId));
    if (rows.length <= 1) return sendError(reply, 400, 'last_provider_required', {});
    const target = rows.find((row) => row.provider === provider);
    if (!target) return sendError(reply, 404, 'not_found', {});
    await db.delete(oauthAccounts).where(eq(oauthAccounts.id, target.id));
    return { status: 'ok' };
  });
}
