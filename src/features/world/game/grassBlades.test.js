import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';

// This suite uses the REAL babylonjs + a headless NullEngine (no GPU) to lock the
// grass material's plugin contract. NullEngine does not compile GLSL, so this
// guards the JS/API layer + shader-hook strings + lifecycle — not visual output
// (that is on-device). grassBlades.js reads the ambient BABYLON global, so it must
// be installed before the module graph is imported (a dynamic import achieves that).
let buildBladeClusterVertexData, createGrassMaterial;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ buildBladeClusterVertexData, createGrassMaterial } = await import('./grassBlades.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

function newScene() {
  const scene = new BABYLON.Scene(engine);
  scene.metadata = { ashwood: { qualityTier: 'high', weather: { windStrength: 1.2 } } };
  const cam = new BABYLON.FreeCamera('c', new BABYLON.Vector3(0, 3, -6), scene);
  cam.setTarget(BABYLON.Vector3.Zero());
  return scene;
}

function grassPlugin(mat) {
  return mat.pluginManager?._plugins?.find((p) => p.name === 'GrassWind') ?? null;
}

describe('createGrassMaterial', () => {
  it('is frozen — no texture is ever assigned to a grass material, so this is unconditionally safe', () => {
    const scene = newScene();
    const mat = createGrassMaterial(scene, { maxH: 0.5, name: 'g' });
    expect(mat.isFrozen).toBe(true);
    scene.dispose();
  });

  it('keeps pushing the wind-clock uniforms every frame even though the material is frozen', async () => {
    // The risk freeze() carries in general is that a shared material's bind
    // gets skipped for meshes after the first each frame — but the plugin's
    // bindForSubMesh runs on whatever bind DOES happen, and its uniforms are
    // scene-global (the shared wind clock, weather), not per-mesh, so there is
    // nothing for that skip to make stale. Pin that the hook still actually
    // fires across frames, so wind can never visually freeze in place.
    const scene = newScene();
    // newScene() doesn't set an active camera — harmless for the other tests
    // here (they only assert "doesn't throw" or inspect plugin state), but
    // scene.render() silently no-ops without one, which would make this
    // test's whole premise vacuous.
    scene.activeCamera = scene.cameras[0];
    const geo = buildBladeClusterVertexData({ planes: 2, segments: 3, height: 0.5 });
    const mat = createGrassMaterial(scene, { maxH: geo.maxH, name: 'g' });
    const mesh = new BABYLON.Mesh('grass', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = geo.positions; vd.indices = geo.indices; vd.normals = geo.normals; vd.uvs = geo.uvs;
    vd.applyToMesh(mesh);
    mesh.material = mat;
    mesh.thinInstanceSetBuffer('matrix', new Float32Array(BABYLON.Matrix.IdentityReadOnly.m), 16, false);
    mesh.thinInstanceCount = 1;
    mesh.thinInstanceRefreshBoundingInfo();
    mesh.alwaysSelectAsActiveMesh = true; // skip frustum culling — not what's under test here

    const plugin = grassPlugin(mat);
    let calls = 0;
    const orig = plugin.bindForSubMesh.bind(plugin);
    plugin.bindForSubMesh = (...args) => { calls += 1; return orig(...args); };

    expect(mat.isFrozen).toBe(true);
    // Shader "compilation" under NullEngine still resolves asynchronously —
    // the mesh isn't actually ready (and nothing binds) on the very first
    // synchronous render() call, so yield between frames the same way a real
    // render loop would across real frames.
    for (let f = 0; f < 5; f++) {
      scene.render();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(calls).toBeGreaterThan(0);
    scene.dispose();
  });

  it('is a StandardMaterial carrying the GrassWind plugin, rendered opaque', () => {
    const scene = newScene();
    const mat = createGrassMaterial(scene, { maxH: 0.5, name: 'g' });
    expect(mat).toBeInstanceOf(BABYLON.StandardMaterial);
    expect(grassPlugin(mat)).not.toBeNull();
    // needAlphaBlending:false keeps it out of the transparent queue…
    expect(mat.needAlphaBlending()).toBe(false);
    scene.dispose();
  });

  it('forces opaque OUTPUT alpha in the fragment (the wind seed never reaches alpha)', () => {
    const scene = newScene();
    const mat = createGrassMaterial(scene, { maxH: 0.5, name: 'g' });
    // …AND a late fragment hook pins color.a = 1, so instanceColor.a (the wind
    // seed) can't leak into the output alpha even if VERTEXALPHA multiplies it.
    // This is a separate contract from needAlphaBlending (owner review, finding 1).
    const frag = grassPlugin(mat).getCustomCode('fragment');
    expect(frag.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toMatch(/color\.a\s*=\s*1\.0/);
    scene.dispose();
  });

  it('thin-instances and renders through NullEngine without a JS/API error', () => {
    const scene = newScene();
    const key = new BABYLON.DirectionalLight('k', new BABYLON.Vector3(-0.6, -1, -0.35), scene);
    const sg = new BABYLON.ShadowGenerator(256, key); // plain map: NullEngine has no CSM
    const caster = BABYLON.MeshBuilder.CreateBox('caster', { size: 1 }, scene);
    caster.position.y = 2;
    sg.addShadowCaster(caster, true);

    const geo = buildBladeClusterVertexData({ planes: 2, segments: 3, height: 0.5 });
    const mat = createGrassMaterial(scene, { maxH: geo.maxH, name: 'g' });
    const mesh = new BABYLON.Mesh('grass', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = geo.positions; vd.indices = geo.indices; vd.normals = geo.normals; vd.uvs = geo.uvs;
    vd.applyToMesh(mesh);
    mesh.material = mat;
    mesh.receiveShadows = true;

    const N = 4;
    const mats = new Float32Array(N * 16);
    const cols = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      BABYLON.Matrix.Translation(i * 0.3, 0, 0).copyToArray(mats, i * 16);
      cols.set([0.3, 0.5, 0.2, (i * 37 % 100) / 100], i * 4); // a = wind seed
    }
    mesh.thinInstanceSetBuffer('matrix', mats, 16, false);
    mesh.thinInstanceSetBuffer('color', cols, 4, false);
    mesh.thinInstanceCount = N;

    expect(grassPlugin(mat).isEnabled).toBe(true);
    expect(() => { for (let f = 0; f < 3; f++) scene.render(); }).not.toThrow();
    scene.dispose();
  });

  it('unregisters the shared wind-clock observer when the last grass material disposes', () => {
    const scene = newScene();
    const before = new Set(scene.onBeforeRenderObservable.observers);
    const a = createGrassMaterial(scene, { maxH: 0.5, name: 'a' });
    const b = createGrassMaterial(scene, { maxH: 0.4, name: 'b' });
    // Exactly one shared clock observer, regardless of how many grass materials.
    const added = scene.onBeforeRenderObservable.observers.filter((o) => !before.has(o));
    expect(added.length).toBe(1);
    const clockObs = added[0];

    // "Active" = still in the observer list and not marked for removal. Babylon
    // may splice immediately or defer (mark `_willBeUnregistered` + splice on the
    // next notify), so check both to be version-robust.
    const isActive = () =>
      scene.onBeforeRenderObservable.observers.includes(clockObs) && !clockObs._willBeUnregistered;

    a.dispose();
    expect(isActive()).toBe(true); // b still holds the shared clock
    b.dispose();
    expect(isActive()).toBe(false); // last grass material gone → clock unregistered
    scene.dispose();
  });
});
