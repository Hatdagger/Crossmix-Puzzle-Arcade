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
    G.TRACKS[id] = def;
    if (G.TRACK_ORDER.indexOf(id) < 0) G.TRACK_ORDER.push(id);
  };

  // Tracks that exist in the design but aren't built yet (greyed out on puzzle select).
  G.PLANNED = [
    { id: 'swap', name: 'SWAP' }, { id: 'jewel', name: 'JEWEL' }, { id: 'pop', name: 'POP' },
    { id: 'grab', name: 'GRAB' }, { id: 'nomnom', name: 'NOM NOM! PETS' },
    { id: 'power', name: 'POWER BRICK' }, { id: 'climb', name: 'CLIMB' }, { id: 'arsenal', name: 'ARSENAL' }
  ];

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
    },
    onSend: function (fn) { this.sendFns.push(fn); },
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
