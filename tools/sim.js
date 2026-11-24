// Headless CPU-vs-CPU balance runs: node tools/sim.js [games] [levelA] [levelB]
// Plays every pairing of tracks and prints win rates and units sent per minute.
globalThis.window = { addEventListener: function () {} };
globalThis.navigator = {};
globalThis.localStorage = { getItem: function () { return null; }, setItem: function () {} };
var path = require('path'), root = path.join(__dirname, '..', 'js');
['gfx.js', 'input.js', 'track.js', 'track-brick.js', 'track-calm.js', 'track-climb.js', 'track-jewel.js', 'track-swap.js', 'track-pop.js', 'track-grab.js', 'track-nomnom.js', 'track-arsenal.js'].forEach(function (f) { require(path.join(root, f)); });
var G = globalThis.G;
var games = +process.argv[2] || 10, la = +process.argv[3] || 5, lb = +process.argv[4] || la;
function play(idA, idB, seed) {
  var a = G.TRACKS[idA].make({ seed: seed, side: 0, cpuLevel: la, sendOn: true });
  var b = G.TRACKS[idB].make({ seed: seed * 7 + 1, side: 1, cpuLevel: lb, sendOn: true });
  a.onSend(function (n) { b.receive(n); }); b.onSend(function (n) { a.receive(n); });
  a.onHit(function (w) { b.applyWeapon(w, a); }); b.onHit(function (w) { a.applyWeapon(w, b); });   // Arsenal weapons (Swap isn't simulated)
  if (a.setOpponent) a.setOpponent(b); if (b.setOpponent) b.setOpponent(a);
  var pa = new G.Pad(), pb = new G.Pad(), t = 0, dt = 16;
  while (!a.dead && !b.dead && t < 600000) { a.update(dt, pa); b.update(dt, pb); t += dt; }
  return { win: a.dead && b.dead ? -1 : a.dead ? 1 : b.dead ? 0 : -2, t: t, sa: a.sent, sb: b.sent };
}
var ids = G.TRACK_ORDER;
ids.forEach(function (A) { ids.forEach(function (B) {
  var w = [0, 0], d = 0, time = 0, sa = 0, sb = 0;
  for (var g = 0; g < games; g++) { var r = play(A, B, 1000 + g); if (r.win >= 0) w[r.win]++; else d++; time += r.t; sa += r.sa; sb += r.sb; }
  var min = time / 60000;
  console.log(A + ' vs ' + B + ': ' + w[0] + '-' + w[1] + (d ? ' (' + d + ' draw/timeout)' : '') +
    '  avg ' + (time / games / 1000).toFixed(0) + 's  sent/min ' + (sa / min).toFixed(1) + ' vs ' + (sb / min).toFixed(1));
}); });
