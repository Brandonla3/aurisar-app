/**
 * instanceMatrix — compose a thin-instance world matrix as 16 plain floats.
 *
 * PURE. Matrices are built HERE, in model code, so the view layer hands a
 * finished Float32Array straight to thinInstanceSetBuffer without touching
 * per-instance math — and so placement tests can assert on real transforms
 * without an engine.
 *
 * Layout matches Babylon's Matrix storage (row-major array, row-vector
 * convention: v' = v·M, translation in elements 12..14). Compose order is
 * scale → yaw (spin the prop) → lean (tip it in world space) → translate.
 */

/** rows a·b for 3x3 row-major arrays. */
function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

/** Rodrigues rotation about a unit axis. */
function rotAxis(ax, ay, az, angle) {
  const s = Math.sin(angle);
  const cs = Math.cos(angle);
  const t = 1 - cs;
  return [
    t * ax * ax + cs, t * ax * ay + s * az, t * ax * az - s * ay,
    t * ax * ay - s * az, t * ay * ay + cs, t * ay * az + s * ax,
    t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + cs,
  ];
}

/**
 * Write one instance matrix into `out` at float offset `at`.
 *
 * @param {object} p { x, y, z, yaw, sxz, sy, leanAxisX, leanAxisZ, leanAngle }
 *   Lean axis is horizontal (a unit XZ direction to rotate ABOUT); zero
 *   leanAngle skips the lean multiply entirely.
 */
export function writeInstanceMatrix(out, at, {
  x, y, z, yaw = 0, sxz = 1, sy = 1, leanAxisX = 1, leanAxisZ = 0, leanAngle = 0,
}) {
  const cy = Math.cos(yaw);
  const sn = Math.sin(yaw);
  // S · Ryaw, expanded (row-vector RotationY).
  let m = [
    sxz * cy, 0, -sxz * sn,
    0, sy, 0,
    sxz * sn, 0, sxz * cy,
  ];
  if (leanAngle !== 0) {
    m = mul3(m, rotAxis(leanAxisX, 0, leanAxisZ, leanAngle));
  }
  out[at] = m[0]; out[at + 1] = m[1]; out[at + 2] = m[2]; out[at + 3] = 0;
  out[at + 4] = m[3]; out[at + 5] = m[4]; out[at + 6] = m[5]; out[at + 7] = 0;
  out[at + 8] = m[6]; out[at + 9] = m[7]; out[at + 10] = m[8]; out[at + 11] = 0;
  out[at + 12] = x; out[at + 13] = y; out[at + 14] = z; out[at + 15] = 1;
}
