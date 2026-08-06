/**
 * actorNME.test.js — the black-actor trap, mechanically foreclosed.
 *
 * NullEngine proves generated SOURCE and compiled EFFECT STATE; it cannot read
 * a pixel. That blind spot is exactly where the previous phase's review found
 * its render-criticals (a prop field collapsed to world origin, a shadow term
 * multiplied twice), so this file does not assert "the shader text looks
 * right". It asserts RUNTIME FACTS about the built material:
 *
 *   - which vertex ATTRIBUTES the compiled effect actually demands, checked
 *     against a mesh built from the real gen/actorGen.js payload
 *   - which connection points are and are not connected
 *   - what the material reports about alpha
 *
 * THE CENTRAL GUARD (the reason this material is not propNME): an unbound
 * vertex attribute reads (0,0,0,1). propNME multiplies albedo by `instTint`,
 * an instanced attribute; on an ordinary actor mesh that buffer does not exist,
 * albedo goes to zero, and every character renders pure black. No headless test
 * can see the black pixel — but the STRUCTURAL cause is fully visible: the
 * compiled effect would demand an attribute the mesh does not supply. That is
 * what `demands no attribute the actor mesh lacks` pins, and it was verified by
 * mutation (wire the tint as an attribute -> the assertion fails naming
 * `instTint`) rather than assumed.
 *
 * Everything is built under BOTH shader languages, because CustomBlock-class
 * mistakes and WGSL-only emit errors compile fine on the machine that wrote
 * them and fail only on a player's WebGPU browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { buildActorPayload } from '../../gen/actorGen.js';

let buildActorMaterial;
let engine;

beforeAll(async () => {
  // Load-bearing order: view/ modules read the ambient BABYLON global at import
  // time, so the global must exist BEFORE the dynamic import.
  globalThis.BABYLON = BABYLON;
  ({ buildActorMaterial } = await import('./actorNME.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

const newScene = () => {
  const scene = new BABYLON.Scene(engine);
  new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 0), scene);
  return scene;
};

const fragmentSource = (m) => m._fragmentCompilationState.compilationString;
const classesOf = (m) => m.attachedBlocks.map((b) => b.getClassName());
const blockNamed = (m, name) => m.attachedBlocks.find((b) => b.name === name);
const blockOfClass = (m, cls) => m.attachedBlocks.find((b) => b.getClassName() === cls);
const endpointNames = (point) => point.endpoints.map((e) => e.ownerBlock.name);

/**
 * EXACTLY what an ordinary actor mesh provides: the real generator's payload
 * applied to a plain Mesh, the same three buffers ActorPrototypes will bind
 * (Task 8). No thin instances, no custom vertex buffers, nothing else. If
 * actorGen ever stops emitting one of these, this fixture stops providing it
 * and the attribute guard below reports the gap instead of hiding it.
 */
const ACTOR_MESH_KINDS = Object.freeze(['position', 'normal', 'color']);

function makeActorMesh(scene, material) {
  const payload = buildActorPayload('unbound', 0);
  const mesh = new BABYLON.Mesh('actor', scene);
  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  vd.colors = payload.colors;
  vd.indices = payload.indices;
  vd.applyToMesh(mesh, false);
  mesh.material = material;
  return mesh;
}

const LANGUAGES = [
  ['GLSL', BABYLON.ShaderLanguage.GLSL],
  ['WGSL', BABYLON.ShaderLanguage.WGSL],
];

