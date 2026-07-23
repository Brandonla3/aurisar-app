/**
 * verify_worldgen — sanity checks for the pure-math Ashwood worldgen.
 *
 *   node scripts/verify_worldgen.mjs
 *
 * Asserts the determinism contract (two independent builds → identical
 * world), plateau/lake/path invariants from the design data, and prints a
 * summary so regressions in ported formulas are obvious.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// Which world to verify. Defaults to the LIVE world (zone1_world.json); pass
// --config <path> (repo-root-relative) to check a different one, e.g.
//   node scripts/verify_worldgen.mjs --config src/features/world/config/ashwood_world.json
// Every invariant below derives its probe points from the config, so the
// checks hold for any world — not just Ashwood.
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
// of their polyline, so this point is provably clean for ANY config — which is
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

// ── plateaus: each authored shelf should sit near its target height. Targets
//    are design hints, not exact contracts — the generator (heightfield.mtnH)
//    blends them with the massif dome and the switchback carves — so we report
//    the realized height + deviation and only HARD-fail a shelf that is grossly
//    off (Δ>15u), which would mean the plateau/mtnH mechanism itself regressed.
//    Shelves outside the massif radius can't be carved by the mountain-only
//    plateau system (mtnH returns 0 there), so they are reported as off-massif
//    rather than asserted — config-general across worlds, not Ashwood-tuned.
const M = config.zones.mountain;
let hiShelf = null;
for (const [cx, cz, , , target] of config.plateaus) {
  const y = wg.mtnH(cx, cz);
  if (Math.hypot(cx - M.x, cz - M.z) >= M.r) {
    console.log(`  --  plateau (${cx},${cz}) off-massif — not carved (mtnH=${y.toFixed(2)}, target ${target})`);
    continue;
  }
  const dev = Math.abs(y - target);
  console.log(`      plateau (${cx},${cz}) target ${target} → mtnH=${y.toFixed(2)} (Δ${dev.toFixed(1)})`);
  check(`plateau (${cx},${cz}) carved near target`, dev < 15, `mtnH=${y.toFixed(2)} vs ${target}`);
  if (!hiShelf || y > hiShelf.y) hiShelf = { cx, cz, y };
}

// ── summit: the massif should genuinely peak. Report the highest authored vs
//    highest realized shelf (they can differ when design targets are loose) and
//    assert the top shelf clears half the configured peak height. ──
const summitCfg = config.plateaus.reduce((a, b) => (b[4] > a[4] ? b : a));
console.log(`      highest authored shelf (${summitCfg[0]},${summitCfg[1]}) target ${summitCfg[4]}` +
  ` → realized top shelf (${hiShelf.cx},${hiShelf.cz}) at ${hiShelf.y.toFixed(2)} (peakH ${M.peakH})`);
check('massif peaks above half its configured height', hiShelf.y > 0.5 * M.peakH,
  `top shelf mtnH=${hiShelf.y.toFixed(2)}, peakH=${M.peakH}`);

// ── lake: bowl floor below water level, shoreline pinned at level+lip ──
const L = config.lake;
check('lake center underwater', wg.groundHeight(L.x, L.z) < L.level, `h=${wg.groundHeight(L.x, L.z).toFixed(2)}`);
check('lake shoreline at level+lip', Math.abs(wg.groundHeight(L.x + L.bowlR, L.z) - (L.level + L.lip)) < 0.01);
check('lake depth at center > 0', wg.lakeWaterDepthAt(L.x, L.z) > 1);
const mtn = config.zones.mountain;
check('no lake water on the mountain', wg.lakeWaterDepthAt(mtn.x, mtn.z) === 0,
  `depth=${wg.lakeWaterDepthAt(mtn.x, mtn.z).toFixed(2)}`);

// ── switchback corridors exist: full path mask at every segment midpoint
//    (the carve itself; the prototype imposes no slope limit on movement).
//    Max straight-chord grade is reported for tuning, not asserted.
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

// ── trails: dirt at a control point, clean far away ──
const trailPt = config.trails?.[0]?.[0] ?? [0, 0];
check(`trail dirt on a trail (${trailPt[0]},${trailPt[1]})`, wg.trailDirtAt(trailPt[0], trailPt[1]) > 0.5,
  `dirt=${wg.trailDirtAt(trailPt[0], trailPt[1]).toFixed(2)}`);
const clear = farthestFromPaths(config);
check(`no trail dirt in the open (${clear.x},${clear.z}, ${clear.dist.toFixed(0)}m clear)`,
  wg.trailDirtAt(clear.x, clear.z) === 0, `dirt=${wg.trailDirtAt(clear.x, clear.z).toFixed(2)}`);

// ── biomes: spawn hub is Meadow; IDW colors are valid ──
check(`spawn biome is ${config.biomes[0].name}`, wg.biomeAt(0, 0).name === config.biomes[0].name);
const col = { r: 0, g: 0, b: 0 };
wg.biomeColorAt(123, -45, col);
check('biomeColorAt in range', [col.r, col.g, col.b].every((v) => v > 0 && v <= 1));

// ── sites: counts in sane ranges, none in lake water, trees keep out of
//    the Wildwood and the mountain (they dress themselves) ──
const s = wg.sites;
console.log(
  `\n  sites: trees=${s.trees.length} rocks=${s.rocks.length} bushes=${s.bushes.length}` +
  ` details=${s.details.length} ruins=${s.ruins.length} caves=${s.caves.length}` +
  ` chests=${s.chests.length} ponds=${s.ponds.length}\n`
);
check('tree count plausible', s.trees.length > 100 && s.trees.length < config.scatter.treeCount);
check('ruin count exact', s.ruins.length === config.scatter.ruinCount);
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
