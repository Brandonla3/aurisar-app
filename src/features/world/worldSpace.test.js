import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PX_PER_M, WORLD_ORIGIN_PX, toWorld, toStdb,
  DEFAULT_PLAYABLE_RADIUS_M, mapBounds,
} from './worldSpace.js';
import { streamingParams, tileBounds } from './streaming/tileMath.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

describe('worldSpace — STDB px <-> world meters', () => {
  it('origin maps world 0 <-> STDB 1600', () => {
    expect(toWorld(WORLD_ORIGIN_PX)).toBe(0);
    expect(toStdb(0)).toBe(WORLD_ORIGIN_PX);
    expect(WORLD_ORIGIN_PX).toBe(1600);
    expect(PX_PER_M).toBe(32);
  });

  it('round-trips integer meters through the px grid exactly', () => {
    for (const m of [-520, -180, -1, 0, 1, 180, 520]) {
      expect(toWorld(toStdb(m))).toBe(m);
    }
  });

  it('one meter is PX_PER_M px', () => {
    expect(toStdb(1) - toStdb(0)).toBe(PX_PER_M);
  });
});

describe('worldSpace — mapBounds', () => {
  it('returns square, origin-centered disc bounds', () => {
    expect(mapBounds(520)).toEqual({ minX: -520, minZ: -520, maxX: 520, maxZ: 520 });
  });

  it('defaults to DEFAULT_PLAYABLE_RADIUS_M', () => {
    expect(mapBounds()).toEqual(mapBounds(DEFAULT_PLAYABLE_RADIUS_M));
    expect(mapBounds(undefined)).toEqual(mapBounds(DEFAULT_PLAYABLE_RADIUS_M));
  });

  it('falls back on a non-positive or non-finite radius (no arc()/NaN hazard)', () => {
    for (const bad of [0, -1, -520, NaN, Infinity, -Infinity]) {
      expect(mapBounds(bad)).toEqual(mapBounds(DEFAULT_PLAYABLE_RADIUS_M));
    }
  });
});

describe('worldSpace — client/server constant parity', () => {
  // These constants are baked into live SpacetimeDB rows; the client (worldSpace)
  // and the server (spacetimedb/src/index.ts) keep separate copies across the
  // module boundary. This guard fails if they ever silently drift.
  const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');
  const num = (re) => Number(server.match(re)?.[1]);

  it('WORLD_CENTER_PX matches worldSpace WORLD_ORIGIN_PX', () => {
    expect(num(/WORLD_CENTER_PX\s*=\s*(\d+)/)).toBe(WORLD_ORIGIN_PX);
  });

  it('PX_PER_M matches worldSpace PX_PER_M', () => {
    expect(num(/const\s+PX_PER_M\s*=\s*(\d+)/)).toBe(PX_PER_M);
  });
});

describe('streaming bounds — off-by-48 fix', () => {
  const cfg = JSON.parse(
    readFileSync(join(repoRoot, 'src/features/world/config/world_build_config.json'), 'utf8'));
  const params = streamingParams(cfg);

  it('grid span equals cols * tile_size (2048 m), not the stated 2000', () => {
    expect(params.cols * params.tileSize).toBe(2048);
    expect(params.maxX - params.minX).toBe(2048);
  });

  it('far corner tile T_07_07 reaches +1048; origin tile still starts at -1000', () => {
    expect(tileBounds('T_07_07', params).max).toEqual({ x: 1048, z: 1048 });
    expect(tileBounds('T_00_00', params).min).toEqual({ x: -1000, z: -1000 });
  });
});

describe('World Map framing — disc excludes teleport interiors', () => {
  // The full-screen map frames to the playable disc, NOT the off-disc interior
  // anchors (x = 840 / 1000 / 1300). Mirrors mapRender.buildWorldMapCanvas's
  // worldToPx (which needs a canvas, unavailable in the node test env), so we
  // assert the same projection arithmetic against mapBounds.
  const R = 520, size = 640;
  const b = mapBounds(R);
  const projX = (x) => ((x - b.minX) / (b.maxX - b.minX)) * size;

  it('player at the origin projects to the map center', () => {
    expect(projX(0)).toBeCloseTo(size / 2, 6);
  });

  it('interior anchors project off-canvas (require the off-map indicator)', () => {
    for (const x of [840, 1000, 1300]) expect(projX(x)).toBeGreaterThan(size);
  });
});
