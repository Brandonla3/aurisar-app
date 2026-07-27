/**
 * WorldHub — the screen the World tab lands on, before the 3D scene exists.
 *
 * The World tab used to mount BabylonWorldScene the instant it was pressed:
 * no entry screen, no loading state, no error boundary. That made the graphics
 * settings unreachable for the one player who most needs them — someone whose
 * GPU cannot survive the tier the sniff picked never gets far enough into the
 * world to open the in-game menu, and a throw in the scene constructor took
 * down the whole app.
 *
 * So the hub sits in front of it. Nothing here touches WebGL: the settings
 * panel reads the same localStorage store the scene does (graphicsSettings.js)
 * and predicts the tier from a throwaway probe. Only pressing Enter constructs
 * a scene.
 *
 * Character and Guild are passed in as rendered nodes rather than imported,
 * because both are driven by state that lives in App.jsx. That keeps the wiring
 * where the state is and leaves this file a presentational shell.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary.jsx';
import WorldOverlay from './WorldOverlay.jsx';
import GraphicsSettingsPanel from './ui/GraphicsSettingsPanel.jsx';
import { hubGraphicsStyles } from './ui/graphicsPanelStyles.js';
import { applySafeModePreset, didLastBootFail, markBootSucceeded } from './game/graphicsSettings.js';
import { C, FS, R, S } from '../../utils/tokens.js';

const FONT = 'Inter, system-ui, sans-serif';

const S_ = {
  root: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: `radial-gradient(120% 90% at 50% 0%, #16140e 0%, ${C.bg} 62%)`,
    color: C.ink, fontFamily: FONT,
    display: 'flex', flexDirection: 'column',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    overflowY: 'auto',
  },
  bar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: S.s12, padding: `${S.s14}px ${S.s16}px`,
    borderBottom: `1px solid ${C.line}`, flexShrink: 0,
  },
  title: {
    fontFamily: "'Cinzel', serif", fontSize: '1.15rem', letterSpacing: '.08em',
    color: C.gold, margin: 0,
  },
  body: { flex: 1, width: '100%', maxWidth: 560, margin: '0 auto', padding: `${S.s20}px ${S.s16}px ${S.s32}px` },
  lede: { fontSize: FS.md, color: C.inkDim, lineHeight: 1.55, margin: `0 0 ${S.s20}px` },
  enterBtn: {
    width: '100%', minHeight: 56, marginBottom: S.s16,
    borderRadius: R.xxl, cursor: 'pointer',
    border: `1px solid ${C.gold}`,
    background: 'linear-gradient(135deg,#c49428,#8a6010)',
    color: '#fff', fontFamily: "'Cinzel', serif",
    fontSize: '1rem', fontWeight: 700, letterSpacing: '.08em',
    WebkitTapHighlightColor: 'transparent',
  },
  tileRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: S.s10 },
  tile: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: S.s4,
    padding: `${S.s14}px ${S.s14}px`, borderRadius: R.xxl, cursor: 'pointer',
    border: `1px solid ${C.lineStrong}`,
    background: 'linear-gradient(145deg,rgba(45,42,36,.45),rgba(32,30,26,.25))',
    color: C.ink, fontFamily: FONT, textAlign: 'left',
    WebkitTapHighlightColor: 'transparent',
  },
  tileLabel: { fontSize: FS.xl, fontWeight: 700, letterSpacing: '.04em' },
  tileHint: { fontSize: FS.base, color: C.inkDim, lineHeight: 1.4 },
  backBtn: {
    background: 'none', border: `1px solid ${C.lineStrong}`, borderRadius: R.md,
    color: C.inkMid, fontSize: FS.md, fontWeight: 600, fontFamily: FONT,
    padding: `${S.s6}px ${S.s12}px`, minHeight: 34, cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  banner: {
    padding: `${S.s12}px ${S.s14}px`, borderRadius: R.xxl, marginBottom: S.s16,
    border: '1px solid rgba(196,148,40,.35)', background: 'rgba(46,32,16,.55)',
  },
  bannerTitle: { fontSize: FS.lg, fontWeight: 700, color: C.gold, marginBottom: S.s6 },
  bannerBody: { fontSize: FS.base, color: C.inkMid, lineHeight: 1.5, marginBottom: S.s10 },
  bannerRow: { display: 'flex', gap: S.s8, flexWrap: 'wrap' },
  sectionBody: { flex: 1, width: '100%', minHeight: 0 },
};

/**
 * @param {object}    props
 * @param {Function}  props.onClose        leave the World tab entirely
 * @param {React.ReactNode} [props.characterSlot]  rendered <CharacterTab/>
 * @param {React.ReactNode} [props.guildSlot]      rendered <GuildTab/>
 * @param {object}    props.worldProps     forwarded verbatim to WorldOverlay
 */
