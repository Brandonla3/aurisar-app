import React from "react";
import TabIcon from "./TabIcons";

// ─── Bottom tab bar ────────────────────────────────────────────────────────────
// Extracted from App.jsx as part of the Forge Glass redesign. The World tab
// moved to the ☰ menu; the gold Create orb docks between the two tab pairs.
// All navigation behavior (guardAll, per-tab side effects) stays in App via
// onSelectTab so the extraction cannot change routing semantics.

const LEFT_TABS = [["workout", "Exercises"], ["workouts", "Workouts"]];
const RIGHT_TABS = [["calendar", "Calendar"], ["social", "Guild"]];

function BottomNav({ activeTab, onSelectTab, socialBadge, hidden, orbOpen, onOrbToggle }) {
  const renderTab = ([t, l]) => {
    const isOn = activeTab === t;
    return (
      <button key={t} className={`tab ${isOn ? "on" : ""}`} onClick={() => onSelectTab(t)}>
        <span className={"tab-icon"}><TabIcon name={t} size={22} /></span>
        <span className={"tab-label"}>{l}</span>
        {t === "social" && socialBadge > 0 && <span className={"tab-badge"}>{socialBadge}</span>}
      </button>
    );
  };
  return (
    <div className={"hud-nav-panel"} style={hidden ? { display: "none" } : undefined}>
      <div className={"tabs"}>
        {LEFT_TABS.map(renderTab)}
        <div className={"orb-slot"}>
          <button
            type="button"
            className={`orb-btn ${orbOpen ? "open" : ""}`}
            aria-label={orbOpen ? "Close create menu" : "Create: quick log, build workout, log full workout, repeat last"}
            aria-expanded={orbOpen}
            onClick={onOrbToggle}
          >
            {orbOpen ? "✕" : "Log"}
          </button>
        </div>
        {RIGHT_TABS.map(renderTab)}
      </div>
    </div>
  );
}

export default React.memo(BottomNav);
