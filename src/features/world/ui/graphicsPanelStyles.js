/**
 * Two skins for GraphicsSettingsPanel.
 *
 * The panel appears in two places with two visual languages: the pre-world hub
 * belongs to the main app (Cinzel/Inter over parchment, tokens.js) and the game
 * menu belongs to the world overlay (slate + blur, panelTheme.js). Rather than
 * fork the component, the skin is data â€” so the two can never disagree about
 * which settings exist, only about how they look.
 */

import { C, FS, R, S } from '../../../utils/tokens.js';
import { FONT, ghostBtn as worldGhostBtn, primaryBtn as worldPrimaryBtn } from './panelTheme.js';

// â”€â”€ World overlay (in-game menu) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const worldOptionBtn = {
  ...worldGhostBtn,
  padding: '4px 10px', fontSize: 12, minHeight: 30,
};

export const worldGraphicsStyles = Object.freeze({
  root: { fontFamily: FONT },
  rowLabel: {
    fontSize: 11.5, color: '#cbd5e1', fontFamily: FONT,
    fontWeight: 600, margin: '0 0 5px',
  },
  reloadTag: { color: '#94a3b8', fontWeight: 400 },
  customTag: { color: '#f0d060', fontWeight: 400 },
  hint: { fontSize: 10.5, color: '#7c899c', fontFamily: FONT, margin: '5px 0 0', lineHeight: 1.4 },
  warn: { fontSize: 11, color: '#fbbf77', fontFamily: FONT, margin: '0 0 10px', lineHeight: 1.45 },
  divider: {
    height: 1, background: 'rgba(148, 163, 184, 0.18)', margin: '0 0 14px',
  },
  optionBtn: worldOptionBtn,
  optionBtnActive: {
    color: '#0b1220', background: '#c49428',
    border: '1px solid #c49428', fontWeight: 700,
  },
  optionBtnBlocked: { opacity: 0.35, cursor: 'not-allowed' },
  primaryBtn: { ...worldPrimaryBtn, width: '100%', marginBottom: 12 },
  ghostBtn: { ...worldGhostBtn, padding: '4px 10px', fontSize: 12, marginBottom: 18 },
  meta: {
    fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
    color: '#94a3b8', margin: '4px 0 10px', lineHeight: 1.5,
  },
  metaAccent: { color: '#7dd3fc' },
});

// â”€â”€ Main app (pre-world hub) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APP_FONT = 'Inter, system-ui, sans-serif';

const hubOptionBtn = {
  background: 'rgba(74,69,59,.35)',
  border: `1px solid ${C.lineStrong}`,
  borderRadius: R.md,
  color: C.inkMid,
  fontSize: FS.md, fontWeight: 600, fontFamily: APP_FONT,
  padding: `${S.s6}px ${S.s12}px`, minHeight: 32,
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};

export const hubGraphicsStyles = Object.freeze({
  root: { fontFamily: APP_FONT, color: C.ink },
  rowLabel: {
    fontSize: FS.lg, color: C.inkLabel, fontFamily: APP_FONT,
    fontWeight: 600, margin: `0 0 ${S.s6}px`,
  },
  reloadTag: { color: C.inkDim, fontWeight: 400 },
  customTag: { color: C.gold, fontWeight: 400 },
  hint: {
    fontSize: FS.base, color: C.inkDim, fontFamily: APP_FONT,
    margin: `${S.s6}px 0 0`, lineHeight: 1.45,
  },
  warn: {
    fontSize: FS.md, color: C.diffIntermediate, fontFamily: APP_FONT,
    margin: `0 0 ${S.s10}px`, lineHeight: 1.45,
  },
  divider: { height: 1, background: C.lineStrong, margin: `0 0 ${S.s14}px` },
  optionBtn: hubOptionBtn,
  optionBtnActive: {
    color: C.bg, background: C.gold,
    border: `1px solid ${C.gold}`, fontWeight: 700,
  },
  optionBtnBlocked: { opacity: 0.3, cursor: 'not-allowed' },
  primaryBtn: {
    ...hubOptionBtn,
    width: '100%', color: C.bg, background: C.gold,
    border: `1px solid ${C.gold}`, fontWeight: 700,
    minHeight: 40, marginBottom: S.s12,
  },
  ghostBtn: { ...hubOptionBtn, marginBottom: S.s18 },
  meta: {
    fontFamily: 'JetBrains Mono, monospace', fontSize: FS.base,
    color: C.inkDim, margin: `${S.s4}px 0 ${S.s10}px`, lineHeight: 1.5,
  },
  metaAccent: { color: C.gold },
});
