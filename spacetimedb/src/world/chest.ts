/**
 * world/chest.ts — server chest open + cooking near campfire helpers.
 */
import chestManifest from '../manifests/world_chests.json';
import { rollChestLoot } from '../content/formulas/chestLoot.js';
import { RECIPES_BY_ID, canCookRecipe } from '../content/formulas/cooking.js';
import { ITEMS } from '../content/items/index.js';
import {
  addCopper,
  addItemStack,
  removeItemStack,
  type InventoryCtx,
} from '../inventory/helpers.js';

const PX_PER_M = 32;
const STDB_CENTER_PX = 1600;
const CHEST_OPEN_RANGE_M = 2.5;
const CHEST_OPEN_RANGE_PX = CHEST_OPEN_RANGE_M * PX_PER_M;
const CHEST_OPEN_RANGE_SQ = CHEST_OPEN_RANGE_PX * CHEST_OPEN_RANGE_PX;
const CAMPFIRE_COOK_RANGE_PX = 4.5 * PX_PER_M;
const CAMPFIRE_COOK_RANGE_SQ = CAMPFIRE_COOK_RANGE_PX * CAMPFIRE_COOK_RANGE_PX;

export interface WorldChestDef {
  id: number;
  x: number;
  z: number;
  seed: number;
}

const WORLD_CHESTS: WorldChestDef[] = chestManifest.chests;

export function getWorldChest(chestId: number): WorldChestDef | null {
  const chest = WORLD_CHESTS[chestId];
  if (!chest || chest.id !== chestId) return null;
  return chest;
}

/** Zone-1 chest world meters → STDB px (origin offset is zero). */
export function chestPosToPx(chest: WorldChestDef): { x: number; y: number } {
  return {
    x: chest.x * PX_PER_M + STDB_CENTER_PX,
    y: chest.z * PX_PER_M + STDB_CENTER_PX,
  };
}

export function playerNearChest(
  player: { x: number; y: number },
  chest: WorldChestDef,
): boolean {
  const pos = chestPosToPx(chest);
  const dx = player.x - pos.x;
  const dy = player.y - pos.y;
  return dx * dx + dy * dy <= CHEST_OPEN_RANGE_SQ;
}

export function chestAlreadyOpened(
  ctx: InventoryCtx,
  owner: unknown,
  chestId: number,
): boolean {
  for (const row of ctx.db.playerChestOpened.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    if (row.chestId === chestId) return true;
  }
  return false;
}

export function grantChestLoot(
  ctx: InventoryCtx,
  owner: unknown,
  seed: number,
): Array<{ itemId: string; qty: number }> {
  const rolled = rollChestLoot(seed);
  for (const drop of rolled) {
    if (drop.itemId === 'coin') {
      addCopper(ctx, owner, drop.qty);
      continue;
    }
    if (!ITEMS[drop.itemId]) continue;
    addItemStack(ctx, owner, drop.itemId, drop.qty);
  }
  return rolled;
}

/**
 * Open a world chest when the player is in range. Returns rolled loot on
 * success, null when validation fails or the chest was already opened.
 */
export function openChestForPlayer(
  ctx: InventoryCtx,
  owner: unknown,
  player: { x: number; y: number },
  chestId: number,
): Array<{ itemId: string; qty: number }> | null {
  const chest = getWorldChest(chestId);
  if (!chest) return null;
  if (!playerNearChest(player, chest)) return null;
  if (chestAlreadyOpened(ctx, owner, chestId)) return null;

  const rolled = grantChestLoot(ctx, owner, chest.seed);
  ctx.db.playerChestOpened.insert({
    id: 0n,
    owner,
    chestId,
  });
  return rolled;
}

export function playerNearLitCampfire(
  ctx: InventoryCtx,
  player: { x: number; y: number },
): boolean {
  for (const fire of ctx.db.campfire.iter()) {
    const dx = player.x - fire.x;
    const dy = player.y - fire.y;
    if (dx * dx + dy * dy <= CAMPFIRE_COOK_RANGE_SQ) return true;
  }
  return false;
}

export function cookRecipeForPlayer(
  ctx: InventoryCtx,
  owner: unknown,
  recipeId: string,
): boolean {
  const recipe = RECIPES_BY_ID[recipeId];
  if (!recipe) return false;

  const counts: Record<string, number> = {};
  for (const row of ctx.db.playerItemStack.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    counts[row.itemId] = (counts[row.itemId] ?? 0) + row.quantity;
  }
  if (!canCookRecipe(recipe, counts)) return false;

  for (const inp of recipe.inputs) {
    if (!removeItemStack(ctx, owner, inp.id, inp.qty)) return false;
  }
  const granted = addItemStack(ctx, owner, recipe.output.id, recipe.output.qty);
  return granted >= recipe.output.qty;
}

export { RECIPES_BY_ID, canCookRecipe };
