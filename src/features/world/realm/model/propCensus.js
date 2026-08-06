/**
 * propCensus — the props budget census's WORST-CASE COMPUTATION, extracted
 * pure.
 *
 * realmBudget.test.js originally swept nine adversarial camera positions
 * inside a private closure with nothing exported. When P6 Task 6 needed the
 * SAME worst-case numbers to check the actor budget against the SAME scene
 * ceiling (realmActorBudget.test.js), the only options were re-deriving them
 * by hand or making this the one place that computes them — hand-copying was
 * rejected because it had ALREADY drifted once: model/propBudget.js's own
 * header comment says triangles worst 567,602, while this computation
 * measures 567,286. A hand-copied snapshot silently decoupling from the
 * computation it was copied from is exactly what "budgets are tests, not
 * comments" exists to prevent. One computation, every consumer imports it.
 *
 * PURE. The census math is unchanged from realmBudget.test.js's original
 * `census()`/sweep — sticky-NEAR hysteresis tier billing (the streamer feeds
 * previous tiers back through the Schmitt trigger, so on any outward walk a
 * chunk stays NEAR to nearMaxM + HYST and MID to midMaxM + HYST; billing the
 * cold-start `null` branch instead would under-bill the reachable worst
 * case), the shipping camera's real 0.8 rad vertical FOV (spike.js never
 * sets `fov`, so Babylon's default applies — a 60-degree assumption
 * under-billed fill by 1.87x), and the nine adversarial camera positions
 * (chunk CENTERS maximize the resident-in-band count under Chebyshev
 * streaming — a 4-corner camera is actually the LOW-count configuration;
 * corners are still sampled for bucket diversity). All of that is prior-review
 * evidence this file preserves rather than re-derives.
 *
 * The one behavioural adaptation from the original closure: it used vitest's
 * `expect(manifest, ...).toBeTruthy()` to fail the audit outright on an
 * undeclared prototype. A pure model/ file cannot import a test framework, so
 * this throws a plain Error instead — a caller inside a vitest `it()` sees
 * the identical outcome (the test fails with that message), and the shipped
 * roster never reaches this path at all (every PROTOTYPES entry has a
 * PROP_MANIFEST entry, enforced separately by propBudget.test.js's "no ghost
 * cargo" audit), so this change is unobservable in every census this file
 * has ever actually computed.
 */
import { createTerrainField } from './terrainField.js';
import { placeChunkProps } from './propPlacement.js';
import { PROP_MANIFEST } from './propBudget.js';
import { PROTOTYPES } from './propGenomes.js';
import { PROP_TIER, cameraCellOf, tierForChunk } from './propLod.js';
import { CHUNK_SIZE_M, DEFAULT_STREAM_RADIUS_CHUNKS, neededChunksAround } from './chunkMath.js';

/** Babylon's default vertical FOV — spike.js never overrides it. */
const CAMERA_FOV_RAD = 0.8;

/**
 * The nine adversarial camera positions the worst-case sweep checks.
 * Unchanged from realmBudget.test.js's original set: chunk centers dominate
 * the resident-in-band count under Chebyshev streaming (the review catch —
 * 4-corner cameras are actually the LOW-count configuration); corners are
 * kept for bucket diversity, not because they are the worst case.
 */
export const PROP_CENSUS_CAMERAS = Object.freeze([
  [32, 32, 'spawn center'],
  [0, 0, 'origin 4-corner'],
  [96, 96, 'meadow chunk-center'],
  [160, 160, 'belt chunk-center'],
  [224, 224, 'crag chunk-center'],
  [128, 128, 'belt 4-corner'],
  [192, 192, 'belt 4-corner deep'],
  [224, 96, 'belt center asym'],
  [256, 0, 'crag axis corner'],
]);

/** Placement cache — cameras within one sweep share chunks; place each
 *  exactly once per sweep. A fresh cache per `worstPropCensus()` call, not a
 *  module-level singleton, so repeated calls stay independent and pure. */
function makePlacementCache(field) {
  const placements = new Map();
  return (cx, cz) => {
    const id = `${cx},${cz}`;
    if (!placements.has(id)) placements.set(id, placeChunkProps(field, { cx, cz }));
    return placements.get(id);
  };
}

/**
 * Census one camera position: live prop buckets, triangles, fill. Byte-for-
 * byte the math realmBudget.test.js's original `census()` ran.
 */
function censusAt(placementOf, camX, camZ) {
  const cell = cameraCellOf(camX, camZ);
  const resident = neededChunksAround(camX, camZ, DEFAULT_STREAM_RADIUS_CHUNKS);
  let drawCalls = 0;
  let triangles = 0;
  let fillScreens = 0;
  for (const ch of resident) {
    const tier = tierForChunk(cell, ch.cx, ch.cz, PROP_TIER.NEAR);
    if (tier === PROP_TIER.FAR) continue;
    const placed = placementOf(ch.cx, ch.cz);
    const centerX = (ch.cx + 0.5) * CHUNK_SIZE_M;
    const centerZ = (ch.cz + 0.5) * CHUNK_SIZE_M;
    const dist = Math.max(8, Math.hypot(centerX - camX, centerZ - camZ));
    const screenM2 = (2 * dist * Math.tan(CAMERA_FOV_RAD / 2)) ** 2 * (16 / 9);
    for (const [protoId, bucket] of Object.entries(placed.instances)) {
      const proto = PROTOTYPES.find((p) => p.id === protoId);
      const manifest = PROP_MANIFEST[protoId];
      if (!manifest) throw new Error(`prototype "${protoId}" placed but UNDECLARED in PROP_MANIFEST`);
      const stage = Math.min(tier, proto.stages - 1);
      drawCalls += 1;
      triangles += bucket.count * manifest[stage].tris;
      fillScreens += (bucket.count * manifest[stage].silhouetteM2) / screenM2;
    }
  }
  return { drawCalls, triangles, fillScreens };
}

/**
 * The worst-case props census across all nine adversarial cameras — the
 * exact sweep realmBudget.test.js's "logs the actuals" test always ran, now
 * the one place that computes it. Builds its own terrain field and placement
 * cache per call; both are pure/deterministic (see terrainField.js,
 * propPlacement.js), so any two calls anywhere in the same process reproduce
 * byte-identical numbers.
 *
 * @returns {{drawCalls: number, triangles: number, fillScreens: number, at: object}}
 *   `at` names which camera produced each worst figure — independently, the
 *   three metrics do not necessarily peak at the same camera.
 */
export function worstPropCensus() {
  const field = createTerrainField();
  const placementOf = makePlacementCache(field);
  const worst = {
    drawCalls: 0, triangles: 0, fillScreens: 0, at: {},
  };
  for (const [x, z, label] of PROP_CENSUS_CAMERAS) {
    const c = censusAt(placementOf, x, z);
    if (c.drawCalls > worst.drawCalls) { worst.drawCalls = c.drawCalls; worst.at.drawCalls = label; }
    if (c.triangles > worst.triangles) { worst.triangles = c.triangles; worst.at.triangles = label; }
    if (c.fillScreens > worst.fillScreens) { worst.fillScreens = c.fillScreens; worst.at.fillScreens = label; }
  }
  return worst;
}
