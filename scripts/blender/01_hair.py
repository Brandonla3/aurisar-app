"""
01_hair.py — Generate 8 hairstyle GLBs.

Each hairstyle:
  - Imports base_body.glb to use the head bone as a parent / skinning anchor.
  - Procedurally builds the hair mesh from primitives.
  - Parents to the armature with automatic weights so it follows head/spine.
  - Applies a single white PBR material (runtime-tinted via avatar config).
  - Exports under public/assets/characters/hair/.

Outputs:
  hair_short.glb  hair_long.glb     hair_braids.glb  hair_ponytail.glb
  hair_bun.glb    hair_wavy.glb     hair_afro.glb    hair_mohawk.glb

Run:
    blender --background --python scripts/blender/01_hair.py
"""
from __future__ import annotations

import os
import sys
import math
import bpy
from mathutils import Vector, Matrix

REPO   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(REPO, 'public', 'assets', 'characters')
HAIR   = os.path.join(ASSETS, 'hair')
BASE   = os.path.join(ASSETS, 'base_body.glb')

# Head pivot measured from base_body.glb: Head bone head=1.462 tail=1.673 → center 1.567.
# Blender Z = height (GLTF Y-up value). Blender Y = depth (negative = behind character).
HEAD_CENTER = Vector((0.0, 0.0, 1.57))
HEAD_RADIUS = 0.105


# ── Scene helpers ───────────────────────────────────────────────────────────

def _clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(col):
            col.remove(item)


def _import_base_body():
    """Import base_body.glb and return the armature object."""
    bpy.ops.import_scene.gltf(filepath=BASE)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    # Hide the body mesh — we just want the rig as a parent target
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.hide_viewport = True
            o.hide_render   = True
    return arm


def _white_material(name: str):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs['Roughness'].default_value  = 0.6
        # Metallic input name varies between Blender 3.x/4.x:
        for input_name in ('Metallic', 'Metallic '):
            if input_name in bsdf.inputs:
                bsdf.inputs[input_name].default_value = 0.0
                break
    return mat


def _decimate_to_budget(obj, max_tris: int):
    """Add a Decimate modifier targeting <= max_tris and apply it."""
    bpy.context.view_layer.objects.active = obj
    me = obj.data
    me.calc_loop_triangles()
    cur = len(me.loop_triangles)
    if cur <= max_tris:
        return
    ratio = max(0.05, max_tris / cur)
    mod = obj.modifiers.new(name='Decimate', type='DECIMATE')
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _bind_to_head(obj, arm):
    """Parent obj rigidly to the Head bone of arm. No skinning needed for static caps."""
    # Use armature parent w/ auto weights for skinned hair (follows neck/spine)
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    obj.select_set(False)
    arm.select_set(False)


def _export_glb(out_path: str):
    """Export the active object + the armature it's bound to."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type in {'MESH', 'ARMATURE'} and not o.hide_viewport:
            o.select_set(True)
    # Un-hide armature & ALL meshes? No — the body is hidden; we only want
    # the new hair mesh + the armature. Re-select explicitly:
    bpy.ops.object.select_all(action='DESELECT')
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    arm.select_set(True)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and not o.hide_viewport:
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


# ── Hair primitive builders ─────────────────────────────────────────────────

def _add_uv_sphere_cap(name: str, radius: float, height_scale: float = 0.6):
    """Hemispherical cap that sits over the skull."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=20, ring_count=12,
                                          location=HEAD_CENTER)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (1.0, 1.05, height_scale)   # Z is height axis; compress to cap shape
    bpy.ops.object.transform_apply(scale=True)
    # Delete bottom half (verts with z < HEAD_CENTER.z - 0.005)
    me = obj.data
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in me.vertices:
        if v.co.z < HEAD_CENTER.z - 0.005:
            v.select = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.delete(type='VERT')
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def _extrude_strands(obj, count: int, length: float, jitter: float = 0.02):
    """Pseudo-strands: select bottom rim verts and extrude downward in chunks."""
    me = obj.data
    rim_z = min(v.co.z for v in me.vertices) + 0.01
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in me.vertices:
        if v.co.z <= rim_z:
            v.select = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.extrude_region_move(
        TRANSFORM_OT_translate={'value': (0, 0, -length)})
    bpy.ops.object.mode_set(mode='OBJECT')


def _add_ponytail(name='ponytail', length=0.30):
    """Single tail behind the head."""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.025, depth=length,
        location=HEAD_CENTER + Vector((0, -0.10, -0.06)))
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = (math.radians(15), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    return obj


def _add_bun(name='bun'):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=0.06, segments=14, ring_count=10,
        location=HEAD_CENTER + Vector((0, -0.08, 0.04)))
    obj = bpy.context.active_object
    obj.name = name
    return obj


