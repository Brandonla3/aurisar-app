// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/npcs.ts
// Regenerate with: npm run sync:content

/**
 * zone1/npcs.ts — the hub NPCs. Original Aurisar placeholder names; roles
 * modeled on the reference design's starter zone (see
 * public/assets/ATTRIBUTION.md). The story pass rewrites names and
 * dialogue freely.
 *
 * Everyone lives in the starter village (village_center.glb, centered at
 * (-10,-100) — see zones/zone1/props.ts): quest-givers around the plaza and
 * gates, plus ambient villagers standing in front of their houses. The
 * plaza is at roughly (-6,-98); the main gates open south, toward the
 * spawn meadow.
 *
 * questIds list only the quests the current server supports (kill
 * objectives). The collect-objective quests (q_boars, q_spiders,
 * q_supplies, the Edran collect chain) and the dungeon quests activate
 * with P4 (server inventory) and P7 (the crypt dungeon).
 */
import type { NpcDef } from '../../types';

export const NPCS: NpcDef[] = [
  // ── Quest-givers & vendors (village plaza / gates) ─────────────────
  {
    id: 'marshal_halwin',
    zoneId: 1,
    name: 'Marshal Halwin',
    title: 'Town Marshal',
    pos: { x: -2, z: -98 },
    facingRad: -Math.PI / 2,
    questIds: ['q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader'],
    greeting: 'Keep your blade close, $C. This valley is not what it was.',
  },
  {
    id: 'trader_pell',
    zoneId: 1,
    name: 'Trader Pell',
    title: 'Provisioner',
    pos: { x: -17.5, z: -91 },
    facingRad: Math.PI / 2,
    questIds: [],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you?',
    vendorItemIds: ['baked_bread', 'spring_water', 'roasted_boar', 'tough_jerky'],
  },
  {
    id: 'apothecary_yarrow',
    zoneId: 1,
    name: 'Apothecary Yarrow',
    title: 'Herbalist',
    pos: { x: 12, z: -82 },
    facingRad: -2.3,
    questIds: [],
    greeting: 'Careful where you step in the eastern woods, friend.',
  },
  {
    id: 'brother_edran',
    zoneId: 1,
    name: 'Brother Edran',
    title: 'Town Priest',
    pos: { x: -4, z: -108 },
    facingRad: 0.3,
    questIds: ['q_bones'],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  {
    id: 'smith_dorn',
    zoneId: 1,
    name: 'Smith Dorn',
    title: 'Armorer & Weaponsmith',
    pos: { x: 2.5, z: -87 },
    facingRad: -2.48,
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
    pos: { x: -8, z: -70 },
    facingRad: 0.11,
    questIds: ['q_murlocs'],
    greeting: 'Grlmurlgrl— sorry, been listening to those fish-men too long.',
  },
  {
    id: 'foreman_bram',
    zoneId: 1,
    name: 'Foreman Bram',
    title: 'Mine Foreman',
    pos: { x: -22, z: -98 },
    facingRad: Math.PI / 2,
    questIds: ['q_mine'],
    greeting: "Whole dig's crawling with those candle-headed vermin!",
  },

  // ── Villagers (in front of their houses; flavor only, no quests) ───
  {
    id: 'innkeep_rosa',
    zoneId: 1,
    name: 'Innkeep Rosa',
    title: 'The Gilded Hearth',
    pos: { x: -18, z: -86 },
    facingRad: 2.4,
    questIds: [],
    greeting: 'Warm bed and a warmer stew, $C — cheapest comfort in the valley.',
  },
  {
    id: 'baker_wynn',
    zoneId: 1,
    name: 'Baker Wynn',
    title: 'Bread & Hearthcakes',
    pos: { x: -2, z: -104 },
    facingRad: -0.6,
    questIds: [],
    greeting: 'Smell that? Third batch since sunrise. The marshal buys the burnt ones.',
  },
  {
    id: 'carpenter_joss',
    zoneId: 1,
    name: 'Carpenter Joss',
    title: 'Joiner & Roofwright',
    pos: { x: -38, z: -116 },
    facingRad: 0.5,
    questIds: [],
    greeting: 'Every roof in this village is mine. The leaks too, sadly.',
  },
  {
    id: 'weaver_lyssa',
    zoneId: 1,
    name: 'Weaver Lyssa',
    title: 'Cloth & Dye',
    pos: { x: 10, z: -97 },
    facingRad: -1.6,
    questIds: [],
    greeting: 'Wolf wool, $C. Coarse, but it holds a dye like nothing else.',
  },
  {
    id: 'miller_hobb',
    zoneId: 1,
    name: 'Miller Hobb',
    title: 'Grain & Gossip',
    pos: { x: -30, z: -102 },
    facingRad: 1.4,
    questIds: [],
    greeting: 'Flour for the baker, chaff for the hens, rumors for everyone else.',
  },
  {
    id: 'gardener_fen',
    zoneId: 1,
    name: 'Gardener Fen',
    title: 'Herb Plots',
    pos: { x: -10, z: -76 },
    facingRad: 2.9,
    questIds: [],
    greeting: 'Mind the beds by the gate — the yarrow there is worth more than it looks.',
  },
];
