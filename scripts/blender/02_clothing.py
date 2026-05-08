"""
02_clothing.py — Generate 16 fantasy clothing GLBs.

Approach: import base_body.glb, duplicate the relevant body region (torso for
tops, legs for bottoms, feet for shoes), scale outward ~0.01m so it sits over
the body without z-fighting, then parent to the armature with automatic weights
so the cloth deforms with the rig.

Outputs (all under public/assets/characters/clothing/):

  TOPS:    top_tunic.glb, top_robe.glb, top_cloth_shirt.glb,
           top_gambeson.glb, top_leather_vest.glb, top_chainmail.glb
  BOTTOMS: bottom_trousers.glb, bottom_kilt.glb, bottom_leather_pants.glb,
           bottom_breeches.glb, bottom_cloth_skirt.glb, bottom_leggings.glb
  SHOES:   shoes_boots.glb, shoes_sandals.glb, shoes_greaves.glb,
           shoes_leather_wraps.glb

Run:
    blender --background --python scripts/blender/02_clothing.py
"""
from __future__ import annotations

import os
import sys
import bpy
from mathutils import Vector

REPO   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(REPO, 'public', 'assets', 'characters')
CLOTH  = os.path.join(ASSETS, 'clothing')
BASE   = os.path.join(ASSETS, 'base_body.glb')

# Y-axis Up; meter scale. Tune if the MPFB rig you ship differs.
TORSO_Y_MIN = 0.95
TORSO_Y_MAX = 1.50
HIPS_Y      = 0.92
KNEE_Y      = 0.50
ANKLE_Y     = 0.10
FOOT_Y      = 0.04
INFLATE     = 0.012   # outward offset to prevent body z-fight


def _clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(col):
            col.remove(item)


def _import_base_body():
    bpy.ops.import_scene.gltf(filepath=BASE)
    arm  = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    return arm, body


def _white_material(name: str):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs['Roughness'].default_value  = 0.7
    return mat


def _duplicate_body_region(body, y_min, y_max,
                           extra_below: float = 0.0,
                           extra_above: float = 0.0):
    """Duplicate the body, then delete vertices outside the y range. Returns a new mesh obj."""
    # Duplicate the body
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    dup = bpy.context.active_object
    dup.hide_viewport = False
    dup.hide_render   = False

    # Drop modifiers (Armature) — we re-add later via auto-weights
    for m in list(dup.modifiers):
        dup.modifiers.remove(m)

    # Delete verts outside band
    me = dup.data
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    keep_min = y_min - extra_below
    keep_max = y_max + extra_above
    for v in me.vertices:
        if v.co.y < keep_min or v.co.y > keep_max:
            v.select = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.delete(type='VERT')
    bpy.ops.object.mode_set(mode='OBJECT')

    # Inflate slightly along normals
    if INFLATE > 0:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.transform.shrink_fatten(value=INFLATE)
        bpy.ops.object.mode_set(mode='OBJECT')

    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return dup


def _bind_to_armature(obj, arm):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    obj.select_set(False)
    arm.select_set(False)


def _decimate(obj, max_tris: int):
    bpy.context.view_layer.objects.active = obj
    me = obj.data
    me.calc_loop_triangles()
    cur = len(me.loop_triangles)
    if cur <= max_tris:
        return
    ratio = max(0.05, max_tris / cur)
    mod = obj.modifiers.new('Decimate', 'DECIMATE')
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _export_glb(out_path: str):
    bpy.ops.object.select_all(action='DESELECT')
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    arm.select_set(True)
    # Select all visible meshes EXCEPT the original body
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and not o.hide_viewport and 'top_' in o.name + 'bottom_' + o.name + 'shoes_' + o.name:
            pass
    # Simpler: select every mesh tagged with 'GARMENT' custom prop
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('GARMENT'):
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_apply=True,
        export_animations=False,
        export_morph=False,
        export_yup=True,
        use_selection=True,
    )


def _tag_garment(obj, name):
    obj.name = name
    obj['GARMENT'] = True
    obj.data.materials.clear()
    obj.data.materials.append(_white_material(f'{name}_mat'))


# ── Garment build functions ────────────────────────────────────────────────

def build_top_basic(name: str, y_low=TORSO_Y_MIN, y_high=TORSO_Y_MAX, extra_below=0.0):
    """Generic upper-body shell — used for tunics, shirts, vests, etc."""
    arm, body = bpy.context.scene['_arm'], bpy.context.scene['_body']
    obj = _duplicate_body_region(body, y_low, y_high, extra_below=extra_below)
    _tag_garment(obj, name)
    return obj


