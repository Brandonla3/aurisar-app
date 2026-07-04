/**
 * castleNavServer — walkability checks shared by client tests and SpacetimeDB.
 * Uses level-aware surfaceAt when floorYM is provided.
 */

import { LOCAL_BOUNDS, INTERIOR_ANCHOR, LEVELS } from './castlePlan.js';
import { createSurfaceQuery } from './castleNavSurface.js';

export function isInInteriorBounds(wx, wz, anchor = INTERIOR_ANCHOR) {
  const lx = wx - anchor.x, lz = wz - anchor.z;
  return lx >= LOCAL_BOUNDS.x0 && lx < LOCAL_BOUNDS.x1 &&
         lz >= LOCAL_BOUNDS.z0 && lz < LOCAL_BOUNDS.z1;
}

/** Ground-floor surface check at the entrance spawn column. */
export function isWalkableColumn(nav, wx, wz) {
  return createSurfaceQuery(nav).surfaceAt(wx, wz, LEVELS[1].y + 0.5) != null;
}

/**
 * Level-aware move check. Returns null outside the interior footprint.
 * @param {number} floorYM world vertical meters (avatar Y)
 */
export function castleMoveAllowed(nav, wx, wz, floorYM = LEVELS[1].y) {
  if (!isInInteriorBounds(wx, wz, nav.anchor)) return null;
  return createSurfaceQuery(nav).surfaceAt(wx, wz, floorYM) != null;
}
