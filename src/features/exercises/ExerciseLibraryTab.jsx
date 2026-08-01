import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import { MUSCLE_META, UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS, Z } from '../../utils/tokens';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import FilterDropdown from './FilterDropdown';
import MuscleTorchStrip from './MuscleTorchStrip';
import GymKitBar from './GymKitBar';
import MuscleMap from './MuscleMap';
import ExerciseRow from './ExerciseRow';
import { TYPE_OPTS, TYPE_LABELS, muscleLabel } from './exerciseFilterOptions';

// Row adapter for the virtualised filtered list — mirrors
// WorkoutExercisePicker's WbExPickerRow: maps react-window's props onto the
// shared ExerciseRow. Recycled rows must NOT carry the scroll-reveal entrance
// class (a recycled node would re-fire or stick at opacity:0), so the fade is
// intentionally dropped inside the virtual list.
const LibExRow = React.memo(function LibExRow({
  ariaAttributes, index, style,
  exercises, cartSet, favSet, pbSet, selectable, onOpen, onToggleCart, onToggleFav,
}) {
  const ex = exercises[index];
  if (!ex) return null;
  return (
    <div style={{ ...style, paddingTop: 4, paddingBottom: 4 }} {...ariaAttributes}>
      <ExerciseRow
        ex={ex}
        selected={cartSet.has(ex.id)}
        selectable={selectable}
        showEquipment
        showPB={pbSet.has(ex.id)}
        isFav={favSet.has(ex.id)}
        onToggleFav={selectable ? undefined : onToggleFav}
        onActivate={() => (selectable ? onToggleCart(ex.id) : onOpen(ex))}
      />
    </div>
  );
});

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

