import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { List } from 'react-window';
import './styles/app.css';
import { CLASSES, EXERCISES } from './data/exercises';
import { EX_BY_ID, CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, CLASS_SVG_PATHS, QUESTS, WORKOUT_TEMPLATES, PLAN_TEMPLATES, CHECKIN_REWARDS, KEYWORD_CLASS_MAP, PARTICLES, STORAGE_KEY, EMPTY_PROFILE, NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES, MUSCLE_COLORS, MUSCLE_META, TYPE_COLORS, UI_COLORS, MAP_REGIONS } from './data/constants';
import { _nullishCoalesce, _optionalChain, uid, clone, todayStr } from './utils/helpers';
import { loadSave, doSave, flushSave, setPreviewMode, loadAdminFlags } from './utils/storage';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, ftInToCm, cmToFtIn, weightLabel, distLabel, displayWt, displayDist, pctToSlider, sliderToPct } from './utils/units';
import { buildXPTable, XP_TABLE, xpToLevel, xpForLevel, xpForNext, calcBMI, detectClassFromAnswers, detectClass, calcExXP, calcPlanXP, calcDayXP, calcExercisePBs, calcDecisionTreeBonus, calcCharStats, checkQuestCompletion, getMuscleColor, getTypeColor, hrRange, scaleWeight, scaleDur } from './utils/xp';
import { secToHMS, HMSToSec, normalizeHHMM, secToHHMMSplit, HHMMToSec, combineHHMMSec } from './utils/time';
import { formatXP } from './utils/format';
import { FS, R, S } from './utils/tokens';
import { sb } from './utils/supabase';
import { ensureRestDay } from './utils/ensureRestDay';
import { useWorkoutCompletion } from './state/useWorkoutCompletion';
import { _exercisesLoaded, loadExercises, useExercises } from './utils/exerciseLibrary';
import { useModalLifecycle } from './utils/useModalLifecycle';
import { useUiState } from './state/useUiState';
import { useAuthState } from './state/useAuthState';
import { useExerciseFilters } from './features/exercises/useExerciseFilters';
import ExerciseLibraryTab from './features/exercises/ExerciseLibraryTab';
import GrimoireGridTab from './features/exercises/GrimoireGridTab';
import MyWorkoutsSubTab from './features/exercises/MyWorkoutsSubTab';
import MessagesTab from './features/social/MessagesTab';
import GuildTab from './features/social/GuildTab';
import HistoryTab from './features/history/HistoryTab';
import LogEntryEditModal from './features/history/LogEntryEditModal';
import RetroEditModal from './features/history/RetroEditModal';
import QuestsTab from './features/quests/QuestsTab';
import CharacterTab from './features/character/CharacterTab';
import XpBarFlash from './features/profile/XpBarFlash';
import { useAvatarConfig } from './features/avatar/useAvatarConfig.js';
import MapOverlay from './features/character/MapOverlay';
import WorkoutsTab from './features/workouts/WorkoutsTab';
import WorkoutExercisePicker from './features/workouts/WorkoutExercisePicker';
import CompletionModal from './features/workouts/CompletionModal';
import CalendarTab from './features/calendar/CalendarTab';
import LeaderboardTab from './features/leaderboard/LeaderboardTab';
import ProfileTab from './features/profile/ProfileTab';
import OnboardingScreen from './features/onboarding/OnboardingScreen';
import ClassRevealScreen from './features/onboarding/ClassRevealScreen';
import ConfirmDeleteModal from './components/ConfirmDeleteModal';
import ExerciseEditorModal from './features/exercises/ExerciseEditorModal';
import QuickLogModal from './features/exercises/QuickLogModal';

// ── Debounce utility ──
function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}


