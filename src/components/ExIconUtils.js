import { CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, MUSCLE_COLORS } from '../data/constants';

export function getExIconName(ex) {
  if (!ex) return "game-icons:weight-lifting-up";
  const nm = (ex.name || "");
  for (const [regex, icon] of NAME_ICON_MAP) { if (regex.test(nm)) return icon; }
  const mg = (ex.muscleGroup || "").toLowerCase();
  if (MUSCLE_ICON_MAP[mg]) return MUSCLE_ICON_MAP[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_FALLBACK[cat] || "game-icons:weight-lifting-up";
}

export function getExIconColor(ex) {
  if (!ex) return "#b4ac9e";
  const mg = (ex.muscleGroup || "").toLowerCase().trim();
  if (mg && MUSCLE_COLORS[mg]) return MUSCLE_COLORS[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_COLORS[cat] || "#b4ac9e";
}
