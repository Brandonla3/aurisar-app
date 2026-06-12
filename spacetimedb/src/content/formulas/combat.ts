// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/formulas/combat.ts
// Regenerate with: npm run sync:content

/**
 * formulas/combat.ts — deterministic combat math shared by the client
 * (tooltips, predictions) and the SpacetimeDB module (authoritative).
 *
 * No Math.random anywhere: every roll takes an injected Rng so the server
 * seeds from reducer timestamps (mulberry32(seedFrom(...))) and tests can
 * replay exact sequences.
 */

import type { AttributeBlock, ClassKitDef } from '../types';

// ── Deterministic RNG ────────────────────────────────────────────────

export type Rng = () => number;

/** mulberry32 — small, fast, good-enough PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix arbitrary numeric/string ids + a timestamp into a 32-bit seed. */
export function seedFrom(...parts: (number | string | bigint)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'string' ? p : p.toString();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

// ── Derived stats from the Aurisar 8-attribute model ─────────────────
// Mapping (plan §2b, FOR REVIEW during P3 tuning):
//   HP        ← CON + VIT     attack power ← STR + DEX
//   crit      ← DEX           resource max ← INT + WIS
//   mitigation← CON (flat armor contribution)

export interface DerivedStats {
  maxHp: number;
  attackPower: number;
  critChance: number;
  maxResource: number;
  baseArmor: number;
}

export function deriveStats(
  attrs: AttributeBlock,
  level: number,
  kit: Pick<
    ClassKitDef,
    'baseHp' | 'hpPerLevel' | 'baseResource' | 'resourcePerLevel'
  >,
): DerivedStats {
  const a = (k: keyof AttributeBlock) => attrs[k] ?? 0;
  return {
    maxHp: Math.round(
      kit.baseHp + kit.hpPerLevel * (level - 1) + (a('CON') + a('VIT')) * 2,
    ),
    attackPower: Math.round(a('STR') + a('DEX')),
    critChance: Math.min(0.4, 0.05 + a('DEX') * 0.0008),
    maxResource: Math.round(
      kit.baseResource +
        kit.resourcePerLevel * (level - 1) +
        (a('INT') + a('WIS')),
    ),
    baseArmor: a('CON') * 2,
  };
}

// ── Hit table ────────────────────────────────────────────────────────

export type HitResult = 'miss' | 'dodge' | 'crit' | 'hit';

/**
 * Single-roll hit table (vanilla-style): miss, then dodge, then crit,
 * else plain hit. Miss grows 1%/level the defender is above the attacker
 * (capped +8%); shrinks 0.5%/level below (floored at 1%).
 */
export function hitRoll(
  rng: Rng,
  attackerLevel: number,
  defenderLevel: number,
  critChance: number,
  dodgeChance: number = 0.05,
): HitResult {
  const diff = defenderLevel - attackerLevel;
  const miss =
    diff >= 0
      ? Math.min(0.05 + diff * 0.01, 0.13)
      : Math.max(0.05 + diff * 0.005, 0.01);
  const roll = rng();
  if (roll < miss) return 'miss';
  if (roll < miss + dodgeChance) return 'dodge';
  if (roll < miss + dodgeChance + critChance) return 'crit';
  return 'hit';
}

export const CRIT_MULT = 1.5;

// ── Mitigation ───────────────────────────────────────────────────────

export const ARMOR_DR_CAP = 0.75;

/** Claudecraft/vanilla armor formula, capped at 75% reduction. */
export function armorDR(armor: number, attackerLevel: number): number {
  if (armor <= 0) return 0;
  const dr = armor / (armor + 85 * attackerLevel + 400);
  return Math.min(ARMOR_DR_CAP, dr);
}

// ── Damage rolls ─────────────────────────────────────────────────────

export function rollDamage(rng: Rng, min: number, max: number): number {
  if (max <= min) return Math.round(min);
  return Math.round(min + rng() * (max - min));
}

/**
 * Final physical hit: weapon roll + AP contribution, hit-table result,
 * armor mitigation. Returns 0 on miss/dodge.
 */
export function resolvePhysicalHit(
  rng: Rng,
  opts: {
    attackerLevel: number;
    defenderLevel: number;
    weaponDmgMin: number;
    weaponDmgMax: number;
    weaponSpeedSec: number;
    attackPower: number;
    critChance: number;
    defenderArmor: number;
    bonusDamage?: number;
  },
): { result: HitResult; damage: number } {
  const result = hitRoll(
    rng,
    opts.attackerLevel,
    opts.defenderLevel,
    opts.critChance,
  );
  if (result === 'miss' || result === 'dodge') return { result, damage: 0 };

  // Normalized AP contribution: AP/14 dps × weapon speed (vanilla-style).
  const apBonus = (opts.attackPower / 14) * opts.weaponSpeedSec;
  let dmg =
    rollDamage(rng, opts.weaponDmgMin, opts.weaponDmgMax) +
    apBonus +
    (opts.bonusDamage ?? 0);
  if (result === 'crit') dmg *= CRIT_MULT;
  dmg *= 1 - armorDR(opts.defenderArmor, opts.attackerLevel);
  return { result, damage: Math.max(1, Math.round(dmg)) };
}

// ── Global cooldown ──────────────────────────────────────────────────

export const GCD_SEC = 1.5;
export const GCD_SEC_ENERGY = 1.0; // energy kits run a faster GCD
