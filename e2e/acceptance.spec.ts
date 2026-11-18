import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { io as ioClient, type Socket } from 'socket.io-client';

const BASE = 'http://localhost:3000';

async function loginDev(page: import('@playwright/test').Page, user: string) {
  await page.goto(`/api/auth/dev/start?dev_user=${user}`);
  await expect(page).toHaveURL(/\/ru\/cabinet/);
}

async function csrfOf(page: import('@playwright/test').Page) {
  return (await page.context().cookies()).find((c) => c.name === 'cf_csrf')?.value ?? '';
}

async function pairDevice(page: import('@playwright/test').Page, name: string) {
  const secret = randomBytes(32).toString('base64url');
  const installId = randomUUID();
  const csrf = await csrfOf(page);
  const codeResponse = await page.request.post('/api/pairing/code', {
    headers: { 'x-worker-secret': secret },
    data: { installId, name, os: 'windows', arch: 'x64', appVersion: '1.0.0', protocolVersion: 1 },
  });
  const { code } = await codeResponse.json();
  await page.request.post('/api/pairing/confirm', {
    headers: { origin: BASE, 'x-csrf-token': csrf },
    data: { code },
  });
  const result = await page.request.get(`/api/pairing/result?installId=${installId}`, {
    headers: { 'x-worker-secret': secret },
  });
  return (await result.json()) as { deviceId: string; credential: string };
}

async function socketBase(page: import('@playwright/test').Page) {
  const config = await (await page.request.get('/api/config')).json();
  return config.socketUrl || BASE;
}

function connectWorker(
  base: string,
  deviceId: string,
  credential: string,
  dedup = false,
  sharedSeen?: Set<string>,
) {
  const worker = ioClient(`${base}/worker`, {
    auth: {
      deviceId,
      credential,
      appVersion: '1.0.0',
      os: 'windows',
      arch: 'x64',
      protocolVersion: 1,
    },
    transports: ['websocket'],
    reconnection: false,
  });
  const executed: string[] = [];
  let received = 0;
  // Реальный воркер сохраняет кэш дедупликации при переподключении того же процесса.
  const seen = sharedSeen ?? new Set<string>();
  worker.on('control:command', (cmd) => {
    received += 1;
    console.log('[worker] received command', cmd.commandId, 'dedup-hit:', seen.has(cmd.commandId));
    if (dedup) {
      if (seen.has(cmd.commandId)) {
        worker.emit('control:ack', {
          commandId: cmd.commandId,
          status: 'rejected',
          errorCode: 'command_duplicate',
        });
        return;
      }
      seen.add(cmd.commandId);
    }
    executed.push(cmd.commandId);
    worker.emit('control:ack', { commandId: cmd.commandId, status: 'executed' });
  });
  return { worker, executed, seen, received: () => received };
}

