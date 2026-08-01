/**
 * InputSnapshot — one frame of player intent, as plain data.
 *
 * PURE. No BABYLON, no DOM, no reading of key state. Something else samples the
 * keyboard/pointer/joystick and fills one of these in; everything downstream —
 * movement integration, prediction, the wire — consumes only this struct.
 *
 * Why it is a flat struct of numbers rather than an object graph:
 *  - It is produced every frame. Allocation here is allocation 60x/second, so
 *    the API is built around reusing one instance (`reset`/`copy`) rather than
 *    creating a fresh object per tick.
 *  - It becomes a network packet. Keeping it to fixed-width scalars means
 *    packing is mechanical and the wire format is obvious by inspection.
 *
 * The sequence number is the spine of client prediction: the client keeps
 * unacknowledged snapshots, and the server echoes `seq` so the client knows how
 * far its own simulation can be trusted. See dispatch/reconcile.
 */

/** Buttons live in one bitfield so the wire cost is a single integer. */
export const BUTTON = Object.freeze({
  NONE: 0,
  JUMP: 1 << 0,
  SPRINT: 1 << 1,
  INTERACT: 1 << 2,
  ATTACK: 1 << 3,
  CROUCH: 1 << 4,
});

/** No hotbar slot pressed this frame. Not 0 — 0 is a valid slot. */
export const NO_HOTBAR = -1;

export function createInputSnapshot() {
  return {
    seq: 0,
    tMs: 0,
    /** Intent on the ground plane, camera-relative, within the unit disc. */
    moveX: 0,
    moveZ: 0,
    /** Camera orientation in radians. */
    yaw: 0,
    pitch: 0,
    buttons: BUTTON.NONE,
    /** Hotbar slot pressed this frame, or NO_HOTBAR. */
    hotbar: NO_HOTBAR,
    /**
     * Current target, or null. Identity, not a position.
     *
     * In memory this may be a string or a BigInt — SpacetimeDB ids are u64, and
     * the existing client already reads wallet balances as BigInt. On the WIRE
     * it is always a decimal string or null: `JSON.stringify` THROWS on BigInt,
     * and a u64 beyond 2^53 loses precision as a JSON number. String is the only
     * form that is both serialisable and lossless.
     */
    targetId: null,
  };
}

/** Clear in place, preserving `seq` so the sequence stays monotonic. */
export function resetInputSnapshot(s) {
  s.tMs = 0;
  s.moveX = 0;
  s.moveZ = 0;
  s.yaw = 0;
  s.pitch = 0;
  s.buttons = BUTTON.NONE;
  s.hotbar = NO_HOTBAR;
  s.targetId = null;
  return s;
}

export function copyInputSnapshot(dst, src) {
  dst.seq = src.seq;
  dst.tMs = src.tMs;
  dst.moveX = src.moveX;
  dst.moveZ = src.moveZ;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.buttons = src.buttons;
  dst.hotbar = src.hotbar;
  dst.targetId = src.targetId;
  return dst;
}

export const isDown = (s, mask) => (s.buttons & mask) !== 0;

export function setButton(s, mask, down) {
  if (down) s.buttons |= mask;
  else s.buttons &= ~mask;
  return s;
}

/**
 * Constrain movement intent to the unit disc, in place.
 *
 * Holding W+D gives (1,1), a vector of length 1.41 — the classic diagonal-speed
 * bug, where players learn to run everywhere at 41% extra speed. Clamping rather
 * than always-normalising preserves analog sticks: a half-pushed stick must stay
 * at half speed.
 */
export function clampMoveToUnitDisc(s) {
  const lenSq = s.moveX * s.moveX + s.moveZ * s.moveZ;
  if (lenSq > 1) {
    const inv = 1 / Math.sqrt(lenSq);
    s.moveX *= inv;
    s.moveZ *= inv;
  }
  return s;
}

/** Below this, movement intent is treated as released rather than drift. */
export const MOVE_DEADZONE = 0.08;

export function hasMovement(s) {
  return s.moveX * s.moveX + s.moveZ * s.moveZ > MOVE_DEADZONE * MOVE_DEADZONE;
}

/**
 * Wire form: a fixed-length array of scalars, angles and axes quantised.
 *
 * Deliberately lossy. Axes get 1/1000 and angles 1/10000 of a radian (~0.006°),
 * both far below what a player can perceive or a server needs to validate, and
 * quantising keeps float noise from making every idle frame look like a change
 * to the dead-band check that decides whether to send at all.
 */
const AXIS_Q = 1000;
const ANGLE_Q = 10000;
const q = (v, f) => Math.round(v * f) / f;

/**
 * Normalise an id to its wire form: a decimal string, or null.
 *
 * BigInt is not JSON-serialisable (`JSON.stringify(1n)` throws), and a u64 id
 * above 2^53 cannot survive as a JSON number. Every transport JSON-encodes at
 * some point, so the conversion happens here, once, rather than in each one.
 */
export function packId(id) {
  return id == null ? null : String(id);
}

export function packInputSnapshot(s) {
  return [
    s.seq,
    s.tMs,
    q(s.moveX, AXIS_Q),
    q(s.moveZ, AXIS_Q),
    q(s.yaw, ANGLE_Q),
    q(s.pitch, ANGLE_Q),
    s.buttons,
    s.hotbar,
    packId(s.targetId),
  ];
}

export function unpackInputSnapshot(wire, into = createInputSnapshot()) {
  const [seq, tMs, moveX, moveZ, yaw, pitch, buttons, hotbar, targetId] = wire;
  into.seq = seq;
  into.tMs = tMs;
  into.moveX = moveX;
  into.moveZ = moveZ;
  into.yaw = yaw;
  into.pitch = pitch;
  into.buttons = buttons;
  into.hotbar = hotbar;
  into.targetId = targetId ?? null;
  return into;
}
