/**
 * GraphicsSettingsPanel — the graphics controls, rendered from SETTING_DEFS.
 *
 * Used from two places with two different skins:
 *   • the pre-world hub (app parchment/gold), where NO scene exists yet
 *   • the in-world game menu (slate/blur), where one does
 *
 * Both call the same store, so the options can never drift apart. The only
 * difference is the `styles` bundle and whether a `scene` was handed in:
 *
 *   scene present → live settings apply immediately through the scene's
 *                   setGraphicsSetting; the tier is the one actually running.
 *   scene absent  → every change is written straight to localStorage and picked
 *                   up when the world boots; the tier comes from a throwaway
 *                   WebGL probe. This is the path that matters for a player
 *                   whose GPU cannot survive entering the world at all.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  QUALITY_PREFS,
  SETTING_DEFS,
  loadQualityPref,
  loadSettingOverrides,
  probeDevice,
  resetGraphicsPrefs,
  resolveGraphicsSettings,
  saveQualityPref,
  saveSettingOverride,
  scopeFor,
} from '../game/graphicsSettings.js';

const PRESET_LABELS = {
  auto:     { label: 'Auto',     hint: 'Detect from your GPU' },
  high:     { label: 'High',     hint: 'Reflections, ambient occlusion, cascaded shadows' },
  balanced: { label: 'Balanced', hint: 'Simpler shadows and water, no ambient occlusion' },
  low:      { label: 'Low',      hint: 'The lightest render path' },
};

/**
 * Read the current state from whichever source is available.
 * Kept out of render so the WebGL probe runs once per mount, not once per frame.
 */
function readState(scene) {
  const info = scene?.getGraphicsInfo?.();
  if (info) {
    return {
      tier: info.tier,
      gpu: info.gpu,
      safeLevel: info.safeLevel,
      canChooseTier: info.canChooseTier,
      autoReduced: info.autoReduced,
      pref: info.pref,
      settings: info.settings,
      ceilings: info.ceilings,
      // Whether a MirrorTexture was actually allocated this run — decides
      // whether "Water reflections: On" is live or needs a rebuild.
      reflectionsSupported: info.reflectionsSupported,
      live: true,
    };
  }

  const probe = probeDevice();
  const pref = loadQualityPref();
  const settings = resolveGraphicsSettings(probe.tier, loadSettingOverrides(), probe.safeLevel);
  return {
    tier: probe.tier,
    gpu: probe.gpuRenderer,
    safeLevel: probe.safeLevel,
    canChooseTier: !probe.isMobile,
    autoReduced: false,
    pref,
    settings,
    ceilings: settings.ceilings,
    // Nothing is running, so nothing was allocated; every change waits for boot.
    reflectionsSupported: false,
    live: false,
  };
}

