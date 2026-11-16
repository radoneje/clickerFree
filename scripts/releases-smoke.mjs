// Смоук этапа 7: подписанные манифесты, регистрация релизов, учёт скачиваний,
// совместимость подписи Node ↔ проверка Python, предложение обновления.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate } from '../db/dist/migrate.js';

const root = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(new URL('../.env', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`timeout: ${label}`);
}

const base = process.env.DATABASE_URL;
const maintenance = new URL(base);
maintenance.pathname = '/clickerfree_test';
const admin = new Pool({ connectionString: maintenance.toString(), max: 1 });
const name = `clickerfree_rel_${randomBytes(6).toString('hex')}`;
await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
const scratch = new URL(base);
scratch.pathname = `/${name}`;
const scratchUrl = scratch.toString();
await migrate(scratchUrl);
const scratchPool = new Pool({ connectionString: scratchUrl, max: 2 });

const children = [];
function start(command, args, env, cwd) {
  const child = spawn(command, args, {
    cwd: cwd ?? root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}

start(process.execPath, ['apps/api/dist/server.js'], {
  DATABASE_URL: scratchUrl,
  SESSION_SECRET: 'releases-smoke-secret-0123456789abcdef0123456789abcdef',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  OAUTH_DEV_ENABLED: 'true',
  APP_BASE_URL: 'http://localhost:3000',
  API_HOST: '127.0.0.1',
  API_PORT: '3001',
  ALLOWED_DOWNLOAD_HOSTS: 'github.com,localhost',
});
start(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'start',
    '-p',
    '3000',
  ],
  { NODE_ENV: 'production', API_INTERNAL_URL: 'http://127.0.0.1:3001' },
  fileURLToPath(new URL('../apps/web', import.meta.url)),
);
start('python3', ['-m', 'http.server', '8088', '--directory', 'ops/dist'], {});

const cookies = new Map();
function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function absorb(response) {
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const pair = entry.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
async function req(path, options = {}) {
  const response = await fetch(`http://localhost:3000${path}`, {
    ...options,
    headers: { ...options.headers, cookie: cookieHeader() },
    redirect: 'manual',
  });
  absorb(response);
  return response;
}

let exitCode = 0;
try {
  await waitFor(
    () =>
      fetch('http://localhost:3000/ru/login')
        .then((r) => r.ok)
        .catch(() => false),
    30000,
    'servers',
  );
  await waitFor(
    () =>
      fetch('http://localhost:8088/manifest-macos-arm64.json')
        .then((r) => r.ok)
        .catch(() => false),
    15000,
    'static server',
  );

  const startResponse = await req('/api/auth/dev/start?dev_user=releases-smoke');
  const authorize = new URL(startResponse.headers.get('location'));
  const hop = await req(`${authorize.pathname}${authorize.search}`);
  const callback = new URL(hop.headers.get('location'));
  await req(`${callback.pathname}${callback.search}`);
  const me = await (await req('/api/me')).json();
  await scratchPool.query(`update users set role = 'admin' where id = $1`, [me.id]);

  const csrf = cookies.get('cf_csrf');
  const headers = {
    origin: 'http://localhost:3000',
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
  for (const [os, arch, manifest] of [
    ['macos', 'arm64', 'manifest-macos-arm64.json'],
    ['windows', 'x64', 'manifest-windows-x64.json'],
  ]) {
    const created = await req('/api/admin/releases', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: '0.1.0',
        os,
        arch,
        protocolVersion: 1,
        downloadUrl: `https://github.com/clickerfree/releases/download/v0.1.0/clickerfree-worker-${os}-${arch}`,
        manifestUrl: `http://localhost:8088/${manifest}`,
        sha256: 'c'.repeat(64),
        descriptionKey: `releases.v0_1_0.${os}`,
        minSupportedVersion: '0.1.0',
      }),
    });
    if (!created.ok) throw new Error(`create failed: ${await created.text()}`);
    const { id } = await created.json();
    const published = await req(`/api/admin/releases/${id}/publish`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'x-csrf-token': csrf },
    });
    if (!published.ok) throw new Error(`publish failed: ${await published.text()}`);
  }

  const version = await (
    await req('/api/worker/version?os=macos&arch=arm64&appVersion=0.1.0&protocolVersion=1')
  ).json();
  if (version.manifestUrl !== 'http://localhost:8088/manifest-macos-arm64.json')
    throw new Error('version endpoint missing manifestUrl');

  const download = await req('/api/download/macos/arm64');
  if (download.status !== 302) throw new Error(`download status ${download.status}`);
  if (!download.headers.get('location').startsWith('https://github.com/'))
    throw new Error('download redirect target');
  const events = await scratchPool.query(`select count(*)::int as n from download_events`);
  if (events.rows[0].n !== 1) throw new Error(`download events: ${events.rows[0].n}`);

  const landing = await (await fetch('http://localhost:3000/ru')).text();
  if (!landing.includes('/api/download/macos/arm64'))
    throw new Error('landing missing download link');

  const interop = spawnSync(
    'worker/.venv/bin/python',
    [
      '-c',
      "import json\nfrom clickerfree_worker.release import verify_manifest, suggest_update\nm = json.load(open('ops/dist/manifest-macos-arm64.json'))\nprint('verify:', verify_manifest(m))\nsuggest_update({'manifestUrl': 'http://localhost:8088/manifest-update-macos.json'}, 'ru')",
    ],
    { cwd: root, encoding: 'utf8' },
  );
  console.log(interop.stdout.trim());
  if (!interop.stdout.includes('verify: True'))
    throw new Error('Node-signed manifest failed Python verification');
  if (!interop.stdout.includes('Доступно обновление 0.2.0'))
    throw new Error('update suggestion missing');

  console.log('RELEASES SMOKE OK');
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  await delay(2500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await scratchPool.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and backend_type = 'client backend'`,
      [name],
    );
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      break;
    } catch {
      await delay(1000);
    }
  }
  await scratchPool.end();
  await admin.end();
}
process.exit(exitCode);
