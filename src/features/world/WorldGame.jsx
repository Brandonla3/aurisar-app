/**
 * WorldGame — React component that owns the Babylon.js 3D world.
 *
 * Responsibilities:
 *   - Mount/destroy the BabylonWorldScene on the canvas ref
 *   - Bridge SpacetimeDB data (useSpacetimeWorld) into the 3D scene
 *   - Render a lightweight React chat overlay on top of the canvas
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { BabylonWorldScene } from './game/BabylonWorldScene.js';
import { useSpacetimeWorld }  from './useSpacetimeWorld.js';

// Bundled UMD package (same artifact the CDN was serving) — avoids the CSP
// script-src violation from loading jsdelivr at runtime, and keeps the scene
// file's existing `window.BABYLON` references working unchanged.
if (typeof window !== 'undefined' && !window.BABYLON) {
  window.BABYLON = BABYLON;
}

// ── Chat styles (inline — no extra CSS file needed) ──────────────────────────
const S = {
  wrap: {
    width: '100%', height: '100%', position: 'relative', background: '#12121e', overflow: 'hidden',
  },
  canvas: {
    display: 'block', width: '100%', height: '100%',
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
    width: 340, zIndex: 10,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  chatLog: {
    background: 'rgba(0,0,0,0.5)', borderRadius: 8,
    padding: '6px 10px', marginBottom: 6,
    maxHeight: 140, overflowY: 'auto',
    fontSize: 12, color: '#cbd5e1', lineHeight: '1.55',
    backdropFilter: 'blur(4px)',
  },
  chatRow: { marginBottom: 2 },
  chatSender: { color: '#7dd3fc', fontWeight: 600 },
  chatInput: {
    display: 'flex', gap: 6,
  },
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
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function WorldGame({ playerInfo }) {
  const canvasRef  = useRef(null);
  const sceneRef   = useRef(null);
  const logEndRef  = useRef(null);

  const [chatOpen,    setChatOpen]    = useState(false);
  const [chatInput,   setChatInput]   = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const inputRef = useRef(null);

  // ── SpacetimeDB callbacks ───────────────────────────────────────────────────
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

  // Pass identity to the scene so it can skip rendering ourselves
  useEffect(() => {
    if (identity) sceneRef.current?.setMyIdentity(identity);
  }, [identity]);

  // ── Babylon scene mount / unmount ──────────────────────────────────────────
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

  // Keep movePlayer in the scene current (reference can change on reconnect)
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.callbacks.onMove = movePlayer;
  }, [movePlayer]);

  // Scroll chat log to bottom on new messages
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ── Chat open/close ────────────────────────────────────────────────────────
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
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [chatOpen, openChat, closeChat]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      <canvas ref={canvasRef} style={S.canvas} />

      {/* Connection badge */}
      {!connected && (
        <div style={S.statusBadge}>Connecting to Aurisar World…</div>
      )}

      {/* Online count */}
      {connected && (
        <div style={S.onlineCount}>● {onlineCount} online</div>
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
          <div style={{ color: '#475569', fontSize: 11,
                        fontFamily: 'Inter, system-ui, sans-serif' }}>
            Press <kbd style={{ color: '#7dd3fc' }}>Enter</kbd> to chat
            {' · '}<kbd style={{ color: '#7dd3fc' }}>/w</kbd> for world chat
          </div>
        )}
      </div>

      {/* Controls hint */}
      <div style={S.hint}>
        WASD / ↑↓←→ move<br />
        Mouse drag — orbit camera<br />
        Scroll — zoom<br />
        ESC — exit world
      </div>
    </div>
  );
}
