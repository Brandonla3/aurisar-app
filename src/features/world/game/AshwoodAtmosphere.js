/**
 * AshwoodAtmosphere — drifting clouds, sunlit dust motes, and night
 * fireflies. Ports the prototype's buildClouds/updateClouds (~1012),
 * buildMotes (~844) and buildFireflies (~1114) as lightweight billboards.
 *
 * Clouds: 9 camera-facing planes sharing one canvas blob texture, drifting
 * on the wind, fading at night and warming at dusk. Motes/fireflies: small
 * additive billboards orbiting the player (motes by day, fireflies by
 * night). ~35 small draw calls total, all alpha-blended quads.
 */

/* global BABYLON */

export class AshwoodAtmosphere {
  constructor(scene, worldgen, getPlayerPos) {
    this.scene = scene;
    this.wg = worldgen;
    this.getPlayerPos = getPlayerPos;
    this.time = 0;

    // Clouds intentionally absent for now: large billboarded planes read as
    // dark walls under the tone-mapped pipeline. Follow-up: cloud impostors
    // or a shader-dome layer (tracked in the PR checklist).
    this.clouds = [];
    this._buildSparks();
    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  _cloudTexture() {
    const tex = new BABYLON.DynamicTexture('ash_cloud_tex', { width: 256, height: 128 }, this.scene, false);
    tex.hasAlpha = true;
    const c = tex.getContext();
    c.clearRect(0, 0, 256, 128);
    for (let i = 0; i < 14; i++) {
      const gx = 40 + Math.random() * 176, gy = 44 + Math.random() * 44, gr = 18 + Math.random() * 30;
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(gx, gy, gr, 0, 6.283);
      c.fill();
    }
    tex.update();
    return tex;
  }

  _buildClouds() {
    const tex = this._cloudTexture();
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const w = 70 + Math.random() * 80;
      const mat = new BABYLON.StandardMaterial(`ash_cloud_m${i}`, this.scene);
      // Unlit white blobs: emissive texture carries the shape; the same
      // texture as opacity keeps edges soft. Day/night fade via alpha only.
      mat.emissiveTexture = tex;
      mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.opacityTexture = tex;
      mat.alpha = 0.5;
      mat.backFaceCulling = false;
      mat.fogEnabled = false;
      const plane = BABYLON.MeshBuilder.CreatePlane(`ash_cloud${i}`, { width: w, height: w * 0.42 }, this.scene);
      plane.material = mat;
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      plane.applyFog = false;
      const a = Math.random() * 6.28, rr = 120 + Math.random() * 340;
      plane.position.set(Math.cos(a) * rr, 95 + Math.random() * 55, Math.sin(a) * rr);
      this.clouds.push({ plane, mat, vx: 0.4 + Math.random() * 0.7, base: 0.3 + Math.random() * 0.25, ph: Math.random() * 6.28 });
    }
  }

  _buildSparks() {
    // shared 1-blob additive texture for motes + fireflies
    const tex = new BABYLON.DynamicTexture('ash_spark_tex', { width: 32, height: 32 }, this.scene, false);
    tex.hasAlpha = true;
    const c = tex.getContext();
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    tex.update();

    const mkSet = (name, count, colorHex) => {
      const mat = new BABYLON.StandardMaterial(`${name}_m`, this.scene);
      mat.emissiveColor = BABYLON.Color3.FromHexString(colorHex);
      mat.disableLighting = true;
      mat.opacityTexture = tex;
      mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
      mat.fogEnabled = false;
      const out = [];
      for (let i = 0; i < count; i++) {
        const s = name === 'ash_mote' ? 0.05 + Math.random() * 0.07 : 0.07 + Math.random() * 0.07;
        const p = BABYLON.MeshBuilder.CreatePlane(`${name}${i}`, { size: s * 4 }, this.scene);
        p.material = mat;
        p.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        p.isPickable = false;
        p.applyFog = false;
        out.push({
          p, mat,
          ang: Math.random() * 6.28, rad: 2 + Math.random() * 26,
          yy: 0.4 + Math.random() * 2.2, spd: 0.1 + Math.random() * 0.5,
          ph: Math.random() * 6.28, blink: 1.4 + Math.random() * 1.8,
        });
      }
      return { list: out, mat };
    };
    this.motes = mkSet('ash_mote', 14, '#ffe9b0');
    this.flies = mkSet('ash_fly', 16, '#c8f06a');
  }

  _update() {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    this.time += dt;
    const lm = this.scene.metadata?.ashwood?.lm;
    const dayF = lm?.dayFactor ?? 1;
    const dusk = lm?.duskFactor ?? 0;
    const night = Math.max(0, Math.min(1, 1 - dayF * 1.6 + 0.12));
    const p = this.getPlayerPos?.();

    for (const cl of this.clouds) {
      cl.plane.position.x += cl.vx * dt;
      if (cl.plane.position.x > 560) cl.plane.position.x = -560;
      cl.mat.alpha = Math.max(0,
        cl.base * (0.25 + 0.75 * dayF) * (1 - dusk * 0.25) +
        Math.sin(this.time * 0.05 + cl.ph) * 0.04);
    }

    if (!p) return;
    this.motes.mat.alpha = 0.45 * dayF;
    for (const m of this.motes.list) {
      m.ang += 0.1 * m.spd * dt;
      m.p.position.set(
        p.x + Math.cos(m.ang) * m.rad,
        p.y + m.yy + Math.sin(this.time * 0.8 + m.ph) * 0.4 + 0.7,
        p.z + Math.sin(m.ang * 0.7) * m.rad,
      );
    }
    this.flies.mat.alpha = 0.85 * night;
    for (const f of this.flies.list) {
      f.ang += 0.24 * f.spd * dt * 6.28;
      const x = p.x + Math.cos(f.ang) * f.rad;
      const z = p.z + Math.sin(f.ang * 0.8) * f.rad;
      const blink = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * f.blink + f.ph));
      f.p.position.set(x, this.wg.surfaceY(x, z) + f.yy + 0.5, z);
      f.p.scaling.setAll(0.6 + blink);
    }
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    for (const c of this.clouds) { c.plane.dispose(); c.mat.dispose(); }
    for (const s of [...this.motes.list, ...this.flies.list]) s.p.dispose();
    this.motes.mat.dispose();
    this.flies.mat.dispose();
  }
}
