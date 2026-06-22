import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  // Production builds publish to GitHub Pages under `/loam/`, so the
  // bundled HTML must reference assets at that subpath. Dev server
  // keeps `/` so `pnpm dev` stays usable at the bare port.
  base: command === 'build' ? '/loam/' : '/',
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
