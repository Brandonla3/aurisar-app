/**
 * propNME — ONE material for every prop in the world.
 *
 * The entire prop set draws with a single NodeMaterial: albedo is vertex
 * color (baked by gen/propGen.js) times a per-INSTANCE tint, lit by the
 * scene's FogDriver-owned lights, fogged like terrain. One material means
 * thin-instance buckets never switch programs between prototypes — the
 * per-mob material churn diagnosed in the old world cannot exist here.
 *
 * OPAQUE-ONLY DISCIPLINE (load-bearing, not stylistic): no discard, no
 * alpha-test, no alpha-blend anywhere in this graph. Canopy silhouettes are
 * real vertices. A single discard silently forfeits per-pixel hidden-
 * surface removal for the whole pass on Apple TBDR hardware — the exact
 * mechanism behind the old world's #1 mobile killer (leaf-card overdraw).
 * propNME.test.js asserts the compiled fragment contains no discard and
 * needAlphaBlending() stays false.
 *
 * THE SPROUT: chunk reveal is a vertex-stage scale ramp about each prop's
 * ground point, driven by a per-instance `sproutBirth` attribute (stamped
 * by PropStreamer at build time) against a global `uNowMs` uniform — NOT a
 * per-chunk uniform, because many chunks share this one material and a
 * shared material cannot hold per-chunk state. Fail-open contract:
 * birth <= 0 means fully grown (a misbound attribute reads 0.0, so the
 * worst silent failure is props that skip their animation — never an
 * invisible world). Custom attributes MUST declare their connection-point
 * type at construction (InputBlock's third argument): an unknown attribute
 * name stays AutoDetect and the graph refuses to connect — found by probe,
 * pinned by test.
 */

/* global BABYLON */

import { RealmFnBlock } from './bsl/RealmFnBlock.js';
import { PROP_SPROUT_MS } from '../../model/chunkFade.js';

/** The sprout curve: fail-open on birth<=0, else an eased 0→1 growth. */
function createSproutScaleBlock() {
  return new RealmFnBlock('sproutScale', {
    fnName: 'realmSproutScale',
    params: [
      { name: 'birth', type: 'float' },
      { name: 'now', type: 'float' },
    ],
    returnType: 'float',
    body: `
    float t = clamp((now - birth) / ${PROP_SPROUT_MS.toFixed(1)}, 0.0, 1.0);
    float eased = t * t * (3.0 - 2.0 * t);
    return [birth <= 0.0 ? 1.0 : eased];`,
  });
}

/**
 * @returns {Promise<{material, applySproutClock: (nowMs) => void}>}
 *   applySproutClock advances the ONE clock uniform every material shares —
 *   called from the same render-loop site that drives the FogDriver.
 */
export function buildPropMaterial(scene, { name = 'realmProps', shaderLanguage = null } = {}) {
  const nm = new BABYLON.NodeMaterial(name, scene);
  if (shaderLanguage !== null) nm.shaderLanguage = shaderLanguage;
  const T = BABYLON.NodeMaterialBlockConnectionPointTypes;

  // ── Vertex stage ───────────────────────────────────────────────────────────
  const position = new BABYLON.InputBlock('position');
  position.setAsAttribute('position');
  const normal = new BABYLON.InputBlock('normal');
  normal.setAsAttribute('normal');
  const vColor = new BABYLON.InputBlock('color');
  vColor.setAsAttribute('color');
  // Custom instanced attributes: type EXPLICIT at construction (see header).
  const sproutBirth = new BABYLON.InputBlock('sproutBirth', undefined, T.Float);
  sproutBirth.setAsAttribute('sproutBirth');
  const instTint = new BABYLON.InputBlock('instTint', undefined, T.Vector3);
  instTint.setAsAttribute('instTint');

  const world = new BABYLON.InputBlock('world');
  world.setAsSystemValue(BABYLON.NodeMaterialSystemValues.World);
  const viewProjection = new BABYLON.InputBlock('viewProjection');
  viewProjection.setAsSystemValue(BABYLON.NodeMaterialSystemValues.ViewProjection);

  const uNowMs = new BABYLON.InputBlock('uNowMs');
  uNowMs.value = 0;

  const sprout = createSproutScaleBlock();
  sproutBirth.output.connectTo(sprout.input('birth'));
  uNowMs.output.connectTo(sprout.input('now'));

  // Scale LOCAL position about the prop's origin — every prototype is
  // authored base-at-ground, so growth rises out of the terrain.
  const grown = new BABYLON.ScaleBlock('grown');
  position.output.connectTo(grown.input);
  sprout.output.connectTo(grown.factor);

  const worldPos = new BABYLON.TransformBlock('worldPos');
  grown.output.connectTo(worldPos.vector);
  world.output.connectTo(worldPos.transform);

  // w = 0: rotate with the (per-instance) world matrix, never translate.
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
  const colorSplit = new BABYLON.VectorSplitterBlock('colorSplit');
  vColor.output.connectTo(colorSplit.xyzw);
  const albedo = new BABYLON.MultiplyBlock('albedo');
  colorSplit.xyzOut.connectTo(albedo.left);
  instTint.output.connectTo(albedo.right);

  const cameraPosition = new BABYLON.InputBlock('cameraPosition');
  cameraPosition.setAsSystemValue(BABYLON.NodeMaterialSystemValues.CameraPosition);
  const lights = new BABYLON.LightBlock('lights');
  worldPos.output.connectTo(lights.worldPosition);
  worldNormal.output.connectTo(lights.worldNormal);
  cameraPosition.output.connectTo(lights.cameraPosition);

  // diffuseOutput ALREADY folds cast-shadow attenuation per light — never
  // multiply lights.shadow on top (the P4c double-multiply lesson, learned
  // from Babylon's own lightFragment source).
  const ambientColor = new BABYLON.InputBlock('ambientColor');
  ambientColor.value = new BABYLON.Color3(0.30, 0.32, 0.30);
  const shade = new BABYLON.AddBlock('shade');
  lights.diffuseOutput.connectTo(shade.left);
  ambientColor.output.connectTo(shade.right);
  const shadeClamped = new BABYLON.ClampBlock('shadeClamped');
  shadeClamped.minimum = 0;
  shadeClamped.maximum = 1.08; // terrainNME's measured anti-blowout ceiling
  shade.output.connectTo(shadeClamped.value);

  const lit = new BABYLON.MultiplyBlock('lit');
  albedo.output.connectTo(lit.left);
  shadeClamped.output.connectTo(lit.right);

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
    nm.onBuildObservable.addOnce(() => {
      resolve({
        material: nm,
        applySproutClock: (nowMs) => { uNowMs.value = nowMs; },
      });
    });
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[propNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}
