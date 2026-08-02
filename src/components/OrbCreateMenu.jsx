import React from "react";
import { createPortal } from "react-dom";
import { ExIcon } from "./ExIcon";
import { MUSCLE_META } from "../data/constants";
import { getMuscleColor } from "../utils/xp";
import { FG } from "../utils/tokens";

// ─── Orb Create menu ───────────────────────────────────────────────────────────
// The fan that opens from the bottom-nav orb: Quick Log / Build Workout /
// Log Full Workout / Repeat Last. A light popover, not a modal —
// useModalLifecycle would inert #root and freeze the orb button itself, so
// Escape + scrim handle dismissal (same pattern as StagingTray). The scrim
// stops above the nav so the orb stays visible and tappable as its own ✕.
//
// Misfire-proofing: rows ignore pointers until the entrance animation has
// settled (~armed), so a mid-fan tap can't land on Repeat Last.
//
// "Quick Log" and "Log Full Workout" each flip the fan into a self-contained
// mini-picker (recent/saved + name search) — the full library picker and
// the Workouts tab list are builder-owned state and deliberately not
// threaded up here.
const WORKOUT_BLUE = "#3498db"; // matches .log-source-badge.workout elsewhere

const ROW_BASE = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  minHeight: 60,
  padding: "0 14px",
  borderRadius: 17,
  cursor: "pointer",
  textAlign: "left",
  background: FG.solidBg,
  boxShadow: "0 12px 34px rgba(0,0,0,.5)",
};

function recentFromLog(log, allById, limit) {
  const seen = new Set();
  const out = [];
  for (const entry of log || []) {
    const id = entry && entry.exId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ex = allById[id];
    if (ex) out.push(ex);
    if (out.length >= limit) break;
  }
  return out;
}

