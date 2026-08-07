/**
 * actorCanary — the pose every downstream skinning gate poses with.
 *
 * PURE, and a one-way consumer of model/actorRig.js (rig in, pose table out).
 * Split out of actorRig.js when that file reached 399 lines against a 400
 * ceiling; nothing in actorRig.js imports this, so there is no cycle.
 *
 * IT EXISTS BECAUSE A SKINNING TEST IS TRIVIAL TO WRITE VACUOUSLY. Skin a
 * mesh, pose nothing, compare against the unskinned mesh: it passes, it passes
 * forever, and it passes just as well when every vertex is welded to bone 0.
 * This project has shipped eight tests that could not fail. So every non-root
 * bone gets a rotation, no bone shares an angle with another, and no angle is
 * an integer multiple of another (the prime-degree ladder 7/11/13/17/19/23/29).
 * Strictly those are commensurate — all rational multiples of a degree — but
 * what matters is that swapping two bones, doubling one, or dropping one to
 * zero all change the palette, and a prime ladder guarantees all three.
 *
 * THE AXIS IS ORTHOGONAL TO THE BONE'S LIMB DIRECTION, and that is a DESIGN
 * property, asserted directly in actorCanary.test.js rather than left to the
 * displacement numbers to imply. Rotating about a limb's own axis spins a
 * capsule on its centreline and moves almost nothing — the most expensive kind
 * of vacuous canary, articulated in the table and inert in the mesh. Measured:
 * replacing `orthogonalAxis(limbDirection(b))` with `limbDirection(b)`, so
 * every canary becomes a pure twist, drops the worst endpoint travel to 0.174
 * (unbound), 0.156 (legion), 0.000 (magistari) and 0.117 m (orghon) — and
 * against a displacement floor alone, LEGION STILL PASSES at 0.156 against the
 * shipped floor of 0.12 (`TRAVEL.legion.min`, actorCanary.test.js, which
 * records why 0.124 is the wrong number to quote here). The floor is a second
 * net, not the net; the orthogonality assertion is what makes the mutation
 * fail on all four.
 *
 * ...AND IT IS ORTHOGONAL TO THE BONE'S *SUMMED* DIRECTION, NOT TO EACH MASS.
 * A bone owning several masses gets one axis, so an individual mass can still
 * be close to a pure twist: legion's fused face plate is EXACTLY one
 * (|cos| = 1.0000 for faceL and faceR), its crest bars 0.9972, its yokes
 * 0.9778, orghon's hip slabs 0.9839. Their ENDPOINTS therefore barely move —
 * orghon's hipL travels 0.0049 m, legion's yokeL 0.0115 m — and a per-mass
 * assertion keyed on endpoint travel would be within a hair of vacuous.
 *
 * WHAT SAVES IT IS THE SURFACE, and Task 3 and Task 4 must key their per-mass
 * assertions on surface vertices for exactly this reason. A twisted capsule's
 * axis stays put while its skin sweeps around it, so measured over each mass's
 * two end rings (8 azimuths each), EVERY mass in the roster has a surface
 * vertex moving at least 0.0288 m — the worst case being unbound's neck, with
 * legion's yokeL at 0.0340, orghon's hipL at 0.0385 and magistari's spine at
 * 0.0527. Endpoint travel is the wrong statistic; surface travel is the one
 * with a floor.
 *
 * THE LADDER RUNS ASCENDING BY BONE INDEX — BFS order, so roughly depth order
 * — because angles COMPOUND down a chain and the shallow bones carry the long
 * lever arms. Compared honestly, i.e. reversing the assignment of the SAME
 * multiset of angles rather than taking different angles off the ladder:
 *
 *   ascending    0.572 (unbound)  0.207 (legion)  0.260 (orghon)
 *   reversed     0.666            0.266           0.250
 *
 * Ascending wins on unbound and legion and LOSES on orghon by 0.010 m. It is
 * kept because it wins where the numbers are big and loses where they are
 * small — not because it wins everywhere. Magistari is deliberately absent
 * from that table: it has one non-root bone, so there is no order to reverse
 * and its 0.053 m is the same either way. An earlier version of this comment
 * compared against angles taken off the TOP of the ladder, which changed the
 * ANGLE BUDGET as well as the order (legion 101 degrees of total rotation
 * against 67) and so overstated the case; these are the same-multiset numbers.
 *
 * Unbound's 0.572 m is the fist, four joints down the graft chain (11+17+23+29
 * degrees of compounding). This comment used to predict that Task 3's posed
 * seal gate would bind on it first, and to prescribe "if it fails, shrink the
 * angle." Task 3 MEASURED that prediction and found it false: the posed
 * seal's two-sided ray criterion never fires, even scaled far past what
 * ships (every joint swept to 179 degrees alone, and the whole pose scaled
 * 10x). Every joint in this roster closes by a mechanism that is pose-
 * invariant at ANY angle — a cap pivot's sphere is rotation-invariant about
 * its own centre, and a ring pivot's two masses are always fused onto the
 * SAME bone by buildActorRigOfMasses (model/actorRig.js's header) rather than
 * ever sitting on opposite sides of a rotation — so "shrink the angle" was
 * never an available response to that particular gate failing, for any
 * angle in this table.
 *
 * What DOES validate a ring weld against tearing is a structural fact, not
 * an angle: whether that fusion still holds. gen/actorSealPose.test.js's
 * one-sided-escape baseline and its direct ring-weld coincidence gate check
 * this directly (a torn weld is provably a ONE-SIDED aperture, which the
 * two-sided criterion is blind to by construction — see that file), and a
 * regression here should be diagnosed against THOSE gates, not against this
 * table's angle sizes. The travel-floor envelope (`TRAVEL`, in
 * actorCanary.test.js) is a separate, still-valid concern keyed on angle
 * magnitude; this correction does not touch it.
 */

