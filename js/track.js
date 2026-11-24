// The track interface. Every puzzle game ("track") plugs into a match through this:
//   new Track(opts)   opts: { seed, side (0/1), cpuLevel (0 = human), sendOn }
//   update(dt, pad)   one frame; pad is a G.Pad (human or CPU-driven)
//   receive(units)    attack arriving from the other side
//   onSend(fn)        the match listens for outgoing units here
//   draw(x, y)        draw into a 160x194 half of the screen at (x, y)
//   dead              true once this side has lost
// Units are the shared attack currency: 1 unit is about one row of brick garbage.
(function (G) {
  'use strict';

  G.TRACKS = {};          // id -> { name, short, make(opts), ready }
  G.TRACK_ORDER = [];     // puzzle select order

  G.registerTrack = function (id, def) {
    def.id = id;
    var mk = def.make;
    def.make = function (opts) { var t = mk(opts); t.trackId = id; wrapFx(t); return t; };
    G.TRACKS[id] = def;
    if (G.TRACK_ORDER.indexOf(id) < 0) G.TRACK_ORDER.push(id);
  };

  // Tracks that exist in the design but aren't built yet (greyed out on puzzle select).
  G.PLANNED = [
    { id: 'swap', name: 'SWAP' }, { id: 'jewel', name: 'JEWEL' }, { id: 'pop', name: 'POP' },
    { id: 'grab', name: 'GRAB' }, { id: 'nomnom', name: 'NOM NOM! PETS' },
    { id: 'power', name: 'POWER BRICK' }, { id: 'climb', name: 'CLIMB' }, { id: 'arsenal', name: 'ARSENAL' }
  ];

  // Power Brick's powers that hit the other player. They act on the screen or the controls, so
  // every track takes them: Fog hides the top half of the field, Swap Hands reverses left/right,
  // Rush doubles the speed for a while.
  G.POWERS = ['fog', 'hands', 'rush'];
  G.POWER_TIME = { fog: 5000, hands: 5000, rush: 6000 };

  G.WEAPONS = ['wipe', 'empty', 'add', 'remove', 'fast', 'slow', 'gravity', 'flip', 'swap'];
  G.WEAPON_NAMES = { wipe: 'CLEAR FIELD', empty: 'EMPTY INVENTORY', add: 'ADD LINE', remove: 'REMOVE LINE', fast: 'SPEED UP',
    slow: 'SLOW DOWN', gravity: 'GRAVITY', flip: 'FLIP FIELD', swap: 'SWAP FIELDS',
    fog: 'FOG', hands: 'SWAP HANDS', rush: 'RUSH' };
  // Weapons cross the LAN as negative attack numbers: -1 = wipe, -2 = empty, ...
  // Powers use -21, -22, -23.
  G.weaponCode = function (w) { var k = G.POWERS.indexOf(w); return k >= 0 ? -(21 + k) : -(G.WEAPONS.indexOf(w) + 1); };
  G.weaponOf = function (n) { return n <= -21 ? G.POWERS[-n - 21] : G.WEAPONS[-n - 1]; };

  // Every track gets weapon effects without changing its own code: speed scales its clock
  // (Brick-engine tracks scale only the drop speed), flip turns its half of the screen upside down.
  var flipCanvas = null;
  function wrapFx(t) {
    var up = t.update, dr = t.draw;
    t.update = function (dt, pad) {
      if (!this.dead) {
        if (this.flipT > 0) this.flipT -= dt;
        if (this.fogT > 0) this.fogT -= dt;
        if (this.rushT > 0) this.rushT -= dt;
        if (this.handsT > 0) this.handsT -= dt;
        this.runFx();
      }
      if (this.handsT > 0) pad = handsPad(pad);
      var m = this.fxSpeed();
      if (this.fxOwnSpeed) { this.speedMul = m; return up.call(this, dt, pad); }
      return up.call(this, dt * m, pad);
    };
    t.draw = function (x, y) {
      var ctx = G.ctxRef();
      if (this.flipT > 0 && this.fieldRect && ctx.canvas && typeof document !== 'undefined') {
        // Flip Field: only the play field turns upside down. Text is held back while the track
        // draws, then written normally (text over the field moves to the mirrored spot).
        var texts = [], realText = G.text;
        G.text = function () { texts.push(arguments); };
        try { dr.call(this, x, y); } finally { G.text = realText; }
        var r = this.fieldRect(x, y), fx = r[0], fy = r[1], fw = r[2], fh = r[3];
        var tmp = flipCanvas || (flipCanvas = document.createElement('canvas'));
        if (tmp.width < fw || tmp.height < fh) { tmp.width = Math.max(tmp.width, fw); tmp.height = Math.max(tmp.height, fh); }
        var tc = tmp.getContext('2d');
        tc.clearRect(0, 0, tmp.width, tmp.height);
        tc.drawImage(ctx.canvas, fx, fy, fw, fh, 0, 0, fw, fh);
        ctx.save(); ctx.translate(0, 2 * fy + fh); ctx.scale(1, -1);
        ctx.drawImage(tmp, 0, 0, fw, fh, fx, fy, fw, fh);
        ctx.restore();
        texts.forEach(function (a) {
          var tx = a[1], ty = a[2], th = (G.FONTS[(a[4] && a[4].font) || 'big'] || {}).h || 7;
          if (tx >= fx && tx <= fx + fw && ty >= fy && ty <= fy + fh) ty = 2 * fy + fh - ty - th;
          realText(a[0], tx, ty, a[3], a[4]);
        });
      } else dr.call(this, x, y);
      if (this.fogT > 0 && this.fieldRect && !this.dead) drawFog(this.fieldRect(x, y), this.fogT, this.flipT > 0);
      if (this.handsT > 0 && !this.dead) G.text('HANDS SWAPPED ' + Math.ceil(this.handsT / 1000), x + 80, y + 177, G.PAL.pink, { font: 'small', align: 'center', shadow: '#000' });
      if (this.rushT > 0 && !this.dead) G.text('RUSH ' + Math.ceil(this.rushT / 1000), x + 80, y + 168, G.PAL.red, { font: 'small', align: 'center', shadow: '#000' });
      if (this.speedLv) G.text((this.speedLv > 0 ? 'SPEED +' : 'SPEED ') + this.speedLv, x + 80, y + 186, this.speedLv > 0 ? G.PAL.red : G.PAL.cyan, { font: 'small', align: 'center', shadow: '#000' });
    };
  }

  // Swap Hands: left and right trade places (CPU players are fooled too).
  var SWAPB = { left: 'right', right: 'left' };
  function handsPad(pad) {
    function m(b) { return SWAPB[b] || b; }
    return { down: function (b) { return pad.down(m(b)); }, pressed: function (b) { return pad.pressed(m(b)); },
      repeat: function (b, d, r) { return pad.repeat(m(b), d, r); },
      feed: function (st, dt) { pad.feed(st, dt); },   // a CPU feeds what it means; reading swaps it
      cur: pad.cur, prev: pad.prev, held: pad.held };
  }
  // Fog: a drifting grey cloud over the top half of the play field (the bottom half when flipped).
  function drawFog(r, t, flipped) {
    var fx = r[0], fy = r[1], fw = r[2], fh = Math.floor(r[3] / 2), ctx = G.ctxRef();
    if (flipped) fy += r[3] - fh;
    ctx.globalAlpha = Math.min(1, t / 400);
    G.rect(fx, fy, fw, fh, '#3a3848');
    var ph = Math.floor(Date.now() / 90);
    for (var yy = 0; yy < fh; yy += 4) for (var xx = ((yy >> 2) + ph) % 8; xx < fw; xx += 8) G.rect(fx + xx, fy + yy, 3, 2, '#55526a');
    G.text('FOG', fx + fw / 2, fy + fh / 2 - 3, '#8c88a8', { align: 'center' });
    ctx.globalAlpha = 1;
  }

  // A CPU player for an existing board (used when Swap hands a board to the CPU side).
  // Every CPU keeps its board in .t, so a spare one is made and pointed at this board.
  G.cpuFor = function (track, level) {
    var spare = G.TRACKS[track.trackId].make({ seed: 1, side: track.opts.side, cpuLevel: level, sendOn: true });
    var cpu = spare.cpu; if (!cpu) return null;
    cpu.t = track;
    if (track.isArsenal || track.isPower) { track.cpuLevel = level; track.cpuT = 1500; track.holdT = 0; }
    return cpu;
  };

  G.mulberry32 = function (a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  // Shared behaviour mixed into every track: incoming units, cancelling, the warning bar.
  G.TrackBase = {
    initBase: function (opts) {
      this.opts = opts;
      this.rng = G.mulberry32(opts.seed >>> 0);
      this.pending = [];        // incoming batches {n, t} (t = ms since it arrived)
      this.sendFns = [];
      this.dead = false;
      this.sent = 0;            // units sent this round (stats)
      this.flash = [];          // floating messages {text, t, color}
      this.cancelOn = true;     // your attacks cancel your incoming first
      this.markFns = [];
      this.hitFns = []; this.fxQ = []; this.flipT = 0; this.speedLv = 0;
      this.fogT = 0; this.rushT = 0; this.handsT = 0;
    },
    onSend: function (fn) { this.sendFns.push(fn); },
    // Milestones for netplay rules: mark('piece') for every piece placed / move made,
    // mark('big') for a hard move (T-spin, 4 lines, all clear, chains...).
    onMark: function (fn) { this.markFns.push(fn); },
    mark: function (kind) { (this.markFns || []).forEach(function (f) { f(kind); }); },
    receive: function (n) {
      if (n <= 0 || this.dead) return;
      this.pending.push({ n: n, t: 0, gap: Math.floor(this.rng() * 1000) });
      G.sfx && G.sfx('incoming', this.opts.side);
    },
    pendingTotal: function () { return this.pending.reduce(function (s, b) { return s + b.n; }, 0); },
    tickPending: function (dt) { this.pending.forEach(function (b) { b.t += dt; }); },
    // Remove and return the batches that have waited at least `delay` ms.
    takeReady: function (delay, max) {
      var out = [], budget = max == null ? 1e9 : max;
      while (this.pending.length && this.pending[0].t >= delay && budget > 0) {
        var b = this.pending[0], k = Math.min(b.n, budget);
        out.push({ n: k, gap: b.gap });
        b.n -= k; budget -= k;
        if (b.n <= 0) this.pending.shift();
      }
      return out;
    },
    takeAll: function () { var out = this.pending; this.pending = []; return out; },
    // Send an attack: it cancels your own incoming first, the rest goes out.
    send: function (n) {
      n = Math.floor(n);
      if (n <= 0) return;
      if (this.cancelOn) {
        while (n > 0 && this.pending.length) {
          var b = this.pending[0], k = Math.min(n, b.n);
          b.n -= k; n -= k;
          if (b.n <= 0) this.pending.shift();
        }
      }
      if (n <= 0) { this.say('BLOCK', G.PAL.cyan); return; }
      this.sent += n;
      this.sendFns.forEach(function (f) { f(n); });
    },
    // ---------- Arsenal weapons (and later Power Brick powers) ----------
    // A track that fires weapons calls hit(w); the match passes it to the opponent's applyWeapon.
    onHit: function (fn) { this.hitFns.push(fn); },
    hit: function (w) { this.hitFns.forEach(function (f) { f(w); }); },
    // Does this track react to weapon w? Add Line, Speed Up / Slow Down and Flip work on every
    // track; the others need the track's own fx method.
    takes: function (w, src) {
      switch (w) {
        case 'add': case 'fast': case 'slow': case 'flip': case 'remove': return true;
        case 'fog': case 'hands': case 'rush': return true;
        case 'wipe': return !!this.fxWipe;
        case 'gravity': return !!this.fxGravity;
        case 'empty': return !!this.fxEmpty;
        case 'swap': return !this.opts.net && !(src && src.opts.net);   // the match swaps the two games (local play only)
      }
      return false;
    },
    applyWeapon: function (w, src) {
      if (this.dead) return;
      if (!this.takes(w, src)) { this.say('IMMUNE', G.PAL.grey); return; }
      if (w === 'swap') return;   // handled by the match (it needs both sides)
      this.fxQ.push(w);
    },
    // Clear Field (fxWipe) puts a board back the way it looked when the match started.
    // Weapons wait until the track is between moves (fxSafe), so they never land mid-clear.
    runFx: function () {
      while (this.fxQ.length && !this.dead && (!this.fxSafe || this.fxSafe())) {
        var w = this.fxQ.shift();
        var bad = w === 'fast' || w === 'add' || w === 'flip' || G.POWERS.indexOf(w) >= 0;
        this.say(G.WEAPON_NAMES[w], bad ? G.PAL.red : G.PAL.cyan);
        G.sfx && G.sfx(w === 'add' ? 'garbage' : 'big', this.opts.side);
        if (w === 'add') this.receive(1);   // one unit of attack, like any other
        else if (w === 'flip') this.flipT = 8000;
        else if (w === 'fog') this.fogT = G.POWER_TIME.fog;
        else if (w === 'hands') this.handsT = G.POWER_TIME.hands;
        else if (w === 'rush') this.rushT = G.POWER_TIME.rush;
        // Speed Up / Slow Down are permanent for this board and stack (x1.25 each, from x0.5 to x3).
        else if (w === 'fast') this.speedLv = Math.min(5, this.speedLv + 1);
        else if (w === 'slow') this.speedLv = Math.max(-3, this.speedLv - 1);
        else if (w === 'wipe') this.fxWipe();
        // Remove Line undoes incoming garbage first; otherwise the track removes the line
        // furthest from where its pieces come in
        else if (w === 'remove') { if (this.pending.length) { var b = this.pending[this.pending.length - 1]; if (--b.n <= 0) this.pending.pop(); } else if (this.fxRemove) this.fxRemove(); }
        else if (w === 'gravity') this.fxGravity();
        else if (w === 'empty') this.fxEmpty();
      }
    },
    fxSpeed: function () { return Math.max(0.5, Math.min(3, Math.pow(1.25, this.speedLv))) * (this.rushT > 0 ? 2 : 1); },
    say: function (text, color) { this.flash.push({ text: text, t: 1200, color: color || G.PAL.white }); },
    tickFlash: function (dt) { this.flash = this.flash.filter(function (f) { f.t -= dt; return f.t > 0; }); },
    drawFlash: function (cx, y) {
      this.flash.forEach(function (f, i) {
        var a = Math.min(1, f.t / 300);
        var ctx = G.ctxRef(); ctx.globalAlpha = a;
        G.text(f.text, cx, y - i * 10 - Math.round((1200 - f.t) / 120), f.color, { align: 'center', shadow: '#000' });
        ctx.globalAlpha = 1;
      });
    },
    // Vertical incoming bar: amber while waiting, flashing red once it can land.
    drawPendingBar: function (x, y, h, unitPx, delay) {
      G.rect(x, y, 4, h, G.PAL.steelLo);
      var py = y + h, now = Date.now();
      for (var i = 0; i < this.pending.length && py > y; i++) {
        var b = this.pending[i], ph = Math.min(py - y, b.n * unitPx);
        var ready = b.t >= delay;
        var col = ready ? ((now >> 7) & 1 ? G.PAL.red : G.PAL.white) : G.PAL.amber;
        G.rect(x, py - ph, 4, ph, col);
        G.rect(x, py - ph, 4, 1, '#000');
        py -= ph;
      }
    }
  };
})(globalThis.G = globalThis.G || {});
