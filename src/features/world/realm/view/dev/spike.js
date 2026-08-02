/**
 * spike.js — dev entry for realm-spike.html. P2: the first walkable world.
 *
 * WASD + shift-sprint over streamed procedural terrain, chase camera, and the
 * P0 GUI overlay still proving ADT works. Wiring is the same shape RealmWorld
 * will formalise: sample input → fixed-step the pure walker → copy the result
 * onto transforms. Rendering never advances the simulation.
 *
 * Still a scaffold, not architecture — replaced by RealmWorld when the facade
 * lands. Dev/preview builds only, never production.
 */

// MUST be first: establishes window.BABYLON before anything reads the ambient
// global. See src/babylonGlobal.js for why this is load-bearing.
import '../../../../../babylonGlobal.js';
import 'babylonjs-gui';

import { chooseRenderer, RENDERER_PREF } from '../../settings/rendererChoice.js';
import { createRealmEngine, bindContextLoss } from '../RealmEngine.js';
import { createRealmScene, startRenderLoop } from '../RealmScene.js';
import { createTerrainField } from '../../model/terrainField.js';
import { TerrainStreamer } from '../terrain/TerrainStreamer.js';
import { buildTerrainMaterial } from '../materials/terrainNME.js';
import { buildSkyDomeMaterial, createSkyDome } from '../materials/skyDomeNME.js';
import { buildHorizonRings } from '../materials/horizonRingNME.js';
import { RING_TIERS } from '../../model/horizonRings.js';
import { FogDriver } from '../atmosphere/FogDriver.js';
import { createWalkerState, integrateWalker } from '../../model/walker.js';
import {
  BUTTON, createInputSnapshot, resetInputSnapshot, setButton,
} from '../../sim/InputSnapshot.js';

/* global BABYLON */

const diag = document.getElementById('diag');
const SIM_STEP_MS = 1000 / 60;

