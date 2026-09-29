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
  //
  // The Alibaba Cloud SDK is external for a different reason: it is generated
  // CJS covering an entire product API, and bundling it would inline megabytes
  // of code that esbuild then has to wrap for ESM. It is used from two call
  // sites.
  external: [
    'better-sqlite3',
    'ssh2',
    'cpu-features',
    'pino',
    'pino-pretty',
    '@alicloud/alidns20150109',
    '@alicloud/openapi-client',
    '@alicloud/tea-util',
  ],
});
