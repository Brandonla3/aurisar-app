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

    it(`${label}: the graph reads per-instance world matrices — world0..3 declared, InstancesBlock wired`, async () => {
      // THE render-critical finding from PR review: without an
      // InstancesBlock, the graph wires the World system value straight
      // into its transforms, never reads world0..3, and every thin
      // instance draws at the carrier's identity matrix — a prop pile at
      // world origin that every source-text assertion in this file happily
      // ignored. This pins both the block AND the generated declarations.
      const scene = newScene();
      try {
        const { material } = await buildPropMaterial(scene, { name: `pi${label}`, shaderLanguage: lang });
        const classes = material.attachedBlocks.map((b) => b.getClassName());
        expect(classes).toContain('InstancesBlock');
        const vs = vertexSource(material);
        for (const a of ['world0', 'world1', 'world2', 'world3']) expect(vs).toContain(a);
        // And BOTH transforms must read the instances output, not raw world:
        const instancesBlock = material.attachedBlocks.find((b) => b.getClassName() === 'InstancesBlock');
        const consumers = instancesBlock.output.endpoints.map((e) => e.ownerBlock.name);
        expect(consumers).toContain('worldPos');
        expect(consumers).toContain('worldNormal');
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

  it('emits the DOUBLE fail-open sprout contract — attribute AND clock guarded', async () => {
    // birth <= 0 OR now <= 0 must mean FULLY GROWN in the compiled code.
    // The first version guarded only the attribute; PR review showed a
    // never-advanced clock (uNowMs defaults to 0) made freshly streamed
    // chunks compute scale 0 — permanently invisible props, the exact
    // failure mode the contract exists to exclude.
    const scene = newScene();
    try {
      const { material } = await buildPropMaterial(scene);
      const sprout = material.attachedBlocks.find((b) => b.getClassName() === 'RealmFnBlock');
      expect(sprout._lastEmittedSource).toMatch(/step\s*\(\s*0\.0001\s*,\s*birth\s*\)/);
      expect(sprout._lastEmittedSource).toMatch(/step\s*\(\s*0\.0001\s*,\s*now\s*\)/);
      expect(sprout._lastEmittedSource).toContain('mix(1.0, eased, animating)');
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
