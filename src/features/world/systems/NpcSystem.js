/**
 * NpcSystem — renders content-defined NPCs in the Babylon world.
 *
 * NPCs are static (no server rows): definitions come straight from the
 * shared content package. Each NPC is a CharacterAvatar (idle-animated GLB
 * with a name label) plus a quest marker billboard ('!' = quest available,
 * '?' = quest ready to turn in) driven by React via setMarkers().
 *
 * BabylonWorldScene owns the lifecycle: init() after AssetLibrary is ready,
 * update(dt) each frame, nearestInRange() polled for the talk prompt,
 * dispose() on teardown.
 */

/* global BABYLON */

import { NPCS } from '../content/index';
import { CharacterAvatar } from '../game/CharacterAvatar.js';

const MARKER_COLORS = { '!': '#f0d060', '?': '#f0d060' };

// Deterministic per-NPC appearance so hub characters look distinct without
// authored configs. Story pass can replace this with per-NPC avatarConfig
// (or glbKey models) later.
const HAIR_STYLES = ['hair_short', 'hair_long', 'hair_bun', 'hair_wavy'];
const TOPS    = ['top_tunic', 'top_gambeson', 'top_cloth_shirt', 'top_leather_vest'];
const BOTTOMS = ['bottom_trousers', 'bottom_breeches'];
const TONES   = ['#C68642', '#8D5524', '#E0AC69', '#F1C27D'];

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Per-NPC standalone-model overrides. When an id maps here, the NPC renders
// from a self-contained authored GLB (AssetLibrary.MODEL_MANIFEST) instead of
// the procedurally-varied modular body. Kept out of the shared content package
// (src/.../content) so it stays a pure rendering concern and doesn't churn the
// SpacetimeDB content mirror.
const NPC_MODEL_OVERRIDES = {
  marshal_halwin: 'gilded_sentinel',
};

function npcAvatarConfig(npc) {
  const model = NPC_MODEL_OVERRIDES[npc.id];
  if (model) return { version: 1, model };
  const h = hashId(npc.id);
  // Unsigned shifts throughout: h is a full uint32, and `h >> n` reads it as
  // SIGNED — ids hashing ≥ 2^31 (trader_pell, foreman_bram) produced negative
  // indices, an undefined skin tone, and a spawn-killing hexToColor3 crash.
  return {
    version: 1,
    body: { gender: h % 2 ? 'male' : 'female' },
    skin: { tone: TONES[(h >>> 6) % TONES.length] },
    hair: { style: HAIR_STYLES[h % HAIR_STYLES.length], color: '#3b2a1a' },
    clothing: {
      top:    TOPS[(h >>> 2) % TOPS.length],
      bottom: BOTTOMS[(h >>> 4) % BOTTOMS.length],
      shoes:  'shoes_boots',
    },
  };
}

export class NpcSystem {
  constructor(scene, worldgen, assetLibrary, { zoneId = 1, excludeFromGlow } = {}) {
    this.scene = scene;
    this.worldgen = worldgen;
    this.assetLibrary = assetLibrary;
    this.zoneId = zoneId;
    // Optional (LightingManager.excludeFromGlow, injected rather than imported
    // so this system stays decoupled from lighting) — the mobile GlowLayer has
    // no bloom threshold, so the marker's white emissive would otherwise glow
    // like a light source over every NPC.
    this._excludeFromGlow = excludeFromGlow;
    this._npcs = new Map(); // npcId → { def, avatar, marker, markerTex, markerChar }
    this._disposed = false;
  }

  async init() {
    const defs = Object.values(NPCS).filter((n) => n.zoneId === this.zoneId);
    for (const def of defs) {
      if (this._disposed) return;
      try {
        const avatar = await CharacterAvatar.create(
          `npc_${def.id}`,
          def.title ? `${def.name} — ${def.title}` : def.name,
          npcAvatarConfig(def),
          this.scene,
          this.assetLibrary,
          { excludeFromGlow: this._excludeFromGlow },
        );
        if (this._disposed) { avatar.dispose(); return; }
        const y = this.worldgen.surfaceY(def.pos.x, def.pos.z);
        avatar.root.position.set(def.pos.x, y, def.pos.z);
        avatar.root.rotation.y = def.facingRad;
        const { plane, tex } = this._makeMarker(def.id, avatar.root);
        this._npcs.set(def.id, { def, avatar, marker: plane, markerTex: tex, markerChar: null });
      } catch (err) {
        console.warn(`[NpcSystem] failed to spawn ${def.id}:`, err);
      }
    }
  }

  _makeMarker(npcId, parent) {
    const tex = new BABYLON.DynamicTexture(`npc_${npcId}_marker_tex`,
      { width: 64, height: 64 }, this.scene, false);
    tex.hasAlpha = true;
    const mat = new BABYLON.StandardMaterial(`npc_${npcId}_marker_mat`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    const plane = BABYLON.MeshBuilder.CreatePlane(`npc_${npcId}_marker`,
      { width: 0.45, height: 0.45 }, this.scene);
    plane.material = mat;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.parent = parent;
    plane.position.set(0, 2.6, 0);
    plane.isPickable = false;
    plane.setEnabled(false);
    this._excludeFromGlow?.(plane);
    return { plane, tex };
  }

  /**
   * markers: { [npcId]: '!' | '?' | null }. Safe to call before init —
   * BabylonWorldScene re-applies the last map once init completes.
   */
  setMarkers(markers) {
    for (const [id, entry] of this._npcs) {
      const char = markers?.[id] ?? null;
      if (char === entry.markerChar) continue;
      entry.markerChar = char;
      if (!char) {
        entry.marker.setEnabled(false);
        continue;
      }
      const ctx = entry.markerTex.getContext();
      ctx.clearRect(0, 0, 64, 64);
      entry.markerTex.drawText(char, null, 52,
        'bold 52px Inter, sans-serif', MARKER_COLORS[char] ?? '#f0d060', 'transparent', true);
      entry.marker.setEnabled(true);
    }
  }

  /** Nearest NPC def within rangeM of (x, z), or null. */
  nearestInRange(x, z, rangeM = 5) {
    let best = null;
    let bestSq = rangeM * rangeM;
    for (const { def } of this._npcs.values()) {
      const dx = def.pos.x - x;
      const dz = def.pos.z - z;
      const dsq = dx * dx + dz * dz;
      if (dsq <= bestSq) { best = def; bestSq = dsq; }
    }
    return best;
  }

  update(dt) {
    this._npcs.forEach((e) => e.avatar.update(dt));
  }

  dispose() {
    this._disposed = true;
    this._npcs.forEach((e) => {
      e.marker?.material?.dispose();
      e.markerTex?.dispose();
      e.marker?.dispose();
      e.avatar?.dispose();
    });
    this._npcs.clear();
  }
}
