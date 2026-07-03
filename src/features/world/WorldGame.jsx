/**
 * WorldGame — React component that owns the Babylon.js 3D world.
 *
 * Responsibilities:
 *   - Mount/destroy the BabylonWorldScene on the canvas ref
 *   - Bridge SpacetimeDB data (useSpacetimeWorld) into the 3D scene
 *   - Render a lightweight React chat overlay on top of the canvas
 *   - On touch devices: render a virtual joystick overlay (left half)
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { BabylonWorldScene } from './game/BabylonWorldScene.js';
import { useSpacetimeWorld }  from './useSpacetimeWorld.js';
import TestingHud             from './TestingHud.jsx';
import { useInventory }       from './useInventory.js';
import WorldMap               from './WorldMap.jsx';
import GameMenu               from './GameMenu.jsx';
import InventoryPanel         from './InventoryPanel.jsx';
import CookingPanel           from './CookingPanel.jsx';
import ActionButtons, { actionBtnStyle, actionBtnLabelStyle } from './ActionButtons.jsx';
import DialoguePanel          from './hud/DialoguePanel.jsx';
import QuestLogPanel          from './hud/QuestLogPanel.jsx';
import QuestTracker           from './hud/QuestTracker.jsx';
import { ITEMS }              from './game/items.js';
import { NPCS, QUESTS, WAYPOINTS } from './content/index';
import {
  QUEST_STATE, useQuestRows, myQuestsFrom, buildNpcMarkers, parseCounts,
} from './hooks/useQuests.js';
import { CLASSES }            from '../../data/exercises.js';

// Bundled UMD package — avoids the CSP script-src violation from loading
// jsdelivr at runtime and keeps BabylonWorldScene's window.BABYLON references.
if (typeof window !== 'undefined' && !window.BABYLON) {
  window.BABYLON = BABYLON;
}

const IS_TOUCH = typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches;

// Persisted UI visibility prefs (minimap + action-button cluster). Default on.
const UI_PREFS_KEY = 'aurisar.world.ui.v1';
function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        minimapVisible:    p.minimapVisible    !== false,
        showActionButtons: p.showActionButtons !== false,
      };
    }
  } catch { /* fall through */ }
  return { minimapVisible: true, showActionButtons: true };
}

