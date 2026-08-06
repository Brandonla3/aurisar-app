/**
 * realmBudget.test.js — P5's exit bar: the draw-call/triangle/fill census,
 * computed as pure arithmetic over the deterministic placement function and
 * the declared cost manifests. No GPU anywhere; CI is the referee.
 *
 * The worst-case sweep itself — nine adversarial cameras, sticky-NEAR tier
 * billing, the real shipping FOV — now lives in model/propCensus.js
 * (`worstPropCensus`), not here. It moved out in P6 Task 6 so
 * realmActorBudget.test.js (the actor half of the same scene budget) could
 * import the SAME computation instead of hand-copying its output: a
 * hardcoded snapshot had already drifted once (model/propBudget.js's own
 * header comment says triangles worst 567,602; this computation measures
 * 567,286) — proof a hand-copied number is exactly what "budgets are tests,
 * not comments" forbids. This file is now the thin caller that asserts the
 * result against BUDGET_CEILINGS and keeps the `[census]` log output; see
 * propCensus.js for the sweep itself and its own header for why the nine
 * cameras are the ones they are.
 *
 * Ceilings are set from these measured actuals plus headroom (the test
 * logs them) — a regression must be real to trip one, and a deliberate
 * content expansion has to raise a ceiling consciously, in review.
 */
import { describe, expect, it } from 'vitest';
import { createTerrainField } from './model/terrainField.js';
import { placeChunkProps } from './model/propPlacement.js';
import { BUDGET_CEILINGS } from './model/propBudget.js';
import { worstPropCensus } from './model/propCensus.js';
import {
  CAMERA_CELL_M, PROP_TIER, cameraCellOf, diffTiers,
} from './model/propLod.js';
import { DEFAULT_STREAM_RADIUS_CHUNKS, neededChunksAround } from './model/chunkMath.js';

const field = createTerrainField();

/** Placement cache used by the rebuild-per-crossing walk below. The
 *  per-camera worst-case sweep (draw calls / triangles / fill) now lives in
 *  model/propCensus.js's `worstPropCensus`, which builds and owns its own
 *  cache — two independent caches over the same deterministic placement
 *  function reproduce identical numbers either way, so this file keeping its
 *  own cache for the rebuild walk changes nothing about what either test
 *  measures. */
const placements = new Map();
function placementOf(cx, cz) {
  const id = `${cx},${cz}`;
  if (!placements.has(id)) placements.set(id, placeChunkProps(field, { cx, cz }));
  return placements.get(id);
}

describe('the P5 budget census — adversarial cameras, hard ceilings', () => {
  it('every camera stays under every ceiling (and logs the actuals)', () => {
    const worst = worstPropCensus();
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
