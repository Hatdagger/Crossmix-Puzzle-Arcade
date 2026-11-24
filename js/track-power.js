// POWER BRICK: Tetris Battle Gaiden style, on the Brick engine.
// Some pieces carry a crystal in one of their bricks. Clearing lines fills the power meter
// (1 point per line, 3 more per crystal in the cleared rows); every 4 points is a star, up to 5.
// C casts the power that matches your stars and spends them all, so saving up buys a stronger one:
//   1 SHAKE  clears your own bottom 3 rows
//   2 SHIELD blocks the next batch of units coming at you
//   3 FOG    hides the top half of the other player's field for 5 s
//   4 HANDS  swaps the other player's left and right for 5 s
//   5 RUSH   the other player's game runs at double speed for 6 s
// Modern features follow the design doc's checklist (ticked = removed): no hold, ghost, hard drop,
// SRS kicks, 7-bag, lock resets, back-to-back, combo or all-clear bonus. Kept: 5 previews,
// fast soft drop, T-spins, garbage cancelling and the warning bar. Classic sends 2/3/4 = 1/2/4.
(function (G) {
  'use strict';

  var B = G.BRICK, COLS = B.COLS, ROWS = B.ROWS, HIDDEN = B.HIDDEN, CELL = B.CELL;
  var SETTINGS = {
    hold: false, preview: 5, ghost: false, hardDrop: false, fastSoft: true, srs: false, bag: false,
    lockResets: false, tspin: true, b2b: false, combo: false, allClear: false, cancel: true, garbageDelay: true
  };
  var MAX_STARS = 5, PER_STAR = 4, CRYSTAL_PTS = 3, CRYSTAL_EVERY = 4;   // about 1 piece in 4 has a crystal
  var POWERS = [null, 'shake', 'shield', 'fog', 'hands', 'rush'];
  var NAMES = { shake: 'SHAKE', shield: 'SHIELD', fog: 'FOG', hands: 'HANDS', rush: 'RUSH' };
  var ON_SELF = { shake: 1, shield: 1 };

  function isCrystal(c) { return typeof c === 'string' && c.charAt(0) === 'C' && c.length === 2; }

  function Power(opts) {
    G.Brick.call(this, Object.assign({}, opts, { settings: SETTINGS, cpuLevel: 0 }));
    this.points = 0; this.shield = 0; this.opp = null; this.casts = 0;
    if (opts.cpuLevel) { this.cpu = new G.BrickCPU(this, opts.cpuLevel, cpuBonus); this.cpuLevel = opts.cpuLevel; this.cpuT = 1500; this.holdT = 0; }
  }
  var P = Power.prototype = Object.create(G.Brick.prototype);
  P.constructor = Power;
  P.isPower = true;
  P.stars = function () { return Math.min(MAX_STARS, Math.floor(this.points / PER_STAR)); };
  P.setOpponent = function (o) { this.opp = o || null; };
  // Empty Inventory (Arsenal) wipes the meter and any shield.
  P.fxEmpty = function () { this.points = 0; this.shield = 0; };

  // A crystal rides on one brick of some pieces.
  P.spawn = function (type) {
    G.Brick.prototype.spawn.call(this, type);
    if (this.piece && !this.dead) this.piece.crystal = this.rng() < 1 / CRYSTAL_EVERY ? Math.floor(this.rng() * 4) : -1;
  };
  P.clearLines = function () {
    // the piece that just locked: mark its crystal brick in the grid
    var p = this.piece;
    if (p && p.crystal >= 0) {
      var c = this.cells(p.type, p.rot, p.x, p.y)[p.crystal];
      if (c[1] >= 0 && this.grid[c[1]][c[0]] === p.type) this.grid[c[1]][c[0]] = 'C' + p.type;
      p.crystal = -1;
    }
    var crystals = 0;
    for (var y = 0; y < ROWS; y++) if (this.grid[y].every(function (c) { return c; })) this.grid[y].forEach(function (c) { if (isCrystal(c)) crystals++; });
    var n = G.Brick.prototype.clearLines.call(this);
    if (n) {
      var before = this.stars();
      this.points = Math.min(MAX_STARS * PER_STAR, this.points + n + crystals * CRYSTAL_PTS);
      if (crystals) { this.say('+' + crystals + ' CRYSTAL' + (crystals > 1 ? 'S' : ''), G.PAL.pink); G.sfx && G.sfx('hold', this.opts.side); }
      if (this.stars() > before) this.say('POWER ' + this.stars() + ': ' + NAMES[POWERS[this.stars()]], G.PAL.yellow);
    }
    return n;
  };

  // Shield eats the next batch that arrives.
  P.receive = function (n) {
    if (n > 0 && !this.dead && this.shield) { this.shield = 0; this.say('SHIELD!', G.PAL.cyan); G.sfx && G.sfx('big', this.opts.side); return; }
    G.Brick.prototype.receive.call(this, n);
  };

  P.cast = function () {
    var st = this.stars();
    if (!st) { G.sfx && G.sfx('bad', this.opts.side); return; }
    var w = POWERS[st];
    this.points -= st * PER_STAR; this.casts++;
    this.say(NAMES[w] + '!', ON_SELF[w] ? G.PAL.cyan : G.PAL.red);
    G.sfx && G.sfx('big', this.opts.side);
    if (w === 'shake') { for (var i = 0; i < 3; i++) this.fxRemove(); }
    else if (w === 'shield') this.shield = 1;
    else this.hit(w);
  };

  P.update = function (dt, pad) {
    if (!this.dead) {
      if (pad.pressed('c')) this.cast();
      if (this.cpu) this.cpuPowers(dt);
    }
    G.Brick.prototype.update.call(this, dt, pad);
  };

  // ---------- CPU: save up, but use what's there when in trouble ----------
  function stackH(t) {
    for (var y = 0; y < ROWS; y++) if (t.grid[y].some(function (c) { return c; })) return ROWS - y;
    return 0;
  }
  P.cpuPowers = function (dt) {
    this.cpuT -= dt;
    if (this.cpuT > 0) return;
    this.cpuT = 400 + (9 - this.cpuLevel) * 150;
    var st = this.stars(), h = stackH(this), goal = 2 + Math.floor(this.cpuLevel / 3);   // level 1: 2 stars ... level 8: 4
    if (!st) return;
    if (st === 1 && h > 11) { this.cast(); return; }                      // shake when it gets tall
    if (st === 2 && !this.shield && this.pendingTotal() >= 3) { this.cast(); return; }
    if (st >= goal || st === MAX_STARS) this.cast();
  };
  function cpuBonus(t, cells, lines) { return lines ? lines * 0.25 : 0; }

  // ---------- drawing ----------
  P.drawExtras = function (fx, fy) {
    var self = this, p = this.piece;
    function gem(px, py) {
      G.rect(px + 2, py + 1, 4, 6, '#ffffff');
      G.rect(px + 1, py + 2, 6, 4, '#ffffff');
      G.rect(px + 3, py + 2, 2, 4, '#ff3fa4');
      G.rect(px + 2, py + 3, 4, 2, '#ff3fa4');
    }
    for (var y = HIDDEN; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
      var c = this.grid[y][x];
      if (!isCrystal(c)) continue;
      var px = fx + x * CELL, py = fy + (y - HIDDEN) * CELL;
      G.brick(px, py, CELL, B.COLORS[c.charAt(1)]);
      gem(px, py);
    }
    if (!this.dead && p && p.crystal >= 0) {
      var cc = this.cells(p.type, p.rot, p.x, p.y)[p.crystal];
      if (cc[1] >= HIDDEN) self._gemAt = [fx + cc[0] * CELL, fy + (cc[1] - HIDDEN) * CELL];
      else self._gemAt = null;
    } else self._gemAt = null;
  };
  // The falling piece's crystal is drawn after the piece (Brick draws the piece after drawExtras).
  P.draw = function (x, y) {
    G.Brick.prototype.draw.call(this, x, y);
    if (this._gemAt && !this.dead) {
      var px = this._gemAt[0], py = this._gemAt[1];
      G.rect(px + 2, py + 1, 4, 6, '#ffffff'); G.rect(px + 1, py + 2, 6, 4, '#ffffff');
      G.rect(px + 3, py + 2, 2, 4, '#ff3fa4'); G.rect(px + 2, py + 3, 4, 2, '#ff3fa4');
    }
  };
  P.drawStats = function (x, fy) {
    var st = this.stars();
    G.text('POWER', x + 18, fy, G.PAL.beige, { font: 'small', align: 'center' });
    for (var i = MAX_STARS; i >= 1; i--) {
      var sy = fy + 9 + (MAX_STARS - i) * 15, on = i <= st;
      G.rect(x + 4, sy, 28, 13, i === st ? G.PAL.amber : G.PAL.steelLo);
      G.rect(x + 5, sy + 1, 26, 11, on ? '#3a1630' : G.PAL.ink);
      G.text(NAMES[POWERS[i]], x + 18, sy + 3, on ? (ON_SELF[POWERS[i]] ? G.PAL.cyan : G.PAL.pink) : G.PAL.steelLo, { font: 'small', align: 'center' });
    }
    // meter: points toward the next star
    var part = st >= MAX_STARS ? PER_STAR : this.points - st * PER_STAR;
    G.rect(x + 4, fy + 88, 28, 4, G.PAL.steelLo);
    G.rect(x + 4, fy + 88, Math.round(28 * part / PER_STAR), 4, G.PAL.pink);
    if (st) G.text('C: ' + NAMES[POWERS[st]], x + 18, fy + 96, G.PAL.yellow, { font: 'small', align: 'center' });
    if (this.shield) G.text('SHIELD UP', x + 18, fy + 106, G.PAL.cyan, { font: 'small', align: 'center' });
    G.text('LINES', x + 18, fy + 120, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.lines), x + 18, fy + 128, G.PAL.amber, 'center');
    G.text('LEVEL', x + 18, fy + 144, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.level()), x + 18, fy + 152, G.PAL.green, 'center');
  };

  G.registerTrack('power', {
    name: 'POWER BRICK', blurb: 'CRYSTALS CHARGE POWERS', color: '#ff3fa4',
    make: function (opts) { return new Power(opts); }
  });
})(globalThis.G = globalThis.G || {});
