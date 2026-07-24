import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: true,
  },
  build: {
    outDir: 'build',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      // Emit the dev world viewer as a real build entry so /world-viewer.html
      // is served on deploy previews (the SPA catch-all otherwise shadows it
      // with index.html). It's the acceptance surface for the meshopt decode
      // path + ?hud=assets ledger. `main` must be listed too or Vite drops it.
      input: {
        main: r('./index.html'),
        'world-viewer': r('./world-viewer.html'),
      },
      output: {
        // Split heavy libraries into their own chunks so the main bundle
        // doesn't pay for recharts on first paint. Combined with React.lazy at
        // the call sites, these chunks only load on demand.
        manualChunks(id) {
          if (id.includes('node_modules/babylonjs')) return 'babylon';
          if (id.includes('node_modules/recharts/')) return 'recharts';
          if (id.includes('node_modules/@supabase/')) return 'supabase';
          // Static exercise + class data is ~1.7MB pre-gzip. Keeping it in
          // its own chunk lets the browser fetch it in parallel with the main
          // app bundle and lets HTTP caches reuse it across deploys when only
          // app code changes. Follow-up: refactor consumers (see App.js + 98
          // EXERCISES/EX_BY_ID call sites) so this chunk can be loaded async.
          if (id.includes('/src/data/exercises.js') ||
              id.includes('/src/data/constants.js')) return 'exercise-data';
        },
      },
    },
  },
})
