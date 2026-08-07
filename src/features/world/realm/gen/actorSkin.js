/**
 * actorSkin — the CPU skinning twin. PURE.
 *
 * `skinPayload(payload, rig, palette)` is the ORACLE every later gate in this
 * phase compares a real skinned mesh against: Task 3's posed seal, Task 4's
 * oracle test (`view/actor/ActorSkeleton.js` vs this file, on an asymmetric
 * fixture), and anything downstream that asks "is the mesh actually deformed
 * correctly, or does it merely look plausible." It has to reproduce the
 * numbers a rigid bone transform produces, not merely numbers close to them —
 * see the fp32 section below for why "close" is the wrong target entirely.
 *
 * For each vertex `v`, its owning bone is `rig.boneOfMass[payload.massIndex[v]]`
 * — the same mass-ordinal-to-bone map `model/actorRig.js` builds and
 * `gen/actorGen.js` tags every vertex with, so no re-derivation happens here.
 * Rigid 1.0 single-influence skinning, as the plan locked (blending is out of
 * scope for this phase): one bone, one weight, per vertex.
 *
 * POSITIONS GET THE FULL AFFINE TRANSFORM, `p' = p·M` in the row-vector
 * convention `model/instanceMatrix.js` and `model/actorRig.js`'s `evaluatePose`
 * both use — translation folded into elements 12..14, exactly the layout
 * `model/actorRig.test.js`'s own `apply` helper reads. NORMALS GET THE
 * ROTATION PART ONLY (the upper-left 3x3, elements 0,1,2,4,5,6,8,9,10), never
 * renormalized afterward.
 *
 * WHY ROTATION-ONLY IS CORRECT HERE, AND WHY IT WOULD BE WRONG ELSEWHERE. The
 * textbook rule for transforming a normal is the inverse-transpose,
 * `n' = n · (M^-1)^T` (row-vector form), because a normal is a covector: a
 * non-rigid M — anisotropic scale, shear — rotates a surface's normal
 * differently from how it moves the surface's points, and using M itself
 * would tilt the shading away from the true surface. But every palette this
 * function is ever handed comes from `evaluatePose`, which composes ONLY
 * `rotAxis` rotations and `T(-at)·R·T(at)` pivot conjugations — no bone in
 * this rig can scale or shear a vertex. For a rigid rotation R, orthogonality
 * gives `R^-1 = R^T`, so `(R^-1)^T = (R^T)^T = R`: the inverse-transpose IS
 * the rotation itself, and computing it via an explicit inverse would be the
 * identical arithmetic done twice for the identical answer.
 *
 * THIS IS AN ASSUMPTION ABOUT THE INPUT, NOT A LAW THIS FILE ENFORCES. Hand
 * `skinPayload` a scaled or sheared palette and the normals come out wrong
 * with no error thrown — nothing here inspects the upper 3x3 for
 * orthogonality, because every producer of a palette in this codebase
 * (`evaluatePose`) already honours the rigid-only contract, and checking it
 * per vertex would cost real time for a property that is true by construction
 * everywhere it matters. Task 4's oracle fixture deliberately exercises a
 * scaled/sheared bone to prove the oracle comparison itself is sound — but
 * THROUGH BABYLON's own skinning path, never through this twin. If this
 * function is ever handed a non-rigid palette, its normals are silently
 * wrong; that is a contract violation by the caller, not a bug to catch here.
 *
 * WHY `Math.fround` ON EVERY ARITHMETIC INTERMEDIATE. JS numbers are float64;
 * a GPU vertex shader (and Babylon's CPU `Mesh.applySkeleton` software-skin
 * fallback) is fp32 throughout, rounding after every multiply and every add.
 * Computing a dot product in float64 and casting only the final answer to
 * Float32Array rounds once, at the end, which throws away the exact rounding
 * error the real pipeline accumulates — precisely the error Task 4's oracle
 * tolerance has to be sized around (see `model/actorRig.js`'s note that
 * `evaluatePose`'s own palette accumulates 1.359e-7 m by depth 4). Wrapping
 * every individual multiply and every individual running-sum add in
 * `Math.fround` reproduces that rounding step-for-step without needing actual
 * Float32Array scratch storage for intermediates.
 *
 * TERMS WHOSE MATRIX COEFFICIENT IS EXACTLY ZERO ARE OMITTED FROM THE RUNNING
 * SUM, RATHER THAN ADDED AS A SIGNED ZERO — and this is not a stylistic
 * choice, it is what keeps the identity palette a genuine bit-exact no-op.
 * The roster's own generated payload carries 134 NORMAL COMPONENTS authored as
 * `-0`, and the composition matters because it is not the one an earlier
 * version of this comment claimed: 84 are `x` components and 50 are `y`, none
 * is a `z`, and there is not a single `-0` anywhere in positions, ever
 * (re-measured across all four archetypes at both stages — unbound 20x/12y,
 * legion 30x/10y, magistari 14x/24y, orghon 20x/4y).
 *
 * Both columns fail the same way, which is why the count is worth stating
 * whole. At the identity bone the column for axis `k` reads coefficient 1 at
 * `k` and exactly 0 at the other two, so for a `-0` in `x`, naively computing
 * `fround(nx*1) + fround(ny*0) + fround(nz*0)` adds the `-0` term (from `nx`,
 * whose true sign the input carries) to TWO `+0` terms (`0` is always
 * canonicalised to `+0` in a palette — `evaluatePose`'s own doc comment)
 * — and IEEE 754 defines the sum of two zeros with OPPOSITE signs, under
 * round-to-nearest, as `+0`. The `-0` is gone, silently, even though the
 * identity matrix's only real contribution to that component was `nx`
 * itself; the 50 `y` cases are the same sentence with the `(0, 1, 0)` column.
 * Skipping a zero-coefficient term changes nothing mathematically —
 * `0 * anything` contributes nothing to a sum regardless of its sign — and it
 * means the SOLE surviving term (the one whose coefficient is exactly 1 at
 * identity) is returned untouched, sign and all, because it is never added to
 * anything. `actorSkin.test.js`'s identity gate is what would catch a
 * regression here: it compares by `toEqual`, which — like `Object.is` and
 * unlike plain `toEqual` on ordinary numbers — treats a `Float32Array`'s `-0`
 * and `+0` as different.
 *
 * PURE. Deterministic; no `Math.random`, no `Date.now()`. No `BABYLON`
 * token, no `view/` import. Never mutates `payload` — every read is
 * `payload.positions[i]` / `payload.normals[i]` / `payload.massIndex[v]`,
 * never a write, and every output is a freshly allocated `Float32Array`.
 */

