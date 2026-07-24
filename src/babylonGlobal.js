/**
 * babylonGlobal — establishes `window.BABYLON` from the bundled UMD BEFORE
 * `babylonjs-loaders` (and the decoder chunks it can pull) evaluate.
 *
 * The world scene + the loaders reference the ambient `BABYLON` global at module
 * EVALUATION time. Setting it in an importing module's BODY runs too late: ES
 * imports — including `babylonjs-loaders` and any statically-referenced decoder
 * chunk — evaluate before the importing module's body. When the bundler INLINES
 * the Draco/KTX2 decoders into the babylon chunk they ride babylon core's own UMD
 * global side-effect and it works; when it SPLITS a decoder into its own chunk
 * (which rolldown does under some entry configs), that chunk reads the bare
 * `BABYLON` global without an import edge to whatever sets it — so the global must
 * already be live, or it throws "BABYLON is not defined" and the whole World
 * fails to load.
 *
 * Fix: import THIS module first — before `babylonjs-loaders` — everywhere Babylon
 * is used, so `window.BABYLON` is assigned during the first import's evaluation,
 * ahead of the loaders and their decoders. Re-exports BABYLON for local use.
 */
import BABYLON from 'babylonjs';

if (typeof window !== 'undefined' && !window.BABYLON) {
  window.BABYLON = BABYLON;
}

export default BABYLON;
