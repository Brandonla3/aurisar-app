/**
 * actorRig — the SKELETON, derived from the mass genome, as pure data.
 *
 * PURE. No engine, no meshes, no weights. `buildActorRig(id)` reads `pivotsOf`
 * and `archetypeById` (model/actorMasses.js, the locked public entry — never
 * model/actorArchetypes.js) and returns a flat bone array plus a mass-ordinal
 * to bone-index map; `evaluatePose` turns a pose into the skinning palette.
 *
 * BIND POSE = REST POSE, SO THERE IS NO INVERSE-BIND MATRIX. A skinning
 * palette is normally `world_i · inverseBind_i`, and the inverse-bind is the
 * usual place a rig goes quietly wrong: authored in one tool, stored, and
 * thereafter obliged to stay in lockstep with a rest pose it can no longer
 * see. Here the rest pose IS the bind pose by construction, so every
 * inverse-bind is the identity and the palette is just the NET DEFORMATION a
 * point undergoes: rotate about this bone's pivot, then its parent's, and so
 * on to the root. Nothing is stored, so nothing can desynchronise.
 *
 * The invariant that keeps that honest is BIT-EXACT IDENTITY: at the identity
 * pose every palette matrix must be exactly 1s and 0s in fp32, not 0.9999997.
 * Not cosmetic — Task 2's fp32 twin and Task 4's oracle compare a GPU-skinned
 * vertex against a hand-computed one, and epsilon-scale drift in the unposed
 * palette would force a tolerance wide enough to swallow a genuinely wrong
 * bone too. The exactness falls out of the algebra, not out of rounding: the
 * pivot conjugation's translation is computed as `at - at·R`, which for R = I
 * is a float minus itself and therefore exactly 0, and I·I is exactly I.
 * Verified element-by-element with `toBe`, never `toBeCloseTo`.
 *
 * RING PIVOTS ARE FUSED INTO THE PARENT BONE AND NEVER BECOME BONES. The
 * roster's 22 joints split 17 'cap' / 5 'ring' (model/actorMasses.js's
 * `closureAt` decides which). A 'cap' joint is a sphere centred exactly on the
 * pivot, and a sphere is rotation-invariant about its own centre, so it stays
 * sealed at any angle. A 'ring' joint is two equal-radius coaxial end rings
 * welded vertex-for-vertex, and that weld is a property of the AUTHORED POSE:
 * rotate either side by anything at all and the two rings separate.
 * gen/actorPrimitives.js's header calls this POSE-LOCKED and names the five —
 * legion's face-plate, magistari's robeLower/robeUpper, robeUpper/cowlStem and
 * cowl bar, and orghon's throat — and the failure is measured, not theorised:
 * orghon's throat before it was welded leaked 4760 rays out of 1652 interior
 * directions, and a bone there puts the leak back on the first animated frame.
 *
 * Fusion is therefore not an optimisation. THE SHIPPED COUNTS ARE 8/6/2/5
 * (unbound/legion/magistari/orghon); 8/7/5/6 is the COUNTERFACTUAL — what they
 * would be if fusion broke and rings became bones, measured by running it that
 * way (+1 legion, +3 magistari, +1 orghon), each extra bone a joint that tears.
 *
 * ONE BONE PER CAP PIVOT, which is what makes the shipped counts come out. A
 * pivot joining N masses does NOT spawn N-1 bones: it spawns exactly one,
 * owning every mass on the far side of it, so legs move as a pair and yokes
 * move with the neck they share a pivot with. The rejected alternative — a
 * bone per far-side BRANCH — hands every mass its own bone, so unbound comes
 * out at 11 (its mass count), and invents joints the genome never authored.
 *
 * THE ROOT IS THE HEAVIEST MASS THAT IS NOT HALF OF A MIRRORED PAIR. Capsule
 * volume decides "heaviest", ties break by table order, and any mass with a
 * left/right twin is skipped outright, because a root must not be one of two
 * mirrored siblings. One uniform derived rule, no per-archetype exception, and
 * it gives torso / torso / robeLower / torso. Volume ALONE does not: it picks
 * orghon's hipL (0.162 m3 against thighL 0.110 and torso 0.085), and a hipL
 * root means bone 0 owns the LEFT HIP SLAB alone while its four hip-cluster
 * siblings — the torso among them — hang off bone 1. Same bone count, but the
 * whole body then swings relative to one hip: a left-hip root wearing a
 * pelvis's name, which P9's clips would be stuck with forever. Skipping the
 * hipL/hipR and thighL/thighR mirrors lands on torso, the heaviest centreline
 * mass. The other three are unaffected — their heaviest mass is already on the
 * centreline. All four roots are pinned in actorRig.test.js.
 *
 * TREE-NESS IS ASSERTED, NOT ASSUMED, on the BIPARTITE mass/pivot incidence
 * graph — not the "masses joined where they share a pivot" graph, which is not
 * a tree even when healthy: a pivot joining N masses is an N-clique there, and
 * the roster measures 14/23/14/19 such edges against 10/13/8/10 masses-minus-
 * one. The bipartite graph measures exactly nodes-1 (17/19/12/15) and BFS
 * reaches every node. `pivotsOfMasses` guarantees none of this for a derived
 * roster; a cycle would silently give one mass two parents.
 *
 * CANARY_POSE EXISTS BECAUSE A SKINNING TEST IS TRIVIAL TO WRITE VACUOUSLY.
 * Skin a mesh, pose nothing, compare against the unskinned mesh: it passes,
 * it passes forever, and it passes just as well when every vertex is welded to
 * bone 0. This project has shipped eight tests that could not fail. So every
 * non-root bone gets a rotation, no bone shares an angle with another, and no
 * angle is an integer multiple of another (the prime-degree ladder
 * 7/11/13/17/19/23/29). Strictly these are commensurate — all rational
 * multiples of a degree — but what matters is that swapping two bones,
 * doubling one, or dropping one to zero all change the palette, and a prime
 * ladder guarantees all three. The per-joint axis is ORTHOGONAL to the bone's
 * own limb direction: rotating about a limb's own axis spins a capsule on its
 * centreline and moves almost nothing — the most expensive vacuous canary
 * there is, articulated in the table and inert in the mesh.
 *
 * The ladder runs ASCENDING by bone index — BFS order, so roughly depth order
 * — because angles COMPOUND down a chain and the shallow bones carry the long
 * lever arms. Measured max endpoint displacement: 0.572 / 0.207 / 0.053 /
 * 0.260 m ascending against 0.666 / 0.403 / 0.216 / 0.435 m reversed —
 * ascending wins on all four. Unbound's 0.572 m is the fist, four joints down
 * the graft chain (11+17+23+29 degrees of compounding), and it is the number
 * Task 3's posed seal gate will bind on first. If that gate fails, SHRINK THE
 * ANGLE — never skip the joint, because a skipped joint is exactly the vacuity
 * this table exists to stop.
 *
 * EVALUATION IS ONE NON-RECURSIVE FORWARD LOOP. `parent[i] < i` holds by
 * construction (a bone's parent exists before the bone does) and is asserted
 * both at build time and inside `evaluatePose`, which is what lets a single
 * worlds-first pass finish the palette. No recursion, no dirty flag, no cached
 * palette: a stale or half-updated palette is not a state this code can be in.
 */

