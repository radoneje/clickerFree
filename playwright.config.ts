import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'node scripts/e2e-servers.mjs',
    url: 'http://localhost:3000/ru/login',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
