/**
 * RealmScene.test.js — NullEngine smoke for scene construction and the render loop.
 *
 * NullEngine does not compile shaders, so this guards the JS/API layer only:
 * that the scene is configured the way the rest of the Realm assumes, that the
 * one render loop runs, that a throwing frame stops it instead of screaming
 * every frame forever, and that teardown actually tears down.
 *
 * Pattern B (see grassBlades.test.js): RealmScene reads the ambient BABYLON
 * global, so the global is installed before the module graph is imported, which
 * a dynamic import guarantees.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';

let createRealmScene, startRenderLoop, DEFAULT_FOG_DENSITY;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ createRealmScene, startRenderLoop, DEFAULT_FOG_DENSITY } = await import('./RealmScene.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

describe('createRealmScene', () => {
  it('configures the fog contract the atmosphere layer depends on', () => {
    const scene = createRealmScene(engine);
    try {
      // EXP2 reads as atmospheric depth rather than a visible wall, and it is
      // what FogDriver will drive. A change here is a visual change everywhere.
      expect(scene.fogMode).toBe(BABYLON.Scene.FOGMODE_EXP2);
      expect(scene.fogDensity).toBe(DEFAULT_FOG_DENSITY);
      expect(scene.fogColor).toBeInstanceOf(BABYLON.Color3);
    } finally {
      scene.dispose();
    }
  });

  it('honours overrides', () => {
    const scene = createRealmScene(engine, { fogColor: { r: 1, g: 0, b: 0 }, fogDensity: 0.02 });
    try {
      expect(scene.fogDensity).toBe(0.02);
      expect(scene.fogColor.r).toBe(1);
    } finally {
      scene.dispose();
    }
  });

  it('disables pointer-move picking', () => {
    // Per-frame raycasts against the whole scene, for a game that targets on
    // click/tap. Pure waste, and easy to re-enable by accident.
    const scene = createRealmScene(engine);
    try {
      expect(scene.skipPointerMovePicking).toBe(true);
    } finally {
      scene.dispose();
    }
  });
});

describe('startRenderLoop', () => {
  it('renders frames and stops on teardown', () => {
    const scene = createRealmScene(engine);
    new BABYLON.FreeCamera('c', new BABYLON.Vector3(0, 1, -5), scene);
    let frames = 0;
    scene.onAfterRenderObservable.add(() => { frames += 1; });

    const stop = startRenderLoop(engine, scene);
    try {
      engine._renderLoop();
      engine._renderLoop();
      expect(frames).toBe(2);

      stop();
      engine._renderLoop();
      expect(frames).toBe(2); // no further frames after teardown
    } finally {
      stop();
      scene.dispose();
    }
  });

  it('stops the loop on the first throwing frame and reports the cause once', () => {
    const scene = createRealmScene(engine);
    new BABYLON.FreeCamera('c2', new BABYLON.Vector3(0, 1, -5), scene);

    const boom = new Error('render exploded');
    scene.onBeforeRenderObservable.add(() => { throw boom; });

    const seen = [];
    const stop = startRenderLoop(engine, scene, { onError: (e) => seen.push(e) });
    try {
      engine._renderLoop();
      engine._renderLoop();
      engine._renderLoop();

      // The point of the latch: one report, not one per frame forever.
      expect(seen).toEqual([boom]);
    } finally {
      stop();
      scene.dispose();
    }
  });
});
