/**
 * actorNMEBones.test.js — THE SPLICE, and the one mis-splice no matrix test
 * can see.
 *
 * P7's oracle chain proves the MATRIX PIPELINE end to end: `evaluatePose` vs a
 * hand reference, `skinPayload` vs `evaluatePose`, and finally Babylon's own
 * `applySkeleton` vs the fp32 twin at 2^-22 (ActorSkeleton.test.js). Not one
 * link in it compiles a shader, so not one link can tell whether actorNME's
 * GRAPH hands the palette to the right blocks. That is this file's whole job.
 *
 * THE FAILURE IT EXISTS FOR:
 *
 *     worldPos.transform  <- bones.output      (correct)
 *     worldNormal.transform <- world           (the mis-splice)
 *
 * Positions would deform perfectly and normals would stay in the bind pose:
 * a character that bends while its shading does not. Every palette assertion,
 * every vertex oracle, every attribute list and every `isReady` check stays
 * green — the normal is still unit-length, still non-zero, still plausibly
 * oriented. `bones.output` having EXACTLY the endpoints {worldPos, worldNormal}
 * is the only headless statement that catches it, so it is asserted at the
 * graph level AND corroborated in the generated source (where the same fault
 * shows up as the raw `u_world` uniform gaining a third reader).
 *
 * ── THE BONES-UNIFORM WARNING, AND WHY IT IS ASSERTED RATHER THAN SILENCED ──
 *
 * Splicing BonesBlock makes Babylon's bone define-prep fire a per-skeleton
 * `Logger.Warn`: NullEngine reports `maxVertexUniformVectors = 16`, Babylon
 * reserves 40 for everything else, so the usable bone budget computes to
 * `max(16 - 40, 0) = 0` and 8 bones "exceed" it. It is a WARNING ONLY —
 * measured: no define changes, nothing throws, no fallback is taken, and the
 * effect readies exactly as it would without it. Real devices report 256+ and
 * compute 36 against 216; the warning never fires on hardware.
 *
 * IT IS PINNED HERE BECAUSE ITS OWN ADVICE IS A TRAP. The message ends with
 * "Set skeleton.useTextureToStoreBoneMatrices = true" — the EXACT INVERSE of
 * ActorSkeleton.js's uniform-path pin, which exists precisely so the tested
 * path is the shipped path (NullEngine reports `textureFloat = false`, so a
 * texture-path skeleton would take the uniform path headless and the texture
 * path on every real GPU: the untestable divergence, in the one place this
 * project has been burned three phases running). A maintainer cleaning up CI
 * noise is ONE LINE from reintroducing it. So the warning is a recorded fact
 * with the trap named next to it, not noise to be tidied away, and no caps
 * override is applied — faking `maxVertexUniformVectors` would drift the
 * headless engine further from the device and disturb `textureFloat`, which is
 * the pin's own premise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { buildActorPayload } from '../../gen/actorGen.js';
import { buildActorRig } from '../../model/actorRig.js';
import { CANARY_POSE } from '../../model/actorCanary.js';

let buildActorMaterial;
let buildActorSkeleton;
let engine;

/** Every Logger.Warn this file provokes, collected instead of printed. */
const warnings = [];
let realWarn;

beforeAll(async () => {
  // Load-bearing order: view/ modules read the ambient BABYLON global, so it
  // must exist BEFORE the dynamic imports.
  globalThis.BABYLON = BABYLON;
  ({ buildActorMaterial } = await import('./actorNME.js'));
  ({ buildActorSkeleton } = await import('../actor/ActorSkeleton.js'));
  engine = new BABYLON.NullEngine();
  realWarn = BABYLON.Logger.Warn;
  BABYLON.Logger.Warn = (message) => { warnings.push(String(message)); };
});

afterAll(() => {
  if (realWarn) BABYLON.Logger.Warn = realWarn;
  engine?.dispose();
});

const newScene = () => {
  const scene = new BABYLON.Scene(engine);
  new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 0), scene);
  return scene;
};

