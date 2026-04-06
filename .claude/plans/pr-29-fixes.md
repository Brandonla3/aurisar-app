# Fix Plan: PR #29 — fix: V8 audit — XP bonuses, quest exIds, ymove removal, data quality

## Context

PR #29 extends `calcExXP` with `weightLbs` and `hrZone` parameters, fixes quest `exId` mismatches, adds `yoga_session`/`deep_stretch` exercises, and introduces a new `exerciseLibrary.js` Supabase loader. Three defects must be fixed before this PR is safe to merge: `exerciseLibrary.js` will crash at runtime because `sb` is never imported; the `calcPlanXP`/`calcDayXP` wrappers silently ignore the new bonus parameters; and `q_cycle_10` still points to the nonexistent exId `cycling` instead of `cycle_ride`, so Road Rider can never auto-complete. A fully-corrected version has no `ReferenceError` risk in the exercise loader, consistent XP calculation across all plan/day views, and all quest `exId` values resolving to real exercise IDs.

**Source branch**: `claude/nervous-ellis`
**Issues to fix**: 3 critical, 2 moderate

---

## Steps

### Step 1: Add missing `sb` import to `exerciseLibrary.js`

**File**: `src/utils/exerciseLibrary.js` (line 3)
**Severity**: 🔴 Critical
**Issue**: `loadExercises()` and `getFreshVideoUrl()` call `sb.from(...)` and `sb.rpc(...)` but `sb` is never imported, causing `ReferenceError: sb is not defined` at runtime.
**Why it matters**: Every call to `loadExercises()` on app startup and `getFreshVideoUrl()` when a user opens an exercise detail will throw an uncaught error, preventing the Supabase exercise library from loading and all video URLs from being fetched.

**What to do**:
Add the `sb` import on line 4, after the existing three imports.

```js
// Before (lines 1-3)
import React from 'react';
import { EXERCISES } from '../data/exercises';
import { EX_BY_ID } from '../data/constants';

// After
import React from 'react';
import { EXERCISES } from '../data/exercises';
import { EX_BY_ID } from '../data/constants';
import { sb } from './supabase';
```

---

### Step 2: Fix `calcPlanXP` and `calcDayXP` to forward `weightLbs` and `hrZone`

**File**: `src/utils/xp.js` (lines 120-126)
**Severity**: 🔴 Critical
**Issue**: `calcPlanXP` and `calcDayXP` call `calcExXP` with only 5 arguments, omitting `distanceMi`, `weightLbs`, and `hrZone`, so plan XP totals never apply the new weight or HR zone bonuses.
**Why it matters**: XP totals shown for plans in the plan list, workout preview, and day view under-count XP for weighted exercises. A user doing heavy barbell work will not see the weight bonus in plan XP even though it is correctly applied in the per-exercise log path.

**What to do**:
Pass `weightLbs` through from each exercise. Pass `null` for `hrZone` since there is no HR zone at plan-preview time.

```js
// Before (lines 120-126)
function calcPlanXP(plan,classKey,exLookup) {
  return plan.days.reduce((t,d)=>t+d.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets,ex.reps,classKey,exLookup),0),0);
}

function calcDayXP(day,classKey,exLookup) {
  return day.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets,ex.reps,classKey,exLookup),0);
}

// After
function calcPlanXP(plan,classKey,exLookup) {
  return plan.days.reduce((t,d)=>t+d.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets,ex.reps,classKey,exLookup,null,ex.weightLbs||null,null),0),0);
}

function calcDayXP(day,classKey,exLookup) {
  return day.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets,ex.reps,classKey,exLookup,null,ex.weightLbs||null,null),0);
}
```

---

### Step 3: Fix `q_cycle_10` quest exId from `cycling` to `cycle_ride`

**File**: `src/data/constants.js` (line 196)
**Severity**: 🔴 Critical
**Issue**: `q_cycle_10` (Road Rider) has `auto:{exId:"cycling",count:10}` but the canonical exercise ID is `cycle_ride`. No exercise with ID `cycling` exists in `EXERCISES`, so `checkQuestCompletion` never matches and the quest can never auto-complete.
**Why it matters**: Users who log 10+ cycling sessions will never see Road Rider auto-complete. The quest is silently broken for all users.

**What to do**:
Change the `exId` value from cycling to cycle_ride on line 196.

```js
// Before (line 196)
{ id:"q_cycle_10", name:"Road Rider", cat:"Cardio", xp:1000, auto:{exId:"cycling",count:10} },

// After
{ id:"q_cycle_10", name:"Road Rider", cat:"Cardio", xp:1000, auto:{exId:"cycle_ride",count:10} },
```

