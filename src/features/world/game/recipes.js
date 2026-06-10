/**
 * recipes.js — cooking recipes for the world's Cooking panel.
 *
 * Pure data + a pure predicate. A recipe turns `inputs` (ingredient items) into
 * one `output` food item. Consumed by useInventory.cook() and CookingPanel.
 */

export const RECIPES = [
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

/**
 * Can this recipe be cooked given the current counts map ({ itemId: count })?
 * @param {object} recipe
 * @param {Record<string, number>} counts
 * @returns {boolean}
 */
export function canCook(recipe, counts) {
  return recipe.inputs.every((inp) => (counts[inp.id] ?? 0) >= inp.qty);
}
