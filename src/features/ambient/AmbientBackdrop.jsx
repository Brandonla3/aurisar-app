import React from "react";
import forgeMp4 from "../../assets/video/forge-backdrop.mp4";
import forgeWebm from "../../assets/video/forge-backdrop.webm";
import forgePoster from "../../assets/video/forge-backdrop-poster.jpg";
import useAmbientVideoActive from "./useAmbientVideoActive";
import { isMediaQuarantined, quarantineMedia, probeVideoHealth } from "../../utils/mediaHealth";

// ─── Forge backdrop ────────────────────────────────────────────────────────────
// PARKED — not mounted anywhere. The app renders its original `.bg` gradient
// backdrop; this component and its assets are kept so the video background can
// be reinstated without redoing the work.
//
// To re-enable: render <AmbientBackdrop suspendVideo={activeTab === "world"} />
// next to the `.bg` div in App.jsx. The drift layers below are the "ambient
// light travel" — they need `--ambient-tint`/`--ambient-tint2` re-declared in
// app.css (transparent at rest) plus the App effect that retints them to the
// muscle group in context; both were removed with the mount and are recoverable
// from commit c9d8159.
//
// The forge-backdrop video renders raw — no grade filter, no screen blend, no
// authored gradient environment, no scrims: the master is dark enough on its
// own and should look exactly like the file.
//
// Degraded states (world tab GPU handoff, hidden tab, prefers-reduced-motion,
// Save-Data, frame-drop quarantine, decode error) drop the <video>; the app's
// original .bg gradient beneath simply shows through.

const VIDEO_STYLE = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "50% 100%",
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
      if (p && p.catch) p.catch(() => {}); // autoplay veto → poster carries the frame
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
      <div className="ambient-drift" />
      <div className="ambient-drift2" />
    </div>
  );
}

export default React.memo(AmbientBackdrop);
