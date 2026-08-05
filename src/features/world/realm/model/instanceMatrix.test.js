/**
 * instanceMatrix.test.js — the hand-rolled matrix math, pinned. Small on
 * purpose: the algebra was review-verified by hand; these assertions keep
 * it that way through refactors (the file previously had no sibling test).
 */
import { describe, expect, it } from 'vitest';
import { writeInstanceMatrix } from './instanceMatrix.js';

const write = (p) => {
  const out = new Float32Array(16);
  writeInstanceMatrix(out, 0, p);
  return out;
};

describe('writeInstanceMatrix', () => {
  it('puts translation in elements 12..14 with w=1 (Babylon storage layout)', () => {
    const m = write({ x: 7, y: 8, z: 9 });
    expect([m[12], m[13], m[14], m[15]]).toEqual([7, 8, 9, 1]);
  });

  it('scales each axis: |localX| = |localZ| = sxz, |localY| = sy, exactly', () => {
    const m = write({ x: 0, y: 0, z: 0, yaw: 0.7, sxz: 2, sy: 3, leanAngle: 0.1, leanAxisX: 1, leanAxisZ: 0 });
    const len = (a, b, c) => Math.hypot(a, b, c);
    expect(len(m[0], m[1], m[2])).toBeCloseTo(2, 6);
    expect(len(m[4], m[5], m[6])).toBeCloseTo(3, 6);
    expect(len(m[8], m[9], m[10])).toBeCloseTo(2, 6);
  });

  it('yaw alone rotates in the XZ plane and leaves Y untouched', () => {
    const m = write({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 });
    // Row-vector convention: local +X maps to row 0.
    expect(m[0]).toBeCloseTo(0, 6);
    expect(m[2]).toBeCloseTo(-1, 6);
    expect([m[4], m[5], m[6]]).toEqual([0, 1, 0]);
  });

  it('zero lean is exactly the scale-yaw matrix — no rotAxis noise', () => {
    const a = write({ x: 1, y: 2, z: 3, yaw: 0.3, sxz: 1.5, sy: 1.2 });
    const b = write({ x: 1, y: 2, z: 3, yaw: 0.3, sxz: 1.5, sy: 1.2, leanAngle: 0 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('lean tips the local Y axis while preserving its length', () => {
    const m = write({ x: 0, y: 0, z: 0, sy: 1, leanAxisX: 1, leanAxisZ: 0, leanAngle: 0.2 });
    // Y axis no longer straight up, magnitude still 1.
    expect(Math.abs(m[4]) + Math.abs(m[6])).toBeGreaterThan(0);
    expect(Math.hypot(m[4], m[5], m[6])).toBeCloseTo(1, 6);
    expect(m[5]).toBeCloseTo(Math.cos(0.2), 6);
  });

  it('is deterministic and writes at the given offset without touching neighbors', () => {
    const out = new Float32Array(48).fill(99);
    writeInstanceMatrix(out, 16, { x: 1, y: 2, z: 3 });
    expect(out[0]).toBe(99);
    expect(out[15]).toBe(99);
    expect(out[28]).toBe(1); // 16 + 12
    expect(out[32]).toBe(99);
  });
});
