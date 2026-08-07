/**
 * ActorSkeletonLayout.test.js — THE ASYMMETRIC FIXTURE.
 *
 * Split out of ActorSkeleton.test.js, which was at 690 of a 700-line ceiling.
 * The seam is real rather than arbitrary: NOTHING HERE CALLS
 * `buildActorSkeleton`. This file builds its own two-bone skeleton and its own
 * mesh, drives them with hand-written matrices, and carries its own float64
 * references. What it pins is not our module — it is BABYLON'S OWN MATRIX
 * LAYOUT CONTRACT, the assumption every other file in this phase rests on:
 * that `getTransformMatrices()` is row-major, row-vector, translation in
 * elements 12..14, composed `final_i = local_i · final_parent`.
 *
 * WHY IT HAS TO BE ASYMMETRIC. Pure rotations masked three phases of
 * render-criticals, because a rotation is orthogonal: its transpose IS its
 * inverse, so a transposed or column-major-misread palette still produces a
 * rigid, plausible body. Every fixture in this file therefore carries all
 * three of shear, non-uniform scale, and an odd-angle rotation about an
 * off-axis direction, so that M^T is nothing like M^-1 and any layout
 * confusion lands the vertex somewhere numerically distinct. That separation
 * is ASSERTED (>1 unit), not assumed obvious — and so is the presence of each
 * ingredient, because a fixture that quietly loses its shear still passes
 * every downstream assertion while testing strictly less.
 *
 * THE REFERENCE IS HAND-COMPUTED HERE IN FLOAT64, never through
 * `gen/actorSkin.js`. That is deliberate and it is the one place this phase
 * departs from "compare against the twin": the twin's contract is RIGID
 * palettes only (its normals take the rotation part verbatim, which is the
 * inverse-transpose only for orthogonal matrices) and this fixture violates
 * exactly that contract on purpose. Feeding it to the twin would be comparing
 * against a function its own header documents as wrong here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';

let engine;

beforeAll(() => { engine = new BABYLON.NullEngine(); });
afterAll(() => { engine?.dispose(); });

/** A fresh scene per test, always disposed — meshes outlive a leaked one. */
function withScene(fn) {
  const scene = new BABYLON.Scene(engine);
  try { return fn(scene); } finally { scene.dispose(); }
}

const IDENTITY_16 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * This fixture SCALES by up to 2.4x, so its palette entries reach magnitude
 * 5.6 and its skinned vertices 10.3 — where one fp32 ULP is already 4.8e-7 and
 * 9.5e-7, i.e. ActorSkeleton.test.js's POSITION_TOL (sized for unit-scale
 * actor coordinates) is one ULP here and would flake on rounding alone. Worst
 * measured: palette 5.00e-7, positions 6.39e-7, normals 6.98e-8. This is two
 * ULP at the largest magnitude; the layout fault it exists to catch separates
 * by at least 1.36, some 700,000 times wider.
 */
const ASYM_TOL = 2 ** -19;

// ── float64 references, COPIED not imported ────────────────────────────────

/** `p · M` where M is the 16-float row-major palette entry at bone `i`. */
function applyAffine(palette, i, p) {
  const o = i * 16;
  return [
    p[0] * palette[o] + p[1] * palette[o + 4] + p[2] * palette[o + 8] + palette[o + 12],
    p[0] * palette[o + 1] + p[1] * palette[o + 5] + p[2] * palette[o + 9] + palette[o + 13],
    p[0] * palette[o + 2] + p[1] * palette[o + 6] + p[2] * palette[o + 10] + palette[o + 14],
  ];
}

/** `n · upper3x3(M)` — rotation part only, no translation. */
function applyRotation(palette, i, n) {
  const o = i * 16;
  return [
    n[0] * palette[o] + n[1] * palette[o + 4] + n[2] * palette[o + 8],
    n[0] * palette[o + 1] + n[1] * palette[o + 5] + n[2] * palette[o + 9],
    n[0] * palette[o + 2] + n[1] * palette[o + 6] + n[2] * palette[o + 10],
  ];
}

/** Row-vector 4x4 multiply: the matrix that applies `a` first, then `b`. */
function mul4(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c]
        + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}

const translation4 = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** The transpose of a row-major 4x4 — what a column-major misread sees. */
function transpose4(m) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = m[c * 4 + r];
  return o;
}

