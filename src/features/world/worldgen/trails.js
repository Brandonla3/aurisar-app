/**
 * trails — park-path curves spanning the map, with a spatial-hash dirt
 * proximity field used to bake the packed-dirt halo into the ground and to
 * suppress grass on the paths. Ported from the prototype (lines ~2134-2174).
 *
 * Pure math, fully deterministic (no RNG).
 */

import { smoother } from './rng.js';

const GRID_CELL = 8;          // spatial-hash cell size (units)
const DIRT_RADIUS = 5.5;      // dirt influence radius around the trail line

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

function smoothTrail(ctrl) {
  const out = [], n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i];
    const p2 = ctrl[i + 1], p3 = ctrl[Math.min(n - 1, i + 2)];
    const segL = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.round(segL / 6));
    for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps));
  }
  out.push(ctrl[n - 1].slice());
  return out;
}

export function createTrails(config) {
  const trailCurves = config.trails.map(smoothTrail);

  // spatial hash of trail points → fast proximity lookups during ground coloring
  const grid = new Map();
  for (const c of trailCurves) {
    for (const p of c) {
      const k = Math.floor(p[0] / GRID_CELL) + '_' + Math.floor(p[1] / GRID_CELL);
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(p);
    }
  }

  /** 0 (off-trail) → 1 (trail center), within ~5.5u of a path line. */
  function trailDirtAt(x, z) {
    const gx = Math.floor(x / GRID_CELL), gz = Math.floor(z / GRID_CELL);
    let bd = 1e9;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = grid.get((gx + i) + '_' + (gz + j));
        if (!a) continue;
        for (const p of a) {
          const d = (x - p[0]) * (x - p[0]) + (z - p[1]) * (z - p[1]);
          if (d < bd) bd = d;
        }
      }
    }
    if (bd >= DIRT_RADIUS * DIRT_RADIUS) return 0;
    return 1 - smoother(Math.sqrt(bd) / DIRT_RADIUS);
  }

  /** Nearest point on any trail — used for spawn placement and the map. */
  function nearestTrail(x, z) {
    let bd = 1e9, bx = x, bz = z;
    for (const c of trailCurves) {
      for (const p of c) {
        const d = (x - p[0]) * (x - p[0]) + (z - p[1]) * (z - p[1]);
        if (d < bd) { bd = d; bx = p[0]; bz = p[1]; }
      }
    }
    return { d: Math.sqrt(bd), x: bx, z: bz };
  }

  return { trailCurves, trailDirtAt, nearestTrail };
}
