import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Minimal fakes covering only what NpcSystem._makeMarker touches, plus the
// module-top-level BABYLON.Color3 use in CharacterAvatar.js's CLOTHING_DEFAULTS
// (NpcSystem.js imports CharacterAvatar.js). NpcSystem.js relies on the
// ambient `BABYLON` global rather than an import, so — unlike a plain static
// import — it must be installed BEFORE this module graph is first evaluated;
// a dynamic import() after the global is set achieves that (a static import
// is hoisted and would run first).
function installFakeBabylon() {
  class FakeDynamicTexture {
    constructor() { this.hasAlpha = false; }
  }
  class FakeStandardMaterial {
    constructor() {}
  }
  class FakeColor3 {
    constructor(r, g, b) { this.r = r; this.g = g; this.b = b; }
  }
  class FakePlane {
    constructor() {
      this.position = { set: vi.fn() };
      this.isPickable = true;
      this._enabled = true;
    }
    setEnabled(v) { this._enabled = v; }
  }
  globalThis.BABYLON = {
    DynamicTexture: FakeDynamicTexture,
    StandardMaterial: FakeStandardMaterial,
    Color3: FakeColor3,
    MeshBuilder: { CreatePlane: vi.fn(() => new FakePlane()) },
    Mesh: { BILLBOARDMODE_ALL: 7 },
  };
}

describe('NpcSystem — GlowLayer exclusion for the quest marker plane', () => {
  const originalBabylon = globalThis.BABYLON;
  let NpcSystem;

  beforeAll(async () => {
    installFakeBabylon();
    ({ NpcSystem } = await import('./NpcSystem.js'));
  });

  afterAll(() => {
    globalThis.BABYLON = originalBabylon;
  });

  it('invokes the injected excludeFromGlow callback with the created marker plane', () => {
    const excludeFromGlow = vi.fn();
    const sys = new NpcSystem({}, {}, {}, { excludeFromGlow });
    const { plane } = sys._makeMarker('npc_test', {});
    expect(excludeFromGlow).toHaveBeenCalledTimes(1);
    expect(excludeFromGlow).toHaveBeenCalledWith(plane);
  });

  it('is a safe no-op when no excludeFromGlow callback is provided (desktop / no-GlowLayer path)', () => {
    // No options object at all — matches BabylonWorldScene's own
    // `(mesh) => this._lm?.excludeFromGlow(mesh)` degrading to a no-op
    // when _lm.excludeFromGlow itself no-ops (desktop, _glowLayer null).
    const sys = new NpcSystem({}, {}, {});
    expect(() => sys._makeMarker('npc_test2', {})).not.toThrow();
  });
});
