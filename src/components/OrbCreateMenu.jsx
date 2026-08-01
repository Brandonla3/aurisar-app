import React from "react";
import { createPortal } from "react-dom";
import { ExIcon } from "./ExIcon";
import { MUSCLE_META } from "../data/constants";
import { getMuscleColor } from "../utils/xp";
import { FG } from "../utils/tokens";

// ─── Orb Create menu ───────────────────────────────────────────────────────────
// The fan that opens from the bottom-nav orb: Quick Log / Build Workout /
// Repeat Last. A light popover, not a modal — useModalLifecycle would inert
// #root and freeze the orb button itself, so Escape + scrim handle dismissal
// (same pattern as StagingTray). The scrim stops above the nav so the orb
// stays visible and tappable as its own ✕.
//
// Misfire-proofing: rows ignore pointers until the entrance animation has
// settled (~armed), so a mid-fan tap can't land on Repeat Last.
//
// "Quick Log" flips the fan into a self-contained mini-picker (recent
// exercises + name search) — the full library picker is builder-owned state
// and deliberately not threaded up here.

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

function OrbCreateMenu({ open, onClose, log, allExercises, onPickExercise, onBuildWorkout, repeatLast }) {
  const [view, setView] = React.useState("menu"); // "menu" | "pick"
  const [armed, setArmed] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) {
      setView("menu");
      setQuery("");
      setArmed(false);
      return undefined;
    }
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
    if (view === "pick" && searchRef.current) searchRef.current.focus();
  }, [view]);

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
          {view === "pick" ? "Quick Log" : "Create"}
        </div>

        {view === "menu" &&
          actions.map((a, i) => (
            <button
              key={a.key}
              type="button"
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
      </div>
    </>,
    document.body
  );
}

export default React.memo(OrbCreateMenu);
