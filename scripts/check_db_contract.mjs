/**
 * check_db_contract.mjs — the code's own call sites are the schema contract.
 *
 * Derives every database object the application references (tables via
 * `sb.from("x")`, RPCs via `sb.rpc("y")`, plus the raw PostgREST paths the
 * Netlify functions fetch) and compares it against what the tracked SQL in
 * scripts/security/ declares. Fully offline — no database, no credentials — so
 * it runs on every PR including forks.
 *
 *   npm run emit:db-contract
 *   npm run emit:db-contract:check
 *
 * ── WHAT THIS DOES AND DOES NOT PROVE ───────────────────────────────────────
 * DOES: catch code that references a table/RPC which NO tracked SQL file
 *   declares. That is the "we shipped a call to something nobody wrote SQL for"
 *   failure, and the inventory it produces is itself valuable — it surfaced 13
 *   objects this app depends on that live in no tracked file.
 *
 * DOES NOT: prove the SQL was ever APPLIED to a database. A commit containing
 *   both the call and its migration passes this check even if nobody pastes the
 *   SQL — which is exactly how migrations 17-20 shipped ahead of the schema.
 *   The runtime guard for that is the SCHEMA_DRIFT classification in
 *   netlify/functions/_lib/pgErrors.js, plus `--verify-live` below when
 *   credentials are available.
 *
 * DOES NOT: validate the *bodies* of tracked SQL functions. `use_mfa_recovery_code`
 *   calling a nonexistent `auth.mfa_unenroll()`, or `notify_mfa_disabled`
 *   calling a dropped `get_resend_key()`, are declared functions with broken
 *   insides; only executing them against a real Postgres finds that. Catching
 *   that class needs a live catalog check or a from-scratch replay, and is a
 *   deliberate follow-up rather than something this file pretends to cover.
 *
 * SCOPE GAPS (deliberate): `.schema()` qualifiers, `storage.from()`, files
 *   outside src/ and netlify/, and interpolated names like `` sb.rpc(`a_${x}`) ``
 *   — the last are treated as dynamic and must carry a marker.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');
const SEED = process.argv.includes('--seed-baseline');

const OUT_PATH = join(repoRoot, 'config/db-contract.json');
const SCAN_DIRS = ['src', 'netlify'];
const SCAN_EXT = /\.(js|jsx|mjs)$/;
const SQL_DIR = join(repoRoot, 'scripts/security');

// Any identifier may be a Supabase client — this repo already uses `sb`,
// `supabase` AND `supa`, and a future alias must not silently drop coverage.
// So match any receiver and deny the built-ins that also expose `.from(`.
// (`Object.fromEntries` / `String.fromCharCode` have different method names and
// never match `.from(`.)
const NOT_CLIENTS = new Set([
  'Array', 'Buffer', 'String', 'Object', 'Number', 'Math', 'JSON', 'Promise',
  'Date', 'Set', 'Map', 'WeakMap', 'WeakSet', 'BigInt', 'Symbol', 'Reflect',
  // The COMPLETE TypedArray family, not just the ones already in use: the
  // original list carried Uint8/Int8/Float32/Float64 only, and the first
  // `Uint16Array.from(...)` in the tree (realm P7's actorSkin.test.js copying
  // a massIndex buffer) was flagged as an unmarked dynamic Supabase call.
  // Every constructor here exposes the same static `.from(iterable)`.
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float16Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
]);

// Receiver and method may be separated by newlines — `await sb\n  .from('x')`
// is the dominant style in this tree, and a line-local scan missed every one of
// them (including `exercises` and `invites`).
// The name may be followed by `)` or by `,` — `sb.rpc('fn', { args })` is as
// common as `sb.from('t')`, and requiring a closing paren treated every
// argument-passing RPC as dynamic.
const LITERAL_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*(from|rpc)\s*\(\s*(["'`])([A-Za-z_][A-Za-z0-9_]*)\3\s*[,)]/g;
const DYNAMIC_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*(from|rpc)\s*\(\s*(?!["'`][A-Za-z_][A-Za-z0-9_]*["'`]\s*[,)])([^),]+)/g;
const REST_RPC = /rest\/v1\/rpc\/([A-Za-z_][A-Za-z0-9_]*)/g;
const REST_TABLE = /rest\/v1\/(?!rpc\/)([A-Za-z_][A-Za-z0-9_]*)/g;
const REST_DYNAMIC = /rest\/v1\/(rpc\/)?\$\{/g;

// A dynamic site must name what it can reach. Entries may be bare (inheriting
// the kind of the call) or explicitly `fn:`/`table:` qualified.
//   // db-contract: dynamic(claim_notification_emails, table:some_table)
const DYNAMIC_MARKER = /\/\/\s*db-contract:\s*dynamic\(([^)]*)\)/;
const MARKER_LOOKBACK = 6;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'build' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(entry)) out.push(full);
  }
  return out;
}

const needs = { tables: new Map(), functions: new Map() };
const unresolved = [];

function note(kind, name, site) {
  if (!needs[kind].has(name)) needs[kind].set(name, new Set());
  needs[kind].get(name).add(site);
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(repoRoot, dir))) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    if (rel.includes('__tests__')) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);

    // Offset -> 1-based line, so a whole-file scan can still report call sites.
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
    const lineOf = idx => {
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };
    const markerAbove = line => {
      const from = Math.max(0, line - 1 - MARKER_LOOKBACK);
      return lines.slice(from, line).join('\n').match(DYNAMIC_MARKER);
    };

    for (const m of text.matchAll(LITERAL_CALL)) {
      if (NOT_CLIENTS.has(m[1])) continue;
      note(m[2] === 'from' ? 'tables' : 'functions', m[4], `${rel}:${lineOf(m.index)}`);
    }
    for (const m of text.matchAll(REST_RPC)) note('functions', m[1], `${rel}:${lineOf(m.index)}`);
    for (const m of text.matchAll(REST_TABLE)) note('tables', m[1], `${rel}:${lineOf(m.index)}`);

    // Dynamic sites: kind is preserved, so a dynamic `.from()` registers TABLES
    // rather than silently recording everything as a function.
    const dynSites = [];
    for (const m of text.matchAll(DYNAMIC_CALL)) {
      if (NOT_CLIENTS.has(m[1])) continue;
      dynSites.push({ line: lineOf(m.index), kind: m[2] === 'from' ? 'tables' : 'functions' });
    }
    for (const m of text.matchAll(REST_DYNAMIC)) {
      dynSites.push({ line: lineOf(m.index), kind: m[1] ? 'functions' : 'tables' });
    }

    for (const { line, kind } of dynSites) {
      const site = `${rel}:${line}`;
      const marker = markerAbove(line);
      const names = marker
        ? marker[1].split(',').map(s => s.trim()).filter(Boolean)
        : [];
      if (!marker || names.length === 0) {
        // An empty `dynamic()` marker used to count as marked, which would let a
        // brand-new dynamic helper register nothing at all.
        unresolved.push(marker ? `${site} (marker names no objects)` : site);
        continue;
      }
      for (const raw of names) {
        const explicit = /^(fn|function|rpc):(.+)$/.exec(raw) ? 'functions'
          : /^(table|tbl):(.+)$/.exec(raw) ? 'tables'
          : null;
        const name = raw.replace(/^(fn|function|rpc|table|tbl):/, '');
        note(explicit || kind, name, `${site} (declared dynamic)`);
      }
    }
  }
}

// ── What the tracked SQL declares, in migration order ────────────────────────
// CREATE and DROP are both applied in file order, so an object created early
// and dropped later (e.g. migration 21's notify_friend_request_accepted) does
// NOT linger in the declared inventory and mask a missing dependency.
const declared = { tables: new Set(), functions: new Set() };
const sqlFiles = existsSync(SQL_DIR)
  ? readdirSync(SQL_DIR).filter(f => f.endsWith('.sql')).sort()
  : [];

for (const f of sqlFiles) {
  const sql = readFileSync(join(SQL_DIR, f), 'utf8')
    .split(/\r?\n/)
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  // CREATE and DROP must be applied in POSITIONAL order, not in two passes:
  // `DROP FUNCTION IF EXISTS x; CREATE OR REPLACE FUNCTION x ...` is the
  // standard idiom in this directory, and a drop-everything-last pass wrongly
  // erased four functions that are very much declared.
  const events = [];
  const collect = (re, kind, op) => {
    for (const m of sql.matchAll(re)) events.push({ at: m.index, kind, op, name: m[1] });
  };
  collect(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/gi, 'tables', 'add');
  collect(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/gi, 'functions', 'add');
  collect(/DROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/gi, 'tables', 'del');
  collect(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/gi, 'functions', 'del');

  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    if (e.op === 'add') declared[e.kind].add(e.name);
    else declared[e.kind].delete(e.name);
  }
}

// ── Assemble ─────────────────────────────────────────────────────────────────
const prev = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : null;
const knownUndeclared = prev?.knownUndeclared ?? {};

const contract = {
  version: 1,
  generatedBy: 'scripts/check_db_contract.mjs',
  note:
    'Derived from code. Do not hand-edit `tables`/`functions`/`declared*` — run ' +
    '`npm run emit:db-contract`. `knownUndeclared` IS hand-edited: it is the ' +
    'accepted baseline of objects the tracked SQL does not declare (mostly ' +
    'pre-dating scripts/security/). Each entry needs a real reason. Emit will ' +
    'NOT invent entries — a new undeclared object must get a migration or a ' +
    'deliberate hand-written exception.',
  tables: [...needs.tables.keys()].sort(),
  functions: [...needs.functions.keys()].sort(),
  declaredTables: [...declared.tables].sort(),
  declaredFunctions: [...declared.functions].sort(),
  knownUndeclared,
};

const undeclared = [
  ...contract.tables.filter(t => !declared.tables.has(t)).map(n => ({ kind: 'table', name: n })),
  ...contract.functions.filter(f => !declared.functions.has(f)).map(n => ({ kind: 'function', name: n })),
];
const sitesFor = ({ kind, name }) =>
  [...(kind === 'table' ? needs.tables : needs.functions).get(name)].slice(0, 3);

function pruneStaleBaseline(target) {
  for (const key of Object.keys(target)) {
    const [kind, name] = key.split(':');
    const isDeclared = kind === 'table' ? declared.tables.has(name) : declared.functions.has(name);
    const stillNeeded = (kind === 'table' ? needs.tables : needs.functions).has(name);
    if (isDeclared || !stillNeeded) delete target[key];
  }
}

if (!CHECK) {
  const firstBootstrap = !prev;
  // Seeding is the ONE thing emit must not do casually. Auto-adding every new
  // undeclared object with a generic "BASELINE" reason turned the documented
  // ratchet into a laundering step: CI said "run emit", emit absolved the
  // object, and the next run passed with no migration and no human judgement.
  if (firstBootstrap || SEED) {
    for (const u of undeclared) {
      const key = `${u.kind}:${u.name}`;
      if (!contract.knownUndeclared[key]) {
        contract.knownUndeclared[key] = {
          reason: 'BASELINE: pre-dates scripts/security tracking; verify it exists in the live DB.',
          sites: sitesFor(u),
        };
      }
    }
  }
  // Refresh `sites` on entries that already exist. They were only ever set at
  // creation, so an accepted-undeclared object kept citing wherever it was
  // first seen — an audit of PR #319 chased a ProfileTab read of whoop_tokens
  // that the same PR had removed. `reason` is hand-written and never touched
  // here; only the mechanically-derived call sites are updated.
  for (const u of undeclared) {
    const entry = contract.knownUndeclared[`${u.kind}:${u.name}`];
    if (entry) entry.sites = sitesFor(u);
  }

  pruneStaleBaseline(contract.knownUndeclared);
  writeFileSync(OUT_PATH, JSON.stringify(contract, null, 2) + '\n');

  const fresh = undeclared.filter(u => !contract.knownUndeclared[`${u.kind}:${u.name}`]);
  console.log(
    `[db-contract] ${contract.tables.length} tables, ${contract.functions.length} RPCs referenced by code; ` +
    `${Object.keys(contract.knownUndeclared).length} accepted as undeclared.`
  );

  const fatal = [];
  if (unresolved.length) {
    fatal.push(
      `${unresolved.length} dynamic call site(s) needing a \`// db-contract: dynamic(name, ...)\` ` +
      `marker with at least one name:\n    ` + unresolved.join('\n    ')
    );
  }
  if (fresh.length) {
    fatal.push(
      `${fresh.length} object(s) referenced by code but declared in no tracked SQL file:\n` +
      fresh.map(u => `    ${u.kind} "${u.name}"  <- ${sitesFor(u).join(', ')}`).join('\n') +
      `\n    Add the migration to scripts/security/, or add a hand-written ` +
      `knownUndeclared entry (with a real reason) to config/db-contract.json.` +
      `\n    Re-running emit will NOT absolve them.`
    );
  }
  if (fatal.length) {
    console.error('[db-contract] FATAL:\n  - ' + fatal.join('\n  - '));
    process.exit(1);
  }
  process.exit(0);
}

// ── --check ──────────────────────────────────────────────────────────────────
const problems = [];

if (!prev) {
  problems.push('config/db-contract.json is missing — run `npm run emit:db-contract`.');
} else {
  for (const key of ['tables', 'functions', 'declaredTables', 'declaredFunctions']) {
    if (JSON.stringify(prev[key] ?? []) !== JSON.stringify(contract[key])) {
      const added = contract[key].filter(x => !(prev[key] ?? []).includes(x));
      const removed = (prev[key] ?? []).filter(x => !contract[key].includes(x));
      problems.push(
        `${key} is stale — run \`npm run emit:db-contract\`.` +
        (added.length ? `\n    + ${added.join(', ')}` : '') +
        (removed.length ? `\n    - ${removed.join(', ')}` : '')
      );
    }
  }
}

if (unresolved.length) {
  problems.push(
    `dynamic call site(s) needing a \`// db-contract: dynamic(name, ...)\` marker ` +
    `with at least one name:\n    ` + unresolved.join('\n    ')
  );
}

for (const u of undeclared) {
  const key = `${u.kind}:${u.name}`;
  if (!knownUndeclared[key]) {
    problems.push(
      `${u.kind} "${u.name}" is referenced by code but declared in no tracked SQL file.\n` +
      `    called from: ${sitesFor(u).join(', ')}\n` +
      `    Add the migration to scripts/security/, or add a hand-written ` +
      `knownUndeclared entry with a real reason. Re-running emit will NOT absolve it.`
    );
  }
}

for (const key of Object.keys(knownUndeclared)) {
  const [kind, name] = key.split(':');
  const isDeclared = kind === 'table' ? declared.tables.has(name) : declared.functions.has(name);
  const stillNeeded = (kind === 'table' ? needs.tables : needs.functions).has(name);
  if (isDeclared) {
    problems.push(`knownUndeclared["${key}"] is now declared in tracked SQL — remove it (\`npm run emit:db-contract\`).`);
  } else if (!stillNeeded) {
    problems.push(`knownUndeclared["${key}"] is no longer referenced by any code — remove it (\`npm run emit:db-contract\`).`);
  }
}

if (problems.length) {
  console.error('[db-contract] FAILED:\n' + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}

console.log(
  `[db-contract] OK — ${contract.tables.length} tables / ${contract.functions.length} RPCs referenced; ` +
  `${Object.keys(knownUndeclared).length} accepted undeclared; 0 unresolved dynamic sites.`
);
