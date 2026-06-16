import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: false,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
