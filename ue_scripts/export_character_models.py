"""
Aurisar Character Model Exporter
=================================
Exports every body+outfit and hair combination from the placed character
blueprint as GLB files into public/avatars/models/ so the React app can
load them via React Three Fiber without Unreal Engine running.

HOW TO RUN:
  In UE Editor: Window → Developer Tools → Output Log → Python console
  >>> import importlib, sys
  >>> sys.path.insert(0, r"C:/Users/brand/Aurisar Build/aurisar-app/ue_scripts")
  >>> import export_character_models; importlib.reload(export_character_models)

  Or add this file to your UE Project Settings → Python → Startup Scripts
  and call export_character_models.run_export() from the console.

REQUIREMENTS:
  - GLTFExporter plugin must be enabled in your UE project
    (Edit → Plugins → search "GLTF" → enable → restart)
  - The character blueprint must be placed in the current level
    (same one used by auto_portrait_render.py)

OUTPUT FILES  (public/avatars/models/):
  body_ma_casual.glb       body + outfit, hair hidden  (7 files)
  body_fe_casual.glb
  ...
  hair_ma_short.glb        isolated hair mesh           (~21 files)
  hair_fe_a_line_bob.glb
  ...
"""

import unreal
import os
import time

# ─── Output directory ─────────────────────────────────────────────────────────
OUT_DIR = r"C:/Users/brand/Aurisar Build/aurisar-app/public/avatars/models"
os.makedirs(OUT_DIR, exist_ok=True)

# ─── Asset paths (must match auto_portrait_render.py) ─────────────────────────
BASE  = '/Game/CharacterEditor/Base/Meshes/Basebody_UE4/'
PARTS = '/Game/CharacterEditor/CharacterParts/Meshes/'

OUTFIT_MAP = {
    'ma_casual':   (PARTS+'UpperBody/SK_ma_chest_shirt_casual_a',    PARTS+'LowerBody/SK_ma_leg_jeans',          PARTS+'Feet/SK_ma_feet_shoe_sneaker'),
    'ma_sport':    (PARTS+'UpperBody/SK_ma_chest_tanktop',           PARTS+'LowerBody/SK_ma_pants_short_casual', PARTS+'Feet/SK_ma_feet_shoe_sneaker'),
    'ma_hoodie':   (PARTS+'UpperBody/SK_ma_hoody_over_head',         PARTS+'LowerBody/SK_ma_leg_jeans',          PARTS+'Feet/SK_ma_feet_boot_casual'),
    'ma_business': (PARTS+'UpperBody/SK_ma_chest_business_a',        PARTS+'LowerBody/SK_ma_leg_pants_business', PARTS+'Feet/SK_ma_feet_business'),
    'fe_casual':   (PARTS+'UpperBody/SK_fe_chest_shirt_short',       PARTS+'LowerBody/SK_fe_pants_jeans_short',  PARTS+'Feet/SK_fe_boot_01_a'),
    'fe_sporty':   (PARTS+'UpperBody/SK_fe_chest_tanktop',           PARTS+'LowerBody/SK_fe_pants_jeans_short',  PARTS+'Feet/SK_fe_feet_sneaker'),
    'fe_business': (PARTS+'UpperBody/SK_fe_chest_shirt_longsleve',   PARTS+'LowerBody/SK_fe_pants_business',     PARTS+'Feet/SK_fe_feet_highheels_02'),
}

