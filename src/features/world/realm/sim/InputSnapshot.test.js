import { describe, expect, it } from 'vitest';
import {
  BUTTON,
  MOVE_DEADZONE,
  NO_HOTBAR,
  clampMoveToUnitDisc,
  copyInputSnapshot,
  createInputSnapshot,
  hasMovement,
  isDown,
  packId,
  packInputSnapshot,
  resetInputSnapshot,
  setButton,
  unpackInputSnapshot,
} from './InputSnapshot.js';

describe('createInputSnapshot', () => {
  it('starts neutral with no target and no hotbar slot', () => {
    const s = createInputSnapshot();
    expect(s.moveX).toBe(0);
    expect(s.moveZ).toBe(0);
    expect(s.buttons).toBe(BUTTON.NONE);
    expect(s.targetId).toBeNull();
    // -1, not 0 — slot 0 is a real slot.
    expect(s.hotbar).toBe(NO_HOTBAR);
  });
});

describe('resetInputSnapshot', () => {
  it('clears intent but preserves seq', () => {
    const s = createInputSnapshot();
    s.seq = 42;
    s.moveX = 1;
    s.buttons = BUTTON.JUMP;
    s.hotbar = 3;
    s.targetId = 7n;

    resetInputSnapshot(s);

    // seq must survive: it is the spine of prediction/reconciliation, and
    // resetting it would make the client re-use sequence numbers.
    expect(s.seq).toBe(42);
    expect(s.moveX).toBe(0);
    expect(s.buttons).toBe(BUTTON.NONE);
    expect(s.hotbar).toBe(NO_HOTBAR);
    expect(s.targetId).toBeNull();
  });

  it('mutates in place rather than allocating', () => {
    const s = createInputSnapshot();
    expect(resetInputSnapshot(s)).toBe(s);
  });
});

describe('copyInputSnapshot', () => {
  it('copies every field and returns the destination', () => {
    const src = createInputSnapshot();
    Object.assign(src, {
      seq: 9, tMs: 1234, moveX: 0.5, moveZ: -0.25,
      yaw: 1.5, pitch: -0.3, buttons: BUTTON.SPRINT | BUTTON.JUMP,
      hotbar: 2, targetId: 'mob-1',
    });
    const dst = createInputSnapshot();

    expect(copyInputSnapshot(dst, src)).toBe(dst);
    expect(dst).toEqual(src);
    expect(dst).not.toBe(src);
  });
});

describe('buttons', () => {
  it('sets, clears and reads independent bits', () => {
    const s = createInputSnapshot();

    setButton(s, BUTTON.JUMP, true);
    setButton(s, BUTTON.SPRINT, true);
    expect(isDown(s, BUTTON.JUMP)).toBe(true);
    expect(isDown(s, BUTTON.SPRINT)).toBe(true);
    expect(isDown(s, BUTTON.ATTACK)).toBe(false);

    // Clearing one bit must not disturb its neighbours.
    setButton(s, BUTTON.JUMP, false);
    expect(isDown(s, BUTTON.JUMP)).toBe(false);
    expect(isDown(s, BUTTON.SPRINT)).toBe(true);
  });

  it('is idempotent', () => {
    const s = createInputSnapshot();
    setButton(s, BUTTON.ATTACK, true);
    setButton(s, BUTTON.ATTACK, true);
    expect(s.buttons).toBe(BUTTON.ATTACK);
  });
});