import { ARCHETYPES, archetypeById, PIVOT_EPS, pivotsOf } from './actorMasses.js';

/**
 * Object.freeze is shallow — the same trap model/actorArchetypes.js documents
 * for the roster. Freezing a rig leaves `bones`, every bone and every
 * `at`/`massIds` array inside it writable, so one stray push retunes a skeleton
 * several prototypes share. `boneOfMass` is deliberately NOT frozen (freeze
 * throws on a typed array with elements); it is a fresh allocation per call —
 * buildActorRig is not memoised — so a scribble damages only the caller's copy.
 */
function freezeRig(rig) {
  for (const b of rig.bones) {
    Object.freeze(b.at); Object.freeze(b.massIds); Object.freeze(b);
  }
  Object.freeze(rig.bones);
  return Object.freeze(rig);
}

/** Capsule volume — truncated cone plus whichever ends are actually capped. */
function massVolume(m) {
  const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]);
  const cone = ((Math.PI * len) / 3) * (m.r0 * m.r0 + m.r0 * m.r1 + m.r1 * m.r1);
  const capA = m.capA ? (2 / 3) * Math.PI * m.r0 * m.r0 * m.r0 : 0;
  const capB = m.capB ? (2 / 3) * Math.PI * m.r1 * m.r1 * m.r1 : 0;
  return cone + capA + capB;
}

/**
 * Is some OTHER mass this one's reflection across x = 0? Compares a, b, r0, r1
 * and deliberately NOT the cap flags: hipL and hipR are a mirrored pair that
 * differ only in `capA` (at a shared pivot only one of the two carries the
 * cap), so a mirror test reading cap flags would miss exactly the pair this
 * rule exists to catch. Tolerance is PIVOT_EPS — the same one that groups the
 * pivots, so a derived roster's float drift cannot hide a twin here either.
 */
