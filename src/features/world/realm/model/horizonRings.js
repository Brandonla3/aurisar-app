/**
 * horizonRings — the crag silhouette rings, painted by ELEVATION not FOG.
 *
 * PURE. This is the resolution to the fog double-booking conflict: distant
 * "mountains ringing the vale" are not terrain hidden by fog extinction —
 * they never enter the fog equation at all. A ring card's color comes from
 * the SAME sky-gradient function the dome uses (model/skyModel.js), evaluated
 * at the ring's own geometric view-elevation angle, which is DISTANCE-
 * INDEPENDENT. A near-tuned fogDensity can never wash it out, because there
 * was never a distance term to saturate.
 *
 * Ring radii derive from TerrainStreamer's own radius * CHUNK_SIZE_M rather
 * than independent hand-picked constants — the streamed disc and the ring
 * kit move together if the streaming radius ever changes.
 */

import { CHUNK_SIZE_M, DEFAULT_STREAM_RADIUS_CHUNKS } from './chunkMath.js';
import { GRADIENT_DEF } from './skyModel.js';

/**
 * Streamed radius today is DEFAULT_STREAM_RADIUS_CHUNKS * 64m = 192m; rings
 * start just beyond it. Reads TerrainStreamer's own default constant rather
 * than repeating the number `3` — if that default ever changes, this moves
 * with it instead of silently disagreeing. A streamer built with an explicit
 * `{ radius }` override is a deliberate, separate divergence (see
 * chunkMath.js's doc comment on the constant) — this models the streamer's
 * DEFAULT configuration, which is what the spike and all current tests use.
 */
const STREAMED_RADIUS_M = DEFAULT_STREAM_RADIUS_CHUNKS * CHUNK_SIZE_M;

/**
 * Integer multiples of the streamed radius, not independent decimals close to
 * a target number — so "derived from the streamer" is an exact, checkable
 * relationship rather than a coincidence that happens to hold today. Lands
 * near the original 600/950/1400m design targets (576/960/1344m) while
 * staying exactly reconstructible from STREAMED_RADIUS_M.
 */
export const RING_TIERS = Object.freeze([
  { id: 'near', radiusM: STREAMED_RADIUS_M * 3, heightM: 140, darken: 0.22 },
  { id: 'mid', radiusM: STREAMED_RADIUS_M * 5, heightM: 210, darken: 0.42 },
  { id: 'far', radiusM: STREAMED_RADIUS_M * 7, heightM: 300, darken: 0.62 },
]);

/**
 * A ring card's view-elevation, in EXACTLY the convention skyDomeNME's
 * shader uses: `clamp(normalize(worldPos - cameraPosition).y, 0, 1)`. This
 * is not a separate approximation of elevation — it IS the y-component of
 * the normalized view vector, i.e. sin(angle above horizontal), which is
 * what a shader computes from real vertex/camera positions with zero trig
 * function calls. Ring geometry reuses the SAME view-direction subgraph the
 * dome uses (view/materials/bsl/standardVertex.js), so this pure function is
 * a true reference implementation of the shader's output — the "one
 * function, two evaluators" pattern skyModel.js established, extended to
 * ring elevation. `radiusM` is horizontal distance; `heightM` the ring
 * feature's world Y; `cameraY` the viewer's height.
 */
export function ringElevation(radiusM, heightM, cameraY = 1.6) {
  const dy = heightM - cameraY;
  const dist = Math.hypot(radiusM, dy);
  return Math.min(Math.max(dy / dist, 0), 1);
}

/**
 * The full paint decision for one ring tier at one moment: elevation (from
 * geometry alone) plus the tier's authored darken amount. Consumed by the
 * ring material's applyState — mirrors the dome's applyState shape so the
 * two can share the same skyState-derived call site.
 */
export function ringPaintFor(tier, cameraY = 1.6) {
  return {
    elevation: ringElevation(tier.radiusM, tier.heightM, cameraY),
    darken: tier.darken,
  };
}

/** True if every authored ring tier stays clear of the zenith band. */
export function ringsStayBelowZenith(cameraY = 1.6) {
  return RING_TIERS.every(
    (t) => ringElevation(t.radiusM, t.heightM, cameraY) < GRADIENT_DEF.zenithStart,
  );
}
