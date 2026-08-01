/**
 * spike.js — P0 risk-retirement entry for realm-spike.html. Dev only.
 *
 * Proves, on a real GPU, the three things P0 exists to de-risk:
 *   1. The Realm engine + scene boot and hold a render loop.
 *   2. babylonjs-gui's AdvancedDynamicTexture renders text over that scene
 *      (it CANNOT be constructed headlessly — it needs OffscreenCanvas — so this
 *      page is the only place the GUI stack can actually be verified).
 *   3. The UMD global ordering survives real bundling, not just node's require.
 *
 * This file is a scaffold, not architecture. It is replaced by RealmWorld in P2.
 */

// MUST be first: establishes window.BABYLON before anything reads the ambient
// global. See src/babylonGlobal.js for why this is load-bearing.
import '../../../../../babylonGlobal.js';
import 'babylonjs-gui';

import { chooseRenderer, RENDERER_PREF } from '../../settings/rendererChoice.js';
import { createRealmEngine, bindContextLoss } from '../RealmEngine.js';
import { createRealmScene, startRenderLoop } from '../RealmScene.js';

/* global BABYLON */

const diag = document.getElementById('diag');
const lines = [];
const say = (s) => { lines.push(s); if (diag) diag.textContent = lines.join('\n'); };

async function boot() {
  const canvas = document.getElementById('realm-canvas');

  // ?renderer=webgpu opts this page into the WebGPU path for manual comparison.
  const pref = new URLSearchParams(location.search).get('renderer') ?? RENDERER_PREF.AUTO;
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const choice = chooseRenderer({ pref, hasWebGPU, isIOS });
  say(`renderer  : ${choice.renderer} (${choice.reason})`);

  const { engine, renderer, degraded } = await createRealmEngine(canvas, {
    renderer: choice.renderer,
    isMobile: window.matchMedia('(pointer: coarse)').matches,
  });
  say(`engine    : ${renderer}${degraded ? ' [degraded]' : ''}`);
  say(`babylon   : ${BABYLON.Engine.Version}`);

  bindContextLoss(engine, {
    onLost: () => say('context   : LOST'),
    onRestored: () => say('context   : restored'),
  });

  const scene = createRealmScene(engine);

  const camera = new BABYLON.ArcRotateCamera('spikeCam', -Math.PI / 2, Math.PI / 3.2, 14,
    new BABYLON.Vector3(0, 1, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 40;

  const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.6, -1, 0.4), scene);
  key.intensity = 2.2;
  const fill = new BABYLON.HemisphericLight('fill', new BABYLON.Vector3(0, 1, 0), scene);
  fill.intensity = 0.45;
  fill.groundColor = new BABYLON.Color3(0.16, 0.20, 0.15);

  // Bare geometry only — real terrain is P2. This exists so there is something
  // for the light and the fog to act on while we verify the GUI overlays it.
  const ground = BABYLON.MeshBuilder.CreateGround('spikeGround', { width: 60, height: 60, subdivisions: 24 }, scene);
  const groundMat = new BABYLON.StandardMaterial('spikeGroundMat', scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.28, 0.40, 0.26);
  groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
  ground.material = groundMat;

  const pillar = BABYLON.MeshBuilder.CreateCylinder('spikePillar', { height: 5, diameterTop: 1.1, diameterBottom: 1.6, tessellation: 9 }, scene);
  pillar.position.y = 2.5;
  const pillarMat = new BABYLON.StandardMaterial('spikePillarMat', scene);
  pillarMat.diffuseColor = new BABYLON.Color3(0.55, 0.52, 0.46);
  pillarMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  pillar.material = pillarMat;

  // ── The actual GUI risk retirement ──────────────────────────────────────────
  // babylonjs-gui attaches to the GLOBAL BABYLON namespace, never to the
  // `babylonjs` module exports. Reaching for it via a default import returns
  // undefined; this is the correct access path.
  const GUI = BABYLON.GUI;
  if (!GUI) { say('GUI       : NOT PRESENT — spike failed'); return; }

  const adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI('realmSpikeUI', true, scene);
  // Ideal-size scaling is how the HUD stays legible from a 4K desktop to a phone:
  // controls are authored once in 1280x720 space and scaled to the viewport.
  adt.idealWidth = 1280;
  adt.renderAtIdealSize = true;

  const title = new GUI.TextBlock('spikeTitle', 'AURISAR');
  title.color = '#E8C572';
  title.fontSize = 44;
  title.fontFamily = 'Georgia, serif';
  title.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  title.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  title.top = '36px';
  adt.addControl(title);

  // A health bar in the locked palette — the first pixel of the real HUD, and a
  // check that nested containers and gradients behave under renderAtIdealSize.
  const barBg = new GUI.Rectangle('spikeBarBg');
  barBg.width = '320px';
  barBg.height = '26px';
  barBg.cornerRadius = 4;
  barBg.thickness = 2;
  barBg.color = '#C8A24A';
  barBg.background = '#1A2130';
  barBg.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  barBg.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
  barBg.top = '-48px';
  adt.addControl(barBg);

  const barFill = new GUI.Rectangle('spikeBarFill');
  barFill.width = 0.72;
  barFill.height = 1;
  barFill.thickness = 0;
  barFill.background = '#4ADE80';
  barFill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  barBg.addControl(barFill);

  const barText = new GUI.TextBlock('spikeBarText', '72 / 100');
  barText.color = '#EDE9DE';
  barText.fontSize = 14;
  barText.fontFamily = 'monospace';
  barBg.addControl(barText);

  say(`GUI       : ADT ok, ${adt.getChildren()[0].children.length} root controls`);

  startRenderLoop(engine, scene, { onError: (e) => say(`render    : FAILED ${e.message}`) });
  window.addEventListener('resize', () => engine.resize());

  // Report a settled framerate so the page is self-verifying at a glance.
  setTimeout(() => say(`fps       : ${engine.getFps().toFixed(0)}`), 1500);

  // Handy for browser-side assertions during verification.
  window.__realmSpike = { engine, scene, adt };
}

boot().catch((err) => {
  say(`BOOT FAILED: ${err?.message ?? err}`);
  console.error(err);
});
