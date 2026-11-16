import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate } from '../db/dist/migrate.js';

const root = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(new URL('../.env', import.meta.url));

const base = process.env.DATABASE_URL;
if (!base) {
  console.error('DATABASE_URL is required for e2e servers');
  process.exit(1);
}

const maintenance = new URL(base);
maintenance.pathname = '/clickerfree_test';
const admin = new Pool({ connectionString: maintenance.toString(), max: 1 });
const name = `clickerfree_e2e_${randomBytes(6).toString('hex')}`;
await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
const scratch = new URL(base);
scratch.pathname = `/${name}`;
const scratchUrl = scratch.toString();
await migrate(scratchUrl);

const children = [];
function start(args, env, cwd) {
  const child = spawn(process.execPath, args, {
    cwd: cwd ?? root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(child);
}

start(['apps/api/dist/server.js'], {
  DATABASE_URL: scratchUrl,
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789abcdef',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  OAUTH_DEV_ENABLED: 'true',
  APP_BASE_URL: process.env.E2E_APP_BASE_URL ?? 'http://localhost:3000',
  API_HOST: process.env.E2E_API_HOST ?? '127.0.0.1',
  API_PORT: '3001',
});
start(
  [
    fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'start',
    '-p',
    '3000',
  ],
  { NODE_ENV: 'production', API_INTERNAL_URL: 'http://127.0.0.1:3001' },
  fileURLToPath(new URL('../apps/web', import.meta.url)),
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setInterval(() => {}, 10000);
