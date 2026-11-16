import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres connection URL'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(600),
  API_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(65536),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  VK_ID_CLIENT_ID: z.string().default(''),
  VK_ID_CLIENT_SECRET: z.string().default(''),
  YANDEX_ID_CLIENT_ID: z.string().default(''),
  YANDEX_ID_CLIENT_SECRET: z.string().default(''),
  OAUTH_DEV_ENABLED: z.enum(['true', 'false']).default('false'),
  SOCKET_PUBLIC_URL: z.string().default(''),
});

export type ApiConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API configuration: ${details}`);
  }
  return parsed.data;
}
