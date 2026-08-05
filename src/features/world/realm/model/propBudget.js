/**
 * propBudget — every prototype's DECLARED cost, plus the world's ceilings.
 *
 * PURE data: the bill of lading. Freight moves on trusted paperwork, not by
 * opening every crate — the headless budget census (realmBudget.test.js)
 * sums these declarations over a worst-case chunk census without a GPU,
 * and the runtime reads the same numbers. A prototype that ships without a
 * manifest entry fails CI (the census refuses undeclared cargo), and a
 * manifest that drifts from what gen/propGen.js actually emits fails the
 * audit test (propBudget.test.js regenerates and compares) — so the
 * paperwork cannot lie in either direction.
 *
 * `silhouetteM2` is the mean projected silhouette area (model/silhouette.js)
 * — the analytic fill-rate bill. Triangle ceilings can't catch a two-
 * triangle canopy plane the size of a house; projected area can, and that
 * class of regression (leaf-card overdraw) was the old world's #1 mobile
 * killer.
 */

/** Per-prototype, per-stage declared costs. Regenerate via the audit test's
 *  logged actuals when a genome deliberately changes. */
export const PROP_MANIFEST = Object.freeze({
  valeoak: [
    { tris: 888, verts: 2328, silhouetteM2: 8.96 },
    { tris: 230, verts: 590, silhouetteM2: 7.82 },
  ],
  cragpine: [
    { tris: 332, verts: 972, silhouetteM2: 6.56 },
    { tris: 90, verts: 250, silhouetteM2: 5.66 },
  ],
  cragpine_hardy: [
    { tris: 332, verts: 972, silhouetteM2: 4.98 },
    { tris: 90, verts: 250, silhouetteM2: 4.37 },
  ],
  cragpine_krum: [
    { tris: 332, verts: 972, silhouetteM2: 3.07 },
    { tris: 90, verts: 250, silhouetteM2: 2.78 },
  ],
  boulder: [
    { tris: 80, verts: 240, silhouetteM2: 1.87 },
  ],
  bramble: [
    { tris: 68, verts: 188, silhouetteM2: 0.45 },
  ],
  tuft: [
    { tris: 8, verts: 16, silhouetteM2: 0.07 },
  ],
});

/**
 * The world ceilings the census asserts. Set from the measured worst case
 * plus ~25% headroom (realmBudget.test.js logs the actuals it found), so a
 * regression has to be REAL to trip them, and a deliberate content
 * expansion has to raise them consciously in review.
 */
export const BUDGET_CEILINGS = Object.freeze({
  /** Live (prototype, chunk) thin-instance draw calls, worst camera. */
  drawCalls: 320,
  /** Summed instance-count x per-stage tris, worst camera. */
  triangles: 900_000,
  /** Carriers rebuilt by one worst-case camera-cell crossing. */
  rebuildsPerCrossing: 260,
  /** Screens of opaque prop pixels at the worst sightline (see census). */
  fillScreens: 40,
});
