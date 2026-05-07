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
    const MANIFEST = {
      base_body:          'base_body.glb',
      'hair/hair_short':  'hair/hair_short.glb',
      'hair/hair_long':   'hair/hair_long.glb',
      'hair/hair_braids': 'hair/hair_braids.glb',
      'clothing/top_casual':    'clothing/top_casual.glb',
      'clothing/top_hoodie':    'clothing/top_hoodie.glb',
      'clothing/bottom_jeans':  'clothing/bottom_jeans.glb',
      'clothing/bottom_shorts': 'clothing/bottom_shorts.glb',
      'clothing/shoes_boots':   'clothing/shoes_boots.glb',
      'species/horns_small':    'species/horns_small.glb',
      'species/horns_large':    'species/horns_large.glb',
      'species/horns_curved':   'species/horns_curved.glb',
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
    onAvatarReady?.(avatarRef.current);
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

    // Load assets then build preview avatar
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
