import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg', 'cards.json'],
        manifest: {
          id: '/',
          name: 'SpiritsDex — Battle Spirits Card Database',
          short_name: 'SpiritsDex',
          description:
            '100% Offline-ready Battle Spirits trading card game English database, deck builder, and card browser.',
          theme_color: '#F7F8FA',
          background_color: '#F7F8FA',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2,json}'],
          maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /^\/cards\.json$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'bs-cards-json-v1',
                expiration: {
                  maxEntries: 4,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^\/api\/wiki\/image/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'bs-wiki-images-v1',
                expiration: {
                  maxEntries: 600,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 15,
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
                  maxEntries: 15,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      sourcemap: false,
      minify: 'esbuild',
      cssMinify: true,
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');

            // Split rarely used export, deck-import/playtest, and static fallback modules
            if (
              normalizedId.includes('/src/utils/cardShareImage') ||
              normalizedId.includes('/src/utils/deckImageExporter') ||
              normalizedId.includes('/src/utils/deckDataExporter')
            ) {
              return 'utils-exporters';
            }
            if (
              normalizedId.includes('/src/utils/decklistImport') ||
              normalizedId.includes('/src/utils/deckShare') ||
              normalizedId.includes('/src/utils/testHand') ||
              normalizedId.includes('/src/utils/cardSynergy')
            ) {
              return 'utils-deck-tools';
            }
            if (normalizedId.includes('/src/data/cards.ts')) {
              return 'data-cards';
            }

            if (!normalizedId.includes('/node_modules/')) return undefined;

            // Split Firestore engine (~413 kB) separately from Firebase App/Auth (~166 kB)
            if (
              normalizedId.includes('firebase-firestore') ||
              normalizedId.includes('/@firebase/firestore') ||
              normalizedId.includes('/firebase/firestore')
            ) {
              return 'vendor-firestore';
            }
            if (
              normalizedId.includes('/@firebase/') ||
              normalizedId.includes('/firebase/')
            ) {
              return 'vendor-firebase-core';
            }

            // Split charting libraries separately (Recharts vs D3)
            if (
              normalizedId.includes('/recharts/') ||
              normalizedId.includes('/victory-vendor/') ||
              normalizedId.includes('/es-toolkit/') ||
              normalizedId.includes('/decimal.js-light/') ||
              normalizedId.includes('/lodash')
            ) {
              return 'vendor-recharts';
            }
            if (
              normalizedId.includes('/d3') ||
              normalizedId.includes('/internmap/') ||
              normalizedId.includes('/delaunator/') ||
              normalizedId.includes('/robust-predicates/')
            ) {
              return 'vendor-d3';
            }

            if (normalizedId.includes('/lucide-react/')) return 'vendor-icons';
            if (
              normalizedId.includes('/react/') ||
              normalizedId.includes('/react-dom/') ||
              normalizedId.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
