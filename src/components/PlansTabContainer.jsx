import React, { useState, useEffect, useMemo, useImperativeHandle } from 'react';
import { PLAN_TEMPLATES, HR_ZONES, NO_SETS_EX_IDS, RUNNING_EX_ID, UI_COLORS, QUESTS } from '../data/constants';
import { CLASSES } from '../data/exercises';
import { _optionalChain, uid, todayStr } from '../utils/helpers';
import { isMetric, lbsToKg, kgToLbs, miToKm, weightLabel, pctToSlider, sliderToPct } from '../utils/units';
import { calcPlanXP, calcDayXP, calcExXP, hrRange, checkQuestCompletion } from '../utils/xp';
import { formatXP } from '../utils/format';
import { S, FS, R } from '../utils/tokens';

const PlanWizard = React.lazy(() => import('./PlanWizard'));
const LazyFallback = <div style={{
  minHeight: 240,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#8a8478',
  fontSize: '.75rem',
  letterSpacing: '.18em',
  textTransform: 'uppercase'
}} role="status" aria-live="polite" aria-label="Loading">Loading…</div>;
const lazyMount = el => <React.Suspense fallback={LazyFallback}>{el}</React.Suspense>;

function formatScheduledDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch (e) { return dateStr; }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const then = new Date(dateStr + "T00:00:00");
    return Math.round((then - now) / 86400000);
  } catch (e) { return null; }
}

