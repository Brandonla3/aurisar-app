import React, { useState, useEffect } from 'react';
import { xpToLevel, xpForLevel, xpForNext } from '../../utils/xp';
import { formatXP } from '../../utils/format';

export default function XpBarFlash({ amount, mult, prevXp, cls }) {
  const [filled, setFilled] = useState(false);

  const safeXp = (prevXp != null && prevXp >= 0) ? prevXp : 0;
  const newXp = safeXp + amount;
  const prevLevel = xpToLevel(safeXp);
  const newLevel = xpToLevel(newXp);
  const leveledUp = newLevel > prevLevel;

  const levelStart = xpForLevel(newLevel);
  const levelEnd = xpForNext(newLevel);
  const span = Math.max(1, levelEnd - levelStart);

  const oldPct = leveledUp ? 0 : Math.min(100, Math.round((safeXp - levelStart) / span * 100));
  const newPct = Math.min(100, Math.round((newXp - levelStart) / span * 100));

  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="xp-bar-flash">
      <div className="xp-bar-flash-row">
        <span className="xp-bar-flash-level" style={{ color: cls.color }}>
          {leveledUp ? `Level Up! → Lv ${newLevel}` : `Lv ${newLevel}`}
        </span>
        <span className="xp-bar-flash-amount">
          {formatXP(amount, { signed: true })}{mult > 1.02 ? ' ⚡' : ''}
        </span>
      </div>
      <div className="xp-bar-flash-track">
        <div
          className="xp-bar-flash-fill"
          style={{
            width: (filled ? newPct : oldPct) + '%',
            background: `linear-gradient(90deg, color-mix(in srgb,${cls.color} 50%,transparent), ${cls.color})`,
          }}
        />
      </div>
    </div>
  );
}
