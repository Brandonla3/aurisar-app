import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import '../styles/landing.css';
import heroBg from '../assets/hero.png';
import flameLogo from '../assets/flame-logo-transparent.svg';
import { UI_COLORS } from '../data/constants';

/* ═══════════════════════════════════════════════════════════════
   Aurisar Fitness — RPG Hero Landing Page
   ═══════════════════════════════════════════════════════════════ */

function SwordSVG() {
  return React.createElement('svg', {
    className: 'landing-sword-svg',
    viewBox: '0 0 40 90',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg'
  },
    // Blade
    React.createElement('polygon', {
      points: '20,2 26,50 20,54 14,50',
      fill: 'url(#blade-grad)',
      stroke: '#9a8a7a',
      strokeWidth: '0.5'
    }),
    // Blade center line
    React.createElement('line', {
      x1: '20', y1: '8', x2: '20', y2: '48',
      stroke: 'rgba(255,255,255,0.12)', strokeWidth: '1'
    }),
    // Crossguard
    React.createElement('rect', {
      x: '6', y: '50', width: '28', height: '5', rx: '2',
      fill: '#c49428',
      stroke: '#8B6914',
      strokeWidth: '0.5'
    }),
    // Crossguard gems
    React.createElement('circle', { cx: '10', cy: '52.5', r: '1.5', fill: UI_COLORS.danger, opacity: '0.7' }),
    React.createElement('circle', { cx: '30', cy: '52.5', r: '1.5', fill: UI_COLORS.danger, opacity: '0.7' }),
    // Grip
    React.createElement('rect', {
      x: '16', y: '55', width: '8', height: '20', rx: '2',
      fill: '#5a4020',
      stroke: '#3a2810',
      strokeWidth: '0.5'
    }),
    // Grip wrap lines
    React.createElement('line', { x1: '16', y1: '60', x2: '24', y2: '60', stroke: '#c49428', strokeWidth: '0.5', opacity: '0.5' }),
    React.createElement('line', { x1: '16', y1: '64', x2: '24', y2: '64', stroke: '#c49428', strokeWidth: '0.5', opacity: '0.5' }),
    React.createElement('line', { x1: '16', y1: '68', x2: '24', y2: '68', stroke: '#c49428', strokeWidth: '0.5', opacity: '0.5' }),
    React.createElement('line', { x1: '16', y1: '72', x2: '24', y2: '72', stroke: '#c49428', strokeWidth: '0.5', opacity: '0.5' }),
    // Pommel
    React.createElement('circle', {
      cx: '20', cy: '79', r: '5',
      fill: '#c49428',
      stroke: '#8B6914',
      strokeWidth: '0.5'
    }),
    React.createElement('circle', { cx: '20', cy: '79', r: '2', fill: '#f0d060', opacity: '0.6' }),
    // Gradients
    React.createElement('defs', null,
      React.createElement('linearGradient', { id: 'blade-grad', x1: '0', y1: '0', x2: '0', y2: '1' },
        React.createElement('stop', { offset: '0%', stopColor: '#d4cec4' }),
        React.createElement('stop', { offset: '50%', stopColor: '#b0a898' }),
        React.createElement('stop', { offset: '100%', stopColor: '#8a8478' })
      )
    )
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

  const h = React.createElement;

  return h('div', { className: 'landing-root' },
    // Ambient glow
    h('div', { className: 'landing-ambient-glow' }),

    /* ═══════════ TOP NAVBAR ═══════════ */
    h('header', { className: 'landing-topbar' },
      h('div', { className: 'landing-topbar-brand' },
        h('span', { className: 'landing-topbar-logo' }, 'Aurisar'),
        h('span', { className: 'landing-topbar-sub' }, 'Games')
      ),
      h('div', { className: 'landing-topbar-actions' },
        h('button', { className: 'landing-topbar-btn', onClick: onLogin }, 'Login'),
        h('button', { className: 'landing-topbar-btn landing-topbar-btn-accent', onClick: onSignUp }, 'Sign Up')
      )
    ),

    /* ═══════════ HERO SECTION ═══════════ */
    h('section', { className: 'landing-hero' },
      // Background layers
      h('div', { className: 'landing-hero-bg' }),
      h('div', { className: 'landing-hero-img', style: { backgroundImage: `url(${heroBg})` } }),
      h('div', { className: 'landing-hero-vignette' }),

      // Embers
      ...embers.map((e, i) =>
        h('span', {
          key: i,
          className: 'landing-ember',
          style: {
            '--left': e.left,
            '--size': e.size,
            '--dur': e.dur,
            '--delay': e.delay,
            '--drift': e.drift,
            '--peak-opacity': e.peakOpacity,
          }
        })
      ),

      // Content
      h('div', { className: 'landing-hero-content' },
        // Flame Logo
        h('img', { src: flameLogo, alt: 'Aurisar flame emblem', className: 'landing-flame-logo' }),

        // Cinematic Title
        h('h1', { className: 'landing-logo-mark' }, 'Aurisar'),
        h('p', { className: 'landing-title-sub' }, 'Fitness'),
        h('p', { className: 'landing-subtitle' }, 'Forged in Legend'),

        // Headline
        h('p', { className: 'landing-headline' },
          'Aurisar Fitness exists to transform the discipline of physical training into an epic, ongoing adventure \u2014 making consistent exercise not merely a habit but an identity. We forge athletes through data, character through challenge, and legacy through every rep.'
        ),

        // Description
        h('p', { className: 'landing-desc' },
          'Built for the generation that grew up chasing high scores, raiding dungeons, and leveling up \u2014 and never stopped. Your body is the ultimate character. Every workout writes your story.'
        ),

        // CTA buttons
        h('div', { className: 'landing-cta-row' },
          h('button', { className: 'landing-btn landing-btn-primary', onClick: onSignUp },
            'Begin Your Journey'
          ),
          h('button', { className: 'landing-btn landing-btn-ghost', onClick: onLogin },
            'Return to Battle'
          )
        ),

        // Nav pills
        h('nav', { className: 'landing-nav' },
          h('button', { className: 'landing-nav-pill', onClick: () => scrollTo(aboutRef) }, 'About Us'),
          h('button', { className: 'landing-nav-pill', onClick: () => scrollTo(roadmapRef) }, 'Roadmap'),
          h('button', { className: 'landing-nav-pill', onClick: () => scrollTo(lbRef) }, 'Leaderboards')
        )
      ),

      // Sword scroll indicator
      h('div', { className: 'landing-sword-wrap' + (swordHidden ? ' landing-hidden' : '') },
        h('span', { className: 'landing-sword-label' }, 'Explore'),
        h(SwordSVG)
      )
    ),

    /* ═══════════ ABOUT US SECTION ═══════════ */
    h('section', { ref: aboutRef, className: 'landing-section' },
      h('div', { ref: addRevealRef, className: 'landing-reveal' },
        h('h2', { className: 'landing-section-title' }, 'About Us'),
        h('div', { className: 'landing-divider' }),
        h('p', { className: 'landing-section-subtitle' },
          'Whether you\u2019re just getting started, grinding daily, coaching a team, or chasing competition PRs \u2014 Aurisar meets you where you are. It\u2019s a fitness tracker wrapped in an RPG universe: log your workouts, earn XP, unlock character classes, complete quests, and compete on leaderboards. Casual or competitive, solo or social \u2014 every rep counts, and every rep is rewarded.'
        )
      ),

      h('div', { className: 'landing-features' },
        // Card 1
        h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d1 landing-feature-card' },
          h('span', { className: 'landing-feature-icon' }, '\u2694\uFE0F'),
          h('h3', { className: 'landing-feature-title' }, 'Forge Your Class'),
          h('p', { className: 'landing-feature-text' },
            'Choose from 11 warrior archetypes \u2014 each with unique bonuses, traits, and progression paths. Your training style shapes your legend.'
          )
        ),
        // Card 2
        h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d2 landing-feature-card' },
          h('span', { className: 'landing-feature-icon' }, '\uD83D\uDCDC'),
          h('h3', { className: 'landing-feature-title' }, 'Track Your Legacy'),
          h('p', { className: 'landing-feature-text' },
            'Every rep earns XP. Every session writes history. Watch your character grow from recruit to legend through real, measurable progress.'
          )
        ),
        // Card 3
        h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d3 landing-feature-card' },
          h('span', { className: 'landing-feature-icon' }, '\uD83C\uDFC6'),
          h('h3', { className: 'landing-feature-title' }, 'Conquer Quests'),
          h('p', { className: 'landing-feature-text' },
            'Daily and weekly challenges keep the adventure alive. Complete quests, unlock achievements, and climb the ranks of the global leaderboard.'
          )
        )
      )
    ),

    /* ═══════════ ROADMAP SECTION ═══════════ */
    h('section', { ref: roadmapRef, className: 'landing-section' },
      h('div', { ref: addRevealRef, className: 'landing-reveal' },
        h('h2', { className: 'landing-section-title' }, 'Roadmap'),
        h('div', { className: 'landing-divider' }),
        h('p', { className: 'landing-section-subtitle' },
          'The journey is far from over. Here\u2019s what\u2019s ahead on the road to legendary.'
        )
      ),

      h('div', { className: 'landing-timeline' },
        // Phase I
        h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d1 landing-timeline-node landing-active' },
          h('div', { className: 'landing-timeline-dot' },
            h('div', { className: 'landing-timeline-dot-inner' })
          ),
          h('span', { className: 'landing-timeline-phase' }, 'Chapter I'),
          h('h3', { className: 'landing-timeline-title' }, 'Foundation'),
          h('p', { className: 'landing-timeline-text' },
            'Core training engine, class system, XP progression, exercise database with 1,500+ movements, and the battle log. The groundwork of your legend.'
          )
        ),
        // Phase II
        h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d2 landing-timeline-node' },
          h('div', { className: 'landing-timeline-dot' },
            h('div', { className: 'landing-timeline-dot-inner' })
          ),
          h('span', { className: 'landing-timeline-phase' }, 'Chapter II'),
          h('h3', { className: 'landing-timeline-title' }, 'The Arena'),
          h('p', { className: 'landing-timeline-text' },
            'Global leaderboards, friend challenges, guild systems, and social training. Compete. Collaborate. Conquer together.'
          )
        ),
        // Phase III
        h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d3 landing-timeline-node' },
          h('div', { className: 'landing-timeline-dot' },
            h('div', { className: 'landing-timeline-dot-inner' })
          ),
          h('span', { className: 'landing-timeline-phase' }, 'Chapter III'),
          h('h3', { className: 'landing-timeline-title' }, 'Legendary'),
          h('p', { className: 'landing-timeline-text' },
            'Advanced Character Customization, Seasonal Events, Raid Bosses, and the full 3D MMO Aurisar Universe. The endgame begins.'
          )
        )
      )
    ),

    /* ═══════════ LEADERBOARDS SECTION ═══════════ */
    h('section', { ref: lbRef, className: 'landing-section' },
      h('div', { ref: addRevealRef, className: 'landing-reveal' },
        h('h2', { className: 'landing-section-title' }, 'Leaderboards'),
        h('div', { className: 'landing-divider' }),
        h('p', { className: 'landing-section-subtitle' },
          'Glory awaits those who dare to train. See where you stand among warriors worldwide.'
        )
      ),

      h('div', { ref: addRevealRef, className: 'landing-reveal landing-reveal-d1 landing-lb-preview' },
        // Podium
        h('div', { className: 'landing-lb-podium' },
          // 2nd place
          h('div', { className: 'landing-lb-rank' },
            h('span', { className: 'landing-lb-name' }, 'IronWarden'),
            h('div', { className: 'landing-lb-bar landing-lb-bar-2' },
              h('span', { className: 'landing-lb-medal' }, '\uD83E\uDD48')
            ),
            h('span', { className: 'landing-lb-label' }, '2nd')
          ),
          // 1st place
          h('div', { className: 'landing-lb-rank' },
            h('span', { className: 'landing-lb-name' }, 'PhantomBlade'),
            h('div', { className: 'landing-lb-bar landing-lb-bar-1' },
              h('span', { className: 'landing-lb-medal' }, '\uD83E\uDD47')
            ),
            h('span', { className: 'landing-lb-label' }, '1st')
          ),
          // 3rd place
          h('div', { className: 'landing-lb-rank' },
            h('span', { className: 'landing-lb-name' }, 'TempestFury'),
            h('div', { className: 'landing-lb-bar landing-lb-bar-3' },
              h('span', { className: 'landing-lb-medal' }, '\uD83E\uDD49')
            ),
            h('span', { className: 'landing-lb-label' }, '3rd')
          )
        ),

        // CTA
        h('button', {
          className: 'landing-btn landing-btn-primary',
          onClick: onSignUp,
          style: { marginTop: '8px' }
        }, 'Claim Your Rank')
      )
    ),

    /* ═══════════ FOOTER ═══════════ */
    h('footer', { className: 'landing-footer' },
      '\u00A9 2025 Aurisar Fitness. All rights reserved.'
    )
  );
}
