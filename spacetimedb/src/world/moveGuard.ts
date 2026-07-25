/**
 * world/moveGuard.ts — the speed ceiling on client-claimed movement.
 *
 * `movePlayer` is the one hot reducer where the client dictates a value the
 * server cannot re-derive: its own position. It validated only that the point
 * sat inside the world bounds, so a modified client could rewrite its row to
 * anywhere in the world between two calls — and every server-side proximity
 * gate reads that same row (chest opening, vendor buy/sell, dungeon entry,
 * melee range, campfire cooking), so an unbounded position was an unbounded
 * bypass of all of them.
 *
 * The guard is a speed ceiling rather than a bounds check: a call may advance
 * the row by whatever the fastest legitimate client could have covered since
 * the last ACCEPTED move. `player.lastMoveAt` — appended in Batch E for the
 * move-rate floor — is the column that makes that computable.
 *
 * Clamp, never reject. A rejected move leaves the stored row where it was
 * while the client keeps walking locally (movement is client-authoritative and
 * never reconciled), so the player silently desyncs and every proximity gate
 * goes on reading a position they have left. Clamping instead drags the row
 * toward the claim at walking pace: it converges on its own, and a burst of
 * queued updates after a network stall costs a second of catch-up rather than
 * stranding the player.
 *
 * Teleports do not pass through here. respawnPlayer, enterDungeon and
 * leaveDungeon write the row directly, so their jumps are exempt by
 * construction, and the next movePlayer simply measures from wherever the
 * teleport left them.
 */

/** Mirrors PX_PER_M in src/features/world/worldSpace.js. */
const PX_PER_M = 32;

/**
 * The client integrates local movement at 0.012 m per millisecond
 * (`BabylonWorldScene._moveLocal`, whose speedScale is <= 1), i.e. 12 m/s flat
 * out. Pinned against that literal by moveGuard.test.js so the two cannot
 * drift apart silently — a client speed-up that outran this constant would
 * clamp every honest player.
 */
export const MAX_MOVE_SPEED_MPS = 12;

/**
 * Slack on top of the elapsed budget, to absorb network jitter: two updates
 * sent 80 ms apart can arrive 45 ms apart, and the client integrates against
 * its own frame clock rather than ours. Without it, ordinary jitter would
 * clamp honest players.
 *
 * It is also the term that decides how far the ceiling can be pushed: a client
 * calling at the 40 ms floor banks this much per call on top of its legitimate
 * speed, so 0.75 m/call works out to roughly 2.5x walking pace sustained.
 * That is the deliberate trade — enough slack that honest movement is never
 * touched, in exchange for turning "reach any point in the world instantly"
 * into "walk there". A tighter ceiling needs a real credit bucket (spare
 * budget carried between calls in its own column), which is a bigger change
 * than this guard is worth today.
 */
export const MOVE_JITTER_GRACE_M = 0.75;

/**
 * Ceiling on the elapsed budget. Time spent idle or stalled would otherwise
 * accumulate into one enormous allowance — precisely the case an exploiter
 * would arrange. Capped at 3 s, the burst after a gap can cover 36 m and no
 * more: comfortably inside "recover from a network stall", far short of
 * anything worth teleporting to.
 */
export const MOVE_MAX_CREDIT_MICROS = 3_000_000n;

export interface ClampedMove {
  x: number;
  y: number;
  /** True when the claim was cut back — the client outran the ceiling. */
  clamped: boolean;
}

/**
 * Limit a claimed position to what max speed allows since the last accepted
 * move. Pure arithmetic in world pixels; the caller owns the row.
 *
 * @param prevX  stored position (px) — the last position the server accepted
 * @param prevY  stored position (px)
 * @param nextX  claimed position (px), already clamped to world bounds
 * @param nextY  claimed position (px)
 * @param elapsedMicros  now - player.lastMoveAt
 */
export function clampMoveToMaxSpeed(
  prevX: number,
  prevY: number,
  nextX: number,
  nextY: number,
  elapsedMicros: bigint,
): ClampedMove {
  // A non-positive elapsed means clock skew or a same-instant replay: give it
  // the grace term only, never a negative allowance.
  const budgetMicros =
    elapsedMicros <= 0n
      ? 0n
      : elapsedMicros > MOVE_MAX_CREDIT_MICROS
        ? MOVE_MAX_CREDIT_MICROS
        : elapsedMicros;

  const allowancePx =
    MAX_MOVE_SPEED_MPS * PX_PER_M * (Number(budgetMicros) / 1_000_000) +
    MOVE_JITTER_GRACE_M * PX_PER_M;

  const dx = nextX - prevX;
  const dy = nextY - prevY;
  const distSq = dx * dx + dy * dy;

  // Compare squared distances so the common (accepted) path costs no sqrt.
  if (distSq <= allowancePx * allowancePx) {
    return { x: nextX, y: nextY, clamped: false };
  }

  const k = allowancePx / Math.sqrt(distSq);
  return { x: prevX + dx * k, y: prevY + dy * k, clamped: true };
}
