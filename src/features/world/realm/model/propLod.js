/**
 * propLod — camera-cell LOD: which stage does each chunk's prop field
 * render right now?
 *
 * PURE. The whole policy in one sentence: quantize the camera to a coarse
 * cell, band chunks by distance from that CELL (never the raw camera), and
 * only a cell CROSSING can change any assignment — so orbiting, strafing,
 * or spinning inside a cell provably reassigns nothing, and a crossing
 * batches every change into one discrete, countable rebuild set.
 *
 * Tiers are per (chunk), not per instance: a chunk's props swap stage
 * together. Bands in meters, measured center-to-center:
 *   NEAR  → stage 0 (full detail)
 *   MID   → stage 1 (or a prototype's last stage if it has fewer)
 *   FAR   → nothing renders; the terrain shader's vegetation tint takes
 *           over (vegDensity.js) — the drop-shipped tier.
 *
 * Hysteresis: a chunk must cross a band boundary by HYST_M before flipping,
 * the same wider-exit-than-entry shape chunkMath's load/unload rings and
 * shadowCadence's near/far bucket already use.
 */

import { CHUNK_SIZE_M } from './chunkMath.js';

export const CAMERA_CELL_M = 8;

export const PROP_TIER = Object.freeze({ NEAR: 0, MID: 1, FAR: 2 });

/** Band edges, center-to-center. NEAR ends at ~1.5 chunks, MID at ~2.5 —
 *  MID's outer edge is what the terrain tint's FAR_START must match. */
export const TIER_BANDS_M = Object.freeze({
  nearMaxM: 1.5 * CHUNK_SIZE_M, // 96
  midMaxM: 2.5 * CHUNK_SIZE_M, // 160
});
export const TIER_HYST_M = 12;

/** Quantize a camera position to its cell (integer coords). */
export function cameraCellOf(x, z) {
  return { cellX: Math.floor(x / CAMERA_CELL_M), cellZ: Math.floor(z / CAMERA_CELL_M) };
}

/** The cell's CENTER — every distance measures from here, so any position
 *  inside the cell yields the identical assignment set. */
export function cellCenter(cell) {
  return {
    x: (cell.cellX + 0.5) * CAMERA_CELL_M,
    z: (cell.cellZ + 0.5) * CAMERA_CELL_M,
  };
}

/**
 * Tier for one chunk from one camera cell, with hysteresis against the
 * chunk's previous tier: moving OUTWARD needs distance > bandMax + HYST,
 * moving INWARD needs distance < bandMax - HYST.
 */
export function tierForChunk(cell, cx, cz, prevTier = null) {
  const c = cellCenter(cell);
  const chunkCenterX = (cx + 0.5) * CHUNK_SIZE_M;
  const chunkCenterZ = (cz + 0.5) * CHUNK_SIZE_M;
  const d = Math.hypot(chunkCenterX - c.x, chunkCenterZ - c.z);

  const edge = (bandMax, movingOut) => bandMax + (movingOut ? TIER_HYST_M : -TIER_HYST_M);

  if (prevTier === null) {
    if (d <= TIER_BANDS_M.nearMaxM) return PROP_TIER.NEAR;
    if (d <= TIER_BANDS_M.midMaxM) return PROP_TIER.MID;
    return PROP_TIER.FAR;
  }
  // Resolve from the previous tier outward/inward with the band's slack.
  if (prevTier === PROP_TIER.NEAR) {
    if (d <= edge(TIER_BANDS_M.nearMaxM, true)) return PROP_TIER.NEAR;
    return d <= edge(TIER_BANDS_M.midMaxM, true) ? PROP_TIER.MID : PROP_TIER.FAR;
  }
  if (prevTier === PROP_TIER.MID) {
    if (d < edge(TIER_BANDS_M.nearMaxM, false)) return PROP_TIER.NEAR;
    if (d <= edge(TIER_BANDS_M.midMaxM, true)) return PROP_TIER.MID;
    return PROP_TIER.FAR;
  }
  // prev FAR:
  if (d < edge(TIER_BANDS_M.nearMaxM, false)) return PROP_TIER.NEAR;
  if (d < edge(TIER_BANDS_M.midMaxM, false)) return PROP_TIER.MID;
  return PROP_TIER.FAR;
}

/**
 * Diff assignments across a cell crossing: `prev` and chunks are the
 * resident set; returns ONLY the chunks whose tier changed, so the caller's
 * rebuild work is exactly this list's length — the number the budget census
 * caps as rebuildsPerCrossing.
 *
 * @param {Map<string, number>} prevTiers chunkId -> tier
 * @param {{cx, cz, id}[]} chunks resident chunk descriptors
 */
export function diffTiers(prevTiers, chunks, cell) {
  const changes = [];
  const next = new Map();
  for (const ch of chunks) {
    const prev = prevTiers.get(ch.id) ?? null;
    const tier = tierForChunk(cell, ch.cx, ch.cz, prev);
    next.set(ch.id, tier);
    if (tier !== prev) changes.push({ ...ch, from: prev, to: tier });
  }
  return { next, changes };
}
