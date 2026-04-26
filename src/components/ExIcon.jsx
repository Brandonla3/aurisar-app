import React from 'react';
import { CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, MUSCLE_COLORS } from '../data/constants';

function getExIconName(ex) {
  if (!ex) return "game-icons:weight-lifting-up";
  const nm = (ex.name || "");
  for (const [regex, icon] of NAME_ICON_MAP) { if (regex.test(nm)) return icon; }
  const mg = (ex.muscleGroup || "").toLowerCase();
  if (MUSCLE_ICON_MAP[mg]) return MUSCLE_ICON_MAP[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_FALLBACK[cat] || "game-icons:weight-lifting-up";
}

function getExIconColor(ex) {
  if (!ex) return "#b4ac9e";
  const mg = (ex.muscleGroup || "").toLowerCase().trim();
  if (mg && MUSCLE_COLORS[mg]) return MUSCLE_COLORS[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_COLORS[cat] || "#b4ac9e";
}

function ExIcon({ ex, size = "1.15rem", color, style = {} }) {
  if (ex && ex.custom) {
    return (
      <span style={{ fontSize: size, lineHeight: 1, display: "block", ...style }}>
        {ex.icon || "💪"}
      </span>
    );
  }
  const iconName = getExIconName(ex);
  const fill = color || getExIconColor(ex);
  const iconPath = iconName.replace(":", "/");
  const encodedColor = encodeURIComponent(fill);
  const src = `https://api.iconify.design/${iconPath}.svg?color=${encodedColor}`;
  const pxSize = typeof size === "string" && size.endsWith("rem")
    ? (parseFloat(size) * 16) + "px" : size;
  return (
    <img
      src={src}
      alt=""
      width={pxSize}
      height={pxSize}
      loading="lazy"
      style={{ display: "block", flexShrink: 0, ...style }}
    />
  );
}

export { getExIconName, getExIconColor, ExIcon };
