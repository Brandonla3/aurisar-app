"""
04_import_armor.py — Auto-skin a raw armor GLB to the MPFB body rig.

The previous attempt at shipping armor (PR #162) hand-attached pieces to
individual bones and overrode original materials with a flat Mat_Leather. Both
were wrong. This pipeline does it properly:

  1. Load the game's reference body (base_body_male.glb) — provides the rig
     and the source of skin weights.
  2. Load the raw armor GLB — preserves whatever materials the artist authored.
  3. Apply all geometry-affecting modifiers (Mirror, Subsurf, Solidify,
     Auto Smooth) so the exported mesh matches the viewport.
  4. Transfer skin weights from the body to each armor mesh via
     bpy.ops.object.data_transfer (POLYINTERP_NEAREST). The closest body
     surface decides which bones drive each armor vertex.
  5. Bind each armor mesh to the body's armature with an Armature modifier.
  6. Export only the armor + armature as a GLB — leave the body out.

The runtime then loads this GLB, reparents the meshes to the character root,
and re-points each mesh's skeleton at the live body skeleton via
`m.skeleton = this._skeleton` (see `setGear` in CharacterAvatar.js). Because
the bone names match across all base bodies (Hips, Spine1, LeftHand, ...),
one auto-skinned armor GLB works for every body variant.

Usage (headless):
    blender --background --python scripts/blender/04_import_armor.py -- \\
        --input  /path/to/raw_armor.glb \\
        --output public/assets/characters/gear/helmet_fantasy1.glb \\
        --slot   helmet

Usage (interactive / Blender MCP):
    from importlib import reload
    import sys; sys.path.append('scripts/blender')
    import importlib.util
    spec = importlib.util.spec_from_file_location('m', 'scripts/blender/04_import_armor.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.process_armor('/path/to/raw_armor.glb',
                    'public/assets/characters/gear/helmet_fantasy1.glb',
                    'helmet')
"""
from __future__ import annotations

import argparse
import os
import sys
import bpy

REPO   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(REPO, 'public', 'assets', 'characters')
GEAR   = os.path.join(ASSETS, 'gear')
BASE_BODY_MALE = os.path.join(ASSETS, 'base_body_male.glb')

VALID_SLOTS = {'helmet', 'chest', 'gauntlets', 'legs', 'weapon'}

# Modifier types that bake into geometry on apply. Auto Smooth (NODES) is also
# applied so smoothing groups travel with the export.
GEOMETRY_MODIFIERS = {'MIRROR', 'SUBSURF', 'SOLIDIFY', 'NODES', 'BEVEL', 'ARRAY', 'BOOLEAN'}


# ── Scene helpers ────────────────────────────────────────────────────────────

def _clear_scene():
    """Wipe the scene and orphaned data so re-runs start from a clean slate."""
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
                bpy.data.actions, bpy.data.images, bpy.data.textures):
        for item in list(col):
            col.remove(item)


def _import_glb(path: str):
    """Import a GLB and return the set of object names that were added."""
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    return {o.name for o in bpy.data.objects} - before


# ── Modifier baking ──────────────────────────────────────────────────────────

def _apply_geometry_modifiers(obj) -> list[str]:
    """Apply all geometry-affecting modifiers in stack order. Returns names."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    applied = []
    # Iterate by index because applying one modifier shifts the rest down.
    while True:
        target = next((m for m in obj.modifiers if m.type in GEOMETRY_MODIFIERS), None)
        if not target:
            break
        try:
            bpy.ops.object.modifier_apply(modifier=target.name)
            applied.append(target.name)
        except RuntimeError as e:
            # Some modifier stacks have ordering constraints (e.g. Solidify on
            # a mesh with no faces). Drop and continue rather than crash.
            print(f"[warn] could not apply {target.name} on {obj.name}: {e}")
            obj.modifiers.remove(target)
    return applied


# ── Skin weight transfer ─────────────────────────────────────────────────────

def _transfer_skin_weights(body, armor):
    """Copy vertex group weights from body to armor, mapping each armor vertex
    to its closest body surface point. POLYINTERP_NEAREST is more accurate
    than NEAREST for armor that doesn't overlap body verts 1:1."""
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    armor.select_set(True)
    bpy.context.view_layer.objects.active = body  # source must be active
    bpy.ops.object.data_transfer(
        use_reverse_transfer=False,
        data_type='VGROUP_WEIGHTS',
        use_create=True,
        vert_mapping='POLYINTERP_NEAREST',
        layers_select_src='ALL',
        layers_select_dst='NAME',
    )


