// CLIMB: Tetris Plus style, on the Brick engine with the modern features switched off.
// A 2x2 professor walks the stack. Clear a path so he reaches the floor before the spiked
// ceiling comes down on him. Each stage starts as a scattered pile with a known solution:
// the first pieces dealt solve it in 5-10+ placements; after that the pieces are random.
// Versus: incoming units push garbage rows in from the bottom, lifting the stack and the
// professor toward the spikes. Climb vs Climb is a race: same stages, same pieces, first
// one to get the professor down wins the round.
(function (G) {
  'use strict';

  var B = G.BRICK, COLS = B.COLS, ROWS = B.ROWS, HIDDEN = B.HIDDEN, CELL = B.CELL;
  var SETTINGS = {
    hold: false, preview: 1, ghost: false, hardDrop: false, fastSoft: false, softMs: 100, srs: false, bag: false,
    lockResets: false, tspin: false, b2b: false, combo: false, allClear: false, cancel: true, garbageDelay: true
  };
  var FALL_MS = 700;                 // slow, steady gravity
  var WALK_MS = 700, PROF_FALL_MS = 110, CLIMB_MS = 160;
  var DROP_EVERY = [12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3];   // pieces placed before the ceiling drops again
  var STAGE_CLEAR_UNITS = 4;         // versus: finishing a stage sends this much
  var WIN_MS = 2600;

  // ---------- stage generator ----------
  // Start from full rows and carve pieces out in reverse; each carved piece must be droppable
  // straight down and must rest where it was. Placing them back in the opposite order fills
  // every row, so the whole pile clears and the professor reaches the floor.
  function genStage(rng, stage) {
    var k = Math.min(12, 4 + stage);
    var N = Math.max(4, Math.min(12, Math.round(k)));
    for (var attempt = 0; attempt < 80; attempt++) {
      var grid = [], y, x;
      for (y = 0; y < ROWS; y++) grid.push(B.emptyRow());
      for (y = ROWS - N; y < ROWS; y++) for (x = 0; x < COLS; x++) grid[y][x] = B.TYPES[Math.floor(rng() * 7)];
      var carved = [], tries = 0;
      var target = k;
      while (tries++ < 4000) {
        var holesOk = true;
        for (y = ROWS - N; y < ROWS; y++) if (grid[y].every(function (c) { return c; })) holesOk = false;
        if (carved.length >= target && holesOk) break;
        if (carved.length >= target + 4) break;
        var type = B.TYPES[Math.floor(rng() * 7)], rot = Math.floor(rng() * 4), px = Math.floor(rng() * (COLS + 3)) - 2;
        var opts = [];
        for (var py = -2; py < ROWS; py++) if (carvable(grid, type, rot, px, py)) opts.push(py);
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
    var x = 0, y = HIDDEN, dir = 1;
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
    for (i = 0; i < 4; i++) { c = cells[i]; if (c[0] < 0 || c[0] >= COLS || c[1] < HIDDEN + 4 || c[1] >= ROWS || !grid[c[1]][c[0]]) return false; }
    function mine(cx, cy) { return cells.some(function (d) { return d[0] === cx && d[1] === cy; }); }
    // straight drop path: nothing above any cell of the piece (other than the piece itself)
    for (i = 0; i < 4; i++) { c = cells[i]; for (var yy = 0; yy < c[1]; yy++) if (grid[yy][c[0]] && !mine(c[0], yy)) return false; }
    // it must rest here: something (or the floor) right under it once it is removed
    var rests = cells.some(function (d) { var by = d[1] + 1; return by >= ROWS || (grid[by][d[0]] && !mine(d[0], by)); });
    return rests;
  }

  // ---------- the track ----------
  function Climb(opts) {
    var sup = Object.assign({}, opts, { settings: SETTINGS, cpuLevel: 0 });
    this.ceil = 0;
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
    this.solLeft = this.solution.length;
    this.ceil = 0; this.placedSince = 0;
    this.queue = [];
    this.fillQueue();
    this.prof = { x: 0, y: HIDDEN, dir: 1, state: 'walk', t: 0, vy: 0, frame: 0, anim: 0 };
    this.settleProf();
    this.spawn();
    this.say('STAGE ' + this.stage, G.PAL.amber);
  };
  // Pieces: the stage's solution first, then plain random.
  P.randomType = function () {
    if (this.solution && this.solution.length) return this.solution.shift();
    return B.TYPES[Math.floor(this.rng() * 7)];
  };
  P.ceilRow = function () { return HIDDEN + this.ceil; };
  P.level = function () { return 1; };
  P.gravityMs = function () { return FALL_MS / this.speedMul; };

  // The ceiling is solid to pieces. The professor is not: bricks fall straight through him,
  // and only once one settles inside his 2x2 square does he climb on top of it.
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
    if (this.collides(type, 0, x, y)) this.die();
  };

  // ---------- professor ----------
  P.blocked = function (cx, cy) {
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
    if (cy < 0) return false;
    return !!this.grid[cy][cx];   // the falling piece doesn't get in his way either
  };
  P.areaFree = function (x, y) { return !this.blocked(x, y) && !this.blocked(x + 1, y) && !this.blocked(x, y + 1) && !this.blocked(x + 1, y + 1); };
  P.onFloor = function () { return this.prof.y + 2 >= ROWS; };
  P.supported = function () { var p = this.prof; return this.onFloor() || this.blocked(p.x, p.y + 2) || this.blocked(p.x + 1, p.y + 2); };
  P.settleProf = function () { var p = this.prof; while (!this.supported()) p.y++; };
  // Climb from row `fromY` upward to the first free spot on top of whatever is above him.
  P.climb = function (fromY) {
    var p = this.prof, fy = fromY;
    while (fy >= 0 && !this.areaFree(p.x, fy)) fy--;
    if (fy === p.y) return;
    p.target = fy; p.state = 'climb'; p.t = 0;
    this.say('CLIMB!', G.PAL.yellow);
  };
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
    if (p.state === 'climb') {
      p.t += dt;
      while (p.t >= CLIMB_MS && p.y > p.target) { p.t -= CLIMB_MS; p.y--; }
      if (p.y < this.ceilRow()) { this.profDies(); return; }
      if (p.y <= p.target) { p.state = 'walk'; p.t = 0; }
      return;
    }
    if (p.y < this.ceilRow()) { this.profDies(); return; }
    if (this.onFloor()) { this.stageClear(); return; }
    if (!this.supported()) {           // stepping down / falling
      p.state = 'fall'; p.t += dt;
      while (p.t >= PROF_FALL_MS && !this.supported()) { p.t -= PROF_FALL_MS; p.y++; }
      if (this.onFloor()) { this.stageClear(); return; }
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
  P.dropEvery = function () { return DROP_EVERY[Math.min(this.ceil, DROP_EVERY.length - 1)]; };
  P.dropCeiling = function () {
    this.ceil++;
    this.placedSince = 0;
    var row = this.ceilRow() - 1;
    if (row >= 0 && row < ROWS) this.grid[row] = B.emptyRow();   // bricks it touches are destroyed (just that line)
    G.sfx && G.sfx('garbage', this.opts.side);
    if (this.prof.y < this.ceilRow()) this.profDies();
  };
  // Incoming units push garbage rows in from the bottom: the stack and the professor rise.
  P.landGarbage = function () {
    var batches = this.takeReady(B.GARBAGE_DELAY, 8), self = this, pr = this.prof;
    if (!batches.length) return;
    batches.forEach(function (b) {
      var hole = b.gap % COLS;
      for (var i = 0; i < b.n; i++) {
        self.grid.shift();
        var row = new Array(COLS).fill('G'); row[hole] = null;
        self.grid.push(row);
        pr.y--; if (pr.target != null) pr.target--;
      }
    });
    // anything pushed into the ceiling is destroyed
    for (var y = 0; y < this.ceilRow(); y++) this.grid[y] = B.emptyRow();
    G.sfx && G.sfx('garbage', this.opts.side);
    if (pr.y < this.ceilRow()) this.profDies();
    else if (!this.areaFree(pr.x, pr.y)) this.climb(pr.y);
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
    var p = this.piece, self = this, pr = this.prof;
    var cells = this.cells(p.type, p.rot, p.x, p.y);
    cells.forEach(function (c) { if (c[1] >= 0) self.grid[c[1]][c[0]] = p.type; });
    var sp = this.solPlan && this.solIdx >= 0 && this.solPlan[this.solIdx];
    this.solIdx = (sp && sp.type === p.type && canon(cellsOf(sp.type, sp.rot, sp.x, 0)) === canon(cells)) ? this.solIdx + 1 : -1;
    G.sfx && G.sfx('lock', this.opts.side);
    this.piece = null;
    var n = this.clearLines();
    if (n > 0) this.scoreClear(n, 0); else this.landGarbage();
    if (this.dead) return;
    this.placedSince++;
    if (this.placedSince >= this.dropEvery()) this.dropCeiling();
    if (this.dead) return;
    // A brick settled inside his square (or the stack shifted into him): he climbs on top.
    if (pr.state !== 'climb' && !this.areaFree(pr.x, pr.y)) this.climb(pr.y);
    this.spawn();
  };

  // ---------- drawing ----------
  var K = '#07060b';
  var PAL = { k: K, s: '#f0c8a0', h: '#eef0ff', g: '#2fe0ff', w: '#f2f2ff', d: '#a8b0c8', p: '#3a3f52', b: '#1d2030', r: '#ff3b47' };
  function pad16(rows) { return rows.map(function (r) { return (r + '................').slice(0, 16); }); }
  var TOP = [
    '.....kkkkkk',
    '....khhsssk',
    '...khhssssk',
    '...khsgkgsk',
    '...khssssk',
    '....kssskk',
    '.....kkkk',
    '....kwwrwk',
    '...kwwwrwwk',
    '...kwdwrwdk',
    '...kswwwwsk',
    '...kwwwwwwk'];
  var WALK_A = pad16(TOP.concat(['....kppkppk', '....kppkppk', '...kbbk.kbbk', '...kkk...kkk']));
  var WALK_B = pad16(TOP.concat(['....kpkkpk', '...kpk..kpk', '...kbk..kbbk', '...kk....kkk']));
  var DANCE = pad16([
    '.....kkkkkk',
    '....khhsssk',
    '...khhssssk',
    '...khsgkgsk',
    '.ks.khssssk.sk',
    '.ks..kssskk.sk',
    '..kw..kkkk.wk',
    '...kwwwrwwwk',
    '....kwwrwwk',
    '....kwdrwdk',
    '....kwwwwwk',
    '....kwwwwwk',
    '....kppkppk',
    '...kpk..kpk',
    '..kbbk..kbbk',
    '..kkk....kkk']);
  var DEAD = pad16(['', '', '', '', '', '', '', '', '...kkkkkkkkkk', '..khhssgsgssk', '..kwwwwrwwwwk', '..kppppbbbbk', '...kkkkkkkk']);

  P.drawExtras = function (fx, fy) {
    var top = this.ceilRow(), ctx = G.ctxRef();
    // ceiling: a slab hanging on chains, spikes along the bottom
    var ch = (top - HIDDEN) * CELL;
    if (ch > 0) {
      G.rect(fx, fy, COLS * CELL, ch, '#2b2433');
      for (var cy = 0; cy < ch; cy += 4) { G.rect(fx + 10, fy + cy, 2, 3, G.PAL.steelHi); G.rect(fx + COLS * CELL - 12, fy + cy, 2, 3, G.PAL.steelHi); }
    }
    G.rect(fx, fy + ch - 3, COLS * CELL, 3, G.PAL.steelHi);
    for (var sx = 0; sx < COLS * CELL; sx += 4) {
      G.rect(fx + sx + 1, fy + ch, 2, 2, G.PAL.white); G.px(fx + sx + 1, fy + ch + 2, G.PAL.grey); G.px(fx + sx + 2, fy + ch + 2, G.PAL.grey);
    }
    // professor
    var p = this.prof, px = fx + p.x * CELL, py = fy + (p.y - HIDDEN) * CELL, rows = (p.frame ? WALK_B : WALK_A), flip = p.dir < 0;
    if (p.state === 'climb') rows = (Math.floor(p.anim / 120) & 1) ? WALK_A : WALK_B;
    if (p.state === 'dead') rows = DEAD;
    if (p.state === 'win') {
      var t = p.t, bottom = fy + (ROWS - HIDDEN) * CELL;
      ctx.save(); ctx.beginPath(); ctx.rect(fx - 40, fy, COLS * CELL + 80, (ROWS - HIDDEN) * CELL + 30); ctx.clip();
      if (t < 400) py = py + Math.round(t / 400 * 16);
      else py = bottom - 4;
      if (t >= 400 && t < 1800) { rows = DANCE; flip = (Math.floor(t / 200) & 1) === 1; py -= (Math.floor(t / 100) & 1) * 2; }
      else if (t >= 1800) { rows = (Math.floor(t / 120) & 1) ? WALK_A : WALK_B; flip = false; px += Math.round((t - 1800) / 800 * 90); }
      G.sprite(rows, px, py, PAL, null, flip);
      ctx.restore();
      return;
    }
    if (py + 16 > fy) G.sprite(rows, px, py, PAL, null, flip);
  };
  P.drawStats = function (x, fy) {
    G.text('STAGE', x + 18, fy + 104, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(this.stage), x + 18, fy + 112, G.PAL.amber, 'center');
    G.text('DROP IN', x + 18, fy + 128, G.PAL.grey, { font: 'small', align: 'center' });
    G.led(String(Math.max(0, this.dropEvery() - this.placedSince)), x + 18, fy + 136, G.PAL.red, 'center');
    G.text('LINES', x + 18, fy + 152, G.PAL.grey, { font: 'small', align: 'center' });
    G.text(String(this.lines), x + 18, fy + 160, G.PAL.white, { font: 'small', align: 'center' });
  };

  P.cpuReplan = true;
  // CPU: don't speed a piece onto the spot where the professor is walking.
  P.cpuWait = function (plan) {
    var pc = this.piece, pr = this.prof, g = this.grid;
    if (!pc) return false;
    var sh = B.SHAPES[pc.type][plan.rot], y = pc.y;
    function hit(yy) { return sh.some(function (c) { var cx = plan.x + c[0], cy = yy + c[1]; return cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && g[cy][cx]); }); }
    while (!hit(y + 1)) y++;
    return sh.some(function (c) { var cx = plan.x + c[0], cy = y + c[1]; return cx >= pr.x - 1 && cx <= pr.x + 2 && cy >= pr.y - 1 && cy <= pr.y + 2; });
  };

  // CPU: the brick heuristic, plus "don't drop things on the professor" and a push to dig under him.
  function cpuBonus(t, cells, lines) {
    var p = t.prof, s = 0, sp = t.solIdx >= 0 && t.solPlan[t.solIdx], pc = t.piece;
    // Still on the stage's script: put the piece where the solution says.
    if (sp && pc && sp.type === pc.type) {
      if (canon(cellsOf(sp.type, sp.rot, sp.x, 0)) === canon(cells)) s += 100;
    }
    cells.forEach(function (c) {
      if (c[0] >= p.x && c[0] <= p.x + 1 && c[1] >= p.y && c[1] <= p.y + 1) s -= 2;   // settling in his square makes him climb
    });
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
