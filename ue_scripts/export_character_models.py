"""
Aurisar Character Model Exporter
=================================
Exports every body, outfit piece and hair mesh from UE as GLB files into
public/avatars/models/ so the React app can load them via React Three Fiber.

HOW TO RUN (UE Output Log → Python console):
  >>> import sys
  >>> sys.path.insert(0, r"C:/Users/brand/Aurisar Build/aurisar-app/ue_scripts")
  >>> import export_character_models; export_character_models.run_export()

REQUIREMENTS:
  - GLTFExporter plugin enabled  (Edit → Plugins → "GLTF Exporter" → restart)

FILES WRITTEN  →  public/avatars/models/
  body_{ma|fe}.glb               base body
  head_{ma|fe}.glb               head
  upper/lower/feet_{outfit}.glb  clothing pieces  (7 outfit presets)
  hair_{style}.glb               hair meshes      (12 male + 5 female)
  accs_earring.glb               female earring
"""

import unreal
import os
import json

OUT  = r"C:/Users/brand/Aurisar Build/aurisar-app/public/avatars/models"
BASE = '/Game/CharacterEditor/Base/Meshes/Basebody_UE4/'
PARTS= '/Game/CharacterEditor/CharacterParts/Meshes/'

ALL_MESHES = {
    # Base
    'body_ma': BASE+'SK_ma_body_master',
    'body_fe': BASE+'SK_fe_body_master',
    'head_ma': BASE+'SK_ma_head_master',
    'head_fe': BASE+'SK_fe_head_master',
    # Male outfit pieces
    'upper_ma_casual':   PARTS+'UpperBody/SK_ma_chest_shirt_casual_a',
    'lower_ma_casual':   PARTS+'LowerBody/SK_ma_leg_jeans',
    'feet_ma_casual':    PARTS+'Feet/SK_ma_feet_shoe_sneaker',
    'upper_ma_sport':    PARTS+'UpperBody/SK_ma_chest_tanktop',
    'lower_ma_sport':    PARTS+'LowerBody/SK_ma_pants_short_casual',
    'feet_ma_sport':     PARTS+'Feet/SK_ma_feet_shoe_sneaker',
    'upper_ma_hoodie':   PARTS+'UpperBody/SK_ma_hoody_over_head',
    'lower_ma_hoodie':   PARTS+'LowerBody/SK_ma_leg_jeans',
    'feet_ma_hoodie':    PARTS+'Feet/SK_ma_feet_boot_casual',
    'upper_ma_business': PARTS+'UpperBody/SK_ma_chest_business_a',
    'lower_ma_business': PARTS+'LowerBody/SK_ma_leg_pants_business',
    'feet_ma_business':  PARTS+'Feet/SK_ma_feet_business',
    # Female outfit pieces
    'upper_fe_casual':   PARTS+'UpperBody/SK_fe_chest_shirt_short',
    'lower_fe_casual':   PARTS+'LowerBody/SK_fe_pants_jeans_short',
    'feet_fe_casual':    PARTS+'Feet/SK_fe_boot_01_a',
    'upper_fe_sporty':   PARTS+'UpperBody/SK_fe_chest_tanktop',
    'lower_fe_sporty':   PARTS+'LowerBody/SK_fe_pants_jeans_short',
    'feet_fe_sporty':    PARTS+'Feet/SK_fe_feet_sneaker',
    'upper_fe_business': PARTS+'UpperBody/SK_fe_chest_shirt_longsleve',
    'lower_fe_business': PARTS+'LowerBody/SK_fe_pants_business',
    'feet_fe_business':  PARTS+'Feet/SK_fe_feet_highheels_02',
    # Accessories
    'accs_earring': PARTS+'Accessories/SK_fe_earring_01',
    # Hair — male (all confirmed to exist in this project)
    'hair_ma_short':       PARTS+'Hairstyles/SK_ma_hair_spiky_short',
    'hair_ma_modern_side': PARTS+'Hairstyles/SK_ma_hair_modern_side',
    'hair_ma_surfer':      PARTS+'Hairstyles/SK_ma_hair_surfer',
    'hair_ma_long':        PARTS+'Hairstyles/SK_ma_hair_long',
    'hair_ma_textured':    PARTS+'Hairstyles/SK_ma_hair_used_look',
    'hair_ma_old':         PARTS+'Hairstyles/SK_ma_hair_old',
    'hair_ma_tough':       PARTS+'Hairstyles/SK_ma_hair_tough',
    'hair_ma_twotails':    PARTS+'Hairstyles/sk_ma_avg_hair_dynamic_2tails',
    'hair_ma_beard_1':     PARTS+'Hairstyles/SK_ma_beard_01',
    'hair_ma_beard_2':     PARTS+'Hairstyles/SK_ma_beard_02',
    'hair_ma_beard_3':     PARTS+'Hairstyles/SK_ma_beard_03',
    'hair_ma_avgbeard':    PARTS+'Hairstyles/SK_ma_avg_beard_dynamic',
    # Hair — female (all confirmed to exist in this project)
    'hair_fe_a_line_bob':  PARTS+'Hairstyles/SK_fe_hair_a_line_bob',
    'hair_fe_long':        PARTS+'Hairstyles/SK_fe_hair_beach',
    'hair_fe_medium':      PARTS+'Hairstyles/SK_fe_hair_bob',
    'hair_fe_short':       PARTS+'Hairstyles/SK_fe_hair_punky',
    'hair_fe_bob':         PARTS+'Hairstyles/SK_fe_hair_the_bob',
}


def run_export():
    os.makedirs(OUT, exist_ok=True)

    if not hasattr(unreal, 'GLTFExporter'):
        unreal.log_error('[Export] GLTFExporter plugin not enabled. '
                         'Enable it in Edit → Plugins → GLTF Exporter, then restart.')
        return

    options = unreal.GLTFExportOptions()
    options.export_animation_sequences = False
    options.export_cameras             = False
    options.export_lights              = False
    options.export_level_sequences     = False
    options.export_vertex_skin_weights = True
    options.bake_material_inputs       = unreal.GLTFMaterialBakeMode.DISABLED

    exporter = unreal.GLTFExporter.get_default_object()
    ok, skipped, failed = [], [], []

    total = len(ALL_MESHES)
    with unreal.ScopedSlowTask(total, 'Exporting Aurisar character models…') as task:
        task.make_dialog(True)
        for name, asset_path in ALL_MESHES.items():
            if task.should_cancel():
                break
            task.enter_progress_frame(1, name)

            mesh = unreal.load_asset(asset_path)
            if not mesh:
                skipped.append(name)
                unreal.log_warning(f'[Export] Asset not found: {asset_path}')
                continue

            out_path = os.path.join(OUT, name + '.glb').replace('\\', '/')
            try:
                exporter.export_to_gltf(mesh, out_path, options, [])
                if os.path.exists(out_path):
                    ok.append(name)
                    unreal.log(f'[Export] ✓  {name}.glb')
                else:
                    failed.append(name)
                    unreal.log_warning(f'[Export] ✗  {name}.glb — file not written')
            except Exception as e:
                failed.append(name)
                unreal.log_error(f'[Export] ✗  {name}: {e}')

    unreal.log(f'[Export] Done: {len(ok)} ok  |  {len(skipped)} skipped  |  {len(failed)} failed')
    unreal.log(f'[Export] Output: {OUT}')
    if failed:
        unreal.log_warning(f'[Export] Failed: {failed}')
