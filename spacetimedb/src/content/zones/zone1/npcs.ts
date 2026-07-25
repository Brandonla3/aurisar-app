// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/npcs.ts
// Regenerate with: npm run sync:content

/**
 * zone1/npcs.ts — the hub NPCs. Original Aurisar placeholder names; the
 * layout (positions/facings/roles) is modeled on the reference design's
 * starter zone (see public/assets/ATTRIBUTION.md). The story pass rewrites
 * names and dialogue freely.
 *
 * questIds list quests the server supports (kill + collect + find objectives).
 * Dungeon quests (q_sexton, q_hollow, q_gravecallers_trail) activate in P7.
 */
import type { NpcDef } from '../../types';

export const NPCS: NpcDef[] = [
  {
    id: 'marshal_halwin',
    zoneId: 1,
    name: 'Marshal Halwin',
    title: 'Town Marshal',
    pos: { x: 11, z: 7 },
    facingRad: Math.PI,
    questIds: ['q_first_blood', 'q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader'],
    greeting: 'Keep your blade close, $C. This valley is not what it was.',
  },
  {
    id: 'trader_pell',
    zoneId: 1,
    name: 'Trader Pell',
    title: 'Provisioner',
    pos: { x: -12.6, z: -1.4 },
    facingRad: Math.PI / 2,
    questIds: ['q_supplies'],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you?',
    vendorItemIds: ['baked_bread', 'spring_water', 'roasted_boar', 'tough_jerky'],
  },
  {
    id: 'apothecary_yarrow',
    zoneId: 1,
    name: 'Apothecary Yarrow',
    title: 'Herbalist',
    pos: { x: 12, z: -5 },
    facingRad: -Math.PI / 2,
    questIds: ['q_boars', 'q_spiders'],
    greeting: 'Careful where you step in the eastern woods, friend.',
  },
  {
    id: 'brother_edran',
    zoneId: 1,
    name: 'Brother Edran',
    title: 'Town Priest',
    pos: { x: -6, z: -15 },
    facingRad: 0.8,
    questIds: ['q_bones', 'q_whispers', 'q_names_of_the_dead', 'q_silence_the_call', 'q_rite'],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  {
    id: 'smith_dorn',
    zoneId: 1,
    name: 'Smith Dorn',
    title: 'Armorer & Weaponsmith',
    pos: { x: 8, z: 19 },
    facingRad: -2.7,
    questIds: [],
    greeting: 'Mind the sparks, $C. Good steel is the difference between a scar and a grave.',
    vendorItemIds: [
      'arming_sword', 'bronzework_mace', 'carving_knife', 'hickory_shortstaff',
      'chain_vest', 'spun_robe', 'tanned_leather_jerkin',
      'hobnail_boots', 'wool_trousers',
    ],
  },
  {
    id: 'fisher_maelis',
    zoneId: 1,
    name: 'Fisher Maelis',
    title: 'Old Salt',
    pos: { x: -9, z: 16 },
    facingRad: -0.75,
    questIds: ['q_murlocs'],
    greeting: 'Grlmurlgrl— sorry, been listening to those fish-men too long.',
  },
  {
    id: 'foreman_bram',
    zoneId: 1,
    name: 'Foreman Bram',
    title: 'Mine Foreman',
    pos: { x: 6, z: -18 },
    facingRad: -2.14,
    questIds: ['q_mine'],
    greeting: "Whole dig's crawling with those candle-headed vermin!",
  },
];
