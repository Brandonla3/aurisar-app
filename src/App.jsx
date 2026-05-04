import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { List } from 'react-window';
import './styles/app.css';
import { CLASSES, EXERCISES } from './data/exercises';
import { EX_BY_ID, CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, CLASS_SVG_PATHS, QUESTS, WORKOUT_TEMPLATES, PLAN_TEMPLATES, CHECKIN_REWARDS, KEYWORD_CLASS_MAP, PARTICLES, STORAGE_KEY, EMPTY_PROFILE, NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES, MUSCLE_COLORS, MUSCLE_META, TYPE_COLORS, UI_COLORS, MAP_REGIONS } from './data/constants';
import { _nullishCoalesce, _optionalChain, uid, clone, todayStr } from './utils/helpers';
import { loadSave, doSave, setPreviewMode, loadAdminFlags } from './utils/storage';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, ftInToCm, cmToFtIn, weightLabel, distLabel, displayWt, displayDist, pctToSlider, sliderToPct } from './utils/units';
import { buildXPTable, XP_TABLE, xpToLevel, xpForLevel, xpForNext, calcBMI, detectClassFromAnswers, detectClass, calcExXP, calcPlanXP, calcDayXP, calcExercisePBs, calcDecisionTreeBonus, calcCharStats, checkQuestCompletion, getMuscleColor, getTypeColor, hrRange, scaleWeight, scaleDur } from './utils/xp';
import { secToHMS, HMSToSec, normalizeHHMM, secToHHMMSplit, HHMMToSec, combineHHMMSec } from './utils/time';
import { formatXP } from './utils/format';
import { FS, R, S } from './utils/tokens';
import { sb } from './utils/supabase';
import { ensureRestDay } from './utils/ensureRestDay';
import { _exercisesLoaded, loadExercises, useExercises } from './utils/exerciseLibrary';
import { useModalLifecycle } from './utils/useModalLifecycle';
import { useUiState } from './state/useUiState';
import { useAuthState } from './state/useAuthState';

// ── Debounce utility ──
function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

// ── Recipe view constants (hoisted from render for perf) ──
const RECIPE_CATS = [...new Set([...WORKOUT_TEMPLATES.map(t => t.category).filter(Boolean), ...WORKOUT_TEMPLATES.map(t => t.equipment).filter(Boolean)])].sort();
const DIFF_COLORS = {
  Beginner: UI_COLORS.success,
  Intermediate: UI_COLORS.intermediate,
  Advanced: UI_COLORS.danger
};
const EQUIP_ICONS = {
  Gym: "🏋️",
  "Home Gym": "🏠",
  Bodyweight: "🤸"
};
// Recipe category → themed color (drives --mg-color on themed cards/pills)
// Uses the locked masculine palette from MUSCLE_COLORS
const RECIPE_CAT_COLORS = {
  "Push": "#8B5A2B",
  "Pull": "#2E4D38",
  "Legs": "#5C5C2E",
  "Full Body": "#2C4564",
  "Upper Body": "#6B2A2A",
  "Lower Body": "#5C5C2E",
  "Chest": "#8B5A2B",
  "Back": "#2E4D38",
  "Shoulders": "#3D343F",
  "Arms": "#4A5560",
  "Glutes": "#4F4318",
  "Core": "#2A4347",
  "Abs": "#2A4347",
  "Cardio": "#2C4564",
  "HIIT": "#6B2A2A",
  "Endurance": "#494C56",
  "Flexibility": "#3D343F",
  "Yoga": "#3D343F",
  "Mobility": "#3D343F",
  "Gym": "#4F4318",
  "Home Gym": "#8B5A2B",
  "Bodyweight": "#2E4D38"
};
function getRecipeMgColor(tpl) {
  if (!tpl) return "#B0A090";
  return RECIPE_CAT_COLORS[tpl.category] || RECIPE_CAT_COLORS[tpl.equipment] || "#B0A090";
}
// Derive workout color from its most-common muscle group
function getWorkoutMgColor(wo, exById, mgColors) {
  if (!wo || !wo.exercises) return "#B0A090";
  const counts = {};
  for (const ex of wo.exercises) {
    const exD = exById[ex.exId];
    if (!exD) continue;
    const mg = (exD.muscleGroup || "").toLowerCase().trim();
    if (!mg) continue;
    counts[mg] = (counts[mg] || 0) + 1;
  }
  let top = null,
    topN = 0;
  for (const k in counts) {
    if (counts[k] > topN) {
      top = k;
      topN = counts[k];
    }
  }
  return top && mgColors[top] || "#B0A090";
}
import { ExIcon, getExIconName, getExIconColor } from './components/ExIcon';
import { ClassIcon } from './components/ClassIcon';
import { getRegionIdx, getMapPosition, MapSVG } from './components/MapSVG';
import LoginScreen from './components/LoginScreen';
// Heavy / route-scoped components are lazy-loaded so first paint doesn't pay for
// recharts (~150KB), three.js (~600KB), or the landing page assets.
const TrendsTab = React.lazy(() => import('./components/TrendsTab').then(m => ({
  default: m.TrendsTab
})));
const PlanWizard = React.lazy(() => import('./components/PlanWizard'));
const WorkoutNotificationMockup = React.lazy(() => import('./components/WorkoutNotificationMockup'));
const LandingPage = React.lazy(() => import('./components/LandingPage').then(m => ({
  default: m.LandingPage
})));
const AdminPage = React.lazy(() => import('./components/AdminPage'));
import PlansTabContainer from './components/PlansTabContainer';
// Local mirror of TrendsTab's DEFAULT_CHART_ORDER so we don't have to eagerly
// import the TrendsTab module (which would drag recharts into the main chunk)
// just to read this constant. Keep in sync with TrendsTab.js.
const DEFAULT_CHART_ORDER = ["dow", "sets", "muscleFreq", "volume", "consistency", "topEx"];

// Tiny Suspense fallback for lazy-loaded screens. Matches the dark theme so
// it doesn't flash a white box during chunk fetch.
const LazyFallback = <div style={{
  minHeight: 240,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#8a8478',
  fontSize: '.75rem',
  letterSpacing: '.18em',
  textTransform: 'uppercase'
}} role={'status'} aria-live={'polite'} aria-label={'Loading'}>{"Loading…"}</div>;
const lazyMount = el => <React.Suspense fallback={LazyFallback}>{el}</React.Suspense>;

// ── Virtualized workout-builder picker row (item 4: react-window) ─────────
// Module-level so its identity is stable across App renders; react-window
// only re-renders rows when `rowProps` change. Rendered by the wbExPicker
// modal's <List/>. Styling matches the inline version this replaced; small
// differences vs PlanWizard.jsx's PickerRow are intentional (this picker
// shows XP in #b4ac9e instead of #d4cec4).
const WbExPickerRow = React.memo(function WbExPickerRow({
  ariaAttributes,
  index,
  style,
  exercises,
  selIds,
  onToggle
}) {
  const ex = exercises[index];
  if (!ex) return null;
  const sel = selIds.has(ex.id);
  const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
  const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
  const diffBg = diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010";
  const exMgColor = getMuscleColor(ex.muscleGroup);
  return <div style={{
    ...style,
    paddingTop: 4,
    paddingBottom: 4
  }} {...ariaAttributes}>
      <div className={"picker-ex-row" + (sel ? " sel" : "")} onClick={() => onToggle(ex.id)} style={{
      "--mg-color": exMgColor
    }}>
        <div className="picker-ex-orb"><ExIcon ex={ex} size=".95rem" color="#d4cec4" /></div>
        <div style={{
        flex: 1,
        minWidth: 0
      }}>
          <div style={{
          fontSize: FS.fs80,
          fontWeight: 600,
          color: "#d4cec4",
          marginBottom: S.s2
        }}>
            {ex.name}{ex.custom && <span className="custom-ex-badge" style={{
            marginLeft: S.s4
          }}>custom</span>}
          </div>
          <div style={{
          fontSize: FS.sm,
          fontStyle: "italic"
        }}>
            {ex.category && <span style={{
            color: getTypeColor(ex.category)
          }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</span>}
            {ex.category && ex.muscleGroup && <span style={{
            color: "#8a8478"
          }}>{" · "}</span>}
            {ex.muscleGroup && <span style={{
            color: getMuscleColor(ex.muscleGroup)
          }}>{ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}</span>}
          </div>
        </div>
        <div style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: S.s4
      }}>
          <span style={{
          fontSize: FS.fs63,
          fontWeight: 700,
          color: "#b4ac9e"
        }}>{ex.baseXP + " XP"}</span>
          <span style={{
          fontSize: FS.fs56,
          fontWeight: 700,
          color: diffColor,
          background: diffBg,
          padding: "2px 6px",
          borderRadius: R.r3,
          letterSpacing: ".04em"
        }}>{diffLabel}</span>
        </div>
      </div>
    </div>;
});

// Preview mode is dev-only by default. To enable in a non-dev build (e.g. staging),
// set VITE_ALLOW_PREVIEW=true and VITE_PREVIEW_PIN at build time. PREVIEW_PIN
// resolves at build time so the constant is dropped from production bundles.
const PREVIEW_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ALLOW_PREVIEW === 'true';
const PREVIEW_PIN = import.meta.env.VITE_PREVIEW_PIN || '1234';

// Cloudflare Turnstile site key — loaded from build env. Empty string means
// the widget renders nothing and the support form sends no token; the matching
// Netlify functions skip verification when their TURNSTILE_SECRET_KEY env var
// is also unset. Setting both env vars activates bot defence end-to-end.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

// Allowed origins for the password-reset redirect target. Each must also be
// listed in Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
// Picking the redirect dynamically lets the netlify.app preview / local dev
// receive their own reset links instead of bouncing to the apex.
const ALLOWED_RESET_ORIGINS = ["https://aurisargames.com", "https://aurisargames.netlify.app", "http://localhost:5173"];
function getResetRedirect() {
  try {
    const o = window.location.origin;
    if (ALLOWED_RESET_ORIGINS.includes(o)) return o;
  } catch (_e) {}
  return "https://aurisargames.com"; // canonical fallback
}

// Password policy. 8+ chars (NIST SP 800-63B rev.4 minimum) plus a 3-of-4
// composition rule (lower / upper / digit / symbol) and a HIBP k-anonymity
// breached-password check. Industry parity with MyFitnessPal / Peloton.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72; // Supabase / bcrypt limit
const PASSWORD_REQUIRED_CLASSES = 3; // out of 4

function _passwordCharClassesPresent(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}
async function _sha1Hex(input) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
async function isPasswordBreached(password) {
  // Send only the first 5 chars of the SHA-1 prefix; HIBP returns all matching
  // suffixes. The full hash never leaves the browser.
  try {
    const sha1 = await _sha1Hex(password);
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch("https://api.pwnedpasswords.com/range/" + prefix, {
      headers: {
        "Add-Padding": "true"
      }
    });
    if (!res.ok) return false; // fail-open if HIBP is unreachable
    const text = await res.text();
    return text.split("\n").some(line => line.split(":")[0].trim() === suffix);
  } catch {
    return false;
  }
}

// MFA recovery code helpers. Codes are 80 bits of CSPRNG entropy encoded in
// Crockford-style base32 (no I/L/O/U to avoid confusion). Hashing happens
// server-side via the `store_mfa_recovery_codes` RPC, which is responsible
// for salted/slow hashing — DO NOT pre-hash on the client (it adds nothing
// over TLS and locks salts to the client).
const _BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function _base32Encode(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = value << 8 | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += _BASE32_ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += _BASE32_ALPHABET[value << 5 - bits & 31];
  return out;
}
function generateRecoveryCode() {
  // 10 bytes = 80 bits of entropy → 16 base32 chars; chunked as XXXX-XXXX-XXXX-XXXX.
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const enc = _base32Encode(bytes);
  return enc.slice(0, 4) + "-" + enc.slice(4, 8) + "-" + enc.slice(8, 12) + "-" + enc.slice(12, 16);
}
async function validatePasswordPolicy(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      msg: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      msg: `Password is too long (max ${PASSWORD_MAX_LENGTH} characters).`
    };
  }
  if (_passwordCharClassesPresent(password) < PASSWORD_REQUIRED_CLASSES) {
    return {
      ok: false,
      msg: "Password must include at least 3 of: lowercase, uppercase, number, symbol."
    };
  }
  if (await isPasswordBreached(password)) {
    return {
      ok: false,
      msg: "That password has appeared in a public data breach. Please choose a different one."
    };
  }
  return {
    ok: true
  };
}
const WbExCard = React.memo(function WbExCard({
  ex,
  i,
  exD,
  collapsed,
  profile,
  allExById,
  metric,
  wUnit,
  setWbExercises,
  setCollapsedWbEx,
  setSsChecked,
  ssChecked,
  exCount,
  openExEditor
}) {
  function updateField(field, val) {
    setWbExercises(exs => exs.map((e, j) => j !== i ? e : {
      ...e,
      [field]: val
    }));
  }
  function removeEx() {
    setWbExercises(exs => {
      const updated = exs.map((e, j) => {
        if (j === i) return null;
        if (e.supersetWith === i) return {
          ...e,
          supersetWith: null
        };
        if (e.supersetWith != null && e.supersetWith > i) return {
          ...e,
          supersetWith: e.supersetWith - 1
        };
        return e;
      }).filter(Boolean);
      return updated;
    });
  }
  function toggleCollapse() {
    setCollapsedWbEx(s => ({
      ...s,
      [i]: !s[i]
    }));
  }
  function reorder(toIdx) {
    if (i === toIdx) return;
    setWbExercises(exs => {
      const arr = [...exs];
      const [moved] = arr.splice(i, 1);
      arr.splice(toIdx, 0, moved);
      const indexMap = {};
      const temp = exs.map((_, idx) => idx);
      const [movedIdx] = temp.splice(i, 1);
      temp.splice(toIdx, 0, movedIdx);
      temp.forEach((oldIdx, newIdx) => {
        indexMap[oldIdx] = newIdx;
      });
      return arr.map(e => {
        if (e.supersetWith != null && indexMap[e.supersetWith] != null) return {
          ...e,
          supersetWith: indexMap[e.supersetWith]
        };
        return e;
      });
    });
  }
  const isC = exD.category === "cardio";
  const isF = exD.category === "flexibility";
  const showW = !isC && !isF;
  const showHR = isC;
  const isTreadmill = exD.hasTreadmill || false;
  const noSetsEx = NO_SETS_EX_IDS.has(exD.id);
  const isRunningEx = exD.id === RUNNING_EX_ID;
  const age = profile.age || 30;
  const dispW = ex.weightLbs ? metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
  const dispDist = ex.distanceMi ? metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi) : "";
  const pbPaceMi = profile.runningPB || null;
  const pbDisp = pbPaceMi ? metric ? parseFloat((pbPaceMi * 1.60934).toFixed(2)) + " min/km" : parseFloat(pbPaceMi.toFixed(2)) + " min/mi" : null;
  const exPB = (profile.exercisePBs || {})[exD.id] || null;
  const exPBDisp = exPB ? exPB.type === "cardio" ? metric ? parseFloat((exPB.value * 1.60934).toFixed(2)) + " min/km" : parseFloat(exPB.value.toFixed(2)) + " min/mi" : exPB.type === "assisted" ? "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") + " (Assisted)" : "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") : null;
  const durationMin = parseFloat(ex.reps || 0);
  const distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
  const runPace = isRunningEx && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
  const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
  const mgColor = getMuscleColor(exD.muscleGroup);
  return <><div className={"wb-ex-hdr"} onClick={() => toggleCollapse()}><div style={{
        display: "flex",
        flexDirection: "column",
        gap: S.s2,
        flexShrink: 0
      }}><button type={"button"} aria-label={`Move ${exD.name} up`} title={"Move up"} className={"btn btn-ghost btn-xs"} style={{
          padding: "2px 6px",
          fontSize: FS.fs65,
          lineHeight: 1,
          minWidth: 0,
          opacity: i === 0 ? .3 : 1
        }} disabled={i === 0} onClick={e => {
          e.stopPropagation();
          reorder(i - 1);
        }}>{"▲"}</button><button type={"button"} aria-label={`Move ${exD.name} down`} title={"Move down"} className={"btn btn-ghost btn-xs"} style={{
          padding: "2px 6px",
          fontSize: FS.fs65,
          lineHeight: 1,
          minWidth: 0,
          opacity: i === exCount - 1 ? .3 : 1
        }} disabled={i === exCount - 1} onClick={e => {
          e.stopPropagation();
          reorder(i + 1);
        }}>{"▼"}</button></div>{ex.supersetWith == null && exCount >= 2 && <div style={{
        display: "flex",
        alignItems: "center",
        gap: S.s4,
        cursor: "pointer",
        flexShrink: 0
      }} title={"Select for superset"} onClick={e => {
        e.stopPropagation();
        setSsChecked(prev => {
          const n = new Set(prev);
          if (n.has(i)) n.delete(i);else {
            if (n.size >= 2) {
              const oldest = [...n][0];
              n.delete(oldest);
            }
            n.add(i);
          }
          return n;
        });
      }}><div className={`ss-cb ${ssChecked.has(i) ? "on" : ""}`} /><span style={{
          fontSize: FS.fs55,
          color: ssChecked.has(i) ? "#b0b8c0" : "#8a8f96",
          fontWeight: 600,
          letterSpacing: ".03em",
          userSelect: "none"
        }}>{"Superset"}</span></div>}<span aria-hidden={"true"} style={{
        cursor: "grab",
        color: "#8a8478",
        fontSize: FS.fs90,
        flexShrink: 0
      }}>{"⠿"}</span><div className={"builder-ex-orb"} style={{
        "--mg-color": mgColor
      }}><ExIcon ex={exD} size={".95rem"} color={"#d4cec4"} /></div><div className={"builder-ex-name-styled"}>{exD.name}{exD.custom && <span className={"custom-ex-badge"} style={{
          marginLeft: S.s4
        }}>{"custom"}</span>}{exD.custom && <button className={"btn btn-ghost btn-xs"} style={{
          marginLeft: S.s6,
          fontSize: FS.fs55,
          padding: "2px 6px"
        }} onClick={e => {
          e.stopPropagation();
          openExEditor("edit", exD);
        }}>{"✎ edit"}</button>}</div>{ex.supersetWith && <span className={"ss-badge"}>{"SS"}</span>}{(isRunningEx && pbDisp || exPBDisp) && <span style={{
        fontSize: FS.fs58,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{"🏆 "}{isRunningEx && pbDisp ? pbDisp : exPBDisp}</span>}{collapsed && exD.id !== "rest_day" && <span style={{
        fontSize: FS.sm,
        color: "#8a8478"
      }}>{noSetsEx ? "" : ex.sets + "×"}{ex.reps}{ex.weightLbs ? ` · ${displayWt(ex.weightLbs, profile.units)}` : ""}</span>}<span style={{
        fontSize: FS.fs63,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{(() => {
          const extraCount = (ex.extraRows || []).length;
          const b = calcExXP(ex.exId, noSetsEx ? 1 : ex.sets, ex.reps, profile.chosenClass, allExById, distMiVal || null, null, null, extraCount);
          const r = (ex.extraRows || []).reduce((s, row) => s + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, null, null, extraCount), 0);
          return formatXP(b + r, {
            signed: true
          });
        })()}{runBoostPct > 0 && <span style={{
          color: UI_COLORS.warning,
          marginLeft: S.s2
        }}>{"⚡"}</span>}</span><span style={{
        fontSize: FS.sm,
        color: "#8a8478",
        transition: "transform .2s",
        transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
        flexShrink: 0,
        lineHeight: 1
      }}>{"▼"}</span><button type={"button"} aria-label={`Remove ${exD.name}`} title={"Remove"} className={"btn btn-danger btn-xs"} onClick={e => {
        e.stopPropagation();
        removeEx();
      }}>{"✕"}</button></div>{!collapsed && exD.id !== "rest_day" && <div className={"wb-ex-body"}><div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s6
      }}>{!noSetsEx && <div style={{
          flex: 1
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Sets"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "6px 8px"
          }} type={"text"} inputMode={"decimal"} value={ex.sets === 0 || ex.sets === "" ? "" : ex.sets || ""} onChange={e => updateField("sets", e.target.value)} /></div>}{isC || isF ? <><div style={{
            flex: 1.6,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Duration (HH:MM)"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"numeric"} value={ex._durHHMM !== undefined ? ex._durHHMM : ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps ? "00:" + String(ex.reps).padStart(2, "0") : ""} onChange={e => updateField("_durHHMM", e.target.value)} onBlur={e => {
              const hhmm = normalizeHHMM(e.target.value);
              updateField("_durHHMM", hhmm || undefined);
              const sec = combineHHMMSec(hhmm, ex._durSecRaw || ex.durationSec ? secToHHMMSplit(ex.durationSec || 0).sec : "");
              updateField("durationSec", sec);
              if (sec) updateField("reps", Math.max(1, Math.floor(sec / 60)));
            }} placeholder={"00:00"} /></div><div style={{
            flex: 0.9,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Sec"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px",
              textAlign: "center"
            }} type={"number"} min={"0"} max={"59"} value={ex._durSecRaw !== undefined ? String(ex._durSecRaw).padStart(2, "0") : ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2, "0") : ""} onChange={e => {
              const v = e.target.value;
              updateField("_durSecRaw", v);
              const hhmm = ex._durHHMM || (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : "");
              const sec = combineHHMMSec(hhmm, v);
              updateField("durationSec", sec);
              if (sec) updateField("reps", Math.max(1, Math.floor(sec / 60)));
            }} placeholder={"00"} /></div><div style={{
            flex: 1.4,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Dist ("}{metric ? "km" : "mi"}{")"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} value={dispDist} placeholder={"0"} onChange={e => {
              const v = e.target.value;
              const mi = v && metric ? kmToMi(v) : v;
              updateField("distanceMi", mi || null);
            }} /></div></> : <><div style={{
            flex: 1,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Reps"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} value={ex.reps === 0 || ex.reps === "" ? "" : ex.reps || ""} onChange={e => updateField("reps", e.target.value)} /></div>{showW && <div style={{
            flex: 1.2,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{wUnit}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} step={metric ? "0.5" : "2.5"} value={dispW} placeholder={"—"} onChange={e => {
              const v = e.target.value;
              const lbs = v && metric ? kgToLbs(v) : v;
              updateField("weightLbs", lbs || null);
            }} /></div>}</>}</div>{isRunningEx && runBoostPct > 0 && <div style={{
        fontSize: FS.fs65,
        color: UI_COLORS.warning,
        marginBottom: S.s6
      }}>{"⚡ +"}{runBoostPct}{"% pace bonus"}{runBoostPct === 20 ? " (sub-8 mi!)" : ""}</div>}{isTreadmill && <div style={{
        marginBottom: S.s6
      }}><div style={{
          display: "flex",
          gap: S.s8
        }}><div style={{
            flex: 1
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Incline "}<span style={{
                opacity: .6,
                fontSize: FS.fs55
              }}>{"(0.5–15)"}</span></label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={ex.incline || ""} onChange={e => updateField("incline", e.target.value ? parseFloat(e.target.value) : null)} /></div><div style={{
            flex: 1
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Speed "}<span style={{
                opacity: .6,
                fontSize: FS.fs55
              }}>{"(0.5–15)"}</span></label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={ex.speed || ""} onChange={e => updateField("speed", e.target.value ? parseFloat(e.target.value) : null)} /></div></div></div>}{(ex.extraRows || []).map((row, ri) => <div key={ri} style={{
        display: "flex",
        gap: S.s4,
        marginTop: S.s4,
        padding: "6px 8px",
        background: "rgba(45,42,36,.18)",
        borderRadius: R.md,
        alignItems: "center",
        flexWrap: "wrap"
      }}><span style={{
          fontSize: FS.fs58,
          color: "#9a8a78",
          flexShrink: 0,
          minWidth: 18
        }}>{isC || isF ? `I${ri + 2}` : `S${ri + 2}`}</span>{isC || isF ? <><input className={"wb-ex-inp"} style={{
            flex: 1.5,
            minWidth: 52,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} defaultValue={row.hhmm || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              hhmm: normalizeHHMM(e.target.value)
            };
            updateField("extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 0.8,
            minWidth: 34,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} defaultValue={row.sec || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              sec: e.target.value
            };
            updateField("extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 38,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={metric ? "km" : "mi"} defaultValue={row.distanceMi || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              distanceMi: e.target.value
            };
            updateField("extraRows", rr);
          }} />{isTreadmill && <input className={"wb-ex-inp"} style={{
            flex: 0.8,
            minWidth: 34,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Inc"} defaultValue={row.incline || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              incline: e.target.value
            };
            updateField("extraRows", rr);
          }} />}{isTreadmill && <input className={"wb-ex-inp"} style={{
            flex: 0.8,
            minWidth: 34,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Spd"} defaultValue={row.speed || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              speed: e.target.value
            };
            updateField("extraRows", rr);
          }} />}</> : <>{!noSetsEx && <input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={"Sets"} defaultValue={row.sets || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              sets: e.target.value
            };
            updateField("extraRows", rr);
          }} />}<input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={"Reps"} defaultValue={row.reps || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              reps: e.target.value
            };
            updateField("extraRows", rr);
          }} />{showW && <input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 38,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={wUnit} defaultValue={row.weightLbs || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              weightLbs: e.target.value || null
            };
            updateField("extraRows", rr);
          }} />}</>}<button className={"btn btn-danger btn-xs"} style={{
          padding: "2px 6px",
          flexShrink: 0
        }} onClick={() => {
          const rr = (ex.extraRows || []).filter((_, j) => j !== ri);
          updateField("extraRows", rr);
        }}>{"✕"}</button></div>)}<button className={"btn btn-ghost btn-xs"} style={{
        width: "100%",
        marginTop: S.s4,
        marginBottom: S.s8,
        fontSize: FS.sm,
        color: "#8a8478",
        borderStyle: "dashed"
      }} onClick={() => {
        const rr = [...(ex.extraRows || []), isC || isF ? {
          hhmm: "",
          sec: "",
          distanceMi: "",
          incline: "",
          speed: ""
        } : {
          sets: ex.sets || "",
          reps: ex.reps || "",
          weightLbs: ex.weightLbs || ""
        }];
        updateField("extraRows", rr);
      }}>{"＋ Add Row (e.g. "}{isC || isF ? "interval" : "progressive weight"}{")"}</button>{showHR && <div><label style={{
          fontSize: FS.sm,
          color: "#b0a898",
          marginBottom: S.s4,
          display: "block"
        }}>{"Avg Heart Rate Zone "}<span style={{
            opacity: .6,
            fontSize: FS.fs55
          }}>{"(optional)"}</span></label><div className={"hr-zone-row"}>{HR_ZONES.map(z => {
            const sel = ex.hrZone === z.z;
            const range = hrRange(age, z);
            return <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
              "--zc": z.color,
              borderColor: sel ? z.color : "rgba(45,42,36,.2)",
              background: sel ? `${z.color}22` : "rgba(45,42,36,.12)"
            }} onClick={() => updateField("hrZone", sel ? null : z.z)}><span className={"hz-name"} style={{
                color: sel ? z.color : "#8a8478"
              }}>{"Z"}{z.z}{" "}{z.name}</span><span className={"hz-bpm"} style={{
                color: sel ? z.color : "#8a8478"
              }}>{range.lo}{"–"}{range.hi}</span></div>;
          })}</div>{ex.hrZone && <div style={{
          fontSize: FS.fs65,
          color: "#8a8478",
          fontStyle: "italic",
          marginTop: S.s4
        }}>{HR_ZONES[ex.hrZone - 1].desc}</div>}</div>}</div>}</>;
});
function App() {
  // ── Modal / dialog UI state — extracted to ./state/useUiState (item 5a)
  const ui = useUiState();
  const {
    exEditorOpen,
    setExEditorOpen,
    exEditorDraft,
    setExEditorDraft,
    exEditorMode,
    setExEditorMode,
    detailEx,
    setDetailEx,
    detailImgIdx,
    setDetailImgIdx,
    savePlanWizard,
    setSavePlanWizard,
    spwName,
    setSpwName,
    spwIcon,
    setSpwIcon,
    spwDate,
    setSpwDate,
    spwSelected,
    setSpwSelected,
    spwMode,
    setSpwMode,
    spwTargetPlanId,
    setSpwTargetPlanId,
    schedulePicker,
    setSchedulePicker,
    spDate,
    setSpDate,
    spNotes,
    setSpNotes,
    saveWorkoutWizard,
    setSaveWorkoutWizard,
    swwName,
    setSwwName,
    swwIcon,
    setSwwIcon,
    swwSelected,
    setSwwSelected,
    wbExPickerOpen,
    setWbExPickerOpen,
    addToPlanPicker,
    setAddToPlanPicker,
    addToWorkoutPicker,
    setAddToWorkoutPicker,
    retroCheckInModal,
    setRetroCheckInModal,
    retroDate,
    setRetroDate,
    retroEditModal,
    setRetroEditModal,
    statsPromptModal,
    setStatsPromptModal,
    spDuration,
    setSpDuration,
    spDurSec,
    setSpDurSec,
    spActiveCal,
    setSpActiveCal,
    spTotalCal,
    setSpTotalCal,
    spMakeReusable,
    setSpMakeReusable,
    calExDetailModal,
    setCalExDetailModal,
    oneOffModal,
    setOneOffModal,
    completionModal,
    setCompletionModal,
    completionDate,
    setCompletionDate,
    completionAction,
    setCompletionAction,
    scheduleWoDate,
    setScheduleWoDate,
    logEditModal,
    setLogEditModal,
    logEditDraft,
    setLogEditDraft,
    confirmDelete,
    setConfirmDelete,
    shareModal,
    setShareModal,
    feedbackOpen,
    setFeedbackOpen,
    feedbackText,
    setFeedbackText,
    feedbackType,
    setFeedbackType,
    feedbackSent,
    setFeedbackSent,
    feedbackEmail,
    setFeedbackEmail,
    feedbackAccountId,
    setFeedbackAccountId,
    helpConfirmShown,
    setHelpConfirmShown,
    turnstileToken,
    setTurnstileToken,
    mapOpen,
    setMapOpen,
    mapTooltip,
    setMapTooltip,
    navMenuOpen,
    setNavMenuOpen,
    showWNMockup,
    setShowWNMockup,
    toast,
    setToast,
    friendExBanner,
    setFriendExBanner,
    xpFlash,
    setXpFlash
  } = ui;
  // ── Auth flow state — extracted to ./state/useAuthState (item 5b)
  const auth = useAuthState();
  const {
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    showAuthPw,
    setShowAuthPw,
    authIsNew,
    setAuthIsNew,
    authRemember,
    setAuthRemember,
    authLoading,
    setAuthLoading,
    authMsg,
    setAuthMsg,
    loginSubScreen,
    setLoginSubScreen,
    forgotPwEmail,
    setForgotPwEmail,
    forgotPrivateId,
    setForgotPrivateId,
    forgotLookupResult,
    setForgotLookupResult,
    showPreviewPin,
    setShowPreviewPin,
    previewPinInput,
    setPreviewPinInput,
    previewPinError,
    setPreviewPinError,
    isPreviewMode,
    setIsPreviewMode,
    showPwProfile,
    setShowPwProfile,
    pwPanelOpen,
    setPwPanelOpen,
    pwNew,
    setPwNew,
    pwConfirm,
    setPwConfirm,
    pwMsg,
    setPwMsg,
    emailPanelOpen,
    setEmailPanelOpen,
    newEmail,
    setNewEmail,
    emailMsg,
    setEmailMsg,
    showEmail,
    setShowEmail,
    myPublicId,
    setMyPublicId,
    myPrivateId,
    setMyPrivateId,
    showPrivateId,
    setShowPrivateId,
    mfaPanelOpen,
    setMfaPanelOpen,
    mfaEnrolling,
    setMfaEnrolling,
    mfaQR,
    setMfaQR,
    mfaSecret,
    setMfaSecret,
    mfaFactorId,
    setMfaFactorId,
    mfaCode,
    setMfaCode,
    mfaMsg,
    setMfaMsg,
    mfaEnabled,
    setMfaEnabled,
    mfaUnenrolling,
    setMfaUnenrolling,
    mfaRecoveryCodes,
    setMfaRecoveryCodes,
    mfaCodesRemaining,
    setMfaCodesRemaining,
    mfaHasLegacyCodes,
    setMfaHasLegacyCodes,
    mfaRecoveryMode,
    setMfaRecoveryMode,
    mfaRecoveryInput,
    setMfaRecoveryInput,
    mfaDisableConfirm,
    setMfaDisableConfirm,
    mfaDisableCode,
    setMfaDisableCode,
    mfaDisableMethod,
    setMfaDisableMethod,
    mfaDisableMsg,
    setMfaDisableMsg,
    mfaChallengeScreen,
    setMfaChallengeScreen,
    mfaChallengeCode,
    setMfaChallengeCode,
    mfaChallengeMsg,
    setMfaChallengeMsg,
    mfaChallengeLoading,
    setMfaChallengeLoading,
    mfaChallengeFactorId,
    setMfaChallengeFactorId,
    phonePanelOpen,
    setPhonePanelOpen,
    phoneInput,
    setPhoneInput,
    phoneOtpSent,
    setPhoneOtpSent,
    phoneOtpCode,
    setPhoneOtpCode,
    phoneMsg,
    setPhoneMsg
  } = auth;
  const [screen, setScreen] = useState("loading");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [authUser, setAuthUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false); // set from profiles.is_admin column on login
  const [previewPinEnabled] = useState(true); // on/off switch for preview PIN gate
  const [detectedClass, setDetectedClass] = useState(null);
  const [activeTab, setActiveTab] = useState("workout");

  // Mount the Cloudflare Turnstile widget when the support modal opens.
  // The api.js loaded in index.html exposes window.turnstile; we render via
  // its JS API so we can capture the token in React state. Skips entirely
  // when VITE_TURNSTILE_SITE_KEY is empty (keeps dev / pre-Cloudflare-setup
  // working).
  useEffect(() => {
    if (!feedbackOpen || !TURNSTILE_SITE_KEY) return;
    setTurnstileToken("");
    const t = window.turnstile;
    const container = turnstileContainerRef.current;
    if (!t || !container) return;
    try {
      const id = t.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: token => setTurnstileToken(token),
        "error-callback": () => setTurnstileToken(""),
        "expired-callback": () => setTurnstileToken(""),
        theme: "dark"
      });
      turnstileWidgetIdRef.current = id;
    } catch {/* api.js still loading — skip */}
    return () => {
      const id = turnstileWidgetIdRef.current;
      if (id != null && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {/* ignore */}
      }
      turnstileWidgetIdRef.current = null;
      setTurnstileToken("");
    };
  }, [feedbackOpen]);
  const turnstileWidgetIdRef = React.useRef(null);
  const turnstileContainerRef = React.useRef(null);
  // Quick log
  const [selEx, setSelEx] = useState(null);
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [exWeight, setExWeight] = useState(""); // base weight in user's unit
  const [weightPct, setWeightPct] = useState(100); // % multiplier 50–200
  const [hrZone, setHrZone] = useState(null); // 1–5 or null
  const [distanceVal, setDistanceVal] = useState(""); // distance in user's unit
  const [exIncline, setExIncline] = useState(null);
  const [exSpeed, setExSpeed] = useState(null);
  const [exHHMM, setExHHMM] = useState(""); // HH:MM portion of duration
  const [exSec, setExSec] = useState(""); // 0-59 seconds portion
  const [quickRows, setQuickRows] = useState([]); // extra set rows [{sets,reps,weightLbs}]
  const [exCatFilter, setExCatFilter] = useState("All");
  const [exCatFilters, setExCatFilters] = useState(() => new Set());
  const [showFavsOnly, setShowFavsOnly] = useState(false);
  const [exMuscleFilter, setExMuscleFilter] = useState("All");
  const [musclePickerOpen, setMusclePickerOpen] = useState(false);
  const [exSearch, setExSearch] = useState("");
  const [exSubTab, setExSubTab] = useState("library"); // "log"(hidden) | "library" | "myworkouts"
  const [favSelectMode, setFavSelectMode] = useState(false);
  const [favSelected, setFavSelected] = useState(() => new Set());
  const [libSearch, setLibSearch] = useState("");
  const [libSearchDebounced, setLibSearchDebounced] = useState("");
  const debouncedSetLibSearch = React.useRef(debounce(v => setLibSearchDebounced(v), 200)).current;
  const [libTypeFilters, setLibTypeFilters] = useState(() => new Set());
  const [libMuscleFilters, setLibMuscleFilters] = useState(() => new Set());
  const [libEquipFilters, setLibEquipFilters] = useState(() => new Set());
  const [libOpenDrop, setLibOpenDrop] = useState(null); // "type"|"muscle"|"equip"|null
  const [libDetailEx, setLibDetailEx] = useState(null);
  const [libSelectMode, setLibSelectMode] = useState(false);
  const [libSelected, setLibSelected] = useState(() => new Set());
  const [libBrowseMode, setLibBrowseMode] = useState("home");
  const [libVisibleCount, setLibVisibleCount] = useState(60);
  const [lbFilter, setLbFilter] = useState("overall_xp");
  const [lbScope, setLbScope] = useState("world"); // "world" | "friends"
  const [lbStateFilters, setLbStateFilters] = useState(["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"]);
  const [lbCountryFilters, setLbCountryFilters] = useState(["United States"]);
  const [lbData, setLbData] = useState(null); // fetched from Supabase
  const [lbWorldRanks, setLbWorldRanks] = useState({}); // {userId: rank}
  const [lbLoading, setLbLoading] = useState(false);
  const [lbAvailableStates, setLbAvailableStates] = useState([]);
  const [lbAvailableCountries, setLbAvailableCountries] = useState([]);
  const [lbStateDropOpen, setLbStateDropOpen] = useState(false);
  const [lbCountryDropOpen, setLbCountryDropOpen] = useState(false);
  const [multiSelEx, setMultiSelEx] = useState(() => new Set());
  const [multiMode, setMultiMode] = useState(false);
  // Plan intensity (shared slider for detail + builder)

  // Exercise detail modal
  // Profile edit
  const [editMode, setEditMode] = useState(false);
  const [securityMode, setSecurityMode] = useState(false);
  const [notifMode, setNotifMode] = useState(false);
  // Friend exercise banner notification
  const friendBannerTimerRef = React.useRef(null);
  const notifPrefsRef = React.useRef(null);
  // Personal Bests filter
  const LEADERBOARD_PB_IDS = new Set(["bench", "bench_press", "squat", "barbell_back_squat", "deadlift", "barbell_deadlift", "overhead_press", "ohp", "pull_up", "pullups", "push_up", "pushups", "running", "treadmill_run", "run"]);
  const [pbFilterOpen, setPbFilterOpen] = useState(false);
  const [pbSelectedFilters, setPbSelectedFilters] = useState(null);
  // Email change
  // MFA
  // True when the user still has SHA-256-hashed recovery codes (the pre-bcrypt
  // format). Polled via the SECURITY DEFINER RPC `has_legacy_mfa_recovery_codes`
  // (scripts/security/09-mfa-legacy-detect-rpc.sql) and used to render an
  // in-app nudge to regenerate.
  // MFA disable verification
  // Phone number
  // MFA login challenge
  const [draft, setDraft] = useState({});
  // Onboarding
  const [obName, setObName] = useState("");
  const [obFirstName, setObFirstName] = useState("");
  const [obLastName, setObLastName] = useState("");
  const [obBio, setObBio] = useState("");
  const [obStep, setObStep] = useState(1);
  const [obAge, setObAge] = useState("");
  const [obGender, setObGender] = useState("");
  const [obSports, setObSports] = useState([]);
  const [obFreq, setObFreq] = useState("");
  const [obTiming, setObTiming] = useState("");
  const [obPriorities, setObPriorities] = useState([]);
  const [obStyle, setObStyle] = useState("");
  const [obState, setObState] = useState("");
  const [obCountry, setObCountry] = useState("United States");
  const [obDraft, setObDraft] = useState(null); // null | saved onboarding draft from localStorage
  // Plans
  const [charSubTab, setCharSubTab] = useState("avatar");
  const [bodyTypeLocked, setBodyTypeLocked] = useState(false);
  const plansContainerRef = useRef(null);
  const [plansPendingOpen, setPlansPendingOpen] = useState(null);
  const [dragWbExIdx, setDragWbExIdx] = useState(null);
  const [ssChecked, setSsChecked] = useState(() => new Set()); // indices checked for superset grouping
  const [ssAccordion, setSsAccordion] = useState({}); // collapse state for superset accordion sections in workout builder
  const [collapsedWbEx, setCollapsedWbEx] = useState({}); // {i: bool}
  function toggleWbEx(i) {
    setCollapsedWbEx(s => ({
      ...s,
      [i]: !s[i]
    }));
  }
  const [pickerMuscle, setPickerMuscle] = useState("All");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerMuscleOpen, setPickerMuscleOpen] = useState(false);
  const [pickerTypeFilter, setPickerTypeFilter] = useState("all");
  const [pickerEquipFilter, setPickerEquipFilter] = useState("all");
  const [pickerOpenDrop, setPickerOpenDrop] = useState(null); // "muscle"|"type"|"equip"|null
  const [pickerSelected, setPickerSelected] = useState([]); // [{exId, sets, reps, weightLbs, weightPct, durationMin, distanceMi, hrZone}]
  const [pickerConfigOpen, setPickerConfigOpen] = useState(false); // show config panel in picker
  // Quests
  const [questCat, setQuestCat] = useState("All");
  // Calendar
  const [calViewDate, setCalViewDate] = useState(() => {
    const d = new Date();
    return {
      y: d.getFullYear(),
      m: d.getMonth()
    };
  });
  const [calSelDate, setCalSelDate] = useState(todayStr());
  // Exercise editor
  // Save-as-Plan wizard (from history)
  // Schedule picker (for existing plans or exercises)
  // Workouts tab
  const [workoutView, setWorkoutView] = useState("list"); // "list"|"detail"|"builder"|"templates"
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [wbName, setWbName] = useState("");
  const [wbIcon, setWbIcon] = useState("💪");
  const [wbIconPickerOpen, setWbIconPickerOpen] = useState(false);
  const [wbDesc, setWbDesc] = useState("");
  const [wbExercises, setWbExercises] = useState([]); // [{exId,sets,reps,weightLbs,durationMin,...}]
  // wbExCompleted removed — Mark Complete feature removed from builder UX
  const [wbEditId, setWbEditId] = useState(null); // id of workout being edited
  const [wbCopySource, setWbCopySource] = useState(null);
  const [wbIsOneOff, setWbIsOneOff] = useState(false); // true when building a one-off workout
  const [pendingSoloRemoveId, setPendingSoloRemoveId] = useState(null); // scheduled solo ex to remove after full-form log
  const [workoutSubTab, setWorkoutSubTab] = useState("reusable"); // "reusable"|"oneoff"
  const [collapsedWo, setCollapsedWo] = useState(new Set());
  const [expandedRecipeDesc, setExpandedRecipeDesc] = useState(new Set()); // which recipe descs are expanded
  const [expandedRecipeEx, setExpandedRecipeEx] = useState(new Set()); // which recipe exercise lists are expanded
  const [recipeFilter, setRecipeFilter] = useState(() => new Set(["Bodyweight"])); // multi-select category filter
  const [recipeCatDrop, setRecipeCatDrop] = useState(false); // category dropdown open
  // Workout-level optional stats (builder)
  const [wbDuration, setWbDuration] = useState(""); // HH:MM string
  const [wbDurSec, setWbDurSec] = useState(""); // 0-59 seconds
  const [wbActiveCal, setWbActiveCal] = useState(""); // active calories
  const [wbTotalCal, setWbTotalCal] = useState(""); // total calories
  const [bootStep, setBootStep] = useState(0);
  // Workout label filter & builder
  const [woLabelFilters, setWoLabelFilters] = useState(() => new Set());
  const [woLabelDropOpen, setWoLabelDropOpen] = useState(false);
  const [wbLabels, setWbLabels] = useState([]); // labels for workout being built/edited
  const [newLabelInput, setNewLabelInput] = useState("");
  // Workout completion modal
  // In-app confirm delete (replaces window.confirm which fails in sandbox)
  // Log tab sub-tabs
  const [logSubTab, setLogSubTab] = useState("exercises"); // "exercises"|"workouts"|"plans"|"social"
  // ── Social / Friends ──────────────────────────────────────────────
  const [friends, setFriends] = useState([]);
  // Map of friend user_id → most recent friend_exercise_events row. Populated
  // by `loadSocialData` via the get_recent_friend_events RPC. Used to render
  // the "Latest: 💪 Squats" line on each friend card. Empty when the RPC is
  // unavailable (e.g. before script 11 has been applied) — card just shows
  // "No workouts logged yet".
  const [friendRecentEvents, setFriendRecentEvents] = useState({});
  const [friendRequests, setFriendRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]); // pending requests I sent
  const [socialLoading, setSocialLoading] = useState(false);
  // Sharing
  const [incomingShares, setIncomingShares] = useState([]); // pending shares received
  const [socialMsg, setSocialMsg] = useState(null);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendSearchResult, setFriendSearchResult] = useState(null); // null | {found:bool, user?}
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  // Messaging
  const [msgView, setMsgView] = useState("list"); // "list" | "chat"
  const [msgConversations, setMsgConversations] = useState([]);
  const [msgActiveChannel, setMsgActiveChannel] = useState(null); // channel object from conversations
  const [msgMessages, setMsgMessages] = useState([]);
  const [msgInput, setMsgInput] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgSending, setMsgSending] = useState(false);
  const [msgUnreadTotal, setMsgUnreadTotal] = useState(0);
  const msgScrollRef = React.useRef(null);
  React.useEffect(() => {
    if (msgScrollRef.current) msgScrollRef.current.scrollTop = msgScrollRef.current.scrollHeight;
  }, [msgMessages.length]);
  // Track which log groups are collapsed (by groupId key). Default all expanded.
  const [logCollapsedGroups, setLogCollapsedGroups] = useState({});
  // Log groups default to collapsed — openLogGroups tracks which ones are OPEN
  const [openLogGroups, setOpenLogGroups] = useState({});
  function toggleLogGroup(gid) {
    setOpenLogGroups(prev => ({
      ...prev,
      [gid]: !prev[gid]
    }));
  }
  // Retroactive stats lookup: get Duration/ActiveCal/TotalCal from log entry or source workout/plan
  function getEntryStats(entry) {
    let dur = Number(entry.sourceDurationSec) || 0;
    let act = Number(entry.sourceActiveCal) || 0;
    let tot = Number(entry.sourceTotalCal) || 0;
    if (!dur && !act && !tot) {
      if (entry.sourceWorkoutId) {
        const wo = (profile.workouts || []).find(w => w.id === entry.sourceWorkoutId);
        if (wo) {
          dur = Number(wo.durationMin) || 0;
          act = Number(wo.activeCal) || 0;
          tot = Number(wo.totalCal) || 0;
        }
      } else if (entry.sourcePlanId) {
        const pl = (profile.plans || []).find(p => p.id === entry.sourcePlanId);
        if (pl && pl.days) {
          pl.days.forEach(d => {
            dur += Number(d.durationMin) || 0;
            act += Number(d.activeCal) || 0;
            tot += Number(d.totalCal) || 0;
          });
        }
      }
    }
    return {
      durationSec: dur,
      activeCal: act,
      totalCal: tot
    };
  }
  // Log entry editor
  // Calendar exercise read-only detail modal
  // Retro check-in modal
  // Save-as-Workout wizard (from history)
  // Save-to-Plan wizard mode: "new" | "existing"

  // Load Supabase exercises on startup; useExercises() triggers re-render when done
  const _exReady = useExercises();
  useEffect(() => {
    loadExercises();
  }, []);

  // ── Modal accessibility lifecycle (item 3 of post-Sprint-3 a11y plan) ──
  // For each modal portal in this component, useModalLifecycle handles:
  //   - inert on #root while the modal is open (background non-interactive,
  //     hidden from screen readers)
  //   - Escape-key dismiss
  //   - Restore focus to the element that opened the modal
  // The hook stacks correctly when nested modals open (e.g. picker → config).
  useModalLifecycle(!!exEditorOpen, () => setExEditorOpen(false));
  useModalLifecycle(detailEx != null, () => setDetailEx(null));
  useModalLifecycle(savePlanWizard != null, () => setSavePlanWizard(null));
  useModalLifecycle(schedulePicker != null, () => setSchedulePicker(null));
  useModalLifecycle(saveWorkoutWizard != null, () => setSaveWorkoutWizard(null));
  useModalLifecycle(!!wbExPickerOpen, () => setWbExPickerOpen(false));
  useModalLifecycle(addToPlanPicker != null, () => setAddToPlanPicker(null));
  useModalLifecycle(!!retroCheckInModal, () => setRetroCheckInModal(false));
  useModalLifecycle(statsPromptModal != null, () => setStatsPromptModal(null));
  useModalLifecycle(calExDetailModal != null, () => setCalExDetailModal(null));
  useModalLifecycle(retroEditModal != null, () => setRetroEditModal(null));
  useModalLifecycle(addToWorkoutPicker != null, () => setAddToWorkoutPicker(null));
  useModalLifecycle(oneOffModal != null, () => setOneOffModal(null));
  useModalLifecycle(completionModal != null, () => {
    setCompletionModal(null);
    setCompletionAction("today");
    setScheduleWoDate("");
  });
  useModalLifecycle(logEditModal != null, () => setLogEditModal(null));
  useModalLifecycle(confirmDelete != null, () => setConfirmDelete(null));
  useModalLifecycle(shareModal != null, () => setShareModal(null));
  useModalLifecycle(!!feedbackOpen, () => setFeedbackOpen(false));
  useEffect(() => {
    // Listen for auth state changes (login, logout, magic link click)
    const {
      data: {
        subscription
      }
    } = sb.auth.onAuthStateChange(async (_event, session) => {
      const user = _optionalChain([session, 'optionalAccess', _22 => _22.user]) || null;

      // Skip INITIAL_SESSION — getSession() below handles the initial page load
      if (_event === "INITIAL_SESSION") return;

      // When user clicks a password reset link, direct them to Security tab
      if (_event === "PASSWORD_RECOVERY") {
        setIsPreviewMode(false); // arriving via password reset is a real auth — exit preview
        setAuthUser(user);
        const adminFlags = await loadAdminFlags(_optionalChain([user, 'optionalAccess', _23a => _23a.id]) || null);
        if (adminFlags.disabled_at) {
          await sb.auth.signOut();
          setAuthMsg("Your account has been disabled. Contact support.");
          setScreen("login");
          return;
        }
        setIsAdmin(adminFlags.is_admin);
        const saved = await loadSave(_optionalChain([user, 'optionalAccess', _23 => _23.id]) || null);
        if (_optionalChain([saved, 'optionalAccess', _24 => _24.chosenClass])) {
          (_s => setProfile({
            ..._s,
            exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
          }))(ensureRestDay({
            ...EMPTY_PROFILE,
            ...saved,
            plans: saved.plans || [],
            quests: saved.quests || {},
            customExercises: saved.customExercises || [],
            scheduledWorkouts: saved.scheduledWorkouts || [],
            workouts: saved.workouts || [],
            checkInHistory: saved.checkInHistory || []
          }));
        }
        setScreen("main");
        setActiveTab("profile");
        setSecurityMode(true);
        setEditMode(false);
        setPwPanelOpen(true);
        setPwMsg({
          ok: null,
          text: "🔑 You followed a password reset link — please set your new password below."
        });
        return;
      }

      // Silent background events — never touch the screen
      if (_event === "TOKEN_REFRESHED" || _event === "USER_UPDATED") {
        setAuthUser(user);
        return;
      }

      // Explicit sign-out — always go to login
      if (_event === "SIGNED_OUT") {
        setIsPreviewMode(false); // belt-and-suspenders: signing out always exits preview
        setAuthUser(null);
        setIsAdmin(false);
        setScreen("landing");
        return;
      }
      // Sign-in (or any other auth event with a real user) implicitly exits
      // preview mode. Without this, a user who clicked "Preview Mode" before
      // signing in would stay flagged as preview forever, silently dropping
      // every workout save until the next page reload.
      setIsPreviewMode(false);
      setAuthUser(user);
      {
        const adminFlags = await loadAdminFlags(_optionalChain([user, 'optionalAccess', _25a => _25a.id]) || null);
        if (adminFlags.disabled_at) {
          await sb.auth.signOut();
          setAuthMsg("Your account has been disabled. Contact support.");
          setScreen("login");
          return;
        }
        setIsAdmin(adminFlags.is_admin);
      }
      const saved = await loadSave(_optionalChain([user, 'optionalAccess', _25 => _25.id]) || null);
      if (_optionalChain([saved, 'optionalAccess', _26 => _26.chosenClass])) {
        (_s => setProfile({
          ..._s,
          exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
        }))(ensureRestDay({
          ...EMPTY_PROFILE,
          ...saved,
          plans: saved.plans || [],
          quests: saved.quests || {},
          customExercises: saved.customExercises || [],
          scheduledWorkouts: saved.scheduledWorkouts || [],
          workouts: saved.workouts || [],
          checkInHistory: saved.checkInHistory || []
        }));
        setScreen("main");
      } else {
        // Safety net: never navigate an active user away from "main" due to a
        // failed/slow loadSave. Functional updater reads live screen state, not
        // the stale closure value captured at mount.
        setScreen(s => s === "main" ? s : user ? "intro" : "login");
      }
    });
    // Check existing session on mount — handle both cases explicitly
    sb.auth.getSession().then(async ({
      data: {
        session
      }
    }) => {
      if (!session) {
        setScreen("landing");
      } else {
        // Session exists — load profile directly without waiting for onAuthStateChange
        const user = session.user;
        setIsPreviewMode(false); // a fresh page load with a session is never preview
        setAuthUser(user);
        checkMfaStatus();
        try {
          const adminFlags = await loadAdminFlags(user.id);
          if (adminFlags.disabled_at) {
            await sb.auth.signOut();
            setAuthMsg("Your account has been disabled. Contact support.");
            setScreen("login");
            return;
          }
          setIsAdmin(adminFlags.is_admin);
          const saved = await loadSave(user.id);
          if (_optionalChain([saved, 'optionalAccess', _27 => _27.chosenClass])) {
            (_s => setProfile({
              ..._s,
              exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
            }))(ensureRestDay({
              ...EMPTY_PROFILE,
              ...saved,
              plans: saved.plans || [],
              quests: saved.quests || {},
              customExercises: saved.customExercises || [],
              scheduledWorkouts: saved.scheduledWorkouts || [],
              workouts: saved.workouts || [],
              checkInHistory: saved.checkInHistory || []
            }));
            setScreen("main");
          } else {
            setScreen("landing");
          }
        } catch (e) {
          console.error("loadSave error:", e);
          setScreen("landing");
        }
      }
    }).catch(() => setScreen("landing"));
    // Safety fallback — if nothing resolves in 5s, go to landing
    const fallback = setTimeout(() => setScreen(s => s === "loading" ? "landing" : s), 5000);
    return () => {
      subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, []);
  // Mirror isPreviewMode into the storage layer so EVERY save path (this
  // useEffect AND every explicit doSave call site) is gated by the same
  // flag. Without this, an explicit doSave() in preview mode would write
  // demo data to the real signed-in user's Supabase row — that's the bug
  // that lost ~2 weeks of real workout history in April 2026.
  useEffect(() => { setPreviewMode(isPreviewMode); }, [isPreviewMode]);
  useEffect(() => {
    if (screen === "main" && !isPreviewMode) doSave(profile, _optionalChain([authUser, 'optionalAccess', _28 => _28.id]) || null, _optionalChain([authUser, 'optionalAccess', _29 => _29.email]) || null);
  }, [profile, screen, isPreviewMode]);

  // Global ESC handler for modal dismissal. Closes the topmost open modal in
  // priority order so keyboard users can back out of any overlay without
  // hunting for the ✕ button.
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (confirmDelete) {
        setConfirmDelete(null);
        return;
      }
      if (oneOffModal) {
        setOneOffModal(null);
        return;
      }
      if (savePlanWizard) {
        setSavePlanWizard(null);
        return;
      }
      if (saveWorkoutWizard) {
        setSaveWorkoutWizard(null);
        return;
      }
      if (completionModal) {
        setCompletionModal(null);
        return;
      }
      if (retroEditModal) {
        setRetroEditModal(null);
        return;
      }
      if (logEditModal) {
        setLogEditModal(null);
        return;
      }
      if (statsPromptModal) {
        setStatsPromptModal(null);
        return;
      }
      if (showWNMockup) {
        setShowWNMockup(false);
        return;
      }
      if (mapOpen) {
        setMapOpen(false);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDelete, oneOffModal, savePlanWizard, saveWorkoutWizard, completionModal, retroEditModal, logEditModal, statsPromptModal, showWNMockup, mapOpen]);
  useEffect(() => {
    if (screen !== "intro") {
      setBootStep(0);
      return;
    }
    setBootStep(0);
    const t1 = setTimeout(() => setBootStep(1), 700);
    const t2 = setTimeout(() => setBootStep(2), 1400);
    const t3 = setTimeout(() => setBootStep(3), 2100);
    const t4 = setTimeout(() => setBootStep(4), 2800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [screen]);
  useEffect(() => {
    if (!authUser || screen !== "onboard") return;
    const draft = {
      obStep,
      obName,
      obFirstName,
      obLastName,
      obBio,
      obAge,
      obGender,
      obSports,
      obFreq,
      obTiming,
      obPriorities,
      obStyle,
      obState,
      obCountry
    };
    try {
      localStorage.setItem("aurisar_ob_draft_" + authUser.id, JSON.stringify(draft));
    } catch (e) {}
  }, [authUser, screen, obStep, obName, obFirstName, obLastName, obBio, obAge, obGender, obSports, obFreq, obTiming, obPriorities, obStyle, obState, obCountry]);
  useEffect(() => {
    if (screen !== "intro" || !authUser || authIsNew) {
      setObDraft(null);
      return;
    }
    try {
      const raw = localStorage.getItem("aurisar_ob_draft_" + authUser.id);
      const parsed = raw ? JSON.parse(raw) : null;
      setObDraft(parsed?.obStep >= 2 ? parsed : null);
    } catch (e) {
      setObDraft(null);
    }
  }, [screen, authUser?.id, authIsNew]);
  useEffect(() => {
    // Auto-load social data on login so badge shows immediately
    if (screen === "main" && authUser) {
      loadSocialData();
      loadIncomingShares();
    }
  }, [screen, _optionalChain([authUser, 'optionalAccess', _30 => _30.id])]);
  useEffect(() => {
    function handleUnload() {
      if (sessionStorage.getItem("ilf_no_persist")) sb.auth.signOut();
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // 4s gives mobile users enough time to read; previously 2.8s was too brief.
  const showToast = (msg, dur = 4000) => {
    setToast(msg);
    setTimeout(() => setToast(null), dur);
  };

  // Keep notifPrefsRef in sync so realtime handler avoids stale closure
  useEffect(() => {
    notifPrefsRef.current = profile.notificationPrefs || {};
  }, [profile.notificationPrefs]);

  // Show a friend exercise banner notification (auto-dismiss after 5s)
  function showFriendExBanner(data) {
    if (friendBannerTimerRef.current) clearTimeout(friendBannerTimerRef.current);
    const k = Date.now();
    setFriendExBanner({
      ...data,
      key: k
    });
    friendBannerTimerRef.current = setTimeout(() => setFriendExBanner(null), 5000);
  }

  // Format PB info for friend exercise banner
  function formatFriendPB(pb) {
    if (!pb) return null;
    if (pb.type === "Strength 1RM" || pb.type === "Heaviest Weight") return "\uD83C\uDFC6 PB: " + pb.value + " lbs";
    if (pb.type === "Cardio Pace") return "\uD83C\uDFC6 PB: " + parseFloat(pb.value).toFixed(2) + " min/mi";
    if (pb.type === "Max Reps Per 1 Set") return "\uD83C\uDFC6 PB: " + pb.value + " reps";
    if (pb.type === "Assisted Weight") return "\uD83C\uDFC6 PB: " + pb.value + " lbs (assisted)";
    if (pb.type === "Longest Hold") return "\uD83C\uDFC6 PB: " + parseFloat(pb.value).toFixed(1) + " min";
    if (pb.type === "Fastest Time") return "\uD83C\uDFC6 PB: " + parseFloat(pb.value).toFixed(1) + " min";
    return null;
  }
  async function handleAuthSubmit() {
    if (!authEmail.trim() || !authPassword.trim()) return;
    setAuthLoading(true);
    setAuthMsg(null);
    if (authIsNew) {
      // Enforce password policy (length + breached-password check) before
      // sending to Supabase, both to protect users and to keep error responses
      // generic (Supabase echoes specific failure modes that aid enumeration).
      const policy = await validatePasswordPolicy(authPassword);
      if (!policy.ok) {
        setAuthLoading(false);
        setAuthMsg({
          ok: false,
          text: policy.msg
        });
        return;
      }
      const {
        data: signUpData,
        error
      } = await sb.auth.signUp({
        email: authEmail.trim(),
        password: authPassword
      });
      if (error) {
        setAuthLoading(false);
        // Map specific failure modes to safe copy; do not echo Supabase's raw
        // error string (it can disclose "User already registered" etc.).
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("already")) {
          setAuthMsg({
            ok: true,
            text: "✓ If that email is available, an account has been created. Check your inbox to confirm."
          });
        } else if (msg.includes("password")) {
          setAuthMsg({
            ok: false,
            text: "Password doesn't meet the requirements. Use at least 8 characters with 3 of: lowercase, uppercase, number, symbol."
          });
        } else {
          setAuthMsg({
            ok: false,
            text: "Sign-up failed. Please try again."
          });
        }
        return;
      }
      // If email confirmation is disabled, a session is returned immediately — use it
      if (_optionalChain([signUpData, 'optionalAccess', _31 => _31.session, 'optionalAccess', _32 => _32.user])) {
        if (!authRemember) sessionStorage.setItem("ilf_no_persist", "1");else sessionStorage.removeItem("ilf_no_persist");
        const saved = await loadSave(signUpData.session.user.id);
        setAuthUser(signUpData.session.user);
        setAuthLoading(false);
        // Bearer-auth: the function verifies the email matches the session user.
        fetch("/api/send-welcome-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + signUpData.session.access_token
          },
          body: JSON.stringify({
            email: signUpData.session.user.email
          })
        }).catch(() => {});
        if (_optionalChain([saved, 'optionalAccess', _33 => _33.chosenClass])) {
          (_s => setProfile({
            ..._s,
            exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
          }))(ensureRestDay({
            ...EMPTY_PROFILE,
            ...saved,
            plans: saved.plans || [],
            quests: saved.quests || {},
            customExercises: saved.customExercises || [],
            scheduledWorkouts: saved.scheduledWorkouts || [],
            workouts: saved.workouts || [],
            checkInHistory: saved.checkInHistory || []
          }));
          setScreen("main");
        } else {
          setScreen("intro");
        }
      } else {
        // Email confirmation is ON — tell user to verify before signing in
        setAuthLoading(false);
        setAuthMsg({
          ok: true,
          text: "✓ Account created! Check your email to verify, then sign in."
        });
        setAuthIsNew(false);
      }
    } else {
      const {
        error
      } = await sb.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword
      });
      setAuthLoading(false);
      if (error) {
        // Generic message — never disclose whether the email exists or whether
        // it just hasn't been confirmed (account-enumeration defence).
        setAuthMsg({
          ok: false,
          text: "Sign-in failed. Check your email and password, or confirm your email if you just signed up."
        });
      } else {
        if (!authRemember) sessionStorage.setItem("ilf_no_persist", "1");else sessionStorage.removeItem("ilf_no_persist");
        // Check if MFA challenge is needed before proceeding
        const mfaRequired = await checkAndHandleMfaChallenge();
        if (mfaRequired) return; // MFA screen is now showing
        // Fallback: manually trigger load if onAuthStateChange is slow
        // Try up to 3 times with a small delay
        let attempts = 0;
        const tryLoad = async () => {
          attempts++;
          try {
            const {
              data: {
                session
              }
            } = await sb.auth.getSession();
            if (_optionalChain([session, 'optionalAccess', _34 => _34.user])) {
              const saved = await loadSave(session.user.id);
              if (_optionalChain([saved, 'optionalAccess', _35 => _35.chosenClass])) {
                (_s => setProfile({
                  ..._s,
                  exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
                }))(ensureRestDay({
                  ...EMPTY_PROFILE,
                  ...saved,
                  plans: saved.plans || [],
                  quests: saved.quests || {},
                  customExercises: saved.customExercises || [],
                  scheduledWorkouts: saved.scheduledWorkouts || [],
                  workouts: saved.workouts || [],
                  checkInHistory: saved.checkInHistory || []
                }));
                setScreen("main");
              } else {
                setScreen("intro");
              }
            } else if (attempts < 3) {
              setTimeout(tryLoad, 800);
            } else {
              // Give up and show error
              setAuthMsg({
                ok: false,
                text: "Login succeeded but session failed to load. Please refresh and try again."
              });
              setAuthLoading(false);
            }
          } catch (e) {
            if (attempts < 3) setTimeout(tryLoad, 800);else {
              setAuthMsg({
                ok: false,
                text: "Network error. Please check your connection and try again."
              });
            }
          }
        };
        tryLoad();
      }
    }
  }
  async function sendPasswordReset() {
    if (!forgotPwEmail.trim()) {
      setAuthMsg({
        ok: false,
        text: "Enter your email address."
      });
      return;
    }
    setAuthLoading(true);
    setAuthMsg(null);
    // Fire-and-forget: never reveal whether the email exists.
    await sb.auth.resetPasswordForEmail(forgotPwEmail.trim(), {
      redirectTo: getResetRedirect()
    }).catch(() => {});
    setAuthLoading(false);
    setAuthMsg({
      ok: true,
      text: "\u2713 If an account exists for that email, a reset link has been sent. Check your inbox."
    });
  }
  async function lookupByPrivateId() {
    if (!forgotPrivateId.trim()) {
      setForgotLookupResult({
        found: false,
        error: "Enter your Private Account ID"
      });
      return;
    }
    setAuthLoading(true);
    setForgotLookupResult(null);
    try {
      const {
        data,
        error
      } = await sb.rpc('lookup_email_by_private_id', {
        p_private_id: forgotPrivateId.trim()
      });
      setAuthLoading(false);
      if (error) {
        setForgotLookupResult({
          found: false,
          error: error.message
        });
        return;
      }
      setForgotLookupResult(data);
    } catch (e) {
      setAuthLoading(false);
      setForgotLookupResult({
        found: false,
        error: e.message
      });
    }
  }
  async function changePassword() {
    if (!pwNew.trim()) {
      setPwMsg({
        ok: false,
        text: "Enter a new password."
      });
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwMsg({
        ok: false,
        text: "Passwords don't match."
      });
      return;
    }
    setPwMsg({
      ok: null,
      text: "Checking password…"
    });
    const policy = await validatePasswordPolicy(pwNew);
    if (!policy.ok) {
      setPwMsg({
        ok: false,
        text: policy.msg
      });
      return;
    }
    setPwMsg(null);
    const {
      error
    } = await sb.auth.updateUser({
      password: pwNew
    });
    if (error) setPwMsg({
      ok: false,
      text: "Could not update password. Please try again."
    });else {
      setPwMsg({
        ok: true,
        text: "✓ Password updated!"
      });
      setPwNew("");
      setPwConfirm("");
      setShowPwProfile(false);
    }
  }

  // ── CHANGE EMAIL ──────────────────────────────────────────────
  async function changeEmailAddress() {
    if (!newEmail.trim()) {
      setEmailMsg({
        ok: false,
        text: "Enter a new email address."
      });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail.trim())) {
      setEmailMsg({
        ok: false,
        text: "Please enter a valid email address."
      });
      return;
    }
    if (authUser && newEmail.trim().toLowerCase() === authUser.email.toLowerCase()) {
      setEmailMsg({
        ok: false,
        text: "That's already your current email."
      });
      return;
    }
    setEmailMsg(null);
    try {
      const {
        error
      } = await sb.auth.updateUser({
        email: newEmail.trim()
      });
      if (error) setEmailMsg({
        ok: false,
        text: "Error: " + error.message
      });else {
        setEmailMsg({
          ok: true,
          text: "✓ Confirmation sent! Check both your old and new email inboxes to complete the change."
        });
        setNewEmail("");
      }
    } catch (e) {
      setEmailMsg({
        ok: false,
        text: "Unexpected error: " + e.message
      });
    }
  }

  // ── MFA (TOTP) ────────────────────────────────────────────────
  async function checkMfaStatus() {
    try {
      const {
        data,
        error
      } = await sb.auth.mfa.listFactors();
      if (!error && data) {
        const totp = (data.totp || []).find(f => f.status === "verified");
        setMfaEnabled(!!totp);
        if (totp) setMfaFactorId(totp.id);
      }
      // Fetch remaining recovery codes
      const {
        data: countData
      } = await sb.rpc("count_recovery_codes_remaining");
      if (typeof countData === "number") setMfaCodesRemaining(countData);
      // Detect SHA-256 legacy codes (pre-bcrypt). Soft-fail: if the RPC is
      // missing because 09 hasn't been applied yet, treat as no-legacy.
      try {
        const {
          data: legacy
        } = await sb.rpc("has_legacy_mfa_recovery_codes");
        setMfaHasLegacyCodes(legacy === true);
      } catch {
        setMfaHasLegacyCodes(false);
      }
    } catch (e) {
      console.warn("MFA check error:", e);
    }
  }
  async function startMfaEnroll() {
    setMfaEnrolling(true);
    setMfaMsg(null);
    setMfaCode("");
    try {
      const {
        data,
        error
      } = await sb.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Aurisar"
      });
      if (error) {
        setMfaMsg({
          ok: false,
          text: "Error: " + error.message
        });
        setMfaEnrolling(false);
        return;
      }
      setMfaQR(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaFactorId(data.id);
    } catch (e) {
      setMfaMsg({
        ok: false,
        text: "Unexpected error: " + e.message
      });
      setMfaEnrolling(false);
    }
  }
  async function verifyMfaEnroll() {
    if (!mfaCode.trim() || mfaCode.trim().length < 6) {
      setMfaMsg({
        ok: false,
        text: "Enter the 6-digit code from your authenticator app."
      });
      return;
    }
    setMfaMsg(null);
    try {
      const {
        data: challenge,
        error: chErr
      } = await sb.auth.mfa.challenge({
        factorId: mfaFactorId
      });
      if (chErr) {
        setMfaMsg({
          ok: false,
          text: "Challenge error: " + chErr.message
        });
        return;
      }
      const {
        error: vErr
      } = await sb.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode.trim()
      });
      if (vErr) {
        setMfaMsg({
          ok: false,
          text: "Verification failed — check the code and try again."
        });
        return;
      }

      // Generate 10 recovery codes
      // Generate 10 × 80-bit recovery codes. Server-side bcrypt hashing is in
      // place (scripts/security/04-mfa-recovery-bcrypt.sql) — send plaintext
      // and let the RPC bcrypt them with a per-row salt.
      const codes = Array.from({
        length: 10
      }, () => generateRecoveryCode());
      await sb.rpc("store_mfa_recovery_codes", {
        code_plaintexts: codes
      });
      setMfaEnabled(true);
      setMfaEnrolling(false);
      setMfaQR(null);
      setMfaSecret(null);
      setMfaCode("");
      setMfaRecoveryCodes(codes); // Show codes to user (one-time)
      setMfaCodesRemaining(10);
      setMfaMsg({
        ok: true,
        text: "✓ MFA is now active! Save your recovery codes below — they won't be shown again."
      });
    } catch (e) {
      setMfaMsg({
        ok: false,
        text: "Unexpected error: " + e.message
      });
    }
  }

  // ── MFA DISABLE (VERIFIED) ─────────────────────────────────
  // Step 1: User clicks "Disable MFA" → opens confirmation panel
  function unenrollMfa() {
    setMfaDisableConfirm(true);
    setMfaDisableCode("");
    setMfaDisableMsg(null);
    setMfaDisableMethod("totp");
  }

  // Step 2a: Verify with TOTP code, then disable
  async function confirmMfaDisableWithTotp() {
    if (!mfaDisableCode.trim() || mfaDisableCode.trim().length < 6) {
      setMfaDisableMsg({
        ok: false,
        text: "Enter your 6-digit authenticator code."
      });
      return;
    }
    setMfaUnenrolling(true);
    setMfaDisableMsg(null);
    try {
      // Challenge + verify the TOTP code first
      const {
        data: challenge,
        error: chErr
      } = await sb.auth.mfa.challenge({
        factorId: mfaFactorId
      });
      if (chErr) {
        setMfaDisableMsg({
          ok: false,
          text: "Error: " + chErr.message
        });
        setMfaUnenrolling(false);
        return;
      }
      const {
        error: vErr
      } = await sb.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaDisableCode.trim()
      });
      if (vErr) {
        setMfaDisableMsg({
          ok: false,
          text: "Invalid code — check your authenticator and try again."
        });
        setMfaUnenrolling(false);
        return;
      }
      // Code verified — now disable
      await doMfaDisable();
    } catch (e) {
      setMfaDisableMsg({
        ok: false,
        text: "Error: " + e.message
      });
      setMfaUnenrolling(false);
    }
  }

  // Step 2b: Send phone OTP for MFA disable
  async function sendPhoneOtpForDisable() {
    const phone = profile.phone;
    if (!phone) {
      setMfaDisableMsg({
        ok: false,
        text: "No verified phone on file. Use your authenticator code instead."
      });
      return;
    }
    setMfaDisableMsg(null);
    try {
      const {
        data: expiry,
        error
      } = await sb.rpc("send_phone_otp", {
        p_phone: phone,
        p_purpose: "disable_mfa"
      });
      if (error) {
        setMfaDisableMsg({
          ok: false,
          text: "Error sending SMS: " + error.message
        });
        return;
      }
      setMfaDisableMsg({
        ok: true,
        text: "✓ Code sent to " + phone.slice(0, -4).replace(/./g, "•") + phone.slice(-4) + ". Expires in 10 minutes."
      });
    } catch (e) {
      setMfaDisableMsg({
        ok: false,
        text: "Error: " + e.message
      });
    }
  }

  // Step 2b continued: Verify phone OTP, then disable
  async function confirmMfaDisableWithPhone() {
    if (!mfaDisableCode.trim() || mfaDisableCode.trim().length < 6) {
      setMfaDisableMsg({
        ok: false,
        text: "Enter the 6-digit code sent to your phone."
      });
      return;
    }
    setMfaUnenrolling(true);
    setMfaDisableMsg(null);
    try {
      const {
        data: valid,
        error
      } = await sb.rpc("verify_phone_otp", {
        p_code: mfaDisableCode.trim(),
        p_purpose: "disable_mfa"
      });
      if (error) {
        setMfaDisableMsg({
          ok: false,
          text: "Error: " + error.message
        });
        setMfaUnenrolling(false);
        return;
      }
      if (!valid) {
        setMfaDisableMsg({
          ok: false,
          text: "Invalid or expired code."
        });
        setMfaUnenrolling(false);
        return;
      }
      await doMfaDisable();
    } catch (e) {
      setMfaDisableMsg({
        ok: false,
        text: "Error: " + e.message
      });
      setMfaUnenrolling(false);
    }
  }

  // Step 3: Actual MFA removal (only called after verification)
  async function doMfaDisable() {
    try {
      const {
        error
      } = await sb.auth.mfa.unenroll({
        factorId: mfaFactorId
      });
      if (error) {
        setMfaDisableMsg({
          ok: false,
          text: "Error: " + error.message
        });
        setMfaUnenrolling(false);
        return;
      }
      await sb.rpc("store_mfa_recovery_codes", {
        code_plaintexts: []
      });
      setMfaEnabled(false);
      setMfaFactorId(null);
      setMfaRecoveryCodes(null);
      setMfaCodesRemaining(0);
      setMfaDisableConfirm(false);
      setMfaDisableCode("");
      setMfaMsg({
        ok: true,
        text: "✓ MFA has been disabled."
      });
    } catch (e) {
      setMfaDisableMsg({
        ok: false,
        text: "Error: " + e.message
      });
    }
    setMfaUnenrolling(false);
  }

  // ── PHONE NUMBER MANAGEMENT ───────────────────────────────
  async function sendPhoneVerification() {
    const phone = phoneInput.trim();
    if (!phone) {
      setPhoneMsg({
        ok: false,
        text: "Enter a phone number."
      });
      return;
    }
    // Basic validation: starts with + and has 10+ digits
    if (!/^\+\d{10,15}$/.test(phone.replace(/[\s\-()]/g, ""))) {
      setPhoneMsg({
        ok: false,
        text: "Enter a valid phone number with country code (e.g. +12145551234)."
      });
      return;
    }
    setPhoneMsg(null);
    try {
      const {
        data: expiry,
        error
      } = await sb.rpc("send_phone_otp", {
        p_phone: phone.replace(/[\s\-()]/g, ""),
        p_purpose: "verify_phone"
      });
      if (error) {
        setPhoneMsg({
          ok: false,
          text: "Error: " + error.message
        });
        return;
      }
      setPhoneOtpSent(true);
      setPhoneMsg({
        ok: true,
        text: "✓ Code sent! Check your phone. Expires in 10 minutes."
      });
    } catch (e) {
      setPhoneMsg({
        ok: false,
        text: "Error: " + e.message
      });
    }
  }
  async function verifyPhoneOtp() {
    if (!phoneOtpCode.trim() || phoneOtpCode.trim().length < 6) {
      setPhoneMsg({
        ok: false,
        text: "Enter the 6-digit code."
      });
      return;
    }
    setPhoneMsg(null);
    try {
      const {
        data: valid,
        error
      } = await sb.rpc("verify_phone_otp", {
        p_code: phoneOtpCode.trim(),
        p_purpose: "verify_phone"
      });
      if (error) {
        setPhoneMsg({
          ok: false,
          text: "Error: " + error.message
        });
        return;
      }
      if (!valid) {
        setPhoneMsg({
          ok: false,
          text: "Invalid or expired code."
        });
        return;
      }
      // Phone verified — update local profile
      const cleanPhone = phoneInput.trim().replace(/[\s\-()]/g, "");
      setProfile(p => ({
        ...p,
        phone: cleanPhone,
        phoneVerified: true
      }));
      setPhoneOtpSent(false);
      setPhoneOtpCode("");
      setPhoneInput("");
      setPhoneMsg({
        ok: true,
        text: "✓ Phone number verified!"
      });
    } catch (e) {
      setPhoneMsg({
        ok: false,
        text: "Error: " + e.message
      });
    }
  }
  function removePhone() {
    setProfile(p => ({
      ...p,
      phone: null,
      phoneVerified: false
    }));
    setPhoneMsg({
      ok: true,
      text: "Phone number removed."
    });
    setPhoneOtpSent(false);
    setPhoneOtpCode("");
    setPhoneInput("");
  }

  // ── MFA LOGIN CHALLENGE ───────────────────────────────────
  async function checkAndHandleMfaChallenge() {
    try {
      const {
        data,
        error
      } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) return false;
      if (data.currentLevel === "aal1" && data.nextLevel === "aal2") {
        // MFA is required — get factor ID
        const {
          data: factors
        } = await sb.auth.mfa.listFactors();
        const totp = (factors.totp || []).find(f => f.status === "verified");
        if (totp) {
          setMfaChallengeFactorId(totp.id);
          setMfaChallengeScreen(true);
          setMfaChallengeCode("");
          setMfaChallengeMsg(null);
          setMfaRecoveryMode(false);
          setMfaRecoveryInput("");
          return true; // Intercepted — don't proceed to main
        }
      }
    } catch (e) {
      console.warn("MFA assurance check:", e);
    }
    return false;
  }
  async function submitMfaChallenge() {
    if (!mfaChallengeCode.trim() || mfaChallengeCode.trim().length < 6) {
      setMfaChallengeMsg({
        ok: false,
        text: "Enter the 6-digit code."
      });
      return;
    }
    setMfaChallengeLoading(true);
    setMfaChallengeMsg(null);
    try {
      const {
        data: challenge,
        error: chErr
      } = await sb.auth.mfa.challenge({
        factorId: mfaChallengeFactorId
      });
      if (chErr) {
        setMfaChallengeMsg({
          ok: false,
          text: "Error: " + chErr.message
        });
        setMfaChallengeLoading(false);
        return;
      }
      const {
        error: vErr
      } = await sb.auth.mfa.verify({
        factorId: mfaChallengeFactorId,
        challengeId: challenge.id,
        code: mfaChallengeCode.trim()
      });
      if (vErr) {
        setMfaChallengeMsg({
          ok: false,
          text: "Invalid code — try again."
        });
        setMfaChallengeLoading(false);
        return;
      }
      // Success — proceed to load profile
      setMfaChallengeScreen(false);
      setMfaChallengeLoading(false);
      const {
        data: {
          session
        }
      } = await sb.auth.getSession();
      if (session?.user) {
        setAuthUser(session.user);
        checkMfaStatus();
        const saved = await loadSave(session.user.id);
        if (saved?.chosenClass) {
          (_s => setProfile({
            ..._s,
            exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
          }))(ensureRestDay({
            ...EMPTY_PROFILE,
            ...saved,
            plans: saved.plans || [],
            quests: saved.quests || {},
            customExercises: saved.customExercises || [],
            scheduledWorkouts: saved.scheduledWorkouts || [],
            workouts: saved.workouts || [],
            checkInHistory: saved.checkInHistory || []
          }));
          setScreen("main");
        } else {
          setScreen("intro");
        }
      }
    } catch (e) {
      setMfaChallengeMsg({
        ok: false,
        text: "Error: " + e.message
      });
      setMfaChallengeLoading(false);
    }
  }
  async function submitRecoveryCode() {
    if (!mfaRecoveryInput.trim()) {
      setMfaChallengeMsg({
        ok: false,
        text: "Enter a recovery code."
      });
      return;
    }
    setMfaChallengeLoading(true);
    setMfaChallengeMsg(null);
    try {
      const {
        data: result,
        error
      } = await sb.rpc("use_mfa_recovery_code", {
        code_plaintext: mfaRecoveryInput.trim().toUpperCase()
      });
      if (error) {
        setMfaChallengeMsg({
          ok: false,
          text: "Error: " + error.message
        });
        setMfaChallengeLoading(false);
        return;
      }
      if (!result) {
        setMfaChallengeMsg({
          ok: false,
          text: "Invalid or already-used recovery code."
        });
        setMfaChallengeLoading(false);
        return;
      }
      // MFA has been unenrolled — refresh session and proceed
      setMfaChallengeScreen(false);
      setMfaChallengeLoading(false);
      const {
        data: {
          session
        }
      } = await sb.auth.getSession();
      if (session?.user) {
        setAuthUser(session.user);
        const saved = await loadSave(session.user.id);
        if (saved?.chosenClass) {
          (_s => setProfile({
            ..._s,
            exercisePBs: Object.keys(_s.exercisePBs || {}).length > 0 ? _s.exercisePBs : calcExercisePBs(_s.log || [])
          }))(ensureRestDay({
            ...EMPTY_PROFILE,
            ...saved,
            plans: saved.plans || [],
            quests: saved.quests || {},
            customExercises: saved.customExercises || [],
            scheduledWorkouts: saved.scheduledWorkouts || [],
            workouts: saved.workouts || [],
            checkInHistory: saved.checkInHistory || []
          }));
          setScreen("main");
        } else {
          setScreen("intro");
        }
        showToast("🔓 Recovery code accepted — MFA has been removed. You can re-enroll in Profile → Security.");
      }
    } catch (e) {
      setMfaChallengeMsg({
        ok: false,
        text: "Error: " + e.message
      });
      setMfaChallengeLoading(false);
    }
  }
  async function regenerateRecoveryCodes() {
    setMfaMsg(null);
    try {
      const codes = Array.from({
        length: 10
      }, () => generateRecoveryCode());
      await sb.rpc("store_mfa_recovery_codes", {
        code_plaintexts: codes
      });
      setMfaRecoveryCodes(codes);
      setMfaCodesRemaining(10);
      setMfaMsg({
        ok: true,
        text: "✓ New recovery codes generated. Save them — they won't be shown again."
      });
    } catch (e) {
      setMfaMsg({
        ok: false,
        text: "Error generating codes: " + e.message
      });
    }
  }

  // ── NOTIFICATION PREFS ────────────────────────────────────────
  function toggleNotifPref(key) {
    setProfile(p => ({
      ...p,
      notificationPrefs: {
        ...(p.notificationPrefs || {}),
        [key]: !(p.notificationPrefs || {})[key]
      }
    }));
  }

  // ── RECOVERY CODE NAVIGATION GUARD ────────────────────────
  // Shows a browser confirm dialog if user tries to navigate
  // away while recovery codes are still displayed.
  // ── PROFILE IDS ──────────────────────────────────────────────
  async function loadProfileIds() {
    try {
      const {
        data
      } = await sb.from('profiles').select('public_id, private_id').eq('id', authUser?.id).single();
      if (data) {
        setMyPublicId(data.public_id);
        setMyPrivateId(data.private_id);
      }
    } catch (e) {/* silent */}
  }

  // ── MESSAGING ──────────────────────────────────────────────
  async function loadConversations() {
    if (!authUser) return;
    try {
      const {
        data,
        error
      } = await sb.rpc('get_my_conversations');
      if (!error && data) setMsgConversations(data);
    } catch (e) {/* silent */}
  }
  async function loadUnreadCount() {
    if (!authUser) return;
    try {
      const {
        data,
        error
      } = await sb.rpc('get_total_unread_count');
      if (!error && typeof data === 'number') setMsgUnreadTotal(data);
    } catch (e) {/* silent */}
  }
  async function openDmWithUser(otherUserId) {
    if (!authUser) return;
    setMsgLoading(true);
    try {
      const {
        data: channelId,
        error
      } = await sb.rpc('get_or_create_dm_channel', {
        p_other_user_id: otherUserId
      });
      if (error) {
        showToast("Could not open chat: " + error.message);
        setMsgLoading(false);
        return;
      }
      // Load conversations to get channel details
      await loadConversations();
      // Find the channel in conversations
      const convos = msgConversations.length > 0 ? msgConversations : [];
      const {
        data: freshConvos
      } = await sb.rpc('get_my_conversations');
      const chan = (freshConvos || []).find(c => c.channel_id === channelId);
      if (chan) {
        setMsgActiveChannel(chan);
        await loadChannelMessages(channelId);
        setMsgConversations(freshConvos || []);
      }
      setActiveTab("messages");
      setMsgView("chat");
    } catch (e) {
      showToast("Chat error: " + e.message);
    }
    setMsgLoading(false);
  }
  async function loadChannelMessages(channelId) {
    setMsgLoading(true);
    try {
      const {
        data,
        error
      } = await sb.rpc('get_channel_messages', {
        p_channel_id: channelId,
        p_limit: 50
      });
      if (!error) setMsgMessages(data || []);
    } catch (e) {/* silent */}
    setMsgLoading(false);
  }
  async function sendMsg() {
    if (!authUser || !msgActiveChannel || !msgInput.trim()) return;
    setMsgSending(true);
    try {
      const {
        error
      } = await sb.rpc('send_message', {
        p_channel_id: msgActiveChannel.channel_id,
        p_content: msgInput.trim()
      });
      if (error) {
        showToast("Send failed: " + error.message);
      } else {
        setMsgInput("");
        await loadChannelMessages(msgActiveChannel.channel_id);
        await loadConversations();
      }
    } catch (e) {
      showToast("Send error: " + e.message);
    }
    setMsgSending(false);
  }

  // Realtime subscription for new messages
  useEffect(() => {
    if (!authUser) return;
    const channel = sb.channel('messages-realtime').on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, payload => {
      const msg = payload.new;
      // If we're in the active chat, refresh messages
      if (msgActiveChannel && msg.channel_id === msgActiveChannel.channel_id) {
        loadChannelMessages(msg.channel_id);
      }
      // Always refresh unread + conversations
      loadUnreadCount();
      loadConversations();
    }).subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [authUser?.id, msgActiveChannel?.channel_id]);

  // Phase 3b: emit a friend_exercise_events row whenever the user adds a new
  // entry to their log. Friends receive these via realtime (RLS-scoped to
  // accepted friends only). Replaces the old "stream the whole profile.data
  // jsonb to every authenticated user" pattern.
  const lastSeenLogLenRef = React.useRef(null);
  const lastSeenPBsRef = React.useRef(null);
  useEffect(() => {
    if (!authUser || isPreviewMode) return;
    const currentLog = profile.log || [];
    const currentPBs = profile.exercisePBs || {};
    if (lastSeenLogLenRef.current === null) {
      lastSeenLogLenRef.current = currentLog.length;
      lastSeenPBsRef.current = currentPBs;
      return;
    }
    const prevLen = lastSeenLogLenRef.current;
    const newLen = currentLog.length;
    if (newLen > prevLen) {
      const newEntries = currentLog.slice(0, newLen - prevLen);
      const prevPBs = lastSeenPBsRef.current || {};
      for (const entry of newEntries) {
        const exId = entry?.exId;
        if (!exId || exId === 'rest_day') continue;
        const prevPB = prevPBs[exId];
        const curPB = currentPBs[exId];
        const isPB = !!(curPB && (!prevPB || curPB.value !== prevPB.value));
        sb.from('friend_exercise_events').insert({
          user_id: authUser.id,
          exercise_name: entry.exercise || null,
          exercise_id: exId,
          exercise_icon: entry.icon || null,
          is_pb: isPB,
          pb_value: isPB ? curPB?.value ?? null : null,
          pb_type: isPB ? curPB?.type ?? null : null
        }).then(({
          error
        }) => {
          if (error) console.warn('friend_exercise_events insert failed:', error.message);
        });
      }
    }
    lastSeenLogLenRef.current = newLen;
    lastSeenPBsRef.current = currentPBs;
  }, [profile.log, profile.exercisePBs, authUser?.id, isPreviewMode]);

  // Reset emit-tracker on auth change so the next session starts from baseline.
  useEffect(() => {
    lastSeenLogLenRef.current = null;
    lastSeenPBsRef.current = null;
  }, [authUser?.id]);

  // Realtime subscription for friend exercise completions (in-app banner).
  // Listens on friend_exercise_events. RLS scopes payloads to accepted friends.
  useEffect(() => {
    if (!authUser) return;
    const channel = sb.channel('friend-exercise-events').on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'friend_exercise_events'
    }, payload => {
      const ev = payload.new;
      if (!ev || ev.user_id === authUser.id) return;
      if (notifPrefsRef.current && notifPrefsRef.current.friendExercise === false) return;
      const friend = friends.find(f => f.id === ev.user_id);
      const friendName = friend?.playerName || "A friend";
      const pbInfo = ev.is_pb ? {
        type: ev.pb_type,
        value: ev.pb_value
      } : null;
      showFriendExBanner({
        friendName,
        exerciseName: ev.exercise_name || ev.exercise_id || "an exercise",
        exerciseIcon: ev.exercise_icon || "💪",
        pbInfo
      });
    }).subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [authUser?.id, friends.map(f => f.id).join(',')]);

  // Load unread on auth and periodically
  useEffect(() => {
    if (authUser) {
      loadUnreadCount();
      loadConversations();
    }
  }, [authUser?.id]);

  // ── LEADERBOARD ────────────────────────────────────────────
  async function loadLeaderboard() {
    setLbLoading(true);
    try {
      // Friends scope ignores state/country filters — always show all friends
      const isFriends = lbScope === 'friends';
      const {
        data,
        error
      } = await sb.rpc('get_leaderboard', {
        p_scope: isFriends ? 'friends' : 'community',
        // RPC uses 'community' for world scope
        p_states: isFriends ? null : lbStateFilters.length > 0 ? lbStateFilters : null,
        p_countries: isFriends ? null : lbCountryFilters.length > 0 ? lbCountryFilters : null,
        p_limit: 100,
        p_user_id: authUser ? authUser.id : null
      });
      if (error) {
        console.warn('Leaderboard error:', error.message);
      } else {
        setLbData(data || []);
      }

      // Load world ranks (for showing on friends cards)
      if (isFriends) {
        const {
          data: ranks,
          error: rErr
        } = await sb.rpc('get_world_ranks');
        if (!rErr && ranks) setLbWorldRanks(ranks);
      }
    } catch (e) {
      console.warn('Leaderboard fetch error:', e.message);
    }
    setLbLoading(false);
  }
  async function loadLeaderboardFilters() {
    try {
      const {
        data,
        error
      } = await sb.rpc('get_leaderboard_filters');
      if (!error && data) {
        setLbAvailableStates(data.states || []);
        setLbAvailableCountries(data.countries || []);
      }
    } catch (e) {/* silent */}
  }

  // Load profile IDs when authenticated
  useEffect(() => {
    if (authUser) loadProfileIds();
  }, [authUser?.id]);

  // Auto-load leaderboard when tab opens or filters change
  useEffect(() => {
    if (activeTab === 'leaderboard' && authUser) {
      loadLeaderboard();
      loadLeaderboardFilters();
    }
  }, [activeTab]);
  useEffect(() => {
    if (activeTab === 'leaderboard' && authUser && lbData !== null) {
      loadLeaderboard();
    }
  }, [lbScope, lbStateFilters, lbCountryFilters]);

  // ── PROFILE COMPLETION CHECK ────────────────────────────────
  // Blocks navigation away from Profile if state or country is missing
  // ── NAME VISIBILITY ──────────────────────────────────────────
  // Returns the name to display for a given context ("app" or "game")
  function getNameForContext(ctx, prof) {
    const p = prof || profile;
    const nv = p.nameVisibility || {
      displayName: ["app", "game"],
      realName: ["hide"]
    };
    if ((nv.displayName || []).includes(ctx)) return p.playerName || "Unknown";
    if ((nv.realName || []).includes(ctx)) {
      const fn = p.firstName || "";
      const ln = p.lastName || "";
      return (fn + " " + ln).trim() || p.playerName || "Unknown";
    }
    return p.playerName || "Unknown";
  }

  // Toggle a visibility box. Enforces: app and game must each be assigned to exactly one row.
  function toggleNameVisibility(row, box) {
    setProfile(prev => {
      const nv = {
        ...(prev.nameVisibility || {
          displayName: ["app", "game"],
          realName: ["hide"]
        })
      };
      nv.displayName = [...(nv.displayName || [])];
      nv.realName = [...(nv.realName || [])];
      const otherRow = row === "displayName" ? "realName" : "displayName";
      if (box === "hide") {
        // Toggle hide on this row — move all its app/game to the other row
        if (nv[row].includes("hide")) {
          // Unhiding: give this row back whatever the other row has, take from other
          // Default: give this row "app" and "game", other gets "hide"
          nv[row] = ["app", "game"];
          nv[otherRow] = ["hide"];
        } else {
          // Hiding this row: move any app/game it has to the other row
          const moving = nv[row].filter(b => b === "app" || b === "game");
          nv[otherRow] = nv[otherRow].filter(b => b !== "hide");
          moving.forEach(m => {
            if (!nv[otherRow].includes(m)) nv[otherRow].push(m);
          });
          nv[row] = ["hide"];
        }
      } else {
        // Toggling app or game
        if (nv[row].includes("hide")) {
          // Row is hidden — unhide it and give it this box, take from other row
          nv[row] = [box];
          nv[otherRow] = nv[otherRow].filter(b => b !== box);
          if (nv[otherRow].length === 0) nv[otherRow] = ["hide"];
        } else if (nv[row].includes(box)) {
          // Already has this box — remove it, give to other row
          nv[row] = nv[row].filter(b => b !== box);
          nv[otherRow] = nv[otherRow].filter(b => b !== "hide");
          if (!nv[otherRow].includes(box)) nv[otherRow].push(box);
          if (nv[row].length === 0) nv[row] = ["hide"];
        } else {
          // Doesn't have this box — add it, remove from other row
          nv[row] = nv[row].filter(b => b !== "hide");
          nv[row].push(box);
          nv[otherRow] = nv[otherRow].filter(b => b !== box);
          if (nv[otherRow].length === 0) nv[otherRow] = ["hide"];
        }
      }
      const updated = {
        ...prev,
        nameVisibility: nv
      };
      doSave(updated, authUser?.id || null, authUser?.email || null);
      return updated;
    });
  }
  function profileComplete() {
    return profile.state && profile.state !== '' && profile.country && profile.country !== '';
  }
  function guardProfileCompletion(callback) {
    if (activeTab === 'profile' && !profileComplete() && screen === 'main') {
      showToast("Please set your State and Country in Edit Profile before continuing.");
      return;
    }
    callback();
  }
  function guardAll(callback) {
    guardRecoveryCodes(() => guardProfileCompletion(callback));
  }
  function guardRecoveryCodes(callback) {
    if (!mfaRecoveryCodes) {
      callback();
      return;
    }
    setConfirmDelete({
      icon: "🔑",
      title: "Leave without saving codes?",
      body: "You have unsaved recovery codes. If you haven't copied or downloaded them, you won't be able to see them again.",
      confirmLabel: "Leave anyway",
      cancelLabel: "Stay here",
      onConfirm: () => {
        setMfaRecoveryCodes(null);
        callback();
      }
    });
  }

  // Block browser tab close / refresh while recovery codes are showing
  useEffect(() => {
    if (!mfaRecoveryCodes) return;
    const handler = e => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [mfaRecoveryCodes]);

  // ── SOCIAL FUNCTIONS ──────────────────────────────────────────────
  async function loadSocialData() {
    if (!authUser) return;
    setSocialLoading(true);
    try {
      // Split into two queries to avoid .or() + .eq() chain issues in Supabase JS v2
      const {
        data: sentAccepted
      } = await sb.from("friend_requests").select("id,from_user_id,to_user_id,status").eq("from_user_id", authUser.id).eq("status", "accepted");
      const {
        data: receivedAccepted
      } = await sb.from("friend_requests").select("id,from_user_id,to_user_id,status").eq("to_user_id", authUser.id).eq("status", "accepted");
      const fRows = [...(sentAccepted || []), ...(receivedAccepted || [])];
      if (fRows.length > 0) {
        const friendIds = fRows.map(r => r.from_user_id === authUser.id ? r.to_user_id : r.from_user_id);
        // Use SECURITY DEFINER RPC that returns ONLY safe columns (no `log`,
        // no `exercisePBs`, no real name) for accepted friends or pending
        // requests in either direction. See scripts/security/06-extend-friend-rpc.sql.
        const {
          data: pRows
        } = await sb.rpc("get_friend_profiles_safe", {
          p_user_ids: friendIds
        });
        const enriched = friendIds.map(fid => {
          const pRow = (pRows || []).find(p => p.id === fid);
          const reqRow = fRows.find(r => r.from_user_id === fid || r.to_user_id === fid);
          return {
            id: fid,
            playerName: _optionalChain([pRow, 'optionalAccess', _36 => _36.player_name]) || "Unknown Warrior",
            chosenClass: _optionalChain([pRow, 'optionalAccess', _38 => _38.chosen_class]) || null,
            xp: _optionalChain([pRow, 'optionalAccess', _40 => _40.xp]) || 0,
            // log + exercisePBs intentionally omitted — peers shouldn't see them.
            // Recent-activity card and PB banner are deferred to Phase 3b
            // (friend_exercise_events table).
            _reqId: _optionalChain([reqRow, 'optionalAccess', _44 => _44.id]) || null
          };
        });
        setFriends(enriched);
        // Load most-recent exercise event per friend (best-effort — soft-fail
        // when the RPC isn't deployed yet).
        try {
          const {
            data: recentRows
          } = await sb.rpc("get_recent_friend_events", {
            p_limit_per_friend: 1
          });
          if (Array.isArray(recentRows)) {
            const map = {};
            for (const ev of recentRows) {
              if (!map[ev.user_id]) map[ev.user_id] = ev;
            }
            setFriendRecentEvents(map);
          }
        } catch {
          setFriendRecentEvents({});
        }
      } else {
        setFriends([]);
        setFriendRecentEvents({});
      }
      // Incoming pending requests
      const {
        data: rRows
      } = await sb.from("friend_requests").select("id,from_user_id,created_at").eq("to_user_id", authUser.id).eq("status", "pending");
      if (rRows && rRows.length > 0) {
        const senderIds = rRows.map(r => r.from_user_id);
        const {
          data: pRows2
        } = await sb.rpc("get_friend_profiles_safe", {
          p_user_ids: senderIds
        });
        const enriched2 = (rRows || []).map(r => {
          const p = (pRows2 || []).find(x => x.id === r.from_user_id);
          return {
            reqId: r.id,
            userId: r.from_user_id,
            playerName: _optionalChain([p, 'optionalAccess', _46 => _46.player_name]) || "Unknown Warrior"
          };
        });
        setFriendRequests(enriched2);
      } else {
        setFriendRequests([]);
      }
      // Outgoing pending requests
      const {
        data: oRows
      } = await sb.from("friend_requests").select("id,to_user_id,created_at").eq("from_user_id", authUser.id).eq("status", "pending");
      if (oRows && oRows.length > 0) {
        const recipientIds = oRows.map(r => r.to_user_id);
        const {
          data: pRows3
        } = await sb.rpc("get_friend_profiles_safe", {
          p_user_ids: recipientIds
        });
        const enriched3 = oRows.map(r => {
          const p = (pRows3 || []).find(x => x.id === r.to_user_id);
          return {
            reqId: r.id,
            userId: r.to_user_id,
            playerName: _optionalChain([p, 'optionalAccess', _48 => _48.player_name]) || "Unknown Warrior"
          };
        });
        setOutgoingRequests(enriched3);
      } else {
        setOutgoingRequests([]);
      }
    } catch (e) {
      console.error("Social load error", e);
    }
    setSocialLoading(false);
  }
  async function searchFriendByEmail() {
    if (!friendSearch.trim()) return;
    setFriendSearchLoading(true);
    setFriendSearchResult(null);
    setSocialMsg(null);
    try {
      // Use RPC that accepts email OR public Account ID
      const {
        data,
        error
      } = await sb.rpc("find_user_for_friend_request", {
        p_identifier: friendSearch.trim()
      });
      if (error) throw error;
      if (data && data.found) {
        // Check if already friends or request pending
        const {
          data: existing
        } = await sb.from("friend_requests").select("id,status").or(`and(from_user_id.eq.${authUser.id},to_user_id.eq.${data.user_id}),and(from_user_id.eq.${data.user_id},to_user_id.eq.${authUser.id})`).limit(1);
        setFriendSearchResult({
          found: true,
          user: {
            id: data.user_id,
            playerName: data.player_name,
            chosenClass: data.chosen_class,
            publicId: data.public_id
          },
          matchType: data.match_type,
          existing: _optionalChain([existing, 'optionalAccess', _49 => _49[0]]) || null
        });
      } else {
        setFriendSearchResult({
          found: false,
          msg: "No warrior found. Try an email or Account ID (e.g. #A7XK9M)."
        });
      }
    } catch (e) {
      console.error("Friend search error:", e);
      setFriendSearchResult({
        found: false,
        msg: "Search failed. Please try again."
      });
    }
    setFriendSearchLoading(false);
  }
  async function sendFriendRequest(toUserId) {
    if (!authUser) return;
    const {
      error
    } = await sb.from("friend_requests").insert({
      from_user_id: authUser.id,
      to_user_id: toUserId,
      status: "pending"
    });
    if (error) setSocialMsg({
      ok: false,
      text: "Error: " + error.message
    });else {
      setSocialMsg({
        ok: true,
        text: "⚔️ Party Request has been sent!"
      });
      setTimeout(() => setSocialMsg(null), 2000);
      setFriendSearchResult(null);
      setFriendSearch("");
      loadSocialData();
    }
  }
  async function rescindFriendRequest(reqId, userId) {
    await sb.from("friend_requests").delete().eq("id", reqId);
    setFriendSearchResult(r => r ? {
      ...r,
      existing: null
    } : r);
    setOutgoingRequests(o => o.filter(r => r.reqId !== reqId));
    setSocialMsg({
      ok: null,
      text: "Request withdrawn."
    });
    setTimeout(() => setSocialMsg(null), 2000);
  }
  async function acceptFriendRequest(reqId) {
    const {
      error
    } = await sb.from("friend_requests").update({
      status: "accepted"
    }).eq("id", reqId);
    if (!error) {
      // Small delay so Supabase commit is visible before re-fetching
      setTimeout(() => loadSocialData(), 500);
    }
  }
  async function rejectFriendRequest(reqId) {
    await sb.from("friend_requests").delete().eq("id", reqId);
    loadSocialData();
  }
  async function removeFriend(reqId) {
    const {
      error
    } = await sb.from("friend_requests").delete().eq("id", reqId);
    if (!error) {
      setFriends(f => f.filter(fr => fr._reqId !== reqId));
      showToast("Friend removed.");
    } else {
      showToast("Could not remove friend. Try again.");
    }
  }
  async function shareWithFriend(type, item, toUserId, toName) {
    if (!authUser) return;
    try {
      const payload = {
        from_user_id: authUser.id,
        to_user_id: toUserId,
        type,
        item_id: item.id,
        item_data: JSON.stringify(item),
        status: "pending",
        created_at: new Date().toISOString()
      };
      const {
        error
      } = await sb.from("shared_items").insert(payload);
      if (error) throw error;
      showToast(`Shared with ${toName}! ✦`);
      setShareModal(null);
    } catch (e) {
      showToast("Share failed. Try again.");
    }
  }
  async function loadIncomingShares() {
    if (!authUser) return;
    try {
      const {
        data
      } = await sb.from("shared_items").select("id,from_user_id,type,item_id,item_data,created_at").eq("to_user_id", authUser.id).eq("status", "pending");
      if (data && data.length > 0) {
        // Use the share-trust path (not friend-trust): a non-friend can share
        // with you, and we still need to render their name. The RPC scopes by
        // share IDs you've actually received.
        const shareIds = data.map(d => d.id);
        const {
          data: pRows
        } = await sb.rpc("get_share_sender_profiles", {
          p_share_ids: shareIds
        });
        const enriched = data.map(s => ({
          ...s,
          senderName: _optionalChain([pRows || [], 'access', _50 => _50.find, 'call', _51 => _51(p => p.id === s.from_user_id), 'optionalAccess', _53 => _53.player_name]) || "A warrior",
          parsedItem: (() => {
            try {
              return JSON.parse(s.item_data);
            } catch (e) {
              return null;
            }
          })()
        }));
        setIncomingShares(enriched);
      } else {
        setIncomingShares([]);
      }
    } catch (e) {
      console.error("loadIncomingShares error", e);
    }
  }
  async function acceptShare(share) {
    try {
      const item = share.parsedItem;
      if (!item) return;
      if (share.type === "workout") {
        const newWo = {
          ...item,
          id: uid(),
          createdAt: new Date().toLocaleDateString()
        };
        setProfile(p => ({
          ...p,
          workouts: [...(p.workouts || []), newWo]
        }));
        showToast(`💪 "${item.name}" added to your workouts!`);
      } else if (share.type === "exercise") {
        const newEx = {
          ...item,
          id: uid(),
          custom: true
        };
        setProfile(p => ({
          ...p,
          customExercises: [...(p.customExercises || []), newEx]
        }));
        showToast(`⚡ "${item.name}" added to your exercises!`);
      }
      await sb.from("shared_items").update({
        status: "accepted"
      }).eq("id", share.id);
      setIncomingShares(s => s.filter(x => x.id !== share.id));
    } catch (e) {
      showToast("Could not accept share.");
    }
  }
  async function declineShare(shareId) {
    await sb.from("shared_items").update({
      status: "declined"
    }).eq("id", shareId);
    setIncomingShares(s => s.filter(x => x.id !== shareId));
    showToast("Share declined.");
  }
  async function signOut() {
    const prevUserId = _optionalChain([authUser, 'optionalAccess', _signOut1 => _signOut1.id]);
    await sb.auth.signOut();
    // Wipe locally-cached PII so a shared device can't leak data to the next user.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    if (prevUserId) {
      try {
        localStorage.removeItem("aurisar_ob_draft_" + prevUserId);
      } catch (e) {}
    }
    try {
      sessionStorage.removeItem("ilf_no_persist");
    } catch (e) {}
    setIsPreviewMode(false); // signing out always exits preview mode
    setAuthUser(null);
    setProfile(EMPTY_PROFILE);
    // Clear all social state so next user starts fresh
    setSocialMsg(null);
    setFriendSearch("");
    setFriendSearchResult(null);
    setFriends([]);
    setFriendRequests([]);
    setOutgoingRequests([]);
    setIncomingShares([]);
    setLogSubTab("exercises");
    setNotifMode(false);
    setMfaEnabled(false);
    setMfaFactorId(null);
    setMfaEnrolling(false);
    setMfaQR(null);
    setMfaCode("");
    setMfaMsg(null);
    setMfaRecoveryCodes(null);
    setMfaCodesRemaining(null);
    setMfaChallengeScreen(false);
    setMfaChallengeCode("");
    setMfaChallengeMsg(null);
    setMfaRecoveryMode(false);
    setMfaRecoveryInput("");
    setMfaChallengeFactorId(null);
    setMfaDisableConfirm(false);
    setMfaDisableCode("");
    setMfaDisableMsg(null);
    setPhonePanelOpen(false);
    setPhoneInput("");
    setPhoneOtpSent(false);
    setPhoneOtpCode("");
    setPhoneMsg(null);
    setEmailPanelOpen(false);
    setEmailMsg(null);
    setNewEmail("");
    setScreen("landing");
  }

  // ── Legacy class migration — maps old keys to new equivalents ──
  const CLASS_MIGRATION = {
    ranger: "warden",
    monk: "druid",
    mage: "druid",
    paladin: "warlord",
    rogue: "phantom",
    berserker: "gladiator",
    valkyrie: "gladiator"
  };
  const resolveClass = key => {
    if (!key) return null;
    if (CLASSES[key]) return key;
    return CLASS_MIGRATION[key] || "warrior";
  };
  const rawClass = profile.chosenClass;
  const clsKey = resolveClass(rawClass);
  const cls = CLASSES[clsKey] || CLASSES["warrior"];
  const level = xpToLevel(profile.xp);
  const curXP = xpForLevel(level);
  const nxtXP = xpForNext(level);
  const progress = (profile.xp - curXP) / (nxtXP - curXP) * 100;
  const totalH = (parseInt(profile.heightFt) || 0) * 12 + (parseInt(profile.heightIn) || 0);
  const bmi = calcBMI(profile.weightLbs, totalH);

  // Merged exercise list (built-in + custom) — memoized to avoid rebuilding on every render
  const _customExRef = profile.customExercises;
  // _allExercisesIncludingAliases keeps duplicate-form imports (e.g. dumbbell-lunges)
  // so user logs that reference legacy IDs still resolve via allExById. The picker-
  // facing allExercises filters them out so each exercise appears once.
  const _allExercisesIncludingAliases = useMemo(() => [...EXERCISES, ...(_customExRef || [])].filter(e => e && e.id && e.name), [_customExRef, _exReady]);
  const allExById = useMemo(() => Object.fromEntries(_allExercisesIncludingAliases.map(e => [e.id, e])), [_allExercisesIncludingAliases]);
  const allExercises = useMemo(() => _allExercisesIncludingAliases.filter(e => !e.alias), [_allExercisesIncludingAliases]);
  const wbTotalXP = useMemo(() => wbExercises.reduce((s, ex) => {
    const extraCount = (ex.extraRows || []).length;
    const b = calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById, null, null, null, extraCount);
    const r = (ex.extraRows || []).reduce((rs, row) => rs + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, null, null, extraCount), 0);
    return s + (b + r);
  }, 0), [wbExercises, profile.chosenClass, allExById]);

  // Auto-update quest completion state when log or streak changes
  const computedQuests = () => {
    const updated = {
      ...(profile.quests || {})
    };
    QUESTS.forEach(q => {
      if (_optionalChain([updated, 'access', _54 => _54[q.id], 'optionalAccess', _55 => _55.completed])) return; // already done
      const done = checkQuestCompletion(q, profile.log, profile.checkInStreak);
      if (done) updated[q.id] = {
        ...(updated[q.id] || {}),
        completed: true,
        completedAt: todayStr()
      };
    });
    return updated;
  };
  function claimQuestReward(qId) {
    const q = QUESTS.find(x => x.id === qId);
    if (!q) return;
    const qState = profile.quests[qId] || {};
    if (qState.claimed) return;
    const newQuests = {
      ...profile.quests,
      [qId]: {
        ...qState,
        completed: true,
        completedAt: todayStr(),
        claimed: true
      }
    };
    setProfile(p => ({
      ...p,
      xp: p.xp + q.xp,
      quests: newQuests
    }));
    setXpFlash({
      amount: q.xp,
      mult: 1
    });
    setTimeout(() => setXpFlash(null), 2200);
    showToast(`Quest complete! ${formatXP(q.xp, {
      signed: true
    })} ✦`);
  }
  function claimManualQuest(qId) {
    const q = QUESTS.find(x => x.id === qId);
    if (!q || !q.manual) return;
    const qState = profile.quests[qId] || {};
    if (qState.completed) return;
    const newQuests = {
      ...profile.quests,
      [qId]: {
        completed: true,
        completedAt: todayStr(),
        claimed: false
      }
    };
    setProfile(p => ({
      ...p,
      quests: newQuests
    }));
    showToast("Quest unlocked! Claim your reward.");
  }

  // Jack in
  // Rebuild streak + lastCheckIn from a sorted list of unique YYYY-MM-DD check-in dates
  function rebuildStreakFromHistory(history) {
    if (!history || history.length === 0) return {
      checkInStreak: 0,
      lastCheckIn: null,
      totalCheckIns: 0
    };
    const sorted = [...new Set(history)].sort(); // ascending, deduplicated
    const last = sorted[sorted.length - 1];
    // Walk backwards from the last date to count consecutive days
    let streak = 1;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const curr = new Date(sorted[i + 1] + "T12:00:00");
      const prev = new Date(sorted[i] + "T12:00:00");
      const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diff === 1) streak++;else break;
    }
    return {
      checkInStreak: streak,
      lastCheckIn: last,
      totalCheckIns: sorted.length
    };
  }
  function doCheckIn() {
    const today = todayStr();
    const history = [...(profile.checkInHistory || [])];
    if (history.includes(today)) {
      showToast("Already checked in today!");
      return;
    }
    history.push(today);
    const {
      checkInStreak: newStreak,
      lastCheckIn,
      totalCheckIns: newTotal
    } = rebuildStreakFromHistory(history);
    const xpEarned = newStreak % 7 === 0 ? 500 : 125;
    const newQuests = {
      ...profile.quests
    };
    QUESTS.filter(q => q.streak).forEach(q => {
      if (!_optionalChain([newQuests, 'access', _56 => _56[q.id], 'optionalAccess', _57 => _57.completed]) && newStreak >= q.streak) newQuests[q.id] = {
        completed: true,
        completedAt: today,
        claimed: false
      };
    });
    setProfile(p => ({
      ...p,
      lastCheckIn,
      checkInStreak: newStreak,
      totalCheckIns: newTotal,
      checkInHistory: history,
      xp: p.xp + xpEarned,
      quests: newQuests
    }));
    setXpFlash({
      amount: xpEarned,
      mult: 1
    });
    setTimeout(() => setXpFlash(null), 2000);
    showToast(`Checked in! +${xpEarned} XP · ${newStreak} day streak 🔥`);
  }
  function applyAutoCheckIn(base, dateKey) {
    const today = todayStr();
    if (dateKey !== today) return {
      profile: base,
      checkInApplied: false,
      checkInXP: 0,
      checkInStreak: base.checkInStreak || 0
    };
    if ((base.checkInHistory || []).includes(today)) return {
      profile: base,
      checkInApplied: false,
      checkInXP: 0,
      checkInStreak: base.checkInStreak || 0
    };
    const history = [...(base.checkInHistory || []), today];
    const {
      checkInStreak,
      lastCheckIn,
      totalCheckIns
    } = rebuildStreakFromHistory(history);
    const xpEarned = checkInStreak % 7 === 0 ? 500 : 125;
    const quests = {
      ...(base.quests || {})
    };
    QUESTS.filter(q => q.streak).forEach(q => {
      if (!_optionalChain([quests, 'access', _ => _[q.id], 'optionalAccess', _ => _.completed]) && checkInStreak >= q.streak) quests[q.id] = {
        completed: true,
        completedAt: today,
        claimed: false
      };
    });
    return {
      profile: {
        ...base,
        lastCheckIn,
        checkInStreak,
        totalCheckIns,
        checkInHistory: history,
        xp: base.xp + xpEarned,
        quests
      },
      checkInApplied: true,
      checkInXP: xpEarned,
      checkInStreak
    };
  }
  function doRetroCheckIn() {
    if (!retroDate) {
      showToast("Pick a date first!");
      return;
    }
    if (retroDate > todayStr()) {
      showToast("Can't check in for a future date!");
      return;
    }
    const history = [...(profile.checkInHistory || [])];
    if (history.includes(retroDate)) {
      showToast("Already checked in for that day!");
      return;
    }
    history.push(retroDate);
    const {
      checkInStreak: newStreak,
      lastCheckIn,
      totalCheckIns: newTotal
    } = rebuildStreakFromHistory(history);
    const newQuests = {
      ...profile.quests
    };
    QUESTS.filter(q => q.streak).forEach(q => {
      if (!_optionalChain([newQuests, 'access', _58 => _58[q.id], 'optionalAccess', _59 => _59.completed]) && newStreak >= q.streak) newQuests[q.id] = {
        completed: true,
        completedAt: todayStr(),
        claimed: false
      };
    });
    setProfile(p => ({
      ...p,
      lastCheckIn,
      checkInStreak: newStreak,
      totalCheckIns: newTotal,
      checkInHistory: history,
      xp: p.xp + 125,
      quests: newQuests
    }));
    setXpFlash({
      amount: 125,
      mult: 1
    });
    setTimeout(() => setXpFlash(null), 2000);
    const d = new Date(retroDate + "T12:00:00");
    showToast("Retro check-in for " + d.toLocaleDateString([], {
      month: "short",
      day: "numeric"
    }) + "! +125 XP · " + newStreak + " day streak 🔥");
    setRetroDate("");
    setRetroCheckInModal(false);
  }

  // Onboarding
  function handleOnboard() {
    if (!obName.trim() || !obFirstName.trim() || !obLastName.trim()) return;
    const cls = detectClassFromAnswers(obSports, obPriorities, obStyle);
    const trait = obTiming === "earlymorning" ? "Iron Discipline" : obTiming === "morning" ? "Disciplined" : obTiming === "evening" ? "Night Owl" : "";
    setProfile(p => ({
      ...p,
      playerName: obName,
      firstName: obFirstName,
      lastName: obLastName,
      age: obAge,
      gender: obGender,
      state: obState,
      country: obCountry,
      sportsBackground: obSports,
      fitnessPriorities: obPriorities,
      trainingStyle: obStyle,
      workoutTiming: obTiming,
      workoutFreq: obFreq,
      disciplineTrait: trait
    }));
    setDetectedClass(cls);
    setScreen("classReveal");
  }
  function confirmClass(c) {
    try {
      if (authUser) localStorage.removeItem("aurisar_ob_draft_" + authUser.id);
    } catch (e) {}
    const p = {
      ...profile,
      chosenClass: c
    };
    setProfile(p);
    doSave(p, _optionalChain([authUser, 'optionalAccess', _60 => _60.id]) || null, _optionalChain([authUser, 'optionalAccess', _61 => _61.email]) || null);
    setScreen("main");
  }

  // Quick log
  function getMult(ex) {
    return clsKey ? CLASSES[clsKey]?.bonuses[ex.category] || 1 : 1;
  }

  // ── Exercise editor ─────────────────────────────────────────
  const EX_ICON_LIST = ["🏋️", "💪", "⚡", "🦾", "🪃", "🏃", "🚴", "🔥", "⭕", "🧘", "🤸", "🧱", "🪝", "🏊", "🔻", "🦵", "🚶", "🧗", "🎯", "🏌️", "⛹️", "🤼", "🏇", "🥊", "🤺", "🏋", "🦶", "🫀", "🧠", "🛌", "💤", "🌙", "☕", "🧊", "🏖️"];
  function newExDraft(base) {
    return {
      id: uid(),
      name: base ? base.name + " (Copy)" : "",
      icon: base ? base.icon : "💪",
      category: base ? base.category : "strength",
      muscleGroup: base ? base.muscleGroup : "chest",
      baseXP: base ? base.baseXP : 40,
      muscles: base ? base.muscles : "",
      desc: base ? base.desc : "",
      tips: base ? [...base.tips] : ["", "", ""],
      custom: true,
      defaultSets: base ? base.defaultSets != null ? base.defaultSets : null : 3,
      defaultReps: base ? base.defaultReps != null ? base.defaultReps : null : 10,
      defaultWeightLbs: base ? base.defaultWeightLbs || "" : "",
      defaultWeightPct: base ? base.defaultWeightPct || 100 : 100,
      defaultHrZone: base ? base.defaultHrZone || null : null
    };
  }
  function openExEditor(mode, baseEx) {
    setExEditorMode(mode);
    setExEditorDraft(newExDraft(mode === "create" ? null : baseEx));
    setExEditorOpen(true);
  }
  function saveExEditor() {
    const d = exEditorDraft;
    if (!d.name.trim()) {
      showToast("Exercise needs a name!");
      return;
    }
    if (exEditorMode === "edit") {
      const updated = (profile.customExercises || []).map(e => e.id === d.id ? {
        ...d
      } : e);
      setProfile(p => ({
        ...p,
        customExercises: updated
      }));
    } else {
      const newEx = {
        ...d,
        id: uid()
      };
      setProfile(p => ({
        ...p,
        customExercises: [...(p.customExercises || []), newEx]
      }));
    }
    setExEditorOpen(false);
    showToast(exEditorMode === "edit" ? "Exercise patched! ⚡" : "New exercise uploaded! ⚡");
  }
  function deleteCustomEx(id) {
    const ex = (profile.customExercises || []).find(e => e.id === id);
    setConfirmDelete({
      type: "exercise",
      id,
      name: ex ? ex.name : "this exercise",
      icon: ex ? ex.icon : "💪"
    });
  }
  function _doDeleteCustomEx(id) {
    setProfile(p => ({
      ...p,
      customExercises: (p.customExercises || []).filter(e => e.id !== id)
    }));
    setExEditorOpen(false);
    showToast("Exercise deleted.");
  }
  function logExercise() {
    if (!selEx) return;
    const ex = allExById[selEx];
    if (!ex) return;
    const metric = isMetric(profile.units);
    const noSetsEx = NO_SETS_EX_IDS.has(ex.id);
    const mult = getMult(ex),
      rv = parseInt(reps) || 0,
      sv = noSetsEx ? 1 : parseInt(sets) || 0;
    // Convert weight to lbs for internal storage/XP (weight input already reflects intensity)
    const rawW = parseFloat(exWeight || 0);
    const weightInLbs = metric ? parseFloat(kgToLbs(rawW)) : rawW;
    const effectiveW = weightInLbs;
    // Convert distance to miles for storage
    const rawDist = parseFloat(distanceVal || 0);
    const distMi = rawDist > 0 ? metric ? parseFloat(kmToMi(rawDist)) : rawDist : null;
    const isCardioEx = ex.category === "cardio";
    const canHaveZone = isCardioEx;
    const runPace = ex.id === RUNNING_EX_ID && distMi && rv ? rv / distMi : null;
    const earned = calcExXP(ex.id, sv, rv, profile.chosenClass, allExById, distMi || null, effectiveW || null, canHaveZone ? hrZone : null);
    // Apply 10% travel boost if active this week
    const weekStart = () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    };
    const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart();
    // Apply 7% region boost if exercise matches current region's muscle group
    const myRegionIdx = getRegionIdx(xpToLevel(profile.xp));
    const myRegion = MAP_REGIONS[myRegionIdx];
    const regionBoost = myRegion && (myRegion.boost.muscle === "all" || myRegion.boost.muscle === ex.muscleGroup) ? 1.07 : 1;
    const travelMult = travelActive ? 1.1 : 1;
    const finalEarned = Math.round(earned * travelMult * regionBoost);
    // Capture current state values before clearing UI
    const capturedPendingSoloRemoveId = pendingSoloRemoveId;
    const capturedHrZone = canHaveZone && hrZone || null;
    // Show stats popup, then completion modal for Complete/Schedule
    const synth = {
      name: ex.name,
      icon: ex.icon,
      exercises: [],
      durationMin: null,
      activeCal: null,
      totalCal: null,
      soloEx: true,
      _soloExId: ex.id
    };
    openStatsPromptIfNeeded(synth, (woWithStats, _sr) => {
      const soloExCallback = dateStr => {
        const dateObj = new Date(dateStr + "T12:00:00");
        const displayDate = dateObj.toLocaleDateString();
        const entry = {
          exercise: ex.name,
          icon: ex.icon,
          xp: finalEarned,
          mult,
          reps: rv,
          sets: sv,
          weightLbs: effectiveW || null,
          weightPct,
          hrZone: capturedHrZone,
          distanceMi: distMi || null,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          }),
          date: displayDate,
          dateKey: dateStr,
          exId: ex.id,
          sourceTotalCal: woWithStats.totalCal || null,
          sourceActiveCal: woWithStats.activeCal || null,
          sourceDurationSec: woWithStats.durationMin || null
        };
        const newLog = [entry, ...profile.log];
        const newQuests = {
          ...(profile.quests || {})
        };
        QUESTS.filter(q => q.auto && !_optionalChain([newQuests, 'access', _62 => _62[q.id], 'optionalAccess', _63 => _63.completed])).forEach(q => {
          if (checkQuestCompletion(q, newLog, profile.checkInStreak)) newQuests[q.id] = {
            completed: true,
            completedAt: todayStr(),
            claimed: false
          };
        });
        let newPB = profile.runningPB || null;
        if (runPace && (!newPB || runPace < newPB)) newPB = runPace;
        const newExPBs = calcExercisePBs(newLog);
        const oldPB = (profile.exercisePBs || {})[entry.exId];
        const curPB = newExPBs[entry.exId];
        const isNewPB = curPB && (!oldPB || curPB.value !== oldPB.value);
        let _ciResult = {
          checkInApplied: false,
          checkInXP: 0,
          checkInStreak: 0
        };
        setProfile(p => {
          const base = {
            ...p,
            xp: p.xp + finalEarned,
            log: newLog,
            quests: newQuests,
            runningPB: newPB !== null ? newPB : p.runningPB,
            exercisePBs: newExPBs
          };
          if (capturedPendingSoloRemoveId) base.scheduledWorkouts = (p.scheduledWorkouts || []).filter(s => s.id !== capturedPendingSoloRemoveId);
          const ci = applyAutoCheckIn(base, dateStr);
          _ciResult = ci;
          return ci.profile;
        });
        if (capturedPendingSoloRemoveId) setPendingSoloRemoveId(null);
        setXpFlash({
          amount: finalEarned + _ciResult.checkInXP,
          mult,
          travel: travelActive
        });
        setTimeout(() => setXpFlash(null), 2000);
        const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
        if (newPB !== null && newPB === runPace && (!profile.runningPB || runPace < profile.runningPB)) showToast(`🏆 New Personal Best! ${metric ? parseFloat((runPace * 1.60934).toFixed(2)) + " min/km" : parseFloat(runPace.toFixed(2)) + " min/mi"}${ciSuffix}`);else if (isNewPB && curPB.type === "strength") showToast(`🏆 New 1RM! ${ex.name} — ${curPB.value} lbs${ciSuffix}`);else if (isNewPB && curPB.type === "assisted") showToast(`🏆 New 1RM! ${ex.name} — ${curPB.value} lbs (assisted PR)${ciSuffix}`);else showToast((travelActive && regionBoost > 1 ? `+${finalEarned} XP (+10% travel, +7% ${myRegion.boost.label}) ⚔️` : travelActive ? `+${finalEarned} XP (+10% travel bonus) ⚔️` : regionBoost > 1 ? `+${finalEarned} XP (+7% ${myRegion.boost.label} boost) ${myRegion.icon}` : `+${finalEarned} XP earned!`) + ciSuffix);
        // Clean up form state after successful completion
        setSets("");
        setReps("");
        setExWeight("");
        setWeightPct(100);
        setHrZone(null);
        setDistanceVal("");
        setExHHMM("");
        setExSec("");
        setQuickRows([]);
      };
      const soloExScheduleCallback = schedDate => {
        const sw = {
          id: uid(),
          exId: ex.id,
          scheduledDate: schedDate,
          notes: ex.name,
          createdAt: todayStr()
        };
        setProfile(p => ({
          ...p,
          scheduledWorkouts: [...(p.scheduledWorkouts || []), sw]
        }));
        setCompletionModal(null);
        setCompletionDate("");
        setCompletionAction("today");
        setScheduleWoDate("");
        showToast(`📅 ${ex.name} scheduled for ${formatScheduledDate(schedDate)}!`);
        // Clean up form state
        setSets("");
        setReps("");
        setExWeight("");
        setWeightPct(100);
        setHrZone(null);
        setDistanceVal("");
        setExHHMM("");
        setExSec("");
        setQuickRows([]);
      };
      setCompletionModal({
        workout: woWithStats,
        fromStats: _sr,
        soloExCallback,
        soloExScheduleCallback
      });
      setCompletionDate(todayStr());
      setCompletionAction("today");
    });
    setSelEx(null);
  }

  // Log a scheduled solo exercise with default values and remove it from schedule (shows stats popup first)
  function quickLogSoloEx(sw) {
    const ex = allExById[sw.exId];
    if (!ex) return;
    const noSetsEx = NO_SETS_EX_IDS.has(ex.id);
    const sv = noSetsEx ? 1 : ex.defaultSets != null ? ex.defaultSets : 3;
    const rv = ex.defaultReps != null ? ex.defaultReps : 10;
    const mult = getMult(ex);
    const earned = calcExXP(ex.id, sv, rv, profile.chosenClass, allExById);
    const weekStart = () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    };
    const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart();
    const myRegionIdx = getRegionIdx(xpToLevel(profile.xp));
    const myRegion = MAP_REGIONS[myRegionIdx];
    const regionBoost = myRegion && (myRegion.boost.muscle === "all" || myRegion.boost.muscle === ex.muscleGroup) ? 1.07 : 1;
    const finalEarned = Math.round(earned * (travelActive ? 1.1 : 1) * regionBoost);
    // Show stats popup, then log on confirm
    const synth = {
      name: ex.name,
      icon: ex.icon,
      exercises: [],
      durationMin: null,
      activeCal: null,
      totalCal: null,
      soloEx: true
    };
    openStatsPromptIfNeeded(synth, woWithStats => {
      const entry = {
        exercise: ex.name,
        icon: ex.icon,
        xp: finalEarned,
        mult,
        reps: rv,
        sets: sv,
        weightLbs: null,
        weightPct: 100,
        hrZone: null,
        distanceMi: null,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        }),
        date: new Date().toLocaleDateString(),
        dateKey: todayStr(),
        exId: ex.id,
        sourceTotalCal: woWithStats.totalCal || null,
        sourceActiveCal: woWithStats.activeCal || null,
        sourceDurationSec: woWithStats.durationMin || null
      };
      const newQuests = {
        ...(profile.quests || {})
      };
      QUESTS.filter(q => q.auto && !_optionalChain([newQuests, 'access', _62 => _62[q.id], 'optionalAccess', _63 => _63.completed])).forEach(q => {
        if (checkQuestCompletion(q, [entry, ...profile.log], profile.checkInStreak)) newQuests[q.id] = {
          completed: true,
          completedAt: todayStr(),
          claimed: false
        };
      });
      const newLog = [entry, ...profile.log];
      const newExPBs = calcExercisePBs(newLog);
      let _ciResult = {
        checkInApplied: false,
        checkInXP: 0,
        checkInStreak: 0
      };
      setProfile(p => {
        const base = {
          ...p,
          xp: p.xp + finalEarned,
          log: [entry, ...p.log],
          quests: newQuests,
          exercisePBs: newExPBs,
          scheduledWorkouts: (p.scheduledWorkouts || []).filter(s => s.id !== sw.id)
        };
        const ci = applyAutoCheckIn(base, todayStr());
        _ciResult = ci;
        return ci.profile;
      });
      const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
      setXpFlash({
        amount: finalEarned + _ciResult.checkInXP,
        mult,
        travel: travelActive
      });
      setTimeout(() => setXpFlash(null), 2000);
      showToast((travelActive && regionBoost > 1 ? `+${finalEarned} XP (+10% travel, +7% ${myRegion.boost.label}) ⚔️` : travelActive ? `+${finalEarned} XP (+10% travel bonus) ⚔️` : regionBoost > 1 ? `+${finalEarned} XP (+7% ${myRegion.boost.label} boost) ${myRegion.icon}` : `+${finalEarned} XP earned!`) + ciSuffix);
    });
  }

  // Save a set of log entries (from history) as a custom plan template
  // Open "Save To Plan" wizard from history (renamed from Save as Plan)
  function openSavePlanWizard(entries, label) {
    setSavePlanWizard({
      entries,
      label
    });
    setSpwName(label + " Repeat");
    setSpwIcon("📋");
    setSpwDate("");
    setSpwSelected(entries.map(e => e._idx)); // all pre-selected
    setSpwMode("new");
    setSpwTargetPlanId(null);
  }
  function confirmSavePlanWizard() {
    if (!savePlanWizard) return;
    const selected = savePlanWizard.entries.filter(e => spwSelected.includes(e._idx));
    if (selected.length === 0) {
      showToast("Select at least one exercise.");
      return;
    }
    const exRows = selected.map(e => ({
      exId: e.exId || "bench",
      sets: e.sets || 3,
      reps: e.reps || 10,
      weightLbs: e.weightLbs || null
    }));
    if (spwMode === "existing") {
      if (!spwTargetPlanId) {
        showToast("Pick a plan to add to!");
        return;
      }
      const targetPlan = profile.plans.find(p => p.id === spwTargetPlanId);
      if (!targetPlan) {
        showToast("Plan not found.");
        return;
      }
      const newDay = {
        label: "Added " + savePlanWizard.label,
        exercises: exRows
      };
      const updatedPlan = {
        ...targetPlan,
        days: [...targetPlan.days, newDay]
      };
      setProfile(pr => ({
        ...pr,
        plans: pr.plans.map(p => p.id === spwTargetPlanId ? updatedPlan : p)
      }));
      setSavePlanWizard(null);
      showToast("Added to " + targetPlan.name + " ⚔️");
    } else {
      if (!spwName.trim()) {
        showToast("Give your plan a name!");
        return;
      }
      const days = [{
        label: "Day 1",
        exercises: exRows
      }];
      const p = {
        id: uid(),
        name: spwName.trim(),
        icon: spwIcon,
        type: "day",
        description: "Saved from " + savePlanWizard.label,
        bestFor: [],
        days,
        createdAt: new Date().toLocaleDateString(),
        custom: true,
        scheduledDate: spwDate || null
      };
      setProfile(pr => ({
        ...pr,
        plans: [p, ...pr.plans]
      }));
      setSavePlanWizard(null);
      showToast("Contract saved! ⚡" + (spwDate ? " · Scheduled for " + formatScheduledDate(spwDate) : ""));
    }
  }

  // Open "Save As Workout" wizard from history
  function openSaveWorkoutWizard(entries, label) {
    setSaveWorkoutWizard({
      entries,
      label
    });
    setSwwName(label);
    setSwwIcon("💪");
    setSwwSelected(entries.map(e => e._idx));
  }
  function confirmSaveWorkoutWizard() {
    if (!saveWorkoutWizard) return;
    if (!swwName.trim()) {
      showToast("Give your workout a name!");
      return;
    }
    const selected = saveWorkoutWizard.entries.filter(e => swwSelected.includes(e._idx));
    if (selected.length === 0) {
      showToast("Select at least one exercise.");
      return;
    }
    const exercises = selected.map(e => ({
      exId: e.exId || "bench",
      sets: e.sets || 3,
      reps: e.reps || 10,
      weightLbs: e.weightLbs || null,
      durationMin: null
    }));
    const w = {
      id: uid(),
      name: swwName.trim(),
      icon: swwIcon,
      desc: "Saved from " + saveWorkoutWizard.label,
      exercises,
      createdAt: new Date().toLocaleDateString()
    };
    setProfile(pr => ({
      ...pr,
      workouts: [w, ...(pr.workouts || [])]
    }));
    setSaveWorkoutWizard(null);
    showToast(swwIcon + " " + swwName + " saved to Workouts! 💪");
  }

  // Workout builder helpers
  function initWorkoutBuilder(base) {
    setWbIconPickerOpen(false);
    if (base) {
      setWbName(base.name);
      setWbIcon(base.icon);
      setWbDesc(base.desc || "");
      setWbExercises(base.exercises.map(e => ({
        ...e
      })));
      setWbEditId(base.id);
      const split = base.durationMin ? secToHHMMSplit(Number(base.durationMin)) : {
        hhmm: "",
        sec: ""
      };
      const hasSec = split.sec && split.sec !== 0 && split.sec !== "";
      setWbDuration(hasSec ? `${split.hhmm}:${String(split.sec).padStart(2,"0")}` : (split.hhmm || ""));
      setWbDurSec("");
      setWbActiveCal(base.activeCal || "");
      setWbTotalCal(base.totalCal || "");
      setWbLabels(base.labels || []);
    } else {
      setWbName("");
      setWbIcon("💪");
      setWbDesc("");
      setWbExercises([]);
      setWbEditId(null);
      setWbDuration("");
      setWbDurSec("");
      setWbActiveCal("");
      setWbTotalCal("");
      setWbLabels([]);
    }
    setWbIsOneOff(false);
    setNewLabelInput("");
    setWorkoutView("builder");
  }
  function saveBuiltWorkout() {
    if (!wbName.trim()) {
      showToast("Name your workout first!");
      return;
    }
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const w = {
      id: wbEditId || uid(),
      name: wbName.trim(),
      icon: wbIcon,
      desc: wbDesc.trim(),
      exercises: wbExercises,
      createdAt: new Date().toLocaleDateString(),
      durationMin: combineHHMMSec(wbDuration, wbDurSec) || null,
      activeCal: wbActiveCal || null,
      totalCal: wbTotalCal || null,
      labels: wbLabels
    };
    if (wbEditId) {
      setProfile(pr => ({
        ...pr,
        workouts: (pr.workouts || []).map(wo => wo.id === wbEditId ? w : wo)
      }));
      showToast("Workout updated! 💪");
    } else {
      setProfile(pr => ({
        ...pr,
        workouts: [w, ...(pr.workouts || [])]
      }));
      showToast("Workout created! 💪");
    }
    setWorkoutView("list");
    setActiveWorkout(null);
    setWbEditId(null);
    setWbCopySource(null);
    setWbDuration("");
    setWbDurSec("");
    setWbActiveCal("");
    setWbTotalCal("");
    setWbLabels([]);
    setNewLabelInput("");
  }
  function saveAsNewWorkout() {
    if (!wbName.trim()) {
      showToast("Name your workout first!");
      return;
    }
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const w = {
      id: uid(),
      name: wbName.trim(),
      icon: wbIcon,
      desc: wbDesc.trim(),
      exercises: wbExercises,
      createdAt: new Date().toLocaleDateString(),
      durationMin: combineHHMMSec(wbDuration, wbDurSec) || null,
      activeCal: wbActiveCal || null,
      totalCal: wbTotalCal || null,
      labels: wbLabels
    };
    setProfile(pr => ({
      ...pr,
      workouts: [w, ...(pr.workouts || [])]
    }));
    showToast("Saved as new workout! 💪");
    setWorkoutView("list");
    setActiveWorkout(null);
    setWbEditId(null);
    setWbCopySource(null);
    setWbDuration("");
    setWbDurSec("");
    setWbActiveCal("");
    setWbTotalCal("");
    setWbLabels([]);
    setNewLabelInput("");
  }
  function copyWorkout(wo) {
    setWbName("Copy of " + wo.name);
    setWbIcon(wo.icon);
    setWbDesc(wo.desc || "");
    setWbExercises(wo.exercises.map(e => ({
      ...e
    })));
    setWbEditId(null); // new id on save
    setWbCopySource(wo.name);
    setWbLabels(wo.labels || []);
    setNewLabelInput("");
    setWorkoutView("builder");
  }
  function deleteWorkout(id) {
    const wo = (profile.workouts || []).find(w => w.id === id);
    setConfirmDelete({
      type: "workout",
      id,
      name: wo ? wo.name : "this workout",
      icon: wo ? wo.icon : "💪"
    });
  }
  function _doDeleteWorkout(id) {
    const wo = (profile.workouts || []).find(w => w.id === id);
    if (!wo) return;
    const bin = [...(profile.deletedItems || []), {
      id: uid(),
      type: "workout",
      item: wo,
      deletedAt: new Date().toISOString()
    }];
    setProfile(p => ({
      ...p,
      workouts: (p.workouts || []).filter(w => w.id !== id),
      deletedItems: bin
    }));
    setWorkoutView("list");
    setActiveWorkout(null);
    showToast("Workout moved to Deleted — recoverable for 7 days.");
  }
  function addExToWorkout(exId) {
    const exd = allExById[exId] || {};
    setWbExercises(ex => [...ex, {
      exId,
      sets: exd.defaultSets != null ? exd.defaultSets : 3,
      reps: exd.defaultReps != null ? exd.defaultReps : 10,
      weightLbs: exd.defaultWeightLbs || null,
      durationMin: exd.defaultDurationMin || null,
      weightPct: exd.defaultWeightPct || 100,
      distanceMi: exd.defaultDistanceMi || null,
      hrZone: exd.defaultHrZone || null
    }]);
    setWbExPickerOpen(false);
  }
  function closePicker() {
    setWbExPickerOpen(false);
    setPickerSearch("");
    setPickerMuscle("All");
    setPickerMuscleOpen(false);
    setPickerTypeFilter("all");
    setPickerEquipFilter("all");
    setPickerOpenDrop(null);
    setPickerSelected([]);
    setPickerConfigOpen(false);
  }
  function pickerToggleEx(exId) {
    const exd = allExById[exId] || {};
    setPickerSelected(prev => {
      const exists = prev.find(e => e.exId === exId);
      if (exists) return prev.filter(e => e.exId !== exId);
      return [...prev, {
        exId,
        sets: "3",
        reps: "10",
        weightLbs: "",
        weightPct: 100,
        durationMin: "",
        distanceMi: "",
        hrZone: null
      }];
    });
  }
  function pickerUpdateEx(exId, field, val) {
    setPickerSelected(prev => prev.map(e => e.exId === exId ? {
      ...e,
      [field]: val
    } : e));
  }
  function commitPickerToWorkout() {
    if (pickerSelected.length === 0) return;
    setWbExercises(ex => [...ex, ...pickerSelected.map(e => ({
      ...e,
      sets: e.sets || "",
      reps: e.reps || "",
      weightLbs: e.weightLbs || null,
      durationMin: e.durationMin || null,
      distanceMi: e.distanceMi || null
    }))]);
    closePicker();
  }
  function updateWbEx(idx, field, val) {
    setWbExercises(exs => exs.map((e, i) => i === idx ? {
      ...e,
      [field]: val
    } : e));
  }
  /* ── Render exercise body fields (used by solo rows and accordion sections) ── */
  function renderWbExFields(ex, idx, exD) {
    const _isC = exD.category === "cardio";
    const _isF = exD.category === "flexibility";
    const _showW = !_isC && !_isF;
    const _noSets = NO_SETS_EX_IDS.has(exD.id);
    const _isRunning = exD.id === RUNNING_EX_ID;
    const _isTread = exD.hasTreadmill || false;
    const _metric = isMetric(profile.units);
    const _wUnit = weightLabel(profile.units);
    const _dUnit = distLabel(profile.units);
    const _age = profile.age || 30;
    const _distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
    const _durMin = parseFloat(ex.reps || 0);
    const _runPace = _isRunning && _distMiVal > 0 && _durMin > 0 ? _durMin / _distMiVal : null;
    const _runBoost = _runPace ? _runPace <= 8 ? 20 : 5 : 0;
    const _dispW = ex.weightLbs ? _metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
    const _dispDist = ex.distanceMi ? _metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi) : "";
    return <><div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s6
      }}>{!_noSets && <div style={{
          flex: 1
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Sets"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "6px 8px"
          }} type={"text"} inputMode={"decimal"} value={ex.sets === 0 || ex.sets === "" ? "" : ex.sets || ""} onChange={e => updateWbEx(idx, "sets", e.target.value)} /></div>}{_isC || _isF ? <><div style={{
            flex: 1.6,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Duration (HH:MM)"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"numeric"} value={ex._durHHMM !== undefined ? ex._durHHMM : ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps ? "00:" + String(ex.reps).padStart(2, "0") : ""} onChange={e => updateWbEx(idx, "_durHHMM", e.target.value)} onBlur={e => {
              const h = normalizeHHMM(e.target.value);
              updateWbEx(idx, "_durHHMM", h || undefined);
              const s = combineHHMMSec(h, ex._durSecRaw || ex.durationSec ? secToHHMMSplit(ex.durationSec || 0).sec : "");
              updateWbEx(idx, "durationSec", s);
              if (s) updateWbEx(idx, "reps", Math.max(1, Math.floor(s / 60)));
            }} placeholder={"00:00"} /></div><div style={{
            flex: 0.9,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Sec"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px",
              textAlign: "center"
            }} type={"number"} min={"0"} max={"59"} value={ex._durSecRaw !== undefined ? String(ex._durSecRaw).padStart(2, "0") : ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2, "0") : ""} onChange={e => {
              const v = e.target.value;
              updateWbEx(idx, "_durSecRaw", v);
              const h2 = ex._durHHMM || (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : "");
              const s2 = combineHHMMSec(h2, v);
              updateWbEx(idx, "durationSec", s2);
              if (s2) updateWbEx(idx, "reps", Math.max(1, Math.floor(s2 / 60)));
            }} placeholder={"00"} /></div><div style={{
            flex: 1.4,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Dist ("}{_dUnit}{")"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} value={_dispDist} onChange={e => {
              const v = e.target.value;
              const mi = v && _metric ? kmToMi(v) : v;
              updateWbEx(idx, "distanceMi", mi || null);
            }} placeholder={"0"} /></div></> : <><div style={{
            flex: 1,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Reps"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "6px 8px"
            }} type={"text"} inputMode={"decimal"} value={ex.reps === 0 || ex.reps === "" ? "" : ex.reps || ""} onChange={e => updateWbEx(idx, "reps", e.target.value)} /></div>{_showW && <div style={{
            flex: 1.2,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Weight ("}{_wUnit}{")"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "6px 8px"
            }} type={"text"} inputMode={"decimal"} value={_dispW} onChange={e => {
              const v = e.target.value;
              const lbs = v && _metric ? kgToLbs(v) : v;
              updateWbEx(idx, "weightLbs", lbs || null);
            }} placeholder={"—"} /></div>}</>}</div>{_isRunning && _runBoost > 0 && <div style={{
        fontSize: FS.fs58,
        color: UI_COLORS.warning,
        marginBottom: S.s4
      }}>{"⚡ Pace bonus: +"}{_runBoost}{"% XP"}</div>}{_isTread && <div style={{
        marginBottom: S.s6
      }}><div style={{
          display: "flex",
          gap: S.s8
        }}><div style={{
            flex: 1
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Incline (0.5–15)"}</label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} style={{
              width: "100%",
              padding: "4px 6px"
            }} value={ex.incline || ""} onChange={e => updateWbEx(idx, "incline", e.target.value ? parseFloat(e.target.value) : null)} /></div><div style={{
            flex: 1
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Speed (0.5–15)"}</label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} style={{
              width: "100%",
              padding: "4px 6px"
            }} value={ex.speed || ""} onChange={e => updateWbEx(idx, "speed", e.target.value ? parseFloat(e.target.value) : null)} /></div></div></div>}{(ex.extraRows || []).map((row, ri) => <div key={ri} style={{
        display: "flex",
        gap: S.s4,
        marginTop: S.s4,
        padding: "6px 8px",
        background: "rgba(45,42,36,.18)",
        borderRadius: R.md,
        alignItems: "center",
        flexWrap: "wrap"
      }}><span style={{
          fontSize: FS.fs52,
          color: "#9a8a78",
          flexShrink: 0,
          minWidth: 16
        }}>{_isC || _isF ? `I${ri + 2}` : `S${ri + 2}`}</span>{_isC || _isF ? <><input className={"wb-ex-inp"} style={{
            flex: 1.5,
            minWidth: 52,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} value={row.hhmm || ""} onChange={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              hhmm: e.target.value
            };
            updateWbEx(idx, "extraRows", rr);
          }} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              hhmm: normalizeHHMM(e.target.value)
            };
            updateWbEx(idx, "extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 0.7,
            minWidth: 36,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} value={row.sec || ""} onChange={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              sec: e.target.value
            };
            updateWbEx(idx, "extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={_dUnit} value={row.distanceMi || ""} onChange={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              distanceMi: e.target.value
            };
            updateWbEx(idx, "extraRows", rr);
          }} /></> : <><input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={"Sets"} value={row.sets || ""} onChange={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              sets: e.target.value
            };
            updateWbEx(idx, "extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={"Reps"} value={row.reps || ""} onChange={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              reps: e.target.value
            };
            updateWbEx(idx, "extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={_wUnit} value={row.weightLbs || ""} onChange={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              weightLbs: e.target.value
            };
            updateWbEx(idx, "extraRows", rr);
          }} /></>}<button className={"btn btn-danger btn-xs"} style={{
          padding: "2px 4px",
          flexShrink: 0
        }} onClick={() => {
          const rr = (ex.extraRows || []).filter((_, j) => j !== ri);
          updateWbEx(idx, "extraRows", rr);
        }}>{"✕"}</button></div>)}<button className={"btn btn-ghost btn-xs"} style={{
        width: "100%",
        marginTop: S.s4,
        marginBottom: S.s4,
        fontSize: FS.sm,
        color: "#8a8478",
        borderStyle: "dashed"
      }} onClick={() => {
        const rr = [...(ex.extraRows || []), _isC || _isF ? {
          hhmm: "",
          sec: "",
          distanceMi: ""
        } : {
          sets: ex.sets || "",
          reps: ex.reps || "",
          weightLbs: ex.weightLbs || ""
        }];
        updateWbEx(idx, "extraRows", rr);
      }}>{"＋ Add Row (e.g. "}{_isC || _isF ? "interval" : "progressive weight"}{")"}</button></>;
  }

  /* ── Render one accordion section (A or B) inside a superset card ── */
  function renderSsAccordionSection(ex, idx, exD, label, sectionKey) {
    const collapsed = !!ssAccordion[sectionKey];
    const _noSets = NO_SETS_EX_IDS.has(exD.id);
    const _isC = exD.category === "cardio";
    const _isF = exD.category === "flexibility";
    const _metric = isMetric(profile.units);
    const _wUnit = weightLabel(profile.units);
    const _distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
    const _durMin = parseFloat(ex.reps || 0);
    const _isRunning = exD.id === RUNNING_EX_ID;
    const _runPace = _isRunning && _distMiVal > 0 && _durMin > 0 ? _durMin / _distMiVal : null;
    const _runBoost = _runPace ? _runPace <= 8 ? 20 : 5 : 0;
    const xpVal = (() => {
      const extraCount = (ex.extraRows || []).length;
      const b = calcExXP(ex.exId, _noSets ? 1 : ex.sets, ex.reps, profile.chosenClass, allExById, _distMiVal || null, ex.weightLbs || null, null, extraCount);
      const r = (ex.extraRows || []).reduce((s, row) => s + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, ex.weightLbs || null, null, extraCount), 0);
      return b + r;
    })();
    const summaryText = (_noSets ? "" : ex.sets + "×") + ex.reps + (ex.weightLbs ? ` · ${displayWt(ex.weightLbs, profile.units)}` : "");
    return <div className={"ss-section"}><div className={"ss-section-hdr"} onClick={() => setSsAccordion(prev => ({
        ...prev,
        [sectionKey]: !prev[sectionKey]
      }))}><div className={"ab-badge"}>{label}</div><div style={{
          width: 28,
          height: 28,
          borderRadius: R.md,
          flexShrink: 0,
          background: "rgba(45,42,36,.15)",
          border: "1px solid rgba(180,172,158,.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: FS.fs80
        }}>{exD.icon}</div><span style={{
          fontFamily: "'Cinzel',serif",
          fontSize: FS.fs66,
          color: "#d8caba",
          letterSpacing: ".02em",
          flex: 1,
          minWidth: 0
        }}>{exD.name}</span>{collapsed && <span style={{
          fontSize: FS.fs55,
          color: "#8a8478"
        }}>{summaryText}</span>}<span style={{
          fontSize: FS.sm,
          fontWeight: 700,
          color: "#b4ac9e",
          flexShrink: 0
        }}>{"+" + xpVal}</span><span style={{
          fontSize: FS.sm,
          color: "#8a8478",
          transition: "transform .2s",
          transform: collapsed ? "rotate(0deg)" : "rotate(180deg)"
        }}>{"▼"}</span></div>{!collapsed && <div className={"ss-section-body"}>{renderWbExFields(ex, idx, exD)}</div>}</div>;
  }

  /* ── Reorder a superset pair as a single unit ── */
  function reorderSupersetPair(anchorIdx, partnerIdx, direction) {
    setWbExercises(exs => {
      const arr = [...exs];
      const minI = Math.min(anchorIdx, partnerIdx);
      const maxI = Math.max(anchorIdx, partnerIdx);
      // We need to move both exercises. For simplicity, ensure they're adjacent first.
      // If not adjacent, move partner next to anchor first.
      if (maxI - minI !== 1) {
        // Make them adjacent: move maxI to minI+1
        const [moved] = arr.splice(maxI, 1);
        arr.splice(minI + 1, 0, moved);
        // Remap supersetWith
        const idxMap = {};
        const temp = exs.map((_, i) => i);
        const [movedI] = temp.splice(maxI, 1);
        temp.splice(minI + 1, 0, movedI);
        temp.forEach((oldI, newI) => {
          idxMap[oldI] = newI;
        });
        arr.forEach((e, ei) => {
          if (e.supersetWith != null && idxMap[e.supersetWith] != null) arr[ei] = {
            ...e,
            supersetWith: idxMap[e.supersetWith]
          };
        });
        return arr;
      }
      // Now move the pair up or down
      if (direction === "up" && minI > 0) {
        // Swap the pair with the element above
        const above = arr[minI - 1];
        arr[minI - 1] = arr[minI];
        arr[minI] = arr[minI + 1];
        arr[minI + 1] = above;
        // Remap
        arr.forEach((e, ei) => {
          if (e.supersetWith === minI - 1) arr[ei] = {
            ...e,
            supersetWith: minI + 1
          };else if (e.supersetWith === minI) arr[ei] = {
            ...e,
            supersetWith: minI - 1
          };else if (e.supersetWith === minI + 1) arr[ei] = {
            ...e,
            supersetWith: minI
          };
        });
      } else if (direction === "down" && maxI < arr.length - 1) {
        const below = arr[maxI + 1];
        arr[maxI + 1] = arr[maxI];
        arr[maxI] = arr[minI];
        arr[minI] = below;
        arr.forEach((e, ei) => {
          if (e.supersetWith === minI) arr[ei] = {
            ...e,
            supersetWith: minI + 1
          };else if (e.supersetWith === minI + 1) arr[ei] = {
            ...e,
            supersetWith: minI + 2
          };else if (e.supersetWith === maxI + 1) arr[ei] = {
            ...e,
            supersetWith: minI
          };
        });
      }
      return arr;
    });
  }
  function removeWbEx(idx) {
    setWbExercises(exs => {
      const updated = exs.map((e, i) => {
        if (i === idx) return null;
        if (e.supersetWith === idx) return {
          ...e,
          supersetWith: null
        };
        if (e.supersetWith != null && e.supersetWith > idx) {
          return {
            ...e,
            supersetWith: e.supersetWith - 1
          };
        }
        return e;
      }).filter(Boolean);
      return updated;
    });
  }
  function reorderWbEx(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    setWbExercises(exs => {
      const arr = [...exs];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      const indexMap = {};
      const temp = exs.map((_, i) => i);
      const [movedIdx] = temp.splice(fromIdx, 1);
      temp.splice(toIdx, 0, movedIdx);
      temp.forEach((oldIdx, newIdx) => {
        indexMap[oldIdx] = newIdx;
      });
      return arr.map(e => {
        if (e.supersetWith != null && indexMap[e.supersetWith] != null) {
          return {
            ...e,
            supersetWith: indexMap[e.supersetWith]
          };
        }
        return e;
      });
    });
  }
  // Add a workout's exercises as a new day in a plan
  function addWorkoutToPlan(workout, planId) {
    const plan = profile.plans.find(p => p.id === planId);
    if (!plan) {
      showToast("Plan not found.");
      return;
    }
    const newDay = {
      label: workout.name,
      exercises: workout.exercises.map(e => ({
        ...e
      }))
    };
    const updated = {
      ...plan,
      days: [...plan.days, newDay]
    };
    setProfile(pr => ({
      ...pr,
      plans: pr.plans.map(p => p.id === planId ? updated : p)
    }));
    setAddToPlanPicker(null);
    showToast(workout.icon + " " + workout.name + " added to " + plan.name + " ⚔️");
  }
  // Open stats prompt if any of duration/activeCal/totalCal are missing, then run onConfirm
  function openStatsPromptIfNeeded(wo, onConfirm) {
    // Skip stats modal entirely for rest-day-only workouts
    const isRestDayOnly = wo.soloEx && wo._soloExId === "rest_day" || wo.exercises && wo.exercises.length > 0 && wo.exercises.every(e => e.exId === "rest_day");
    if (isRestDayOnly) {
      onConfirm(wo);
      return;
    }
    const _bsPrefs = profile.notificationPrefs || {};
    if (_bsPrefs.reviewBattleStats === false) {
      onConfirm(wo);
      return;
    }
    const hasDur = wo.durationMin !== null && wo.durationMin !== undefined && wo.durationMin !== "";
    const hasAct = wo.activeCal !== null && wo.activeCal !== undefined && wo.activeCal !== "";
    const hasTot = wo.totalCal !== null && wo.totalCal !== undefined && wo.totalCal !== "";
    const split = hasDur ? secToHHMMSplit(Number(wo.durationMin)) : {
      hhmm: "",
      sec: ""
    };
    setSpDuration(split.hhmm);
    setSpDurSec(split.sec !== null && split.sec !== "" && split.sec !== 0 ? String(split.sec) : "");
    setSpActiveCal(hasAct ? String(wo.activeCal) : "");
    setSpTotalCal(hasTot ? String(wo.totalCal) : "");
    setStatsPromptModal({
      wo,
      missingDur: !hasDur,
      missingAct: !hasAct,
      missingTot: !hasTot,
      onConfirm,
      _self: {
        wo,
        missingDur: !hasDur,
        missingAct: !hasAct,
        missingTot: !hasTot,
        onConfirm
      }
    });
  }

  // Mark a workout complete — logs all its exercises under the chosen date
  function confirmWorkoutComplete() {
    const wo = completionModal && completionModal.workout;
    if (!wo) return;
    const dateStr = completionAction === "past" && completionDate && completionDate !== "pick" ? completionDate : todayStr();
    const dateObj = new Date(dateStr + "T12:00:00");
    const displayDate = dateObj.toLocaleDateString();
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    const batchId = uid();
    const entries = wo.exercises.flatMap(ex => {
      const exData = allExById[ex.exId];
      if (!exData) return [];
      const isC = exData.category === "cardio";
      const isF = exData.category === "flexibility";
      // Build all rows: main row + extra rows
      const allRows = [{
        sets: ex.sets || 3,
        reps: ex.reps || 10,
        weightLbs: ex.weightLbs || null
      }, ...(ex.extraRows || [])];
      const extraCount = (ex.extraRows || []).length;
      return allRows.map(row => {
        const xp = calcExXP(ex.exId, row.sets || 3, row.reps || 10, profile.chosenClass, allExById, null, null, null, extraCount);
        return {
          exId: ex.exId,
          exercise: exData.name,
          icon: exData.icon,
          xp,
          mult: getMult(exData),
          sets: parseInt(row.sets) || 3,
          reps: parseInt(row.reps) || 10,
          weightLbs: !isC && !isF ? row.weightLbs || null : null,
          weightPct: 100,
          hrZone: ex.hrZone || null,
          distanceMi: ex.distanceMi || null,
          seconds: ex.seconds || null,
          time: now,
          date: displayDate,
          dateKey: dateStr,
          sourceWorkoutId: wo.id,
          sourceWorkoutName: wo.name,
          sourceWorkoutIcon: wo.icon,
          sourceWorkoutType: wo.oneOff ? "oneoff" : "reusable",
          sourceGroupId: batchId,
          sourceTotalCal: wo.totalCal || null,
          sourceActiveCal: wo.activeCal || null,
          sourceDurationSec: wo.durationMin || null
        };
      });
    }).filter(Boolean);
    if (entries.length === 0) {
      showToast("No valid exercises to log.");
      return;
    }
    const totalXP = entries.reduce((s, e) => s + e.xp, 0);
    const newLog = [...entries, ...profile.log];
    const newQuests = {
      ...(profile.quests || {})
    };
    QUESTS.filter(q => q.auto && !newQuests[q.id] && !newQuests[q.id]).forEach(q => {
      if (checkQuestCompletion(q, newLog, profile.checkInStreak)) newQuests[q.id] = {
        completed: true,
        completedAt: todayStr(),
        claimed: false
      };
    });
    // If one-off, save to workouts array (as oneOff or reusable based on flag)
    const newWorkouts = wo.oneOff ? (() => {
      const existing = (profile.workouts || []).find(w => w.id === wo.id);
      const saved = {
        ...wo,
        completedAt: dateStr,
        oneOff: wo.makeReusable ? false : true
      };
      delete saved.makeReusable; // clean up temp flag
      if (existing) return (profile.workouts || []).map(w => w.id === wo.id ? saved : w);
      return [...(profile.workouts || []), saved];
    })() : profile.workouts || [];
    // Fix sourceWorkoutType on log entries if converting to reusable
    if (wo.makeReusable) {
      entries.forEach(e => {
        e.sourceWorkoutType = "reusable";
      });
    }
    let _ciResult = {
      checkInApplied: false,
      checkInXP: 0,
      checkInStreak: 0
    };
    setProfile(p => {
      const base = {
        ...p,
        xp: p.xp + totalXP,
        log: newLog,
        quests: newQuests,
        workouts: newWorkouts,
        scheduledWorkouts: wo.oneOff ? (p.scheduledWorkouts || []).filter(sw => sw.sourceWorkoutId !== wo.id) : p.scheduledWorkouts || []
      };
      const ci = applyAutoCheckIn(base, dateStr);
      _ciResult = ci;
      return ci.profile;
    });
    setXpFlash({
      amount: totalXP + _ciResult.checkInXP,
      mult: 1
    });
    setTimeout(() => setXpFlash(null), 2500);
    setCompletionModal(null);
    setCompletionDate("");
    setCompletionAction("today");
    setScheduleWoDate("");
    if (wo.makeReusable) {
      setWorkoutSubTab("reusable");
    }
    const label = dateStr === todayStr() ? "today" : displayDate;
    const reusableNote = wo.makeReusable ? " · Saved to Re-Usable tab!" : "";
    const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
    showToast(wo.icon + " " + wo.name + " completed " + label + "! " + formatXP(totalXP, {
      signed: true
    }) + " ⚡" + reusableNote + ciSuffix);
  }
  function scheduleWorkoutForDate() {
    const wo = _optionalChain([completionModal, 'optionalAccess', _64 => _64.workout]);
    if (!wo || !scheduleWoDate) return;
    const newSw = wo.exercises.map(ex => ({
      id: uid(),
      exId: ex.exId,
      scheduledDate: scheduleWoDate,
      notes: wo.name,
      createdAt: todayStr(),
      sourceWorkoutId: wo.id,
      sourceWorkoutName: wo.name,
      sourceWorkoutIcon: wo.icon
    }));
    // If one-off, save the workout object so it can be retrieved for completion
    const newWorkouts = wo.oneOff && !(profile.workouts || []).find(w => w.id === wo.id) ? [...(profile.workouts || []), wo] : profile.workouts || [];
    setProfile(p => ({
      ...p,
      scheduledWorkouts: [...(p.scheduledWorkouts || []), ...newSw],
      workouts: newWorkouts
    }));
    setCompletionModal(null);
    setCompletionDate("");
    setCompletionAction("today");
    setScheduleWoDate("");
    showToast(`📅 ${wo.name} scheduled for ${formatScheduledDate(scheduleWoDate)}!`);
  }
  function calcEntryXP(entry) {
    const ex = allExById[entry.exId];
    if (!ex) return entry.xp;
    const rv = parseInt(entry.reps) || 1,
      sv = parseInt(entry.sets) || 1;
    const effectiveW = parseFloat(entry.weightLbs) || 0;
    const distMi = entry.distanceMi || null;
    const isCardio = ex.category === "cardio";
    return calcExXP(ex.id, sv, rv, profile.chosenClass, allExById, distMi, effectiveW || null, isCardio ? entry.hrZone || null : null);
  }
  function openLogEdit(idx) {
    const entry = profile.log[idx];
    if (!entry) return;
    setLogEditDraft({
      ...entry
    });
    setLogEditModal({
      idx
    });
  }
  function saveLogEdit() {
    if (!logEditModal) return;
    const {
      idx
    } = logEditModal;
    const oldEntry = profile.log[idx];
    const newXP = calcEntryXP(logEditDraft);
    const xpDiff = newXP - oldEntry.xp;
    const updatedEntry = {
      ...logEditDraft,
      xp: newXP
    };
    const updatedLog = profile.log.map((e, i) => i === idx ? updatedEntry : e);
    // Recalculate running PB from the full updated log
    let newPB = null;
    updatedLog.forEach(e => {
      if (e.exId === RUNNING_EX_ID && e.distanceMi && e.reps) {
        const pace = e.reps / e.distanceMi;
        if (!newPB || pace < newPB) newPB = pace;
      }
    });
    const pbChanged = newPB !== profile.runningPB;
    const newExPBs = calcExercisePBs(updatedLog);
    setProfile(p => ({
      ...p,
      xp: Math.max(0, p.xp + xpDiff),
      log: updatedLog,
      runningPB: newPB,
      exercisePBs: newExPBs
    }));
    setLogEditModal(null);
    setLogEditDraft(null);
    let msg = xpDiff > 0 ? "Updated! +" + xpDiff + " XP ⚡" : xpDiff < 0 ? "Updated! " + xpDiff + " XP" : "Patched! ⚡";
    if (pbChanged) msg += newPB ? " · 🏆 Run PB updated" : " · Run PB cleared";
    showToast(msg);
  }
  function deleteLogEntryByIdx(idx) {
    const entry = profile.log[idx];
    if (!entry) return;
    setConfirmDelete({
      type: "logEntry",
      id: idx,
      name: entry.exercise,
      icon: entry.icon || "⚔️",
      xp: entry.xp
    });
  }
  function _doDeleteLogEntry(idx) {
    const entry = profile.log[idx];
    if (!entry) return;
    const updatedLog = profile.log.filter((_, i) => i !== idx);
    let newPB = null;
    updatedLog.forEach(e => {
      if (e.exId === RUNNING_EX_ID && e.distanceMi && e.reps) {
        const pace = e.reps / e.distanceMi;
        if (!newPB || pace < newPB) newPB = pace;
      }
    });
    // Add to deletedItems for recovery
    const deletedEntry = {
      id: uid(),
      type: "logEntry",
      item: {
        ...entry,
        _originalIdx: idx
      },
      deletedAt: new Date().toISOString()
    };
    const bin = [...(profile.deletedItems || []), deletedEntry];
    setProfile(p => ({
      ...p,
      xp: Math.max(0, p.xp - entry.xp),
      log: updatedLog,
      runningPB: newPB,
      exercisePBs: calcExercisePBs(updatedLog),
      deletedItems: bin
    }));
    showToast("Entry removed. -" + entry.xp + " XP");
  }

  // ── Schedule picker helpers ──────────────────────────────────
  const openSchedulePlan = useCallback(function openSchedulePlan(plan) {
    setSchedulePicker({ type: "plan", plan });
    setSpDate(plan.scheduledDate || "");
    setSpNotes(plan.scheduleNotes || "");
  }, []);
  function openScheduleEx(exId, existingId) {
    const ex = allExById[exId];
    if (!ex) return;
    const existing = existingId ? (profile.scheduledWorkouts || []).find(s => s.id === existingId) : null;
    setSchedulePicker({
      type: "ex",
      exId,
      name: ex.name,
      icon: ex.icon,
      existingId: existingId || null
    });
    setSpDate(_optionalChain([existing, 'optionalAccess', _65 => _65.scheduledDate]) || "");
    setSpNotes(_optionalChain([existing, 'optionalAccess', _66 => _66.notes]) || "");
  }
  function confirmSchedule() {
    if (!spDate) {
      showToast("Pick a date first!");
      return;
    }
    const p = schedulePicker;
    if (p.type === "plan") {
      const updated = profile.plans.map(pl => pl.id === p.plan.id ? {
        ...pl,
        scheduledDate: spDate,
        scheduleNotes: spNotes
      } : pl);
      const newProfile = {
        ...profile,
        plans: updated
      };
      setProfile(newProfile);
      doSave(newProfile, _optionalChain([authUser, 'optionalAccess', _67 => _67.id]) || null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email]) || null);
      // Also update activePlan inside PlansTabContainer if viewing the same plan in detail
      plansContainerRef.current?.syncActivePlanSchedule(p.plan.id, spDate, spNotes);
      showToast("Plan scheduled for " + formatScheduledDate(spDate) + " \u2726");
    } else {
      if (p.existingId) {
        const updated = (profile.scheduledWorkouts || []).map(sw => sw.id === p.existingId ? {
          ...sw,
          scheduledDate: spDate,
          notes: spNotes
        } : sw);
        const newProfile = {
          ...profile,
          scheduledWorkouts: updated
        };
        setProfile(newProfile);
        doSave(newProfile, _optionalChain([authUser, 'optionalAccess', _67 => _67.id]) || null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email]) || null);
        showToast(p.icon + " " + p.name + " rescheduled to " + formatScheduledDate(spDate) + " \u2726");
      } else {
        const sw = {
          id: uid(),
          exId: p.exId,
          scheduledDate: spDate,
          notes: spNotes,
          createdAt: todayStr()
        };
        const newProfile = {
          ...profile,
          scheduledWorkouts: [...(profile.scheduledWorkouts || []), sw]
        };
        setProfile(newProfile);
        doSave(newProfile, _optionalChain([authUser, 'optionalAccess', _67 => _67.id]) || null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email]) || null);
        showToast(p.icon + " " + p.name + " scheduled for " + formatScheduledDate(spDate) + " \u2726");
      }
      setActiveTab("workouts");
      setWorkoutSubTab("oneoff");
    }
    setSchedulePicker(null);
  }
  function removeScheduledWorkout(id) {
    setProfile(p => ({
      ...p,
      scheduledWorkouts: (p.scheduledWorkouts || []).filter(s => s.id !== id)
    }));
  }
  function removePlanSchedule(planId) {
    const updated = profile.plans.map(pl => pl.id === planId ? {
      ...pl,
      scheduledDate: null,
      scheduleNotes: ""
    } : pl);
    setProfile(pr => ({
      ...pr,
      plans: updated
    }));
    showToast("Schedule cleared.");
  }
  function formatScheduledDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T12:00:00");
      return d.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
    } catch (e) {
      return dateStr;
    }
  }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const then = new Date(dateStr + "T00:00:00");
      const diff = Math.round((then - now) / 86400000);
      return diff;
    } catch (e) {
      return null;
    }
  }

  // Profile edit
  function openEdit() {
    const metric = isMetric(profile.units);
    setDraft({
      playerName: profile.playerName,
      firstName: profile.firstName || "",
      lastName: profile.lastName || "",
      weightLbs: profile.weightLbs,
      heightFt: profile.heightFt,
      heightIn: profile.heightIn,
      gym: profile.gym,
      state: profile.state || "",
      country: profile.country || "United States",
      chosenClass: profile.chosenClass,
      age: profile.age || "",
      gender: profile.gender || "",
      runningPB: profile.runningPB || "",
      units: profile.units || "imperial",
      // display values in user's unit for edit form
      _dispWeight: metric && profile.weightLbs ? lbsToKg(profile.weightLbs) : profile.weightLbs,
      _dispHeightCm: metric ? ftInToCm(profile.heightFt, profile.heightIn) || "" : ""
    });
    setEditMode(true);
  }
  function saveEdit() {
    const metric = isMetric(draft.units);
    const wLbs = metric && draft._dispWeight ? parseFloat(kgToLbs(draft._dispWeight)).toFixed(1) : draft.weightLbs;
    let hFt = draft.heightFt,
      hIn = draft.heightIn;
    if (metric && draft._dispHeightCm) {
      const conv = cmToFtIn(draft._dispHeightCm);
      hFt = String(conv.ft);
      hIn = String(conv.inch);
    }
    const u = {
      ...profile,
      ...draft,
      weightLbs: wLbs,
      heightFt: hFt,
      heightIn: hIn
    };
    delete u._dispWeight;
    delete u._dispHeightCm;
    setProfile(u);
    doSave(u, _optionalChain([authUser, 'optionalAccess', _67 => _67.id]) || null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email]) || null);
    setEditMode(false);
    showToast("Build saved! ⚡");
  }
  function resetChar() {
    setConfirmDelete({
      type: "char",
      id: "char",
      name: "your character",
      icon: "🛡️",
      warning: "All XP, history, plans and workouts will be permanently lost."
    });
  }
  function _doResetChar() {
    doSave(EMPTY_PROFILE, authUser?.id || null, authUser?.email || null);
    setProfile(EMPTY_PROFILE);
    setObName("");
    setObBio("");
    setObAge("");
    setObGender("");
    setObSports([]);
    setObFreq("");
    setObTiming("");
    setObPriorities([]);
    setObStyle("");
    setObStep(1);
    setScreen("intro");
  }
  const rootStyle = {
    "--cls-color": _optionalChain([cls, 'optionalAccess', _73 => _73.color]) || "#b4ac9e",
    "--cls-glow": _optionalChain([cls, 'optionalAccess', _74 => _74.glow]) || UI_COLORS.accent
  };

  // Pending quest claims
  const pendingQuestCount = QUESTS.filter(q => {
    const qs = _optionalChain([profile, 'access', _75 => _75.quests, 'optionalAccess', _76 => _76[q.id]]);
    return _optionalChain([qs, 'optionalAccess', _77 => _77.completed]) && !_optionalChain([qs, 'optionalAccess', _78 => _78.claimed]);
  }).length;
  const CSS = "";
  function launchPreviewMode() {
    const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const fmtDate = n => new Date(Date.now() - n * 86400000).toLocaleDateString();
    const fmtTime = () => "07:30 AM";
    const gid = s => `preview-grp-${s}`;
    const previewLog = [{
      exercise: "Bench Press",
      icon: "\uD83C\uDFCB\uFE0F",
      exId: "bench",
      sets: 4,
      reps: 8,
      weightLbs: 185,
      weightPct: 100,
      hrZone: null,
      distanceMi: null,
      xp: 420,
      mult: 1.12,
      time: fmtTime(),
      date: fmtDate(1),
      dateKey: daysAgo(1),
      sourceGroupId: gid("a")
    }, {
      exercise: "Overhead Press",
      icon: "\uD83C\uDFCB\uFE0F",
      exId: "ohp",
      sets: 3,
      reps: 10,
      weightLbs: 115,
      weightPct: 100,
      hrZone: null,
      distanceMi: null,
      xp: 310,
      mult: 1.12,
      time: fmtTime(),
      date: fmtDate(1),
      dateKey: daysAgo(1),
      sourceGroupId: gid("a")
    }, {
      exercise: "Running",
      icon: "\uD83C\uDFC3",
      exId: "run",
      sets: 1,
      reps: 28,
      weightLbs: null,
      weightPct: 100,
      hrZone: null,
      distanceMi: 3.1,
      xp: 380,
      mult: 0.94,
      time: fmtTime(),
      date: fmtDate(3),
      dateKey: daysAgo(3),
      sourceGroupId: gid("b")
    }, {
      exercise: "Deadlift",
      icon: "\uD83C\uDFCB\uFE0F",
      exId: "deadlift",
      sets: 4,
      reps: 6,
      weightLbs: 225,
      weightPct: 100,
      hrZone: null,
      distanceMi: null,
      xp: 580,
      mult: 1.12,
      time: fmtTime(),
      date: fmtDate(5),
      dateKey: daysAgo(5),
      sourceGroupId: gid("c")
    }, {
      exercise: "Pull-Up",
      icon: "\uD83E\uDE9D",
      exId: "pullups",
      sets: 3,
      reps: 10,
      weightLbs: null,
      weightPct: 100,
      hrZone: null,
      distanceMi: null,
      xp: 290,
      mult: 1.12,
      time: fmtTime(),
      date: fmtDate(5),
      dateKey: daysAgo(5),
      sourceGroupId: gid("c")
    }, {
      exercise: "Squat",
      icon: "\uD83C\uDFCB\uFE0F",
      exId: "squat",
      sets: 4,
      reps: 8,
      weightLbs: 205,
      weightPct: 100,
      hrZone: null,
      distanceMi: null,
      xp: 510,
      mult: 1.12,
      time: fmtTime(),
      date: fmtDate(10),
      dateKey: daysAgo(10),
      sourceGroupId: gid("e")
    }];
    setProfile({
      ...EMPTY_PROFILE,
      playerName: "Test Majiq",
      firstName: "John",
      lastName: "Majiq",
      chosenClass: "tempest",
      xp: 320000,
      weightLbs: 205,
      heightFt: 6,
      heightIn: 2,
      age: 36,
      gender: "Male",
      gym: "Lifetime Fitness",
      state: "KS",
      country: "United States",
      motto: "I like to test apps",
      trainingStyle: "mixed",
      workoutTiming: "evening",
      disciplineTrait: "Night Owl",
      hudFields: {
        weight: true,
        height: true,
        bmi: false
      },
      fitnessPriorities: ["nutrition", "endurance", "social"],
      sportsBackground: ["football", "volleyball", "dance"],
      nameVisibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      log: previewLog,
      workouts: [],
      plans: [],
      scheduledWorkouts: [],
      checkInHistory: [],
      checkInStreak: 3,
      totalCheckIns: 10,
      lastCheckIn: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      quests: {},
      customExercises: [],
      exercisePBs: {
        bench: {
          weight: 185
        },
        squat: {
          weight: 205
        },
        deadlift: {
          weight: 225
        },
        run: {
          type: "cardio",
          value: 9.03
        }
      }
    });
    setMyPublicId("UQHDD2");
    setMyPrivateId("mPTSbPw8vTnd");
    setFriends([{
      id: "f1",
      playerName: "IronValkyrie",
      chosenClass: "warrior",
      xp: 420000,
      log: []
    }, {
      id: "f2",
      playerName: "ZenMaster_X",
      chosenClass: "druid",
      xp: 155000,
      log: []
    }, {
      id: "f3",
      playerName: "CrushMode88",
      chosenClass: "gladiator",
      xp: 58000,
      log: []
    }, {
      id: "f4",
      playerName: "SwiftArrow",
      chosenClass: "warden",
      xp: 105000,
      log: []
    }]);
    setLbData([{
      user_id: "f1",
      public_id: "VK9R3M",
      player_name: "IronValkyrie",
      first_name: "Sarah",
      last_name: "Chen",
      chosen_class: "warrior",
      total_xp: 420000,
      level: 8,
      streak: 31,
      state: "NY",
      country: "United States",
      gym: "Gold's Gym",
      exercise_pbs: {
        bench: {
          weight: 185
        },
        squat: {
          weight: 275
        },
        deadlift: {
          weight: 315
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }, {
      user_id: "f5",
      public_id: "PH3L9F",
      player_name: "PhantomLift",
      first_name: "Jake",
      last_name: "Morrison",
      chosen_class: "phantom",
      total_xp: 360000,
      level: 8,
      streak: 45,
      state: "CO",
      country: "United States",
      gym: "24 Hr Fitness",
      exercise_pbs: {
        bench: {
          weight: 245
        },
        squat: {
          weight: 365
        },
        deadlift: {
          weight: 405
        },
        pullups: {
          reps: 25
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }, {
      user_id: "preview",
      public_id: "UQHDD2",
      player_name: "Test Majiq",
      first_name: "John",
      last_name: "Majiq",
      chosen_class: "tempest",
      total_xp: 320000,
      level: 7,
      streak: 3,
      state: "KS",
      country: "United States",
      gym: "Lifetime Fitness",
      exercise_pbs: {
        bench: {
          weight: 185
        },
        squat: {
          weight: 205
        },
        deadlift: {
          weight: 225
        },
        run: {
          type: "cardio",
          value: 9.03
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: true
    }, {
      user_id: "f6",
      public_id: "TT6B4K",
      player_name: "TitanBreaker",
      first_name: "Mike",
      last_name: "OBrien",
      chosen_class: "titan",
      total_xp: 210000,
      level: 6,
      streak: 18,
      state: "OH",
      country: "United States",
      gym: "YMCA",
      exercise_pbs: {
        bench: {
          weight: 315
        },
        squat: {
          weight: 455
        },
        deadlift: {
          weight: 500
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }, {
      user_id: "f2",
      public_id: "ZN4K8W",
      player_name: "ZenMaster_X",
      first_name: "Marcus",
      last_name: "Rivera",
      chosen_class: "druid",
      total_xp: 155000,
      level: 5,
      streak: 14,
      state: "CA",
      country: "United States",
      gym: "Equinox",
      exercise_pbs: {
        bench: {
          weight: 135
        },
        run: {
          type: "cardio",
          value: 7.5
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }, {
      user_id: "f4",
      public_id: "SW7A2R",
      player_name: "SwiftArrow",
      first_name: "Emily",
      last_name: "Park",
      chosen_class: "warden",
      total_xp: 105000,
      level: 4,
      streak: 22,
      state: "FL",
      country: "United States",
      gym: "LA Fitness",
      exercise_pbs: {
        run: {
          type: "cardio",
          value: 7.2
        },
        pullups: {
          reps: 12
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }, {
      user_id: "f3",
      public_id: "CR8M5T",
      player_name: "CrushMode88",
      first_name: "DeAndre",
      last_name: "Williams",
      chosen_class: "gladiator",
      total_xp: 58000,
      level: 3,
      streak: 7,
      state: "TX",
      country: "United States",
      gym: "Planet Fitness",
      exercise_pbs: {
        bench: {
          weight: 225
        },
        squat: {
          weight: 315
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }, {
      user_id: "f7",
      public_id: "ST2E7X",
      player_name: "StrikerElite",
      first_name: "Aisha",
      last_name: "Thompson",
      chosen_class: "striker",
      total_xp: 22000,
      level: 2,
      streak: 5,
      state: "WA",
      country: "United States",
      gym: "Home Gym",
      exercise_pbs: {
        pushups: {
          reps: 45
        }
      },
      name_visibility: {
        displayName: ["app", "game"],
        realName: ["hide"]
      },
      is_me: false
    }]);
    setLbWorldRanks({
      "f1": 1,
      "f5": 2,
      "preview": 3,
      "f6": 4,
      "f2": 5,
      "f4": 6,
      "f3": 7,
      "f7": 8
    });
    setShowPreviewPin(false);
    setPreviewPinInput("");
    setPreviewPinError(false);
    setIsPreviewMode(true);
    setScreen("main");
  }
  if (screen === "loading") return <div style={{
    minHeight: "100vh",
    background: "#0c0c0a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  }}><span style={{
      color: "#8a8478",
      fontFamily: "serif",
      fontStyle: "italic"
    }}>{"Loading your legend…"}</span></div>;
  if (mfaChallengeScreen) return <div style={{
    minHeight: "100vh",
    background: "radial-gradient(ellipse 70% 55% at 30% 20%, rgba(55,48,36,.28) 0%, transparent 65%), radial-gradient(ellipse 50% 45% at 68% 78%, rgba(35,30,20,.16) 0%, transparent 60%), #0c0c0a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px"
  }}><style>{CSS}</style><div style={{
      width: "100%",
      maxWidth: 380,
      display: "flex",
      flexDirection: "column",
      alignItems: "center"
    }}><div style={{
        fontSize: "2.4rem",
        marginBottom: S.s12
      }}>{"🛡️"}</div><div style={{
        fontFamily: "'Cinzel Decorative',serif",
        fontSize: "1rem",
        color: "#d4cec4",
        letterSpacing: ".08em",
        marginBottom: S.s4,
        textAlign: "center"
      }}>{"Verification Required"}</div><div style={{
        fontSize: FS.lg,
        color: "#8a8478",
        marginBottom: S.s24,
        textAlign: "center"
      }}>{"Your account is protected with multi-factor authentication."}</div><div style={{
        width: "100%",
        background: "linear-gradient(145deg,rgba(45,42,36,.4),rgba(32,30,26,.25))",
        border: "1px solid rgba(180,172,158,.06)",
        borderRadius: R.r12,
        padding: "20px",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)"
      }}><div style={{
          display: "flex",
          gap: S.s4,
          marginBottom: S.s16,
          background: "rgba(45,42,36,.25)",
          borderRadius: R.lg,
          padding: S.s4
        }}><div style={{
            flex: 1,
            textAlign: "center",
            padding: "7px 0",
            borderRadius: R.md,
            fontSize: FS.fs68,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all .15s",
            background: !mfaRecoveryMode ? "rgba(45,42,36,.5)" : "transparent",
            color: !mfaRecoveryMode ? "#d4cec4" : "#8a8478",
            border: !mfaRecoveryMode ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
          }} onClick={() => {
            setMfaRecoveryMode(false);
            setMfaChallengeMsg(null);
          }}>{"Authenticator Code"}</div><div style={{
            flex: 1,
            textAlign: "center",
            padding: "7px 0",
            borderRadius: R.md,
            fontSize: FS.fs68,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all .15s",
            background: mfaRecoveryMode ? "rgba(45,42,36,.5)" : "transparent",
            color: mfaRecoveryMode ? "#d4cec4" : "#8a8478",
            border: mfaRecoveryMode ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
          }} onClick={() => {
            setMfaRecoveryMode(true);
            setMfaChallengeMsg(null);
          }}>{"Recovery Code"}</div></div>

        {
          /* Authenticator code input */
        }{!mfaRecoveryMode && <div style={{
          display: "flex",
          flexDirection: "column",
          gap: S.s10
        }}><div style={{
            fontSize: FS.fs68,
            color: "#8a8478"
          }}>{"Enter the 6-digit code from your authenticator app."}</div><input className={"inp"} type={"text"} inputMode={"numeric"} maxLength={6} value={mfaChallengeCode} onChange={e => setMfaChallengeCode(e.target.value.replace(/\D/g, ""))} placeholder={"000000"} style={{
            textAlign: "center",
            letterSpacing: ".2em",
            fontSize: FS.fs90
          }} onKeyDown={e => {
            if (e.key === "Enter") submitMfaChallenge();
          }} /><button style={{
            width: "100%",
            padding: "11px",
            borderRadius: R.xl,
            border: "none",
            background: mfaChallengeLoading || mfaChallengeCode.length < 6 ? "rgba(45,42,36,.3)" : "linear-gradient(135deg, #c49428, #8a6010)",
            color: mfaChallengeLoading || mfaChallengeCode.length < 6 ? "#8a8478" : "#0c0c0a",
            fontFamily: "'Cinzel',serif",
            fontSize: FS.fs62,
            fontWeight: 700,
            letterSpacing: ".12em",
            cursor: "pointer"
          }} disabled={mfaChallengeLoading || mfaChallengeCode.length < 6} onClick={submitMfaChallenge}>{mfaChallengeLoading ? "Verifying\u2026" : "VERIFY"}</button></div>

        /* Recovery code input */}{mfaRecoveryMode && <div style={{
          display: "flex",
          flexDirection: "column",
          gap: S.s10
        }}><div style={{
            fontSize: FS.fs68,
            color: "#8a8478"
          }}>{"Enter one of your backup recovery codes. This will disable MFA so you can log in and re-enroll."}</div><input className={"inp"} type={"text"} value={mfaRecoveryInput} onChange={e => setMfaRecoveryInput(e.target.value.toUpperCase())} placeholder={"XXXX-XXXX-XXXX"} style={{
            textAlign: "center",
            letterSpacing: ".12em",
            fontSize: FS.fs82,
            fontFamily: "monospace"
          }} onKeyDown={e => {
            if (e.key === "Enter") submitRecoveryCode();
          }} /><button style={{
            width: "100%",
            padding: "11px",
            borderRadius: R.xl,
            border: "none",
            background: mfaChallengeLoading || !mfaRecoveryInput.trim() ? "rgba(45,42,36,.3)" : "linear-gradient(135deg, #c49428, #8a6010)",
            color: mfaChallengeLoading || !mfaRecoveryInput.trim() ? "#8a8478" : "#0c0c0a",
            fontFamily: "'Cinzel',serif",
            fontSize: FS.fs62,
            fontWeight: 700,
            letterSpacing: ".12em",
            cursor: "pointer"
          }} disabled={mfaChallengeLoading || !mfaRecoveryInput.trim()} onClick={submitRecoveryCode}>{mfaChallengeLoading ? "Verifying\u2026" : "USE RECOVERY CODE"}</button></div>}{mfaChallengeMsg && <div style={{
          fontSize: FS.fs74,
          color: mfaChallengeMsg.ok ? UI_COLORS.success : UI_COLORS.danger,
          textAlign: "center",
          marginTop: S.s10
        }}>{mfaChallengeMsg.text}</div>}</div>

      {
        /* Back to login */
      }<div style={{
        marginTop: S.s16,
        textAlign: "center"
      }}><span style={{
          fontSize: FS.fs68,
          color: "#8a8478",
          cursor: "pointer"
        }} onClick={async () => {
          await sb.auth.signOut();
          setMfaChallengeScreen(false);
          setMfaChallengeCode("");
          setMfaChallengeMsg(null);
          setMfaRecoveryMode(false);
          setMfaRecoveryInput("");
          setAuthUser(null);
          setScreen("landing");
        }}>{"← Back to Sign In"}</span><div style={{
          fontSize: FS.fs56,
          color: "#8a8478",
          marginTop: S.s8
        }}>{"Lost your authenticator AND recovery codes?"}</div><div style={{
          fontSize: FS.fs56,
          color: "#8a8478"
        }}>{"Contact support for an admin-assisted reset."}</div></div></div></div>;

  /* ══ ADMIN PANEL ════════════════════════════════════════════ */
  if (screen === "admin" && authUser && isAdmin) return lazyMount(
    <AdminPage authUser={authUser} onBack={() => setScreen("main")} />
  );

  /* ══ LANDING PAGE ═══════════════════════════════════════════ */
  if (screen === "landing") return lazyMount(<LandingPage onLogin={() => {
    setAuthIsNew(false);
    setScreen("login");
  }} onSignUp={() => {
    setAuthIsNew(true);
    setScreen("login");
  }} />);
  if (screen === "login") return (
    <LoginScreen
      authEmail={authEmail}
      setAuthEmail={setAuthEmail}
      authPassword={authPassword}
      setAuthPassword={setAuthPassword}
      showAuthPw={showAuthPw}
      setShowAuthPw={setShowAuthPw}
      authIsNew={authIsNew}
      setAuthIsNew={setAuthIsNew}
      authRemember={authRemember}
      setAuthRemember={setAuthRemember}
      authLoading={authLoading}
      authMsg={authMsg}
      setAuthMsg={setAuthMsg}
      loginSubScreen={loginSubScreen}
      setLoginSubScreen={setLoginSubScreen}
      forgotPwEmail={forgotPwEmail}
      setForgotPwEmail={setForgotPwEmail}
      forgotPrivateId={forgotPrivateId}
      setForgotPrivateId={setForgotPrivateId}
      forgotLookupResult={forgotLookupResult}
      setForgotLookupResult={setForgotLookupResult}
      PREVIEW_ENABLED={PREVIEW_ENABLED}
      previewPinEnabled={previewPinEnabled}
      showPreviewPin={showPreviewPin}
      setShowPreviewPin={setShowPreviewPin}
      previewPinInput={previewPinInput}
      setPreviewPinInput={setPreviewPinInput}
      previewPinError={previewPinError}
      setPreviewPinError={setPreviewPinError}
      PREVIEW_PIN={PREVIEW_PIN}
      launchPreviewMode={launchPreviewMode}
      onSubmit={handleAuthSubmit}
      onBack={() => setScreen("landing")}
      sendPasswordReset={sendPasswordReset}
      lookupByPrivateId={lookupByPrivateId}
    />
  );
  return <div className={"root"} style={rootStyle}><style>{CSS}</style><div className={"bg"} />{PARTICLES.map(p => <div key={p.id} className={"pt"} style={{
      left: `${p.x}%`,
      bottom: `${p.bottom}%`,
      width: p.size,
      height: p.size,
      "--dur": `${p.duration}s`,
      "--dly": `${p.delay}s`
    }} />)}{xpFlash && <div className={"xp-flash"}>{formatXP(xpFlash.amount, {
        signed: true
      })}{xpFlash.mult > 1.02 ? " ⚡" : ""}</div>}{toast && <div className={"toast"} role={"status"} aria-live={"polite"} aria-atomic={"true"} onClick={() => setToast(null)}>{toast}</div>}{friendExBanner && <div className={"friend-ex-banner"} key={friendExBanner.key} onClick={() => setFriendExBanner(null)}><div className={"friend-ex-banner-icon"}>{friendExBanner.exerciseIcon || "\uD83D\uDCAA"}</div><div className={"friend-ex-banner-text"}><div className={"friend-ex-banner-title"}>{friendExBanner.friendName}{" completed "}{friendExBanner.exerciseName}{"!"}</div>{friendExBanner.pbInfo && <div className={"friend-ex-banner-pb"}>{formatFriendPB(friendExBanner.pbInfo)}</div>}</div></div>}{showWNMockup && lazyMount(<WorkoutNotificationMockup onClose={() => setShowWNMockup(false)} />)

    /* ══ INTRO ══════════════════════════════════ */}{screen === "intro" && <div className={"screen boot-screen"}><div className={"boot-title"}>{"AURISAR"}<span className={"boot-title-sub"}>{"FITNESS"}</span></div><div className={"boot-log"}><div className={"boot-bar-wrap"}><div className={"boot-bar"} style={{
            width: bootStep >= 4 ? "100%" : bootStep >= 3 ? "58%" : bootStep >= 2 ? "34%" : bootStep >= 1 ? "12%" : "2%"
          }} /></div><div className={"boot-log-lines"}>{bootStep >= 1 && <div className={"boot-line boot-line-in"}><span className={"boot-prompt"}>{">"}</span>{" Loading combat modules..."}<span className={"boot-check"}>{" ✓"}</span></div>}{bootStep >= 2 && <div className={"boot-line boot-line-in"}><span className={"boot-prompt"}>{">"}</span>{" Calibrating XP engine..."}<span className={"boot-check"}>{" ✓"}</span></div>}{bootStep >= 3 && <div className={"boot-line boot-line-in"}><span className={"boot-prompt"}>{">"}</span>{" Assigning warrior class..."}{bootStep >= 4 ? <span className={"boot-check"}>{" ✓"}</span> : <span className={"boot-ellipsis"}>{" ..."}</span>}</div>}</div></div><button className={`btn btn-gold${bootStep >= 4 ? " boot-btn-ready" : ""}`} onClick={() => setScreen("onboard")}>{bootStep >= 4 ? "BEGIN" : "BOOT UP"}</button><button className={"btn btn-ghost boot-cancel-btn"} onClick={async () => {
        await sb.auth.signOut();
        setAuthUser(null);
        setAuthIsNew(false);
        setAuthEmail("");
        setAuthPassword("");
        setScreen("landing");
      }}>{"← Cancel"}</button>{obDraft && <div className={"boot-resume-card boot-line-in"}><div className={"boot-resume-label"}>{"⟳ Resume where you left off?"}</div><div className={"boot-resume-step"}>{`Step ${obDraft.obStep} of 6${obDraft.obFirstName ? " · " + obDraft.obFirstName : ""}`}</div><div style={{
          display: "flex",
          gap: S.s8,
          justifyContent: "center",
          marginTop: S.s8
        }}><button className={"btn btn-ghost"} style={{
            fontSize: FS.fs65,
            padding: "6px 14px"
          }} onClick={() => {
            setObStep(obDraft.obStep);
            setObName(obDraft.obName);
            setObFirstName(obDraft.obFirstName);
            setObLastName(obDraft.obLastName);
            setObBio(obDraft.obBio);
            setObAge(obDraft.obAge);
            setObGender(obDraft.obGender);
            setObSports(obDraft.obSports);
            setObFreq(obDraft.obFreq);
            setObTiming(obDraft.obTiming);
            setObPriorities(obDraft.obPriorities);
            setObStyle(obDraft.obStyle);
            setObState(obDraft.obState);
            setObCountry(obDraft.obCountry);
            setObDraft(null);
            setScreen("onboard");
          }}>{"Resume"}</button><span style={{
            fontSize: FS.fs58,
            color: "#8a8478",
            cursor: "pointer",
            alignSelf: "center",
            padding: "4px 6px"
          }} onClick={() => {
            try {
              localStorage.removeItem("aurisar_ob_draft_" + authUser.id);
            } catch (e) {}
            setObDraft(null);
            setObStep(1);
            setObName("");
            setObFirstName("");
            setObLastName("");
            setObBio("");
            setObAge("");
            setObGender("");
            setObSports([]);
            setObFreq("");
            setObTiming("");
            setObPriorities([]);
            setObStyle("");
            setObState("");
            setObCountry("United States");
            setScreen("onboard");
          }}>{"Start fresh"}</span></div></div>}</div>

    /* ══ ONBOARDING ═════════════════════════════ */}{screen === "onboard" && (() => {
      const OB_SPORTS = [{
        val: "football",
        label: "🏈 Football"
      }, {
        val: "basketball",
        label: "🏀 Basketball"
      }, {
        val: "soccer",
        label: "⚽ Soccer"
      }, {
        val: "baseball",
        label: "⚾ Baseball"
      }, {
        val: "volleyball",
        label: "🏐 Volleyball"
      }, {
        val: "tennis",
        label: "🎾 Tennis"
      }, {
        val: "running",
        label: "🏃 Track/Running"
      }, {
        val: "cycling",
        label: "🚴 Cycling"
      }, {
        val: "swimming",
        label: "🏊 Swimming"
      }, {
        val: "triathlon",
        label: "🏅 Triathlon"
      }, {
        val: "rowing",
        label: "🚣 Rowing"
      }, {
        val: "boxing",
        label: "🥊 Boxing/Kickboxing"
      }, {
        val: "mma",
        label: "🥋 MMA/Martial Arts"
      }, {
        val: "wrestling",
        label: "🤼 Wrestling"
      }, {
        val: "crossfit",
        label: "🔁 CrossFit"
      }, {
        val: "powerlifting",
        label: "🏋️ Powerlifting"
      }, {
        val: "bodybuilding",
        label: "💪 Bodybuilding"
      }, {
        val: "yoga",
        label: "🧘 Yoga/Pilates"
      }, {
        val: "dance",
        label: "💃 Dance/Cheer"
      }, {
        val: "hiking",
        label: "🥾 Hiking/Rucking"
      }, {
        val: "gymnastics",
        label: "🤸 Gymnastics"
      }, {
        val: "golf",
        label: "⛳ Golf"
      }, {
        val: "none",
        label: "🚫 No sports background"
      }];
      const OB_PRIORITIES = [{
        val: "be_strong",
        label: "💪 Being Strong"
      }, {
        val: "look_strong",
        label: "🪞 Looking Strong"
      }, {
        val: "feel_good",
        label: "🌿 Feeling Good"
      }, {
        val: "eat_right",
        label: "🥗 Eating Right"
      }, {
        val: "mental_clarity",
        label: "🧠 Mental Clarity"
      }, {
        val: "athletic_perf",
        label: "🏅 Athletic Performance"
      }, {
        val: "endurance",
        label: "🔥 Endurance & Stamina"
      }, {
        val: "longevity",
        label: "🕊️ Longevity & Recovery"
      }, {
        val: "competition",
        label: "🏆 Competition"
      }, {
        val: "social",
        label: "👥 Social/Community"
      }, {
        val: "flexibility",
        label: "🤸 Mobility & Flex"
      }, {
        val: "weight_loss",
        label: "⚖️ Weight Management"
      }];
      const prog = `${obStep / 6 * 100}%`;
      const chipSt = active => ({
        display: "inline-flex",
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: R.r20,
        border: `1px solid ${active ? "#d4cec4" : "rgba(180,172,158,.06)"}`,
        background: active ? "rgba(45,42,36,.25)" : "rgba(45,42,36,.12)",
        color: active ? "#d4cec4" : "#8a8478",
        fontSize: FS.fs78,
        cursor: "pointer",
        margin: "3px",
        userSelect: "none"
      });
      const radioSt = active => ({
        display: "flex",
        alignItems: "flex-start",
        gap: S.s10,
        padding: "12px 14px",
        border: `1px solid ${active ? "#d4cec4" : "rgba(180,172,158,.06)"}`,
        borderRadius: R.r10,
        background: active ? "rgba(45,42,36,.25)" : "rgba(45,42,36,.12)",
        cursor: "pointer",
        marginBottom: S.s8
      });
      const toggleSport = v => {
        if (v === "none") {
          setObSports(s => s.includes("none") ? [] : ["none"]);
          return;
        }
        setObSports(s => s.includes("none") ? [v] : s.includes(v) ? s.filter(x => x !== v) : [...s, v]);
      };
      const togglePri = v => setObPriorities(s => s.includes(v) ? s.filter(x => x !== v) : s.length < 3 ? [...s, v] : s);
      return <div className={"screen"}><div style={{
          height: 3,
          background: "rgba(180,172,158,.1)",
          borderRadius: R.r2,
          marginBottom: S.s18,
          overflow: "hidden"
        }}><div style={{
            height: "100%",
            width: prog,
            background: "#b4ac9e",
            borderRadius: R.r2,
            transition: "width .3s"
          }} /></div><div style={{
          fontSize: FS.fs62,
          color: "#8a8478",
          letterSpacing: ".14em",
          textTransform: "uppercase",
          marginBottom: S.s6
        }}>{`Step ${obStep} of 6`}</div>{obStep === 1 && <div><h1 className={"title"} style={{
            fontSize: "clamp(1.4rem,4vw,2rem)"
          }}>{"Create Your Build"}</h1><div className={"card"} style={{
            display: "flex",
            flexDirection: "column",
            gap: S.s14
          }}><div style={{
              display: "flex",
              gap: S.s10
            }}><div className={"field"} style={{
                flex: 1
              }}><label>{"First Name"}</label><input className={"inp"} value={obFirstName} onChange={e => setObFirstName(e.target.value)} placeholder={"First name"} /></div><div className={"field"} style={{
                flex: 1
              }}><label>{"Last Name"}</label><input className={"inp"} value={obLastName} onChange={e => setObLastName(e.target.value)} placeholder={"Last name"} /></div></div><div className={"field"}><label>{"Display Name "}<span style={{
                  fontSize: FS.fs55,
                  opacity: .6
                }}>{"(shown publicly)"}</span></label><input className={"inp"} value={obName} onChange={e => setObName(e.target.value)} placeholder={"Your gamertag or nickname\u2026"} /></div><div style={{
              display: "flex",
              gap: S.s10
            }}><div className={"field"} style={{
                flex: 1
              }}><label>{"Age "}<span style={{
                    fontSize: FS.fs55,
                    opacity: .6
                  }}>{"(optional)"}</span></label><input className={"inp"} type={"number"} min={"13"} max={"99"} value={obAge} onChange={e => setObAge(e.target.value)} placeholder={"25"} /></div><div className={"field"} style={{
                flex: 1
              }}><label>{"Sex "}<span style={{
                    fontSize: FS.fs55,
                    opacity: .6
                  }}>{"(optional)"}</span></label><div style={{
                  display: "flex",
                  gap: S.s6,
                  flexWrap: "wrap",
                  marginTop: S.s4
                }}>{["Male", "Female", "Other"].map(g => <button key={g} className={`gender-btn ${obGender === g ? "sel" : ""}`} onClick={() => setObGender(prev => prev === g ? "" : g)}>{g}</button>)}</div></div></div><div style={{
              display: "flex",
              gap: S.s10
            }}><div className={"field"} style={{
                flex: 1
              }}><label>{"State"}</label><select className={"inp"} value={obState} onChange={e => setObState(e.target.value)} style={{
                  cursor: "pointer"
                }}><option value={""}>{"Select State"}</option>{["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"].map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className={"field"} style={{
                flex: 1
              }}><label>{"Country"}</label><select className={"inp"} value={obCountry} onChange={e => setObCountry(e.target.value)} style={{
                  cursor: "pointer"
                }}>{["United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Mexico", "Brazil", "India", "Japan", "South Korea", "Philippines", "Other"].map(c => <option key={c} value={c}>{c}</option>)}</select></div></div><button className={"btn btn-gold"} disabled={!obName.trim() || !obFirstName.trim() || !obLastName.trim() || !obState || !obCountry} onClick={() => setObStep(2)}>{"Continue →"}</button></div></div>}{obStep === 2 && <div><h1 className={"title"} style={{
            fontSize: "clamp(1.3rem,4vw,1.9rem)"
          }}>{"Athletic History"}</h1><p style={{
            color: "#8a8478",
            fontSize: FS.fs82,
            marginBottom: S.s12
          }}>{"Select all sports you've played — past or present. This is your strongest class signal."}</p><div style={{
            marginBottom: S.s16
          }}>{OB_SPORTS.map(s => <span key={s.val} style={chipSt(obSports.includes(s.val))} onClick={() => toggleSport(s.val)}>{s.label}</span>)}</div><div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-ghost"} onClick={() => setObStep(1)}>{"← Back"}</button><button className={"btn btn-gold"} onClick={() => setObStep(3)}>{"Continue →"}</button></div></div>}{obStep === 3 && <div><h1 className={"title"} style={{
            fontSize: "clamp(1.3rem,4vw,1.9rem)"
          }}>{"Current Routine"}</h1><p style={{
            color: "#8a8478",
            fontSize: FS.fs82,
            marginBottom: S.s12
          }}>{"How often do you work out today? Be honest — this calibrates your starting stats."}</p>{[{
            val: "never",
            label: "Just getting started",
            sub: "Little to no workout history"
          }, {
            val: "light",
            label: "1–2 times a week",
            sub: "Casual, inconsistent routine"
          }, {
            val: "moderate",
            label: "3–4 times a week",
            sub: "Solid habit, building consistency"
          }, {
            val: "dedicated",
            label: "5–6 times a week",
            sub: "Dedicated athlete"
          }, {
            val: "elite",
            label: "Daily or twice a day",
            sub: "Elite training volume"
          }].map(o => <div key={o.val} style={radioSt(obFreq === o.val)} onClick={() => setObFreq(o.val)}><div><div style={{
                fontSize: FS.fs82,
                fontWeight: 600,
                color: obFreq === o.val ? "#d4cec4" : "#b4ac9e"
              }}>{o.label}</div><div style={{
                fontSize: FS.lg,
                color: "#8a8478",
                marginTop: S.s2
              }}>{o.sub}</div></div></div>)}<div style={{
            display: "flex",
            gap: S.s8,
            marginTop: S.s6
          }}><button className={"btn btn-ghost"} onClick={() => setObStep(2)}>{"← Back"}</button><button className={"btn btn-gold"} disabled={!obFreq} onClick={() => setObStep(4)}>{"Continue →"}</button></div></div>}{obStep === 4 && <div><h1 className={"title"} style={{
            fontSize: "clamp(1.3rem,4vw,1.9rem)"
          }}>{"Discipline Trait"}</h1><p style={{
            color: "#8a8478",
            fontSize: FS.fs82,
            marginBottom: S.s12
          }}>{"When do you usually work out? Timing unlocks hidden character traits."}</p>{[{
            val: "earlymorning",
            label: "Early morning (before 7am)",
            sub: "⚡ Iron Discipline — +WIS +CON boost. One of the rarest traits."
          }, {
            val: "morning",
            label: "Morning (7am–12pm)",
            sub: "☀️ Disciplined — +WIS boost"
          }, {
            val: "afternoon",
            label: "Afternoon (12pm–5pm)",
            sub: "Balanced — no trait modifier"
          }, {
            val: "evening",
            label: "Evening (5pm–9pm)",
            sub: "🌙 Night Owl — +VIT boost"
          }, {
            val: "varies",
            label: "It varies / no routine yet",
            sub: "No trait — earn one as you build your routine"
          }].map(o => <div key={o.val} style={radioSt(obTiming === o.val)} onClick={() => setObTiming(o.val)}><div><div style={{
                fontSize: FS.fs82,
                fontWeight: 600,
                color: obTiming === o.val ? "#d4cec4" : "#b4ac9e"
              }}>{o.label}</div><div style={{
                fontSize: FS.lg,
                color: "#8a8478",
                marginTop: S.s2
              }}>{o.sub}</div></div></div>)}<div style={{
            display: "flex",
            gap: S.s8,
            marginTop: S.s6
          }}><button className={"btn btn-ghost"} onClick={() => setObStep(3)}>{"← Back"}</button><button className={"btn btn-gold"} disabled={!obTiming} onClick={() => setObStep(5)}>{"Continue →"}</button></div></div>}{obStep === 5 && <div><h1 className={"title"} style={{
            fontSize: "clamp(1.3rem,4vw,1.9rem)"
          }}>{"Fitness Identity"}</h1><p style={{
            color: "#8a8478",
            fontSize: FS.fs82,
            marginBottom: S.s12
          }}>{"Pick up to 3 that best describe your mindset. These shape your stat affinity."}</p><div style={{
            marginBottom: S.s12
          }}>{OB_PRIORITIES.map(p => <span key={p.val} style={chipSt(obPriorities.includes(p.val))} onClick={() => togglePri(p.val)}>{p.label}</span>)}<div style={{
              fontSize: FS.fs68,
              color: "#8a8478",
              marginTop: S.s6,
              fontStyle: "italic"
            }}>{`${obPriorities.length}/3 selected`}</div></div><div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-ghost"} onClick={() => setObStep(4)}>{"← Back"}</button><button className={"btn btn-gold"} onClick={() => setObStep(6)}>{"Continue →"}</button></div></div>}{obStep === 6 && <div><h1 className={"title"} style={{
            fontSize: "clamp(1.3rem,4vw,1.9rem)"
          }}>{"Training Style"}</h1><p style={{
            color: "#8a8478",
            fontSize: FS.fs82,
            marginBottom: S.s12
          }}>{"Your natural approach to fitness — this fine-tunes your class assignment."}</p>{[{
            val: "heavy",
            label: "Heavy compound lifts",
            sub: "Squats, deadlifts, bench — I chase weight on the bar"
          }, {
            val: "cardio",
            label: "Cardio & endurance",
            sub: "Running, cycling, swimming — I chase distance and time"
          }, {
            val: "sculpt",
            label: "Sculpting & aesthetics",
            sub: "Isolation work and volume — I chase the look"
          }, {
            val: "hiit",
            label: "HIIT & explosive power",
            sub: "Short intense bursts, circuits, functional fitness"
          }, {
            val: "mindful",
            label: "Mindful movement",
            sub: "Yoga, mobility, breath work — mind-body connection"
          }, {
            val: "sport",
            label: "Sport-specific training",
            sub: "I train to compete or perform — sport is the goal"
          }, {
            val: "mixed",
            label: "I mix everything",
            sub: "No single focus — variety keeps me going"
          }].map(o => <div key={o.val} style={radioSt(obStyle === o.val)} onClick={() => setObStyle(o.val)}><div><div style={{
                fontSize: FS.fs82,
                fontWeight: 600,
                color: obStyle === o.val ? "#d4cec4" : "#b4ac9e"
              }}>{o.label}</div><div style={{
                fontSize: FS.lg,
                color: "#8a8478",
                marginTop: S.s2
              }}>{o.sub}</div></div></div>)}<div style={{
            display: "flex",
            gap: S.s8,
            marginTop: S.s6
          }}><button className={"btn btn-ghost"} onClick={() => setObStep(5)}>{"← Back"}</button><button className={"btn btn-gold"} disabled={!obStyle} onClick={handleOnboard}>{"Forge My Character →"}</button></div></div>}</div>;
    })()

    /* ══ CLASS REVEAL ═══════════════════════════ */}{screen === "classReveal" && detectedClass && (() => {
      const dc = CLASSES[detectedClass];
      return <div className={"screen"} style={{
        "--cls-color": dc.color,
        "--cls-glow": dc.glow
      }}><p style={{
          color: "#8a8478",
          fontSize: FS.md,
          letterSpacing: ".14em",
          textTransform: "uppercase"
        }}>{"The Fates have spoken…"}</p><div className={"reveal-card"} style={{
          "--cls-color": dc.color,
          "--cls-glow": dc.glow
        }}><span className={"reveal-icon"}>{dc.icon}</span><div className={"reveal-name"}>{dc.name}</div><p style={{
            color: "#8a8478",
            fontStyle: "italic",
            lineHeight: 1.5,
            fontSize: FS.fs90
          }}>{dc.description}</p><div className={"traits"} style={{
            justifyContent: "center",
            marginTop: S.s12
          }}>{dc.traits.map(t => <span key={t} className={"trait"} style={{
              "--cls-color": dc.color,
              "--cls-glow": dc.glow
            }}>{t}</span>)}</div></div><div style={{
          display: "flex",
          gap: S.s12,
          flexWrap: "wrap",
          justifyContent: "center"
        }}><button className={"btn btn-gold"} onClick={() => confirmClass(detectedClass)}>{"Accept My Fate"}</button><button className={"btn btn-ghost"} onClick={() => setScreen("classPick")}>{"Choose Differently"}</button></div></div>;
    })()

    /* ══ CLASS PICK ═════════════════════════════ */}{screen === "classPick" && <div className={"screen"}><h1 className={"title"} style={{
        fontSize: "clamp(1.2rem,4vw,1.7rem)"
      }}>{"Choose Your Path"}</h1><p style={{
        color: "#8a8478",
        fontSize: FS.fs75,
        marginBottom: S.s12,
        textAlign: "center"
      }}>{"Locked classes unlock through future updates. Class changes after setup require a paid reset."}</p><div className={"cls-grid"}>{Object.entries(CLASSES).map(([key, c]) => <div key={key} className={`cls-card ${profile.chosenClass === key ? "sel" : ""} ${c.locked ? "cls-locked" : ""}`} style={{
          "--bc": c.color,
          opacity: c.locked ? 0.4 : 1,
          cursor: c.locked ? "not-allowed" : "pointer"
        }} onClick={() => {
          if (!c.locked) setProfile(p => ({
            ...p,
            chosenClass: key
          }));
        }}><div style={{
            height: "2.2rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: S.s8
          }}><ClassIcon classKey={key} size={32} color={c.glow} /></div><div style={{
            fontFamily: "'Inter',sans-serif",
            fontSize: FS.fs63,
            color: c.glow
          }}>{c.name}</div>{c.locked && <div style={{
            fontSize: FS.fs58,
            color: "#8a8478",
            marginTop: S.s2
          }}>{"🔒 Coming Soon"}</div>}{!c.locked && <div style={{
            fontSize: FS.fs74,
            color: "#8a8478",
            marginTop: S.s4,
            lineHeight: 1.4
          }}>{c.description}</div>}</div>)}</div><button className={"btn btn-gold"} disabled={!profile.chosenClass} onClick={() => confirmClass(profile.chosenClass)}>{"Confirm Class"}</button></div>

    /* ══ MAIN ═══════════════════════════════════ */}{screen === "main" && clsKey && <div className={"hud"} style={activeTab === "messages" && msgView === "chat" ? {
      maxHeight: "100dvh",
      overflow: "hidden"
    } : {}}><div className={"hud-top"}><div className={"ava"} style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}><ClassIcon classKey={profile.chosenClass} size={26} color={cls.glow} /></div><div className={"hud-info"}><div className={"hud-name"}>{profile.playerName}</div><div className={"hud-sub"}>{cls.name}{profile.gym ? ` · ${profile.gym}` : ""}</div>{(profile.hudFields?.weight || profile.hudFields?.height || profile.hudFields?.bmi) && <div className={"hud-body"}>{profile.hudFields?.weight && profile.weightLbs ? isMetric(profile.units) ? lbsToKg(profile.weightLbs) + " kg" : profile.weightLbs + " lbs" : ""}{profile.hudFields?.weight && profile.weightLbs && profile.hudFields?.height && totalH > 0 ? " · " : ""}{profile.hudFields?.height && totalH > 0 ? isMetric(profile.units) ? ftInToCm(profile.heightFt, profile.heightIn) + " cm" : `${profile.heightFt}'${profile.heightIn}"` : ""}{profile.hudFields?.bmi && bmi ? `${profile.hudFields?.weight || profile.hudFields?.height ? " · " : ""}BMI ${bmi}` : ""}</div>}<div className={"xp-track"}><div className={"xp-fill"} style={{
              width: `${Math.min(progress, 100)}%`
            }} /></div><div className={"xp-lbl"}><span>{(profile.xp - curXP).toLocaleString()}{" / "}{formatXP(nxtXP - curXP)}</span><span>{"→ Lv "}{level + 1}</span></div></div><div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: S.s4,
          position: "relative",
          flexShrink: 0
        }}><button className={"btn nav-menu-btn btn-ghost"} style={{
            position: "relative"
          }} onClick={() => setNavMenuOpen(v => !v)}>{"☰"}{msgUnreadTotal > 0 && <div style={{
              position: "absolute",
              top: 1,
              right: 2,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: UI_COLORS.danger,
              border: "1.5px solid #0c0c0a"
            }} />}</button><div style={{
            textAlign: "right"
          }}><div className={"hud-lv"}>{level}</div><div className={"hud-lv-lbl"}>{"Level"}</div><div style={{
              fontSize: FS.fs48,
              color: "#8a8478",
              textAlign: "right",
              marginTop: S.s2,
              letterSpacing: ".03em",
              fontFamily: "'Inter',sans-serif"
            }}>{new Date().toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric"
              })}</div></div></div></div>

      {
        /* ══ DROPDOWN MENU — rendered outside hud-top to escape backdrop-filter stacking context ══ */
      }{navMenuOpen && <div onClick={() => setNavMenuOpen(false)} style={{
        position: "fixed",
        inset: 0,
        zIndex: 900
      }} />}{navMenuOpen && <div className={"nav-menu-panel"}>{[{
          icon: "⚔️",
          label: "Profile",
          action: () => guardAll(() => {
            setActiveTab("profile");
            setNavMenuOpen(false);
          })
        }, {
          icon: "📜",
          label: "Plans",
          action: () => guardAll(() => {
            setActiveTab("plans");
            plansContainerRef.current?.showList();
            setNavMenuOpen(false);
          })
        }, {
          icon: "📖",
          label: "Battle Log",
          action: () => guardAll(() => {
            setActiveTab("history");
            setNavMenuOpen(false);
          })
        }, {
          icon: "🏆",
          label: "Leaderboard",
          action: () => guardAll(() => {
            setActiveTab("leaderboard");
            setNavMenuOpen(false);
          })
        }, {
          icon: "💬",
          label: "Messages",
          action: () => guardAll(() => {
            setActiveTab("messages");
            setMsgView("list");
            loadConversations();
            setNavMenuOpen(false);
          }),
          badge: msgUnreadTotal || null,
          badgeDanger: true
        }, {
          icon: "🎯",
          label: "Quests",
          action: () => guardAll(() => {
            setActiveTab("quests");
            setNavMenuOpen(false);
          }),
          badge: pendingQuestCount
        },
        // Map feature hidden — re-enable when ready
        // {icon:"🗺", label:"Map",         action:()=>{setMapOpen(true);setNavMenuOpen(false);}},
        isAdmin && {
          icon: "🛡️",
          label: "Admin",
          action: () => {
            setScreen("admin");
            setNavMenuOpen(false);
          }
        },
        {
          icon: "🛟",
          label: "Support",
          action: () => {
            setFeedbackOpen(true);
            setFeedbackSent(false);
            setFeedbackText("");
            setFeedbackEmail(_optionalChain([authUser, 'optionalAccess', _a => _a.email]) || "");
            setFeedbackAccountId(myPublicId || "");
            setFeedbackType("help");
            setHelpConfirmShown(false);
            setNavMenuOpen(false);
          }
        }, authUser && {
          icon: "🚪",
          label: "Sign Out",
          action: () => {
            signOut();
            setNavMenuOpen(false);
          },
          danger: true
        }, !authUser && {
          icon: "🚪",
          label: "Exit Preview",
          action: () => {
            setIsPreviewMode(false); // exit preview mode so future saves persist
            setScreen("landing");
            setProfile(EMPTY_PROFILE);
            setNavMenuOpen(false);
          },
          danger: true
        }].filter(Boolean).map(item => <button key={item.label} className={"nav-menu-item"} style={item.danger ? {
          color: "#7A2838",
          borderTop: "1px solid rgba(180,172,158,.04)"
        } : {}} onClick={item.action}>{item.icon}{" "}{item.label}{item.badge > 0 && <span className={"nav-menu-badge"} style={item.badgeDanger ? {
            background: UI_COLORS.danger,
            color: "#fff"
          } : {}}>{item.badge}</span>}</button>)}</div>

      /* ══ BOTTOM TAB BAR — fixed iOS material ══ */}<div className={"hud-nav-panel"}><div className={"tabs"}>{[["workout", "Exercises", "mdi:dumbbell"], ["workouts", "Workouts", "mdi:weight-lifter"], ["calendar", "Calendar", "mdi:calendar-blank"], ["character", "Character", "game-icons:crossed-swords"], ["social", "Guild", "game-icons:tribal-pendant"]].map(([t, l, iconName]) => {
            const isOn = activeTab === t;
            const tabColor = isOn ? "#d4cec4" : "#8a8478";
            const iconPath = iconName.replace(":", "/");
            const iconSrc = `https://api.iconify.design/${iconPath}.svg?color=${encodeURIComponent(tabColor)}`;
            return <button key={t} className={`tab ${isOn ? "on" : ""}`} onClick={() => guardAll(() => {
              setActiveTab(t);
              if (t === "workouts") setWorkoutView("list");
              if (t === "social" && authUser) {
                loadSocialData();
                loadIncomingShares();
              }
            })}><span className={"tab-icon"}><img src={iconSrc} alt={""} width={22} height={22} style={{
                  display: "block"
                }} /></span><span className={"tab-label"}>{l}</span>{t === "social" && friendRequests.length + incomingShares.length > 0 && <span className={"tab-badge"}>{friendRequests.length + incomingShares.length}</span>}</button>;
          })}</div></div><div className={"scroll-area"} style={activeTab === "messages" && msgView === "chat" ? {
        overflowY: "hidden",
        display: "flex",
        flexDirection: "column",
        paddingBottom: 0
      } : {}}>{activeTab === "workout" && <><div className={"hud-checkin-strip"}><span style={{
              fontSize: "1.05rem"
            }}>{"🔥"}</span><span style={{
              fontSize: FS.fs88,
              fontWeight: 700,
              color: "#b4ac9e"
            }}>{profile.checkInStreak}</span><span style={{
              fontSize: FS.fs58,
              color: "#8a8478"
            }}>{"day streak"}</span><div style={{
              flex: 1
            }} /><button style={{
              fontSize: FS.fs50,
              color: "#8a8478",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px"
            }} onClick={() => {
              setRetroCheckInModal(true);
              setRetroDate("");
            }}>{"↺ Retro"}</button><button style={{
              fontSize: FS.fs50,
              color: "#c49428",
              background: "transparent",
              border: "1px solid rgba(196,148,40,.2)",
              borderRadius: R.md,
              cursor: "pointer",
              padding: "4px 8px"
            }} onClick={() => setShowWNMockup(true)}>{"📲 Notification"}</button><button style={{
              padding: "8px 16px",
              borderRadius: R.lg,
              fontSize: FS.fs54,
              fontWeight: 600,
              border: "1px solid rgba(180,172,158,.08)",
              background: "linear-gradient(135deg,rgba(45,42,36,.45),rgba(45,42,36,.3))",
              color: "#d4cec4",
              cursor: "pointer",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              letterSpacing: ".04em"
            }} disabled={profile.lastCheckIn === todayStr()} onClick={doCheckIn}>{profile.lastCheckIn === todayStr() ? "✓ Checked In" : "Check In"}</button></div>

          {
            /* ══ EXERCISES SUB-TAB BAR ══ */
          }<div className={"log-subtab-bar"} style={{
            marginBottom: S.s14
          }}>{[["library", "📖 Library"], ["myworkouts", "💪 My Exercises"]].map(([t, l]) => <button key={t} className={`log-subtab-btn ${exSubTab === t ? "on" : ""}`} onClick={() => setExSubTab(t)}>{l}</button>)}</div>

          {
            /* ══ LOG SUB-TAB (original grimoire view) ══ */
          }{exSubTab === "log" && <><div className={"techniques-header"}><div className={"tech-hdr-left"}><div className={"tech-ornament-line tech-ornament-line-l"} /><span className={"tech-hdr-title"}>{"✦ Techniques ✦"}</span><div className={"tech-ornament-line tech-ornament-line-r"} /></div></div>

            {
              /* ══ TECHNIQUE SEARCH ══ */
            }<div className={"tech-search-wrap"}><span className={"tech-search-icon"}>{"🔍"}</span><input className={"tech-search-inp"} placeholder={"Search Techniques…"} value={exSearch} onChange={e => setExSearch(e.target.value)} />{exSearch && <span className={"tech-search-clear"} onClick={() => setExSearch("")}>{"✕"}</span>}</div>

            {
              /* ══ FILTERS ══ */
            }<div className={"filter-section"}><div className={"filter-pills-row"}>{[{
                  cat: "strength",
                  icon: "⚔",
                  label: "Strength"
                }, {
                  cat: "cardio",
                  icon: "🏃",
                  label: "Cardio"
                }, {
                  cat: "flexibility",
                  icon: "🧘",
                  label: "Flexibility"
                }, {
                  cat: "endurance",
                  icon: "🛡",
                  label: "Endurance"
                }].map(({
                  cat,
                  icon,
                  label
                }) => <div key={cat} className={`filter-pill filter-${cat} ${exCatFilters.has(cat) ? "on" : ""}`} onClick={() => setExCatFilters(s => {
                  const n = new Set(s);
                  n.has(cat) ? n.delete(cat) : n.add(cat);
                  return n;
                })}><span className={"filter-pill-icon"}>{icon}</span>{label}</div>)}</div><div className={"filter-controls-row"}><div style={{
                  position: "relative",
                  flexShrink: 0
                }}><button className={`muscle-filter-btn ${exMuscleFilter !== "All" ? "active" : ""}`} onClick={() => setMusclePickerOpen(s => !s)}>{"🏋️ "}{exMuscleFilter === "All" ? "Muscles" : exMuscleFilter.charAt(0).toUpperCase() + exMuscleFilter.slice(1)}<svg width={"10"} height={"10"} viewBox={"0 0 14 14"} fill={"none"} style={{
                      marginLeft: S.s4,
                      transition: "transform .2s",
                      transform: musclePickerOpen ? "rotate(180deg)" : "rotate(0deg)"
                    }}><polyline points={"3,5 7,9 11,5"} stroke={"currentColor"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></button>{musclePickerOpen && <div style={{
                    position: "absolute",
                    top: "110%",
                    left: 0,
                    zIndex: 20,
                    background: "linear-gradient(145deg,#0c0c0a,#0c0c0a)",
                    border: "1px solid rgba(180,172,158,.06)",
                    borderRadius: R.r10,
                    padding: S.s10,
                    minWidth: 180,
                    maxWidth: "calc(100vw - 24px)",
                    boxShadow: "0 8px 32px rgba(0,0,0,.7)"
                  }}><div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: S.s8
                    }}><span style={{
                        fontSize: FS.sm,
                        color: "#8a8478",
                        textTransform: "uppercase",
                        letterSpacing: ".08em"
                      }}>{"Muscle Group"}</span><span style={{
                        fontSize: FS.fs65,
                        color: "#b4ac9e",
                        cursor: "pointer"
                      }} onClick={() => {
                        setExMuscleFilter("All");
                        setMusclePickerOpen(false);
                      }}>{"Clear"}</span></div>{["chest", "shoulder", "bicep", "tricep", "legs", "back", "glutes", "abs", "calves", "forearm", "cardio"].map(mg => <div key={mg} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s8,
                      padding: "5px 0",
                      cursor: "pointer",
                      borderBottom: "1px solid rgba(45,42,36,.15)"
                    }} onClick={() => {
                      setExMuscleFilter(exMuscleFilter === mg ? "All" : mg);
                      setMusclePickerOpen(false);
                    }}><div style={{
                        width: 14,
                        height: 14,
                        borderRadius: R.r3,
                        border: `1.5px solid ${exMuscleFilter === mg ? getMuscleColor(mg) : "rgba(180,172,158,.08)"}`,
                        background: exMuscleFilter === mg ? "rgba(45,42,36,.3)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                      }}>{exMuscleFilter === mg && <span style={{
                          color: getMuscleColor(mg),
                          fontSize: FS.fs55
                        }}>{"✓"}</span>}</div><span style={{
                        fontSize: FS.lg,
                        color: exMuscleFilter === mg ? getMuscleColor(mg) : "#8a8478",
                        textTransform: "capitalize"
                      }}>{mg}</span></div>)}</div>}</div><div className={`filter-pill filter-favs ${showFavsOnly ? "on" : ""}`} onClick={() => setShowFavsOnly(v => !v)} style={{
                  marginLeft: "auto"
                }}><span className={"filter-pill-icon"}>{"⭐"}</span>{"Favorites"}</div><button className={`filter-select-btn ${multiMode ? "active" : ""}`} onClick={() => {
                  setMultiMode(m => !m);
                  setMultiSelEx(() => new Set());
                  setSelEx(null);
                }}>{multiMode ? "✕ Cancel" : "⊞ Select"}</button></div></div>

            {
              /* ══ COMMAND ACTION BAR ══ */
            }{multiMode && multiSelEx.size > 0 && <div className={"command-action-bar"}><div className={"cab-count"}><span className={"cab-rune"}>{"⊞"}</span><span className={"cab-num"}>{multiSelEx.size}</span></div><div className={"cab-actions"}><button className={"cab-btn"} onClick={() => {
                  const ids = [...multiSelEx];
                  setSpwSelected(ids);
                  setSavePlanWizard({
                    entries: ids.map(id => ({
                      exId: id,
                      exercise: _optionalChain([allExById, 'access', _ => _[id], 'optionalAccess', _ => _.name]),
                      icon: _optionalChain([allExById, 'access', _ => _[id], 'optionalAccess', _ => _.icon]),
                      _idx: id
                    })),
                    label: "Selected Exercises"
                  });
                  setSpwName("Selected Exercises");
                  setSpwIcon("📋");
                  setSpwDate("");
                  setSpwMode("new");
                  setSpwTargetPlanId(null);
                  setMultiMode(false);
                  setMultiSelEx(() => new Set());
                }}>{"📋 Add to Plan"}</button><button className={"cab-btn"} onClick={() => {
                  const exs = [...multiSelEx].map(id => {
                    const e = allExById[id];
                    return {
                      exId: id,
                      sets: _optionalChain([e, 'optionalAccess', _ => _.defaultSets]) || 3,
                      reps: _optionalChain([e, 'optionalAccess', _ => _.defaultReps]) || 10,
                      weightLbs: _optionalChain([e, 'optionalAccess', _ => _.defaultWeightLbs]) || null,
                      durationMin: _optionalChain([e, 'optionalAccess', _ => _.defaultDurationMin]) || null,
                      weightPct: 100,
                      distanceMi: null,
                      hrZone: null
                    };
                  });
                  setAddToWorkoutPicker({
                    exercises: exs
                  });
                  setMultiMode(false);
                  setMultiSelEx(() => new Set());
                }}>{"➕ Workout"}</button><button className={"cab-btn"} onClick={() => {
                  const exs = [...multiSelEx].map(id => {
                    const e = allExById[id];
                    return {
                      exId: id,
                      sets: _optionalChain([e, 'optionalAccess', _ => _.defaultSets]) || 3,
                      reps: _optionalChain([e, 'optionalAccess', _ => _.defaultReps]) || 10,
                      weightLbs: _optionalChain([e, 'optionalAccess', _ => _.defaultWeightLbs]) || null,
                      durationMin: _optionalChain([e, 'optionalAccess', _ => _.defaultDurationMin]) || null,
                      weightPct: 100,
                      distanceMi: null,
                      hrZone: null
                    };
                  });
                  setWbExercises(exs);
                  setWbName("");
                  setWbIcon("💪");
                  setWbDesc("");
                  setWbEditId(null);
                  setWorkoutView("builder");
                  setActiveTab("workouts");
                  setMultiMode(false);
                  setMultiSelEx(() => new Set());
                }}>{"💪 Reusable"}</button></div></div>

            /* ══ GRIMOIRE GRID ══ */}{(() => {
              const q = exSearch.toLowerCase().trim();
              const favs = profile.favoriteExercises || [];
              const filtered = allExercises.filter(ex => (exCatFilters.size === 0 || exCatFilters.has(ex.category) || ex.secondaryCategory && exCatFilters.has(ex.secondaryCategory)) && (exMuscleFilter === "All" || ex.muscleGroup === exMuscleFilter) && (!showFavsOnly || favs.includes(ex.id)) && (q === "" || ex.name.toLowerCase().includes(q)));
              const toggleFav = (e, exId) => {
                e.stopPropagation();
                setProfile(p => ({
                  ...p,
                  favoriteExercises: (p.favoriteExercises || []).includes(exId) ? (p.favoriteExercises || []).filter(id => id !== exId) : [...(p.favoriteExercises || []), exId]
                }));
              };
              return <>{filtered.length === 0 && <div className={"empty"} style={{
                  padding: "20px 0"
                }}>{"No techniques found in the grimoire."}</div>}<div className={"grimoire-grid"}><div className={"grimoire-card grimoire-add-card"} onClick={() => openExEditor("create", null)}><span className={"grim-add-icon"}>{"＋"}</span><span className={"grim-add-label"}>{"New Technique"}</span></div>{filtered.map(ex => {
                    const m = getMult(ex),
                      isB = m > 1.02,
                      isP = m < 0.98;
                    const isMultiSel = multiSelEx.has(ex.id);
                    const isFav = favs.includes(ex.id);
                    const catColor = getTypeColor(ex.category);
                    return <div key={ex.id} className={`grimoire-card ${multiMode && isMultiSel ? "grim-multi-sel" : ""} ${!multiMode && selEx === ex.id ? "grim-sel" : ""}`} style={{
                      "--cat-color": catColor
                    }} onClick={() => {
                      if (multiMode) {
                        setMultiSelEx(s => {
                          const n = new Set(s);
                          n.has(ex.id) ? n.delete(ex.id) : n.add(ex.id);
                          return n;
                        });
                      } else {
                        const toggling = selEx === ex.id;
                        setSelEx(toggling ? null : ex.id);
                        setMusclePickerOpen(false);
                        if (!toggling) {
                          setSets("");
                          setReps("");
                          setExWeight("");
                          setWeightPct(100);
                          setDistanceVal("");
                          setHrZone(null);
                          setExHHMM("");
                          setExSec("");
                          setQuickRows([]);
                        }
                      }
                    }}>{multiMode && <div className={`grim-checkbox ${isMultiSel ? "checked" : ""}`}>{isMultiSel && "✓"}</div>}<div className={`grim-mult ${isB ? "grim-bonus" : isP ? "grim-penalty" : "grim-neutral"}`}>{Math.round(m * 100) + "%"}</div><div className={"grim-icon-orb"} style={{
                        "--cat-color": catColor
                      }}><span className={"grim-icon"}>{ex.icon}</span></div><div className={"grim-body"}><div className={"grim-name"}>{ex.name}{ex.custom && <span className={"custom-ex-badge"}>{"custom"}</span>}</div><div className={"grim-meta"}><span className={"grim-xp"}>{ex.baseXP + " XP"}</span><span className={"grim-sep"}>{"·"}</span><span className={"grim-muscle"} style={{
                            color: getMuscleColor(ex.muscleGroup)
                          }}>{ex.muscles || ex.muscleGroup}</span></div></div>{!multiMode && <div className={"grim-info-btn"} onClick={e => {
                        e.stopPropagation();
                        setDetailEx(ex);
                        setDetailImgIdx(0);
                      }}>{"ℹ"}</div>}{!multiMode && <div className={`grim-fav-btn ${isFav ? "faved" : ""}`} onClick={e => toggleFav(e, ex.id)}>{isFav ? "⭐" : "☆"}</div>}</div>;
                  })}</div></>;
            })()}</>

          /* ══ LIBRARY SUB-TAB ══ */}{exSubTab === "library" && (() => {
            const TYPE_OPTS = ["strength", "cardio", "flexibility", "yoga", "stretching", "plyometric", "calisthenics", "functional", "isometric", "warmup", "cooldown"];
            const TYPE_LABELS = {
              strength: "⚔️ Strength",
              cardio: "🏃 Cardio",
              flexibility: "🧘 Flexibility",
              yoga: "🧘 Yoga",
              stretching: "🌿 Stretch",
              plyometric: "⚡ Plyo",
              calisthenics: "🤸 Cali",
              functional: "🔧 Functional",
              isometric: "🧱 Isometric",
              warmup: "🌅 Warmup",
              cooldown: "🌙 Cooldown"
            };
            const ALL_MUSCLE_OPTS = ["chest", "back", "shoulder", "bicep", "tricep", "legs", "glutes", "abs", "calves", "forearm", "full_body", "cardio"];
            const ALL_EQUIP_OPTS = ["barbell", "dumbbell", "kettlebell", "cable", "machine", "bodyweight", "band"];
            const toggleSet = (setter, val) => {
              setter(s => {
                const n = new Set(s);
                n.has(val) ? n.delete(val) : n.add(val);
                return n;
              });
              setLibVisibleCount(60);
            };
            const clearAll = () => {
              setLibTypeFilters(new Set());
              setLibMuscleFilters(new Set());
              setLibEquipFilters(new Set());
              setLibSearch("");
              setLibSearchDebounced("");
              setLibVisibleCount(60);
              setLibBrowseMode("home");
            };
            const hasFilters = libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0 || libSearch;
            const q2 = libSearchDebounced.toLowerCase().trim();

            // Filter function — checks all three filter sets (OR within each, AND across sets)
            const matchesFilters = (ex, tF, mF, eF) => {
              if (tF.size > 0) {
                const types = (ex.exerciseType || "").toLowerCase();
                const cat = (ex.category || "").toLowerCase();
                // match if any selected type appears in exerciseType string OR equals category
                if (![...tF].some(t => types.includes(t) || cat === t)) return false;
              }
              if (mF.size > 0) {
                const mg = (ex.muscleGroup || "").toLowerCase().trim();
                if (!mF.has(mg)) return false;
              }
              if (eF.size > 0) {
                const eq = (ex.equipment || "bodyweight").toLowerCase().trim();
                if (!eF.has(eq)) return false;
              }
              return true;
            };
            const libFiltered = allExercises.filter(ex => {
              if (q2 && !ex.name.toLowerCase().includes(q2)) return false;
              return matchesFilters(ex, libTypeFilters, libMuscleFilters, libEquipFilters);
            });

            // Cascading: which muscle groups are available given current type+equip filters?
            const availableMuscles = new Set(allExercises.filter(ex => matchesFilters(ex, libTypeFilters, new Set(), libEquipFilters)).map(ex => (ex.muscleGroup || "").toLowerCase().trim()).filter(Boolean));
            // Which equipment types are available given current type+muscle filters?
            const availableEquip = new Set(allExercises.filter(ex => matchesFilters(ex, libTypeFilters, libMuscleFilters, new Set())).map(ex => (ex.equipment || "bodyweight").toLowerCase().trim()).filter(Boolean));
            // Which types are available given current muscle+equip filters?
            const availableTypes = new Set(allExercises.filter(ex => matchesFilters(ex, new Set(), libMuscleFilters, libEquipFilters)).flatMap(ex => {
              const types = (ex.exerciseType || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
              const cat = (ex.category || "").toLowerCase();
              return cat ? [...types, cat] : types;
            }));
            const MUSCLE_OPTS = ALL_MUSCLE_OPTS.filter(m => availableMuscles.has(m) || libMuscleFilters.has(m));
            const EQUIP_OPTS = ALL_EQUIP_OPTS.filter(e => availableEquip.has(e) || libEquipFilters.has(e));
            const toggleSel = id => setLibSelected(s => {
              const n = new Set(s);
              n.has(id) ? n.delete(id) : n.add(id);
              return n;
            });

            /* ── Home view computed data ── */
            const hexRgba = (hex, a) => {
              const r = parseInt(hex.slice(1, 3), 16),
                g = parseInt(hex.slice(3, 5), 16),
                b = parseInt(hex.slice(5, 7), 16);
              return `rgba(${r},${g},${b},${a})`;
            };
            const MUSCLE_CARD_DATA = ALL_MUSCLE_OPTS.filter(m => m !== "full_body").map(mg => {
              const count = allExercises.filter(ex => (ex.muscleGroup || "").toLowerCase().trim() === mg).length;
              const meta = MUSCLE_META[mg] || {
                emoji: "💪",
                label: mg.charAt(0).toUpperCase() + mg.slice(1),
                icon: "game-icons:weight-lifting-up"
              };
              return {
                mg,
                label: meta.label,
                emoji: meta.emoji,
                icon: meta.icon,
                count,
                color: getMuscleColor(mg)
              };
            }).filter(d => d.count > 0);

            // Recent exercises — deduped from log, padded with favorites
            const recentExIds = [];
            const seenIds = new Set();
            for (const entry of (profile.log || []).slice(0, 100)) {
              if (entry.exId && !seenIds.has(entry.exId) && allExById[entry.exId]) {
                recentExIds.push(entry.exId);
                seenIds.add(entry.exId);
              }
              if (recentExIds.length >= 10) break;
            }
            for (const fId of profile.favoriteExercises || []) {
              if (!seenIds.has(fId) && allExById[fId]) {
                recentExIds.push(fId);
                seenIds.add(fId);
              }
              if (recentExIds.length >= 10) break;
            }
            const yourExercises = recentExIds.map(id => allExById[id]).filter(Boolean);

            // Discover rows
            const discoverRows = [{
              label: "Beginner Friendly",
              exercises: allExercises.filter(ex => (ex.baseXP || 0) < 45).slice(0, 15),
              onSeeAll: () => setLibBrowseMode("filtered")
            }, {
              label: "Advanced Challenges",
              exercises: allExercises.filter(ex => (ex.baseXP || 0) >= 60).slice(0, 15),
              onSeeAll: () => setLibBrowseMode("filtered")
            }].concat(_exercisesLoaded ? [{
              label: "Bodyweight Only",
              exercises: allExercises.filter(ex => (ex.equipment || "bodyweight").toLowerCase() === "bodyweight").slice(0, 15),
              onSeeAll: () => {
                setLibEquipFilters(new Set(["bodyweight"]));
                setLibBrowseMode("filtered");
              }
            }, {
              label: "Dumbbell Exercises",
              exercises: allExercises.filter(ex => (ex.equipment || "").toLowerCase() === "dumbbell").slice(0, 15),
              onSeeAll: () => {
                setLibEquipFilters(new Set(["dumbbell"]));
                setLibBrowseMode("filtered");
              }
            }, {
              label: "Barbell Essentials",
              exercises: allExercises.filter(ex => (ex.equipment || "").toLowerCase() === "barbell").slice(0, 15),
              onSeeAll: () => {
                setLibEquipFilters(new Set(["barbell"]));
                setLibBrowseMode("filtered");
              }
            }] : []);

            // Fade-edge scroll handler
            const handleHScroll = e => {
              const el = e.currentTarget;
              const wrap = el.parentElement;
              if (!wrap) return;
              const atLeft = el.scrollLeft > 8;
              const atRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 8;
              wrap.classList.toggle('fade-left', atLeft);
              wrap.classList.toggle('fade-right-off', !atRight);
            };
            return <div> {
                /* Sticky search bar — translucent material */
              }
              <div className={"lib-sticky-search"}><div style={{
                  display: "flex",
                  gap: S.s8,
                  alignItems: "center"
                }}><div className={"tech-search-wrap"} style={{
                    flex: 1,
                    marginBottom: S.s0
                  }}><span className={"tech-search-icon"}>{"🔍"}</span><input className={"tech-search-inp"} placeholder={`Search ${allExercises.length} exercises…`} value={libSearch} onChange={e => {
                      const v = e.target.value;
                      setLibSearch(v);
                      debouncedSetLibSearch(v);
                      if (v && libBrowseMode === "home") setLibBrowseMode("filtered");
                    }} />{libSearch && <span className={"tech-search-clear"} onClick={() => {
                      setLibSearch("");
                      setLibSearchDebounced("");
                      setLibVisibleCount(60);
                      if (libMuscleFilters.size === 0 && libTypeFilters.size === 0 && libEquipFilters.size === 0) setLibBrowseMode("home");
                    }}>{"✕"}</span>}</div>{libBrowseMode === "filtered" && <button onClick={() => {
                    setLibSelectMode(m => !m);
                    setLibSelected(new Set());
                  }} style={{
                    flexShrink: 0,
                    padding: "6px 12px",
                    borderRadius: R.lg,
                    border: "1px solid",
                    borderColor: libSelectMode ? "#B0A898" : "rgba(45,42,36,.3)",
                    background: libSelectMode ? "rgba(45,42,36,.26)" : "transparent",
                    color: libSelectMode ? "#B0A898" : "#8a8478",
                    fontSize: FS.md,
                    fontWeight: libSelectMode ? "700" : "400",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}>{libSelectMode ? "✕ Cancel" : "⊞ Select"}</button>}</div></div>{/* ═══ HOME VIEW ═══ */
              libBrowseMode === "home" && <div>{/* Your Exercises — hero carousel */
                yourExercises.length > 0 && <div className={"lib-home-section"} style={{
                  marginBottom: S.s4
                }}><div className={"lib-section-hdr"}><span className={"lib-hdr-icon"}>{"⚔️"}</span>{"Your Exercises"}</div><div className={"lib-hscroll-wrap"}><div className={"lib-hscroll"} onScroll={handleHScroll}>{yourExercises.map(ex => {
                        const mgColor = getMuscleColor(ex.muscleGroup);
                        const mgLabel = (MUSCLE_META[(ex.muscleGroup || "").toLowerCase()] || {}).label || ex.muscleGroup || "";
                        return <div key={"yr-" + ex.id} className={"lib-hero-card"} onClick={() => setLibDetailEx(ex)} style={{
                          '--mg-color': mgColor
                        }}><div className={"lib-hero-orb"} style={{
                            '--mg-color': mgColor
                          }}><ExIcon ex={ex} size={"1.4rem"} color={mgColor} /></div><span className={"lib-hero-name"}>{ex.name}</span>{mgLabel && <span className={"lib-muscle-pill"} style={{
                            '--mg-color': mgColor
                          }}>{mgLabel}</span>}</div>;
                      })}</div></div></div>}{yourExercises.length > 0 && <div className={"lib-divider"} />} {
                  /* Browse by Muscle — feature tiles */
                }
                <div className={"lib-home-section"} style={{
                  marginBottom: S.s4
                }}><div className={"lib-section-hdr"}><span className={"lib-hdr-icon"}>{"🗺️"}</span>{"Browse by Muscle"}</div><div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: S.s10
                  }}>{MUSCLE_CARD_DATA.map(({
                      mg,
                      label,
                      emoji,
                      icon,
                      count,
                      color
                    }) => <div key={"mc-" + mg} className={"lib-muscle-tile"} onClick={() => {
                      setLibMuscleFilters(new Set([mg]));
                      setLibBrowseMode("filtered");
                    }} style={{
                      '--mg-color': color
                    }}><span className={"lib-tile-watermark"}>{emoji}</span><div className={"lib-tile-orb"} style={{
                        '--mg-color': color
                      }}><ExIcon ex={{
                          muscleGroup: mg,
                          category: "strength"
                        }} size={"1.15rem"} color={color} /></div><div><div className={"lib-tile-name"}>{label}</div><div className={"lib-tile-count"} style={{
                          '--mg-color': color
                        }}>{count + " exercises"}</div></div></div>)}</div></div><div className={"lib-divider"} />{/* Discover Rows — Netflix-style horizontal scroll */
                discoverRows.map((row, ri) => row.exercises.length >= 3 && <div key={"dr-" + row.label} className={"lib-home-section"} style={{
                  marginBottom: ri < discoverRows.length - 1 ? 18 : 0
                }}><div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: S.s10
                  }}><span className={"lib-section-hdr"} style={{
                      marginBottom: S.s0
                    }}>{row.label}</span><button className={"lib-see-all"} onClick={row.onSeeAll}>{"See All →"}</button></div><div className={"lib-hscroll-wrap"}><div className={"lib-hscroll"} onScroll={handleHScroll}>{row.exercises.map(ex => {
                        const mgColor = getMuscleColor(ex.muscleGroup);
                        const diff = (ex.difficulty || "").toLowerCase();
                        const diffCls = diff === "beginner" ? "lib-diff-beginner" : diff === "advanced" ? "lib-diff-advanced" : diff === "intermediate" ? "lib-diff-intermediate" : "";
                        const mgLabel = (MUSCLE_META[(ex.muscleGroup || "").toLowerCase()] || {}).label || "";
                        return <div key={"d-" + ex.id} className={"lib-discover-card"} onClick={() => setLibDetailEx(ex)} style={{
                          '--mg-color': mgColor
                        }}><div className={"lib-discover-orb"} style={{
                            '--mg-color': mgColor
                          }}><ExIcon ex={ex} size={"1.1rem"} color={mgColor} /></div><span className={"lib-discover-name"}>{ex.name}</span><div className={"lib-discover-meta"}>{mgLabel && <span style={{
                              fontSize: FS.fs50,
                              color: mgColor,
                              fontWeight: 500
                            }}>{mgLabel}</span>}{mgLabel && diffCls && <span style={{
                              fontSize: FS.fs45,
                              color: "#8a8478"
                            }}>{"·"}</span>}{diffCls && <span className={"lib-diff-badge " + diffCls}>{ex.difficulty}</span>}<span style={{
                              fontSize: FS.fs50,
                              color: "#8a8478",
                              fontWeight: 600
                            }}>{(ex.baseXP || 0) + " XP"}</span></div></div>;
                      })}</div></div></div>)}</div>}{/* ═══ FILTERED VIEW ═══ */
              libBrowseMode === "filtered" && <div> {
                  /* Back to browse */
                }
                <div style={{
                  marginBottom: S.s10
                }}><button onClick={() => clearAll()} style={{
                    background: "transparent",
                    border: "none",
                    color: "#b4ac9e",
                    fontSize: FS.fs78,
                    cursor: "pointer",
                    padding: "4px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s4
                  }}>{"← Browse Library"}</button></div> {
                  /* Filter dropdowns row — custom panels that stay open for multi-select */
                }
                <div style={{
                  display: "flex",
                  gap: S.s8,
                  marginBottom: S.s10,
                  flexWrap: "wrap",
                  position: "relative"
                }}>{/* Close-on-outside-click overlay */
                  libOpenDrop && <div onClick={() => setLibOpenDrop(null)} style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 19
                  }} />} {
                    /* ── Type dropdown ── */
                  }
                  <div style={{
                    position: "relative",
                    flex: "1 1 110px",
                    zIndex: 20
                  }}><button onClick={() => setLibOpenDrop(libOpenDrop === "type" ? null : "type")} style={{
                      width: "100%",
                      padding: "8px 28px 8px 10px",
                      borderRadius: R.xl,
                      border: "1px solid " + (libTypeFilters.size > 0 ? "#C4A044" : "rgba(45,42,36,.3)"),
                      background: "rgba(14,14,12,.95)",
                      color: libTypeFilters.size > 0 ? "#C4A044" : "#8a8478",
                      fontSize: FS.lg,
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative"
                    }}>{libTypeFilters.size > 0 ? "Type (" + libTypeFilters.size + ")" : "Type"}<span style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%) rotate(" + (libOpenDrop === "type" ? "180deg" : "0deg") + ")",
                        color: libTypeFilters.size > 0 ? "#C4A044" : "#8a8478",
                        fontSize: FS.sm,
                        transition: "transform .15s",
                        lineHeight: 1
                      }}>{"▼"}</span></button>{libOpenDrop === "type" && <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      minWidth: "100%",
                      background: "rgba(16,14,10,.95)",
                      border: "1px solid rgba(180,172,158,.07)",
                      borderRadius: R.xl,
                      padding: "6px 4px",
                      zIndex: 21,
                      boxShadow: "0 8px 24px rgba(0,0,0,.6)"
                    }}>{TYPE_OPTS.map(val => {
                        const sel = libTypeFilters.has(val);
                        const avail = availableTypes.size === 0 || availableTypes.has(val) || sel;
                        return <div key={val} onClick={() => toggleSet(setLibTypeFilters, val)} style={{
                          display: "flex",
                          alignItems: "center",
                          gap: S.s8,
                          padding: "6px 10px",
                          borderRadius: R.md,
                          cursor: "pointer",
                          opacity: avail ? 1 : 0.35,
                          background: sel ? "rgba(45,42,36,.22)" : "transparent"
                        }}><div style={{
                            width: 14,
                            height: 14,
                            borderRadius: R.r3,
                            flexShrink: 0,
                            border: "1.5px solid " + (sel ? getTypeColor(val) : "rgba(180,172,158,.08)"),
                            background: sel ? "rgba(45,42,36,.32)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>{sel && <span style={{
                              fontSize: FS.sm,
                              color: getTypeColor(val),
                              lineHeight: 1
                            }}>{"✓"}</span>}</div><span style={{
                            fontSize: FS.lg,
                            color: sel ? getTypeColor(val) : avail ? "#b4ac9e" : "#8a8478",
                            whiteSpace: "nowrap"
                          }}>{TYPE_LABELS[val]}</span></div>;
                      })}</div>}</div> {
                    /* ── Muscle dropdown ── */
                  }
                  <div style={{
                    position: "relative",
                    flex: "1 1 110px",
                    zIndex: 20
                  }}><button onClick={() => setLibOpenDrop(libOpenDrop === "muscle" ? null : "muscle")} style={{
                      width: "100%",
                      padding: "8px 28px 8px 10px",
                      borderRadius: R.xl,
                      border: "1px solid " + (libMuscleFilters.size > 0 ? UI_COLORS.accent : "rgba(45,42,36,.3)"),
                      background: "rgba(14,14,12,.95)",
                      color: libMuscleFilters.size > 0 ? "#7A8F8B" : "#8a8478",
                      fontSize: FS.lg,
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative"
                    }}>{libMuscleFilters.size > 0 ? "Muscle (" + libMuscleFilters.size + ")" : "Muscle Group"}<span style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%) rotate(" + (libOpenDrop === "muscle" ? "180deg" : "0deg") + ")",
                        color: libMuscleFilters.size > 0 ? "#7A8F8B" : "#8a8478",
                        fontSize: FS.sm,
                        transition: "transform .15s",
                        lineHeight: 1
                      }}>{"▼"}</span></button>{libOpenDrop === "muscle" && <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      minWidth: "100%",
                      background: "rgba(16,14,10,.95)",
                      border: "1px solid rgba(122,143,139,.25)",
                      borderRadius: R.xl,
                      padding: "6px 4px",
                      zIndex: 21,
                      boxShadow: "0 8px 24px rgba(0,0,0,.6)"
                    }}>{MUSCLE_OPTS.map(m => {
                        const sel = libMuscleFilters.has(m);
                        return <div key={m} onClick={() => toggleSet(setLibMuscleFilters, m)} style={{
                          display: "flex",
                          alignItems: "center",
                          gap: S.s8,
                          padding: "6px 10px",
                          borderRadius: R.md,
                          cursor: "pointer",
                          background: sel ? "rgba(122,143,139,.12)" : "transparent"
                        }}><div style={{
                            width: 14,
                            height: 14,
                            borderRadius: R.r3,
                            flexShrink: 0,
                            border: "1.5px solid " + (sel ? "#7A8F8B" : "rgba(122,143,139,.3)"),
                            background: sel ? "rgba(122,143,139,.25)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>{sel && <span style={{
                              fontSize: FS.sm,
                              color: UI_COLORS.accent,
                              lineHeight: 1
                            }}>{"✓"}</span>}</div><span style={{
                            fontSize: FS.lg,
                            color: sel ? "#7A8F8B" : "#b4ac9e",
                            whiteSpace: "nowrap"
                          }}>{m.charAt(0).toUpperCase() + m.slice(1).replace("_", " ")}</span></div>;
                      })}</div>}</div> {
                    /* ── Equipment dropdown ── */
                  }
                  <div style={{
                    position: "relative",
                    flex: "1 1 110px",
                    zIndex: 20
                  }}><button onClick={() => setLibOpenDrop(libOpenDrop === "equip" ? null : "equip")} style={{
                      width: "100%",
                      padding: "8px 28px 8px 10px",
                      borderRadius: R.xl,
                      border: "1px solid " + (libEquipFilters.size > 0 ? UI_COLORS.accent : "rgba(45,42,36,.3)"),
                      background: "rgba(14,14,12,.95)",
                      color: libEquipFilters.size > 0 ? UI_COLORS.accent : "#8a8478",
                      fontSize: FS.lg,
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative"
                    }}>{libEquipFilters.size > 0 ? "Equip (" + libEquipFilters.size + ")" : "Equipment"}<span style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%) rotate(" + (libOpenDrop === "equip" ? "180deg" : "0deg") + ")",
                        color: libEquipFilters.size > 0 ? UI_COLORS.accent : "#8a8478",
                        fontSize: FS.sm,
                        transition: "transform .15s",
                        lineHeight: 1
                      }}>{"▼"}</span></button>{libOpenDrop === "equip" && <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      minWidth: "100%",
                      background: "rgba(16,14,10,.95)",
                      border: "1px solid rgba(196,148,40,0.25)",
                      borderRadius: R.xl,
                      padding: "6px 4px",
                      zIndex: 21,
                      boxShadow: "0 8px 24px rgba(0,0,0,.6)"
                    }}>{EQUIP_OPTS.map(eq => {
                        const sel = libEquipFilters.has(eq);
                        return <div key={eq} onClick={() => toggleSet(setLibEquipFilters, eq)} style={{
                          display: "flex",
                          alignItems: "center",
                          gap: S.s8,
                          padding: "6px 10px",
                          borderRadius: R.md,
                          cursor: "pointer",
                          background: sel ? "rgba(196,148,40,0.12)" : "transparent"
                        }}><div style={{
                            width: 14,
                            height: 14,
                            borderRadius: R.r3,
                            flexShrink: 0,
                            border: "1.5px solid " + (sel ? UI_COLORS.accent : "rgba(196,148,40,0.3)"),
                            background: sel ? "rgba(196,148,40,0.25)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>{sel && <span style={{
                              fontSize: FS.sm,
                              color: UI_COLORS.accent,
                              lineHeight: 1
                            }}>{"✓"}</span>}</div><span style={{
                            fontSize: FS.lg,
                            color: sel ? UI_COLORS.accent : "#b4ac9e",
                            whiteSpace: "nowrap"
                          }}>{eq.charAt(0).toUpperCase() + eq.slice(1)}</span></div>;
                      })}</div>}</div></div>{/* Active filter tags — show what's selected, tap to remove */
                (libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0) && <div style={{
                  display: "flex",
                  gap: S.s6,
                  flexWrap: "wrap",
                  marginBottom: S.s8
                }}>{[...libTypeFilters].map(v => <span key={"t" + v} onClick={() => toggleSet(setLibTypeFilters, v)} style={{
                    background: "rgba(196,160,68,.08)",
                    border: "1px solid rgba(196,160,68,.25)",
                    color: getTypeColor(v),
                    fontSize: FS.fs62,
                    padding: "4px 8px",
                    borderRadius: R.r12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s4
                  }}>{TYPE_LABELS[v] || v}{" ✕"}</span>)}{[...libMuscleFilters].map(v => <span key={"m" + v} onClick={() => toggleSet(setLibMuscleFilters, v)} style={{
                    background: "rgba(122,143,139,.12)",
                    border: "1px solid rgba(122,143,139,.3)",
                    color: getMuscleColor(v),
                    fontSize: FS.fs62,
                    padding: "4px 8px",
                    borderRadius: R.r12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s4
                  }}>{v.charAt(0).toUpperCase() + v.slice(1).replace("_", " ")}{" ✕"}</span>)}{[...libEquipFilters].map(v => <span key={"e" + v} onClick={() => toggleSet(setLibEquipFilters, v)} style={{
                    background: "rgba(196,148,40,0.15)",
                    border: "1px solid rgba(196,148,40,0.27)",
                    color: UI_COLORS.accent,
                    fontSize: FS.fs62,
                    padding: "4px 8px",
                    borderRadius: R.r12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s4
                  }}>{v.charAt(0).toUpperCase() + v.slice(1)}{" ✕"}</span>)}</div>} {
                  /* Count + clear row */
                }
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: S.s8
                }}><div style={{
                    fontSize: FS.fs68,
                    color: "#8a8478"
                  }}>{libFiltered.length + " exercises"}</div>{hasFilters && <button onClick={clearAll} style={{
                    background: "transparent",
                    border: "none",
                    color: "#b4ac9e",
                    fontSize: FS.fs68,
                    cursor: "pointer"
                  }}>{"Clear all filters"}</button>}</div>{/* Select mode action bar */
                libSelectMode && libSelected.size > 0 && <div style={{
                  background: "rgba(45,42,36,.2)",
                  border: "1px solid rgba(180,172,158,.06)",
                  borderRadius: R.r10,
                  padding: "10px 14px",
                  marginBottom: S.s10,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: S.s8
                }}><span style={{
                    fontSize: FS.lg,
                    color: "#b4ac9e",
                    fontWeight: "700"
                  }}>{libSelected.size + " selected"}</span><div style={{
                    display: "flex",
                    gap: S.s8,
                    justifyContent: "center"
                  }}><button onClick={() => {
                      const exs = [...libSelected].map(id => {
                        const e = allExById[id];
                        return {
                          exId: id,
                          sets: e && e.defaultSets != null ? e.defaultSets : 3,
                          reps: e && e.defaultReps != null ? e.defaultReps : 10,
                          weightLbs: null,
                          durationMin: e && e.defaultDurationMin || null,
                          weightPct: 100,
                          distanceMi: null,
                          hrZone: null
                        };
                      });
                      setAddToWorkoutPicker({
                        exercises: exs
                      });
                      setLibSelectMode(false);
                      setLibSelected(new Set());
                    }} style={{
                      background: "rgba(45,42,36,.22)",
                      border: "1px solid rgba(180,172,158,.08)",
                      color: "#b4ac9e",
                      padding: "6px 12px",
                      borderRadius: R.lg,
                      fontSize: FS.md,
                      fontWeight: "700",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textAlign: "center"
                    }}>{"➕ Existing"}</button><button onClick={() => {
                      const exs = [...libSelected].map(id => {
                        const e = allExById[id];
                        return {
                          exId: id,
                          sets: e && e.defaultSets != null ? e.defaultSets : 3,
                          reps: e && e.defaultReps != null ? e.defaultReps : 10,
                          weightLbs: null,
                          durationMin: e && e.defaultDurationMin || null,
                          weightPct: 100,
                          distanceMi: null,
                          hrZone: null
                        };
                      });
                      setWbExercises(exs);
                      setWbName("");
                      setWbIcon("💪");
                      setWbDesc("");
                      setWbEditId(null);
                      setWbIsOneOff(false);
                      setWorkoutView("builder");
                      setActiveTab("workouts");
                      setLibSelectMode(false);
                      setLibSelected(new Set());
                    }} style={{
                      background: "linear-gradient(135deg,#5b2d8e,#7b1fa2)",
                      border: "none",
                      color: "#fff",
                      padding: "6px 12px",
                      borderRadius: R.lg,
                      fontSize: FS.md,
                      fontWeight: "700",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textAlign: "center"
                    }}>{"⚡ New Workout"}</button><button onClick={() => {
                      const ids = [...libSelected];
                      setSpwSelected(ids);
                      setSavePlanWizard({
                        entries: ids.map(id => ({
                          exId: id,
                          exercise: allExById[id] && allExById[id].name,
                          icon: allExById[id] && allExById[id].icon,
                          _idx: id
                        })),
                        label: "Selected Exercises"
                      });
                      setSpwName("Selected Exercises");
                      setSpwIcon("📋");
                      setSpwDate("");
                      setSpwMode("new");
                      setSpwTargetPlanId(null);
                      setLibSelectMode(false);
                      setLibSelected(new Set());
                    }} style={{
                      background: "rgba(45,42,36,.26)",
                      border: "1px solid rgba(180,172,158,.08)",
                      color: "#b4ac9e",
                      padding: "6px 12px",
                      borderRadius: R.lg,
                      fontSize: FS.md,
                      fontWeight: "700",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textAlign: "center"
                    }}>{"📋 Plan"}</button></div></div>} {
                  /* Exercise list (paginated) */
                }
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: S.s6
                }}>{libFiltered.length === 0 && <div className={"empty"} style={{
                    padding: "24px 0"
                  }}>{"No exercises match your filters."}</div>}{libFiltered.slice(0, libVisibleCount).map(ex => {
                    const isFav = (profile.favoriteExercises || []).includes(ex.id);
                    const hasPB = !!(profile.exercisePBs || {})[ex.id];
                    const isSel = libSelected.has(ex.id);
                    // Derive difficulty — prefer stored value, fall back to baseXP tiers
                    const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
                    const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
                    // Sub-line: italic type · muscle · equipment
                    const subParts = [ex.category ? ex.category.charAt(0).toUpperCase() + ex.category.slice(1) : null, ex.muscleGroup ? ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1) : null, ex.equipment && ex.equipment !== "bodyweight" ? ex.equipment : null].filter(Boolean).join(" · ");
                    const exMgColor = getMuscleColor(ex.muscleGroup);
                    return <div key={ex.id} className={`picker-ex-row${isSel ? " sel" : ""}`} onClick={() => {
                      if (libSelectMode) {
                        toggleSel(ex.id);
                      } else {
                        setLibDetailEx(ex);
                      }
                    }} style={{
                      "--mg-color": exMgColor
                    }}> {
                        /* Icon orb */
                      }
                      <div className={"picker-ex-orb"}><ExIcon ex={ex} size={"1rem"} color={"#d4cec4"} /></div> {
                        /* Body */
                      }
                      <div style={{
                        flex: 1,
                        minWidth: 0
                      }}><div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: S.s6,
                          flexWrap: "wrap",
                          marginBottom: S.s4
                        }}><span style={{
                            fontSize: FS.fs83,
                            fontWeight: 600,
                            color: isSel ? "#d4cec4" : "#d4cec4",
                            letterSpacing: ".01em"
                          }}>{ex.name}</span>{hasPB && <span style={{
                            fontSize: FS.sm
                          }}>{"🏆"}</span>}</div><div style={{
                          fontSize: FS.fs62,
                          fontStyle: "italic",
                          lineHeight: 1.4
                        }}>{ex.category && <span style={{
                            color: getTypeColor(ex.category)
                          }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</span>}{ex.category && ex.muscleGroup && <span style={{
                            color: "#8a8478"
                          }}>{" · "}</span>}{ex.muscleGroup && <span style={{
                            color: getMuscleColor(ex.muscleGroup)
                          }}>{ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}</span>}{ex.equipment && ex.equipment !== "bodyweight" && <span style={{
                            color: "#8a8478"
                          }}>{" · "}</span>}{ex.equipment && ex.equipment !== "bodyweight" && <span style={{
                            color: "#8a8478"
                          }}>{ex.equipment}</span>}</div></div> {
                        /* Right */
                      }
                      <div style={{
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: S.s6
                      }}><span style={{
                          fontSize: FS.fs66,
                          fontWeight: 700,
                          color: "#b4ac9e",
                          letterSpacing: ".02em"
                        }}>{ex.baseXP + " XP"}</span>{diffLabel ? <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: R.r4,
                          fontSize: FS.fs58,
                          fontWeight: 700,
                          letterSpacing: ".05em",
                          color: diffColor,
                          background: diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010"
                        }}>{diffLabel}</span> : null}{!libSelectMode && <button style={{
                          background: "transparent",
                          border: "none",
                          color: isFav ? "#d4cec4" : "#8a8478",
                          fontSize: FS.fs90,
                          cursor: "pointer",
                          padding: S.s0,
                          lineHeight: 1
                        }} onClick={e => {
                          e.stopPropagation();
                          setProfile(p => ({
                            ...p,
                            favoriteExercises: (p.favoriteExercises || []).includes(ex.id) ? (p.favoriteExercises || []).filter(i => i !== ex.id) : [...(p.favoriteExercises || []), ex.id]
                          }));
                        }}>{isFav ? "⭐" : "☆"}</button>}</div></div>;
                  })}{/* Load More / count info */
                  libFiltered.length > libVisibleCount && <button onClick={() => setLibVisibleCount(c => c + 60)} style={{
                    alignSelf: "center",
                    margin: "12px auto",
                    padding: "8px 24px",
                    borderRadius: R.lg,
                    border: "1px solid rgba(180,172,158,.12)",
                    background: "rgba(45,42,36,.3)",
                    color: "#b4ac9e",
                    fontSize: FS.fs75,
                    fontWeight: 600,
                    cursor: "pointer",
                    letterSpacing: ".02em"
                  }}>{`Load More (${Math.min(libVisibleCount, libFiltered.length)} of ${libFiltered.length})`}</button>}</div></div>}{/* ── end filtered view ── */

              /* Detail bottom sheet */
              libDetailEx && <div onClick={() => setLibDetailEx(null)} style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,.85)",
                zIndex: 500,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center"
              }}><div onClick={e => e.stopPropagation()} style={{
                  background: "linear-gradient(160deg,rgba(18,16,12,.92),rgba(12,12,10,.95))",
                  border: "1px solid rgba(180,172,158,.06)",
                  borderRadius: "16px 16px 0 0",
                  width: "100%",
                  maxWidth: 520,
                  maxHeight: "90vh",
                  overflowY: "auto",
                  padding: "20px 18px 32px"
                }}><div style={{
                    width: 36,
                    height: 4,
                    background: "rgba(45,42,36,.3)",
                    borderRadius: R.r2,
                    margin: "0 auto 16px"
                  }} /><div style={{
                    height: 90,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: S.s12
                  }}><ExIcon ex={libDetailEx} size={"3.5rem"} color={getTypeColor(libDetailEx.category)} /></div><div style={{
                    marginBottom: S.s10
                  }}><div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s8,
                      flexWrap: "wrap",
                      marginBottom: S.s4
                    }}><span style={{
                        fontSize: "1rem",
                        fontWeight: "700",
                        color: "#e8e0d0"
                      }}>{libDetailEx.name}</span>{(profile.exercisePBs || {})[libDetailEx.id] && <span style={{
                        background: "rgba(180,172,158,.1)",
                        color: "#b4ac9e",
                        fontSize: FS.sm,
                        padding: "2px 8px",
                        borderRadius: R.r4,
                        fontWeight: "700"
                      }}>{"🏆 PB"}</span>}</div><div style={{
                      display: "flex",
                      gap: S.s8,
                      flexWrap: "wrap"
                    }}><span style={{
                        fontSize: FS.md,
                        color: getMuscleColor(libDetailEx.muscleGroup),
                        fontStyle: "italic"
                      }}>{libDetailEx.muscleGroup ? libDetailEx.muscleGroup.charAt(0).toUpperCase() + libDetailEx.muscleGroup.slice(1) : ""}</span>{libDetailEx.equipment && <span style={{
                        fontSize: FS.md,
                        color: "#8a8478",
                        fontStyle: "italic"
                      }}>{"· " + libDetailEx.equipment}</span>}{libDetailEx.difficulty && <span style={{
                        fontSize: FS.md,
                        fontWeight: 700,
                        color: libDetailEx.difficulty === "Advanced" ? "#7A2838" : libDetailEx.difficulty === "Beginner" ? "#5A8A58" : "#A8843C"
                      }}>{"· " + libDetailEx.difficulty}</span>}<span style={{
                        fontSize: FS.md,
                        color: "#b4ac9e",
                        fontWeight: "700"
                      }}>{"· " + libDetailEx.baseXP + " XP"}</span></div></div>{libDetailEx.desc && <p style={{
                    fontSize: FS.fs78,
                    color: "#8a8478",
                    lineHeight: 1.55,
                    marginBottom: S.s12
                  }}>{libDetailEx.desc}</p>}{libDetailEx.pbType && <div style={{
                    background: "rgba(45,42,36,.16)",
                    border: "1px solid rgba(180,172,158,.05)",
                    borderRadius: R.lg,
                    padding: "8px 12px",
                    marginBottom: S.s12,
                    fontSize: FS.lg,
                    color: "#8a8478"
                  }}><span style={{
                      color: "#b4ac9e",
                      fontWeight: "700"
                    }}>{"PB: "}</span>{libDetailEx.pbType}{libDetailEx.pbTier === "Leaderboard" && <span style={{
                      marginLeft: S.s8,
                      color: "#b4ac9e",
                      fontSize: FS.fs65
                    }}>{"🏆 Leaderboard"}</span>}</div>}<button onClick={() => setProfile(p => ({
                    ...p,
                    favoriteExercises: (p.favoriteExercises || []).includes(libDetailEx.id) ? (p.favoriteExercises || []).filter(i => i !== libDetailEx.id) : [...(p.favoriteExercises || []), libDetailEx.id]
                  }))} style={{
                    width: "100%",
                    background: "rgba(45,42,36,.2)",
                    border: "1px solid rgba(180,172,158,.06)",
                    color: "#b4ac9e",
                    padding: "11px",
                    borderRadius: R.xl,
                    fontWeight: "700",
                    fontSize: FS.fs82,
                    cursor: "pointer"
                  }}>{(profile.favoriteExercises || []).includes(libDetailEx.id) ? "⭐ Saved to Favorites" : "☆ Save to Favorites"}</button><div style={{
                    display: "flex",
                    gap: S.s8,
                    marginTop: S.s8
                  }}>{libDetailEx.id !== "rest_day" && <button onClick={() => {
                      const exEntry = {
                        exId: libDetailEx.id,
                        sets: libDetailEx.defaultSets != null ? libDetailEx.defaultSets : 3,
                        reps: libDetailEx.defaultReps != null ? libDetailEx.defaultReps : 10,
                        weightLbs: null,
                        durationMin: null,
                        weightPct: 100,
                        distanceMi: null,
                        hrZone: null
                      };
                      setAddToWorkoutPicker({
                        exercises: [exEntry]
                      });
                      setLibDetailEx(null);
                    }} style={{
                      flex: 1,
                      background: "rgba(45,42,36,.2)",
                      border: "1px solid rgba(180,172,158,.06)",
                      color: "#b4ac9e",
                      padding: "10px",
                      borderRadius: R.xl,
                      fontWeight: "600",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      textAlign: "center"
                    }}>{"💪 Add to Workout"}</button>}<button onClick={() => {
                      const ids = [libDetailEx.id];
                      setSavePlanWizard({
                        entries: ids.map(id => ({
                          exId: id,
                          exercise: libDetailEx.name,
                          icon: libDetailEx.icon,
                          _idx: id
                        })),
                        label: libDetailEx.name
                      });
                      setSpwName(libDetailEx.name);
                      setSpwIcon("\uD83D\uDCCB");
                      setSpwDate("");
                      setSpwMode("new");
                      setSpwTargetPlanId(null);
                      setLibDetailEx(null);
                    }} style={{
                      flex: 1,
                      background: "rgba(45,42,36,.2)",
                      border: "1px solid rgba(180,172,158,.06)",
                      color: "#b4ac9e",
                      padding: "10px",
                      borderRadius: R.xl,
                      fontWeight: "600",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      textAlign: "center"
                    }}>{"📋 Add to Plan"}</button></div> {
                    /* Edit & Complete Now */
                  }
                  <button onClick={() => {
                    setSelEx(libDetailEx.id);
                    setSets("");
                    setReps("");
                    setExWeight("");
                    setWeightPct(100);
                    setDistanceVal("");
                    setHrZone(null);
                    setExHHMM("");
                    setExSec("");
                    setQuickRows([]);
                    setLibDetailEx(null);
                    setActiveTab("workout");
                  }} style={{
                    width: "100%",
                    marginTop: S.s8,
                    background: "linear-gradient(135deg,rgba(26,82,118,.25),rgba(41,128,185,.15))",
                    border: "1px solid rgba(41,128,185,.3)",
                    color: UI_COLORS.info,
                    padding: "11px",
                    borderRadius: R.xl,
                    fontWeight: "700",
                    fontSize: FS.fs82,
                    cursor: "pointer",
                    textAlign: "center"
                  }}>{"⚙ Configure"}</button></div></div>}</div>;
          })()
          /* ══ MY WORKOUTS SUB-TAB ══ */}{exSubTab === "myworkouts" && <div><div style={{
              marginBottom: S.s14
            }}><div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: S.s10
              }}><div style={{
                  fontSize: FS.fs65,
                  color: "#8a8478",
                  textTransform: "uppercase",
                  letterSpacing: ".1em"
                }}>{"Favorite Exercises"}</div>{(profile.favoriteExercises || []).length > 0 && <button onClick={() => {
                  setFavSelectMode(!favSelectMode);
                  setFavSelected(new Set());
                }} style={{
                  background: favSelectMode ? "rgba(45,42,36,.3)" : "transparent",
                  border: "1px solid " + (favSelectMode ? "rgba(180,172,158,.15)" : "rgba(180,172,158,.06)"),
                  color: favSelectMode ? "#d4cec4" : "#8a8478",
                  fontSize: FS.sm,
                  padding: "4px 10px",
                  borderRadius: R.md,
                  cursor: "pointer"
                }}>{favSelectMode ? "✕ Cancel" : "☐ Select"}</button>}</div>
              {
                /* Multi-select action bar */
              }{favSelectMode && favSelected.size > 0 && <div style={{
                background: "rgba(45,42,36,.2)",
                border: "1px solid rgba(180,172,158,.06)",
                borderRadius: R.r10,
                padding: "10px 14px",
                marginBottom: S.s10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: S.s8
              }}><span style={{
                  fontSize: FS.lg,
                  color: "#b4ac9e",
                  fontWeight: "700"
                }}>{favSelected.size + " selected"}</span><div style={{
                  display: "flex",
                  gap: S.s8,
                  justifyContent: "center"
                }}><button onClick={() => {
                    const ids = [...favSelected];
                    const exs = ids.map(id => {
                      const e = allExById[id];
                      return {
                        exId: id,
                        sets: e && e.defaultSets != null ? e.defaultSets : 3,
                        reps: e && e.defaultReps != null ? e.defaultReps : 10,
                        weightLbs: null,
                        durationMin: e && e.defaultDurationMin || null,
                        weightPct: 100,
                        distanceMi: null,
                        hrZone: null
                      };
                    });
                    setAddToWorkoutPicker({
                      exercises: exs
                    });
                    setFavSelectMode(false);
                    setFavSelected(new Set());
                  }} style={{
                    background: "rgba(45,42,36,.22)",
                    border: "1px solid rgba(180,172,158,.08)",
                    color: "#b4ac9e",
                    padding: "6px 12px",
                    borderRadius: R.lg,
                    fontSize: FS.md,
                    fontWeight: "700",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    textAlign: "center"
                  }}>{"➕ Existing"}</button><button onClick={() => {
                    const ids = [...favSelected];
                    const exs = ids.map(id => {
                      const e = allExById[id];
                      return {
                        exId: id,
                        sets: e && e.defaultSets != null ? e.defaultSets : 3,
                        reps: e && e.defaultReps != null ? e.defaultReps : 10,
                        weightLbs: null,
                        durationMin: e && e.defaultDurationMin || null,
                        weightPct: 100,
                        distanceMi: null,
                        hrZone: null
                      };
                    });
                    setWbExercises(exs);
                    setWbName("");
                    setWbIcon("💪");
                    setWbDesc("");
                    setWbEditId(null);
                    setWbIsOneOff(false);
                    setWorkoutView("builder");
                    setActiveTab("workouts");
                    setFavSelectMode(false);
                    setFavSelected(new Set());
                  }} style={{
                    background: "linear-gradient(135deg,#5b2d8e,#7b1fa2)",
                    border: "none",
                    color: "#fff",
                    padding: "6px 12px",
                    borderRadius: R.lg,
                    fontSize: FS.md,
                    fontWeight: "700",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    textAlign: "center"
                  }}>{"⚡ New Workout"}</button><button onClick={() => {
                    const ids = [...favSelected];
                    setSavePlanWizard({
                      entries: ids.map(id => ({
                        exId: id,
                        exercise: allExById[id] && allExById[id].name,
                        icon: allExById[id] && allExById[id].icon,
                        _idx: id
                      })),
                      label: "Selected Favorites"
                    });
                    setSpwName("Selected Favorites");
                    setSpwIcon("📋");
                    setSpwDate("");
                    setSpwMode("new");
                    setSpwTargetPlanId(null);
                    setFavSelectMode(false);
                    setFavSelected(new Set());
                  }} style={{
                    background: "rgba(45,42,36,.26)",
                    border: "1px solid rgba(180,172,158,.08)",
                    color: "#b4ac9e",
                    padding: "6px 12px",
                    borderRadius: R.lg,
                    fontSize: FS.md,
                    fontWeight: "700",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    textAlign: "center"
                  }}>{"📋 Plan"}</button></div></div>}{(profile.favoriteExercises || []).length === 0 ? <div className={"empty"} style={{
                padding: "16px 0"
              }}>{"No favorites yet — tap ⭐ on any exercise."}</div> : <div style={{
                display: "flex",
                flexDirection: "column",
                gap: S.s6
              }}>{(profile.favoriteExercises || []).slice(0, 20).map(exId => {
                  const ex = allExById[exId];
                  if (!ex) return null;
                  const hasPB = !!(profile.exercisePBs || {})[ex.id];
                  const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
                  const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
                  const isSel = favSelected.has(exId);
                  return <div key={exId} onClick={() => {
                    if (favSelectMode) {
                      setFavSelected(s => {
                        const n = new Set(s);
                        if (n.has(exId)) n.delete(exId);else n.add(exId);
                        return n;
                      });
                    } else {
                      setLibDetailEx(ex);
                      setExSubTab("library");
                    }
                  }} style={{
                    background: isSel ? "rgba(45,42,36,.3)" : "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid " + (isSel ? "rgba(180,172,158,.2)" : "rgba(180,172,158,.05)"),
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    boxShadow: isSel ? "0 0 0 1.5px rgba(180,172,158,.2)" : "none",
                    transition: "all .15s"
                  }}>{favSelectMode && <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: R.r5,
                      flexShrink: 0,
                      border: "1.5px solid " + (isSel ? "rgba(180,172,158,.3)" : "rgba(180,172,158,.08)"),
                      background: isSel ? "rgba(45,42,36,.35)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>{isSel && <span style={{
                        color: "#b4ac9e",
                        fontSize: FS.fs65
                      }}>{"✓"}</span>}</div>}<div style={{
                      width: 34,
                      height: 34,
                      borderRadius: R.lg,
                      flexShrink: 0,
                      background: "rgba(45,42,36,.15)",
                      border: "1px solid rgba(180,172,158,.05)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}><ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} /></div><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: S.s6,
                        flexWrap: "wrap",
                        marginBottom: S.s4
                      }}><span style={{
                          fontSize: FS.fs83,
                          fontWeight: 600,
                          color: "#d4cec4",
                          letterSpacing: ".01em"
                        }}>{ex.name}</span>{hasPB && <span style={{
                          fontSize: FS.sm
                        }}>{"🏆"}</span>}</div><div style={{
                        fontSize: FS.fs62,
                        fontStyle: "italic",
                        lineHeight: 1.4
                      }}>{ex.category && <span style={{
                          color: getTypeColor(ex.category)
                        }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</span>}{ex.category && ex.muscleGroup && <span style={{
                          color: "#8a8478"
                        }}>{" · "}</span>}{ex.muscleGroup && <span style={{
                          color: getMuscleColor(ex.muscleGroup)
                        }}>{ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}</span>}</div></div>{!favSelectMode && <div style={{
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: S.s6
                    }}><span style={{
                        fontSize: FS.fs66,
                        fontWeight: 700,
                        color: "#b4ac9e",
                        letterSpacing: ".02em"
                      }}>{ex.baseXP + " XP"}</span><button onClick={e => {
                        e.stopPropagation();
                        setProfile(p => ({
                          ...p,
                          favoriteExercises: (p.favoriteExercises || []).filter(i => i !== exId)
                        }));
                      }} style={{
                        background: "transparent",
                        border: "none",
                        color: "#b4ac9e",
                        fontSize: FS.fs90,
                        cursor: "pointer",
                        padding: S.s0,
                        lineHeight: 1
                      }}>{"⭐"}</button></div>}{favSelectMode && <div style={{
                      flexShrink: 0
                    }}><span style={{
                        fontSize: FS.fs66,
                        fontWeight: 700,
                        color: "#b4ac9e"
                      }}>{ex.baseXP + " XP"}</span></div>}</div>;
                })}</div>}</div><div style={{
              marginTop: S.s8
            }}><div style={{
                fontSize: FS.fs65,
                color: "#8a8478",
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: S.s10
              }}>{"Custom Exercises"}</div>{(profile.customExercises || []).length === 0 ? <div className={"empty"} style={{
                padding: "12px 0"
              }}>{"No custom exercises yet."}</div> : <div style={{
                display: "flex",
                flexDirection: "column",
                gap: S.s6
              }}>{(profile.customExercises || []).map(ex => {
                  const hasPB = !!(profile.exercisePBs || {})[ex.id];
                  const isFav = (profile.favoriteExercises || []).includes(ex.id);
                  const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
                  const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
                  const subParts = [ex.category ? ex.category.charAt(0).toUpperCase() + ex.category.slice(1) : null, ex.muscleGroup ? ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1) : null, ex.equipment && ex.equipment !== "bodyweight" ? ex.equipment : null].filter(Boolean).join(" · ");
                  return <div key={ex.id} onClick={() => {
                    setLibDetailEx(ex);
                    setExSubTab("library");
                  }} style={{
                    background: "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid rgba(180,172,158,.05)",
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    transition: "all .18s"
                  }}><div style={{
                      width: 34,
                      height: 34,
                      borderRadius: R.lg,
                      flexShrink: 0,
                      background: "rgba(45,42,36,.15)",
                      border: "1px solid rgba(180,172,158,.05)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}><ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} /></div><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: S.s6,
                        flexWrap: "wrap",
                        marginBottom: S.s4
                      }}><span style={{
                          fontSize: FS.fs83,
                          fontWeight: 600,
                          color: "#d4cec4",
                          letterSpacing: ".01em"
                        }}>{ex.name}</span><span className={"custom-ex-badge"} style={{
                          marginLeft: S.s2
                        }}>{"custom"}</span>{hasPB && <span style={{
                          fontSize: FS.sm
                        }}>{"🏆"}</span>}</div><div style={{
                        fontSize: FS.fs62,
                        fontStyle: "italic",
                        lineHeight: 1.4
                      }}>{ex.category && <span style={{
                          color: getTypeColor(ex.category)
                        }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</span>}{ex.category && ex.muscleGroup && <span style={{
                          color: "#8a8478"
                        }}>{" · "}</span>}{ex.muscleGroup && <span style={{
                          color: getMuscleColor(ex.muscleGroup)
                        }}>{ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}</span>}</div></div><div style={{
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: S.s6
                    }}><span style={{
                        fontSize: FS.fs66,
                        fontWeight: 700,
                        color: "#b4ac9e",
                        letterSpacing: ".02em"
                      }}>{ex.baseXP + " XP"}</span>{diffLabel && <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: R.r4,
                        fontSize: FS.fs58,
                        fontWeight: 700,
                        letterSpacing: ".05em",
                        color: diffColor,
                        background: diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010"
                      }}>{diffLabel}</span>}<div style={{
                        display: "flex",
                        gap: S.s6,
                        alignItems: "center"
                      }}><button onClick={e => {
                          e.stopPropagation();
                          openExEditor("edit", ex);
                        }} style={{
                          background: "rgba(45,42,36,.25)",
                          border: "1px solid rgba(180,172,158,.08)",
                          color: "#8a8478",
                          fontSize: FS.fs55,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: R.r5,
                          fontFamily: "'Barlow',sans-serif"
                        }}>{"✎ edit"}</button><button onClick={e => {
                          e.stopPropagation();
                          deleteCustomEx(ex.id);
                        }} style={{
                          background: "rgba(46,20,20,.3)",
                          border: "1px solid rgba(231,76,60,.15)",
                          color: UI_COLORS.danger,
                          fontSize: FS.fs55,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: R.r5
                        }}>{"🗑"}</button><button onClick={e => {
                          e.stopPropagation();
                          setProfile(p => ({
                            ...p,
                            favoriteExercises: isFav ? (p.favoriteExercises || []).filter(i => i !== ex.id) : [...(p.favoriteExercises || []), ex.id]
                          }));
                        }} style={{
                          background: "transparent",
                          border: "none",
                          color: isFav ? "#d4cec4" : "#8a8478",
                          fontSize: FS.fs90,
                          cursor: "pointer",
                          padding: S.s0,
                          lineHeight: 1
                        }}>{isFav ? "⭐" : "☆"}</button></div></div></div>;
                })}</div>}<button onClick={() => openExEditor("create", null)} style={{
                marginTop: S.s10,
                width: "100%",
                background: "transparent",
                border: "1px dashed rgba(180,172,158,.08)",
                color: "#b4ac9e",
                borderRadius: R.xl,
                padding: "10px",
                fontSize: FS.fs78,
                cursor: "pointer"
              }}>{"＋ Create Custom Exercise"}</button></div></div>}</>

        /* ── WORKOUTS TAB ────────────────────── */}{activeTab === "workouts" && (() => {
          const metric = isMetric(profile.units);
          const wUnit = weightLabel(profile.units);
          const allW = profile.workouts || [];
          const calcWorkoutXP = wo => (wo.exercises || []).reduce((s, ex) => {
            const extraCount = (ex.extraRows || []).length;
            const base = calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById, null, null, null, extraCount);
            const rowsXP = (ex.extraRows || []).reduce((rs, row) => rs + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, null, null, extraCount), 0);
            return s + base + rowsXP;
          }, 0);

          // ── LIST ───────────────────────────────
          if (workoutView === "list") return <><div className={"wo-sticky-filters"}><div style={{
                marginBottom: S.s8
              }}><div className={"rpg-sec-header rpg-sec-header-center"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Arsenal ✦"}<span className={"info-icon"} style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "1px solid rgba(180,172,158,.15)",
                      fontSize: FS.fs48,
                      fontWeight: 700,
                      color: "#8a8478",
                      fontStyle: "normal",
                      marginLeft: S.s6,
                      verticalAlign: "middle",
                      cursor: "pointer",
                      position: "relative"
                    }}>{"?"}<span className={"info-tooltip"}>{"Pre-defined groups of exercises. Build once, reuse anytime in plans or as one-off sessions."}</span></span></span><div className={"rpg-sec-line rpg-sec-line-r"} /></div></div>
              {
                /* Subtabs */
              }<div className={"log-subtab-bar"} style={{
                marginBottom: S.s0
              }}>{[["reusable", "⚔ Re-Usable"], ["oneoff", "⚡ One-Off"]].map(([t, l]) => <button key={t} className={`log-subtab-btn ${workoutSubTab === t ? "on" : ""}`} onClick={() => setWorkoutSubTab(t)}>{l}</button>)}</div></div>
            {
              /* Label filter dropdown */
            }{(profile.workoutLabels || []).length > 0 && <div style={{
              display: "flex",
              gap: S.s8,
              marginBottom: S.s10,
              position: "relative"
            }}>{woLabelDropOpen && <div onClick={() => setWoLabelDropOpen(false)} style={{
                position: "fixed",
                inset: 0,
                zIndex: 19
              }} />}<div style={{
                position: "relative",
                zIndex: 20
              }}><button onClick={() => setWoLabelDropOpen(!woLabelDropOpen)} style={{
                  padding: "8px 28px 8px 10px",
                  borderRadius: R.xl,
                  border: "1px solid " + (woLabelFilters.size > 0 ? "#C4A044" : "rgba(45,42,36,.3)"),
                  background: "rgba(14,14,12,.95)",
                  color: woLabelFilters.size > 0 ? "#C4A044" : "#8a8478",
                  fontSize: FS.lg,
                  textAlign: "left",
                  cursor: "pointer",
                  position: "relative"
                }}>{woLabelFilters.size > 0 ? "Labels (" + woLabelFilters.size + ")" : "Labels"}<span style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%) rotate(" + (woLabelDropOpen ? "180deg" : "0deg") + ")",
                    color: woLabelFilters.size > 0 ? "#C4A044" : "#8a8478",
                    fontSize: FS.sm,
                    transition: "transform .15s",
                    lineHeight: 1
                  }}>{"▼"}</span></button>{woLabelDropOpen && <div style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  minWidth: 180,
                  background: "rgba(16,14,10,.95)",
                  border: "1px solid rgba(180,172,158,.07)",
                  borderRadius: R.xl,
                  padding: "6px 4px",
                  zIndex: 21,
                  boxShadow: "0 8px 24px rgba(0,0,0,.6)"
                }}>{(profile.workoutLabels || []).map(l => {
                    const sel = woLabelFilters.has(l);
                    return <div key={l} onClick={() => setWoLabelFilters(s => {
                      const n = new Set(s);
                      n.has(l) ? n.delete(l) : n.add(l);
                      return n;
                    })} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s8,
                      padding: "6px 10px",
                      borderRadius: R.md,
                      cursor: "pointer",
                      background: sel ? "rgba(196,160,68,.12)" : "transparent"
                    }}><div style={{
                        width: 14,
                        height: 14,
                        borderRadius: R.r3,
                        flexShrink: 0,
                        border: "1.5px solid " + (sel ? "#C4A044" : "rgba(180,172,158,.08)"),
                        background: sel ? "rgba(196,160,68,.25)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>{sel && <span style={{
                          fontSize: FS.sm,
                          color: "#C4A044",
                          lineHeight: 1
                        }}>{"✓"}</span>}</div><span style={{
                        fontSize: FS.lg,
                        color: sel ? "#C4A044" : "#b4ac9e",
                        whiteSpace: "nowrap"
                      }}>{l}</span></div>;
                  })}<div className={"wo-label-new-row"}><input className={"wo-label-new-inp"} value={newLabelInput} onChange={e => setNewLabelInput(e.target.value)} onClick={e => e.stopPropagation()} onKeyDown={e => {
                      if (e.key === "Enter" && newLabelInput.trim()) {
                        const lbl = newLabelInput.trim();
                        if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
                          setProfile(p => ({
                            ...p,
                            workoutLabels: [...(p.workoutLabels || []), lbl]
                          }));
                        }
                        setNewLabelInput("");
                      }
                    }} placeholder={"+ New label…"} /><button className={"btn btn-ghost btn-xs"} style={{
                      padding: "2px 6px",
                      fontSize: FS.sm
                    }} onClick={e => {
                      e.stopPropagation();
                      const lbl = newLabelInput.trim();
                      if (!lbl) return;
                      if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
                        setProfile(p => ({
                          ...p,
                          workoutLabels: [...(p.workoutLabels || []), lbl]
                        }));
                      }
                      setNewLabelInput("");
                    }}>{"+"}</button></div></div>}</div>{woLabelFilters.size > 0 && <button className={"btn btn-ghost btn-xs"} style={{
                fontSize: FS.sm,
                color: "#8a8478",
                alignSelf: "center"
              }} onClick={() => setWoLabelFilters(new Set())}>{"Clear"}</button>}</div>}{workoutSubTab === "reusable" && <><div style={{
                display: "flex",
                gap: S.s8,
                marginBottom: S.s14
              }}><button className={"btn btn-gold btn-sm"} onClick={() => initWorkoutBuilder(null)}>{"＋ New Workout"}</button><button className={"btn btn-ghost btn-sm"} onClick={() => setWorkoutView("recipes")}>{"📋 Recipes"}</button></div>{(() => {
                const reusableWo = allW.filter(w => !w.oneOff);
                const filtered = reusableWo.filter(w => woLabelFilters.size === 0 || (w.labels || []).some(l => woLabelFilters.has(l)));
                if (reusableWo.length === 0) return <div className={"empty"}>{"No reusable workouts yet."}<br />{"Create your first custom workout or start from a template."}</div>;
                if (filtered.length === 0 && woLabelFilters.size > 0) return <div className={"empty"}>{"No workouts match the selected labels."}</div>;
                return null;
              })()}{allW.filter(w => !w.oneOff).filter(w => woLabelFilters.size === 0 || (w.labels || []).some(l => woLabelFilters.has(l))).map(wo => {
                const exCount = wo.exercises.length;
                const xp = calcWorkoutXP(wo);
                const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
                return <div key={wo.id} className={"workout-card"} style={{
                  "--mg-color": woMgColor
                }}><div className={"workout-card-top"} style={{
                    cursor: "pointer"
                  }} onClick={() => {
                    setActiveWorkout(wo);
                    setWorkoutView("detail");
                  }}><div className={"workout-icon"}>{wo.icon}</div><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div className={"workout-name"}>{wo.name}</div><div className={"workout-meta"}><span className={"workout-tag"}>{exCount}{" exercise"}{exCount !== 1 ? "s" : ""}</span><span className={"workout-tag"}>{formatXP(xp, {
                            prefix: "⚡ "
                          })}</span>{(wo.labels || []).map(l => <span key={l} className={"wo-label-chip"} style={{
                          pointerEvents: "none",
                          marginLeft: S.s2
                        }}>{l}</span>)}</div>{wo.desc && <div className={`workout-desc ${collapsedWo.has(wo.id) ? "" : "recipe-desc-collapsed"}`} style={{
                        marginTop: S.s4,
                        position: "relative",
                        paddingRight: wo.desc.length > 60 ? 16 : 0
                      }} title={wo.desc}>{wo.desc}{wo.desc.length > 60 && <span className={`ex-collapse-btn ${collapsedWo.has(wo.id) ? "open" : ""}`} style={{
                          position: "absolute",
                          top: 0,
                          right: 0,
                          fontSize: FS.sm,
                          padding: "0 2px"
                        }} onClick={e => {
                          e.stopPropagation();
                          setCollapsedWo(s => {
                            const n = new Set(s);
                            n.has(wo.id) ? n.delete(wo.id) : n.add(wo.id);
                            return n;
                          });
                        }}>{"▼"}</span>}</div>}</div><div style={{
                      display: "flex",
                      gap: S.s0,
                      border: "1px solid rgba(180,172,158,.05)",
                      borderRadius: R.xl,
                      overflow: "hidden",
                      background: "rgba(45,42,36,.3)",
                      backdropFilter: "blur(10px)",
                      WebkitBackdropFilter: "blur(10px)",
                      flexShrink: 0
                    }} onClick={e => e.stopPropagation()}><button style={{
                        padding: "6px 10px",
                        textAlign: "center",
                        fontFamily: "'Cinzel',serif",
                        fontSize: FS.fs55,
                        letterSpacing: ".06em",
                        cursor: "pointer",
                        color: "#8a8478",
                        background: "transparent",
                        border: "none",
                        borderRight: "1px solid rgba(180,172,158,.06)",
                        textTransform: "uppercase"
                      }} title={"Copy"} onClick={() => copyWorkout(wo)}>{"⎘ Copy"}</button><button style={{
                        padding: "6px 10px",
                        textAlign: "center",
                        fontFamily: "'Cinzel',serif",
                        fontSize: FS.fs55,
                        letterSpacing: ".06em",
                        cursor: "pointer",
                        color: "#8a8478",
                        background: "transparent",
                        border: "none",
                        borderRight: "1px solid rgba(180,172,158,.06)",
                        textTransform: "uppercase"
                      }} title={"Edit"} onClick={() => initWorkoutBuilder(wo)}>{"✎ Edit"}</button><button style={{
                        padding: "6px 10px",
                        textAlign: "center",
                        fontFamily: "'Cinzel',serif",
                        fontSize: FS.fs55,
                        letterSpacing: ".06em",
                        cursor: "pointer",
                        color: UI_COLORS.danger,
                        background: "transparent",
                        border: "none",
                        textTransform: "uppercase"
                      }} title={"Delete"} onClick={() => setConfirmDelete({
                        type: "workout",
                        id: wo.id,
                        name: wo.name,
                        icon: wo.icon
                      })}>{"✕ Del"}</button></div></div></div>;
              })}</>}{workoutSubTab === "oneoff" && <>{(() => {
                const _now = new Date();
                const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
                const grouped = {};
                (profile.scheduledWorkouts || []).forEach(sw => {
                  if (!sw.sourceWorkoutId) return;
                  if (sw.scheduledDate < today) return;
                  const key = sw.sourceWorkoutId;
                  if (!grouped[key]) grouped[key] = {
                    id: sw.sourceWorkoutId,
                    name: sw.sourceWorkoutName,
                    icon: sw.sourceWorkoutIcon || "⚡",
                    date: sw.scheduledDate,
                    items: []
                  };
                  grouped[key].items.push(sw);
                });
                const scheduled = Object.values(grouped).filter(g => {
                  if (woLabelFilters.size === 0) return true;
                  const wo = (profile.workouts || []).find(w => w.id === g.id);
                  return (wo && wo.labels || []).some(l => woLabelFilters.has(l));
                }).sort((a, b) => a.date.localeCompare(b.date));
                const hasSoloExs = (profile.scheduledWorkouts || []).some(sw => !sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today);
                if (scheduled.length === 0 && !hasSoloExs && woLabelFilters.size === 0) return <div className={"empty"}>{"No upcoming one-off workouts."}<br />{"Select exercises and tap ⚡ One-Off Workout to schedule one."}</div>;
                if (scheduled.length === 0 && !hasSoloExs && woLabelFilters.size > 0) return <div className={"empty"}>{"No one-off workouts match the selected labels."}</div>;
                if (scheduled.length === 0) return null;
                return scheduled.map(g => {
                  const days = daysUntil(g.date);
                  const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
                  const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
                  const wo = (profile.workouts || []).find(w => w.id === g.id) || {
                    id: g.id,
                    name: g.name,
                    icon: g.icon,
                    desc: "",
                    exercises: g.items.map(sw => ({
                      exId: sw.exId,
                      sets: 3,
                      reps: 10,
                      weightLbs: null,
                      weightPct: 100,
                      distanceMi: null,
                      hrZone: null
                    })),
                    oneOff: true,
                    durationMin: null,
                    activeCal: null,
                    totalCal: null
                  };
                  const xp = calcWorkoutXP(wo);
                  const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
                  return <div key={g.id} className={"workout-card"} style={{
                    "--mg-color": woMgColor
                  }}><div className={"workout-card-top"} style={{
                      cursor: "pointer"
                    }} onClick={() => {
                      setActiveWorkout(wo);
                      setWorkoutView("detail");
                    }}><div className={"workout-icon"}>{g.icon}</div><div style={{
                        flex: 1,
                        minWidth: 0
                      }}><div className={"workout-name"}>{g.name}</div><div className={"workout-meta"}><span className={"workout-tag"}>{g.items.length}{" exercise"}{g.items.length !== 1 ? "s" : ""}</span><span className={"workout-tag"}>{formatXP(xp, {
                              prefix: "⚡ "
                            })}</span><span className={`upcoming-badge ${badgeCls}`} style={{
                            marginLeft: S.s4
                          }}>{badgeTxt}</span>{(wo.labels || []).map(l => <span key={l} className={"wo-label-chip"} style={{
                            pointerEvents: "none",
                            marginLeft: S.s2
                          }}>{l}</span>)}</div>{wo.desc && <div className={"workout-desc recipe-desc-collapsed"} style={{
                          marginTop: S.s4
                        }}>{wo.desc}</div>}</div><div style={{
                        display: "flex",
                        gap: S.s0,
                        border: "1px solid rgba(180,172,158,.05)",
                        borderRadius: R.xl,
                        overflow: "hidden",
                        background: "rgba(45,42,36,.3)",
                        backdropFilter: "blur(10px)",
                        WebkitBackdropFilter: "blur(10px)",
                        flexShrink: 0
                      }} onClick={e => e.stopPropagation()}><button style={{
                          padding: "6px 10px",
                          textAlign: "center",
                          fontFamily: "'Cinzel',serif",
                          fontSize: FS.fs55,
                          letterSpacing: ".06em",
                          cursor: "pointer",
                          color: "#8a8478",
                          background: "transparent",
                          border: "none",
                          borderRight: "1px solid rgba(180,172,158,.06)",
                          textTransform: "uppercase"
                        }} title={"Edit"} onClick={() => {
                          setWbName(wo.name);
                          setWbIcon(wo.icon);
                          setWbDesc(wo.desc || "");
                          setWbExercises(wo.exercises.map(e => ({
                            ...e
                          })));
                          setWbEditId(wo.id);
                          setWbIsOneOff(true);
                          setWbLabels(wo.labels || []);
                          setNewLabelInput("");
                          setWorkoutView("builder");
                        }}>{"✎ Edit"}</button><button style={{
                          padding: "6px 10px",
                          textAlign: "center",
                          fontFamily: "'Cinzel',serif",
                          fontSize: FS.fs55,
                          letterSpacing: ".06em",
                          cursor: "pointer",
                          color: UI_COLORS.danger,
                          background: "transparent",
                          border: "none",
                          textTransform: "uppercase"
                        }} title={"Delete"} onClick={() => {
                          setProfile(p => ({
                            ...p,
                            scheduledWorkouts: (p.scheduledWorkouts || []).filter(sw => sw.sourceWorkoutId !== g.id)
                          }));
                          showToast("Scheduled workout removed.");
                        }}>{"✕ Del"}</button></div></div>
                    {
                      /* Action row */
                    }<div style={{
                      display: "flex",
                      gap: S.s6,
                      marginTop: S.s6,
                      paddingTop: 6,
                      borderTop: "1px solid rgba(180,172,158,.04)"
                    }}><button className={"btn btn-ghost btn-xs"} style={{
                        fontSize: FS.fs62,
                        color: "#8a8478"
                      }} onClick={() => {
                        const reusable = {
                          ...wo,
                          oneOff: false,
                          createdAt: wo.createdAt || todayStr()
                        };
                        setProfile(p => ({
                          ...p,
                          workouts: (p.workouts || []).map(w => w.id === wo.id ? reusable : w).concat((p.workouts || []).find(w => w.id === wo.id) ? [] : [reusable]),
                          scheduledWorkouts: (p.scheduledWorkouts || []).filter(sw => sw.sourceWorkoutId !== g.id)
                        }));
                        setWorkoutSubTab("reusable");
                        showToast(`\uD83D\uDCAA "${wo.name}" added to Re-Usable Workouts!`);
                      }}>{"💪 Make Reusable"}</button><div style={{
                        flex: 1
                      }} /><button className={"btn btn-gold btn-sm"} onClick={() => {
                        openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
                          setCompletionModal({
                            workout: {
                              ...woWithStats,
                              oneOff: true
                            },
                            fromStats: _sr
                          });
                          setCompletionDate(todayStr());
                          setCompletionAction("today");
                        });
                      }}>{"✓ Complete"}</button></div></div>;
                });
              })()}{(() => {
                const _now2 = new Date();
                const today = `${_now2.getFullYear()}-${String(_now2.getMonth() + 1).padStart(2, '0')}-${String(_now2.getDate()).padStart(2, '0')}`;
                const soloExs = (profile.scheduledWorkouts || []).filter(sw => !sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
                if (soloExs.length === 0) return null;
                return <><div className={"wo-section-hdr"}><span className={"wo-section-hdr-text"}>{"Solo Exercises"}</span></div>{soloExs.map(sw => {
                    const ex = allExById[sw.exId];
                    if (!ex) return null;
                    const days = daysUntil(sw.scheduledDate);
                    const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
                    const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
                    const soloMg = (ex.muscleGroup || "").toLowerCase().trim();
                    const soloMgColor = MUSCLE_COLORS[soloMg] || "#B0A090";
                    return <div key={sw.id} className={"workout-card"} style={{
                      "--mg-color": soloMgColor
                    }}><div className={"workout-card-top"}><div className={"workout-icon"}>{ex.icon}</div><div style={{
                          flex: 1,
                          minWidth: 0
                        }}><div className={"workout-name"}>{ex.name}</div><div className={"workout-meta"}><span className={`upcoming-badge ${badgeCls}`} style={{
                              marginLeft: S.s4
                            }}>{badgeTxt}</span></div>{sw.notes && <div className={"workout-desc"} style={{
                            marginTop: S.s4
                          }}>{sw.notes}</div>}</div><div style={{
                          display: "flex",
                          gap: S.s4,
                          flexShrink: 0,
                          alignItems: "center"
                        }}><button className={"btn btn-ghost btn-sm"} style={{
                            fontSize: FS.fs65,
                            color: "#b4ac9e",
                            padding: "4px 6px"
                          }} onClick={e => {
                            e.stopPropagation();
                            setSelEx(sw.exId);
                            setPendingSoloRemoveId(sw.id);
                          }}>{"✎"}</button><button className={"btn btn-ghost btn-sm"} style={{
                            color: UI_COLORS.danger
                          }} onClick={() => {
                            setProfile(p => ({
                              ...p,
                              scheduledWorkouts: (p.scheduledWorkouts || []).filter(s => s.id !== sw.id)
                            }));
                            showToast("Scheduled exercise removed.");
                          }}>{"✕"}</button></div></div><div style={{
                        display: "flex",
                        gap: S.s6,
                        marginTop: S.s6,
                        paddingTop: 6,
                        borderTop: "1px solid rgba(180,172,158,.04)"
                      }}><button className={"btn btn-gold btn-sm"} style={{
                          flex: 1
                        }} onClick={() => quickLogSoloEx(sw)}>{"⚡ Quick Log"}</button><button className={"btn btn-ghost btn-sm"} style={{
                          flex: 1,
                          fontSize: FS.fs58,
                          borderColor: "rgba(180,172,158,.15)",
                          color: "#b4ac9e"
                        }} onClick={e => {
                          e.stopPropagation();
                          openScheduleEx(sw.exId, sw.id);
                        }}>{"📅 Reschedule"}</button><button className={"btn btn-ghost btn-sm"} style={{
                          flex: 1,
                          fontSize: FS.fs58,
                          borderColor: "rgba(45,42,36,.3)",
                          color: "#8a8478"
                        }} onClick={() => {
                          const ex2 = allExById[sw.exId];
                          if (!ex2) return;
                          const exEntry = {
                            exId: ex2.id,
                            sets: ex2.defaultSets || 3,
                            reps: ex2.defaultReps || 10,
                            weightLbs: null,
                            durationMin: null,
                            weightPct: 100,
                            distanceMi: null,
                            hrZone: null
                          };
                          setAddToWorkoutPicker({
                            exercises: [exEntry]
                          });
                        }}>{"➕ Add to Workout"}</button></div></div>;
                  })}</>;
              })()}</>}</>;

          // ── TEMPLATES ──────────────────────────
          if (workoutView === "recipes") {
            const filteredTpls = recipeFilter.size === 0 ? WORKOUT_TEMPLATES : WORKOUT_TEMPLATES.filter(t => recipeFilter.has(t.category) || recipeFilter.has(t.equipment));
            return <><div className={"wo-sticky-filters"}><div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: S.s8
                }}><button className={"btn btn-ghost btn-sm"} onClick={() => setWorkoutView("list")}>{"← Back"}</button><div className={"sec"} style={{
                    margin: 0,
                    border: "none",
                    padding: S.s0
                  }}>{"Workout Recipes"}</div><div /></div>
                {
                  /* Category multi-select dropdown */
                }<div style={{
                  display: "flex",
                  gap: S.s8,
                  marginBottom: S.s0,
                  position: "relative"
                }}>{recipeCatDrop && <div onClick={() => setRecipeCatDrop(false)} style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 19
                  }} />}<div style={{
                    position: "relative",
                    zIndex: 20
                  }}><button onClick={() => setRecipeCatDrop(!recipeCatDrop)} style={{
                      padding: "8px 28px 8px 10px",
                      borderRadius: R.xl,
                      border: "1px solid " + (recipeFilter.size > 0 ? "#C4A044" : "rgba(45,42,36,.3)"),
                      background: "rgba(14,14,12,.95)",
                      color: recipeFilter.size > 0 ? "#C4A044" : "#8a8478",
                      fontSize: FS.lg,
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative"
                    }}>{recipeFilter.size > 0 ? "Category (" + recipeFilter.size + ")" : "Category"}<span style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%) rotate(" + (recipeCatDrop ? "180deg" : "0deg") + ")",
                        color: recipeFilter.size > 0 ? "#C4A044" : "#8a8478",
                        fontSize: FS.sm,
                        transition: "transform .15s",
                        lineHeight: 1
                      }}>{"▼"}</span></button>{recipeCatDrop && <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      minWidth: 200,
                      maxHeight: 280,
                      overflowY: "auto",
                      background: "rgba(16,14,10,.95)",
                      border: "1px solid rgba(180,172,158,.07)",
                      borderRadius: R.xl,
                      padding: "6px 4px",
                      zIndex: 21,
                      boxShadow: "0 8px 24px rgba(0,0,0,.6)"
                    }}>{RECIPE_CATS.filter(c => c !== "All").map(cat => {
                        const sel = recipeFilter.has(cat);
                        return <div key={cat} onClick={() => setRecipeFilter(s => {
                          const n = new Set(s);
                          n.has(cat) ? n.delete(cat) : n.add(cat);
                          return n;
                        })} style={{
                          display: "flex",
                          alignItems: "center",
                          gap: S.s8,
                          padding: "6px 10px",
                          borderRadius: R.md,
                          cursor: "pointer",
                          background: sel ? "rgba(196,160,68,.12)" : "transparent"
                        }}><div style={{
                            width: 14,
                            height: 14,
                            borderRadius: R.r3,
                            flexShrink: 0,
                            border: "1.5px solid " + (sel ? "#C4A044" : "rgba(180,172,158,.08)"),
                            background: sel ? "rgba(196,160,68,.25)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>{sel && <span style={{
                              fontSize: FS.sm,
                              color: "#C4A044",
                              lineHeight: 1
                            }}>{"✓"}</span>}</div><span style={{
                            fontSize: FS.lg,
                            color: sel ? "#C4A044" : "#b4ac9e",
                            whiteSpace: "nowrap"
                          }}>{cat}</span></div>;
                      })}</div>}</div>{recipeFilter.size > 0 && <button className={"btn btn-ghost btn-xs"} style={{
                    fontSize: FS.sm,
                    color: "#8a8478",
                    alignSelf: "center"
                  }} onClick={() => setRecipeFilter(new Set())}>{"Clear"}</button>}</div></div>{filteredTpls.length === 0 && <div className={"empty"}>{"No recipes match the selected categories."}</div>}{filteredTpls.map(tpl => {
                const xp = tpl.exercises.reduce((t, ex) => t + calcExXP(ex.exId, ex.sets, ex.reps, profile.chosenClass, allExById), 0);
                const descExpanded = expandedRecipeDesc.has(tpl.id);
                const tplMgColor = getRecipeMgColor(tpl);
                const diffCls = tpl.difficulty ? `wo-diff-pill wo-diff-${tpl.difficulty.toLowerCase()}` : null;
                return <div key={tpl.id} className={"workout-card"} style={{
                  marginBottom: S.s12,
                  "--mg-color": tplMgColor
                }}><div className={"workout-card-top"}><div className={"workout-icon"}>{tpl.icon}</div><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div className={"workout-name"}>{tpl.name}</div><div className={"workout-meta"}>{tpl.category && <span className={"wo-cat-pill"}>{tpl.category}</span>}{tpl.difficulty && <span className={diffCls}>{tpl.difficulty}</span>}<span className={"workout-tag"}>{tpl.exercises.length}{" ex"}</span><span className={"workout-tag"}>{formatXP(xp, {
                            prefix: "⚡ "
                          })}</span>{tpl.durationMin && <span className={"workout-tag"}>{"⏱ "}{tpl.durationMin}{"min"}</span>}{tpl.equipment && <span className={"workout-tag"}>{EQUIP_ICONS[tpl.equipment] || ""}{" "}{tpl.equipment}</span>}</div></div></div>
                  {
                    /* Collapsible Description */
                  }{tpl.desc && <div style={{
                    position: "relative",
                    marginBottom: descExpanded ? 10 : 4,
                    marginTop: S.s6
                  }}><div className={descExpanded ? "" : "recipe-desc-collapsed"} style={{
                      fontSize: FS.lg,
                      color: "#8a8478",
                      fontStyle: "italic",
                      lineHeight: 1.5,
                      whiteSpace: "pre-line",
                      paddingRight: 20
                    }}>{tpl.desc}</div><span className={`ex-collapse-btn ${descExpanded ? "open" : ""}`} style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      fontSize: FS.md,
                      padding: "0 4px",
                      cursor: "pointer"
                    }} onClick={() => setExpandedRecipeDesc(s => {
                      const n = new Set(s);
                      n.has(tpl.id) ? n.delete(tpl.id) : n.add(tpl.id);
                      return n;
                    })}>{"▼"}</span></div>
                  /* Exercise breakdown — collapsible, collapsed by default */}<div style={{
                    background: "rgba(45,42,36,.12)",
                    border: "1px solid rgba(45,42,36,.18)",
                    borderRadius: R.lg,
                    padding: "8px 12px",
                    marginBottom: S.s12,
                    cursor: "pointer"
                  }} onClick={() => setExpandedRecipeEx(s => {
                    const n = new Set(s);
                    n.has(tpl.id) ? n.delete(tpl.id) : n.add(tpl.id);
                    return n;
                  })}><div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between"
                    }}><span style={{
                        fontSize: FS.fs68,
                        color: "#8a8478"
                      }}>{tpl.exercises.length}{" exercises"}</span><span className={`ex-collapse-btn ${expandedRecipeEx.has(tpl.id) ? "open" : ""}`} style={{
                        fontSize: FS.fs65
                      }}>{"▼"}</span></div>{expandedRecipeEx.has(tpl.id) && <div style={{
                      marginTop: S.s8
                    }}>{(() => {
                        const rendered = new Set();
                        return tpl.exercises.map((ex, i) => {
                          if (rendered.has(i)) return null;
                          const exD = allExById[ex.exId];
                          if (!exD) return null;
                          const noSets = NO_SETS_EX_IDS.has(ex.exId);
                          // Check for superset pair
                          if (ex.supersetWith != null && !rendered.has(ex.supersetWith)) {
                            const j = ex.supersetWith;
                            const exB = tpl.exercises[j];
                            const exDB = allExById[exB?.exId];
                            if (exDB) {
                              rendered.add(i);
                              rendered.add(j);
                              const noSetsB = NO_SETS_EX_IDS.has(exB.exId);
                              return <div key={i} className={"recipe-ss-group"} style={{
                                borderLeft: "2px solid #C4A044",
                                paddingLeft: 8,
                                marginBottom: S.s6,
                                marginTop: i > 0 ? 6 : 0
                              }}><div style={{
                                  fontSize: FS.fs58,
                                  color: "#C4A044",
                                  fontWeight: 600,
                                  marginBottom: S.s4,
                                  textTransform: "uppercase",
                                  letterSpacing: ".5px"
                                }}>{"🔗 Superset"}</div><div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: S.s8,
                                  padding: "3px 0"
                                }}><span style={{
                                    fontSize: FS.fs90,
                                    flexShrink: 0
                                  }}>{exD.icon}</span><span style={{
                                    fontSize: FS.fs75,
                                    color: "#d4cec4",
                                    flex: 1
                                  }}>{exD.name}</span><span style={{
                                    fontSize: FS.fs68,
                                    color: "#8a8478"
                                  }}>{noSets ? `${ex.reps} min` : `${ex.sets} × ${ex.reps}`}</span></div><div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: S.s8,
                                  padding: "3px 0"
                                }}><span style={{
                                    fontSize: FS.fs90,
                                    flexShrink: 0
                                  }}>{exDB.icon}</span><span style={{
                                    fontSize: FS.fs75,
                                    color: "#d4cec4",
                                    flex: 1
                                  }}>{exDB.name}</span><span style={{
                                    fontSize: FS.fs68,
                                    color: "#8a8478"
                                  }}>{noSetsB ? `${exB.reps} min` : `${exB.sets} × ${exB.reps}`}</span></div></div>;
                            }
                          }
                          rendered.add(i);
                          return <div key={i} style={{
                            display: "flex",
                            alignItems: "center",
                            gap: S.s8,
                            padding: "4px 0",
                            borderBottom: i < tpl.exercises.length - 1 ? "1px solid rgba(45,42,36,.15)" : ""
                          }}><span style={{
                              fontSize: FS.fs90,
                              flexShrink: 0
                            }}>{exD.icon}</span><span style={{
                              fontSize: FS.fs75,
                              color: "#d4cec4",
                              flex: 1
                            }}>{exD.name}</span><span style={{
                              fontSize: FS.fs68,
                              color: "#8a8478"
                            }}>{noSets ? `${ex.distanceMi ? ex.distanceMi + "mi · " : ""}${ex.reps} min` : `${ex.sets} × ${ex.reps}`}</span></div>;
                        });
                      })()}</div>}</div><div style={{
                    display: "flex",
                    gap: S.s8
                  }}><button className={"btn btn-gold btn-sm"} style={{
                      flex: 1
                    }} onClick={() => {
                      const wo = {
                        id: uid(),
                        name: tpl.name,
                        icon: tpl.icon,
                        desc: tpl.desc,
                        exercises: tpl.exercises.map(e => ({
                          ...e
                        })),
                        createdAt: new Date().toLocaleDateString()
                      };
                      setProfile(pr => ({
                        ...pr,
                        workouts: [...(pr.workouts || []), wo]
                      }));
                      setActiveWorkout(wo);
                      setWorkoutView("detail");
                      showToast(`${tpl.icon} ${tpl.name} added to your workouts!`);
                    }}>{"＋ Add to My Workouts"}</button><button className={"btn btn-ghost btn-sm"} style={{
                      flex: 1
                    }} onClick={() => {
                      setWbName(tpl.name);
                      setWbIcon(tpl.icon);
                      setWbDesc(tpl.desc);
                      setWbExercises(tpl.exercises.map(e => ({
                        ...e
                      })));
                      setWbEditId(null);
                      setWorkoutView("builder");
                    }}>{"✎ Customize First"}</button></div></div>;
              })}</>;
          }

          // ── DETAIL ─────────────────────────────
          if (workoutView === "detail" && activeWorkout) {
            const wo = activeWorkout;
            const xp = calcWorkoutXP(wo);
            return <><div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                marginBottom: S.s12
              }}><button className={"btn btn-ghost btn-sm"} onClick={() => {
                  setWorkoutView("list");
                  setActiveWorkout(null);
                }}>{"← Back"}</button><div className={"sec"} style={{
                  margin: 0,
                  border: "none",
                  padding: S.s0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>{wo.icon}{" "}{wo.name}</div><div style={{
                  display: "flex",
                  gap: S.s6,
                  flexShrink: 0
                }}><button className={"btn btn-ghost btn-sm"} title={"Copy workout"} onClick={() => copyWorkout(wo)}>{"⎘ Copy"}</button><button className={"btn btn-ghost btn-sm"} onClick={() => initWorkoutBuilder(wo)}>{"✎ Edit"}</button></div></div>{wo.desc && <div style={{
                fontSize: FS.fs75,
                color: "#8a8478",
                fontStyle: "italic",
                marginBottom: S.s10
              }}>{wo.desc}</div>}<div style={{
                display: "flex",
                gap: S.s8,
                marginBottom: S.s14,
                flexWrap: "wrap"
              }}><div className={"xp-projection"} style={{
                  flex: 1,
                  minWidth: 160,
                  margin: 0
                }}><div><div className={"xp-proj-label"}>{"Total Projected XP"}</div><div className={"xp-proj-detail"}>{wo.exercises.length}{" exercises"}</div></div><div className={"xp-proj-value"}>{"⚡ "}{xp.toLocaleString()}</div></div></div><div className={"sec"} style={{
                marginBottom: S.s8
              }}>{"Exercises"}</div>{wo.exercises.map((ex, i) => {
                const exD = allExById[ex.exId];
                if (!exD) return null;
                const isC = exD.category === "cardio";
                const isF = exD.category === "flexibility";
                const showW = !isC && !isF;
                const exMgColor = getMuscleColor(exD.muscleGroup);
                return <div key={i} className={"workout-detail-ex"} style={{
                  "--mg-color": exMgColor
                }}><div className={"workout-detail-ex-orb"}><ExIcon ex={exD} size={".95rem"} color={"#d4cec4"} /></div><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div className={"workout-detail-ex-name"}>{exD.name}{exD.custom && <span className={"custom-ex-badge"} style={{
                        marginLeft: S.s6
                      }}>{"custom"}</span>}</div>{ex.exId !== "rest_day" && <div className={"workout-detail-ex-meta"}>{ex.sets}{"×"}{ex.reps}{isC || isF ? " min" : ""}{showW && ex.weightLbs ? <span style={{
                        color: "#8a8478",
                        marginLeft: S.s6
                      }}>{metric ? lbsToKg(ex.weightLbs) + " kg" : ex.weightLbs + " lbs"}</span> : ""}</div>}</div><div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: S.s8
                  }}>{exD.custom && <button className={"btn btn-ghost btn-xs"} title={"Edit custom exercise"} onClick={() => openExEditor("edit", exD)}>{"✎"}</button>}<div className={"workout-detail-ex-xp"}>{"+"}{calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById)}{" XP"}</div></div></div>;
              })}<div className={"div"} /><div style={{
                display: "flex",
                gap: S.s8,
                flexWrap: "wrap"
              }}><button className={"btn btn-glass-yellow"} style={{
                  flex: 2,
                  fontSize: FS.sm
                }} onClick={() => {
                  openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
                    setCompletionModal({
                      workout: woWithStats,
                      fromStats: _sr
                    });
                    setCompletionDate(todayStr());
                    setCompletionAction("today");
                  });
                }}>{"✓ Mark Complete or Schedule"}</button><button className={"btn btn-gold btn-sm"} style={{
                  flex: 1
                }} onClick={() => setAddToPlanPicker({
                  workout: wo
                })}>{"📋 Add to Plan"}</button><button className={"btn btn-danger btn-sm"} style={{
                  flex: 0,
                  paddingLeft: 10,
                  paddingRight: 10
                }} onClick={() => deleteWorkout(wo.id)}>{"🗑"}</button></div></>;
          }

          // ── BUILDER ────────────────────────────
          if (workoutView === "builder") return <><div className={"builder-nav-hdr"}><button className={"btn btn-ghost btn-sm"} onClick={() => {
                setWorkoutView("list");
                setWbCopySource(null);
                setWbIsOneOff(false);
                setWbEditId(null);
                setWbDuration("");
                setWbDurSec("");
                setWbActiveCal("");
                setWbTotalCal("");
                setWbLabels([]);
                setNewLabelInput("");
              }}>{"← Cancel"}</button><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"builder-nav-title"}>{wbIsOneOff ? wbEditId ? "✎ Edit One-Off" : "⚡ New One-Off Workout" : wbEditId ? "✎ Edit Workout" : wbCopySource ? "⎘ Copy Workout" : "⚔ New Workout"}</div>{wbCopySource && <div className={"builder-nav-sub"}>{"Forging from: "}{wbCopySource}</div>}</div></div>
            {
              /* Combined Identity + Labels + Session Stats panel */
            }<div className={"wb-section"}><div className={"field"}><label>{"Name "}<span className={"req-star"}>{"*"}</span></label><div className={"wb-identity-row"}><div className={"wb-icon-btn"} title={"Change icon"} onClick={() => setWbIconPickerOpen(v => !v)}>{wbIcon}<span className={"wb-icon-btn-caret"}>{"▾"}</span></div><input className={"inp"} value={wbName} onChange={e => setWbName(e.target.value)} placeholder={"e.g. Morning Push Day…"} /></div></div>{wbIconPickerOpen && <div className={"wb-icon-picker"}>{["💪","🏋️","🔥","⚔️","🏃","🚴","🧘","⚡","🎯","🛡️","🏆","🌟","💥","🗡️","🥊","🤸","🏊","🎽","🦵","🦾","🏅","🥇","⛹️","🤼","🧗","🤾","🎿","🏄","⛷️","🚣","🏹","🏇","🌿","🫀","🦴","💨","🌊","🏔️","🌄","🐉","🦅","🔱","☀️","🌙","🌪️","💫","🎖️","⚒️","🧱","🥋"].map(ic => <div key={ic} className={`icon-opt ${wbIcon === ic ? "sel" : ""}`} onClick={() => { setWbIcon(ic); setWbIconPickerOpen(false); }}>{ic}</div>)}</div>}<div className={"field"} style={{marginTop: S.s8}}><label>{"Description "}<span style={{color:"#8a8478",fontWeight:"normal",textTransform:"none"}}>{"(optional)"}</span></label><input className={"inp"} value={wbDesc} onChange={e => setWbDesc(e.target.value)} placeholder={"e.g. Upper body strength focus…"} /></div><div className={"wb-section-divider"} /><div className={"wb-sub-hdr"}><span className={"wb-sub-hdr-icon"}>{"❖"}</span>{"Labels"}<span style={{color:"#8a8478",fontWeight:"normal",letterSpacing:".05em",marginLeft:S.s6,textTransform:"none"}}>{"(optional)"}</span></div><div style={{display:"flex",gap:S.s6,flexWrap:"wrap",alignItems:"center"}}>{(profile.workoutLabels || []).map(l => <span key={l} className={"wo-label-chip" + (wbLabels.includes(l) ? " sel" : "")} onClick={() => setWbLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}>{l}</span>)}<span style={{display:"inline-flex",alignItems:"center",gap:S.s4}}><input className={"wo-label-new-inp"} value={newLabelInput} onChange={e => setNewLabelInput(e.target.value)} onKeyDown={e => {
                    if (e.key === "Enter" && newLabelInput.trim()) {
                      const lbl = newLabelInput.trim();
                      if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
                        setProfile(p => ({
                          ...p,
                          workoutLabels: [...(p.workoutLabels || []), lbl]
                        }));
                      }
                      if (!wbLabels.includes(lbl)) setWbLabels(prev => [...prev, lbl]);
                      setNewLabelInput("");
                    }
                  }} placeholder={"+ New label…"} style={{width: 100}} /><button className={"btn btn-ghost btn-xs"} style={{padding:"2px 6px",fontSize:FS.sm}} onClick={() => {
                    const lbl = newLabelInput.trim();
                    if (!lbl) return;
                    if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
                      setProfile(p => ({
                        ...p,
                        workoutLabels: [...(p.workoutLabels || []), lbl]
                      }));
                    }
                    if (!wbLabels.includes(lbl)) setWbLabels(prev => [...prev, lbl]);
                    setNewLabelInput("");
                  }}>{"+"}</button></span></div><div className={"wb-section-divider"} /><div className={"wb-sub-hdr"}><span className={"wb-sub-hdr-icon"}>{"⏱"}</span>{"Session Stats"}<span style={{color:"#8a8478",fontWeight:"normal",letterSpacing:".05em",marginLeft:S.s6,textTransform:"none"}}>{"(optional)"}</span></div><div className={"wb-stats-row"}><div className={"field"} style={{flex:2,marginBottom:S.s0}}><label>{"Duration"}</label><input className={"inp"} type={"text"} inputMode={"numeric"} value={wbDuration} onChange={e => setWbDuration(e.target.value)} onBlur={e => {
                  const val = e.target.value.trim();
                  if (!val) { setWbDuration(""); setWbDurSec(""); return; }
                  const hms = val.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
                  if (hms) {
                    const h = Number(hms[1]), m = Number(hms[2]), s = Number(hms[3]);
                    const ss = Math.min(s, 59);
                    setWbDuration(`${String(h + Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}:${String(ss).padStart(2,"0")}`);
                    setWbDurSec("");
                  } else {
                    setWbDuration(normalizeHHMM(val));
                    setWbDurSec("");
                  }
                }} placeholder={"HH:MM or HH:MM:SS"} style={{textAlign:"center"}} /><div className={"wb-dur-hint"}>{"90 = 1h30m · include :SS for seconds"}</div></div><div className={"field"} style={{flex:1.3,marginBottom:S.s0}}><label>{"Active Cal"}</label><input className={"inp"} type={"number"} min={"0"} max={"9999"} value={wbActiveCal} onChange={e => setWbActiveCal(e.target.value)} placeholder={"320"} /></div><div className={"field"} style={{flex:1.3,marginBottom:S.s0}}><label>{"Total Cal"}</label><input className={"inp"} type={"number"} min={"0"} max={"9999"} value={wbTotalCal} onChange={e => setWbTotalCal(e.target.value)} placeholder={"450"} /></div></div></div>
            {
              /* Exercise list */
            }<div className={"wo-section-hdr"} style={{
              marginTop: S.s18,
              marginBottom: S.s10
            }}><span className={"wo-section-hdr-text"}>{"⚔ Techniques"}</span></div><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: S.s8
            }}><label>{"("}{wbExercises.length}{" exercise"}{wbExercises.length !== 1 ? "s" : ""}{")"}{wbExercises.length > 0 && <span style={{
                  marginLeft: S.s8,
                  fontSize: FS.fs65,
                  color: "#b4ac9e",
                  fontFamily: "'Inter',sans-serif"
                }}>{"⚡ "}{formatXP(wbTotalXP)}{" total"}</span>}</label><div style={{
                display: "flex",
                gap: S.s6
              }}><button className={"btn btn-ghost btn-xs"} onClick={() => setWbExPickerOpen(true)}>{"＋ Add Exercise"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => openExEditor("create", null)}>{"⚔ Forge Custom"}</button></div></div>{wbExercises.length === 0 && <div className={"empty"} style={{
              padding: "16px 0"
            }}>{"No techniques yet. Add from the arsenal or forge a custom one."}</div>}{(() => {
              const minSsChecked = ssChecked.size > 0 ? Math.min(...ssChecked) : -1;
              return wbExercises.map((ex, i) => {
                const exD = allExById[ex.exId];
                if (!exD) return null;
                const isC = exD.category === "cardio";
                const isF = exD.category === "flexibility";
                const showW = !isC && !isF;
                const showSsConnector = false; // replaced by group card
                // If this row is the SECOND in a pair (its anchor points back to i), skip — rendered by anchor
                const isSecondInPair = wbExercises.some((x, xi) => x.supersetWith != null && x.supersetWith === i && xi < i);
                if (isSecondInPair) return null;
                // If this row is the FIRST in a pair, we'll render a Group Card wrapper
                const partnerIdx = ex.supersetWith != null ? ex.supersetWith : null;
                const partnerEx = partnerIdx != null ? wbExercises[partnerIdx] : null;
                const partnerExD = partnerEx ? allExById[partnerEx.exId] || null : null;
                const showDist = isC;
                const showHR = isC;
                const isTreadmill = exD.hasTreadmill || false;
                const noSetsEx = NO_SETS_EX_IDS.has(exD.id);
                const isRunningEx = exD.id === RUNNING_EX_ID;
                const age = profile.age || 30;
                const dispW = ex.weightLbs ? metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
                const dispDist = ex.distanceMi ? metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi) : "";
                const pbPaceMi = profile.runningPB || null;
                const pbDisp = pbPaceMi ? metric ? parseFloat((pbPaceMi * 1.60934).toFixed(2)) + " min/km" : parseFloat(pbPaceMi.toFixed(2)) + " min/mi" : null;
                const exPB = (profile.exercisePBs || {})[exD.id] || null;
                const exPBDisp = exPB ? exPB.type === "cardio" ? metric ? parseFloat((exPB.value * 1.60934).toFixed(2)) + " min/km" : parseFloat(exPB.value.toFixed(2)) + " min/mi" : exPB.type === "assisted" ? "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") + " (Assisted)" : "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") : null;
                const durationMin = parseFloat(ex.reps || 0);
                const distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
                const runPace = isRunningEx && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
                const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
                const catColor = getTypeColor(exD.category);
                const mgColor = getMuscleColor(exD.muscleGroup);
                /* ── ACCORDION SUPERSET CARD — replaces both solo rows when paired ── */
                if (partnerIdx != null && partnerExD) {
                  const totalXP = calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById) + calcExXP(partnerEx.exId, partnerEx.sets || 3, partnerEx.reps || 10, profile.chosenClass, allExById);
                  return <div key={i} className={"ss-accordion"}><div className={"ss-accordion-hdr"}><div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: S.s2,
                        flexShrink: 0
                      }}><button className={"btn btn-ghost btn-xs"} style={{
                          padding: "2px 6px",
                          fontSize: FS.fs65,
                          lineHeight: 1,
                          minWidth: 0,
                          opacity: Math.min(i, partnerIdx) === 0 ? .3 : 1
                        }} onClick={e => {
                          e.stopPropagation();
                          reorderSupersetPair(i, partnerIdx, "up");
                        }}>{"▲"}</button><button className={"btn btn-ghost btn-xs"} style={{
                          padding: "2px 6px",
                          fontSize: FS.fs65,
                          lineHeight: 1,
                          minWidth: 0,
                          opacity: Math.max(i, partnerIdx) >= wbExercises.length - 1 ? .3 : 1
                        }} onClick={e => {
                          e.stopPropagation();
                          reorderSupersetPair(i, partnerIdx, "down");
                        }}>{"▼"}</button></div><span className={"ss-accordion-hdr-title"}>{"🔗 Superset"}</span><span className={"ss-accordion-xp"}>{formatXP(totalXP) + " total"}</span><button className={"ss-accordion-ungroup"} onClick={() => setWbExercises(exs => exs.map((x, xi) => xi === i ? {
                        ...x,
                        supersetWith: null
                      } : xi === partnerIdx ? {
                        ...x,
                        supersetWith: null
                      } : x))}>{"✕ Ungroup"}</button></div>{renderSsAccordionSection(ex, i, exD, "A", i + "_a")}{renderSsAccordionSection(partnerEx, partnerIdx, partnerExD, "B", i + "_b")}</div>;
                }
                return <>{i === minSsChecked && ssChecked.size > 0 && <div className={"ss-action-bar"}><span className={"ss-action-text"}>{ssChecked.size + " exercise" + (ssChecked.size !== 1 ? "s" : "") + " selected"}</span>{ssChecked.size === 2 && <button className={"ss-action-btn"} onClick={() => {
                      const [a, b] = [...ssChecked];
                      setWbExercises(exs => exs.map((x, xi) => xi === a ? {
                        ...x,
                        supersetWith: b
                      } : xi === b ? {
                        ...x,
                        supersetWith: a
                      } : x));
                      setSsChecked(new Set());
                    }}>{"🔗 Group as Superset"}</button>}<button className={"ss-action-cancel"} onClick={() => setSsChecked(new Set())}>{"✕"}</button></div>}<div className={`wb-ex-row ${dragWbExIdx === i ? "dragging" : ""}`} style={{
                    opacity: dragWbExIdx === i ? 0.5 : 1,
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: S.s0,
                    "--cat-color": catColor,
                    "--mg-color": mgColor
                  }} draggable={true} onDragStart={e => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragWbExIdx(i);
                  }} onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }} onDrop={e => {
                    e.preventDefault();
                    reorderWbEx(dragWbExIdx, i);
                    setDragWbExIdx(null);
                  }} onDragEnd={() => setDragWbExIdx(null)}><WbExCard ex={ex} i={i} exD={exD} collapsed={!!collapsedWbEx[i]} profile={profile} allExById={allExById} metric={metric} wUnit={wUnit} setWbExercises={setWbExercises} setCollapsedWbEx={setCollapsedWbEx} setSsChecked={setSsChecked} ssChecked={ssChecked} exCount={wbExercises.length} openExEditor={openExEditor} /></div></>;
              });
            })()}<div className={"div"} />{wbIsOneOff ? wbEditId ?
            // Editing an existing scheduled one-off — save changes in place
            <button className={"btn btn-gold"} style={{
              width: "100%"
            }} onClick={() => {
              if (!wbName.trim()) {
                showToast("Name your workout first!");
                return;
              }
              if (wbExercises.length === 0) {
                showToast("Add at least one exercise.");
                return;
              }
              const updated = {
                id: wbEditId,
                name: wbName.trim(),
                icon: wbIcon,
                desc: wbDesc.trim(),
                exercises: wbExercises,
                createdAt: todayStr(),
                oneOff: true,
                labels: wbLabels
              };
              setProfile(p => ({
                ...p,
                // Update the saved workout object
                workouts: (p.workouts || []).find(w => w.id === wbEditId) ? (p.workouts || []).map(w => w.id === wbEditId ? updated : w) : [...(p.workouts || []), updated],
                // Sync the name/icon on all matching scheduledWorkouts
                scheduledWorkouts: (p.scheduledWorkouts || []).map(sw => sw.sourceWorkoutId === wbEditId ? {
                  ...sw,
                  sourceWorkoutName: updated.name,
                  sourceWorkoutIcon: updated.icon
                } : sw)
              }));
              setWorkoutView("list");
              setWbEditId(null);
              setWbIsOneOff(false);
              showToast(`⚡ "${updated.name}" updated!`);
            }}>{"💾 Save Changes"}</button> :
            // New one-off — proceed through stats prompt then to log/schedule
            <button className={"btn btn-gold"} style={{
              width: "100%"
            }} onClick={() => {
              if (!wbName.trim()) {
                showToast("Name your workout first!");
                return;
              }
              if (wbExercises.length === 0) {
                showToast("Add at least one exercise.");
                return;
              }
              const dur = combineHHMMSec(wbDuration, wbDurSec) || null;
              const wo = {
                id: uid(),
                name: wbName.trim(),
                icon: wbIcon,
                desc: wbDesc.trim(),
                exercises: wbExercises,
                createdAt: todayStr(),
                oneOff: true,
                durationMin: dur || null,
                activeCal: wbActiveCal || null,
                totalCal: wbTotalCal || null,
                labels: wbLabels
              };
              openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
                setCompletionModal({
                  workout: woWithStats,
                  fromStats: _sr
                });
                setCompletionDate(todayStr());
                setCompletionAction("today");
              });
              setWorkoutView("list");
            }}>{"Next: Log or Schedule →"}</button> : wbEditId ? <div style={{
              display: "flex",
              gap: S.s8
            }}><button className={"btn btn-gold"} style={{
                flex: 1
              }} onClick={saveBuiltWorkout}>{"💾 Update Workout"}</button><button className={"btn btn-ghost"} style={{
                flex: 1
              }} onClick={saveAsNewWorkout}>{"📋 Save As New"}</button></div> : <div style={{
              display: "flex",
              gap: S.s8,
              width: "100%"
            }}><button className={"btn btn-gold"} style={{
                flex: 1
              }} onClick={saveBuiltWorkout}>{"💾 Save Workout"}</button><button className={"btn btn-gold"} style={{
                flex: 1,
                background: "linear-gradient(135deg,#8B7425,#A89030)"
              }} onClick={() => {
                if (!wbName.trim()) {
                  showToast("Name your workout first!");
                  return;
                }
                if (wbExercises.length === 0) {
                  showToast("Add at least one exercise.");
                  return;
                }
                const dur = combineHHMMSec(wbDuration, wbDurSec) || null;
                const wo = {
                  id: uid(),
                  name: wbName.trim(),
                  icon: wbIcon,
                  desc: wbDesc.trim(),
                  exercises: wbExercises,
                  createdAt: todayStr(),
                  oneOff: true,
                  durationMin: dur || null,
                  activeCal: wbActiveCal || null,
                  totalCal: wbTotalCal || null,
                  labels: wbLabels
                };
                openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
                  setCompletionModal({
                    workout: woWithStats,
                    fromStats: _sr
                  });
                  setCompletionDate(todayStr());
                  setCompletionAction("today");
                });
                setWorkoutView("list");
              }}>{"✓ Complete / Schedule"}</button></div>}</>;
          return null;
        })()

        /* ── PLANS TAB ───────────────────────── */}{<div style={activeTab !== "plans" ? {display:"none"} : undefined}><PlansTabContainer ref={plansContainerRef} profile={profile} setProfile={setProfile} allExercises={allExercises} allExById={allExById} cls={cls} showToast={showToast} setConfirmDelete={setConfirmDelete} setDetailEx={setDetailEx} setDetailImgIdx={setDetailImgIdx} onSchedulePlan={openSchedulePlan} onScheduleEx={openScheduleEx} onRemoveScheduledWorkout={removeScheduledWorkout} onStatsPrompt={openStatsPromptIfNeeded} onOpenExEditor={openExEditor} setXpFlash={setXpFlash} applyAutoCheckIn={applyAutoCheckIn} pendingOpen={plansPendingOpen} onPendingOpenDone={() => setPlansPendingOpen(null)} /></div>

        /* ── CALENDAR TAB ────────────────────── */}{activeTab === "calendar" && (() => {
          const {
            y,
            m
          } = calViewDate;
          const today = todayStr();
          const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
          const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

          // Build calendar grid
          const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
          const daysInMonth = new Date(y, m + 1, 0).getDate();
          const daysInPrev = new Date(y, m, 0).getDate();

          // Build date→events maps
          const schedMap = {}; // dateStr → [{kind,icon,name,id,planId}]
          // Scheduled plans — populate every day in their date range
          profile.plans.filter(p => p.scheduledDate || p.startDate).forEach(p => {
            const start = p.startDate || p.scheduledDate;
            const end = p.endDate || p.scheduledDate || p.startDate;
            if (!start) return;
            // Iterate every date from start to end
            const s = new Date(start + "T12:00:00");
            const e = new Date(end + "T12:00:00");
            for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
              const dk = d.toISOString().slice(0, 10);
              if (!schedMap[dk]) schedMap[dk] = [];
              // Only add once per plan per day
              if (!schedMap[dk].find(x => x.id === p.id)) schedMap[dk].push({
                kind: "plan",
                icon: p.icon,
                name: p.name,
                id: p.id,
                planId: p.id,
                notes: p.scheduleNotes,
                isRange: !!(p.startDate && p.endDate),
                rangeStart: start,
                rangeEnd: end
              });
            }
          });
          // Scheduled exercises
          (profile.scheduledWorkouts || []).forEach(s => {
            const ex = allExById[s.exId];
            const dk = s.scheduledDate;
            if (!schedMap[dk]) schedMap[dk] = [];
            schedMap[dk].push({
              kind: "ex",
              icon: ex ? ex.icon : "💪",
              name: ex ? ex.name : "Exercise",
              id: s.id,
              notes: s.notes
            });
          });
          // Logged workouts (past)
          const logMap = {}; // dateKey → [{...entry}]
          profile.log.forEach(e => {
            const dk = e.dateKey || "";
            if (!dk) return;
            if (!logMap[dk]) logMap[dk] = [];
            logMap[dk].push(e);
          });

          // Build cell array
          const cells = [];
          for (let i = 0; i < firstDay; i++) cells.push({
            day: daysInPrev - firstDay + 1 + i,
            thisMonth: false,
            dateStr: null
          });
          for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            cells.push({
              day: d,
              thisMonth: true,
              dateStr: ds
            });
          }
          const remainder = (7 - cells.length % 7) % 7;
          for (let i = 1; i <= remainder; i++) cells.push({
            day: i,
            thisMonth: false,
            dateStr: null
          });

          // Selected day events
          const selSched = calSelDate ? schedMap[calSelDate] || [] : [];
          const selLog = calSelDate ? logMap[calSelDate] || [] : [];
          const selDateObj = calSelDate ? new Date(calSelDate + "T12:00:00") : null;
          const selLabel = selDateObj ? selDateObj.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
          }) : "";
          const isSelToday = calSelDate === today;
          return <><div className={"rpg-sec-header rpg-sec-header-center"} style={{
              marginBottom: S.s10
            }}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Chronicle ✦"}</span><div className={"rpg-sec-line rpg-sec-line-r"} /></div>

            {
              /* Month navigator */
            }<div className={"cal-nav"}><div className={"cal-nav-btn"} onClick={() => setCalViewDate(({
                y,
                m
              }) => m === 0 ? {
                y: y - 1,
                m: 11
              } : {
                y,
                m: m - 1
              })}>{"‹"}</div><div className={"cal-month-lbl"}>{monthNames[m]}{" "}{y}</div><div className={"cal-nav-btn"} onClick={() => setCalViewDate(({
                y,
                m
              }) => m === 11 ? {
                y: y + 1,
                m: 0
              } : {
                y,
                m: m + 1
              })}>{"›"}</div></div>

            {
              /* Day-of-week headers */
            }<div className={"cal-grid"}>{dowNames.map(d => <div key={d} className={"cal-dow"}>{d}</div>)

              /* Calendar cells */}{cells.map((cell, ci) => {
                if (!cell.thisMonth) return <div key={"o" + ci} className={"cal-cell other-month"}><span className={"cal-day-num"}>{cell.day}</span></div>;
                const ds = cell.dateStr;
                const hasSched = !!(schedMap[ds] && schedMap[ds].length > 0);
                const hasLog = !!(logMap[ds] && logMap[ds].length > 0);
                const isToday = ds === today;
                const isSel = ds === calSelDate;
                const schedDots = (schedMap[ds] || []).map(e => e.kind === "plan" ? "#d4cec4" : "#3498db");
                const logDot = hasLog ? UI_COLORS.success : null;
                return <div key={ds} className={`cal-cell ${isToday ? "today" : ""} ${isSel ? "selected" : ""} ${hasSched ? "has-event" : ""} ${hasLog && !hasSched ? "has-log" : ""}`} onClick={() => setCalSelDate(ds)}><span className={"cal-day-num"}>{cell.day}</span><div className={"cal-dot-row"}>{schedDots.slice(0, 3).map((c, i) => <div key={i} className={"cal-dot"} style={{
                      background: c
                    }} />)}{logDot && <div className={"cal-dot"} style={{
                      background: logDot
                    }} />}</div></div>;
              })}</div>

            {
              /* Legend */
            }<div className={"cal-legend"}><div className={"cal-legend-item"}><div className={"cal-legend-dot"} style={{
                  background: "#b4ac9e"
                }} />{" Planned workout"}</div><div className={"cal-legend-item"}><div className={"cal-legend-dot"} style={{
                  background: "#3498db"
                }} />{" Scheduled exercise"}</div><div className={"cal-legend-item"}><div className={"cal-legend-dot"} style={{
                  background: UI_COLORS.success
                }} />{" Completed session"}</div></div>

            {
              /* Monthly Totals — moved from above to be grouped with Month summary below */
            }

            {
              /* Selected day detail */
            }{calSelDate && <div className={"cal-day-detail"}><div className={"cal-day-hdr"}><span>{selLabel}</span>{isSelToday && <span style={{
                  fontSize: FS.sm,
                  color: "#b4ac9e",
                  fontFamily: "'Inter',sans-serif"
                }}>{"Today"}</span>}</div>

              {
                /* Scheduled items */
              }{selSched.length > 0 && <><div style={{
                  fontFamily: "'Inter',sans-serif",
                  fontSize: FS.fs54,
                  color: "#8a8478",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  marginBottom: S.s6
                }}>{"Scheduled"}</div>{selSched.map((ev, i) => <div key={i} className={"cal-event-row sched"}><span className={"cal-event-icon"}>{ev.icon}</span><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div className={"cal-event-name"}>{ev.name}</div>{ev.notes && <div className={"cal-event-sub"}>{ev.notes}</div>}<div className={"cal-event-sub"}>{ev.kind === "plan" ? "Workout Plan" : "Exercise"}</div></div>{ev.kind === "plan" && <button className={"cal-sched-btn"} onClick={() => {
                    const pl = profile.plans.find(p => p.id === ev.planId);
                    if (pl) {
                      setPlansPendingOpen({ plan: pl, isEdit: true });
                      setActiveTab("plans");
                    }
                  }}>{"View →"}</button>}<div className={"upcoming-del"} onClick={() => {
                    ev.kind === "plan" ? removePlanSchedule(ev.planId) : removeScheduledWorkout(ev.id);
                  }}>{"✕"}</div></div>)}</>

              /* Logged sessions — grouped by workout/plan */}{selLog.length > 0 && (() => {
                /* Group by sourceGroupId */
                const groups = {};
                const ungrouped = [];
                selLog.forEach(e => {
                  const gid = e.sourceGroupId;
                  if (gid) {
                    if (!groups[gid]) groups[gid] = [];
                    groups[gid].push(e);
                  } else ungrouped.push(e);
                });
                const groupArr = Object.values(groups);
                return <><div style={{
                    fontFamily: "'Inter',sans-serif",
                    fontSize: FS.fs54,
                    color: "#8a8478",
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    marginBottom: S.s6,
                    marginTop: selSched.length > 0 ? 10 : 0
                  }}>{"Completed"}</div>
                  {
                    /* Grouped workout/plan cards */
                  }{groupArr.map((entries, gi) => {
                    const first = entries[0];
                    const groupXP = entries.reduce((s, e) => s + e.xp, 0);
                    const gid = first.sourceGroupId;
                    const cKey = "cal_" + gid;
                    const collapsed = !openLogGroups[cKey];
                    const label = first.sourcePlanName || first.sourceWorkoutName || "Workout";
                    const icon = first.sourcePlanIcon || first.sourceWorkoutIcon || "💪";
                    const uniqueExCount = new Set(entries.map(e => e.exId)).size;
                    const gStats = getEntryStats(first);
                    const hasStats = gStats.durationSec || gStats.activeCal || gStats.totalCal;
                    const calGrpFirstEx = entries.map(en => allExById[en.exId]).find(Boolean);
                    const calGrpMgColor = getMuscleColor(calGrpFirstEx && calGrpFirstEx.muscleGroup);
                    return <div key={gi} className={"log-group-card"} style={{
                      marginBottom: S.s8,
                      "--mg-color": calGrpMgColor
                    }}><div className={"log-group-hdr " + (collapsed ? "collapsed" : "")} onClick={() => toggleLogGroup(cKey)} style={{
                        cursor: "pointer"
                      }}><span className={"log-group-icon"}>{icon}</span><div style={{
                          flex: 1,
                          minWidth: 0
                        }}><div className={"log-group-name"}>{label}</div><div className={"log-group-meta"}>{uniqueExCount}{" exercise"}{uniqueExCount !== 1 ? "s" : ""}{" · "}{first.time}</div>{hasStats && <div style={{
                            fontSize: FS.fs50,
                            color: "#8a8478",
                            marginTop: S.s2,
                            display: "flex",
                            gap: S.s8
                          }}>{gStats.durationSec > 0 && <span>{"⏱ "}{secToHMS(gStats.durationSec)}</span>}{gStats.totalCal > 0 && <span>{"🔥 "}{gStats.totalCal}{" cal"}</span>}{gStats.activeCal > 0 && <span>{"⚡ "}{gStats.activeCal}{" active"}</span>}</div>}</div><div className={"log-group-xp"}>{formatXP(groupXP, {
                            prefix: "⚡ "
                          })}</div><span style={{
                          fontSize: FS.sm,
                          color: "#8a8478",
                          flexShrink: 0,
                          transition: "transform .2s",
                          transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                          marginLeft: S.s6
                        }}>{"▾"}</span></div>{!collapsed && (() => {
                        // Consolidate entries by exId
                        const byExId = {};
                        entries.forEach(e => {
                          if (!byExId[e.exId]) byExId[e.exId] = [];
                          byExId[e.exId].push(e);
                        });
                        const consolidated = Object.values(byExId);
                        return <div className={"log-group-body"}>{consolidated.map((exEntries, ci) => {
                            const ef = exEntries[0];
                            const exXP = exEntries.reduce((s, e) => s + e.xp, 0);
                            const isSuperset = exEntries.some(e => entries.some((o, oi) => o.exId !== e.exId && o.sourceGroupId === e.sourceGroupId && (o.supersetWith != null || e.supersetWith != null)));
                            const efData = allExById[ef.exId];
                            const efMgColor = getMuscleColor(efData && efData.muscleGroup);
                            return <div key={ci} className={"h-entry"} style={{
                              marginBottom: S.s4,
                              cursor: "pointer",
                              "--mg-color": efMgColor
                            }} onClick={() => setCalExDetailModal({
                              entries: exEntries,
                              exerciseName: ef.exercise,
                              exerciseIcon: ef.icon,
                              sourceName: first.sourcePlanName || first.sourceWorkoutName || null,
                              sourceIcon: icon,
                              totalCal: gStats.totalCal,
                              activeCal: gStats.activeCal,
                              durationSec: gStats.durationSec
                            })}><div className={"h-entry-hdr"}><span className={"h-icon"}>{ef.icon}</span><div style={{
                                flex: 1,
                                minWidth: 0
                              }}><div className={"h-name"} style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: S.s4
                                }}><span>{ef.exercise}</span>{isSuperset && <span style={{
                                    fontSize: FS.fs48,
                                    color: "#b4ac9e",
                                    background: "rgba(180,172,158,.1)",
                                    padding: "2px 6px",
                                    borderRadius: R.r3,
                                    fontWeight: 600
                                  }}>{"SS"}</span>}{exEntries.length > 1 && <span style={{
                                    fontSize: FS.fs48,
                                    color: "#8a8478",
                                    background: "rgba(180,172,158,.08)",
                                    padding: "2px 6px",
                                    borderRadius: R.r3
                                  }}>{exEntries.length}{" sets"}</span>}</div></div><div className={"h-xp"}>{"+"}{exXP}{" XP"}</div></div></div>;
                          })}</div>;
                      })()}</div>;
                  })
                  /* Ungrouped standalone exercises */}{ungrouped.map((e, i) => {
                    const uStats = getEntryStats(e);
                    const uHasStats = uStats.durationSec || uStats.activeCal || uStats.totalCal;
                    return <div key={"u" + i} className={"cal-event-row log-entry"} style={{
                      cursor: "pointer"
                    }} onClick={() => setCalExDetailModal({
                      entries: [e],
                      exerciseName: e.exercise,
                      exerciseIcon: e.icon,
                      sourceName: null,
                      sourceIcon: null,
                      totalCal: uStats.totalCal,
                      activeCal: uStats.activeCal,
                      durationSec: uStats.durationSec
                    })}><span className={"cal-event-icon"}>{e.icon}</span><div style={{
                        flex: 1,
                        minWidth: 0
                      }}><div className={"cal-event-name"}>{e.exercise}</div><div className={"cal-event-sub"}>{e.sets}{"×"}{e.reps}{e.weightLbs ? <span style={{
                            marginLeft: S.s6
                          }}>{isMetric(profile.units) ? lbsToKg(e.weightLbs) + " kg" : e.weightLbs + " lbs"}</span> : ""}{e.distanceMi ? <span style={{
                            marginLeft: S.s6
                          }}>{isMetric(profile.units) ? miToKm(e.distanceMi) + " km" : e.distanceMi + " mi"}</span> : ""}<span style={{
                            marginLeft: S.s6,
                            color: "#8a8478"
                          }}>{e.time}</span></div>{uHasStats && <div style={{
                          fontSize: FS.fs50,
                          color: "#8a8478",
                          marginTop: S.s2,
                          display: "flex",
                          gap: S.s8
                        }}>{uStats.durationSec > 0 && <span>{"⏱ "}{secToHMS(uStats.durationSec)}</span>}{uStats.totalCal > 0 && <span>{"🔥 "}{uStats.totalCal}{" cal"}</span>}{uStats.activeCal > 0 && <span>{"⚡ "}{uStats.activeCal}{" active"}</span>}</div>}</div><div className={"cal-event-xp"}>{"+"}{e.xp}{" XP"}</div></div>;
                  })}</>;
              })()}{selSched.length === 0 && selLog.length === 0 && <div className={"cal-empty-day"}>{"No workouts "}{calSelDate >= today ? "planned" : "logged"}{" for this day."}</div>}</div>

            /* Month summary */}{(() => {
              const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
              const monthSched = Object.entries(schedMap).filter(([dk]) => dk.startsWith(monthPrefix));
              const monthLog = Object.entries(logMap).filter(([dk]) => dk.startsWith(monthPrefix));
              const totalLoggedDays = monthLog.length;
              const totalSchedItems = monthSched.reduce((s, [, arr]) => s + arr.length, 0);
              const totalLogXP = monthLog.reduce((s, [, arr]) => s + arr.reduce((t, e) => t + e.xp, 0), 0);
              return <div style={{
                display: "flex",
                gap: S.s8,
                marginTop: S.s4
              }}><div className={"eff-weight"} style={{
                  flex: 1
                }}><span className={"eff-weight-val"}>{totalLoggedDays}</span><span className={"eff-weight-lbl"}>{"Sessions this month"}</span></div><div className={"eff-weight"} style={{
                  flex: 1
                }}><span className={"eff-weight-val"}>{totalSchedItems}</span><span className={"eff-weight-lbl"}>{"Scheduled"}</span></div><div className={"eff-weight"} style={{
                  flex: 1
                }}><span className={"eff-weight-val"}>{totalLogXP.toLocaleString()}</span><span className={"eff-weight-lbl"}>{"XP earned"}</span></div></div>;
            })()

            /* Duration / Calorie totals */}{(() => {
              const mPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
              const mEntries = profile.log.filter(e => e.dateKey && e.dateKey.startsWith(mPrefix));
              // Deduplicate grouped entries (workouts/plans share a sourceGroupId)
              const grouped = {};
              const ungrouped = [];
              mEntries.forEach(e => {
                if (e.sourceGroupId) {
                  if (!grouped[e.sourceGroupId]) grouped[e.sourceGroupId] = e;
                } else {
                  ungrouped.push(e);
                }
              });
              const sources = [...Object.values(grouped), ...ungrouped];
              const statsArr = sources.map(e => getEntryStats(e));
              const estC = statsArr.reduce((s, st) => s + st.totalCal, 0);
              const estA = statsArr.reduce((s, st) => s + st.activeCal, 0);
              const totalSec = statsArr.reduce((s, st) => s + st.durationSec, 0);
              const dH = Math.floor(totalSec / 3600);
              const dM = Math.floor(totalSec % 3600 / 60);
              const dS = totalSec % 60;
              const dStr = String(dH).padStart(2, "0") + ":" + String(dM).padStart(2, "0") + ":" + String(dS).padStart(2, "0");
              return <div style={{
                display: "flex",
                gap: S.s8,
                marginTop: S.s8
              }}><div className={"eff-weight"} style={{
                  flex: 1
                }}><span className={"eff-weight-val"}>{dStr}</span><span className={"eff-weight-lbl"}>{"Duration"}</span></div><div className={"eff-weight"} style={{
                  flex: 1
                }}><span className={"eff-weight-val"}>{estC.toLocaleString()}</span><span className={"eff-weight-lbl"}>{"Total Cal"}</span></div><div className={"eff-weight"} style={{
                  flex: 1
                }}><span className={"eff-weight-val"}>{estA.toLocaleString()}</span><span className={"eff-weight-lbl"}>{"Active Cal"}</span></div></div>;
            })()}</>;
        })()

        /* ── LEADERBOARD TAB ─────────────────────── */}{activeTab === "leaderboard" && (() => {
          const LB_FILTERS = [{
            id: "overall_xp",
            label: "Overall XP",
            type: "xp",
            icon: "⚔️",
            desc: "Total XP earned all time"
          }, {
            id: "weekly_xp",
            label: "Weekly XP",
            type: "xp",
            icon: "📅",
            desc: "XP earned this week (resets Monday)"
          }, {
            id: "bench_1rm",
            label: "Bench Press",
            type: "strength",
            icon: "🏋️",
            desc: "Heaviest 1x1 set"
          }, {
            id: "squat_1rm",
            label: "Squat",
            type: "strength",
            icon: "🦵",
            desc: "Heaviest 1x1 set"
          }, {
            id: "deadlift_1rm",
            label: "Deadlift",
            type: "strength",
            icon: "💀",
            desc: "Heaviest 1x1 set"
          }, {
            id: "ohp_1rm",
            label: "Overhead Press",
            type: "strength",
            icon: "🏹",
            desc: "Heaviest 1x1 set"
          }, {
            id: "pullup_reps",
            label: "Pull-Ups",
            type: "reps",
            icon: "💪",
            desc: "Most reps in 1 set"
          }, {
            id: "pushup_reps",
            label: "Push-Ups",
            type: "reps",
            icon: "🤸",
            desc: "Most reps in 1 set"
          }, {
            id: "run_pace",
            label: "Running Pace",
            type: "cardio",
            icon: "🏃",
            desc: "Best min/mi (lower = faster)"
          }, {
            id: "streak",
            label: "Streak",
            type: "habit",
            icon: "🔥",
            desc: "Longest consecutive check-in streak"
          }];
          const TC = {
            xp: "#b4ac9e",
            strength: UI_COLORS.danger,
            reps: "#3498db",
            cardio: UI_COLORS.success,
            habit: "#e67e22",
            class: "#9b59b6"
          };
          const cls = CLASSES[profile.chosenClass] || CLASSES.warrior;
          const af = LB_FILTERS.find(f => f.id === lbFilter) || LB_FILTERS[0];
          const tc = TC[af.type] || "#b4ac9e";

          // Get the correct display name for a leaderboard row based on name visibility
          const getRowName = row => {
            const nv = row.name_visibility || {
              displayName: ["app", "game"],
              realName: ["hide"]
            };
            // Leaderboard = "game" context
            if ((nv.realName || []).includes("game")) {
              const rn = ((row.first_name || "") + " " + (row.last_name || "")).trim();
              if (rn) return rn;
            }
            return row.player_name || "Unknown";
          };
          const getRowVal = (row, filterId) => {
            if (filterId === "overall_xp") return row.total_xp || 0;
            if (filterId === "streak") return row.streak || 0;
            const pbs = row.exercise_pbs || {};
            if (filterId === "bench_1rm") return (pbs["bench"] || pbs["bench_press"] || {}).weight || 0;
            if (filterId === "squat_1rm") return (pbs["squat"] || pbs["barbell_back_squat"] || {}).weight || 0;
            if (filterId === "deadlift_1rm") return (pbs["deadlift"] || pbs["barbell_deadlift"] || {}).weight || 0;
            if (filterId === "ohp_1rm") return (pbs["overhead_press"] || pbs["ohp"] || {}).weight || 0;
            if (filterId === "pullup_reps") return (pbs["pull_up"] || pbs["pullups"] || {}).reps || 0;
            if (filterId === "pushup_reps") return (pbs["push_up"] || pbs["pushups"] || {}).reps || 0;
            if (filterId === "run_pace") return (pbs["running"] || pbs["treadmill_run"] || pbs["run"] || {}).value || 0;
            return 0;
          };
          const fmtVal = (id, v) => {
            if (!v) return "---";
            if (id === "overall_xp" || id === "weekly_xp") return formatXP(v);
            if (id.includes("_1rm")) return v + " lbs";
            if (id.includes("_reps")) return v + " reps";
            if (id === "run_pace") return v.toFixed(2) + "/mi";
            if (id === "streak") return v + " days";
            return String(v);
          };

          // Sort lbData by the active filter
          const sorted = (lbData || []).slice().sort((a, b) => {
            const av = getRowVal(a, lbFilter);
            const bv = getRowVal(b, lbFilter);
            if (lbFilter === "run_pace") return (av || 999) - (bv || 999); // lower is better
            return bv - av;
          }).filter(r => getRowVal(r, lbFilter) > 0 || lbFilter === "overall_xp");
          const myRow = sorted.find(r => r.is_me);
          const myRank = myRow ? sorted.indexOf(myRow) + 1 : null;
          const myVal = myRow ? getRowVal(myRow, lbFilter) : 0;
          const ALL_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];
          const ALL_COUNTRIES = ["United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Mexico", "Brazil", "India", "Japan", "South Korea", "Philippines", "Other"];

          // Compact filter chip with dark overlay dropdown
          const MultiDrop = ({
            label,
            icon,
            open,
            setOpen,
            options,
            selected,
            setSelected,
            allLabel
          }) => {
            if (options.length === 0) return null;
            const allSelected = selected.length === options.length;
            const noneSelected = selected.length === 0;
            const chipLabel = allSelected ? allLabel || "All" : noneSelected ? label : selected.length <= 2 ? selected.join(", ") : selected.length + " selected";
            return <div style={{
              position: "relative",
              flex: 1
            }}>
              // Trigger chip
              <div style={{
                background: open ? "rgba(45,42,36,.45)" : "rgba(45,42,36,.2)",
                border: "1px solid " + (open ? "rgba(180,172,158,.12)" : "rgba(180,172,158,.06)"),
                borderRadius: R.lg,
                padding: "8px 10px",
                fontSize: FS.sm,
                fontWeight: 600,
                color: noneSelected ? "#8a8478" : "#b4ac9e",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: S.s6,
                transition: "all .15s",
                userSelect: "none"
              }} onClick={() => {
                setOpen(!open);
                if (!open) {
                  setLbStateDropOpen(false);
                  setLbCountryDropOpen(false);
                  setOpen(true);
                }
              }}><span style={{
                  fontSize: FS.md
                }}>{icon || "\uD83D\uDD0D"}</span><span style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>{chipLabel}</span><span style={{
                  fontSize: FS.fs46,
                  color: "#8a8478",
                  flexShrink: 0
                }}>{open ? "\u25B2" : "\u25BC"}</span></div>{
              // Dropdown overlay
              open && <div style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 60,
                background: "#16160f",
                border: "1px solid rgba(180,172,158,.1)",
                borderRadius: R.r10,
                boxShadow: "0 8px 32px rgba(0,0,0,.6)",
                overflow: "hidden"
              }}>
                // Select All / Clear All header
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderBottom: "1px solid rgba(180,172,158,.06)",
                  background: "rgba(45,42,36,.15)"
                }}><span style={{
                    fontSize: FS.fs56,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    fontWeight: 600
                  }} onClick={() => setSelected([...options])}>{"Select All"}</span><span style={{
                    fontSize: FS.fs56,
                    color: UI_COLORS.danger,
                    cursor: "pointer",
                    fontWeight: 600
                  }} onClick={() => setSelected([])}>{"Clear All"}</span></div>
                // Scrollable options
                <div style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  padding: "4px 4px",
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(180,172,158,.15) transparent"
                }}>{options.map(opt => {
                    const on = selected.includes(opt);
                    return <div key={opt} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s8,
                      padding: "6px 8px",
                      cursor: "pointer",
                      borderRadius: R.r5,
                      background: on ? "rgba(180,172,158,.07)" : "transparent",
                      transition: "background .1s",
                      fontSize: FS.fs62,
                      color: on ? "#d4cec4" : "#8a8478"
                    }} onClick={() => {
                      setSelected(on ? selected.filter(s => s !== opt) : [...selected, opt]);
                    }}><span style={{
                        width: 15,
                        height: 15,
                        borderRadius: R.r3,
                        border: "1.5px solid " + (on ? "#b4ac9e" : "rgba(180,172,158,.12)"),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: FS.fs52,
                        color: "#b4ac9e",
                        flexShrink: 0,
                        background: on ? "rgba(180,172,158,.08)" : "transparent"
                      }}>{on ? "\u2713" : ""}</span>{opt}</div>;
                  })}</div>
                // Done button
                <div style={{
                  padding: "6px 10px",
                  borderTop: "1px solid rgba(180,172,158,.06)",
                  background: "rgba(45,42,36,.1)"
                }}><div style={{
                    textAlign: "center",
                    fontSize: FS.fs58,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    fontWeight: 600,
                    padding: "4px 0"
                  }} onClick={() => setOpen(false)}>{"\u2713 Done (" + selected.length + ")"}</div></div></div>}</div>;
          };
          return <div> {
              /* Header */
            }
            <div className={"techniques-header"}><div className={"tech-hdr-left"}><div className={"tech-ornament-line tech-ornament-line-l"} /><span className={"tech-hdr-title"}>{"✦ Leaderboard ✦"}</span><div className={"tech-ornament-line tech-ornament-line-r"} /></div></div> {
              /* Scope toggle: Friends / World */
            }
            <div style={{
              display: "flex",
              gap: S.s4,
              marginBottom: S.s12,
              background: "rgba(45,42,36,.25)",
              borderRadius: R.lg,
              padding: S.s4
            }}>{["friends", "world"].map(scope => <div key={scope} style={{
                flex: 1,
                textAlign: "center",
                padding: "8px 0",
                borderRadius: R.md,
                fontSize: FS.fs66,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all .15s",
                letterSpacing: ".04em",
                background: lbScope === scope ? "rgba(45,42,36,.5)" : "transparent",
                color: lbScope === scope ? "#d4cec4" : "#8a8478",
                border: lbScope === scope ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
              }} onClick={() => setLbScope(scope)}>{scope === "friends" ? "\uD83D\uDC65 Friends" : "\uD83C\uDF0D World"}</div>)}</div>{/* Filter row: State + Country multi-selects (World only) */
            lbScope === "world" && <div style={{
              display: "flex",
              gap: S.s8,
              marginBottom: S.s10
            }}><MultiDrop label={"States"} icon={"\uD83D\uDCCD"} allLabel={"All States"} open={lbStateDropOpen} setOpen={setLbStateDropOpen} options={ALL_STATES} selected={lbStateFilters} setSelected={setLbStateFilters} /><MultiDrop label={"Countries"} icon={"\uD83C\uDF0D"} allLabel={"All Countries"} open={lbCountryDropOpen} setOpen={setLbCountryDropOpen} options={ALL_COUNTRIES} selected={lbCountryFilters} setSelected={setLbCountryFilters} /></div>} {
              /* Category filter dropdown */
            }
            <div style={{
              marginBottom: S.s12,
              position: "relative"
            }}><select value={lbFilter} onChange={function (e) {
                setLbFilter(e.target.value);
              }} style={{
                width: "100%",
                appearance: "none",
                WebkitAppearance: "none",
                background: "rgba(14,14,12,.95)",
                border: "1px solid " + tc,
                color: tc,
                borderRadius: R.xl,
                padding: "8px 28px 8px 12px",
                fontSize: FS.lg,
                fontWeight: "700",
                cursor: "pointer"
              }}>{LB_FILTERS.map(function (f) {
                  var ftc = TC[f.type] || "#b4ac9e";
                  return <option key={f.id} value={f.id} style={{
                    background: "rgba(14,14,12,.95)",
                    color: ftc,
                    fontWeight: lbFilter === f.id ? "700" : "400"
                  }}>{f.icon + " " + f.label}</option>;
                })}</select><span style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: tc,
                pointerEvents: "none",
                fontSize: FS.fs65
              }}>{"▼"}</span></div> {
              /* Active filter description */
            }
            <div style={{
              fontSize: FS.sm,
              color: "#8a8478",
              marginBottom: S.s12,
              paddingLeft: 4,
              fontStyle: "italic"
            }}>{af.desc}</div>{/* Your standing card — Design 3 accent strip */
            myRow && <div style={{
              display: "flex",
              alignItems: "stretch",
              background: "linear-gradient(145deg,rgba(45,42,36,.3),rgba(32,30,26,.15))",
              border: "1px solid rgba(180,172,158,.1)",
              borderRadius: R.r12,
              marginBottom: S.s14,
              overflow: "hidden"
            }}> {
                /* Class color accent strip */
              }
              <div style={{
                width: 5,
                background: cls.color,
                flexShrink: 0,
                borderRadius: R.r0
              }} /><div style={{
                flex: 1,
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: S.s10
              }}> {
                  /* Rank + medal */
                }
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: S.s2,
                  width: 36,
                  flexShrink: 0,
                  justifyContent: "center"
                }}>{myRank <= 3 && <span style={{
                    fontSize: FS.fs82
                  }}>{myRank === 1 ? "\uD83E\uDD47" : myRank === 2 ? "\uD83E\uDD48" : "\uD83E\uDD49"}</span>}<span style={{
                    fontSize: FS.fs82,
                    fontWeight: "700",
                    color: myRank === 1 ? "#c49428" : myRank === 2 ? "#8a8478" : myRank === 3 ? "#7a5230" : "#b4ac9e"
                  }}>{myRank}</span></div> {
                  /* Name + class tag + subtitle */
                }
                <div style={{
                  flex: 1,
                  minWidth: 0
                }}><div style={{
                    fontSize: FS.fs74,
                    fontWeight: "700",
                    color: "#d4cec4",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}>{getNameForContext("game") || "You"}<span style={{
                      fontSize: FS.fs50,
                      fontWeight: 700,
                      color: cls.color,
                      marginLeft: S.s6
                    }}>{cls.icon + " " + cls.name}</span>{myPublicId && <span style={{
                      fontSize: FS.fs44,
                      color: "#8a8478",
                      marginLeft: S.s4
                    }}>{"#" + myPublicId}</span>}<span style={{
                      fontSize: FS.fs50,
                      color: "#8a8478",
                      marginLeft: S.s4
                    }}>{"you"}</span></div><div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: S.s6,
                    flexWrap: "wrap"
                  }}><span style={{
                      fontSize: FS.fs56,
                      color: "#8a8478"
                    }}>{"Lv." + xpToLevel(profile.xp || 0)}{profile.state || profile.country ? " \u00b7 " : ""}{profile.state ? profile.state : ""}{profile.country ? (profile.state ? ", " : "") + (profile.country === "United States" ? "US" : profile.country === "United Kingdom" ? "UK" : profile.country === "Canada" ? "CA" : profile.country === "Australia" ? "AU" : profile.country === "Germany" ? "DE" : profile.country === "France" ? "FR" : profile.country === "Mexico" ? "MX" : profile.country === "Brazil" ? "BR" : profile.country === "India" ? "IN" : profile.country === "Japan" ? "JP" : profile.country === "South Korea" ? "KR" : profile.country === "Philippines" ? "PH" : profile.country || "") : ""}{profile.gym ? " \u00b7 " + profile.gym : ""}{profile.checkInStreak > 0 ? " \u00b7 \uD83D\uDD25" + profile.checkInStreak : ""}</span>{lbScope === "friends" && authUser && lbWorldRanks[authUser.id] && <span style={{
                      fontSize: FS.fs46,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: R.r4,
                      background: "rgba(180,172,158,.08)",
                      color: "#8a8478"
                    }}>{"\uD83C\uDF0D #" + lbWorldRanks[authUser.id]}</span>}</div></div> {
                  /* Stat value */
                }
                <div style={{
                  textAlign: "right",
                  flexShrink: 0
                }}><div style={{
                    fontSize: "1rem",
                    fontWeight: "700",
                    color: tc
                  }}>{fmtVal(lbFilter, myVal)}</div><div style={{
                    fontSize: FS.fs50,
                    color: "#8a8478",
                    marginTop: S.s2
                  }}>{af.label}</div></div></div></div>} {
              /* Leaderboard list */
            }
            <div style={{
              background: "rgba(45,42,36,.1)",
              border: "1px solid rgba(45,42,36,.2)",
              borderRadius: R.r12,
              overflow: "hidden"
            }}> {
                /* Column header */
              }
              <div style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px 8px 18px",
                borderBottom: "1px solid rgba(180,172,158,.05)",
                background: "rgba(45,42,36,.12)"
              }}><span style={{
                  width: 36,
                  fontSize: FS.fs52,
                  color: "#8a8478",
                  textTransform: "uppercase",
                  letterSpacing: ".08em"
                }}>{"#"}</span><span style={{
                  flex: 1,
                  fontSize: FS.fs52,
                  color: "#8a8478",
                  textTransform: "uppercase",
                  letterSpacing: ".08em"
                }}>{"Player"}</span><span style={{
                  fontSize: FS.fs52,
                  color: tc,
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  fontWeight: "700"
                }}>{af.icon + " " + af.label}</span></div>{/* Loading state */
              lbLoading && <div style={{
                padding: "24px 14px",
                textAlign: "center"
              }}><div style={{
                  width: 24,
                  height: 24,
                  border: "2px solid rgba(180,172,158,.12)",
                  borderTopColor: "#b4ac9e",
                  borderRadius: "50%",
                  animation: "spin .8s linear infinite",
                  margin: "0 auto 8px"
                }} /><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}>{"Loading rankings…"}</div></div>}{/* Player rows — Design 3: accent strip + medals */
              !lbLoading && sorted.map(function (row, idx) {
                var rank = idx + 1;
                var val = getRowVal(row, lbFilter);
                var rowCls = row.chosen_class ? CLASSES[row.chosen_class] || CLASSES.warrior : CLASSES.warrior;
                var isMe = row.is_me;
                var rankColor = rank === 1 ? "#c49428" : rank === 2 ? "#8a8478" : rank === 3 ? "#7a5230" : "#8a8478";
                var medal = rank === 1 ? "\uD83E\uDD47" : rank === 2 ? "\uD83E\uDD48" : rank === 3 ? "\uD83E\uDD49" : null;
                var worldRank = lbScope === "friends" ? lbWorldRanks[row.user_id] : null;
                var countryCode = row.country === "United States" ? "US" : row.country === "United Kingdom" ? "UK" : row.country === "Canada" ? "CA" : row.country === "Australia" ? "AU" : row.country === "Germany" ? "DE" : row.country === "France" ? "FR" : row.country === "Mexico" ? "MX" : row.country === "Brazil" ? "BR" : row.country === "India" ? "IN" : row.country === "Japan" ? "JP" : row.country === "South Korea" ? "KR" : row.country === "Philippines" ? "PH" : row.country || "";
                var loc = (row.state || "") + (row.state && countryCode ? ", " : "") + countryCode;
                return <div key={row.user_id} style={{
                  display: "flex",
                  alignItems: "stretch",
                  background: isMe ? "rgba(45,42,36,.25)" : "linear-gradient(145deg,rgba(45,42,36,.18),rgba(32,30,26,.08))",
                  borderBottom: "1px solid rgba(45,42,36,.12)"
                }}> {
                    /* Class color accent strip */
                  }
                  <div style={{
                    width: 4,
                    background: rowCls.color,
                    flexShrink: 0
                  }} /> {
                    /* Inner content */
                  }
                  <div style={{
                    flex: 1,
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s8
                  }}> {
                      /* Rank + medal */
                    }
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s2,
                      width: 32,
                      flexShrink: 0,
                      justifyContent: "center"
                    }}>{medal && <span style={{
                        fontSize: FS.fs78
                      }}>{medal}</span>}<span style={{
                        fontSize: FS.lg,
                        fontWeight: "700",
                        color: rankColor,
                        fontFamily: "'Inter',sans-serif"
                      }}>{rank}</span></div> {
                      /* Name + class tag + subtitle */
                    }
                    <div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div style={{
                        fontSize: FS.lg,
                        fontWeight: "700",
                        color: isMe ? "#d4cec4" : "#b4ac9e",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>{getRowName(row)}<span style={{
                          fontSize: FS.fs48,
                          fontWeight: 700,
                          color: rowCls.color,
                          marginLeft: S.s6
                        }}>{rowCls.icon + " " + rowCls.name}</span>{row.public_id && <span style={{
                          fontSize: FS.fs44,
                          color: "#8a8478",
                          marginLeft: S.s4
                        }}>{"#" + row.public_id}</span>}{isMe && <span style={{
                          fontSize: FS.fs48,
                          color: "#8a8478",
                          marginLeft: S.s4
                        }}>{"you"}</span>}</div><div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: S.s6,
                        flexWrap: "wrap"
                      }}><span style={{
                          fontSize: FS.fs52,
                          color: "#8a8478"
                        }}>{"Lv." + row.level}{loc ? " \u00b7 " + loc : ""}{row.gym ? " \u00b7 " + row.gym : ""}{row.streak > 0 ? " \u00b7 \uD83D\uDD25" + row.streak : ""}</span>{worldRank && <span style={{
                          fontSize: FS.fs46,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: R.r4,
                          background: "rgba(180,172,158,.08)",
                          color: "#8a8478"
                        }}>{"\uD83C\uDF0D #" + worldRank}</span>}</div></div> {
                      /* Stat value */
                    }
                    <div style={{
                      textAlign: "right",
                      flexShrink: 0,
                      paddingLeft: 6
                    }}><div style={{
                        fontSize: FS.fs78,
                        fontWeight: "700",
                        color: val ? tc : "#8a8478",
                        fontFamily: "'Inter',sans-serif"
                      }}>{fmtVal(lbFilter, val)}</div><div style={{
                        fontSize: FS.fs44,
                        color: "#8a8478",
                        marginTop: S.s2
                      }}>{af.label}</div></div></div></div>;
              })}{/* Empty state */
              !lbLoading && sorted.length === 0 && <div style={{
                padding: "24px 14px",
                textAlign: "center",
                fontSize: FS.fs66,
                color: "#8a8478",
                fontStyle: "italic"
              }}>{lbScope === "friends" ? "No friends to rank yet. Add friends in the Guild tab!" : "No warriors found matching your filters."}</div>}{/* Player count footer */
              !lbLoading && sorted.length > 0 && <div style={{
                padding: "8px 14px",
                textAlign: "center",
                fontSize: FS.fs56,
                color: "#8a8478",
                fontStyle: "italic",
                borderTop: "1px solid rgba(45,42,36,.12)"
              }}>{sorted.length + " warrior" + (sorted.length !== 1 ? "s" : "") + " ranked" + (lbStateFilters.length || lbCountryFilters.length ? " (filtered)" : "")}</div>}</div></div>;
        })()
        /* ── QUESTS TAB ──────────────────────── */}{activeTab === "quests" && <><div className={"rpg-sec-header"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Deeds & Quests ✦"}</span><div className={"rpg-sec-line rpg-sec-line-r"} /></div>
          {
            /* Category filter */
          }<div className={"quest-cats"}>{["All", "Cardio", "Strength", "Flexibility", "Consistency", "Competition"].map(cat => <div key={cat} className={`quest-cat-btn ${questCat === cat ? "on" : ""}`} onClick={() => setQuestCat(cat)}>{cat}</div>)}</div>

          {
            /* Pending claims first */
          }{QUESTS.filter(q => {
            const qs = _optionalChain([profile, 'access', _124 => _124.quests, 'optionalAccess', _125 => _125[q.id]]);
            return _optionalChain([qs, 'optionalAccess', _126 => _126.completed]) && !_optionalChain([qs, 'optionalAccess', _127 => _127.claimed]) && (questCat === "All" || q.cat === questCat);
          }).map(q => {
            const qs = _optionalChain([profile, 'access', _128 => _128.quests, 'optionalAccess', _129 => _129[q.id]]) || {};
            return <div key={q.id} className={"quest-card complete"}><div className={"quest-top"}><div className={"quest-icon-wrap"}>{q.icon}</div><div style={{
                  flex: 1
                }}><div className={"quest-name"}>{q.name}</div><div className={"quest-desc"}>{q.desc}</div><div className={"quest-reward"}>{formatXP(q.xp, {
                      signed: true,
                      prefix: "⚡ "
                    })}{" reward"}</div></div><button className={"btn btn-gold btn-sm"} onClick={() => claimQuestReward(q.id)}>{"Claim!"}</button></div></div>;
          })

          /* All quests */}{QUESTS.filter(q => questCat === "All" || q.cat === questCat).map(q => {
            const qs = _optionalChain([profile, 'access', _130 => _130.quests, 'optionalAccess', _131 => _131[q.id]]) || {};
            if (qs.completed && !qs.claimed) return null; // shown above
            const isClaimed = qs.claimed;
            const isDone = qs.completed;
            // Progress for auto quests
            let progressText = null;
            if (!isDone && _optionalChain([q, 'access', _132 => _132.auto, 'optionalAccess', _133 => _133.exId])) {
              const cnt = profile.log.filter(e => _optionalChain([EXERCISES, 'access', _134 => _134.find, 'call', _135 => _135(ex => ex.name === e.exercise), 'optionalAccess', _136 => _136.id]) === q.auto.exId).length;
              progressText = `${cnt} / ${q.auto.count}`;
            }
            if (!isDone && _optionalChain([q, 'access', _137 => _137.auto, 'optionalAccess', _138 => _138.total])) {
              progressText = `${profile.log.length} / ${q.auto.total} sessions`;
            }
            if (!isDone && q.streak) {
              progressText = `${profile.checkInStreak} / ${q.streak} day streak`;
            }
            return <div key={q.id} className={`quest-card ${isDone ? "complete" : ""} ${isClaimed ? "claimed" : ""}`}><div className={"quest-top"}><div className={"quest-icon-wrap"}>{q.icon}</div><div style={{
                  flex: 1
                }}><div className={"quest-name"}>{q.name}</div><div className={"quest-desc"}>{q.desc}</div>{progressText && !isDone && <div style={{
                    fontSize: FS.fs65,
                    color: "#8a8478",
                    marginTop: S.s4
                  }}>{"Progress: "}{progressText}</div>}<div className={"quest-reward"}>{isClaimed ? "✓ Claimed " + formatXP(q.xp) : formatXP(q.xp, {
                      signed: true,
                      prefix: "⚡ "
                    })}</div></div><div className={"quest-status"}>{isClaimed ? <div className={"quest-check claimed-check"}>{"✓"}</div> : isDone ? <div className={"quest-check done"}>{"!"}</div> : q.manual ? <button className={"btn btn-ghost btn-xs"} onClick={() => claimManualQuest(q.id)}>{"Done?"}</button> : <div className={"quest-check"}>{"○"}</div>}</div></div></div>;
          })}</>

        /* ── HISTORY TAB ─────────────────────── */}{activeTab === "history" && (() => {
          const metric = isMetric(profile.units);
          // Attach real array index to each entry so edits/deletes are index-stable
          const logWithIdx = profile.log.map((e, i) => ({
            ...e,
            _idx: i
          }));

          // ── helper: single exercise row ──────────────────────────────
          function EntryRow({
            e,
            showSource = false,
            isSuperset = false
          }) {
            const exData = allExById[e.exId];
            const isC = exData ? exData.category === "cardio" : false;
            const isF = exData ? exData.category === "flexibility" : false;
            const exMgColor = getMuscleColor(exData && exData.muscleGroup);
            return <div className={"h-entry"} style={{
              "--mg-color": exMgColor
            }}><div className={"h-entry-hdr"}><span className={"h-icon"}>{e.icon}</span><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"h-name"}>{e.exercise}{isSuperset && <span style={{
                    marginLeft: S.s6,
                    fontSize: FS.fs48,
                    color: "#b4ac9e",
                    background: "rgba(180,172,158,.1)",
                    padding: "2px 6px",
                    borderRadius: R.r3,
                    fontWeight: 600,
                    verticalAlign: "middle"
                  }}>{"Superset"}</span>}{showSource && e.sourcePlanName && <span className={"log-source-badge plan"}>{"📋 "}{e.sourcePlanName}</span>}{showSource && e.sourceWorkoutName && e.sourceWorkoutType !== "oneoff" && <span className={"log-source-badge workout"}>{"💪 "}{e.sourceWorkoutName}</span>}{e.sourceWorkoutType === "oneoff" && e.sourceWorkoutName && <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: S.s4,
                    fontSize: FS.fs56,
                    padding: "2px 6px",
                    borderRadius: R.r4,
                    marginLeft: S.s6,
                    background: "rgba(230,126,34,.12)",
                    color: "#e67e22",
                    border: "1px solid rgba(230,126,34,.3)",
                    verticalAlign: "middle"
                  }}>{"⚡ "}{e.sourceWorkoutName}</span>}</div></div><div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s6,
                flexShrink: 0
              }}><div className={"h-xp"}>{"+"}{e.xp}{" XP"}</div><button className={"btn btn-ghost btn-xs"} title={"Edit entry"} onClick={() => openLogEdit(e._idx)}>{"✎"}</button><button className={"btn btn-danger btn-xs"} title={"Delete entry"} style={{
                  padding: "2px 6px"
                }} onClick={() => deleteLogEntryByIdx(e._idx)}>{"✕"}</button></div></div><div className={"h-entry-body"}><div className={"h-meta"}>{e.sets}{"×"}{e.reps}{isC || isF ? " min" : ""}{e.distanceMi ? <span style={{
                    color: UI_COLORS.accent,
                    marginLeft: S.s6
                  }}>{metric ? miToKm(e.distanceMi) + " km" : e.distanceMi + " mi"}</span> : ""}{e.weightLbs ? <span style={{
                    color: "#8a8478",
                    marginLeft: S.s6
                  }}>{metric ? lbsToKg(e.weightLbs) + " kg" : e.weightLbs + " lbs"}{e.weightPct && e.weightPct !== 100 ? <span style={{
                      color: "#e67e22"
                    }}>{" @"}{e.weightPct}{"%"}</span> : ""}</span> : ""}{e.hrZone ? <span style={{
                    marginLeft: S.s6,
                    color: _optionalChain([HR_ZONES, 'access', _139 => _139[e.hrZone - 1], 'optionalAccess', _140 => _140.color])
                  }}>{"Z"}{e.hrZone}</span> : ""}<span style={{
                    marginLeft: S.s6,
                    color: "#8a8478"
                  }}>{e.time}{" · "}{e.date}</span></div></div></div>;
          }

          // ── EXERCISES sub-tab ────────────────────────────────────────
          function ExercisesTab() {
            const groups = {};
            logWithIdx.forEach(e => {
              const dk = e.dateKey || e.date || "Unknown";
              if (!groups[dk]) groups[dk] = [];
              groups[dk].push(e);
            });
            const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
            return <>{logWithIdx.length === 0 && <div className={"empty"}>{"No battles logged yet."}<br />{"Begin your training."}</div>}{sortedKeys.map(dk => {
                const entries = groups[dk];
                const groupXP = entries.reduce((s, e) => s + e.xp, 0);
                const displayDate = _optionalChain([entries, 'access', _141 => _141[0], 'optionalAccess', _142 => _142.date]) || dk;
                const collapsed = !openLogGroups["ex_" + dk]; // default collapsed
                // Dominant muscle-group color = first valid entry's muscle group
                const grpFirstEx = entries.map(en => allExById[en.exId]).find(Boolean);
                const grpMgColor = getMuscleColor(grpFirstEx && grpFirstEx.muscleGroup);
                return <div key={dk} className={"log-group-card"} style={{
                  "--mg-color": grpMgColor
                }}><div className={`log-group-hdr ${collapsed ? "collapsed" : ""}`} onClick={() => toggleLogGroup("ex_" + dk)}><span className={"log-group-icon"}>{"📅"}</span><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div className={"log-group-name"}>{displayDate}</div><div className={"log-group-meta"}>{entries.length}{" exercise"}{entries.length !== 1 ? "s" : ""}{" · "}{formatXP(groupXP, {
                          prefix: "⚡ "
                        })}</div></div>{!collapsed && <div style={{
                      display: "flex",
                      gap: S.s6,
                      marginRight: S.s6
                    }} onClick={e => e.stopPropagation()}><button className={"btn btn-ghost btn-xs"} style={{
                        fontSize: FS.fs55,
                        whiteSpace: "nowrap"
                      }} onClick={() => openSaveWorkoutWizard(entries, displayDate)}>{"💪 Save"}</button><button className={"btn btn-ghost btn-xs"} style={{
                        fontSize: FS.fs55,
                        whiteSpace: "nowrap"
                      }} onClick={() => openSavePlanWizard(entries, displayDate)}>{"📋 Plan"}</button></div>}<svg width={"13"} height={"13"} viewBox={"0 0 14 14"} fill={"none"} xmlns={"http://www.w3.org/2000/svg"} style={{
                      flexShrink: 0,
                      transition: "transform .22s ease",
                      transform: collapsed ? "rotate(0deg)" : "rotate(180deg)"
                    }}><defs><linearGradient id={"cg5e"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cg5e)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></div>{!collapsed && <div className={"log-group-body"}>{entries.map((e, i) => <EntryRow key={i} e={e} showSource={true} />)}</div>}</div>;
              })}</>;
          }

          // ── WORKOUTS sub-tab ─────────────────────────────────────────
          function WorkoutsTab() {
            const grouped = {};
            logWithIdx.forEach(e => {
              if (!e.sourceWorkoutId) return;
              const gid = e.sourceGroupId || e.sourceWorkoutId;
              if (!grouped[gid]) grouped[gid] = [];
              grouped[gid].push(e);
            });
            const sortedGroups = Object.values(grouped).sort((a, b) => {
              const da = _optionalChain([a, 'access', _143 => _143[0], 'optionalAccess', _144 => _144.dateKey]) || "";
              const db = _optionalChain([b, 'access', _145 => _145[0], 'optionalAccess', _146 => _146.dateKey]) || "";
              return db.localeCompare(da);
            });
            const reusableGroups = sortedGroups.filter(g => _optionalChain([g, 'access', _147 => _147[0], 'optionalAccess', _148 => _148.sourceWorkoutType]) !== "oneoff");
            const oneoffGroups = sortedGroups.filter(g => _optionalChain([g, 'access', _149 => _149[0], 'optionalAccess', _150 => _150.sourceWorkoutType]) === "oneoff");
            function GroupCard({
              entries,
              gi
            }) {
              const first = entries[0];
              const groupXP = entries.reduce((s, e) => s + e.xp, 0);
              const gid = first.sourceGroupId || first.sourceWorkoutId || String(gi);
              const collapsed = !openLogGroups[gid];
              const isOneOff = first.sourceWorkoutType === "oneoff";
              const grpFirstEx = entries.map(en => allExById[en.exId]).find(Boolean);
              const grpMgColor = getMuscleColor(grpFirstEx && grpFirstEx.muscleGroup);
              return <div className={"log-group-card"} style={{
                "--mg-color": grpMgColor
              }}><div className={`log-group-hdr ${collapsed ? "collapsed" : ""}`} onClick={() => toggleLogGroup(gid)}><span className={"log-group-icon"}>{first.sourceWorkoutIcon || "💪"}</span><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div className={"log-group-name"}>{first.sourceWorkoutName}{isOneOff && <span style={{
                        marginLeft: S.s6,
                        fontSize: FS.fs55,
                        background: "rgba(230,126,34,.15)",
                        color: "#e67e22",
                        border: "1px solid rgba(230,126,34,.3)",
                        borderRadius: R.r4,
                        padding: "2px 6px",
                        verticalAlign: "middle"
                      }}>{"one-off"}</span>}</div><div className={"log-group-meta"}>{"📅 "}{first.date}{" · "}{entries.length}{" exercise"}{entries.length !== 1 ? "s" : ""}</div></div><div className={"log-group-xp"}>{formatXP(groupXP, {
                      prefix: "⚡ "
                    })}</div><button className={"btn btn-ghost btn-xs"} style={{
                    fontSize: FS.sm,
                    marginRight: S.s2,
                    flexShrink: 0
                  }} title={"Edit completed workout"} onClick={e => {
                    e.stopPropagation();
                    setRetroEditModal({
                      groupId: gid,
                      entries: [...entries],
                      dateKey: first.dateKey,
                      sourceType: isOneOff ? "oneoff" : "reusable",
                      sourceName: first.sourceWorkoutName,
                      sourceIcon: first.sourceWorkoutIcon || "💪",
                      sourceId: first.sourceWorkoutId
                    });
                  }}>{"✎"}</button><button className={"btn btn-ghost btn-xs"} style={{
                    fontSize: FS.sm,
                    marginRight: S.s2,
                    flexShrink: 0,
                    color: UI_COLORS.danger
                  }} title={"Delete all entries"} onClick={e => {
                    e.stopPropagation();
                    const totalXP = entries.reduce((s, en) => s + en.xp, 0);
                    setConfirmDelete({
                      icon: first.sourceWorkoutIcon || "💪",
                      title: "Delete workout session?",
                      body: `Delete entire "${first.sourceWorkoutName}" session — ${entries.length} exercises, ${formatXP(-totalXP, {
                        signed: true
                      })}. This cannot be undone.`,
                      confirmLabel: "🗑 Delete session",
                      onConfirm: () => {
                        const idxSet = new Set(entries.map(en => en._idx));
                        const deletedEntries = entries.map(en => ({
                          id: uid(),
                          type: "logEntry",
                          item: {
                            ...en
                          },
                          deletedAt: new Date().toISOString()
                        }));
                        const newLog = profile.log.filter((_, i) => !idxSet.has(i));
                        setProfile(p => ({
                          ...p,
                          xp: Math.max(0, p.xp - totalXP),
                          log: newLog,
                          exercisePBs: calcExercisePBs(newLog),
                          deletedItems: [...(p.deletedItems || []), ...deletedEntries]
                        }));
                        showToast("Workout session deleted. " + formatXP(-totalXP, {
                          signed: true
                        }));
                      }
                    });
                  }}>{"🗑"}</button><svg width={"13"} height={"13"} viewBox={"0 0 14 14"} fill={"none"} style={{
                    flexShrink: 0,
                    transition: "transform .22s ease",
                    transform: collapsed ? "rotate(0deg)" : "rotate(180deg)"
                  }}><defs><linearGradient id={"cg5"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cg5)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></div>{!collapsed && <div className={"log-group-body"}>{(() => {
                    /* Detect supersets from source workout */
                    const srcWo = (profile.workouts || []).find(w => w.id === first.sourceWorkoutId);
                    const srcPlan = !srcWo && (profile.plans || []).find(p => p.id === first.sourcePlanId);
                    const srcExs = srcWo ? srcWo.exercises : srcPlan ? (srcPlan.days || []).flatMap(d => d.exercises) : [];
                    const ssSet = new Set();
                    srcExs.forEach((ex, i) => {
                      if (ex.supersetWith != null) {
                        ssSet.add(ex.exId);
                        const partner = srcExs[ex.supersetWith];
                        if (partner) ssSet.add(partner.exId);
                      }
                    });
                    return entries.map((e, i) => <EntryRow key={i} e={e} showSource={false} isSuperset={ssSet.has(e.exId)} />);
                  })()}</div>}</div>;
            }
            if (sortedGroups.length === 0) return <div className={"empty"}>{"No workout completions logged yet."}<br />{"Complete a workout to see it here."}</div>;
            return <>{reusableGroups.length > 0 && <><div className={"sec"} style={{
                  marginBottom: S.s8
                }}>{"💪 Re-Usable Workouts"}</div>{reusableGroups.map((entries, gi) => <GroupCard key={gi} entries={entries} gi={gi} />)}</>}{oneoffGroups.length > 0 && <><div className={"sec"} style={{
                  marginBottom: S.s8,
                  marginTop: reusableGroups.length > 0 ? 12 : 0
                }}>{"⚡ One-Off Workouts"}</div>{oneoffGroups.map((entries, gi) => <GroupCard key={gi} entries={entries} gi={gi} />)}</>}</>;
          }

          // ── PLANS sub-tab ────────────────────────────────────────────
          function PlansTab() {
            // Only include entries that belong to a plan
            const grouped = {};
            logWithIdx.forEach(e => {
              if (!e.sourcePlanId) return; // exclude standalone — they belong in Exercises tab
              const gid = e.sourceGroupId || e.sourcePlanId;
              if (!grouped[gid]) grouped[gid] = [];
              grouped[gid].push(e);
            });
            const sortedGroups = Object.values(grouped).sort((a, b) => {
              const da = _optionalChain([a, 'access', _151 => _151[0], 'optionalAccess', _152 => _152.dateKey]) || "";
              const db = _optionalChain([b, 'access', _153 => _153[0], 'optionalAccess', _154 => _154.dateKey]) || "";
              return db.localeCompare(da);
            });
            if (sortedGroups.length === 0) return <div className={"empty"}>{"No plan completions logged yet."}<br />{"Complete a plan to see it here."}</div>;
            return <>{sortedGroups.map((entries, gi) => {
                const first = entries[0];
                const groupXP = entries.reduce((s, e) => s + e.xp, 0);
                const gid = first.sourceGroupId || first.sourcePlanId || String(gi);
                const collapsed = !openLogGroups[gid]; // default collapsed, open when toggled
                const grpFirstEx = entries.map(en => allExById[en.exId]).find(Boolean);
                const grpMgColor = getMuscleColor(grpFirstEx && grpFirstEx.muscleGroup);
                return <div key={gid} className={"log-group-card"} style={{
                  "--mg-color": grpMgColor
                }}><div className={`log-group-hdr ${collapsed ? "collapsed" : ""}`} onClick={() => toggleLogGroup(gid)}><span className={"log-group-icon"}>{first.sourcePlanIcon || "📋"}</span><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div className={"log-group-name"}>{first.sourcePlanName}</div><div className={"log-group-meta"}>{"📅 "}{first.date}{" · "}{entries.length}{" exercise"}{entries.length !== 1 ? "s" : ""}</div></div><div className={"log-group-xp"}>{formatXP(groupXP, {
                        prefix: "⚡ "
                      })}</div><button className={"btn btn-ghost btn-xs"} style={{
                      fontSize: FS.sm,
                      marginRight: S.s2,
                      flexShrink: 0
                    }} title={"Edit completed plan"} onClick={e => {
                      e.stopPropagation();
                      setRetroEditModal({
                        groupId: gid,
                        entries: [...entries],
                        dateKey: first.dateKey,
                        sourceType: "plan",
                        sourceName: first.sourcePlanName,
                        sourceIcon: first.sourcePlanIcon || "📋",
                        sourceId: first.sourcePlanId
                      });
                    }}>{"✎"}</button><button className={"btn btn-ghost btn-xs"} style={{
                      fontSize: FS.sm,
                      marginRight: S.s2,
                      flexShrink: 0,
                      color: UI_COLORS.danger
                    }} title={"Delete all entries"} onClick={e => {
                      e.stopPropagation();
                      const totalXP = entries.reduce((s, en) => s + en.xp, 0);
                      setConfirmDelete({
                        icon: first.sourcePlanIcon || "📋",
                        title: "Delete plan session?",
                        body: `Delete entire "${first.sourcePlanName}" session — ${entries.length} exercises, ${formatXP(-totalXP, {
                          signed: true
                        })}. This cannot be undone.`,
                        confirmLabel: "🗑 Delete session",
                        onConfirm: () => {
                          const idxSet = new Set(entries.map(en => en._idx));
                          const deletedEntries = entries.map(en => ({
                            id: uid(),
                            type: "logEntry",
                            item: {
                              ...en
                            },
                            deletedAt: new Date().toISOString()
                          }));
                          const newLog = profile.log.filter((_, i) => !idxSet.has(i));
                          setProfile(p => ({
                            ...p,
                            xp: Math.max(0, p.xp - totalXP),
                            log: newLog,
                            exercisePBs: calcExercisePBs(newLog),
                            deletedItems: [...(p.deletedItems || []), ...deletedEntries]
                          }));
                          showToast("Plan session deleted. " + formatXP(-totalXP, {
                            signed: true
                          }));
                        }
                      });
                    }}>{"🗑"}</button><svg width={"13"} height={"13"} viewBox={"0 0 14 14"} fill={"none"} xmlns={"http://www.w3.org/2000/svg"} style={{
                      flexShrink: 0,
                      transition: "transform .22s ease",
                      transform: collapsed ? "rotate(0deg)" : "rotate(180deg)"
                    }}><defs><linearGradient id={"cg5"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cg5)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></div>{!collapsed && <div className={"log-group-body"}>{entries.map((e, i) => <EntryRow key={i} e={e} showSource={false} />)}</div>}</div>;
              })}</>;
          }
          return <><div className={"sec"}>{"Battle Record — "}{profile.log.length}{" sessions · "}{formatXP(profile.xp)}{" total"}</div><div className={"log-subtab-bar"}>{[["exercises", "⚔️ Exercises"], ["workouts", "💪 Workouts"], ["plans", "📋 Plans"], ["trends", "📊 Trends"], ["deleted", "🗑 Deleted"]].map(([t, l]) => <button key={t} className={`log-subtab-btn ${logSubTab === t ? "on" : ""}`} onClick={() => setLogSubTab(t)}>{l}{t === "deleted" && (profile.deletedItems || []).filter(d => (new Date() - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24) < 7).length > 0 && <span style={{
                  marginLeft: S.s4,
                  background: "#8a8478",
                  color: "#fff",
                  borderRadius: "50%",
                  width: 14,
                  height: 14,
                  fontSize: FS.fs45,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>{(profile.deletedItems || []).filter(d => (new Date() - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24) < 7).length}</span>}</button>)}</div>{logSubTab === "exercises" && <ExercisesTab />}{logSubTab === "workouts" && <WorkoutsTab />}{logSubTab === "plans" && <PlansTab />}{logSubTab === "trends" && lazyMount(<TrendsTab log={profile.log} allExById={allExById} clsColor={cls.color} units={profile.units} chartOrder={profile.chartOrder || DEFAULT_CHART_ORDER} onChartOrderChange={order => setProfile(p => ({
              ...p,
              chartOrder: order
            }))} workouts={profile.workouts} plans={profile.plans} />)}{logSubTab === "deleted" && (() => {
              const now = new Date();
              const active = (profile.deletedItems || []).filter(d => (now - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24) < 7).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
              const daysLeft = d => Math.max(0, 7 - Math.floor((now - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24)));
              function restoreItem(entry) {
                const newBin = (profile.deletedItems || []).filter(d => d.id !== entry.id);
                if (entry.type === "workout") {
                  setProfile(p => ({
                    ...p,
                    workouts: [...(p.workouts || []), entry.item],
                    deletedItems: newBin
                  }));
                  showToast(`\uD83D\uDCAA "${entry.item.name}" restored to Workouts!`);
                } else if (entry.type === "logEntry") {
                  const restored = entry.item;
                  setProfile(p => ({
                    ...p,
                    xp: (p.xp || 0) + (restored.xp || 0),
                    log: [...p.log, restored],
                    deletedItems: newBin,
                    exercisePBs: calcExercisePBs([...p.log, restored])
                  }));
                  showToast(`\u2694\uFE0F "${restored.exercise}" restored! +${restored.xp} XP`);
                } else {
                  setProfile(p => ({
                    ...p,
                    plans: [...(p.plans || []), entry.item],
                    deletedItems: newBin
                  }));
                  showToast(`\uD83D\uDCCB "${entry.item.name}" restored to Plans!`);
                }
              }
              function permanentDelete(entry) {
                setProfile(p => ({
                  ...p,
                  deletedItems: (p.deletedItems || []).filter(d => d.id !== entry.id)
                }));
                showToast("Permanently deleted.");
              }
              return <div><div style={{
                  fontSize: FS.fs65,
                  color: "#8a8478",
                  marginBottom: S.s12,
                  lineHeight: 1.5
                }}>{"Deleted items are kept for "}<strong style={{
                    color: "#d4cec4"
                  }}>{"7 days"}</strong>{" before being permanently removed. Tap Restore to recover them."}</div>{active.length === 0 && <div className={"empty"}>{"No recently deleted items."}<br />{"Deleted exercises, workouts and plans will appear here."}</div>}{active.map(entry => {
                  const dl = daysLeft(entry);
                  const urgentColor = dl <= 1 ? UI_COLORS.danger : dl <= 2 ? "#e67e22" : "#8a8478";
                  const itemName = entry.type === "logEntry" ? entry.item.exercise || "Exercise" : entry.item.name || "Item";
                  const itemIcon = entry.type === "logEntry" ? entry.item.icon || "\u2694\uFE0F" : entry.item.icon || "\uD83D\uDCE6";
                  const typeLabel = entry.type === "logEntry" ? "exercise" : entry.type;
                  const xpNote = entry.type === "logEntry" && entry.item.xp ? " \u00b7 " + entry.item.xp + " XP" : "";
                  return <div key={entry.id} style={{
                    background: "rgba(45,42,36,.12)",
                    border: "1px solid rgba(45,42,36,.2)",
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    marginBottom: S.s8,
                    display: "flex",
                    alignItems: "center",
                    gap: S.s10
                  }}><div style={{
                      fontSize: "1.2rem",
                      flexShrink: 0
                    }}>{itemIcon}</div><div style={{
                      flex: 1,
                      minWidth: 0
                    }}><div style={{
                        fontSize: FS.fs78,
                        color: "#d4cec4",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>{itemName}</div><div style={{
                        fontSize: FS.sm,
                        marginTop: S.s2,
                        display: "flex",
                        gap: S.s8
                      }}><span style={{
                          color: "#8a8478",
                          textTransform: "capitalize"
                        }}>{typeLabel}{xpNote}</span><span style={{
                          color: urgentColor
                        }}>{dl === 0 ? "Expires today" : dl === 1 ? "1 day left" : `${dl} days left`}</span></div></div><button className={"btn btn-gold btn-xs"} style={{
                      flexShrink: 0,
                      fontSize: FS.fs65
                    }} onClick={() => restoreItem(entry)}>{"↩ Restore"}</button><button className={"btn btn-ghost btn-xs"} style={{
                      flexShrink: 0,
                      fontSize: FS.sm,
                      color: UI_COLORS.danger,
                      borderColor: "rgba(231,76,60,.25)"
                    }} onClick={() => permanentDelete(entry)}>{"✕"}</button></div>;
                })}</div>;
            })()}</>;
        })()}{activeTab === "social" && (() => {
          const levelFor = xp => {
            const t = buildXPTable(100);
            let lv = 1;
            for (let i = 1; i < t.length; i++) {
              if (xp >= t[i]) lv = i + 1;else break;
            }
            return lv;
          };
          return <div><div className={"rpg-sec-header"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Guild Search ✦"}</span><div className={"rpg-sec-line rpg-sec-line-r"} /></div>{socialMsg && <div style={{
              fontSize: FS.fs75,
              color: socialMsg.ok === true ? UI_COLORS.success : socialMsg.ok === false ? UI_COLORS.danger : "#b4ac9e",
              marginBottom: S.s10,
              padding: "8px 12px",
              background: socialMsg.ok === true ? "rgba(46,204,113,.06)" : socialMsg.ok === false ? "rgba(231,76,60,.06)" : "rgba(45,42,36,.16)",
              border: `1px solid ${socialMsg.ok === true ? "rgba(46,204,113,.2)" : socialMsg.ok === false ? "rgba(231,76,60,.2)" : "rgba(45,42,36,.3)"}`,
              borderRadius: R.lg,
              textAlign: "center"
            }}>{socialMsg.text}</div>}<div style={{
              display: "flex",
              gap: S.s8,
              marginBottom: S.s8
            }}><input className={"inp"} style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: FS.fs82
              }} placeholder={"Email or Account ID (#A7XK9M)\u2026"} value={friendSearch} onChange={e => {
                setFriendSearch(e.target.value);
                setFriendSearchResult(null);
                setSocialMsg(null);
              }} onKeyDown={e => {
                if (e.key === "Enter") searchFriendByEmail();
              }} /><button className={"btn btn-ghost btn-sm"} style={{
                flexShrink: 0,
                opacity: friendSearchLoading || !friendSearch.trim() ? 0.4 : 1
              }} disabled={friendSearchLoading || !friendSearch.trim()} onClick={searchFriendByEmail}>{friendSearchLoading ? "…" : "Search"}</button></div>
            {
              /* Search result */
            }{socialMsg === null && friendSearchResult && <div style={{
              background: "rgba(45,42,36,.18)",
              border: "1px solid rgba(180,172,158,.06)",
              borderRadius: R.r10,
              padding: "10px 12px",
              marginBottom: S.s12
            }}>{friendSearchResult.found ? (() => {
                const u = friendSearchResult.user;
                const uCls = u.chosenClass ? CLASSES[u.chosenClass] : null;
                const ex = friendSearchResult.existing;
                return <div><div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: S.s10
                  }}><div className={"friend-avatar"}>{_optionalChain([uCls, 'optionalAccess', _155 => _155.icon]) || "⚔️"}</div><div style={{
                      flex: 1
                    }}><div className={"friend-name"}>{u.playerName || "Unnamed Warrior"}{u.publicId && <span style={{
                          fontSize: FS.fs58,
                          color: "#8a8478",
                          fontWeight: 400,
                          marginLeft: S.s6
                        }}>{"#" + u.publicId}</span>}</div><div className={"friend-meta"}>{_optionalChain([uCls, 'optionalAccess', _156 => _156.name]) || "Unknown"}{friendSearchResult.matchType === "account_id" ? " · Found by Account ID" : " · Found by email"}</div></div>{!ex && <button className={"btn btn-gold btn-xs"} onClick={() => sendFriendRequest(u.id)}>{"+ Add"}</button>}{_optionalChain([ex, 'optionalAccess', _157 => _157.status]) === "pending" && <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: S.s4
                    }}><span style={{
                        fontSize: FS.fs62,
                        color: "#8a8478",
                        fontStyle: "italic"
                      }}>{"Request pending…"}</span><button className={"btn btn-ghost btn-xs"} style={{
                        fontSize: FS.fs58,
                        color: UI_COLORS.danger,
                        borderColor: "rgba(231,76,60,.3)",
                        padding: "2px 8px"
                      }} onClick={() => rescindFriendRequest(ex.id, u.id)}>{"Rescind"}</button></div>}{_optionalChain([ex, 'optionalAccess', _158 => _158.status]) === "accepted" && <span style={{
                      fontSize: FS.fs65,
                      color: UI_COLORS.success
                    }}>{"Already friends ✓"}</span>}</div></div>;
              })() : <div style={{
                fontSize: FS.fs75,
                color: "#8a8478",
                fontStyle: "italic"
              }}>{friendSearchResult.msg}</div>}</div>
            /* Incoming requests */}{friendRequests.length > 0 && <><div className={"sec"} style={{
                marginBottom: S.s8
              }}>{"⚔️ Incoming Requests"}</div>{friendRequests.map(r => <div key={r.reqId} className={"req-card"}><div style={{
                  flex: 1
                }}><div style={{
                    fontSize: FS.fs78,
                    color: "#d4cec4"
                  }}>{r.playerName}</div><div style={{
                    fontSize: FS.fs62,
                    color: "#8a8478",
                    marginTop: S.s2
                  }}>{"Wants to join your party"}</div></div><button className={"btn btn-gold btn-xs"} style={{
                  marginRight: S.s6
                }} onClick={() => acceptFriendRequest(r.reqId)}>{"Accept"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => rejectFriendRequest(r.reqId)}>{"Decline"}</button></div>)}</>

            /* Incoming shared items */}{incomingShares.length > 0 && <><div className={"sec"} style={{
                marginBottom: S.s8
              }}>{"📦 Incoming Shares"}</div>{incomingShares.map(s => <div key={s.id} className={"req-card"} style={{
                flexDirection: "column",
                alignItems: "stretch",
                gap: S.s8
              }}><div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: S.s8
                }}><span style={{
                    fontSize: "1.1rem"
                  }}>{s.type === "workout" ? "💪" : "⚡"}</span><div style={{
                    flex: 1
                  }}><div style={{
                      fontSize: FS.fs78,
                      color: "#d4cec4"
                    }}>{_optionalChain([s, 'access', _159 => _159.parsedItem, 'optionalAccess', _160 => _160.name]) || "Unnamed"}</div><div style={{
                      fontSize: FS.fs62,
                      color: "#8a8478",
                      marginTop: S.s2
                    }}>{s.senderName}{" shared a "}{s.type}{" with you"}</div></div></div>{_optionalChain([s, 'access', _161 => _161.parsedItem, 'optionalAccess', _162 => _162.desc]) && <div style={{
                  fontSize: FS.fs65,
                  color: "#8a8478",
                  fontStyle: "italic",
                  paddingLeft: 28
                }}>{s.parsedItem.desc.slice(0, 80)}{s.parsedItem.desc.length > 80 ? "…" : ""}</div>}<div style={{
                  display: "flex",
                  gap: S.s6,
                  paddingLeft: 28
                }}><button className={"btn btn-gold btn-xs"} style={{
                    flex: 1
                  }} onClick={() => acceptShare(s)}>{"✓ Add to Mine"}</button><button className={"btn btn-ghost btn-xs"} style={{
                    flex: 1
                  }} onClick={() => declineShare(s.id)}>{"Decline"}</button></div></div>)}</>

            /* Outgoing pending requests */}{outgoingRequests.length > 0 && <><div className={"sec"} style={{
                marginBottom: S.s8,
                marginTop: S.s12
              }}>{"📤 Pending Sent ("}{outgoingRequests.length}{")"}</div>{outgoingRequests.map(r => <div key={r.reqId} className={"req-card"}><div style={{
                  flex: 1
                }}><div style={{
                    fontSize: FS.fs78,
                    color: "#d4cec4"
                  }}>{r.playerName}</div><div style={{
                    fontSize: FS.fs62,
                    color: "#8a8478",
                    marginTop: S.s2
                  }}>{"Awaiting their response…"}</div></div><button className={"btn btn-ghost btn-xs"} style={{
                  flexShrink: 0,
                  fontSize: FS.fs65,
                  color: UI_COLORS.danger,
                  borderColor: "rgba(231,76,60,.3)"
                }} onClick={() => rescindFriendRequest(r.reqId, r.userId)}>{"Rescind"}</button></div>)}</>

            /* Friends list */}<div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: S.s8,
              marginTop: friendRequests.length > 0 || incomingShares.length > 0 || outgoingRequests.length > 0 ? 12 : 0
            }}><div className={"sec"} style={{
                margin: 0,
                border: "none",
                padding: S.s0
              }}>{"👥 My Party ("}{friends.length}{")"}</div>{authUser && <button className={"btn btn-ghost btn-xs"} style={{
                fontSize: FS.fs58
              }} onClick={() => {
                loadSocialData();
                loadIncomingShares();
              }}>{socialLoading ? "…" : "↺ Refresh"}</button>}</div>{!authUser && <div className={"empty"}>{"Sign in to see your friends."}</div>}{authUser && socialLoading && <div className={"empty"}>{"Loading your party…"}</div>}{authUser && !socialLoading && friends.length === 0 && <div className={"empty"}>{"No friends yet."}<br />{"Search by email to find other warriors."}</div>}{friends.map(f => {
              const fCls = f.chosenClass ? CLASSES[f.chosenClass] : null;
              const fLevel = levelFor(f.xp || 0);
              // Phase 4 (script 11): build "Latest" line from
              // friend_exercise_events RPC result. Falls back to
              // null when no event has been recorded yet (banner
              // hides "Latest:" line and shows "No workouts logged
              // yet" — same UX as before).
              const recentEv = friendRecentEvents[f.id];
              const recent = recentEv ? `${recentEv.exercise_icon || "💪"} ${recentEv.exercise_name || recentEv.exercise_id}` : null;
              return <div key={f.id} className={"friend-card"}><div className={"friend-card-top"}><div className={"friend-avatar"} style={{
                    borderColor: _optionalChain([fCls, 'optionalAccess', _163 => _163.color]) || "rgba(45,42,36,.3)"
                  }}>{_optionalChain([fCls, 'optionalAccess', _164 => _164.icon]) || "⚔️"}</div><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between"
                    }}><div className={"friend-name"}>{f.playerName || "Unnamed Warrior"}</div><div style={{
                        display: "flex",
                        gap: S.s4
                      }}><button className={"btn btn-ghost btn-xs"} style={{
                          fontSize: FS.fs55,
                          color: UI_COLORS.info,
                          padding: "2px 6px"
                        }} onClick={() => openDmWithUser(f.id)}>{"💬 Chat"}</button><button className={"btn btn-ghost btn-xs"} style={{
                          fontSize: FS.fs55,
                          color: "#b4ac9e",
                          padding: "2px 6px"
                        }} onClick={() => setShareModal({
                          step: "pick-type",
                          friendId: f.id,
                          friendName: f.playerName || "this warrior"
                        })}>{"⇪ Share"}</button><button className={"btn btn-ghost btn-xs"} style={{
                          fontSize: FS.fs55,
                          color: "#8a8478",
                          padding: "2px 6px"
                        }} onClick={() => removeFriend(f._reqId)}>{"Remove"}</button></div></div><div className={"friend-meta"}><span style={{
                        color: _optionalChain([fCls, 'optionalAccess', _165 => _165.color]) || "#b4ac9e"
                      }}>{_optionalChain([fCls, 'optionalAccess', _166 => _166.name]) || "Unknown"}</span>{" · "}{"Level "}{fLevel}{" · "}<span style={{
                        color: "#b4ac9e"
                      }}>{formatXP(f.xp || 0, {
                          prefix: "⚡ "
                        })}</span></div></div></div>{recent && <div className={"friend-recent"}><span style={{
                    color: "#8a8478",
                    marginRight: S.s6
                  }}>{"Latest:"}</span>{recent}</div>}{!recent && <div className={"friend-recent"} style={{
                  color: "#8a8478",
                  fontStyle: "italic"
                }}>{"No workouts logged yet"}</div>}</div>;
            })}</div>;
        })()

        /* ── MESSAGES TAB ─────────────────────── */}{activeTab === "messages" && (() => {
          const CLASSES_REF = CLASSES;

          // ── Conversation List ──
          if (msgView === "list") {
            return <div><div className={"techniques-header"}><div className={"tech-hdr-left"}><div className={"tech-ornament-line tech-ornament-line-l"} /><span className={"tech-hdr-title"}>{"✦ Messages ✦"}</span><div className={"tech-ornament-line tech-ornament-line-r"} /></div></div>{msgConversations.length === 0 && <div style={{
                textAlign: "center",
                padding: "30px 14px"
              }}><div style={{
                  fontSize: "2.5rem",
                  marginBottom: S.s10,
                  opacity: .3
                }}>{"💬"}</div><div style={{
                  fontSize: FS.fs78,
                  color: "#8a8478",
                  marginBottom: S.s6
                }}>{"No conversations yet"}</div><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}>{"Tap "}<span style={{
                    color: UI_COLORS.info
                  }}>{"💬 Chat"}</span>{" on a friend’s card in the Guild tab to start a conversation."}</div></div>}{msgConversations.map(conv => {
                const other = conv.other_user;
                const otherCls = other ? CLASSES_REF[other.chosen_class] : null;
                const lastMsg = conv.last_message;
                const unread = conv.unread_count || 0;
                const timeAgo = lastMsg ? (() => {
                  const diff = Date.now() - new Date(lastMsg.created_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 1) return "now";
                  if (mins < 60) return mins + "m";
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return hrs + "h";
                  const days = Math.floor(hrs / 24);
                  return days + "d";
                })() : "";
                return <div key={conv.channel_id} className={`msg-conv-card${unread > 0 ? " unread" : ""}`} onClick={() => {
                  setMsgActiveChannel(conv);
                  loadChannelMessages(conv.channel_id);
                  setMsgView("chat");
                }}>
                  // Avatar
                  <div className={"msg-avatar"} style={{
                    background: (otherCls ? otherCls.color : "#8a8478") + "18",
                    border: "1px solid " + (otherCls ? otherCls.color : "#8a8478") + "44"
                  }}>{otherCls ? <ClassIcon classKey={other.chosen_class} size={18} color={otherCls.color} /> : "\uD83D\uDCAC"}</div>
                  // Name + last message
                  <div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: S.s6
                    }}><span className={"msg-conv-name"} style={{
                        fontWeight: unread > 0 ? 700 : 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>{other ? other.player_name : conv.name || "Chat"}</span><span style={{
                        fontSize: FS.fs52,
                        color: "#8a8478",
                        flexShrink: 0
                      }}>{timeAgo}</span></div>{lastMsg && <div className={`msg-conv-preview${unread > 0 ? " unread" : ""}`}>{lastMsg.sender_id === authUser?.id ? "You: " : ""}{lastMsg.content}</div>}{!lastMsg && <div style={{
                      fontSize: FS.fs62,
                      color: "#8a8478",
                      fontStyle: "italic",
                      marginTop: S.s2
                    }}>{"No messages yet"}</div>}</div>{
                  // Unread badge
                  unread > 0 && <div className={"msg-unread-badge"}>{unread > 99 ? "99+" : unread}</div>}</div>;
              })}</div>;
          }

          // ── Chat View ──
          const other = msgActiveChannel?.other_user;
          const otherCls = other ? CLASSES_REF[other.chosen_class] : null;
          return <div style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0
          }}>
            // Chat header
            <div className={"msg-chat-hdr"}><button style={{
                background: "transparent",
                border: "none",
                color: "#b4ac9e",
                fontSize: FS.fs82,
                cursor: "pointer",
                padding: "4px"
              }} onClick={() => {
                setMsgView("list");
                setMsgActiveChannel(null);
                setMsgMessages([]);
                loadConversations();
                loadUnreadCount();
              }}>{"←"}</button><div style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                flexShrink: 0,
                background: (otherCls ? otherCls.color : "#8a8478") + "18",
                border: "1.5px solid " + (otherCls ? otherCls.color : "#8a8478") + "44",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: FS.fs85
              }}>{otherCls ? <ClassIcon classKey={other.chosen_class} size={14} color={otherCls.color} /> : "\uD83D\uDCAC"}</div><div style={{
                flex: 1,
                minWidth: 0
              }}><div style={{
                  fontSize: FS.fs78,
                  fontWeight: 700,
                  color: "#d4cec4"
                }}>{other ? other.player_name : "Chat"}</div>{other && <div style={{
                  fontSize: FS.fs52,
                  color: "#8a8478"
                }}>{otherCls ? otherCls.name : "Unknown"}{" · Lv."}{other.level || 1}{other.public_id ? " \u00b7 #" + other.public_id : ""}</div>}</div></div>
            // Messages area
            <div ref={msgScrollRef} style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: S.s6,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(180,172,158,.1) transparent"
            }}>{msgLoading && <div style={{
                textAlign: "center",
                padding: "20px 0"
              }}><div style={{
                  width: 20,
                  height: 20,
                  border: "2px solid rgba(180,172,158,.12)",
                  borderTopColor: "#b4ac9e",
                  borderRadius: "50%",
                  animation: "spin .8s linear infinite",
                  margin: "0 auto 6px"
                }} /><div style={{
                  fontSize: FS.fs58,
                  color: "#8a8478"
                }}>{"Loading…"}</div></div>}{!msgLoading && msgMessages.length === 0 && <div style={{
                textAlign: "center",
                padding: "30px 0",
                fontSize: FS.fs68,
                color: "#8a8478",
                fontStyle: "italic"
              }}>{"No messages yet. Say hello!"}</div>}{!msgLoading && msgMessages.map(msg => {
                const isMine = msg.is_mine;
                const isSystem = msg.message_type === "system" || msg.message_type === "event";
                if (isSystem) {
                  return <div key={msg.id} style={{
                    textAlign: "center",
                    padding: "4px 0"
                  }}><span className={"msg-bubble system"}>{msg.content}</span></div>;
                }
                const time = new Date(msg.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                });
                return <div key={msg.id} style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isMine ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  alignSelf: isMine ? "flex-end" : "flex-start"
                }}>{!isMine && <div style={{
                    fontSize: FS.fs48,
                    color: "#8a8478",
                    marginBottom: S.s2,
                    marginLeft: S.s4
                  }}>{msg.sender_name}</div>}<div className={`msg-bubble ${isMine ? "own" : "other"}`}>{msg.content}</div><div className={"msg-timestamp"} style={{
                    marginLeft: S.s4,
                    marginRight: S.s4
                  }}>{time}{msg.edited_at ? " \u00b7 edited" : ""}</div></div>;
              })}</div>
            // Input bar
            <div className={"msg-input-bar"}><input className={"msg-input"} placeholder={"Type a message\u2026"} value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMsg();
                }
              }} /><button className={"msg-send-btn"} style={{
                width: 40,
                height: 40,
                opacity: msgInput.trim() ? 1 : .4,
                cursor: msgInput.trim() ? "pointer" : "default"
              }} disabled={msgSending || !msgInput.trim()} onClick={sendMsg}>{msgSending ? "\u2026" : "\u2191"}</button></div></div>;
        })()

        /* ── CHARACTER TAB ────────────────────── */}{activeTab === "character" && (() => {
          const charStats = calcCharStats(cls, level, clsKey, profile);
          const statMax = Math.max(...Object.values(charStats));
          const STAT_META = {
            STR: {
              label: "Strength",
              icon: "💪",
              color: UI_COLORS.danger
            },
            END: {
              label: "Endurance",
              icon: "🔥",
              color: "#e67e22"
            },
            DEX: {
              label: "Dexterity",
              icon: "⚡",
              color: UI_COLORS.accent
            },
            CON: {
              label: "Constitution",
              icon: "🛡️",
              color: "#27ae60"
            },
            INT: {
              label: "Intelligence",
              icon: "🔮",
              color: UI_COLORS.accent
            },
            CHA: {
              label: "Charisma",
              icon: "✨",
              color: "#e91e8c"
            },
            WIS: {
              label: "Wisdom",
              icon: "🌿",
              color: "#1abc9c"
            },
            VIT: {
              label: "Vitality",
              icon: "❤️",
              color: UI_COLORS.danger
            }
          };
          const EQUIP_SLOTS = [{
            key: "slot_helmet",
            icon: "⛑️",
            label: "Helmet",
            hint: "INT / WIS"
          }, {
            key: "slot_glasses",
            icon: "👓",
            label: "Glasses",
            hint: "INT cosmetic"
          }, {
            key: "slot_shoulders",
            icon: "🦺",
            label: "Shoulders",
            hint: "CON / STR"
          }, {
            key: "slot_chest",
            icon: "👕",
            label: "Chest",
            hint: "VIT / CON"
          }, {
            key: "slot_belt",
            icon: "🩱",
            label: "Belt",
            hint: "STR / CON"
          }, {
            key: "slot_gloves",
            icon: "🧤",
            label: "Gloves",
            hint: "STR / DEX"
          }, {
            key: "slot_legs",
            icon: "👖",
            label: "Legs",
            hint: "DEX / END"
          }, {
            key: "slot_shoes",
            icon: "👟",
            label: "Shoes",
            hint: "DEX / END"
          }, {
            key: "slot_weapon_main",
            icon: "⚔️",
            label: "Weapon",
            hint: "STR / CHA"
          }, {
            key: "slot_weapon_off",
            icon: "🛡️",
            label: "Off-hand",
            hint: "DEX / CON"
          }];
          // `profile.equipment` is read but never written via setProfile —
          // it's intentionally a write-once-via-rewards / read-only-from-app
          // shape that doesn't yet have a setter. Surfaced by the item 5c
          // audit for follow-up; keeping the read here works because
          // `profile.equipment ?? {}` falls back cleanly when undefined.
          // The previously-defined `setAv` helper alongside this was unused
          // dead code and has been removed.
          const equipment = profile.equipment || {};
          const isStyleUnlocked = s => {
            if (s.unlockRace && profile.avatarRace !== s.unlockRace) return false;
            if (s.unlockDrop) return false;
            return level >= (s.unlockLevel || 1);
          };
          /* btn styling now via .char-sub-btn / .char-sub-btn.sel */
          const rune = label => <div className={"profile-rune-divider"} style={{
            margin: "0 0 10px"
          }}><span className={"profile-rune-label"}>{`⠿ ${label} ⠿`}</span></div>;
          return <div style={{
            "--cls-color": cls.color,
            "--cls-glow": cls.glow
          }}><div className={"profile-hero"} style={{
              marginBottom: S.s12
            }}><div className={"profile-hero-inner"}><div className={"profile-hero-top"}><div className={"profile-avatar-ring"} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}><ClassIcon classKey={profile.chosenClass} size={36} color={cls.glow} /></div><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div className={"profile-name"}>{profile.playerName}{myPublicId && <span style={{
                        fontSize: FS.fs58,
                        color: "#8a8478",
                        fontWeight: 400,
                        marginLeft: S.s8,
                        letterSpacing: ".03em"
                      }}>{"#" + myPublicId}</span>}</div><div className={"profile-class-line"}>{cls.name}{" · Level "}{level}</div>{profile.disciplineTrait && <span className={"trait"} style={{
                      "--cls-color": cls.color,
                      "--cls-glow": cls.glow,
                      fontSize: FS.fs65
                    }}>{profile.disciplineTrait}</span>}</div></div><div className={"profile-rune-divider"} style={{
                  margin: "10px 0 8px"
                }}><span className={"profile-rune-label"}>{"⠿ Class Traits ⠿"}</span></div><div className={"traits"}>{cls.traits.map(t => <span key={t} className={"trait"} style={{
                    "--cls-color": cls.color,
                    "--cls-glow": cls.glow
                  }}>{t}</span>)}</div></div></div>

            {
              /* ── SUB-TABS ── */
            }<div style={{
              display: "flex",
              gap: S.s6,
              marginBottom: S.s12
            }}>{["avatar", "stats", "equipment"].map(t => <button key={t} onClick={() => setCharSubTab(t)} className={`char-sub-btn${charSubTab === t ? " sel" : ""}`} style={{
                flex: 1,
                textAlign: "center",
                padding: "8px 4px"
              }}>{t === "avatar" ? "⚔️ Avatar" : t === "stats" ? "📊 Stats" : "🎒 Equipment"}</button>)}</div>

            {
              /* ══ AVATAR SUB-TAB ══════════════════════════ */
            }{charSubTab === "avatar" && <div><div className={"char-section"} style={{
                textAlign: "center",
                padding: "52px 24px"
              }}><div style={{
                  fontSize: "2.6rem",
                  marginBottom: S.s14
                }}>{"⚔️"}</div><div style={{
                  fontSize: FS.fs95,
                  color: "#b4ac9e",
                  fontWeight: 600,
                  marginBottom: S.s8,
                  letterSpacing: ".02em"
                }}>{"Avatar Creator"}</div><div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: S.s6,
                  background: "rgba(45,42,36,.22)",
                  border: "1px solid rgba(180,172,158,.08)",
                  borderRadius: R.r20,
                  padding: "6px 14px",
                  marginBottom: S.s14
                }}><span style={{
                    fontSize: FS.fs65,
                    color: "#b4ac9e",
                    fontWeight: 600,
                    letterSpacing: ".06em",
                    textTransform: "uppercase"
                  }}>{"Coming Soon"}</span></div><div style={{
                  fontSize: FS.fs76,
                  color: "#8a8478",
                  lineHeight: 1.7,
                  maxWidth: 260,
                  margin: "0 auto"
                }}>{"Full 3D avatar customization is under development. Your character will come to life with Unreal Engine integration."}</div></div></div>
            /* ══ STATS SUB-TAB ════════════════════════════ */}{charSubTab === "stats" && <div><div className={"char-section"}>{rune("Character Stats")}<div style={{
                  fontSize: FS.sm,
                  color: "#8a8478",
                  fontStyle: "italic",
                  textAlign: "center",
                  marginBottom: S.s10
                }}>{"Stats grow dynamically as you train — full calculation coming soon"}</div>{Object.entries(STAT_META).map(([key, meta]) => {
                  const val = charStats[key] || 0,
                    pct = Math.round(val / statMax * 100);
                  return <div key={key} className={"char-stat-row"}><span className={"char-stat-icon"}>{meta.icon}</span><span className={"char-stat-label"} style={{
                      width: 80
                    }}>{meta.label}</span><div className={"char-stat-bar"}><div className={"char-stat-fill"} style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg,${meta.color}99,${meta.color})`
                      }} /></div><span className={"char-stat-val"}>{val}</span></div>;
                })}</div></div>

            /* ══ EQUIPMENT SUB-TAB ═══════════════════════ */}{charSubTab === "equipment" && <div><div className={"char-section"}>{rune("Equipment")}<div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "7px"
                }}>{EQUIP_SLOTS.map(slot => {
                    const item = equipment[slot.key] || null;
                    return <div key={slot.key} className={"char-equip-slot"}><div className={"char-equip-icon"} style={{
                        width: 30,
                        height: 30,
                        borderRadius: R.r7,
                        border: `1px solid ${item ? "rgba(180,172,158,.1)" : "rgba(180,172,158,.06)"}`,
                        background: item ? "rgba(45,42,36,.18)" : "rgba(45,42,36,.12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1rem"
                      }}>{slot.icon}</div><div style={{
                        flex: 1,
                        minWidth: 0
                      }}><div className={"char-equip-label"} style={{
                          fontWeight: 600
                        }}>{slot.label}</div><div className={"char-equip-name"} style={{
                          color: item ? "#b4ac9e" : "#8a8478"
                        }}>{item || slot.hint}</div></div></div>;
                  })}</div><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478",
                  fontStyle: "italic",
                  textAlign: "center",
                  marginTop: S.s8
                }}>{"Earn gear through dungeons and quests in the 3D World"}</div></div></div>}</div>;
        })()

        /* ── PROFILE VIEW ─────────────────────── */}{activeTab === "profile" && !editMode && !securityMode && !notifMode && <div style={{
          "--cls-color": cls.color,
          "--cls-glow": cls.glow
        }}>{!profileComplete() && <div style={{
            background: "rgba(231,76,60,.08)",
            border: "1px solid rgba(231,76,60,.2)",
            borderRadius: R.r10,
            padding: "10px 14px",
            marginBottom: S.s12,
            display: "flex",
            alignItems: "center",
            gap: S.s10
          }}><span style={{
              fontSize: "1.1rem"
            }}>{"⚠️"}</span><div style={{
              flex: 1
            }}><div style={{
                fontSize: FS.lg,
                color: UI_COLORS.danger,
                fontWeight: 700,
                marginBottom: S.s2
              }}>{"Profile Incomplete"}</div><div style={{
                fontSize: FS.sm,
                color: "#8a8478"
              }}>{"State and Country are required for leaderboard rankings. Tap Edit to add them."}</div></div><button className={"btn btn-ghost btn-sm"} style={{
              fontSize: FS.fs58,
              flexShrink: 0
            }} onClick={() => {
              setSecurityMode(false);
              setNotifMode(false);
              openEdit();
            }}>{"Edit"}</button></div>

          /* Action buttons */}<div style={{
            display: "flex",
            gap: S.s8,
            marginBottom: S.s12
          }}><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => {
              setSecurityMode(false);
              setNotifMode(false);
              openEdit();
            }}>{"✎ Edit"}</button><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => {
              setEditMode(false);
              setNotifMode(false);
              setSecurityMode(true);
            }}>{"🔒 Security"}</button><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => {
              setEditMode(false);
              setSecurityMode(false);
              setNotifMode(true);
            }}>{"🔔 Alerts"}</button></div>

          {
            /* ── IDENTITY SECTION — Name visibility with App/Game/Hide toggles ── */
          }{(() => {
            const nv = profile.nameVisibility || {
              displayName: ["app", "game"],
              realName: ["hide"]
            };
            const realName = ((profile.firstName || "") + " " + (profile.lastName || "")).trim();
            const boxStyle = (active, color) => ({
              width: 42,
              height: 24,
              borderRadius: R.r5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: FS.fs52,
              fontWeight: 700,
              cursor: "pointer",
              userSelect: "none",
              transition: "all .15s",
              background: active ? color || "rgba(180,172,158,.12)" : "rgba(45,42,36,.15)",
              border: "1px solid " + (active ? "rgba(180,172,158,.15)" : "rgba(45,42,36,.2)"),
              color: active ? "#d4cec4" : "#8a8478"
            });
            const ToggleRow = ({
              label,
              value,
              rowKey
            }) => {
              const hasApp = (nv[rowKey] || []).includes("app");
              const hasGame = (nv[rowKey] || []).includes("game");
              const isHidden = (nv[rowKey] || []).includes("hide");
              return <div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                padding: "8px 0"
              }}><div style={{
                  flex: 1,
                  minWidth: 0
                }}><div style={{
                    fontSize: FS.fs56,
                    color: "#8a8478",
                    marginBottom: S.s2
                  }}>{label}</div><div style={{
                    fontSize: FS.fs78,
                    color: isHidden ? "#8a8478" : "#d4cec4",
                    fontWeight: 600,
                    fontStyle: isHidden ? "italic" : "normal"
                  }}>{isHidden ? "Hidden" : value || "Not set"}</div></div><div style={{
                  display: "flex",
                  gap: S.s4
                }}><div style={boxStyle(hasApp, "rgba(46,204,113,.12)")} onClick={() => toggleNameVisibility(rowKey, "app")}>{"App"}</div><div style={boxStyle(hasGame, "rgba(52,152,219,.12)")} onClick={() => toggleNameVisibility(rowKey, "game")}>{"Game"}</div><div style={boxStyle(isHidden, "rgba(231,76,60,.08)")} onClick={() => toggleNameVisibility(rowKey, "hide")}>{"Hide"}</div></div></div>;
            };
            return <div className={"profile-section"}><div className={"profile-rune-divider"} style={{
                margin: "0 0 6px"
              }}><span className={"profile-rune-label"}>{"⠿ Identity ⠿"}</span></div>{/* Account ID */
              myPublicId && <div style={{
                textAlign: "center",
                marginBottom: S.s6
              }}><span style={{
                  fontSize: FS.fs62,
                  color: "#8a8478",
                  fontFamily: "'Inter',monospace",
                  letterSpacing: ".04em"
                }}>{"Account ID: "}<span style={{
                    color: "#b4ac9e",
                    fontWeight: 700
                  }}>{"#" + myPublicId}</span><span style={{
                    fontSize: FS.fs52,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    textDecoration: "underline",
                    marginLeft: S.s6
                  }} onClick={() => {
                    navigator.clipboard.writeText("#" + myPublicId).then(() => showToast("Account ID copied!"));
                  }}>{"Copy"}</span></span></div>} {
                /* Display Name row */
              }
              <ToggleRow label={"Display Name"} value={profile.playerName} rowKey={"displayName"} /> {
                /* Divider */
              }
              <div style={{
                height: 1,
                background: "rgba(180,172,158,.04)",
                margin: "0 0"
              }} /> {
                /* Real Name row */
              }
              <ToggleRow label={"First & Last Name"} value={realName || "Not set"} rowKey={"realName"} /> {
                /* Legend */
              }
              <div style={{
                display: "flex",
                gap: S.s10,
                justifyContent: "center",
                marginTop: S.s8,
                fontSize: FS.fs48,
                color: "#8a8478"
              }}><span>{"App = Profile & Social"}</span><span>{"·"}</span><span>{"Game = Leaderboard & Quests"}</span><span>{"·"}</span><span>{"Hide = Not shown"}</span></div></div>;
          })()

          /* ── COMBAT RECORD — WoW achievement panel / D4 stats tab ── */}<div className={"profile-section"}><div className={"profile-rune-divider"} style={{
              margin: "0 0 10px"
            }}><span className={"profile-rune-label"}>{"⠿ Combat Record ⠿"}</span></div><div className={"combat-grid"}><div className={"combat-chip"}><span className={"combat-chip-val"}>{profile.xp.toLocaleString()}</span><span className={"combat-chip-lbl"}>{"Total XP"}</span></div><div className={"combat-chip"}><span className={"combat-chip-val"}>{level}</span><span className={"combat-chip-lbl"}>{"Level"}</span></div><div className={"combat-chip"}><span className={"combat-chip-val"}>{profile.checkInStreak}{"🔥"}</span><span className={"combat-chip-lbl"}>{"Streak"}</span></div><div className={"combat-chip"}><span className={"combat-chip-val"}>{profile.log.length}</span><span className={"combat-chip-lbl"}>{"Sessions"}</span></div><div className={"combat-chip"}><span className={"combat-chip-val"}>{QUESTS.filter(q => _optionalChain([profile, 'access', _167 => _167.quests, 'optionalAccess', _168 => _168[q.id], 'optionalAccess', _169 => _169.claimed])).length}</span><span className={"combat-chip-lbl"}>{"Quests"}</span></div>{profile.runningPB ? <div className={"combat-chip"} style={{
                borderColor: "rgba(255,232,124,.18)"
              }}><span className={"combat-chip-val"} style={{
                  color: UI_COLORS.warning,
                  fontSize: FS.md
                }}>{isMetric(profile.units) ? parseFloat((profile.runningPB * 1.60934).toFixed(2)) + " /km" : parseFloat(profile.runningPB.toFixed(2)) + " /mi"}</span><span className={"combat-chip-lbl"}>{"🏃 Run PB"}</span></div> : <div className={"combat-chip"}><span className={"combat-chip-val"} style={{
                  color: "#8a8478"
                }}>{"—"}</span><span className={"combat-chip-lbl"}>{"Run PB"}</span></div>}</div></div>

          {
            /* ── PERSONAL BESTS ── */
          }{(() => {
            const allPBs = profile.exercisePBs || {};
            const pbEntries = Object.entries(allPBs);
            if (pbEntries.length === 0) return null;
            const metric = isMetric(profile.units);

            // Compute effective selection: leaderboard PBs pre-selected by default
            const effectiveSelected = pbSelectedFilters === null ? pbEntries.filter(([id]) => LEADERBOARD_PB_IDS.has(id)).map(([id]) => id) : pbSelectedFilters;

            // Build options for the filter dropdown
            const pbOptions = pbEntries.map(([exId]) => {
              const ex = EX_BY_ID[exId];
              return {
                id: exId,
                label: ex ? ex.name : exId,
                icon: ex ? ex.icon : "💪"
              };
            });

            // Filter visible entries
            const visibleEntries = pbEntries.filter(([exId]) => effectiveSelected.includes(exId));

            // PB Filter Dropdown
            const chipLabel = effectiveSelected.length === pbOptions.length ? "All PBs" : effectiveSelected.length === 0 ? "Filter PBs" : effectiveSelected.length <= 2 ? effectiveSelected.map(id => {
              const ex = EX_BY_ID[id];
              return ex ? ex.name : id;
            }).join(", ") : effectiveSelected.length + " selected";
            const filterDrop = <div style={{
              position: "relative",
              marginBottom: S.s8
            }}><div style={{
                background: pbFilterOpen ? "rgba(45,42,36,.45)" : "rgba(45,42,36,.2)",
                border: "1px solid " + (pbFilterOpen ? "rgba(180,172,158,.12)" : "rgba(180,172,158,.06)"),
                borderRadius: R.lg,
                padding: "8px 10px",
                fontSize: FS.sm,
                fontWeight: 600,
                color: effectiveSelected.length === 0 ? "#8a8478" : "#b4ac9e",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: S.s6,
                transition: "all .15s",
                userSelect: "none"
              }} onClick={() => setPbFilterOpen(!pbFilterOpen)}><span style={{
                  fontSize: FS.md
                }}>{"🏆"}</span><span style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>{chipLabel}</span><span style={{
                  fontSize: FS.fs46,
                  color: "#8a8478",
                  flexShrink: 0
                }}>{pbFilterOpen ? "▲" : "▼"}</span></div>{pbFilterOpen && <div style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 60,
                background: "#16160f",
                border: "1px solid rgba(180,172,158,.1)",
                borderRadius: R.r10,
                boxShadow: "0 8px 32px rgba(0,0,0,.6)",
                overflow: "hidden"
              }}><div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderBottom: "1px solid rgba(180,172,158,.06)",
                  background: "rgba(45,42,36,.15)"
                }}><span style={{
                    fontSize: FS.fs56,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    fontWeight: 600
                  }} onClick={() => setPbSelectedFilters(pbOptions.map(o => o.id))}>{"Select All"}</span><span style={{
                    fontSize: FS.fs56,
                    color: UI_COLORS.danger,
                    cursor: "pointer",
                    fontWeight: 600
                  }} onClick={() => setPbSelectedFilters([])}>{"Clear All"}</span></div><div style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  padding: "4px 4px",
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(180,172,158,.15) transparent"
                }}>{pbOptions.map(opt => {
                    const on = effectiveSelected.includes(opt.id);
                    return <div key={opt.id} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s8,
                      padding: "6px 8px",
                      cursor: "pointer",
                      borderRadius: R.r5,
                      background: on ? "rgba(180,172,158,.07)" : "transparent",
                      transition: "background .1s",
                      fontSize: FS.fs62,
                      color: on ? "#d4cec4" : "#8a8478"
                    }} onClick={() => {
                      const newSel = on ? effectiveSelected.filter(s => s !== opt.id) : [...effectiveSelected, opt.id];
                      setPbSelectedFilters(newSel);
                    }}><span style={{
                        width: 15,
                        height: 15,
                        borderRadius: R.r3,
                        border: "1.5px solid " + (on ? "#b4ac9e" : "rgba(180,172,158,.12)"),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: FS.fs52,
                        color: "#b4ac9e",
                        flexShrink: 0,
                        background: on ? "rgba(180,172,158,.08)" : "transparent"
                      }}>{on ? "✓" : ""}</span><span style={{
                        fontSize: FS.md,
                        marginRight: S.s4
                      }}>{opt.icon}</span>{opt.label}</div>;
                  })}</div><div style={{
                  padding: "6px 10px",
                  borderTop: "1px solid rgba(180,172,158,.06)",
                  background: "rgba(45,42,36,.1)"
                }}><div style={{
                    textAlign: "center",
                    fontSize: FS.fs58,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    fontWeight: 600,
                    padding: "4px 0"
                  }} onClick={() => setPbFilterOpen(false)}>{"✓ Done (" + effectiveSelected.length + ")"}</div></div></div>}</div>;
            return <div className={"profile-section"}><div className={"profile-rune-divider"} style={{
                margin: "0 0 10px"
              }}><span className={"profile-rune-label"}>{"⠿ Personal Bests ⠿"}</span></div>{filterDrop}{visibleEntries.length === 0 ? <div style={{
                textAlign: "center",
                fontSize: FS.fs62,
                color: "#8a8478",
                padding: "10px 0"
              }}>{"Use the filter above to select which Personal Bests to display."}</div> : <div style={{
                display: "flex",
                flexDirection: "column",
                gap: S.s6
              }}>{visibleEntries.map(([exId, pb]) => {
                  const ex = EX_BY_ID[exId];
                  const name = ex ? ex.name : exId;
                  const icon = ex ? ex.icon : "💪";
                  let valDisp = "";
                  if (pb.type === "Cardio Pace") {
                    const pace = metric ? pb.value / 1.60934 : pb.value;
                    valDisp = pace.toFixed(2) + (metric ? " min/km" : " min/mi");
                  } else if (pb.type === "Assisted Weight") {
                    valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric ? " kg" : " lbs") + " (Assisted)";
                  } else if (pb.type === "Max Reps Per 1 Set") {
                    valDisp = pb.value + " reps";
                  } else if (pb.type === "Longest Hold" || pb.type === "Fastest Time") {
                    valDisp = parseFloat(pb.value.toFixed(2)) + " min";
                  } else if (pb.type === "Heaviest Weight") {
                    valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric ? " kg" : " lbs");
                  } else {
                    valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric ? " kg" : " lbs") + " 1RM";
                  }
                  return <div key={exId} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: S.s8,
                    paddingBottom: 5,
                    borderBottom: "1px solid rgba(45,42,36,.15)"
                  }}><span style={{
                      fontSize: FS.fs90,
                      flexShrink: 0
                    }}>{icon}</span><span style={{
                      fontSize: FS.md,
                      color: "#b4ac9e",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}>{name}</span><span style={{
                      fontSize: FS.fs68,
                      color: "#b4ac9e",
                      fontWeight: 600,
                      flexShrink: 0,
                      fontFamily: "'Inter',sans-serif"
                    }}>{"🏆 "}{valDisp}</span></div>;
                })}</div>}</div>;
          })()

          /* ── PHYSICAL STATS — Final Fantasy XIV character panel style ── */}<div className={"profile-section"}><div className={"profile-rune-divider"} style={{
              margin: "0 0 10px"
            }}><span className={"profile-rune-label"}>{`⠿ ${cls.name} Data ⠿`}</span></div><div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "7px 16px"
            }}>{[["⚖️ Weight", profile.weightLbs ? isMetric(profile.units) ? lbsToKg(profile.weightLbs) + " kg" : profile.weightLbs + " lbs" : "—"], ["📏 Height", totalH > 0 ? isMetric(profile.units) ? ftInToCm(profile.heightFt, profile.heightIn) + " cm" : `${profile.heightFt}'${profile.heightIn}"` : "—"], ["🧬 BMI", bmi || "—"], ["🎂 Age", profile.age || "—"], ["⚡ Units", isMetric(profile.units) ? "Metric" : "Imperial"], ["👤 Gender", profile.gender || "—"], ["📍 State", profile.state || "—"], ["🌍 Country", profile.country || "—"]].map(([label, val]) => <div key={label} style={{
                display: "flex",
                alignItems: "baseline",
                gap: S.s6,
                paddingBottom: 5,
                borderBottom: "1px solid rgba(45,42,36,.15)"
              }}><span style={{
                  fontSize: FS.sm,
                  color: "#8a8478",
                  width: 72,
                  flexShrink: 0
                }}>{label}</span><span style={{
                  fontSize: FS.fs74,
                  color: "#b4ac9e",
                  fontFamily: "'Inter',sans-serif"
                }}>{val}</span></div>)}</div></div>

          {
            /* ── ABOUT YOU ── */
          }{(profile.sportsBackground || []).length > 0 || profile.trainingStyle || profile.fitnessPriorities?.length > 0 || profile.disciplineTrait || profile.motto ? <div className={"profile-section"}><div className={"profile-rune-divider"} style={{
              margin: "0 0 10px"
            }}><span className={"profile-rune-label"}>{"⠿ About You ⠿"}</span></div>{profile.motto && <div style={{
              fontSize: FS.fs76,
              color: "#b4ac9e",
              fontStyle: "italic",
              marginBottom: S.s8,
              textAlign: "center"
            }}>{`"${profile.motto}"`}</div>}{profile.disciplineTrait && <div style={{
              marginBottom: S.s8
            }}><span style={{
                fontSize: FS.sm,
                color: "#8a8478",
                display: "block",
                marginBottom: S.s4
              }}>{"Discipline Trait"}</span><span className={"trait"} style={{
                "--cls-color": cls.color,
                "--cls-glow": cls.glow
              }}>{profile.disciplineTrait}</span></div>}{profile.trainingStyle && <div style={{
              display: "flex",
              alignItems: "baseline",
              gap: S.s6,
              paddingBottom: 5,
              borderBottom: "1px solid rgba(45,42,36,.15)",
              marginBottom: S.s6
            }}><span style={{
                fontSize: FS.sm,
                color: "#8a8478",
                width: 90,
                flexShrink: 0
              }}>{"Training Style"}</span><span style={{
                fontSize: FS.fs74,
                color: "#b4ac9e"
              }}>{{
                  heavy: "Heavy Compounds",
                  cardio: "Cardio & Endurance",
                  sculpt: "Sculpting & Aesthetics",
                  hiit: "HIIT & Explosive",
                  mindful: "Mindful Movement",
                  sport: "Sport-Specific",
                  mixed: "Mixed Training"
                }[profile.trainingStyle] || profile.trainingStyle}</span></div>}{(profile.fitnessPriorities || []).length > 0 && <div style={{
              marginBottom: S.s6
            }}><div style={{
                fontSize: FS.sm,
                color: "#8a8478",
                marginBottom: S.s4
              }}>{"Fitness Priorities"}</div><div>{(profile.fitnessPriorities || []).map(p => <span key={p} className={"trait"} style={{
                  "--cls-color": "#8a8478",
                  "--cls-glow": "#8a8478",
                  marginRight: S.s4
                }}>{{
                    be_strong: "💪 Being Strong",
                    look_strong: "🪞 Looking Strong",
                    feel_good: "🌿 Feeling Good",
                    eat_right: "🥗 Eating Right",
                    mental_clarity: "🧠 Mental Clarity",
                    athletic_perf: "🏅 Athletic Perf",
                    endurance: "🔥 Endurance",
                    longevity: "🕊️ Longevity",
                    competition: "🏆 Competition",
                    social: "👥 Social",
                    flexibility: "🤸 Mobility",
                    weight_loss: "⚖️ Weight Mgmt"
                  }[p] || p}</span>)}</div></div>}{(profile.sportsBackground || []).filter(s => s !== "none").length > 0 && <div><div style={{
                fontSize: FS.sm,
                color: "#8a8478",
                marginBottom: S.s4
              }}>{"Sports Background"}</div><div>{(profile.sportsBackground || []).filter(s => s !== "none").map(s => <span key={s} className={"trait"} style={{
                  "--cls-color": "#8a8478",
                  "--cls-glow": "#8a8478",
                  marginRight: S.s4,
                  fontSize: FS.fs65
                }}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>)}</div></div>}</div> : null}</div>

        /* ── PROFILE EDIT ─────────────────────── */}{activeTab === "profile" && editMode && <><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s12
          }}><div className={"sec"} style={{
              margin: 0,
              border: "none",
              padding: S.s0
            }}>{"✎ Edit Profile"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setEditMode(false)}>{"✕ Cancel"}</button></div><div className={"edit-panel"} style={{
            "--cls-color": cls.color,
            "--cls-glow": cls.glow
          }}><div><div className={"profile-rune-divider"} style={{
                margin: "0 0 10px"
              }}><span className={"profile-rune-label"}>{"⠿ Identity ⠿"}</span></div><div className={"field"}><label>{"Display Name"}</label><input className={"inp"} value={draft.playerName || ""} onChange={e => setDraft(d => ({
                  ...d,
                  playerName: e.target.value
                }))} placeholder={"Your warrior name\u2026"} /></div><div style={{
                display: "flex",
                gap: S.s10,
                marginBottom: S.s2
              }}><div className={"field"} style={{
                  flex: 1
                }}><label>{"First Name"}</label><input className={"inp"} value={draft.firstName || ""} onChange={e => setDraft(d => ({
                    ...d,
                    firstName: e.target.value
                  }))} placeholder={"First name"} /></div><div className={"field"} style={{
                  flex: 1
                }}><label>{"Last Name"}</label><input className={"inp"} value={draft.lastName || ""} onChange={e => setDraft(d => ({
                    ...d,
                    lastName: e.target.value
                  }))} placeholder={"Last name"} /></div></div><div className={"sec"} style={{
                fontSize: FS.fs68,
                marginBottom: S.s8,
                marginTop: S.s4
              }}>{"Class"}</div><div className={"cls-mini-grid"}>{Object.entries(CLASSES).map(([key, c]) => <div key={key} className={`cls-mini ${draft.chosenClass === key ? "sel" : ""}`} style={{
                  "--bc": c.color,
                  opacity: c.locked ? 0.35 : 1,
                  cursor: c.locked ? "not-allowed" : "pointer"
                }} onClick={() => {
                  if (!c.locked) setDraft(d => ({
                    ...d,
                    chosenClass: key
                  }));
                }}><div className={"cls-mini-icon"} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}><ClassIcon classKey={key} size={18} color={c.glow} /></div><span className={"cls-mini-name"}>{c.locked ? "🔒" : c.name}</span></div>)}</div></div>

            {
              /* ── UNITS ── */
            }<div><div className={"profile-rune-divider"} style={{
                margin: "0 0 10px"
              }}><span className={"profile-rune-label"}>{"⠿ Measurement Units ⠿"}</span></div><div className={"units-toggle"}><div className={`units-opt ${(draft.units || "imperial") === "imperial" ? "on" : ""}`} onClick={() => {
                  const cur = draft.units || "imperial";
                  if (cur === "metric") {
                    const wBack = draft._dispWeight ? parseFloat(kgToLbs(draft._dispWeight)).toFixed(1) : "";
                    const htCm = draft._dispHeightCm;
                    let hFt = "",
                      hIn = "";
                    if (htCm) {
                      const c = cmToFtIn(htCm);
                      hFt = String(c.ft);
                      hIn = String(c.inch);
                    }
                    setDraft(d => ({
                      ...d,
                      units: "imperial",
                      weightLbs: wBack,
                      _dispWeight: "",
                      _dispHeightCm: "",
                      heightFt: hFt,
                      heightIn: hIn
                    }));
                  }
                }}>{"🇺🇸 Imperial"}</div><div className={`units-opt ${(draft.units || "imperial") === "metric" ? "on" : ""}`} onClick={() => {
                  const cur = draft.units || "imperial";
                  if (cur === "imperial") {
                    const wKg = draft.weightLbs ? lbsToKg(draft.weightLbs) : "";
                    const hCm = ftInToCm(draft.heightFt, draft.heightIn) || "";
                    setDraft(d => ({
                      ...d,
                      units: "metric",
                      _dispWeight: wKg,
                      _dispHeightCm: String(hCm)
                    }));
                  }
                }}>{"🌍 Metric"}</div></div></div>

            {
              /* ── BODY STATS ── */
            }<div><div className={"profile-rune-divider"} style={{
                margin: "0 0 10px"
              }}><span className={"profile-rune-label"}>{"⠿ Body Stats ⠿"}</span></div>{(draft.units || "imperial") === "imperial" ? <><div className={"r2"}><div className={"field"}><label>{"Weight (lbs)"}</label><input className={"inp"} type={"number"} min={"50"} max={"600"} placeholder={"185"} value={draft.weightLbs || ""} onChange={e => setDraft(d => ({
                      ...d,
                      weightLbs: e.target.value
                    }))} /></div><div className={"field"}><label>{"Age"}</label><input className={"inp"} type={"number"} min={"10"} max={"100"} placeholder={"30"} value={draft.age || ""} onChange={e => setDraft(d => ({
                      ...d,
                      age: e.target.value
                    }))} /></div></div><div className={"field"}><label>{"Height (ft / in)"}</label><div style={{
                    display: "flex",
                    gap: S.s6
                  }}><input className={"inp"} type={"number"} min={"3"} max={"8"} placeholder={"5"} style={{
                      width: "50%"
                    }} value={draft.heightFt || ""} onChange={e => setDraft(d => ({
                      ...d,
                      heightFt: e.target.value
                    }))} /><input className={"inp"} type={"number"} min={"0"} max={"11"} placeholder={"11"} style={{
                      width: "50%"
                    }} value={draft.heightIn || ""} onChange={e => setDraft(d => ({
                      ...d,
                      heightIn: e.target.value
                    }))} /></div></div>{(() => {
                  const ph = (parseInt(draft.heightFt) || 0) * 12 + (parseInt(draft.heightIn) || 0);
                  const pb = calcBMI(draft.weightLbs, ph);
                  return pb ? <div style={{
                    fontSize: FS.md,
                    color: "#8a8478",
                    fontStyle: "italic",
                    marginTop: S.sNeg6
                  }}>{"BMI: "}<span style={{
                      color: "#b4ac9e"
                    }}>{pb}</span></div> : null;
                })()}</> : <><div className={"r2"}><div className={"field"}><label>{"Weight (kg)"}</label><input className={"inp"} type={"number"} min={"20"} max={"300"} step={"0.1"} placeholder={"84"} value={draft._dispWeight || ""} onChange={e => setDraft(d => ({
                      ...d,
                      _dispWeight: e.target.value
                    }))} /></div><div className={"field"}><label>{"Age"}</label><input className={"inp"} type={"number"} min={"10"} max={"100"} placeholder={"30"} value={draft.age || ""} onChange={e => setDraft(d => ({
                      ...d,
                      age: e.target.value
                    }))} /></div></div><div className={"field"}><label>{"Height (cm)"}</label><input className={"inp"} type={"number"} min={"100"} max={"250"} placeholder={"178"} value={draft._dispHeightCm || ""} onChange={e => setDraft(d => ({
                    ...d,
                    _dispHeightCm: e.target.value
                  }))} /></div>{draft._dispWeight && <div style={{
                  fontSize: FS.md,
                  color: "#8a8478",
                  fontStyle: "italic",
                  marginTop: S.sNeg6
                }}>{draft._dispWeight}{" kg = "}{parseFloat(kgToLbs(draft._dispWeight)).toFixed(1)}{" lbs"}</div>}</>}<div style={{
                marginTop: S.s10,
                padding: "8px 12px",
                background: "rgba(45,42,36,.18)",
                border: "1px solid rgba(180,172,158,.05)",
                borderRadius: R.xl
              }}><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478",
                  marginBottom: S.s8,
                  letterSpacing: ".04em",
                  textTransform: "uppercase"
                }}>{"Show on Hero Banner"}</div><div style={{
                  display: "flex",
                  gap: S.s6,
                  flexWrap: "wrap"
                }}>{[{
                    key: "weight",
                    label: "Weight"
                  }, {
                    key: "height",
                    label: "Height"
                  }, {
                    key: "bmi",
                    label: "BMI"
                  }].map(f => {
                    const on = (draft.hudFields || {})[f.key];
                    return <button key={f.key} className={`gender-btn ${on ? "sel" : ""}`} style={{
                      fontSize: FS.fs68
                    }} onClick={() => setDraft(d => ({
                      ...d,
                      hudFields: {
                        ...(d.hudFields || {}),
                        [f.key]: !on
                      }
                    }))}>{(on ? "✓ " : "") + f.label}</button>;
                  })}</div><div style={{
                  fontSize: FS.sm,
                  color: "#8a8478",
                  marginTop: S.s6,
                  fontStyle: "italic"
                }}>{"Selected fields appear under your name in the main header"}</div></div><div className={"field"}><label>{"Gender "}<span style={{
                    fontSize: FS.fs55,
                    opacity: .6
                  }}>{"(optional)"}</span></label><div style={{
                  display: "flex",
                  gap: S.s6,
                  flexWrap: "wrap"
                }}>{["Male", "Female", "Prefer not to say"].map(g => <button key={g} className={`gender-btn ${draft.gender === g ? "sel" : ""}`} onClick={() => setDraft(d => ({
                    ...d,
                    gender: d.gender === g ? "" : g
                  }))}>{g}</button>)}<button className={`gender-btn ${draft.gender && !["Male", "Female", "Prefer not to say"].includes(draft.gender) ? "sel" : ""}`} onClick={() => {
                    const v = window.prompt("Enter your gender identity:", "");
                    if (v && v.trim()) setDraft(d => ({
                      ...d,
                      gender: v.trim()
                    }));
                  }}>{draft.gender && !["Male", "Female", "Prefer not to say"].includes(draft.gender) ? draft.gender : "Not Listed"}</button></div>{draft.gender && <div style={{
                  fontSize: FS.fs62,
                  color: "#b4ac9e",
                  marginTop: S.s4
                }}>{"Selected: "}{draft.gender}</div>}</div></div>

            {
              /* ── PREFERENCES ── */
            }<div><div className={"profile-rune-divider"} style={{
                margin: "0 0 10px"
              }}><span className={"profile-rune-label"}>{"⠿ Preferences ⠿"}</span></div><div className={"field"}><label>{"Home Gym"}</label><input className={"inp"} placeholder={"Planet Fitness, Gold's Gym, Home…"} value={draft.gym || ""} onChange={e => setDraft(d => ({
                  ...d,
                  gym: e.target.value
                }))} /></div><div style={{
                display: "flex",
                gap: S.s8
              }}><div className={"field"} style={{
                  flex: 1
                }}><label>{"State"}</label><select className={"inp"} value={draft.state || ""} onChange={e => setDraft(d => ({
                    ...d,
                    state: e.target.value
                  }))} style={{
                    cursor: "pointer"
                  }}><option value={""}>{"Select State"}</option>{["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"].map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className={"field"} style={{
                  flex: 1
                }}><label>{"Country"}</label><select className={"inp"} value={draft.country || "United States"} onChange={e => setDraft(d => ({
                    ...d,
                    country: e.target.value
                  }))} style={{
                    cursor: "pointer"
                  }}>{["United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Mexico", "Brazil", "India", "Japan", "South Korea", "Philippines", "Other"].map(c => <option key={c} value={c}>{c}</option>)}</select></div></div><div className={"field"}><label>{"Running PB "}<span style={{
                    fontSize: FS.fs55,
                    opacity: .6
                  }}>{"("}{isMetric(draft.units || "imperial") ? "min/km" : "min/mi"}{")"}</span></label><input className={"inp"} type={"number"} min={"3"} max={"20"} step={"0.1"} placeholder={isMetric(draft.units || "imperial") ? "e.g. 5.2" : "e.g. 8.5"} value={draft.runningPB || ""} onChange={e => setDraft(d => ({
                  ...d,
                  runningPB: e.target.value ? parseFloat(e.target.value) : ""
                }))} /></div></div>

            {
              /* ── ABOUT YOU ── */
            }<div><div className={"profile-rune-divider"} style={{
                margin: "0 0 10px"
              }}><span className={"profile-rune-label"}>{"⠿ About You ⠿"}</span></div><div className={"field"}><label>{"Personal Motto "}<span style={{
                    fontSize: FS.fs55,
                    opacity: .6
                  }}>{"(optional)"}</span></label><input className={"inp"} placeholder={"Your battle cry…"} value={draft.motto || ""} onChange={e => setDraft(d => ({
                  ...d,
                  motto: e.target.value
                }))} /></div><div className={"field"}><label>{"Training Style"}</label><div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: S.s6,
                  marginTop: S.s4
                }}>{[{
                    val: "heavy",
                    label: "Heavy Lifts"
                  }, {
                    val: "cardio",
                    label: "Cardio"
                  }, {
                    val: "sculpt",
                    label: "Sculpting"
                  }, {
                    val: "hiit",
                    label: "HIIT"
                  }, {
                    val: "mindful",
                    label: "Mindful"
                  }, {
                    val: "sport",
                    label: "Sport"
                  }, {
                    val: "mixed",
                    label: "Mixed"
                  }].map(o => <button key={o.val} className={`gender-btn ${(draft.trainingStyle || "") === o.val ? "sel" : ""}`} onClick={() => setDraft(d => ({
                    ...d,
                    trainingStyle: d.trainingStyle === o.val ? "" : o.val
                  }))}>{o.label}</button>)}</div></div><div className={"field"}><label>{"Workout Timing"}</label><div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: S.s6,
                  marginTop: S.s4
                }}>{[{
                    val: "earlymorning",
                    label: "⚡ Early AM"
                  }, {
                    val: "morning",
                    label: "☀️ Morning"
                  }, {
                    val: "afternoon",
                    label: "Afternoon"
                  }, {
                    val: "evening",
                    label: "🌙 Evening"
                  }, {
                    val: "varies",
                    label: "Varies"
                  }].map(o => <button key={o.val} className={`gender-btn ${(draft.workoutTiming || "") === o.val ? "sel" : ""}`} onClick={() => setDraft(d => ({
                    ...d,
                    workoutTiming: d.workoutTiming === o.val ? "" : o.val
                  }))}>{o.label}</button>)}</div></div><div className={"field"}><label>{"Fitness Priorities "}<span style={{
                    fontSize: FS.fs55,
                    opacity: .6
                  }}>{"(pick up to 3)"}</span></label><div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: S.s4,
                  marginTop: S.s4
                }}>{[{
                    val: "be_strong",
                    label: "💪 Strong"
                  }, {
                    val: "look_strong",
                    label: "🪞 Look Strong"
                  }, {
                    val: "feel_good",
                    label: "🌿 Feel Good"
                  }, {
                    val: "eat_right",
                    label: "🥗 Nutrition"
                  }, {
                    val: "mental_clarity",
                    label: "🧠 Clarity"
                  }, {
                    val: "athletic_perf",
                    label: "🏅 Performance"
                  }, {
                    val: "endurance",
                    label: "🔥 Endurance"
                  }, {
                    val: "longevity",
                    label: "🕊️ Longevity"
                  }, {
                    val: "competition",
                    label: "🏆 Compete"
                  }, {
                    val: "social",
                    label: "👥 Social"
                  }, {
                    val: "flexibility",
                    label: "🤸 Mobility"
                  }, {
                    val: "weight_loss",
                    label: "⚖️ Weight"
                  }].map(o => {
                    const active = (draft.fitnessPriorities || []).includes(o.val);
                    return <button key={o.val} className={`gender-btn ${active ? "sel" : ""}`} onClick={() => setDraft(d => {
                      const p = d.fitnessPriorities || [];
                      return {
                        ...d,
                        fitnessPriorities: active ? p.filter(x => x !== o.val) : p.length < 3 ? [...p, o.val] : p
                      };
                    })}>{o.label}</button>;
                  })}</div></div><div className={"field"}><label>{"Sports Background"}</label><div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: S.s4,
                  marginTop: S.s4
                }}>{["Football", "Basketball", "Soccer", "Running", "Cycling", "Swimming", "Boxing", "MMA", "Wrestling", "CrossFit", "Powerlifting", "Bodybuilding", "Yoga", "Hiking", "Gymnastics", "Golf", "Triathlon", "Rowing", "Volleyball", "Tennis", "Dance"].map(s => {
                    const v = s.toLowerCase().replace(/ /g, "_");
                    const active = (draft.sportsBackground || []).includes(v);
                    return <button key={v} className={`gender-btn ${active ? "sel" : ""}`} style={{
                      fontSize: FS.fs62
                    }} onClick={() => setDraft(d => {
                      const b = d.sportsBackground || [];
                      return {
                        ...d,
                        sportsBackground: active ? b.filter(x => x !== v) : [...b, v]
                      };
                    })}>{s}</button>;
                  })}</div></div></div><button className={"btn btn-gold"} style={{
              width: "100%"
            }} onClick={saveEdit}>{"⚔️ Save Profile"}</button></div></>

        /* ── SECURITY SETTINGS ─────────────────── */}{activeTab === "profile" && securityMode && <><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s12
          }}><div className={"sec"} style={{
              margin: 0,
              border: "none",
              padding: S.s0
            }}>{"🔒 Security Settings"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => guardRecoveryCodes(() => {
              setSecurityMode(false);
              setPwMsg(null);
              setPwNew("");
              setPwConfirm("");
              setPwPanelOpen(false);
              setShowEmail(false);
              setEmailPanelOpen(false);
              setEmailMsg(null);
              setNewEmail("");
              setMfaPanelOpen(false);
              setMfaMsg(null);
              setMfaEnrolling(false);
              setMfaQR(null);
              setMfaCode("");
            })}>{"✕"}</button></div>

          {
            /* ═══ Email Verification Status (with Show/Hide) ═══ */
          }{authUser && <div style={{
            background: "rgba(45,42,36,.18)",
            border: "1px solid rgba(45,42,36,.2)",
            borderRadius: R.r10,
            padding: "10px 14px",
            marginBottom: S.s12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: S.s8
          }}><div style={{
              display: "flex",
              alignItems: "center",
              gap: S.s8,
              flex: 1,
              minWidth: 0
            }}><span style={{
                fontSize: FS.fs90
              }}>{"✉️"}</span><div style={{
                flex: 1,
                minWidth: 0
              }}><div style={{
                  fontSize: FS.fs58,
                  color: "#8a8478",
                  marginBottom: S.s2
                }}>{"Email"}</div><div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: S.s8,
                  flexWrap: "wrap"
                }}><div style={{
                    fontSize: FS.fs76,
                    color: "#b4ac9e",
                    wordBreak: "break-all"
                  }}>{showEmail ? authUser.email : (() => {
                      const parts = authUser.email.split("@");
                      const local = parts[0] || "";
                      const domain = parts[1] || "";
                      return "\u2022".repeat(Math.min(local.length, 8)) + "@" + domain;
                    })()}</div><span style={{
                    fontSize: FS.fs58,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    flexShrink: 0,
                    userSelect: "none",
                    textDecoration: "underline"
                  }} onClick={() => setShowEmail(s => !s)}>{showEmail ? "Hide" : "Show"}</span></div></div></div><span style={{
              fontSize: FS.fs56,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: R.r10,
              background: authUser.email_confirmed_at ? "#1a2e1a" : "#2e1515",
              color: authUser.email_confirmed_at ? "#7ebf73" : UI_COLORS.danger
            }}>{authUser.email_confirmed_at ? "\u2713 Verified" : "Unverified"}</span></div>

          /* ═══ Account IDs ═══ */}<div style={{
            background: "rgba(45,42,36,.12)",
            border: "1px solid rgba(45,42,36,.15)",
            borderRadius: R.r10,
            padding: "10px 14px",
            marginBottom: S.s12
          }}><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: S.s8
            }}><div><div style={{
                  fontSize: FS.fs58,
                  color: "#8a8478",
                  marginBottom: S.s2
                }}>{"Public Account ID"}</div><div style={{
                  fontSize: FS.fs82,
                  color: "#d4cec4",
                  fontWeight: 700,
                  fontFamily: "'Inter',monospace",
                  letterSpacing: ".06em"
                }}>{myPublicId ? "#" + myPublicId : "\u2026"}</div></div><div style={{
                display: "flex",
                gap: S.s6,
                alignItems: "center"
              }}><span style={{
                  fontSize: FS.fs52,
                  color: "#8a8478",
                  fontStyle: "italic"
                }}>{"Share to add friends"}</span>{myPublicId && <span style={{
                  fontSize: FS.fs58,
                  color: "#b4ac9e",
                  cursor: "pointer",
                  textDecoration: "underline",
                  userSelect: "none"
                }} onClick={() => {
                  navigator.clipboard.writeText("#" + myPublicId).then(() => showToast("Account ID copied!"));
                }}>{"Copy"}</span>}</div></div>
            {
              /* Private Account ID */
            }<div style={{
              borderTop: "1px solid rgba(180,172,158,.04)",
              paddingTop: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}><div><div style={{
                  fontSize: FS.fs58,
                  color: "#8a8478",
                  marginBottom: S.s2
                }}>{"Private Account ID"}</div><div style={{
                  fontSize: FS.fs76,
                  color: showPrivateId ? "#b4ac9e" : "#8a8478",
                  fontFamily: "'Inter',monospace",
                  letterSpacing: ".04em"
                }}>{showPrivateId ? myPrivateId || "\u2026" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}</div></div><div style={{
                display: "flex",
                gap: S.s6,
                alignItems: "center"
              }}><span style={{
                  fontSize: FS.fs52,
                  color: "#8a8478",
                  fontStyle: "italic"
                }}>{"For account recovery only"}</span><span style={{
                  fontSize: FS.fs58,
                  color: "#b4ac9e",
                  cursor: "pointer",
                  textDecoration: "underline",
                  userSelect: "none"
                }} onClick={() => setShowPrivateId(s => !s)}>{showPrivateId ? "Hide" : "Show"}</span></div></div></div>

          {
            /* ═══ CHANGE EMAIL — collapsible ═══ */
          }<div className={"edit-panel"} style={{
            marginBottom: S.s12,
            padding: S.s0,
            overflow: "hidden"
          }}><div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              cursor: "pointer"
            }} onClick={() => {
              setEmailPanelOpen(s => !s);
              if (emailPanelOpen) {
                setNewEmail("");
                setEmailMsg(null);
              }
            }}><label style={{
                margin: 0,
                cursor: "pointer"
              }}>{"📧 Change Email Address"}</label><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                gap: S.s4
              }}>{emailPanelOpen ? "Collapse" : "Expand"}<svg width={"12"} height={"12"} viewBox={"0 0 14 14"} fill={"none"} style={{
                  transition: "transform .2s",
                  transform: emailPanelOpen ? "rotate(180deg)" : "rotate(0deg)"
                }}><defs><linearGradient id={"cgEm"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cgEm)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></span></div>{emailPanelOpen && <div style={{
              padding: "0 14px 14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: S.s10,
              borderTop: "1px solid rgba(45,42,36,.2)"
            }}><div style={{
                fontSize: FS.fs64,
                color: "#8a8478",
                marginTop: S.s10,
                fontStyle: "italic"
              }}>{"A confirmation will be sent to both your current and new email. You’ll need to confirm both to complete the change."}</div><div className={"field"}><label style={{
                  margin: 0
                }}>{"New Email Address"}</label><input className={"inp"} type={"email"} value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder={"new@email.com"} onKeyDown={e => {
                  if (e.key === "Enter") changeEmailAddress();
                }} /></div>{emailMsg && <div style={{
                fontSize: FS.lg,
                color: emailMsg.ok ? UI_COLORS.success : UI_COLORS.danger,
                textAlign: "center",
                padding: "6px 8px",
                borderRadius: R.md
              }}>{emailMsg.text}</div>}<button className={"btn btn-ghost btn-sm"} style={{
                width: "100%"
              }} onClick={changeEmailAddress} disabled={!newEmail.trim()}>{"📧 Update Email"}</button></div>}</div>

          {
            /* ═══ MFA (TOTP) — collapsible ═══ */
          }<div className={"edit-panel"} style={{
            marginBottom: S.s12,
            padding: S.s0,
            overflow: "hidden"
          }}><div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              cursor: "pointer"
            }} onClick={() => guardRecoveryCodes(() => {
              setMfaPanelOpen(s => !s);
              if (mfaPanelOpen) {
                setMfaMsg(null);
                setMfaEnrolling(false);
                setMfaQR(null);
                setMfaCode("");
              }
            })}><label style={{
                margin: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: S.s8
              }}>{"🛡️ Multi-Factor Authentication"}{mfaEnabled && <span style={{
                  fontSize: FS.fs56,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: R.r10,
                  background: "#1a2e1a",
                  color: "#7ebf73"
                }}>{"Active"}</span>}</label><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                gap: S.s4
              }}>{mfaPanelOpen ? "Collapse" : "Expand"}<svg width={"12"} height={"12"} viewBox={"0 0 14 14"} fill={"none"} style={{
                  transition: "transform .2s",
                  transform: mfaPanelOpen ? "rotate(180deg)" : "rotate(0deg)"
                }}><defs><linearGradient id={"cgMf"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cgMf)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></span></div>{mfaPanelOpen && <div style={{
              padding: "0 14px 14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: S.s10,
              borderTop: "1px solid rgba(45,42,36,.2)"
            }}>{!mfaEnabled && !mfaEnrolling && !mfaRecoveryCodes && <div style={{
                marginTop: S.s10
              }}><div style={{
                  fontSize: FS.fs64,
                  color: "#8a8478",
                  marginBottom: S.s10,
                  fontStyle: "italic"
                }}>{"Add an extra layer of protection to your account using an authenticator app."}</div><div style={{
                  fontSize: FS.fs58,
                  color: "#8a8478",
                  marginBottom: S.s12,
                  background: "rgba(45,42,36,.15)",
                  border: "1px solid rgba(45,42,36,.2)",
                  borderRadius: R.lg,
                  padding: "8px 10px"
                }}><div style={{
                    fontWeight: 600,
                    color: "#8a8478",
                    marginBottom: S.s4
                  }}>{"Compatible apps:"}</div>{"Google Authenticator · Authy · 1Password · Microsoft Authenticator · Duo · Bitwarden · Aegis · or any TOTP-compatible app"}</div><button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%"
                }} onClick={startMfaEnroll}>{"🛡️ Set Up MFA"}</button></div>

              /* MFA enrollment in progress — show QR */}{mfaEnrolling && mfaQR && <div style={{
                marginTop: S.s10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: S.s10
              }}><div style={{
                  fontSize: FS.fs64,
                  color: "#8a8478",
                  textAlign: "center",
                  fontStyle: "italic"
                }}>{"Scan this QR code with your authenticator app, then enter the 6-digit code below to confirm."}</div><div style={{
                  background: "#fff",
                  borderRadius: R.r10,
                  padding: S.s10,
                  display: "inline-block"
                }}><img src={mfaQR} alt={"MFA QR Code"} style={{
                    width: 160,
                    height: 160,
                    display: "block"
                  }} /></div>{mfaSecret && <div style={{
                  fontSize: FS.fs56,
                  color: "#8a8478",
                  textAlign: "center",
                  wordBreak: "break-all",
                  background: "rgba(45,42,36,.2)",
                  padding: "6px 10px",
                  borderRadius: R.md,
                  border: "1px solid rgba(45,42,36,.2)"
                }}>{"Manual key: "}<span style={{
                    color: "#b4ac9e",
                    fontFamily: "monospace",
                    letterSpacing: ".04em"
                  }}>{mfaSecret}</span></div>}<div className={"field"} style={{
                  width: "100%"
                }}><label style={{
                    margin: 0
                  }}>{"Verification Code"}</label><input className={"inp"} type={"text"} inputMode={"numeric"} maxLength={6} value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, ""))} placeholder={"000000"} style={{
                    textAlign: "center",
                    letterSpacing: ".2em",
                    fontSize: FS.fs90
                  }} onKeyDown={e => {
                    if (e.key === "Enter") verifyMfaEnroll();
                  }} /></div><button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%"
                }} onClick={verifyMfaEnroll} disabled={mfaCode.length < 6}>{"✓ Verify & Activate"}</button><button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%",
                  color: "#8a8478",
                  borderColor: "rgba(45,42,36,.2)"
                }} onClick={() => {
                  setMfaEnrolling(false);
                  setMfaQR(null);
                  setMfaSecret(null);
                  setMfaCode("");
                  setMfaMsg(null);
                }}>{"Cancel"}</button></div>

              /* Recovery codes display — shown once after enrollment or regeneration */}{mfaRecoveryCodes && <div style={{
                marginTop: S.s10
              }}><div style={{
                  fontSize: FS.fs68,
                  color: "#d4cec4",
                  fontWeight: 700,
                  marginBottom: S.s6
                }}>{"🔑 Recovery Codes"}</div><div style={{
                  fontSize: FS.fs62,
                  color: UI_COLORS.danger,
                  marginBottom: S.s10,
                  fontWeight: 600
                }}>{"⚠ Save these codes now — they will NOT be shown again!"}</div><div style={{
                  fontSize: FS.fs64,
                  color: "#8a8478",
                  marginBottom: S.s10,
                  fontStyle: "italic"
                }}>{"If you lose access to your authenticator app, use one of these codes to log in. Each code can only be used once."}</div><div style={{
                  background: "rgba(45,42,36,.25)",
                  border: "1px solid rgba(45,42,36,.25)",
                  borderRadius: R.lg,
                  padding: "10px 14px",
                  fontFamily: "monospace",
                  fontSize: FS.lg,
                  color: "#b4ac9e",
                  lineHeight: 2,
                  letterSpacing: ".05em",
                  textAlign: "center"
                }}>{mfaRecoveryCodes.map((c, i) => <div key={i}>{c}</div>)}</div><div style={{
                  display: "flex",
                  gap: S.s6,
                  marginTop: S.s10
                }}><button className={"btn btn-ghost btn-sm"} style={{
                    flex: 1
                  }} onClick={() => {
                    const text = mfaRecoveryCodes.join("\n");
                    navigator.clipboard.writeText(text).then(() => showToast("\u2713 Codes copied to clipboard")).catch(() => {});
                  }}>{"📋 Copy All"}</button><button className={"btn btn-ghost btn-sm"} style={{
                    flex: 1
                  }} onClick={() => {
                    const blob = new Blob(["Aurisar \u2014 MFA Recovery Codes\n" + "Generated: " + new Date().toLocaleString() + "\n\n" + mfaRecoveryCodes.join("\n") + "\n\nEach code can only be used once.\nStore these somewhere safe.\n"], {
                      type: "text/plain"
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "aurisar-recovery-codes.txt";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>{"⬇ Download .txt"}</button></div><button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%",
                  marginTop: S.s6
                }} onClick={() => setMfaRecoveryCodes(null)}>{"✓ I’ve saved my codes"}</button></div>

              /* MFA IS enabled — show status, codes remaining, and disable option */}{mfaEnabled && !mfaRecoveryCodes && !mfaDisableConfirm && <div style={{
                marginTop: S.s10
              }}><div style={{
                  fontSize: FS.fs64,
                  color: "#8a8478",
                  marginBottom: S.s10,
                  fontStyle: "italic"
                }}>{"MFA is active on your account. You’ll need a verification code from your authenticator app each time you sign in."}</div>

                {
                  /* Recovery codes remaining */
                }<div style={{
                  background: "rgba(45,42,36,.15)",
                  border: "1px solid rgba(45,42,36,.2)",
                  borderRadius: R.lg,
                  padding: "10px 14px",
                  marginBottom: S.s10
                }}><div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: S.s6
                  }}><span style={{
                      fontSize: FS.fs64,
                      color: "#8a8478",
                      fontWeight: 600
                    }}>{"🔑 Recovery Codes"}</span>{mfaCodesRemaining !== null && <span style={{
                      fontSize: FS.fs62,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: R.r10,
                      background: mfaCodesRemaining > 3 ? "#1a2e1a" : mfaCodesRemaining > 0 ? "#2e2010" : "#2e1515",
                      color: mfaCodesRemaining > 3 ? "#7ebf73" : mfaCodesRemaining > 0 ? "#d4943a" : UI_COLORS.danger
                    }}>{mfaCodesRemaining + " remaining"}</span>}</div>{mfaCodesRemaining !== null && mfaCodesRemaining <= 3 && <div style={{
                    fontSize: FS.fs58,
                    color: mfaCodesRemaining === 0 ? UI_COLORS.danger : "#d4943a",
                    marginBottom: S.s6
                  }}>{mfaCodesRemaining === 0 ? "\u26A0 No recovery codes left! Regenerate now to avoid being locked out." : "\u26A0 Running low \u2014 consider regenerating your codes."}</div>}{mfaHasLegacyCodes && <div style={{
                    fontSize: FS.fs58,
                    color: "#d4943a",
                    marginBottom: S.s6
                  }}>{"⚠ Your recovery codes use a legacy hash format. Regenerate them for stronger protection — your old codes still work until you do."}</div>}<button className={"btn btn-ghost btn-sm"} style={{
                    width: "100%",
                    fontSize: FS.sm
                  }} onClick={regenerateRecoveryCodes}>{"↻ Regenerate Recovery Codes"}</button></div>

                {
                  /* Compatible apps reminder */
                }<div style={{
                  fontSize: FS.fs56,
                  color: "#8a8478",
                  marginBottom: S.s12,
                  fontStyle: "italic"
                }}>{"Works with: Google Authenticator · Authy · 1Password · Microsoft Authenticator · and any TOTP app"}</div><button className={"btn btn-danger"} style={{
                  width: "100%"
                }} onClick={unenrollMfa}>{"🗑 Disable MFA"}</button></div>

              /* MFA DISABLE CONFIRMATION — requires TOTP verification */}{mfaDisableConfirm && <div style={{
                marginTop: S.s10
              }}><div style={{
                  fontSize: FS.fs68,
                  color: UI_COLORS.danger,
                  fontWeight: 700,
                  marginBottom: S.s8
                }}>{"⚠ Confirm MFA Disable"}</div><div style={{
                  fontSize: FS.fs64,
                  color: "#8a8478",
                  marginBottom: S.s12,
                  fontStyle: "italic"
                }}>{"Enter your current authenticator code to confirm you want to disable MFA."}</div><div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: S.s8
                }}><input className={"inp"} type={"text"} inputMode={"numeric"} maxLength={6} value={mfaDisableCode} onChange={e => setMfaDisableCode(e.target.value.replace(/\D/g, ""))} placeholder={"000000"} style={{
                    textAlign: "center",
                    letterSpacing: ".2em",
                    fontSize: FS.fs90
                  }} onKeyDown={e => {
                    if (e.key === "Enter") confirmMfaDisableWithTotp();
                  }} /><button className={"btn btn-danger"} style={{
                    width: "100%"
                  }} onClick={confirmMfaDisableWithTotp} disabled={mfaUnenrolling || mfaDisableCode.length < 6}>{mfaUnenrolling ? "Verifying\u2026" : "Confirm & Disable MFA"}</button></div>{mfaDisableMsg && <div style={{
                  fontSize: FS.lg,
                  color: mfaDisableMsg.ok ? UI_COLORS.success : UI_COLORS.danger,
                  textAlign: "center",
                  padding: "6px 8px",
                  borderRadius: R.md,
                  marginTop: S.s4
                }}>{mfaDisableMsg.text}</div>

                /* Cancel */}<button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%",
                  marginTop: S.s6,
                  color: "#8a8478"
                }} onClick={() => {
                  setMfaDisableConfirm(false);
                  setMfaDisableCode("");
                  setMfaDisableMsg(null);
                }}>{"Cancel"}</button></div>}{mfaMsg && <div style={{
                fontSize: FS.lg,
                color: mfaMsg.ok ? UI_COLORS.success : UI_COLORS.danger,
                textAlign: "center",
                padding: "6px 8px",
                borderRadius: R.md
              }}>{mfaMsg.text}</div>}</div>}</div>

          {
            /* ═══ Phone Number — collapsible ═══ */
          }<div className={"edit-panel"} style={{
            marginBottom: S.s12,
            padding: S.s0,
            overflow: "hidden"
          }}><div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              cursor: "pointer"
            }} onClick={() => {
              setPhonePanelOpen(s => !s);
              if (phonePanelOpen) {
                setPhoneMsg(null);
                setPhoneOtpSent(false);
                setPhoneOtpCode("");
              }
            }}><label style={{
                margin: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: S.s8
              }}>{"📱 Phone Number (optional)"}{profile.phone && profile.phoneVerified && <span style={{
                  fontSize: FS.fs56,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: R.r10,
                  background: "#1a2e1a",
                  color: "#7ebf73"
                }}>{"Verified"}</span>}</label><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                gap: S.s4
              }}>{phonePanelOpen ? "Collapse" : "Expand"}<svg width={"12"} height={"12"} viewBox={"0 0 14 14"} fill={"none"} style={{
                  transition: "transform .2s",
                  transform: phonePanelOpen ? "rotate(180deg)" : "rotate(0deg)"
                }}><defs><linearGradient id={"cgPh"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cgPh)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></span></div>{phonePanelOpen && <div style={{
              padding: "0 14px 14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: S.s10,
              borderTop: "1px solid rgba(45,42,36,.2)"
            }}>{profile.phone && <div style={{
                marginTop: S.s10
              }}><div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: S.s8
                }}><div><div style={{
                      fontSize: FS.sm,
                      color: "#8a8478",
                      marginBottom: S.s2
                    }}>{"Phone on file"}</div><div style={{
                      fontSize: FS.fs78,
                      color: "#b4ac9e",
                      fontFamily: "monospace"
                    }}>{profile.phone}</div></div><span style={{
                    fontSize: FS.fs56,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: R.r10,
                    background: "#1a2e1a",
                    color: "#7ebf73"
                  }}>{"✓ Saved"}</span></div><div style={{
                  fontSize: FS.fs58,
                  color: "#8a8478",
                  marginBottom: S.s8,
                  fontStyle: "italic"
                }}>{"On file for admin identity verification if you ever need account support."}</div><button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%",
                  fontSize: FS.sm,
                  color: UI_COLORS.danger,
                  borderColor: "rgba(231,76,60,.2)"
                }} onClick={removePhone}>{"Remove Phone"}</button></div>

              /* If no phone — add one */}{!profile.phone && <div style={{
                marginTop: S.s10
              }}><div style={{
                  fontSize: FS.fs64,
                  color: "#8a8478",
                  marginBottom: S.s10,
                  fontStyle: "italic"
                }}>{"Optionally add a phone number for admin identity verification if you ever need account support. Format: country code + number (e.g. +12145551234)."}</div><div className={"field"}><label style={{
                    margin: 0
                  }}>{"Phone Number"}</label><input className={"inp"} type={"tel"} value={phoneInput} onChange={e => setPhoneInput(e.target.value)} placeholder={"+12145551234"} onKeyDown={e => {
                    if (e.key === "Enter" && phoneInput.trim()) {
                      setProfile(p => ({
                        ...p,
                        phone: phoneInput.trim()
                      }));
                      setPhoneInput("");
                      setPhoneMsg({
                        ok: true,
                        text: "\u2713 Phone number saved."
                      });
                    }
                  }} /></div><button className={"btn btn-ghost btn-sm"} style={{
                  width: "100%"
                }} onClick={() => {
                  if (!phoneInput.trim()) {
                    setPhoneMsg({
                      ok: false,
                      text: "Enter a phone number."
                    });
                    return;
                  }
                  setProfile(p => ({
                    ...p,
                    phone: phoneInput.trim()
                  }));
                  setPhoneInput("");
                  setPhoneMsg({
                    ok: true,
                    text: "\u2713 Phone number saved."
                  });
                }} disabled={!phoneInput.trim()}>{"📱 Save Phone Number"}</button></div>}{phoneMsg && <div style={{
                fontSize: FS.lg,
                color: phoneMsg.ok ? UI_COLORS.success : UI_COLORS.danger,
                textAlign: "center",
                padding: "6px 8px",
                borderRadius: R.md
              }}>{phoneMsg.text}</div>}</div>}</div>

          {
            /* ═══ Set / Change Password — collapsible ═══ */
          }<div className={"edit-panel"} style={{
            marginBottom: S.s12,
            padding: S.s0,
            overflow: "hidden"
          }}><div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              cursor: "pointer"
            }} onClick={() => {
              setPwPanelOpen(s => !s);
              if (pwPanelOpen) {
                setPwNew("");
                setPwConfirm("");
                setPwMsg(null);
              }
            }}><label style={{
                margin: 0,
                cursor: "pointer"
              }}>{"🔑 Set / Change Password"}</label><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                gap: S.s4
              }}>{pwPanelOpen ? "Collapse" : "Expand"}<svg width={"12"} height={"12"} viewBox={"0 0 14 14"} fill={"none"} style={{
                  transition: "transform .2s",
                  transform: pwPanelOpen ? "rotate(180deg)" : "rotate(0deg)"
                }}><defs><linearGradient id={"cgPw"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs><polyline points={"3,5 7,9 11,5"} stroke={"url(#cgPw)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></span></div>{pwPanelOpen && <div style={{
              padding: "0 14px 14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: S.s10,
              borderTop: "1px solid rgba(45,42,36,.2)"
            }}><div className={"field"} style={{
                marginTop: S.s10
              }}><div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: S.s4
                }}><label style={{
                    margin: 0
                  }}>{"New Password"}</label><span style={{
                    fontSize: FS.fs62,
                    color: "#b4ac9e",
                    cursor: "pointer",
                    userSelect: "none"
                  }} onClick={() => setShowPwProfile(s => !s)}>{showPwProfile ? "\uD83D\uDE48 Hide" : "\uD83D\uDC41 Show"}</span></div><input className={"inp"} type={showPwProfile ? "text" : "password"} value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} /></div><div className={"field"}><label>{"Confirm Password"}</label><input className={"inp"} type={showPwProfile ? "text" : "password"} value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} onKeyDown={e => {
                  if (e.key === "Enter") changePassword();
                }} /></div>{pwMsg && <div style={{
                fontSize: FS.lg,
                color: pwMsg.ok === true ? UI_COLORS.success : pwMsg.ok === false ? UI_COLORS.danger : "#b4ac9e",
                textAlign: "center",
                padding: "6px 8px",
                background: pwMsg.ok === null ? "rgba(45,42,36,.16)" : "transparent",
                borderRadius: R.md,
                border: pwMsg.ok === null ? "1px solid rgba(180,172,158,.06)" : "none"
              }}>{pwMsg.text}</div>}<button className={"btn btn-ghost btn-sm"} style={{
                width: "100%"
              }} onClick={changePassword} disabled={!pwNew || !pwConfirm}>{"🔑 Save Password"}</button></div>}</div><div className={"div"} />

          {
            /* Wipe & Rebuild */
          }<div style={{
            marginBottom: S.s6
          }}><div style={{
              fontSize: FS.fs68,
              color: "#8a8478",
              marginBottom: S.s8,
              fontStyle: "italic"
            }}>{"Permanently erase all XP, log, plans, and workouts. Cannot be undone."}</div><button className={"btn btn-danger"} style={{
              width: "100%"
            }} onClick={resetChar}>{"↺ Wipe & Rebuild"}</button></div></>

        /* ── NOTIFICATION PREFERENCES ─────────────────── */}{activeTab === "profile" && notifMode && <><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s12
          }}><div className={"sec"} style={{
              margin: 0,
              border: "none",
              padding: S.s0
            }}>{"🔔 Notification Preferences"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setNotifMode(false)}>{"✕"}</button></div><div style={{
            fontSize: FS.fs64,
            color: "#8a8478",
            marginBottom: S.s14,
            fontStyle: "italic"
          }}>{"Choose which email notifications you’d like to receive from Aurisar."}</div>{(() => {
            const prefs = profile.notificationPrefs || {};
            const items = [{
              key: "sharedWorkout",
              icon: "📋",
              label: "Shared Workouts",
              desc: "When a friend shares a workout with you"
            }, {
              key: "friendLevelUp",
              icon: "⬆️",
              label: "Friend Level Ups",
              desc: "When one of your friends levels up"
            }, {
              key: "friendExercise",
              icon: "🏋️",
              label: "Friend Exercises",
              desc: "In-app banner when a friend completes an exercise"
            }, {
              key: "friendRequest",
              icon: "🤝",
              label: "Friend Requests",
              desc: "When someone sends you a friend request"
            }, {
              key: "friendAccepted",
              icon: "✅",
              label: "Request Accepted",
              desc: "When someone accepts your friend request"
            }, {
              key: "messageReceived",
              icon: "💬",
              label: "New Messages",
              desc: "Email me when I receive a new direct message",
              defaultOff: true
            }, {
              key: "reviewBattleStats",
              icon: "📊",
              label: "Review Battle Stats",
              desc: "Remind me to input Duration, Total Calories & Active Calories for each completed Workout or Exercise"
            }];
            return <div style={{
              display: "flex",
              flexDirection: "column",
              gap: S.s8
            }}>{items.map(item => {
                const isOn = item.defaultOff ? prefs[item.key] === true : prefs[item.key] !== false;
                return <div key={item.key} className={"profile-notif-row"} style={{
                  cursor: "pointer",
                  borderColor: isOn ? "rgba(46,204,113,.18)" : "rgba(180,172,158,.05)"
                }} onClick={() => toggleNotifPref(item.key)}><span style={{
                    fontSize: "1.1rem",
                    flexShrink: 0
                  }}>{item.icon}</span><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div style={{
                      fontSize: FS.fs76,
                      color: "#d4cec4",
                      fontWeight: 600
                    }}>{item.label}</div><div style={{
                      fontSize: FS.sm,
                      color: "#8a8478",
                      marginTop: S.s2
                    }}>{item.desc}</div></div>
                  {
                    /* Toggle switch */
                  }<div style={{
                    width: 40,
                    height: 22,
                    borderRadius: R.r11,
                    background: isOn ? "rgba(46,204,113,.25)" : "rgba(45,42,36,.35)",
                    border: "1px solid " + (isOn ? "rgba(46,204,113,.35)" : "rgba(180,172,158,.08)"),
                    position: "relative",
                    transition: "all .2s",
                    flexShrink: 0
                  }}><div style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: isOn ? UI_COLORS.success : "#8a8478",
                      position: "absolute",
                      top: 2,
                      left: isOn ? 21 : 2,
                      transition: "all .2s",
                      boxShadow: isOn ? "0 0 6px rgba(46,204,113,.4)" : "none"
                    }} /></div></div>;
              })}</div>;
          })()}<div style={{
            fontSize: FS.fs56,
            color: "#8a8478",
            marginTop: S.s16,
            fontStyle: "italic",
            textAlign: "center"
          }}>{"Changes save automatically. Email notifications require a verified email address."}</div></>}</div> {
        /* scroll-area */
      }</div>

    /* ══ EXERCISE EDITOR MODAL ══════════════════ */}{exEditorOpen && exEditorDraft && createPortal((() => {
      try {
        const ed = exEditorDraft;
        const setEd = patch => setExEditorDraft(d => ({
          ...d,
          ...patch
        }));
        const isCardioED = ed.category === "cardio";
        const isFlexED = ed.category === "flexibility";
        const hasWeightED = !isCardioED && !isFlexED;
        const metric = isMetric(profile.units);
        const wUnit = weightLabel(profile.units);
        const dUnit = distLabel(profile.units);
        const age = profile.age || 30;
        return createPortal(<div className={"ex-editor-backdrop"} onClick={() => setExEditorOpen(false)}><div className={"ex-editor-sheet"} onClick={e => e.stopPropagation()} style={{
            "--mg-color": getMuscleColor(ed.muscleGroup || "chest")
          }}><div className={"ex-editor-hdr"}><div><div className={"ex-editor-title"}>{exEditorMode === "edit" ? "✎ Edit Technique" : exEditorMode === "copy" ? "⎘ Copy Technique" : "⚔ Forge Technique"}</div><div className={"ex-editor-subtitle"}>{exEditorMode === "edit" ? "Sharpen your custom technique" : "Forge a new technique for your grimoire"}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setExEditorOpen(false)}>{"✕"}</button></div><div className={"ex-editor-body"}>{exEditorMode !== "edit" && <div className={"field"}><label>{"Start from existing exercise (optional)"}</label><select className={"inp"} style={{
                  appearance: "auto",
                  cursor: "pointer"
                }} onChange={e => {
                  if (!e.target.value) return;
                  const base = allExById[e.target.value];
                  if (base) setExEditorDraft(newExDraft(base));
                }} defaultValue={""}><option value={""}>{"— Start from scratch —"}</option>{["strength", "cardio", "flexibility", "endurance"].map(cat => <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>{allExercises.filter(ex => ex.category === cat).map(ex => <option key={ex.id} value={ex.id}>{ex.icon}{" "}{ex.name}</option>)}</optgroup>)}</select></div>

              /* Name + Icon row */}<div style={{
                display: "flex",
                gap: S.s8
              }}><div className={"field"} style={{
                  flex: 1
                }}><label>{"Exercise Name"}</label><input className={"inp"} value={ed.name || ""} onChange={e => setEd({
                    name: e.target.value
                  })} placeholder={"e.g. Cable Fly"} /></div><div className={"field"} style={{
                  width: 70
                }}><label>{"Icon"}</label><div className={"inp"} style={{
                    textAlign: "center",
                    fontSize: "1.4rem",
                    padding: "5px 0",
                    cursor: "default"
                  }}>{ed.icon || "💪"}</div></div></div>

              {
                /* Icon grid */
              }<div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: S.s6,
                marginBottom: S.s4
              }}>{EX_ICON_LIST.map(ic => <div key={ic} onClick={() => setEd({
                  icon: ic
                })} style={{
                  width: 34,
                  height: 34,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.15rem",
                  cursor: "pointer",
                  borderRadius: R.r7,
                  border: `1px solid ${ed.icon === ic ? "rgba(180,172,158,.2)" : "rgba(45,42,36,.22)"}`,
                  background: ed.icon === ic ? "rgba(45,42,36,.25)" : "rgba(45,42,36,.12)",
                  transition: "all .15s"
                }}>{ic}</div>)}</div>

              {
                /* Category */
              }<div className={"field"}><label>{"Category"}</label><div style={{
                  display: "flex",
                  gap: S.s6
                }}>{["strength", "cardio", "flexibility", "endurance"].map(cat => <button key={cat} className={`btn btn-sm ${ed.category === cat ? "btn-gold" : "btn-ghost"}`} style={{
                    flex: 1,
                    textTransform: "capitalize",
                    fontSize: FS.fs58,
                    padding: "6px 2px"
                  }} onClick={() => setEd({
                    category: cat
                  })}>{cat}</button>)}</div></div>

              {
                /* Muscle Group */
              }<div className={"field"}><label>{"Muscle Group"}</label><div style={{
                  display: "flex",
                  gap: S.s4,
                  flexWrap: "wrap"
                }}>{["chest", "back", "shoulder", "bicep", "tricep", "forearm", "legs", "glutes", "calves", "abs"].map(mg => <button key={mg} className={`btn btn-sm ${ed.muscleGroup === mg ? "btn-gold" : "btn-ghost"}`} style={{
                    textTransform: "capitalize",
                    fontSize: FS.fs54,
                    padding: "4px 8px"
                  }} onClick={() => setEd({
                    muscleGroup: mg
                  })}>{mg}</button>)}</div></div>

              {
                /* Base XP */
              }<div className={"field"}><label>{"Base XP per session "}<span style={{
                    fontSize: FS.sm,
                    color: "#8a8478",
                    fontStyle: "italic"
                  }}>{"— typical: 20–80"}</span></label><input className={"inp"} type={"number"} min={"1"} max={"500"} value={ed.baseXP || 40} onChange={e => setEd({
                  baseXP: parseInt(e.target.value) || 1
                })} /></div>

              {
                /* ── Default Workout Values ───────────────── */
              }<div className={"ex-editor-section"}><div className={"ex-editor-section-title"}>{"Default Values When Logging"}</div><div style={{
                  fontSize: FS.fs63,
                  color: "#8a8478",
                  marginTop: S.sNeg6,
                  fontStyle: "italic"
                }}>{"Pre-filled each time you log this exercise"}</div>

                {
                  /* Sets + Reps/Duration */
                }<div className={"r2"}><div className={"field"}><label>{"Default Sets"}</label><input className={"inp"} type={"number"} min={"0"} max={"20"} value={ed.defaultSets != null ? ed.defaultSets : ""} placeholder={"0"} onChange={e => {
                      const v = e.target.value;
                      setEd({
                        defaultSets: v === "" ? null : parseInt(v)
                      });
                    }} /></div><div className={"field"}><label>{"Default "}{isCardioED || isFlexED ? "Duration (min)" : "Reps"}</label><input className={"inp"} type={"number"} min={"0"} max={"300"} value={ed.defaultReps != null ? ed.defaultReps : ""} placeholder={"0"} onChange={e => {
                      const v = e.target.value;
                      setEd({
                        defaultReps: v === "" ? null : parseInt(v)
                      });
                    }} /></div></div>

                {
                  /* Weight — strength/endurance only */
                }{hasWeightED && <><div className={"r2"}><div className={"field"}><label>{"Default Base Weight ("}{wUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={ed.defaultWeightLbs ? metric ? lbsToKg(ed.defaultWeightLbs) : ed.defaultWeightLbs : ""} onChange={e => {
                        const v = e.target.value;
                        const lbs = v && metric ? kgToLbs(v) : v;
                        setEd({
                          defaultWeightLbs: lbs || ""
                        });
                      }} placeholder={metric ? "60" : "135"} /></div><div className={"field"}><label>{"Default Intensity %"}</label><input className={"inp"} type={"number"} min={"50"} max={"200"} step={"5"} value={ed.defaultWeightPct || 100} onChange={e => setEd({
                        defaultWeightPct: parseInt(e.target.value) || 100
                      })} /></div></div><div><input type={"range"} className={"pct-slider"} min={"0"} max={"100"} step={"5"} value={pctToSlider(ed.defaultWeightPct || 100)} onChange={e => setEd({
                      defaultWeightPct: sliderToPct(Number(e.target.value))
                    })} /><div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: FS.fs56,
                      color: "#8a8478",
                      marginTop: S.s2
                    }}><span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span></div></div></>

                /* Distance — cardio only */}{isCardioED && <div className={"field"}><label>{"Default Distance ("}{dUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} max={"200"} step={"0.1"} value={ed.defaultDistanceMi ? metric ? miToKm(ed.defaultDistanceMi) : ed.defaultDistanceMi : ""} onChange={e => {
                    const v = e.target.value;
                    const mi = v && metric ? kmToMi(v) : v;
                    setEd({
                      defaultDistanceMi: mi || ""
                    });
                  }} placeholder={metric ? "5.0" : "3.1"} /></div>

                /* HR Zone — cardio only */}{isCardioED && <div className={"field"}><label>{"Default Heart Rate Zone "}{profile.age ? `(Age ${profile.age})` : ""}</label><div className={"hr-zone-row"}>{HR_ZONES.map(z => {
                      const range = hrRange(age, z);
                      const sel = (ed.defaultHrZone || null) === z.z;
                      return <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
                        "--zc": z.color,
                        borderColor: sel ? z.color : "rgba(45,42,36,.2)",
                        background: sel ? `${z.color}22` : "rgba(45,42,36,.12)"
                      }} onClick={() => setEd({
                        defaultHrZone: sel ? null : z.z
                      })}><span className={"hz-name"} style={{
                          color: sel ? z.color : "#8a8478"
                        }}>{"Z"}{z.z}{" "}{z.name}</span><span className={"hz-bpm"} style={{
                          color: sel ? z.color : "#8a8478"
                        }}>{range.lo}{"–"}{range.hi}</span></div>;
                    })}</div>{!profile.age && <div style={{
                    fontSize: FS.sm,
                    color: "#8a8478",
                    marginTop: S.s4
                  }}>{"Set your age in Profile for accurate BPM ranges"}</div>}</div>}</div>

              {
                /* ── Exercise Details (optional) ─────── */
              }<div className={"ex-editor-section-title"} style={{
                marginTop: S.s4
              }}>{"✦ Exercise Details (optional)"}</div>

              {
                /* Muscles */
              }<div className={"field"}><label>{"Target Muscles"}</label><input className={"inp"} value={ed.muscles || ""} onChange={e => setEd({
                  muscles: e.target.value
                })} placeholder={"e.g. Chest · Front Deltoids · Triceps"} /></div>

              {
                /* Description */
              }<div className={"field"}><label>{"Description"}</label><textarea className={"inp"} rows={3} value={ed.desc || ""} onChange={e => setEd({
                  desc: e.target.value
                })} placeholder={"How to perform this exercise, key cues…"} style={{
                  resize: "vertical",
                  minHeight: 70,
                  fontFamily: "'Inter',sans-serif",
                  lineHeight: 1.5
                }} /></div>

              {
                /* Tips */
              }<div className={"field"}><label>{"Form Tips (up to 3)"}</label>{[0, 1, 2].map(ti => <input key={ti} className={"inp"} style={{
                  marginBottom: S.s6
                }} value={(ed.tips || ["", "", ""])[ti] || ""} onChange={e => {
                  const t = [...(ed.tips || ["", "", ""])];
                  t[ti] = e.target.value;
                  setEd({
                    tips: t
                  });
                }} placeholder={`Tip ${ti + 1}…`} />)}</div>

              {
                /* ── Action Buttons ─────────────────── */
              }<div className={"div"} /><div style={{
                display: "flex",
                gap: S.s8
              }}><button className={"btn btn-ghost btn-sm"} style={{
                  flex: 1
                }} onClick={() => setExEditorOpen(false)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
                  flex: 2
                }} onClick={saveExEditor}>{exEditorMode === "edit" ? "✦ Save Changes" : "⚔ Forge Technique"}</button></div>{exEditorMode === "edit" && <button className={"btn btn-ghost btn-sm"} style={{
                width: "100%",
                marginTop: S.s6
              }} onClick={() => openExEditor("copy", ed)}>{"⎘ Duplicate as New Exercise"}</button>}{exEditorMode === "edit" && <button className={"btn btn-danger"} style={{
                width: "100%",
                marginTop: S.s8,
                padding: "10px",
                fontSize: FS.fs78
              }} onClick={() => deleteCustomEx(ed.id)}>{"🗑 Delete Exercise"}</button>}</div></div></div>, document.body);
      } catch (e) {
        console.error("Exercise editor render error:", e);
        return null;
      }
    })(), document.body)

    /* ══ EXERCISE DETAIL MODAL ══════════════════ */}{detailEx && createPortal(<div className={"modal-backdrop"} onClick={() => setDetailEx(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()}><div className={"modal-img-row"}>{detailEx.images.map((src, i) => <img key={i} src={`${src}?w=420&h=260&fit=crop&q=80`} alt={detailEx.name} className={"modal-img"} onError={e => {
            e.target.style.display = "none";
            e.target.nextSibling && (e.target.nextSibling.style.display = "flex");
          }} />)
          /* Fallback placeholders hidden by default */}{detailEx.images.map((_, i) => <div key={`fb${i}`} className={"modal-img-placeholder"} style={{
            display: "none"
          }}>{detailEx.icon}</div>)}</div>
        {
          /* Body */
        }<div className={"modal-body"}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s2
          }}><div className={"modal-title"}>{detailEx.icon}{" "}{detailEx.name}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setDetailEx(null)}>{"✕"}</button></div><div className={"modal-muscles"}>{detailEx.muscles}</div><p className={"modal-desc"}>{detailEx.desc}</p><div className={"sec"}>{"Form Tips"}</div><div className={"modal-tips"}>{detailEx.tips.map((tip, i) => <div key={i} className={"modal-tip"}>{tip}</div>)}</div><div className={"div"} /><div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: S.s8
          }}><div style={{
              display: "flex",
              gap: S.s8,
              flexWrap: "wrap"
            }}><span style={{
                fontSize: FS.md,
                color: "#8a8478"
              }}>{"Base XP: "}<span style={{
                  color: "#b4ac9e",
                  fontFamily: "'Inter',sans-serif"
                }}>{detailEx.baseXP}</span></span><span style={{
                fontSize: FS.md,
                color: "#8a8478"
              }}>{"Category: "}<span style={{
                  color: "#b4ac9e",
                  textTransform: "capitalize"
                }}>{detailEx.category}</span></span>{cls && <span style={{
                fontSize: FS.md,
                color: "#8a8478"
              }}>{"Mult: "}<span style={{
                  color: getMult(detailEx) > 1.02 ? UI_COLORS.success : getMult(detailEx) < 0.98 ? UI_COLORS.danger : "#b4ac9e"
                }}>{Math.round(getMult(detailEx) * 100)}{"%"}</span></span>}</div><div /></div></div></div></div>, document.body)

    /* ══ SAVE-TO-PLAN WIZARD ════════════════════ */}{savePlanWizard && createPortal(<div className={"spw-backdrop"} onClick={e => {
      if (e.target === e.currentTarget) setSavePlanWizard(null);
    }}><div className={"spw-sheet"} role={"dialog"} aria-modal={"true"} aria-label={"Save plan"}><div className={"spw-hdr"}><div><div className={"spw-title"}>{"📋 Save To Plan"}</div><div style={{
              fontSize: FS.fs65,
              color: "#8a8478",
              marginTop: S.s2
            }}>{"Select exercises, then create a new plan or add to an existing one."}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setSavePlanWizard(null)}>{"✕"}</button></div><div className={"spw-body"}><div><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: S.s8
            }}><label>{"Exercises ("}{spwSelected.length}{"/"}{savePlanWizard.entries.length}{" selected)"}</label><div style={{
                display: "flex",
                gap: S.s6
              }}><button className={"btn btn-ghost btn-xs"} onClick={() => setSpwSelected(savePlanWizard.entries.map(e => e._idx))}>{"All"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => setSpwSelected([])}>{"None"}</button></div></div><div className={"spw-ex-list"}>{savePlanWizard.entries.map(e => {
                const sel = spwSelected.includes(e._idx);
                return <div key={e._idx} className={`spw-ex-row ${sel ? "sel" : ""}`} onClick={() => setSpwSelected(s => sel ? s.filter(i => i !== e._idx) : [...s, e._idx])}><div className={"spw-check"}>{sel ? "✓" : ""}</div><span className={"spw-ex-icon"}>{e.icon}</span><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div className={"spw-ex-name"}>{e.exercise}</div><div className={"spw-ex-meta"}>{e.sets}{"×"}{e.reps}{e.weightLbs ? " · " + (isMetric(profile.units) ? lbsToKg(e.weightLbs) + " kg" : e.weightLbs + " lbs") : ""}{"  +"}{e.xp}{" XP"}</div></div></div>;
              })}</div></div>

          {
            /* Mode toggle */
          }<div style={{
            display: "flex",
            borderRadius: R.xl,
            overflow: "hidden",
            border: "1px solid rgba(180,172,158,.06)"
          }}>{[["new", "＋ New Plan"], ["existing", "Add to Existing"]].map(([m, lbl]) => <button key={m} style={{
              flex: 1,
              padding: "8px 4px",
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs62,
              letterSpacing: ".03em",
              cursor: "pointer",
              border: "none",
              borderRight: m === "new" ? "1px solid rgba(180,172,158,.05)" : "none",
              background: spwMode === m ? "rgba(45,42,36,.3)" : "rgba(45,42,36,.18)",
              color: spwMode === m ? "#d4cec4" : "#8a8478",
              transition: "all .18s"
            }} onClick={() => setSpwMode(m)}>{lbl}</button>)}</div>

          {
            /* NEW PLAN fields */
          }{spwMode === "new" && <><div className={"field"}><label>{"Plan Name"}</label><input className={"inp"} value={spwName} onChange={e => setSpwName(e.target.value)} placeholder={"Name your plan…"} /></div><div className={"field"}><label>{"Icon"}</label><div className={"icon-row"} style={{
                flexWrap: "wrap",
                gap: S.s6
              }}>{["📋", "⚔️", "🏋️", "🔥", "💪", "🏃", "🚴", "🧘", "⚡", "🎯", "🛡️", "🏆", "🌟", "💥", "🗡️"].map(ic => <div key={ic} className={`icon-opt ${spwIcon === ic ? "sel" : ""}`} style={{
                  fontSize: "1.2rem",
                  width: 36,
                  height: 36
                }} onClick={() => setSpwIcon(ic)}>{ic}</div>)}</div></div><div className={"field"}><label>{"Schedule for a Future Date "}<span style={{
                  color: "#8a8478",
                  fontWeight: "normal"
                }}>{"(optional)"}</span></label><input className={"inp"} type={"date"} min={todayStr()} value={spwDate} onChange={e => setSpwDate(e.target.value)} />{spwDate && <div style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                marginTop: S.s4
              }}>{"📅 "}{formatScheduledDate(spwDate)}{" · "}{(() => {
                  const d = daysUntil(spwDate);
                  return d === 0 ? "Today" : d === 1 ? "Tomorrow" : d + " days from now";
                })()}</div>}</div></>

          /* EXISTING PLAN picker */}{spwMode === "existing" && <>{profile.plans.length === 0 ? <div className={"empty"} style={{
              padding: "14px 0"
            }}>{"No plans yet — create one first!"}</div> : profile.plans.map(pl => <div key={pl.id} className={"atp-plan-row"} style={{
              borderColor: spwTargetPlanId === pl.id ? "rgba(180,172,158,.15)" : "rgba(45,42,36,.22)",
              background: spwTargetPlanId === pl.id ? "rgba(45,42,36,.2)" : "rgba(45,42,36,.12)"
            }} onClick={() => setSpwTargetPlanId(pl.id)}><span style={{
                fontSize: "1.3rem"
              }}>{pl.icon}</span><div style={{
                flex: 1,
                minWidth: 0
              }}><div style={{
                  fontFamily: "'Inter',sans-serif",
                  fontSize: FS.lg,
                  color: "#d4cec4"
                }}>{pl.name}</div><div style={{
                  fontSize: FS.sm,
                  color: "#8a8478"
                }}>{pl.days.length}{" day"}{pl.days.length !== 1 ? "s" : ""}{" · "}{pl.days.reduce((s, d) => s + d.exercises.length, 0)}{" exercises"}</div></div><div style={{
                width: 18,
                height: 18,
                border: "1.5px solid rgba(180,172,158,.08)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: FS.md,
                flexShrink: 0,
                background: spwTargetPlanId === pl.id ? "rgba(180,172,158,.25)" : "transparent",
                color: spwTargetPlanId === pl.id ? "#1a1200" : "transparent"
              }}>{"✓"}</div></div>)}</>}<div className={"div"} /><div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => setSavePlanWizard(null)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
              flex: 2
            }} onClick={confirmSavePlanWizard}>{spwMode === "existing" ? "📋 Add to Plan" : "💾 Save New Plan"}{spwMode === "new" && spwDate ? " & Schedule" : ""}</button></div></div></div></div>, document.body)

    /* ══ SCHEDULE PICKER ════════════════════════ */}{schedulePicker && createPortal(<div className={"sched-backdrop"} onClick={() => setSchedulePicker(null)}><div className={"sched-sheet"} onClick={e => e.stopPropagation()}><div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}><div className={"sched-title"}>{"📅 Schedule Workout"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setSchedulePicker(null)}>{"✕"}</button></div>

        {
          /* Target card */
        }<div className={"sched-target"}><div className={"sched-target-icon"}>{schedulePicker.type === "plan" ? schedulePicker.plan.icon : schedulePicker.icon}</div><div><div className={"sched-target-name"}>{schedulePicker.type === "plan" ? schedulePicker.plan.name : schedulePicker.name}</div><div className={"sched-target-type"}>{schedulePicker.type === "plan" ? "Workout Plan" : "Exercise"}</div></div></div>

        {
          /* Date picker */
        }<div className={"field"}><label>{"Scheduled Date"}</label><input className={"inp"} type={"date"} min={todayStr()} value={spDate} onChange={e => setSpDate(e.target.value)} />{spDate && <div style={{
            fontSize: FS.fs65,
            color: "#b4ac9e",
            marginTop: S.s4
          }}>{(() => {
              const d = daysUntil(spDate);
              return d === 0 ? "Today — let's go! 🔥" : d === 1 ? "Tomorrow ⚡" : d + " days from now";
            })()}{" — "}{formatScheduledDate(spDate)}</div>}</div>

        {
          /* Notes */
        }<div className={"field"}><label>{"Notes "}<span style={{
              color: "#8a8478",
              fontWeight: "normal"
            }}>{"(optional)"}</span></label><input className={"inp"} value={spNotes} onChange={e => setSpNotes(e.target.value)} placeholder={"e.g. Morning session, skip leg day…"} /></div>

        {
          /* If there's already a schedule, offer to clear it */
        }{schedulePicker.type === "plan" && schedulePicker.plan.scheduledDate && <div style={{
          fontSize: FS.fs65,
          color: "#8a8478",
          fontStyle: "italic"
        }}>{"Currently scheduled: "}{formatScheduledDate(schedulePicker.plan.scheduledDate)}<span className={"upcoming-del"} style={{
            marginLeft: S.s8,
            display: "inline"
          }} onClick={() => {
            removePlanSchedule(schedulePicker.plan.id);
            setSchedulePicker(null);
          }}>{"Clear ✕"}</span></div>}<div style={{
          display: "flex",
          gap: S.s8
        }}><button className={"btn btn-ghost btn-sm"} style={{
            flex: 1
          }} onClick={() => setSchedulePicker(null)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
            flex: 2
          }} onClick={confirmSchedule}>{"📅 Schedule"}</button></div></div></div>, document.body)

    /* ══ SAVE-AS-WORKOUT WIZARD ═════════════════ */}{saveWorkoutWizard && createPortal(<div className={"saw-backdrop"} onClick={() => setSaveWorkoutWizard(null)}><div className={"saw-sheet"} onClick={e => e.stopPropagation()}><div className={"spw-hdr"}><div><div className={"spw-title"}>{"💪 Save As Workout"}</div><div style={{
              fontSize: FS.fs65,
              color: "#8a8478",
              marginTop: S.s2
            }}>{"Select exercises and save as a reusable workout."}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setSaveWorkoutWizard(null)}>{"✕"}</button></div><div className={"spw-body"}><div><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: S.s8
            }}><label>{"Exercises ("}{swwSelected.length}{"/"}{saveWorkoutWizard.entries.length}{" selected)"}</label><div style={{
                display: "flex",
                gap: S.s6
              }}><button className={"btn btn-ghost btn-xs"} onClick={() => setSwwSelected(saveWorkoutWizard.entries.map(e => e._idx))}>{"All"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => setSwwSelected([])}>{"None"}</button></div></div><div className={"spw-ex-list"}>{saveWorkoutWizard.entries.map(e => {
                const sel = swwSelected.includes(e._idx);
                return <div key={e._idx} className={`spw-ex-row ${sel ? "sel" : ""}`} onClick={() => setSwwSelected(s => sel ? s.filter(i => i !== e._idx) : [...s, e._idx])}><div className={"spw-check"}>{sel ? "✓" : ""}</div><span className={"spw-ex-icon"}>{e.icon}</span><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div className={"spw-ex-name"}>{e.exercise}</div><div className={"spw-ex-meta"}>{e.sets}{"×"}{e.reps}{e.weightLbs ? " · " + (isMetric(profile.units) ? lbsToKg(e.weightLbs) + " kg" : e.weightLbs + " lbs") : ""}{"  +"}{e.xp}{" XP"}</div></div></div>;
              })}</div></div>
          {
            /* Workout name */
          }<div className={"field"}><label>{"Workout Name"}</label><input className={"inp"} value={swwName} onChange={e => setSwwName(e.target.value)} placeholder={"Name your workout…"} /></div>
          {
            /* Icon */
          }<div className={"field"}><label>{"Icon"}</label><div className={"icon-row"} style={{
              flexWrap: "wrap",
              gap: S.s6
            }}>{["💪", "🏋️", "🔥", "⚔️", "🏃", "🚴", "🧘", "⚡", "🎯", "🛡️", "🏆", "🌟", "💥", "🗡️", "🥊"].map(ic => <div key={ic} className={`icon-opt ${swwIcon === ic ? "sel" : ""}`} style={{
                fontSize: "1.2rem",
                width: 36,
                height: 36
              }} onClick={() => setSwwIcon(ic)}>{ic}</div>)}</div></div><div className={"div"} /><div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => setSaveWorkoutWizard(null)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
              flex: 2
            }} onClick={confirmSaveWorkoutWizard}>{"💪 Save Workout"}</button></div></div></div></div>, document.body)

    /* ══ WORKOUT EXERCISE PICKER ═════════════════ */}{wbExPickerOpen && createPortal(<div className={"ex-picker-backdrop"} onClick={e => {
      e.stopPropagation();
      if (!pickerConfigOpen) closePicker();
    }}><div className={"ex-picker-sheet"} onClick={e => e.stopPropagation()} style={{
        maxHeight: "85vh"
      }}>{!pickerConfigOpen ? <><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s10
          }}><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.lg,
              fontWeight: 600,
              color: "#8a8478"
            }}>{"Add to Workout"}{pickerSelected.length > 0 && <span style={{
                color: "#b4ac9e",
                marginLeft: S.s6
              }}>{pickerSelected.length + " selected"}</span>}</div><div style={{
              display: "flex",
              gap: S.s6
            }}>{pickerSelected.length > 0 && <button className={"btn btn-gold btn-xs"} onClick={() => setPickerConfigOpen(true)}>{"Configure & Add →"}</button>}<button className={"btn btn-ghost btn-xs"} onClick={() => {
                closePicker();
                openExEditor("create", null);
              }}>{"✦ New Custom"}</button><button className={"btn btn-ghost btn-sm"} onClick={closePicker}>{"✕"}</button></div></div>
          {
            /* Search bar */
          }<div style={{
            marginBottom: S.s8
          }}><input className={"inp"} style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: FS.fs82
            }} placeholder={"Search exercises…"} value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} autoFocus={true} /></div>
          {
            /* Filter dropdowns — mirrors Library */
          }{(() => {
            const PTYPE_LABELS = {
              strength: "⚔️ Strength",
              cardio: "🏃 Cardio",
              flexibility: "🧘 Flex",
              yoga: "🧘 Yoga",
              stretching: "🌿 Stretch",
              plyometric: "⚡ Plyo",
              calisthenics: "🤸 Cali"
            };
            const PTYPE_OPTS = Object.keys(PTYPE_LABELS);
            const PEQUIP_OPTS = ["barbell", "dumbbell", "kettlebell", "cable", "machine", "bodyweight", "band"];
            const PMUSCLE_OPTS = ["chest", "back", "shoulder", "bicep", "tricep", "legs", "glutes", "abs", "calves", "forearm", "cardio"];
            const closeDrops = () => setPickerOpenDrop(null);
            return <div style={{
              position: "relative",
              marginBottom: S.s10
            }}>{pickerOpenDrop && <div onClick={closeDrops} style={{
                position: "fixed",
                inset: 0,
                zIndex: 19
              }} />}<div style={{
                display: "flex",
                gap: S.s8
              }}> {
                  /* Muscle */
                }
                <div style={{
                  position: "relative",
                  flex: 1,
                  zIndex: 20
                }}><button onClick={() => setPickerOpenDrop(d => d === "muscle" ? null : "muscle")} style={{
                    width: "100%",
                    padding: "6px 24px 6px 8px",
                    borderRadius: R.lg,
                    border: "1px solid " + (pickerMuscle !== "All" ? "#b4ac9e" : "rgba(45,42,36,.3)"),
                    background: "rgba(14,14,12,.95)",
                    color: pickerMuscle !== "All" ? "#b4ac9e" : "#8a8478",
                    fontSize: FS.fs68,
                    textAlign: "left",
                    cursor: "pointer",
                    position: "relative"
                  }}>{pickerMuscle === "All" ? "Muscle" : pickerMuscle.charAt(0).toUpperCase() + pickerMuscle.slice(1)}<span style={{
                      position: "absolute",
                      right: 7,
                      top: "50%",
                      transform: "translateY(-50%) rotate(" + (pickerOpenDrop === "muscle" ? "180deg" : "0deg") + ")",
                      fontSize: FS.fs55,
                      color: pickerMuscle !== "All" ? "#b4ac9e" : "#8a8478",
                      transition: "transform .15s"
                    }}>{"▼"}</span></button>{pickerOpenDrop === "muscle" && <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    minWidth: "100%",
                    background: "rgba(16,14,10,.95)",
                    border: "1px solid rgba(180,172,158,.06)",
                    borderRadius: R.lg,
                    padding: "6px 4px",
                    zIndex: 21,
                    boxShadow: "0 8px 24px rgba(0,0,0,.7)"
                  }}><div onClick={() => {
                      setPickerMuscle("All");
                      closeDrops();
                    }} style={{
                      padding: "6px 10px",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      borderRadius: R.r5,
                      color: pickerMuscle === "All" ? "#b4ac9e" : "#8a8478",
                      background: pickerMuscle === "All" ? "rgba(45,42,36,.2)" : "transparent"
                    }}>{"All Muscles"}</div>{PMUSCLE_OPTS.map(m => <div key={m} onClick={() => {
                      setPickerMuscle(m);
                      closeDrops();
                    }} style={{
                      padding: "6px 10px",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      borderRadius: R.r5,
                      color: pickerMuscle === m ? getMuscleColor(m) : "#8a8478",
                      background: pickerMuscle === m ? "rgba(45,42,36,.2)" : "transparent",
                      textTransform: "capitalize"
                    }}>{m}</div>)}</div>}</div> {
                  /* Type */
                }
                <div style={{
                  position: "relative",
                  flex: 1,
                  zIndex: 20
                }}><button onClick={() => setPickerOpenDrop(d => d === "type" ? null : "type")} style={{
                    width: "100%",
                    padding: "6px 24px 6px 8px",
                    borderRadius: R.lg,
                    border: "1px solid " + (pickerTypeFilter !== "all" ? "#d4cec4" : "rgba(45,42,36,.3)"),
                    background: "rgba(14,14,12,.95)",
                    color: pickerTypeFilter !== "all" ? "#d4cec4" : "#8a8478",
                    fontSize: FS.fs68,
                    textAlign: "left",
                    cursor: "pointer",
                    position: "relative"
                  }}>{pickerTypeFilter === "all" ? "Type" : PTYPE_LABELS[pickerTypeFilter] || pickerTypeFilter}<span style={{
                      position: "absolute",
                      right: 7,
                      top: "50%",
                      transform: "translateY(-50%) rotate(" + (pickerOpenDrop === "type" ? "180deg" : "0deg") + ")",
                      fontSize: FS.fs55,
                      color: pickerTypeFilter !== "all" ? "#d4cec4" : "#8a8478",
                      transition: "transform .15s"
                    }}>{"▼"}</span></button>{pickerOpenDrop === "type" && <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    minWidth: "100%",
                    background: "rgba(16,14,10,.95)",
                    border: "1px solid rgba(180,172,158,.06)",
                    borderRadius: R.lg,
                    padding: "6px 4px",
                    zIndex: 21,
                    boxShadow: "0 8px 24px rgba(0,0,0,.7)"
                  }}><div onClick={() => {
                      setPickerTypeFilter("all");
                      closeDrops();
                    }} style={{
                      padding: "6px 10px",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      borderRadius: R.r5,
                      color: pickerTypeFilter === "all" ? "#d4cec4" : "#8a8478",
                      background: pickerTypeFilter === "all" ? "rgba(45,42,36,.2)" : "transparent"
                    }}>{"All Types"}</div>{PTYPE_OPTS.map(t => <div key={t} onClick={() => {
                      setPickerTypeFilter(t);
                      closeDrops();
                    }} style={{
                      padding: "6px 10px",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      borderRadius: R.r5,
                      color: pickerTypeFilter === t ? getTypeColor(t) : "#8a8478",
                      background: pickerTypeFilter === t ? "rgba(45,42,36,.2)" : "transparent"
                    }}>{PTYPE_LABELS[t]}</div>)}</div>}</div> {
                  /* Equipment */
                }
                <div style={{
                  position: "relative",
                  flex: 1,
                  zIndex: 20
                }}><button onClick={() => setPickerOpenDrop(d => d === "equip" ? null : "equip")} style={{
                    width: "100%",
                    padding: "6px 24px 6px 8px",
                    borderRadius: R.lg,
                    border: "1px solid " + (pickerEquipFilter !== "all" ? UI_COLORS.accent : "rgba(45,42,36,.3)"),
                    background: "rgba(14,14,12,.95)",
                    color: pickerEquipFilter !== "all" ? UI_COLORS.accent : "#8a8478",
                    fontSize: FS.fs68,
                    textAlign: "left",
                    cursor: "pointer",
                    position: "relative"
                  }}>{pickerEquipFilter === "all" ? "Equipment" : pickerEquipFilter.charAt(0).toUpperCase() + pickerEquipFilter.slice(1)}<span style={{
                      position: "absolute",
                      right: 7,
                      top: "50%",
                      transform: "translateY(-50%) rotate(" + (pickerOpenDrop === "equip" ? "180deg" : "0deg") + ")",
                      fontSize: FS.fs55,
                      color: pickerEquipFilter !== "all" ? UI_COLORS.accent : "#8a8478",
                      transition: "transform .15s"
                    }}>{"▼"}</span></button>{pickerOpenDrop === "equip" && <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    minWidth: "100%",
                    background: "rgba(16,14,10,.95)",
                    border: "1px solid rgba(180,172,158,.06)",
                    borderRadius: R.lg,
                    padding: "6px 4px",
                    zIndex: 21,
                    boxShadow: "0 8px 24px rgba(0,0,0,.7)"
                  }}><div onClick={() => {
                      setPickerEquipFilter("all");
                      closeDrops();
                    }} style={{
                      padding: "6px 10px",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      borderRadius: R.r5,
                      color: pickerEquipFilter === "all" ? UI_COLORS.accent : "#8a8478",
                      background: pickerEquipFilter === "all" ? "rgba(196,148,40,0.12)" : "transparent"
                    }}>{"All Equipment"}</div>{PEQUIP_OPTS.map(e => <div key={e} onClick={() => {
                      setPickerEquipFilter(e);
                      closeDrops();
                    }} style={{
                      padding: "6px 10px",
                      fontSize: FS.lg,
                      cursor: "pointer",
                      borderRadius: R.r5,
                      color: pickerEquipFilter === e ? UI_COLORS.accent : "#8a8478",
                      background: pickerEquipFilter === e ? "rgba(196,148,40,0.12)" : "transparent",
                      textTransform: "capitalize"
                    }}>{e}</div>)}</div>}</div></div></div>;
          })()
          /* Exercise list — Charcoal Inset */}{(() => {
            const q = pickerSearch.toLowerCase().trim();
            const filtered = allExercises.filter(e => {
              if (e.id === "rest_day") return false; // Rest Day is plan-only
              if (pickerMuscle !== "All" && e.muscleGroup !== pickerMuscle) return false;
              if (pickerTypeFilter !== "all") {
                const ty = (e.exerciseType || "").toLowerCase(),
                  ca = (e.category || "").toLowerCase();
                if (!ty.includes(pickerTypeFilter) && ca !== pickerTypeFilter) return false;
              }
              if (pickerEquipFilter !== "all" && (e.equipment || "bodyweight").toLowerCase() !== pickerEquipFilter) return false;
              if (q && !e.name.toLowerCase().includes(q)) return false;
              return true;
            });
            if (filtered.length === 0) return <div className={"empty"} style={{
              padding: "20px 0"
            }}>{"No exercises found."}</div>;
            const selIds = new Set(pickerSelected.map(e => e.exId));
            return <><div style={{
                fontSize: FS.fs62,
                color: "#8a8478",
                marginBottom: S.s6,
                textAlign: "right"
              }}>{filtered.length + " match" + (filtered.length !== 1 ? "es" : "")}</div>
              {/* Virtualized: rowHeight 60px = .picker-ex-row content (~52px) + 8px slot
                  padding. Previous slice(0,80) cap removed — users can scroll the full
                  filtered list without the explicit limit. See WbExPickerRow at module
                  scope for the row component. */}
              <List rowCount={filtered.length} rowHeight={60} rowComponent={WbExPickerRow} rowProps={{
                exercises: filtered,
                selIds,
                onToggle: pickerToggleEx
              }} style={{
                height: 'min(60vh, 480px)',
                width: '100%'
              }} /></>;
          })()}</> : <><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s10
          }}><button className={"btn btn-ghost btn-sm"} onClick={() => setPickerConfigOpen(false)}>{"← Back"}</button><div className={"sec"} style={{
              margin: 0,
              border: "none",
              padding: S.s0
            }}>{"Configure "}{pickerSelected.length}{" Exercise"}{pickerSelected.length !== 1 ? "s" : ""}</div><button className={"btn btn-gold btn-sm"} onClick={commitPickerToWorkout}>{"Add to Workout ✓"}</button></div>{pickerSelected.map(entry => {
            const ex = allExById[entry.exId];
            if (!ex) return null;
            const isCardio = ex.category === "cardio" || ex.category === "flexibility";
            const isTreadEx = ex.hasTreadmill || false;
            const noSets = NO_SETS_EX_IDS.has(ex.id);
            const metric = isMetric(profile.units);
            const wUnit = weightLabel(profile.units);
            const dUnit = distLabel(profile.units);
            return <div key={entry.exId} style={{
              background: "rgba(45,42,36,.12)",
              border: "1px solid rgba(180,172,158,.05)",
              borderRadius: R.r10,
              padding: "10px 12px",
              marginBottom: S.s8
            }}><div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                marginBottom: S.s8
              }}><span style={{
                  fontSize: "1.1rem"
                }}>{ex.icon}</span><span style={{
                  fontSize: FS.fs82,
                  color: "#d4cec4",
                  flex: 1
                }}>{ex.name}</span><span style={{
                  fontSize: FS.fs65,
                  cursor: "pointer",
                  color: UI_COLORS.danger
                }} onClick={() => setPickerSelected(p => p.filter(e => e.exId !== entry.exId))}>{"✕"}</span></div><div style={{
                display: "flex",
                gap: S.s6,
                flexWrap: "wrap",
                marginBottom: S.s6
              }}>{!noSets && !isCardio && <div className={"field"} style={{
                  flex: 1,
                  minWidth: 60,
                  marginBottom: S.s0
                }}><label>{"Sets"}</label><input className={"inp"} style={{
                    padding: "6px 8px"
                  }} type={"text"} inputMode={"numeric"} value={entry.sets || ""} onChange={e => pickerUpdateEx(entry.exId, "sets", e.target.value)} placeholder={"3"} /></div>}{isCardio ? <><div className={"field"} style={{
                    flex: 1.6,
                    minWidth: 70,
                    marginBottom: S.s0
                  }}><label>{"Duration (HH:MM)"}</label><input className={"inp"} style={{
                      padding: "6px 8px"
                    }} type={"text"} inputMode={"numeric"} value={entry._durHHMM || ""} onChange={e => pickerUpdateEx(entry.exId, "_durHHMM", e.target.value)} onBlur={e => {
                      const n = normalizeHHMM(e.target.value);
                      pickerUpdateEx(entry.exId, "_durHHMM", n);
                      pickerUpdateEx(entry.exId, "reps", String(Math.max(1, Math.floor(combineHHMMSec(n, entry._durSec || "") / 60))));
                    }} placeholder={"00:00"} /></div><div className={"field"} style={{
                    flex: 0.8,
                    minWidth: 50,
                    marginBottom: S.s0
                  }}><label>{"Seconds"}</label><input className={"inp"} style={{
                      padding: "6px 8px",
                      textAlign: "center"
                    }} type={"number"} min={"0"} max={"59"} value={entry._durSec || ""} onChange={e => {
                      pickerUpdateEx(entry.exId, "_durSec", e.target.value);
                      pickerUpdateEx(entry.exId, "reps", String(Math.max(1, Math.floor(combineHHMMSec(entry._durHHMM || "", e.target.value) / 60))));
                    }} placeholder={"00"} /></div><div className={"field"} style={{
                    flex: 1,
                    minWidth: 60,
                    marginBottom: S.s0
                  }}><label>{"Dist ("}{dUnit}{")"}</label><input className={"inp"} style={{
                      padding: "6px 8px"
                    }} type={"text"} inputMode={"decimal"} value={entry.distanceMi || ""} onChange={e => pickerUpdateEx(entry.exId, "distanceMi", e.target.value)} placeholder={"0"} /></div></> : <><div className={"field"} style={{
                    flex: 1,
                    minWidth: 60,
                    marginBottom: S.s0
                  }}><label>{"Reps"}</label><input className={"inp"} style={{
                      padding: "6px 8px"
                    }} type={"text"} inputMode={"numeric"} value={entry.reps || ""} onChange={e => pickerUpdateEx(entry.exId, "reps", e.target.value)} placeholder={"10"} /></div><div className={"field"} style={{
                    flex: 1,
                    minWidth: 60,
                    marginBottom: S.s0
                  }}><label>{"Weight ("}{wUnit}{")"}</label><input className={"inp"} style={{
                      padding: "6px 8px"
                    }} type={"text"} inputMode={"decimal"} value={entry.weightLbs || ""} onChange={e => pickerUpdateEx(entry.exId, "weightLbs", e.target.value)} placeholder={"0"} /></div></>}</div>{isTreadEx && <div style={{
                display: "flex",
                gap: S.s6,
                marginBottom: S.s6
              }}><div className={"field"} style={{
                  flex: 1,
                  marginBottom: S.s0
                }}><label>{"Incline (0.5–15)"}</label><input className={"inp"} style={{
                    padding: "6px 8px"
                  }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} value={entry.incline || ""} onChange={e => pickerUpdateEx(entry.exId, "incline", e.target.value ? parseFloat(e.target.value) : null)} placeholder={"—"} /></div><div className={"field"} style={{
                  flex: 1,
                  marginBottom: S.s0
                }}><label>{"Speed (0.5–15)"}</label><input className={"inp"} style={{
                    padding: "6px 8px"
                  }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} value={entry.speed || ""} onChange={e => pickerUpdateEx(entry.exId, "speed", e.target.value ? parseFloat(e.target.value) : null)} placeholder={"—"} /></div></div>}{(entry.extraRows || []).map((row, ri) => <div key={ri} style={{
                display: "flex",
                gap: S.s4,
                marginBottom: S.s4,
                padding: "6px 8px",
                background: "rgba(45,42,36,.18)",
                borderRadius: R.r5,
                alignItems: "center",
                flexWrap: "wrap"
              }}><span style={{
                  fontSize: FS.fs55,
                  color: "#9a8a78",
                  flexShrink: 0,
                  minWidth: 16
                }}>{isCardio ? `I${ri + 2}` : `S${ri + 2}`}</span>{isCardio ? <><input className={"inp"} style={{
                    flex: 1.5,
                    minWidth: 50,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} value={row.hhmm || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      hhmm: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} onBlur={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      hhmm: normalizeHHMM(e.target.value)
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} /><input className={"inp"} style={{
                    flex: 0.7,
                    minWidth: 36,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} value={row.sec || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      sec: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} /><input className={"inp"} style={{
                    flex: 1,
                    minWidth: 40,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"text"} inputMode={"decimal"} placeholder={dUnit} value={row.distanceMi || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      distanceMi: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} />{isTreadEx && <input className={"inp"} style={{
                    flex: 0.7,
                    minWidth: 34,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Inc"} value={row.incline || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      incline: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} />}{isTreadEx && <input className={"inp"} style={{
                    flex: 0.7,
                    minWidth: 34,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Spd"} value={row.speed || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      speed: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} />}</> : <>{!noSets && <input className={"inp"} style={{
                    flex: 1,
                    minWidth: 40,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"text"} inputMode={"decimal"} placeholder={"Sets"} value={row.sets || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      sets: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} />}<input className={"inp"} style={{
                    flex: 1,
                    minWidth: 40,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"text"} inputMode={"decimal"} placeholder={"Reps"} value={row.reps || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      reps: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} /><input className={"inp"} style={{
                    flex: 1,
                    minWidth: 40,
                    padding: "4px 8px",
                    fontSize: FS.lg
                  }} type={"text"} inputMode={"decimal"} placeholder={wUnit} value={row.weightLbs || ""} onChange={e => {
                    const rr = [...(entry.extraRows || [])];
                    rr[ri] = {
                      ...rr[ri],
                      weightLbs: e.target.value
                    };
                    pickerUpdateEx(entry.exId, "extraRows", rr);
                  }} /></>}<button className={"btn btn-danger btn-xs"} style={{
                  padding: "2px 4px",
                  flexShrink: 0
                }} onClick={() => {
                  const rr = (entry.extraRows || []).filter((_, j) => j !== ri);
                  pickerUpdateEx(entry.exId, "extraRows", rr);
                }}>{"✕"}</button></div>)}<button className={"btn btn-ghost btn-xs"} style={{
                width: "100%",
                marginTop: S.s4,
                fontSize: FS.sm,
                color: "#8a8478",
                borderStyle: "dashed"
              }} onClick={() => {
                const rr = [...(entry.extraRows || []), isCardio ? {
                  hhmm: "",
                  sec: "",
                  distanceMi: "",
                  incline: "",
                  speed: ""
                } : {
                  sets: "",
                  reps: "",
                  weightLbs: ""
                }];
                pickerUpdateEx(entry.exId, "extraRows", rr);
              }}>{"＋ Add Row (e.g. "}{isCardio ? "interval" : "progressive set"}{")"}</button></div>;
          })}</>}</div></div>, document.body)

    /* ══ ADD WORKOUT TO PLAN PICKER ══════════════ */}{addToPlanPicker && createPortal(<div className={"atp-backdrop"} onClick={() => setAddToPlanPicker(null)}><div className={"atp-sheet"} onClick={e => e.stopPropagation()}><div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}><div style={{
            fontFamily: "'Inter',sans-serif",
            fontSize: FS.fs84,
            color: "#d4cec4"
          }}>{"📋 Add to Plan"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setAddToPlanPicker(null)}>{"✕"}</button></div><div style={{
          display: "flex",
          alignItems: "center",
          gap: S.s8,
          padding: "10px 12px",
          borderRadius: R.xl,
          background: "rgba(45,42,36,.18)",
          border: "1px solid rgba(180,172,158,.06)"
        }}><span style={{
            fontSize: "1.4rem"
          }}>{addToPlanPicker.workout.icon}</span><div><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs76,
              color: "#d4cec4"
            }}>{addToPlanPicker.workout.name}</div><div style={{
              fontSize: FS.sm,
              color: "#8a8478"
            }}>{addToPlanPicker.workout.exercises.length}{" exercises will be added as a new day"}</div></div></div>{profile.plans.length === 0 ? <div className={"empty"} style={{
          padding: "14px 0"
        }}>{"No plans yet. Create a plan first in the Plans tab."}</div> : profile.plans.map(pl => <div key={pl.id} className={"atp-plan-row"} onClick={() => addWorkoutToPlan(addToPlanPicker.workout, pl.id)}><span style={{
            fontSize: "1.3rem"
          }}>{pl.icon}</span><div style={{
            flex: 1,
            minWidth: 0
          }}><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.lg,
              color: "#d4cec4"
            }}>{pl.name}</div><div style={{
              fontSize: FS.sm,
              color: "#8a8478"
            }}>{pl.days.length}{" day"}{pl.days.length !== 1 ? "s" : ""}{" · currently "}{pl.days.reduce((s, d) => s + d.exercises.length, 0)}{" exercises"}</div></div><span style={{
            fontSize: FS.md,
            color: "#b4ac9e"
          }}>{"→"}</span></div>)}<button className={"btn btn-ghost btn-sm"} style={{
          width: "100%"
        }} onClick={() => setAddToPlanPicker(null)}>{"Cancel"}</button></div></div>, document.body)

    /* ══ RETRO CHECK-IN MODAL ════════════════════ */}{retroCheckInModal && createPortal(<div className={"cdel-backdrop"} onClick={() => setRetroCheckInModal(false)}><div className={"cdel-sheet"} style={{
        borderColor: "rgba(180,172,158,.08)",
        background: "linear-gradient(160deg,#0c0c0a,#0c0c0a)"
      }} onClick={e => e.stopPropagation()}><div className={"cdel-icon"}>{"🔥"}</div><div className={"cdel-title"}>{"Retro Check-In"}</div><div className={"cdel-body"}>{"Forgot to check in? Log a past gym visit here. Each day awards +125 XP and updates your streak."}</div><div className={"field"} style={{
          margin: 0
        }}><label>{"Select Date"}</label><input className={"inp"} type={"date"} value={retroDate} max={todayStr()} onChange={e => setRetroDate(e.target.value)} />{retroDate && (() => {
            const d = new Date(retroDate + "T12:00:00");
            const already = (profile.checkInHistory || []).includes(retroDate);
            return <div style={{
              fontSize: FS.fs68,
              marginTop: S.s6,
              color: already ? UI_COLORS.danger : "#b4ac9e"
            }}>{already ? "⚠ Already checked in for " + d.toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric"
              }) : "📅 " + d.toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
              })}</div>;
          })()}</div>
        {
          /* Recent history preview */
        }{(profile.checkInHistory || []).length > 0 && <div style={{
          fontSize: FS.sm,
          color: "#8a8478"
        }}><div style={{
            fontFamily: "'Inter',sans-serif",
            letterSpacing: ".06em",
            marginBottom: S.s4
          }}>{"Recent Check-Ins"}</div><div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: S.s4
          }}>{[...(profile.checkInHistory || [])].sort().reverse().slice(0, 14).map(d => {
              const date = new Date(d + "T12:00:00");
              const isToday = d === todayStr();
              return <span key={d} style={{
                padding: "2px 8px",
                borderRadius: R.r4,
                background: isToday ? "rgba(45,42,36,.26)" : "rgba(45,42,36,.15)",
                border: `1px solid ${isToday ? "rgba(180,172,158,.08)" : "rgba(180,172,158,.06)"}`,
                color: isToday ? "#d4cec4" : "#8a8478"
              }}>{date.toLocaleDateString([], {
                  month: "short",
                  day: "numeric"
                })}</span>;
            })}</div></div>}<div style={{
          display: "flex",
          gap: S.s8
        }}><button className={"btn btn-ghost btn-sm"} style={{
            flex: 1
          }} onClick={() => setRetroCheckInModal(false)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
            flex: 2
          }} disabled={!retroDate || (profile.checkInHistory || []).includes(retroDate)} onClick={doRetroCheckIn}>{"🔥 Log Check-In"}</button></div></div></div>, document.body)

    /* ══ WORKOUT COMPLETION MODAL ════════════════ */
    /* ══ ONE-OFF NAMING MODAL ════════════════════ */
    /* ══ SINGLE EXERCISE QUICK-LOG MODAL ════════ */}{selEx && (() => {
      const ex = allExById[selEx];
      if (!ex) return null;
      const metric = isMetric(profile.units);
      const isCardio = ex.category === "cardio";
      const isFlex = ex.category === "flexibility";
      const showWeight = !isCardio && !isFlex;
      const showHR = isCardio;
      const showDist = isCardio;
      const noSets = NO_SETS_EX_IDS.has(ex.id);
      const isRunning = ex.id === RUNNING_EX_ID;
      const isTreadmill = ex.hasTreadmill || false;
      const age = profile.age || 30;
      const rawW = parseFloat(exWeight || 0);
      const wLbs = metric ? parseFloat(kgToLbs(rawW) || 0) : rawW;
      const effW = wLbs;
      const effWDisp = metric ? lbsToKg(effW) : effW;
      const wUnit = weightLabel(profile.units);
      const dUnit = distLabel(profile.units);
      const rawDist = parseFloat(distanceVal || 0);
      const distMi = rawDist > 0 ? metric ? parseFloat(kmToMi(rawDist)) : rawDist : 0;
      const pbPaceMi = profile.runningPB || null;
      const pbDisp = pbPaceMi ? metric ? `${(pbPaceMi / 1.60934).toFixed(2)} min/km` : `${pbPaceMi.toFixed(2)} min/mi` : null;
      const exPB4 = (profile.exercisePBs || {})[ex.id] || null;
      const pbWeightDisp = v => (metric ? parseFloat(lbsToKg(v)).toFixed(1) : v) + (metric ? " kg" : " lbs");
      const exPBDisp4 = exPB4 ? exPB4.type === "Cardio Pace" ? metric ? (exPB4.value / 1.60934).toFixed(2) + " min/km" : exPB4.value.toFixed(2) + " min/mi" : exPB4.type === "Assisted Weight" ? "1RM: " + pbWeightDisp(exPB4.value) + " (Assisted)" : exPB4.type === "Max Reps Per 1 Set" ? exPB4.value + " reps" : exPB4.type === "Longest Hold" || exPB4.type === "Fastest Time" ? parseFloat(exPB4.value.toFixed(2)) + " min" : exPB4.type === "Heaviest Weight" ? pbWeightDisp(exPB4.value) : "1RM: " + pbWeightDisp(exPB4.value) : null;
      const durationMin = parseFloat(reps || 0);
      const runPace = isRunning && distMi > 0 && durationMin > 0 ? durationMin / distMi : null;
      const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
      const estXP = (() => {
        const sv = noSets ? 1 : parseInt(sets) || 0;
        const rv = isCardio || isFlex ? Math.max(1, Math.floor(combineHHMMSec(exHHMM, exSec) / 60) || parseInt(reps) || 1) : parseInt(reps) || 0;
        const extraCount = quickRows.length;
        const hrZ = showHR ? hrZone : null;
        const baseXP = calcExXP(ex.id, sv, rv, profile.chosenClass, allExById, distMi || null, effW || null, hrZ, extraCount);
        const rowsXP = quickRows.reduce((s, row) => {
          const rs = noSets ? 1 : parseInt(row.sets) || sv;
          const rr = isCardio || isFlex ? Math.max(1, Math.floor(combineHHMMSec(row.hhmm || "", row.sec || "") / 60)) || rv : parseInt(row.reps) || rv;
          return s + calcExXP(ex.id, rs, rr, profile.chosenClass, allExById, parseFloat(row.dist) || distMi || null, effW || null, hrZ, extraCount);
        }, 0);
        return (baseXP + rowsXP).toLocaleString();
      })();
      try {
        return <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.78)",
          zIndex: 200,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center"
        }} onClick={() => {
          setSelEx(null);
          setExHHMM("");
          setExSec("");
          setQuickRows([]);
          setPendingSoloRemoveId(null);
        }}><div style={{
            width: "100%",
            maxWidth: 520,
            maxHeight: "92vh",
            overflowY: "auto",
            background: "linear-gradient(160deg,#0c0c0a,#0c0c0a)",
            border: "1px solid rgba(180,172,158,.06)",
            borderRadius: "18px 18px 0 0",
            padding: "0 0 24px"
          }} onClick={e => e.stopPropagation()}><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px 4px"
            }}><div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8
              }}><button className={"btn btn-ghost btn-sm"} style={{
                  padding: "4px 8px",
                  fontSize: FS.fs75
                }} onClick={() => {
                  setSelEx(null);
                  setExHHMM("");
                  setExSec("");
                  setQuickRows([]);
                  setPendingSoloRemoveId(null);
                  setLibDetailEx(ex);
                }}>{"← Back"}</button><div style={{
                  fontSize: FS.fs95,
                  color: "#d4cec4",
                  fontFamily: "'Inter',sans-serif",
                  fontWeight: 600
                }}>{ex.icon}{" "}{ex.name}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => {
                setSelEx(null);
                setExHHMM("");
                setExSec("");
                setQuickRows([]);
                setPendingSoloRemoveId(null);
              }}>{"✕"}</button></div><div style={{
              padding: "0 14px"
            }}><div className={"log-form"}>{ex.id === "rest_day" ? <div style={{
                  textAlign: "center",
                  padding: "18px 0",
                  color: "#8a8478",
                  fontSize: FS.fs78,
                  fontStyle: "italic"
                }}>{"🛌 Rest day — no stats to track. Recover well!"}</div> : null
                /* Top row: Sets/Reps or Duration+Sec+Dist, then Weight */}{ex.id !== "rest_day" && <div style={{
                  display: "flex",
                  gap: S.s6,
                  marginBottom: S.s8,
                  alignItems: "flex-end"
                }}>{!noSets && !(isCardio || isFlex) && <div style={{
                    flex: 1
                  }}><label style={{
                      fontSize: FS.sm,
                      color: "#b0a898",
                      display: "block",
                      marginBottom: S.s4
                    }}>{"Sets"}</label><input className={"inp"} style={{
                      padding: "6px 8px",
                      textAlign: "center"
                    }} type={"number"} min={"0"} max={"20"} value={sets} onChange={e => setSets(e.target.value)} placeholder={""} /></div>}{isCardio || isFlex ? <><div style={{
                      flex: 2
                    }}><label style={{
                        fontSize: FS.sm,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Duration (HH:MM)"}</label><input className={"inp"} style={{
                        padding: "6px 8px",
                        textAlign: "center"
                      }} type={"text"} inputMode={"numeric"} value={exHHMM} onChange={e => setExHHMM(e.target.value)} onBlur={e => {
                        const norm = normalizeHHMM(e.target.value);
                        setExHHMM(norm);
                        const sec = combineHHMMSec(norm, exSec);
                        if (sec) setReps(String(Math.max(1, Math.floor(sec / 60))));
                      }} placeholder={"00:00"} /></div><div style={{
                      flex: 1
                    }}><label style={{
                        fontSize: FS.sm,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Seconds"}</label><input className={"inp"} style={{
                        padding: "6px 8px",
                        textAlign: "center"
                      }} type={"number"} min={"0"} max={"59"} value={exSec} onChange={e => {
                        setExSec(e.target.value);
                        const sec = combineHHMMSec(exHHMM, e.target.value);
                        if (sec) setReps(String(Math.max(1, Math.floor(sec / 60))));
                      }} placeholder={"00"} /></div>{showDist && <div style={{
                      flex: 1.5
                    }}><label style={{
                        fontSize: FS.sm,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Dist ("}{dUnit}{")"}</label><input className={"inp"} style={{
                        padding: "6px 8px",
                        textAlign: "center"
                      }} type={"number"} min={"0"} max={"200"} step={"0.1"} value={distanceVal} onChange={e => setDistanceVal(e.target.value)} placeholder={metric ? "0.0" : "0.0"} /></div>}</> : <><div style={{
                      flex: 1
                    }}><label style={{
                        fontSize: FS.sm,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Reps"}</label><input className={"inp"} style={{
                        padding: "6px 8px",
                        textAlign: "center"
                      }} type={"number"} min={"0"} max={"200"} value={reps} onChange={e => setReps(e.target.value)} placeholder={""} /></div>{showWeight && <div style={{
                      flex: 1.5
                    }}><label style={{
                        fontSize: FS.sm,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Weight ("}{wUnit}{")"}</label><input className={"inp"} style={{
                        padding: "6px 8px",
                        textAlign: "center"
                      }} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={exWeight} onChange={e => setExWeight(e.target.value)} placeholder={metric ? "60" : "135"} /></div>}</>}</div>
                /* Extra rows */}{ex.id !== "rest_day" && <div style={{
                  marginBottom: S.s8
                }}>{quickRows.map((row, ri) => <div key={ri} style={{
                    display: "flex",
                    gap: S.s4,
                    marginBottom: S.s4,
                    padding: "6px 8px",
                    background: "rgba(45,42,36,.18)",
                    borderRadius: R.md,
                    alignItems: "center",
                    flexWrap: "wrap"
                  }}><span style={{
                      fontSize: FS.sm,
                      color: "#a09080",
                      flexShrink: 0,
                      minWidth: 18
                    }}>{isCardio || isFlex ? `I${ri + 2}` : `S${ri + 2}`}</span>{isCardio || isFlex ? <><input className={"inp"} style={{
                        flex: 1.5,
                        minWidth: 52,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} defaultValue={row.hhmm || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          hhmm: normalizeHHMM(e.target.value)
                        };
                        setQuickRows(rr);
                      }} /><input className={"inp"} style={{
                        flex: 0.8,
                        minWidth: 36,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} defaultValue={row.sec || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          sec: e.target.value
                        };
                        setQuickRows(rr);
                      }} /><input className={"inp"} style={{
                        flex: 1,
                        minWidth: 40,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"text"} inputMode={"decimal"} placeholder={dUnit} defaultValue={row.dist || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          dist: e.target.value
                        };
                        setQuickRows(rr);
                      }} />{isTreadmill && <input className={"inp"} style={{
                        flex: 0.8,
                        minWidth: 34,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Inc"} defaultValue={row.incline || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          incline: e.target.value
                        };
                        setQuickRows(rr);
                      }} />}{isTreadmill && <input className={"inp"} style={{
                        flex: 0.8,
                        minWidth: 34,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Spd"} defaultValue={row.speed || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          speed: e.target.value
                        };
                        setQuickRows(rr);
                      }} />}</> : <>{!noSets && <input className={"inp"} style={{
                        flex: 1,
                        minWidth: 40,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"number"} min={"1"} max={"20"} placeholder={"Sets"} defaultValue={row.sets || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          sets: e.target.value
                        };
                        setQuickRows(rr);
                      }} />}<input className={"inp"} style={{
                        flex: 1,
                        minWidth: 40,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"number"} min={"1"} max={"200"} placeholder={"Reps"} defaultValue={row.reps || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          reps: e.target.value
                        };
                        setQuickRows(rr);
                      }} />{showWeight && <input className={"inp"} style={{
                        flex: 1,
                        minWidth: 40,
                        padding: "4px 8px",
                        fontSize: FS.lg
                      }} type={"number"} min={"0"} placeholder={wUnit} defaultValue={row.weightLbs || ""} onBlur={e => {
                        const rr = [...quickRows];
                        rr[ri] = {
                          ...rr[ri],
                          weightLbs: e.target.value
                        };
                        setQuickRows(rr);
                      }} />}</>}<button className={"btn btn-danger btn-xs"} style={{
                      padding: "2px 6px",
                      flexShrink: 0
                    }} onClick={() => setQuickRows(quickRows.filter((_, j) => j !== ri))}>{"✕"}</button></div>)}</div>
                /* Distance bonus info (field is now in top row) */}{ex.id !== "rest_day" && showDist && rawDist > 0 && <div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478",
                  marginBottom: S.s6,
                  marginTop: S.sNeg4
                }}>{metric ? `${rawDist} km = ${parseFloat(kmToMi(rawDist)).toFixed(2)} mi` : `${rawDist} mi = ${parseFloat(miToKm(rawDist)).toFixed(2)} km`}<span style={{
                    color: "#e67e22",
                    marginLeft: S.s6
                  }}>{"+"}{Math.round(Math.min(distMi * 0.05, 0.5) * 100)}{"% dist bonus"}</span></div>
                /* Treadmill: Incline + Speed */}{ex.id !== "rest_day" && isTreadmill && <div style={{
                  display: "flex",
                  gap: S.s8,
                  marginBottom: S.s10
                }}><div style={{
                    flex: 1
                  }}><label style={{
                      fontSize: FS.sm,
                      color: "#b0a898",
                      display: "block",
                      marginBottom: S.s4
                    }}>{"Incline (0.5–15)"}</label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={exIncline || ""} onChange={e => setExIncline(e.target.value ? parseFloat(e.target.value) : null)} /></div><div style={{
                    flex: 1
                  }}><label style={{
                      fontSize: FS.sm,
                      color: "#b0a898",
                      display: "block",
                      marginBottom: S.s4
                    }}>{"Speed (0.5–15)"}</label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={exSpeed || ""} onChange={e => setExSpeed(e.target.value ? parseFloat(e.target.value) : null)} /></div></div>
                /* Add Row button */}{ex.id !== "rest_day" && (isCardio || isFlex || showWeight) && <button className={"btn btn-ghost btn-xs"} style={{
                  width: "100%",
                  marginBottom: S.s8,
                  fontSize: FS.sm,
                  color: "#8a8478",
                  borderStyle: "dashed"
                }} onClick={() => setQuickRows([...quickRows, isCardio || isFlex ? {
                  hhmm: "",
                  sec: "",
                  dist: "",
                  incline: "",
                  speed: ""
                } : {
                  sets: sets || "",
                  reps: reps || "",
                  weightLbs: exWeight || ""
                }])}>{"＋ Add Row ("}{isCardio || isFlex ? "e.g. interval" : "progressive weight/sets"}{")"}</button>
                /* Weight Intensity slider (weight field is now in top row) */}{ex.id !== "rest_day" && showWeight && <div style={{
                  marginBottom: S.s12
                }}><div className={"intensity-row"}><label style={{
                      marginBottom: S.s0,
                      flex: 1
                    }}>{"Weight Intensity"}</label><span className={"intensity-val"}>{weightPct}{"%"}</span></div><input type={"range"} className={"pct-slider"} min={"0"} max={"100"} step={"5"} value={pctToSlider(weightPct)} onChange={e => {
                    const newPct = sliderToPct(Number(e.target.value));
                    const curW = parseFloat(exWeight);
                    if (curW && weightPct > 0) {
                      const scaled = Math.round(curW * newPct / weightPct * 100) / 100;
                      setExWeight(String(scaled));
                    }
                    setWeightPct(newPct);
                  }} /><div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: FS.fs58,
                    color: "#8a8478",
                    marginTop: S.s2
                  }}><span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span></div></div>
                /* Avg HR Zone — last */}{ex.id !== "rest_day" && showHR && <div style={{
                  marginBottom: S.s12
                }}><label>{"Avg Heart Rate Zone "}{profile.age ? `(Age ${profile.age})` : ""}</label><div className={"hr-zone-row"}>{HR_ZONES.map(z => {
                      const range = hrRange(age, z);
                      const sel = hrZone === z.z;
                      return <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
                        "--zc": z.color,
                        borderColor: sel ? z.color : "rgba(45,42,36,.2)",
                        background: sel ? `${z.color}22` : "rgba(45,42,36,.12)"
                      }} onClick={() => setHrZone(sel ? null : z.z)}><span className={"hz-name"} style={{
                          color: sel ? z.color : "#8a8478"
                        }}>{"Z"}{z.z}{" "}{z.name}</span><span className={"hz-bpm"} style={{
                          color: sel ? z.color : "#8a8478"
                        }}>{range.lo}{"–"}{range.hi}</span></div>;
                    })}</div>{hrZone && <div style={{
                    fontSize: FS.md,
                    color: "#8a8478",
                    fontStyle: "italic",
                    marginTop: S.s6
                  }}>{HR_ZONES[hrZone - 1].desc}</div>}</div>
                /* Personal Best display */}{ex.id !== "rest_day" && (isRunning && pbDisp || exPBDisp4) && <div style={{
                  fontSize: FS.fs68,
                  color: "#b4ac9e",
                  marginBottom: S.s8,
                  display: "flex",
                  alignItems: "center",
                  gap: S.s6
                }}><span>{"🏆"}</span><span>{"Current PB: "}{isRunning && pbDisp ? pbDisp : exPBDisp4}</span></div>
                /* XP estimate */}{ex.id !== "rest_day" && <div style={{
                  marginBottom: S.s8,
                  fontSize: FS.md,
                  color: "#8a8478",
                  fontStyle: "italic"
                }}>{"Est. XP: "}<span style={{
                    color: "#b4ac9e",
                    fontFamily: "'Inter',sans-serif"
                  }}>{estXP}</span>{showHR && hrZone && <span style={{
                    color: "#e67e22",
                    marginLeft: S.s6
                  }}>{"Z"}{hrZone}{" +"}{(hrZone - 1) * 4}{"% XP"}</span>}{showWeight && effW > 0 && <span style={{
                    color: UI_COLORS.success,
                    marginLeft: S.s6
                  }}>{"+"}{Math.round(Math.min(effW / 500, 0.3) * 100)}{"% wt bonus"}</span>}{runBoostPct > 0 && <span style={{
                    color: UI_COLORS.warning,
                    marginLeft: S.s6
                  }}>{"⚡ +"}{runBoostPct}{"% pace bonus"}</span>}</div>
                /* Primary action row */}<div style={{
                  display: "flex",
                  gap: S.s6,
                  marginBottom: S.s8
                }}><button className={"btn btn-glass-yellow"} style={{
                    flex: 2,
                    fontSize: FS.sm,
                    padding: "8px 10px"
                  }} onClick={logExercise}>{"✓ Complete / Schedule"}</button>{ex.id !== "rest_day" && <button className={"btn btn-ghost btn-sm"} style={{
                    flex: 1,
                    fontSize: FS.sm,
                    padding: "8px 6px"
                  }} onClick={() => {
                    ex.custom ? openExEditor("edit", ex) : openExEditor("copy", ex);
                    setSelEx(null);
                  }}>{ex.custom ? "✎ Edit" : "📋 Copy"}</button>}</div>
                {
                  /* Secondary actions — add to existing workout / plan */
                }<div style={{
                  display: "flex",
                  gap: S.s6
                }}>{ex.id !== "rest_day" && <button className={"btn btn-ghost btn-sm"} style={{
                    flex: 1,
                    fontSize: FS.fs58,
                    padding: "6px 8px",
                    borderColor: "rgba(45,42,36,.3)",
                    color: "#8a8478"
                  }} onClick={() => {
                    const exEntry = {
                      exId: ex.id,
                      sets: parseInt(sets) || 0,
                      reps: parseInt(reps) || 0,
                      weightLbs: wLbs || null,
                      durationMin: null,
                      weightPct,
                      distanceMi: distMi || null,
                      hrZone: hrZone || null
                    };
                    setAddToWorkoutPicker({
                      exercises: [exEntry]
                    });
                    setSelEx(null);
                  }}>{"➕ Add to Workout"}</button>}<button className={"btn btn-ghost btn-sm"} style={{
                    flex: 1,
                    fontSize: FS.fs58,
                    padding: "6px 8px",
                    borderColor: "rgba(45,42,36,.3)",
                    color: "#8a8478"
                  }} onClick={() => {
                    const ids = [ex.id];
                    setSpwSelected(ids);
                    setSavePlanWizard({
                      entries: [{
                        exId: ex.id,
                        exercise: ex.name,
                        icon: ex.icon,
                        _idx: ex.id
                      }],
                      label: ex.name
                    });
                    setSpwName(ex.name);
                    setSpwIcon(ex.icon || "📋");
                    setSpwDate("");
                    setSpwMode("new");
                    setSpwTargetPlanId(null);
                    setSelEx(null);
                  }}>{"📋 Add to Plan"}</button></div></div></div></div></div>;
      } catch (e) {
        console.error("Quick-log render error:", e);
        return null;
      }
    })()

    /* ══ STATS PROMPT MODAL ══════════════════════ */}{statsPromptModal && createPortal(<div className={"modal-backdrop"} onClick={() => setStatsPromptModal(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0
      }}><div className={"modal-body"}><div className={"stats-prompt-banner"} onClick={() => {
            setProfile(p => ({
              ...p,
              notificationPrefs: {
                ...(p.notificationPrefs || {}),
                reviewBattleStats: false
              }
            }));
            statsPromptModal.onConfirm(statsPromptModal.wo);
            setStatsPromptModal(null);
            setSpMakeReusable(false);
            setSpDurSec("");
          }}><div style={{
              width: 16,
              height: 16,
              borderRadius: R.r3,
              border: "1.5px solid rgba(180,172,158,.25)",
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0
            }} /><div className={"stats-prompt-banner-text"}>{"Want this reminder off? Check here. To re-enable, you can do so in "}<strong>{"Alerts settings"}</strong>{"."}</div></div><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s10
          }}><div><div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8
              }}><button className={"btn btn-ghost btn-sm"} style={{
                  padding: "4px 8px",
                  fontSize: FS.fs75
                }} onClick={() => {
                  setStatsPromptModal(null);
                  if (statsPromptModal.wo.soloEx && statsPromptModal.wo._soloExId) {
                    setSelEx(statsPromptModal.wo._soloExId);
                  } else if (!statsPromptModal.wo.soloEx) {
                    setWorkoutView("builder");
                    setActiveTab("workouts");
                  }
                }}>{"← Back"}</button><div className={"stats-modal-title"} style={{
                  flex: 1
                }}>{"📊 "}{"Review Battle Stats "}<span style={{
                    color: "#8a8478",
                    fontWeight: "normal",
                    fontSize: FS.lg
                  }}>{"(Optional)"}</span></div></div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setStatsPromptModal(null)}>{"✕"}</button></div><div className={"stats-modal-subtitle"} style={{
            marginBottom: S.s14
          }}>{statsPromptModal.wo.oneOff ? "Review your workout stats before completing. Fill in any missing values, or leave blank to skip." : (() => {
              const missing = [statsPromptModal.missingDur && "Duration", statsPromptModal.missingAct && "Active Cal", statsPromptModal.missingTot && "Total Cal"].filter(Boolean);
              return missing.length ? `${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not recorded. Would you like to add ${missing.length === 1 ? "it" : "them"} before completing?` : "Review your workout stats before completing.";
            })()}</div><div className={"stats-prompt-fields"}><div className={"field"} style={{
              flex: 1.5,
              marginBottom: S.s0
            }}><label>{"Duration "}<span style={{
                  color: "#8a8478",
                  fontWeight: "normal"
                }}>{"(HH:MM)"}</span></label><input className={"inp"} type={"text"} inputMode={"numeric"} placeholder={"00:00"} value={spDuration} onChange={e => setSpDuration(e.target.value)} onBlur={e => setSpDuration(normalizeHHMM(e.target.value))} /></div><div className={"field"} style={{
              flex: 0.8,
              marginBottom: S.s0
            }}><label>{"Sec"}</label><input className={"inp"} type={"number"} min={"0"} max={"59"} placeholder={":00"} value={spDurSec} onChange={e => setSpDurSec(e.target.value)} /></div><div className={"field"} style={{
              flex: 1,
              marginBottom: S.s0
            }}><label>{"Active Cal"}</label><input className={"inp"} type={"number"} min={"0"} max={"9999"} placeholder={"e.g. 320"} value={spActiveCal} onChange={e => setSpActiveCal(e.target.value)} /></div><div className={"field"} style={{
              flex: 1,
              marginBottom: S.s0
            }}><label>{"Total Cal"}</label><input className={"inp"} type={"number"} min={"0"} max={"9999"} placeholder={"e.g. 450"} value={spTotalCal} onChange={e => setSpTotalCal(e.target.value)} /></div></div>
          {
            /* Make Reusable checkbox — only for one-off workouts */
          }{statsPromptModal.wo.oneOff && <div className={"stats-prompt-reusable"} onClick={() => setSpMakeReusable(v => !v)}><div style={{
              width: 18,
              height: 18,
              borderRadius: R.r4,
              border: `2px solid ${spMakeReusable ? "#b4ac9e" : "rgba(180,172,158,.18)"}`,
              background: spMakeReusable ? "#b4ac9e" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all .15s"
            }}>{spMakeReusable && <span style={{
                fontSize: FS.md,
                color: "#0c0c0a",
                fontWeight: "bold"
              }}>{"✓"}</span>}</div><div><div className={"stats-prompt-reusable-title"}>{"💪 Also save as Reusable Workout"}</div><div className={"stats-prompt-reusable-sub"}>{"Keep this workout in your Re-Usable tab for future use"}</div></div></div>}<div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-gold"} style={{
              flex: 1,
              fontSize: FS.fs75
            }} onClick={() => {
              const durSec = combineHHMMSec(spDuration, spDurSec) || null;
              const wo = {
                ...statsPromptModal.wo,
                durationMin: durSec !== null ? durSec : _nullishCoalesce(statsPromptModal.wo.durationMin, () => null),
                activeCal: spActiveCal !== null && spActiveCal !== "" ? Number(spActiveCal) : _nullishCoalesce(statsPromptModal.wo.activeCal, () => null),
                totalCal: spTotalCal !== null && spTotalCal !== "" ? Number(spTotalCal) : _nullishCoalesce(statsPromptModal.wo.totalCal, () => null),
                makeReusable: spMakeReusable
              };
              const _statsRef = {
                wo: statsPromptModal.wo,
                missingDur: statsPromptModal.missingDur,
                missingAct: statsPromptModal.missingAct,
                missingTot: statsPromptModal.missingTot,
                onConfirm: statsPromptModal.onConfirm
              };
              statsPromptModal.onConfirm(wo, _statsRef);
              setStatsPromptModal(null);
              setSpMakeReusable(false);
              setSpDurSec("");
            }}>{"✓ Save & Complete"}</button></div></div></div></div>, document.body)

    /* ══ CALENDAR EXERCISE READ-ONLY DETAIL MODAL ══ */}{calExDetailModal && createPortal(<div className={"modal-backdrop"} onClick={() => setCalExDetailModal(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0
      }}><div className={"modal-body"}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s10
          }}><div style={{
              display: "flex",
              alignItems: "center",
              gap: S.s8
            }}><span style={{
                fontSize: "1.2rem"
              }}>{calExDetailModal.exerciseIcon}</span><div className={"stats-modal-title"}>{calExDetailModal.exerciseName}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setCalExDetailModal(null)}>{"✕"}</button></div>
          {
            /* Source info */
          }{calExDetailModal.sourceName && <div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            fontStyle: "italic",
            padding: "6px 10px",
            background: "rgba(45,42,36,.12)",
            borderRadius: R.r7,
            border: "1px solid rgba(45,42,36,.2)",
            marginBottom: S.s10
          }}><span>{calExDetailModal.sourceIcon || "💪"}{" From: "}<b style={{
                color: "#b4ac9e"
              }}>{calExDetailModal.sourceName}</b></span></div>}{!calExDetailModal.sourceName && <div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            fontStyle: "italic",
            padding: "6px 10px",
            background: "rgba(45,42,36,.12)",
            borderRadius: R.r7,
            border: "1px solid rgba(45,42,36,.2)",
            marginBottom: S.s10
          }}>{"Solo Exercise"}</div>
          /* Stats row */}{(calExDetailModal.durationSec > 0 || calExDetailModal.activeCal > 0 || calExDetailModal.totalCal > 0) && <div style={{
            display: "flex",
            gap: S.s8,
            marginBottom: S.s12
          }}>{calExDetailModal.durationSec > 0 && <div className={"eff-weight"} style={{
              flex: 1
            }}><span className={"eff-weight-val"}>{secToHMS(calExDetailModal.durationSec)}</span><span className={"eff-weight-lbl"}>{"Duration"}</span></div>}{calExDetailModal.totalCal > 0 && <div className={"eff-weight"} style={{
              flex: 1
            }}><span className={"eff-weight-val"}>{calExDetailModal.totalCal}</span><span className={"eff-weight-lbl"}>{"Total Cal"}</span></div>}{calExDetailModal.activeCal > 0 && <div className={"eff-weight"} style={{
              flex: 1
            }}><span className={"eff-weight-val"}>{calExDetailModal.activeCal}</span><span className={"eff-weight-lbl"}>{"Active Cal"}</span></div>}</div>
          /* Entry rows */}<div style={{
            marginBottom: S.s8
          }}>{calExDetailModal.entries.length > 1 && <div style={{
              fontSize: FS.fs58,
              color: "#8a8478",
              textTransform: "uppercase",
              letterSpacing: ".08em",
              marginBottom: S.s6
            }}>{calExDetailModal.entries.length}{" Sets / Rows"}</div>}{calExDetailModal.entries.map((e, i) => <div key={i} style={{
              background: "rgba(45,42,36,.18)",
              border: "1px solid rgba(45,42,36,.2)",
              borderRadius: R.lg,
              padding: "10px 12px",
              marginBottom: S.s6
            }}><div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}><div style={{
                  fontSize: FS.lg,
                  color: "#d4cec4",
                  fontWeight: 600
                }}>{calExDetailModal.entries.length > 1 ? "Set " + (i + 1) : "Details"}</div><div style={{
                  fontSize: FS.fs62,
                  fontWeight: 600,
                  color: "#b4ac9e"
                }}>{"+"}{e.xp}{" XP"}</div></div><div style={{
                display: "flex",
                gap: S.s12,
                marginTop: S.s6,
                flexWrap: "wrap"
              }}><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}><span style={{
                    color: "#8a8478"
                  }}>{"Sets: "}</span>{e.sets}</div><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}><span style={{
                    color: "#8a8478"
                  }}>{"Reps: "}</span>{e.reps}</div>{e.weightLbs && <div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}><span style={{
                    color: "#8a8478"
                  }}>{"Weight: "}</span>{isMetric(profile.units) ? lbsToKg(e.weightLbs) + " kg" : e.weightLbs + " lbs"}</div>}{e.distanceMi && <div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}><span style={{
                    color: "#8a8478"
                  }}>{"Distance: "}</span>{isMetric(profile.units) ? miToKm(e.distanceMi) + " km" : e.distanceMi + " mi"}</div>}{e.hrZone && <div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}><span style={{
                    color: "#8a8478"
                  }}>{"HR Zone: "}</span>{e.hrZone}</div>}{e.seconds && <div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}><span style={{
                    color: "#8a8478"
                  }}>{"Seconds: "}</span>{e.seconds}</div>}</div></div>)}</div>
          {
            /* Total XP */
          }<div style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "8px 0",
            borderTop: "1px solid rgba(180,172,158,.08)"
          }}><div style={{
              fontSize: FS.fs75,
              fontWeight: 700,
              color: "#b4ac9e"
            }}>{"Total: +"}{calExDetailModal.entries.reduce((s, e) => s + e.xp, 0)}{" XP"}</div></div></div></div></div>, document.body)

    /* ══ RETRO EDIT MODAL ═══════════════════════ */}{retroEditModal && (() => {
      const rem = retroEditModal;
      // Build a synthetic workout from the log entries for the builder
      const exercises = rem.entries.map(e => ({
        exId: e.exId,
        sets: e.sets || 3,
        reps: e.reps || 10,
        weightLbs: e.weightLbs || null,
        weightPct: e.weightPct || 100,
        distanceMi: e.distanceMi || null,
        hrZone: e.hrZone || null,
        durationMin: null
      }));
      const wo = {
        id: rem.sourceId || uid(),
        name: rem.sourceName,
        icon: rem.sourceIcon,
        exercises,
        oneOff: rem.sourceType === "oneoff",
        durationMin: _optionalChain([rem, 'access', _170 => _170.entries, 'access', _171 => _171[0], 'optionalAccess', _172 => _172.durationMin]) || null,
        activeCal: _optionalChain([rem, 'access', _173 => _173.entries, 'access', _174 => _174[0], 'optionalAccess', _175 => _175.activeCal]) || null,
        totalCal: _optionalChain([rem, 'access', _176 => _176.entries, 'access', _177 => _177[0], 'optionalAccess', _178 => _178.totalCal]) || null
      };
      return createPortal(<div className={"modal-backdrop"} onClick={() => setRetroEditModal(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
          borderRadius: R.r16,
          padding: S.s0,
          maxHeight: "85vh",
          overflowY: "auto"
        }}><div className={"modal-body"}><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: S.s12
            }}><div style={{
                fontSize: FS.fs90,
                color: "#d4cec4",
                fontFamily: "'Inter',sans-serif",
                fontWeight: 600
              }}>{"✎ Edit Completed "}{rem.sourceType === "plan" ? "Plan Session" : "Workout"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setRetroEditModal(null)}>{"✕"}</button></div><div style={{
              fontSize: FS.fs65,
              color: "#8a8478",
              marginBottom: S.s14,
              lineHeight: 1.5
            }}>{rem.sourceName}{" · "}{_optionalChain([rem, 'access', _179 => _179.entries, 'access', _180 => _180[0], 'optionalAccess', _181 => _181.date])}{" · Editing will recalculate XP and update your log."}</div>
            {
              /* Exercise list — editable */
            }<div style={{
              marginBottom: S.s12
            }}>{rem.entries.map((e, i) => {
                const exData = allExById[e.exId];
                if (!exData) return null;
                return <div key={i} style={{
                  background: "rgba(45,42,36,.18)",
                  border: "1px solid rgba(45,42,36,.2)",
                  borderRadius: R.lg,
                  padding: "10px 12px",
                  marginBottom: S.s6
                }}><div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: S.s8,
                    marginBottom: S.s6
                  }}><span style={{
                      fontSize: "1rem"
                    }}>{exData.icon}</span><span style={{
                      fontSize: FS.fs78,
                      color: "#d4cec4",
                      flex: 1,
                      fontWeight: 600
                    }}>{exData.name}</span><button className={"btn btn-danger btn-xs"} onClick={() => {
                      setRetroEditModal(prev => ({
                        ...prev,
                        entries: prev.entries.filter((_, j) => j !== i)
                      }));
                    }}>{"✕"}</button></div><div style={{
                    display: "flex",
                    gap: S.s6
                  }}><div style={{
                      flex: 1
                    }}><label style={{
                        fontSize: FS.fs58,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Sets"}</label><input className={"inp"} type={"number"} min={"1"} max={"20"} value={e.sets || ""} style={{
                        padding: "4px 6px",
                        fontSize: FS.lg
                      }} onChange={ev => {
                        const v = ev.target.value;
                        setRetroEditModal(prev => ({
                          ...prev,
                          entries: prev.entries.map((r, j) => j === i ? {
                            ...r,
                            sets: v
                          } : r)
                        }));
                      }} /></div><div style={{
                      flex: 1
                    }}><label style={{
                        fontSize: FS.fs58,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Reps/Min"}</label><input className={"inp"} type={"number"} min={"1"} max={"300"} value={e.reps || ""} style={{
                        padding: "4px 6px",
                        fontSize: FS.lg
                      }} onChange={ev => {
                        const v = ev.target.value;
                        setRetroEditModal(prev => ({
                          ...prev,
                          entries: prev.entries.map((r, j) => j === i ? {
                            ...r,
                            reps: v
                          } : r)
                        }));
                      }} /></div>{!["cardio", "flexibility"].includes(exData.category) && <div style={{
                      flex: 1
                    }}><label style={{
                        fontSize: FS.fs58,
                        color: "#b0a898",
                        display: "block",
                        marginBottom: S.s4
                      }}>{"Weight"}</label><input className={"inp"} type={"number"} min={"0"} max={"2000"} value={e.weightLbs || ""} style={{
                        padding: "4px 6px",
                        fontSize: FS.lg
                      }} onChange={ev => {
                        const v = ev.target.value;
                        setRetroEditModal(prev => ({
                          ...prev,
                          entries: prev.entries.map((r, j) => j === i ? {
                            ...r,
                            weightLbs: v || null
                          } : r)
                        }));
                      }} /></div>}</div></div>;
              })}</div><div style={{
              display: "flex",
              gap: S.s8
            }}><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1
              }} onClick={() => setRetroEditModal(null)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
                flex: 2
              }} onClick={() => {
                // Recalculate XP and update log entries in place
                const now = new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                });
                const newEntries = rem.entries.map((e, i) => {
                  const updated = retroEditModal.entries[i];
                  if (!updated) return null;
                  const xp = calcExXP(updated.exId, parseInt(updated.sets) || 3, parseInt(updated.reps) || 10, profile.chosenClass, allExById);
                  return {
                    ...e,
                    ...updated,
                    xp,
                    sets: parseInt(updated.sets) || e.sets,
                    reps: parseInt(updated.reps) || e.reps
                  };
                }).filter(Boolean);
                // Replace all matching entries in the log
                const updatedLog = profile.log.map(le => {
                  const matchIdx = rem.entries.findIndex(re => re._idx === le._idx || re.exId === le.exId && re.dateKey === le.dateKey && (re.sourceGroupId === le.sourceGroupId || re.sourcePlanId === le.sourcePlanId));
                  if (matchIdx < 0) return le;
                  const ne = newEntries[matchIdx];
                  return ne ? {
                    ...le,
                    ...ne
                  } : le;
                });
                const totalXP = updatedLog.filter(le => rem.entries.some(re => re._idx === le._idx)).reduce((s, e) => s + e.xp, 0);
                setProfile(p => ({
                  ...p,
                  log: updatedLog
                }));
                setRetroEditModal(null);
                showToast("✓ Workout log updated!");
              }}>{"✓ Save Changes"}</button></div></div></div></div>, document.body);
    })()

    /* ══ ADD TO EXISTING WORKOUT PICKER ════════ */}{addToWorkoutPicker && createPortal(<div className={"modal-backdrop"} onClick={() => setAddToWorkoutPicker(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0,
        maxHeight: "80vh",
        overflowY: "auto"
      }}><div className={"modal-body"}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s14
          }}><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs92,
              color: "#d4cec4",
              fontWeight: 700
            }}>{"➕ Add to Existing Workout"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setAddToWorkoutPicker(null)}>{"✕"}</button></div><div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            marginBottom: S.s12
          }}>{"Adding "}{addToWorkoutPicker.exercises.length}{" exercise"}{addToWorkoutPicker.exercises.length !== 1 ? "s" : ""}{" — choose a workout to append them to:"}</div>
          {
            /* Re-Usable Workouts */
          }{(profile.workouts || []).filter(w => !w.oneOff).length > 0 && <><div style={{
              fontSize: FS.fs62,
              color: "#b4ac9e",
              textTransform: "uppercase",
              letterSpacing: ".08em",
              marginBottom: S.s6
            }}>{"💪 Re-Usable Workouts"}</div>{(profile.workouts || []).filter(w => !w.oneOff).map(wo => <div key={wo.id} style={{
              display: "flex",
              alignItems: "center",
              gap: S.s10,
              padding: "8px 12px",
              borderRadius: R.xl,
              border: "1px solid rgba(45,42,36,.2)",
              marginBottom: S.s6,
              cursor: "pointer",
              background: "rgba(45,42,36,.12)"
            }} onClick={() => {
              const merged = {
                ...wo,
                exercises: [...wo.exercises, ...addToWorkoutPicker.exercises]
              };
              setProfile(p => ({
                ...p,
                workouts: (p.workouts || []).map(w => w.id === wo.id ? merged : w)
              }));
              showToast(`Added to "${wo.name}"! 💪`);
              setAddToWorkoutPicker(null);
            }}><span style={{
                fontSize: "1.3rem"
              }}>{wo.icon}</span><div style={{
                flex: 1,
                minWidth: 0
              }}><div style={{
                  fontSize: FS.fs78,
                  color: "#d4cec4",
                  fontWeight: 600
                }}>{wo.name}</div><div style={{
                  fontSize: FS.sm,
                  color: "#8a8478"
                }}>{wo.exercises.length}{" exercises"}</div></div><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e"
              }}>{"+ add →"}</span></div>)}</>
          /* Scheduled One-Off Workouts */}{(() => {
            const today = todayStr();
            const grouped = {};
            (profile.scheduledWorkouts || []).forEach(sw => {
              if (!sw.sourceWorkoutId || sw.scheduledDate < today) return;
              const key = sw.sourceWorkoutId;
              if (!grouped[key]) grouped[key] = {
                id: sw.sourceWorkoutId,
                name: sw.sourceWorkoutName,
                icon: sw.sourceWorkoutIcon || "⚡",
                date: sw.scheduledDate
              };
            });
            const scheduled = Object.values(grouped);
            if (!scheduled.length) return null;
            return <><div style={{
                fontSize: FS.fs62,
                color: "#e67e22",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                marginBottom: S.s6,
                marginTop: S.s10
              }}>{"⚡ Scheduled One-Off Workouts"}</div>{scheduled.map(g => {
                const wo = (profile.workouts || []).find(w => w.id === g.id) || {
                  id: g.id,
                  name: g.name,
                  icon: g.icon,
                  exercises: [],
                  oneOff: true
                };
                return <div key={g.id} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: S.s10,
                  padding: "8px 12px",
                  borderRadius: R.xl,
                  border: "1px solid rgba(230,126,34,.15)",
                  marginBottom: S.s6,
                  cursor: "pointer",
                  background: "rgba(230,126,34,.04)"
                }} onClick={() => {
                  const merged = {
                    ...wo,
                    exercises: [...wo.exercises, ...addToWorkoutPicker.exercises]
                  };
                  setProfile(p => ({
                    ...p,
                    workouts: (p.workouts || []).find(w => w.id === g.id) ? (p.workouts || []).map(w => w.id === g.id ? merged : w) : [...(p.workouts || []), merged],
                    scheduledWorkouts: (p.scheduledWorkouts || []).map(sw => sw.sourceWorkoutId === g.id ? {
                      ...sw,
                      sourceWorkoutName: merged.name
                    } : sw)
                  }));
                  showToast(`Added to "${g.name}"! ⚡`);
                  setAddToWorkoutPicker(null);
                }}><span style={{
                    fontSize: "1.3rem"
                  }}>{g.icon}</span><div style={{
                    flex: 1,
                    minWidth: 0
                  }}><div style={{
                      fontSize: FS.fs78,
                      color: "#d4cec4",
                      fontWeight: 600
                    }}>{g.name}</div><div style={{
                      fontSize: FS.sm,
                      color: "#8a8478"
                    }}>{"📅 "}{formatScheduledDate(g.date)}</div></div><span style={{
                    fontSize: FS.fs65,
                    color: "#e67e22"
                  }}>{"+ add →"}</span></div>;
              })}</>;
          })()}{(profile.workouts || []).filter(w => !w.oneOff).length === 0 && !(profile.scheduledWorkouts || []).some(sw => sw.scheduledDate >= todayStr() && sw.sourceWorkoutId) && <div className={"empty"}>{"No workouts to add to yet."}<br />{"Create a Re-Usable Workout or schedule a One-Off first."}</div>}</div></div></div>, document.body)}{oneOffModal && createPortal(<div className={"modal-backdrop"} onClick={() => setOneOffModal(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0
      }}><div className={"modal-body"}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s14
          }}><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs92,
              color: "#d4cec4",
              fontWeight: 700
            }}>{"⚡ Name Your One-Off Workout"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setOneOffModal(null)}>{"✕"}</button></div><div className={"field"} style={{
            marginBottom: S.s10
          }}><label>{"Workout Name"}</label><input className={"inp"} placeholder={"e.g. Morning Push Session…"} value={oneOffModal.name} onChange={e => setOneOffModal(m => ({
              ...m,
              name: e.target.value
            }))} autoFocus={true} /></div><div className={"field"} style={{
            marginBottom: S.s14
          }}><label>{"Icon"}</label><div style={{
              display: "flex",
              gap: S.s6,
              flexWrap: "wrap"
            }}>{["⚡", "💪", "🔥", "🏋️", "🏃", "⚔️", "🧱", "🦵", "🤜"].map(ic => <span key={ic} style={{
                fontSize: "1.4rem",
                cursor: "pointer",
                padding: S.s4,
                borderRadius: R.md,
                background: oneOffModal.icon === ic ? "rgba(45,42,36,.3)" : "transparent",
                border: oneOffModal.icon === ic ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
              }} onClick={() => setOneOffModal(m => ({
                ...m,
                icon: ic
              }))}>{ic}</span>)}</div></div><div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            marginBottom: S.s14
          }}>{oneOffModal.exercises.length}{" exercises selected · XP will be calculated on completion"}</div><button className={"btn btn-gold"} style={{
            width: "100%"
          }} disabled={!oneOffModal.name.trim()} onClick={() => {
            const wo = {
              id: uid(),
              name: oneOffModal.name.trim(),
              icon: oneOffModal.icon || "⚡",
              desc: "",
              exercises: oneOffModal.exercises,
              createdAt: todayStr(),
              oneOff: true
            };
            setCompletionModal({
              workout: wo
            });
            setCompletionDate(todayStr());
            setCompletionAction("today");
            setOneOffModal(null);
          }}>{"Next: Log or Schedule →"}</button></div></div></div>, document.body)}{completionModal && (() => {
      const wo = completionModal.workout;
      const xp = wo.exercises.reduce((s, ex) => s + calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById), 0);
      // Pick the dominant muscle group from the workout's first valid exercise as the theme color
      const firstEx = wo.exercises.map(e => allExById[e.exId]).find(Boolean);
      const woMgColor = getMuscleColor(firstEx?.muscleGroup);
      // inPickMode: true when user tapped "Choose Day" or selected a specific date
      // pickerValue: the actual date string when a date is selected
      const inPickMode = completionAction === "past";
      const inScheduleMode = completionAction === "schedule";
      const pickerValue = inPickMode && completionDate !== "pick" ? completionDate : "";
      return createPortal(<div className={"completion-backdrop"} onClick={e => {
        if (e.target !== e.currentTarget) return;
        setCompletionModal(null);
        setCompletionAction("today");
        setScheduleWoDate("");
      }}><div className={"completion-sheet"} role={"dialog"} aria-modal={"true"} aria-label={"Workout completion"} style={{
          "--mg-color": woMgColor
        }}><div style={{
            display: "flex",
            alignItems: "center",
            gap: S.s8
          }}>{completionModal.fromStats && <button className={"btn btn-ghost btn-sm"} style={{
              padding: "4px 8px",
              fontSize: FS.fs75
            }} onClick={() => {
              const prev = completionModal.fromStats;
              setCompletionModal(null);
              setCompletionAction("today");
              setScheduleWoDate("");
              setStatsPromptModal(prev);
            }}>{"← Back"}</button>}<div className={"completion-wo-name"} style={{
              fontSize: FS.fs90,
              flex: 1
            }}>{"⚔ Complete Deed"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => {
              setCompletionModal(null);
              setCompletionAction("today");
              setScheduleWoDate("");
            }}>{"✕"}</button></div>

          {
            /* Workout card */
          }<div className={"completion-wo-card"}><span className={"completion-wo-icon"}>{wo.icon}</span><div><div className={"completion-wo-name"}>{wo.name}</div><div className={"completion-wo-sub"}>{wo.exercises.length}{" exercises · "}{formatXP(xp, {
                  prefix: "⚡ "
                })}</div></div></div>

          {
            /* Options */
          }<div style={{
            display: "flex",
            flexDirection: "column",
            gap: S.s8
          }}><div className={`completion-option ${completionAction === "today" ? "sel" : ""}`} onClick={() => {
              setCompletionAction("today");
              setCompletionDate(todayStr());
            }}><span className={"completion-option-icon"}>{"🔥"}</span><div><div className={"completion-option-title"}>{"Completed Today"}</div><div className={"completion-option-sub"}>{new Date().toLocaleDateString([], {
                    weekday: "long",
                    month: "short",
                    day: "numeric"
                  })}</div></div><div style={{
                marginLeft: "auto",
                width: 18,
                height: 18,
                border: "1.5px solid rgba(180,172,158,.08)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: FS.md,
                background: completionAction === "today" ? "rgba(180,172,158,.25)" : "transparent",
                color: completionAction === "today" ? "#1a1200" : "transparent",
                flexShrink: 0
              }}>{"✓"}</div></div>

            {
              /* Option 2 — Completed on a past day */
            }<div className={`completion-option ${inPickMode ? "sel" : ""}`} onClick={() => {
              setCompletionAction("past");
              setCompletionDate("");
            }}><span className={"completion-option-icon"}>{"📋"}</span><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"completion-option-title"}>{"Choose Completion Day"}</div><div className={"completion-option-sub"}>{inPickMode && pickerValue ? new Date(pickerValue + "T12:00:00").toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  }) : "Log for a past date"}</div></div><div style={{
                marginLeft: "auto",
                width: 18,
                height: 18,
                border: "1.5px solid rgba(180,172,158,.08)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: FS.md,
                background: inPickMode && pickerValue ? "rgba(180,172,158,.25)" : "transparent",
                color: inPickMode && pickerValue ? "#1a1200" : "transparent",
                flexShrink: 0
              }}>{"✓"}</div></div>{inPickMode && <div style={{
              paddingLeft: 8
            }}><input className={"inp"} type={"date"} max={todayStr()} value={pickerValue} onChange={e => setCompletionDate(e.target.value)} style={{
                marginTop: S.s2
              }} autoFocus={true} />{pickerValue && <div style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                marginTop: S.s6
              }}>{"📅 "}{new Date(pickerValue + "T12:00:00").toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric"
                })}</div>}</div>

            /* Option 3 — Schedule for a future date */}<div className={`completion-option ${inScheduleMode ? "sel" : ""}`} onClick={() => {
              setCompletionAction("schedule");
              setScheduleWoDate("");
            }}><span className={"completion-option-icon"}>{"📅"}</span><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"completion-option-title"}>{"Schedule for Later"}</div><div className={"completion-option-sub"}>{inScheduleMode && scheduleWoDate ? new Date(scheduleWoDate + "T12:00:00").toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  }) : "Add to calendar for a future date"}</div></div><div style={{
                marginLeft: "auto",
                width: 18,
                height: 18,
                border: "1.5px solid rgba(180,172,158,.08)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: FS.md,
                background: inScheduleMode && scheduleWoDate ? "rgba(180,172,158,.25)" : "transparent",
                color: inScheduleMode && scheduleWoDate ? "#1a1200" : "transparent",
                flexShrink: 0
              }}>{"✓"}</div></div>{inScheduleMode && <div style={{
              paddingLeft: 8
            }}><input className={"inp"} type={"date"} min={(() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                return d.toISOString().slice(0, 10);
              })()} value={scheduleWoDate} onChange={e => setScheduleWoDate(e.target.value)} style={{
                marginTop: S.s2
              }} autoFocus={true} />{scheduleWoDate && <div style={{
                fontSize: FS.fs65,
                color: "#b4ac9e",
                marginTop: S.s6
              }}>{"📅 "}{new Date(scheduleWoDate + "T12:00:00").toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric"
                })}</div>}</div>}</div>

          {
            /* XP preview — only for log actions */
          }{(completionAction === "today" || inPickMode && pickerValue) && <div className={"completion-xp-preview"}><div className={"completion-xp-preview-label"}>{"XP to be claimed"}</div><div className={"completion-xp-preview-value"}>{"⚡ "}{xp.toLocaleString()}</div></div>}<div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => {
              setCompletionModal(null);
              setCompletionAction("today");
              setScheduleWoDate("");
            }}>{"Cancel"}</button>{!inScheduleMode ? <button className={"btn btn-cls"} style={{
              flex: 2
            }} disabled={inPickMode && !pickerValue} onClick={() => {
              if (completionModal.soloExCallback) {
                const dateStr = completionAction === "past" && completionDate && completionDate !== "pick" ? completionDate : todayStr();
                completionModal.soloExCallback(dateStr);
                setCompletionModal(null);
                setCompletionDate("");
                setCompletionAction("today");
                setScheduleWoDate("");
              } else {
                confirmWorkoutComplete();
              }
            }}>{"✓ Confirm & Claim XP"}</button> : <button className={"btn btn-gold"} style={{
              flex: 2
            }} disabled={!scheduleWoDate} onClick={() => {
              if (completionModal.soloExScheduleCallback) {
                completionModal.soloExScheduleCallback(scheduleWoDate);
              } else {
                scheduleWorkoutForDate();
              }
            }}>{"📅 Schedule Workout"}</button>}</div></div></div>, document.body);
    })()

    /* ══ LOG ENTRY EDIT MODAL ════════════════════ */}{logEditModal && logEditDraft && (() => {
      const d = logEditDraft;
      const setD = patch => setLogEditDraft(prev => ({
        ...prev,
        ...patch
      }));
      const exData = allExById[d.exId];
      const isCardio = exData ? exData.category === "cardio" : false;
      const isFlex = exData ? exData.category === "flexibility" : false;
      const showWeight = !isCardio && !isFlex;
      const showDist = isCardio;
      const showZone = isCardio;
      const metric = isMetric(profile.units);
      const wUnit = weightLabel(profile.units);
      const dUnit = distLabel(profile.units);
      const previewXP = calcEntryXP(d);
      const xpDiff = previewXP - (_optionalChain([profile, 'access', _182 => _182.log, 'access', _183 => _183[logEditModal.idx], 'optionalAccess', _184 => _184.xp]) || 0);
      return createPortal(<div className={"ledit-backdrop"} onClick={() => setLogEditModal(null)}><div className={"ledit-sheet"} onClick={e => e.stopPropagation()}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}><div><div style={{
                fontFamily: "'Inter',sans-serif",
                fontSize: FS.fs88,
                color: "#d4cec4"
              }}>{"✎ Edit Log Entry"}</div><div style={{
                fontSize: FS.fs65,
                color: "#8a8478",
                marginTop: S.s2
              }}>{d.icon}{" "}{d.exercise}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setLogEditModal(null)}>{"✕"}</button></div>

          {
            /* Source info */
          }{(d.sourcePlanName || d.sourceWorkoutName) && <div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            fontStyle: "italic",
            padding: "6px 10px",
            background: "rgba(45,42,36,.12)",
            borderRadius: R.r7,
            border: "1px solid rgba(45,42,36,.2)"
          }}>{d.sourcePlanName && <span>{"📋 From plan: "}<b style={{
                color: "#b4ac9e"
              }}>{d.sourcePlanName}</b></span>}{d.sourceWorkoutName && <span>{"💪 From workout: "}<b style={{
                color: UI_COLORS.accent
              }}>{d.sourceWorkoutName}</b></span>}</div>

          /* Date */}<div className={"field"}><label>{"Date"}</label><input className={"inp"} type={"date"} value={d.dateKey || ""} onChange={e => {
              const v = e.target.value;
              const disp = v ? new Date(v + "T12:00:00").toLocaleDateString() : d.date;
              setD({
                dateKey: v,
                date: disp
              });
            }} /></div>

          {
            /* Sets + Reps/Duration */
          }<div className={"r2"}><div className={"field"}><label>{"Sets"}</label><input className={"inp"} type={"number"} min={"1"} max={"99"} value={d.sets || 1} onChange={e => setD({
                sets: parseInt(e.target.value) || 1
              })} /></div><div className={"field"}><label>{isCardio || isFlex ? "Duration (min)" : "Reps"}</label><input className={"inp"} type={"number"} min={"1"} max={"999"} value={d.reps || 1} onChange={e => setD({
                reps: parseInt(e.target.value) || 1
              })} /></div></div>

          {
            /* Weight */
          }{showWeight && <div className={"field"}><label>{"Weight ("}{wUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} step={"2.5"} value={d.weightLbs ? metric ? lbsToKg(d.weightLbs) : d.weightLbs : ""} placeholder={"0"} onChange={e => {
              const v = parseFloat(e.target.value) || null;
              setD({
                weightLbs: v ? metric ? parseFloat(kgToLbs(v)) : v : null
              });
            }} /></div>

          /* Distance */}{showDist && <div className={"field"}><label>{"Distance ("}{dUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} step={"0.1"} value={d.distanceMi ? metric ? miToKm(d.distanceMi) : d.distanceMi : ""} placeholder={"0"} onChange={e => {
              const v = parseFloat(e.target.value) || null;
              setD({
                distanceMi: v ? metric ? parseFloat(kmToMi(v)) : v : null
              });
            }} /></div>

          /* HR Zone */}{showZone && <div className={"field"}><label>{"HR Zone"}</label><div className={"hr-zone-row"}>{HR_ZONES.map((z, zi) => {
                const zn = zi + 1;
                return <div key={zn} className={`hr-zone-btn ${d.hrZone === zn ? "sel" : ""}`} style={{
                  "--zc": z.color,
                  borderColor: d.hrZone === zn ? z.color : "rgba(45,42,36,.2)"
                }} onClick={() => setD({
                  hrZone: d.hrZone === zn ? null : zn
                })}><span className={"hz-name"} style={{
                    color: z.color
                  }}>{"Z"}{zn}</span><span className={"hz-bpm"}>{z.short}</span></div>;
              })}</div></div>

          /* XP preview */}<div style={{
            background: "rgba(45,42,36,.16)",
            border: "1px solid rgba(180,172,158,.06)",
            borderRadius: R.xl,
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}><div style={{
              fontSize: FS.md,
              color: "#8a8478"
            }}>{"New XP for this entry"}</div><div style={{
              display: "flex",
              alignItems: "center",
              gap: S.s8
            }}>{xpDiff !== 0 && <div style={{
                fontSize: FS.md,
                color: xpDiff > 0 ? UI_COLORS.success : UI_COLORS.danger
              }}>{xpDiff > 0 ? "+" : ""}{xpDiff}{" XP"}</div>}<div style={{
                fontFamily: "'Inter',sans-serif",
                fontSize: "1rem",
                color: "#b4ac9e"
              }}>{"⚡ "}{previewXP}</div></div></div>

          {
            /* Actions */
          }<div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-danger btn-sm"} style={{
              flex: 0,
              padding: "8px 12px"
            }} onClick={() => {
              setLogEditModal(null);
              deleteLogEntryByIdx(logEditModal.idx);
            }}>{"🗑"}</button><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => setLogEditModal(null)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
              flex: 2
            }} onClick={saveLogEdit}>{"✦ Save Changes"}</button></div></div></div>, document.body);
    })()

    /* ══ CONFIRM DELETE MODAL ════════════════════ */}{confirmDelete && (() => {
      // Support either type-based dispatch (existing pattern) or a generic
      // {title, body, onConfirm, confirmLabel, cancelLabel} payload so
      // window.confirm() can be replaced consistently.
      const cd = confirmDelete;
      const isGeneric = typeof cd.onConfirm === 'function';
      const titleText = cd.title || (cd.type === "plan" ? "Delete Plan?" : cd.type === "workout" ? "Delete Workout?" : cd.type === "exercise" ? "Delete Exercise?" : cd.type === "logEntry" ? "Delete Log Entry?" : cd.type === "char" ? "Delete Character?" : "Are you sure?");
      const bodyEl = cd.body ? typeof cd.body === 'string' ? <span>{cd.body}</span> : cd.body : cd.type === "char" ? "This will permanently erase all your XP, battle log, plans, and workouts. This cannot be undone." : cd.type === "logEntry" ? <span>{"Remove "}<span className={"cdel-name"}>{cd.name}</span>{" from your log? "}{cd.xp && <span>{"This will deduct "}{cd.xp}{" XP."}</span>}</span> : <span>{"Are you sure you want to delete "}<span className={"cdel-name"}>{cd.name}</span>{"? This cannot be undone."}</span>;
      return createPortal(<div className={"cdel-backdrop"} onClick={e => {
        if (e.target === e.currentTarget) setConfirmDelete(null);
      }}><div className={"cdel-sheet"} role={"dialog"} aria-modal={"true"} aria-labelledby={"cdel-title"}><div className={"cdel-icon"} aria-hidden={"true"}>{cd.icon}</div><div id={"cdel-title"} className={"cdel-title"}>{titleText}</div><div className={"cdel-body"}>{bodyEl}</div>{cd.warning && <div className={"cdel-warning"}>{cd.warning}</div>}<div style={{
            display: "flex",
            gap: S.s8
          }}><button className={"btn btn-ghost btn-sm"} style={{
              flex: 1
            }} onClick={() => setConfirmDelete(null)}>{cd.cancelLabel || "Cancel"}</button><button className={"btn btn-danger"} style={{
              flex: 1
            }} onClick={() => {
              setConfirmDelete(null);
              if (isGeneric) {
                cd.onConfirm();
                return;
              }
              const {
                type,
                id
              } = cd;
              if (type === "plan") plansContainerRef.current?.doDeletePlan(id);else if (type === "workout") _doDeleteWorkout(id);else if (type === "exercise") _doDeleteCustomEx(id);else if (type === "logEntry") _doDeleteLogEntry(id);else if (type === "char") _doResetChar();
            }}>{cd.confirmLabel || "🗑 Delete"}</button></div></div></div>, document.body);
    })()

    /* ══ MAP OVERLAY ═════════════════════════════ */}{mapOpen && (() => {
      const myPos = getMapPosition(profile.xp, level);
      const myRegion = MAP_REGIONS[myPos.regionIdx];
      const weekStart = (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - d.getDay());
        return d.toISOString().slice(0, 10);
      })();
      const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart;
      const friendPositions = friends.map(f => {
        const fLv = Math.max(1, Math.floor(Math.log(Math.max(1, f.xp || 0) / 100 + 1) * 3));
        const fPos = getMapPosition(f.xp || 0, fLv);
        return {
          ...f,
          mapX: fPos.x,
          mapY: fPos.y,
          regionIdx: fPos.regionIdx
        };
      });
      return <div style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.92)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflowY: "auto",
        padding: "14px 12px 30px"
      }}><div style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: S.s10,
          flexShrink: 0
        }}><div><div style={{
              fontFamily: "'Cinzel Decorative',serif,Arial",
              fontSize: FS.fs95,
              color: "#b4ac9e",
              letterSpacing: ".08em"
            }}>{"⚔️ Auranthel"}</div><div style={{
              fontSize: FS.fs65,
              color: "#8a8478",
              marginTop: S.s2,
              display: "flex",
              gap: S.s8,
              alignItems: "center",
              flexWrap: "wrap"
            }}><span>{myRegion.icon}{" "}{myRegion.name}{" · Level "}{level}</span><span style={{
                color: "#b4ac9e"
              }}>{myRegion.boost.emoji}{" +7% "}{myRegion.boost.label}</span>{travelActive && <span style={{
                color: UI_COLORS.success
              }}>{"⚡ +10% Travel"}</span>}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => {
            setMapOpen(false);
            setMapTooltip(null);
          }}>{"✕"}</button></div>

        {
          /* Zoom controls + map */
        }<MapSVG myPos={myPos} myRegion={myRegion} friendPositions={friendPositions} mapTooltip={mapTooltip} setMapTooltip={setMapTooltip} travelActive={travelActive} profile={profile} />

        {
          /* Tooltip / travel panel */
        }{mapTooltip && <div style={{
          width: "100%",
          maxWidth: 420,
          marginTop: S.s10,
          background: "rgba(10,8,4,.97)",
          border: "1px solid rgba(180,172,158,.08)",
          borderRadius: R.r10,
          padding: "12px 14px",
          flexShrink: 0
        }}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s8
          }}><div><div style={{
                fontSize: FS.fs84,
                color: "#d4cec4",
                fontWeight: 600
              }}>{mapTooltip.name}</div><div style={{
                fontSize: FS.fs65,
                color: "#8a8478",
                marginTop: S.s2
              }}>{mapTooltip.cls || "Unknown"}{" · "}{mapTooltip.region}</div></div><button className={"btn btn-ghost btn-xs"} onClick={() => setMapTooltip(null)}>{"✕"}</button></div>{!mapTooltip.alreadyTraveling ? <div><div style={{
              fontSize: FS.fs68,
              color: "#8a8478",
              marginBottom: S.s8,
              lineHeight: 1.5
            }}>{"Travel to their location for "}<strong style={{
                color: "#b4ac9e"
              }}>{"+10% XP boost"}</strong>{" on all workouts this week."}</div><button className={"btn btn-gold"} style={{
              width: "100%",
              fontSize: FS.lg
            }} onClick={() => {
              const ws = (() => {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() - d.getDay());
                return d.toISOString().slice(0, 10);
              })();
              setProfile(p => ({
                ...p,
                travelBoost: {
                  friendId: mapTooltip.id,
                  friendName: mapTooltip.name,
                  weekStart: ws
                }
              }));
              showToast(`⚔️ Traveling with ${mapTooltip.name}! +10% XP this week.`);
              setMapTooltip(null);
            }}>{"⚔️ Travel with "}{mapTooltip.name}</button></div> : <div style={{
            fontSize: FS.fs68,
            color: _optionalChain([profile, 'access', _185 => _185.travelBoost, 'optionalAccess', _186 => _186.friendId]) === mapTooltip.id ? UI_COLORS.success : "#8a8478",
            textAlign: "center",
            padding: "6px 0"
          }}>{_optionalChain([profile, 'access', _187 => _187.travelBoost, 'optionalAccess', _188 => _188.friendId]) === mapTooltip.id ? "✓ You are traveling with this warrior this week" : `Already traveling with ${_optionalChain([profile, 'access', _189 => _189.travelBoost, 'optionalAccess', _190 => _190.friendName])} this week`}</div>}</div>

        /* Legend */}<div style={{
          width: "100%",
          maxWidth: 420,
          marginTop: S.s12,
          flexShrink: 0
        }}><div style={{
            fontSize: FS.sm,
            color: "#8a8478",
            marginBottom: S.s6,
            letterSpacing: ".06em",
            textTransform: "uppercase"
          }}>{"Your Journey"}</div><div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: S.s6
          }}>{MAP_REGIONS.map((r, i) => {
              const isVisited = i <= myPos.regionIdx,
                isCurrent = i === myPos.regionIdx;
              return <div key={r.id} style={{
                display: "flex",
                alignItems: "center",
                gap: S.s6,
                padding: "4px 8px",
                background: isCurrent ? "rgba(45,42,36,.2)" : "rgba(45,42,36,.12)",
                border: `1px solid ${isCurrent ? "rgba(180,172,158,.15)" : isVisited ? "rgba(45,42,36,.22)" : "rgba(45,42,36,.18)"}`,
                borderRadius: R.md,
                opacity: isVisited ? 1 : .4
              }}><span style={{
                  fontSize: FS.lg
                }}>{r.icon}</span><div><div style={{
                    fontSize: FS.sm,
                    color: isCurrent ? "#b4ac9e" : isVisited ? "#d4cec4" : "#5a6060",
                    lineHeight: 1.2
                  }}>{r.name}{isCurrent && <span style={{
                      color: "#b4ac9e",
                      marginLeft: S.s4
                    }}>{"◀"}</span>}</div><div style={{
                    fontSize: FS.fs52,
                    color: isCurrent ? "#b4ac9e" : isVisited ? "#8a8478" : "#3a4040",
                    lineHeight: 1.2
                  }}>{r.boost.emoji}{" "}{r.boost.label}{" +7% · Lv"}{r.levels[0]}{"–"}{r.levels[1]}</div></div></div>;
            })}</div></div>

        {
          /* Active travel banner */
        }{travelActive && <div style={{
          width: "100%",
          maxWidth: 420,
          marginTop: S.s10,
          padding: "10px 14px",
          background: "rgba(46,204,113,.06)",
          border: "1px solid rgba(46,204,113,.2)",
          borderRadius: R.r10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0
        }}><div><div style={{
              fontSize: FS.lg,
              color: UI_COLORS.success
            }}>{"⚡ Travel Boost Active"}</div><div style={{
              fontSize: FS.fs62,
              color: "#8a8478",
              marginTop: S.s2
            }}>{"With "}<strong style={{
                color: "#d4cec4"
              }}>{profile.travelBoost.friendName}</strong>{" · +10% XP all workouts this week"}</div></div><button className={"btn btn-ghost btn-xs"} style={{
            fontSize: FS.sm,
            color: UI_COLORS.danger,
            borderColor: "rgba(231,76,60,.3)"
          }} onClick={() => {
            setProfile(p => ({
              ...p,
              travelBoost: null
            }));
            showToast("Travel ended.");
          }}>{"End"}</button></div>}</div>;
    })()

    /* ══ SHARE MODAL ═════════════════════════════ */}{shareModal && createPortal(<div className={"modal-backdrop"} onClick={() => setShareModal(null)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0
      }}><div className={"modal-body"}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s14
          }}><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs88,
              color: "#d4cec4",
              fontWeight: 700
            }}>{"⇪ Share with "}{shareModal.friendName}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setShareModal(null)}>{"✕"}</button></div>{shareModal.step === "pick-type" && <><div style={{
              fontSize: FS.lg,
              color: "#8a8478",
              marginBottom: S.s12
            }}>{"What would you like to share?"}</div><div style={{
              display: "flex",
              gap: S.s8
            }}><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1,
                fontSize: FS.lg
              }} onClick={() => setShareModal({
                ...shareModal,
                step: "pick-workout"
              })}>{"💪 A Workout"}</button><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1,
                fontSize: FS.lg
              }} onClick={() => setShareModal({
                ...shareModal,
                step: "pick-exercise"
              })}>{"⚡ A Custom Exercise"}</button></div></>}{shareModal.step === "pick-workout" && <><div style={{
              fontSize: FS.lg,
              color: "#8a8478",
              marginBottom: S.s10
            }}>{"Choose a workout to share:"}</div>{(profile.workouts || []).length === 0 && <div className={"empty"}>{"No workouts saved yet."}</div>}{(profile.workouts || []).map(wo => <div key={wo.id} style={{
              display: "flex",
              alignItems: "center",
              gap: S.s10,
              padding: "9px 0",
              borderBottom: "1px solid rgba(45,42,36,.15)",
              cursor: "pointer"
            }} onClick={() => shareWithFriend("workout", wo, shareModal.friendId, shareModal.friendName)}><span style={{
                fontSize: "1.2rem"
              }}>{wo.icon}</span><div style={{
                flex: 1
              }}><div style={{
                  fontSize: FS.fs78,
                  color: "#d4cec4"
                }}>{wo.name}</div><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478"
                }}>{_optionalChain([wo, 'access', _191 => _191.exercises, 'optionalAccess', _192 => _192.length]) || 0}{" exercises"}</div></div><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e"
              }}>{"Share →"}</span></div>)}<button className={"btn btn-ghost btn-sm"} style={{
              width: "100%",
              marginTop: S.s10
            }} onClick={() => setShareModal({
              ...shareModal,
              step: "pick-type"
            })}>{"← Back"}</button></>}{shareModal.step === "pick-exercise" && <><div style={{
              fontSize: FS.lg,
              color: "#8a8478",
              marginBottom: S.s10
            }}>{"Choose a custom exercise to share:"}</div>{(profile.customExercises || []).length === 0 && <div className={"empty"}>{"No custom exercises yet."}</div>}{(profile.customExercises || []).map(ex => <div key={ex.id} style={{
              display: "flex",
              alignItems: "center",
              gap: S.s10,
              padding: "9px 0",
              borderBottom: "1px solid rgba(45,42,36,.15)",
              cursor: "pointer"
            }} onClick={() => shareWithFriend("exercise", ex, shareModal.friendId, shareModal.friendName)}><span style={{
                fontSize: "1.2rem"
              }}>{ex.icon}</span><div style={{
                flex: 1
              }}><div style={{
                  fontSize: FS.fs78,
                  color: "#d4cec4"
                }}>{ex.name}</div><div style={{
                  fontSize: FS.fs62,
                  color: "#8a8478",
                  textTransform: "capitalize"
                }}>{ex.category}</div></div><span style={{
                fontSize: FS.fs65,
                color: "#b4ac9e"
              }}>{"Share →"}</span></div>)}<button className={"btn btn-ghost btn-sm"} style={{
              width: "100%",
              marginTop: S.s10
            }} onClick={() => setShareModal({
              ...shareModal,
              step: "pick-type"
            })}>{"← Back"}</button></>}</div></div></div>, document.body)

    /* ══ FEEDBACK MODAL ══════════════════════════ */}{feedbackOpen && createPortal(<div className={"modal-backdrop"} onClick={() => setFeedbackOpen(false)}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0
      }}><div className={"modal-body"}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: S.s14
          }}><div className={"feedback-title"}>{"🛟 Support"}</div><button className={"btn btn-ghost btn-sm"} onClick={() => setFeedbackOpen(false)}>{"✕"}</button></div>{!feedbackSent && <div style={{
            display: "flex",
            gap: S.s6,
            marginBottom: S.s14
          }}>{["bug", "idea", "help"].map(t => <button key={t} onClick={() => setFeedbackType(t)} style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: R.lg,
              fontSize: FS.lg,
              fontWeight: 600,
              border: feedbackType === t ? "1.5px solid #c9a84c" : "1.5px solid #3a342c",
              background: feedbackType === t ? "#2a2318" : "transparent",
              color: feedbackType === t ? "#c9a84c" : "#8a8478",
              cursor: "pointer",
              textTransform: "capitalize"
            }}>{t === "bug" ? "🐛 Bug" : t === "idea" ? "💡 Idea" : "🛟 Help"}</button>)}</div>}{feedbackSent ? helpConfirmShown ? <div style={{
            textAlign: "center",
            padding: "24px 0"
          }}><div style={{
              fontSize: "2rem",
              marginBottom: S.s10
            }}>{"📬"}</div><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs88,
              color: "#b4ac9e",
              marginBottom: S.s6
            }}>{"Help request received!"}</div><div style={{
              fontSize: FS.lg,
              color: "#8a8478",
              lineHeight: 1.6,
              maxWidth: 280,
              margin: "0 auto"
            }}>{"You’ll receive an email from Support@aurisargames.com upon review that will ask for your 12-character Private User ID to verify your identity."}</div><button className={"btn btn-ghost btn-sm"} style={{
              marginTop: S.s16
            }} onClick={() => setFeedbackOpen(false)}>{"Close"}</button></div> : <div style={{
            textAlign: "center",
            padding: "24px 0"
          }}><div style={{
              fontSize: "2rem",
              marginBottom: S.s10
            }}>{"⚡"}</div><div style={{
              fontFamily: "'Inter',sans-serif",
              fontSize: FS.fs88,
              color: "#b4ac9e",
              marginBottom: S.s6
            }}>{"Feedback received!"}</div><div style={{
              fontSize: FS.lg,
              color: "#8a8478"
            }}>{"Thanks for helping forge Aurisar into something legendary."}</div><button className={"btn btn-ghost btn-sm"} style={{
              marginTop: S.s16
            }} onClick={() => setFeedbackOpen(false)}>{"Close"}</button></div> : <><div className={"field"} style={{
              marginBottom: S.s8
            }}><label>{"Email Address"}</label><input className={"inp"} type={"email"} placeholder={"your@email.com"} value={feedbackEmail} onChange={e => setFeedbackEmail(e.target.value)} /></div><div className={"field"} style={{
              marginBottom: S.s8
            }}><label>{"Account ID"}</label><input className={"inp"} type={"text"} placeholder={"e.g. A7XK9M"} value={feedbackAccountId} onChange={e => setFeedbackAccountId(e.target.value)} /></div><div className={"field"} style={{
              marginBottom: S.s12
            }}><label>{feedbackType === "bug" ? "Describe the bug" : feedbackType === "help" ? "How can we help?" : "What's on your mind?"}</label><textarea className={"inp"} rows={5} style={{
                resize: "vertical",
                minHeight: 100,
                lineHeight: 1.5
              }} placeholder={feedbackType === "idea" ? "I'd love to see…" : feedbackType === "bug" ? "When I tap… it does…" : "Describe your issue…"} value={feedbackText} onChange={e => setFeedbackText(e.target.value)} /></div>
            // Cloudflare Turnstile widget (skipped if site key not set).
            {TURNSTILE_SITE_KEY && <div ref={turnstileContainerRef} style={{
              marginBottom: 12,
              display: "flex",
              justifyContent: "center"
            }} />}<button className={"btn btn-gold"} style={{
              width: "100%"
            }} disabled={!feedbackText.trim() || TURNSTILE_SITE_KEY && !turnstileToken} onClick={async () => {
              const msg = feedbackText.trim();
              const type = feedbackType;
              const email = feedbackEmail.trim();
              const acctId = feedbackAccountId.trim();
              const tsToken = turnstileToken;
              // Show success immediately (optimistic UI)
              setFeedbackSent(true);
              if (type === "help") setHelpConfirmShown(true);
              setFeedbackText("");
              // Store in Supabase
              try {
                await sb.from("feedback").insert({
                  user_id: _optionalChain([authUser, 'optionalAccess', _193 => _193.id]) || null,
                  email: email || "anonymous",
                  type,
                  message: msg,
                  account_id: acctId || null,
                  created_at: new Date().toISOString()
                });
              } catch (e) {
                console.log("Supabase feedback insert failed:", e);
              }
              // Send email to support@aurisargames.com for all types
              try {
                await fetch("/api/send-support-email", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    type,
                    message: msg,
                    email,
                    accountId: acctId,
                    turnstileToken: tsToken
                  })
                });
              } catch (e) {
                console.log("Support email failed:", e);
              }
              // For Idea/Bug, also create a GitHub issue
              if (type === "idea" || type === "bug") {
                try {
                  await fetch("/api/create-github-issue", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                      type,
                      message: msg,
                      email,
                      accountId: acctId,
                      turnstileToken: tsToken
                    })
                  });
                } catch (e) {
                  console.log("GitHub issue creation failed:", e);
                }
              }
            }}>{"Submit"}</button></>}</div></div></div>, document.body)}</div>;
}
export default App;