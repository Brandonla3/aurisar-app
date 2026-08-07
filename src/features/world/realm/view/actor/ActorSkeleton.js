/**
 * ActorSkeleton — model/actorRig.js's derived bone tree, as a live
 * `BABYLON.Skeleton`. The first engine-side skeleton code in the Realm.
 *
 * `buildActorSkeleton(scene, rig, name)` returns `{skeleton, setPose, rest}`.
 * ONE SKELETON PER RIG INSTANCE, never shared: a `Mesh.clone()` in Babylon
 * copies the `skeleton` REFERENCE, so two actors cloned off one master pose in
 * lockstep — every guard in the world walks with the same limp. Task 5 hands
 * each ActorRig its own; `ActorSkeleton.test.js` asserts the independence
 * behaviourally rather than trusting this paragraph.
 *
 * BIND POSE = REST POSE, SO NO INVERSE-BIND IS EVER AUTHORED. Each `Bone` is
 * constructed with `localMatrix = Translation(at - parentAt)` and NOTHING
 * else. Babylon's `Bone` constructor defaults both the rest matrix and the
 * BIND matrix to a clone of that local matrix, so `absoluteBind_i = T(at_i)`
 * falls out of the same numbers the rest pose is built from — the two can not
 * drift apart because there is only one of them. `Skeleton` then emits
 * `absoluteInverseBind_i · final_i` per bone, which at rest is
 * `T(-at_i) · T(at_i)` and measures BIT-EXACTLY identity on all four shipped
 * archetypes (measured, not assumed — the test compares against literal 1s
 * and 0s with `Object.is`, so a -0 would be a failure too).
 *
 * The algebra that makes `setPose` correct, once, here, so it never has to be
 * re-derived at a call site. Babylon composes, in the row-vector convention
 * `model/instanceMatrix.js` documents and `model/actorRig.js` shares:
 *
 *     final_i   = local_i · final_parent          (Skeleton._computeTransformMatrices)
 *     palette_i = absoluteInverseBind_i · final_i = T(-at_i) · final_i
 *
 * `evaluatePose` wants `palette_i = A_i · palette_parent` with
 * `A_i = T(-at_i) · R_i · T(at_i)` — rotate about this bone's own pivot, then
 * the parent's, and so on to the root. Solving the two for `local_i` gives
 *
 *     local_i = R_i · T(at_i - at_parent) = R_i · restLocal_i
 *
 * i.e. the REST LOCAL MATRIX WITH A ROTATION COMPOSED ONTO ITS LEFT, which is
 * exactly what `setPose` writes and why at `R = I` it is the rest matrix
 * unchanged. Nothing here re-implements the composition: Babylon's own
 * `Matrix.multiplyToRef` and `Matrix.RotationAxisToRef` do it, and
 * `RotationAxisToRef` expands to the identical Rodrigues terms as
 * `actorRig.js`'s private `rotAxis` (verified term-for-term; its `sin(-angle)`
 * folds into the same signs). Measured agreement between this path and the
 * pure `evaluatePose` palette, worst element over the canary pose: 1.788e-7
 * (unbound), 8.94e-8 (legion), 1.86e-8 (magistari), 7.45e-8 (orghon) — all in
 * a translation element, all fp32 rounding, no structural divergence.
 *
 * ── THE UNIFORM-PATH PIN ────────────────────────────────────────────────────
 *
 * `useTextureToStoreBoneMatrices = false`, deliberately, permanently until the
 * re-decision trigger below fires.
 *
 * Babylon picks between two ways of getting the bone palette to the vertex
 * shader: an array of `mat4` uniforms (`mBones`), or a floating-point texture
 * sampled per vertex (`boneSampler`). The choice is made from
 * `engine.getCaps().textureFloat`, and NullEngine reports that capability as
 * FALSE. So a headless test exercises the uniform path while a real GPU —
 * where `textureFloat` is true and `useTextureToStoreBoneMatrices` defaults to
 * true — takes the texture path. The tested path would not be the shipped
 * path, and the divergence would sit exactly in the skinning matrix upload:
 * the one place this project has now been burned three phases running (a prop
 * field collapsed to world origin, a shadow term multiplied twice, a ground
 * plane rendered from behind — each invisible to every green headless test).
 *
 * The cost of pinning is nil at this rig's scale. The palette is 4 vec4s per
 * bone and the roster's deepest rig has 8 bones (8/6/2/5 for
 * unbound/legion/magistari/orghon), so 32 vec4s — trivially inside any real
 * device's vertex-uniform budget. The texture path exists for crowds of
 * 100+-bone humanoids, which this roster is nowhere near.
 *
 * RE-DECISION TRIGGER: a rig approaching ~60 BONES. At 4 vec4s each that is
 * 240 vec4s against a WebGL2 floor of 256 minus whatever the material already
 * spends, and the uniform path stops being free. If a future archetype's bone
 * count crosses ~60, this pin must be re-argued — and the argument must
 * include a way to test the texture path, not merely a decision to enable it.
 *
 * ── HOW THE LOCAL MATRIX IS WRITTEN, AND WHY ───────────────────────────────
 *
 * `bone.updateMatrix(m)` — the obvious un-underscored API — is simply WRONG
 * here: its first act is `this._bindMatrix.copyFrom(matrix)`. Posing through
 * it moves the bind pose to wherever the actor currently is, so the palette
 * reads identity at the POSED pose and the mesh never deforms at all: a
 * perfectly rigid, perfectly plausible character. Measured, not theorised —
 * substituting it turns 10 tests red, including an independence check
 * reporting 5.96e-8 of total vertex motion.
 *
 * `bone.setRotationMatrix(R, Space.LOCAL)` is a genuine public alternative and
 * it is NUMERICALLY FREE: measured bit-identical palettes and bit-identical
 * skinned vertices on all four archetypes (max delta 0, 0 differing elements),
 * because `_decompose()` of a pure-translation local yields scale (1,1,1) and
 * `ComposeToRef` rebuilds `R · restLocal` exactly. An earlier version of this
 * comment claimed it cost "a quaternion round-trip and a larger oracle delta";
 * that was never measured and it is false.
 *
 * The `_matrix` write is kept on three true grounds and one safety net:
 *
 *   1. It is ABSOLUTE against the REST matrix, unconditionally. `setPose` is
 *      not incremental and must not be: it rebuilds each local from
 *      `bone.getRestMatrix()` every time, so no sequence of calls can drift.
 *      `setRotationMatrix` preserves whatever translation is CURRENTLY
 *      decomposed on the bone, which is identical today (nothing writes bone
 *      translation) and stops being identical the moment P9's clips animate a
 *      translation channel.
 *   2. One `copyFrom` per bone against a decompose-plus-compose.
 *   3. Babylon's own public `returnToRest()` writes `this._matrix =
 *      this._restMatrix` — this is the engine's own idiom for exactly this
 *      operation, not a private back door.
 *   4. It is `@internal` in the JSDoc though fully typed in the shipped
 *      `.d.ts`, so the risk is a semantic change on upgrade. That is covered:
 *      the babylonjs version is pinned, and the bind-matrix pin plus the
 *      oracle in `ActorSkeleton.test.js` fail loudly on any drift rather than
 *      degrading quietly. If a future upgrade does break it,
 *      `setRotationMatrix(R, Space.LOCAL)` is the drop-in replacement — at the
 *      cost of ground 1, which must then be re-argued against whatever P9
 *      writes to bone translations.
 *
 * ── WHY setPose FORCES prepare ─────────────────────────────────────────────
 *
 * `Skeleton.prepare()` short-circuits on `_currentRenderId === scene
 * .getRenderId()`, and `getTransformMatrices` only ever calls the unforced
 * form. In a headless scene the render id never advances, so a posed skeleton
 * would keep serving the palette it computed the first time — silently, and
 * for every test in this file. `prepare(true)` skips that guard WITHOUT
 * touching `_currentRenderId`, so the engine's own per-frame prepare still
 * runs normally in a live scene. The cost is one recompute of at most 8 bones.
 */

