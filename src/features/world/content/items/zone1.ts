/**
 * items/zone1.ts — zone 1 item set, modeled on the reference design's
 * starter zone (see public/assets/ATTRIBUTION.md). Names are working
 * placeholders the story pass rewrites. Stats are light placeholders —
 * full equipment stats land with P4 tuning.
 */
import type { ItemDef } from '../types';

export const ZONE1_ITEMS: ItemDef[] = [
  // ── Provisioner's goods ────────────────────────────────────────────
  { id: 'roasted_boar', name: 'Roasted Boar', icon: '🍖', type: 'consumable', stack: 20, quality: 'common', heal: 25, vendorPriceCopper: 18 },
  { id: 'tough_jerky',  name: 'Tough Jerky',  icon: '🥓', type: 'consumable', stack: 20, quality: 'common', heal: 12, vendorPriceCopper: 8 },

  // ── Smith's wares ──────────────────────────────────────────────────
  { id: 'arming_sword',     name: 'Arming Sword',     icon: '🗡️', type: 'weapon', stack: 1, quality: 'common', slot: 'mainHand', gameStats: { weaponDmgMin: 4, weaponDmgMax: 7, weaponSpeedSec: 2.4 }, vendorPriceCopper: 220 },
  { id: 'bronzework_mace',  name: 'Bronzework Mace',  icon: '🔨', type: 'weapon', stack: 1, quality: 'common', slot: 'mainHand', gameStats: { weaponDmgMin: 5, weaponDmgMax: 8, weaponSpeedSec: 2.8 }, vendorPriceCopper: 240 },
  { id: 'carving_knife',    name: 'Carving Knife',    icon: '🔪', type: 'weapon', stack: 1, quality: 'common', slot: 'mainHand', gameStats: { weaponDmgMin: 2, weaponDmgMax: 5, weaponSpeedSec: 1.8 }, vendorPriceCopper: 180 },
  { id: 'hickory_shortstaff', name: 'Hickory Shortstaff', icon: '🪄', type: 'weapon', stack: 1, quality: 'common', slot: 'mainHand', gameStats: { weaponDmgMin: 4, weaponDmgMax: 6, weaponSpeedSec: 3.0, INT: 1 }, vendorPriceCopper: 200 },
  { id: 'chain_vest',       name: 'Chain Vest',       icon: '🦺', type: 'armor', stack: 1, quality: 'common', slot: 'chest', gameStats: { armor: 14 }, vendorPriceCopper: 260 },
  { id: 'spun_robe',        name: 'Spun Robe',        icon: '🥻', type: 'armor', stack: 1, quality: 'common', slot: 'chest', gameStats: { armor: 6, INT: 1 }, vendorPriceCopper: 210 },
  { id: 'tanned_leather_jerkin', name: 'Tanned Leather Jerkin', icon: '🧥', type: 'armor', stack: 1, quality: 'common', slot: 'chest', gameStats: { armor: 10, DEX: 1 }, vendorPriceCopper: 230 },
  { id: 'hobnail_boots',    name: 'Hobnail Boots',    icon: '🥾', type: 'armor', stack: 1, quality: 'common', slot: 'feet', gameStats: { armor: 5 }, vendorPriceCopper: 140 },
  { id: 'wool_trousers',    name: 'Wool Trousers',    icon: '👖', type: 'armor', stack: 1, quality: 'common', slot: 'legs', gameStats: { armor: 6 }, vendorPriceCopper: 150 },

  // ── Mob loot / junk (loot tables activate with P4 server inventory) ─
  { id: 'wolf_fang',      name: 'Wolf Fang',          icon: '🦷', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 6 },
  { id: 'greyjaw_fang',   name: "Old Greyjaw's Fang", icon: '🦷', type: 'quest', stack: 1,  quality: 'uncommon' },
  { id: 'boar_hide',      name: 'Bristly Boar Hide',  icon: '🟫', type: 'quest', stack: 20, quality: 'common' },
  { id: 'webwood_silk',   name: 'Webwood Silk Gland', icon: '🕸️', type: 'quest', stack: 20, quality: 'common' },
  { id: 'spider_leg',     name: 'Spider Leg',         icon: '🦵', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 7 },
  { id: 'mudfin_scale',   name: 'Mudfin Scale',       icon: '🐟', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 9 },
  { id: 'linen_scrap',    name: 'Linen Scrap',        icon: '🧵', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 4 },
  { id: 'tallow_candle',  name: 'Tallow Candle',      icon: '🕯️', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 5 },
  { id: 'blessed_wax',    name: 'Blessed Tallow',     icon: '🕯️', type: 'quest', stack: 20, quality: 'common' },
  { id: 'bone_fragments', name: 'Bone Fragments',     icon: '🦴', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 8 },
  { id: 'ghostly_essence',name: 'Ghostly Essence',    icon: '👻', type: 'quest', stack: 20, quality: 'common' },
  { id: 'bandit_bandana', name: 'Bandit Bandana',     icon: '🎭', type: 'misc', stack: 20, quality: 'common', vendorPriceCopper: 12 },
  { id: 'oiled_boots',    name: 'Oiled Boots',        icon: '🥾', type: 'armor', stack: 1, quality: 'uncommon', slot: 'feet', gameStats: { armor: 7, DEX: 1 } },
  { id: 'quilted_trousers', name: 'Quilted Trousers', icon: '👖', type: 'armor', stack: 1, quality: 'uncommon', slot: 'legs', gameStats: { armor: 8 } },

  // ── Quest rewards (active questline) ───────────────────────────────
  { id: 'redbrook_blade', name: 'Redbrook Blade', icon: '⚔️', type: 'weapon', stack: 1, quality: 'uncommon', slot: 'mainHand', gameStats: { weaponDmgMin: 5, weaponDmgMax: 9, weaponSpeedSec: 2.5, STR: 1 }, minLevel: 3 },
  { id: 'militia_vest',   name: 'Militia Vest',   icon: '🦺', type: 'armor', stack: 1, quality: 'uncommon', slot: 'chest', gameStats: { armor: 16, CON: 1 }, minLevel: 5 },
];
