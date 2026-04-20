/**
 * AvatarPreview3D — React Three Fiber viewer for exported UE character GLBs.
 *
 * Loads 6 mesh pieces in parallel from /public/avatars/models/:
 *   body_{ma|fe}.glb          base body
 *   head_{ma|fe}.glb          head
 *   upper_{outfit}.glb        shirt / top
 *   lower_{outfit}.glb        trousers / skirt
 *   feet_{outfit}.glb         shoes
 *   hair_{hairStyle}.glb      hair mesh
 *
 * Run ue_scripts/export_character_models.py from UE once to generate files.
 */

import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, ContactShadows, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// ─── Colour tables ────────────────────────────────────────────────────────────
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

// Hair styles that were added to the UI but have no UE asset — map to closest real style
const HAIR_FALLBACK = {
  ma_mohawk:'ma_short', ma_braids:'ma_long', ma_ponytail:'ma_surfer',
  ma_shaved:'ma_short', ma_warrior:'ma_old',
  fe_braids:'fe_medium', fe_ponytail:'fe_medium', fe_bun:'fe_bob', fe_mohawk:'fe_short',
};

// ─── Material-name helpers ────────────────────────────────────────────────────
const looksLikeSkin = id => /skin|body|torso|head|face|neck|hand|arm|chest|back|flesh/i.test(id);
const looksLikeHair = id => /hair|beard|brow/i.test(id);
const looksLikeEye  = id => /eye|iris|pupil|cornea|sclera/i.test(id);

function applyColours(scene, skinHex, hairHex) {
  const clone = scene.clone(true);
  clone.traverse(node => {
    if (!node.isMesh) return;
    const id = (node.name + '|' + (Array.isArray(node.material)
      ? node.material.map(m => m.name).join('|')
      : node.material?.name ?? '')).toLowerCase();

    if (looksLikeEye(id)) return; // never touch eyes

    const applyToMat = mat => {
      if (!mat) return mat;
      const m = mat.clone();
      if (skinHex && looksLikeSkin(id)) m.color.set(skinHex);
      if (hairHex && looksLikeHair(id)) m.color.set(hairHex);
      return m;
    };

    node.material = Array.isArray(node.material)
      ? node.material.map(applyToMat)
      : applyToMat(node.material);
  });
  return clone;
}

function applyHairColour(scene, hairHex) {
  const clone = scene.clone(true);
  clone.traverse(node => {
    if (!node.isMesh) return;
    const tint = mat => { const m = mat.clone(); m.color.set(hairHex); return m; };
    node.material = Array.isArray(node.material)
      ? node.material.map(tint)
      : tint(node.material);
  });
  return clone;
}

// ─── Error boundary ───────────────────────────────────────────────────────────
class ModelErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() { return this.state.err ? (this.props.fallback ?? null) : this.props.children; }
}

// ─── Individual mesh piece ────────────────────────────────────────────────────
function MeshPiece({ url, skinHex, hairHex, tintHair }) {
  const { scene } = useGLTF(url);
  const mesh = useMemo(
    () => tintHair ? applyHairColour(scene, hairHex) : applyColours(scene, skinHex, hairHex),
    [scene, skinHex, hairHex, tintHair]
  );
  return <primitive object={mesh} />;
}

function SafePiece(props) {
  return (
    <ModelErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <MeshPiece {...props} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

// ─── Full assembled character ─────────────────────────────────────────────────
function CharacterModel({ gender, outfit, hairStyle, skinHex, hairHex }) {
  const gd   = gender === 'male' ? 'ma' : 'fe';
  const base = '/avatars/models';
  const hair = HAIR_FALLBACK[hairStyle] || hairStyle;

  const groupRef = useRef();
  useFrame(({ clock }) => {
    if (groupRef.current)
      groupRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.4) * 0.18;
  });

  return (
    <group ref={groupRef}>
      <SafePiece url={`${base}/body_${gd}.glb`}      skinHex={skinHex} hairHex={hairHex} />
      <SafePiece url={`${base}/head_${gd}.glb`}      skinHex={skinHex} hairHex={hairHex} />
      <SafePiece url={`${base}/upper_${outfit}.glb`} />
      <SafePiece url={`${base}/lower_${outfit}.glb`} />
      <SafePiece url={`${base}/feet_${outfit}.glb`}  />
      <SafePiece url={`${base}/hair_${hair}.glb`}    hairHex={hairHex} tintHair />
      {gender === 'female' && (
        <SafePiece url={`${base}/accs_earring.glb`} />
      )}
    </group>
  );
}

// ─── Overlays ─────────────────────────────────────────────────────────────────
function LoadingOverlay() {
  return (
    <Html center>
      <div style={{ color:'#8a8070', fontSize:12, textAlign:'center' }}>
        <div style={{ marginBottom:4, fontSize:20 }}>⚔️</div>Loading…
      </div>
    </Html>
  );
}

function PendingOverlay() {
  return (
    <Html center>
      <div style={{ color:'#6a645a', fontSize:12, textAlign:'center', lineHeight:1.7 }}>
        <div style={{ marginBottom:6, fontSize:26 }}>⚙️</div>
        <div style={{ color:'#a09880' }}>3D models pending</div>
        <div style={{ fontSize:10, marginTop:4, opacity:0.65 }}>
          Open UE → run<br />
          <code style={{ background:'#1a1812', padding:'1px 5px', borderRadius:3 }}>
            export_character_models.py
          </code>
        </div>
      </div>
    </Html>
  );
}

// ─── Lighting ─────────────────────────────────────────────────────────────────
function Lights({ clsColor }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2.5, 5, 3]} intensity={1.4} castShadow
        shadow-mapSize={[1024,1024]}
        shadow-camera-near={0.1} shadow-camera-far={30}
        shadow-camera-left={-3}  shadow-camera-right={3}
        shadow-camera-top={5}    shadow-camera-bottom={-1} />
      <directionalLight position={[-2, 2, -2]} intensity={0.4} color={clsColor || '#4466ff'} />
      <pointLight position={[0, 4, 1]} intensity={0.25} color="#ffeecc" />
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

  // Guard against mismatched gender/outfit keys still in state
  const effectiveOutfit = outfit.startsWith(gender === 'male' ? 'ma' : 'fe')
    ? outfit
    : (gender === 'male' ? 'ma_casual' : 'fe_casual');

  return (
    <div style={{
      width:'100%', height:400,
      borderRadius:12, overflow:'hidden',
      background:'#0d0c0a',
      border:`1px solid ${clsColor}28`,
    }}>
      <Canvas
        camera={{ position:[0, 0.9, 2.8], fov:38 }}
        gl={{ antialias:true, alpha:false }}
        shadows
      >
        <color attach="background" args={['#0d0c0a']} />
        <Lights clsColor={clsColor} />

        <ModelErrorBoundary fallback={<PendingOverlay />}>
          <Suspense fallback={<LoadingOverlay />}>
            <CharacterModel
              gender={gender}
              outfit={effectiveOutfit}
              hairStyle={hairStyle}
              skinHex={skinHex}
              hairHex={hairHex}
            />
            <ContactShadows
              position={[0, -0.01, 0]}
              opacity={0.4} scale={4} blur={2.5} far={3}
            />
          </Suspense>
        </ModelErrorBoundary>

        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI * 0.65}
          target={[0, 0.8, 0]}
        />
      </Canvas>
    </div>
  );
}

export { AvatarPreview3D };
