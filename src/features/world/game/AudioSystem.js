/**
 * AudioSystem — minimal SFX layer for the world (Batch C).
 *
 * The world shipped silent ("there's no overworld audio" — AshwoodWeather).
 * This plays short one-shot sound effects (weapon swing, hit, loot, UI) on
 * Babylon's audio engine. Assets are the procedurally-synthesized WAVs under
 * /assets/audio/ (scripts/build_audio_sfx.mjs) — real recorded/licensed audio
 * drops in at the same filenames later, and per-biome ambient beds arrive with
 * the Batch F biome kits.
 *
 * Browsers block audio until a user gesture, so playback stays a no-op until
 * `unlock()` succeeds (wired to the first pointer/key input). A muted flag and
 * a graceful "sound failed to load" fallback keep it non-fatal — audio must
 * never break the world.
 */

/* global BABYLON */

const BASE = '/assets/audio/';
const SFX = ['swing', 'hit', 'loot', 'ui'];

export class AudioSystem {
  constructor(scene, { muted = false } = {}) {
    this._scene = scene;
    this._muted = muted;
    this._unlocked = false;
    this._sounds = new Map();
    this._ready = false;

    // Babylon's audio engine may be absent (headless / NullEngine / audio
    // disabled) — degrade to a silent no-op rather than throwing.
    try {
      for (const name of SFX) {
        const snd = new BABYLON.Sound(
          `sfx_${name}`, `${BASE}${name}.wav`, scene, null,
          { autoplay: false, loop: false, spatialSound: false, volume: 0.5 },
        );
        this._sounds.set(name, snd);
      }
      this._ready = true;
    } catch {
      this._ready = false;
    }
  }

  /** Unlock the audio context after a user gesture (idempotent). */
  unlock() {
    if (this._unlocked) return;
    try {
      const eng = BABYLON.Engine?.audioEngine;
      if (eng?.unlock) eng.unlock();
      this._unlocked = true;
    } catch { /* non-fatal */ }
  }

  setMuted(muted) { this._muted = !!muted; }
  get muted() { return this._muted; }

  /**
   * Play a one-shot SFX by name. No-op until unlocked / if muted / if the
   * sound didn't load. Restarts the clip if it's already playing (fine for
   * short overlapping combat SFX).
   */
  play(name) {
    if (this._muted || !this._ready || !this._unlocked) return;
    const snd = this._sounds.get(name);
    if (!snd || !snd.isReady?.()) return;
    try { snd.stop(); snd.play(); } catch { /* non-fatal */ }
  }

  dispose() {
    this._sounds.forEach((s) => { try { s.dispose(); } catch { /* ignore */ } });
    this._sounds.clear();
    this._ready = false;
  }
}
