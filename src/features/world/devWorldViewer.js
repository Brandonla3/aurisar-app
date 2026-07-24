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
import { sunElevationDeg } from './game/atmosphereState.js';

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
    // ?tier=high|low|mobile — force a quality tier (QA of the terrain shader
    // permutations); default lets the scene auto-detect from device caps.
    qualityTier:    params.get('tier') || undefined,
    // The dev viewer + headless screenshot harness run under software WebGL on
    // purpose; never let a context loss reload the page out from under them.
    autoRecoverGraphics: false,
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

// Console access for debugging + the handle headless screenshot/QA harnesses
// use to drive the camera under software WebGL.
window.__worldScene = scene;

// ?preset=mountain|forest|castle|dungeon — dev-only: swap all streamed ground
// tiles onto a non-default terrain preset once they exist, for shader/visual
// QA of createTerrainMaterial's preset system (the live tile provider itself
// never requests a preset — presets are for future dungeon/castle/mountain
// zones, so nothing else exercises this path yet).
const presetParam = params.get('preset');
if (presetParam) {
  import('./game/terrainMaterial.js').then(({ createTerrainMaterial }) => {
    const presetMat = createTerrainMaterial(scene.scene, {
      tier: scene._qualityTier,
      preset: presetParam,
    });
    const swap = setInterval(() => {
      const tiles = scene.scene.meshes.filter((m) => /^tile_.*_ground$/.test(m.name));
      if (!tiles.length) return;
      clearInterval(swap);
      for (const t of tiles) t.material = presetMat;
    }, 300);
  });
}

// ?nav=1 — subsampled walkability overlay once the castle is built (dev only).
if (params.has('nav')) {
  const navLevel = parseInt(params.get('navLevel') ?? '1', 10);
  const poll = setInterval(() => {
    if (!scene._castle?._built) return;
    clearInterval(poll);
    scene._castle.showNavDebug(true, Number.isFinite(navLevel) ? navLevel : 1);
  }, 400);
}