import { ExIcon, getExIconName, getExIconColor } from './components/ExIcon';
import { ClassIcon } from './components/ClassIcon';
import { getRegionIdx, getMapPosition, MapSVG } from './components/MapSVG';
import LoginScreen from './components/LoginScreen';
import PrivacyPolicy from './components/PrivacyPolicy';
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
const WorldOverlay = React.lazy(() => import('./features/world/WorldOverlay.jsx'));
import PlansTabContainer from './components/PlansTabContainer';
import LiveWorkoutBanner from './components/LiveWorkoutBanner';
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
    passkeyPanelOpen,
    setPasskeyPanelOpen,
    passkeyFactors,
    setPasskeyFactors,
    passkeyMsg,
    setPasskeyMsg,
    passkeyRegistering,
    setPasskeyRegistering,
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
  const { config: avatarConfig, save: saveAvatarConfig, saving: savingAvatar } = useAvatarConfig(authUser?.id);
  const [isAdmin, setIsAdmin] = useState(false); // set from profiles.is_admin column on login
  const [showWorld, setShowWorld] = useState(false);
  const [previewPinEnabled] = useState(true); // on/off switch for preview PIN gate
  const [detectedClass, setDetectedClass] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = sessionStorage.getItem('aurisar_post_oauth_tab');
      if (saved) {
        sessionStorage.removeItem('aurisar_post_oauth_tab');
        return saved;
      }
    } catch { /* sessionStorage may be unavailable in some contexts */ }
    return "workout";
  });
  const [prevTab, setPrevTab] = useState("workout");

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
  const [liveWorkout, setLiveWorkout] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aurisar-live-workout') || 'null'); } catch { return null; }
  });
  const [pendingLiveWorkout, setPendingLiveWorkout] = useState(null);
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
        try {
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
        } catch (e) {
          console.error("[auth] PASSWORD_RECOVERY handler threw:", e);
          setScreen("landing");
        }
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
      try {
        const adminFlags = await loadAdminFlags(_optionalChain([user, 'optionalAccess', _25a => _25a.id]) || null);
        if (adminFlags.disabled_at) {
          await sb.auth.signOut();
          setAuthMsg("Your account has been disabled. Contact support.");
          setScreen("login");
          return;
        }
        setIsAdmin(adminFlags.is_admin);
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
      } catch (e) {
        console.error("[auth] onAuthStateChange SIGNED_IN handler threw:", e);
        setScreen(s => s === "main" ? s : "landing");
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
    if (liveWorkout) {
      localStorage.setItem('aurisar-live-workout', JSON.stringify(liveWorkout));
    } else {
      localStorage.removeItem('aurisar-live-workout');
    }
  }, [liveWorkout]);
  useEffect(() => {
    const uid = authUser?.id || null;
    // Skip while auth is still initializing (uid === null means session hasn't
    // resolved yet). Clearing here would wipe a restored workout before the
    // real user ID is known. We only want to clear when a *different* user is
    // confirmed (uid is known and doesn't match).
    if (uid !== null && liveWorkout && liveWorkout.userId !== uid) {
      setLiveWorkout(null);
      localStorage.removeItem('aurisar-live-workout');
    }
  }, [authUser?.id]);
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
      // Also refresh passkey factors
      await loadPasskeyFactors();
    } catch (e) {
      console.warn("MFA check error:", e);
    }
  }
  async function loadPasskeyFactors() {
    try {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (!error && data) {
        setPasskeyFactors((data.webauthn ?? []).filter(f => f.status === "verified"));
      }
    } catch (e) {
      console.warn("Passkey load error:", e);
    }
  }
  async function registerPasskey() {
    setPasskeyRegistering(true);
    setPasskeyMsg(null);
    try {
      const { error } = await sb.auth.registerPasskey();
      if (error) {
        setPasskeyMsg({ ok: false, text: error.message });
      } else {
        setPasskeyMsg({ ok: true, text: "✓ Passkey registered successfully." });
        await loadPasskeyFactors();
      }
    } catch (e) {
      setPasskeyMsg({ ok: false, text: e.message ?? "Passkey registration failed." });
    }
    setPasskeyRegistering(false);
  }
  async function removePasskey(factorId) {
    setPasskeyMsg(null);
    try {
      const { error } = await sb.auth.mfa.unenroll({ factorId });
      if (error) {
        setPasskeyMsg({ ok: false, text: "Failed to remove: " + error.message });
      } else {
        setPasskeyFactors(prev => prev.filter(f => f.id !== factorId));
        setPasskeyMsg({ ok: true, text: "✓ Passkey removed." });
      }
    } catch (e) {
      setPasskeyMsg({ ok: false, text: e.message ?? "Failed to remove passkey." });
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
  }, [activeTab, authUser?.id]);
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
    // Flush any debounced profile writes BEFORE invalidating auth — otherwise
    // a queued Supabase upsert lands as an unauthenticated request and a
    // queued localStorage write would rewrite the cache after the wipe below.
    try { await flushSave(); } catch { /* noop */ }
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
    setPasskeyPanelOpen(false);
    setPasskeyFactors([]);
    setPasskeyMsg(null);
    setPasskeyRegistering(false);
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

  // ── Exercise filter derivations — extracted to features/exercises ──
  // Eight memoized derivations the library tab + grimoire grid consume.
  // The hook keeps the heavy allExercises scans off the App-render hot
  // path (Finding #5 + #6 from docs/performance-audit.md).
  const {
    grimoireFiltered,
    libFiltered,
    libAvailableTypes,
    libMuscleCardData,
    libDiscoverRows,
    libMuscleOpts,
    libEquipOpts,
  } = useExerciseFilters({
    allExercises,
    _exReady,
    exSearch, exCatFilters, exMuscleFilter, showFavsOnly,
    favoriteExercises: profile.favoriteExercises,
    libSearchDebounced, libTypeFilters, libMuscleFilters, libEquipFilters,
  });

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
      mult: 1,
      prevXp: profile.xp
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
      mult: 1,
      prevXp: profile.xp
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
      mult: 1,
      prevXp: profile.xp
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
          travel: travelActive,
          prevXp: profile.xp
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
        travel: travelActive,
        prevXp: profile.xp
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
  function _buildLiveExercises(wo) {
    return (wo.exercises || []).map((ex, i) => {
      const exData = allExById[ex.exId];
      const cat = (exData?.category || 'strength').toLowerCase();
      const rows = [{ sets: ex.sets, reps: ex.reps }, ...(ex.extraRows || [])];
      const setsDesc = rows.map(r => `${r.sets || '?'}×${r.reps || '?'}`).join(' / ');
      return {
        exId: ex.exId,
        name: exData?.name || ex.exId,
        category: cat,
        noSets: NO_SETS_EX_IDS.has(ex.exId),
        sets: ex.sets, reps: ex.reps,
        weightLbs: ex.weightLbs || null,
        extraRows: ex.extraRows || [],
        setsDesc,
        supersetWith: (typeof ex.supersetWith === 'number' && ex.supersetWith >= 0) ? ex.supersetWith : null,
        done: false,
      };
    });
  }

  function startLiveWorkout(wo) {
    if (liveWorkout && liveWorkout.workoutId !== wo.id) {
      setPendingLiveWorkout(wo);
      return;
    }
    setLiveWorkout({ workoutId: wo.id, name: wo.name, icon: wo.icon, startedAt: new Date().toISOString(), exercises: _buildLiveExercises(wo), userId: authUser?.id || null });
  }

  function confirmReplaceLiveWorkout() {
    setLiveWorkout({ workoutId: pendingLiveWorkout.id, name: pendingLiveWorkout.name, icon: pendingLiveWorkout.icon, startedAt: new Date().toISOString(), exercises: _buildLiveExercises(pendingLiveWorkout), userId: authUser?.id || null });
    setPendingLiveWorkout(null);
  }

  function handleToggleLiveEx(i) {
    setLiveWorkout(lw => lw ? { ...lw, exercises: lw.exercises.map((e, idx) => idx === i ? { ...e, done: !e.done } : e) } : null);
  }

  function handleFinishLiveWorkout(exercises) {
    if (!liveWorkout || exercises.length === 0) { setLiveWorkout(null); return; }
    const filteredWo = {
      id: liveWorkout.workoutId, name: liveWorkout.name, icon: liveWorkout.icon,
      exercises: exercises.map(ex => ({ exId: ex.exId, sets: ex.sets, reps: ex.reps, weightLbs: ex.weightLbs || null, extraRows: ex.extraRows || [] })),
      durationMin: null, activeCal: null, totalCal: null,
    };
    openStatsPromptIfNeeded(filteredWo, (woWithStats, _sr) => {
      setCompletionModal({ workout: woWithStats, fromStats: _sr });
      setCompletionDate(todayStr());
      setCompletionAction("today");
    });
    setLiveWorkout(null);
  }

  function handleUpdateLiveEx(i, fields) {
    setLiveWorkout(lw => {
      if (!lw) return null;
      return { ...lw, exercises: lw.exercises.map((e, idx) => {
        if (idx !== i) return e;
        const merged = { ...e, ...fields };
        const rows = [{ sets: merged.sets, reps: merged.reps }, ...(merged.extraRows || [])];
        const setsDesc = rows.map(r => `${r.sets || '?'}×${r.reps || '?'}`).join(' / ');
        return { ...merged, setsDesc };
      }) };
    });
  }

  function handleRemoveLiveEx(i) {
    setLiveWorkout(lw => {
      if (!lw) return null;
      return { ...lw, exercises: lw.exercises.filter((_, idx) => idx !== i) };
    });
  }

  function handleAddLiveEx(exId, sets, reps, weightLbs) {
    const exData = allExById[exId];
    const cat = (exData?.category || 'strength').toLowerCase();
    setLiveWorkout(lw => {
      if (!lw) return null;
      const newEx = { exId, name: exData?.name || exId, category: cat, noSets: NO_SETS_EX_IDS.has(exId), sets, reps, weightLbs: weightLbs || null, extraRows: [], setsDesc: `${sets}×${reps}`, supersetWith: null, done: false };
      return { ...lw, exercises: [...lw.exercises, newEx] };
    });
  }

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

  // Workout completion handler is extracted into useWorkoutCompletion (finding
  // #3 in docs/performance-audit.md) — modal close happens before the heavy
  // setProfile re-render and the rest is wrapped in startTransition.
  const { confirmWorkoutComplete } = useWorkoutCompletion({
    profile, setProfile,
    allExById, applyAutoCheckIn, getMult,
    showToast, setXpFlash, setWorkoutSubTab,
    completionModal, setCompletionModal,
    completionDate, setCompletionDate,
    completionAction, setCompletionAction,
    setScheduleWoDate,
  });
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
  if (window.location.pathname === '/privacy') return <PrivacyPolicy />;

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
    }} />)}{xpFlash && <><div className={"xp-flash"}>{formatXP(xpFlash.amount, {
        signed: true
      })}{xpFlash.mult > 1.02 ? " ⚡" : ""}</div><XpBarFlash amount={xpFlash.amount} mult={xpFlash.mult} prevXp={xpFlash.prevXp ?? 0} cls={cls} /></>}{toast && <div className={"toast"} role={"status"} aria-live={"polite"} aria-atomic={"true"} onClick={() => setToast(null)}>{toast}</div>}{friendExBanner && <div className={"friend-ex-banner"} key={friendExBanner.key} onClick={() => setFriendExBanner(null)}><div className={"friend-ex-banner-icon"}>{friendExBanner.exerciseIcon || "\uD83D\uDCAA"}</div><div className={"friend-ex-banner-text"}><div className={"friend-ex-banner-title"}>{friendExBanner.friendName}{" completed "}{friendExBanner.exerciseName}{"!"}</div>{friendExBanner.pbInfo && <div className={"friend-ex-banner-pb"}>{formatFriendPB(friendExBanner.pbInfo)}</div>}</div></div>}{showWNMockup && lazyMount(<WorkoutNotificationMockup onClose={() => setShowWNMockup(false)} />)

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

    /* ══ ONBOARDING ═════════════════════════════ */}{screen === "onboard" && (
      <OnboardingScreen
        obStep={obStep}
        setObStep={setObStep}
        obName={obName}
        setObName={setObName}
        obFirstName={obFirstName}
        setObFirstName={setObFirstName}
        obLastName={obLastName}
        setObLastName={setObLastName}
        obAge={obAge}
        setObAge={setObAge}
        obGender={obGender}
        setObGender={setObGender}
        obFreq={obFreq}
        setObFreq={setObFreq}
        obTiming={obTiming}
        setObTiming={setObTiming}
        obSports={obSports}
        setObSports={setObSports}
        obPriorities={obPriorities}
        setObPriorities={setObPriorities}
        obStyle={obStyle}
        setObStyle={setObStyle}
        obState={obState}
        setObState={setObState}
        obCountry={obCountry}
        setObCountry={setObCountry}
        handleOnboard={handleOnboard}
      />
    )

    /* ══ CLASS REVEAL ═══════════════════════════ */}{screen === "classReveal" && detectedClass && (
      <ClassRevealScreen
        detectedClass={detectedClass}
        confirmClass={confirmClass}
        setScreen={setScreen}
      />
    )

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
    } : {}}><div className={"hud-top"}><button className={"profile-pill"} onClick={() => guardAll(() => { if (activeTab === "profile") { setActiveTab(prevTab); } else { setPrevTab(activeTab); setActiveTab("profile"); } })}>{activeTab === "profile" ? <div className={"ava"} style={{width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.2rem",color:cls.glow}}>{"←"}</div> : <><div className={"ava"} style={{width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center"}}><ClassIcon classKey={profile.chosenClass} size={16} color={cls.glow} /></div><span style={{fontSize:"0.9rem"}}>{"🔥"}</span><span className={"profile-pill-streak"}>{profile.checkInStreak}</span></>}</button><div style={{flex:1}} /><button className={"btn nav-menu-btn btn-ghost"} style={{position:"relative"}} onClick={() => setNavMenuOpen(v => !v)}>{"☰"}{msgUnreadTotal > 0 && <div style={{position:"absolute",top:1,right:2,width:8,height:8,borderRadius:"50%",background:UI_COLORS.danger,border:"1.5px solid #0c0c0a"}} />}</button></div>

      {
        /* ══ DROPDOWN MENU — rendered outside hud-top to escape backdrop-filter stacking context ══ */
      }{navMenuOpen && <div onClick={() => setNavMenuOpen(false)} style={{
        position: "fixed",
        inset: 0,
        zIndex: 900
      }} />}{navMenuOpen && <div className={"nav-menu-panel"}>{[{
          icon: "⚔️",
          label: "Character",
          action: () => guardAll(() => {
            setActiveTab("character");
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

      /* ══ BOTTOM TAB BAR — fixed iOS material ══ */}<div className={"hud-nav-panel"}><div className={"tabs"}>{[["workout", "Exercises", "mdi:dumbbell"], ["workouts", "Workouts", "mdi:weight-lifter"], ["calendar", "Calendar", "mdi:calendar-blank"], ["social", "Guild", "game-icons:tribal-pendant"]].map(([t, l, iconName]) => {
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
          })}<button key="world" className={`tab ${activeTab === "world" ? "on" : ""}`} title="Enter Aurisar World" onClick={() => guardAll(() => { setPrevTab(activeTab); setActiveTab("world"); })} style={{position:"relative"}}><span className={"tab-icon"}><img src={`https://api.iconify.design/mdi/earth.svg?color=${encodeURIComponent(activeTab === "world" ? "#d4cec4" : "#8a8478")}`} alt={""} width={22} height={22} style={{display:"block"}} /></span><span className={"tab-label"}>{"World"}</span><span style={{position:"absolute",top:4,right:6,width:6,height:6,borderRadius:"50%",background:"#4ade80",boxShadow:"0 0 4px #4ade80"}} /></button></div></div>{liveWorkout && <LiveWorkoutBanner liveWorkout={liveWorkout} onToggleExercise={handleToggleLiveEx} onFinish={handleFinishLiveWorkout} onDiscard={() => setLiveWorkout(null)} onUpdateExercise={handleUpdateLiveEx} onRemoveExercise={handleRemoveLiveEx} onAddExercise={handleAddLiveEx} allExById={allExById} allExercises={allExercises} units={profile.units} />}{pendingLiveWorkout && <div style={{position:"fixed",inset:0,zIndex:820,background:"rgba(0,0,0,.5)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={() => setPendingLiveWorkout(null)}><div style={{width:"100%",maxWidth:520,background:"linear-gradient(160deg,rgba(22,22,16,.82),rgba(12,12,10,.78))",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",border:"1px solid rgba(180,172,158,.1)",borderRadius:"16px 16px 0 0",padding:"20px 16px calc(28px + env(safe-area-inset-bottom,0px))"}} onClick={e => e.stopPropagation()}><div style={{fontFamily:"'Cinzel',serif",fontSize:".88rem",color:"#d4cec4",marginBottom:8}}>{"Replace Active Workout?"}</div><div style={{fontSize:".75rem",color:"#8a8478",marginBottom:20,lineHeight:1.5}}>{`You're already tracking ${liveWorkout.icon} ${liveWorkout.name}. Discard it and start ${pendingLiveWorkout.icon} ${pendingLiveWorkout.name}?`}</div><div style={{display:"flex",gap:10}}><button className={"btn btn-ghost btn-sm"} style={{flex:1}} onClick={() => setPendingLiveWorkout(null)}>{"Keep Current"}</button><button className={"btn btn-gold"} style={{flex:2}} onClick={confirmReplaceLiveWorkout}>{`Discard & Track ${pendingLiveWorkout.icon}`}</button></div></div></div>}<div className={"scroll-area"} style={activeTab === "messages" && msgView === "chat" ? {
        overflowY: "hidden",
        display: "flex",
        flexDirection: "column",
        paddingBottom: 0
      } : {}}>{activeTab === "workout" && <>

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

            /* ══ GRIMOIRE GRID ══ */}<GrimoireGridTab
              grimoireFiltered={grimoireFiltered}
              profile={profile}
              setProfile={setProfile}
              getMult={getMult}
              multiMode={multiMode}
              multiSelEx={multiSelEx}
              setMultiSelEx={setMultiSelEx}
              selEx={selEx}
              setSelEx={setSelEx}
              setMusclePickerOpen={setMusclePickerOpen}
              setSets={setSets}
              setReps={setReps}
              setExWeight={setExWeight}
              setWeightPct={setWeightPct}
              setDistanceVal={setDistanceVal}
              setHrZone={setHrZone}
              setExHHMM={setExHHMM}
              setExSec={setExSec}
              setQuickRows={setQuickRows}
              setDetailEx={setDetailEx}
              setDetailImgIdx={setDetailImgIdx}
              openExEditor={openExEditor}
            /></>

          /* ══ LIBRARY SUB-TAB ══ */}{exSubTab === "library" && <ExerciseLibraryTab
            libFiltered={libFiltered}
            libAvailableTypes={libAvailableTypes}
            libMuscleCardData={libMuscleCardData}
            libDiscoverRows={libDiscoverRows}
            libMuscleOpts={libMuscleOpts}
            libEquipOpts={libEquipOpts}
            libSearch={libSearch}
            setLibSearch={setLibSearch}
            setLibSearchDebounced={setLibSearchDebounced}
            libTypeFilters={libTypeFilters}
            setLibTypeFilters={setLibTypeFilters}
            libMuscleFilters={libMuscleFilters}
            setLibMuscleFilters={setLibMuscleFilters}
            libEquipFilters={libEquipFilters}
            setLibEquipFilters={setLibEquipFilters}
            libOpenDrop={libOpenDrop}
            setLibOpenDrop={setLibOpenDrop}
            debouncedSetLibSearch={debouncedSetLibSearch}
            libDetailEx={libDetailEx}
            setLibDetailEx={setLibDetailEx}
            libSelectMode={libSelectMode}
            setLibSelectMode={setLibSelectMode}
            libSelected={libSelected}
            setLibSelected={setLibSelected}
            libBrowseMode={libBrowseMode}
            setLibBrowseMode={setLibBrowseMode}
            libVisibleCount={libVisibleCount}
            setLibVisibleCount={setLibVisibleCount}
            profile={profile}
            setProfile={setProfile}
            allExercises={allExercises}
            allExById={allExById}
            setActiveTab={setActiveTab}
            setWbExercises={setWbExercises}
            setWbName={setWbName}
            setWbIcon={setWbIcon}
            setWbDesc={setWbDesc}
            setWbEditId={setWbEditId}
            setWbIsOneOff={setWbIsOneOff}
            setWorkoutView={setWorkoutView}
            setAddToWorkoutPicker={setAddToWorkoutPicker}
            setSavePlanWizard={setSavePlanWizard}
            setSpwName={setSpwName}
            setSpwIcon={setSpwIcon}
            setSpwDate={setSpwDate}
            setSpwMode={setSpwMode}
            setSpwTargetPlanId={setSpwTargetPlanId}
            setSpwSelected={setSpwSelected}
            setSelEx={setSelEx}
            setSets={setSets}
            setReps={setReps}
            setExWeight={setExWeight}
            setWeightPct={setWeightPct}
            setHrZone={setHrZone}
            setDistanceVal={setDistanceVal}
            setExHHMM={setExHHMM}
            setExSec={setExSec}
            setQuickRows={setQuickRows}
          />
          /* ══ MY WORKOUTS SUB-TAB ══ */}{exSubTab === "myworkouts" && (
            <MyWorkoutsSubTab
              profile={profile}
              setProfile={setProfile}
              allExById={allExById}
              favSelectMode={favSelectMode}
              setFavSelectMode={setFavSelectMode}
              favSelected={favSelected}
              setFavSelected={setFavSelected}
              setExSubTab={setExSubTab}
              setLibDetailEx={setLibDetailEx}
              setActiveTab={setActiveTab}
              setWbExercises={setWbExercises}
              setWbName={setWbName}
              setWbIcon={setWbIcon}
              setWbDesc={setWbDesc}
              setWbEditId={setWbEditId}
              setWbIsOneOff={setWbIsOneOff}
              setWorkoutView={setWorkoutView}
              setAddToWorkoutPicker={setAddToWorkoutPicker}
              setSavePlanWizard={setSavePlanWizard}
              setSpwName={setSpwName}
              setSpwIcon={setSpwIcon}
              setSpwDate={setSpwDate}
              setSpwMode={setSpwMode}
              setSpwTargetPlanId={setSpwTargetPlanId}
              openExEditor={openExEditor}
              deleteCustomEx={deleteCustomEx}
            />
          )}</>

        /* ── WORKOUTS TAB ────────────────────── */}{activeTab === "workouts" && (
          <WorkoutsTab
            workoutView={workoutView}
            setWorkoutView={setWorkoutView}
            workoutSubTab={workoutSubTab}
            setWorkoutSubTab={setWorkoutSubTab}
            woLabelFilters={woLabelFilters}
            setWoLabelFilters={setWoLabelFilters}
            woLabelDropOpen={woLabelDropOpen}
            setWoLabelDropOpen={setWoLabelDropOpen}
            newLabelInput={newLabelInput}
            setNewLabelInput={setNewLabelInput}
            activeWorkout={activeWorkout}
            setActiveWorkout={setActiveWorkout}
            liveWorkout={liveWorkout}
            startLiveWorkout={startLiveWorkout}
            collapsedWo={collapsedWo}
            setCollapsedWo={setCollapsedWo}
            profile={profile}
            setProfile={setProfile}
            recipeFilter={recipeFilter}
            setRecipeFilter={setRecipeFilter}
            recipeCatDrop={recipeCatDrop}
            setRecipeCatDrop={setRecipeCatDrop}
            expandedRecipeDesc={expandedRecipeDesc}
            setExpandedRecipeDesc={setExpandedRecipeDesc}
            expandedRecipeEx={expandedRecipeEx}
            setExpandedRecipeEx={setExpandedRecipeEx}
            wbName={wbName}
            setWbName={setWbName}
            wbIcon={wbIcon}
            setWbIcon={setWbIcon}
            wbDesc={wbDesc}
            setWbDesc={setWbDesc}
            wbExercises={wbExercises}
            setWbExercises={setWbExercises}
            wbEditId={wbEditId}
            setWbEditId={setWbEditId}
            wbIsOneOff={wbIsOneOff}
            setWbIsOneOff={setWbIsOneOff}
            wbLabels={wbLabels}
            setWbLabels={setWbLabels}
            wbDuration={wbDuration}
            setWbDuration={setWbDuration}
            wbDurSec={wbDurSec}
            setWbDurSec={setWbDurSec}
            wbActiveCal={wbActiveCal}
            setWbActiveCal={setWbActiveCal}
            wbTotalCal={wbTotalCal}
            setWbTotalCal={setWbTotalCal}
            wbCopySource={wbCopySource}
            setWbCopySource={setWbCopySource}
            wbIconPickerOpen={wbIconPickerOpen}
            setWbIconPickerOpen={setWbIconPickerOpen}
            wbExPickerOpen={wbExPickerOpen}
            setWbExPickerOpen={setWbExPickerOpen}
            wbTotalXP={wbTotalXP}
            collapsedWbEx={collapsedWbEx}
            setCollapsedWbEx={setCollapsedWbEx}
            ssChecked={ssChecked}
            setSsChecked={setSsChecked}
            ssAccordion={ssAccordion}
            setSsAccordion={setSsAccordion}
            dragWbExIdx={dragWbExIdx}
            setDragWbExIdx={setDragWbExIdx}
            initWorkoutBuilder={initWorkoutBuilder}
            copyWorkout={copyWorkout}
            openStatsPromptIfNeeded={openStatsPromptIfNeeded}
            setCompletionModal={setCompletionModal}
            setCompletionDate={setCompletionDate}
            setCompletionAction={setCompletionAction}
            setConfirmDelete={setConfirmDelete}
            setSelEx={setSelEx}
            setPendingSoloRemoveId={setPendingSoloRemoveId}
            quickLogSoloEx={quickLogSoloEx}
            openScheduleEx={openScheduleEx}
            setAddToWorkoutPicker={setAddToWorkoutPicker}
            openExEditor={openExEditor}
            setAddToPlanPicker={setAddToPlanPicker}
            deleteWorkout={deleteWorkout}
            reorderSupersetPair={reorderSupersetPair}
            reorderWbEx={reorderWbEx}
            saveBuiltWorkout={saveBuiltWorkout}
            saveAsNewWorkout={saveAsNewWorkout}
            daysUntil={daysUntil}
            showToast={showToast}
            allExById={allExById}
            clsColor={cls.color}
          />
        )

        /* ── PLANS TAB ───────────────────────── */}{<div style={activeTab !== "plans" ? {display:"none"} : undefined}><PlansTabContainer ref={plansContainerRef} profile={profile} setProfile={setProfile} allExercises={allExercises} allExById={allExById} cls={cls} showToast={showToast} setConfirmDelete={setConfirmDelete} setDetailEx={setDetailEx} setDetailImgIdx={setDetailImgIdx} onSchedulePlan={openSchedulePlan} onScheduleEx={openScheduleEx} onRemoveScheduledWorkout={removeScheduledWorkout} onStatsPrompt={openStatsPromptIfNeeded} onOpenExEditor={openExEditor} setXpFlash={setXpFlash} applyAutoCheckIn={applyAutoCheckIn} pendingOpen={plansPendingOpen} onPendingOpenDone={() => setPlansPendingOpen(null)} setRetroEditModal={setRetroEditModal} /></div>

        /* ── CALENDAR TAB ────────────────────── */}{activeTab === "calendar" && (
          <CalendarTab
            calViewDate={calViewDate}
            setCalViewDate={setCalViewDate}
            calSelDate={calSelDate}
            setCalSelDate={setCalSelDate}
            openLogGroups={openLogGroups}
            toggleLogGroup={toggleLogGroup}
            profile={profile}
            allExById={allExById}
            setCalExDetailModal={setCalExDetailModal}
            setPlansPendingOpen={setPlansPendingOpen}
            setActiveTab={setActiveTab}
            removePlanSchedule={removePlanSchedule}
            removeScheduledWorkout={removeScheduledWorkout}
          />
        )

        /* ── LEADERBOARD TAB ─────────────────────── */}{activeTab === "leaderboard" && (
          <LeaderboardTab
            lbFilter={lbFilter}
            setLbFilter={setLbFilter}
            lbScope={lbScope}
            setLbScope={setLbScope}
            lbStateFilters={lbStateFilters}
            setLbStateFilters={setLbStateFilters}
            lbCountryFilters={lbCountryFilters}
            setLbCountryFilters={setLbCountryFilters}
            lbStateDropOpen={lbStateDropOpen}
            setLbStateDropOpen={setLbStateDropOpen}
            lbCountryDropOpen={lbCountryDropOpen}
            setLbCountryDropOpen={setLbCountryDropOpen}
            lbData={lbData}
            lbWorldRanks={lbWorldRanks}
            lbLoading={lbLoading}
            profile={profile}
            myPublicId={myPublicId}
            authUser={authUser}
          />
        )
        /* ── QUESTS TAB ──────────────────────── */}{activeTab === "quests" && (
          <QuestsTab
            profile={profile}
            questCat={questCat}
            setQuestCat={setQuestCat}
            claimQuestReward={claimQuestReward}
            claimManualQuest={claimManualQuest}
          />
        )

        /* ── HISTORY TAB ─────────────────────── */}{activeTab === "history" && <HistoryTab
          profile={profile}
          setProfile={setProfile}
          allExById={allExById}
          logSubTab={logSubTab}
          setLogSubTab={setLogSubTab}
          openLogGroups={openLogGroups}
          toggleLogGroup={toggleLogGroup}
          openLogEdit={openLogEdit}
          deleteLogEntryByIdx={deleteLogEntryByIdx}
          openSaveWorkoutWizard={openSaveWorkoutWizard}
          openSavePlanWizard={openSavePlanWizard}
          setRetroEditModal={setRetroEditModal}
          setConfirmDelete={setConfirmDelete}
          showToast={showToast}
          clsColor={cls.color}
        />}{activeTab === "social" && (
          <GuildTab
            socialMsg={socialMsg}
            friendSearch={friendSearch}
            setFriendSearch={setFriendSearch}
            friendSearchResult={friendSearchResult}
            setFriendSearchResult={setFriendSearchResult}
            setSocialMsg={setSocialMsg}
            searchFriendByEmail={searchFriendByEmail}
            friendSearchLoading={friendSearchLoading}
            sendFriendRequest={sendFriendRequest}
            rescindFriendRequest={rescindFriendRequest}
            friendRequests={friendRequests}
            acceptFriendRequest={acceptFriendRequest}
            rejectFriendRequest={rejectFriendRequest}
            incomingShares={incomingShares}
            acceptShare={acceptShare}
            declineShare={declineShare}
            outgoingRequests={outgoingRequests}
            friends={friends}
            removeFriend={removeFriend}
            friendRecentEvents={friendRecentEvents}
            authUser={authUser}
            socialLoading={socialLoading}
            loadSocialData={loadSocialData}
            loadIncomingShares={loadIncomingShares}
            openDmWithUser={openDmWithUser}
            setShareModal={setShareModal}
          />
        )

        /* ── MESSAGES TAB ─────────────────────── */}{activeTab === "messages" && <MessagesTab
          msgConversations={msgConversations}
          msgActiveChannel={msgActiveChannel}
          setMsgActiveChannel={setMsgActiveChannel}
          msgMessages={msgMessages}
          setMsgMessages={setMsgMessages}
          msgInput={msgInput}
          setMsgInput={setMsgInput}
          msgScrollRef={msgScrollRef}
          msgLoading={msgLoading}
          msgSending={msgSending}
          msgView={msgView}
          setMsgView={setMsgView}
          sendMsg={sendMsg}
          loadChannelMessages={loadChannelMessages}
          loadConversations={loadConversations}
          loadUnreadCount={loadUnreadCount}
          authUser={authUser}
        />

        /* ── CHARACTER TAB ────────────────────── */}{activeTab === "character" && (
          <CharacterTab
            profile={profile}
            cls={cls}
            level={level}
            clsKey={clsKey}
            myPublicId={myPublicId}
            charSubTab={charSubTab}
            setCharSubTab={setCharSubTab}
            avatarConfig={avatarConfig}
            onSaveAvatar={saveAvatarConfig}
            savingAvatar={savingAvatar}
          />
        )

        /* ── PROFILE TAB ─────────────────────────── */}{activeTab === "profile" && (
          <ProfileTab
            profile={profile}
            setProfile={setProfile}
            cls={cls}
            level={level}
            authUser={authUser}
            editMode={editMode}
            setEditMode={setEditMode}
            securityMode={securityMode}
            setSecurityMode={setSecurityMode}
            notifMode={notifMode}
            setNotifMode={setNotifMode}
            draft={draft}
            setDraft={setDraft}
            emailPanelOpen={emailPanelOpen}
            setEmailPanelOpen={setEmailPanelOpen}
            newEmail={newEmail}
            setNewEmail={setNewEmail}
            emailMsg={emailMsg}
            setEmailMsg={setEmailMsg}
            showEmail={showEmail}
            setShowEmail={setShowEmail}
            showPrivateId={showPrivateId}
            setShowPrivateId={setShowPrivateId}
            myPublicId={myPublicId}
            myPrivateId={myPrivateId}
            mfaPanelOpen={mfaPanelOpen}
            setMfaPanelOpen={setMfaPanelOpen}
            mfaEnrolling={mfaEnrolling}
            setMfaEnrolling={setMfaEnrolling}
            mfaQR={mfaQR}
            setMfaQR={setMfaQR}
            mfaSecret={mfaSecret}
            setMfaSecret={setMfaSecret}
            mfaCode={mfaCode}
            setMfaCode={setMfaCode}
            mfaMsg={mfaMsg}
            setMfaMsg={setMfaMsg}
            mfaEnabled={mfaEnabled}
            mfaUnenrolling={mfaUnenrolling}
            mfaRecoveryCodes={mfaRecoveryCodes}
            setMfaRecoveryCodes={setMfaRecoveryCodes}
            mfaCodesRemaining={mfaCodesRemaining}
            mfaHasLegacyCodes={mfaHasLegacyCodes}
            mfaDisableConfirm={mfaDisableConfirm}
            setMfaDisableConfirm={setMfaDisableConfirm}
            mfaDisableCode={mfaDisableCode}
            setMfaDisableCode={setMfaDisableCode}
            mfaDisableMsg={mfaDisableMsg}
            setMfaDisableMsg={setMfaDisableMsg}
            pwPanelOpen={pwPanelOpen}
            setPwPanelOpen={setPwPanelOpen}
            pwNew={pwNew}
            setPwNew={setPwNew}
            pwConfirm={pwConfirm}
            setPwConfirm={setPwConfirm}
            pwMsg={pwMsg}
            setPwMsg={setPwMsg}
            phonePanelOpen={phonePanelOpen}
            setPhonePanelOpen={setPhonePanelOpen}
            phoneInput={phoneInput}
            setPhoneInput={setPhoneInput}
            setPhoneOtpSent={setPhoneOtpSent}
            setPhoneOtpCode={setPhoneOtpCode}
            phoneMsg={phoneMsg}
            setPhoneMsg={setPhoneMsg}
            pbFilterOpen={pbFilterOpen}
            setPbFilterOpen={setPbFilterOpen}
            pbSelectedFilters={pbSelectedFilters}
            setPbSelectedFilters={setPbSelectedFilters}
            showPwProfile={showPwProfile}
            setShowPwProfile={setShowPwProfile}
            saveEdit={saveEdit}
            openEdit={openEdit}
            changePassword={changePassword}
            changeEmailAddress={changeEmailAddress}
            resetChar={resetChar}
            verifyMfaEnroll={verifyMfaEnroll}
            startMfaEnroll={startMfaEnroll}
            unenrollMfa={unenrollMfa}
            regenerateRecoveryCodes={regenerateRecoveryCodes}
            confirmMfaDisableWithTotp={confirmMfaDisableWithTotp}
            guardRecoveryCodes={guardRecoveryCodes}
            checkMfaStatus={checkMfaStatus}
            passkeyPanelOpen={passkeyPanelOpen}
            setPasskeyPanelOpen={setPasskeyPanelOpen}
            passkeyFactors={passkeyFactors}
            passkeyMsg={passkeyMsg}
            setPasskeyMsg={setPasskeyMsg}
            passkeyRegistering={passkeyRegistering}
            registerPasskey={registerPasskey}
            removePasskey={removePasskey}
            toggleNameVisibility={toggleNameVisibility}
            toggleNotifPref={toggleNotifPref}
            profileComplete={profileComplete}
            showToast={showToast}
            doCheckIn={doCheckIn}
            onOpenRetroCheckIn={() => { setRetroCheckInModal(true); setRetroDate(""); }}
            onOpenWNMockup={() => setShowWNMockup(true)}
          />
        )}</div> {
        /* scroll-area */
      }</div>

    /* ══ EXERCISE EDITOR MODAL ══════════════════ */}{exEditorOpen && exEditorDraft && (
      <ExerciseEditorModal
        exEditorDraft={exEditorDraft}
        setExEditorDraft={setExEditorDraft}
        setExEditorOpen={setExEditorOpen}
        exEditorMode={exEditorMode}
        allExById={allExById}
        allExercises={allExercises}
        profile={profile}
        saveExEditor={saveExEditor}
        openExEditor={openExEditor}
        deleteCustomEx={deleteCustomEx}
        newExDraft={newExDraft}
      />
    )

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

    /* ══ WORKOUT EXERCISE PICKER ═════════════════ */}{wbExPickerOpen && (
      <WorkoutExercisePicker
        pickerSearch={pickerSearch}
        setPickerSearch={setPickerSearch}
        pickerMuscle={pickerMuscle}
        setPickerMuscle={setPickerMuscle}
        pickerTypeFilter={pickerTypeFilter}
        setPickerTypeFilter={setPickerTypeFilter}
        pickerEquipFilter={pickerEquipFilter}
        setPickerEquipFilter={setPickerEquipFilter}
        pickerOpenDrop={pickerOpenDrop}
        setPickerOpenDrop={setPickerOpenDrop}
        pickerSelected={pickerSelected}
        setPickerSelected={setPickerSelected}
        pickerConfigOpen={pickerConfigOpen}
        setPickerConfigOpen={setPickerConfigOpen}
        allExercises={allExercises}
        allExById={allExById}
        profile={profile}
        closePicker={closePicker}
        openExEditor={openExEditor}
        pickerToggleEx={pickerToggleEx}
        pickerUpdateEx={pickerUpdateEx}
        commitPickerToWorkout={commitPickerToWorkout}
      />
    )}
    {/* ══ ADD WORKOUT TO PLAN PICKER ══════════════ */}{addToPlanPicker && createPortal(<div className={"atp-backdrop"} onClick={() => setAddToPlanPicker(null)}><div className={"atp-sheet"} onClick={e => e.stopPropagation()}><div style={{
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
    /* ══ SINGLE EXERCISE QUICK-LOG MODAL ════════ */}{selEx && (
      <QuickLogModal
        selEx={selEx}
        setSelEx={setSelEx}
        allExById={allExById}
        profile={profile}
        sets={sets} setSets={setSets}
        reps={reps} setReps={setReps}
        exWeight={exWeight} setExWeight={setExWeight}
        exHHMM={exHHMM} setExHHMM={setExHHMM}
        exSec={exSec} setExSec={setExSec}
        distanceVal={distanceVal} setDistanceVal={setDistanceVal}
        hrZone={hrZone} setHrZone={setHrZone}
        exIncline={exIncline} setExIncline={setExIncline}
        exSpeed={exSpeed} setExSpeed={setExSpeed}
        quickRows={quickRows} setQuickRows={setQuickRows}
        weightPct={weightPct} setWeightPct={setWeightPct}
        pendingSoloRemoveId={pendingSoloRemoveId}
        setPendingSoloRemoveId={setPendingSoloRemoveId}
        logExercise={logExercise}
        openExEditor={openExEditor}
        setLibDetailEx={setLibDetailEx}
        setAddToWorkoutPicker={setAddToWorkoutPicker}
        setSavePlanWizard={setSavePlanWizard}
        setSpwSelected={setSpwSelected}
        setSpwName={setSpwName}
        setSpwIcon={setSpwIcon}
        setSpwDate={setSpwDate}
        setSpwMode={setSpwMode}
        setSpwTargetPlanId={setSpwTargetPlanId}
      />
    )}

    {/* ══ STATS PROMPT MODAL ══════════════════════ */}{statsPromptModal && createPortal(<div className={"modal-backdrop"} onClick={() => setStatsPromptModal(null)} style={{ alignItems: "center" }}><div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{
        borderRadius: R.r16,
        padding: S.s0,
        "--mg-color": cls.color,
        background: "linear-gradient(160deg,#12120e,#0c0c0a)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
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
          }}><button className={"btn btn-cls"} style={{
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

    /* ══ RETRO EDIT MODAL ═══════════════════════ */}{retroEditModal && (
      <RetroEditModal
        retroEditModal={retroEditModal}
        setRetroEditModal={setRetroEditModal}
        allExById={allExById}
        profile={profile}
        setProfile={setProfile}
        showToast={showToast}
      />
    )

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
          }}>{"Next: Log or Schedule →"}</button></div></div></div>, document.body)}{completionModal && (
      <CompletionModal
        completionModal={completionModal}
        setCompletionModal={setCompletionModal}
        completionAction={completionAction}
        setCompletionAction={setCompletionAction}
        completionDate={completionDate}
        setCompletionDate={setCompletionDate}
        scheduleWoDate={scheduleWoDate}
        setScheduleWoDate={setScheduleWoDate}
        profile={profile}
        allExById={allExById}
        clsColor={cls.color}
        confirmWorkoutComplete={confirmWorkoutComplete}
        scheduleWorkoutForDate={scheduleWorkoutForDate}
        setStatsPromptModal={setStatsPromptModal}
      />
    )

    /* ══ LOG ENTRY EDIT MODAL ════════════════════ */}{logEditModal && logEditDraft && (
      <LogEntryEditModal
        logEditModal={logEditModal}
        setLogEditModal={setLogEditModal}
        logEditDraft={logEditDraft}
        setLogEditDraft={setLogEditDraft}
        allExById={allExById}
        profile={profile}
        saveLogEdit={saveLogEdit}
        deleteLogEntryByIdx={deleteLogEntryByIdx}
      />
    )

    /* ══ CONFIRM DELETE MODAL ════════════════════ */}{confirmDelete && (
      <ConfirmDeleteModal
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        plansContainerRef={plansContainerRef}
        _doDeleteWorkout={_doDeleteWorkout}
        _doDeleteCustomEx={_doDeleteCustomEx}
        _doDeleteLogEntry={_doDeleteLogEntry}
        _doResetChar={_doResetChar}
      />
    )

    /* ══ MAP OVERLAY ═════════════════════════════ */}{mapOpen && (
      <MapOverlay
        setMapOpen={setMapOpen}
        level={level}
        profile={profile}
        setProfile={setProfile}
        friends={friends}
        mapTooltip={mapTooltip}
        setMapTooltip={setMapTooltip}
        showToast={showToast}
      />
    )

    /* ══ WORLD OVERLAY ══════════════════════════ */}{activeTab === "world" && (
      <React.Suspense fallback={<div style={{position:"fixed",top:0,right:0,bottom:0,left:0,zIndex:9999,background:"#000",display:"flex",alignItems:"center",justifyContent:"center",color:"#8a8478",fontFamily:"Inter,sans-serif",fontSize:".85rem",letterSpacing:".08em"}}>{"ENTERING WORLD…"}</div>}>
        <WorldOverlay
          onClose={() => setActiveTab(prevTab || "workout")}
          username={profile?.username}
          aurisarClass={profile?.class_type}
          avatarConfig={avatarConfig}
        />
      </React.Suspense>
    )

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