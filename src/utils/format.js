// Canonical XP string formatter.
// Always uppercase XP, always integer, always thousands-separated, optional sign and prefix.
// formatXP(1250)                            -> "1,250 XP"
// formatXP(1250, { signed: true })          -> "+1,250 XP"
// formatXP(-250, { signed: true })          -> "-250 XP"
// formatXP(1250, { prefix: "⚡ " })      -> "⚡ 1,250 XP"
// formatXP(1250, { signed: true, prefix: "⚡ " }) -> "⚡ +1,250 XP"
// formatXPValue(1250)                       -> "1,250"     (no unit)
// The Cold Forge `.stat` pattern renders the numeral and its unit as two
// separately-styled spans, so it needs the number on its own. Splitting it
// out here rather than inlining a toLocaleString at the call site keeps
// rounding, sign and thousands-separation in one place — the whole reason
// this module exists.
function formatXPValue(value, opts) {
  const o = opts || {};
  const n = Math.round(Number(value) || 0);
  const num = Math.abs(n).toLocaleString();
  let sign = "";
  if (o.signed) sign = n < 0 ? "-" : "+";
  else if (n < 0) sign = "-";
  return (o.prefix || "") + sign + num;
}

function formatXP(value, opts) {
  return formatXPValue(value, opts) + " XP";
}

export { formatXP, formatXPValue };
