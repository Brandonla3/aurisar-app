import React, { memo } from 'react';
import { xpToLevel } from '../../utils/xp';
import { formatXP } from '../../utils/format';
import { S, R, FS } from '../../utils/tokens';
import { UI_COLORS } from '../../data/constants';
import { CLASSES } from '../../data/exercises';

/**
 * Leaderboard tab — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Renders the world/friends leaderboard with filter chips (state, country)
 * and a stat filter selector. Co-locates LB_FILTERS, TC, MultiDrop helper,
 * and the pure helper functions getRowName / getRowVal / fmtVal.
 */

const LeaderboardTab = memo(function LeaderboardTab({
  // Filter state
  lbFilter, setLbFilter,
  lbScope, setLbScope,
  lbStateFilters, setLbStateFilters,
  lbCountryFilters, setLbCountryFilters,
  lbStateDropOpen, setLbStateDropOpen,
  lbCountryDropOpen, setLbCountryDropOpen,
  // Data (read-only)
  lbData,
  lbWorldRanks,
  lbLoading,
  // Profile
  profile,
  // Auth
  authUser,
}) {
const LB_FILTERS = [{
  id: "overall_xp",
  label: "Overall XP",
  type: "xp",
  icon: "⚔️",
  desc: "Total XP earned all time"
}, {
  id: "weekly_xp",
  label: "Weekly XP",
  type: "xp",
  icon: "📅",
  desc: "XP earned this week (resets Monday)"
}, {
  id: "bench_1rm",
  label: "Bench Press",
  type: "strength",
  icon: "🏋️",
  desc: "Heaviest 1x1 set"
}, {
  id: "squat_1rm",
  label: "Squat",
  type: "strength",
  icon: "🦵",
  desc: "Heaviest 1x1 set"
}, {
  id: "deadlift_1rm",
  label: "Deadlift",
  type: "strength",
  icon: "💀",
  desc: "Heaviest 1x1 set"
}, {
  id: "ohp_1rm",
  label: "Overhead Press",
  type: "strength",
  icon: "🏹",
  desc: "Heaviest 1x1 set"
}, {
  id: "pullup_reps",
  label: "Pull-Ups",
  type: "reps",
  icon: "💪",
  desc: "Most reps in 1 set"
}, {
  id: "pushup_reps",
  label: "Push-Ups",
  type: "reps",
  icon: "🤸",
  desc: "Most reps in 1 set"
}, {
  id: "run_pace",
  label: "Running Pace",
  type: "cardio",
  icon: "🏃",
  desc: "Best min/mi (lower = faster)"
}, {
  id: "streak",
  label: "Streak",
  type: "habit",
  icon: "🔥",
  desc: "Longest consecutive check-in streak"
}];
const TC = {
  xp: "#b4ac9e",
  strength: UI_COLORS.danger,
  reps: "#3498db",
  cardio: UI_COLORS.success,
  habit: "#e67e22",
  class: "#9b59b6"
};
const cls = CLASSES[profile.chosenClass] || CLASSES.warrior;
const af = LB_FILTERS.find(f => f.id === lbFilter) || LB_FILTERS[0];
const tc = TC[af.type] || "#b4ac9e";

// Get the correct display name for a leaderboard row based on name visibility
const getRowName = row => {
  const nv = row.name_visibility || {
    displayName: ["app", "game"],
    realName: ["hide"]
  };
  // Leaderboard = "game" context
  if ((nv.realName || []).includes("game")) {
    const rn = ((row.first_name || "") + " " + (row.last_name || "")).trim();
    if (rn) return rn;
  }
  return row.player_name || "Unknown";
};
const getRowVal = (row, filterId) => {
  if (filterId === "overall_xp") return row.total_xp || 0;
  if (filterId === "streak") return row.streak || 0;
  const pbs = row.exercise_pbs || {};
  if (filterId === "bench_1rm") return (pbs["bench"] || pbs["bench_press"] || {}).weight || 0;
  if (filterId === "squat_1rm") return (pbs["squat"] || pbs["barbell_back_squat"] || {}).weight || 0;
  if (filterId === "deadlift_1rm") return (pbs["deadlift"] || pbs["barbell_deadlift"] || {}).weight || 0;
  if (filterId === "ohp_1rm") return (pbs["overhead_press"] || pbs["ohp"] || {}).weight || 0;
  if (filterId === "pullup_reps") return (pbs["pull_up"] || pbs["pullups"] || {}).reps || 0;
  if (filterId === "pushup_reps") return (pbs["push_up"] || pbs["pushups"] || {}).reps || 0;
  if (filterId === "run_pace") return (pbs["running"] || pbs["treadmill_run"] || pbs["run"] || {}).value || 0;
  return 0;
};
const fmtVal = (id, v) => {
  if (!v) return "---";
  if (id === "overall_xp" || id === "weekly_xp") return formatXP(v);
  if (id.includes("_1rm")) return v + " lbs";
  if (id.includes("_reps")) return v + " reps";
  if (id === "run_pace") return v.toFixed(2) + "/mi";
  if (id === "streak") return v + " days";
  return String(v);
};

// Sort lbData by the active filter
const sorted = (lbData || []).slice().sort((a, b) => {
  const av = getRowVal(a, lbFilter);
  const bv = getRowVal(b, lbFilter);
  if (lbFilter === "run_pace") return (av || 999) - (bv || 999); // lower is better
  return bv - av;
}).filter(r => getRowVal(r, lbFilter) > 0 || lbFilter === "overall_xp");
const myRow = sorted.find(r => r.is_me);
const myRank = myRow ? sorted.indexOf(myRow) + 1 : null;
const myVal = myRow ? getRowVal(myRow, lbFilter) : 0;
const ALL_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];
const ALL_COUNTRIES = ["United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Mexico", "Brazil", "India", "Japan", "South Korea", "Philippines", "Other"];

// Compact filter chip with dark overlay dropdown
const MultiDrop = ({
  label,
  icon,
  open,
  setOpen,
  options,
  selected,
  setSelected,
  allLabel
}) => {
  if (options.length === 0) return null;
  const allSelected = selected.length === options.length;
  const noneSelected = selected.length === 0;
  const chipLabel = allSelected ? allLabel || "All" : noneSelected ? label : selected.length <= 2 ? selected.join(", ") : selected.length + " selected";
  return <div style={{
    position: "relative",
    flex: 1
  }}>
    // Trigger chip
    <div style={{
      background: open ? "rgba(45,42,36,.45)" : "rgba(45,42,36,.2)",
      border: "1px solid " + (open ? "rgba(180,172,158,.12)" : "rgba(180,172,158,.06)"),
      borderRadius: R.lg,
      padding: "8px 10px",
      fontSize: FS.sm,
      fontWeight: 600,
      color: noneSelected ? "#8a8478" : "#b4ac9e",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: S.s6,
      transition: "all .15s",
      userSelect: "none"
    }} onClick={() => {
      setOpen(!open);
      if (!open) {
        setLbStateDropOpen(false);
        setLbCountryDropOpen(false);
        setOpen(true);
      }
    }}><span style={{
        fontSize: FS.md
      }}>{icon || "\uD83D\uDD0D"}</span><span style={{
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}>{chipLabel}</span><span style={{
        fontSize: FS.fs46,
        color: "#8a8478",
        flexShrink: 0
      }}>{open ? "\u25B2" : "\u25BC"}</span></div>{
    // Dropdown overlay
    open && <div style={{
      position: "absolute",
      top: "calc(100% + 4px)",
      left: 0,
      right: 0,
      zIndex: 60,
      background: "#16160f",
      border: "1px solid rgba(180,172,158,.1)",
      borderRadius: R.r10,
      boxShadow: "0 8px 32px rgba(0,0,0,.6)",
      overflow: "hidden"
    }}>
      // Select All / Clear All header
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 10px",
        borderBottom: "1px solid rgba(180,172,158,.06)",
        background: "rgba(45,42,36,.15)"
      }}><span style={{
          fontSize: FS.fs56,
          color: "#b4ac9e",
          cursor: "pointer",
          fontWeight: 600
        }} onClick={() => setSelected([...options])}>{"Select All"}</span><span style={{
          fontSize: FS.fs56,
          color: UI_COLORS.danger,
          cursor: "pointer",
          fontWeight: 600
        }} onClick={() => setSelected([])}>{"Clear All"}</span></div>
      // Scrollable options
      <div style={{
        maxHeight: 200,
        overflowY: "auto",
        padding: "4px 4px",
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(180,172,158,.15) transparent"
      }}>{options.map(opt => {
          const on = selected.includes(opt);
          return <div key={opt} style={{
            display: "flex",
            alignItems: "center",
            gap: S.s8,
            padding: "6px 8px",
            cursor: "pointer",
            borderRadius: R.r5,
            background: on ? "rgba(180,172,158,.07)" : "transparent",
            transition: "background .1s",
            fontSize: FS.fs62,
            color: on ? "#d4cec4" : "#8a8478"
          }} onClick={() => {
            setSelected(on ? selected.filter(s => s !== opt) : [...selected, opt]);
          }}><span style={{
              width: 15,
              height: 15,
              borderRadius: R.r3,
              border: "1.5px solid " + (on ? "#b4ac9e" : "rgba(180,172,158,.12)"),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: FS.fs52,
              color: "#b4ac9e",
              flexShrink: 0,
              background: on ? "rgba(180,172,158,.08)" : "transparent"
            }}>{on ? "\u2713" : ""}</span>{opt}</div>;
        })}</div>
      // Done button
      <div style={{
        padding: "6px 10px",
        borderTop: "1px solid rgba(180,172,158,.06)",
        background: "rgba(45,42,36,.1)"
      }}><div style={{
          textAlign: "center",
          fontSize: FS.fs58,
          color: "#b4ac9e",
          cursor: "pointer",
          fontWeight: 600,
          padding: "4px 0"
        }} onClick={() => setOpen(false)}>{"\u2713 Done (" + selected.length + ")"}</div></div></div>}</div>;
};
return <div> {
    /* Header */
  }
  <div className={"techniques-header"}><div className={"tech-hdr-left"}><div className={"tech-ornament-line tech-ornament-line-l"} /><span className={"tech-hdr-title"}>{"✦ Leaderboard ✦"}</span><div className={"tech-ornament-line tech-ornament-line-r"} /></div></div> {
    /* Scope toggle: Friends / World */
  }
  <div style={{
    display: "flex",
    gap: S.s4,
    marginBottom: S.s12,
    background: "rgba(45,42,36,.25)",
    borderRadius: R.lg,
    padding: S.s4
  }}>{["friends", "world"].map(scope => <div key={scope} style={{
      flex: 1,
      textAlign: "center",
      padding: "8px 0",
      borderRadius: R.md,
      fontSize: FS.fs66,
      fontWeight: 700,
      cursor: "pointer",
      transition: "all .15s",
      letterSpacing: ".04em",
      background: lbScope === scope ? "rgba(45,42,36,.5)" : "transparent",
      color: lbScope === scope ? "#d4cec4" : "#8a8478",
      border: lbScope === scope ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
    }} onClick={() => setLbScope(scope)}>{scope === "friends" ? "\uD83D\uDC65 Friends" : "\uD83C\uDF0D World"}</div>)}</div>{/* Filter row: State + Country multi-selects (World only) */
  lbScope === "world" && <div style={{
    display: "flex",
    gap: S.s8,
    marginBottom: S.s10
  }}><MultiDrop label={"States"} icon={"\uD83D\uDCCD"} allLabel={"All States"} open={lbStateDropOpen} setOpen={setLbStateDropOpen} options={ALL_STATES} selected={lbStateFilters} setSelected={setLbStateFilters} /><MultiDrop label={"Countries"} icon={"\uD83C\uDF0D"} allLabel={"All Countries"} open={lbCountryDropOpen} setOpen={setLbCountryDropOpen} options={ALL_COUNTRIES} selected={lbCountryFilters} setSelected={setLbCountryFilters} /></div>} {
    /* Category filter dropdown */
  }
  <div style={{
    marginBottom: S.s12,
    position: "relative"
  }}><select value={lbFilter} onChange={function (e) {
      setLbFilter(e.target.value);
    }} style={{
      width: "100%",
      appearance: "none",
      WebkitAppearance: "none",
      background: "rgba(14,14,12,.95)",
      border: "1px solid " + tc,
      color: tc,
      borderRadius: R.xl,
      padding: "8px 28px 8px 12px",
      fontSize: FS.lg,
      fontWeight: "700",
      cursor: "pointer"
    }}>{LB_FILTERS.map(function (f) {
        var ftc = TC[f.type] || "#b4ac9e";
        return <option key={f.id} value={f.id} style={{
          background: "rgba(14,14,12,.95)",
          color: ftc,
          fontWeight: lbFilter === f.id ? "700" : "400"
        }}>{f.icon + " " + f.label}</option>;
      })}</select><span style={{
      position: "absolute",
      right: 12,
      top: "50%",
      transform: "translateY(-50%)",
      color: tc,
      pointerEvents: "none",
      fontSize: FS.fs65
    }}>{"▼"}</span></div> {
    /* Active filter description */
  }
  <div style={{
    fontSize: FS.sm,
    color: "#8a8478",
    marginBottom: S.s12,
    paddingLeft: 4,
    fontStyle: "italic"
  }}>{af.desc}</div>{/* Your standing card — Design 3 accent strip */
  myRow && <div style={{
    display: "flex",
    alignItems: "stretch",
    background: "linear-gradient(145deg,rgba(45,42,36,.3),rgba(32,30,26,.15))",
    border: "1px solid rgba(180,172,158,.1)",
    borderRadius: R.r12,
    marginBottom: S.s14,
    overflow: "hidden"
  }}> {
      /* Class color accent strip */
    }
    <div style={{
      width: 5,
      background: cls.color,
      flexShrink: 0,
      borderRadius: R.r0
    }} /><div style={{
      flex: 1,
      padding: "12px 14px",
      display: "flex",
      alignItems: "center",
      gap: S.s10
    }}> {
        /* Rank + medal */
      }
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: S.s2,
        width: 36,
        flexShrink: 0,
        justifyContent: "center"
      }}>{myRank <= 3 && <span style={{
          fontSize: FS.fs82
        }}>{myRank === 1 ? "\uD83E\uDD47" : myRank === 2 ? "\uD83E\uDD48" : "\uD83E\uDD49"}</span>}<span style={{
          fontSize: FS.fs82,
          fontWeight: "700",
          color: myRank === 1 ? "#c49428" : myRank === 2 ? "#8a8478" : myRank === 3 ? "#7a5230" : "#b4ac9e"
        }}>{myRank}</span></div> {
        /* Name + class tag + subtitle */
      }
      <div style={{
        flex: 1,
        minWidth: 0
      }}><div style={{
          fontSize: FS.fs74,
          fontWeight: "700",
          color: "#d4cec4",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}>{getNameForContext("game") || "You"}<span style={{
            fontSize: FS.fs50,
            fontWeight: 700,
            color: cls.color,
            marginLeft: S.s6
          }}>{cls.icon + " " + cls.name}</span>{myPublicId && <span style={{
            fontSize: FS.fs44,
            color: "#8a8478",
            marginLeft: S.s4
          }}>{"#" + myPublicId}</span>}<span style={{
            fontSize: FS.fs50,
            color: "#8a8478",
            marginLeft: S.s4
          }}>{"you"}</span></div><div style={{
          display: "flex",
          alignItems: "center",
          gap: S.s6,
          flexWrap: "wrap"
        }}><span style={{
            fontSize: FS.fs56,
            color: "#8a8478"
          }}>{"Lv." + xpToLevel(profile.xp || 0)}{profile.state || profile.country ? " \u00b7 " : ""}{profile.state ? profile.state : ""}{profile.country ? (profile.state ? ", " : "") + (profile.country === "United States" ? "US" : profile.country === "United Kingdom" ? "UK" : profile.country === "Canada" ? "CA" : profile.country === "Australia" ? "AU" : profile.country === "Germany" ? "DE" : profile.country === "France" ? "FR" : profile.country === "Mexico" ? "MX" : profile.country === "Brazil" ? "BR" : profile.country === "India" ? "IN" : profile.country === "Japan" ? "JP" : profile.country === "South Korea" ? "KR" : profile.country === "Philippines" ? "PH" : profile.country || "") : ""}{profile.gym ? " \u00b7 " + profile.gym : ""}{profile.checkInStreak > 0 ? " \u00b7 \uD83D\uDD25" + profile.checkInStreak : ""}</span>{lbScope === "friends" && authUser && lbWorldRanks[authUser.id] && <span style={{
            fontSize: FS.fs46,
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: R.r4,
            background: "rgba(180,172,158,.08)",
            color: "#8a8478"
          }}>{"\uD83C\uDF0D #" + lbWorldRanks[authUser.id]}</span>}</div></div> {
        /* Stat value */
      }
      <div style={{
        textAlign: "right",
        flexShrink: 0
      }}><div style={{
          fontSize: "1rem",
          fontWeight: "700",
          color: tc
        }}>{fmtVal(lbFilter, myVal)}</div><div style={{
          fontSize: FS.fs50,
          color: "#8a8478",
          marginTop: S.s2
        }}>{af.label}</div></div></div></div>} {
    /* Leaderboard list */
  }
  <div style={{
    background: "rgba(45,42,36,.1)",
    border: "1px solid rgba(45,42,36,.2)",
    borderRadius: R.r12,
    overflow: "hidden"
  }}> {
      /* Column header */
    }
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "8px 12px 8px 18px",
      borderBottom: "1px solid rgba(180,172,158,.05)",
      background: "rgba(45,42,36,.12)"
    }}><span style={{
        width: 36,
        fontSize: FS.fs52,
        color: "#8a8478",
        textTransform: "uppercase",
        letterSpacing: ".08em"
      }}>{"#"}</span><span style={{
        flex: 1,
        fontSize: FS.fs52,
        color: "#8a8478",
        textTransform: "uppercase",
        letterSpacing: ".08em"
      }}>{"Player"}</span><span style={{
        fontSize: FS.fs52,
        color: tc,
        textTransform: "uppercase",
        letterSpacing: ".08em",
        fontWeight: "700"
      }}>{af.icon + " " + af.label}</span></div>{/* Loading state */
    lbLoading && <div style={{
      padding: "24px 14px",
      textAlign: "center"
    }}><div style={{
        width: 24,
        height: 24,
        border: "2px solid rgba(180,172,158,.12)",
        borderTopColor: "#b4ac9e",
        borderRadius: "50%",
        animation: "spin .8s linear infinite",
        margin: "0 auto 8px"
      }} /><div style={{
        fontSize: FS.fs62,
        color: "#8a8478"
      }}>{"Loading rankings…"}</div></div>}{/* Player rows — Design 3: accent strip + medals */
    !lbLoading && sorted.map(function (row, idx) {
      var rank = idx + 1;
      var val = getRowVal(row, lbFilter);
      var rowCls = row.chosen_class ? CLASSES[row.chosen_class] || CLASSES.warrior : CLASSES.warrior;
      var isMe = row.is_me;
      var rankColor = rank === 1 ? "#c49428" : rank === 2 ? "#8a8478" : rank === 3 ? "#7a5230" : "#8a8478";
      var medal = rank === 1 ? "\uD83E\uDD47" : rank === 2 ? "\uD83E\uDD48" : rank === 3 ? "\uD83E\uDD49" : null;
      var worldRank = lbScope === "friends" ? lbWorldRanks[row.user_id] : null;
      var countryCode = row.country === "United States" ? "US" : row.country === "United Kingdom" ? "UK" : row.country === "Canada" ? "CA" : row.country === "Australia" ? "AU" : row.country === "Germany" ? "DE" : row.country === "France" ? "FR" : row.country === "Mexico" ? "MX" : row.country === "Brazil" ? "BR" : row.country === "India" ? "IN" : row.country === "Japan" ? "JP" : row.country === "South Korea" ? "KR" : row.country === "Philippines" ? "PH" : row.country || "";
      var loc = (row.state || "") + (row.state && countryCode ? ", " : "") + countryCode;
      return <div key={row.user_id} style={{
        display: "flex",
        alignItems: "stretch",
        background: isMe ? "rgba(45,42,36,.25)" : "linear-gradient(145deg,rgba(45,42,36,.18),rgba(32,30,26,.08))",
        borderBottom: "1px solid rgba(45,42,36,.12)"
      }}> {
          /* Class color accent strip */
        }
        <div style={{
          width: 4,
          background: rowCls.color,
          flexShrink: 0
        }} /> {
          /* Inner content */
        }
        <div style={{
          flex: 1,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: S.s8
        }}> {
            /* Rank + medal */
          }
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: S.s2,
            width: 32,
            flexShrink: 0,
            justifyContent: "center"
          }}>{medal && <span style={{
              fontSize: FS.fs78
            }}>{medal}</span>}<span style={{
              fontSize: FS.lg,
              fontWeight: "700",
              color: rankColor,
              fontFamily: "'Inter',sans-serif"
            }}>{rank}</span></div> {
            /* Name + class tag + subtitle */
          }
          <div style={{
            flex: 1,
            minWidth: 0
          }}><div style={{
              fontSize: FS.lg,
              fontWeight: "700",
              color: isMe ? "#d4cec4" : "#b4ac9e",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>{getRowName(row)}<span style={{
                fontSize: FS.fs48,
                fontWeight: 700,
                color: rowCls.color,
                marginLeft: S.s6
              }}>{rowCls.icon + " " + rowCls.name}</span>{row.public_id && <span style={{
                fontSize: FS.fs44,
                color: "#8a8478",
                marginLeft: S.s4
              }}>{"#" + row.public_id}</span>}{isMe && <span style={{
                fontSize: FS.fs48,
                color: "#8a8478",
                marginLeft: S.s4
              }}>{"you"}</span>}</div><div style={{
              display: "flex",
              alignItems: "center",
              gap: S.s6,
              flexWrap: "wrap"
            }}><span style={{
                fontSize: FS.fs52,
                color: "#8a8478"
              }}>{"Lv." + row.level}{loc ? " \u00b7 " + loc : ""}{row.gym ? " \u00b7 " + row.gym : ""}{row.streak > 0 ? " \u00b7 \uD83D\uDD25" + row.streak : ""}</span>{worldRank && <span style={{
                fontSize: FS.fs46,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: R.r4,
                background: "rgba(180,172,158,.08)",
                color: "#8a8478"
              }}>{"\uD83C\uDF0D #" + worldRank}</span>}</div></div> {
            /* Stat value */
          }
          <div style={{
            textAlign: "right",
            flexShrink: 0,
            paddingLeft: 6
          }}><div style={{
              fontSize: FS.fs78,
              fontWeight: "700",
              color: val ? tc : "#8a8478",
              fontFamily: "'Inter',sans-serif"
            }}>{fmtVal(lbFilter, val)}</div><div style={{
              fontSize: FS.fs44,
              color: "#8a8478",
              marginTop: S.s2
            }}>{af.label}</div></div></div></div>;
    })}{/* Empty state */
    !lbLoading && sorted.length === 0 && <div style={{
      padding: "24px 14px",
      textAlign: "center",
      fontSize: FS.fs66,
      color: "#8a8478",
      fontStyle: "italic"
    }}>{lbScope === "friends" ? "No friends to rank yet. Add friends in the Guild tab!" : "No warriors found matching your filters."}</div>}{/* Player count footer */
    !lbLoading && sorted.length > 0 && <div style={{
      padding: "8px 14px",
      textAlign: "center",
      fontSize: FS.fs56,
      color: "#8a8478",
      fontStyle: "italic",
      borderTop: "1px solid rgba(45,42,36,.12)"
    }}>{sorted.length + " warrior" + (sorted.length !== 1 ? "s" : "") + " ranked" + (lbStateFilters.length || lbCountryFilters.length ? " (filtered)" : "")}</div>}</div></div>;
});

export default LeaderboardTab;
