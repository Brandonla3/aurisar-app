import React, { memo, useState } from 'react';
import Sheet from '../../components/ui/Sheet';
import { DISCOVER_PICK_COUNT } from './discoverCategories';

/**
 * Nested/cascading picker for the Library home's up-to-3 "discover"
 * carousels.
 *
 * Deliberately not a checkbox list: a picked row reads as active via fill
 * plus a "Showing" tag rather than a checkbox square. Tapping a picked
 * category removes it; tapping an unpicked one adds it, evicting the
 * oldest pick only once already at the cap — so the count can freely sit
 * anywhere from 0 to DISCOVER_PICK_COUNT.
 *
 * Groups (By Difficulty / By Equipment / By Muscle) are collapsible —
 * reuses the .myex-accordion track/body pattern (0fr→1fr grid-rows) so
 * opening one doesn't require any height measurement.
 */
const DiscoverCustomizeMenu = memo(function DiscoverCustomizeMenu({ open, onClose, groups, counts, picks, onPick }) {
  const [openGroup, setOpenGroup] = useState(groups[0]?.group || null);
  const pickSet = new Set(picks);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      layer={"modal"}
      title={"Customize Discover"}
      ariaLabel={"Customize discover carousels"}
    >
      <p className={"discover-cust-hint"}>
        {`Pick up to ${DISCOVER_PICK_COUNT} categories for the home screen's carousels. Tap a picked category to remove it.`}
      </p>
      {picks.length === 0 && (
        <p className={"discover-cust-hint discover-cust-empty"}>
          {"Nothing picked — the home screen won't show any carousels until you add one below."}
        </p>
      )}
      {groups.map(g => {
        const isOpen = openGroup === g.group;
        const activeInGroup = g.categories.filter(c => pickSet.has(c.key)).length;
        return (
          <div key={g.group} className={"myex-accordion"}>
            <button
              type="button"
              className={"myex-accordion-hdr"}
              aria-expanded={isOpen}
              onClick={() => setOpenGroup(isOpen ? null : g.group)}
            >
              <span className={"myex-accordion-hdr-title"}>{g.group}</span>
              <span className={"myex-accordion-hdr-meta"}>{activeInGroup > 0 ? `${activeInGroup} showing` : ""}</span>
              <span className={`myex-accordion-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">{"▾"}</span>
            </button>
            <div className={`myex-accordion-track ${isOpen ? "open" : ""}`}>
              <div className={"myex-accordion-body"}>
                <div className={"myex-accordion-inner discover-cust-opts"}>
                  {g.categories.map(c => {
                    const active = pickSet.has(c.key);
                    const n = counts.get(c.key) || 0;
                    const disabled = n === 0 && !active;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`discover-cust-opt${active ? " on" : ""}`}
                        aria-pressed={active}
                        disabled={disabled}
                        onClick={() => onPick(c.key)}
                      >
                        <span className={"discover-cust-opt-label"}>{c.label}</span>
                        {active
                          ? <span className={"discover-cust-opt-tag"}>{"Showing"}</span>
                          : <span className={"discover-cust-opt-count"}>{n}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </Sheet>
  );
});

export default DiscoverCustomizeMenu;
