import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
      // world-viewer.html (the standalone dev/QA renderer + `?qa=1` atmosphere
      // overlay + `?hud=assets` download ledger) is a build input on Netlify
      // deploy previews and branch builds — the real-GPU review surface for
      // rendering PRs and the meshopt-decode acceptance path — but kept OUT of
      // production. CONTEXT is set by Netlify ('production' | 'deploy-preview' |
      // 'branch-deploy'); unset locally, where including it lets `vite build`
      // verify the viewer entry compiles. (The SPA catch-all otherwise shadows
      // /world-viewer.html with index.html when it isn't emitted.)
      input: process.env.CONTEXT === 'production'
        ? { main: 'index.html' }
        : { main: 'index.html', worldViewer: 'world-viewer.html' },
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
