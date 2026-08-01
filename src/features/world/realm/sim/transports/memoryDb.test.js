import { describe, expect, it } from 'vitest';
import { createMemoryDb } from './memoryDb.js';

describe('createMemoryDb', () => {
  it('throws on an unknown table instead of returning undefined', () => {
    const db = createMemoryDb(['player']);
    expect(() => db.get('mob', 1)).toThrow(/unknown table "mob"/);
  });

  it('upserts and reads a row', () => {
    const db = createMemoryDb(['player']);
    db.upsert('player', 'p1', { hp: 100 });
    expect(db.get('player', 'p1')).toEqual({ id: 'p1', hp: 100 });
  });

  it('merges on repeat upsert rather than replacing', () => {
    const db = createMemoryDb(['player']);
    db.upsert('player', 'p1', { hp: 100, x: 0 });
    db.upsert('player', 'p1', { x: 5 });
    expect(db.get('player', 'p1')).toEqual({ id: 'p1', hp: 100, x: 5 });
  });

  it('addresses the same row via BigInt, number and string ids', () => {
    // The wire already made this choice (packId): ids normalise to strings.
    // Without it, a row written under 7n would be invisible to a lookup by "7".
    const db = createMemoryDb(['mob']);
    db.upsert('mob', 7n, { hp: 50 });
    expect(db.get('mob', '7')).toEqual({ id: '7', hp: 50 });
    expect(db.get('mob', 7)).toEqual({ id: '7', hp: 50 });
    expect(db.has('mob', 7n)).toBe(true);
  });

  it('returns null for a missing row, not undefined', () => {
    const db = createMemoryDb(['player']);
    expect(db.get('player', 'nobody')).toBeNull();
  });

  it('removes rows and reports counts', () => {
    const db = createMemoryDb(['player']);
    db.upsert('player', 'a', {});
    db.upsert('player', 'b', {});
    expect(db.count('player')).toBe(2);
    expect(db.remove('player', 'a')).toBe(true);
    expect(db.count('player')).toBe(1);
    expect(db.remove('player', 'a')).toBe(false);
  });

  it('rows() is a snapshot that tolerates mutation mid-scan', () => {
    const db = createMemoryDb(['mob']);
    db.upsert('mob', 1, {});
    db.upsert('mob', 2, {});
    // Removing while iterating a live Map view would skip entries; a snapshot
    // makes "sweep and despawn" loops safe to write naively.
    for (const row of db.rows('mob')) db.remove('mob', row.id);
    expect(db.count('mob')).toBe(0);
  });

  it('clear() empties every table', () => {
    const db = createMemoryDb(['player', 'mob']);
    db.upsert('player', 'p', {});
    db.upsert('mob', 'm', {});
    db.clear();
    expect(db.count('player')).toBe(0);
    expect(db.count('mob')).toBe(0);
  });
});
