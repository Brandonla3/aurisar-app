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

/**
 * @returns {Promise<object>} resolves with the material once its build has
 *   actually completed. `NodeMaterial.build()` is ASYNC in Babylon 9.18 — it
 *   returns immediately and finishes on a later task (discovered the hard way:
 *   a sync read after build() sees half-initialised state). Awaiting
 *   onBuildObservable is the only honest completion signal, and
 *   onBuildErrorObservable is the only place a bad shader graph reports.
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

  // shade = ambient + diffuse; lit = albedo * shade. Specular is deliberately
  // absent — matte painted ground, and one less thing to differ per backend.
  const ambientColor = new BABYLON.InputBlock('ambientColor');
  ambientColor.value = new BABYLON.Color3(ambient.r, ambient.g, ambient.b);
  const shade = new BABYLON.AddBlock('shade');
  lights.diffuseOutput.connectTo(shade.left);
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

  // Scene fog — the EXP2 depth cue is core to the look, so the material must
  // participate or terrain pops against everything else that fogs.
  const view = new BABYLON.InputBlock('view');
  view.setAsSystemValue(BABYLON.NodeMaterialSystemValues.View);
  const fogColor = new BABYLON.InputBlock('fogColor');
  fogColor.setAsSystemValue(BABYLON.NodeMaterialSystemValues.FogColor);
  const fog = new BABYLON.FogBlock('fog');
  worldPos.output.connectTo(fog.worldPosition);
  view.output.connectTo(fog.view);
  lit.output.connectTo(fog.input);
  fogColor.output.connectTo(fog.fogColor);

  const fragmentOutput = new BABYLON.FragmentOutputBlock('fragmentOutput');
  fog.output.connectTo(fragmentOutput.rgb);

  nm.addOutputNode(vertexOutput);
  nm.addOutputNode(fragmentOutput);

  return new Promise((resolve, reject) => {
    nm.onBuildObservable.addOnce(() => resolve(nm));
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[terrainNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}
