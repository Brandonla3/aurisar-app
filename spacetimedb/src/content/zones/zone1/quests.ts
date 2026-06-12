// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/quests.ts
// Regenerate with: npm run sync:content

/**
 * zone1/quests.ts — starter questline (kill + find objectives only until
 * server inventory ships in P4). All text is placeholder for the story
 * pass. gameXp values only apply if GAME_XP_ENABLED is flipped on.
 */
import type { QuestDef } from '../../types';

export const QUESTS: QuestDef[] = [
  {
    id: 'q1_wolves_at_the_walls',
    zoneId: 1,
    name: 'Wolves at the Walls', // placeholder
    giverNpcId: 'npc_z1_marshal',
    turnInNpcId: 'npc_z1_marshal',
    text:
      'The wolves grow bold, snapping at travelers on the north road. Thin their numbers, $N — slay 6 Greyjaw Wolves and the hub will breathe easier.', // placeholder
    completionText: 'Fine work. The road feels safer already.', // placeholder
    objectives: [
      { type: 'kill', mobType: 'wolf', count: 6, label: 'Greyjaw Wolf slain' },
    ],
    reward: { copper: 75, itemIds: ['greyjaw_pelt_cloak'], gameXp: 250 },
  },
  {
    id: 'q1_scout_the_ruins',
    zoneId: 1,
    name: 'Eyes on the Ruins', // placeholder
    giverNpcId: 'npc_z1_marshal',
    turnInNpcId: 'npc_z1_marshal',
    text:
      'Something moves in the old ruins east of here. Climb to the overlook and tell me what you see, $C.', // placeholder
    completionText: 'So it’s as I feared. You have sharp eyes — we’ll need them.', // placeholder
    objectives: [
      { type: 'find', targetId: 'wp_z1_ruins_overlook', label: 'Ruins Overlook scouted' },
    ],
    reward: { copper: 60, gameXp: 150 },
  },
  {
    id: 'q1_boar_cull',
    zoneId: 1,
    name: 'The Boar Cull', // placeholder
    giverNpcId: 'npc_z1_huntmaster',
    turnInNpcId: 'npc_z1_huntmaster',
    text:
      'Bristlebacks are tearing up the east fields. Cull 8 of them before they ruin the harvest, $N.', // placeholder
    completionText: 'The fields will recover. You hunt well.', // placeholder
    objectives: [
      { type: 'kill', mobType: 'boar', count: 8, label: 'Bristleback Boar slain' },
    ],
    reward: { copper: 90, itemIds: ['boarhide_gloves'], gameXp: 300 },
    requiresQuestId: 'q1_wolves_at_the_walls',
  },
  {
    id: 'q1_the_old_camp',
    zoneId: 1,
    name: 'What the Camp Left Behind', // placeholder
    giverNpcId: 'npc_z1_huntmaster',
    turnInNpcId: 'npc_z1_huntmaster',
    text:
      'An old camp west of the trail went quiet last season. Find it, and put down any wolves that have made it their den.', // placeholder
    completionText: 'Quiet answers are still answers. Take this — you’ve earned a harder regimen.', // placeholder
    objectives: [
      { type: 'find', targetId: 'wp_z1_old_camp', label: 'Abandoned Camp found' },
      { type: 'kill', mobType: 'wolf', count: 4, label: 'Den wolf slain' },
    ],
    // First workout-template reward — gating UI lands in P2.
    reward: { copper: 80, templateUnlockIds: ['iron_press'], gameXp: 250 },
  },
  {
    id: 'q1_bandit_threat',
    zoneId: 1,
    name: 'The Bandit Threat', // placeholder
    giverNpcId: 'npc_z1_marshal',
    turnInNpcId: 'npc_z1_marshal',
    text:
      'Bandits have dug in north of the ruins and the road pays their toll in blood. Break their camp, $C — 5 of them, by my count.', // placeholder
    completionText: 'The toll is lifted. The road remembers who lifted it.', // placeholder
    objectives: [
      { type: 'kill', mobType: 'bandit', count: 5, label: 'Roadside Bandit slain' },
    ],
    reward: { copper: 150, itemIds: ['wolfsbane_blade'], gameXp: 400 },
    minLevel: 3,
    requiresQuestId: 'q1_boar_cull',
  },
];
