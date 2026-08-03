/**
 * FogDriver.test.js — the only side-effectful atmosphere code, contract-locked.
 *
 * The driver needs no BABYLON: it calls methods on objects it is handed. So a
 * fake scene with recording copyFromFloats is a faithful test double — what is
 * asserted here is exactly the write contract the real scene receives.
 */
import { describe, expect, it } from 'vitest';
import { FogDriver } from './FogDriver.js';
import { playlistStateAt } from '../../model/skyPlaylist.js';
import { skyStateFrom } from '../../model/skyModel.js';
import { cloudFactorAt, applyCloudDimming } from '../../model/cloudShadow.js';

const colorSlot = () => ({
  r: 0, g: 0, b: 0, a: 1,
  copies: 0,
  copyFromFloats(r, g, b, a) {
    this.r = r; this.g = g; this.b = b;
    if (a !== undefined) this.a = a;
    this.copies += 1;
    return this;
  },
});

const fakeScene = () => ({ fogColor: colorSlot(), clearColor: colorSlot(), fogDensity: 0 });
const fakeLight = () => ({ direction: colorSlot(), diffuse: colorSlot(), intensity: 0 });

describe('FogDriver.update', () => {
  it('writes fog, density and clear color from one skyState', () => {
    const scene = fakeScene();
    const d = new FogDriver(scene);
    const s = d.update(5 * 60_000);

    expect([scene.fogColor.r, scene.fogColor.g, scene.fogColor.b]).toEqual(s.fogColor);
    expect(scene.fogDensity).toBe(s.fogDensity);
    expect([scene.clearColor.r, scene.clearColor.g, scene.clearColor.b]).toEqual(s.clearColor);
  });

  it('MUTATES the existing color objects, never replaces them', () => {
    // The historical production bug: a writer swapped scene.fogColor for a new
    // object while a shader held the old reference. The driver must only call
    // copyFromFloats on the instances the scene already owns.
    const scene = fakeScene();
    const fogRef = scene.fogColor;
    const clearRef = scene.clearColor;
    const d = new FogDriver(scene);
    d.update(0);
    d.update(90_000);

    expect(scene.fogColor).toBe(fogRef);
    expect(scene.clearColor).toBe(clearRef);
    expect(fogRef.copies).toBe(2);
  });

  it('preserves clear alpha at 1 across writes', () => {
    const scene = fakeScene();
    new FogDriver(scene).update(0);
    expect(scene.clearColor.a).toBe(1);
  });

  it('points the sun light FROM the sun and copies tint and intensity', () => {
    const scene = fakeScene();
    const sun = fakeLight();
    const d = new FogDriver(scene, { sunLight: sun });
    const s = d.update(10 * 60_000);

    expect(sun.direction.r).toBeCloseTo(-s.sunDir[0], 10);
    expect(sun.direction.g).toBeCloseTo(-s.sunDir[1], 10);
    expect(sun.direction.b).toBeCloseTo(-s.sunDir[2], 10);
    expect(sun.intensity).toBe(s.sunIntensity);
    expect([sun.diffuse.r, sun.diffuse.g, sun.diffuse.b]).toEqual(s.sunTint);
  });

  it('drives the ambient light and the dome from the SAME state object', () => {
    const scene = fakeScene();
    const ambient = fakeLight();
    let domeState = null;
    const d = new FogDriver(scene, { ambientLight: ambient, applyDomeState: (s) => { domeState = s; } });
    const s = d.update(3 * 60_000);

    expect(ambient.intensity).toBe(s.ambientIntensity);
    expect(domeState).toBe(s); // identity, not a copy — one evaluation, all consumers
  });

  it('matches the pure pipeline exactly — playlist, then cloud dimming, no third opinion', () => {
    const scene = fakeScene();
    const d = new FogDriver(scene, {}, { epochMs: 1_000, timeScale: 2 });
    const s = d.update(4_321);
    const rawExpected = skyStateFrom(playlistStateAt(4_321 * 2, 1_000));
    // Cloud time is nowMs itself, NOT timeScale'd or epoch'd — see FogDriver's
    // update(): weather drifts on its own clock, independent of the dev-only
    // timewarp lens that compresses day/night.
    const expected = applyCloudDimming(rawExpected, cloudFactorAt(4_321));
    expect(s.fogColor).toEqual(expected.fogColor);
    expect(s.fogDensity).toBe(expected.fogDensity);
    expect(s.sunIntensity).toBe(expected.sunIntensity);
  });

  it('exposes the evaluated cloud factor alongside state', () => {
    const scene = fakeScene();
    const d = new FogDriver(scene);
    expect(d.cloudFactor).toBeNull();
    d.update(4_321);
    expect(d.cloudFactor).toBe(cloudFactorAt(4_321));
  });

  it('cloud dimming actually reaches the scene — sun intensity is the dimmed value, not the raw stance one', () => {
    // Pins that update() writes the CLOUD-DIMMED state, not skyStateFrom's
    // direct output — the P4c behavior change this file's header documents.
    const scene = fakeScene();
    const sun = fakeLight();
    const d = new FogDriver(scene, { sunLight: sun });
    d.update(4_321);
    const rawExpected = skyStateFrom(playlistStateAt(4_321));
    expect(sun.intensity).toBeCloseTo(rawExpected.sunIntensity * cloudFactorAt(4_321), 10);
  });

  it('exposes the last state for mood-bus readers, null before first tick', () => {
    const d = new FogDriver(fakeScene());
    expect(d.state).toBeNull();
    const s = d.update(0);
    expect(d.state).toBe(s);
  });

  it('tolerates a rig with no lights and no dome', () => {
    expect(() => new FogDriver(fakeScene()).update(999)).not.toThrow();
  });
});
