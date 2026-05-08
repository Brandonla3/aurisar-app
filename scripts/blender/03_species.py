"""
03_species.py — Generate 6 species accessory GLBs.

Horns (3): static mesh parented rigidly to the Head bone — no skinning needed.
Tails (3): skinned chain that follows Hips/Spine via auto-weights.

Outputs (under public/assets/characters/species/):
  horns_small.glb, horns_large.glb, horns_curved.glb
  tail_short.glb,  tail_long.glb,  tail_fluffy.glb

Run:
    blender --background --python scripts/blender/03_species.py
"""
from __future__ import annotations

import os
import sys
import math
import bpy
from mathutils import Vector

REPO    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS  = os.path.join(REPO, 'public', 'assets', 'characters')
SPECIES = os.path.join(ASSETS, 'species')
BASE    = os.path.join(ASSETS, 'base_body.glb')

HEAD_TOP  = Vector((0.0, 1.74, 0.0))   # approx top of skull
HIPS_Y    = 0.92                       # hips bone height (rest pose)
TAIL_BACK = -0.10                      # how far behind the hips the tail starts


# ── Helpers (scene/material) ────────────────────────────────────────────────

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
    body.hide_viewport = True
    body.hide_render   = True
    return arm


def _white_material(name: str):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs['Roughness'].default_value  = 0.6
    return mat


def _join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    res = bpy.context.active_object
    res.name = name
    return res


def _parent_to_head_bone(obj, arm):
    """Parent obj rigidly to the Head bone (no skinning)."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    # Activate Head bone
    bpy.ops.object.mode_set(mode='POSE')
    head_bone = arm.pose.bones.get('Head')
    if head_bone:
        arm.data.bones.active = arm.data.bones['Head']
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.parent_set(type='BONE', keep_transform=True)


def _bind_to_armature(obj, arm):
    """Skin obj with auto weights."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def _export_glb(out_path: str, *, has_skin: bool):
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
        export_skins=has_skin,
        export_yup=True,
        use_selection=True,
    )


# ── Horn builders ───────────────────────────────────────────────────────────

def _add_cone(radius: float, depth: float, location: Vector,
              rotation_euler=(0, 0, 0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=radius, radius2=0.001,
                                     depth=depth, location=location)
    obj = bpy.context.active_object
    obj.rotation_euler = rotation_euler
    bpy.ops.object.transform_apply(rotation=True)
    return obj


def build_horns_small():
    left  = _add_cone(0.018, 0.07,
                      HEAD_TOP + Vector((-0.045, -0.02, 0.0)),
                      rotation_euler=(math.radians(-10), 0, math.radians(10)))
    right = _add_cone(0.018, 0.07,
                      HEAD_TOP + Vector((0.045, -0.02, 0.0)),
                      rotation_euler=(math.radians(-10), 0, math.radians(-10)))
    return _join([left, right], 'horns_small')


def build_horns_large():
    left  = _add_cone(0.028, 0.18,
                      HEAD_TOP + Vector((-0.05, 0.0, 0.0)),
                      rotation_euler=(math.radians(-25), 0, math.radians(15)))
    right = _add_cone(0.028, 0.18,
                      HEAD_TOP + Vector((0.05, 0.0, 0.0)),
                      rotation_euler=(math.radians(-25), 0, math.radians(-15)))
    return _join([left, right], 'horns_large')


def build_horns_curved():
    """Ram-style spirals built from a Curve → Mesh."""
    objs = []
    for sign in (-1, 1):
        # Use a simple bezier circle squished + a path for the spiral feel.
        bpy.ops.curve.primitive_bezier_circle_add(radius=0.05,
                                                    location=HEAD_TOP + Vector((sign*0.06, -0.02, 0)))
        curve = bpy.context.active_object
        curve.data.bevel_depth = 0.018
        curve.data.bevel_resolution = 2
        curve.data.resolution_u = 8
        # Convert curve to mesh
        bpy.ops.object.convert(target='MESH')
        m = bpy.context.active_object
        m.scale = (0.7, 0.9, 1.0)
        bpy.ops.object.transform_apply(scale=True)
        objs.append(m)
    return _join(objs, 'horns_curved')


# ── Tail builders ───────────────────────────────────────────────────────────

def _add_tail_chain(name: str, segments: int, length: float, base_radius: float,
                    fluffy: bool = False) -> bpy.types.Object:
    """Build a tapered tail mesh from a series of cylinder segments."""
    objs = []
    seg_len = length / segments
    radius = base_radius
    y = HIPS_Y
    z = TAIL_BACK
    droop_per_seg = 0.04 if not fluffy else 0.06
    for i in range(segments):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=10, radius=radius, depth=seg_len,
            location=(0, y, z))
        seg = bpy.context.active_object
        seg.rotation_euler = (math.radians(90), 0, 0)  # cylinder along Z
        bpy.ops.object.transform_apply(rotation=True)
        objs.append(seg)
        # Step toward the tip — slight downward droop and shrinking radius
        z -= seg_len * 0.95
        y -= droop_per_seg * (i + 1) / segments
        radius *= 0.85 if not fluffy else 0.92

    if fluffy:
        # Add a hemispherical "puff" at the tip
        bpy.ops.mesh.primitive_uv_sphere_add(radius=base_radius * 0.9,
                                              segments=12, ring_count=8,
                                              location=(0, y, z))
        objs.append(bpy.context.active_object)
    return _join(objs, name)


