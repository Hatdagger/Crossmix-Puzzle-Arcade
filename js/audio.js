// Placeholder sound: tiny synth blips made in code (no sound files yet).
(function (G) {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext, ac = null, bus = null;
  G.soundOn = true;
  try { G.soundOn = localStorage.getItem('crossmix-sound') !== 'off'; } catch (e) {}

  function ensure() {
    if (!AC) return;
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try { ac = new AC(); bus = ac.createGain(); bus.gain.value = 0.35; bus.connect(ac.destination); } catch (e) { ac = null; }
  }
  G.anyInput = ensure;
  window.addEventListener('pointerdown', ensure);

  function tone(freq, dur, type, vol, pan, slide) {
    if (!ac || !G.soundOn) return;
    var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (ac.createStereoPanner) { var p = ac.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(bus); } else g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  var SFX = {
    move: function (p) { tone(660, 0.03, 'square', 0.03, p); },
    rotate: function (p) { tone(880, 0.04, 'square', 0.04, p); },
    hold: function (p) { tone(520, 0.08, 'triangle', 0.08, p); },
    lock: function (p) { tone(180, 0.06, 'square', 0.06, p); },
    hard: function (p) { tone(300, 0.12, 'sawtooth', 0.08, p, 80); },
    clear: function (p) { tone(784, 0.12, 'square', 0.08, p); tone(1046, 0.18, 'square', 0.05, p); },
    big: function (p) { [784, 988, 1175, 1568].forEach(function (f, i) { setTimeout(function () { tone(f, 0.15, 'square', 0.07, p); }, i * 60); }); },
    incoming: function (p) { tone(220, 0.15, 'triangle', 0.08, p, 160); },
    garbage: function (p) { tone(110, 0.2, 'sawtooth', 0.1, p, 60); },
    bad: function (p) { tone(140, 0.2, 'square', 0.07, p); },
    tick: function (p) { tone(1500, 0.03, 'sine', 0.05, p); },
    ko: function (p) { tone(400, 0.6, 'sawtooth', 0.12, p, 50); },
    menu: function () { tone(990, 0.04, 'square', 0.05, 0); },
    ok: function () { tone(660, 0.06, 'square', 0.06, 0); tone(1320, 0.1, 'square', 0.05, 0); },
    back: function () { tone(330, 0.08, 'square', 0.05, 0); },
    count: function () { tone(440, 0.12, 'square', 0.08, 0); },
    go: function () { tone(880, 0.3, 'square', 0.09, 0); },
    win: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.25, 'square', 0.07, 0); }, i * 120); }); }
  };
  // side 0 = left, 1 = right (panned a little), undefined = centre
  G.sfx = function (name, side) { var f = SFX[name]; if (f) f(side == null ? 0 : side ? 0.4 : -0.4); };
  G.setSound = function (on) { G.soundOn = on; try { localStorage.setItem('crossmix-sound', on ? 'on' : 'off'); } catch (e) {} };
})(globalThis.G = globalThis.G || {});
