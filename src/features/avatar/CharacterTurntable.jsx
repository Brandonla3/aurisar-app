/**
 * CharacterTurntable — lightweight auto-rotating character viewer.
 *
 * The mobile-first "review your character" surface (plan §P1): own Babylon
 * engine, soft lighting, slow idle spin that pauses while the user drags
 * (Babylon's autoRotationBehavior handles the pause/resume). Pinch/scroll
 * zoom works on touch and desktop.
 *
 * Read-only — for editing, open the full AvatarCreator.
 */

import React, { useEffect, useRef } from 'react';
// Sets window.BABYLON before babylonjs-loaders (and its decoder chunks) evaluate
// — MUST stay the first Babylon-related import. See src/babylonGlobal.js.
import BABYLON from '../../babylonGlobal.js';
import 'babylonjs-loaders';
import { createCharacterAssetCache } from '../world/game/AssetLibrary.js';
import { CharacterAvatar } from '../world/game/CharacterAvatar.js';
import { mergeConfig }     from '../world/game/avatarSchema.js';

export default function CharacterTurntable({ config, style }) {
  const canvasRef = useRef(null);
  const avatarRef = useRef(null);
  const sceneRef  = useRef(null);
  const assetsRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: true });
    const scene = new BABYLON.Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.12, 1);

    const hemi = new BABYLON.HemisphericLight('tt_h', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity   = 0.85;
    hemi.groundColor = new BABYLON.Color3(0.15, 0.12, 0.20);
    const key = new BABYLON.DirectionalLight('tt_k', new BABYLON.Vector3(-1, -2, -1), scene);
    key.intensity = 0.55;
    key.diffuse   = new BABYLON.Color3(1, 0.95, 0.88);

    const cam = new BABYLON.ArcRotateCamera('tt_cam',
      -Math.PI / 4, Math.PI / 2.6, 3.2,
      new BABYLON.Vector3(0, 0.95, 0), scene);
    cam.lowerRadiusLimit = 1.6;
    cam.upperRadiusLimit = 5.5;
    cam.lowerBetaLimit   = 0.3;
    cam.upperBetaLimit   = Math.PI / 1.9;
    cam.wheelPrecision   = 80;
    cam.attachControl(canvas, true);
    // Slow idle spin; pauses on user interaction, resumes after a beat.
    cam.useAutoRotationBehavior = true;
    cam.autoRotationBehavior.idleRotationSpeed = 0.35;
    cam.autoRotationBehavior.idleRotationWaitTime = 1500;
    cam.autoRotationBehavior.idleRotationSpinupTime = 800;

    const assets = createCharacterAssetCache();
    assetsRef.current = assets;
    let cancelled = false;
    assets.init(scene).then(async () => {
      if (cancelled) return;
      avatarRef.current = await CharacterAvatar.create(
        'turntable', '', mergeConfig(config), scene, assets,
      );
      if (cancelled) { avatarRef.current?.dispose(); return; }
      avatarRef.current.root.position.set(0, 0, 0);
    });

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    engine.runRenderLoop(() => {
      if (avatarRef.current) avatarRef.current.update(engine.getDeltaTime());
      scene.render();
    });

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      avatarRef.current?.dispose();
      assets.dispose();
      engine.stopRenderLoop();
      engine.dispose();
    };
  // Rebuild handled by the config effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the avatar when config changes from outside.
  useEffect(() => {
    const scene = sceneRef.current;
    const assets = assetsRef.current;
    if (!scene || !assets?.isReady()) return;
    let cancelled = false;
    (async () => {
      const next = await CharacterAvatar.create(
        'turntable', '', mergeConfig(config), scene, assets,
      );
      if (cancelled) { next.dispose(); return; }
      avatarRef.current?.dispose();
      avatarRef.current = next;
      next.root.position.set(0, 0, 0);
    })();
    return () => { cancelled = true; };
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
        touchAction: 'none',
        borderRadius: 12,
        ...style,
      }}
    />
  );
}