def build_bottom_basic(name: str, y_low: float, y_high: float):
    """Generic lower-body shell — pants, skirt, kilt, leggings."""
    body = bpy.context.scene['_body']
    obj = _duplicate_body_region(body, y_low, y_high)
    _tag_garment(obj, name)
    return obj


def build_shoe(name: str, y_high: float = ANKLE_Y):
    """Foot/lower-shin shell."""
    body = bpy.context.scene['_body']
    obj = _duplicate_body_region(body, FOOT_Y, y_high)
    _tag_garment(obj, name)
    return obj


# ── Garment specs (length, budget) ─────────────────────────────────────────

TOPS = [
    # (filename, y_low, y_high, extra_below — for long robes)
    ('top_tunic.glb',         TORSO_Y_MIN - 0.05, TORSO_Y_MAX, 0.0),
    ('top_robe.glb',          KNEE_Y,             TORSO_Y_MAX, 0.0),   # full-length robe
    ('top_cloth_shirt.glb',   TORSO_Y_MIN,        TORSO_Y_MAX, 0.0),
    ('top_gambeson.glb',      TORSO_Y_MIN - 0.05, TORSO_Y_MAX, 0.0),
    ('top_leather_vest.glb',  TORSO_Y_MIN,        TORSO_Y_MAX - 0.10, 0.0),
    ('top_chainmail.glb',     TORSO_Y_MIN - 0.08, TORSO_Y_MAX, 0.0),
]

BOTTOMS = [
    # (filename, y_low, y_high)
    ('bottom_trousers.glb',     ANKLE_Y, HIPS_Y),
    ('bottom_kilt.glb',         KNEE_Y,  HIPS_Y),
    ('bottom_leather_pants.glb',ANKLE_Y, HIPS_Y),
    ('bottom_breeches.glb',     KNEE_Y - 0.05, HIPS_Y),
    ('bottom_cloth_skirt.glb',  ANKLE_Y + 0.05, HIPS_Y),
    ('bottom_leggings.glb',     ANKLE_Y, HIPS_Y),
]

SHOES = [
    ('shoes_boots.glb',         KNEE_Y - 0.10),  # knee-high boots
    ('shoes_sandals.glb',       FOOT_Y + 0.04),  # foot only
    ('shoes_greaves.glb',       KNEE_Y),         # full shin coverage
    ('shoes_leather_wraps.glb', ANKLE_Y + 0.04),
]

MAX_TRIS = 6000


def main() -> int:
    os.makedirs(CLOTH, exist_ok=True)

    # Tops
    for fname, y_low, y_high, extra_below in TOPS:
        out_path = os.path.join(CLOTH, fname)
        print(f'[run]  {fname}')
        _clear_scene()
        arm, body = _import_base_body()
        bpy.context.scene['_arm']  = arm
        bpy.context.scene['_body'] = body
        obj = build_top_basic(fname[:-4], y_low, y_high, extra_below)
        body.hide_viewport = True
        body.hide_render   = True
        _decimate(obj, MAX_TRIS)
        _bind_to_armature(obj, arm)
        _export_glb(out_path)
        print(f'[OK]   {fname}')

    # Bottoms
    for fname, y_low, y_high in BOTTOMS:
        out_path = os.path.join(CLOTH, fname)
        print(f'[run]  {fname}')
        _clear_scene()
        arm, body = _import_base_body()
        bpy.context.scene['_body'] = body
        obj = build_bottom_basic(fname[:-4], y_low, y_high)
        body.hide_viewport = True
        body.hide_render   = True
        _decimate(obj, MAX_TRIS)
        _bind_to_armature(obj, arm)
        _export_glb(out_path)
        print(f'[OK]   {fname}')

    # Shoes
    for fname, y_high in SHOES:
        out_path = os.path.join(CLOTH, fname)
        print(f'[run]  {fname}')
        _clear_scene()
        arm, body = _import_base_body()
        bpy.context.scene['_body'] = body
        obj = build_shoe(fname[:-4], y_high)
        body.hide_viewport = True
        body.hide_render   = True
        _decimate(obj, MAX_TRIS)
        _bind_to_armature(obj, arm)
        _export_glb(out_path)
        print(f'[OK]   {fname}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
