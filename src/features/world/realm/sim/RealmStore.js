/**
 * RealmStore — the centralized client state for the Realm.
 *
 * PURE. No BABYLON, no React, no network. State is organised into named slices,
 * each with its own revision counter and its own listeners, so a consumer that
 * only cares about the player's health is not woken by a mob moving.
 *
 * Hand-rolled rather than pulling in a store library, for two reasons specific
 * to this codebase: the repo has no store dependency today (everything is
 * useState in App.jsx), and the consumers here are mostly a render loop rather
 * than React — a per-frame reader wants a cheap integer revision check, not a
 * subscription that allocates.
 *
 * The single most important behaviour is at the bottom of `update`: **an update
 * that changes nothing does not bump the revision and does not notify.** Bars,
 * nameplates and HUD frames are written from this store every frame; without
 * that check, "did anything change" is always true and the coalescing that keeps
 * the GUI from re-rasterising every frame cannot work.
 */

/**
 * @param {Record<string, object>} initialSlices
 */
export function createRealmStore(initialSlices = {}) {
  const state = new Map();
  const revs = new Map();
  const listeners = new Map();

  for (const [name, value] of Object.entries(initialSlices)) {
    state.set(name, value);
    revs.set(name, 0);
    listeners.set(name, new Set());
  }

  /** Typos in a slice name would otherwise silently read undefined forever. */
  function assertSlice(name) {
    if (!state.has(name)) {
      throw new Error(
        `[RealmStore] unknown slice "${name}". Known: ${[...state.keys()].join(', ') || '(none)'}`,
      );
    }
  }

  function notify(name) {
    // Iterate a copy: a listener may unsubscribe itself (or another) while we
    // are notifying, and mutating a Set mid-iteration silently skips entries.
    for (const fn of [...listeners.get(name)]) {
      try {
        fn(state.get(name), name);
      } catch (err) {
        // One bad subscriber must not stop the rest from being told, and must
        // not abort the update that triggered it.
        console.error(`[RealmStore] listener for "${name}" threw:`, err);
      }
    }
  }

  return {
    /** Current value of a slice. Treat as read-only; mutate via update(). */
    get(name) {
      assertSlice(name);
      return state.get(name);
    },

    /**
     * Monotonic per-slice change counter. A per-frame consumer can stash this
     * and skip all work when it is unchanged — no allocation, no subscription.
     */
    getRev(name) {
      assertSlice(name);
      return revs.get(name);
    },

    /**
     * Shallow-merge a patch (or the result of a producer fn) into a slice.
     * Returns true if anything actually changed.
     */
    update(name, patch) {
      assertSlice(name);
      const prev = state.get(name);
      const next = typeof patch === 'function' ? patch(prev) : patch;
      if (next == null) return false;

      let changed = false;
      for (const key of Object.keys(next)) {
        if (!Object.is(prev[key], next[key])) { changed = true; break; }
      }
      // A no-op write is the common case for a per-frame writer. Bailing here is
      // what makes "did this change?" a meaningful question downstream.
      if (!changed) return false;

      state.set(name, { ...prev, ...next });
      revs.set(name, revs.get(name) + 1);
      notify(name);
      return true;
    },

    /** Replace a slice wholesale. Use when the shape changes, not per frame. */
    replace(name, value) {
      assertSlice(name);
      if (Object.is(state.get(name), value)) return false;
      state.set(name, value);
      revs.set(name, revs.get(name) + 1);
      notify(name);
      return true;
    },

    /** @returns {() => void} unsubscribe */
    subscribe(name, fn) {
      assertSlice(name);
      const set = listeners.get(name);
      set.add(fn);
      return () => set.delete(fn);
    },

    /** Every slice at once. For debugging and test assertions, not hot paths. */
    snapshot() {
      return Object.fromEntries([...state.entries()].map(([k, v]) => [k, v]));
    },

    sliceNames() {
      return [...state.keys()];
    },
  };
}
