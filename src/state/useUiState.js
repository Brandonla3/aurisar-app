import { useState } from 'react';

/**
 * Bundle of session-only UI state for modals, dialogs, and overlay panels.
 *
 * Item 5a of the post-Sprint-3 plan: separating ephemeral UI state from the
 * persisted profile state. This hook holds all modal-related flags and form
 * drafts. None of it is persisted; everything resets on reload.
 *
 * Why a hook instead of context or Redux:
 *   App.jsx already calls 250+ useState hooks at the top level. Pulling a
 *   coherent subset out into a named hook gives a clear "this is UI state"
 *   boundary without any rendering or perf change — same React state, same
 *   identity, just declared in a separate file. The hook returns an object,
 *   App.jsx destructures it at the top so the rest of the render code is
 *   untouched.
 *
 * Future PRs (5a-2 etc.) will pull in more groups (filters, picker state,
 * onboarding form drafts, etc.). For now this is scoped to modal/dialog
 * state to keep the diff reviewable.
 */
export function useUiState() {
  // ── Exercise editor modal ────────────────────────────────────────────────
  const [exEditorOpen, setExEditorOpen] = useState(false);
  const [exEditorDraft, setExEditorDraft] = useState({});
  const [exEditorMode, setExEditorMode] = useState("create"); // "create"|"edit"|"copy"

  // ── Exercise detail modal (read-only) ────────────────────────────────────
  const [detailEx, setDetailEx] = useState(null);
  const [detailImgIdx, setDetailImgIdx] = useState(0);

  // ── Save-to-plan wizard ──────────────────────────────────────────────────
  const [savePlanWizard, setSavePlanWizard] = useState(null); // null | {entries, label}
  const [spwName, setSpwName] = useState("");
  const [spwIcon, setSpwIcon] = useState("📋");
  const [spwDate, setSpwDate] = useState(""); // YYYY-MM-DD
  const [spwSelected, setSpwSelected] = useState([]); // array of _idx selected
  const [spwMode, setSpwMode] = useState("new"); // within savePlanWizard
  const [spwTargetPlanId, setSpwTargetPlanId] = useState(null);

  // ── Schedule picker ──────────────────────────────────────────────────────
  const [schedulePicker, setSchedulePicker] = useState(null); // null | {type:"plan",plan} | {type:"ex",exId,name,icon}
  const [spDate, setSpDate] = useState("");
  const [spNotes, setSpNotes] = useState("");

  // ── Save-as-workout wizard ───────────────────────────────────────────────
  const [saveWorkoutWizard, setSaveWorkoutWizard] = useState(null); // null | {entries, label}
  const [swwName, setSwwName] = useState("");
  const [swwIcon, setSwwIcon] = useState("💪");
  const [swwSelected, setSwwSelected] = useState([]);

  // ── Workout-builder exercise picker ──────────────────────────────────────
  const [wbExPickerOpen, setWbExPickerOpen] = useState(false);

  // ── Add-to-plan / add-to-workout pickers ─────────────────────────────────
  const [addToPlanPicker, setAddToPlanPicker] = useState(null);
  const [addToWorkoutPicker, setAddToWorkoutPicker] = useState(null); // {exercises} — pick existing workout

  // ── Retro check-in / retro edit ──────────────────────────────────────────
  const [retroCheckInModal, setRetroCheckInModal] = useState(false);
  const [retroDate, setRetroDate] = useState("");
  const [retroEditModal, setRetroEditModal] = useState(null); // {groupId, entries, dateKey, sourceType, sourceName, sourceIcon, sourceId}

  // ── Stats prompt modal ───────────────────────────────────────────────────
  const [statsPromptModal, setStatsPromptModal] = useState(null);
  const [spDuration, setSpDuration] = useState(""); // HH:MM
  const [spDurSec, setSpDurSec] = useState(""); // seconds
  const [spActiveCal, setSpActiveCal] = useState("");
  const [spTotalCal, setSpTotalCal] = useState("");
  const [spMakeReusable, setSpMakeReusable] = useState(false);

  // ── Calendar exercise read-only modal ────────────────────────────────────
  const [calExDetailModal, setCalExDetailModal] = useState(null);

  // ── One-off workout naming modal ─────────────────────────────────────────
  const [oneOffModal, setOneOffModal] = useState(null); // {exercises, name, icon} — naming step

  // ── Workout completion modal ─────────────────────────────────────────────
  const [completionModal, setCompletionModal] = useState(null); // null | {workout}
  const [completionDate, setCompletionDate] = useState(""); // YYYY-MM-DD
  const [completionAction, setCompletionAction] = useState("today"); // "today"|"past"|"schedule"
  const [scheduleWoDate, setScheduleWoDate] = useState(""); // future date for scheduling

  // ── Log edit modal ───────────────────────────────────────────────────────
  const [logEditModal, setLogEditModal] = useState(null); // null | {idx}
  const [logEditDraft, setLogEditDraft] = useState(null); // copy of the entry being edited

  // ── Confirm delete modal ─────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(null); // null | {type, id, name, icon, …}

  // ── Share modal ──────────────────────────────────────────────────────────
  const [shareModal, setShareModal] = useState(null); // {type:"workout"|"exercise", item, friendId?, friendName?}

  // ── Feedback / help modal ────────────────────────────────────────────────
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackType, setFeedbackType] = useState("idea"); // "idea"|"bug"|"help"
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackAccountId, setFeedbackAccountId] = useState("");
  const [helpConfirmShown, setHelpConfirmShown] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  // ── Map / nav menu / mockup overlays ─────────────────────────────────────
  const [mapOpen, setMapOpen] = useState(false);
  const [mapTooltip, setMapTooltip] = useState(null); // {name, x, y, info}
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [showWNMockup, setShowWNMockup] = useState(false);

  // ── Notifications / banners ──────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const [friendExBanner, setFriendExBanner] = useState(null);
  const [xpFlash, setXpFlash] = useState(null);

  return {
    // Exercise editor
    exEditorOpen, setExEditorOpen, exEditorDraft, setExEditorDraft, exEditorMode, setExEditorMode,
    // Exercise detail
    detailEx, setDetailEx, detailImgIdx, setDetailImgIdx,
    // Save-to-plan wizard
    savePlanWizard, setSavePlanWizard, spwName, setSpwName, spwIcon, setSpwIcon, spwDate, setSpwDate,
    spwSelected, setSpwSelected, spwMode, setSpwMode, spwTargetPlanId, setSpwTargetPlanId,
    // Schedule picker
    schedulePicker, setSchedulePicker, spDate, setSpDate, spNotes, setSpNotes,
    // Save-as-workout wizard
    saveWorkoutWizard, setSaveWorkoutWizard, swwName, setSwwName, swwIcon, setSwwIcon, swwSelected, setSwwSelected,
    // Workout-builder picker
    wbExPickerOpen, setWbExPickerOpen,
    // Add-to-plan / add-to-workout
    addToPlanPicker, setAddToPlanPicker, addToWorkoutPicker, setAddToWorkoutPicker,
    // Retro
    retroCheckInModal, setRetroCheckInModal, retroDate, setRetroDate,
    retroEditModal, setRetroEditModal,
    // Stats prompt
    statsPromptModal, setStatsPromptModal, spDuration, setSpDuration, spDurSec, setSpDurSec,
    spActiveCal, setSpActiveCal, spTotalCal, setSpTotalCal, spMakeReusable, setSpMakeReusable,
    // Calendar exercise detail
    calExDetailModal, setCalExDetailModal,
    // One-off
    oneOffModal, setOneOffModal,
    // Completion
    completionModal, setCompletionModal, completionDate, setCompletionDate,
    completionAction, setCompletionAction, scheduleWoDate, setScheduleWoDate,
    // Log edit
    logEditModal, setLogEditModal, logEditDraft, setLogEditDraft,
    // Confirm delete
    confirmDelete, setConfirmDelete,
    // Share
    shareModal, setShareModal,
    // Feedback
    feedbackOpen, setFeedbackOpen, feedbackText, setFeedbackText, feedbackType, setFeedbackType,
    feedbackSent, setFeedbackSent, feedbackEmail, setFeedbackEmail, feedbackAccountId, setFeedbackAccountId,
    helpConfirmShown, setHelpConfirmShown, turnstileToken, setTurnstileToken,
    // Map / nav menu / mockup
    mapOpen, setMapOpen, mapTooltip, setMapTooltip, navMenuOpen, setNavMenuOpen,
    showWNMockup, setShowWNMockup,
    // Notifications
    toast, setToast, friendExBanner, setFriendExBanner, xpFlash, setXpFlash,
  };
}
