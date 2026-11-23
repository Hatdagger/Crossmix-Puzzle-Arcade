// BRICK: modern falling blocks, from SPACBRACK's brick race (tetris branch).
// Power Brick, Climb and Arsenal will reuse this engine with different SETTINGS switches
// (see the modern feature checklist in the design doc).
(function (G) {
  'use strict';

  var COLS = 10, ROWS = 22, HIDDEN = 2, CELL = 8;

  // ---------- pieces ----------
  var PIECES = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }
  };
  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  var SHAPES = {};
  TYPES.forEach(function (t) {
    var p = PIECES[t], states = [], cur = p.cells;
    for (var r = 0; r < 4; r++) { states.push(cur); cur = cur.map(function (c) { return [p.n - 1 - c[1], c[0]]; }); }
    SHAPES[t] = states;
  });
  // SRS wall kicks (y-up values from the usual tables, flipped to y-down when used).
  var K = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  var KI = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };
  function kicks(type, from, to) {
    var t = (type === 'I' ? KI : K)[from + '>' + to] || [[0, 0]];
    return t.map(function (k) { return [k[0], -k[1]]; });
  }
  // SPACBRACK's VHS-box palette (deliberately not the familiar guideline colours).
  var COLORS = { I: '#ff3fa4', J: '#2fe0ff', L: '#ffdc2e', O: '#ff8a1e', S: '#9d4dff', T: '#a6ff3a', Z: '#ff3b47', G: '#4a4858' };

  // ---------- settings: one switch per modern feature ----------
  var MODERN = {
    hold: true, preview: 5, ghost: true, hardDrop: true, fastSoft: true, srs: true, bag: true,
    lockResets: true, tspin: true, b2b: true, combo: true, allClear: true, cancel: true, garbageDelay: true
  };
  G.BRICK_MODERN = MODERN;

  var LINE_ATTACK = [0, 0, 1, 2, 4];
  var COMBO = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
  var GRAV = [1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 18, 11, 7];  // ms per row by level
  var DAS = 167, ARR = 33, LOCK_MS = 500, MAX_RESETS = 15, GARBAGE_DELAY = 1000, MAX_GARBAGE_LAND = 8;

  function emptyRow() { return new Array(COLS).fill(null); }

  function Brick(opts) {
    this.initBase(opts);
    this.s = Object.assign({}, MODERN, opts.settings || {});
    this.cancelOn = this.s.cancel;
    this.grid = []; for (var y = 0; y < ROWS; y++) this.grid.push(emptyRow());
    this.queue = []; this.bag = [];
    this.holdType = null; this.holdUsed = false;
    this.lines = 0; this.combo = -1; this.b2bOn = false;
    this.elapsed = 0; this.gravT = 0; this.lockT = 0; this.resets = 0;
    this.dasDir = 0; this.dasT = 0; this.arrT = 0;
    this.lastRot = false; this.lastKick = 0;
    this.clearRows = []; this.clearT = 0;
    this.pieceId = 0;
    this.fillQueue(); this.spawn();
    if (opts.cpuLevel) this.cpu = new BrickCPU(this, opts.cpuLevel);
  }
  var P = Brick.prototype;
  Object.assign(P, G.TrackBase);

  P.randomType = function () {
    if (this.s.bag) {
      if (!this.bag.length) {
        this.bag = TYPES.slice();
        for (var i = this.bag.length - 1; i > 0; i--) { var j = Math.floor(this.rng() * (i + 1)); var t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t; }
      }
      return this.bag.pop();
    }
    return TYPES[Math.floor(this.rng() * 7)];
  };
  P.fillQueue = function () { while (this.queue.length < 6) this.queue.push(this.randomType()); };
  P.cells = function (type, rot, x, y) { return SHAPES[type][rot].map(function (c) { return [x + c[0], y + c[1]]; }); };
  P.collides = function (type, rot, x, y, grid) {
    grid = grid || this.grid;
    var sh = SHAPES[type][rot];
    for (var i = 0; i < 4; i++) {
      var cx = x + sh[i][0], cy = y + sh[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && grid[cy][cx]) return true;
    }
    return false;
  };
  P.spawn = function (type) {
    type = type || this.queue.shift();
    this.fillQueue();
    var x = type === 'O' ? 4 : 3;
    this.piece = { type: type, rot: 0, x: x, y: 0 };
    this.pieceId++;
    this.gravT = 0; this.lockT = 0; this.resets = 0; this.lastRot = false;
    this.lowest = 0;
    if (this.collides(type, 0, x, 0)) {
      if (!this.collides(type, 0, x, -1)) this.piece.y = -1;
      else this.die();
    }
  };
  P.die = function () { if (!this.dead) { this.dead = true; G.sfx && G.sfx('ko', this.opts.side); } };
  P.onGround = function () { var p = this.piece; return this.collides(p.type, p.rot, p.x, p.y + 1); };
  P.touched = function () {
    if (this.s.lockResets && this.onGround() && this.resets < MAX_RESETS) { this.lockT = 0; this.resets++; }
  };
  P.move = function (dx) {
    var p = this.piece;
    if (this.collides(p.type, p.rot, p.x + dx, p.y)) return false;
    p.x += dx; this.lastRot = false; this.touched(); G.sfx && G.sfx('move', this.opts.side); return true;
  };
  P.rotate = function (dir) {
    var p = this.piece;
    if (p.type === 'O') return false;
    var to = (p.rot + (dir > 0 ? 1 : 3)) % 4;
    var ks = this.s.srs ? kicks(p.type, p.rot, to) : [[0, 0]];
    for (var i = 0; i < ks.length; i++) {
      var nx = p.x + ks[i][0], ny = p.y + ks[i][1];
      if (!this.collides(p.type, to, nx, ny)) {
        p.x = nx; p.y = ny; p.rot = to; this.lastRot = true; this.lastKick = i; this.touched();
        G.sfx && G.sfx('rotate', this.opts.side);
        return true;
      }
    }
    return false;
  };
  P.ghostY = function () { var p = this.piece, y = p.y; while (!this.collides(p.type, p.rot, p.x, y + 1)) y++; return y; };
  P.hardDrop = function () { this.piece.y = this.ghostY(); G.sfx && G.sfx('hard', this.opts.side); this.lock(); };
  P.hold = function () {
    if (!this.s.hold || this.holdUsed) return;
    var cur = this.piece.type;
    if (this.holdType) { var h = this.holdType; this.holdType = cur; this.spawn(h); }
    else { this.holdType = cur; this.spawn(); }
    this.holdUsed = true;
    G.sfx && G.sfx('hold', this.opts.side);
  };
  P.level = function () { return Math.min(GRAV.length, 1 + Math.floor(this.elapsed / 60000)); };
  P.speedMul = 1;   // weapons / powers will change this later
  P.gravityMs = function () { return GRAV[this.level() - 1] / this.speedMul; };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    if (this.clearT > 0) this.clearT -= dt;
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);

    if (pad.pressed('a')) this.rotate(-1);
    if (pad.pressed('b')) this.rotate(1);
    if (pad.pressed('c')) this.hold();
    if (this.s.hardDrop && (pad.pressed('d') || pad.pressed('up'))) { this.hardDrop(); return; }

    // Sideways movement with DAS / ARR.
    var L = pad.down('left'), R = pad.down('right');
    if (pad.pressed('left')) { this.dasDir = -1; this.dasT = 0; this.arrT = 0; this.move(-1); }
    else if (pad.pressed('right')) { this.dasDir = 1; this.dasT = 0; this.arrT = 0; this.move(1); }
    if ((this.dasDir < 0 && !L) || (this.dasDir > 0 && !R)) { this.dasDir = L ? -1 : R ? 1 : 0; this.dasT = 0; }
    if (this.dasDir) {
      this.dasT += dt;
      if (this.dasT >= DAS) {
        this.arrT += dt;
        while (this.arrT >= ARR) { this.arrT -= ARR; if (!this.move(this.dasDir)) { this.arrT = 0; break; } }
      }
    }

    // Gravity and soft drop.
    var soft = pad.down('down');
    var interval = this.gravityMs();
    if (soft) interval = Math.min(interval, this.s.softMs || (this.s.fastSoft ? 50 : 100));
    // Starting a soft drop must not cash in the gravity time already built up (that made Down act like a hard drop).
    if (soft && !this.wasSoft) this.gravT = Math.min(this.gravT, interval);
    this.wasSoft = soft;
    this.gravT += dt;
    while (this.gravT >= interval) {
      this.gravT -= interval;
      if (!this.onGround()) {
        this.piece.y++; this.lastRot = false;
        if (this.piece.y > this.lowest) { this.lowest = this.piece.y; this.resets = 0; }
      } else { this.gravT = 0; break; }
    }
    if (this.onGround()) {
      this.lockT += dt;
      if (this.lockT >= LOCK_MS) this.lock();
    } else this.lockT = 0;
  };

  P.tspinKind = function () {
    var p = this.piece;
    if (!this.s.tspin || p.type !== 'T' || !this.lastRot) return 0;
    var g = this.grid, x = p.x, y = p.y;
    function filled(cx, cy) { return cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && !!g[cy][cx]); }
    var c = [filled(x, y), filled(x + 2, y), filled(x + 2, y + 2), filled(x, y + 2)];   // TL TR BR BL
    var n = c.filter(Boolean).length;
    if (n < 3) return 0;
    var front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
    var f = (c[front[0]] ? 1 : 0) + (c[front[1]] ? 1 : 0);
    return (f < 2 && this.lastKick !== 4) ? 1 : 2;   // 1 = mini, 2 = full
  };

  P.lock = function () {
    var p = this.piece, self = this, allHidden = true;
    var ts = this.tspinKind();
    this.cells(p.type, p.rot, p.x, p.y).forEach(function (c) {
      if (c[1] >= 0) self.grid[c[1]][c[0]] = p.type;
      if (c[1] >= HIDDEN) allHidden = false;
    });
    G.sfx && G.sfx('lock', this.opts.side);
    var n = this.clearLines();
    if (n > 0) this.scoreClear(n, ts);
    else {
      this.combo = -1;
      if (ts) this.say(ts === 2 ? 'T-SPIN' : 'MINI T-SPIN', G.PAL.violet);
      this.landGarbage();
    }
    if (allHidden && n === 0) { this.die(); return; }
    if (this.dead) return;
    this.holdUsed = false;
    this.spawn();
  };

  P.clearLines = function () {
    var n = 0, rows = [];
    for (var y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every(function (c) { return c; })) {
        rows.push(y - n);   // original row index (rows above shift down as lines clear)
        this.grid.splice(y, 1); this.grid.unshift(emptyRow()); n++; y++;
      }
    }
    if (n) { this.clearRows = rows; this.clearT = 200; }
    return n;
  };

  P.scoreClear = function (n, ts) {
    this.lines += n;
    var atk, label;
    var NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];
    if (ts === 2) { atk = n * 2; label = 'T-SPIN ' + NAMES[n]; }
    else if (ts === 1) { atk = n >= 2 ? 1 : 0; label = 'MINI T-SPIN ' + NAMES[n]; }
    else { atk = LINE_ATTACK[n]; label = n >= 4 ? 'QUAD!' : n >= 2 ? NAMES[n] : ''; }
    var difficult = n >= 4 || ts > 0;
    if (difficult) {
      if (this.b2bOn && this.s.b2b) { atk += 1; label = 'B2B ' + label; }
      this.b2bOn = true;
    } else this.b2bOn = false;
    this.combo++;
    if (this.s.combo && this.combo > 0) {
      atk += COMBO[Math.min(this.combo, COMBO.length - 1)];
      this.say(this.combo + ' COMBO', G.PAL.yellow);
    }
    var empty = this.grid.every(function (r) { return r.every(function (c) { return !c; }); });
    if (empty && this.s.allClear) { atk += 10; this.say('ALL CLEAR!', G.PAL.green); }
    if (label) this.say(label, ts ? G.PAL.violet : G.PAL.cyan);
    G.sfx && G.sfx(n >= 4 || ts ? 'big' : 'clear', this.opts.side);
    this.send(atk);
  };

  P.landGarbage = function () {
    var batches = this.takeReady(this.s.garbageDelay ? GARBAGE_DELAY : 0, MAX_GARBAGE_LAND);
    if (!batches.length) return;
    var self = this;
    batches.forEach(function (b) {
      var hole = b.gap % COLS;
      for (var i = 0; i < b.n; i++) {
        var top = self.grid.shift();
        if (top.some(function (c) { return c; })) self.die();
        var row = new Array(COLS).fill('G'); row[hole] = null;
        self.grid.push(row);
      }
    });
    G.sfx && G.sfx('garbage', this.opts.side);
  };

  // ---------- drawing (a 160 x 194 half) ----------
  function mini(type, x, y, size) {
    var sh = SHAPES[type][0], n = PIECES[type].n;
    var w = n * size, ox = x - Math.floor(w / 2), oy = y - (type === 'I' ? size * 1.5 : size);
    sh.forEach(function (c) { G.brick(ox + c[0] * size, oy + c[1] * size, size, COLORS[type]); });
  }
  P.draw = function (x, y) {
    var fx = x + 40, fy = y + 18, fw = COLS * CELL, fh = (ROWS - HIDDEN) * CELL;
    // frame
    G.rect(fx - 3, fy - 3, fw + 6, fh + 6, G.PAL.steelHi);
    G.rect(fx - 2, fy - 2, fw + 4, fh + 4, G.PAL.steelLo);
    G.rect(fx, fy, fw, fh, '#0a0912');
    for (var gx = 1; gx < COLS; gx++) G.rect(fx + gx * CELL, fy, 1, fh, '#13111f');
    // stack
    for (var ry = HIDDEN; ry < ROWS; ry++) for (var cx = 0; cx < COLS; cx++) {
      var c = this.grid[ry][cx];
      if (c) G.brick(fx + cx * CELL, fy + (ry - HIDDEN) * CELL, CELL, COLORS[c]);
    }
    if (this.clearT > 0) {
      var a = this.clearT / 200, ctx = G.ctxRef();
      ctx.globalAlpha = a;
      for (var k = 0; k < this.clearRows.length; k++) {
        var yy = this.clearRows[k] - HIDDEN;
        G.rect(fx, fy + Math.max(0, yy) * CELL, fw, CELL, '#ffffff');
      }
      ctx.globalAlpha = 1;
    }
    if (this.drawExtras) this.drawExtras(fx, fy);
    if (!this.dead && this.piece) {
      var p = this.piece, self = this;
      if (this.s.ghost) {
        var gy = this.ghostY();
        this.cells(p.type, p.rot, p.x, gy).forEach(function (c) {
          if (c[1] < HIDDEN) return;
          var px = fx + c[0] * CELL, py = fy + (c[1] - HIDDEN) * CELL;
          G.rect(px, py, CELL, 1, COLORS[p.type]); G.rect(px, py + CELL - 1, CELL, 1, COLORS[p.type]);
          G.rect(px, py, 1, CELL, COLORS[p.type]); G.rect(px + CELL - 1, py, 1, CELL, COLORS[p.type]);
        });
      }
      this.cells(p.type, p.rot, p.x, p.y).forEach(function (c) {
        if (c[1] >= HIDDEN) G.brick(fx + c[0] * CELL, fy + (c[1] - HIDDEN) * CELL, CELL, COLORS[p.type]);
      });
      void self;
    }
    // hold
    if (this.s.hold) {
      G.text('HOLD', x + 18, fy, G.PAL.beige, { font: 'small', align: 'center' });
      G.rect(x + 4, fy + 8, 28, 20, G.PAL.ink);
      if (this.holdType) mini(this.holdType, x + 18, fy + 18, 6);
    }
    // next
    var nPrev = this.s.preview;
    G.text('NEXT', x + 140, fy, G.PAL.beige, { font: 'small', align: 'center' });
    for (var i = 0; i < nPrev; i++) {
      var sz = i === 0 ? 6 : 4, cy2 = fy + 18 + (i === 0 ? 0 : 6 + i * 16);
      if (i === 0) G.rect(x + 126, fy + 8, 28, 20, G.PAL.ink);
      mini(this.queue[i], x + 140, cy2, sz);
    }
    // incoming bar
    this.drawPendingBar(fx - 7, fy, fh, CELL, this.s.garbageDelay ? GARBAGE_DELAY : 0);
    // stats
    if (this.drawStats) this.drawStats(x, fy);
    else {
    G.text('LINES', x + 18, fy + 120, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.lines), x + 18, fy + 128, G.PAL.amber, 'center');
    G.text('LEVEL', x + 18, fy + 144, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.level()), x + 18, fy + 152, G.PAL.green, 'center');
    }
    this.drawFlash(fx + fw / 2, fy + 70);
    if (this.dead) { var c2 = G.ctxRef(); c2.globalAlpha = 0.55; G.rect(fx, fy, fw, fh, '#000'); c2.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  var LEVELS = {
    1: { think: 660, step: 160, mistake: 0.30 }, 2: { think: 560, step: 140, mistake: 0.25 },
    3: { think: 430, step: 120, mistake: 0.20 }, 4: { think: 390, step: 100, mistake: 0.15 },
    5: { think: 320, step: 90, mistake: 0.10 }, 6: { think: 260, step: 80, mistake: 0.07 },
    7: { think: 200, step: 60, mistake: 0.04 }, 8: { think: 130, step: 50, mistake: 0.02 }
  };
  function evaluate(grid) {
    var heights = [], holes = 0, agg = 0, bump = 0;
    for (var x = 0; x < COLS; x++) {
      var h = 0, seen = false;
      for (var y = 0; y < ROWS; y++) { if (grid[y][x]) { if (!seen) { h = ROWS - y; seen = true; } } else if (seen) holes++; }
      heights.push(h); agg += h;
    }
    for (var i = 0; i < COLS - 1; i++) bump += Math.abs(heights[i] - heights[i + 1]);
    return { agg: agg, holes: holes, bump: bump, maxH: Math.max.apply(null, heights) };
  }
  function placements(t, bonus) {
    var p = t.piece, out = [], rots = p.type === 'O' ? [0] : [0, 1, 2, 3];
    rots.forEach(function (rot) {
      for (var x = -3; x < COLS; x++) {
        if (t.collides(p.type, rot, x, p.y)) continue;
        var y = p.y; while (!t.collides(p.type, rot, x, y + 1)) y++;
        var grid = t.grid.map(function (r) { return r.slice(); }), above = true;
        t.cells(p.type, rot, x, y).forEach(function (c) { if (c[1] >= 0) grid[c[1]][c[0]] = p.type; if (c[1] >= HIDDEN) above = false; });
        if (above) continue;
        var lines = 0;
        for (var yy = ROWS - 1; yy >= 0; yy--) if (grid[yy].every(function (c) { return c; })) { grid.splice(yy, 1); grid.unshift(emptyRow()); lines++; yy++; }
        var e = evaluate(grid);
        var lineW = e.maxH > 14 ? 1.5 : 0.76;
        var extra = bonus ? bonus(t, t.cells(p.type, rot, x, y), lines, e) : 0;
        out.push({ rot: rot, x: x, score: -0.51 * e.agg + lineW * lines - 0.36 * e.holes - 0.18 * e.bump + extra });
      }
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }
  function BrickCPU(track, level, bonus) {
    this.t = track; this.bonus = bonus; this.cfg = LEVELS[Math.max(1, Math.min(8, level))];
    this.seen = -1; this.wait = 0; this.tap = null; this.plan = null; this.fails = 0;
  }
  BrickCPU.prototype.drive = function (dt, pad) {
    var t = this.t, st = {};
    // Tracks with moving obstacles (Climb's professor) ask for a fresh plan every so often.
    if (t.cpuReplan && t.pieceId === this.seen && (this.since = (this.since || 0) + dt) > 600) { this.since = 0; this.seen = -2; }
    if (t.pieceId !== this.seen) {
      var fresh = this.seen !== -2;
      // The CPU has its own dice, so it never changes the track's piece order (Climb races need identical pieces).
      this.seen = t.pieceId; if (fresh) { this.wait = this.cfg.think * (0.7 + Math.random() * 0.6); this.since = 0; }
      var list = placements(t, this.bonus), pick = list[0];
      if (!pick) { this.plan = null; pad.feed(st, dt); return; }
      if (list.length > 1 && Math.random() < this.cfg.mistake) pick = list[Math.min(list.length - 1, 1 + Math.floor(Math.random() * 3))];
      this.plan = pick; if (fresh) this.fails = 0;
    }
    if (this.tap) { this.tap = null; pad.feed(st, dt); return; }   // release between taps
    this.wait -= dt;
    if (this.wait > 0 || !this.plan) { pad.feed(st, dt); return; }
    var p = t.piece, plan = this.plan;
    if (p.rot !== plan.rot && this.fails < 6) { st.b = true; this.fails++; }
    else if (p.x !== plan.x && this.fails < 30) { st[p.x < plan.x ? 'right' : 'left'] = true; this.fails++; }
    else if (t.cpuWait && t.cpuWait(plan)) { pad.feed(st, dt); return; }   // e.g. Climb: let the professor walk clear first
    else if (t.s.hardDrop) st.d = true;
    else { st.down = true; pad.feed(st, dt); return; }
    this.tap = true; this.wait = this.cfg.step;
    pad.feed(st, dt);
  };

  G.registerTrack('brick', {
    name: 'BRICK', blurb: 'MODERN FALLING BLOCKS', color: '#ff3fa4',
    make: function (opts) { return new Brick(opts); }
  });
  G.Brick = Brick;
  G.BrickCPU = BrickCPU;
  G.BRICK = { COLS: COLS, ROWS: ROWS, HIDDEN: HIDDEN, CELL: CELL, TYPES: TYPES, SHAPES: SHAPES, PIECES: PIECES, COLORS: COLORS, GARBAGE_DELAY: GARBAGE_DELAY, emptyRow: emptyRow };
})(globalThis.G = globalThis.G || {});
