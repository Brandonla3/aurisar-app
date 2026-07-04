/**
 * castleNav drift-guards — walkability proven on the RASTERIZED grids, not
 * the abstract plan graph. If a wall seals a door, a stair ramp misses its
 * floor, or a landing snags, these fail before anyone walks the castle.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildNav, roomCenterWorld } from '../castleNav.js';
import {
  CASTLE_PLAN, LEVELS, ROOMS, STAIRS, ENTRY, INTERIOR_ANCHOR,
  NAV_CELL, STEP_UP, PLAN_SCALE, stairRects,
} from '../castlePlan.js';

let nav;
beforeAll(() => { nav = buildNav(); });

const AX = INTERIOR_ANCHOR.x, AZ = INTERIOR_ANCHOR.z;

describe('castleNav', () => {
  it('builds grids for every level', () => {
    expect(nav.grids.length).toBe(LEVELS.length);
    expect(nav.cols).toBeGreaterThan(200);
  });

  it('surfaceAt returns each room center (or a nearby point) at its own level', () => {
    for (const room of ROOMS) {
      const c = roomCenterWorld(room.id);
      const y = LEVELS[room.level].y;
      let s = nav.surfaceAt(c.x, c.z, y + 1);
      if (s) {
        expect(s.level, `room ${room.id} level`).toBe(room.level);
        expect(s.y).toBeCloseTo(y, 4);
        continue;
      }
      // room center may sit on a stair ramp above its own floor (stair-host
      // rooms) — a walkable point at floor height must still exist nearby
      const p = nav.nearestWalkable(c.x, c.z, y + 1, 6);
      expect(p, `room ${room.id} walkable near center`).toBeTruthy();
      expect(p.level, `room ${room.id} nearby level`).toBe(room.level);
    }
  });

  it('stacked floors never bleed: standing on f3 cannot snap to f2/f4', () => {
    const c = roomCenterWorld('library'); // level 3, library sits over kitchen (1)… etc
    const y3 = LEVELS[3].y;
    const s = nav.surfaceAt(c.x, c.z, y3 + 0.2);
    expect(s.level).toBe(3);
    expect(s.y).toBeCloseTo(y3, 4);
    // from just above f2 height at the same (x,z) the f3 floor is out of reach
    const s2 = nav.surfaceAt(c.x, c.z, LEVELS[2].y + 0.2);
    expect(s2.level).toBeLessThan(3);
  });

  it('outside every room is blocked (wall mass)', () => {
    // dead pocket between corridor1 (z1=-4) and storeRoom (z0=-6), scaled
    expect(nav.surfaceAt(22 * PLAN_SCALE + AX, -5 * PLAN_SCALE + AZ, LEVELS[1].y)).toBeNull();
    // outside the footprint entirely
    expect(nav.surfaceAt(AX - 70, AZ, LEVELS[1].y)).toBeNull();
  });

  it('a synthetic agent walks every stair with no step gap > STEP_UP', () => {
    for (const st of STAIRS) {
      const { laneA, laneB, landing } = stairRects(st);
      const vA = st.axis === 'z' ? (laneA.x0 + laneA.x1) / 2 : (laneA.z0 + laneA.z1) / 2;
      const vB = st.axis === 'z' ? (laneB.x0 + laneB.x1) / 2 : (laneB.z0 + laneB.z1) / 2;
      const uMidLanding = st.axis === 'z'
        ? (landing.z0 + landing.z1) / 2 : (landing.x0 + landing.x1) / 2;

      // path: approach lane A from 1m before the base → up lane A → cross the
      // landing to lane B → down lane B past the top edge onto the upper floor.
      const pts = [];
      const push = (u, v) => pts.push(st.axis === 'z' ? { x: v, z: u } : { x: u, z: v });
      for (let u = st.u0 - 1; u <= st.u0 + st.runLen; u += 0.1) push(u, vA);
      // landing traverse lane A → lane B
      for (let v = vA; (vA < vB ? v <= vB : v >= vB); v += (vA < vB ? 0.1 : -0.1)) {
        push(uMidLanding, v);
      }
      for (let u = st.u0 + st.runLen; u >= st.u0 - 1; u -= 0.1) push(u, vB);

      let y = LEVELS[st.lo].y;
      let prev = null;
      for (const p of pts) {
        const s = nav.surfaceAt(p.x + AX, p.z + AZ, y);
        expect(s, `stair ${st.id} walkable at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeTruthy();
        expect(Math.abs(s.y - y), `stair ${st.id} step gap at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
          .toBeLessThanOrEqual(STEP_UP + 1e-9);
        y = s.y;
        prev = p;
      }
      expect(prev).toBeTruthy();
      expect(y).toBeCloseTo(LEVELS[st.hi].y, 4);
    }
  });

  it('BFS over the rasterized grids reaches every room from the entrance spawn', () => {
    const start = {
      x: ENTRY.spawnLocal.x + AX,
      z: ENTRY.spawnLocal.z + AZ,
      y: LEVELS[1].y,
    };
    const s0 = nav.surfaceAt(start.x, start.z, start.y + 1);
    expect(s0, 'entrance spawn walkable').toBeTruthy();

    // BFS in cell space with movement semantics (surfaceAt with currentY)
    const { colOf, rowOf, cellX, cellZ } = nav._local;
    const key = (c, r, l) => (l * nav.rows + r) * nav.cols + c;
    const seen = new Set();
    const queue = [{
      c: colOf(start.x - AX), r: rowOf(start.z - AZ), y: s0.y, l: s0.level,
    }];
    seen.add(key(queue[0].c, queue[0].r, queue[0].l));
    const reachedLevels = new Set([s0.level]);
    // per-room reached flags
    const roomReached = new Map(ROOMS.map((r) => [r.id, false]));

    while (queue.length) {
      const cur = queue.pop(); // DFS order is fine, visitation is what matters
      // mark rooms containing this cell at this level
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

  it('resolveMove wall-slides and never escapes the footprint', () => {
    const c = roomCenterWorld('corridor1');
    const pos = { x: c.x, y: LEVELS[1].y, z: c.z };
    // charge north through the corridor wall: z should clamp, x should keep
    const tgt = { x: pos.x + 0.2, y: pos.y, z: pos.z + 50 };
    const s = nav.resolveMove(pos.x, pos.z, tgt);
    expect(s).toBeTruthy();
    expect(tgt.z).toBeLessThan(c.z + 6);       // stopped at/near the wall
    expect(tgt.x).toBeCloseTo(pos.x + 0.2, 3); // slid along x
  });

  it('nearestWalkable recovers a stranded position', () => {
    // a point in wall mass near the corridor
    const p = nav.nearestWalkable(22 * PLAN_SCALE + AX, -5 * PLAN_SCALE + AZ, LEVELS[1].y, 8);
    expect(p).toBeTruthy();
    expect(Math.hypot(p.x - (22 * PLAN_SCALE + AX), p.z - (-5 * PLAN_SCALE + AZ))).toBeLessThan(8);
  });

  it('grid rasterization keeps door strips passable at walking width', () => {
    // sample straight through each door center at its level height
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
});