import { ARCHETYPES, archetypeById } from './actorMasses.js';
import { buildActorRig } from './actorRig.js';

/**
 * Distinct, non-multiple canary angles in DEGREES. Seven entries because the
 * roster's deepest rig (unbound) has seven non-root bones; a fifth archetype
 * with more runs off the end, which `canaryPoseFor` refuses loudly rather than
 * wrapping the ladder and quietly duplicating an angle.
 */
export const CANARY_LADDER_DEG = Object.freeze([7, 11, 13, 17, 19, 23, 29]);

const DEG = Math.PI / 180;

/**
 * A unit axis orthogonal to `dir`: the world axis LEAST parallel to it,
 * Gram-Schmidt'd. That axis always has |dot| <= 1/sqrt(3), so the rejected
 * vector is never shorter than sqrt(1 - 1/3) = 0.816 and the normalise is
 * safe; across the shipped roster the shortest is 0.988.
 */
function orthogonalAxis(dir) {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(dir[i]) < Math.abs(dir[k])) k = i;
  const d = dir[k];
  const v = [-d * dir[0], -d * dir[1], -d * dir[2]];
  v[k] += 1;
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The bone's limb direction: the sum of (outboard endpoint - pivot) over the
 * masses it owns, length-weighted so a long limb outvotes a stub. A left/right
 * pair cancels exactly if the bone owns nothing else, so that degenerate case
 * falls back to the first owned mass's own axis.
 *
 * EXPORTED ONLY SO THE ORTHOGONALITY GATE CAN BE WRITTEN — the same reason
 * model/actorMasses.js exports `pivotsOfMasses` ("an untestable constant is the
 * kind that drifts"). Without it, the one property this whole table depends on
 * could only be checked by re-deriving the direction inside the test, which
 * proves the test's arithmetic rather than the module's.
 *
 * @param bone a `{at, massIds}` bone from `buildActorRig`.
 * @param massById Map of mass id to mass, for the bone's archetype.
 */
export function limbDirection(bone, massById) {
  let d = [0, 0, 0];
  for (const mid of bone.massIds) {
    const m = massById.get(mid);
    const da = Math.hypot(m.a[0] - bone.at[0], m.a[1] - bone.at[1], m.a[2] - bone.at[2]);
    const db = Math.hypot(m.b[0] - bone.at[0], m.b[1] - bone.at[1], m.b[2] - bone.at[2]);
    const far = db >= da ? m.b : m.a;
    d = [d[0] + far[0] - bone.at[0], d[1] + far[1] - bone.at[1], d[2] + far[2] - bone.at[2]];
  }
  let len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) {
    const m = massById.get(bone.massIds[0]);
    d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]];
    len = Math.hypot(d[0], d[1], d[2]);
  }
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** The canary table for one archetype: `{boneIndex: {axis, angleRad}}`. */
function canaryPoseFor(archetypeId) {
  const rig = buildActorRig(archetypeId);
  const massById = new Map(archetypeById(archetypeId).masses.map((m) => [m.id, m]));
  const nonRoot = rig.bones.length - 1;
  if (nonRoot > CANARY_LADDER_DEG.length) throw new Error(`[actorCanary] "${archetypeId}" has ${nonRoot} non-root bones but the ladder holds ${CANARY_LADDER_DEG.length} distinct angles. Extend the ladder with further primes; do not wrap it.`);
  const table = {};
  for (let i = 1; i < rig.bones.length; i++) {
    table[i] = Object.freeze({
      axis: Object.freeze(orthogonalAxis(limbDirection(rig.bones[i], massById))),
      angleRad: CANARY_LADDER_DEG[i - 1] * DEG,
    });
  }
  return Object.freeze(table);
}

/**
 * `CANARY_POSE[archetypeId]` — plain frozen data, built once at module load and
 * never regenerated, so the table Task 3 measures against is byte-identical to
 * the one Task 4 replays.
 */
export const CANARY_POSE = Object.freeze(
  Object.fromEntries(ARCHETYPES.map((a) => [a.id, canaryPoseFor(a.id)])),
);
