import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Source guard for LoginVideoBackdrop's wiring into LoginScreen. No jsdom
 * video-decode mocking here — the gating/quarantine logic already belongs to
 * useAmbientVideoActive/mediaHealth, proven by the (parked) app-wide ambient
 * backdrop this component was adapted from. This just pins the two things a
 * careless future edit could silently break: the mount site's stacking order
 * (video must sit inside the gradient div and before Ambient, so it paints
 * over the gradient fallback and still gets the vignette/grain/motes on top),
 * and that LoginScreen's earlier-removed `onBack` prop hasn't crept back in.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'src/components/LoginScreen.jsx', 'utf8');

describe('LoginScreen — video backdrop wiring', () => {
  it('imports and renders LoginVideoBackdrop', () => {
    expect(src).toContain("import LoginVideoBackdrop from './LoginVideoBackdrop'");
    expect(src).toContain('<LoginVideoBackdrop />');
  });

  it('mounts the video inside the background div and before Ambient, so the gradient fallback and vignette/grain/motes still layer correctly', () => {
    const bgStart = src.indexOf("{/* ── Layered cinematic background ── */}");
    const videoIdx = src.indexOf('<LoginVideoBackdrop />');
    const ambientIdx = src.indexOf('<Ambient animated={true} />');
    expect(bgStart).toBeGreaterThan(-1);
    expect(videoIdx).toBeGreaterThan(bgStart);
    expect(ambientIdx).toBeGreaterThan(videoIdx);
  });

  it('does not reintroduce the removed top-level onBack prop', () => {
    // Sub-screens (forgot-password flows) legitimately have their own local
    // `onBack` closures — this only guards the top-level LoginScreen(...)
    // destructure, whose onBack (the header "← Back" button) was removed
    // when login became the entry screen with nowhere left to go back to.
    const sigStart = src.indexOf('export default function LoginScreen({');
    const sigEnd = src.indexOf('}) {', sigStart);
    const signature = src.slice(sigStart, sigEnd);
    expect(signature).not.toMatch(/\bonBack\b/);
    expect(src).not.toContain('au-back-link');
  });
});
