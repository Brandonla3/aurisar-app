/**
 * build_gilded_sentinel.mjs — assemble the Gilded Sentinel NPC model.
 *
 * Meshy AI exports a character mesh and each animation clip as a SEPARATE
 * .glb, all sharing an identical 24-bone skeleton and node topology. This
 * script folds the four animation clips into the character document so the
 * runtime loads one AssetContainer with every clip attached, then names the
 * clips so CharacterAvatar's idle/walk resolver (matches /idle/i, /walk/i)
 * picks them up.
 *
 *   Sources: scripts/assets/gilded_sentinel/*.glb (Meshy exports)
 *   Output:  public/assets/characters/gilded_sentinel.glb
 *
 * Because every source shares the same node ORDER (verified below), animation
 * channels are retargeted by node index — no name lookup or fuzzy matching.
 *
 * Run: npm run build:sentinel
 */

import { NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'assets', 'gilded_sentinel');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'characters', 'gilded_sentinel.glb');

// Source clip file → animation name baked into the output. The character's
// own bundled clip becomes "Idle" (a near-static rest pose Meshy ships with
// the mesh); the rest keep descriptive names. CharacterAvatar plays "Idle"
// for stationary characters and cross-fades to "Walk" when moving.
const ANIM_FILES = [
  { file: 'walking.glb',     name: 'Walk' },
  { file: 'running.glb',     name: 'Run' },
  { file: 'run_03.glb',      name: 'Run2' },
  { file: 'sword_slash.glb', name: 'SwordSlash' },
];

const io = new NodeIO();

const base = await io.read(path.join(SRC, 'character.glb'));
const baseRoot = base.getRoot();
const baseNodes = baseRoot.listNodes();
const buffer = baseRoot.listBuffers()[0];

// Rename the character's bundled clip so it reads as the idle loop.
const bundled = baseRoot.listAnimations()[0];
if (bundled) bundled.setName('Idle');

for (const { file, name } of ANIM_FILES) {
  const src = await io.read(path.join(SRC, file));
  const srcRoot = src.getRoot();
  const srcNodes = srcRoot.listNodes();

  if (srcNodes.length !== baseNodes.length) {
    throw new Error(`${file}: node count ${srcNodes.length} != base ${baseNodes.length}`);
  }
  const srcIndexOf = new Map(srcNodes.map((n, i) => [n, i]));

  const srcAnim = srcRoot.listAnimations()[0];
  if (!srcAnim) { console.warn(`${file}: no animation, skipping`); continue; }

  const anim = base.createAnimation(name);
  // One output document sampler per source sampler (channels can share).
  const samplerMap = new Map();

  for (const ch of srcAnim.listChannels()) {
    const srcSampler = ch.getSampler();
    let sampler = samplerMap.get(srcSampler);
    if (!sampler) {
      const inA = srcSampler.getInput();
      const outA = srcSampler.getOutput();
      const input = base.createAccessor()
        .setType(inA.getType())
        .setArray(inA.getArray().slice())
        .setBuffer(buffer);
      const output = base.createAccessor()
        .setType(outA.getType())
        .setArray(outA.getArray().slice())
        .setBuffer(buffer);
      sampler = base.createAnimationSampler()
        .setInput(input)
        .setOutput(output)
        .setInterpolation(srcSampler.getInterpolation());
      anim.addSampler(sampler);
      samplerMap.set(srcSampler, sampler);
    }

    const targetIndex = srcIndexOf.get(ch.getTargetNode());
    anim.addChannel(base.createAnimationChannel()
      .setTargetNode(baseNodes[targetIndex])
      .setTargetPath(ch.getTargetPath())
      .setSampler(sampler));
  }
  console.log(`+ ${name.padEnd(11)} (${srcAnim.listChannels().length} channels) from ${file}`);
}

await io.write(OUT, base);
console.log(`\nWrote ${path.relative(path.join(__dirname, '..'), OUT)}`);
console.log('Animations:', baseRoot.listAnimations().map(a => a.getName()).join(', '));
