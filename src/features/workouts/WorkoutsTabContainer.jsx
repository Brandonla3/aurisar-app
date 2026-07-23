import React, { useState, useMemo, useCallback, useImperativeHandle } from 'react';
import WorkoutsTab from './WorkoutsTab';
import WorkoutExercisePicker from './WorkoutExercisePicker';
import { buildWorkoutObject } from './workoutModel';
import { uid } from '../../utils/helpers';
import { calcExEntryXP } from '../../utils/xp';
import { secToHHMMSplit, combineHHMMSec } from '../../utils/time';

/**
 * Workouts tab container — owns every piece of state the tab's four views
 * (list / recipes / detail / builder) and the exercise picker need.
 *
 * Before this existed, all ~30 of these hooks lived in App.jsx and reached
 * WorkoutsTab through ~85 props, so a keystroke in the workout-name field
 * re-rendered the entire shell. Same pattern as PlansTabContainer: state
 * lives here, cross-tab entry points come in through a small imperative
 * ref API, and the container is mounted keep-alive (display:none) so a
 * builder draft survives tab switches exactly as it did when App held the
 * state.
 *
 * Ref API (the ONLY external write surface):
 *   showList()                    tab-bar press resets to the list view
 *   showBuilder()                 stats-prompt "← Back" (draft still intact)
 *   showSubTab(t)                 land on "reusable" | "oneoff"
 *   openBuilderWithExercises(xs)  StagingTray "Forge Workout"
 *   doDeleteWorkout(id)           ConfirmDeleteModal's workout branch
 */
