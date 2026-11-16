import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { io as ioClient } from 'socket.io-client';

test('remote switches slides through a worker and keeps the timer across reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Уникальный dev-пользователь: общий dev-user мог сменить язык профиля в других тестах.
  await page.goto('/api/auth/dev/start?dev_user=remote-e2e');
  await expect(page).toHaveURL(/\/ru\/cabinet/);

  const secret = randomBytes(32).toString('base64url');
  const installId = randomUUID();
  const csrf = (await page.context().cookies()).find((c) => c.name === 'cf_csrf')?.value ?? '';
  const codeResponse = await page.request.post('/api/pairing/code', {
    headers: { 'x-worker-secret': secret },
    data: {
      installId,
      name: 'E2E PC',
      os: 'windows',
      arch: 'x64',
      appVersion: '1.0.0',
      protocolVersion: 1,
    },
  });
  expect(codeResponse.ok(), await codeResponse.text()).toBeTruthy();
  const { code } = await codeResponse.json();
  const confirmResponse = await page.request.post('/api/pairing/confirm', {
    headers: { origin: 'http://localhost:3000', 'x-csrf-token': csrf },
    data: { code },
  });
  expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();
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

  try {
    await page.goto(`/ru/remote/${deviceId}`);
    const forward = page.getByRole('button', { name: 'Вперёд' });
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].action).toBe('next');

    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1].action).toBe('previous');

    await page.getByRole('button', { name: '5 мин', exact: true }).click();
    await expect(page.getByTestId('timer-display')).toHaveText(/0[45]:\d{2}/);

    await page.reload();
    await expect(page.getByTestId('timer-display')).toHaveText(/0[45]:\d{2}/);
    await expect(forward).toBeEnabled();
  } finally {
    worker.disconnect();
  }
});
