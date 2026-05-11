/**
 * GlbTileProvider — downloads tile content as a GLB from meta.renderUrl.
 *
 * Matches the AssetLibrary convention of consuming the BABYLON global.
 * Returns a Babylon AssetContainer so TileLoader can manage its lifecycle.
 *
 * Failure shape:
 *   - "Tile asset not present" (404, network refused) is surfaced as a
 *     `TileFetchError` so `FallbackTileProvider` can catch it and fall back
 *     to procedural generation silently.
 *   - Any other failure (corrupt GLB, parser crash, malformed JSON) is
 *     re-thrown as-is so it surfaces in the console — masking those would
 *     hide real bugs.
 */

/* global BABYLON */

export class TileFetchError extends Error {
  constructor(url, cause) {
    super(`Tile asset not present at ${url}`);
    this.name = 'TileFetchError';
    this.url = url;
    this.cause = cause;
  }
}

// Narrow set of patterns that mean "the file isn't on the server." Earlier
// versions included broader strings like 'load from' and 'unable to load',
// but those swallowed legitimate parser / runtime loader failures too —
// hiding real authored-GLB regressions behind a silent procedural fallback
// (Codex P2 on #191). Now we only match patterns that unambiguously
// indicate an HTTP 404 or network-level fetch refusal.
const MISSING_PATTERNS = [
  '404',
  'Not Found',
  'Failed to fetch',   // Chromium fetch rejection
  'NetworkError',      // Firefox fetch rejection
];

function looksLikeMissing(err) {
  // Direct HTTP status check first — Babylon's WebRequest exposes .status
  // on some failure modes and this is more reliable than substring matching.
  const status = err?.request?.status ?? err?.status;
  if (status === 404) return true;
  const msg = String(err?.message ?? err ?? '');
  return MISSING_PATTERNS.some((p) => msg.includes(p));
}

export class GlbTileProvider {
  async load(meta, scene) {
    const lastSlash = meta.renderUrl.lastIndexOf('/');
    const dir = lastSlash >= 0 ? meta.renderUrl.slice(0, lastSlash + 1) : '';
    const file = lastSlash >= 0 ? meta.renderUrl.slice(lastSlash + 1) : meta.renderUrl;
    try {
      return await BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
    } catch (err) {
      if (looksLikeMissing(err)) {
        throw new TileFetchError(meta.renderUrl, err);
      }
      throw err;
    }
  }
}
