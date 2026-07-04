import React from 'react';
export { getExIconName, getExIconColor } from './ExIconUtils';
import { getExIconName, getExIconColor } from './ExIconUtils';

export function ExIcon({ ex, size = "1.15rem", color, style = {} }) {
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
