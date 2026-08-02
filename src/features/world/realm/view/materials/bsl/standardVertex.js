/**
 * standardVertex — the vertex-stage wiring every atmosphere material shares.
 *
 * Extracted rather than copy-pasted a third time. skyDomeNME.js and
 * ringNME.js both need "transform position to clip space" and "view
 * direction from the camera" — and for rings to share the dome's exact
 * elevation convention (clamp(normalize(worldPos - cameraPosition).y, 0, 1)),
 * they must be the SAME graph, not two hand-written copies that could drift.
 */

/* global BABYLON */

/**
 * @returns {{worldPos, vertexOutput}} — connect worldPos into whatever needs
 *   world position (view direction, fog distance); vertexOutput is already
 *   wired to clip-space position and just needs adding as an output node.
 */
export function buildStandardVertexChain() {
  const position = new BABYLON.InputBlock('position');
  position.setAsAttribute('position');
  const world = new BABYLON.InputBlock('world');
  world.setAsSystemValue(BABYLON.NodeMaterialSystemValues.World);
  const viewProjection = new BABYLON.InputBlock('viewProjection');
  viewProjection.setAsSystemValue(BABYLON.NodeMaterialSystemValues.ViewProjection);

  const worldPos = new BABYLON.TransformBlock('worldPos');
  position.connectTo(worldPos);
  world.output.connectTo(worldPos.transform);

  const wvp = new BABYLON.TransformBlock('wvp');
  worldPos.output.connectTo(wvp.vector);
  viewProjection.output.connectTo(wvp.transform);

  const vertexOutput = new BABYLON.VertexOutputBlock('vertexOutput');
  wvp.output.connectTo(vertexOutput.vector);

  return { worldPos, vertexOutput };
}

/**
 * @param {object} worldPos the TransformBlock from buildStandardVertexChain
 * @returns {{dir}} unnormalized worldPos - cameraPosition. Callers normalize
 *   and clamp .y themselves — that clamp is the shared "elevation" contract
 *   both the dome and the rings must apply identically.
 */
export function buildViewDirection(worldPos) {
  const cameraPosition = new BABYLON.InputBlock('cameraPosition');
  cameraPosition.setAsSystemValue(BABYLON.NodeMaterialSystemValues.CameraPosition);
  const posXYZ = new BABYLON.VectorSplitterBlock('posXYZ');
  worldPos.output.connectTo(posXYZ.xyzw);
  const dir = new BABYLON.SubtractBlock('dir');
  posXYZ.xyzOut.connectTo(dir.left);
  cameraPosition.output.connectTo(dir.right);
  return { dir };
}
