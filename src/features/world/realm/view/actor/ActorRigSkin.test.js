/**
 * ActorRigSkin.test.js — the SKELETON half of a live actor: what happens to
 * bone state across the LOD lifecycle.
 *
 * Split from ActorRig.test.js, which owns the mesh half (seating, frozen world
 * matrices, tier policy, shadow registration, disposal of the mesh). The seam
 * is real rather than a line-count dodge: nothing here asks where the geometry
 * IS, and everything here needs `buildActorRig`/`CANARY_POSE`, which that file
 * never imports. If both go red at once, read that one first — a rig that
 * cannot build a mesh cannot attach a skeleton to it.
 *
 * ── THE TRAP THIS FILE EXISTS FOR ──────────────────────────────────────────
 *
 * `Mesh.clone()` copies the `skeleton` REFERENCE. Put a skeleton on
 * ActorPrototypes' shared master — the obvious place, since that is where the
 * skinning BUFFERS live — and every actor of the archetype poses in lockstep:
 * one guard raises an arm and the whole faction raises one. It would look
 * plausible in a screenshot and be invisible to every structural assertion, so
 * the independence check here is behavioural: pose A, and read B's palette.
 *
 * ── AND THE ONE THAT ONLY APPEARS AT 96 METRES ─────────────────────────────
 *
 * `_applyTier` clones a FRESH mesh and disposes the old one on every tier
 * swap. The clone arrives with `skeleton === null` (its master has none to
 * copy), so a rig that attached its skeleton only in the constructor would
 * work perfectly until the actor walked past the band edge and then straighten
 * up mid-stride, permanently, with nothing thrown and nothing logged.
 *
 * DECISION PINNED HERE: THE POSE IS RETAINED across a swap, byte for byte. It
 * falls out of the design (bone state lives on the Skeleton; only the mesh is
 * rebuilt) but "falls out of the design" is how a phase ends up with an
 * untested claim, so the palette is captured either side and compared.
 *
 * EXPECTED LOG NOISE: none beyond Babylon's `- Null engine` banner. The
 * `bones stored as vertex uniforms` warning lives on the MATERIAL define-prep
 * path and arrives with Task 6's BonesBlock (measured in Task 4); nothing is
 * asserted about it here in either direction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { ARCHETYPES } from '../../model/actorMasses.js';
import { buildActorRig } from '../../model/actorRig.js';
import { CANARY_POSE } from '../../model/actorCanary.js';
import { PROP_TIER } from '../../model/propLod.js';

let ActorPrototypes;
let ActorRig;
let ActorShadowRig;
let engine;

beforeAll(async () => {
  // Load-bearing order: view/ modules read the ambient BABYLON global at
  // import time, so the global must exist BEFORE the dynamic import.
  globalThis.BABYLON = BABYLON;
  ({ ActorPrototypes } = await import('./ActorPrototypes.js'));
  ({ ActorRig } = await import('./ActorRig.js'));
  ({ ActorShadowRig } = await import('../lighting/ActorShadowRig.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

function newWorld() {
  const scene = new BABYLON.Scene(engine);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  const material = new BABYLON.StandardMaterial('actorStandIn', scene);
  const protos = new ActorPrototypes(scene, material);
  return { scene, sun, protos };
}

/**
 * The archetype every single-archetype assertion uses, for the reason
 * ActorSkeleton.test.js ledgered: magistari has TWO bones, so a bug that welds
 * everything to bone 0 is nearly invisible on it. Unbound has eight and the
 * roster's deepest chain.
 */
const DEEP = 'unbound';

const IDENTITY_16 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Palette entries that are not EXACTLY the identity — `Object.is`-strict. */
function identityMismatches(palette) {
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    if (!Object.is(palette[i], IDENTITY_16[i % 16])) out.push([i, palette[i]]);
  }
  return out;
}

/** A detached copy — `getTransformMatrices` hands back the LIVE buffer. */
const paletteOf = (skeleton) => Float32Array.from(skeleton.getTransformMatrices(null));

