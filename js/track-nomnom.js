// NOM NOM! PETS: Baku Baku-style pets and food as a track.
// Pairs of blocks fall into a 6x12 field. Each block is a food or a pet's head:
// dog + bone, cat + fish, bunny + carrot, mouse + cheese. A head that touches its own food eats
// that food and every matching food connected to it, then leaves. A rare coin clears every block
// of the kind it lands on. Blocks left hanging fall and can make chains.
// Incoming units drop wrapped food on top: 5 per unit (almost a row). A wrapped block can't be eaten
// until something next to it is eaten, which unwraps it. You lose when the drop point is blocked.
(function (G) {
  'use strict';

  var COLS = 6, ROWS = 12, CELL = 14, NK = 4, SPAWN_C = 2;
  var COIN = 99;   // block codes: food k = k, head k = 10 + k, wrapped food k = 20 + k, coin = 99
  var CFG = {
    fall: 850, fallMin: 130, fallStep: 65, speedUpEvery: 30000,
    soft: 45, lockDelay: 400, das: 150, arr: 50,
    garbageDelay: 1000, maxGarbage: 4,                 // units landing per piece
    perUnit: G.NOM_PER || 5,                            // wrapped blocks dropped per unit
    flash: 380, settle: 140,
    headOdds: 0.27, headMin: 0.16, headStep: 0.015, coinOdds: 0.025,   // heads get rarer every 30 s
    sendMul: G.NOM_SEND || 0.13                         // mixed-play balance (tools/sim.js)
  };
  var TINT = ['#e09a3c', '#4fa8ff', '#ff7fb0', '#ffd84a'];    // dog, cat, bunny, mouse
  var TDARK = ['#5a3510', '#123e70', '#7a1f48', '#6e5408'];
  var NAMES = ['DOG', 'CAT', 'BUNNY', 'MOUSE'];
  var OFS = [[-1, 0], [0, 1], [1, 0], [0, -1]];               // satellite: up, right, down, left

  function isFood(v) { return v >= 0 && v < NK; }
  function isHead(v) { return v >= 10 && v < 10 + NK; }
  function isWrap(v) { return v >= 20 && v < 20 + NK; }
  function kindOf(v) { return isFood(v) ? v : isHead(v) ? v - 10 : isWrap(v) ? v - 20 : -1; }
  function emptyGrid() { var g = []; for (var r = 0; r < ROWS; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(-1); g.push(row); } return g; }
  function copyGrid(g) { return g.map(function (r) { return r.slice(); }); }
  function colH(g, c) { for (var r = 0; r < ROWS; r++) if (g[r][c] >= 0) return ROWS - r; return 0; }
  function gravity(g) {
    var moved = false;
    for (var c = 0; c < COLS; c++) {
      var w = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) if (g[r][c] >= 0) { var v = g[r][c]; g[r][c] = -1; if (w !== r) moved = true; g[w--][c] = v; }
    }
    return moved;
  }
  // One resolve step: coins first, then every head touching its food eats the connected food.
  // Returns { hit, eaten, coinHits } (eaten = food + heads removed, coinHits = blocks a coin cleared).
  function findEats(g) {
    var hit = g.map(function (r) { return r.map(function () { return false; }); }), eaten = 0, coinHits = 0, r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (g[r][c] === COIN) {
      hit[r][c] = true;
      var below = r + 1 < ROWS ? g[r + 1][c] : -1, k = kindOf(below);
      if (k >= 0) for (var r2 = 0; r2 < ROWS; r2++) for (var c2 = 0; c2 < COLS; c2++) if (kindOf(g[r2][c2]) === k && !hit[r2][c2]) { hit[r2][c2] = true; coinHits++; }
    }
    var N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var v = g[r][c];
      if (!isHead(v) || hit[r][c]) continue;
      var kk = v - 10, stack = [], ate = false;
      N.forEach(function (o) { var r2 = r + o[0], c2 = c + o[1]; if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] === kk) stack.push([r2, c2]); });
      while (stack.length) {
        var p = stack.pop();
        if (hit[p[0]][p[1]]) continue;
        hit[p[0]][p[1]] = true; ate = true; eaten++;
        N.forEach(function (o) { var r2 = p[0] + o[0], c2 = p[1] + o[1]; if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] === kk && !hit[r2][c2]) stack.push([r2, c2]); });
      }
      if (ate) { hit[r][c] = true; eaten++; }
    }
    return { hit: hit, eaten: eaten, coinHits: coinHits, any: eaten + coinHits > 0 || hit.some(function (row) { return row.some(Boolean); }) };
  }
  // Clear the hits; wrapped food next to anything eaten unwraps. Returns how many unwrapped.
  function clearHits(g, hit) {
    var un = 0, r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var r2 = r + o[0], c2 = c + o[1];
        if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && !hit[r2][c2] && isWrap(g[r2][c2])) { g[r2][c2] -= 20; un++; }
      });
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) g[r][c] = -1;
    return un;
  }
  // Units for one chain step (step = 1 for the first).
  function stepUnits(step, eaten, coinHits) { return eaten / 3 + (step - 1) * 1.5 + coinHits / 4; }

  function Nom(opts) {
    this.initBase(opts);
    this.vs = opts.sendOn !== false;
    this.grid = emptyGrid();
    this.score = 0; this.eaten = 0; this.elapsed = 0;
    this.state = 'fall'; this.phaseT = 0;
    this.next = this.newPair();
    this.spawn();
    if (opts.cpuLevel) this.cpu = new NomCPU(this, opts.cpuLevel);
  }
  var P = Nom.prototype;
  Object.assign(P, G.TrackBase);

  // weapon effects
  P.fxSafe = function () { return this.state === 'fall'; };
  P.fxWipe = function () { this.grid = emptyGrid(); };
  P.fxRemove = function () { this.grid.pop(); var row = []; for (var c = 0; c < COLS; c++) row.push(-1); this.grid.unshift(row); gravity(this.grid); };
  P.newBlock = function () {
    var x = this.rng(), k = Math.floor(this.rng() * NK);
    if (x < CFG.coinOdds) return COIN;
    var ho = Math.max(CFG.headMin, CFG.headOdds - Math.floor(this.elapsed / CFG.speedUpEvery) * CFG.headStep);
    return x < CFG.coinOdds + ho ? 10 + k : k;
  };
  P.newPair = function () {
    var a = this.newBlock(), b = this.newBlock();
    if (a === COIN && b === COIN) b = Math.floor(this.rng() * NK);
    return [a, b];   // [pivot, satellite]
  };
  P.spawn = function () {
    this.piece = { r: 1, c: SPAWN_C, rot: 0, b: this.next };
    this.next = this.newPair();
    this.fallT = 0; this.lockT = 0; this.dasDir = 0;
    if (this.grid[1][SPAWN_C] >= 0 || this.grid[0][SPAWN_C] >= 0) this.die();
  };
  P.cellFree = function (r, c) { return c >= 0 && c < COLS && r < ROWS && (r < 0 || this.grid[r][c] < 0); };
  P.fits = function (r, c, rot) { var o = OFS[rot]; return this.cellFree(r, c) && this.cellFree(r + o[0], c + o[1]); };
  P.landed = function () { var p = this.piece; return !this.fits(p.r + 1, p.c, p.rot); };
  P.speed = function () { return Math.max(CFG.fallMin, CFG.fall - Math.floor(this.elapsed / CFG.speedUpEvery) * CFG.fallStep); };
  P.die = function () { if (!this.dead) { this.dead = true; this.state = 'over'; G.sfx && G.sfx('ko', this.opts.side); } };

  P.shift = function (dx) {
    var p = this.piece;
    if (!this.fits(p.r, p.c + dx, p.rot)) return false;
    p.c += dx; this.lockT = 0; G.sfx && G.sfx('move', this.opts.side); return true;
  };
  P.rotate = function (dir) {
    var p = this.piece, nr = (p.rot + dir + 4) % 4;
    var tries = [[0, 0], [0, -OFS[nr][1]], [-OFS[nr][0], 0], [-1, 0]];
    for (var i = 0; i < tries.length; i++) {
      if (this.fits(p.r + tries[i][0], p.c + tries[i][1], nr)) {
        p.r += tries[i][0]; p.c += tries[i][1]; p.rot = nr; this.lockT = 0;
        G.sfx && G.sfx('rotate', this.opts.side); return true;
      }
    }
    // boxed in on both sides: flip straight over
    var fr = (p.rot + 2) % 4;
    if (this.fits(p.r, p.c, fr) || this.fits(p.r - 1, p.c, fr)) {
      if (!this.fits(p.r, p.c, fr)) p.r--;
      p.rot = fr; G.sfx && G.sfx('rotate', this.opts.side); return true;
    }
    return false;
  };
  P.dropRow = function () { var p = this.piece, r = p.r; while (this.fits(r + 1, p.c, p.rot)) r++; return r; };

  P.handle = function (dt, pad) {
    if (pad.pressed('a')) this.rotate(-1);
    if (pad.pressed('b')) this.rotate(1);
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
    var p = this.piece, o = OFS[p.rot], cells = [[p.r, p.c, p.b[0]], [p.r + o[0], p.c + o[1], p.b[1]]], self = this, over = false;
    cells.forEach(function (x) { if (x[0] < 0) over = true; else self.grid[x[0]][x[1]] = x[2]; });
    this.piece = null;
    G.sfx && G.sfx('lock', this.opts.side);
    this.mark('piece');
    this.overflow = over;
    this.chain = 0; this.attack = 0; this.eatNow = 0; this.coinNow = 0;
    if (gravity(this.grid)) { this.state = 'settle'; this.phaseT = CFG.settle; }
    else this.resolveCheck();
  };
  P.resolveCheck = function () {
    var m = findEats(this.grid);
    if (!m.any) { this.finishResolve(); return; }
    var real = m.eaten + m.coinHits > 0;
    if (real) {
      this.chain++;
      this.eaten += m.eaten + m.coinHits; this.eatNow += m.eaten; this.coinNow += m.coinHits;
      this.score += (m.eaten + m.coinHits) * 10 * this.chain * this.chain;
      this.attack += stepUnits(this.chain, m.eaten, m.coinHits);
      if (this.chain > 1) this.say('CHAIN X' + this.chain, G.PAL.yellow);
      else if (m.coinHits) this.say('COIN! ' + m.coinHits, G.PAL.amber);
      else if (m.eaten >= 7) this.say('NOM NOM! ' + m.eaten, G.PAL.pink);
      G.sfx && G.sfx(this.chain > 1 || m.coinHits >= 6 ? 'big' : 'clear', this.opts.side);
    }
    this.hits = m.hit;
    this.state = 'flash'; this.phaseT = real ? CFG.flash : 120;
  };
  P.finishResolve = function () {
    if (this.chain > 1 || this.eatNow >= 7 || this.coinNow >= 6) this.mark('big');
    if (this.vs && this.attack > 0) {
      this.atkFrac = (this.atkFrac || 0) + this.attack * CFG.sendMul;
      var out = Math.floor(this.atkFrac); this.atkFrac -= out;
      this.send(out);
    }
    if (this.overflow && !this.chain) { this.die(); return; }
    if (!this.chain || !this.vs) this.landGarbage();
    if (this.dead) return;
    this.state = 'fall';
    this.spawn();
  };
  // Food drops in on top: 3 blocks per unit, spread across the columns from the batch's start column.
  P.landGarbage = function () {
    if (!this.vs) return;
    var batches = this.takeReady(CFG.garbageDelay, CFG.maxGarbage), self = this, any = false;
    batches.forEach(function (b) {
      var start = Math.floor((b.gap / 1000) * COLS) % COLS, n = Math.round(b.n * CFG.perUnit);
      for (var i = 0; i < n; i++) {
        var c = (start + i * 2 + Math.floor(i / 3)) % COLS;   // 1 unit = every other column, 2 units = a full row
        var h = colH(self.grid, c);
        if (h >= ROWS) { self.die(); return; }
        self.grid[ROWS - 1 - h][c] = 20 + Math.floor(self.rng() * NK);
        any = true;
      }
    });
    if (any) G.sfx && G.sfx('garbage', this.opts.side);
  };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);
    if (this.state === 'fall') { if (this.piece) this.handle(dt, pad); }
    else if (this.state === 'flash') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { var un = clearHits(this.grid, this.hits); if (un) this.say(un > 1 ? un + ' UNWRAPPED' : 'UNWRAPPED', G.PAL.beige); this.hits = null; gravity(this.grid); this.state = 'settle'; this.phaseT = CFG.settle; }
    } else if (this.state === 'settle') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.resolveCheck();
    }
  };

  // ---------- drawing (all original pixel art) ----------
  function R(x, y, w, h, c) { G.rect(x, y, w, h, c); }
  function food(k, x, y) {
    R(x + 1, y + 1, 12, 12, TDARK[k]);
    R(x + 2, y + 2, 10, 10, '#1b1424');
    switch (k) {
      case 0:   // bone
        R(x + 4, y + 6, 6, 2, '#f4ead2'); R(x + 3, y + 5, 2, 2, '#f4ead2'); R(x + 3, y + 7, 2, 2, '#f4ead2');
        R(x + 9, y + 5, 2, 2, '#f4ead2'); R(x + 9, y + 7, 2, 2, '#f4ead2'); break;
      case 1:   // fish
        R(x + 3, y + 5, 6, 4, '#8fd0ff'); R(x + 4, y + 4, 4, 6, '#8fd0ff'); R(x + 9, y + 4, 2, 2, '#5aa0e0'); R(x + 9, y + 8, 2, 2, '#5aa0e0');
        R(x + 9, y + 6, 1, 2, '#5aa0e0'); R(x + 4, y + 6, 1, 1, '#123e70'); break;
      case 2:   // carrot
        R(x + 5, y + 5, 4, 2, '#ff8a1e'); R(x + 6, y + 7, 3, 2, '#ff8a1e'); R(x + 7, y + 9, 1, 2, '#ff8a1e');
        R(x + 5, y + 3, 1, 2, '#5cff7a'); R(x + 7, y + 2, 1, 3, '#5cff7a'); R(x + 8, y + 3, 1, 2, '#5cff7a'); break;
      case 3:   // cheese wedge
        R(x + 3, y + 7, 8, 4, '#ffd84a'); R(x + 5, y + 5, 6, 2, '#ffd84a'); R(x + 8, y + 3, 3, 2, '#ffd84a');
        R(x + 5, y + 8, 2, 1, '#b08a10'); R(x + 9, y + 6, 1, 2, '#b08a10'); break;
    }
  }
  function head(k, x, y) {
    var c = TINT[k], d = TDARK[k];
    // ears first so the face sits over them
    if (k === 0) { R(x + 1, y + 3, 3, 7, d); R(x + 10, y + 3, 3, 7, d); }                       // floppy
    if (k === 1) { R(x + 2, y + 1, 3, 3, c); R(x + 9, y + 1, 3, 3, c); R(x + 3, y + 1, 1, 1, d); R(x + 10, y + 1, 1, 1, d); }   // pointy
    if (k === 2) { R(x + 4, y, 2, 5, c); R(x + 8, y, 2, 5, c); R(x + 4, y + 1, 1, 3, '#fff'); R(x + 8, y + 1, 1, 3, '#fff'); } // long
    if (k === 3) { R(x + 1, y + 2, 4, 4, c); R(x + 9, y + 2, 4, 4, c); R(x + 2, y + 3, 2, 2, d); R(x + 10, y + 3, 2, 2, d); }  // round
    R(x + 3, y + 3, 8, 9, c); R(x + 2, y + 4, 10, 7, c);
    R(x + 3, y + 11, 8, 1, d);
    R(x + 4, y + 6, 2, 2, '#000'); R(x + 8, y + 6, 2, 2, '#000');
    R(x + 4, y + 6, 1, 1, '#fff'); R(x + 8, y + 6, 1, 1, '#fff');
    R(x + 6, y + 8, 2, 1, d); R(x + 5, y + 9, 4, 1, '#3a1020');
  }
  function coin(x, y) {
    R(x + 3, y + 2, 8, 10, '#8a5a00'); R(x + 2, y + 3, 10, 8, '#8a5a00');
    R(x + 3, y + 3, 8, 8, '#ffc93a'); R(x + 4, y + 2, 6, 1, '#ffe27a');
    R(x + 6, y + 4, 2, 6, '#c88a10'); R(x + 5, y + 5, 4, 1, '#c88a10'); R(x + 5, y + 8, 4, 1, '#c88a10');
  }
  // Wrapped food: a grey parcel with a ribbon in its pet's colour.
  function wrapped(k, x, y) {
    R(x + 1, y + 1, 12, 12, '#2c2734'); R(x + 2, y + 2, 10, 10, '#8a8296'); R(x + 2, y + 2, 10, 1, '#b4adc0');
    R(x + 6, y + 2, 2, 10, TINT[k]); R(x + 2, y + 6, 10, 2, TINT[k]);
    R(x + 4, y + 1, 2, 2, TINT[k]); R(x + 8, y + 1, 2, 2, TINT[k]);
  }
  function block(v, x, y) { if (v === COIN) coin(x, y); else if (isHead(v)) head(v - 10, x, y); else if (isFood(v)) food(v, x, y); else if (isWrap(v)) wrapped(v - 20, x, y); }

  P.draw = function (x, y) {
    var ctx = G.ctxRef(), bw = COLS * CELL, bh = ROWS * CELL, bx = x + 30, by = y + 8, r, c;
    var g = ctx.createLinearGradient(0, y, 0, y + 194); g.addColorStop(0, '#3a1d3a'); g.addColorStop(1, '#5c3a1c');
    ctx.fillStyle = g; ctx.fillRect(x, y, 160, 194);
    R(bx - 3, by - 3, bw + 6, bh + 6, '#000');
    R(bx - 2, by - 2, bw + 4, bh + 4, '#ff9ec8');
    R(bx - 1, by - 1, bw + 2, bh + 2, '#000');
    R(bx, by, bw, bh, '#140e1c');
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if ((r + c) & 1) R(bx + c * CELL, by + r * CELL, CELL, CELL, '#18111f');
    // drop point marker
    R(bx + SPAWN_C * CELL + 5, by - 3, 4, 1, G.PAL.red);
    var flashOn = (this.phaseT >> 6) & 1;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var v = this.grid[r][c];
      if (v < 0) continue;
      var px = bx + c * CELL, py = by + r * CELL;
      if (this.state === 'flash' && this.hits && this.hits[r][c] && flashOn) { R(px + 1, py + 1, CELL - 2, CELL - 2, '#fff'); continue; }
      block(v, px, py);
    }
    if (this.piece && !this.dead) {
      var p = this.piece, o = OFS[p.rot], dr = this.dropRow();
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      [[dr, p.c], [dr + o[0], p.c + o[1]]].forEach(function (q) { ctx.strokeRect(bx + q[1] * CELL + 1.5, by + q[0] * CELL + 1.5, CELL - 3, CELL - 3); });
      block(p.b[0], bx + p.c * CELL, by + p.r * CELL);
      block(p.b[1], bx + (p.c + o[1]) * CELL, by + (p.r + o[0]) * CELL);
      ctx.restore();
    }
    // incoming: one unit is half a row, so 2 units fill one cell of the bar
    this.drawPendingBar(bx - 10, by, bh, CELL / 2, CFG.garbageDelay);
    var rx = bx + bw + 8;
    G.text('NEXT', rx + 13, by + 2, G.PAL.beige, { font: 'small', align: 'center' });
    R(rx, by + 10, 26, 2 * CELL + 6, '#000');
    block(this.next[1], rx + 6, by + 13); block(this.next[0], rx + 6, by + 13 + CELL);
    G.text('SCORE', rx + 13, by + 56, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.score), rx + 13, by + 65, G.PAL.green, { font: 'small', align: 'center' });
    G.text('EATEN', rx + 13, by + 82, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.eaten), rx + 13, by + 91, G.PAL.amber, { font: 'small', align: 'center' });
    G.text('SPEED', rx + 13, by + 108, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(1 + Math.floor(this.elapsed / CFG.speedUpEvery)), rx + 13, by + 117, G.PAL.cyan, { font: 'small', align: 'center' });
    this.drawFlash(bx + bw / 2, by + 70);
    if (this.dead) { ctx.globalAlpha = 0.55; R(bx - 3, by - 3, bw + 6, bh + 6, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  // Tries every column x 4 turns, plays out the eating, and scores the board left behind.
  var LEVELS = {
    1: { think: 900, step: 220, mistake: 0.40, look: 0 }, 2: { think: 750, step: 180, mistake: 0.30, look: 0 },
    3: { think: 600, step: 150, mistake: 0.22, look: 0 }, 4: { think: 480, step: 120, mistake: 0.15, look: 1 },
    5: { think: 380, step: 100, mistake: 0.10, look: 1 }, 6: { think: 300, step: 80, mistake: 0.06, look: 1 },
    7: { think: 220, step: 65, mistake: 0.03, look: 1 }, 8: { think: 150, step: 50, mistake: 0.01, look: 1 }
  };
  // Drop a pair at pivot column c with turn rot. Returns null if it can't be placed.
  function simulate(grid, c, rot, pair) {
    var o = OFS[rot], c2 = c + o[1];
    if (c < 0 || c >= COLS || c2 < 0 || c2 >= COLS) return null;
    var g = copyGrid(grid), order = o[0] > 0 ? [[c2, pair[1]], [c, pair[0]]] : [[c, pair[0]], [c2, pair[1]]];
    for (var i = 0; i < 2; i++) {
      var h = colH(g, order[i][0]);
      if (h >= ROWS) return null;
      g[ROWS - 1 - h][order[i][0]] = order[i][1];
    }
    var chain = 0, units = 0, ate = 0;
    for (;;) {
      var m = findEats(g);
      if (!m.any) break;
      if (m.eaten + m.coinHits) { chain++; ate += m.eaten + m.coinHits; units += stepUnits(chain, m.eaten, m.coinHits); }
      clearHits(g, m.hit); gravity(g);
    }
    return { g: g, chain: chain, units: units, ate: ate, over: g[1][SPAWN_C] >= 0 || g[0][SPAWN_C] >= 0 };
  }
  function evalBoard(g) {
    var hs = [], max = 0, bump = 0, groups = 0, buried = 0, wraps = 0, r, c;
    for (c = 0; c < COLS; c++) { var h = colH(g, c); hs.push(h); if (h > max) max = h; if (c) bump += Math.abs(h - hs[c - 1]); }
    var heads = [0, 0, 0, 0];
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var v = g[r][c];
      if (isFood(v)) {
        if (c + 1 < COLS && g[r][c + 1] === v) groups++;
        if (r + 1 < ROWS && g[r + 1][c] === v) groups++;
      } else if (isWrap(v)) wraps++;
      else if (isHead(v)) {
        heads[v - 10]++;
        // a head with blocks piled on it is hard to bring to its food
        for (var r2 = r - 1; r2 >= 0 && g[r2][c] >= 0; r2--) buried++;
      }
    }
    var danger = max > ROWS - 4 ? (max - (ROWS - 4)) * 60 : 0;
    var spawnRisk = hs[SPAWN_C] > ROWS - 3 ? 300 : 0;
    return groups * 3 - buried * 1.5 - wraps * 1.5 - max * 4 - bump * 2 - danger - spawnRisk;
  }
  function NomCPU(track, level) { this.t = track; this.cfg = LEVELS[Math.max(1, Math.min(8, level))]; this.plan = null; this.wait = this.cfg.think; this.tap = false; }
  NomCPU.prototype.choose = function () {
    var t = this.t, p = t.piece, best = null, all = [], cfg = this.cfg;
    for (var c = 0; c < COLS; c++) for (var rot = 0; rot < 4; rot++) {
      var s = simulate(t.grid, c, rot, p.b);
      if (!s || s.over) continue;
      var sc = s.ate * 8 + s.units * 40 + s.chain * 15 + evalBoard(s.g);
      if (cfg.look) {
        var bestN = -1e9;
        for (var c2 = 0; c2 < COLS; c2++) for (var r2 = 0; r2 < 4; r2++) { var s2 = simulate(s.g, c2, r2, t.next); if (s2 && !s2.over) bestN = Math.max(bestN, s2.ate * 6 + s2.units * 30); }
        if (bestN > -1e9) sc += bestN * 0.5;
      }
      var mv = { c: c, rot: rot, sc: sc };
      all.push(mv);
      if (!best || sc > best.sc) best = mv;
    }
    if (!best) return { c: p.c, rot: p.rot };
    if (all.length > 1 && t.rng() < cfg.mistake) {
      all.sort(function (a, b) { return b.sc - a.sc; });
      best = all[Math.min(all.length - 1, 1 + Math.floor(t.rng() * 3))];
    }
    return best;
  };
  NomCPU.prototype.drive = function (dt, pad) {
    var st = {}, t = this.t;
    if (t.state !== 'fall' || !t.piece) { this.plan = null; this.wait = this.cfg.think * (0.6 + t.rng() * 0.8); pad.feed(st, dt); return; }
    if (this.tap) { this.tap = false; pad.feed(st, dt); return; }
    this.wait -= dt;
    if (this.wait > 0) { pad.feed(st, dt); return; }
    if (!this.plan || this.plan.piece !== t.piece) { var ch = this.choose(); this.plan = { piece: t.piece, c: ch.c, rot: ch.rot, turns: 0 }; }
    var pl = this.plan, p = t.piece;
    if (p.rot !== pl.rot && pl.turns < 6) { st.b = true; pl.turns++; }
    else if (p.c < pl.c) st.right = true;
    else if (p.c > pl.c) st.left = true;
    else st.d = true;
    if ((st.left || st.right) && !t.fits(p.r, p.c + (st.left ? -1 : 1), p.rot)) st = { d: true };
    this.tap = true; this.wait = this.cfg.step;
    pad.feed(st, dt);
  };

  G.registerTrack('nomnom', {
    name: 'NOM NOM! PETS', blurb: 'FEED EACH PET ITS FOOD', color: '#ff9ec8',
    make: function (opts) { return new Nom(opts); }
  });
})(globalThis.G = globalThis.G || {});
