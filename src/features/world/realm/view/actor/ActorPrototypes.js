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
 * call. So the geometry stays ONE mesh, and `massIndex` is spent HERE, on the
 * skinning buffers below, rather than on topology.
 *
 * ── THE SKINNING BUFFERS: WRITTEN ONCE, SHARED BY EVERY CLONE ───────────────
 *
 * `matricesIndices` (stride 4, `[boneOfMass[massIndex[v]], 0, 0, 0]`) and
 * `matricesWeights` (`[1, 0, 0, 0]`) — the rigid single-influence assignment
 * P7 committed to, composed from model/actorRig.js's `boneOfMass` over the
 * payload's per-vertex mass ordinal.
 *
 * They are written at BOOT and never again, and the masters stay
 * NON-UPDATABLE, because GPU skinning deforms in the VERTEX SHADER from the
 * bone palette: the buffers say which bone owns a vertex, which is a property
 * of the genome and cannot change while the actor lives. (`Mesh.applySkeleton`
 * — the CPU path — DOES rewrite positions in place, which is why
 * ActorSkeleton.test.js builds its own updatable meshes and never touches
 * these. Writing through shared geometry would deform every actor of the
 * archetype at once.)
 *
 * Geometry is shared by `clone()`, so ONE write per master serves every actor
 * of that archetype for free — 8 buffers for the whole roster, not one pair
 * per spawned character.
 *
 * NO SKELETON HERE, THOUGH. `Mesh.clone()` copies the `skeleton` REFERENCE (a
 * live fact, asserted in ActorSkeleton.test.js), so a skeleton parked on a
 * master would be shared by every actor of its archetype and one guard raising
 * an arm would raise the whole faction. Skeletons are PER RIG — ActorRig.js
 * builds one per actor and re-attaches it on every LOD swap.
 *
 * NO SPROUT, NO INSTANCING. PropPrototypes' masters exist to be thin-instanced
 * with per-instance `matrix`/`instTint`/`sproutBirth` buffers; these exist to be
 * cloned into ordinary moving meshes. That difference is the whole reason
 * actorNME.js is not buildPropMaterial — see its header on the black-actor trap.
 */

/* global BABYLON */

import { ARCHETYPES, archetypeById } from '../../model/actorMasses.js';
import { buildActorRig } from '../../model/actorRig.js';
import { buildActorPayload } from '../../gen/actorGen.js';

const keyOf = (archetypeId, stage) => `${archetypeId}:${stage}`;

/**
 * The buffers every actor master MUST carry, checked at boot.
 *
 * EVERY ONE OF THESE FAILURES IS SILENT-ISH rather than fatal, which is
 * exactly why they get a loud guard here. actorNME.js closes the colourless
 * case at COMPILE time (MeshAttributeExistsBlock, so a colourless mesh renders
 * WHITE instead of the pure black an unbound `color` attribute used to
 * produce), and the normal path divides by max(length, eps) so a missing
 * normal degrades to ambient-only instead of NaN. Those are FAILURE modes, not
 * correct output: a roster of washed-out characters is the kind of regression
 * that ships, because nothing crashes.
 *
 * The two skinning kinds fail even more quietly. An absent vertex attribute
 * reads as `(0,0,0,1)` in the shader, so a missing `matricesIndices` welds
 * EVERY vertex to bone 0 — a character that tracks its root perfectly and
 * never bends a joint, the "perfectly rigid, perfectly plausible" failure this
 * phase kept finding.
 *
 * AND THAT ONE MOVES NOTHING AT ALL. Under `CANARY_POSE` the weld's worst
 * vertex displacement is EXACTLY 0 m — not small, zero — on all four
 * archetypes at both stages, because bone 0 is the one bone the canary never
 * poses (its table starts at bone 1) and bone 0's palette entry is therefore
 * bit-exact identity. So there is no small number here for a displacement gate
 * to catch: the mesh is byte-identical to its rest pose and reads exactly like
 * a correct actor standing still. (An earlier version of this comment quoted
 * 5.96e-8 here. That number is real but belongs to a DIFFERENT failure —
 * substituting `bone.updateMatrix` for the `_matrix` write, measured and
 * documented in ActorSkeleton.js's header.) Throwing at boot is the cheap
 * version of noticing.
 */
