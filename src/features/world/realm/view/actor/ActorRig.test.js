/**
 * ActorRig.test.js — a live actor, as RUNTIME FACTS.
 *
 * The headline gate is the FROZEN WORLD MATRIX one, and it is deliberately
 * behavioural rather than a flag check: PropStreamer calls freezeWorldMatrix()
 * on its carriers and is right to, so the copy-paste that pins every character
 * in the game at spawn is one line away at all times. A frozen mesh looks
 * perfectly correct to every structural assertion — right geometry, right
 * material, right parent, right local position — and reveals itself only when
 * something MOVES. So this file moves it and reads absolutePosition back.
 *
 * Everything else is asked of live objects too: is the old mesh really
 * disposed after a tier swap, is the disposed mesh really gone from the shadow
 * rig, does the payload`s lowest vertex really land on the terrain height it
 * was seated at (computed from the vertex buffer through the world matrix, not
 * from a bounding box Babylon might be caching).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { ARCHETYPES } from '../../model/actorMasses.js';
import { PROP_TIER, TIER_BANDS_M, TIER_HYST_M } from '../../model/propLod.js';

let ActorPrototypes;
let ActorRig;
let tierForDistance;
let ActorShadowRig;
let buildActorMaterial;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ ActorPrototypes } = await import('./ActorPrototypes.js'));
  ({ ActorRig, tierForDistance } = await import('./ActorRig.js'));
  ({ ActorShadowRig } = await import('../lighting/ActorShadowRig.js'));
  ({ buildActorMaterial } = await import('../materials/actorNME.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

const MASTER_COUNT = ARCHETYPES.reduce((n, a) => n + a.stages, 0);

function newWorld() {
  const scene = new BABYLON.Scene(engine);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  const material = new BABYLON.StandardMaterial('actorStandIn', scene);
  const protos = new ActorPrototypes(scene, material);
  return { scene, sun, material, protos };
}

/**
 * The lowest world-space Y of a mesh`s actual vertices, straight through its
 * world matrix. Deliberately not `boundingBox.minimumWorld`: that is a cached
 * derivative, and the claim under test is about where the geometry IS.
 */
function lowestWorldY(mesh) {
  const positions = mesh.getVerticesData('position');
  const wm = mesh.computeWorldMatrix(true);
  const v = new BABYLON.Vector3();
  let lowest = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
      positions[i], positions[i + 1], positions[i + 2], wm, v,
    );
    if (v.y < lowest) lowest = v.y;
  }
  return lowest;
}

