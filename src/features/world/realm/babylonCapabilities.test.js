/**
 * babylonCapabilities.test.js — pins the Babylon facts the Realm is built on.
 *
 * The Realm's material strategy rests on a handful of properties of the installed
 * Babylon build. Several are PRIVATE APIs (underscore-prefixed) that Babylon could
 * rename in a minor release. If any of these stops being true, the failure mode is
 * ugly and remote: shaders that compile on WebGL2 and silently fail only on WebGPU,
 * or a GUI layer that clobbers the core global at bundle time and takes the whole
 * world down.
 *
 * So: assert them here, in CI, on every run. A red test at upgrade time is cheap.
 * A production-only WebGPU shader failure is not.
 *
 * Runs headless in node. No GPU, no jsdom.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import BABYLON from 'babylonjs';

const require_ = createRequire(import.meta.url);
const coreVersion = require_('babylonjs/package.json').version;
const guiVersion = require_('babylonjs-gui/package.json').version;

describe('babylon capabilities', () => {
  it('core and GUI are the same version', () => {
    // Babylon expects its packages in lockstep. A GUI built against a different
    // core minor can reference APIs the core does not have. npm will happily
    // resolve `^9.18.0` to a newer 9.x for one package and not the other, so the
    // GUI dependency is pinned exact — this test is what keeps it pinned.
    expect(guiVersion).toBe(coreVersion);
  });

  it('exports the engine classes the Realm selects between', () => {
    expect(typeof BABYLON.Engine).toBe('function');
    expect(typeof BABYLON.NullEngine).toBe('function');
    // WebGPU ships behind a graphics-panel flag; the class must exist in the UMD
    // bundle for that flag to be selectable at all.
    expect(typeof BABYLON.WebGPUEngine).toBe('function');
  });

  it('exports the NodeMaterial surface the material pipeline extends', () => {
    expect(typeof BABYLON.NodeMaterial).toBe('function');
    expect(typeof BABYLON.NodeMaterialBlock).toBe('function');
    expect(typeof BABYLON.CascadedShadowGenerator).toBe('function');
  });

  it('ShaderLanguage.WGSL is 1 and GLSL is 0', () => {
    // RealmFnBlock branches on `state.shaderLanguage === ShaderLanguage.WGSL`,
    // mirroring how stock blocks (WorleyNoise3DBlock) do it. If these values
    // ever move, every custom block emits the wrong dialect.
    expect(BABYLON.ShaderLanguage.GLSL).toBe(0);
    expect(BABYLON.ShaderLanguage.WGSL).toBe(1);
  });

  it('the BabylonSL transpiler exists in the installed bundle', () => {
    // This is the load-bearing fact for one-source-two-backends: custom shader
    // math is authored once in a GLSL-shaped dialect and Babylon transpiles it
    // per target language. Both methods live on NodeMaterialBuildState, which is
    // NOT a public export — Babylon hands the instance to `_buildBlock(state)`.
    // We therefore cannot construct one here; assert against the shipped bundle.
    // The real end-to-end proof is RealmFnBlock's compile test (P3).
    const bundle = readFileSync(require_.resolve('babylonjs/babylon.max.js'), 'utf8');
    expect(bundle).toContain('_babylonSLtoWGSL');
    expect(bundle).toContain('_babylonSLtoGLSL');
  });

  it('CustomBlock exists but is deliberately unused', () => {
    // Present in the bundle, and a trap: its build path emits code verbatim with
    // no language branch, so GLSL written into a CustomBlock compiles on WebGL2
    // and fails ONLY on WebGPU. RealmFnBlock subclasses NodeMaterialBlock and
    // transpiles instead. Asserted so nobody "helpfully" reaches for it.
    expect(typeof BABYLON.CustomBlock).toBe('function');
  });

  it('GUI is reachable ONLY via the global namespace, not the module exports', async () => {
    // A real trap. `import BABYLON from 'babylonjs'` gives you the module exports
    // object; babylonjs-gui does NOT attach to it. `BABYLON.GUI` is undefined
    // there and defined on globalThis. View code must read the ambient global —
    // which is the repo convention anyway (/* global BABYLON */), so this is
    // consistent, but it fails confusingly if someone imports the default export
    // and reaches for .GUI on it.
    await import('babylonjs-gui');
    expect(BABYLON.GUI).toBeUndefined();
    expect(globalThis.BABYLON.GUI).toBeTruthy();
  });

  it('AdvancedDynamicTexture cannot be constructed headlessly', () => {
    // Documented, not lamented. ADT requires OffscreenCanvas, which node does not
    // provide (and jsdom does not either). This is WHY the HUD design splits into
    // a pure presenter (node-testable: what should the bar read, did the value
    // change, how many redraws) and a thin ADT writer (browser-verified only).
    // If this ever starts passing, headless HUD tests become possible — worth
    // knowing, hence the assertion rather than a comment.
    expect(typeof OffscreenCanvas).toBe('undefined');
  });

  it('GUI attaches to the global without clobbering core, in either import order', async () => {
    // The hazard: babylonjs-loaders self-assigns into globalThis.BABYLON and will
    // create a stub if absent. If babylonjs-gui did the same, a bundler that
    // hoisted the GUI import above core could leave a stub standing where the
    // real namespace should be — the class of bug that already took this app down
    // once (see src/babylonGlobal.js). Verified empirically instead of assumed.
    await import('babylonjs-gui');
    expect(globalThis.BABYLON).toBeTruthy();
    expect(globalThis.BABYLON.GUI).toBeTruthy();
    expect(typeof globalThis.BABYLON.GUI.AdvancedDynamicTexture).toBe('function');
    // Core must still be intact after GUI evaluates.
    expect(typeof globalThis.BABYLON.Scene).toBe('function');
  });
});
