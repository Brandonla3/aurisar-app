/**
 * terrainNME — the painted terrain material, built programmatically.
 *
 * Programmatic NodeMaterial rather than a .json snippet: CSP forbids the
 * snippet server, and a graph built in code is diffable, reviewable and
 * testable. The division of labour is deliberate —
 *
 *   stock blocks   transforms, lighting, fog: plumbing Babylon already ships
 *                  and keeps working across backends
 *   RealmFnBlock   the actual painting (slope/height splat, noise variation),
 *                  written once in BSL, transpiled per backend
 *
 * The graph builds under BOTH shader languages in CI via NullEngine (source
 * generation needs no GPU) — the WebGPU-only failure class the CustomBlock ban
 * exists for is caught by a unit test, not by a player with a new iPhone.
 */

/* global BABYLON */

import { createTerrainPaintBlock } from './bsl/terrainShaderLib.js';
import { selfShadowStrength } from '../../model/selfShadow.js';

/**
 * @returns {Promise<{material: object, applyState: (s) => void}>} resolves
 *   once the material's build has actually completed. `NodeMaterial.build()`
 *   is ASYNC in Babylon 9.18 — it returns immediately and finishes on a later
 *   task (discovered the hard way: a sync read after build() sees half-
 *   initialised state). Awaiting onBuildObservable is the only honest
 *   completion signal, and onBuildErrorObservable is the only place a bad
 *   shader graph reports. `applyState` mirrors the dome's and rings' shape —
 *   same skyState-derived call site, so FogDriver's single evaluation drives
 *   terrain's self-shadow strength alongside fog, sky and lights.
 */
