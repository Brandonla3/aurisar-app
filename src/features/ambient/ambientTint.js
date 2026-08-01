// Tint math for the ambient light system. MUSCLE_COLORS are deliberately dark
// ("masculine, desaturated" palette) — the room glow needs the lifted variant
// the Forge Glass design calls the muscle's "glow" color, so we mix toward
// white before applying alpha.

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexChannels(hex) {
  const h = (hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return [176, 160, 144]; // neutral fallback
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// lift 0..1 mixes toward white — 0.38 ≈ the design's glow variant of the same
// muscle hue. Returns an rgba() string ready for a CSS custom property.
export function tintRgba(hex, alpha, lift = 0.38) {
  const [r, g, b] = hexChannels(hex).map(c => clamp255(c + (255 - c) * lift));
  return `rgba(${r},${g},${b},${alpha})`;
}
