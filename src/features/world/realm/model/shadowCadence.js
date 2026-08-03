/**
 * shadowCadence — the near/far bucket policy behind ActorShadowRig.
 *
 * PURE. Amortizes dynamic actor/prop shadow cost across TIME (a throttled
 * refresh rate) instead of SPACE (a multi-cascade split): whatever is close
 * to the camera focus point stays on an always-fresh shadow map, everything
 * farther moves to a throttled one. This is a distance bucket with
 * hysteresis, not a raw threshold — an actor orbiting exactly at the
 * boundary distance must not flip generators every frame, which would cost
 * more (add/remove-shadow-caster churn) than either generator's own
 * throttle saves.
 *
 * The load-bearing risk this policy exists to manage isn't average blur —
 * it's shadow-foot detachment on whatever the player is actively fighting.
 * A generous default near radius keeps melee-range combat inside the
 * always-fresh bucket; ActorShadowRig.js additionally lets a caller
 * force-pin a specific mesh into 'near' regardless of distance (e.g. the
 * player's current combat target), which this module does not decide —
 * that is a combat-system concern layered on top, not a cadence concern.
 */

export const DEFAULT_NEAR_RADIUS_M = 20;
/** The band a caster must cross OUT of its current bucket before flipping —
 *  not a band it must cross INTO the new one. See classifyShadowCadence. */
export const DEFAULT_HYSTERESIS_M = 5;

export const NEAR_REFRESH_RATE = 1; // every frame — Babylon's own default
export const FAR_REFRESH_RATE = 4; // every 4th frame

/**
 * @param {number} distanceM distance from the camera focus point (not
 *   necessarily the camera itself — see ActorShadowRig.js).
 * @param {'near'|'far'|null} prevBucket this caster's bucket as of the last
 *   call, or null if never classified before.
 * @param {{nearRadiusM?: number, hysteresisM?: number}} [opts]
 * @returns {'near'|'far'}
 *
 * With no prior bucket, classifies directly against nearRadiusM. With a
 * prior bucket, the caster must cross OUTWARD past nearRadiusM+hysteresisM
 * to leave 'near', or INWARD past nearRadiusM-hysteresisM to leave 'far' —
 * the classic wider-exit-than-entry hysteresis band, the same shape
 * chunkMath.js's diffChunks uses for load/unload rings.
 */
export function classifyShadowCadence(distanceM, prevBucket = null, {
  nearRadiusM = DEFAULT_NEAR_RADIUS_M,
  hysteresisM = DEFAULT_HYSTERESIS_M,
} = {}) {
  if (prevBucket === 'near') {
    return distanceM <= nearRadiusM + hysteresisM ? 'near' : 'far';
  }
  if (prevBucket === 'far') {
    return distanceM <= nearRadiusM - hysteresisM ? 'near' : 'far';
  }
  return distanceM <= nearRadiusM ? 'near' : 'far';
}

/** @returns {number} the ShadowGenerator refresh rate for a bucket. */
export function refreshRateForBucket(bucket) {
  return bucket === 'near' ? NEAR_REFRESH_RATE : FAR_REFRESH_RATE;
}
