/**
 * PlayerSprite — the LOCAL player's Phaser game object.
 *
 * Handles:
 *  - Keyboard input (WASD + arrow keys)
 *  - Movement physics
 *  - Animation state (idle/walk per direction)
 *  - Periodic position sync to SpacetimeDB
 */

import Phaser from 'phaser';
import { DIR, PLAYER, CLASS_ROW, ANIM_FRAMES } from './constants.js';

export class PlayerSprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} classType  - 'warrior' | 'mage' | 'archer' | 'rogue'
   * @param {function} onMove   - callback(x, y, direction, isMoving) → calls reducer
   */
  constructor(scene, x, y, classType, onMove) {
    this.scene = scene;
    this.onMove = onMove;
    this.classType = classType;
    this.direction = DIR.DOWN;
    this.isMoving = false;
    this._lastSentAt = 0;

    // Create sprite
    this.sprite = scene.physics.add.sprite(x, y, 'characters');
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);

    // Set up animations if not already registered
    this._registerAnims(classType);

    // Name tag (managed by UIScene, but depth anchor is here)
    this.sprite.setSize(24, 36);  // hitbox slightly smaller than visual

    // Keyboard input
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.wasd = scene.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
  }

  _registerAnims(classType) {
    const row = CLASS_ROW[classType] ?? 0;
    const { framesPerDir, dirsPerClass, frameWidth, frameHeight } = ANIM_FRAMES;
    const totalCols = framesPerDir;

    const directions = ['down', 'up', 'left', 'right'];

    directions.forEach((dir, dirIdx) => {
      const key = `${classType}_${dir}`;
      if (this.scene.anims.exists(key)) return;

      // Each row in the texture = one class × one direction
      // Row index = classRow * 4 + dirIndex
      const sheetRow = row * dirsPerClass + dirIdx;
      const startFrame = sheetRow * totalCols;

      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers('characters', {
          start: startFrame,
          end:   startFrame + framesPerDir - 1,
        }),
        frameRate: 8,
        repeat: -1,
      });

      // Idle = single frame (first frame of each direction)
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

  update(time) {
    const speed = PLAYER.SPEED;
    let vx = 0;
    let vy = 0;
    let newDir = this.direction;

    const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown;
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;

    if (up)    { vy = -speed; newDir = DIR.UP;    }
    if (down)  { vy =  speed; newDir = DIR.DOWN;  }
    if (left)  { vx = -speed; newDir = DIR.LEFT;  }
    if (right) { vx =  speed; newDir = DIR.RIGHT; }

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const norm = Math.SQRT1_2;
      vx *= norm;
      vy *= norm;
    }

    const moving = vx !== 0 || vy !== 0;
    this.sprite.setVelocity(vx, vy);

    // Update animation
    const dirName = ['down', 'up', 'left', 'right'][newDir];
    const animKey = moving
      ? `${this.classType}_${dirName}`
      : `${this.classType}_idle_${dirName}`;

    if (this.sprite.anims.currentAnim?.key !== animKey) {
      this.sprite.play(animKey, true);
    }

    // Update state
    const stateChanged = moving !== this.isMoving || newDir !== this.direction;
    this.direction = newDir;
    this.isMoving  = moving;

    // Send position to server (rate limited + only when something changed)
    if ((stateChanged || moving) && time - this._lastSentAt >= PLAYER.SEND_RATE_MS) {
      this.onMove(this.sprite.x, this.sprite.y, this.direction, this.isMoving);
      this._lastSentAt = time;
    }
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  destroy() {
    this.sprite.destroy();
  }
}
