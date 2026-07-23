/**
 * mapRender — shared terrain-painting + marker/label helpers.
 *
 * Single source of truth for turning the deterministic worldgen model into a
 * 2D top-down image. Consumed by both the minimap (TestingHud) and the
 * full-screen World Map (WorldMap.jsx).
 *
 * The biome paint (worldgen.biomeColorAt) is an inverse-distance-weighted loop
 * over ~11 biome seeds per sample — fine to run ONCE into an offscreen canvas,
 * never per frame. Bake once, then blit/scale the result.
 */

const VOID_RGB = { r: 14, g: 16, b: 22 }; // outside the world disc

/**
 * Bake the world terrain into an offscreen canvas.
 *
 * @param {object} worldgen  createWorldgen() model — needs biomeColorAt + config
 * @param {object} opts
 * @param {number} opts.size                 square pixel resolution of the bake
 * @param {{minX,minZ,maxX,maxZ}} opts.bounds world-unit bounds the canvas covers
 * @returns {{canvas, bounds, worldToPx, pxToWorld}}
 */
export function buildWorldMapCanvas(worldgen, { size, bounds }) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const { minX, minZ, maxX, maxZ } = bounds;
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;

  const radius = worldgen.config?.radius ?? Infinity;
  const r2 = radius * radius;
  const lake = worldgen.config?.lake ?? null;
  const lakeR2 = lake ? (lake.waterR ?? 36) * (lake.waterR ?? 36) : 0;

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const out = { r: 0, g: 0, b: 0 };

  for (let py = 0; py < size; py++) {
    // canvas-y maps to world-z (north = top = minZ)
    const wz = minZ + ((py + 0.5) / size) * spanZ;
    for (let px = 0; px < size; px++) {
      const wx = minX + ((px + 0.5) / size) * spanX;
      const i = (py * size + px) * 4;

      let r, g, b;
      const inLake = lake
        && (wx - lake.x) * (wx - lake.x) + (wz - lake.z) * (wz - lake.z) < lakeR2;
      if (wx * wx + wz * wz > r2) {
        // outside the round world
        r = VOID_RGB.r; g = VOID_RGB.g; b = VOID_RGB.b;
      } else if (inLake) {
        // Mirrormere water
        r = 38; g = 74; b = 110;
      } else {
        worldgen.biomeColorAt(wx, wz, out);
        r = Math.round(out.r * 255);
        g = Math.round(out.g * 255);
        b = Math.round(out.b * 255);
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const worldToPx = (x, z) => ({
    px: ((x - minX) / spanX) * size,
    py: ((z - minZ) / spanZ) * size,
  });
  const pxToWorld = (px, py) => ({
    x: minX + (px / size) * spanX,
    z: minZ + (py / size) * spanZ,
  });

  return { canvas, bounds, size, worldToPx, pxToWorld };
}

/**
 * Resolve the player's current named location for a header readout.
 * Priority: dungeon → lake → mountain → forest → biome name.
 *
 * @param {object} worldgen
 * @param {number} x  world units
 * @param {number} z  world units
 * @param {{inDungeon?: boolean}} [opts]
 * @returns {string}
 */
export function locationLabelAt(worldgen, x, z, opts = {}) {
  if (!worldgen) return '';
  const cfg = worldgen.config ?? {};
  if (opts.inDungeon) {
    // Which dungeon? Resolve the nearest interior anchor to the player's x
    // (interiors sit at distinct x — castle 840 / hollowDeep 1000 / frostspire
    // 1300), instead of always naming Hollow Deep.
    let near = null;
    for (const d of Object.values(cfg.interiors ?? {})) {
      if (!near || Math.abs(d.cx - x) < Math.abs(near.cx - x)) near = d;
    }
    return near?.name ?? 'Dungeon';
  }
  const lake = cfg.lake;
  if (lake) {
    const dx = x - lake.x;
    const dz = z - lake.z;
    const lr = (lake.waterR ?? 36) + 6;
    if (dx * dx + dz * dz < lr * lr) return lake.name ?? 'Mirrormere';
  }
  if (worldgen.inMountain?.(x, z)) return 'The Mountain';
  if (worldgen.inForest?.(x, z)) return 'Wildwood';
  const b = worldgen.biomeAt?.(x, z);
  return b?.name ?? 'The Wilds';
}

/**
 * Draw POI markers + (optionally) zone/dungeon labels on top of a painted map.
 * `worldToPx(x,z) -> {px,py}` projects world units into the target canvas;
 * pass the minimap's player-centred projector or the world-map's static one.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} mapData  { worldgen, config, sites, waypoints, npcs }
 * @param {(x:number,z:number)=>{px:number,py:number}} worldToPx
 * @param {object} [opts]   { labels:boolean, w:number, h:number, font:number }
 */
export function drawMapMarkers(ctx, mapData, worldToPx, opts = {}) {
  const { config, sites, waypoints, npcs } = mapData;
  const w = opts.w ?? ctx.canvas.width;
  const h = opts.h ?? ctx.canvas.height;
  const labels = opts.labels ?? false;
  const font = opts.font ?? 11;
  const inView = (p) => p.px >= -8 && p.px <= w + 8 && p.py >= -8 && p.py <= h + 8;

  // Caves — small dark circles
  if (sites?.caves) {
    ctx.fillStyle = 'rgba(20, 16, 28, 0.92)';
    ctx.strokeStyle = 'rgba(200, 180, 255, 0.55)';
    ctx.lineWidth = 1;
    for (const c of sites.caves) {
      const p = worldToPx(c.x, c.z);
      if (!inView(p)) continue;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Ruins — small amber diamonds
  if (sites?.ruins) {
    ctx.fillStyle = 'rgba(214, 178, 92, 0.9)';
    for (const ru of sites.ruins) {
      const p = worldToPx(ru.x, ru.z);
      if (!inView(p)) continue;
      ctx.save();
      ctx.translate(p.px, p.py);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2.4, -2.4, 4.8, 4.8);
      ctx.restore();
    }
  }

  // Chests — small subtle gold squares (low-key so the full manifest doesn't
  // dominate the map or over-spoil loot locations)
  if (sites?.chests) {
    ctx.fillStyle = 'rgba(230, 190, 90, 0.55)';
    ctx.strokeStyle = 'rgba(60, 45, 15, 0.7)';
    ctx.lineWidth = 0.75;
    for (const c of sites.chests) {
      const p = worldToPx(c.x, c.z);
      if (!inView(p)) continue;
      ctx.fillRect(p.px - 2, p.py - 2, 4, 4);
      ctx.strokeRect(p.px - 2, p.py - 2, 4, 4);
    }
  }

  // Dungeon entrances — purple markers (+ labels in full mode)
  const interiors = config?.interiors ?? {};
  for (const key of Object.keys(interiors)) {
    const d = interiors[key];
    const p = worldToPx(d.cx, d.cz);
    if (!inView(p)) continue;
    ctx.fillStyle = 'rgba(168, 120, 255, 0.95)';
    ctx.strokeStyle = 'rgba(10, 8, 20, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (labels) drawLabel(ctx, d.name ?? key, p.px, p.py - 9, font, '#d7c4ff');
  }

  // NPCs — friendly green dots (+ names in full mode). Positions nest under
  // `pos` in the content model.
  if (npcs) {
    ctx.strokeStyle = 'rgba(8, 30, 12, 0.9)';
    ctx.lineWidth = 1;
    for (const n of npcs) {
      const p = worldToPx(n.pos.x, n.pos.z);
      if (!inView(p)) continue;
      ctx.fillStyle = 'rgba(120, 220, 130, 0.95)';
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (labels) drawLabel(ctx, n.name, p.px, p.py - 8, font, '#bff0c6');
    }
  }

  // Waypoints / POIs — cyan pins (+ labels in full mode). The Castle Ashwood
  // gate (poi_castle_ashwood) gets a distinct gold keep glyph.
  if (waypoints) {
    for (const wp of waypoints) {
      const p = worldToPx(wp.pos.x, wp.pos.z);
      if (!inView(p)) continue;
      const isCastle = wp.id === 'poi_castle_ashwood';
      ctx.strokeStyle = 'rgba(8, 24, 30, 0.9)';
      ctx.lineWidth = 1;
      if (isCastle) {
        ctx.fillStyle = 'rgba(240, 210, 120, 0.98)';
        ctx.fillRect(p.px - 3.5, p.py - 3.5, 7, 7);
        ctx.strokeRect(p.px - 3.5, p.py - 3.5, 7, 7);
      } else {
        ctx.fillStyle = 'rgba(130, 210, 240, 0.95)';
        ctx.beginPath();
        ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (labels) drawLabel(ctx, wp.label, p.px, p.py - (isCastle ? 10 : 8), font, isCastle ? '#f0d078' : '#a8e6f5');
    }
  }

  if (!labels) return;

  // Zone / landmark labels
  const z = config?.zones ?? {};
  if (z.wildwood) {
    const p = worldToPx(z.wildwood.x, z.wildwood.z);
    if (inView(p)) drawLabel(ctx, 'Wildwood', p.px, p.py, font, '#bfe3a6');
  }
  if (z.mountain) {
    const p = worldToPx(z.mountain.x, z.mountain.z);
    if (inView(p)) drawLabel(ctx, 'The Mountain', p.px, p.py, font, '#cdd4de');
  }
  if (config?.lake) {
    const p = worldToPx(config.lake.x, config.lake.z);
    if (inView(p)) drawLabel(ctx, config.lake.name ?? 'Mirrormere', p.px, p.py, font, '#9fd0f5');
  }
}

function drawLabel(ctx, text, cx, cy, font, color) {
  ctx.font = `600 ${font}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
}