// Joystick geometry
const JOY_BASE_R  = 48; // px — outer ring radius
const JOY_THUMB_R = 22; // px — thumb radius
const JOY_MAX_PX  = JOY_BASE_R - JOY_THUMB_R; // max thumb travel

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  wrap: {
    width: '100%', height: '100%', position: 'relative',
    background: '#12121e', overflow: 'hidden',
  },
  canvas: {
    display: 'block', width: '100%', height: '100%',
    // Prevent native touch scrolling / browser gestures on the canvas
    touchAction: 'none',
  },
  statusBadge: {
    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
    background: '#1e293b', color: '#94a3b8', fontSize: 12,
    padding: '4px 14px', borderRadius: 20, zIndex: 10,
    fontFamily: 'Inter, system-ui, sans-serif', border: '1px solid #334155',
    pointerEvents: 'none',
  },
  onlineCount: {
    // Cleared left of the circular minimap (top-right, ~168px wide incl. offset).
    position: 'absolute', top: 12, right: 178,
    color: '#4ade80', fontSize: 11,
    fontFamily: 'Inter, system-ui, sans-serif',
    textShadow: '0 0 6px #4ade8088', pointerEvents: 'none',
  },
  // Bottom-right toolbar: chat (bubble or expanded input) + action buttons,
  // read as one control strip.
  bottomBar: {
    position: 'absolute', bottom: 14, right: 12, zIndex: 15,
    display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    maxWidth: 'calc(100% - 24px)',
  },
  chatLogWrap: {
    position: 'absolute', bottom: 74, right: 12,
    width: IS_TOUCH ? 240 : 340, zIndex: 10,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  chatLog: {
    background: 'rgba(0,0,0,0.5)', borderRadius: 8,
    padding: '6px 10px',
    maxHeight: 100, overflowY: 'auto',
    fontSize: 12, color: '#cbd5e1', lineHeight: '1.55',
    backdropFilter: 'blur(4px)',
  },
  chatRow: { marginBottom: 2 },
  chatSender: { color: '#7dd3fc', fontWeight: 600 },
  chatInput: { display: 'flex', gap: 6, width: IS_TOUCH ? 240 : 340 },
  input: {
    flex: 1, background: 'rgba(15,23,42,0.9)',
    border: '1px solid #334155', borderRadius: 8,
    color: '#e2e8f0', fontSize: 12,
    padding: '5px 10px', outline: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  sendBtn: {
    background: '#3b82f6', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 12, padding: '5px 12px',
    cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
  },
  cancelBtn: {
    background: 'rgba(30,41,59,0.9)', border: '1px solid #334155', borderRadius: 8,
    color: '#94a3b8', fontSize: 12, padding: '5px 10px',
    cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
  },
  hint: {
    position: 'absolute', bottom: 74, right: 12,
    color: '#475569', fontSize: 10,
    fontFamily: 'Inter, system-ui, sans-serif',
    textAlign: 'right', lineHeight: '1.6', pointerEvents: 'none',
  },
  // Slice 5c: player HP bar — top-left, opposite the online counter.
  hpBarWrap: {
    position: 'absolute', top: 12, left: 14, zIndex: 10,
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: 'Inter, system-ui, sans-serif',
    pointerEvents: 'none',
  },
  hpBarBg: {
    width: 140, height: 10, borderRadius: 5,
    background: 'rgba(0,0,0,0.55)',
    border: '1px solid rgba(148,163,184,0.30)',
    overflow: 'hidden',
  },
  hpBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg,#dc2626 0%,#ef4444 50%,#f87171 100%)',
    transition: 'width 120ms linear',
  },
  hpBarLabel: {
    color: '#e2e8f0', fontSize: 11, fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 2px rgba(0,0,0,0.7)',
  },
  // Slice 5c: death overlay. Centered red text on a dimming film.
  deathOverlay: {
    position: 'absolute', inset: 0,
    background: 'radial-gradient(circle at center,rgba(50,0,0,0.55) 0%,rgba(0,0,0,0.85) 100%)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 100, pointerEvents: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#fca5a5',
  },
  deathTitle: {
    fontSize: 48, fontWeight: 700, letterSpacing: '0.04em',
    color: '#fecaca',
    textShadow: '0 2px 12px rgba(220,38,38,0.6)',
    marginBottom: 12,
  },
  deathSub: {
    fontSize: 16, color: '#cbd5e1',
    textShadow: '0 1px 4px rgba(0,0,0,0.7)',
  },
  // Virtual joystick zone — covers the left half, sits above the canvas
  joyZone: {
    position: 'absolute',
    inset: 0,
    width: '50%',
    zIndex: 5,
    touchAction: 'none',
    // No background — transparent; pointer events still fire
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function WorldGame({ playerInfo, onExit }) {
  const canvasRef  = useRef(null);
  const sceneRef   = useRef(null);
  const logEndRef  = useRef(null);
  const joyZoneRef = useRef(null);

  const [chatOpen,     setChatOpen]     = useState(false);
  const [chatInput,    setChatInput]    = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  // Visual joystick state: null = idle, object = active
  const [joyVis, setJoyVis] = useState(null); // { baseX, baseY, thumbX, thumbY }
  // Slice 5c: local player liveness from the SpacetimeDB player row.
  // Updated by BabylonWorldScene's onLocalPlayerUpdate callback.
  const [localHp, setLocalHp] = useState({ hp: 100, maxHp: 100, dead: false, deadUntil: 0n });

  // UI panels (single-modal) + visibility prefs + world model handle.
  const [activePanel, setActivePanel] = useState(null); // 'map'|'menu'|'inventory'|'cooking'|'quests'|null
  const [uiPrefs, setUiPrefs] = useState(loadUiPrefs);
  const [mapData, setMapData] = useState(null);
  const [toast, setToast]     = useState(null); // { text, id }

  // P1 quests/NPCs: which NPC is in talk range, and who we're talking to.
  const [nearbyNpcId,   setNearbyNpcId]   = useState(null);
  const [dialogueNpcId, setDialogueNpcId] = useState(null);
  // Flips when the Babylon scene exists so effects that push state INTO the
  // scene (NPC markers) re-run — the quest-marker effect otherwise fires
  // before sceneRef is set and never again while disconnected.
  const [sceneReady, setSceneReady] = useState(false);

  const inv = useInventory(playerInfo?.username);

  const togglePanel = useCallback((name) => setActivePanel((p) => (p === name ? null : name)), []);
  const openPanel   = useCallback((name) => setActivePanel(name), []);
  const closePanel  = useCallback(() => setActivePanel(null), []);
  const toggleMinimap = useCallback(
    () => setUiPrefs((p) => ({ ...p, minimapVisible: !p.minimapVisible })), []);
  const toggleActionButtons = useCallback(
    () => setUiPrefs((p) => ({ ...p, showActionButtons: !p.showActionButtons })), []);
  const showToast = useCallback((text) => setToast({ text, id: Date.now() }), []);

  // Persist visibility prefs.
  useEffect(() => {
    try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs)); } catch { /* quota */ }
  }, [uiPrefs]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Chest looted (fired by the scene's proximity scan) → grant items + toast.
  const onChestOpen = useCallback((chest) => {
    const rolled = inv.openChest(chest);
    if (rolled && rolled.length) {
      const txt = rolled.map((r) => `${r.qty}× ${ITEMS[r.id]?.name ?? r.id}`).join(', ');
      showToast(`Chest opened — found ${txt}`);
    }
  }, [inv, showToast]);

  const inputRef  = useRef(null);
  const joyTouchRef = useRef(null); // { id, baseX, baseY }

  // ── SpacetimeDB callbacks ─────────────────────────────────────────────────
  const onPlayerUpdate = useCallback((row) => {
    sceneRef.current?.applyPlayerUpdate(row);
  }, []);

  const onPlayerDelete = useCallback((row) => {
    sceneRef.current?._removeRemote(row.identity);
  }, []);

  const onChatMessage = useCallback((row) => {
    setChatMessages(prev => [...prev, row].slice(-60));
  }, []);

  const onMobUpsert = useCallback((row) => {
    sceneRef.current?.applyMobUpdate(row);
  }, []);

  const onMobDelete = useCallback((row) => {
    sceneRef.current?._removeMob(row.mobId);
  }, []);

  const onCampfireUpsert = useCallback((row) => {
    sceneRef.current?.applyCampfireUpdate(row);
  }, []);

  const onCampfireDelete = useCallback((row) => {
    sceneRef.current?._removeCampfire(row.campfireId);
  }, []);

  const onNearbyNpc = useCallback((npcId) => {
    setNearbyNpcId(npcId);
    // Walking out of range of the NPC we're talking to closes the dialogue
    // (the server would reject its accept/turn-in calls anyway).
    setDialogueNpcId((prev) => (prev && prev !== npcId ? null : prev));
  }, []);

  // Quest rows (identity-free handlers — filtered to ours below once
  // useSpacetimeWorld hands us the identity).
  const { onQuestUpsert, onQuestDelete, rows: questRows } = useQuestRows();

  const {
    connected, onlineCount, movePlayer, sendChat, castAbility, buildCampfire,
    acceptQuest, abandonQuest, turnInQuest, reachWaypoint, identity,
  } = useSpacetimeWorld(playerInfo, {
    onPlayerUpdate, onPlayerDelete, onChatMessage, onMobUpsert, onMobDelete,
    onCampfireUpsert, onCampfireDelete, onQuestUpsert, onQuestDelete,
  });

  const myQuests = React.useMemo(
    () => myQuestsFrom(questRows, identity),
    [questRows, identity],
  );
  const className = CLASSES[playerInfo?.classType]?.name;

  // NPC quest markers (! / ?) follow quest state into the 3D scene.
  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.setNpcMarkers(buildNpcMarkers(Object.keys(NPCS), myQuests));
  }, [myQuests, sceneReady]);

  // Auto-report 'find' objectives: when standing inside an unvisited
  // waypoint of an active quest, tell the server (which re-validates the
  // radius; double-sends are idempotent).
  useEffect(() => {
    const t = setInterval(() => {
      const pos = sceneRef.current?.getLocalPosition?.();
      if (!pos) return;
      for (const [questId, row] of myQuests) {
        if (row.state !== QUEST_STATE.ACTIVE) continue;
        const quest = QUESTS[questId];
        if (!quest) continue;
        const counts = parseCounts(row, quest);
        quest.objectives.forEach((obj, i) => {
          if (obj.type !== 'find' || (counts[i] ?? 0) >= 1) return;
          const wp = WAYPOINTS[obj.targetId];
          if (!wp) return;
          const dx = pos.x - wp.pos.x;
          const dz = pos.z - wp.pos.z;
          if (dx * dx + dz * dz <= wp.radiusM * wp.radiusM) {
            reachWaypoint(questId, i);
          }
        });
      }
    }, 1200);
    return () => clearInterval(t);
  }, [myQuests, reachWaypoint]);


  useEffect(() => {
    if (identity) sceneRef.current?.setMyIdentity(identity);
  }, [identity]);

  // Slice 5c — local-player HP / death overlay state, driven by BabylonWorldScene
  // when our own row arrives via the player table subscription.
  const onLocalPlayerUpdate = useCallback((state) => {
    setLocalHp(state);
  }, []);

  // ── Babylon scene mount / unmount ─────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new BabylonWorldScene(
      canvasRef.current,
      playerInfo,
      { onMove: movePlayer, onCastAbility: castAbility, onBuildCampfire: buildCampfire,
        onLocalPlayerUpdate, onChestOpen, onNearbyNpc }
    );
    sceneRef.current = scene;
    setMapData(scene.getMapData());
    setSceneReady(true);

    return () => {
      scene.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep movePlayer + castAbility refs current (can change on reconnect)
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.callbacks.onMove = movePlayer;
  }, [movePlayer]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.callbacks.onCastAbility = castAbility;
  }, [castAbility]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.callbacks.onBuildCampfire = buildCampfire;
  }, [buildCampfire]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.callbacks.onChestOpen = onChestOpen;
  }, [onChestOpen]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Chat open/close ───────────────────────────────────────────────────────
  const openChat = useCallback(() => {
    setChatOpen(true);
    sceneRef.current?.setChatOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatInput('');
    sceneRef.current?.setChatOpen(false);
    // Drop the on-screen keyboard focus so mobile browsers don't eat the
    // next tap as a "dismiss keyboard" gesture instead of a game input.
    inputRef.current?.blur();
  }, []);

  // ── Virtual joystick (mobile only) ───────────────────────────────────────
  useEffect(() => {
    if (!IS_TOUCH) return;
    const zone = joyZoneRef.current;
    if (!zone) return;

    const onDown = (e) => {
      if (joyTouchRef.current) return; // already tracking one finger
      e.preventDefault();
      const rect  = zone.getBoundingClientRect();
      const baseX = e.clientX - rect.left;
      const baseY = e.clientY - rect.top;
      joyTouchRef.current = { id: e.pointerId, baseX, baseY };
      zone.setPointerCapture(e.pointerId);
      setJoyVis({ baseX, baseY, thumbX: baseX, thumbY: baseY });
      sceneRef.current?.setJoystick(0, 0);
    };

    const onMove = (e) => {
      const joy = joyTouchRef.current;
      if (!joy || e.pointerId !== joy.id) return;
      e.preventDefault();
      const rect   = zone.getBoundingClientRect();
      const rawX   = e.clientX - rect.left - joy.baseX;
      const rawY   = e.clientY - rect.top  - joy.baseY;
      const dist   = Math.hypot(rawX, rawY);
      const capped = Math.min(dist, JOY_MAX_PX);
      const nx = dist > 0.5 ? rawX / dist : 0;
      const ny = dist > 0.5 ? rawY / dist : 0;
      const thumbX = joy.baseX + nx * capped;
      const thumbY = joy.baseY + ny * capped;
      setJoyVis({ baseX: joy.baseX, baseY: joy.baseY, thumbX, thumbY });
      // Normalise to [-1, 1] for the scene
      sceneRef.current?.setJoystick(nx * (capped / JOY_MAX_PX), ny * (capped / JOY_MAX_PX));
    };

    const onUp = (e) => {
      if (!joyTouchRef.current || e.pointerId !== joyTouchRef.current.id) return;
      e.preventDefault();
      joyTouchRef.current = null;
      setJoyVis(null);
      sceneRef.current?.setJoystick(0, 0);
    };

    zone.addEventListener('pointerdown',   onDown, { passive: false });
    zone.addEventListener('pointermove',   onMove, { passive: false });
    zone.addEventListener('pointerup',     onUp,   { passive: false });
    zone.addEventListener('pointercancel', onUp,   { passive: false });

    return () => {
      zone.removeEventListener('pointerdown',   onDown, { passive: false });
      zone.removeEventListener('pointermove',   onMove, { passive: false });
      zone.removeEventListener('pointerup',     onUp,   { passive: false });
      zone.removeEventListener('pointercancel', onUp,   { passive: false });
    };
  }, []);

  const submitChat = useCallback(() => {
    const text = chatInput.trim();
    if (text && connected) {
      const msgType = text.startsWith('/w ') ? 'world' : 'proximity';
      sendChat(text.replace(/^\/w /, ''), msgType);
    }
    closeChat();
  }, [chatInput, connected, sendChat, closeChat]);

  // Keyboard: Enter opens chat, Escape closes it (without exiting world)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Enter' && !chatOpen) { e.stopPropagation(); openChat(); }
      if (e.key === 'Escape' && chatOpen) { e.stopPropagation(); closeChat(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [chatOpen, openChat, closeChat]);

  // Keyboard: UI hotkeys (map/inventory/cooking/menu/minimap). Capture phase +
  // stopPropagation so they don't reach the scene's movement handler or
  // WorldOverlay's Escape-exits-world handler. Ignored while typing in chat.
  useEffect(() => {
    const handler = (e) => {
      if (chatOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (dialogueNpcId) { e.stopPropagation(); e.preventDefault(); setDialogueNpcId(null); return; }
        if (activePanel) { e.stopPropagation(); e.preventDefault(); closePanel(); }
        return;
      }
      let handled = true;
      switch (e.code) {
        case 'KeyM': togglePanel('map');       break;
        case 'KeyI': togglePanel('inventory'); break;
        case 'KeyC': togglePanel('cooking');   break;
        case 'KeyG': togglePanel('menu');      break;
        case 'KeyL': togglePanel('quests');    break;
        case 'KeyN': toggleMinimap();          break;
        case 'KeyE':
          if (nearbyNpcId && !dialogueNpcId) setDialogueNpcId(nearbyNpcId);
          else if (dialogueNpcId) setDialogueNpcId(null);
          else handled = false;
          break;
        default: handled = false;
      }
      if (handled) { e.stopPropagation(); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [chatOpen, activePanel, togglePanel, toggleMinimap, closePanel, nearbyNpcId, dialogueNpcId]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      <canvas ref={canvasRef} style={S.canvas} />

      <TestingHud sceneRef={sceneRef} visible={uiPrefs.minimapVisible} mapData={mapData} />

      {/* P1: active-quest tracker (hidden while any modal is open) */}
      {!activePanel && !dialogueNpcId && <QuestTracker myQuests={myQuests} />}

      {/* World map */}
      {activePanel === 'map' && mapData && (
        <WorldMap mapData={mapData} sceneRef={sceneRef} onClose={closePanel} />
      )}

      {/* Inventory / Cooking */}
      {activePanel === 'inventory' && (
        <InventoryPanel inv={inv} onClose={closePanel} onToast={showToast} />
      )}
      {activePanel === 'cooking' && (
        <CookingPanel inv={inv} sceneRef={sceneRef} onClose={closePanel} onToast={showToast} />
      )}

      {/* P1: quest log */}
      {activePanel === 'quests' && (
        <QuestLogPanel
          myQuests={myQuests}
          onAbandonQuest={abandonQuest}
          onClose={closePanel}
        />
      )}

      {/* P1: NPC dialogue */}
      {dialogueNpcId && (
        <DialoguePanel
          npcId={dialogueNpcId}
          myQuests={myQuests}
          playerName={playerInfo?.username}
          className={className}
          onAcceptQuest={(qid) => { acceptQuest(qid); showToast(`Quest accepted: ${QUESTS[qid]?.name ?? qid}`); }}
          onTurnInQuest={(qid) => { turnInQuest(qid); showToast(`Quest complete: ${QUESTS[qid]?.name ?? qid}`); }}
          onClose={() => setDialogueNpcId(null)}
        />
      )}

      {/* P1: talk prompt when an NPC is in range (tap-friendly) */}
      {nearbyNpcId && !dialogueNpcId && !activePanel && (
        <button
          onClick={() => setDialogueNpcId(nearbyNpcId)}
          aria-label={`Talk to ${NPCS[nearbyNpcId]?.name ?? 'NPC'}`}
          style={{
            position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)',
            zIndex: 20, display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(15,23,42,0.88)', border: '1px solid rgba(240,208,96,0.5)',
            borderRadius: 22, padding: '9px 18px', color: '#f0d060',
            fontSize: 13.5, fontWeight: 600, fontFamily: 'Inter, system-ui, sans-serif',
            cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span>💬</span>
          <span>Talk to {NPCS[nearbyNpcId]?.name ?? 'NPC'}{!IS_TOUCH && ' (E)'}</span>
        </button>
      )}

      {/* Game menu */}
      {activePanel === 'menu' && (
        <GameMenu
          sceneRef={sceneRef}
          onClose={closePanel}
          onOpenMap={()       => openPanel('map')}
          onOpenInventory={() => openPanel('inventory')}
          onOpenCooking={()   => openPanel('cooking')}
          showActionButtons={uiPrefs.showActionButtons}
          onToggleActionButtons={toggleActionButtons}
          minimapVisible={uiPrefs.minimapVisible}
          onToggleMinimap={toggleMinimap}
          onExit={onExit}
        />
      )}

      {/* Transient toast (pickups, cooking, eating) */}
      {toast && (
        <div
          style={{
            position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
            zIndex: 80, maxWidth: '80%',
            background: 'rgba(15,23,42,0.92)', border: '1px solid rgba(240,208,96,0.4)',
            borderRadius: 20, padding: '8px 16px', color: '#f0d060', fontSize: 13,
            fontFamily: 'Inter, system-ui, sans-serif', textAlign: 'center',
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)', pointerEvents: 'none',
          }}
        >
          {toast.text}
        </div>
      )}

      {/* Mobile: virtual joystick zone (left half, above canvas) */}
      {IS_TOUCH && (
        <div ref={joyZoneRef} style={S.joyZone}>
          {joyVis && (
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
            >
              {/* Base ring */}
              <circle
                cx={joyVis.baseX} cy={joyVis.baseY} r={JOY_BASE_R}
                fill="rgba(255,255,255,0.07)"
                stroke="rgba(255,255,255,0.20)"
                strokeWidth={1.5}
              />
              {/* Thumb */}
              <circle
                cx={joyVis.thumbX} cy={joyVis.thumbY} r={JOY_THUMB_R}
                fill="rgba(255,255,255,0.18)"
                stroke="rgba(255,255,255,0.40)"
                strokeWidth={1.5}
              />
            </svg>
          )}
        </div>
      )}

      {/* Connection badge */}
      {!connected && (
        <div style={S.statusBadge}>Connecting to Aurisar World…</div>
      )}

      {/* Online count */}
      {connected && (
        <div style={S.onlineCount}>
          ● {onlineCount} online
        </div>
      )}

      {/* Slice 5c: local-player HP bar (always visible while connected). */}
      {connected && (
        <div style={S.hpBarWrap}>
          <div style={S.hpBarBg}>
            <div
              style={{
                ...S.hpBarFill,
                width: `${Math.max(0, Math.min(100, (localHp.hp / Math.max(1, localHp.maxHp)) * 100))}%`,
              }}
            />
          </div>
          <span style={S.hpBarLabel}>
            {Math.max(0, localHp.hp)}/{localHp.maxHp} HP
          </span>
        </div>
      )}

      {/* Slice 5c: death overlay. Dimmed red film + "You died" text while the
          server-side respawn timer ticks. Auto-dismisses when the server
          marks us alive again (hp > 0, deadUntil cleared). */}
      {localHp.dead && (
        <div style={S.deathOverlay}>
          <div style={S.deathTitle}>You died</div>
          <div style={S.deathSub}>Respawning at the hub…</div>
        </div>
      )}

      {/* Chat message log — floats above the bottom bar whenever there's history */}
      {chatMessages.length > 0 && (
        <div style={S.chatLogWrap}>
          <div style={S.chatLog}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={S.chatRow}>
                <span style={S.chatSender}>[{msg.senderName}]</span>{' '}
                <span>{msg.text}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Bottom-right toolbar — chat (bubble or expanded input) sits right
          next to the action buttons so they read as one control strip. */}
      <div style={S.bottomBar}>
        {chatOpen ? (
          <div style={S.chatInput}>
            <input
              ref={inputRef}
              style={S.input}
              value={chatInput}
              placeholder="Type a message… (Enter to send, Esc to cancel)"
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); submitChat(); }
                if (e.key === 'Escape') { e.preventDefault(); closeChat();  }
              }}
            />
            <button style={S.sendBtn} onClick={submitChat}>Send</button>
            <button style={S.cancelBtn} onClick={closeChat} aria-label="Cancel chat">✕</button>
          </div>
        ) : (
          <>
            {IS_TOUCH && (
              <button style={actionBtnStyle} onClick={openChat} aria-label="Open chat">
                <span style={{ fontSize: 22 }}>💬</span>
                <span style={actionBtnLabelStyle}>Chat</span>
              </button>
            )}
            {uiPrefs.showActionButtons && (
              <ActionButtons
                onMap={()       => openPanel('map')}
                onQuests={()    => openPanel('quests')}
                onInventory={() => openPanel('inventory')}
                onCooking={()   => openPanel('cooking')}
                onCampfire={()  => sceneRef.current?.requestBuildCampfire()}
                onMenu={()      => openPanel('menu')}
              />
            )}
          </>
        )}
      </div>

      {/* Controls hint — desktop only (mobile hint is self-evident from joystick) */}
      {!IS_TOUCH && (
        <div style={S.hint}>
          WASD / ↑↓←→ move · Space attack · E talk · F campfire<br />
          M map · L quests · I inventory · C cooking · G menu · N minimap<br />
          Enter chat · Mouse drag orbit · Scroll zoom · ESC exit world
        </div>
      )}
    </div>
  );
}
