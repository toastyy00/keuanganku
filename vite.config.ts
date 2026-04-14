import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  const basePath = process.env.VITE_APP_BASE_PATH || '/';

  return {
  base: isDemo ? basePath : '/',
  plugins: [
    react(),
    VitePWA({
      disable: isDemo,
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Keuanganku',
        short_name: 'Keuanganku',
        description: 'Pencatat pengeluaran pribadi',
        theme_color: '#1A1A1A',
        background_color: '#1A1A1A',
        display: 'standalone',
        start_url: '/',
        lang: 'id',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Activate new SW immediately — no waiting for tab close
        skipWaiting: true,
        clientsClaim: true,
        // Precache all built assets except index.html (must be network-first)
        globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
        // SPA navigation fallback
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/config\.js/],
        runtimeCaching: [
          {
            // index.html — NetworkFirst so new deploys are picked up
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Google Fonts — CacheFirst, max 30 days
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            // Supabase API calls — NetworkFirst, fallback to cache
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            // Exchange rate API — NetworkFirst
            urlPattern: /^https:\/\/api\.frankfurter\.(app|dev)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'exchange-rate-cache',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 6, // 6 hours
              },
            },
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
  server: {
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) {
              return 'vendor-react';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (id.includes('@number-flow') || id.includes('lucide-react')) {
              return 'vendor-ui';
            }
          }
        },
      },
    },
  },
};
});
