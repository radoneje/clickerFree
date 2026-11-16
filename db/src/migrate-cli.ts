import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

const envFile = process.env.ENV_FILE ?? fileURLToPath(new URL('../../.env', import.meta.url));
try {
  process.loadEnvFile(envFile);
} catch {
  // .env может отсутствовать: в продакшене переменные задаёт PM2/systemd.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env or provide the environment.');
  process.exit(1);
}

await migrate(databaseUrl);
console.log('migrations applied');
