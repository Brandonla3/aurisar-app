/**
 * propColliders — analytic horizontal collision for settlement props.
 *
 * There is no wall, prop, tree or building collision anywhere outdoors today:
 * `_moveLocal` integrates a step, clamps to the world disc, asks the castle
 * shell, and snaps to terrain. You can walk through the inn.
 *
 * Design constraints, all learned from what already exists here:
 *
 *  • The RESPONSE stays pure, memoryless, per-axis position arithmetic —
 *    exactly like `castleNav.resolveMove` and `CastleSystem.resolveShellCollision`.
 *    Babylon's engine collision was tried once for the castle camera and
 *    removed (see BabylonWorldScene's `_camLosClamp` note): it glides position
 *    without updating the caller's state, which stranded the camera inside
 *    merged wall mass with no way to recover. Never hand the engine the
 *    response.
 *
 *  • The player radius is baked into the BLOCKING geometry, so the runtime
 *    test is a cheap point test — the same trick `castleNav` uses by insetting
 *    room floors by PLAYER_R at build time.
 *
 *  • "Already inside can always walk out." A collider added under a standing
 *    player must never trap them. This matters more here than in the castle:
 *    the server respawns every death to exactly (0,0), and the well at (0,2)
 *    leaves only 0.20 m of clearance, so this escape is load-bearing on a
 *    routine path, not an edge case.
 *
 *  • Geometry comes from the shared table in propFootprints.js, so a prop and
 *    its collider cannot drift apart.
 *
 * Pure math, no Babylon: Node-testable, and `resolveMove` works on any
 * `{x, z}` object.
 */

import { buildPropColliders } from './propFootprints.js';

/** Matches castlePlan's PLAYER_R so the two systems feel identical. */
export const PLAYER_R = 0.35;

/** Spatial hash cell size (m). Props cluster in settlements, so a coarse grid
 *  keeps the per-move candidate set at a handful without a build-time cost. */
const CELL_M = 16;

const key = (cx, cz) => `${cx}_${cz}`;

/**
 * Build a collision index from authored prop data.
 *
 * @param {object} props ZONE1_PROPS
 * @returns {{ blocked(x,z):boolean, resolveMove(prevX,prevZ,pos):boolean,
 *             colliders:Array, near(x,z):Array }}
 */
export function createPropColliders(props) {
  const colliders = buildPropColliders(props);

  // Pre-expand every shape by the player radius so the runtime query is a
  // point-in-shape test, and precompute the rect trig once.
  for (const c of colliders) {
    if (c.kind === 'circle') {
      c._r2 = (c.r + PLAYER_R) * (c.r + PLAYER_R);
    } else {
      c._hw = c.w / 2 + PLAYER_R;
      c._hd = c.d / 2 + PLAYER_R;
      c._cos = Math.cos(-(c.rot ?? 0));
      c._sin = Math.sin(-(c.rot ?? 0));
    }
    c._reach = c.kind === 'circle' ? c.r + PLAYER_R : Math.hypot(c._hw, c._hd);
  }

  // Bucket by cell, inserting into every cell the shape's bounding circle
  // touches so a query only ever has to look at its own cell.
  const grid = new Map();
  for (const c of colliders) {
    const minCx = Math.floor((c.x - c._reach) / CELL_M);
    const maxCx = Math.floor((c.x + c._reach) / CELL_M);
    const minCz = Math.floor((c.z - c._reach) / CELL_M);
    const maxCz = Math.floor((c.z + c._reach) / CELL_M);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const k = key(cx, cz);
        let a = grid.get(k);
        if (!a) { a = []; grid.set(k, a); }
        a.push(c);
      }
    }
  }

  const near = (x, z) => grid.get(key(Math.floor(x / CELL_M), Math.floor(z / CELL_M))) ?? [];

  function blocked(x, z) {
    for (const c of near(x, z)) {
      const dx = x - c.x, dz = z - c.z;
      if (c.kind === 'circle') {
        if (dx * dx + dz * dz < c._r2) return true;
      } else {
        // Into the rect's local frame, then a plain AABB test.
        const lx = dx * c._cos - dz * c._sin;
        const lz = dx * c._sin + dz * c._cos;
        if (Math.abs(lx) < c._hw && Math.abs(lz) < c._hd) return true;
      }
    }
    return false;
  }

  /**
   * Resolve a completed move against the props, mutating `pos` in place.
   * Same three-step ladder as the castle systems: try the move, else slide
   * along x, else along z, else stay put.
   *
   * @returns {boolean} true if the move was modified
   */
  function resolveMove(prevX, prevZ, pos) {
    // Not blocked, or already standing inside something → let them through.
    if (!blocked(pos.x, pos.z) || blocked(prevX, prevZ)) return false;
    if (!blocked(pos.x, prevZ)) { pos.z = prevZ; return true; }  // slide along x
    if (!blocked(prevX, pos.z)) { pos.x = prevX; return true; }  // slide along z
    pos.x = prevX; pos.z = prevZ;                                 // fully blocked
    return true;
  }

  return { blocked, resolveMove, colliders, near };
}
