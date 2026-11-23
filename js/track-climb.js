// CLIMB: Tetris Plus style, on the Brick engine with the modern features switched off.
// A 2x2 professor walks the stack. Clear a path so he reaches the floor before the spiked
// ceiling comes down on him. Each stage starts as a scattered pile with a known solution:
// the first pieces dealt solve it in 5-10+ placements; after that the pieces are random.
// Bricks fall straight through the professor; once one settles inside his square he slowly
// climbs on top of the stack (slow enough to clear a line or two and bring him back down).
// Versus: incoming units push garbage rows in from the bottom, lifting the stack and the
// professor toward the spikes. Climb vs Climb is a race: same stages, same pieces, first
// one to get the professor down wins the round.
(function (G) {
  'use strict';

  var B = G.BRICK, COLS = B.COLS, ROWS = B.ROWS;
  var FIELD_H = 16;                  // 15 rows to play in, the spikes start in row 16
  var TOP = ROWS - FIELD_H;          // first field row in the engine's 22-row grid
  var CEIL0 = 1;                     // the spiked ceiling starts covering the top row
  var CELL = 11;                     // bigger cells than Brick (8)
  var SETTINGS = {
    hold: false, preview: 1, ghost: false, hardDrop: false, fastSoft: false, softMs: 110, srs: false, bag: false,
    lockResets: false, tspin: false, b2b: false, combo: false, allClear: false, cancel: true, garbageDelay: true
  };
  var FALL_MS = 750;                 // slow, steady gravity
  var WALK_MS = 700, PROF_FALL_MS = 120, CLIMB_MS = 1300;
  var DROP_EVERY = [12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3];   // pieces placed before the ceiling drops again
  var STAGE_CLEAR_UNITS = 4;         // versus: finishing a stage sends this much
  var WIN_MS = 2600;

  // ---------- stage generator ----------
  // Start from full rows and carve pieces out in reverse; each carved piece must be droppable
  // straight down and must rest where it was. Placing them back in the opposite order fills
  // every row, so the whole pile clears and the professor reaches the floor.
  function genStage(rng, stage) {
    var k = Math.min(12, 4 + stage);
    var N = Math.max(4, Math.min(10, Math.round(k * 0.8)));
    for (var attempt = 0; attempt < 80; attempt++) {
      var grid = [], y, x;
      for (y = 0; y < ROWS; y++) grid.push(B.emptyRow());
      for (y = ROWS - N; y < ROWS; y++) for (x = 0; x < COLS; x++) grid[y][x] = B.TYPES[Math.floor(rng() * 7)];
      var carved = [], tries = 0;
      while (tries++ < 4000) {
        var holesOk = true;
        for (y = ROWS - N; y < ROWS; y++) if (grid[y].every(function (c) { return c; })) holesOk = false;
        if (carved.length >= k && holesOk) break;
        if (carved.length >= k + 4) break;
        var type = B.TYPES[Math.floor(rng() * 7)], rot = Math.floor(rng() * 4), px = Math.floor(rng() * (COLS + 3)) - 2;
        var opts = [];
        for (var py = TOP; py < ROWS; py++) if (carvable(grid, type, rot, px, py)) opts.push(py);
        if (!opts.length) continue;
        var cy = opts[Math.floor(rng() * opts.length)];
        cellsOf(type, rot, px, cy).forEach(function (c) { grid[c[1]][c[0]] = null; });
        carved.push({ type: type, rot: rot, x: px, y: cy });
      }
      var ok = true;
      for (y = ROWS - N; y < ROWS; y++) if (grid[y].every(function (c) { return c; })) ok = false;
      if (ok && carved.length >= Math.min(k, 5)) return { grid: grid, solution: carved.reverse(), rows: N };
    }
    // Fallback: a plain pile with one hole per row (always clearable with random pieces).
    var g = []; for (var yy = 0; yy < ROWS; yy++) g.push(B.emptyRow());
    for (yy = ROWS - 4; yy < ROWS; yy++) { for (var xx = 0; xx < COLS; xx++) g[yy][xx] = 'G'; g[yy][Math.floor(rng() * COLS)] = null; }
    return { grid: g, solution: [], rows: 4 };
  }
  // Walk the professor over a stage with no pieces placed: does he reach the floor by himself?
  function freeWalk(grid) {
    function bl(x, y) { return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && !!grid[y][x]); }
    var x = 0, y = TOP + CEIL0, dir = 1;
    for (var step = 0; step < 300; step++) {
      while (y + 2 < ROWS && !bl(x, y + 2) && !bl(x + 1, y + 2)) y++;
      if (y + 2 >= ROWS) return true;
      var nx = dir > 0 ? x + 2 : x - 1;
      if (bl(nx, y) || bl(nx, y + 1)) dir = -dir; else x += dir;
    }
    return false;
  }
  // Same squares regardless of rotation number or height (S rot 1 at x 0 = S rot 3 at x 1).
  function canon(cells) {
    var minY = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    return cells.map(function (c) { return c[0] + ',' + (c[1] - minY); }).sort().join(' ');
  }
  function cellsOf(type, rot, x, y) { return B.SHAPES[type][rot].map(function (c) { return [x + c[0], y + c[1]]; }); }
  function carvable(grid, type, rot, x, y) {
    var cells = cellsOf(type, rot, x, y), i, c;
    for (i = 0; i < 4; i++) { c = cells[i]; if (c[0] < 0 || c[0] >= COLS || c[1] < TOP + CEIL0 + 4 || c[1] >= ROWS || !grid[c[1]][c[0]]) return false; }
    function mine(cx, cy) { return cells.some(function (d) { return d[0] === cx && d[1] === cy; }); }
    // straight drop path: nothing above any cell of the piece (other than the piece itself)
    for (i = 0; i < 4; i++) { c = cells[i]; for (var yy = 0; yy < c[1]; yy++) if (grid[yy][c[0]] && !mine(c[0], yy)) return false; }
    // it must rest here: something (or the floor) right under it once it is removed
    return cells.some(function (d) { var by = d[1] + 1; return by >= ROWS || (grid[by][d[0]] && !mine(d[0], by)); });
  }

  // ---------- the track ----------
  function Climb(opts) {
    var sup = Object.assign({}, opts, { settings: SETTINGS, cpuLevel: 0 });
    this.ceil = CEIL0;
    G.Brick.call(this, sup);
    this.opts = opts;
    this.stage = 0;
    this.newStage();
    if (opts.cpuLevel) this.cpu = new G.BrickCPU(this, opts.cpuLevel, cpuBonus);
  }
  var P = Climb.prototype = Object.create(G.Brick.prototype);
  P.constructor = Climb;

  P.newStage = function () {
    this.stage++;
    var st;
    for (var tries = 0; tries < 20; tries++) {
      st = genStage(this.rng, this.stage);
      if (!freeWalk(st.grid)) break;    // never hand out a stage he can walk through untouched
    }
    this.grid = st.grid;
    this.solution = st.solution.map(function (s) { return s.type; });
    this.solPlan = st.solution; this.solIdx = 0;   // where each solution piece goes (the CPU follows it)
    this.ceil = CEIL0; this.placedSince = 0;
    this.queue = [];
    this.fillQueue();
    this.prof = { x: 0, y: TOP + CEIL0, dir: 1, state: 'walk', t: 0, frame: 0, anim: 0 };
    this.settleProf();
    this.spawn();
    this.say('STAGE ' + this.stage, G.PAL.amber);
  };
  // Pieces: the stage's solution first, then plain random.
  P.randomType = function () {
    if (this.solution && this.solution.length) return this.solution.shift();
    return B.TYPES[Math.floor(this.rng() * 7)];
  };
  P.ceilRow = function () { return TOP + this.ceil; };
  P.level = function () { return 1; };
  P.gravityMs = function () { return FALL_MS / this.speedMul; };

  // The ceiling is solid to pieces. The professor is not: bricks fall straight through him.
  P.collides = function (type, rot, x, y, grid) {
    grid = grid || this.grid;
    var sh = B.SHAPES[type][rot], top = this.ceilRow();
    for (var i = 0; i < 4; i++) {
      var cx = x + sh[i][0], cy = y + sh[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS || cy < top) return true;
      if (grid[cy][cx]) return true;
    }
    return false;
  };
  P.spawn = function (type) {
    type = type || this.queue.shift();
    this.fillQueue();
    var x = type === 'O' ? 4 : 3, y = this.ceilRow();
    this.piece = { type: type, rot: 0, x: x, y: y };
    this.pieceId++;
    this.gravT = 0; this.lockT = 0; this.resets = 0; this.lastRot = false; this.lowest = y;
    // Bricks in the way at the top don't end the game: the spikes destroy those lines.
    for (var tries = 0; tries < 4 && this.collides(type, 0, x, y); tries++) {
      var self = this;
      this.cells(type, 0, x, y).forEach(function (c) { if (c[1] >= 0 && c[1] < ROWS && self.grid[c[1]][c[0]]) self.spikeRow(c[1]); });
    }
    if (this.collides(type, 0, x, y)) this.die();
  };
  // The spikes destroy a line of bricks that touches them (just that line, no score, nothing sent).
  P.spikeRow = function (row) {
    if (!this.grid[row].some(function (c) { return c; })) return;
    this.grid[row] = B.emptyRow();
    this.clearRows = [row]; this.clearT = 200;
    this.say('CRUNCH!', G.PAL.red);
    G.sfx && G.sfx('garbage', this.opts.side);
  };

  // ---------- professor ----------
  P.blocked = function (cx, cy) {
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
    if (cy < 0) return false;
    return !!this.grid[cy][cx];   // the falling piece doesn't get in his way
  };
  P.areaFree = function (x, y) { return !this.blocked(x, y) && !this.blocked(x + 1, y) && !this.blocked(x, y + 1) && !this.blocked(x + 1, y + 1); };
  P.onFloor = function () { return this.prof.y + 2 >= ROWS; };
  P.supported = function () { var p = this.prof; return this.onFloor() || this.blocked(p.x, p.y + 2) || this.blocked(p.x + 1, p.y + 2); };
  P.settleProf = function () { var p = this.prof; while (!this.supported()) p.y++; };
  P.profDies = function () { this.prof.state = 'dead'; this.die(); };
  P.updateProf = function (dt) {
    var p = this.prof;
    p.anim += dt;
    if (p.state === 'dead') return;
    if (p.state === 'win') {
      p.t += dt;
      if (p.t >= WIN_MS && !this.raceWon) this.newStage();
      return;
    }
    if (p.y < this.ceilRow()) { this.profDies(); return; }
    // Bricks settled in his square: he climbs one row at a time, and stops as soon as he is clear
    // (so clearing a line under him while he climbs brings him straight back down).
    if (!this.areaFree(p.x, p.y)) {
      if (p.state !== 'climb') { p.state = 'climb'; p.t = 0; this.say('CLIMB!', G.PAL.yellow); }
      p.t += dt;
      if (p.t >= CLIMB_MS) {
        p.t -= CLIMB_MS; p.y--;
        if (p.y < this.ceilRow()) this.profDies();
      }
      return;
    }
    if (p.state === 'climb') { p.state = 'walk'; p.t = 0; }
    if (this.onFloor()) { this.stageClear(); return; }
    if (!this.supported()) {           // stepping down / falling
      if (p.state !== 'fall') { p.state = 'fall'; p.t = 0; }
      p.t += dt;
      while (p.t >= PROF_FALL_MS && !this.supported()) { p.t -= PROF_FALL_MS; p.y++; }
      if (this.onFloor()) this.stageClear();
      return;
    }
    if (p.state === 'fall') { p.state = 'walk'; p.t = 0; }
    p.t += dt;
    if (p.t < WALK_MS) return;
    p.t -= WALK_MS;
    var nx = p.dir > 0 ? p.x + 2 : p.x - 1;
    // He turns at walls and at anything in his way; he can step down but never up.
    if (this.blocked(nx, p.y) || this.blocked(nx, p.y + 1)) { p.dir = -p.dir; return; }
    p.x += p.dir; p.frame ^= 1;
  };
  P.stageClear = function () {
    var p = this.prof;
    p.state = 'win'; p.t = 0;
    this.piece = null;
    this.say('STAGE CLEAR!', G.PAL.green);
    G.sfx && G.sfx('big', this.opts.side);
    if (this.opts.race) { this.raceWon = true; return; }
    this.send(STAGE_CLEAR_UNITS);
  };

  // ---------- ceiling ----------
  P.dropEvery = function () { return DROP_EVERY[Math.min(this.ceil - CEIL0, DROP_EVERY.length - 1)]; };
  P.dropCeiling = function () {
    this.ceil++;
    this.placedSince = 0;
    var row = this.ceilRow() - 1;
    if (row >= 0 && row < ROWS) this.grid[row] = B.emptyRow();   // the line it lands on is destroyed
    this.spikeRow(this.ceilRow());                                   // and so is a line touching the spikes
    G.sfx && G.sfx('garbage', this.opts.side);
    if (this.prof.y < this.ceilRow()) this.profDies();
  };
  // Incoming units push garbage rows in from the bottom: the stack and the professor rise.
  P.landGarbage = function () {
    var batches = this.takeReady(B.GARBAGE_DELAY, 6), self = this, pr = this.prof;
    if (!batches.length) return;
    batches.forEach(function (b) {
      var hole = b.gap % COLS;
      for (var i = 0; i < b.n; i++) {
        self.grid.shift();
        var row = new Array(COLS).fill('G'); row[hole] = null;
        self.grid.push(row);
        pr.y--;
      }
    });
    for (var y = 0; y < this.ceilRow(); y++) this.grid[y] = B.emptyRow();   // pushed into the ceiling = destroyed
    G.sfx && G.sfx('garbage', this.opts.side);
    if (pr.y < this.ceilRow()) this.profDies();
  };

  P.update = function (dt, pad) {
    if (!this.dead) this.updateProf(dt);
    if (this.dead || this.prof.state === 'win') {
      this.tickFlash(dt);
      if (this.clearT > 0) this.clearT -= dt;
      if (!this.dead) this.tickPending(dt);
      return;
    }
    G.Brick.prototype.update.call(this, dt, pad);
  };

  P.lock = function () {
    var p = this.piece, self = this;
    var cells = this.cells(p.type, p.rot, p.x, p.y);
    cells.forEach(function (c) { if (c[1] >= 0) self.grid[c[1]][c[0]] = p.type; });
    var sp = this.solPlan && this.solIdx >= 0 && this.solPlan[this.solIdx];
    this.solIdx = (sp && sp.type === p.type && canon(cellsOf(sp.type, sp.rot, sp.x, 0)) === canon(cells)) ? this.solIdx + 1 : -1;
    G.sfx && G.sfx('lock', this.opts.side);
    this.mark('piece');
    this.piece = null;
    var n = this.clearLines();
    if (n > 0) this.scoreClear(n, 0); else this.landGarbage();
    if (this.dead) return;
    this.placedSince++;
    if (this.placedSince >= this.dropEvery()) this.dropCeiling();
    if (this.dead) return;
    this.spikeRow(this.ceilRow());   // bricks touching the spikes are destroyed
    this.spawn();
  };

  // ---------- drawing ----------
  // The professor: 12x12 pixel art drawn at 2x, so he fills his 2x2 cells (24 px).
  var PAL = { k: '#07060b', s: '#f0c8a0', h: '#eef0ff', g: '#2fe0ff', w: '#f2f2ff', d: '#a8b0c8', p: '#3a3f52', b: '#1d2030', r: '#ff3b47' };
  var HEAD = ['...kkkkk', '..khhsssk', '.khsgkgsk', '.khsssssk', '..kkssskk'];
  var BODY = ['..kwwrwwk', '.kwwwrwwwk', '.kswwrwwsk', '..kwwwwwk'];
  var WALK_A = HEAD.concat(BODY, ['..kppkppk', '..kbk.kbk', '.kkk..kkk']);
  var WALK_B = HEAD.concat(BODY, ['..kpk.kpk', '.kbk...kbk', '.kk.....kk']);
  var CLIMB_F = HEAD.concat(['sk.kwrwk.ks', '.kkwwrwwkk', '..kwwwwwk', '..kwwwwwk', '..kpk.kpk', '..kbk.kbk', '..kk...kk']);
  var DANCE = ['...kkkkk', '..khhsssk', 'sk.ksgkgsk.ks', '.kkhsssssk.k', '..kkssskk', '..kwwrwwk', '..kwwrwwk', '..kwwwwwk', '..kppkppk', '.kpk...kpk', 'kbk.....kbk', 'kk.......kk'];
  var DEAD = ['', '', '', '', '', '', '', '', '.kkkkkkkkk', 'khhsgsgswwk', 'kwwwwrwwppk', '.kkkkkkkkk'];
  function drawProf(rows, x, y, flip) {
    var ctx = G.ctxRef();
    for (var r = 0; r < rows.length; r++) {
      var row = (rows[r] + '            ').slice(0, 12);
      for (var c = 0; c < 12; c++) {
        var col = PAL[row[c]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + (flip ? 11 - c : c) * 2, y + r * 2, 2, 2);
      }
    }
  }
  function mini(type, cx, cy, size) {
    var sh = B.SHAPES[type][0], n = B.PIECES[type].n;
    var ox = cx - Math.floor(n * size / 2), oy = cy - (type === 'I' ? size * 1.5 : size);
    sh.forEach(function (c) { G.brick(ox + c[0] * size, oy + c[1] * size, size, B.COLORS[type]); });
  }

  P.draw = function (x, y) {
    var ctx = G.ctxRef(), fx = x + 37, fy = y + 4, fw = COLS * CELL, fh = FIELD_H * CELL;
    function sy(row) { return fy + (row - TOP) * CELL; }
    // frame
    G.rect(fx - 3, fy - 3, fw + 6, fh + 6, G.PAL.steelHi);
    G.rect(fx - 2, fy - 2, fw + 4, fh + 4, G.PAL.steelLo);
    G.rect(fx, fy, fw, fh, '#0a0912');
    for (var gx = 1; gx < COLS; gx++) G.rect(fx + gx * CELL, fy, 1, fh, '#13111f');
    // chains above the field
    for (var cy0 = y + 2; cy0 < fy - 3; cy0 += 4) { G.rect(fx + 14, cy0, 2, 3, G.PAL.steelHi); G.rect(fx + fw - 16, cy0, 2, 3, G.PAL.steelHi); }
    // stack
    for (var ry = TOP; ry < ROWS; ry++) for (var cx = 0; cx < COLS; cx++) {
      var c = this.grid[ry][cx];
      if (c) G.brick(fx + cx * CELL, sy(ry), CELL, B.COLORS[c]);
    }
    if (this.clearT > 0) {
      ctx.globalAlpha = this.clearT / 200;
      for (var k = 0; k < this.clearRows.length; k++) if (this.clearRows[k] >= TOP) G.rect(fx, sy(this.clearRows[k]), fw, CELL, '#ffffff');
      ctx.globalAlpha = 1;
    }
    // ceiling slab with spikes, hanging on chains
    var ch = this.ceil * CELL;
    if (ch > 0) {
      G.rect(fx, fy, fw, ch, '#2b2433');
      for (var q = 0; q < ch; q += 4) { G.rect(fx + 14, fy + q, 2, 3, G.PAL.steelHi); G.rect(fx + fw - 16, fy + q, 2, 3, G.PAL.steelHi); }
    }
    G.rect(fx, fy + ch - 3, fw, 3, G.PAL.steelHi);
    for (var sx = 0; sx < fw; sx += 6) {
      G.rect(fx + sx + 1, fy + ch, 4, 2, G.PAL.white); G.rect(fx + sx + 2, fy + ch + 2, 2, 2, G.PAL.grey);
    }
    // professor
    var p = this.prof, px = fx + p.x * CELL - 1, py = sy(p.y) - 2, flip = p.dir < 0;
    var rows = p.frame ? WALK_B : WALK_A;
    if (p.state === 'climb') { rows = CLIMB_F; py -= Math.round(Math.min(1, p.t / CLIMB_MS) * 4); flip = (Math.floor(p.anim / 300) & 1) === 1; }
    if (p.state === 'dead') rows = DEAD;
    if (p.state === 'win') {
      var t = p.t, bottom = fy + fh;
      ctx.save(); ctx.beginPath(); ctx.rect(x, fy, 160, 240); ctx.clip();
      if (t < 400) py += Math.round(t / 400 * 24);
      else py = bottom;
      if (t >= 400 && t < 1800) { rows = DANCE; flip = (Math.floor(t / 200) & 1) === 1; py -= (Math.floor(t / 100) & 1) * 2; }
      else if (t >= 1800) { rows = (Math.floor(t / 120) & 1) ? WALK_A : WALK_B; flip = false; px += Math.round((t - 1800) / 800 * 110); }
      drawProf(rows, px, py, flip);
      ctx.restore();
    } else drawProf(rows, px, py, flip);
    // falling piece (drawn over him: bricks pass through)
    if (this.piece && !this.dead) {
      var pc = this.piece;
      this.cells(pc.type, pc.rot, pc.x, pc.y).forEach(function (cc) {
        if (cc[1] >= TOP) G.brick(fx + cc[0] * CELL, sy(cc[1]), CELL, B.COLORS[pc.type]);
      });
    }
    // next, stats, incoming bar
    G.text('NEXT', x + 15, fy, G.PAL.beige, { font: 'small', align: 'center' });
    G.rect(x + 2, fy + 8, 25, 20, G.PAL.ink);
    if (this.queue[0]) mini(this.queue[0], x + 15, fy + 18, 6);
    G.text('STAGE', x + 17, fy + 40, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.stage), x + 17, fy + 48, G.PAL.amber, 'center');
    G.text('DROP', x + 17, fy + 66, G.PAL.grey, { font: 'small', align: 'center' });
    G.text('IN', x + 17, fy + 72, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(Math.max(0, this.dropEvery() - this.placedSince)), x + 17, fy + 80, G.PAL.red, 'center');
    G.text('LINES', x + 17, fy + 100, G.PAL.grey, { font: 'small', align: 'center' });
    G.text(String(this.lines), x + 17, fy + 108, G.PAL.white, { font: 'small', align: 'center' });
    this.drawPendingBar(fx - 7, fy, fh, CELL, B.GARBAGE_DELAY);
    this.drawFlash(fx + fw / 2, fy + 50);
    if (this.dead) { ctx.globalAlpha = 0.55; G.rect(fx, fy, fw, fh, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  P.cpuReplan = true;
  // Don't speed a piece onto the spot where the professor is walking.
  P.cpuWait = function (plan) {
    var pc = this.piece, pr = this.prof, g = this.grid;
    if (!pc) return false;
    var sh = B.SHAPES[pc.type][plan.rot], y = pc.y;
    function hit(yy) { return sh.some(function (c) { var cx = plan.x + c[0], cy = yy + c[1]; return cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && g[cy][cx]); }); }
    while (!hit(y + 1)) y++;
    return sh.some(function (c) { var cx = plan.x + c[0], cy = y + c[1]; return cx >= pr.x - 1 && cx <= pr.x + 2 && cy >= pr.y - 1 && cy <= pr.y + 2; });
  };
  // The brick heuristic, plus: follow the stage's solution while still on script,
  // and avoid settling bricks in the professor's square.
  function cpuBonus(t, cells, lines) {
    var p = t.prof, s = 0, sp = t.solIdx >= 0 && t.solPlan[t.solIdx], pc = t.piece;
    if (sp && pc && sp.type === pc.type && canon(cellsOf(sp.type, sp.rot, sp.x, 0)) === canon(cells)) s += 100;
    cells.forEach(function (c) { if (c[0] >= p.x && c[0] <= p.x + 1 && c[1] >= p.y && c[1] <= p.y + 1) s -= 2; });
    return s + lines * 0.8;
  }

  G.registerTrack('climb', {
    name: 'CLIMB', blurb: 'GET THE PROFESSOR DOWN', color: '#a6ff3a',
    cpuWeak: true,   // the CPU can play it, but isn't dealt it at random yet
    make: function (opts) { return new Climb(opts); }
  });
  G.Climb = Climb;
  G.climbGenStage = genStage;
})(globalThis.G = globalThis.G || {});
