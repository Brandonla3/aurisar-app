/**
 * AshwoodWeather — the prototype's weather system (~2004-2040) plus its
 * shooting stars (~1044): a slow wet/dry cycle, a player-following rain
 * line-field, lightning flashes during heavy rain, and rare night streaks.
 *
 * Client-local cosmetics (Math.random allowed). Weather state is published
 * on scene.metadata.ashwood.weather so other systems can react — the grass
 * shader reads windStrength for storm-swept blades.
 *
 * Order matters: this observer must register AFTER the LightingManager's
 * (instantiate later in scene setup) so lightning bumps land on top of the
 * LM's per-frame intensity writes instead of being overwritten.
 *
 * Thunder SFX from the prototype is skipped — there's no overworld audio
 * system yet.
 */

/* global BABYLON */

const RAIN_MAX = 1600;
const RAIN_R = 14;        // rain volume half-extent around the player

const rand = (a, b) => a + Math.random() * (b - a);

export class AshwoodWeather {
  constructor(scene, lm, getPlayerPos) {
    this.scene = scene;
    this.lm = lm;
    this.getPlayerPos = getPlayerPos;
    this.time = 0;

    // weather state (prototype globals wet/wetTarget/weatherTimer/lightning)
    this.wet = 0;
    this.wetTarget = 0;
    this.weatherTimer = 10;
    this.lightning = 0;
    this.windStrength = 1;

    this._buildRain();
    this._buildShootingStar();

    scene.metadata = scene.metadata || {};
    scene.metadata.ashwood = scene.metadata.ashwood || {};
    scene.metadata.ashwood.weather = this;

    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  // ── rain: one LinesMesh, RAIN_MAX streak segments recycled around the player
  _buildRain() {
    const lines = [];
    this._drops = new Float32Array(RAIN_MAX * 3); // x, y, z (head; tail derived)
    this._dropVy = new Float32Array(RAIN_MAX);
    for (let i = 0; i < RAIN_MAX; i++) {
      this._drops[i * 3] = rand(-RAIN_R, RAIN_R);
      this._drops[i * 3 + 1] = rand(-2, 18);
      this._drops[i * 3 + 2] = rand(-RAIN_R, RAIN_R);
      this._dropVy[i] = rand(30, 46);
      lines.push([BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()]);
    }
    this._rainPos = new Float32Array(RAIN_MAX * 6);
    this.rain = BABYLON.MeshBuilder.CreateLineSystem('ash_rain', { lines, updatable: true }, this.scene);
    this.rain.color = BABYLON.Color3.FromHexString('#b6c2d2');
    this.rain.alpha = 0.42;
    this.rain.isPickable = false;
    this.rain.alwaysSelectAsActiveMesh = true; // surrounds the camera
    this.rain.setEnabled(false);
  }

  _buildShootingStar() {
    const m = new BABYLON.StandardMaterial('ash_star', this.scene);
    m.emissiveColor = BABYLON.Color3.FromHexString('#eef4ff');
    m.disableLighting = true;
    m.alphaMode = BABYLON.Engine.ALPHA_ADD;
    m.alpha = 0;
    m.fogEnabled = false;
    m.backFaceCulling = false;
    const p = BABYLON.MeshBuilder.CreatePlane('ash_shootingstar', { width: 6.5, height: 0.32 }, this.scene);
    p.material = m;
    p.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    p.isPickable = false;
    p.applyFog = false;
    p.alwaysSelectAsActiveMesh = true;
    this.star = p;
    this._starMat = m;
    this._starVel = new BABYLON.Vector3();
    this._starT = 9;     // seconds until the next streak
    this._starLife = 0;
  }

  _update() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    const lm = this.lm;
    const overworld = lm.profile === 'overworld';
    const p = this.getPlayerPos?.();

    // wet/dry cycle: dry half the time, drizzle 30%, downpour 20%
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const r = Math.random();
      this.wetTarget = r < 0.5 ? 0 : r < 0.8 ? 0.5 : 1.0;
      this.weatherTimer = rand(35, 80);
    }
    this.wet += (this.wetTarget - this.wet) * Math.min(1, dt * 0.3);
    this.windStrength = 1 + this.wet * 1.7 + Math.sin(this.time * 0.3) * 0.4;

    // rain field
    const active = Math.floor(this.wet * RAIN_MAX);
    const raining = overworld && active > 3 && !!p;
    this.rain.setEnabled(raining);
    if (raining) {
      const d = this._drops, vy = this._dropVy, out = this._rainPos;
      for (let i = 0; i < RAIN_MAX; i++) {
        const o = i * 6, k = i * 3;
        if (i < active) {
          let y = d[k + 1] - vy[i] * dt;
          if (y < -2) {
            y = 16 + Math.random() * 4;
            d[k] = (Math.random() * 2 - 1) * RAIN_R;
            d[k + 2] = (Math.random() * 2 - 1) * RAIN_R;
          }
          d[k + 1] = y;
          out[o] = d[k];     out[o + 1] = y;       out[o + 2] = d[k + 2];
          out[o + 3] = d[k] + 0.25; out[o + 4] = y - 0.8; out[o + 5] = d[k + 2];
        } else {
          // degenerate zero-length segment — rasterizes to nothing
          out[o] = out[o + 3] = 0;
          out[o + 1] = out[o + 4] = -1000;
          out[o + 2] = out[o + 5] = 0;
        }
      }
      this.rain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, out, false, false);
      this.rain.position.set(p.x, p.y, p.z);
    }

    // lightning during a downpour — additive bump after the LM's writes
    if (overworld && this.wet > 0.72 && Math.random() < dt * 0.16) this.lightning = 0.2;
    if (this.lightning > 0) {
      this.lightning -= dt;
      const L = Math.max(0, this.lightning);
      lm.fillOverworld.intensity += L * 4;
      lm.key.intensity += L * 1.5;
    }

    this._updateShootingStar(dt, overworld);
  }

  _updateShootingStar(dt, overworld) {
    const dayF = this.lm.dayFactor ?? 1;
    const nf = Math.max(0, Math.min(1, 1 - dayF * 1.6 + 0.12));
    if (this._starLife > 0) {
      this._starLife -= dt;
      this.star.position.addInPlace(this._starVel.scale(dt));
      const k = Math.max(0, Math.min(1, this._starLife / 0.8));
      this._starMat.alpha = Math.sin(k * Math.PI) * 0.9 * nf;
      if (this._starLife <= 0) this._starMat.alpha = 0;
      return;
    }
    if (!overworld || nf < 0.55) return;
    this._starT -= dt;
    if (this._starT <= 0) {
      this._starT = rand(7, 18);
      this._starLife = 0.8;
      const p = this.getPlayerPos?.() ?? { x: 0, z: 0 };
      this.star.position.set(p.x + rand(-220, 220), rand(140, 185), p.z + rand(-220, 220));
      this._starVel.set(rand(-1, 1), rand(-0.5, -0.2), rand(-1, 1))
        .normalize().scaleInPlace(rand(160, 230));
    }
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    if (this.scene.metadata?.ashwood?.weather === this) {
      delete this.scene.metadata.ashwood.weather;
    }
    this.rain?.dispose();
    this.star?.dispose();
    this._starMat?.dispose();
  }
}
