# Castle Ashwood aesthetic design pass

This PR starts the Castle Ashwood polish pass as an isolated branch off `main`.

## What was added

- `src/features/world/castle/builders/aestheticPolish.js`
  - Exterior polish helpers for buttresses, corbel/machicolation rhythm, heavier base courses, chimneys, gate braziers, courtyard crates, and training dummies.
  - Interior hero-prop helpers for the entrance crest medallion, ballroom throne, library globe, treasury vault door, dungeon drain grates, and observatory star chart.

The helper file follows the existing castle style:

- Babylon primitive meshes only.
- Existing shared material keys only.
- Deterministic placement.
- Collector-based static geometry for merge-friendly rendering.
- No extra real point lights.

## Intended wiring

The intended follow-up wiring is deliberately small and localized to `CastleSystem.js`:

```js
import {
  createCastleExteriorPolish,
  createCastleInteriorHeroProps,
} from './builders/aestheticPolish.js';
```

Then inside the exterior build block:

```js
const { gateTorchPositions, baseY } = createCastleExterior(ctx, this._worldgen);
createCastleExteriorPolish(ctx, this._worldgen, baseY);
```

And inside the interior build block after `createAllFurniture(ctx, ax, az);`:

```js
createCastleInteriorHeroProps(ctx, ax, az);
```

## Suggested review path

1. Review the new builder module as a safe, isolated first commit.
2. Wire it into `CastleSystem.js` in a second commit.
3. Run:

```bash
npm run lint
npm run build
npm run test
```

4. Visually inspect:

- overworld castle approach/gate silhouette,
- courtyard detail density,
- ballroom focal read,
- treasury vault read,
- dungeon floor details,
- library/observatory hero props.

## Notes

This PR intentionally avoids touching worldgen, village work, terrain/grass work, gameplay systems, or SpacetimeDB files.
