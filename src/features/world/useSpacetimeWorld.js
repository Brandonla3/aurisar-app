/**
 * useSpacetimeWorld — SpacetimeDB connection hook (v2.x API)
 *
 * Uses the generated DbConnection from `spacetime generate`.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { DbConnection } from './module_bindings';

const STDB_URI    = import.meta.env.VITE_SPACETIMEDB_URI    ?? 'wss://maincloud.spacetimedb.com';
const STDB_MODULE = import.meta.env.VITE_SPACETIMEDB_MODULE ?? 'aurisar-world';

/**
 * @param {object|null} playerInfo  - { username, classType, avatarColor }
 * @param {object}      callbacks   - { onPlayerUpdate, onPlayerDelete, onChatMessage }
 * @returns {{ connected, pending, onlineCount, movePlayer, sendChat, identity }}
 */
export function useSpacetimeWorld(playerInfo, callbacks) {
  const connRef      = useRef(null);
  const [connected,    setConnected]    = useState(false);
  const [onlineCount,  setOnlineCount]  = useState(0);
  const callbacksRef = useRef(callbacks);

  // Keep callbacks ref fresh without re-running the main effect
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

  // ── Reducer wrappers ───────────────────────────────────────────────────────

  const movePlayer = useCallback((x, y, direction, isMoving) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.movePlayer(x, y, direction, isMoving);
    } catch (_) { /* not connected yet */ }
  }, []);

  const sendChat = useCallback((text, msgType = 'proximity') => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.sendChat(text, msgType);
    } catch (_) { /* not connected yet */ }
  }, []);

  // ── Connection lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    if (!playerInfo) return;

    let conn = null;

    try {
      conn = DbConnection.builder()
        .withUri(STDB_URI)
        .withModuleName(STDB_MODULE)
        .onConnect((connection, _identity, _token) => {
          setConnected(true);

          // Register our Aurisar display info with the server
          connection.reducers.setPlayerInfo(
            playerInfo.username,
            playerInfo.classType,
            playerInfo.avatarColor
          );

          // Subscribe to live tables
          connection
            .subscriptionBuilder()
            .onApplied(() => {
              _refreshOnlineCount(connection);
            })
            .subscribe(['SELECT * FROM player', 'SELECT * FROM chat_message']);

          // ── player table events ──
          connection.db.player.onInsert((_ctx, row) => {
            callbacksRef.current?.onPlayerUpdate?.(row);
            _refreshOnlineCount(connection);
          });
          connection.db.player.onUpdate((_ctx, _oldRow, row) => {
            callbacksRef.current?.onPlayerUpdate?.(row);
            _refreshOnlineCount(connection);
          });
          connection.db.player.onDelete((_ctx, row) => {
            callbacksRef.current?.onPlayerDelete?.(row);
            _refreshOnlineCount(connection);
          });

          // ── chat_message table events ──
          connection.db.chatMessage.onInsert((_ctx, row) => {
            callbacksRef.current?.onChatMessage?.(row);
          });
        })
        .onDisconnect((_ctx, _reason) => {
          setConnected(false);
        })
        .onError((_ctx, err) => {
          console.error('[SpacetimeDB] Connection error:', err);
        })
        .build();

      connRef.current = conn;
    } catch (err) {
      console.error('[useSpacetimeWorld] Failed to build connection:', err);
    }

    function _refreshOnlineCount(connection) {
      let count = 0;
      try {
        for (const p of connection.db.player.iter()) {
          if (p.online) count++;
        }
      } catch (_) {}
      setOnlineCount(count);
    }

    return () => {
      try { conn?.disconnect?.(); } catch (_) {}
      connRef.current = null;
      setConnected(false);
      setOnlineCount(0);
    };
  // Reconnect if the user's identity changes (e.g. switching accounts)
  }, [playerInfo?.username, playerInfo?.classType]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connected,
    pending: !connected,
    onlineCount,
    movePlayer,
    sendChat,
    identity: connRef.current?.identity ?? null,
  };
}
