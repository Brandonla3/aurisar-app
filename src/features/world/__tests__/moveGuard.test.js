/**
 * The server's movement speed ceiling (review H7).
 *
 * `movePlayer` is client-authoritative about position, and every server-side
 * proximity gate reads that row, so the ceiling is what stops "I am standing
 * at the treasury chest" from being a free assertion. Pure arithmetic, so it
 * tests directly — no reducer harness needed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampMoveToMaxSpeed,
  MAX_MOVE_SPEED_MPS,
  MOVE_JITTER_GRACE_M,
  MOVE_MAX_CREDIT_MICROS,
} from '../../../../spacetimedb/src/world/moveGuard.ts';
import { PX_PER_M } from '../worldSpace.js';
import {
  castleInteriorSurfaceAt,
  castleInteriorResolveMove,
} from '../../../../spacetimedb/src/castle/validate.ts';
import {
  CASTLE_NAV_META,
  CASTLE_LEVELS,
  CASTLE_STEP_UP,
} from '../../../../spacetimedb/src/castle/navGrids.ts';

const repoRoot = join(import.meta.dirname, '../../../..');

/** The server's own move-rate floor — the shortest gap it will ever see. */
const FLOOR_MICROS = 40_000n;

describe('clampMoveToMaxSpeed', () => {
  it('leaves an ordinary step untouched', () => {
    // 80 ms of walking at full tilt is 0.96 m — well inside the allowance.
    const step = 0.96 * PX_PER_M;
    const r = clampMoveToMaxSpeed(0, 0, step, 0, 80_000n);
    expect(r.clamped).toBe(false);
    expect(r.x).toBe(step);
    expect(r.y).toBe(0);
  });

  it('cuts a teleport back to the allowance, keeping the direction', () => {
    // The exploit this exists for: a claim 400 m away in one call.
    const r = clampMoveToMaxSpeed(0, 0, 400 * PX_PER_M, 0, FLOOR_MICROS);
    expect(r.clamped).toBe(true);
    // 12 m/s for 40 ms = 0.48 m, plus the 0.75 m jitter grace.
    expect(r.x / PX_PER_M).toBeCloseTo(12 * 0.04 + MOVE_JITTER_GRACE_M, 6);
    expect(r.y).toBe(0);
  });

  it('clamps along the claimed heading rather than snapping to an axis', () => {
    // Diagonal claim: the clamped point must stay on the same ray, or the
    // player would be dragged sideways into geometry they never walked at.
    const far = 300 * PX_PER_M;
    const r = clampMoveToMaxSpeed(100, 100, 100 + far, 100 + far * 2, 100_000n);
    expect(r.clamped).toBe(true);
    expect((r.y - 100) / (r.x - 100)).toBeCloseTo(2, 9);
  });

  it('never rejects — a clamped move still advances the row', () => {
    // The whole reason this clamps instead of returning: a stalled client must
    // still make progress, or it desyncs permanently.
    const prev = { x: 500, y: 500 };
    const r = clampMoveToMaxSpeed(prev.x, prev.y, 90_000, 500, FLOOR_MICROS);
    expect(r.x).toBeGreaterThan(prev.x);
    expect(Math.hypot(r.x - prev.x, r.y - prev.y)).toBeGreaterThan(0);
  });

  it('caps the budget so idling does not bank a teleport', () => {
    // An hour of standing still must not buy a cross-map jump: the allowance
    // saturates at MOVE_MAX_CREDIT_MICROS.
    const hour = 3_600_000_000n;
    const far = 5_000 * PX_PER_M;
    const idled = clampMoveToMaxSpeed(0, 0, far, 0, hour);
    const capped = clampMoveToMaxSpeed(0, 0, far, 0, MOVE_MAX_CREDIT_MICROS);
    expect(idled.clamped).toBe(true);
    expect(idled.x).toBeCloseTo(capped.x, 6);
    // 3 s of credit is 36 m, plus grace — bounded well short of the 520 m disc.
    expect(idled.x / PX_PER_M).toBeLessThan(40);
  });

  it('absorbs a stall burst instead of stranding the player', () => {
    // 3 s of queued movement arriving at once: allowed outright, because the
    // budget is measured from the last ACCEPTED move.
    const burst = 30 * PX_PER_M;
    const r = clampMoveToMaxSpeed(0, 0, burst, 0, 3_000_000n);
    expect(r.clamped).toBe(false);
  });

  it('gives only the grace term when the clock does not advance', () => {
    // Same-instant replay or clock skew: no budget, but never a negative one.
    // This is also how movePlayer spends a baseline-less row (lastMoveAt 0),
    // so a first move can never be a free teleport.
    for (const elapsed of [0n, -5_000_000n]) {
      const r = clampMoveToMaxSpeed(0, 0, 999 * PX_PER_M, 0, elapsed);
      expect(r.clamped).toBe(true);
      expect(r.x / PX_PER_M).toBeCloseTo(MOVE_JITTER_GRACE_M, 6);
    }
  });
});

