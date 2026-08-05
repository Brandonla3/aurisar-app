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

/** The highest point the field grows within playable range — the widest
 *  sightline camera. Coarse scan; determinism makes it stable. */
function findRidge() {
  let best = { x: 0, z: 0, y: -Infinity };
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    for (const r of [280, 340, 400, 460]) {
      const x = Math.cos(t) * r;
      const z = Math.sin(t) * r;
      const y = field.surfaceY(x, z);
      if (y > best.y) best = { x, z, y };
    }
  }
  return best;
}

/** Census one camera position: live prop buckets, triangles, fill. */
function census(camX, camZ) {
  const cell = cameraCellOf(camX, camZ);
  const resident = neededChunksAround(camX, camZ, DEFAULT_STREAM_RADIUS_CHUNKS);
  let drawCalls = 0;
  let triangles = 0;
  let fillScreens = 0;
  for (const ch of resident) {
    const tier = tierForChunk(cell, ch.cx, ch.cz, null);
    if (tier === PROP_TIER.FAR) continue;
    const placed = placementOf(ch.cx, ch.cz);
    const centerX = (ch.cx + 0.5) * CHUNK_SIZE_M;
    const centerZ = (ch.cz + 0.5) * CHUNK_SIZE_M;
    const dist = Math.max(8, Math.hypot(centerX - camX, centerZ - camZ));
    // Screen area at this distance for a 60-degree vertical FOV, 16:9 —
    // the analytic fill proxy the fillScreens ceiling is denominated in.
    const screenM2 = (2 * dist * Math.tan(Math.PI / 6)) ** 2 * (16 / 9);
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
  const ridge = findRidge();
  const cameras = [
    [32, 32, 'spawn'],
    [0, 0, 'origin 4-corner'],
    [128, 128, 'belt 4-corner'],
    [192, 192, 'belt 4-corner deep'],
    [256, 256, 'crag 4-corner'],
    [192, 64, 'belt corner asym'],
    [256, 0, 'crag axis corner'],
    [ridge.x, ridge.z, 'highest ridge'],
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
      const x = 96 + step * CAMERA_CELL_M;
      const z = 128;
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
