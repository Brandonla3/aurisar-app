/**
 * Pure, GPU-free helpers for the sun-directional aerial-perspective fog tint
 * (see AshwoodSky._update). Kept out of AshwoodSky.js so the subtle scattering
 * maths can be unit-tested without a BABYLON global or a live scene — the
 * historical fog/sky regressions in this world have been subtle visual drifts,
 * not build breaks, so this logic earns direct coverage.
 *
 * The overworld haze warms when the camera faces toward the sun and cools when
 * facing away, sharing the sky dome's sun direction. Because it lands on the
 * single global scene.fogColor (not a per-pixel model), two things keep it from
 * reading as a camera-following colour filter rather than natural aerial
 * perspective: the toward-sun lobe is dominant while the away side is heavily
 * attenuated, and the caller eases the weight over time so a fast orbit lags.
 * Overcast weather collapses the directional cue toward neutral, since cloud
 * obscures the very sun the tint is meant to track.
 */

/**
 * Signed directional in-scattering weight for the fog tint.
 * @param {number} facing  cos angle between camera-forward and sun azimuth,
 *                         -1 (looking away) … +1 (looking toward the sun)
 * @param {number} dayF    LightingManager dayFactor  (0 night … 1 full day)
 * @param {number} dusk    LightingManager duskFactor (peaks at golden hour)
 * @param {number} wet     weather wetness 0 (clear) … 1 (overcast / rain)
 * @returns {number} positive = warm toward the sun; small negative = gentle cool
 */
export function aerialFogWeight(facing, dayF, dusk, wet) {
  const f = Number.isFinite(facing) ? facing : 0;
  // Overcast obscures the sun, so the directional cue diffuses toward neutral.
  const sunVis = sunVisibilityFromWet(wet);
  // Dominant warm lobe toward the sun; the away side is attenuated so a camera
  // orbit doesn't swing the world between two saturated extremes.
  const lobe = f > 0 ? f : f * 0.35;
  // Golden-hour dominant; ~0 at high noon (dusk→0) and at night (both →0).
  return lobe * (0.05 * dayF + 0.22 * dusk) * sunVis;
}

/**
 * How visible the sun is through the weather, 1 (clear) → 0.15 (downpour). The
 * 0.15 residual keeps a whisper of directional warmth in light rain and
 * near-nothing in a full overcast. Shared by aerialFogWeight and published on
 * the AtmosphereState so the fog tint and any readout agree on one definition.
 * @param {number} wet 0 (clear) … 1 (overcast / rain)
 * @returns {number} 0.15 … 1
 */
export function sunVisibilityFromWet(wet) {
  const w = Number.isFinite(wet) ? Math.max(0, Math.min(1, wet)) : 0;
  return 1 - 0.85 * w;
}

/**
 * Apply a directional weight to a base fog colour, writing clamped [0,1]
 * channels into `out` (a Color3-like {r,g,b}). Allocation-free: pass a scratch
 * or the live scene.fogColor. Warm = +R, +G, −B, so a positive weight reads
 * amber (toward the sun) and a negative weight reads cooler (facing away).
 * The upper clamp matters because super-unity fog reads slightly blown under
 * EXP2; the lower clamp guards the away-side cool from driving a channel < 0.
 * @returns {object} out
 */
export function applyAerialFog(out, r, g, b, w) {
  out.r = Math.min(1, Math.max(0, r + w * 0.85));
  out.g = Math.min(1, Math.max(0, g + w * 0.42));
  out.b = Math.min(1, Math.max(0, b - w * 0.75));
  return out;
}