/* global BABYLON */

/** Bone 0's parent pivot. The root rotates about its own `at`, not the origin. */
const ROOT_PARENT_AT = Object.freeze([0, 0, 0]);

/**
 * How far |axis| may sit from 1 before a pose is rejected.
 *
 * TEN TIMES TIGHTER THAN `evaluatePose`'s 1e-6, and the gap is the whole
 * point. The two paths disagree about what a non-unit axis MEANS:
 * `Matrix.RotationAxisToRef` normalises internally and rotates about the
 * direction, while `evaluatePose`'s Rodrigues uses the raw vector and produces
 * a shearing non-rotation. So an axis that both guards accept is an axis on
 * which the engine and the twin compute genuinely different bodies — and
 * `evaluatePose`'s own eps is loose enough to leave a live band where that
 * happens. Measured (unbound, canary, both sides given the same non-unit
 * axis), worst oracle position delta against POSITION_TOL = 4.77e-7:
 *
 *     |axis|-1   1e-7 -> 2.38e-7 ok     2e-7 -> 3.58e-7 ok
 *                5e-7 -> 5.96e-7 FAIL   9.9e-7 -> 9.54e-7 FAIL
 *
 * i.e. anything from roughly 3e-7 up to `evaluatePose`'s 1e-6 passes both
 * guards and then fails the oracle with a numerical message and no structural
 * cause — a Task-7 hand-built pose could burn a day on it. At 1e-7 the worst
 * induced delta is 2.38e-7, indistinguishable from the fp32 floor and well
 * inside the tolerance. A legitimately normalised axis is within ~2 ULP of 1
 * (~4e-16), some nine orders inside this, so nothing real is refused.
 *
 * THE COUPLING IS LOAD-BEARING: this constant must stay comfortably below
 * `POSITION_TOL` in `ActorSkeleton.test.js`, which says the same thing at its
 * end. Loosening either without the other reopens the band.
 */
