import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

function loadEnv(): void {
  const candidates = process.env.ENV_FILE
    ? [process.env.ENV_FILE]
    : process.env.NODE_ENV === 'production'
      ? ['/etc/clickerfree/production.env']
      : [fileURLToPath(new URL('../../../.env', import.meta.url))];
  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      // Файл может отсутствовать: переменные уже заданы окружением (PM2).
    }
  }
}

loadEnv();
const config = loadConfig();
const app = buildApp({ config });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: config.API_HOST, port: config.API_PORT });
