/**
 * items/index.ts — full item catalog keyed by id.
 */
import type { ItemDef } from '../types';
import { CONSUMABLES } from './consumables';
import { WEAPONS } from './weapons';
import { ARMOR } from './armor';
import { QUEST_ITEMS } from './questItems';
import { ZONE1_ITEMS } from './zone1';

/** Raw list — may contain authoring mistakes (duplicate ids); the
 *  validator checks it. Gameplay code uses the keyed ITEMS map. */
export const ALL_ITEMS: ItemDef[] = [
  ...CONSUMABLES, ...WEAPONS, ...ARMOR, ...QUEST_ITEMS, ...ZONE1_ITEMS,
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  ALL_ITEMS.map((i) => [i.id, i]),
);

export function getItemDef(id: string): ItemDef | null {
  return ITEMS[id] ?? null;
}
