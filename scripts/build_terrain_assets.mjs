/**
 * build_terrain_assets.mjs
 *
 * Normalizes source PBR maps into a deterministic runtime layout:
 *   basecolor.jpg  — sRGB
 *   normal.png     — linear tangent-space normal
 *   orm.png        — linear channels: R=AO, G=roughness, B=metalness
 *   height.png     — optional linear height
 *
 * Source files are declared in config/terrain-assets.json. Disabled sets are
 * treated as selected candidates: their metadata is still validated, but their
 * source maps are not required and they are omitted from the runtime manifest.
 * This keeps the procedural terrain shader as the safe fallback until scanned
 * assets are approved and dropped into assets-source/terrain/.
 *
 * Usage:
 *   npm run build:terrain-assets
 *   npm run check:terrain-assets
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const configPath = resolve(repoRoot, 'config/terrain-assets.json');
const checkOnly = process.argv.includes('--check');

const SLOT_NAMES = ['grass', 'dirt', 'sand', 'rock', 'field'];
const MAP_NAMES = ['albedo', 'normal', 'ao', 'roughness', 'height'];

function fail(message) {
  throw new Error(`[terrain-assets] ${message}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value >= 256 && value <= 8192 &&
    (value & (value - 1)) === 0;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
  return value;
}

function validateLicense(id, license) {
  if (!license || typeof license !== 'object') fail(`${id}.license is required`);
  requireString(license.name, `${id}.license.name`);
  requireString(license.sourceUrl, `${id}.license.sourceUrl`);
  requireString(license.author, `${id}.license.author`);
}

function validateMaps(id, maps) {
  if (!maps || typeof maps !== 'object' || Array.isArray(maps)) fail(`${id}.maps is required`);
  requireString(maps.albedo, `${id}.maps.albedo`);
  requireString(maps.normal, `${id}.maps.normal`);
  for (const map of Object.keys(maps)) {
    if (!MAP_NAMES.includes(map)) fail(`${id}.maps.${map} is not supported`);
  }
}

function validateAcquisition(id, acquisition) {
  if (!acquisition) return;
  if (typeof acquisition !== 'object' || Array.isArray(acquisition)) fail(`${id}.acquisition must be an object`);
  requireString(acquisition.provider, `${id}.acquisition.provider`);
  requireString(acquisition.status, `${id}.acquisition.status`);
  if (acquisition.licenseUrl !== undefined) requireString(acquisition.licenseUrl, `${id}.acquisition.licenseUrl`);
  if (acquisition.notes !== undefined) requireString(acquisition.notes, `${id}.acquisition.notes`);
}

function validateSet(id, def, defaults) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`invalid set id "${id}"`);
  if (!def || typeof def !== 'object' || Array.isArray(def)) fail(`${id} must be an object`);
  if (def.role !== undefined && !SLOT_NAMES.includes(def.role)) fail(`${id}.role must be one of: ${SLOT_NAMES.join(', ')}`);
  requireString(def.sourceDir, `${id}.sourceDir`);
  validateMaps(id, def.maps);

  const resolution = def.resolution ?? defaults.resolution;
  if (!isPowerOfTwo(resolution)) fail(`${id}.resolution must be a power of two from 256 to 8192`);
  validateLicense(id, def.license);
  validateAcquisition(id, def.acquisition);
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') fail('config must be an object');
  if (config.version !== 1) fail(`unsupported config version: ${config.version}`);
  if (!config.output || typeof config.output !== 'object') fail('output is required');
  requireString(config.output.directory, 'output.directory');
  requireString(config.output.manifest, 'output.manifest');
  requireString(config.output.publicBaseUrl, 'output.publicBaseUrl');

  if (!config.defaults || typeof config.defaults !== 'object') fail('defaults is required');
  if (!isPowerOfTwo(config.defaults.resolution)) fail('defaults.resolution must be a power of two from 256 to 8192');

  if (!config.sets || typeof config.sets !== 'object' || Array.isArray(config.sets)) fail('sets must be an object');
  if (!config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles)) fail('profiles must be an object');

  for (const [id, def] of Object.entries(config.sets)) {
    validateSet(id, def, config.defaults);
  }

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    if (!profile || typeof profile !== 'object') fail(`profile ${profileName} must be an object`);
    for (const slot of SLOT_NAMES) {
      const value = profile[slot] ?? null;
      if (value !== null && typeof value !== 'string') fail(`profiles.${profileName}.${slot} must be a set id or null`);
      if (value !== null && !Object.hasOwn(config.sets, value)) fail(`profiles.${profileName}.${slot} references unknown set "${value}"`);
      if (value !== null && config.sets[value]?.enabled === false) fail(`profiles.${profileName}.${slot} references disabled set "${value}"`);
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function grayscaleBuffer(path, width, height, fallback) {
  if (!path) return Buffer.alloc(width * height, fallback);
  return sharp(path)
    .resize(width, height, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .raw()
    .toBuffer();
}

async function normalizeSet(id, def, config, outRoot) {
  const sourceRoot = resolve(repoRoot, def.sourceDir);
  const resolution = def.resolution ?? config.defaults.resolution;
  const outDir = resolve(outRoot, id);
  const sourcePath = (name) => def.maps[name] ? resolve(sourceRoot, def.maps[name]) : null;

  for (const required of ['albedo', 'normal']) {
    const path = sourcePath(required);
    if (!await exists(path)) fail(`${id}: missing ${required} map at ${path}`);
  }
  for (const optional of ['ao', 'roughness', 'height']) {
    const path = sourcePath(optional);
    if (path && !await exists(path)) fail(`${id}: configured ${optional} map does not exist at ${path}`);
  }

  const baseUrl = `${config.output.publicBaseUrl.replace(/\/$/, '')}/${id}`;
  const runtime = {
    id,
    role: def.role ?? null,
    tileMeters: def.tileMeters ?? config.defaults.tileMeters,
    anisotropy: def.anisotropy ?? config.defaults.anisotropy,
    maps: {
      baseColor: `${baseUrl}/basecolor.jpg`,
      normal: `${baseUrl}/normal.png`,
      orm: `${baseUrl}/orm.png`,
      height: def.maps.height ? `${baseUrl}/height.png` : null,
    },
    channels: {
      orm: { r: 'ambientOcclusion', g: 'roughness', b: 'metalness' },
    },
    license: def.license,
  };

  if (checkOnly) return runtime;

  await mkdir(outDir, { recursive: true });

  await sharp(sourcePath('albedo'))
    .resize(resolution, resolution, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .jpeg({
      quality: def.baseColorQuality ?? config.defaults.baseColorQuality,
      chromaSubsampling: '4:4:4',
      mozjpeg: true,
    })
    .toFile(resolve(outDir, 'basecolor.jpg'));

  await sharp(sourcePath('normal'))
    .resize(resolution, resolution, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(resolve(outDir, 'normal.png'));

  const ao = await grayscaleBuffer(sourcePath('ao'), resolution, resolution, 255);
  const roughnessDefault = Math.round(255 * (def.roughness ?? config.defaults.roughness));
  const roughness = await grayscaleBuffer(sourcePath('roughness'), resolution, resolution, roughnessDefault);
  const metalness = Buffer.alloc(resolution * resolution, 0);

  await sharp(ao, { raw: { width: resolution, height: resolution, channels: 1 } })
    .joinChannel(roughness, { raw: { width: resolution, height: resolution, channels: 1 } })
    .joinChannel(metalness, { raw: { width: resolution, height: resolution, channels: 1 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(resolve(outDir, 'orm.png'));

  if (def.maps.height) {
    await sharp(sourcePath('height'))
      .resize(resolution, resolution, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(resolve(outDir, 'height.png'));
  }

  return runtime;
}

function makeRuntimeManifest(config, sets) {
  const enabledIds = new Set(Object.keys(sets));
  const profiles = {};

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    profiles[profileName] = {};
    for (const slot of SLOT_NAMES) {
      const id = profile[slot] ?? null;
      profiles[profileName][slot] = id && enabledIds.has(id) ? id : null;
    }
  }

  return {
    version: 1,
    generatedAt: null,
    sets,
    profiles,
  };
}

async function main() {
  const config = await readJson(configPath);
  validateConfig(config);

  const outRoot = resolve(repoRoot, config.output.directory);
  const manifestPath = resolve(repoRoot, config.output.manifest);
  const enabledEntries = Object.entries(config.sets).filter(([, def]) => def.enabled !== false);
  const sets = {};

  if (!checkOnly) {
    await rm(outRoot, { recursive: true, force: true });
    await mkdir(outRoot, { recursive: true });
  }

  for (const [id, def] of enabledEntries) {
    sets[id] = await normalizeSet(id, def, config, outRoot);
  }

  const runtimeManifest = makeRuntimeManifest(config, sets);
  const serialized = `${JSON.stringify(runtimeManifest, null, 2)}\n`;

  if (checkOnly) {
    if (!await exists(manifestPath)) fail(`runtime manifest is missing: ${manifestPath}`);
    const current = await readFile(manifestPath, 'utf8');
    if (current !== serialized) fail('runtime manifest is stale; run npm run build:terrain-assets');
    console.log(`[terrain-assets] OK — ${enabledEntries.length} enabled set(s), ${Object.keys(config.sets).length} selected candidate(s), manifest is current`);
    return;
  }

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serialized);
  console.log(`[terrain-assets] Built ${enabledEntries.length} enabled set(s) / ${Object.keys(config.sets).length} selected candidate(s) → ${config.output.directory}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
