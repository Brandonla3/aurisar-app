/**
 * formulas/xp.ts — leveling curve + XP formulas shared by client and the
 * SpacetimeDB module (synced copy — see content/types.ts header).
 *
 * THE WORLD DOES NOT GRANT XP. Levels come from the fitness app: the
 * client calls syncProgress(fitnessXp) and the server derives
 *   worldLevel = xpToLevel(fitnessXp − fitnessXpBaseline)
 * using this exact curve. The in-game XP paths (mob kills, quest
 * turn-ins, party splits) are fully implemented and tested but gated
 * behind GAME_XP_ENABLED so the game can be decoupled from the fitness
 * app later by flipping one constant.
 */

/**
 * Master switch for game-sourced XP. While false, awardXp()-style helpers
 * no-op and quest rewards fall through to copper/items/template unlocks.
 */
export const GAME_XP_ENABLED = false;

/** Hard cap of the shared level curve. */
export const MAX_LEVEL = 100;

/**
 * Per-level XP requirements — MUST stay byte-identical to _XP_PER_LEVEL
 * in src/utils/xp.js (the fitness app's curve). The integrity test
 * cross-checks the resulting tables; if you change one, change both.
 */
const XP_PER_LEVEL: number[] = [
  1200, 2488, 2664, 2848, 3040, 3240, 3448, 3664, 3888, 4120,
  4360, 4608, 4864, 5128, 5400, 5680, 5968, 6264, 6568, 6880,
  7200, 7528, 7864, 8208, 8560, 8920, 9288, 9664, 10048, 10440,
  10840, 11248, 11664, 12088, 12520, 12960, 13408, 13864, 14328, 14800,
  15280, 15768, 16264, 16768, 17280, 17800, 18328, 18864, 19408, 19960,
  20520, 21088, 21664, 22248, 22840, 23440, 24048, 24664, 25288, 25920,
  26560, 27208, 27864, 28528, 29200, 29880, 30568, 31264, 31968, 32680,
  33400, 34128, 34864, 35608, 36360, 37120, 37888, 38664, 39448, 40240,
  41040, 41848, 42664, 43488, 44320, 45160, 46008, 46864, 47728, 48600,
  49480, 50368, 51264, 52168, 53080, 54000, 54928, 55864, 56808,
];

export function buildXPTable(max: number = MAX_LEVEL): number[] {
  const t = [0, 0];
  for (let lv = 2; lv <= Math.min(max, MAX_LEVEL); lv++) {
    t[lv] = t[lv - 1] + XP_PER_LEVEL[lv - 2];
  }
  return t;
}

/** XP_TABLE[level] = cumulative XP required to reach that level. */
export const XP_TABLE = buildXPTable(MAX_LEVEL);

export function xpToLevel(xp: number): number {
  let lv = 1;
  while (lv < XP_TABLE.length - 1 && xp >= XP_TABLE[lv + 1]) lv++;
  return lv;
}

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.min(level, XP_TABLE.length - 1)] || 0;
}

export function xpForNext(level: number): number {
  return (
    XP_TABLE[Math.min(level + 1, XP_TABLE.length - 1)] ||
    XP_TABLE[XP_TABLE.length - 1] ||
    0
  );
}

/**
 * World level from synced fitness XP, honoring the go-live reset baseline.
 * Clamped to [1, MAX_LEVEL]; callers enforce monotonic fitnessXp.
 */
export function worldLevelFromFitnessXp(
  fitnessXp: number,
  fitnessXpBaseline: number,
): number {
  const effective = Math.max(0, fitnessXp - fitnessXpBaseline);
  return Math.min(MAX_LEVEL, Math.max(1, xpToLevel(effective)));
}

// ── Game-sourced XP (gated by GAME_XP_ENABLED) ───────────────────────

/**
 * XP for killing a mob, with level-difference falloff. Gray (zero XP) at
 * 8+ levels below the player; linear taper from 4 below.
 */
export function mobKillXp(mobLevel: number, playerLevel: number): number {
  const base = mobLevel * 5 + 45;
  const diff = playerLevel - mobLevel;
  if (diff >= 8) return 0;
  if (diff <= 4) return base;
  // diff in (4, 8): taper 100% → 0%
  return Math.round(base * (1 - (diff - 4) / 4));
}

/**
 * Per-member multiplier on mob XP when grouped (the split happens first;
 * groups of 3+ get a bonus so partying never feels like a tax).
 * Index by member count (claudecraft-parity values).
 */
export const PARTY_XP_MULT: readonly number[] = [1, 1, 1, 1.166, 1.3, 1.43];

export function partyMemberXp(
  totalXp: number,
  memberCount: number,
): number {
  const n = Math.max(1, Math.min(memberCount, PARTY_XP_MULT.length - 1));
  return Math.round((totalXp / n) * PARTY_XP_MULT[n]);
}
