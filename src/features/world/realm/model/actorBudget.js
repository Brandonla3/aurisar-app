/**
 * actorBudget — every archetype's DECLARED cost, plus the actor-side ceiling.
 *
 * PURE data: the actor half of propBudget.js's bill-of-lading pattern.
 * ACTOR_MANIFEST is the paperwork per (archetype, stage), audited against the
 * real generator by actorBudget.test.js exactly the way PROP_MANIFEST is
 * audited by propBudget.test.js — both directions, generated-vs-declared,
 * paste-ready JSON on drift.
 *
 * `silhouetteM2` follows the exact declaration propBudget.test.js's audit
 * pins: `Number(silhouetteAreaM2(payload).toFixed(2))`, so the audit's
 * `toEqual` is stable across runs.
 *
 * ── SKINNING'S COST MODEL, AND WHY THE MANIFEST BELOW DID NOT MOVE ─────────
 *
 * SKINNING ADDS ZERO DRAW CALLS. P7 gave every archetype a per-vertex bone
 * palette (matricesIndices/matricesWeights, spliced into actorNME.js's
 * BonesBlock) but never split a payload's geometry into more meshes —
 * view/actor/ActorRig.js's header is where "one mesh per actor" is pinned as
 * the load-bearing draw-call commitment this file's audit, and
 * realmActorBudget.test.js's `* 1` per actor, both rest on. That commitment
 * is unchanged.
 *
 * WHAT P7 DOES ADD, per VISIBLE actor per frame, is a uniform upload, not a
 * draw call: Babylon's `mBones[BonesPerMesh]` path — the ONLY path, by
 * view/actor/ActorSkeleton.js's pin (`useTextureToStoreBoneMatrices = false`,
 * permanent until that file's own re-decision trigger fires), so there is no
 * bone TEXTURE for this budget to ever have to price instead. `BonesPerMesh`
 * is `bones + 1` mat4s (Babylon appends one identity pad slot past the last
 * real bone), each mat4 sixteen floats, so the upload is
 * `(bones + 1) * 16` floats. At worst — unbound, the roster's deepest rig at
 * 8 bones (6/2/5 for legion/magistari/orghon) — that is `(8 + 1) * 16 = 144`
 * floats, i.e. AT MOST 144 floats of uniform traffic per visible actor per
 * frame. Nothing in this file counts that against ACTOR_CEILINGS: a uniform
 * upload is neither a draw call nor a triangle, and this file's arithmetic
 * has never billed for either kind of cost before.
 *
 * THE MANIFEST NUMBERS DID NOT MOVE, AND THAT IS A MEASURED FACT, NOT AN
 * ASSUMPTION: P7 changed no geometry — matricesIndices/matricesWeights are
 * extra per-vertex ATTRIBUTES, not new vertices, triangles, or silhouette
 * pixels — and actorBudget.test.js's audit re-derives every (archetype,
 * stage) payload from `buildActorPayload` and diffs it against
 * ACTOR_MANIFEST below byte-for-byte. Run it after any P7 change and it is
 * still green, which is this paragraph's claim measured rather than merely
 * argued.
 *
 * ACTOR_CEILINGS is declared SEPARATELY from propBudget.js's BUDGET_CEILINGS
 * (that file is never edited here) because actors do not get their own scene
 * ceiling — they spend out of whatever props leave behind. props+chunks and
 * actors are different enough shapes (thin-instance carriers keyed by
 * (prototype, chunk) vs. one ordinary mesh per live actor) that
 * realmBudget.test.js cannot be parameterized over "kind of thing" without
 * contorting it, so the arithmetic that checks this ceiling against the
 * WHOLE-SCENE BUDGET_CEILINGS lives in its own sibling,
 * realmActorBudget.test.js, one directory up.
 */

/** Per-archetype, per-stage declared costs. Regenerate via the audit test's
 *  logged actuals when a genome deliberately changes. Measured through the
 *  real generator (`buildActorPayload`), 2026-08-06. */
export const ACTOR_MANIFEST = Object.freeze({
  unbound: [
    { tris: 1136, verts: 3056, silhouetteM2: 0.94 },
    { tris: 372, verts: 852, silhouetteM2: 0.90 },
  ],
  legion: [
    { tris: 1344, verts: 3584, silhouetteM2: 0.77 },
    { tris: 448, verts: 1008, silhouetteM2: 0.74 },
  ],
  magistari: [
    { tris: 624, verts: 1584, silhouetteM2: 1.06 },
    { tris: 228, verts: 468, silhouetteM2: 1.04 },
  ],
  orghon: [
    { tris: 1056, verts: 2816, silhouetteM2: 0.93 },
    { tris: 352, verts: 792, silhouetteM2: 0.87 },
  ],
});

/**
 * The worst-case number of actor meshes simultaneously visible to one
 * camera. This is a DESIGN COMMITMENT, not a measurement — unlike props,
 * nothing in the Realm yet spawns or places actors (that is a later phase),
 * so there is no deterministic placement function for a census to sweep the
 * way realmBudget.test.js sweeps propPlacement.js's. 24 = every one of the
 * roster's four factions (model/actorArchetypes.js) fielding six actors at
 * once — a full four-faction skirmish, not a lone encounter — chosen as the
 * worst case future spawn/AI work is held to.
 *
 * realmActorBudget.test.js is where this number is actually spent against
 * the remaining scene headroom (BUDGET_CEILINGS minus props' own measured
 * worst); see that file for the arithmetic and the draw-call model
 * (actors are ordinary moving meshes, never thin-instanced, so cost is
 * exactly 1 draw call per actor).
 *
 * WHAT THE CENSUS DOES NOT BILL, named here so nobody reads "24 actors" as
 * the whole invoice:
 *
 *  - SHADOWS. Every ActorRig registers its mesh with ActorShadowRig
 *    (view/lighting/ActorShadowRig.js) at construction, into a 1024-square
 *    map whose NEAR bucket has no cap on membership. A shadow map render is
 *    a second rasterization of the same triangles from the light's view, so
 *    the 24-actor worst case implies up to 24 further draw calls and up to
 *    a second pass over the same 27k triangles that the "1 draw call per
 *    actor" model above says nothing about. Whether that fits is a real
 *    question for a later phase; it is simply not one this file's arithmetic
 *    has ever asked.
 *  - MATERIAL/OVERDRAW cost of any kind, same as propBudget.js.
 *
 * AND NOTHING AT RUNTIME READS EITHER NUMBER. `maxSimultaneousActors` is
 * spent only by realmActorBudget.test.js; nothing spawns, counts, or refuses
 * an actor against it. `silhouetteM2` is likewise read only by
 * actorBudget.test.js's audit — no LOD, culling or impostor decision
 * consumes it. Both are CEILINGS THAT TESTS DEFEND, not runtime limits, and
 * a future phase that wants either enforced has to write the enforcement.
 */
export const ACTOR_CEILINGS = Object.freeze({
  maxSimultaneousActors: 24,
});
