import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import '../styles/landing.css';
import aurisarMark3D from '../assets/aurisar-mark-3d.png';
import { ClassesSection } from './landing/ClassesSection.jsx';
import { LeaderboardSection } from './landing/LeaderboardSection.jsx';

/* ═══════════════════════════════════════════════════════════════
   Aurisar — Cinematic Monolith Landing
   ═══════════════════════════════════════════════════════════════ */

const HERO_PILLARS = [
  { num: 'I', head: 'Real Workouts', sub: 'Real Results' },
  { num: 'II', head: 'Earn XP', sub: 'Level Up' },
  { num: 'III', head: 'Build Discipline', sub: 'Unlock Potential' },
  { num: 'IV', head: 'Join the Order', sub: 'Forge Together' },
];

const PRIMER_STATS = [
  { num: '1,500+', label: 'Exercises' },
  { num: '11', label: 'Classes' },
  { num: '∞', label: 'Chapters' },
];

const FEATURES = [
  {
    icon: '⚔️',
    title: 'Forge Your Class',
    text: 'Choose from 11 warrior archetypes — each with unique bonuses, traits, and progression paths. Your training style shapes your legend.',
  },
  {
    icon: '📜',
    title: 'Track Your Legacy',
    text: 'Every rep earns XP. Every session writes history. Watch your character grow from recruit to legend through real, measurable progress.',
  },
  {
    icon: '🏆',
    title: 'Conquer Quests',
    text: 'Daily and weekly challenges keep the adventure alive. Complete quests, unlock achievements, and climb the ranks of the global leaderboard.',
  },
];