function hasMirrorTwin(m, masses) {
  const flipped = (u, v) => Math.abs(-u[0] - v[0]) <= PIVOT_EPS
    && Math.abs(u[1] - v[1]) <= PIVOT_EPS && Math.abs(u[2] - v[2]) <= PIVOT_EPS;
  return masses.some((o) => o.id !== m.id && flipped(m.a, o.a) && flipped(m.b, o.b)
    && Math.abs(m.r0 - o.r0) <= PIVOT_EPS && Math.abs(m.r1 - o.r1) <= PIVOT_EPS);
}

/** Heaviest mass with no mirror twin — heaviest overall if every mass has one. */
function pickRoot(masses) {
  const vol = masses.map(massVolume);
  const heaviest = (pool) => pool.reduce((a, b) => (vol[b] > vol[a] ? b : a));
  const centreline = masses.map((_, i) => i).filter((i) => !hasMirrorTwin(masses[i], masses));
  return heaviest(centreline.length ? centreline : masses.map((_, i) => i));
}

/**
 * `{bones, boneOfMass}` for one archetype.
 *
 * `bones[i]` is `{boneId, at:[x,y,z], parentIndex, massIds}`. `boneId` is the
 * PIVOT ID the bone hangs from (`unbound.p3`), or `<id>.root` for bone 0, so
 * every bone traces back to the `pivotsOf` row that created it and a ring pivot
 * appearing here is visible by name. `at` is the pivot coordinate the bone
 * rotates about; bone 0 uses the root mass's `a`, the inboard end by the
 * roster's authoring convention (a limb's `a` is its parent's joint coordinate
 * — model/actorArchetypes.js).
 *
 * `boneOfMass` is a Uint16Array indexed by MASS ORDINAL (position in
 * `archetype.masses`), not by mass id, because that is the index the vertex
 * stream already carries: actorGen tags each vertex with its mass ordinal and
 * Task 4 swaps that for `boneOfMass[ordinal]` with a rigid 1.0 weight.
 */
export function buildActorRig(archetypeId) {
  const arch = archetypeById(archetypeId);
  if (!arch) throw new Error(`[actorRig] unknown archetype "${archetypeId}"`);
  const masses = arch.masses;
  const pivots = pivotsOf(archetypeId);

  const ordinalOf = new Map(masses.map((m, i) => [m.id, i]));
  const pivotsAtMass = masses.map(() => []);
  let edges = 0;
  pivots.forEach((p, pi) => {
    for (const mid of p.massIds) {
      const ord = ordinalOf.get(mid);
      if (ord === undefined) throw new Error(`[actorRig] "${archetypeId}" pivot ${p.pivotId} names unknown mass "${mid}"`);
      pivotsAtMass[ord].push(pi);
      edges++;
    }
  });

  // Tree-ness, half one: edge count. A connected graph with nodes-1 edges is a
  // tree; the BFS below proves the connected half by reaching every node.
  const nodes = masses.length + pivots.length;
  if (edges !== nodes - 1) {
    throw new Error(`[actorRig] "${archetypeId}" mass/pivot graph is not a tree: ${edges} incidences across ${nodes} nodes, a tree needs ${nodes - 1}. More means a cycle (a mass reachable two ways, so its bone parent depends on visit order); fewer means a forest (a limb joined to nothing).`);
  }

  const root = pickRoot(masses);
  const bones = [{ boneId: `${archetypeId}.root`, at: [...masses[root].a], parentIndex: -1, massIds: [] }];
  const boneOfMass = new Uint16Array(masses.length);
  const seenMass = masses.map(() => false);
  const seenPivot = pivots.map(() => false);
  const queue = [[root, 0]];
  seenMass[root] = true;

  // FIFO BFS over masses. Crossing a 'cap' pivot opens exactly one new bone
  // owning everything beyond it; crossing a 'ring' pivot opens none and the
  // far side fuses into the bone we arrived on.
  for (let head = 0; head < queue.length; head++) {
    const [mi, bi] = queue[head];
    boneOfMass[mi] = bi;
    bones[bi].massIds.push(masses[mi].id);
    for (const pi of pivotsAtMass[mi]) {
      if (seenPivot[pi]) continue;
      seenPivot[pi] = true;
      const p = pivots[pi];
      if (p.closure !== 'cap' && p.closure !== 'ring') {
        throw new Error(`[actorRig] "${archetypeId}" pivot ${p.pivotId} has closure ${p.closure}: neither mechanism holds it shut, so no bone assignment is safe.`);
      }
      let child = bi;
      if (p.closure === 'cap') {
        child = bones.length;
        bones.push({ boneId: p.pivotId, at: [...p.at], parentIndex: bi, massIds: [] });
      }
      for (const mid of p.massIds) {
        const mj = ordinalOf.get(mid);
        if (seenMass[mj]) continue;
        seenMass[mj] = true;
        queue.push([mj, child]);
      }
    }
  }

  // Tree-ness, half two: connectivity.
  const orphanMass = masses.filter((_, i) => !seenMass[i]).map((m) => m.id);
  const orphanPivot = pivots.filter((_, i) => !seenPivot[i]).map((p) => p.pivotId);
  if (orphanMass.length || orphanPivot.length) {
    throw new Error(`[actorRig] "${archetypeId}" mass/pivot graph is disconnected: masses [${orphanMass}] and pivots [${orphanPivot}] are unreachable from root "${masses[root].id}".`);
  }
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].parentIndex >= i) throw new Error(`[actorRig] "${archetypeId}" bone ${i} (${bones[i].boneId}) has parent ${bones[i].parentIndex} >= ${i}. evaluatePose is a single forward pass and reads the parent's palette entry before writing its own; a forward reference would compose against whatever was left in the buffer.`);
  }

  return freezeRig({ archetypeId, bones, boneOfMass });
}

