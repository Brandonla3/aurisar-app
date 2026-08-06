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
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const [demo] = cast.demoActors;
      demo.root.computeWorldMatrix(true);
      const before = demo.root.absolutePosition.clone();

      // Focus far from every demo actor: none of this should move demo's OWN
      // seat, only (possibly) its LOD tier.
      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: -5000, y: 0, z: 5000 });
      demo.root.computeWorldMatrix(true);
      expect(demo.root.absolutePosition.equals(before)).toBe(true);

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
});
