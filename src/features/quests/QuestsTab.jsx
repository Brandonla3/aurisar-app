import React, { memo } from 'react';
import { QUESTS } from '../../data/constants';
import { EXERCISES } from '../../data/exercises';
import { _optionalChain } from '../../utils/helpers';
import { formatXP } from '../../utils/format';
import { S, FS } from '../../utils/tokens';

/**
 * Quests tab — extracted from the inline fragment in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Pure presentational tab. State + setters come in as props from App;
 * no derivation work to lift into a hook.
 *
 * Wrapped in React.memo so unrelated App re-renders don't drag this tab
 * into a re-render when none of its props changed.
 */

const QuestsTab = memo(function QuestsTab({
  // Profile data
  profile,
  // Category filter
  questCat, setQuestCat,
  // Action callbacks (defined in App)
  claimQuestReward,
  claimManualQuest,
}) {
  return <><div className={"rpg-sec-header"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Deeds & Quests ✦"}</span><div className={"rpg-sec-line rpg-sec-line-r"} /></div>
          {
            /* Category filter */
          }<div className={"quest-cats"}>{["All", "Cardio", "Strength", "Flexibility", "Consistency", "Competition"].map(cat => <div key={cat} className={`quest-cat-btn ${questCat === cat ? "on" : ""}`} onClick={() => setQuestCat(cat)}>{cat}</div>)}</div>

          {
            /* Pending claims first */
          }{QUESTS.filter(q => {
            const qs = _optionalChain([profile, 'access', _a => _a.quests, 'optionalAccess', _b => _b[q.id]]);
            return _optionalChain([qs, 'optionalAccess', _c => _c.completed]) && !_optionalChain([qs, 'optionalAccess', _d => _d.claimed]) && (questCat === "All" || q.cat === questCat);
          }).map(q => {
            const qs = _optionalChain([profile, 'access', _e => _e.quests, 'optionalAccess', _f => _f[q.id]]) || {};
            return <div key={q.id} className={"quest-card complete"}><div className={"quest-top"}><div className={"quest-icon-wrap"}>{q.icon}</div><div style={{
                  flex: 1
                }}><div className={"quest-name"}>{q.name}</div><div className={"quest-desc"}>{q.desc}</div><div className={"quest-reward"}>{formatXP(q.xp, {
                      signed: true,
                      prefix: "⚡ "
                    })}{" reward"}</div></div><button className={"btn btn-gold btn-sm"} onClick={() => claimQuestReward(q.id)}>{"Claim!"}</button></div></div>;
          })

          /* All quests */}{QUESTS.filter(q => questCat === "All" || q.cat === questCat).map(q => {
            const qs = _optionalChain([profile, 'access', _g => _g.quests, 'optionalAccess', _h => _h[q.id]]) || {};
            if (qs.completed && !qs.claimed) return null; // shown above
            const isClaimed = qs.claimed;
            const isDone = qs.completed;
            // Progress for auto quests
            let progressText = null;
            if (!isDone && _optionalChain([q, 'access', _i => _i.auto, 'optionalAccess', _j => _j.exId])) {
              const cnt = profile.log.filter(e => _optionalChain([EXERCISES, 'access', _k => _k.find, 'call', _l => _l(ex => ex.name === e.exercise), 'optionalAccess', _m => _m.id]) === q.auto.exId).length;
              progressText = `${cnt} / ${q.auto.count}`;
            }
            if (!isDone && _optionalChain([q, 'access', _n => _n.auto, 'optionalAccess', _o => _o.total])) {
              progressText = `${profile.log.length} / ${q.auto.total} sessions`;
            }
            if (!isDone && q.streak) {
              progressText = `${profile.checkInStreak} / ${q.streak} day streak`;
            }
            return <div key={q.id} className={`quest-card ${isDone ? "complete" : ""} ${isClaimed ? "claimed" : ""}`}><div className={"quest-top"}><div className={"quest-icon-wrap"}>{q.icon}</div><div style={{
                  flex: 1
                }}><div className={"quest-name"}>{q.name}</div><div className={"quest-desc"}>{q.desc}</div>{progressText && !isDone && <div style={{
                    fontSize: FS.fs65,
                    color: "#8a8478",
                    marginTop: S.s4
                  }}>{"Progress: "}{progressText}</div>}<div className={"quest-reward"}>{isClaimed ? "✓ Claimed " + formatXP(q.xp) : formatXP(q.xp, {
                      signed: true,
                      prefix: "⚡ "
                    })}</div></div><div className={"quest-status"}>{isClaimed ? <div className={"quest-check claimed-check"}>{"✓"}</div> : isDone ? <div className={"quest-check done"}>{"!"}</div> : q.manual ? <button className={"btn btn-ghost btn-xs"} onClick={() => claimManualQuest(q.id)}>{"Done?"}</button> : <div className={"quest-check"}>{"○"}</div>}</div></div></div>;
          })}</>;
});

export default QuestsTab;
