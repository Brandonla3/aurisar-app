/**
 * ActorPrototypes.test.js — the master table, as RUNTIME FACTS.
 *
 * NullEngine proves generated source and object state; it never draws a pixel.
 * That blind spot is where this project's render-criticals have come from (a
 * prop field collapsed to world origin, a shadow term multiplied twice, a
 * caster measured from world origin), so nothing here reads source text. Every
 * assertion below is a question asked of a live Babylon mesh: is it disabled,
 * does it carry a colour buffer, is the mesh returned for tier 5 the same
 * OBJECT as the one returned for tier 1, is it actually gone after dispose().
 *
 * The colour/normal guard gets its own teeth rather than a passing assertion:
 * the regression is injected at the VertexData seam, because a master that
 * silently loses its colour buffer does not crash — it renders the whole
 * roster white (actorNME.js's MeshAttributeExistsBlock fallback), which is the
 * kind of wrong that ships.
 *
 * ── THE CENSUS GATE ────────────────────────────────────────────────────────
 *
 * The skinning buffers get the same treatment, one level deeper. `max index <
 * bone count` and `every bone is used` are the assertions that come to mind
 * first, and BOTH survive a buffer shifted by one vertex, a buffer whose runs
 * are permuted, and a buffer built from a different stage's massIndex — the
 * whole family of faults that produce a character with one limb welded to the
 * wrong joint. So `skinCensus` compares the shipped buffer BYTE FOR BYTE
 * against the run-length image that `buildActorPayload` and `buildActorRig`
 * independently imply, and names the first disagreements down to the vertex,
 * the mass ordinal and the bone. Its teeth are a one-vertex shift, injected at
 * the same VertexData seam.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { ARCHETYPES } from '../../model/actorMasses.js';
import { buildActorRig } from '../../model/actorRig.js';
import { buildActorPayload } from '../../gen/actorGen.js';

let ActorPrototypes;
let engine;

beforeAll(async () => {
  // Load-bearing order: view/ modules read the ambient BABYLON global at import
  // time, so the global must exist BEFORE the dynamic import.
  globalThis.BABYLON = BABYLON;
  ({ ActorPrototypes } = await import('./ActorPrototypes.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

const newScene = () => {
  const scene = new BABYLON.Scene(engine);
  new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  return scene;
};

/** A stand-in for actorNME's NodeMaterial: this file tests the mesh table, not
 *  the shader. ActorRig.test.js compiles the REAL material against a live
 *  clone, which is where that integration belongs. */
const standIn = (scene) => new BABYLON.StandardMaterial('actorStandIn', scene);

/** Every (archetype, stage) pair the roster declares — 8 today. */
const PAIRS = ARCHETYPES.flatMap((a) => (
  Array.from({ length: a.stages }, (_, stage) => ({ id: a.id, stage }))
));

const INDICES_KIND = BABYLON.VertexBuffer.MatricesIndicesKind;
const WEIGHTS_KIND = BABYLON.VertexBuffer.MatricesWeightsKind;

/** Enough named complaints to diagnose; not one per vertex of a shifted buffer. */
const MAX_COMPLAINTS = 8;

/**
 * Every way a master's skinning buffers differ from the run-length image the
 * PAYLOAD and the RIG independently imply — named down to the vertex, the mass
 * ordinal and the bone. Empty means byte-exact.
 *
 * Re-derived from `buildActorPayload` + `buildActorRig`, deliberately NOT from
 * `metaFor`: comparing a module's output against the copy of its own input
 * that the same module carried forward is a self-consistency check, and this
 * project has already retired twelve tests that could not fail for that shape
 * of reason.
 */
