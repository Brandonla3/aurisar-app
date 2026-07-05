/**
 * world/chest.ts — server chest open + cooking near campfire helpers.
 */
import { rollChestLoot } from '../content/formulas/chestLoot.js';
import { RECIPES_BY_ID, canCookRecipe } from '../content/formulas/cooking.js';
import { ITEMS } from '../content/items/index.js';
import {
  addCopper,
  addItemStack,
  countItemOwned,
  removeItemStack,
  type InventoryCtx,
} from '../inventory/helpers.js';

const PX_PER_M = 32;
const CAMPFIRE_COOK_RANGE_PX = 4.5 * PX_PER_M;
const CAMPFIRE_COOK_RANGE_SQ = CAMPFIRE_COOK_RANGE_PX * CAMPFIRE_COOK_RANGE_PX;

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
