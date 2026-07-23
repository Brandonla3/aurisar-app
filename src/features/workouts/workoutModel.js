import { uid } from '../../utils/helpers';

/**
 * The one place that knows what a workout object looks like.
 *
 * Five surfaces used to hand-roll this shape (builder save, save-as-new,
 * the two one-off complete paths, and recipe "Add to My Workouts"), which
 * is how field drift starts. Callers still control the values that
 * legitimately differ per entry point — notably `createdAt`, whose format
 * intentionally varies between the localized display date (builder saves,
 * recipes) and the ISO todayStr (one-offs); normalizing that is a data
 * migration, not a refactor, so it is NOT done here.
 *
 * The one-off "Make Reusable" action is deliberately not routed through
 * this builder: it transforms an existing workout via spread and must
 * preserve fields it doesn't know about.
 */
export function buildWorkoutObject({
  id,
  name,
  icon,
  desc = "",
  exercises,
  createdAt,
  durationMin = null,
  activeCal = null,
  totalCal = null,
  labels = [],
  oneOff = false,
}) {
  const w = {
    id: id || uid(),
    name: (name || "").trim(),
    icon,
    desc: (desc || "").trim(),
    exercises,
    createdAt,
    durationMin: durationMin || null,
    activeCal: activeCal || null,
    totalCal: totalCal || null,
    labels,
  };
  if (oneOff) w.oneOff = true;
  return w;
}
