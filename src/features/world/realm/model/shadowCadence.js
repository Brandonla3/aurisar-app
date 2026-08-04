/**
 * shadowCadence — the near/far bucket policy behind ActorShadowRig.
 *
 * PURE. `classifyShadowCadence` decides whether a dynamic caster is close
 * enough to the camera focus point to be worth a real-time cast shadow at
 * all. 'near' casts a shadow on the scene's real sun light, every frame.
 * 'far' casts NO shadow — not a throttled or stale one, simply none — so
 * cost scales with how many actors are actually near the player, not with
 * total actor count.
 *
 * This is a distance bucket with hysteresis, not a raw threshold: an actor
 * orbiting exactly at the boundary distance must not flip in and out of the
 * shadow map every frame, which would cost more (add/remove-shadow-caster
 * churn) than skipping distant casters saves in the first place.
 *
 * PRIOR DESIGN, REVERTED: an earlier version paired this policy with a
 * SECOND, throttled ShadowGenerator on a second shadow-only light for the
 * 'far' bucket, amortizing cost over time instead of dropping it. Caught in
 * PR review as architecturally broken: shadows are per-light, so removing a
 * caster from the KEY light's shadow map (when it goes 'far') means it stops
 * casting the sun's actual shadow — full stop, not "less often." Whatever
 * darkening the far light produced was only ever an artifact of averaging
 * Babylon's per-material aggShadow term across lights with wildly different
 * intensities (the far light's was 0), not a real located shadow. A correct
 * amortized-far-shadow design needs either one CascadedShadowGenerator with
 * genuine per-cascade refresh control, or custom sampling of a second map
 * into the key light's own attenuation — both out of scope here. Shipping
 * "near-only, far explicitly absent" is the honest version of this feature
 * until one of those exists.
 *
 * The load-bearing risk this policy exists to manage isn't average blur —
 * it's a shadow disappearing on whatever the player is actively fighting the
 * instant it crosses the near radius. A generous default near radius keeps
 * melee-range combat inside the bucket; ActorShadowRig.js additionally lets
 * a caller force-pin a specific mesh into 'near' regardless of distance
 * (e.g. the player's current combat target), which this module does not
 * decide — that is a combat-system concern layered on top, not a cadence one.
 */

export const DEFAULT_NEAR_RADIUS_M = 20;
/** The band a caster must cross OUT of its current bucket before flipping —
 *  not a band it must cross INTO the new one. See classifyShadowCadence. */
export const DEFAULT_HYSTERESIS_M = 5;

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