const ExerciseLibraryTab = React.memo(function ExerciseLibraryTab(props) {
  const {
    // Hook outputs
    libFiltered, libMuscleCardData, libMuscleMapData, libDiscoverRows, libMuscleOpts, libEquipOpts,
    libTypeCounts, libMuscleCounts, libEquipCounts,
    // Filter state
    setLibSearchDebounced,
    libTypeFilters, setLibTypeFilters,
    libMuscleFilters, setLibMuscleFilters,
    libEquipFilters, setLibEquipFilters,
    debouncedSetLibSearch,
    // View state
    setLibDetailEx,
    libSelectMode, setLibSelectMode,
    cartIds, toggleCart,
    // Profile / data
    profile, setProfile,
    allExercises, allExById,
    _exReady, _exLoadError,
    gymKit, setGymKit, kitTotalAll, libKitCount,
    // Quick-log (for "Configure" action)
      } = props;

  const [catalogNoteDismissed, setCatalogNoteDismissed] = useState(false);

  // Raw search keystrokes, the open dropdown, the browse mode and the page
  // depth are all local now — none is read by App, and keeping the raw search
  // value here means typing re-renders only this memoized tab, not the shell.
  // The DEBOUNCED value still flows up (debouncedSetLibSearch) to drive the
  // filter pipeline in App.
  const [search, setSearch] = useState("");
  const [libOpenDrop, setLibOpenDrop] = useState(null); // "type"|"muscle"|"equip"|null
  const [libBrowseMode, setLibBrowseMode] = useState("home"); // "home"|"filtered"

  // Which reading of the training-heat data to show. The strip is the default
  // and the accessible fallback; the map is opt-in and remembered.
  const [browseView, setBrowseView] = useState(() => {
    try { return localStorage.getItem('aurisar-heat-view') === 'map' ? 'map' : 'strip'; }
    catch { return 'strip'; }
  });
  const setHeatView = v => {
    setBrowseView(v);
    try { localStorage.setItem('aurisar-heat-view', v); } catch { /* private mode */ }
  };
  // Rendered inside the heat section header rather than under "Browse by
  // Muscle", which sits below it — a control has to live with the thing it
  // controls or it reads as belonging to the next section down.
  const heatToggle = (
    <div className={"mm-viewtoggle"} role={"group"} aria-label={"Heat display"}>
      {[["strip", "▦ Strip"], ["map", "🗺 Map"]].map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={browseView === v ? "on" : undefined}
          aria-pressed={browseView === v}
          onClick={() => setHeatView(v)}
        >{label}</button>
      ))}
    </div>
  );
  const pickMuscle = mg => {
    setLibMuscleFilters(new Set([mg]));
    setLibBrowseMode("filtered");
  };
  // Separate keys per view: returning to the home carousels shouldn't drop
  // you at the offset you had in a 1,500-row filtered list.
  useScrollRestore(`lib-${libBrowseMode}`);

  // ── Virtual-list plumbing ──
  const rootRef = useRef(null);          // tab root, used to find the .scroll-area to lock
  const listRef = useRef(null);          // react-window imperative API ({ element, scrollToRow })
  const listSaveTimer = useRef(null);
  const LIB_ROW_H = 88;                  // ~78px row (fav star) + 8px wrapper padding
  const LIST_SCROLL_KEY = 'aurisar-scroll:lib-filtered-list';

  // O(1) row lookups; memoised so rowProps values stay stable between renders
  // (react-window re-renders rows when any rowProps value changes by identity).
  const cartSet = useMemo(() => new Set(cartIds), [cartIds]);
  const favSet = useMemo(() => new Set(profile.favoriteExercises || []), [profile.favoriteExercises]);
  const pbSet = useMemo(() => new Set(Object.keys(profile.exercisePBs || {})), [profile.exercisePBs]);

  // Persist the List's own scrollTop (v2.2.7 has no onScroll prop, but a native
  // onScroll passes through ...rest to the scroller). Throttled.
  const saveListScroll = useCallback(() => {
    if (listSaveTimer.current) return;
    listSaveTimer.current = setTimeout(() => {
      listSaveTimer.current = null;
      const el = listRef.current?.element;
      if (el) { try { sessionStorage.setItem(LIST_SCROLL_KEY, String(el.scrollTop)); } catch { /* private mode */ } }
    }, 120);
  }, []);

  // Restore the List offset on each entry into the filtered view. Retry ladder:
  // the flex height + Supabase catalog merge settle after first paint, so an
  // early write would clamp short.
  useEffect(() => {
    if (libBrowseMode !== 'filtered') return undefined;
    let saved = 0;
    try { saved = parseInt(sessionStorage.getItem(LIST_SCROLL_KEY) || '0', 10) || 0; } catch { /* ignore */ }
    if (saved <= 0) return undefined;
    let cancelled = false;
    const timers = [40, 120, 260, 500].map(d => setTimeout(() => {
      if (cancelled) return;
      const el = listRef.current?.element;
      if (el && el.scrollHeight > el.clientHeight && Math.abs(el.scrollTop - saved) > 2) el.scrollTop = saved;
    }, d));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [libBrowseMode]);

  // Lock the shared .scroll-area into a non-scrolling flex column while the
  // filtered view is up, so the List is the ONLY scroller (kills scroll-in-
  // scroll). useLayoutEffect so the class is removed BEFORE useScrollRestore's
  // useEffect re-resolves its scroller on the return-to-home transition.
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest('.scroll-area');
    if (!scroller) return undefined;
    if (libBrowseMode === 'filtered') {
      scroller.classList.add('lib-list-locked');
      return () => scroller.classList.remove('lib-list-locked');
    }
    scroller.classList.remove('lib-list-locked');
    return undefined;
  }, [libBrowseMode]);

  // Tidy the throttle timer on unmount.
  useEffect(() => () => clearTimeout(listSaveTimer.current), []);

  // Toggling a filter deliberately does NOT reset the page depth. The list is
  // sliced to libVisibleCount, so a narrower result set just renders shorter;
  // resetting only threw away the scroll position of anyone tweaking a filter
  // after paging deep into the catalog.
  const toggleSet = (setter, val) => {
    setter(s => {
      const n = new Set(s);
      n.has(val) ? n.delete(val) : n.add(val);
      return n;
    });
  };
  // Full reset: wipe filters + search AND leave the filtered view. This is the
  // destructive "Clear all filters" / filter-chip path — distinct from the
  // non-destructive "← Browse Library" back, which only changes the view.
  const clearAll = () => {
    setLibTypeFilters(new Set());
    setLibMuscleFilters(new Set());
    setLibEquipFilters(new Set());
    setSearch("");
    setLibSearchDebounced("");
    setLibBrowseMode("home");
  };
  const hasFilters = libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0 || !!search;
  const activeFilterCount = libTypeFilters.size + libMuscleFilters.size + libEquipFilters.size;
  // Resume-chip state: the non-destructive "← Browse Library" keeps BOTH
  // filters and the search term, so the home chip must appear for a search-only
  // browse too — not just active facets.
  const trimmedSearch = search.trim();
  const hasResumeState = activeFilterCount > 0 || trimmedSearch.length > 0;
  const resumeSummary = [
    activeFilterCount > 0 ? `${activeFilterCount} filter${activeFilterCount !== 1 ? "s" : ""}` : null,
    trimmedSearch ? `“${trimmedSearch}”` : null,
  ].filter(Boolean).join(" · ");
  const resumeIcon = activeFilterCount > 0 ? "⚙" : "🔍";
  // Aliased so the JSX below stays close to the pre-extraction shape.
  const MUSCLE_OPTS = libMuscleOpts;
  const EQUIP_OPTS = libEquipOpts;
  const toggleSel = toggleCart;

  // Stable across renders so the memoized ExerciseRow isn't handed a fresh
  // closure every keystroke — otherwise every visible row re-renders on each
  // filter tweak even though nothing about the row changed.
  const toggleFav = useCallback(id => setProfile(p => ({
    ...p,
    favoriteExercises: (p.favoriteExercises || []).includes(id)
      ? (p.favoriteExercises || []).filter(i => i !== id)
      : [...(p.favoriteExercises || []), id]
  })), [setProfile]);

  /* ── Home view computed data ── */
  const MUSCLE_CARD_DATA = libMuscleCardData;

  // Recent exercises — deduped from log, padded with favorites. Memoized so
  // the dedup walk doesn't repeat on every render of the tab; deps are the
  // log + favorites + lookup map.
  // Each card also carries how long it's been since you last did it, so the
  // carousel reports freshness instead of showing the same few names forever:
  // recent entries sit at full strength and stale ones visibly fade.
  const yourExercises = useMemo(() => {
    const now = Date.now();
    const out = [];
    const seenIds = new Set();
    const daysSince = ts => {
      const t = ts ? new Date(ts).getTime() : NaN;
      return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
    };
    for (const entry of (profile.log || []).slice(0, 100)) {
      if (entry.exId && !seenIds.has(entry.exId) && allExById[entry.exId]) {
        seenIds.add(entry.exId);
        out.push({ ex: allExById[entry.exId], days: daysSince(entry.date || entry.ts || entry.dateKey) });
      }
      if (out.length >= 10) break;
    }
    // Favorites pad the row out but have no "last done" date of their own.
    for (const fId of profile.favoriteExercises || []) {
      if (!seenIds.has(fId) && allExById[fId]) {
        seenIds.add(fId);
        out.push({ ex: allExById[fId], days: null });
      }
      if (out.length >= 10) break;
    }
    return out;
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

  // Select mode is signalled by a status banner and the rows' own checkbox
  // affordance, not by repainting the whole tab to a colder palette — a
  // full-surface theme swap to communicate a mode change reads as clunky.
  return <div ref={rootRef} className={libBrowseMode === "filtered" ? "lib-tab-root lib-tab-root--filtered" : "lib-tab-root"}> {
      /* Sticky search bar — translucent material */
    }
    <div className={"lib-sticky-search"}>{libSelectMode && <div className={"lib-select-banner"} role="status">
        <span>{"⊞ Selecting"}</span>
        <span className={"lib-select-banner-count"}>{cartIds.length === 0 ? "tap rows to stage" : `${cartIds.length} staged`}</span>
      </div>}<div style={{
        display: "flex",
        gap: S.s8,
        alignItems: "center"
      }}><div className={"tech-search-wrap"} style={{
          flex: 1,
          marginBottom: S.s0
        }}><span className={"tech-search-icon"}>{"🔍"}</span><input className={"tech-search-inp"} placeholder={`Search ${libKitCount} exercises…`} value={search} onChange={e => {
            const v = e.target.value;
            setSearch(v);
            debouncedSetLibSearch(v);
            if (v && libBrowseMode === "home") setLibBrowseMode("filtered");
          }} />{search && <button type={"button"} aria-label={"Clear search"} className={"tech-search-clear"} onClick={() => {
            setSearch("");
            setLibSearchDebounced("");
            if (libMuscleFilters.size === 0 && libTypeFilters.size === 0 && libEquipFilters.size === 0) setLibBrowseMode("home");
          }}>{"✕"}</button>}</div>{libBrowseMode === "filtered" && <button onClick={() => {
          // Cancel leaves select mode only. It used to clear the cart, but the
          // cart persists across tabs and reloads, so that silently destroyed a
          // basket the user may have staged from another surface entirely.
          // Discarding is the tray's explicit "Clear staging".
          setLibSelectMode(m => !m);
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
        }}>{libSelectMode ? "✕ Cancel" : "⊞ Select"}</button>}</div></div>{
    /* Catalog status — the bundled list renders immediately and Supabase
       merges in extra exercises a moment later. Previously that arrival was
       silent (the search placeholder count just jumped) and a failed fetch
       was silent too, leaving the user browsing a smaller library with no
       explanation. */
    }
    {!_exReady && <div className={"lib-catalog-note"} role="status">
      <span className={"lib-catalog-spinner"} aria-hidden="true" />
      {"Loading the full catalog…"}
    </div>}
    {_exReady && _exLoadError && !catalogNoteDismissed && <div className={"lib-catalog-note lib-catalog-note-warn"} role="status">
      <span aria-hidden="true">{"⚠"}</span>
      <span style={{ flex: 1 }}>{`Showing the offline catalog (${allExercises.length} exercises) — couldn't reach the server, so newer additions may be missing.`}</span>
      <button type="button" onClick={() => setCatalogNoteDismissed(true)} aria-label="Dismiss" style={{
        background: "transparent", border: "none", color: "inherit",
        cursor: "pointer", fontSize: FS.fs78, lineHeight: 1, padding: S.s2
      }}>{"✕"}</button>
    </div>}{
    /* Gym kit sits above both views, not just the filtered one. It shrinks
       the home view's muscle tiles and discover rows too, so scoping it to
       the filtered list would leave tiles vanishing with no visible cause and
       no way to switch it off from where you noticed. */
    }
    <GymKitBar gymKit={gymKit} setGymKit={setGymKit} totalShown={libKitCount} totalAll={kitTotalAll} />
    {/* ═══ HOME VIEW ═══ */
    libBrowseMode === "home" && <div>{/* Resume chip — active filters survive a
      non-destructive "← Browse Library", so make them visible and one tap from
      the results they'd show. */
      hasResumeState && <button type={"button"} className={"lib-resume-chip"} onClick={() => setLibBrowseMode("filtered")}>
        <span aria-hidden="true">{resumeIcon}</span>
        <span className={"lib-resume-chip-label"}>{`${resumeSummary} — View ${libFiltered.length} result${libFiltered.length !== 1 ? "s" : ""} →`}</span>
        <span role={"button"} tabIndex={0} aria-label={"Clear filters and search"} className={"lib-resume-chip-x"} onClick={e => { e.stopPropagation(); clearAll(); }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); clearAll(); } }}>{"✕"}</span>
      </button>}{/* Your Exercises — hero carousel */
      yourExercises.length > 0 && <div className={"lib-home-section"} style={{
        marginBottom: S.s4
      }}><div className={"lib-section-hdr"}><span className={"lib-hdr-icon"}>{"⚔️"}</span>{"Your Exercises"}</div><div className={"lib-hscroll-wrap"}><div className={"lib-hscroll"} onScroll={handleHScroll}>{yourExercises.map(({ ex, days }) => {
              const mgColor = getMuscleColor(ex.muscleGroup);
              const mgLabel = (MUSCLE_META[(ex.muscleGroup || "").toLowerCase()] || {}).label || ex.muscleGroup || "";
              // 0 days = full torchlight, 21+ days = fully faded. Drives a
              // CSS filter so the card itself carries the recency signal.
              const staleness = days == null ? 0.55 : Math.min(1, days / 21);
              return <button type="button" key={"yr-" + ex.id} className={"lib-hero-card"} aria-label={`${ex.name}${days == null ? "" : days === 0 ? ", done today" : days === 1 ? ", done yesterday" : `, last done ${days} days ago`}`} onClick={() => setLibDetailEx(ex)} style={{
                '--mg-color': mgColor,
                '--staleness': staleness
              }}><div className={"lib-hero-orb"} style={{
                  '--mg-color': mgColor
                }}><ExIcon ex={ex} size={"1.4rem"} color={mgColor} /></div><span className={"lib-hero-name"}>{ex.name}</span>{days != null && <span className={"lib-hero-when"}>{days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`}</span>}{mgLabel && <span className={"lib-muscle-pill"} style={{
                  '--mg-color': mgColor
                }}>{mgLabel}</span>}</button>;
            })}</div></div></div>}{yourExercises.length > 0 && <div className={"lib-divider"} />} {
        /* Browse by Muscle — feature tiles */
      }
      {browseView === "map"
        ? <MuscleMap data={libMuscleMapData} onPick={pickMuscle} viewToggle={heatToggle} />
        : <MuscleTorchStrip data={libMuscleMapData} onPick={pickMuscle} viewToggle={heatToggle} />}
      {libMuscleMapData.some(d => d.state !== "cold") && <div className={"lib-divider"} />}

      <div className={"lib-home-section"} style={{
        marginBottom: S.s4
      }}><div className={"lib-section-hdr"} style={{ display: "flex", alignItems: "center" }}><span className={"lib-hdr-icon"}>{"🗺️"}</span>{"Browse by Muscle"}</div><div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: S.s10
        }}>{MUSCLE_CARD_DATA.map(({
            mg,
            label,
            emoji,
            count,
            color
          }) => <button type="button" key={"mc-" + mg} className={"lib-muscle-tile"} aria-label={`${label}, ${count} exercises`} onClick={() => {
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
              }}>{count + " exercises"}</div></div></button>)}</div></div><div className={"lib-divider"} />{/* Discover Rows — Netflix-style horizontal scroll */
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
              return <button type="button" key={"d-" + ex.id} className={"lib-discover-card"} aria-label={ex.name} onClick={() => setLibDetailEx(ex)} style={{
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
                  }}>{(ex.baseXP || 0) + " XP"}</span></div></button>;
            })}</div></div></div>)}</div>}{/* ═══ FILTERED VIEW ═══ */
    libBrowseMode === "filtered" && <div className={"lib-filtered-view"}> {
        /* Back to browse */
      }
      <div style={{
        marginBottom: S.s10
      }}><button onClick={() => setLibBrowseMode("home")} style={{
          background: "transparent",
          border: "none",
          color: "#b4ac9e",
          fontSize: FS.fs78,
          cursor: "pointer",
          padding: "8px 0",
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          gap: S.s4
        }}>{"← Browse Library"}</button></div>
 {
        /* Filter dropdowns row — custom panels that stay open for multi-select */
      }
      <div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s10,
        flexWrap: "wrap",
        position: "relative"
      }}>{/* Close-on-outside-click overlay */
        libOpenDrop && <div aria-hidden={"true"} onClick={() => setLibOpenDrop(null)} style={{
          position: "fixed",
          inset: 0,
          zIndex: Z.scrim
        }} />}
        <FilterDropdown
          id="type"
          label="Type"
          shortLabel="Type"
          options={TYPE_OPTS}
          optionLabel={v => TYPE_LABELS[v]}
          selected={libTypeFilters}
          counts={libTypeCounts}
          onToggle={v => toggleSet(setLibTypeFilters, v)}
          open={libOpenDrop === "type"}
          setOpen={setLibOpenDrop}
          accent="#C4A044"
          optionAccent={getTypeColor}
          panelBorder="rgba(180,172,158,.07)"
        />
        <FilterDropdown
          id="muscle"
          label="Muscle Group"
          shortLabel="Muscle"
          options={MUSCLE_OPTS}
          optionLabel={muscleLabel}
          selected={libMuscleFilters}
          counts={libMuscleCounts}
          onToggle={m => toggleSet(setLibMuscleFilters, m)}
          open={libOpenDrop === "muscle"}
          setOpen={setLibOpenDrop}
          accent="#7A8F8B"
          optionAccent={getMuscleColor}
          panelBorder="rgba(122,143,139,.25)"
        />
        <FilterDropdown
          id="equip"
          label="Equipment"
          shortLabel="Equip"
          options={EQUIP_OPTS}
          optionLabel={eq => eq.charAt(0).toUpperCase() + eq.slice(1)}
          selected={libEquipFilters}
          counts={libEquipCounts}
          onToggle={eq => toggleSet(setLibEquipFilters, eq)}
          open={libOpenDrop === "equip"}
          setOpen={setLibOpenDrop}
          accent={UI_COLORS.accent}
          panelBorder="rgba(196,148,40,0.25)"
        />
      </div>{/* Active filter tags — show what's selected, tap to remove */
      (libTypeFilters.size > 0 || libMuscleFilters.size > 0 || libEquipFilters.size > 0) && <div style={{
        display: "flex",
        gap: S.s6,
        flexWrap: "wrap",
        marginBottom: S.s8
      }}>{[...libTypeFilters].map(v => <button type="button" key={"t" + v} aria-label={`Remove ${TYPE_LABELS[v] || v} filter`} onClick={() => toggleSet(setLibTypeFilters, v)} style={{
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
        }}>{TYPE_LABELS[v] || v}{" ✕"}</button>)}{[...libMuscleFilters].map(v => <button type="button" key={"m" + v} aria-label={`Remove ${muscleLabel(v)} filter`} onClick={() => toggleSet(setLibMuscleFilters, v)} style={{
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
        }}>{muscleLabel(v)}{" ✕"}</button>)}{[...libEquipFilters].map(v => <button type="button" key={"e" + v} aria-label={`Remove ${v} filter`} onClick={() => toggleSet(setLibEquipFilters, v)} style={{
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
        }}>{v.charAt(0).toUpperCase() + v.slice(1)}{" ✕"}</button>)}</div>} {
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
      /* The three-destination action bar used to live here; it is now the
         staging tray's Forge menu (components/StagingTray.jsx), which stays
         reachable after you navigate away from this list. */
      null}  {
        /* Exercise list (paginated) */
      }
      <div className={"lib-vlist-wrap"}>{libFiltered.length === 0
        ? (_exReady
            ? <div className={"empty"} style={{ padding: "24px 0" }}>{"No exercises match your filters."}</div>
            // Nothing matched *yet* only because the catalog is still arriving —
            // an empty-state here would be a lie, so show the shape of the rows.
            : <div aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={"skel" + i} className={"lib-skel-row"}>
                <div className={"lib-skel-orb"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={"lib-skel-line"} style={{ width: `${68 - i * 5}%`, marginBottom: S.s6 }} />
                  <div className={"lib-skel-line"} style={{ width: `${44 - i * 3}%`, height: 7 }} />
                </div>
              </div>)}</div>)
        : <List
            listRef={listRef}
            rowCount={libFiltered.length}
            rowHeight={LIB_ROW_H}
            rowComponent={LibExRow}
            rowProps={{
              exercises: libFiltered,
              cartSet, favSet, pbSet,
              selectable: libSelectMode,
              onOpen: setLibDetailEx,
              onToggleCart: toggleSel,
              onToggleFav: toggleFav,
            }}
            overscanCount={6}
            onScroll={saveListScroll}
            style={{ height: "100%", width: "100%", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}
          />}</div></div>}{
    /* ── end filtered view ──
       The exercise detail bottom sheet used to render here. It now lives at
       the App root as a portal (features/exercises/ExerciseDetailSheet.jsx)
       so it can mark the background inert, take Escape, and be opened from
       any tab — the Plans tab used to open a second, divergent modal for the
       same data. */
    }
  </div>;
});

export default ExerciseLibraryTab;