function HeroMonolith({ onLogin, onSignUp }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dust = useMemo(
    () =>
      Array.from({ length: 18 }, () => ({
        left: Math.random() * 100 + '%',
        size: 1 + Math.random() * 2 + 'px',
        dur: 10 + Math.random() * 14 + 's',
        delay: Math.random() * 18 + 's',
        drift: (Math.random() - 0.5) * 60 + 'px',
        o: 0.25 + Math.random() * 0.5,
      })),
    [],
  );

  const dateStr = now
    .toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })
    .toUpperCase();
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <section className="landing-hero landing-hero-monolith landing-hm-centered landing-hm-scale-md">
      <div className="landing-hm-bg" aria-hidden="true" />
      <div className="landing-hm-grain" aria-hidden="true" />
      <div className="landing-hm-vignette" aria-hidden="true" />

      <span className="landing-hm-bracket landing-hm-bracket-tl" aria-hidden="true" />
      <span className="landing-hm-bracket landing-hm-bracket-tr" aria-hidden="true" />
      <span className="landing-hm-bracket landing-hm-bracket-bl" aria-hidden="true" />
      <span className="landing-hm-bracket landing-hm-bracket-br" aria-hidden="true" />

      <div
        className="landing-hm-mark-stage"
        aria-hidden="true"
        style={{
          '--hm-mark-opacity': 0.22,
          '--hm-mark-shadow': 1,
        }}
      >
        <div className="landing-hm-mark-halo" />
        <img src={aurisarMark3D} alt="" className="landing-hm-mark-img" />
      </div>

      {dust.map((p, i) => (
        <span
          key={i}
          className="landing-hm-dust"
          style={{
            '--left': p.left,
            '--size': p.size,
            '--dur': p.dur,
            '--delay': p.delay,
            '--drift': p.drift,
            '--o': p.o,
          }}
        />
      ))}

      <div className="landing-hm-content">
        <div className="landing-hm-meta">
          <span className="landing-hm-meta-dot" />
          <span className="landing-hm-meta-text">{dateStr}</span>
          <span className="landing-hm-meta-rule" />
          <span className="landing-hm-meta-text landing-hm-meta-clock">{timeStr}</span>
        </div>

        <h1 className="landing-hm-title">
          <span className="landing-hm-title-line">AURISAR</span>
        </h1>

        <div className="landing-hm-rule">
          <span className="landing-hm-rule-line" />
          <span className="landing-hm-rule-text">BY AURISAR GAMES</span>
          <span className="landing-hm-rule-line" />
        </div>

        <p className="landing-hm-tagline">The fitness tracker for real life</p>

        <div className="landing-hm-ctas">
          <button className="landing-hm-cta landing-hm-cta-primary" onClick={onSignUp}>
            <span className="landing-hm-cta-corner landing-hm-cta-corner-tl" />
            <span className="landing-hm-cta-corner landing-hm-cta-corner-tr" />
            <span className="landing-hm-cta-corner landing-hm-cta-corner-bl" />
            <span className="landing-hm-cta-corner landing-hm-cta-corner-br" />
            <span className="landing-hm-cta-label">BEGIN YOUR LEGEND</span>
          </button>
          <button className="landing-hm-cta landing-hm-cta-ghost" onClick={onLogin}>
            <span className="landing-hm-cta-label">RETURN TO BATTLE</span>
            <span className="landing-hm-cta-arrow">→</span>
          </button>
        </div>
      </div>

      <div className="landing-hm-pillars">
        {HERO_PILLARS.map((p) => (
          <div key={p.num} className="landing-hm-pillar">
            <span className="landing-hm-pillar-num">{p.num}</span>
            <div className="landing-hm-pillar-body">
              <div className="landing-hm-pillar-head">{p.head}</div>
              <div className="landing-hm-pillar-sub">{p.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LandingPage({ onLogin, onSignUp }) {
  const primerRef = useRef(null);
  const lbRef = useRef(null);
  const revealRefs = useRef([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('landing-visible');
        });
      },
      { threshold: 0.12 },
    );
    revealRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const addRevealRef = useCallback((el) => {
    if (el && !revealRefs.current.includes(el)) revealRefs.current.push(el);
  }, []);

  const scrollToId = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollTo = (ref) => {
    if (ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="landing-root landing-cinematic">
      {/* ═══════════ TOP NAVBAR ═══════════ */}
      <header className="landing-topbar landing-topbar-cinematic">
        <div className="landing-topbar-spacer" />
        <nav className="landing-topbar-links" aria-label="Page sections">
          <button className="landing-topbar-link" onClick={() => scrollTo(primerRef)}>
            About
          </button>
          <button className="landing-topbar-link" onClick={() => scrollToId('classes')}>
            Classes
          </button>
          <button className="landing-topbar-link" onClick={() => scrollTo(lbRef)}>
            Leaderboards
          </button>
        </nav>
        <div className="landing-topbar-actions">
          <button className="landing-topbar-btn" onClick={onLogin}>
            Login
          </button>
          <button className="landing-topbar-btn landing-topbar-btn-accent" onClick={onSignUp}>
            Sign Up
          </button>
        </div>
      </header>

      {/* ═══════════ HERO ═══════════ */}
      <HeroMonolith onLogin={onLogin} onSignUp={onSignUp} />

      {/* ═══════════ PRIMER — What is Aurisar? ═══════════ */}
      <section ref={primerRef} className="landing-primer">
        <div ref={addRevealRef} className="landing-reveal landing-primer-text">
          <div className="landing-primer-eyebrow">— What is Aurisar?</div>
          <h2 className="landing-primer-title">
            A real fitness tracker <em>wearing a character sheet.</em>
          </h2>
          <p className="landing-primer-body">
            Aurisar is a workout logger — reps, sets, weight, cardio, rest. What makes it different is how it gives that
            data back to you: as a character you level up, a class you evolve into, and a log of chapters you’ll
            actually remember finishing.
          </p>
          <p className="landing-primer-body">
            Every rep is XP. Every session is a quest. Every week is a chapter. You don’t lose the numbers — you just
            stop needing to white-knuckle them.
          </p>
          <div className="landing-primer-stats">
            {PRIMER_STATS.map((s) => (
              <div key={s.label} className="landing-primer-stat">
                <div className="landing-primer-stat-num">{s.num}</div>
                <div className="landing-primer-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ FEATURES ═══════════ */}
      <section className="landing-section">
        <div ref={addRevealRef} className="landing-reveal">
          <h2 className="landing-section-title">Forge Your Path</h2>
          <div className="landing-divider" />
          <p className="landing-section-subtitle">
            A fitness tracker wrapped in an RPG universe — log your workouts, earn XP, unlock character classes,
            complete quests, and compete on leaderboards. Every rep counts, and every rep is rewarded.
          </p>
        </div>

        <div className="landing-features">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              ref={addRevealRef}
              className={`landing-reveal landing-reveal-d${i + 1} landing-feature-card`}
            >
              <span className="landing-feature-icon" aria-hidden="true">{f.icon}</span>
              <h3 className="landing-feature-title">{f.title}</h3>
              <p className="landing-feature-text">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ CLASSES ═══════════ */}
      <ClassesSection />

      {/* ═══════════ LEADERBOARD ═══════════ */}
      <div ref={lbRef}>
        <LeaderboardSection />
      </div>

      {/* Pricing section is intentionally hidden for now. */}

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="landing-footer">© 2026 Aurisar Games. All rights reserved.</footer>
    </div>
  );
}