describe('buildActorMaterial — dual backend', () => {
  for (const [label, lang] of LANGUAGES) {
    it(`${label}: builds, and resolves only after the build actually completed`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `a${label}`, shaderLanguage: lang });
        expect(material.getClassName()).toBe('NodeMaterial');
        expect(material.shaderLanguage).toBe(lang);
        // build() is async in Babylon 9.x; a resolved promise must mean BUILT,
        // not merely "build() returned". Compilation state proves it.
        expect(material._buildWasSuccessful).toBe(true);
        expect(fragmentSource(material).length).toBeGreaterThan(0);
      } finally {
        scene.dispose();
      }
    });

    // ── THE BLACK-ACTOR GUARD ────────────────────────────────────────────────
    it(`${label}: demands NO vertex attribute beyond position/normal/color`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `at${label}`, shaderLanguage: lang });

        // (1) Graph level: every InputBlock that is an attribute, by name.
        const attributeInputs = material.getInputBlocks()
          .filter((b) => b.isAttribute)
          .map((b) => b.name)
          .sort();
        expect(
          attributeInputs,
          'An actor is an ORDINARY MESH with no thin-instance buffers. Any extra\n' +
            'vertex attribute here is unbound at draw time, reads (0,0,0,1), and — if\n' +
            'it touches albedo — renders every character in the game black. This is\n' +
            'the propNME `instTint` trap; make it a uniform instead.',
        ).toEqual([...ACTOR_MESH_KINDS].sort());

        // (2) Emit level: the attributes the vertex program actually declares.
        const emitted = [...material._vertexCompilationState.attributes].sort();
        expect(emitted).toEqual([...ACTOR_MESH_KINDS].sort());

        // (3) And no instancing machinery smuggled the matrices in as vertex
        // data either — that is the other half of propNME's attribute surface.
        expect(classesOf(material)).not.toContain('InstancesBlock');
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: the tint is a UNIFORM with a non-zero default, feeding albedo`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `au${label}`, shaderLanguage: lang });
        const tint = material.getInputBlocks().find((b) => /tint/i.test(b.name));

        expect(tint, 'no tint input found — the guard below would pass vacuously').toBeTruthy();
        expect(tint.isUniform, 'tint must be a uniform, never a vertex attribute').toBe(true);
        expect(tint.isAttribute).toBe(false);
        expect(tint.isSystemValue).toBe(false);

        // Non-zero on EVERY channel: a zero channel is a colour the actor can
        // never show. White specifically is multiplicatively neutral, so an
        // unconfigured material renders the baked vertex colour exactly.
        expect(tint.value.r).toBeGreaterThan(0);
        expect(tint.value.g).toBeGreaterThan(0);
        expect(tint.value.b).toBeGreaterThan(0);
        expect([tint.value.r, tint.value.g, tint.value.b]).toEqual([1, 1, 1]);

        // It must actually reach albedo, or "the tint is safe" is a claim about
        // a disconnected block.
        expect(endpointNames(tint.output)).toContain('albedo');
        const albedo = blockNamed(material, 'albedo');
        expect(albedo.left.connectedPoint.ownerBlock.name).toBe('colorSplit');
        expect(albedo.right.connectedPoint.ownerBlock.name).toBe(tint.name);
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: never wires LightBlock.shadow — the P4c double-multiply cannot return`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `as${label}`, shaderLanguage: lang });
        const lights = blockOfClass(material, 'LightBlock');
        expect(
          lights.shadow.isConnected,
          'LightBlock.diffuseOutput ALREADY folds per-light shadow attenuation\n' +
            '(Babylon`s own lightFragment: diffuseBase += info.diffuse * shadow).\n' +
            'Multiplying lights.shadow on top squares it.',
        ).toBe(false);
        // And diffuseOutput must be the term that IS consumed.
        expect(endpointNames(lights.diffuseOutput)).toContain('shade');
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: the compiled fragment contains no discard — opaque-only holds`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `ad${label}`, shaderLanguage: lang });
        expect(fragmentSource(material)).not.toMatch(/\bdiscard\b/);
        // Writing alpha at all is the first step to needing blending.
        expect(blockOfClass(material, 'FragmentOutputBlock').a.isConnected).toBe(false);
      } finally {
        scene.dispose();
      }
    });
  }

  it('the COMPILED EFFECT demands no attribute a real actor mesh lacks', async () => {
    // The end-to-end form of the attribute guard, and the one that would still
    // catch a stray attribute pushed by something other than an InputBlock:
    // compile against the real generator's payload and ask the effect itself
    // what it needs, then ask the mesh what it has.
    //
    // GLSL only, and not by preference: NullEngine can GENERATE WGSL source
    // (covered above, per language) but cannot COMPILE a WGSL effect — the UMD
    // bundle registers no WGSL shader includes, so Babylon falls back to
    // fetching `lightFragment` over XMLHttpRequest and dies in node. The
    // property being checked is language-independent anyway: the emitted
    // attribute list is asserted identical under both languages above.
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene, {
        name: 'aeffect',
        shaderLanguage: BABYLON.ShaderLanguage.GLSL,
      });
      const mesh = makeActorMesh(scene, material);

      expect(mesh.subMeshes.length).toBe(1);
      expect(material.isReadyForSubMesh(mesh, mesh.subMeshes[0])).toBe(true);

      const effect = mesh.subMeshes[0].effect;
      expect(effect).toBeTruthy();
      const required = effect.getAttributesNames();
      const unprovided = required.filter((a) => !mesh.isVerticesDataPresent(a));
      expect(
        unprovided,
        'The compiled effect requires these vertex attributes, but a mesh built\n' +
          'from buildActorPayload does not have them. At draw time they read\n' +
          '(0,0,0,1) — a zero multiplied into albedo is a BLACK ACTOR.',
      ).toEqual([]);

      // Guard against a vacuous pass: the fixture must really carry all three,
      // and the effect must really be reading them rather than none of them.
      for (const kind of ACTOR_MESH_KINDS) {
        expect(mesh.isVerticesDataPresent(kind), `fixture is missing ${kind}`).toBe(true);
      }
      expect([...required].sort()).toEqual([...ACTOR_MESH_KINDS].sort());
    } finally {
      scene.dispose();
    }
  });

  it('never requires alpha blending or alpha testing', async () => {
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      expect(material.needAlphaBlending()).toBe(false);
      expect(material.needAlphaTesting()).toBe(false);
      // Also for a real actor mesh: vertex colours carry alpha 1, so nothing
      // flips the mesh into the transparent pass behind our back.
      const mesh = makeActorMesh(scene, material);
      expect(material.needAlphaBlendingForMesh(mesh)).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('lights and fogs like terrain and props do', async () => {
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      const classes = classesOf(material);
      expect(classes).toContain('LightBlock');
      expect(classes).toContain('FogBlock');
      // Fog is the LAST thing before the output, not an unused branch.
      const fog = blockOfClass(material, 'FogBlock');
      expect(endpointNames(fog.output)).toContain('fragmentOutput');
      expect(fog.input.connectedPoint.ownerBlock.name).toBe('lit');
    } finally {
      scene.dispose();
    }
  });

  it('clamps the shade term below the blowout ceiling', async () => {
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      const clamp = blockOfClass(material, 'ClampBlock');
      expect(clamp.minimum).toBe(0);
      expect(clamp.maximum).toBe(1.08);
      expect(endpointNames(clamp.output)).toContain('lit');
    } finally {
      scene.dispose();
    }
  });

  it('normalizes the world normal before lighting it', async () => {
    // Deviation from terrainNME/propNME, deliberate: actors are the only realm
    // meshes that live under a parent transform and may be scaled, and Babylon's
    // LightBlock uses its worldNormal input verbatim (`vec3 normalW = ...xyz;`).
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      const lights = blockOfClass(material, 'LightBlock');
      expect(lights.worldNormal.connectedPoint.ownerBlock.getClassName()).toBe('NormalizeBlock');
      const norm = blockOfClass(material, 'NormalizeBlock');
      expect(norm.input.connectedPoint.ownerBlock.name).toBe('worldNormal');
    } finally {
      scene.dispose();
    }
  });

  it('transforms with the ordinary world matrix — actors move every frame', async () => {
    // The mirror image of propNME's InstancesBlock test. A thin-instance path
    // here would need world0..3 attributes (caught by the attribute guard); the
    // positive form is that BOTH transforms read the `world` system value.
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      const world = material.getInputBlocks().find((b) => b.name === 'world');
      expect(world.isSystemValue).toBe(true);
      expect(world.systemValue).toBe(BABYLON.NodeMaterialSystemValues.World);
      const consumers = endpointNames(world.output);
      expect(consumers).toContain('worldPos');
      expect(consumers).toContain('worldNormal');
    } finally {
      scene.dispose();
    }
  });

  it('applyTint writes the shared tint uniform', async () => {
    const scene = newScene();
    try {
      const { material, applyTint } = await buildActorMaterial(scene);
      const tint = material.getInputBlocks().find((b) => /tint/i.test(b.name));
      expect([tint.value.r, tint.value.g, tint.value.b]).toEqual([1, 1, 1]);
      applyTint({ r: 0.8, g: 0.6, b: 0.4 });
      expect([tint.value.r, tint.value.g, tint.value.b]).toEqual([0.8, 0.6, 0.4]);
      // Still a uniform afterwards — a setter must not change the input's mode.
      expect(tint.isUniform).toBe(true);
      expect(tint.isAttribute).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('rejects AND disposes when the build reports an error', async () => {
    // No graph this file can construct actually fails to build, so the failure
    // is injected at the one seam that matters: build() notifying its error
    // observable. What is under test is entirely OUR code — that the promise
    // settles (a caller must never await forever) and that the half-built
    // material is disposed rather than left registered on the scene.
    const scene = newScene();
    const realBuild = BABYLON.NodeMaterial.prototype.build;
    BABYLON.NodeMaterial.prototype.build = function build() {
      this.onBuildErrorObservable.notifyObservers('synthetic failure');
    };
    try {
      await expect(buildActorMaterial(scene, { name: 'aboom' }))
        .rejects.toThrow(/\[actorNME\] build failed: synthetic failure/);
      expect(scene.getMaterialByName('aboom')).toBeNull();
    } finally {
      BABYLON.NodeMaterial.prototype.build = realBuild;
      scene.dispose();
    }
  });
});
