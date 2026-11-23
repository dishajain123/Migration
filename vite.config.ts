import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The AI gateway (server/) runs as a separate local process; the browser only ever talks to /gateway.
  server: { proxy: { '/gateway': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