describe('ActorRig — the skeleton it owns', () => {
  it('builds ONE skeleton per rig, attached to the live mesh at one influence', () => {
    const { scene, protos } = newWorld();
    try {
      const baseline = scene.skeletons.length;
      let checked = 0;
      for (const arch of ARCHETYPES) {
        const rig = new ActorRig(scene, protos, arch.id, { name: `s_${arch.id}` });
        expect(rig.skeleton.getClassName()).toBe('Skeleton');
        expect(
          rig.mesh.skeleton,
          'the mesh must point at THIS rig`s skeleton — that is the object the GPU reads',
        ).toBe(rig.skeleton);
        expect(rig.mesh.numBoneInfluencers).toBe(1);
        expect(rig.skeleton.bones.length).toBe(buildActorRig(arch.id).bones.length);
        // The buffers came with the shared geometry, so the live mesh has them
        // without ActorRig writing a byte.
        expect(rig.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.MatricesIndicesKind)).toBe(true);
        expect(rig.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.MatricesWeightsKind)).toBe(true);
        checked++;
      }
      expect(checked).toBe(ARCHETYPES.length);
      // Exactly one skeleton per actor — not one per mesh, not one per stage.
      expect(scene.skeletons.length).toBe(baseline + ARCHETYPES.length);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('two actors of ONE archetype pose INDEPENDENTLY — the clone-shares-it trap', () => {
    const { scene, protos } = newWorld();
    try {
      const a = new ActorRig(scene, protos, DEEP, { name: 'a' });
      const b = new ActorRig(scene, protos, DEEP, { name: 'b' });

      // BEHAVIOUR FIRST, deliberately. `a.skeleton !== b.skeleton` is the
      // cheaper question and it goes red under the same fault — but it reports
      // "expected Skeleton not to be Skeleton", which names neither the actors
      // nor the consequence. Posing one and reading the OTHER'S palette is the
      // claim; the identity checks below are corroboration, in ActorRig.test.js's
      // frozen-matrix idiom.
      a.setPose(CANARY_POSE[DEEP]);

      expect(
        identityMismatches(a.mesh.skeleton.getTransformMatrices(null)).length,
        'A was posed and its own palette did not move — setPose is not reaching the mesh',
      ).toBeGreaterThan(0);
      expect(
        identityMismatches(b.mesh.skeleton.getTransformMatrices(null)),
        'B was NEVER posed. If it moved, the two actors share bone state — which is what\n' +
          'happens the moment a skeleton is attached to ActorPrototypes` shared master\n' +
          'instead of to each rig.',
      ).toEqual([]);

      // ...and A comes back on its own, without touching B.
      a.rest();
      expect(identityMismatches(a.skeleton.getTransformMatrices(null))).toEqual([]);

      expect(a.skeleton).not.toBe(b.skeleton);
      expect(a.mesh.skeleton).not.toBe(b.mesh.skeleton);
      expect(a.skeleton.bones[1]).not.toBe(b.skeleton.bones[1]);
      a.dispose();
      b.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('Mesh.clone() copies numBoneInfluencers but NOT a skeleton — both engine facts', () => {
    // The two Babylon behaviours the wiring rests on, asserted as live facts
    // rather than recited. The first makes `_applyTier`'s influence line
    // defence-in-depth today; the second makes its skeleton line the one that
    // actually keeps a swapped actor deforming.
    const { scene, protos } = newWorld();
    try {
      const master = protos.masterFor(DEEP, PROP_TIER.NEAR);
      const clone = master.clone('probe');
      expect(master.numBoneInfluencers).toBe(1);
      expect(clone.numBoneInfluencers).toBe(1);
      expect(
        clone.skeleton,
        'If clones ever start arriving WITH a skeleton, re-read ActorPrototypes` header:\n' +
          'the reference is shared, so it would have to be the same one for every actor.',
      ).toBeNull();
      clone.dispose(false, false);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — the skeleton survives a tier swap', () => {
  it('same skeleton object, same influence count, and the POSE carried across', () => {
    const { scene, sun, protos } = newWorld();
    try {
      const shadowRig = new ActorShadowRig(scene, sun);
      const rig = new ActorRig(scene, protos, DEEP, { shadowRig });
      rig.seatOn(0, 0, 0);
      shadowRig.update({ x: 0, y: 0, z: 0 });
      rig.setPose(CANARY_POSE[DEEP]);

      const skeleton = rig.skeleton;
      const nearMesh = rig.mesh;
      const posed = paletteOf(skeleton);
      // Anti-vacuity: an unposed actor would satisfy every comparison below by
      // agreeing with itself about nothing.
      expect(identityMismatches(posed).length).toBeGreaterThan(0);

      rig.seatOn(0, 0, 500);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.MID);
      expect(rig.swapCount, 'no swap happened — this test proves nothing').toBe(1);
      expect(rig.mesh).not.toBe(nearMesh);
      expect(nearMesh.isDisposed()).toBe(true);

      expect(
        rig.mesh.skeleton,
        'The swap clone arrives with skeleton === null (its master has none to copy), so\n' +
          'without the re-attachment in _applyTier this actor renders its bind pose for\n' +
          'the rest of its life — walking the world without bending a joint.',
      ).toBe(skeleton);
      expect(rig.skeleton).toBe(skeleton);
      expect(rig.mesh.numBoneInfluencers).toBe(1);
      expect(scene.skeletons.length, 'a swap must not mint a second skeleton').toBe(1);

      expect(
        paletteOf(skeleton),
        'THE DECISION: the pose is RETAINED across a tier swap, byte for byte. Bone state\n' +
          'lives on the Skeleton and only the MESH is rebuilt, so an actor mid-stride keeps\n' +
          'its stride instead of showing a one-frame T-pose at the band edge.',
      ).toEqual(posed);

      // The far master's geometry carries the buffers too, so the new mesh is
      // skinnable and not merely holding a skeleton.
      expect(rig.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.MatricesIndicesKind)).toBe(true);
      // ...and the existing shadow contract still holds: one caster, the live mesh.
      expect(shadowRig._casters.size).toBe(1);
      expect(shadowRig._casters.has(rig.mesh)).toBe(true);

      // Posing AFTER the swap reaches the new mesh too — the skeleton is not
      // merely a surviving object, it is still the live one.
      rig.rest();
      expect(identityMismatches(rig.mesh.skeleton.getTransformMatrices(null))).toEqual([]);

      rig.dispose();
      shadowRig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('and back again: a swap in the other direction keeps it too', () => {
    const { scene, protos } = newWorld();
    try {
      const rig = new ActorRig(scene, protos, 'orghon', { tier: PROP_TIER.MID });
      rig.setPose(CANARY_POSE.orghon);
      const skeleton = rig.skeleton;
      const posed = paletteOf(skeleton);

      rig.seatOn(0, 0, 0);
      expect(rig.update({ x: 0, y: 0, z: 0 })).toBe(PROP_TIER.NEAR);
      expect(rig.swapCount).toBe(1);
      expect(rig.mesh.skeleton).toBe(skeleton);
      expect(rig.mesh.numBoneInfluencers).toBe(1);
      expect(paletteOf(skeleton)).toEqual(posed);
      rig.dispose();
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorRig — dispose releases the skeleton', () => {
  it('scene.skeletons returns to baseline, and posing afterwards is a no-op', () => {
    // A Skeleton is scene-registered and is NOT a Node, so disposing the mesh
    // and the root leaves it behind — one orphan per actor ever spawned, each
    // holding its bones and its palette, and none of them visible to
    // `scene.meshes.length` (the assertion ActorRig.test.js already makes).
    const { scene, protos } = newWorld();
    try {
      const baseline = scene.skeletons.length;
      expect(baseline).toBe(0);

      const rig = new ActorRig(scene, protos, DEEP);
      const skeleton = rig.skeleton;
      expect(scene.skeletons.length).toBe(baseline + 1);
      expect(scene.skeletons).toContain(skeleton);

      rig.dispose();

      expect(
        scene.skeletons.length,
        'The skeleton outlived its actor. Nothing else in the Realm disposes it, so this\n' +
          'leaks one bone tree per spawn for the lifetime of the scene.',
      ).toBe(baseline);
      expect(scene.skeletons).not.toContain(skeleton);
      expect(rig.skeleton).toBeNull();

      // The post-dispose contract update() already holds, extended to the pose
      // surface: a sim that poses an actor it has just retired must not throw.
      expect(() => rig.setPose(CANARY_POSE[DEEP])).not.toThrow();
      expect(() => rig.rest()).not.toThrow();
      expect(() => rig.dispose()).not.toThrow(); // still idempotent
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a rig that never built — unknown archetype — leaves no skeleton behind', () => {
    // The constructor resolves the rig BEFORE it puts anything in the scene,
    // so the throw costs nothing. A Skeleton created first would survive the
    // failed construction with no owner left holding a reference to dispose it.
    const { scene, protos } = newWorld();
    try {
      expect(() => new ActorRig(scene, protos, 'gelatinous-cube')).toThrow(/unknown archetype/);
      expect(scene.skeletons.length).toBe(0);
      expect(scene.transformNodes.filter((n) => n.name.startsWith('actor_')).length).toBe(0);
      protos.dispose();
    } finally {
      scene.dispose();
    }
  });
});
