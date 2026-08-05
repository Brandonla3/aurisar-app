import { describe, expect, it } from 'vitest';
import {
  CAMERA_CELL_M, PROP_TIER, TIER_BANDS_M, TIER_HYST_M,
  cameraCellOf, cellCenter, diffTiers, tierForChunk,
} from './propLod.js';

describe('cameraCellOf', () => {
  it('every position inside one cell maps to the same cell', () => {
    const a = cameraCellOf(0.1, 0.1);
    const b = cameraCellOf(CAMERA_CELL_M - 0.1, CAMERA_CELL_M - 0.1);
    expect(a).toEqual(b);
  });

  it('negative coordinates floor correctly (no cell 0 straddle)', () => {
    expect(cameraCellOf(-0.1, -0.1)).toEqual({ cellX: -1, cellZ: -1 });
  });
});

describe('tierForChunk — first classification', () => {
  const cell = cameraCellOf(32, 32); // camera near chunk (0,0)'s center

  it('the chunk underfoot is NEAR', () => {
    expect(tierForChunk(cell, 0, 0)).toBe(PROP_TIER.NEAR);
  });

  it('a chunk ~2 rings out is MID', () => {
    expect(tierForChunk(cell, 2, 0)).toBe(PROP_TIER.MID);
  });

  it('a chunk 4+ rings out is FAR (drop-shipped: renders nothing)', () => {
    expect(tierForChunk(cell, 4, 0)).toBe(PROP_TIER.FAR);
  });
});

describe('the camera-cell invariant — motion inside a cell changes nothing', () => {
  it('every camera position within one cell produces identical tiers for every chunk', () => {
    const positions = [
      [64.1, 64.1], [71.9, 64.1], [64.1, 71.9], [71.9, 71.9], [68, 68],
    ];
    const cells = positions.map(([x, z]) => cameraCellOf(x, z));
    for (const c of cells) expect(c).toEqual(cells[0]);
    // Same cell in → same function of (cell, chunk) out. The property is
    // structural (tiers read the CELL, never the raw camera), but pin it.
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const t0 = tierForChunk(cells[0], cx, cz);
        for (const c of cells) expect(tierForChunk(c, cx, cz)).toBe(t0);
      }
    }
  });
});

describe('hysteresis — no thrash at band boundaries', () => {
  it('a chunk sitting exactly at the NEAR/MID edge holds its tier as the camera dithers', () => {
    // Chunk (2,0) center = (160, 32). NEAR band ends at 96m: stand so the
    // distance oscillates a hair around 96 across a CELL boundary.
    // Cells at x=63.9 vs 64.1 differ; distances differ by ~8m — inside the
    // 12m hysteresis, so the tier must hold whichever way it started.
    const cellA = cameraCellOf(63.9, 32);
    const cellB = cameraCellOf(64.1, 32);
    let tier = tierForChunk(cellA, 2, 0, null);
    for (let i = 0; i < 20; i++) {
      const next = tierForChunk(i % 2 === 0 ? cellB : cellA, 2, 0, tier);
      expect(next).toBe(tier);
      tier = next;
    }
  });

  it('genuinely walking away DOES demote: NEAR -> MID -> FAR', () => {
    let tier = tierForChunk(cameraCellOf(32, 32), 0, 0, null);
    expect(tier).toBe(PROP_TIER.NEAR);
    tier = tierForChunk(cameraCellOf(32 + TIER_BANDS_M.nearMaxM + TIER_HYST_M + 20, 32), 0, 0, tier);
    expect(tier).toBe(PROP_TIER.MID);
    tier = tierForChunk(cameraCellOf(32 + TIER_BANDS_M.midMaxM + TIER_HYST_M + 20, 32), 0, 0, tier);
    expect(tier).toBe(PROP_TIER.FAR);
  });

  it('walking back promotes again', () => {
    let tier = PROP_TIER.FAR;
    tier = tierForChunk(cameraCellOf(32, 32), 0, 0, tier);
    expect(tier).toBe(PROP_TIER.NEAR);
  });
});

describe('diffTiers — the batched crossing', () => {
  const chunks = [];
  for (let cx = -2; cx <= 2; cx++) {
    for (let cz = -2; cz <= 2; cz++) chunks.push({ cx, cz, id: `${cx},${cz}` });
  }

  it('first call assigns every chunk (all changes)', () => {
    const { next, changes } = diffTiers(new Map(), chunks, cameraCellOf(32, 32));
    expect(next.size).toBe(chunks.length);
    expect(changes.length).toBe(chunks.length);
  });

  it('repeating the same cell yields ZERO changes', () => {
    const cell = cameraCellOf(32, 32);
    const first = diffTiers(new Map(), chunks, cell);
    const second = diffTiers(first.next, chunks, cell);
    expect(second.changes).toEqual([]);
  });

  it('one cell step changes only the chunks whose band actually moved', () => {
    const first = diffTiers(new Map(), chunks, cameraCellOf(32, 32));
    const second = diffTiers(first.next, chunks, cameraCellOf(32 + CAMERA_CELL_M, 32));
    // An 8m step can strand at most the boundary chunks; most hold steady
    // thanks to hysteresis. The exact count varies; the point is it's a
    // small subset, not a full reassignment.
    expect(second.changes.length).toBeLessThan(chunks.length / 3);
    for (const ch of second.changes) {
      expect(ch.from).not.toBe(ch.to);
    }
  });
});
