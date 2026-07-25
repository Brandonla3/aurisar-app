/**
 * Crowd gating (Batch E) — the contract that keeps a busy hub affordable.
 *
 * Remote MPFB avatars, not mobs, are the dominant skeletal cost at 50-100
 * concurrent players: the plan's own risk register names them the top CPU
 * threat. Batch A shipped the gating primitive (AnimationController.suspend)
 * and wired it to mobs only; these tests pin the CharacterAvatar side that
 * Batch E adds, plus the invariant that matters most — gating must never
 * change WHERE an avatar is, only how much work it does.
 *
 * CharacterAvatar reads the ambient BABYLON global, so it has to be installed
 * before the module graph is first evaluated (see NpcSystem.test.js).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

function installFakeBabylon() {
  class FakeColor3 { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } }
  globalThis.BABYLON = {
    Color3: FakeColor3,
    DynamicTexture: class { constructor() { this.hasAlpha = false; } },
    StandardMaterial: class {},
    MeshBuilder: { CreatePlane: vi.fn() },
    Mesh: { BILLBOARDMODE_ALL: 7 },
  };
}

/** Records suspend/resume the way AnimationController does. */
function fakeAnimCtl() {
  return {
    suspended: false,
    updates: 0,
    suspend() { this.suspended = true; },
    resume() { this.suspended = false; },
    update() { this.updates++; },
    setLocomotionSpeed() {},
  };
}

function fakeLabelPlane() {
  return { enabled: true, setEnabled(v) { this.enabled = !!v; } };
}

describe('CharacterAvatar crowd gating', () => {
  const originalBabylon = globalThis.BABYLON;
  let CharacterAvatar;

  beforeAll(async () => {
    installFakeBabylon();
    ({ CharacterAvatar } = await import('./CharacterAvatar.js'));
  });
  afterAll(() => { globalThis.BABYLON = originalBabylon; });

  /** A bare avatar with the two collaborators gating touches. */
  const makeAvatar = () => {
    const av = new CharacterAvatar('a1', 'Tester', null, {});
    av._animCtl = fakeAnimCtl();
    av._labelPlane = fakeLabelPlane();
    return av;
  };

  it('starts ungated', () => {
    const av = makeAvatar();
    expect(av.suspended).toBe(false);
    expect(av._animCtl.suspended).toBe(false);
  });

  it('suspend freezes the animation controller and hides the nameplate', () => {
    const av = makeAvatar();
    av.setSuspended(true);
    expect(av.suspended).toBe(true);
    expect(av._animCtl.suspended).toBe(true);
    expect(av._labelPlane.enabled).toBe(false);
  });

  it('resume restores both', () => {
    const av = makeAvatar();
    av.setSuspended(true);
    av.setSuspended(false);
    expect(av.suspended).toBe(false);
    expect(av._animCtl.suspended).toBe(false);
    expect(av._labelPlane.enabled).toBe(true);
  });

  it('is idempotent — redundant calls do not thrash the controller', () => {
    const av = makeAvatar();
    let suspendCalls = 0;
    av._animCtl.suspend = () => { suspendCalls++; av._animCtl.suspended = true; };
    av.setSuspended(true);
    av.setSuspended(true);
    av.setSuspended(true);
    expect(suspendCalls).toBe(1);
  });

  it('update() short-circuits while gated — the cost this exists to avoid', () => {
    const av = makeAvatar();
    // Force the GLB path so update() would reach the animation controller.
    av._useFallback = false;
    av.root = { position: { x: 0, y: 0, z: 0 } };

    av.setSuspended(true);
    av.update(16);
    expect(av._animCtl.updates).toBe(0);

    av.setSuspended(false);
    av.update(16);
    expect(av._animCtl.updates).toBe(1);
  });

  it('a gated avatar keeps its position — gating must not desync placement', () => {
    const av = makeAvatar();
    av.root = { position: { x: 12, y: 1.5, z: -7 } };
    av.setSuspended(true);
    av.update(16);
    // update() is the only thing gating touches; the caller's position lerp
    // runs outside it, so the transform is untouched by suspension.
    expect(av.root.position).toEqual({ x: 12, y: 1.5, z: -7 });
  });

  it('nameplate can be hidden independently, but never shown while gated', () => {
    const av = makeAvatar();

    av.setNameplateVisible(false);
    expect(av._labelPlane.enabled).toBe(false);
    av.setNameplateVisible(true);
    expect(av._labelPlane.enabled).toBe(true);

    // Beyond the animation cap the label must stay hidden even if the
    // nameplate cap would have allowed it — suspension wins.
    av.setSuspended(true);
    av.setNameplateVisible(true);
    expect(av._labelPlane.enabled).toBe(false);
  });

  it('tolerates an avatar with no nameplate or controller yet', () => {
    const av = new CharacterAvatar('a2', 'NoLabel', null, {});
    expect(() => { av.setSuspended(true); av.setNameplateVisible(true); }).not.toThrow();
    expect(av.suspended).toBe(true);
  });
});
