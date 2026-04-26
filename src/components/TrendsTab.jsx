import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid
} from 'recharts';
import { CAT_ICON_COLORS, MUSCLE_COLORS } from '../data/constants';
import { isMetric, lbsToKg } from '../utils/units';

const RANGE_OPTIONS = [
  ["7d",  "7 Days"],
  ["30d", "30 Days"],
  ["90d", "90 Days"],
  ["6m",  "6 Months"],
  ["all", "All Time"],
];

const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const HEATMAP_METRICS = [
  ["sessions", "Sessions"],
  ["duration", "Duration"],
  ["totalCal", "Total Cal"],
  ["activeCal", "Active Cal"],
];

const DEFAULT_CHART_ORDER = ["dow","sets","muscleFreq","volume","consistency","topEx"];

function cutoffDate(range) {
  const now = new Date();
  switch (range) {
    case "7d":  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case "30d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    case "90d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
    case "6m":  return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    default:    return null;
  }
}

function weekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return d.getFullYear() + "-W" + String(week).padStart(2, "0");
}

function weekLabel(wk) {
  const [y, w] = wk.split("-W");
  const jan1 = new Date(Number(y), 0, 1);
  const dayOffset = (Number(w) - 1) * 7 - jan1.getDay();
  const d = new Date(Number(y), 0, 1 + dayOffset);
  const mo = d.toLocaleString("default", { month: "short" });
  return mo + " " + d.getDate();
}

function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(20,18,15,.92)",
  border: "1px solid rgba(180,172,158,.15)",
  borderRadius: 8,
  fontSize: ".68rem",
  color: "#d4cec4",
  backdropFilter: "blur(8px)",
};

