// SWAP: Tetris Attack style rising stack as a track.
// A 2-wide cursor swaps two side-by-side panels (either may be empty). Line up 3+ across or down.
// Panels above a clear fall; if they make a match on landing that's a chain. The stack keeps
// rising; hold C or D to raise it faster. Touching the top starts a short panic timer.
// Incoming units drop as garbage slabs (3 units = 3 wide, 6 = a full row). A match next to a
// slab turns its bottom row back into panels, which can chain.
(function (G) {
  'use strict';

  var COLS = 6, VIS = 12, HID = 4, ROWS = VIS + HID, CELL = 14, NC = 5;
  var CFG = {
    rise: 7000, riseMin: 1800, riseStep: 600, speedUpEvery: 30000,   // ms per row; faster every 30 s
    raise: 110,                       // ms per row while C/D is held
    fallTick: 45, hang: 120, clear: 820, swapAnim: 70,
    stopCombo: 900, stopChain: 1500, panic: 2600,
    garbageDelay: 1000, forceDrop: 3000, maxRows: 4,
    sendMul: G.SWAP_SEND || 0.45,
    unitPanels: G.SWAP_PANELS || 3
  };
  // Panel colours and symbols (different from Calm's and Jewel's sets).
  var COLORS = ['#e8364a', '#2f7df0', '#22b35a', '#f2c51d', '#9b4cf0'];
  var DARK = ['#86121f', '#123d86', '#0d5c2b', '#8a6a00', '#4c1b86'];
  var LIGHT = ['#ff8a96', '#8cbcff', '#7ee6a2', '#fff08a', '#d1a8ff'];

  function Swap(opts) {
    this.initBase(opts);
    this.vs = opts.sendOn !== false;
    this.grid = []; for (var r = 0; r < ROWS; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(null); this.grid.push(row); }
    this.slabs = []; this.groups = [];
    this.cursor = { r: ROWS - 4, c: 2 };
    this.rise = 0; this.stopT = 0; this.panicT = 0; this.chain = 0; this.maxChain = 0;
    this.score = 0; this.elapsed = 0; this.atkFrac = 0; this.carry = 0;
    this.gAcc = 0; this.tick = 0; this.raising = false;
    this.fillStart();
    this.preview = this.newRow();
    if (opts.cpuLevel) this.cpu = new SwapCPU(this, opts.cpuLevel);
  }
  var P = Swap.prototype;
  Object.assign(P, G.TrackBase);

  P.block = function (k) { return { k: k, st: 'idle', t: 0, chain: false, slab: null, mv: -1, sw: 0 }; };
  P.colorAt = function (r, c) { var b = r >= 0 && r < ROWS && c >= 0 && c < COLS ? this.grid[r][c] : null; return b && !b.slab ? b.k : -1; };
  P.fillStart = function () {
    for (var c = 0; c < COLS; c++) {
      var h = 3 + Math.floor(this.rng() * 4);
      for (var r = ROWS - 1; r >= ROWS - h; r--) {
        var k, tries = 0;
        do { k = Math.floor(this.rng() * NC); tries++; }
        while (tries < 20 && ((this.colorAt(r, c - 1) === k && this.colorAt(r, c - 2) === k) || (this.colorAt(r + 1, c) === k && this.colorAt(r + 2, c) === k)));
        this.grid[r][c] = this.block(k);
      }
    }
  };
  P.newRow = function () {
    var row = [];
    for (var c = 0; c < COLS; c++) {
      var k, tries = 0;
      do { k = Math.floor(this.rng() * NC); tries++; }
      while (tries < 20 && ((c >= 2 && row[c - 1] === k && row[c - 2] === k) || (this.colorAt(ROWS - 1, c) === k && this.colorAt(ROWS - 2, c) === k)));
      row.push(k);
    }
    return row;
  };
  P.riseMs = function () { return Math.max(CFG.riseMin, CFG.rise - Math.floor(this.elapsed / CFG.speedUpEvery) * CFG.riseStep); };
  P.die = function () { if (!this.dead) { this.dead = true; G.sfx && G.sfx('ko', this.opts.side); } };

  // ---------- input ----------
  var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  P.canSwapCell = function (b) { return !b || (!b.slab && b.st === 'idle'); };
  P.trySwap = function () {
    var r = this.cursor.r, c = this.cursor.c, g = this.grid, L = g[r][c], R = g[r][c + 1];
    if (!L && !R) return false;
    if (!this.canSwapCell(L) || !this.canSwapCell(R)) return false;
    // don't slide a panel under one that is already falling into that gap
    var above = function (cc) { var b = r > 0 ? g[r - 1][cc] : null; return b && (b.st === 'fall' || b.st === 'hang'); };
    if ((!L && above(c)) || (!R && above(c + 1))) return false;
    g[r][c] = R; g[r][c + 1] = L;
    if (R) { R.sw = CELL; R.chain = false; }
    if (L) { L.sw = -CELL; L.chain = false; }
    G.sfx && G.sfx('rotate', this.opts.side);
    return true;
  };
  P.handle = function (pad) {
    for (var k in DIRS) {
      if (!pad.repeat(k, 180, 60)) continue;
      this.cursor.r = Math.max(HID, Math.min(ROWS - 1, this.cursor.r + DIRS[k][0]));
      this.cursor.c = Math.max(0, Math.min(COLS - 2, this.cursor.c + DIRS[k][1]));
      G.sfx && G.sfx('move', this.opts.side);
    }
    if (pad.pressed('a') || pad.pressed('b')) this.trySwap();
    this.raising = pad.down('c') || pad.down('d');
  };

  // ---------- falling ----------
  P.slabCanFall = function (s) {
    var rb = s.r + s.h - 1;
    if (rb >= ROWS - 1) return false;
    for (var c = s.c; c < s.c + s.w; c++) if (this.grid[rb + 1][c]) return false;
    return true;
  };
  // Panels with nothing under them hang briefly, then fall (with everything stacked on them).
  P.markHang = function () {
    var g = this.grid;
    for (var r = ROWS - 2; r >= 0; r--) for (var c = 0; c < COLS; c++) {
      var b = g[r][c];
      if (!b || b.slab || b.st !== 'idle') continue;
      var below = g[r + 1][c];
      if (below && !(below.st === 'fall' || below.st === 'hang')) continue;
      var t = below && below.st === 'hang' ? below.t : CFG.hang;
      for (var rr = r; rr >= 0; rr--) {
        var x = g[rr][c];
        if (!x || x.slab || x.st !== 'idle') break;
        x.st = 'hang'; x.t = t;
      }
    }
  };
  P.fallStep = function () {
    var g = this.grid, tick = ++this.tick;
    for (var r = ROWS - 2; r >= 0; r--) for (var c = 0; c < COLS; c++) {
      var b = g[r][c];
      if (!b || b.mv === tick) continue;
      if (b.slab) {
        var s = b.slab;
        if (c !== s.c || r !== s.r + s.h - 1 || !this.slabCanFall(s)) continue;
        for (var rr = r; rr >= s.r; rr--) for (var cc = s.c; cc < s.c + s.w; cc++) { g[rr + 1][cc] = g[rr][cc]; g[rr][cc] = null; g[rr + 1][cc].mv = tick; }
        s.r++;
        continue;
      }
      if (b.st !== 'fall') continue;
      if (!g[r + 1][c]) { g[r + 1][c] = b; g[r][c] = null; b.mv = tick; }
      else { var u = g[r + 1][c]; if (u.slab || (u.st !== 'fall' && u.st !== 'hang')) b.st = 'idle'; }
    }
    for (var c2 = 0; c2 < COLS; c2++) { var bb = g[ROWS - 1][c2]; if (bb && bb.st === 'fall') bb.st = 'idle'; }
  };

  // ---------- matching ----------
  P.findMatches = function () {
    var g = this.grid, hit = [], r, c, e, k, q;
    function idle(rr, cc) { var b = g[rr][cc]; return b && !b.slab && b.st === 'idle' ? b.k : -1; }
    for (r = 0; r < ROWS; r++) { c = 0; while (c < COLS) { k = idle(r, c); e = c + 1; while (e < COLS && idle(r, e) === k) e++; if (k >= 0 && e - c >= 3) for (q = c; q < e; q++) hit.push([r, q]); c = e; } }
    for (c = 0; c < COLS; c++) { r = 0; while (r < ROWS) { k = idle(r, c); e = r + 1; while (e < ROWS && idle(e, c) === k) e++; if (k >= 0 && e - r >= 3) for (q = r; q < e; q++) hit.push([q, c]); r = e; } }
    var seen = {}, out = [];
    hit.forEach(function (p) { var key = p[0] * 8 + p[1]; if (!seen[key]) { seen[key] = 1; out.push(p); } });
    return out;
  };
  P.checkMatches = function () {
    var cells = this.findMatches(), self = this, g = this.grid;
    if (!cells.length) return;
    var grp = { t: CFG.clear + cells.length * 40, cells: cells, slabs: [] }, isChain = false;
    cells.forEach(function (p) {
      var b = g[p[0]][p[1]];
      if (b.chain) isChain = true;
      b.st = 'clear'; b.grp = grp;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var r2 = p[0] + o[0], c2 = p[1] + o[1];
        if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) return;
        var n = g[r2][c2];
        if (n && n.slab && grp.slabs.indexOf(n.slab) < 0) grp.slabs.push(n.slab);
      });
    });
    this.groups.push(grp);
    var n = cells.length;
    if (isChain) { this.chain++; this.say('CHAIN X' + this.chain, G.PAL.yellow); this.stopT = Math.max(this.stopT, CFG.stopChain); }
    else if (!this.chain) this.chain = 1;
    if (this.chain > this.maxChain) this.maxChain = this.chain;
    if (n >= 4) { this.say(n + ' COMBO', G.PAL.cyan); this.stopT = Math.max(this.stopT, CFG.stopCombo + n * 100); this.attack(n - 1); }
    this.score += n * 10 * Math.max(1, this.chain);
    G.sfx && G.sfx(isChain || n >= 4 ? 'big' : 'clear', this.opts.side);
  };
  P.finishGroup = function (grp) {
    var g = this.grid, self = this;
    grp.cells.forEach(function (p) {
      g[p[0]][p[1]] = null;
      // everything resting above this panel is now part of a possible chain
      for (var r = p[0] - 1; r >= 0; r--) { var b = g[r][p[1]]; if (!b || b.slab || b.st === 'clear') break; b.chain = true; }
    });
    grp.slabs.forEach(function (s) { if (self.slabs.indexOf(s) >= 0) self.breakSlab(s); });
  };
  // The bottom row of a slab turns back into panels; the rest stays garbage.
  P.breakSlab = function (s) {
    var rb = s.r + s.h - 1;
    for (var c = s.c; c < s.c + s.w; c++) { var b = this.block(Math.floor(this.rng() * NC)); b.chain = true; b.st = 'hang'; b.t = CFG.hang * 2; this.grid[rb][c] = b; }
    s.h--;
    if (s.h <= 0) this.slabs.splice(this.slabs.indexOf(s), 1);
    G.sfx && G.sfx('garbage', this.opts.side);
  };

  // ---------- attack ----------
  P.attack = function (units) {
    if (!this.vs || units <= 0) return;
    this.atkFrac += units * CFG.sendMul;
    var out = Math.floor(this.atkFrac); this.atkFrac -= out;
    this.send(out);
  };
  P.endChainIfDone = function () {
    if (!this.chain || this.groups.length) return;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) { var b = this.grid[r][c]; if (b && !b.slab && b.chain) return; }
    if (this.chain >= 2) this.attack((this.chain - 1) * 6);
    this.chain = 0;
  };
  // Incoming units become slabs that drop in from above the stack.
  P.dropGarbage = function () {
    var batches = this.takeReady(CFG.garbageDelay), self = this;
    if (!batches.length) return;
    // n counts garbage panels: each unit is worth CFG.unitPanels of them (6 panels = a full row).
    var n = this.carry, gap = 0;
    batches.forEach(function (b) { n += b.n * CFG.unitPanels; gap = b.gap; });
    var rows = Math.min(CFG.maxRows, Math.floor(n / 6)), rem = n - Math.floor(n / 6) * 6;
    this.carry = rem >= 3 ? 0 : rem;
    var list = [];
    if (rows) list.push({ w: 6, h: rows });
    if (rem >= 3) list.push({ w: rem, h: 1 });
    list.forEach(function (d) {
      var c = d.w === 6 ? 0 : Math.floor((gap / 1000) * (COLS - d.w + 1)) % (COLS - d.w + 1);
      var r = HID - d.h;
      while (r >= 0 && !self.areaFree(r, c, d.w, d.h)) r--;
      if (r < 0) { self.die(); return; }
      var s = { r: r, c: c, w: d.w, h: d.h };
      self.slabs.push(s);
      for (var rr = r; rr < r + d.h; rr++) for (var cc = c; cc < c + d.w; cc++) { var b = self.block(-1); b.slab = s; self.grid[rr][cc] = b; }
    });
    G.sfx && G.sfx('garbage', this.opts.side);
  };
  P.areaFree = function (r, c, w, h) {
    for (var rr = r; rr < r + h; rr++) for (var cc = c; cc < c + w; cc++) if (this.grid[rr][cc]) return false;
    return true;
  };

  // ---------- rising ----------
  P.topped = function () {
    for (var r = 0; r <= HID; r++) for (var c = 0; c < COLS; c++) {
      var b = this.grid[r][c];
      if (!b) continue;
      if (b.slab ? !this.slabCanFall(b.slab) : b.st === 'idle' || b.st === 'clear') return true;
    }
    return false;
  };
  P.pushRow = function () {
    if (this.grid[0].some(function (b) { return b; })) { this.die(); return; }
    this.grid.shift();
    var self = this;
    this.grid.push(this.preview.map(function (k) { return self.block(k); }));
    this.slabs.forEach(function (s) { s.r--; });
    this.preview = this.newRow();
    if (this.cursor.r > HID) this.cursor.r--;
    this.score++;
  };
  P.busy = function () {
    if (this.groups.length) return true;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) { var b = this.grid[r][c]; if (b && !b.slab && (b.st === 'fall' || b.st === 'hang')) return true; }
    return false;
  };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    var g = this.grid, r, c, b;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) { b = g[r][c]; if (b && b.sw) b.sw = b.sw > 0 ? Math.max(0, b.sw - dt * CELL / CFG.swapAnim) : Math.min(0, b.sw + dt * CELL / CFG.swapAnim); }
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);
    this.handle(pad);
    // timers
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) { b = g[r][c]; if (b && b.st === 'hang') { b.t -= dt; if (b.t <= 0) b.st = 'fall'; } }
    var self = this;
    this.groups = this.groups.filter(function (grp) { grp.t -= dt; if (grp.t <= 0) { self.finishGroup(grp); return false; } return true; });
    this.markHang();
    this.gAcc += dt;
    while (this.gAcc >= CFG.fallTick) { this.gAcc -= CFG.fallTick; this.fallStep(); }
    this.checkMatches();
    // panels that landed without matching lose their chain mark
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) { b = g[r][c]; if (b && b.chain && b.st === 'idle') { var u = r < ROWS - 1 ? g[r + 1][c] : null; if (r === ROWS - 1 || (u && (u.slab || u.st === 'idle' || u.st === 'clear'))) b.chain = false; } }
    this.endChainIfDone();
    // Garbage waits while you're clearing, but not forever: after 3 s it drops anyway.
    if (this.vs && this.pending.length && (!this.groups.length || this.pending[0].t >= CFG.forceDrop)) this.dropGarbage();
    if (this.dead) return;
    // rising and panic
    if (this.stopT > 0) this.stopT -= dt;
    var top = this.topped();
    if (top) {
      if (!this.groups.length) {
        var before = this.panicT; this.panicT += dt;
        if (Math.floor(this.panicT / 400) !== Math.floor(before / 400)) G.sfx && G.sfx('tick', this.opts.side);
        if (this.panicT >= CFG.panic) { this.die(); return; }
      }
      this.rise = 0;
    } else {
      this.panicT = Math.max(0, this.panicT - dt * 2);
      if (!this.groups.length && (this.stopT <= 0 || this.raising)) {
        if (this.raising) this.stopT = 0;
        this.rise += dt * CELL / (this.raising ? CFG.raise : this.riseMs());
        while (this.rise >= CELL && !this.dead) { this.rise -= CELL; this.pushRow(); if (this.topped()) { this.rise = 0; break; } }
      }
    }
  };

  // ---------- drawing ----------
  function symbol(ctx, k, cx, cy, s, col) {
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.beginPath();
    switch (k) {
      case 0:   // chevron
        ctx.moveTo(cx - s, cy + s * 0.5); ctx.lineTo(cx, cy - s * 0.6); ctx.lineTo(cx + s, cy + s * 0.5);
        ctx.lineTo(cx + s * 0.55, cy + s * 0.85); ctx.lineTo(cx, cy + s * 0.15); ctx.lineTo(cx - s * 0.55, cy + s * 0.85); ctx.closePath(); ctx.fill(); break;
      case 1:   // ring
        ctx.lineWidth = 2; ctx.arc(cx, cy, s * 0.75, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; break;
      case 2:   // X
        ctx.lineWidth = 2; ctx.moveTo(cx - s * 0.75, cy - s * 0.75); ctx.lineTo(cx + s * 0.75, cy + s * 0.75);
        ctx.moveTo(cx + s * 0.75, cy - s * 0.75); ctx.lineTo(cx - s * 0.75, cy + s * 0.75); ctx.stroke(); ctx.lineWidth = 1; break;
      case 3:   // 4-point sparkle
        ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.28, cy - s * 0.28); ctx.lineTo(cx + s, cy); ctx.lineTo(cx + s * 0.28, cy + s * 0.28);
        ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s * 0.28, cy + s * 0.28); ctx.lineTo(cx - s, cy); ctx.lineTo(cx - s * 0.28, cy - s * 0.28); ctx.closePath(); ctx.fill(); break;
      case 4:   // capsule
        var w = s * 0.45;
        ctx.moveTo(cx - w, cy - s * 0.45); ctx.arc(cx, cy - s * 0.45, w, Math.PI, 0); ctx.lineTo(cx + w, cy + s * 0.45);
        ctx.arc(cx, cy + s * 0.45, w, 0, Math.PI); ctx.closePath(); ctx.fill(); break;
    }
  }
  function panel(ctx, k, x, y, dim, flash) {
    var s = CELL;
    if (flash) { G.rect(x + 1, y + 1, s - 2, s - 2, '#fff'); return; }
    G.rect(x + 1, y + 1, s - 2, s - 2, DARK[k]);
    G.rect(x + 1, y + 1, s - 3, s - 3, LIGHT[k]);
    G.rect(x + 2, y + 2, s - 4, s - 4, COLORS[k]);
    symbol(ctx, k, x + s / 2, y + s / 2 + 1, s * 0.3, DARK[k]);
    symbol(ctx, k, x + s / 2, y + s / 2, s * 0.3, '#fff');
    if (dim) { ctx.globalAlpha = 0.55; G.rect(x + 1, y + 1, s - 2, s - 2, '#000'); ctx.globalAlpha = 1; }
  }

  P.draw = function (x, y) {
    var ctx = G.ctxRef(), bw = COLS * CELL, bh = VIS * CELL, bx = x + 30, by = y + 10, r, c;
    var bg = ctx.createLinearGradient(0, y, 0, y + 194); bg.addColorStop(0, '#0f2a3d'); bg.addColorStop(1, '#2d5a4a');
    ctx.fillStyle = bg; ctx.fillRect(x, y, 160, 194);
    var shake = this.panicT > 0 ? Math.round(Math.sin(Date.now() / 30) * Math.min(2, this.panicT / 600)) : 0;
    G.rect(bx - 3 + shake, by - 3, bw + 6, bh + 6, '#000');
    G.rect(bx - 2 + shake, by - 2, bw + 4, bh + 4, this.panicT > 0 && (Date.now() >> 7) & 1 ? G.PAL.red : '#4fd1c5');
    G.rect(bx - 1 + shake, by - 1, bw + 2, bh + 2, '#000');
    G.rect(bx + shake, by, bw, bh, '#0b1620');
    ctx.save(); ctx.beginPath(); ctx.rect(bx + shake, by, bw, bh); ctx.clip();
    var oy = by - HID * CELL - Math.round(this.rise), ox = bx + shake;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var b = this.grid[r][c];
      if (!b || b.slab) continue;
      var px = ox + c * CELL - Math.round(b.sw), py = oy + r * CELL;
      if (b.st === 'clear') {
        var left = b.grp.t, total = CFG.clear + b.grp.cells.length * 40;
        if (left > total - 450) panel(ctx, b.k, px, py, false, (left >> 6) & 1);
        else { var f = Math.max(0, (left - 80) / (total - 530)); ctx.globalAlpha = f; panel(ctx, b.k, px, py); ctx.globalAlpha = 1; }
      } else panel(ctx, b.k, px, py);
    }
    // garbage slabs
    this.slabs.forEach(function (s) {
      var px = ox + s.c * CELL, py = oy + s.r * CELL, w = s.w * CELL, h = s.h * CELL;
      G.rect(px + 1, py + 1, w - 2, h - 2, '#2a2236');
      G.rect(px + 2, py + 2, w - 4, h - 4, '#6c5a86');
      G.rect(px + 2, py + 2, w - 4, 2, '#9a86b8');
      for (var i = 0; i < s.h; i++) for (var j = 0; j < s.w; j++) if ((i + j) % 2 === 0) G.rect(px + j * CELL + 5, py + i * CELL + 5, 4, 4, '#4f4163');
    });
    // the next row coming up (dimmed)
    var self = this;
    this.preview.forEach(function (k, cc) { panel(ctx, k, ox + cc * CELL, oy + ROWS * CELL, true); });
    // cursor
    if (!this.dead) {
      var cx = ox + this.cursor.c * CELL, cy = oy + this.cursor.r * CELL, col = this.opts.side ? '#a8ecff' : '#ffffff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(cx - 0.5, cy - 0.5, CELL * 2 + 1, CELL + 1);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(cx - 0.5, cy - 0.5, CELL * 2 + 1, CELL + 1);
      G.rect(cx + CELL, cy, 1, CELL, col);
    }
    ctx.restore();
    // garbage still above the top
    var above = this.slabs.some(function (s) { return s.r < HID; });
    if (above) G.text('!', bx + bw / 2, by - 9, (Date.now() >> 7) & 1 ? G.PAL.red : G.PAL.amber, { font: 'small', align: 'center' });
    this.drawPendingBar(bx - 10, by, bh, CELL / 3, CFG.garbageDelay);
    // right panel
    var rx = bx + bw + 8;
    G.text('SCORE', rx + 13, by + 4, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.score), rx + 13, by + 13, G.PAL.green, { font: 'small', align: 'center' });
    G.text('CHAIN', rx + 13, by + 32, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.maxChain), rx + 13, by + 41, G.PAL.yellow, { font: 'small', align: 'center' });
    G.text('SPEED', rx + 13, by + 60, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(1 + Math.floor(this.elapsed / CFG.speedUpEvery)), rx + 13, by + 69, G.PAL.cyan, { font: 'small', align: 'center' });
    if (this.stopT > 0 && !this.dead) G.text('STOP', rx + 13, by + 92, (Date.now() >> 8) & 1 ? G.PAL.white : G.PAL.amber, { font: 'small', align: 'center' });
    if (this.panicT > 0 && !this.dead) G.text('DANGER', rx + 13, by + 106, (Date.now() >> 7) & 1 ? G.PAL.red : G.PAL.white, { font: 'small', align: 'center' });
    this.drawFlash(bx + bw / 2, by + 60);
    if (this.dead) { ctx.globalAlpha = 0.55; G.rect(bx - 3, by - 3, bw + 6, bh + 6, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  // Looks for one panel to slide along its row (a chain of swaps) that makes a match after
  // things settle. With nothing to match it raises a low stack or flattens a tall column.
  var LEVELS = {
    1: { think: 2400, step: 320, mistake: 0.55, raise: 6 }, 2: { think: 2000, step: 280, mistake: 0.45, raise: 6 },
    3: { think: 1600, step: 240, mistake: 0.35, raise: 7 }, 4: { think: 1000, step: 170, mistake: 0.22, raise: 7 },
    5: { think: 600, step: 110, mistake: 0.12, raise: 8 }, 6: { think: 420, step: 85, mistake: 0.07, raise: 8 },
    7: { think: 280, step: 60, mistake: 0.04, raise: 8 }, 8: { think: 160, step: 40, mistake: 0.01, raise: 9 }
  };
  function snapshot(t) {
    return t.grid.map(function (row) { return row.map(function (b) { return !b ? -1 : b.slab ? -2 : b.st === 'idle' ? b.k : -3; }); });
  }
  function settle(m) {
    for (var c = 0; c < COLS; c++) {
      var w = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) {
        var v = m[r][c];
        if (v === -2 || v === -3) w = r - 1;          // fixed obstacles
        else if (v >= 0) { if (w !== r) { m[w][c] = v; m[r][c] = -1; } w--; }
      }
    }
  }
  function matchInfo(m) {
    var hit = {}, n = 0, r, c, e, k, q;
    for (r = 0; r < ROWS; r++) { c = 0; while (c < COLS) { k = m[r][c]; e = c + 1; while (e < COLS && m[r][e] === k) e++; if (k >= 0 && e - c >= 3) for (q = c; q < e; q++) hit[r * 8 + q] = 1; c = e; } }
    for (c = 0; c < COLS; c++) { r = 0; while (r < ROWS) { k = m[r][c]; e = r + 1; while (e < ROWS && m[e][c] === k) e++; if (k >= 0 && e - r >= 3) for (q = r; q < e; q++) hit[q * 8 + c] = 1; r = e; } }
    var garb = 0;
    for (var key in hit) {
      n++; var rr = Math.floor(key / 8), cc = key % 8;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) { var r2 = rr + o[0], c2 = cc + o[1]; if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && m[r2][c2] === -2) garb++; });
    }
    return { n: n, garb: garb };
  }
  function heights(m) {
    var hs = [];
    for (var c = 0; c < COLS; c++) { var h = 0; for (var r = 0; r < ROWS; r++) if (m[r][c] !== -1) { h = ROWS - r; break; } hs.push(h); }
    return hs;
  }
  function SwapCPU(track, level) { this.t = track; this.cfg = LEVELS[Math.max(1, Math.min(8, level))]; this.script = []; this.wait = this.cfg.think; this.tap = false; this.hold = 0; }
  SwapCPU.prototype.plan = function () {
    var t = this.t, m = snapshot(t), moves = [], r, c, to;
    for (r = HID; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      if (m[r][c] < 0) continue;
      for (var dir = -1; dir <= 1; dir += 2) for (to = c + dir; to >= 0 && to < COLS; to += dir) {
        if (m[r][to] === -2 || m[r][to] === -3) break;
        var mm = m.map(function (x) { return x.slice(); }), row = mm[r], v = row.splice(c, 1)[0];
        row.splice(to, 0, v);
        settle(mm);
        var info = matchInfo(mm);
        if (!info.n) continue;
        var steps = Math.abs(to - c);
        moves.push({ r: r, c: c, to: to, sc: info.n * 10 + (info.n >= 4 ? 25 : 0) + info.garb * 12 + r - steps * 3 });
      }
    }
    var hs = heights(m), maxH = Math.max.apply(null, hs) - HID > 0 ? Math.max.apply(null, hs) : 0;
    if (!moves.length) {
      if (maxH < this.cfg.raise && !t.busy()) { this.script = ['raise']; return; }
      // flatten: slide the top panel of the tallest column toward a lower neighbour
      var tall = hs.indexOf(Math.max.apply(null, hs)), dirs = [];
      if (tall > 0 && hs[tall - 1] < hs[tall] - 1) dirs.push(-1);
      if (tall < COLS - 1 && hs[tall + 1] < hs[tall] - 1) dirs.push(1);
      if (!dirs.length) { this.script = []; return; }
      var d = dirs[Math.floor(t.rng() * dirs.length)], rr = ROWS - hs[tall];
      if (m[rr][tall] < 0) { this.script = []; return; }
      moves.push({ r: rr, c: tall, to: tall + d, sc: 0 });
    }
    moves.sort(function (a, b) { return b.sc - a.sc; });
    var best = moves[0];
    if (moves.length > 1 && t.rng() < this.cfg.mistake) best = moves[Math.min(moves.length - 1, 1 + Math.floor(t.rng() * 3))];
    this.build(best);
  };
  SwapCPU.prototype.build = function (mv) {
    var t = this.t, s = [], cr = t.cursor.r, cc = t.cursor.c, dir = mv.to > mv.c ? 1 : -1, pos = mv.c;
    function goTo(r, c) { while (cr < r) { s.push('down'); cr++; } while (cr > r) { s.push('up'); cr--; } while (cc < c) { s.push('right'); cc++; } while (cc > c) { s.push('left'); cc--; } }
    while (pos !== mv.to) { goTo(mv.r, dir > 0 ? pos : pos - 1); s.push('a'); pos += dir; }
    this.script = s;
  };
  SwapCPU.prototype.drive = function (dt, pad) {
    var st = {}, t = this.t;
    if (this.hold > 0) { this.hold -= dt; st.c = true; pad.feed(st, dt); return; }
    if (this.tap) { this.tap = false; pad.feed(st, dt); return; }
    this.wait -= dt;
    if (this.wait > 0) { pad.feed(st, dt); return; }
    if (!this.script.length) {
      if (t.groups.length || t.busy()) { this.wait = 60; pad.feed(st, dt); return; }   // let things settle before planning
      this.plan();
      if (!this.script.length) { this.wait = this.cfg.think; pad.feed(st, dt); return; }
    }
    var b = this.script.shift();
    if (b === 'raise') { this.hold = CFG.raise; this.wait = this.cfg.think; pad.feed({ c: true }, dt); return; }
    st[b] = true; this.tap = true;
    this.wait = this.script.length ? this.cfg.step : this.cfg.think * (0.6 + t.rng() * 0.8);
    pad.feed(st, dt);
  };

  G.registerTrack('swap', {
    name: 'SWAP', blurb: 'SWAP PANELS, RISING STACK', color: '#4fd1c5',
    make: function (opts) { return new Swap(opts); }
  });
})(globalThis.G = globalThis.G || {});