async function boot() {
  const canvas = document.getElementById('realm-canvas');

  const pref = new URLSearchParams(location.search).get('renderer') ?? RENDERER_PREF.AUTO;
  const choice = chooseRenderer({
    pref,
    hasWebGPU: typeof navigator !== 'undefined' && !!navigator.gpu,
    isIOS: /iP(hone|ad|od)/.test(navigator.userAgent),
  });

  const { engine, renderer, canvas: liveCanvas, degraded } = await createRealmEngine(canvas, {
    renderer: choice.renderer,
    isMobile: window.matchMedia('(pointer: coarse)').matches,
  });
  bindContextLoss(engine, {
    onLost: () => console.warn('[spike] context lost'),
    onRestored: () => console.warn('[spike] context restored'),
  });

  // ?syncshaders=1 — automated-verification escape hatch. Babylon finalizes
  // parallel-compiled shaders on the real rAF frame loop; a hidden tab (or a
  // driver pumping scene.render() manually) never polls it, so effects stay
  // "not ready" forever with a perfectly linked program, and meshes silently
  // skip drawing. Cost: shader compiles block the main thread. Dev page only.
  if (new URLSearchParams(location.search).has('syncshaders')) {
    engine.getCaps().parallelShaderCompile = undefined;
  }

  const scene = createRealmScene(engine);

  // ── Lights ──────────────────────────────────────────────────────────────────
  // Lights exist here; their direction/tint/intensity are OWNED by the
  // FogDriver from P4 on — one skyState evaluation drives fog, dome, and
  // lights together so they can never disagree about what moment it is.
  const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.55, -1, 0.35), scene);
  key.intensity = 1.25;
  const fill = new BABYLON.HemisphericLight('fill', new BABYLON.Vector3(0, 1, 0), scene);
  fill.intensity = 0.3;
  fill.groundColor = new BABYLON.Color3(0.16, 0.20, 0.15);

  // ── Atmosphere (P4a): dome + the single-writer FogDriver ───────────────────
  const { material: skyMat, applyState: applyDomeState } = await buildSkyDomeMaterial(scene);
  createSkyDome(scene, skyMat);

  // ── Horizon rings (P4b): crag silhouettes painted by elevation, not fog ────
  // Never wired into scene.fogDensity — a near-tuned density (needed to hide
  // the streamed terrain's edge, in P4a's design) can never wash these out,
  // because there was never a distance-extinction term for it to saturate.
  // Chunk pop-in concealment now comes from TerrainStreamer's own fade-in
  // (model/chunkFade.js) instead, which is what frees fog to be tuned purely
  // for mood. Both readers — dome and rings — are driven by the SAME
  // per-frame skyState below; composed here as one applyDomeState closure so
  // FogDriver stays the single writer with multiple readers, not a second one.
  const ringKit = await buildHorizonRings(scene, RING_TIERS);
  const applyAtmosphereState = (s) => { applyDomeState(s); ringKit.applyState(s); };

  // ?timewarp=40 compresses the 40-min cycle into one minute for verification.
  const timewarp = Number(new URLSearchParams(location.search).get('timewarp')) || 1;
  const fogDriver = new FogDriver(scene, {
    sunLight: key,
    ambientLight: fill,
    applyDomeState: applyAtmosphereState,
  }, { timeScale: timewarp });

  // ── Terrain ─────────────────────────────────────────────────────────────────
  // P3: the painted NodeMaterial — slope/height splat + noise variation,
  // authored once in BSL, transpiled to whichever backend this page runs on.
  const field = createTerrainField();
  const groundMat = await buildTerrainMaterial(scene);
  const streamer = new TerrainStreamer(scene, field, { radius: 3, material: groundMat });

  // ── Player: a capsule with a nose so facing is visible ─────────────────────
  let walker = createWalkerState(0, 0, field);
  const playerRoot = new BABYLON.TransformNode('playerRoot', scene);
  const body = BABYLON.MeshBuilder.CreateCapsule('playerBody', { height: 1.8, radius: 0.38 }, scene);
  body.parent = playerRoot;
  body.position.y = 0.9;
  const bodyMat = new BABYLON.StandardMaterial('playerMat', scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.78, 0.63, 0.29);
  bodyMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  body.material = bodyMat;
  const nose = BABYLON.MeshBuilder.CreateCylinder('playerNose', { height: 0.45, diameterTop: 0, diameterBottom: 0.3, tessellation: 8 }, scene);
  nose.parent = playerRoot;
  nose.position.set(0, 1.4, 0.5);
  nose.rotation.x = Math.PI / 2;
  nose.material = bodyMat;

  // ── Chase camera ────────────────────────────────────────────────────────────
  const camera = new BABYLON.ArcRotateCamera('chase', -Math.PI / 2, Math.PI / 3.1, 11,
    new BABYLON.Vector3(0, 1.4, 0), scene);
  camera.attachControl(liveCanvas, true);
  camera.lowerRadiusLimit = 3.5;
  camera.upperRadiusLimit = 28;
  camera.lowerBetaLimit = 0.25;
  camera.upperBetaLimit = 1.5;
  camera.wheelDeltaPercentage = 0.05;
  camera.panningSensibility = 0; // pan would detach the chase target

  // ── Input sampling (keyboard → InputSnapshot) ──────────────────────────────
  const keys = new Set();
  window.addEventListener('keydown', (e) => { keys.add(e.code); });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => keys.clear()); // alt-tab must not stick a key

  const snapshot = createInputSnapshot();
  function sampleInput() {
    resetInputSnapshot(snapshot);
    snapshot.seq += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) snapshot.moveZ += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) snapshot.moveZ -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) snapshot.moveX += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) snapshot.moveX -= 1;
    setButton(snapshot, BUTTON.SPRINT, keys.has('ShiftLeft') || keys.has('ShiftRight'));
    // ArcRotate alpha → the walker's yaw convention (forward = (sin θ, cos θ)).
    snapshot.yaw = Math.atan2(-Math.cos(camera.alpha), -Math.sin(camera.alpha));
    return snapshot;
  }

  // ── Fixed-step sim, variable-rate render ───────────────────────────────────
  let accumulator = 0;
  let lastMs = performance.now();
  scene.onBeforeRenderObservable.add(() => {
    const nowMs = performance.now();
    // Spiral guard: a background tab returning owes thousands of steps; cap it.
    accumulator = Math.min(accumulator + (nowMs - lastMs), 250);
    lastMs = nowMs;

    while (accumulator >= SIM_STEP_MS) {
      walker = integrateWalker(walker, sampleInput(), SIM_STEP_MS, field);
      accumulator -= SIM_STEP_MS;
    }

    // One skyState per frame drives fog + clear + dome + lights, atomically.
    fogDriver.update(nowMs);

    playerRoot.position.set(walker.x, walker.y, walker.z);
    playerRoot.rotation.y = walker.yaw;
    // Chase: ease the camera target to the player's head.
    camera.target.x += (walker.x - camera.target.x) * 0.18;
    camera.target.y += (walker.y + 1.4 - camera.target.y) * 0.18;
    camera.target.z += (walker.z - camera.target.z) * 0.18;

    // nowMs stamps newly-born chunks and ramps every still-fading chunk's
    // visibility (model/chunkFade.js) — structural pop-in concealment.
    streamer.update(walker.x, walker.z, nowMs);
  });

  // ── GUI (the P0 ADT proof, kept) ───────────────────────────────────────────
  const GUI = BABYLON.GUI;
  const adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI('realmSpikeUI', true, scene);
  adt.idealWidth = 1280;
  adt.renderAtIdealSize = true;
  const title = new GUI.TextBlock('spikeTitle', 'AURISAR');
  title.color = '#E8C572';
  title.fontSize = 40;
  title.fontFamily = 'Georgia, serif';
  title.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  title.top = '28px';
  adt.addControl(title);
  const hint = new GUI.TextBlock('spikeHint', 'WASD move · Shift sprint · drag to orbit · wheel to zoom');
  hint.color = '#94A3B8';
  hint.fontSize = 14;
  hint.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
  hint.top = '-16px';
  adt.addControl(hint);

  startRenderLoop(engine, scene, { onError: (e) => { diag.textContent = `RENDER FAILED: ${e.message}`; } });
  window.addEventListener('resize', () => engine.resize());

  // ── Diag readout ────────────────────────────────────────────────────────────
  setInterval(() => {
    if (!diag) return;
    diag.textContent = [
      `renderer  : ${renderer}${degraded ? ' [degraded]' : ''} (${choice.reason})`,
      `pos       : ${walker.x.toFixed(1)}, ${walker.y.toFixed(1)}, ${walker.z.toFixed(1)}`,
      `speed     : ${walker.speedMps.toFixed(1)} m/s`,
      `chunks    : ${streamer.residentCount()} resident${streamer.isSettledVisually() ? '' : ' (fading)'}`,
      `sky       : ${fogDriver.state?.fogDensity != null ? fogDriver.state.fogDensity.toFixed(4) : '?'} fog`,
      `rings     : ${ringKit.meshes.length}`,
      `fps       : ${engine.getFps().toFixed(0)}`,
    ].join('\n');
  }, 250);

  window.__realmSpike = {
    engine, scene, adt, field, streamer, camera, fogDriver, ringKit, getWalker: () => walker,
  };
}

boot().catch((err) => {
  if (diag) diag.textContent = `BOOT FAILED: ${err?.message ?? err}`;
  console.error(err);
});
