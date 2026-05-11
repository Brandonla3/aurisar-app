/**
 * TestingHud — compass strip + minimap overlay.
 *
 * Pure testing aid for the 2km world. Reads pose + mobs from the scene
 * each animation frame and updates DOM/canvas imperatively (no React
 * re-renders) so it's cheap to leave on permanently.
 *
 * Compass: top-center horizontal strip showing cardinal letters that
 * scroll based on camera-forward yaw.
 * Minimap: top-right 160px canvas showing the 8x8 tile grid, the player
 * (triangle at center, rotated to camera heading), live mobs (red dots),
 * and the world bounds.
 */

import { useEffect, useRef } from 'react';
import {
  streamingParams,
  worldToTile,
} from './streaming/index.js';
import worldBuildConfig from './config/world_build_config.json';

// Coordinate constants shared with BabylonWorldScene.
const SCALE = 32;
const STDB_CENTER = 1600;

// Minimap config
const MAP_SIZE_PX = 160;
const MAP_VIEW_RADIUS_M = 320; // shows ~640m on each axis around the player

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

export default function TestingHud({ sceneRef }) {
  const compassRef = useRef(null);
  const canvasRef  = useRef(null);
  const coordsRef  = useRef(null);

  useEffect(() => {
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

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const scene = sceneRef.current;
      if (!scene) return;
      const pose = scene.getPose?.();
      if (!pose) return;

      _renderCompass(compass, pose.yaw);
      _renderMinimap(ctx, pose, scene.getMobs?.() ?? []);
      _renderCoords(coords, pose);
    };
    raf = requestAnimationFrame(render);

    return () => cancelAnimationFrame(raf);
  }, [sceneRef]);

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
      {/* Minimap — top right */}
      <div
        style={{
          position:     'absolute',
          top:          '12px',
          right:        '12px',
          padding:      '6px',
          background:   'rgba(8, 10, 14, 0.55)',
          border:       '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: '6px',
          pointerEvents:'none',
          userSelect:   'none',
          zIndex:       20,
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
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
  // yaw: radians, 0 = +Z (south, looking back at start), positive = clockwise.
  // We want letters to scroll left as the camera rotates right.
  const yawDeg = yaw * 180 / Math.PI;
  const pxPerDeg = 220 / 90; // 90deg of arc spans the strip
  const center = 220 / 2;

  let html = '';
  for (const { label, yawDeg: pYaw } of COMPASS_POINTS) {
    // Shortest delta in [-180, 180]
    let delta = pYaw - yawDeg;
    while (delta > 180)  delta -= 360;
    while (delta < -180) delta += 360;
    const px = center + delta * pxPerDeg;
    if (px < -10 || px > 230) continue; // off-screen
    const isCardinal = label.length === 1;
    html += `<span style="position:absolute; top:6px; left:${px - 8}px; width:16px; text-align:center; color:${isCardinal ? '#ffffff' : 'rgba(255,255,255,0.55)'}; font-weight:${isCardinal ? 600 : 400}">${label}</span>`;
  }
  // Center tick mark
  html += `<span style="position:absolute; top:0; left:${center - 0.5}px; width:1px; height:28px; background:rgba(255, 220, 120, 0.85)"></span>`;
  host.innerHTML = html;
}

function _renderMinimap(ctx, pose, mobs) {
  const w = MAP_SIZE_PX;
  ctx.clearRect(0, 0, w, w);

  // World-units to map-pixels: 1 world unit per (MAP_SIZE_PX / 2) / MAP_VIEW_RADIUS_M
  const worldUnitsPerMeter = 1; // current tiling uses world unit ≈ 1m
  const halfMap = w / 2;
  const scale = (halfMap) / (MAP_VIEW_RADIUS_M * worldUnitsPerMeter);

  const toMapX = (wx) => halfMap + (wx - pose.x) * scale;
  const toMapY = (wz) => halfMap + (wz - pose.z) * scale;

  // Background tint — faint green for grass
  ctx.fillStyle = 'rgba(28, 48, 22, 0.65)';
  ctx.fillRect(0, 0, w, w);

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

  // World bounds — slightly brighter outline
  ctx.strokeStyle = 'rgba(255, 220, 120, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    toMapX(PARAMS.minX),
    toMapY(PARAMS.minZ),
    PARAMS.tileSize * PARAMS.cols * scale,
    PARAMS.tileSize * PARAMS.rows * scale,
  );

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
  ctx.rotate(-pose.yaw); // canvas Y is down; we negate so triangle points where the camera faces
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
  host.textContent = `${tile} · (${pose.x.toFixed(0)}, ${pose.z.toFixed(0)})`;
}
