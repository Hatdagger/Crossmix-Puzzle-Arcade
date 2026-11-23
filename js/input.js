// Input: every player slot looks like a Neo Geo pad (stick + A B C D + Start + Select).
// Keyboard, gamepads and CPU players all drive the same Pad interface.
(function (G) {
  'use strict';

  var BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'c', 'd', 'start', 'select'];
  G.BUTTONS = BUTTONS;

  // Keyboard: player 1 on the main keys, player 2 on the number pad.
  var KEYS = [
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      a: ['KeyZ'], b: ['KeyX'], c: ['KeyC'], d: ['KeyV', 'Space'], start: ['Enter'], select: ['Backspace', 'ShiftRight'] },
    { up: ['Numpad8'], down: ['Numpad5', 'Numpad2'], left: ['Numpad4'], right: ['Numpad6'],
      a: ['Numpad1'], b: ['Numpad3'], c: ['Numpad7'], d: ['Numpad9', 'Numpad0'], start: ['NumpadEnter'], select: ['NumpadAdd'] }
  ];
  // Standard gamepad layout: A0 B1 X2 Y3 = Neo Geo A B C D, Back8 = Select, Start9, D-pad 12-15.
  var PAD = { a: [0], b: [1], c: [2], d: [3], select: [8], start: [9], up: [12], down: [13], left: [14], right: [15] };

  var keysDown = {};
  var PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'];
  window.addEventListener('keydown', function (e) {
    keysDown[e.code] = true;
    if (PREVENT.indexOf(e.code) >= 0) e.preventDefault();
    G.anyInput && G.anyInput();
  });
  window.addEventListener('keyup', function (e) { keysDown[e.code] = false; });
  window.addEventListener('blur', function () { keysDown = {}; });

  function Pad() {
    this.cur = {}; this.prev = {}; this.held = {}; this.lastDt = 16;
    BUTTONS.forEach(function (b) { this.cur[b] = false; this.prev[b] = false; this.held[b] = 0; }, this);
  }
  Pad.prototype.down = function (b) { return this.cur[b]; };
  Pad.prototype.pressed = function (b) { return this.cur[b] && !this.prev[b]; };
  // Auto-repeat for menus and cursors.
  Pad.prototype.repeat = function (b, delay, rate) {
    if (this.pressed(b)) return true;
    var h = this.held[b];
    if (!this.cur[b] || h < delay) return false;
    var prevH = h - this.lastDt;
    return Math.floor((h - delay) / rate) !== Math.floor(Math.max(0, prevH - delay) / rate);
  };
  // Feed a new state (object of button -> bool) for this frame.
  Pad.prototype.feed = function (state, dt) {
    this.lastDt = dt;
    BUTTONS.forEach(function (b) {
      this.prev[b] = this.cur[b];
      this.cur[b] = !!state[b];
      this.held[b] = this.cur[b] ? this.held[b] + dt : 0;
    }, this);
  };
  G.Pad = Pad;

  function padState(gp) {
    var s = {};
    if (!gp) return s;
    for (var b in PAD) s[b] = PAD[b].some(function (i) { var x = gp.buttons[i]; return x && (x.pressed || x.value > 0.5); });
    var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (ax < -0.5) s.left = true;
    if (ax > 0.5) s.right = true;
    if (ay < -0.5) s.up = true;
    if (ay > 0.5) s.down = true;
    return s;
  }

  var humans = [new Pad(), new Pad()];

  G.Input = {
    humans: humans,
    poll: function (dt) {
      var raw = (navigator.getGamepads ? navigator.getGamepads() : []) || [], list = [];
      for (var i = 0; i < raw.length; i++) if (raw[i] && raw[i].connected) list.push(raw[i]);
      G.padCount = list.length;
      humans.forEach(function (pad, si) {
        var st = padState(list[si]);
        BUTTONS.forEach(function (b) {
          if ((KEYS[si][b] || []).some(function (k) { return keysDown[k]; })) st[b] = true;
        });
        pad.feed(st, dt);
      });
    },
    // Menus that either player can drive.
    any: function (fn, b, x, y) { return humans[0][fn](b, x, y) || humans[1][fn](b, x, y); }
  };
})(globalThis.G = globalThis.G || {});