function skinCensus(master, id, stage) {
  const payload = buildActorPayload(id, stage);
  const { boneOfMass, bones } = buildActorRig(id);
  const idx = master.getVerticesData(INDICES_KIND);
  const wts = master.getVerticesData(WEIGHTS_KIND);
  const verts = payload.vertCount;
  const out = [];
  const say = (m) => { if (out.length < MAX_COMPLAINTS) out.push(`${id}:${stage} ${m}`); };

  const want = verts * 4;
  if (!idx || idx.length !== want) return [`${id}:${stage} matricesIndices is ${idx ? idx.length : 'absent'}, want ${want}`];
  if (!wts || wts.length !== want) return [`${id}:${stage} matricesWeights is ${wts ? wts.length : 'absent'}, want ${want}`];

  // THE RUNS, read off massIndex. gen/actorGen.js appends mass by mass and
  // fills each range in one go, so a healthy stream is exactly one contiguous
  // run per mass, in mass-ordinal order. Splitting or permuting them is how a
  // vertex stream gets reordered under a buffer that still passes every
  // summary check below.
  const runs = [];
  for (let v = 0; v < verts; v++) {
    const mass = payload.massIndex[v];
    const last = runs[runs.length - 1];
    if (!last || last.mass !== mass) runs.push({ mass, first: v, count: 1 });
    else last.count++;
  }
  const massCount = ARCHETYPES.find((a) => a.id === id).masses.length;
  if (runs.length !== massCount) say(`massIndex forms ${runs.length} runs across ${massCount} masses — a mass whose vertices are not contiguous`);
  runs.forEach((r, i) => {
    if (r.mass !== i) say(`run ${i} carries mass ordinal ${r.mass} — the ranges are permuted`);
  });

  // The summary checks run BEFORE the per-vertex sweep so a flood of vertex
  // complaints can never crowd them out of the failure message.
  const used = new Set();
  let maxBone = -1;
  for (let v = 0; v < verts; v++) {
    used.add(idx[v * 4]);
    if (idx[v * 4] > maxBone) maxBone = idx[v * 4];
  }
  if (maxBone !== bones.length - 1) say(`highest bone index is ${maxBone}, but the rig has ${bones.length} bones (0..${bones.length - 1})`);
  if (used.size !== bones.length) say(`only ${used.size} of ${bones.length} bones are bound — a roster welded to too few bones deforms as a rigid lump`);

  for (const run of runs) {
    const bone = boneOfMass[run.mass];
    for (let v = run.first; v < run.first + run.count; v++) {
      const o = v * 4;
      if (idx[o] !== bone) say(`vertex ${v} (mass ordinal ${run.mass}) binds bone ${idx[o]}, not ${bone}`);
      if (wts[o] !== 1) say(`vertex ${v} (mass ordinal ${run.mass}) has weight ${wts[o]}, not 1`);
      for (let k = 1; k < 4; k++) {
        if (idx[o + k] !== 0) say(`vertex ${v} influence ${k} names bone ${idx[o + k]}, not 0`);
        if (wts[o + k] !== 0) say(`vertex ${v} influence ${k} has weight ${wts[o + k]}, not 0`);
      }
    }
  }
  return out;
}

