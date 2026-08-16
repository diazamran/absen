import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://presensiku:presensiku123@localhost:5432/presensiku_test';

export default defineConfig({
  test: {
    environment: 'node',
    // Pastikan seluruh modul (termasuk lib/prisma.ts) membaca DATABASE_URL test,
    // bukan database development, sehingga database dev tidak pernah ditimpa.
    env: {
      DATABASE_URL: TEST_DB,
      TEST_DATABASE_URL: TEST_DB,
      NODE_ENV: 'test',
      OTP_DEV_PREVIEW: 'true',
    },
    setupFiles: ['./tests/helpers.ts'],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
});
