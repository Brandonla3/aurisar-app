import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  buildLock,
  computeConfigDigest,
  expectedOutputFiles,
  verifyTerrainState,
} from '../terrain_sync_state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeConfig() {
  return {
    version: 1,
    output: {
      directory: 'public/assets/terrain/generated',
      manifest: 'public/assets/terrain/manifest.json',
      publicBaseUrl: '/assets/terrain/generated',
    },
    defaults: {
      resolution: 2048,
      tileMeters: 4,
      anisotropy: 8,
      baseColorQuality: 90,
      roughness: 0.9,
    },
    sets: {
      'grass-01': {
        enabled: true,
        role: 'grass',
        sourceDir: 'assets-source/terrain/grass-01',
        resolution: 2048,
        tileMeters: 2.1,
        maps: {
          albedo: 'albedo.jpg',
          normal: 'normal.jpg',
          ao: 'ao.jpg',
          roughness: 'roughness.jpg',
          height: 'height.jpg',
        },
        license: { name: 'CC0 1.0', author: 'ambientCG', sourceUrl: 'https://example.com/a' },
        acquisition: {
          provider: 'ambientCG',
          status: 'enabled-build-synced',
          notes: 'original notes',
          download: {
            url: 'https://example.com/get.zip',
            format: '2K-JPG.zip',
            sha256: 'a'.repeat(64),
            maps: { albedo: 'X_Color.jpg', normal: 'X_NormalGL.jpg' },
          },
        },
      },
      'dirt-01': {
        enabled: false,
        role: 'dirt',
        sourceDir: 'assets-source/terrain/dirt-01',
        maps: { albedo: 'albedo.jpg', normal: 'normal.png' },
        license: { name: 'CC0 1.0', author: 'Poly Haven', sourceUrl: 'https://example.com/b' },
        acquisition: { provider: 'Poly Haven', status: 'selected-awaiting-binaries', notes: 'candidate' },
      },
    },
    profiles: {
      overworld: { grass: 'grass-01', dirt: null, sand: null, rock: null, field: null },
    },
  };
}

describe('computeConfigDigest', () => {
  it('ignores metadata-only and disabled-set changes', () => {
    const base = computeConfigDigest(makeConfig());

    const notesChanged = makeConfig();
    notesChanged.sets['grass-01'].acquisition.notes = 'edited notes';
    notesChanged.sets['grass-01'].acquisition.status = 'renamed-status';
    expect(computeConfigDigest(notesChanged)).toBe(base);

    const disabledChanged = makeConfig();
    disabledChanged.sets['dirt-01'].maps.normal = 'other.png';
    disabledChanged.sets['dirt-01'].acquisition.notes = 'different candidate';
    expect(computeConfigDigest(disabledChanged)).toBe(base);
  });

  it('is stable under JSON key reordering', () => {
    const base = computeConfigDigest(makeConfig());
    // Rebuild the same data with a different insertion order.
    const shuffled = makeConfig();
    const grass = shuffled.sets['grass-01'];
    shuffled.sets['grass-01'] = {
      license: grass.license,
      maps: grass.maps,
      enabled: grass.enabled,
      acquisition: grass.acquisition,
      role: grass.role,
      sourceDir: grass.sourceDir,
      tileMeters: grass.tileMeters,
      resolution: grass.resolution,
    };
    expect(computeConfigDigest(shuffled)).toBe(base);
  });

  it('changes when image- or manifest-affecting inputs change', () => {
    const base = computeConfigDigest(makeConfig());

    const resolutionChanged = makeConfig();
    resolutionChanged.sets['grass-01'].resolution = 1024;
    expect(computeConfigDigest(resolutionChanged)).not.toBe(base);

    const defaultsChanged = makeConfig();
    defaultsChanged.defaults.baseColorQuality = 80;
    expect(computeConfigDigest(defaultsChanged)).not.toBe(base);

    const archiveChanged = makeConfig();
    archiveChanged.sets['grass-01'].acquisition.download.sha256 = 'b'.repeat(64);
    expect(computeConfigDigest(archiveChanged)).not.toBe(base);

    const profileChanged = makeConfig();
    profileChanged.profiles.overworld.grass = null;
    expect(computeConfigDigest(profileChanged)).not.toBe(base);

    const licenseChanged = makeConfig();
    licenseChanged.sets['grass-01'].license.author = 'someone else';
    expect(computeConfigDigest(licenseChanged)).not.toBe(base);
  });
});

