#!/usr/bin/env node
/**
 * build_audio_sfx.mjs — synthesizes the world's placeholder SFX as small mono
 * WAVs into public/assets/audio/ (Batch C). Fully procedural (no external
 * downloads, no deps), project-authored → CC0. Real recorded/licensed audio
 * drops in later at the same filenames.
 *
 *   swing.wav  — a fast noise swoosh (weapon attack)
 *   hit.wav    — a short thud (attack lands / mob takes damage)
 *   loot.wav   — a two-note chime (chest / loot)
 *   ui.wav     — a soft blip (UI confirm)
 *
 * Re-run: node scripts/build_audio_sfx.mjs   (--check verifies freshness in CI)
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets/audio');
const RATE = 22050;
const CHECK = process.argv.includes('--check');

// Deterministic value-noise so output is byte-stable across runs (Math.random
// would make --check flap). A tiny LCG seeded per-sound.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff * 2 - 1; };
}

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

const secs = (t) => Math.floor(t * RATE);

// swing: filtered noise burst, quick attack + exponential decay.
function swing() {
  const n = secs(0.16), out = new Float32Array(n), rng = makeRng(1);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    lp = lp * 0.72 + rng() * 0.28;                 // one-pole lowpass → whoosh
    const env = Math.min(1, t * 12) * Math.pow(1 - t, 2.2);
    out[i] = lp * env * 0.6;
  }
  return out;
}
// hit: low sine thump + short noise crack.
function hit() {
  const n = secs(0.14), out = new Float32Array(n), rng = makeRng(2);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.pow(1 - t, 3);
    const body = Math.sin(2 * Math.PI * 92 * (i / RATE)) * env;
    const crack = rng() * Math.pow(1 - t, 8) * 0.5;
    out[i] = (body * 0.7 + crack) * 0.7;
  }
  return out;
}
// loot: two soft sine notes (A5→E6) with gentle bell envelope.
function loot() {
  const n = secs(0.30), out = new Float32Array(n);
  const note = (f, i, start) => {
    const tt = i / RATE - start;
    if (tt < 0) return 0;
    const env = Math.min(1, tt * 40) * Math.exp(-tt * 7);
    return Math.sin(2 * Math.PI * f * tt) * env;
  };
  for (let i = 0; i < n; i++) out[i] = (note(880, i, 0) + note(1320, i, 0.09)) * 0.4;
  return out;
}
// ui: brief soft blip.
function ui() {
  const n = secs(0.06), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = Math.sin(2 * Math.PI * 760 * (i / RATE)) * Math.pow(1 - t, 2) * 0.35;
  }
  return out;
}

const SOUNDS = { swing, hit, loot, ui };

async function main() {
  let stale = 0;
  await mkdir(OUT, { recursive: true });
  for (const [name, gen] of Object.entries(SOUNDS)) {
    const bytes = wav(gen());
    const path = join(OUT, `${name}.wav`);
    if (CHECK) {
      const cur = existsSync(path) ? await readFile(path) : Buffer.alloc(0);
      if (!cur.equals(bytes)) { console.error(`✗ ${name}.wav stale — run \`npm run build:audio\``); stale++; }
    } else {
      await writeFile(path, bytes);
      console.log(`  ${name}.wav (${(bytes.length / 1024).toFixed(1)} KB)`);
    }
  }
  if (stale) process.exit(1);
  console.log(CHECK ? '✓ audio SFX fresh.' : 'Audio SFX generated.');
}
main().catch((e) => { console.error(e); process.exit(1); });
