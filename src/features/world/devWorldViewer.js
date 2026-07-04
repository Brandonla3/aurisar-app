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
// ?pos=140,20 — spawn position override (e.g. the Castle Ashwood approach)
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

// Spawn override once the avatar exists (castle testing: ?pos=140,20).
const posParam = params.get('pos');
if (posParam) {
  const [px, pz] = posParam.split(',').map(Number);
  if (Number.isFinite(px) && Number.isFinite(pz)) {
    const t = setInterval(() => {
      const root = scene._local?.root;
      if (!root) return;
      clearInterval(t);
      root.position.set(px, scene._worldgen.surfaceY(px, pz), pz);
      scene._camera.target.copyFrom(root.position);
    }, 100);
  }
}

// Tiny telemetry loop: position, terrain height, biome, fps, draw calls.
setInterval(() => {
  const p = scene._local?.root?.position;
  if (!p) return;
  const wg = scene._worldgen;
  const fps = scene.engine.getFps().toFixed(0);
  const inside = scene._castle?.isInside?.() ?? false;
  hud.textContent =
    `pos   ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}\n` +
    `biome ${inside ? 'Castle Ashwood' : wg.biomeAt(p.x, p.z).name}\n` +
    `fps   ${fps}\n` +
    `mesh  ${scene.scene.getActiveMeshes().length} active / ${scene.scene.meshes.length}\n` +
    `light ${scene.scene.lights.length}\n` +
    `cam   r=${scene._camera.radius.toFixed(2)} ` +
    `user=${scene._camUserRadius?.toFixed(2) ?? '-'} ` +
    `wrote=${scene._lastCamWritten?.toFixed(2) ?? '-'}\n` +
    `      a=${scene._camera.alpha.toFixed(2)} b=${scene._camera.beta.toFixed(2)} ` +
    `bLim=${scene._camera.lowerBetaLimit?.toFixed(2)}..${scene._camera.upperBetaLimit?.toFixed(2)}`;
}, 250);

window.__worldScene = scene; // console access for debugging

// ?nav=1 — subsampled walkability overlay once the castle is built (dev only).
if (params.has('nav')) {
  const navLevel = parseInt(params.get('navLevel') ?? '1', 10);
  const poll = setInterval(() => {
    if (!scene._castle?._built) return;
    clearInterval(poll);
    scene._castle.showNavDebug(true, Number.isFinite(navLevel) ? navLevel : 1);
  }, 400);
}
