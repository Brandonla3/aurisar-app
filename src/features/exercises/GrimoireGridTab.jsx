import React, { memo } from 'react';
import { getMuscleColor, getTypeColor } from '../../utils/xp';

const GrimoireGridTab = memo(function GrimoireGridTab({
  grimoireFiltered,
  profile,
  setProfile,
  getMult,
  multiMode,
  multiSelEx,
  setMultiSelEx,
  selEx,
  setSelEx,
  setMusclePickerOpen,
  setSets,
  setReps,
  setExWeight,
  setWeightPct,
  setDistanceVal,
  setHrZone,
  setExHHMM,
  setExSec,
  setQuickRows,
  setDetailEx,
  setDetailImgIdx,
  openExEditor,
}) {
  const favs = profile.favoriteExercises || [];

  const toggleFav = (e, exId) => {
    e.stopPropagation();
    setProfile(p => ({
      ...p,
      favoriteExercises: (p.favoriteExercises || []).includes(exId)
        ? (p.favoriteExercises || []).filter(id => id !== exId)
        : [...(p.favoriteExercises || []), exId]
    }));
  };

  return <>
    {grimoireFiltered.length === 0 && <div className={"empty"} style={{ padding: "20px 0" }}>{"No techniques found in the grimoire."}</div>}
    <div className={"grimoire-grid"}>
      <div className={"grimoire-card grimoire-add-card"} onClick={() => openExEditor("create", null)}>
        <span className={"grim-add-icon"}>{"＋"}</span>
        <span className={"grim-add-label"}>{"New Technique"}</span>
      </div>
      {grimoireFiltered.map(ex => {
        const m = getMult(ex), isB = m > 1.02, isP = m < 0.98;
        const isMultiSel = multiSelEx.has(ex.id);
        const isFav = favs.includes(ex.id);
        const catColor = getTypeColor(ex.category);
        return <div key={ex.id}
          className={`grimoire-card ${multiMode && isMultiSel ? "grim-multi-sel" : ""} ${!multiMode && selEx === ex.id ? "grim-sel" : ""}`}
          style={{ "--cat-color": catColor }}
          onClick={() => {
            if (multiMode) {
              setMultiSelEx(s => {
                const n = new Set(s);
                n.has(ex.id) ? n.delete(ex.id) : n.add(ex.id);
                return n;
              });
            } else {
              const toggling = selEx === ex.id;
              setSelEx(toggling ? null : ex.id);
              setMusclePickerOpen(false);
              if (!toggling) {
                setSets("");
                setReps("");
                setExWeight("");
                setWeightPct(100);
                setDistanceVal("");
                setHrZone(null);
                setExHHMM("");
                setExSec("");
                setQuickRows([]);
              }
            }
          }}>
          {multiMode && <div className={`grim-checkbox ${isMultiSel ? "checked" : ""}`}>{isMultiSel && "✓"}</div>}
          <div className={`grim-mult ${isB ? "grim-bonus" : isP ? "grim-penalty" : "grim-neutral"}`}>{Math.round(m * 100) + "%"}</div>
          <div className={"grim-icon-orb"} style={{ "--cat-color": catColor }}>
            <span className={"grim-icon"}>{ex.icon}</span>
          </div>
          <div className={"grim-body"}>
            <div className={"grim-name"}>{ex.name}{ex.custom && <span className={"custom-ex-badge"}>{"custom"}</span>}</div>
            <div className={"grim-meta"}>
              <span className={"grim-xp"}>{ex.baseXP + " XP"}</span>
              <span className={"grim-sep"}>{"·"}</span>
              <span className={"grim-muscle"} style={{ color: getMuscleColor(ex.muscleGroup) }}>{ex.muscles || ex.muscleGroup}</span>
            </div>
          </div>
          {!multiMode && <div className={"grim-info-btn"} onClick={e => { e.stopPropagation(); setDetailEx(ex); setDetailImgIdx(0); }}>{"ℹ"}</div>}
          {!multiMode && <div className={`grim-fav-btn ${isFav ? "faved" : ""}`} onClick={e => toggleFav(e, ex.id)}>{isFav ? "⭐" : "☆"}</div>}
        </div>;
      })}
    </div>
  </>;
});

export default GrimoireGridTab;
