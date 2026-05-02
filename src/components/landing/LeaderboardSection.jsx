import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClassSigil, classColor } from './ClassesSection.jsx';

const LB_FILTERS = [
  { key: 'overall_xp',     label: 'Overall XP',           sub: 'Total XP earned all time',  fmt: (n) => n.toLocaleString() + ' XP', icon: 'xp' },
  { key: 'bench',          label: 'Bench Press · 1RM',    sub: 'Heaviest estimated 1-rep max', fmt: (n) => n + ' lbs',  icon: 'bar' },
  { key: 'squat',          label: 'Back Squat · 1RM',     sub: 'Heaviest estimated 1-rep max', fmt: (n) => n + ' lbs',  icon: 'bar' },
  { key: 'deadlift',       label: 'Deadlift · 1RM',       sub: 'Heaviest estimated 1-rep max', fmt: (n) => n + ' lbs',  icon: 'bar' },
  { key: 'overhead_press', label: 'Overhead Press · 1RM', sub: 'Heaviest strict OHP',          fmt: (n) => n + ' lbs',  icon: 'bar' },
  { key: 'pull_up',        label: 'Pull-Ups · Max Reps',  sub: 'Max reps in a single set',     fmt: (n) => n + ' reps', icon: 'pull' },
  { key: 'push_up',        label: 'Push-Ups · Max Reps',  sub: 'Max reps in a single set',     fmt: (n) => n + ' reps', icon: 'push' },
  { key: 'running',        label: 'Running · 1-Mile Pace', sub: 'Fastest recorded mile pace',  fmt: (n) => n + ' /mi',  icon: 'run' },
];

