// POP: Puzzle Bobble-style bubble shooter as a track.
// Aim the launcher with left/right (hold B for fine aim), fire with A, D or Up. C swaps the
// bubble in the launcher with the next one. A group of 3 or more of a colour pops, and any
// bubbles left hanging with nothing holding them up drop. Popping alone sends nothing:
// every 2 bubbles DROPPED send 1 unit. The ceiling comes down every few shots.
// Incoming units land after a shot that pops nothing: 2 grey bubbles per unit, stuck under
// the cluster. A grey bubble breaks when a bubble next to it pops, and drops like any other.
// Every 8 units taken also bring the ceiling down a row. You lose when a bubble reaches the line.
(function (G) {
  'use strict';

  var COLS = 8, R = 7, D = 14, RH = 12, MAXR = 16, DEAD = 12, NC = 6, GREY = 9;
  var W = COLS * D;                     // 112 px field
  var LY = R + (DEAD - 1) * RH + R + 16; // launcher centre (field coords)
  var FH = LY + 16;                     // field height
  var TICKS = 200, STEP = 2;            // aim steps (0.8 degrees each), flight sub-step in px
  var CFG = {
    speed: 0.55,                        // px per ms
    aimDelay: 150, aimRate: 12, aimFine: 45,
    startRows: 5,
    dropEvery: 12, dropMin: 7, dropFaster: 30000,   // ceiling: every 12 shots, one fewer every 30 s
    hurry: 8000,                        // auto-fire after this long without shooting
    garbageDelay: 1000, maxGarbage: 4, greysPerUnit: 2, unitsPerCeiling: 8,
    flash: 260,
    sendMul: G.POP_SEND || 0.85            // mixed-play balance (see tools/sim.js)
  };
  // Each colour has its own symbol: coral dot, sky ring, green triangle, gold star, violet diamond, white square.
  var COLORS = ['#ff5a4e', '#3fb4ff', '#43d65a', '#ffc81f', '#b05cff', '#f2f0ff'];
  var DARK = ['#8c1f17', '#0f4f80', '#146b25', '#8a6200', '#4d1c80', '#7a7890'];

  function rowLen(r) { return r & 1 ? COLS - 1 : COLS; }
  function cellX(r, c) { return R + c * D + (r & 1 ? R : 0); }
  function cellY(r) { return R + r * RH; }
  function emptyGrid() { var g = []; for (var r = 0; r < MAXR; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(-1); g.push(row); } return g; }
  function copyGrid(g) { return g.map(function (r) { return r.slice(); }); }
  function inGrid(r, c) { return r >= 0 && r < MAXR && c >= 0 && c < rowLen(r); }
  function neighbours(r, c) {
    var o = r & 1 ? [[-1, 0], [-1, 1], [1, 0], [1, 1]] : [[-1, -1], [-1, 0], [1, -1], [1, 0]];
    var out = [[r, c - 1], [r, c + 1]];
    o.forEach(function (d) { out.push([r + d[0], c + d[1]]); });
    return out.filter(function (p) { return inGrid(p[0], p[1]); });
  }
  function angleOf(tick) { return (170 - tick * 0.8) * Math.PI / 180; }

  // One flight sub-step of STEP px. s = {x, y, vx, vy} in field coords; top = ceiling y.
  // Returns true once the bubble touches the ceiling or another bubble.
  function stepShot(g, top, s) {
    s.x += s.vx * STEP; s.y += s.vy * STEP;
    if (s.x < R) { s.x = 2 * R - s.x; s.vx = -s.vx; }
    if (s.x > W - R) { s.x = 2 * (W - R) - s.x; s.vx = -s.vx; }
    var gy = s.y - top;
    if (gy <= R) return true;
    var r0 = Math.round((gy - R) / RH), lim = (D - 2) * (D - 2);
    for (var r = Math.max(0, r0 - 1); r <= Math.min(MAXR - 1, r0 + 1); r++) for (var c = 0; c < rowLen(r); c++) {
      if (g[r][c] < 0) continue;
      var dx = cellX(r, c) - s.x, dy = cellY(r) - gy;
      if (dx * dx + dy * dy < lim) return true;
    }
    return false;
  }
  // The empty cell nearest to where the bubble stopped.
  function snap(g, top, s) {
    var gy = s.y - top, r0 = Math.max(0, Math.round((gy - R) / RH)), best = null, bd = 1e9;
    for (var r = Math.max(0, r0 - 1); r <= Math.min(MAXR - 1, r0 + 1); r++) for (var c = 0; c < rowLen(r); c++) {
      if (g[r][c] >= 0) continue;
      var dx = cellX(r, c) - s.x, dy = cellY(r) - gy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { r: r, c: c }; }
    }
    return best || { r: Math.min(MAXR - 1, r0), c: Math.max(0, Math.min(rowLen(r0) - 1, Math.floor(s.x / D))) };
  }
  function newShot(tick) { var a = angleOf(tick); return { x: W / 2, y: LY, vx: Math.cos(a), vy: -Math.sin(a) }; }
  // Where a shot at this aim lands (used by the CPU; same steps as the real flight).
  function trace(g, top, tick) {
    var s = newShot(tick);
    for (var i = 0; i < 2000; i++) if (stepShot(g, top, s)) break;
    return snap(g, top, s);
  }
  // Same-colour group connected to (r, c).
  function group(g, r, c) {
    var k = g[r][c], seen = {}, out = [], q = [[r, c]];
    seen[r + ',' + c] = 1;
    while (q.length) {
      var p = q.pop(); out.push(p);
      neighbours(p[0], p[1]).forEach(function (n) {
        var key = n[0] + ',' + n[1];
        if (!seen[key] && g[n[0]][n[1]] === k) { seen[key] = 1; q.push(n); }
      });
    }
    return out;
  }
  // Bubbles not connected to the ceiling row.
  function floating(g) {
    var held = {}, q = [], out = [];
    for (var c = 0; c < COLS; c++) if (g[0][c] >= 0) { held['0,' + c] = 1; q.push([0, c]); }
    while (q.length) {
      var p = q.pop();
      neighbours(p[0], p[1]).forEach(function (n) {
        var key = n[0] + ',' + n[1];
        if (!held[key] && g[n[0]][n[1]] >= 0) { held[key] = 1; q.push(n); }
      });
    }
    for (var r = 0; r < MAXR; r++) for (c = 0; c < rowLen(r); c++) if (g[r][c] >= 0 && !held[r + ',' + c]) out.push([r, c]);
    return out;
  }
  // Place colour k at (r, c) and work out what pops and drops. Changes g. Returns the result.
  function resolve(g, r, c, k) {
    g[r][c] = k;
    var res = { popped: [], greys: [], dropped: [] };
    if (k === GREY) return res;
    var grp = group(g, r, c);
    if (grp.length < 3) return res;
    res.popped = grp;
    var gs = {};
    grp.forEach(function (p) {
      neighbours(p[0], p[1]).forEach(function (n) { if (g[n[0]][n[1]] === GREY) gs[n[0] + ',' + n[1]] = n; });
    });
    res.greys = Object.keys(gs).map(function (key) { return gs[key]; });
    return res;
  }
  function removeAndDrop(g, res) {
    res.popped.concat(res.greys).forEach(function (p) { g[p[0]][p[1]] = -1; });
    res.dropped = floating(g).map(function (p) { var v = g[p[0]][p[1]]; g[p[0]][p[1]] = -1; return [p[0], p[1], v]; });
    return res.dropped;
  }
  function lowest(g) { for (var r = MAXR - 1; r >= 0; r--) for (var c = 0; c < rowLen(r); c++) if (g[r][c] >= 0) return r; return -1; }
  function isEmpty(g) { return lowest(g) < 0; }

  function Pop(opts) {
    this.initBase(opts);
    this.vs = opts.sendOn !== false;
    this.grid = emptyGrid();
    this.drop = 0; this.shots = 0; this.shotsLeft = CFG.dropEvery; this.unitsTaken = 0;
    this.score = 0; this.dropped = 0; this.elapsed = 0; this.clears = 0;
    this.tick = TICKS / 2; this.aimT = 0; this.aimDir = 0; this.idle = 0;
    this.fill(CFG.startRows);
    this.cur = this.pickColor(); this.next = this.pickColor();
    this.state = 'aim'; this.shot = null; this.dist = 0;
    this.fallers = []; this.popT = 0; this.shake = 0;
    if (opts.cpuLevel) this.cpu = new PopCPU(this, opts.cpuLevel);
  }
  var P = Pop.prototype;
  Object.assign(P, G.TrackBase);

  P.fill = function (rows) {
    for (var r = 0; r < rows; r++) for (var c = 0; c < rowLen(r); c++) {
      // a little bias toward the neighbour's colour so the opening board has groups to work with
      var k = Math.floor(this.rng() * NC);
      if (c && this.rng() < 0.3) k = this.grid[r][c - 1];
      this.grid[r][c] = k;
    }
  };
  // Next bubbles only come in colours still on the board (any colour once it's empty).
  P.pickColor = function () {
    var have = [], g = this.grid;
    for (var r = 0; r < MAXR; r++) for (var c = 0; c < rowLen(r); c++) { var k = g[r][c]; if (k >= 0 && k < NC && have.indexOf(k) < 0) have.push(k); }
    have.sort();
    if (!have.length) return Math.floor(this.rng() * NC);
    return have[Math.floor(this.rng() * have.length)];
  };
  P.top = function () { return this.drop * RH; };
  P.dropEvery = function () { return Math.max(CFG.dropMin, CFG.dropEvery - Math.floor(this.elapsed / CFG.dropFaster)); };
  P.die = function () { if (!this.dead) { this.dead = true; this.state = 'over'; G.sfx && G.sfx('ko', this.opts.side); } };
  P.checkLine = function () { if (lowest(this.grid) + this.drop >= DEAD) this.die(); };

  P.fire = function () {
    this.shot = newShot(this.tick); this.shot.k = this.cur;
    this.cur = this.next; this.next = this.pickColor();
    this.state = 'fly'; this.dist = 0; this.idle = 0;
    G.sfx && G.sfx('hard', this.opts.side);
  };
  P.swapNext = function () { var t = this.cur; this.cur = this.next; this.next = t; G.sfx && G.sfx('hold', this.opts.side); };

  P.aim = function (dt, pad) {
    if (pad.pressed('left')) { this.aimDir = -1; this.aimT = 0; this.tick = Math.max(0, this.tick - 1); }
    else if (pad.pressed('right')) { this.aimDir = 1; this.aimT = 0; this.tick = Math.min(TICKS, this.tick + 1); }
    var held = this.aimDir < 0 ? pad.down('left') : this.aimDir > 0 ? pad.down('right') : false;
    if (held) {
      var rate = pad.down('b') ? CFG.aimFine : CFG.aimRate;
      this.aimT += dt;
      while (this.aimT >= CFG.aimDelay + rate) { this.aimT -= rate; this.tick = Math.max(0, Math.min(TICKS, this.tick + this.aimDir)); }
    } else this.aimDir = 0;
    if (pad.pressed('c')) this.swapNext();
    this.idle += dt;
    if (pad.pressed('a') || pad.pressed('d') || pad.pressed('up') || this.idle >= CFG.hurry) this.fire();
  };

  P.fly = function (dt) {
    this.dist += CFG.speed * dt;
    var top = this.top();
    while (this.dist >= STEP) {
      this.dist -= STEP;
      if (stepShot(this.grid, top, this.shot)) { this.land(); return; }
    }
  };

  P.land = function () {
    var s = this.shot, cell = snap(this.grid, this.top(), s);
    this.shot = null;
    this.shots++; this.shotsLeft--;
    this.mark('piece');
    G.sfx && G.sfx('lock', this.opts.side);
    this.res = resolve(this.grid, cell.r, cell.c, s.k);
    if (this.res.popped.length) {
      this.state = 'pop'; this.popT = CFG.flash;
      G.sfx && G.sfx('clear', this.opts.side);
    } else this.afterShot(false);
  };

  P.finishPop = function () {
    var res = this.res, self = this, top = this.top();
    var dropped = removeAndDrop(this.grid, res);
    var n = dropped.length;
    this.dropped += n;
    this.score += res.popped.length * 10 + (n ? 20 * Math.pow(2, Math.min(n, 12)) / 2 : 0);
    dropped.forEach(function (p) { self.fallers.push({ x: cellX(p[0], p[1]), y: cellY(p[0]) + top, vy: -0.05, k: p[2] }); });
    if (res.greys.length) this.say(res.greys.length > 1 ? res.greys.length + ' GREYS' : 'GREY', G.PAL.beige);
    var units = Math.floor(n / 2), big = n >= 4;
    if (isEmpty(this.grid)) {
      units += 3; big = true; this.clears++;
      this.say('ALL CLEAR', G.PAL.green);
      this.drop = 0; this.fill(CFG.startRows);
    } else if (n >= 2) this.say(n + ' DROPPED', n >= 6 ? G.PAL.yellow : G.PAL.cyan);
    if (big) { this.mark('big'); G.sfx && G.sfx('big', this.opts.side); }
    if (this.vs && units > 0) {
      this.atkFrac = (this.atkFrac || 0) + units * CFG.sendMul;
      var out = Math.floor(this.atkFrac); this.atkFrac -= out;
      this.send(out);
    }
    this.afterShot(true);
  };

  // After every shot: incoming greys (only if nothing popped), the ceiling, the line, the next bubble.
  P.afterShot = function (popped) {
    if (!popped) this.landGarbage();
    if (this.dead) return;
    if (this.shotsLeft <= 0) { this.lowerCeiling(); this.shotsLeft = this.dropEvery(); }
    this.checkLine();
    if (this.dead) return;
    // the launcher can't hold a colour that's gone from the board
    if (!isEmpty(this.grid)) {
      var present = this.colorsOnBoard();
      if (present.indexOf(this.cur) < 0) this.cur = this.pickColor();
      if (present.indexOf(this.next) < 0) this.next = this.pickColor();
    }
    this.state = 'aim';
  };
  P.colorsOnBoard = function () {
    var have = [], g = this.grid;
    for (var r = 0; r < MAXR; r++) for (var c = 0; c < rowLen(r); c++) { var k = g[r][c]; if (k >= 0 && k < NC && have.indexOf(k) < 0) have.push(k); }
    return have;
  };
  P.lowerCeiling = function () { this.drop++; this.shake = 300; G.sfx && G.sfx('garbage', this.opts.side); };

  // Grey bubbles stick to the underside of the cluster, 2 per unit.
  P.landGarbage = function () {
    if (!this.vs) return;
    var batches = this.takeReady(CFG.garbageDelay, CFG.maxGarbage), self = this, total = 0;
    if (!batches.length) return;
    batches.forEach(function (b) {
      var aim = (b.gap / 1000) * W;
      for (var i = 0; i < b.n * CFG.greysPerUnit; i++) {
        var spot = self.greySpot(aim + i * D * 3);
        if (spot) self.grid[spot.r][spot.c] = GREY;
      }
      total += b.n;
    });
    this.unitsTaken += total;
    while (this.unitsTaken >= CFG.unitsPerCeiling) { this.unitsTaken -= CFG.unitsPerCeiling; this.lowerCeiling(); }
    G.sfx && G.sfx('garbage', this.opts.side);
  };
  // A free spot hanging right under the cluster (or the ceiling) near x. Prefers spots held
  // by two bubbles and higher up, so greys spread along the underside instead of hanging in a chain.
  P.greySpot = function (x) {
    x = ((x % W) + W) % W;
    var g = this.grid, best = null, bs = -1e9;
    for (var r = 0; r < MAXR; r++) for (var c = 0; c < rowLen(r); c++) {
      if (g[r][c] >= 0) continue;
      var up = r === 0 ? 2 : neighbours(r, c).filter(function (n) { return n[0] < r && g[n[0]][n[1]] >= 0 && g[n[0]][n[1]] !== GREY; }).length;
      var upGrey = r === 0 ? 0 : neighbours(r, c).filter(function (n) { return n[0] < r && g[n[0]][n[1]] === GREY; }).length;
      if (!up && !upGrey) continue;
      var s = up * 30 - upGrey * 10 - r * 6 - Math.abs(cellX(r, c) - x) * 0.8;
      if (s > bs) { bs = s; best = { r: r, c: c }; }
    }
    return best;
  };

  P.update = function (dt, pad) {
    this.tickFlash(dt);
    if (this.shake > 0) this.shake -= dt;
    this.fallers = this.fallers.filter(function (f) { f.vy += 0.0012 * dt; f.y += f.vy * dt; return f.y < FH + 20; });
    if (this.dead) return;
    this.tickPending(dt);
    this.elapsed += dt;
    if (this.cpu) this.cpu.drive(dt, pad);
    if (this.state === 'aim') this.aim(dt, pad);
    else if (this.state === 'fly') this.fly(dt);
    else if (this.state === 'pop') { this.popT -= dt; if (this.popT <= 0) this.finishPop(); }
  };

  // ---------- drawing ----------
  function symbol(ctx, k, cx, cy, s) {
    ctx.beginPath();
    switch (k) {
      case 0: ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2); break;                                  // dot
      case 1: ctx.arc(cx, cy, s * 0.8, 0, Math.PI * 2); ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2, true); break;  // ring
      case 2: ctx.moveTo(cx, cy - s * 0.85); ctx.lineTo(cx + s * 0.85, cy + s * 0.6); ctx.lineTo(cx - s * 0.85, cy + s * 0.6); break;  // triangle
      case 3: for (var i = 0; i < 8; i++) { var a = -Math.PI / 2 + i * Math.PI / 4, rr = i & 1 ? s * 0.35 : s * 0.95; if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } break;  // star
      case 4: ctx.moveTo(cx, cy - s * 0.9); ctx.lineTo(cx + s * 0.7, cy); ctx.lineTo(cx, cy + s * 0.9); ctx.lineTo(cx - s * 0.7, cy); break;  // diamond
      case 5: ctx.rect(cx - s * 0.6, cy - s * 0.6, s * 1.2, s * 1.2); break;                    // square
    }
    ctx.closePath();
  }
  function bubble(ctx, k, cx, cy) {
    ctx.beginPath(); ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    if (k === GREY) {
      ctx.fillStyle = '#6a6474'; ctx.fill();
      ctx.strokeStyle = '#3c3745'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 3, cy - 3); ctx.lineTo(cx, cy); ctx.lineTo(cx - 2, cy + 3); ctx.moveTo(cx, cy); ctx.lineTo(cx + 3, cy - 1); ctx.stroke();
      ctx.fillStyle = '#9a93a6'; ctx.fillRect(Math.round(cx - 3), Math.round(cy - 5), 2, 1);
      return;
    }
    ctx.fillStyle = COLORS[k]; ctx.fill();
    ctx.strokeStyle = DARK[k]; ctx.lineWidth = 1; ctx.stroke();
    symbol(ctx, k, cx, cy + 0.5, 3.2); ctx.fillStyle = DARK[k]; ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(Math.round(cx - 4), Math.round(cy - 4), 2, 2);
  }

  P.draw = function (x, y) {
    var ctx = G.ctxRef(), bx = x + 14, by = y + 8, top = this.top(), r, c, self = this;
    var g = ctx.createLinearGradient(0, y, 0, y + 194); g.addColorStop(0, '#10264a'); g.addColorStop(1, '#2c1d52');
    ctx.fillStyle = g; ctx.fillRect(x, y, 160, 194);
    var sx = this.shake > 0 ? ((this.shake >> 5) & 1 ? 1 : -1) : 0;
    // frame
    G.rect(bx - 3, by - 3, W + 6, FH + 6, '#000');
    G.rect(bx - 2, by - 2, W + 4, FH + 4, '#6fb8d8');
    G.rect(bx - 1, by - 1, W + 2, FH + 2, '#000');
    G.rect(bx, by, W, FH, '#0b1428');
    ctx.save(); ctx.beginPath(); ctx.rect(bx, by, W, FH); ctx.clip();
    ctx.translate(sx, 0);
    // the ceiling press
    if (top > 0) {
      G.rect(bx, by, W, top, '#4a5068');
      for (var i = 0; i < this.drop; i++) G.rect(bx, by + i * RH + RH - 1, W, 1, '#2a2e3e');
      for (c = 6; c < W; c += 20) G.rect(bx + c, by + top - 6, 2, 2, '#8a92b0');
    }
    G.rect(bx, by + top, W, 2, '#c8d0e8');
    // danger line
    var ly = by + R + (DEAD - 1) * RH + R + 1;
    for (c = 0; c < W; c += 6) G.rect(bx + c, ly, 3, 1, lowest(this.grid) + this.drop >= DEAD - 2 ? G.PAL.red : '#5a3048');
    // bubbles
    var flashOn = (this.popT >> 6) & 1, hitSet = {};
    if (this.state === 'pop' && this.res) this.res.popped.concat(this.res.greys).forEach(function (p) { hitSet[p[0] + ',' + p[1]] = 1; });
    for (r = 0; r < MAXR; r++) for (c = 0; c < rowLen(r); c++) {
      var k = this.grid[r][c];
      if (k < 0) continue;
      var px = bx + cellX(r, c), py = by + cellY(r) + top;
      if (hitSet[r + ',' + c] && flashOn) { ctx.beginPath(); ctx.arc(px, py, R - 0.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); continue; }
      bubble(ctx, k, px, py);
    }
    this.fallers.forEach(function (f) { bubble(ctx, f.k, bx + f.x, by + f.y); });
    // launcher, aim guide and the bubble in flight
    var lx = bx + W / 2, lyy = by + LY;
    if (!this.dead) {
      var a = angleOf(this.tick), ca = Math.cos(a), sa = Math.sin(a);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (var d = 12; d < 44; d += 6) { ctx.moveTo(lx + ca * d, lyy - sa * d); ctx.lineTo(lx + ca * (d + 3), lyy - sa * (d + 3)); }
      ctx.stroke();
      ctx.strokeStyle = '#d9ccab'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lx, lyy); ctx.lineTo(lx + ca * 13, lyy - sa * 13); ctx.stroke();
      G.rect(lx - 10, lyy + 4, 20, 6, '#3a3f52'); G.rect(lx - 10, lyy + 4, 20, 1, '#5d6580');
      if (this.state === 'aim') bubble(ctx, this.cur, lx, lyy);
      if (this.shot) bubble(ctx, this.shot.k, bx + this.shot.x, by + this.shot.y);
      // next bubble, bottom left
      G.text('NEXT', bx + 14, lyy - 15, G.PAL.beige, { font: 'small', align: 'center' });
      bubble(ctx, this.state === 'aim' ? this.next : this.cur, bx + 14, lyy);
      // shots until the ceiling drops
      var left = Math.max(0, this.shotsLeft);
      for (i = 0; i < Math.min(left, 12); i++) G.rect(bx + W - 8 - (i % 4) * 5, lyy - 6 + Math.floor(i / 4) * 5, 3, 3, left <= 2 ? G.PAL.red : G.PAL.amber);
      if (this.state === 'aim' && CFG.hurry - this.idle < 3000 && ((this.idle >> 7) & 1)) G.text('HURRY!', lx, lyy - 50, G.PAL.red, { align: 'center', shadow: '#000' });
    }
    ctx.restore();
    // incoming (one unit = two grey bubbles)
    this.drawPendingBar(bx - 10, by, FH, 6, CFG.garbageDelay);
    // right panel
    var rx = bx + W + 4, cx = rx + 15;
    G.text('SCORE', cx, by + 2, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(Math.floor(this.score)), cx, by + 11, G.PAL.green, { font: 'small', align: 'center' });
    G.text('DROP', cx, by + 28, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.dropped), cx, by + 37, G.PAL.amber, { font: 'small', align: 'center' });
    G.text('SHOTS', cx, by + 54, G.PAL.beige, { font: 'small', align: 'center' });
    G.text(String(this.shots), cx, by + 63, G.PAL.cyan, { font: 'small', align: 'center' });
    this.drawFlash(bx + W / 2, by + 90);
    if (this.dead) { ctx.globalAlpha = 0.55; G.rect(bx - 3, by - 3, W + 6, FH + 6, '#000'); ctx.globalAlpha = 1; }
  };

  // ---------- CPU ----------
  // Traces every aim (finer at higher levels), plays out pops and drops, scores what's left.
  var LEVELS = {
    1: { think: 1100, every: 6, mistake: 0.40, swap: false }, 2: { think: 900, every: 5, mistake: 0.30, swap: false },
    3: { think: 750, every: 4, mistake: 0.22, swap: false }, 4: { think: 600, every: 3, mistake: 0.15, swap: true },
    5: { think: 480, every: 2, mistake: 0.10, swap: true }, 6: { think: 380, every: 2, mistake: 0.06, swap: true },
    7: { think: 280, every: 1, mistake: 0.03, swap: true }, 8: { think: 200, every: 1, mistake: 0.01, swap: true }
  };
  function evalShot(grid, top, drop, tick, k) {
    var cell = trace(grid, top, tick), g = copyGrid(grid);
    var res = resolve(g, cell.r, cell.c, k), sc = 0;
    if (res.popped.length) {
      var dropped = removeAndDrop(g, res);
      sc += 30 + res.popped.length * 6 + dropped.length * 22 + res.greys.length * 8;
      if (isEmpty(g)) sc += 400;
    } else {
      var same = 0, other = 0;
      neighbours(cell.r, cell.c).forEach(function (n) { var v = g[n[0]][n[1]]; if (v === k) same++; else if (v >= 0) other++; });
      sc += same * 10 - other * 3;
    }
    var low = lowest(g) + drop;
    if (low >= DEAD) sc -= 100000;
    else if (low >= DEAD - 3) sc -= (low - (DEAD - 4)) * 25;
    sc -= cell.r * 2;
    return { tick: tick, sc: sc };
  }
  function PopCPU(track, level) { this.t = track; this.cfg = LEVELS[Math.max(1, Math.min(8, level))]; this.plan = null; this.wait = this.cfg.think; }
  PopCPU.prototype.choose = function () {
    var t = this.t, cfg = this.cfg, top = t.top(), all = [], best = null, bestSwap = null;
    for (var tk = (t.shots * 7) % cfg.every; tk <= TICKS; tk += cfg.every) {
      var m = evalShot(t.grid, top, t.drop, tk, t.cur); all.push(m);
      if (!best || m.sc > best.sc) best = m;
      if (cfg.swap && t.next !== t.cur) { var m2 = evalShot(t.grid, top, t.drop, tk, t.next); if (!bestSwap || m2.sc > bestSwap.sc) bestSwap = m2; }
    }
    if (bestSwap && bestSwap.sc > best.sc + 15) return { tick: bestSwap.tick, swap: true };
    if (all.length > 1 && t.rng() < cfg.mistake) {
      all.sort(function (a, b) { return b.sc - a.sc; });
      best = all[Math.min(all.length - 1, 1 + Math.floor(t.rng() * 4))];
    }
    return { tick: best.tick, swap: false };
  };
  PopCPU.prototype.drive = function (dt, pad) {
    var st = {}, t = this.t;
    if (t.state !== 'aim') { this.plan = null; pad.feed(st, dt); return; }
    if (!this.plan) { this.wait = this.cfg.think * (0.6 + t.rng() * 0.8); this.plan = this.choose(); }
    var pl = this.plan;
    if (pl.swap) { pl.swap = false; pad.feed({ c: true }, dt); return; }
    var diff = pl.tick - t.tick;
    this.wait -= dt;
    if (diff !== 0) {
      st[diff < 0 ? 'left' : 'right'] = true;
      if (Math.abs(diff) <= 8) st.b = true;                    // fine aim for the last few steps
      // let go for a frame now and then so single taps land exactly
      if (Math.abs(diff) <= 2 && pad.down(diff < 0 ? 'left' : 'right')) st = {};
    } else if (this.wait <= 0) st.a = !pad.down('a');
    pad.feed(st, dt);
  };

  G.registerTrack('pop', {
    name: 'POP', blurb: 'AIM, FIRE, DROP BUBBLES', color: '#3fb4ff',
    make: function (opts) { return new Pop(opts); }
  });
})(globalThis.G = globalThis.G || {});
