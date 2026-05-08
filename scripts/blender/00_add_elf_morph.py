"""
00_add_elf_morph.py — Bake an `EarElf` shape key into the 3 base body GLBs.

The avatar schema maps `species.earMorph` → MPFB shape key name `EarElf`
(see src/features/world/game/avatarSchema.js MORPH_KEYS.earMorph).

This script:
  1. Imports each base body GLB.
  2. Adds a `Basis` shape key if missing.
  3. Adds an `EarElf` shape key.
  4. Detects the ear vertex region (vertices on either side of the head with
     X far from center, Z slightly behind the head, Y in the upper third).
  5. Translates those vertices upward + outward to elongate the ear into a
     classic elven point.
  6. Re-exports the GLB in place, preserving animations + materials.

Run:
    blender --background --python scripts/blender/00_add_elf_morph.py
"""
from __future__ import annotations

import os
import sys
import math
import bpy
from mathutils import Vector

REPO   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(REPO, 'public', 'assets', 'characters')

BASE_BODIES = ['base_body.glb', 'base_body_male.glb', 'base_body_female.glb']

# Elf-ear deformation parameters (meters, in the rest-pose space of MPFB bodies)
EAR_X_MIN     = 0.07   # ears sit beyond x=±0.07 from the head's centerline
EAR_Y_MIN     = 1.55   # head region starts ~1.55m up (depends on MPFB scale)
EAR_Y_MAX     = 1.80
EAR_Z_RANGE   = 0.08   # ears protrude in -Z (toward the back of head)
EAR_LIFT      = 0.045  # how far up to push the ear tip (m)
EAR_OUTWARD   = 0.020  # how far further out from the head (m)
EAR_TAPER_POW = 1.6    # exponent for tip falloff (higher = sharper point)


def _clear_scene() -> None:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(col):
            col.remove(item)


def _import_glb(path: str) -> tuple:
    bpy.ops.import_scene.gltf(filepath=path)
    mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    arm_objs  = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if not mesh_objs:
        raise RuntimeError(f'No mesh found in {path}')
    return mesh_objs[0], (arm_objs[0] if arm_objs else None)


def _ensure_basis(mesh_obj) -> None:
    if not mesh_obj.data.shape_keys:
        mesh_obj.shape_key_add(name='Basis', from_mix=False)


def _add_elf_shape_key(mesh_obj) -> None:
    keys = mesh_obj.data.shape_keys
    if keys and 'EarElf' in keys.key_blocks:
        # Re-author from scratch: clear data on existing key
        sk = keys.key_blocks['EarElf']
    else:
        sk = mesh_obj.shape_key_add(name='EarElf', from_mix=False)

    basis_sk = keys.key_blocks['Basis']
    bbox_y_max = max(v.co.y for v in basis_sk.data) if False else None  # unused

    # Detect ear vertices in the basis pose.
    # The ear region is defined by: |x| > EAR_X_MIN and Y between min/max
    # (head height) and Z within +/- EAR_Z_RANGE of head Z.
    head_verts_z = [v.co.z for i, v in enumerate(basis_sk.data)
                    if abs(v.co.x) > EAR_X_MIN and EAR_Y_MIN < v.co.y < EAR_Y_MAX]
    if not head_verts_z:
        print(f'  [warn] no ear-region vertices found — skipping')
        return
    head_z_center = sum(head_verts_z) / len(head_verts_z)

    deformed = 0
    for i, v_basis in enumerate(basis_sk.data):
        x, y, z = v_basis.co
        if abs(x) <= EAR_X_MIN:                      continue
        if not (EAR_Y_MIN < y < EAR_Y_MAX):          continue
        if abs(z - head_z_center) > EAR_Z_RANGE:     continue

        # Smooth weight: vertices farther from center deform more.
        nx = (abs(x) - EAR_X_MIN) / max(0.001, 0.07)        # 0..1 horizontal weight
        ny = (y - EAR_Y_MIN) / (EAR_Y_MAX - EAR_Y_MIN)      # 0..1 vertical weight
        weight = (max(0, min(1, nx)) ** EAR_TAPER_POW) * \
                 (max(0, min(1, ny)) ** 0.5)

        sign = 1.0 if x > 0 else -1.0
        new_x = x + sign * EAR_OUTWARD * weight
        new_y = y + EAR_LIFT * weight
        new_z = z

        sk.data[i].co = Vector((new_x, new_y, new_z))
        deformed += 1

    print(f'  EarElf: deformed {deformed} vertices')


def _export_glb(out_path: str) -> None:
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_apply=False,            # keep modifiers (skinning) intact
        export_morph=True,             # CRITICAL: write shape keys
        export_morph_normal=True,
        export_animations=True,        # preserve Idle/Walk/Run/Jump
        export_yup=True,
        use_selection=False,           # whole scene
    )


def main() -> int:
    failures = 0
    for fname in BASE_BODIES:
        path = os.path.join(ASSETS, fname)
        if not os.path.exists(path):
            print(f'[skip] {fname} not on disk')
            continue
        print(f'[run]  {fname}')
        _clear_scene()
        mesh_obj, _arm = _import_glb(path)
        _ensure_basis(mesh_obj)
        _add_elf_shape_key(mesh_obj)
        _export_glb(path)
        print(f'[OK]   {fname}')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