const LB_PLAYERS_BY_FILTER = {
  overall_xp: [
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 320000, friend: true, you: true },
    { name: 'Kaelric Thorn',  cls: 'warlord',   handle: 'K4X9PQ', lvl: 38, state: 'TX', country: 'US', gym: 'EoS Fitness',      streak: 62, val: 298400, friend: true },
    { name: 'Liora Vance',    cls: 'tempest',   handle: 'L7M3BN', lvl: 36, state: 'CO', country: 'US', gym: 'Chuze Fitness',    streak: 48, val: 274200 },
    { name: 'Soma Ikedo',     cls: 'phantom',   handle: 'S8K2RV', lvl: 34, state: 'CA', country: 'US', gym: 'Equinox',          streak: 41, val: 262100 },
    { name: 'Dain Westbrook', cls: 'warrior',   handle: 'D3N9WB', lvl: 33, state: 'OH', country: 'US', gym: 'Planet Fitness',   streak: 19, val: 248800 },
    { name: 'Everen Aydin',   cls: 'oracle',    handle: 'E6V2YD', lvl: 32, state: 'NY', country: 'US', gym: 'Crunch Fitness',   streak: 88, val: 236400, friend: true },
    { name: 'Ro Halvarsen',   cls: 'warden',    handle: 'R5H7AL', lvl: 30, state: 'MT', country: 'US', gym: 'Home Gym',         streak: 27, val: 219500 },
    { name: 'Nyssa Brand',    cls: 'druid',     handle: 'N2B8DX', lvl: 29, state: 'OR', country: 'US', gym: 'YogaSix',          streak: 52, val: 204100 },
    { name: 'Cassian Reiter', cls: 'gladiator', handle: 'C9R4KT', lvl: 28, state: 'FL', country: 'US', gym: "Gold's Gym",       streak: 14, val: 194700 },
    { name: 'Mirei Okafor',   cls: 'striker',   handle: 'M2O6FR', lvl: 27, state: 'IL', country: 'US', gym: '10th Planet',      streak: 31, val: 188300 },
  ],
  bench: [
    { name: 'Dain Westbrook', cls: 'warlord',   handle: 'D3N9WB', lvl: 33, state: 'OH', country: 'US', gym: 'Elite Barbell',    streak: 19, val: 475 },
    { name: 'Kaelric Thorn',  cls: 'warlord',   handle: 'K4X9PQ', lvl: 38, state: 'TX', country: 'US', gym: 'EoS Fitness',      streak: 62, val: 455, friend: true },
    { name: 'Grigor Ostrov',  cls: 'titan',     handle: 'G8T3OS', lvl: 31, state: 'PA', country: 'US', gym: 'Iron & Oak',       streak: 22, val: 440 },
    { name: 'Cassian Reiter', cls: 'gladiator', handle: 'C9R4KT', lvl: 28, state: 'FL', country: 'US', gym: "Gold's Gym",       streak: 14, val: 405 },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 285, you: true, friend: true },
    { name: 'Soma Ikedo',     cls: 'phantom',   handle: 'S8K2RV', lvl: 34, state: 'CA', country: 'US', gym: 'Equinox',          streak: 41, val: 275 },
  ],
  squat: [
    { name: 'Grigor Ostrov',  cls: 'titan',     handle: 'G8T3OS', lvl: 31, state: 'PA', country: 'US', gym: 'Iron & Oak',       streak: 22, val: 585 },
    { name: 'Dain Westbrook', cls: 'warlord',   handle: 'D3N9WB', lvl: 33, state: 'OH', country: 'US', gym: 'Elite Barbell',    streak: 19, val: 555 },
    { name: 'Kaelric Thorn',  cls: 'warlord',   handle: 'K4X9PQ', lvl: 38, state: 'TX', country: 'US', gym: 'EoS Fitness',      streak: 62, val: 525, friend: true },
    { name: 'Cassian Reiter', cls: 'gladiator', handle: 'C9R4KT', lvl: 28, state: 'FL', country: 'US', gym: "Gold's Gym",       streak: 14, val: 475 },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 335, you: true, friend: true },
  ],
  deadlift: [
    { name: 'Grigor Ostrov',  cls: 'titan',     handle: 'G8T3OS', lvl: 31, state: 'PA', country: 'US', gym: 'Iron & Oak',       streak: 22, val: 655 },
    { name: 'Kaelric Thorn',  cls: 'warlord',   handle: 'K4X9PQ', lvl: 38, state: 'TX', country: 'US', gym: 'EoS Fitness',      streak: 62, val: 605, friend: true },
    { name: 'Dain Westbrook', cls: 'warlord',   handle: 'D3N9WB', lvl: 33, state: 'OH', country: 'US', gym: 'Elite Barbell',    streak: 19, val: 585 },
    { name: 'Cassian Reiter', cls: 'gladiator', handle: 'C9R4KT', lvl: 28, state: 'FL', country: 'US', gym: "Gold's Gym",       streak: 14, val: 515 },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 385, you: true, friend: true },
  ],
  overhead_press: [
    { name: 'Dain Westbrook', cls: 'warlord',   handle: 'D3N9WB', lvl: 33, state: 'OH', country: 'US', gym: 'Elite Barbell',    streak: 19, val: 255 },
    { name: 'Grigor Ostrov',  cls: 'titan',     handle: 'G8T3OS', lvl: 31, state: 'PA', country: 'US', gym: 'Iron & Oak',       streak: 22, val: 245 },
    { name: 'Cassian Reiter', cls: 'gladiator', handle: 'C9R4KT', lvl: 28, state: 'FL', country: 'US', gym: "Gold's Gym",       streak: 14, val: 225 },
    { name: 'Kaelric Thorn',  cls: 'warlord',   handle: 'K4X9PQ', lvl: 38, state: 'TX', country: 'US', gym: 'EoS Fitness',      streak: 62, val: 215, friend: true },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 165, you: true, friend: true },
  ],
  pull_up: [
    { name: 'Soma Ikedo',     cls: 'phantom',   handle: 'S8K2RV', lvl: 34, state: 'CA', country: 'US', gym: 'Equinox',          streak: 41, val: 42 },
    { name: 'Mirei Okafor',   cls: 'striker',   handle: 'M2O6FR', lvl: 27, state: 'IL', country: 'US', gym: '10th Planet',      streak: 31, val: 38 },
    { name: 'Ro Halvarsen',   cls: 'warden',    handle: 'R5H7AL', lvl: 30, state: 'MT', country: 'US', gym: 'Home Gym',         streak: 27, val: 32 },
    { name: 'Nyssa Brand',    cls: 'druid',     handle: 'N2B8DX', lvl: 29, state: 'OR', country: 'US', gym: 'YogaSix',          streak: 52, val: 28 },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 15, you: true, friend: true },
  ],
  push_up: [
    { name: 'Mirei Okafor',   cls: 'striker',   handle: 'M2O6FR', lvl: 27, state: 'IL', country: 'US', gym: '10th Planet',      streak: 31, val: 108 },
    { name: 'Soma Ikedo',     cls: 'phantom',   handle: 'S8K2RV', lvl: 34, state: 'CA', country: 'US', gym: 'Equinox',          streak: 41, val: 96 },
    { name: 'Ro Halvarsen',   cls: 'warden',    handle: 'R5H7AL', lvl: 30, state: 'MT', country: 'US', gym: 'Home Gym',         streak: 27, val: 85 },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: 62, you: true, friend: true },
  ],
  running: [
    { name: 'Liora Vance',    cls: 'tempest',   handle: 'L7M3BN', lvl: 36, state: 'CO', country: 'US', gym: 'Chuze Fitness',    streak: 48, val: '5:02' },
    { name: 'Test Majiq',     cls: 'tempest',   handle: 'V7G2YY', lvl: 42, state: 'KS', country: 'US', gym: 'Lifetime Fitness', streak: 34, val: '5:48', you: true, friend: true },
    { name: 'Nyssa Brand',    cls: 'druid',     handle: 'N2B8DX', lvl: 29, state: 'OR', country: 'US', gym: 'YogaSix',          streak: 52, val: '6:14' },
    { name: 'Mirei Okafor',   cls: 'striker',   handle: 'M2O6FR', lvl: 27, state: 'IL', country: 'US', gym: '10th Planet',      streak: 31, val: '6:28' },
    { name: 'Ro Halvarsen',   cls: 'warden',    handle: 'R5H7AL', lvl: 30, state: 'MT', country: 'US', gym: 'Home Gym',         streak: 27, val: '6:41' },
  ],
};

