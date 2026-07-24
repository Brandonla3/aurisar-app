/**
 * babylonDecoders — point Babylon's glTF compression decoders at same-origin
 * self-hosted builds instead of the Babylon CDN.
 *
 * Our runtime GLBs are geometry-compressed with EXT_meshopt_compression
 * (scripts/assets_pipeline.mjs). Babylon's loader decodes that extension via
 * `MeshoptCompression`, whose default decoder URL is
 * `https://cdn.babylonjs.com/meshopt_decoder.js`. On a locked-down / offline
 * deploy that CDN fetch fails and every meshopt GLB silently falls back to
 * "unsupported" and fails to load. Repointing at the vendored
 * `/babylon/meshopt_decoder.js` (scripts/vendor_meshopt_decoder.mjs) keeps
 * decoding same-origin with no network dependency.
 *
 * Call once, before the first GLB loads, from every Babylon entry point
 * (WorldGame, devWorldViewer, AvatarPreview, CharacterTurntable). Idempotent
 * and defensive — a Babylon build without MeshoptCompression is a no-op.
 */

/* global BABYLON */

let _done = false;

export function configureBabylonDecoders(B = (typeof window !== 'undefined' ? window.BABYLON : undefined)) {
  if (_done) return;
  const babylon = B ?? (typeof BABYLON !== 'undefined' ? BABYLON : undefined);
  if (!babylon) return; // called before the UMD global exists — caller retries
  const cfg = babylon.MeshoptCompression?.Configuration;
  if (cfg?.decoder) {
    cfg.decoder.url = '/babylon/meshopt_decoder.js';
    _done = true;
  } else {
    // Babylon is present but the meshopt config isn't where we expect it — the
    // decoder would then default to the Babylon CDN, which our CSP blocks, and
    // every meshopt GLB would silently fail. Make that loud instead of a
    // baffling "all models missing" report.
    console.warn('[babylonDecoders] MeshoptCompression.Configuration.decoder not found — ' +
      'meshopt GLBs may fail to load (Babylon version change?). Expected same-origin /babylon/meshopt_decoder.js.');
  }
}
