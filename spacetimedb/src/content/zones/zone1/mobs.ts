// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/mobs.ts
// Regenerate with: npm run sync:content

/**
 * zone1/mobs.ts — mob defs + spawn camps for zone 1 (levels 1–12).
 * 'wolf' matches the existing server mobType; boar/bandit get CC0
 * placeholder models (public/assets/creatures/<glbKey>/). Stats are
 * placeholder tuning — P3 revisits with the generalized combat tick.
 */
import type { MobDef, SpawnDef } from '../../types';

export const MOBS: MobDef[] = [
  {
    mobType: 'wolf',
    name: 'Greyjaw Wolf', // placeholder
    level: 2,
    maxHp: 40,
    dmgMin: 3,
    dmgMax: 5,
    attackSpeedSec: 2.0,
    moveSpeedMps: 4.5,
    aggroRadiusM: 18,
    leashRadiusM: 35,
    respawnSec: 45,
    glbKey: 'wolf',
    lootTable: [{ itemId: 'qi_wolf_pelt', chance: 0.6, min: 1, max: 1 }],
    copperMin: 2,
    copperMax: 8,
  },
  {
    mobType: 'boar',
    name: 'Bristleback Boar', // placeholder
    level: 4,
    maxHp: 60,
    dmgMin: 4,
    dmgMax: 7,
    attackSpeedSec: 2.4,
    moveSpeedMps: 4.0,
    aggroRadiusM: 14,
    leashRadiusM: 35,
    respawnSec: 60,
    glbKey: 'boar',
    lootTable: [{ itemId: 'rawMeat', chance: 0.7, min: 1, max: 2 }],
    copperMin: 4,
    copperMax: 12,
  },
  {
    mobType: 'bandit',
    name: 'Roadside Bandit', // placeholder
    level: 6,
    maxHp: 85,
    dmgMin: 6,
    dmgMax: 9,
    attackSpeedSec: 2.2,
    moveSpeedMps: 5.0,
    aggroRadiusM: 16,
    leashRadiusM: 40,
    respawnSec: 75,
    glbKey: 'bandit',
    social: true,
    lootTable: [{ itemId: 'qi_sealed_dispatch', chance: 0.25, min: 1, max: 1 }],
    copperMin: 8,
    copperMax: 20,
  },
];

export const SPAWNS: SpawnDef[] = [
  { netId: 'z1_wolves_north', mobType: 'wolf',   zoneId: 1, pos: { x: 0, z: 180 },   count: 6, radiusM: 40 },
  { netId: 'z1_wolves_west',  mobType: 'wolf',   zoneId: 1, pos: { x: -150, z: 90 }, count: 4, radiusM: 35 },
  { netId: 'z1_boars_east',   mobType: 'boar',   zoneId: 1, pos: { x: 160, z: 60 },  count: 6, radiusM: 40 },
  { netId: 'z1_bandit_camp',  mobType: 'bandit', zoneId: 1, pos: { x: 120, z: 320 }, count: 5, radiusM: 30 },
];
