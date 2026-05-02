import React, { useState } from 'react';

const CLASS_ICON_PATHS = {
  warrior:
    'M256 192L346.2 281.6 281.6 346.2 192 256 101.8 346.2 0 448 64 512 165.8 410.2 256 320 346.2 410.2 448 512 512 448 410.2 346.2 320 256 410.2 165.8 346.2 101.8 192 256ZM512 0L320 192 192 64 0 0 64 192 192 320 0 512 64 512 192 384 320 512 512 384 448 256 512 128Z',
  gladiator:
    'M256 32C149 32 64 117 64 224v32h32v-32c0-88.4 71.6-160 160-160s160 71.6 160 160v32h32v-32C448 117 363 32 256 32zM192 288H128v128h64V288zM384 288h-64v128h64V288zM128 384v32c0 53 43 96 96 96h64c53 0 96-43 96-96v-32H128z',
  warden: 'M256 16L96 272h80L112 480h288L336 272h80L256 16zM220 416l16-80h40l16 80H220z',
  phantom:
    'M256 64L32 256 256 448 480 256 256 64zM256 176c44.2 0 80 35.8 80 80s-35.8 80-80 80-80-35.8-80-80 35.8-80 80-80zM256 224c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32z',
  tempest:
    'M32 256c48 0 48-64 96-64s48 64 96 64 48-64 96-64 48 64 96 64 48-64 96-64v64c-48 0-48 64-96 64s-48-64-96-64-48 64-96 64-48-64-96-64-48 64-96 64V256c48 0 48-64 96-64zM32 352c48 0 48-64 96-64s48 64 96 64 48-64 96-64 48 64 96 64 48-64 96-64v64c-48 0-48 64-96 64s-48-64-96-64-48 64-96 64-48-64-96-64-48 64-96 64V352c48 0 48-64 96-64z',
  warlord:
    'M480 32L352 96 416 160 320 256 256 192 192 256 160 288c-18 18-18 48 0 66l0 0c18 18 48 18 66 0L288 288l64 64-96 96-64-64L128 448l64 64L480 32zM64 384L0 480l96-96L64 384z',
  druid:
    'M256 32C150 32 64 100 32 196c64 0 128 32 160 80-16-96 32-180 96-212C430 48 512 120 512 212c0 130-112 236-256 268C12 448 0 322 0 256 0 132 114 32 256 32z',
  oracle:
    'M256 128c-70.7 0-128 57.3-128 128s57.3 128 128 128 128-57.3 128-128-57.3-128-128-128zM256 320c-35.3 0-64-28.7-64-64s28.7-64 64-64 64 28.7 64 64-28.7 64-64 64zM480 234.7L399.5 192C381.6 131.6 324.8 88 256 88S130.4 131.6 112.5 192L32 234.7v42.6L112.5 320C130.4 380.4 187.2 424 256 424s125.6-43.6 143.5-104L480 277.3V234.7z',
  titan: 'M128 96v64H64L32 256h448l-32-96H384V96H128zM64 288v32h384v-32H64zM96 352v64h320v-64H96z',
  striker:
    'M224 32c-35.3 0-64 28.7-64 64v16c-35.3 0-64 28.7-64 64v32c-35.3 0-64 28.7-64 64v96c0 70.7 57.3 128 128 128h128c70.7 0 128-57.3 128-128V208c0-35.3-28.7-64-64-64v-32c0-35.3-28.7-64-64-64H224zM192 96h128c17.7 0 32 14.3 32 32v16H160V128c0-17.7 14.3-32 32-32z',
  alchemist:
    'M192 32v160L96 352c-26.5 35.3-32 64-16 96 16 32 53.3 48 96 48h160c42.7 0 80-16 96-48 16-32 10.5-60.7-16-96L320 192V32H192zM224 64h64v144l16 16H208l16-16V64zM160 368c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48s-21.5 48-48 48H208c-26.5 0-48-21.5-48-48z',
};

export function ClassSigil({ k, size = 20, color }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} style={{ display: 'inline-block', flexShrink: 0 }} aria-hidden="true">
      <path d={CLASS_ICON_PATHS[k]} fill={color || 'currentColor'} />
    </svg>
  );
}

