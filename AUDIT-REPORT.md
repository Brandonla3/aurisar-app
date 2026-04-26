# Aurisar Codebase Audit — XP, Format, Palette, Exercises & Workouts

**Date:** 2026-04-26
**Branch:** `claude/audit-xp-format-consistency-0X1MD`
**Companion artifact:** `Aurisar_Audit_Report.xlsx` (15 sheets, regenerable via `python scripts/build_audit_report.py`)

This report covers the four areas requested: XP system, format & palette inconsistencies, exercise XP models & calculations, and workout descriptions/content. P0 and P1 fixes are applied in this PR; P2 items are flagged for follow-up.

---

## 1. XP System

### Central calculator
`src/utils/xp.js:111` `calcExXP(exId, sets, reps, classKey, exLookup, distanceMi, weightLbs, hrZone, extraRows)`

Multiplier stack:
- Base: `ex.baseXP` (15–55, mostly 35 or 45)
- Class: `ex.xpClassMap[classKey]` preferred, else `CLASSES[classKey].bonuses[ex.category]`
- Set×Reps: `1 + (s*r - 1) * 0.05`
- Distance: `1 + min(distanceMi*0.05, 0.5)` (+5%/mi cap +50%)
- Pace (running only): `1.20` if pace ≤ 8 min/mi, else `1.05`
- Weight: `1 + min(weightLbs/500, 0.3)` (cap +30%, requires `tracksWeight`)
- HR Zone: `1 + (hrZone-1)*0.04` (Z1=1.0, Z5=1.16)
- **Cardio interval (NEW):** `1.25x` if `category==='cardio'` and `extraRows > 0`

Level table: 100-level cap, exponential `_XP_PER_LEVEL` array (`xp.js:29-40`).

### Issues found and resolved (P0)

| # | Issue | Location(s) | Resolution |
|---|---|---|---|
| 1 | Cardio +25% interval bonus duplicated inline at 7 sites | `App.js:118, 1709, 2305, 2449, 4547, 4549, 8933` | Centralised into `calcExXP` via new `extraRows` param |
| 2 | Inline XP formula missing all bonuses (distance/weight/pace/zone) | `App.js:1972` (`quickLogSoloEx`) | Replaced with `calcExXP` call |
| 3 | Inline XP formula missing pace bonus | `App.js:2532` (`calcEntryXP`) | Replaced with `calcExXP` call |
| 4 | Full inline reimplementation parallel to `calcExXP` | `App.js:1882` (`logExercise` main) | Replaced with `calcExXP` call |

The `getMult` helper at `App.js:1831` only consults `CLASSES[k].bonuses[ex.category]` — it ignores per-exercise `xpClassMap`. Calling `calcExXP` instead correctly picks up `xpClassMap` overrides. The replaced sites were therefore producing slightly low XP for any exercise with a custom `xpClassMap`.

### Remaining XP work (P1/P2)

- Region (+7%) and Travel (+10%) boosts remain inline (`App.js:1879-1885`) — they're profile-dependent, not exercise-dependent, so leaving them outside `calcExXP` is intentional. Documented in the workbook.
- baseXP values use 9 distinct numbers (15, 20, 25, 30, 35, 38, 40, 45, 50, 55). Granularity is uneven; consider normalising to {25, 30, 35, 40, 45, 50}.

---

## 2. Format & Palette

### Color palette

**Fixed in this PR (P0):**

- **`src/data/constants.js:1180`** `TYPE_COLORS` had Strength, Cardio, Flexibility and Yoga all mapped to `#C4A044` — visually indistinguishable. Re-mapped using the existing `MUSCLE_COLORS` family: Strength=`#6B2A2A`, Cardio=`#2C4564`, Flexibility/Yoga=`#3D343F`.
- **`src/index.css:11`** body `color:#333` on `#0c0c0a` background was near-invisible. Changed to `#d4cec4` (matches `landing.css --text-primary`).

**Flagged (P2):**

- Chest and Tricep both `#8B5A2B`; Full Body and Cardio both `#2C4564` (`constants.js:1175-1180`).
- Six different "gray" tokens with no hierarchy: `#d4cec4`, `#b4ac9e`, `#b0a898`, `#8a8478`, `#5a5650`, `#6a645a`.
- Untokenised one-offs: `#FFE87C` (pace bonus, `App.js:118`), `#2ecc71`, `#e74c3c`, `#e05555`, `#2980b9`, `#f1c40f`.
- Two fallback colors (`#B0A090` and `#B0A898`) — `xp.js:6,10`.
- Masculine palette (commit 49a3f30) rollout incomplete — Profile, Trends, Friends, Leaderboard, Landing, PlanWizard tabs not verified.

### Number / unit formatting

**Fixed in this PR (P1):**

- **`src/App.js:118, 2299`** — weight display strings used `${value}${weightLabel(...)}` and produced `"185lbs"` / `"84.0kg"` (no space). Switched to `displayWt(value, units)` which returns `"185 lbs"` / `"84.0 kg"`.
- **`src/utils/units.js:16-20`** — added JSDoc clarifying that `weightLabel`/`distLabel` return the bare token (for parenthesised labels and placeholders), while `displayWt`/`displayDist` are the canonical "value + unit" formatters.

