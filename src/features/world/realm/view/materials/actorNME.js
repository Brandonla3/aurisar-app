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
 * There is no code path — not a missed buffer, not a missed call — that turns
 * an actor black. actorNME.test.js enforces this MECHANICALLY rather than by
 * inspection: it compiles the material against a mesh carrying only what
 * gen/actorGen.js produces (position/normal/color) and asserts the resulting
 * effect demands no attribute that mesh does not supply. Re-wiring the tint as
 * an attribute makes that assertion fail — verified by mutation, not assumed.
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
 * @returns {Promise<{material: object, applyTint: (c: {r,g,b}) => void}>}
 *   resolves once the build has ACTUALLY completed — `NodeMaterial.build()` is
 *   async in Babylon 9.x, returns immediately and finishes on a later task, so
 *   onBuildObservable is the only honest completion signal and
 *   onBuildErrorObservable the only place a bad graph reports.
 *
 *   `applyTint` writes the one shared tint uniform. It is MATERIAL-GLOBAL, not
 *   per-actor: every actor draws with this single material, so this is a
 *   scene-wide knob (a mood grade, a debug wash), never faction colour. Faction
 *   identity is baked into vertex colour by gen/actorGen.js. Per-actor tinting
 *   would need either a cloned material per actor (a draw-call regression this
 *   phase's budget explicitly forbids) or an instanced attribute (the exact
 *   black-actor trap above).
 */
export function buildActorMaterial(scene, {
  name = 'realmActor',
  shaderLanguage = null,
} = {}) {
  const nm = new BABYLON.NodeMaterial(name, scene);
  if (shaderLanguage !== null) nm.shaderLanguage = shaderLanguage;

  // ── Vertex stage: the plain transform chain ────────────────────────────────
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

  const worldPos = new BABYLON.TransformBlock('worldPos');
  position.connectTo(worldPos);
  world.output.connectTo(worldPos.transform);

  // w = 0: normals rotate with the world matrix but never translate.
  const worldNormal = new BABYLON.TransformBlock('worldNormal');
  worldNormal.complementW = 0;
  normal.connectTo(worldNormal);
  world.output.connectTo(worldNormal.transform);

  const wvp = new BABYLON.TransformBlock('wvp');
  worldPos.output.connectTo(wvp.vector);
  viewProjection.output.connectTo(wvp.transform);
  const vertexOutput = new BABYLON.VertexOutputBlock('vertexOutput');
  wvp.output.connectTo(vertexOutput.vector);

  // ── Fragment stage ─────────────────────────────────────────────────────────
  // Albedo = baked vertex colour x the tint UNIFORM. `color` is the only
  // attribute in the fragment path and gen/actorGen.js always emits it
  // (propPrimitives.finalize writes RGBA per vertex, alpha pinned at 1).
  const colorSplit = new BABYLON.VectorSplitterBlock('colorSplit');
  vColor.output.connectTo(colorSplit.xyzw);
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
  // matrix lengthens the normal — which would read as an actor getting brighter
  // as it gets bigger. Normalizing also undoes the shortening that barycentric
  // interpolation causes across the wide-angle capsule facets actors are made
  // of. On an unscaled unit normal it is the identity, so it can only help.
  // (Non-uniform scale would still need an inverse-transpose; the rig does not
  // do non-uniform scale, and that is Task 8's contract to keep.)
  const litNormal = new BABYLON.NormalizeBlock('litNormal');
  worldNormal.output.connectTo(litNormal.input);

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
      resolve({
        material: nm,
        applyTint: (c) => {
          tint.value = new BABYLON.Color3(c.r, c.g, c.b);
        },
      });
    });
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[actorNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}
