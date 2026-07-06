/**
 * vendors/helpers.ts — buy/sell validation shared by vendor reducers.
 */
import { NPCS } from '../content/index.js';
import { getItemDef } from '../content/items/index.js';
import { sellPriceCopper } from '../content/formulas/prices.js';
import { ZONES_BY_ID } from '../content/index.js';

const PX_PER_M = 32;
const INTERACT_RANGE_PX = 6 * PX_PER_M;

/** Zone-local meters → STDB px (matches dungeon/helpers contentPosToPx). */
function contentPosToPx(zoneId: number, pos: { x: number; z: number }): { x: number; y: number } {
  const zone = ZONES_BY_ID[zoneId];
  const ox = zone?.originOffsetM.x ?? 0;
  const oz = zone?.originOffsetM.z ?? 0;
  return {
    x: (ox + pos.x) * PX_PER_M + 1600,
    y: (oz + pos.z) * PX_PER_M + 1600,
  };
}

export function isVendorNpc(npcId: string): boolean {
  const npc = NPCS[npcId];
  return !!npc?.vendorItemIds?.length;
}

export function vendorSellsItem(npcId: string, itemId: string): boolean {
  const npc = NPCS[npcId];
  if (!npc?.vendorItemIds) return false;
  return npc.vendorItemIds.includes(itemId);
}

export function playerNearNpc(
  player: { x: number; y: number },
  npcId: string,
): boolean {
  const npc = NPCS[npcId];
  if (!npc) return false;
  const px = contentPosToPx(npc.zoneId, npc.pos);
  const dx = player.x - px.x;
  const dy = player.y - px.y;
  return dx * dx + dy * dy <= INTERACT_RANGE_PX * INTERACT_RANGE_PX;
}

export function buyPriceCopper(itemId: string): number {
  return getItemDef(itemId)?.vendorPriceCopper ?? 0;
}

export function itemSellPrice(itemId: string): number {
  const def = getItemDef(itemId);
  if (!def) return 0;
  return sellPriceCopper(def);
}

export function clampTradeQty(qty: number, maxStack: number): number {
  const q = Math.floor(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  return Math.min(q, maxStack, 999);
}
