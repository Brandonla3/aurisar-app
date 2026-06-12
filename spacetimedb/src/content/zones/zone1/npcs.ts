// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/npcs.ts
// Regenerate with: npm run sync:content

/**
 * zone1/npcs.ts — Eastbrook's NPCs, copied verbatim from
 * world-of-claudecraft zone-1 (MIT; see public/assets/ATTRIBUTION.md).
 * Positions/facings/greetings are theirs 1:1.
 *
 * questIds list only the quests the current server supports (kill
 * objectives). The collect-objective quests (q_boars, q_spiders,
 * q_supplies, the Aldric collect chain) and the dungeon quests activate
 * with P4 (server inventory) and P7 (Hollow Crypt).
 */
import type { NpcDef } from '../../types';

export const NPCS: NpcDef[] = [
  {
    id: 'marshal_redbrook',
    zoneId: 1,
    name: 'Marshal Redbrook',
    title: 'Town Marshal',
    pos: { x: 4, z: 6 },
    facingRad: Math.PI,
    questIds: ['q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader'],
    greeting: 'Keep your blade close, $C. The Vale is not what it was.',
  },
  {
    id: 'trader_wilkes',
    zoneId: 1,
    name: 'Trader Wilkes',
    title: 'Provisioner',
    pos: { x: -7, z: 3 },
    facingRad: Math.PI / 2,
    questIds: [],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you?',
    vendorItemIds: ['baked_bread', 'spring_water', 'roasted_boar', 'tough_jerky'],
  },
  {
    id: 'apothecary_lin',
    zoneId: 1,
    name: 'Apothecary Lin',
    title: 'Herbalist',
    pos: { x: 11, z: -3 },
    facingRad: -Math.PI / 2,
    questIds: [],
    greeting: 'Careful where you step in the eastern woods, friend.',
  },
  {
    id: 'brother_aldric',
    zoneId: 1,
    name: 'Brother Aldric',
    title: 'Priest of the Vale',
    pos: { x: -14, z: -10 },
    facingRad: 0.8,
    questIds: ['q_bones'],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  {
    id: 'smith_haldren',
    zoneId: 1,
    name: 'Smith Haldren',
    title: 'Armorer & Weaponsmith',
    pos: { x: 7, z: 16.5 },
    facingRad: -2.7,
    questIds: [],
    greeting: 'Mind the sparks, $C. Good steel is the difference between a scar and a grave.',
    vendorItemIds: [
      'eastbrook_arming_sword', 'bronzework_mace', 'vale_carving_knife', 'hickory_shortstaff',
      'eastbrook_chain_vest', 'valespun_robe', 'tanned_leather_jerkin',
      'hobnail_boots', 'eastbrook_wool_trousers',
    ],
  },
  {
    id: 'fisherman_brandt',
    zoneId: 1,
    name: 'Fisherman Brandt',
    title: 'Old Salt',
    pos: { x: -16, z: 6 },
    facingRad: -0.75,
    questIds: ['q_murlocs'],
    greeting: 'Grlmurlgrl— sorry, been listening to those fish-men too long.',
  },
  {
    id: 'foreman_odell',
    zoneId: 1,
    name: 'Foreman Odell',
    title: 'Mine Foreman',
    pos: { x: -4, z: -14 },
    facingRad: -2.14,
    questIds: ['q_mine'],
    greeting: "Whole dig's crawling with those candle-headed vermin!",
  },
];
