/**
 * inventory/helpers.ts — server-authoritative stacks, copper, and loot rolls.
 */
import { ITEMS, getItemDef } from '../content/items/index.js';
import type { ItemDef, LootEntry, MobDef, QuestReward } from '../content/types.js';
import { seedFrom } from '../content/formulas/combat.js';
import { rollMobLoot } from '../content/formulas/inventory.js';

export type InventoryCtx = {
  db: any;
};

export function findItemStack(
  ctx: InventoryCtx,
  owner: unknown,
  itemId: string,
): { id: bigint; owner: unknown; itemId: string; quantity: number } | null {
  for (const row of ctx.db.playerItemStack.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    if (row.itemId !== itemId) continue;
    return row;
  }
  return null;
}

export function stackLimit(itemId: string): number {
  return getItemDef(itemId)?.stack ?? 99;
}

export function canStackItem(itemId: string): boolean {
  const def = getItemDef(itemId);
  if (!def) return false;
  return def.type !== 'weapon' && def.type !== 'armor';
}

/** Grant qty of itemId; splits across stacks when stack cap exceeded. */
export function addItemStack(
  ctx: InventoryCtx,
  owner: unknown,
  itemId: string,
  qty: number,
): number {
  if (qty <= 0) return 0;
  const def = getItemDef(itemId);
  if (!def) return 0;

  let remaining = qty;
  const limit = def.stack;

  if (canStackItem(itemId)) {
    const existing = findItemStack(ctx, owner, itemId);
    if (existing) {
      const space = limit - existing.quantity;
      const add = Math.min(space, remaining);
      if (add > 0) {
        ctx.db.playerItemStack.id.update({
          ...existing,
          quantity: existing.quantity + add,
        });
        remaining -= add;
      }
    }
    while (remaining > 0) {
      const chunk = Math.min(limit, remaining);
      ctx.db.playerItemStack.insert({
        id: 0n,
        owner,
        itemId,
        quantity: chunk,
      });
      remaining -= chunk;
    }
    return qty - remaining;
  }

  // Equipment / non-stackable: one row per unit.
  for (let i = 0; i < remaining; i++) {
    ctx.db.playerItemStack.insert({
      id: 0n,
      owner,
      itemId,
      quantity: 1,
    });
  }
  return qty;
}

/** Remove qty; returns false if insufficient. */
export function removeItemStack(
  ctx: InventoryCtx,
  owner: unknown,
  itemId: string,
  qty: number,
): boolean {
  if (qty <= 0) return true;

  const def = getItemDef(itemId);
  if (!def) return false;

  if (canStackItem(itemId)) {
    const rows: Array<{ id: bigint; owner: unknown; itemId: string; quantity: number }> = [];
    for (const row of ctx.db.playerItemStack.iter()) {
      if (!row.owner.isEqual(owner)) continue;
      if (row.itemId !== itemId) continue;
      rows.push(row);
    }
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (total < qty) return false;

    let need = qty;
    for (const row of rows) {
      if (need <= 0) break;
      const take = Math.min(need, row.quantity);
      const next = row.quantity - take;
      if (next > 0) {
        ctx.db.playerItemStack.id.update({ ...row, quantity: next });
      } else {
        ctx.db.playerItemStack.id.delete(row.id);
      }
      need -= take;
    }
    return true;
  }

  let need = qty;
  const rows: Array<{ id: bigint; owner: unknown; itemId: string; quantity: number }> = [];
  for (const row of ctx.db.playerItemStack.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    if (row.itemId !== itemId) continue;
    rows.push(row);
  }
  if (rows.length < need) return false;
  for (let i = 0; i < need; i++) {
    ctx.db.playerItemStack.id.delete(rows[i].id);
  }
  return true;
}

export function getOrCreateWallet(
  ctx: InventoryCtx,
  identity: any,
): { identity: any; copper: bigint; imported: boolean } {
  const existing = ctx.db.playerWallet.identity.find(identity);
  if (existing) return existing;
  const row = { identity, copper: 0n, imported: false };
  ctx.db.playerWallet.insert(row);
  return row;
}

export function addCopper(ctx: InventoryCtx, identity: unknown, amount: number): void {
  if (amount <= 0) return;
  const wallet = getOrCreateWallet(ctx, identity);
  ctx.db.playerWallet.identity.update({
    ...wallet,
    copper: wallet.copper + BigInt(amount),
  });
}

/** Returns false when the wallet cannot cover amount. */
export function deductCopper(
  ctx: InventoryCtx,
  identity: unknown,
  amount: number,
): boolean {
  if (amount <= 0) return true;
  const wallet = getOrCreateWallet(ctx, identity);
  const cost = BigInt(amount);
  if (wallet.copper < cost) return false;
  ctx.db.playerWallet.identity.update({
    ...wallet,
    copper: wallet.copper - cost,
  });
  return true;
}

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

export { rollMobLoot } from '../content/formulas/inventory.js';

export function grantMobLoot(
  ctx: InventoryCtx,
  owner: unknown,
  mobDef: MobDef,
  seed: number,
): void {
  const { items, copper } = rollMobLoot(mobDef, seed);
  for (const drop of items) addItemStack(ctx, owner, drop.itemId, drop.qty);
  addCopper(ctx, owner, copper);
}

export function grantQuestReward(
  ctx: InventoryCtx,
  identity: unknown,
  classType: string,
  reward: QuestReward,
): void {
  addCopper(ctx, identity, reward.copper ?? 0);
  for (const itemId of reward.itemIds ?? []) {
    addItemStack(ctx, identity, itemId, 1);
  }
  const classReward = reward.itemIdsByClass?.[classType as keyof typeof reward.itemIdsByClass];
  if (classReward) addItemStack(ctx, identity, classReward, 1);
}

export function isConsumable(def: ItemDef | null): boolean {
  return def?.type === 'consumable' && (def.heal ?? 0) > 0;
}

export function applyHeal(
  ctx: InventoryCtx,
  identity: unknown,
  heal: number,
): void {
  const player = ctx.db.player.identity.find(identity);
  if (!player || heal <= 0) return;
  const nextHp = Math.min(player.maxHp, player.hp + heal);
  if (nextHp === player.hp) return;
  ctx.db.player.identity.update({ ...player, hp: nextHp });
}

/** Starting kit for brand-new players with no migrated save. */
export const STARTING_KIT: Record<string, number> = {
  berry: 3,
  rawMeat: 1,
  herb: 2,
  wood: 6,
};

export function grantStartingKit(ctx: InventoryCtx, identity: unknown): void {
  for (const [itemId, qty] of Object.entries(STARTING_KIT)) {
    addItemStack(ctx, identity, itemId, qty);
  }
}

export function lootSeedFromKill(
  owner: unknown,
  mobId: bigint,
  nowMicros: bigint,
  spawnNetId: string,
): number {
  return seedFrom(String(owner), mobId, nowMicros, spawnNetId);
}

/** Total quantity of itemId held by owner across all stacks. */
export function countItemOwned(
  ctx: InventoryCtx,
  owner: unknown,
  itemId: string,
): number {
  let total = 0;
  for (const row of ctx.db.playerItemStack.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    if (row.itemId !== itemId) continue;
    total += row.quantity;
  }
  return total;
}
