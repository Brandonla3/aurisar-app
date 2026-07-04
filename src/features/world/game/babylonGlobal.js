/**
 * babylonGlobal — publish the bundled Babylon UMD as window.BABYLON.
 *
 * Must be the FIRST import of any entry that pulls in the world scene:
 * several world modules (CharacterAvatar's default-color tables, for one)
 * evaluate `BABYLON.*` at module scope, so the global has to exist before
 * their module bodies run. Entries that assigned window.BABYLON in their
 * own body (WorldGame.jsx, devWorldViewer.js) did it too late — import
 * hoisting evaluates the whole scene graph first — and only worked when an
 * earlier-loaded chunk (AvatarPreview) happened to set the global.
 */

import BABYLON from 'babylonjs';
import 'babylonjs-loaders';

if (typeof window !== 'undefined' && !window.BABYLON) {
  window.BABYLON = BABYLON;
}

export default BABYLON;