HAIR_MAP = {
    'ma_short':       PARTS + 'Hairstyles/SK_ma_hair_spiky_short',
    'ma_modern_side': PARTS + 'Hairstyles/SK_ma_hair_modern_side',
    'ma_surfer':      PARTS + 'Hairstyles/SK_ma_hair_surfer',
    'ma_long':        PARTS + 'Hairstyles/SK_ma_hair_long',
    'ma_textured':    PARTS + 'Hairstyles/SK_ma_hair_used_look',
    'ma_mohawk':      PARTS + 'Hairstyles/SK_ma_hair_mohawk',
    'ma_braids':      PARTS + 'Hairstyles/SK_ma_hair_braids',
    'ma_ponytail':    PARTS + 'Hairstyles/SK_ma_hair_ponytail',
    'ma_shaved':      PARTS + 'Hairstyles/SK_ma_hair_shaved',
    'ma_warrior':     PARTS + 'Hairstyles/SK_ma_hair_warrior_knot',
    'ma_beard_1':     PARTS + 'Hairstyles/SK_ma_beard_01',
    'ma_beard_2':     PARTS + 'Hairstyles/SK_ma_beard_02',
    'fe_a_line_bob':  PARTS + 'Hairstyles/SK_fe_hair_a_line_bob',
    'fe_long':        PARTS + 'Hairstyles/SK_fe_hair_beach',
    'fe_medium':      PARTS + 'Hairstyles/SK_fe_hair_bob',
    'fe_short':       PARTS + 'Hairstyles/SK_fe_hair_punky',
    'fe_bob':         PARTS + 'Hairstyles/SK_fe_hair_the_bob',
    'fe_braids':      PARTS + 'Hairstyles/SK_fe_hair_braids',
    'fe_ponytail':    PARTS + 'Hairstyles/SK_fe_hair_ponytail',
    'fe_bun':         PARTS + 'Hairstyles/SK_fe_hair_bun',
    'fe_mohawk':      PARTS + 'Hairstyles/SK_fe_hair_mohawk',
}

COMP_BODY  = 'CharacterMesh0'
COMP_HEAD  = 'NODE_AddSkeletalMeshComponent-3'
COMP_UPPER = 'NODE_AddSkeletalMeshComponent-3_0'
COMP_LOWER = 'NODE_AddSkeletalMeshComponent-3_1'
COMP_ACCS  = 'NODE_AddSkeletalMeshComponent-3_2'
COMP_FEET  = 'NODE_AddSkeletalMeshComponent-3_3'
COMP_HAIR  = 'NODE_AddSkeletalMeshComponent-3_4'

EARRING_FE = PARTS + 'Accessories/SK_fe_earring_01'

# ─── Helpers ──────────────────────────────────────────────────────────────────
def _get_gltf_exporter():
    """Return the GLTFExporter class, or None if plugin is not enabled."""
    if hasattr(unreal, 'GLTFExporter'):
        return unreal.GLTFExporter
    unreal.log_error('[Export] GLTFExporter plugin is NOT enabled. '
                     'Enable it in Edit → Plugins → GLTF Exporter, then restart.')
    return None


def _get_character_and_comps():
    """Return (character_actor, comp_map) from the current level."""
    eas    = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = eas.get_all_level_actors()
    char   = next((a for a in actors if a.get_name() == 'BP_Character_ALREADY_PLACED_IN_LEVEL'), None)
    if not char:
        unreal.log_error('[Export] Character actor not found in level.')
        return None, {}
    sk_comps = char.get_components_by_class(unreal.SkeletalMeshComponent.static_class())
    comp_map = {c.get_name(): c for c in sk_comps}
    return char, comp_map


def _swap(comp_map, comp_name, asset_path):
    comp = comp_map.get(comp_name)
    if not comp:
        return
    if asset_path:
        mesh = unreal.load_asset(asset_path)
        if mesh:
            comp.set_skeletal_mesh_asset(mesh)
            comp.set_visibility(True)
        else:
            comp.set_skeletal_mesh_asset(None)
            comp.set_visibility(False)
    else:
        comp.set_skeletal_mesh_asset(None)
        comp.set_visibility(False)


