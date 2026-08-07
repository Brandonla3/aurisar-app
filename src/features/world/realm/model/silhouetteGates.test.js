/**
 * silhouetteGates.test.js — the one claim in silhouetteGates.js that needed a
 * mechanism rather than a sentence.
 *
 * GATE_PITCH_RAD is derived from the dev spike's chase-camera beta, and its
 * doc comment used to assert that computing it "from that same PI/3.1
 * constant means this gate and the spike camera cannot silently drift apart
 * from EACH OTHER while both exist." There was no mechanism behind that:
 * `Math.PI / 3.1` was typed independently in two files, model/ cannot import
 * view/ (boundary.test.js), and nothing imports view/dev/spike.js at all —
 * retuning the camera's beta left the entire realm suite green.
 *
 * A shared JS constant is genuinely impossible here and should stay
 * impossible; the boundary rule is worth more than this coupling. But a
 * SOURCE SCAN is not an import, and boundary.test.js already establishes the
 * idiom (readFileSync + regex over sibling source, four times over). So the
 * relationship is enforced the same way, in the direction that costs nothing
 * architecturally: this test reads spike.js as TEXT.
 *
 * WHAT THIS DOES AND DOES NOT SAY. It does not claim PI/3.1 is the right
 * angle, or that the spike camera is the shipped one — it is not, and the
 * constant's own comment says so at length. The camera is orbitable
 * (lowerBetaLimit 0.25, upperBetaLimit 1.5), so "the spike camera's pitch" is
 * a range and GATE_PITCH_RAD is a representative pick from it. What this
 * says is narrower and is exactly the thing the comment promised: if someone
 * retunes the camera, they find out here rather than discovering years later
 * that the gates measure an eye nothing uses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_PITCH_RAD, GATE_RES } from './silhouetteGates.js';

const REALM_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPIKE = join(REALM_ROOT, 'view', 'dev', 'spike.js');

describe('GATE_PITCH_RAD is coupled to the camera it claims to be derived from', () => {
  it('the spike still builds its chase camera at the beta this gate is derived from', () => {
    const src = readFileSync(SPIKE, 'utf8');
    // ArcRotateCamera(name, alpha, beta, radius, target, scene) — beta is the
    // third argument, and the whole constructor is on one wrapped call.
    const m = src.match(/new BABYLON\.ArcRotateCamera\(\s*'chase',\s*([^,]+),\s*([^,]+),/);
    expect(
      m,
      'view/dev/spike.js no longer constructs an ArcRotateCamera named "chase" in a shape this scan can read. '
      + 'If the chase rig moved or was replaced, re-derive GATE_PITCH_RAD from the new camera and update this '
      + 'scan — do not delete it and leave the constant asserting a provenance nothing checks.',
    ).toBeTruthy();

    const beta = m[2].trim();
    expect(
      beta,
      `the spike's chase beta is now \`${beta}\`, but GATE_PITCH_RAD is still derived from Math.PI / 3.1. `
      + 'Every actor silhouette gate would keep rasterizing an eye the spike no longer uses. Re-derive '
      + 'GATE_PITCH_RAD as PI/2 - <the new beta> (and re-check ACTOR_WINDOW at the same time: its worst '
      + 'fitsWindow margin falls below the 0.05 target around pitch 1.0 and clips by ~1.2).',
    ).toBe('Math.PI / 3.1');

    // ...and the derivation itself, so the two halves cannot rot apart either.
    expect(GATE_PITCH_RAD).toBeCloseTo(Math.PI / 2 - Math.PI / 3.1, 12);
  });

  it('anti-vacuity: the scan really read the spike, and the constant is a live number', () => {
    // A mistyped path would make readFileSync throw, but an empty or
    // unrelated file would make the regex simply not match — which the first
    // test reports as "no longer constructs", indistinguishable from a real
    // regression. This pins that the file is the one intended.
    const src = readFileSync(SPIKE, 'utf8');
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('ArcRotateCamera');
    expect(GATE_PITCH_RAD).toBeGreaterThan(0);
    expect(GATE_PITCH_RAD).toBeLessThan(Math.PI / 2);
    expect(GATE_RES).toBe(48);
  });
});
