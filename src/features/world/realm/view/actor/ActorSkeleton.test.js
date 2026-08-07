/**
 * ActorSkeleton.test.js — THE ORACLE. The one gate in this phase that proves
 * the matrix pipeline against the ENGINE rather than against itself.
 *
 * Everything before this compares pure code to pure code: `evaluatePose` to a
 * hand-written reference, `skinPayload` to `evaluatePose`. All of it can be
 * internally consistent and uniformly wrong the moment Babylon's `Skeleton`
 * reads it — a transposed local matrix, a bind matrix that is not the rest
 * matrix, a palette slot order that does not match the bone order.
 * `Mesh.applySkeleton` consumes the EXACT SAME `getTransformMatrices()` array
 * the GPU vertex shader is handed, so comparing its output against
 * `skinPayload(evaluatePose(...))` closes the loop end-to-end — tree, binds,
 * palette order and matrix layout — in one number.
 *
 * TOLERANCE IS MEASURED, NEVER ASSUMED (Task 2 ledgered the reason: the twin
 * rounds twice per term by design, while Babylon's
 * `Vector3.TransformCoordinatesFromFloatsToRef` computes the whole dot product
 * in float64 and rounds once on store — the two CANNOT be bit-identical).
 * Worst component delta, all four archetypes, near stage, under CANARY_POSE:
 *
 *     positions   unbound 2.384e-7  legion 2.384e-7  magistari 2.384e-7  orghon 1.192e-7
 *     normals     unbound 8.941e-8  legion 5.960e-8  magistari 5.960e-8   orghon 8.941e-8
 *
 * — 1-2 ULP at those magnitudes. The tolerances below are pinned from those
 * numbers. Anything structural measures in centimetres to metres, four to
 * seven orders of magnitude away.
 *
 * ── THREE ENGINE TRAPS THIS FILE IS BUILT AROUND, EACH ASSERTED ────────────
 *
 * (1) `Mesh.applySkeleton` SILENTLY DOES NOTHING when called twice in the same
 *     frame — its first line is
 *     `if (geometry._softwareSkinningFrameId == scene.getFrameId()) return`,
 *     and a headless scene's frame id is 0 forever. A "rest is a no-op"
 *     assertion would pass gloriously against a mesh that was never skinned at
 *     all, so every `applySkeleton` here gets its OWN fresh mesh.
 * (2) `Skeleton.prepare()` short-circuits on an unchanged render id, which
 *     never advances headless either — a posed skeleton would keep serving its
 *     construction-time palette. `setPose` forces the recompute.
 * (3) `Mesh.clone()` copies the SKELETON REFERENCE, which is the whole reason
 *     `buildActorSkeleton` is per-rig.
 *
 * EXPECTED LOG NOISE: NONE, and that is itself worth recording. The brief
 * expected a per-skeleton `... bones stored as vertex uniforms ...` warning on
 * every headless skinned prepare. MEASURED: this suite emits nothing but
 * Babylon's `- Null engine` banner. That warning lives on the MATERIAL path
 * (raised while preparing bone defines, comparing `4 * BonesPerMesh` against
 * `maxVertexUniformVectors - 40`) and nothing here builds a material. It WILL
 * appear when Task 6 splices `BonesBlock` into actorNME: NullEngine reports
 * `maxVertexUniformVectors = 16`, so the usable budget computes to 0 and the
 * warning fires unconditionally on a null device — a headless artefact of a
 * fake capability report, not a real budget problem. ActorSkeleton.js's
 * uniform-path pin has the real numbers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { buildActorRig, evaluatePose } from '../../model/actorRig.js';
import { CANARY_POSE } from '../../model/actorCanary.js';
import { buildActorPayload } from '../../gen/actorGen.js';
import { skinPayload } from '../../gen/actorSkin.js';

let buildActorSkeleton;
let engine;

beforeAll(async () => {
  // Load-bearing order: view/ modules read the ambient BABYLON global at
  // import time, so the global must exist BEFORE the dynamic import.
  globalThis.BABYLON = BABYLON;
  ({ buildActorSkeleton } = await import('./ActorSkeleton.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

/** A fresh scene per test, always disposed — meshes outlive a leaked one. */
function withScene(fn) {
  const scene = new BABYLON.Scene(engine);
  try { return fn(scene); } finally { scene.dispose(); }
}

