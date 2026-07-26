/**
 * The lake mirror's write-on-change invariant.
 *
 * `waterMirrorGate.test.js` pins the policy; this pins the wiring, because the
 * wiring has a trap that would silently negate the whole optimisation:
 * `RenderTargetTexture`'s `refreshRate` setter calls `resetRefreshCounter()`,
 * and `shouldRender()` renders unconditionally when the counter is -1 ("render
 * at least once"). So assigning the *same* rate every pass makes the mirror
 * render every pass no matter how low a rate was asked for — the gate would
 * look correct in code and do nothing.
 *
 * BabylonWorldScene reads the ambient BABYLON global at module scope, so the
 * fake has to be installed before the module graph is evaluated (the
 * crowdGating.test.js / NpcSystem.test.js pattern). Only `_updateWaterMirror`
 * is exercised, on a bare prototype instance — standing up a real scene would
 * need a GPU.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

let BabylonWorldScene;

beforeAll(async () => {
  globalThis.BABYLON = {
    Color3: class {}, Color4: class {}, Vector3: class {},
    Scene: class {}, Engine: class {},
    Mesh: {}, MeshBuilder: {}, StandardMaterial: class {},
    ShadowGenerator: {}, CascadedShadowGenerator: class {},
    SSAO2RenderingPipeline: class {}, DynamicTexture: class {},
    Texture: { WRAP_ADDRESSMODE: 1 }, ParticleSystem: { BLENDMODE_ONEONE: 1 },
    PointLight: class {}, Plane: class {}, ArcRotateCamera: class {},
    // Several streaming/material modules subclass this at module scope.
    MaterialPluginBase: class { constructor() {} },
  };
  ({ BabylonWorldScene } = await import('./BabylonWorldScene.js'));
});

afterAll(() => { delete globalThis.BABYLON; });

/**
 * A scene stub with a recording mirror. `lake` mirrors zone1_world.json's
 * Stillmere so distances read in real world units.
 */
function makeScene({ distance, indoors = false, reflections = true }) {
  const writes = [];
  const mirror = {
    _rate: 1,
    get refreshRate() { return this._rate; },
    set refreshRate(v) { this._rate = v; writes.push(v); },
  };
  const lake = { x: -92, z: 88, waterR: 27 };

  const s = Object.create(BabylonWorldScene.prototype);
  s.scene = { metadata: { ashwood: { waterMirror: mirror } } };
  s._worldgen = { config: { lake } };
  // Place the avatar `distance` metres from the lake centre, along +x.
  s._local = { root: { position: { x: lake.x + distance, y: 0, z: lake.z } } };
  s._castle = { isInside: () => indoors };
  s._localDungeonInstanceId = 0n;
  s._reflectionsOn = reflections;
  s._mirrorRate = null;
  return { s, mirror, writes };
}

describe('_updateWaterMirror', () => {
  it('writes the rate once, then stays silent while the state holds', () => {
    const { s, writes } = makeScene({ distance: 10 }); // on the lake
    s._updateWaterMirror();
    expect(writes).toEqual([1]);

    // Ten more passes at the same distance must not touch the setter — this is
    // the invariant. Re-writing 1 would be harmless; re-writing 0 or 3 would
    // reset the counter and force a full scene render every pass.
    for (let i = 0; i < 10; i += 1) s._updateWaterMirror();
    expect(writes).toEqual([1]);
  });

  it('holds the mirror far from the lake, and writes that exactly once', () => {
    const { s, writes } = makeScene({ distance: 400 });
    s._updateWaterMirror();
    s._updateWaterMirror();
    expect(writes).toEqual([0]);
  });

  it('holds the mirror in an interior even while standing over the lake', () => {
    const { s, writes } = makeScene({ distance: 0, indoors: true });
    s._updateWaterMirror();
    expect(writes).toEqual([0]);
  });

  it('holds the mirror when reflections are switched off', () => {
    const { s, writes } = makeScene({ distance: 0, reflections: false });
    s._updateWaterMirror();
    expect(writes).toEqual([0]);
  });

  it('re-writes when the player actually crosses a band', () => {
    const { s, mirror, writes } = makeScene({ distance: 10 });
    s._updateWaterMirror();
    expect(mirror.refreshRate).toBe(1);

    s._local.root.position.x = -92 + 400;   // walk away
    s._updateWaterMirror();
    expect(mirror.refreshRate).toBe(0);

    s._local.root.position.x = -92 + 10;    // walk back
    s._updateWaterMirror();
    expect(mirror.refreshRate).toBe(1);
    expect(writes).toEqual([1, 0, 1]);
  });

  it('is a no-op on tiers that never built a mirror', () => {
    const { s } = makeScene({ distance: 10 });
    delete s.scene.metadata.ashwood.waterMirror;
    expect(() => s._updateWaterMirror()).not.toThrow();
  });

  it('tolerates the load window, before the avatar has a position', () => {
    const { s, writes } = makeScene({ distance: 10 });
    s._local = null;
    s._updateWaterMirror();
    expect(writes).toEqual([0]); // hold rather than pay during load
  });
});

describe('_setReflectionsActive', () => {
  it('fades the shader term as well as holding the mirror, so nothing goes stale', () => {
    const { s, writes } = makeScene({ distance: 0 });
    const setAmt = vi.fn();
    s.scene.metadata.ashwood.setWaterReflectAmt = setAmt;

    s._setReflectionsActive(false);
    expect(setAmt).toHaveBeenCalledWith(0);
    expect(writes).toEqual([0]);

    s._setReflectionsActive(true);
    expect(setAmt).toHaveBeenCalledWith(1);
    expect(writes).toEqual([0, 1]);
  });
});
