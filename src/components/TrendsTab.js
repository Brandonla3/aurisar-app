import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid
} from 'recharts';
import { CAT_ICON_COLORS } from '../data/constants';
import { isMetric, lbsToKg } from '../utils/units';

const h = React.createElement;

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
  marginBottom: 12,
  fontFamily: "'Cinzel', serif",
  letterSpacing: ".03em",
};

const INSIGHT_STYLE = {
  fontSize: ".62rem",
  color: "#8a8478",
  fontStyle: "italic",
  marginTop: 8,
  lineHeight: 1.5,
};

function TrendsTab({ log, allExById, clsColor, clsGlow, units }) {
  const [range, setRange] = useState("30d");
  const [heatMetric, setHeatMetric] = useState("sessions");
  const [volExFilter, setVolExFilter] = useState("_all");
  const metric = isMetric(units);

  // ── Filtered log ──
  const filtered = useMemo(() => {
    const co = cutoffDate(range);
    if (!co) return log;
    return log.filter(e => {
      if (!e.dateKey) return false;
      return new Date(e.dateKey + "T12:00:00") >= co;
    });
  }, [log, range]);

  // ══════════════════════════════════════════════
  // CHART 1: Best Training Days (day-of-week bar)
  // ══════════════════════════════════════════════
  const dowData = useMemo(() => {
    const buckets = DOW_LABELS.map((label, i) => ({
      day: label, dow: i, sessions: 0, duration: 0, totalCal: 0, activeCal: 0, _dates: new Set()
    }));
    // Deduplicate workouts by sourceGroupId
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
        buckets[dow].duration += Number(e.sourceDurationSec) || 0;
        buckets[dow].totalCal += Number(e.sourceTotalCal) || 0;
        buckets[dow].activeCal += Number(e.sourceActiveCal) || 0;
      }
      buckets[dow].sessions++;
      buckets[dow]._dates.add(e.dateKey);
    });
    // Convert duration from seconds to minutes
    buckets.forEach(b => { b.duration = Math.round(b.duration / 60); });
    return buckets;
  }, [filtered]);

  const bestDow = useMemo(() => {
    const m = heatMetric;
    let best = dowData[0];
    dowData.forEach(b => { if (b[m] > best[m]) best = b; });
    return best;
  }, [dowData, heatMetric]);

  const dowMax = useMemo(() => {
    return Math.max(1, ...dowData.map(b => b[heatMetric]));
  }, [dowData, heatMetric]);

  // ══════════════════════════════════════════════
  // CHART 2: Calories & Duration by Workout Type
  // ══════════════════════════════════════════════
  const impactData = useMemo(() => {
    const groups = {};
    const seen = new Set();
    filtered.forEach(e => {
      const gid = e.sourceGroupId;
      if (!gid) return;
      const key = e.dateKey + "|" + gid;
      if (seen.has(key)) return;
      seen.add(key);
      const cat = (allExById[e.exId] || {}).category || "other";
      if (!groups[cat]) groups[cat] = { cat, totalDur: 0, totalCal: 0, activeCal: 0, count: 0 };
      groups[cat].totalDur += Number(e.sourceDurationSec) || 0;
      groups[cat].totalCal += Number(e.sourceTotalCal) || 0;
      groups[cat].activeCal += Number(e.sourceActiveCal) || 0;
      groups[cat].count++;
    });
    return Object.values(groups)
      .filter(g => g.count > 0)
      .map(g => ({
        name: g.cat.charAt(0).toUpperCase() + g.cat.slice(1),
        cat: g.cat,
        avgDuration: Math.round(g.totalDur / g.count / 60),
        avgTotalCal: Math.round(g.totalCal / g.count),
        avgActiveCal: Math.round(g.activeCal / g.count),
      }))
      .sort((a, b) => b.avgTotalCal - a.avgTotalCal);
  }, [filtered, allExById]);

  // ══════════════════════════════════════════════
  // CHART 3: Volume Progression (Strength Trends)
  // ══════════════════════════════════════════════
  const strengthExercises = useMemo(() => {
    const exSet = new Set();
    log.forEach(e => {
      const ex = allExById[e.exId];
      if (ex && ex.category === "strength" && e.weightLbs) exSet.add(e.exId);
    });
    return Array.from(exSet).map(id => ({ id, name: (allExById[id] || {}).name || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [log, allExById]);

  const volumeData = useMemo(() => {
    const weeks = {};
    filtered.forEach(e => {
      if (!e.dateKey || !e.weightLbs) return;
      const ex = allExById[e.exId];
      if (!ex || ex.category !== "strength") return;
      if (volExFilter !== "_all" && e.exId !== volExFilter) return;
      const wk = weekKey(e.dateKey);
      if (!weeks[wk]) weeks[wk] = { week: wk, volume: 0 };
      const vol = (Number(e.sets) || 1) * (Number(e.reps) || 1) * (Number(e.weightLbs) || 0);
      weeks[wk].volume += metric ? Math.round(lbsToKg(vol) * 10) / 10 : Math.round(vol);
    });
    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week))
      .map(w => ({ ...w, label: weekLabel(w.week) }));
  }, [filtered, allExById, volExFilter, metric]);

  // ══════════════════════════════════════════════
  // CHART 4: Workout Consistency (Area chart)
  // ══════════════════════════════════════════════
  const consistencyData = useMemo(() => {
    const weeks = {};
    filtered.forEach(e => {
      if (!e.dateKey) return;
      const wk = weekKey(e.dateKey);
      if (!weeks[wk]) weeks[wk] = { week: wk, sessions: 0 };
      weeks[wk].sessions++;
    });
    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week))
      .map(w => ({ ...w, label: weekLabel(w.week) }));
  }, [filtered]);

  // ══════════════════════════════════════════════
  // CHART 5: Top Exercises
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
        return {
          name: ex.name || c.exId,
          icon: ex.icon || "💪",
          count: c.count,
          xp: c.xp,
          cat: ex.category || "strength",
        };
      });
  }, [filtered, allExById]);

  // ── Empty state ──
  if (!log.length) {
    return h('div', { style: { ...CARD_STYLE, textAlign: "center", padding: "40px 20px" } },
      h('div', { style: { fontSize: "2rem", marginBottom: 10 } }, "📊"),
      h('div', { style: { fontSize: ".78rem", color: "#8a8478", fontWeight: 600 } }, "No workout data yet"),
      h('div', { style: { fontSize: ".62rem", color: "#5a5650", marginTop: 6 } }, "Log some exercises to see your trends and analytics here.")
    );
  }

  // ── Metric label helper ──
  function metricLabel(m) {
    switch (m) {
      case "sessions": return "sessions";
      case "duration": return "min";
      case "totalCal": return "cal";
      case "activeCal": return "active cal";
      default: return "";
    }
  }

  // ── Custom tooltip ──
  function DarkTooltip({ active, payload, label, suffix }) {
    if (!active || !payload || !payload.length) return null;
    return h('div', { style: TOOLTIP_STYLE },
      h('div', { style: { fontWeight: 700, marginBottom: 3 } }, label),
      ...payload.map((p, i) =>
        h('div', { key: i, style: { color: p.color || "#d4cec4" } },
          (p.name || "") + ": " + (typeof p.value === "number" ? p.value.toLocaleString() : p.value) + (suffix ? " " + suffix : "")
        )
      )
    );
  }

  // ── Render ──
  return h(React.Fragment, null,

    // ── Time Range Filter ──
    h('div', { className: "trends-range-bar" },
      ...RANGE_OPTIONS.map(([val, label]) =>
        h('button', {
          key: val,
          className: "log-subtab-btn" + (range === val ? " on" : ""),
          onClick: () => setRange(val),
        }, label)
      )
    ),

    // ═══ CARD 1: Best Training Days ═══
    h('div', { style: CARD_STYLE },
      h('div', { style: CARD_TITLE }, "⚔️ Best Training Days"),
      // Metric toggle
      h('div', { style: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" } },
        ...HEATMAP_METRICS.map(([val, label]) =>
          h('button', {
            key: val,
            className: "log-subtab-btn" + (heatMetric === val ? " on" : ""),
            style: { fontSize: ".52rem", padding: "4px 10px" },
            onClick: () => setHeatMetric(val),
          }, label)
        )
      ),
      h(ResponsiveContainer, { width: "100%", height: 200 },
        h(BarChart, { data: dowData, margin: { top: 5, right: 5, bottom: 5, left: -10 } },
          h(CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(180,172,158,.06)" }),
          h(XAxis, { dataKey: "day", tick: { fill: "#8a8478", fontSize: 11 }, axisLine: false, tickLine: false }),
          h(YAxis, { tick: { fill: "#5a5650", fontSize: 10 }, axisLine: false, tickLine: false }),
          h(Tooltip, { content: h(DarkTooltip, { suffix: metricLabel(heatMetric) }) }),
          h(Bar, { dataKey: heatMetric, radius: [4, 4, 0, 0] },
            ...dowData.map((entry, i) =>
              h(Cell, {
                key: i,
                fill: entry.dow === bestDow.dow && bestDow[heatMetric] > 0
                  ? "#f0d060"
                  : "#c49428",
                fillOpacity: Math.max(0.3, entry[heatMetric] / dowMax),
              })
            )
          )
        )
      ),
      bestDow[heatMetric] > 0 && h('div', { style: INSIGHT_STYLE },
        "Your strongest day is ", h('strong', { style: { color: "#f0d060" } }, bestDow.day),
        " with ", bestDow[heatMetric].toLocaleString(), " ", metricLabel(heatMetric)
      )
    ),

    // ═══ CARD 2: Calories & Duration by Type ═══
    impactData.length > 0 && h('div', { style: CARD_STYLE },
      h('div', { style: CARD_TITLE }, "🔥 Impact by Workout Type"),
      h(ResponsiveContainer, { width: "100%", height: 220 },
        h(BarChart, { data: impactData, margin: { top: 5, right: 5, bottom: 5, left: -10 } },
          h(CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(180,172,158,.06)" }),
          h(XAxis, { dataKey: "name", tick: { fill: "#8a8478", fontSize: 11 }, axisLine: false, tickLine: false }),
          h(YAxis, { tick: { fill: "#5a5650", fontSize: 10 }, axisLine: false, tickLine: false }),
          h(Tooltip, { contentStyle: TOOLTIP_STYLE }),
          h(Bar, { dataKey: "avgDuration", name: "Avg Duration (min)", fill: "#3498db", radius: [3, 3, 0, 0] }),
          h(Bar, { dataKey: "avgTotalCal", name: "Avg Total Cal", fill: "#e67e22", radius: [3, 3, 0, 0] }),
          h(Bar, { dataKey: "avgActiveCal", name: "Avg Active Cal", fill: "#2ecc71", radius: [3, 3, 0, 0] }),
        )
      ),
      h('div', { style: INSIGHT_STYLE },
        "Comparing average duration, total calories, and active calories across workout categories."
      )
    ),

    // ═══ CARD 3: Strength/Volume Trends ═══
    h('div', { style: CARD_STYLE },
      h('div', { style: CARD_TITLE }, "💪 Strength Trends"),
      // Exercise filter
      h('div', { style: { marginBottom: 10 } },
        h('select', {
          className: "inp",
          style: { fontSize: ".6rem", padding: "5px 8px", maxWidth: 220 },
          value: volExFilter,
          onChange: (ev) => setVolExFilter(ev.target.value),
        },
          h('option', { value: "_all" }, "All Strength Exercises"),
          ...strengthExercises.map(ex =>
            h('option', { key: ex.id, value: ex.id }, ex.name)
          )
        )
      ),
      volumeData.length > 0
        ? h(ResponsiveContainer, { width: "100%", height: 200 },
            h(LineChart, { data: volumeData, margin: { top: 5, right: 5, bottom: 5, left: -10 } },
              h(CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(180,172,158,.06)" }),
              h(XAxis, { dataKey: "label", tick: { fill: "#8a8478", fontSize: 10 }, axisLine: false, tickLine: false }),
              h(YAxis, { tick: { fill: "#5a5650", fontSize: 10 }, axisLine: false, tickLine: false }),
              h(Tooltip, { contentStyle: TOOLTIP_STYLE }),
              h(Line, {
                type: "monotone",
                dataKey: "volume",
                name: "Volume (" + (metric ? "kg" : "lbs") + ")",
                stroke: clsColor || "#c49428",
                strokeWidth: 2,
                dot: { r: 3, fill: clsColor || "#c49428" },
                activeDot: { r: 5, fill: clsGlow || "#f0d060" },
              })
            )
          )
        : h('div', { style: { fontSize: ".62rem", color: "#5a5650", padding: "20px 0", textAlign: "center" } },
            "No strength data with weight in this range."
          ),
      h('div', { style: INSIGHT_STYLE },
        "Weekly total volume (sets \u00d7 reps \u00d7 weight) over time."
      )
    ),

    // ═══ CARD 4: Workout Consistency ═══
    consistencyData.length > 1 && h('div', { style: CARD_STYLE },
      h('div', { style: CARD_TITLE }, "📅 Workout Consistency"),
      h(ResponsiveContainer, { width: "100%", height: 180 },
        h(AreaChart, { data: consistencyData, margin: { top: 5, right: 5, bottom: 5, left: -10 } },
          h(CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(180,172,158,.06)" }),
          h(XAxis, { dataKey: "label", tick: { fill: "#8a8478", fontSize: 10 }, axisLine: false, tickLine: false }),
          h(YAxis, { tick: { fill: "#5a5650", fontSize: 10 }, axisLine: false, tickLine: false }),
          h(Tooltip, { contentStyle: TOOLTIP_STYLE }),
          h(Area, {
            type: "monotone",
            dataKey: "sessions",
            name: "Sessions",
            stroke: clsColor || "#c49428",
            fill: clsColor || "#c49428",
            fillOpacity: 0.15,
            strokeWidth: 2,
          })
        )
      ),
      h('div', { style: INSIGHT_STYLE },
        "Sessions logged per week across your selected time range."
      )
    ),

    // ═══ CARD 5: Top Exercises ═══
    topExData.length > 0 && h('div', { style: CARD_STYLE },
      h('div', { style: CARD_TITLE }, "🏆 Most Trained Exercises"),
      ...topExData.map((ex, i) => {
        const maxCount = topExData[0].count;
        const catColor = CAT_ICON_COLORS[ex.cat] || "#c49428";
        return h('div', {
          key: i,
          style: {
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 0",
            borderBottom: i < topExData.length - 1 ? "1px solid rgba(180,172,158,.04)" : "none",
          }
        },
          h('span', { style: { fontSize: ".7rem", color: "#5a5650", width: 18, textAlign: "right", flexShrink: 0, fontWeight: 600 } }, i + 1),
          h('span', { style: { fontSize: ".85rem", flexShrink: 0 } }, ex.icon),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: ".65rem", color: "#d4cec4", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, ex.name),
            h('div', { style: { marginTop: 3, height: 4, borderRadius: 2, background: "rgba(45,42,36,.3)", overflow: "hidden" } },
              h('div', { style: { height: "100%", borderRadius: 2, width: (ex.count / maxCount * 100) + "%", background: catColor, transition: "width .3s" } })
            )
          ),
          h('div', { style: { textAlign: "right", flexShrink: 0 } },
            h('div', { style: { fontSize: ".62rem", color: "#b4ac9e", fontWeight: 700 } }, ex.count + "×"),
            h('div', { style: { fontSize: ".48rem", color: "#5a5650" } }, "+" + ex.xp + " XP")
          )
        );
      })
    ),
  );
}

export { TrendsTab };
