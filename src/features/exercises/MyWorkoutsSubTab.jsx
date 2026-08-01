import React, { memo, useMemo, useRef, useState } from 'react';
import { UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';
import { diffColor, diffBg } from './difficulty';
import { entryTime } from './logEntryTime';

/**
 * My Exercises sub-tab — extracted from the inline block in App.jsx as part
 * of Finding #6 (App.jsx decomposition) per docs/performance-audit.md
 * (PR #116); reorganized into 3 accordion sections (Favorites, Custom,
 * Recent) to absorb the "quickly find an exercise you already know" job
 * that the Library tab's removed "Your Exercises" carousel used to cover.
 *
 * Rendered when exSubTab === "myworkouts" inside the Exercises tab.
 * Pure presentational; all state and setters are threaded in as props.
 */

// Favourites render in pages rather than all at once — the list is unbounded
// and every row does a lookup + colour derivation.
const FAV_PAGE = 20;
// "Recent" is a fixed-size window, not a paginated list — 5 distinct
// exercises is the whole point (a quick glance, not a browse).
const RECENT_COUNT = 5;

// ── Accordion primitive ──────────────────────────────────────────────────
// Single-open-or-none: tapping an open section's own header closes it;
// tapping a different header opens it and closes whichever was open. The
// tapped header's own position never moves — only the content BELOW it
// shifts, via a grid-template-rows 0fr/1fr track (no measured height, so
// content that grows after opening — e.g. Favorites' "Show more" — is
// never clipped by a stale max-height). Collapsed bodies are `inert` so a
// closed section's buttons drop out of the tab order and off screen
// readers, and a header about to be covered by a sibling's inert body
// receives focus explicitly rather than being silently stranded.
function AccordionSection({ id, title, icon, meta, isOpen, onToggle, headerRef, children }) {
  return (
    <div className={"myex-accordion"}>
      <button
        type="button"
        ref={headerRef}
        className={"myex-accordion-hdr"}
        aria-expanded={isOpen}
        onClick={() => onToggle(id)}
      >
        <span aria-hidden="true" className={"myex-accordion-hdr-icon"}>{icon}</span>
        <span className={"myex-accordion-hdr-title"}>{title}</span>
        {meta && <span className={"myex-accordion-hdr-meta"}>{meta}</span>}
        <span aria-hidden="true" className={`myex-accordion-chevron${isOpen ? " open" : ""}`}>{"⌄"}</span>
      </button>
      <div className={`myex-accordion-track${isOpen ? " open" : ""}`}>
        <div className={"myex-accordion-body"} inert={!isOpen}>
          <div className={"myex-accordion-inner"}>{children}</div>
        </div>
      </div>
    </div>
  );
}

const MyWorkoutsSubTab = memo(function MyWorkoutsSubTab({
  // Profile data
  profile,
  setProfile,
  // Exercise data
  allExById,
  // Favorite-select multi-select state
  favSelectMode,
  setFavSelectMode,
  isInCart,
  toggleCart,
  // Sub-tab / detail navigation
  setLibDetailEx,
  // Exercise editor actions
  openExEditor,
  deleteCustomEx,
}) {
  const [favVisibleCount, setFavVisibleCount] = useState(FAV_PAGE);
  const [openSection, setOpenSection] = useState("favorites"); // "favorites"|"custom"|"recent"|null
  // Captured once per mount (the sub-tab remounts on every subtab switch, so
  // this can't go meaningfully stale) rather than read inside the memo below
  // — a bare Date.now() inside useMemo is exactly the "silently stale
  // wall-clock snapshot" pattern the purity lint rule exists to catch.
  const [recentNow] = useState(() => Date.now());

  const favHeaderRef = useRef(null);
  const customHeaderRef = useRef(null);
  const recentHeaderRef = useRef(null);
  const headerRefs = { favorites: favHeaderRef, custom: customHeaderRef, recent: recentHeaderRef };

  const toggleSection = id => {
    setOpenSection(prev => {
      const next = prev === id ? null : id;
      // If focus currently lives inside the section that's about to collapse
      // (i.e. any section other than `next`), move it to that section's own
      // header before the body goes inert — otherwise a keyboard user's
      // focus is left stranded in a zero-height, untabbable subtree.
      if (prev && prev !== next && document.activeElement) {
        const prevRef = headerRefs[prev];
        const prevBody = prevRef?.current?.closest(".myex-accordion")?.querySelector(".myex-accordion-body");
        if (prevBody?.contains(document.activeElement)) prevRef.current?.focus();
      }
      return next;
    });
  };

  // Recent — 5 most recent DISTINCT exercises (never 5 raw log rows: a
  // single heavy session would otherwise fill every slot with one lift).
  // Guards allExById the same way the removed carousel did — deleted custom
  // exercises linger in profile.log, and a row for `undefined` would crash
  // the tab rather than just being skipped.
  const recentExercises = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const entry of profile.log || []) {
      if (!entry.exId || seen.has(entry.exId) || !allExById[entry.exId]) continue;
      seen.add(entry.exId);
      const t = entryTime(entry);
      const days = Number.isFinite(t) ? Math.max(0, Math.floor((recentNow - t) / 86400000)) : null;
      out.push({ ex: allExById[entry.exId], days });
      if (out.length >= RECENT_COUNT) break;
    }
    return out;
  }, [profile.log, allExById, recentNow]);

  const favCount = (profile.favoriteExercises || []).length;
  const customCount = (profile.customExercises || []).length;

  return (
    <div>
      {/* ── Favorites ─────────────────────────────────── */}
      <AccordionSection
        id="favorites"
        title="Favorites"
        icon="⭐"
        meta={favCount || null}
        isOpen={openSection === "favorites"}
        onToggle={toggleSection}
        headerRef={favHeaderRef}
      >
        {favCount > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: S.s10 }}>
            <button
              onClick={() => {
                // Exits select mode only — see ExerciseLibraryTab: the cart is
                // persistent, so Cancel must not discard it.
                setFavSelectMode(!favSelectMode);
              }}
              style={{
                background: favSelectMode ? "rgba(45,42,36,.3)" : "transparent",
                border: "1px solid " + (favSelectMode ? "rgba(180,172,158,.15)" : "rgba(180,172,158,.06)"),
                color: favSelectMode ? "#d4cec4" : "#8a8478",
                fontSize: FS.sm,
                padding: "4px 10px",
                borderRadius: R.md,
                cursor: "pointer"
              }}
            >
              {favSelectMode ? "✕ Cancel" : "☐ Select"}
            </button>
          </div>
        )}

        {/* The three-destination action bar moved to the staging tray at the
            App root, so a selection started here survives leaving this list. */}

        {favCount === 0 ? (
          <div className={"empty"} style={{ padding: "16px 0" }}>
            {"No favorites yet — tap ⭐ on any exercise."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: S.s6 }}>
            {(profile.favoriteExercises || []).slice(0, favVisibleCount).map(exId => {
              const ex = allExById[exId];
              if (!ex) return null;
              const hasPB = !!(profile.exercisePBs || {})[ex.id];
              const isSel = isInCart(exId);
              return (
                <div
                  key={exId}
                  className={"stretch-row"}
                  style={{
                    background: isSel ? "rgba(45,42,36,.3)" : "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid " + (isSel ? "rgba(180,172,158,.2)" : "rgba(180,172,158,.05)"),
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    boxShadow: isSel ? "0 0 0 1.5px rgba(180,172,158,.2)" : "none",
                    transition: "all .15s"
                  }}
                >
                  {favSelectMode && (
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: R.r5,
                      flexShrink: 0,
                      border: "1.5px solid " + (isSel ? "rgba(180,172,158,.3)" : "rgba(180,172,158,.08)"),
                      background: isSel ? "rgba(45,42,36,.35)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>
                      {isSel && <span style={{ color: "#b4ac9e", fontSize: FS.fs65 }}>{"✓"}</span>}
                    </div>
                  )}
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: R.lg,
                    flexShrink: 0,
                    background: "rgba(45,42,36,.15)",
                    border: "1px solid rgba(180,172,158,.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s6,
                      flexWrap: "wrap",
                      marginBottom: S.s4
                    }}>
                      <button
                        type="button"
                        className={"picker-ex-main"}
                        aria-pressed={favSelectMode ? isSel : undefined}
                        aria-label={favSelectMode ? `Stage ${ex.name}` : `Open ${ex.name}`}
                        onClick={() => (favSelectMode ? toggleCart(exId) : setLibDetailEx(ex))}
                        style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}
                      >{ex.name}</button>
                      {hasPB && <span style={{ fontSize: FS.sm }}>{"🏆"}</span>}
                    </div>
                    <div style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
                      {ex.category && (
                        <span style={{ color: getTypeColor(ex.category) }}>
                          {ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}
                        </span>
                      )}
                      {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
                      {ex.muscleGroup && (
                        <span style={{ color: getMuscleColor(ex.muscleGroup) }}>
                          {ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  {!favSelectMode && (
                    <div style={{
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: S.s6
                    }}>
                      <span style={{ fontSize: FS.fs66, fontWeight: 700, color: "#b4ac9e", letterSpacing: ".02em" }}>
                        {ex.baseXP + " XP"}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setProfile(p => ({
                            ...p,
                            favoriteExercises: (p.favoriteExercises || []).filter(i => i !== exId)
                          }));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#b4ac9e",
                          fontSize: FS.fs90,
                          cursor: "pointer",
                          padding: S.s0,
                          lineHeight: 1
                        }}
                        aria-pressed={true}
                        aria-label={`Remove ${ex.name} from favourites`}
                      >{"⭐"}</button>
                    </div>
                  )}
                  {favSelectMode && (
                    <div style={{ flexShrink: 0 }}>
                      <span style={{ fontSize: FS.fs66, fontWeight: 700, color: "#b4ac9e" }}>
                        {ex.baseXP + " XP"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {/* The list used to hard-slice at 20 with no indication, so
                favourite #21 onwards simply vanished. */}
            {favCount > favVisibleCount && (
              <button
                type="button"
                onClick={() => setFavVisibleCount(c => c + FAV_PAGE)}
                style={{
                  background: "rgba(45,42,36,.2)",
                  border: "1px solid rgba(180,172,158,.08)",
                  color: "#b4ac9e",
                  padding: "9px",
                  borderRadius: R.lg,
                  fontSize: FS.md,
                  cursor: "pointer",
                  marginTop: S.s2
                }}
              >{`Show more (${favVisibleCount} of ${favCount})`}</button>
            )}
          </div>
        )}
      </AccordionSection>

      {/* ── Custom Exercises ───────────────────────────── */}
      <AccordionSection
        id="custom"
        title="Custom"
        icon="🛠"
        meta={customCount || null}
        isOpen={openSection === "custom"}
        onToggle={toggleSection}
        headerRef={customHeaderRef}
      >
        {customCount === 0 ? (
          <div className={"empty"} style={{ padding: "12px 0" }}>{"No custom exercises yet."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: S.s6 }}>
            {(profile.customExercises || []).map(ex => {
              const hasPB = !!(profile.exercisePBs || {})[ex.id];
              const isFav = (profile.favoriteExercises || []).includes(ex.id);
              const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
              const rowDiffColor = diffColor(diffLabel);
              return (
                <div
                  key={ex.id}
                  className={"stretch-row"}
                  style={{
                    background: "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid rgba(180,172,158,.05)",
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    transition: "all .18s"
                  }}
                >
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: R.lg,
                    flexShrink: 0,
                    background: "rgba(45,42,36,.15)",
                    border: "1px solid rgba(180,172,158,.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s6,
                      flexWrap: "wrap",
                      marginBottom: S.s4
                    }}>
                      <button
                        type="button"
                        className={"picker-ex-main"}
                        aria-label={`Open ${ex.name}`}
                        onClick={() => setLibDetailEx(ex)}
                        style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}
                      >{ex.name}</button>
                      <span className={"custom-ex-badge"} style={{ marginLeft: S.s2 }}>{"custom"}</span>
                      {hasPB && <span style={{ fontSize: FS.sm }}>{"🏆"}</span>}
                    </div>
                    <div style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
                      {ex.category && (
                        <span style={{ color: getTypeColor(ex.category) }}>
                          {ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}
                        </span>
                      )}
                      {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
                      {ex.muscleGroup && (
                        <span style={{ color: getMuscleColor(ex.muscleGroup) }}>
                          {ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: S.s6 }}>
                    <span style={{ fontSize: FS.fs66, fontWeight: 700, color: "#b4ac9e", letterSpacing: ".02em" }}>
                      {ex.baseXP + " XP"}
                    </span>
                    {diffLabel && (
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: R.r4,
                        fontSize: FS.fs58,
                        fontWeight: 700,
                        letterSpacing: ".05em",
                        color: rowDiffColor,
                        background: diffBg(diffLabel)
                      }}>{diffLabel}</span>
                    )}
                    <div style={{ display: "flex", gap: S.s6, alignItems: "center" }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openExEditor("edit", ex);
                        }}
                        style={{
                          background: "rgba(45,42,36,.25)",
                          border: "1px solid rgba(180,172,158,.08)",
                          color: "#8a8478",
                          fontSize: FS.fs55,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: R.r5,
                          fontFamily: "'Barlow',sans-serif"
                        }}
                      aria-label={`Edit ${ex.name}`}>{"✎ edit"}</button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          deleteCustomEx(ex.id);
                        }}
                        style={{
                          background: "rgba(46,20,20,.3)",
                          border: "1px solid rgba(231,76,60,.15)",
                          color: UI_COLORS.danger,
                          fontSize: FS.fs55,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: R.r5
                        }}
                      aria-label={`Delete ${ex.name}`}>{"🗑"}</button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setProfile(p => ({
                            ...p,
                            favoriteExercises: isFav
                              ? (p.favoriteExercises || []).filter(i => i !== ex.id)
                              : [...(p.favoriteExercises || []), ex.id]
                          }));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: isFav ? "#d4cec4" : "#8a8478",
                          fontSize: FS.fs90,
                          cursor: "pointer",
                          padding: S.s0,
                          lineHeight: 1
                        }}
                      aria-pressed={isFav}
                      aria-label={isFav ? `Remove ${ex.name} from favourites` : `Add ${ex.name} to favourites`}>{isFav ? "⭐" : "☆"}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={() => openExEditor("create", null)}
          style={{
            marginTop: S.s10,
            width: "100%",
            background: "transparent",
            border: "1px dashed rgba(180,172,158,.08)",
            color: "#b4ac9e",
            borderRadius: R.xl,
            padding: "10px",
            fontSize: FS.fs78,
            cursor: "pointer"
          }}
        >{"＋ Create Custom Exercise"}</button>
      </AccordionSection>

      {/* ── Recent Exercises ────────────────────────────
          5 most recent distinct exercises — the "you know these, log again
          fast" job the Library tab's carousel used to do. Read-only + a
          favourite star; no select-mode (nothing here is being staged for a
          workout, it's a jump-back-in list). */}
      <AccordionSection
        id="recent"
        title="Recent"
        icon="🕐"
        meta={recentExercises.length ? `${recentExercises[0].ex.name}` : null}
        isOpen={openSection === "recent"}
        onToggle={toggleSection}
        headerRef={recentHeaderRef}
      >
        {recentExercises.length === 0 ? (
          <div className={"empty"} style={{ padding: "16px 0" }}>
            {"Nothing logged yet — your last 5 exercises will show up here."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: S.s6 }}>
            {recentExercises.map(({ ex, days }) => {
              const hasPB = !!(profile.exercisePBs || {})[ex.id];
              const isFav = (profile.favoriteExercises || []).includes(ex.id);
              const whenLabel = days == null ? null : days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
              return (
                <div
                  key={ex.id}
                  className={"stretch-row"}
                  style={{
                    background: "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid rgba(180,172,158,.05)",
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    transition: "all .15s"
                  }}
                >
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: R.lg,
                    flexShrink: 0,
                    background: "rgba(45,42,36,.15)",
                    border: "1px solid rgba(180,172,158,.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s6,
                      flexWrap: "wrap",
                      marginBottom: S.s4
                    }}>
                      <button
                        type="button"
                        className={"picker-ex-main"}
                        aria-label={`Open ${ex.name}${whenLabel ? `, last done ${whenLabel}` : ""}`}
                        onClick={() => setLibDetailEx(ex)}
                        style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}
                      >{ex.name}</button>
                      {hasPB && <span style={{ fontSize: FS.sm }}>{"🏆"}</span>}
                    </div>
                    <div style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
                      {ex.category && (
                        <span style={{ color: getTypeColor(ex.category) }}>
                          {ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}
                        </span>
                      )}
                      {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
                      {ex.muscleGroup && (
                        <span style={{ color: getMuscleColor(ex.muscleGroup) }}>
                          {ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: S.s6
                  }}>
                    <span style={{ fontSize: FS.fs62, color: "#8a8478" }}>{whenLabel}</span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setProfile(p => ({
                          ...p,
                          favoriteExercises: isFav
                            ? (p.favoriteExercises || []).filter(i => i !== ex.id)
                            : [...(p.favoriteExercises || []), ex.id]
                        }));
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: isFav ? "#d4cec4" : "#8a8478",
                        fontSize: FS.fs90,
                        cursor: "pointer",
                        padding: S.s0,
                        lineHeight: 1
                      }}
                      aria-pressed={isFav}
                      aria-label={isFav ? `Remove ${ex.name} from favourites` : `Add ${ex.name} to favourites`}
                    >{isFav ? "⭐" : "☆"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AccordionSection>
    </div>
  );
});

export default MyWorkoutsSubTab;
