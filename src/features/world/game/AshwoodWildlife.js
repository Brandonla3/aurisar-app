/**
 * AshwoodWildlife — ambient critters: meadow rabbits, crows that flush from
 * trees when approached, and bats wheeling over cave mouths at night.
 *
 * Ports the prototype's makeRabbit/buildCritters/updateCritters (~1141),
 * makeCrow/buildCrows/updateCrows (~1188) and buildBats/updateBats (~1239).
 *
 * Like motes/fireflies these are client-local cosmetics: placement and
 * motion use Math.random (each client sees its own wildlife), which is
 * allowed by the determinism contract — nothing here is gameplay-relevant
 * or shared state. The huntable fauna from the prototype (deer/boar with
 * hp/drops) are server-side spawns and intentionally NOT ported here.
 *
 * Draw-call budget: +4 (rabbits = 1 instanced template, crow bodies = 1,
 * crow wings = 1, bats = 1 thin-instanced quad).
 */

/* global BABYLON */

const RABBITS = 12;
const CROWS = 16;
const BATS_PER_CAVE = 8;
const CROW_PERCH_RANGE = 140;   // prefer trees this close to the player

const rand = (a, b) => a + Math.random() * (b - a);

// Bake a constant vertex color so parts keep their tint through MergeMeshes
// (one material, one draw call).
function tint(mesh, hex) {
  const c = BABYLON.Color3.FromHexString(hex);
  const n = mesh.getTotalVertices();
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    cols[i * 4] = c.r; cols[i * 4 + 1] = c.g; cols[i * 4 + 2] = c.b; cols[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
  return mesh;
}

export class AshwoodWildlife {
  constructor(scene, worldgen, getPlayerPos) {
    this.scene = scene;
    this.wg = worldgen;
    this.getPlayerPos = getPlayerPos;
    this.time = 0;

    this._buildRabbits();
    this._buildCrows();
    this._buildBats();
    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  // Random open-ground point: inside the disc, off the mountain/forest/water.
  _scatter(minFromCenter) {
    const R = this.wg.config.radius * 0.9;
    for (let t = 0; t < 40; t++) {
      const x = rand(-R, R), z = rand(-R, R);
      const d = Math.hypot(x, z);
      if (d < minFromCenter || d > R) continue;
      if (this.wg.lakeWaterDepthAt(x, z) > 0.02) continue;
      if (this.wg.inMountain(x, z) || this.wg.inForest(x, z)) continue;
      return { x, z };
    }
    return { x: minFromCenter + 5, z: 0 };
  }

  // ── rabbits ────────────────────────────────────────────────────────────────

  _buildRabbits() {
    const matV = new BABYLON.StandardMaterial('ash_rabbit', this.scene);
    matV.diffuseColor = new BABYLON.Color3(1, 1, 1); // tints from vertex colors
    matV.specularColor = new BABYLON.Color3(0, 0, 0);

    const body = tint(BABYLON.MeshBuilder.CreateSphere('rb', { diameter: 0.4, segments: 6 }, this.scene), '#9a8b75');
    body.scaling.set(1, 0.85, 1.3); body.position.y = 0.2;
    body.bakeCurrentTransformIntoVertices();
    const head = tint(BABYLON.MeshBuilder.CreateSphere('rh', { diameter: 0.26, segments: 6 }, this.scene), '#9a8b75');
    head.position.set(0, 0.3, 0.22); head.bakeCurrentTransformIntoVertices();
    const ears = [];
    for (const sx of [-1, 1]) {
      const ear = tint(BABYLON.MeshBuilder.CreateCylinder('re', { diameterTop: 0.04, diameterBottom: 0.1, height: 0.26, tessellation: 4 }, this.scene), '#9a8b75');
      ear.position.set(sx * 0.05, 0.46, 0.2); ear.rotation.x = -0.2;
      ear.bakeCurrentTransformIntoVertices();
      ears.push(ear);
    }
    const tail = tint(BABYLON.MeshBuilder.CreateSphere('rt', { diameter: 0.14, segments: 5 }, this.scene), '#e8e0cf');
    tail.position.set(0, 0.22, -0.24); tail.bakeCurrentTransformIntoVertices();

    const tpl = BABYLON.Mesh.MergeMeshes([body, head, ...ears, tail], true, true, undefined, false, false);
    tpl.name = 'tpl_rabbit';
    tpl.material = matV;
    tpl.isVisible = false;       // template hidden; instances render
    tpl.isPickable = false;
    this._rabbitTpl = tpl;

    this.rabbits = [];
    for (let i = 0; i < RABBITS; i++) {
      const p = this._scatter(10);
      const inst = tpl.createInstance(`rabbit${i}`);
      inst.isPickable = false;
      inst.position.set(p.x, this.wg.surfaceY(p.x, p.z), p.z);
      this.rabbits.push({
        inst, tx: p.x, tz: p.z,
        timer: rand(1, 3), fleeT: 0, speed: 0, hop: rand(0, 6.28),
      });
    }
  }

  _updateRabbits(dt, p) {
    const R = this.wg.config.radius;
    for (const c of this.rabbits) {
      const pos = c.inst.position;
      if (p) {
        const dx = p.x - pos.x, dz = p.z - pos.z;
        if (Math.hypot(dx, dz) < 6.5) {
          c.fleeT = 1.4;
          const aw = Math.atan2(-dx, -dz);
          c.tx = pos.x + Math.sin(aw) * 7;
          c.tz = pos.z + Math.cos(aw) * 7;
        }
      }
      c.fleeT = Math.max(0, c.fleeT - dt);
      const tox = c.tx - pos.x, toz = c.tz - pos.z, td = Math.hypot(tox, toz);
      const targetSpd = c.fleeT > 0 ? 6.5 : 1.6;
      c.speed += (targetSpd - c.speed) * Math.min(1, dt * 6);
      let moving = false;
      if (td > 0.3) {
        pos.x += (tox / td) * c.speed * dt;
        pos.z += (toz / td) * c.speed * dt;
        c.inst.rotation.y = Math.atan2(tox / td, toz / td);
        moving = true;
      } else {
        c.timer -= dt;
        if (c.timer <= 0) { c.timer = rand(1.5, 4); c.tx += rand(-6, 6); c.tz += rand(-6, 6); }
      }
      if (Math.hypot(pos.x, pos.z) > R) { c.tx *= 0.6; c.tz *= 0.6; }
      const baseY = this.wg.surfaceY(pos.x, pos.z);
      if (moving) { c.hop += dt * 16; pos.y = baseY + Math.abs(Math.sin(c.hop)) * 0.16; }
      else pos.y = baseY;
    }
  }

  // ── crows ──────────────────────────────────────────────────────────────────

  _buildCrows() {
    const blk = new BABYLON.StandardMaterial('ash_crow', this.scene);
    blk.diffuseColor = BABYLON.Color3.FromHexString('#121016');
    blk.specularColor = new BABYLON.Color3(0, 0, 0);

    const body = BABYLON.MeshBuilder.CreateCylinder('cb', { diameterTop: 0, diameterBottom: 0.24, height: 0.4, tessellation: 5 }, this.scene);
    body.rotation.x = Math.PI / 2; body.bakeCurrentTransformIntoVertices();
    const head = BABYLON.MeshBuilder.CreateSphere('ch', { diameter: 0.18, segments: 5 }, this.scene);
    head.position.set(0, 0.04, 0.2); head.bakeCurrentTransformIntoVertices();
    const bodyTpl = BABYLON.Mesh.MergeMeshes([body, head], true, true, undefined, false, false);
    bodyTpl.name = 'tpl_crowbody';
    bodyTpl.material = blk;
    bodyTpl.isVisible = false;
    bodyTpl.isPickable = false;
    this._crowBodyTpl = bodyTpl;

    const wingM = new BABYLON.StandardMaterial('ash_crowwing', this.scene);
    wingM.diffuseColor = BABYLON.Color3.FromHexString('#14121a');
    wingM.specularColor = new BABYLON.Color3(0, 0, 0);
    wingM.backFaceCulling = false;
    // vertical plane swinging about Y, like the prototype's door-hinge flap
    const wingTpl = BABYLON.MeshBuilder.CreatePlane('tpl_crowwing', { width: 0.5, height: 0.2 }, this.scene);
    wingTpl.material = wingM;
    wingTpl.isVisible = false;
    wingTpl.isPickable = false;
    this._crowWingTpl = wingTpl;

    // perchable canopy trees from the deterministic manifest
    this._perches = this.wg.sites.trees.filter((t) => t.kind !== 'dead');

    this.crows = [];
    for (let i = 0; i < CROWS; i++) {
      const root = new BABYLON.TransformNode(`crow${i}`, this.scene);
      const bodyI = bodyTpl.createInstance(`crow${i}_b`);
      bodyI.parent = root; bodyI.isPickable = false;
      const wings = [];
      for (const sx of [-1, 1]) {
        const w = wingTpl.createInstance(`crow${i}_w${sx}`);
        w.parent = root; w.isPickable = false;
        w.position.set(sx * 0.22, 0.04, 0);
        wings.push({ w, sx });
      }
      const c = { root, wings, tx: 0, tz: 0, perchY: 4, state: 'perched', life: 0, cd: 0, vx: 0, vy: 0, vz: 0 };
      this._relocateCrow(c, null);
      this.crows.push(c);
    }
  }

  _relocateCrow(c, p) {
    let pool = this._perches;
    if (p) {
      const near = pool.filter((t) => Math.hypot(t.x - p.x, t.z - p.z) < CROW_PERCH_RANGE);
      if (near.length) pool = near;
    }
    if (!pool.length) { c.root.setEnabled(false); return; }
    const t = pool[(Math.random() * pool.length) | 0];
    c.tx = t.x; c.tz = t.z;
    c.perchY = this.wg.surfaceY(t.x, t.z) + rand(3.2, 4.6);
    c.root.position.set(t.x, c.perchY, t.z);
    c.root.rotation.set(0, rand(0, 6.28), 0);
    for (const wn of c.wings) wn.w.rotation.y = 0;
    c.state = 'perched';
    c.life = 0;
    c.cd = rand(0, 2);
  }

  _updateCrows(dt, p) {
    for (const c of this.crows) {
      c.cd = Math.max(0, c.cd - dt);
      if (c.state === 'perched') {
        c.root.position.y = c.perchY + Math.sin(this.time * 2 + c.tx) * 0.03;
        if (p && c.cd <= 0 && Math.hypot(p.x - c.root.position.x, p.z - c.root.position.z) < 6) {
          c.state = 'fly';
          c.life = 0;
          const aw = Math.atan2(c.root.position.x - p.x, c.root.position.z - p.z);
          c.vx = Math.sin(aw) * rand(3, 5);
          c.vz = Math.cos(aw) * rand(3, 5);
          c.vy = rand(3.5, 5.5);
        }
      } else {
        c.life += dt;
        c.root.position.x += c.vx * dt;
        c.root.position.y += c.vy * dt;
        c.root.position.z += c.vz * dt;
        c.vy -= dt * 0.6;
        c.root.rotation.y = Math.atan2(c.vx, c.vz);
        const flap = Math.sin(this.time * 22) * 0.9;
        for (const wn of c.wings) wn.w.rotation.y = wn.sx * flap;
        if (c.life > 4 || c.root.position.y > c.perchY + 16) this._relocateCrow(c, p);
      }
    }
  }

  // ── bats ───────────────────────────────────────────────────────────────────

  _buildBats() {
    const m = new BABYLON.StandardMaterial('ash_bat', this.scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#0a0a0e');
    m.emissiveColor = BABYLON.Color3.FromHexString('#0a0a0e');
    m.disableLighting = true;
    m.alpha = 0;
    m.backFaceCulling = false;

    const mesh = BABYLON.MeshBuilder.CreatePlane('ash_bats', { width: 1, height: 0.5 }, this.scene);
    mesh.material = m;
    mesh.isPickable = false;
    // instances wheel around fixed cave mouths across the world disc — skip
    // per-frame culling rather than maintain a giant bounding sphere
    mesh.alwaysSelectAsActiveMesh = true;
    this._batMesh = mesh;
    this._batMat = m;

    this.bats = [];
    for (const cv of this.wg.sites.caves) {
      if (this.wg.inMountain(cv.x, cv.z)) continue; // dressing skips these too
      for (let i = 0; i < BATS_PER_CAVE; i++) {
        this.bats.push({
          cx: cv.x, cz: cv.z, gy: this.wg.surfaceY(cv.x, cv.z),
          ang: rand(0, 6.28), rad: rand(2, 7), yy: rand(3, 6),
          spd: rand(0.6, 1.4), ph: rand(0, 6.28), s: rand(0.16, 0.3),
        });
      }
    }
    this._batMats = new Float32Array(this.bats.length * 16);
    this._batQ = new BABYLON.Quaternion();
    this._batS = new BABYLON.Vector3();
    this._batP = new BABYLON.Vector3();
    this._batM = BABYLON.Matrix.Identity();
  }

  _updateBats(dt, night) {
    const mesh = this._batMesh;
    const on = night > 0.02 && this.bats.length > 0;
    mesh.setEnabled(on);
    if (!on) return;
    this._batMat.alpha = night * 0.9;
    const cam = this.scene.activeCamera;
    for (let i = 0; i < this.bats.length; i++) {
      const b = this.bats[i];
      b.ang += b.spd * dt;
      const x = b.cx + Math.cos(b.ang) * b.rad;
      const z = b.cz + Math.sin(b.ang) * b.rad;
      const y = b.gy + b.yy + Math.sin(this.time * 2 + b.ph) * 0.8;
      // Y-billboard toward the camera; wing flap as horizontal squash
      const yaw = cam ? Math.atan2(cam.position.x - x, cam.position.z - z) : 0;
      BABYLON.Quaternion.FromEulerAnglesToRef(0, yaw, 0, this._batQ);
      const flap = 0.5 + Math.abs(Math.sin(this.time * 16 + b.ph)) * 0.8;
      this._batS.set(b.s * flap, b.s * 0.5, b.s);
      this._batP.set(x, y, z);
      BABYLON.Matrix.ComposeToRef(this._batS, this._batQ, this._batP, this._batM);
      this._batMats.set(this._batM.m, i * 16);
    }
    mesh.thinInstanceSetBuffer('matrix', this._batMats, 16, false);
  }

  // ── frame tick ─────────────────────────────────────────────────────────────

  _update() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    const p = this.getPlayerPos?.();
    const dayF = this.scene.metadata?.ashwood?.lm?.dayFactor ?? 1;
    const night = Math.max(0, Math.min(1, 1 - dayF * 1.6 + 0.12));
    this._updateRabbits(dt, p);
    this._updateCrows(dt, p);
    this._updateBats(dt, night);
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    for (const c of this.crows ?? []) c.root.dispose(); // recurses into instances
    for (const r of this.rabbits ?? []) r.inst.dispose();
    this._rabbitTpl?.dispose();
    this._crowBodyTpl?.dispose();
    this._crowWingTpl?.dispose();
    this._batMesh?.dispose();
  }
}
