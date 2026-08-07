/**
 * rayFan — the "can a ray sneak through this body" machinery, shared between
 * gen/actorSeal.test.js (rest pose) and gen/actorSealPose.test.js (canary
 * pose). PURE.
 *
 * Extracted rather than duplicated because Task 3's posed seal gate has to
 * reuse the EXACT SAME Moller-Trumbore epsilons and interior-point sampling
 * grid the P6 review tuned against real leaks (magistari's shoulder annulus,
 * orghon's throat slit) — a hand-copied second implementation could silently
 * drift an epsilon and either gate would then measure a different geometry
 * question without anyone deciding that on purpose. Every function BODY here
 * — the actual executable statements of `crossings`, `basisFor`, `unitAxis`
 * and `interiorPoints`, and every numeric constant — is byte-for-byte what
 * used to live in actorSeal.test.js; nothing about how a ray is cast or a
 * point sampled changed. What IS new, beyond the `export` keywords and this
 * header: a few inline doc comments that named "this file" or pointed at
 * "below" were reworded to stay true once read from a second file (e.g.
 * `basisFor`'s comment now names actorSeal.test.js's ring-vertices group by
 * file instead of saying "below", and `interiorPoints`' comment gained a
 * sentence on the rest-frame/posed-frame contract that only matters now that
 * a second, posed caller exists) — prose accuracy fixes, not logic changes.
 *
 * `crossings` and `interiorPoints` do not know or care whether the payload
 * they are handed is the rest-pose mesh or a posed one — they only read
 * `positions`/`indices` off whatever object they are given. That is what
 * lets actorSealPose.test.js hand `crossings` a skinned position buffer with
 * the original index buffer and get the same "did this ray meet a triangle"
 * answer, and what lets it hand `interiorPoints` the REST-pose mass geometry
 * and then rigidly transform the returned points itself before casting rays
 * against the posed mesh — a point interior to a rigid solid stays interior
 * to that same solid after ANY rotation+translation is applied to both
 * consistently, so the sampling grid does not need a posed variant.
 *
 * See gen/actorSeal.test.js's header for what "sealed" means here (clean
 * pass-through, not watertightness) and what this deliberately does not
 * catch (one-sided apertures, far-stage cap pinholes).
 */
import { FAR_COMP, SEG } from '../model/actorMasses.js';

/**
 * Moller-Trumbore, counting crossings on each side of the origin separately.
 * `[forward, backward]`: how many triangles the ray meets going +dir and -dir.
 * Both zero means the line missed the body entirely — which, from a point
 * known to be inside it, means it left through a hole at each end.
 */
export function crossings({ positions: P, indices: I }, o, d) {
  let forward = 0;
  let backward = 0;
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t] * 3;
    const i1 = I[t + 1] * 3;
    const i2 = I[t + 2] * 3;
    const ax = P[i0];
    const ay = P[i0 + 1];
    const az = P[i0 + 2];
    const e1x = P[i1] - ax;
    const e1y = P[i1 + 1] - ay;
    const e1z = P[i1 + 2] - az;
    const e2x = P[i2] - ax;
    const e2y = P[i2 + 1] - ay;
    const e2z = P[i2 + 2] - az;
    const px = d[1] * e2z - d[2] * e2y;
    const py = d[2] * e2x - d[0] * e2z;
    const pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - ax;
    const ty = o[1] - ay;
    const tz = o[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (hit > 1e-9) forward += 1;
    else if (hit < -1e-9) backward += 1;
  }
  return [forward, backward];
}

/** propPrimitives' basisFor, re-derived rather than exported: this module
 *  must be able to place a point inside a tube without the tube builder's
 *  help. Checked against the real thing by actorSeal.test.js's "ring
 *  vertices" group, which reads addMass's actual output. */
export function basisFor([ax, ay, az]) {
  const ref = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = ay * ref[2] - az * ref[1];
  let uy = az * ref[0] - ax * ref[2];
  let uz = ax * ref[1] - ay * ref[0];
  const il = 1 / Math.hypot(ux, uy, uz);
  ux *= il; uy *= il; uz *= il;
  return [[ux, uy, uz], [ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux]];
}

export const unitAxis = (m) => {
  const d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** Fractions along each mass's axis. Deliberately not 0 or 1: an endpoint is
 *  ON the boundary plane, where "inside" is a coin flip. */
export const AXIAL = [0.15, 0.5, 0.85];
/** Fractions of the PRISM's apothem — 0.85 is 15% of clearance from the
 *  faceted wall, which is what makes the point provably interior. */
export const RADIAL = [0, 0.45, 0.85];
export const AZIMUTHS = 8;

/** The 26 directions of a cube's faces, edges and corners. Contains straight
 *  down, which is the direction the shoulder annulus leaked along. */
export const DIRECTIONS = (() => {
  const out = [];
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      for (let k = -1; k <= 1; k += 1) {
        if (i || j || k) {
          const l = Math.hypot(i, j, k);
          out.push([i / l, j / l, k / l]);
        }
      }
    }
  }
  return out;
})();

const compFor = (stage) => (stage === 0 ? 1 : FAR_COMP);

/** Points provably inside `mass` at this stage's tessellation, in `mass`'s
 *  OWN (rest-pose) coordinate frame. A caller measuring a posed mesh is
 *  responsible for carrying each point through the same rigid transform its
 *  mass underwent before casting rays — see the file header. */
export function interiorPoints(mass, stage) {
  const comp = compFor(stage);
  const apothem = Math.cos(Math.PI / SEG[stage]);
  const [u, v] = basisFor(unitAxis(mass));
  const pts = [];
  for (const t of AXIAL) {
    const c = [0, 1, 2].map((k) => mass.a[k] + (mass.b[k] - mass.a[k]) * t);
    const wall = (mass.r0 + (mass.r1 - mass.r0) * t) * comp * apothem;
    for (const rf of RADIAL) {
      const azimuths = rf === 0 ? 1 : AZIMUTHS;
      for (let s = 0; s < azimuths; s += 1) {
        const th = (s / azimuths) * Math.PI * 2;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        pts.push({
          at: [0, 1, 2].map((k) => c[k] + (u[k] * cs + v[k] * sn) * wall * rf),
          label: `${mass.id} t=${t} r=${rf} az=${s}`,
        });
      }
    }
  }
  return pts;
}
