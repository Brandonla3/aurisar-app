/**
 * propGenomes — every prop family as a small frozen parameter object.
 *
 * PURE data + tiny derivations. One genome generates an entire prototype
 * family (gen/propGen.js): the adult form, its coarser LOD stages, and its
 * environmentally-stressed variants — instead of hand-authoring dozens of
 * meshes. The load-bearing rule of the whole system: LOD stages truncate
 * TOPOLOGY only (fork depth, ring segments, blob count) while the adult
 * ENVELOPE (height, crown radius) stays fixed, so a far stage is the near
 * stage's own simplified shape, not a different smaller tree. That is what
 * makes the silhouette-IoU contract (model/silhouette.js) pass by
 * construction rather than by tuning.
 *
 * Stress ("krummholz" axis): altitude/slope/exposure stunt the SAME genome
 * into hardier, cheaper forms — so the low-triangle variants naturally
 * cluster in the distant high crags where the camera rarely gets close.
 * Stress quantizes to exactly three tiers; the continuous residual only
 * ever touches per-instance scale/tint, never geometry, keeping the
 * prototype table finite.
 */

export const STRESS = Object.freeze({ LUSH: 0, HARDY: 1, KRUMMHOLZ: 2 });

/**
 * Object.freeze is SHALLOW, and deriveStressed spreads — so without this,
 * every stress variant of a genome ALIASES the base genome's stage arrays
 * (ringSegments, blobLevel, tierRadii...) and one stray write retunes
 * three prototypes at once (review catch). Freezing the nested arrays
 * makes any such write throw in strict mode instead.
 */
function freezeGenome(g) {
  for (const v of Object.values(g)) {
    if (Array.isArray(v)) Object.freeze(v);
  }
  return Object.freeze(g);
}

/**
 * Every multi-stage prototype renders exactly TWO stages: 0 = near (full
 * detail), 1 = mid (coarser). There is deliberately no third stage —
 * beyond the mid ring the far tier is drop-shipped (zero instances; the
 * terrain shader tints from the same density scalar), so a far mesh would
 * be dead weight generated for nobody. Stage arrays are sized [near, mid].
 */
export const RENDERED_STAGES = 2;

export const GENOMES = Object.freeze({
  valeoak: freezeGenome({
    id: 'valeoak',
    seed: 511,
    trunkH: 3.4,
    baseRadius: 0.24,
    taper: 0.55,
    crownCenterY: 4.1,
    crownRadius: 2.1,
    crownSquash: 0.8,
    forkDepth: [2, 1],
    forkCount: 3,
    forkAngleDeg: 42,
    ringSegments: [6, 5],
    // Budget is STAGE-INVARIANT, on purpose: dropping blobs between stages
    // was tried three ways (plain first-N, golden-angle azimuths, then
    // stratified elevations too) and every variant still dented the crown's
    // width along whichever azimuth the dropped blobs owned — 12-19%
    // measured, vs a 10% gate. Small budgets have no expendable blobs.
    // Mid-stage cost falls through blob TESSELLATION (80->20 tris each),
    // trunk segments, and limb depth instead — the same recipe the conifer
    // passes with, because its disc positions never move either.
    clusterBudget: [9, 9],
    clusterRadius: 0.95,
    barkRGB: [0.33, 0.25, 0.18],
    leafRGB: [0.30, 0.44, 0.22],
  }),
  cragpine: freezeGenome({
    id: 'cragpine',
    seed: 733,
    trunkH: 5.2,
    baseRadius: 0.20,
    taper: 0.35,
    // Conifer: foliage is a stack of squashed discs, radii shrinking with
    // height — tierRadii/tierHeights ARE the envelope and never move
    // across stages; stages only coarsen each disc's tessellation.
    tierHeights: [1.6, 2.7, 3.8, 4.9],
    tierRadii: [1.5, 1.15, 0.8, 0.42],
    tierSquash: 0.42,
    // Never level 0: an octahedron's filled silhouette is a diamond with
    // ~64% of the equivalent sphere's area, which torpedoes stage IoU —
    // measured, not theorized. Level 1 (icosahedron) is the coarse floor.
    blobLevel: [2, 1],
    ringSegments: [6, 5],
    barkRGB: [0.30, 0.22, 0.16],
    leafRGB: [0.16, 0.30, 0.20],
  }),
  boulder: freezeGenome({
    id: 'boulder',
    seed: 911,
    radius: 0.9,
    squashY: 0.72,
    gnarl: 0.22,
    gnarlFreq: 2.2,
    // SINGLE stage, on purpose. Boulders are sparse (~10 per chunk at 80
    // tris — trivial next to hundreds of trees at 300+), so a coarser mid
    // mesh saves nothing measurable, while an icosahedron mid measured a
    // 12% worst-yaw width delta against the subdiv sphere no compensation
    // constant could close from both directions at once. The LOD machinery
    // exists for the props that dominate the budget; this one opts out.
    level: [2],
    rockRGB: [0.38, 0.37, 0.39],
    lichenRGB: [0.34, 0.40, 0.28],
  }),
  bramble: freezeGenome({
    id: 'bramble',
    seed: 1277,
    trunkH: 0.5,
    baseRadius: 0.05,
    taper: 0.6,
    crownCenterY: 0.7,
    crownRadius: 0.55,
    crownSquash: 0.7,
    // SINGLE stage, like the boulder: its blobs already sit at the coarse
    // level, so a mid stage could only shave trunk segments — measured at
    // 68 -> 66 tris, a 2-triangle "LOD" that spends a real mesh swap to
    // save nothing. Prototypes opt into LOD when the savings are real.
    clusterBudget: [3],
    clusterRadius: 0.34,
    blobLevel: [1],
    ringSegments: [4],
    barkRGB: [0.28, 0.22, 0.17],
    leafRGB: [0.27, 0.38, 0.20],
  }),
  tuft: freezeGenome({
    id: 'tuft',
    seed: 1553,
    blades: 4,
    bladeW: 0.16,
    bladeH: 0.55,
    grassRGB: [0.33, 0.47, 0.22],
  }),
});

