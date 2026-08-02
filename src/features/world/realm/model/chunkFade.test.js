import { describe, expect, it } from 'vitest';
import { CHUNK_FADE_MS, chunkFadeVisibility, isFadeComplete } from './chunkFade.js';

describe('chunkFadeVisibility', () => {
  it('is 0 at birth and 1 once the duration has elapsed', () => {
    expect(chunkFadeVisibility(1000, 1000)).toBe(0);
    expect(chunkFadeVisibility(1000 + CHUNK_FADE_MS, 1000)).toBe(1);
  });

  it('is exactly linear at the midpoint', () => {
    expect(chunkFadeVisibility(1000 + CHUNK_FADE_MS / 2, 1000)).toBeCloseTo(0.5, 10);
  });

  it('clamps rather than overshooting past 1', () => {
    expect(chunkFadeVisibility(1000 + CHUNK_FADE_MS * 5, 1000)).toBe(1);
  });

  it('clamps rather than going negative for a time before birth', () => {
    // Defensive: a clock skew or reordering must not produce negative alpha.
    expect(chunkFadeVisibility(500, 1000)).toBe(0);
  });

  it('treats a zero or negative fade duration as instantly visible', () => {
    expect(chunkFadeVisibility(1000, 1000, 0)).toBe(1);
    expect(chunkFadeVisibility(1000, 1000, -50)).toBe(1);
  });

  it('is a pure function of its three inputs', () => {
    expect(chunkFadeVisibility(1234, 1000, 300)).toBe(chunkFadeVisibility(1234, 1000, 300));
  });
});

describe('isFadeComplete', () => {
  it('agrees with chunkFadeVisibility reaching 1', () => {
    for (const dt of [0, 50, 150, 299, 300, 301, 1000]) {
      const nowMs = 1000 + dt;
      expect(isFadeComplete(nowMs, 1000)).toBe(chunkFadeVisibility(nowMs, 1000) >= 1);
    }
  });
});
