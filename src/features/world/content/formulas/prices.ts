/**
 * formulas/prices.ts — currency helpers shared by client and server.
 *
 * All money is stored as copper (u64 server-side). Display denominations:
 *   100 copper = 1 silver
 *   100 silver = 1 gold   (10,000 copper)
 *   100 gold   = 1 platinum (1,000,000 copper)
 */

import type { ItemDef } from '../types';

export const COPPER_PER_SILVER = 100;
export const COPPER_PER_GOLD = 100 * 100;
export const COPPER_PER_PLATINUM = 100 * 100 * 100;

/** Vendors buy back at 25% of the listed price. */
export const SELL_RATIO = 0.25;

export interface CoinBreakdown {
  platinum: number;
  gold: number;
  silver: number;
  copper: number;
}

export function toCoins(totalCopper: number): CoinBreakdown {
  const c = Math.max(0, Math.floor(totalCopper));
  const platinum = Math.floor(c / COPPER_PER_PLATINUM);
  const afterPlat = c % COPPER_PER_PLATINUM;
  return {
    platinum,
    gold: Math.floor(afterPlat / COPPER_PER_GOLD),
    silver: Math.floor((afterPlat % COPPER_PER_GOLD) / COPPER_PER_SILVER),
    copper: afterPlat % COPPER_PER_SILVER,
  };
}

/** '1p 2g 3s 4c' (omits zero leading denominations; '0c' for zero). */
export function formatCopper(totalCopper: number | bigint): string {
  const n = typeof totalCopper === 'bigint' ? Number(totalCopper) : totalCopper;
  const { platinum, gold, silver, copper } = toCoins(n);
  const parts: string[] = [];
  if (platinum > 0) parts.push(`${platinum}p`);
  if (gold > 0 || platinum > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0 || platinum > 0) parts.push(`${silver}s`);
  parts.push(`${copper}c`);
  return parts.join(' ');
}

/** What a vendor pays for one unit; 0 for unsellable items. */
export function sellPriceCopper(item: Pick<ItemDef, 'vendorPriceCopper'>): number {
  if (!item.vendorPriceCopper || item.vendorPriceCopper <= 0) return 0;
  return Math.max(1, Math.floor(item.vendorPriceCopper * SELL_RATIO));
}
