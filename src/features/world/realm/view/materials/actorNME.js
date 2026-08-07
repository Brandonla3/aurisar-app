/**
 * actorNME — ONE material for every actor in the world.
 *
 * Same single-material discipline as propNME (no per-mob material churn, no
 * program switch between archetypes), same lighting and fog wiring so actors
 * sit in the same light and the same depth cue as the ground they stand on.
 * What it deliberately does NOT share with propNME is the instancing path.
 *
 * WHY THIS IS NOT `buildPropMaterial` (the whole reason this file exists):
 * propNME multiplies albedo by `instTint`, a per-INSTANCE vertex attribute.
 * That is correct for props, which are only ever drawn as thin instances with
 * a real `instTint` buffer bound. Actors are ORDINARY MESHES — one live world
 * matrix each, no thin-instance buffers — so on an actor that attribute would
 * be unbound, and an unbound vertex attribute reads (0,0,0,1). Albedo would be
 * multiplied by zero and every character in the game would render pure black.
 * Note that this is not the same fail-open contract `sproutBirth` enjoys:
 * there, zero deliberately means "fully grown". Here zero means "invisible".
 *
 * So the rule this file holds: THE TINT IS A UNIFORM WITH A NON-ZERO DEFAULT,
 * never an attribute. White is multiplicatively neutral, so an actor drawn by
 * a material nobody ever configured renders exactly its baked vertex colours.
 * actorNME.test.js enforces this MECHANICALLY rather than by inspection: it
 * compiles the material against a mesh carrying exactly what an actor master
 * carries (ActorPrototypes.js's REQUIRED_KINDS — position/normal/color plus the
 * two skinning kinds) and asserts the resulting effect demands no attribute
 * that mesh does not supply. Re-wiring the tint as an attribute makes that
 * assertion fail — verified by mutation, not assumed.
 *
 * THE OTHER HALF: albedo IS the vertex colour, and `color` is emitted BARE.
 * Babylon guards `normal` (`#ifdef NORMAL … #else vec3 normal = vec3(0.);`) but
 * not `color`, so a mesh that arrives here without a colour buffer would hit
 * the same unbound-attribute mechanism from the other direction. That is closed
 * by MeshAttributeExistsBlock below: Babylon computes VERTEXCOLOR_NME itself
 * from `mesh.useVertexColors && mesh.isVerticesDataPresent(ColorKind)`, so the
 * guarantee is a compile-time branch rather than a promise some future caller
 * has to keep. Be precise about what it buys: it closes the BLACK OUTCOME, not
 * the attribute-list proxy — the guarded variant still LISTS `color` as a
 * required attribute, it simply stops READING it, and a colourless actor
 * renders white instead of black. Loud and wrong beats invisible and wrong.
 *
 * THE SKINNING SEAM (P7, and the one splice no matrix test can see). A
 * `BonesBlock` now sits between the `world` system value and the transform
 * chain: it emits Babylon's own `bonesDeclaration` + `bonesVertex` includes,
 * accumulates `influence` from `matricesIndices`/`matricesWeights`, and outputs
 * `world * influence` — the matrix BOTH transforms must consume. The whole
 * P7 oracle chain (ActorSkeleton.test.js: the fp32 twin agrees with Babylon's
 * `applySkeleton` to 2^-22) proves the MATRIX PIPELINE and can say nothing at
 * all about this file's wiring, because it never compiles a shader. So the
 * failure mode this graph must foreclose by assertion is precise:
 *
 *   `worldPos.transform` reads `bones.output` but `worldNormal.transform` is
 *   left on the raw `world` uniform.
 *
 * Every skinned actor would then be lit by the normals of its BIND POSE — a
 * character whose geometry bends correctly while its shading stays rigid, which
 * on a moving mob at gameplay distance reads as "the lighting looks a bit off"
 * and never as a bug. No palette test, no vertex oracle and no attribute list
 * can see it; `actorNMEBones.test.js` asserts the endpoint set of
 * `bones.output` is EXACTLY {worldPos, worldNormal}, and that assertion is the
 * only headless defence there is until the GPU pass.
 *
 * NUM_BONE_INFLUENCERS = 0 IS A SAFE STATE, deliberately not guarded against.
 * Babylon defines it per mesh from `mesh.numBoneInfluencers`, and BonesBlock
 * emits `#if NUM_BONE_INFLUENCERS>0 output = world * influence; #else output =
 * world; #endif`. A mesh with no skeleton — ActorPrototypes' own masters, which
 * never render — therefore compiles to exactly the pre-P7 transform chain
 * rather than to a zero matrix. The unbound-attribute trap does not apply to
 * the two matrices kinds for the same reason: with the influencer count at 0
 * nothing reads them.
 *
 * OPAQUE-ONLY DISCIPLINE (inherited, load-bearing): no discard, no alpha test,
 * no alpha blend anywhere in this graph. Actor silhouettes are real vertices
 * (model/actorMasses.js), never alpha-cut cards. One discard forfeits per-pixel
 * hidden-surface removal for the whole pass on Apple TBDR hardware.
 *
 * NO freezeWorldMatrix. PropStreamer freezes its carriers because a prop chunk
 * never moves; actors move every frame by definition, and a frozen world matrix
 * would pin them wherever they were first drawn.
 */