describe('clampMoveToUnitDisc', () => {
  it('clamps a diagonal to unit length', () => {
    // The bug this exists to prevent: W+D is (1,1), length 1.41, so players
    // strafe-run 41% faster than they walk.
    const s = createInputSnapshot();
    s.moveX = 1;
    s.moveZ = 1;

    clampMoveToUnitDisc(s);

    expect(Math.hypot(s.moveX, s.moveZ)).toBeCloseTo(1, 10);
    expect(s.moveX).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('leaves partial input alone so analog sticks keep their range', () => {
    // Normalising unconditionally would snap a half-pushed stick to full speed.
    const s = createInputSnapshot();
    s.moveX = 0.3;
    s.moveZ = 0.4;

    clampMoveToUnitDisc(s);

    expect(s.moveX).toBe(0.3);
    expect(s.moveZ).toBe(0.4);
  });

  it('leaves an exactly-unit vector untouched', () => {
    const s = createInputSnapshot();
    s.moveX = 1;
    s.moveZ = 0;
    clampMoveToUnitDisc(s);
    expect(s.moveX).toBe(1);
  });

  it('handles zero without dividing by zero', () => {
    const s = createInputSnapshot();
    clampMoveToUnitDisc(s);
    expect(s.moveX).toBe(0);
    expect(s.moveZ).toBe(0);
    expect(Number.isNaN(s.moveX)).toBe(false);
  });
});

describe('hasMovement', () => {
  it('ignores drift below the deadzone', () => {
    const s = createInputSnapshot();
    s.moveX = MOVE_DEADZONE * 0.5;
    expect(hasMovement(s)).toBe(false);
  });

  it('reports real intent', () => {
    const s = createInputSnapshot();
    s.moveZ = 0.9;
    expect(hasMovement(s)).toBe(true);
  });
});

describe('pack/unpack', () => {
  it('round-trips through the wire form', () => {
    const s = createInputSnapshot();
    Object.assign(s, {
      seq: 77, tMs: 5000, moveX: 0.5, moveZ: -0.25,
      yaw: 1.2345, pitch: -0.5, buttons: BUTTON.ATTACK, hotbar: 4, targetId: 'mob-9',
    });

    const back = unpackInputSnapshot(packInputSnapshot(s));

    expect(back).toEqual(s);
  });

  it('quantises rather than preserving float noise', () => {
    // Deliberately lossy: quantising keeps imperceptible float jitter from
    // defeating the dead-band check that decides whether to send at all.
    const s = createInputSnapshot();
    s.moveX = 0.123456789;
    s.yaw = 1.23456789;

    const back = unpackInputSnapshot(packInputSnapshot(s));

    expect(back.moveX).toBe(0.123);
    expect(back.yaw).toBe(1.2346);
    // Still far below anything a player can perceive (~0.006 degrees).
    expect(Math.abs(back.yaw - s.yaw)).toBeLessThan(0.0001);
  });

  it('survives JSON with a BigInt target id', () => {
    // The bug this pins: SpacetimeDB ids are u64 and the existing client already
    // reads BigInts. `JSON.stringify(1n)` THROWS, so a raw BigInt on the wire
    // would blow up inside whichever transport serialised first. An earlier
    // version of this test passed only because it never set a target.
    const s = createInputSnapshot();
    s.seq = 3;
    s.moveZ = 0.75;
    s.targetId = 12345678901234567890n;

    const wire = packInputSnapshot(s);
    expect(() => JSON.stringify(wire)).not.toThrow();

    const back = unpackInputSnapshot(JSON.parse(JSON.stringify(wire)));
    expect(back.moveZ).toBe(0.75);
    // Decimal string, not a number: as a JSON number this would silently lose
    // precision above 2^53.
    expect(back.targetId).toBe('12345678901234567890');
  });

  it('normalises every id form to a decimal string on the wire', () => {
    const cases = [
      [7n, '7'],
      ['mob-9', 'mob-9'],
      [42, '42'],
      [null, null],
      [undefined, null],
    ];
    for (const [input, expected] of cases) {
      const s = createInputSnapshot();
      s.targetId = input;
      expect(packId(s.targetId)).toBe(expected);
      expect(unpackInputSnapshot(packInputSnapshot(s)).targetId).toBe(expected);
    }
  });

  it('restores a null target rather than undefined', () => {
    const back = unpackInputSnapshot(packInputSnapshot(createInputSnapshot()));
    expect(back.targetId).toBeNull();
  });

  it('unpacks into a provided instance without allocating', () => {
    const into = createInputSnapshot();
    const s = createInputSnapshot();
    s.seq = 5;
    expect(unpackInputSnapshot(packInputSnapshot(s), into)).toBe(into);
    expect(into.seq).toBe(5);
  });
});
