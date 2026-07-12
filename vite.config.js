import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const WATER_PROVIDER_SUFFIX = '/src/features/world/streaming/ashwoodTileProvider.js'
const UNSAFE_PLANAR_REFLECTION =
  "const reflect = (scene.metadata?.ashwood?.qualityTier ?? 'high') === 'high';"
const SAFE_PLANAR_REFLECTION =
  'const reflect = false; // Disabled: whole-scene MirrorTexture sampled its active render target.'

/**
 * Emergency desktop-stability guard.
 *
 * The lake water path used a whole-scene MirrorTexture (`renderList = null`)
 * while the lake material sampled that same texture. WebGL correctly rejects
 * that framebuffer/texture feedback loop and eventually loses the context.
 *
 * Keep the water shader, waves, Fresnel sky reflection, fog and lighting, but
 * force the unsafe planar mirror off in both Vite dev and production builds.
 * Remove this guard only after the source implementation uses an explicit
 * render list that excludes every mesh sampling the mirror target.
 */
export function disableUnsafeWaterMirror() {
  return {
    name: 'aurisar-disable-unsafe-water-mirror',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?', 1)[0].replaceAll('\\', '/')
      if (!normalizedId.endsWith(WATER_PROVIDER_SUFFIX)) return null

      if (code.includes(SAFE_PLANAR_REFLECTION)) {
        return { code, map: null }
      }
      if (!code.includes(UNSAFE_PLANAR_REFLECTION)) {
        throw new Error(
          '[aurisar-disable-unsafe-water-mirror] Expected lake reflection activation was not found; review ashwoodTileProvider.js before allowing the build.'
        )
      }

      return {
        code: code.replace(UNSAFE_PLANAR_REFLECTION, SAFE_PLANAR_REFLECTION),
        map: null,
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [disableUnsafeWaterMirror(), react()],
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
      output: {
        // Split heavy libraries into their own chunks so the main bundle
        // doesn't pay for three.js / recharts on first paint. Combined with
        // React.lazy at the call sites, these chunks only load on demand.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
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
