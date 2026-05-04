import React, { memo } from 'react';
import { getMapPosition, MapSVG } from '../../components/MapSVG';
import { MAP_REGIONS, UI_COLORS } from '../../data/constants';
import { S, FS, R } from '../../utils/tokens';

/**
 * World map overlay — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Rendered when mapOpen is true. Shows the Auranthel world map with the
 * player's current region, friend positions, travel boost controls, and
 * the region legend.
 */

const MapOverlay = memo(function MapOverlay({
  // Visibility control
  setMapOpen,
  // Player state
  level,
  profile,
  setProfile,
  // Social
  friends,
  // Tooltip state
  mapTooltip,
  setMapTooltip,
  // Callbacks
  showToast,
}) {
  const myPos = getMapPosition(profile.xp, level);
  const myRegion = MAP_REGIONS[myPos.regionIdx];

  const weekStart = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  })();

  const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart;

  const friendPositions = friends.map(f => {
    const fLv = Math.max(1, Math.floor(Math.log(Math.max(1, f.xp || 0) / 100 + 1) * 3));
    const fPos = getMapPosition(f.xp || 0, fLv);
    return { ...f, mapX: fPos.x, mapY: fPos.y, regionIdx: fPos.regionIdx };
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", padding: "14px 12px 30px" }}>

      {/* Header */}
      <div style={{ width: "100%", maxWidth: 420, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: S.s10, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Cinzel Decorative',serif,Arial", fontSize: FS.fs95, color: "#b4ac9e", letterSpacing: ".08em" }}>{"⚔️ Auranthel"}</div>
          <div style={{ fontSize: FS.fs65, color: "#8a8478", marginTop: S.s2, display: "flex", gap: S.s8, alignItems: "center", flexWrap: "wrap" }}>
            <span>{myRegion.icon}{" "}{myRegion.name}{" · Level "}{level}</span>
            <span style={{ color: "#b4ac9e" }}>{myRegion.boost.emoji}{" +7% "}{myRegion.boost.label}</span>
            {travelActive && <span style={{ color: UI_COLORS.success }}>{"⚡ +10% Travel"}</span>}
          </div>
        </div>
        <button className={"btn btn-ghost btn-sm"} onClick={() => { setMapOpen(false); setMapTooltip(null); }}>{"✕"}</button>
      </div>

      {/* Zoom controls + map */}
      <MapSVG myPos={myPos} myRegion={myRegion} friendPositions={friendPositions} mapTooltip={mapTooltip} setMapTooltip={setMapTooltip} travelActive={travelActive} profile={profile} />

      {/* Tooltip / travel panel */}
      {mapTooltip && (
        <div style={{ width: "100%", maxWidth: 420, marginTop: S.s10, background: "rgba(10,8,4,.97)", border: "1px solid rgba(180,172,158,.08)", borderRadius: R.r10, padding: "12px 14px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: S.s8 }}>
            <div>
              <div style={{ fontSize: FS.fs84, color: "#d4cec4", fontWeight: 600 }}>{mapTooltip.name}</div>
              <div style={{ fontSize: FS.fs65, color: "#8a8478", marginTop: S.s2 }}>{mapTooltip.cls || "Unknown"}{" · "}{mapTooltip.region}</div>
            </div>
            <button className={"btn btn-ghost btn-xs"} onClick={() => setMapTooltip(null)}>{"✕"}</button>
          </div>
          {!mapTooltip.alreadyTraveling ? (
            <div>
              <div style={{ fontSize: FS.fs68, color: "#8a8478", marginBottom: S.s8, lineHeight: 1.5 }}>
                {"Travel to their location for "}<strong style={{ color: "#b4ac9e" }}>{"+10% XP boost"}</strong>{" on all workouts this week."}
              </div>
              <button className={"btn btn-gold"} style={{ width: "100%", fontSize: FS.lg }} onClick={() => {
                const ws = (() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() - d.getDay());
                  return d.toISOString().slice(0, 10);
                })();
                setProfile(p => ({ ...p, travelBoost: { friendId: mapTooltip.id, friendName: mapTooltip.name, weekStart: ws } }));
                showToast(`⚔️ Traveling with ${mapTooltip.name}! +10% XP this week.`);
                setMapTooltip(null);
              }}>{"⚔️ Travel with "}{mapTooltip.name}</button>
            </div>
          ) : (
            <div style={{ fontSize: FS.fs68, color: profile.travelBoost?.friendId === mapTooltip.id ? UI_COLORS.success : "#8a8478", textAlign: "center", padding: "6px 0" }}>
              {profile.travelBoost?.friendId === mapTooltip.id
                ? "✓ You are traveling with this warrior this week"
                : `Already traveling with ${profile.travelBoost?.friendName} this week`}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ width: "100%", maxWidth: 420, marginTop: S.s12, flexShrink: 0 }}>
        <div style={{ fontSize: FS.sm, color: "#8a8478", marginBottom: S.s6, letterSpacing: ".06em", textTransform: "uppercase" }}>{"Your Journey"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: S.s6 }}>
          {MAP_REGIONS.map((r, i) => {
            const isVisited = i <= myPos.regionIdx;
            const isCurrent = i === myPos.regionIdx;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: S.s6, padding: "4px 8px", background: isCurrent ? "rgba(45,42,36,.2)" : "rgba(45,42,36,.12)", border: `1px solid ${isCurrent ? "rgba(180,172,158,.15)" : isVisited ? "rgba(45,42,36,.22)" : "rgba(45,42,36,.18)"}`, borderRadius: R.md, opacity: isVisited ? 1 : .4 }}>
                <span style={{ fontSize: FS.lg }}>{r.icon}</span>
                <div>
                  <div style={{ fontSize: FS.sm, color: isCurrent ? "#b4ac9e" : isVisited ? "#d4cec4" : "#5a6060", lineHeight: 1.2 }}>
                    {r.name}{isCurrent && <span style={{ color: "#b4ac9e", marginLeft: S.s4 }}>{"◀"}</span>}
                  </div>
                  <div style={{ fontSize: FS.fs52, color: isCurrent ? "#b4ac9e" : isVisited ? "#8a8478" : "#3a4040", lineHeight: 1.2 }}>
                    {r.boost.emoji}{" "}{r.boost.label}{" +7% · Lv"}{r.levels[0]}{"–"}{r.levels[1]}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active travel banner */}
      {travelActive && (
        <div style={{ width: "100%", maxWidth: 420, marginTop: S.s10, padding: "10px 14px", background: "rgba(46,204,113,.06)", border: "1px solid rgba(46,204,113,.2)", borderRadius: R.r10, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: FS.lg, color: UI_COLORS.success }}>{"⚡ Travel Boost Active"}</div>
            <div style={{ fontSize: FS.fs62, color: "#8a8478", marginTop: S.s2 }}>
              {"With "}<strong style={{ color: "#d4cec4" }}>{profile.travelBoost.friendName}</strong>{" · +10% XP all workouts this week"}
            </div>
          </div>
          <button className={"btn btn-ghost btn-xs"} style={{ fontSize: FS.sm, color: UI_COLORS.danger, borderColor: "rgba(231,76,60,.3)" }} onClick={() => {
            setProfile(p => ({ ...p, travelBoost: null }));
            showToast("Travel ended.");
          }}>{"End"}</button>
        </div>
      )}

    </div>
  );
});

export default MapOverlay;
