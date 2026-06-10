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
const config = JSON.parse(
  readFileSync(join(here, '../src/features/world/config/ashwood_world.json'), 'utf8')
);

const { createWorldgen } = await import('../src/features/world/worldgen/index.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
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

// ── plateaus: center of each shelf sits at its target height. Tolerance is
//    ±2.5 because several shelves sit ON a switchback whose corridor carve
//    (60% blend toward the path elevation) legitimately shifts the center —
//    e.g. plateau (-50,-220) targets 24 vs path elev 23, and the upper
//    clearing (80,-145) targets 86 while path 0 crosses it at elev 91.
for (const [cx, cz, , , target] of config.plateaus) {
  const y = wg.mtnH(cx, cz);
  // On-path shelves inherit up to 60% of the path elevation, which the
  // design data lets disagree with the shelf target by as much as 5u
  // (upper clearing: target 86, path elev 91 → blended 89).
  const tol = wg.mtnPathMask(cx, cz) > 0.5 ? 3.5 : 2.5;
  check(
    `plateau (${cx},${cz}) → ${target}`,
    Math.abs(y - target) < tol,
    `mtnH=${y.toFixed(2)}`
  );
}

// ── summit is the highest plateau ──
check('summit ≈ 98 + ground', Math.abs(wg.mtnH(160, -190) - 98) < 0.5, `mtnH=${wg.mtnH(160, -190).toFixed(2)}`);

// ── lake: bowl floor below water level, shoreline pinned at level+lip ──
const L = config.lake;
check('lake center underwater', wg.groundHeight(L.x, L.z) < L.level, `h=${wg.groundHeight(L.x, L.z).toFixed(2)}`);
check('lake shoreline at level+lip', Math.abs(wg.groundHeight(L.x + L.bowlR, L.z) - (L.level + L.lip)) < 0.01);
check('lake depth at center > 0', wg.lakeWaterDepthAt(L.x, L.z) > 1);
check('no lake water on the mountain', wg.lakeWaterDepthAt(160, -190) === 0);

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
check('trail dirt at hub (0,0)', wg.trailDirtAt(0, 0) > 0.5, `dirt=${wg.trailDirtAt(0, 0).toFixed(2)}`);
check('no trail dirt at (-300,-300)', wg.trailDirtAt(-300, -300) === 0);

// ── biomes: spawn hub is Meadow; IDW colors are valid ──
check('spawn biome is Meadow', wg.biomeAt(0, 0).name === 'Meadow');
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
