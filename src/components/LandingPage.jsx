import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import '../styles/landing.css';
import heroBg from '../assets/hero.png';
import flameLogo from '../assets/flame-logo-transparent.svg';
import aurisarLogo from '../assets/aurisar-logo.png';
import { UI_COLORS } from '../data/constants';

/* ═══════════════════════════════════════════════════════════════
   Aurisar Fitness — RPG Hero Landing Page
   ═══════════════════════════════════════════════════════════════ */

function SwordSVG() {
  return (
    <svg
      className="landing-sword-svg"
      viewBox="0 0 40 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Blade */}
      <polygon points="20,2 26,50 20,54 14,50" fill="url(#blade-grad)" stroke="#9a8a7a" strokeWidth="0.5" />
      {/* Blade center line */}
      <line x1="20" y1="8" x2="20" y2="48" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {/* Crossguard */}
      <rect x="6" y="50" width="28" height="5" rx="2" fill="#c49428" stroke="#8B6914" strokeWidth="0.5" />
      {/* Crossguard gems */}
      <circle cx="10" cy="52.5" r="1.5" fill={UI_COLORS.danger} opacity="0.7" />
      <circle cx="30" cy="52.5" r="1.5" fill={UI_COLORS.danger} opacity="0.7" />
      {/* Grip */}
      <rect x="16" y="55" width="8" height="20" rx="2" fill="#5a4020" stroke="#3a2810" strokeWidth="0.5" />
      {/* Grip wrap lines */}
      <line x1="16" y1="60" x2="24" y2="60" stroke="#c49428" strokeWidth="0.5" opacity="0.5" />
      <line x1="16" y1="64" x2="24" y2="64" stroke="#c49428" strokeWidth="0.5" opacity="0.5" />
      <line x1="16" y1="68" x2="24" y2="68" stroke="#c49428" strokeWidth="0.5" opacity="0.5" />
      <line x1="16" y1="72" x2="24" y2="72" stroke="#c49428" strokeWidth="0.5" opacity="0.5" />
      {/* Pommel */}
      <circle cx="20" cy="79" r="5" fill="#c49428" stroke="#8B6914" strokeWidth="0.5" />
      <circle cx="20" cy="79" r="2" fill="#f0d060" opacity="0.6" />
      {/* Gradients */}
      <defs>
        <linearGradient id="blade-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4cec4" />
          <stop offset="50%" stopColor="#b0a898" />
          <stop offset="100%" stopColor="#8a8478" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LandingPage({ onLogin, onSignUp }) {
  const [swordHidden, setSwordHidden] = useState(false);
  const aboutRef = useRef(null);
  const roadmapRef = useRef(null);
  const lbRef = useRef(null);
  const revealRefs = useRef([]);

  // ── Generate embers once ──
  const embers = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 60; i++) {
      arr.push({
        left: Math.random() * 100 + '%',
        size: (3 + Math.random() * 7) + 'px',
        dur: (5 + Math.random() * 12) + 's',
        delay: (Math.random() * 14) + 's',
        drift: ((Math.random() - 0.5) * 100) + 'px',
        peakOpacity: 0.45 + Math.random() * 0.5,
      });
    }
    return arr;
  }, []);

  // ── Scroll: hide sword ──
  useEffect(() => {
    function onScroll() {
      setSwordHidden(window.scrollY > 100);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── IntersectionObserver for reveals ──
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('landing-visible');
          }
        });
      },
      { threshold: 0.12 }
    );
    revealRefs.current.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  const addRevealRef = useCallback((el) => {
    if (el && !revealRefs.current.includes(el)) {
      revealRefs.current.push(el);
    }
  }, []);

  function scrollTo(ref) {
    if (ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="landing-root">
      {/* Ambient glow */}
      <div className="landing-ambient-glow" />

      {/* ═══════════ TOP NAVBAR ═══════════ */}
      <header className="landing-topbar">
        <div className="landing-topbar-brand">
          <img src={aurisarLogo} alt="Aurisar" className="landing-topbar-mark" />
          <span className="landing-topbar-logo">Aurisar</span>
          <span className="landing-topbar-sub">Games</span>
        </div>
        <div className="landing-topbar-actions">
          <button className="landing-topbar-btn" onClick={onLogin}>Login</button>
          <button className="landing-topbar-btn landing-topbar-btn-accent" onClick={onSignUp}>Sign Up</button>
        </div>
      </header>

      {/* ═══════════ HERO SECTION ═══════════ */}
      <section className="landing-hero">
        {/* Background layers */}
        <div className="landing-hero-bg" />
        <div className="landing-hero-img" style={{ backgroundImage: `url(${heroBg})` }} />
        <div className="landing-hero-vignette" />

        {/* Embers */}
        {embers.map((e, i) => (
          <span
            key={i}
            className="landing-ember"
            style={{
              '--left': e.left,
              '--size': e.size,
              '--dur': e.dur,
              '--delay': e.delay,
              '--drift': e.drift,
              '--peak-opacity': e.peakOpacity,
            }}
          />
        ))}

        {/* Content */}
        <div className="landing-hero-content">
          {/* Flame Logo */}
          <img src={flameLogo} alt="Aurisar flame emblem" className="landing-flame-logo" />

          {/* Cinematic Title */}
          <h1 className="landing-logo-mark">Aurisar</h1>
          <p className="landing-title-sub">Fitness</p>
          <p className="landing-subtitle">Forged in Legend</p>

          {/* Headline */}
          <p className="landing-headline">
            Aurisar Fitness exists to transform the discipline of physical training into an epic, ongoing adventure — making consistent exercise not merely a habit but an identity. We forge athletes through data, character through challenge, and legacy through every rep.
          </p>

          {/* Description */}
          <p className="landing-desc">
            Built for the generation that grew up chasing high scores, raiding dungeons, and leveling up — and never stopped. Your body is the ultimate character. Every workout writes your story.
          </p>

          {/* CTA buttons */}
          <div className="landing-cta-row">
            <button className="landing-btn landing-btn-primary" onClick={onSignUp}>
              Begin Your Journey
            </button>
            <button className="landing-btn landing-btn-ghost" onClick={onLogin}>
              Return to Battle
            </button>
          </div>

          {/* Nav pills */}
          <nav className="landing-nav" aria-label="Page sections">
            <button className="landing-nav-pill" onClick={() => scrollTo(aboutRef)}>About Us</button>
            <button className="landing-nav-pill" onClick={() => scrollTo(roadmapRef)}>Roadmap</button>
            <button className="landing-nav-pill" onClick={() => scrollTo(lbRef)}>Leaderboards</button>
          </nav>
        </div>

        {/* Sword scroll indicator */}
        <div className={'landing-sword-wrap' + (swordHidden ? ' landing-hidden' : '')}>
          <span className="landing-sword-label">Explore</span>
          <SwordSVG />
        </div>
      </section>

      {/* ═══════════ ABOUT US SECTION ═══════════ */}
      <section ref={aboutRef} className="landing-section">
        <div ref={addRevealRef} className="landing-reveal">
          <h2 className="landing-section-title">About Us</h2>
          <div className="landing-divider" />
          <p className="landing-section-subtitle">
            Whether you’re just getting started, grinding daily, coaching a team, or chasing competition PRs — Aurisar meets you where you are. It’s a fitness tracker wrapped in an RPG universe: log your workouts, earn XP, unlock character classes, complete quests, and compete on leaderboards. Casual or competitive, solo or social — every rep counts, and every rep is rewarded.
          </p>
        </div>

        <div className="landing-features">
          {/* Card 1 */}
          <div ref={addRevealRef} className="landing-reveal landing-reveal-d1 landing-feature-card">
            <span className="landing-feature-icon" aria-hidden="true">⚔️</span>
            <h3 className="landing-feature-title">Forge Your Class</h3>
            <p className="landing-feature-text">
              Choose from 11 warrior archetypes — each with unique bonuses, traits, and progression paths. Your training style shapes your legend.
            </p>
          </div>
          {/* Card 2 */}
          <div ref={addRevealRef} className="landing-reveal landing-reveal-d2 landing-feature-card">
            <span className="landing-feature-icon" aria-hidden="true">📜</span>
            <h3 className="landing-feature-title">Track Your Legacy</h3>
            <p className="landing-feature-text">
              Every rep earns XP. Every session writes history. Watch your character grow from recruit to legend through real, measurable progress.
            </p>
          </div>
          {/* Card 3 */}
          <div ref={addRevealRef} className="landing-reveal landing-reveal-d3 landing-feature-card">
            <span className="landing-feature-icon" aria-hidden="true">🏆</span>
            <h3 className="landing-feature-title">Conquer Quests</h3>
            <p className="landing-feature-text">
              Daily and weekly challenges keep the adventure alive. Complete quests, unlock achievements, and climb the ranks of the global leaderboard.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════ ROADMAP SECTION ═══════════ */}
      <section ref={roadmapRef} className="landing-section">
        <div ref={addRevealRef} className="landing-reveal">
          <h2 className="landing-section-title">Roadmap</h2>
          <div className="landing-divider" />
          <p className="landing-section-subtitle">
            The journey is far from over. Here’s what’s ahead on the road to legendary.
          </p>
        </div>

        <div className="landing-timeline">
          {/* Phase I */}
          <div ref={addRevealRef} className="landing-reveal landing-reveal-d1 landing-timeline-node landing-active">
            <div className="landing-timeline-dot">
              <div className="landing-timeline-dot-inner" />
            </div>
            <span className="landing-timeline-phase">Chapter I</span>
            <h3 className="landing-timeline-title">Foundation</h3>
            <p className="landing-timeline-text">
              Core training engine, class system, XP progression, exercise database with 1,500+ movements, and the battle log. The groundwork of your legend.
            </p>
          </div>
          {/* Phase II */}
          <div ref={addRevealRef} className="landing-reveal landing-reveal-d2 landing-timeline-node">
            <div className="landing-timeline-dot">
              <div className="landing-timeline-dot-inner" />
            </div>
            <span className="landing-timeline-phase">Chapter II</span>
            <h3 className="landing-timeline-title">The Arena</h3>
            <p className="landing-timeline-text">
              Global leaderboards, friend challenges, guild systems, and social training. Compete. Collaborate. Conquer together.
            </p>
          </div>
          {/* Phase III */}
          <div ref={addRevealRef} className="landing-reveal landing-reveal-d3 landing-timeline-node">
            <div className="landing-timeline-dot">
              <div className="landing-timeline-dot-inner" />
            </div>
            <span className="landing-timeline-phase">Chapter III</span>
            <h3 className="landing-timeline-title">Legendary</h3>
            <p className="landing-timeline-text">
              Advanced Character Customization, Seasonal Events, Raid Bosses, and the full 3D MMO Aurisar Universe. The endgame begins.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════ LEADERBOARDS SECTION ═══════════ */}
      <section ref={lbRef} className="landing-section">
        <div ref={addRevealRef} className="landing-reveal">
          <h2 className="landing-section-title">Leaderboards</h2>
          <div className="landing-divider" />
          <p className="landing-section-subtitle">
            Glory awaits those who dare to train. See where you stand among warriors worldwide.
          </p>
        </div>

        <div ref={addRevealRef} className="landing-reveal landing-reveal-d1 landing-lb-preview">
          {/* Podium */}
          <div className="landing-lb-podium">
            {/* 2nd place */}
            <div className="landing-lb-rank">
              <span className="landing-lb-name">IronWarden</span>
              <div className="landing-lb-bar landing-lb-bar-2">
                <span className="landing-lb-medal" aria-hidden="true">🥈</span>
              </div>
              <span className="landing-lb-label">2nd</span>
            </div>
            {/* 1st place */}
            <div className="landing-lb-rank">
              <span className="landing-lb-name">PhantomBlade</span>
              <div className="landing-lb-bar landing-lb-bar-1">
                <span className="landing-lb-medal" aria-hidden="true">🥇</span>
              </div>
              <span className="landing-lb-label">1st</span>
            </div>
            {/* 3rd place */}
            <div className="landing-lb-rank">
              <span className="landing-lb-name">TempestFury</span>
              <div className="landing-lb-bar landing-lb-bar-3">
                <span className="landing-lb-medal" aria-hidden="true">🥉</span>
              </div>
              <span className="landing-lb-label">3rd</span>
            </div>
          </div>

          {/* CTA */}
          <button
            className="landing-btn landing-btn-primary"
            onClick={onSignUp}
            style={{ marginTop: '8px' }}
          >
            Claim Your Rank
          </button>
        </div>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="landing-footer">
        © 2025 Aurisar Fitness. All rights reserved.
      </footer>
    </div>
  );
}