/* global BABYLON */

/** Multiplicatively neutral: white leaves baked vertex colour untouched. */
const DEFAULT_TINT = Object.freeze({ r: 1, g: 1, b: 1 });

/**
 * Stand-in albedo when a mesh has no vertex colours at all. White, so the
 * failure is a glaring untextured actor rather than a black hole in the scene.
 */
const ALBEDO_FALLBACK = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/**
 * Floor for the world-normal length before dividing by it. Any positive value
 * far above float32 denormals works; normals are unit-length by construction,
 * so this only ever engages on the degenerate zero-normal case.
 */
const NORMAL_LENGTH_EPS = 1e-5;

/** Matches terrainNME/propNME so actors and their surroundings share a key. */
const DEFAULT_AMBIENT = Object.freeze({ r: 0.30, g: 0.32, b: 0.30 });

/**
 * terrainNME's measured anti-blowout ceiling. Scene lights are tuned for
 * StandardMaterial's response curve and diffuse+ambient overshoots 1.0 easily;
 * a hair over 1 keeps sunlit surfaces lively without saturating a channel.
 */
const SHADE_CEILING = 1.08;

/**
 * @param {object} scene
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {number|null} [opts.shaderLanguage] null = whatever the engine
 *   dictates; tests force GLSL and WGSL in turn.
 * @returns {Promise<{material: object}>} resolves once the build has ACTUALLY
 *   completed — `NodeMaterial.build()` is async in Babylon 9.x, returns
 *   immediately and finishes on a later task, so onBuildObservable is the only
 *   honest completion signal and onBuildErrorObservable the only place a bad
 *   graph reports.
 *
 *   No tint SETTER is exported, deliberately: nothing in the game needs one yet,
 *   and the uniform's job is to be a safe default, not a feature. If a real
 *   caller appears, add `applyTint` here in the resolve payload. Note what it
 *   could and could not be: the tint is MATERIAL-GLOBAL because every actor
 *   draws with this one material, so it can only ever be a scene-wide grade or
 *   a debug wash — never per-actor and never faction colour. Faction identity is
 *   baked into vertex colour by gen/actorGen.js. Per-actor tinting would need
 *   either a cloned material per actor (a draw-call regression this phase's
 *   budget forbids) or an instanced attribute (the black-actor trap above).
 */
