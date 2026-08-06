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
 */
export const ACTOR_CEILINGS = Object.freeze({
  maxSimultaneousActors: 24,
});
