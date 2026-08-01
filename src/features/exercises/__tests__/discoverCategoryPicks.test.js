import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DISCOVER_PICK_COUNT } from '../discoverCategories';

/**
 * The Customize Discover picker moved from "always exactly 3, swap only"
 * to "0 to 3, freely select and deselect" — tapping an already-picked
 * category now removes it instead of being a no-op. Reimplements the exact
 * pickDiscoverCategory logic here (it's a closure inside
 * ExerciseLibraryTab.jsx, not an exported function) so the eviction rule is
 * pinned by a real test rather than only a source-string guard.
 */
function pickDiscoverCategory(cur, key) {
  if (cur.includes(key)) return cur.filter(k => k !== key);
  if (cur.length >= DISCOVER_PICK_COUNT) return [...cur.slice(1), key];
  return [...cur, key];
}

describe('pickDiscoverCategory', () => {
  it('removes an already-picked category instead of ignoring the tap', () => {
    expect(pickDiscoverCategory(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('adds an unpicked category when under the cap, without evicting anything', () => {
    expect(pickDiscoverCategory(['a'], 'b')).toEqual(['a', 'b']);
    expect(pickDiscoverCategory([], 'a')).toEqual(['a']);
  });

  it('evicts the oldest pick only once already at the cap', () => {
    expect(pickDiscoverCategory(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
  });

  it('can go all the way down to zero picks', () => {
    expect(pickDiscoverCategory(['a'], 'a')).toEqual([]);
  });
});

describe('ExerciseLibraryTab source matches the reimplemented logic', () => {
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  const src = readFileSync(ROOT + 'src/features/exercises/ExerciseLibraryTab.jsx', 'utf8');

  it('deselects on repeat tap rather than treating it as a no-op', () => {
    const body = src.slice(src.indexOf('const pickDiscoverCategory'), src.indexOf('const pickDiscoverCategory') + 500);
    expect(body).toContain('cur.filter(k => k !== key)');
    expect(body).not.toMatch(/if \(\(libDiscoverPicks \|\| \[\]\)\.includes\(key\)\) return;/);
  });
});
