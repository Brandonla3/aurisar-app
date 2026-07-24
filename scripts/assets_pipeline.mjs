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
 * - meshopt is lossless for geometry and Babylon 9 decodes EXT_meshopt_compression
 *   (decoder self-hosted via src/features/world/game/babylonDecoders.js). Draco is
 *   rejected (larger decoder, worse ratio here); KTX2 is deferred until the texture
 *   payload warrants a transcoder (docs/world-design-plan.md, Batch B).
 * - Quantization rides inside meshopt() with morph/skin-safe defaults; the signature
 *   re-check is the backstop.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, dedup, weld, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
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

// ── glTF structural probes ──────────────────────────────────────────────────
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function signature(doc) {
  const root = doc.getRoot();
  const joints = root.listSkins().reduce((a, s) => a + s.listJoints().length, 0);
  const clips = root.listAnimations().map((a) => a.getName()).sort();
  const morphs = [];
  root.listMeshes().forEach((m) => { const tn = m.getExtras()?.targetNames; if (tn) morphs.push(...tn); });
  return { joints, clips, morphs: morphs.sort(), meshes: root.listMeshes().length };
}

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

const sameSig = (a, b) =>
  a.joints === b.joints && a.meshes === b.meshes &&
  a.clips.join('|') === b.clips.join('|') && a.morphs.join('|') === b.morphs.join('|');

// ── texture downsize/recompress (only when it helps) ────────────────────────
// Downsize any texture whose longest edge exceeds TEX_CAP, and convert
// png/jpeg to webp. Already-small webp is left untouched so we never inflate.
async function optimizeTextures(doc) {
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const mime = tex.getMimeType();
    const size = tex.getSize();
    const tooBig = size && Math.max(size[0], size[1]) > TEX_CAP;
    const reencode = mime === 'image/png' || mime === 'image/jpeg';
    if (!tooBig && !reencode) continue;
    let pipe = sharp(Buffer.from(img));
    if (tooBig) {
      const scale = TEX_CAP / Math.max(size[0], size[1]);
      pipe = pipe.resize(Math.round(size[0] * scale), Math.round(size[1] * scale), {
        fit: 'fill', kernel: sharp.kernel.lanczos3,
      });
    }
    const out = await pipe.webp({ quality: 88, effort: 5 }).toBuffer();
    // Never enlarge a single texture.
    if (out.length < img.byteLength || tooBig) {
      tex.setImage(out).setMimeType('image/webp');
    }
  }
}

// ── per-file optimization ───────────────────────────────────────────────────
async function optimizeFile(absPath, pack) {
  const original = await readFile(absPath);
  const doc = await io.read(absPath);
  const sig0 = signature(doc);

  // Optional clip curation (drop CC0-pack clips the game never plays).
  const keep = pack.keepClips?.[basename(absPath)];
  if (keep) {
    const keepSet = new Set(keep);
    for (const anim of doc.getRoot().listAnimations()) {
      if (!keepSet.has(anim.getName())) anim.dispose();
    }
  }

  await doc.transform(prune(), dedup(), weld(), resample());
  await optimizeTextures(doc);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  const out = Buffer.from(await io.writeBinary(doc));

  // Structural backstop: re-parse and compare (minus intentionally-dropped clips).
  const check = await io.readBinary(out);
  const sig1 = signature(check);
  const expected = keep
    ? { ...sig0, clips: [...keep].sort() }
    : sig0;
  if (!sameSig(expected, sig1)) {
    fail(`${relative(ROOT, absPath)}: structural signature changed — refusing to write.\n` +
      `      before ${JSON.stringify(expected)}\n      after  ${JSON.stringify(sig1)}`);
    return { wrote: false, bytes: original.length };
  }

  const smaller = out.length < original.length;
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