describe('expectedOutputFiles', () => {
  it('lists the runtime contract per enabled set, height map optional', () => {
    const config = makeConfig();
    expect(expectedOutputFiles(config)).toEqual({
      'grass-01': ['basecolor.jpg', 'normal.png', 'orm.png', 'height.png'],
    });

    delete config.sets['grass-01'].maps.height;
    expect(expectedOutputFiles(config)).toEqual({
      'grass-01': ['basecolor.jpg', 'normal.png', 'orm.png'],
    });
  });
});

describe('buildLock / verifyTerrainState', () => {
  let root;
  let config;

  async function writeOutputs() {
    const outDir = join(root, 'public/assets/terrain/generated/grass-01');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(root, 'public/assets/terrain/manifest.json'), '{"version":1}\n');
    for (const name of ['basecolor.jpg', 'normal.png', 'orm.png', 'height.png']) {
      await writeFile(join(outDir, name), `fake-bytes:${name}`);
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'terrain-sync-'));
    config = makeConfig();
    await writeOutputs();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips: a fresh lock verifies as current', async () => {
    const lock = await buildLock({ repoRoot: root, config });
    expect(lock.version).toBe(1);
    expect(lock.configDigest).toBe(computeConfigDigest(config));
    expect(lock.manifestSha256).toBe(sha256('{"version":1}\n'));
    expect(lock.sets['grass-01'].files['basecolor.jpg']).toBe(sha256('fake-bytes:basecolor.jpg'));

    const state = await verifyTerrainState({ repoRoot: root, config, lock });
    expect(state.reasons).toEqual([]);
    expect(state.current).toBe(true);
  });

  it('reports a missing lock', async () => {
    const state = await verifyTerrainState({ repoRoot: root, config, lock: null });
    expect(state.current).toBe(false);
    expect(state.reasons.join(' ')).toMatch(/lock/i);
  });

  it('goes stale when the config changes', async () => {
    const lock = await buildLock({ repoRoot: root, config });
    config.sets['grass-01'].resolution = 1024;
    const state = await verifyTerrainState({ repoRoot: root, config, lock });
    expect(state.current).toBe(false);
    expect(state.reasons.join(' ')).toMatch(/config/i);
  });

  it('goes stale when an output file is modified or missing', async () => {
    const lock = await buildLock({ repoRoot: root, config });

    await writeFile(join(root, 'public/assets/terrain/generated/grass-01/orm.png'), 'tampered');
    let state = await verifyTerrainState({ repoRoot: root, config, lock });
    expect(state.current).toBe(false);
    expect(state.reasons.join(' ')).toMatch(/orm\.png/);

    await rm(join(root, 'public/assets/terrain/generated/grass-01/normal.png'));
    state = await verifyTerrainState({ repoRoot: root, config, lock });
    expect(state.reasons.join(' ')).toMatch(/normal\.png/);
  });

  it('goes stale when the manifest is edited by hand', async () => {
    const lock = await buildLock({ repoRoot: root, config });
    await writeFile(join(root, 'public/assets/terrain/manifest.json'), '{"version":1,"edited":true}\n');
    const state = await verifyTerrainState({ repoRoot: root, config, lock });
    expect(state.current).toBe(false);
    expect(state.reasons.join(' ')).toMatch(/manifest/i);
  });
});

// The committed repo state itself must satisfy the offline gate: generated
// outputs + lockfile are tracked, so a clean checkout builds with zero network.
// kill_net.mjs turns any fetch/http(s) attempt inside the child into a crash,
// making "no third-party fetch during the build path" a permanent regression
// test rather than a one-off manual check.
describe('committed repo state (offline gate)', () => {
  const killNet = pathToFileURL(join(here, 'fixtures', 'kill_net.mjs')).href;
  const syncScript = resolve(repoRoot, 'scripts', 'sync_terrain_assets.mjs');
  const env = { ...process.env, NODE_OPTIONS: `--import ${killNet}` };

  it('sync --check passes offline against the committed outputs', () => {
    const result = spawnSync(process.execPath, [syncScript, '--check'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/OK/);
  });

  it('sync (build mode) is an offline no-op when outputs are current', () => {
    const result = spawnSync(process.execPath, [syncScript], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/offline no-op/);
  });
});
