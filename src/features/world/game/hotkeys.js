/**
 * hotkeys.js — single source of truth for the world's control scheme.
 * Shared by the desktop hint strip (WorldGame) and the Game Menu so they
 * never drift apart.
 */

export const HOTKEYS = [
  { keys: 'WASD / ↑↓←→', action: 'Move' },
  { keys: 'Space',        action: 'Attack nearest enemy' },
  { keys: 'F',            action: 'Build campfire' },
  { keys: 'Enter',        action: 'Chat  (/w for world chat)' },
  { keys: 'M',            action: 'World map' },
  { keys: 'I',            action: 'Inventory' },
  { keys: 'C',            action: 'Cooking' },
  { keys: 'G',            action: 'Game menu' },
  { keys: 'N',            action: 'Toggle minimap' },
  { keys: 'Mouse drag',   action: 'Orbit camera' },
  { keys: 'Scroll',       action: 'Zoom camera' },
  { keys: 'Esc',          action: 'Close panel / exit world' },
];
