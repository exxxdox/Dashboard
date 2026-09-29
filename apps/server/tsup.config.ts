import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Native addons and worker-thread based loggers cannot be bundled: keep them
  // as real require() calls resolved from node_modules at runtime.
  external: ['better-sqlite3', 'ssh2', 'cpu-features', 'pino', 'pino-pretty'],
});
