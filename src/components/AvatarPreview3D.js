import React from 'react';
import * as THREE from 'three';

function AvatarPreview3D({race, bodyType, skinTone, hairColor, hairStyle, facePreset, clsColor, clsKey}) {
  const mountRef = React.useRef(null);

  React.useEffect(()=>{
    const el = mountRef.current;
    if(!el || !window.THREE) return;
    const T = window.THREE;
    const W = el.clientWidth || 320;
    const H = 420;

    // ── Renderer ────────────────────────────────────────────────
    const renderer = new T.WebGLRenderer({antialias:true, alpha:false, powerPreference:"high-performance"});
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputEncoding = T.sRGBEncoding;
    el.appendChild(renderer.domElement);

    // ── Scene ────────────────────────────────────────────────────
    const scene = new T.Scene();
    scene.background = new T.Color(0x0a0804);
    scene.fog = new T.FogExp2(0x0a0804, 0.18);

    // ── Camera ───────────────────────────────────────────────────
    const camera = new T.PerspectiveCamera(38, W/H, 0.05, 40);

    // ── Lights ───────────────────────────────────────────────────
    // Ambient fill
    scene.add(new T.AmbientLight(0xfff0d8, 0.6));

    // Key light — warm, casts shadows
    const key = new T.DirectionalLight(0xfff5e0, 2.2);
    key.position.set(1.8, 5, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far  = 20;
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top   =  2;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    // Rim light — class color, from behind
    const clsHex = parseInt((clsColor||'#b4ac9e').replace('#',''), 16);
    const rim = new T.DirectionalLight(clsHex, 1.8);
    rim.position.set(-1.5, 2.5, -3);
    scene.add(rim);

    // Subtle cool fill from below
    const fill = new T.DirectionalLight(0xb8c8ff, 0.35);
    fill.position.set(-2, -1, 1);
    scene.add(fill);

    // ── Materials ────────────────────────────────────────────────
    // Skin tones map
    const SKIN_HEX = {
      fair_1:'#FDDBB4', fair_2:'#F5C89A', mid_1:'#E8A97C',
      mid_2:'#D4895C',  mid_3:'#C0703E',  tan_1:'#A85830',
      tan_2:'#8B4220',  deep_1:'#6B2D10', deep_2:'#4A1C08',
      deep_3:'#2E0F04', orc_1:'#5A7A3A',  orc_2:'#3D5C28',
      orc_3:'#8B5E3C',  stone_1:'#8C8C9A',stone_2:'#6B7B8C',
      iron_1:'#7A6A50',
    };
    const HAIR_HEX = {
      black:'#1A1008',   dk_brown:'#3B2010', brown:'#6B3820',
      auburn:'#A05828',  lt_brown:'#C88040', blonde:'#D4AA60',
      lt_blonde:'#E8C880',red:'#E85030',     grey:'#B0A898',
      white:'#F0EEE8',   deep_violet:'#4A3888', forest_grn:'#2A7858',
      ocean_blue:'#185898', blood_red:'#983848', molten_gld:'#C8A020',
      void_black:'#101018', silver_wht:'#E8E8F8',
    };

    const skinHex = SKIN_HEX[skinTone] || '#C0703E';
    const hairHex = HAIR_HEX[hairColor] || '#1A1008';
    const skinCol = new T.Color(skinHex);
    const hairCol = new T.Color(hairHex);

    // MeshPhysicalMaterial for skin — subsurface scattering approximation
    const skinM = new T.MeshPhysicalMaterial({
      color: skinCol,
      roughness: 0.72,
      metalness: 0.0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
    });
    // Slightly warmer sub-skin color simulating SSS
    const skinDeepM = new T.MeshPhysicalMaterial({
      color: new T.Color(skinHex).multiplyScalar(0.85).add(new T.Color(0.12,0.03,0.02)),
      roughness: 0.82,
      metalness: 0.0,
    });
    const hairM = new T.MeshPhysicalMaterial({
      color: hairCol,
      roughness: 0.45,
      metalness: 0.0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
    });
    const clsCol = new T.Color(clsHex);
    const clothM = new T.MeshPhysicalMaterial({
      color: clsCol.clone().multiplyScalar(0.55),
      roughness: 0.78,
      metalness: 0.08,
    });
    const clothAccentM = new T.MeshPhysicalMaterial({
      color: clsCol.clone().multiplyScalar(0.8),
      roughness: 0.45,
      metalness: 0.22,
    });
    const eyeWhiteM = new T.MeshPhysicalMaterial({color:0xf0ece8, roughness:0.15, metalness:0});
    const eyeIrisM  = new T.MeshPhysicalMaterial({color:0x2a3848, roughness:0.1,  metalness:0, clearcoat:1, clearcoatRoughness:0.05});
    const eyePupilM = new T.MeshPhysicalMaterial({color:0x060606, roughness:0.05, metalness:0});
    const teethM    = new T.MeshPhysicalMaterial({color:0xe8e0d0, roughness:0.35, metalness:0, clearcoat:0.4});
    const nailM     = new T.MeshPhysicalMaterial({color:new T.Color(skinHex).multiplyScalar(1.1), roughness:0.25, metalness:0, clearcoat:0.7});

    // ── Race & body configs ─────────────────────────────────────
    const BC = {
      lean:    {sw:0.26,sh:0.50,sd:0.16,lw:0.060,ar:0.050,nk:0.055},
      wiry:    {sw:0.28,sh:0.52,sd:0.17,lw:0.063,ar:0.052,nk:0.058},
      athletic:{sw:0.34,sh:0.52,sd:0.21,lw:0.076,ar:0.064,nk:0.065},
      stocky:  {sw:0.40,sh:0.48,sd:0.25,lw:0.088,ar:0.076,nk:0.075},
      powerful:{sw:0.48,sh:0.52,sd:0.27,lw:0.100,ar:0.086,nk:0.085},
      massive: {sw:0.57,sh:0.56,sd:0.32,lw:0.118,ar:0.100,nk:0.098},
    };
    const RC = {
      human:    {y:1.00,x:1.00,headR:1.00},
      elf:      {y:1.14,x:0.87,headR:0.93},
      dwarf:    {y:0.78,x:1.18,headR:1.08},
      orc:      {y:1.06,x:1.20,headR:1.12},
      fae:      {y:0.92,x:0.78,headR:0.88},
      halfgiant:{y:1.28,x:1.24,headR:1.15},
      golem:    {y:1.06,x:1.07,headR:1.05},
    };
    const bc = BC[bodyType]||BC.athletic;
    const rc = RC[race]||RC.human;
    const sx = rc.x, sy = rc.y, hr = 0.172 * sx * rc.headR;

    const av = new T.Group();
    const add = (geo, mat, x, y, z, rx=0, ry=0, rz=0) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x,y,z);
      m.rotation.set(rx,ry,rz);
      m.castShadow = true;
      m.receiveShadow = true;
      av.add(m);
      return m;
    };

    // ── Torso system ────────────────────────────────────────────
    const torsoTopY   = (0.72 + bc.sh*0.5) * sy;
    const torsoBotY   = (0.72 - bc.sh*0.5) * sy;
    const torsoMidY   = (torsoTopY + torsoBotY) * 0.5;

    // Torso — tapered box (wider shoulders, narrower waist)
    const torsoGeo = new T.CylinderGeometry(bc.sw*sx, bc.sw*sx*0.78, bc.sh*sy, 8);
    add(torsoGeo, clothM, 0, 0.72*sy, 0);

    // Chest definition line / pec ridge (subtle raised strip)
    const pecGeo = new T.BoxGeometry(bc.sw*sx*1.5, 0.028*sy, 0.025);
    add(pecGeo, clothAccentM, 0, torsoTopY-bc.sh*sy*0.28, bc.sd*sx*0.5);

    // Clavicles (exposed bone area — skin above cloth)
    [-1,1].forEach(side=>{
      add(new T.CylinderGeometry(0.014,0.016,bc.sw*sx*0.7,6), skinDeepM,
          side*bc.sw*sx*0.35, torsoTopY-0.02*sy, 0.04, 0,0, Math.PI/2);
    });

    // ── Hips ────────────────────────────────────────────────────
    const hipY = torsoBotY;
    add(new T.CylinderGeometry(bc.sw*sx*0.88, bc.sw*sx*0.84, 0.12*sy, 8), clothM, 0, hipY, 0);

    // ── Shoulders ───────────────────────────────────────────────
    const shY = (0.72+bc.sh*0.38)*sy;
    const shR = 0.096*sx;
    [-1,1].forEach(side=>{
      add(new T.SphereGeometry(shR, 10, 8), clothM, side*bc.sw*sx, shY, 0);
    });

    // ── Arms ────────────────────────────────────────────────────
    const aX = (bc.sw + 0.042)*sx;
    const uAH = 0.27*sy;
    const uAY = shY - uAH*0.5 - 0.028;
    const elbow = uAY - uAH*0.5;
    const lAH = 0.25*sy;
    const lAY = elbow - lAH*0.5;
    const wristY = lAY - lAH*0.5;

    [-1,1].forEach(side=>{
      // Upper arm — bicep taper
      add(new T.CylinderGeometry(bc.ar*sx, bc.ar*0.82*sx, uAH, 8), skinM, side*aX, uAY, 0);
      // Elbow bump
      add(new T.SphereGeometry(bc.ar*0.76*sx, 7, 6), skinDeepM, side*aX, elbow, 0);
      // Forearm
      add(new T.CylinderGeometry(bc.ar*0.78*sx, bc.ar*0.64*sx, lAH, 7), skinM, side*aX, lAY, 0);
      // Wrist
      add(new T.SphereGeometry(bc.ar*0.60*sx, 7, 6), skinM, side*aX, wristY, 0);
      // Hand — palm
      add(new T.BoxGeometry(0.08*sx, 0.09*sy, 0.046*sx), skinM, side*aX, wristY-0.046*sy, 0.004);
      // Thumb stub
      add(new T.CylinderGeometry(0.015*sx,0.012*sx,0.048*sy,5), skinM,
          side*(aX + 0.03*sx), wristY-0.052*sy, 0.018, 0,0,side*0.45);
      // Finger stubs (4 grouped)
      for(let f=0;f<4;f++){
        add(new T.CylinderGeometry(0.011*sx,0.009*sx,0.045*sy,5), skinM,
            side*(aX-0.025*sx+f*0.016*sx), wristY-0.088*sy, 0.008);
      }
    });

    // ── Neck ────────────────────────────────────────────────────
    const neckBot = torsoTopY;
    const neckH   = 0.11*sy;
    add(new T.CylinderGeometry(bc.nk*sx, bc.nk*sx*1.15, neckH, 8), skinM, 0, neckBot+neckH*0.5, 0);

    // ── Head ────────────────────────────────────────────────────
    const headY = neckBot + neckH + hr*0.82;

    // Cranium — squash sphere for less ball-like head
    const headGeo = new T.SphereGeometry(hr, 14, 12);
    const headMesh = add(headGeo, skinM, 0, headY, 0);
    headMesh.scale.set(1, 1.05, 0.94); // slightly taller, less deep

    // Jaw / lower face (flatter ovoid below midline)
    const jawGeo = new T.SphereGeometry(hr*0.76, 10, 8);
    const jawM = add(jawGeo, skinM, 0, headY - hr*0.42, 0.02);
    jawM.scale.set(1, 0.62, 0.88);

    // Brow ridge
    const browGeo = new T.CylinderGeometry(hr*0.28, hr*0.32, 0.018, 8);
    [-1,1].forEach(side=>{
      add(browGeo, skinDeepM, side*hr*0.32, headY+hr*0.22, hr*0.82, 0, 0, Math.PI/2);
    });

    // Nose bridge
    add(new T.CylinderGeometry(0.016, 0.022, hr*0.38, 6), skinDeepM,
        0, headY - hr*0.05, hr*0.78, 0.18, 0, 0);

    // Nose tip
    add(new T.SphereGeometry(0.024, 7, 6), skinDeepM, 0, headY - hr*0.23, hr*0.85);

    // Cheekbones (subtle bulge)
    [-1,1].forEach(side=>{
      const ck = add(new T.SphereGeometry(hr*0.22, 7, 6), skinDeepM,
          side*hr*0.62, headY - hr*0.12, hr*0.60);
      ck.scale.set(1.2, 0.7, 0.8);
    });

    // Lips
    add(new T.CylinderGeometry(hr*0.20, hr*0.18, 0.016, 8), skinDeepM,
        0, headY - hr*0.40, hr*0.80, 0, 0, Math.PI/2);
    // Lower lip slightly fuller
    add(new T.CylinderGeometry(hr*0.16, hr*0.14, 0.013, 8), skinDeepM,
        0, headY - hr*0.47, hr*0.79, 0, 0, Math.PI/2);

    // Chin
    add(new T.SphereGeometry(hr*0.14, 7, 6), skinDeepM, 0, headY - hr*0.62, hr*0.68);

    // Ear proxies
    [-1,1].forEach(side=>{
      const ear = add(new T.SphereGeometry(hr*0.17, 7, 6), skinDeepM,
          side*(hr*0.95), headY - hr*0.06, -0.01);
      ear.scale.set(0.55, 0.9, 0.6);
    });

    // ── Eyes ────────────────────────────────────────────────────
    const eyeZ = hr*0.78;
    const eyeY = headY + hr*0.05;
    const eyeX = hr*0.30;
    [-1,1].forEach(side=>{
      add(new T.SphereGeometry(hr*0.145, 9, 8), eyeWhiteM,  side*eyeX, eyeY, eyeZ);
      add(new T.SphereGeometry(hr*0.092, 8, 7), eyeIrisM,   side*eyeX, eyeY, eyeZ+hr*0.06);
      add(new T.SphereGeometry(hr*0.056, 7, 6), eyePupilM,  side*eyeX, eyeY, eyeZ+hr*0.09);
      // Eyelid crease
      const lidGeo = new T.TorusGeometry(hr*0.115, 0.008, 5, 12, Math.PI);
      add(lidGeo, skinDeepM, side*eyeX, eyeY+hr*0.01, eyeZ+0.005, 0, 0, side>0?0:Math.PI);
    });

    // ── Legs ────────────────────────────────────────────────────
    const lX = bc.lw*sx;
    const uLH = 0.36*sy;
    const uLY = hipY - 0.05 - uLH*0.5;
    const knee = uLY - uLH*0.5;
    const lLH = 0.34*sy;
    const lLY = knee - lLH*0.5;
    const ankle = lLY - lLH*0.5;

    [-1,1].forEach(side=>{
      // Thigh — tapered
      add(new T.CylinderGeometry(bc.lw*sx, bc.lw*0.80*sx, uLH, 8), clothM, side*lX, uLY, 0);
      // Knee cap
      add(new T.SphereGeometry(bc.lw*0.74*sx, 8, 7), clothM, side*lX, knee, 0.01);
      // Lower leg — calf taper
      add(new T.CylinderGeometry(bc.lw*0.76*sx, bc.lw*0.58*sx, lLH, 8), clothM, side*lX, lLY, 0);
      // Ankle
      add(new T.SphereGeometry(bc.lw*0.52*sx, 7, 6), skinM, side*lX, ankle, 0);
      // Foot
      add(new T.BoxGeometry(0.09*sx, 0.058*sy, 0.18*sx), clothM, side*lX, ankle-0.029*sy, 0.04);
      // Toe box
      add(new T.SphereGeometry(0.048*sx, 7, 5), clothM, side*lX, ankle-0.044*sy, 0.13);
    });

    // ── Hair ────────────────────────────────────────────────────
    const hairTopY = headY + hr*0.72;
    if(hairStyle !== 'bald') {
      const isLong   = ['ponytail','long_loose','braids_long'].includes(hairStyle);
      const isBraids = ['braids_short','locs_short','braids_long','locs_short'].includes(hairStyle);
      const isTop    = ['bun','warrior_knot'].includes(hairStyle);
      const isMohawk = hairStyle === 'mohawk';
      const isFade   = ['undercut','fade_high'].includes(hairStyle);

      // Cap layer — covers cranium
      if(!isMohawk && !isFade) {
        const capGeo = new T.SphereGeometry(hr*1.045, 12, 9, 0, Math.PI*2, 0, Math.PI*0.58);
        add(capGeo, hairM, 0, headY, 0);
      }
      // Short fade — partial side cap
      if(isFade) {
        const fadeGeo = new T.SphereGeometry(hr*1.045, 12, 9, 0, Math.PI*2, 0, Math.PI*0.36);
        add(fadeGeo, hairM, 0, headY+hr*0.14, 0);
      }
      // Mohawk strip
      if(isMohawk) {
        add(new T.CylinderGeometry(0.022,0.038,hr*1.4,5), hairM, 0, hairTopY-0.01, 0, 0,0,0);
      }
      // Top knot / bun
      if(isTop) {
        add(new T.SphereGeometry(hr*0.34, 8, 7), hairM, 0, hairTopY+hr*0.18, 0);
        add(new T.CylinderGeometry(hr*0.14, hr*0.22, hr*0.28, 7), hairM, 0, hairTopY, 0);
      }
      // Long flow / ponytail
      if(isLong) {
        add(new T.CylinderGeometry(hr*0.26, hr*0.08, 0.42*sy, 7), hairM, 0, headY-0.18*sy, -hr*0.35, 0.28,0,0);
      }
      // Braids — side strands
      if(isBraids) {
        [-1,1].forEach(side=>{
          add(new T.CylinderGeometry(0.018,0.010,0.32*sy,5), hairM,
              side*hr*0.52, headY-0.10*sy, -hr*0.2, 0.2,0,side*0.15);
        });
      }
    }

    // ── Ground plane + shadow catcher ─────────────────────────
    const floorGeo = new T.CircleGeometry(1.4, 24);
    const floorMat = new T.MeshPhysicalMaterial({
      color:0x0d0b08, roughness:1, metalness:0,
      transparent:true, opacity:0.0,
    });
    const floor = new T.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI/2;
    floor.position.y = ankle - 0.06*sy;
    floor.receiveShadow = true;
    scene.add(floor);

    // Subtle reflection disk (mirror-like)
    const reflGeo = new T.CircleGeometry(0.55, 20);
    const reflMat = new T.MeshPhysicalMaterial({
      color:0x1a1408, roughness:0.05, metalness:0.9, opacity:0.55, transparent:true,
    });
    const refl = new T.Mesh(reflGeo, reflMat);
    refl.rotation.x = -Math.PI/2;
    refl.position.y = floor.position.y + 0.001;
    scene.add(refl);

    scene.add(av);

    // ── Camera framing ───────────────────────────────────────
    const bbox   = new T.Box3().setFromObject(av);
    const center = bbox.getCenter(new T.Vector3());
    const height = bbox.max.y - bbox.min.y;
    camera.position.set(0, center.y + height*0.06, height*1.52);
    camera.lookAt(center);

    // ── Drag-to-rotate ────────────────────────────────────────
    let isDragging = false, lastX = 0, rotY = 0, targetRotY = 0;
    const onDown = e => { isDragging=true; lastX=(e.touches?e.touches[0]:e).clientX; };
    const onMove = e => {
      if(!isDragging) return;
      const x = (e.touches?e.touches[0]:e).clientX;
      targetRotY += (x-lastX)*0.012;
      lastX = x;
    };
    const onUp = () => { isDragging=false; };
    el.addEventListener('mousedown',  onDown);
    el.addEventListener('mousemove',  onMove);
    el.addEventListener('mouseup',    onUp);
    el.addEventListener('touchstart', onDown, {passive:true});
    el.addEventListener('touchmove',  onMove, {passive:true});
    el.addEventListener('touchend',   onUp);

    // ── Render loop ───────────────────────────────────────────
    let frame, t0 = performance.now();
    const animate = ts => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min((ts - t0)/1000, 0.05);
      t0 = ts;
      if(!isDragging) targetRotY += dt*0.45;
      rotY += (targetRotY - rotY) * 0.12;
      av.rotation.y = rotY;
      renderer.render(scene, camera);
    };
    animate(t0);

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseup',   onUp);
      el.removeEventListener('touchstart',onDown);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend',  onUp);
      scene.traverse(o=>{
        if(o.geometry) o.geometry.dispose();
        if(o.material) { if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else o.material.dispose(); }
      });
      renderer.dispose();
      if(el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  return React.createElement('div', {
    ref: mountRef,
    style:{width:'100%', height:420, borderRadius:12, overflow:'hidden', background:'#0a0804', cursor:'grab'}
  });
}

export { AvatarPreview3D };
