/**
 * prepare_terrain_sources.mjs
 *
 * Creates or verifies local raw-source folders for selected terrain scan
 * candidates in config/terrain-assets.json. The folders are intentionally
 * ignored by git because source scans can be large. Each folder gets a SOURCE.md
 * checklist documenting expected map names, license metadata and art notes.
 *
 * Usage:
 *   npm run prepare:terrain-sources
 *   npm run check:terrain-sources
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const configPath = resolve(repoRoot, 'config/terrain-assets.json');
const checkOnly = process.argv.includes('--check');

function fail(message) {
  throw new Error(`[terrain-sources] ${message}`);
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

function expectedSourceDoc(id, def) {
  const maps = Object.entries(def.maps ?? {})
    .map(([slot, file]) => `- ${slot}: \`${file}\``)
    .join('\n');
  const acquisition = def.acquisition ?? {};
  const license = def.license ?? {};
  return `# ${id}\n\n` +
    `Role: \`${def.role ?? 'unassigned'}\`\n\n` +
    `Status: \`${acquisition.status ?? 'unspecified'}\`\n\n` +
    `## Expected maps\n\n${maps}\n\n` +
    `## License\n\n` +
    `- Name: ${license.name ?? 'unknown'}\n` +
    `- Author: ${license.author ?? 'unknown'}\n` +
    `- Source: ${license.sourceUrl ?? 'unknown'}\n` +
    `- License notes: ${acquisition.licenseUrl ?? 'n/a'}\n\n` +
    `## Art notes\n\n${acquisition.notes ?? 'No notes provided.'}\n\n` +
    `## Enablement checklist\n\n` +
    `1. Download or author source maps into this folder using the exact filenames above.\n` +
    `2. Confirm albedo/basecolor has no baked directional lighting or harsh shadows.\n` +
    `3. Confirm normal map is tangent-space and matches Babylon's expected handedness.\n` +
    `4. Confirm AO, roughness and height are linear grayscale maps.\n` +
    `5. Run \`npm run build:terrain-assets\` and inspect \`public/assets/terrain/generated/${id}/\`.\n` +
    `6. Set \`enabled: true\` and assign the set to the intended profile slot only after visual QA.\n`;
}

async function main() {
  const config = await readJson(configPath);
  const sets = Object.entries(config.sets ?? {});
  let created = 0;

  for (const [id, def] of sets) {
    if (!def?.sourceDir) continue;
    const dir = resolve(repoRoot, def.sourceDir);
    const docPath = resolve(dir, 'SOURCE.md');
    const doc = expectedSourceDoc(id, def);

    if (checkOnly) {
      if (!await exists(docPath)) fail(`${id}: missing ${docPath}; run npm run prepare:terrain-sources`);
      const current = await readFile(docPath, 'utf8');
      if (current !== doc) fail(`${id}: SOURCE.md is stale; run npm run prepare:terrain-sources`);
      continue;
    }

    await mkdir(dir, { recursive: true });
    await writeFile(docPath, doc);
    created += 1;
  }

  console.log(`[terrain-sources] ${checkOnly ? 'OK' : 'prepared'} ${created || sets.length} selected source folder(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
