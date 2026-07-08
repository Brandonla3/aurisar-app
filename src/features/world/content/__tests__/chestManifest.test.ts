import { describe, expect, it } from 'vitest';
import { WORLD_CHESTS } from '../world/chestManifest.generated';

describe('world chest manifest', () => {
  it('has sequential ids matching array index', () => {
    expect(WORLD_CHESTS.length).toBeGreaterThan(0);
    WORLD_CHESTS.forEach((chest, index) => {
      expect(chest.id).toBe(index);
      expect(typeof chest.seed).toBe('number');
      expect(Number.isFinite(chest.x)).toBe(true);
      expect(Number.isFinite(chest.z)).toBe(true);
    });
  });
});
