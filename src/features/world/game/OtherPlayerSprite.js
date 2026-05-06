/**
 * OtherPlayerSprite — a remote player's Phaser game object.
 *
 * Receives position updates from SpacetimeDB and smoothly interpolates
 * to the target position (avoids teleporting on network updates).
 */

import Phaser from 'phaser';
import { CLASS_ROW, ANIM_FRAMES, CLASS_COLORS } from './constants.js';

export class OtherPlayerSprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} playerRow  - SpacetimeDB player table row
   */
  constructor(scene, playerRow) {
    this.scene = scene;
    this.identity = playerRow.identity;
    this.username = playerRow.username;
    this.classType = playerRow.classType;

    // Target position (what server says)
    this._targetX = playerRow.x;
    this._targetY = playerRow.y;

    // Register animations if needed (same logic as PlayerSprite)
    this._registerAnims(playerRow.classType);

    // Create sprite at server position
    this.sprite = scene.add.sprite(playerRow.x, playerRow.y, 'characters');
    this.sprite.setDepth(9); // slightly below local player

    // Username tag — simple Phaser text object
    const color = CLASS_COLORS[playerRow.classType] ?? '#ffffff';
    this.nameTag = scene.add.text(playerRow.x, playerRow.y - 30, playerRow.username, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color,
      stroke: '#000000',
      strokeThickness: 3,
      resolution: 2,
    });
    this.nameTag.setOrigin(0.5, 1);
    this.nameTag.setDepth(20);

    this._updateAnim(playerRow.direction, playerRow.isMoving);
  }

  _registerAnims(classType) {
    const row = CLASS_ROW[classType] ?? 0;
    const { framesPerDir, dirsPerClass } = ANIM_FRAMES;

    ['down', 'up', 'left', 'right'].forEach((dir, dirIdx) => {
      const key = `${classType}_${dir}`;
      if (this.scene.anims.exists(key)) return;

      const sheetRow   = row * dirsPerClass + dirIdx;
      const startFrame = sheetRow * framesPerDir;

      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers('characters', {
          start: startFrame,
          end:   startFrame + framesPerDir - 1,
        }),
        frameRate: 8,
        repeat: -1,
      });

      const idleKey = `${classType}_idle_${dir}`;
      if (!this.scene.anims.exists(idleKey)) {
        this.scene.anims.create({
          key: idleKey,
          frames: [{ key: 'characters', frame: startFrame }],
          frameRate: 1,
          repeat: 0,
        });
      }
    });
  }

  _updateAnim(direction, isMoving) {
    const dirName = ['down', 'up', 'left', 'right'][direction ?? 0];
    const animKey = isMoving
      ? `${this.classType}_${dirName}`
      : `${this.classType}_idle_${dirName}`;

    if (this.sprite.anims?.currentAnim?.key !== animKey) {
      this.sprite.play(animKey, true);
    }
  }

  /**
   * Called when a SpacetimeDB update arrives for this player's row.
   */
  applyUpdate(playerRow) {
    this._targetX  = playerRow.x;
    this._targetY  = playerRow.y;
    this._updateAnim(playerRow.direction, playerRow.isMoving);
  }

  /**
   * Call every frame — smoothly interpolates toward target position.
   */
  update() {
    const lerpFactor = 0.18; // 0=no movement, 1=instant snap
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this._targetX, lerpFactor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this._targetY, lerpFactor);

    // Keep name tag above sprite
    this.nameTag.setPosition(this.sprite.x, this.sprite.y - 30);
  }

  destroy() {
    this.sprite.destroy();
    this.nameTag.destroy();
  }
}
