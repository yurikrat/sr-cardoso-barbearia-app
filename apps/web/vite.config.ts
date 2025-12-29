import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      includeAssets: [
        'favicon.ico',
        'favicon-32x32.png',
        'favicon-16x16.png',
        'apple-touch-icon.png',
        'mask-icon.svg',
      ],
      manifest: {
        name: 'Sr. Cardoso Barbearia',
        short_name: 'Sr. Cardoso',
        description: 'Agende seu horário na Barbearia Sr. Cardoso',
        theme_color: '#0B0C0D',
        background_color: '#0B0C0D',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join('/');

          if (!normalizedId.includes('/node_modules/')) return;

          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/react-router-dom/')
          ) {
            return 'react';
          }

          if (normalizedId.includes('/node_modules/@radix-ui/')) return 'radix';
          if (normalizedId.includes('/node_modules/@tanstack/')) return 'tanstack';
          if (normalizedId.includes('/node_modules/exceljs/')) return 'exceljs';
          if (
            normalizedId.includes('/node_modules/luxon/') ||
            normalizedId.includes('/node_modules/date-fns/')
          ) {
            return 'dates';
          }

          return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      // Proxy para o servidor de ingestão do DEBUG MODE (evita CORS no browser)
      '/ingest': {
        target: 'http://127.0.0.1:7242',
        changeOrigin: true,
      },
    },
  },
});
