import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

// Dev-only write-back: "Save as default" in the Settings/LAB panels POSTs the
// current look here, and it lands in src/config/*.json — COMMITTED defaults
// that survive server restarts, new browsers, and ship with every deploy
// (unlike localStorage, which is one browser profile away from gone). The
// watcher ignores src/config so a save doesn't hot-reload the page mid-tuning;
// the file is simply the boot source from the next load onward.
const SAVE_TARGETS: Record<string, string> = {
  galaxy: 'src/config/galaxy-defaults.json',
  visual: 'src/config/visual-defaults.json',
};
const saveDefaultsEndpoint = (): Plugin => ({
  name: 'legion-save-defaults',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__legion/save-defaults', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        try {
          const { target, json } = JSON.parse(body) as { target?: string; json?: unknown };
          const file = target ? SAVE_TARGETS[target] : undefined;
          if (!file || typeof json !== 'object' || json === null) {
            res.statusCode = 400; res.end('bad target/json'); return;
          }
          writeFileSync(resolve(__dirname, file), JSON.stringify(json, null, 2) + '\n');
          res.statusCode = 200; res.end('ok');
        } catch (err) {
          res.statusCode = 500; res.end(String(err));
        }
      });
    });
  },
});

export default defineConfig({
  // Deploy base. Root in dev; the GitHub Pages workflow sets BASE_PATH=/legion/
  // so emitted asset URLs (and import.meta.env.BASE_URL, used by src/core/assets.ts)
  // resolve under the project-pages subpath.
  base: process.env.BASE_PATH ?? '/',
  plugins: [saveDefaultsEndpoint()],
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
    watch: {
      // Saving defaults writes these; don't yank the page out from under the
      // tuner with a hot reload — the file takes effect on the NEXT load.
      ignored: ['**/src/config/*.json'],
    },
  },
});
