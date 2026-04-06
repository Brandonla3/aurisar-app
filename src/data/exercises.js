const CLASSES = {
  warrior:   { name:"Warrior",   icon:"⚔️",  description:"Forged in battle. Strength is your only law.",       color:"#c0392b", glow:"#e74c3c", locked:false, bonuses:{strength:1.12,cardio:0.94,flexibility:1.00,endurance:1.00}, traits:["Iron Resolve","Battle Hardened","Unstoppable Force"] },
  gladiator: { name:"Gladiator", icon:"🏛️",  description:"Arena champion. Full-body power and commanding presence.", color:"#b8540a", glow:"#e67e22", locked:false, bonuses:{strength:1.08,cardio:1.04,flexibility:1.00,endurance:1.04}, traits:["Arena Tested","Iron Presence","Full-Body Fury"] },
  warden:    { name:"Warden",    icon:"🌲",  description:"Outdoor endurance athlete. Tireless across every terrain.", color:"#1a7a3c", glow:"#27ae60", locked:false, bonuses:{strength:0.94,cardio:1.10,flexibility:1.00,endurance:1.12}, traits:["Trail Blazer","Iron Lungs","Pathfinder"] },
  phantom:   { name:"Phantom",   icon:"🦅",  description:"Mind-muscle sculptor. Precision, aesthetics, and form.", color:"#6c3483", glow:"#9b59b6", locked:false, bonuses:{strength:1.10,cardio:0.94,flexibility:1.04,endurance:0.96}, traits:["Mind-Muscle Link","Precision Form","Shadow Sculptor"] },
  tempest:   { name:"Tempest",   icon:"🌊",  description:"Water and breath athlete. Fluid power unleashed.",    color:"#1a5276", glow:"#2980b9", locked:false, bonuses:{strength:0.90,cardio:1.12,flexibility:1.04,endurance:1.08}, traits:["Fluid Motion","Deep Lungs","Current Rider"] },
  warlord:   { name:"Warlord",   icon:"🏹",  description:"Force multiplier. Leads and elevates every team.",   color:"#7d6608", glow:"#d4ac0d", locked:false, bonuses:{strength:1.04,cardio:1.04,flexibility:1.04,endurance:1.04}, traits:["War Cry","Force Multiplier","Band of Brothers"] },
  druid:     { name:"Druid",     icon:"🧬",  description:"Recovery and longevity specialist. The body as sacred ground.", color:"#0e6655", glow:"#1abc9c", locked:false, bonuses:{strength:0.90,cardio:1.00,flexibility:1.12,endurance:1.04}, traits:["Inner Focus","Body Harmony","Ancient Recovery"] },
  oracle:    { name:"Oracle",    icon:"💠",  description:"Biometric master. Trains smarter, not just harder.", color:"#154360", glow:"#2e86c1", locked:false, bonuses:{strength:0.94,cardio:1.08,flexibility:1.04,endurance:1.08}, traits:["Precision Metrics","Zone Master","Calculated Edge"] },
  titan:     { name:"Titan",     icon:"⛓️",  description:"Pure powerlifter. Immovable force. Maximum load.",   color:"#4a235a", glow:"#7d3c98", locked:true,  bonuses:{strength:1.15,cardio:0.88,flexibility:0.90,endurance:0.96}, traits:["Immovable Object","Max Load","Iron Foundation"] },
  striker:   { name:"Striker",   icon:"🥊",  description:"Combat athlete. Speed, power, and explosive combos.", color:"#922b21", glow:"#e74c3c", locked:true,  bonuses:{strength:1.06,cardio:1.08,flexibility:1.00,endurance:1.04}, traits:["Explosive Power","Combat Ready","No Mercy"] },
  alchemist: { name:"Alchemist", icon:"🔬",  description:"Fitness scientist. Optimization is the art.",       color:"#0b5345", glow:"#148f77", locked:true,  bonuses:{strength:1.00,cardio:1.04,flexibility:1.04,endurance:1.04}, traits:["Macro Master","Protocol Optimizer","Gains Formula"] },
};

// ═══════════════════════════════════════════════════════════════════
//  EXERCISES  (+ descriptions, muscles, tips, images)
// ═══════════════════════════════════════════════════════════════════
const IMG = (id, params="w=420&h=260&fit=crop&q=80") =>
  `https://images.unsplash.com/photo-${id}?${params}`;

