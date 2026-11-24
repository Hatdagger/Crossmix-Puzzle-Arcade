// ARSENAL: Battle Blocks X style, on the Brick engine.
// Every single-line clear turns one random brick in your stack into a weapon letter. Clearing
// the letter's row collects it, one copy per line in that clear. Weapons queue in 8 slots and are
// used strictly in order: C fires the front weapon at player 1, D at player 2 (the same buttons
// for both players), Select throws the front one away. Up is hard drop; there's no hold.
// Swap trades whole games with the other player (local play only).
// Arsenal vs Arsenal sends no garbage at all; in mixed matches 2/3/4 lines send 0/1/2 units.
// Modern features follow the design doc's checklist (ticked = removed).
(function (G) {
  'use strict';

  var B = G.BRICK, COLS = B.COLS, ROWS = B.ROWS, HIDDEN = B.HIDDEN, CELL = B.CELL;
  var SETTINGS = {
    hold: false, preview: 1, ghost: true, hardDrop: true, dDrop: false, fastSoft: true, srs: true, bag: true,
    lockResets: false, tspin: false, b2b: false, combo: false, allClear: false, cancel: false, garbageDelay: true
  };
  var SLOTS = 8;
  var MIXED_SEND = [0, 0, 0, 1, 2];
  // How often each weapon is rolled.
  var WEIGHT = { add: 3, remove: 2, fast: 2, slow: 2, flip: 2, gravity: 2, wipe: 0.6, empty: 1, swap: 1 };
  var LETTER = { wipe: 'C', empty: 'E', add: 'A', remove: 'R', fast: 'U', slow: 'D', gravity: 'G', flip: 'F', swap: 'S' };
  var SHORT = { wipe: 'CLEAR', empty: 'EMPTY', add: '+LINE', remove: '-LINE', fast: 'FAST', slow: 'SLOW', gravity: 'GRAV', flip: 'FLIP', swap: 'SWAP' };
  // Good on yourself (the CPU fires these at itself) vs good on the opponent.
  var SELF = { wipe: 1, remove: 1, slow: 1, gravity: 1 };

  function isLetter(c) { return typeof c === 'string' && c.charAt(0) === 'W'; }
  function weaponOf(c) { return c.slice(2); }

  function Arsenal(opts) {
    G.Brick.call(this, Object.assign({}, opts, { settings: SETTINGS, cpuLevel: 0 }));
    this.inv = []; this.opp = null; this.noUnits = false; this.thrown = 0;
    if (opts.cpuLevel) { this.cpu = new G.BrickCPU(this, opts.cpuLevel, cpuBonus); this.cpuLevel = opts.cpuLevel; this.cpuT = 1500; this.holdT = 0; }
  }
  var P = Arsenal.prototype = Object.create(G.Brick.prototype);
  P.constructor = Arsenal;
  P.isArsenal = true;
  P.fxEmpty = function () { this.inv = []; };
  // The match tells us who we're up against (weapons that mean nothing to them aren't rolled).
  P.setOpponent = function (o) { this.opp = o || null; this.noUnits = !!(o && o.isArsenal); };

  // Every weapon can be rolled (only Swap is left out over the LAN). One the opponent's puzzle
  // can't take shows a red X: hold it (some still help on yourself) or throw it away.
  P.rollWeapon = function () {
    var self = this, pool = [], tot = 0;
    G.WEAPONS.forEach(function (w) { if (!(w === 'swap' && self.opts.net)) { pool.push(w); tot += WEIGHT[w]; } });
    var x = this.rng() * tot;
    for (var i = 0; i < pool.length; i++) { x -= WEIGHT[pool[i]]; if (x < 0) return pool[i]; }
    return pool[0];
  };
  P.worksOnOpp = function (w) { return !!(this.opp && !this.opp.dead && this.opp.takes(w, this)); };
  P.placeLetter = function () {
    var cells = [];
    for (var y = HIDDEN; y < ROWS; y++) for (var x = 0; x < COLS; x++) { var c = this.grid[y][x]; if (c && !isLetter(c)) cells.push([y, x]); }
    if (!cells.length) return;
    var pick = cells[Math.floor(this.rng() * cells.length)];
    this.grid[pick[0]][pick[1]] = 'W:' + this.rollWeapon();
  };

  P.clearLines = function () {
    var found = [], self = this;
    for (var y = 0; y < ROWS; y++) if (this.grid[y].every(function (c) { return c; })) this.grid[y].forEach(function (c) { if (isLetter(c)) found.push(weaponOf(c)); });
    var n = G.Brick.prototype.clearLines.call(this);
    var got = 0, lost = 0;
    found.forEach(function (w) { for (var i = 0; i < n; i++) { if (self.inv.length < SLOTS) { self.inv.push(w); got++; } else lost++; } });
    if (got) { this.say('+' + got + ' ' + (got === 1 ? SHORT[found[0]] : 'WEAPONS'), G.PAL.yellow); G.sfx && G.sfx('hold', this.opts.side); }
    if (lost) this.say('FULL! ' + lost + ' LOST', G.PAL.grey);
    if (n === 1) this.placeLetter();
    return n;
  };
  P.scoreClear = function (n) {
    this.lines += n;
    var NAMES = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD!'];
    if (n >= 4) this.mark('big');
    if (NAMES[n]) this.say(NAMES[n], G.PAL.cyan);
    G.sfx && G.sfx(n >= 4 ? 'big' : 'clear', this.opts.side);
    if (!this.noUnits) this.send(MIXED_SEND[Math.min(4, n)]);
  };

  // Fire the front weapon at yourself or at the other player.
  P.fire = function (atSelf) {
    if (!this.inv.length) { G.sfx && G.sfx('bad', this.opts.side); return; }
    var w = this.inv.shift();
    if (atSelf) {
      if (w === 'swap') { this.say('NO EFFECT', G.PAL.grey); return; }
      this.applyWeapon(w, this);
    } else {
      // Locally an X'd weapon stays put; over the LAN it fires (the other PC shows IMMUNE) so both PCs stay in step.
      if (!this.opts.net && !this.worksOnOpp(w)) { this.inv.unshift(w); this.say('NO EFFECT ON THEM', G.PAL.grey); G.sfx && G.sfx('bad', this.opts.side); return; }
      this.hit(w);
    }
  };
  P.discard = function () { if (this.inv.length) { this.inv.shift(); this.thrown++; G.sfx && G.sfx('back', this.opts.side); } };

  P.update = function (dt, pad) {
    if (!this.dead) {
      // C = player 1, D = player 2, for both players: on the left side C is yourself.
      var left = this.opts.side === 0;
      if (pad.pressed('c')) this.fire(left);
      if (pad.pressed('d')) this.fire(!left);
      if (pad.pressed('select')) this.discard();
      if (this.cpu) this.cpuWeapons(dt);
    }
    G.Brick.prototype.update.call(this, dt, pad);
  };

  // ---------- CPU: when to fire ----------
  function stackInfo(t) {
    var maxH = 0, holes = 0;
    for (var x = 0; x < COLS; x++) {
      var seen = false;
      for (var y = 0; y < ROWS; y++) { if (t.grid[y][x]) { if (!seen) { maxH = Math.max(maxH, ROWS - y); seen = true; } } else if (seen) holes++; }
    }
    return { maxH: maxH, holes: holes };
  }
  P.cpuWeapons = function (dt) {
    this.cpuT -= dt;
    if (this.cpuT > 0 || !this.inv.length) return;
    this.cpuT = 500 + (9 - this.cpuLevel) * 180;
    var w = this.inv[0], me = stackInfo(this), opp = this.opp;
    this.holdT += dt;
    var use = null;   // 'self', 'opp', 'throw' or null (keep it for now)
    if (w === 'wipe') use = me.maxH > 13 ? 'self' : null;
    else if (w === 'remove') use = me.maxH > 3 ? 'self' : null;
    else if (w === 'gravity') use = me.holes > 2 ? 'self' : (this.holdT > 6000 ? 'throw' : null);
    else if (w === 'slow') use = this.speedLv > -2 ? 'self' : 'throw';
    else if (w === 'empty') use = this.worksOnOpp(w) && ((opp.inv && opp.inv.length) || (opp.stars && opp.stars() >= 2)) ? 'opp' : (this.holdT > 4000 || !this.worksOnOpp(w) ? 'throw' : null);
    else if (w === 'swap') use = !this.worksOnOpp(w) ? 'throw' : me.maxH > 11 ? 'opp' : (this.holdT > 6000 ? 'throw' : null);   // trade away a bad board
    else use = this.worksOnOpp(w) ? 'opp' : 'throw';
    // weaker CPUs sometimes waste one
    if (use && this.rng() < 0.25 - this.cpuLevel * 0.03) use = 'throw';
    if (!use) { if (this.inv.length >= SLOTS && this.holdT > 3000) use = SELF[w] ? 'self' : 'throw'; else return; }
    this.holdT = 0;
    if (use === 'throw') this.discard(); else this.fire(use === 'self');
  };
  // The CPU likes clearing rows with letters in them.
  function cpuBonus(t, cells, lines) { return lines ? lines * 0.3 : 0; }

  // ---------- drawing ----------
  P.drawExtras = function (fx, fy) {
    for (var y = HIDDEN; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
      var c = this.grid[y][x];
      if (!isLetter(c)) continue;
      var px = fx + x * CELL, py = fy + (y - HIDDEN) * CELL, w = weaponOf(c);
      G.rect(px, py, CELL, CELL, '#000');
      G.rect(px + 1, py + 1, CELL - 2, CELL - 2, SELF[w] ? '#bfefff' : '#ffd0a0');
      G.text(LETTER[w], px + 4, py + 1, '#000', { font: 'small', align: 'center' });
    }
  };
  P.drawStats = function (x, fy) {
    var left = this.opts.side === 0;
    G.text('ARMS', x + 18, fy, G.PAL.beige, { font: 'small', align: 'center' });
    for (var i = 0; i < SLOTS; i++) {
      var sy = fy + 9 + i * 15, w = this.inv[i];
      G.rect(x + 6, sy, 24, 13, i === 0 ? G.PAL.amber : G.PAL.steelLo);
      G.rect(x + 7, sy + 1, 22, 11, G.PAL.ink);
      if (!w) continue;
      G.text(LETTER[w], x + 18, sy + 3, i === 0 ? G.PAL.yellow : (SELF[w] ? G.PAL.cyan : G.PAL.orange), { font: 'small', align: 'center' });
      if (!this.worksOnOpp(w)) {   // red X: no effect on the opponent's puzzle
        var ctx = G.ctxRef(); ctx.strokeStyle = G.PAL.red; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(x + 9, sy + 3); ctx.lineTo(x + 27, sy + 10); ctx.moveTo(x + 27, sy + 3); ctx.lineTo(x + 9, sy + 10); ctx.stroke();
      }
    }
    // the front weapon in words, and which button sends it where
    var rx = x + 140;
    G.text('LINES', rx, fy + 36, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.lines), rx, fy + 44, G.PAL.amber, 'center');
    if (this.inv.length) {
      G.text('FIRE', rx, fy + 66, G.PAL.beige, { font: 'small', align: 'center' });
      G.text(SHORT[this.inv[0]], rx, fy + 75, this.worksOnOpp(this.inv[0]) ? G.PAL.yellow : G.PAL.red, { font: 'small', align: 'center' });
      G.text(left ? 'C ME' : 'C 1P', rx, fy + 90, G.PAL.grey, { font: 'small', align: 'center' });
      G.text(left ? 'D 2P' : 'D ME', rx, fy + 99, G.PAL.grey, { font: 'small', align: 'center' });
    }
  };

  G.registerTrack('arsenal', {
    name: 'ARSENAL', blurb: 'CLEAR LETTERS, FIRE WEAPONS', color: '#ffb21e',
    make: function (opts) { return new Arsenal(opts); }
  });
})(globalThis.G = globalThis.G || {});
