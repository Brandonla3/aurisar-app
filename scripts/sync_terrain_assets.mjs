#!/usr/bin/env node
/**
 * sync_terrain_assets.mjs
 *
 * Keeps the committed terrain runtime assets (public/assets/terrain/generated
 * + manifest.json) in sync with config/terrain-assets.json — WITHOUT touching
 * the network. State is verified against config/terrain-assets.lock.json
 * (see terrain_sync_state.mjs):
 *
 *   - outputs current                        → offline no-op (the normal
 *     dev / CI / deploy path);
 *   - outputs stale + local sources present  → rebuild through
 *     build_terrain_assets.mjs and refresh the lock (still offline);
 *   - outputs stale + sources missing        → fail with instructions.
 *     Sources are only ever downloaded by the explicit
 *     `npm run fetch:terrain-source -- <set-id>`.
 *
 * REGRESSION GUARD — do not reintroduce implicit downloads. This script runs
 * inside `prebuild`/`predev`, i.e. on every Netlify deploy and CI build. On
 * 2026-08-02 the Netlify deploy of PR #302 failed in "building site" (exit 4)
 * because the previous version of this script auto-fetched terrain archives
 * from ambientCG.com on every clean checkout, and a transient third-party
 * failure killed the deploy — a zero-change retry succeeded. The deploy path
 * must stay independent of third-party hosts: generated outputs are committed
 * to git, and this script must remain a pure local verify/rebuild step.
 * scripts/__tests__/terrain_sync_state.test.mjs enforces this by running the
 * sync under a kill-net preload.
 *
 * Usage:
 *   npm run sync:terrain-assets          # verify; rebuild locally if stale
 *   npm run sync:terrain-assets:check    # verify only (offline; CI gate)
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCK_RELATIVE_PATH, buildLock, verifyTerrainState } from './terrain_sync_state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const configPath = resolve(repoRoot, 'config/terrain-assets.json');
const lockPath = resolve(repoRoot, LOCK_RELATIVE_PATH);
const checkOnly = process.argv.includes('--check');
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

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

function validateEnabledSet(id, definition) {
  if (!definition || typeof definition !== 'object') {
    fail(`${id} must be an object`);
  }

  const download = definition.acquisition?.download;
  if (!download) return;

  if (typeof download.url !== 'string' || download.url.trim() === '') {
    fail(`${id}.acquisition.download.url must be a non-empty string`);
  }
  if (!SHA256_PATTERN.test(download.sha256 ?? '')) {
    fail(`${id}.acquisition.download.sha256 is required for enabled remotely fetched sets`);
  }
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
    validateEnabledSet(id, definition);
  }

  const lock = await exists(lockPath) ? await readJson(lockPath) : null;
  const state = await verifyTerrainState({ repoRoot, config, lock });

  if (state.current) {
    console.log(checkOnly
      ? `[terrain-sync] OK — committed outputs for ${enabledSets.length} enabled set(s) match ${LOCK_RELATIVE_PATH}`
      : `[terrain-sync] outputs current for ${enabledSets.length} enabled set(s) — offline no-op (lock verified)`);
    return;
  }

  const staleList = state.reasons.map((reason) => `  - ${reason}`).join('\n');

  if (checkOnly) {
    fail(`committed terrain outputs are stale:\n${staleList}\n` +
      `Rebuild locally and commit the results: npm run sync:terrain-assets ` +
      `(fetch sources first if it asks for them).`);
  }

  // Stale → rebuild from LOCAL sources only. Refusing to download here is the
  // whole point of the lock: a clean checkout must never need the network.
  const missingBySet = [];
  for (const [id, definition] of enabledSets) {
    const missing = await missingSourceMaps(definition);
    if (missing.length) missingBySet.push([id, definition, missing]);
  }

  if (missingBySet.length) {
    const fetchLines = missingBySet.map(([id, definition, missing]) => {
      const how = definition.acquisition?.download
        ? `npm run fetch:terrain-source -- ${id}`
        : `place the source maps in ${definition.sourceDir} (no locked download for this set)`;
      return `  - ${id}: missing ${missing.join(', ')} → ${how}`;
    });
    fail(
      `outputs are stale and local source maps are unavailable; refusing to download during a build:\n` +
      `${staleList}\n` +
      `To restore the committed state: git checkout -- public/assets/terrain ${LOCK_RELATIVE_PATH}\n` +
      `To rebuild from sources:\n${fetchLines.join('\n')}\n` +
      `  then re-run: npm run sync:terrain-assets`,
    );
  }

  console.log(`[terrain-sync] outputs stale — rebuilding from local sources:`);
  for (const reason of state.reasons) console.log(`[terrain-sync]   - ${reason}`);

  await runNodeScript('build_terrain_assets.mjs');
  const freshLock = await buildLock({ repoRoot, config });
  await writeFile(lockPath, `${JSON.stringify(freshLock, null, 2)}\n`, 'utf8');
  console.log(`[terrain-sync] Rebuilt ${enabledSets.length} enabled set(s) and refreshed ${LOCK_RELATIVE_PATH}; commit the updated outputs`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
