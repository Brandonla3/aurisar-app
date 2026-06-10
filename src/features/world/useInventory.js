/**
 * useInventory — client-side inventory + cooking state for the 3D world.
 *
 * Fully local: persisted to localStorage under a dedicated key (NOT the profile
 * blob in utils/storage.js, which is userId/Supabase-bound). No server calls —
 * there is no item/loot/heal reducer in the SpacetimeDB module.
 *
 * State shape (persisted): { items: { [itemId]: count }, opened: number[] }
 *   - items  : current stacks
 *   - opened : chest indices already looted (prevents re-farming across reloads)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ITEMS, CHEST_LOOT } from './game/items.js';
import { RECIPES, canCook } from './game/recipes.js';
import { mulberry32 } from './worldgen/rng.js';

const STORAGE_KEY = 'aurisar.world.inventory.v1';

// One-time starting kit, granted when no save exists yet.
const STARTING_KIT = { berry: 3, rawMeat: 1, herb: 2 };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        items: parsed.items ?? {},
        opened: Array.isArray(parsed.opened) ? parsed.opened : [],
      };
    }
  } catch { /* corrupt save — fall through to fresh */ }
  return { items: { ...STARTING_KIT }, opened: [] };
}

/** Deterministic chest loot from the chest seed (stable per chest / reload). */
export function rollChestLoot(seed) {
  const rng = mulberry32((seed | 0) || 1);
  const rolled = [];
  for (const entry of CHEST_LOOT) {
    if (rng() < entry.chance) {
      const span = entry.max - entry.min;
      const qty = entry.min + Math.floor(rng() * (span + 1));
      if (qty > 0) rolled.push({ id: entry.id, qty });
    }
  }
  // Guarantee at least one drop so an opened chest never feels empty.
  if (!rolled.length) rolled.push({ id: 'coin', qty: 1 });
  return rolled;
}

export function useInventory() {
  const [state, setState] = useState(loadState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Persist (debounced) on every change.
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
    }, 250);
    return () => clearTimeout(saveTimer.current);
  }, [state]);

  const clampStack = (id, n) => {
    const max = ITEMS[id]?.stack ?? 99;
    return Math.max(0, Math.min(max, n));
  };

  const addItem = useCallback((id, qty = 1) => {
    if (!ITEMS[id]) return;
    setState((s) => {
      const next = clampStack(id, (s.items[id] ?? 0) + qty);
      return { ...s, items: { ...s.items, [id]: next } };
    });
  }, []);

  const removeItem = useCallback((id, qty = 1) => {
    setState((s) => {
      const next = (s.items[id] ?? 0) - qty;
      const items = { ...s.items };
      if (next > 0) items[id] = next; else delete items[id];
      return { ...s, items };
    });
  }, []);

  // Loot a chest exactly once. Returns the rolled items (for a toast) or null
  // if this chest was already opened (dedup is authoritative here, surviving
  // reloads even though the scene's in-memory set resets).
  const openChest = useCallback(({ id, seed }) => {
    if (stateRef.current.opened.includes(id)) return null;
    const rolled = rollChestLoot(seed);
    setState((s) => {
      if (s.opened.includes(id)) return s;
      const items = { ...s.items };
      for (const r of rolled) items[r.id] = clampStack(r.id, (items[r.id] ?? 0) + r.qty);
      return { items, opened: [...s.opened, id] };
    });
    return rolled;
  }, []);

  // Cook a recipe: validate, consume inputs, add output. Returns true on success.
  const cook = useCallback((recipeId) => {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;
    let ok = false;
    setState((s) => {
      if (!canCook(recipe, s.items)) return s;
      ok = true;
      const items = { ...s.items };
      for (const inp of recipe.inputs) {
        const next = (items[inp.id] ?? 0) - inp.qty;
        if (next > 0) items[inp.id] = next; else delete items[inp.id];
      }
      const out = recipe.output;
      items[out.id] = clampStack(out.id, (items[out.id] ?? 0) + out.qty);
      return { ...s, items };
    });
    return ok;
  }, []);

  // Eat a food item: consumes it and returns its (cosmetic) heal value.
  // NOTE: real HP is server-authoritative and there is no heal reducer, so this
  // does NOT change HP — applying it would desync against the next server push.
  // TODO(server): a `consume_item`/`heal` reducer + regenerated bindings.
  const eat = useCallback((itemId) => {
    const item = ITEMS[itemId];
    if (!item || item.type !== 'food') return 0;
    if ((stateRef.current.items[itemId] ?? 0) <= 0) return 0;
    removeItem(itemId, 1);
    return item.heal ?? 0;
  }, [removeItem]);

  return {
    items: state.items,
    counts: state.items,
    addItem,
    removeItem,
    openChest,
    cook,
    eat,
  };
}
