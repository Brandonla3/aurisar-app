// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/index.ts
// Regenerate with: npm run sync:content

/**
 * content/index.ts — the canonical aggregate of all world game content.
 *
 * This is the file gameplay code (client AND server module) imports from.
 * Editing story/quests/NPCs/items happens in the files this re-exports;
 * after any edit run `npm run sync:content` to refresh the server mirror
 * and `npm test` to re-check referential integrity.
 */
import type {
  AbilityDef,
  ClassKitDef,
  DungeonDef,
  ItemDef,
  MobDef,
  NpcDef,
  QuestDef,
  SpawnDef,
  WaypointDef,
  ZoneDef,
} from './types';

import { ABILITIES, ALL_ABILITIES, CLASS_IDS, CLASS_KITS } from './classes/index';
import { ALL_ITEMS, ITEMS, getItemDef } from './items/index';
import { ZONES, ZONES_BY_ID, getZone } from './zones/manifest';
import { MOBS as ZONE1_MOBS, SPAWNS as ZONE1_SPAWNS } from './zones/zone1/mobs';
import { NPCS as ZONE1_NPCS } from './zones/zone1/npcs';
import { QUESTS as ZONE1_QUESTS } from './zones/zone1/quests';
import { WAYPOINTS as ZONE1_WAYPOINTS } from './zones/zone1/waypoints';
import { DUNGEONS } from './dungeons/index';

export * from './types';
export { ABILITIES, ALL_ABILITIES, CLASS_IDS, CLASS_KITS } from './classes/index';
export { ALL_ITEMS, ITEMS, getItemDef } from './items/index';
export { ZONES, ZONES_BY_ID, getZone } from './zones/manifest';
export { DUNGEONS } from './dungeons/index';

// ── Flat collections (zone files merge here as zones ship) ───────────
// The raw ALL_* arrays keep authoring mistakes visible: the keyed maps
// below would silently last-wins-swallow duplicate ids, so the validator
// always checks the arrays.

export const ALL_NPCS: NpcDef[] = [...ZONE1_NPCS];
export const ALL_QUESTS: QuestDef[] = [...ZONE1_QUESTS];
export const ALL_MOBS: MobDef[] = [...ZONE1_MOBS];
export const ALL_WAYPOINTS: WaypointDef[] = [...ZONE1_WAYPOINTS];
export const SPAWNS: SpawnDef[] = [...ZONE1_SPAWNS];

export const NPCS: Record<string, NpcDef> = Object.fromEntries(
  ALL_NPCS.map((n) => [n.id, n]),
);

export const QUESTS: Record<string, QuestDef> = Object.fromEntries(
  ALL_QUESTS.map((q) => [q.id, q]),
);

export const MOBS: Record<string, MobDef> = Object.fromEntries(
  ALL_MOBS.map((m) => [m.mobType, m]),
);

export const WAYPOINTS: Record<string, WaypointDef> = Object.fromEntries(
  ALL_WAYPOINTS.map((w) => [w.id, w]),
);

// ── Referential integrity ────────────────────────────────────────────

/**
 * Validates every cross-reference in the content graph. Returns a list of
 * human-readable errors (empty = valid). Run by the vitest integrity test
 * (which CI runs via `npm test`).
 */
