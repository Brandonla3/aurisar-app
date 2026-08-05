/**
 * propPlacement.test.js — determinism, ecology legibility, and the seam
 * contract, all measured on real output rather than trusted.
 */
import { describe, expect, it } from 'vitest';
import { createTerrainField } from './terrainField.js';
import { edgeBias, placeChunkProps } from './propPlacement.js';
import { DESIRE_LINES, ribbonWear } from './desireLines.js';

const field = createTerrainField();

/** All instances of some prototypes as {x, z} world points. */
function pointsOf(result, ids) {
  const pts = [];
  for (const id of ids) {
    const b = result.instances[id];
    if (!b) continue;
    for (let i = 0; i < b.count; i++) {
      pts.push({ x: b.matrices[i * 16 + 12], z: b.matrices[i * 16 + 14] });
    }
  }
  return pts;
}

const TREE_IDS = ['valeoak', 'cragpine', 'cragpine_hardy', 'cragpine_krum'];

describe('determinism — the multiplayer contract extends to ecology', () => {
  it('same chunk twice → byte-identical buffers', () => {
    const a = placeChunkProps(field, { cx: 2, cz: 1 });
    const b = placeChunkProps(field, { cx: 2, cz: 1 });
    expect(Object.keys(a.instances)).toEqual(Object.keys(b.instances));
    for (const id of Object.keys(a.instances)) {
      expect(a.instances[id].count).toBe(b.instances[id].count);
      expect(a.instances[id].matrices).toEqual(b.instances[id].matrices);
      expect(a.instances[id].tints).toEqual(b.instances[id].tints);
    }
  });

  it('buffer shapes are consistent with counts', () => {
    const r = placeChunkProps(field, { cx: 0, cz: 0 });
    for (const b of Object.values(r.instances)) {
      expect(b.matrices.length).toBe(b.count * 16);
      expect(b.tints.length).toBe(b.count * 3);
    }
  });

  it('a custom grass height lookup changes ONLY tuft heights, never decisions', () => {
    // The two-lookup-path contract: surfaceYAt is visual ground-snapping
    // for grass, never an accept input. If counts or any non-tuft buffer
    // change, a height value leaked into a placement decision.
    const exact = placeChunkProps(field, { cx: 1, cz: 1 });
    const offset = placeChunkProps(field, { cx: 1, cz: 1, surfaceYAt: (x, z) => field.surfaceY(x, z) + 5 });
    expect(Object.keys(offset.instances)).toEqual(Object.keys(exact.instances));
    for (const id of Object.keys(exact.instances)) {
      expect(offset.instances[id].count).toBe(exact.instances[id].count);
      if (id !== 'tuft') expect(offset.instances[id].matrices).toEqual(exact.instances[id].matrices);
    }
    // And tuft y (element 13) genuinely moved by the offset.
    const a = exact.instances.tuft;
    const b = offset.instances.tuft;
    expect(b.matrices[13]).toBeCloseTo(a.matrices[13] + 5, 5);
  });
});

describe('species land where the world says they should', () => {
  it('the vale-edge meadow grows valeoak and grass, not kummholz pines', () => {
    const r = placeChunkProps(field, { cx: 1, cz: 0 }); // 64-128m: meadow band
    expect(r.instances.tuft?.count ?? 0).toBeGreaterThan(200);
    expect(r.instances.cragpine_krum?.count ?? 0).toBe(0);
  });

  it('the mountain band grows pines and boulders', () => {
    const r = placeChunkProps(field, { cx: 4, cz: 3 }); // ~256-320m: crags
    const pines = (r.instances.cragpine?.count ?? 0)
      + (r.instances.cragpine_hardy?.count ?? 0)
      + (r.instances.cragpine_krum?.count ?? 0);
    expect(pines).toBeGreaterThan(0);
    expect(r.instances.boulder?.count ?? 0).toBeGreaterThan(0);
    expect(r.instances.valeoak?.count ?? 0).toBe(0);
  });

  it('grass thins hard in the high crags', () => {
    const meadow = placeChunkProps(field, { cx: 1, cz: 0 });
    const crags = placeChunkProps(field, { cx: 6, cz: 5 }); // ~384m+
    expect((crags.instances.tuft?.count ?? 0)).toBeLessThan((meadow.instances.tuft?.count ?? 0) * 0.4);
  });
});

