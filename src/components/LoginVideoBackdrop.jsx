import React from "react";
import loginMp4 from "../assets/video/login-backdrop.mp4";
import loginWebm from "../assets/video/login-backdrop.webm";
import loginPoster from "../assets/video/login-backdrop-poster.jpg";
import useAmbientVideoActive from "../features/ambient/useAmbientVideoActive";
import { isMediaQuarantined, quarantineMedia, probeVideoHealth } from "../utils/mediaHealth";

// ─── Login backdrop video ──────────────────────────────────────────────────────
// Mounted as the last child of LoginScreen's "Layered cinematic background" div,
// so it inherits that div's position:absolute/inset:0/overflow:hidden box and
// paints over the gradient/sigil/beam already there — no separate fallback
// layer needed. Renders null in every degraded state (reduced motion, hidden
// tab, Save-Data, frame-drop quarantine, decode error) and lets that gradient
// layer show through unmodified, same as AmbientBackdrop's relationship to the
// app's .bg gradient (src/features/ambient/AmbientBackdrop.jsx).

const VIDEO_STYLE = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "50% 100%",
};

function LoginVideoBackdrop() {
  // No suspend condition — unlike the app-wide ambient backdrop, nothing else
  // competes for the GPU pre-auth.
  const envOk = useAmbientVideoActive(false);
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
        quarantineMedia(`login backdrop dropped ${v.dropped}/${v.total} frames`);
        setBroken(true);
      }
    });
  }, [showVideo]);

  if (!showVideo) return null;

  return (
    <video
      ref={videoRef}
      aria-hidden="true"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster={loginPoster}
      onError={() => setBroken(true)}
      style={VIDEO_STYLE}
    >
      <source src={loginMp4} type="video/mp4" />
      <source src={loginWebm} type="video/webm" />
    </video>
  );
}

export default React.memo(LoginVideoBackdrop);
