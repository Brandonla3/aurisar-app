"""
Aurisar Portrait Render Service
================================
Watches for render_request.json written by the React dev server, swaps
character meshes to match the profile, captures a portrait via
SceneCaptureComponent2D, and writes portrait_preview.png + portrait_status.json
back to the same directory so the app can display the updated portrait.

SETUP:
  1. Copy this file to:
       C:/Projects/IronLegacyFitness/Content/Python/auto_portrait_render.py
  2. In UE Editor:  Edit → Project Settings → Plugins → Python
     → Startup Scripts → add:  auto_portrait_render.py
  3. Restart the UE Editor. The service starts automatically.

The WATCH_PATH below must match the directory your Vite dev server writes to.
Default: the main app's public/avatars directory.
"""

import unreal
import os
import json
import time

# ─── Paths ────────────────────────────────────────────────────────────────────
# Change this if your app lives elsewhere.
WATCH_PATH = r"C:/Users/brand/Aurisar Build/aurisar-app/public/avatars/render_request.json"

# ─── Mesh asset paths ─────────────────────────────────────────────────────────
BASE   = '/Game/CharacterEditor/Base/Meshes/Basebody_UE4/'
PARTS  = '/Game/CharacterEditor/CharacterParts/Meshes/'

HAIR_MAP = {
    # ── Female ────────────────────────────────────────────────────────────────
    'fe_a_line_bob': PARTS + 'Hairstyles/SK_fe_hair_a_line_bob',
    'fe_long':       PARTS + 'Hairstyles/SK_fe_hair_beach',
    'fe_medium':     PARTS + 'Hairstyles/SK_fe_hair_bob',
    'fe_short':      PARTS + 'Hairstyles/SK_fe_hair_punky',
    'fe_bob':        PARTS + 'Hairstyles/SK_fe_hair_the_bob',
    # Female RPG / additional
    'fe_braids':     PARTS + 'Hairstyles/SK_fe_hair_braids',
    'fe_ponytail':   PARTS + 'Hairstyles/SK_fe_hair_ponytail',
    'fe_bun':        PARTS + 'Hairstyles/SK_fe_hair_bun',
    'fe_mohawk':     PARTS + 'Hairstyles/SK_fe_hair_mohawk',
    # ── Male ──────────────────────────────────────────────────────────────────
    'ma_short':       PARTS + 'Hairstyles/SK_ma_hair_spiky_short',
    'ma_modern_side': PARTS + 'Hairstyles/SK_ma_hair_modern_side',
    'ma_surfer':      PARTS + 'Hairstyles/SK_ma_hair_surfer',
    'ma_long':        PARTS + 'Hairstyles/SK_ma_hair_long',
    'ma_textured':    PARTS + 'Hairstyles/SK_ma_hair_used_look',
    # Male RPG / additional
    'ma_mohawk':      PARTS + 'Hairstyles/SK_ma_hair_mohawk',
    'ma_braids':      PARTS + 'Hairstyles/SK_ma_hair_braids',
    'ma_ponytail':    PARTS + 'Hairstyles/SK_ma_hair_ponytail',
    'ma_shaved':      PARTS + 'Hairstyles/SK_ma_hair_shaved',
    'ma_warrior':     PARTS + 'Hairstyles/SK_ma_hair_warrior_knot',
    'ma_beard_1':     PARTS + 'Hairstyles/SK_ma_beard_01',
    'ma_beard_2':     PARTS + 'Hairstyles/SK_ma_beard_02',
}

