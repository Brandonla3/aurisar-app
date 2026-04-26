import React from 'react';
import { MAP_REGIONS, MAP_POINTS, UI_COLORS } from '../data/constants';
import { CLASSES } from '../data/exercises';

function getRegionIdx(level) {
  const idx = Math.floor((Math.max(1,level)-1)/5);
  return Math.min(idx, MAP_REGIONS.length-1);
}

function getMapPosition(xp, level) {
  const regionIdx = getRegionIdx(level);
  const pt = MAP_POINTS[regionIdx];
  const nextPt = MAP_POINTS[Math.min(regionIdx+1, MAP_POINTS.length-1)];
  // Progress within region based on XP mod 1000 (every 1000 XP moves forward)
  const xpInRegion = xp % 5000; // 5 levels ≈ 5000 XP
  const progress = Math.min(xpInRegion / 5000, 0.95);
  return {
    x: pt.x + (nextPt.x - pt.x) * progress,
    y: pt.y + (nextPt.y - pt.y) * progress,
    regionIdx,
  };
}

function MapSVG({myPos,myRegion,friendPositions,mapTooltip,setMapTooltip,travelActive,profile}) {
  const [zoom,setZoom]     = React.useState(1);
  const [pan,setPan]       = React.useState({x:0,y:0});
  const [dragging,setDragging] = React.useState(false);
  const dragStart = React.useRef(null);
  const panStart  = React.useRef({x:0,y:0});
  const svgRef    = React.useRef(null);

  // Clamp pan so map doesn't drift off screen
  function clampPan(x, y, z) {
    const svgW = svgRef.current ? svgRef.current.clientWidth : 360;
    const svgH = svgW * (540/360);
    // Allow panning 60% beyond the map edges so users can freely explore
    const overscroll = 0.6;
    const maxX =  svgW * overscroll;
    const minX = -(360*z - svgW) - svgW * overscroll;
    const maxY =  svgH * overscroll;
    const minY = -(540*z - svgH) - svgH * overscroll;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }

  const ZOOM_STEPS = [1, 1.5, 2];

  function zoomIn() {
    const idx = ZOOM_STEPS.indexOf(zoom);
    const nextZ = idx < ZOOM_STEPS.length-1 ? ZOOM_STEPS[idx+1] : zoom;
    if(nextZ === zoom) return;
    const svgW = svgRef.current ? svgRef.current.clientWidth : 360;
    const svgH = svgW * (540/360);
    const rawX = -(myPos.x/360 * svgW * nextZ - svgW/2);
    const rawY = -(myPos.y/540 * svgH * nextZ - svgH/2);
    setZoom(nextZ); setPan(clampPan(rawX, rawY, nextZ));
  }
  function zoomOut() {
    const idx = ZOOM_STEPS.indexOf(zoom);
    const prevZ = idx > 0 ? ZOOM_STEPS[idx-1] : zoom;
    if(prevZ === 1) { setZoom(1); setPan({x:0,y:0}); return; }
    if(prevZ === zoom) return;
    const svgW = svgRef.current ? svgRef.current.clientWidth : 360;
    const svgH = svgW * (540/360);
    const rawX = -(myPos.x/360 * svgW * prevZ - svgW/2);
    const rawY = -(myPos.y/540 * svgH * prevZ - svgH/2);
    setZoom(prevZ); setPan(clampPan(rawX, rawY, prevZ));
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = {x:e.clientX, y:e.clientY};
    panStart.current  = {...pan};
  }
  function onPointerMove(e) {
    if(!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan(clampPan(panStart.current.x + dx, panStart.current.y + dy, zoom));
  }
  function onPointerUp() {
    setDragging(false);
    dragStart.current = null;
  }

  // Friend click — only fire if we didn't drag
  function onFriendClick(e, f, fCls) {
    if(dragging) return;
    setMapTooltip((mapTooltip?.id)===f.id?null:{
      id:f.id, name:f.playerName,
      region:(MAP_REGIONS[f.regionIdx]?.name),
      cls:(fCls?.name), alreadyTraveling:travelActive,
    });
  }

  return (
    <div style={{ width: "100%", maxWidth: 420, position: "relative", flexShrink: 0 }}>
      {/* Zoom controls */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <button
          className="btn btn-ghost btn-xs"
          style={{ fontSize: ".7rem", minWidth: 32 }}
          disabled={zoom <= ZOOM_STEPS[0]}
          onClick={zoomOut}
          aria-label="Zoom out"
        >−</button>
        <span style={{ fontSize: ".65rem", color: "#8a8478", minWidth: 28, textAlign: "center" }}>{zoom}×</span>
        <button
          className="btn btn-ghost btn-xs"
          style={{ fontSize: ".7rem", minWidth: 32 }}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          onClick={zoomIn}
          aria-label="Zoom in"
        >+</button>
        {zoom > 1 && (
          <button
            className="btn btn-ghost btn-xs"
            style={{ fontSize: ".6rem", color: "#b4ac9e" }}
            onClick={() => {
              const svgW = svgRef.current ? svgRef.current.clientWidth : 360;
              const svgH = svgW * (540 / 360);
              setPan(clampPan(-(myPos.x / 360 * svgW * zoom - svgW / 2), -(myPos.y / 540 * svgH * zoom - svgH / 2), zoom));
            }}
            aria-label="Center map on me"
          >📍 Me</button>
        )}
      </div>
      {/* Map */}
      <div
        ref={svgRef}
        style={{
          background: "#0e1820",
          border: "1px solid rgba(180,172,158,.07)",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 0 40px rgba(0,0,0,.8)",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg
          viewBox="0 0 360 540"
          width="100%"
          style={{
            display: "block",
            transformOrigin: "top left",
            transform: `scale(${zoom}) translate(${pan.x / zoom}px,${pan.y / zoom}px)`,
            transition: dragging ? "none" : "transform .3s ease",
            userSelect: "none",
          }}
        >
          <rect width="360" height="540" fill="#0e1820" />
          {[...Array(18)].map((_, i) => (
            <line key={`h${i}`} x1="0" y1={30 * i} x2="360" y2={30 * i} stroke="rgba(45,42,36,.15)" strokeWidth="1" />
          ))}
          {[...Array(12)].map((_, i) => (
            <line key={`v${i}`} x1={30 * i} y1="0" x2={30 * i} y2="540" stroke="rgba(45,42,36,.15)" strokeWidth="1" />
          ))}
          <rect width="360" height="540" fill="none" stroke="rgba(45,42,36,.18)" strokeWidth="6" />
          {/* Paths */}
          {MAP_POINTS.slice(0, -1).map((pt, i) => {
            const next = MAP_POINTS[i + 1];
            const vis = i < myPos.regionIdx;
            return (
              <line
                key={i}
                x1={pt.x} y1={pt.y} x2={next.x} y2={next.y}
                stroke={vis ? "rgba(180,172,158,.15)" : "rgba(180,172,158,.06)"}
                strokeWidth={vis ? 1.5 : 1}
                strokeDasharray={vis ? "none" : "4,4"}
              />
            );
          })}
          {/* Regions — font sizes increased ~50% */}
          {MAP_POINTS.map((pt, i) => {
            const r = MAP_REGIONS[i];
            const vis = i <= myPos.regionIdx;
            const cur = i === myPos.regionIdx;
            return (
              <g key={r.id}>
                {vis && <circle cx={pt.x} cy={pt.y} r={cur ? 36 : 28} fill={r.glow} opacity={cur ? 0.5 : 0.22} />}
                <circle
                  cx={pt.x} cy={pt.y} r={cur ? 28 : 22}
                  fill={vis ? r.color : "#1a2530"}
                  stroke={cur ? "#b4ac9e" : vis ? "rgba(180,172,158,.3)" : "rgba(45,42,36,.26)"}
                  strokeWidth={cur ? 2 : 1}
                />
                {!vis && <circle cx={pt.x} cy={pt.y} r={24} fill="rgba(14,24,32,.55)" strokeWidth="0" />}
                {/* Icon */}
                <text x={pt.x} y={pt.y - 6} textAnchor="middle" fontSize={cur ? 17 : 13} opacity={vis ? 1 : 0.65}>{r.icon}</text>
                {/* Region name — 50% bigger: was 6.5 → now 9.5 */}
                <text
                  x={pt.x} y={pt.y + 17} textAnchor="middle" fontSize="9.5"
                  fill={cur ? "#f0d060" : vis ? "#d4cec4" : "#b4ac9e"}
                  fontFamily="'Inter'"
                  fontWeight={cur ? "bold" : "normal"}
                >{r.name}</text>
                {/* Boost label — was 5.5 → now 8 */}
                <text
                  x={pt.x} y={pt.y + 28} textAnchor="middle" fontSize="8"
                  fill={cur ? "#b4ac9e" : vis ? "#8a8478" : "#8a8478"}
                  fontFamily="'Inter'"
                >{r.boost.emoji} {r.boost.label} +7%</text>
                {!vis && <text x={pt.x + 16} y={pt.y - 14} textAnchor="middle" fontSize="8" opacity=".45">🔒</text>}
              </g>
            );
          })}
          {/* Friends */}
          {friendPositions.map(f => {
            const fCls = f.chosenClass ? CLASSES[f.chosenClass] : null;
            const traveling = travelActive && (profile?.travelBoost?.friendId) === f.id;
            return (
              <g key={f.id} style={{ cursor: "pointer" }} onClick={(e) => onFriendClick(e, f, fCls)}>
                <circle
                  cx={f.mapX} cy={f.mapY} r={traveling ? 10 : 8}
                  fill={traveling ? UI_COLORS.success : (fCls?.color) || "#b4ac9e"}
                  stroke="rgba(255,255,255,.8)" strokeWidth="1.5" opacity=".9"
                />
                <text x={f.mapX} y={f.mapY + 4} textAnchor="middle" fontSize="8" fill="white">{(fCls?.icon) || "⚔️"}</text>
                {/* Friend name — was 5.5 → now 8 */}
                <text x={f.mapX} y={f.mapY - 14} textAnchor="middle" fontSize="8" fill="#d4cec4" fontFamily="'Inter'">
                  {(f.playerName || "?").split(" ")[0]}
                </text>
              </g>
            );
          })}
          {/* Player */}
          <g>
            {/* "YOU" label — was 7 → now 10 */}
            <text x={myPos.x} y={myPos.y - 22} textAnchor="middle" fontSize="10" fill="#f0d060" fontFamily="'Inter'" fontWeight="bold" letterSpacing="1">YOU</text>
            <line x1={myPos.x} y1={myPos.y - 18} x2={myPos.x} y2={myPos.y - 14} stroke="#f0d060" strokeWidth="1" opacity=".6" />
            <circle cx={myPos.x} cy={myPos.y} r={14} fill="rgba(45,42,36,.3)" stroke="#b4ac9e" strokeWidth="2" />
            <circle cx={myPos.x} cy={myPos.y} r={8} fill="#b4ac9e" stroke="#f0d060" strokeWidth="1.5" />
            <text x={myPos.x} y={myPos.y + 4} textAnchor="middle" fontSize="9" fill="#0c0c0a">{(CLASSES[profile.chosenClass || "warrior"]?.icon) || "⚔"}</text>
            <circle cx={myPos.x} cy={myPos.y} r={17} fill="none" stroke="#b4ac9e" strokeWidth="1" opacity=".3" />
          </g>
        </svg>
      </div>
      {/* Region boost callout */}
      <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(45,42,36,.16)", border: "1px solid rgba(180,172,158,.06)", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "1.1rem" }}>{myRegion.boost.emoji}</span>
        <div>
          <div style={{ fontSize: ".7rem", color: "#b4ac9e", fontWeight: 600 }}>{myRegion.name} Bonus</div>
          <div style={{ fontSize: ".62rem", color: "#8a8478", marginTop: 1 }}>
            <strong style={{ color: "#d4cec4" }}>{myRegion.boost.label}</strong> exercises earn{" "}
            <strong style={{ color: "#b4ac9e" }}>+7% XP</strong> here · {myRegion.desc}
          </div>
        </div>
      </div>
    </div>
  );
}

export { getRegionIdx, getMapPosition, MapSVG };
