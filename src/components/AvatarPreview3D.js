/**
 * AvatarPreview3D — React Three Fiber viewer for exported UE character GLBs.
 * Written with React.createElement (no JSX) to match the project convention.
 *
 * Loads 6 mesh pieces in parallel from /public/avatars/models/:
 *   body_{ma|fe}.glb, head_{ma|fe}.glb,
 *   upper/lower/feet_{outfit}.glb, hair_{hairStyle}.glb
 *
 * Poses (set via `pose` prop):
 *   'hero'    — idle animation (arms relaxed at sides)
 *   'crossed' — hero base + arms-crossed overlay
 */

import React, { Suspense, useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, ContactShadows, Html, OrbitControls, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

const e = React.createElement;

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
const EYE_HEX = {
  dark_brown:'#3B1A08', brown:'#6B3010',   hazel:'#8B6040',
  green:'#3A6B28',      blue:'#2050A0',    grey:'#708090',
  amber:'#C07020',      gold:'#C8A020',    violet:'#6030A0',
  red:'#A01818',        silver:'#C0C8D0',  teal:'#1A7070',
};

// Fallback for any hair key that was removed from UE but still in saved profile
const HAIR_FALLBACK = {
  ma_mohawk:'ma_short', ma_braids:'ma_long', ma_ponytail:'ma_surfer',
  ma_shaved:'ma_short', ma_warrior:'ma_old',
  fe_braids:'fe_medium', fe_ponytail:'fe_medium', fe_bun:'fe_bob', fe_mohawk:'fe_short',
};

// ─── Arms-crossed overlay bone rotations ─────────────────────────────────────
// Applied on top of the idle/hero pose (premultiplied).
// Values are in Three.js/GLTF right-handed Y-up space.
// Tune these if the crossed-arms look needs adjustment.
const CROSS_OVERLAY = {
  clavicle_l: new THREE.Quaternion().setFromEuler(new THREE.Euler( 0.12,  0.28, 0.0)),
  clavicle_r: new THREE.Quaternion().setFromEuler(new THREE.Euler( 0.12, -0.28, 0.0)),
  upperarm_l: new THREE.Quaternion().setFromEuler(new THREE.Euler( 0.85, -0.55, 0.20)),
  upperarm_r: new THREE.Quaternion().setFromEuler(new THREE.Euler( 0.85,  0.55,-0.20)),
  lowerarm_l: new THREE.Quaternion().setFromEuler(new THREE.Euler( 0.0,   1.30, 0.0)),
  lowerarm_r: new THREE.Quaternion().setFromEuler(new THREE.Euler( 0.0,  -1.30, 0.0)),
};

// ─── Material helpers ─────────────────────────────────────────────────────────
const looksLikeSkin   = id => /skin|body|torso|head|face|neck|hand|arm|chest|back|flesh/i.test(id);
const looksLikeHair   = id => /hair|beard|brow/i.test(id);
const looksLikeIris   = id => /iris|pupil/i.test(id);
const looksLikeSclera = id => /sclera/i.test(id);
const looksLikeEye    = id => /eye|iris|pupil|cornea|sclera/i.test(id);

function applyColours(scene, skinHex, hairHex, eyeHex) {
  const clone = scene.clone(true);
  clone.traverse(node => {
    if (!node.isMesh) return;
    const id = (node.name + '|' + (Array.isArray(node.material)
      ? node.material.map(m => m.name).join('|')
      : node.material?.name ?? '')).toLowerCase();

    // Keep sclera (whites) untouched
    if (looksLikeSclera(id)) return;
    // Skip refractive/cornea overlay layer — don't tint it
    if (/cornea|refract/i.test(id)) return;

    const tint = mat => {
      if (!mat) return mat;
      const m = mat.clone();
      if (skinHex && looksLikeSkin(id)) m.color.set(skinHex);
      if (hairHex && looksLikeHair(id)) m.color.set(hairHex);
      if (eyeHex  && looksLikeIris(id)) {
        m.color.set(eyeHex);
        // Slight emissive boost so the iris is visible even with dark lighting
        if (m.emissive) m.emissive.set(eyeHex).multiplyScalar(0.15);
      }
      return m;
    };
    node.material = Array.isArray(node.material)
      ? node.material.map(tint)
      : tint(node.material);
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

// ─── Single mesh piece ────────────────────────────────────────────────────────
function MeshPiece({ url, skinHex, hairHex, eyeHex, tintHair }) {
  const { scene } = useGLTF(url);
  const mesh = useMemo(
    () => tintHair
      ? applyHairColour(scene, hairHex)
      : applyColours(scene, skinHex, hairHex, eyeHex),
    [scene, skinHex, hairHex, eyeHex, tintHair]
  );
  return e('primitive', { object: mesh });
}

function SafePiece(props) {
  return e(ModelErrorBoundary, { fallback: null },
    e(Suspense, { fallback: null },
      e(MeshPiece, props)
    )
  );
}

// ─── Animation-driven pose syncer ─────────────────────────────────────────────
// Loads anim_idle_{ma|fe}.glb (skeleton + idle clip exported from UE),
// then each frame copies the driven bone quaternions to every SkinnedMesh in
// `groupRef` — including all separate clothing/hair GLBs.
function PoseSyncer({ gender, groupRef, pose }) {
  const gd = gender === 'male' ? 'ma' : 'fe';
  const { scene: animScene, animations } = useGLTF(`/avatars/models/anim_idle_${gd}.glb`);
  const { actions, mixer } = useAnimations(animations, animScene);

  useEffect(() => {
    const a = actions && Object.values(actions)[0];
    if (!a) return;
    // Play once, pause at ~0.4 s — a natural standing frame from the idle cycle
    a.reset().play();
    a.paused  = true;
    mixer.setTime(0.4);
  }, [actions, mixer]);

  // Priority 1 runs after drei's own mixer.update (priority 0)
  useFrame(() => {
    if (!groupRef.current) return;

    // Gather current quaternions from every named node in the anim scene
    const src = {};
    animScene.traverse(n => { if (n.name) src[n.name] = n.quaternion; });
    if (!Object.keys(src).length) return;

    // Apply to ALL SkinnedMeshes in the character group
    groupRef.current.traverse(n => {
      if (!n.isSkinnedMesh) return;
      n.skeleton.bones.forEach(b => {
        if (src[b.name]) b.quaternion.copy(src[b.name]);
      });
    });

    // Arms-crossed overlay applied on top of the idle
    if (pose === 'crossed') {
      groupRef.current.traverse(n => {
        if (!n.isSkinnedMesh) return;
        n.skeleton.bones.forEach(b => {
          const ov = CROSS_OVERLAY[b.name];
          if (ov) b.quaternion.premultiply(ov);
        });
      });
    }
  }, 1);

  return null;
}

function SafePoseSyncer({ gender, groupRef, pose }) {
  return e(ModelErrorBoundary, { fallback: null },
    e(Suspense, { fallback: null },
      e(PoseSyncer, { gender, groupRef, pose })
    )
  );
}

// ─── Assembled character ──────────────────────────────────────────────────────
function CharacterModel({ gender, outfit, hairStyle, skinHex, hairHex, eyeHex, pose }) {
  const gd   = gender === 'male' ? 'ma' : 'fe';
  const base = '/avatars/models';
  const hair = HAIR_FALLBACK[hairStyle] || hairStyle;

  const groupRef = useRef();
  useFrame(({ clock }) => {
    if (groupRef.current)
      groupRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.4) * 0.18;
  });

  // UE exports in cm; GLTF expects m — scale 0.01 converts correctly
  return e('group', { ref: groupRef, scale: 0.01 },
    // Pose syncer drives bones from the idle animation when pose !== 'tpose'
    pose !== 'tpose' && e(SafePoseSyncer, { gender, groupRef, pose }),

    e(SafePiece, { key:'body',  url:`${base}/body_${gd}.glb`,      skinHex, hairHex, eyeHex }),
    e(SafePiece, { key:'head',  url:`${base}/head_${gd}.glb`,      skinHex, hairHex, eyeHex }),
    e(SafePiece, { key:'upper', url:`${base}/upper_${outfit}.glb` }),
    e(SafePiece, { key:'lower', url:`${base}/lower_${outfit}.glb` }),
    e(SafePiece, { key:'feet',  url:`${base}/feet_${outfit}.glb`  }),
    e(SafePiece, { key:'hair',  url:`${base}/hair_${hair}.glb`,   hairHex, tintHair: true }),
    gender === 'female' && e(SafePiece, { key:'accs', url:`${base}/accs_earring.glb` }),
  );
}

// ─── Overlays ─────────────────────────────────────────────────────────────────
function LoadingOverlay() {
  return e(Html, { center: true },
    e('div', { style: { color:'#8a8070', fontSize:12, textAlign:'center' } },
      e('div', { style: { marginBottom:4, fontSize:20 } }, '⚔️'),
      'Loading…'
    )
  );
}

function PendingOverlay() {
  return e(Html, { center: true },
    e('div', { style: { color:'#6a645a', fontSize:12, textAlign:'center', lineHeight:'1.7' } },
      e('div', { style: { marginBottom:6, fontSize:26 } }, '⚙️'),
      e('div', { style: { color:'#a09880' } }, '3D models pending'),
      e('div', { style: { fontSize:10, marginTop:4, opacity:0.65 } },
        'Open UE → run', e('br', null),
        e('code', { style: { background:'#1a1812', padding:'1px 5px', borderRadius:3 } },
          'export_character_models.py'
        )
      )
    )
  );
}

// ─── Lights ───────────────────────────────────────────────────────────────────
function Lights({ clsColor }) {
  return e(React.Fragment, null,
    e('ambientLight',      { intensity: 0.6 }),
    e('directionalLight',  {
      position: [2.5, 5, 3], intensity: 1.4, castShadow: true,
      'shadow-mapSize':        [1024, 1024],
      'shadow-camera-near':    0.1,
      'shadow-camera-far':     30,
      'shadow-camera-left':    -3,
      'shadow-camera-right':   3,
      'shadow-camera-top':     5,
      'shadow-camera-bottom': -1,
    }),
    e('directionalLight',  { position: [-2, 2, -2], intensity: 0.4, color: clsColor || '#4466ff' }),
    e('pointLight',        { position: [0, 4, 1],   intensity: 0.25, color: '#ffeecc' }),
  );
}

// ─── Public component ─────────────────────────────────────────────────────────
export default function AvatarPreview3D({
  gender    = 'male',
  outfit    = 'ma_casual',
  hairStyle = 'ma_short',
  skinTone  = 'mid_3',
  hairColor = 'black',
  eyeColor  = 'dark_brown',
  pose      = 'hero',
  clsColor  = '#8B6A3E',
}) {
  const skinHex = SKIN_HEX[skinTone] || '#C0703E';
  const hairHex = HAIR_HEX[hairColor] || '#1A1008';
  const eyeHex  = EYE_HEX[eyeColor]  || '#3B1A08';

  const effectiveOutfit = outfit.startsWith(gender === 'male' ? 'ma' : 'fe')
    ? outfit
    : (gender === 'male' ? 'ma_casual' : 'fe_casual');

  return e('div', {
    style: {
      width:'100%', height:400,
      borderRadius:12, overflow:'hidden',
      background:'#0d0c0a',
      border:`1px solid ${clsColor}28`,
    }},
    e(Canvas, {
      camera:  { position: [0, 1.0, 3.2], fov: 38 },
      gl:      { antialias: true, alpha: false },
      shadows: true,
    },
      e('color', { attach: 'background', args: ['#0d0c0a'] }),
      e(Lights, { clsColor }),

      e(ModelErrorBoundary, { fallback: e(PendingOverlay, null) },
        e(Suspense, { fallback: e(LoadingOverlay, null) },
          e(CharacterModel, {
            gender, outfit: effectiveOutfit, hairStyle,
            skinHex, hairHex, eyeHex, pose,
          }),
          e(ContactShadows, { position: [0, 0, 0], opacity: 0.4, scale: 4, blur: 2.5, far: 3 }),
        )
      ),

      e(OrbitControls, {
        enablePan:       false,
        enableZoom:      false,
        minPolarAngle:   Math.PI / 5,
        maxPolarAngle:   Math.PI * 0.65,
        target:          [0, 0.9, 0],
      }),
    )
  );
}

export { AvatarPreview3D, EYE_HEX };