const REQUIRED_KINDS = Object.freeze([
  'position', 'normal', 'color', 'matricesIndices', 'matricesWeights',
]);

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
      // ONE rig per ARCHETYPE, hoisted out of the stage loop deliberately: the
      // bone tree is derived from the mass genome, which is the same list at
      // every stage (only tessellation varies — gen/actorGen.js). Sharing the
      // object is what guarantees "bone 3" means the same joint on the near
      // and far masters, so an ActorRig's skeleton keeps its meaning across a
      // LOD swap instead of silently re-indexing mid-stride.
      const rig = buildActorRig(arch.id);
      for (let stage = 0; stage < arch.stages; stage++) {
        const payload = buildActorPayload(arch.id, stage);
        const mesh = new BABYLON.Mesh(`actorMaster_${arch.id}_${stage}`, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = payload.positions;
        vd.normals = payload.normals;
        vd.colors = payload.colors;
        vd.indices = payload.indices;
        // The rigid single influence, composed here and nowhere else. ONLY
        // SLOT 0 IS WRITTEN; slots 1..3 are Float32Array's zero fill, and that
        // is load-bearing rather than incidental — a zero weight contributes
        // nothing whatever bone it names, so `[bone, 0, 0, 0]` / `[1, 0, 0, 0]`
        // is a correct 4-influence buffer and stays correct if anything ever
        // raises `numBoneInfluencers` above the 1 set below (which is a
        // PERFORMANCE decision, not a correctness one).
        //
        // The dependency on the fill is therefore REAL: allocate these from a
        // pool, or reuse a buffer across masters, and the stale tail becomes
        // three phantom influences at weight 0 — inert until someone raises
        // the influence count, then wrong. Zero the slots explicitly if these
        // ever stop being fresh allocations. The census in
        // ActorPrototypes.test.js pins all four slots byte for byte either way.
        const boneIndices = new Float32Array(payload.vertCount * 4);
        const boneWeights = new Float32Array(payload.vertCount * 4);
        for (let v = 0; v < payload.vertCount; v++) {
          boneIndices[v * 4] = rig.boneOfMass[payload.massIndex[v]];
          boneWeights[v * 4] = 1;
        }
        vd.matricesIndices = boneIndices;
        vd.matricesWeights = boneWeights;
        // `false` = NOT updatable, for all five buffers. See the header: the
        // GPU deforms from the palette, so nothing here is ever rewritten.
        vd.applyToMesh(mesh, false);

        // Both halves of Babylon's VERTEXCOLOR_NME contract
        // (`mesh.useVertexColors && mesh.isVerticesDataPresent(ColorKind)`) are
        // held explicitly rather than left to the Mesh default, because the
        // clone inherits whatever this master has and albedo IS the vertex
        // colour. `true` is the default today; writing it down is what stops a
        // future default flip from quietly repainting the roster white.
        mesh.useVertexColors = true;
        // ONE influence per vertex. Babylon defaults to 4, which is
        // NUMERICALLY harmless here (slots 1..3 carry weight 0), so this is a
        // cost line, not a correctness one: at 4 the vertex shader does four
        // mat4 blends per vertex to reach an answer one gives. Set on the
        // master because `Mesh.clone()` copies it (measured — the engine fact
        // is asserted in ActorRigSkin.test.js), so every actor inherits it.
        mesh.numBoneInfluencers = 1;
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
          // The bone tree the buffers above were composed against, carried so
          // ActorRig can build its skeleton without re-deriving it — and, more
          // importantly, so it CANNOT derive a different one. A rig whose
          // skeleton disagreed with the vertex buffers about which bone is
          // which would deform correctly-looking nonsense. Frozen by
          // buildActorRig's own freezeRig (shallow — `boneOfMass` is a typed
          // array and deliberately not frozen; it is a fresh allocation per
          // buildActorRig call, so a scribble damages only this copy).
          rig,
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
   *   massIndex, pivots, rig}`.
   *
   * `minY` is what ActorRig seats with; `rig` is what it builds its skeleton
   * from, and is the SAME object at every stage of an archetype. `massIndex`
   * and `pivots` are carried for diagnostics and for the tests that re-derive
   * the skinning census — the buffers themselves are already written.
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
