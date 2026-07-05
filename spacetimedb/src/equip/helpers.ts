/**
 * equip/helpers.ts — server equip/unequip validation and slot moves.
 */
import { getItemDef } from '../content/items/index.js';
import type { ItemDef } from '../content/types.js';
import {
  addItemStack,
  countItemOwned,
  removeItemStack,
  type InventoryCtx,
} from '../inventory/helpers.js';

const VALID_SLOTS = new Set([
  'head', 'chest', 'legs', 'feet', 'hands', 'mainHand', 'offHand', 'trinket',
]);

export function isEquippable(def: ItemDef | null | undefined): boolean {
  if (!def) return false;
  if (def.type !== 'weapon' && def.type !== 'armor') return false;
  return !!def.slot && VALID_SLOTS.has(def.slot);
}

export function findEquippedSlot(
  ctx: InventoryCtx,
  owner: unknown,
  slot: string,
): { id: bigint; owner: unknown; slot: string; itemId: string } | null {
  for (const row of ctx.db.playerEquipped.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    if (row.slot !== slot) continue;
    return row;
  }
  return null;
}

export function unequipSlotForPlayer(
  ctx: InventoryCtx,
  owner: unknown,
  slot: string,
): boolean {
  if (!VALID_SLOTS.has(slot)) return false;
  const row = findEquippedSlot(ctx, owner, slot);
  if (!row) return false;
  if (!addItemStack(ctx, owner, row.itemId, 1)) return false;
  ctx.db.playerEquipped.id.delete(row.id);
  return true;
}

export function equipItemForPlayer(
  ctx: InventoryCtx,
  owner: unknown,
  itemId: string,
  playerLevel: number,
): boolean {
  const def = getItemDef(itemId);
  if (!isEquippable(def)) return false;
  if (def!.minLevel && playerLevel < def!.minLevel) return false;
  if (countItemOwned(ctx, owner, itemId) < 1) return false;

  const slot = def!.slot!;
  const existing = findEquippedSlot(ctx, owner, slot);
  if (existing?.itemId === itemId) return true;

  if (existing && !unequipSlotForPlayer(ctx, owner, slot)) return false;
  if (!removeItemStack(ctx, owner, itemId, 1)) return false;

  ctx.db.playerEquipped.insert({
    id: 0n,
    owner,
    slot,
    itemId,
  });
  return true;
}
