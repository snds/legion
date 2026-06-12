import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Deploy base. Root in dev; the GitHub Pages workflow sets BASE_PATH=/legion/
  // so emitted asset URLs (and import.meta.env.BASE_URL, used by src/core/assets.ts)
  // resolve under the project-pages subpath.
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@render': resolve(__dirname, 'src/render'),
      '@simulation': resolve(__dirname, 'src/simulation'),
      '@persistence': resolve(__dirname, 'src/persistence'),
      '@audio': resolve(__dirname, 'src/audio'),
      '@network': resolve(__dirname, 'src/network'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@data': resolve(__dirname, 'src/data'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          audio: ['howler', 'tone'],
          ai: ['mistreevous', 'yuka'],
          persistence: ['dexie', 'fflate'],
        },
      },
    },
  },
  server: {
    open: true,
  },
});
