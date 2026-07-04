import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { List } from 'react-window';
import './styles/app.css';
import { CLASSES, EXERCISES } from './data/exercises';
import { EX_BY_ID, CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, CLASS_SVG_PATHS, QUESTS, WORKOUT_TEMPLATES, PLAN_TEMPLATES, CHECKIN_REWARDS, KEYWORD_CLASS_MAP, PARTICLES, STORAGE_KEY, EMPTY_PROFILE, NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES, MUSCLE_COLORS, MUSCLE_META, TYPE_COLORS, UI_COLORS, MAP_REGIONS } from './data/constants';
import { _nullishCoalesce, _optionalChain, uid, todayStr } from './utils/helpers';
import { loadSave, doSave, flushSave, setPreviewMode, loadAdminFlags } from './utils/storage';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, ftInToCm, cmToFtIn } from './utils/units';
import { buildXPTable, XP_TABLE, xpToLevel, xpForLevel, xpForNext, calcBMI, detectClassFromAnswers, calcExXP, calcPlanXP, calcDayXP, calcExercisePBs, calcDecisionTreeBonus, calcCharStats, checkQuestCompletion, getMuscleColor } from './utils/xp';
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


import { ExIcon } from './components/ExIcon';
import { ClassIcon } from './components/ClassIcon';
import { getRegionIdx, MapSVG } from './components/MapSVG';
import LoginScreen from './components/LoginScreen';
import PrivacyPolicy from './components/PrivacyPolicy';
// Heavy / route-scoped components are lazy-loaded so first paint doesn't pay for
// recharts (~150KB), three.js (~600KB), or the landing page assets.
const TrendsTab = lazyWithRetry(() => import('./components/TrendsTab').then(m => ({
  default: m.TrendsTab
})));
const PlanWizard = lazyWithRetry(() => import('./components/PlanWizard'));
const WorkoutNotificationMockup = lazyWithRetry(() => import('./components/WorkoutNotificationMockup'));
const LandingPage = lazyWithRetry(() => import('./components/LandingPage').then(m => ({
  default: m.LandingPage
})));
const AdminPage = lazyWithRetry(() => import('./components/AdminPage'));
const WorldOverlay = lazyWithRetry(() => import('./features/world/WorldOverlay.jsx'));
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
  } catch { /* ignore */ }
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
    detailImgIdx: _detailImgIdx,
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
    mfaDisableMethod: _mfaDisableMethod,
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
    phoneOtpSent: _phoneOtpSent,
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
  const [_showWorld, setShowWorld] = useState(false);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [_exCatFilter, setExCatFilter] = useState("All");
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
  const [_lbAvailableStates, setLbAvailableStates] = useState([]);
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
