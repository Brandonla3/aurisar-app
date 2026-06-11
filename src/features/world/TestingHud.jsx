/**
 * TestingHud — compass strip + minimap overlay.
 *
 * Reads pose + mobs from the scene each animation frame and updates DOM/canvas
 * imperatively (no React re-renders) so it's cheap to leave on permanently.
 *
 * Compass: top-center horizontal strip showing cardinal letters that scroll
 * based on camera-forward yaw.
 * Minimap: top-right canvas showing the actual baked terrain (biome colors)
 * centered on the player, with the 8x8 tile grid, POI markers, live mobs (red
 * dots), the player (triangle), and the world bounds. A header shows the
 * player's current location; +/- and the mouse wheel zoom the view.
 */

import { useEffect, useRef } from 'react';
import {
  streamingParams,
  worldToTile,
} from './streaming/index.js';
import worldBuildConfig from './config/world_build_config.json';
import { buildWorldMapCanvas, drawMapMarkers, locationLabelAt } from './mapRender.js';

// Minimap config
const MAP_SIZE_PX = 160;
const DEFAULT_VIEW_RADIUS_M = 320; // shows ~640m on each axis around the player
const MIN_VIEW_RADIUS = 80;
const MAX_VIEW_RADIUS = 520;
const BAKE_SIZE = 512;             // terrain bake resolution

const PARAMS = streamingParams(worldBuildConfig);

// 8-point compass labels positioned at 0/45/90/... deg clockwise from +Z (south).
const COMPASS_POINTS = [
  { label: 'S',  yawDeg:    0 },
  { label: 'SW', yawDeg:   45 },
  { label: 'W',  yawDeg:   90 },
  { label: 'NW', yawDeg:  135 },
  { label: 'N',  yawDeg:  180 },
  { label: 'NE', yawDeg: -135 },
  { label: 'E',  yawDeg:  -90 },
  { label: 'SE', yawDeg:  -45 },
];

