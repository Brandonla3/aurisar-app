import { describe, expect, it } from 'vitest';
import { disableUnsafeWaterMirror } from '../../../../vite.config.js';

const PROVIDER_ID = '/repo/src/features/world/streaming/ashwoodTileProvider.js';
const UNSAFE = "const reflect = (scene.metadata?.ashwood?.qualityTier ?? 'high') === 'high';";

describe('desktop water reflection safety guard', () => {
  it('forces the whole-scene lake MirrorTexture path off', () => {
    const plugin = disableUnsafeWaterMirror();
    const result = plugin.transform(`before\n${UNSAFE}\nafter`, PROVIDER_ID);

    expect(result.code).toContain('const reflect = false;');
    expect(result.code).not.toContain(UNSAFE);
  });

  it('does not touch unrelated modules', () => {
    const plugin = disableUnsafeWaterMirror();
    expect(plugin.transform(UNSAFE, '/repo/src/other.js')).toBeNull();
  });

  it('fails the build if the source anchor changes without review', () => {
    const plugin = disableUnsafeWaterMirror();
    expect(() => plugin.transform('const reflect = maybe;', PROVIDER_ID))
      .toThrow(/Expected lake reflection activation was not found/);
  });
});
