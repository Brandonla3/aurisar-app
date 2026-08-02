/**
 * skyPlaylist — authored time. Day/night as a dwell-weighted stance playlist.
 *
 * PURE. The cycle is not an astronomical simulation: it is a playlist of
 * hand-authored lighting stances with UNEQUAL dwell times, so the world
 * lingers in the dramatic states (dawnfire, gloaming) and hurries through
 * boring noon. Evaluation is a closed-form lookup over
 * `(timeMs - epochMs) mod cycleLen` — stateless, so every client evaluating
 * the same server time renders the same sunset, offline play uses the same
 * function of local time, and there is nothing to desync or restore.
 *
 * Two schedules, deliberately decoupled:
 *  - COLORS (stops, fog, ambient, star visibility) follow the dwell-and-rush
 *    segment table — they may hold and then sweep.
 *  - THE SUN follows a Catmull-Rom spline over raw cycle phase (C1 in R³;
 *    the post-spline normalize makes it only approximately C1 on the sphere —
 *    the bounded-angular-step test is the actual continuity contract).
 *    Players read shadow motion continuously even when they ignore sky
 *    color; if the sun obeyed the dwell schedule, shadows would park during
 *    a dwell and lurch through transitions. Splining direction over phase
 *    keeps shadow motion smooth while the mood still lingers.
 */

/** One full cycle. 40 minutes: a median session always banks a dusk or dawn. */
export const CYCLE_MS = 40 * 60 * 1000;

const v3 = (r, g, b) => [r, g, b];

/**
 * The authored stances. `dwellMs` is how long the stance HOLDS; `blendMs` is
 * the transition into the NEXT stance. Sun/moon elevation+azimuth in degrees
 * (converted to vectors once at module init). Sum of all dwell+blend must be
 * CYCLE_MS — asserted by a test, not trusted.
 */
export const STANCES = Object.freeze([
  {
    id: 'dawnfire',
    dwellMs: 4 * 60_000,
    blendMs: 3 * 60_000,
    sun: { elevDeg: 8, azDeg: 96 },
    stops: {
      horizon: v3(0.95, 0.55, 0.32),
      mid: v3(0.62, 0.48, 0.52),
      zenith: v3(0.24, 0.30, 0.48),
      glow: v3(0.55, 0.28, 0.08),
    },
    fogDensity: 0.0058,
    sunTint: v3(1.0, 0.72, 0.45),
    sunIntensity: 1.05,
    ambient: v3(0.42, 0.36, 0.38),
    ambientIntensity: 0.34,
    starVisibility: 0.08,
  },
  {
    id: 'morning',
    dwellMs: 5 * 60_000,
    blendMs: 2 * 60_000,
    sun: { elevDeg: 34, azDeg: 128 },
    stops: {
      horizon: v3(0.74, 0.80, 0.86),
      mid: v3(0.46, 0.62, 0.84),
      zenith: v3(0.22, 0.38, 0.68),
      glow: v3(0.30, 0.26, 0.14),
    },
    fogDensity: 0.0044,
    sunTint: v3(1.0, 0.96, 0.88),
    sunIntensity: 1.25,
    ambient: v3(0.38, 0.42, 0.44),
    ambientIntensity: 0.38,
    starVisibility: 0,
  },
  {
    id: 'high-noon',
    dwellMs: 3 * 60_000, // the boring state gets the SHORT straw
    blendMs: 2 * 60_000,
    sun: { elevDeg: 62, azDeg: 178 },
    stops: {
      horizon: v3(0.78, 0.84, 0.88),
      mid: v3(0.42, 0.60, 0.86),
      zenith: v3(0.18, 0.34, 0.66),
      glow: v3(0.18, 0.18, 0.12),
    },
    fogDensity: 0.0036,
    sunTint: v3(1.0, 1.0, 0.96),
    sunIntensity: 1.35,
    ambient: v3(0.40, 0.43, 0.45),
    ambientIntensity: 0.40,
    starVisibility: 0,
  },
  {
    id: 'gloaming',
    dwellMs: 6 * 60_000, // the signature state gets the LONG straw
    blendMs: 3 * 60_000,
    sun: { elevDeg: 6, azDeg: 262 },
    stops: {
      horizon: v3(0.88, 0.46, 0.30),
      mid: v3(0.52, 0.32, 0.50),
      zenith: v3(0.16, 0.16, 0.38),
      glow: v3(0.60, 0.22, 0.05),
    },
    fogDensity: 0.0062,
    sunTint: v3(1.0, 0.62, 0.38),
    sunIntensity: 0.9,
    ambient: v3(0.40, 0.30, 0.36),
    ambientIntensity: 0.30,
    starVisibility: 0.22,
  },
  {
    id: 'moonwash',
    dwellMs: 8 * 60_000,
    blendMs: 4 * 60_000,
    // az 10, not 330: the sub-horizon sun must sit just past north, already on
    // its way to the eastern dawn, or the moonwash->dawnfire chord goes
    // near-antipodal and the direction spline degenerates (the antipodal test
    // caught exactly this at az 330, dot -0.58).
    sun: { elevDeg: -28, azDeg: 10 },
    stops: {
      horizon: v3(0.10, 0.14, 0.22),
      mid: v3(0.07, 0.10, 0.19),
      zenith: v3(0.03, 0.05, 0.12),
      glow: v3(0.04, 0.06, 0.10),
    },
    fogDensity: 0.0052,
    sunTint: v3(0.62, 0.70, 0.88), // the moon is the key light at night
    sunIntensity: 0.35,
    ambient: v3(0.16, 0.19, 0.28),
    ambientIntensity: 0.22,
    starVisibility: 1,
  },
]);

