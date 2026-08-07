/**
 * actorGen — walk an archetype's mass list into a renderable payload. PURE.
 *
 * buildActorPayload(archetypeId, stage) -> the same typed-array payload shape
 * propGen/terrainChunkGen emit (positions/normals/colors/indices,
 * vertCount/triCount/heightM/minY/radiusM), plus two fields on top:
 *
 *  - massIndex: Uint16Array, one entry per VERTEX, holding the ordinal index
 *    (into `archetype.masses`) of the mass that produced it.
 *  - pivots: the joint table from `pivotsOf`, unchanged.
 *
 * Mirrors buildPrototypePayload's shape and error style exactly, but the
 * growth itself has none of propGen's stage-conditional truncation (no
 * crown-blob budget, no fork-depth cutoff). The MASS LIST — not a mesh — is
 * the canonical genome output (see model/actorMasses.js), and it is the same
 * list at every stage: only tessellation (`SEG`/`CAP_LEVEL`) and the far-stage
 * radius compensation (`FAR_COMP`) vary. Dropping masses between stages was
 * tried in the props phase (crown blobs, three different ways) and always
 * dented width 12-19% against a 10% gate — see model/actorMasses.js's SEG
 * comment. Whether the roster actually clears the silhouette gates at every
 * stage is Task 5's job (gen/actorSilhouette.test.js); this file does not
 * duplicate that measurement.
 *
 * NO SKINNING. `massIndex` is plain per-vertex data, nothing else — the bank
 * a LATER phase (P7) reads to swap it for bone indices with rigid 1.0 weights
 * and no remesh. Implementing bones, weights, or vertex deformation here
 * would bake a rig decision into the phase that measures silhouettes.
 */

import {
  CAP_LEVEL, FAR_COMP, SEG, archetypeById, pivotsOf,
} from '../model/actorMasses.js';
import { addMass } from './actorPrimitives.js';
import { finalize, newAccumulator } from './propPrimitives.js';

/**
 * The one public entry: archetype id + stage -> payload. Throws on unknown
 * ids or out-of-range stages — same contract as buildPrototypePayload, so a
 * typo'd archetype or an off-by-one stage fails loudly at build time rather
 * than placing invisible nothing.
 */
export function buildActorPayload(archetypeId, stage) {
  const arch = archetypeById(archetypeId);
  if (!arch) throw new Error(`[actorGen] unknown archetype "${archetypeId}"`);
  if (stage < 0 || stage >= arch.stages) {
    throw new Error(`[actorGen] "${archetypeId}" has ${arch.stages} stages; got ${stage}`);
  }

  const segments = SEG[stage];
  const capLevel = CAP_LEVEL[stage];
  const comp = stage === 0 ? 1 : FAR_COMP;

  const acc = newAccumulator();
  // addMass appends contiguously (its own documented contract) and returns
  // the exact vertex range it just pushed, so the per-vertex massIndex below
  // is a fill over these ranges rather than a re-derivation of offsets.
  const ranges = arch.masses.map((mass) => addMass(acc, mass, { segments, capLevel, comp }));

  const payload = finalize(acc);
  const massIndex = new Uint16Array(payload.vertCount);
  for (let m = 0; m < ranges.length; m++) {
    const { firstVertex, vertexCount } = ranges[m];
    massIndex.fill(m, firstVertex, firstVertex + vertexCount);
  }

  return { ...payload, massIndex, pivots: pivotsOf(archetypeId) };
}
