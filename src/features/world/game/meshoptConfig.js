/**
 * meshoptConfig — point Babylon's EXT_meshopt_compression support at the
 * decoder we ship ourselves.
 *
 * Babylon defaults to fetching https://cdn.babylonjs.com/meshopt_decoder.js,
 * which the production CSP (script-src 'self' …) blocks — so every
 * meshopt-compressed GLB (all of public/assets/props/) failed to load and
 * the starter town never rendered. The decoder is copied from the
 * `meshoptimizer` npm package by scripts/build_village_glb.mjs
 * (`npm run build:village`); it registers the global `MeshoptDecoder` when
 * loaded as a plain script, exactly what Babylon expects.
 *
 * Must run before the FIRST SceneLoader call that touches a meshopt GLB:
 * MeshoptCompression.Default caches its decoder promise on first use, so a
 * late configuration is silently ignored.
 */

/* global BABYLON */

let configured = false;

export function configureMeshoptDecoder() {
  if (configured || typeof BABYLON === 'undefined' || !BABYLON.MeshoptCompression) return;
  BABYLON.MeshoptCompression.Configuration = {
    decoder: { url: '/vendor/meshopt_decoder.js' },
  };
  configured = true;
}
