// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/npcs.ts
// Regenerate with: npm run sync:content

/**
 * zone1/npcs.ts — the hub NPCs. Original Aurisar placeholder names; the
 * layout (positions/facings/roles) is modeled on the reference design's
 * starter zone (see public/assets/ATTRIBUTION.md). The story pass rewrites
 * names and dialogue freely.
 *
 * questIds list quests the server supports (kill + collect objectives).
 * The Edran collect chain and dungeon quests activate with later P4/P7
 * phases.
 */
import type { NpcDef } from '../../types';

export const NPCS: NpcDef[] = [
  {
    id: 'marshal_halwin',
    zoneId: 1,
    name: 'Marshal Halwin',
    title: 'Town Marshal',
    pos: { x: 4, z: 6 },
    facingRad: Math.PI,
    questIds: ['q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader'],
    greeting: 'Keep your blade close, $C. This valley is not what it was.',
  },
  {
    id: 'trader_pell',
    zoneId: 1,
    name: 'Trader Pell',
    title: 'Provisioner',
    pos: { x: -7, z: 3 },
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
    pos: { x: 11, z: -3 },
    facingRad: -Math.PI / 2,
    questIds: ['q_boars', 'q_spiders'],
    greeting: 'Careful where you step in the eastern woods, friend.',
  },
  {
    id: 'brother_edran',
    zoneId: 1,
    name: 'Brother Edran',
    title: 'Town Priest',
    pos: { x: -14, z: -10 },
    facingRad: 0.8,
    questIds: ['q_bones'],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  {
    id: 'smith_dorn',
    zoneId: 1,
    name: 'Smith Dorn',
    title: 'Armorer & Weaponsmith',
    pos: { x: 7, z: 16.5 },
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
    pos: { x: -16, z: 6 },
    facingRad: -0.75,
    questIds: ['q_murlocs'],
    greeting: 'Grlmurlgrl— sorry, been listening to those fish-men too long.',
  },
  {
    id: 'foreman_bram',
    zoneId: 1,
    name: 'Foreman Bram',
    title: 'Mine Foreman',
    pos: { x: -4, z: -14 },
    facingRad: -2.14,
    questIds: ['q_mine'],
    greeting: "Whole dig's crawling with those candle-headed vermin!",
  },
];
