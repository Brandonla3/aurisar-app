/**
 * actorPrimitives — the one geometry op every actor genome is built from.
 *
 * PURE. `addMass` appends one MASS (model/actorMasses.js's capsule-ish swept
 * segment: `{a, b, r0, r1, color, capA, capB}`) into a propPrimitives-style
 * accumulator, as an open `addTube` body plus an `addBlob` rounded cap at
 * each end that requests one. Both imported from `./propPrimitives.js`
 * unmodified — three shipped prop prototypes sit close to their own
 * silhouette gate, and adding a caller here cannot move their measurement;
 * editing `addTube`/`addBlob`/`sphereFaces` could.
 *
 * THIS COMPOSITION IS LOCKED TO TASK 2'S MEASUREMENT STAND-IN. Task 2 could
 * not measure the real `addMass` (this file) because it did not exist yet,
 * so it built every faction archetype's `bandTargets` and every SEG/CAP_LEVEL/
 * FAR_COMP constant against a stand-in of exactly this shape — see
 * model/actorMasses.js's header. Composing the geometry any other way (e.g.
 * welding the tube's end ring into the cap, or skipping the tube ring when
 * both ends are capped) would drift every one of those measured numbers out
 * from under Task 5's gates without anything here failing loudly.
 *
 * WHAT THE CAPS DO FOR P7, STATED HONESTLY. Masses are authored as a chain
 * of COINCIDENT endpoints (model/actorArchetypes.js's whole skeleton is
 * `pivotsOf` finding masses whose `a`/`b` land on the same coordinate), and
 * a joint is closed by ONE OF TWO mechanisms, not one:
 *
 *   'cap'  — a sphere at the shared endpoint, inside which the neighbouring
 *            masses' open rings sit. A sphere is rotation-invariant about
 *            its own centre, so the gap stays filled while a rigid segment
 *            turns. THIS is the joint P7 can animate.
 *   'ring' — two masses of EQUAL RADIUS on the SAME AXIS LINE whose end
 *            rings land on identical vertices and weld each other shut, with
 *            no cap present at all. POSE-LOCKED: the closure is a property
 *            of the authored pose, and rotating either side by any angle
 *            separates the two rings and tears the joint open on the first
 *            animated frame.
 *
 * `pivotsOf` (model/actorMasses.js) reports which one holds each joint as
 * `closure`, and model/actorMasses.test.js fails any joint that has neither.
 * As shipped the roster is 17 'cap' and 5 'ring' — legion's face-plate,
 * magistari's robeLower/robeUpper, robeUpper/cowlStem and cowl bar, and
 * orghon's throat. A P7 consumer that rotates all 22 because this comment
 * used to promise "a sphere cap at each shared endpoint" tears five of them.
 *
 * AND THE CAP'S OWN LIMIT, which is a second thing this comment used to
 * promise away. `addBlob` INSCRIBES its polyhedron: a cap of radius R
 * reaches only 0.9342·R (CAP_LEVEL 2, near) or 0.7947·R (CAP_LEVEL 1, far)
 * in its worst direction, measured in gen/actorSeal.test.js. So a cap
 * buries a neighbouring ring only while that ring is narrower than that
 * fraction of the cap — a cap of radius R does NOT close a ring of radius R,
 * and the P6 review's two see-through joints were both of exactly that
 * shape. Both were closed by making the radii EQUAL (a 'ring' weld), which
 * is why the roster gained ring joints rather than caps.
 */

import { addBlob, addTube } from './propPrimitives.js';

/**
 * Append one mass into `acc`.
 *
 * `comp` multiplies RADII ONLY, never length — the far-stage compensation
 * for the width a coarser ring/cap tessellation inscribes away (the same
 * role propGen's `MID_BLOB_COMP` plays for foliage blobs). Applying it to
 * length instead would move the envelope, and the envelope must be
 * stage-invariant: only tessellation and `comp` may differ between stages.
 *
 * @param acc accumulator from propPrimitives' `newAccumulator()`.
 * @param mass `{a, b, r0, r1, color, capA, capB}` — see model/actorMasses.js.
 * @param segments radial tube segments this stage uses (`SEG[stage]`).
 * @param capLevel `sphereFaces` level this stage's caps use (`CAP_LEVEL[stage]`).
 * @param comp radius multiplier, defaults to 1 (the near stage's value).
 * @throws if the mass has no length. `addTube` guards its own division with
 *   `|| 1`, so a zero-length mass does NOT throw there — it silently builds
 *   an axis from a normalized ZERO vector, whose `basisFor` cross products
 *   are all zero, whose reciprocal length is Infinity, and every position
 *   and normal it emits is NaN. The payload is then a full triangle count of
 *   nothing: it renders as absence, `silhouetteAreaM2` returns NaN, and the
 *   IoU gates compare NaN against a threshold, which is false rather than
 *   red. model/actorMasses.test.js already rejects a degenerate axis in the
 *   SHIPPED table; this closes the same hole for every derived or computed
 *   mass list — the ablation fixtures, the proportion roster, and whatever
 *   P7 generates — none of which that table check ever sees.
 * @returns {{firstVertex: number, vertexCount: number}} the contiguous
 *   vertex range this call appended. Contiguous is load-bearing: Task 4
 *   builds a per-vertex `massIndex` by walking these ranges instead of
 *   re-deriving vertex offsets, which only holds if `addMass` never
 *   interleaves one mass's vertices with another's — every push below
 *   happens in a single unbroken run, in the order tube, capA, capB.
 */
/** Below this the axis direction is numerically meaningless. Matches the
 *  2 cm floor model/actorMasses.test.js holds the shipped table to in
 *  spirit, but is set at 1e-9 on purpose: this guard exists to stop NaN
 *  geometry, not to legislate proportions for mass lists it has never seen. */
const MIN_MASS_LENGTH = 1e-9;

export function addMass(acc, mass, { segments, capLevel, comp = 1 }) {
  const length = Math.hypot(mass.b[0] - mass.a[0], mass.b[1] - mass.a[1], mass.b[2] - mass.a[2]);
  if (!(length > MIN_MASS_LENGTH)) {
    throw new Error(
      `[actorPrimitives] mass "${mass.id}" has zero length (a and b are ${length} apart). `
      + 'addTube would build its axis from a normalized zero vector and every position and normal '
      + 'in this mass would be NaN — geometry that renders as nothing and measures as NaN rather '
      + 'than failing a gate. Give it a real axis, or drop the mass.',
    );
  }
  const firstVertex = acc.pos.length / 3;
  const radiusA = mass.r0 * comp;
  const radiusB = mass.r1 * comp;

  addTube(acc, mass.a, mass.b, radiusA, radiusB, segments, mass.color);
  if (mass.capA) addBlob(acc, mass.a, radiusA, capLevel, mass.color);
  if (mass.capB) addBlob(acc, mass.b, radiusB, capLevel, mass.color);

  const vertexCount = acc.pos.length / 3 - firstVertex;
  return { firstVertex, vertexCount };
}