export const CLASSES = [
  { key: 'warrior',   name: 'Warrior',   color: '#c14a3a', tagline: 'Heavy iron · compound lifts',
    desc: 'The original. Barbell fundamentals, progressive overload, strength as the through-line. Warriors show up, load the bar, and get measurably stronger week after week.',
    stats: [['Strength', 92], ['Endurance', 48], ['Mobility', 55], ['Recovery', 70]] },
  { key: 'gladiator', name: 'Gladiator', color: '#d4a03a', tagline: 'Hypertrophy · bodybuilding',
    desc: 'Volume meets vanity. Gladiators chase physique — angle variety, bro splits evolved, time-under-tension. The class ladder rewards consistent structured volume across muscle groups.',
    stats: [['Strength', 78], ['Endurance', 60], ['Mobility', 62], ['Recovery', 68]] },
  { key: 'warden',    name: 'Warden',    color: '#4e6b3c', tagline: 'Outdoors · trail · hybrid',
    desc: "Warden trains where there's wind. Hiking, trail running, rucking, kettlebell complexes on a porch. Quests blend distance, elevation, and time spent out of a commercial gym.",
    stats: [['Strength', 66], ['Endurance', 82], ['Mobility', 72], ['Recovery', 80]] },
  { key: 'phantom',   name: 'Phantom',   color: '#6b5b8f', tagline: 'Stealth · recomp · skill',
    desc: 'Phantoms train for control — bodyweight mastery, mobility, unilateral strength, zone-2 conditioning. Quiet, consistent, hard to catch on the ladder.',
    stats: [['Strength', 72], ['Endurance', 78], ['Mobility', 90], ['Recovery', 74]] },
  { key: 'tempest',   name: 'Tempest',   color: '#3b8bbf', tagline: 'Cardio · VO₂ · long engine',
    desc: 'Storm class. Runners, cyclists, swimmers, rowers. The long engine. Tempest ladders are pace-based — you climb by shaving seconds off real efforts.',
    stats: [['Strength', 48], ['Endurance', 96], ['Mobility', 66], ['Recovery', 60]] },
  { key: 'warlord',   name: 'Warlord',   color: '#8b2c2c', tagline: 'Powerlifting · 1RM chase',
    desc: 'Warlord lives for the one-rep max. Low reps, long rest, strict form, real weight. The class ladder is simple: squat, bench, deadlift totals — in pounds, no excuses.',
    stats: [['Strength', 98], ['Endurance', 42], ['Mobility', 50], ['Recovery', 66]] },
  { key: 'druid',     name: 'Druid',     color: '#5a8c56', tagline: 'Yoga · mobility · restoration',
    desc: 'Druid is the long game. Mobility, flexibility, rehab work, breath. Quests are about showing up for the unsexy, foundational stuff — and they count toward every other class.',
    stats: [['Strength', 54], ['Endurance', 64], ['Mobility', 94], ['Recovery', 90]] },
  { key: 'oracle',    name: 'Oracle',    color: '#b09a5c', tagline: 'Programmer · data-driven',
    desc: 'Oracles optimize the system itself. Periodization, RPE, HRV-informed deloads, spreadsheets that love them back. Rewarded for adherence and smart deviation alike.',
    stats: [['Strength', 70], ['Endurance', 70], ['Mobility', 68], ['Recovery', 86]] },
  { key: 'titan',     name: 'Titan',     color: '#7a7a7a', tagline: 'Strongman · odd objects',
    desc: "Stones, sleds, farmer's walks, tires. If it's awkward and heavy, it's Titan territory. Ladders prioritize loaded carry distance, stone lift weight, and sled work.",
    stats: [['Strength', 94], ['Endurance', 58], ['Mobility', 56], ['Recovery', 60]] },
  { key: 'striker',   name: 'Striker',   color: '#d46c3a', tagline: 'Combat sports · conditioning',
    desc: 'Boxing, muay thai, BJJ, MMA, wrestling. The fight class. High intensity intervals, rounds on the pads, rolling sessions — rewarded by volume and by competition results.',
    stats: [['Strength', 74], ['Endurance', 88], ['Mobility', 78], ['Recovery', 58]] },
  { key: 'alchemist', name: 'Alchemist', color: '#68a89c', tagline: 'Nutrition · recomp · longevity',
    desc: 'Alchemist optimizes what happens between workouts. Protein, sleep, cold/heat, supplementation. Ladders here are body-composition and adherence driven — a long arc.',
    stats: [['Strength', 62], ['Endurance', 64], ['Mobility', 68], ['Recovery', 94]] },
];

export function classColor(k) {
  const m = {
    warrior: '#c14a3a', gladiator: '#d4a03a', warden: '#4e6b3c', phantom: '#6b5b8f',
    tempest: '#3b8bbf', warlord: '#8b2c2c', druid: '#5a8c56', oracle: '#b09a5c',
    titan: '#7a7a7a', striker: '#d46c3a', alchemist: '#68a89c',
  };
  return m[k] || '#b4ac9e';
}

export function ClassesSection() {
  const [active, setActive] = useState('warrior');
  const cur = CLASSES.find((c) => c.key === active);

  return (
    <section id="classes" className="landing-section landing-classes-section">
      <div className="landing-section-eyebrow">— Classes</div>
      <h2 className="landing-section-title">Eleven paths, one ladder</h2>
      <div className="landing-divider" />
      <p className="landing-section-subtitle">
        Each class has its own quest tree, stat curve, and ranked ladder. Pick one to start; respec between chapters.
      </p>

      <div className="landing-class-row">
        <div className="landing-class-list">
          {CLASSES.map((c) => (
            <button
              key={c.key}
              className={'landing-class-list-item' + (c.key === active ? ' landing-active' : '')}
              onClick={() => setActive(c.key)}
              style={c.key === active ? { '--active-accent': c.color } : {}}
            >
              <span className="landing-class-li-sigil" style={{ color: c.color }}>
                <ClassSigil k={c.key} size={16} />
              </span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>

        <div className="landing-class-card" key={cur.key} style={{ '--class-color': cur.color }}>
          <div className="landing-class-card-head">
            <div>
              <h3 className="landing-class-name" style={{ color: cur.color }}>{cur.name}</h3>
              <div className="landing-class-tagline">{cur.tagline}</div>
            </div>
            <div className="landing-class-sigil" style={{ color: cur.color }}>
              <ClassSigil k={cur.key} size={56} />
            </div>
          </div>
          <p className="landing-class-desc">{cur.desc}</p>
          <div className="landing-class-stats">
            {cur.stats.map(([n, v]) => (
              <div key={n}>
                <div className="landing-class-stat-name">{n}</div>
                <div className="landing-class-stat-bar">
                  <div className="landing-class-stat-fill" style={{ width: v + '%', background: cur.color }} />
                </div>
                <div className="landing-class-stat-val">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
