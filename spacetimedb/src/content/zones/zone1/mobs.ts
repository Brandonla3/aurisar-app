// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/mobs.ts
// Regenerate with: npm run sync:content

/**
 * zone1/mobs.ts — zone-1 mob roster + camp spawns, modeled on the
 * reference design's starter zone (see public/assets/ATTRIBUTION.md).
 *
 * Adaptations from the reference (noted per the porting contract):
 *  - Per-level stat formulas are baked at each mob's mid level (our
 *    MobDef is flat until P3's level-scaled combat).
 *  - moveSpeedMps scaled by ~0.55 — the reference mobs run 8 yd/s against
 *    a 7 yd/s player; our player moves slower, so the ratio is preserved
 *    rather than the absolute value.
 *  - Loot tables ship now but only roll once P4's server inventory lands.
 */
import type { MobDef, SpawnDef } from '../../types';

export const MOBS: MobDef[] = [
  {
    mobType: 'forest_wolf',
    name: 'Forest Wolf',
    family: 'beast',
    level: 2,
    maxHp: 56,
    dmgMin: 5,
    dmgMax: 8,
    attackSpeedSec: 2.0,
    moveSpeedMps: 4.4,
    aggroRadiusM: 10,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'wolf',
    lootTable: [{ itemId: 'wolf_fang', chance: 0.45, min: 1, max: 1 }],
    copperMin: 8,
    copperMax: 8,
  },
  {
    mobType: 'old_greyjaw',
    name: 'Old Greyjaw',
    family: 'beast',
    level: 4,
    maxHp: 190,
    dmgMin: 11,
    dmgMax: 14,
    attackSpeedSec: 1.8,
    moveSpeedMps: 4.7,
    aggroRadiusM: 12,
    leashRadiusM: 40,
    respawnSec: 180,
    glbKey: 'wolf',
    lootTable: [
      { itemId: 'greyjaw_fang', chance: 1, min: 1, max: 1 },
      { itemId: 'wolf_fang', chance: 1, min: 1, max: 1 },
    ],
    copperMin: 60,
    copperMax: 60,
  },
  {
    mobType: 'wild_boar',
    name: 'Wild Boar',
    family: 'beast',
    level: 3,
    maxHp: 82,
    dmgMin: 8,
    dmgMax: 11,
    attackSpeedSec: 2.2,
    moveSpeedMps: 4.1,
    aggroRadiusM: 9,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'bull',
    lootTable: [
      { itemId: 'boar_hide', chance: 0.6, min: 1, max: 1 },
      { itemId: 'tough_jerky', chance: 0.3, min: 1, max: 1 },
    ],
    copperMin: 12,
    copperMax: 12,
  },
  {
    mobType: 'webwood_spider',
    name: 'Webwood Lurker',
    family: 'spider',
    level: 3,
    maxHp: 75,
    dmgMin: 7,
    dmgMax: 10,
    attackSpeedSec: 1.8,
    moveSpeedMps: 4.4,
    aggroRadiusM: 10,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'spider',
    lootTable: [
      { itemId: 'webwood_silk', chance: 0.55, min: 1, max: 1 },
      { itemId: 'spider_leg', chance: 0.4, min: 1, max: 1 },
    ],
    copperMin: 14,
    copperMax: 14,
  },
  {
    mobType: 'mudfin_murloc',
    name: 'Mudfin Skulker',
    family: 'murloc',
    level: 4,
    maxHp: 104,
    dmgMin: 11,
    dmgMax: 14,
    attackSpeedSec: 1.9,
    moveSpeedMps: 4.4,
    aggroRadiusM: 13,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'glubevolved',
    social: true, // "where there is one murloc, there are five"
    lootTable: [
      { itemId: 'mudfin_scale', chance: 0.5, min: 1, max: 1 },
      { itemId: 'linen_scrap', chance: 0.2, min: 1, max: 1 },
    ],
    copperMin: 18,
    copperMax: 18,
  },
  {
    mobType: 'tunnel_rat',
    name: 'Tunnel Rat Digger',
    family: 'kobold',
    level: 5,
    maxHp: 132,
    dmgMin: 14,
    dmgMax: 17,
    attackSpeedSec: 2.1,
    moveSpeedMps: 3.9,
    aggroRadiusM: 10,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'goblin',
    lootTable: [
      { itemId: 'tallow_candle', chance: 0.6, min: 1, max: 1 },
      { itemId: 'blessed_wax', chance: 0.45, min: 1, max: 1 },
      { itemId: 'linen_scrap', chance: 0.25, min: 1, max: 1 },
    ],
    copperMin: 22,
    copperMax: 22,
  },
  {
    mobType: 'vale_bandit',
    name: 'Vale Bandit',
    family: 'humanoid',
    level: 4,
    maxHp: 112,
    dmgMin: 11,
    dmgMax: 14,
    attackSpeedSec: 2.0,
    moveSpeedMps: 3.9,
    aggroRadiusM: 11,
    leashRadiusM: 40,
    respawnSec: 45,
    glbKey: 'tribal',
    social: true,
    lootTable: [
      { itemId: 'bandit_bandana', chance: 0.5, min: 1, max: 1 },
      { itemId: 'linen_scrap', chance: 0.3, min: 1, max: 1 },
    ],
    copperMin: 25,
    copperMax: 25,
  },
  {
    mobType: 'restless_bones',
    name: 'Restless Bones',
    family: 'undead',
    level: 6,
    maxHp: 160,
    dmgMin: 18,
    dmgMax: 21,
    attackSpeedSec: 2.3,
    moveSpeedMps: 3.6,
    aggroRadiusM: 11,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'skeleton_minion',
    lootTable: [
      { itemId: 'bone_fragments', chance: 0.6, min: 1, max: 1 },
      { itemId: 'ghostly_essence', chance: 0.55, min: 1, max: 1 },
    ],
    copperMin: 30,
    copperMax: 30,
  },
  {
    mobType: 'gorrak',
    name: 'Gorrak the Ruthless',
    family: 'humanoid',
    level: 6,
    maxHp: 340,
    dmgMin: 20,
    dmgMax: 24,
    attackSpeedSec: 2.4,
    moveSpeedMps: 3.9,
    aggroRadiusM: 13,
    leashRadiusM: 40,
    respawnSec: 300,
    glbKey: 'orcenemy',
    lootTable: [
      { itemId: 'bandit_bandana', chance: 1, min: 1, max: 1 },
      { itemId: 'oiled_boots', chance: 0.5, min: 1, max: 1 },
      { itemId: 'quilted_trousers', chance: 0.5, min: 1, max: 1 },
    ],
    copperMin: 250,
    copperMax: 250,
  },
];