export function validateContent(): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  const npcs = Object.values(NPCS);
  const quests = Object.values(QUESTS);
  const kits = Object.values(CLASS_KITS) as ClassKitDef[];
  const abilities = Object.values(ABILITIES) as AbilityDef[];
  const dungeons = DUNGEONS as DungeonDef[];

  // NPCs
  for (const npc of npcs) {
    if (!ZONES_BY_ID[npc.zoneId]) err(`npc ${npc.id}: unknown zoneId ${npc.zoneId}`);
    for (const qid of npc.questIds) {
      if (!QUESTS[qid]) err(`npc ${npc.id}: unknown questId ${qid}`);
    }
    for (const iid of npc.vendorItemIds ?? []) {
      const item = ITEMS[iid];
      if (!item) err(`npc ${npc.id}: unknown vendor itemId ${iid}`);
      else if (!item.vendorPriceCopper) err(`npc ${npc.id}: vendor item ${iid} has no vendorPriceCopper`);
    }
  }

  // Quests
  for (const q of quests) {
    if (!ZONES_BY_ID[q.zoneId]) err(`quest ${q.id}: unknown zoneId ${q.zoneId}`);
    if (!NPCS[q.giverNpcId]) err(`quest ${q.id}: unknown giverNpcId ${q.giverNpcId}`);
    if (!NPCS[q.turnInNpcId]) err(`quest ${q.id}: unknown turnInNpcId ${q.turnInNpcId}`);
    else if (!NPCS[q.giverNpcId]?.questIds.includes(q.id)) {
      err(`quest ${q.id}: giver ${q.giverNpcId} does not list it in questIds`);
    }
    if (q.requiresQuestId && !QUESTS[q.requiresQuestId]) {
      err(`quest ${q.id}: unknown requiresQuestId ${q.requiresQuestId}`);
    }
    if (q.objectives.length === 0) err(`quest ${q.id}: no objectives`);
    for (const obj of q.objectives) {
      if (obj.type === 'kill' && !MOBS[obj.mobType]) {
        err(`quest ${q.id}: kill objective references unknown mobType ${obj.mobType}`);
      }
      if (obj.type === 'collect' && !ITEMS[obj.itemId]) {
        err(`quest ${q.id}: collect objective references unknown itemId ${obj.itemId}`);
      }
      if (obj.type === 'find' && !WAYPOINTS[obj.targetId]) {
        err(`quest ${q.id}: find objective references unknown waypoint ${obj.targetId}`);
      }
    }
    for (const iid of q.reward.itemIds ?? []) {
      if (!ITEMS[iid]) err(`quest ${q.id}: reward references unknown itemId ${iid}`);
    }
    for (const [cls, iid] of Object.entries(q.reward.itemIdsByClass ?? {})) {
      if (!CLASS_KITS[cls as keyof typeof CLASS_KITS]) err(`quest ${q.id}: reward class ${cls} unknown`);
      if (iid && !ITEMS[iid]) err(`quest ${q.id}: reward (class ${cls}) references unknown itemId ${iid}`);
    }
  }

  // Class kits / abilities
  for (const kit of kits) {
    for (const aid of kit.abilityIds) {
      const a = ABILITIES[aid];
      if (!a) err(`class ${kit.classId}: unknown abilityId ${aid}`);
      else if (a.classId !== kit.classId) {
        err(`class ${kit.classId}: ability ${aid} belongs to ${a.classId}`);
      }
    }
  }
  for (const a of abilities) {
    if (!CLASS_KITS[a.classId]) err(`ability ${a.id}: unknown classId ${a.classId}`);
    else if (!CLASS_KITS[a.classId].abilityIds.includes(a.id)) {
      err(`ability ${a.id}: not listed in ${a.classId} kit abilityIds`);
    }
    if (a.combo && !CLASS_KITS[a.classId]?.usesComboPoints) {
      err(`ability ${a.id}: has combo data but ${a.classId} kit does not use combo points`);
    }
  }

  // Mobs / spawns / waypoints
  for (const mob of Object.values(MOBS)) {
    for (const entry of mob.lootTable ?? []) {
      if (!ITEMS[entry.itemId]) err(`mob ${mob.mobType}: loot references unknown itemId ${entry.itemId}`);
    }
  }
  for (const spawn of SPAWNS) {
    if (!MOBS[spawn.mobType]) err(`spawn ${spawn.netId}: unknown mobType ${spawn.mobType}`);
    if (!ZONES_BY_ID[spawn.zoneId]) err(`spawn ${spawn.netId}: unknown zoneId ${spawn.zoneId}`);
  }
  for (const wp of Object.values(WAYPOINTS)) {
    if (!ZONES_BY_ID[wp.zoneId]) err(`waypoint ${wp.id}: unknown zoneId ${wp.zoneId}`);
  }

  // Zones
  for (const zone of ZONES as ZoneDef[]) {
    if (zone.levelBand[0] > zone.levelBand[1]) {
      err(`zone ${zone.key}: levelBand min > max`);
    }
    for (const gate of zone.gates) {
      const target = ZONES_BY_ID[gate.toZoneId];
      // Gates may point at zones that ship in a later phase — only verify
      // the back-link when the target zone exists.
      if (target && !target.gates.some((g) => g.id === gate.toGateId)) {
        err(`zone ${zone.key}: gate ${gate.id} targets missing gate ${gate.toGateId} in zone ${gate.toZoneId}`);
      }
    }
  }

  // Dungeons
  for (const d of dungeons) {
    if (!MOBS[d.bossMobType]) err(`dungeon ${d.id}: unknown bossMobType ${d.bossMobType}`);
    for (const s of d.spawns) {
      if (!MOBS[s.mobType]) err(`dungeon ${d.id}: spawn ${s.netId} unknown mobType ${s.mobType}`);
    }
    if (!ZONES_BY_ID[d.entrance.zoneId]) err(`dungeon ${d.id}: unknown entrance zoneId ${d.entrance.zoneId}`);
  }

  // Id uniqueness (checked on the raw authoring lists — the keyed maps
  // would silently swallow duplicates)
  const itemIds = new Set<string>();
  for (const i of ALL_ITEMS as ItemDef[]) {
    if (itemIds.has(i.id)) err(`duplicate item id ${i.id}`);
    itemIds.add(i.id);
  }
  const abilityIds = new Set<string>();
  for (const a of ALL_ABILITIES as AbilityDef[]) {
    if (abilityIds.has(a.id)) err(`duplicate ability id ${a.id}`);
    abilityIds.add(a.id);
  }
  const dupCheck = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err(`duplicate ${label} ${id}`);
      seen.add(id);
    }
  };
  dupCheck('npc id', ALL_NPCS.map((n) => n.id));
  dupCheck('quest id', ALL_QUESTS.map((q) => q.id));
  dupCheck('mobType', ALL_MOBS.map((m) => m.mobType));
  dupCheck('waypoint id', ALL_WAYPOINTS.map((w) => w.id));
  dupCheck('spawn netId', SPAWNS.map((s) => s.netId));
  dupCheck('zone id', (ZONES as ZoneDef[]).map((z) => String(z.id)));

  return errors;
}