const IDS = ['unbound', 'legion', 'magistari', 'orghon'];

/**
 * The archetype every SINGLE-archetype assertion uses. Ledgered Task 1 review
 * fact: magistari's rig has two bones, so a bug that welds every vertex to
 * bone 0 is nearly invisible on it. Unbound has eight and the roster's deepest
 * chain, which is where composition-order and accumulation faults show first.
 * Magistari is covered by every all-archetype loop here, but never alone.
 */
const DEEP_FIXTURE = 'unbound';

/** Near stage. Task 5's tier swap is what exercises the far one. */
const NEAR = 0;

const IDENTITY_16 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Next power of two above the worst measured 2.384e-7 (= 2^-22 exactly). */
const POSITION_TOL = 2 ** -21;

/**
 * Worst measured normal delta is 8.94e-8 — 1.5 ULP for a unit-ish component.
 * The next power of two up is 2^-23, only 1.33x headroom on a 1.5-ULP
 * measurement, so this takes one further doubling to 4 ULP. Still 1e5 times
 * below any structural error.
 */
const NORMAL_TOL = 2 ** -22;

/**
 * The asymmetric fixture below SCALES by up to 2.4x, so its palette entries
 * reach magnitude 5.6 and its skinned vertices 10.3 — where one fp32 ULP is
 * already 4.8e-7 and 9.5e-7, i.e. POSITION_TOL is one ULP there and would
 * flake on rounding alone. Worst measured on it: palette 5.00e-7, positions
 * 6.39e-7, normals 6.98e-8. Two ULP at its largest magnitude; the layout fault
 * it exists to catch separates by at least 1.36, some 700,000 times wider.
 */
const ASYM_TOL = 2 ** -19;

/**
 * Per-bone travel floor under the canary pose. Not decoration: the oracle
 * passes vacuously if the fixture welds everything to bone 0 or if some bone's
 * matrix is quietly the identity, because then BOTH sides compute the same
 * nothing. Sits just under model/actorCanary.js's measured 0.0288 m worst.
 */
const MIN_BONE_TRAVEL = 0.02;

// ── float64 references, COPIED not imported ────────────────────────────────
// The oracle's independence rests on these being written here. `applyAffine`
// is copied verbatim from model/actorRig.test.js and gen/actorSkin.test.js,
// for the reason those files give: importing the helper of the thing under
// test proves the test's arithmetic, not the module's.

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

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * An UPDATABLE mesh carrying the real generator's payload plus the two
 * skinning attributes, rigid single-influence: bone
 * `boneOfMass[massIndex[v]]`, weight 1. Built here rather than cloned off
 * ActorPrototypes' masters because those are non-updatable and SHARED, and
 * `applySkeleton` ends in `updateVerticesData` — skinning a clone would write
 * through to every actor holding that geometry. Fresh per call: trap (1).
 */
function skinnedMesh(scene, payload, rig, name) {
  const mesh = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = new Float32Array(payload.positions);
  vd.normals = new Float32Array(payload.normals);
  vd.indices = payload.indices;
  const verts = payload.massIndex.length;
  const indices = new Float32Array(verts * 4);
  const weights = new Float32Array(verts * 4);
  for (let v = 0; v < verts; v++) {
    indices[v * 4] = rig.boneOfMass[payload.massIndex[v]];
    weights[v * 4] = 1;
  }
  vd.matricesIndices = indices;
  vd.matricesWeights = weights;
  vd.applyToMesh(mesh, true);
  return mesh;
}

/** Everything one archetype's run needs. */
function actorCase(scene, id) {
  const rig = buildActorRig(id);
  const payload = buildActorPayload(id, NEAR);
  return { rig, payload, ...buildActorSkeleton(scene, rig, id) };
}

/** Palette entries that are not EXACTLY the identity — `Object.is`-strict. */
function identityMismatches(palette) {
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    if (!Object.is(palette[i], IDENTITY_16[i % 16])) out.push([i, palette[i]]);
  }
  return out;
}

