import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite proxies `/api` to the OTA Fastify server in dev so the frontend
// can call platform/playground routes without CORS plumbing. The OTA
// server still answers on http://localhost:3000 directly when needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['OTA_SERVER_URL'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
