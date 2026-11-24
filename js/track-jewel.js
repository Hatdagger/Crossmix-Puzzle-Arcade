// JEWEL: Columns-style falling jewels as a track.
// A column of 3 jewels falls into a 6x13 well. A cycles the jewels down, B cycles them up.
// Line up 3 or more of a colour across, down or diagonally; the gaps fill and chains follow.
// Incoming units rise from the bottom as rock rows (one gap per batch). A rock breaks when
// a jewel next to it clears. You lose when the well overflows.
(function (G) {
  'use strict';

  var COLS = 6, ROWS = 13, CELL = 14, NC = 6, ROCK = 9, SPAWN_C = 2;
  var CFG = {
    fall: 900, fallMin: 140, fallStep: 70, speedUpEvery: 30000,   // gravity speeds up every 30 s
    soft: 75, lockDelay: 350, das: 150, arr: 50,
    garbageDelay: 1000, maxGarbage: 4,                             // rows landing per piece
    flash: 380, settle: 140,
    sendMul: G.JEWEL_SEND || 0.45                                   // mixed-play balance (see tools/sim.js)
  };
  // Each jewel has its own shape and colour (different from Calm's set):
  // crimson heart, teal drop, lime cross, gold moon, magenta octagon, ice bowtie.
  var COLORS = ['#ff2f55', '#1fd8c8', '#b4f02e', '#ffbf14', '#ff47d4', '#e6efff'];
  var DARK = ['#8a0e28', '#0b6e66', '#4f7a0a', '#8a5a00', '#7d1468', '#6f7c99'];
  var TILE = '#1a1330';
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function emptyGrid() { var g = []; for (var r = 0; r < ROWS; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(-1); g.push(row); } return g; }
  function copyGrid(g) { return g.map(function (r) { return r.slice(); }); }

  // Runs of 3+ in any of the four directions. Returns the hit map and the number of jewels hit.
  function findMatches(g) {
    var hit = g.map(function (r) { return r.map(function () { return false; }); }), count = 0, groups = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var k = g[r][c];
      if (k < 0 || k >= NC) continue;
      DIRS.forEach(function (d) {
        var pr = r - d[0], pc = c - d[1];
        if (pr >= 0 && pr < ROWS && pc >= 0 && pc < COLS && g[pr][pc] === k) return;   // not the start of a run
        var n = 0, rr = r, cc = c;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && g[rr][cc] === k) { n++; rr += d[0]; cc += d[1]; }
        if (n >= 3) { groups++; for (var i = 0; i < n; i++) hit[r + d[0] * i][c + d[1] * i] = true; }
      });
    }
    hit.forEach(function (row) { row.forEach(function (h) { if (h) count++; }); });
    return { hit: hit, count: count, groups: groups };
  }
  // Clear the hit jewels and any rock next to them (up, down, left, right). Returns rocks broken.
  function clearHits(g, hit) {
    var broke = 0, r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var r2 = r + o[0], c2 = c + o[1];
        if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] === ROCK && !hit[r2][c2]) { g[r2][c2] = -2; broke++; }
      });
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c] || g[r][c] === -2) g[r][c] = -1;
    return broke;
  }
  function gravity(g) {
    for (var c = 0; c < COLS; c++) {
      var w = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) if (g[r][c] >= 0) { var v = g[r][c]; g[r][c] = -1; g[w--][c] = v; }
    }
  }
  function colHeight(g, c) { for (var r = 0; r < ROWS; r++) if (g[r][c] >= 0) return ROWS - r; return 0; }
  // Units sent for one chain step (step = 1 for the first clear).
  function stepUnits(step, count) { return (step - 1) + (count >= 5 ? 1 : 0) + (count >= 8 ? 1 : 0); }

  function Jewel(opts) {
    this.initBase(opts);
    this.vs = opts.sendOn !== false;
    this.grid = emptyGrid();
    this.score = 0; this.jewels = 0; this.elapsed = 0;
    this.state = 'fall'; this.phaseT = 0;
    this.next = this.newGems();
    this.spawn();
    this.anim = {};          // "r,c" -> pop timer for jewels just landed
    if (opts.cpuLevel) this.cpu = new JewelCPU(this, opts.cpuLevel);
  }
  var P = Jewel.prototype;
  Object.assign(P, G.TrackBase);

  // weapon effects (applied between pieces)
  P.fxSafe = function () { return this.state === 'fall'; };
  P.fieldRect = function (x, y) { return [x + 30, y + 6, COLS * CELL, ROWS * CELL]; };
  P.fxWipe = function () { this.grid = emptyGrid(); };
  P.fxRemove = function () { this.grid.pop(); var row = []; for (var c = 0; c < COLS; c++) row.push(-1); this.grid.unshift(row); };
  P.newGems = function () { var a = []; for (var i = 0; i < 3; i++) a.push(Math.floor(this.rng() * NC)); return a; };
  P.spawn = function () {
    this.piece = { c: SPAWN_C, r: -3, gems: this.next };   // r = row of the top jewel
    this.next = this.newGems();
    this.fallT = 0; this.lockT = 0; this.dasDir = 0;
    if (this.grid[0][SPAWN_C] >= 0) this.die();
  };
  P.cellFree = function (r, c) { return c >= 0 && c < COLS && r < ROWS && (r < 0 || this.grid[r][c] < 0); };
  P.fits = function (r, c) { return this.cellFree(r, c) && this.cellFree(r + 1, c) && this.cellFree(r + 2, c); };
  P.landed = function () { var p = this.piece; return !this.fits(p.r + 1, p.c); };
  P.dropRow = function () { var p = this.piece, r = p.r; while (this.fits(r + 1, p.c)) r++; return r; };
  P.speed = function () { return Math.max(CFG.fallMin, CFG.fall - Math.floor(this.elapsed / CFG.speedUpEvery) * CFG.fallStep); };
  P.die = function () { if (!this.dead) { this.dead = true; this.state = 'over'; G.sfx && G.sfx('ko', this.opts.side); } };

  P.shift = function (dx) {
    var p = this.piece;
    if (!this.fits(p.r, p.c + dx)) return false;
    p.c += dx; this.lockT = 0; G.sfx && G.sfx('move', this.opts.side); return true;
  };
  P.cycle = function (dir) {
    var g = this.piece.gems;
    if (dir > 0) g.unshift(g.pop()); else g.push(g.shift());
    G.sfx && G.sfx('rotate', this.opts.side);
  };

  P.handle = function (dt, pad) {
    if (pad.pressed('a')) this.cycle(1);
    if (pad.pressed('b')) this.cycle(-1);
    if (pad.pressed('d') || pad.pressed('up')) { this.piece.r = this.dropRow(); G.sfx && G.sfx('hard', this.opts.side); this.lock(); return; }
    if (pad.pressed('left')) { this.dasDir = -1; this.dasT = 0; this.shift(-1); }
    else if (pad.pressed('right')) { this.dasDir = 1; this.dasT = 0; this.shift(1); }
    var held = this.dasDir < 0 ? pad.down('left') : this.dasDir > 0 ? pad.down('right') : false;
    if (held) {
      this.dasT += dt;
      while (this.dasT >= CFG.das + CFG.arr) { this.dasT -= CFG.arr; if (!this.shift(this.dasDir)) break; }
    } else this.dasDir = 0;
    var rate = pad.down('down') ? Math.min(CFG.soft, this.speed()) : this.speed();
    if (this.landed()) {
      this.lockT += dt;
      if (this.lockT >= CFG.lockDelay) this.lock();
    } else {
      this.fallT += dt;
      while (this.fallT >= rate && !this.landed()) { this.fallT -= rate; this.piece.r++; if (pad.down('down')) this.score++; }
    }
  };

  P.lock = function () {
    var p = this.piece, self = this, over = false;
    p.gems.forEach(function (k, i) {
      var r = p.r + i;
      if (r < 0) over = true; else { self.grid[r][p.c] = k; self.anim[r + ',' + p.c] = 160; }
    });
    this.piece = null;
    G.sfx && G.sfx('lock', this.opts.side);
    this.mark('piece');
    this.overflow = over;
    this.chain = 0; this.attack = 0;
    this.resolveCheck();
  };
  P.resolveCheck = function () {
    var m = findMatches(this.grid);
    if (!m.count) { this.finishResolve(); return; }
    this.chain++;
    this.hits = m.hit;
    this.jewels += m.count;
    this.score += m.count * 10 * this.chain * this.chain;
    this.attack += stepUnits(this.chain, m.count);
    if (this.chain > 1 || m.count >= 5) this.mark('big');
    if (this.chain > 1) this.say('CHAIN X' + this.chain, G.PAL.yellow);
    else if (m.count >= 5) this.say(m.count + ' JEWELS', G.PAL.cyan);
    G.sfx && G.sfx(this.chain > 1 ? 'big' : 'clear', this.opts.side);
    this.state = 'flash'; this.phaseT = CFG.flash;
  };
  P.finishResolve = function () {
    if (this.vs && this.attack > 0) {
      this.atkFrac = (this.atkFrac || 0) + this.attack * CFG.sendMul;
      var out = Math.floor(this.atkFrac); this.atkFrac -= out;
      this.send(out);
    }
    // A jewel that locked above the top only ends the game if nothing cleared to make room.
    if (this.overflow && !this.chain) { this.die(); return; }
    if (!this.chain || !this.vs) this.landGarbage();
    if (this.dead) return;
    this.state = 'fall';
    this.spawn();
  };
  // Rock rows rise from the bottom; each batch shares one gap column.
  P.landGarbage = function () {
    if (!this.vs) return;
    var batches = this.takeReady(CFG.garbageDelay, CFG.maxGarbage), self = this;
    if (!batches.length) return;
    batches.forEach(function (b) {
      var gap = Math.floor((b.gap / 1000) * COLS) % COLS;
      for (var i = 0; i < b.n; i++) {
        if (self.grid[0].some(function (v) { return v >= 0; })) { self.die(); return; }
        self.grid.shift();
        var row = []; for (var c = 0; c < COLS; c++) row.push(c === gap ? -1 : ROCK);
        self.grid.push(row);
      }
    });
    // Rows with a gap may leave jewels floating above it; let them settle.
    gravity(this.grid);
    G.sfx && G.sfx('garbage', this.opts.side);
  };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    for (var k in this.anim) { this.anim[k] -= dt; if (this.anim[k] <= 0) delete this.anim[k]; }
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);
    if (this.state === 'fall') { if (this.piece) this.handle(dt, pad); }
    else if (this.state === 'flash') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        var broke = clearHits(this.grid, this.hits);
        if (broke) this.say(broke > 1 ? broke + ' ROCKS' : 'ROCK', G.PAL.beige);
        gravity(this.grid);
        this.state = 'settle'; this.phaseT = CFG.settle;
      }
    } else if (this.state === 'settle') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.resolveCheck();
    }
  };

  // ---------- drawing ----------
  function shapePath(ctx, k, cx, cy, s) {
    ctx.beginPath();
    switch (k) {
      case 0:   // heart
        ctx.moveTo(cx, cy + s);
        ctx.bezierCurveTo(cx - s * 1.7, cy - s * 0.1, cx - s * 0.9, cy - s * 1.4, cx, cy - s * 0.45);
        ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.4, cx + s * 1.7, cy - s * 0.1, cx, cy + s);
        break;
      case 1:   // drop
        ctx.moveTo(cx, cy - s * 1.2);
        ctx.quadraticCurveTo(cx + s * 0.95, cy - s * 0.1, cx + s * 0.8, cy + s * 0.35);
        ctx.arc(cx, cy + s * 0.3, s * 0.8, 0.05, Math.PI - 0.05);
        ctx.quadraticCurveTo(cx - s * 0.95, cy - s * 0.1, cx, cy - s * 1.2);
        break;
      case 2:   // cross
        var a = s * 0.38;
        ctx.moveTo(cx - a, cy - s); ctx.lineTo(cx + a, cy - s); ctx.lineTo(cx + a, cy - a); ctx.lineTo(cx + s, cy - a);
        ctx.lineTo(cx + s, cy + a); ctx.lineTo(cx + a, cy + a); ctx.lineTo(cx + a, cy + s); ctx.lineTo(cx - a, cy + s);
        ctx.lineTo(cx - a, cy + a); ctx.lineTo(cx - s, cy + a); ctx.lineTo(cx - s, cy - a); ctx.lineTo(cx - a, cy - a);
        break;
      case 3:   // moon (the bite is painted afterwards)
        ctx.arc(cx, cy, s, 0, Math.PI * 2);
        break;
      case 4:   // octagon
        for (var i = 0; i < 8; i++) { var an = Math.PI / 8 + i * Math.PI / 4, px = cx + Math.cos(an) * s * 1.05, py = cy + Math.sin(an) * s * 1.05; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        break;
      case 5:   // bowtie
        ctx.moveTo(cx - s, cy - s * 0.85); ctx.lineTo(cx, cy - s * 0.2); ctx.lineTo(cx + s, cy - s * 0.85);
        ctx.lineTo(cx + s, cy + s * 0.85); ctx.lineTo(cx, cy + s * 0.2); ctx.lineTo(cx - s, cy + s * 0.85);
        break;
    }
    ctx.closePath();
  }
  function gem(ctx, k, x, y, s, alpha) {
    if (alpha != null) ctx.globalAlpha = alpha;
    var h = s / 2, cx = x + h, cy = y + h;
    if (k === ROCK) {
      ctx.fillStyle = '#5a5363'; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.fillStyle = '#8a8296'; ctx.fillRect(x + 1, y + 1, s - 2, 2); ctx.fillRect(x + 1, y + 1, 2, s - 2);
      ctx.strokeStyle = '#3a3442'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x + 4, y + 4); ctx.lineTo(cx, cy); ctx.lineTo(x + 5, y + s - 3); ctx.moveTo(cx, cy); ctx.lineTo(x + s - 3, cy - 1); ctx.stroke();
      ctx.globalAlpha = 1; return;
    }
    // dark slot with a rim in the jewel's colour, then the shape with a shadow and a shine
    ctx.fillStyle = DARK[k]; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = TILE; ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
    var r = s * 0.34;
    shapePath(ctx, k, cx, cy + 1, r); ctx.fillStyle = DARK[k]; ctx.fill();
    shapePath(ctx, k, cx, cy, r); ctx.fillStyle = COLORS[k]; ctx.fill();
    if (k === 3) { ctx.beginPath(); ctx.arc(cx + r * 0.55, cy - r * 0.35, r * 0.82, 0, Math.PI * 2); ctx.fillStyle = TILE; ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(Math.round(cx - r * 0.6), Math.round(cy - r * 0.55), 1, 1);
    ctx.globalAlpha = 1;
  }

  P.draw = function (x, y) {
    var ctx = G.ctxRef(), bw = COLS * CELL, bh = ROWS * CELL, bx = x + 30, by = y + 6, r, c;
    var g = ctx.createLinearGradient(0, y, 0, y + 194); g.addColorStop(0, '#1d1640'); g.addColorStop(1, '#4b2a5c');
    ctx.fillStyle = g; ctx.fillRect(x, y, 160, 194);
    // well
    G.rect(bx - 3, by - 3, bw + 6, bh + 6, '#000');
    G.rect(bx - 2, by - 2, bw + 4, bh + 4, '#c9a64e');
    G.rect(bx - 1, by - 1, bw + 2, bh + 2, '#000');
    G.rect(bx, by, bw, bh, '#120d22');
    for (c = 1; c < COLS; c++) G.rect(bx + c * CELL, by, 1, bh, '#1c1532');
    var flashOn = (this.phaseT >> 6) & 1;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var k = this.grid[r][c];
      if (k < 0) continue;
      var px = bx + c * CELL, py = by + r * CELL;
      if (this.state === 'flash' && this.hits && this.hits[r][c]) {
        if (flashOn) { G.rect(px + 1, py + 1, CELL - 2, CELL - 2, '#fff'); continue; }
      }
      var pop = this.anim[r + ',' + c];
      gem(ctx, k, px, py - (pop ? Math.round(pop / 80) : 0), CELL);
    }
    // falling piece + landing guide
    if (this.piece && !this.dead) {
      var p = this.piece, dr = this.dropRow();
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      for (var i = 0; i < 3; i++) {
        if (dr + i >= 0) { ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.strokeRect(bx + p.c * CELL + 1.5, by + (dr + i) * CELL + 1.5, CELL - 3, CELL - 3); }
        gem(ctx, p.gems[i], bx + p.c * CELL, by + (p.r + i) * CELL, CELL);
      }
      ctx.restore();
    }
    // incoming rock rows (one unit = one row)
    this.drawPendingBar(bx - 10, by, bh, CELL, CFG.garbageDelay);
    // right panel: next, score, jewels
    var rx = bx + bw + 8;
    G.text('NEXT', rx + 13, by + 2, G.PAL.beige, { font: 'small', align: 'center' });
    G.rect(rx, by + 10, 26, 3 * CELL + 6, '#000');
    // While the piece is still coming in from above the well, NEXT keeps showing it.
    var shown = this.piece && this.piece.r < 0 ? this.piece.gems : this.next;
    for (var j = 0; j < 3; j++) gem(ctx, shown[j], rx + 6, by + 13 + j * CELL, CELL);
    G.text('SCORE', rx + 13, by + 70, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.score), rx + 13, by + 79, G.PAL.green, { font: 'small', align: 'center' });
    G.text('JEWELS', rx + 13, by + 96, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.jewels), rx + 13, by + 105, G.PAL.amber, { font: 'small', align: 'center' });
    G.text('SPEED', rx + 13, by + 122, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(1 + Math.floor(this.elapsed / CFG.speedUpEvery)), rx + 13, by + 131, G.PAL.cyan, { font: 'small', align: 'center' });
    this.drawFlash(bx + bw / 2, by + 70);
    if (this.dead) { ctx.globalAlpha = 0.55; G.rect(bx - 3, by - 3, bw + 6, bh + 6, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  // Tries every column x 3 rotations, plays out the chains, and scores the board left behind.
  var LEVELS = {
    1: { think: 900, step: 220, mistake: 0.40, look: 0 }, 2: { think: 750, step: 180, mistake: 0.30, look: 0 },
    3: { think: 600, step: 150, mistake: 0.22, look: 0 }, 4: { think: 480, step: 120, mistake: 0.15, look: 1 },
    5: { think: 380, step: 100, mistake: 0.10, look: 1 }, 6: { think: 300, step: 80, mistake: 0.06, look: 1 },
    7: { think: 220, step: 65, mistake: 0.03, look: 1 }, 8: { think: 150, step: 50, mistake: 0.01, look: 1 }
  };
  function simulate(grid, c, gems) {
    var g = copyGrid(grid), top = -1;
    for (var r = 0; r < ROWS; r++) if (g[r][c] >= 0) break; else top = r;
    var r0 = top - 2, over = false;
    for (var i = 0; i < 3; i++) { if (r0 + i < 0) over = true; else g[r0 + i][c] = gems[i]; }
    var chain = 0, units = 0, cleared = 0;
    for (;;) {
      var m = findMatches(g);
      if (!m.count) break;
      chain++; cleared += m.count; units += stepUnits(chain, m.count);
      clearHits(g, m.hit); gravity(g);
    }
    return { g: g, chain: chain, units: units, cleared: cleared, over: over && !chain };
  }
  function evalBoard(g) {
    var hs = [], max = 0, bump = 0, pairs = 0, r, c;
    for (c = 0; c < COLS; c++) { var h = colHeight(g, c); hs.push(h); if (h > max) max = h; if (c) bump += Math.abs(h - hs[c - 1]); }
    // same-colour neighbours are setups for the next clear
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var k = g[r][c]; if (k < 0 || k >= NC) continue;
      DIRS.forEach(function (d) { var r2 = r + d[0], c2 = c + d[1]; if (r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] === k) pairs++; });
    }
    var danger = max > ROWS - 4 ? (max - (ROWS - 4)) * 60 : 0;
    var spawnRisk = hs[SPAWN_C] > ROWS - 4 ? 200 : 0;
    return pairs * 3 - max * 4 - bump * 2 - danger - spawnRisk;
  }
  function JewelCPU(track, level) { this.t = track; this.cfg = LEVELS[Math.max(1, Math.min(8, level))]; this.plan = null; this.wait = this.cfg.think; this.tap = false; }
  JewelCPU.prototype.choose = function () {
    var t = this.t, p = t.piece, best = null, all = [], cfg = this.cfg;
    for (var c = 0; c < COLS; c++) for (var rot = 0; rot < 3; rot++) {
      var gems = p.gems.slice(rot).concat(p.gems.slice(0, rot));
      var s = simulate(t.grid, c, gems);
      if (s.over) continue;
      var sc = s.cleared * 8 + s.units * 40 + s.chain * 15 + evalBoard(s.g);
      if (cfg.look) {   // peek at the next piece's best follow-up
        var bestN = -1e9;
        for (var c2 = 0; c2 < COLS; c2++) { var s2 = simulate(s.g, c2, t.next); if (!s2.over) bestN = Math.max(bestN, s2.cleared * 6 + s2.units * 30); }
        if (bestN > -1e9) sc += bestN * 0.5;
      }
      var mv = { c: c, rot: rot, sc: sc };
      all.push(mv);
      if (!best || sc > best.sc) best = mv;
    }
    if (!best) return { c: p.c, rot: 0 };
    // A mistake takes one of the next few best moves, not a random one (a random column tops out fast).
    if (all.length > 1 && t.rng() < cfg.mistake) {
      all.sort(function (a, b) { return b.sc - a.sc; });
      best = all[Math.min(all.length - 1, 1 + Math.floor(t.rng() * 3))];
    }
    return best;
  };
  JewelCPU.prototype.drive = function (dt, pad) {
    var st = {}, t = this.t;
    if (t.state !== 'fall' || !t.piece) { this.plan = null; this.wait = this.cfg.think * (0.6 + t.rng() * 0.8); pad.feed(st, dt); return; }
    if (this.tap) { this.tap = false; pad.feed(st, dt); return; }
    this.wait -= dt;
    if (this.wait > 0) { pad.feed(st, dt); return; }
    if (!this.plan || this.plan.piece !== t.piece) { var ch = this.choose(); this.plan = { piece: t.piece, c: ch.c, rot: ch.rot }; }
    var pl = this.plan;
    if (pl.rot > 0) { st.b = true; pl.rot--; }                 // B cycles up: gems.push(gems.shift())
    else if (t.piece.c < pl.c) st.right = true;
    else if (t.piece.c > pl.c) st.left = true;
    else st.d = true;
    // if a wall of jewels blocks the way, just drop where we are
    if ((st.left || st.right) && !t.fits(t.piece.r, t.piece.c + (st.left ? -1 : 1))) { st = { d: true }; }
    this.tap = true; this.wait = this.cfg.step;
    pad.feed(st, dt);
  };

  G.registerTrack('jewel', {
    name: 'JEWEL', blurb: 'LINE UP 3 FALLING JEWELS', color: '#ffd84a',
    make: function (opts) { return new Jewel(opts); }
  });
})(globalThis.G = globalThis.G || {});
