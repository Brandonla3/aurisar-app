/**
 * BabylonWorldScene — 3D multiplayer world renderer.
 *
 * Babylon.js is loaded as a bundled npm package by WorldGame.jsx (sets window.BABYLON).
 * This file references only the global — no direct babylonjs imports.
 *
 * Coordinate mapping (SpacetimeDB pixel-space <-> 3D world units):
 *   STDB center = 1600 px  ->  3D origin = (0, 0, 0)
 *   1 world unit = 32 STDB px
 *
 * Character rendering is fully delegated to CharacterAvatar + AssetLibrary.
 * Box-primitive fallback is used automatically when GLB assets are absent.
 */

/* global BABYLON */

import { AssetLibrary }    from './AssetLibrary.js';
import { CharacterAvatar } from './CharacterAvatar.js';
import { mergeConfig }     from './avatarSchema.js';

// ── Coordinate helpers ──────────────────────────────────────────────────────
const SCALE       = 32;
const STDB_CENTER = 1600;

function toWorld(v) { return (v - STDB_CENTER) / SCALE; }
function toStdb(v)  { return Math.round(v * SCALE + STDB_CENTER); }

// ── Main export ──────────────────────────────────────────────────────────────
export class BabylonWorldScene {
  constructor(canvas, playerInfo, callbacks) {
    this.canvas      = canvas;
    this.playerInfo  = playerInfo;
    this.callbacks   = callbacks;

    this._remotePlayers = new Map();
    this._myIdentity    = null;
    this._keys          = {};
    this._lastPos       = { x: 0, z: 0 };
    this._lastMoving    = false;
    this._lastSentAt    = 0;
    this._chatOpen      = false;
    this._local         = null;

    this._initSync();
    this._initCharactersAsync();
  }

  // ── Sync bootstrap (terrain, engine — no characters yet) ──────────────────

  _initSync() {
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.07, 0.10, 0.18, 1);
    this.scene.fogMode    = BABYLON.Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.006;
    this.scene.fogColor   = new BABYLON.Color3(0.12, 0.16, 0.26);

    this._setupLighting();
    this._buildTerrain();
    this._buildHub();
    this._buildTrees();
    this._buildRocks();
    this._buildPaths();
    this._setupCamera();
    this._bindKeys();

    // Render loop guards on _local until character is ready
    this.engine.runRenderLoop(() => {
      if (this._local) this._tick();
      this.scene.render();
    });

    this._onResize = () => this.engine.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ── Async character bootstrap ──────────────────────────────────────────────

  async _initCharactersAsync() {
    await AssetLibrary.init(this.scene);
    this._local = await CharacterAvatar.create(
      'local',
      this.playerInfo?.username ?? 'You',
      this.playerInfo?.avatarConfig ?? null,
      this.scene,
      AssetLibrary
    );
    this._local.root.position.set(0, 0, 0);
  }

  // ── Lighting ───────────────────────────────────────────────────────────────