/** Worst component delta between two vertex streams, named down to the mass. */
function worstDelta(got, want, payload, rig) {
  let worst = { delta: -1 };
  for (let i = 0; i < want.length; i++) {
    const delta = Math.abs(got[i] - want[i]);
    if (delta > worst.delta) {
      const vertex = Math.floor(i / 3);
      const mass = payload.massIndex[vertex];
      worst = {
        delta, vertex, mass, bone: rig.boneOfMass[mass], axis: 'xyz'[i % 3], got: got[i], want: want[i],
      };
    }
  }
  return worst;
}

const describeWorst = (w) => `worst ${w.delta} at vertex ${w.vertex} (mass ordinal ${w.mass}, bone ${w.bone}), ${w.axis}: got ${w.got}, want ${w.want}`;

// ── the tests ──────────────────────────────────────────────────────────────

describe('buildActorSkeleton — rest', () => {
  for (const id of IDS) {
    it(`${id}: the palette is BIT-EXACT identity, and applySkeleton a no-op`, () => withScene((scene) => {
      const { rig, payload, skeleton } = actorCase(scene, id);
      const palette = skeleton.getTransformMatrices(null);

      // Babylon appends one identity pad slot past the last bone; asserting
      // the length pins the bone count and that convention together.
      expect(palette.length).toBe(16 * (rig.bones.length + 1));
      expect(
        identityMismatches(palette),
        'bind = rest makes absoluteInverseBind_i · final_i into T(-at_i) · T(at_i),\n' +
          'which is EXACTLY the identity, not approximately. A -0 fails here too:\n' +
          'model/actorRig.js canonicalises signed zeros out of its own palette so the\n' +
          'two can be compared element for element.',
      ).toEqual([]);

      const mesh = skinnedMesh(scene, payload, rig, `${id}_rest`);
      mesh.applySkeleton(skeleton);

      const positions = mesh.getVerticesData('position');
      const badPositions = [];
      for (let i = 0; i < positions.length; i++) {
        if (!Object.is(positions[i], Math.fround(payload.positions[i]))) badPositions.push(i);
      }
      expect(badPositions).toEqual([]);

      // NORMALS ARE BIT-EXACT EXCEPT FOR THE SIGN OF ZERO — a measured engine
      // fact, pinned rather than hidden behind a tolerance. Task 2 found the
      // roster authors 134 `-0` normal components; Babylon's
      // TransformNormalFromFloatsToRef computes `x*m0 + y*m4 + z*m8`
      // unconditionally and at the identity the two zero-coefficient terms
      // turn `-0` into `+0` (IEEE 754: -0 + +0 = +0), while gen/actorSkin.js
      // skips those terms precisely to preserve them. The count must equal
      // the source's `-0` count: more would be a real numerical difference
      // wearing a signed zero's clothes.
      const normals = mesh.getVerticesData('normal');
      let signOnly = 0;
      let sourceMinusZero = 0;
      const realMismatches = [];
      for (let i = 0; i < normals.length; i++) {
        const want = Math.fround(payload.normals[i]);
        if (Object.is(want, -0)) sourceMinusZero++;
        if (Object.is(normals[i], want)) continue;
        if (normals[i] === want) signOnly++;
        else realMismatches.push([i, normals[i], want]);
      }
      expect(realMismatches).toEqual([]);
      expect(signOnly).toBe(sourceMinusZero);
      expect(sourceMinusZero, 'no -0 normals here would make the pin above vacuous').toBeGreaterThan(0);
    }));

    it(`${id}: rest() after a pose returns the palette to BIT-EXACT identity`, () => withScene((scene) => {
      const { skeleton, setPose, rest } = actorCase(scene, id);
      setPose(CANARY_POSE[id]);
      expect(identityMismatches(skeleton.getTransformMatrices(null)).length).toBeGreaterThan(0);
      rest();
      expect(identityMismatches(skeleton.getTransformMatrices(null))).toEqual([]);
    }));
  }
});

