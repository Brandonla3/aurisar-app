/**
 * desireLines — the authored walkable paths, and how worn the ground is.
 *
 * PURE. Placement multiplies density DOWN along these polylines, so
 * wayfinding reads as "follow where the props aren't": worn ribbons through
 * grass, thinned trees, no boulders. The first line runs toward dawnfire's
 * sunrise azimuth; the second toward the southwest meadow. Future consumers
 * (terrain wear tint, NPC pathing cost) should read THESE lines, not redraw
 * their own — one authored artifact, several consumers that cannot disagree.
 *
 * (Split out of propPlacement.js when that file hit the 400-line ceiling —
 * the boundary test doing exactly its job.)
 */

export const DESIRE_LINES = Object.freeze([
  Object.freeze({ points: [[0, 0], [34, 6], [78, 14], [150, 34], [260, 62]] }),
  Object.freeze({ points: [[0, 0], [-22, -18], [-60, -52], [-120, -110], [-210, -190]] }),
]);

const RIBBON_CORE_M = 2.5;
const RIBBON_FADE_M = 6;

/**
 * Per-line bounding boxes (± fade), computed once. ribbonWear runs for
 * EVERY grass candidate — ~4k per chunk — and without this early-out the
 * segment-distance loop was ~33k hypots per chunk, the single biggest cost
 * in the whole placement pass (measured: it dominated a 17ms chunk).
 * Most chunks are nowhere near a desire line and now pay two compares.
 */
const LINE_BOUNDS = DESIRE_LINES.map((line) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [px, pz] of line.points) {
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  return {
    minX: minX - RIBBON_FADE_M,
    maxX: maxX + RIBBON_FADE_M,
    minZ: minZ - RIBBON_FADE_M,
    maxZ: maxZ + RIBBON_FADE_M,
  };
});

/** 1 on the path center → 0 beyond the fade. */
export function ribbonWear(x, z) {
  let best = Infinity;
  for (let li = 0; li < DESIRE_LINES.length; li++) {
    const bb = LINE_BOUNDS[li];
    if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
    const pts = DESIRE_LINES[li].points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d = Math.hypot(px, pz);
      if (d < best) best = d;
    }
  }
  if (best >= RIBBON_FADE_M) return 0;
  if (best <= RIBBON_CORE_M) return 1;
  return 1 - (best - RIBBON_CORE_M) / (RIBBON_FADE_M - RIBBON_CORE_M);
}
