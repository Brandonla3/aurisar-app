/**
 * AvatarPreview — isolated Babylon.js canvas for the character creator.
 *
 * Spins up its own Engine (separate from the world).
 * Accepts a live `config` prop and a `onAvatarReady` callback that exposes
 * the CharacterAvatar instance so panels can call morph/swap methods directly.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { AssetLibrary }    from '../world/game/AssetLibrary.js';
import { CharacterAvatar } from '../world/game/CharacterAvatar.js';
import { mergeConfig }     from '../world/game/avatarSchema.js';

if (typeof window !== 'undefined' && !window.BABYLON) window.BABYLON = BABYLON;

// Dedicated AssetLibrary instance for the preview scene
const PreviewAssets = {
  _containers: new Map(),
  _ready: false,

  async init(scene) {
    // Reuse the same manifest as AssetLibrary
    const { AssetLibrary: AL } = await import('../world/game/AssetLibrary.js');
    // If the world scene already loaded containers they're separate Babylon scenes —
    // preview needs its own. We do a lightweight re-init.
    this._scene = scene;
    // Import just the manifest logic
    const BASE = '/assets/characters/';
    // Mirror of AssetLibrary.js MANIFEST — keep in sync.
    // `hair_shaved` is intentionally absent: it renders as no mesh.
    const MANIFEST = {
      base_body:            'base_body.glb',
      base_body_male:       'base_body_male.glb',
      base_body_female:     'base_body_female.glb',
      'hair/hair_short':    'hair/hair_short.glb',
      'hair/hair_long':     'hair/hair_long.glb',
      'hair/hair_braids':   'hair/hair_braids.glb',
      'hair/hair_ponytail': 'hair/hair_ponytail.glb',
      'hair/hair_bun':      'hair/hair_bun.glb',
      'hair/hair_wavy':     'hair/hair_wavy.glb',
      'hair/hair_afro':     'hair/hair_afro.glb',
      'hair/hair_mohawk':   'hair/hair_mohawk.glb',
      'clothing/top_tunic':           'clothing/top_tunic.glb',
      'clothing/top_robe':            'clothing/top_robe.glb',
      'clothing/top_cloth_shirt':     'clothing/top_cloth_shirt.glb',
      'clothing/top_gambeson':        'clothing/top_gambeson.glb',
      'clothing/top_leather_vest':    'clothing/top_leather_vest.glb',
      'clothing/top_chainmail':       'clothing/top_chainmail.glb',
      'clothing/bottom_trousers':     'clothing/bottom_trousers.glb',
      'clothing/bottom_kilt':         'clothing/bottom_kilt.glb',
      'clothing/bottom_leather_pants':'clothing/bottom_leather_pants.glb',
      'clothing/bottom_breeches':     'clothing/bottom_breeches.glb',
      'clothing/bottom_cloth_skirt':  'clothing/bottom_cloth_skirt.glb',
      'clothing/bottom_leggings':     'clothing/bottom_leggings.glb',
      'clothing/shoes_boots':         'clothing/shoes_boots.glb',
      'clothing/shoes_sandals':       'clothing/shoes_sandals.glb',
      'clothing/shoes_greaves':       'clothing/shoes_greaves.glb',
      'clothing/shoes_leather_wraps': 'clothing/shoes_leather_wraps.glb',
      'species/horns_small':    'species/horns_small.glb',
      'species/horns_large':    'species/horns_large.glb',
      'species/horns_curved':   'species/horns_curved.glb',
      'species/tail_short':     'species/tail_short.glb',
      'species/tail_long':      'species/tail_long.glb',
      'species/tail_fluffy':    'species/tail_fluffy.glb',
      // Gear — populated via scripts/blender/import_armor.py pipeline. Keep
      // in sync with AssetLibrary.js MANIFEST.
    };
    const load = async (key, path) => {
      try {
        const parts = path.lastIndexOf('/');
        const dir  = parts >= 0 ? BASE + path.slice(0, parts + 1) : BASE;
        const file = parts >= 0 ? path.slice(parts + 1) : path;
        const c = await BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
        this._containers.set(key, c);
      } catch { /* asset not present yet */ }
    };
    await load('base_body', MANIFEST['base_body']);
    await Promise.all(
      Object.entries(MANIFEST)
        .filter(([k]) => k !== 'base_body')
        .map(([k, p]) => load(k, p))
    );
    this._ready = true;
  },
  getContainer(key) { return this._containers.get(key) ?? null; },
  hasBaseBody()     { return this._containers.has('base_body'); },
  dispose() { this._containers.forEach(c => c.dispose()); this._containers.clear(); },
};

export default function AvatarPreview({ config, onAvatarReady, style }) {
  const canvasRef  = useRef(null);
  const engineRef  = useRef(null);
  const avatarRef  = useRef(null);
  const sceneRef   = useRef(null);

  const rebuild = useCallback(async (scene, cfg) => {
    avatarRef.current?.dispose();
    avatarRef.current = await CharacterAvatar.create(
      'preview', '', cfg, scene, PreviewAssets
    );
    avatarRef.current.root.position.set(0, 0, 0);
    onAvatarReady?.(avatarRef.current, PreviewAssets);
  }, [onAvatarReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: true });
    engineRef.current = engine;

    const scene = new BABYLON.Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.12, 1);

    // Lighting (softer than the world — good for character inspection)
    const hemi = new BABYLON.HemisphericLight('ph', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity   = 0.8;
    hemi.groundColor = new BABYLON.Color3(0.15, 0.12, 0.20);

    const key = new BABYLON.DirectionalLight('pk', new BABYLON.Vector3(-1, -2, -1), scene);
    key.intensity = 0.6;
    key.diffuse   = new BABYLON.Color3(1, 0.95, 0.88);

    const fill = new BABYLON.DirectionalLight('pf', new BABYLON.Vector3(1, 0, 1), scene);
    fill.intensity = 0.25;
    fill.diffuse   = new BABYLON.Color3(0.6, 0.7, 1);

    // Camera — orbits the character, starts at a 3/4 angle
    const cam = new BABYLON.ArcRotateCamera('pcam',
      -Math.PI / 4, Math.PI / 3, 3.5,
      new BABYLON.Vector3(0, 1.0, 0), scene
    );
    cam.lowerRadiusLimit = 1.5;
    cam.upperRadiusLimit = 6;
    cam.lowerBetaLimit   = 0.2;
    cam.upperBetaLimit   = Math.PI / 2;
    cam.wheelPrecision   = 80;
    cam.attachControl(canvas, true);

    // Load assets then build preview avatar; pass lib alongside avatar so
    // creator panels can resolve GLB containers for live mesh swaps.
    PreviewAssets.init(scene).then(() => rebuild(scene, mergeConfig(config)));

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    engine.runRenderLoop(() => {
      if (avatarRef.current) avatarRef.current.update(engine.getDeltaTime());
      scene.render();
    });

    return () => {
      window.removeEventListener('resize', onResize);
      avatarRef.current?.dispose();
      PreviewAssets.dispose();
      engine.stopRenderLoop();
      engine.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When config changes from the outside, rebuild the avatar
  useEffect(() => {
    if (!sceneRef.current || !PreviewAssets._ready) return;
    rebuild(sceneRef.current, mergeConfig(config));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config)]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width:   '100%',
        height:  '100%',
        outline: 'none',
        ...style,
      }}
    />
  );
}
