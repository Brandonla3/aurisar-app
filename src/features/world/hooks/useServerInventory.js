/**
 * useServerInventory — aggregates player_wallet, player_item_stack,
 * player_chest_opened, and player_equipped rows from SpacetimeDB callbacks.
 */

import { useCallback, useState } from 'react';

function idHex(identity) {
  if (!identity) return '';
  return typeof identity.toHexString === 'function' ? identity.toHexString() : String(identity);
}

export function useServerInventory() {
  const [stacks, setStacks] = useState(() => new Map());
  const [wallet, setWallet] = useState(null);
  const [openedChestRows, setOpenedChestRows] = useState(() => new Map());
  const [equippedRows, setEquippedRows] = useState(() => new Map());

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

  const onChestOpenedInsert = useCallback((row) => {
    setOpenedChestRows((prev) => {
      const next = new Map(prev);
      next.set(String(row.id), row);
      return next;
    });
  }, []);

  const onEquippedUpsert = useCallback((row) => {
    setEquippedRows((prev) => {
      const next = new Map(prev);
      next.set(String(row.id), row);
      return next;
    });
  }, []);

  const onEquippedDelete = useCallback((row) => {
    setEquippedRows((prev) => {
      const next = new Map(prev);
      next.delete(String(row.id));
      return next;
    });
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

  const openedChestIdsFor = useCallback((identity) => {
    const me = idHex(identity);
    const ids = new Set();
    if (!me) return ids;
    for (const row of openedChestRows.values()) {
      if (idHex(row.owner) !== me) continue;
      ids.add(Number(row.chestId));
    }
    return ids;
  }, [openedChestRows]);

  const equippedFor = useCallback((identity) => {
    const me = idHex(identity);
    const bySlot = {};
    if (!me) return bySlot;
    for (const row of equippedRows.values()) {
      if (idHex(row.owner) !== me) continue;
      bySlot[row.slot] = row.itemId;
    }
    return bySlot;
  }, [equippedRows]);

  return {
    stacks,
    wallet,
    openedChestRows,
    equippedRows,
    onStackUpsert,
    onStackDelete,
    onWalletUpsert,
    onChestOpenedInsert,
    onEquippedUpsert,
    onEquippedDelete,
    countsFor,
    copperFor,
    openedChestIdsFor,
    equippedFor,
  };
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