describe('ActorRig — construction', () => {
  it('is a root transform with exactly ONE mesh under it — no per-mass children', () => {
    // The budget commitment, mechanically. realmActorBudget.test.js spends
    // `maxSimultaneousActors * 1` draw call; a rig that sliced massIndex`s
    // vertex ranges into child nodes would cost one per mass instead.
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'legion');
      expect(rig.root.getClassName()).toBe('TransformNode');
      expect(rig.root.getDescendants()).toEqual([rig.mesh]);
      expect(rig.mesh.getChildren().length).toBe(0);
      expect(rig.mesh.subMeshes.length).toBe(1);
      // Exactly one new mesh in the scene beyond the masters.
      expect(scene.meshes.length).toBe(MASTER_COUNT + 1);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the actor mesh is ENABLED, and shares the master`s geometry and material', () => {
    // A clone inherits the master`s disabled state; without the explicit
    // re-enable the actor is a flawless mesh that never draws.
    const { scene, material, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'unbound');
      const master = protos.masterFor('unbound', PROP_TIER.NEAR);
      expect(rig.mesh.isEnabled(false)).toBe(true);
      expect(master.isEnabled(false)).toBe(false); // ...and the master stays off
      expect(rig.mesh.material).toBe(material);
      expect(rig.mesh.geometry).toBe(master.geometry); // shared, not copied
      expect(rig.mesh.getTotalVertices()).toBe(master.getTotalVertices());
      expect(rig.mesh.useVertexColors).toBe(true);
      expect(rig.mesh.isVerticesDataPresent('color')).toBe(true);
      expect(rig.mesh.isVerticesDataPresent('normal')).toBe(true);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('throws on an unknown archetype at construction, not at the first frame', () => {
    const { scene, protos } = newWorld();
    try {
      expect(() => new ActorRig(scene, protos, 'gelatinous-cube')).toThrow(/unknown archetype/);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — live world matrices', () => {
  it('NEVER freezes its world matrix: moving the root moves the mesh', () => {
    // THE gate. PropStreamer freezes its carriers (correctly — a prop chunk
    // never moves), and copying that here would pin every actor at spawn while
    // the sim, the camera and the shadow rig all believed it had walked away.
    // Proven by MOVING it, because a frozen mesh passes every structural check.
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'orghon');
      rig.seatOn(0, 0, 0);
      const first = lowestWorldY(rig.mesh);
      const startAbs = rig.mesh.absolutePosition.clone();

      rig.seatOn(120, 7.25, -46);
      rig.root.computeWorldMatrix(true);
      rig.mesh.computeWorldMatrix(true);

      const moved = rig.mesh.absolutePosition;
      expect(moved.x).toBeCloseTo(120, 6);
      expect(moved.z).toBeCloseTo(-46, 6);
      expect(moved.equals(startAbs), 'the actor did not move — world matrix frozen?').toBe(false);
      // ...and the geometry followed, not just the node`s reported position.
      expect(lowestWorldY(rig.mesh) - first).toBeCloseTo(7.25, 4);

      // The flags, as corroboration only. The behaviour above is the claim.
      expect(rig.root.isWorldMatrixFrozen).toBe(false);
      expect(rig.mesh.isWorldMatrixFrozen).toBe(false);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('rotates with the root, so a turning actor turns its geometry', () => {
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'legion');
      rig.seatOn(0, 0, 0);
      const forward = new BABYLON.Vector3(0, 0, 1);
      const before = BABYLON.Vector3.TransformNormal(forward, rig.mesh.computeWorldMatrix(true));
      rig.setYaw(Math.PI / 2);
      const after = BABYLON.Vector3.TransformNormal(forward, rig.mesh.computeWorldMatrix(true));
      expect(before.z).toBeCloseTo(1, 5);
      expect(after.x).toBeCloseTo(1, 5);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — ground seating', () => {
  it('puts the payload`s LOWEST VERTEX on the seated ground height, at every stage', () => {
    // minY is not stage-invariant: a capped foot`s near stage (icosphere
    // level 2) reaches just below the authored sole plane, its far stage
    // (level 1) reaches only 0.851r down and stops just above it. Seating by
    // the LIVE stage`s own minY is what stops a near actor standing 5-10 mm
    // into the terrain.
    const { scene, protos } = newWorld();
    try {
      const groundY = 7.5;
      let checked = 0;
      for (const arch of ARCHETYPES) {
        for (const tier of [PROP_TIER.NEAR, PROP_TIER.MID]) {
          const rig = new ActorRig(scene, protos, arch.id, { name: `${arch.id}${tier}`, tier });
          rig.seatOn(12, groundY, -3);
          expect(
            lowestWorldY(rig.mesh),
            `${arch.id} tier ${tier} is not standing on the ground`,
          ).toBeCloseTo(groundY, 5);
          rig.dispose();
          checked++;
        }
      }
      expect(checked).toBe(ARCHETYPES.length * 2);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the residual it cannot remove is the LOD-swap shift, and it is sub-centimetre-scale', () => {
    // Documented, and pinned so it cannot grow unnoticed. Seating per stage
    // trades the far stage`s float (0.000..+0.011 above the sole plane) for a
    // vertical translation on tier swap, worst 0.0211 m (orghon). At the 96 m
    // band edge that subtends under a third of a pixel at 1080p. Sinking the
    // far feet to erase it would move the band-occupancy measurements the
    // phase`s exit-bar gate rests on.
    const { scene, protos } = newWorld();
    try {
      let worst = 0;
      for (const arch of ARCHETYPES) {
        const near = protos.metaFor(arch.id, PROP_TIER.NEAR).minY;
        const far = protos.metaFor(arch.id, PROP_TIER.MID).minY;
        expect(near).toBeLessThanOrEqual(0); // near reaches at or below the sole
        expect(far).toBeGreaterThanOrEqual(0); // far stops at or above it
        worst = Math.max(worst, Math.abs(near - far));
      }
      expect(worst).toBeGreaterThan(0); // ...or this test proves nothing
      expect(worst, 'measured worst is 0.0211 m (orghon)').toBeLessThanOrEqual(0.022);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('tierForDistance — LOD policy', () => {
  const { nearMaxM } = TIER_BANDS_M;

  it('bands by distance from a cold start', () => {
    expect(tierForDistance(0, null)).toBe(PROP_TIER.NEAR);
    expect(tierForDistance(nearMaxM, null)).toBe(PROP_TIER.NEAR);
    expect(tierForDistance(nearMaxM + 0.001, null)).toBe(PROP_TIER.MID);
    expect(tierForDistance(5000, null)).toBe(PROP_TIER.MID);
  });

  it('needs the full hysteresis band to flip, in both directions', () => {
    expect(tierForDistance(nearMaxM + TIER_HYST_M, PROP_TIER.NEAR)).toBe(PROP_TIER.NEAR);
    expect(tierForDistance(nearMaxM + TIER_HYST_M + 0.001, PROP_TIER.NEAR)).toBe(PROP_TIER.MID);
    expect(tierForDistance(nearMaxM - TIER_HYST_M, PROP_TIER.MID)).toBe(PROP_TIER.MID);
    expect(tierForDistance(nearMaxM - TIER_HYST_M - 0.001, PROP_TIER.MID)).toBe(PROP_TIER.NEAR);
  });

  it('never thrashes an actor jogging along the boundary', () => {
    let tier = tierForDistance(nearMaxM, null);
    const first = tier;
    for (let i = 0; i < 40; i++) {
      tier = tierForDistance(nearMaxM + (i % 2 === 0 ? 0.5 : -0.5), tier);
      expect(tier).toBe(first);
    }
  });
});

describe('ActorRig — LOD swaps', () => {
  it('rebuilds the mesh when the tier changes, and disposes the old one', () => {
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'unbound');
      rig.seatOn(0, 0, 0);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.NEAR);
      const nearMesh = rig.mesh;
      // Captured BEFORE the swap: a disposed mesh reports 0 vertices, which
      // would make the comparison below pass for the wrong reason.
      const nearVerts = nearMesh.getTotalVertices();
      expect(rig.swapCount).toBe(0);

      rig.seatOn(0, 0, 500);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.MID);
      expect(rig.mesh).not.toBe(nearMesh);
      expect(nearMesh.isDisposed(), 'the near mesh leaked').toBe(true);
      expect(rig.swapCount).toBe(1);
      // Coarser geometry, and still exactly one actor mesh in the scene.
      expect(rig.mesh.getTotalVertices()).toBeLessThan(nearVerts);
      expect(scene.meshes.length).toBe(MASTER_COUNT + 1);
      expect(rig.root.getDescendants()).toEqual([rig.mesh]);

      // ...and back again, re-seated and re-enabled.
      rig.seatOn(0, 0, 0);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.NEAR);
      expect(rig.mesh.isEnabled(false)).toBe(true);
      expect(lowestWorldY(rig.mesh)).toBeCloseTo(0, 5);
      expect(rig.swapCount).toBe(2);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a FAR-constructed rig does NOT rebuild when it resolves to MID', () => {
    // FAR and MID both clamp to stage 1 on a two-stage archetype, so a rig
    // built at FAR is already rendering the geometry MID asks for. update()
    // compared TIERS until the P6 review, so its first call paid a clone +
    // shadow re-registration + dispose to swap a mesh for an identical one.
    // Constructing at a non-NEAR tier is explicitly legal (`opts.tier`), and
    // props' FAR is a value ActorRig's own doc says can arrive from
    // anywhere, so this is a real path and not a contrived one.
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'orghon', { tier: PROP_TIER.FAR });
      const builtMesh = rig.mesh;
      expect(protos.stageFor('orghon', PROP_TIER.FAR)).toBe(protos.stageFor('orghon', PROP_TIER.MID));

      rig.seatOn(0, 0, 500);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.MID);
      expect(rig.swapCount, 'the rig rebuilt a mesh it was already rendering').toBe(0);
      expect(rig.mesh, 'same mesh object, not a fresh clone').toBe(builtMesh);
      expect(builtMesh.isDisposed()).toBe(false);
      expect(scene.meshes.length).toBe(MASTER_COUNT + 1);

      // ...and it still swaps for a REAL stage change afterwards, so the
      // early-out did not simply disable tiering.
      rig.seatOn(0, 0, 0);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.NEAR);
      expect(rig.swapCount).toBe(1);
      expect(rig.mesh).not.toBe(builtMesh);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('measures from the focus point, not world origin', () => {
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'magistari');
      rig.seatOn(1000, 0, 0); // far from origin...
      expect(rig.update({ x: 1000, y: 0, z: 0 })).toBe(PROP_TIER.NEAR); // ...next to THIS focus
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('measures the root`s WORLD position, not its local offset', () => {
    // The bug ActorShadowRig already shipped once: a parented node`s .position
    // is a local offset that never changes as the parent moves.
    const { scene, protos } = newWorld();
    try {
      const carrier = new BABYLON.TransformNode('carrier', scene);
      carrier.position.set(1000, 0, 0);
      const rig = new ActorRig(scene, protos, 'magistari');
      rig.root.parent = carrier;
      rig.seatOn(0, 0, 0); // local origin — 1000 m away in world space
      expect(rig.update({ x: 1000, y: 0, z: 0 })).toBe(PROP_TIER.NEAR);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.MID);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('update() after dispose() is a no-op, not a throw', () => {
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'legion');
      rig.dispose();
      expect(() => rig.update({ x: 0, y: 0, z: 5000 })).not.toThrow();
      expect(rig.mesh).toBeNull();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — shadow registration', () => {
  it('registers exactly ONE caster per actor', () => {
    const { scene, sun, protos } = newWorld();
    try {
      const shadowRig = new ActorShadowRig(scene, sun);
      const a = new ActorRig(scene, protos, 'legion', { name: 'a', shadowRig });
      expect(shadowRig._casters.size).toBe(1);
      expect(shadowRig._casters.has(a.mesh)).toBe(true);
      // ...and "exactly one" is per ACTOR, not a global cap.
      const b = new ActorRig(scene, protos, 'orghon', { name: 'b', shadowRig });
      expect(shadowRig._casters.size).toBe(2);
      expect(shadowRig._casters.has(b.mesh)).toBe(true);

      a.seatOn(0, 0, 0);
      shadowRig.update({ x: 0, y: 0, z: 0 });
      expect(shadowRig.bucketOf(a.mesh)).toBe('near');
      expect(shadowRig._generator.getShadowMap().renderList).toContain(a.mesh);
      // addCaster`s own contract: actors receive shadows as well as cast them.
      expect(a.mesh.receiveShadows).toBe(true);

      a.dispose();
      b.dispose();
      shadowRig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('hands over the caster on a tier swap — never leaves a disposed mesh registered', () => {
    const { scene, sun, protos } = newWorld();
    try {
      const shadowRig = new ActorShadowRig(scene, sun);
      const rig = new ActorRig(scene, protos, 'unbound', { shadowRig });
      rig.seatOn(0, 0, 0);
      shadowRig.update({ x: 0, y: 0, z: 0 });
      const nearMesh = rig.mesh;
      expect(shadowRig._generator.getShadowMap().renderList).toContain(nearMesh);

      rig.seatOn(0, 0, 500);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(rig.mesh).not.toBe(nearMesh);
      // Still one caster, and it is the LIVE mesh — a disposed mesh left in
      // the map would sit in the generator`s renderList forever.
      expect(shadowRig._casters.size).toBe(1);
      expect(shadowRig._casters.has(rig.mesh)).toBe(true);
      expect(shadowRig.bucketOf(nearMesh)).toBeNull();
      expect(shadowRig._generator.getShadowMap().renderList).not.toContain(nearMesh);

      rig.dispose();
      shadowRig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('forwards pinShadow, and works with no shadow rig at all', () => {
    const { scene, sun, protos } = newWorld();
    try {
      const shadowRig = new ActorShadowRig(scene, sun);
      const pinned = new ActorRig(scene, protos, 'legion', {
        name: 'pinned', shadowRig, pinShadow: true,
      });
      pinned.seatOn(900, 0, 0); // far outside the near radius
      shadowRig.update({ x: 0, y: 0, z: 0 });
      expect(shadowRig.bucketOf(pinned.mesh)).toBe('near');

      // No shadow rig: an actor must still build and move.
      const orphan = new ActorRig(scene, protos, 'legion', { name: 'orphan' });
      expect(() => orphan.update({ x: 0, y: 0, z: 0 })).not.toThrow();
      expect(orphan.mesh).toBeTruthy();

      pinned.dispose();
      orphan.dispose();
      shadowRig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — dispose', () => {
  it('releases the mesh, the root, and the shadow registration', () => {
    const { scene, sun, protos } = newWorld();
    try {
      const shadowRig = new ActorShadowRig(scene, sun);
      const rig = new ActorRig(scene, protos, 'orghon', { shadowRig });
      rig.seatOn(0, 0, 0);
      shadowRig.update({ x: 0, y: 0, z: 0 });
      const { mesh, root } = rig;
      expect(shadowRig._generator.getShadowMap().renderList).toContain(mesh);

      rig.dispose();

      expect(mesh.isDisposed()).toBe(true);
      expect(root.isDisposed()).toBe(true);
      expect(shadowRig._casters.size).toBe(0);
      expect(shadowRig._generator.getShadowMap().renderList).not.toContain(mesh);
      // Back to just the masters — the actor left nothing behind.
      expect(scene.meshes.length).toBe(MASTER_COUNT);
      expect(() => rig.dispose()).not.toThrow(); // idempotent

      shadowRig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — with the REAL actor material', () => {
  it('compiles, and demands no vertex attribute the live actor mesh lacks', async () => {
    // The end-to-end form of actorNME.test.js`s black-actor guard: not a
    // fixture mesh built in the test, but the actual clone ActorRig hands the
    // renderer. GLSL only — NullEngine cannot compile a WGSL LightBlock
    // effect (the UMD bundle registers no WGSL lightFragmentDeclaration), a
    // packaging gap documented in actorNME.test.js.
    const scene = new BABYLON.Scene(engine);
    try {
      new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
      const { material } = await buildActorMaterial(scene, {
        name: 'rigActor', shaderLanguage: BABYLON.ShaderLanguage.GLSL,
      });
      const protos = new ActorPrototypes(scene, material);
      const rig = new ActorRig(scene, protos, 'unbound');

      const sub = rig.mesh.subMeshes[0];
      expect(material.isReadyForSubMesh(rig.mesh, sub)).toBe(true);
      const required = sub.effect.getAttributesNames();
      expect(required.length).toBeGreaterThan(0);
      const unprovided = required.filter((a) => !rig.mesh.isVerticesDataPresent(a));
      expect(
        unprovided,
        'The compiled effect requires vertex attributes the live actor mesh does\n' +
          'not have. At draw time they read (0,0,0,1) — a zero into albedo is a\n' +
          'BLACK ACTOR (the propNME instTint trap).',
      ).toEqual([]);
      // The colour path is live, not the white fallback branch.
      expect(sub.effect.defines).toMatch(/#define VERTEXCOLOR_NME/);

      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});