const fr = Math.fround;

/**
 * fp32-emulated `[vx, vy, vz] · column(M, col)`, optionally plus an additive
 * `extra` term (a palette's translation entry, for positions; omitted for
 * normals). `M` is a flat 16-float row-major palette matrix at bone offset
 * `o`; `col` selects which of the three output axes (0=x, 1=y, 2=z) this
 * call computes, so the three coefficients read are `M[o+col]`, `M[o+4+col]`,
 * `M[o+8+col]` — the COLUMN of the row-major matrix, which is what row-vector
 * multiplication (`p' = p·M`) contracts against. Reading `M[o+col*4 .. +2]`
 * instead (the matrix's ROW rather than its column) is the transpose-read
 * mutation `actorSkin.test.js` exercises: identity is its own transpose so
 * that mutation still passes the identity gate, but every non-identity
 * palette the canary pose produces fails, because a rotation matrix is not
 * generally symmetric.
 *
 * See the file header for why zero-coefficient terms are skipped rather than
 * summed as signed zeros.
 */
function dotColumn(vx, vy, vz, M, o, col, extra) {
  const cx = M[o + col];
  const cy = M[o + 4 + col];
  const cz = M[o + 8 + col];
  let sum;
  let has = false;
  if (cx !== 0) { sum = fr(vx * cx); has = true; }
  if (cy !== 0) {
    const term = fr(vy * cy);
    sum = has ? fr(sum + term) : term;
    has = true;
  }
  if (cz !== 0) {
    const term = fr(vz * cz);
    sum = has ? fr(sum + term) : term;
    has = true;
  }
  if (extra !== undefined && extra !== 0) {
    // `fr(extra)` rather than bare `extra`: unreachable under the
    // Float32Array contract this function is always called with (`extra` is
    // already an exact fp32 value read straight out of a Float32Array, so
    // `fr` is a no-op here), but this is the one place "fround every
    // intermediate" would otherwise rely on the caller's typed-array
    // discipline instead of its own.
    sum = has ? fr(sum + extra) : fr(extra);
    has = true;
  }
  return has ? sum : 0;
}

/**
 * Rigid-skin every vertex of `payload` (from `gen/actorGen.js`'s
 * `buildActorPayload`) by `rig` (from `model/actorRig.js`'s `buildActorRig`)
 * posed into `palette` (from `evaluatePose`).
 *
 * Only `rig.boneOfMass` is read — the mass-ordinal -> bone-index map. `rig`
 * is accepted whole, rather than just that one array, so a caller building a
 * comparison fixture (Task 4's oracle) can hand this the exact same `rig` it
 * built the palette from, and so a future consumer that needs `rig.bones`
 * for a different purpose does not have to change this call's shape.
 *
 * @param payload `{positions, normals, massIndex}` typed arrays: 3 floats
 *   per vertex for the first two, 1 mass-ordinal per vertex for the third.
 * @param rig `{boneOfMass}` — a `Uint16Array` indexed by mass ordinal.
 * @param palette `Float32Array(16 * boneCount)`, row-major, row-vector
 *   convention, translation in elements 12..14 — `evaluatePose`'s output
 *   shape exactly.
 * @returns {{positions: Float32Array, normals: Float32Array}} fresh arrays,
 *   the same length as `payload.positions` / `payload.normals`.
 */
export function skinPayload(payload, rig, palette) {
  const { positions, normals, massIndex } = payload;
  const { boneOfMass } = rig;
  const vertCount = massIndex.length;
  const outPositions = new Float32Array(positions.length);
  const outNormals = new Float32Array(normals.length);

  for (let v = 0; v < vertCount; v++) {
    const bone = boneOfMass[massIndex[v]];
    const o = bone * 16;
    const i = v * 3;

    const px = positions[i];
    const py = positions[i + 1];
    const pz = positions[i + 2];
    outPositions[i] = dotColumn(px, py, pz, palette, o, 0, palette[o + 12]);
    outPositions[i + 1] = dotColumn(px, py, pz, palette, o, 1, palette[o + 13]);
    outPositions[i + 2] = dotColumn(px, py, pz, palette, o, 2, palette[o + 14]);

    const nx = normals[i];
    const ny = normals[i + 1];
    const nz = normals[i + 2];
    outNormals[i] = dotColumn(nx, ny, nz, palette, o, 0, undefined);
    outNormals[i + 1] = dotColumn(nx, ny, nz, palette, o, 1, undefined);
    outNormals[i + 2] = dotColumn(nx, ny, nz, palette, o, 2, undefined);
  }

  return { positions: outPositions, normals: outNormals };
}
