/**
 * AurisarWorldScene — the main Phaser game scene.
 *
 * Responsibilities:
 *  - Load and render the tilemap
 *  - Spawn and control the local player
 *  - Spawn/update/destroy remote players from SpacetimeDB subscriptions
 *  - Drive the camera to follow the local player
 */

import Phaser from 'phaser';
import { PlayerSprite }      from './PlayerSprite.js';
import { OtherPlayerSprite } from './OtherPlayerSprite.js';
import { WORLD, PLAYER, ZONES } from './constants.js';

export class AurisarWorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AurisarWorld' });
    this._otherPlayers = new Map(); // identity → OtherPlayerSprite
  }

  // ── Phaser lifecycle ──────────────────────────────────────────────────────

  preload() {
    // Assets are loaded in the Preload scene (see WorldGame.jsx config)
    // This scene assumes they're already in cache.
  }

  create() {
    // ── Tilemap ──
    const map = this.make.tilemap({ key: 'world-map' });
    const tiles = map.addTilesetImage('tileset', 'tileset');

    // Layer order: ground < decorations < objects (collision)
    this._layerGround  = map.createLayer('Ground',       tiles, 0, 0);
    this._layerDeco    = map.createLayer('Decorations',  tiles, 0, 0);
    this._layerObjects = map.createLayer('Objects',      tiles, 0, 0);

    if (this._layerObjects) {
      this._layerObjects.setCollisionByProperty({ collides: true });
    }

    // ── World bounds ──
    this.physics.world.setBounds(0, 0, WORLD.WIDTH, WORLD.HEIGHT);

    // ── Local player ──
    // Retrieve player info injected via Phaser's registry from WorldGame.jsx
    const playerInfo = this.registry.get('playerInfo') ?? {
      classType:   'warrior',
      username:    'Player',
      avatarColor: '#60a5fa',
    };

    this._localPlayer = new PlayerSprite(
      this,
      1600, // spawn X — center of the Hub
      1600, // spawn Y
      playerInfo.classType,
      (x, y, direction, isMoving) => this._onLocalPlayerMoved(x, y, direction, isMoving)
    );

    // Collide with Objects layer
    if (this._layerObjects) {
      this.physics.add.collider(this._localPlayer.sprite, this._layerObjects);
    }

    // ── Camera ──
    this.cameras.main
      .startFollow(this._localPlayer.sprite, true, 0.1, 0.1) // smooth follow
      .setBounds(0, 0, WORLD.WIDTH, WORLD.HEIGHT)
      .setDeadzone(PLAYER.SPRITE_WIDTH * 2, PLAYER.SPRITE_HEIGHT * 2);

    this.cameras.main.setZoom(2);   // 2× zoom for a crisper top-down look

    // ── SpacetimeDB subscriptions ──
    // The connection is managed in useSpacetimeWorld.js and passed via registry.
    // We register callbacks here so the React hook can call them.
    this.registry.set('onPlayerUpdate',  this._onRemotePlayerUpdate.bind(this));
    this.registry.set('onPlayerDelete',  this._onRemotePlayerDelete.bind(this));

    // Replay any players already in the registry snapshot
    const snapshot = this.registry.get('playersSnapshot');
    if (snapshot) {
      snapshot.forEach(row => this._onRemotePlayerUpdate(row));
    }

    // ── Zone indicator ──
    this._currentZoneId = -1;
    this._zoneText = this.add
      .text(16, 16, '', {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#00000066',
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0) // stays fixed on screen
      .setDepth(100);

    // ── Emit scene-ready to React ──
    this.registry.set('sceneReady', true);
  }

  update(time, delta) {
    if (!this._localPlayer) return;

    this._localPlayer.update(time);

    // Update all remote players (lerp interpolation)
    this._otherPlayers.forEach(sprite => sprite.update());

    // Zone name HUD
    const zoneId = this._getLocalZoneId();
    if (zoneId !== this._currentZoneId) {
      this._currentZoneId = zoneId;
      const zone = ZONES[zoneId] ?? ZONES[3];
      this._zoneText.setText(zone.name).setColor(zone.color);
    }
  }

  // ── SpacetimeDB callbacks ─────────────────────────────────────────────────

  _onRemotePlayerUpdate(playerRow) {
    // Don't render a sprite for ourselves
    const myIdentity = this.registry.get('myIdentity');
    if (playerRow.identity === myIdentity) return;

    // Skip offline players
    if (!playerRow.online) {
      this._onRemotePlayerDelete(playerRow);
      return;
    }

    if (this._otherPlayers.has(playerRow.identity)) {
      this._otherPlayers.get(playerRow.identity).applyUpdate(playerRow);
    } else {
      const sprite = new OtherPlayerSprite(this, playerRow);
      this._otherPlayers.set(playerRow.identity, sprite);
    }
  }

  _onRemotePlayerDelete(playerRow) {
    const sprite = this._otherPlayers.get(playerRow.identity);
    if (sprite) {
      sprite.destroy();
      this._otherPlayers.delete(playerRow.identity);
    }
  }

  // ── Local player movement → SpacetimeDB ──────────────────────────────────

  _onLocalPlayerMoved(x, y, direction, isMoving) {
    const moveReducer = this.registry.get('movePlayer');
    if (moveReducer) moveReducer(x, y, direction, isMoving);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _getLocalZoneId() {
    if (!this._localPlayer) return 3;
    const { x, y } = this._localPlayer;
    if (x >= 1200 && x <= 2000 && y >= 1200 && y <= 2000) return 0;
    if (x <= 1200 && y <= 1200) return 1;
    if (x >= 2000 && y >= 2000) return 2;
    return 3;
  }

  // Called by React before teardown
  cleanup() {
    this._otherPlayers.forEach(s => s.destroy());
    this._otherPlayers.clear();
    this._localPlayer?.destroy();
  }
}
