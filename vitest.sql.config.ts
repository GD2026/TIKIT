import { defineConfig } from 'vitest/config';

/** The API flow tests again, on the SQL store (PGlite – or Postgres when TIKIT_TEST_DATABASE_URL is set). */
export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    env: { TIKIT_TEST_STORE: process.env.TIKIT_TEST_DATABASE_URL ? 'postgres' : 'pglite' },
  },
});
