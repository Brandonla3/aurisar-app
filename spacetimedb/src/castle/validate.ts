/**
 * Castle interior nav validation for SpacetimeDB movePlayer.
 * Level-aware surfaceAt — see surface.ts (mirrors castleNavSurface.js).
 */

export {
  pxToWorldM,
  worldMToPx,
  isInCastleInterior,
  castleInteriorSurfaceAt,
  castleInteriorMoveAllowed,
  castleInteriorResolveMove,
  sameInteriorFloor,
} from './surface.js';
