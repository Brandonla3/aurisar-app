/**
 * skyDomeNME.test.js — the dome compiles on both backends, and its gradient
 * is the SAME definition the CPU fog evaluator uses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';

let buildSkyDomeMaterial, createSkyDome, emitGradientBsl, RENDERING_GROUP;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ buildSkyDomeMaterial, createSkyDome, RENDERING_GROUP } = await import('./skyDomeNME.js'));
  ({ emitGradientBsl } = await import('../../model/skyModel.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

describe('buildSkyDomeMaterial', () => {
  it('builds under GLSL', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildSkyDomeMaterial(scene, { shaderLanguage: BABYLON.ShaderLanguage.GLSL });
      expect(material.getClassName()).toBe('NodeMaterial');
    } finally {
      scene.dispose();
    }
  });

  it('builds under WGSL — the WebGPU-only failure class stays CI-caught', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildSkyDomeMaterial(scene, { shaderLanguage: BABYLON.ShaderLanguage.WGSL });
      expect(material.getClassName()).toBe('NodeMaterial');
    } finally {
      scene.dispose();
    }
  });

  it('embeds the exact emitGradientBsl body — one curve, two evaluators', async () => {
    // The seam guarantee is only as strong as this: the dome's emitted source
    // must contain the same stamped constants the JS evaluator interprets.
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildSkyDomeMaterial(scene, { shaderLanguage: BABYLON.ShaderLanguage.GLSL });
      const paint = material.attachedBlocks.find((b) => b.getClassName() === 'RealmFnBlock');
      for (const line of emitGradientBsl().trim().split('\n')) {
        expect(paint._lastEmittedSource).toContain(line.trim());
      }
    } finally {
      scene.dispose();
    }
  });

  it('applyState copies a skyState onto the uniforms', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material, applyState } = await buildSkyDomeMaterial(scene);
      applyState({
        sunDir: [0.5, 0.5, 0.7071],
        stops: {
          horizon: [1, 0, 0], mid: [0, 1, 0], zenith: [0, 0, 1], glow: [0.5, 0.4, 0.3],
        },
        starVisibility: 0.75,
      });
      const byName = (n) => material.attachedBlocks.find((b) => b.name === n);
      expect(byName('sunDir').value.y).toBe(0.5);
      expect(byName('horizonC').value.r).toBe(1);
      expect(byName('zenithC').value.b).toBe(1);
      expect(byName('starVis').value).toBe(0.75);
    } finally {
      scene.dispose();
    }
  });
});

describe('createSkyDome', () => {
  it('is camera-locked, unpickable, fogless, and never writes depth', async () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildSkyDomeMaterial(scene);
      const dome = createSkyDome(scene, material);
      expect(dome.infiniteDistance).toBe(true);
      expect(dome.isPickable).toBe(false);
      expect(dome.applyFog).toBe(false);
      // Depth-write off is what guarantees the sky can never occlude the world.
      expect(material.disableDepthWrite).toBe(true);
    } finally {
      scene.dispose();
    }
  });

  it('claims the SKY rendering group explicitly, not implicitly via default 0', async () => {
    // Real bug this guards: a depth-write-disabled mesh drawn AFTER a
    // farther, depth-writing mesh (any horizonRings.js ring, all >= 576m,
    // vs the dome's fixed 500m radius) can win the depth test on its nearer
    // z and incorrectly paint over it. Explicit group order — not the
    // default opaque distance-sort — is what rules this out.
    const scene = new BABYLON.Scene(engine);
    try {
      const { material } = await buildSkyDomeMaterial(scene);
      const dome = createSkyDome(scene, material);
      expect(dome.renderingGroupId).toBe(RENDERING_GROUP.SKY);
      expect(RENDERING_GROUP.SKY).toBeLessThan(RENDERING_GROUP.RINGS);
    } finally {
      scene.dispose();
    }
  });
});
