// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/quests.ts
// Regenerate with: npm run sync:content

/**
 * zone1/quests.ts — the zone-1 questline, modeled on the reference
 * design's starter zone (see public/assets/ATTRIBUTION.md). All text is
 * placeholder copy the story pass rewrites.
 *
 * ACTIVE NOW (kill objectives — what the current server supports):
 *   q_wolves → q_greyjaw / q_bandits → q_ringleader · q_murlocs ·
 *   q_mine · q_bones
 * Adaptation: q_greyjaw's collect-the-fang objective runs as
 * kill-Old-Greyjaw until P4's server inventory lands.
 *
 * STAGED FOR LATER PHASES (kept out of QUESTS so the validator and UI
 * only see implementable content): q_boars, q_spiders, q_supplies (P4 —
 * collect objectives), q_whispers → q_names_of_the_dead →
 * q_silence_the_call → q_rite (P4 chain), q_sexton, q_hollow,
 * q_gravecallers_trail (P7 — Hollow Crypt dungeon).
 *
 * gameXp values are theirs, applied only if GAME_XP_ENABLED flips on;
 * copper grants land in P2.
 */
import type { QuestDef } from '../../types';

export const QUESTS: QuestDef[] = [
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
    // P4 swaps this back to collect greyjaw_fang ×1 (his guaranteed drop).
    objectives: [
      { type: 'kill', mobType: 'old_greyjaw', count: 1, label: 'Old Greyjaw slain' },
    ],
    reward: { copper: 150, itemIds: ['greyjaw_pelt_cloak'], gameXp: 450 },
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
    text: 'The bandits answer to one man: Gorrak the Ruthless. Cut off the head and the body will scatter. He skulks at the heart of their camp. End him, $N.',
    completionText: 'Gorrak is dead? Then the valley is free of his shadow. You have done the town a great service.',
    objectives: [
      { type: 'kill', mobType: 'gorrak', count: 1, label: 'Gorrak the Ruthless slain' },
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
];
