import { describe, it, expect, beforeAll } from 'vitest';
import { buildNav } from '../castleNav.js';
import { stampNavBlockers } from '../castleNavBlockers.js';
import { INTERIOR_ANCHOR, ENTRY, ROOMS, LEVELS } from '../castlePlan.js';
import {
  isInInteriorBounds, isWalkableColumn, castleMoveAllowed,
} from '../castleNavServer.js';

describe('castleNavServer', () => {
  let nav;

  beforeAll(() => {
    nav = buildNav(INTERIOR_ANCHOR);
    stampNavBlockers(nav);
  });

  it('interior spawn column is walkable', () => {
    const wx = ENTRY.spawnLocal.x + INTERIOR_ANCHOR.x;
    const wz = ENTRY.spawnLocal.z + INTERIOR_ANCHOR.z;
    expect(isInInteriorBounds(wx, wz)).toBe(true);
    expect(castleMoveAllowed(nav, wx, wz)).toBe(true);
  });

  it('wall mass inside footprint is blocked', () => {
    // north edge of interior bounds — outside all room floor insets
    const wx = INTERIOR_ANCHOR.x;
    const wz = INTERIOR_ANCHOR.z + 43;
    expect(isInInteriorBounds(wx, wz)).toBe(true);
    expect(castleMoveAllowed(nav, wx, wz)).toBe(false);
  });

  it('overworld position skips castle validation', () => {
    expect(castleMoveAllowed(nav, 150, 20)).toBeNull();
  });

  it('isWalkableColumn matches nav grid non-zero cells', () => {
    expect(isWalkableColumn(nav, ENTRY.spawnLocal.x + INTERIOR_ANCHOR.x,
      ENTRY.spawnLocal.z + INTERIOR_ANCHOR.z)).toBe(true);
  });

  it('furniture blockers are stamped on the dining floor grid', () => {
    const dining = ROOMS.find((r) => r.id === 'diningHall').rect;
    const cx = (dining.x0 + dining.x1) / 2;
    const cz = (dining.z0 + dining.z1) / 2 + 3.4;
    const { colOf, rowOf } = nav._local;
    const idx = rowOf(cz) * nav.cols + colOf(cx);
    expect(nav.grids[1][idx]).toBe(0);
    expect(nav.surfaceAt(cx + INTERIOR_ANCHOR.x, cz + INTERIOR_ANCHOR.z, LEVELS[1].y + 0.3)).toBeNull();
  });
});
