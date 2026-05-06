/**
 * Aurisar World — Shared constants
 * Used by both Phaser scenes and the React layer.
 */

export const WORLD = {
  WIDTH: 3200,
  HEIGHT: 3200,
  TILE_SIZE: 32,
  TILES_X: 100,
  TILES_Y: 100,
};

export const PLAYER = {
  SPEED: 200,           // pixels per second
  SPRITE_WIDTH: 32,
  SPRITE_HEIGHT: 48,
  SEND_RATE_MS: 50,     // send position to server every 50ms while moving
  NAME_OFFSET_Y: -30,   // px above sprite center for username tag
};

// Direction indices — match the sprite sheet rows
export const DIR = {
  DOWN: 0,
  UP: 1,
  LEFT: 2,
  RIGHT: 3,
};

// Zone definitions — must match server detectZone() logic
export const ZONES = [
  { id: 0, name: 'The Aurisar Hub',     color: '#4ade80' },
  { id: 1, name: 'Training Grounds',    color: '#f97316' },
  { id: 2, name: 'Leaderboard Plaza',   color: '#a78bfa' },
  { id: 3, name: 'The Wilderness',      color: '#94a3b8' },
];

// Class → sprite sheet row mapping
export const CLASS_ROW = {
  warrior: 0,
  mage:    1,
  archer:  2,
  rogue:   3,
};

// Proximity chat radius (px)
export const PROXIMITY_RADIUS = 400;

// Animation frame data — 4 frames per direction
// Sprite sheet layout: each row = one direction × 4 frames, per class
// Row ordering within a class: down(0), up(1), left(2), right(3)
export const ANIM_FRAMES = {
  frameWidth: 32,
  frameHeight: 48,
  framesPerDir: 4,
  dirsPerClass: 4,
};

// Max chat messages to keep in memory
export const MAX_CHAT_MESSAGES = 50;

// Colors per class for name tags
export const CLASS_COLORS = {
  warrior: '#ef4444',
  mage:    '#8b5cf6',
  archer:  '#22c55e',
  rogue:   '#f59e0b',
};
