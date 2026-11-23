// CALM: Calm Combo's slide-a-line match-3 board as a track.
// Grab any tile, slide its whole row or column; a move counts if it makes a match anywhere.
// Moves are your life: chains and big matches earn moves, and you lose when they run out.
(function (G) {
  'use strict';

  var T = 16, COLS = 8, ROWS = 7, NC = 6, STONE = 6;
  var CFG = { startMoves: 15, chainMoves: 1, fourMoves: 1, fiveMoves: 2, maxStones: 20, moveTimer: 7000, minTimer: 3000, stoneDelay: 3000, sendMul: 0.2 };
  var COLORS = ['#ff8f87', '#7cc4ff', '#7fe0a8', '#ffe08a', '#c6a8ff', '#ffb67c'];
  var DARK = ['#c2585a', '#4a8fcc', '#4aa877', '#c9a64e', '#8d6fd0', '#cc7f45'];

  function findMatches(m) {
    var hit = m.map(function (r) { return r.map(function () { return false; }); }), groups = [], r, c, e, q, k;
    for (r = 0; r < ROWS; r++) { c = 0; while (c < COLS) { k = m[r][c]; e = c + 1; while (e < COLS && m[r][e] === k) e++; if (k < NC && e - c >= 3) { groups.push(e - c); for (q = c; q < e; q++) hit[r][q] = true; } c = e; } }
    for (c = 0; c < COLS; c++) { r = 0; while (r < ROWS) { k = m[r][c]; e = r + 1; while (e < ROWS && m[e][c] === k) e++; if (k < NC && e - r >= 3) { groups.push(e - r); for (q = r; q < e; q++) hit[q][c] = true; } r = e; } }
    var count = 0; hit.forEach(function (row) { row.forEach(function (h) { if (h) count++; }); });
    return { hit: hit, groups: groups, count: count };
  }
  function applyMove(m, r, c, axis, t) {
    var n = m.map(function (x) { return x.slice(); }), line, v, i;
    if (axis === 'h') { line = n[r]; v = line.splice(c, 1)[0]; line.splice(t, 0, v); }
    else { line = n.map(function (row) { return row[c]; }); v = line.splice(r, 1)[0]; line.splice(t, 0, v); for (i = 0; i < ROWS; i++) n[i][c] = line[i]; }
    return n;
  }
  function allMoves(m, fn) {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      for (var t = 0; t < COLS; t++) if (t !== c && fn(r, c, 'h', t) === false) return;
      for (var t2 = 0; t2 < ROWS; t2++) if (t2 !== r && fn(r, c, 'v', t2) === false) return;
    }
  }
  function hasValidMove(m) {
    var ok = false;
    allMoves(m, function (r, c, a, t) { if (findMatches(applyMove(m, r, c, a, t)).count) { ok = true; return false; } });
    return ok;
  }

  function Calm(opts) {
    this.initBase(opts);
    this.vs = opts.sendOn !== false;
    this.moves = CFG.startMoves; this.score = 0;
    this.cursor = { r: 3, c: 3 }; this.drag = null;
    this.state = 'idle'; this.phaseT = 0; this.idleT = 0;
    this.atkFrac = 0; this.bad = 0; this.elapsed = 0;
    this.fill();
    if (opts.cpuLevel) this.cpu = new CalmCPU(this, opts.cpuLevel);
  }
  var P = Calm.prototype;
  Object.assign(P, G.TrackBase);

  P.rnd = function () { return Math.floor(this.rng() * NC); };
  P.tile = function (color, fall) { return { color: color, off: fall || 0, dying: false, pop: 0 }; };
  P.colors = function () { return this.grid.map(function (r) { return r.map(function (t) { return t.color; }); }); };
  P.fill = function () {
    var tries = 0;
    do {
      this.grid = [];
      for (var r = 0; r < ROWS; r++) {
        var row = [];
        for (var c = 0; c < COLS; c++) {
          var k;
          do { k = this.rnd(); } while ((c >= 2 && row[c - 1].color === k && row[c - 2].color === k) || (r >= 2 && this.grid[r - 1][c].color === k && this.grid[r - 2][c].color === k));
          row.push(this.tile(k, (ROWS + 1) * T));
        }
        this.grid.push(row);
      }
    } while (!hasValidMove(this.colors()) && ++tries < 50);
  };

  // ---------- input ----------
  var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  P.setTarget = function (axis, t) {
    var d = this.drag;
    d.axis = axis; d.t = t;
    d.preview = (axis && t !== (axis === 'h' ? d.c : d.r)) ? findMatches(applyMove(this.colors(), d.r, d.c, axis, t)) : null;
  };
  P.handle = function (pad) {
    for (var k in DIRS) {
      if (!pad.repeat(k, 220, 90)) continue;
      var dr = DIRS[k][0], dc = DIRS[k][1], d = this.drag;
      if (!d) { this.cursor = { r: Math.max(0, Math.min(ROWS - 1, this.cursor.r + dr)), c: Math.max(0, Math.min(COLS - 1, this.cursor.c + dc)) }; continue; }
      var axis = dc ? 'h' : 'v', step = dc || dr, o = axis === 'h' ? d.c : d.r, mx = axis === 'h' ? COLS - 1 : ROWS - 1;
      if (!d.axis) { var t = Math.max(0, Math.min(mx, o + step)); if (t !== o) this.setTarget(axis, t); }
      else if (d.axis === axis) { var t2 = Math.max(0, Math.min(mx, d.t + step)); if (t2 === o) this.setTarget(null, null); else this.setTarget(axis, t2); }
    }
    if (pad.pressed('a')) {
      if (!this.drag) { this.drag = { r: this.cursor.r, c: this.cursor.c, axis: null, t: null, preview: null }; G.sfx && G.sfx('rotate', this.opts.side); }
      else if (this.drag.preview && this.drag.preview.count) this.commit();
      else { if (this.drag.axis) { this.bad = 350; G.sfx && G.sfx('bad', this.opts.side); } this.drag = null; }
    }
    if (pad.pressed('b')) this.drag = null;
  };
  P.commit = function () {
    var d = this.drag, g = this.grid, line, v, i;
    if (d.axis === 'h') { line = g[d.r]; v = line.splice(d.c, 1)[0]; line.splice(d.t, 0, v); }
    else { line = g.map(function (row) { return row[d.c]; }); v = line.splice(d.r, 1)[0]; line.splice(d.t, 0, v); for (i = 0; i < ROWS; i++) g[i][d.c] = line[i]; }
    var fr = d.axis === 'h' ? d.r : d.t, fc = d.axis === 'h' ? d.t : d.c;
    this.lever = !d.preview.hit[fr][fc];
    this.cursor = { r: fr, c: fc };
    this.drag = null; this.moves -= this.moveCost(); this.idleT = 0;
    this.chain = 0; this.gain = 0; this.attack = 0;
    this.state = 'wait'; this.phaseT = 110;
  };

  // ---------- resolving ----------
  P.gravity = function () {
    for (var c = 0; c < COLS; c++) {
      var keep = [];
      for (var r = ROWS - 1; r >= 0; r--) { var t = this.grid[r][c]; if (!t.dying) keep.push([t, r]); }
      var row = ROWS - 1;
      for (var i = 0; i < keep.length; i++) { var tt = keep[i][0]; tt.off += (row - keep[i][1]) * T; this.grid[row--][c] = tt; }
      var n = row + 1;
      for (var k = 0; k < n; k++) this.grid[k][c] = this.tile(this.rnd(), (n + 1) * T);
    }
  };
  P.stepResolve = function () {
    if (this.state === 'wait') {
      var m = findMatches(this.colors());
      if (!m.count) { this.finishResolve(); return; }
      this.chain++;
      var pts = 0, self = this;
      m.groups.forEach(function (n) {
        pts += n * 10 + (n === 4 ? 30 : n >= 5 ? 80 : 0);
        if (n === 4) { self.gain += CFG.fourMoves; self.attack += 1; } else if (n >= 5) { self.gain += CFG.fiveMoves; self.attack += 2; }
      });
      if (this.chain >= 2) { this.gain += CFG.chainMoves; this.attack += 1; }
      if (this.chain === 1 && this.lever) { pts += 50; this.attack += 1; this.say('LEVER!', '#ffc2e8'); }
      this.score += pts * this.chain;
      if (this.chain > 1) this.say('CHAIN X' + this.chain, G.PAL.yellow);
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (m.hit[r][c]) {
        this.grid[r][c].dying = true;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
          var r2 = r + o[0], c2 = c + o[1];
          if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && self.grid[r2][c2].color === STONE) self.grid[r2][c2].dying = true;
        });
      }
      G.sfx && G.sfx(this.chain > 1 ? 'big' : 'clear', this.opts.side);
      this.state = 'clear'; this.phaseT = 260;
    } else if (this.state === 'clear') {
      this.gravity(); this.state = 'fall'; this.phaseT = 300;
    } else if (this.state === 'fall') {
      this.state = 'wait'; this.phaseT = 60;
    }
  };
  P.finishResolve = function () {
    if (this.gain) { this.moves += this.gain; this.say('+' + this.gain + (this.gain > 1 ? ' MOVES' : ' MOVE'), '#9ff0c0'); }
    if (this.vs && this.attack) {
      this.atkFrac += this.attack * CFG.sendMul;
      var out = Math.floor(this.atkFrac); this.atkFrac -= out;
      this.send(out);
    }
    this.landStones();
    if (this.moves <= 0) { this.state = 'over'; this.die(); return; }
    if (!hasValidMove(this.colors())) { this.say('SHUFFLE!'); this.shuffle(); }
    this.state = 'idle';
  };
  P.landStones = function () {
    var n = this.takeAll().reduce(function (s, b) { return s + b.n; }, 0);
    if (!n) return;
    var have = 0; this.grid.forEach(function (r) { r.forEach(function (t) { if (t.color === STONE) have++; }); });
    var room = Math.max(0, CFG.maxStones - have);
    // Stone overflow: units that don't fit on the board cost a move each.
    if (n > room) { var over = n - room; this.moves -= over; this.say('-' + over + ' OVERFLOW', '#ffb0b8'); if (this.moves <= 0) { this.state = 'over'; this.die(); } }
    n = Math.min(n, room);
    var top = [], rest = [];
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) { var t = this.grid[r][c]; if (t.color !== STONE) (r < 3 ? top : rest).push(t); }
    var self = this;
    function shuf(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(self.rng() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
    shuf(top).concat(shuf(rest)).slice(0, Math.max(0, n)).forEach(function (t) { t.color = STONE; t.pop = 300; });
    if (this.drag) this.drag = null;
    G.sfx && G.sfx('garbage', this.opts.side);
  };
  P.shuffle = function () {
    var cells = []; this.grid.forEach(function (r) { r.forEach(function (t) { if (t.color !== STONE) cells.push(t); }); });
    var cols = cells.map(function (t) { return t.color; }), self = this;
    for (var i = 0; i < 200; i++) {
      for (var a = cols.length - 1; a > 0; a--) { var j = Math.floor(self.rng() * (a + 1)); var x = cols[a]; cols[a] = cols[j]; cols[j] = x; }
      cells.forEach(function (t, k) { t.color = cols[k]; });
      var m = this.colors(); if (!findMatches(m).count && hasValidMove(m)) return;
    }
    this.fill();
  };
  // Pressure rises like the brick drop speed: the move timer loses 0.5 s every minute (down to 3 s).
  // ...and every 2 minutes each move costs one more.
  P.moveCost = function () { return this.vs ? 1 + Math.floor(this.elapsed / 120000) : 1; };
  P.timer = function () { return Math.max(CFG.minTimer, CFG.moveTimer - Math.floor(this.elapsed / 60000) * 500); };
  P.die = function () { if (!this.dead) { this.dead = true; G.sfx && G.sfx('ko', this.opts.side); } };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    if (this.bad > 0) this.bad -= dt;
    var fallSp = dt * 0.45;
    this.grid.forEach(function (r) { r.forEach(function (t) { if (t.off > 0) t.off = Math.max(0, t.off - fallSp); if (t.pop > 0) t.pop -= dt; }); });
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);
    if (this.state === 'idle') {
      this.handle(pad);
      if (this.vs && this.state === 'idle') {
        var before = this.idleT; this.idleT += dt;
        if (this.idleT > this.timer() - 2500 && Math.floor(this.idleT / 500) !== Math.floor(before / 500)) G.sfx && G.sfx('tick', this.opts.side);
        if (this.idleT >= this.timer()) {
          this.idleT = 0; this.moves--; this.say('-1 MOVE', '#ffb0b8'); G.sfx && G.sfx('bad', this.opts.side);
          if (this.moves <= 0) { this.die(); return; }
        }
        if (this.pending.length && this.pending[0].t >= CFG.stoneDelay) {
          this.landStones();
          if (!hasValidMove(this.colors())) this.shuffle();
        }
      }
    } else if (this.state !== 'over') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.stepResolve();
    }
  };

  // ---------- drawing ----------
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function poly(ctx, cx, cy, n, rad, rot, inner) {
    ctx.beginPath(); var pts = inner ? n * 2 : n;
    for (var i = 0; i < pts; i++) { var a = rot + i * Math.PI * 2 / pts, rd = inner && i % 2 ? rad * inner : rad, px = cx + Math.cos(a) * rd, py = cy + Math.sin(a) * rd; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function shape(ctx, k, cx, cy, s) {
    switch (k) {
      case 0: ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI * 2); break;
      case 1: poly(ctx, cx, cy, 4, s * 1.15, -Math.PI / 2); break;
      case 2: rr(ctx, cx - s * 0.9, cy - s * 0.9, s * 1.8, s * 1.8, s * 0.3); break;
      case 3: poly(ctx, cx, cy + s * 0.2, 3, s * 1.2, -Math.PI / 2); break;
      case 4: poly(ctx, cx, cy + s * 0.08, 5, s * 1.2, -Math.PI / 2, 0.5); break;
      case 5: poly(ctx, cx, cy, 6, s * 1.05, 0); break;
    }
  }
  function drawTile(ctx, color, cx, cy, scale, lift) {
    var w = (T - 2) * scale;
    rr(ctx, cx - w / 2, cy - w / 2, w, w, 3 * scale); ctx.fillStyle = lift ? 'rgba(80,66,110,.95)' : 'rgba(36,28,56,.85)'; ctx.fill();
    if (color === STONE) {
      rr(ctx, cx - w / 2 + 2, cy - w / 2 + 2, w - 4, w - 4, 2); ctx.fillStyle = '#857c95'; ctx.fill();
      ctx.strokeStyle = '#4d4659'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 4); ctx.lineTo(cx, cy); ctx.lineTo(cx - 1, cy + 4); ctx.moveTo(cx, cy); ctx.lineTo(cx + 4, cy - 1); ctx.stroke();
      return;
    }
    var s = T * 0.29 * scale;
    shape(ctx, color, cx, cy + 1, s); ctx.fillStyle = DARK[color]; ctx.fill();
    shape(ctx, color, cx, cy, s); ctx.fillStyle = COLORS[color]; ctx.fill();
  }
  P.slotOf = function (r, c) {
    var d = this.drag;
    if (d && r === d.r && c === d.c) { if (!d.axis) return [c, r]; return d.axis === 'h' ? [d.t, r] : [c, d.t]; }
    if (d && d.axis) {
      var o = d.axis === 'h' ? d.c : d.r, t = d.t, j;
      if (d.axis === 'h' && r === d.r) { j = c; if (t > o && j > o && j <= t) j--; else if (t < o && j >= t && j < o) j++; return [j, r]; }
      if (d.axis === 'v' && c === d.c) { j = r; if (t > o && j > o && j <= t) j--; else if (t < o && j >= t && j < o) j++; return [c, j]; }
    }
    return [c, r];
  };
  P.draw = function (x, y) {
    var ctx = G.ctxRef(), bx = x + 20, by = y + 34, bw = COLS * T, bh = ROWS * T;
    var g = ctx.createLinearGradient(0, y, 0, y + 194); g.addColorStop(0, '#3e3b70'); g.addColorStop(1, '#f4b39a');
    ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fillRect(x, y, 160, 194); ctx.globalAlpha = 1;
    var shake = this.bad > 0 ? Math.round(Math.sin(this.bad / 20) * 2) : 0;
    rr(ctx, bx - 4 + shake, by - 4, bw + 8, bh + 8, 6); ctx.fillStyle = 'rgba(14,10,21,.85)'; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(bx - 2, by - 2, bw + 4, bh + 4); ctx.clip();
    var lifted = null;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var t = this.grid[r][c], pos = this.slotOf(r, c);
      var cx = bx + shake + pos[0] * T + T / 2, cy = by + pos[1] * T + T / 2 - t.off;
      if (this.drag && r === this.drag.r && c === this.drag.c) { lifted = [t, cx, cy]; continue; }
      var sc = t.dying ? Math.max(0.1, this.phaseT / 260) : t.pop > 0 ? 1 + t.pop / 900 : 1;
      if (t.dying && this.state !== 'clear') sc = 1;
      if (t.dying) { ctx.globalAlpha = Math.max(0.15, this.phaseT / 260); }
      drawTile(ctx, t.color, cx, cy, sc, false);
      ctx.globalAlpha = 1;
    }
    if (lifted) drawTile(ctx, lifted[0].color, lifted[1], lifted[2] - 2, 1.12, true);
    // preview highlight
    if (this.drag && this.drag.preview && this.drag.preview.count) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      var pv = this.drag.preview.hit;
      for (var r2 = 0; r2 < ROWS; r2++) for (var c2 = 0; c2 < COLS; c2++) if (pv[r2][c2]) ctx.strokeRect(bx + shake + c2 * T + 1.5, by + r2 * T + 1.5, T - 3, T - 3);
    }
    ctx.restore();
    // cursor
    if (!this.dead && !this.drag) {
      var col = this.opts.side ? '#a8ecff' : '#ffe7a8';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.strokeRect(bx + this.cursor.c * T, by + this.cursor.r * T, T, T); ctx.lineWidth = 1;
    }
    // incoming stones
    this.drawPendingBar(bx - 12, by, bh, bh / CFG.maxStones, CFG.stoneDelay);
    // moves and timer
    G.text('MOVES', x + 40, by + bh + 14, G.PAL.beige, { font: 'small', align: 'center' });
    G.led(String(Math.max(0, this.moves)), x + 40, by + bh + 22, this.moves <= 3 ? G.PAL.red : G.PAL.amber, 'center');
    G.text('SCORE', x + 112, by + bh + 14, G.PAL.beige, { font: 'small', align: 'center' });
    G.led(String(this.score), x + 112, by + bh + 22, G.PAL.green, 'center');
    if (this.vs && this.state === 'idle' && !this.dead) {
      var f = 1 - this.idleT / this.timer();
      G.rect(bx, by + bh + 6, bw, 3, G.PAL.steelLo);
      G.rect(bx, by + bh + 6, Math.round(bw * f), 3, f < 0.35 ? G.PAL.red : '#9ff0c0');
    }
    this.drawFlash(bx + bw / 2, by + 50);
    if (this.dead) { ctx.globalAlpha = 0.55; G.rect(bx - 4, by - 4, bw + 8, bh + 8, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  var LEVELS = {
    1: { think: 1800, step: 260, mistake: 0.45 }, 2: { think: 1500, step: 220, mistake: 0.35 },
    3: { think: 1200, step: 180, mistake: 0.25 }, 4: { think: 1000, step: 150, mistake: 0.18 },
    5: { think: 800, step: 120, mistake: 0.12 }, 6: { think: 650, step: 100, mistake: 0.08 },
    7: { think: 500, step: 80, mistake: 0.05 }, 8: { think: 350, step: 60, mistake: 0.02 }
  };
  function CalmCPU(track, level) { this.t = track; this.cfg = LEVELS[Math.max(1, Math.min(8, level))]; this.script = []; this.wait = this.cfg.think; this.tap = false; }
  CalmCPU.prototype.plan = function () {
    var t = this.t, m = t.colors(), best = null, all = [];
    allMoves(m, function (r, c, a, tt) {
      var res = findMatches(applyMove(m, r, c, a, tt));
      if (!res.count) return;
      var fr = a === 'h' ? r : tt, fc = a === 'h' ? tt : c;
      var sc = res.count * 10 + res.groups.reduce(function (s, n) { return s + (n >= 5 ? 40 : n === 4 ? 20 : 0); }, 0) + (res.hit[fr][fc] ? 0 : 15);
      var mv = { r: r, c: c, a: a, t: tt, sc: sc };
      all.push(mv);
      if (!best || sc > best.sc) best = mv;
    });
    if (!best) return;
    if (t.rng() < this.cfg.mistake) best = all[Math.floor(t.rng() * all.length)];
    var s = [], cr = t.cursor.r, cc = t.cursor.c;
    while (cr < best.r) { s.push('down'); cr++; } while (cr > best.r) { s.push('up'); cr--; }
    while (cc < best.c) { s.push('right'); cc++; } while (cc > best.c) { s.push('left'); cc--; }
    s.push('a');
    var o = best.a === 'h' ? best.c : best.r, d = best.t - o, k = best.a === 'h' ? (d > 0 ? 'right' : 'left') : (d > 0 ? 'down' : 'up');
    for (var i = 0; i < Math.abs(d); i++) s.push(k);
    s.push('a');
    this.script = s;
  };
  CalmCPU.prototype.drive = function (dt, pad) {
    var st = {};
    if (this.tap) { this.tap = false; pad.feed(st, dt); return; }
    if (this.t.state !== 'idle') { this.script = []; this.wait = this.cfg.think * (0.6 + this.t.rng() * 0.8); pad.feed(st, dt); return; }
    this.wait -= dt;
    if (this.wait > 0) { pad.feed(st, dt); return; }
    if (!this.script.length) { if (this.t.drag) this.t.drag = null; this.plan(); }
    var b = this.script.shift();
    if (b) { st[b] = true; this.tap = true; }
    this.wait = this.cfg.step;
    pad.feed(st, dt);
  };

  G.registerTrack('calm', {
    name: 'CALM', blurb: 'SLIDE A LINE, MATCH 3', color: '#7cc4ff',
    make: function (opts) { return new Calm(opts); }
  });
})(globalThis.G = globalThis.G || {});
