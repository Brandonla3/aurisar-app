// Canonical XP string formatter.
// Always uppercase XP, always integer, always thousands-separated, optional sign and prefix.
// formatXP(1250)                            -> "1,250 XP"
// formatXP(1250, { signed: true })          -> "+1,250 XP"
// formatXP(-250, { signed: true })          -> "-250 XP"
// formatXP(1250, { prefix: "⚡ " })      -> "⚡ 1,250 XP"
// formatXP(1250, { signed: true, prefix: "⚡ " }) -> "⚡ +1,250 XP"
function formatXP(value, opts) {
  const o = opts || {};
  const n = Math.round(Number(value) || 0);
  const num = Math.abs(n).toLocaleString();
  let sign = "";
  if (o.signed) sign = n < 0 ? "-" : "+";
  else if (n < 0) sign = "-";
  return (o.prefix || "") + sign + num + " XP";
}

export { formatXP };
