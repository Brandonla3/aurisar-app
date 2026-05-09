# Blender Character Asset Pipeline

Scripts in this directory generate every `.glb` referenced by `src/features/world/game/AssetLibrary.js` under `public/assets/characters/`.

They are written to be:
- **Idempotent** — safe to re-run; each script clears the scene first.
- **Headless-runnable** — `blender --background --python <script>.py`.
- **Blender-MCP-compatible** — each script is short enough to send to a Blender MCP `execute_python` tool in a single message.

## Order of execution

| Order | Script | Output |
|-------|--------|--------|
| 1 | `00_add_elf_morph.py` | Bakes the `EarElf` shape key into all 3 existing base bodies |
| 2 | `01_hair.py`           | 8 hair `.glb`s under `public/assets/characters/hair/` |
| 3 | `02_clothing.py`       | 16 fantasy clothing `.glb`s under `public/assets/characters/clothing/` |
| 4 | `03_species.py`        | 6 species accessory `.glb`s (3 horns + 3 tails) under `public/assets/characters/species/` |
| —  | `04_import_armor.py`   | **Per-asset processor** — auto-skins one raw armor GLB to the MPFB rig. Run once per piece, not as part of the bulk pipeline. Outputs to `public/assets/characters/gear/`. |

Phase 1 (elf morph) is the only script that **modifies existing assets**. Scripts 1-3 write new files only. `04_import_armor.py` is invoked per-asset (CLI args or library call).

## Authoring new armor (auto-skin pipeline)

`04_import_armor.py` is how raw armor GLBs (BlenderKit, Quixel, Sketchfab CC0, hand-modeled) become game-ready skinned assets.

```bash
blender --background --python scripts/blender/04_import_armor.py -- \
  --input  ~/Downloads/some_helmet.glb \
  --output public/assets/characters/gear/helmet_warlord.glb \
  --slot   helmet
```

What it does:
1. Loads `base_body_male.glb` as the reference rig (provides 65 Mixamo bones + source skin weights).
2. Loads the raw armor GLB. **Original materials are preserved** — no overrides.
3. Applies all geometry-affecting modifiers (Mirror, Subsurf, Solidify, Auto Smooth) so the exported mesh matches the artist's viewport.
4. Drops any armature the armor brought with it.
5. Transfers vertex group weights from the body to each armor mesh via `bpy.ops.object.data_transfer` with `POLYINTERP_NEAREST` mapping.
6. Binds each armor mesh to the body's armature with an Armature modifier.
7. Exports armor meshes + body armature only (the body mesh itself is excluded) as a GLB.

After exporting, wire the asset:
- Add `'gear/<key>': 'gear/<key>.glb'` to `MANIFEST` in `src/features/world/game/AssetLibrary.js` AND `src/features/avatar/AvatarPreview.jsx`.
- Add `{ key: '<key>', label: '...' }` to the appropriate slot list in `src/features/avatar/panels/GearPanel.jsx`.

The runtime (`setGear` in `CharacterAvatar.js`) then loads it, parents to the character root, re-points each mesh's skeleton at the live body skeleton, and disposes the GLB's duplicate armature so skeleton count stays flat as more pieces equip.

### Pre-fitting in Blender first

The pipeline assumes the armor is **roughly aligned** with the body in Blender before export. Weight transfer uses closest-surface mapping, so an armor piece floating off to the side will get nonsense weights. Open the armor + `base_body_male.glb` together in Blender, scale/translate the armor to sit on the right body part, then export.

### Limits

- **Skinned armor only.** Rigid weapons (swords, shields) need a different code path — `setGear` will need a "no skin weights → attachToBone" branch when those land.
- **One body rig.** Pipeline targets `base_body_male.glb`. If/when female/elf base bodies have different bone counts or names, weight transfer will need to run per body or use a shared canonical rig.

## Blender requirements

- Blender 4.0+ (the glTF exporter must support `export_morph_normal=True`)
- No add-ons required — all scripts use the built-in `bpy` API only

## Running headless

```bash
cd /path/to/aurisar-app
blender --background --python scripts/blender/00_add_elf_morph.py
blender --background --python scripts/blender/01_hair.py
blender --background --python scripts/blender/02_clothing.py
blender --background --python scripts/blender/03_species.py
```

Each script prints `[OK] <filename>` on success.

## Running via Blender MCP

If you have a Blender MCP server connected, send the contents of each `.py` file as a `python_exec` (or equivalent) tool call. The scripts use absolute paths derived from the working directory, so set the Blender working directory to the repo root first.

## Topology budgets (enforced by README in `public/assets/characters/`)

| Slot      | Tris budget |
|-----------|-------------|
| Base body | ≤ 12,000    |
| Hair      | ≤ 4,000     |
| Clothing  | ≤ 6,000     |
| Species   | ≤ 1,500     |

The procedural meshes in these scripts intentionally come in well under budget so that a future artist pass (manual sculpting via Blender MCP interactive sessions) can refine silhouette and add detail.

## Material contract

Every generated mesh has:
- a single PBR material
- white base color (`#FFFFFF`)
- no emissive, no vertex colors
- runtime-tinted via `albedoColor` from the avatar config (hair color, skin tone, etc.)

## Bone naming

All scripts re-use the armature from `public/assets/characters/base_body.glb` and import it before exporting. Bone names match `BONES` in `src/features/world/game/avatarSchema.js`:
- `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`
- `LeftShoulder`, `RightShoulder`, `LeftArm`, `RightArm`, `LeftForeArm`, `RightForeArm`, `LeftHand`, `RightHand`
- `LeftUpLeg`, `RightUpLeg`, `LeftLeg`, `RightLeg`, `LeftFoot`, `RightFoot`

## What these scripts ARE / are NOT

**They ARE:** functional placeholder geometry that respects budgets, the export contract, and the schema. Once they run, the game world's character creator immediately has working assets for every slot — no more empty fallback boxes.

**They are NOT:** art-quality final assets. The procedural shapes are simple primitives (cones, scaled body-region duplicates, beveled cylinders). For final art quality, run the scripts to establish the pipeline, then iterate on each mesh in Blender (manually or via Blender MCP interactive sessions) before re-exporting over the placeholder.
