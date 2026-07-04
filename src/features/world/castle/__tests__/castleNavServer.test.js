import { describe, it, expect, beforeAll } from 'vitest';
import { buildNav } from '../castleNav.js';
import { INTERIOR_ANCHOR, ENTRY } from '../castlePlan.js';
import {
  isInInteriorBounds, isWalkableColumn, castleMoveAllowed,
} from '../castleNavServer.js';

describe('castleNavServer', () => {
  let nav;

  beforeAll(() => {
    nav = buildNav(INTERIOR_ANCHOR);
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
});
