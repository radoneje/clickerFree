import type { ApiConfig } from '../config.js';

export type ProviderId = 'vk' | 'yandex' | 'dev';

export function isProviderId(value: string): value is ProviderId {
  return value === 'vk' || value === 'yandex' || value === 'dev';
}

export function enabledProviders(config: ApiConfig): ProviderId[] {
  const list: ProviderId[] = [];
  if (config.VK_ID_CLIENT_ID && config.VK_ID_CLIENT_SECRET) list.push('vk');
  if (config.YANDEX_ID_CLIENT_ID && config.YANDEX_ID_CLIENT_SECRET) list.push('yandex');
  // Тестовый провайдер никогда не включается в продакшене.
  if (config.OAUTH_DEV_ENABLED === 'true' && config.NODE_ENV !== 'production') list.push('dev');
  return list;
}

export function clientId(config: ApiConfig, provider: ProviderId): string {
  if (provider === 'vk') return config.VK_ID_CLIENT_ID;
  if (provider === 'yandex') return config.YANDEX_ID_CLIENT_ID;
  return 'dev';
}

export function clientSecret(config: ApiConfig, provider: ProviderId): string {
  if (provider === 'vk') return config.VK_ID_CLIENT_SECRET;
  if (provider === 'yandex') return config.YANDEX_ID_CLIENT_SECRET;
  return '';
}

export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  devUser?: string;
}

export function buildAuthorizeUrl(
  config: ApiConfig,
  provider: ProviderId,
  params: AuthorizeParams,
): string {
  if (provider === 'dev') {
    const url = new URL('/api/auth/dev/authorize', config.APP_BASE_URL);
    url.searchParams.set('state', params.state);
    url.searchParams.set('redirect_uri', params.redirectUri);
    if (params.devUser) url.searchParams.set('dev_user', params.devUser);
    return url.toString();
  }
  const url = new URL(
    provider === 'vk' ? 'https://id.vk.com/authorize' : 'https://oauth.yandex.ru/authorize',
  );
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId(config, provider));
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider === 'yandex') url.searchParams.set('scope', 'login:info');
  return url.toString();
}

export interface ExchangeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deviceId?: string;
  fetchImpl: typeof fetch;
}

// Обмен кода выполняется только на сервере; токены провайдеров после входа не хранятся.
export async function exchangeCode(
  config: ApiConfig,
  provider: ProviderId,
  params: ExchangeParams,
): Promise<string> {
  if (provider === 'dev') {
    if (!params.code.startsWith('dev:')) throw new Error('invalid dev code');
    const id = params.code.slice(4);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('invalid dev user id');
    return id;
  }

  if (provider === 'vk') {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: clientId(config, provider),
      redirect_uri: params.redirectUri,
      device_id: params.deviceId ?? '',
    });
    const response = await params.fetchImpl('https://id.vk.com/oauth2/auth', {
      method: 'POST',
      body,
    });
    if (!response.ok) throw new Error(`vk token exchange failed: ${response.status}`);
    const data = (await response.json()) as { user_id?: number | string };
    if (data.user_id === undefined) throw new Error('vk response missing user_id');
    return String(data.user_id);
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: clientId(config, provider),
    client_secret: clientSecret(config, provider),
    code_verifier: params.codeVerifier,
  });
  const tokenResponse = await params.fetchImpl('https://oauth.yandex.ru/token', {
    method: 'POST',
    body,
  });
  if (!tokenResponse.ok) throw new Error(`yandex token exchange failed: ${tokenResponse.status}`);
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error('yandex response missing access_token');

  const infoResponse = await params.fetchImpl('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${tokenData.access_token}` },
  });
  if (!infoResponse.ok) throw new Error(`yandex user info failed: ${infoResponse.status}`);
  const info = (await infoResponse.json()) as { id?: number | string };
  if (info.id === undefined) throw new Error('yandex response missing id');
  return String(info.id);
}
