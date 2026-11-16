// Смоук этапа 4: реальный Python-воркер против временных серверов и временной БД.
// Stage 4 smoke: the real Python worker against scratch servers and a scratch database.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`timeout: ${label}\nworker output:\n${workerOut}`);
}

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
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...options.headers, cookie: cookieHeader() },
    redirect: 'manual',
  });
  absorb(response);
  return response;
}

const servers = spawn(process.execPath, ['scripts/e2e-servers.mjs'], { stdio: 'inherit' });
const home = mkdtempSync(join(tmpdir(), 'cf-worker-smoke-'));
let worker;
let workerOut = '';

async function cleanup() {
  worker?.kill('SIGTERM');
  servers.kill('SIGTERM');
  await delay(1500);
  rmSync(home, { recursive: true, force: true });
}

try {
  await waitFor(
    () =>
      fetch(`${BASE}/ru/login`)
        .then((r) => r.ok)
        .catch(() => false),
    30000,
    'servers ready',
  );

  // Вход через dev-провайдер.
  const start = await req('/api/auth/dev/start?dev_user=smoke-worker');
  const authorize = new URL(start.headers.get('location'));
  const hop = await req(`${authorize.pathname}${authorize.search}`);
  const callback = new URL(hop.headers.get('location'));
  await req(`${callback.pathname}${callback.search}`);

  worker = spawn(
    'worker/.venv/bin/clickerfree-worker',
    ['--server', BASE, '--api-url', 'http://127.0.0.1:3001', '--lang', 'ru'],
    {
      env: {
        ...process.env,
        HOME: home,
        BROWSER: 'true',
        PYTHONUNBUFFERED: '1',
        CLICKERFREE_SECRET_FILE: join(home, 'secrets.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  worker.stdout.on('data', (d) => (workerOut += d));
  worker.stderr.on('data', (d) => (workerOut += d));

  const match = await waitFor(
    () => {
      if (worker.exitCode !== null) throw new Error(`worker exited: ${workerOut}`);
      return /Код привязки: ([A-Z2-9]{8})/.exec(workerOut);
    },
    30000,
    'pairing code',
  );
  const code = match[1];
  const confirm = await req('/api/pairing/confirm', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': cookies.get('cf_csrf') ?? '',
      origin: BASE,
    },
    body: JSON.stringify({ code }),
  });
  if (!confirm.ok) throw new Error(`confirm failed: ${confirm.status} ${await confirm.text()}`);

  await waitFor(() => workerOut.includes('Подключено к серверу.'), 30000, 'worker connected');
  const devices = (await (await req('/api/devices')).json()).devices;
  if (devices.length !== 1 || devices[0].online !== true) {
    throw new Error(`expected one online device, got: ${JSON.stringify(devices)}`);
  }
  console.log('WORKER SMOKE OK:', JSON.stringify(devices[0]));

  // Отзыв: воркер теряет соединение немедленно.
  const unlink = await req(`/api/devices/${devices[0].id}`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': cookies.get('cf_csrf') ?? '', origin: BASE },
  });
  if (!unlink.ok) throw new Error(`unlink failed: ${unlink.status}`);
  await waitFor(
    () => workerOut.includes('Связь с сервером потеряна'),
    15000,
    'worker disconnected',
  );
  console.log('REVOCATION SMOKE OK');
} finally {
  await cleanup();
}
process.exit(0);
