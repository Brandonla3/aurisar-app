import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE_M,
  chunkBounds,
  chunkId,
  diffChunks,
  neededChunksAround,
  parseChunkId,
  worldToChunk,
} from './chunkMath.js';

describe('chunk addressing', () => {
  it('round-trips ids', () => {
    expect(parseChunkId(chunkId(-3, 7))).toEqual({ cx: -3, cz: 7 });
  });

  it('maps world positions to chunks, negatives included', () => {
    expect(worldToChunk(10, 10)).toEqual({ cx: 0, cz: 0 });
    expect(worldToChunk(64, 0)).toEqual({ cx: 1, cz: 0 });
    // floor, not trunc: -1m is chunk -1, not chunk 0. Truncation would make
    // four chunks share the origin and double-load around it.
    expect(worldToChunk(-1, -1)).toEqual({ cx: -1, cz: -1 });
  });

  it('bounds tile the plane without gaps', () => {
    const a = chunkBounds(0, 0);
    const b = chunkBounds(1, 0);
    expect(a.maxX).toBe(b.minX);
    expect(a.maxX - a.minX).toBe(CHUNK_SIZE_M);
  });
});

describe('neededChunksAround', () => {
  it('returns the full Chebyshev square', () => {
    const set = neededChunksAround(0, 0, 2);
    expect(set).toHaveLength(25); // (2*2+1)^2
  });

  it('orders center-out so a budgeted loader builds underfoot first', () => {
    const set = neededChunksAround(0, 0, 3);
    expect(set[0].ring).toBe(0);
    for (let i = 1; i < set.length; i++) {
      expect(set[i].ring).toBeGreaterThanOrEqual(set[i - 1].ring);
    }
  });

  it('centers on the chunk containing the position', () => {
    const set = neededChunksAround(100, -100, 1);
    expect(set[0]).toMatchObject({ cx: 1, cz: -2, ring: 0 });
  });
});

describe('diffChunks', () => {
  const center = { cx: 0, cz: 0 };

  it('loads what is missing and nothing that is resident', () => {
    const needed = neededChunksAround(0, 0, 1);
    const resident = new Set(['0,0', '1,0']);
    const { toLoad } = diffChunks(resident, needed, { radius: 1, center });
    expect(toLoad.map((c) => c.id)).not.toContain('0,0');
    expect(toLoad).toHaveLength(7); // 9 needed - 2 resident
  });

  it('keeps a hysteresis ring instead of unloading at the load edge', () => {
    // Pacing along a chunk border must not thrash load/unload every step:
    // load radius 1, but a chunk at ring 2 survives (slack 1).
    const needed = neededChunksAround(0, 0, 1);
    const resident = new Set(['2,0', '3,0']);
    const { toUnload } = diffChunks(resident, needed, { radius: 1, unloadSlackRings: 1, center });
    expect(toUnload).not.toContain('2,0'); // ring 2 <= 1+1: kept
    expect(toUnload).toContain('3,0');     // ring 3 > 2: dropped
  });

  it('never unloads a needed chunk', () => {
    const needed = neededChunksAround(0, 0, 1);
    const resident = new Set(needed.map((n) => n.id));
    const { toUnload } = diffChunks(resident, needed, { radius: 1, center });
    expect(toUnload).toHaveLength(0);
  });
});
