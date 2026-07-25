/**
 * emit_zone1_landmarks.mjs — the single source of truth for shared Zone 1
 * world positions.
 *
 * Before this emitter, a landmark's coordinates lived in up to four
 * unreconciled places (worldgen config / content graph / castlePlan /
 * BabylonWorldScene), and they had already drifted: Stillmere was authored
 * both as (-92,88) and (-88,82). Nothing in CI compared them.
 *
 * The rule this file enforces:
 *
 *   A landmark is authored EXACTLY ONCE. If a truth for it already exists
 *   somewhere (the lake bowl, a plateau, the castle plan), the landmark is
 *   DERIVED from that truth here. Only landmarks with no other home are
 *   authored, in `zone1_world.json` → `anchors`.
 *
 * So adding a coordinate to `anchors` that duplicates one already implied by
 * `lake` / `plateaus` / `zones` / `castlePlan` reintroduces exactly the bug
 * this exists to kill — derive it instead.
 *
 * Source of truth:
 *   src/features/world/config/zone1_world.json  (anchors + lake/plateaus/zones)
 *   src/features/world/castle/castlePlan.js     (castle site + derived gate)
 * Output:
 *   src/features/world/content/zones/zone1/landmarks.generated.ts
 *
 *   npm run emit:landmarks
 *   npm run emit:landmarks:check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTERIOR, ENTRY, INTERIOR_ANCHOR } from '../src/features/world/castle/castlePlan.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const CONFIG_PATH = join(repoRoot, 'src', 'features', 'world', 'config', 'zone1_world.json');
const OUT_TS = join(
  repoRoot, 'src', 'features', 'world', 'content', 'zones', 'zone1', 'landmarks.generated.ts',
);

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

// ── round-trip guard ────────────────────────────────────────────────────────
// Positions flow into a u32 chest key and into content the server mirrors, so
// a landmark that is silently a float artifact (e.g. 112.49999999999999) would
// be a nasty class of bug. Everything here is authored or derived from authored
// values, so 4 decimal places is exact; assert rather than assume.
const round4 = (n) => Math.round(n * 1e4) / 1e4;

const errors = [];
function must(cond, msg) {
  if (!cond) errors.push(msg);
}

// ── derived landmarks (truth already exists elsewhere) ──────────────────────
const [hubX, hubZ, hubR] = config.plateaus[0];
const summit = config.plateaus[config.plateaus.length - 1];
const lake = config.lake;
const wildwood = config.zones.wildwood;

/** @type {Array<{id:string,name:string,x:number,z:number,source:string}>} */
const derived = [
  {
    id: 'hub', name: 'Oakrest',
    x: hubX, z: hubZ,
    source: `zone1_world.json plateaus[0] (hub plateau, r${hubR})`,
  },
  {
    id: 'stillmere', name: lake.name,
    x: lake.x, z: lake.z,
    source: 'zone1_world.json lake (bowl center)',
  },
  {
    id: 'wildwood', name: 'The Wildwood',
    x: wildwood.x, z: wildwood.z,
    source: 'zone1_world.json zones.wildwood',
  },
  {
    id: 'frostspire_summit', name: 'Frostspire Summit',
    x: summit[0], z: summit[1],
    source: `zone1_world.json plateaus[${config.plateaus.length - 1}] (summit shelf)`,
  },
  {
    id: 'castle_ashwood', name: 'Castle Ashwood',
    x: EXTERIOR.site.x, z: EXTERIOR.site.z,
    source: 'castle/castlePlan.js EXTERIOR.site',
  },
  {
    id: 'castle_gate', name: 'Castle Ashwood Gate',
    x: ENTRY.gateWorld.x, z: ENTRY.gateWorld.z,
    source: 'castle/castlePlan.js ENTRY.gateWorld (derived from EXTERIOR)',
  },
];

// ── authored landmarks (no other home) ──────────────────────────────────────
const anchors = config.anchors ?? {};
must(Object.keys(anchors).length > 0, 'zone1_world.json has no `anchors` section');

const authored = Object.entries(anchors).map(([id, a]) => {
  must(Number.isFinite(a.x) && Number.isFinite(a.z), `anchor ${id}: x/z must be numbers`);
  must(typeof a.name === 'string' && a.name.length > 0, `anchor ${id}: missing name`);
  return { id, name: a.name, x: a.x, z: a.z, source: 'zone1_world.json anchors' };
});