describe('the skinning-matrix LAYOUT contract — the asymmetric fixture', () => {
  const SHEAR = 0.35;
  const AT0 = [0.4, 1.1, -0.3];
  const AT1 = [-0.7, 1.9, 0.5];

  /** Rodrigues about a unit axis, row-vector convention. Copied, not imported. */
  function rotAxis(ax, ay, az, angle) {
    const s = Math.sin(angle);
    const cs = Math.cos(angle);
    const t = 1 - cs;
    return [
      t * ax * ax + cs, t * ax * ay + s * az, t * ax * az - s * ay, 0,
      t * ax * ay - s * az, t * ay * ay + cs, t * ay * az + s * ax, 0,
      t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + cs, 0,
      0, 0, 0, 1,
    ];
  }

  const scale4 = (sx, sy, sz) => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  /** x' = x + k·y — an off-diagonal term no rotation carries on its own. */
  const shear4 = (k) => [1, 0, 0, 0, k, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const unit = (v) => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  };

  // Odd angles, odd axes: nothing is a multiple of 90 degrees or aligned to a
  // world axis, so no accidental symmetry can rescue a wrong layout.
  const L0 = mul4(mul4(scale4(1.7, 0.43, 2.31), shear4(SHEAR)), rotAxis(...unit([0.31, -0.87, 0.42]), 0.6981317));
  const L1 = mul4(mul4(shear4(-SHEAR), scale4(0.61, 2.4, 1.15)), rotAxis(...unit([-0.55, 0.24, 0.79]), 1.1519173));

  /** Four vertices, two triangles: v0,v1 on bone 0; v2,v3 on bone 1. */
  const STRIP = Object.freeze([
    [0.83, -0.41, 1.27], [-0.62, 0.95, -0.18],
    [1.44, 0.27, -0.91], [-0.35, -1.06, 0.53],
  ]);
  const STRIP_NORMALS = Object.freeze([
    unit([0.2, 0.9, -0.3]), unit([-0.7, 0.1, 0.6]),
    unit([0.5, -0.5, 0.7]), unit([0.15, 0.85, 0.5]),
  ]);
  const STRIP_BONES = Object.freeze([0, 0, 1, 1]);

  function buildStrip(scene) {
    const skeleton = new BABYLON.Skeleton('asym', 'asym', scene);
    skeleton.useTextureToStoreBoneMatrices = false;
    const b0 = new BABYLON.Bone('b0', skeleton, null, BABYLON.Matrix.Translation(...AT0));
    const b1 = new BABYLON.Bone('b1', skeleton, b0, BABYLON.Matrix.Translation(
      AT1[0] - AT0[0], AT1[1] - AT0[1], AT1[2] - AT0[2],
    ));
    // DRIVEN THROUGH BABYLON: the local matrices go in as Babylon Matrices and
    // come back through getTransformMatrices, so the engine's own compose and
    // invert are what is under test, not a re-derivation of them.
    b0._matrix = BABYLON.Matrix.FromArray(L0);
    b1._matrix = BABYLON.Matrix.FromArray(L1);
    skeleton.prepare(true);

    const mesh = new BABYLON.Mesh('strip', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = new Float32Array(STRIP.flat());
    vd.normals = new Float32Array(STRIP_NORMALS.flat());
    vd.indices = [0, 1, 2, 1, 3, 2];
    vd.matricesIndices = new Float32Array(STRIP_BONES.flatMap((b) => [b, 0, 0, 0]));
    vd.matricesWeights = new Float32Array(STRIP_BONES.flatMap(() => [1, 0, 0, 0]));
    vd.applyToMesh(mesh, true);

    // The hand computation reads the matrices AS THE ENGINE STORED THEM (fp32),
    // so the only thing left between the two sides is composition order and
    // layout — which is exactly what this fixture exists to test.
    const stored = [b0, b1].map((b) => [...b.getLocalMatrix().m]);
    return {
      skeleton,
      mesh,
      expected: [
        mul4(translation4(-AT0[0], -AT0[1], -AT0[2]), stored[0]),
        mul4(translation4(-AT1[0], -AT1[1], -AT1[2]), mul4(stored[1], stored[0])),
      ],
    };
  }

  /** Largest normalised |dot| between two distinct rows of the upper 3x3. */
  function worstRowSkew(L) {
    const row = (r) => [L[r * 4], L[r * 4 + 1], L[r * 4 + 2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let worst = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = row(i);
        const b = row(j);
        worst = Math.max(worst, Math.abs(dot(a, b)) / (Math.hypot(...a) * Math.hypot(...b)));
      }
    }
    return worst;
  }

  it('the fixture is genuinely asymmetric: transpose is nothing like inverse', () => {
    for (const [label, L] of [['L0', L0], ['L1', L1]]) {
      const shouldNotBeIdentity = mul4(L, transpose4(L));
      let worst = 0;
      for (let i = 0; i < 16; i++) {
        worst = Math.max(worst, Math.abs(shouldNotBeIdentity[i] - IDENTITY_16[i]));
      }
      expect(
        worst,
        `${label} · ${label}^T is near the identity, so this matrix is effectively a\n` +
          'rotation and the whole fixture has lost its teeth.',
      ).toBeGreaterThan(0.5);
      // Non-uniform scale: a rigid matrix has |det| = 1.
      const d = L[0] * (L[5] * L[10] - L[6] * L[9]) - L[1] * (L[4] * L[10] - L[6] * L[8])
        + L[2] * (L[4] * L[9] - L[5] * L[8]);
      expect(Math.abs(Math.abs(d) - 1)).toBeGreaterThan(0.1);
    }
  });

  it('...and the SHEAR specifically is present, not just the scale', () => {
    // Without this, `SHEAR = 0` leaves every other test in this file green:
    // the non-uniform scale alone is enough to defeat a transposed read, so the
    // fixture would quietly test strictly less than its own prose claims.
    // Scale-and-rotate keeps the upper 3x3's rows MUTUALLY ORTHOGONAL (they are
    // just the rotation's rows with different lengths); only a shear tilts them
    // against each other. Measured with SHEAR = 0.35: 0.3304 (L0), 0.0886 (L1).
    // With SHEAR = 0 both collapse to ~1e-17 — float noise, not a small value —
    // so the floor's only job is to separate "has shear" from "has none".
    for (const [label, L] of [['L0', L0], ['L1', L1]]) {
      expect(
        worstRowSkew(L),
        `${label} has mutually orthogonal rows in its upper 3x3, which means the\n` +
          'shear is gone and it is a pure scale-and-rotate. Restore the shear or\n' +
          'drop the shear claim from this file`s header.',
      ).toBeGreaterThan(0.02);
    }
  });

  it('the engine palette matches a float64 hand computation', () => withScene((scene) => {
    const { skeleton, expected } = buildStrip(scene);
    const palette = skeleton.getTransformMatrices(null);
    for (let b = 0; b < 2; b++) {
      for (let k = 0; k < 16; k++) {
        expect(
          Math.abs(palette[b * 16 + k] - expected[b][k]),
          `bone ${b} element ${k}: engine ${palette[b * 16 + k]} vs hand ${expected[b][k]}.\n` +
            'The hand form is T(-at_b) · L_b · L_parent; Babylon composes\n' +
            'final_i = local_i · final_parent then premultiplies the absolute inverse\n' +
            'bind. A mismatch here is a composition-ORDER fault, not rounding.',
        ).toBeLessThanOrEqual(ASYM_TOL);
      }
    }
  }));

  it('applySkeleton lands every vertex where the row-vector layout says', () => withScene((scene) => {
    const { skeleton, mesh, expected } = buildStrip(scene);
    mesh.applySkeleton(skeleton);
    const got = mesh.getVerticesData('position');
    const gotNormals = mesh.getVerticesData('normal');

    for (let v = 0; v < STRIP.length; v++) {
      const bone = STRIP_BONES[v];
      const want = applyAffine(expected[bone], 0, STRIP[v]);
      const wantNormal = applyRotation(expected[bone], 0, STRIP_NORMALS[v]);
      // THE DISCRIMINATION, asserted: read the same palette entry transposed
      // and the vertex lands somewhere else entirely. If this separation ever
      // collapses, the fixture has stopped testing what it claims to.
      const transposed = applyAffine(transpose4(expected[bone]), 0, STRIP[v]);
      const separation = Math.hypot(
        want[0] - transposed[0], want[1] - transposed[1], want[2] - transposed[2],
      );
      expect(
        separation,
        `vertex ${v}: a transposed palette read lands in the same place, so this\n` +
          'fixture cannot detect the layout fault it exists for.',
      ).toBeGreaterThan(1);

      for (let c = 0; c < 3; c++) {
        expect(
          Math.abs(got[v * 3 + c] - want[c]),
          `vertex ${v} position ${'xyz'[c]}: engine ${got[v * 3 + c]}, hand ${want[c]},\n` +
            `transposed-layout would be ${transposed[c]} (${separation} away).`,
        ).toBeLessThanOrEqual(ASYM_TOL);
        expect(
          Math.abs(gotNormals[v * 3 + c] - wantNormal[c]),
          `vertex ${v} normal ${'xyz'[c]}: engine ${gotNormals[v * 3 + c]}, hand ${wantNormal[c]}`,
        ).toBeLessThanOrEqual(ASYM_TOL);
      }
    }
  }));
});
