/**
 * propPrimitives — the small vocabulary every prop organ is built from.
 *
 * PURE. Builders append into a plain accumulator ({pos, nrm, col, idx}
 * arrays); finalize() converts to the typed-array payload shape the view
 * layer consumes verbatim (same contract as terrainChunkGen). Nothing here
 * knows what a mesh is.
 *
 * Normals are ANALYTIC per primitive (radial for tubes and blobs, planar
 * for quads) rather than face-averaged — cheaper, deterministic, and for
 * stylized flat-colored props the difference is invisible. The boulder is
 * the one exception (see propGen.js) because displacement changes its
 * surface directions for real.
 *
 * WINDING, and why every index push below looks "backwards". Under this
 * repo's render state (scene.useRightHandedSystem false, material
 * sideOrientation null so the mesh's default 1/CounterClockWise applies,
 * backFaceCulling true) Babylon's FRONT face is the one whose right-handed
 * cross product (v1-v0)x(v2-v0) points AWAY from the viewer — i.e.
 * ANTI-PARALLEL to the surface's authored outward normal. That is not a
 * remembered convention: it is measured, in gen/winding.test.js, off
 * Babylon's own CreateGround/CreateSphere/CreateBox/CreateCylinder/
 * CreateIcoSphere, all five of which are 100% anti-parallel.
 *
 * This file shipped the opposite for `addBlob` and `addBladeFan` from P5
 * until the P6 final review: their RH cross was PARALLEL to the authored
 * normal, so every blob triangle and every grass blade was a back face and
 * got culled. Because `addMass` (gen/actorPrimitives.js) builds an actor as
 * one tube plus up to two blob caps, that made 76-85% of every near-stage
 * actor's triangles back-facing, and the identical error in
 * gen/terrainChunkGen.js made the world's ground invisible. Nothing caught
 * it because the silhouette harness rasterizes orientation-agnostically
 * (model/silhouette.js:123) and a closed body covers the same screen pixels
 * either way. gen/winding.test.js is the gate that now cannot miss it.
 */

import { hash2 } from '../model/noise.js';

export function newAccumulator() {
  return { pos: [], nrm: [], col: [], idx: [] };
}

/** @returns the payload TerrainChunk-style: typed arrays + counts. */
export function finalize(acc) {
  const positions = new Float32Array(acc.pos);
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const r = Math.hypot(positions[i], positions[i + 2]);
    if (r > maxR) maxR = r;
  }
  return {
    positions,
    normals: new Float32Array(acc.nrm),
    colors: new Float32Array(acc.col),
    indices: new Uint32Array(acc.idx),
    vertCount: positions.length / 3,
    triCount: acc.idx.length / 3,
    heightM: maxY,
    minY,
    radiusM: maxR,
  };
}

const pushV = (acc, x, y, z, nx, ny, nz, c) => {
  acc.pos.push(x, y, z);
  acc.nrm.push(nx, ny, nz);
  acc.col.push(c[0], c[1], c[2], 1);
  return acc.pos.length / 3 - 1;
};

/** Orthonormal basis perpendicular to a (normalized) axis. */
function basisFor(ax, ay, az) {
  // Pick the world axis least aligned with the segment to avoid degeneracy.
  const ref = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = ay * ref[2] - az * ref[1];
  let uy = az * ref[0] - ax * ref[2];
  let uz = ax * ref[1] - ay * ref[0];
  const il = 1 / Math.hypot(ux, uy, uz);
  ux *= il; uy *= il; uz *= il;
  return {
    ux, uy, uz,
    vx: ay * uz - az * uy,
    vy: az * ux - ax * uz,
    vz: ax * uy - ay * ux,
  };
}

/**
 * An open tapered tube from a to b (no caps — ends are buried in ground,
 * parent limbs, or foliage). `segments` radial verts per ring; side faces
 * only: segments * 2 triangles.
 */
export function addTube(acc, a, b, radiusA, radiusB, segments, color) {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  let dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const { ux, uy, uz, vx, vy, vz } = basisFor(dx, dy, dz);

  const ringStart = [];
  const ringEnd = [];
  for (let s = 0; s < segments; s++) {
    const t = (s / segments) * Math.PI * 2;
    const cx = Math.cos(t);
    const sx = Math.sin(t);
    const nx = ux * cx + vx * sx;
    const ny = uy * cx + vy * sx;
    const nz = uz * cx + vz * sx;
    ringStart.push(pushV(acc, a[0] + nx * radiusA, a[1] + ny * radiusA, a[2] + nz * radiusA, nx, ny, nz, color));
    ringEnd.push(pushV(acc, b[0] + nx * radiusB, b[1] + ny * radiusB, b[2] + nz * radiusB, nx, ny, nz, color));
  }
  for (let s = 0; s < segments; s++) {
    const s2 = (s + 1) % segments;
    // Wound so faces look OUTWARD: the RH cross of each triple is
    // anti-parallel to the ring's radial normal, which is Babylon's front
    // face here (see the file header). This pair was already correct when
    // the P6 review found the blob and terrain ones were not.
    acc.idx.push(ringStart[s], ringEnd[s], ringEnd[s2]);
    acc.idx.push(ringStart[s], ringEnd[s2], ringStart[s2]);
  }
}

// Icosahedron table (golden ratio), unit-ish radius; normalized on use.
const IP = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, IP, 0], [1, IP, 0], [-1, -IP, 0], [1, -IP, 0],
  [0, -1, IP], [0, 1, IP], [0, -1, -IP], [0, 1, -IP],
  [IP, 0, -1], [IP, 0, 1], [-IP, 0, -1], [-IP, 0, 1],
];
const ICO_F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
const OCT_V = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const OCT_F = [
  [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0],
  [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3],
];

