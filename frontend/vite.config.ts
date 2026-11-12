import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

const apiTarget = process.env.VITE_API_PROXY || 'http://127.0.0.1:8000';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,webp,svg,woff2,ico}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      devOptions: { enabled: false, type: 'module' },
      includeAssets: ['favicon.png', 'logo.png', 'logo.webp', 'icons/*.png'],
      manifest: {
        name: 'RLWM Church Management System',
        short_name: 'RLWM CMIS',
        description: 'Rivers of Living Water Ministries (Holy Ghost Bible Church) — Church Management Information System',
        theme_color: '#1d3fa6',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false }, '/media': { target: apiTarget } },
  },
  preview: { port: 4173, proxy: { '/api': { target: apiTarget }, '/media': { target: apiTarget } } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], map: ['leaflet', 'react-leaflet'], vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'dexie'] },
      },
    },
  },
});
