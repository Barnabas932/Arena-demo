/* Arena demo - Phaser 3 (web)
   Controls:
   - Move: WASD / Arrow keys
   - Shoot: Left click / Space
   - Dash: Shift (cooldown)
*/

const W = 960;
const H = 540;

const CONFIG = {
  playerSpeed: 230,
  dashSpeed: 720,
  dashDurationMs: 110,
  dashCooldownMs: 650,
  bulletSpeed: 650,
  bulletLifeMs: 850,
  enemySpeed: 110,
  enemySpawnMs: 900,
  enemyHp: 2,
  playerMaxHp: 10,
  hitInvulnMs: 450,
};

class GameScene extends Phaser.Scene {
  constructor() {
    super("game");
  }

  preload() {}

  create() {
    // World bounds
    this.physics.world.setBounds(0, 0, W, H);

    // Background
    this.add.rectangle(W/2, H/2, W, H, 0x101826).setDepth(-10);
    for (let i = 0; i < 60; i++) {
      const x = Phaser.Math.Between(0, W);
      const y = Phaser.Math.Between(0, H);
      const r = Phaser.Math.Between(1, 2);
      this.add.circle(x, y, r, 0x1b2a3f).setAlpha(0.9).setDepth(-9);
    }

    // Create textures (simple shapes) at runtime
    this._makeTextures();

    // Player
    this.player = this.physics.add.image(W/2, H/2, "player");
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(18, 18);
    this.player.setDrag(1200);
    this.player.setDamping(true);

    this.playerHp = CONFIG.playerMaxHp;
    this.score = 0;

    // Input
    this.keys = this.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
      up2: "UP",
      down2: "DOWN",
      left2: "LEFT",
      right2: "RIGHT",
      dash: "SHIFT",
      shoot: "SPACE",
      restart: "R",
    });

    this.pointer = this.input.activePointer;

    // Bullets group
    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 200,
      runChildUpdate: false,
    });

    // Enemies group
    this.enemies = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 200,
      runChildUpdate: false,
    });

    // Timers/state
    this.lastDashAt = -9999;
    this.dashUntil = 0;
    this.lastShotAt = 0;
    this.playerInvulnUntil = 0;

    // Spawn enemies
    this.spawnTimer = this.time.addEvent({
      delay: CONFIG.enemySpawnMs,
      loop: true,
      callback: () => this._spawnEnemy(),
    });

    // Colliders/overlaps
    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => {
      this._onBulletHitEnemy(b, e);
    });

    this.physics.add.overlap(this.player, this.enemies, (p, e) => {
      this._onPlayerTouchEnemy(p, e);
    });

    // UI
    this.uiText = this.add.text(16, 12, "", {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "16px",
      color: "#d9e3f0",
    });

    this.helpText = this.add.text(16, H - 24, "WASD/Arrows: move | Shift: dash | Click/Space: shoot", {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "14px",
      color: "#8fb1d8",
    }).setAlpha(0.85);

    // Shooting: click
    this.input.on("pointerdown", () => this._tryShoot());

    // Initial UI update
    this._updateUI();

    // Game over flag
    this.gameOver = false;
  }

  update(time, delta) {
    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) this.scene.restart();
      return;
    }

    this._movePlayer(time);
    this._enemyAI();
    this._cleanupBullets(time);

    // Space to shoot
    if (Phaser.Input.Keyboard.JustDown(this.keys.shoot)) {
      this._tryShoot();
    }

    this._updateUI();
  }

  _makeTextures() {
    // player (cyan circle)
    const g1 = this.make.graphics({ x: 0, y: 0, add: false });
    g1.fillStyle(0x3de0ff, 1);
    g1.fillCircle(16, 16, 12);
    g1.lineStyle(2, 0x0b0f14, 0.8);
    g1.strokeCircle(16, 16, 12);
    g1.generateTexture("player", 32, 32);
    g1.destroy();

    // enemy (red circle)
    const g2 = this.make.graphics({ x: 0, y: 0, add: false });
    g2.fillStyle(0xff4b4b, 1);
    g2.fillCircle(16, 16, 12);
    g2.lineStyle(2, 0x0b0f14, 0.8);
    g2.strokeCircle(16, 16, 12);
    g2.generateTexture("enemy", 32, 32);
    g2.destroy();

    // bullet (yellow)
    const g3 = this.make.graphics({ x: 0, y: 0, add: false });
    g3.fillStyle(0xffd84d, 1);
    g3.fillRect(0, 0, 10, 4);
    g3.generateTexture("bullet", 10, 4);
    g3.destroy();
  }

  _movePlayer(time) {
    // Input vector
    let vx = 0, vy = 0;
    const left = this.keys.left.isDown || this.keys.left2.isDown;
    const right = this.keys.right.isDown || this.keys.right2.isDown;
    const up = this.keys.up.isDown || this.keys.up2.isDown;
    const down = this.keys.down.isDown || this.keys.down2.isDown;

    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;

    const len = Math.hypot(vx, vy);
    if (len > 0) { vx /= len; vy /= len; }

    const canDash = (time - this.lastDashAt) >= CONFIG.dashCooldownMs;
    const dashPressed = Phaser.Input.Keyboard.JustDown(this.keys.dash);

    if (dashPressed && canDash && len > 0) {
      this.lastDashAt = time;
      this.dashUntil = time + CONFIG.dashDurationMs;
      this.player.setVelocity(vx * CONFIG.dashSpeed, vy * CONFIG.dashSpeed);
    }

    // If dashing, keep velocity until dash ends
    if (time < this.dashUntil) {
      this.player.setTint(0xb7fbff);
      return;
    } else {
      this.player.clearTint();
    }

    // Normal movement (acceleration-like feel using velocity + drag)
    const targetVx = vx * CONFIG.playerSpeed;
    const targetVy = vy * CONFIG.playerSpeed;

    // Blend current velocity toward target (smooth)
    const blend = 0.20;
    const cvx = this.player.body.velocity.x;
    const cvy = this.player.body.velocity.y;
    this.player.setVelocity(
      Phaser.Math.Linear(cvx, targetVx, blend),
      Phaser.Math.Linear(cvy, targetVy, blend)
    );
  }

  _tryShoot() {
    if (this.gameOver) return;

    const now = this.time.now;
    // Simple fire-rate limit (~10 shots/s)
    if (now - this.lastShotAt < 95) return;
    this.lastShotAt = now;

    const p = this.player;
    const mx = this.pointer.worldX ?? this.pointer.x;
    const my = this.pointer.worldY ?? this.pointer.y;

    // Direction from player to mouse (fallback: forward)
    let dx = mx - p.x;
    let dy = my - p.y;
    const dlen = Math.hypot(dx, dy) || 1;
    dx /= dlen; dy /= dlen;

    const b = this.bullets.get(p.x, p.y, "bullet");
    if (!b) return;

    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.setRotation(Math.atan2(dy, dx));
    b.setVelocity(dx * CONFIG.bulletSpeed, dy * CONFIG.bulletSpeed);
    b._bornAt = now;

    // Small muzzle offset
    b.x += dx * 18;
    b.y += dy * 18;
  }

  _cleanupBullets(time) {
    this.bullets.children.each((b) => {
      if (!b.active) return;
      if (time - (b._bornAt || 0) > CONFIG.bulletLifeMs) {
        this._killBullet(b);
      }
      // Out of bounds
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        this._killBullet(b);
      }
    });
  }

  _killBullet(b) {
    b.setActive(false).setVisible(false);
    b.body.stop();
    b.body.enable = false;
    this.bullets.killAndHide(b);
  }

  _spawnEnemy() {
    if (this.gameOver) return;

    // Spawn at edges
    const side = Phaser.Math.Between(0, 3);
    let x, y;
    if (side === 0) { x = -10; y = Phaser.Math.Between(0, H); }
    if (side === 1) { x = W + 10; y = Phaser.Math.Between(0, H); }
    if (side === 2) { x = Phaser.Math.Between(0, W); y = -10; }
    if (side === 3) { x = Phaser.Math.Between(0, W); y = H + 10; }

    const e = this.enemies.get(x, y, "enemy");
    if (!e) return;

    e.setActive(true).setVisible(true);
    e.body.enable = true;
    e.body.setCircle(12, 4, 4);
    e._hp = CONFIG.enemyHp;

    // Slight random speed variance
    e._spd = CONFIG.enemySpeed * Phaser.Math.FloatBetween(0.9, 1.2);
  }

  _enemyAI() {
    const px = this.player.x;
    const py = this.player.y;

    this.enemies.children.each((e) => {
      if (!e.active) return;
      const dx = px - e.x;
      const dy = py - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      e.setVelocity(ux * e._spd, uy * e._spd);
    });
  }

  _onBulletHitEnemy(b, e) {
    if (!b.active || !e.active) return;

    this._killBullet(b);

    e._hp = (e._hp ?? CONFIG.enemyHp) - 1;

    // small knockback
    const dx = e.x - this.player.x;
    const dy = e.y - this.player.y;
    const len = Math.hypot(dx, dy) || 1;
    e.setVelocity((dx/len) * 240, (dy/len) * 240);

    if (e._hp <= 0) {
      this._killEnemy(e);
      this.score += 10;
    } else {
      e.setTint(0xffb3b3);
      this.time.delayedCall(70, () => e.clearTint());
    }
  }

  _killEnemy(e) {
    e.setActive(false).setVisible(false);
    e.body.stop();
    e.body.enable = false;
    this.enemies.killAndHide(e);
  }

  _onPlayerTouchEnemy(p, e) {
    if (this.gameOver) return;

    const now = this.time.now;
    if (now < this.playerInvulnUntil) return;

    this.playerInvulnUntil = now + CONFIG.hitInvulnMs;
    this.playerHp -= 1;

    // pushback
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    p.setVelocity((dx/len) * 320, (dy/len) * 320);

    // flash player
    p.setTint(0xffffff);
    this.time.delayedCall(90, () => p.clearTint());

    if (this.playerHp <= 0) {
      this._gameOver();
    }
  }

  _gameOver() {
    this.gameOver = true;
    this.spawnTimer.paused = true;

    this.enemies.children.each((e) => { if (e.active) this._killEnemy(e); });
    this.bullets.children.each((b) => { if (b.active) this._killBullet(b); });

    const panel = this.add.rectangle(W/2, H/2, 520, 220, 0x0b0f14, 0.88);
    panel.setStrokeStyle(2, 0x2c3e57, 0.9);

    this.add.text(W/2, H/2 - 45, "GAME OVER", {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "44px",
      color: "#ff7a7a",
    }).setOrigin(0.5);

    this.add.text(W/2, H/2 + 10, `Score: ${this.score}`, {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "20px",
      color: "#d9e3f0",
    }).setOrigin(0.5);

    this.add.text(W/2, H/2 + 55, "Nyomd meg: R (restart)", {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "16px",
      color: "#8fb1d8",
    }).setOrigin(0.5);
  }

  _updateUI() {
    const now = this.time.now;

    const dashReady = (now - this.lastDashAt) >= CONFIG.dashCooldownMs;
    const dashTxt = dashReady ? "READY" : `${Math.ceil((CONFIG.dashCooldownMs - (now - this.lastDashAt)))}ms`;

    const invuln = now < this.playerInvulnUntil ? " (inv)" : "";
    this.uiText.setText(
      `HP: ${this.playerHp}/${CONFIG.playerMaxHp}${invuln}   |   Score: ${this.score}   |   Dash: ${dashTxt}`
    );
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: W,
  height: H,
  backgroundColor: "#0b0f14",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false,
    }
  },
  scene: [GameScene]
});
