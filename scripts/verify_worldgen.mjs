/**
 * verify_worldgen — sanity checks for the pure-math Ashwood worldgen.
 *
 *   node scripts/verify_worldgen.mjs
 *
 * Asserts the determinism contract (two independent builds → identical world),
 * a tight per-config golden regression on realized terrain heights + site
 * counts, and lake/path invariants, printing a summary so regressions in the
 * ported formulas are obvious.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// Which world to verify. Defaults to the LIVE world (zone1_world.json); pass
// --config <path> (repo-root-relative) to check a different one, e.g.
//   node scripts/verify_worldgen.mjs --config src/features/world/config/ashwood_world.json
// Written for Ashwood-shaped configs (a mountain massif, plateaus, a lake, and
// mountain paths); sections absent from a config are reported and skipped, not
// asserted. Probe points and the golden regression below are keyed to the config.
const args = process.argv.slice(2);
const ci = args.indexOf('--config');
const configPath = ci >= 0 ? args[ci + 1] : 'src/features/world/config/zone1_world.json';
const config = JSON.parse(readFileSync(join(root, configPath), 'utf8'));

const { createWorldgen } = await import('../src/features/world/worldgen/index.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Distance from (px,pz) to segment a→b — used to probe points away from paths.
function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// The "open" point of the world: the on-disc grid sample farthest from every
// trail and mountain-path segment. Trails paint dirt only within a few metres
// of their polyline, so this point is provably clean for any config — which is
// why the "no trail dirt in the open" check below no longer hard-codes a spot.
function farthestFromPaths(cfg) {
  const segs = [];
  for (const line of cfg.trails ?? [])
    for (let i = 0; i < line.length - 1; i++)
      segs.push([line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]]);
  for (const mp of cfg.mountainPaths ?? []) {
    const pts = mp.pts ?? [];
    for (let i = 0; i < pts.length - 1; i++)
      segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
  }
  const R = (cfg.radius ?? 520) - 20;
  let best = { x: 0, z: 0, dist: -1 };
  for (let x = -R; x <= R; x += 16) {
    for (let z = -R; z <= R; z += 16) {
      if (x * x + z * z > R * R) continue;
      let md = Infinity;
      for (const s of segs) { const d = distToSeg(x, z, s[0], s[1], s[2], s[3]); if (d < md) md = d; }
      if (md > best.dist) best = { x, z, dist: md };
    }
  }
  return best;
}

// ── Golden regression: the realized geometry the current, correct generator
//    produces for each known world (keyed by seed). Any change to a worldgen
//    formula shifts these, so a tight ±0.5u tolerance catches regressions the
//    determinism check (two identical builds) cannot. `plateaus` is realized
//    mtnH at each config.plateaus center in order (0 = off-massif, not asserted).
//    Regenerate the values below if the geometry legitimately changes:
//      node -e '(await import("./src/features/world/worldgen/index.js")).createWorldgen(...)'
const GOLDEN = {
  20260612: { // zone1_world (live)
    plateaus: [0, 0, 0, 0, 10.303, 22.5805, 45.902, 49.3826, 71.4533, 65.0962, 94.1685, 116.1395, 113.8915],
    sites: { trees: 359, rocks: 291, bushes: 141, details: 806, ruins: 6, caves: 5, chests: 25, ponds: 3 },
  },
  20240611: { // ashwood_world (dev)
    plateaus: [10.172, 7, 12, 22.6312, 22, 56, 52, 56, 89.0006, 97.9134],
    sites: { trees: 309, rocks: 219, bushes: 141, details: 675, ruins: 11, caves: 8, chests: 25, ponds: 3 },
  },
};
const golden = GOLDEN[config.seed];

const wg = createWorldgen(config);
const wg2 = createWorldgen(config);

// ── determinism: two builds are identical ──
check(
  'biome seeds deterministic',
  JSON.stringify(wg.biomeSeeds) === JSON.stringify(wg2.biomeSeeds)
);
check(
  'site manifest deterministic',
  JSON.stringify(wg.sites) === JSON.stringify(wg2.sites)
);

// ── plateaus + summit (Ashwood-shaped configs only). With a recorded golden,
//    each in-massif shelf's realized mtnH must match within ±0.5u — the tight
//    regression guard. Unknown configs fall back to a loose "carved near target"
//    sanity bound + a note to record a golden. Off-massif shelves (mtnH=0 there)
//    are reported, not asserted. ──
const M = config.zones?.mountain;
if (!M || !Array.isArray(config.plateaus) || config.plateaus.length === 0) {
  console.log('  --  no mountain massif / plateaus in this config — skipping plateau + summit checks');
} else {
  let hiShelf = null;
  config.plateaus.forEach(([cx, cz, , , target], idx) => {
    const y = wg.mtnH(cx, cz);
    if (Math.hypot(cx - M.x, cz - M.z) >= M.r) {
      console.log(`  --  plateau (${cx},${cz}) off-massif — not carved (mtnH=${y.toFixed(2)})`);
      return;
    }
    if (golden) {
      const want = golden.plateaus[idx];
      check(`plateau (${cx},${cz}) golden ${want}`, Math.abs(y - want) < 0.5, `mtnH=${y.toFixed(3)} vs ${want}`);
    } else {
      console.log(`      plateau (${cx},${cz}) target ${target} → mtnH=${y.toFixed(2)} (Δ${Math.abs(y - target).toFixed(1)})`);
      check(`plateau (${cx},${cz}) carved near target`, Math.abs(y - target) < 15, `mtnH=${y.toFixed(2)} vs ${target}`);
    }
    if (!hiShelf || y > hiShelf.y) hiShelf = { cx, cz, y };
  });
  if (!golden) console.log(`      (no golden for seed ${config.seed}; add one to lock realized heights)`);
  if (hiShelf) {
    console.log(`      highest realized shelf (${hiShelf.cx},${hiShelf.cz}) at ${hiShelf.y.toFixed(2)} (peakH ${M.peakH})`);
    check('massif peaks above half its configured height', hiShelf.y > 0.5 * M.peakH, `top shelf=${hiShelf.y.toFixed(2)}`);
  } else {
    console.log('  --  every plateau is off-massif — summit check skipped');
  }
}

// ── lake: bowl floor below water level, shoreline pinned at level+lip ──
if (config.lake) {
  const L = config.lake;
  check('lake center underwater', wg.groundHeight(L.x, L.z) < L.level, `h=${wg.groundHeight(L.x, L.z).toFixed(2)}`);
  check('lake shoreline at level+lip', Math.abs(wg.groundHeight(L.x + L.bowlR, L.z) - (L.level + L.lip)) < 0.01);
  check('lake depth at center > 0', wg.lakeWaterDepthAt(L.x, L.z) > 1);
  if (M) check('no lake water on the mountain', wg.lakeWaterDepthAt(M.x, M.z) === 0,
    `depth=${wg.lakeWaterDepthAt(M.x, M.z).toFixed(2)}`);
} else {
  console.log('  --  no lake in this config — skipping lake checks');
}

// ── switchback corridors exist: full path mask at every segment midpoint
//    (the carve itself; the prototype imposes no slope limit on movement).
//    Max straight-chord grade is reported for tuning, not asserted. ──
if (Array.isArray(config.mountainPaths) && config.mountainPaths.length) {
  for (let p = 0; p < config.mountainPaths.length; p++) {
    const pts = config.mountainPaths[p].pts;
    let minMask = 1, maxGrade = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      minMask = Math.min(minMask, wg.mtnPathMask((ax + bx) / 2, (az + bz) / 2));
      const steps = 24;
      let prev = wg.surfaceY(ax, az);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const y = wg.surfaceY(ax + (bx - ax) * t, az + (bz - az) * t);
        const run = Math.hypot(bx - ax, bz - az) / steps;
        maxGrade = Math.max(maxGrade, Math.abs(y - prev) / run);
        prev = y;
      }
    }
    check(`path ${p} corridor carved (mask > 0.9)`, minMask > 0.9, `minMask=${minMask.toFixed(2)}`);
    console.log(`      path ${p} straight-chord max grade: ${(maxGrade * 100).toFixed(0)}%`);
  }
} else {
  console.log('  --  no mountain paths in this config — skipping corridor checks');
}

// ── trails: dirt at a control point, clean far away ──
if (config.trails?.length) {
  const trailPt = config.trails[0][0];
  check(`trail dirt on a trail (${trailPt[0]},${trailPt[1]})`, wg.trailDirtAt(trailPt[0], trailPt[1]) > 0.5,
    `dirt=${wg.trailDirtAt(trailPt[0], trailPt[1]).toFixed(2)}`);
}
const clear = farthestFromPaths(config);
check(`no trail dirt in the open (${clear.x},${clear.z}, ${clear.dist.toFixed(0)}m clear)`,
  wg.trailDirtAt(clear.x, clear.z) === 0, `dirt=${wg.trailDirtAt(clear.x, clear.z).toFixed(2)}`);

// ── biomes: spawn hub is the first biome; IDW colors are valid ──
if (config.biomes?.length) {
  check(`spawn biome is ${config.biomes[0].name}`, wg.biomeAt(0, 0).name === config.biomes[0].name);
}
const col = { r: 0, g: 0, b: 0 };
wg.biomeColorAt(123, -45, col);
check('biomeColorAt in range', [col.r, col.g, col.b].every((v) => v > 0 && v <= 1));

// ── sites: counts match the golden exactly, none in lake water, trees keep out
//    of the Wildwood and the mountain (they dress themselves) ──
const s = wg.sites;
console.log(
  `\n  sites: trees=${s.trees.length} rocks=${s.rocks.length} bushes=${s.bushes.length}` +
  ` details=${s.details.length} ruins=${s.ruins.length} caves=${s.caves.length}` +
  ` chests=${s.chests.length} ponds=${s.ponds.length}\n`
);
if (golden) {
  for (const k of ['trees', 'rocks', 'bushes', 'details', 'ruins', 'caves', 'chests', 'ponds'])
    check(`golden ${k} count = ${golden.sites[k]}`, s[k].length === golden.sites[k], `got ${s[k].length}`);
} else {
  check('tree count plausible', s.trees.length > 100 && s.trees.length < config.scatter.treeCount);
  check('ruin count exact', s.ruins.length === config.scatter.ruinCount);
}
check('trees avoid Wildwood/mountain', s.trees.every((t) => !wg.inForest(t.x, t.z) && !wg.inMountain(t.x, t.z)));
check('no site in lake water', [...s.trees, ...s.rocks, ...s.chests].every((t) => wg.lakeWaterDepthAt(t.x, t.z) <= 0.05));
check('all sites inside world disc', [...s.trees, ...s.rocks, ...s.bushes, ...s.details].every((t) => Math.hypot(t.x, t.z) <= config.radius));

// ── perf smoke: a full 256m tile of surfaceY samples (65×65) ──
const t0 = performance.now();
let acc = 0;
for (let i = 0; i <= 64; i++) for (let j = 0; j <= 64; j++) acc += wg.surfaceY(i * 4 - 128, j * 4 - 128);
const dt = performance.now() - t0;
check('65×65 tile heightfield < 50ms', dt < 50, `${dt.toFixed(1)}ms (acc=${acc.toFixed(0)})`);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll worldgen checks passed.');