def _export_actor_as_glb(exporter_cls, actor, output_name, options=None):
    """Export a single actor (all its components) to a GLB file."""
    world      = unreal.EditorLevelLibrary.get_editor_world()
    out_path   = os.path.join(OUT_DIR, output_name + '.glb').replace('\\', '/')

    if options is None:
        options = unreal.GLTFExportOptions()
        options.set_editor_property('export_level_sequences', False)
        options.set_editor_property('export_animations', False)
        options.set_editor_property('export_cameras', False)
        options.set_editor_property('export_lights', False)
        options.set_editor_property('bake_material_inputs', unreal.GLTFMaterialBakeMode.DISABLED)

    try:
        result = exporter_cls.export_to_gltf(world, out_path, options, [actor])
        if result:
            unreal.log(f'[Export] ✓  {output_name}.glb')
        else:
            unreal.log_warning(f'[Export] ✗  {output_name}.glb — export returned False')
        return result
    except Exception as e:
        unreal.log_error(f'[Export] ✗  {output_name}.glb — {e}')
        return False


# ─── Main export routine ──────────────────────────────────────────────────────
def run_export():
    exporter_cls = _get_gltf_exporter()
    if not exporter_cls:
        return

    char, comp_map = _get_character_and_comps()
    if not char:
        return

    options = unreal.GLTFExportOptions()
    options.set_editor_property('export_level_sequences', False)
    options.set_editor_property('export_animations', False)
    options.set_editor_property('export_cameras', False)
    options.set_editor_property('export_lights', False)
    options.set_editor_property('bake_material_inputs', unreal.GLTFMaterialBakeMode.DISABLED)

    total  = len(OUTFIT_MAP) + len(HAIR_MAP)
    done   = 0
    failed = []

    with unreal.ScopedSlowTask(total, 'Exporting Aurisar character models…') as task:
        task.make_dialog(True)

        # ── 1. Body + outfit exports (hair hidden) ────────────────────────────
        for outfit_key, (upper, lower, feet) in OUTFIT_MAP.items():
            if task.should_cancel():
                break
            task.enter_progress_frame(1, f'Body: {outfit_key}')

            gender = 'male' if outfit_key.startswith('ma') else 'female'
            base   = BASE + ('SK_ma_' if gender == 'male' else 'SK_fe_')

            _swap(comp_map, COMP_BODY,  base + 'body_master')
            _swap(comp_map, COMP_HEAD,  base + 'head_master')
            _swap(comp_map, COMP_UPPER, upper)
            _swap(comp_map, COMP_LOWER, lower)
            _swap(comp_map, COMP_FEET,  feet)
            _swap(comp_map, COMP_ACCS,  EARRING_FE if gender == 'female' else None)
            _swap(comp_map, COMP_HAIR,  None)   # hair OFF for body export

            ok = _export_actor_as_glb(exporter_cls, char, f'body_{outfit_key}', options)
            if not ok:
                failed.append(f'body_{outfit_key}')
            done += 1

        # ── 2. Hair exports (default male casual body underneath) ─────────────
        # Set a neutral base so the skeleton reference is correct
        _swap(comp_map, COMP_BODY,  BASE + 'SK_ma_body_master')
        _swap(comp_map, COMP_HEAD,  BASE + 'SK_ma_head_master')
        _swap(comp_map, COMP_UPPER, None)
        _swap(comp_map, COMP_LOWER, None)
        _swap(comp_map, COMP_FEET,  None)
        _swap(comp_map, COMP_ACCS,  None)

        for hair_key, hair_path in HAIR_MAP.items():
            if task.should_cancel():
                break
            task.enter_progress_frame(1, f'Hair: {hair_key}')

            _swap(comp_map, COMP_HAIR, hair_path)
            ok = _export_actor_as_glb(exporter_cls, char, f'hair_{hair_key}', options)
            if not ok:
                failed.append(f'hair_{hair_key}')
            done += 1

        # Restore hair off when done
        _swap(comp_map, COMP_HAIR, None)

    unreal.log(f'[Export] Complete. {done - len(failed)}/{total} files exported to:')
    unreal.log(f'[Export]   {OUT_DIR}')
    if failed:
        unreal.log_warning(f'[Export] Failed: {failed}')
    else:
        unreal.log('[Export] All exports succeeded. ✓')


# ─── Auto-run when loaded as a startup script ─────────────────────────────────
# Comment this out if you only want to call run_export() manually.
# run_export()
