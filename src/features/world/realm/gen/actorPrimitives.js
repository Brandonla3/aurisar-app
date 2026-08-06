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
 * WHY THE CAPS ARE LOAD-BEARING BEYOND WATERTIGHTNESS. Masses are authored
 * as a chain of COINCIDENT endpoints (model/actorArchetypes.js's whole
 * skeleton is `pivotsOf` finding masses whose `a`/`b` land on the same
 * coordinate) so that a sphere cap at each shared endpoint nests inside the
 * neighbouring mass's socket. That is what lets a later phase rotate rigid
 * segments around a joint — P7's skinning — without the surface tearing
 * open at the seam: the cap is already filling the gap a rotation would
 * otherwise open, not decoration on top of an already-closed tube.
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
 * @returns {{firstVertex: number, vertexCount: number}} the contiguous
 *   vertex range this call appended. Contiguous is load-bearing: Task 4
 *   builds a per-vertex `massIndex` by walking these ranges instead of
 *   re-deriving vertex offsets, which only holds if `addMass` never
 *   interleaves one mass's vertices with another's — every push below
 *   happens in a single unbroken run, in the order tube, capA, capB.
 */
export function addMass(acc, mass, { segments, capLevel, comp = 1 }) {
  const firstVertex = acc.pos.length / 3;
  const radiusA = mass.r0 * comp;
  const radiusB = mass.r1 * comp;

  addTube(acc, mass.a, mass.b, radiusA, radiusB, segments, mass.color);
  if (mass.capA) addBlob(acc, mass.a, radiusA, capLevel, mass.color);
  if (mass.capB) addBlob(acc, mass.b, radiusB, capLevel, mass.color);

  const vertexCount = acc.pos.length / 3 - firstVertex;
  return { firstVertex, vertexCount };
}
