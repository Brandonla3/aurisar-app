import { describe, expect, it } from 'vitest';
import { AnimationController, blendAlpha, resolveClips } from './AnimationController.js';

// Minimal mock of the AnimationGroup surface the controller touches.
function makeGroup(name, { from = 0, to = 60 } = {}) {
  const endObs = {
    _cbs: new Set(),
    add(cb) { this._cbs.add(cb); return cb; },
    remove(cb) { this._cbs.delete(cb); },
  };
  return {
    name, from, to,
    weight: 0,
    isPlaying: false,
    loopAnimation: false,
    speedRatio: 1,
    paused: false,
    frame: null,
    onAnimationGroupEndObservable: endObs,
    play(loop) { this.isPlaying = true; this.paused = false; if (loop !== undefined) this.loopAnimation = loop; },
    stop() { this.isPlaying = false; },
    pause() { this.paused = true; },
    goToFrame(f) { this.frame = f; },
    // test helper: simulate the clip finishing
    end() { this.isPlaying = false; [...endObs._cbs].forEach((cb) => cb()); },
  };
}

function makeRig() {
  const groups = [
    makeGroup('avatar_Idle'),
    makeGroup('avatar_Walk'),
    makeGroup('avatar_Run'),
    makeGroup('avatar_Attack', { to: 30 }),
    makeGroup('avatar_Death', { to: 45 }),
  ];
  const ctl = new AnimationController(groups, {
    idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', death: 'Death',
  }, { runThresholdMps: 5, walkRefMps: 2, runRefMps: 6 });
  return { groups, ctl };
}

// Settle the controller at a fixed speed over many 16 ms frames.
function settle(ctl, speed, frames = 120) {
  ctl.setLocomotionSpeed(speed);
  for (let i = 0; i < frames; i++) ctl.update(16);
}

describe('resolveClips', () => {
  it('matches exact suffixes case-insensitively on prefixed clone names', () => {
    const groups = [makeGroup('Clone of Spider_Idle'), makeGroup('mob_7_Spider_Walk')];
    const clips = resolveClips(groups, { idle: 'Spider_Idle', walk: 'spider_walk' });
    expect(clips.idle.name).toBe('Clone of Spider_Idle');
    expect(clips.walk.name).toBe('mob_7_Spider_Walk');
  });

  it('supports RegExp matchers and skips null entries', () => {
    const groups = [makeGroup('avatar_SwordSlash')];
    const clips = resolveClips(groups, { attack: /swordslash|attack/i, hit: null });
    expect(clips.attack).toBeDefined();
    expect('hit' in clips).toBe(false);
  });
});

describe('blendAlpha', () => {
  it('is frame-rate independent (two half-steps compose to one full step)', () => {
    const whole = blendAlpha(16);
    const half = blendAlpha(8);
    const composed = 1 - (1 - half) * (1 - half);
    expect(composed).toBeCloseTo(whole, 10);
  });
});

describe('AnimationController locomotion', () => {
  it('idles when standing, walks at low speed, runs past the threshold', () => {
    const { groups, ctl } = makeRig();
    const [idle, walk, run] = groups;

    settle(ctl, 0);
    expect(idle.weight).toBeGreaterThan(0.95);
    expect(walk.weight).toBe(0);

    settle(ctl, 3);
    expect(walk.weight).toBeGreaterThan(0.95);
    expect(idle.weight).toBe(0);
    expect(walk.isPlaying).toBe(true);

    settle(ctl, 10);
    expect(run.weight).toBeGreaterThan(0.95);
    expect(walk.weight).toBe(0);
  });

  it('clamps the stride ratio so extreme speeds never thrash the clip', () => {
    const { groups, ctl } = makeRig();
    settle(ctl, 30); // 5× the run reference speed
    expect(groups[2].speedRatio).toBe(1.6);
  });

  it('falls back to idle while moving if no walk clip resolved', () => {
    const groups = [makeGroup('Idle')];
    const ctl = new AnimationController(groups, { idle: 'Idle' });
    ctl.setLocomotionSpeed(3);
    for (let i = 0; i < 120; i++) ctl.update(16);
    expect(groups[0].weight).toBeGreaterThan(0.95);
  });
});

describe('AnimationController one-shots and death', () => {
  it('suppresses locomotion during a one-shot and recovers after it ends', () => {
    const { groups, ctl } = makeRig();
    const [idle, , , attack] = groups;
    settle(ctl, 0);

    expect(ctl.playOneShot('attack')).toBe(true);
    expect(attack.isPlaying).toBe(true);
    expect(attack.loopAnimation).toBe(false);
    for (let i = 0; i < 60; i++) ctl.update(16);
    expect(idle.weight).toBeLessThan(0.05); // eased out under the one-shot

    attack.end();
    settle(ctl, 0);
    expect(idle.weight).toBeGreaterThan(0.95); // handed back
  });

  it('death stops locomotion, reports a duration, and freezes the last frame', () => {
    const { groups, ctl } = makeRig();
    const [idle, , , , death] = groups;
    settle(ctl, 3);

    const ms = ctl.playDeath();
    expect(ms).toBeCloseTo((45 / 60) * 1000, 5);
    expect(death.isPlaying).toBe(true);
    expect(idle.weight).toBe(0);

    death.end();
    expect(death.frame).toBe(45);   // held on the final frame
    expect(death.paused).toBe(true);

    // Dead rigs refuse further one-shots and updates are inert.
    expect(ctl.playOneShot('attack')).toBe(false);
    ctl.update(16);
    expect(idle.weight).toBe(0);
  });
});

describe('AnimationController distance gating', () => {
  it('suspend pauses playback and resume restores weighted clips', () => {
    const { groups, ctl } = makeRig();
    const [idle] = groups;
    settle(ctl, 0);

    ctl.suspend();
    expect(idle.paused).toBe(true);
    const before = idle.weight;
    ctl.update(16); // inert while suspended
    expect(idle.weight).toBe(before);

    ctl.resume();
    expect(idle.isPlaying).toBe(true);
  });
});