export function buildTerrainMaterial(scene, {
  name = 'realmTerrain',
  ambient = { r: 0.30, g: 0.32, b: 0.30 },
  shaderLanguage = null, // null = whatever the engine dictates; tests force it
} = {}) {
  const nm = new BABYLON.NodeMaterial(name, scene);
  if (shaderLanguage !== null) nm.shaderLanguage = shaderLanguage;

  // ── Vertex stage: standard transform chain ─────────────────────────────────
  const position = new BABYLON.InputBlock('position');
  position.setAsAttribute('position');
  const normal = new BABYLON.InputBlock('normal');
  normal.setAsAttribute('normal');
  const world = new BABYLON.InputBlock('world');
  world.setAsSystemValue(BABYLON.NodeMaterialSystemValues.World);
  const viewProjection = new BABYLON.InputBlock('viewProjection');
  viewProjection.setAsSystemValue(BABYLON.NodeMaterialSystemValues.ViewProjection);

  const worldPos = new BABYLON.TransformBlock('worldPos');
  position.connectTo(worldPos);
  world.output.connectTo(worldPos.transform);

  // w = 0: normals rotate with the world matrix but never translate. Terrain
  // chunks are unscaled, so no inverse-transpose is needed.
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
  const posXYZ = new BABYLON.VectorSplitterBlock('posXYZ');
  worldPos.output.connectTo(posXYZ.xyzw);
  const nrmXYZ = new BABYLON.VectorSplitterBlock('nrmXYZ');
  worldNormal.output.connectTo(nrmXYZ.xyzw);
  const nrmUnit = new BABYLON.NormalizeBlock('nrmUnit');
  nrmXYZ.xyzOut.connectTo(nrmUnit.input);

  // The painting — one BSL function, transpiled per backend.
  const paint = createTerrainPaintBlock('paint');
  posXYZ.xyzOut.connectTo(paint.input('wpos'));
  nrmUnit.output.connectTo(paint.input('wnrm'));

  // Scene lights (the spike's directional key + hemi fill both feed this).
  const cameraPosition = new BABYLON.InputBlock('cameraPosition');
  cameraPosition.setAsSystemValue(BABYLON.NodeMaterialSystemValues.CameraPosition);
  const lights = new BABYLON.LightBlock('lights');
  worldPos.output.connectTo(lights.worldPosition);
  worldNormal.output.connectTo(lights.worldNormal);
  cameraPosition.output.connectTo(lights.cameraPosition);

  // Cast-shadow attenuation: LightBlock's `shadow` output is a SEPARATE port
  // from `diffuseOutput` — verified against the generated GLSL (the compiled
  // main() computes `diffuseOutput * shadow` explicitly; diffuseOutput alone
  // never includes it. Skipping this wire is silent: the graph still builds,
  // scene.receiveShadows still reads true, and terrain simply never darkens
  // under ANY cast shadow, from ActorShadowRig or anything else. Multiplied
  // into diffuse BEFORE ambient — real shadow maps attenuate direct light
  // only; ambient represents indirect/sky light a shadow map has no opinion
  // about, the same reason a real overcast day still has visible ambient
  // fill in a shadowed doorway.
  const shadowedDiffuse = new BABYLON.MultiplyBlock('shadowedDiffuse');
  lights.diffuseOutput.connectTo(shadowedDiffuse.left);
  lights.shadow.connectTo(shadowedDiffuse.right);

  // shade = ambient + shadowed diffuse; lit = albedo * shade. Specular is
  // deliberately absent — matte painted ground, and one less thing to differ
  // per backend.
  const ambientColor = new BABYLON.InputBlock('ambientColor');
  ambientColor.value = new BABYLON.Color3(ambient.r, ambient.g, ambient.b);
  const shade = new BABYLON.AddBlock('shade');
  shadowedDiffuse.output.connectTo(shade.left);
  ambientColor.output.connectTo(shade.right);
  // Clamp the shade term: scene lights are tuned for StandardMaterial's own
  // response curve, and summed diffuse+ambient easily exceeds 1 (the first
  // in-browser run rendered every green channel at a saturated 255). A hair
  // over 1.0 keeps sunlit slopes lively without letting them blow out.
  const shadeClamped = new BABYLON.ClampBlock('shadeClamped');
  shadeClamped.minimum = 0;
  shadeClamped.maximum = 1.08;
  shade.output.connectTo(shadeClamped.value);
  const lit = new BABYLON.MultiplyBlock('lit');
  paint.output.connectTo(lit.left);
  shadeClamped.output.connectTo(lit.right);

  // ── Self-shadow: a baked-at-gen-time recess proxy, scaled by how strongly
  // the CURRENT sun elevation should read it (model/terrainField.js's
  // shadeProxyAt and model/selfShadow.js's selfShadowStrength). The proxy
  // lives in vertex color (red channel only — g/b mirror it for a legible
  // raw-color debug read, see terrainChunkGen.js); strength arrives as a
  // per-frame uniform via applyState, below. Multiplying AFTER `lit` (not
  // into `paint`) means self-shadow darkens the fully-lit result rather than
  // fighting the diffuse/ambient blend upstream of it.
  const vColor = new BABYLON.InputBlock('color');
  vColor.setAsAttribute('color');
  const vColorSplit = new BABYLON.VectorSplitterBlock('vColorSplit');
  vColor.output.connectTo(vColorSplit.xyzw);

  const shadowStrength = new BABYLON.InputBlock('selfShadowStrength');
  shadowStrength.value = selfShadowStrength(1); // a reasonable default before the first applyState call
  const shadowAmount = new BABYLON.MultiplyBlock('shadowAmount');
  vColorSplit.x.connectTo(shadowAmount.left);
  shadowStrength.output.connectTo(shadowAmount.right);

  const one = new BABYLON.InputBlock('one');
  one.value = 1;
  const shadowFactor = new BABYLON.SubtractBlock('shadowFactor');
  one.output.connectTo(shadowFactor.left);
  shadowAmount.output.connectTo(shadowFactor.right);

  const litShadowed = new BABYLON.MultiplyBlock('litShadowed');
  lit.output.connectTo(litShadowed.left);
  shadowFactor.output.connectTo(litShadowed.right);

  // Scene fog — the EXP2 depth cue is core to the look, so the material must
  // participate or terrain pops against everything else that fogs.
  const view = new BABYLON.InputBlock('view');
  view.setAsSystemValue(BABYLON.NodeMaterialSystemValues.View);
  const fogColor = new BABYLON.InputBlock('fogColor');
  fogColor.setAsSystemValue(BABYLON.NodeMaterialSystemValues.FogColor);
  const fog = new BABYLON.FogBlock('fog');
  worldPos.output.connectTo(fog.worldPosition);
  view.output.connectTo(fog.view);
  litShadowed.output.connectTo(fog.input);
  fogColor.output.connectTo(fog.fogColor);

  const fragmentOutput = new BABYLON.FragmentOutputBlock('fragmentOutput');
  fog.output.connectTo(fragmentOutput.rgb);

  nm.addOutputNode(vertexOutput);
  nm.addOutputNode(fragmentOutput);

  return new Promise((resolve, reject) => {
    nm.onBuildObservable.addOnce(() => {
      const applyState = (s) => {
        shadowStrength.value = selfShadowStrength(s.sunDir[1]);
      };
      resolve({ material: nm, applyState });
    });
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[terrainNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}
