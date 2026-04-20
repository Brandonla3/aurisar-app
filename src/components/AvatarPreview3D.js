/**
 * AvatarPreview3D — React Three Fiber viewer for exported UE character GLBs.
 *
 * File layout expected in /public/avatars/models/:
 *   body_ma_casual.glb    body + outfit, hair removed (one per outfit key)
 *   body_fe_casual.glb    ...
 *   hair_ma_short.glb     isolated hair mesh (one per hair key)
 *   hair_fe_a_line_bob.glb ...
 *
 * Run ue_scripts/export_character_models.py from UE to generate these files.
 * While files are missing the viewer shows a friendly "pending export" state.
 */

import React, { Suspense, useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, ContactShadows, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// ─── Colour tables (match App.js pickers) ────────────────────────────────────
const SKIN_HEX = {
  fair_1:'#FDDBB4', fair_2:'#F5C89A', mid_1:'#E8A97C', mid_2:'#D4895C', mid_3:'#C0703E',
  tan_1:'#A85830',  tan_2:'#8B4220',  deep_1:'#6B2D10', deep_2:'#4A1C08', deep_3:'#2E0F04',
  orc_1:'#5A7A3A',  orc_2:'#3D5C28',  orc_3:'#8B5E3C',
  elf_1:'#C8D8C0',  elf_2:'#9ABAA0',
  stone_1:'#8C8C9A',stone_2:'#6B7B8C',iron_1:'#7A6A50',
  void_1:'#2A1A3A', gold_1:'#C8AA60',
};

const HAIR_HEX = {
  black:'#1A1008',    dk_brown:'#3B2010',  brown:'#6B3820',    auburn:'#A05828',
  lt_brown:'#C88040', blonde:'#D4AA60',    lt_blonde:'#E8C880', red:'#E85030',
  grey:'#B0A898',     white:'#F0EEE8',
  deep_violet:'#4A3888', forest_grn:'#2A7858', ocean_blue:'#185898',
  blood_red:'#983848',   molten_gld:'#C8A020', void_black:'#101018',
  silver_wht:'#E8E8F8',  poison_grn:'#50C840', arcane_prpl:'#7B2D8B',
  frost_blue:'#60A8D8',  ember_org:'#D84820',
};

// ─── Outfit → GLB body file ───────────────────────────────────────────────────
const BODY_FILE = {
  ma_casual:'body_ma_casual', ma_sport:'body_ma_sport',
  ma_hoodie:'body_ma_hoodie', ma_business:'body_ma_business',
  fe_casual:'body_fe_casual', fe_sporty:'body_fe_sporty', fe_business:'body_fe_business',
};

// ─── Material name heuristics ─────────────────────────────────────────────────
const isSkin = n => /skin|body|torso|head|face|hand|arm|leg|neck|chest|back|foot|feet/i.test(n);
const isHair = n => /hair|beard|brow/i.test(n);
const isEye  = n => /eye|iris|pupil|cornea|sclera/i.test(n);

// ─── Error boundary (catches useGLTF 404s) ───────────────────────────────────
class ModelErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() {
    if (this.state.err) return this.props.fallback ?? null;
    return this.props.children;
  }
}

// ─── Loaded character ─────────────────────────────────────────────────────────
function CharacterModel({ bodyFile, hairFile, skinHex, hairHex }) {
  const { scene: bScene } = useGLTF(`/avatars/models/${bodyFile}.glb`);
  const { scene: hScene } = useGLTF(`/avatars/models/${hairFile}.glb`);

  const body = useMemo(() => {
    const clone = bScene.clone(true);
    clone.traverse(node => {
      if (!node.isMesh) return;
      const id = node.name + '|' + (node.material?.name ?? '');
      node.material = Array.isArray(node.material)
        ? node.material.map(m => m.clone())
        : node.material.clone();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(mat => {
        if (isEye(id)) return;                      // keep eye colour
        if (isHair(id)) { mat.color.set(hairHex); return; }
        if (isSkin(id)) { mat.color.set(skinHex); return; }
      });
    });
    return clone;
  }, [bScene, skinHex, hairHex]);

  const hair = useMemo(() => {
    const clone = hScene.clone(true);
    clone.traverse(node => {
      if (!node.isMesh) return;
      node.material = Array.isArray(node.material)
        ? node.material.map(m => { const c = m.clone(); c.color.set(hairHex); return c; })
        : (() => { const c = node.material.clone(); c.color.set(hairHex); return c; })();
    });
    return clone;
  }, [hScene, hairHex]);

  // Subtle idle sway
  const groupRef = useRef();
  useFrame(({ clock }) => {
    if (groupRef.current)
      groupRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.4) * 0.18;
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={body} />
      <primitive object={hair} />
    </group>
  );
}