describe('every path that writes a position seeds lastMoveAt', () => {
  // The guard measures from player.lastMoveAt, so any path that writes a
  // position without setting it hands the next move an allowance it did not
  // earn — and a row still sitting at 0 would get an unbounded first move.
  // Reducers need a live module to run, so this asserts the wiring in source.
  const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');

  /** Body of the reducer/update starting at `anchor`, up to the closing `});`. */
  const blockAfter = (anchor) => {
    const at = server.indexOf(anchor);
    expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
    return server.slice(at, server.indexOf('});', at));
  };

  it('movePlayer never skips the clamp on a zero baseline', () => {
    const body = blockAfter('export const movePlayer');
    // The clamp must be unconditional; the zero case is spent as zero elapsed.
    expect(body).toContain('clampMoveToMaxSpeed(');
    expect(body).toMatch(/existing\.lastMoveAt > 0n \? nowMicros - existing\.lastMoveAt : 0n/);
    expect(body, 'clamp must not sit behind an if (lastMoveAt > 0) guard')
      .not.toMatch(/if \(existing\.lastMoveAt > 0n\) \{\s*const guarded/);
  });

  it('spawn seeds it', () => {
    expect(blockAfter('ctx.db.player.insert({'))
      .toContain('lastMoveAt: ctx.timestamp.microsSinceUnixEpoch');
  });

  it('connect seeds it', () => {
    expect(blockAfter('spacetimedb.clientConnected'))
      .toContain('lastMoveAt: ctx.timestamp.microsSinceUnixEpoch');
  });

  it.each([
    ['dungeon entry', 'const spawnPx ='],
    ['dungeon exit', 'const leavingInstance ='],
  ])('%s teleport seeds it', (_label, anchor) => {
    expect(blockAfter(anchor))
      .toContain('lastMoveAt: ctx.timestamp.microsSinceUnixEpoch');
  });

  it('respawn seeds it', () => {
    expect(blockAfter('const prevInstanceId ='))
      .toContain('lastMoveAt: ctx.timestamp.microsSinceUnixEpoch');
  });
});

describe('a wall-crossing clamped step still resolves', () => {
  // Clamping projects along the straight chord to the claim, so indoors it can
  // land in a wall even when both endpoints are walkable. The reducer resolves
  // a clamped step through the same wall-slide the client uses; this pins the
  // property that makes it safe — from a walkable spot it ALWAYS yields a
  // surface, so a clamped step can never strand the row on a rejection.
  const walkable = (() => {
    // Find a real interior floor cell from the nav meta rather than
    // hard-coding a coordinate that a castle relayout would invalidate.
    const { anchor, bounds } = CASTLE_NAV_META;
    for (let xm = bounds.x0; xm <= bounds.x1; xm += 0.5) {
      for (let zm = bounds.z0; zm <= bounds.z1; zm += 0.5) {
        const wx = anchor.x + xm;
        const wz = anchor.z + zm;
        if (castleInteriorSurfaceAt(wx, wz, CASTLE_LEVELS[1].y)) return { wx, wz };
      }
    }
    return null;
  })();

  it('found a walkable interior cell to test from', () => {
    expect(walkable, 'no walkable interior cell — castle nav data missing?').toBeTruthy();
  });

  it('slides instead of returning nothing when the chord leaves the interior', () => {
    // Aim far outside the interior footprint: the direct point is unwalkable,
    // which before the fix meant the reducer returned and advanced nothing.
    const r = castleInteriorResolveMove(
      walkable.wx, walkable.wz, walkable.wx + 500, walkable.wz + 500,
      CASTLE_LEVELS[1].y,
    );
    expect(r.surface, 'resolver must never leave a walkable step unresolved').toBeTruthy();
  });

  it('resolves to a point on the same floor', () => {
    const r = castleInteriorResolveMove(
      walkable.wx, walkable.wz, walkable.wx + 500, walkable.wz + 500,
      CASTLE_LEVELS[1].y,
    );
    expect(Math.abs(r.floorYM - CASTLE_LEVELS[1].y)).toBeLessThanOrEqual(CASTLE_STEP_UP);
  });
});

describe('a clamped step cannot wedge the row', () => {
  // Clamping projects along the straight chord to the claim, which indoors can
  // cross a wall even when both endpoints are walkable. Two safeguards keep a
  // shortened step from leaving the row stranded behind the avatar.
  const server = readFileSync(join(repoRoot, 'spacetimedb/src/index.ts'), 'utf8');
  const scene = readFileSync(
    join(repoRoot, 'src/features/world/game/BabylonWorldScene.js'), 'utf8',
  );

  it('a clamped indoor step goes through the wall-slide resolver', () => {
    const body = server.slice(server.indexOf('export const movePlayer'));
    expect(body).toContain('if (guarded.clamped) {');
    expect(body).toContain('castleInteriorResolveMove(');
    // An unclamped claim must keep the strict all-or-nothing check, or
    // ordinary moves into walls would start being quietly slid instead.
    expect(body).toMatch(/} else \{[\s\S]{0,400}castleInteriorSurfaceAt\([\s\S]{0,120}if \(!surface\) return;/);
  });

  it('the client feeds the server offset into the send decision', () => {
    // Behaviour is covered in moveSync.test.js; this pins the wiring, since a
    // scene test cannot stage the network stall that reaches it.
    expect(scene).toMatch(/_serverPos\s*=\s*\{\s*x:\s*row\.x,\s*y:\s*row\.y\s*\}/);
    expect(scene).toContain('shouldSendMove({');
    expect(scene).toMatch(/serverOffsetPx:\s*this\._serverOffsetPx\(toStdb\(x\), toStdb\(z\)\)/);
    expect(scene).toMatch(/alive:\s*this\._localHp > 0/);
  });
});

describe('the ceiling matches the client it is policing', () => {
  it('MAX_MOVE_SPEED_MPS equals BabylonWorldScene._moveLocal speed', () => {
    // The client integrates `speed * dt` with dt in milliseconds, so the
    // literal is m/ms. If someone speeds the player up without moving this
    // constant, the server would clamp every honest player — pin them
    // together the way worldSpace.test.js pins the px/m constants.
    const scene = readFileSync(
      join(repoRoot, 'src/features/world/game/BabylonWorldScene.js'), 'utf8',
    );
    const m = scene.match(/const speed = ([\d.]+);/);
    expect(m, 'movement speed literal not found in _moveLocal').toBeTruthy();
    expect(Number(m[1]) * 1000).toBe(MAX_MOVE_SPEED_MPS);
  });

  it('moveGuard px/m matches the client scale it converts with', () => {
    // moveGuard keeps its own PX_PER_M (the server module has no shared
    // constants file — chest.ts does the same). worldSpace.test.js already
    // pins the client/index.ts pair; this covers the third copy, so a scale
    // change cannot leave the ceiling silently converting at the old rate.
    const guard = readFileSync(
      join(repoRoot, 'spacetimedb/src/world/moveGuard.ts'), 'utf8',
    );
    const m = guard.match(/const PX_PER_M = (\d+);/);
    expect(m, 'PX_PER_M not found in moveGuard.ts').toBeTruthy();
    expect(Number(m[1])).toBe(PX_PER_M);
  });

  it('a full-rate honest client is never clamped', () => {
    // The client paces sends at 80 ms; the server floor is 40 ms. Both must
    // pass untouched at full walking speed, including the worst jitter case
    // where an 80 ms step arrives after only 40 ms.
    const stepPx = MAX_MOVE_SPEED_MPS * PX_PER_M * 0.08;
    for (const elapsed of [80_000n, FLOOR_MICROS]) {
      expect(clampMoveToMaxSpeed(0, 0, stepPx, 0, elapsed).clamped).toBe(false);
    }
  });
});
