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
 * The mirror case is a mesh with no vertex colours at all, since albedo IS the
 * vertex colour and Babylon emits `color` unguarded. That one is closed in the
 * material by MeshAttributeExistsBlock and pinned here by watching Babylon's own
 * VERTEXCOLOR_NME define flip as the fixture gains and loses its colour buffer —
 * likewise verified by mutation (delete the guard -> the assertions fail).
 *
 * Everything is built under BOTH shader languages, because CustomBlock-class
 * mistakes and WGSL-only emit errors compile fine on the machine that wrote
 * them and fail only on a player's WebGPU browser.
 *
 * ITS SIBLING IS `actorNMEBones.test.js`, which owns the P7 skinning splice:
 * that the BonesBlock sits between `world` and BOTH transforms, what the
 * generated source says about the bone path, and what a real skinned mesh
 * compiles to. It is split out because it needs the whole actor stack (rig,
 * skeleton, posed palette) where this file needs only a payload. THIS file
 * still owns the ATTRIBUTE SURFACE, which the splice widened by two kinds —
 * see ACTOR_MESH_KINDS below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { buildActorPayload } from '../../gen/actorGen.js';
import { buildActorRig } from '../../model/actorRig.js';

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
 * EXACTLY what an actor master provides — this list is `REQUIRED_KINDS` in
 * ActorPrototypes.js, which throws at boot if a master lacks any of them. No
 * thin instances, no custom vertex buffers, nothing else.
 *
 * IT GREW BY TWO IN P7, and the growth is the point rather than an exception
 * to the rule. Splicing a BonesBlock makes the compiled effect demand
 * `matricesIndices`/`matricesWeights` UNCONDITIONALLY — measured: it lists them
 * even for a mesh with no skeleton, where `NUM_BONE_INFLUENCERS` is 0 and
 * nothing reads them. So the guard below would have started failing on the old
 * three-kind fixture, and the honest repair is the one made here: the fixture
 * now carries what a real actor carries. The guard's MEANING is unchanged —
 * the effect may demand nothing an actor mesh does not supply — and it still
 * catches the propNME `instTint` trap, because a sixth kind would not be here.
 */
const ACTOR_MESH_KINDS = Object.freeze([
  'position', 'normal', 'color', 'matricesIndices', 'matricesWeights',
]);

/** The bone tree the skinning buffers below are composed against. */
const RIG = buildActorRig('unbound');

/**
 * NO SKELETON, deliberately: an ActorPrototypes MASTER carries the five
 * buffers and no skeleton (ActorRig attaches one to the clone), so this is the
 * faithful fixture. It also keeps the `bones stored as vertex uniforms`
 * warning — which fires once per SKELETON on the material define path — out of
 * this file entirely. actorNMEBones.test.js owns the skinned case and asserts
 * that warning explicitly.
 */
function makeActorMesh(scene, material, { colors = true } = {}) {
  const payload = buildActorPayload('unbound', 0);
  const mesh = new BABYLON.Mesh('actor', scene);
  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  if (colors) vd.colors = payload.colors;
  vd.indices = payload.indices;
  // The rigid single influence, exactly as ActorPrototypes.js composes it:
  // slot 0 carries the mass's bone at weight 1, slots 1..3 stay zero-filled.
  const boneIndices = new Float32Array(payload.vertCount * 4);
  const boneWeights = new Float32Array(payload.vertCount * 4);
  for (let v = 0; v < payload.vertCount; v++) {
    boneIndices[v * 4] = RIG.boneOfMass[payload.massIndex[v]];
    boneWeights[v * 4] = 1;
  }
  vd.matricesIndices = boneIndices;
  vd.matricesWeights = boneWeights;
  vd.applyToMesh(mesh, false);
  mesh.numBoneInfluencers = 1;
  mesh.material = material;
  return mesh;
}

