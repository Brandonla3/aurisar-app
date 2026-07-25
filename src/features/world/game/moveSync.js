/**
 * moveSync.js — when the client calls `movePlayer`.
 *
 * Extracted from BabylonWorldScene so the policy is testable on its own: it
 * decides fan-out cost for every player in the world, and one of its cases
 * (re-sending after the server clamped us) is only reachable through a network
 * stall, which is not something a scene test can stage.
 */

// Every accepted movePlayer is one row-delta fanned out to EVERY subscriber —
// at 100 concurrent players the old 20 Hz was ~2,000 writes/s → ~200,000
// deltas/s, the O(N²) the plan flags. 80 ms (12.5 Hz) with _lerpRemote's
// position smoothing on the receiving side is visually indistinguishable and
// costs 40% of the fan-out. The dead-band only gates STATIONARY resends
// (walking covers ~1 m per interval at 12 m/s); isMoving flips always send.
// The server enforces its own 40 ms floor on top (movePlayer lastMoveAt).
export const MOVE_SEND_INTERVAL_MS = 80;
export const MOVE_SEND_DEADBAND_M  = 0.1;

// Reconcile cadence for the server's move guard (spacetimedb/src/world/
// moveGuard.ts). The guard clamps an over-speed claim instead of rejecting it,
// so the stored row can sit behind the avatar. Because the send below fires on
// LOCAL change, a player who stops right after a network stall would send
// nothing further and leave it there — with every server-side proximity check
// (chests, vendors, NPCs, melee) reading the stale spot for as long as they
// stood still. So while the row disagrees we re-send the same claim.
//
// Slower than the live rate on purpose: a longer gap earns a proportionally
// bigger allowance from the guard, so convergence costs about the same number
// of calls either way, and a genuinely wedged state cannot spam the module.
// The dead-band is in server px (32 px/m): ~5 cm, well under the guard's own
// 0.75 m jitter grace, so a position the server accepted never reads as
// "behind" and idle players stay silent.
export const MOVE_RECONCILE_INTERVAL_MS = 500;
export const MOVE_RECONCILE_DEADBAND_PX = 1.5;

/**
 * @param {object}  s
 * @param {number}  s.sinceLastSendMs  ms since the last movePlayer call
 * @param {number}  s.movedM           distance from the last SENT position (m)
 * @param {boolean} s.isMoving         current local moving state
 * @param {boolean} s.wasMoving        moving state at the last send
 * @param {number}  s.serverOffsetPx   how far the stored row sits from our last
 *                                     claim, max-abs over x/y; 0 when converged
 * @param {boolean} s.alive            false while dead
 * @returns {boolean} whether to call movePlayer now
 */
export function shouldSendMove({
  sinceLastSendMs,
  movedM,
  isMoving,
  wasMoving,
  serverOffsetPx = 0,
  alive = true,
}) {
  // The rate floor governs every path, reconcile included.
  if (sinceLastSendMs < MOVE_SEND_INTERVAL_MS) return false;

  if (movedM > MOVE_SEND_DEADBAND_M) return true;
  if (isMoving !== wasMoving) return true;

  // Dead players are pinned server-side on purpose — movePlayer returns early
  // for them, so a retry would never converge and would just spin.
  if (!alive) return false;

  return sinceLastSendMs >= MOVE_RECONCILE_INTERVAL_MS &&
         serverOffsetPx > MOVE_RECONCILE_DEADBAND_PX;
}
