import { describe, expect, it } from 'vitest';
import {
  CYCLE_MS,
  PLAYLIST_TOTAL_MS,
  STANCES,
  blendStances,
  nextStanceStart,
  playlistStateAt,
} from './skyPlaylist.js';

describe('playlist structure', () => {
  it('segments sum exactly to the declared cycle length', () => {
    // The 40-minute promise ("every median session banks a dusk or dawn")
    // only holds if the authored dwell/blend times actually add up.
    expect(PLAYLIST_TOTAL_MS).toBe(CYCLE_MS);
  });

  it('the dramatic states outweigh the boring one', () => {
    const dwell = (id) => STANCES.find((s) => s.id === id).dwellMs;
    expect(dwell('gloaming')).toBeGreaterThan(dwell('high-noon'));
    expect(dwell('dawnfire')).toBeGreaterThan(dwell('high-noon'));
  });

  it('no adjacent sun directions are near-antipodal (spline degeneracy)', () => {
    // Catmull-Rom through nearly-opposed directions collapses through zero
    // and the normalized result whips across the sky. Authoring rule: every
    // adjacent pair keeps a healthy chord.
    const toDir = (s) => {
      const el = (s.sun.elevDeg * Math.PI) / 180;
      const az = (s.sun.azDeg * Math.PI) / 180;
      return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    };
    for (let i = 0; i < STANCES.length; i++) {
      const a = toDir(STANCES[i]);
      const b = toDir(STANCES[(i + 1) % STANCES.length]);
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot, `${STANCES[i].id} -> ${STANCES[(i + 1) % STANCES.length].id}`)
        .toBeGreaterThan(-0.55);
    }
  });

  it('a median-length session always contains a dramatic stance', () => {
    // The retention read of the design: the longest stretch of the cycle
    // WITHOUT dawnfire or gloaming active must fit inside a short session.
    const isDramatic = (id) => id.includes('dawnfire') || id.includes('gloaming');
    const stepMs = 5_000;
    let worstGap = 0;
    let gap = 0;
    for (let t = 0; t < CYCLE_MS * 2; t += stepMs) {
      if (isDramatic(playlistStateAt(t).stanceId)) gap = 0;
      else gap += stepMs;
      worstGap = Math.max(worstGap, gap);
    }
    expect(worstGap).toBeLessThanOrEqual(20 * 60_000);
  });
});

describe('playlistStateAt', () => {
  it('is a pure function of time — same input, same sky, every client', () => {
    const a = playlistStateAt(1234567);
    const b = playlistStateAt(1234567);
    expect(a).toEqual(b);
  });

  it('holds the stance verbatim during a dwell', () => {
    const state = playlistStateAt(60_000); // inside dawnfire's 4-min dwell
    expect(state.segmentKind).toBe('dwell');
    expect(state.stanceId).toBe('dawnfire');
    expect(state.stops).toEqual(STANCES[0].stops);
  });

  it('wraps: one full cycle later is the identical sky', () => {
    const a = playlistStateAt(500_000);
    const b = playlistStateAt(500_000 + CYCLE_MS);
    expect(a).toEqual(b);
  });

  it('handles times before the epoch without going negative', () => {
    const state = playlistStateAt(-90_000, 0);
    expect(state.phase01).toBeGreaterThanOrEqual(0);
    expect(state.phase01).toBeLessThan(1);
  });

  it('colors are continuous across every segment boundary', () => {
    // C0 in color: stepping 1s at a time across two cycles, no channel jumps.
    let prev = playlistStateAt(0);
    for (let t = 1_000; t < CYCLE_MS * 2; t += 1_000) {
      const cur = playlistStateAt(t);
      for (const k of ['horizon', 'mid', 'zenith', 'glow']) {
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(cur.stops[k][c] - prev.stops[k][c]),
            `stops.${k}[${c}] jump at t=${t}`).toBeLessThan(0.02);
        }
      }
      expect(Math.abs(cur.fogDensity - prev.fogDensity)).toBeLessThan(0.0002);
      prev = cur;
    }
  });

  it('the sun moves continuously — no parking, no lurching', () => {
    // The load-bearing risk of authored time: the sun is a MOTION. It is
    // splined over raw phase (not the dwell schedule), so per-second angular
    // travel stays bounded even across dwell/blend boundaries.
    let prev = playlistStateAt(0).sunDir;
    let maxStep = 0;
    for (let t = 1_000; t < CYCLE_MS * 2; t += 1_000) {
      const cur = playlistStateAt(t).sunDir;
      const dot = Math.min(1, prev[0] * cur[0] + prev[1] * cur[1] + prev[2] * cur[2]);
      maxStep = Math.max(maxStep, Math.acos(dot));
      prev = cur;
    }
    // Full circle in 40 min ≈ 0.0026 rad/s mean; allow spline unevenness but
    // never a visible snap (0.02 rad/s ≈ 8x mean is still imperceptible).
    expect(maxStep).toBeLessThan(0.02);
  });

  it('sun direction is always unit length', () => {
    for (let t = 0; t < CYCLE_MS; t += 30_000) {
      const d = playlistStateAt(t).sunDir;
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6);
    }
  });

  it('night actually happens: the sun dips below the horizon in moonwash', () => {
    // Find a time inside moonwash's dwell and check the splined sun is down.
    let t = 0;
    while (playlistStateAt(t).stanceId !== 'moonwash') t += 10_000;
    const mid = playlistStateAt(t + STANCES[4].dwellMs / 2);
    expect(mid.sunDir[1]).toBeLessThan(0);
    expect(mid.starVisibility).toBe(1);
  });
});

describe('blendStances', () => {
  it('t=0 returns a, t=1 returns b', () => {
    const a = playlistStateAt(0);
    const b = playlistStateAt(10 * 60_000);
    expect(blendStances(a, b, 0).fogDensity).toBe(a.fogDensity);
    expect(blendStances(a, b, 1).fogDensity).toBe(b.fogDensity);
  });
});

describe('nextStanceStart', () => {
  it('finds the next gloaming, in the future, within one cycle', () => {
    const now = 123_456;
    const next = nextStanceStart(now, 'gloaming');
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThanOrEqual(CYCLE_MS);
    // And the playlist agrees that moment IS gloaming.
    expect(playlistStateAt(next + 1).stanceId).toBe('gloaming');
  });

  it('returns null for an unknown stance', () => {
    expect(nextStanceStart(0, 'blood-eclipse')).toBeNull();
  });
});
