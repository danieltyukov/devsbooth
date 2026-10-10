import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.DEVSBOOTH_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': server,
      '/uploads': server,
      '/socket.io': { target: server, ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
