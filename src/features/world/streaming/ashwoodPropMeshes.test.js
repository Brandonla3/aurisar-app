/**
 * ashwoodPropMeshes — freeze-safety contract + tier-scaled fill-rate levers.
 *
 * Uses the REAL babylonjs + a headless NullEngine (no GPU), same posture as
 * grassBlades.test.js: this locks the JS/API layer and the counting logic —
 * not visual output (that needs a real device).
 *
 * `buildPropTemplates` reads the ambient BABYLON global, so it must be
 * installed before the module graph is imported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { hash2 } from '../worldgen/index.js';

let buildPropTemplates, buildTileProps;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  // buildPropTemplates' live (non-bake) branch kicks off an async image-decode
  // pipeline for the leaf-card texture (`new Image()`, then canvas work in its
  // onload). None of that is under test here — the freeze contract for
  // tuft/fern only needs the constructor call not to throw — so a stub that
  // never calls onload/onerror is enough; leafCardMat simply stays in its
  // already-safe default (alpha 0, no texture) for the test's lifetime.
  globalThis.Image = class { set src(_v) {} };
  ({ buildPropTemplates, buildTileProps } = await import('./ashwoodPropMeshes.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

function newScene(qualityTier) {
  const scene = new BABYLON.Scene(engine);
  scene.metadata = { ashwood: { qualityTier } };
  return scene;
}

// bake:true skips the leaf-card image/canvas pipeline and applyOptionalTexture
// calls entirely (see the file's own opts.bake gates) — the freeze contract
// under test does not depend on which branch a material's texture came from,
// only on whether one is EVER assigned, so bake mode is a valid, much simpler
// stand-in that needs no Image/document mocking.
describe('buildPropTemplates — freeze contract', () => {
  it('freezes every texture-free material, and none of the textured ones', () => {
    const scene = newScene('high');
    const T = buildPropTemplates(scene, { bake: true });

    // These are the whole reason a freeze() is safe at all here: no branch of
    // this file ever assigns any of them a texture, so there is nothing async
    // left in flight for a frozen isReady() fast-path to miss.
    const shouldBeFrozen = [
      T.blob, T.rock, T.flower, T.fLeaf,
      T.stoneBox, T.column, T.boulder, T.stalag, T.crystal, T.shroom, T.caveDome,
    ];
    for (const t of shouldBeFrozen) expect(t.material.isFrozen).toBe(true);

    // bark/fTrunkM/pine/bushM back the trunk/bush/pine/dead-crown/log
    // templates — every one of them gets a texture via applyOptionalTexture
    // in LIVE mode (bake:true just skips that branch; the templates are the
    // same shared materials either way). Freezing them is out of scope
    // specifically because that assignment races the frozen fast-path — see
    // the comment beside leafCardMat in ashwoodPropMeshes.js.
    const shouldNotBeFrozen = [T.trunk, T.bush, T.pineCanopy, T.deadCrown, T.fTrunk, T.log];
    for (const t of shouldNotBeFrozen) expect(t.material.isFrozen).toBe(false);

    scene.dispose();
  });

  it('freezes the understory (tuft/fern) materials the same way grassBlades does', () => {
    const scene = newScene('high');
    const T = buildPropTemplates(scene, { bake: false });
    // Live mode only: bake mode's tuft/fern are the plain textureless `green`
    // material (also safe, covered by the leaf/rockM/etc. case above) rather
    // than createGrassMaterial's output — this pins the OTHER path.
    expect(T.tuft.material.isFrozen).toBe(true);
    expect(T.fern.material.isFrozen).toBe(true);
    scene.dispose();
  });
});

// ── buildTileProps: tier-scaled ground-detail density ───────────────────────
//
// A minimal wg fixture exposing exactly what buildTileProps reads, with every
// gate that isn't under test neutralized so the counts below are load-bearing
// on the tier scaling alone, not incidental to some other filter:
//   - config.radius huge → the R2 distance cull in the per-tile understory
//     scatter never trips.
//   - config.lake placed far outside the tile → the lake-shoreline dressing
//     block's own inBounds checks always fail, contributing zero.
//   - inMountain/inForest/lakeWaterDepthAt/lakeShoreAt/trailDirtAt neutral.
function makeWg({ biomeGrass, radius = 1e6 } = {}) {
  return {
    surfaceY: () => 0,
    inMountain: () => false,
    inForest: () => false,
    lakeWaterDepthAt: () => 0,
    lakeShoreAt: () => 0,
    trailDirtAt: () => 0,
    biomeAt: () => ({ grass: biomeGrass, grassCol: [0.3, 0.4, 0.2] }),
    config: {
      seed: 12345,
      radius,
      lake: { x: 1e9, z: 1e9, waterR: 1, level: 0 },
      biomes: { meadow: { grassCol: [0.3, 0.4, 0.2] } },
    },
    sites: {
      trees: [], rocks: [], bushes: [], details: [], chests: [], ruins: [], caves: [],
      forestTrees: [], forestBrush: [], forestLogs: [],
    },
  };
}

const TILE_META = { id: 'T_04_04', min: { x: -128, z: -128 }, max: { x: 128, z: 128 } };
// A real bounds check, not a stub that accepts everything: the lake-dressing
// block (pebbles/reeds) is placed far outside this tile specifically so it
// contributes nothing, and that only holds if inBounds actually rejects it.
const inBoundsTile = (x, z) =>
  x >= TILE_META.min.x && x < TILE_META.max.x && z >= TILE_META.min.z && z < TILE_META.max.z;

function tuftCount(container) {
  const mesh = container.meshes.find((m) => m.name === `tile_${TILE_META.id}_tufts`);
  return mesh ? mesh.thinInstanceCount : 0;
}

describe('buildTileProps — tier-scaled understory density', () => {
  it('draws the full 260-candidate scatter on high, and proportionally fewer on low/mobile', () => {
    // biomeGrass tuned so `rng() > bi.grass*0.85+0.08` never trips (threshold
    // pinned above 1, and rng() < 1 always) — every one of the tier-scaled
    // candidate count actually survives to a push, so the realized thin-
    // instance count IS the scaled loop bound, exactly.
    const wg = makeWg({ biomeGrass: 2 });
    const counts = {};
    for (const tier of ['high', 'low', 'mobile']) {
      const scene = newScene(tier);
      const templates = buildPropTemplates(scene, { bake: true });
      const container = new BABYLON.AssetContainer(scene);
      buildTileProps(TILE_META, scene, wg, templates, container, inBoundsTile, null, { lights: false });
      counts[tier] = tuftCount(container);
      scene.dispose();
    }
    expect(counts.high).toBe(260);
    expect(counts.low).toBe(Math.round(260 * 0.7));
    expect(counts.mobile).toBe(Math.round(260 * 0.55));
    expect(counts.mobile).toBeLessThan(counts.low);
    expect(counts.low).toBeLessThan(counts.high);
  });

  it('draws nothing when the biome carries no grass, on every tier', () => {
    // `bi.grass*0.85+0.08` at grass=-1 is negative, so the skip check always
    // fires — a sanity check that the tier scaling isn't accidentally
    // bypassing the biome gate it composes with.
    const wg = makeWg({ biomeGrass: -1 });
    const scene = newScene('high');
    const templates = buildPropTemplates(scene, { bake: true });
    const container = new BABYLON.AssetContainer(scene);
    buildTileProps(TILE_META, scene, wg, templates, container, inBoundsTile, null, { lights: false });
    expect(tuftCount(container)).toBe(0);
    scene.dispose();
  });
});

describe('buildTileProps — tier-scaled s.details (fern/tuft/flower)', () => {
  // Neutralize the OTHER understory source (the 260-candidate scatter) so
  // every surviving tuft push is attributable to s.details alone.
  function wgWithDetails(details) {
    const wg = makeWg({ biomeGrass: -1 });
    wg.sites.details = details;
    return wg;
  }

  it('keeps exactly the entries hash2 selects, at each tier\'s scale — not a random subset', () => {
    const N = 400;
    const details = Array.from({ length: N }, (_, i) => ({
      x: (i % 20) * 4 - 40, z: Math.floor(i / 20) * 4 - 40, seed: i * 7919 + 11, biome: 'meadow',
    }));

    for (const [tier, scale] of [['high', 1], ['low', 0.7], ['mobile', 0.55]]) {
      const wg = wgWithDetails(details);
      const scene = newScene(tier);
      const templates = buildPropTemplates(scene, { bake: true });
      const container = new BABYLON.AssetContainer(scene);
      buildTileProps(TILE_META, scene, wg, templates, container, inBoundsTile, null, { lights: false });

      const expectedSurvivors = scale >= 1
        ? N
        : details.filter((d) => hash2(d.seed, 91.7) < scale).length;
      // fern + tuft + flower partition every surviving entry across exactly
      // three buckets (pick < 0.45 / < 0.8 / else) — the total across all
      // three is the real count to check, since which bucket a given detail
      // lands in is unrelated to the tier scaling under test here.
      const fernN = container.meshes.find((m) => m.name === `tile_${TILE_META.id}_ferns`)?.thinInstanceCount ?? 0;
      const tuftN = container.meshes.find((m) => m.name === `tile_${TILE_META.id}_tufts`)?.thinInstanceCount ?? 0;
      const flowerN = container.meshes.find((m) => m.name === `tile_${TILE_META.id}_flowers`)?.thinInstanceCount ?? 0;
      expect(fernN + tuftN + flowerN).toBe(expectedSurvivors);
      scene.dispose();
    }
  });
});
