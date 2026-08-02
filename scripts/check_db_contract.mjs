/**
 * check_db_contract.mjs — the code's own call sites are the schema contract.
 *
 * Derives every database object the application references (tables via
 * `sb.from("x")`, RPCs via `sb.rpc("y")`, plus the raw PostgREST paths the
 * Netlify functions fetch) and compares it against what the tracked SQL in
 * scripts/security/ actually declares. Fully offline — no database, no
 * credentials — so it runs on every PR including forks.
 *
 *   npm run emit:db-contract
 *   npm run emit:db-contract:check
 *
 * Why this exists: every schema bug found in this repo has been the same
 * shape — code referencing a database object that isn't there.
 *   * `use_mfa_recovery_code()` called `auth.mfa_unenroll()`, which does not exist.
 *   * `notify_mfa_disabled()` called two functions a later migration dropped.
 *   * `lookup_email_by_private_id` is called pre-auth by the login screen and
 *     is declared in no tracked file at all.
 *   * Migrations 17-20 merged and deployed before being applied, leaving the
 *     frontend calling tables that did not exist.
 * None of those were caught by tests, because none of them are visible from
 * the code alone — only from code-vs-schema.
 *
 * IMPORTANT SCOPE NOTE: scripts/security/ holds *security migrations*, not the
 * full schema — the original tables (profiles, messages, whoop_*, …) were
 * created before tracking began and are declared nowhere. So "undeclared" is
 * not automatically a bug. `knownUndeclared` in the emitted contract is a
 * ratchet: the current accepted baseline, each entry carrying a reason. A NEW
 * undeclared object fails the check; an entry that later becomes declared also
 * fails, so the list cannot silently rot.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const OUT_PATH = join(repoRoot, 'config/db-contract.json');
const SCAN_DIRS = ['src', 'netlify'];
const SCAN_EXT = /\.(js|jsx|mjs)$/;
const SQL_DIR = join(repoRoot, 'scripts/security');

// Only these identifiers are Supabase clients. Anchoring on the receiver
// matters: a bare /\.from\(/ also matches Array.from, Buffer.from, String.from,
// which appear ~15 times in this tree.
const CLIENTS = ['sb', 'supabase'];

// A call site whose object name is an expression rather than a literal can't be
// resolved statically. Those are a hard error unless a marker naming what the
// site can reach appears within MARKER_LOOKBACK lines above it:
//   // db-contract: dynamic(claim_notification_emails, should_deliver_email)
// The window exists because the marker naturally sits above the enclosing
// function, not above the template literal that happens to contain the
// interpolation.
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

const clientAlt = CLIENTS.join('|');
// sb.from("x") / supabase.rpc('y') — literal first argument only.
const LITERAL_CALL = new RegExp(
  `\\b(?:${clientAlt})\\s*\\.\\s*(from|rpc)\\s*\\(\\s*(["'\`])([A-Za-z_][A-Za-z0-9_]*)\\2`,
  'g'
);
// Same receivers, but a non-literal first argument.
const DYNAMIC_CALL = new RegExp(
  `\\b(?:${clientAlt})\\s*\\.\\s*(from|rpc)\\s*\\(\\s*(?!["'\`])([^),\\s]+)`,
  'g'
);
// Raw PostgREST paths used by the Netlify functions.
const REST_RPC = /rest\/v1\/rpc\/([A-Za-z_][A-Za-z0-9_]*)/g;
const REST_TABLE = /rest\/v1\/(?!rpc\/)([A-Za-z_][A-Za-z0-9_]*)/g;
const REST_DYNAMIC = /rest\/v1\/(?:rpc\/)?\$\{/g;

const needs = { tables: new Map(), functions: new Map() };
const unresolved = [];

function note(kind, name, site) {
  const bucket = needs[kind];
  if (!bucket.has(name)) bucket.set(name, new Set());
  bucket.get(name).add(site);
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(repoRoot, dir))) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    // The checker's own fixtures would otherwise register as real call sites.
    if (rel.includes('__tests__')) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, i) => {
      const site = `${rel}:${i + 1}`;
      const context = lines.slice(Math.max(0, i - MARKER_LOOKBACK), i + 1).join('\n');
      const marker = context.match(DYNAMIC_MARKER);

      for (const m of line.matchAll(LITERAL_CALL)) {
        note(m[1] === 'from' ? 'tables' : 'functions', m[3], site);
      }
      for (const m of line.matchAll(REST_RPC)) note('functions', m[1], site);
      for (const m of line.matchAll(REST_TABLE)) note('tables', m[1], site);

      const dyn =
        [...line.matchAll(DYNAMIC_CALL)].length > 0 ||
        [...line.matchAll(REST_DYNAMIC)].length > 0;
      if (dyn) {
        if (marker) {
          for (const name of marker[1].split(',').map(s => s.trim()).filter(Boolean)) {
            note('functions', name, `${site} (declared dynamic)`);
          }
        } else {
          unresolved.push(site);
        }
      }
    });
  }
}

// ── What the tracked SQL declares ────────────────────────────────────────────
const declared = { tables: new Set(), functions: new Set() };
const sqlFiles = existsSync(SQL_DIR)
  ? readdirSync(SQL_DIR).filter(f => f.endsWith('.sql')).sort()
  : [];

for (const f of sqlFiles) {
  const sql = readFileSync(join(SQL_DIR, f), 'utf8')
    // Strip line comments so the prose headers (which quote object names and
    // even whole CREATE statements) can't be mistaken for declarations.
    .split(/\r?\n/)
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  for (const m of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/gi
  )) declared.tables.add(m[1]);

  for (const m of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/gi
  )) declared.functions.add(m[1]);
}

// ── Assemble ─────────────────────────────────────────────────────────────────
const sortedNames = map => [...map.keys()].sort();
const prev = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : null;
const knownUndeclared = prev?.knownUndeclared ?? {};

const contract = {
  version: 1,
  generatedBy: 'scripts/check_db_contract.mjs',
  note:
    'Derived from code. Do not hand-edit `tables`/`functions`/`declared*` — ' +
    'run `npm run emit:db-contract`. `knownUndeclared` IS hand-edited: it is ' +
    'the accepted baseline of objects the tracked SQL does not declare ' +
    '(mostly pre-dating scripts/security/). Each entry needs a reason.',
  tables: sortedNames(needs.tables),
  functions: sortedNames(needs.functions),
  declaredTables: [...declared.tables].sort(),
  declaredFunctions: [...declared.functions].sort(),
  knownUndeclared,
};

const undeclared = [
  ...contract.tables.filter(t => !declared.tables.has(t)).map(n => ({ kind: 'table', name: n })),
  ...contract.functions.filter(f => !declared.functions.has(f)).map(n => ({ kind: 'function', name: n })),
];

const siteFor = ({ kind, name }) =>
  [...(kind === 'table' ? needs.tables : needs.functions).get(name)].slice(0, 2).join(', ');

if (!CHECK) {
  // Seed the ratchet on first run so the baseline reflects reality rather than
  // failing the whole tree on day one.
  for (const u of undeclared) {
    const key = `${u.kind}:${u.name}`;
    if (!contract.knownUndeclared[key]) {
      contract.knownUndeclared[key] = {
        reason: 'BASELINE: pre-dates scripts/security tracking; verify it exists in the live DB.',
        sites: [...(u.kind === 'table' ? needs.tables : needs.functions).get(u.name)].slice(0, 3),
      };
    }
  }
  // Drop entries that are now declared, so the list self-cleans.
  for (const key of Object.keys(contract.knownUndeclared)) {
    const [kind, name] = key.split(':');
    const isDeclared = kind === 'table' ? declared.tables.has(name) : declared.functions.has(name);
    const stillNeeded = (kind === 'table' ? needs.tables : needs.functions).has(name);
    if (isDeclared || !stillNeeded) delete contract.knownUndeclared[key];
  }
  writeFileSync(OUT_PATH, JSON.stringify(contract, null, 2) + '\n');
  console.log(
    `[db-contract] ${contract.tables.length} tables, ${contract.functions.length} RPCs referenced by code; ` +
    `${Object.keys(contract.knownUndeclared).length} accepted as undeclared.`
  );
  if (unresolved.length) {
    console.error(
      `[db-contract] FATAL: ${unresolved.length} dynamic call site(s) with no ` +
      `\`// db-contract: dynamic(...)\` marker:\n  ${unresolved.join('\n  ')}`
    );
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
    const a = JSON.stringify(prev[key] ?? []);
    const b = JSON.stringify(contract[key]);
    if (a !== b) {
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
    `dynamic call site(s) with no \`// db-contract: dynamic(...)\` marker:\n    ` +
    unresolved.join('\n    ')
  );
}

// A NEW undeclared object — the case that would have caught migrations 17-20
// landing in code before the SQL was written.
for (const u of undeclared) {
  const key = `${u.kind}:${u.name}`;
  if (!knownUndeclared[key]) {
    problems.push(
      `${u.kind} "${u.name}" is referenced by code but declared in no tracked SQL file.\n` +
      `    called from: ${siteFor(u)}\n` +
      `    Either add the migration to scripts/security/, or record it in ` +
      `knownUndeclared with a reason.`
    );
  }
}

// An accepted entry that is now declared (or no longer referenced) must be
// removed, or the baseline quietly grows stale and hides the next real gap.
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
