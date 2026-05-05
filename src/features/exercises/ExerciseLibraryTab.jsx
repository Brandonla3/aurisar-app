import React, { useMemo } from 'react';
import { MUSCLE_META, UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';
import { useScrollReveal } from '../../hooks/useScrollReveal';

/**
 * Exercise library tab — extracted from the inline IIFE in App.jsx as the
 * second slice of Finding #6 (App.jsx decomposition) per
 * docs/performance-audit.md (PR #116).
 *
 * Pure presentational tab. State + setters come in as props from App; the
 * heavy filter derivations come pre-memoized via useExerciseFilters (see
 * src/features/exercises/useExerciseFilters.js).
 *
 * Wrapped in React.memo so unrelated App re-renders (toast, xpFlash,
 * modals on other tabs) don't drag the library tab into a re-render when
 * none of its props changed. Matches the PlansTabContainer convention.
 */

// ── Library tab — module-level constants (hoisted from the IIFE) ──
const TYPE_OPTS = ["strength", "cardio", "flexibility", "yoga", "stretching", "plyometric", "calisthenics", "functional", "isometric", "warmup", "cooldown"];
const TYPE_LABELS = {
  strength: "⚔️ Strength",
  cardio: "🏃 Cardio",
  flexibility: "🧘 Flexibility",
  yoga: "🧘 Yoga",
  stretching: "🌿 Stretch",
  plyometric: "⚡ Plyo",
  calisthenics: "🤸 Cali",
  functional: "🔧 Functional",
  isometric: "🧱 Isometric",
  warmup: "🌅 Warmup",
  cooldown: "🌙 Cooldown",
};

const ExerciseLibraryTab = React.memo(function ExerciseLibraryTab(props) {
  const {
    // Hook outputs
    libFiltered, libAvailableTypes, libMuscleCardData, libDiscoverRows, libMuscleOpts, libEquipOpts,
    // Filter state
    libSearch, setLibSearch,
    setLibSearchDebounced,
    libTypeFilters, setLibTypeFilters,
    libMuscleFilters, setLibMuscleFilters,
    libEquipFilters, setLibEquipFilters,
    libOpenDrop, setLibOpenDrop,
    debouncedSetLibSearch,
    // View state
    libDetailEx, setLibDetailEx,
    libSelectMode, setLibSelectMode,
    libSelected, setLibSelected,
    libBrowseMode, setLibBrowseMode,
    libVisibleCount, setLibVisibleCount,
    // Profile / data
    profile, setProfile,
    allExercises, allExById,
    // Cross-tab navigation
    setActiveTab,
    // Workout builder (for "New Workout" action)
    setWbExercises, setWbName, setWbIcon, setWbDesc, setWbEditId, setWbIsOneOff,
    setWorkoutView,
    // Add-to-Workout picker
    setAddToWorkoutPicker,
    // Save-to-Plan wizard
    setSavePlanWizard,
    setSpwName, setSpwIcon, setSpwDate, setSpwMode, setSpwTargetPlanId,
    setSpwSelected,
    // Quick-log (for "Configure" action)
    setSelEx, setSets, setReps, setExWeight, setWeightPct,
    setHrZone, setDistanceVal, setExHHMM, setExSec, setQuickRows,
  } = props;

  const revealRef = useScrollReveal();

  const toggleSet = (setter, val) => {
    setter(s => {
      const n = new Set(s);
      n.has(val) ? n.delete(val) : n.add(val);
      return n;
    });
    setLibVisibleCount(60);
  };
  const clearAll = () => {
    setLibTypeFilters(new Set());
    setLibMuscleFilters(new Set());
    setLibEquipFilters(new Set());
    setLibSearch("");
    setLibSearchDebounced("");
    setLibVisibleCount(60);
    setLibBrowseMode("home");
  };
  const hasFilters = libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0 || libSearch;
  // Aliased so the JSX below stays close to the pre-extraction shape.
  const MUSCLE_OPTS = libMuscleOpts;
  const EQUIP_OPTS = libEquipOpts;
  const toggleSel = id => setLibSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  /* ── Home view computed data ── */
  const MUSCLE_CARD_DATA = libMuscleCardData;

  // Recent exercises — deduped from log, padded with favorites. Memoized so
  // the dedup walk doesn't repeat on every render of the tab; deps are the
  // log + favorites + lookup map.
  const yourExercises = useMemo(() => {
    const recentExIds = [];
    const seenIds = new Set();
    for (const entry of (profile.log || []).slice(0, 100)) {
      if (entry.exId && !seenIds.has(entry.exId) && allExById[entry.exId]) {
        recentExIds.push(entry.exId);
        seenIds.add(entry.exId);
      }
      if (recentExIds.length >= 10) break;
    }
    for (const fId of profile.favoriteExercises || []) {
      if (!seenIds.has(fId) && allExById[fId]) {
        recentExIds.push(fId);
        seenIds.add(fId);
      }
      if (recentExIds.length >= 10) break;
    }
    return recentExIds.map(id => allExById[id]).filter(Boolean);
  }, [profile.log, profile.favoriteExercises, allExById]);

  // Discover rows — labels + exercise lists are memoized at App body
  // (libDiscoverRows). Wire onSeeAll closures here so the lifted memo stays
  // free of setter dependencies.
  const _equipFor = { "Bodyweight Only": "bodyweight", "Dumbbell Exercises": "dumbbell", "Barbell Essentials": "barbell" };
  const discoverRows = libDiscoverRows.map(row => ({
    ...row,
    onSeeAll: _equipFor[row.label]
      ? () => { setLibEquipFilters(new Set([_equipFor[row.label]])); setLibBrowseMode("filtered"); }
      : () => setLibBrowseMode("filtered"),
  }));

  // Fade-edge scroll handler
  const handleHScroll = e => {
    const el = e.currentTarget;
    const wrap = el.parentElement;
    if (!wrap) return;
    const atLeft = el.scrollLeft > 8;
    const atRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 8;
    wrap.classList.toggle('fade-left', atLeft);
    wrap.classList.toggle('fade-right-off', !atRight);
  };

  return <div> {
      /* Sticky search bar — translucent material */
    }
    <div className={"lib-sticky-search"}><div style={{
        display: "flex",
        gap: S.s8,
        alignItems: "center"
      }}><div className={"tech-search-wrap"} style={{
          flex: 1,
          marginBottom: S.s0
        }}><span className={"tech-search-icon"}>{"🔍"}</span><input className={"tech-search-inp"} placeholder={`Search ${allExercises.length} exercises…`} value={libSearch} onChange={e => {
            const v = e.target.value;
            setLibSearch(v);
            debouncedSetLibSearch(v);
            if (v && libBrowseMode === "home") setLibBrowseMode("filtered");
          }} />{libSearch && <span className={"tech-search-clear"} onClick={() => {
            setLibSearch("");
            setLibSearchDebounced("");
            setLibVisibleCount(60);
            if (libMuscleFilters.size === 0 && libTypeFilters.size === 0 && libEquipFilters.size === 0) setLibBrowseMode("home");
          }}>{"✕"}</span>}</div>{libBrowseMode === "filtered" && <button onClick={() => {
          setLibSelectMode(m => !m);
          setLibSelected(new Set());
        }} style={{
          flexShrink: 0,
          padding: "6px 12px",
          borderRadius: R.lg,
          border: "1px solid",
          borderColor: libSelectMode ? "#B0A898" : "rgba(45,42,36,.3)",
          background: libSelectMode ? "rgba(45,42,36,.26)" : "transparent",
          color: libSelectMode ? "#B0A898" : "#8a8478",
          fontSize: FS.md,
          fontWeight: libSelectMode ? "700" : "400",
          cursor: "pointer",
          whiteSpace: "nowrap"
        }}>{libSelectMode ? "✕ Cancel" : "⊞ Select"}</button>}</div></div>{/* ═══ HOME VIEW ═══ */
    libBrowseMode === "home" && <div>{/* Your Exercises — hero carousel */
      yourExercises.length > 0 && <div className={"lib-home-section"} style={{
        marginBottom: S.s4
      }}><div className={"lib-section-hdr"}><span className={"lib-hdr-icon"}>{"⚔️"}</span>{"Your Exercises"}</div><div className={"lib-hscroll-wrap"}><div className={"lib-hscroll"} onScroll={handleHScroll}>{yourExercises.map(ex => {
              const mgColor = getMuscleColor(ex.muscleGroup);
              const mgLabel = (MUSCLE_META[(ex.muscleGroup || "").toLowerCase()] || {}).label || ex.muscleGroup || "";
              return <div key={"yr-" + ex.id} className={"lib-hero-card"} onClick={() => setLibDetailEx(ex)} style={{
                '--mg-color': mgColor
              }}><div className={"lib-hero-orb"} style={{
                  '--mg-color': mgColor
                }}><ExIcon ex={ex} size={"1.4rem"} color={mgColor} /></div><span className={"lib-hero-name"}>{ex.name}</span>{mgLabel && <span className={"lib-muscle-pill"} style={{
                  '--mg-color': mgColor
                }}>{mgLabel}</span>}</div>;
            })}</div></div></div>}{yourExercises.length > 0 && <div className={"lib-divider"} />} {
        /* Browse by Muscle — feature tiles */
      }
      <div className={"lib-home-section"} style={{
        marginBottom: S.s4
      }}><div className={"lib-section-hdr"}><span className={"lib-hdr-icon"}>{"🗺️"}</span>{"Browse by Muscle"}</div><div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: S.s10
        }}>{MUSCLE_CARD_DATA.map(({
            mg,
            label,
            emoji,
            icon,
            count,
            color
          }) => <div key={"mc-" + mg} className={"lib-muscle-tile"} onClick={() => {
            setLibMuscleFilters(new Set([mg]));
            setLibBrowseMode("filtered");
          }} style={{
            '--mg-color': color
          }}><span className={"lib-tile-watermark"}>{emoji}</span><div className={"lib-tile-orb"} style={{
              '--mg-color': color
            }}><ExIcon ex={{
                muscleGroup: mg,
                category: "strength"
              }} size={"1.15rem"} color={color} /></div><div><div className={"lib-tile-name"}>{label}</div><div className={"lib-tile-count"} style={{
                '--mg-color': color
              }}>{count + " exercises"}</div></div></div>)}</div></div><div className={"lib-divider"} />{/* Discover Rows — Netflix-style horizontal scroll */
      discoverRows.map((row, ri) => row.exercises.length >= 3 && <div key={"dr-" + row.label} className={"lib-home-section"} style={{
        marginBottom: ri < discoverRows.length - 1 ? 18 : 0
      }}><div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: S.s10
        }}><span className={"lib-section-hdr"} style={{
            marginBottom: S.s0
          }}>{row.label}</span><button className={"lib-see-all"} onClick={row.onSeeAll}>{"See All →"}</button></div><div className={"lib-hscroll-wrap"}><div className={"lib-hscroll"} onScroll={handleHScroll}>{row.exercises.map(ex => {
              const mgColor = getMuscleColor(ex.muscleGroup);
              const diff = (ex.difficulty || "").toLowerCase();
              const diffCls = diff === "beginner" ? "lib-diff-beginner" : diff === "advanced" ? "lib-diff-advanced" : diff === "intermediate" ? "lib-diff-intermediate" : "";
              const mgLabel = (MUSCLE_META[(ex.muscleGroup || "").toLowerCase()] || {}).label || "";
              return <div key={"d-" + ex.id} className={"lib-discover-card"} onClick={() => setLibDetailEx(ex)} style={{
                '--mg-color': mgColor
              }}><div className={"lib-discover-orb"} style={{
                  '--mg-color': mgColor
                }}><ExIcon ex={ex} size={"1.1rem"} color={mgColor} /></div><span className={"lib-discover-name"}>{ex.name}</span><div className={"lib-discover-meta"}>{mgLabel && <span style={{
                    fontSize: FS.fs50,
                    color: mgColor,
                    fontWeight: 500
                  }}>{mgLabel}</span>}{mgLabel && diffCls && <span style={{
                    fontSize: FS.fs45,
                    color: "#8a8478"
                  }}>{"·"}</span>}{diffCls && <span className={"lib-diff-badge " + diffCls}>{ex.difficulty}</span>}<span style={{
                    fontSize: FS.fs50,
                    color: "#8a8478",
                    fontWeight: 600
                  }}>{(ex.baseXP || 0) + " XP"}</span></div></div>;
            })}</div></div></div>)}</div>}{/* ═══ FILTERED VIEW ═══ */
    libBrowseMode === "filtered" && <div> {
        /* Back to browse */
      }
      <div style={{
        marginBottom: S.s10
      }}><button onClick={() => clearAll()} style={{
          background: "transparent",
          border: "none",
          color: "#b4ac9e",
          fontSize: FS.fs78,
          cursor: "pointer",
          padding: "4px 0",
          display: "flex",
          alignItems: "center",
          gap: S.s4
        }}>{"← Browse Library"}</button></div> {
        /* Filter dropdowns row — custom panels that stay open for multi-select */
      }
      <div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s10,
        flexWrap: "wrap",
        position: "relative"
      }}>{/* Close-on-outside-click overlay */
        libOpenDrop && <div onClick={() => setLibOpenDrop(null)} style={{
          position: "fixed",
          inset: 0,
          zIndex: 19
        }} />} {
          /* ── Type dropdown ── */
        }
        <div style={{
          position: "relative",
          flex: "1 1 110px",
          zIndex: 20
        }}><button onClick={() => setLibOpenDrop(libOpenDrop === "type" ? null : "type")} style={{
            width: "100%",
            padding: "8px 28px 8px 10px",
            borderRadius: R.xl,
            border: "1px solid " + (libTypeFilters.size > 0 ? "#C4A044" : "rgba(45,42,36,.3)"),
            background: "rgba(14,14,12,.95)",
            color: libTypeFilters.size > 0 ? "#C4A044" : "#8a8478",
            fontSize: FS.lg,
            textAlign: "left",
            cursor: "pointer",
            position: "relative"
          }}>{libTypeFilters.size > 0 ? "Type (" + libTypeFilters.size + ")" : "Type"}<span style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%) rotate(" + (libOpenDrop === "type" ? "180deg" : "0deg") + ")",
              color: libTypeFilters.size > 0 ? "#C4A044" : "#8a8478",
              fontSize: FS.sm,
              transition: "transform .15s",
              lineHeight: 1
            }}>{"▼"}</span></button>{libOpenDrop === "type" && <div style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            background: "rgba(16,14,10,.95)",
            border: "1px solid rgba(180,172,158,.07)",
            borderRadius: R.xl,
            padding: "6px 4px",
            zIndex: 21,
            boxShadow: "0 8px 24px rgba(0,0,0,.6)"
          }}>{TYPE_OPTS.map(val => {
              const sel = libTypeFilters.has(val);
              const avail = libAvailableTypes.size === 0 || libAvailableTypes.has(val) || sel;
              return <div key={val} onClick={() => toggleSet(setLibTypeFilters, val)} style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                padding: "6px 10px",
                borderRadius: R.md,
                cursor: "pointer",
                opacity: avail ? 1 : 0.35,
                background: sel ? "rgba(45,42,36,.22)" : "transparent"
              }}><div style={{
                  width: 14,
                  height: 14,
                  borderRadius: R.r3,
                  flexShrink: 0,
                  border: "1.5px solid " + (sel ? getTypeColor(val) : "rgba(180,172,158,.08)"),
                  background: sel ? "rgba(45,42,36,.32)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>{sel && <span style={{
                    fontSize: FS.sm,
                    color: getTypeColor(val),
                    lineHeight: 1
                  }}>{"✓"}</span>}</div><span style={{
                  fontSize: FS.lg,
                  color: sel ? getTypeColor(val) : avail ? "#b4ac9e" : "#8a8478",
                  whiteSpace: "nowrap"
                }}>{TYPE_LABELS[val]}</span></div>;
            })}</div>}</div> {
          /* ── Muscle dropdown ── */
        }
        <div style={{
          position: "relative",
          flex: "1 1 110px",
          zIndex: 20
        }}><button onClick={() => setLibOpenDrop(libOpenDrop === "muscle" ? null : "muscle")} style={{
            width: "100%",
            padding: "8px 28px 8px 10px",
            borderRadius: R.xl,
            border: "1px solid " + (libMuscleFilters.size > 0 ? UI_COLORS.accent : "rgba(45,42,36,.3)"),
            background: "rgba(14,14,12,.95)",
            color: libMuscleFilters.size > 0 ? "#7A8F8B" : "#8a8478",
            fontSize: FS.lg,
            textAlign: "left",
            cursor: "pointer",
            position: "relative"
          }}>{libMuscleFilters.size > 0 ? "Muscle (" + libMuscleFilters.size + ")" : "Muscle Group"}<span style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%) rotate(" + (libOpenDrop === "muscle" ? "180deg" : "0deg") + ")",
              color: libMuscleFilters.size > 0 ? "#7A8F8B" : "#8a8478",
              fontSize: FS.sm,
              transition: "transform .15s",
              lineHeight: 1
            }}>{"▼"}</span></button>{libOpenDrop === "muscle" && <div style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            background: "rgba(16,14,10,.95)",
            border: "1px solid rgba(122,143,139,.25)",
            borderRadius: R.xl,
            padding: "6px 4px",
            zIndex: 21,
            boxShadow: "0 8px 24px rgba(0,0,0,.6)"
          }}>{MUSCLE_OPTS.map(m => {
              const sel = libMuscleFilters.has(m);
              return <div key={m} onClick={() => toggleSet(setLibMuscleFilters, m)} style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                padding: "6px 10px",
                borderRadius: R.md,
                cursor: "pointer",
                background: sel ? "rgba(122,143,139,.12)" : "transparent"
              }}><div style={{
                  width: 14,
                  height: 14,
                  borderRadius: R.r3,
                  flexShrink: 0,
                  border: "1.5px solid " + (sel ? "#7A8F8B" : "rgba(122,143,139,.3)"),
                  background: sel ? "rgba(122,143,139,.25)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>{sel && <span style={{
                    fontSize: FS.sm,
                    color: UI_COLORS.accent,
                    lineHeight: 1
                  }}>{"✓"}</span>}</div><span style={{
                  fontSize: FS.lg,
                  color: sel ? "#7A8F8B" : "#b4ac9e",
                  whiteSpace: "nowrap"
                }}>{m.charAt(0).toUpperCase() + m.slice(1).replace("_", " ")}</span></div>;
            })}</div>}</div> {
          /* ── Equipment dropdown ── */
        }
        <div style={{
          position: "relative",
          flex: "1 1 110px",
          zIndex: 20
        }}><button onClick={() => setLibOpenDrop(libOpenDrop === "equip" ? null : "equip")} style={{
            width: "100%",
            padding: "8px 28px 8px 10px",
            borderRadius: R.xl,
            border: "1px solid " + (libEquipFilters.size > 0 ? UI_COLORS.accent : "rgba(45,42,36,.3)"),
            background: "rgba(14,14,12,.95)",
            color: libEquipFilters.size > 0 ? UI_COLORS.accent : "#8a8478",
            fontSize: FS.lg,
            textAlign: "left",
            cursor: "pointer",
            position: "relative"
          }}>{libEquipFilters.size > 0 ? "Equip (" + libEquipFilters.size + ")" : "Equipment"}<span style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%) rotate(" + (libOpenDrop === "equip" ? "180deg" : "0deg") + ")",
              color: libEquipFilters.size > 0 ? UI_COLORS.accent : "#8a8478",
              fontSize: FS.sm,
              transition: "transform .15s",
              lineHeight: 1
            }}>{"▼"}</span></button>{libOpenDrop === "equip" && <div style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            background: "rgba(16,14,10,.95)",
            border: "1px solid rgba(196,148,40,0.25)",
            borderRadius: R.xl,
            padding: "6px 4px",
            zIndex: 21,
            boxShadow: "0 8px 24px rgba(0,0,0,.6)"
          }}>{EQUIP_OPTS.map(eq => {
              const sel = libEquipFilters.has(eq);
              return <div key={eq} onClick={() => toggleSet(setLibEquipFilters, eq)} style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                padding: "6px 10px",
                borderRadius: R.md,
                cursor: "pointer",
                background: sel ? "rgba(196,148,40,0.12)" : "transparent"
              }}><div style={{
                  width: 14,
                  height: 14,
                  borderRadius: R.r3,
                  flexShrink: 0,
                  border: "1.5px solid " + (sel ? UI_COLORS.accent : "rgba(196,148,40,0.3)"),
                  background: sel ? "rgba(196,148,40,0.25)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>{sel && <span style={{
                    fontSize: FS.sm,
                    color: UI_COLORS.accent,
                    lineHeight: 1
                  }}>{"✓"}</span>}</div><span style={{
                  fontSize: FS.lg,
                  color: sel ? UI_COLORS.accent : "#b4ac9e",
                  whiteSpace: "nowrap"
                }}>{eq.charAt(0).toUpperCase() + eq.slice(1)}</span></div>;
            })}</div>}</div></div>{/* Active filter tags — show what's selected, tap to remove */
      (libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0) && <div style={{
        display: "flex",
        gap: S.s6,
        flexWrap: "wrap",
        marginBottom: S.s8
      }}>{[...libTypeFilters].map(v => <span key={"t" + v} onClick={() => toggleSet(setLibTypeFilters, v)} style={{
          background: "rgba(196,160,68,.08)",
          border: "1px solid rgba(196,160,68,.25)",
          color: getTypeColor(v),
          fontSize: FS.fs62,
          padding: "4px 8px",
          borderRadius: R.r12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: S.s4
        }}>{TYPE_LABELS[v] || v}{" ✕"}</span>)}{[...libMuscleFilters].map(v => <span key={"m" + v} onClick={() => toggleSet(setLibMuscleFilters, v)} style={{
          background: "rgba(122,143,139,.12)",
          border: "1px solid rgba(122,143,139,.3)",
          color: getMuscleColor(v),
          fontSize: FS.fs62,
          padding: "4px 8px",
          borderRadius: R.r12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: S.s4
        }}>{v.charAt(0).toUpperCase() + v.slice(1).replace("_", " ")}{" ✕"}</span>)}{[...libEquipFilters].map(v => <span key={"e" + v} onClick={() => toggleSet(setLibEquipFilters, v)} style={{
          background: "rgba(196,148,40,0.15)",
          border: "1px solid rgba(196,148,40,0.27)",
          color: UI_COLORS.accent,
          fontSize: FS.fs62,
          padding: "4px 8px",
          borderRadius: R.r12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: S.s4
        }}>{v.charAt(0).toUpperCase() + v.slice(1)}{" ✕"}</span>)}</div>} {
        /* Count + clear row */
      }
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: S.s8
      }}><div style={{
          fontSize: FS.fs68,
          color: "#8a8478"
        }}>{libFiltered.length + " exercises"}</div>{hasFilters && <button onClick={clearAll} style={{
          background: "transparent",
          border: "none",
          color: "#b4ac9e",
          fontSize: FS.fs68,
          cursor: "pointer"
        }}>{"Clear all filters"}</button>}</div>{/* Select mode action bar */
      libSelectMode && libSelected.size > 0 && <div style={{
        background: "rgba(45,42,36,.2)",
        border: "1px solid rgba(180,172,158,.06)",
        borderRadius: R.r10,
        padding: "10px 14px",
        marginBottom: S.s10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: S.s8
      }}><span style={{
          fontSize: FS.lg,
          color: "#b4ac9e",
          fontWeight: "700"
        }}>{libSelected.size + " selected"}</span><div style={{
          display: "flex",
          gap: S.s8,
          justifyContent: "center"
        }}><button onClick={() => {
            const exs = [...libSelected].map(id => {
              const e = allExById[id];
              return {
                exId: id,
                sets: e && e.defaultSets != null ? e.defaultSets : 3,
                reps: e && e.defaultReps != null ? e.defaultReps : 10,
                weightLbs: null,
                durationMin: e && e.defaultDurationMin || null,
                weightPct: 100,
                distanceMi: null,
                hrZone: null
              };
            });
            setAddToWorkoutPicker({
              exercises: exs
            });
            setLibSelectMode(false);
            setLibSelected(new Set());
          }} style={{
            background: "rgba(45,42,36,.22)",
            border: "1px solid rgba(180,172,158,.08)",
            color: "#b4ac9e",
            padding: "6px 12px",
            borderRadius: R.lg,
            fontSize: FS.md,
            fontWeight: "700",
            cursor: "pointer",
            whiteSpace: "nowrap",
            textAlign: "center"
          }}>{"➕ Existing"}</button><button onClick={() => {
            const exs = [...libSelected].map(id => {
              const e = allExById[id];
              return {
                exId: id,
                sets: e && e.defaultSets != null ? e.defaultSets : 3,
                reps: e && e.defaultReps != null ? e.defaultReps : 10,
                weightLbs: null,
                durationMin: e && e.defaultDurationMin || null,
                weightPct: 100,
                distanceMi: null,
                hrZone: null
              };
            });
            setWbExercises(exs);
            setWbName("");
            setWbIcon("💪");
            setWbDesc("");
            setWbEditId(null);
            setWbIsOneOff(false);
            setWorkoutView("builder");
            setActiveTab("workouts");
            setLibSelectMode(false);
            setLibSelected(new Set());
          }} style={{
            background: "linear-gradient(135deg,#5b2d8e,#7b1fa2)",
            border: "none",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: R.lg,
            fontSize: FS.md,
            fontWeight: "700",
            cursor: "pointer",
            whiteSpace: "nowrap",
            textAlign: "center"
          }}>{"⚡ New Workout"}</button><button onClick={() => {
            const ids = [...libSelected];
            setSpwSelected(ids);
            setSavePlanWizard({
              entries: ids.map(id => ({
                exId: id,
                exercise: allExById[id] && allExById[id].name,
                icon: allExById[id] && allExById[id].icon,
                _idx: id
              })),
              label: "Selected Exercises"
            });
            setSpwName("Selected Exercises");
            setSpwIcon("📋");
            setSpwDate("");
            setSpwMode("new");
            setSpwTargetPlanId(null);
            setLibSelectMode(false);
            setLibSelected(new Set());
          }} style={{
            background: "rgba(45,42,36,.26)",
            border: "1px solid rgba(180,172,158,.08)",
            color: "#b4ac9e",
            padding: "6px 12px",
            borderRadius: R.lg,
            fontSize: FS.md,
            fontWeight: "700",
            cursor: "pointer",
            whiteSpace: "nowrap",
            textAlign: "center"
          }}>{"📋 Plan"}</button></div></div>} {
        /* Exercise list (paginated) */
      }
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: S.s6
      }}>{libFiltered.length === 0 && <div className={"empty"} style={{
          padding: "24px 0"
        }}>{"No exercises match your filters."}</div>}{libFiltered.slice(0, libVisibleCount).map(ex => {
          const isFav = (profile.favoriteExercises || []).includes(ex.id);
          const hasPB = !!(profile.exercisePBs || {})[ex.id];
          const isSel = libSelected.has(ex.id);
          // Derive difficulty — prefer stored value, fall back to baseXP tiers
          const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
          const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
          const exMgColor = getMuscleColor(ex.muscleGroup);
          return <div key={ex.id} ref={revealRef} className={`picker-ex-row scroll-reveal${isSel ? " sel" : ""}`} onClick={() => {
            if (libSelectMode) {
              toggleSel(ex.id);
            } else {
              setLibDetailEx(ex);
            }
          }} style={{
            "--mg-color": exMgColor
          }}> {
              /* Icon orb */
            }
            <div className={"picker-ex-orb"}><ExIcon ex={ex} size={"1rem"} color={"#d4cec4"} /></div> {
              /* Body */
            }
            <div style={{
              flex: 1,
              minWidth: 0
            }}><div style={{
                display: "flex",
                alignItems: "center",
                gap: S.s6,
                flexWrap: "wrap",
                marginBottom: S.s4
              }}><span style={{
                  fontSize: FS.fs83,
                  fontWeight: 600,
                  color: isSel ? "#d4cec4" : "#d4cec4",
                  letterSpacing: ".01em"
                }}>{ex.name}</span>{hasPB && <span style={{
                  fontSize: FS.sm
                }}>{"🏆"}</span>}</div><div style={{
                fontSize: FS.fs62,
                fontStyle: "italic",
                lineHeight: 1.4
              }}>{ex.category && <span style={{
                  color: getTypeColor(ex.category)
                }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</span>}{ex.category && ex.muscleGroup && <span style={{
                  color: "#8a8478"
                }}>{" · "}</span>}{ex.muscleGroup && <span style={{
                  color: getMuscleColor(ex.muscleGroup)
                }}>{ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}</span>}{ex.equipment && ex.equipment !== "bodyweight" && <span style={{
                  color: "#8a8478"
                }}>{" · "}</span>}{ex.equipment && ex.equipment !== "bodyweight" && <span style={{
                  color: "#8a8478"
                }}>{ex.equipment}</span>}</div></div> {
              /* Right */
            }
            <div style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: S.s6
            }}><span style={{
                fontSize: FS.fs66,
                fontWeight: 700,
                color: "#b4ac9e",
                letterSpacing: ".02em"
              }}>{ex.baseXP + " XP"}</span>{diffLabel ? <span style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: R.r4,
                fontSize: FS.fs58,
                fontWeight: 700,
                letterSpacing: ".05em",
                color: diffColor,
                background: diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010"
              }}>{diffLabel}</span> : null}{!libSelectMode && <button style={{
                background: "transparent",
                border: "none",
                color: isFav ? "#d4cec4" : "#8a8478",
                fontSize: FS.fs90,
                cursor: "pointer",
                padding: S.s0,
                lineHeight: 1
              }} onClick={e => {
                e.stopPropagation();
                setProfile(p => ({
                  ...p,
                  favoriteExercises: (p.favoriteExercises || []).includes(ex.id) ? (p.favoriteExercises || []).filter(i => i !== ex.id) : [...(p.favoriteExercises || []), ex.id]
                }));
              }}>{isFav ? "⭐" : "☆"}</button>}</div></div>;
        })}{/* Load More / count info */
        libFiltered.length > libVisibleCount && <button onClick={() => setLibVisibleCount(c => c + 60)} style={{
          alignSelf: "center",
          margin: "12px auto",
          padding: "8px 24px",
          borderRadius: R.lg,
          border: "1px solid rgba(180,172,158,.12)",
          background: "rgba(45,42,36,.3)",
          color: "#b4ac9e",
          fontSize: FS.fs75,
          fontWeight: 600,
          cursor: "pointer",
          letterSpacing: ".02em"
        }}>{`Load More (${Math.min(libVisibleCount, libFiltered.length)} of ${libFiltered.length})`}</button>}</div></div>}{/* ── end filtered view ── */

    /* Detail bottom sheet */
    libDetailEx && <div onClick={() => setLibDetailEx(null)} style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.85)",
      zIndex: 500,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center"
    }}><div onClick={e => e.stopPropagation()} className={"sheet-slide-up"} style={{
        background: "linear-gradient(160deg,rgba(18,16,12,.92),rgba(12,12,10,.95))",
        border: "1px solid rgba(180,172,158,.06)",
        borderRadius: "16px 16px 0 0",
        width: "100%",
        maxWidth: 520,
        maxHeight: "90vh",
        overflowY: "auto",
        padding: "20px 18px 32px"
      }}><div style={{
          width: 36,
          height: 4,
          background: "rgba(45,42,36,.3)",
          borderRadius: R.r2,
          margin: "0 auto 16px"
        }} /><div style={{
          height: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: S.s12
        }}><ExIcon ex={libDetailEx} size={"3.5rem"} color={getTypeColor(libDetailEx.category)} /></div><div style={{
          marginBottom: S.s10
        }}><div style={{
            display: "flex",
            alignItems: "center",
            gap: S.s8,
            flexWrap: "wrap",
            marginBottom: S.s4
          }}><span style={{
              fontSize: "1rem",
              fontWeight: "700",
              color: "#e8e0d0"
            }}>{libDetailEx.name}</span>{(profile.exercisePBs || {})[libDetailEx.id] && <span style={{
              background: "rgba(180,172,158,.1)",
              color: "#b4ac9e",
              fontSize: FS.sm,
              padding: "2px 8px",
              borderRadius: R.r4,
              fontWeight: "700"
            }}>{"🏆 PB"}</span>}</div><div style={{
            display: "flex",
            gap: S.s8,
            flexWrap: "wrap"
          }}><span style={{
              fontSize: FS.md,
              color: getMuscleColor(libDetailEx.muscleGroup),
              fontStyle: "italic"
            }}>{libDetailEx.muscleGroup ? libDetailEx.muscleGroup.charAt(0).toUpperCase() + libDetailEx.muscleGroup.slice(1) : ""}</span>{libDetailEx.equipment && <span style={{
              fontSize: FS.md,
              color: "#8a8478",
              fontStyle: "italic"
            }}>{"· " + libDetailEx.equipment}</span>}{libDetailEx.difficulty && <span style={{
              fontSize: FS.md,
              fontWeight: 700,
              color: libDetailEx.difficulty === "Advanced" ? "#7A2838" : libDetailEx.difficulty === "Beginner" ? "#5A8A58" : "#A8843C"
            }}>{"· " + libDetailEx.difficulty}</span>}<span style={{
              fontSize: FS.md,
              color: "#b4ac9e",
              fontWeight: "700"
            }}>{"· " + libDetailEx.baseXP + " XP"}</span></div></div>{libDetailEx.desc && <p style={{
          fontSize: FS.fs78,
          color: "#8a8478",
          lineHeight: 1.55,
          marginBottom: S.s12
        }}>{libDetailEx.desc}</p>}{libDetailEx.pbType && <div style={{
          background: "rgba(45,42,36,.16)",
          border: "1px solid rgba(180,172,158,.05)",
          borderRadius: R.lg,
          padding: "8px 12px",
          marginBottom: S.s12,
          fontSize: FS.lg,
          color: "#8a8478"
        }}><span style={{
            color: "#b4ac9e",
            fontWeight: "700"
          }}>{"PB: "}</span>{libDetailEx.pbType}{libDetailEx.pbTier === "Leaderboard" && <span style={{
            marginLeft: S.s8,
            color: "#b4ac9e",
            fontSize: FS.fs65
          }}>{"🏆 Leaderboard"}</span>}</div>}<button onClick={() => setProfile(p => ({
          ...p,
          favoriteExercises: (p.favoriteExercises || []).includes(libDetailEx.id) ? (p.favoriteExercises || []).filter(i => i !== libDetailEx.id) : [...(p.favoriteExercises || []), libDetailEx.id]
        }))} style={{
          width: "100%",
          background: "rgba(45,42,36,.2)",
          border: "1px solid rgba(180,172,158,.06)",
          color: "#b4ac9e",
          padding: "11px",
          borderRadius: R.xl,
          fontWeight: "700",
          fontSize: FS.fs82,
          cursor: "pointer"
        }}>{(profile.favoriteExercises || []).includes(libDetailEx.id) ? "⭐ Saved to Favorites" : "☆ Save to Favorites"}</button><div style={{
          display: "flex",
          gap: S.s8,
          marginTop: S.s8
        }}>{libDetailEx.id !== "rest_day" && <button onClick={() => {
            const exEntry = {
              exId: libDetailEx.id,
              sets: libDetailEx.defaultSets != null ? libDetailEx.defaultSets : 3,
              reps: libDetailEx.defaultReps != null ? libDetailEx.defaultReps : 10,
              weightLbs: null,
              durationMin: null,
              weightPct: 100,
              distanceMi: null,
              hrZone: null
            };
            setAddToWorkoutPicker({
              exercises: [exEntry]
            });
            setLibDetailEx(null);
          }} style={{
            flex: 1,
            background: "rgba(45,42,36,.2)",
            border: "1px solid rgba(180,172,158,.06)",
            color: "#b4ac9e",
            padding: "10px",
            borderRadius: R.xl,
            fontWeight: "600",
            fontSize: FS.lg,
            cursor: "pointer",
            textAlign: "center"
          }}>{"💪 Add to Workout"}</button>}<button onClick={() => {
            const ids = [libDetailEx.id];
            setSavePlanWizard({
              entries: ids.map(id => ({
                exId: id,
                exercise: libDetailEx.name,
                icon: libDetailEx.icon,
                _idx: id
              })),
              label: libDetailEx.name
            });
            setSpwName(libDetailEx.name);
            setSpwIcon("📋");
            setSpwDate("");
            setSpwMode("new");
            setSpwTargetPlanId(null);
            setLibDetailEx(null);
          }} style={{
            flex: 1,
            background: "rgba(45,42,36,.2)",
            border: "1px solid rgba(180,172,158,.06)",
            color: "#b4ac9e",
            padding: "10px",
            borderRadius: R.xl,
            fontWeight: "600",
            fontSize: FS.lg,
            cursor: "pointer",
            textAlign: "center"
          }}>{"📋 Add to Plan"}</button></div> {
          /* Edit & Complete Now */
        }
        <button onClick={() => {
          setSelEx(libDetailEx.id);
          setSets("");
          setReps("");
          setExWeight("");
          setWeightPct(100);
          setDistanceVal("");
          setHrZone(null);
          setExHHMM("");
          setExSec("");
          setQuickRows([]);
          setLibDetailEx(null);
          setActiveTab("workout");
        }} style={{
          width: "100%",
          marginTop: S.s8,
          background: "linear-gradient(135deg,rgba(26,82,118,.25),rgba(41,128,185,.15))",
          border: "1px solid rgba(41,128,185,.3)",
          color: UI_COLORS.info,
          padding: "11px",
          borderRadius: R.xl,
          fontWeight: "700",
          fontSize: FS.fs82,
          cursor: "pointer",
          textAlign: "center"
        }}>{"⚙ Configure"}</button></div></div>}</div>;
});

export default ExerciseLibraryTab;