# (upper_body, lower_body, feet)
OUTFIT_MAP = {
    'ma_casual':   (PARTS+'UpperBody/SK_ma_chest_shirt_casual_a', PARTS+'LowerBody/SK_ma_leg_jeans',          PARTS+'Feet/SK_ma_feet_shoe_sneaker'),
    'ma_sport':    (PARTS+'UpperBody/SK_ma_chest_tanktop',         PARTS+'LowerBody/SK_ma_pants_short_casual', PARTS+'Feet/SK_ma_feet_shoe_sneaker'),
    'ma_hoodie':   (PARTS+'UpperBody/SK_ma_hoody_over_head',       PARTS+'LowerBody/SK_ma_leg_jeans',          PARTS+'Feet/SK_ma_feet_boot_casual'),
    'ma_business': (PARTS+'UpperBody/SK_ma_chest_business_a',      PARTS+'LowerBody/SK_ma_leg_pants_business', PARTS+'Feet/SK_ma_feet_business'),
    'fe_casual':   (PARTS+'UpperBody/SK_fe_chest_shirt_short',     PARTS+'LowerBody/SK_fe_pants_jeans_short',  PARTS+'Feet/SK_fe_boot_01_a'),
    'fe_sporty':   (PARTS+'UpperBody/SK_fe_chest_tanktop',          PARTS+'LowerBody/SK_fe_pants_jeans_short',  PARTS+'Feet/SK_fe_feet_sneaker'),
    'fe_business': (PARTS+'UpperBody/SK_fe_chest_shirt_longsleve',  PARTS+'LowerBody/SK_fe_pants_business',     PARTS+'Feet/SK_fe_feet_highheels_02'),
}

EARRING_FE = PARTS + 'Accessories/SK_fe_earring_01'

# Component names on BP_Character_ALREADY_PLACED_IN_LEVEL
COMP_BODY   = 'CharacterMesh0'
COMP_HEAD   = 'NODE_AddSkeletalMeshComponent-3'
COMP_UPPER  = 'NODE_AddSkeletalMeshComponent-3_0'
COMP_LOWER  = 'NODE_AddSkeletalMeshComponent-3_1'
COMP_ACCS   = 'NODE_AddSkeletalMeshComponent-3_2'
COMP_FEET   = 'NODE_AddSkeletalMeshComponent-3_3'
COMP_HAIR   = 'NODE_AddSkeletalMeshComponent-3_4'

# ─── Runtime state ────────────────────────────────────────────────────────────
_rt        = None
_scc       = None
_cap_actor = None
_comp_map  = {}
_last_mtime = 0.0
_tick_acc   = 0.0
POLL_SECS   = 2.0

# ─── Initialization ───────────────────────────────────────────────────────────
def _init():
    global _rt, _scc, _cap_actor, _comp_map

    world = unreal.EditorLevelLibrary.get_editor_world()
    eas   = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = eas.get_all_level_actors()

    char = next((a for a in actors if a.get_name() == 'BP_Character_ALREADY_PLACED_IN_LEVEL'), None)
    _cap_actor = next((a for a in actors if 'SceneCapture' in a.get_class().get_name()), None)

    if not char or not _cap_actor:
        unreal.log_warning('[PortraitRender] Character or capture actor not found in current level.')
        return False

    sk_comps  = char.get_components_by_class(unreal.SkeletalMeshComponent.static_class())
    _comp_map = {c.get_name(): c for c in sk_comps}

    _scc = _cap_actor.get_component_by_class(unreal.SceneCaptureComponent2D.static_class())
    _rt  = unreal.RenderingLibrary.create_render_target2d(
        world, 512, 768,
        unreal.TextureRenderTargetFormat.RTF_RGBA8,
        unreal.LinearColor(0.04, 0.04, 0.06, 1), False
    )

    _scc.texture_target = _rt
    _scc.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    _scc.fov_angle      = 30.0
    _scc.inherit_main_view_camera_post_process_settings = False
    _scc.post_process_blend_weight = 1.0

    pps = _scc.get_editor_property('PostProcessSettings')
    pps.override_auto_exposure_min_brightness = True
    pps.auto_exposure_min_brightness          = 0.8
    pps.override_auto_exposure_max_brightness = True
    pps.auto_exposure_max_brightness          = 0.8
    pps.override_auto_exposure_bias           = True
    pps.auto_exposure_bias                    = 1.5
    _scc.set_editor_property('PostProcessSettings', pps)

    _cap_actor.set_actor_location(unreal.Vector(-100, 0, 158), False, False)
    _cap_actor.set_actor_rotation(unreal.Rotator(0, 0, 0), False)

    unreal.log('[PortraitRender] Initialized.')
    return True