/** One row: a label and a strip of mutually exclusive option buttons. */
function SettingRow({ def, value, ceiling, staged, styles, state, onPick }) {
  const optionIds = def.options.map((o) => o.id);
  const ceilingIdx = optionIds.indexOf(ceiling);
  const shown = staged ?? value;
  // Scope can depend on the value AND on what the running scene allocated
  // (reflections can be switched off live but not back on without a rebuild),
  // so the tag reflects the option currently shown, not the setting as a whole.
  const needsReload = scopeFor(def, shown, state) === 'reload';

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={styles.rowLabel}>
        {def.label}
        {needsReload && <span style={styles.reloadTag}> · needs reload</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {def.options.map((o, i) => {
          // Heavier than this device is allowed to build. Shown rather than
          // hidden so the player can see the ceiling exists and why — a missing
          // button reads as a bug, a disabled one reads as a limit.
          const blocked = ceilingIdx >= 0 && i < ceilingIdx;
          const active = shown === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={blocked}
              aria-pressed={active}
              title={blocked ? 'Not available on this device — the render path it uses cannot build this' : undefined}
              onClick={() => { if (!blocked && !active) onPick(def, o.id); }}
              style={{
                ...styles.optionBtn,
                ...(active ? styles.optionBtnActive : null),
                ...(blocked ? styles.optionBtnBlocked : null),
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {def.hint && <div style={styles.hint}>{def.hint}</div>}
    </div>
  );
}

/**
 * @param {object}   props
 * @param {object}  [props.scene]     live BabylonWorldScene, if one is running
 * @param {object}   props.styles     skin bundle (see hubGraphicsStyles / worldGraphicsStyles)
 * @param {Function} [props.onReloadRequest]  called instead of location.reload
 *   when reload-scoped changes are applied. The hub uses it to enter the world
 *   fresh rather than reloading the whole SPA.
 */
export default function GraphicsSettingsPanel({ scene = null, styles, onReloadRequest = null }) {
  const [state, setState] = useState(() => readState(scene));
  // Reload-scoped changes accumulate here so three edits cost one reload, not
  // three. Live ones never land here — they are already applied.
  const [staged, setStaged] = useState({});

  const refresh = useCallback(() => setState(readState(scene)), [scene]);

  const pick = useCallback((def, value) => {
    // No scene yet (hub): "live" and "reload" are the same thing — nothing is
    // running to apply it to, and the world reads it on boot.
    if (!scene?.setGraphicsSetting) {
      saveSettingOverride(def.id, value);
      refresh();
      return;
    }
    if (scopeFor(def, value, state) === 'live') {
      scene.setGraphicsSetting(def.id, value);
      refresh();
      return;
    }
    setStaged((p) => ({ ...p, [def.id]: value }));
  }, [scene, refresh, state]);

  const applyStaged = useCallback(() => {
    for (const [id, value] of Object.entries(staged)) saveSettingOverride(id, value);
    setStaged({});
    if (onReloadRequest) { onReloadRequest(); return; }
    if (typeof window !== 'undefined') window.location?.reload?.();
  }, [staged, onReloadRequest]);

  const pickPreset = useCallback((pref) => {
    // Commit anything staged first. A preset click reloads, and dropping the
    // player's staged edits on the floor at that moment is silent data loss —
    // they staged Shadows Off, clicked Balanced, and only Balanced survived.
    for (const [id, value] of Object.entries(staged)) saveSettingOverride(id, value);
    setStaged({});
    saveQualityPref(pref);
    // The preset changes the TIER, which decides what gets constructed — so it
    // can only take effect on a fresh scene, exactly like a staged setting.
    if (onReloadRequest) { onReloadRequest(); return; }
    if (scene?.setQualityPreference) { scene.setQualityPreference(pref); return; }
    if (typeof window !== 'undefined') window.location?.reload?.();
  }, [scene, onReloadRequest, staged]);

  const hasStaged = Object.keys(staged).length > 0;
  const presets = useMemo(() => QUALITY_PREFS.map((id) => ({ id, ...PRESET_LABELS[id] })), []);

  return (
    <div style={styles.root}>
      {state.autoReduced && (
        <p style={styles.warn}>
          Quality was reduced automatically — the framerate stayed low for several
          seconds. Reset below to try the full stack again.
        </p>
      )}

      {state.canChooseTier && (
        <div style={{ marginBottom: 14 }}>
          <div style={styles.rowLabel}>
            Quality preset
            <span style={styles.reloadTag}> · needs reload</span>
            {state.settings.isCustom && <span style={styles.customTag}> · customised</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {presets.map((p) => {
              const active = state.pref === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  aria-pressed={active}
                  onClick={() => { if (!active) pickPreset(p.id); }}
                  style={{ ...styles.optionBtn, ...(active ? styles.optionBtnActive : null) }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div style={styles.hint}>
            The preset sets every option below. Change one and it becomes your own mix.
          </div>
        </div>
      )}

      <div style={styles.divider} />

      {SETTING_DEFS.map((def) => (
        <SettingRow
          key={def.id}
          def={def}
          value={state.settings[def.id]}
          ceiling={state.ceilings[def.id]}
          staged={staged[def.id]}
          styles={styles}
          state={state}
          onPick={pick}
        />
      ))}

      {hasStaged && (
        <button type="button" style={styles.primaryBtn} onClick={applyStaged}>
          Apply &amp; reload world
        </button>
      )}

      <p style={styles.meta}>
        Rendering at <span style={styles.metaAccent}>{state.tier}</span>
        {state.safeLevel > 0 && <> · safe level {state.safeLevel}</>}
        {!state.live && <> · not yet running</>}
        {state.gpu && <><br />{state.gpu}</>}
      </p>

      {(state.safeLevel > 0 || state.pref !== 'auto' || state.settings.isCustom || state.autoReduced) && (
        <button
          type="button"
          style={styles.ghostBtn}
          onClick={() => {
            if (scene?.resetGraphicsQuality) { scene.resetGraphicsQuality(); return; }
            // No scene: clear the same three layers the scene's reset clears,
            // then re-read rather than reloading — the hub is not the world.
            resetGraphicsPrefs();
            setStaged({});
            refresh();
          }}
        >
          ↺ Reset graphics quality
        </button>
      )}
    </div>
  );
}