# ── Armature binding ─────────────────────────────────────────────────────────

def _bind_to_armature(armor, armature):
    """Add an Armature modifier on `armor` pointing to `armature`. Replaces any
    existing Armature modifier so re-runs are idempotent."""
    for m in list(armor.modifiers):
        if m.type == 'ARMATURE':
            armor.modifiers.remove(m)
    mod = armor.modifiers.new(name='Armature', type='ARMATURE')
    mod.object = armature
    mod.use_vertex_groups = True
    armor.parent = armature


# ── Main pipeline ────────────────────────────────────────────────────────────

def process_armor(input_glb: str, output_glb: str, slot: str) -> dict:
    """Auto-skin a raw armor GLB to the MPFB rig and export to output_glb.

    Returns a dict summary with mesh count, vertex count, and any warnings.
    Raises on missing input files or invalid slot names so callers fail loud.
    """
    if slot not in VALID_SLOTS:
        raise ValueError(f"slot must be one of {VALID_SLOTS}, got {slot!r}")
    if not os.path.exists(input_glb):
        raise FileNotFoundError(f"input GLB not found: {input_glb}")
    if not os.path.exists(BASE_BODY_MALE):
        raise FileNotFoundError(f"reference body not found: {BASE_BODY_MALE}")

    os.makedirs(os.path.dirname(output_glb), exist_ok=True)

    _clear_scene()

    # 1. Reference body (provides armature + source weights)
    body_objs = _import_glb(BASE_BODY_MALE)
    body_armature = next((bpy.data.objects[n] for n in body_objs
                          if bpy.data.objects[n].type == 'ARMATURE'), None)
    body_meshes = [bpy.data.objects[n] for n in body_objs
                   if bpy.data.objects[n].type == 'MESH']
    if not body_armature or not body_meshes:
        raise RuntimeError(f"reference body missing armature or mesh: {body_objs}")
    body_mesh = max(body_meshes, key=lambda m: len(m.data.vertices))

    # 2. Armor (preserves whatever materials the artist authored)
    armor_objs_names = _import_glb(input_glb)
    armor_meshes = [bpy.data.objects[n] for n in armor_objs_names
                    if bpy.data.objects[n].type == 'MESH']
    armor_armatures = [bpy.data.objects[n] for n in armor_objs_names
                       if bpy.data.objects[n].type == 'ARMATURE']
    if not armor_meshes:
        raise RuntimeError(f"armor GLB has no meshes: {input_glb}")

    # If the armor brought its own armature, drop it — we use the body's.
    for a in armor_armatures:
        bpy.data.objects.remove(a, do_unlink=True)

    summary = {
        'slot': slot,
        'output': output_glb,
        'meshes': [],
        'total_vertices': 0,
        'warnings': [],
    }

    for armor in armor_meshes:
        # 3. Bake modifiers
        applied = _apply_geometry_modifiers(armor)
        # 4. Transfer skin weights from body
        _transfer_skin_weights(body_mesh, armor)
        # 5. Bind to body armature
        _bind_to_armature(armor, body_armature)

        summary['meshes'].append({
            'name':          armor.name,
            'vertices':      len(armor.data.vertices),
            'mods_applied':  applied,
            'vertex_groups': len(armor.vertex_groups),
        })
        summary['total_vertices'] += len(armor.data.vertices)

    # 6. Export selection: armor meshes + body armature only (no body mesh).
    bpy.ops.object.select_all(action='DESELECT')
    body_armature.select_set(True)
    for m in armor_meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = body_armature

    bpy.ops.export_scene.gltf(
        filepath=output_glb,
        export_format='GLB',
        use_selection=True,
        export_apply=False,           # modifiers already applied above
        export_animations=False,      # armor doesn't carry its own clips
        export_skins=True,
        export_morph=False,
        export_yup=True,
    )

    print(f"[OK] {output_glb}  ({summary['total_vertices']} verts across "
          f"{len(summary['meshes'])} meshes)")
    return summary


# ── CLI ──────────────────────────────────────────────────────────────────────

def _parse_argv():
    """Parse args after `--` (Blender swallows args before it for itself)."""
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    p.add_argument('--input',  required=True, help='Path to raw armor GLB')
    p.add_argument('--output', required=True,
                   help='Output GLB path (under public/assets/characters/gear/)')
    p.add_argument('--slot', required=True, choices=sorted(VALID_SLOTS),
                   help='Gear slot the armor targets')
    return p.parse_args(argv)


if __name__ == '__main__':
    args = _parse_argv()
    process_armor(args.input, args.output, args.slot)
