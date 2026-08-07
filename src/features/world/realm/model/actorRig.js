/**
 * actorRig — the SKELETON, derived from the mass genome, as pure data.
 *
 * PURE. No engine, no meshes, no weights. `buildActorRig(id)` reads `pivotsOf`
 * and `archetypeById` (model/actorMasses.js, the locked public entry — never
 * model/actorArchetypes.js) and returns a flat bone array plus a mass-ordinal
 * to bone-index map; `evaluatePose` turns a pose into the skinning palette.
 *
 * THE CANARY POSE LIVES IN model/actorCanary.js, not here. It was here until
 * this file reached 399 lines against a 400 ceiling — one line of headroom
 * means the next task to touch the module has to delete something to add
 * anything, which is how a comment that documents a measured failure gets
 * quietly traded for a line of code. The dependency is ONE-WAY (actorCanary
 * imports buildActorRig; nothing here imports actorCanary), so there is no
 * cycle and no order-dependent import hazard of the kind actorArchetypes.js
 * documents. Consumers import `CANARY_POSE` from model/actorCanary.js.
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
 * cowl bar, and orghon's throat. The failure is measured, not theorised:
 * model/actorArchetypes.js records a 1652-direction sweep from interior points
 * in which 4760 rays reached open surface at orghon's throat BEFORE the weld
 * and 104 AFTER (near stage). Giving that joint a bone undoes the 104.
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
 * ...WHICH IS WHY `buildActorRigOfMasses` EXISTS. Every guard in this file —
 * tree-ness, unknown mass, unheld joint, disconnection, parent order — is
 * unreachable from the four shipped archetypes, because they are all healthy.
 * A guard no test can reach is a guard that can be deleted, inverted or
 * mistyped without anything going red, and this phase already found eight
 * tests that could not fail. So the derivation takes `(masses, pivots,
 * idPrefix)` and `buildActorRig(archetypeId)` is the thin wrapper that
 * resolves the genome — exactly the split model/actorMasses.js made for
 * `pivotsOfMasses`, for exactly the reason it gives: "an untestable constant
 * is the kind that drifts". actorRig.test.js reaches all five with fixtures.
 *
 * EVALUATION IS ONE NON-RECURSIVE FORWARD LOOP. `parent[i] < i` holds by
 * construction (a bone's parent exists before the bone does) and is asserted
 * both at build time and inside `evaluatePose`, which is what lets a single
 * worlds-first pass finish the palette. No recursion, no dirty flag, no cached
 * palette: a stale or half-updated palette is not a state this code can be in.
 */

import { archetypeById, PIVOT_EPS, pivotsOf } from './actorMasses.js';

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
 * The derivation, over a mass list and its pivot table — the testable half.
 * `buildActorRig` is the wrapper that resolves those from an archetype id; see
 * the header on why the seam is here rather than inside it.
 *
 * `bones[i]` is `{boneId, at:[x,y,z], parentIndex, massIds}`. `boneId` is the
 * PIVOT ID the bone hangs from (`unbound.p3`), or `<prefix>.root` for bone 0,
 * so every bone traces back to the `pivotsOf` row that created it and a ring
 * pivot appearing here is visible by name. `at` is the pivot coordinate the
 * bone rotates about; bone 0 uses the root mass's `a`, the inboard end by the
 * roster's authoring convention (a limb's `a` is its parent's joint coordinate
 * — model/actorArchetypes.js).
 *
 * `boneOfMass` is a Uint16Array indexed by MASS ORDINAL (position in `masses`),
 * not by mass id, because that is the index the vertex stream already carries:
 * actorGen tags each vertex with its mass ordinal and Task 4 swaps that for
 * `boneOfMass[ordinal]` with a rigid 1.0 weight.
 */
