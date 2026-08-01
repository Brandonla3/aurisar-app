/**
 * RealmScene — scene construction and the ONE render loop.
 *
 * Rules this module exists to hold:
 *  - There is exactly one `engine.runRenderLoop` in the Realm, and it is here.
 *  - Fog is configured here but WRITTEN by exactly one owner (atmosphere/FogDriver).
 *    The stack this replaces had two writers and a zone transition that swapped
 *    the fogColor object out from under the sky shader.
 *  - The scene carries no gameplay state. Simulation lives in sim/ and never
 *    touches a Babylon object.
 */

/* global BABYLON */

/** Stylized fantasy: a deep forest green that fog and sky both start from. */
export const DEFAULT_FOG_COLOR = { r: 0.24, g: 0.35, b: 0.28 };
export const DEFAULT_FOG_DENSITY = 0.0075;

export function createRealmScene(engine, { fogColor = DEFAULT_FOG_COLOR, fogDensity = DEFAULT_FOG_DENSITY } = {}) {
  const scene = new BABYLON.Scene(engine, {
    // These maps trade a little memory for large lookups later; with thousands of
    // instanced props they pay for themselves immediately.
    useGeometryUniqueIdsMap: true,
    useMaterialMeshMap: true,
    useClonedMeshMap: true,
  });

  // Exponential-squared fog reads as atmospheric depth rather than a visible
  // wall, and it costs nothing extra — density is a single uniform.
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor = new BABYLON.Color3(fogColor.r, fogColor.g, fogColor.b);
  scene.fogDensity = fogDensity;
  scene.clearColor = new BABYLON.Color4(fogColor.r, fogColor.g, fogColor.b, 1);

  // Pointer-move picking is a per-frame raycast against the whole scene. The
  // Realm targets on click/tap, not on hover, so this is pure waste.
  scene.skipPointerMovePicking = true;

  return scene;
}

/**
 * Start the single render loop.
 * @returns {() => void} teardown
 */
export function startRenderLoop(engine, scene, { onError } = {}) {
  let failed = false;
  engine.runRenderLoop(() => {
    if (failed) return;
    try {
      scene.render();
    } catch (err) {
      // One throw per frame would flood the console and hide the first, real
      // error. Stop the loop and hand the cause up once.
      failed = true;
      console.error('[RealmScene] render loop stopped:', err);
      onError?.(err);
    }
  });
  return () => engine.stopRenderLoop();
}
