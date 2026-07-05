/**
 * formulas/chestLoot.ts — deterministic chest rolls (shared client preview + server).
 */
import { mulberry32 } from './combat';

export interface ChestLootEntry {
  id: string;
  chance: number;
  min: number;
  max: number;
}

/** Matches src/features/world/game/items.js CHEST_LOOT. */
export const CHEST_LOOT: ChestLootEntry[] = [
  { id: 'coin',     chance: 0.90, min: 1, max: 5 },
  { id: 'berry',    chance: 0.55, min: 1, max: 3 },
  { id: 'mushroom', chance: 0.45, min: 1, max: 2 },
  { id: 'herb',     chance: 0.45, min: 1, max: 2 },
  { id: 'rawMeat',  chance: 0.35, min: 1, max: 2 },
  { id: 'fish',     chance: 0.30, min: 1, max: 2 },
  { id: 'wood',     chance: 0.40, min: 1, max: 3 },
];

export function rollChestLoot(seed: number): Array<{ itemId: string; qty: number }> {
  const rng = mulberry32((seed | 0) || 1);
  const rolled: Array<{ itemId: string; qty: number }> = [];
  for (const entry of CHEST_LOOT) {
    if (rng() >= entry.chance) continue;
    const span = entry.max - entry.min;
    const qty = entry.min + Math.floor(rng() * (span + 1));
    if (qty > 0) rolled.push({ itemId: entry.id, qty });
  }
  if (!rolled.length) rolled.push({ itemId: 'coin', qty: 1 });
  return rolled;
}
