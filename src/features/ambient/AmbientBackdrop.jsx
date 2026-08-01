import React from "react";
import forgeMp4 from "../../assets/video/forge-backdrop.mp4";
import forgeWebm from "../../assets/video/forge-backdrop.webm";
import forgePoster from "../../assets/video/forge-backdrop-poster.jpg";
import useAmbientVideoActive from "./useAmbientVideoActive";
import { isMediaQuarantined, quarantineMedia, probeVideoHealth } from "../../utils/mediaHealth";

// ─── Forge Glass ambient backdrop ──────────────────────────────────────────────
// Layer stack, bottom → top. The authored CSS environment is the tone source and
// is ALWAYS on; the video is motion garnish only (the master is ~5 stops under,
// so it is gamma-lifted, desaturated, re-tinted by #plateGamma, blurred and
// screen-blended — exactly the grade the design prototype ships). Every degraded
// state (world tab, hidden tab, reduced motion, Save-Data, quarantine, decode
// error) simply drops the <video>; the room survives on gradients + drift.

const ENV_BACKGROUND = [
  "radial-gradient(52% 26% at 63% 38%,rgba(240,200,104,.17),transparent 72%)",
  "radial-gradient(120% 42% at 50% 97%,rgba(196,148,40,.12),transparent 74%)",
  "radial-gradient(85% 50% at 16% 74%,rgba(72,102,96,.13),transparent 76%)",
  "radial-gradient(70% 34% at 88% 62%,rgba(58,74,92,.1),transparent 78%)",
  "radial-gradient(130% 70% at 50% 50%,transparent 42%,rgba(4,4,6,.72) 100%)",
  "linear-gradient(180deg,#09090C 0%,#0F1013 34%,#15161A 64%,#0C0D10 100%)",
].join(",");

const SCRIM_BACKGROUND =
  "linear-gradient(180deg,rgba(7,7,10,.86) 0%,rgba(7,7,10,.4) 9%,rgba(7,7,10,.14) 20%,rgba(7,7,10,.1) 50%,rgba(7,7,10,.16) 80%,rgba(7,7,10,.58) 92%,rgba(7,7,10,.88) 100%)";

const VIDEO_STYLE = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "50% 100%",
  transform: "scale(1.04)",
  transformOrigin: "50% 28%",
  mixBlendMode: "screen",
  opacity: 0.55,
  filter: "url(#plateGamma) blur(1.4px)",
};

function AmbientBackdrop({ suspendVideo }) {
  const envOk = useAmbientVideoActive(suspendVideo);
  const [broken, setBroken] = React.useState(() => isMediaQuarantined());
  const videoRef = React.useRef(null);
  const showVideo = envOk && !broken;

  React.useEffect(() => {
    if (!showVideo) return undefined;
    const el = videoRef.current;
    if (el && el.paused) {
      const p = el.play();
      if (p && p.catch) p.catch(() => {}); // autoplay veto → poster + gradients carry the look
    }
    return probeVideoHealth(el, v => {
      if (!v.ok) {
        quarantineMedia(`dropped ${v.dropped}/${v.total} frames`);
        setBroken(true);
      }
    });
  }, [showVideo]);

  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="plateGamma" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude="1.35" exponent="0.35" offset="0" />
            <feFuncG type="gamma" amplitude="1.35" exponent="0.35" offset="0" />
            <feFuncB type="gamma" amplitude="1.35" exponent="0.35" offset="0" />
          </feComponentTransfer>
          <feColorMatrix type="saturate" values="0.14" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.2" intercept="0" />
            <feFuncG type="linear" slope="1.0" intercept="0" />
            <feFuncB type="linear" slope="0.72" intercept="0" />
          </feComponentTransfer>
        </filter>
      </svg>
      <div style={{ position: "absolute", inset: 0, background: ENV_BACKGROUND }} />
      {showVideo && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={forgePoster}
          onError={() => setBroken(true)}
          style={VIDEO_STYLE}
        >
          <source src={forgeMp4} type="video/mp4" />
          <source src={forgeWebm} type="video/webm" />
        </video>
      )}
      <div style={{ position: "absolute", inset: 0, background: SCRIM_BACKGROUND }} />
      <div className="ambient-drift" />
      <div className="ambient-drift2" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.035,
          background: "repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 3px)",
        }}
      />
    </div>
  );
}

export default React.memo(AmbientBackdrop);
