import React, { memo, useState, useEffect, useRef } from 'react';
import { sb } from '../../utils/supabase';
import { calcBMI, xpToLevel, xpForLevel, xpForNext } from '../../utils/xp';
import { isMetric, lbsToKg, kgToLbs, ftInToCm, cmToFtIn } from '../../utils/units';
import { S, R, FS } from '../../utils/tokens';
import { UI_COLORS, QUESTS, EX_BY_ID } from '../../data/constants';
import { _optionalChain, todayStr } from '../../utils/helpers';
import { CLASSES } from '../../data/exercises';
import { ClassIcon } from '../../components/ClassIcon';

const LEADERBOARD_PB_IDS = new Set(["bench", "bench_press", "squat", "barbell_back_squat", "deadlift", "barbell_deadlift", "overhead_press", "ohp", "pull_up", "pullups", "push_up", "pushups", "running", "treadmill_run", "run"]);

// ── Whoop value formatters ──────────────────────────────────────────
const _emdash = '—';
const _isNum  = (v) => typeof v === 'number' && Number.isFinite(v);
function formatNum(v, decimals = 0) {
  return _isNum(v) ? v.toFixed(decimals) : _emdash;
}
function formatPct(v) {
  return _isNum(v) ? `${v.toFixed(0)}%` : _emdash;
}
function formatBpm(v) {
  return _isNum(v) ? `${v.toFixed(0)} bpm` : _emdash;
}
function formatMs(v) {
  return _isNum(v) ? `${v.toFixed(1)} ms` : _emdash;
}
function formatTemp(c) {
  if (!_isNum(c)) return _emdash;
  const f = c * 9 / 5 + 32;
  return `${c.toFixed(1)}°C / ${f.toFixed(1)}°F`;
}
function formatDuration(ms) {
  if (!_isNum(ms)) return _emdash;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatMeters(m) {
  if (!_isNum(m)) return _emdash;
  const totalIn = m / 0.0254;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - ft * 12);
  return `${m.toFixed(2)} m / ${ft}'${inches}"`;
}
function formatKg(kg) {
  if (!_isNum(kg)) return _emdash;
  const lb = kg * 2.2046226218;
  return `${kg.toFixed(1)} kg / ${lb.toFixed(1)} lb`;
}

