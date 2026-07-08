import { describe, expect, it } from 'vitest';
import { RECIPES, RECIPES_BY_ID, canCookRecipe } from '../formulas/cooking';

describe('cooking recipes', () => {
  it('every recipe id resolves in RECIPES_BY_ID', () => {
    for (const recipe of RECIPES) {
      expect(RECIPES_BY_ID[recipe.id]).toBe(recipe);
    }
  });

  it('canCookRecipe requires all inputs and output stack headroom', () => {
    const stew = RECIPES_BY_ID.stew;
    expect(stew).toBeTruthy();
    expect(canCookRecipe(stew!, { rawMeat: 1, herb: 1, mushroom: 1 })).toBe(true);
    expect(canCookRecipe(stew!, { rawMeat: 1, herb: 1 })).toBe(false);
  });

  it('canCookRecipe blocks when output stack is full', () => {
    const jam = RECIPES_BY_ID.berryJam;
    expect(jam).toBeTruthy();
    const cap = 20;
    expect(canCookRecipe(jam!, { berry: 3, berryJam: cap })).toBe(false);
  });
});
