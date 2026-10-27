import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isHttps = mode === 'https' || process.env.HTTPS === 'true';

  const pwaPlugin = VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.png', 'brand-logo.png', 'icon.png'],
    manifest: {
      name: 'PhotoCapture - Field Audit Platform',
      short_name: 'PhotoCapture',
      description: 'Geotagged site inspection and field audit camera app with real-time GPS synchronization',
      theme_color: '#ffffff',
      background_color: '#f8fafc',
      display: 'standalone',
      orientation: 'portrait',
      scope: '/app/',
      start_url: '/app/',
      categories: ['productivity', 'business', 'utilities'],
      icons: [
        {
          src: '/app/brand-logo.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/app/brand-logo.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/app/brand-logo.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
      shortcuts: [
        {
          name: 'Open Camera',
          short_name: 'Camera',
          description: 'Take new field inspection photos',
          url: '/app/#camera',
          icons: [{ src: '/app/brand-logo.png', sizes: '192x192' }],
        },
        {
          name: 'Assigned Tasks',
          short_name: 'Tasks',
          description: 'View pending field audit tasks',
          url: '/app/#records',
          icons: [{ src: '/app/brand-logo.png', sizes: '192x192' }],
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'google-fonts-cache',
            expiration: {
              maxEntries: 10,
              maxAgeSeconds: 60 * 60 * 24 * 365,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
        {
          urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'gstatic-fonts-cache',
            expiration: {
              maxEntries: 10,
              maxAgeSeconds: 60 * 60 * 24 * 365,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
      ],
    },
  });

  return {
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    base: '/app/',
    plugins: isHttps ? [react(), basicSsl(), pwaPlugin] : [react(), pwaPlugin],
    server: {
      port: 5174,
      host: true,
      https: isHttps ? {} : false,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8005',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://127.0.0.1:8005',
          changeOrigin: true,
        },
      },
    },
  };
});
