import React, { memo } from 'react';
import { S, FS } from '../../utils/tokens';
import { CLASSES } from '../../data/exercises';

/**
 * Class reveal screen — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Shown after onboarding completes when the system detects a class for the
 * user. Presents the detected class with Accept / Choose Differently actions.
 */

const ClassRevealScreen = memo(function ClassRevealScreen({
  detectedClass,
  confirmClass,
  setScreen,
}) {
  const dc = CLASSES[detectedClass];
  return <div className={"screen"} style={{
    "--cls-color": dc.color,
    "--cls-glow": dc.glow
  }}><p style={{
      color: "#8a8478",
      fontSize: FS.md,
      letterSpacing: ".14em",
      textTransform: "uppercase"
    }}>{"The Fates have spoken…"}</p><div className={"reveal-card"} style={{
      "--cls-color": dc.color,
      "--cls-glow": dc.glow
    }}><span className={"reveal-icon"}>{dc.icon}</span><div className={"reveal-name"}>{dc.name}</div><p style={{
        color: "#8a8478",
        fontStyle: "italic",
        lineHeight: 1.5,
        fontSize: FS.fs90
      }}>{dc.description}</p><div className={"traits"} style={{
        justifyContent: "center",
        marginTop: S.s12
      }}>{dc.traits.map(t => <span key={t} className={"trait"} style={{
          "--cls-color": dc.color,
          "--cls-glow": dc.glow
        }}>{t}</span>)}</div></div><div style={{
      display: "flex",
      gap: S.s12,
      flexWrap: "wrap",
      justifyContent: "center"
    }}><button className={"btn btn-gold"} onClick={() => confirmClass(detectedClass)}>{"Accept My Fate"}</button><button className={"btn btn-ghost"} onClick={() => setScreen("classPick")}>{"Choose Differently"}</button></div></div>;
});

export default ClassRevealScreen;
