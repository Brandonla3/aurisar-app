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

## Adding hair / clothing / species pieces

Drop separate GLBs into the matching subfolders. The currently-registered keys
live in `MANIFEST` inside `src/features/world/game/AssetLibrary.js` (mirrored in
`src/features/avatar/AvatarPreview.jsx` — keep both in sync). Picker keys live
alongside in `src/features/avatar/panels/{Hair,Clothing,Species}Panel.jsx`.

```
hair/
  hair_short.glb
  hair_long.glb
  hair_braids.glb
  hair_ponytail.glb
  hair_bun.glb
  hair_wavy.glb
  hair_afro.glb
  hair_mohawk.glb
  # hair_shaved.glb — DO NOT export. Renders as nothing.
clothing/
  top_casual.glb       top_hoodie.glb
  bottom_jeans.glb     bottom_shorts.glb
  shoes_boots.glb
species/
  horns_small.glb      horns_large.glb       horns_curved.glb
```

Each piece must be weight-painted to the same skeleton as `base_body.glb` so it
follows the rig when attached. `AssetLibrary.js` loads each one as a separate
asset container; `CharacterAvatar` instantiates the right ones per player and
re-assigns the body skeleton so they deform together.

If a piece is missing, the runtime silently skips it and the character is
rendered without that slot — never throws.

### Blender export contract

These rules match what `CharacterAvatar.setHair()` / `_rebuildClothingSlot()` /
`_rebuildHorns()` actually do at runtime — diverge from them and the asset
either fails to tint, fails to deform with the body, or sits in the wrong place.

**Rig & origin**
- Open `base_body.glb` in Blender, parent your new piece to that armature with
  automatic weights, then export. The runtime reassigns
  `mesh.skeleton = body.skeleton`, so bone names must match exactly: `Hips`,
  `Spine1`, `Head`, `LeftHand`, `RightHand` (see `BONES` in
  `src/features/world/game/avatarSchema.js`).
- Apply Location/Rotation/Scale (`Ctrl+A → All Transforms`) before export.
- Static accessories (horns, jewelry — non-deforming) can skip skinning and
  parent to the relevant bone (`Head` for horns); `_rebuildHorns` will still
  find them via `inst.rootNodes`.

**Materials**
- **Single material per asset, base color white** (`#FFFFFF`).
- The runtime tints `mesh.material.albedoColor` from the panel's color picker
  on every material it finds (`_applyHairColor` in `CharacterAvatar.js`). Bake
  any darker shading into the normal/AO map — albedo darkness multiplies
  with the tint and looks muddy.
- Babylon-compatible PBR maps only: BaseColor, Normal, ORM (or separate
  Occlusion/Roughness/Metallic). No emissive on hair/clothing.

**Topology budgets**

| Slot      | Tris budget |
|-----------|-------------|
| Base body | ≤ 12,000    |
| Hair      | ≤ 4,000     |
| Clothing  | ≤ 6,000     |
| Species   | ≤ 1,500     |

Avoid n-gons (`Mesh → Clean Up → Tris/Quads`).

**glTF export settings** (`File → Export → glTF 2.0 (.glb)`)
- Format: glTF Binary (.glb)
- Include: Selected Objects (your mesh + the armature it's bound to)
- Transform: +Y Up ✓
- Geometry: Apply Modifiers ✓, UVs ✓, Normals ✓, Vertex Colors OFF,
  Tangents ON (only if you ship a normal map)
- Animation: OFF for hair/clothing/species. ON only for `base_body.glb`.
- Compression: OFF for now; revisit if total asset size exceeds ~30 MB.

**Naming.** Filename must equal the manifest key's basename. Mismatch =
silent 404 = empty slot:

```
HAIR_STYLES[i].key = 'hair_ponytail'
   ⇒ public/assets/characters/hair/hair_ponytail.glb
```

### Adding a new style end-to-end

1. Author + export the GLB to the right folder.
2. Add the key to the matching panel in `src/features/avatar/panels/`.
3. Add the manifest entry to **both** `AssetLibrary.js` and
   `AvatarPreview.jsx`.
4. Reload. The picker shows it, the preview loads it, the world syncs it.

### Reference assets

`.claude/worktrees/intelligent-goldberg-a6a2f4/public/avatars/models/` has
older Blender exports (`hair_fe_long.glb`, `hair_ma_short.glb`, …). Useful as a
scale/rigging reference; **do not import directly** — that worktree is
disconnected from main and the rig won't match the current `base_body.glb`.

## Fallback

If `base_body.glb` is absent entirely, `CharacterAvatar` falls back to a neutral
grey box humanoid so the world still loads.
