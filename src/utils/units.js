// slider 50-100 → pct 100-200 (1 slider unit = 2 pct points)
const pctToSlider = pct => pct <= 100 ? pct - 50 : 50 + (pct - 100) / 2;
const sliderToPct = sv  => sv  <= 50  ? sv  + 50  : 100 + (sv  - 50) * 2;

// ── Unit conversion helpers ──────────────────────────────────────
const isMetric = (units) => units === "metric";
// Weight
const lbsToKg   = lbs  => lbs  ? (parseFloat(lbs)/2.205).toFixed(1)  : "";
const kgToLbs   = kg   => kg   ? (parseFloat(kg)*2.205).toFixed(1)    : "";
// Distance
const miToKm    = mi   => mi   ? (parseFloat(mi)*1.60934).toFixed(2)  : "";
const kmToMi    = km   => km   ? (parseFloat(km)/1.60934).toFixed(2)  : "";
// Height
const ftInToCm  = (ft,inch) => { const t=(parseInt(ft)||0)*12+(parseInt(inch)||0); return t>0?Math.round(t*2.54):null; };
const cmToFtIn  = cm   => { const t=parseFloat(cm)/2.54; const ft=Math.floor(t/12); return {ft, inch:Math.round(t%12)}; };
// Display helpers
// NOTE: weightLabel/distLabel return the raw unit token only ("lbs"/"kg"/"mi"/"km") so they
// can be used inside parenthesised labels (e.g. "Weight (lbs)") and input placeholders.
// When displaying alongside a value, prefer displayWt/displayDist below — they include the
// space ("185 lbs") and handle metric conversion in one call.
const weightLabel = (units) => isMetric(units) ? "kg" : "lbs";
const distLabel   = (units) => isMetric(units) ? "km" : "mi";
const displayWt   = (lbs, units) => lbs  ? (isMetric(units) ? lbsToKg(lbs)+" kg"  : lbs+" lbs") : null;
const displayDist = (mi, units)  => mi   ? (isMetric(units) ? miToKm(mi)+" km"    : mi+" mi")   : null;

export {
  pctToSlider,
  sliderToPct,
  isMetric,
  lbsToKg,
  kgToLbs,
  miToKm,
  kmToMi,
  ftInToCm,
  cmToFtIn,
  weightLabel,
  distLabel,
  displayWt,
  displayDist
};