### XP display format

**Fixed in this PR (P1):**

- **New helper:** `src/utils/format.js` `formatXP(value, { signed?, prefix? })`. Always uppercase XP, always integer, always thousands-separated.
- Migrated 8 high-traffic sites: workout-card display (`App.js:118`), workout-complete toast (`App.js:2499`), leaderboard XP (`App.js:6131`), workout/plan deletion toasts (`App.js:6614, 6708`), workout-tag chips (3×, `App.js:4655, 4888, 5453`), log-group XP (`App.js:5947`), and quest reward badges (`App.js:6414`).

**Remaining (P2):** ~40 more `.toLocaleString()`-based XP display sites in `App.js` should be swept to `formatXP` for full consistency. Listed in the `XP_Display_Formats` sheet of the workbook.

### Casing / typography / spacing

All P2 — flagged in the workbook for a future tokenisation pass:

- 20+ distinct font sizes (sub-0.05rem variations).
- Letter-spacing 0.02–0.32em with no documented scale.
- BorderRadius values 3, 4, 5, 6, 8, 12, 100 — no scale.
- No spacing tokens; hardcoded px throughout.
- Mixed Title Case / sentence case / UPPERCASE for buttons.

---

## 3. Exercise XP Models & Catalog

### Catalog stats (live, regenerated per build)

- Total exercises: ~1,544
- Empty `desc:""`: 55 (P1 — content gap)
- Truncated descriptions ending mid-word ("of", "f"): ~5–10 (P1 — re-import or hand-edit)
- Exact-name duplicates: "High Knees", "Incline Barbell Press", "Jump Rope" (P2 — needs migration plan because user logs reference IDs)
- Mixed-case names (e.g. "Bear plank ankle taps into jumps"): ~30 (P2)
- 50+ Bench Press variants with inconsistent suffix conventions (P2)

### Dual-form duplicates (P2 — flagged, not fixed)

The catalog contains both `ymove`/`free-exercise-db` imports (kebab-case + plural) **and** canonical entries (snake_case + singular) for the same exercise:

| ymove import | Canonical | Conflict |
|---|---|---|
| `dumbbell-lunges` (5012) | `dumbbell_lunge` (19406) | Same exercise, two IDs |
| `dumbbell-floor-chest-press` (4921) | `dumbbell_floor_press` (19402) | Same exercise, two IDs |
| `hammer_curls` (6975) | `hammer_curl` (19414) | Same exercise, two IDs |
| `standing_calf_raises` (16751) | `standing_calf_raise` (19458) | Same exercise, two IDs |

User-saved logs reference either ID, so dedup needs a migration path — left as a flagged P2.

### Icon coverage — clean

`ExIcon.js` covers all 12 muscle groups + 4 categories with graceful fallback. `ClassIcon.js` covers all 11 classes with emoji fallback. No gaps.

---

## 4. Workout Descriptions & Prebuilt Plans

### Descriptions — already consistent (positive note)

Every `WORKOUT_TEMPLATES` description in `constants.js` is 1–2 sentences, action voice, period-terminated, no TODOs/lorem/FIXME. This is the gold standard the rest of the content should match.

### Plan template reps schema (P2 — flagged)

`PLAN_TEMPLATES` exercise entries use inconsistent reps formats:

- Numeric (unquoted): `reps:8`, `reps:10` (in `ppl`, `cardio_week`, `monk_week`, `hiit_blast`, `full_body_day`, `morning_routine`)
- Quoted strings: `reps:"6-12"`, `reps:"30s"`, `reps:"45-60s"`, `reps:"AMRAP"` (in `dumbbell_8wk`)

Pick one schema (recommend strings — accommodates ranges and time-based reps) and migrate.

### No rest-period field

Plan template exercise objects have no `restSec`/`restMin`. Schema gap; flagged for follow-up.

---

## 5. Files Changed in This PR

| File | Change |
|---|---|
| `src/utils/xp.js` | `calcExXP` extended with `extraRows` param + cardio interval bonus |
| `src/utils/format.js` (new) | `formatXP()` helper |
| `src/utils/units.js` | JSDoc on label vs display helpers |
| `src/data/constants.js` | TYPE_COLORS collision fixed |
| `src/index.css` | Body text contrast fix |
| `src/App.js` | 7 cardio-bonus sites + 3 drifted-formula sites + 8 display-format sites refactored |
| `AUDIT-REPORT.md` (new) | This document |
| `Aurisar_Audit_Report.xlsx` (new) | 15-sheet workbook with file:line citations |
| `scripts/build_audit_report.py` (new) | Regenerator script |

---

## 6. Verification

- ✅ `npm run build` passes (transforms 636 modules, no errors).
- ✅ `npm run lint` — pre-existing errors only (React undefined in `constants.js`, unused vars in legacy code). No new errors introduced by these changes.
- ✅ All inline `* 1.25` / `1.25 :` patterns removed from `App.js`.
- ✅ All `ex.baseXP * mult *` reimplementations removed from `App.js`.
- ✅ `python scripts/build_audit_report.py` regenerates the workbook deterministically.