describe('buildActorSkeleton — THE CANARY ORACLE', () => {
  for (const id of IDS) {
    it(`${id}: applySkeleton agrees with skinPayload(evaluatePose(CANARY_POSE))`, () => withScene((scene) => {
      const {
        rig, payload, skeleton, setPose,
      } = actorCase(scene, id);
      setPose(CANARY_POSE[id]);

      const mesh = skinnedMesh(scene, payload, rig, `${id}_posed`);
      mesh.applySkeleton(skeleton);
      const gotPositions = mesh.getVerticesData('position');
      const gotNormals = mesh.getVerticesData('normal');
      const twin = skinPayload(payload, rig, evaluatePose(rig, CANARY_POSE[id]));

      const wp = worstDelta(gotPositions, twin.positions, payload, rig);
      expect(
        wp.delta,
        `POSITIONS diverge: ${describeWorst(wp)}.\n` +
          'This compares Babylon`s own getTransformMatrices() — the array the GPU\n' +
          'vertex shader is handed — against the pure twin. A structural fault\n' +
          '(transposed local matrix, wrong bind, scrambled bone index) measures in\n' +
          'centimetres; fp32 rounding measures ~2.4e-7.',
      ).toBeLessThanOrEqual(POSITION_TOL);

      const wn = worstDelta(gotNormals, twin.normals, payload, rig);
      expect(wn.delta, `NORMALS diverge: ${describeWorst(wn)}`).toBeLessThanOrEqual(NORMAL_TOL);

      // ── ANTI-VACUITY. Both sides agreeing on "nothing moved" would pass
      // everything above. Every non-root bone must have deformed the vertices
      // that belong to it; bone 0 is unposed by CANARY_POSE, so its own must
      // not have moved at all.
      const travel = new Array(rig.bones.length).fill(0);
      for (let v = 0; v < payload.massIndex.length; v++) {
        const bone = rig.boneOfMass[payload.massIndex[v]];
        const i = v * 3;
        travel[bone] = Math.max(travel[bone], Math.hypot(
          gotPositions[i] - payload.positions[i],
          gotPositions[i + 1] - payload.positions[i + 1],
          gotPositions[i + 2] - payload.positions[i + 2],
        ));
      }
      const inert = travel
        .map((t, b) => (b > 0 && t < MIN_BONE_TRAVEL ? `bone ${b} (${rig.bones[b].boneId}) moved ${t}` : null))
        .filter(Boolean);
      expect(
        inert,
        'A bone whose vertices did not move is a bone the oracle cannot see: it\n' +
          'passes the comparison above by agreeing with the twin about nothing.',
      ).toEqual([]);
      expect(travel[0], 'bone 0 is unposed by CANARY_POSE').toBe(0);

      // ...and the fixture must really bind to every bone, not weld to one.
      const used = new Set([...payload.massIndex].map((m) => rig.boneOfMass[m]));
      expect([...used].sort((a, b) => a - b)).toEqual(rig.bones.map((_, i) => i));
    }));
  }

  it('posing is visible in the palette immediately, without a render', () => withScene((scene) => {
  // Trap (2). If setPose did not force the recompute, every posed assertion
  // in this file would silently be measuring the construction-time identity.
    const { rig, skeleton, setPose } = actorCase(scene, DEEP_FIXTURE);
    expect(scene.getRenderId()).toBe(0);
    setPose(CANARY_POSE[DEEP_FIXTURE]);
    const palette = skeleton.getTransformMatrices(null);
    const twin = evaluatePose(rig, CANARY_POSE[DEEP_FIXTURE]);
    let worst = 0;
    for (let i = 0; i < twin.length; i++) worst = Math.max(worst, Math.abs(palette[i] - twin[i]));
    expect(worst, 'engine palette vs evaluatePose, element for element').toBeLessThanOrEqual(POSITION_TOL);
    expect(scene.getRenderId(), 'nothing here may need a render to be true').toBe(0);
  }));

  it('skinning is once-per-frame per mesh — trap (1), asserted', () => withScene((scene) => {
  // Babylon's property, not ours, but every fixture here is built around it.
  // Recorded so a future reader who reuses a mesh finds out from a test
  // rather than from a green run that proves nothing.
    const {
      rig, payload, skeleton, setPose, rest,
    } = actorCase(scene, DEEP_FIXTURE);
    const mesh = skinnedMesh(scene, payload, rig, 'once');
    setPose(CANARY_POSE[DEEP_FIXTURE]);
    mesh.applySkeleton(skeleton);
    const posed = Float32Array.from(mesh.getVerticesData('position'));

    rest();
    mesh.applySkeleton(skeleton);
    expect(
      Float32Array.from(mesh.getVerticesData('position')),
      'If this stops being a no-op, Babylon changed and the fresh-mesh-per-\n' +
        'applySkeleton discipline here can relax. Until then, reusing a mesh\n' +
        'silently skins nothing.',
    ).toEqual(posed);
    expect(scene.getFrameId()).toBe(0);
  }));
});

