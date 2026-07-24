/**
 * zone1/quests.ts — the zone-1 questline, modeled on the reference
 * design's starter zone (see public/assets/ATTRIBUTION.md). All text is
 * placeholder copy the story pass rewrites.
 *
 * Kill objectives: q_first_blood · q_wolves, q_bandits → q_ringleader ·
 * q_murlocs · q_mine · q_bones
 * Collect objectives (P4 phase 2): q_greyjaw, q_boars, q_spiders, q_supplies
 * Edran chain (P4 phase 5): q_whispers → q_names_of_the_dead →
 * q_silence_the_call → q_rite
 *
 * STAGED FOR LATER: q_sexton, q_hollow, q_gravecallers_trail (P7).
 *
 * gameXp values are theirs, applied only if GAME_XP_ENABLED flips on.
 */
import type { QuestDef } from '../../types';

export const QUESTS: QuestDef[] = [
  {
    // First-session quest (docs/world-design-plan.md, Batch A): no level
    // gate, no prereq, 3 kills at the nearest camp — a fresh account gets
    // a directed win inside its first 10–20-minute burst. Deliberately
    // additive: q_wolves keeps its own shape and both credit wolf kills.
    id: 'q_first_blood',
    zoneId: 1,
    name: 'First Blood',
    giverNpcId: 'marshal_halwin',
    turnInNpcId: 'marshal_halwin',
    text: "New to the valley, $N? Then learn its first rule: the wolves are not afraid of you yet. There is a wolf run just up the north road — put down 3 Forest Wolves and come straight back. Quick work, close to home.",
    completionText: 'Quick and clean. You will do fine here. Now, about those wolves at the door…',
    objectives: [
      { type: 'kill', mobType: 'forest_wolf', count: 3, label: 'Forest Wolf slain' },
    ],
    reward: { copper: 40, itemIds: ['tough_jerky'], gameXp: 100 },
  },
  {
    id: 'q_wolves',
    zoneId: 1,
    name: 'Wolves at the Door',
    giverNpcId: 'marshal_halwin',
    turnInNpcId: 'marshal_halwin',
    text: 'The forest wolves grow bold, snapping at travelers on the north road. Thin their numbers, $N. Slay 8 Forest Wolves and the town will breathe easier.',
    completionText: 'Fine work. The road feels safer already.',
    objectives: [
      { type: 'kill', mobType: 'forest_wolf', count: 8, label: 'Forest Wolf slain' },
    ],
    reward: { copper: 75, gameXp: 250 },
  },
  {
    id: 'q_greyjaw',
    zoneId: 1,
    name: 'The Old Wolf',
    giverNpcId: 'marshal_halwin',
    turnInNpcId: 'marshal_halwin',
    requiresQuestId: 'q_wolves',
    text: "There is one wolf no trap has held: Old Greyjaw. He has taken three hounds and a stable boy's arm. He prowls the deep woods north of the wolf runs. Bring me his fang.",
    completionText: 'So the old devil is dead at last. The stable boy will sleep easier — and so will I.',
    objectives: [
      { type: 'collect', itemId: 'greyjaw_fang', count: 1, label: "Old Greyjaw's Fang" },
    ],
    reward: { copper: 150, itemIds: ['greyjaw_pelt_cloak'], gameXp: 450 },
  },
  {
    id: 'q_boars',
    zoneId: 1,
    name: 'Boar Trouble',
    giverNpcId: 'apothecary_yarrow',
    turnInNpcId: 'apothecary_yarrow',
    minLevel: 2,
    text: 'The boars in Tuskfield to the east have grown vicious, and I need their hides for salves. Hunt the Wild Boars and bring me 6 Bristly Boar Hides, $N.',
    completionText: 'Good — these will keep the apothecary stocked for a fortnight.',
    objectives: [
      { type: 'collect', itemId: 'boar_hide', count: 6, label: 'Bristly Boar Hide' },
    ],
    reward: { copper: 120, gameXp: 380 },
  },
  {
    id: 'q_spiders',
    zoneId: 1,
    name: 'Webwood Silk',
    giverNpcId: 'apothecary_yarrow',
    turnInNpcId: 'apothecary_yarrow',
    requiresQuestId: 'q_boars',
    minLevel: 3,
    text: 'The spiders in Gloomweb spin a silk that binds my poultices better than linen. Slay the lurkers and bring me 6 Webwood Silk Glands.',
    completionText: 'Ah, fine specimens. The marshals will want some of this batch too.',
    objectives: [
      { type: 'collect', itemId: 'webwood_silk', count: 6, label: 'Webwood Silk Gland' },
    ],
    reward: { copper: 140, gameXp: 420 },
  },
  {
    id: 'q_supplies',
    zoneId: 1,
    name: 'Bandage Run',
    giverNpcId: 'trader_pell',
    turnInNpcId: 'trader_pell',
    minLevel: 3,
    text: 'The town clinic is short on clean cloth. Bandits and kobolds leave scraps behind — gather 8 Linen Scraps from the vale and the dig, and I will pay fair coin.',
    completionText: 'Much obliged. These will be bandages by morning.',
    objectives: [
      { type: 'collect', itemId: 'linen_scrap', count: 8, label: 'Linen Scrap' },
    ],
    reward: { copper: 110, gameXp: 340 },
  },
  {
    id: 'q_murlocs',
    zoneId: 1,
    name: 'Trouble at the Lake',
    giverNpcId: 'fisher_maelis',
    turnInNpcId: 'fisher_maelis',
    minLevel: 3,
    text: 'Twenty years I have fished Stillmere, and never lost a net until those gurgling fish-men crawled out of the shallows. Drive the Mudfin back — slay 8 of them. And watch yourself: where there is one murloc, there are five.',
    completionText: 'Hah! That will teach them to mind their own mudholes.',
    objectives: [
      { type: 'kill', mobType: 'mudfin_murloc', count: 8, label: 'Mudfin Skulker slain' },
    ],
    reward: { copper: 180, gameXp: 520 },
  },
  {
    id: 'q_mine',
    zoneId: 1,
    name: 'Rats in the Mine',
    giverNpcId: 'foreman_bram',
    turnInNpcId: 'foreman_bram',
    minLevel: 4,
    text: 'We struck a fine copper vein and then those kobold vermin came boiling out of the hillside. My crew will not set foot in the dig until it is cleared. Put down 10 Tunnel Rat Diggers.',
    completionText: 'Ha! Back to work, lads! You have my thanks — and my coin.',
    objectives: [
      { type: 'kill', mobType: 'tunnel_rat', count: 10, label: 'Tunnel Rat Digger slain' },
    ],
    reward: { copper: 220, gameXp: 620 },
  },
  {
    id: 'q_bandits',
    zoneId: 1,
    name: 'Bandits of the Vale',
    giverNpcId: 'marshal_halwin',
    turnInNpcId: 'marshal_halwin',
    requiresQuestId: 'q_wolves',
    text: 'A pack of cutthroats has made camp in the southwest hills. They have robbed three wagons this week. Drive them out — slay 10 Vale Bandits.',
    completionText: 'Ten fewer knives in the dark. Take this — you have earned it.',
    objectives: [
      { type: 'kill', mobType: 'vale_bandit', count: 10, label: 'Vale Bandit slain' },
    ],
    reward: { copper: 200, itemIds: ['marshals_blade'], gameXp: 550 },
  },
  {
    id: 'q_ringleader',
    zoneId: 1,
    name: 'The Ringleader',
    giverNpcId: 'marshal_halwin',
    turnInNpcId: 'marshal_halwin',
    requiresQuestId: 'q_bandits',
    minLevel: 5,
    text: 'Gorrak the Ruthless has barricaded himself in the treasury vault deep within Castle Ashwood. Enter through the gate to the southeast, fight your way to the royal vault on the upper floors, and end him, $N.',
    completionText: 'Gorrak is dead? Then the valley is free of his shadow. You have done the town a great service.',
    objectives: [
      {
        type: 'kill',
        mobType: 'gorrak',
        count: 1,
        label: 'Gorrak the Ruthless slain in the treasury',
        spawnNetIdPrefix: 'ca_boss',
      },
    ],
    reward: { copper: 500, itemIds: ['militia_vest'], gameXp: 800 },
  },
  {
    id: 'q_bones',
    zoneId: 1,
    name: 'The Restless Dead',
    giverNpcId: 'brother_edran',
    turnInNpcId: 'brother_edran',
    minLevel: 5,
    text: 'The old ruin on the northwest hill was a chapel once, and its yard a resting place. Something has stirred the dead from their sleep. Grant them peace, $N — return 8 Restless Bones to the earth.',
    completionText: 'May they rest now, and may the Light forgive whatever woke them.',
    objectives: [
      { type: 'kill', mobType: 'restless_bones', count: 8, label: 'Restless Bones laid to rest' },
    ],
    reward: { copper: 260, gameXp: 700 },
  },
  {
    id: 'q_whispers',
    zoneId: 1,
    name: 'Whispers in the Chapel Yard',
    giverNpcId: 'brother_edran',
    turnInNpcId: 'brother_edran',
    requiresQuestId: 'q_bones',
    minLevel: 5,
    text: 'The dead speak in fragments now — cold breath on the back of the neck, words without mouths. Gather 4 vials of Ghostly Essence from the restless bones at Mourner\'s Rest. I must learn what they are trying to say.',
    completionText: 'These essences still murmur. I will begin the rite of naming tonight.',
    objectives: [
      { type: 'collect', itemId: 'ghostly_essence', count: 4, label: 'Ghostly Essence' },
    ],
    reward: { copper: 180, gameXp: 480 },
  },
  {
    id: 'q_names_of_the_dead',
    zoneId: 1,
    name: 'Names of the Dead',
    giverNpcId: 'brother_edran',
    turnInNpcId: 'brother_edran',
    requiresQuestId: 'q_whispers',
    minLevel: 5,
    text: 'Each bone remembers a name, and names have power over what walks again. Bring me 6 sets of Bone Fragments from the undead camp — I will inscribe them on the chapel stones.',
    completionText: 'Good. The names are written. Now we must quiet the call that woke them.',
    objectives: [
      { type: 'collect', itemId: 'bone_fragments', count: 6, label: 'Bone Fragments' },
    ],
    reward: { copper: 200, gameXp: 520 },
  },
  {
    id: 'q_silence_the_call',
    zoneId: 1,
    name: 'Silence the Call',
    giverNpcId: 'brother_edran',
    turnInNpcId: 'brother_edran',
    requiresQuestId: 'q_names_of_the_dead',
    minLevel: 5,
    text: 'The tunnel rats carry blessed tallow stolen from my stores — candles meant to ward the restless. Recover 4 Blessed Tallow from the dig, $N, before the calling spreads beyond the hill.',
    completionText: 'The tallow is safe. One rite remains before the dead sleep again.',
    objectives: [
      { type: 'collect', itemId: 'blessed_wax', count: 4, label: 'Blessed Tallow' },
    ],
    reward: { copper: 220, gameXp: 560 },
  },
  {
    id: 'q_rite',
    zoneId: 1,
    name: 'The Rite of Rest',
    giverNpcId: 'brother_edran',
    turnInNpcId: 'brother_edran',
    requiresQuestId: 'q_silence_the_call',
    minLevel: 5,
    text: 'Meet me at Mourner\'s Rest on the northwest hill. Stand within the old chapel stones while I speak the final prayer — then return, and I will bless your hands for the work ahead.',
    completionText: 'It is done. The hill is quiet again. Wear these — they are consecrated for a defender of the living.',
    objectives: [
      { type: 'find', targetId: 'poi_mourners_rest', label: "Pray at Mourner's Rest" },
    ],
    reward: { copper: 320, itemIds: ['boarhide_gloves'], gameXp: 750 },
  },
];
