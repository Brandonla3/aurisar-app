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
 * ── WHY `bone._matrix = m` AND NOT `bone.updateMatrix(m)` ───────────────────
 *
 * `updateMatrix` is the un-underscored API and it is WRONG here: its first act
 * is `this._bindMatrix.copyFrom(matrix)`. Posing through it would move the
 * bind pose to wherever the actor currently is, so the palette would read
 * identity at the POSED pose and the mesh would never deform at all — a bug
 * that renders as a perfectly rigid, perfectly plausible character. The
 * `_matrix` setter (typed in Babylon's own `.d.ts`) writes the LOCAL matrix
 * only and runs the right bookkeeping: it marks the bone dirty and flags a
 * decompose, so `bone.position` / `bone.rotationQuaternion` stay consistent
 * for P9's animation clips. `ActorSkeleton.test.js` pins the bind matrix as
 * still-the-rest-matrix after a pose, so the wrong call cannot creep back in.
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
 * How far |axis| may sit from 1 before a pose is rejected — the same constant
 * and the same reason as `model/actorRig.js`'s `evaluatePose`, and the reason
 * it is duplicated rather than shared is that this guard closes a DIFFERENT
 * hole. `evaluatePose` throws on a scaled axis because Rodrigues silently
 * returns a shearing non-rotation. `Matrix.RotationAxisToRef` normalises its
 * axis internally, so it would silently return a DIFFERENT, perfectly valid
 * rotation instead — the engine and the twin would disagree about what the
 * pose even means, and the oracle would report a mismatch whose real cause is
 * three files away. Both paths must reject the same inputs.
 */
const AXIS_UNIT_EPS = 1e-6;

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

  // Scratch, reused across bones and across calls. `_matrix`'s setter copies
  // by value and guards on `updateFlag`, which every `multiplyToRef` bumps
  // from a monotonic global seed — so a reused destination can never be
  // mistaken for an unchanged one.
  const rotation = new BABYLON.Matrix();
  const local = new BABYLON.Matrix();
  const axis = new BABYLON.Vector3();

  /**
   * Pose the skeleton from a CANARY_POSE-shaped table:
   * `{boneIndex: {axis: [x,y,z], angleRad}}`, unit axis, missing entries are
   * the identity. Absolute, not incremental — every bone is rewritten from its
   * rest matrix on every call, so there is no accumulated-drift state and no
   * order in which two calls give a different answer than one.
   *
   * `pose` may be an array, a plain object, or `null` (the rest pose). A key
   * outside the bone range is a thrown error rather than a silent no-op: a
   * mis-keyed table would deform nothing and look exactly like a correct rig
   * standing still, which is the failure mode this whole phase exists to make
   * impossible.
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
      // local = R · restLocal. Against a pure-translation rest matrix this is
      // exact in both parts (each 3x3 term is `r*1 + 0 + 0 + 0`, each
      // translation term `0 + 0 + 0 + 1*d`), so an unposed bone is returned to
      // its rest matrix bit-for-bit and the rest palette stays exactly the
      // identity it is at construction.
      rotation.multiplyToRef(bone.getRestMatrix(), local);
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
