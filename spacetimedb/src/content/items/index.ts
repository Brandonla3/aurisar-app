// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/items/index.ts
// Regenerate with: npm run sync:content

/**
 * items/index.ts — full item catalog keyed by id.
 */
import type { ItemDef } from '../types';
import { CONSUMABLES } from './consumables';
import { WEAPONS } from './weapons';
import { ARMOR } from './armor';
import { QUEST_ITEMS } from './questItems';

/** Raw list — may contain authoring mistakes (duplicate ids); the
 *  validator checks it. Gameplay code uses the keyed ITEMS map. */
export const ALL_ITEMS: ItemDef[] = [...CONSUMABLES, ...WEAPONS, ...ARMOR, ...QUEST_ITEMS];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  ALL_ITEMS.map((i) => [i.id, i]),
);

export function getItemDef(id: string): ItemDef | null {
  return ITEMS[id] ?? null;
}
