/**
 * groundSplat — bare-ground surface composition at a world point: how much of
 * (x,z) should read as dirt, sand, rock or dry/wildflower field instead of
 * lush grass. Pure function of the already-assembled worldgen model (biome
 * blend, trails, lake shore, mountain cliffs, height).
 *
 * This is the single source of truth for BOTH what the terrain shader paints
 * (ashwoodTileProvider.js bakes it as per-vertex splat weights) and how
 * densely AshwoodGrass scatters blades (thinning/clearing blades where the
 * ground itself is meant to show through) — so the painted surface and the
 * blade field covering it always agree.
 *
 * Pure math, no Babylon — safe to call from tile baking (Node) and from the
 * client's grass rebuild alike.
 */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep01(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
}

/**
 * @param {object} wg  a createWorldgen() instance
 * @param {number} x
 * @param {number} z
 * @param {{r:number,g:number,b:number}} [outColor] optional scratch to receive
 *   the blended biome ground colour (avoids a second biomeColorAt call when
 *   the caller also needs it, e.g. for a vertex-colour buffer).
 * @returns {{dirt:number, sand:number, rock:number, field:number, bc:object}}
 */
export function computeGroundSplat(wg, x, z, outColor) {
  const bc = outColor ?? { r: 0, g: 0, b: 0 };
  wg.biomeColorAt(x, z, bc);

  const dirt = clamp01(wg.trailDirtAt(x, z) * 1.2);
  const sand = clamp01(wg.lakeShoreAt(x, z));

  // Stoniness from biome tint "greenness": grey/brown biomes (Highlands,
  // Mourner's Rise) expose rock/bare earth; lush green biomes don't.
  const green = bc.g - 0.5 * (bc.r + bc.b);
  const stony = clamp01(1 - smoothstep01(0.02, 0.16, green));
  const cliff = wg.mtnCliffAt?.(x, z) ?? 0;
  const alt = wg.surfaceY(x, z);
  const rock = clamp01(Math.max(stony * 0.65, cliff, smoothstep01(24, 60, alt)));

  // Field (dry grass / wildflowers) fills lush, level ground away from
  // trails and shore; the terrain shader breaks it into patches.
  const field = clamp01(smoothstep01(0.12, 0.20, green) * (1 - dirt) * (1 - sand));

  return { dirt, sand, rock, field, bc };
}
