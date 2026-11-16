import type { SessionAuth } from './auth/sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionAuth | null;
    browserId: string;
  }
}

export {};
