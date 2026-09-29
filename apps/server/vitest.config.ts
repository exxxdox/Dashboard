import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // SQLite files and temp dirs are per-test; keep them isolated.
    pool: 'forks',
  },
});
