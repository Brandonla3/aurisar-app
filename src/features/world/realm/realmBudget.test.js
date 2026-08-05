/**
 * realmBudget.test.js — P5's exit bar: the draw-call/triangle/fill census,
 * computed as pure arithmetic over the deterministic placement function and
 * the declared cost manifests. No GPU anywhere; CI is the referee.
 *
 * The census does not sample polite cameras. It sweeps the structural worst
 * cases — four-chunk corner junctions in the forest belt (where per-chunk
 * bucketing multiplies), the spawn vale, and the highest ridge the field
 * grows (the widest sightline) — and asserts the ARGMAX against the
 * ceilings in model/propBudget.js. An undeclared prototype fails the audit
 * outright: freight does not move without paperwork.
 *
 * Ceilings are set from these measured actuals plus headroom (the test
 * logs them) — a regression must be real to trip one, and a deliberate
 * content expansion has to raise a ceiling consciously, in review.
 */
import { describe, expect, it } from 'vitest';
import { createTerrainField } from './model/terrainField.js';
import { placeChunkProps } from './model/propPlacement.js';
import { BUDGET_CEILINGS, PROP_MANIFEST } from './model/propBudget.js';
import { PROTOTYPES } from './model/propGenomes.js';
import {
  CAMERA_CELL_M, PROP_TIER, cameraCellOf, diffTiers, tierForChunk,
} from './model/propLod.js';
import { CHUNK_SIZE_M, DEFAULT_STREAM_RADIUS_CHUNKS, neededChunksAround } from './model/chunkMath.js';

const field = createTerrainField();

/** Placement cache — cameras share chunks; place each exactly once. */
const placements = new Map();
function placementOf(cx, cz) {
  const id = `${cx},${cz}`;
  if (!placements.has(id)) placements.set(id, placeChunkProps(field, { cx, cz }));
  return placements.get(id);
}

/**
 * Census one camera position: live prop buckets, triangles, fill.
 *
 * Two model-vs-renderer mismatches caught in PR review, both fixed here:
 *  - Tiers are classified with prev = NEAR (maximum hysteresis stickiness),
 *    not the cold-start `null` branch. The streamer feeds previous tiers
 *    back through the Schmitt trigger, so on any outward walk a chunk stays
 *    NEAR to nearMaxM + HYST and MID to midMaxM + HYST — the cold-start
 *    census billed stage-1 costs for chunks the renderer draws at stage 0.
 *    Sticky-NEAR is the reachable worst case, so the census now bounds it.
 *  - The fill proxy uses the SHIPPING camera's field of view. spike.js
 *    never sets fov, so Babylon's default 0.8 rad vertical applies — the
 *    previous 60-degree assumption under-billed fill by 1.87x.
 */
const CAMERA_FOV_RAD = 0.8; // Babylon default; spike.js never overrides it
function census(camX, camZ) {
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
      expect(manifest, `prototype "${protoId}" placed but UNDECLARED in PROP_MANIFEST`).toBeTruthy();
      const stage = Math.min(tier, proto.stages - 1);
      drawCalls += 1;
      triangles += bucket.count * manifest[stage].tris;
      fillScreens += (bucket.count * manifest[stage].silhouetteM2) / screenM2;
    }
  }
  return { drawCalls, triangles, fillScreens };
}

describe('the P5 budget census — adversarial cameras, hard ceilings', () => {
  // Chunk CENTERS maximize the resident-in-band count under Chebyshev
  // streaming (a 4-corner camera is actually the LOW-count configuration —
  // another review catch); corners still sampled for bucket diversity. The
  // former "highest ridge" camera is gone: census math never reads camera
  // Y, so it sampled nothing the others didn't.
  const cameras = [
    [32, 32, 'spawn center'],
    [0, 0, 'origin 4-corner'],
    [96, 96, 'meadow chunk-center'],
    [160, 160, 'belt chunk-center'],
    [224, 224, 'crag chunk-center'],
    [128, 128, 'belt 4-corner'],
    [192, 192, 'belt 4-corner deep'],
    [224, 96, 'belt center asym'],
    [256, 0, 'crag axis corner'],
  ];

  it('every camera stays under every ceiling (and logs the actuals)', () => {
    let worst = { drawCalls: 0, triangles: 0, fillScreens: 0, at: {} };
    for (const [x, z, label] of cameras) {
      const c = census(x, z);
      if (c.drawCalls > worst.drawCalls) { worst.drawCalls = c.drawCalls; worst.at.drawCalls = label; }
      if (c.triangles > worst.triangles) { worst.triangles = c.triangles; worst.at.triangles = label; }
      if (c.fillScreens > worst.fillScreens) { worst.fillScreens = c.fillScreens; worst.at.fillScreens = label; }
    }
    // The evidence the ceilings were set from — keep logging so a future
    // retune reads numbers, not folklore.
    console.log('[census] worst:', JSON.stringify(worst));
    expect(worst.drawCalls).toBeLessThanOrEqual(BUDGET_CEILINGS.drawCalls);
    expect(worst.triangles).toBeLessThanOrEqual(BUDGET_CEILINGS.triangles);
    expect(worst.fillScreens).toBeLessThanOrEqual(BUDGET_CEILINGS.fillScreens);
  });

  it('a worst-case walk never rebuilds more carriers per cell crossing than the ceiling', () => {
    // March straight through the forest belt — the densest bucket zone —
    // in single camera-cell steps, diffing tiers exactly the way the
    // PropStreamer does. Every crossing's change count is a real rebuild
    // batch; the max must stay under rebuildsPerCrossing.
    let prevTiers = new Map();
    let maxChanges = 0;
    for (let step = 0; step < 30; step++) {
      // Diagonal march: an 8m cell step diagonally moves 11.3m per crossing
      // — the worst adjacent-cell displacement, not the axis-aligned 8m
      // (review catch: the axis walk under-measured crossings).
      const x = 96 + step * CAMERA_CELL_M;
      const z = 96 + step * CAMERA_CELL_M;
      const resident = neededChunksAround(x, z, DEFAULT_STREAM_RADIUS_CHUNKS);
      const { next, changes } = diffTiers(prevTiers, resident, cameraCellOf(x, z));
      // Convert chunk-tier changes into carrier rebuilds: a change rebuilds
      // one carrier per prototype present in that chunk.
      let rebuilds = 0;
      for (const ch of changes) {
        if (ch.to === PROP_TIER.FAR && ch.from === null) continue; // never built
        rebuilds += Object.keys(placementOf(ch.cx, ch.cz).instances).length;
      }
      if (step > 0) maxChanges = Math.max(maxChanges, rebuilds); // step 0 = cold build, not a crossing
      prevTiers = next;
    }
    console.log('[census] worst rebuilds per crossing:', maxChanges);
    expect(maxChanges).toBeLessThanOrEqual(BUDGET_CEILINGS.rebuildsPerCrossing);
  });
});
