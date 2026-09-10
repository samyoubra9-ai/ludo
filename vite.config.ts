import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const api = process.env.VITE_API_PROXY || 'http://127.0.0.1:8787'
const ws = api.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-caisse-192.png',
        'pwa-caisse-512.png',
        'pwa-admin-192.png',
        'pwa-admin-512.png',
        'caisse.webmanifest',
        'admin.webmanifest',
      ],
      manifest: {
        id: '/',
        name: 'Ludo',
        short_name: 'Ludo',
        description: 'Ludo en ligne — parties en solo, matchmaking ou salon.',
        lang: 'fr',
        theme_color: '#12104a',
        background_color: '#12104a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': api,
      '/ws': {
        target: ws,
        ws: true,
      },
    },
  },
  optimizeDeps: {
    include: ['phaser'],
  },
})