/** Forces effect compilation for `mesh` and hands back {ready, effect}. */
function compileAgainst(material, mesh) {
  const sub = mesh.subMeshes[0];
  const ready = material.isReadyForSubMesh(mesh, sub);
  return { ready, effect: sub.effect };
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
    it(`${label}: demands NO vertex attribute beyond an actor master's five kinds`, async () => {
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
          'An actor is an ORDINARY MESH with no thin-instance buffers. Any vertex\n' +
            'attribute beyond the five an actor master carries is unbound at draw\n' +
            'time, reads (0,0,0,1), and — if it touches albedo — renders every\n' +
            'character in the game black. This is the propNME `instTint` trap; make\n' +
            'it a uniform instead. (If a SIXTH kind is legitimately needed, it must\n' +
            'be added to ActorPrototypes.js`s REQUIRED_KINDS in the same change.)',
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

    it(`${label}: the COMPILED EFFECT demands no attribute a real actor mesh lacks`, async () => {
      // The end-to-end form of the attribute guard, and the one that would still
      // catch a stray attribute pushed by something other than an InputBlock:
      // compile against the real generator's payload and ask the effect itself
      // what it needs, then ask the mesh what it has.
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `ae${label}`, shaderLanguage: lang });
        const mesh = makeActorMesh(scene, material);
        expect(mesh.subMeshes.length).toBe(1);
        const { ready, effect } = compileAgainst(material, mesh);

        // NullEngine reaches isReady only under GLSL, and the reason is narrow:
        // the `babylonjs` UMD bundle registers 145 WGSL includes against 173
        // GLSL ones, and `lightFragmentDeclaration` is one of the 30 with no
        // WGSL twin. Babylon therefore tries to LOAD it as a file and dies on
        // `XMLHttpRequest is not defined` in node. It is specific to the
        // LightBlock path — a WGSL graph without one readies fine — and it is a
        // bundle-packaging gap, not a defect in this graph or in WGSL support.
        // getAttributesNames() is populated either way, so the check below runs
        // under BOTH languages regardless; only the readiness claim is scoped.
        if (lang === BABYLON.ShaderLanguage.GLSL) expect(ready).toBe(true);
        expect(effect).toBeTruthy();

        const required = effect.getAttributesNames();
        const unprovided = required.filter((a) => !mesh.isVerticesDataPresent(a));
        expect(
          unprovided,
          'The compiled effect requires these vertex attributes, but a mesh built\n' +
            'from buildActorPayload does not have them. At draw time they read\n' +
            '(0,0,0,1) — a zero multiplied into albedo is a BLACK ACTOR.',
        ).toEqual([]);

        // Guard against a vacuous pass: the fixture must really carry every one
        // of the five kinds, and the effect must really be asking for them
        // rather than for none of them.
        for (const kind of ACTOR_MESH_KINDS) {
          expect(mesh.isVerticesDataPresent(kind), `fixture is missing ${kind}`).toBe(true);
        }
        expect([...required].sort()).toEqual([...ACTOR_MESH_KINDS].sort());
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: a mesh with NO vertex colours takes the fallback branch, not black`, async () => {
      // The other unguarded-attribute direction. Babylon wraps `normal` in
      // `#ifdef NORMAL … #else vec3 normal = vec3(0.);` but emits `color` bare,
      // so without MeshAttributeExistsBlock a colourless mesh would multiply
      // albedo by an unbound (0,0,0,1) and render black.
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `ac${label}`, shaderLanguage: lang });

        // Structure: the guarded value — not the raw attribute — is what
        // reaches albedo, and the fallback it selects is a non-zero uniform.
        const guard = blockOfClass(material, 'MeshAttributeExistsBlock');
        expect(guard, 'no vertex-colour existence guard in the graph').toBeTruthy();
        expect(guard.attributeType).toBe(BABYLON.MeshAttributeExistsBlockTypes.VertexColor);
        expect(guard.input.connectedPoint.ownerBlock.name).toBe('color');
        expect(endpointNames(guard.output)).toContain('colorSplit');
        const fallback = guard.fallback.connectedPoint.ownerBlock;
        expect(fallback.isUniform).toBe(true);
        expect(fallback.isAttribute).toBe(false);
        expect([fallback.value.r, fallback.value.g, fallback.value.b]).toEqual([1, 1, 1]);
        // ...and colorSplit must read the GUARD, never the attribute directly.
        expect(endpointNames(blockNamed(material, 'color').output)).toEqual(['safeColor']);

        // Behaviour: Babylon computes VERTEXCOLOR_NME itself, from
        // `mesh.useVertexColors && mesh.isVerticesDataPresent(ColorKind)`. So
        // the define flipping with the mesh IS the branch selection, observed
        // rather than assumed — both halves of the contract, held by the engine.
        const withColors = makeActorMesh(scene, material, { colors: true });
        expect(withColors.useVertexColors).toBe(true);
        expect(compileAgainst(material, withColors).effect.defines)
          .toMatch(/#define VERTEXCOLOR_NME/);

        const bare = makeActorMesh(scene, material, { colors: false });
        expect(bare.isVerticesDataPresent('color')).toBe(false);
        const bareEffect = compileAgainst(material, bare).effect;
        expect(bareEffect.defines).not.toMatch(/#define VERTEXCOLOR_NME/);

        // The define only means something if the #else exists and reads the
        // fallback uniform — this is the one place the emitted branch itself is
        // the evidence, so it is checked rather than trusted.
        const fs = fragmentSource(material);
        expect(fs).toMatch(/#ifdef VERTEXCOLOR_NME[\s\S]*?#else[\s\S]*?uAlbedoFallback[\s\S]*?#endif/);

        // HONEST SCOPE: this closes the BLACK outcome, not the attribute-list
        // proxy. `color` is still a required attribute on a colourless mesh —
        // the shader simply stops reading it. White is the failure mode now.
        expect(bareEffect.getAttributesNames()).toContain('color');
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

  it('rescales the world normal for lighting WITHOUT a NaN-producing normalize', async () => {
    // Deviation from terrainNME/propNME, deliberate: actors are the only realm
    // meshes that live under a parent transform and may be scaled, and Babylon's
    // LightBlock uses its worldNormal input verbatim (`vec3 normalW = ...xyz;`).
    //
    // But a bare NormalizeBlock is NOT safe here, which PR review caught: the
    // `normal` attribute carries Babylon's `#else vec3 normal = vec3(0.);`
    // fallback, so a mesh with no normal buffer feeds in a zero vector and
    // `normalize(vec3(0))` is `0 * inversesqrt(0)` = NaN, straight out to the
    // fragment. The attribute guard cannot catch that case, because with NORMAL
    // undefined `normal` is not a required attribute at all. Dividing by
    // max(length, eps) rescales unit and short normals identically but sends a
    // zero normal to zero — ambient-only, dark but visible, which is exactly how
    // the raw (pre-deviation) version degraded.
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      expect(
        classesOf(material),
        'A bare normalize() of the zero-normal fallback is NaN. Divide by\n' +
          'max(length(n), eps) instead.',
      ).not.toContain('NormalizeBlock');

      const lights = blockOfClass(material, 'LightBlock');
      const divide = lights.worldNormal.connectedPoint.ownerBlock;
      expect(divide.getClassName()).toBe('DivideBlock');
      expect(divide.left.connectedPoint.ownerBlock.name).toBe('worldNormal');

      const max = divide.right.connectedPoint.ownerBlock;
      expect(max.getClassName()).toBe('MaxBlock');
      expect(max.left.connectedPoint.ownerBlock.getClassName()).toBe('LengthBlock');
      const eps = max.right.connectedPoint.ownerBlock;
      expect(eps.value, 'the epsilon floor must be strictly positive').toBeGreaterThan(0);
      expect(max.left.connectedPoint.ownerBlock.value.connectedPoint.ownerBlock.name)
        .toBe('worldNormal');
    } finally {
      scene.dispose();
    }
  });

  it('transforms with the ordinary world matrix — actors move every frame', async () => {
    // The mirror image of propNME's InstancesBlock test. A thin-instance path
    // here would need world0..3 attributes (caught by the attribute guard); the
    // positive form is that the transform chain is driven by the `world` system
    // value Babylon binds per draw.
    //
    // CONSCIOUSLY UPDATED IN P7. This used to assert that `world` feeds BOTH
    // transforms directly. It no longer does and must not: the BonesBlock sits
    // between them, so `world` has exactly ONE consumer now and any second one
    // is a transform that skipped the bone palette. The positive half — that
    // `bones.output` reaches both transforms — is in actorNMEBones.test.js,
    // which is where the mis-splice is actually fatal.
    const scene = newScene();
    try {
      const { material } = await buildActorMaterial(scene);
      const world = material.getInputBlocks().find((b) => b.name === 'world');
      expect(world.isSystemValue).toBe(true);
      expect(world.systemValue).toBe(BABYLON.NodeMaterialSystemValues.World);
      expect(
        endpointNames(world.output),
        'The raw world matrix must reach the transforms ONLY through the\n' +
          'BonesBlock. A transform reading `world` directly is unskinned: on\n' +
          'worldPos the actor never bends, on worldNormal it bends but is lit as\n' +
          'if it had not — and NO matrix test in this phase can see either.',
      ).toEqual(['bones']);
    } finally {
      scene.dispose();
    }
  });

  it('resolves ONLY the material — no speculative setters on the payload', async () => {
    // The brief's contract is Promise<{material}>. A tint setter existed here
    // briefly with zero callers anywhere in src/; the UNIFORM is the safety
    // property and stays, the setter was speculation and went. Pinned so it
    // does not drift back in without a real caller to justify it.
    const scene = newScene();
    try {
      const built = await buildActorMaterial(scene);
      expect(Object.keys(built)).toEqual(['material']);
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
