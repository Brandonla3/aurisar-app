/**
 * horizonRingNME — a crag silhouette ring, painted by the sky, not the fog.
 *
 * This is the resolution to the fog double-booking conflict: rings never
 * wire in a FogBlock, so a near-tuned scene.fogDensity — however high, tuned
 * purely to hide the streamed-chunk edge — cannot wash them out. There was
 * never a distance-extinction term for it to saturate.
 *
 * Each ring tier gets its OWN small NodeMaterial (only 3 tiers exist; sharing
 * one material the way TerrainStreamer shares one for dozens of chunks buys
 * nothing here). The vertex/view-direction wiring is the SAME shared graph
 * skyDomeNME.js uses (bsl/standardVertex.js) — a ring's elevation must mean
 * exactly what the dome's elevation means, or the horizon where they meet
 * would visibly disagree. The paint itself calls the identical
 * realmSkyGradient BSL body the dome calls, so a ring at low elevation reads
 * the same color the fog washed the world to at h=0.
 *
 * Depth handling is the opposite of the dome's: rings are real, finite,
 * depth-WRITING geometry (default — nothing disabled here), so nearer
 * terrain correctly occludes a ring, and a ring correctly occludes the sky
 * dome behind it. The only ordering guarantee needed is that the dome must
 * draw FIRST — see skyDomeNME.js's RENDERING_GROUP for why and how.
 */

/* global BABYLON */

import { RealmFnBlock } from './bsl/RealmFnBlock.js';
import { emitGradientBsl } from '../../model/skyModel.js';
import { buildStandardVertexChain, buildViewDirection } from './bsl/standardVertex.js';
import { RENDERING_GROUP } from './skyDomeNME.js';

/** Reuses the dome's gradient body verbatim, then blends in an authored, per-tier darken. */
function createRingPaintBlock(darken) {
  return new RealmFnBlock('ringPaint', {
    fnName: 'realmRingPaint',
    params: [
      { name: 'dir', type: 'vec3' },
      { name: 'sunDir', type: 'vec3' },
      { name: 'horizonC', type: 'vec3' },
      { name: 'midC', type: 'vec3' },
      { name: 'zenithC', type: 'vec3' },
      { name: 'glowC', type: 'vec3' },
    ],
    returnType: 'vec3',
    helpers: `
vec3 realmSkyGradient(float elev, float sunDot, vec3 horizonC, vec3 midC, vec3 zenithC, vec3 glowC)
{${emitGradientBsl()}
}`,
    body: `
    vec3 d = normalize(dir);
    float elev = clamp(d.y, 0.0, 1.0);
    float sunDot = dot(d, sunDir);
    vec3 c = realmSkyGradient(elev, sunDot, horizonC, midC, zenithC, glowC);
    // Darken toward black, not toward a fixed color — keeps the silhouette
    // legible against every stance's palette without a second authored table.
    return c * (1.0 - ${darken.toFixed(4)});`,
  });
}

/**
 * @param {number} darken 0..1, authored per RING_TIERS entry
 * @returns {Promise<{material, applyState}>} applyState mirrors the dome's —
 *   same fields (minus starVisibility, which no ring needs), same call site.
 */
export function buildRingMaterial(scene, { name, darken, shaderLanguage = null }) {
  const nm = new BABYLON.NodeMaterial(name, scene);
  if (shaderLanguage !== null) nm.shaderLanguage = shaderLanguage;
  nm.backFaceCulling = false;

  const { worldPos, vertexOutput } = buildStandardVertexChain();
  const { dir } = buildViewDirection(worldPos);

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

  const paint = createRingPaintBlock(darken);
  dir.output.connectTo(paint.input('dir'));
  sunDir.output.connectTo(paint.input('sunDir'));
  horizonC.output.connectTo(paint.input('horizonC'));
  midC.output.connectTo(paint.input('midC'));
  zenithC.output.connectTo(paint.input('zenithC'));
  glowC.output.connectTo(paint.input('glowC'));

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
      };
      resolve({ material: nm, applyState });
    });
    nm.onBuildErrorObservable.addOnce((message) => {
      nm.dispose();
      reject(new Error(`[horizonRingNME] build failed: ${message}`));
    });
    nm.build(false);
  });
}

/**
 * One ring's geometry: a cylindrical strip at `radiusM`, `heightM/2` above
 * and below y=0, unwrapped over `segments` around the horizon. Real, opaque,
 * depth-writing (no disableDepthWrite — the opposite of the dome), fogless,
 * unpickable, and pinned to RENDERING_GROUP.RINGS so it always draws after
 * the sky.
 */
export function createRingMesh(scene, { id, radiusM, heightM }, material, segments = 64) {
  const mesh = BABYLON.MeshBuilder.CreateCylinder(`horizonRing_${id}`, {
    diameter: radiusM * 2,
    height: heightM,
    tessellation: segments,
    subdivisions: 1,
    sideOrientation: BABYLON.Mesh.BACKSIDE, // seen from inside the cylinder
  }, scene);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.applyFog = false;
  mesh.renderingGroupId = RENDERING_GROUP.RINGS;
  return mesh;
}

/**
 * Build all three authored ring tiers (model/horizonRings.js RING_TIERS) at
 * once. Returns one combined applyState so the FogDriver call site treats
 * "the ring kit" as a single reader, same shape as the dome.
 */
export async function buildHorizonRings(scene, tiers, { shaderLanguage = null } = {}) {
  const built = await Promise.all(tiers.map(async (tier) => {
    const { material, applyState } = await buildRingMaterial(scene, {
      name: `realmRing_${tier.id}`, darken: tier.darken, shaderLanguage,
    });
    const mesh = createRingMesh(scene, tier, material);
    return { tier, mesh, material, applyState };
  }));

  return {
    meshes: built.map((b) => b.mesh),
    applyState(s) {
      for (const b of built) b.applyState(s);
    },
    dispose() {
      for (const b of built) { b.mesh.dispose(); b.material.dispose(); }
    },
  };
}