describe('buildActorSkeleton — THE ASYMMETRIC FIXTURE', () => {
  /**
   * Pure rotations masked three phases of render-criticals, because a rotation
   * is orthogonal: its transpose IS its inverse, so a transposed or
   * column-major-misread palette still produces a rigid, plausible body. This
   * fixture is the antidote — shear 0.35, non-uniform scale and an odd-angle
   * rotation, so M^T is nothing like M^-1 and any layout confusion lands the
   * vertex somewhere numerically distinct. That separation is ASSERTED, not
   * assumed obvious.
   *
   * The reference is hand-computed here in float64, never through
   * gen/actorSkin.js: the twin's contract is RIGID palettes only (its normals
   * take the rotation part verbatim, which is the inverse-transpose only for
   * orthogonal matrices) and this fixture deliberately violates exactly that.
   * Feeding it to the twin would compare against a function documented not to
   * be correct here.
   */
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

describe('buildActorSkeleton — independence', () => {
  it('Mesh.clone() SHARES the skeleton reference — the trap, as a live fact', () => withScene((scene) => {
    const { rig, payload, skeleton } = actorCase(scene, DEEP_FIXTURE);
    const mesh = skinnedMesh(scene, payload, rig, 'master');
    mesh.skeleton = skeleton;
    expect(
      mesh.clone('cloned').skeleton,
      'This is why buildActorSkeleton is per-rig. If Babylon ever deep-copies the\n' +
        'skeleton on clone the rule becomes belt-and-braces — but it does not today.',
    ).toBe(skeleton);
  }));

  it('two skeletons of the same archetype pose independently', () => withScene((scene) => {
    const rig = buildActorRig(DEEP_FIXTURE);
    const payload = buildActorPayload(DEEP_FIXTURE, NEAR);
    const a = buildActorSkeleton(scene, rig, 'actorA');
    const b = buildActorSkeleton(scene, rig, 'actorB');

    expect(a.skeleton).not.toBe(b.skeleton);
    expect(a.skeleton.bones[1]).not.toBe(b.skeleton.bones[1]);
    expect(a.skeleton.getTransformMatrices(null)).not.toBe(b.skeleton.getTransformMatrices(null));

    a.setPose(CANARY_POSE[DEEP_FIXTURE]);
    expect(identityMismatches(a.skeleton.getTransformMatrices(null)).length).toBeGreaterThan(0);
    expect(
      identityMismatches(b.skeleton.getTransformMatrices(null)),
      'B was never posed. If it moved, the two actors share bone state.',
    ).toEqual([]);

    const meshA = skinnedMesh(scene, payload, rig, 'meshA');
    const meshB = skinnedMesh(scene, payload, rig, 'meshB');
    meshA.applySkeleton(a.skeleton);
    meshB.applySkeleton(b.skeleton);
    const pa = meshA.getVerticesData('position');
    const pb = meshB.getVerticesData('position');

    let movedA = 0;
    let movedB = 0;
    for (let i = 0; i < pa.length; i++) {
      movedA = Math.max(movedA, Math.abs(pa[i] - Math.fround(payload.positions[i])));
      movedB = Math.max(movedB, Math.abs(pb[i] - Math.fround(payload.positions[i])));
    }
    expect(movedA).toBeGreaterThan(0.1);
    expect(movedB).toBe(0);
  }));
});

describe('buildActorSkeleton — THE PIN and the wiring', () => {
  it('NullEngine reports textureFloat = false — the premise of the pin', () => {
    // The pin's argument is that headless and real GPUs would otherwise take
    // DIFFERENT palette-upload paths. That rests on this capability report, so
    // it is checked rather than recited.
    expect(engine.getCaps().textureFloat).toBe(false);
  });

  for (const id of IDS) {
    it(`${id}: the uniform path is pinned, and the wiring matches the rig`, () => withScene((scene) => {
      const { rig, skeleton, setPose } = actorCase(scene, id);

      expect(
        skeleton.useTextureToStoreBoneMatrices,
        'THE PIN. True here means a real GPU uploads the palette through a float\n' +
          'texture while every test in this file exercises the uniform path — the\n' +
          'tested path stops being the shipped path, in the skinning upload, which is\n' +
          'where this project has been burned three phases running.',
      ).toBe(false);
      expect(skeleton.isUsingTextureForMatrices).toBe(false);
      expect(
        skeleton.needInitialSkinMatrix,
        'true makes the palette per-MESH and folds in that mesh`s pose matrix',
      ).toBe(false);

      expect(skeleton.getClassName()).toBe('Skeleton');
      expect(skeleton.bones.length).toBe(rig.bones.length);

      for (let i = 0; i < rig.bones.length; i++) {
        const bone = skeleton.bones[i];
        const spec = rig.bones[i];
        expect(bone.getClassName()).toBe('Bone');
        expect(bone.name).toBe(spec.boneId);
        expect(bone.getIndex(), 'palette slot order must equal rig bone order').toBe(i);
        expect(bone.getParent()).toBe(spec.parentIndex >= 0 ? skeleton.bones[spec.parentIndex] : null);
      }

      // BIND = REST, STILL, AFTER POSING. `Bone.updateMatrix` — the obvious
      // non-underscored way to set a bone matrix — copies into the BIND
      // matrix first. Posing through it would move the bind pose to wherever
      // the actor currently is, the palette would read identity at the posed
      // pose, and the mesh would never deform: a perfectly rigid, perfectly
      // plausible character. This assertion forecloses it.
      setPose(CANARY_POSE[id]);
      for (let i = 0; i < rig.bones.length; i++) {
        const spec = rig.bones[i];
        const parentAt = spec.parentIndex >= 0 ? rig.bones[spec.parentIndex].at : [0, 0, 0];
        const want = BABYLON.Matrix.Translation(
          spec.at[0] - parentAt[0], spec.at[1] - parentAt[1], spec.at[2] - parentAt[2],
        );
        expect([...skeleton.bones[i].getBindMatrix().m]).toEqual([...want.m]);
      }
    }));
  }
});

describe('buildActorSkeleton — guards', () => {
  it('rejects a non-unit pose axis, where the engine would silently normalise', () => withScene((scene) => {
    const { setPose } = actorCase(scene, DEEP_FIXTURE);
    expect(() => setPose({ 1: { axis: [0, 2, 0], angleRad: 0.3 } }))
      .toThrow(/non-unit pose axis, \|axis\| = 2/);
  }));

  it('rejects a pose key outside the bone range instead of posing nothing', () => withScene((scene) => {
    const { rig, setPose } = actorCase(scene, DEEP_FIXTURE);
    expect(() => setPose({ [rig.bones.length]: { axis: [0, 1, 0], angleRad: 0.3 } }))
      .toThrow(/pose names bone/);
  }));

  it('rejects a forward parent reference, which Babylon reads as a second root', () => withScene((scene) => {
    const bad = {
      archetypeId: 'synthetic',
      bones: [
        { boneId: 'a', at: [0, 0, 0], parentIndex: -1 },
        { boneId: 'b', at: [0, 1, 0], parentIndex: 2 },
        { boneId: 'c', at: [0, 2, 0], parentIndex: 1 },
      ],
    };
    expect(() => buildActorSkeleton(scene, bad, 'synthetic')).toThrow(/declares parent 2/);
  }));
});
