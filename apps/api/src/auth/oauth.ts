import { createHash, randomBytes } from 'node:crypto';
import type { ProviderId } from './providers.js';

export interface OAuthFlow {
  provider: ProviderId;
  state: string;
  verifier: string;
  mode: 'login' | 'link';
  userId?: string;
  lang: 'ru' | 'en';
}

export function createFlow(
  provider: ProviderId,
  mode: 'login' | 'link',
  lang: 'ru' | 'en',
  userId?: string,
): { flow: OAuthFlow; codeChallenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  return { flow: { provider, state, verifier, mode, lang, userId }, codeChallenge };
}
