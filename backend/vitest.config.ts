import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false, // integration tests share one database
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