def _add_braids(parent_name='braids'):
    """Two symmetrical braided strands hanging at the sides."""
    objs = []
    for sign, suffix in ((-1, 'L'), (1, 'R')):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.018, depth=0.32,
            location=HEAD_CENTER + Vector((sign * 0.08, -0.02, -0.18)))
        o = bpy.context.active_object
        o.name = f'{parent_name}_{suffix}'
        # Slight twist via shear
        o.scale = (1.0, 1.0, 0.85)
        bpy.ops.object.transform_apply(scale=True)
        objs.append(o)
    return _join(objs, parent_name)


def _add_mohawk(name='mohawk'):
    bpy.ops.mesh.primitive_cube_add(size=1.0,
                                     location=HEAD_CENTER + Vector((0, 0, 0.05)))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (0.04, 0.07, 0.16)
    bpy.ops.object.transform_apply(scale=True)
    # Bevel edges for a softer look
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('bev', 'BEVEL')
    mod.width = 0.01
    mod.segments = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def _add_afro(name='afro'):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, segments=18, ring_count=12,
                                          location=HEAD_CENTER + Vector((0, 0, 0.04)))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (1.05, 0.95, 1.05)
    bpy.ops.object.transform_apply(scale=True)
    return obj


def _add_wavy_long(name='wavy'):
    """Long wavy hair shell that drapes past shoulders."""
    cap = _add_uv_sphere_cap(name, radius=HEAD_RADIUS * 1.05, height_scale=0.7)
    _extrude_strands(cap, count=12, length=0.35)
    return cap


def _add_long_straight(name='long'):
    cap = _add_uv_sphere_cap(name, radius=HEAD_RADIUS * 1.04, height_scale=0.65)
    _extrude_strands(cap, count=12, length=0.40)
    return cap


def _join(objs, joined_name: str):
    """Join a list of mesh objects, return the result."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    res = bpy.context.active_object
    res.name = joined_name
    return res


# ── Per-style build functions ───────────────────────────────────────────────

def build_hair_short():     return _add_uv_sphere_cap('hair_short', HEAD_RADIUS * 1.06, 0.55)
def build_hair_long():      return _add_long_straight('hair_long')
def build_hair_braids():
    cap   = _add_uv_sphere_cap('hair_braids_cap', HEAD_RADIUS * 1.04, 0.55)
    braids = _add_braids('hair_braids_strands')
    return _join([cap, braids], 'hair_braids')
def build_hair_ponytail():
    cap = _add_uv_sphere_cap('hair_ponytail_cap', HEAD_RADIUS * 1.04, 0.55)
    pt  = _add_ponytail('hair_ponytail_tail', length=0.32)
    return _join([cap, pt], 'hair_ponytail')
def build_hair_bun():
    cap = _add_uv_sphere_cap('hair_bun_cap', HEAD_RADIUS * 1.05, 0.55)
    bun = _add_bun('hair_bun_top')
    return _join([cap, bun], 'hair_bun')
def build_hair_wavy():      return _add_wavy_long('hair_wavy')
def build_hair_afro():      return _add_afro('hair_afro')
def build_hair_mohawk():
    cap = _add_uv_sphere_cap('hair_mohawk_base', HEAD_RADIUS * 1.0, 0.45)
    fin = _add_mohawk('hair_mohawk_fin')
    return _join([cap, fin], 'hair_mohawk')


HAIRSTYLES = [
    ('hair_short.glb',    build_hair_short),
    ('hair_long.glb',     build_hair_long),
    ('hair_braids.glb',   build_hair_braids),
    ('hair_ponytail.glb', build_hair_ponytail),
    ('hair_bun.glb',      build_hair_bun),
    ('hair_wavy.glb',     build_hair_wavy),
    ('hair_afro.glb',     build_hair_afro),
    ('hair_mohawk.glb',   build_hair_mohawk),
]

MAX_TRIS = 4000


def main() -> int:
    os.makedirs(HAIR, exist_ok=True)
    for fname, builder in HAIRSTYLES:
        out_path = os.path.join(HAIR, fname)
        print(f'[run]  {fname}')
        _clear_scene()
        arm = _import_base_body()
        obj = builder()
        # Single white PBR material
        obj.data.materials.clear()
        obj.data.materials.append(_white_material(f'{obj.name}_mat'))
        # Recalc normals + cleanup
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.mesh.remove_doubles(threshold=0.001)
        bpy.ops.object.mode_set(mode='OBJECT')
        _decimate_to_budget(obj, MAX_TRIS)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        _bind_to_head(obj, arm)
        _export_glb(out_path)
        print(f'[OK]   {fname}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