/**
 * Stress-derived genome: the SAME genome, stunted. Multipliers picked so
 * krummholz reads as wind-carved treeline scrub, not a scaled-down icon:
 * height collapses hard, crown flattens and widens relative to height,
 * foliage desaturates toward the hardy palette.
 */
export function deriveStressed(genome, stressTier) {
  if (stressTier === STRESS.LUSH) return genome;
  const k = stressTier === STRESS.HARDY
    ? { h: 0.72, r: 0.9, squash: 0.85, desat: 0.85 }
    : { h: 0.42, r: 0.78, squash: 0.6, desat: 0.65 };
  const leaf = genome.leafRGB;
  const grey = (leaf[0] + leaf[1] + leaf[2]) / 3;
  const mix = (c) => c * k.desat + grey * (1 - k.desat);
  const out = {
    ...genome,
    trunkH: genome.trunkH * k.h,
    leafRGB: [mix(leaf[0]), mix(leaf[1]), mix(leaf[2])],
  };
  if (genome.crownCenterY !== undefined) {
    out.crownCenterY = genome.crownCenterY * k.h;
    out.crownRadius = genome.crownRadius * k.r;
    out.crownSquash = genome.crownSquash * k.squash;
  }
  if (genome.tierHeights) {
    out.tierHeights = genome.tierHeights.map((h) => h * k.h);
    out.tierRadii = genome.tierRadii.map((r) => r * k.r);
  }
  return freezeGenome(out);
}

/**
 * The finite prototype table — every (genome, stress) pair that may ever
 * appear in the world, each with its stage count. Placement picks FROM
 * this list; nothing may invent a prototype at runtime, which is what
 * keeps the thin-instance bucket space and the budget census closed.
 */
export const PROTOTYPES = Object.freeze([
  { id: 'valeoak', kind: 'canopy', genomeId: 'valeoak', stress: STRESS.LUSH, stages: 2 },
  { id: 'cragpine', kind: 'conifer', genomeId: 'cragpine', stress: STRESS.LUSH, stages: 2 },
  { id: 'cragpine_hardy', kind: 'conifer', genomeId: 'cragpine', stress: STRESS.HARDY, stages: 2 },
  { id: 'cragpine_krum', kind: 'conifer', genomeId: 'cragpine', stress: STRESS.KRUMMHOLZ, stages: 2 },
  { id: 'boulder', kind: 'boulder', genomeId: 'boulder', stress: STRESS.LUSH, stages: 1 },
  { id: 'bramble', kind: 'shrub', genomeId: 'bramble', stress: STRESS.LUSH, stages: 1 },
  { id: 'tuft', kind: 'tuft', genomeId: 'tuft', stress: STRESS.LUSH, stages: 1 },
]);

export const prototypeById = (id) => PROTOTYPES.find((p) => p.id === id);

/**
 * Which stress tier does a point of terrain impose? Thresholds over the
 * scalars the field already computes (altitude + slope + mountain band) —
 * the same inputs that paint rock and snow, so stunted trees appear
 * exactly where the ground already looks harsh.
 */
export function stressTierAt({ y, slope, mountainMask }) {
  const exposure = mountainMask + slope * 0.8 + Math.max(0, (y - 18) / 30);
  if (exposure > 1.35) return STRESS.KRUMMHOLZ;
  if (exposure > 0.75) return STRESS.HARDY;
  return STRESS.LUSH;
}