// ── Derived tables, built once ───────────────────────────────────────────────

const degToDir = (elevDeg, azDeg) => {
  const el = (elevDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
};

/** Segment table: [dwell₀, blend₀, dwell₁, blend₁, ...] with prefix sums. */
const SEGMENTS = (() => {
  const segs = [];
  let t = 0;
  STANCES.forEach((s, i) => {
    segs.push({ kind: 'dwell', from: i, to: i, start: t, len: s.dwellMs });
    t += s.dwellMs;
    segs.push({ kind: 'blend', from: i, to: (i + 1) % STANCES.length, start: t, len: s.blendMs });
    t += s.blendMs;
  });
  return { segs, total: t };
})();

export const PLAYLIST_TOTAL_MS = SEGMENTS.total;

/** Sun directions per stance, for the spline. */
const SUN_DIRS = STANCES.map((s) => degToDir(s.sun.elevDeg, s.sun.azDeg));
/** The moon opposes the sun's azimuth at a fixed gentle elevation. */
const MOON_DIRS = STANCES.map((s) => degToDir(24, s.sun.azDeg + 180));

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const normalize = (v) => {
  const inv = 1 / Math.hypot(v[0], v[1], v[2]);
  return [v[0] * inv, v[1] * inv, v[2] * inv];
};

/**
 * Catmull-Rom over the stance sun directions, parameterized by raw cycle
 * phase (NOT the dwell schedule) — this is what keeps shadow motion C1.
 * Normalized after evaluation; segments are far from antipodal by authoring
 * rule (validated in tests), so the chord never collapses.
 */
function splineDir(dirs, phase01) {
  const n = dirs.length;
  const t = phase01 * n;
  const i1 = Math.floor(t) % n;
  const i0 = (i1 + n - 1) % n;
  const i2 = (i1 + 1) % n;
  const i3 = (i1 + 2) % n;
  const u = t - Math.floor(t);

  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p0 = dirs[i0][c];
    const p1 = dirs[i1][c];
    const p2 = dirs[i2][c];
    const p3 = dirs[i3][c];
    out[c] = 0.5 * (
      2 * p1
      + (-p0 + p2) * u
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
      + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u
    );
  }
  return normalize(out);
}

function blendStops(a, b, t) {
  return {
    horizon: lerpV3(a.horizon, b.horizon, t),
    mid: lerpV3(a.mid, b.mid, t),
    zenith: lerpV3(a.zenith, b.zenith, t),
    glow: lerpV3(a.glow, b.glow, t),
  };
}

/** Blend everything EXCEPT sun/moon direction (those come from the spline). */
export function blendStances(a, b, t) {
  return {
    stops: blendStops(a.stops, b.stops, t),
    fogDensity: lerp(a.fogDensity, b.fogDensity, t),
    sunTint: lerpV3(a.sunTint, b.sunTint, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    ambient: lerpV3(a.ambient, b.ambient, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
    starVisibility: lerp(a.starVisibility, b.starVisibility, t),
  };
}

const stanceFields = (s) => ({
  stops: s.stops,
  fogDensity: s.fogDensity,
  sunTint: s.sunTint,
  sunIntensity: s.sunIntensity,
  ambient: s.ambient,
  ambientIntensity: s.ambientIntensity,
  starVisibility: s.starVisibility,
});

/**
 * The evaluator. timeMs is server time (or local time offline); epochMs
 * anchors phase so deploys can preserve continuity.
 *
 * @returns a resolved stance for skyStateFrom(): colors from the segment
 *   table, sun/moon directions from the phase spline, plus phase/segment
 *   metadata for UI ("gloaming in 4 min") and tests.
 */
export function playlistStateAt(timeMs, epochMs = 0) {
  const total = SEGMENTS.total;
  const phaseMs = ((timeMs - epochMs) % total + total) % total;

  const seg = SEGMENTS.segs.find((s) => phaseMs < s.start + s.len);
  const a = STANCES[seg.from];
  const b = STANCES[seg.to];
  const fields = seg.kind === 'dwell'
    ? stanceFields(a)
    : blendStances(stanceFields(a), stanceFields(b), ease((phaseMs - seg.start) / seg.len));

  const phase01 = phaseMs / total;
  return {
    ...fields,
    sunDir: splineDir(SUN_DIRS, phase01),
    moonDir: splineDir(MOON_DIRS, phase01),
    phase01,
    segmentKind: seg.kind,
    stanceId: seg.kind === 'dwell' ? a.id : `${a.id}>${b.id}`,
  };
}

/**
 * When does a given stance's dwell next begin? Closed-form, for "gloaming in
 * 4 min" UI and dusk-only spawn scheduling.
 */
export function nextStanceStart(timeMs, stanceId, epochMs = 0) {
  const idx = STANCES.findIndex((s) => s.id === stanceId);
  if (idx === -1) return null;
  const seg = SEGMENTS.segs.find((s) => s.kind === 'dwell' && s.from === idx);
  const total = SEGMENTS.total;
  const phaseMs = ((timeMs - epochMs) % total + total) % total;
  const delta = ((seg.start - phaseMs) % total + total) % total;
  return timeMs + (delta === 0 ? total : delta);
}
