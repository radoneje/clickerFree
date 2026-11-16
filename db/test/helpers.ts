import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate } from '../src/migrate.js';

export function loadTestEnv(): void {
  if (process.env.DATABASE_URL) return;
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
}

export interface ScratchDatabase {
  url: string;
  drop: () => Promise<void>;
}

// Каждый тестовый файл получает отдельную базу, чтобы параллельные воркеры не мешали друг другу.
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  loadTestEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set for tests');

  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = '/clickerfree_test';
  const admin = new Pool({ connectionString: maintenanceUrl.toString(), max: 1 });

  const name = `clickerfree_scratch_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);

  const scratchUrl = new URL(databaseUrl);
  scratchUrl.pathname = `/${name}`;
  const url = scratchUrl.toString();
  await migrate(url);

  return {
    url,
    drop: async () => {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and backend_type = 'client backend'`,
        [name],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    },
  };
}
