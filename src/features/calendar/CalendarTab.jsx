import React, { memo } from 'react';
import { getMuscleColor } from '../../utils/xp';
import { isMetric, lbsToKg, miToKm } from '../../utils/units';
import { formatXP } from '../../utils/format';
import { todayStr } from '../../utils/helpers';
import { secToHMS } from '../../utils/time';
import { S, R, FS } from '../../utils/tokens';
import { UI_COLORS } from '../../data/constants';

/**
 * Calendar tab — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Renders the "Chronicle" calendar view: month grid with scheduled workouts
 * and logged sessions, day-detail panel, and monthly totals.
 *
 * getEntryStats is co-located here (was a closure in App.jsx, exclusively
 * used by this tab).
 */

const CalendarTab = memo(function CalendarTab({
  // Calendar navigation
  calViewDate, setCalViewDate,
  calSelDate, setCalSelDate,
  // Log group collapse (shared with HistoryTab)
  openLogGroups,
  toggleLogGroup,
  // Profile data
  profile,
  // Computed
  allExById,
  // Callbacks
  setCalExDetailModal,
  setPlansPendingOpen,
  setActiveTab,
  removePlanSchedule,
  removeScheduledWorkout,
}) {
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
    return { durationSec: dur, activeCal: act, totalCal: tot };
  }
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
});

export default CalendarTab;
