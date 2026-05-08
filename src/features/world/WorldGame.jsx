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

  const { connected, onlineCount, movePlayer, sendChat, identity } =
    useSpacetimeWorld(playerInfo, { onPlayerUpdate, onPlayerDelete, onChatMessage });

  useEffect(() => {
    if (identity) sceneRef.current?.setMyIdentity(identity);
  }, [identity]);

  // ── Babylon scene mount / unmount ─────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new BabylonWorldScene(
      canvasRef.current,
      playerInfo,
      { onMove: movePlayer }
    );
    sceneRef.current = scene;

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep movePlayer ref current (can change on reconnect)
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.callbacks.onMove = movePlayer;
  }, [movePlayer]);

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
        ) : (
          <div style={{ color: '#475569', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' }}>
            {IS_TOUCH
              ? <>Tap <kbd style={{ color: '#7dd3fc' }}>💬</kbd> or type to chat</>
              : <>Press <kbd style={{ color: '#7dd3fc' }}>Enter</kbd> to chat · <kbd style={{ color: '#7dd3fc' }}>/w</kbd> world chat</>
            }
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