export function buildActorMaterial(scene, {
  name = 'realmActor',
  shaderLanguage = null,
} = {}) {
  const nm = new BABYLON.NodeMaterial(name, scene);
  if (shaderLanguage !== null) nm.shaderLanguage = shaderLanguage;

  // ── Vertex stage: world -> bone palette -> transform chain ────────────────
  // No InstancesBlock and no world0..3 attributes. Props need them because thin
  // instances carry their matrices in vertex buffers; an actor's matrix arrives
  // as the ordinary `world` uniform Babylon binds per draw, which is what makes
  // a moving, parented, LOD-swapped mesh work at all.
  const position = new BABYLON.InputBlock('position');
  position.setAsAttribute('position');
  const normal = new BABYLON.InputBlock('normal');
  normal.setAsAttribute('normal');
  const vColor = new BABYLON.InputBlock('color');
  vColor.setAsAttribute('color');

  const world = new BABYLON.InputBlock('world');
  world.setAsSystemValue(BABYLON.NodeMaterialSystemValues.World);
  const viewProjection = new BABYLON.InputBlock('viewProjection');
  viewProjection.setAsSystemValue(BABYLON.NodeMaterialSystemValues.ViewProjection);

  // The two skinning attributes. ActorPrototypes.js writes both on every actor
  // master (stride 4: `[boneOfMass[massIndex[v]], 0, 0, 0]` and `[1, 0, 0, 0]`)
  // and asserts their presence at boot, so they are as guaranteed as position.
  //
  // THE TYPE IS DECLARED AT CONSTRUCTION, not left to AutoDetect. Babylon's own
  // `BonesBlock.autoConfigure` gets away with the bare `new InputBlock(name)`
  // form because `matricesIndices`/`matricesWeights` are RESERVED names in
  // `InputBlock`'s attribute type table (measured: AutoDetect resolves both to
  // Vector4 and connects). That table is the only thing making it work — the
  // same bare form on a custom name resolves to AutoDetect (1024) and refuses
  // the connection, which is why propNME.js declares `instTint` as Vector3 at
  // construction. Declaring the type here costs one argument and removes the
  // dependency on Babylon's reserved-name list entirely.
  const T = BABYLON.NodeMaterialBlockConnectionPointTypes;
  const matricesIndices = new BABYLON.InputBlock('matricesIndices', undefined, T.Vector4);
  matricesIndices.setAsAttribute('matricesIndices');
  const matricesWeights = new BABYLON.InputBlock('matricesWeights', undefined, T.Vector4);
  matricesWeights.setAsAttribute('matricesWeights');

  // `matricesIndicesExtra`/`matricesWeightsExtra` stay UNCONNECTED: they carry
  // influences 5..8, and this phase's rig is rigid single-influence (weight 1.0
  // in slot 0, ActorPrototypes.js). Their code is behind `#if
  // NUM_BONE_INFLUENCERS>4`, which never fires at `numBoneInfluencers = 1`.
  const bones = new BABYLON.BonesBlock('bones');
  matricesIndices.output.connectTo(bones.matricesIndices);
  matricesWeights.output.connectTo(bones.matricesWeights);
  world.output.connectTo(bones.world);

  const worldPos = new BABYLON.TransformBlock('worldPos');
  position.connectTo(worldPos);
  bones.output.connectTo(worldPos.transform);

  // w = 0: normals rotate with the world matrix but never translate.
  //
  // THE ORDER OF THESE TWO LINES IS LOAD-BEARING, and in the same reserved-name
  // way `matricesIndices` was above. TransformBlock's `vector` input registers
  // an onConnection observable that FORCES `complementW = 0` whenever the block
  // connecting to it is an InputBlock named `normal` or `tangent` (read from
  // the shipped constructor, not inferred). So the assignment below is restored
  // by the connect that follows it, and changing the literal to 1 is an
  // EQUIVALENT MUTANT — measured, and the reason a test suite staying green on
  // that edit is not a coverage gap. Move the assignment AFTER the connect and
  // it is no longer equivalent: complementW stays 1, TransformBlock emits the
  // full affine `<bones> * vec4(normal, 1.0)`, and the bone TRANSLATION column
  // enters the lighting normal — every actor's shading flattening toward the
  // origin direction the further it walks from it. The line is written first so
  // it states the intent explicitly rather than relying on Babylon's name
  // table, and `actorNMEBones.test.js`'s source pin is what catches the move.
  //
  // THIS LINE IS THE ONE THE HEADER IS ABOUT. It must read `bones.output`, the
  // same matrix worldPos reads, and NOT the raw `world` uniform. TransformBlock
  // with complementW = 0 builds `mat3(<transform>)` (inverse-transposed under
  // `#ifdef NONUNIFORMSCALING`), so feeding it `world` alone silently drops the
  // bone rotation from the normal while keeping it in the position: geometry
  // that bends under lighting that does not. Nothing downstream can detect it —
  // the normal is still unit-length, still non-zero, still plausibly oriented.
  const worldNormal = new BABYLON.TransformBlock('worldNormal');
  worldNormal.complementW = 0;
  normal.connectTo(worldNormal);
  bones.output.connectTo(worldNormal.transform);

  const wvp = new BABYLON.TransformBlock('wvp');
  worldPos.output.connectTo(wvp.vector);
  viewProjection.output.connectTo(wvp.transform);
  const vertexOutput = new BABYLON.VertexOutputBlock('vertexOutput');
  wvp.output.connectTo(vertexOutput.vector);

  // ── Fragment stage ─────────────────────────────────────────────────────────
  // Albedo = baked vertex colour x the tint UNIFORM. gen/actorGen.js always
  // emits colours (propPrimitives.finalize writes RGBA per vertex, alpha pinned
  // at 1) — but "always" is a property of today's generator, not of the shader,
  // and `color` is the one attribute Babylon emits UNGUARDED. So the guard is
  // compiled in rather than assumed: MeshAttributeExistsBlock emits
  //
  //     #ifdef VERTEXCOLOR_NME
  //     vec4 albedoSrc = v_color;        // byte-identical to the unguarded form
  //     #else
  //     vec4 albedoSrc = u_uAlbedoFallback;
  //     #endif
  //
  // and Babylon sets VERTEXCOLOR_NME itself from `mesh.useVertexColors &&
  // mesh.isVerticesDataPresent(ColorKind)` — BOTH halves of the contract, held
  // by the engine per mesh. When colours exist the emitted code is exactly what
  // it was before this block existed, so the dark end of the archetype palettes
  // is untouched; this is a compile-time branch, not a floor blended into the
  // colour. A mesh that arrives colourless renders white, which is wrong but
  // visible, diagnosable, and not a silhouette-shaped hole in the world.
  const albedoFallback = new BABYLON.InputBlock('uAlbedoFallback');
  albedoFallback.value = new BABYLON.Color4(
    ALBEDO_FALLBACK.r, ALBEDO_FALLBACK.g, ALBEDO_FALLBACK.b, ALBEDO_FALLBACK.a,
  );
  const safeColor = new BABYLON.MeshAttributeExistsBlock('safeColor');
  safeColor.attributeType = BABYLON.MeshAttributeExistsBlockTypes.VertexColor;
  vColor.output.connectTo(safeColor.input);
  albedoFallback.output.connectTo(safeColor.fallback);

  const colorSplit = new BABYLON.VectorSplitterBlock('colorSplit');
  safeColor.output.connectTo(colorSplit.xyzw);
  const tint = new BABYLON.InputBlock('uActorTint');
  tint.value = new BABYLON.Color3(DEFAULT_TINT.r, DEFAULT_TINT.g, DEFAULT_TINT.b);
  const albedo = new BABYLON.MultiplyBlock('albedo');
  colorSplit.xyzOut.connectTo(albedo.left);
  tint.output.connectTo(albedo.right);

  // A DELIBERATE DEVIATION from terrainNME/propNME, which feed LightBlock a raw
  // world normal. Babylon's LightBlock does not normalize (`vec3 normalW =
  // <input>.xyz;` verbatim), and terrain chunks and prop carriers are never
  // scaled, so raw is harmless there. Actors are the realm's only meshes that
  // live under a parent TransformNode and may be scaled, and a scaled world
  // matrix changes the normal's length — which would read as an actor getting
  // brighter as it gets bigger. Normalizing also undoes the shortening that
  // barycentric interpolation causes across the wide-angle capsule facets
  // actors are made of.
  //
  // It is NOT, however, "the identity, so it cannot regress" — that claim was
  // wrong and PR review caught it. `normal` carries Babylon's own
  // `#else vec3 normal = vec3(0.);` fallback, so a mesh with no normal buffer
  // feeds a ZERO vector in, and `normalize(vec3(0))` is `0 * inversesqrt(0)` =
  // `0 * Inf` = NaN — which would propagate through shade, clamp and fog and
  // out to the fragment. That is strictly worse than the raw version, which
  // degraded to ambient-only: dark but visible. Worse still, the attribute
  // guard cannot see it, because with NORMAL undefined `normal` is not in the
  // required attribute list at all.
  //
  // So: divide by max(length, eps) instead of calling normalize. Unit normals
  // are unchanged, short interpolated normals are rescaled, and a zero normal
  // divides to zero — restoring exactly the graceful ambient-only degradation
  // the raw version had. NaN is unreachable.
  //
  // Non-uniform scale is fine too, and the "the rig must not scale
  // non-uniformly" contract this file used to hand Task 8 is stricter than it
  // needs to be: the TransformBlock above already emits
  // `#ifdef NONUNIFORMSCALING <m>_NUS = transposeMat3(inverseMat3(<m>_NUS));`,
  // so the DIRECTION is correct under non-uniform scale and the rescale below
  // supplies the unit LENGTH that inverse-transpose does not preserve. `<m>` is
  // the BonesBlock's output now rather than `u_world` — the mat3 is taken from
  // whatever matrix drives the transform, so the bone rotation is inside it and
  // the NONUNIFORMSCALING correction still applies to the mesh scale it is
  // computed from.
  const normalLength = new BABYLON.LengthBlock('normalLength');
  worldNormal.output.connectTo(normalLength.value);
  const normalEps = new BABYLON.InputBlock('normalEps');
  normalEps.value = NORMAL_LENGTH_EPS;
  normalEps.isConstant = true; // folded into the source; costs no uniform slot
  const normalLengthSafe = new BABYLON.MaxBlock('normalLengthSafe');
  normalLength.output.connectTo(normalLengthSafe.left);
  normalEps.output.connectTo(normalLengthSafe.right);
  const litNormal = new BABYLON.DivideBlock('litNormal');
  worldNormal.output.connectTo(litNormal.left);
  normalLengthSafe.output.connectTo(litNormal.right);

  const cameraPosition = new BABYLON.InputBlock('cameraPosition');
  cameraPosition.setAsSystemValue(BABYLON.NodeMaterialSystemValues.CameraPosition);
  const lights = new BABYLON.LightBlock('lights');
  worldPos.output.connectTo(lights.worldPosition);
  litNormal.output.connectTo(lights.worldNormal);
  cameraPosition.output.connectTo(lights.cameraPosition);

  // `lights.shadow` STAYS UNCONNECTED. Babylon's own `lightFragment` include
  // computes `diffuseBase += info.diffuse * shadow` per light, and
  // LightBlock.diffuseOutput IS that accumulated diffuseBase — cast-shadow
  // attenuation is already folded in before this graph sees the value.
  // Multiplying `lights.shadow` (the separate aggShadow output) on top squares
  // the attenuation and makes shadows read far too dark: the P4c
  // double-multiply, caught in review, pinned by test in every material since.
  const ambientColor = new BABYLON.InputBlock('ambientColor');
  ambientColor.value = new BABYLON.Color3(DEFAULT_AMBIENT.r, DEFAULT_AMBIENT.g, DEFAULT_AMBIENT.b);
  const shade = new BABYLON.AddBlock('shade');
  lights.diffuseOutput.connectTo(shade.left);
  ambientColor.output.connectTo(shade.right);
  const shadeClamped = new BABYLON.ClampBlock('shadeClamped');
  shadeClamped.minimum = 0;
  shadeClamped.maximum = SHADE_CEILING;
  shade.output.connectTo(shadeClamped.value);

  const lit = new BABYLON.MultiplyBlock('lit');
  albedo.output.connectTo(lit.left);
  shadeClamped.output.connectTo(lit.right);

  // Scene fog — actors must fade with distance exactly as terrain and props do,
  // or they pop out of the depth cue as bright cutouts at range.
  const view = new BABYLON.InputBlock('view');
  view.setAsSystemValue(BABYLON.NodeMaterialSystemValues.View);
  const fogColor = new BABYLON.InputBlock('fogColor');
  fogColor.setAsSystemValue(BABYLON.NodeMaterialSystemValues.FogColor);
  const fog = new BABYLON.FogBlock('fog');
  worldPos.output.connectTo(fog.worldPosition);
  view.output.connectTo(fog.view);
  lit.output.connectTo(fog.input);
  fogColor.output.connectTo(fog.fogColor);

  // .rgb only — never .a. Writing alpha is the first step to needing blending.
  const fragmentOutput = new BABYLON.FragmentOutputBlock('fragmentOutput');
  fog.output.connectTo(fragmentOutput.rgb);

  nm.addOutputNode(vertexOutput);
  nm.addOutputNode(fragmentOutput);

  return new Promise((resolve, reject) => {
    nm.onBuildObservable.addOnce(() => {
      resolve({ material: nm });
    });
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[actorNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}
