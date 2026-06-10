/**
 * WorldModal — shared centered modal shell for world HUD panels.
 * Renders a blurred backdrop (click to close) + a titled panel with a close
 * button. Esc handling lives centrally in WorldGame.
 */

import React from 'react';
import { overlayBackdrop, panel, panelTitle, closeBtn } from './panelTheme.js';

export default function WorldModal({ title, onClose, children, width }) {
  return (
    <div
      style={overlayBackdrop}
      onClick={onClose}
    >
      <div
        style={width ? { ...panel, width } : panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <button style={closeBtn} onClick={onClose} aria-label="Close">✕</button>
        {title && <h2 style={panelTitle}>{title}</h2>}
        <div style={{ marginTop: title ? 14 : 0 }}>{children}</div>
      </div>
    </div>
  );
}
