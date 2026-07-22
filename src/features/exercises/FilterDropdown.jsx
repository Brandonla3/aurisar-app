import React, { useEffect, useMemo, useRef, useState } from 'react';
import { S, R, FS } from '../../utils/tokens';

/**
 * Multi-select filter dropdown for the exercise library.
 *
 * Replaces three near-identical hand-rolled dropdowns that were plain divs
 * with onClick handlers — no roles, no aria-expanded, no keyboard path. This
 * one is a real listbox: arrows move the active option, Enter/Space toggles,
 * Escape closes and returns focus to the trigger, Home/End jump.
 *
 * Each option carries its faceted count — how many exercises selecting it
 * would leave, given the search and the other two dimensions. Options that
 * would empty the list are disabled rather than silently returning nothing,
 * which is the failure that used to read as "the catalog is broken".
 */

function FilterDropdown({
  id,
  label,          // "Type" — shown when nothing is selected
  shortLabel,     // "Type" — shown with a count when something is
  options,        // [value, ...]
  optionLabel,    // value => display string
  selected,       // Set
  counts,         // Map<value, number>
  onToggle,       // value => void
  open,
  setOpen,        // (openOrNull) => void — null closes
  accent,         // colour for the selected state
  optionAccent,   // optional value => colour, for per-option tinting
  panelBorder,
}) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const optionRefs = useRef([]);

  const enabled = useMemo(
    () => options.map(v => selected.has(v) || (counts.get(v) || 0) > 0),
    [options, selected, counts]
  );

  // Opening lands the active option on the first selected entry, or the first
  // selectable one, so keyboard users don't start from nowhere. Adjusted
  // during render rather than in an effect — setting state from an effect here
  // would render the list once at the wrong index and then again to correct it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const firstSel = options.findIndex(v => selected.has(v));
      setActiveIdx(firstSel >= 0 ? firstSel : enabled.findIndex(Boolean));
    } else {
      setActiveIdx(-1);
    }
  }

  // Focus is a DOM side effect, so it does belong in an effect. React's
  // autoFocus is unreliable on a conditionally-rendered tabIndex={-1} node.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open && activeIdx >= 0) optionRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const step = dir => {
    if (!enabled.some(Boolean)) return;
    let i = activeIdx;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (enabled[i]) { setActiveIdx(i); return; }
    }
  };

  const onTriggerKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(id);
    }
  };

  const onListKey = e => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Home': e.preventDefault(); setActiveIdx(enabled.findIndex(Boolean)); break;
      case 'End': e.preventDefault(); setActiveIdx(enabled.lastIndexOf(true)); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIdx >= 0 && enabled[activeIdx]) onToggle(options[activeIdx]);
        break;
      case 'Escape':
      case 'Tab':
        // Escape closes in place; Tab closes and lets focus move on.
        if (e.key === 'Escape') { e.preventDefault(); triggerRef.current?.focus(); }
        setOpen(null);
        break;
      default: break;
    }
  };

  const count = selected.size;
  const triggerColor = count > 0 ? accent : "#8a8478";

  return (
    <div style={{ position: "relative", flex: "1 1 110px", zIndex: 20 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => setOpen(open ? null : id)}
        onKeyDown={onTriggerKey}
        style={{
          width: "100%",
          padding: "8px 28px 8px 10px",
          borderRadius: R.xl,
          border: "1px solid " + (count > 0 ? accent : "rgba(45,42,36,.3)"),
          background: "rgba(14,14,12,.95)",
          color: triggerColor,
          fontSize: FS.lg,
          textAlign: "left",
          cursor: "pointer",
          position: "relative"
        }}
      >
        {count > 0 ? `${shortLabel} (${count})` : label}
        <span aria-hidden="true" style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
          color: triggerColor,
          fontSize: FS.sm,
          transition: "transform var(--dur-fast) var(--ease-standard)",
          lineHeight: 1
        }}>{"▼"}</span>
      </button>

      {open && <div
        ref={listRef}
        id={`${id}-listbox`}
        role="listbox"
        aria-multiselectable="true"
        aria-label={label}
        // Focus stays on the listbox and the "current" option is announced via
        // activedescendant, which is what lets one keydown handler drive the
        // whole list instead of roving tabindex across every option.
        aria-activedescendant={activeIdx >= 0 ? `${id}-opt-${activeIdx}` : undefined}
        tabIndex={-1}
        onKeyDown={onListKey}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          minWidth: "100%",
          maxHeight: 260,
          overflowY: "auto",
          background: "rgba(16,14,10,.95)",
          border: `1px solid ${panelBorder}`,
          borderRadius: R.xl,
          padding: "6px 4px",
          zIndex: 21,
          boxShadow: "0 8px 24px rgba(0,0,0,.6)",
          outline: "none"
        }}
      >
        {options.map((val, i) => {
          const sel = selected.has(val);
          const isEnabled = enabled[i];
          const n = counts.get(val) || 0;
          const tint = optionAccent ? optionAccent(val) : accent;
          const isActive = i === activeIdx;
          return (
            <div
              key={val}
              id={`${id}-opt-${i}`}
              ref={el => { optionRefs.current[i] = el; }}
              role="option"
              tabIndex={-1}
              aria-selected={sel}
              aria-disabled={!isEnabled}
              onClick={() => isEnabled && onToggle(val)}
              onMouseEnter={() => isEnabled && setActiveIdx(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                padding: "6px 10px",
                borderRadius: R.md,
                cursor: isEnabled ? "pointer" : "default",
                opacity: isEnabled ? 1 : 0.35,
                background: sel
                  ? `color-mix(in srgb, ${tint} 14%, transparent)`
                  : isActive ? "rgba(45,42,36,.28)" : "transparent",
                boxShadow: isActive ? `inset 0 0 0 1px color-mix(in srgb, ${tint} 30%, transparent)` : "none",
              }}
            >
              <div aria-hidden="true" style={{
                width: 14,
                height: 14,
                borderRadius: R.r3,
                flexShrink: 0,
                border: "1.5px solid " + (sel ? tint : "rgba(180,172,158,.18)"),
                background: sel ? `color-mix(in srgb, ${tint} 25%, transparent)` : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                {sel && <span style={{ fontSize: FS.sm, color: tint, lineHeight: 1 }}>{"✓"}</span>}
              </div>
              <span style={{
                fontSize: FS.lg,
                color: sel ? tint : isEnabled ? "#b4ac9e" : "#8a8478",
                whiteSpace: "nowrap",
                flex: 1
              }}>{optionLabel(val)}</span>
              <span style={{
                fontSize: FS.fs60,
                color: isEnabled ? "#6f6a62" : "#4a463f",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0
              }}>{n}</span>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

export default React.memo(FilterDropdown);
