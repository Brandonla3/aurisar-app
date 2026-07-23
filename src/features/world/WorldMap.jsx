/**
 * WorldMap — full-screen top-down map of the world.
 *
 * Paints the real terrain (shared bake from mapRender), labels the named zones
 * (Wildwood / the Mountain / Mirrormere) and dungeons (Hollow Deep / Frostspire
 * Halls), plots cave + ruin markers, and shows the player's live position and
 * heading. Supports wheel/buttons zoom and drag pan. A header shows the
 * player's current location.
 *
 * The terrain canvas is baked ONCE and cached; zoom/pan only change the
 * drawImage transform + the marker/player projector — no re-bake.
 */

import React, { useEffect, useRef } from 'react';
import { buildWorldMapCanvas, drawMapMarkers } from './mapRender.js';
import { mapBounds } from './worldSpace.js';
import { FONT, ghostBtn } from './ui/panelTheme.js';

const BAKE_SIZE = 640;     // terrain bake resolution (drawImage scales it up)
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 6;

// Clamp a projected point to the map's inner border along the ray from center,
// so off-canvas things — the player inside a teleport interior (x≥840), or the
// off-disc dungeon anchors — become directional edge indicators instead of
// silently vanishing once the map is framed to the playable disc.
function clampToEdge(px, py, w, h, margin = 14) {
  const cx = w / 2, cy = h / 2;
  if (px >= margin && px <= w - margin && py >= margin && py <= h - margin) {
    return { x: px, y: py, clamped: false, angle: 0 };
  }
  const dx = px - cx, dy = py - cy;
  const hw = w / 2 - margin, hh = h / 2 - margin;
  const scale = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale, clamped: true, angle: Math.atan2(dy, dx) };
}

// Small centered pill (used for the "Locating…" state while the avatar loads).
function drawPill(ctx, cx, cy, text) {
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pw = ctx.measureText(text).width + 20, ph = 22, r = 6;
  const x = cx - pw / 2, y = cy - ph / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + pw, y, x + pw, y + ph, r);
  ctx.arcTo(x + pw, y + ph, x, y + ph, r);
  ctx.arcTo(x, y + ph, x, y, r);
  ctx.arcTo(x, y, x + pw, y, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10, 16, 26, 0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(190, 219, 255, 0.95)';
  ctx.fillText(text, cx, cy);
}

// World Map marker legend (icon color → meaning), rendered as DOM under the map.
const LEGEND = [
  { c: 'rgba(120,200,255,0.98)', t: 'You' },
  { c: 'rgba(96,165,250,0.95)', t: 'Players' },
  { c: 'rgba(120,220,130,0.95)', t: 'NPCs' },
  { c: 'rgba(130,210,240,0.95)', t: 'Places' },
  { c: 'rgba(240,210,120,0.98)', t: 'Castle' },
  { c: 'rgba(230,190,90,0.75)', t: 'Chests' },
  { c: 'rgba(168,120,255,0.95)', t: 'Dungeons' },
];