function OrbCreateMenu({ open, onClose, log, allExercises, onPickExercise, onBuildWorkout, repeatLast, workouts, onPickWorkout, activeTab }) {
  const [view, setView] = React.useState("menu"); // "menu" | "pick" | "workouts"
  const [armed, setArmed] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [workoutQuery, setWorkoutQuery] = React.useState("");
  const searchRef = React.useRef(null);
  const workoutSearchRef = React.useRef(null);
  const firstRowRef = React.useRef(null);
  // Whatever had focus (the orb toggle, for a keyboard/AT user) when the fan
  // opened, so closing — Escape, scrim, a selection — returns focus there
  // instead of stranding it on a removed element.
  const returnFocusRef = React.useRef(null);

  // Reset to a fresh fan whenever the orb closes — done during render (the
  // sanctioned derived-state adjustment) rather than in an effect.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setView("menu");
      setQuery("");
      setWorkoutQuery("");
      setArmed(false);
    }
  }

  React.useEffect(() => {
    if (!open) return undefined;
    const arm = setTimeout(() => setArmed(true), 320);
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(arm);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  React.useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement;
    } else if (returnFocusRef.current && document.body.contains(returnFocusRef.current)) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    if (view === "pick") searchRef.current?.focus();
    else if (view === "workouts") workoutSearchRef.current?.focus();
    else firstRowRef.current?.focus();
  }, [view, open]);

  // The scrim doesn't cover the bottom nav (it stops above it so the orb
  // itself stays tappable as its own ✕), so tapping another tab while the
  // fan is open is reachable without dismissing it first — close whenever
  // the active tab changes underneath.
  const activeTabRef = React.useRef(activeTab);
  React.useEffect(() => {
    if (open && activeTabRef.current !== activeTab) onClose();
    activeTabRef.current = activeTab;
  }, [activeTab, open, onClose]);

  const allById = React.useMemo(() => {
    const m = {};
    for (const ex of allExercises || []) m[ex.id] = ex;
    return m;
  }, [allExercises]);

  const pickList = React.useMemo(() => {
    if (view !== "pick") return [];
    const q = query.trim().toLowerCase();
    if (!q) return recentFromLog(log, allById, 8);
    return (allExercises || []).filter(ex => ex.name.toLowerCase().includes(q)).slice(0, 20);
  }, [view, query, log, allById, allExercises]);

  const workoutPickList = React.useMemo(() => {
    if (view !== "workouts") return [];
    const q = workoutQuery.trim().toLowerCase();
    const list = workouts || [];
    return q ? list.filter(wo => wo.name.toLowerCase().includes(q)) : list;
  }, [view, workoutQuery, workouts]);

  if (!open) return null;

  const actions = [
    {
      key: "quicklog",
      label: "Quick Log",
      sub: "Straight into the Set Forge for one exercise",
      glyph: "⚡",
      color: FG.goldSoft,
      border: "rgba(232,180,74,.42)",
      orb: "rgba(232,180,74,.24)",
      run: () => setView("pick"),
    },
    {
      key: "build",
      label: "Build Workout",
      sub: "Empty builder — name it later",
      glyph: "⚒",
      color: FG.tealSoft,
      border: "rgba(143,227,210,.38)",
      orb: "rgba(143,227,210,.22)",
      run: onBuildWorkout,
    },
    {
      key: "workout",
      label: "Log Full Workout",
      sub: (workouts || []).length > 0 ? `Start one of ${workouts.length} saved workouts` : "No saved workouts yet",
      glyph: "📋",
      color: WORKOUT_BLUE,
      border: "rgba(52,152,219,.4)",
      orb: "rgba(52,152,219,.22)",
      run: () => setView("workouts"),
      disabled: (workouts || []).length === 0,
    },
    {
      key: "repeat",
      label: "Repeat Last",
      sub: repeatLast ? repeatLast.sub : "No finished sessions yet",
      glyph: "↺",
      color: "rgba(240,235,226,.9)",
      border: "rgba(255,255,255,.16)",
      orb: "rgba(255,255,255,.1)",
      run: repeatLast ? repeatLast.run : null,
      disabled: !repeatLast,
    },
  ];

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: 0,
          bottom: "var(--bottom-nav-h)",
          zIndex: 800,
          background: "radial-gradient(70% 45% at 50% 96%,rgba(7,7,10,.55),rgba(7,7,10,.85))",
          animation: "orbFade var(--dur-base) ease both",
        }}
      />
      <div
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: 480,
          padding: "0 16px",
          bottom: "calc(var(--bottom-nav-h) + 30px)",
          zIndex: 801,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: armed ? "auto" : "none",
        }}
      >
        <div
          style={{
            fontFamily: FG.fontSerif,
            fontSize: ".52rem",
            letterSpacing: ".3em",
            textTransform: "uppercase",
            color: "rgba(232,180,74,.8)",
            margin: "0 2px 2px",
            animation: "orbRise var(--dur-slow) var(--ease-out) both",
          }}
        >
          {view === "pick" ? "Quick Log" : view === "workouts" ? "Log Full Workout" : "Create"}
        </div>

        {view === "menu" &&
          actions.map((a, i) => (
            <button
              key={a.key}
              ref={i === 0 ? firstRowRef : undefined}
              type="button"
              disabled={a.disabled}
              aria-disabled={a.disabled}
              onClick={a.disabled ? undefined : () => a.run && a.run()}
              className={"orb-action"}
              style={{
                ...ROW_BASE,
                border: `1px solid ${a.border}`,
                opacity: a.disabled ? 0.45 : 1,
                cursor: a.disabled ? "default" : "pointer",
                animation: "orbRise .4s var(--ease-out) both",
                animationDelay: `${i * 55}ms`,
              }}
            >
              <span
                style={{
                  flex: "none",
                  width: 42,
                  height: 42,
                  borderRadius: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.1rem",
                  background: a.orb,
                }}
              >
                {a.glyph}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontFamily: FG.fontCond,
                    fontSize: ".92rem",
                    fontWeight: 600,
                    letterSpacing: ".07em",
                    textTransform: "uppercase",
                    color: a.color,
                    lineHeight: 1.05,
                  }}
                >
                  {a.label}
                </span>
                <span style={{ display: "block", fontSize: ".64rem", color: "rgba(232,226,216,.76)", marginTop: 3 }}>{a.sub}</span>
              </span>
              <span style={{ flex: "none", fontFamily: FG.fontCond, fontSize: ".9rem", color: a.color, opacity: 0.6 }}>→</span>
            </button>
          ))}

        {view === "pick" && (
          <div
            style={{
              borderRadius: 17,
              border: `1px solid ${FG.glassBorder}`,
              background: FG.solidBg,
              boxShadow: "0 12px 34px rgba(0,0,0,.5)",
              padding: 10,
              animation: "orbRise .3s var(--ease-out) both",
            }}
          >
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={"Search exercises…"}
              className={"inp"}
              style={{ marginBottom: 8 }}
            />
            {!query && pickList.length > 0 && (
              <div
                style={{
                  fontFamily: FG.fontCond,
                  fontSize: ".56rem",
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "rgba(232,226,216,.5)",
                  margin: "0 2px 6px",
                }}
              >
                Recent
              </div>
            )}
            <div style={{ maxHeight: 264, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {pickList.length === 0 && (
                <div style={{ padding: "14px 6px", textAlign: "center", fontSize: ".7rem", color: "rgba(232,226,216,.5)", fontStyle: "italic" }}>
                  {query ? "No exercises match" : "Log something once and it will appear here — or search."}
                </div>
              )}
              {pickList.map(ex => {
                const mg = (ex.muscleGroup || "").toLowerCase();
                const mgColor = getMuscleColor(mg);
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => onPickExercise(ex.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: `1px solid ${FG.glassBorderMid}`,
                      borderLeft: `3px solid ${mgColor}`,
                      background: FG.glassBgSoft,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <ExIcon ex={ex} size={"1.05rem"} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: ".74rem", fontWeight: 600, color: FG.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ex.name}
                      </span>
                      <span style={{ display: "block", fontSize: ".56rem", letterSpacing: ".08em", textTransform: "uppercase", color: mgColor, marginTop: 1 }}>
                        {(MUSCLE_META[mg] && MUSCLE_META[mg].label) || ex.muscleGroup}
                      </span>
                    </span>
                    <span style={{ flex: "none", fontFamily: FG.fontCond, fontSize: ".8rem", color: FG.tealSoft, opacity: 0.7 }}>→</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setView("menu")}
              className={"btn btn-ghost btn-sm"}
              style={{ width: "100%", marginTop: 8 }}
            >
              {"← Back"}
            </button>
          </div>
        )}

        {view === "workouts" && (
          <div
            style={{
              borderRadius: 17,
              border: `1px solid ${FG.glassBorder}`,
              background: FG.solidBg,
              boxShadow: "0 12px 34px rgba(0,0,0,.5)",
              padding: 10,
              animation: "orbRise .3s var(--ease-out) both",
            }}
          >
            <input
              ref={workoutSearchRef}
              value={workoutQuery}
              onChange={e => setWorkoutQuery(e.target.value)}
              placeholder={"Search saved workouts…"}
              className={"inp"}
              style={{ marginBottom: 8 }}
            />
            <div style={{ maxHeight: 264, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {workoutPickList.length === 0 && (
                <div style={{ padding: "14px 6px", textAlign: "center", fontSize: ".7rem", color: "rgba(232,226,216,.5)", fontStyle: "italic" }}>
                  {workoutQuery ? "No workouts match" : "No saved workouts yet"}
                </div>
              )}
              {workoutPickList.map(wo => (
                <button
                  key={wo.id}
                  type="button"
                  onClick={() => onPickWorkout(wo)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: `1px solid ${FG.glassBorderMid}`,
                    borderLeft: `3px solid ${WORKOUT_BLUE}`,
                    background: FG.glassBgSoft,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ flex: "none", fontSize: "1.05rem" }}>{wo.icon || "📋"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: ".74rem", fontWeight: 600, color: FG.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {wo.name}
                    </span>
                    <span style={{ display: "block", fontSize: ".56rem", letterSpacing: ".08em", textTransform: "uppercase", color: WORKOUT_BLUE, marginTop: 1 }}>
                      {`${(wo.exercises || []).length} exercise${(wo.exercises || []).length !== 1 ? "s" : ""}`}
                    </span>
                  </span>
                  <span style={{ flex: "none", fontFamily: FG.fontCond, fontSize: ".8rem", color: FG.tealSoft, opacity: 0.7 }}>→</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setView("menu")}
              className={"btn btn-ghost btn-sm"}
              style={{ width: "100%", marginTop: 8 }}
            >
              {"← Back"}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

export default React.memo(OrbCreateMenu);