const vertexSource = (m) => m._vertexCompilationState.compilationString;
const classesOf = (m) => m.attachedBlocks.map((b) => b.getClassName());
const blockNamed = (m, name) => m.attachedBlocks.find((b) => b.name === name);
const endpointNames = (point) => point.endpoints.map((e) => e.ownerBlock.name);

/** The rig every fixture here is skinned against. 8 bones, the roster's deepest. */
const RIG = buildActorRig('unbound');
/**
 * Babylon sizes `mBones[BonesPerMesh]` at bones + 1 — it appends one identity
 * pad slot past the last bone, which ActorSkeleton.test.js pins independently
 * as a palette length of `16 * (bones + 1)`.
 */
const BONES_PER_MESH = RIG.bones.length + 1;

/**
 * A live actor mesh: the five buffers ActorPrototypes.js writes, plus (unless
 * `skeleton: false`) its own posed skeleton, exactly as ActorRig marries them.
 * ONE SKELETON PER MESH — `Mesh.clone()` shares the reference, and each fresh
 * skeleton is also what makes the once-per-skeleton warning observable.
 */
function makeSkinnedActor(scene, material, { skeleton = true } = {}) {
  const payload = buildActorPayload('unbound', 0);
  const mesh = new BABYLON.Mesh(`actor${scene.meshes.length}`, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  vd.colors = payload.colors;
  vd.indices = payload.indices;
  const boneIndices = new Float32Array(payload.vertCount * 4);
  const boneWeights = new Float32Array(payload.vertCount * 4);
  for (let v = 0; v < payload.vertCount; v++) {
    boneIndices[v * 4] = RIG.boneOfMass[payload.massIndex[v]];
    boneWeights[v * 4] = 1;
  }
  vd.matricesIndices = boneIndices;
  vd.matricesWeights = boneWeights;
  vd.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  mesh.numBoneInfluencers = 1;
  mesh.material = material;
  if (!skeleton) return { mesh, skeleton: null };
  const skin = buildActorSkeleton(scene, RIG, `sk${scene.skeletons.length}`);
  // POSED, not at rest: a rest palette is the identity, so a material bound to
  // a rest skeleton is indistinguishable from one bound to none.
  skin.setPose(CANARY_POSE.unbound);
  mesh.skeleton = skin.skeleton;
  return { mesh, skeleton: skin.skeleton };
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

describe('actorNME — the BonesBlock splice', () => {
  for (const [label, lang] of LANGUAGES) {
    it(`${label}: the bone palette drives BOTH transforms, and world reaches neither`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `ab${label}`, shaderLanguage: lang });
        expect(classesOf(material)).toContain('BonesBlock');
        const bones = blockNamed(material, 'bones');

        // (1) bones -> BOTH transforms, and nothing else. THE assertion this
        // file exists for, and FIRST deliberately: the mis-splice trips (2) as
        // well, and this is the message that should be the one a reader sees.
        // Compared as a SET, so a transform that quietly stops reading the
        // palette fails here even though everything still builds.
        expect(
          endpointNames(bones.output).sort(),
          'BonesBlock.output must reach worldPos AND worldNormal. Feeding\n' +
            'worldNormal the raw world matrix instead lights every actor by its\n' +
            'BIND-POSE normals: geometry that bends under shading that does not.\n' +
            'No palette test, no vertex oracle and no attribute list can see it.',
        ).toEqual(['worldNormal', 'worldPos']);

        // (2) ...and world reaches them ONLY through the BonesBlock.
        expect(endpointNames(blockNamed(material, 'world').output)).toEqual(['bones']);
        expect(bones.world.connectedPoint.ownerBlock.name).toBe('world');

        // (3) the attributes it accumulates from, typed at construction.
        //
        // *** THESE ASSERTIONS ARE NOT REDUNDANT WITH THE SOURCE PINS, AND NO
        // SOURCE PIN CAN EVER REPLACE THEM. NEVER RETIRE THEM. ***
        //
        // Babylon's `bonesDeclaration`/`bonesVertex` includes read
        // `matricesIndices` and `matricesWeights` BY LITERAL NAME.
        // `BonesBlock._buildBlock` substitutes only the `influence` variable —
        // it never rewrites the include to match what is actually connected. So
        // these connection points are DECLARATION HOOKS, not data paths: they
        // exist to make Babylon declare and list the attributes, and the maths
        // downstream reads the names regardless.
        //
        // Two consequences, both measured:
        //   - SWAPPING the two wires changes the emitted shader by EXACTLY TWO
        //     LINES, and they are the two `attribute vec4 …` DECLARATIONS. Zero
        //     maths changes. Every source-level assertion in this file stays
        //     green; only the name check below goes red.
        //   - Connecting a DIFFERENTLY NAMED InputBlock declares the wrong
        //     attribute while the include still reads the right one — a real
        //     unbound-attribute bug that NullEngine cannot compile far enough
        //     to notice, and that no text in the generated source reveals.
        //
        // The graph is therefore the ONLY layer where a mis-wired bone
        // attribute is visible headless. The source pins below are structurally
        // incapable of covering this, however thorough they look.
        const T = BABYLON.NodeMaterialBlockConnectionPointTypes;
        for (const [point, name] of [[bones.matricesIndices, 'matricesIndices'],
          [bones.matricesWeights, 'matricesWeights']]) {
          const input = point.connectedPoint.ownerBlock;
          expect(input.name).toBe(name);
          expect(input.isAttribute).toBe(true);
          expect(input.output.type).toBe(T.Vector4);
        }
        // Influences 5..8 are out of scope for a rigid single-influence rig;
        // their code sits behind `#if NUM_BONE_INFLUENCERS>4` and never runs.
        expect(bones.matricesIndicesExtra.isConnected).toBe(false);
        expect(bones.matricesWeightsExtra.isConnected).toBe(false);
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: the generated vertex source carries the bone chain, on the mBones path`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `as${label}`, shaderLanguage: lang });
        const vs = vertexSource(material);

        // Babylon's own bonesDeclaration + bonesVertex includes, emitted by
        // BonesBlock. Both have WGSL twins, so this holds under both languages
        // (unlike lightFragmentDeclaration — see actorNME.test.js).
        expect(vs).toContain('NUM_BONE_INFLUENCERS');
        expect(vs).toContain('BonesPerMesh');
        // The uniform path's accumulation, reading both attributes.
        expect(vs).toMatch(/influence\w*\s*=\s*(?:influence\w*\s*\+\s*)?(?:uniforms\.)?mBones\[/);
        expect(vs).toMatch(/mBones\[[^\]]*matricesIndices\[0\]\)?\]\s*\*\s*(?:vertexInputs\.)?matricesWeights\[0\]/);

        // THE SPLICE, in the emitted text. BonesBlock declares one matrix as
        // `world * influence`; both transforms must be built from THAT name.
        const spliced = vs.match(/(\w+)\s*(?::\s*mat4x4f\s*)?=\s*(?:uniforms\.)?u_world\s*\*\s*(\w+);/);
        expect(spliced, 'no `<matrix> = world * influence` line — is BonesBlock wired at all?').toBeTruthy();
        const palette = spliced[1];
        expect(vs, 'the POSITION transform does not read the bone matrix')
          .toMatch(new RegExp(`\\b${palette}\\s*\\*\\s*vec4`));
        // TWO faults print this one, and the second is why the assertion is
        // written against the mat3 form rather than against `<M> *` generally:
        //   1. worldNormal.transform is on the raw world matrix (the mis-splice)
        //   2. worldNormal.complementW is not 0, so TransformBlock emits the
        //      full `<M> * vec4(normal, 1.0)` affine instead of `mat3(<M>)`.
        //      The bone matrix IS read there — but its TRANSLATION column now
        //      enters the lighting normal, flattening every actor's shading
        //      toward the origin direction as it walks away from it.
        expect(
          vs,
          'The NORMAL transform is not reading `mat3(<bone matrix>)`. Either it\n' +
            'is on the raw world matrix (bind-pose lighting), or complementW is\n' +
            'no longer 0 and bone TRANSLATION is leaking into the normal.',
        ).toMatch(new RegExp(`mat3(?:x3f)?\\(\\s*${palette}\\b`));

        // ...and the raw world uniform is read NOWHERE ELSE: its declaration
        // plus BonesBlock's two branches. A fourth occurrence is a transform
        // that skipped the palette — the same fault as the endpoint set above,
        // caught a second way, in the text the GPU actually receives.
        expect(
          (vs.match(/\bu_world\b/g) || []).length,
          'u_world should appear exactly 3x: its declaration and BonesBlock`s\n' +
            '`#if NUM_BONE_INFLUENCERS>0 / #else` pair. A 4th reader is a\n' +
            'transform bypassing the bone palette. A count that moved for any\n' +
            'OTHER reason — a babylonjs upgrade restructuring how BonesBlock or\n' +
            'InputBlock emit, so the graph is unchanged and only the text moved —\n' +
            'means re-deriving the expected number from the new emit, not\n' +
            'loosening the assertion: the graph assertions above stay the primary\n' +
            'gate and this one is their corroboration in the text the GPU gets.',
        ).toBe(3);

        // HONEST SCOPE — the texture path is DEAD TEXT, not absent text.
        // Babylon does not evaluate `#ifdef`; it prepends the define block and
        // lets the driver's preprocessor do it. So `boneSampler` is present in
        // every build under both languages, inside `#ifdef BONETEXTURE`, and
        // "boneSampler is absent from the source" is not an assertable claim
        // at any level headless. What IS assertable is that the define
        // selecting it is never set for an actor — pinned on the compiled
        // effect below, where it also depends on the skeleton.
        expect(vs).toMatch(/#ifdef BONETEXTURE/);
      } finally {
        scene.dispose();
      }
    });

    it(`${label}: a posed skinned actor compiles with the bone defines live`, async () => {
      const scene = newScene();
      try {
        const { material } = await buildActorMaterial(scene, { name: `am${label}`, shaderLanguage: lang });
        const { mesh, skeleton } = makeSkinnedActor(scene, material);
        const { ready, effect } = compileAgainst(material, mesh);

        // Readiness is GLSL-only for the reason actorNME.test.js documents:
        // the UMD bundle has no WGSL `lightFragmentDeclaration`, so a WGSL
        // LightBlock effect never readies headless. Nothing to do with bones —
        // both bone includes DO have WGSL twins, which is why every define and
        // attribute assertion below runs under both languages.
        if (lang === BABYLON.ShaderLanguage.GLSL) expect(ready).toBe(true);
        expect(effect).toBeTruthy();

        // Runtime fact: the effect asks for the skinning attributes and the
        // mesh supplies them.
        const required = effect.getAttributesNames();
        expect(required).toContain('matricesIndices');
        expect(required).toContain('matricesWeights');
        expect(required.filter((a) => !mesh.isVerticesDataPresent(a))).toEqual([]);

        // The skinning branch is the one that compiles: one influence per
        // vertex, and the palette sized to this rig.
        expect(effect.defines).toMatch(/#define NUM_BONE_INFLUENCERS 1/);
        expect(effect.defines).toMatch(new RegExp(`#define BonesPerMesh ${BONES_PER_MESH}\\b`));

        // ANTI-VACUITY: the same material against a mesh with NO skeleton
        // compiles the `#else` branch instead. This is what proves the defines
        // above track the mesh rather than being constants of the graph — and
        // it pins the safe state, since ActorPrototypes' masters are exactly
        // this mesh and must still transform by their world matrix.
        const bare = makeSkinnedActor(scene, material, { skeleton: false });
        expect(bare.mesh.skeleton).toBeFalsy();
        expect(compileAgainst(material, bare.mesh).effect.defines)
          .toMatch(/#define NUM_BONE_INFLUENCERS 0/);

        // THE UNIFORM-PATH PIN, and its shader-level consequence. The premise
        // is the skeleton's own flag (ActorSkeleton.js); the consequence is
        // that BONETEXTURE is never defined, so the driver deletes every
        // boneSampler line and `mBones` is the only path compiled.
        //
        // HEADLESS THIS IS OVER-DETERMINED, and saying so is the point:
        // `isUsingTextureForMatrices` also requires `caps.textureFloat`, which
        // NullEngine reports false, so flipping the flag alone does NOT flip
        // BONETEXTURE here — measured. On a real GPU textureFloat is true and
        // the flag is the ONLY thing holding the texture path off. The flag
        // assertion below is therefore the one with teeth headless; the define
        // is what that flag buys on the device.
        expect(
          skeleton.useTextureToStoreBoneMatrices,
          'Someone took the bones-uniform warning`s advice. THIS assertion is the\n' +
            'headless teeth — the BONETEXTURE line below CANNOT catch it, because\n' +
            'NullEngine reports textureFloat = false and the texture path stays\n' +
            'unreachable here whatever the flag says. On a real GPU textureFloat is\n' +
            'true and this flag is the only thing keeping the shipped path the\n' +
            'tested one. See the header, and ActorSkeleton.js`s pin.',
        ).toBe(false);
        expect(effect.defines).not.toMatch(/#define BONETEXTURE/);
        expect(engine.getCaps().textureFloat).toBe(false);
      } finally {
        scene.dispose();
      }
    });
  }

  it('fires the bones-uniform warning — a NullEngine artefact whose advice is the trap', async () => {
    // See the header. Three claims, in order: the warning fires; it is a
    // warning ONLY (the effect readies and the defines are unchanged by it);
    // and its remedy is the exact inverse of the pin, asserted against the
    // real message text so the trap cannot drift out of the string.
    const scene = newScene();
    warnings.length = 0;
    try {
      const { material } = await buildActorMaterial(scene, {
        name: 'awarn', shaderLanguage: BABYLON.ShaderLanguage.GLSL,
      });
      const { mesh, skeleton } = makeSkinnedActor(scene, material);
      const { ready, effect } = compileAgainst(material, mesh);

      const boneWarning = warnings.find((w) => /bones stored as vertex uniforms/.test(w));
      expect(
        boneWarning,
        'The bones-uniform warning did not fire. It is EXPECTED headless\n' +
          '(NullEngine reports maxVertexUniformVectors = 16 against Babylon`s\n' +
          '40-vector reserve, so the bone budget computes to 0). If it stopped\n' +
          'firing, either the engine`s reported caps changed or something is\n' +
          'overriding them — and a caps override is what this file refuses to do.',
      ).toBeTruthy();
      expect(engine.getCaps().maxVertexUniformVectors).toBe(16);

      // A warning, nothing more: no define changed, no fallback taken.
      expect(ready).toBe(true);
      expect(effect.defines).toMatch(/#define NUM_BONE_INFLUENCERS 1/);
      expect(effect.defines).not.toMatch(/#define BONETEXTURE/);

      // *** THE TRAP, MADE MECHANICAL ***
      // The warning tells the reader to do the one thing ActorSkeleton.js's
      // pin forbids. Asserting the sentence is in the message keeps the
      // warning and this explanation from drifting apart: if Babylon ever
      // changes the advice, this test says so and the comment gets re-read.
      expect(boneWarning).toMatch(/useTextureToStoreBoneMatrices = true/);
      expect(
        skeleton.useTextureToStoreBoneMatrices,
        'Someone took the warning`s advice. That is the untestable divergence\n' +
          'THE PIN exists to prevent: headless would still take the uniform path\n' +
          '(NullEngine textureFloat = false) while every real GPU took the\n' +
          'texture path — the shipped path would stop being the tested one.',
      ).toBe(false);
    } finally {
      scene.dispose();
    }
  });
});
