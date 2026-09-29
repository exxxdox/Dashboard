import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2023',
  dts: true,
  clean: true,
  sourcemap: true,
  // zod stays external so the server and the web bundle each dedupe their own
  // copy instead of shipping a second one inside this package's output.
  external: ['zod'],
});