const US_STATES = ['All States', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'];
const COUNTRIES = ['All Countries', 'United States'];
const COUNTRY_CODE = { 'United States': 'US' };

function Medal({ rank }) {
  const colors =
    rank === 1 ? ['#f4cf5a', '#b8871a', '#7a5610']
    : rank === 2 ? ['#d8d8d8', '#8f8f8f', '#5a5a5a']
    : rank === 3 ? ['#cd8142', '#8c4a1a', '#5a2f0f']
    : ['#8b7a5a', '#5a4e38', '#3a3223'];
  return (
    <svg viewBox="0 0 32 40" width="28" height="36" style={{ flexShrink: 0 }}>
      <path d="M6 2 L16 14 L26 2 L26 8 L18 18 L14 18 L6 8 Z" fill={colors[1]} opacity=".85" />
      <circle cx="16" cy="26" r="11" fill={colors[0]} stroke={colors[2]} strokeWidth="1.5" />
      <circle cx="16" cy="26" r="7" fill="none" stroke={colors[1]} strokeWidth=".8" opacity=".6" />
      <text x="16" y="30" textAnchor="middle" fill={colors[2]} fontSize="11" fontWeight="800" fontFamily="system-ui">
        {rank}
      </text>
    </svg>
  );
}

function LBCatIcon({ type, size = 16 }) {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (type) {
    case 'xp':
      return <svg {...props}><path d="M6 6 L18 18 M18 6 L6 18" /></svg>;
    case 'bar':
      return (
        <svg {...props}>
          <rect x="3" y="10" width="2" height="4" />
          <rect x="19" y="10" width="2" height="4" />
          <rect x="5" y="8" width="2" height="8" />
          <rect x="17" y="8" width="2" height="8" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
      );
    case 'pull':
      return <svg {...props}><path d="M4 4 H20 M8 4 V10 M16 4 V10 M10 10 Q12 14 14 10 M12 10 V16 M9 16 H15 M10 20 H14" /></svg>;
    case 'push':
      return <svg {...props}><path d="M3 18 H21 M6 14 L10 10 L16 12 L20 10" /><circle cx="10" cy="10" r="1.4" fill="currentColor" /></svg>;
    case 'run':
      return (
        <svg {...props}>
          <circle cx="15" cy="4.5" r="1.8" fill="currentColor" />
          <path d="M5 20 L9 15 L7 11 L12 9 L16 12 L19 11 M9 15 L11 12 M11 12 L14 20 M7 11 L4 13" />
        </svg>
      );
    default:
      return <svg {...props}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

function LBDropdown({ value, options, onChange, icon, wide }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className={'landing-lb-drop' + (wide ? ' landing-lb-drop-wide' : '')} ref={ref}>
      <button className={'landing-lb-drop-btn' + (open ? ' landing-lb-drop-open' : '')} onClick={() => setOpen((v) => !v)}>
        {icon && <span className="landing-lb-drop-icon">{icon}</span>}
        <span className="landing-lb-drop-val">{value}</span>
        <svg viewBox="0 0 12 8" width="10" height="8" className="landing-lb-drop-chev">
          <path d="M1 1 L6 7 L11 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="landing-lb-drop-menu">
          {options.map((o) => {
            const v = o.value || o;
            return (
              <button key={v} className={'landing-lb-drop-opt' + (v === value ? ' landing-lb-drop-selected' : '')} onClick={() => { onChange(v); setOpen(false); }}>
                {o.icon && <span className="landing-lb-drop-icon">{o.icon}</span>}
                <span>{o.label || o}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function LeaderboardSection() {
  const [scope, setScope] = useState('world');
  const [stateF, setStateF] = useState('All States');
  const [country, setCountry] = useState('United States');
  const [filter, setFilter] = useState('overall_xp');
  const [pulseIdx, setPulseIdx] = useState(null);

  const curFilter = LB_FILTERS.find((f) => f.key === filter);
  const allRows = LB_PLAYERS_BY_FILTER[filter] || [];

  const filteredRows = useMemo(() => {
    let rows = allRows.slice();
    if (scope === 'friends') rows = rows.filter((r) => r.friend);
    if (stateF !== 'All States') rows = rows.filter((r) => r.state === stateF);
    if (country !== 'All Countries') {
      const code = COUNTRY_CODE[country];
      if (code) rows = rows.filter((r) => r.country === code);
    }
    return rows;
  }, [scope, stateF, country, allRows]);

  useEffect(() => {
    const id = setInterval(() => {
      if (filteredRows.length > 1) {
        setPulseIdx(Math.floor(Math.random() * Math.min(filteredRows.length, 5)));
        setTimeout(() => setPulseIdx(null), 1400);
      }
    }, 3800);
    return () => clearInterval(id);
  }, [filteredRows.length]);

  const youRow = filteredRows.find((r) => r.you);
  const youRank = youRow ? filteredRows.findIndex((r) => r.you) + 1 : null;
  const fmt = (v) => curFilter.fmt(v);

  return (
    <section id="leaderboard" className="landing-section landing-lb-section">
      <span className="landing-lb-example-tag" aria-hidden="true">
        <span className="landing-lb-live-dot" /> Example
      </span>
      <div className="landing-section-eyebrow">— The Ladder</div>
      <h2 className="landing-section-title">Live global rankings</h2>
      <div className="landing-divider" />
      <p className="landing-section-subtitle">
        Your data, ranked. Filter by class, PR, or location. Friends-only and global ladders update in real time.
      </p>

      <div className="landing-lb-card">
        <div className="landing-lb-scope">
          <button className={'landing-lb-scope-btn' + (scope === 'friends' ? ' landing-active' : '')} onClick={() => setScope('friends')}>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M8 11a4 4 0 100-8 4 4 0 000 8zm8 0a3 3 0 100-6 3 3 0 000 6zm-8 2c-4 0-8 2-8 6v3h12v-3c0-1.8.8-3.4 2.2-4.5C13 13.2 10.6 13 8 13zm11 0c-1.2 0-2.4.2-3.5.6 1.5 1 2.5 2.6 2.5 4.4v3h5v-3c0-3-3-5-4-5z" fill="currentColor" />
            </svg>
            Friends
          </button>
          <button className={'landing-lb-scope-btn' + (scope === 'world' ? ' landing-active' : '')} onClick={() => setScope('world')}>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M2 12h20M12 2c3 3 4.5 6.5 4.5 10S15 19 12 22M12 2C9 5 7.5 8.5 7.5 12S9 19 12 22" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            World
          </button>
        </div>

        <div className="landing-lb-filter-row">
          <LBDropdown value={stateF} options={US_STATES} onChange={setStateF} icon={<span>📍</span>} />
          <LBDropdown value={country} options={COUNTRIES} onChange={setCountry} icon={<span>🌍</span>} />
        </div>

        <LBDropdown
          value={curFilter.label}
          options={LB_FILTERS.map((f) => ({ value: f.label, label: f.label, icon: <LBCatIcon type={f.icon} /> }))}
          onChange={(labelVal) => {
            const f = LB_FILTERS.find((x) => x.label === labelVal);
            if (f) setFilter(f.key);
          }}
          icon={<LBCatIcon type={curFilter.icon} />}
          wide
        />
        <div className="landing-lb-sub-caption">{curFilter.sub}</div>

        {youRow && (
          <div className="landing-lb-you-row">
            <div className="landing-lb-rank-cell">
              <Medal rank={youRank} />
              <div className="landing-lb-rank-num">{youRank}</div>
            </div>
            <div className="landing-lb-player-cell">
              <div className="landing-lb-line1">
                <span className="landing-lb-name">{youRow.name}</span>
                <span className="landing-lb-class-chip" style={{ color: classColor(youRow.cls) }}>
                  <ClassSigil k={youRow.cls} size={13} />
                  <span>{capitalize(youRow.cls)}</span>
                </span>
                <span className="landing-lb-handle">#{youRow.handle}</span>
                <span className="landing-lb-you-badge">you</span>
              </div>
              <div className="landing-lb-line2">
                Lv.{youRow.lvl} · {youRow.state}, {youRow.country} · {youRow.gym} ·{' '}
                <span className="landing-lb-streak">🔥 {youRow.streak}</span>
              </div>
            </div>
            <div className="landing-lb-val-cell">
              <div className="landing-lb-val-big">{fmt(youRow.val)}</div>
              <div className="landing-lb-val-sub">{curFilter.label}</div>
            </div>
          </div>
        )}

        <div className="landing-lb-table">
          <div className="landing-lb-table-head">
            <span>#</span>
            <span>Player</span>
            <span className="landing-lb-col-val">
              <LBCatIcon type={curFilter.icon} size={14} />
              <span>{curFilter.label.split(' · ')[0].toUpperCase()}</span>
            </span>
          </div>

          {filteredRows.length === 0 && (
            <div className="landing-lb-empty">
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚔</div>
              <div>No warriors match these filters.</div>
            </div>
          )}

          {filteredRows.map((r, i) => {
            const rank = i + 1;
            const color = classColor(r.cls);
            return (
              <div
                key={r.name + r.handle}
                className={'landing-lb-data-row' + (pulseIdx === i ? ' landing-pulse' : '') + (r.you ? ' landing-is-you' : '')}
                style={{ '--row-accent': color }}
              >
                <div className="landing-lb-rank-cell">
                  <Medal rank={rank} />
                  <div className="landing-lb-rank-num">{rank}</div>
                </div>
                <div className="landing-lb-player-cell">
                  <div className="landing-lb-line1">
                    <span className="landing-lb-name">{r.name}</span>
                    <span className="landing-lb-class-chip" style={{ color }}>
                      <ClassSigil k={r.cls} size={13} />
                      <span>{capitalize(r.cls)}</span>
                    </span>
                    <span className="landing-lb-handle">#{r.handle}</span>
                    {r.you && <span className="landing-lb-you-badge">you</span>}
                  </div>
                  <div className="landing-lb-line2">
                    Lv.{r.lvl} · {r.state}, {r.country} · {r.gym} <span className="landing-lb-streak">🔥 {r.streak}</span>
                  </div>
                </div>
                <div className="landing-lb-val-cell">
                  <div className="landing-lb-val-big">{fmt(r.val)}</div>
                  <div className="landing-lb-val-sub">{curFilter.label.split(' · ')[0]}</div>
                </div>
              </div>
            );
          })}

          <div className="landing-lb-footer-note">
            {filteredRows.length} {filteredRows.length === 1 ? 'warrior' : 'warriors'} ranked (filtered)
          </div>
        </div>
      </div>
    </section>
  );
}
