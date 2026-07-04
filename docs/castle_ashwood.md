# Castle Ashwood — Layout & Collision Spec

Castle Ashwood is a **procedural** 5-floor dungeon. The single source of truth is [`castlePlan.js`](../src/features/world/castle/castlePlan.js). Geometry builders and the nav model both consume only that module so rendered walls and walkable space cannot drift apart.

A machine-readable export is generated at build time:

- [`public/assets/castle/castle_ashwood.json`](../public/assets/castle/castle_ashwood.json)
- [`spacetimedb/src/manifests/castle_ashwood.json`](../spacetimedb/src/manifests/castle_ashwood.json)

Regenerate with `npm run emit:castle`.

## Server validation

SpacetimeDB `movePlayer` validates interior moves with level-aware `surfaceAt` (not column-OR): the client sends `floorYM` (avatar world Y), and the server resolves the reachable floor via `spacetimedb/src/castle/surface.ts` (mirrors `castleNavSurface.js`). Nav bitmaps plus `CASTLE_LEVELS` / `CASTLE_STAIRS` are emitted to `navGrids.ts`.

## Dungeon instances (v2)

- **`enterDungeon` / `leaveDungeon`** — server-authoritative gate entry and interior exit
- **`dungeonInstance`** table + `player.dungeonInstanceId` / `mob.dungeonInstanceId`
- Instance mobs seed from `castleAshwood.generated.ts` on first member entry
- Client syncs interior presentation from the player row
- **`player.floorYM`** persisted for reconnect + server surfaceAt reference

**Planned in the same epic:** interior mob AI, minLevel gating, Gorrak quest wiring, boss mechanics.

## Coordinate scheme

- All layout rects are in **interior-local meters** (post-`PLAN_SCALE = 1.75`).
- World position = local + `interiorAnchor` (`{ x: 840, z: 0 }`).
- The **exterior shell** is separate at `exterior.site` (`{ x: 150, z: 20 }`) on overworld terrain.
- Entry/exit is press-E at the gate — server reducers authorize the teleport.

## Levels

| Index | Id       | Floor Y | Role                                      |
|-------|----------|---------|-------------------------------------------|
| 0     | dungeon  | 0.6     | Cells, vault, guard post                  |
| 1     | ground   | 11.0    | Entrance, kitchen, dining, servants       |
| 2     | f2       | 22.0    | Ballroom (double height), guest rooms     |
| 3     | f3       | 31.6    | Master suites, library, gallery balcony   |
| 4     | f4       | 41.2    | Royal suite, treasury, tower rooms        |

## Materials (spec-driven)

Room `kind` selects floor/wall materials via `MATERIAL_SPEC` in `castlePlan.js`:

- **Marble** — entrance, corridors, gallery, ballroom, treasury, baths
- **Wood** — bedrooms, dining, library, royal suites
- **Dark stone** — dungeon, kitchen, storage

Upper floors use plaster walls; dungeon uses blue-tinted dark stone.

## Collision model

Three analytic systems — no Babylon physics engine:

1. **Interior movement** — 0.25 m nav grids (`castleNav.js`). Player radius (`0.35 m`) is baked into room insets; runtime uses point tests + axis wall-slide.
2. **Furniture/columns/railings** — builders record `navBlockers`; `CastleSystem` stamps them post-build via `blockRect()`.
3. **Exterior shell** — rect footprint + corner tower circles + gate turret circles (`SHELL_COLLISION` constants).

Camera wall handling uses custom LOS ray marching (`isOpenBelow` / `shellCameraOpenDist`), not `checkCollisions`.

## Dev tools

- World viewer: `/world-viewer.html?pos=140,20` — approach the gate
- Nav overlay: `?nav=1&navLevel=3` — subsampled walkability grid (green = open, red = blocked)

## Tests

Vitest guards in `src/features/world/castle/__tests__/`:

- Room non-overlap, door edge validity, stair containment
- Full-floor connectivity with furniture blockers
- Spawn marker positions at scaled room centers
