/**
 * cloudPuffs — the visible half of P4c's "clouds without a renderer" design.
 *
 * model/cloudShadow.js's cloudFactorAt already sells "weather is changing"
 * through light alone; this module adds a cheap visible shape to point at —
 * a handful of flattened, unlit spheres that drift slowly in XZ and wrap
 * when they exit WRAP_RADIUS_M, reusing horizonRings.js's own near-tier
 * radius rather than inventing new spawn geometry. Each puff samples
 * cloudFactorAt at its own small time offset for its visibility, so
 * neighboring puffs never thicken or thin in lockstep — the SAME pure
 * function the FogDriver's ambient dip reads, not a second one that could
 * drift out of sync with it.
 *
 * Deliberately NOT spatially correlated with the ambient dip: no puff casts
 * a located ground shadow, and no puff's position feeds back into
 * cloudFactorAt. The P4c design pass judged temporal correlation (same
 * nowMs, comparable period) sufficient for a dip-and-a-drifting-puff to read
 * as one phenomenon — a real ground-following shadow was named an explicit
 * upgrade path, not part of this build.
 *
 * Unlit on purpose (disableLighting, emissive-only): these are meant to read
 * as soft, bright shapes regardless of the current stance's light color, the
 * same reason the sky dome and horizon rings never take scene lighting.
 * Real, depth-writing geometry — unlike the dome — so a nearer ring or
 * terrain crest can still correctly occlude a puff (RENDERING_GROUP.CLOUDS
 * draws after RINGS; see skyDomeNME.js).
 */

/* global BABYLON */

import { cloudFactorAt, MIN_FACTOR, MAX_FACTOR } from '../../model/cloudShadow.js';
import { RENDERING_GROUP } from '../materials/skyDomeNME.js';
import { RING_TIERS } from '../../model/horizonRings.js';

/** Puffs wrap well inside the near ring, not out at the horizon — "overhead
 *  weather", not "distant crags". Reusing horizonRings.js's own tier means
 *  this radius moves with the streaming radius exactly the way the rings do. */
export const WRAP_RADIUS_M = RING_TIERS[0].radiusM;

/** Above every ring tier's crest (tallest authored tier is 300m) — clouds
 *  read as higher than the horizon silhouettes, never mixed into them. */
const HEIGHT_BASE_M = 340;
const HEIGHT_SPREAD_M = 60;

const DEFAULT_COUNT = 12;
/** Slow: a cloud should read as drifting, not blowing past. */
const DRIFT_MPS = 0.6;

/** Where a wrapped puff re-enters, as a fraction of WRAP_RADIUS_M — comfortably
 *  inside it, not AT it, so a puff that wraps while still moving outward
 *  doesn't immediately re-trigger the wrap check next frame. */
const REENTRY_FRACTION = 0.92;

/**
 * Deterministic per-puff placement and drift from its index alone — no
 * Math.random, matching the rest of the Realm's seeded-not-random
 * discipline (model/noise.js). Golden-ratio-spaced fractional jitter keeps
 * puffs from landing in a visibly regular ring or lockstep phase.
 */
function paramsForIndex(i, count) {
  const frac = (mult) => (i * mult) % 1;
  const angle = (i / count) * Math.PI * 2;
  const radius = WRAP_RADIUS_M * (0.35 + 0.6 * frac(0.61803398875));
  const speed = DRIFT_MPS * (0.6 + 0.8 * frac(0.38196601125));
  const heading = angle + Math.PI / 2 + frac(0.7548776662) * 0.6;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    y: HEIGHT_BASE_M + frac(0.4142135624) * HEIGHT_SPREAD_M,
    vx: Math.cos(heading) * speed,
    vz: Math.sin(heading) * speed,
    // A few seconds to under a minute apart — enough that neighbors visibly
    // decorrelate without ever drifting so far apart the group reads as
    // patternless noise instead of "the same weather, slightly staggered".
    offsetMs: Math.round(frac(0.2360679775) * 45_000),
    diameterM: 14 + frac(0.246) * 10,
  };
}

