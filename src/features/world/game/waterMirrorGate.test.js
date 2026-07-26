import { describe, it, expect } from 'vitest';
import {
  resolveMirrorRefreshRate,
  MIRROR_OFF,
  MIRROR_GATE_DEFAULTS as D,
} from './waterMirrorGate.js';

// Stillmere's authored radius (zone1_world.json lake.waterR), so the cases below
// read in the same units the scene passes.
const R = 27;

describe('resolveMirrorRefreshRate', () => {
  it('refreshes every frame at the water edge', () => {
    expect(resolveMirrorRefreshRate({ distance: R, waterRadius: R })).toBe(1);
    expect(resolveMirrorRefreshRate({ distance: 0, waterRadius: R })).toBe(1);
  });

  it('steps down through the distance bands', () => {
    const at = (edge) => resolveMirrorRefreshRate({ distance: R + edge, waterRadius: R });
    expect(at(D.fullRange - 1)).toBe(1);
    expect(at(D.fullRange + 1)).toBe(2);
    expect(at(D.halfRange + 1)).toBe(3);
    expect(at(D.quarterRange + 1)).toBe(MIRROR_OFF);
  });

  it('holds the reflection inside the castle and dungeons, however close the lake is', () => {
    // The interior region sits at its own coordinates, so a raw planar distance
    // to the lake can be small while no water is rendered at all.
    expect(resolveMirrorRefreshRate({ distance: 0, waterRadius: R, indoors: true })).toBe(MIRROR_OFF);
  });

  it('holds until the avatar has a position (load window)', () => {
    expect(resolveMirrorRefreshRate({ distance: NaN, waterRadius: R })).toBe(MIRROR_OFF);
    expect(resolveMirrorRefreshRate({ distance: Infinity, waterRadius: R })).toBe(MIRROR_OFF);
  });

  it('applies hysteresis so walking the boundary cannot flap a full scene render', () => {
    // Just inside the off-edge: on when we were on, still off when we were off.
    const distance = R + D.quarterRange - 1;
    expect(resolveMirrorRefreshRate({ distance, waterRadius: R, wasOff: false })).toBe(3);
    expect(resolveMirrorRefreshRate({ distance, waterRadius: R, wasOff: true })).toBe(MIRROR_OFF);

    // Far enough past the hysteresis band, an off mirror comes back.
    const inside = R + D.quarterRange - D.hysteresis - 1;
    expect(resolveMirrorRefreshRate({ distance: inside, waterRadius: R, wasOff: true })).not.toBe(MIRROR_OFF);
  });

  it('measures from the water edge, not the lake centre', () => {
    // Same absolute distance, different lake size → different band.
    const distance = R + D.fullRange + 1;
    expect(resolveMirrorRefreshRate({ distance, waterRadius: R })).toBe(2);
    expect(resolveMirrorRefreshRate({ distance, waterRadius: R + 10 })).toBe(1);
  });
});
