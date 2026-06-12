/**
 * items/questItems.ts — quest-bound items (untradeable, unsellable).
 */
import type { ItemDef } from '../types';

export const QUEST_ITEMS: ItemDef[] = [
  {
    id: 'qi_wolf_pelt',
    name: 'Greyjaw Wolf Pelt',
    icon: '🐺',
    type: 'quest',
    stack: 20,
    quality: 'common',
  },
  {
    id: 'qi_sealed_dispatch',
    name: 'Sealed Dispatch',
    icon: '📜',
    type: 'quest',
    stack: 1,
    quality: 'common',
  },
];
