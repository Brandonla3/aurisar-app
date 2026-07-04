import { describe, it, expect, beforeAll } from 'vitest';
import { buildNav } from '../castleNav.js';
import { stampNavBlockers } from '../castleNavBlockers.js';
import { createSurfaceQuery } from '../castleNavSurface.js';
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
});