const WorkoutsTabContainer = React.memo(React.forwardRef(function WorkoutsTabContainer({
  profile,
  setProfile,
  allExercises,
  allExById,
  clsColor,
  liveWorkout,
  startLiveWorkout,
  showToast,
  setConfirmDelete,
  openCompletionFlow,
  quickLogSoloEx,
  openQuickLog,
  setPendingSoloRemoveId,
  openScheduleEx,
  openExEditor,
  setAddToWorkoutPicker,
  setAddToPlanPicker,
}, ref) {
  // ── View ──
  const [workoutView, setWorkoutView] = useState("list"); // "list"|"detail"|"builder"|"recipes"
  const [workoutSubTab, setWorkoutSubTab] = useState("reusable"); // "reusable"|"oneoff"
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [collapsedWo, setCollapsedWo] = useState(() => new Set());

  // ── Builder ──
  const [wbName, setWbName] = useState("");
  const [wbIcon, setWbIcon] = useState("💪");
  const [wbIconPickerOpen, setWbIconPickerOpen] = useState(false);
  const [wbDesc, setWbDesc] = useState("");
  const [wbExercises, setWbExercises] = useState([]); // [{exId,sets,reps,weightLbs,durationMin,...}]
  const [wbEditId, setWbEditId] = useState(null); // id of workout being edited
  const [wbCopySource, setWbCopySource] = useState(null);
  const [wbIsOneOff, setWbIsOneOff] = useState(false);
  const [wbDuration, setWbDuration] = useState(""); // HH:MM string
  const [wbDurSec, setWbDurSec] = useState(""); // 0-59 seconds
  const [wbActiveCal, setWbActiveCal] = useState("");
  const [wbTotalCal, setWbTotalCal] = useState("");
  const [wbLabels, setWbLabels] = useState([]);
  const [newLabelInput, setNewLabelInput] = useState("");
  const [collapsedWbEx, setCollapsedWbEx] = useState({});
  const [ssChecked, setSsChecked] = useState(() => new Set());
  const [ssAccordion, setSsAccordion] = useState({});
  const [dragWbExIdx, setDragWbExIdx] = useState(null);

  // ── List / recipes ──
  const [woLabelFilters, setWoLabelFilters] = useState(() => new Set());
  const [woLabelDropOpen, setWoLabelDropOpen] = useState(false);
  const [recipeFilter, setRecipeFilter] = useState(() => new Set(["Bodyweight"]));
  const [recipeCatDrop, setRecipeCatDrop] = useState(false);
  const [expandedRecipeDesc, setExpandedRecipeDesc] = useState(() => new Set());
  const [expandedRecipeEx, setExpandedRecipeEx] = useState(() => new Set());

  // ── Exercise picker ──
  const [wbExPickerOpen, setWbExPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerMuscle, setPickerMuscle] = useState(() => new Set());
  const [pickerTypeFilter, setPickerTypeFilter] = useState(() => new Set());
  const [pickerEquipFilter, setPickerEquipFilter] = useState(() => new Set());
  const [pickerOpenDrop, setPickerOpenDrop] = useState(null);
  const [pickerSelected, setPickerSelected] = useState([]);

  const wbTotalXP = useMemo(() => wbExercises.reduce((s, ex) => s + calcExEntryXP(ex, profile.chosenClass, allExById), 0), [wbExercises, profile.chosenClass, allExById]);

  // ── Builder lifecycle (bodies relocated verbatim from App.jsx) ──
  // Clear EVERY builder field to its empty default. This container is
  // keep-alive (display:none), so any path that opens a fresh builder must go
  // through here first — otherwise a prior draft's duration/calories/labels/
  // copy-source/superset state leaks into the new workout and is saved with it.
  function resetBuilderFields() {
    setWbName("");
    setWbIcon("💪");
    setWbIconPickerOpen(false);
    setWbDesc("");
    setWbExercises([]);
    setWbEditId(null);
    setWbCopySource(null);
    setWbIsOneOff(false);
    setWbDuration("");
    setWbDurSec("");
    setWbActiveCal("");
    setWbTotalCal("");
    setWbLabels([]);
    setNewLabelInput("");
    setCollapsedWbEx({});
    setSsChecked(new Set());
    setSsAccordion({});
    setDragWbExIdx(null);
  }

  function initWorkoutBuilder(base) {
    resetBuilderFields();
    if (base) {
      setWbName(base.name);
      setWbIcon(base.icon);
      setWbDesc(base.desc || "");
      setWbExercises(base.exercises.map(e => ({ ...e })));
      setWbEditId(base.id);
      const split = base.durationMin ? secToHHMMSplit(Number(base.durationMin)) : { hhmm: "", sec: "" };
      const hasSec = split.sec && split.sec !== 0 && split.sec !== "";
      setWbDuration(hasSec ? `${split.hhmm}:${String(split.sec).padStart(2, "0")}` : (split.hhmm || ""));
      setWbActiveCal(base.activeCal || "");
      setWbTotalCal(base.totalCal || "");
      setWbLabels(base.labels || []);
    }
    setWorkoutView("builder");
  }

  function resetBuilderMeta() {
    setWorkoutView("list");
    setActiveWorkout(null);
    setWbEditId(null);
    setWbCopySource(null);
    setWbDuration("");
    setWbDurSec("");
    setWbActiveCal("");
    setWbTotalCal("");
    setWbLabels([]);
    setNewLabelInput("");
  }

  function saveBuiltWorkout() {
    if (!wbName.trim()) {
      showToast("Name your workout first!");
      return;
    }
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const w = buildWorkoutObject({
      id: wbEditId || uid(),
      name: wbName,
      icon: wbIcon,
      desc: wbDesc,
      exercises: wbExercises,
      createdAt: new Date().toLocaleDateString(),
      durationMin: combineHHMMSec(wbDuration, wbDurSec) || null,
      activeCal: wbActiveCal,
      totalCal: wbTotalCal,
      labels: wbLabels,
    });
    if (wbEditId) {
      setProfile(pr => ({
        ...pr,
        workouts: (pr.workouts || []).map(wo => wo.id === wbEditId ? w : wo)
      }));
      showToast("Workout updated! 💪");
    } else {
      setProfile(pr => ({
        ...pr,
        workouts: [w, ...(pr.workouts || [])]
      }));
      showToast("Workout created! 💪");
    }
    resetBuilderMeta();
  }

  function saveAsNewWorkout() {
    if (!wbName.trim()) {
      showToast("Name your workout first!");
      return;
    }
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const w = buildWorkoutObject({
      name: wbName,
      icon: wbIcon,
      desc: wbDesc,
      exercises: wbExercises,
      createdAt: new Date().toLocaleDateString(),
      durationMin: combineHHMMSec(wbDuration, wbDurSec) || null,
      activeCal: wbActiveCal,
      totalCal: wbTotalCal,
      labels: wbLabels,
    });
    setProfile(pr => ({
      ...pr,
      workouts: [w, ...(pr.workouts || [])]
    }));
    showToast("Saved as new workout! 💪");
    resetBuilderMeta();
  }

  function copyWorkout(wo) {
    setWbName("Copy of " + wo.name);
    setWbIcon(wo.icon);
    setWbDesc(wo.desc || "");
    setWbExercises(wo.exercises.map(e => ({ ...e })));
    setWbEditId(null); // new id on save
    setWbCopySource(wo.name);
    setWbLabels(wo.labels || []);
    setNewLabelInput("");
    setWorkoutView("builder");
  }

  function deleteWorkout(id) {
    const wo = (profile.workouts || []).find(w => w.id === id);
    setConfirmDelete({
      type: "workout",
      id,
      name: wo ? wo.name : "this workout",
      icon: wo ? wo.icon : "💪"
    });
  }

  function _doDeleteWorkout(id) {
    const wo = (profile.workouts || []).find(w => w.id === id);
    if (!wo) return;
    setProfile(p => ({
      ...p,
      workouts: (p.workouts || []).filter(w => w.id !== id),
      deletedItems: [...(p.deletedItems || []), {
        id: uid(),
        type: "workout",
        item: wo,
        deletedAt: new Date().toISOString()
      }]
    }));
    setWorkoutView("list");
    setActiveWorkout(null);
    showToast("Workout moved to Deleted — recoverable for 7 days.");
  }

  // ── Picker ──
  function closePicker() {
    setWbExPickerOpen(false);
    setPickerSearch("");
    setPickerMuscle(new Set());
    setPickerTypeFilter(new Set());
    setPickerEquipFilter(new Set());
    setPickerOpenDrop(null);
    setPickerSelected([]);
  }

  function pickerToggleEx(exId) {
    setPickerSelected(prev => {
      const exists = prev.find(e => e.exId === exId);
      if (exists) return prev.filter(e => e.exId !== exId);
      return [...prev, {
        exId,
        sets: "3",
        reps: "10",
        weightLbs: "",
        weightPct: 100,
        durationMin: "",
        distanceMi: "",
        hrZone: null
      }];
    });
  }

  function commitPickerToWorkout() {
    if (pickerSelected.length === 0) return;
    setWbExercises(ex => [...ex, ...pickerSelected.map(e => ({
      ...e,
      sets: e.sets || "",
      reps: e.reps || "",
      weightLbs: e.weightLbs || null,
      durationMin: e.durationMin || null,
      distanceMi: e.distanceMi || null
    }))]);
    closePicker();
  }

  // ── Reorder (bodies relocated verbatim from App.jsx) ──
  function reorderSupersetPair(anchorIdx, partnerIdx, direction) {
    setWbExercises(exs => {
      const arr = [...exs];
      const minI = Math.min(anchorIdx, partnerIdx);
      const maxI = Math.max(anchorIdx, partnerIdx);
      if (maxI - minI !== 1) {
        const [moved] = arr.splice(maxI, 1);
        arr.splice(minI + 1, 0, moved);
        const idxMap = {};
        const temp = exs.map((_, i) => i);
        const [movedI] = temp.splice(maxI, 1);
        temp.splice(minI + 1, 0, movedI);
        temp.forEach((oldI, newI) => {
          idxMap[oldI] = newI;
        });
        arr.forEach((e, ei) => {
          if (e.supersetWith != null && idxMap[e.supersetWith] != null) arr[ei] = {
            ...e,
            supersetWith: idxMap[e.supersetWith]
          };
        });
        return arr;
      }
      if (direction === "up" && minI > 0) {
        const above = arr[minI - 1];
        arr[minI - 1] = arr[minI];
        arr[minI] = arr[minI + 1];
        arr[minI + 1] = above;
        arr.forEach((e, ei) => {
          if (e.supersetWith === minI - 1) arr[ei] = { ...e, supersetWith: minI + 1 };
          else if (e.supersetWith === minI) arr[ei] = { ...e, supersetWith: minI - 1 };
          else if (e.supersetWith === minI + 1) arr[ei] = { ...e, supersetWith: minI };
        });
      } else if (direction === "down" && maxI < arr.length - 1) {
        const below = arr[maxI + 1];
        arr[maxI + 1] = arr[maxI];
        arr[maxI] = arr[minI];
        arr[minI] = below;
        arr.forEach((e, ei) => {
          if (e.supersetWith === minI) arr[ei] = { ...e, supersetWith: minI + 1 };
          else if (e.supersetWith === minI + 1) arr[ei] = { ...e, supersetWith: minI + 2 };
          else if (e.supersetWith === maxI + 1) arr[ei] = { ...e, supersetWith: minI };
        });
      }
      return arr;
    });
  }

  function reorderWbEx(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    setWbExercises(exs => {
      const arr = [...exs];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      const indexMap = {};
      const temp = exs.map((_, i) => i);
      const [movedIdx] = temp.splice(fromIdx, 1);
      temp.splice(toIdx, 0, movedIdx);
      temp.forEach((oldIdx, newIdx) => {
        indexMap[oldIdx] = newIdx;
      });
      return arr.map(e => {
        if (e.supersetWith != null && indexMap[e.supersetWith] != null) {
          return { ...e, supersetWith: indexMap[e.supersetWith] };
        }
        return e;
      });
    });
  }

  // ── The external write surface ──
  useImperativeHandle(ref, () => ({
    showList: () => setWorkoutView("list"),
    showBuilder: () => setWorkoutView("builder"),
    showSubTab: t => {
      setWorkoutView("list");
      setWorkoutSubTab(t);
    },
    openBuilderWithExercises: entries => {
      // Full reset first (keep-alive container may hold an abandoned draft's
      // duration/labels/calories/superset state), THEN seed the staged rows.
      resetBuilderFields();
      setWbExercises(entries);
      setWorkoutView("builder");
    },
    doDeleteWorkout: _doDeleteWorkout,
  }));

  const openStatsPrompt = useCallback(wo => openCompletionFlow(wo), [openCompletionFlow]);

  return (
    <>
      <WorkoutsTab
        workoutView={workoutView}
        setWorkoutView={setWorkoutView}
        workoutSubTab={workoutSubTab}
        setWorkoutSubTab={setWorkoutSubTab}
        woLabelFilters={woLabelFilters}
        setWoLabelFilters={setWoLabelFilters}
        woLabelDropOpen={woLabelDropOpen}
        setWoLabelDropOpen={setWoLabelDropOpen}
        newLabelInput={newLabelInput}
        setNewLabelInput={setNewLabelInput}
        activeWorkout={activeWorkout}
        setActiveWorkout={setActiveWorkout}
        liveWorkout={liveWorkout}
        startLiveWorkout={startLiveWorkout}
        collapsedWo={collapsedWo}
        setCollapsedWo={setCollapsedWo}
        profile={profile}
        setProfile={setProfile}
        recipeFilter={recipeFilter}
        setRecipeFilter={setRecipeFilter}
        recipeCatDrop={recipeCatDrop}
        setRecipeCatDrop={setRecipeCatDrop}
        expandedRecipeDesc={expandedRecipeDesc}
        setExpandedRecipeDesc={setExpandedRecipeDesc}
        expandedRecipeEx={expandedRecipeEx}
        setExpandedRecipeEx={setExpandedRecipeEx}
        wbName={wbName}
        setWbName={setWbName}
        wbIcon={wbIcon}
        setWbIcon={setWbIcon}
        wbDesc={wbDesc}
        setWbDesc={setWbDesc}
        wbExercises={wbExercises}
        setWbExercises={setWbExercises}
        wbEditId={wbEditId}
        setWbEditId={setWbEditId}
        wbIsOneOff={wbIsOneOff}
        setWbIsOneOff={setWbIsOneOff}
        wbLabels={wbLabels}
        setWbLabels={setWbLabels}
        wbDuration={wbDuration}
        setWbDuration={setWbDuration}
        wbDurSec={wbDurSec}
        setWbDurSec={setWbDurSec}
        wbActiveCal={wbActiveCal}
        setWbActiveCal={setWbActiveCal}
        wbTotalCal={wbTotalCal}
        setWbTotalCal={setWbTotalCal}
        wbCopySource={wbCopySource}
        setWbCopySource={setWbCopySource}
        wbIconPickerOpen={wbIconPickerOpen}
        setWbIconPickerOpen={setWbIconPickerOpen}
        wbExPickerOpen={wbExPickerOpen}
        setWbExPickerOpen={setWbExPickerOpen}
        wbTotalXP={wbTotalXP}
        collapsedWbEx={collapsedWbEx}
        setCollapsedWbEx={setCollapsedWbEx}
        ssChecked={ssChecked}
        setSsChecked={setSsChecked}
        ssAccordion={ssAccordion}
        setSsAccordion={setSsAccordion}
        dragWbExIdx={dragWbExIdx}
        setDragWbExIdx={setDragWbExIdx}
        initWorkoutBuilder={initWorkoutBuilder}
        copyWorkout={copyWorkout}
        openCompletionFlow={openStatsPrompt}
        setConfirmDelete={setConfirmDelete}
        openQuickLog={openQuickLog}
        setPendingSoloRemoveId={setPendingSoloRemoveId}
        quickLogSoloEx={quickLogSoloEx}
        openScheduleEx={openScheduleEx}
        setAddToWorkoutPicker={setAddToWorkoutPicker}
        openExEditor={openExEditor}
        setAddToPlanPicker={setAddToPlanPicker}
        deleteWorkout={deleteWorkout}
        reorderSupersetPair={reorderSupersetPair}
        reorderWbEx={reorderWbEx}
        saveBuiltWorkout={saveBuiltWorkout}
        saveAsNewWorkout={saveAsNewWorkout}
        showToast={showToast}
        allExById={allExById}
        clsColor={clsColor}
      />
      {wbExPickerOpen && (
        <WorkoutExercisePicker
          pickerSearch={pickerSearch}
          setPickerSearch={setPickerSearch}
          pickerMuscle={pickerMuscle}
          setPickerMuscle={setPickerMuscle}
          pickerTypeFilter={pickerTypeFilter}
          setPickerTypeFilter={setPickerTypeFilter}
          pickerEquipFilter={pickerEquipFilter}
          setPickerEquipFilter={setPickerEquipFilter}
          pickerOpenDrop={pickerOpenDrop}
          setPickerOpenDrop={setPickerOpenDrop}
          pickerSelected={pickerSelected}
          allExercises={allExercises}
          closePicker={closePicker}
          openExEditor={openExEditor}
          pickerToggleEx={pickerToggleEx}
          commitPickerToWorkout={commitPickerToWorkout}
        />
      )}
    </>
  );
}));

export default WorkoutsTabContainer;
