import { defineConfig } from 'vitest/config';

const postgres = Boolean(process.env.TIKIT_TEST_DATABASE_URL);

/** The API flow tests again, on the SQL store (PGlite – or Postgres when TIKIT_TEST_DATABASE_URL is set). */
export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    // Every PGlite store is its own in-memory database, but all files share one Postgres database and
    // truncate it per test, so on Postgres they must run one at a time.
    fileParallelism: !postgres,
    env: { TIKIT_TEST_STORE: postgres ? 'postgres' : 'pglite' },
  },
});
