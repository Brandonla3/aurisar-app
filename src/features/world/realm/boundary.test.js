/**
 * boundary.test.js — the Realm Boundary, mechanically enforced.
 *
 * The Realm has exactly one architectural rule, and this file is that rule:
 *
 *   model/ gen/ sim/ settings/  ── PURE. May never reference BABYLON.
 *   view/                       ── the ONLY layer allowed to touch the engine.
 *
 * Why it is a test and not a convention: the stack this replaces started clean
 * and ended as a 3,794-line file that owned the engine, the camera, the mobs and
 * the streaming all at once. Conventions rot silently; a failing test does not.
 *
 * Keeping the pure layers engine-free is what makes most of the Realm unit
 * testable in plain node — no GPU, no jsdom, no NullEngine. That property is
 * worth defending automatically.
 *
 * Also enforces a per-file line ceiling, for the same reason.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REALM_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The single layer permitted to touch BABYLON.
 *
 * The rule is expressed as "everything OUTSIDE view/ is engine-free" rather than
 * as a list of pure folders. An allowlist of pure folders only polices the
 * folders you thought of: the first version of this test named model/gen/sim/
 * settings, which left root-level files — and any folder added later — free to
 * import the engine while the README claimed otherwise. Inverting it means the
 * test and the README say the same thing, permanently.
 */
const RENDER_LAYER = 'view';

/**
 * Files outside view/ that may reference BABYLON anyway. Deliberately empty.
 *
 * If something needs the engine, it belongs in view/. A facade that merely
 * orchestrates view/ modules does not need to name BABYLON at all. Adding an
 * entry here should feel like it needs justifying, because it does.
 */
const ENGINE_ALLOWLIST = new Set([]);

/** Nothing in the Realm may grow into the next BabylonWorldScene.js. */
const MAX_LINES = 400;
/** Test files get more room — fixtures and table-driven cases are legitimately long. */
const MAX_LINES_TEST = 700;

const SOURCE_EXT = /\.(js|jsx)$/;
const TEST_FILE = /\.test\.jsx?$/;
const SKIP_DIRS = new Set(['__fixtures__', '__snapshots__', 'node_modules']);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...walk(full));
    } else if (SOURCE_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments so prose about BABYLON (like this file's own header) does not
 * trip the scan. The `[^:]` guard keeps `https://` from being eaten as a comment.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const rel = (f) => relative(REALM_ROOT, f).split(sep).join('/');

const ALL_FILES = walk(REALM_ROOT);
const inView = (f) => rel(f).split('/')[0] === RENDER_LAYER;

/**
 * Everything that must be engine-free: any non-test source outside view/.
 * Tests are exempt — they legitimately `import BABYLON from 'babylonjs'` to
 * stand up a NullEngine, and they ship to nobody.
 */
const pureFiles = ALL_FILES.filter(
  (f) => !inView(f) && !TEST_FILE.test(f) && !ENGINE_ALLOWLIST.has(rel(f)),
);
const viewFiles = ALL_FILES.filter(inView);

describe('realm boundary', () => {
  // Guards against a vacuous pass: an empty or mis-rooted tree would otherwise
  // make every assertion below trivially true.
  it('actually scanned the realm tree', () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  it('nothing outside view/ references BABYLON', () => {
    const offenders = pureFiles
      .filter((f) => /\bBABYLON\b/.test(stripComments(readFileSync(f, 'utf8'))))
      .map(rel);

    expect(
      offenders,
      'These files live outside view/ but reference BABYLON.\n' +
        'Move the engine-facing code into view/, or invert the dependency so the pure\n' +
        'module returns plain data that view/ turns into Babylon objects.',
    ).toEqual([]);
  });

  it('nothing outside view/ imports babylonjs', () => {
    const offenders = pureFiles
      .filter((f) => /from\s+['"]babylonjs/.test(readFileSync(f, 'utf8')))
      .map(rel);

    expect(offenders, 'Only view/ may import babylonjs.').toEqual([]);
  });

  it('has at least one engine-free file to police', () => {
    // The inverted rule would pass trivially if everything ended up in view/.
    expect(pureFiles.length).toBeGreaterThan(0);
  });

  it('view files that use BABYLON declare the global', () => {
    // The repo convention: view code reads the ambient UMD global and never
    // imports babylonjs directly. ESLint's no-undef needs the directive to agree.
    // Tests are exempt — they legitimately `import BABYLON from 'babylonjs'` to
    // stand up a NullEngine, which satisfies no-undef on its own.
    const offenders = viewFiles
      .filter((f) => !TEST_FILE.test(f))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return /\bBABYLON\b/.test(stripComments(src)) && !/\/\*\s*global\s+[^*]*\bBABYLON\b/.test(src);
      })
      .map(rel);

    expect(offenders, 'Add `/* global BABYLON */` near the top of these files.').toEqual([]);
  });

  it('no file exceeds its line ceiling', () => {
    const offenders = ALL_FILES.map((f) => {
      const lines = readFileSync(f, 'utf8').split('\n').length;
      const ceiling = TEST_FILE.test(f) ? MAX_LINES_TEST : MAX_LINES;
      return lines > ceiling ? `${rel(f)} (${lines} > ${ceiling})` : null;
    }).filter(Boolean);

    expect(offenders, 'Split these files. The ceiling exists so no module becomes indispensable.').toEqual([]);
  });
});
