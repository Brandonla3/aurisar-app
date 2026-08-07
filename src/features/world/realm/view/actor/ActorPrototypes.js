/**
 * ActorPrototypes — every actor master mesh, built once at boot from pure
 * payloads. PropPrototypes' shape, for the actor roster.
 *
 * One DISABLED master per (archetype, stage), geometry straight from
 * gen/actorGen.js verbatim, all sharing the ONE actor material
 * (view/materials/actorNME.js). Live actors (ActorRig) are clones of these
 * masters — a clone shares geometry and material by reference, so an actor
 * costs a mesh header and one draw call, never a vertex buffer.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO, and why it matters to a number
 * someone already committed to: the payload carries `massIndex` (one mass
 * ordinal per vertex) and `pivots` (the joint table), and it would be easy to
 * read them as an invitation to split each master into per-mass sub-meshes
 * under child TransformNodes. That would multiply draw calls by the mass
 * count — 11 for orghon — and model/actorBudget.js's census
 * (realmActorBudget.test.js) was measured on `maxSimultaneousActors * 1` draw
 * call. So the geometry stays ONE mesh, and both fields are carried through
 * `metaFor()` as inert DATA for P7's skinning work to consume later.
 *
 * NO SPROUT, NO INSTANCING. PropPrototypes' masters exist to be thin-instanced
 * with per-instance `matrix`/`instTint`/`sproutBirth` buffers; these exist to be
 * cloned into ordinary moving meshes. That difference is the whole reason
 * actorNME.js is not buildPropMaterial — see its header on the black-actor trap.
 */

/* global BABYLON */

import { ARCHETYPES, archetypeById } from '../../model/actorMasses.js';
import { buildActorPayload } from '../../gen/actorGen.js';

const keyOf = (archetypeId, stage) => `${archetypeId}:${stage}`;

/**
 * The buffers every actor master MUST carry, checked at boot.
 *
 * Both failures are silent-ish rather than fatal, which is exactly why they
 * get a loud guard here. actorNME.js closes the colourless case at COMPILE
 * time (MeshAttributeExistsBlock, so a colourless mesh renders WHITE instead
 * of the pure black an unbound `color` attribute used to produce), and the
 * normal path divides by max(length, eps) so a missing normal degrades to
 * ambient-only instead of NaN. Those are FAILURE modes, not correct output: a
 * roster of washed-out characters is the kind of regression that ships,
 * because nothing crashes. Throwing at boot is the cheap version of noticing.
 */
const REQUIRED_KINDS = Object.freeze(['position', 'normal', 'color']);

export class ActorPrototypes {
  /**
   * @param {object} scene
   * @param {object} material the shared actor NodeMaterial (actorNME.js)
   */
  constructor(scene, material) {
    /** 'archetypeId:stage' -> disabled master mesh */
    this._masters = new Map();
    /** 'archetypeId:stage' -> the payload's non-geometry facts (see metaFor) */
    this._meta = new Map();

    for (const arch of ARCHETYPES) {
      for (let stage = 0; stage < arch.stages; stage++) {
        const payload = buildActorPayload(arch.id, stage);
        const mesh = new BABYLON.Mesh(`actorMaster_${arch.id}_${stage}`, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = payload.positions;
        vd.normals = payload.normals;
        vd.colors = payload.colors;
        vd.indices = payload.indices;
        vd.applyToMesh(mesh, false);

        // Both halves of Babylon's VERTEXCOLOR_NME contract
        // (`mesh.useVertexColors && mesh.isVerticesDataPresent(ColorKind)`) are
        // held explicitly rather than left to the Mesh default, because the
        // clone inherits whatever this master has and albedo IS the vertex
        // colour. `true` is the default today; writing it down is what stops a
        // future default flip from quietly repainting the roster white.
        mesh.useVertexColors = true;
        for (const kind of REQUIRED_KINDS) {
          if (!mesh.isVerticesDataPresent(kind)) {
            throw new Error(`[ActorPrototypes] ${keyOf(arch.id, stage)} master has no ${kind} data`);
          }
        }

        mesh.material = material;
        mesh.setEnabled(false); // masters never render; clones do
        mesh.isPickable = false;

        this._masters.set(keyOf(arch.id, stage), mesh);
        // Geometry is Babylon's now; only the facts a rig or a later phase
        // needs are retained, so this map is kilobytes rather than a second
        // copy of every vertex buffer.
        this._meta.set(keyOf(arch.id, stage), Object.freeze({
          archetypeId: arch.id,
          stage,
          minY: payload.minY,
          heightM: payload.heightM,
          radiusM: payload.radiusM,
          vertCount: payload.vertCount,
          triCount: payload.triCount,
          massIndex: payload.massIndex,
          pivots: payload.pivots,
        }));
      }
    }
  }

  /**
   * The stage a LOD tier actually resolves to. Tiers beyond an archetype's
   * stage count clamp to its last stage — the same contract PropPrototypes
   * holds, so a future single-stage archetype renders its one mesh at every
   * tier instead of returning undefined and drawing nothing.
   *
   * Split out from masterFor so masterFor and metaFor cannot disagree about
   * which stage they are describing: a rig that seated by stage 0's `minY`
   * while rendering stage 1's geometry would float or sink by the difference.
   */
  stageFor(archetypeId, tier) {
    const arch = archetypeById(archetypeId);
    if (!arch) throw new Error(`[ActorPrototypes] unknown archetype "${archetypeId}"`);
    return Math.min(tier, arch.stages - 1);
  }

  /** The disabled master for an archetype at a LOD tier. */
  masterFor(archetypeId, tier) {
    return this._masters.get(keyOf(archetypeId, this.stageFor(archetypeId, tier)));
  }

  /**
   * The same (archetype, tier)'s non-geometry payload facts:
   * `{archetypeId, stage, minY, heightM, radiusM, vertCount, triCount,
   *   massIndex, pivots}`.
   *
   * `minY` is what ActorRig seats with. `massIndex` and `pivots` are carried,
   * not consumed — see the header.
   */
  metaFor(archetypeId, tier) {
    return this._meta.get(keyOf(archetypeId, this.stageFor(archetypeId, tier)));
  }

  /**
   * Dispose every master. Clones share geometry with their master, and
   * Babylon's Geometry is reference counted (`releaseForMesh` only disposes
   * once its last mesh lets go), so a live ActorRig does not lose its vertex
   * buffers if this runs first — but disposing the rigs first is still the
   * honest teardown order, and it is the one the spike uses.
   */
  dispose() {
    for (const mesh of this._masters.values()) mesh.dispose(false, false);
    this._masters.clear();
    this._meta.clear();
  }
}
