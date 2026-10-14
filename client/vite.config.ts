import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT || '3000';
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // Preserve Origin so the API can reject requests proxied from a foreign
      // site, while changeOrigin makes the upstream Host canonical.
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
});
