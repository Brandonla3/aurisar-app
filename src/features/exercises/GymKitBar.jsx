import React, { memo, useState } from 'react';
import { EQUIP_OPTS, equipLabel } from './exerciseFilterOptions';
import { S, R, FS } from '../../utils/tokens';

/**
 * "Equipment I have" — a persistent filter for the kit actually available.
 *
 * The equipment facet answers "show me barbell exercises right now". This
 * answers the different question of "I train at home and will never own a
 * landmine, stop offering me those at all". It is stored on the profile, so
 * it survives sessions and applies to every list the library derives.
 *
 * Off by default (`gymKit === null`) and deliberately loud when on: silently
 * hiding two thirds of a 1,500-exercise catalog is exactly the kind of
 * unexplained emptiness this whole effort has been removing.
 */

const GymKitBar = memo(function GymKitBar({ gymKit, setGymKit, totalShown, totalAll }) {
  const [open, setOpen] = useState(false);
  const active = Array.isArray(gymKit);
  const owned = new Set(gymKit || []);

  const toggle = eq => {
    const next = new Set(owned);
    next.has(eq) ? next.delete(eq) : next.add(eq);
    setGymKit([...next]);
  };

  return (
    <div className={`gymkit${active ? " gymkit-on" : ""}`}>
      <div className={"gymkit-row"}>
        <button
          type="button"
          className={"gymkit-toggle"}
          aria-expanded={open}
          aria-controls={"gymkit-panel"}
          onClick={() => setOpen(o => !o)}
        >
          <span aria-hidden="true">{active ? "🎒" : "🎒"}</span>
          <span>{active ? "My kit" : "Filter by my kit"}</span>
          {active && <span className={"gymkit-count"}>{`${totalShown} of ${totalAll}`}</span>}
          <span aria-hidden="true" className={"gymkit-chev"}>{open ? "▾" : "▸"}</span>
        </button>
        {active && (
          <button
            type="button"
            className={"gymkit-clear"}
            onClick={() => { setGymKit(null); setOpen(false); }}
          >{"Show all"}</button>
        )}
      </div>

      {open && (
        <div className={"gymkit-panel"} id={"gymkit-panel"}>
          <p className={"gymkit-hint"}>
            {"Pick what you can train with. Bodyweight is always included."}
          </p>
          <div className={"gymkit-opts"}>
            {EQUIP_OPTS.filter(e => e !== "bodyweight").map(eq => {
              const on = owned.has(eq);
              return (
                <button
                  key={eq}
                  type="button"
                  className={`gymkit-opt${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggle(eq)}
                >{equipLabel(eq)}</button>
              );
            })}
          </div>
          {active && owned.size === 0 && (
            <p className={"gymkit-hint gymkit-warn"} role={"status"}>
              {"Nothing selected — showing bodyweight exercises only."}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

export default GymKitBar;