// ── cross-checks: the hand-copies this emitter is replacing ─────────────────
// The worldgen exclusion zone is a hand-copy of the castle's exterior site.
// Assert the copy still matches its source; a castlePlan move that silently
// left the keep-out behind is precisely the drift class we are closing.
const castleExclusion = (config.exclusions ?? []).find(
  (e) => Math.hypot(e.x - EXTERIOR.site.x, e.z - EXTERIOR.site.z) < 1e-6,
);
must(
  castleExclusion,
  `zone1_world.json exclusions has no entry at castlePlan EXTERIOR.site `
  + `(${EXTERIOR.site.x}, ${EXTERIOR.site.z}) — the castle keep-out drifted from the plan`,
);

// interiors.ashwoodCastle.cx is a hand-copy of castlePlan INTERIOR_ANCHOR.
must(
  config.interiors?.ashwoodCastle?.cx === INTERIOR_ANCHOR.x,
  `zone1_world.json interiors.ashwoodCastle.cx (${config.interiors?.ashwoodCastle?.cx}) `
  + `!= castlePlan INTERIOR_ANCHOR.x (${INTERIOR_ANCHOR.x})`,
);

// ── assemble ────────────────────────────────────────────────────────────────
const all = [...derived, ...authored].map((l) => ({
  ...l, x: round4(l.x), z: round4(l.z),
}));

for (const l of all) {
  must(
    Number.isFinite(l.x) && Number.isFinite(l.z),
    `landmark ${l.id}: non-finite position`,
  );
}

// Ids must be unique across the derived and authored halves — an `anchors`
// entry that shadows a derived landmark would silently win or lose depending
// on order, which is the ambiguity this file exists to remove.
const seen = new Set();
for (const l of all) {
  must(!seen.has(l.id), `duplicate landmark id "${l.id}" (authored anchor shadows a derived one?)`);
  seen.add(l.id);
}

// Two landmarks on top of each other almost always means a copy-paste, not
// intent. 2 m is well inside any POI radius, so this cannot fire on real data.
for (let i = 0; i < all.length; i++) {
  for (let j = i + 1; j < all.length; j++) {
    const d = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
    must(d > 2, `landmarks "${all[i].id}" and "${all[j].id}" are ${d.toFixed(2)}m apart — duplicate?`);
  }
}

if (errors.length) {
  console.error('Landmark emit failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

all.sort((a, b) => a.id.localeCompare(b.id));

const body = all
  .map((l) => `  // ${l.source}\n  ${l.id}: { id: '${l.id}', name: ${JSON.stringify(l.name)}, x: ${l.x}, z: ${l.z} },`)
  .join('\n');

const ts = `// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/config/zone1_world.json (anchors) + castle/castlePlan.js
// Regenerate with: npm run emit:landmarks

/**
 * Shared Zone 1 world positions — the single authored copy.
 *
 * Anything that needs a landmark's coordinates (waypoints, NPCs, mob camps,
 * props, dungeon entrances, the map) reads it from here rather than repeating
 * the literal. Derived entries trace back to the terrain/castle truth that
 * already owned them; authored entries live in zone1_world.json \`anchors\`.
 */
export interface LandmarkDef {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export const LANDMARKS = {
${body}
} as const satisfies Record<string, LandmarkDef>;

export type LandmarkId = keyof typeof LANDMARKS;

/** All landmarks as a flat array (stable id order). */
export const ALL_LANDMARKS: readonly LandmarkDef[] = Object.values(LANDMARKS);

/** Position-only helper for the common \`{ x, z }\` shape. */
export function landmarkPos(id: LandmarkId): { x: number; z: number } {
  const l = LANDMARKS[id];
  return { x: l.x, z: l.z };
}
`;

function writeOrCheck(path, content, label) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) return false;
  if (CHECK) {
    console.error(`STALE: ${label}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  wrote  ${label}`);
  return false;
}

const stale = writeOrCheck(OUT_TS, ts, OUT_TS.replace(repoRoot + '/', ''));

if (CHECK && stale) {
  console.error('\nLandmarks out of date — run `npm run emit:landmarks` and commit.');
  process.exit(1);
}
if (CHECK) console.log(`Landmarks up to date (${all.length}).`);
