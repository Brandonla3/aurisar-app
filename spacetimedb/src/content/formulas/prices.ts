// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/formulas/prices.ts
// Regenerate with: npm run sync:content

/**
 * formulas/prices.ts — currency helpers shared by client and server.
 *
 * All money is stored as copper (u64 server-side). 100 copper = 1 silver,
 * 100 silver = 1 gold — display-only denominations.
 */

import type { ItemDef } from '../types';

export const COPPER_PER_SILVER = 100;
export const COPPER_PER_GOLD = 100 * 100;

/** Vendors buy back at 25% of the listed price. */
export const SELL_RATIO = 0.25;

export interface CoinBreakdown {
  gold: number;
  silver: number;
  copper: number;
}

export function toCoins(totalCopper: number): CoinBreakdown {
  const c = Math.max(0, Math.floor(totalCopper));
  return {
    gold: Math.floor(c / COPPER_PER_GOLD),
    silver: Math.floor((c % COPPER_PER_GOLD) / COPPER_PER_SILVER),
    copper: c % COPPER_PER_SILVER,
  };
}

/** '1g 23s 45c' (omits zero leading denominations; '0c' for zero). */
export function formatCopper(totalCopper: number): string {
  const { gold, silver, copper } = toCoins(totalCopper);
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  parts.push(`${copper}c`);
  return parts.join(' ');
}

/** What a vendor pays for one unit; 0 for unsellable items. */
export function sellPriceCopper(item: Pick<ItemDef, 'vendorPriceCopper'>): number {
  if (!item.vendorPriceCopper || item.vendorPriceCopper <= 0) return 0;
  return Math.max(1, Math.floor(item.vendorPriceCopper * SELL_RATIO));
}