const AXIS_UNIT_EPS = 1e-7;

/**
 * Build one live skeleton for one rig.
 *
 * @param {object} scene a `BABYLON.Scene`.
 * @param {object} rig from `model/actorRig.js`'s `buildActorRig` — `rig.bones`
 *   (`{boneId, at, parentIndex}`) is all that is read; `boneOfMass` belongs to
 *   the vertex buffers, which are Task 5's.
 * @param {string} [name] node name; defaults to the archetype id. Ids collide
 *   harmlessly in Babylon but not in a diagnostics readout.
 * @returns {{skeleton: object, setPose: (pose: object) => void, rest: () => void}}
 */
export function buildActorSkeleton(scene, rig, name = rig.archetypeId) {
  const skeleton = new BABYLON.Skeleton(name, name, scene);

  // THE PIN. See the header for the full argument and the ~60-bone trigger.
  skeleton.useTextureToStoreBoneMatrices = false;
  // Explicit rather than inherited. With this true the palette becomes
  // per-MESH and folds in that mesh's pose matrix, so two actors sharing an
  // archetype would stop sharing a meaning for "bone 3" and every comparison
  // in the oracle test would be against a different quantity than the one the
  // shader reads. It defaults false; this line is what keeps it false.
  skeleton.needInitialSkinMatrix = false;

  const bones = [];
  for (let i = 0; i < rig.bones.length; i++) {
    const b = rig.bones[i];
    // `buildActorRigOfMasses` guarantees parent < index and asserts it twice;
    // this is the third place, because here a forward reference would not
    // throw — `bones[j]` would be `undefined`, Babylon would read it as "no
    // parent", and the limb would silently detach from the body it belongs to.
    if (b.parentIndex >= i) {
      throw new Error(`[ActorSkeleton] "${name}" bone ${i} (${b.boneId}) declares parent ${b.parentIndex}; bones are built in order, so a parent at or after the child is not yet a Bone and would silently become a second root.`);
    }
    const parentAt = b.parentIndex >= 0 ? rig.bones[b.parentIndex].at : ROOT_PARENT_AT;
    // The ENTIRE bind=rest trick is this one call and the two arguments it
    // does NOT pass: Bone defaults restMatrix and bindMatrix to a clone of
    // this, so no inverse-bind is ever authored and none can go stale.
    const local = BABYLON.Matrix.Translation(
      b.at[0] - parentAt[0], b.at[1] - parentAt[1], b.at[2] - parentAt[2],
    );
    const parent = b.parentIndex >= 0 ? bones[b.parentIndex] : null;
    bones.push(new BABYLON.Bone(b.boneId, skeleton, parent, local));
  }

  // Scratch, reused across bones and across calls — `_matrix`'s setter copies
  // by value, so nothing downstream retains these.
  const rotation = new BABYLON.Matrix();
  const local = new BABYLON.Matrix();
  const axis = new BABYLON.Vector3();

  /**
   * Pose the skeleton from a CANARY_POSE-shaped table:
   * `{boneIndex: {axis: [x,y,z], angleRad}}`, unit axis, missing entries are
   * the identity. ABSOLUTE, not incremental — every bone's local matrix is
   * recomputed from its REST matrix on every call, never from its current
   * value, so there is no accumulated-drift state and no sequence of calls
   * that gives a different answer than the last one alone.
   *
   * `pose` may be an array, a plain object, or `null` (the rest pose). A key
   * outside the bone range is a thrown error rather than a silent no-op: a
   * mis-keyed table would deform nothing and look exactly like a correct rig
   * standing still, which is the failure mode this whole phase exists to make
   * impossible.
   *
   * P9 HANDOFF, AND IT IS LOAD-BEARING ON THE COMMENT ABOVE. This table has NO
   * TRANSLATION CHANNEL — `{axis, angleRad}` is a rotation and nothing else —
   * while ground (i) of the `_matrix` rationale in this file's header is
   * exactly about translation channels: the `_matrix` write is preferred over
   * `setRotationMatrix` BECAUSE the latter preserves whatever translation is
   * currently decomposed on the bone, which is identical today only because
   * nothing writes one. So P9's clips must add their translation by EXTENDING
   * this function — same absolute rebuild from `bone.getRestMatrix()` on every
   * call — and never by writing bone positions around it. Bypass the API and
   * the two paths stop agreeing about what a pose is, and ground (i) becomes a
   * paragraph describing code that no longer exists.
   */
  function setPose(pose) {
    if (pose) {
      for (const key of Object.keys(pose)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= bones.length) {
          throw new Error(`[ActorSkeleton] "${name}" pose names bone "${key}", but this rig has ${bones.length} bones (0..${bones.length - 1}). A key off the end poses nothing and is indistinguishable from a correct rig at rest.`);
        }
      }
    }
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const entry = pose ? pose[i] : undefined;
      if (entry) {
        const n = Math.hypot(entry.axis[0], entry.axis[1], entry.axis[2]);
        if (Math.abs(n - 1) > AXIS_UNIT_EPS) {
          throw new Error(`[ActorSkeleton] "${name}" bone ${i} (${bone.name}) has a non-unit pose axis, |axis| = ${n}. Matrix.RotationAxisToRef would normalise it and rotate by a DIFFERENT pose than model/actorRig.js's evaluatePose, which rejects it.`);
        }
        axis.set(entry.axis[0], entry.axis[1], entry.axis[2]);
        BABYLON.Matrix.RotationAxisToRef(axis, entry.angleRad, rotation);
      } else {
        BABYLON.Matrix.IdentityToRef(rotation);
      }
      // local = R · restLocal, and an UNPOSED bone lands on its rest matrix
      // bit-for-bit — which is what keeps the rest palette exactly the identity
      // it is at construction. Not by lucky rounding: `Matrix.multiplyToRef`
      // short-circuits an identity operand to `result.copyFrom(other)`, so the
      // unposed case is a byte copy of the rest matrix and never a multiply at
      // all. (Where the multiply DOES run, against a pure-translation rest
      // matrix, it is exact anyway — every 3x3 term is `r*1 + 0 + 0 + 0`.)
      rotation.multiplyToRef(bone.getRestMatrix(), local);
      // `_matrix`'s setter skips the write when `local.updateFlag` already
      // equals the bone's own, and `copyFrom` PROPAGATES the source's flag
      // rather than minting a new one — so an unposed bone is genuinely
      // skipped, not merely rewritten with the same bytes. Measured on
      // unbound: 0 of 8 bones written by rest() at construction, 7 of 8 by the
      // canary pose (bone 0 is unposed), 7 of 8 by the rest() after it. That is
      // a no-op elision of an already-correct value, so `setPose` stays
      // ABSOLUTE: the local matrix equals `R · restLocal` on exit either way,
      // whatever sequence of calls preceded it.
      bone._matrix = local;
    }
    // See the header: the unforced prepare short-circuits on an unchanged
    // render id, which never advances in a headless scene.
    skeleton.prepare(true);
  }

  /** Every bone back to its rest matrix — the palette returns to identity. */
  function rest() {
    setPose(null);
  }

  skeleton.prepare(true);
  return { skeleton, setPose, rest };
}
