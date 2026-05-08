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

Phase 1 (elf morph) is the only script that **modifies existing assets**. The others write new files only.

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
