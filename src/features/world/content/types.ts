/**
 * types.ts — shared type contract for all world game content.
 *
 * CANONICAL LOCATION: src/features/world/content/ (edit here).
 * A verbatim copy lives in spacetimedb/src/content/ so the server module
 * can bundle the same data into its WASM — run `npm run sync:content`
 * after editing anything in this directory.
 *
 * Rules for files in content/:
 *  - Plain data + pure functions only. No imports from outside content/,
 *    no Babylon, no React, no SpacetimeDB SDK, no Math.random/Date.now.
 *  - IDs are stable string keys. Display names are placeholder copy the
 *    story pass rewrites later; code must only ever reference ids.
 */

// ── Classes ──────────────────────────────────────────────────────────
// Must match the keys of CLASSES in src/data/exercises.js (enforced by
// src/features/world/content/__tests__/integrity.test.ts). Display names
// come from CLASSES[id].name — renaming a class touches only that file.
export type ClassId =
  | 'warrior' | 'gladiator' | 'warden' | 'phantom' | 'tempest'
  | 'warlord' | 'druid' | 'oracle' | 'titan' | 'striker' | 'alchemist';

export type ResourceKind = 'mana' | 'rage' | 'energy';

// ── Attributes ───────────────────────────────────────────────────────
// The Aurisar 8-attribute model (computed fitness-side by calcCharStats
// in src/utils/xp.js and synced into the world via syncProgress).
export type AttributeKey =
  | 'STR' | 'END' | 'DEX' | 'CON' | 'INT' | 'CHA' | 'WIS' | 'VIT';

export type AttributeBlock = Partial<Record<AttributeKey, number>>;

// ── Abilities ────────────────────────────────────────────────────────
export type AbilitySchool =
  | 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';

/**
 * Effect union — interpreted server-side by the combat reducers (P3) and
 * client-side only for tooltips/fx. Magnitudes are at-rank-1; ranks scale.
 */
export type AbilityEffect =
  | { kind: 'weaponStrike'; bonusDamage: number }
  | { kind: 'directDamage'; min: number; max: number }
  | { kind: 'dot'; totalDamage: number; durationSec: number; tickSec: number }
  | { kind: 'aoeDamage'; min: number; max: number; radiusM: number }
  | { kind: 'heal'; min: number; max: number }
  | { kind: 'hot'; totalHeal: number; durationSec: number; tickSec: number }
  | { kind: 'absorb'; amount: number; durationSec: number }
  | { kind: 'selfBuff'; stat: AttributeKey | 'armor' | 'attackPower'; amount: number; durationSec: number }
  | { kind: 'buffTarget'; stat: AttributeKey | 'armor' | 'attackPower'; amount: number; durationSec: number }
  | { kind: 'stun'; durationSec: number }
  | { kind: 'root'; durationSec: number }
  | { kind: 'slow'; pct: number; durationSec: number };

export interface AbilityRank {
  /** Player level at which this rank applies. */
  level: number;
  /** Multiplier applied to all effect magnitudes (1 = rank-1 values). */
  magnitudeMult: number;
  cost?: number;
}

export interface AbilityDef {
  id: string;
  classId: ClassId;
  /** Placeholder display name — story pass rewrites. */
  name: string;
  school: AbilitySchool;
  /** Cost in the class's resource (rage/mana/energy). */
  cost: number;
  castTimeSec: number;
  cooldownSec: number;
  rangeM: number;
  triggersGcd: boolean;
  /** Rogue-style kits: builds (+n) or spends ('all') combo points. */
  combo?: { builds?: number; spendsAll?: boolean };
  effects: AbilityEffect[];
  ranks?: AbilityRank[];
  minLevel: number;
  description: string;
  /** Optional authored icon: public/assets/icons/abilities/<iconKey>.png.
   *  Absent → procedural canvas icon (hud/icons/iconFactory.js). */
  iconKey?: string;
}

export interface ClassKitDef {
  classId: ClassId;
  resource: ResourceKind;
  usesComboPoints: boolean;
  baseHp: number;
  hpPerLevel: number;
  baseResource: number;
  resourcePerLevel: number;
  /** Ordered — becomes the default hotbar layout as abilities unlock. */
  abilityIds: string[];
}

// ── Items ────────────────────────────────────────────────────────────
export type ItemQuality = 'common' | 'uncommon' | 'rare' | 'epic';

export type ItemType =
  | 'weapon' | 'armor' | 'consumable' | 'ingredient' | 'quest' | 'misc';

export type EquipSlot =
  | 'head' | 'chest' | 'legs' | 'feet' | 'hands'
  | 'mainHand' | 'offHand' | 'trinket';

/**
 * Fitness-side perks carried by world equipment. Multipliers (1.05 = +5%)
 * applied to fitness XP by calcExXP via the Supabase mirror (P4).
 * Keys reference src/data/exercises.js exercise ids / muscleGroup /
 * category values — cross-checked by the integrity test, not at runtime.
 */
export interface FitnessPerks {
  exercises?: Record<string, number>;
  muscleGroups?: Record<string, number>;
  categories?: Record<string, number>;
}

export interface ItemGameStats extends AttributeBlock {
  armor?: number;
  weaponDmgMin?: number;
  weaponDmgMax?: number;
  weaponSpeedSec?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  /** Emoji fallback for list UIs (matches the existing items.js pattern). */
  icon: string;
  type: ItemType;
  stack: number;
  quality: ItemQuality;
  slot?: EquipSlot;
  gameStats?: ItemGameStats;
  fitnessPerks?: FitnessPerks;
  /** Consumables: HP restored on use (server-applied, P4). */
  heal?: number;
  /** Vendor buy price; sell-back = sellPriceCopper() in formulas/prices.ts. */
  vendorPriceCopper?: number;
  minLevel?: number;
}

