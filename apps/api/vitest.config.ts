import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/helpers.ts'],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
});
