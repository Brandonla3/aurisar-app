# Plans Tab Performance Audit

## Scope audited
- `src/App.jsx` (Plans tab container, plan list/detail, tab-level state orchestration).
- `src/components/PlanWizard.jsx` (Plan Builder flow, exercise picker modal, nested editing UI).
- `src/state/useUiState.js` (modal/session UI state that interacts with plans workflows).

## Executive summary
The lag behavior is consistent with **large parent re-renders + broad prop invalidation**, not a single isolated slow function.

Primary causes:
1. **`App.jsx` is a very large monolithic component** that owns most app state. Any state update in the screen can cause the Plans subtree to reconcile.
2. **Plan Builder (`PlanWizard`) keeps large mutable structures in component state (`bDays`)** and performs many immutable deep updates. This is correct functionally but expensive at scale.
3. **Many callbacks and object props are recreated every render**, reducing effectiveness of `React.memo` and virtualization.
4. **Derived calculations (`builderXP`, `wizardDayXPs`, `wizardExXPs`, picker filters) recompute frequently** and are coupled to broad dependencies.
5. **Nested modal/picker trees stay tightly coupled to the same stateful component**, so interactions in one overlay can invalidate unrelated sections.

---

## Findings

### 1) Plans UI is rendered from a very large top-level state owner
`src/App.jsx` contains the Plans tab logic, plan detail logic, schedule modal logic, and multiple unrelated tab behaviors in one component. This architecture tends to produce wide re-renders when any top-level state changes.

**Impact:** clicks in Plans can feel like “everything is rerendering” because much of the tree is under one reconciler boundary.

### 2) Plan Builder uses heavy deep updates for `bDays`
In `PlanWizard`, many interactions call patterns like:
- `setBDays(days => days.map(...exercises.map(...)))`
- reorders with array copies/splices
- nested row edits (`extraRows`) via clone/map patterns

This is expected in immutable React code, but becomes costly with:
- many days/weeks
- many exercises per day
- supersets/extra rows

**Impact:** each edit can trigger expensive object/array recreation and downstream memo invalidation.

### 3) `React.memo` protections are partially defeated by unstable props
`PickerRow` and `PlanExCard` are memoized, but parent render still recreates inputs such as callback references and composite objects (`rowProps`, inline handlers).

**Impact:** rows/cards still rerender more than intended, especially during picker/search/filter changes.

### 4) Expensive derived data recomputes on broad dependencies
`builderXP`, `wizardDayXPs`, and `wizardExXPs` are memoized, but depend on large structures (`bDays`, `allExById`, profile class).

**Impact:** many user actions trigger recalculation of whole-plan aggregates, including when only one exercise field changes.

### 5) Picker filter pipeline runs over full exercise list on each relevant state change
`filteredExercises` applies multiple checks and search string matching over `allExercises` every time picker criteria changes.

**Impact:** with large libraries, typing/filtering can feel sticky if combined with other re-render work.

### 6) Nested modal state in same component increases invalidation surface
Plan wizard + workout picker + exercise picker + config state are all owned by `PlanWizard`, and plans list/detail state is in `App.jsx`.

**Impact:** opening/closing overlays or toggling modal controls can still invalidate broad UI sections.

---

## Why the lag feels global
Your description (“every click rerenders many other areas”) matches the current architecture:
- very broad parent component ownership in `App.jsx`
- large mutable plan structure updated frequently
- memoization present, but not fully isolated by stable props/component boundaries

So the issue is likely **render breadth**, not only CPU hotspots in one handler.

---

## Highest ROI fixes (ordered)

1. **Extract Plans tab into a dedicated mounted subtree**
   - Move all plans-related UI/state from `App.jsx` into `PlansTabContainer`.
   - Wrap with `React.memo` and pass only minimal props.
   - Goal: unrelated tab/state changes in `App.jsx` should not reconcile Plans subtree.

2. **Normalize Plan Builder state updates with `useReducer` + targeted actions**
   - Replace repeated deep `map`/`clone` logic with reducer actions (`UPDATE_EX_FIELD`, `REORDER_EX`, `ADD_DAY`, etc.).
   - Keep mutation locality and reduce repeated closure recreation.

3. **Stabilize memoized child props**
   - `useCallback` for frequently passed handlers (`pickerToggleEx`, day/ex updates).
   - `useMemo` for `rowProps` and similar object props.
   - Ensure memoized children get stable non-changing references.

4. **Split expensive derived calculations**
   - Cache per-day XP and recompute only touched day.
   - Derive plan total from day cache instead of full-plan scans every edit.

5. **Isolate picker state into separate component**
   - Move exercise picker modal and filter logic out of main `PlanWizard` render path.
   - Consider `useDeferredValue` for search input to keep typing responsive.

6. **Add React Profiler instrumentation pass**
   - Measure commit times for: day edit, exercise add/remove, picker search, modal open/close.
   - Validate whether commit duration drops after each extraction.

---

## Quick wins you can apply first
- Memoize `rowProps` passed to virtualized list.
- Memoize toggle/update handlers passed into memoized rows/cards.
- Move picker filter controls + list into a child component to reduce parent churn.
- Avoid passing entire `profile` object into deeply repeated cards; pass only required fields.

---

## Suggested success criteria
After refactor, target:
- Picker typing: no visible input lag.
- Day exercise edits: sub-16ms typical commits on mid-size plans.
- Modal open/close: no noticeable stall.
- React Profiler: reduced commits in non-interacted plan sections.
