/**
 * horizonRingNME.test.js — the fog-decoupling proof, dual-backend.
 *
 * Three claims to lock down: (1) the ring material never wires in fog, so it
 * cannot be affected by scene.fogDensity at all; (2) it shares the dome's
 * exact gradient body, so the ring/sky horizon cannot visibly disagree;
 * (3) the depth-sort contract — rings always draw after the dome — holds via
 * rendering group, not an unverified sort assumption.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';

let buildRingMaterial, createRingMesh, buildHorizonRings, RENDERING_GROUP, emitGradientBsl, RING_TIERS;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ buildRingMaterial, createRingMesh, buildHorizonRings } = await import('./horizonRingNME.js'));
  ({ RENDERING_GROUP } = await import('./skyDomeNME.js'));
  ({ emitGradientBsl } = await import('../../model/skyModel.js'));
  ({ RING_TIERS } = await import('../../model/horizonRings.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

describe('buildRingMaterial — dual backend', () => {
  it('builds under GLSL', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.3, shaderLanguage: BABYLON.ShaderLanguage.GLSL });
      expect(material.getClassName()).toBe('NodeMaterial');
    } finally {
      scene.dispose();
    }
  });

  it('builds under WGSL', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.3, shaderLanguage: BABYLON.ShaderLanguage.WGSL });
      expect(material.getClassName()).toBe('NodeMaterial');
    } finally {
      scene.dispose();
    }
  });

  it('never wires a FogBlock — structurally immune to scene.fogDensity', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.3 });
      const classes = material.attachedBlocks.map((b) => b.getClassName());
      expect(classes).not.toContain('FogBlock');
    } finally {
      scene.dispose();
    }
  });

  it('embeds the SAME emitGradientBsl body the dome uses — the horizon cannot disagree', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.3, shaderLanguage: BABYLON.ShaderLanguage.GLSL });
      const paint = material.attachedBlocks.find((b) => b.getClassName() === 'RealmFnBlock');
      for (const line of emitGradientBsl().trim().split('\n')) {
        expect(paint._lastEmittedSource).toContain(line.trim());
      }
    } finally {
      scene.dispose();
    }
  });

  it('stamps the authored darken constant into the source, per tier', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.42 });
      const paint = material.attachedBlocks.find((b) => b.getClassName() === 'RealmFnBlock');
      expect(paint._lastEmittedSource).toContain('0.4200');
    } finally {
      scene.dispose();
    }
  });

  it('applyState copies a skyState onto the ring uniforms, no starVisibility needed', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material, applyState } = await buildRingMaterial(scene, { name: 'r', darken: 0.3 });
      applyState({
        sunDir: [0, 1, 0],
        stops: { horizon: [1, 0, 0], mid: [0, 1, 0], zenith: [0, 0, 1], glow: [0.2, 0.2, 0.2] },
      });
      const byName = (n) => material.attachedBlocks.find((b) => b.name === n);
      expect(byName('horizonC').value.r).toBe(1);
      expect(byName('zenithC').value.b).toBe(1);
    } finally {
      scene.dispose();
    }
  });
});

describe('createRingMesh — real depth-writing geometry, opposite of the dome', () => {
  it('is opaque (depth write ON), unpickable, fogless, and claims the RINGS group', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.3 });
      const mesh = createRingMesh(scene, RING_TIERS[0], material);
      expect(material.disableDepthWrite).toBeFalsy(); // NOT disabled — the point
      expect(mesh.isPickable).toBe(false);
      expect(mesh.applyFog).toBe(false);
      expect(mesh.renderingGroupId).toBe(RENDERING_GROUP.RINGS);
      expect(mesh.renderingGroupId).toBeGreaterThan(RENDERING_GROUP.SKY);
    } finally {
      scene.dispose();
    }
  });

  it('is not infiniteDistance — it sits at its authored radius, unlike the dome', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildRingMaterial(scene, { name: 'r', darken: 0.3 });
      const mesh = createRingMesh(scene, RING_TIERS[0], material);
      expect(mesh.infiniteDistance).toBe(false);
    } finally {
      scene.dispose();
    }
  });
});

describe('buildHorizonRings — the whole kit as one reader', () => {
  it('builds all three authored tiers', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = await buildHorizonRings(scene, RING_TIERS);
      expect(kit.meshes).toHaveLength(3);
      expect(kit.meshes.every((m) => m.renderingGroupId === RENDERING_GROUP.RINGS)).toBe(true);
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('one applyState call updates every tier', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = await buildHorizonRings(scene, RING_TIERS);
      kit.applyState({
        sunDir: [0, 1, 0],
        stops: { horizon: [0.5, 0.5, 0.5], mid: [0.4, 0.4, 0.4], zenith: [0.3, 0.3, 0.3], glow: [0.1, 0.1, 0.1] },
      });
      for (const mesh of kit.meshes) {
        const horizonC = mesh.material.attachedBlocks.find((b) => b.name === 'horizonC');
        expect(horizonC.value.r).toBe(0.5);
      }
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });
});
