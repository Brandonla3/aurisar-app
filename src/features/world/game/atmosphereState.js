/**
 * AtmosphereState — the single per-frame source of truth for the overworld
 * atmosphere, published at `scene.metadata.ashwood.atmosphere`.
 *
 * CONTRACT
 *   Writer (sole): AshwoodSky._update. It runs every overworld frame, after
 *   LightingManager, and already owns the sky palette and the final
 *   scene.fogColor / scene.fogDensity write. It computes the sun direction ONCE
 *   (normalized, ground→sun) and publishes it here.
 *   Readers: the grass (grassBlades) and water (ashwoodTileProvider) shaders'
 *   per-frame uniform binds. They read sunDir from here instead of each
 *   recomputing `sun = -key.direction` — the drift the #273 review flagged,
 *   where sky, grass, and water each derived the sun independently.
 *   Fallback: absent before the first overworld frame, and in dungeons (the LM
 *   owns dungeon fog and there is no grass/water there). Readers keep their
 *   local key-light path as a fallback, so this is a consistency/optimization
 *   layer, never a hard dependency.
 *
 * FIELDS
 *   sunDir        BABYLON.Vector3  normalized ground→sun (the shaders' light L);
 *                                  a LIVE reference to the sky's own scratch, so
 *                                  it is always the current frame's value.
 *   fogColor      BABYLON.Color3   === scene.fogColor (LIVE ref; the final
 *                                  aerial-perspective-tinted value).
 *   sunVisibility number 0..1      1 clear → 0.15 overcast (cloud hides the sun;
 *                                  see sunVisibilityFromWet).
 *   fogDensity    number           === scene.fogDensity.
 *   dayFactor     number 0..1      night → full day.
 *   duskFactor    number           golden-hour weight.
 *   night         number 0..1.
 *   facingWeight  number           the eased sun-directional aerial-perspective
 *                                  weight actually applied this frame (QA/debug).
 */

/**
 * Build the atmosphere-state bag. `sunDirRef` and `fogColorRef` are stored by
 * REFERENCE (the sky's own scratch Vector3 and scene.fogColor), so the writer
 * mutates them in place each frame and readers always see the live value with
 * no copy. Scalars are seeded to a benign clear-day default for the frames
 * before the first write.
 * @param {BABYLON.Vector3} sunDirRef
 * @param {BABYLON.Color3}  fogColorRef
 */
export function createAtmosphereState(sunDirRef, fogColorRef) {
  return {
    sunDir: sunDirRef,
    fogColor: fogColorRef,
    sunVisibility: 1,
    fogDensity: 0,
    dayFactor: 1,
    duskFactor: 0,
    night: 0,
    facingWeight: 0,
  };
}

/**
 * Sun elevation above the horizon in degrees, from a ground→sun unit vector —
 * for the dev Atmosphere-QA readout. Clamps y so a slightly non-unit vector
 * can't push asin out of its domain.
 * @param {BABYLON.Vector3|{y:number}|null} sunDir
 * @returns {number} -90 … 90
 */
export function sunElevationDeg(sunDir) {
  if (!sunDir || !Number.isFinite(sunDir.y)) return 0;
  const y = Math.max(-1, Math.min(1, sunDir.y));
  return (Math.asin(y) * 180) / Math.PI;
}
