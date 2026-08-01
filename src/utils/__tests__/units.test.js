import { describe, it, expect } from 'vitest';
import { displayPace } from '../units';

describe('displayPace', () => {
  it('imperial: renders the stored min/mi value unconverted', () => {
    expect(displayPace(8.5, 'imperial')).toBe('8.50 min/mi');
  });

  it('metric: converts min/mi to min/km — a distance-ratio scale, not a straight relabel', () => {
    // 8 min/mi covers a mile in 8 minutes; a km is shorter, so the same pace
    // takes FEWER minutes per km (8 / 1.60934), not more.
    expect(displayPace(8, 'metric')).toBe('4.97 min/km');
  });

  it('returns null for no pace, in either unit system', () => {
    expect(displayPace(null, 'imperial')).toBeNull();
    expect(displayPace(0, 'metric')).toBeNull();
  });

  it('accepts a numeric-string pace (PB values come off profile.exercisePBs as stored numbers or strings)', () => {
    expect(displayPace('7.2', 'imperial')).toBe('7.20 min/mi');
  });
});