// Camp positions follow the reference zone-1 layout (coordinate frame
// carried over 1:1 — relative layout is identical). Comments use the
// zone's POI names (see waypoints.ts).
export const SPAWNS: SpawnDef[] = [
  // Greywood Run (north)
  { netId: 'z1_wolves_a',   mobType: 'forest_wolf',    zoneId: 1, pos: { x: -15, z: 55 },  count: 7, radiusM: 22 },
  { netId: 'z1_wolves_b',   mobType: 'forest_wolf',    zoneId: 1, pos: { x: 20, z: 70 },   count: 6, radiusM: 20 },
  { netId: 'z1_greyjaw',    mobType: 'old_greyjaw',    zoneId: 1, pos: { x: 0, z: 95 },    count: 1, radiusM: 8 },
  // Tuskfield (east)
  { netId: 'z1_boars_a',    mobType: 'wild_boar',      zoneId: 1, pos: { x: 55, z: 12 },   count: 6, radiusM: 22 },
  { netId: 'z1_boars_b',    mobType: 'wild_boar',      zoneId: 1, pos: { x: 80, z: -15 },  count: 5, radiusM: 18 },
  // Gloomweb (west)
  { netId: 'z1_spiders',    mobType: 'webwood_spider', zoneId: 1, pos: { x: -60, z: 5 },   count: 7, radiusM: 22 },
  // Stillmere shore (northwest)
  { netId: 'z1_murlocs',    mobType: 'mudfin_murloc',  zoneId: 1, pos: { x: -75, z: 57 },  count: 8, radiusM: 14 },
  // Rustvein Dig (southwest)
  { netId: 'z1_kobolds',    mobType: 'tunnel_rat',     zoneId: 1, pos: { x: -82, z: -62 }, count: 9, radiusM: 20 },
  // Gallows Rise (southeast)
  { netId: 'z1_bandits_a',  mobType: 'vale_bandit',    zoneId: 1, pos: { x: 65, z: -65 },  count: 7, radiusM: 24 },
  { netId: 'z1_bandits_b',  mobType: 'vale_bandit',    zoneId: 1, pos: { x: 90, z: -90 },  count: 5, radiusM: 16 },
  { netId: 'z1_gorrak',     mobType: 'gorrak',         zoneId: 1, pos: { x: 92, z: -92 },  count: 1, radiusM: 2 },
  // Mourner's Rest (northeast)
  { netId: 'z1_undead',     mobType: 'restless_bones', zoneId: 1, pos: { x: 80, z: 78 },   count: 8, radiusM: 18 },
];
