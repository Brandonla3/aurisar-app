/**
 * sync_world_content.mjs — mirror canonical world content into the
 * SpacetimeDB module package.
 *
 * Source of truth:  src/features/world/content/**\/*.ts   (edit here)
 * Generated mirror: spacetimedb/src/content/**\/*.ts      (never edit)
 *
 * The module can't import across package boundaries (`spacetime build`
 * bundles only spacetimedb/src), so the mirror is checked in — same
 * pattern as spacetimedb/src/gameplay/*.json (see
 * scripts/copy_gameplay_to_public.mjs).
 *
 *   npm run sync:content          # write/refresh the mirror (prunes orphans)
 *   npm run sync:content:check    # exit 1 if the mirror is stale (CI guard)
 *
 * Test files (__tests__/, *.test.ts) are excluded — they exercise
 * client-side cross-checks (e.g. against src/data/exercises.js) that the
 * module must not depend on.
 */

import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src', 'features', 'world', 'content');
const dstDir = join(repoRoot, 'spacetimedb', 'src', 'content');

const CHECK = process.argv.includes('--check');

const GENERATED_MARKER = '// GENERATED FILE — DO NOT EDIT.';

const HEADER = (rel) =>
  `${GENERATED_MARKER}\n` +
  `// Source: src/features/world/content/${rel.split(sep).join('/')}\n` +
  `// Regenerate with: npm run sync:content\n\n`;

// Everything is compared and written LF-normalized so core.autocrlf=true
// Windows checkouts can't produce false STALE results or mixed-EOL files
// (.gitattributes additionally pins both trees to LF).
const lf = (s) => s.replace(/\r\n/g, '\n');
const readLf = (path) => lf(readFileSync(path, 'utf8'));

/** Recursively list .ts files under dir, skipping tests. */
function listContentFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...listContentFiles(full, base));
    } else if (entry.endsWith('.ts') && !entry.includes('.test.')) {
      out.push(relative(base, full));
    }
  }
  return out;
}

function listMirrorFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMirrorFiles(full, base));
    else if (entry.endsWith('.ts')) out.push(relative(base, full));
  }
  return out;
}

const srcFiles = listContentFiles(srcDir);
if (srcFiles.length === 0) {
  console.error('No content files found under', srcDir);
  process.exit(1);
}

const stale = [];
const orphans = [];

for (const rel of srcFiles) {
  const expected = HEADER(rel) + readLf(join(srcDir, rel));
  const dstPath = join(dstDir, rel);
  const current = existsSync(dstPath) ? readLf(dstPath) : null;
  if (current === expected) continue;
  if (CHECK) {
    stale.push(rel);
  } else {
    mkdirSync(dirname(dstPath), { recursive: true });
    writeFileSync(dstPath, expected);
    console.log(`  synced  ${rel.split(sep).join('/')}`);
  }
}

// Prune mirror files whose source no longer exists — but only files we
// generated (first line carries the marker). Anything else is someone's
// hand-written file in the wrong place: warn, never delete.
const srcSet = new Set(srcFiles.map((r) => r.split(sep).join('/')));
for (const rel of listMirrorFiles(dstDir)) {
  if (!srcSet.has(rel.split(sep).join('/'))) {
    const path = join(dstDir, rel);
    const generated = readLf(path).startsWith(GENERATED_MARKER);
    if (CHECK) {
      // Only generated leftovers fail the check — `sync:content` can fix
      // those. A hand-written file gets the same warn-only treatment as
      // in write mode (CI failing on something sync can't fix would wedge).
      if (generated) orphans.push(rel);
      else console.warn(`  WARNING: non-generated file spacetimedb/src/content/${rel.split(sep).join('/')} — move hand-written code outside src/content/.`);
    } else if (generated) {
      rmSync(path);
      console.log(`  pruned  ${rel.split(sep).join('/')}`);
    } else {
      console.warn(
        `  WARNING: spacetimedb/src/content/${rel.split(sep).join('/')} is not generated ` +
        `(no marker header) and has no source counterpart — left in place. ` +
        `Hand-written module code belongs outside spacetimedb/src/content/.`,
      );
    }
  }
}

if (CHECK) {
  if (stale.length || orphans.length) {
    for (const f of stale) console.error(`STALE:  spacetimedb/src/content/${f.split(sep).join('/')}`);
    for (const f of orphans) console.error(`ORPHAN: spacetimedb/src/content/${f.split(sep).join('/')}`);
    console.error('\nMirror out of date — run `npm run sync:content` and commit the result.');
    process.exit(1);
  }
  console.log(`Mirror up to date (${srcFiles.length} files).`);
} else {
  console.log(`Done. Mirror covers ${srcFiles.length} content files.`);
}
