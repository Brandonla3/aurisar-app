# Aurisar Realm

The world. A ground-up replacement for the `Ashwood` stack (`../game`, `../streaming`,
`../worldgen`, `../castle`), built for a stylized fantasy MMO that scales down to iOS Safari.

Everything here is procedural. There are no GLB files, no downloaded textures, no external
assets of any kind — terrain, trees, rocks, ruins, characters and weapons are all generated
at runtime.

---

## The one rule

```
view/        The ONLY place BABYLON may be referenced.
everywhere   Engine-free. No exceptions, including the realm root.
else/
```

`boundary.test.js` enforces this, plus a 400-line-per-file ceiling. Both fail the build.

Note the rule is phrased as *"everything outside `view/`"*, not as a list of pure folders.
An allowlist only polices the folders you thought of — the first version of this test named
`model|gen|sim|settings`, which left the realm root and any folder added later free to
import the engine while this README claimed otherwise. Inverting it means the doc and the
test cannot drift apart. Tests are exempt (they stand up a `NullEngine` legitimately).

This is not stylistic. The stack being replaced started clean and ended as a single
3,794-line file owning the engine, camera, mobs, shadows and streaming at once. Conventions
rot silently; a failing test does not.

The payoff is that most of the Realm is testable in plain node — no GPU, no jsdom, no
`NullEngine`. If a decision can be made without an engine, it belongs in a pure layer.

### Layer intent

| Layer | Holds | Testable as |
|---|---|---|
| `model/` | Deterministic world math — the height field, noise, biomes, LOD policy, collision | plain node |
| `gen/` | Mesh generation. Emits typed-array payloads, never Babylon objects | plain node |
| `sim/` | Game simulation, state store, transports. Stateful but engine-free | plain node |
| &nbsp;&nbsp;↳ | `RealmStore` (sliced state, rev counters) · `dispatch` (validate → predict → send → settle, owns `seq`) · `WorldTransport` (the server seam) · `transports/LocalTransport` + `memoryDb` (the authoritative world in-process — shared rules, not a mock) · `rules/` (validation both the reducer and LocalTransport call) | |
| `settings/` | Graphics tiers, renderer choice. DOM only inside `realmProbe` | plain node |
| `view/` | Everything Babylon. Turns payloads into meshes and draws them | `NullEngine` / browser |

---

## Conventions

- **Never `import BABYLON from 'babylonjs'` in `view/`.** Read the ambient UMD global and
  declare `/* global BABYLON */`. Entry points import `src/babylonGlobal.js` *first* — see
  that file for the production outage it prevents.
- **`BABYLON.GUI` exists only on the global**, never on the `babylonjs` module exports.
  `import BABYLON from 'babylonjs'; BABYLON.GUI` is `undefined`. This is verified in
  `babylonCapabilities.test.js`.
- **Relative imports with `.js` extensions.** No path aliases exist in this repo.
- **Custom shader math goes through `RealmFnBlock`, never `CustomBlock`.** `CustomBlock`
  emits its source verbatim with no language branch, so GLSL written into one compiles on
  WebGL2 and fails *only* on WebGPU. `RealmFnBlock` subclasses `NodeMaterialBlock` and runs
  its source through Babylon's BabylonSL transpiler, matching how stock blocks
  (`WorleyNoise3DBlock`) do it.

## Verification

`npm test` covers the pure layers, which is most of the code.

Two things have **no headless test path** and must be checked in a browser:

1. **Shaders.** `NullEngine` does not compile GLSL. Tests guard the JS/API layer and the
   shader-hook strings, never pixels.
2. **The GUI.** `AdvancedDynamicTexture` requires `OffscreenCanvas`, which neither node nor
   jsdom provides — it cannot be instantiated in a test at all. This is why HUD code splits
   into a pure presenter (what should the bar read; did the value change) and a thin ADT
   writer.

`realm-spike.html` is the real-GPU surface for both. Run `npm run dev` and open
`/realm-spike.html`; add `?renderer=webgpu` to exercise the WebGPU path.

## Backends

WebGL2 is what ships. WebGPU is opt-in behind a graphics-panel flag and is never selected
by `auto` — see `settings/rendererChoice.js` for the policy and why.
