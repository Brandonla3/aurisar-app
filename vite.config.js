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
      // world-viewer.html (the standalone dev/QA renderer — `?qa=1` atmosphere
      // overlay, `?hud=assets` download ledger, the meshopt-decode acceptance
      // path) is a build input on Netlify deploy previews / branch builds and
      // locally, giving rendering PRs a real-GPU review surface, but kept OUT of
      // production. On non-prod it MUST be emitted or the SPA catch-all shadows
      // /world-viewer.html with index.html.
      //
      // Production keeps Vite's DEFAULT single index.html entry (no `input`
      // override): naming an explicit production entry perturbed rolldown's chunk
      // splitting — it broke the babylon decoders out into their own chunk that
      // reads the ambient BABYLON global before it is set — so prod stays default.
      // CONTEXT is set by Netlify ('production' | 'deploy-preview' | 'branch-deploy').
      ...(process.env.CONTEXT === 'production'
        ? {}
        : { input: { main: 'index.html', worldViewer: 'world-viewer.html' } }),
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
