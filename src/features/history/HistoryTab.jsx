import React, { memo } from 'react';
import { isMetric, lbsToKg, miToKm } from '../../utils/units';
import { formatXP } from '../../utils/format';
import { getMuscleColor, calcExercisePBs } from '../../utils/xp';
import { _optionalChain, uid } from '../../utils/helpers';
import { S, R, FS } from '../../utils/tokens';
import { UI_COLORS, HR_ZONES } from '../../data/constants';
import { useScrollReveal } from '../../hooks/useScrollReveal';

// Lazy TrendsTab — same pattern as App.jsx so recharts stays out of the
// main chunk until the user actually opens the trends sub-tab.
const TrendsTab = React.lazy(() => import('../../components/TrendsTab').then(m => ({
  default: m.TrendsTab
})));

// Local mirror of TrendsTab's DEFAULT_CHART_ORDER so we don't have to eagerly
// import the TrendsTab module (which would drag recharts into the main chunk)
// just to read this constant. Keep in sync with TrendsTab.js.
const DEFAULT_CHART_ORDER = ["dow", "sets", "muscleFreq", "volume", "consistency", "topEx"];

// Tiny Suspense fallback for the lazy-loaded trends sub-tab. Matches the
// dark theme so it doesn't flash a white box during chunk fetch.
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

/**
 * History tab — extracted from the inline IIFE in App.jsx as the
 * fifth slice of Finding #6 (App.jsx decomposition) per
 * docs/performance-audit.md (PR #116).
 *
 * Pure presentational tab. State + setters come in as props from App.
 * Inner components (EntryRow, ExercisesTab, WorkoutsTab/GroupCard,
 * PlansTab) stay co-located inside HistoryTab — they close over props
 * and the locally-derived `logWithIdx` / `metric`.
 *
 * Wrapped in React.memo so unrelated App re-renders (toast, xpFlash,
 * modals on other tabs) don't drag the history tab into a re-render
 * when none of its props changed. Matches the convention from
 * MessagesTab (PR #124) and the exercise-tab extractions.
 */

const HistoryTab = memo(function HistoryTab({
  // Profile data
  profile, setProfile,
  allExById,
  // Sub-tab state
  logSubTab, setLogSubTab,
  // Group collapse state
  openLogGroups, toggleLogGroup,
  // Edit / delete callbacks
  openLogEdit,
  deleteLogEntryByIdx,
  // Save wizards
  openSaveWorkoutWizard,
  openSavePlanWizard,
  // Modal setters
  setRetroEditModal,
  setConfirmDelete,
  // Toast
  showToast,
  // Class color (passed as scalar to avoid threading whole `cls`)
  clsColor,
}) {

  const metric = isMetric(profile.units);
  const revealRef = useScrollReveal();
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
    return <div ref={revealRef} className={"h-entry scroll-reveal"} style={{
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
    const standaloneEntries = logWithIdx.filter(e => !e.sourceWorkoutId && !e.sourcePlanId);
    const groups = {};
    standaloneEntries.forEach(e => {
      const dk = e.dateKey || e.date || "Unknown";
      if (!groups[dk]) groups[dk] = [];
      groups[dk].push(e);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return <>{standaloneEntries.length === 0 && <div className={"empty"}>{"No standalone exercises logged yet."}<br />{"Exercises from workouts and plans appear in their own tabs."}</div>}{sortedKeys.map(dk => {
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
  return <><div className={"sec"}>{"Battle Record — "}{profile.log.length}{" sessions · "}{formatXP(profile.xp)}{" total"}</div><div className={"log-subtab-bar"}>{[["exercises", "⚔️ Exercises"], ["workouts", "💪 Workouts"], ["trends", "📊 Trends"], ["deleted", "🗑 Deleted"]].map(([t, l]) => <button key={t} className={`log-subtab-btn ${logSubTab === t ? "on" : ""}`} onClick={() => setLogSubTab(t)}>{l}{t === "deleted" && (profile.deletedItems || []).filter(d => (new Date() - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24) < 7).length > 0 && <span style={{
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
        }}>{(profile.deletedItems || []).filter(d => (new Date() - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24) < 7).length}</span>}</button>)}</div>{logSubTab === "exercises" && <ExercisesTab />}{logSubTab === "workouts" && <WorkoutsTab />}{logSubTab === "trends" && lazyMount(<TrendsTab log={profile.log} allExById={allExById} clsColor={clsColor} units={profile.units} chartOrder={profile.chartOrder || DEFAULT_CHART_ORDER} onChartOrderChange={order => setProfile(p => ({
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
});

export default HistoryTab;
