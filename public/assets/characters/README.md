# Character Assets

## Base bodies

| File | Purpose |
|---|---|
| `base_body.glb` | Default character loaded by the world. Currently a copy of `base_body_male.glb`. |
| `base_body_male.glb` | Male MPFB-generated base body, ~10.5k tris, Mixamo-rigged. |
| `base_body_female.glb` | Female MPFB-generated base body, ~10.5k tris, Mixamo-rigged. |

Both gendered bases share:
- Bone names with no `mixamorig:` prefix (e.g. `Hips`, `Head`, `LeftHand`, `RightHand`).
  Matches `BONES` constants in `src/features/world/game/avatarSchema.js`.
- 4 animations baked as separate clips: **Idle**, **Walk**, **Run**, **Jump**.
- T-pose at rest, Y-up, normalised meter scale.

`CharacterAvatar.js` picks animations by name (`/idle/i`, `/walk/i`).

## Adding hair / clothing / species pieces (later)

Drop separate GLBs into the matching subfolders:

```
hair/
  hair_short.glb
  hair_long.glb
  hair_braids.glb
clothing/
  top_casual.glb
  top_hoodie.glb
  bottom_jeans.glb
  bottom_shorts.glb
  shoes_boots.glb
species/
  horns_small.glb
  horns_large.glb
  horns_curved.glb
```

Each piece must be weight-painted to the same skeleton as `base_body.glb` so it
follows the rig when attached. `AssetLibrary.js` loads each one as a separate
asset container; `CharacterAvatar` instantiates the right ones per player and
re-assigns the body skeleton so they deform together.

If a piece is missing, the runtime silently skips it and the character is
rendered without that slot — never throws.

## Fallback

If `base_body.glb` is absent entirely, `CharacterAvatar` falls back to a neutral
grey box humanoid so the world still loads.