function connected(worker: Socket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker connect timeout')), 8000);
    worker.once('worker:connected', () => {
      clearTimeout(timer);
      resolve();
    });
    worker.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

test('two users are isolated; pairing and revocation work end to end', async ({
  page,
  browser,
}) => {
  await loginDev(page, 'accept-owner');
  const { deviceId, credential } = await pairDevice(page, 'Accept PC');
  const base = await socketBase(page);
  const { worker } = connectWorker(base, deviceId, credential);
  await connected(worker);

  const stranger = await newPage(browser);
  try {
    await loginDev(stranger.page, 'accept-stranger');
    const devices = await (await stranger.page.request.get('/api/devices')).json();
    expect(devices.devices).toHaveLength(0);
    await stranger.page.goto(`/ru/remote/${deviceId}`);
    await expect(stranger.page).toHaveURL(/\/ru\/cabinet/);
  } finally {
    await stranger.context.close();
  }

  await page.goto('/ru/cabinet');
  await expect(page.getByText('Accept PC')).toBeVisible();
  const csrf = await csrfOf(page);
  const disconnected = new Promise<void>((resolve) => worker.once('disconnect', () => resolve()));
  const revoke = await page.request.delete(`/api/devices/${deviceId}`, {
    headers: { origin: BASE, 'x-csrf-token': csrf },
  });
  expect(revoke.ok()).toBeTruthy();
  await disconnected;
  await page.reload();
  await expect(page.getByText('Пока нет привязанных компьютеров.')).toBeVisible();
  worker.disconnect();
});

test('speaker invitations work in both languages', async ({ page, browser }) => {
  await loginDev(page, 'accept-inviter');
  const { deviceId, credential } = await pairDevice(page, 'Speaker PC');
  const base = await socketBase(page);
  const { worker, executed } = connectWorker(base, deviceId, credential);
  await connected(worker);
  const csrf = await csrfOf(page);

  for (const [lang, heading, button] of [
    ['ru', 'Пульт', 'Вперёд'],
    ['en', 'Remote', 'Forward'],
  ] as const) {
    const created = await page.request.post(`/api/devices/${deviceId}/invitations`, {
      headers: { origin: BASE, 'x-csrf-token': csrf },
      data: { lang, hours: 2 },
    });
    const { url } = await created.json();
    const speaker = await newPage(browser);
    try {
      await speaker.page.goto(url);
      await speaker.page
        .getByRole('button', { name: lang === 'ru' ? 'Открыть пульт' : 'Open remote' })
        .click();
      await expect(speaker.page).toHaveURL(new RegExp(`/${lang}/r/`));
      await expect(speaker.page.getByRole('heading', { name: heading })).toBeVisible();
      await speaker.page.getByRole('button', { name: button }).click();
      await expect.poll(() => executed.length).toBeGreaterThanOrEqual(1);
    } finally {
      await speaker.context.close();
    }
  }
  worker.disconnect();
});

test('reconnect does not replay executed commands', async ({ page }) => {
  await loginDev(page, 'accept-reconnect');
  const { deviceId, credential } = await pairDevice(page, 'Reconnect PC');
  const base = await socketBase(page);
  const first = connectWorker(base, deviceId, credential, true);
  await connected(first.worker);

  await page.goto(`/ru/remote/${deviceId}`);
  const forward = page.getByRole('button', { name: 'Вперёд' });
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect.poll(() => first.executed.length).toBe(1);
  const commandId = first.executed[0];

  // Воркер переподключается; другой пульт шлёт тот же commandId.
  first.worker.disconnect();
  const second = connectWorker(base, deviceId, credential, true, first.seen);
  await connected(second.worker);
  // Страница уходит в кабинет, освобождая управление для второго пульта.
  await page.goto('/ru/cabinet');
  const sessionToken = (await page.context().cookies()).find((c) => c.name === 'cf_session')?.value ?? '';
  const remote = ioClient(`${base}/remote`, {
    auth: { deviceId, sessionToken },
    transports: ['websocket'],
    reconnection: false,
  });
  let role = '';
  let released = false;
  remote.on('control:state', (state) => {
    role = state.role;
  });
  remote.on('control:released', () => {
    released = true;
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('remote state timeout')), 8000);
    remote.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    remote.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  // Если управление ещё у пульта страницы, запрашиваем его, пока оно не освободится.
  if (role !== 'controller') {
    const deadline = Date.now() + 10000;
    while (role !== 'controller' && Date.now() < deadline) {
      remote.emit('control:request');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(role).toBe('controller');
  }
  const acks: Array<{ status: string; errorCode?: string }> = [];
  remote.on('control:ack', (ack) => acks.push(ack));
  remote.emit('control:command', { commandId, action: 'next' });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log('[test] worker received:', second.received(), 'acks:', acks.length, 'role:', role);
  await expect.poll(() => acks.length).toBe(1);
  expect(acks[0].errorCode).toBe('command_duplicate');
  expect(second.executed.length).toBe(0);
  remote.disconnect();
  second.worker.disconnect();
});
