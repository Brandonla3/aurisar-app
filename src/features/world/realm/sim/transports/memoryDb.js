/**
 * memoryDb — plain-rows storage for the in-process authoritative world.
 *
 * PURE. A Map of tables, each a Map of id → row. This is the shape the
 * SpacetimeDB module also sees (tables of rows keyed by id), which is the
 * point: rules code written against "get row, decide, write row" ports to the
 * reducer without translation.
 *
 * Rows are stored as plain objects and returned by reference. Authoritative
 * code inside the transport may mutate what it owns; everything that leaves the
 * transport goes through the event stream as copies. Ids are normalised to
 * strings at the boundary so BigInt/number/string callers all address the same
 * row (the wire already made this choice — see packId).
 */

const keyOf = (id) => String(id);

export function createMemoryDb(tableNames = []) {
  const tables = new Map(tableNames.map((n) => [n, new Map()]));

  function table(name) {
    const t = tables.get(name);
    if (!t) {
      throw new Error(`[memoryDb] unknown table "${name}". Known: ${[...tables.keys()].join(', ')}`);
    }
    return t;
  }

  return {
    get: (name, id) => table(name).get(keyOf(id)) ?? null,
    has: (name, id) => table(name).has(keyOf(id)),

    upsert(name, id, row) {
      table(name).set(keyOf(id), { ...table(name).get(keyOf(id)), ...row, id: keyOf(id) });
      return table(name).get(keyOf(id));
    },

    remove: (name, id) => table(name).delete(keyOf(id)),

    /** Iterate a snapshot array, so callers may mutate the table mid-scan. */
    rows: (name) => [...table(name).values()],

    count: (name) => table(name).size,

    clear() {
      for (const t of tables.values()) t.clear();
    },

    tableNames: () => [...tables.keys()],
  };
}
