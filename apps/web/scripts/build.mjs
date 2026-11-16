import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Сборка всегда продакшен-режим, даже если окружение задаёт NODE_ENV=development.
process.env.NODE_ENV = 'production';
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
