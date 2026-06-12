/**
 * zone1/npcs.ts — hub NPCs for zone 1. All names/copy are placeholders
 * for the story pass; only ids are load-bearing. Positions are zone-local
 * meters around the hub at (0, 0).
 */
import type { NpcDef } from '../../types';

export const NPCS: NpcDef[] = [
  {
    id: 'npc_z1_marshal',
    zoneId: 1,
    name: 'Marshal Veyra', // placeholder
    title: 'Hub Marshal',
    pos: { x: 3, z: 5 },
    facingRad: Math.PI,
    questIds: ['q1_wolves_at_the_walls', 'q1_scout_the_ruins', 'q1_bandit_threat'],
    greeting:
      'Walls hold because people hold them, $C. There is work if you want it.', // placeholder
  },
  {
    id: 'npc_z1_provisioner',
    zoneId: 1,
    name: 'Provisioner Haln', // placeholder
    title: 'Provisioner',
    pos: { x: -7, z: 3 },
    facingRad: Math.PI / 2,
    questIds: [],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you, $N?', // placeholder
    vendorItemIds: [
      'baked_bread',
      'spring_water',
      'worn_shortsword',
      'hunting_bow',
      'gnarled_staff',
      'padded_vest',
      'travelers_boots',
    ],
  },
  {
    id: 'npc_z1_huntmaster',
    zoneId: 1,
    name: 'Huntmaster Odo', // placeholder
    title: 'Huntmaster',
    pos: { x: 8, z: -4 },
    facingRad: -Math.PI / 2,
    questIds: ['q1_boar_cull', 'q1_the_old_camp'],
    greeting: 'The wilds feed those who respect them — and bury those who don’t.', // placeholder
  },
  {
    id: 'npc_z1_gatewarden',
    zoneId: 1,
    name: 'Gatewarden Sel', // placeholder
    title: 'Gatewarden',
    pos: { x: 0, z: 440 },
    facingRad: 0,
    questIds: [],
    greeting:
      'The north pass is closed to anyone the road would chew up. Train first.', // placeholder — soft level gate
  },
];
