/**
 * TestingHud — circular minimap overlay with an integrated compass.
 *
 * Reads pose + mobs from the scene each animation frame and updates DOM/canvas
 * imperatively (no React re-renders) so it's cheap to leave on permanently.
 *
 * Minimap: top-right circular canvas showing the actual baked terrain (biome
 * colors) centered on the player, with POI markers, live mobs (red dots), the
 * player (triangle), and the playable-disc edge. A compass strip sits directly
 * on top of the circle showing the cardinal letters that scroll based on
 * camera-forward yaw; +/- and the mouse wheel zoom the view.
 */

import { useEffect, useRef } from 'react';
import { buildWorldMapCanvas, drawMapMarkers, locationLabelAt } from './mapRender.js';
import { mapBounds, DEFAULT_PLAYABLE_RADIUS_M } from './worldSpace.js';

// Minimap config
const MAP_SIZE_PX = 160;
const DEFAULT_VIEW_RADIUS_M = 320; // shows ~640m on each axis around the player
const MIN_VIEW_RADIUS = 80;
const MAX_VIEW_RADIUS = 520;
const BAKE_SIZE = 512;             // terrain bake resolution

// Cardinal-only compass labels positioned at 0/90/180/270 deg clockwise from +Z (south).
const COMPASS_POINTS = [
  { label: 'S', yawDeg:    0 },
  { label: 'W', yawDeg:   90 },
  { label: 'N', yawDeg:  180 },
  { label: 'E', yawDeg:  -90 },
];

export default function TestingHud({ sceneRef, visible = true, mapData = null }) {
  const compassRef = useRef(null);
  const canvasRef  = useRef(null);
  const headerRef  = useRef(null);
  const bakedRef   = useRef(null);
  const viewRadiusRef = useRef(DEFAULT_VIEW_RADIUS_M);

  useEffect(() => {
    if (!visible) return;
    const compass = compassRef.current;
    const canvas  = canvasRef.current;
    if (!compass || !canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width  = MAP_SIZE_PX * window.devicePixelRatio;
    canvas.height = MAP_SIZE_PX * window.devicePixelRatio;
    canvas.style.width  = `${MAP_SIZE_PX}px`;
    canvas.style.height = `${MAP_SIZE_PX}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Bake the terrain once (disc bounds), reused across visibility toggles.
    if (mapData && !bakedRef.current) {
      bakedRef.current = buildWorldMapCanvas(mapData.worldgen, {
        size: BAKE_SIZE,
        bounds: mapBounds(mapData.config?.radius),
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
    /* Minimap — hugs the top-right corner of the screen */
    <div
      style={{
        position:      'absolute',
        top:           '8px',
        right:         '8px',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        pointerEvents: 'auto',
        userSelect:    'none',
        zIndex:         20,
      }}
    >
      {/* Header — current location */}
      <div
        ref={headerRef}
        style={{
          marginBottom: '2px',
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
          textShadow:   '0 1px 3px rgba(0,0,0,0.85)',
        }}
      >Aurisar</div>

      {/* Compass strip — sits directly on top of the circular map */}
      <div
        ref={compassRef}
        style={{
          position:      'relative',
          width:         `${MAP_SIZE_PX}px`,
          height:        '20px',
          background:    'rgba(8, 10, 14, 0.55)',
          border:        '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius:  '8px 8px 0 0',
          overflow:      'hidden',
          fontFamily:    'monospace',
          fontSize:      '13px',
          letterSpacing: '0.05em',
          color:         'rgba(255, 255, 255, 0.92)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            display:      'block',
            borderRadius: '50%',
            border:       '2px solid rgba(240, 208, 96, 0.5)',
            boxShadow:    '0 4px 14px rgba(0,0,0,0.5)',
          }}
        />
        {/* Zoom controls */}
        <div style={{ position: 'absolute', bottom: -6, right: -6, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
    </div>
  );
}

// Imperative compass renderer — draws absolute-positioned cardinal letters
// shifted horizontally based on the camera-forward yaw. Sized to sit flush
// on top of the (equally wide) circular minimap.
function _renderCompass(host, yaw) {
  const width = MAP_SIZE_PX;
  const yawDeg = yaw * 180 / Math.PI;
  const pxPerDeg = width / 90; // 90deg of arc spans the strip
  const center = width / 2;

  let html = '';
  for (const { label, yawDeg: pYaw } of COMPASS_POINTS) {
    let delta = pYaw - yawDeg;
    while (delta > 180)  delta -= 360;
    while (delta < -180) delta += 360;
    const px = center + delta * pxPerDeg;
    if (px < -10 || px > width + 10) continue; // off-screen
    html += `<span style="position:absolute; top:3px; left:${px - 8}px; width:16px; text-align:center; color:#ffffff; font-weight:600">${label}</span>`;
  }
  html += `<span style="position:absolute; top:0; left:${center - 0.5}px; width:1px; height:20px; background:rgba(255, 220, 120, 0.85)"></span>`;
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

  // POI markers (caves / ruins / dungeon entrances), no labels at minimap scale.
  if (mapData) {
    drawMapMarkers(ctx, mapData, (x, z) => ({ px: toMapX(x), py: toMapY(z) }),
      { labels: false, w, h: w });
  }

  // World edge — the playable disc boundary, centred on the world origin (not
  // the streaming-grid box, which over-covers the world and never lined up).
  // As the player nears the rim the curve slides into view; the CSS circular
  // clip hides any overshoot.
  const discR = (mapData?.config?.radius ?? DEFAULT_PLAYABLE_RADIUS_M) * scale;
  const ex = toMapX(0), ez = toMapY(0);
  ctx.strokeStyle = 'rgba(255, 220, 80, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ex, ez, discR, 0, Math.PI * 2);
  ctx.stroke();

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
