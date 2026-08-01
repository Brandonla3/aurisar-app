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
/* global process */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import BABYLON from 'babylonjs';

const require_ = createRequire(import.meta.url);
const BABYLON_PACKAGES = ['babylonjs', 'babylonjs-gui', 'babylonjs-loaders', 'babylonjs-serializers'];
const installed = Object.fromEntries(
  BABYLON_PACKAGES.map((p) => [p, require_(`${p}/package.json`).version]),
);
const coreVersion = installed.babylonjs;

// src/features/world/realm → repo root, so the child process resolves deps.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('babylon capabilities', () => {
  it('every Babylon package is on the same version', () => {
    // Babylon expects its packages in lockstep. A GUI or loader built against a
    // different core minor can reference APIs the core does not have. npm will
    // happily resolve `^9.18.0` to a newer 9.x for one package and not another —
    // that is not hypothetical, it is what happened: `babylonjs-gui@^9.18.0`
    // installed 9.19.0 against a 9.18.0 core. All four are now pinned exact and
    // this test is what keeps them that way.
    expect(installed).toEqual({
      babylonjs: coreVersion,
      'babylonjs-gui': coreVersion,
      'babylonjs-loaders': coreVersion,
      'babylonjs-serializers': coreVersion,
    });
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

  // NOTE: the CustomBlock ban is enforced in boundary.test.js, which scans Realm
  // sources for actual use. Asserting here that the class exists proved only that
  // Babylon ships it — nothing about whether our own code avoids it, which is the
  // invariant that matters.

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

  it('AdvancedDynamicTexture cannot be constructed headlessly', async () => {
    // Assert the actual claim, not a proxy for it. An earlier version checked
    // `typeof OffscreenCanvas === 'undefined'`, which would fail on a future node
    // that defines OffscreenCanvas even if ADT still could not boot — and would
    // pass if ADT grew some other headless blocker.
    //
    // This matters because it is load-bearing: the GUI has NO unit-test path, so
    // HUD code splits into a pure presenter (node-testable) and a thin ADT writer
    // (browser-verified only). If this test ever fails, that constraint has
    // lifted and the HUD architecture is worth revisiting.
    await import('babylonjs-gui');
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    try {
      expect(() =>
        globalThis.BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('probe', true, scene),
      ).toThrow();
    } finally {
      // Teardown throws too, and that is part of the finding: the ADT registers
      // itself on the scene BEFORE it fails, so the half-built texture poisons
      // both scene.dispose() and engine.dispose() (which disposes its scenes).
      // A failed ADT cannot be cleaned up. Swallow it — this engine is local to
      // the test and the process is about to move on.
      try { engine.dispose(); } catch { /* expected: see above */ }
    }
  });

  it('GUI after core: attaches to the global without clobbering it', async () => {
    // Note the narrow title. This file imports `babylonjs` at module scope, so by
    // the time this runs, core is already loaded — it can only prove one order.
    // The opposite (and more dangerous) order is covered by the next test.
    await import('babylonjs-gui');
    expect(globalThis.BABYLON).toBeTruthy();
    expect(globalThis.BABYLON.GUI).toBeTruthy();
    expect(typeof globalThis.BABYLON.GUI.AdvancedDynamicTexture).toBe('function');
    expect(typeof globalThis.BABYLON.Scene).toBe('function');
  });

  it('GUI BEFORE core: does not leave a stub standing where core belongs', () => {
    // The real hazard. babylonjs-loaders self-assigns into globalThis.BABYLON and
    // creates a stub `{}` if absent. If babylonjs-gui did the same and a bundler
    // hoisted the GUI import above core, the stub would win and every BABYLON.*
    // lookup would fail at runtime — the exact class of bug that already took this
    // app down once (see src/babylonGlobal.js for the post-mortem).
    //
    // Import order cannot be reversed within this module, so this runs in a fresh
    // child process where nothing has been loaded yet.
    const script = [
      "require('babylonjs-gui');",
      'const guiOnly = { gui: !!(globalThis.BABYLON && globalThis.BABYLON.GUI) };',
      "require('babylonjs');",
      'console.log(JSON.stringify({',
      '  guiPresentBeforeCore: guiOnly.gui,',
      '  coreIntactAfter: typeof globalThis.BABYLON.Scene === "function",',
      '  guiStillPresent: !!globalThis.BABYLON.GUI,',
      '}));',
    ].join('\n');

    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const result = JSON.parse(out.trim().split('\n').pop());

    // Core survives being loaded second, and GUI is not wiped by it.
    expect(result.coreIntactAfter).toBe(true);
    expect(result.guiStillPresent).toBe(true);
  });
});