const EXERCISES = [
  {
    id:"air_squat", name:"Air Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"arnold_press", name:"Arnold Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"assisted_chin_up", name:"Assisted Chin-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"assisted_dip", name:"Assisted Dip", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"assisted_pull_up", name:"Assisted Pull-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"back_extension", name:"Back Extension", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Extension exercise targeting the back. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"ball_slams", name:"Ball Slams", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"band_pull_apart", name:"Band Pull-Apart", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"banded_face_pull", name:"Banded Face Pull", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"banded_hip_march", name:"Banded Hip March", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"banded_muscle_up", name:"Banded Muscle-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"banded_side_kicks", name:"Banded Side Kicks", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"bar_hang", name:"Bar Hang", category:"strength", secondaryCategory:"endurance", muscleGroup:"forearm", icon:"✊", baseXP:38,
    muscles:"Forearm", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"barbell_curl", name:"Barbell Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"barbell_front_raise", name:"Barbell Front Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"barbell_hack_squat", name:"Barbell Hack Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"barbell_incline_triceps_extension", name:"Barbell Incline Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"barbell_lunge", name:"Barbell Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"barbell_lying_triceps_extension", name:"Barbell Lying Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"barbell_preacher_curl", name:"Barbell Preacher Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"barbell_rear_delt_row", name:"Barbell Rear Delt Row", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"row", name:"Barbell Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"barbell_seated_calf_raise", name:"Barbell Seated Calf Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"barbell_shrug", name:"Barbell Shrug", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"barbell_standing_calf_raise", name:"Barbell Standing Calf Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"barbell_standing_triceps_extension", name:"Barbell Standing Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"barbell_upright_row", name:"Barbell Upright Row", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"barbell_walking_lunge", name:"Barbell Walking Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"barbell_wrist_curl", name:"Barbell Wrist Curl", category:"strength", muscleGroup:"forearm", icon:"✊", baseXP:35,
    muscles:"Forearm", desc:"Targets the forearm through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"barbell_wrist_curl_behind_the_back", name:"Barbell Wrist Curl Behind the Back", category:"strength", muscleGroup:"forearm", icon:"✊", baseXP:35,
    muscles:"Forearm", desc:"Targets the forearm through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"belt_squat", name:"Belt Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"bench_dip", name:"Bench Dip", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Strength exercise targeting the bicep. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"bench", name:"Bench Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"bicycle_crunch", name:"Bicycle Crunch", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"boat_hold", name:"Boat Hold", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"lunges", name:"Body Weight Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"bodyweight_leg_curl", name:"Bodyweight Leg Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"box_jump", name:"Box Jump", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"box_squat", name:"Box Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"bulgarian_split_squat", name:"Bulgarian Split Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"cable_chest_press", name:"Cable Chest Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"cable_close_grip_seated_row", name:"Cable Close Grip Seated Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"cable_crossover_bicep_curl", name:"Cable Crossover Bicep Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"cable_crunch", name:"Cable Crunch", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"cable_curl_with_bar", name:"Cable Curl With Bar", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"cable_curl_with_rope", name:"Cable Curl With Rope", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"cable_front_raise", name:"Cable Front Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"cable_glute_kickback", name:"Cable Glute Kickback", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"cable_lateral_raise", name:"Cable Lateral Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"cable_machine_hip_abduction", name:"Cable Machine Hip Abduction", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"cable_machine_hip_adduction", name:"Cable Machine Hip Adduction", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Isolation movement targeting the legs. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"cable_pull_through", name:"Cable Pull Through", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"cable_rear_delt_row", name:"Cable Rear Delt Row", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"cable_wide_grip_seated_row", name:"Cable Wide Grip Seated Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"calf_raise_in_leg_press", name:"Calf Raise in Leg Press", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"captains_chair_knee_raise", name:"Captains Chair Knee Raise", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Raise movement isolating the abs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"captains_chair_leg_raise", name:"Captains Chair Leg Raise", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Raise movement isolating the abs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"chair_squat", name:"Chair Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"chest_to_bar", name:"Chest to Bar", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"chest_supported_dumbbell_row", name:"Chest-Supported Dumbbell Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"chin_up", name:"Chin-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"clamshells", name:"Clamshells", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"clap_push_up", name:"Clap Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"clean", name:"Clean", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"clean_and_jerk", name:"Clean and Jerk", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"close_grip_chin_up", name:"Close-Grip Chin-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"close_grip_lat_pulldown", name:"Close-Grip Lat Pulldown", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"close_grip_push_up", name:"Close-Grip Push-Up", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"cobra_push_up", name:"Cobra Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"concentration_curl", name:"Concentration Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"copenhagen_plank", name:"Copenhagen Plank", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"core_twist", name:"Core Twist", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"cossack_squat", name:"Cossack Squat", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"crossbody_cable_triceps_extension", name:"Crossbody Cable Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"crunch", name:"Crunch", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"curtsy_lunge", name:"Curtsy Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"cycle_ride", name:"Cycling", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🚴", baseXP:50,
    muscles:"Cardio", desc:"Cycling builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"dead_bug", name:"Dead Bug", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"dead_bug_with_dumbbells", name:"Dead Bug With Dumbbells", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"deadlift", name:"Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"death_march_with_dumbbells", name:"Death March with Dumbbells", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"decline_bench_press", name:"Decline Bench Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"decline_push_up", name:"Decline Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"deficit_deadlift", name:"Deficit Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"depth_jump", name:"Depth Jump", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"donkey_calf_raise", name:"Donkey Calf Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"donkey_kicks", name:"Donkey Kicks", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"dragon_flag", name:"Dragon Flag", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_chest_fly", name:"Dumbbell Chest Fly", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Isolation movement stretching the chest through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"dumbbell_chest_press", name:"Dumbbell Chest Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_curl", name:"Dumbbell Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"dumbbell_deadlift", name:"Dumbbell Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"dumbbell_decline_chest_press", name:"Dumbbell Decline Chest Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_floor_press", name:"Dumbbell Floor Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_front_raise", name:"Dumbbell Front Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"dumbbell_lateral_raise", name:"Dumbbell Lateral Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"dumbbell_lunge", name:"Dumbbell Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"dumbbell_lying_triceps_extension", name:"Dumbbell Lying Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"dumbbell_preacher_curl", name:"Dumbbell Preacher Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"dumbbell_pullover", name:"Dumbbell Pullover", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_rear_delt_row", name:"Dumbbell Rear Delt Row", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"dumbbell_romanian_deadlift", name:"Dumbbell Romanian Deadlift", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"dumbbell_row", name:"Dumbbell Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"dumbbell_shoulder_press", name:"Dumbbell Shoulder Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"dumbbell_shrug", name:"Dumbbell Shrug", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_side_bend", name:"Dumbbell Side Bend", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"dumbbell_squat", name:"Dumbbell Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"dumbbell_standing_triceps_extension", name:"Dumbbell Standing Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"dumbbell_walking_lunge", name:"Dumbbell Walking Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"dumbbell_wrist_curl", name:"Dumbbell Wrist Curl", category:"strength", muscleGroup:"forearm", icon:"✊", baseXP:35,
    muscles:"Forearm", desc:"Targets the forearm through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"dynamic_side_plank", name:"Dynamic Side Plank", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"eccentric_heel_drop", name:"Eccentric Heel Drop", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Calf raise variation building lower leg strength and size. Full range of motion for best results.", tips:[], images:[],
  },
  {
    id:"echo_bike", name:"Echo Bike", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🚴", baseXP:50,
    muscles:"Cardio", desc:"Echo Bike builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"ez_bar_lying_triceps_extension", name:"EZ Bar Lying Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"ez_curl", name:"EZ Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"face_pull", name:"Face Pull", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"farmers_walk", name:"Farmers Walk", category:"strength", secondaryCategory:"endurance", muscleGroup:"forearm", icon:"✊", baseXP:38,
    muscles:"Forearm", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"fire_hydrants", name:"Fire Hydrants", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"floor_back_extension", name:"Floor Back Extension", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Extension exercise targeting the back. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"front_hold", name:"Front Hold", category:"strength", secondaryCategory:"endurance", muscleGroup:"shoulder", icon:"🏋️", baseXP:38,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"front_squat", name:"Front Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"glute_bridge", name:"Glute Bridge", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"glute_ham_raise", name:"Glute Ham Raise", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Raise movement isolating the legs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"goblet_squat", name:"Goblet Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"good_morning", name:"Good Morning", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"gorilla_row", name:"Gorilla Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"gripper", name:"Gripper", category:"strength", muscleGroup:"forearm", icon:"✊", baseXP:35,
    muscles:"Forearm", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"hack_squat_machine", name:"Hack Squat Machine", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"hammer_curl", name:"Hammer Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"handstand_push_up", name:"Handstand Push-Up", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"hang_clean", name:"Hang Clean", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"hang_power_clean", name:"Hang Power Clean", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"hang_power_snatch", name:"Hang Power Snatch", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"hang_snatch", name:"Hang Snatch", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"hanging_knee_raise", name:"Hanging Knee Raise", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Raise movement isolating the abs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"hanging_leg_raise", name:"Hanging Leg Raise", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Raise movement isolating the abs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"hanging_sit_up", name:"Hanging Sit-Up", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"hanging_windshield_wiper", name:"Hanging Windshield Wiper", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"heel_raise", name:"Heel Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"heel_walk", name:"Heel Walk", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Calf raise variation building lower leg strength and size. Full range of motion for best results.", tips:[], images:[],
  },
  {
    id:"high_to_low_wood_chop_band", name:"High to Low Wood Chop Band", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"high_to_low_wood_chop_cable", name:"High to Low Wood Chop Cable", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"hip_abduction_against_band", name:"Hip Abduction Against Band", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"hip_abduction_machine", name:"Hip Abduction Machine", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"hip_adduction_against_band", name:"Hip Adduction Against Band", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Isolation movement targeting the legs. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"hip_adduction_machine", name:"Hip Adduction Machine", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Isolation movement targeting the legs. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"hip_thrust", name:"Hip Thrust", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"hip_thrust_machine", name:"Hip Thrust Machine", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"hip_thrust_with_band_around_knees", name:"Hip Thrust With Band Around Knees", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"hollow_body_crunch", name:"Hollow Body Crunch", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"horizontal_wood_chop_band", name:"Horizontal Wood Chop Band", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"horizontal_wood_chop_cable", name:"Horizontal Wood Chop Cable", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"incline_bench_press", name:"Incline Bench Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"incline_dumbbell_curl", name:"Incline Dumbbell Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"incline_dumbbell_press", name:"Incline Dumbbell Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"incline_push_up", name:"Incline Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"inverted_row", name:"Inverted Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"jackknife_sit_up", name:"Jackknife Sit-Up", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"jerk", name:"Jerk", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"jog", name:"Jogging", category:"cardio", muscleGroup:"cardio", icon:"🏃", baseXP:30,
    muscles:"Cardio", desc:"Jogging builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"jumpRope", name:"Jump Rope", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"⭕", baseXP:50,
    muscles:"Cardio", desc:"Jump Rope builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"jump_squat", name:"Jump Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"jumping_lunge", name:"Jumping Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"jumping_muscle_up", name:"Jumping Muscle-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"kettlebell_clean", name:"Kettlebell Clean", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"kettlebell_clean_and_jerk", name:"Kettlebell Clean and Jerk", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"kettlebell_clean_and_press", name:"Kettlebell Clean and Press", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"kettlebell_curl", name:"Kettlebell Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"kettlebell_front_squat", name:"Kettlebell Front Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"kettlebell_plank_pull_through", name:"Kettlebell Plank Pull Through", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"kettlebell_press", name:"Kettlebell Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"kettlebell_push_press", name:"Kettlebell Push Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"kettlebell_row", name:"Kettlebell Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"kettlebell_snatch", name:"Kettlebell Snatch", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"kettlebell_swing", name:"Kettlebell Swing", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"kettlebell_thrusters", name:"Kettlebell Thrusters", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"kettlebell_tibialis_raise", name:"Kettlebell Tibialis Raise", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Raise movement isolating the legs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"kettlebell_windmill", name:"Kettlebell Windmill", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"kneeling_ab_wheel_roll_out", name:"Kneeling Ab Wheel Roll-Out", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Calf raise variation building lower leg strength and size. Full range of motion for best results.", tips:[], images:[],
  },
  {
    id:"kneeling_incline_push_up", name:"Kneeling Incline Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"kneeling_plank", name:"Kneeling Plank", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"kneeling_push_up", name:"Kneeling Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"kneeling_side_plank", name:"Kneeling Side Plank", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"l_sit", name:"L-Sit", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"landmine_hack_squat", name:"Landmine Hack Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"landmine_press", name:"Landmine Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"landmine_rotation", name:"Landmine Rotation", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"landmine_squat", name:"Landmine Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"lat_pulldown_neutral_grip", name:"Lat Pulldown Neutral Grip", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"lat_pulldown_pronated_grip", name:"Lat Pulldown Pronated Grip", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"lat_pulldown_supinated_grip", name:"Lat Pulldown Supinated Grip", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"lateral_bound", name:"Lateral Bound", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"lateral_walk_with_band", name:"Lateral Walk With Band", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"leg_curl_on_ball", name:"Leg Curl On Ball", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"leg_extension", name:"Leg Extension", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Extension exercise targeting the legs. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"leg_press", name:"Leg Press", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"low_to_high_wood_chop_band", name:"Low to High Wood Chop Band", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"low_to_high_wood_chop_cable", name:"Low to High Wood Chop Cable", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"lying_bicep_cable_curl_on_bench", name:"Lying Bicep Cable Curl on Bench", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"lying_bicep_cable_curl_on_floor", name:"Lying Bicep Cable Curl on Floor", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"lying_leg_curl", name:"Lying Leg Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"lying_leg_raise", name:"Lying Leg Raise", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Raise movement isolating the abs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"lying_windshield_wiper", name:"Lying Windshield Wiper", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"lying_windshield_wiper_bent_knees", name:"Lying Windshield Wiper Bent Knees", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"machine_bicep_curl", name:"Machine Bicep Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"machine_chest_fly", name:"Machine Chest Fly", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Isolation movement stretching the chest through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"machine_chest_press", name:"Machine Chest Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"machine_crunch", name:"Machine Crunch", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"machine_glute_kickbacks", name:"Machine Glute Kickbacks", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"machine_lat_pulldown", name:"Machine Lat Pulldown", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"machine_lateral_raise", name:"Machine Lateral Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"machine_overhead_triceps_extension", name:"Machine Overhead Triceps Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"machine_shoulder_press", name:"Machine Shoulder Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"medicine_ball_chest_pass", name:"Medicine Ball Chest Pass", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"mountain_climbers", name:"Mountain Climbers", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Strength exercise targeting the abs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"muscle_up_bar", name:"Muscle-Up Bar", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"muscle_up_rings", name:"Muscle-Up Rings", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"neutral_close_grip_lat_pulldown", name:"Neutral Close-Grip Lat Pulldown", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"oblique_crunch", name:"Oblique Crunch", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"oblique_sit_up", name:"Oblique Sit-Up", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"one_arm_landmine_press", name:"One-Arm Landmine Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"one_handed_bar_hang", name:"One-Handed Bar Hang", category:"strength", secondaryCategory:"endurance", muscleGroup:"forearm", icon:"✊", baseXP:38,
    muscles:"Forearm", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"one_handed_cable_row", name:"One-Handed Cable Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"one_handed_kettlebell_swing", name:"One-Handed Kettlebell Swing", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"one_handed_lat_pulldown", name:"One-Handed Lat Pulldown", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"one_legged_glute_bridge", name:"One-Legged Glute Bridge", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"one_legged_hip_thrust", name:"One-Legged Hip Thrust", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"one_legged_leg_extension", name:"One-Legged Leg Extension", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Extension exercise targeting the legs. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"one_legged_lying_leg_curl", name:"One-Legged Lying Leg Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"one_legged_seated_leg_curl", name:"One-Legged Seated Leg Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"overhead_cable_curl", name:"Overhead Cable Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"overhead_cable_triceps_extension_lower", name:"Overhead Cable Triceps Extension Lower", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"overhead_cable_triceps_extension_upper", name:"Overhead Cable Triceps Extension Upper", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"ohp", name:"Overhead Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"pause_deadlift", name:"Pause Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"pause_squat", name:"Pause Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"pendulum_squat", name:"Pendulum Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"pin_squat", name:"Pin Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"pistol_squat", name:"Pistol Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"plank", name:"Plank", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"plank_to_push_up", name:"Plank to Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"plank_with_leg_lifts", name:"Plank with Leg Lifts", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"plank_with_shoulder_taps", name:"Plank with Shoulder Taps", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"plate_front_raise", name:"Plate Front Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"plate_pinch", name:"Plate Pinch", category:"strength", secondaryCategory:"endurance", muscleGroup:"forearm", icon:"✊", baseXP:38,
    muscles:"Forearm", desc:"Strength exercise targeting the forearm. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"plate_wrist_curl", name:"Plate Wrist Curl", category:"strength", muscleGroup:"forearm", icon:"✊", baseXP:35,
    muscles:"Forearm", desc:"Targets the forearm through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"poliquin_step_up", name:"Poliquin Step-Up", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"power_clean", name:"Power Clean", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"power_jerk", name:"Power Jerk", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"power_snatch", name:"Power Snatch", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"prisoner_get_up", name:"Prisoner Get Up", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"pullups", name:"Pull-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"pull_up_neutral_grip", name:"Pull-Up Neutral Grip", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"pushup", name:"Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Strength exercise targeting the chest. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"rack_pull", name:"Rack Pull", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Strength exercise targeting the back. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"renegade_row", name:"Renegade Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"resistance_band_curl", name:"Resistance Band Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"resistance_band_lateral_raise", name:"Resistance Band Lateral Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Raise movement isolating the shoulder. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"reverse_barbell_curl", name:"Reverse Barbell Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"reverse_barbell_lunge", name:"Reverse Barbell Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"reverse_body_weight_lunge", name:"Reverse Body Weight Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"reverse_cable_flyes", name:"Reverse Cable Flyes", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Isolation movement stretching the shoulder through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"reverse_dumbbell_curl", name:"Reverse Dumbbell Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"reverse_dumbbell_flyes", name:"Reverse Dumbbell Flyes", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Isolation movement stretching the shoulder through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"reverse_dumbbell_flyes_on_incline_bench", name:"Reverse Dumbbell Flyes on Incline Bench", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Isolation movement stretching the shoulder through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"reverse_dumbbell_lunge", name:"Reverse Dumbbell Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"reverse_hyperextension", name:"Reverse Hyperextension", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Extension exercise targeting the glutes. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"reverse_machine_fly", name:"Reverse Machine Fly", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Isolation movement stretching the shoulder through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"reverse_nordic", name:"Reverse Nordic", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"ring_pull_up", name:"Ring Pull-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"ring_row", name:"Ring Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"rdl", name:"Romanian Deadlift", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"rope_pulldown", name:"Rope Pulldown", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"rowing", name:"Rowing", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🚣", baseXP:50,
    muscles:"Cardio", desc:"Rowing builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"rowing_machine", name:"Rowing Machine", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🚣", baseXP:50,
    muscles:"Cardio", desc:"Rowing Machine builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"run", name:"Running", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🏃", baseXP:50,
    muscles:"Cardio", desc:"Running builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"safety_bar_squat", name:"Safety Bar Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"scap_pull_up", name:"Scap Pull-Up", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"seal_row", name:"Seal Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"seated_barbell_overhead_press", name:"Seated Barbell Overhead Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"seated_cable_chest_fly", name:"Seated Cable Chest Fly", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Isolation movement stretching the chest through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"seated_calf_raise", name:"Seated Calf Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"seated_dumbbell_shoulder_press", name:"Seated Dumbbell Shoulder Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"seated_kettlebell_press", name:"Seated Kettlebell Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"seated_leg_curl", name:"Seated Leg Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"seated_machine_row", name:"Seated Machine Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"seated_smith_machine_shoulder_press", name:"Seated Smith Machine Shoulder Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"side_lunges", name:"Side Lunges", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"forward_lunge", name:"Forward Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs, Glutes, Core", desc:"Step forward into a deep lunge, lowering the back knee toward the floor. Drive through the front heel to return. Builds unilateral leg strength and hip flexibility.", tips:[], images:[],
  },
  {
    id:"side_plank", name:"Side Plank", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"single_leg_deadlift_with_kettlebell", name:"Single Leg Deadlift with Kettlebell", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"single_leg_romanian_deadlift", name:"Single Leg Romanian Deadlift", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"toe_to_bar", name:"Toe-To-Bar", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:60,
    muscles:"Abs, Hip Flexors", desc:"Hang onto a bar and raise your legs until your toes reach the bar or as close to it as possible. Builds extreme core and hip flexor strength.", tips:[], images:[], defaultSets:3, defaultReps:3,
  },
  {
    id:"sit_up", name:"Sit-Up", category:"strength", muscleGroup:"abs", icon:"🧱", baseXP:35,
    muscles:"Abs", desc:"Core flexion exercise targeting the abs. Focus on drawing ribs to hips, not pulling the neck.", tips:[], images:[],
  },
  {
    id:"smith_machine_bench_press", name:"Smith Machine Bench Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"smith_machine_bulgarian_split_squat", name:"Smith Machine Bulgarian Split Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"smith_machine_deadlift", name:"Smith Machine Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"smith_machine_front_squat", name:"Smith Machine Front Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"smith_machine_hip_thrust", name:"Smith Machine Hip Thrust", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:50,
    muscles:"Glutes", desc:"Glute-dominant hip extension. Drive through the heels and squeeze glutes at the top.", tips:[], images:[],
  },
  {
    id:"smith_machine_incline_bench_press", name:"Smith Machine Incline Bench Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest", desc:"Pressing movement targeting the chest. Retract shoulder blades and press through full range of motion.", tips:[], images:[],
  },
  {
    id:"smith_machine_landmine_press", name:"Smith Machine Landmine Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"smith_machine_lunge", name:"Smith Machine Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Single-leg movement building unilateral leg strength and stability. Keep torso upright throughout.", tips:[], images:[],
  },
  {
    id:"smith_machine_one_handed_row", name:"Smith Machine One-Handed Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"smith_machine_romanian_deadlift", name:"Smith Machine Romanian Deadlift", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"smith_machine_skull_crushers", name:"Smith Machine Skull Crushers", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Strength exercise targeting the bicep. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"smith_machine_squat", name:"Smith Machine Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"snatch", name:"Snatch", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"snatch_grip_behind_the_neck_press", name:"Snatch Grip Behind the Neck Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"snatch_grip_deadlift", name:"Snatch Grip Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"spider_curl", name:"Spider Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"split_jerk", name:"Split Jerk", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Olympic weightlifting movement requiring power, coordination and full-body strength. Learn proper technique first.", tips:[], images:[],
  },
  {
    id:"squat", name:"Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"squat_jerk", name:"Squat Jerk", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"standing_cable_chest_fly", name:"Standing Cable Chest Fly", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:35,
    muscles:"Chest", desc:"Isolation movement stretching the chest through a wide arc. Control the weight through full range.", tips:[], images:[],
  },
  {
    id:"standing_cable_leg_extension", name:"Standing Cable Leg Extension", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Extension exercise targeting the legs. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"standing_calf_raise", name:"Standing Calf Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:35,
    muscles:"Calves", desc:"Raise movement isolating the calves. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"smith_machine_calf_raise", name:"Smith Machine Calf Raise", category:"strength", muscleGroup:"calves", icon:"🦶", baseXP:38,
    muscles:"Calves", desc:"Calf raise performed in a Smith machine for added stability. Place feet on a plate or step for full range of motion. Rise onto the balls of your feet and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"standing_glute_kickback_in_machine", name:"Standing Glute Kickback in Machine", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"standing_glute_push_down", name:"Standing Glute Push Down", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Strength exercise targeting the glutes. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"standing_hip_abduction_against_band", name:"Standing Hip Abduction Against Band", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:35,
    muscles:"Glutes", desc:"Isolation movement targeting the glutes. Control the movement — avoid swinging.", tips:[], images:[],
  },
  {
    id:"standing_hip_flexor_raise", name:"Standing Hip Flexor Raise", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Raise movement isolating the legs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"standing_leg_curl", name:"Standing Leg Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Targets the legs through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"stationary_bike", name:"Stationary Bike", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🚴", baseXP:50,
    muscles:"Cardio", desc:"Stationary Bike builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"step_up", name:"Step Up", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"stiff_legged_deadlift", name:"Stiff-Legged Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"straight_arm_lat_pulldown", name:"Straight Arm Lat Pulldown", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Vertical pulling movement building lat width and bicep strength. Full hang to chin-above-bar.", tips:[], images:[],
  },
  {
    id:"sumo_deadlift", name:"Sumo Deadlift", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"sumo_squat", name:"Sumo Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"superman_raise", name:"Superman Raise", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Back", desc:"Raise movement isolating the back. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"swim_lap", name:"Swimming", category:"cardio", secondaryCategory:"endurance", muscleGroup:"cardio", icon:"🏊", baseXP:50,
    muscles:"Cardio", desc:"Swimming builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"t_bar_row", name:"T-Bar Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"tibialis_band_pull", name:"Tibialis Band Pull", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"tibialis_raise", name:"Tibialis Raise", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Legs", desc:"Raise movement isolating the legs. Avoid momentum — lift with the target muscle.", tips:[], images:[],
  },
  {
    id:"towel_row", name:"Towel Row", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Rowing movement building back thickness. Drive elbows back and squeeze shoulder blades together.", tips:[], images:[],
  },
  {
    id:"trap_bar_deadlift_high_handles", name:"Trap Bar Deadlift High Handles", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"trap_bar_deadlift_low_handles", name:"Trap Bar Deadlift Low Handles", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:50,
    muscles:"Back", desc:"Hip-hinge movement loading the posterior chain. Maintain a neutral spine throughout the lift.", tips:[], images:[],
  },
  {
    id:"tricep_bodyweight_extension", name:"Tricep Bodyweight Extension", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Extension exercise targeting the bicep. Full range of motion maximises muscle activation.", tips:[], images:[],
  },
  {
    id:"tricep_pushdown_with_bar", name:"Tricep Pushdown With Bar", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Strength exercise targeting the bicep. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"turkish_get_up", name:"Turkish Get-Up", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"vertical_leg_press", name:"Vertical Leg Press", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Strength exercise targeting the legs. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"walk", name:"Walking", category:"cardio", muscleGroup:"cardio", icon:"🚶", baseXP:30,
    muscles:"Cardio", desc:"Walking builds cardiovascular endurance and burns calories effectively. Maintain steady pace and controlled breathing.", tips:[], images:[],
  },
  {
    id:"treadmill_walk", name:"Treadmill Walking", category:"cardio", muscleGroup:"cardio", icon:"🚶", baseXP:35,
    muscles:"Legs, Cardio", desc:"Walking on a treadmill. Optionally set incline (1-15) and speed (1-15). Enable Intervals for a +25% XP boost.", tips:[], images:[],
    hasTreadmill:true, defaultSets:1, defaultReps:20, defaultDurationMin:20,
  },
  {
    id:"treadmill_run", name:"Treadmill Running", category:"cardio", muscleGroup:"cardio", icon:"🏃", baseXP:55,
    muscles:"Legs, Cardio", desc:"Running on a treadmill. Optionally set incline (1-15) and speed (1-15). Enable Intervals for a +25% XP boost.", tips:[], images:[],
    hasTreadmill:true, defaultSets:1, defaultReps:20, defaultDurationMin:20,
  },
  {
    id:"wall_walk", name:"Wall Walk", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulder", desc:"Strength exercise targeting the shoulder. Focus on form and controlled range of motion.", tips:[], images:[],
  },
  {
    id:"weighted_plank", name:"Weighted Plank", category:"strength", secondaryCategory:"endurance", muscleGroup:"abs", icon:"🧱", baseXP:38,
    muscles:"Abs", desc:"Core stability exercise building anti-extension strength. Keep body in a rigid straight line.", tips:[], images:[],
  },
  {
    id:"wrist_roller", name:"Wrist Roller", category:"strength", secondaryCategory:"endurance", muscleGroup:"forearm", icon:"✊", baseXP:38,
    muscles:"Forearm", desc:"Forearm and grip strength exercise. Essential for pulling movements and overall hand strength.", tips:[], images:[],
  },
  {
    id:"z_press", name:"Z Press", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:45,
    muscles:"Shoulder", desc:"Overhead pressing movement developing shoulder strength. Brace core and press in a vertical path.", tips:[], images:[],
  },
  {
    id:"zercher_squat", name:"Zercher Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"zombie_squat", name:"Zombie Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Legs", desc:"Squat variation developing lower body strength. Keep chest up, knees tracking over toes.", tips:[], images:[],
  },
  {
    id:"zottman_curl", name:"Zottman Curl", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Bicep", desc:"Targets the bicep through a full curl motion. Keep upper arms stationary and squeeze at the top.", tips:[], images:[],
  },
  {
    id:"rest_day", name:"Rest Day", category:"endurance", muscleGroup:"back", icon:"🛌", baseXP:50,
    muscles:"", desc:"Active recovery or full rest. Your body grows stronger during recovery.", tips:[], images:[],
    defaultSets:1, defaultReps:1,
  },

  // ── Prebuilt Workout Additions ─────────────────────────────────
  {
    id:"nordic_hamstring_curl", name:"Nordic Hamstring Curl", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:50,
    muscles:"Hamstrings", desc:"Partner or machine-assisted eccentric hamstring exercise. Kneel and slowly lower your torso forward, controlling the descent with your hamstrings.", tips:[], images:[],
  },
  {
    id:"sissy_squat", name:"Sissy Squat", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:40,
    muscles:"Quads, VMO", desc:"Quad isolation exercise. Lean back while bending knees, keeping hips extended. Use a sissy squat bench or hold a support for balance.", tips:[], images:[],
  },
  {
    id:"battle_ropes", name:"Battle Ropes", category:"cardio", muscleGroup:"cardio", icon:"🪢", baseXP:40,
    muscles:"Shoulders, Arms, Core", desc:"Alternating wave slams with heavy ropes. Keep a slight squat stance and generate waves from your shoulders.", tips:[], images:[],
  },
  {
    id:"jump_rope_double_unders", name:"Jump Rope (Double Unders)", category:"cardio", muscleGroup:"cardio", icon:"⏫", baseXP:45,
    muscles:"Calves, Shoulders, Cardiovascular", desc:"Advanced jump rope variation where the rope passes under your feet twice per jump. Requires fast wrist rotation and higher jump.", tips:[], images:[],
  },
  {
    id:"sled_push", name:"Sled Push", category:"cardio", muscleGroup:"legs", icon:"🛷", baseXP:50,
    muscles:"Quads, Glutes, Calves", desc:"Push a weighted sled across the floor. Drive through the balls of your feet with arms extended.", tips:[], images:[],
  },
  {
    id:"roundhouse_kick", name:"Roundhouse Kick", category:"cardio", muscleGroup:"cardio", icon:"🦶", baseXP:30,
    muscles:"Hips, Core, Legs", desc:"Rotational kick from a fighting stance. Pivot on the standing foot, rotate hips, and strike with the shin or instep.", tips:[], images:[],
  },
  {
    id:"worlds_greatest_stretch", name:"World's Greatest Stretch", category:"flexibility", muscleGroup:"legs", icon:"🧘", baseXP:25,
    muscles:"Hips, Hamstrings, Thoracic Spine", desc:"Lunge forward, place hands on the floor, rotate torso toward the lead leg with arm extended. A comprehensive mobility drill.", tips:[], images:[],
  },
  {
    id:"hip_90_90_stretch", name:"Hip 90/90 Stretch", category:"flexibility", muscleGroup:"legs", icon:"🧘", baseXP:20,
    muscles:"Hips (Internal/External Rotation)", desc:"Sit with both legs at 90-degree angles. Rotate between internal and external hip positions. Improves hip mobility.", tips:[], images:[],
  },
  {
    id:"frog_pump", name:"Frog Pump", category:"strength", muscleGroup:"glutes", icon:"🍑", baseXP:30,
    muscles:"Glutes", desc:"Lie on your back with soles of feet together, knees out. Bridge up and squeeze glutes at the top. Great glute activation drill.", tips:[], images:[],
  },
  {
    id:"prone_y_raise", name:"Prone Y-Raise", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:25,
    muscles:"Lower Traps, Rear Delts, Scapular Stabilizers", desc:"Lie face-down on an incline bench. Raise arms in a Y shape with thumbs up. Targets scapular health and upper back.", tips:[], images:[],
  },
  {
    id:"dumbbell_curl_to_press", name:"Dumbbell Curl to Press", category:"strength", muscleGroup:"shoulder", icon:"💪", baseXP:45,
    muscles:"Biceps, Shoulders", desc:"Curl dumbbells to shoulders then press overhead. A compound movement combining bicep curl with shoulder press.", tips:[], images:[],
  },
  {
    id:"cable_pullover", name:"Cable Pullover", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:35,
    muscles:"Lats, Serratus Anterior", desc:"Stand facing away from a high cable. Pull the bar down in an arc from overhead to your thighs, keeping arms mostly straight.", tips:[], images:[],
  },
  {
    id:"thoracic_spine_rotation", name:"Thoracic Spine Rotation", category:"flexibility", muscleGroup:"back", icon:"🧘", baseXP:20,
    muscles:"Thoracic Spine, Obliques", desc:"On hands and knees, place one hand behind your head and rotate that elbow toward the ceiling. Improves mid-back mobility.", tips:[], images:[],
  },
  {
    id:"pigeon_stretch", name:"Pigeon Stretch", category:"flexibility", muscleGroup:"glutes", icon:"🧘", baseXP:20,
    muscles:"Glutes, Hip Flexors, Piriformis", desc:"From a lunge position, lower your front shin to the floor. Extend the rear leg back. Deep hip opener targeting the glutes.", tips:[], images:[],
  },
  {
    id:"childs_pose", name:"Child's Pose", category:"flexibility", muscleGroup:"back", icon:"🧘", baseXP:15,
    muscles:"Lower Back, Lats, Shoulders", desc:"Kneel and sit back on your heels. Reach arms forward on the floor. A restorative stretch for the back and shoulders.", tips:[], images:[],
  },
  {
    id:"foam_rolling", name:"Foam Rolling", category:"flexibility", muscleGroup:"legs", icon:"🧘", baseXP:20,
    muscles:"Full Body (Soft Tissue)", desc:"Self-myofascial release using a foam roller. Roll slowly over tight areas including quads, IT band, lats, and thoracic spine.", tips:[], images:[],
  },
  {
    id:"cat_cow_stretch", name:"Cat-Cow Stretch", category:"flexibility", muscleGroup:"back", icon:"🧘", baseXP:15,
    muscles:"Spine, Core", desc:"On hands and knees, alternate between arching (cow) and rounding (cat) your spine. Warms up the entire spinal column.", tips:[], images:[],
  },
  {
    id:"wall_sit", name:"Wall Sit", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:30,
    muscles:"Quads, Glutes", desc:"Lean against a wall with thighs parallel to the floor. Hold the position. An isometric leg endurance exercise.", tips:[], images:[],
    secondaryCategory:"endurance",
  },
  {
    id:"stairmaster", name:"Stairmaster", category:"cardio", muscleGroup:"legs", icon:"🪜", baseXP:40,
    muscles:"Glutes, Quads, Cardiovascular", desc:"Continuous stair climbing on a stairmaster machine. Great for lower body endurance and cardiovascular conditioning.", tips:[], images:[],
  },
  {
    id:"elliptical", name:"Elliptical", category:"cardio", muscleGroup:"cardio", icon:"🏃", baseXP:30,
    muscles:"Full Body, Cardiovascular", desc:"Low-impact cardio machine that simulates running without joint stress. Adjustable resistance and incline.", tips:[], images:[],
  },
  {
    id:"high_knees", name:"High Knees", category:"cardio", muscleGroup:"cardio", icon:"🏃", baseXP:30,
    muscles:"Hip Flexors, Quads, Core", desc:"Run in place driving knees as high as possible. A high-intensity cardio drill that builds speed and agility.", tips:[], images:[],
  },
  {
    id:"jumping_jacks", name:"Jumping Jacks", category:"cardio", muscleGroup:"cardio", icon:"⭐", baseXP:20,
    muscles:"Full Body, Cardiovascular", desc:"Jump feet apart while raising arms overhead, then return. A classic warm-up and cardio exercise.", tips:[], images:[],
  },
  {
    id:"wide_push_up", name:"Wide Push-Up", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:30,
    muscles:"Chest, Shoulders", desc:"Push-up with hands placed wider than shoulder width. Increases chest activation compared to standard push-ups.", tips:[], images:[],
  },
  {
    id:"diamond_push_up", name:"Diamond Push-Up", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:40,
    muscles:"Triceps, Chest", desc:"Push-up with hands close together forming a diamond shape. Heavy tricep emphasis.", tips:[], images:[],
  },
  {
    id:"pike_push_up", name:"Pike Push-Up", category:"strength", muscleGroup:"shoulder", icon:"💪", baseXP:40,
    muscles:"Shoulders, Triceps", desc:"Push-up with hips raised high in an inverted V position. Targets shoulders similar to an overhead press.", tips:[], images:[],
  },
  {
    id:"reverse_fly", name:"Reverse Fly", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:30,
    muscles:"Rear Delts, Rhomboids", desc:"Bend over and raise dumbbells out to the sides. Targets the rear deltoids and upper back.", tips:[], images:[],
  },
  {
    id:"reverse_curl", name:"Reverse Curl", category:"strength", muscleGroup:"forearm", icon:"💪", baseXP:30,
    muscles:"Forearms, Brachioradialis", desc:"Curl a barbell or EZ bar with palms facing down. Emphasizes the forearms and brachioradialis.", tips:[], images:[],
  },
  {
    id:"skull_crushers", name:"Skull Crushers", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:40,
    muscles:"Triceps", desc:"Lie on a bench and lower an EZ bar toward your forehead, then extend. A classic tricep isolation exercise.", tips:[], images:[],
  },
  {
    id:"dips", name:"Dips", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Chest, Triceps, Shoulders", desc:"Lower and raise your body on parallel bars. A compound pushing movement for chest and triceps.", tips:[], images:[],
  },
  {
    id:"incline_barbell_press", name:"Incline Barbell Press", category:"strength", muscleGroup:"chest", icon:"💪", baseXP:50,
    muscles:"Upper Chest, Shoulders, Triceps", desc:"Barbell bench press on an incline bench (30-45 degrees). Targets the upper portion of the chest.", tips:[], images:[],
  },
  {
    id:"burpees", name:"Burpees", category:"cardio", muscleGroup:"cardio", icon:"🔥", baseXP:45,
    muscles:"Full Body", desc:"Drop to a push-up, jump feet in, then explode upward. A full-body conditioning exercise that builds endurance and power.", tips:[], images:[],
  },
  {
    id:"dumbbell_close_grip_press", name:"Dumbbell Close-Grip Press", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:35,
    muscles:"Triceps, Chest", desc:"Press dumbbells with elbows tucked close to the body. Shifts emphasis from chest to triceps.", tips:[], images:[],
  },
  {
    id:"dumbbell_upright_row", name:"Dumbbell Upright Row", category:"strength", muscleGroup:"shoulder", icon:"🏋️", baseXP:35,
    muscles:"Shoulders, Traps", desc:"Pull dumbbells up along your body with elbows high. Targets the lateral deltoids and upper traps.", tips:[], images:[],
  },
  {
    id:"russian_twist", name:"Russian Twist", category:"strength", muscleGroup:"abs", icon:"🔄", baseXP:30,
    muscles:"Obliques, Abs", desc:"Sit with feet off the floor and rotate torso side to side. Add weight for increased difficulty.", tips:[], images:[],
  },
  {
    id:"reverse_lunge", name:"Reverse Lunge", category:"strength", muscleGroup:"legs", icon:"🦵", baseXP:35,
    muscles:"Quads, Glutes, Hamstrings", desc:"Step backward into a lunge position, then drive back up. Easier on the knees than forward lunges.", tips:[], images:[],
  },
  {
    id:"hyperextension", name:"Hyperextension", category:"strength", muscleGroup:"back", icon:"🏋️", baseXP:30,
    muscles:"Lower Back, Glutes, Hamstrings", desc:"Lie face down on a hyperextension bench and raise your torso. Strengthens the posterior chain.", tips:[], images:[],
  },
  {
    id:"dumbbell_tricep_kickback", name:"Dumbbell Tricep Kickback", category:"strength", muscleGroup:"bicep", icon:"💪", baseXP:30,
    muscles:"Triceps", desc:"Bend over with elbow at 90 degrees and extend the dumbbell behind you. Squeeze at full extension.", tips:[], images:[],
  },
  {
    id:"jab_cross", name:"Jab-Cross Combo", category:"cardio", muscleGroup:"cardio", icon:"🥊", baseXP:25,
    muscles:"Shoulders, Core", desc:"Basic boxing combination. Lead hand jab followed by rear hand cross. Focus on rotation and speed.", tips:[], images:[],
  },
  {
    id:"front_kick", name:"Front Kick", category:"cardio", muscleGroup:"cardio", icon:"🦶", baseXP:25,
    muscles:"Quads, Hip Flexors, Core", desc:"Drive your knee up and extend your foot forward in a push kick. Alternate legs.", tips:[], images:[],
  },
  {
    id:"hook", name:"Hook Punch", category:"cardio", muscleGroup:"cardio", icon:"🥊", baseXP:25,
    muscles:"Obliques, Shoulders, Core", desc:"Circular punch targeting the side of an opponent. Rotate your hips and core for power.", tips:[], images:[],
  },
]
const EX_BY_ID = Object.fromEntries(EXERCISES.map(e=>[e.id,e]));

