// Duration helpers: store as total seconds, display/input as HH:MM:SS
function secToHMS(totalSec) {
  if(totalSec===null||totalSec===undefined||totalSec==="") return "";
  const s = Math.round(Math.abs(Number(totalSec)));
  const hh=Math.floor(s/3600), mm=Math.floor((s%3600)/60), ss=s%60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

function HMSToSec(str) {
  if(!str||!String(str).trim()) return null;
  const t=String(str).trim();
  if(/^\d+$/.test(t)) return parseInt(t)*60;
  if(/^\d+:\d{2}$/.test(t)){const[m,s]=t.split(":").map(Number);return m*60+s;}
  if(/^\d+:\d{2}:\d{2}$/.test(t)){const[h,m,s]=t.split(":").map(Number);return h*3600+m*60+s;}
  return null;
}

// Normalize any HH:MM input to properly formatted "HH:MM"
// Rules: plain number → total minutes → HH:MM; "HH:MM" → normalize overflow (61 min → 01:01)
function normalizeHHMM(str) {
  if(!str||!String(str).trim()) return "";
  const t = String(str).trim();
  let totalMin;
  if(/^\d+$/.test(t)) {
    totalMin = parseInt(t); // plain number = total minutes
  } else if(/^\d+:\d+$/.test(t)) {
    const parts = t.split(":").map(Number);
    totalMin = parts[0]*60 + parts[1]; // HH:MM or MM:SS — treat as hours:minutes
  } else {
    return t; // unrecognised, leave as-is
  }
  const hh = Math.floor(totalMin/60);
  const mm = totalMin%60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}

// Split HH:MM:SS seconds value into {hhmm:"HH:MM", sec:ss}
function secToHHMMSplit(totalSec) {
  if(totalSec===null||totalSec===undefined||totalSec==="") return {hhmm:"",sec:""};
  const s = Math.round(Math.abs(Number(totalSec)));
  const hh=Math.floor(s/3600), mm=Math.floor((s%3600)/60), ss=s%60;
  return {hhmm:`${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`, sec:ss||""};
}

// Parse "HH:MM" or plain number (minutes) to seconds
function HHMMToSec(str) {
  if(!str||!String(str).trim()) return 0;
  const t=String(str).trim();
  if(/^\d+$/.test(t)) return parseInt(t)*60;
  if(/^\d+:\d+$/.test(t)){const[h,m]=t.split(":").map(Number);return h*3600+m*60;}
  return 0;
}

// Combine HH:MM string + seconds number into total seconds
function combineHHMMSec(hhmm, sec) {
  const base = HHMMToSec(normalizeHHMM(hhmm||"")||"");
  const s = parseInt(sec||0)||0;
  return base + Math.min(s, 59);
}

export {
  secToHMS,
  HMSToSec,
  normalizeHHMM,
  secToHHMMSplit,
  HHMMToSec,
  combineHHMMSec
};