function WhoopFieldCard({ title, payload, rows }) {
  const empty = !payload;
  return (
    <div style={{
      padding: '10px 12px',
      background: 'rgba(45,42,36,.26)',
      borderRadius: 10,
      border: '1px solid rgba(180,172,158,.18)',
      boxShadow: '0 0 10px rgba(180,172,158,.1), 0 0 18px rgba(180,172,158,.04)',
      opacity: empty ? 0.55 : 1,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#ece7de', marginBottom: 6, letterSpacing: 0.4 }}>
        {title}
      </div>
      {empty ? (
        <div style={{ fontSize: 11, color: '#7a7268' }}>No data yet — sync to fetch.</div>
      ) : (
        <div style={{ display: 'grid', gap: 3 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
              <span style={{ color: '#a8a09a' }}>{label}</span>
              <span style={{ color: '#ece7de', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DAY_ABBREVS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// SVG bar chart showing the last 7 days of a Whoop metric + a dashed average line.
function WhoopMiniChart({ historyData, extractValue, maxVal = 100, unit = '%', clsColor }) {
  if (!historyData || historyData.length === 0) return null;
  const points = historyData.map(row => ({ date: row.date, value: extractValue(row.payload) }));
  const numeric = points.filter(d => _isNum(d.value));
  if (numeric.length === 0) return null;

  const avg = numeric.reduce((s, p) => s + p.value, 0) / numeric.length;
  const W = 280, H = 82;
  const padL = 4, padR = 4, padT = 16, padB = 18;
  const chartH = H - padT - padB;
  const chartW = W - padL - padR;
  const colW = chartW / 7;
  const barW = Math.max(8, colW - 5);
  const avgY = padT + chartH * (1 - Math.min(avg / maxVal, 1));

  return (
    <div style={{
      marginTop: 12,
      padding: '10px 11px',
      background: 'rgba(45,42,36,.22)',
      borderRadius: 9,
      border: '1px solid rgba(180,172,158,.16)',
      boxShadow: '0 0 12px rgba(180,172,158,.08)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span className="rpg-sec-title">7-Day Trend</span>
        <span style={{ fontFamily: "'Inter',sans-serif", fontSize: '.62rem', color: '#a8a09a' }}>
          {'avg '}
          <span style={{ color: clsColor, fontWeight: 700 }}>{avg.toFixed(1)}{unit}</span>
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <filter id="label-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {Array.from({ length: 7 }, (_, i) => {
          const p = points[i];
          const x = padL + i * colW + (colW - barW) / 2;
          if (!p || !_isNum(p.value)) {
            const emptyLabel = p ? DAY_ABBREVS[new Date(p.date + 'T12:00:00').getDay()] : '—';
            return (
              <g key={i}>
                <rect x={x} y={padT + chartH - 2} width={barW} height={2} rx={1}
                  fill="rgba(180,172,158,.08)" />
                <text x={x + barW / 2} y={H - 3} textAnchor="middle"
                  fontFamily="Inter,sans-serif" fontSize="7" fill="rgba(180,172,158,.38)">{emptyLabel}</text>
              </g>
            );
          }
          const barH = Math.max(2, chartH * Math.min(p.value / maxVal, 1));
          const y = padT + chartH - barH;
          const day = new Date(p.date + 'T12:00:00').getDay();
          const valLabel = unit === '%' ? p.value.toFixed(0) + '%' : p.value.toFixed(1) + unit;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={2}
                fill={`color-mix(in srgb, ${clsColor} 72%, transparent)`} />
              <text x={x + barW / 2} y={Math.max(padT - 2, y - 2)} textAnchor="middle"
                fontFamily="Inter,sans-serif" fontSize="6.5" fill={clsColor} opacity={1}
                filter="url(#label-glow)">
                {valLabel}
              </text>
              <text x={x + barW / 2} y={H - 3} textAnchor="middle"
                fontFamily="Inter,sans-serif" fontSize="7" fill="rgba(180,172,158,.65)">
                {DAY_ABBREVS[day]}
              </text>
            </g>
          );
        })}
        {numeric.length > 1 && (
          <line x1={padL} y1={avgY} x2={W - padR} y2={avgY}
            stroke={clsColor} strokeWidth={1} strokeDasharray="3,3" opacity={0.78} />
        )}
      </svg>
    </div>
  );
}

/**
 * Profile tab — extracted from the four inline JSX blocks in App.jsx as part
 * of Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Combines VIEW / EDIT / SECURITY SETTINGS / NOTIFICATION PREFERENCES
 * sub-views that were each guarded by activeTab === "profile" + a mode flag.
 */

const ProfileTab = memo(function ProfileTab({
  // Profile data
  profile, setProfile,
  cls,
  level,
  authUser,
  // View mode
  editMode, setEditMode,
  securityMode, setSecurityMode,
  notifMode, setNotifMode,
  // Edit form
  draft, setDraft,
  // Email change
  emailPanelOpen, setEmailPanelOpen,
  newEmail, setNewEmail,
  emailMsg, setEmailMsg,
  showEmail, setShowEmail,
  // Account IDs
  showPrivateId, setShowPrivateId,
  myPublicId,
  myPrivateId,
  // MFA
  mfaPanelOpen, setMfaPanelOpen,
  mfaEnrolling, setMfaEnrolling,
  mfaQR, setMfaQR,
  mfaSecret, setMfaSecret,
  mfaCode, setMfaCode,
  mfaMsg, setMfaMsg,
  mfaEnabled,
  mfaUnenrolling,
  mfaRecoveryCodes, setMfaRecoveryCodes,
  mfaCodesRemaining,
  mfaHasLegacyCodes,
  mfaDisableConfirm, setMfaDisableConfirm,
  mfaDisableCode, setMfaDisableCode,
  mfaDisableMsg, setMfaDisableMsg,
  // Password change
  pwPanelOpen, setPwPanelOpen,
  pwNew, setPwNew,
  pwConfirm, setPwConfirm,
  pwMsg, setPwMsg,
  // Phone change
  phonePanelOpen, setPhonePanelOpen,
  phoneInput, setPhoneInput,
  setPhoneOtpSent,
  setPhoneOtpCode,
  phoneMsg, setPhoneMsg,
  // PB filter
  pbFilterOpen, setPbFilterOpen,
  pbSelectedFilters, setPbSelectedFilters,
  // Password show/hide toggle
  showPwProfile, setShowPwProfile,
  // Callbacks
  saveEdit,
  openEdit,
  changePassword,
  changeEmailAddress,
  resetChar,
  verifyMfaEnroll,
  startMfaEnroll,
  unenrollMfa,
  regenerateRecoveryCodes,
  confirmMfaDisableWithTotp,
  guardRecoveryCodes,
  checkMfaStatus,
  // Passkey management
  passkeyPanelOpen, setPasskeyPanelOpen,
  passkeyFactors,
  passkeyMsg, setPasskeyMsg,
  passkeyRegistering,
  registerPasskey,
  removePasskey,
  toggleNameVisibility,
  toggleNotifPref,
  profileComplete,
  showToast,
  doCheckIn,
  onOpenRetroCheckIn,
  onOpenWNMockup,
}) {
  const [whoopLinked, setWhoopLinked] = useState(null); // null=loading, true/false
  const [whoopSyncing, setWhoopSyncing] = useState(false);
  const [whoopMsg, setWhoopMsg] = useState('');
  const [whoopJustConnected, setWhoopJustConnected] = useState(() => {
    try {
      const flag = sessionStorage.getItem('aurisar_whoop_just_connected');
      if (flag) sessionStorage.removeItem('aurisar_whoop_just_connected');
      return !!flag;
    } catch { return false; }
  });
  // Latest record per data_type. Keys: recovery, cycle, sleep, workout,
  // profile, body_measurement. Values are the raw payload from Whoop.
  const [whoopData, setWhoopData] = useState({});
  // Last 7 records per data_type in ascending date order, for trend charts.
  const [whoopHistory, setWhoopHistory] = useState({});

  // Tab navigation within view mode
  const [activeTab, setActiveTab] = useState('profile'); // 'profile'|'stats'|'whoop'|'security'
  const [whoopSubTab, setWhoopSubTab] = useState('recovery');

  // Collapsed state for section cards (true = collapsed)
  const [collapsed, setCollapsed] = useState({
    identity: false,
    combatRecord: false,
    personalBests: true,
    warriorData: true,
    aboutYou: false,
  });

  useEffect(() => {
    if (!authUser?.id) return;
    sb.from('whoop_tokens').select('user_id').eq('user_id', authUser.id).maybeSingle()
      .then(({ data, error }) => setWhoopLinked(!error && !!data))
      .catch(() => setWhoopLinked(false));
  }, [authUser?.id]);

  async function loadWhoopData() {
    if (!authUser?.id) return;
    const { data, error } = await sb
      .from('whoop_data')
      .select('data_type, cycle_date, payload, fetched_at')
      .eq('user_id', authUser.id)
      .order('cycle_date', { ascending: false });
    if (error || !data) return;
    // Latest record per data_type + last 7 for history charts.
    const latest = {};
    const buckets = {};
    for (const row of data) {
      if (!latest[row.data_type]) latest[row.data_type] = row.payload;
      if (!buckets[row.data_type]) buckets[row.data_type] = [];
      if (buckets[row.data_type].length < 7) {
        buckets[row.data_type].push({ date: row.cycle_date, payload: row.payload });
      }
    }
    // Reverse each bucket so it's oldest→newest for chart rendering.
    const history = {};
    for (const [type, arr] of Object.entries(buckets)) {
      history[type] = [...arr].reverse();
    }
    setWhoopData(latest);
    setWhoopHistory(history);
  }

  useEffect(() => { if (whoopLinked) loadWhoopData(); /* eslint-disable-next-line */ }, [whoopLinked, authUser?.id]);

  async function handleConnectWhoop() {
    try {
      const res = await fetch('/.netlify/functions/whoop-auth-url');
      if (!res.ok) { setWhoopMsg('Could not start Whoop auth. Try again.'); return; }
      const { url, state } = await res.json();
      sessionStorage.setItem('whoop_oauth_state', state);
      window.location.href = url;
    } catch {
      setWhoopMsg('Network error. Check your connection.');
    }
  }

  async function handleSyncWhoop({ silent = false } = {}) {
    if (whoopSyncing) return;
    setWhoopSyncing(true);
    if (!silent) setWhoopMsg('');
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { setWhoopMsg('Not signed in.'); setWhoopSyncing(false); return; }
      const res = await fetch('/.netlify/functions/whoop-fetch-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const failed = data.errors ? Object.keys(data.errors) : [];
        const prefix = data.backfill ? 'Backfill complete' : 'Synced';
        if (failed.length === 0) {
          setWhoopMsg(`${prefix} — ${data.synced ?? 0} records.`);
        } else {
          setWhoopMsg(`${prefix} — ${data.synced ?? 0} records. Failed: ${failed.join(', ')}`);
        }
        await loadWhoopData();
      } else {
        setWhoopMsg(`Sync failed${data.upsertError ? `: ${data.upsertError}` : '. Try again.'}`);
      }
    } catch {
      setWhoopMsg('Network error during sync.');
    }
    setWhoopSyncing(false);
  }

  // P2 fix from Codex review on PR #174: the callback handler's fire-
  // and-forget sync may be cancelled when the browser navigates back
  // to "/", leaving Profile with empty cards. Once the page mounts and
  // we confirm the user is linked, kick off one sync ourselves. Guarded
  // by a ref so it only fires once per "just connected" landing.
  const autoSyncFiredRef = useRef(false);
  useEffect(() => {
    if (whoopLinked && whoopJustConnected && !autoSyncFiredRef.current) {
      autoSyncFiredRef.current = true;
      // Give the success banner ~1 frame to paint before the sync
      // status overwrites it.
      handleSyncWhoop({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whoopLinked, whoopJustConnected]);

  const totalH = (parseInt(profile.heightFt) || 0) * 12 + (parseInt(profile.heightIn) || 0);
  const bmi = calcBMI(profile.weightLbs, totalH);
return (
<>
{/* VIEW_MODE_START */}{!editMode && !notifMode && <div style={{
  "--cls-color": cls.color,
  "--cls-glow": cls.glow,
}}>

  {/* ── Profile Incomplete Warning ── */}
  {!profileComplete() && <div style={{
    background: "rgba(231,76,60,.08)",
    border: "1px solid rgba(231,76,60,.2)",
    borderRadius: R.r10,
    padding: "10px 14px",
    marginBottom: S.s12,
    display: "flex", alignItems: "center", gap: S.s10,
  }}>
    <span style={{ fontSize: "1.1rem" }}>{"⚠️"}</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: FS.lg, color: UI_COLORS.danger, fontWeight: 700, marginBottom: S.s2 }}>{"Profile Incomplete"}</div>
      <div style={{ fontSize: FS.sm, color: "#8a8478" }}>{"State and Country are required for leaderboard rankings. Tap Edit to add them."}</div>
    </div>
    <button className={"btn btn-ghost btn-sm"} style={{ fontSize: FS.fs58, flexShrink: 0 }}
      onClick={() => { setSecurityMode(false); setNotifMode(false); openEdit(); }}>{"Edit"}</button>
  </div>}

  {/* ── Whoop just-connected banner ── */}
  {whoopJustConnected && <div style={{
    display: "flex", alignItems: "center", gap: S.s8, padding: "8px 12px",
    background: "rgba(46,204,113,.10)", border: "1px solid rgba(46,204,113,.35)",
    borderRadius: R.r10, marginBottom: S.s8,
  }}>
    <div style={{ fontSize: 18 }}>{"✓"}</div>
    <div style={{ fontSize: FS.fs58, color: "#9be7b6" }}>{"Whoop connected. Pulling your latest data…"}</div>
  </div>}

  {/* ── Hero Band (Mockup 2 style) ── */}
  {(() => {
    const xpAtLevel = xpForLevel(level);
    const xpAtNext = xpForNext(level);
    const xpPct = xpAtNext > xpAtLevel
      ? Math.min(100, Math.round((profile.xp - xpAtLevel) / (xpAtNext - xpAtLevel) * 100))
      : 0;
    return (
      <div className={"log-group-card"} style={{ "--mg-color": cls.color, marginBottom: 12 }}>
        <div style={{ padding: "12px 13px", display: "flex", alignItems: "center", gap: 11, background: "rgba(28,26,22,.95)" }}>
          {/* Avatar */}
          <div style={{
            width: 46, height: 46, borderRadius: "50%",
            background: `color-mix(in srgb,${cls.color} 18%,rgba(45,42,36,.4))`,
            border: `1px solid color-mix(in srgb,${cls.color} 30%,rgba(180,172,158,.1))`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0, position: "relative",
          }}>
            <ClassIcon classKey={profile.chosenClass} size={20} color={cls.glow} />
            {profile.lastCheckIn === todayStr() && (
              <div style={{
                position: "absolute", bottom: 0, right: 0,
                width: 12, height: 12, borderRadius: "50%",
                background: "#2ecc71", border: "2px solid #0a0908",
              }} />
            )}
          </div>
          {/* Name + sub + XP bar */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".92rem", fontWeight: 700, color: "#d4cec4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {profile.playerName || "Warrior"}
            </div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: ".62rem", color: "#8a8478", marginTop: 2 }}>
              {"Lv "}{level}{" "}{cls.name}{" · #"}{myPublicId || "…"}{" · 🔥 "}{profile.checkInStreak}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
              <div style={{ flex: 1, height: 3, background: "rgba(45,42,36,.4)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2, width: xpPct + "%",
                  background: `linear-gradient(90deg,color-mix(in srgb,${cls.color} 50%,transparent),${cls.color})`,
                }} />
              </div>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: ".55rem", color: "#8a8478", flexShrink: 0 }}>
                {"Lv "}{level + 1}{" →"}
              </span>
            </div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: ".52rem", color: "#5a5650", marginTop: 2 }}>
              {profile.xp.toLocaleString()}{" / "}{xpAtNext.toLocaleString()}{" XP"}
            </div>
          </div>
          {/* Edit */}
          <button className={"btn btn-ghost btn-sm"} style={{ fontSize: FS.fs58, flexShrink: 0 }}
            onClick={() => { setSecurityMode(false); setNotifMode(false); openEdit(); }}>{"✎ Edit"}</button>
        </div>
      </div>
    );
  })()}

  {/* ── Main tab strip ── */}
  {(() => {
    const tabs = [
      { id: "profile", label: "Profile" },
      { id: "stats", label: "Stats" },
      { id: "whoop", label: "⌚ Whoop" },
      { id: "security", label: "🔒 Security" },
    ];
    return (
      <div style={{
        display: "flex", gap: 0, border: "1px solid rgba(180,172,158,.06)",
        borderRadius: 8, overflow: "hidden", marginBottom: 12,
        background: "rgba(20,18,14,.8)",
      }}>
        {tabs.map((t, i) => (
          <div key={t.id} onClick={() => { setActiveTab(t.id); if (t.id === "security") checkMfaStatus(); }} style={{
            flex: 1, textAlign: "center", padding: "7px 4px",
            fontFamily: "'Inter',sans-serif", fontSize: ".68rem", fontWeight: 600,
            color: activeTab === t.id ? "#d4cec4" : "#8a8478",
            cursor: "pointer",
            borderRight: i < tabs.length - 1 ? "1px solid rgba(180,172,158,.06)" : "none",
            transition: "all .18s", whiteSpace: "nowrap",
            background: activeTab === t.id ? "rgba(45,42,36,.22)" : "transparent",
            boxShadow: activeTab === t.id ? `inset 0 -2px 0 ${cls.color}` : "none",
            userSelect: "none",
          }}>{t.label}</div>
        ))}
      </div>
    );
  })()}

  {/* ══════════════════════════════════════════
       PROFILE TAB — Identity, Combat, About
       ══════════════════════════════════════════ */}
  {activeTab === "profile" && (() => {
    const nv = profile.nameVisibility || { displayName: ["app", "game"], realName: ["hide"] };
    const realName = ((profile.firstName || "") + " " + (profile.lastName || "")).trim();
    const ToggleRow = ({ label, value, rowKey }) => {
      const hasApp = (nv[rowKey] || []).includes("app");
      const hasGame = (nv[rowKey] || []).includes("game");
      const isHidden = (nv[rowKey] || []).includes("hide");
      const boxStyle = (active, color) => ({
        width: 42, height: 24, borderRadius: R.r5,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: FS.fs52, fontWeight: 700, cursor: "pointer", userSelect: "none",
        transition: "all .15s",
        background: active ? color || "rgba(180,172,158,.12)" : "rgba(45,42,36,.15)",
        border: "1px solid " + (active ? "rgba(180,172,158,.15)" : "rgba(45,42,36,.2)"),
        color: active ? "#d4cec4" : "#8a8478",
      });
      return (
        <div style={{ display: "flex", alignItems: "center", gap: S.s8, padding: "8px 0" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FS.fs56, color: "#8a8478", marginBottom: S.s2 }}>{label}</div>
            <div style={{ fontSize: FS.fs78, color: isHidden ? "#8a8478" : "#d4cec4", fontWeight: 600, fontStyle: isHidden ? "italic" : "normal" }}>
              {isHidden ? "Hidden" : value || "Not set"}
            </div>
          </div>
          <div style={{ display: "flex", gap: S.s4 }}>
            <div style={boxStyle(hasApp, "rgba(46,204,113,.12)")} onClick={() => toggleNameVisibility(rowKey, "app")}>{"App"}</div>
            <div style={boxStyle(hasGame, "rgba(52,152,219,.12)")} onClick={() => toggleNameVisibility(rowKey, "game")}>{"Game"}</div>
            <div style={boxStyle(isHidden, "rgba(231,76,60,.08)")} onClick={() => toggleNameVisibility(rowKey, "hide")}>{"Hide"}</div>
          </div>
        </div>
      );
    };
    return (
      <div>
        {/* Identity card */}
        <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
          <div className={`log-group-hdr${collapsed.identity ? " collapsed" : ""}`}
            onClick={() => setCollapsed(c => ({ ...c, identity: !c.identity }))}>
            <div className={"log-group-icon"}>{"👤"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Identity"}</div>
              <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>
                {profile.playerName}{" · #"}{myPublicId || "…"}
              </div>
            </div>
            <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: collapsed.identity ? "none" : "rotate(180deg)", flexShrink: 0 }}>{"▼"}</span>
          </div>
          {!collapsed.identity && (
            <div style={{ padding: "8px 11px 10px" }}>
              {myPublicId && (
                <div style={{ textAlign: "center", marginBottom: S.s6 }}>
                  <span style={{ fontSize: FS.fs62, color: "#8a8478", fontFamily: "'Inter',monospace", letterSpacing: ".04em" }}>
                    {"Account ID: "}
                    <span style={{ color: "#b4ac9e", fontWeight: 700 }}>{"#" + myPublicId}</span>
                    <span style={{ fontSize: FS.fs52, color: "#b4ac9e", cursor: "pointer", textDecoration: "underline", marginLeft: S.s6 }}
                      onClick={() => navigator.clipboard.writeText("#" + myPublicId).then(() => showToast("Account ID copied!"))}>
                      {"Copy"}
                    </span>
                  </span>
                </div>
              )}
              <ToggleRow label={"Display Name"} value={profile.playerName} rowKey={"displayName"} />
              <div style={{ height: 1, background: "rgba(180,172,158,.04)" }} />
              <ToggleRow label={"First & Last Name"} value={realName || "Not set"} rowKey={"realName"} />
              <div style={{ display: "flex", gap: S.s10, justifyContent: "center", marginTop: S.s8, fontSize: FS.fs48, color: "#8a8478" }}>
                <span>{"App = Profile & Social"}</span><span>{"·"}</span>
                <span>{"Game = Leaderboard & Quests"}</span><span>{"·"}</span>
                <span>{"Hide = Not shown"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Combat Record card */}
        <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
          <div className={`log-group-hdr${collapsed.combatRecord ? " collapsed" : ""}`}
            onClick={() => setCollapsed(c => ({ ...c, combatRecord: !c.combatRecord }))}>
            <div className={"log-group-icon"}>{"🏆"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Combat Record"}</div>
              <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{"Lv "}{level}{" · "}{profile.xp.toLocaleString()}{" XP"}</div>
            </div>
            <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: collapsed.combatRecord ? "none" : "rotate(180deg)", flexShrink: 0 }}>{"▼"}</span>
          </div>
          {!collapsed.combatRecord && (
            <div style={{ padding: "8px 11px 10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
                {[
                  { val: profile.xp.toLocaleString(), lbl: "Total XP" },
                  { val: level, lbl: "Level" },
                  { val: profile.checkInStreak + "🔥", lbl: "Streak" },
                  { val: profile.log.length, lbl: "Sessions" },
                  { val: QUESTS.filter(q => _optionalChain([profile, "access", _a => _a.quests, "optionalAccess", _b => _b[q.id], "optionalAccess", _c => _c.claimed])).length, lbl: "Quests" },
                  profile.runningPB
                    ? { val: isMetric(profile.units) ? parseFloat((profile.runningPB * 1.60934).toFixed(2)) + "/km" : parseFloat(profile.runningPB.toFixed(2)) + "/mi", lbl: "🏃 Run PB", gold: true }
                    : { val: "—", lbl: "Run PB" },
                ].map(chip => (
                  <div key={chip.lbl} style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "8px 6px", background: "rgba(45,42,36,.14)",
                    border: "1px solid " + (chip.gold ? `color-mix(in srgb,${cls.color} 25%,transparent)` : "rgba(180,172,158,.05)"),
                    borderRadius: 8, gap: 2,
                  }}>
                    <span style={{ fontFamily: "'Cinzel',serif", fontSize: "1.05rem", fontWeight: 700, color: chip.gold ? cls.color : "#d4cec4" }}>{chip.val}</span>
                    <span style={{ fontFamily: "'Inter',sans-serif", fontSize: ".55rem", color: "#8a8478", letterSpacing: ".06em", textAlign: "center" }}>{chip.lbl}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className={"btn btn-gold btn-sm"} style={{ flex: 1, fontSize: FS.fs58 }}
                  disabled={profile.lastCheckIn === todayStr()} onClick={doCheckIn}>
                  {profile.lastCheckIn === todayStr() ? "✓ Checked In" : "⚡ Check In"}
                </button>
                <button className={"btn btn-ghost btn-sm"} style={{ fontSize: FS.fs58, flexShrink: 0 }} onClick={onOpenRetroCheckIn}>{"↺ Retro"}</button>
                <button className={"btn btn-ghost btn-sm"} style={{ fontSize: FS.fs58, flexShrink: 0 }} onClick={onOpenWNMockup}>{"📲"}</button>
              </div>
            </div>
          )}
        </div>

        {/* About You card — only if there's content */}
        {((profile.sportsBackground || []).length > 0 || profile.trainingStyle || (profile.fitnessPriorities || []).length > 0 || profile.disciplineTrait || profile.motto) && (
          <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
            <div className={`log-group-hdr${collapsed.aboutYou ? " collapsed" : ""}`}
              onClick={() => setCollapsed(c => ({ ...c, aboutYou: !c.aboutYou }))}>
              <div className={"log-group-icon"}>{"🌿"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"About You"}</div>
                <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{"Motto · Style · Priorities"}</div>
              </div>
              <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: collapsed.aboutYou ? "none" : "rotate(180deg)", flexShrink: 0 }}>{"▼"}</span>
            </div>
            {!collapsed.aboutYou && (
              <div style={{ padding: "8px 11px 10px" }}>
                {profile.motto && <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".72rem", color: "#b4ac9e", fontStyle: "italic", textAlign: "center", marginBottom: S.s8 }}>{`"${profile.motto}"`}</div>}
                {profile.disciplineTrait && <div style={{ marginBottom: S.s8 }}>
                  <span style={{ fontSize: FS.sm, color: "#8a8478", display: "block", marginBottom: S.s4 }}>{"Discipline Trait"}</span>
                  <span className={"trait"} style={{ "--cls-color": cls.color, "--cls-glow": cls.glow }}>{profile.disciplineTrait}</span>
                </div>}
                {profile.trainingStyle && <div style={{ display: "flex", alignItems: "baseline", gap: S.s6, paddingBottom: 5, borderBottom: "1px solid rgba(45,42,36,.15)", marginBottom: S.s6 }}>
                  <span style={{ fontSize: FS.sm, color: "#8a8478", width: 90, flexShrink: 0 }}>{"Training Style"}</span>
                  <span style={{ fontSize: FS.fs74, color: "#b4ac9e" }}>{{ heavy: "Heavy Compounds", cardio: "Cardio & Endurance", sculpt: "Sculpting & Aesthetics", hiit: "HIIT & Explosive", mindful: "Mindful Movement", sport: "Sport-Specific", mixed: "Mixed Training" }[profile.trainingStyle] || profile.trainingStyle}</span>
                </div>}
                {(profile.fitnessPriorities || []).length > 0 && <div style={{ marginBottom: S.s6 }}>
                  <div style={{ fontSize: FS.sm, color: "#8a8478", marginBottom: S.s4 }}>{"Fitness Priorities"}</div>
                  <div>{(profile.fitnessPriorities || []).map(p => <span key={p} className={"trait"} style={{ "--cls-color": "#8a8478", "--cls-glow": "#8a8478", marginRight: S.s4 }}>{{ be_strong: "💪 Being Strong", look_strong: "🪞 Looking Strong", feel_good: "🌿 Feeling Good", eat_right: "🥗 Eating Right", mental_clarity: "🧠 Mental Clarity", athletic_perf: "🏅 Athletic Perf", endurance: "🔥 Endurance", longevity: "🕊️ Longevity", competition: "🏆 Competition", social: "👥 Social", flexibility: "🤸 Mobility", weight_loss: "⚖️ Weight Mgmt" }[p] || p}</span>)}</div>
                </div>}
                {(profile.sportsBackground || []).filter(s => s !== "none").length > 0 && <div>
                  <div style={{ fontSize: FS.sm, color: "#8a8478", marginBottom: S.s4 }}>{"Sports Background"}</div>
                  <div>{(profile.sportsBackground || []).filter(s => s !== "none").map(s => <span key={s} className={"trait"} style={{ "--cls-color": "#8a8478", "--cls-glow": "#8a8478", marginRight: S.s4, fontSize: FS.fs65 }}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>)}</div>
                </div>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  })()}

  {/* ══════════════════════════════════════════
       STATS TAB — Personal Bests + Warrior Data
       ══════════════════════════════════════════ */}
  {activeTab === "stats" && (() => {
    const allPBs = profile.exercisePBs || {};
    const pbEntries = Object.entries(allPBs);
    const metric = isMetric(profile.units);
    const effectiveSelected = pbSelectedFilters === null
      ? pbEntries.filter(([id]) => LEADERBOARD_PB_IDS.has(id)).map(([id]) => id)
      : pbSelectedFilters;
    const pbOptions = pbEntries.map(([exId]) => {
      const ex = EX_BY_ID[exId];
      return { id: exId, label: ex ? ex.name : exId, icon: ex ? ex.icon : "💪" };
    });
    const visibleEntries = pbEntries.filter(([exId]) => effectiveSelected.includes(exId));
    const chipLabel = effectiveSelected.length === pbOptions.length ? "All PBs"
      : effectiveSelected.length === 0 ? "Filter PBs"
      : effectiveSelected.length <= 2
        ? effectiveSelected.map(id => { const ex = EX_BY_ID[id]; return ex ? ex.name : id; }).join(", ")
        : effectiveSelected.length + " selected";
    return (
      <div>
        {/* Personal Bests card */}
        {pbEntries.length > 0 && (
          <div className={"log-group-card"} style={{ "--mg-color": cls.color, overflow: "visible" }}>
            <div className={`log-group-hdr${collapsed.personalBests ? " collapsed" : ""}`}
              onClick={() => setCollapsed(c => ({ ...c, personalBests: !c.personalBests }))}>
              <div className={"log-group-icon"}>{"🏆"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Personal Bests"}</div>
                <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{pbEntries.length}{" lifts recorded"}</div>
              </div>
              <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: collapsed.personalBests ? "none" : "rotate(180deg)", flexShrink: 0 }}>{"▼"}</span>
            </div>
            {!collapsed.personalBests && (
              <div style={{ padding: "8px 11px 10px", overflow: "visible" }}>
                {/* Filter dropdown */}
                <div style={{ position: "relative", marginBottom: S.s8 }}>
                  <div style={{
                    background: pbFilterOpen ? "rgba(45,42,36,.45)" : "rgba(45,42,36,.2)",
                    border: "1px solid " + (pbFilterOpen ? "rgba(180,172,158,.12)" : "rgba(180,172,158,.06)"),
                    borderRadius: R.lg, padding: "8px 10px", fontSize: FS.sm, fontWeight: 600,
                    color: effectiveSelected.length === 0 ? "#8a8478" : "#b4ac9e",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: S.s6,
                    transition: "all .15s", userSelect: "none",
                  }} onClick={() => setPbFilterOpen(!pbFilterOpen)}>
                    <span style={{ fontSize: FS.md }}>{"🏆"}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"Filters"}</span>
                    <span style={{ fontSize: FS.fs46, color: "#8a8478", flexShrink: 0 }}>{pbFilterOpen ? "▲" : "▼"}</span>
                  </div>
                  {pbFilterOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 60, background: "#16160f", border: "1px solid rgba(180,172,158,.1)", borderRadius: R.r10, boxShadow: "0 8px 32px rgba(0,0,0,.6)", overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid rgba(180,172,158,.06)", background: "rgba(45,42,36,.15)" }}>
                        <span style={{ fontSize: FS.fs56, color: "#b4ac9e", cursor: "pointer", fontWeight: 600 }} onClick={() => setPbSelectedFilters(pbOptions.map(o => o.id))}>{"Select All"}</span>
                        <span style={{ fontSize: FS.fs56, color: UI_COLORS.danger, cursor: "pointer", fontWeight: 600 }} onClick={() => setPbSelectedFilters([])}>{"Clear All"}</span>
                      </div>
                      <div style={{ maxHeight: 200, overflowY: "auto", padding: "4px 4px", scrollbarWidth: "thin", scrollbarColor: "rgba(180,172,158,.15) transparent" }}>
                        {pbOptions.map(opt => {
                          const on = effectiveSelected.includes(opt.id);
                          return (
                            <div key={opt.id}
                              style={{ display: "flex", alignItems: "center", gap: S.s8, padding: "6px 8px", cursor: "pointer", borderRadius: R.r5, background: on ? "rgba(180,172,158,.07)" : "transparent", transition: "background .1s", fontSize: FS.fs62, color: on ? "#d4cec4" : "#8a8478" }}
                              onClick={() => { const newSel = on ? effectiveSelected.filter(s => s !== opt.id) : [...effectiveSelected, opt.id]; setPbSelectedFilters(newSel); }}>
                              <span style={{ width: 15, height: 15, borderRadius: R.r3, border: "1.5px solid " + (on ? "#b4ac9e" : "rgba(180,172,158,.12)"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: FS.fs52, color: "#b4ac9e", flexShrink: 0, background: on ? "rgba(180,172,158,.08)" : "transparent" }}>{on ? "✓" : ""}</span>
                              <span style={{ fontSize: FS.md, marginRight: S.s4 }}>{opt.icon}</span>
                              {opt.label}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ padding: "6px 10px", borderTop: "1px solid rgba(180,172,158,.06)", background: "rgba(45,42,36,.1)" }}>
                        <div style={{ textAlign: "center", fontSize: FS.fs58, color: "#b4ac9e", cursor: "pointer", fontWeight: 600, padding: "4px 0" }}
                          onClick={() => setPbFilterOpen(false)}>{"✓ Done (" + effectiveSelected.length + ")"}</div>
                      </div>
                    </div>
                  )}
                </div>
                {/* PB rows */}
                {visibleEntries.length === 0
                  ? <div style={{ textAlign: "center", fontSize: FS.fs62, color: "#8a8478", padding: "10px 0" }}>{"Use the filter above to select which Personal Bests to display."}</div>
                  : visibleEntries.map(([exId, pb]) => {
                      const ex = EX_BY_ID[exId];
                      const name = ex ? ex.name : exId;
                      const icon = ex ? ex.icon : "💪";
                      let valDisp = "";
                      if (pb.type === "Cardio Pace") { const pace = metric ? pb.value / 1.60934 : pb.value; valDisp = pace.toFixed(2) + (metric ? " min/km" : " min/mi"); }
                      else if (pb.type === "Assisted Weight") { valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric ? " kg" : " lbs") + " (Assisted)"; }
                      else if (pb.type === "Max Reps Per 1 Set") { valDisp = pb.value + " reps"; }
                      else if (pb.type === "Longest Hold" || pb.type === "Fastest Time") { valDisp = parseFloat(pb.value.toFixed(2)) + " min"; }
                      else if (pb.type === "Heaviest Weight") { valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric ? " kg" : " lbs"); }
                      else { valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric ? " kg" : " lbs") + " 1RM"; }
                      return (
                        <div key={exId} className={"cal-event-row"}>
                          <span style={{ fontSize: FS.fs90, flexShrink: 0 }}>{icon}</span>
                          <span style={{ fontSize: FS.md, color: "#b4ac9e", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                          <span style={{ fontFamily: "'Cinzel',serif", fontSize: ".7rem", color: cls.color, fontWeight: 700, flexShrink: 0 }}>{"🏆 "}{valDisp}</span>
                        </div>
                      );
                    })}
              </div>
            )}
          </div>
        )}

        {/* Warrior Data card */}
        <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
          <div className={`log-group-hdr${collapsed.warriorData ? " collapsed" : ""}`}
            onClick={() => setCollapsed(c => ({ ...c, warriorData: !c.warriorData }))}>
            <div className={"log-group-icon"}>{"⚔️"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{`${cls.name} Data`}</div>
              <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{"Weight · Height · Location"}</div>
            </div>
            <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: collapsed.warriorData ? "none" : "rotate(180deg)", flexShrink: 0 }}>{"▼"}</span>
          </div>
          {!collapsed.warriorData && (
            <div style={{ padding: "8px 11px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {[
                ["⚖️ Weight", profile.weightLbs ? (isMetric(profile.units) ? lbsToKg(profile.weightLbs) + " kg" : profile.weightLbs + " lbs") : "—"],
                ["📏 Height", totalH > 0 ? (isMetric(profile.units) ? ftInToCm(profile.heightFt, profile.heightIn) + " cm" : `${profile.heightFt}'${profile.heightIn}"`) : "—"],
                ["🧬 BMI", bmi || "—"],
                ["🎂 Age", profile.age || "—"],
                ["⚡ Units", isMetric(profile.units) ? "Metric" : "Imperial"],
                ["👤 Gender", profile.gender || "—"],
                ["📍 State", profile.state || "—"],
                ["🌍 Country", profile.country || "—"],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", alignItems: "baseline", gap: S.s6, paddingBottom: 5, borderBottom: "1px solid rgba(45,42,36,.15)" }}>
                  <span style={{ fontSize: FS.sm, color: "#8a8478", width: 72, flexShrink: 0 }}>{label}</span>
                  <span style={{ fontSize: FS.fs74, color: "#b4ac9e", fontFamily: "'Inter',sans-serif" }}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  })()}

  {/* ══════════════════════════════════════════
       WHOOP TAB — Sub-tabs + 7-day charts
       ══════════════════════════════════════════ */}
  {activeTab === "whoop" && (() => {
    const MRow = ({ icon, label, value }) => (
      <div className={"cal-event-row"} style={{
        borderColor: 'rgba(180,172,158,.14)',
        boxShadow: '0 0 6px rgba(180,172,158,.06)',
      }}>
        <span style={{ fontSize: "1.05rem", flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: "'Inter',sans-serif", fontSize: ".62rem", color: "#b4ac9e", flex: 1 }}>{label}</span>
        <span style={{ fontFamily: "'Cinzel',serif", fontSize: ".95rem", fontWeight: 700, color: cls.color, filter: `drop-shadow(0 0 4px color-mix(in srgb, ${cls.color} 45%, transparent))` }}>{value}</span>
      </div>
    );
    return (
      <div>
        {/* Whoop status card */}
        <div className={"log-group-card"} style={{ "--mg-color": whoopLinked ? "#2ecc71" : cls.color, marginBottom: 10 }}>
          <div className={"log-group-hdr"} style={{ cursor: "default" }}>
            <div className={"log-group-icon"}>{"⌚"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Whoop"}</div>
              <div style={{ fontSize: ".58rem", marginTop: 1, color: whoopLinked === null ? "#8a8478" : whoopLinked ? "#6ddfaa" : "#8a8478" }}>
                {whoopLinked === null ? "Checking…" : whoopLinked ? "Connected — recovery, sleep & strain data" : "Not connected"}
              </div>
              {whoopMsg ? <div style={{ fontSize: FS.fs58, color: whoopMsg.startsWith("Synced") || whoopMsg.startsWith("Backfill") ? "#2ecc71" : "#e74c3c", marginTop: S.s4 }}>{whoopMsg}</div> : null}
            </div>
            {whoopLinked ? (
              <button className={"btn btn-ghost btn-sm"} style={{ fontSize: FS.fs58, flexShrink: 0 }}
                disabled={whoopSyncing} onClick={handleSyncWhoop}>
                {whoopSyncing ? "Syncing…" : "↻ Sync"}
              </button>
            ) : whoopLinked === false ? (
              <button className={"btn btn-ghost btn-sm"} style={{ fontSize: FS.fs58, flexShrink: 0 }}
                onClick={handleConnectWhoop}>{"Connect"}</button>
            ) : null}
          </div>
        </div>

        {/* Not connected — connect prompt */}
        {whoopLinked === false && (
          <div style={{ textAlign: "center", padding: "24px 14px", color: "#8a8478", fontSize: FS.sm }}>
            <div style={{ fontSize: "2rem", marginBottom: S.s8 }}>{"⌚"}</div>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".8rem", color: "#b4ac9e", marginBottom: S.s6 }}>{"Connect Whoop"}</div>
            <div>{"Link your Whoop device to see recovery, sleep, and strain data right here."}</div>
            <div style={{ fontSize: FS.fs56, marginTop: S.s4 }}>
              {"Linking shares fitness data with Aurisar. "}
              <a href={"/privacy"} target={"_blank"} rel={"noreferrer"} style={{ color: "#7a7268", textDecoration: "underline", textUnderlineOffset: 2 }}>{"Privacy Policy"}</a>
            </div>
          </div>
        )}

        {/* Connected — sub-tabs + data */}
        {whoopLinked && (
          <div>
            {/* Sub-tab bar */}
            <div style={{
              display: "flex", borderBottom: "1px solid rgba(180,172,158,.06)",
              background: "rgba(22,21,17,.95)", borderRadius: "9px 9px 0 0",
              overflow: "hidden", marginBottom: 12,
            }}>
              {["recovery", "sleep", "strain", "body"].map(tab => (
                <div key={tab} onClick={() => setWhoopSubTab(tab)} style={{
                  flex: 1, padding: "8px 4px", textAlign: "center",
                  fontFamily: "'Inter',sans-serif", fontSize: ".68rem", fontWeight: 600,
                  color: whoopSubTab === tab ? "#d4cec4" : "#8a8478",
                  borderBottom: "2px solid " + (whoopSubTab === tab ? cls.color : "transparent"),
                  cursor: "pointer", transition: "all .18s", userSelect: "none",
                }}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </div>
              ))}
            </div>

            {/* Recovery */}
            {whoopSubTab === "recovery" && (
              <div>
                <MRow icon={"💚"} label={"Recovery Score"} value={formatPct(whoopData.recovery?.score?.recovery_score)} />
                <MRow icon={"💓"} label={"HRV (RMSSD)"} value={formatMs(whoopData.recovery?.score?.hrv_rmssd_milli)} />
                <MRow icon={"🫀"} label={"Resting Heart Rate"} value={formatBpm(whoopData.recovery?.score?.resting_heart_rate)} />
                <MRow icon={"🫁"} label={"SpO₂"} value={formatPct(whoopData.recovery?.score?.spo2_percentage)} />
                <MRow icon={"🌡️"} label={"Skin Temperature"} value={formatTemp(whoopData.recovery?.score?.skin_temp_celsius)} />
                <WhoopMiniChart
                  historyData={whoopHistory.recovery}
                  extractValue={p => p?.score?.recovery_score}
                  maxVal={100} unit={"%"} clsColor={cls.color}
                />
              </div>
            )}

            {/* Sleep */}
            {whoopSubTab === "sleep" && (
              <div>
                <MRow icon={"😴"} label={"Sleep Performance"} value={formatPct(whoopData.sleep?.score?.sleep_performance_percentage)} />
                <MRow icon={"📊"} label={"Efficiency"} value={formatPct(whoopData.sleep?.score?.sleep_efficiency_percentage)} />
                <MRow icon={"🔄"} label={"Consistency"} value={formatPct(whoopData.sleep?.score?.sleep_consistency_percentage)} />
                <MRow icon={"🛏"} label={"Time in Bed"} value={formatDuration(whoopData.sleep?.score?.stage_summary?.total_in_bed_time_milli)} />
                <MRow icon={"🌙"} label={"REM Sleep"} value={formatDuration(whoopData.sleep?.score?.stage_summary?.total_rem_sleep_time_milli)} />
                <WhoopMiniChart
                  historyData={whoopHistory.sleep}
                  extractValue={p => p?.score?.sleep_performance_percentage}
                  maxVal={100} unit={"%"} clsColor={cls.color}
                />
              </div>
            )}

            {/* Strain */}
            {whoopSubTab === "strain" && (
              <div>
                <MRow icon={"⚡"} label={"Day Strain"} value={formatNum(whoopData.cycle?.score?.strain, 1) + " / 21"} />
                <MRow icon={"📈"} label={"Avg Heart Rate"} value={formatBpm(whoopData.cycle?.score?.average_heart_rate)} />
                <MRow icon={"📉"} label={"Max Heart Rate"} value={formatBpm(whoopData.cycle?.score?.max_heart_rate)} />
                <MRow icon={"🔋"} label={"Energy (kJ)"} value={formatNum(whoopData.cycle?.score?.kilojoule, 0)} />
                {whoopData.workout && (
                  <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(180,172,158,.06)" }}>
                    <div className={"rpg-sec-header"} style={{ marginBottom: 7 }}>
                      <div className={"rpg-sec-line rpg-sec-line-l"} />
                      <span className={"rpg-sec-title"}>{"Last Workout"}</span>
                      <div className={"rpg-sec-line rpg-sec-line-r"} />
                    </div>
                    <MRow icon={"🏋️"} label={"Workout Strain"} value={formatNum(whoopData.workout?.score?.strain, 1)} />
                    <MRow icon={"❤️"} label={"Avg Heart Rate"} value={formatBpm(whoopData.workout?.score?.average_heart_rate)} />
                    <MRow icon={"📍"} label={"Distance"} value={_isNum(whoopData.workout?.score?.distance_meter) ? formatNum(whoopData.workout?.score?.distance_meter, 0) + " m" : "—"} />
                    <MRow icon={"🔋"} label={"Energy (kJ)"} value={formatNum(whoopData.workout?.score?.kilojoule, 0)} />
                  </div>
                )}
                <WhoopMiniChart
                  historyData={whoopHistory.cycle}
                  extractValue={p => p?.score?.strain}
                  maxVal={21} unit={""} clsColor={cls.color}
                />
              </div>
            )}

            {/* Body */}
            {whoopSubTab === "body" && (
              <div>
                <MRow icon={"📏"} label={"Height"} value={formatMeters(whoopData.body_measurement?.height_meter)} />
                <MRow icon={"⚖️"} label={"Weight"} value={formatKg(whoopData.body_measurement?.weight_kilogram)} />
                <MRow icon={"🫀"} label={"Max Heart Rate"} value={formatBpm(whoopData.body_measurement?.max_heart_rate)} />
                {whoopData.profile && (
                  <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(180,172,158,.06)" }}>
                    <div className={"rpg-sec-header"} style={{ marginBottom: 7 }}>
                      <div className={"rpg-sec-line rpg-sec-line-l"} />
                      <span className={"rpg-sec-title"}>{"Whoop Profile"}</span>
                      <div className={"rpg-sec-line rpg-sec-line-r"} />
                    </div>
                    <MRow icon={"👤"} label={"Name"} value={(whoopData.profile?.first_name || "—") + " " + (whoopData.profile?.last_name || "")} />
                    <MRow icon={"✉️"} label={"Email"} value={whoopData.profile?.email || "—"} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  })()}

  {/* ══════════════════════════════════════════
       SECURITY TAB — Overview + mode buttons
       ══════════════════════════════════════════ */}
  {activeTab === "security" && (
    <div>

  {
    /* ═══ Email Verification Status (with Show/Hide) ═══ */
  }{authUser && <div className={"log-group-card"} style={{ "--mg-color": authUser.email_confirmed_at ? "#2ecc71" : cls.color }}><div style={{
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

  /* ═══ Account IDs ═══ */}
    <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={"log-group-hdr"} style={{ cursor: "default" }}>
        <div className={"log-group-icon"}>{"\uD83D\uDD11"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Account IDs"}</div>
          <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{"Public \u00b7 Private"}</div>
        </div>
      </div>
      <div style={{ padding: "8px 11px 10px" }}><div style={{
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
      </div>

  {
    /* ═══ CHANGE EMAIL — collapsible ═══ */
  }<div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={`log-group-hdr${emailPanelOpen ? "" : " collapsed"}`}
        onClick={() => { setEmailPanelOpen(s => !s); if (emailPanelOpen) { setNewEmail(""); setEmailMsg(null); } }}>
        <div className={"log-group-icon"}>{"📧"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Change Email Address"}</div>
        </div>
        <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: emailPanelOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>{"▼"}</span>
      </div>
      {emailPanelOpen && (
        <div style={{ padding: "8px 11px 10px" }}>
          <div style={{
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
      }} onClick={changeEmailAddress} disabled={!newEmail.trim()}>{"📧 Update Email"}</button>
        </div>
      )}
    </div>

  {
    /* ═══ MFA (TOTP) — collapsible ═══ */
  }<div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={`log-group-hdr${mfaPanelOpen ? "" : " collapsed"}`}
        onClick={() => guardRecoveryCodes(() => { setMfaPanelOpen(s => !s); if (mfaPanelOpen) { setMfaMsg(null); setMfaEnrolling(false); setMfaQR(null); setMfaCode(""); } })}>
        <div className={"log-group-icon"}>{"🛡️"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Two-Factor Authentication"}</div>
          <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{mfaEnabled ? `Active · ${mfaCodesRemaining ?? "?"} recovery codes` : "Not enabled"}</div>
        </div>
        <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: mfaPanelOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>{"▼"}</span>
      </div>
      {mfaPanelOpen && (
        <div style={{ padding: "8px 11px 10px" }}>
          {!mfaEnabled && !mfaEnrolling && !mfaRecoveryCodes && <div style={{
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
      }}>{mfaMsg.text}</div>}
        </div>
      )}
    </div>

  {
    /* ═══ Passkeys — collapsible ═══ */
  }<div className={"log-group-card"} style={{ "--mg-color": cls.color, marginBottom: 8 }}>
      <div className={`log-group-hdr${passkeyPanelOpen ? "" : " collapsed"}`}
        onClick={() => { setPasskeyPanelOpen(s => !s); setPasskeyMsg(null); }}>
        <div className={"log-group-icon"}>{"🔑"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Passkeys"}</div>
          <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{passkeyFactors.length > 0 ? `${passkeyFactors.length} registered` : "Sign in without a password"}</div>
        </div>
        <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: passkeyPanelOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>{"▼"}</span>
      </div>
      {passkeyPanelOpen && (
        <div style={{ padding: "8px 11px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {passkeyFactors.length === 0 ? (
            <div style={{ fontSize: ".68rem", color: "#8a8478", fontStyle: "italic" }}>{"No passkeys registered yet."}</div>
          ) : (
            passkeyFactors.map(f => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: "rgba(45,42,36,.18)", borderRadius: 8, gap: 8 }}>
                <div>
                  <div style={{ fontSize: ".72rem", color: "#d4cec4" }}>{f.friendly_name || "Passkey"}</div>
                  {f.created_at && <div style={{ fontSize: ".58rem", color: "#8a8478" }}>{new Date(f.created_at).toLocaleDateString()}</div>}
                </div>
                <button className={"btn btn-ghost btn-sm"} style={{ color: "#e74c3c", borderColor: "rgba(231,76,60,.2)", flexShrink: 0 }}
                  onClick={() => removePasskey(f.id)}>{"Remove"}</button>
              </div>
            ))
          )}
          <button className={"btn btn-ghost btn-sm"} style={{ width: "100%" }}
            disabled={passkeyRegistering} onClick={registerPasskey}>
            {passkeyRegistering ? "Opening browser prompt…" : "➕ Add a Passkey"}
          </button>
          {passkeyMsg && (
            <div style={{ fontSize: ".68rem", color: passkeyMsg.ok ? "#7ebf73" : "#e74c3c", textAlign: "center", padding: "4px 8px", borderRadius: 6 }}>
              {passkeyMsg.text}
            </div>
          )}
        </div>
      )}
    </div>

  {
    /* ═══ Phone Number — collapsible ═══ */
  }<div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={`log-group-hdr${phonePanelOpen ? "" : " collapsed"}`}
        onClick={() => { setPhonePanelOpen(s => !s); if (phonePanelOpen) { setPhoneMsg(null); setPhoneOtpSent(false); setPhoneOtpCode(""); } }}>
        <div className={"log-group-icon"}>{"📱"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Phone Number"}</div>
          <div style={{ fontSize: ".58rem", color: "#8a8478", marginTop: 1 }}>{profile.phone && profile.phoneVerified ? "✓ Verified" : profile.phone ? "On file" : "Optional"}</div>
        </div>
        <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: phonePanelOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>{"▼"}</span>
      </div>
      {phonePanelOpen && (
        <div style={{ padding: "8px 11px 10px" }}>
          {profile.phone && <div style={{
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
      }}>{phoneMsg.text}</div>}
        </div>
      )}
    </div>

  {
    /* ═══ Set / Change Password — collapsible ═══ */
  }<div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={`log-group-hdr${pwPanelOpen ? "" : " collapsed"}`}
        onClick={() => { setPwPanelOpen(s => !s); if (pwPanelOpen) { setPwNew(""); setPwConfirm(""); setPwMsg(null); } }}>
        <div className={"log-group-icon"}>{"🔑"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Set / Change Password"}</div>
        </div>
        <span style={{ fontSize: ".62rem", color: "#8a8478", transition: "transform .2s", transform: pwPanelOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>{"▼"}</span>
      </div>
      {pwPanelOpen && (
        <div style={{ padding: "8px 11px 10px" }}>
          <div className={"field"} style={{
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
      }} onClick={changePassword} disabled={!pwNew || !pwConfirm}>{"🔑 Save Password"}</button>
        </div>
      )}
    </div><div className={"div"} />

      <button className={"btn btn-ghost btn-sm"} style={{ width: "100%", marginBottom: S.s8, marginTop: 8 }}
        onClick={() => { setEditMode(false); setSecurityMode(false); setNotifMode(true); }}>
        {"🔔 Notification Preferences"}
      </button>
      <div style={{ marginBottom: S.s6 }}>
        <div style={{
          fontSize: FS.fs68, color: "#8a8478", marginBottom: S.s8, fontStyle: "italic"
        }}>{"Permanently erase all XP, log, plans, and workouts. Cannot be undone."}</div>
        <button className={"btn btn-danger"} style={{ width: "100%" }} onClick={resetChar}>{"↺ Wipe & Rebuild"}</button>
      </div>
    </div>
  )}

</div>}{/* VIEW_MODE_END */}


{/* ── PROFILE EDIT ─────────────────────── */}{editMode && <>

  {/* In-flow header — visible immediately on entering edit mode */}
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: S.s8,
    marginBottom: S.s12,
    padding: "2px 0",
  }}>
    <div className={"sec"} style={{ margin: 0, border: "none", padding: S.s0 }}>{"✎ Edit Profile"}</div>
    <button className={"btn btn-ghost btn-sm"} onClick={() => setEditMode(false)}>{"✕ Cancel"}</button>
  </div>

  {/* Floating save bar — fixed above the bottom nav, always reachable while scrolling */}
  <div style={{
    position: "fixed",
    bottom: "calc(var(--bottom-nav-h) + 10px)",
    left: "50%",
    transform: "translateX(-50%)",
    width: "calc(100% - 32px)",
    maxWidth: 488,
    zIndex: 90,
    display: "flex",
    gap: S.s8,
    padding: "10px 14px",
    background: "rgba(14,13,10,.95)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius: 14,
    border: `1px solid color-mix(in srgb,${cls.color} 18%,rgba(180,172,158,.08))`,
    boxShadow: "0 -4px 24px rgba(0,0,0,.45)",
  }}>
    <button className={"btn btn-ghost btn-sm"} style={{ flex: 1 }} onClick={() => setEditMode(false)}>{"✕ Cancel"}</button>
    <button className={"btn btn-gold"} style={{ flex: 2 }} onClick={saveEdit}>{"⚔️ Save Profile"}</button>
  </div>

  {/* Edit sections — styled as log-group-cards to match the profile view */}
  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>

    {/* ── IDENTITY ── */}
    <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={"log-group-hdr"} style={{ cursor: "default" }}>
        <div className={"log-group-icon"}>{"👤"}</div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Identity"}</div>
      </div>
      <div style={{ padding: "8px 11px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className={"field"}><label>{"Display Name"}</label><input className={"inp"} value={draft.playerName || ""} onChange={e => setDraft(d => ({ ...d, playerName: e.target.value }))} placeholder={"Your warrior name…"} /></div>
        <div style={{ display: "flex", gap: S.s10 }}>
          <div className={"field"} style={{ flex: 1 }}><label>{"First Name"}</label><input className={"inp"} value={draft.firstName || ""} onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))} placeholder={"First name"} /></div>
          <div className={"field"} style={{ flex: 1 }}><label>{"Last Name"}</label><input className={"inp"} value={draft.lastName || ""} onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))} placeholder={"Last name"} /></div>
        </div>
        <div>
          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: ".6rem", color: "#8a8478", letterSpacing: ".13em", textTransform: "uppercase", marginBottom: S.s8 }}>{"Class"}</div>
          <div className={"cls-mini-grid"}>{Object.entries(CLASSES).map(([key, c]) => <div key={key} className={`cls-mini ${draft.chosenClass === key ? "sel" : ""}`} style={{ "--bc": c.color, opacity: c.locked ? 0.35 : 1, cursor: c.locked ? "not-allowed" : "pointer" }} onClick={() => { if (!c.locked) setDraft(d => ({ ...d, chosenClass: key })); }}><div className={"cls-mini-icon"} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><ClassIcon classKey={key} size={18} color={c.glow} /></div><span className={"cls-mini-name"}>{c.locked ? "🔒" : c.name}</span></div>)}</div>
        </div>
      </div>
    </div>

    {/* ── UNITS ── */}
    <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={"log-group-hdr"} style={{ cursor: "default" }}>
        <div className={"log-group-icon"}>{"⚖️"}</div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Measurement Units"}</div>
      </div>
      <div style={{ padding: "8px 11px 12px" }}>
        <div className={"units-toggle"}>
          <div className={`units-opt ${(draft.units || "imperial") === "imperial" ? "on" : ""}`} onClick={() => {
            const cur = draft.units || "imperial";
            if (cur === "metric") {
              const wBack = draft._dispWeight ? parseFloat(kgToLbs(draft._dispWeight)).toFixed(1) : "";
              const htCm = draft._dispHeightCm;
              let hFt = "", hIn = "";
              if (htCm) { const c = cmToFtIn(htCm); hFt = String(c.ft); hIn = String(c.inch); }
              setDraft(d => ({ ...d, units: "imperial", weightLbs: wBack, _dispWeight: "", _dispHeightCm: "", heightFt: hFt, heightIn: hIn }));
            }
          }}>{"🇺🇸 Imperial"}</div>
          <div className={`units-opt ${(draft.units || "imperial") === "metric" ? "on" : ""}`} onClick={() => {
            const cur = draft.units || "imperial";
            if (cur === "imperial") {
              const wKg = draft.weightLbs ? lbsToKg(draft.weightLbs) : "";
              const hCm = ftInToCm(draft.heightFt, draft.heightIn) || "";
              setDraft(d => ({ ...d, units: "metric", _dispWeight: wKg, _dispHeightCm: String(hCm) }));
            }
          }}>{"🌍 Metric"}</div>
        </div>
      </div>
    </div>

    {/* ── BODY STATS ── */}
    <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={"log-group-hdr"} style={{ cursor: "default" }}>
        <div className={"log-group-icon"}>{"💪"}</div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Body Stats"}</div>
      </div>
      <div style={{ padding: "8px 11px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {(draft.units || "imperial") === "imperial" ? <>
          <div className={"r2"}>
            <div className={"field"}><label>{"Weight (lbs)"}</label><input className={"inp"} type={"number"} min={"50"} max={"600"} placeholder={"185"} value={draft.weightLbs || ""} onChange={e => setDraft(d => ({ ...d, weightLbs: e.target.value }))} /></div>
            <div className={"field"}><label>{"Age"}</label><input className={"inp"} type={"number"} min={"10"} max={"100"} placeholder={"30"} value={draft.age || ""} onChange={e => setDraft(d => ({ ...d, age: e.target.value }))} /></div>
          </div>
          <div className={"field"}><label>{"Height (ft / in)"}</label><div style={{ display: "flex", gap: S.s6 }}><input className={"inp"} type={"number"} min={"3"} max={"8"} placeholder={"5"} style={{ width: "50%" }} value={draft.heightFt || ""} onChange={e => setDraft(d => ({ ...d, heightFt: e.target.value }))} /><input className={"inp"} type={"number"} min={"0"} max={"11"} placeholder={"11"} style={{ width: "50%" }} value={draft.heightIn || ""} onChange={e => setDraft(d => ({ ...d, heightIn: e.target.value }))} /></div></div>
          {(() => { const ph = (parseInt(draft.heightFt) || 0) * 12 + (parseInt(draft.heightIn) || 0); const pb = calcBMI(draft.weightLbs, ph); return pb ? <div style={{ fontSize: FS.md, color: "#8a8478", fontStyle: "italic", marginTop: S.sNeg6 }}>{"BMI: "}<span style={{ color: "#b4ac9e" }}>{pb}</span></div> : null; })()}
        </> : <>
          <div className={"r2"}>
            <div className={"field"}><label>{"Weight (kg)"}</label><input className={"inp"} type={"number"} min={"20"} max={"300"} step={"0.1"} placeholder={"84"} value={draft._dispWeight || ""} onChange={e => setDraft(d => ({ ...d, _dispWeight: e.target.value }))} /></div>
            <div className={"field"}><label>{"Age"}</label><input className={"inp"} type={"number"} min={"10"} max={"100"} placeholder={"30"} value={draft.age || ""} onChange={e => setDraft(d => ({ ...d, age: e.target.value }))} /></div>
          </div>
          <div className={"field"}><label>{"Height (cm)"}</label><input className={"inp"} type={"number"} min={"100"} max={"250"} placeholder={"178"} value={draft._dispHeightCm || ""} onChange={e => setDraft(d => ({ ...d, _dispHeightCm: e.target.value }))} /></div>
          {draft._dispWeight && <div style={{ fontSize: FS.md, color: "#8a8478", fontStyle: "italic", marginTop: S.sNeg6 }}>{draft._dispWeight}{" kg = "}{parseFloat(kgToLbs(draft._dispWeight)).toFixed(1)}{" lbs"}</div>}
        </>}
        <div style={{ padding: "8px 12px", background: "rgba(45,42,36,.18)", border: "1px solid rgba(180,172,158,.05)", borderRadius: R.xl }}>
          <div style={{ fontSize: FS.fs62, color: "#8a8478", marginBottom: S.s8, letterSpacing: ".04em", textTransform: "uppercase" }}>{"Show on Hero Banner"}</div>
          <div style={{ display: "flex", gap: S.s6, flexWrap: "wrap" }}>{[{ key: "weight", label: "Weight" }, { key: "height", label: "Height" }, { key: "bmi", label: "BMI" }].map(f => { const on = (draft.hudFields || {})[f.key]; return <button key={f.key} className={`gender-btn ${on ? "sel" : ""}`} style={{ fontSize: FS.fs68 }} onClick={() => setDraft(d => ({ ...d, hudFields: { ...(d.hudFields || {}), [f.key]: !on } }))}>{(on ? "✓ " : "") + f.label}</button>; })}</div>
          <div style={{ fontSize: FS.sm, color: "#8a8478", marginTop: S.s6, fontStyle: "italic" }}>{"Selected fields appear under your name in the main header"}</div>
        </div>
        <div className={"field"}><label>{"Gender "}<span style={{ fontSize: FS.fs55, opacity: .6 }}>{"(optional)"}</span></label><div style={{ display: "flex", gap: S.s6, flexWrap: "wrap" }}>{["Male", "Female", "Prefer not to say"].map(g => <button key={g} className={`gender-btn ${draft.gender === g ? "sel" : ""}`} onClick={() => setDraft(d => ({ ...d, gender: d.gender === g ? "" : g }))}>{g}</button>)}<button className={`gender-btn ${draft.gender && !["Male", "Female", "Prefer not to say"].includes(draft.gender) ? "sel" : ""}`} onClick={() => { const v = window.prompt("Enter your gender identity:", ""); if (v && v.trim()) setDraft(d => ({ ...d, gender: v.trim() })); }}>{draft.gender && !["Male", "Female", "Prefer not to say"].includes(draft.gender) ? draft.gender : "Not Listed"}</button></div>{draft.gender && <div style={{ fontSize: FS.fs62, color: "#b4ac9e", marginTop: S.s4 }}>{"Selected: "}{draft.gender}</div>}</div>
      </div>
    </div>

    {/* ── PREFERENCES ── */}
    <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={"log-group-hdr"} style={{ cursor: "default" }}>
        <div className={"log-group-icon"}>{"🌍"}</div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"Preferences"}</div>
      </div>
      <div style={{ padding: "8px 11px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className={"field"}><label>{"Home Gym"}</label><input className={"inp"} placeholder={"Planet Fitness, Gold's Gym, Home…"} value={draft.gym || ""} onChange={e => setDraft(d => ({ ...d, gym: e.target.value }))} /></div>
        <div style={{ display: "flex", gap: S.s8 }}>
          <div className={"field"} style={{ flex: 1 }}><label>{"State"}</label><select className={"inp"} value={draft.state || ""} onChange={e => setDraft(d => ({ ...d, state: e.target.value }))} style={{ cursor: "pointer" }}><option value={""}>{"Select State"}</option>{["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className={"field"} style={{ flex: 1 }}><label>{"Country"}</label><select className={"inp"} value={draft.country || "United States"} onChange={e => setDraft(d => ({ ...d, country: e.target.value }))} style={{ cursor: "pointer" }}>{["United States","Canada","United Kingdom","Australia","Germany","France","Mexico","Brazil","India","Japan","South Korea","Philippines","Other"].map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div className={"field"}><label>{"Running PB "}<span style={{ fontSize: FS.fs55, opacity: .6 }}>{"("}{isMetric(draft.units || "imperial") ? "min/km" : "min/mi"}{")"}</span></label><input className={"inp"} type={"number"} min={"3"} max={"20"} step={"0.1"} placeholder={isMetric(draft.units || "imperial") ? "e.g. 5.2" : "e.g. 8.5"} value={draft.runningPB || ""} onChange={e => setDraft(d => ({ ...d, runningPB: e.target.value ? parseFloat(e.target.value) : "" }))} /></div>
      </div>
    </div>

    {/* ── ABOUT YOU ── */}
    <div className={"log-group-card"} style={{ "--mg-color": cls.color }}>
      <div className={"log-group-hdr"} style={{ cursor: "default" }}>
        <div className={"log-group-icon"}>{"🌿"}</div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: ".74rem", color: "#d4cec4", fontWeight: 600, letterSpacing: ".03em" }}>{"About You"}</div>
      </div>
      <div style={{ padding: "8px 11px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className={"field"}><label>{"Personal Motto "}<span style={{ fontSize: FS.fs55, opacity: .6 }}>{"(optional)"}</span></label><input className={"inp"} placeholder={"Your battle cry…"} value={draft.motto || ""} onChange={e => setDraft(d => ({ ...d, motto: e.target.value }))} /></div>
        <div className={"field"}><label>{"Training Style"}</label><div style={{ display: "flex", flexWrap: "wrap", gap: S.s6, marginTop: S.s4 }}>{[{ val: "heavy", label: "Heavy Lifts" }, { val: "cardio", label: "Cardio" }, { val: "sculpt", label: "Sculpting" }, { val: "hiit", label: "HIIT" }, { val: "mindful", label: "Mindful" }, { val: "sport", label: "Sport" }, { val: "mixed", label: "Mixed" }].map(o => <button key={o.val} className={`gender-btn ${(draft.trainingStyle || "") === o.val ? "sel" : ""}`} onClick={() => setDraft(d => ({ ...d, trainingStyle: d.trainingStyle === o.val ? "" : o.val }))}>{o.label}</button>)}</div></div>
        <div className={"field"}><label>{"Workout Timing"}</label><div style={{ display: "flex", flexWrap: "wrap", gap: S.s6, marginTop: S.s4 }}>{[{ val: "earlymorning", label: "⚡ Early AM" }, { val: "morning", label: "☀️ Morning" }, { val: "afternoon", label: "Afternoon" }, { val: "evening", label: "🌙 Evening" }, { val: "varies", label: "Varies" }].map(o => <button key={o.val} className={`gender-btn ${(draft.workoutTiming || "") === o.val ? "sel" : ""}`} onClick={() => setDraft(d => ({ ...d, workoutTiming: d.workoutTiming === o.val ? "" : o.val }))}>{o.label}</button>)}</div></div>
        <div className={"field"}><label>{"Fitness Priorities "}<span style={{ fontSize: FS.fs55, opacity: .6 }}>{"(pick up to 3)"}</span></label><div style={{ display: "flex", flexWrap: "wrap", gap: S.s4, marginTop: S.s4 }}>{[{ val: "be_strong", label: "💪 Strong" }, { val: "look_strong", label: "🪞 Look Strong" }, { val: "feel_good", label: "🌿 Feel Good" }, { val: "eat_right", label: "🥗 Nutrition" }, { val: "mental_clarity", label: "🧠 Clarity" }, { val: "athletic_perf", label: "🏅 Performance" }, { val: "endurance", label: "🔥 Endurance" }, { val: "longevity", label: "🕊️ Longevity" }, { val: "competition", label: "🏆 Compete" }, { val: "social", label: "👥 Social" }, { val: "flexibility", label: "🤸 Mobility" }, { val: "weight_loss", label: "⚖️ Weight" }].map(o => { const active = (draft.fitnessPriorities || []).includes(o.val); return <button key={o.val} className={`gender-btn ${active ? "sel" : ""}`} onClick={() => setDraft(d => { const p = d.fitnessPriorities || []; return { ...d, fitnessPriorities: active ? p.filter(x => x !== o.val) : p.length < 3 ? [...p, o.val] : p }; })}>{o.label}</button>; })}</div></div>
        <div className={"field"}><label>{"Sports Background"}</label><div style={{ display: "flex", flexWrap: "wrap", gap: S.s4, marginTop: S.s4 }}>{["Football","Basketball","Soccer","Running","Cycling","Swimming","Boxing","MMA","Wrestling","CrossFit","Powerlifting","Bodybuilding","Yoga","Hiking","Gymnastics","Golf","Triathlon","Rowing","Volleyball","Tennis","Dance"].map(s => { const v = s.toLowerCase().replace(/ /g, "_"); const active = (draft.sportsBackground || []).includes(v); return <button key={v} className={`gender-btn ${active ? "sel" : ""}`} style={{ fontSize: FS.fs62 }} onClick={() => setDraft(d => { const b = d.sportsBackground || []; return { ...d, sportsBackground: active ? b.filter(x => x !== v) : [...b, v] }; })}>{s}</button>; })}</div></div>
      </div>
    </div>

  </div>
  {/* Extra space so the floating save bar doesn't cover the last card */}
  <div style={{ height: 80 }} />
</>}



{/* ── NOTIFICATION PREFERENCES ─────────────────── */}{notifMode && <><div style={{
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
  }}>{"Changes save automatically. Email notifications require a verified email address."}</div></>}
</>
);
});

export default ProfileTab;
