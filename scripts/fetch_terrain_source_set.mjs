#!/usr/bin/env node
/**
 * fetch_terrain_source_set.mjs
 *
 * Downloads a locked terrain source archive and extracts only the map files
 * declared by config/terrain-assets.json. This keeps raw texture binaries out of
 * git while still making source acquisition repeatable for approved CC0 sets.
 *
 * Usage:
 *   npm run fetch:terrain-source -- overworld-meadow-grass-01
 *   npm run check:terrain-source -- overworld-meadow-grass-01
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const configPath = resolve(repoRoot, 'config/terrain-assets.json');
const checkOnly = process.argv.includes('--check');
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const requestedSetId = positional[0] ?? 'overworld-meadow-grass-01';
const MAP_NAMES = ['albedo', 'normal', 'ao', 'roughness', 'height'];
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 120_000;

function fail(message) {
  throw new Error(`[terrain-source] ${message}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function assertSafeTarget(sourceRoot, relativePath) {
  const target = resolve(sourceRoot, relativePath);
  const normalizedRoot = sourceRoot.endsWith(sep) ? sourceRoot : `${sourceRoot}${sep}`;
  if (target !== sourceRoot && !target.startsWith(normalizedRoot)) {
    fail(`unsafe output path outside sourceDir: ${relativePath}`);
  }
  return target;
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minimumSize = 22;
  const maxCommentLength = 0xffff;
  const start = Math.max(0, buffer.length - minimumSize - maxCommentLength);
  for (let offset = buffer.length - minimumSize; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  fail('could not find ZIP end-of-central-directory record');
}

function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail('invalid ZIP central directory entry');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (!name.endsWith('/')) {
      entries.set(name.replace(/\\/g, '/'), {
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(buffer, entry) {
  const local = entry.localHeaderOffset;
  if (buffer.readUInt32LE(local) !== 0x04034b50) fail('invalid ZIP local file header');
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateRawSync(compressed, { finishFlush: 2 });
  fail(`unsupported ZIP compression method: ${entry.method}`);
}

function findArchiveEntry(entries, expectedName) {
  const normalized = expectedName.replace(/\\/g, '/');
  if (entries.has(normalized)) return [normalized, entries.get(normalized)];

  const matches = [...entries.entries()].filter(([name]) => name.endsWith(`/${normalized}`) || name.endsWith(normalized));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail(`archive map "${expectedName}" is ambiguous: ${matches.map(([name]) => name).join(', ')}`);
  fail(`archive map not found: ${expectedName}`);
}

async function checkSet(def, sourceRoot) {
  const missing = [];
  for (const map of MAP_NAMES) {
    const targetName = def.maps?.[map];
    if (!targetName) continue;
    const target = assertSafeTarget(sourceRoot, targetName);
    if (!await exists(target)) missing.push(targetName);
  }

  if (missing.length) fail(`${requestedSetId} is missing source map(s): ${missing.join(', ')}`);
  console.log(`[terrain-source] OK — ${requestedSetId} source maps are present`);
}

async function fetchArchive(url) {
  if (typeof fetch !== 'function') fail('global fetch is unavailable; use Node 18+');

  let lastError = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.1',
          'user-agent': 'AurisarTerrainPipeline/1.0',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const archive = Buffer.from(await response.arrayBuffer());
      if (archive.length < 22) throw new Error(`archive is unexpectedly small (${archive.length} bytes)`);
      return archive;
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? `timed out after ${DOWNLOAD_TIMEOUT_MS}ms`
        : (error instanceof Error ? error.message : String(error));
      lastError = new Error(message);
      if (attempt < DOWNLOAD_ATTEMPTS) {
        const delayMs = 1_000 * attempt;
        console.warn(`[terrain-source] Download attempt ${attempt} failed (${message}); retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  fail(`download failed for ${url} after ${DOWNLOAD_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown error'}`);
}

function verifyArchiveHash(archive, expectedSha256) {
  const digest = createHash('sha256').update(archive).digest('hex');
  console.log(`[terrain-source] Archive SHA-256: ${digest}`);

  if (expectedSha256 !== undefined) {
    if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      fail('acquisition.download.sha256 must be a 64-character hexadecimal digest');
    }
    if (digest !== expectedSha256.toLowerCase()) {
      fail(`archive SHA-256 mismatch: expected ${expectedSha256.toLowerCase()}, received ${digest}`);
    }
  }

  return digest;
}

async function main() {
  const config = await readJson(configPath);
  const def = config.sets?.[requestedSetId];
  if (!def) fail(`unknown terrain set: ${requestedSetId}`);

  const download = def.acquisition?.download;
  if (!download?.url || typeof download.url !== 'string') fail(`${requestedSetId}.acquisition.download.url is required`);
  if (!download.maps || typeof download.maps !== 'object') fail(`${requestedSetId}.acquisition.download.maps is required`);
  if (!def.maps || typeof def.maps !== 'object') fail(`${requestedSetId}.maps is required`);

  const sourceRoot = resolve(repoRoot, def.sourceDir);
  if (checkOnly) {
    await checkSet(def, sourceRoot);
    return;
  }

  await mkdir(sourceRoot, { recursive: true });
  console.log(`[terrain-source] Downloading ${download.url}`);
  const archive = await fetchArchive(download.url);
  verifyArchiveHash(archive, download.sha256);
  const entries = readZipEntries(archive);

  for (const map of MAP_NAMES) {
    const sourceName = download.maps[map];
    const targetName = def.maps[map];
    if (!sourceName || !targetName) continue;

    const [, entry] = findArchiveEntry(entries, sourceName);
    const bytes = extractZipEntry(archive, entry);
    const target = assertSafeTarget(sourceRoot, targetName);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    console.log(`[terrain-source] ${sourceName} -> ${def.sourceDir}/${targetName}`);
  }

  await checkSet(def, sourceRoot);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
