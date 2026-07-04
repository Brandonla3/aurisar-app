# Castle Ashwood aesthetic design pass

This PR starts the Castle Ashwood polish pass as an isolated branch off `main`.

## What was added

- `src/features/world/castle/builders/aestheticPolish.js`
  - Exterior polish helpers for buttresses, corbel/machicolation rhythm, heavier base courses, chimneys, gate braziers, courtyard crates, and training dummies.
  - Interior hero-prop helpers for the entrance crest medallion, ballroom throne, library globe, treasury vault door, dungeon drain grates, and observatory star chart.
- `src/features/world/castle/CastleSystem.js`
  - Wires the exterior polish pass into the existing exterior build before merge.
  - Wires the interior hero-prop pass after the furniture pass and before nav blockers are committed.

The helper file follows the existing castle style:

- Babylon primitive meshes only.
- Existing shared material keys only.
- Deterministic placement.
- Collector-based static geometry for merge-friendly rendering.
- No extra real point lights.

## Implementation wiring

`CastleSystem.js` now imports:

```js
import {
  createCastleExteriorPolish,
  createCastleInteriorHeroProps,
} from './builders/aestheticPolish.js';
```

The exterior build now captures `baseY` from `createCastleExterior(...)` and applies the polish before the exterior merge:

```js
const { gateTorchPositions, baseY } = createCastleExterior(ctx, this._worldgen);
createCastleExteriorPolish(ctx, this._worldgen, baseY);
```

The interior build now applies hero props after furniture is placed:

```js
createAllFurniture(ctx, ax, az);
createCastleInteriorHeroProps(ctx, ax, az);
```

## Suggested review path

Run:

```bash
npm run lint
npm run build
npm run test
```

Then visually inspect:

- overworld castle approach/gate silhouette,
- courtyard detail density,
- ballroom focal read,
- treasury vault read,
- dungeon floor details,
- library/observatory hero props.

## Notes

This PR intentionally avoids touching worldgen, village work, terrain/grass work, gameplay systems, or SpacetimeDB files.