  _setupLighting() {
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity   = 0.55;
    hemi.groundColor = new BABYLON.Color3(0.06, 0.08, 0.12);
    hemi.diffuse     = new BABYLON.Color3(0.70, 0.75, 0.95);

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2.5, -1), this.scene);
    sun.intensity = 0.75;
    sun.diffuse   = new BABYLON.Color3(0.95, 0.88, 0.75);
    sun.specular  = new BABYLON.Color3(0.15, 0.15, 0.15);
  }

  // ── Terrain ────────────────────────────────────────────────────────────────

  _buildTerrain() {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', {
      width: 200, height: 200, subdivisions: 2,
    }, this.scene);
    const m = this._stdMat('groundMat', new BABYLON.Color3(0.18, 0.30, 0.12));
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = m;
  }

  // ── Hub ────────────────────────────────────────────────────────────────────

  _buildHub() {
    const stone = this._stdMat('stone', new BABYLON.Color3(0.48, 0.48, 0.52));
    const dark  = this._stdMat('dark',  new BABYLON.Color3(0.22, 0.22, 0.28));

    const plat = BABYLON.MeshBuilder.CreateCylinder('platform', {
      diameter: 22, height: 0.6, tessellation: 12,
    }, this.scene);
    plat.position.y = 0.3;
    plat.material   = stone;

    [[-8, -8], [8, -8], [-8, 8], [8, 8]].forEach(([x, z], i) => {
      const p = BABYLON.MeshBuilder.CreateBox(`p${i}`, {
        width: 1.2, height: 4, depth: 1.2,
      }, this.scene);
      p.position.set(x, 2.6, z);
      p.material = stone;
      const cap = BABYLON.MeshBuilder.CreateCylinder(`cap${i}`, {
        diameter: 1.6, height: 0.5, tessellation: 8,
      }, this.scene);
      cap.position.set(x, 4.85, z);
      cap.material = stone;
    });

    const ob = BABYLON.MeshBuilder.CreateBox('obelisk', {
      width: 1.2, height: 8, depth: 1.2,
    }, this.scene);
    ob.position.set(0, 4.6, 0);
    ob.material = dark;

    const tip = BABYLON.MeshBuilder.CreateCylinder('obeliskTip', {
      diameterTop: 0, diameterBottom: 1.6, height: 2, tessellation: 4,
    }, this.scene);
    tip.position.set(0, 9.6, 0);
    tip.material = dark;

    const gem = BABYLON.MeshBuilder.CreateSphere('gem', { diameter: 0.9, segments: 8 }, this.scene);
    gem.position.set(0, 11, 0);
    const gemMat = new BABYLON.StandardMaterial('gemMat', this.scene);
    gemMat.diffuseColor  = new BABYLON.Color3(0.2, 0.4, 1.0);
    gemMat.emissiveColor = new BABYLON.Color3(0.15, 0.35, 0.9);
    gem.material = gemMat;

    const light = new BABYLON.PointLight('gemLight', new BABYLON.Vector3(0, 11, 0), this.scene);
    light.diffuse   = new BABYLON.Color3(0.3, 0.5, 1.0);
    light.intensity = 2.5;
    light.range     = 20;
  }

  // ── Trees ──────────────────────────────────────────────────────────────────

  _buildTrees() {
    const trunkMat = this._stdMat('trunk', new BABYLON.Color3(0.35, 0.22, 0.10));
    const leafA    = this._stdMat('leafA', new BABYLON.Color3(0.14, 0.42, 0.14));
    const leafB    = this._stdMat('leafB', new BABYLON.Color3(0.10, 0.32, 0.10));

    const positions = [
      [18, 12], [-15, 22], [28, -18], [-22, -12], [10, 34],
      [38,  8], [-32, 18], [22, -34], [ -8, -28], [42, 28],
      [-40, -5], [14, -40], [-28, 38], [35, -25], [-18, -42],
      [50, 15], [-45, 20], [12, 48], [-50, -30], [25, 50],
    ];

    positions.forEach(([x, z], i) => {
      const h = 2.8 + (i % 3) * 0.7;
      const r = 1.0 + (i % 4) * 0.12;
      const trunk = BABYLON.MeshBuilder.CreateCylinder(`trunk${i}`, {
        diameterTop: 0.25, diameterBottom: 0.45, height: h, tessellation: 6,
      }, this.scene);
      trunk.position.set(x, h / 2, z);
      trunk.material = trunkMat;
      [[0, r * 1.4, leafA], [1.5, r, leafB]].forEach(([yOff, diam, mat], j) => {
        const c = BABYLON.MeshBuilder.CreateCylinder(`leaf${i}_${j}`, {
          diameterTop: 0, diameterBottom: diam, height: 2.2, tessellation: 6,
        }, this.scene);
        c.position.set(x, h + yOff, z);
        c.material = mat;
      });
    });
  }

  // ── Rocks ──────────────────────────────────────────────────────────────────

  _buildRocks() {
    const mat = this._stdMat('rock', new BABYLON.Color3(0.42, 0.42, 0.44));
    [
      [12, 10], [-9, 18], [20, -10], [-17, -22], [32, -6],
      [-25, 6], [7, -32], [-38, 25], [28, 38], [-12, 45],
    ].forEach(([x, z], i) => {
      const d    = 0.8 + (i % 3) * 0.5;
      const rock = BABYLON.MeshBuilder.CreateSphere(`rock${i}`, {
        diameter: d, segments: 3,
      }, this.scene);
      rock.position.set(x, d * 0.25, z);
      rock.scaling.y  = 0.55;
      rock.rotation.y = i * 0.9;
      rock.material   = mat;
    });
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  _buildPaths() {
    const mat = this._stdMat('path', new BABYLON.Color3(0.38, 0.38, 0.40));
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz], di) => {
      for (let i = 1; i <= 8; i++) {
        const s = BABYLON.MeshBuilder.CreateBox(`stone${di}_${i}`, {
          width: 1.8, height: 0.08, depth: 1.8,
        }, this.scene);
        s.position.set(dx * (12 + i * 3), 0.04, dz * (12 + i * 3));
        s.rotation.y = (i * 0.2) % 0.3;
        s.material   = mat;
      }
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  _setupCamera() {
    const cam = new BABYLON.ArcRotateCamera(
      'cam', -Math.PI / 2, Math.PI / 3.5, 6.5,
      new BABYLON.Vector3(0, 1.2, 0), this.scene
    );
    cam.lowerRadiusLimit   = 2.5;
    cam.upperRadiusLimit   = 22;
    cam.lowerBetaLimit     = 0.25;
    cam.upperBetaLimit     = Math.PI / 2.1;
    cam.wheelPrecision     = 60;
    cam.panningSensibility = 0;
    cam.attachControl(this.canvas, true);
    this._camera = cam;
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  _bindKeys() {
    this._kd = (e) => {
      if (this._chatOpen) return;
      this._keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))
        e.preventDefault();
    };
    this._ku = (e) => { this._keys[e.code] = false; };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup',   this._ku);
  }

  // ── Per-frame ──────────────────────────────────────────────────────────────

  _tick() {
    const dt = this.engine.getDeltaTime();

    this._moveLocal(dt);
    this._local.update(dt);
    this._trackCamera();
    this._syncStdb();

    this._remotePlayers.forEach(rp => {
      this._lerpRemote(rp, dt);
      rp.update(dt);
    });
  }

  _moveLocal(dt) {
    if (this._chatOpen) { this._local.isMoving = false; return; }

    const w = this._keys['KeyW'] || this._keys['ArrowUp'];
    const s = this._keys['KeyS'] || this._keys['ArrowDown'];
    const a = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const d = this._keys['KeyD'] || this._keys['ArrowRight'];

    this._local.isMoving = !!(w || s || a || d);
    if (!this._local.isMoving) return;

    const speed = 0.012;
    const alpha = this._camera.alpha + Math.PI;
    const fwd   = new BABYLON.Vector3(Math.cos(alpha), 0, Math.sin(alpha));
    const right = new BABYLON.Vector3(Math.cos(alpha + Math.PI / 2), 0, Math.sin(alpha + Math.PI / 2));

    const dir = BABYLON.Vector3.Zero();
    if (w) dir.addInPlace(fwd);
    if (s) dir.subtractInPlace(fwd);
    if (a) dir.addInPlace(right);
    if (d) dir.subtractInPlace(right);
    if (dir.lengthSquared() < 0.001) return;
    dir.normalize();

    const pos = this._local.root.position;
    pos.addInPlace(dir.scale(speed * dt));
    pos.x = Math.max(-95, Math.min(95, pos.x));
    pos.z = Math.max(-95, Math.min(95, pos.z));
    pos.y = 0;

    const target = Math.atan2(dir.x, dir.z);
    this._local.root.rotation.y = this._lerpAngle(
      this._local.root.rotation.y, target, 0.18
    );
  }

  _trackCamera() {
    const p   = this._local.root.position;
    const tgt = new BABYLON.Vector3(p.x, 1.2, p.z);
    BABYLON.Vector3.LerpToRef(this._camera.target, tgt, 0.12, this._camera.target);
  }

  _syncStdb() {
    const now = Date.now();
    if (now - this._lastSentAt < 50) return;

    const { x, z } = this._local.root.position;
    const dx = x - this._lastPos.x;
    const dz = z - this._lastPos.z;

    if (Math.sqrt(dx * dx + dz * dz) > 0.04 || this._local.isMoving !== this._lastMoving) {
      this.callbacks.onMove?.(toStdb(x), toStdb(z), this._dir(), this._local.isMoving);
      this._lastPos    = { x, z };
      this._lastMoving = this._local.isMoving;
      this._lastSentAt = now;
    }
  }

  _dir() {
    const a = ((this._local.root.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    if (a < 45 || a >= 315) return 0;
    if (a < 135) return 3;
    if (a < 225) return 1;
    return 2;
  }

  // ── Remote players ─────────────────────────────────────────────────────────

  setMyIdentity(id) { this._myIdentity = id; }

  applyPlayerUpdate(row) {
    if (row.identity === this._myIdentity) return;
    if (!row.online) { this._removeRemote(row.identity); return; }
    if (!this._local) return;

    if (this._remotePlayers.has(row.identity)) {
      const rp    = this._remotePlayers.get(row.identity);
      rp._targetX = toWorld(row.x);
      rp._targetZ = toWorld(row.y);
      rp.isMoving = row.isMoving;
    } else {
      this._spawnRemote(row);
    }
  }

  async _spawnRemote(row) {
    const config = row.avatarConfig ? mergeConfig(row.avatarConfig) : null;
    const rp = await CharacterAvatar.create(
      row.identity, row.username, config, this.scene, AssetLibrary
    );
    rp._targetX = toWorld(row.x);
    rp._targetZ = toWorld(row.y);
    rp.root.position.set(rp._targetX, 0, rp._targetZ);
    this._remotePlayers.set(row.identity, rp);
  }

  _removeRemote(id) {
    const rp = this._remotePlayers.get(id);
    if (!rp) return;
    rp.dispose();
    this._remotePlayers.delete(id);
  }

  _lerpRemote(rp, dt) {
    const f = 1 - Math.pow(0.04, dt / 100);
    rp.root.position.x = BABYLON.Scalar.Lerp(rp.root.position.x, rp._targetX, f);
    rp.root.position.z = BABYLON.Scalar.Lerp(rp.root.position.z, rp._targetZ, f);
    rp.root.position.y = 0;
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  setChatOpen(open) {
    this._chatOpen = open;
    if (open) this._keys = {};
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  _stdMat(name, color) {
    const m = new BABYLON.StandardMaterial(name + '_mat', this.scene);
    m.diffuseColor  = color;
    m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    return m;
  }

  _lerpAngle(from, to, t) {
    let diff = to - from;
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return from + diff * t;
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup',   this._ku);
    window.removeEventListener('resize',  this._onResize);
    [...this._remotePlayers.keys()].forEach(id => this._removeRemote(id));
    this._local?.dispose();
    AssetLibrary.dispose();
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}