/**
 * Distinct, non-multiple canary angles in DEGREES. Seven entries because the
 * roster's deepest rig (unbound) has seven non-root bones; a fifth archetype
 * with more runs off the end, which `canaryPoseFor` refuses loudly rather than
 * wrapping the ladder and quietly duplicating an angle.
 */
export const CANARY_LADDER_DEG = Object.freeze([7, 11, 13, 17, 19, 23, 29]);

const DEG = Math.PI / 180;

/**
 * A unit axis orthogonal to `dir`: the world axis LEAST parallel to it,
 * Gram-Schmidt'd. That axis always has |dot| <= 1/sqrt(3), so the rejected
 * vector is never shorter than sqrt(1 - 1/3) = 0.816 and the normalise is
 * safe; across the shipped roster the shortest is 0.988.
 */
function orthogonalAxis(dir) {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(dir[i]) < Math.abs(dir[k])) k = i;
  const d = dir[k];
  const v = [-d * dir[0], -d * dir[1], -d * dir[2]];
  v[k] += 1;
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The bone's limb direction: the sum of (outboard endpoint - pivot) over the
 * masses it owns, length-weighted so a long limb outvotes a stub. A left/right
 * pair cancels exactly if the bone owns nothing else, so that degenerate case
 * falls back to the first owned mass's own axis.
 */
function limbDirection(bone, massById) {
  let d = [0, 0, 0];
  for (const mid of bone.massIds) {
    const m = massById.get(mid);
    const da = Math.hypot(m.a[0] - bone.at[0], m.a[1] - bone.at[1], m.a[2] - bone.at[2]);
    const db = Math.hypot(m.b[0] - bone.at[0], m.b[1] - bone.at[1], m.b[2] - bone.at[2]);
    const far = db >= da ? m.b : m.a;
    d = [d[0] + far[0] - bone.at[0], d[1] + far[1] - bone.at[1], d[2] + far[2] - bone.at[2]];
  }
  let len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) {
    const m = massById.get(bone.massIds[0]);
    d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]];
    len = Math.hypot(d[0], d[1], d[2]);
  }
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** The canary table for one archetype: `{boneIndex: {axis, angleRad}}`. */
function canaryPoseFor(archetypeId) {
  const rig = buildActorRig(archetypeId);
  const massById = new Map(archetypeById(archetypeId).masses.map((m) => [m.id, m]));
  const nonRoot = rig.bones.length - 1;
  if (nonRoot > CANARY_LADDER_DEG.length) throw new Error(`[actorRig] "${archetypeId}" has ${nonRoot} non-root bones but the canary ladder holds ${CANARY_LADDER_DEG.length} distinct angles. Extend the ladder with further primes; do not wrap it.`);
  const table = {};
  for (let i = 1; i < rig.bones.length; i++) {
    table[i] = Object.freeze({
      axis: Object.freeze(orthogonalAxis(limbDirection(rig.bones[i], massById))),
      angleRad: CANARY_LADDER_DEG[i - 1] * DEG,
    });
  }
  return Object.freeze(table);
}