export default function WorldMap({ mapData, sceneRef, onClose }) {
  const canvasRef = useRef(null);
  const headerRef = useRef(null);
  const bakedRef = useRef(null);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef(null);
  const closeBtnRef = useRef(null);

  // Dialog focus management: focus Close on open, restore focus on close.
  useEffect(() => {
    const prev = document.activeElement;
    closeBtnRef.current?.focus?.();
    return () => { if (prev instanceof HTMLElement) prev.focus?.(); };
  }, []);

  useEffect(() => {
    if (!mapData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Frame the map to the playable disc (the round world), NOT the far-off
    // teleport-only dungeon interiors — those become off-map markers in a later
    // batch. This keeps the player centred on the actual world instead of
    // squished into one half beside a large void.
    const bounds = mapBounds(mapData.config?.radius);
    const baked = buildWorldMapCanvas(mapData.worldgen, { size: BAKE_SIZE, bounds });
    bakedRef.current = baked;

    const ctx = canvas.getContext('2d');
    let raf = 0;

    // Size the canvas to a square that fits the viewport.
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const css = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.82);
      canvas.style.width = `${css}px`;
      canvas.style.height = `${css}px`;
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas._cssSize = css;
    };
    fit();
    window.addEventListener('resize', fit);

    const render = () => {
      raf = requestAnimationFrame(render);
      const size = canvas._cssSize;
      const { zoom, panX, panY } = viewRef.current;
      const base = size / BAKE_SIZE;       // scale to fit baked square into view
      const s = base * zoom;

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#0e1016';
      ctx.fillRect(0, 0, size, size);

      // Terrain (single scaled blit).
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(baked.canvas, panX, panY, BAKE_SIZE * s, BAKE_SIZE * s);

      // world -> display projector
      const project = (x, z) => {
        const bp = baked.worldToPx(x, z);
        return { px: bp.px * s + panX, py: bp.py * s + panY };
      };

      drawMapMarkers(ctx, mapData, project, { labels: true, w: size, h: size, font: 12 });

      // Off-map indicators for teleport-only interiors (they sit outside the
      // disc, so disc framing culls them). Labeled chevrons on the border;
      // index-offset since all three share the eastern direction (cz=0).
      const interiors = mapData.config?.interiors ?? {};
      const offMap = Object.values(interiors)
        .map((d) => ({ d, p: project(d.cx, d.cz) }))
        .filter(({ p }) => p.px < 0 || p.px > size || p.py < 0 || p.py > size);
      offMap.forEach(({ d, p }, i) => {
        const e = clampToEdge(p.px, p.py, size, size, 20);
        const y = Math.max(16, Math.min(size - 16, e.y + (i - (offMap.length - 1) / 2) * 16));
        ctx.save();
        ctx.translate(e.x, y);
        ctx.rotate(e.angle + Math.PI / 2);
        ctx.fillStyle = 'rgba(168, 120, 255, 0.95)';
        ctx.strokeStyle = 'rgba(10, 8, 20, 0.9)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(0, -6); ctx.lineTo(4.5, 4); ctx.lineTo(-4.5, 4); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
        if (d.name) {
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.textAlign = e.x > size / 2 ? 'right' : 'left';
          ctx.textBaseline = 'middle';
          const lx = e.x > size / 2 ? e.x - 10 : e.x + 10;
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(d.name, lx, y);
          ctx.fillStyle = '#d7c4ff';
          ctx.fillText(d.name, lx, y);
        }
      });

      // Other players in this instance — cyan dots + names, edge-clamped when
      // off the disc (e.g. co-located in a teleport interior).
      const remotes = sceneRef.current?.getRemotes?.() ?? [];
      for (const rp of remotes) {
        const bp = project(rp.x, rp.z);
        const e = clampToEdge(bp.px, bp.py, size, size);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.clamped ? 3 : 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(96, 165, 250, 0.95)';
        ctx.strokeStyle = 'rgba(10, 20, 40, 0.9)';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        if (rp.name && !e.clamped) {
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(rp.name, e.x, e.y - 8);
          ctx.fillStyle = '#bfdbfe';
          ctx.fillText(rp.name, e.x, e.y - 8);
        }
      }

      // Player marker. On-map: triangle to heading (matches the minimap).
      // Off-map (e.g. inside a teleport interior): clamp to the border and point
      // toward the true position + draw a ring, so the player is never lost.
      // While the avatar is still loading (pose null): a "Locating…" pill.
      const pose = sceneRef.current?.getPose?.();
      if (pose) {
        const p = project(pose.x, pose.z);
        const e = clampToEdge(p.px, p.py, size, size);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.clamped ? e.angle + Math.PI / 2 : -pose.yaw);
        ctx.fillStyle = 'rgba(120, 200, 255, 0.98)';
        ctx.strokeStyle = 'rgba(10, 20, 30, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(6, 7);
        ctx.lineTo(-6, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        if (e.clamped) {
          ctx.beginPath();
          ctx.arc(e.x, e.y, 11, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else {
        // Avatar still loading — show a "Locating…" pill instead of an absent
        // player marker (terrain + markers already render).
        drawPill(ctx, size / 2, size / 2, 'Locating…');
      }

      // Header location readout (imperative — no React re-render).
      const loc = sceneRef.current?.getLocation?.();
      if (headerRef.current && loc != null) {
        headerRef.current.textContent = loc || 'Aurisar';
      }
    };
    raf = requestAnimationFrame(render);

    // ── Zoom (wheel, toward cursor) ──
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const v = viewRef.current;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const factor = next / v.zoom;
      v.panX = cx - (cx - v.panX) * factor;
      v.panY = cy - (cy - v.panY) * factor;
      v.zoom = next;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ── Pan (drag) ──
    const onDown = (e) => {
      dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id) return;
      const v = viewRef.current;
      v.panX += e.clientX - d.x;
      v.panY += e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
    };
    const onUp = (e) => {
      if (dragRef.current && e.pointerId === dragRef.current.id) dragRef.current = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [mapData, sceneRef]);

  const zoomBy = (mult) => {
    const v = viewRef.current;
    const size = canvasRef.current?._cssSize ?? 0;
    const c = size / 2;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * mult));
    const factor = next / v.zoom;
    v.panX = c - (c - v.panX) * factor;
    v.panY = c - (c - v.panY) * factor;
    v.zoom = next;
  };
  const reset = () => { viewRef.current = { zoom: 1, panX: 0, panY: 0 }; };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="World Map"
      style={{
        position: 'absolute', inset: 0, zIndex: 95,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2, 6, 14, 0.78)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        fontFamily: FONT,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <span style={{ fontFamily: 'Cinzel, serif', fontSize: 20, fontWeight: 700, color: '#f0d060' }}>
          World Map
        </span>
        <span style={{ color: '#94a3b8', fontSize: 13 }}>·</span>
        <span ref={headerRef} style={{ color: '#7dd3fc', fontSize: 14, fontWeight: 600 }}>Aurisar</span>
      </div>

      <canvas
        ref={canvasRef}
        style={{
          display: 'block', borderRadius: 12, cursor: 'grab',
          border: '1px solid rgba(148,163,184,0.3)',
          boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
          touchAction: 'none',
        }}
      />

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10, maxWidth: '92vw' }}>
        {LEGEND.map(({ c, t }) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#94a3b8', fontSize: 11 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c, border: '1px solid rgba(0,0,0,0.4)' }} />
            {t}
          </span>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={ghostBtn} onClick={() => zoomBy(1.3)} aria-label="Zoom in">＋</button>
        <button style={ghostBtn} onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">－</button>
        <button style={ghostBtn} onClick={reset}>Reset</button>
        <button ref={closeBtnRef} style={ghostBtn} onClick={onClose}>Close</button>
      </div>

      <p style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>
        Scroll or use ＋ / － to zoom · drag to pan · Esc to close
      </p>
    </div>
  );
}
