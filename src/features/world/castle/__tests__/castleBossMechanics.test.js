import { describe, it, expect } from 'vitest';
import { DUNGEONS } from '../../content/dungeons/index';

const CASTLE = DUNGEONS.find((d) => d.id === 'castle_ashwood');

describe('castle boss mechanics (content contract)', () => {
  it('castle_ashwood defines gorrak aoePulse and enrage', () => {
    expect(CASTLE.bossMobType).toBe('gorrak');
    expect(CASTLE.bossMechanics.aoePulse).toEqual({ everySec: 9, damage: 14, radiusM: 6 });
    expect(CASTLE.bossMechanics.enrage).toEqual({ afterSec: 240, mult: 1.5 });
  });

  it('enrage timing math', () => {
    const afterSec = CASTLE.bossMechanics.enrage.afterSec;
    const spawned = 1_000_000n;
    const before = spawned + BigInt(afterSec - 1) * 1_000_000n;
    const after = spawned + BigInt(afterSec) * 1_000_000n;
    expect(before - spawned < BigInt(afterSec) * 1_000_000n).toBe(true);
    expect(after - spawned >= BigInt(afterSec) * 1_000_000n).toBe(true);
  });
});
