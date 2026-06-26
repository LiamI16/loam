import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  // Production builds publish to GitHub Pages under `/loam/`, so the
  // bundled HTML must reference assets at that subpath. Dev server
  // keeps `/` so `pnpm dev` stays usable at the bare port.
  base: command === 'build' ? '/loam/' : '/',
  plugins: [
    VitePWA({
      // Prompt-based update so a silent reload never interrupts audio
      // mid-session; main.ts surfaces a toast and waits for user consent.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Loam',
        short_name: 'Loam',
        description: 'Offline, infinite, on-device generative lo-fi.',
        theme_color: '#e8a35a',
        background_color: '#15100d',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the built JS/CSS/HTML so the app loads with no network
        // after first visit. globPatterns covers Vite's hashed outputs.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Without this, navigations to /loam/ would fall through to the
        // network when offline; the SW serves index.html from cache instead.
        navigateFallback: 'index.html',
      },
    }),
  ],
  // Resolve workspace packages straight to their source so library edits HMR
  // immediately. Without this, `@loam/core` etc. resolve to `dist/index.js`,
  // which requires a manual `tsup` rebuild after every change — easy to
  // forget. Vite handles the TS source natively.
  resolve: {
    alias: {
      '@loam/core': resolve(here, '../../packages/core/src/index.ts'),
      '@loam/synth-tone': resolve(here, '../../packages/synth-tone/src/index.ts'),
    },
  },
  server: {
    open: false,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
}));
