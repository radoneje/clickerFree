// Смоук: нативный Windows-воркер (C#/.NET) на удалённой машине против сервиса на Mac.
// Smoke: the native Windows worker (C#/.NET) on a remote machine against the service on the Mac.
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const SSH_TARGET = process.env.WINDOWS_SSH ?? 'shevchenko@10.10.100.76';
const REMOTE_EXE =
  'C:\\Users\\shevchenko\\cfbuild\\worker-windows\\src\\bin\\Release\\net10.0\\win-x64\\publish\\clickerfree-worker.exe';

function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  throw new Error('no LAN IPv4 address found');
}

const HOST = process.env.SMOKE_HOST ?? lanAddress();
const BASE = `http://${HOST}:3000`;
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

const servers = spawn(process.execPath, ['scripts/e2e-servers.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, E2E_API_HOST: '0.0.0.0', E2E_APP_BASE_URL: BASE },
});
let worker;
let workerOut = '';

function remoteTaskkill() {
  spawnSync('ssh', ['-o', 'BatchMode=yes', SSH_TARGET, 'taskkill /IM clickerfree-worker.exe /F'], {
    stdio: 'ignore',
  });
}

async function cleanup() {
  worker?.kill('SIGTERM');
  remoteTaskkill();
  servers.kill('SIGTERM');
  await delay(1500);
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

  const start = await req('/api/auth/dev/start?dev_user=windows-smoke');
  const authorize = new URL(start.headers.get('location'));
  const hop = await req(`${authorize.pathname}${authorize.search}`);
  const callback = new URL(hop.headers.get('location'));
  await req(`${callback.pathname}${callback.search}`);

  remoteTaskkill();
  const remoteCommand = `set "CLICKERFREE_SECRET_FILE=C:\\Users\\shevchenko\\cfbuild\\secrets.json" && "${REMOTE_EXE}" --server ${BASE} --api-url http://${HOST}:3001 --lang ru`;
  worker = spawn('ssh', ['-o', 'BatchMode=yes', SSH_TARGET, remoteCommand], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (d) => (workerOut += d));
  worker.stderr.on('data', (d) => (workerOut += d));

  const codeMatch = await waitFor(
    () => {
      if (workerOut.includes('Подключено к серверу.')) return { alreadyPaired: true };
      return /Код привязки: ([A-Z2-9]{8})/.exec(workerOut);
    },
    60000,
    'pairing code or reconnect',
  );

  if (!codeMatch.alreadyPaired) {
    const confirm = await req('/api/pairing/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': cookies.get('cf_csrf') ?? '',
        origin: BASE,
      },
      body: JSON.stringify({ code: codeMatch[1] }),
    });
    if (!confirm.ok) throw new Error(`confirm failed: ${confirm.status} ${await confirm.text()}`);
    await waitFor(() => workerOut.includes('Подключено к серверу.'), 30000, 'worker connected');
  }

  const devices = (await (await req('/api/devices')).json()).devices;
  const windowsDevice = devices.find((d) => d.os === 'windows' && d.online === true);
  if (!windowsDevice) throw new Error(`no online windows device: ${JSON.stringify(devices)}`);
  console.log('WINDOWS WORKER SMOKE OK:', JSON.stringify(windowsDevice));

  const unlink = await req(`/api/devices/${windowsDevice.id}`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': cookies.get('cf_csrf') ?? '', origin: BASE },
  });
  if (!unlink.ok) throw new Error(`unlink failed: ${unlink.status}`);
  await waitFor(
    () => workerOut.includes('Связь с сервером потеряна'),
    20000,
    'worker disconnected',
  );
  console.log('WINDOWS REVOCATION SMOKE OK');
} finally {
  await cleanup();
}
process.exit(0);
