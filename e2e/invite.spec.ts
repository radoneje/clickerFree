import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { io as ioClient } from 'socket.io-client';

test('speaker link grants remote access without registration and revocation kills it', async ({
  page,
  browser,
}) => {
  await page.goto('/api/auth/dev/start?dev_user=invite-owner');
  await expect(page).toHaveURL(/\/ru\/cabinet/);

  const secret = randomBytes(32).toString('base64url');
  const installId = randomUUID();
  const csrf = (await page.context().cookies()).find((c) => c.name === 'cf_csrf')?.value ?? '';
  const origin = 'http://localhost:3000';
  const codeResponse = await page.request.post('/api/pairing/code', {
    headers: { 'x-worker-secret': secret },
    data: {
      installId,
      name: 'Invite E2E',
      os: 'windows',
      arch: 'x64',
      appVersion: '1.0.0',
      protocolVersion: 1,
    },
  });
  const { code } = await codeResponse.json();
  await page.request.post('/api/pairing/confirm', {
    headers: { origin, 'x-csrf-token': csrf },
    data: { code },
  });
  const resultResponse = await page.request.get(`/api/pairing/result?installId=${installId}`, {
    headers: { 'x-worker-secret': secret },
  });
  const { deviceId, credential } = await resultResponse.json();

  const config = await (await page.request.get('/api/config')).json();
  const socketBase = config.socketUrl || 'http://localhost:3000';
  const worker = ioClient(`${socketBase}/worker`, {
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
  const commands: Array<{ action: string }> = [];
  worker.on('control:command', (cmd) => {
    commands.push(cmd);
    worker.emit('control:ack', { commandId: cmd.commandId, status: 'executed' });
  });
  await new Promise<void>((resolve, reject) => {
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

  const createdResponse = await page.request.post(`/api/devices/${deviceId}/invitations`, {
    headers: { origin, 'x-csrf-token': csrf },
    data: { lang: 'en', hours: 2 },
  });
  expect(createdResponse.ok()).toBeTruthy();
  const { id: invitationId, url } = await createdResponse.json();
  expect(url).toMatch(/\/en\/i\?token=[0-9a-f]{64}$/);

  const speakerContext = await browser.newContext();
  const speaker = await speakerContext.newPage();
  try {
    await speaker.goto(url);
    await expect(speaker.getByRole('heading', { name: 'Speaker remote' })).toBeVisible();
    await speaker.getByRole('button', { name: 'Open remote' }).click();
    await expect(speaker).toHaveURL(/\/en\/r\//);
    expect(speaker.url()).not.toContain('token=');

    const forward = speaker.getByRole('button', { name: 'Forward' });
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].action).toBe('next');

    // Спикеру недоступен кабинет.
    await speaker.goto('/en/cabinet');
    await expect(speaker).toHaveURL(/\/en\/login/);

    // Отзыв приглашения закрывает доступ спикера.
    const revoke = await page.request.delete(`/api/invitations/${invitationId}`, {
      headers: { origin, 'x-csrf-token': csrf },
    });
    expect(revoke.ok()).toBeTruthy();
    await speaker.goto(`/en/r/${deviceId}`);
    await expect(speaker).toHaveURL(/\/en\/i/);
  } finally {
    await speakerContext.close();
    worker.disconnect();
  }
});