// ?qa=1 — Atmosphere-QA overlay. Reproducible states for the Batch 3
// visual-acceptance matrix: freeze/scrub the time of day, force weather wetness,
// toggle volumetric clouds + the high-tier shadow autoCalcDepthBounds, and read
// out the shared AtmosphereState (sun elevation, sun visibility, aerial facing
// weight, fog RGB/density, tier) plus FPS and real GPU frame time — so the
// shadow toggle's cost can be measured on/off. Opt-in so it never appears in the
// default/headless screenshot harness.
function mountAtmosphereQA(worldScene) {
  // Idempotent: a second call (viewer remount / double-invoke in dev) must not
  // stack a second panel + polling interval. Bail if one is already mounted.
  if (document.getElementById('atmo-qa')) return () => {};
  const bScene = worldScene.scene;
  const panel = document.createElement('div');
  panel.id = 'atmo-qa';
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:10;font:11px/1.6 ui-monospace,monospace;' +
    'color:#dfe;background:rgba(10,14,20,0.82);padding:8px 10px;border-radius:6px;min-width:230px';

  const title = document.createElement('div');
  title.textContent = 'Atmosphere QA';
  title.style.cssText = 'font-weight:700;margin-bottom:6px;letter-spacing:0.04em';
  panel.appendChild(title);

  const row = (labelText, control) => {
    const r = document.createElement('label');
    r.style.cssText = 'display:flex;align-items:center;gap:8px;margin:3px 0;justify-content:space-between';
    const s = document.createElement('span'); s.textContent = labelText; s.style.opacity = '0.85';
    r.append(s, control); panel.appendChild(r); return r;
  };
  const slider = (min, max, step) => {
    const el = document.createElement('input');
    Object.assign(el, { type: 'range', min: String(min), max: String(max), step: String(step) });
    el.style.flex = '1'; return el;
  };
  const check = () => { const el = document.createElement('input'); el.type = 'checkbox'; return el; };

  // Time of day (scrubbing implies freeze, so the chosen light holds).
  const timeSlider = slider(0, 24, 0.25); timeSlider.value = String(worldScene.getTimeOfDay());
  const freezeBox = check();
  row('time (h)', timeSlider);
  row('freeze time', freezeBox);
  timeSlider.oninput = () => { freezeBox.checked = true; worldScene.setTimeOfDay(+timeSlider.value, true); };
  freezeBox.onchange = () => {
    if (freezeBox.checked) worldScene.setTimeOfDay(+timeSlider.value, true);
    else worldScene.setDayNightFrozen(false);
  };

  // Weather wetness (force pins it against the random wet/dry cycle).
  const wetSlider = slider(0, 1, 0.05);
  const forceWetBox = check();
  row('wet', wetSlider);
  row('force wet', forceWetBox);
  let forcedWet = null;
  const applyWet = () => { forcedWet = +wetSlider.value; forceWetBox.checked = true; };
  wetSlider.oninput = applyWet;
  forceWetBox.onchange = () => {
    if (forceWetBox.checked) { applyWet(); return; }
    forcedWet = null;
    const w = bScene.metadata?.ashwood?.weather;
    if (w) w.weatherTimer = 0; // let the cycle re-roll immediately
  };

  // Volumetric clouds (high tier only; a no-op elsewhere).
  const volBox = check();
  volBox.checked = !!bScene.metadata?.ashwood?.volumetricClouds;
  row('volumetric clouds', volBox);
  volBox.onchange = () => worldScene.setVolumetricClouds?.(volBox.checked);

  // Shadow cascade depth-bounds fit (high-tier CSM only). Toggle to measure the
  // on/off cost against the GPU frame-time readout below — the acceptance check
  // the #276 review asked for before this ships enabled.
  const shadowGen = worldScene._shadowGen;
  const csm = shadowGen && 'autoCalcDepthBounds' in shadowGen ? shadowGen : null;
  const acdbBox = check();
  acdbBox.checked = !!csm?.autoCalcDepthBounds;
  acdbBox.disabled = !csm;
  row('autoCalcDepthBounds', acdbBox);
  acdbBox.onchange = () => { if (csm) csm.autoCalcDepthBounds = acdbBox.checked; };

  // GPU frame-time instrumentation (needs EXT_disjoint_timer_query; present on
  // most desktop browsers). Real GPU ms, not just FPS — so the shadow toggle's
  // cost is measurable rather than inferred.
  const instr = new BABYLON.EngineInstrumentation(worldScene.engine);
  instr.captureGPUFrameTime = true;
  const gpuMs = () => {
    const ns = instr.gpuFrameTimeCounter?.lastSecAverage ?? 0;
    return ns > 0 ? (ns / 1e6).toFixed(2) : '—';
  };

  const out = document.createElement('pre');
  out.style.cssText = 'margin:6px 0 0;white-space:pre';
  panel.appendChild(out);
  document.body.appendChild(panel);

  const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—');
  const timer = setInterval(() => {
    const md = bScene.metadata?.ashwood;
    const atmo = md?.atmosphere;
    const weather = md?.weather;
    if (forcedWet != null && weather) {
      weather.wet = forcedWet; weather.wetTarget = forcedWet; weather.weatherTimer = 1e9;
    } else if (weather && !forceWetBox.checked) {
      wetSlider.value = String(weather.wet);
    }
    if (!freezeBox.checked) timeSlider.value = String(worldScene.getTimeOfDay());
    const fc = atmo?.fogColor;
    const rgb = fc
      ? `${Math.round(fc.r * 255)},${Math.round(fc.g * 255)},${Math.round(fc.b * 255)}`
      : '—';
    out.textContent =
      `time    ${f2(worldScene.getTimeOfDay())} h\n` +
      `sun el  ${f2(sunElevationDeg(atmo?.sunDir))}°\n` +
      `sun vis ${f2(atmo?.sunVisibility)}\n` +
      `facing  ${f2(atmo?.facingWeight)}\n` +
      `fog rgb ${rgb}\n` +
      `fog den ${atmo ? f2(atmo.fogDensity) : '—'}\n` +
      `tier    ${md?.qualityTier ?? '—'}\n` +
      `fps     ${worldScene.engine.getFps().toFixed(0)}\n` +
      `gpu     ${gpuMs()} ms`;
  }, 200);

  return () => { clearInterval(timer); instr.dispose(); panel.remove(); };
}

// Expose the cleanup so the overlay can be torn down from the console in dev.
if (params.has('qa')) window.__atmoQACleanup = mountAtmosphereQA(scene);