export function buildActorRigOfMasses(masses, pivots, idPrefix) {
  const ordinalOf = new Map(masses.map((m, i) => [m.id, i]));
  const pivotsAtMass = masses.map(() => []);
  let edges = 0;
  pivots.forEach((p, pi) => {
    for (const mid of p.massIds) {
      const ord = ordinalOf.get(mid);
      if (ord === undefined) throw new Error(`[actorRig] "${idPrefix}" pivot ${p.pivotId} names unknown mass "${mid}"`);
      pivotsAtMass[ord].push(pi);
      edges++;
    }
  });

  // Tree-ness, half one: edge count. A connected graph with nodes-1 edges is a
  // tree; the BFS below proves the connected half by reaching every node.
  const nodes = masses.length + pivots.length;
  if (edges !== nodes - 1) {
    throw new Error(`[actorRig] "${idPrefix}" mass/pivot graph is not a tree: ${edges} incidences across ${nodes} nodes, a tree needs ${nodes - 1}. More means a cycle (a mass reachable two ways, so its bone parent depends on visit order); fewer means a forest (a limb joined to nothing).`);
  }

  const root = pickRoot(masses);
  const bones = [{ boneId: `${idPrefix}.root`, at: [...masses[root].a], parentIndex: -1, massIds: [] }];
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
        throw new Error(`[actorRig] "${idPrefix}" pivot ${p.pivotId} has closure ${p.closure}: neither mechanism holds it shut, so no bone assignment is safe.`);
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
    throw new Error(`[actorRig] "${idPrefix}" mass/pivot graph is disconnected: masses [${orphanMass}] and pivots [${orphanPivot}] are unreachable from root "${masses[root].id}".`);
  }
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].parentIndex >= i) throw new Error(`[actorRig] "${idPrefix}" bone ${i} (${bones[i].boneId}) has parent ${bones[i].parentIndex} >= ${i}. evaluatePose is a single forward pass and reads the parent's palette entry before writing its own; a forward reference would compose against whatever was left in the buffer.`);
  }

  return freezeRig({ archetypeId: idPrefix, bones, boneOfMass });
}

/** `{bones, boneOfMass}` for one shipped archetype. */
export function buildActorRig(archetypeId) {
  const arch = archetypeById(archetypeId);
  if (!arch) throw new Error(`[actorRig] unknown archetype "${archetypeId}"`);
  return buildActorRigOfMasses(arch.masses, pivotsOf(archetypeId), archetypeId);
}

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

/** How far |axis| may sit from 1 before a pose is rejected. */
const AXIS_UNIT_EPS = 1e-6;

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
 * ROUNDING ACCUMULATES PER LEVEL, BY DESIGN. The parent's 3x3 is re-read out of
 * the fp32 palette rather than kept in a float64 side-buffer, so each level of
 * the chain composes against an already-rounded parent — the same thing a GPU
 * doing the skinning would see, which is the point. Measured against a float64
 * reference over the canary pose, the worst point error is 1.359e-7 m at depth
 * 4 (unbound's fist), 5.76e-8 at depth 2, 2.4e-8 at depth 1. Task 4's oracle
 * tolerance should be picked from those numbers, not from fp32 epsilon at the
 * root — a tolerance sized for depth 1 will flake on the graft chain.
 *
 * @param rig from `buildActorRig` — only `rig.bones` is read.
 * @param pose anything indexable by bone index yielding `{axis, angleRad}` (a
 *   plain object, an array, CANARY_POSE's table). Missing entries are the
 *   identity, so `{}` is the rest pose. `axis` must be unit length.
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
    let r = IDENTITY_3X3;
    if (e) {
      // Rodrigues ASSUMES a unit axis. Hand it a scaled one and it returns a
      // matrix that is not a rotation at all — it shears and scales, silently,
      // and every downstream seal and silhouette gate measures the wrong body.
      // Task 3 and Task 7 hand-build poses, so this failure has to be loud.
      const n = Math.hypot(e.axis[0], e.axis[1], e.axis[2]);
      if (Math.abs(n - 1) > AXIS_UNIT_EPS) throw new Error(`[actorRig] bone ${i} (${bone.boneId}) has a non-unit pose axis, |axis| = ${n}. Rodrigues needs a unit axis; a scaled one yields a non-rigid matrix instead of an error.`);
      r = rotAxis(e.axis[0], e.axis[1], e.axis[2], e.angleRad);
    }
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
    // Canonicalise NEGATIVE ZERO. -0 and +0 are the same number to every
    // consumer of this palette, but not to Object.is — which is what
    // `toEqual`, `Map` keys and any byte-level comparison use — and a
    // Float32Array preserves the sign bit. A pose whose axis has a zero
    // component produces them routinely (axis [0.6, 0, -0.8] leaves two per
    // matrix), so without this a rest palette compares unequal to the identity
    // it numerically IS, and Task 4's element-wise comparison against the
    // engine's own matrices reads a phantom mismatch.
    for (let k = o; k < o + 16; k++) if (out[k] === 0) out[k] = 0;
  }
  return out;
}
