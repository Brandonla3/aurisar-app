import React from 'react';
import { CLASSES } from '../data/exercises';
import { CLASS_SVG_PATHS } from '../data/constants';

function ClassIcon({ classKey, size = 24, color, style = {} }) {
  const cls       = CLASSES[classKey];
  const fillColor = color || (cls ? cls.color : "#b4ac9e");
  const path      = CLASS_SVG_PATHS[classKey];
  if (!path) {
    // Graceful fallback to emoji if class not found
    return <span style={{ fontSize: size * 0.8 }}>{cls ? cls.icon : "⚔️"}</span>;
  }
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      style={{ display: "inline-block", flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <path d={path} fill={fillColor} />
    </svg>
  );
}

export { ClassIcon };
