import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Raw Radiance .hdr panoramas make Babylon's HDRCubeTexture run a GPU PMREM
 * prefilter pass during world startup. The desktop failure fixed by PR #253
 * occurred inside that render-to-texture pass, leaving the shader program
 * unlinked and ultimately losing the WebGL context.
 *
 * Runtime environment lighting must therefore use prefiltered Babylon .env
 * files. Raw .hdr files belong in an offline authoring/source directory only.
 */
describe('runtime environment assets', () => {
  it('does not ship raw HDR panoramas in public/env', () => {
    const runtimeEnvDir = resolve(process.cwd(), 'public', 'env');
    const rawHdrFiles = existsSync(runtimeEnvDir)
      ? readdirSync(runtimeEnvDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.hdr'))
          .map((entry) => entry.name)
          .sort()
      : [];

    expect(rawHdrFiles).toEqual([]);
  });
});