/**
 * Unit-sphere face list at three coarseness levels: 2 = icosphere subdiv 1
 * (80 faces), 1 = icosahedron (20), 0 = octahedron (8). Returned as flat
 * per-face vertex triples (unindexed — blobs are tiny; sharing verts across
 * faces buys nothing and flat winding keeps the code obvious).
 */
export function sphereFaces(level) {
  const base = level === 0 ? { v: OCT_V, f: OCT_F } : { v: ICO_V, f: ICO_F };
  const norm = ([x, y, z]) => {
    const il = 1 / Math.hypot(x, y, z);
    return [x * il, y * il, z * il];
  };
  let faces = base.f.map((f) => f.map((i) => norm(base.v[i])));
  if (level === 2) {
    const mid = (a, b) => norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const out = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = out;
  }
  return faces;
}

/**
 * A displaced sphere-ish blob. `displace(dir) -> radial multiplier` shapes
 * it (foliage lumpiness, boulder gnarl); `squashY` flattens. Normals are
 * radial from the center — soft-looking, exactly right for foliage; the
 * boulder overrides them (see propGen).
 */
export function addBlob(acc, center, radius, level, color, {
  displace = null, squashY = 1, shadeFloor = 0.75,
} = {}) {
  const faces = sphereFaces(level);
  for (const face of faces) {
    const vi = [];
    for (const d of face) {
      const m = displace ? displace(d) : 1;
      const px = center[0] + d[0] * radius * m;
      const py = center[1] + d[1] * radius * m * squashY;
      const pz = center[2] + d[2] * radius * m;
      // Vertical shade gradient baked into vertex color: undersides darker.
      // Cheap fake occlusion that keeps flat-colored blobs from reading as
      // balloons — the only texture-free tool available for volume.
      const shade = shadeFloor + (1 - shadeFloor) * (d[1] * 0.5 + 0.5);
      // Ellipsoid normal: for a surface scaled by s in Y, the normal's Y
      // component DIVIDES by s — n ∝ (d0, d1/s, d2), the gradient of
      // x²+ (y/s)² + z². The first version MULTIPLIED (n ∝ (d0, d1·s, d2)),
      // shading every squashed disc as its reciprocal shape — measured in
      // PR review at 47.5° of angular error on conifer tiers, which are
      // ~98% of the world's trees. Normalized here so the shader's
      // interpolated normals start unit-length.
      const ny = d[1] / Math.max(squashY, 0.05);
      const il = 1 / Math.hypot(d[0], ny, d[2]);
      vi.push(pushV(acc, px, py, pz, d[0] * il, ny * il, d[2] * il, [color[0] * shade, color[1] * shade, color[2] * shade]));
    }
    // REVERSED against ICO_F/OCT_F's table order, deliberately. Those tables
    // list each face counter-clockwise seen from OUTSIDE, whose RH cross is
    // parallel to the outward radial normal — the BACK face here. Emitting
    // the table order directly is the P5 bug the P6 review caught: every blob
    // triangle culled, and with it 76-85% of every actor. Do not "tidy" this
    // back to (0, 1, 2); gen/winding.test.js will go red if you do.
    acc.idx.push(vi[0], vi[2], vi[1]);
  }
}

/**
 * `blades` single-sided tapered quads fanned around the Y axis, each wound
 * to face OUTWARD from the tuft center — with backface culling on, roughly
 * half the blades face any given viewpoint, which reads fine for stylized
 * grass at an 8-triangle budget (4 blades). No double-sided duplication:
 * that would double the tuft's cost across thousands of instances for a
 * back face nobody can distinguish.
 *
 * SINGLE-SIDED IS DELIBERATE; WHICH SIDE WAS NOT. Until the P6 final review
 * these two pushes were (a,b,c)/(a,c,d), whose RH cross is PARALLEL to the
 * authored (cx, 0, sx) radial normal — the back face. So the surviving half
 * of each tuft was the blades pointing AWAY from the eye, lit by a normal
 * facing away from it: the exact inverse of the sentence above. The
 * single-sided budget decision is unchanged and still right; only the choice
 * of which side survives culling is corrected.
 */
export function addBladeFan(acc, blades, width, height, color, seed) {
  for (let k = 0; k < blades; k++) {
    const yaw = (k / blades) * Math.PI * 2 + hash2(k, 11, seed) * 0.9;
    const cx = Math.cos(yaw);
    const sx = Math.sin(yaw);
    const lean = (hash2(k, 23, seed) - 0.5) * 0.5;
    const w0 = width / 2;
    const w1 = w0 * 0.35;
    const hx = cx * lean * height;
    const hz = sx * lean * height;
    const h = height * (0.8 + hash2(k, 37, seed) * 0.4);
    // Blade plane spans the tangent direction (-sx, cx); normal faces (cx, sx).
    const base = [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
    const a = pushV(acc, -sx * w0, 0, cx * w0, cx, 0, sx, base);
    const b = pushV(acc, sx * w0, 0, -cx * w0, cx, 0, sx, base);
    const c = pushV(acc, sx * w1 + hx, h, -cx * w1 + hz, cx, 0.2, sx, color);
    const d = pushV(acc, -sx * w1 + hx, h, cx * w1 + hz, cx, 0.2, sx, color);
    acc.idx.push(a, c, b);
    acc.idx.push(a, d, c);
  }
}
