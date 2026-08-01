import React from "react";
import { createPortal } from "react-dom";
import { todayStr } from "../utils/helpers";
import { calcWorkoutXP } from "../utils/xp";
import { formatXP } from "../utils/format";
import { FG } from "../utils/tokens";

// ─── Start dock ────────────────────────────────────────────────────────────────
// Idle-only quick start for today's schedule, reachable from any tab. Pure
// derivation over profile.scheduledWorkouts — the dock owns no session state.
// It yields the band above the nav to busier tenants: renders null while a
// live session runs (LiveWorkoutBanner owns live), while the staging tray has
// items (tray docks in the same band), or when nothing is scheduled today.
// Sheets/modals sit at z ≥ 780 with full scrims, so they cover it naturally.
//
// Minimize (user-requested): collapses to a small chip docked bottom-right;
// persisted per device in localStorage.

const MIN_KEY = "aurisar.startdock.min";

function readMin() {
  try {
    return localStorage.getItem(MIN_KEY) === "1";
  } catch {
    return false;
  }
}

function StartDock({ profile, allExById, liveWorkout, stagedCount, onStartWorkout, onQuickLogSolo, onSeeAll }) {
  const [minimized, setMinimized] = React.useState(readMin);
  const toggleMin = () =>
    setMinimized(m => {
      try {
        localStorage.setItem(MIN_KEY, m ? "0" : "1");
      } catch {
        /* session-only */
      }
      return !m;
    });

  const today = todayStr();
  const { primary, extraCount } = React.useMemo(() => {
    const sws = (profile.scheduledWorkouts || []).filter(sw => sw.scheduledDate === today);
    const grouped = {};
    const solos = [];
    for (const sw of sws) {
      if (sw.sourceWorkoutId) {
        if (!grouped[sw.sourceWorkoutId]) {
          grouped[sw.sourceWorkoutId] = { id: sw.sourceWorkoutId, name: sw.sourceWorkoutName, icon: sw.sourceWorkoutIcon || "⚡", items: [] };
        }
        grouped[sw.sourceWorkoutId].items.push(sw);
      } else if (sw.exId) {
        solos.push(sw);
      }
    }
    const groups = Object.values(grouped);
    const total = groups.length + solos.length;
    if (groups.length > 0) {
      const g = groups[0];
      // Same resolution WorkoutsTab uses: a saved workout wins, else a one-off
      // shell reconstructed from the schedule entries.
      const wo = (profile.workouts || []).find(w => w.id === g.id) || {
        id: g.id,
        name: g.name,
        icon: g.icon,
        desc: "",
        exercises: g.items.map(sw => ({ exId: sw.exId, sets: 3, reps: 10, weightLbs: null, weightPct: 100, distanceMi: null, hrZone: null })),
        oneOff: true,
        durationMin: null,
        activeCal: null,
        totalCal: null,
      };
      const xp = calcWorkoutXP(wo, profile.chosenClass, allExById);
      return {
        primary: {
          kind: "workout",
          icon: g.icon,
          title: g.name,
          sub: `${wo.exercises.length} exercise${wo.exercises.length !== 1 ? "s" : ""} · ${formatXP(xp, { prefix: "⚡ " })}`,
          btnLabel: "Start",
          run: () => onStartWorkout(wo),
        },
        extraCount: total - 1,
      };
    }
    if (solos.length > 0) {
      const sw = solos[0];
      const ex = allExById[sw.exId];
      if (ex) {
        return {
          primary: {
            kind: "solo",
            icon: ex.icon || "💪",
            title: ex.name,
            sub: "Solo exercise · logs with your defaults",
            btnLabel: "⚡ Quick Log",
            run: () => onQuickLogSolo(sw),
          },
          extraCount: total - 1,
        };
      }
    }
    return { primary: null, extraCount: 0 };
  }, [profile.scheduledWorkouts, profile.workouts, profile.chosenClass, allExById, today, onStartWorkout, onQuickLogSolo]);

  if (liveWorkout || stagedCount > 0 || !primary) return null;

  if (minimized) {
    return createPortal(
      <button
        type="button"
        onClick={toggleMin}
        aria-label={`Expand start dock — ${primary.title} scheduled today`}
        style={{
          position: "fixed",
          right: 12,
          bottom: "calc(var(--bottom-nav-h) + 10px)",
          zIndex: 700,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid rgba(232,180,74,.5)",
          background: FG.solidBg,
          boxShadow: "0 8px 22px rgba(0,0,0,.45), 0 0 12px rgba(232,180,74,.18)",
          color: FG.goldSoft,
          fontSize: "1rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {"⚡"}
      </button>,
      document.body
    );
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 24px)",
        maxWidth: 496,
        bottom: "calc(var(--bottom-nav-h) + 8px)",
        zIndex: 700,
        borderRadius: 19,
        overflow: "hidden",
        border: "1px solid rgba(232,180,74,.28)",
        background: "rgba(14,14,18,.85)",
        backdropFilter: "blur(26px) saturate(170%)",
        WebkitBackdropFilter: "blur(26px) saturate(170%)",
        boxShadow: "0 14px 40px rgba(0,0,0,.55)",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg,rgba(232,180,74,.1),transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, padding: "10px 10px 10px 12px" }}>
        <div
          style={{
            width: 40,
            height: 40,
            flex: "none",
            borderRadius: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.15rem",
            background: "radial-gradient(circle at 34% 30%,rgba(232,180,74,.3),rgba(232,180,74,.08))",
            border: "1px solid rgba(232,180,74,.25)",
          }}
        >
          {primary.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FG.fontSerif, fontSize: ".44rem", letterSpacing: ".26em", textTransform: "uppercase", color: "rgba(232,180,74,.85)", marginBottom: 2 }}>
            {"Today · Scheduled"}
          </div>
          <div
            style={{
              fontFamily: FG.fontCond,
              fontSize: ".88rem",
              fontWeight: 600,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              color: FG.inkTitle,
              lineHeight: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {primary.title}
          </div>
          <div style={{ fontSize: ".6rem", color: "rgba(228,222,211,.55)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{primary.sub}</span>
            {extraCount > 0 && (
              <button
                type="button"
                onClick={onSeeAll}
                style={{
                  flex: "none",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: FG.fontCond,
                  fontSize: ".58rem",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: FG.tealSoft,
                }}
              >
                {`+${extraCount} more →`}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={primary.run}
          style={{
            flex: "none",
            padding: "0 16px",
            height: 40,
            borderRadius: 13,
            cursor: "pointer",
            border: "1px solid rgba(232,180,74,.5)",
            background: "linear-gradient(160deg,rgba(232,180,74,.36),rgba(232,180,74,.13))",
            color: "#FAE6B8",
            fontFamily: FG.fontCond,
            fontSize: ".72rem",
            fontWeight: 600,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {primary.btnLabel}
        </button>
        <button
          type="button"
          onClick={toggleMin}
          aria-label={"Minimize start dock"}
          style={{
            flex: "none",
            width: 28,
            height: 40,
            borderRadius: 10,
            cursor: "pointer",
            border: "1px solid rgba(255,255,255,.1)",
            background: "rgba(255,255,255,.04)",
            color: "rgba(228,222,211,.6)",
            fontSize: ".8rem",
            lineHeight: 1,
          }}
        >
          {"–"}
        </button>
      </div>
    </div>,
    document.body
  );
}

export default React.memo(StartDock);
