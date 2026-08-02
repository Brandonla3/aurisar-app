/**
 * walker — ground locomotion over the terrain field.
 *
 * PURE. integrate(state, snapshot, dtMs, field) → new state. The renderer
 * copies the result onto the player's transform; the network layer packs the
 * same numbers into moveIntent claims. One integrator, both consumers.
 *
 * Y is not simulated. The Realm's ground rule (carried over from the stack it
 * replaces, where it worked): a walker's Y is a pure FUNCTION of (x, z) —
 * no gravity, no vertical velocity, no falling through the world, no y desync
 * between client and server. Jumping, if it ever ships, is a cosmetic arc on
 * the view side, not a simulation state.
 */

import { clampMoveToUnitDisc, hasMovement, isDown, BUTTON } from '../sim/InputSnapshot.js';

export const WALK_SPEED_MPS = 4.2;
export const SPRINT_MULT = 1.6; // 6.72 m/s sprinting — under moveRules' 7 cap
/** Slopes steeper than this are walls, not floors. ~50 degrees. */
export const MAX_WALK_SLOPE = 0.36;
/** Yaw eases toward the move direction with this time constant. */
export const YAW_TAU_MS = 120;

export function createWalkerState(x = 0, z = 0, field = null) {
  return {
    x,
    z,
    y: field ? field.surfaceY(x, z) : 0,
    yaw: 0,
    speedMps: 0, // horizontal speed actually achieved — drives animation later
  };
}

const shortestAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One fixed step. Camera-relative WASD: snapshot.moveX/moveZ are in camera
 * space; snapshot.yaw is the camera's heading.
 */
export function integrateWalker(state, snapshot, dtMs, field) {
  const dt = dtMs / 1000;
  const next = { ...state };

  if (!hasMovement(snapshot)) {
    next.speedMps = 0;
    return next;
  }

  clampMoveToUnitDisc(snapshot);

  // Rotate move intent from camera space into world space. Convention pinned
  // by the tests: camera yaw θ means camera-forward = (sin θ, cos θ) — the same
  // convention as the walker's own facing (atan2(dirX, dirZ)). So forward
  // (moveZ=1) maps to (sin θ, cos θ) and strafe-right (moveX=1) to (cos θ, −sin θ).
  const cos = Math.cos(snapshot.yaw);
  const sin = Math.sin(snapshot.yaw);
  const dirX = snapshot.moveX * cos + snapshot.moveZ * sin;
  const dirZ = -snapshot.moveX * sin + snapshot.moveZ * cos;

  const speed = WALK_SPEED_MPS * (isDown(snapshot, BUTTON.SPRINT) ? SPRINT_MULT : 1);
  let tx = state.x + dirX * speed * dt;
  let tz = state.z + dirZ * speed * dt;

  // Slope gate at the DESTINATION: walking onto a wall is refused, and we try
  // each axis alone so the walker slides along the obstacle instead of sticking
  // to it — the classic collide-and-slide, done against the field.
  //
  // Destination-only, not swept: at the fixed 16.7ms step the walker moves
  // ~0.11m/step, far narrower than any terrain feature, so tunnelling cannot
  // occur against the field. If thin authored walls (fences, buildings) ever
  // join the collision set, THIS is the line that needs a swept check.
  if (field.slopeAt(tx, tz) > MAX_WALK_SLOPE) {
    const xOnly = field.slopeAt(tx, state.z) <= MAX_WALK_SLOPE;
    const zOnly = field.slopeAt(state.x, tz) <= MAX_WALK_SLOPE;
    if (xOnly && !zOnly) { tz = state.z; }
    else if (zOnly && !xOnly) { tx = state.x; }
    else if (!xOnly && !zOnly) { tx = state.x; tz = state.z; }
    // both fine -> keep the diagonal (the blocked point was a pinch corner)
  }

  next.speedMps = Math.hypot(tx - state.x, tz - state.z) / (dt || 1);
  next.x = tx;
  next.z = tz;
  next.y = field.surfaceY(tx, tz);

  // Face the direction of travel, eased — instant snapping reads robotic.
  if (next.speedMps > 0.01) {
    const targetYaw = Math.atan2(dirX, dirZ);
    const blend = 1 - Math.exp(-dtMs / YAW_TAU_MS);
    next.yaw = state.yaw + shortestAngle(targetYaw - state.yaw) * blend;
  }

  return next;
}
