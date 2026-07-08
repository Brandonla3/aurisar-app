// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/formulas/inventory.ts
// Regenerate with: npm run sync:content

/**
 * formulas/inventory.ts — deterministic loot rolls shared by client
 * previews and the SpacetimeDB module (authoritative grants).
 */
import type { LootEntry, MobDef } from '../types';
import { mulberry32 } from './combat';

export function rollLootTable(
  rng: () => number,
  table: LootEntry[] | undefined,
): Array<{ itemId: string; qty: number }> {
  const rolled: Array<{ itemId: string; qty: number }> = [];
  if (!table) return rolled;
  for (const entry of table) {
    if (rng() >= entry.chance) continue;
    const span = entry.max - entry.min;
    const qty = entry.min + Math.floor(rng() * (span + 1));
    if (qty > 0) rolled.push({ itemId: entry.itemId, qty });
  }
  return rolled;
}

export function rollMobLoot(
  mobDef: MobDef,
  seed: number,
): { items: Array<{ itemId: string; qty: number }>; copper: number } {
  const rng = mulberry32(seed);
  const items = rollLootTable(rng, mobDef.lootTable);
  let copper = 0;
  if (mobDef.copperMin != null && mobDef.copperMax != null) {
    const min = mobDef.copperMin;
    const max = mobDef.copperMax;
    copper = max <= min ? min : min + Math.floor(rng() * (max - min + 1));
  }
  return { items, copper };
}