/**
 * @returns {{meshes, update: (centerX, centerZ, nowMs) => void, dispose: () => void}}
 *   `update` should be called every frame, same as horizonRings.js's
 *   `recenter` — but unlike rings (static geometry that only needs to
 *   follow the camera), puffs keep drifting between calls, so `update` both
 *   integrates motion AND performs the wrap check every call.
 */
export function buildCloudPuffs(scene, { count = DEFAULT_COUNT } = {}) {
  // Same depth-clear hazard horizonRingNME.js already documents and fixes
  // for RINGS, one group further out: every rendering group auto-clears
  // depth/stencil by default except group 0, so without this, group 2
  // (CLOUDS) would render against a freshly-cleared depth buffer — losing
  // the depth terrain (group 0) and rings (group 1) already wrote — and a
  // puff could incorrectly draw over nearer geometry that should occlude it.
  scene.setRenderingAutoClearDepthStencil(RENDERING_GROUP.CLOUDS, false);

  const material = new BABYLON.StandardMaterial('realmCloudPuff', scene);
  material.disableLighting = true;
  material.emissiveColor = new BABYLON.Color3(0.94, 0.95, 0.97);
  material.diffuseColor = BABYLON.Color3.Black();
  material.specularColor = BABYLON.Color3.Black();
  material.backFaceCulling = false;

  const puffs = [];
  for (let i = 0; i < count; i++) {
    const p = paramsForIndex(i, count);
    const mesh = BABYLON.MeshBuilder.CreateSphere(`cloudPuff_${i}`, {
      segments: 8, diameter: p.diameterM,
    }, scene);
    mesh.scaling.y = 0.32; // flattened, not a ball
    mesh.material = material;
    mesh.isPickable = false;
    // The ambient dip already carries "it's cloudy" — scene fog on the
    // puffs themselves would double-book the same story a second way.
    mesh.applyFog = false;
    mesh.renderingGroupId = RENDERING_GROUP.CLOUDS;
    mesh.position.set(p.x, p.y, p.z);
    puffs.push({
      mesh, vx: p.vx, vz: p.vz, offsetMs: p.offsetMs,
    });
  }

  let lastMs = null;

  return {
    meshes: puffs.map((p) => p.mesh),
    update(centerX, centerZ, nowMs) {
      const dtS = lastMs === null ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;

      for (const p of puffs) {
        p.mesh.position.x += p.vx * dtS;
        p.mesh.position.z += p.vz * dtS;

        const dx = p.mesh.position.x - centerX;
        const dz = p.mesh.position.z - centerZ;
        const dist = Math.hypot(dx, dz);
        if (dist > WRAP_RADIUS_M) {
          // Re-enter on the OPPOSITE side, at REENTRY_FRACTION of the radius —
          // not a same-distance mirror through center, which would just place
          // an already-past-the-edge puff an equal distance past the edge on
          // the far side. Wraps relative to wherever the player IS, not world
          // origin (dx/dz are already center-relative).
          const scale = -(WRAP_RADIUS_M * REENTRY_FRACTION) / dist;
          p.mesh.position.x = centerX + dx * scale;
          p.mesh.position.z = centerZ + dz * scale;
        }

        // Each puff's own offset into the SAME cloudFactorAt the ambient dip
        // reads — local overcast reads as a more solid puff, local clear as
        // fainter, without a second "how cloudy is it" function to drift out
        // of sync with the first. Normalized against cloudFactorAt's ACTUAL
        // range (real bug this fixes: the previous formula multiplied the
        // raw (1 - tint) term — which only ever spans [0, 1 - MIN_FACTOR],
        // i.e. [0, 0.45] — as though it already spanned [0, 1], so visibility
        // topped out around 0.575 instead of the intended ~0.85, and puffs
        // read as a near-invisible, low-contrast smudge against a similarly
        // pale sky. Caught by comparing an actual rendered pixel against the
        // background in the browser, not by any unit test.
        const tint = cloudFactorAt(nowMs + p.offsetMs);
        const overcastNorm = (MAX_FACTOR - tint) / (MAX_FACTOR - MIN_FACTOR); // 0..1
        p.mesh.visibility = 0.5 + overcastNorm * 0.45;
      }
    },
    dispose() {
      for (const p of puffs) p.mesh.dispose();
      material.dispose();
    },
  };
}
