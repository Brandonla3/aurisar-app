/**
 * ActorShadowRig.test.js — the bucketing/hysteresis contract, headless
 * (NullEngine). Only one real dynamic caster exists anywhere in the Realm
 * today (the spike's player capsule), so the 'far' path is proven here with
 * synthetic multi-distance meshes rather than by eye — the live spike
 * exercises 'near' for real and 'far' via clearly-marked placeholder
 * "sentinel" meshes, but the actual bucketing LOGIC is pinned here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { DEFAULT_NEAR_RADIUS_M } from '../../model/shadowCadence.js';

let ActorShadowRig;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ ActorShadowRig } = await import('./ActorShadowRig.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

const newScene = () => {
  const scene = new BABYLON.Scene(engine);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  return { scene, sun };
};

const boxAt = (scene, name, x, y, z) => {
  const m = BABYLON.MeshBuilder.CreateBox(name, {}, scene);
  m.position.set(x, y, z);
  return m;
};

describe('ActorShadowRig — construction', () => {
  it('creates exactly one ShadowGenerator, on the REAL sun light — no second light', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      expect(rig._generator.getClassName()).toBe('ShadowGenerator');
      expect(rig._generator.getLight()).toBe(sun);
      // No second light: the reverted two-light design is gone for good, not
      // just unused — this is what the finding-2 fix actually removed.
      expect(scene.lights).toHaveLength(1);
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorShadowRig — bucketing', () => {
  it('a caster inside the near radius is added to the shadow map', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'near1', 3, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });

      expect(rig.bucketOf(mesh)).toBe('near');
      expect(rig._generator.getShadowMap().renderList).toContain(mesh);
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a caster well beyond the near radius casts NO shadow at all — not a stale one', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'far1', 500, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });

      expect(rig.bucketOf(mesh)).toBe('far');
      expect(rig._generator.getShadowMap().renderList).not.toContain(mesh);
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('moving a caster from near to far removes it from the shadow map, and back adds it again', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'mover', 3, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(rig._generator.getShadowMap().renderList).toContain(mesh);

      mesh.position.set(500, 0, 0);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(rig.bucketOf(mesh)).toBe('far');
      expect(rig._generator.getShadowMap().renderList).not.toContain(mesh);

      mesh.position.set(3, 0, 0);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(rig.bucketOf(mesh)).toBe('near');
      expect(rig._generator.getShadowMap().renderList).toContain(mesh);
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('never thrashes a caster orbiting exactly at the near-radius boundary', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'boundary', DEFAULT_NEAR_RADIUS_M, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });
      const firstBucket = rig.bucketOf(mesh);

      for (let i = 0; i < 30; i++) {
        mesh.position.x = DEFAULT_NEAR_RADIUS_M + (i % 2 === 0 ? 0.01 : -0.01);
        rig.update({ x: 0, y: 0, z: 0 });
        expect(rig.bucketOf(mesh)).toBe(firstBucket);
      }
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a pinned caster stays near (a real, always-fresh shadow) regardless of distance', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'pinned', 900, 0, 0); // far outside the near radius
      rig.addCaster(mesh, { pin: true });
      rig.update({ x: 0, y: 0, z: 0 });

      expect(rig.bucketOf(mesh)).toBe('near');
      expect(rig._generator.getShadowMap().renderList).toContain(mesh);
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('measures WORLD position for a parented caster, not its local offset', () => {
    // Real bug this pins, caught live in the browser (not by any NullEngine
    // test until this one): the spike's player capsule is parented to a
    // TransformNode that moves every frame, with the capsule's OWN .position
    // staying at a constant local offset like (0, 0.9, 0). Reading
    // mesh.position directly measured distance from world ORIGIN, not from
    // the actual moving actor — a player who had walked 290m from spawn
    // still read as sitting 1.5m from the camera's own focus point.
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const root = new BABYLON.TransformNode('root', scene);
      root.position.set(500, 0, 0); // far from origin
      const mesh = BABYLON.MeshBuilder.CreateBox('parented', {}, scene);
      mesh.parent = root;
      mesh.position.set(0, 0.9, 0); // constant LOCAL offset — never changes

      rig.addCaster(mesh);
      rig.update({ x: 500, y: 0, z: 0 }); // focus point right next to the root

      expect(rig.bucketOf(mesh)).toBe('near'); // world-space distance ~0.9m
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('measures distance from the focus point, not world origin', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'relative', 1003, 0, 0); // far from origin...
      rig.addCaster(mesh);
      rig.update({ x: 1000, y: 0, z: 0 }); // ...but close to THIS focus point
      expect(rig.bucketOf(mesh)).toBe('near');
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorShadowRig — removeCaster', () => {
  it('removes a near-bucketed caster from the shadow map', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'removable', 3, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(rig._generator.getShadowMap().renderList).toContain(mesh);

      rig.removeCaster(mesh);
      expect(rig._generator.getShadowMap().renderList).not.toContain(mesh);
      expect(rig.bucketOf(mesh)).toBeNull();
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('does not throw removing a far-bucketed caster (never registered on the generator)', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'farRemovable', 500, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(rig.bucketOf(mesh)).toBe('far');

      expect(() => rig.removeCaster(mesh)).not.toThrow();
      expect(rig.bucketOf(mesh)).toBeNull();
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('is a no-op, not a throw, for a mesh that was never added', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'stranger', 0, 0, 0);
      expect(() => rig.removeCaster(mesh)).not.toThrow();
      rig.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorShadowRig — dispose', () => {
  it('disposes the generator without throwing', () => {
    const { scene, sun } = newScene();
    try {
      const rig = new ActorShadowRig(scene, sun);
      const mesh = boxAt(scene, 'x', 3, 0, 0);
      rig.addCaster(mesh);
      rig.update({ x: 0, y: 0, z: 0 });
      expect(() => rig.dispose()).not.toThrow();
    } finally {
      scene.dispose();
    }
  });
});
