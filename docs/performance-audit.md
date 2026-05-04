# Performance Audit & App.jsx Decomposition Plan

**Status:** Active tracker — update checklist below as each remediation PR lands.
**Scope:** Application-wide performance — focused on mobile scrolling, workout completion latency, and `src/App.jsx` decomposition.
**Outcome:** A single source of truth for the audit findings and a checklist of remediation PRs that will land incrementally. This document is updated as work progresses.

---

## Status / Tracker

Tick each box as the corresponding PR merges. Each remediation should reference this doc.

- [x] **1. Stabilize particle positions** _(low risk, recommended first)_
  - [x] Move `Math.random()` out of render path (precompute once via constants or `useMemo`)
  - [x] Disable particles on lower-end / mobile devices
  - PR: [#117](https://github.com/Brandonla3/aurisar-app/pull/117)
- [x] **2. Mobile CSS performance overrides** _(low risk)_
  - [x] Add mobile-targeted media query that disables / reduces `backdrop-filter`
  - [x] Disable `.pt` particle animation on mobile
  - [x] Replace live blur on sticky header / bottom nav with flat translucent backgrounds on mobile
  - PR: [#117](https://github.com/Brandonla3/aurisar-app/pull/117)
- [x] **3. Workout completion responsiveness** _(highest risk — split into its own PR)_
  - [x] Give instant visual feedback (pressed state, modal close) before heavy work
  - [x] Extract `useWorkoutCompletion` hook
  - [x] Defer non-critical work via `startTransition` / `requestIdleCallback`
  - [x] Add timing instrumentation for before/after measurement
  - PR: [#118](https://github.com/Brandonla3/aurisar-app/pull/118)
- [x] **4. Debounce / queue persistence writes**
  - [x] Debounce `localStorage` writes (Supabase already debounced)
  - [ ] Consider splitting high-growth `log` from low-frequency profile preferences
  - [x] Flush pending writes on `pagehide` / explicit sign-out
  - PR: [#119](https://github.com/Brandonla3/aurisar-app/pull/119)
- [x] **5. Memoize exercise library filters**
  - [x] Wrap derived filtered lists, available muscle/equipment/type sets, and counts in `useMemo`
  - [x] Precompute stable indexes for muscle / equipment / type / category
  - [x] Extract into `features/exercises/` with `useExerciseFilters` hook
  - PRs: [#120](https://github.com/Brandonla3/aurisar-app/pull/120) (memoize in App.jsx), [#121](https://github.com/Brandonla3/aurisar-app/pull/121) (extract `useExerciseFilters` hook)
- [x] **6. Continue App.jsx decomposition** _(incremental — multiple PRs)_
  - [x] Workout completion flow (links to #3) — PR [#118](https://github.com/Brandonla3/aurisar-app/pull/118)
  - [x] Exercise library / search / filter (links to #5) — PRs [#121](https://github.com/Brandonla3/aurisar-app/pull/121) [#122](https://github.com/Brandonla3/aurisar-app/pull/122) [#123](https://github.com/Brandonla3/aurisar-app/pull/123)
  - [ ] Shell / layout pieces: HUD, nav, background, toast, XP flash
  - [ ] History / profile / social / messages
  - [ ] Quests / calendar
  - PRs: [#118](https://github.com/Brandonla3/aurisar-app/pull/118), [#121](https://github.com/Brandonla3/aurisar-app/pull/121), [#122](https://github.com/Brandonla3/aurisar-app/pull/122), [#123](https://github.com/Brandonla3/aurisar-app/pull/123) — ongoing

**Already landed (prior to this audit):**

- PR-2 [#110](https://github.com/Brandonla3/aurisar-app/pull/110) — extract `bDays` into `useReducer` ([src/components/planWizardReducer.js](../src/components/planWizardReducer.js))
- PR-3 [#111](https://github.com/Brandonla3/aurisar-app/pull/111) — extract [`PlansTabContainer`](../src/components/PlansTabContainer.jsx) from `App.jsx`
- PR-5  [#113](https://github.com/Brandonla3/aurisar-app/pull/113) — extract [`PlanCard`](../src/components/PlanCard.jsx) as `React.memo`
- PR-5a / PR-5b — extract [`useUiState`](../src/state/useUiState.js) and [`useAuthState`](../src/state/useAuthState.js)
- Lazy-loaded tabs: `AdminPage`, `TrendsTab`, `LandingPage`, `PlanWizard`, `LoginScreen`

---

## Background

Users are seeing general sluggishness across the app, including:

- Mobile scrolling briefly showing a black screen before content appears.
- Delayed response after selecting "Complete" or "Mark Complete or Schedule" for a workout.
- General slowness during tab changes, filtering, workout actions, and profile/log updates.

The source audit suggests the performance issues are not caused by one isolated bug. They come from a combination of broad React re-renders, expensive synchronous work, mobile GPU-heavy CSS, repeated full-list calculations, and a very large top-level `App.jsx` that owns too many responsibilities.

`src/App.jsx` was **16,204 lines** at audit time. Currently **15,168 lines** (−1,036).

---

## Findings

### 1. Render-time random particle positions cause repaint churn

**Location:** [src/App.jsx:5984](../src/App.jsx#L5984)

The app renders decorative particles with `Math.random()` inside JSX. Every React render gives those fixed-position particles new `bottom` values. That means unrelated state updates can move visual background elements and trigger unnecessary repaint/compositing work.

```jsx
{PARTICLES.map(p => <div key={p.id} className={"pt"} style={{
  left: `${p.x}%`,
  bottom: `${Math.random() * 100}%`,  // ← recomputed on every render
  width: p.size,
  height: p.size,
  ...
}} />)}
```

**Impact:**

- More expensive renders than necessary.
- Worse mobile scroll performance.
- Possible black-frame / checkerboarding behavior while the browser repaints.

**Recommended fix:**

- Move particle positioning out of render.
- Generate all particle positions once, either in constants or `useMemo`.
- Keep animated background elements stable across renders.
- Consider disabling particles entirely on lower-end / mobile devices.

---

### 2. Heavy fixed blur and backdrop layers likely contribute to mobile black-frame scrolling

**Location:** [src/styles/app.css](../src/styles/app.css)

The app uses fixed background gradients ([`.bg`](../src/styles/app.css#L17)), animated blurred particles ([`.pt`](../src/styles/app.css#L18)), sticky blurred headers, fixed blurred bottom navigation ([`.hud-nav-panel`](../src/styles/app.css#L82)), shadows, and `backdrop-filter` across high-frequency UI areas. There are **29 `backdrop-filter` selectors** in the stylesheet. The main content scrolls inside [`.scroll-area`](../src/styles/app.css#L91), while multiple fixed/blurred layers remain composited above or behind it.

**Impact:**

- Mobile browsers can fail to paint scrolled content fast enough.
- The user sees the dark root background before content catches up.
- This matches the reported "all black for a second" scroll symptom.

**Note:** A `@media (hover: none) and (pointer: coarse)` block already exists at [src/styles/app.css:59](../src/styles/app.css#L59), but it only enlarges touch targets — it does **not** disable `backdrop-filter`, the `.pt` particle animation, or the fixed gradients on mobile.

**Recommended fix:**

- Add a mobile performance CSS path.
- Reduce or remove `backdrop-filter` on mobile.
- Disable animated particles during mobile app usage.
- Prefer flat translucent backgrounds over live blur for sticky headers/nav.
- Keep `.scroll-area` and fixed nav layers simple and predictable.
- Add `@media (hover: none) and (pointer: coarse)` overrides for low-cost rendering.

---

### 3. Workout completion performs too much synchronous work before the UI settles

**Location:** [`confirmWorkoutComplete()` in src/App.jsx:4877](../src/App.jsx#L4877) — spans roughly 120 lines.

Workout completion currently builds log entries, calculates XP, clones/prepends to the full log, scans quests, updates the full profile, triggers XP flash/toast/modal state, and then indirectly triggers profile persistence — all synchronously before the React state update that lets the UI redraw.

Concretely:

1. Build log entries (`flatMap` exercises, `calcExXP`, build entry objects).
2. Reduce entries to a total XP value.
3. Clone & prepend to the full log: `[...entries, ...profile.log]`.
4. Scan auto-quests via `QUESTS.filter(q => q.auto).…`.
5. `setProfile()` updates xp, log, quests, workouts, scheduledWorkouts and runs `applyAutoCheckIn()`.
6. Trigger XP flash, toast, modal close.

**Impact:**

- Large logs make completion increasingly expensive.
- The button can feel unresponsive because computation happens before the user sees meaningful feedback.
- The "Complete workout" delay is likely coming from this path.

**Recommended fix:**

- Give instant UI feedback first: pressed/loading state, modal close, or optimistic completion.
- Move heavy calculations into a dedicated `useWorkoutCompletion` hook.
- Defer non-critical work using `startTransition`, `requestIdleCallback`, or a small queued task.
- Avoid recalculating global data when only one completed workout changed.
- Add timing instrumentation around completion to measure before/after.

---

### 4. Full-profile autosave serializes the entire profile on every profile mutation

**Location:** [src/utils/storage.js:99](../src/utils/storage.js#L99)

Every profile change calls `doSave`, and `doSave` immediately writes the full profile to `localStorage` using `JSON.stringify`. Local storage writes are synchronous and block the main thread.

```js
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
```

Supabase upserts are debounced via a 500ms timer (`SUPABASE_DEBOUNCE_MS`), but the `localStorage` write fires eagerly on every `doSave()` call.

**Impact:**

- Workout completion, favorites, edits, scheduling, history updates, and profile changes all pay a full serialization cost.
- Cost grows as `profile.log` grows.
- Debouncing Supabase helps network traffic but does not avoid the synchronous `localStorage` cost.

**Recommended fix:**

- Debounce `localStorage` writes too.
- Split persisted data into smaller slices if possible.
- Consider saving high-growth data like `log` separately from low-frequency profile preferences.
- Use a dirty-flag / save queue model instead of immediate full-profile writes.
- Flush pending writes on `pagehide` or explicit sign-out.

---

### 5. Exercise library filtering recomputes large list scans inside render

**Location:** [src/App.jsx:6869](../src/App.jsx#L6869), [src/App.jsx:6984](../src/App.jsx#L6984), [src/App.jsx:7009](../src/App.jsx#L7009)

The exercise library scans `allExercises` several times during render to compute filtered exercises, available muscle groups, available equipment, available types, counts, and home-view data.

**Note:** `allExercises` itself **is** memoized at [src/App.jsx:3424](../src/App.jsx#L3424). The gap is the *derived* outputs — the filtered lists, the available filter sets, and per-muscle counts are recomputed in render rather than memoized.

The local exercise catalog has over 1,500 hardcoded exercises, plus Supabase patching.

**Impact:**

- Search and filter interactions can feel sticky.
- Tab transitions into the exercise library can be slower than necessary.
- Repeated full-list scans add avoidable render cost.

**Recommended fix:**

- Extract exercise library into `features/exercises/ExerciseLibraryTab.jsx`.
- Move filter logic into `useExerciseFilters`.
- Memoize derived filter outputs.
- Precompute stable indexes for muscle, equipment, type, and category.
- Keep virtualization for long visible lists.
- Avoid recalculating home-view counts on every render.

---

### 6. `src/App.jsx` is too large and owns too many responsibilities

**Location:** [src/App.jsx](../src/App.jsx)

`App.jsx` was **16,204 lines** at audit time and currently owns authentication flow, layout, tabs, workout flows, exercise library, history, profile, social, messages, modals, persistence triggers, and many derived calculations.

**Impact:**

- Small state updates can invalidate very large portions of the app.
- Feature-specific performance problems are harder to isolate.
- Refactors become riskier because unrelated behaviors live in the same file.
- Memoization is less effective when state and callbacks are centralized.

**Recommended target structure** (see migration notes after the tree):

```
src/
  app/
    AppShell.jsx
    MainLayout.jsx
    HudHeader.jsx
    BottomNav.jsx
    AppBackground.jsx

  features/
    workouts/
      WorkoutsTab.jsx
      WorkoutDetail.jsx
      WorkoutBuilder.jsx
      WorkoutCompletionModal.jsx
      useWorkoutCompletion.js

    exercises/
      ExerciseLibraryTab.jsx
      GrimoireGridTab.jsx
      ExercisePicker.jsx
      ExerciseDetailModal.jsx
      useExerciseFilters.js

    history/
      HistoryTab.jsx

    profile/
      ProfileTab.jsx
      ProfileEdit.jsx
      SecuritySettings.jsx
      NotificationSettings.jsx

    calendar/
      CalendarTab.jsx

    social/
      SocialTab.jsx
      MessagesTab.jsx

    quests/
      QuestsTab.jsx
```

**Migration notes — this is a target state, not greenfield:**

- The existing `src/state/` directory already plays the role of the proposed `hooks` location for state hooks (`useAuthState`, `useUiState`). New feature hooks like `useWorkoutCompletion` and `useExerciseFilters` can either live alongside their feature module or continue the `src/state/` convention.
- The existing `src/components/` modules ([`PlansTabContainer`](../src/components/PlansTabContainer.jsx), [`PlanCard`](../src/components/PlanCard.jsx), [`planWizardReducer`](../src/components/planWizardReducer.js), [`PlanWizard`](../src/components/PlanWizard.jsx), [`AdminPage`](../src/components/AdminPage.jsx), [`TrendsTab`](../src/components/TrendsTab.jsx), [`LandingPage`](../src/components/LandingPage.jsx), [`LoginScreen`](../src/components/LoginScreen.jsx)) should migrate **into** the new `features/` tree rather than duplicating into it. Plans currently lives under `components/` and is a good candidate for `features/plans/`.
- Each migration should be its own PR to keep diffs reviewable and avoid mass conflicts.

### Suggested implementation order

1. Extract workout completion flow first (pairs with finding #3). ✅ PR [#118](https://github.com/Brandonla3/aurisar-app/pull/118)
2. Extract exercise library / search / filter next (pairs with finding #5). ✅ PRs [#121](https://github.com/Brandonla3/aurisar-app/pull/121) [#122](https://github.com/Brandonla3/aurisar-app/pull/122) [#123](https://github.com/Brandonla3/aurisar-app/pull/123)
3. Extract shell/layout pieces: HUD, nav, background, toast, XP flash.
4. Extract history / profile / social after the high-impact paths are isolated.
5. Gradually move feature state into hooks once components are stable.

The lowest-risk first PRs (and good warm-ups before #3) are **finding #1 (particle positions)** and **finding #2 (mobile CSS overrides)** — small surface area, no behavior change. ✅ PR [#117](https://github.com/Brandonla3/aurisar-app/pull/117)

---

## Non-Goals

This documentation PR does not:

- Change app behavior.
- Remove visual styling.
- Rewrite persistence.
- Replace the current state model in one large refactor.
- Attempt to fully solve performance in a docs-only change.

---

## Validation Plan For Future Code PRs

Future implementation PRs should verify:

- Mobile scrolling no longer flashes black during rapid up/down scroll.
- "Complete workout" gives immediate visual feedback.
- Workout completion remains correct for XP, quests, check-in streaks, logs, scheduled workouts, and toasts.
- Exercise search/filter remains functionally identical.
- Production build passes.
- React Profiler shows reduced commit time for completion and exercise filtering paths.

---

## Risk Notes

The highest-risk area is **workout completion** (finding #3) because it touches logs, XP, quests, check-ins, scheduled workouts, and persistence. That work should be split into a small dedicated PR with before/after testing.

The safest first code change is **stabilizing particle positions** (finding #1) and **adding mobile CSS performance overrides** (finding #2), since those have a smaller behavioral surface.
