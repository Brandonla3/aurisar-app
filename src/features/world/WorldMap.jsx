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
import { FONT, ghostBtn } from './ui/panelTheme.js';

const BAKE_SIZE = 640;     // terrain bake resolution (drawImage scales it up)
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 6;

// Combined bounds so the disc AND the eastern dungeons fit, kept square+centred
// so the round world isn't distorted.
function combinedBounds(config) {
  const radius = config.radius ?? 520;
  let maxX = radius;
  const interiors = config.interiors ?? {};
  for (const k of Object.keys(interiors)) maxX = Math.max(maxX, interiors[k].cx ?? 0);
  maxX += 120; // padding past the furthest dungeon
  let minX = -radius, minZ = -radius, maxZ = radius;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const half = Math.max(maxX - minX, maxZ - minZ) / 2;
  return { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
}

export default function WorldMap({ mapData, sceneRef, onClose }) {
  const canvasRef = useRef(null);
  const headerRef = useRef(null);
  const bakedRef = useRef(null);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef(null);

  useEffect(() => {
    if (!mapData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bounds = combinedBounds(mapData.config);
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

      // Player marker (triangle to heading). Matches TestingHud's convention.
      const pose = sceneRef.current?.getPose?.();
      if (pose) {
        const p = project(pose.x, pose.z);
        ctx.save();
        ctx.translate(p.px, p.py);
        ctx.rotate(-pose.yaw);
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

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={ghostBtn} onClick={() => zoomBy(1.3)} aria-label="Zoom in">＋</button>
        <button style={ghostBtn} onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">－</button>
        <button style={ghostBtn} onClick={reset}>Reset</button>
        <button style={ghostBtn} onClick={onClose}>Close</button>
      </div>

      <p style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>
        Scroll or use ＋ / － to zoom · drag to pan · Esc to close
      </p>
    </div>
  );
}
