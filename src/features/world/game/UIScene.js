/**
 * UIScene — Phaser overlay scene for HUD elements.
 *
 * Runs in parallel with AurisarWorldScene (same camera does NOT apply here).
 * Fixed-position elements: chat bar, player count, online indicator.
 *
 * This scene is kept separate so HUD never scrolls with the world camera.
 */

import Phaser from 'phaser';
import { MAX_CHAT_MESSAGES, PROXIMITY_RADIUS } from './constants.js';

export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UI', active: true });
    this._messages = [];     // { text, senderName, msgType, x, y }
    this._chatOpen = false;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    // ── Chat panel (bottom left) ──
    this._chatBg = this.add.rectangle(8, H - 8, 340, 160, 0x000000, 0.55)
      .setOrigin(0, 1)
      .setDepth(200);

    this._chatLog = this.add.text(16, H - 40, '', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color: '#e2e8f0',
      wordWrap: { width: 316 },
      lineSpacing: 4,
    }).setOrigin(0, 1).setDepth(201);

    // Chat input bar
    this._inputBg = this.add.rectangle(8, H - 8, 340, 28, 0x1e293b, 0.95)
      .setOrigin(0, 1)
      .setDepth(200)
      .setVisible(false);

    this._inputText = this.add.text(16, H - 14, '> ', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      color: '#60a5fa',
    }).setOrigin(0, 0.5).setDepth(201).setVisible(false);

    this._inputBuffer = '';

    // ── Player count (top right) ──
    this._onlineText = this.add.text(W - 12, 12, '● 1 online', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color: '#4ade80',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(200);

    // ── Controls hint (bottom right) ──
    this._hintText = this.add.text(W - 12, H - 12,
      'WASD/↑↓←→ move  ·  Enter chat  ·  ESC exit', {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '10px',
        color: '#64748b',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(1, 1).setDepth(200);

    // ── Keyboard: Enter opens chat, typing populates buffer, Enter sends ──
    this.input.keyboard.on('keydown', this._handleKey.bind(this));

    // ── Listen for data updates via registry ──
    this.registry.events.on('changedata-chatMessages', (_parent, messages) => {
      this._messages = messages;
      this._renderChat();
    });

    this.registry.events.on('changedata-onlineCount', (_parent, count) => {
      this._onlineText.setText(`● ${count} online`);
    });

    // Resize handler
    this.scale.on('resize', (size) => this._onResize(size.width, size.height));
  }

  _handleKey(event) {
    if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.ENTER) {
      if (!this._chatOpen) {
        this._openChat();
      } else {
        this._sendChat();
      }
      return;
    }

    if (!this._chatOpen) return;

    if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.ESC) {
      this._closeChat();
      return;
    }

    if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.BACKSPACE) {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
    } else if (event.key.length === 1 && this._inputBuffer.length < 280) {
      this._inputBuffer += event.key;
    }

    this._inputText.setText('> ' + this._inputBuffer);
  }

  _openChat() {
    this._chatOpen = true;
    this._inputBg.setVisible(true);
    this._inputText.setVisible(true);
    this._inputBuffer = '';
    this._inputText.setText('> ');

    // Pause player input while typing
    const worldScene = this.scene.get('AurisarWorld');
    if (worldScene?.input?.keyboard) {
      worldScene.input.keyboard.enabled = false;
    }
  }

  _closeChat() {
    this._chatOpen = false;
    this._inputBg.setVisible(false);
    this._inputText.setVisible(false);
    this._inputBuffer = '';

    const worldScene = this.scene.get('AurisarWorld');
    if (worldScene?.input?.keyboard) {
      worldScene.input.keyboard.enabled = true;
    }
  }

  _sendChat() {
    const text = this._inputBuffer.trim();
    if (text) {
      const sendChat = this.registry.get('sendChat');
      if (sendChat) {
        // Determine message type based on content
        const msgType = text.startsWith('/w ') ? 'world' : 'proximity';
        sendChat(text.replace(/^\/w /, ''), msgType);
      }
    }
    this._closeChat();
  }

  _renderChat() {
    // Get local player position for proximity filtering
    const worldScene = this.scene.get('AurisarWorld');
    const localX = worldScene?._localPlayer?.x ?? 0;
    const localY = worldScene?._localPlayer?.y ?? 0;

    const visible = this._messages
      .filter(msg => {
        if (msg.msgType === 'world') return true;
        const dx = msg.x - localX;
        const dy = msg.y - localY;
        return Math.sqrt(dx * dx + dy * dy) <= PROXIMITY_RADIUS;
      })
      .slice(-8)   // last 8 messages
      .map(msg => {
        const prefix = msg.msgType === 'emote' ? '* ' : '';
        return `[${msg.senderName}] ${prefix}${msg.text}`;
      })
      .join('\n');

    this._chatLog.setText(visible);
  }

  _onResize(W, H) {
    this._chatBg.setPosition(8, H - 8);
    this._chatLog.setPosition(16, H - 40);
    this._inputBg.setPosition(8, H - 8);
    this._inputText.setPosition(16, H - 14);
    this._onlineText.setPosition(W - 12, 12);
    this._hintText.setPosition(W - 12, H - 12);
  }
}
