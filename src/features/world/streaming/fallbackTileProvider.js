/**
 * FallbackTileProvider — tries a primary provider, recovers via a fallback.
 *
 * Used so we can ship a few authored GLB tiles while the rest of the 8×8
 * grid stays procedural — `GlbTileProvider` 404s for unauthored tiles, and
 * this wrapper catches the error and delegates to `ProceduralTileProvider`
 * transparently. From `TileLoader`'s perspective, the wrapper IS just a
 * provider — it conforms to the same `.load(meta, scene)` contract.
 *
 * The fallback only triggers on the well-defined "tile missing" failure
 * shape (see GlbTileProvider's TileFetchError). Unrelated errors (corrupt
 * GLB, parser crash, etc.) propagate so they don't get silently masked.
 */

import { TileFetchError } from './glbTileProvider.js';

export class FallbackTileProvider {
  constructor(primary, fallback) {
    if (!primary || typeof primary.load !== 'function') {
      throw new Error('FallbackTileProvider: primary provider with .load() required');
    }
    if (!fallback || typeof fallback.load !== 'function') {
      throw new Error('FallbackTileProvider: fallback provider with .load() required');
    }
    this.primary = primary;
    this.fallback = fallback;
  }

  async load(meta, scene) {
    try {
      return await this.primary.load(meta, scene);
    } catch (err) {
      if (err instanceof TileFetchError) {
        // Expected — tile GLB simply isn't authored yet. Use fallback silently.
        return this.fallback.load(meta, scene);
      }
      throw err; // bubble up: bad GLB, parser crash, etc.
    }
  }
}
