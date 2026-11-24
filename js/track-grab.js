// GRAB: Magical Drop-style grab-and-throw as a track.
// Balls hang from the ceiling of a 7x12 field and new rows push down from the top over time.
// The grabber at the bottom moves left/right. Grab (A, C or Down) pulls the lowest run of one
// colour out of the column above it; you can keep grabbing more of the same colour. Throw (B, D
// or Up) puts them back under any column. 3+ of a colour in a column clears, along with every
// ball of that colour touching them. Balls left below a gap move up and can chain.
// Clearing again soon after the last clear is a combo. Incoming units push rows in from the top.
// You lose when a row is pushed while any column already reaches the grabber.
(function (G) {
  'use strict';

  var COLS = 7, ROWS = 12, CELL = 13, NC = 5;
  var CFG = {
    pushEvery: 9000, pushMin: 2600, pushStep: 600, speedUpEvery: 20000,   // own pressure
    startRows: 5, das: 150, arr: 55,
    garbageDelay: 1200, maxGarbage: 3,                                       // units landing at once
    rowsPerUnit: G.GRAB_ROWS || 1.75,                                       // rows pushed in per unit taken
    flash: 300, settle: 130, comboWin: 1500,
    sendMul: G.GRAB_SEND || 0.35                                              // mixed-play balance (tools/sim.js)
  };
  // Original ball set: ruby diamond, sky bar, leaf plus, sun dot, grape twin dots.
  var COLORS = ['#ff4057', '#3d9bff', '#4fe05a', '#ffd23a', '#b45cff'];
  var DARK = ['#8a1226', '#123f86', '#1b6e24', '#8a6400', '#561a8a'];
  var GLYPH = [
    [[2, 1], [1, 2], [2, 2], [3, 2], [2, 3]],
    [[1, 2], [2, 2], [3, 2]],
    [[2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [2, 0], [2, 4], [0, 2], [4, 2]],
    [[2, 2], [1, 2], [2, 1]],
    [[1, 2], [3, 2]]
  ];

  // ---------- board rules (pure functions on a grid, shared by the game and the CPU) ----------
  function emptyGrid() { var g = []; for (var r = 0; r < ROWS; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(-1); g.push(row); } return g; }
  function copyGrid(g) { return g.map(function (r) { return r.slice(); }); }
  function noMoved() { return emptyGrid().map(function (r) { return r.map(function () { return false; }); }); }
  function colH(g, c) { var h = 0; while (h < ROWS && g[h][c] >= 0) h++; return h; }
  function bottomRun(g, c) {
    var h = colH(g, c); if (!h) return null;
    var k = g[h - 1][c], n = 0;
    while (h - 1 - n >= 0 && g[h - 1 - n][c] === k) n++;
    return { k: k, n: n };
  }
  // Pull the lowest run of one colour into `held`. Returns how many were taken.
  function grabFrom(g, c, held) {
    var b = bottomRun(g, c);
    if (!b || (held.n > 0 && b.k !== held.k)) return 0;
    var h = colH(g, c);
    for (var i = 0; i < b.n; i++) g[h - 1 - i][c] = -1;
    held.k = b.k; held.n += b.n;
    return b.n;
  }
  // Put everything held under column c. Returns the moved map, or null if it won't fit.
  function throwTo(g, c, held) {
    var h = colH(g, c);
    if (!held.n || h + held.n > ROWS) return null;
    var moved = noMoved();
    for (var i = 0; i < held.n; i++) { g[h + i][c] = held.k; moved[h + i][c] = true; }
    held.n = 0;
    return moved;
  }
  // Vertical runs of 3+ that contain a ball that just moved, plus every same-colour ball touching them.
  function findClears(g, moved) {
    var hit = noMoved(), count = 0, stack = [], r, c;
    for (c = 0; c < COLS; c++) {
      r = 0;
      while (r < ROWS) {
        var k = g[r][c];
        if (k < 0) { r++; continue; }
        var e = r; while (e < ROWS && g[e][c] === k) e++;
        if (e - r >= 3) {
          var any = false; for (var i = r; i < e; i++) if (moved[i][c]) any = true;
          if (any) for (i = r; i < e; i++) if (!hit[i][c]) { hit[i][c] = true; stack.push([i, c]); }
        }
        r = e;
      }
    }
    while (stack.length) {
      var p = stack.pop(), kk = g[p[0]][p[1]];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var r2 = p[0] + o[0], c2 = p[1] + o[1];
        if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && !hit[r2][c2] && g[r2][c2] === kk) { hit[r2][c2] = true; stack.push([r2, c2]); }
      });
    }
    hit.forEach(function (row) { row.forEach(function (h) { if (h) count++; }); });
    return { hit: hit, count: count };
  }
  // Clear the hits and let balls rise to fill the gaps. Returns the moved map.
  function clearAndRise(g, hit) {
    var moved = noMoved();
    for (var c = 0; c < COLS; c++) {
      var w = 0, gap = false;
      for (var r = 0; r < ROWS; r++) {
        if (hit[r][c]) { g[r][c] = -1; gap = true; continue; }
        if (g[r][c] < 0) continue;
        if (w !== r) { g[w][c] = g[r][c]; g[r][c] = -1; if (gap) moved[w][c] = true; }
        w++;
      }
    }
    return moved;
  }
  // Units sent for one chain step (step = 1 for the first clear).
  function stepUnits(step, count) { return (step - 1) + (count >= 6 ? 1 : 0) + (count >= 10 ? 1 : 0); }
  function comboUnits(combo) { return combo >= 2 ? (combo - 1) * 0.5 : 0; }

  function Grab(opts) {
    this.initBase(opts);
    this.vs = opts.sendOn !== false;
    this.grid = emptyGrid();
    this.score = 0; this.balls = 0; this.elapsed = 0;
    this.pos = 3; this.held = { k: 0, n: 0 };
    this.state = 'play'; this.phaseT = 0;
    this.pushT = 0; this.combo = 0; this.lastClear = -1e9;
    this.dasDir = 0; this.dasT = 0;
    this.beam = 0; this.beamCol = 0; this.shake = 0;
    for (var i = 0; i < CFG.startRows; i++) this.pushRow(true);
    if (opts.cpuLevel) this.cpu = new GrabCPU(this, opts.cpuLevel);
  }
  var P = Grab.prototype;
  Object.assign(P, G.TrackBase);

  // weapon effects
  P.fxSafe = function () { return this.state === 'play'; };
  P.fieldRect = function (x, y) { return [x + 24, y + 6, COLS * CELL, ROWS * CELL + 18]; };
  P.fxWipe = function () { this.grid = emptyGrid(); for (var i = 0; i < CFG.startRows; i++) this.pushRow(true); };
  P.fxRemove = function () { this.grid.shift(); var row = []; for (var c = 0; c < COLS; c++) row.push(-1); this.grid.push(row); };   // the top row, furthest from the grabber
  P.pushEvery = function () { return Math.max(CFG.pushMin, CFG.pushEvery - Math.floor(this.elapsed / CFG.speedUpEvery) * CFG.pushStep); };
  P.die = function () { if (!this.dead) { this.dead = true; this.state = 'over'; G.sfx && G.sfx('ko', this.opts.side); } };
  // A new row comes in from the top and everything moves down one.
  P.pushRow = function (quiet) {
    if (this.grid[ROWS - 1].some(function (v) { return v >= 0; })) { this.die(); return false; }
    this.grid.pop();
    var row = [];
    for (var c = 0; c < COLS; c++) {
      // avoid three of a colour side by side in a fresh row, so rows don't come pre-grouped
      var k, tries = 0;
      do { k = Math.floor(this.rng() * NC); tries++; } while (tries < 4 && c >= 2 && row[c - 1] === k && row[c - 2] === k);
      row.push(k);
    }
    this.grid.unshift(row);
    if (!quiet) this.shake = 90;
    return true;
  };

  P.handle = function (dt, pad) {
    if (pad.pressed('left')) { this.dasDir = -1; this.dasT = 0; this.move(-1); }
    else if (pad.pressed('right')) { this.dasDir = 1; this.dasT = 0; this.move(1); }
    var held = this.dasDir < 0 ? pad.down('left') : this.dasDir > 0 ? pad.down('right') : false;
    if (held) {
      this.dasT += dt;
      while (this.dasT >= CFG.das + CFG.arr) { this.dasT -= CFG.arr; if (!this.move(this.dasDir)) break; }
    } else this.dasDir = 0;
    if (this.state !== 'play') return;   // the grabber can still move while a clear plays out
    if (pad.pressed('a') || pad.pressed('c') || pad.pressed('down')) this.grab();
    else if (pad.pressed('b') || pad.pressed('d') || pad.pressed('up')) this.throwBalls();
  };
  P.move = function (dx) {
    var p = this.pos + dx;
    if (p < 0 || p >= COLS) return false;
    this.pos = p; G.sfx && G.sfx('move', this.opts.side); return true;
  };
  P.grab = function () {
    var n = grabFrom(this.grid, this.pos, this.held);
    if (!n) { G.sfx && G.sfx('bad', this.opts.side); return; }
    this.beam = 140; this.beamCol = this.pos;
    G.sfx && G.sfx('hold', this.opts.side);
  };
  P.throwBalls = function () {
    if (!this.held.n) { G.sfx && G.sfx('bad', this.opts.side); return; }
    var moved = throwTo(this.grid, this.pos, this.held);
    if (!moved) { G.sfx && G.sfx('bad', this.opts.side); return; }
    this.beam = 140; this.beamCol = this.pos;
    G.sfx && G.sfx('hard', this.opts.side);
    this.mark('piece');
    this.chain = 0; this.attack = 0; this.clearedNow = 0;
    this.resolveCheck(moved);
  };
  P.resolveCheck = function (moved) {
    var m = findClears(this.grid, moved);
    if (!m.count) { this.finishResolve(); return; }
    this.chain++;
    if (this.chain === 1) this.combo = (this.elapsed - this.lastClear <= CFG.comboWin) ? this.combo + 1 : 1;
    this.hits = m.hit;
    this.balls += m.count; this.clearedNow += m.count;
    this.score += m.count * 10 * this.chain * this.chain * Math.max(1, this.combo);
    this.attack += stepUnits(this.chain, m.count);
    if (this.chain > 1) this.say('CHAIN X' + this.chain, G.PAL.yellow);
    else if (this.combo > 1) this.say('COMBO X' + this.combo, G.PAL.orange);
    else if (m.count >= 6) this.say(m.count + ' BALLS', G.PAL.cyan);
    G.sfx && G.sfx(this.chain > 1 || this.combo > 1 ? 'big' : 'clear', this.opts.side);
    this.state = 'flash'; this.phaseT = CFG.flash;
  };
  P.finishResolve = function () {
    if (this.chain) {
      this.attack += comboUnits(this.combo);
      if (this.chain > 1 || this.clearedNow >= 6 || this.combo >= 3) this.mark('big');
      this.lastClear = this.elapsed;
      if (this.vs && this.attack > 0) {
        this.atkFrac = (this.atkFrac || 0) + this.attack * CFG.sendMul;
        var out = Math.floor(this.atkFrac); this.atkFrac -= out;
        this.send(out);
      }
    }
    this.state = 'play';
  };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    if (this.beam > 0) this.beam -= dt;
    if (this.shake > 0) this.shake -= dt;
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);
    this.handle(dt, pad);
    if (this.state === 'play') {
      this.pushT += dt;
      if (this.pushT >= this.pushEvery()) { this.pushT = 0; if (this.pushRow()) G.sfx && G.sfx('tick', this.opts.side); }
      if (this.vs && !this.dead) {
        var batches = this.takeReady(CFG.garbageDelay, CFG.maxGarbage), self = this, n = 0;
        batches.forEach(function (b) { self.rowFrac = (self.rowFrac || 0) + b.n * CFG.rowsPerUnit; });
        while (this.rowFrac >= 1 && !this.dead) { this.rowFrac -= 1; this.pushRow(); n++; }
        if (n) { this.shake = 160; G.sfx && G.sfx('garbage', this.opts.side); }
      }
    } else if (this.state === 'flash') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { this.rose = clearAndRise(this.grid, this.hits); this.hits = null; this.state = 'settle'; this.phaseT = CFG.settle; }
    } else if (this.state === 'settle') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.resolveCheck(this.rose);
    }
  };

  // ---------- drawing ----------
  function ball(ctx, k, x, y, s, alpha) {
    if (alpha != null) ctx.globalAlpha = alpha;
    var cx = x + s / 2, cy = y + s / 2, r = s / 2 - 1;
    ctx.fillStyle = DARK[k]; ctx.beginPath(); ctx.arc(cx, cy + 0.5, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS[k]; ctx.beginPath(); ctx.arc(cx - 0.4, cy - 0.4, r - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = DARK[k];
    var gx = Math.round(cx) - 2, gy = Math.round(cy) - 2;
    GLYPH[k].forEach(function (p) { ctx.fillRect(gx + p[0], gy + p[1], 1, 1); });
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(Math.round(cx - r * 0.55), Math.round(cy - r * 0.6), 2, 1);
    ctx.globalAlpha = 1;
  }
  // The grabber: a little round-headed robot with two claws.
  function grabber(ctx, x, y, held, side) {
    var body = side ? '#7cc4ff' : '#ffb21e', dark = side ? '#1d4a7a' : '#7a4a00';
    G.rect(x + 1, y + 4, 11, 8, dark); G.rect(x + 2, y + 4, 9, 7, body);
    G.rect(x, y + 1, 2, 5, dark); G.rect(x + 11, y + 1, 2, 5, dark);           // claws
    G.rect(x, y, 3, 2, body); G.rect(x + 10, y, 3, 2, body);
    G.rect(x + 4, y + 6, 1, 2, '#000'); G.rect(x + 8, y + 6, 1, 2, '#000');   // eyes
    G.rect(x + 6, y + 12, 1, 2, dark);                                          // stand
    G.rect(x + 3, y + 14, 7, 1, dark);
    if (held.n) ball(ctx, held.k, x + 3, y - 3, 7);
  }

  P.draw = function (x, y) {
    var ctx = G.ctxRef(), bw = COLS * CELL, bh = ROWS * CELL, bx = x + 24, by = y + 6, r, c;
    var g = ctx.createLinearGradient(0, y, 0, y + 194); g.addColorStop(0, '#0f2a3a'); g.addColorStop(1, '#253f22');
    ctx.fillStyle = g; ctx.fillRect(x, y, 160, 194);
    var sy = this.shake > 0 ? ((this.shake >> 5) & 1 ? 1 : -1) : 0;
    // field
    G.rect(bx - 3, by - 3, bw + 6, bh + 24, '#000');
    G.rect(bx - 2, by - 2, bw + 4, bh + 22, '#6fd3a8');
    G.rect(bx - 1, by - 1, bw + 2, bh + 20, '#000');
    G.rect(bx, by, bw, bh + 18, '#0b1a22');
    for (c = 0; c < COLS; c++) if (c & 1) G.rect(bx + c * CELL, by, CELL, bh, '#0e2029');
    // the grabber's column
    if (!this.dead) { ctx.globalAlpha = 0.18; G.rect(bx + this.pos * CELL, by, CELL, bh, '#bff'); ctx.globalAlpha = 1; }
    var maxH = 0; for (c = 0; c < COLS; c++) maxH = Math.max(maxH, colH(this.grid, c));
    var flashOn = (this.phaseT >> 6) & 1, now = Date.now();
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var k = this.grid[r][c];
      if (k < 0) continue;
      var px = bx + c * CELL, py = by + r * CELL + sy;
      if (this.state === 'flash' && this.hits && this.hits[r][c] && flashOn) { G.rect(px + 2, py + 2, CELL - 4, CELL - 4, '#fff'); continue; }
      ball(ctx, k, px, py, CELL);
    }
    // danger line: the last row before the grabber
    var dline = by + bh;
    if (maxH >= ROWS - 2) G.rect(bx, dline, bw, 1, (now >> 7) & 1 ? G.PAL.red : '#601018');
    else G.rect(bx, dline, bw, 1, '#24414a');
    // grab / throw beam
    if (this.beam > 0) {
      ctx.globalAlpha = Math.min(1, this.beam / 100) * 0.6;
      var bh2 = colH(this.grid, this.beamCol) * CELL;
      G.rect(bx + this.beamCol * CELL + 5, by + bh2, 3, bh - bh2 + 3, '#fff');
      ctx.globalAlpha = 1;
    }
    if (!this.dead) grabber(ctx, bx + this.pos * CELL, by + bh + 2, this.held, this.opts.side);
    this.drawPendingBar(bx - 10, by, bh, CELL, CFG.garbageDelay);
    // right panel
    var rx = bx + bw + 6, cx = rx + 15;
    G.text('HOLD', cx, by + 2, G.PAL.beige, { font: 'small', align: 'center' });
    G.rect(rx, by + 10, 30, 18, '#000');
    if (this.held.n) {
      ball(ctx, this.held.k, rx + 3, by + 12, CELL);
      G.text('X' + this.held.n, rx + 23, by + 16, G.PAL.white, { font: 'small', align: 'center' });
    }
    G.text('SCORE', cx, by + 38, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.score), cx, by + 47, G.PAL.green, { font: 'small', align: 'center' });
    G.text('BALLS', cx, by + 64, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.balls), cx, by + 73, G.PAL.amber, { font: 'small', align: 'center' });
    G.text('SPEED', cx, by + 90, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(1 + Math.floor(this.elapsed / CFG.speedUpEvery)), cx, by + 99, G.PAL.cyan, { font: 'small', align: 'center' });
    G.text('PUSH', cx, by + 116, G.PAL.beige, { font: 'small', align: 'center' });
    G.rect(rx, by + 125, 30, 4, G.PAL.steelLo);
    var f = Math.min(1, this.pushT / this.pushEvery());
    G.rect(rx, by + 125, Math.round(30 * f), 4, f > 0.8 ? ((now >> 7) & 1 ? G.PAL.red : G.PAL.amber) : G.PAL.amber);
    this.drawFlash(bx + bw / 2, by + 90);
    if (this.dead) { ctx.globalAlpha = 0.55; G.rect(bx - 3, by - 3, bw + 6, bh + 24, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  // Tries grab-then-throw (and grab-grab-throw) for every column, plays out the chains,
  // and scores the board left behind.
  var LEVELS = {
    1: { think: 1050, step: 200, mistake: 0.40, two: 0 }, 2: { think: 860, step: 170, mistake: 0.30, two: 0 },
    3: { think: 700, step: 150, mistake: 0.20, two: 1 }, 4: { think: 620, step: 130, mistake: 0.16, two: 1 },
    5: { think: 540, step: 115, mistake: 0.13, two: 1 }, 6: { think: 470, step: 100, mistake: 0.10, two: 1 },
    7: { think: 445, step: 95, mistake: 0.09, two: 1 }, 8: { think: 420, step: 88, mistake: 0.08, two: 1 }
  };
  function playOut(g, moved) {
    var chain = 0, units = 0, cleared = 0;
    for (;;) {
      var m = findClears(g, moved);
      if (!m.count) break;
      chain++; cleared += m.count; units += stepUnits(chain, m.count);
      moved = clearAndRise(g, m.hit);
    }
    return { chain: chain, units: units, cleared: cleared };
  }
  function evalBoard(g) {
    var hs = [], max = 0, sq = 0, setups = 0, c, b, bottoms = [];
    for (c = 0; c < COLS; c++) {
      var h = colH(g, c); hs.push(h); if (h > max) max = h; sq += h * h;
      b = bottomRun(g, c); bottoms.push(b ? b.k : -1);
      if (b && b.n === 2) setups += 6;
    }
    // colours showing at more than one column bottom can be gathered
    for (c = 0; c < COLS; c++) for (var d = c + 1; d < COLS; d++) if (bottoms[c] >= 0 && bottoms[c] === bottoms[d]) setups += 2;
    var danger = max >= ROWS - 3 ? (max - (ROWS - 4)) * 70 : 0;
    return setups - sq * 0.25 - max * 3 - danger;
  }
  function GrabCPU(track, level) { this.t = track; this.cfg = LEVELS[Math.max(1, Math.min(8, level))]; this.plan = null; this.wait = this.cfg.think; this.tap = false; }
  GrabCPU.prototype.choose = function () {
    var t = this.t, cfg = this.cfg, all = [], c1, c2, c3;
    function tryPlan(acts) {
      var g = copyGrid(t.grid), held = { k: t.held.k, n: t.held.n }, moved = null;
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        if (a.t === 'g') { if (!grabFrom(g, a.c, held)) return; }
        else { moved = throwTo(g, a.c, held); if (!moved) return; }
      }
      var s = playOut(g, moved);
      // walking costs time: prefer short trips
      var walk = 0, p = t.pos; acts.forEach(function (a) { walk += Math.abs(a.c - p); p = a.c; });
      all.push({ acts: acts, sc: s.units * 45 + s.cleared * 7 + s.chain * 20 + evalBoard(g) - walk * 0.6 });
    }
    for (c2 = 0; c2 < COLS; c2++) {
      if (t.held.n) {
        tryPlan([{ t: 't', c: c2 }]);
        for (c1 = 0; c1 < COLS; c1++) tryPlan([{ t: 'g', c: c1 }, { t: 't', c: c2 }]);
      } else {
        for (c1 = 0; c1 < COLS; c1++) {
          tryPlan([{ t: 'g', c: c1 }, { t: 't', c: c2 }]);
          if (cfg.two) for (c3 = 0; c3 < COLS; c3++) if (c3 !== c1) tryPlan([{ t: 'g', c: c1 }, { t: 'g', c: c3 }, { t: 't', c: c2 }]);
        }
      }
    }
    if (!all.length) return null;
    all.sort(function (a, b) { return b.sc - a.sc; });
    var best = all[0];
    if (all.length > 1 && t.rng() < cfg.mistake) best = all[Math.min(all.length - 1, 1 + Math.floor(t.rng() * 3))];
    return best.acts;
  };
  GrabCPU.prototype.drive = function (dt, pad) {
    var st = {}, t = this.t;
    if (t.state !== 'play') { pad.feed(st, dt); return; }
    if (this.tap) { this.tap = false; pad.feed(st, dt); return; }
    this.wait -= dt;
    if (this.wait > 0) { pad.feed(st, dt); return; }
    if (!this.plan || !this.plan.length) {
      this.plan = this.choose();
      if (!this.plan) { this.wait = this.cfg.think; pad.feed(st, dt); return; }
    }
    var a = this.plan[0];
    if (t.pos < a.c) st.right = true;
    else if (t.pos > a.c) st.left = true;
    else {
      if (a.t === 'g') {
        var b = bottomRun(t.grid, a.c);
        if (!b || (t.held.n && b.k !== t.held.k)) { this.plan = null; pad.feed(st, dt); return; }   // board changed: plan again
        st.a = true;
      } else st.b = true;
      this.plan.shift();
      if (!this.plan.length) this.wait = this.cfg.think * (0.6 + t.rng() * 0.8);
    }
    this.tap = true;
    if (this.wait <= 0) this.wait = this.cfg.step;
    pad.feed(st, dt);
  };

  G.registerTrack('grab', {
    name: 'GRAB', blurb: 'GRAB BALLS, THROW 3 UP', color: '#6fd3a8',
    make: function (opts) { return new Grab(opts); }
  });
})(globalThis.G = globalThis.G || {});
