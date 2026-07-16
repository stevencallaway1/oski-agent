import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 10_000,
  },
});
