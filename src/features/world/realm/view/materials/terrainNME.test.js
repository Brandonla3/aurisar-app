/**
 * terrainNME.test.js — the P3 acceptance item, carried from the #295 review:
 * the CustomBlock ban must be proven end-to-end, not just documented. A
 * material containing RealmFnBlocks is built under BOTH shader languages here,
 * in CI, headlessly — NullEngine generates shader source without a GPU, which
 * is exactly the layer where a bad transpile or a WGSL-only syntax error dies.
 *
 * What this cannot prove: pixels, or driver-level compilation. That stays on
 * the spike page per the repo's testing doctrine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { selfShadowStrength } from '../../model/selfShadow.js';

let buildTerrainMaterial, RealmFnBlock, createFbmBlock, createTerrainPaintBlock, TERRAIN_PALETTE;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ buildTerrainMaterial } = await import('./terrainNME.js'));
  ({ RealmFnBlock } = await import('./bsl/RealmFnBlock.js'));
  ({ createFbmBlock, createTerrainPaintBlock, TERRAIN_PALETTE } = await import('./bsl/terrainShaderLib.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

const newScene = () => {
  const scene = new BABYLON.Scene(engine);
  new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 0), scene);
  return scene;
};

describe('RealmFnBlock', () => {
  it('registers inputs and output from the declaration', () => {
    const b = createFbmBlock('f');
    expect(b.input('p').name).toBe('p');
    expect(b.output.type).toBe(BABYLON.NodeMaterialBlockConnectionPointTypes.Float);
  });

  it('throws on a typo´d param name instead of returning undefined', () => {
    const b = createFbmBlock('f2');
    expect(() => b.input('nope')).toThrow(/no param "nope"/);
  });

  it('rejects unsupported BSL types at construction', () => {
    expect(() => new RealmFnBlock('bad', {
      fnName: 'x', params: [{ name: 'm', type: 'mat4' }], returnType: 'float', body: 'return 0.0;',
    })).toThrow(/unsupported BSL type/);
  });
});

describe('buildTerrainMaterial — the dual-backend proof', () => {
  // NodeMaterial.build() is async in 9.18 (completion signalled via
  // onBuildObservable — a sync read after build() sees half-built state), so
  // the builder returns a promise and these tests await it.
  it('builds under GLSL (WebGL2)', async () => {
    const scene = newScene();
    try {
      const { material } = await buildTerrainMaterial(scene, { shaderLanguage: BABYLON.ShaderLanguage.GLSL });
      expect(material.getClassName()).toBe('NodeMaterial');
    } finally {
      scene.dispose();
    }
  });

  it('builds under WGSL (WebGPU) — the failure class CustomBlock hides', async () => {
    // With CustomBlock, GLSL source passes this build and dies only on a real
    // WebGPU device. With RealmFnBlock the transpiler runs HERE; a WGSL emit
    // error rejects in CI.
    const scene = newScene();
    try {
      const { material } = await buildTerrainMaterial(scene, { shaderLanguage: BABYLON.ShaderLanguage.WGSL });
      expect(material.getClassName()).toBe('NodeMaterial');
    } finally {
      scene.dispose();
    }
  });

  it('emits genuinely different source per language', async () => {
    // The whole point of the transpile: same BSL in, different dialects out.
    // GLSL keeps C-style declarations; WGSL rewrites them (`fn`, `var`, types).
    const sceneA = newScene();
    const sceneB = newScene();
    try {
      const a = await buildTerrainMaterial(sceneA, { shaderLanguage: BABYLON.ShaderLanguage.GLSL, name: 'a' });
      const glslPaint = a.material.attachedBlocks.find((b) => b.getClassName() === 'RealmFnBlock');
      const b = await buildTerrainMaterial(sceneB, { shaderLanguage: BABYLON.ShaderLanguage.WGSL, name: 'b' });
      const wgslPaint = b.material.attachedBlocks.find((x) => x.getClassName() === 'RealmFnBlock');

      expect(glslPaint._lastEmittedSource).toContain('vec3 realmTerrainPaint(');
      expect(wgslPaint._lastEmittedSource).toContain('fn realmTerrainPaint(');
      expect(wgslPaint._lastEmittedSource).not.toBe(glslPaint._lastEmittedSource);
    } finally {
      sceneA.dispose();
      sceneB.dispose();
    }
  });

  it('participates in scene fog and lighting', async () => {
    const scene = newScene();
    try {
      const { material } = await buildTerrainMaterial(scene);
      const classes = material.attachedBlocks.map((b) => b.getClassName());
      expect(classes).toContain('FogBlock');
      expect(classes).toContain('LightBlock');
    } finally {
      scene.dispose();
    }
  });

  it('never wires LightBlock.shadow — diffuseOutput ALREADY includes cast-shadow attenuation', async () => {
    // Real bug this pins, found in PR review: an earlier version of this file
    // multiplied diffuseOutput by lights.shadow (Babylon's separate aggShadow
    // output), on the theory that diffuseOutput excluded shadow attenuation.
    // Verified false straight from BABYLON.ShaderStore.IncludesShadersStore
    // .lightFragment — the actual per-light shader include Babylon compiles
    // in: `diffuseBase += info.diffuse * shadow;` runs BEFORE `diffuseOutput
    // = diffuseBase`, so shadow is already folded in. The extra multiply
    // roughly squared the attenuation, making cast shadows read far darker
    // than intended. Asserting `.shadow` is simply never connected is the
    // correct regression guard — connecting it to anything downstream of
    // diffuseOutput reintroduces the double-multiply.
    const scene = newScene();
    try {
      const { material } = await buildTerrainMaterial(scene);
      const lights = material.attachedBlocks.find((b) => b.getClassName() === 'LightBlock');
      expect(lights.shadow.isConnected).toBe(false);
      // And diffuseOutput must reach `shade` DIRECTLY — no MultiplyBlock
      // sitting between it and ambient.
      const shade = material.attachedBlocks.find((b) => b.name === 'shade');
      expect(shade.left.connectedPoint.ownerBlock).toBe(lights);
    } finally {
      scene.dispose();
    }
  });
});

describe('buildTerrainMaterial — self-shadow wiring', () => {
  it('reads a vertex color attribute, not a second RealmFnBlock', async () => {
    // The self-shadow multiply is built from stock NME blocks (Multiply,
    // Subtract, VectorSplitter) on purpose — terrainShaderLib.js's paint BSL
    // is untouched, so this feature carries none of the dual-backend-BSL risk.
    const scene = newScene();
    try {
      const { material } = await buildTerrainMaterial(scene);
      const colorInput = material.attachedBlocks.find(
        (b) => b.getClassName() === 'InputBlock' && b.name === 'color',
      );
      expect(colorInput).toBeTruthy();
      expect(colorInput.isAttribute).toBe(true);
    } finally {
      scene.dispose();
    }
  });

  it('applyState sets the selfShadowStrength uniform from sunDir[1], via the real curve', async () => {
    const scene = newScene();
    try {
      const { material, applyState } = await buildTerrainMaterial(scene);
      const strengthInput = material.attachedBlocks.find(
        (b) => b.getClassName() === 'InputBlock' && b.name === 'selfShadowStrength',
      );
      applyState({ sunDir: [0, 0.95, 0] }); // near-overhead sun -> weak self-shadow
      const overhead = strengthInput.value;
      applyState({ sunDir: [0, 0.1, 0] }); // grazing sun -> strong self-shadow
      const grazing = strengthInput.value;

      expect(grazing).toBeGreaterThan(overhead);
      expect(grazing).toBeCloseTo(selfShadowStrength(0.1), 10);
      expect(overhead).toBeCloseTo(selfShadowStrength(0.95), 10);
    } finally {
      scene.dispose();
    }
  });

  it('the shadow multiply sits between `lit` and `fog`, not upstream of the paint block', async () => {
    // Pins the deliberate ordering: self-shadow darkens the FULLY-LIT result,
    // not the raw albedo — so it never fights the diffuse/ambient blend.
    const scene = newScene();
    try {
      const { material } = await buildTerrainMaterial(scene);
      const fog = material.attachedBlocks.find((b) => b.getClassName() === 'FogBlock');
      const litShadowed = material.attachedBlocks.find((b) => b.name === 'litShadowed');
      expect(litShadowed).toBeTruthy();
      expect(fog.input.connectedPoint.ownerBlock).toBe(litShadowed);
    } finally {
      scene.dispose();
    }
  });
});

describe('palette', () => {
  it('is the single source of terrain color truth, in range', () => {
    for (const [name, rgb] of Object.entries(TERRAIN_PALETTE)) {
      expect(rgb, name).toHaveLength(3);
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('paint block embeds palette values into its BSL body', () => {
    const b = createTerrainPaintBlock('p', TERRAIN_PALETTE);
    expect(b._body).toContain(TERRAIN_PALETTE.grassLow[0].toFixed(4));
    expect(b._body).toContain(TERRAIN_PALETTE.snow[2].toFixed(4));
  });
});
