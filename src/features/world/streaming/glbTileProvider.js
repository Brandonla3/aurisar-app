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

// Patterns that LoadAssetContainerAsync surfaces when the underlying file
// fetch fails. Babylon wraps fetch errors inside its loader, so we match on
// substrings rather than instanceof checks. Whitelisted to "asset missing"
// shapes — anything else is treated as a real bug.
const MISSING_PATTERNS = [
  '404',
  'Not Found',
  'Failed to fetch',
  'unable to load',
  'load from',          // Babylon's loader prefix when fetch itself rejects
  'NetworkError',
];

function looksLikeMissing(err) {
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