// ═══════════════════════════════════════════════════════════════════
// PHASE 1 — Iconify Exercise Icons (SVG API)
// Uses Iconify's SVG API to render icons as plain <img> tags.
// No web component, no JS runtime, no font files — just HTTP-cached SVGs.
// Works on iOS Safari, Android, every desktop browser, everywhere.
// Primary sets: game-icons (RPG-themed), mdi (fitness)
// Browse: https://icon-sets.iconify.design
// ═══════════════════════════════════════════════════════════════════

// MUSCLE_COLORS defined in color section below — referenced by getExIconColor
const CAT_ICON_COLORS = {
  strength:"#e05555", cardio:"#2ecc71", flexibility:"#9b59b6", endurance:"#3498db",
};

const NAME_ICON_MAP = [
  // CHEST
  [/bench press|chest press|floor press/i,         "game-icons:weight-lifting-up"],
  [/push.?up|press.?up/i,                          "game-icons:push"],
  [/dip\b/i,                                       "game-icons:muscle-up"],
  [/fly|flye|pec.?dec|cable cross/i,               "game-icons:eagle-emblem"],
  [/chest/i,                                       "game-icons:chest-armor"],
  // BACK
  [/pull.?up|chin.?up/i,                           "game-icons:muscle-up"],
  [/lat pull|pulldown/i,                           "game-icons:weight-lifting-down"],
  [/row|bent.?over|pendlay|t.?bar/i,               "game-icons:weight-lifting-up"],
  [/deadlift|rack pull/i,                          "game-icons:weight-lifting-up"],
  [/shrug|trap/i,                                  "game-icons:shoulder-armor"],
  [/face pull/i,                                   "game-icons:muscle-fat"],
  [/back ext/i,                                    "game-icons:back-pain"],
  // SHOULDERS
  [/overhead|ohp|military|shoulder press/i,        "game-icons:weight-lifting-up"],
  [/lateral raise|side raise/i,                    "game-icons:wingspan"],
  [/front raise/i,                                 "game-icons:wingfoot"],
  [/rear delt|reverse fly/i,                       "game-icons:eagle-emblem"],
  [/shoulder/i,                                    "game-icons:shoulder-armor"],
  // ARMS
  [/bicep|curl|preacher|hammer curl|concentration/i, "game-icons:biceps"],
  [/tricep|skull crush|push.?down|kick.?back/i,     "game-icons:fist"],
  [/wrist curl|forearm|grip/i,                       "game-icons:grab"],
  // LEGS
  [/squat|goblet|hack squat|front squat/i,         "game-icons:leg-armor"],
  [/lunge|split squat|bulgarian|step.?up/i,        "game-icons:boot-stomp"],
  [/leg press/i,                                   "game-icons:leg-armor"],
  [/leg curl|hamstring|rdl|romanian/i,             "game-icons:leg"],
  [/leg ext|quad/i,                                "game-icons:leg-armor"],
  [/calf|soleus|gastro/i,                          "game-icons:boot-stomp"],
  [/hip thrust|glute|bridge|kickback/i,            "game-icons:muscle-fat"],
  // CORE
  [/plank|hollow|dead bug|l.?sit/i,                "game-icons:stone-block"],
  [/crunch|sit.?up|ab.?wheel|v.?up/i,             "game-icons:abdominal-armor"],
  [/twist|wood.?chop|rotation|oblique/i,           "game-icons:spinning-sword"],
  [/hang.?raise|leg raise|knee raise/i,            "game-icons:muscle-up"],
  [/core|ab\b/i,                                   "game-icons:abdominal-armor"],
  // CARDIO
  [/sprint/i,                                      "game-icons:running-ninja"],
  [/run|jog|treadmill/i,                           "game-icons:run"],
  [/cycl|bike|spin|peloton/i,                      "mdi:bike"],
  [/swim|pool|lap|stroke/i,                        "game-icons:swimming"],
  [/row|erg|concept/i,                             "game-icons:rowing"],
  [/jump rope|skipping/i,                          "game-icons:jump-across"],
  [/jump|box jump|plyo|burpee/i,                   "game-icons:jump-across"],
  [/stair|stepper|step mill/i,                     "game-icons:stairs-goal"],
  [/hike|incline walk|mountain/i,                  "game-icons:mountain-climbing"],
  [/walk|march/i,                                  "game-icons:walk"],
  [/elliptical|cross.?train/i,                     "game-icons:run"],
  [/battle rope|wave/i,                            "game-icons:lasso"],
  [/ski/i,                                         "game-icons:ski-boot"],
  [/sled/i,                                        "game-icons:push"],
  // FLEXIBILITY
  [/yoga|sun salut|warrior pose|vinyasa/i,         "game-icons:meditation"],
  [/stretch|mobility|foam roll|pigeon/i,           "game-icons:body-balance"],
  [/lotus|meditation/i,                            "game-icons:lotus-flower"],
  // EQUIPMENT
  [/kettlebell|kb swing|clean.*press/i,            "game-icons:kettlebell"],
  [/ball slam|medicine ball|wall ball/i,           "game-icons:bowling-strike"],
  [/band|resistance|banded/i,                      "game-icons:chain"],
  [/cable|machine/i,                               "game-icons:gear-hammer"],
  [/bar hang|farmer|carry/i,                       "game-icons:grab"],
  [/muscle.?up/i,                                  "game-icons:muscle-up"],
  [/clean.?and.?jerk|snatch|power clean/i,         "game-icons:weight-lifting-up"],
  [/box/i,                                         "game-icons:wooden-crate"],
  // REST / RECOVERY
  [/rest day|rest|recovery|off day|deload/i,       "game-icons:camping-tent"],
];

export { EXERCISES, CLASSES, IMG };
