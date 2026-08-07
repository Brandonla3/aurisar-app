/**
 * ActorCast.test.js — the dev spike's actor roster, as RUNTIME FACTS.
 *
 * ActorRig.test.js already proves the mesh-level contracts (one mesh per
 * actor, live world matrices, ground seating, LOD swaps, shadow handoff) in
 * depth; this file does not re-derive them. What it covers is the thing only
 * ActorCast can be wrong about: does it actually assemble the roster spike.js
 * needs — a player plus two demo actors of distinct archetypes, all three
 * registered with the shadow rig — and does its own update() correctly
 * route the walker into the player while leaving the static demo actors
 * where they stand.
 *
 * The headline gate, as in ActorRig.test.js, is behavioural rather than a
 * flag check: move the walker and read the player's absolutePosition back,
 * because a wiring mistake that drops the seatOn/setYaw calls looks
 * perfectly correct to every structural assertion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { ARCHETYPES } from '../../model/actorMasses.js';
import { PROP_TIER, TIER_BANDS_M } from '../../model/propLod.js';

let ActorCast;
let ActorShadowRig;
let createTerrainField;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ ActorCast } = await import('./ActorCast.js'));
  ({ ActorShadowRig } = await import('../lighting/ActorShadowRig.js'));
  ({ createTerrainField } = await import('../../model/terrainField.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

function newWorld() {
  const scene = new BABYLON.Scene(engine);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  const material = new BABYLON.StandardMaterial('actorCastStandIn', scene);
  const field = createTerrainField();
  const shadowRig = new ActorShadowRig(scene, sun);
  return { scene, sun, material, field, shadowRig };
}

/** One flattened 4x4 identity, repeated per bone slot by getTransformMatrices(). */
const IDENTITY_16 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Is this skeleton's LIVE palette bit-exact identity? Runtime fact, not a
 * flag check — a rig that was never posed, or one whose pose was silently
 * dropped, reads identically to this either way, which is exactly the
 * distinction ActorSkeleton.test.js's own `identityMismatches` exists to
 * make (that helper is local to that file; this is the same check, inlined).
 */
function paletteIsIdentity(skeleton) {
  const palette = skeleton.getTransformMatrices(null);
  for (let i = 0; i < palette.length; i++) {
    if (!Object.is(palette[i], IDENTITY_16[i % 16])) return false;
  }
  return true;
}