// ─── Inline overlays (must be inside Canvas to use Html) ─────────────────────
function LoadingOverlay() {
  return (
    <Html center>
      <div style={{ color:'#8a8070', fontSize:12, textAlign:'center' }}>
        <div style={{ marginBottom:4, fontSize:20 }}>⚔️</div>
        <div>Loading model…</div>
      </div>
    </Html>
  );
}

function PendingOverlay() {
  return (
    <Html center>
      <div style={{ color:'#6a645a', fontSize:12, textAlign:'center', lineHeight:1.6 }}>
        <div style={{ marginBottom:6, fontSize:26 }}>⚙️</div>
        <div style={{ color:'#a09880' }}>3D models pending</div>
        <div style={{ fontSize:10, marginTop:4, opacity:0.65 }}>
          Open UE → run<br/>
          <code style={{ background:'#1a1812', padding:'1px 5px', borderRadius:3 }}>
            export_character_models.py
          </code>
        </div>
      </div>
    </Html>
  );
}

// ─── Scene lighting ───────────────────────────────────────────────────────────
function Lights({ clsColor }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2.5, 5, 3]} intensity={1.4} castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5} shadow-camera-far={20}
        shadow-camera-left={-3} shadow-camera-right={3}
        shadow-camera-top={4}   shadow-camera-bottom={-2} />
      {/* Rim light in class colour */}
      <directionalLight position={[-2, 2, -2]} intensity={0.35}
        color={clsColor || '#4060ff'} />
      <pointLight position={[0, 4, 0]} intensity={0.2} color="#ffeecc" />
    </>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────
export default function AvatarPreview3D({
  gender    = 'male',
  outfit    = 'ma_casual',
  hairStyle = 'ma_short',
  skinTone  = 'mid_3',
  hairColor = 'black',
  clsColor  = '#8B6A3E',
}) {
  const skinHex = SKIN_HEX[skinTone] || '#C0703E';
  const hairHex = HAIR_HEX[hairColor] || '#1A1008';

  // Fall back to correct gender outfit if wrong gender key is still in state
  const effectiveOutfit = BODY_FILE[outfit]
    ? outfit
    : gender === 'male' ? 'ma_casual' : 'fe_casual';

  const bodyFile = BODY_FILE[effectiveOutfit];
  const hairFile = `hair_${hairStyle}`;

  return (
    <div style={{
      width:'100%', height:380,
      borderRadius:12, overflow:'hidden',
      background:'#0d0c0a',
      border:`1px solid ${clsColor}28`,
    }}>
      <Canvas
        camera={{ position:[0, 0.6, 2.6], fov:40 }}
        gl={{ antialias:true, alpha:false }}
        shadows
      >
        <color attach="background" args={['#0d0c0a']} />
        <Lights clsColor={clsColor} />

        <ModelErrorBoundary fallback={<PendingOverlay />}>
          <Suspense fallback={<LoadingOverlay />}>
            <CharacterModel
              bodyFile={bodyFile}
              hairFile={hairFile}
              skinHex={skinHex}
              hairHex={hairHex}
            />
            <ContactShadows
              position={[0, -1, 0]}
              opacity={0.35} scale={3} blur={2.5} far={2}
            />
          </Suspense>
        </ModelErrorBoundary>

        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI * 0.65}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}

export { AvatarPreview3D };
