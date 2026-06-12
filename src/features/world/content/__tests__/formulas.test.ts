/**
 * Formula tests — shared math used by both client and the SpacetimeDB
 * module. Everything must be deterministic with an injected rng.
 */
import { describe, expect, it } from 'vitest';

import {
  GAME_XP_ENABLED,
  MAX_LEVEL,
  PARTY_XP_MULT,
  XP_TABLE,
  mobKillXp,
  partyMemberXp,
  worldLevelFromFitnessXp,
  xpForLevel,
  xpForNext,
  xpToLevel,
} from '../formulas/xp';
import {
  ARMOR_DR_CAP,
  GCD_SEC,
  armorDR,
  deriveStats,
  hitRoll,
  mulberry32,
  resolvePhysicalHit,
  rollDamage,
  seedFrom,
} from '../formulas/combat';
import {
  SELL_RATIO,
  formatCopper,
  sellPriceCopper,
  toCoins,
} from '../formulas/prices';

describe('xp curve', () => {
  it('level boundaries follow the table', () => {
    expect(xpToLevel(0)).toBe(1);
    expect(xpToLevel(1199)).toBe(1);
    expect(xpToLevel(1200)).toBe(2);
    expect(xpToLevel(XP_TABLE[50])).toBe(50);
    expect(xpToLevel(XP_TABLE[50] - 1)).toBe(49);
    expect(xpToLevel(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  it('xpForLevel / xpForNext are consistent', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForNext(1)).toBe(1200);
    for (let lv = 2; lv < MAX_LEVEL; lv++) {
      expect(xpForNext(lv)).toBeGreaterThan(xpForLevel(lv));
    }
  });

  it('worldLevelFromFitnessXp honors the go-live baseline reset', () => {
    const xpAtL10 = xpForLevel(10);
    expect(worldLevelFromFitnessXp(xpAtL10, 0)).toBe(10);
    // After the reset stamps baseline = current XP, the player is level 1
    expect(worldLevelFromFitnessXp(xpAtL10, xpAtL10)).toBe(1);
    // …and climbs again with new fitness XP
    expect(worldLevelFromFitnessXp(xpAtL10 + 1200, xpAtL10)).toBe(2);
    // Never below 1 even on weird inputs
    expect(worldLevelFromFitnessXp(0, 999999)).toBe(1);
  });

  it('ships with game XP disabled', () => {
    expect(GAME_XP_ENABLED).toBe(false);
  });
});

describe('mob kill xp falloff', () => {
  it('full value at small level gaps, gray at 8+', () => {
    expect(mobKillXp(10, 10)).toBe(95);
    expect(mobKillXp(10, 14)).toBe(95); // diff 4 — still full
    expect(mobKillXp(10, 16)).toBe(Math.round(95 * 0.5)); // diff 6 — half
    expect(mobKillXp(10, 18)).toBe(0); // diff 8 — gray
  });

  it('party split: solo unchanged, 3+ gets the group bonus', () => {
    expect(partyMemberXp(100, 1)).toBe(100);
    expect(partyMemberXp(100, 2)).toBe(50);
    expect(partyMemberXp(100, 5)).toBe(Math.round((100 / 5) * PARTY_XP_MULT[5]));
  });
});

describe('deterministic rng', () => {
  it('same seed → same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('seedFrom mixes ids and timestamps stably', () => {
    expect(seedFrom('mob_1', 'player_a', 123456789n)).toBe(
      seedFrom('mob_1', 'player_a', 123456789n),
    );
    expect(seedFrom('mob_1', 'player_a', 1n)).not.toBe(
      seedFrom('mob_1', 'player_b', 1n),
    );
  });

  it('outputs stay in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('combat math', () => {
  it('armor DR is capped and monotonic', () => {
    expect(armorDR(0, 10)).toBe(0);
    expect(armorDR(1e9, 10)).toBe(ARMOR_DR_CAP);
    expect(armorDR(500, 10)).toBeGreaterThan(armorDR(100, 10));
    // Same armor mitigates less against higher-level attackers
    expect(armorDR(500, 30)).toBeLessThan(armorDR(500, 10));
  });

  it('hit table covers all outcomes deterministically', () => {
    const rng = mulberry32(1234);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      seen.add(hitRoll(rng, 10, 10, 0.1));
    }
    expect([...seen].sort()).toEqual(['crit', 'dodge', 'hit', 'miss']);
  });

  it('rollDamage stays within bounds', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 500; i++) {
      const d = rollDamage(rng, 3, 6);
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(6);
    }
    expect(rollDamage(rng, 5, 5)).toBe(5);
  });

  it('resolvePhysicalHit: misses deal 0, hits deal ≥ 1', () => {
    const rng = mulberry32(77);
    let misses = 0;
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const { result, damage } = resolvePhysicalHit(rng, {
        attackerLevel: 5,
        defenderLevel: 5,
        weaponDmgMin: 3,
        weaponDmgMax: 6,
        weaponSpeedSec: 2.4,
        attackPower: 20,
        critChance: 0.05,
        defenderArmor: 50,
      });
      if (result === 'miss' || result === 'dodge') {
        expect(damage).toBe(0);
        misses++;
      } else {
        expect(damage).toBeGreaterThanOrEqual(1);
        hits++;
      }
    }
    expect(misses).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
  });

  it('deriveStats responds to attributes and level', () => {
    const kit = { baseHp: 60, hpPerLevel: 12, baseResource: 100, resourcePerLevel: 0 };
    const weak = deriveStats({ CON: 10, VIT: 10, STR: 10, DEX: 10 }, 1, kit);
    const strong = deriveStats({ CON: 40, VIT: 40, STR: 40, DEX: 40 }, 10, kit);
    expect(strong.maxHp).toBeGreaterThan(weak.maxHp);
    expect(strong.attackPower).toBeGreaterThan(weak.attackPower);
    expect(strong.critChance).toBeGreaterThan(weak.critChance);
    expect(strong.critChance).toBeLessThanOrEqual(0.4);
    expect(GCD_SEC).toBe(1.5);
  });
});

describe('prices', () => {
  it('coin breakdown and formatting', () => {
    expect(toCoins(0)).toEqual({ gold: 0, silver: 0, copper: 0 });
    expect(toCoins(12345)).toEqual({ gold: 1, silver: 23, copper: 45 });
    expect(formatCopper(0)).toBe('0c');
    expect(formatCopper(12345)).toBe('1g 23s 45c');
    expect(formatCopper(205)).toBe('2s 5c');
  });

  it('sell price is the floor of SELL_RATIO, min 1c, 0 for unsellable', () => {
    expect(sellPriceCopper({ vendorPriceCopper: 100 })).toBe(100 * SELL_RATIO);
    expect(sellPriceCopper({ vendorPriceCopper: 2 })).toBe(1);
    expect(sellPriceCopper({})).toBe(0);
  });
});
