/**
 * propNME.test.js — the opaque-only discipline and the custom-attribute
 * contract, dual-backend, headless. NullEngine proves generated SOURCE,
 * never runtime buffer binding — the one live check this file cannot make
 * (a WGSL attribute bound with the wrong stride) is covered by the
 * fail-open contract asserted here plus the spike page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';

let buildPropMaterial;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ buildPropMaterial } = await import('./propNME.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

const newScene = () => {
  const scene = new BABYLON.Scene(engine);
  new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 0), scene);
  return scene;
};

const vertexSource = (m) => m._vertexCompilationState.compilationString;
const fragmentSource = (m) => m._fragmentCompilationState.compilationString;

describe('buildPropMaterial — dual backend', () => {
  for (const [label, lang] of [['GLSL', BABYLON.ShaderLanguage.GLSL], ['WGSL', BABYLON.ShaderLanguage.WGSL]]) {
    it(`builds under ${label} and declares BOTH custom instanced attributes`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildPropMaterial(scene, { name: `p${label}`, shaderLanguage: lang });
        const vs = vertexSource(material);
        // The contract that failed silently in the probe until types were
        // explicit: an AutoDetect custom attribute refuses to connect.
        expect(vs).toContain('sproutBirth');
        expect(vs).toContain('instTint');
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: the compiled fragment contains no discard — opaque-only holds`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildPropMaterial(scene, { name: `pd${label}`, shaderLanguage: lang });
        expect(fragmentSource(material)).not.toMatch(/\bdiscard\b/);
      } finally {
        scene.dispose();
      }
    });
  }

  it('never requires alpha blending', async () => {
    const scene = newScene();
    try {
      const { material } = await buildPropMaterial(scene);
      expect(material.needAlphaBlending()).toBe(false);
      expect(material.needAlphaTesting()).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('emits the fail-open sprout contract into the shader source', async () => {
    // birth <= 0 must mean FULLY GROWN in the actual compiled code — a
    // misbound attribute reads 0.0, and the worst silent failure has to be
    // "props skip their animation", never "props are invisible".
    const scene = newScene();
    try {
      const { material } = await buildPropMaterial(scene);
      const sprout = material.attachedBlocks.find((b) => b.getClassName() === 'RealmFnBlock');
      expect(sprout._lastEmittedSource).toMatch(/birth\s*<=\s*0\.0/);
    } finally {
      scene.dispose();
    }
  });

  it('never wires LightBlock.shadow — the P4c double-multiply cannot return', async () => {
    const scene = newScene();
    try {
      const { material } = await buildPropMaterial(scene);
      const lights = material.attachedBlocks.find((b) => b.getClassName() === 'LightBlock');
      expect(lights.shadow.isConnected).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('participates in scene fog and lighting like terrain does', async () => {
    const scene = newScene();
    try {
      const { material } = await buildPropMaterial(scene);
      const classes = material.attachedBlocks.map((b) => b.getClassName());
      expect(classes).toContain('FogBlock');
      expect(classes).toContain('LightBlock');
    } finally {
      scene.dispose();
    }
  });

  it('applySproutClock advances the shared uniform', async () => {
    const scene = newScene();
    try {
      const { material, applySproutClock } = await buildPropMaterial(scene);
      const clock = material.attachedBlocks.find((b) => b.name === 'uNowMs');
      expect(clock.value).toBe(0);
      applySproutClock(12345);
      expect(clock.value).toBe(12345);
    } finally {
      scene.dispose();
    }
  });
});
