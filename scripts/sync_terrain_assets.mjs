#!/usr/bin/env node
/**
 * sync_terrain_assets.mjs
 *
 * Makes enabled terrain sets reproducible in clean development and CI builds:
 *   1. verify or fetch missing locked source maps;
 *   2. normalize them through build_terrain_assets.mjs;
 *   3. optionally verify the local source/output state without downloading.
 *
 * Usage:
 *   npm run sync:terrain-assets
 *   npm run sync:terrain-assets:check
 */

import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const configPath = resolve(repoRoot, 'config/terrain-assets.json');
const checkOnly = process.argv.includes('--check');

function fail(message) {
  throw new Error(`[terrain-sync] ${message}`);
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

function runNodeScript(scriptName, args = []) {
  return new Promise((resolveRun, rejectRun) => {
    const scriptPath = resolve(here, scriptName);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectRun(new Error(`[terrain-sync] ${scriptName} failed with ${suffix}`));
    });
  });
}

async function missingSourceMaps(definition) {
  if (!definition?.sourceDir || !definition?.maps) {
    fail('enabled terrain set is missing sourceDir or maps');
  }

  const sourceRoot = resolve(repoRoot, definition.sourceDir);
  const missing = [];
  for (const targetName of Object.values(definition.maps)) {
    if (!targetName) continue;
    if (!await exists(resolve(sourceRoot, targetName))) missing.push(targetName);
  }
  return missing;
}

async function main() {
  const config = await readJson(configPath);
  const enabledSets = Object.entries(config.sets ?? {})
    .filter(([, definition]) => definition?.enabled !== false);

  for (const [id, definition] of enabledSets) {
    const missing = await missingSourceMaps(definition);

    if (checkOnly) {
      if (missing.length) {
        fail(`${id} is missing local source map(s): ${missing.join(', ')}`);
      }
      await runNodeScript('fetch_terrain_source_set.mjs', ['--check', id]);
      continue;
    }

    if (missing.length) {
      console.log(`[terrain-sync] ${id}: fetching ${missing.length} missing source map(s)`);
      await runNodeScript('fetch_terrain_source_set.mjs', [id]);
    } else {
      console.log(`[terrain-sync] ${id}: using cached local source maps`);
    }
  }

  await runNodeScript('build_terrain_assets.mjs', checkOnly ? ['--check'] : []);
  console.log(`[terrain-sync] ${checkOnly ? 'Verified' : 'Synchronized'} ${enabledSets.length} enabled terrain set(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
