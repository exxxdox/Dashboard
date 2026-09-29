import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // Source maps were 2.8 MB of the 3.5 MB client the image ships -- 79% of
    // it, for files only a browser's devtools ever reads, and the container is
    // the build this project actually distributes. Turn them back on here when
    // the output needs stepping through.
    sourcemap: false,
  },
  server: {
    port: 5173,
    // In dev the API runs on its own port; in the container the same origin
    // serves both, so this proxy only exists for `pnpm dev`.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
