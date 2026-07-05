// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/formulas/cooking.ts
// Regenerate with: npm run sync:content

/**
 * formulas/cooking.ts — recipe definitions shared by client UI and server reducers.
 */
import { ITEMS } from '../items/index';

export interface RecipeInput {
  id: string;
  qty: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  output: { id: string; qty: number };
  inputs: RecipeInput[];
}

/** Matches src/features/world/game/recipes.js. */
export const RECIPES: RecipeDef[] = [
  {
    id: 'stew',
    name: 'Hearty Stew',
    output: { id: 'stew', qty: 1 },
    inputs: [{ id: 'rawMeat', qty: 1 }, { id: 'herb', qty: 1 }, { id: 'mushroom', qty: 1 }],
  },
  {
    id: 'berryJam',
    name: 'Berry Jam',
    output: { id: 'berryJam', qty: 1 },
    inputs: [{ id: 'berry', qty: 3 }],
  },
  {
    id: 'grilledFish',
    name: 'Grilled Fish',
    output: { id: 'grilledFish', qty: 1 },
    inputs: [{ id: 'fish', qty: 1 }, { id: 'herb', qty: 1 }],
  },
  {
    id: 'herbTonic',
    name: 'Herb Tonic',
    output: { id: 'herbTonic', qty: 1 },
    inputs: [{ id: 'herb', qty: 2 }, { id: 'mushroom', qty: 1 }],
  },
];

export const RECIPES_BY_ID: Record<string, RecipeDef> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
);

export function canCookRecipe(
  recipe: RecipeDef,
  counts: Record<string, number>,
): boolean {
  const hasInputs = recipe.inputs.every((inp) => (counts[inp.id] ?? 0) >= inp.qty);
  if (!hasInputs) return false;
  const out = recipe.output;
  const cap = ITEMS[out.id]?.stack ?? 99;
  return (counts[out.id] ?? 0) < cap;
}
