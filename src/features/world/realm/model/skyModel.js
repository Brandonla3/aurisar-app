/**
 * skyModel — the sky gradient as ONE definition with TWO emitters.
 *
 * PURE. The core trick of the Realm's atmosphere: the same curve that shades
 * the sky dome (GPU, via BSL) also produces scene.fogColor (CPU, via the
 * FogDriver). `fogColor` is DEFINED as the gradient evaluated at the horizon
 * (h = 0), so the classic fog/sky seam — the visible join where distant
 * terrain's fog meets the dome — cannot exist by construction. Same inputs,
 * same curve, two evaluators.
 *
 * To keep the two evaluators from drifting, there is exactly one source of
 * truth: GRADIENT_DEF, a plain constants table. `evalGradientJs` interprets
 * it; `emitGradientBsl` prints BSL (the GLSL-shaped dialect RealmFnBlock
 * transpiles per backend) with the SAME constants stamped in. A test asserts
 * the identity numerically and snapshots the emitted source — a curve change
 * that touches only one emitter cannot land.
 *
 * The gradient is deliberately simple: three color stops (horizon / mid /
 * zenith) blended by smoothstep over normalized elevation, plus a sun-glow
 * term that warms the sky around the sun's azimuth near the horizon. All the
 * drama (dawn fire, gloaming purples) comes from the stance playlist feeding
 * different stop colors in — the curve itself never changes shape.
 */

/**
 * The single source of curve truth. Numbers only — anything here appears in
 * both the JS evaluator and the emitted BSL, byte-for-byte via toFixed.
 */
export const GRADIENT_DEF = Object.freeze({
  /** Elevation (0..1) where the horizon band gives way to the mid band. */
  midStart: 0.04,
  midEnd: 0.42,
  /** Elevation where the mid band gives way to zenith. */
  zenithStart: 0.38,
  zenithEnd: 0.95,
  /** Sun glow: cosine-power falloff around the sun direction... */
  glowPower: 5.0,
  /** ...fading out entirely by this elevation. */
  glowMaxElevation: 0.35,
});

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The JS evaluator. `elev` is normalized view elevation (0 horizon, 1 zenith);
 * `sunDot` is the dot product of the view direction with the sun direction
 * (glow input); `stops` are the stance-provided colors as [r,g,b] arrays.
 *
 * Mirrors emitGradientBsl exactly — change one, change both (the test bites).
 */
export function evalGradientJs(elev, sunDot, stops) {
  const d = GRADIENT_DEF;
  const e = Math.min(Math.max(elev, 0), 1);

  const mid = smoothstep(d.midStart, d.midEnd, e);
  const zen = smoothstep(d.zenithStart, d.zenithEnd, e);

  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const base = stops.horizon[i] * (1 - mid) + stops.mid[i] * mid;
    out[i] = base * (1 - zen) + stops.zenith[i] * zen;
  }

  // Sun glow: warm the sky toward the sun near the horizon.
  const glow = Math.pow(Math.max(sunDot, 0), d.glowPower)
    * (1 - smoothstep(0, d.glowMaxElevation, e));
  for (let i = 0; i < 3; i++) {
    out[i] = out[i] + stops.glow[i] * glow;
  }
  return out;
}

const f = (n) => {
  const s = n.toFixed(4);
  return s;
};

/**
 * The BSL emitter. Produces the body of a function
 *   vec3 realmSkyGradient(float elev, float sunDot,
 *                         vec3 horizonC, vec3 midC, vec3 zenithC, vec3 glowC)
 * with GRADIENT_DEF constants stamped in. RealmFnBlock transpiles it per
 * backend; the dome material feeds the same stance colors the FogDriver used.
 */
export function emitGradientBsl() {
  const d = GRADIENT_DEF;
  return `
    float e = clamp(elev, 0.0, 1.0);
    float mid = smoothstep(${f(d.midStart)}, ${f(d.midEnd)}, e);
    float zen = smoothstep(${f(d.zenithStart)}, ${f(d.zenithEnd)}, e);
    vec3 base = mix(horizonC, midC, mid);
    vec3 c = mix(base, zenithC, zen);
    float glow = pow(max(sunDot, 0.0), ${f(d.glowPower)}) * (1.0 - smoothstep(0.0, ${f(d.glowMaxElevation)}, e));
    return c + glowC * glow;`;
}

/**
 * The full atmosphere snapshot for one moment: everything the view layer may
 * know, as plain numbers. FogDriver copies these onto the scene; the dome
 * material receives the same object's fields as uniforms; audio/UI subscribe
 * to the same shape later (the "mood bus").
 *
 * `stance` is a resolved stance (see skyPlaylist.js): stop colors, fog
 * density, sun/moon directions, ambient.
 */
export function skyStateFrom(stance) {
  // THE identity: fog color IS the horizon of the sky, looking away from the
  // sun (sunDot 0 — fog is omnidirectional, so it takes the neutral horizon).
  const fogColor = evalGradientJs(0, 0, stance.stops);

  return {
    fogColor,
    fogDensity: stance.fogDensity,
    clearColor: fogColor,
    stops: stance.stops,
    sunDir: stance.sunDir,
    moonDir: stance.moonDir,
    sunTint: stance.sunTint,
    sunIntensity: stance.sunIntensity,
    ambient: stance.ambient,
    ambientIntensity: stance.ambientIntensity,
    starVisibility: stance.starVisibility,
  };
}