/**
 * `CANARY_POSE[archetypeId]` — the pose every downstream gate poses with. Plain
 * frozen data, built once at module load and never regenerated, so the table
 * Task 3 measures against is byte-identical to the one Task 4 replays.
 */
export const CANARY_POSE = Object.freeze(
  Object.fromEntries(ARCHETYPES.map((a) => [a.id, canaryPoseFor(a.id)])),
);

/**
 * Rodrigues rotation about a unit axis, row-major 3x3 in the ROW-VECTOR
 * convention (v' = v·M) — the same convention and expansion as
 * model/instanceMatrix.js's `rotAxis`, which is the layout the engine's
 * `Matrix` uses. At angle 0 this is exactly the identity: sin 0 is exactly 0
 * and cos 0 exactly 1, so every entry is an exact 0 or 1 with no rounding.
 */
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

/** Identity rotation, shared. Never mutated; `rotAxis` always allocates fresh. */
const IDENTITY_3X3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * The skinning palette: 16 floats per bone, row-major, translation in
 * elements 12..14 — the exact layout `Skeleton.getTransformMatrices` emits,
 * so Task 4 can drop this straight into the comparison without transposing.
 *
 * Each bone contributes `T(-at) · R · T(at)` — rotate about its own pivot —
 * and a point rigidly attached to bone i is articulated by bone i first, then
 * by its parent, then its parent's parent. In row-vector order that reads
 * `M_i = A_i · M_parent`, which is the multiply below and NOT its mirror
 * image; the two differ on any chain with two rotated joints, and the
 * two-bone fixture in actorRig.test.js is there to catch the mirror.
 *
 * @param rig from `buildActorRig` — only `rig.bones` is read.
 * @param pose anything indexable by bone index yielding `{axis, angleRad}` (a
 *   plain object, an array, CANARY_POSE's table). Missing entries are the
 *   identity, so `{}` is the rest pose.
 * @returns Float32Array(16 * boneCount), fresh every call — no cached palette.
 */
export function evaluatePose(rig, pose) {
  const bones = rig.bones;
  const out = new Float32Array(bones.length * 16);
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    const p = bone.parentIndex;
    if (p >= i) throw new Error(`[actorRig] bone ${i} (${bone.boneId}) declares parent ${p}; this single forward pass requires parent < index.`);
    const e = pose ? pose[i] : undefined;
    const r = e ? rotAxis(e.axis[0], e.axis[1], e.axis[2], e.angleRad) : IDENTITY_3X3;
    const at = bone.at;
    // Translation of the pivot conjugation, as `at - at·R`. At R = I this is a
    // float minus itself: exactly 0, which is what makes the rest palette
    // bit-exact rather than merely close.
    let tx = at[0] - (at[0] * r[0] + at[1] * r[3] + at[2] * r[6]);
    let ty = at[1] - (at[0] * r[1] + at[1] * r[4] + at[2] * r[7]);
    let tz = at[2] - (at[0] * r[2] + at[1] * r[5] + at[2] * r[8]);
    let m = r;
    if (p >= 0) {
      const q = p * 16;
      const pr = [out[q], out[q + 1], out[q + 2], out[q + 4], out[q + 5], out[q + 6], out[q + 8], out[q + 9], out[q + 10]];
      m = new Array(9);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          m[row * 3 + col] = r[row * 3] * pr[col] + r[row * 3 + 1] * pr[3 + col] + r[row * 3 + 2] * pr[6 + col];
        }
      }
      const [x, y, z] = [tx, ty, tz];
      tx = x * pr[0] + y * pr[3] + z * pr[6] + out[q + 12];
      ty = x * pr[1] + y * pr[4] + z * pr[7] + out[q + 13];
      tz = x * pr[2] + y * pr[5] + z * pr[8] + out[q + 14];
    }
    const o = i * 16;
    out[o] = m[0]; out[o + 1] = m[1]; out[o + 2] = m[2]; out[o + 3] = 0;
    out[o + 4] = m[3]; out[o + 5] = m[4]; out[o + 6] = m[5]; out[o + 7] = 0;
    out[o + 8] = m[6]; out[o + 9] = m[7]; out[o + 10] = m[8]; out[o + 11] = 0;
    out[o + 12] = tx; out[o + 13] = ty; out[o + 14] = tz; out[o + 15] = 1;
  }
  return out;
}