describe('the occupancy grid reads as ecology', () => {
  it('grass is measurably suppressed under canopies vs open ground — across a 3x3 mosaic including cross-border pairs', () => {
    // THE legibility metric, and simultaneously the seam contract: trees
    // near a border are stamped into the neighbor's apron, so a tuft in
    // chunk B under a canopy that lives in chunk A must be as suppressed
    // as one under a same-chunk canopy. Computed as per-m² rates.
    const trees = [];
    const tufts = [];
    for (let cx = 0; cx <= 2; cx++) {
      for (let cz = 0; cz <= 2; cz++) {
        const r = placeChunkProps(field, { cx, cz });
        trees.push(...pointsOf(r, TREE_IDS));
        tufts.push(...pointsOf(r, ['tuft']));
      }
    }
    expect(trees.length).toBeGreaterThan(20);
    expect(tufts.length).toBeGreaterThan(1000);

    // Sort tufts into "under a canopy" (<1.6m of a trunk) vs "open"
    // (>5m from every trunk), then normalize by each zone's area.
    const R_UNDER = 1.6;
    const R_OPEN = 5;
    let under = 0;
    let open = 0;
    for (const t of tufts) {
      let nearest = Infinity;
      for (const tr of trees) {
        const d = Math.hypot(t.x - tr.x, t.z - tr.z);
        if (d < nearest) nearest = d;
      }
      if (nearest < R_UNDER) under++;
      else if (nearest > R_OPEN) open++;
    }
    const underArea = trees.length * Math.PI * R_UNDER * R_UNDER;
    const totalArea = 9 * 64 * 64;
    const openArea = totalArea - trees.length * Math.PI * R_OPEN * R_OPEN;
    const underRate = under / underArea;
    const openRate = open / openArea;
    expect(underRate).toBeLessThan(openRate * 0.55);
  });
});

describe('edge handshake', () => {
  it('is order-independent — both chunks derive the identical bias', () => {
    expect(edgeBias(3, 4, 4, 4, 99)).toBe(edgeBias(4, 4, 3, 4, 99));
    expect(edgeBias(-2, 7, -2, 6, 99)).toBe(edgeBias(-2, 6, -2, 7, 99));
  });

  it('varies by edge — not one global constant', () => {
    const a = edgeBias(0, 0, 1, 0, 99);
    const b = edgeBias(0, 0, 0, 1, 99);
    expect(a).not.toBe(b);
  });
});

describe('desire-line ribbons', () => {
  it('wear is 1 on the path, 0 far away, decreasing between', () => {
    const [x0, z0] = DESIRE_LINES[0].points[1];
    expect(ribbonWear(x0, z0)).toBe(1);
    expect(ribbonWear(x0 + 300, z0 + 300)).toBe(0);
    // Probe PERPENDICULAR to the local segment (the first version probed
    // +x, which runs nearly ALONG this segment — both probes measured "on
    // the path" and 1 > 1 failed). This line heads mostly +x, so +z is
    // near-perpendicular.
    const near = ribbonWear(x0, z0 + 4);
    const far = ribbonWear(x0, z0 + 7.5);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
    expect(far).toBe(0);
  });

  it('grass visibly thins along the ribbon', () => {
    // Self-calibrating: measure the corridor's share of the chunk area on a
    // sampling lattice, then require the tuft share on the corridor to be
    // meaningfully below it — worn, not bare (the wear multiplier is 0.6).
    const r = placeChunkProps(field, { cx: 1, cz: 0 });
    const tufts = pointsOf(r, ['tuft']);
    let corridorCells = 0;
    let cells = 0;
    for (let x = 64; x < 128; x++) {
      for (let z = 0; z < 64; z++) {
        cells++;
        if (ribbonWear(x + 0.5, z + 0.5) > 0.7) corridorCells++;
      }
    }
    const corridorFrac = corridorCells / cells;
    expect(corridorFrac).toBeGreaterThan(0.02); // the line genuinely crosses this chunk
    const onPath = tufts.filter((t) => ribbonWear(t.x, t.z) > 0.7).length;
    expect(onPath / tufts.length).toBeLessThan(corridorFrac * 0.7);
  });
});

describe('compass lean — every tree points away from the vale', () => {
  it('each tree matrix\'s local-Y axis tips radially outward', () => {
    const r = placeChunkProps(field, { cx: 2, cz: 2 });
    const trees = r.instances.valeoak ?? r.instances.cragpine;
    expect(trees.count).toBeGreaterThan(0);
    for (let i = 0; i < trees.count; i++) {
      const m = trees.matrices;
      const yAxisX = m[i * 16 + 4];
      const yAxisZ = m[i * 16 + 6];
      const px = m[i * 16 + 12];
      const pz = m[i * 16 + 14];
      // Horizontal component of the up axis, dotted with the radial dir:
      // positive = leaning outward (away from origin).
      const dot = yAxisX * px + yAxisZ * pz;
      expect(dot).toBeGreaterThan(0);
    }
  });
});
