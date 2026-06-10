/**
 * panelTheme — shared inline-style constants for the world's HUD panels/modals.
 * Matches the world overlay aesthetic (slate + blur) used in WorldGame /
 * WorldOverlay so the new UI feels native to the 3D world.
 */

export const FONT = 'Inter, system-ui, sans-serif';

export const overlayBackdrop = {
  position: 'absolute', inset: 0, zIndex: 90,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(2, 6, 14, 0.55)',
  backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
  fontFamily: FONT,
};

export const panel = {
  position: 'relative',
  minWidth: 280, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto',
  background: 'rgba(15, 23, 42, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: 14,
  boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
  color: '#e2e8f0',
  padding: '18px 18px 20px',
};

export const panelTitle = {
  margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '0.02em',
  color: '#f0d060', fontFamily: 'Cinzel, Inter, serif',
};

export const closeBtn = {
  position: 'absolute', top: 10, right: 10,
  width: 34, height: 34, minWidth: 34,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(30, 41, 59, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 9, color: '#cbd5e1', fontSize: 16,
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};

export const primaryBtn = {
  background: '#c49428', border: '1px solid #f0d060',
  borderRadius: 8, color: '#1a1407', fontSize: 13, fontWeight: 700,
  padding: '7px 14px', cursor: 'pointer', fontFamily: FONT,
  minHeight: 36, WebkitTapHighlightColor: 'transparent',
};

export const ghostBtn = {
  background: 'rgba(30, 41, 59, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 8, color: '#e2e8f0', fontSize: 13, fontWeight: 600,
  padding: '7px 14px', cursor: 'pointer', fontFamily: FONT,
  minHeight: 36, WebkitTapHighlightColor: 'transparent',
};
