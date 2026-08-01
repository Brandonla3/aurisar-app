/**
 * moveRules — server-side validation of a claimed movement.
 *
 * PURE. Takes plain numbers, returns a plain verdict. No clock, no randomness,
 * no state: the caller supplies `dtMs`, so the same inputs always give the same
 * answer and the rule is trivially testable.
 *
 * This is authoritative logic, which is exactly why it lives in a pure module.
 * It has to run in two places — inside the SpacetimeDB reducer and inside
 * LocalTransport — and if those two ever disagree, offline play and online play
 * diverge. One implementation, two callers.
 *
 * The design is "trust but clamp": a client that claims a plausible move is
 * believed, and one that claims an impossible one is snapped back rather than
 * disconnected. Latency, tab-stalls and GC pauses all produce large legitimate
 * deltas, so treating them as cheating would punish honest players constantly.
 */

/**
 * ─── Deliberately NOT Ashwood's number ───────────────────────────────────────
 * The live stack caps at `MAX_MOVE_SPEED_MPS = 12` flat, plus a separate jitter
 * grace (spacetimedb/src/world/moveGuard.ts). That 12 was derived from
 * BabylonWorldScene's locomotion speed, which the Realm does not share and has
 * not defined yet — Realm locomotion lands in P2.
 *
 * So this is PROVISIONAL. The number that matters is "sprint speed plus enough
 * headroom to survive jitter", and it can only be pinned once Realm locomotion
 * exists. When the SpacetimeDB reducer starts calling this module, one number
 * must be chosen and mirrored, or the two stacks drift the way the Ashwood
 * client and server nearly did. `movement speed is pinned deliberately` in the
 * tests exists to make that a conscious edit rather than a silent one.
 */
export const MOVE_LIMITS = Object.freeze({
  /** Sprint speed. Anything sustained above this is not a real player. */
  maxSpeedMps: 7,
  /**
   * Headroom over the speed cap. A frame delivered late makes an honest client
   * look briefly fast; without slack, ordinary jitter reads as teleporting.
   */
  toleranceMult: 1.35,
  /**
   * Hard ceiling per step regardless of elapsed time.
   *
   * With the defaults below this never binds: dt is already clamped to 1s, so
   * the speed budget tops out at 7 * 1.35 = 9.45m, well under 12. It is a
   * backstop for the day someone raises `maxDtMs` to tolerate mobile
   * background-tab stalls — at maxDtMs 5s the speed budget alone would permit a
   * 47m jump. Kept (and tested via explicit limits) rather than deleted, but
   * documented as inactive so it is not mistaken for the thing doing the work.
   */
  maxStepM: 12,
  /**
   * dt is clamped into this window before use. THIS is what actually bounds a
   * forged dt: claiming ten minutes elapsed buys one second of movement.
   */
  minDtMs: 1,
  maxDtMs: 1000,
});

export const MOVE_VERDICT = Object.freeze({
  ACCEPTED: 'accepted',
  CLAMPED_SPEED: 'clamped_speed',
  CLAMPED_STEP: 'clamped_step',
  REJECTED_NAN: 'rejected_nan',
});

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @returns {{verdict: string, x: number, z: number, accepted: boolean}}
 *   `x`/`z` are always the authoritative position — the claim when it is
 *   allowed, the clamped point when it is not. Callers write this back
 *   unconditionally rather than branching.
 */
export function resolveMove(from, to, dtMs, limits = MOVE_LIMITS) {
  // Reject non-finite input outright. NaN propagates silently through every
  // later comparison (NaN > x is false), so a single bad packet would otherwise
  // park the player at NaN forever with no error anywhere.
  if (!finite(to?.x) || !finite(to?.z) || !finite(from?.x) || !finite(from?.z)) {
    return { verdict: MOVE_VERDICT.REJECTED_NAN, x: from?.x ?? 0, z: from?.z ?? 0, accepted: false };
  }

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) {
    return { verdict: MOVE_VERDICT.ACCEPTED, x: to.x, z: to.z, accepted: true };
  }

  const dt = Math.min(Math.max(finite(dtMs) ? dtMs : limits.minDtMs, limits.minDtMs), limits.maxDtMs);
  const budget = Math.min(
    (limits.maxSpeedMps * limits.toleranceMult * dt) / 1000,
    limits.maxStepM,
  );

  if (dist <= budget) {
    return { verdict: MOVE_VERDICT.ACCEPTED, x: to.x, z: to.z, accepted: true };
  }

  // Too far: keep the direction, clamp the distance. Snapping to `from` instead
  // would rubber-band a laggy player backwards; this lets them keep moving the
  // way they intended, only slower.
  const scale = budget / dist;
  return {
    verdict: budget === limits.maxStepM ? MOVE_VERDICT.CLAMPED_STEP : MOVE_VERDICT.CLAMPED_SPEED,
    x: from.x + dx * scale,
    z: from.z + dz * scale,
    accepted: false,
  };
}
