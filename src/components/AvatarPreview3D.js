import React from 'react';
import * as THREE from 'three';

/**
 * Live in-browser 3D avatar — responds instantly to every customisation option.
 * Props: gender, outfit, hairStyle, skinTone, hairColor, clsColor
 * Drag / touch to rotate.
 */
function AvatarPreview3D({ gender='male', outfit='ma_casual', hairStyle='ma_short', skinTone='mid_3', hairColor='black', clsColor='#8B6A3E' }) {
  const mountRef = React.useRef(null);

  React.useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const T = THREE;
    const W = el.clientWidth || 320;
    const H = 420;

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputEncoding = T.sRGBEncoding;
    el.appendChild(renderer.domElement);

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new T.Scene();
    scene.background = new T.Color(0x0a0804);
    scene.fog = new T.FogExp2(0x0a0804, 0.18);

    // ── Camera ────────────────────────────────────────────────────────────────
    const camera = new T.PerspectiveCamera(38, W / H, 0.05, 40);

    // ── Lights ────────────────────────────────────────────────────────────────
    scene.add(new T.AmbientLight(0xfff0d8, 0.6));

    const clsHex = parseInt((clsColor || '#8B6A3E').replace('#', ''), 16);
    const key = new T.DirectionalLight(0xfff5e0, 2.2);
    key.position.set(1.8, 5, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    scene.add(key);

    const rim = new T.DirectionalLight(clsHex, 1.8);
    rim.position.set(-1.5, 2.5, -3);
    scene.add(rim);

    const fill = new T.DirectionalLight(0xb8c8ff, 0.35);
    fill.position.set(-2, -1, 1);
    scene.add(fill);

    // ── Colour maps ───────────────────────────────────────────────────────────
    const SKIN_HEX = {
      fair_1:'#FDDBB4', fair_2:'#F5C89A', mid_1:'#E8A97C', mid_2:'#D4895C',
      mid_3:'#C0703E',  tan_1:'#A85830',  tan_2:'#8B4220', deep_1:'#6B2D10',
      deep_2:'#4A1C08', deep_3:'#2E0F04',
      orc_1:'#5A7A3A',  orc_2:'#3D5C28',  orc_3:'#8B5E3C',
      elf_1:'#C8D8C0',  elf_2:'#9ABAA0',
      stone_1:'#8C8C9A',stone_2:'#6B7B8C',iron_1:'#7A6A50',
      void_1:'#2A1A3A', gold_1:'#C8AA60',
    };
    const HAIR_HEX = {
      black:'#1A1008',    dk_brown:'#3B2010', brown:'#6B3820',      auburn:'#A05828',
      lt_brown:'#C88040', blonde:'#D4AA60',   lt_blonde:'#E8C880',  red:'#E85030',
      grey:'#B0A898',     white:'#F0EEE8',
      deep_violet:'#4A3888', forest_grn:'#2A7858', ocean_blue:'#185898',
      blood_red:'#983848',   molten_gld:'#C8A020', void_black:'#101018',
      silver_wht:'#E8E8F8',  poison_grn:'#50C840', arcane_prpl:'#7B2D8B',
      frost_blue:'#60A8D8',  ember_org:'#D84820',
    };
    const OUTFIT_COL = {
      ma_casual:   [0x4a6890, 0x5a7ea8],
      ma_sport:    [0x1a2a40, 0x2a4060],
      ma_hoodie:   [0x363636, 0x4a4a4a],
      ma_business: [0x1a1e32, 0x2a3050],
      fe_casual:   [0x7060a0, 0x9080c0],
      fe_sporty:   [0x1a3048, 0x28485a],
      fe_business: [0x20183a, 0x38285e],
    };

    const skinHex = SKIN_HEX[skinTone] || '#C0703E';
    const hairHex = HAIR_HEX[hairColor] || '#1A1008';
    const [clothBase, clothAccentCol] = OUTFIT_COL[outfit] || OUTFIT_COL.ma_casual;
    const isFemale   = gender === 'female';
    const isHoodie   = outfit === 'ma_hoodie';
    const isSport    = outfit === 'ma_sport' || outfit === 'fe_sporty';
    const isBusiness = outfit === 'ma_business' || outfit === 'fe_business';

    // ── Materials ─────────────────────────────────────────────────────────────
    const skinM      = new T.MeshPhysicalMaterial({ color: new T.Color(skinHex), roughness: 0.72, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.6 });
    const skinDeepM  = new T.MeshPhysicalMaterial({ color: new T.Color(skinHex).multiplyScalar(0.85).add(new T.Color(0.12, 0.03, 0.02)), roughness: 0.82, metalness: 0 });
    const hairM      = new T.MeshPhysicalMaterial({ color: new T.Color(hairHex), roughness: 0.45, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 });
    const clothM     = new T.MeshPhysicalMaterial({ color: new T.Color(clothBase), roughness: 0.78, metalness: 0.08 });
    const clothAccM  = new T.MeshPhysicalMaterial({ color: new T.Color(clothAccentCol), roughness: 0.45, metalness: 0.22 });
    const clsAccM    = new T.MeshPhysicalMaterial({ color: new T.Color(clsHex), roughness: 0.38, metalness: 0.3 });
    const eyeWhiteM  = new T.MeshPhysicalMaterial({ color: 0xf0ece8, roughness: 0.15, metalness: 0 });
    const eyeIrisM   = new T.MeshPhysicalMaterial({ color: 0x2a3848, roughness: 0.1,  metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
    const eyePupilM  = new T.MeshPhysicalMaterial({ color: 0x060606, roughness: 0.05, metalness: 0 });

    // ── Body proportions (gender-adjusted) ───────────────────────────────────
    const sw = isFemale ? 0.28 : 0.34;   // shoulder width
    const sh = isFemale ? 0.50 : 0.52;   // torso height
    const sd = isFemale ? 0.18 : 0.21;   // torso depth
    const lw = isFemale ? 0.068 : 0.076; // leg width
    const ar = isFemale ? 0.055 : 0.064; // arm radius
    const nk = isFemale ? 0.058 : 0.065; // neck radius
    const hipScale = isFemale ? 1.12 : 0.88;
    const sy = 1.0, sx = 1.0, hr = 0.172;

    const av = new T.Group();
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      av.add(m); return m;
    };

    // ── Torso ─────────────────────────────────────────────────────────────────
    const torsoTopY = (0.72 + sh * 0.5) * sy;
    const torsoBotY = (0.72 - sh * 0.5) * sy;
    add(new T.CylinderGeometry(sw * sx, sw * sx * (isFemale ? 0.72 : 0.78), sh * sy, 8), clothM, 0, 0.72 * sy, 0);
    add(new T.BoxGeometry(sw * sx * 1.5, 0.028 * sy, 0.025), clothAccM, 0, torsoTopY - sh * sy * 0.28, sd * sx * 0.5);

    if (isFemale) {
      [-1, 1].forEach(s => {
        const b = add(new T.SphereGeometry(0.058, 8, 7), clothM, s * 0.068, torsoTopY - sh * sy * 0.35, sd * 0.5);
        b.scale.set(1, 0.8, 0.85);
      });
    }
    if (isBusiness) {
      add(new T.CylinderGeometry(nk * 1.1, nk * 1.2, 0.06 * sy, 8), clothAccM, 0, torsoTopY + 0.01, 0);
      if (!isFemale) add(new T.BoxGeometry(0.026, sh * sy * 0.55, 0.018), clsAccM, 0, torsoTopY - sh * sy * 0.3, sd * 0.52);
    }
    if (isSport) {
      [-1, 1].forEach(s => add(new T.BoxGeometry(0.016, sh * sy * 0.6, 0.022), clsAccM, s * sw * 0.7, 0.72 * sy, sd * 0.52));
    }
    if (isHoodie) {
      add(new T.BoxGeometry(sw * 0.9, 0.06 * sy, 0.022), clothAccM, 0, torsoBotY + 0.12 * sy, sd * 0.5);
    }
    [-1, 1].forEach(s => add(new T.CylinderGeometry(0.014, 0.016, sw * 0.7, 6), skinDeepM, s * sw * 0.35, torsoTopY - 0.02 * sy, 0.04, 0, 0, Math.PI / 2));

    // ── Hips ──────────────────────────────────────────────────────────────────
    const hipY = torsoBotY;
    add(new T.CylinderGeometry(sw * hipScale * 1.1, sw * hipScale, 0.12 * sy, 8), clothM, 0, hipY, 0);

    // ── Shoulders ─────────────────────────────────────────────────────────────
    const shY = (0.72 + sh * 0.38) * sy;
    [-1, 1].forEach(s => add(new T.SphereGeometry(0.096 * (isFemale ? 0.88 : 1), 10, 8), clothM, s * sw, shY, 0));

    // ── Arms ──────────────────────────────────────────────────────────────────
    const aX = sw + 0.042;
    const uAH = 0.27 * sy, uAY = shY - uAH * 0.5 - 0.028;
    const elbow = uAY - uAH * 0.5;
    const lAH = 0.25 * sy, lAY = elbow - lAH * 0.5;
    const wristY = lAY - lAH * 0.5;

    [-1, 1].forEach(s => {
      add(new T.CylinderGeometry(ar, ar * 0.82, uAH, 8), skinM, s * aX, uAY, 0);
      add(new T.SphereGeometry(ar * 0.76, 7, 6), skinDeepM, s * aX, elbow, 0);
      add(new T.CylinderGeometry(ar * 0.78, ar * 0.64, lAH, 7), skinM, s * aX, lAY, 0);
      add(new T.SphereGeometry(ar * 0.60, 7, 6), skinM, s * aX, wristY, 0);
      add(new T.BoxGeometry(0.08, 0.09 * sy, 0.046), skinM, s * aX, wristY - 0.046 * sy, 0.004);
      add(new T.CylinderGeometry(0.015, 0.012, 0.048 * sy, 5), skinM, s * (aX + 0.03), wristY - 0.052 * sy, 0.018, 0, 0, s * 0.45);
      for (let f = 0; f < 4; f++) {
        add(new T.CylinderGeometry(0.011, 0.009, 0.045 * sy, 5), skinM, s * (aX - 0.025 + f * 0.016), wristY - 0.088 * sy, 0.008);
      }
    });

    // ── Neck ──────────────────────────────────────────────────────────────────
    const neckH = 0.11 * sy;
    add(new T.CylinderGeometry(nk, nk * 1.15, neckH, 8), skinM, 0, torsoTopY + neckH * 0.5, 0);

    // ── Head ──────────────────────────────────────────────────────────────────
    const headY = torsoTopY + neckH + hr * 0.82;
    add(new T.SphereGeometry(hr, 14, 12), skinM, 0, headY, 0).scale.set(isFemale ? 0.95 : 1, 1.05, 0.94);
    add(new T.SphereGeometry(hr * (isFemale ? 0.70 : 0.76), 10, 8), skinM, 0, headY - hr * 0.42, 0.02)
      .scale.set(isFemale ? 0.92 : 1, isFemale ? 0.58 : 0.62, 0.88);

    if (!isFemale) {
      [-1, 1].forEach(s => add(new T.CylinderGeometry(hr * 0.28, hr * 0.32, 0.018, 8), skinDeepM, s * hr * 0.32, headY + hr * 0.22, hr * 0.82, 0, 0, Math.PI / 2));
    }
    add(new T.CylinderGeometry(isFemale ? 0.013 : 0.016, isFemale ? 0.018 : 0.022, hr * 0.38, 6), skinDeepM, 0, headY - hr * 0.05, hr * 0.78, 0.18, 0, 0);
    add(new T.SphereGeometry(isFemale ? 0.020 : 0.024, 7, 6), skinDeepM, 0, headY - hr * 0.23, hr * 0.85);

    [-1, 1].forEach(s => {
      const ck = add(new T.SphereGeometry(hr * (isFemale ? 0.25 : 0.22), 7, 6), skinDeepM, s * hr * (isFemale ? 0.58 : 0.62), headY - hr * (isFemale ? 0.10 : 0.12), hr * 0.60);
      ck.scale.set(1.2, isFemale ? 0.65 : 0.7, 0.8);
    });
    add(new T.CylinderGeometry(hr * (isFemale ? 0.22 : 0.20), hr * 0.18, 0.016, 8), skinDeepM, 0, headY - hr * 0.40, hr * 0.80, 0, 0, Math.PI / 2);
    add(new T.CylinderGeometry(hr * (isFemale ? 0.19 : 0.16), hr * 0.14, 0.013, 8), skinDeepM, 0, headY - hr * 0.47, hr * 0.79, 0, 0, Math.PI / 2);
    add(new T.SphereGeometry(hr * (isFemale ? 0.12 : 0.14), 7, 6), skinDeepM, 0, headY - hr * 0.62, hr * 0.68);
    [-1, 1].forEach(s => add(new T.SphereGeometry(hr * 0.17, 7, 6), skinDeepM, s * hr * 0.95, headY - hr * 0.06, -0.01).scale.set(0.55, 0.9, 0.6));

    // ── Eyes ──────────────────────────────────────────────────────────────────
    const eyeZ = hr * 0.78, eyeY = headY + hr * 0.05, eyeX = hr * (isFemale ? 0.28 : 0.30);
    [-1, 1].forEach(s => {
      add(new T.SphereGeometry(hr * (isFemale ? 0.155 : 0.145), 9, 8), eyeWhiteM, s * eyeX, eyeY, eyeZ);
      add(new T.SphereGeometry(hr * (isFemale ? 0.098 : 0.092), 8, 7), eyeIrisM,  s * eyeX, eyeY, eyeZ + hr * 0.06);
      add(new T.SphereGeometry(hr * (isFemale ? 0.060 : 0.056), 7, 6), eyePupilM, s * eyeX, eyeY, eyeZ + hr * 0.09);
      add(new T.TorusGeometry(hr * (isFemale ? 0.122 : 0.115), 0.008, 5, 12, Math.PI), skinDeepM, s * eyeX, eyeY + hr * 0.01, eyeZ + 0.005, 0, 0, s > 0 ? 0 : Math.PI);
    });

    // ── Legs ──────────────────────────────────────────────────────────────────
    const lX = lw;
    const uLH = 0.36 * sy, uLY = hipY - 0.05 - uLH * 0.5;
    const knee = uLY - uLH * 0.5;
    const lLH = 0.34 * sy, lLY = knee - lLH * 0.5;
    const ankle = lLY - lLH * 0.5;

    [-1, 1].forEach(s => {
      add(new T.CylinderGeometry(lw, lw * 0.80, uLH, 8), clothM, s * lX, uLY, 0);
      add(new T.SphereGeometry(lw * 0.74, 8, 7), clothM, s * lX, knee, 0.01);
      add(new T.CylinderGeometry(lw * 0.76, lw * 0.58, lLH, 8), clothM, s * lX, lLY, 0);
      add(new T.SphereGeometry(lw * 0.52, 7, 6), skinM, s * lX, ankle, 0);
      add(new T.BoxGeometry(0.09, 0.058 * sy, 0.18), clothM, s * lX, ankle - 0.029 * sy, 0.04);
      add(new T.SphereGeometry(0.048, 7, 5), clothM, s * lX, ankle - 0.044 * sy, 0.13);
    });

    // ── Hair ──────────────────────────────────────────────────────────────────
    const HAIR_TYPE = {
      ma_short:'short',      ma_modern_side:'fade',  ma_surfer:'medium',
      ma_long:'long',        ma_textured:'short',    ma_mohawk:'mohawk',
      ma_braids:'braids',    ma_ponytail:'ponytail', ma_shaved:'bald',
      ma_warrior:'bun',      ma_beard_1:'short',     ma_beard_2:'short',
      fe_a_line_bob:'short', fe_long:'long',         fe_medium:'medium',
      fe_short:'fade',       fe_bob:'short',
      fe_braids:'braids',    fe_ponytail:'ponytail', fe_bun:'bun',
      fe_mohawk:'mohawk',
    };
    const hs        = HAIR_TYPE[hairStyle] || 'short';
    const hasBeard  = ['ma_beard_1', 'ma_beard_2'].includes(hairStyle);
    const beardFull = hairStyle === 'ma_beard_2';
    const hairTopY  = headY + hr * 0.72;

    if (hs !== 'bald') {
      const isLong   = hs === 'long' || hs === 'ponytail';
      const isBraids = hs === 'braids';
      const isBun    = hs === 'bun';
      const isMohawk = hs === 'mohawk';
      const isFade   = hs === 'fade';
      const isMedium = hs === 'medium';

      if (!isMohawk && !isFade && !isMedium) {
        add(new T.SphereGeometry(hr * 1.045, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.58), hairM, 0, headY, 0);
      }
      if (isFade) {
        add(new T.SphereGeometry(hr * 1.045, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.36), hairM, 0, headY + hr * 0.14, 0);
      }
      if (isMedium) {
        add(new T.SphereGeometry(hr * 1.06, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.65), hairM, 0, headY, 0);
        add(new T.CylinderGeometry(hr * 0.22, hr * 0.08, 0.18 * sy, 6), hairM, 0, headY - 0.10 * sy, -hr * 0.30, 0.15, 0, 0);
      }
      if (isMohawk) {
        add(new T.CylinderGeometry(0.022, 0.038, hr * 1.4, 5), hairM, 0, hairTopY - 0.01, 0);
      }
      if (isBun) {
        add(new T.SphereGeometry(hr * 0.34, 8, 7), hairM, 0, hairTopY + hr * 0.18, 0);
        add(new T.CylinderGeometry(hr * 0.14, hr * 0.22, hr * 0.28, 7), hairM, 0, hairTopY, 0);
      }
      if (isLong) {
        add(new T.CylinderGeometry(hr * 0.26, hr * 0.08, 0.42 * sy, 7), hairM, 0, headY - 0.18 * sy, -hr * 0.35, 0.28, 0, 0);
      }
      if (isBraids) {
        [-1, 1].forEach(s => add(new T.CylinderGeometry(0.018, 0.010, 0.32 * sy, 5), hairM, s * hr * 0.52, headY - 0.10 * sy, -hr * 0.2, 0.2, 0, s * 0.15));
      }
    }

    // ── Beard ─────────────────────────────────────────────────────────────────
    if (hasBeard) {
      add(new T.SphereGeometry(hr * (beardFull ? 0.28 : 0.22), 8, 7), hairM, 0, headY - hr * 0.60, hr * 0.5);
      if (beardFull) {
        [-1, 1].forEach(s => add(new T.CylinderGeometry(hr * 0.14, hr * 0.10, hr * 0.3, 6), hairM, s * hr * 0.38, headY - hr * 0.5, hr * 0.48, 0, 0, s * 0.2));
        add(new T.CylinderGeometry(hr * 0.10, hr * 0.08, hr * 0.28, 6), hairM, 0, headY - hr * 0.35, hr * 0.74, 0, 0, Math.PI / 2);
      }
    }

    // ── Hoodie hood ───────────────────────────────────────────────────────────
    if (isHoodie) {
      const hood = add(new T.SphereGeometry(hr * 1.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), clothM, 0, headY, -hr * 0.4);
      hood.rotation.x = 0.3;
    }

    // ── Ground / reflection ───────────────────────────────────────────────────
    const floor = new T.Mesh(new T.CircleGeometry(1.4, 24), new T.MeshPhysicalMaterial({ color: 0x0d0b08, roughness: 1, metalness: 0, transparent: true, opacity: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = ankle - 0.06 * sy; floor.receiveShadow = true;
    scene.add(floor);
    const refl = new T.Mesh(new T.CircleGeometry(0.55, 20), new T.MeshPhysicalMaterial({ color: 0x1a1408, roughness: 0.05, metalness: 0.9, opacity: 0.55, transparent: true }));
    refl.rotation.x = -Math.PI / 2; refl.position.y = floor.position.y + 0.001;
    scene.add(refl);
    scene.add(av);

    // ── Camera framing ────────────────────────────────────────────────────────
    const bbox = new T.Box3().setFromObject(av);
    const center = bbox.getCenter(new T.Vector3());
    const bH = bbox.max.y - bbox.min.y;
    camera.position.set(0, center.y + bH * 0.06, bH * 1.52);
    camera.lookAt(center);

    // ── Drag-to-rotate ────────────────────────────────────────────────────────
    let isDragging = false, lastX = 0, rotY = 0, targetRotY = 0;
    const onDown = e => { isDragging = true; lastX = (e.touches ? e.touches[0] : e).clientX; };
    const onMove = e => { if (!isDragging) return; const x = (e.touches ? e.touches[0] : e).clientX; targetRotY += (x - lastX) * 0.012; lastX = x; };
    const onUp   = () => { isDragging = false; };
    el.addEventListener('mousedown',  onDown);
    el.addEventListener('mousemove',  onMove);
    el.addEventListener('mouseup',    onUp);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchmove',  onMove, { passive: true });
    el.addEventListener('touchend',   onUp);

    // ── Render loop ───────────────────────────────────────────────────────────
    let frame, t0 = performance.now();
    const animate = ts => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min((ts - t0) / 1000, 0.05); t0 = ts;
      if (!isDragging) targetRotY += dt * 0.45;
      rotY += (targetRotY - rotY) * 0.12;
      av.rotation.y = rotY;
      renderer.render(scene, camera);
    };
    animate(t0);

    return () => {
      cancelAnimationFrame(frame);
      ['mousedown','mousemove','mouseup'].forEach(ev => el.removeEventListener(ev, ev === 'mousedown' ? onDown : ev === 'mousemove' ? onMove : onUp));
      ['touchstart','touchmove','touchend'].forEach(ev => el.removeEventListener(ev, ev === 'touchstart' ? onDown : ev === 'touchmove' ? onMove : onUp));
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); }
      });
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [gender, outfit, hairStyle, skinTone, hairColor, clsColor]);

  return React.createElement('div', {
    ref: mountRef,
    style: { width: '100%', height: 420, borderRadius: 12, overflow: 'hidden', background: '#0a0804', cursor: 'grab' },
  });
}

export default AvatarPreview3D;
export { AvatarPreview3D };
