/**
 * devWorldViewer — standalone Ashwood world viewer (dev only).
 *
 *   npm run dev → http://localhost:5173/world-viewer.html
 *
 * Mounts BabylonWorldScene directly with no auth, no SpacetimeDB and no
 * React, for fast terrain/texture/render iteration and side-by-side
 * comparison against /reference/ashwood.html. Multiplayer callbacks are
 * no-ops — exactly what the scene sees when the connection is down.
 *
 * Not referenced by the app bundle; vite only serves world-viewer.html in
 * dev (it is not a build input).
 */

import BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { BabylonWorldScene } from './game/BabylonWorldScene.js';

if (typeof window !== 'undefined' && !window.BABYLON) {
  window.BABYLON = BABYLON;
}

const canvas = document.getElementById('world-canvas');
const hud = document.getElementById('hud');

// ?tod=17.5 — start time of day (default mid-morning for pleasant light)
// ?daylen=1200 — seconds per full day (default the prototype's 20-min cycle)
const params = new URLSearchParams(location.search);
const scene = new BabylonWorldScene(
  canvas,
  { username: 'viewer', classType: 'warrior', avatarColor: '#88aaff', avatarConfig: null },
  {}, // callbacks: onMove etc. — all optional, all no-ops here
  {
    startTimeOfDay: parseFloat(params.get('tod') ?? '10.5'),
    dayLengthSec:   parseFloat(params.get('daylen') ?? '1200'),
  },
);

// Tiny telemetry loop: position, terrain height, biome, fps, draw calls.
setInterval(() => {
  const p = scene._local?.root?.position;
  if (!p) return;
  const wg = scene._worldgen;
  const fps = scene.engine.getFps().toFixed(0);
  hud.textContent =
    `pos   ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}\n` +
    `biome ${wg.biomeAt(p.x, p.z).name}\n` +
    `fps   ${fps}`;
}, 250);

window.__worldScene = scene; // console access for debugging