def build_tail_short():  return _add_tail_chain('tail_short',  segments=3, length=0.18, base_radius=0.035)
def build_tail_long():   return _add_tail_chain('tail_long',   segments=6, length=0.45, base_radius=0.030)
def build_tail_fluffy(): return _add_tail_chain('tail_fluffy', segments=4, length=0.30, base_radius=0.045, fluffy=True)


# ── Main ────────────────────────────────────────────────────────────────────

HORNS = [
    ('horns_small.glb',  build_horns_small),
    ('horns_large.glb',  build_horns_large),
    ('horns_curved.glb', build_horns_curved),
]

TAILS = [
    ('tail_short.glb',  build_tail_short),
    ('tail_long.glb',   build_tail_long),
    ('tail_fluffy.glb', build_tail_fluffy),
]

MAX_TRIS = 1500


def _decimate(obj, max_tris):
    bpy.context.view_layer.objects.active = obj
    me = obj.data
    me.calc_loop_triangles()
    cur = len(me.loop_triangles)
    if cur <= max_tris: return
    ratio = max(0.05, max_tris / cur)
    mod = obj.modifiers.new('Decimate', 'DECIMATE')
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def main() -> int:
    os.makedirs(SPECIES, exist_ok=True)

    # Horns — rigid parent to Head bone
    for fname, builder in HORNS:
        out_path = os.path.join(SPECIES, fname)
        print(f'[run]  {fname}')
        _clear_scene()
        arm = _import_base_body()
        obj = builder()
        obj.data.materials.clear()
        obj.data.materials.append(_white_material(f'{obj.name}_mat'))
        _decimate(obj, MAX_TRIS)
        _parent_to_head_bone(obj, arm)
        _export_glb(out_path, has_skin=False)
        print(f'[OK]   {fname}')

    # Tails — skinned to armature
    for fname, builder in TAILS:
        out_path = os.path.join(SPECIES, fname)
        print(f'[run]  {fname}')
        _clear_scene()
        arm = _import_base_body()
        obj = builder()
        obj.data.materials.clear()
        obj.data.materials.append(_white_material(f'{obj.name}_mat'))
        _decimate(obj, MAX_TRIS)
        _bind_to_armature(obj, arm)
        _export_glb(out_path, has_skin=True)
        print(f'[OK]   {fname}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