describe('ActorPrototypes — the master table', () => {
  it('builds exactly one master per (archetype, stage), each a distinct mesh', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      // Guards against a vacuous sweep: an empty roster would make every
      // per-master assertion in this file trivially true.
      expect(PAIRS.length).toBeGreaterThan(0);

      const masters = PAIRS.map(({ id, stage }) => protos.masterFor(id, stage));
      for (const m of masters) expect(m).toBeTruthy();
      // Unique per key — not one shared mesh handed out under eight names.
      expect(new Set(masters).size).toBe(PAIRS.length);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('every master is DISABLED, unpickable, and shares the one material', () => {
    const scene = newScene();
    try {
      const material = standIn(scene);
      const protos = new ActorPrototypes(scene, material);
      let checked = 0;
      for (const { id, stage } of PAIRS) {
        const m = protos.masterFor(id, stage);
        expect(m.isEnabled(false), `${id}:${stage} master must never render`).toBe(false);
        expect(m.isPickable).toBe(false);
        expect(m.material).toBe(material);
        checked++;
      }
      expect(checked).toBe(PAIRS.length);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('every master carries position, normal AND colour data, with useVertexColors on', () => {
    // Both halves of Babylon's VERTEXCOLOR_NME contract
    // (`useVertexColors && isVerticesDataPresent(ColorKind)`), plus the normal
    // buffer actorNME divides by. Neither failure crashes: a colourless actor
    // renders WHITE and a normal-less one renders ambient-only. Those are the
    // failure modes the material degrades to, not correct output.
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      let checked = 0;
      for (const { id, stage } of PAIRS) {
        const m = protos.masterFor(id, stage);
        expect(m.isVerticesDataPresent('position'), `${id}:${stage} position`).toBe(true);
        expect(m.isVerticesDataPresent('normal'), `${id}:${stage} normal`).toBe(true);
        expect(m.isVerticesDataPresent('color'), `${id}:${stage} color`).toBe(true);
        expect(m.useVertexColors, `${id}:${stage} useVertexColors`).toBe(true);
        expect(m.getTotalIndices()).toBeGreaterThan(0);
        checked++;
      }
      expect(checked).toBe(PAIRS.length);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('refuses to build a master whose colour buffer went missing', () => {
    // Teeth for the guard above, injected at the one seam that can produce the
    // regression without touching gen/: VertexData.applyToMesh. A master that
    // quietly lost its colours would ship a roster of white characters.
    const scene = newScene();
    const realApply = BABYLON.VertexData.prototype.applyToMesh;
    BABYLON.VertexData.prototype.applyToMesh = function applyToMesh(mesh, updatable) {
      this.colors = null;
      return realApply.call(this, mesh, updatable);
    };
    try {
      expect(() => new ActorPrototypes(scene, standIn(scene)))
        .toThrow(/\[ActorPrototypes\].*has no color data/);
    } finally {
      BABYLON.VertexData.prototype.applyToMesh = realApply;
      scene.dispose();
    }
  });

  it('refuses to build a master whose normal buffer went missing', () => {
    const scene = newScene();
    const realApply = BABYLON.VertexData.prototype.applyToMesh;
    BABYLON.VertexData.prototype.applyToMesh = function applyToMesh(mesh, updatable) {
      this.normals = null;
      return realApply.call(this, mesh, updatable);
    };
    try {
      expect(() => new ActorPrototypes(scene, standIn(scene)))
        .toThrow(/\[ActorPrototypes\].*has no normal data/);
    } finally {
      BABYLON.VertexData.prototype.applyToMesh = realApply;
      scene.dispose();
    }
  });

  it('refuses to build a master whose bone-index buffer went missing', () => {
    // The quietest of the five. An absent vertex attribute reads as
    // (0,0,0,1) in the shader, so a lost matricesIndices welds every vertex
    // to bone 0: a character that follows its root perfectly and never bends.
    const scene = newScene();
    const realApply = BABYLON.VertexData.prototype.applyToMesh;
    BABYLON.VertexData.prototype.applyToMesh = function applyToMesh(mesh, updatable) {
      this.matricesIndices = null;
      return realApply.call(this, mesh, updatable);
    };
    try {
      expect(() => new ActorPrototypes(scene, standIn(scene)))
        .toThrow(/\[ActorPrototypes\].*has no matricesIndices data/);
    } finally {
      BABYLON.VertexData.prototype.applyToMesh = realApply;
      scene.dispose();
    }
  });
});

describe('ActorPrototypes — THE CENSUS: skinning buffers', () => {
  it('every master carries both skinning buffers, non-updatable, at ONE influence', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      let checked = 0;
      for (const { id, stage } of PAIRS) {
        const m = protos.masterFor(id, stage);
        expect(m.isVerticesDataPresent(INDICES_KIND), `${id}:${stage} matricesIndices`).toBe(true);
        expect(m.isVerticesDataPresent(WEIGHTS_KIND), `${id}:${stage} matricesWeights`).toBe(true);
        // NOT updatable: GPU skinning deforms in the vertex shader, so these
        // are written once at boot. An updatable buffer would also be one that
        // Mesh.applySkeleton could write through — into geometry every actor
        // of this archetype shares.
        expect(m.geometry.getVertexBuffer(INDICES_KIND).isUpdatable()).toBe(false);
        expect(m.geometry.getVertexBuffer(WEIGHTS_KIND).isUpdatable()).toBe(false);
        expect(m.numBoneInfluencers, `${id}:${stage} influence count`).toBe(1);
        // ...and the masters still carry no skeleton. One here would be
        // shared by every clone, and the whole archetype would pose in lockstep.
        expect(m.skeleton, `${id}:${stage} master must own no skeleton`).toBeNull();
        checked++;
      }
      expect(checked).toBe(PAIRS.length);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('matricesIndices is a BYTE-EXACT run-length image of massIndex composed with boneOfMass', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      const complaints = PAIRS.flatMap(({ id, stage }) => (
        skinCensus(protos.masterFor(id, stage), id, stage)
      ));
      expect(
        complaints,
        'The shipped buffer disagrees with the run-length image buildActorPayload and\n' +
          'buildActorRig imply. Contiguous per mass, in mass-ordinal order, one influence\n' +
          'per vertex at weight 1 — anything else deforms a limb about the wrong joint.',
      ).toEqual([]);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the census has TEETH: a ONE-VERTEX shift is caught, and named', () => {
    // The fault every summary check survives. Shifting the stream by one
    // vertex leaves the value set, the maximum and the per-mass counts
    // untouched; only the vertices at a run boundary change bone, and only a
    // byte-exact comparison sees them.
    const scene = newScene();
    const realApply = BABYLON.VertexData.prototype.applyToMesh;
    BABYLON.VertexData.prototype.applyToMesh = function applyToMesh(mesh, updatable) {
      const src = this.matricesIndices;
      if (src) {
        const shifted = new Float32Array(src.length);
        shifted.set(src.subarray(4)); // every vertex takes its neighbour's bone
        shifted.set(src.subarray(src.length - 4), src.length - 4); // the last keeps its own
        this.matricesIndices = shifted;
      }
      return realApply.call(this, mesh, updatable);
    };
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      const complaints = PAIRS.flatMap(({ id, stage }) => (
        skinCensus(protos.masterFor(id, stage), id, stage)
      ));
      expect(
        complaints.length,
        'A one-vertex shift left the census green, so it is not reading the buffer\n' +
          'byte for byte — which is the only way this class of fault is visible.',
      ).toBeGreaterThan(0);
      expect(complaints[0]).toMatch(/vertex \d+ \(mass ordinal \d+\) binds bone \d+, not \d+/);
      protos.dispose();
    } finally {
      BABYLON.VertexData.prototype.applyToMesh = realApply;
      scene.dispose();
    }
  });
});

describe('ActorPrototypes — lookup', () => {
  it('throws on an unknown archetype id, from every entry point', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      expect(() => protos.masterFor('gelatinous-cube', 0))
        .toThrow(/\[ActorPrototypes\] unknown archetype "gelatinous-cube"/);
      expect(() => protos.metaFor('gelatinous-cube', 0)).toThrow(/unknown archetype/);
      expect(() => protos.stageFor('gelatinous-cube', 0)).toThrow(/unknown archetype/);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('clamps a tier beyond the archetype`s stage count to its LAST stage', () => {
    // PropPrototypes' contract, held for actors: props' FAR tier (2) — and
    // anything past it — must resolve to a real mesh, not undefined. A future
    // single-stage archetype renders its one mesh at every tier.
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      for (const arch of ARCHETYPES) {
        const last = arch.stages - 1;
        expect(protos.stageFor(arch.id, arch.stages)).toBe(last);
        expect(protos.stageFor(arch.id, 5)).toBe(last);
        expect(protos.masterFor(arch.id, 5)).toBe(protos.masterFor(arch.id, last));
        expect(protos.metaFor(arch.id, 5).stage).toBe(last);
        // ...and clamping is not collapsing everything onto one mesh: the
        // tiers that DO exist must still be different meshes.
        expect(protos.masterFor(arch.id, 0)).not.toBe(protos.masterFor(arch.id, last));
      }
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the far stage really is coarser geometry, not the near mesh twice', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      for (const arch of ARCHETYPES) {
        const near = protos.masterFor(arch.id, 0).getTotalVertices();
        const far = protos.masterFor(arch.id, 1).getTotalVertices();
        expect(far, `${arch.id} far stage must be cheaper than near`).toBeLessThan(near);
        // Bit-for-bit what the generator emits — no resampling in between.
        expect(near).toBe(buildActorPayload(arch.id, 0).vertCount);
        expect(far).toBe(buildActorPayload(arch.id, 1).vertCount);
      }
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorPrototypes — metaFor', () => {
  it('describes the SAME stage masterFor returns', () => {
    // If these two ever disagreed, a rig would seat by one stage`s minY while
    // rendering another`s geometry and the actor would float or sink.
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      for (const { id, stage } of PAIRS) {
        const meta = protos.metaFor(id, stage);
        const master = protos.masterFor(id, stage);
        const payload = buildActorPayload(id, stage);
        expect(meta.archetypeId).toBe(id);
        expect(meta.stage).toBe(stage);
        expect(meta.vertCount).toBe(master.getTotalVertices());
        expect(meta.triCount).toBe(master.getTotalIndices() / 3);
        expect(meta.minY).toBe(payload.minY);
        expect(meta.heightM).toBe(payload.heightM);
        expect(meta.radiusM).toBe(payload.radiusM);
      }
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('carries massIndex and pivots through untouched — data for P7, unused here', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      for (const { id, stage } of PAIRS) {
        const meta = protos.metaFor(id, stage);
        expect(meta.massIndex).toBeInstanceOf(Uint16Array);
        expect(meta.massIndex.length).toBe(meta.vertCount);
        // One ordinal per vertex, and every ordinal a real index into the
        // archetype`s mass list.
        const arch = ARCHETYPES.find((a) => a.id === id);
        expect(Math.max(...meta.massIndex)).toBe(arch.masses.length - 1);
        expect(Array.isArray(meta.pivots)).toBe(true);
        expect(meta.pivots.length).toBeGreaterThan(0);
        for (const p of meta.pivots) {
          expect(p.pivotId.startsWith(`${id}.p`)).toBe(true);
          expect(p.massIds.length).toBeGreaterThan(1);
        }
      }
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('carries the RIG, and it is the SAME rig object at every stage', () => {
    // Load-bearing for ActorRig: its skeleton is built once, from whichever
    // stage it happened to start at, and then re-attached to the OTHER
    // stage's clone on every LOD swap. If the two stages carried different
    // rigs, "bone 3" could mean a different joint after a swap and the actor
    // would deform correctly-looking nonsense at 96 m.
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      for (const arch of ARCHETYPES) {
        const rig = protos.metaFor(arch.id, 0).rig;
        expect(rig.archetypeId).toBe(arch.id);
        expect(rig.bones.length).toBe(buildActorRig(arch.id).bones.length);
        expect([...rig.boneOfMass]).toEqual([...buildActorRig(arch.id).boneOfMass]);
        expect(rig.boneOfMass.length).toBe(arch.masses.length);
        for (let stage = 1; stage < arch.stages; stage++) {
          expect(
            protos.metaFor(arch.id, stage).rig,
            `${arch.id} stage ${stage} carries a DIFFERENT rig object than stage 0`,
          ).toBe(rig);
        }
        // Frozen, so nothing downstream can retune a skeleton several
        // prototypes share.
        expect(Object.isFrozen(rig)).toBe(true);
        expect(Object.isFrozen(rig.bones)).toBe(true);
      }
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a master is ONE mesh — never a parent with per-mass children', () => {
    // The budget census (realmActorBudget.test.js) spends exactly 1 draw call
    // per actor. Slicing massIndex`s vertex ranges into child nodes would
    // multiply that by the mass count (11 for orghon) and invalidate it.
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      for (const { id, stage } of PAIRS) {
        const master = protos.masterFor(id, stage);
        expect(master.getChildren().length, `${id}:${stage} must have no children`).toBe(0);
        expect(master.subMeshes.length, `${id}:${stage} must be one submesh`).toBe(1);
      }
      // And the scene holds exactly the masters — nothing else was created.
      expect(scene.meshes.length).toBe(PAIRS.length);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorPrototypes — dispose', () => {
  it('actually releases every master', () => {
    const scene = newScene();
    try {
      const protos = new ActorPrototypes(scene, standIn(scene));
      const masters = PAIRS.map(({ id, stage }) => protos.masterFor(id, stage));
      expect(masters.every((m) => !m.isDisposed())).toBe(true);
      expect(scene.meshes.length).toBe(PAIRS.length);

      protos.dispose();

      for (const m of masters) expect(m.isDisposed(), `${m.name} still alive`).toBe(true);
      expect(scene.meshes.length).toBe(0);
      for (const { id, stage } of PAIRS) {
        expect(scene.getMeshByName(`actorMaster_${id}_${stage}`)).toBeNull();
        // The table is emptied too, not just the meshes torn down.
        expect(protos.masterFor(id, stage)).toBeUndefined();
        expect(protos.metaFor(id, stage)).toBeUndefined();
      }
    } finally {
      scene.dispose();
    }
  });

  it('does not dispose the shared material out from under anything else', () => {
    // `expect(material.isDisposed).not.toBe(true)` used to be the headline
    // assertion here, and it could not fail in either direction: Babylon's
    // Material has no `isDisposed` member at all (`'isDisposed' in material`
    // is false, before and after dispose()), so it read
    // `expect(undefined).not.toBe(true)`. It looked like correct API use
    // because `Node.isDisposed()` — the real method, used correctly twenty
    // lines above — does exist. Replaced with a signal that genuinely fires:
    // Material's own dispose observable.
    const scene = newScene();
    try {
      const material = standIn(scene);
      let disposeFired = false;
      material.onDisposeObservable.add(() => { disposeFired = true; });
      const protos = new ActorPrototypes(scene, material);
      protos.dispose();
      expect(
        disposeFired,
        'ActorPrototypes.dispose() disposed the material it was HANDED — it owns its masters, not the '
        + 'shared material, which the spike also gives to anything else that needs it',
      ).toBe(false);
      expect(scene.getMaterialByName('actorStandIn')).toBe(material);
    } finally {
      scene.dispose();
    }
  });
});
