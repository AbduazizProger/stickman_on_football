import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html', pad: 'pad.html' } },
  },
});
