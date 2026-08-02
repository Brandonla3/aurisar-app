/**
 * skyDomeNME — the sky as ONE opaque draw.
 *
 * Dome, sun glow, and stars composite inside a single fragment function —
 * no stacked transparent layers, no blending, so a tile GPU shades each sky
 * pixel exactly once and early-Z kills everything the terrain already won
 * (opaque queue sorts front-to-back; the infinite dome sorts last).
 *
 * The gradient body comes from model/skyModel.js's emitGradientBsl() — the
 * SAME constants table the CPU FogDriver evaluates. That is the seam
 * guarantee: this material and scene.fogColor cannot disagree at the horizon
 * because they are two emitters of one definition.
 *
 * Stance colors arrive as uniforms every frame from the FogDriver's single
 * skyState evaluation. Time never enters this shader; it is a pure function
 * of (view direction, stance uniforms), which keeps it trivially warm across
 * stance transitions — uniforms change, the program never rebuilds.
 */

/* global BABYLON */

import { RealmFnBlock } from './bsl/RealmFnBlock.js';
import { emitGradientBsl } from '../../model/skyModel.js';

/** One function: gradient + glow + stars. Stars ride the same draw. */
function createSkyPaintBlock() {
  return new RealmFnBlock('skyPaint', {
    fnName: 'realmSkyPaint',
    params: [
      { name: 'dir', type: 'vec3' },
      { name: 'sunDir', type: 'vec3' },
      { name: 'horizonC', type: 'vec3' },
      { name: 'midC', type: 'vec3' },
      { name: 'zenithC', type: 'vec3' },
      { name: 'glowC', type: 'vec3' },
      { name: 'starVis', type: 'float' },
    ],
    returnType: 'vec3',
    helpers: `
float realmSkyHash(vec2 p)
{
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

vec3 realmSkyGradient(float elev, float sunDot, vec3 horizonC, vec3 midC, vec3 zenithC, vec3 glowC)
{${emitGradientBsl()}
}`,
    body: `
    vec3 d = normalize(dir);
    float elev = clamp(d.y, 0.0, 1.0);
    float sunDot = dot(d, sunDir);
    vec3 c = realmSkyGradient(elev, sunDot, horizonC, midC, zenithC, glowC);

    float sunDisc = smoothstep(0.9995, 0.99985, sunDot);
    c = c + glowC * sunDisc * 6.0;

    vec2 cell = floor(d.xz / max(0.012, 0.012 * (1.0 - d.y * 0.5)) * 40.0);
    float star = step(0.9975, realmSkyHash(cell)) * smoothstep(0.05, 0.25, d.y);
    float twinkle = 0.75 + 0.25 * realmSkyHash(cell + vec2(7.0, 3.0));
    c = c + vec3(0.9, 0.93, 1.0) * star * twinkle * starVis;

    return c;`,
  });
}

/**
 * @returns {Promise<{material: object, applyState: (s) => void}>}
 *   `applyState` copies a skyState's fields onto the material's uniforms —
 *   the FogDriver calls it with the SAME object it derived fog from.
 */
export function buildSkyDomeMaterial(scene, { name = 'realmSky', shaderLanguage = null } = {}) {
  const nm = new BABYLON.NodeMaterial(name, scene);
  if (shaderLanguage !== null) nm.shaderLanguage = shaderLanguage;
  // The dome must ignore scene fog (it IS the fog's far field) and needs no
  // lighting — its light is painted.
  nm.backFaceCulling = false;

  const position = new BABYLON.InputBlock('position');
  position.setAsAttribute('position');
  const world = new BABYLON.InputBlock('world');
  world.setAsSystemValue(BABYLON.NodeMaterialSystemValues.World);
  const viewProjection = new BABYLON.InputBlock('viewProjection');
  viewProjection.setAsSystemValue(BABYLON.NodeMaterialSystemValues.ViewProjection);

  const worldPos = new BABYLON.TransformBlock('worldPos');
  position.connectTo(worldPos);
  world.output.connectTo(worldPos.transform);
  const wvp = new BABYLON.TransformBlock('wvp');
  worldPos.output.connectTo(wvp.vector);
  viewProjection.output.connectTo(wvp.transform);
  const vertexOutput = new BABYLON.VertexOutputBlock('vertexOutput');
  wvp.output.connectTo(vertexOutput.vector);

  // View direction: worldPos - cameraPos. The dome is camera-centered and
  // infiniteDistance, so this is numerically stable at any world coordinate.
  const cameraPosition = new BABYLON.InputBlock('cameraPosition');
  cameraPosition.setAsSystemValue(BABYLON.NodeMaterialSystemValues.CameraPosition);
  const posXYZ = new BABYLON.VectorSplitterBlock('posXYZ');
  worldPos.output.connectTo(posXYZ.xyzw);
  const dir = new BABYLON.SubtractBlock('dir');
  posXYZ.xyzOut.connectTo(dir.left);
  cameraPosition.output.connectTo(dir.right);

  const uniform = (uname, value) => {
    const b = new BABYLON.InputBlock(uname);
    b.value = value;
    return b;
  };
  const sunDir = uniform('sunDir', new BABYLON.Vector3(0, 1, 0));
  const horizonC = uniform('horizonC', new BABYLON.Color3(0.7, 0.8, 0.9));
  const midC = uniform('midC', new BABYLON.Color3(0.4, 0.6, 0.85));
  const zenithC = uniform('zenithC', new BABYLON.Color3(0.2, 0.35, 0.65));
  const glowC = uniform('glowC', new BABYLON.Color3(0.3, 0.25, 0.15));
  const starVis = uniform('starVis', 0);

  const paint = createSkyPaintBlock();
  dir.output.connectTo(paint.input('dir'));
  sunDir.output.connectTo(paint.input('sunDir'));
  horizonC.output.connectTo(paint.input('horizonC'));
  midC.output.connectTo(paint.input('midC'));
  zenithC.output.connectTo(paint.input('zenithC'));
  glowC.output.connectTo(paint.input('glowC'));
  starVis.output.connectTo(paint.input('starVis'));

  const fragmentOutput = new BABYLON.FragmentOutputBlock('fragmentOutput');
  paint.output.connectTo(fragmentOutput.rgb);

  nm.addOutputNode(vertexOutput);
  nm.addOutputNode(fragmentOutput);

  return new Promise((resolve, reject) => {
    nm.onBuildObservable.addOnce(() => {
      const applyState = (s) => {
        sunDir.value.copyFromFloats(s.sunDir[0], s.sunDir[1], s.sunDir[2]);
        horizonC.value.copyFromFloats(...s.stops.horizon);
        midC.value.copyFromFloats(...s.stops.mid);
        zenithC.value.copyFromFloats(...s.stops.zenith);
        glowC.value.copyFromFloats(...s.stops.glow);
        starVis.value = s.starVisibility;
      };
      resolve({ material: nm, applyState });
    });
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[skyDomeNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}

/** The dome mesh: camera-locked, depth-write off, never pickable. */
export function createSkyDome(scene, material) {
  const dome = BABYLON.MeshBuilder.CreateSphere('realmSkyDome', {
    diameter: 1000, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE,
  }, scene);
  dome.material = material;
  dome.infiniteDistance = true; // follows the camera, sorts to the far end
  dome.isPickable = false;
  dome.applyFog = false;
  // Never write depth: the sky must not occlude anything, ever.
  material.disableDepthWrite = true;
  return dome;
}