# ─── Helpers ──────────────────────────────────────────────────────────────────
def _swap(comp_name, asset_path):
    comp = _comp_map.get(comp_name)
    if not comp:
        return
    if asset_path:
        mesh = unreal.load_asset(asset_path)
        if mesh:
            comp.set_skeletal_mesh_asset(mesh)
            comp.set_visibility(True)
        # if mesh path is wrong/missing, keep component hidden rather than showing grey
        else:
            comp.set_skeletal_mesh_asset(None)
            comp.set_visibility(False)
    else:
        comp.set_skeletal_mesh_asset(None)
        comp.set_visibility(False)

def _render(profile):
    world   = unreal.EditorLevelLibrary.get_editor_world()
    gender  = profile.get('gender', 'male')
    outfit  = profile.get('outfit', 'ma_casual')
    hair    = profile.get('hairStyle', 'ma_short' if gender == 'male' else 'fe_bob')
    out_dir = profile.get('outputDir', os.path.dirname(WATCH_PATH) + '/')

    base = BASE + ('SK_ma_' if gender == 'male' else 'SK_fe_')
    _swap(COMP_BODY, base + 'body_master')
    _swap(COMP_HEAD, base + 'head_master')

    out_meshes = OUTFIT_MAP.get(outfit)
    if not out_meshes:
        out_meshes = OUTFIT_MAP.get('ma_casual' if gender == 'male' else 'fe_casual')
    _swap(COMP_UPPER, out_meshes[0])
    _swap(COMP_LOWER, out_meshes[1])
    _swap(COMP_FEET,  out_meshes[2])

    _swap(COMP_ACCS, EARRING_FE if gender == 'female' else None)
    _swap(COMP_HAIR, HAIR_MAP.get(hair))

    _scc.capture_scene()
    unreal.RenderingLibrary.export_render_target(world, _rt, out_dir, 'portrait_preview')

    raw   = out_dir + 'portrait_preview'
    final = out_dir + 'portrait_preview.png'
    if os.path.exists(raw):
        if os.path.exists(final):
            os.remove(final)
        os.rename(raw, final)

    status = {
        'requestId': profile.get('requestId', ''),
        'version':   int(time.time() * 1000),
        'gender':    gender,
        'outfit':    outfit,
    }
    with open(out_dir + 'portrait_status.json', 'w') as f:
        json.dump(status, f)

    unreal.log(f'[PortraitRender] Done → {final}')

# ─── Tick callback ────────────────────────────────────────────────────────────
def _tick(delta):
    global _last_mtime, _tick_acc, _scc, _cap_actor, _comp_map, _rt

    _tick_acc += delta
    if _tick_acc < POLL_SECS:
        return
    _tick_acc = 0.0

    if not os.path.exists(WATCH_PATH):
        return

    mtime = os.path.getmtime(WATCH_PATH)
    if mtime <= _last_mtime:
        return
    _last_mtime = mtime

    try:
        with open(WATCH_PATH, 'r') as f:
            profile = json.load(f)
    except Exception as e:
        unreal.log_warning(f'[PortraitRender] Could not read request: {e}')
        return

    # Re-initialize if we lost the actors (e.g. level reload)
    if not _scc or not _cap_actor:
        if not _init():
            return

    unreal.log(f'[PortraitRender] Rendering {profile.get("gender")}/{profile.get("outfit")}...')
    try:
        _render(profile)
        os.remove(WATCH_PATH)
    except Exception as e:
        unreal.log_error(f'[PortraitRender] Render failed: {e}')

# ─── Start ────────────────────────────────────────────────────────────────────
if _init():
    unreal.register_slate_post_tick_callback(_tick)
    unreal.log(f'[PortraitRender] Service started. Watching: {WATCH_PATH}')
else:
    # Try again on next tick in case the level isn't fully loaded yet
    def _retry(delta):
        global _tick_acc
        _tick_acc += delta
        if _tick_acc < 5.0:
            return
        if _init():
            unreal.register_slate_post_tick_callback(_tick)
            unreal.log(f'[PortraitRender] Service started (delayed). Watching: {WATCH_PATH}')
    unreal.register_slate_post_tick_callback(_retry)
