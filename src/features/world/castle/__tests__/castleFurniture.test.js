/**
 * Furniture nav-blocker drift-guards: run the REAL builders (against a
 * minimal BABYLON stub — they only touch mesh position/rotation/scaling
 * inside functions), stamp their recorded blockers into a fresh nav, and
 * prove the castle is still fully walkable. If a piece of furniture, a
 * column plinth, or a dungeon-cell bar line ever seals a room or a door,
 * this fails before anyone walks into it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildNav } from '../castleNav.js';
import {
  CASTLE_PLAN, LEVELS, ROOMS, ENTRY, INTERIOR_ANCHOR,
} from '../castlePlan.js';

const AX = INTERIOR_ANCHOR.x, AZ = INTERIOR_ANCHOR.z;

// Minimal BABYLON: every MeshBuilder.Create* returns an inert mesh record.
const fakeMesh = () => ({
  position: { set() {} },
  rotation: {},
  scaling: {},
  setEnabled() {},
  computeWorldMatrix() {},
  freezeWorldMatrix() {},
  isPickable: true,
  material: null,
});
beforeAll(() => {
  globalThis.BABYLON = {
    MeshBuilder: new Proxy({}, { get: () => () => fakeMesh() }),
    Mesh: { CAP_ALL: 0 },
    Vector3: class Vector3 {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      static Zero() { return new Vector3(); }
    },
  };
});

let nav;
let blockers;
beforeAll(async () => {
  const { createCollector } = await import('../builders/mergeUtil.js');
  const { createAllFurniture } = await import('../builders/furniture.js');
  const { dressStructuralRooms } = await import('../builders/rooms.js');
  const { createAllStaircases } = await import('../builders/staircase.js');
  const ctx = createCollector(null, {});
  dressStructuralRooms(ctx, AX, AZ);
  createAllStaircases(ctx, AX, AZ);
  createAllFurniture(ctx, AX, AZ);
  blockers = ctx.navBlockers;
  nav = buildNav();
  for (const b of blockers) nav.blockRect(b.level, b, b.expand);
});

describe('castle furniture nav blockers', () => {
  it('the builders actually record blockers', () => {
    expect(blockers.length).toBeGreaterThan(80); // beds, tables, columns, bars…
    for (const b of blockers) {
      expect(b.level).toBeGreaterThanOrEqual(0);
      expect(b.level).toBeLessThan(LEVELS.length);
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(b.z1).toBeGreaterThan(b.z0);
    }
  });

  it('every door strip stays passable with real furniture blocked', () => {
    for (const door of CASTLE_PLAN.doors) {
      if (door.b === 'EXTERIOR') continue;
      const level = ROOMS.find((r) => r.id === door.a).level;
      const y = LEVELS[level].y;
      const mid = (door.lo + door.hi) / 2;
      for (let off = -0.8; off <= 0.8; off += 0.2) {
        const x = door.edge === 'x' ? door.at + off : mid;
        const z = door.edge === 'x' ? mid : door.at + off;
        const s = nav.surfaceAt(x + AX, z + AZ, y + 0.3);
        expect(s, `door ${door.id} passable at off=${off.toFixed(1)}`).toBeTruthy();
      }
    }
  });

  it('BFS from the entrance still reaches every room around the furniture', () => {
    const start = {
      x: ENTRY.spawnLocal.x + AX,
      z: ENTRY.spawnLocal.z + AZ,
      y: LEVELS[1].y,
    };
    const s0 = nav.surfaceAt(start.x, start.z, start.y + 1);
    expect(s0, 'entrance spawn walkable').toBeTruthy();

    const { colOf, rowOf, cellX, cellZ } = nav._local;
    const key = (c, r, l) => (l * nav.rows + r) * nav.cols + c;
    const seen = new Set();
    const queue = [{
      c: colOf(start.x - AX), r: rowOf(start.z - AZ), y: s0.y, l: s0.level,
    }];
    seen.add(key(queue[0].c, queue[0].r, queue[0].l));
    const reachedLevels = new Set([s0.level]);
    const roomReached = new Map(ROOMS.map((r) => [r.id, false]));

    while (queue.length) {
      const cur = queue.pop();
      const lx = cellX(cur.c), lz = cellZ(cur.r);
      for (const room of ROOMS) {
        if (room.level !== cur.l || roomReached.get(room.id)) continue;
        if (lx >= room.rect.x0 && lx <= room.rect.x1 &&
            lz >= room.rect.z0 && lz <= room.rect.z1) {
          roomReached.set(room.id, true);
        }
      }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = cur.c + dc, r = cur.r + dr;
        if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) continue;
        const wx = cellX(c) + AX, wz = cellZ(r) + AZ;
        const s = nav.surfaceAt(wx, wz, cur.y);
        if (!s) continue;
        const k = key(c, r, s.level);
        if (seen.has(k)) continue;
        seen.add(k);
        reachedLevels.add(s.level);
        queue.push({ c, r, y: s.y, l: s.level });
      }
    }

    for (const room of ROOMS) {
      expect(roomReached.get(room.id), `room ${room.id} reachable`).toBe(true);
    }
    expect([...reachedLevels].sort().join(',')).toBe('0,1,2,3,4');
  });

  it('remoteSurfaceY tracks floors, seeds teleport-ins, and never drops a storey', async () => {
    const { CastleSystem } = await import('../CastleSystem.js');
    const c = new CastleSystem({}, { surfaceY: () => 0 }, {}, {});
    const AXc = INTERIOR_ANCHOR.x, AZc = INTERIOR_ANCHOR.z;
    // ballroom center (level 2) with a tracked level-2 prevY
    const ball = ROOMS.find((r) => r.id === 'ballroom').rect;
    const bx = (ball.x0 + ball.x1) / 2 + AXc, bz = (ball.z0 + ball.z1) / 2 + AZc;
    expect(c.remoteSurfaceY(bx, bz, LEVELS[2].y + 0.5)).toBeCloseTo(LEVELS[2].y, 4);
    // Codex's wall-clip case: no level-2 surface at (6.5, -38) local but an
    // open level-1 floor below — a tracked level-2 remote must HOLD height,
    // not fall a storey to the seed retry
    expect(c.nav.surfaceAt(6.5 + AXc, -38 + AZc, LEVELS[2].y + 0.5)).toBeNull();
    expect(c.remoteSurfaceY(6.5 + AXc, -38 + AZc, LEVELS[2].y)).toBe(LEVELS[2].y);
    // dungeon remote clipping a wall holds its dungeon height too
    expect(c.remoteSurfaceY(6.5 + AXc, -38 + AZc, LEVELS[0].y)).toBe(LEVELS[0].y);
    // fresh teleport-in (prevY at terrain height) seeds the ground floor
    expect(c.remoteSurfaceY(ENTRY.spawnLocal.x + AXc, ENTRY.spawnLocal.z + AZc, -1.0))
      .toBeCloseTo(LEVELS[1].y, 4);
    // outside the interior region → null (caller falls back to terrain)
    expect(c.remoteSurfaceY(150, 20, 5)).toBeNull();
  });

  it('a feast table blocks movement (spot check)', () => {
    // diningHall level 1: tables at (cx, cz ± 3.4), 11 × 1.8
    const dining = ROOMS.find((r) => r.id === 'diningHall').rect;
    const cx = (dining.x0 + dining.x1) / 2, cz = (dining.z0 + dining.z1) / 2;
    expect(nav.surfaceAt(cx + AX, cz + 3.4 + AZ, LEVELS[1].y + 0.3)).toBeNull();
    // the aisle between the two tables stays walkable
    expect(nav.surfaceAt(cx + AX, cz + AZ, LEVELS[1].y + 0.3)).toBeTruthy();
  });
});
