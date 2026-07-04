import { describe, it, expect, beforeAll } from 'vitest';
import { buildNav } from '../castleNav.js';
import { stampNavBlockers } from '../castleNavBlockers.js';
import { createSurfaceQuery, interiorResolveMove, sameInteriorFloor } from '../castleNavSurface.js';
import { INTERIOR_ANCHOR, LEVELS, ROOMS, PLAN_SCALE } from '../castlePlan.js';
import { roomCenterWorld } from '../castleNav.js';

const AX = INTERIOR_ANCHOR.x, AZ = INTERIOR_ANCHOR.z;

describe('castleNavSurface parity', () => {
  let nav;
  let surface;

  beforeAll(() => {
    nav = buildNav(INTERIOR_ANCHOR);
    stampNavBlockers(nav);
    surface = createSurfaceQuery(nav);
  });

  it('matches buildNav().surfaceAt at room centers on each level', () => {
    for (const room of ROOMS) {
      const c = roomCenterWorld(room.id);
      const y = LEVELS[room.level].y;
      expect(surface.surfaceAt(c.x, c.z, y + 0.5)).toEqual(nav.surfaceAt(c.x, c.z, y + 0.5));
    }
  });

  it('stacked floors do not bleed across levels', () => {
    const c = roomCenterWorld('library');
    const y3 = LEVELS[3].y;
    expect(surface.surfaceAt(c.x, c.z, y3 + 0.2)?.level).toBe(3);
    const s2 = surface.surfaceAt(c.x, c.z, LEVELS[2].y + 0.2);
    expect(s2?.level).toBeLessThan(3);
  });

  it('rejects wall mass that column-OR would allow on upper void', () => {
    expect(nav.surfaceAt(6.5 + AX, -38 + AZ, LEVELS[2].y + 0.5)).toBeNull();
    expect(surface.surfaceAt(6.5 + AX, -38 + AZ, LEVELS[2].y + 0.5)).toBeNull();
  });

  it('dungeon void blocks ground floor at ballroom center column', () => {
    expect(surface.surfaceAt(22 * PLAN_SCALE + AX, -5 * PLAN_SCALE + AZ, LEVELS[1].y)).toBeNull();
  });

  it('interiorResolveMove matches buildNav().resolveMove', () => {
    const dining = ROOMS.find((r) => r.id === 'diningHall').rect;
    const cx = (dining.x0 + dining.x1) / 2 + AX;
    const cz = (dining.z0 + dining.z1) / 2 + AZ;
    const y = LEVELS[1].y;
    const prevX = cx - 1.5;
    const prevZ = cz;
    const pos = { x: cx, y, z: cz + 3.4 };
    nav.resolveMove(prevX, prevZ, pos);
    const moved = interiorResolveMove(surface.surfaceAt, prevX, prevZ, pos.x, pos.z, y);
    expect(moved.x).toBeCloseTo(pos.x, 5);
    expect(moved.z).toBeCloseTo(pos.z, 5);
    expect(moved.floorYM).toBeCloseTo(pos.y, 5);
  });

  it('sameInteriorFloor matches level hysteresis band', () => {
    expect(sameInteriorFloor(LEVELS[1].y, LEVELS[1].y + 0.4)).toBe(true);
    expect(sameInteriorFloor(LEVELS[1].y, LEVELS[2].y)).toBe(false);
  });

  it('ground refY resolves ground floor at stacked columns, not treasury height', () => {
    const treasury = ROOMS.find((r) => r.id === 'treasury').rect;
    const cx = (treasury.x0 + treasury.x1) / 2 + AX;
    const cz = (treasury.z0 + treasury.z1) / 2 + AZ;
    const groundRefY = LEVELS[1].y;
    const atGround = surface.surfaceAt(cx, cz, groundRefY);
    const atTreasury = surface.surfaceAt(cx, cz, LEVELS[4].y);
    expect(atGround?.level).toBeLessThan(4);
    expect(atTreasury?.level).toBe(4);
    expect(atGround?.y).not.toBeCloseTo(LEVELS[4].y, 0);
  });
});
