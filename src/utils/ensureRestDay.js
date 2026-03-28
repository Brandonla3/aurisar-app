// ── Heart Rate Zones ─────────────────────────────────────────────
// Ensures Rest Day is a default favorite and migrates away from customExercises
function ensureRestDay(profile) {
  // Remove rest_day from customExercises if it was there (migration from custom to built-in)
  const customs = (profile.customExercises || []).filter(e => e.id !== "rest_day");
  // Add rest_day to favorites if not already there
  const favs = profile.favoriteExercises || [];
  const hasFav = favs.includes("rest_day");
  return { ...profile, customExercises: customs, favoriteExercises: hasFav ? favs : ["rest_day", ...favs] };
}

export { ensureRestDay };
