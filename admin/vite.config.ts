import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
    },
  },
})
