import React, { memo } from 'react';
import ConfirmSheet from './ui/ConfirmSheet';

/**
 * Confirm-delete modal — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 * Now a thin adapter over the shared ConfirmSheet primitive, so destructive
 * prompts render on the confirm layer (above every other overlay) with the
 * standard backdrop, motion and ≥44px targets.
 *
 * Supports two modes:
 *   - Generic: payload has {title, body, onConfirm, confirmLabel, cancelLabel}
 *   - Type-based: payload has {type, id, name, xp, icon, warning}
 *     where type ∈ "plan" | "workout" | "exercise" | "logEntry" | "char"
 */

const ConfirmDeleteModal = memo(function ConfirmDeleteModal({
  confirmDelete,
  setConfirmDelete,
  plansContainerRef,
  _doDeleteWorkout,
  _doDeleteCustomEx,
  _doDeleteLogEntry,
  _doResetChar,
}) {
  if (!confirmDelete) return null;
  const cd = confirmDelete;
  const isGeneric = typeof cd.onConfirm === 'function';
  const titleText = cd.title || (cd.type === "plan" ? "Delete Plan?" : cd.type === "workout" ? "Delete Workout?" : cd.type === "exercise" ? "Delete Exercise?" : cd.type === "logEntry" ? "Delete Log Entry?" : cd.type === "char" ? "Delete Character?" : "Are you sure?");
  const bodyEl = cd.body ? typeof cd.body === 'string' ? <span>{cd.body}</span> : cd.body : cd.type === "char" ? "This will permanently erase all your XP, battle log, plans, and workouts. This cannot be undone." : cd.type === "logEntry" ? <span>{"Remove "}<span className={"cdel-name"}>{cd.name}</span>{" from your log? "}{cd.xp && <span>{"This will deduct "}{cd.xp}{" XP."}</span>}</span> : <span>{"Are you sure you want to delete "}<span className={"cdel-name"}>{cd.name}</span>{"? This cannot be undone."}</span>;
  return (
    <ConfirmSheet
      open
      icon={cd.icon}
      title={titleText}
      body={<>
        {bodyEl}
        {cd.warning && <div className={"cdel-warning"}>{cd.warning}</div>}
      </>}
      confirmLabel={cd.confirmLabel || "🗑 Delete"}
      cancelLabel={cd.cancelLabel || "Cancel"}
      danger
      onCancel={() => setConfirmDelete(null)}
      onConfirm={() => {
        setConfirmDelete(null);
        if (isGeneric) {
          cd.onConfirm();
          return;
        }
        const { type, id } = cd;
        if (type === "plan") plansContainerRef.current?.doDeletePlan(id);
        else if (type === "workout") _doDeleteWorkout(id);
        else if (type === "exercise") _doDeleteCustomEx(id);
        else if (type === "logEntry") _doDeleteLogEntry(id);
        else if (type === "char") _doResetChar();
      }}
    />
  );
});

export default ConfirmDeleteModal;
