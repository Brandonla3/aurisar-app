import { describe, expect, it } from 'vitest';
import { createTerrainField } from './terrainField.js';
import {
  MAX_WALK_SLOPE,
  SPRINT_MULT,
  WALK_SPEED_MPS,
  createWalkerState,
  integrateWalker,
} from './walker.js';
import { BUTTON, createInputSnapshot, setButton } from '../sim/InputSnapshot.js';
import { MOVE_LIMITS } from '../sim/rules/moveRules.js';

const field = createTerrainField();
const flat = createTerrainField({ baseAmplitudeM: 0, mountainAmplitudeM: 0, ravineDepthM: 0 });

const forward = () => {
  const s = createInputSnapshot();
  s.moveZ = 1;
  return s;
};

describe('createWalkerState', () => {
  it('starts on the ground, not at y=0', () => {
    const w = createWalkerState(10, 10, field);
    expect(w.y).toBe(field.surfaceY(10, 10));
  });
});

describe('integrateWalker', () => {
  it('stands still on empty input', () => {
    const w = createWalkerState(0, 0, field);
    const next = integrateWalker(w, createInputSnapshot(), 16, field);
    expect(next.x).toBe(0);
    expect(next.z).toBe(0);
    expect(next.speedMps).toBe(0);
  });

  it('walks at WALK_SPEED_MPS on flat ground', () => {
    const w = createWalkerState(0, 0, flat);
    const next = integrateWalker(w, forward(), 1000, flat);
    expect(next.z).toBeCloseTo(WALK_SPEED_MPS, 5);
    expect(next.speedMps).toBeCloseTo(WALK_SPEED_MPS, 5);
  });

  it('sprints under the server speed cap — the constants must compose', () => {
    // walker's fastest legitimate speed must fit inside moveRules' budget, or
    // the server clamps honest sprinting players. This is the cross-module
    // contract; if either constant changes, this fails and forces the pairing
    // to be re-decided together.
    expect(WALK_SPEED_MPS * SPRINT_MULT).toBeLessThan(MOVE_LIMITS.maxSpeedMps);

    const w = createWalkerState(0, 0, flat);
    const snap = forward();
    setButton(snap, BUTTON.SPRINT, true);
    const next = integrateWalker(w, snap, 1000, flat);
    expect(next.speedMps).toBeCloseTo(WALK_SPEED_MPS * SPRINT_MULT, 5);
  });

  it('y always follows the field — no gravity state to desync', () => {
    const w = createWalkerState(0, 0, field);
    const next = integrateWalker(w, forward(), 500, field);
    expect(next.y).toBe(field.surfaceY(next.x, next.z));
  });

  it('moves camera-relative', () => {
    // Pushing "forward" with the camera yawed 90° must move along +X, not +Z.
    const w = createWalkerState(0, 0, flat);
    const snap = forward();
    snap.yaw = Math.PI / 2;
    const next = integrateWalker(w, snap, 1000, flat);
    expect(next.x).toBeCloseTo(WALK_SPEED_MPS, 4);
    expect(Math.abs(next.z)).toBeLessThan(0.001);
  });

  it('refuses to walk up a wall', () => {
    // Build a synthetic field with a hard slope wall along x >= 1.
    const wallField = {
      surfaceY: (x) => (x >= 1 ? 100 : 0),
      slopeAt: (x) => (x >= 1 ? 1 : 0),
    };
    const w = { x: 0.9, z: 0, y: 0, yaw: 0, speedMps: 0 };
    const snap = createInputSnapshot();
    snap.moveX = 1; // straight at the wall
    const next = integrateWalker(w, snap, 1000, wallField);
    expect(next.x).toBe(0.9); // did not enter the wall
  });

  it('slides along a wall instead of sticking to it', () => {
    // Moving diagonally into the wall: the X component is blocked, the Z
    // component must survive — collide-and-slide, not full stop.
    const wallField = {
      surfaceY: (x) => (x >= 1 ? 100 : 0),
      slopeAt: (x) => (x >= 1 ? 1 : 0),
    };
    const w = { x: 0.9, z: 0, y: 0, yaw: 0, speedMps: 0 };
    const snap = createInputSnapshot();
    snap.moveX = 1;
    snap.moveZ = 1;
    const next = integrateWalker(w, snap, 1000, wallField);
    expect(next.x).toBe(0.9);        // blocked axis held
    expect(next.z).toBeGreaterThan(1); // free axis moved
  });

  it('eases yaw toward the travel direction rather than snapping', () => {
    const w = createWalkerState(0, 0, flat);
    const snap = createInputSnapshot();
    snap.moveX = 1; // travel +X = yaw pi/2
    const one = integrateWalker(w, snap, 16, flat);
    expect(one.yaw).toBeGreaterThan(0);
    expect(one.yaw).toBeLessThan(Math.PI / 2); // partway there, not snapped

    // And it converges after sustained travel.
    let s = one;
    for (let i = 0; i < 60; i++) s = integrateWalker(s, snap, 16, flat);
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it('does not mutate the previous state', () => {
    const w = createWalkerState(0, 0, flat);
    integrateWalker(w, forward(), 100, flat);
    expect(w.z).toBe(0);
  });
});