const CARD_STYLE = {
  background: "rgba(30,28,24,.55)",
  border: "1px solid rgba(180,172,158,.08)",
  borderRadius: 14,
  padding: "16px 14px",
  marginBottom: 14,
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const CARD_TITLE = {
  fontSize: ".82rem",
  fontWeight: 700,
  color: "#b4ac9e",
  fontFamily: "'Cinzel', serif",
  letterSpacing: ".03em",
  flex: 1,
};

const INSIGHT_STYLE = {
  fontSize: ".62rem",
  color: "#8a8478",
  fontStyle: "italic",
  marginTop: 8,
  lineHeight: 1.5,
};

function TrendsTab({ log, allExById, clsColor, units, chartOrder: savedOrder, onChartOrderChange, workouts, plans }) {
  const [range, setRange] = useState("30d");
  const [heatMetric, setHeatMetric] = useState("sessions");
  const [volMuscleFilter, setVolMuscleFilter] = useState("_all");
  const [dragIdx, setDragIdx] = useState(null);
  const metric = isMetric(units);

  // ── Retroactive stats lookup (mirrors getEntryStats in App.js) ──
  function getEntryStats(entry) {
    let dur = Number(entry.sourceDurationSec) || 0;
    let act = Number(entry.sourceActiveCal) || 0;
    let tot = Number(entry.sourceTotalCal) || 0;
    if (!dur && !act && !tot) {
      if (entry.sourceWorkoutId) {
        const wo = (workouts || []).find(w => w.id === entry.sourceWorkoutId);
        if (wo) { dur = Number(wo.durationMin) || 0; act = Number(wo.activeCal) || 0; tot = Number(wo.totalCal) || 0; }
      } else if (entry.sourcePlanId) {
        const pl = (plans || []).find(p => p.id === entry.sourcePlanId);
        if (pl && pl.days) {
          pl.days.forEach(d => { dur += Number(d.durationMin) || 0; act += Number(d.activeCal) || 0; tot += Number(d.totalCal) || 0; });
        }
      }
    }
    return { durationSec: dur, activeCal: act, totalCal: tot };
  }

  // ── Chart order ──
  const chartOrder = useMemo(() => {
    if (savedOrder && Array.isArray(savedOrder) && savedOrder.length === DEFAULT_CHART_ORDER.length) return savedOrder;
    return DEFAULT_CHART_ORDER;
  }, [savedOrder]);

  function moveChart(fromIdx, toIdx) {
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= chartOrder.length || toIdx >= chartOrder.length || fromIdx === toIdx) return;
    const next = [...chartOrder];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    if (onChartOrderChange) onChartOrderChange(next);
  }

  // ── Filtered log ──
  const filtered = useMemo(() => {
    const co = cutoffDate(range);
    if (!co) return log;
    return log.filter(e => {
      if (!e.dateKey) return false;
      return new Date(e.dateKey + "T12:00:00") >= co;
    });
  }, [log, range]);

  // ── Distinct weeks in filtered range (for per-week averages) ──
  const distinctWeeks = useMemo(() => {
    const wks = new Set();
    filtered.forEach(e => { if (e.dateKey) wks.add(weekKey(e.dateKey)); });
    return Math.max(1, wks.size);
  }, [filtered]);

  // ══════════════════════════════════════════════
  // CHART: Best Training Days (day-of-week bar)
  // ══════════════════════════════════════════════
  const dowData = useMemo(() => {
    const buckets = DOW_LABELS.map((label, i) => ({
      day: label, dow: i, sessions: 0, duration: 0, totalCal: 0, activeCal: 0, _dates: new Set()
    }));
    const seen = new Set();
    filtered.forEach(e => {
      if (!e.dateKey) return;
      const d = new Date(e.dateKey + "T12:00:00");
      const dow = d.getDay();
      const gid = e.sourceGroupId;
      if (gid) {
        const key = e.dateKey + "|" + gid;
        if (seen.has(key)) return;
        seen.add(key);
      }
      // Use retroactive stats lookup for all entries (grouped first-seen and solo)
      const stats = getEntryStats(e);
      buckets[dow].duration += stats.durationSec;
      buckets[dow].totalCal += stats.totalCal;
      buckets[dow].activeCal += stats.activeCal;
      buckets[dow].sessions++;
      buckets[dow]._dates.add(e.dateKey);
    });
    buckets.forEach(b => { b.duration = Math.round(b.duration / 60); });
    return buckets;
  }, [filtered, workouts, plans]);

  const bestDow = useMemo(() => {
    let best = dowData[0];
    dowData.forEach(b => { if (b[heatMetric] > best[heatMetric]) best = b; });
    return best;
  }, [dowData, heatMetric]);

  const dowMax = useMemo(() => Math.max(1, ...dowData.map(b => b[heatMetric])), [dowData, heatMetric]);

  // ══════════════════════════════════════════════
  // CHART: Sets Over Time (avg sets per session per week)
  // ══════════════════════════════════════════════
  const setsData = useMemo(() => {
    // Build sessions: solo exercise = own session, grouped entries = one session per sourceGroupId+dateKey
    const sessionMap = {}; // sessionKey -> { week, totalSets }
    let soloIdx = 0;
    filtered.forEach(e => {
      if (!e.dateKey) return;
      const gid = e.sourceGroupId;
      const sessionKey = gid ? (e.dateKey + "|" + gid) : (e.dateKey + "|solo|" + (e.exId || "") + "|" + (e.time || String(soloIdx++)));
      if (!sessionMap[sessionKey]) sessionMap[sessionKey] = { week: weekKey(e.dateKey), totalSets: 0 };
      sessionMap[sessionKey].totalSets += Number(e.sets) || 1;
    });
    // Group sessions by week
    const weeks = {};
    Object.values(sessionMap).forEach(s => {
      if (!weeks[s.week]) weeks[s.week] = { week: s.week, totalSets: 0, sessionCount: 0 };
      weeks[s.week].totalSets += s.totalSets;
      weeks[s.week].sessionCount++;
    });
    return Object.values(weeks)
      .sort((a, b) => a.week.localeCompare(b.week))
      .map(w => ({
        ...w,
        label: weekLabel(w.week),
        avgSets: Math.round(w.totalSets / w.sessionCount * 10) / 10,
      }));
  }, [filtered]);

  // ══════════════════════════════════════════════
  // CHART: Muscle Group Frequency (avg per week)
  // ══════════════════════════════════════════════
  const muscleFreqData = useMemo(() => {
    // Count distinct weeks each muscle group appears in
    const mgWeeks = {}; // muscleGroup -> Set of weekKeys
    filtered.forEach(e => {
      if (!e.dateKey) return;
      const ex = allExById[e.exId];
      const mg = ex ? (ex.muscleGroup || "").toLowerCase() : "";
      if (!mg) return;
      const wk = weekKey(e.dateKey);
      if (!mgWeeks[mg]) mgWeeks[mg] = new Set();
      mgWeeks[mg].add(wk);
    });
    return Object.entries(mgWeeks)
      .map(([mg, wks]) => ({
        name: capFirst(mg.replace("_", " ")),
        muscleGroup: mg,
        avgPerWeek: Math.round(wks.size / distinctWeeks * 10) / 10,
        totalWeeks: wks.size,
      }))
      .filter(d => d.avgPerWeek > 0)
      .sort((a, b) => b.avgPerWeek - a.avgPerWeek);
  }, [filtered, allExById, distinctWeeks]);

  const topMuscle = muscleFreqData.length > 0 ? muscleFreqData[0] : null;

  // ══════════════════════════════════════════════
  // CHART: Volume Over Time (per muscle group)
  // ══════════════════════════════════════════════
  const muscleGroupsInLog = useMemo(() => {
    const mgs = new Set();
    log.forEach(e => {
      if (!e.weightLbs) return;
      const ex = allExById[e.exId];
      if (ex && ex.muscleGroup) mgs.add(ex.muscleGroup.toLowerCase());
    });
    return Array.from(mgs).sort().map(mg => ({ id: mg, name: capFirst(mg.replace("_", " ")) }));
  }, [log, allExById]);

  const volOverTimeData = useMemo(() => {
    const weeks = {};
    filtered.forEach(e => {
      if (!e.dateKey || !e.weightLbs) return;
      const ex = allExById[e.exId];
      if (!ex || !ex.muscleGroup) return;
      const mg = ex.muscleGroup.toLowerCase();
      if (volMuscleFilter !== "_all" && mg !== volMuscleFilter) return;
      const wk = weekKey(e.dateKey);
      if (!weeks[wk]) weeks[wk] = { week: wk };
      const vol = (Number(e.sets) || 1) * (Number(e.reps) || 1) * (Number(e.weightLbs) || 0);
      const converted = metric ? Math.round(lbsToKg(vol)) : Math.round(vol);
      if (volMuscleFilter !== "_all") {
        weeks[wk].volume = (weeks[wk].volume || 0) + converted;
      } else {
        weeks[wk][mg] = (weeks[wk][mg] || 0) + converted;
      }
    });
    return Object.values(weeks)
      .sort((a, b) => a.week.localeCompare(b.week))
      .map(w => ({ ...w, label: weekLabel(w.week) }));
  }, [filtered, allExById, volMuscleFilter, metric]);

  // Collect muscle groups present in volOverTimeData for stacked bars
  const volMuscleKeys = useMemo(() => {
    if (volMuscleFilter !== "_all") return ["volume"];
    const keys = new Set();
    volOverTimeData.forEach(w => {
      Object.keys(w).forEach(k => { if (k !== "week" && k !== "label") keys.add(k); });
    });
    return Array.from(keys).sort();
  }, [volOverTimeData, volMuscleFilter]);

  // ══════════════════════════════════════════════
  // CHART: Workout Consistency (Area chart)
  // ══════════════════════════════════════════════
  const consistencyData = useMemo(() => {
    const weeks = {};
    const seen = new Set();
    let soloIdx = 0;
    filtered.forEach(e => {
      if (!e.dateKey) return;
      // Deduplicate grouped entries so a multi-exercise workout counts as one session
      const gid = e.sourceGroupId;
      const sessionKey = gid ? (e.dateKey + "|" + gid) : (e.dateKey + "|solo|" + (e.exId || "") + "|" + (e.time || String(soloIdx++)));
      if (seen.has(sessionKey)) return;
      seen.add(sessionKey);
      const wk = weekKey(e.dateKey);
      if (!weeks[wk]) weeks[wk] = { week: wk, sessions: 0 };
      weeks[wk].sessions++;
    });
    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week))
      .map(w => ({ ...w, label: weekLabel(w.week) }));
  }, [filtered]);

  // ══════════════════════════════════════════════
  // CHART: Top Exercises
  // ══════════════════════════════════════════════
  const topExData = useMemo(() => {
    const counts = {};
    filtered.forEach(e => {
      if (!counts[e.exId]) counts[e.exId] = { exId: e.exId, count: 0, xp: 0 };
      counts[e.exId].count++;
      counts[e.exId].xp += Number(e.xp) || 0;
    });
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(c => {
        const ex = allExById[c.exId] || {};
        return { name: ex.name || c.exId, icon: ex.icon || "💪", count: c.count, xp: c.xp, cat: ex.category || "strength" };
      });
  }, [filtered, allExById]);

  // ── Empty state ──
  if (!log.length) {
    return (
      <div style={{ ...CARD_STYLE, textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: "2rem", marginBottom: 10 }}>📊</div>
        <div style={{ fontSize: ".78rem", color: "#8a8478", fontWeight: 600 }}>No workout data yet</div>
        <div style={{ fontSize: ".62rem", color: "#5a5650", marginTop: 6 }}>
          Log some exercises to see your trends and analytics here.
        </div>
      </div>
    );
  }

  // ── Helpers ──
  function metricLabel(m) {
    switch (m) {
      case "sessions": return "sessions";
      case "duration": return "min";
      case "totalCal": return "cal";
      case "activeCal": return "active cal";
      default: return "";
    }
  }

  function DarkTooltip({ active, payload, label, suffix }) {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color || "#d4cec4" }}>
            {(p.name || "") + ": " + (typeof p.value === "number" ? p.value.toLocaleString() : p.value) + (suffix ? " " + suffix : "")}
          </div>
        ))}
      </div>
    );
  }

  // ── Card wrapper with reorder controls ──
  function ChartCard({ title, icon, idx, children }) {
    const isFirst = idx === 0;
    const isLast = idx === chartOrder.length - 1;
    const isDragging = dragIdx === idx;
    return (
      <div
        style={{ ...CARD_STYLE, opacity: isDragging ? 0.5 : 1, transition: "opacity .2s" }}
        draggable
        onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; setDragIdx(idx); }}
        onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; }}
        onDrop={(ev) => { ev.preventDefault(); if (dragIdx !== null) moveChart(dragIdx, idx); setDragIdx(null); }}
        onDragEnd={() => setDragIdx(null)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={CARD_TITLE}>{icon} {title}</div>
          <div className="trends-reorder-controls">
            <button
              className="trends-reorder-btn"
              disabled={isFirst}
              onClick={() => moveChart(idx, idx - 1)}
              title="Move up"
              aria-label={`Move ${title} up`}
            >↑</button>
            <button
              className="trends-reorder-btn"
              disabled={isLast}
              onClick={() => moveChart(idx, idx + 1)}
              title="Move down"
              aria-label={`Move ${title} down`}
            >↓</button>
            <span className="trends-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
          </div>
        </div>
        {children}
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // CHART RENDERERS (keyed by chart order ID)
  // ══════════════════════════════════════════════

  function renderDow(idx) {
    return (
      <ChartCard key="dow" title="Best Training Days" icon="⚔️" idx={idx}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {HEATMAP_METRICS.map(([val, label]) => (
            <button
              key={val}
              className={"log-subtab-btn" + (heatMetric === val ? " on" : "")}
              style={{ fontSize: ".52rem", padding: "4px 10px" }}
              onClick={() => setHeatMetric(val)}
            >{label}</button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dowData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(180,172,158,.06)" />
            <XAxis dataKey="day" tick={{ fill: "#8a8478", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#5a5650", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<DarkTooltip suffix={metricLabel(heatMetric)} />} />
            <Bar dataKey={heatMetric} radius={[4, 4, 0, 0]}>
              {dowData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.dow === bestDow.dow && bestDow[heatMetric] > 0 ? "#f0d060" : "#c49428"}
                  fillOpacity={Math.max(0.3, entry[heatMetric] / dowMax)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {bestDow[heatMetric] > 0 && (
          <div style={INSIGHT_STYLE}>
            Your strongest day is <strong style={{ color: "#f0d060" }}>{bestDow.day}</strong> with{" "}
            {bestDow[heatMetric].toLocaleString()} {metricLabel(heatMetric)}
          </div>
        )}
      </ChartCard>
    );
  }

  function renderSets(idx) {
    return (
      <ChartCard key="sets" title="Sets Over Time" icon="🏋️" idx={idx}>
        {setsData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={setsData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(180,172,158,.06)" />
              <XAxis dataKey="label" tick={{ fill: "#8a8478", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#5a5650", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="avgSets" name="Avg Sets/Session" fill="#c49428" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ fontSize: ".62rem", color: "#5a5650", padding: "20px 0", textAlign: "center" }}>
            No session data in this range.
          </div>
        )}
        <div style={INSIGHT_STYLE}>
          Average total sets per session each week — ensure sufficient training stimulus.
        </div>
      </ChartCard>
    );
  }

  function renderMuscleFreq(idx) {
    return (
      <ChartCard key="muscleFreq" title="Muscle Group Frequency" icon="🦾" idx={idx}>
        {muscleFreqData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(160, muscleFreqData.length * 32)}>
            <BarChart data={muscleFreqData} layout="vertical" margin={{ top: 5, right: 15, bottom: 5, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(180,172,158,.06)" />
              <XAxis type="number" tick={{ fill: "#5a5650", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#8a8478", fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="avgPerWeek" name="Avg/Week" radius={[0, 4, 4, 0]}>
                {muscleFreqData.map((entry, i) => (
                  <Cell key={i} fill={MUSCLE_COLORS[entry.muscleGroup] || "#c49428"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ fontSize: ".62rem", color: "#5a5650", padding: "20px 0", textAlign: "center" }}>
            No muscle group data in this range.
          </div>
        )}
        {topMuscle && (
          <div style={INSIGHT_STYLE}>
            <strong style={{ color: MUSCLE_COLORS[topMuscle.muscleGroup] || "#f0d060" }}>{topMuscle.name}</strong>
            {" is your most trained muscle at "}{topMuscle.avgPerWeek}{" times/week"}
          </div>
        )}
      </ChartCard>
    );
  }

  function renderVolume(idx) {
    return (
      <ChartCard key="volume" title="Volume Over Time" icon="📈" idx={idx}>
        <div style={{ marginBottom: 10 }}>
          <select
            className="inp"
            style={{ fontSize: ".6rem", padding: "5px 8px", maxWidth: 220 }}
            value={volMuscleFilter}
            onChange={(ev) => setVolMuscleFilter(ev.target.value)}
            aria-label="Filter volume chart by muscle group"
          >
            <option value="_all">All Muscle Groups</option>
            {muscleGroupsInLog.map(mg => (
              <option key={mg.id} value={mg.id}>{mg.name}</option>
            ))}
          </select>
        </div>
        {volOverTimeData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={volOverTimeData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(180,172,158,.06)" />
              <XAxis dataKey="label" tick={{ fill: "#8a8478", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#5a5650", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {volMuscleKeys.map(mk => (
                <Bar
                  key={mk}
                  dataKey={mk}
                  name={mk === "volume" ? "Volume" : capFirst(mk.replace("_", " "))}
                  stackId={volMuscleFilter === "_all" ? "vol" : undefined}
                  fill={mk === "volume" ? (MUSCLE_COLORS[volMuscleFilter] || clsColor || "#c49428") : (MUSCLE_COLORS[mk] || "#c49428")}
                  radius={volMuscleFilter !== "_all" ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ fontSize: ".62rem", color: "#5a5650", padding: "20px 0", textAlign: "center" }}>
            No weighted exercise data in this range.
          </div>
        )}
        <div style={INSIGHT_STYLE}>
          Total load (sets × reps × weight) per muscle group each week — track hypertrophy stimulus.
        </div>
      </ChartCard>
    );
  }

  function renderConsistency(idx) {
    if (consistencyData.length <= 1) return null;
    return (
      <ChartCard key="consistency" title="Workout Consistency" icon="📅" idx={idx}>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={consistencyData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(180,172,158,.06)" />
            <XAxis dataKey="label" tick={{ fill: "#8a8478", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#5a5650", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area
              type="monotone" dataKey="sessions" name="Sessions"
              stroke={clsColor || "#c49428"} fill={clsColor || "#c49428"}
              fillOpacity={0.15} strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div style={INSIGHT_STYLE}>Sessions logged per week across your selected time range.</div>
      </ChartCard>
    );
  }

  function renderTopEx(idx) {
    if (topExData.length === 0) return null;
    const maxCount = topExData[0].count;
    return (
      <ChartCard key="topEx" title="Most Trained Exercises" icon="🏆" idx={idx}>
        {topExData.map((ex, i) => {
          const catColor = CAT_ICON_COLORS[ex.cat] || "#c49428";
          return (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                borderBottom: i < topExData.length - 1 ? "1px solid rgba(180,172,158,.04)" : "none",
              }}
            >
              <span style={{ fontSize: ".7rem", color: "#5a5650", width: 18, textAlign: "right", flexShrink: 0, fontWeight: 600 }}>{i + 1}</span>
              <span style={{ fontSize: ".85rem", flexShrink: 0 }}>{ex.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: ".65rem", color: "#d4cec4", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ex.name}
                </div>
                <div style={{ marginTop: 3, height: 4, borderRadius: 2, background: "rgba(45,42,36,.3)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, width: (ex.count / maxCount * 100) + "%", background: catColor, transition: "width .3s" }} />
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: ".62rem", color: "#b4ac9e", fontWeight: 700 }}>{ex.count + "×"}</div>
                <div style={{ fontSize: ".48rem", color: "#5a5650" }}>{"+" + ex.xp + " XP"}</div>
              </div>
            </div>
          );
        })}
      </ChartCard>
    );
  }

  const CHART_RENDERERS = { dow: renderDow, sets: renderSets, muscleFreq: renderMuscleFreq, volume: renderVolume, consistency: renderConsistency, topEx: renderTopEx };

  // ── Render ──
  return (
    <>
      {/* ── Time Range Filter ── */}
      <div className="trends-range-bar">
        {RANGE_OPTIONS.map(([val, label]) => (
          <button
            key={val}
            className={"log-subtab-btn" + (range === val ? " on" : "")}
            onClick={() => setRange(val)}
          >{label}</button>
        ))}
      </div>
      {/* ── Charts in user-defined order ── */}
      {chartOrder.map((key, idx) => {
        const render = CHART_RENDERERS[key];
        return render ? render(idx) : null;
      })}
    </>
  );
}

export { TrendsTab, DEFAULT_CHART_ORDER };
