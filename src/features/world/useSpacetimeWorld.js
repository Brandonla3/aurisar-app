/**
 * useSpacetimeWorld — SpacetimeDB connection hook (v2.x API)
 *
 * Uses the generated DbConnection from `spacetime generate`.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { DbConnection } from './module_bindings';
import { worldLevelFromFitnessXp } from './content/formulas/xp';

const STDB_URI    = import.meta.env.VITE_SPACETIMEDB_URI    ?? 'wss://maincloud.spacetimedb.com';
const STDB_MODULE = import.meta.env.VITE_SPACETIMEDB_MODULE ?? 'aurisar-world';

/**
 * @param {object|null} playerInfo  - { username, classType, avatarColor, avatarConfig, fitnessXp, fitnessXpBaseline }
 * @param {object}      callbacks   - { onPlayerUpdate, onPlayerDelete, onChatMessage, onMobUpsert, onMobDelete, onCampfireUpsert, onCampfireDelete }
 * @returns {{ connected, pending, onlineCount, worldLevel, movePlayer, sendChat, setAvatarConfig, castAbility, buildCampfire, identity }}
 */
export function useSpacetimeWorld(playerInfo, callbacks) {
  const connRef      = useRef(null);
  const [connected,    setConnected]    = useState(false);
  const [onlineCount,  setOnlineCount]  = useState(0);
  const [worldLevel,   setWorldLevel]   = useState(() =>
    worldLevelFromFitnessXp(playerInfo?.fitnessXp ?? 0, playerInfo?.fitnessXpBaseline ?? 0),
  );
  const callbacksRef = useRef(callbacks);

  // Keep callbacks ref fresh without re-running the main effect
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

  // ── Reducer wrappers ───────────────────────────────────────────────────────

  const movePlayer = useCallback((x, y, direction, isMoving, floorYM = 0) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.movePlayer(x, y, direction, isMoving, floorYM);
    } catch (_) { /* not connected yet */ }
  }, []);

  const sendChat = useCallback((text, msgType = 'proximity') => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.sendChat(text, msgType);
    } catch (_) { /* not connected yet */ }
  }, []);

  const setAvatarConfig = useCallback((configJson) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.setAvatarConfig(configJson);
    } catch (_) { /* not connected yet */ }
  }, []);

  const castAbility = useCallback((mobId) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.castAbility(mobId);
    } catch (_) { /* not connected yet */ }
  }, []);

  const buildCampfire = useCallback((x, y) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.buildCampfire(x, y);
    } catch (_) { /* not connected yet */ }
  }, []);

  // ── P1 quest reducers ──────────────────────────────────────────────────────

  const acceptQuest = useCallback((questId) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.acceptQuest(questId);
    } catch { /* not connected yet */ }
  }, []);

  const abandonQuest = useCallback((questId) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.abandonQuest(questId);
    } catch { /* not connected yet */ }
  }, []);

  const turnInQuest = useCallback((questId) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.turnInQuest(questId);
    } catch { /* not connected yet */ }
  }, []);

  const reachWaypoint = useCallback((questId, objectiveIdx) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.reachWaypoint(questId, objectiveIdx);
    } catch { /* not connected yet */ }
  }, []);

  const enterDungeon = useCallback((dungeonId) => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.enterDungeon(dungeonId);
    } catch { /* not connected yet */ }
  }, []);

  const leaveDungeon = useCallback(() => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      conn.reducers.leaveDungeon();
    } catch { /* not connected yet */ }
  }, []);

  // ── Connection lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    if (!playerInfo) return;

    let conn = null;

    try {
      conn = DbConnection.builder()
        .withUri(STDB_URI)
        .withDatabaseName(STDB_MODULE)
        .onConnect((connection, _identity, _token) => {
          setConnected(true);

          // Register our Aurisar display info with the server
          connection.reducers.setPlayerInfo(
            playerInfo.username,
            playerInfo.classType,
            playerInfo.avatarColor,
            playerInfo.avatarConfig ? JSON.stringify(playerInfo.avatarConfig) : ''
          );

          try {
            connection.reducers.syncProgress(
              BigInt(Math.max(0, Math.floor(playerInfo.fitnessXp ?? 0))),
              BigInt(Math.max(0, Math.floor(playerInfo.fitnessXpBaseline ?? 0))),
            );
          } catch (err) {
            console.warn('[useSpacetimeWorld] syncProgress failed (module not republished yet?):', err);
          }

          // Seed the world's mobs on first ever connect. Idempotent server-side,
          // so subsequent connects are no-ops. Errors are logged so they're
          // visible during debugging (previously a swallowed empty catch hid
          // CSP / binding failures for hours).
          try {
            connection.reducers.seedWorld();
          } catch (err) {
            console.error('[useSpacetimeWorld] seedWorld() failed:', err);
          }

          // Subscribe to live tables
          connection
            .subscriptionBuilder()
            .onApplied(() => {
              _refreshOnlineCount(connection);
            })
            .subscribe([
              'SELECT * FROM player',
              'SELECT * FROM chat_message',
              'SELECT * FROM mob',
              'SELECT * FROM dungeon_instance',
            ]);

          // Campfires ride a separate subscription: if the deployed module
          // predates the campfire table (client deploy and module publish
          // race on merge), only fires degrade — players/chat/mobs survive.
          connection
            .subscriptionBuilder()
            .onError((ctx) => {
              console.warn('[useSpacetimeWorld] campfire subscription failed (module not republished yet?):', ctx?.event);
            })
            .subscribe(['SELECT * FROM campfire']);

          // Quests ride their own subscription for the same module-version
          // tolerance: a client deployed before the P1 module publish just
          // loses quest UI, nothing else.
          connection
            .subscriptionBuilder()
            .onError((ctx) => {
              console.warn('[useSpacetimeWorld] player_quest subscription failed (module not republished yet?):', ctx?.event);
            })
            .subscribe(['SELECT * FROM player_quest']);

          connection
            .subscriptionBuilder()
            .onError((ctx) => {
              console.warn('[useSpacetimeWorld] player_progress subscription failed (module not republished yet?):', ctx?.event);
            })
            .subscribe(['SELECT * FROM player_progress']);

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

          // ── mob table events ──
          connection.db.mob.onInsert((_ctx, row) => {
            callbacksRef.current?.onMobUpsert?.(row);
          });
          connection.db.mob.onUpdate((_ctx, _oldRow, row) => {
            callbacksRef.current?.onMobUpsert?.(row);
          });
          connection.db.mob.onDelete((_ctx, row) => {
            callbacksRef.current?.onMobDelete?.(row);
          });

          // ── campfire table events ──
          connection.db.campfire.onInsert((_ctx, row) => {
            callbacksRef.current?.onCampfireUpsert?.(row);
          });
          connection.db.campfire.onDelete((_ctx, row) => {
            callbacksRef.current?.onCampfireDelete?.(row);
          });

          // ── player_quest table events (optional chaining: bindings may
          //    predate the table during a deploy race) ──
          connection.db.playerQuest?.onInsert((_ctx, row) => {
            callbacksRef.current?.onQuestUpsert?.(row);
          });
          connection.db.playerQuest?.onUpdate((_ctx, _oldRow, row) => {
            callbacksRef.current?.onQuestUpsert?.(row);
          });
          connection.db.playerQuest?.onDelete((_ctx, row) => {
            callbacksRef.current?.onQuestDelete?.(row);
          });

          const applyProgressLevel = (row) => {
            if (connection.identity?.isEqual?.(row.identity)) {
              setWorldLevel(row.worldLevel ?? 1);
            }
          };
          connection.db.playerProgress?.onInsert((_ctx, row) => applyProgressLevel(row));
          connection.db.playerProgress?.onUpdate((_ctx, _old, row) => applyProgressLevel(row));
        })
        .onDisconnect((_ctx, err) => {
          setConnected(false);
          if (err) console.error('[SpacetimeDB] Disconnected with error:', err);
        })
        .onConnectError((_ctx, err) => {
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
  // Reconnect if the user's identity or fitness XP changes
  }, [playerInfo?.username, playerInfo?.classType, playerInfo?.fitnessXp, playerInfo?.fitnessXpBaseline]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setWorldLevel(worldLevelFromFitnessXp(
      playerInfo?.fitnessXp ?? 0,
      playerInfo?.fitnessXpBaseline ?? 0,
    ));
  }, [playerInfo?.fitnessXp, playerInfo?.fitnessXpBaseline]);

  return {
    connected,
    pending: !connected,
    onlineCount,
    worldLevel,
    movePlayer,
    sendChat,
    setAvatarConfig,
    castAbility,
    buildCampfire,
    acceptQuest,
    abandonQuest,
    turnInQuest,
    reachWaypoint,
    enterDungeon,
    leaveDungeon,
    identity: connRef.current?.identity ?? null,
  };
}
