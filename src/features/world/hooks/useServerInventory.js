/**
 * useServerInventory — aggregates player_wallet + player_item_stack rows
 * from SpacetimeDB callbacks into counts + copper for the HUD.
 */

import { useCallback, useMemo, useState } from 'react';

function idHex(identity) {
  if (!identity) return '';
  return typeof identity.toHexString === 'function' ? identity.toHexString() : String(identity);
}

export function useServerInventory() {
  const [stacks, setStacks] = useState(() => new Map()); // rowId → row
  const [wallet, setWallet] = useState(null); // wallet row for local identity

  const onStackUpsert = useCallback((row) => {
    setStacks((prev) => {
      const next = new Map(prev);
      next.set(String(row.id), row);
      return next;
    });
  }, []);

  const onStackDelete = useCallback((row) => {
    setStacks((prev) => {
      const next = new Map(prev);
      next.delete(String(row.id));
      return next;
    });
  }, []);

  const onWalletUpsert = useCallback((row) => {
    setWallet(row);
  }, []);

  const countsFor = useCallback((identity) => {
    const me = idHex(identity);
    const counts = {};
    if (!me) return counts;
    for (const row of stacks.values()) {
      if (idHex(row.owner) !== me) continue;
      counts[row.itemId] = (counts[row.itemId] ?? 0) + row.quantity;
    }
    return counts;
  }, [stacks]);

  const copperFor = useCallback((identity) => {
    if (!wallet || idHex(wallet.identity) !== idHex(identity)) return 0n;
    return wallet.copper ?? 0n;
  }, [wallet]);

  return {
    stacks,
    wallet,
    onStackUpsert,
    onStackDelete,
    onWalletUpsert,
    countsFor,
    copperFor,
  };
}

/** Merge server + local stack counts (chest/cook overlay until P4 phase 4). */
export function mergeInventoryCounts(serverCounts, localCounts) {
  const merged = { ...serverCounts };
  for (const [id, qty] of Object.entries(localCounts ?? {})) {
    if (qty > 0) merged[id] = (merged[id] ?? 0) + qty;
  }
  return merged;
}

/**
 * Build importInventory args from the legacy localStorage save.
 * Returns null when there is nothing to migrate.
 */
export function localInventoryImportPayload(playerId) {
  const id = String(playerId ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  const key = id
    ? `aurisar.world.inventory.v1.${id}`
    : 'aurisar.world.inventory.v1.anon';
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const items = { ...(parsed.items ?? {}) };
    const coinQty = Math.max(0, Math.floor(Number(items.coin) || 0));
    delete items.coin;
    const hasItems = Object.values(items).some((n) => Number(n) > 0);
    if (!hasItems && coinQty <= 0) return null;
    return { itemsJson: JSON.stringify(items), coinQty };
  } catch {
    return null;
  }
}
