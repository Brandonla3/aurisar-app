import { useEffect, useState } from "react";

// Environment gate for the ambient backdrop video. Returns false while any
// condition holds that makes decoding a looping video the wrong call:
//   • suspend      — caller-owned exclusion (the Babylon World tab owns the GPU;
//                    the video element must fully unmount, not hide)
//   • tab hidden   — no point decoding behind another tab/app
//   • reduced motion — the CSS block in app.css can't stop a <video>, so the
//                    JS gate is the only thing honouring the preference here
//   • Save-Data    — user asked for cheap; a 6MB loop is not cheap
// Quarantine (device proved it drops frames) is layered on by the component,
// which owns writing the tombstone.
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

export default function useAmbientVideoActive(suspend) {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE_QUERY).matches
  );

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    let mq = null;
    const onMq = e => setReduced(e.matches);
    if (typeof window.matchMedia === "function") {
      mq = window.matchMedia(REDUCE_QUERY);
      if (mq.addEventListener) mq.addEventListener("change", onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener("change", onMq);
        else if (mq.removeListener) mq.removeListener(onMq);
      }
    };
  }, []);

  const saveData = typeof navigator !== "undefined" && !!(navigator.connection && navigator.connection.saveData);
  return !suspend && !hidden && !reduced && !saveData;
}
