#!/usr/bin/env node
/**
 * assets_pipeline.mjs — CC0 asset intake + optimization + manifest engine.
 *
 * Reads config/asset-packs.json (dirs → treatment preset + budget class +
 * license) and, for every runtime GLB:
 *   1. reads it with the full glTF extension set;
 *   2. captures a STRUCTURAL SIGNATURE (skin joint count, animation clip
 *      names, morph-target names, mesh count);
 *   3. applies the treatment (prune → dedup → weld → resample → optional
 *      clip prune → texture downsize/recompress → meshopt geometry encode);
 *   4. re-parses the output and ABORTS on that file if the signature drifted
 *      (a rig/clip/morph must never be silently lost to compression);
 *   5. writes the result ONLY if it is smaller than the original — the
 *      pipeline never inflates an already-optimized asset (many kit props
 *      already ship small WebP textures, so blind recompression would grow
 *      them).
 * Then it emits public/assets/manifest/<category>.manifest.json for each
 * pack (key → file, bytes, tris, bones, clips, morphs) and refreshes the
 * generated section of public/assets/ATTRIBUTION.md.
 *
 * Modes:
 *   node scripts/assets_pipeline.mjs            optimize in place + emit manifests
 *   node scripts/assets_pipeline.mjs --check    CI: assert manifests are fresh,
 *                                               every referenced file exists, and
 *                                               every asset is within budget. Does
 *                                               NOT re-encode (meshopt output is not
 *                                               byte-deterministic across versions).
 *   node scripts/assets_pipeline.mjs --emit     re-emit manifests only (no optimize)
 *
 * Design notes:
 * - meshopt is VISUALLY lossless for geometry — it re-encodes vertex/index buffers
 *   and applies KHR_mesh_quantization (fixed-point, morph/skin-safe at this scale,
 *   NOT float-preserving). Babylon 9 decodes EXT_meshopt_compression via the
 *   self-hosted decoder (src/features/world/game/babylonDecoders.js). Draco is
 *   rejected (larger decoder, worse ratio here); KTX2 is deferred.
 * - TEXTURES ARE NOT RE-ENCODED. An earlier lossy WebP/resize pass was removed: no
 *   shipped texture exceeds the 1024 cap and the character/model packs carry none,
 *   so it saved nothing while risking normal/ORM/packed-map fidelity. Downsizing an
 *   over-cap texture is gated behind a treatment flag and, if ever hit, must be
 *   lossless + slot-aware (a future need, not exercised today).
 * - The structural-signature backstop is a fail-safe, not a proof of pixel identity:
 *   it compares rig/mesh/material/animation/morph SHAPE, not vertex payloads. See
 *   docs/ART_DIRECTION.md "what CI proves / doesn't prove".
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MODE = process.argv.includes('--check') ? 'check'
  : process.argv.includes('--emit') ? 'emit' : 'optimize';

const packsCfg = JSON.parse(await readFile(join(ROOT, 'config/asset-packs.json'), 'utf8'));
const budgets = JSON.parse(await readFile(join(ROOT, 'config/asset-budgets.json'), 'utf8')).classes;
const TEX_CAP = packsCfg.textureCap ?? 1024;
const MANIFEST_DIR = join(ROOT, 'public/assets/manifest');

let problems = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); problems++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// Only write when the saving clears this floor — avoids 1-byte re-encode churn
// on binary source files across pipeline re-runs.
const MIN_SAVE_BYTES = 1024;

// Treatment presets. All packs get the same lossless geometry path
// (prune/dedup/weld/resample → meshopt); the treatment governs the TEXTURE
// policy, which is the only place asset classes must differ (a normal map on a
// rigged character must never be touched the way a static prop's albedo could).
// `allowTextureDownsize` only permits a LOSSLESS resize of a texture that
// exceeds the cap — never a lossy re-encode. No current asset triggers it.
const TREATMENTS = {
  character_rigged: { allowTextureDownsize: false },
  character_model:  { allowTextureDownsize: false },
  creature_rigged:  { allowTextureDownsize: false },
  kit_static:       { allowTextureDownsize: true },
};

// ── glTF structural probes ──────────────────────────────────────────────────
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// A structural signature rich enough that weld/resample/quantize can't silently
// change what the asset *is*. Compares rig shape (per-skin joint counts), mesh
// makeup (per-mesh primitive + morph-target counts), material count, and
// per-animation channel/sampler counts — not vertex payloads (see the header
// note; pixel identity is an on-device check, not a CI one).
function signature(doc) {
  const root = doc.getRoot();
  const skins = root.listSkins().map((s) => s.listJoints().length).sort((a, b) => a - b);
  const clips = root.listAnimations().map((a) => a.getName()).sort();
  const anims = root.listAnimations()
    .map((a) => `${a.getName()}:${a.listChannels().length}/${a.listSamplers().length}`).sort();
  const morphNames = [];
  const meshShape = root.listMeshes().map((m) => {
    const tn = m.getExtras()?.targetNames; if (tn) morphNames.push(...tn);
    const prims = m.listPrimitives();
    const morphCounts = prims.map((p) => p.listTargets().length);
    return `${prims.length}:[${morphCounts.join(',')}]`;
  }).sort();
  return {
    skins, joints: skins.reduce((a, b) => a + b, 0),
    clips, anims, meshes: root.listMeshes().length, meshShape,
    materials: root.listMaterials().length,
    morphs: morphNames.sort(),
  };
}

const sigString = (s) => JSON.stringify(s);

function triCount(doc) {
  let n = 0;
  doc.getRoot().listMeshes().forEach((m) => m.listPrimitives().forEach((p) => {
    const idx = p.getIndices();
    const verts = p.getAttribute('POSITION')?.getCount() ?? 0;
    n += idx ? idx.getCount() / 3 : verts / 3;
  }));
  return Math.round(n);
}

function maxTexEdge(doc) {
  let mx = 0;
  for (const t of doc.getRoot().listTextures()) {
    const s = t.getSize();
    if (s) mx = Math.max(mx, s[0], s[1]);
  }
  return mx;
}

const sameSig = (a, b) => sigString(a) === sigString(b);

// Report any texture that exceeds the cap. Downsizing is deliberately NOT done
// here: it would need to be lossless and slot-aware (never lossy-recompress a
// normal/ORM/packed map), and no shipped asset triggers it. A future kit with
// oversized color textures is the reason `allowTextureDownsize` exists; until
// then an over-cap texture is a budget failure, surfaced by check:assets.
function overCapTextures(doc) {
  const over = [];
  for (const tex of doc.getRoot().listTextures()) {
    const s = tex.getSize();
    if (s && Math.max(s[0], s[1]) > TEX_CAP) over.push(Math.max(s[0], s[1]));
  }
  return over;
}

// ── per-file optimization ───────────────────────────────────────────────────
async function optimizeFile(absPath, pack) {
  const original = await readFile(absPath);
  const doc = await io.read(absPath);

  // Idempotency + reproducibility: a file already carrying
  // EXT_meshopt_compression has been through the pipeline. Re-running
  // prune/weld/resample/meshopt on its own output COMPOUNDS (weld can merge
  // post-quantization vertices, meshopt re-encodes) — a slow drift away from
  // the source. Skip it so `assets:pipeline` is a no-op on optimized assets;
  // optimization happens once, when a fresh (uncompressed) GLB is dropped in.
  // `--force` re-optimizes anyway (e.g. after a pipeline change, from source).
  const alreadyOptimized = doc.getRoot().listExtensionsUsed()
    .some((e) => e.extensionName === 'EXT_meshopt_compression');
  if (alreadyOptimized && !process.argv.includes('--force')) {
    console.log(`  · ${basename(absPath).padEnd(26)} already optimized (skip; --force to redo)`);
    return { wrote: false };
  }

  const sig0 = signature(doc);

  // Optional clip curation (drop CC0-pack clips the game never plays).
  const keep = pack.keepClips?.[basename(absPath)];
  if (keep) {
    const keepSet = new Set(keep);
    for (const anim of doc.getRoot().listAnimations()) {
      if (!keepSet.has(anim.getName())) anim.dispose();
    }
  }

  const over = overCapTextures(doc);
  if (over.length && !TREATMENTS[pack.treatment]?.allowTextureDownsize) {
    // Surface (don't silently mutate) — check:assets budget will also flag it.
    console.warn(`  ! ${basename(absPath)}: texture ${Math.max(...over)}px > ${TEX_CAP} cap (no lossy downsize; fix the source)`);
  }

  await doc.transform(prune(), dedup(), weld(), resample());
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  const out = Buffer.from(await io.writeBinary(doc));

  // Structural backstop: re-parse and compare (minus intentionally-dropped clips).
  const check = await io.readBinary(out);
  const sig1 = signature(check);
  const expected = keep
    ? { ...sig0, clips: [...keep].sort(),
        anims: sig0.anims.filter((a) => keep.includes(a.split(':')[0])).sort() }
    : sig0;
  if (!sameSig(expected, sig1)) {
    fail(`${relative(ROOT, absPath)}: structural signature changed — refusing to write.\n` +
      `      before ${sigString(expected)}\n      after  ${sigString(sig1)}`);
    return { wrote: false, bytes: original.length };
  }

  const saved = original.length - out.length;
  const smaller = saved >= MIN_SAVE_BYTES; // ignore sub-KB churn
  if (smaller && MODE === 'optimize') await writeFile(absPath, out);
  const finalBytes = smaller ? out.length : original.length;
  const pct = ((finalBytes / original.length) * 100).toFixed(0);
  console.log(`  ${smaller ? '↓' : '='} ${basename(absPath).padEnd(26)} ` +
    `${(original.length / 1024).toFixed(0)}KB → ${(finalBytes / 1024).toFixed(0)}KB (${pct}%)` +
    `${keep ? ` [clips ${sig0.clips.length}→${keep.length}]` : ''}`);
  return { wrote: smaller };
}

// ── pack file discovery ─────────────────────────────────────────────────────
async function packFiles(pack) {
  const abs = join(ROOT, pack.dir);
  const out = [];
  async function walk(d, rel) {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { if (pack.recurse) await walk(p, r); continue; }
      if (!ent.name.endsWith('.glb')) continue;
      if (pack.include && !pack.include.includes(ent.name)) continue;
      if (pack.exclude?.includes(ent.name)) continue;
      out.push({ abs: p, rel: r });
    }
  }
  await walk(abs, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// key: path under the pack dir, sans .glb (e.g. "hair/hair_short", "wolf").
const keyOf = (rel) => rel.replace(/\.glb$/, '');

// ── manifest emission ───────────────────────────────────────────────────────
async function buildManifest(pack) {
  const files = await packFiles(pack);
  const entries = {};
  for (const { abs, rel } of files) {
    const doc = await io.read(abs);
    const sig = signature(doc);
    const bytes = (await stat(abs)).size;
    entries[keyOf(rel)] = {
      file: rel,
      bytes,
      tris: triCount(doc),
      bones: sig.joints,
      clips: sig.clips,
      morphs: sig.morphs,
      texMaxPx: maxTexEdge(doc),
    };
  }
  return {
    _generated: 'scripts/assets_pipeline.mjs — do not edit by hand',
    category: pack.category,
    base: `/${relative(join(ROOT, 'public'), join(ROOT, pack.dir))}/`.replace(/\\/g, '/'),
    budgetClass: pack.budgetClass,
    assets: entries,
  };
}

function checkBudget(pack, manifest) {
  const cap = budgets[pack.budgetClass];
  if (!cap) { fail(`unknown budget class '${pack.budgetClass}' for pack ${pack.category}`); return; }
  for (const [key, a] of Object.entries(manifest.assets)) {
    if (a.bytes > cap.bytes) fail(`${pack.category}/${key}: ${(a.bytes / 1024).toFixed(0)}KB > ${(cap.bytes / 1024).toFixed(0)}KB byte budget`);
    if (a.tris > cap.tris) fail(`${pack.category}/${key}: ${a.tris} tris > ${cap.tris} budget`);
    if (a.texMaxPx > cap.texMaxPx) fail(`${pack.category}/${key}: texture ${a.texMaxPx}px > ${cap.texMaxPx} cap`);
  }
}

// ── ATTRIBUTION generated block ─────────────────────────────────────────────
const ATTR_START = '<!-- GENERATED:asset-packs START -->';
const ATTR_END = '<!-- GENERATED:asset-packs END -->';
async function refreshAttribution() {
  const path = join(ROOT, 'public/assets/ATTRIBUTION.md');
  let text = existsSync(path) ? await readFile(path, 'utf8') : '# Third-Party Asset Attribution\n';
  const rows = packsCfg.packs.map((p) =>
    `| \`${p.category}\` | ${p.license.source} | ${p.license.author} | ${p.license.spdx} |`).join('\n');
  const block = `${ATTR_START}\n\n### Runtime asset packs (generated by scripts/assets_pipeline.mjs)\n\n` +
    `| Category | Source | Author | License |\n|---|---|---|---|\n${rows}\n\n${ATTR_END}`;
  if (text.includes(ATTR_START) && text.includes(ATTR_END)) {
    text = text.replace(new RegExp(`${ATTR_START}[\\s\\S]*${ATTR_END}`), block);
  } else {
    text = `${text.trimEnd()}\n\n${block}\n`;
  }
  if (MODE === 'check') {
    const cur = existsSync(path) ? await readFile(path, 'utf8') : '';
    if (!cur.includes(block)) fail('ATTRIBUTION.md generated block is stale — run `npm run assets:pipeline`');
  } else {
    await writeFile(path, text);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  console.log(`[assets_pipeline] mode=${MODE}\n`);

  // Reject an unknown treatment up front — the field drives real behavior now,
  // so a typo must fail loudly rather than silently fall through.
  for (const pack of packsCfg.packs) {
    if (!TREATMENTS[pack.treatment]) {
      fail(`pack ${pack.category}: unknown treatment '${pack.treatment}' (known: ${Object.keys(TREATMENTS).join(', ')})`);
    }
  }
  if (problems) { console.error(`\n${problems} problem(s).`); process.exit(1); }

  if (MODE === 'optimize') {
    for (const pack of packsCfg.packs) {
      console.log(`— optimizing ${pack.category} (${pack.dir}) —`);
      for (const { abs } of await packFiles(pack)) await optimizeFile(abs, pack);
      console.log('');
    }
  }

  // Emit / verify manifests (all modes need fresh manifests to check budgets).
  if (!existsSync(MANIFEST_DIR)) await (await import('node:fs/promises')).mkdir(MANIFEST_DIR, { recursive: true });
  for (const pack of packsCfg.packs) {
    const manifest = await buildManifest(pack);
    const outPath = join(MANIFEST_DIR, `${pack.category}.manifest.json`);
    const json = JSON.stringify(manifest, null, 2) + '\n';
    if (MODE === 'check') {
      const cur = existsSync(outPath) ? await readFile(outPath, 'utf8') : '';
      if (cur !== json) fail(`${pack.category}.manifest.json is stale — run \`npm run assets:pipeline\``);
      for (const [key, a] of Object.entries(manifest.assets)) {
        if (!existsSync(join(ROOT, pack.dir, a.file))) fail(`${pack.category}/${key}: file ${a.file} missing`);
      }
    } else {
      await writeFile(outPath, json);
      ok(`emitted ${pack.category}.manifest.json (${Object.keys(manifest.assets).length} assets)`);
    }
    checkBudget(pack, manifest);
  }

  await refreshAttribution();

  if (problems) { console.error(`\n${problems} problem(s).`); process.exit(1); }
  console.log(`\n[assets_pipeline] ${MODE} OK.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
