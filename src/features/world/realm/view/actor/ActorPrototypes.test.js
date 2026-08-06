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
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { ARCHETYPES } from '../../model/actorMasses.js';
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