export default function TestingHud({ sceneRef, visible = true, mapData = null }) {
  const compassRef = useRef(null);
  const canvasRef  = useRef(null);
  const coordsRef  = useRef(null);
  const headerRef  = useRef(null);
  const bakedRef   = useRef(null);
  const viewRadiusRef = useRef(DEFAULT_VIEW_RADIUS_M);

  useEffect(() => {
    if (!visible) return;
    const compass = compassRef.current;
    const canvas  = canvasRef.current;
    const coords  = coordsRef.current;
    if (!compass || !canvas || !coords) return;

    const ctx = canvas.getContext('2d');
    canvas.width  = MAP_SIZE_PX * window.devicePixelRatio;
    canvas.height = MAP_SIZE_PX * window.devicePixelRatio;
    canvas.style.width  = `${MAP_SIZE_PX}px`;
    canvas.style.height = `${MAP_SIZE_PX}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Bake the terrain once (disc bounds), reused across visibility toggles.
    if (mapData && !bakedRef.current) {
      const r = mapData.config?.radius ?? 520;
      bakedRef.current = buildWorldMapCanvas(mapData.worldgen, {
        size: BAKE_SIZE,
        bounds: { minX: -r, minZ: -r, maxX: r, maxZ: r },
      });
    }

    // Wheel zoom over the minimap.
    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRadiusRef.current;
      const next = e.deltaY < 0 ? v / 1.2 : v * 1.2;
      viewRadiusRef.current = Math.max(MIN_VIEW_RADIUS, Math.min(MAX_VIEW_RADIUS, next));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const scene = sceneRef.current;
      if (!scene) return;
      const pose = scene.getPose?.();
      if (!pose) return;

      _renderCompass(compass, pose.yaw);
      _renderMinimap(ctx, pose, scene.getMobs?.() ?? [], {
        baked: bakedRef.current,
        viewRadius: viewRadiusRef.current,
        mapData,
      });
      _renderCoords(coords, pose);
      if (headerRef.current) {
        const loc = scene.getLocation?.()
          || (mapData && locationLabelAt(mapData.worldgen, pose.x, pose.z));
        headerRef.current.textContent = loc || 'Aurisar';
      }
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [sceneRef, visible, mapData]);

  if (!visible) return null;

  const zoomBtn = {
    width: 22, height: 22, lineHeight: '20px', textAlign: 'center',
    background: 'rgba(30,41,59,0.92)', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 5, color: '#e2e8f0', fontSize: 14, cursor: 'pointer', padding: 0,
    fontFamily: 'monospace',
  };

  return (
    <>
      {/* Compass strip — top center */}
      <div
        ref={compassRef}
        style={{
          position:      'absolute',
          top:           '12px',
          left:          '50%',
          transform:     'translateX(-50%)',
          width:         '220px',
          height:        '28px',
          background:    'rgba(8, 10, 14, 0.55)',
          border:        '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius:  '6px',
          overflow:      'hidden',
          fontFamily:    'monospace',
          fontSize:      '14px',
          letterSpacing: '0.05em',
          color:         'rgba(255, 255, 255, 0.92)',
          pointerEvents: 'none',
          userSelect:    'none',
          zIndex:        20,
        }}
      />
      {/* Minimap — top right, nudged below the Exit button */}
      <div
        style={{
          position:     'absolute',
          top:          '64px',
          right:        '12px',
          padding:      '6px',
          background:   'rgba(8, 10, 14, 0.55)',
          border:       '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: '6px',
          pointerEvents:'auto',
          userSelect:   'none',
          zIndex:        20,
        }}
      >
        {/* Header — current location */}
        <div
          ref={headerRef}
          style={{
            marginBottom: '4px',
            fontFamily:   'Cinzel, Inter, serif',
            fontSize:     '11px',
            fontWeight:   700,
            color:        '#f0d060',
            textAlign:    'center',
            letterSpacing:'0.03em',
            maxWidth:     `${MAP_SIZE_PX}px`,
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
        >Aurisar</div>
        <div style={{ position: 'relative' }}>
          <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 4 }} />
          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: 4, right: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              style={zoomBtn}
              aria-label="Zoom in minimap"
              onClick={() => { viewRadiusRef.current = Math.max(MIN_VIEW_RADIUS, viewRadiusRef.current / 1.3); }}
            >＋</button>
            <button
              style={zoomBtn}
              aria-label="Zoom out minimap"
              onClick={() => { viewRadiusRef.current = Math.min(MAX_VIEW_RADIUS, viewRadiusRef.current * 1.3); }}
            >－</button>
          </div>
        </div>
        <div
          ref={coordsRef}
          style={{
            marginTop:  '4px',
            fontFamily: 'monospace',
            fontSize:   '10px',
            color:      'rgba(255, 255, 255, 0.78)',
            textAlign:  'center',
          }}
        />
      </div>
    </>
  );
}

// Imperative compass renderer — draws absolute-positioned cardinal letters
// shifted horizontally based on the camera-forward yaw.
function _renderCompass(host, yaw) {
  const yawDeg = yaw * 180 / Math.PI;
  const pxPerDeg = 220 / 90; // 90deg of arc spans the strip
  const center = 220 / 2;

  let html = '';
  for (const { label, yawDeg: pYaw } of COMPASS_POINTS) {
    let delta = pYaw - yawDeg;
    while (delta > 180)  delta -= 360;
    while (delta < -180) delta += 360;
    const px = center + delta * pxPerDeg;
    if (px < -10 || px > 230) continue; // off-screen
    const isCardinal = label.length === 1;
    html += `<span style="position:absolute; top:6px; left:${px - 8}px; width:16px; text-align:center; color:${isCardinal ? '#ffffff' : 'rgba(255,255,255,0.55)'}; font-weight:${isCardinal ? 600 : 400}">${label}</span>`;
  }
  html += `<span style="position:absolute; top:0; left:${center - 0.5}px; width:1px; height:28px; background:rgba(255, 220, 120, 0.85)"></span>`;
  host.innerHTML = html;
}

function _renderMinimap(ctx, pose, mobs, { baked, viewRadius, mapData }) {
  const w = MAP_SIZE_PX;
  ctx.clearRect(0, 0, w, w);

  const halfMap = w / 2;
  const scale = halfMap / viewRadius;

  const toMapX = (wx) => halfMap + (wx - pose.x) * scale;
  const toMapY = (wz) => halfMap + (wz - pose.z) * scale;

  // ── Terrain ──
  // Void backdrop first (covers out-of-disc regions near the world edge).
  ctx.fillStyle = 'rgba(14, 16, 22, 1)';
  ctx.fillRect(0, 0, w, w);

  if (baked) {
    // Source crop of the baked disc for the current player-centered window,
    // clamped to the baked canvas so edges don't smear.
    const B = baked.size;
    const tl = baked.worldToPx(pose.x - viewRadius, pose.z - viewRadius);
    const br = baked.worldToPx(pose.x + viewRadius, pose.z + viewRadius);
    const sxSpan = br.px - tl.px;
    const sySpan = br.py - tl.py;
    const cx0 = Math.max(0, tl.px), cy0 = Math.max(0, tl.py);
    const cx1 = Math.min(B, br.px), cy1 = Math.min(B, br.py);
    if (cx1 > cx0 && cy1 > cy0 && sxSpan > 0 && sySpan > 0) {
      const dx0 = ((cx0 - tl.px) / sxSpan) * w;
      const dy0 = ((cy0 - tl.py) / sySpan) * w;
      const dx1 = ((cx1 - tl.px) / sxSpan) * w;
      const dy1 = ((cy1 - tl.py) / sySpan) * w;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(baked.canvas, cx0, cy0, cx1 - cx0, cy1 - cy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
    }
  } else {
    // Fallback tint until the bake is ready.
    ctx.fillStyle = 'rgba(28, 48, 22, 0.65)';
    ctx.fillRect(0, 0, w, w);
  }

  // Tile grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let row = 0; row <= PARAMS.rows; row++) {
    const wz = PARAMS.minZ + row * PARAMS.tileSize;
    const my = toMapY(wz);
    if (my < -2 || my > w + 2) continue;
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(w, my);
    ctx.stroke();
  }
  for (let col = 0; col <= PARAMS.cols; col++) {
    const wx = PARAMS.minX + col * PARAMS.tileSize;
    const mx = toMapX(wx);
    if (mx < -2 || mx > w + 2) continue;
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, w);
    ctx.stroke();
  }

  // POI markers (caves / ruins / dungeon entrances), no labels at minimap scale.
  if (mapData) {
    drawMapMarkers(ctx, mapData, (x, z) => ({ px: toMapX(x), py: toMapY(z) }),
      { labels: false, w, h: w });
  }

  // World bounds — bold yellow on visible borders + thin off-screen indicators.
  const boundsX0 = toMapX(PARAMS.minX);
  const boundsZ0 = toMapY(PARAMS.minZ);
  const boundsX1 = toMapX(PARAMS.maxX);
  const boundsZ1 = toMapY(PARAMS.maxZ);

  ctx.strokeStyle = 'rgba(255, 220, 80, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (boundsX0 >= 0 && boundsX0 <= w) {
    ctx.moveTo(boundsX0, Math.max(0, boundsZ0));
    ctx.lineTo(boundsX0, Math.min(w, boundsZ1));
  }
  if (boundsX1 >= 0 && boundsX1 <= w) {
    ctx.moveTo(boundsX1, Math.max(0, boundsZ0));
    ctx.lineTo(boundsX1, Math.min(w, boundsZ1));
  }
  if (boundsZ0 >= 0 && boundsZ0 <= w) {
    ctx.moveTo(Math.max(0, boundsX0), boundsZ0);
    ctx.lineTo(Math.min(w, boundsX1), boundsZ0);
  }
  if (boundsZ1 >= 0 && boundsZ1 <= w) {
    ctx.moveTo(Math.max(0, boundsX0), boundsZ1);
    ctx.lineTo(Math.min(w, boundsX1), boundsZ1);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 220, 80, 0.30)';
  const indicatorPx = 3;
  if (boundsX0 < 0) ctx.fillRect(0, 0, indicatorPx, w);
  if (boundsX1 > w) ctx.fillRect(w - indicatorPx, 0, indicatorPx, w);
  if (boundsZ0 < 0) ctx.fillRect(0, 0, w, indicatorPx);
  if (boundsZ1 > w) ctx.fillRect(0, w - indicatorPx, w, indicatorPx);

  // Mobs — red dots, faded if dead
  for (const m of mobs) {
    const mx = toMapX(m.x);
    const my = toMapY(m.z);
    if (mx < -4 || mx > w + 4 || my < -4 || my > w + 4) continue;
    ctx.fillStyle = m.dead
      ? 'rgba(220, 80, 80, 0.30)'
      : 'rgba(255, 70, 70, 0.95)';
    ctx.beginPath();
    ctx.arc(mx, my, m.dead ? 2.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player — triangle at center, rotated to camera yaw
  ctx.save();
  ctx.translate(halfMap, halfMap);
  ctx.rotate(-pose.yaw);
  ctx.fillStyle = 'rgba(120, 200, 255, 0.95)';
  ctx.strokeStyle = 'rgba(10, 20, 30, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function _renderCoords(host, pose) {
  const tile = worldToTile(pose.x, pose.z, PARAMS);
  const distW = Math.max(0, pose.x - PARAMS.minX);
  const distE = Math.max(0, PARAMS.maxX - pose.x);
  const distN = Math.max(0, pose.z - PARAMS.minZ);
  const distS = Math.max(0, PARAMS.maxZ - pose.z);
  const nearest = Math.min(distW, distE, distN, distS);
  host.innerHTML = `<div>${tile} · (${pose.x.toFixed(0)}, ${pose.z.toFixed(0)})</div>` +
    `<div style="opacity:0.7">edge: ${Math.round(nearest)}m</div>`;
}