export default function WorldHub({ onClose, characterSlot = null, guildSlot = null, worldProps = {} }) {
  const [view, setView] = useState('hub');
  // Read once on mount, before anything can raise the flag again this session.
  const [bootFailed, setBootFailed] = useState(() => didLastBootFail());
  // Bumped on every entry so a retry after a crash remounts WorldOverlay
  // (and therefore reconstructs the scene) rather than reusing a dead subtree.
  const [runId, setRunId] = useState(0);

  const enter = useCallback(() => {
    setRunId((n) => n + 1);
    setView('playing');
  }, []);

  const dismissBanner = useCallback(() => {
    // Clearing the flag is the honest thing to do once the player has seen it:
    // it means "the last attempt is accounted for", not "the last attempt
    // worked". Leaving it raised would re-warn forever.
    markBootSucceeded();
    setBootFailed(false);
  }, []);

  const enterSafeMode = useCallback(() => {
    applySafeModePreset();
    dismissBanner();
    enter();
  }, [dismissBanner, enter]);

  // ESC backs out one level: out of a section to the hub, out of the hub to the
  // previous tab. WorldOverlay owns ESC while playing, so this stands down then.
  useEffect(() => {
    if (view === 'playing') return undefined;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      if (view === 'hub') onClose();
      else setView('hub');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, onClose]);

  const sectionTitle = useMemo(() => ({
    hub: 'Aurisar World',
    settings: 'Graphics Settings',
    character: 'Character',
    guild: 'Guild',
  })[view] ?? 'Aurisar World', [view]);

  if (view === 'playing') {
    return (
      <ErrorBoundary
        key={runId}
        fallback={(error, reset) => (
          <WorldCrashFallback
            error={error}
            onBack={() => { reset(); setBootFailed(didLastBootFail()); setView('hub'); }}
            onSettings={() => { reset(); setView('settings'); }}
          />
        )}
      >
        <WorldOverlay {...worldProps} onClose={() => { setBootFailed(false); setView('hub'); }} />
      </ErrorBoundary>
    );
  }

  return (
    <div style={S_.root} role="region" aria-label="Aurisar World">
      <div style={S_.bar}>
        <h2 style={S_.title}>{sectionTitle}</h2>
        <button
          type="button"
          style={S_.backBtn}
          onClick={() => (view === 'hub' ? onClose() : setView('hub'))}
        >
          {view === 'hub' ? '✕ Close' : '← Back'}
        </button>
      </div>

      <div style={view === 'hub' || view === 'settings' ? S_.body : S_.sectionBody}>
        {view === 'hub' && (
          <>
            {bootFailed && (
              <div style={S_.banner} role="alert">
                <div style={S_.bannerTitle}>Last visit didn&apos;t finish loading</div>
                <div style={S_.bannerBody}>
                  The world was opened but never drew a frame. That usually means the
                  graphics settings are too heavy for this device — try lowering them
                  before entering again.
                </div>
                <div style={S_.bannerRow}>
                  <button type="button" style={S_.backBtn} onClick={enterSafeMode}>
                    Start in Safe Mode
                  </button>
                  <button type="button" style={S_.backBtn} onClick={() => { dismissBanner(); setView('settings'); }}>
                    Adjust settings
                  </button>
                  <button type="button" style={S_.backBtn} onClick={dismissBanner}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            <p style={S_.lede}>
              Step into Ashwood — or set up your character and check in with your
              guild first. Graphics settings are here too, so you can tune them
              without loading the world.
            </p>

            <button type="button" style={S_.enterBtn} onClick={enter}>
              ⚔ Enter Aurisar World
            </button>

            <div style={S_.tileRow}>
              <HubTile
                label="🧙 Character"
                hint="Appearance, class and gear"
                disabled={!characterSlot}
                onClick={() => setView('character')}
              />
              <HubTile
                label="🛡 Guild"
                hint="Friends, channels and chat"
                disabled={!guildSlot}
                onClick={() => setView('guild')}
              />
              <HubTile
                label="⚙ Graphics"
                hint="Quality, shadows, fog and more"
                onClick={() => setView('settings')}
              />
            </div>
          </>
        )}

        {view === 'settings' && (
          // No `scene` prop: nothing is running, so every change is written
          // straight to the store and read when the world boots. onReloadRequest
          // replaces the panel's default location.reload() — reloading the whole
          // SPA from the hub would be absurd when entering the world is already
          // a fresh scene.
          <GraphicsSettingsPanel
            styles={hubGraphicsStyles}
            onReloadRequest={enter}
          />
        )}

        {view === 'character' && characterSlot}
        {view === 'guild' && guildSlot}
      </div>
    </div>
  );
}

function HubTile({ label, hint, onClick, disabled = false }) {
  if (disabled) return null;
  return (
    <button type="button" style={S_.tile} onClick={onClick}>
      <span style={S_.tileLabel}>{label}</span>
      <span style={S_.tileHint}>{hint}</span>
    </button>
  );
}

/**
 * Shown when the scene throws during render/construction. Previously this
 * propagated to the app root and white-screened everything; now it lands the
 * player back at the one screen where they can do something about it.
 */
function WorldCrashFallback({ error, onBack, onSettings }) {
  return (
    <div style={{ ...S_.root, padding: S.s24 }} role="alert" aria-live="assertive">
      <div style={{ ...S_.body, margin: 'auto' }}>
        <h2 style={{ ...S_.title, marginBottom: S.s10 }}>The world couldn&apos;t start.</h2>
        <p style={S_.lede}>
          Aurisar World hit an error while loading. The rest of the app is fine.
          Lowering the graphics settings is the usual fix.
        </p>
        {error?.message && (
          <pre style={{
            fontSize: FS.base, color: C.inkDim, background: 'rgba(0,0,0,.35)',
            padding: S.s10, borderRadius: R.lg, overflow: 'auto', maxHeight: 160,
            marginBottom: S.s18, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {String(error.message)}
          </pre>
        )}
        <div style={S_.bannerRow}>
          <button type="button" style={S_.backBtn} onClick={onSettings}>⚙ Graphics settings</button>
          <button type="button" style={S_.backBtn} onClick={onBack}>← Back</button>
        </div>
      </div>
    </div>
  );
}