---

### Step 4: Update remaining `calcExXP` display call sites in `App.js` to pass `weightLbs` and `hrZone`

**File**: `src/App.js` (lines 2063, 4080, 4082, 4355, 4466, 4584, 4585, 4629, 4701, 8854, 9002)
**Severity**: 🟡 Moderate
**Issue**: These preview/display call sites in the plan builder, WOD preview, and workout template XP display still call `calcExXP` with 5-6 arguments, so the XP numbers shown do not include the weight bonus.
**Why it matters**: Users see a lower XP number in plan builder previews than what gets credited when they log. A user with 225 lb bench press sees the same preview XP as one with no weight set.

**What to do**:
For each call site, add `ex.weightLbs||null, null` as the 7th and 8th arguments.

```js
// Before (representative at line 4080)
const base = calcExXP(ex.exId, ex.sets||3, ex.reps||10, profile.chosenClass, allExById);

// After
const base = calcExXP(ex.exId, ex.sets||3, ex.reps||10, profile.chosenClass, allExById, null, ex.weightLbs||null, null);
```

For call sites that already pass `distMiVal` as the 6th argument (lines 4701, 8442), preserve that and append `ex.weightLbs||null, null`:

```js
// Before (line 4701)
const b=calcExXP(ex.exId,noSetsEx?1:ex.sets,ex.reps,profile.chosenClass,allExById,distMiVal||null)

// After
const b=calcExXP(ex.exId,noSetsEx?1:ex.sets,ex.reps,profile.chosenClass,allExById,distMiVal||null,ex.weightLbs||null,null)
```

---

### Step 5: Document mutation approach in `exerciseLibrary.js` to prevent silent stale-data bugs

**File**: `src/utils/exerciseLibrary.js` (lines 71-96)
**Severity**: 🟡 Moderate
**Issue**: `loadExercises()` mutates the exported `EXERCISES` array and calls `Object.assign(EX_BY_ID, ...)` on module-level objects. Components that held a reference before loading completes will silently have stale data.
**Why it matters**: Components that render before `loadExercises()` resolves use only the hardcoded exercise set. The `Object.assign` rebuild is additive-only, so deleted exercises are never pruned from `EX_BY_ID`.

**What to do**:
Add a comment block at the top of `loadExercises()` documenting the mutation contract:

```js
// At the start of loadExercises(), add:
// NOTE: This function mutates the module-level EXERCISES array and EX_BY_ID object.
// Components must call useExercises() to re-render after loading completes.
// Always pass allExById from state to calcExXP -- do not snapshot EXERCISES at import time.

// On the Object.assign rebuild line, add:
// Rebuild global lookup (additive only -- removed exercises are not pruned)
Object.assign(EX_BY_ID, Object.fromEntries(EXERCISES.map(e => [e.id, e])));
```

---

## Verification

After all fixes are applied, verify correctness:

- [ ] Open the app and confirm no `ReferenceError: sb is not defined` in the browser console on startup (Step 1)
- [ ] Navigate to a plan with weighted exercises and confirm plan total XP is higher than a plan with no weight set (Step 2)
- [ ] Log a cycling session (`cycle_ride`) and confirm `q_cycle_10` Road Rider quest increments its counter (Step 3)
- [ ] Open the plan builder, add a strength exercise with a weight, and confirm the XP preview reflects the weight bonus (Step 4)
- [ ] Run `npm run build` with no new errors or warnings

---

## Notes

- The `calcExXP` signature change is backward-compatible (extra params coerce to falsy when undefined), so existing callers will not break. Step 4 is about display consistency, not correctness of the log-save path.
- `exerciseLibrary.js` is a new file -- verify `loadExercises()` is called in `App.js` or the entry point. If not yet wired up, the `sb` crash will not surface until integration.
- `calcPlanXP` is used in at least 4 spots in `App.js` (lines 4985, 5037, 5122, 5124). All benefit automatically from the Step 2 fix since they go through the wrapper.
- The PR correctly adds `exId`-first lookup in `checkQuestCompletion` (`e.exId || name-lookup` fallback), a good improvement for log entries that store `exId`.

---

## Minor Issues (optional, do after the main fixes)

- [ ] Add `xpClassMap` entries to `yoga_session` and `deep_stretch` in `src/data/exercises.js` for consistency with exercises that have explicit class multipliers
- [ ] Audit and fix the jumpRope vs jumprope exId inconsistency in plan templates (pre-existing, not introduced by this PR)
- [ ] Add a JSDoc comment to `exerciseLibrary.js` explaining the mutation approach and the `useExercises()` requirement for live data components