describe('ActorCast — construction', () => {
  it('builds the player plus two static demo actors', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      expect(cast.player).toBeTruthy();
      expect(cast.player.mesh).toBeTruthy();
      expect(cast.demoActors).toHaveLength(2);
      for (const rig of cast.demoActors) expect(rig.mesh).toBeTruthy();
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the player and both demo actors are of three DISTINCT archetypes', () => {
    // The live demonstration the deleted sentinelAt comment asked for needs
    // real variety, not the same archetype cloned three times.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const ids = [cast.player.archetypeId, ...cast.demoActors.map((a) => a.archetypeId)];
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(ARCHETYPES.some((a) => a.id === id)).toBe(true);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('registers all three actors as shadow casters, and no more', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      expect(shadowRig._casters.has(cast.player.mesh)).toBe(true);
      for (const rig of cast.demoActors) expect(shadowRig._casters.has(rig.mesh)).toBe(true);
      expect(shadowRig._casters.size).toBe(3);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('works with no shadow rig at all', () => {
    const { scene, material, field } = newWorld();
    try {
      expect(() => new ActorCast(scene, { material, field })).not.toThrow();
    } finally {
      scene.dispose();
    }
  });

  it('poses the legion demo actor at construction; the player and the orghon demo stay at rest', () => {
    // TASK 7's whole contribution, as a runtime fact rather than a flag: a
    // wiring mistake that drops the rig.setPose(CANARY_POSE.legion) call at
    // construction looks perfectly correct to every other assertion in this
    // file — the mesh still exists, the archetype is still 'legion', the
    // shadow registration still happens — and only the LIVE PALETTE reveals
    // whether the bones actually bent.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const [legion, orghon] = cast.demoActors;
      // Sanity on WHICH archetype is which, so a future reordering of
      // DEMO_ARCHETYPES fails loudly here rather than silently posing the
      // wrong actor and passing anyway.
      expect(legion.archetypeId).toBe('legion');
      expect(orghon.archetypeId).toBe('orghon');

      expect(
        paletteIsIdentity(legion.skeleton),
        'the legion demo actor`s palette is bit-exact identity — is ActorCast still '
        + 'calling rig.setPose(CANARY_POSE.legion) at construction?',
      ).toBe(false);
      expect(paletteIsIdentity(cast.player.skeleton), 'the player must stay at rest').toBe(true);
      expect(paletteIsIdentity(orghon.skeleton), 'the orghon demo actor must stay at rest').toBe(true);

      // The console-verification surface Task 8 reaches for.
      expect(cast.posedDemo).toBe(legion);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorCast — per-frame update', () => {
  it('moves and turns the player rig to the walker`s state', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const focus = { x: 0, y: 0, z: 0 };

      cast.update({ x: 5, y: 1.2, z: -3, yaw: 0.4 }, focus);
      cast.player.root.computeWorldMatrix(true);
      const first = cast.player.root.absolutePosition.clone();
      expect(first.x).toBeCloseTo(5, 6);
      expect(first.y).toBeCloseTo(1.2, 6);
      expect(first.z).toBeCloseTo(-3, 6);
      expect(cast.player.root.rotation.y).toBeCloseTo(0.4, 6);

      cast.update({ x: 40, y: 2, z: 12, yaw: 1.1 }, focus);
      cast.player.root.computeWorldMatrix(true);
      const second = cast.player.root.absolutePosition;
      expect(
        second.equals(first),
        'the player did not move on the second update() — is seatOn still being called?',
      ).toBe(false);
      expect(second.x).toBeCloseTo(40, 6);
      expect(second.z).toBeCloseTo(12, 6);
      expect(cast.player.root.rotation.y).toBeCloseTo(1.1, 6);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('leaves the demo actors` own position untouched, but still re-tiers them against a moving focus', () => {
    // BOTH halves of this title are asserted, which they were not until the
    // P6 final review: the body used to check only `absolutePosition`, which
    // is unchanged whether or not update() is ever forwarded to the rigs. The
    // whole LOD-tiering half of ActorCast.update() was deletable with the
    // realm suite green — including this test, the one named for it. `tier`
    // and `swapCount` are the two observable consequences of the forwarding,
    // so they are what gets read.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const [demo] = cast.demoActors;
      demo.root.computeWorldMatrix(true);
      const before = demo.root.absolutePosition.clone();
      // ActorRig's constructor default; the cast passes no tier.
      expect(demo.tier, 'a fresh rig starts NEAR').toBe(PROP_TIER.NEAR);
      expect(demo.swapCount).toBe(0);

      // Focus far from every demo actor: this must not move demo's OWN seat,
      // and must step it down to MID.
      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: -5000, y: 0, z: 5000 });
      demo.root.computeWorldMatrix(true);
      expect(demo.root.absolutePosition.equals(before)).toBe(true);
      expect(
        demo.tier,
        'the demo actor never left NEAR against a focus 5 km away — is update() still forwarded to the rigs?',
      ).toBe(PROP_TIER.MID);
      expect(demo.swapCount, 'a tier change must rebuild the mesh exactly once').toBe(1);

      // ...and back, when the focus walks onto it. This is the round trip the
      // header sells as the phase's live demonstration.
      const seat = demo.root.absolutePosition;
      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: seat.x, y: seat.y, z: seat.z });
      demo.root.computeWorldMatrix(true);
      expect(demo.root.absolutePosition.equals(before), 'the round trip must not move its seat').toBe(true);
      expect(demo.tier, 'walking the focus onto the demo actor must step it back to NEAR').toBe(PROP_TIER.NEAR);
      expect(demo.swapCount).toBe(2);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('re-tiers the PLAYER against the focus too, not just the demo actors', () => {
    // The player's own update() call is a separate line from the demo loop and
    // was separately deletable with the suite green. It is close to inert in
    // the spike (camera.target eases toward the walker, so the distance is
    // ~0 and the player resolves NEAR essentially always) — which is exactly
    // why nothing would have noticed it going missing.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const walker = { x: 0, y: 0, z: 0, yaw: 0 };
      const far = TIER_BANDS_M.nearMaxM * 10;

      cast.update(walker, { x: 0, y: 0, z: 0 });
      expect(cast.player.tier).toBe(PROP_TIER.NEAR);
      expect(cast.player.swapCount).toBe(0);

      cast.update(walker, { x: far, y: 0, z: 0 });
      expect(
        cast.player.tier,
        `the player stayed NEAR with the focus ${far} m away — is this.player.update(focusPos) still called?`,
      ).toBe(PROP_TIER.MID);
      expect(cast.player.swapCount).toBe(1);

      cast.update(walker, { x: 0, y: 0, z: 0 });
      expect(cast.player.tier).toBe(PROP_TIER.NEAR);
      expect(cast.player.swapCount).toBe(2);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a disposed cast`s update() is a no-op, not a throw', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.dispose();
      expect(() => cast.update({ x: 1, y: 1, z: 1, yaw: 1 }, { x: 0, y: 0, z: 0 })).not.toThrow();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorCast — dispose', () => {
  it('releases every rig`s mesh, and clears the shadow registration', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const meshes = [cast.player.mesh, ...cast.demoActors.map((a) => a.mesh)];
      expect(meshes).toHaveLength(3);

      cast.dispose();

      for (const mesh of meshes) expect(mesh.isDisposed()).toBe(true);
      expect(shadowRig._casters.size).toBe(0);
      expect(cast.demoActors).toHaveLength(0);
      expect(() => cast.dispose()).not.toThrow(); // idempotent
    } finally {
      scene.dispose();
    }
  });

  it('releases every rig`s skeleton too — scene.skeletons returns to baseline, posed or not', () => {
    // A Skeleton is scene-registered and is NOT a Node (ActorRig.js's header,
    // ActorRigSkin.test.js's own version of this test) — disposing the mesh
    // and the root leaves it behind. The posed legion demo actor is not a
    // special case for this: setPose() only ever writes bone matrices on an
    // existing Skeleton object, never adds a second one to the scene.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const baseline = scene.skeletons.length;
      const cast = new ActorCast(scene, { material, field, shadowRig });
      // player + 2 demo actors, one skeleton each — ActorRig.js's "ONE
      // skeleton per actor" commitment, read as a scene-level count.
      expect(scene.skeletons.length).toBe(baseline + 3);

      cast.dispose();

      expect(
        scene.skeletons.length,
        'a posed skeleton outlived its actor — dispose() must release it exactly like an unposed one',
      ).toBe(baseline);
    } finally {
      scene.dispose();
    }
  });
});
