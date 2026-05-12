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

// Bundled UMD package — avoids the CSP script-src violation from loading
// jsdelivr at runtime and keeps BabylonWorldScene's window.BABYLON references.
if (typeof window !== 'undefined' && !window.BABYLON) {
  window.BABYLON = BABYLON;
}

const IS_TOUCH = typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches;

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
    position: 'absolute', top: 12, right: 14,
    color: '#4ade80', fontSize: 11,
    fontFamily: 'Inter, system-ui, sans-serif',
    textShadow: '0 0 6px #4ade8088', pointerEvents: 'none',
  },
  chatWrap: {
    position: 'absolute', bottom: 14, left: 14,
    width: IS_TOUCH ? 240 : 340, zIndex: 10,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  chatLog: {
    background: 'rgba(0,0,0,0.5)', borderRadius: 8,
    padding: '6px 10px', marginBottom: 6,
    maxHeight: 100, overflowY: 'auto',
    fontSize: 12, color: '#cbd5e1', lineHeight: '1.55',
    backdropFilter: 'blur(4px)',
  },
  chatRow: { marginBottom: 2 },
  chatSender: { color: '#7dd3fc', fontWeight: 600 },
  chatInput: { display: 'flex', gap: 6 },
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
  hint: {
    position: 'absolute', bottom: 14, right: 14,
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
export default function WorldGame({ playerInfo }) {
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

  const { connected, onlineCount, movePlayer, sendChat, castAbility, identity } =
    useSpacetimeWorld(playerInfo, {
      onPlayerUpdate, onPlayerDelete, onChatMessage, onMobUpsert, onMobDelete,
    });

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
      { onMove: movePlayer, onCastAbility: castAbility, onLocalPlayerUpdate }
    );
    sceneRef.current = scene;

    return () => {
      scene.dispose();
      sceneRef.current = null;
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

  // Scroll chat to bottom on new messages
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      <canvas ref={canvasRef} style={S.canvas} />

      <TestingHud sceneRef={sceneRef} />

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

      {/* Online count — nudge left on mobile to clear the Exit button */}
      {connected && (
        <div style={{ ...S.onlineCount, right: IS_TOUCH ? 120 : 14 }}>
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

      {/* Chat */}
      <div style={S.chatWrap}>
        {chatMessages.length > 0 && (
          <div style={S.chatLog}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={S.chatRow}>
                <span style={S.chatSender}>[{msg.senderName}]</span>{' '}
                <span>{msg.text}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

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
          </div>
        ) : IS_TOUCH ? (
          <button
            onClick={openChat}
            aria-label="Open chat"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(15,23,42,0.75)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              border: '1px solid rgba(148,163,184,0.20)',
              borderRadius: 20,
              color: '#94a3b8', fontSize: 12,
              fontFamily: 'Inter, system-ui, sans-serif',
              minHeight: 36, padding: '0 14px',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span>💬</span>
            <span>Chat</span>
          </button>
        ) : (
          <div style={{ color: '#475569', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' }}>
            Press <kbd style={{ color: '#7dd3fc' }}>Enter</kbd> to chat · <kbd style={{ color: '#7dd3fc' }}>/w</kbd> world chat
          </div>
        )}
      </div>

      {/* Controls hint — desktop only (mobile hint is self-evident from joystick) */}
      {!IS_TOUCH && (
        <div style={S.hint}>
          WASD / ↑↓←→ move<br />
          Mouse drag — orbit camera<br />
          Scroll — zoom<br />
          ESC — exit world
        </div>
      )}
    </div>
  );
}