const PlansTabContainer = React.memo(React.forwardRef(function PlansTabContainer(props, ref) {
  const {
    profile, setProfile,
    allExercises, allExById, cls,
    showToast, setConfirmDelete,
    setDetailEx, setDetailImgIdx,
    onSchedulePlan, onScheduleEx, onRemoveScheduledWorkout,
    onStatsPrompt, onOpenExEditor,
    setXpFlash, applyAutoCheckIn,
    pendingOpen, onPendingOpenDone,
  } = props;

  const [planView, setPlanView] = useState("list");
  const [collapsedTpls, setCollapsedTpls] = useState(() => {
    const d = {};
    PLAN_TEMPLATES.forEach(t => { d[t.id] = true; });
    return d;
  });
  const [activePlan, setActivePlan] = useState(null);
  const [detailDayIdx, setDetailDayIdx] = useState(0);
  const [wizardEditPlan, setWizardEditPlan] = useState(null);
  const [wizardTemplatePlan, setWizardTemplatePlan] = useState(null);
  const [dragDetailExIdx, setDragDetailExIdx] = useState(null);
  const [collapsedDetailEx, setCollapsedDetailEx] = useState({});

  useImperativeHandle(ref, () => ({
    openBuilder: initBuilderFromTemplate,
    doDeletePlan: _doDeletePlan,
    showList: () => setPlanView("list"),
    syncActivePlanSchedule(planId, scheduledDate, scheduleNotes) {
      setActivePlan(prev => prev && prev.id === planId ? { ...prev, scheduledDate, scheduleNotes } : prev);
    },
  }));

  function toggleDetailEx(dayIdx, exIdx) {
    const k = `${dayIdx}_${exIdx}`;
    setCollapsedDetailEx(s => ({ ...s, [k]: !s[k] }));
  }

  function deletePlan(id) {
    const pl = profile.plans.find(p => p.id === id);
    setConfirmDelete({
      type: "plan",
      id,
      name: pl ? pl.name : "this plan",
      icon: pl ? pl.icon : "📋",
    });
  }

  function _doDeletePlan(id) {
    const pl = (profile.plans || []).find(p => p.id === id);
    if (!pl) return;
    const bin = [...(profile.deletedItems || []), {
      id: uid(), type: "plan", item: pl, deletedAt: new Date().toISOString(),
    }];
    setProfile(p => ({
      ...p,
      plans: p.plans.filter(pl => pl.id !== id),
      deletedItems: bin,
    }));
    setPlanView("list");
    setActivePlan(null);
    showToast("Plan moved to Deleted — recoverable for 7 days.");
  }

  function initBuilderScratch() {
    setWizardEditPlan(null);
    setWizardTemplatePlan(null);
    setPlanView("builder");
  }

  function initBuilderFromTemplate(tpl, customize = false) {
    if (customize) {
      setWizardEditPlan(tpl.custom ? tpl : null);
      setWizardTemplatePlan(tpl.custom ? null : { ...tpl, customize: true });
      setPlanView("builder");
    } else {
      setPlanView("detail");
      setActivePlan(tpl);
    }
  }

  useEffect(() => {
    if (!pendingOpen) return;
    initBuilderFromTemplate(pendingOpen.plan, pendingOpen.isEdit);
    onPendingOpenDone();
  }, [pendingOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePlanWizardSave(planData) {
    if (planData.isEdit) {
      const { isEdit, ...rest } = planData;
      setProfile(pr => ({
        ...pr,
        plans: pr.plans.map(pl => pl.id === planData.id ? { ...pl, ...rest } : pl),
      }));
      setActivePlan(p => ({ ...p, ...rest }));
      setPlanView("list");
      showToast("Plan updated! ⚡");
    } else {
      const { isEdit, ...rest } = planData;
      setProfile(pr => ({ ...pr, plans: [rest, ...pr.plans] }));
      setPlanView("list");
      showToast("Plan saved! ⚡");
    }
  }

  function savePlanEdits(plan) {
    setProfile(p => ({ ...p, plans: p.plans.map(pl => pl.id === plan.id ? plan : pl) }));
    setActivePlan(plan);
    showToast("Plan saved! ✦");
  }

  function startPlanWorkout(plan) {
    const batchId = uid();
    let totalXP = 0;
    const entries = [];
    const clsKey = profile.chosenClass;
    plan.days.forEach(day => {
      day.exercises.forEach(ex => {
        const exData = allExById[ex.exId];
        if (!exData) return;
        const earned = calcExXP(ex.exId, ex.sets, ex.reps, clsKey, allExById, null, ex.weightLbs || null, null);
        totalXP += earned;
        const mult = clsKey ? CLASSES[clsKey]?.bonuses[exData.category] || 1 : 1;
        entries.push({
          exercise: exData.name, icon: exData.icon, xp: earned, mult,
          reps: parseInt(ex.reps) || 1, sets: parseInt(ex.sets) || 1,
          weightLbs: ex.weightLbs || null, weightPct: 100,
          hrZone: null, distanceMi: null,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          date: new Date().toLocaleDateString(), dateKey: todayStr(),
          exId: ex.exId,
          sourcePlanId: plan.id, sourcePlanName: plan.name, sourcePlanIcon: plan.icon,
          sourceGroupId: batchId,
          sourceTotalCal: day.totalCal || null, sourceActiveCal: day.activeCal || null,
          sourceDurationSec: day.durationMin || null,
        });
      });
    });
    const newLog = [...entries, ...profile.log];
    const newQuests = { ...(profile.quests || {}) };
    QUESTS.filter(q => q.auto && !_optionalChain([newQuests, 'access', _a => _a[q.id], 'optionalAccess', _b => _b.completed]))
      .forEach(q => {
        if (checkQuestCompletion(q, newLog, profile.checkInStreak))
          newQuests[q.id] = { completed: true, completedAt: todayStr(), claimed: false };
      });
    let _ciResult = { checkInApplied: false, checkInXP: 0, checkInStreak: 0 };
    setProfile(p => {
      const base = { ...p, xp: p.xp + totalXP, log: newLog, quests: newQuests };
      const ci = applyAutoCheckIn(base, todayStr());
      _ciResult = ci;
      return ci.profile;
    });
    const ciSuffix = _ciResult.checkInApplied
      ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥`
      : "";
    setXpFlash({ amount: totalXP + _ciResult.checkInXP, mult: 1 });
    setTimeout(() => setXpFlash(null), 2500);
    setPlanView("list");
    setActivePlan(null);
    showToast(`Plan complete! ${formatXP(totalXP, { signed: true })} claimed!` + ciSuffix);
  }

  const metric = isMetric(profile.units);
  const wUnit = weightLabel(profile.units);
  const clsKey = profile.chosenClass;

  const scheduledExItems = useMemo(() => {
    const swAll = profile.scheduledWorkouts || [];
    return swAll
      .filter(s => !s.sourceWorkoutId)
      .map(s => {
        const ex = allExById[s.exId];
        return { kind: "ex", id: s.id, exId: s.exId, icon: ex ? ex.icon : "💪", name: ex ? ex.name : "Exercise", date: s.scheduledDate, notes: s.notes };
      })
      .filter(s => s.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [profile.scheduledWorkouts, allExById]);

  const planXPMap = useMemo(
    () => Object.fromEntries(profile.plans.map(p => [p.id, calcPlanXP(p, clsKey, allExById)])),
    [profile.plans, clsKey, allExById]
  );

  const templateXPMap = useMemo(
    () => Object.fromEntries(PLAN_TEMPLATES.map(t => [t.id, calcPlanXP(t, clsKey, allExById)])),
    [clsKey, allExById]
  );

  const detailCurrentDay = activePlan ? activePlan.days[detailDayIdx] || activePlan.days[0] : null;
  const detailTotalXP = useMemo(
    () => activePlan ? calcPlanXP(activePlan, clsKey, allExById) : 0,
    [activePlan, clsKey, allExById]
  );
  const detailDayXP = useMemo(
    () => detailCurrentDay ? calcDayXP(detailCurrentDay, clsKey, allExById) : 0,
    [detailCurrentDay, clsKey, allExById]
  );

  return <>
    {planView === "list" && <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: S.s8 }}>
        <div className={"rpg-sec-header rpg-sec-header-center"}>
          <div className={"rpg-sec-line rpg-sec-line-l"} />
          <span className={"rpg-sec-title"}>
            {"✦ Plans ✦"}
            <span className={"info-icon"} style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 16, height: 16, borderRadius: "50%",
              border: "1px solid rgba(180,172,158,.15)",
              fontSize: FS.fs48, fontWeight: 700, color: "#8a8478",
              fontStyle: "normal", marginLeft: S.s6, verticalAlign: "middle",
              cursor: "pointer", position: "relative",
            }}>
              {"?"}
              <span className={"info-tooltip"}>{"For long term workout plans. May include individual exercises and/or pre-defined workouts."}</span>
            </span>
          </span>
          <div className={"rpg-sec-line rpg-sec-line-r"} />
        </div>
      </div>
      <div style={{ display: "flex", gap: S.s8, marginBottom: S.s14, flexWrap: "wrap" }}>
        <button className={"btn btn-gold btn-sm"} onClick={initBuilderScratch}>{"＋ New Plan"}</button>
        <button className={"btn btn-ghost btn-sm"} onClick={() => setPlanView("recipe-pick")}>{"📋 Recipes"}</button>
      </div>

      {/* Upcoming scheduled exercises */}
      {scheduledExItems.length > 0 && <div className={"upcoming-section"}>
        <div className={"sec"} style={{ marginBottom: S.s8 }}>{"📅 Scheduled Exercises"}</div>
        {scheduledExItems.map(item => {
          const days = daysUntil(item.date);
          const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
          const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
          return <div key={item.id} className={"upcoming-card"}>
            <div className={"upcoming-icon"}>{item.icon}</div>
            <div className={"upcoming-info"}>
              <div className={"upcoming-name"}>{item.name}</div>
              <div className={"upcoming-date"}>
                {formatScheduledDate(item.date)}
                {item.notes ? <span style={{ color: "#8a8478", marginLeft: S.s6 }}>{item.notes}</span> : ""}
              </div>
            </div>
            <span className={`upcoming-badge ${badgeCls}`}>{badgeTxt}</span>
            <div style={{ fontSize: FS.fs65, color: "#b4ac9e", cursor: "pointer", padding: "4px 6px", borderRadius: R.r4 }}
              onClick={e => { e.stopPropagation(); onScheduleEx(item.exId || item.id, item.id); }}>{"✎"}</div>
            <div className={"upcoming-del"} onClick={e => { e.stopPropagation(); onRemoveScheduledWorkout(item.id); }}>{"✕"}</div>
          </div>;
        })}
        <div className={"div"} style={{ margin: "6px 0" }} />
      </div>}

      {profile.plans.length === 0 && <div className={"empty"}>{"No plans yet."}<br />{"Create one or browse recipes."}</div>}

      {profile.plans.map(plan => {
        const planXP = planXPMap[plan.id];
        const hasSched = !!plan.scheduledDate;
        const daysN = hasSched ? daysUntil(plan.scheduledDate) : null;
        return <div key={plan.id} className={"plan-card"} style={{ "--pc": cls && cls.color || "#b4ac9e" }}>
          <div className={"plan-card-top"} onClick={() => { initBuilderFromTemplate(plan, true); }}>
            <div className={"plan-icon"}>{plan.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.s6, marginBottom: S.s2 }}>
                <div className={"plan-name"} style={{ flex: 1 }}>{plan.name}</div>
                {plan.level && <span className={`plan-level-badge ${plan.level.toLowerCase()}`} style={{ flexShrink: 0 }}>{plan.level}</span>}
              </div>
              <div className={"plan-meta"}>
                <span className={`plan-type-badge type-${plan.type}`}>{plan.durCount && plan.durCount > 1 ? `${plan.durCount} ${plan.type}s` : plan.type}</span>
                <span style={{ marginLeft: S.s6, fontSize: FS.sm, color: "#8a8478" }}>{plan.days.filter(d => d.exercises.length > 0).length}{" active days"}</span>
                {plan.startDate && <span style={{ marginLeft: S.s6, fontSize: FS.sm, color: "#8a8478" }}>
                  {"📅 "}{new Date(plan.startDate + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                  {plan.endDate ? " → " + new Date(plan.endDate + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : ""}
                </span>}
                {!plan.startDate && hasSched && <span style={{ marginLeft: S.s6, fontSize: FS.sm, color: "#b4ac9e" }}>{"📅 "}{formatScheduledDate(plan.scheduledDate)}</span>}
              </div>
            </div>
            <div className={"plan-xp-badge"}>{"⚡ "}{planXP.toLocaleString()}</div>
          </div>
          {plan.description && <div className={"plan-desc"} onClick={() => { initBuilderFromTemplate(plan, true); }}>{plan.description}</div>}
          <div style={{ display: "flex", gap: S.s8, marginTop: S.s8, paddingTop: 7, borderTop: "1px solid rgba(45,42,36,.18)" }}>
            <button className={`plan-sched-btn ${hasSched ? "plan-sched-active" : ""}`} onClick={e => { e.stopPropagation(); onSchedulePlan(plan); }}>
              {hasSched ? "📅 " + formatScheduledDate(plan.scheduledDate) : "📅 Schedule"}
            </button>
            <div style={{ flex: 1 }} />
            <button className={"btn btn-ghost btn-xs"} onClick={e => { e.stopPropagation(); initBuilderFromTemplate(plan, true); }}>{"View →"}</button>
          </div>
        </div>;
      })}
    </>}

    {planView === "recipe-pick" && <>
      <div style={{ display: "flex", alignItems: "center", gap: S.s8, marginBottom: S.s12 }}>
        <button className={"btn btn-ghost btn-sm"} onClick={() => setPlanView("list")}>{"← Back"}</button>
        <div className={"sec"} style={{ margin: 0, border: "none", padding: S.s0 }}>{"Plan Recipes"}</div>
      </div>
      {["day", "week"].map(type => {
        const typePlans = PLAN_TEMPLATES.filter(t => t.type === type);
        if (!typePlans.length) return null;
        return <div key={type}>
          <div className={"sec"} style={{ textTransform: "capitalize", marginBottom: S.s8 }}>{type}{" Plans"}</div>
          {typePlans.map(tpl => {
            const isCollapsed = !!collapsedTpls[tpl.id];
            const isRec = tpl.bestFor.includes(clsKey);
            const activeDays = tpl.days.filter(d => d.exercises.length > 0);
            const tplXP = templateXPMap[tpl.id];
            return <div key={tpl.id} className={"workout-card"} style={{ marginBottom: S.s10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: S.s10, cursor: "pointer" }}
                onClick={() => setCollapsedTpls(s => ({ ...s, [tpl.id]: !s[tpl.id] }))}>
                <div className={"workout-icon"} style={{ flexShrink: 0 }}>{tpl.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.s6, marginBottom: S.s4 }}>
                    <div className={"workout-name"} style={{ flex: 1 }}>{tpl.name}</div>
                    {tpl.level && <span className={`plan-level-badge ${tpl.level.toLowerCase()}`} style={{ flexShrink: 0 }}>{tpl.level}</span>}
                  </div>
                  <div className={"workout-meta"}>
                    <span className={"workout-tag"}>{activeDays.length}{" active day"}{activeDays.length !== 1 ? "s" : ""}</span>
                    <span className={"workout-tag"}>{formatXP(tplXP, { prefix: "⚡ " })}</span>
                    <span className={`plan-type-badge type-${tpl.type}`} style={{ marginLeft: S.s4 }}>{tpl.durCount && tpl.durCount > 1 ? `${tpl.durCount} ${tpl.type}s` : tpl.type}</span>
                    {isRec && <span style={{ fontSize: FS.fs56, color: _optionalChain([cls, 'optionalAccess', _a => _a.color]), marginLeft: S.s4 }}>{"✦ "}{_optionalChain([cls, 'optionalAccess', _b => _b.name])}</span>}
                  </div>
                </div>
                <span style={{ flexShrink: 0, paddingTop: 2, lineHeight: 1, display: "flex", alignItems: "center" }}>
                  <svg width={"18"} height={"18"} viewBox={"0 0 18 18"} fill={"none"} xmlns={"http://www.w3.org/2000/svg"}
                    style={{ transition: "transform .25s ease", transform: isCollapsed ? "rotate(0deg)" : "rotate(180deg)" }}>
                    <defs><linearGradient id={"chevGrad"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs>
                    <polyline points={"4,7 9,12 14,7"} stroke={"url(#chevGrad)"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"} />
                  </svg>
                </span>
              </div>
              {!isCollapsed && (() => {
                const allTplExIds = [...new Set(tpl.days.flatMap(d => d.exercises.map(e => e.exId)))];
                return <div style={{ marginTop: S.s10 }}>
                  <div className={"workout-ex-pill-row"} style={{ marginBottom: S.s10 }}>
                    {allTplExIds.slice(0, 6).map((exId, i) => {
                      const exD = allExById[exId];
                      return exD ? <span key={i} className={"workout-ex-pill"}>{exD.icon}{" "}{exD.name}</span> : null;
                    })}
                    {allTplExIds.length > 6 && <span className={"workout-ex-pill"}>{"+"}{allTplExIds.length - 6}{" more"}</span>}
                  </div>
                  {tpl.description && <div style={{ fontSize: FS.lg, color: "#8a8478", fontStyle: "italic", marginBottom: S.s12, lineHeight: 1.6 }}>{tpl.description}</div>}
                  <div style={{ background: "rgba(45,42,36,.12)", border: "1px solid rgba(45,42,36,.18)", borderRadius: R.lg, padding: "8px 12px", marginBottom: S.s12 }}>
                    {tpl.days.map((day, di) => <div key={di} style={{ display: "flex", alignItems: "flex-start", gap: S.s8, padding: "4px 0", borderBottom: di < tpl.days.length - 1 ? "1px solid rgba(45,42,36,.15)" : "" }}>
                      <span style={{ fontSize: FS.fs65, color: "#b4ac9e", minWidth: 50, flexShrink: 0, paddingTop: 1 }}>{day.label || `Day ${di + 1}`}</span>
                      <span style={{ fontSize: FS.fs68, color: "#8a8478", flex: 1 }}>
                        {day.exercises.length === 0
                          ? <span style={{ color: "#8a8478", fontStyle: "italic" }}>{"Rest"}</span>
                          : day.exercises.map((e, ei) => { const exD = allExById[e.exId]; return exD ? <span key={ei}>{ei > 0 ? " · " : ""}{exD.icon}{" "}{exD.name}{" "}{e.sets}{"×"}{e.reps}</span> : null; })}
                      </span>
                    </div>)}
                  </div>
                  <div style={{ display: "flex", gap: S.s8 }}>
                    <button className={"btn btn-ghost btn-sm"} style={{ flex: 1 }} onClick={e => { e.stopPropagation(); initBuilderFromTemplate(tpl, false); }}>{"👁 View This Plan"}</button>
                    <button className={"btn btn-gold btn-sm"} style={{ flex: 1 }} onClick={e => { e.stopPropagation(); initBuilderFromTemplate(tpl, true); }}>{"✎ Customize First"}</button>
                  </div>
                </div>;
              })()}
            </div>;
          })}
        </div>;
      })}
    </>}

    {planView === "detail" && activePlan && (() => {
      const plan = activePlan;
      const [vDayIdx, setVDayIdx] = [detailDayIdx, setDetailDayIdx];
      const totalXP = detailTotalXP;
      const currentDay = detailCurrentDay;
      const dayXP = detailDayXP;
      function updateDetailEx(dayI, exI, field, val) {
        const newDays = plan.days.map((d, di) => di !== dayI ? d : {
          ...d,
          exercises: d.exercises.map((e, ei) => ei !== exI ? e : { ...e, [field]: val }),
        });
        setActivePlan({ ...plan, days: newDays });
      }
      return <>
        <div style={{ display: "flex", alignItems: "center", gap: S.s8, marginBottom: S.s14 }}>
          <button className={"btn btn-ghost btn-sm"} onClick={() => { setPlanView("list"); setActivePlan(null); setDetailDayIdx(0); }}>{"← Back"}</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: FS.fs86, color: "#d4cec4" }}>
              {plan.icon}{" "}{plan.name}
              {plan.level && <span className={`plan-level-badge ${plan.level.toLowerCase()}`} style={{ marginLeft: S.s8, verticalAlign: "middle" }}>{plan.level}</span>}
            </div>
          </div>
          <button className={"btn btn-ghost btn-sm"} style={{ flexShrink: 0 }} onClick={() => initBuilderFromTemplate(plan, true)}>{"✎ Customize"}</button>
          {plan.custom && <button className={"btn btn-gold btn-sm"} onClick={() => savePlanEdits(plan)}>{"💾 Save"}</button>}
        </div>

        <div className={"xp-projection"} style={{ marginBottom: S.s12 }}>
          <div>
            <div className={"xp-proj-label"}>{"Total Projected XP"}</div>
            <div className={"xp-proj-detail"}>
              {plan.days.filter(d => d.exercises.length > 0).length}{" active days · "}{cls && cls.name}{" bonuses applied"}
              {plan.durCount && <span style={{ marginLeft: S.s6 }}>{"· "}<span className={`plan-type-badge type-${plan.type}`} style={{ verticalAlign: "middle" }}>{plan.durCount > 1 ? `${plan.durCount} ${plan.type}s` : plan.type}</span></span>}
            </div>
            {(plan.startDate || plan.endDate) && <div style={{ fontSize: FS.fs63, color: "#8a8478", marginTop: S.s4 }}>
              {plan.startDate && <span>{"📅 "}{new Date(plan.startDate + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>}
              {plan.startDate && plan.endDate && <span style={{ margin: "0 4px" }}>{"→"}</span>}
              {plan.endDate && <span>{new Date(plan.endDate + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>}
              {plan.startDate && plan.endDate && (() => {
                const s = new Date(plan.startDate + "T12:00:00");
                const e = new Date(plan.endDate + "T12:00:00");
                const days = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
                return <span style={{ color: "#8a8478", marginLeft: S.s4 }}>{"("}{days}{" day"}{days !== 1 ? "s" : ""}{")"}</span>;
              })()}
            </div>}
          </div>
          <div className={"xp-proj-value"}>{"⚡ "}{totalXP.toLocaleString()}</div>
        </div>

        <div className={"day-tab-row"}>
          {plan.days.map((d, i) => <div key={i} className={`day-tab ${vDayIdx === i ? "on" : ""} ${d.exercises.length === 0 ? "rest-day" : ""}`} onClick={() => setVDayIdx(i)}>{d.label}</div>)}
        </div>
        {currentDay.exercises.length > 0 && <div className={"day-xp-row"}><span className={"day-xp-label"}>{currentDay.label}{" projected XP"}</span><span className={"day-xp-value"}>{"⚡ "}{dayXP}</span></div>}
        {!plan.custom && <div style={{ fontSize: FS.fs64, color: "#8a8478", fontStyle: "italic", marginBottom: S.s8 }}>{"Tip: Customize this plan to save weight/duration edits permanently."}</div>}

        {currentDay.exercises.length === 0
          ? <div className={"empty"} style={{ padding: "22px 0" }}>{"Rest day. Recover well."}</div>
          : currentDay.exercises.map((ex, exI) => {
              const exData = allExById[ex.exId];
              if (!exData) return null;
              const noSetsEx = NO_SETS_EX_IDS.has(exData.id);
              const isRunningEx = exData.id === RUNNING_EX_ID;
              const distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
              const exXP = calcExXP(ex.exId, noSetsEx ? 1 : ex.sets, ex.reps, clsKey, allExById, distMiVal || null, ex.weightLbs || null, null);
              const mult = clsKey && CLASSES[clsKey]?.bonuses && exData.category ? CLASSES[clsKey].bonuses[exData.category] || 1 : 1;
              const isCardioEx = exData.category === "cardio" || exData.category === "endurance";
              const hasWeightEx = !isCardioEx && exData.category !== "flexibility";
              const inputWVal = ex.weightLbs ? metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
              const inputDurVal = ex.durationMin || "";
              const inputDistVal = ex.distanceMi ? metric ? String(parseFloat((ex.distanceMi * 1.60934).toFixed(2))) : String(ex.distanceMi) : "";
              const age = profile.age || 30;
              const pbPaceMi = profile.runningPB || null;
              const pbDisp = pbPaceMi ? metric ? parseFloat((pbPaceMi * 1.60934).toFixed(2)) + " min/km" : parseFloat(pbPaceMi.toFixed(2)) + " min/mi" : null;
              const exPB2 = (profile.exercisePBs || {})[exData.id] || null;
              const exPBDisp2 = exPB2 ? exPB2.type === "cardio" ? metric ? parseFloat((exPB2.value * 1.60934).toFixed(2)) + " min/km" : parseFloat(exPB2.value.toFixed(2)) + " min/mi" : exPB2.type === "assisted" ? "1RM: " + exPB2.value + (metric ? " kg" : " lbs") + " (Assisted)" : "1RM: " + exPB2.value + (metric ? " kg" : " lbs") : null;
              const durationMin = parseFloat(ex.reps || 0);
              const runPace = isRunningEx && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
              const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
              return <div key={exI} className={`plan-ex-row ${dragDetailExIdx === exI ? "dragging" : ""}`} style={{ flexDirection: "column", alignItems: "stretch", gap: S.s0, opacity: dragDetailExIdx === exI ? 0.5 : 1 }}
                draggable={true}
                onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragDetailExIdx(exI); }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={e => {
                  e.preventDefault();
                  if (dragDetailExIdx === null) return;
                  const nd = plan.days.map((d, di) => {
                    if (di !== vDayIdx) return d;
                    const exs = [...d.exercises];
                    const [m] = exs.splice(dragDetailExIdx, 1);
                    exs.splice(exI, 0, m);
                    return { ...d, exercises: exs };
                  });
                  setActivePlan({ ...plan, days: nd });
                  setDragDetailExIdx(null);
                }}
                onDragEnd={() => setDragDetailExIdx(null)}>
                {(() => {
                  const collapsed = !!collapsedDetailEx[`${vDayIdx}_${exI}`];
                  return <>
                    <div style={{ display: "flex", alignItems: "center", gap: S.s6, marginBottom: collapsed ? 0 : 7 }}>
                      <span aria-hidden={"true"} style={{ cursor: "grab", color: "#8a8478", fontSize: FS.fs90, flexShrink: 0 }}>{"⠿"}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: S.s2, flexShrink: 0 }} />
                      <span className={"plan-ex-icon"}>{exData.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={"plan-ex-name"}>{exData.name}</div>
                        {exData.id !== "rest_day" && <div className={"plan-ex-sets"}>
                          {noSetsEx ? "" : ex.sets + "×"}{ex.reps}
                          {ex.weightLbs && <span style={{ color: "#8a8478", marginLeft: S.s6 }}>{metric ? lbsToKg(ex.weightLbs) + " kg" : ex.weightLbs + " lbs"}</span>}
                          {ex.durationMin && <span style={{ color: "#8a8478", marginLeft: S.s6 }}>{ex.durationMin}{" min"}</span>}
                          {ex.distanceMi && <span style={{ color: "#8a8478", marginLeft: S.s6 }}>{metric ? parseFloat((ex.distanceMi * 1.60934).toFixed(1)) + " km" : ex.distanceMi + " mi"}</span>}
                          {ex.hrZone && <span style={{ color: HR_ZONES[ex.hrZone - 1].color, marginLeft: S.s6 }}>{"Z"}{ex.hrZone}</span>}
                          <span className={`ex-mult ${mult > 1.02 ? "mb" : mult < 0.98 ? "mp" : "mn"}`} style={{ marginLeft: S.s6 }}>{Math.round(mult * 100)}{"%"}</span>
                        </div>}
                      </div>
                      {(isRunningEx && pbDisp || exPBDisp2) && <span style={{ fontSize: FS.fs58, color: "#b4ac9e", flexShrink: 0 }}>{"🏆 "}{isRunningEx && pbDisp ? pbDisp : exPBDisp2}</span>}
                      <div className={"plan-ex-xp"}>{"+"}{exXP}{" XP"}{runBoostPct > 0 && <span style={{ color: UI_COLORS.warning, marginLeft: S.s2 }}>{"⚡"}</span>}</div>
                      <div className={"ex-info-btn"} style={{ position: "static" }} onClick={() => { setDetailEx(exData); setDetailImgIdx(0); }}>{"ℹ"}</div>
                      <span className={"ex-collapse-btn"} onClick={e => { e.stopPropagation(); toggleDetailEx(vDayIdx, exI); }}>
                        <svg width={"14"} height={"14"} viewBox={"0 0 14 14"} fill={"none"} xmlns={"http://www.w3.org/2000/svg"} style={{ transition: "transform .22s ease", transform: collapsed ? "rotate(0deg)" : "rotate(180deg)" }}>
                          <defs><linearGradient id={"cg2"} x1={"0"} y1={"0"} x2={"0"} y2={"1"}><stop offset={"0%"} stopColor={"#b4ac9e"} /><stop offset={"100%"} stopColor={"#7a4e1a"} /></linearGradient></defs>
                          <polyline points={"3,5 7,9 11,5"} stroke={"url(#cg2)"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} />
                        </svg>
                      </span>
                    </div>
                    {!collapsed && exData.id !== "rest_day" && <>
                      <div style={{ display: "flex", gap: S.s8, marginBottom: S.s6 }}>
                        {!noSetsEx && <div style={{ flex: 1 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", marginBottom: S.s4, display: "block" }}>{"Sets"}</label>
                          <input className={"plan-ex-edit-inp"} style={{ width: "100%" }} type={"text"} inputMode={"decimal"}
                            value={ex.sets === 0 || ex.sets === "" ? "" : ex.sets || ""}
                            onChange={e => updateDetailEx(vDayIdx, exI, "sets", e.target.value)} />
                        </div>}
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", marginBottom: S.s4, display: "block" }}>{isCardioEx ? "Duration (min)" : "Reps"}</label>
                          <input className={"plan-ex-edit-inp"} style={{ width: "100%" }} type={"text"} inputMode={"decimal"}
                            value={ex.reps === 0 || ex.reps === "" ? "" : ex.reps || ""}
                            onChange={e => updateDetailEx(vDayIdx, exI, "reps", e.target.value)} />
                        </div>
                        {hasWeightEx && <div style={{ flex: 1 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", marginBottom: S.s4, display: "block" }}>{wUnit}</label>
                          <input className={"plan-ex-edit-inp"} style={{ width: "100%" }} type={"text"} inputMode={"decimal"} step={metric ? "0.5" : "2.5"}
                            value={inputWVal} placeholder={"—"}
                            onChange={e => {
                              const v = e.target.value;
                              const lbs = v && metric ? kgToLbs(v) : v;
                              updateDetailEx(vDayIdx, exI, "weightLbs", lbs || null);
                            }} />
                        </div>}
                      </div>
                      {isRunningEx && runBoostPct > 0 && <div style={{ fontSize: FS.fs65, color: UI_COLORS.warning, marginBottom: S.s6 }}>{"⚡ +"}{runBoostPct}{"% pace bonus"}{runBoostPct === 20 ? " (sub-8 mi!)" : ""}</div>}
                      {hasWeightEx && <div style={{ marginBottom: S.s6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: S.s2 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", marginBottom: S.s0 }}>{"Weight Intensity"}</label>
                          <span style={{ fontSize: FS.fs68, color: "#b4ac9e" }}>{ex.weightPct || 100}{"%"}</span>
                        </div>
                        <input type={"range"} className={"pct-slider"} min={"0"} max={"100"} step={"5"}
                          value={pctToSlider(ex.weightPct || 100)}
                          onChange={e => updateDetailEx(vDayIdx, exI, "weightPct", sliderToPct(Number(e.target.value)))} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: FS.fs55, color: "#8a8478", marginTop: S.s2 }}>
                          <span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span>
                        </div>
                      </div>}
                      {isCardioEx && <div style={{ marginBottom: S.s6 }}>
                        <label style={{ fontSize: FS.sm, color: "#b0a898", marginBottom: S.s4, display: "block" }}>{"Distance ("}{metric ? "km" : "mi"}{") "}<span style={{ opacity: .6, fontSize: FS.fs55 }}>{"(optional)"}</span></label>
                        <input className={"plan-ex-edit-inp"} style={{ width: "100%" }} type={"text"} inputMode={"decimal"}
                          value={inputDistVal} placeholder={"0"}
                          onChange={e => {
                            const v = e.target.value;
                            const mi = v && metric ? String(parseFloat((parseFloat(v) / 1.60934).toFixed(4))) : v;
                            updateDetailEx(vDayIdx, exI, "distanceMi", mi || null);
                          }} />
                      </div>}
                      {isCardioEx && <div>
                        <label style={{ fontSize: FS.sm, color: "#b0a898", marginBottom: S.s4, display: "block" }}>{"Avg Heart Rate Zone "}<span style={{ opacity: .6, fontSize: FS.fs55 }}>{"(optional)"}</span></label>
                        <div className={"hr-zone-row"}>
                          {HR_ZONES.map(z => {
                            const sel = ex.hrZone === z.z;
                            const range = hrRange(age, z);
                            return <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{ "--zc": z.color, borderColor: sel ? z.color : "rgba(45,42,36,.2)", background: sel ? `${z.color}22` : "rgba(45,42,36,.12)" }}
                              onClick={() => updateDetailEx(vDayIdx, exI, "hrZone", sel ? null : z.z)}>
                              <span className={"hz-name"} style={{ color: sel ? z.color : "#8a8478" }}>{"Z"}{z.z}{" "}{z.name}</span>
                              <span className={"hz-bpm"} style={{ color: sel ? z.color : "#8a8478" }}>{range.lo}{"–"}{range.hi}</span>
                            </div>;
                          })}
                        </div>
                        {ex.hrZone && <div style={{ fontSize: FS.fs65, color: "#8a8478", fontStyle: "italic", marginTop: S.s4 }}>{HR_ZONES[ex.hrZone - 1].desc}</div>}
                      </div>}
                    </>}
                  </>;
                })()}
              </div>;
            })}

        <div className={"div"} />
        {(() => {
          const isUserPlan = (profile.plans || []).some(p => p.id === plan.id);
          if (!isUserPlan) {
            return <div style={{ background: "rgba(45,42,36,.15)", border: "1px solid rgba(180,172,158,.06)", borderRadius: R.r10, padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: FS.lg, color: "#8a8478", marginBottom: S.s8 }}>{"This is a recipe preview. Customize it to add it to your plans."}</div>
              <button className={"btn btn-gold"} style={{ width: "100%" }} onClick={() => initBuilderFromTemplate(plan, true)}>{"✎ Customize & Add to My Plans"}</button>
            </div>;
          }
          return <>
            <div className={"plan-actions"}>
              <button className={"btn btn-glass-yellow"} style={{ flex: 1 }} onClick={() => {
                const synth = { name: currentDay.label || "Day", icon: plan.icon || "📋", exercises: currentDay.exercises, durationMin: currentDay.durationMin || null, activeCal: currentDay.activeCal || null, totalCal: currentDay.totalCal || null };
                onStatsPrompt(synth, (woWithStats, _sr) => {
                  startPlanWorkout({ ...plan, days: [{ ...currentDay, durationMin: woWithStats.durationMin, activeCal: woWithStats.activeCal, totalCal: woWithStats.totalCal }] });
                });
              }}>{"✓ Complete Day"}</button>
            </div>
            <div style={{ display: "flex", gap: S.s8, marginTop: S.s8 }}>
              <button className={`plan-sched-btn ${plan.scheduledDate ? "plan-sched-active" : ""}`} style={{ flex: 1, padding: "8px 12px", textAlign: "center" }} onClick={() => onSchedulePlan(plan)}>
                {plan.scheduledDate ? "📅 " + formatScheduledDate(plan.scheduledDate) : "📅 Schedule"}
              </button>
              {plan.custom && <button className={"btn btn-danger btn-sm"} style={{ flex: 1 }} onClick={() => deletePlan(plan.id)}>{"🗑 Delete"}</button>}
            </div>
            {plan.custom && <button className={"btn btn-glass"} style={{ width: "100%", marginTop: S.s8 }} onClick={() => startPlanWorkout(plan)}>{"📋 Mark Plan Complete"}</button>}
          </>;
        })()}
      </>;
    })()}

    {planView === "builder" && lazyMount(<PlanWizard
      editPlan={wizardEditPlan}
      templatePlan={wizardTemplatePlan}
      profile={profile}
      allExercises={allExercises}
      allExById={allExById}
      onSave={handlePlanWizardSave}
      onClose={() => { setPlanView("list"); }}
      onCompleteDayStart={onStatsPrompt}
      onStartPlanWorkout={startPlanWorkout}
      onDeletePlan={deletePlan}
      onSchedulePlan={onSchedulePlan}
      onOpenExEditor={onOpenExEditor}
      showToast={showToast}
    />)}
  </>;
}));

export default PlansTabContainer;
