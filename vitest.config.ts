import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@clickerfree/contracts',
        replacement: fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      },
      {
        find: '@clickerfree/db',
        replacement: fileURLToPath(new URL('./db/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'db/test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
