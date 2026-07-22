import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The staging cart — one shared basket of exercises across the whole app.
 *
 * Selection used to be three unrelated Sets (the library's `libSelected`, the
 * favourites list's `favSelected`, and the workout builder's own picker), each
 * discarded the moment you navigated away. Building a workout therefore had to
 * happen inside a single uninterrupted visit to one list, and the handoff into
 * the builder worked by reaching across and seeding another tab's state.
 *
 * This replaces all of that with an ordered, persisted list that any surface
 * can add to and a single tray that ships it. Order is meaningful — it becomes
 * the exercise order of the workout — so it is an array, not a Set, and adding
 * an exercise already present is a no-op rather than a re-order.
 *
 * Persisted to localStorage, matching the `aurisar-live-workout` convention,
 * so a half-built selection survives a reload or a phone locking mid-gym.
 */

const STORAGE_KEY = 'aurisar-exercise-cart';

function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function useExerciseCart() {
  const [cartIds, setCartIds] = useState(readStored);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    try {
      if (cartIds.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(cartIds));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode — the cart just won't survive a reload */ }
  }, [cartIds]);

  // Membership lookups happen once per rendered row, so keep them O(1).
  const cartSet = useMemo(() => new Set(cartIds), [cartIds]);
  const isInCart = useCallback(id => cartSet.has(id), [cartSet]);

  const addToCart = useCallback(id => {
    setCartIds(ids => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  const removeFromCart = useCallback(id => {
    setCartIds(ids => ids.filter(x => x !== id));
  }, []);

  const toggleCart = useCallback(id => {
    setCartIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  }, []);

  const clearCart = useCallback(() => {
    setCartIds([]);
    setCartOpen(false);
  }, []);

  // Drop IDs the catalog can no longer resolve — a custom exercise deleted
  // while it sat in the cart, or an entry restored from localStorage that no
  // longer exists. Without this they accumulate silently and get forged into
  // workouts as phantom rows.
  //
  // Timing hazard: the catalog is the bundled list merged with Supabase after
  // mount, and custom exercises arrive with the profile. Pruning before both
  // have landed would delete perfectly valid IDs, so callers must only run
  // this once the catalog is ready.
  const pruneMissing = useCallback(isKnown => {
    setCartIds(ids => {
      const kept = ids.filter(isKnown);
      return kept.length === ids.length ? ids : kept;
    });
  }, []);

  // Reorder by one step; the tray exposes this as up/down rather than drag so
  // it works with a thumb, a mouse and a keyboard without a drag library.
  const moveInCart = useCallback((id, dir) => {
    setCartIds(ids => {
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      const next = [...ids];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  return {
    cartIds, setCartIds,
    cartSet, isInCart,
    addToCart, removeFromCart, toggleCart, clearCart, moveInCart, pruneMissing,
    cartOpen, setCartOpen,
  };
}

/**
 * Shape a cart entry the way the workout builder and plan wizard expect.
 * Callers must pass an ID the catalog can resolve — the builder renders
 * nothing for an unknown exId but still counts it toward wbExercises.length,
 * so an unresolvable entry produces a workout that looks empty yet saves.
 */
export function cartEntry(id, allExById) {
  const e = allExById[id];
  return {
    exId: id,
    sets: (e && e.defaultSets) || 3,
    reps: (e && e.defaultReps) || 10,
    weightLbs: (e && e.defaultWeightLbs) || null,
    durationMin: (e && e.defaultDurationMin) || null,
    weightPct: 100,
    distanceMi: null,
    hrZone: null,
  };
}