// ── Loot ─────────────────────────────────────────────────────────────
export interface LootEntry {
  itemId: string;
  /** Independent roll probability in [0,1]. */
  chance: number;
  min: number;
  max: number;
}

// ── Mobs ─────────────────────────────────────────────────────────────
export interface MobDef {
  /** Matches the server `mob.mobType` column. */
  mobType: string;
  name: string;
  level: number;
  maxHp: number;
  dmgMin: number;
  dmgMax: number;
  attackSpeedSec: number;
  moveSpeedMps: number;
  aggroRadiusM: number;
  leashRadiusM: number;
  respawnSec: number;
  /** Asset key → public/assets/creatures/<glbKey>/<glbKey>.glb (swap-in-place). */
  glbKey: string;
  /** Aggroing one pulls nearby mobs of the same spawn family. */
  social?: boolean;
  lootTable?: LootEntry[];
  copperMin?: number;
  copperMax?: number;
}

export interface SpawnDef {
  /** Unique spawn-family id, e.g. 'z1_wolves_north'. */
  netId: string;
  mobType: string;
  /**
   * Which zone's originOffsetM applies to pos — zones share one
   * coordinate plane, so the seeder must offset per zone. Never rely on
   * netId prefixes for this.
   */
  zoneId: number;
  /** Zone-local meters. */
  pos: { x: number; z: number };
  count: number;
  radiusM: number;
}

/** Dungeon spawns are positioned in dungeon-layout space — no zone. */
export type DungeonSpawnDef = Omit<SpawnDef, 'zoneId'>;

// ── NPCs ─────────────────────────────────────────────────────────────
export interface NpcDef {
  id: string;
  zoneId: number;
  /** Placeholder display name — story pass rewrites. */
  name: string;
  title?: string;
  /** Zone-local meters. */
  pos: { x: number; z: number };
  facingRad: number;
  /** Asset key under public/assets/creatures/ (humanoids share the pool);
   *  absent → tinted base-body avatar. */
  glbKey?: string;
  questIds: string[];
  /** $N = player name, $C = class display name. */
  greeting: string;
  vendorItemIds?: string[];
}

// ── Quests ───────────────────────────────────────────────────────────
export type QuestObjective =
  | { type: 'kill'; mobType: string; count: number; label: string }
  /** Requires server inventory — activates in P4. */
  | { type: 'collect'; itemId: string; count: number; label: string }
  /** Resolved against WaypointDef ids; completed via reachWaypoint. */
  | { type: 'find'; targetId: string; label: string };

export interface QuestReward {
  copper: number;
  /** Per-class reward — exactly one granted, by the player's class. */
  itemIdsByClass?: Partial<Record<ClassId, string>>;
  /** Granted to everyone in addition to the class pick. */
  itemIds?: string[];
  /** Fitness workout templates (ids from WORKOUT_TEMPLATES in
   *  src/data/constants.js). Gating UI lands in P2. */
  templateUnlockIds?: string[];
  /** Only applied while GAME_XP_ENABLED (formulas/xp.ts) is true. */
  gameXp: number;
}

export interface QuestDef {
  id: string;
  zoneId: number;
  /** Placeholder display name — story pass rewrites. */
  name: string;
  giverNpcId: string;
  turnInNpcId: string;
  /** Placeholder quest text — story pass rewrites. $N/$C substituted. */
  text: string;
  completionText: string;
  objectives: QuestObjective[];
  reward: QuestReward;
  minLevel?: number;
  requiresQuestId?: string;
}

// ── World structure ──────────────────────────────────────────────────
export interface WaypointDef {
  id: string;
  zoneId: number;
  pos: { x: number; z: number };
  radiusM: number;
  label: string;
}

export interface ZoneGate {
  id: string;
  pos: { x: number; z: number };
  toZoneId: number;
  toGateId: string;
}

export interface ZoneDef {
  /** Server `player.zoneId` value. 0 is reserved for the legacy hub. */
  id: number;
  key: string;
  /** Placeholder display name — story pass rewrites. */
  name: string;
  levelBand: [number, number];
  /**
   * Offset of this zone's worldgen origin on the shared coordinate plane
   * (zone k at x ≈ k·3000 m so STDB px never collide across zones).
   */
  originOffsetM: { x: number; z: number };
  /** Worldgen config under src/features/world/worldgen/configs/. */
  worldConfig: string;
  spawnPos: { x: number; z: number };
  graveyardPos: { x: number; z: number };
  gates: ZoneGate[];
}

// ── Dungeons ─────────────────────────────────────────────────────────
export interface BossMechanics {
  aoePulse?: { everySec: number; damage: number; radiusM: number };
  addWaves?: { hpPct: number; mobType: string; count: number }[];
  enrage?: { afterSec: number; mult: number };
}

export interface DungeonDef {
  id: string;
  name: string;
  minLevel: number;
  entrance: { zoneId: number; pos: { x: number; z: number } };
  /** JSON layout manifest under public/assets/dungeons/. */
  layoutManifest: string;
  bossMobType: string;
  bossMechanics: BossMechanics;
  spawns: DungeonSpawnDef[];
}
