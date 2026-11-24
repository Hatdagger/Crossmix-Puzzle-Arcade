// SURVIVAL WITH CHALLENGES (LAN netplay through tools/lan-server.js).
// You play Survival against CPUs. With CHALLENGES ON and a LAN server around, the server matches
// you with other players in the background:
// - the host keeps their board; the challenger's board clears and counts in. One round.
// - the challenger takes half garbage until a big move (see track mark('big')) or 14 pieces/moves.
// - the loser can ask to run it back; if the winner accepts, round 2 (loser's board resets).
//   A 1-1 tie goes to round 3 with both boards cleared.
// - winner stays on (back to CPUs until the next challenger); the loser starts a fresh Survival.
// Netplay: your board runs here at a fixed 60 steps a second. Each step's buttons and the attacks
// that arrived are sent to the server; the opponent's browser replays them on a copy of your
// board (same seed). Only button presses cross the network.
(function (G) {
  'use strict';

  var W = 320, H = 224, HALF_Y = 18, STEP = 1000 / 60, SEND_EVERY = 3, COUNT = 2400;
  var PROTECT_PIECES = 14;

  // ---------- settings (title screen + pause menu) ----------
  var SET = { challenges: false, side: 0 };
  try { var raw = JSON.parse(localStorage.getItem('crossmix-net') || '{}'); SET.challenges = !!raw.challenges; SET.side = raw.side ? 1 : 0; } catch (e) {}
  function saveSet() { try { localStorage.setItem('crossmix-net', JSON.stringify(SET)); } catch (e) {} }
  G.SETTINGS = SET;

  // Inside the Crossmix app the app finds (or becomes) the host on the network by itself; the game
  // just asks it where to connect. Challenges start ON there unless the player turned them off.
  var APP = typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core;
  G.LAN = { role: '', ws: null, join: null };
  if (APP) {
    try { if (localStorage.getItem('crossmix-net') == null) SET.challenges = true; } catch (e) { SET.challenges = true; }
    var pollLan = function () {
      APP.invoke('lan_state').then(function (st) {
        var p = String(st || '').split('|');
        G.LAN = { role: p[0] || '', ws: p[1] || null, join: p[2] || null };
      }, function () {});
    };
    pollLan(); setInterval(pollLan, 1000);
  }
  G.toggleChallenges = function () { SET.challenges = !SET.challenges; saveSet(); if (A) { if (SET.challenges) connect(); else disconnect(); } };
  G.toggleSide = function () { SET.side = 1 - SET.side; saveSet(); };

  function bitsOf(pad) { var b = 0; G.BUTTONS.forEach(function (k, i) { if (pad.cur[k]) b |= 1 << i; }); return b; }
  function stateOf(bits) { var s = {}; G.BUTTONS.forEach(function (k, i) { if (bits & (1 << i)) s[k] = true; }); return s; }
  function seed() { return (Math.random() * 4294967296) >>> 0; }

  var A = null;      // the running arcade session
  var hooks = null;  // { exit, select, bg } from main.js

  G.Net = {
    start: function (pick, h) {
      hooks = h;
      A = { pick: pick, kos: 0, t: 0, phase: 'count', countT: COUNT, opp: null, ch: null, menu: null, menuSel: 0, banner: null, bannerT: 0, availSent: null, ws: null, net: 'off', acc: 0 };
      newBoard();
      newCpu(1);
      if (SET.challenges) connect();
    },
    update: function (dt) { if (A) update(dt); },
    draw: function () { if (A) draw(); },
    _dbg: { A: function () { return A; }, flush: function () { flush(true); } }   // for tests
  };
  function exit(to) { disconnect(); A = null; to === 'select' ? hooks.select() : hooks.exit(); }

  // ---------- connection ----------
  function wsUrl() {
    if (APP) return G.LAN.ws;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    if (/github\.io$/.test(location.hostname)) return null;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  function connect() {
    if (!A || A.ws) return;
    var url = wsUrl();
    if (!url) { A.net = 'none'; return; }
    var name = '';
    try { name = new URLSearchParams(location.search).get('name') || localStorage.getItem('crossmix-name') || ''; } catch (e) {}
    var ws;
    try { ws = new WebSocket(url); } catch (e) { A.net = 'none'; return; }
    A.ws = ws; A.net = 'connecting'; A.availSent = null;
    ws.onopen = function () {
      if (!A || A.ws !== ws) return;
      A.net = 'on';
      sendNow({ t: 'hello', name: name });
      // the server needs our whole board so far, in case we end up hosting a challenge
      var me = A.me;
      sendNow({ t: 'board', track: me.trackId, seed: me.seed });
      me.sent = 0; flush(true);
    };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } if (A && A.ws === ws) onMsg(m); };
    ws.onclose = function () { if (A && A.ws === ws) { A.ws = null; A.net = 'none'; if (A.ch) lostServer(); } };
    ws.onerror = function () {};
  }
  function disconnect() { if (A && A.ws) { var ws = A.ws; A.ws = null; A.net = 'off'; try { ws.close(); } catch (e) {} } }
  function sendNow(m) { if (A && A.ws && A.ws.readyState === 1) A.ws.send(JSON.stringify(m)); }

  // ---------- my board ----------
  function newBoard() {
    // RANDOM picks again for every new board
    var id = G.TRACKS[A.pick] ? A.pick : G.TRACK_ORDER[Math.floor(Math.random() * G.TRACK_ORDER.length)];
    var me = { trackId: id, seed: seed(), pad: new G.Pad(), log: [], sent: 0, incoming: [], deadSent: false, frac: 0 };
    me.track = G.TRACKS[me.trackId].make({ seed: me.seed, side: SET.side, cpuLevel: 0, sendOn: true });
    me.track.onSend(function (n) {
      if (!A) return;
      if (A.opp && A.opp.kind === 'cpu' && A.opp.track && !A.opp.track.dead) A.opp.track.receive(n);
      else if (A.opp && A.opp.kind === 'remote' && A.ch && A.ch.live) sendNow({ t: 'atk', n: n });
    });
    me.track.onMark(function (kind) {
      var p = A && A.ch && A.ch.protect;
      if (!p) return;
      if (kind === 'big' || (kind === 'piece' && ++p.pieces >= PROTECT_PIECES)) { A.ch.protect = null; A.me.track.say('FULL GARBAGE', G.PAL.red); }
    });
    A.me = me;
    if (A.net === 'on') sendNow({ t: 'board', track: me.trackId, seed: me.seed });
    return me;
  }
  function newCpu(level) {
    var id = G.TRACK_ORDER.filter(function (x) { return !G.TRACKS[x].cpuWeak; });
    id = id[Math.floor(Math.random() * id.length)];
    var t = G.TRACKS[id].make({ seed: seed(), side: 1 - SET.side, cpuLevel: level, sendOn: true });
    t.onSend(function (n) { if (A && A.me && A.phase === 'play') A.me.incoming.push(n); });
    A.opp = { kind: 'cpu', id: id, level: level, track: t, pad: new G.Pad() };
  }
  // Attacks from a remote opponent: half while a challenger is still protected.
  function incomingRemote(n) {
    var me = A.me;
    if (A.ch && A.ch.protect) { me.frac += n * 0.5; n = Math.floor(me.frac); me.frac -= n; }
    if (n > 0) me.incoming.push(n);
  }

  // ---------- messages ----------
  function onMsg(m) {
    var me = A.me;
    switch (m.t) {
      case 'match':
        A.menu = null; A.swapT = null;
        A.ch = { role: m.role, name: m.opp.name, score: m.score, round: m.round, live: m.role === 'host', protect: null, prompt: null };
        A.opp = { kind: 'remote', name: m.opp.name, mirror: null };
        if (m.role === 'join') {
          newBoard();
          A.ch.protect = { pieces: 0 };
          A.phase = 'count'; A.countT = COUNT;
          banner('CHALLENGING ' + m.opp.name);
        } else {
          banner('HERE COMES A NEW CHALLENGER!');
          A.ch.liveT = COUNT;   // the challenger is counting in; attacks start when they do
          A.ch.live = false;
        }
        G.sfx('win');
        return;
      case 'oboard':
        if (!A.opp || A.opp.kind !== 'remote') return;
        var t = G.TRACKS[m.track] ? G.TRACKS[m.track].make({ seed: m.seed >>> 0, side: 1 - SET.side, cpuLevel: 0, sendOn: true }) : null;
        A.opp.mirror = { trackId: m.track, track: t, frames: [], ptr: 0, pad: new G.Pad() };
        return;
      case 'of':
        var mr = A.opp && A.opp.mirror;
        if (!mr) return;
        if (m.start > mr.frames.length) return;
        for (var i = mr.frames.length - m.start; i < m.frames.length; i++) mr.frames.push(m.frames[i]);
        return;
      case 'atk':
        if (A.ch && A.phase === 'play') incomingRemote(m.n);
        return;
      case 'roundEnd':
        if (!A.ch) return;
        A.ch.score = m.score; A.ch.won = m.won; A.ch.live = false;
        A.phase = 'frozen';
        A.ch.prompt = m.next; A.ch.promptT = 7000; A.ch.answered = false;
        G.sfx(m.won ? 'win' : 'ko');
        return;
      case 'askRunback':
        if (!A.ch) return;
        A.ch.prompt = 'ask'; A.ch.promptT = 7000; A.ch.answered = false; A.ch.asker = m.name;
        G.sfx('ok');
        return;
      case 'nextRound':
        if (!A.ch) return;
        A.ch.round = m.round; A.ch.score = m.score; A.ch.prompt = null; A.ch.protect = null;
        if (m.resetMe) newBoard();
        A.phase = 'count'; A.countT = COUNT; A.ch.live = false; A.ch.liveT = COUNT;
        banner(m.decider ? 'TIE BREAKER! FRESH BOARDS' : 'RUN IT BACK!');
        return;
      case 'matchEnd':
        A.ch = null;
        if (m.won) {
          banner(m.why === 'LEFT' ? 'CHALLENGER LEFT. YOU STAY ON' : 'YOU WIN! YOU STAY ON');
          if (A.me.track.dead) { newBoard(); A.phase = 'count'; A.countT = COUNT; }
          else if (A.phase !== 'play') { A.phase = 'count'; A.countT = 1200; }
          A.kos++;
          A.swapT = 1800; A.opp = null;     // short breather, then the next CPU
        } else {
          banner('BACK TO SURVIVAL');
          A.kos = 0; newBoard(); newCpu(1);
          A.phase = 'count'; A.countT = COUNT;
        }
        return;
    }
  }
  function lostServer() {
    A.ch = null; banner('LOST THE LAN SERVER');
    if (A.me.track.dead) { A.kos = 0; newBoard(); A.phase = 'count'; A.countT = COUNT; }
    else if (A.phase === 'frozen') A.phase = 'play';
    newCpu(Math.min(8, 1 + A.kos));
  }
  function banner(t) { A.banner = t; A.bannerT = 2600; }

  // ---------- update ----------
  function update(dt) {
    A.t += dt;
    // Lost the server (or none yet): keep trying every 2 s, e.g. while another PC takes over hosting.
    if (SET.challenges && !A.ws && A.net !== 'off') {
      A.retryT = (A.retryT || 0) - dt;
      if (A.retryT <= 0) { A.retryT = 2000; connect(); }
    }
    if (A.bannerT > 0) A.bannerT -= dt;
    var p1 = G.Input.humans[0];
    if (A.menu) { updateMenu(p1); return; }
    // Start: pause menu (not during a challenge; the other player can't be paused)
    if (p1.pressed('start') && !A.ch) { A.menu = A.phase === 'over' ? 'over' : 'pause'; A.menuSel = 0; G.sfx('ok'); return; }
    if (A.ch && A.ch.prompt) updatePrompt(p1, dt);
    if (A.ch && !A.ch.live && A.ch.liveT != null && A.phase === 'play') { A.ch.liveT -= dt; if (A.ch.liveT <= 0) { A.ch.live = true; A.ch.liveT = null; } }

    if (A.phase === 'count') {
      A.countT -= dt;
      var n = Math.ceil(A.countT / 600);
      if (n !== A.lastCount) { A.lastCount = n; G.sfx(n > 0 && n <= 3 ? 'count' : 'go'); }
      if (A.countT <= 0) { A.phase = 'play'; if (A.ch) { A.ch.live = true; A.ch.liveT = null; } }
    }
    A.acc = Math.min(A.acc + dt, STEP * 6);
    var steps = 0;
    while (A.acc >= STEP) { A.acc -= STEP; steps++; }
    for (var i = 0; i < steps; i++) {
      if (A.phase === 'play') stepMe();
      if (A.opp && A.opp.kind === 'cpu' && A.phase === 'play' && !A.opp.track.dead) { A.opp.track.update(STEP, A.opp.pad); }
    }
    flush(false);
    // the opponent's board: replay their frames (catch up quickly when far behind)
    var mr = A.opp && A.opp.kind === 'remote' && A.opp.mirror;
    if (mr && mr.track) {
      var behind = mr.frames.length - mr.ptr, run = behind > 120 ? Math.min(behind, 3000) : Math.min(behind, behind > 8 ? steps + 3 : steps);
      for (var j = 0; j < run; j++) stepMirror(mr);
    }
    if (A.opp && A.opp.kind === 'cpu') A.opp.track.tickFlash(0);
    // CPU knocked out: next one comes in (like Survival)
    if (A.opp && A.opp.kind === 'cpu' && A.opp.track.dead && A.swapT == null) { A.kos++; A.swapT = 2200; G.sfx('win'); }
    if (A.swapT != null) {
      A.swapT -= dt;
      if (A.swapT <= 0) { A.swapT = null; if (!A.ch) newCpu(Math.min(8, 1 + A.kos)); }
    }
    // tell the server whether we can be matched right now
    var avail = SET.challenges && A.net === 'on' && !A.ch && A.phase === 'play' && !A.menu && !A.me.track.dead;
    if (A.net === 'on' && avail !== A.availSent) { A.availSent = avail; sendNow({ t: 'avail', on: avail }); }
  }
  function stepMe() {
    var me = A.me, ev = me.incoming.splice(0);
    ev.forEach(function (n) { me.track.receive(n); });
    var bits = bitsOf(G.Input.humans[0]);
    me.pad.feed(stateOf(bits), STEP);
    me.track.update(STEP, me.pad);
    me.log.push(ev.length ? [bits].concat(ev) : bits);
    if (me.track.dead && !me.deadSent) {
      me.deadSent = true; flush(true);
      if (A.ch) { sendNow({ t: 'dead' }); A.phase = 'frozen'; }
      else { A.phase = 'over'; A.menu = 'over'; A.menuSel = 0; }
    }
  }
  function flush(force) {
    var me = A && A.me;
    if (!me || A.net !== 'on') return;
    var n = me.log.length - me.sent;
    if (!n || (!force && n < SEND_EVERY)) return;
    sendNow({ t: 'f', start: me.sent, frames: me.log.slice(me.sent) });
    me.sent = me.log.length;
  }
  function stepMirror(mr) {
    var e = mr.frames[mr.ptr++], bits = typeof e === 'number' ? e : e[0];
    if (typeof e !== 'number') for (var i = 1; i < e.length; i++) mr.track.receive(e[i]);
    mr.pad.feed(stateOf(bits), STEP);
    mr.track.update(STEP, mr.pad);
  }

  // ---------- run-back prompts ----------
  function updatePrompt(p, dt) {
    var c = A.ch;
    c.promptT -= dt;
    if (c.answered) return;
    if (c.prompt === 'offerRunback') {
      if (p.pressed('a')) { sendNow({ t: 'runback' }); c.answered = true; c.prompt = 'waitAnswer'; G.sfx('ok'); }
      else if (p.pressed('b') || c.promptT <= 0) { sendNow({ t: 'noRunback' }); c.answered = true; G.sfx('back'); }
    } else if (c.prompt === 'ask') {
      if (p.pressed('a')) { sendNow({ t: 'accept', yes: true }); c.answered = true; G.sfx('ok'); }
      else if (p.pressed('b') || c.promptT <= 0) { sendNow({ t: 'accept', yes: false }); c.answered = true; G.sfx('back'); }
    }
  }

  // ---------- pause / game over menu ----------
  function menuItems() {
    var ch = 'CHALLENGES ' + (SET.challenges ? 'ON' : 'OFF'), side = 'MY SIDE ' + (SET.side ? 'RIGHT' : 'LEFT');
    return A.menu === 'pause' ? ['RESUME', ch, side, 'PUZZLE SELECT', 'QUIT'] : ['RETRY', ch, side, 'PUZZLE SELECT', 'QUIT'];
  }
  function updateMenu(p) {
    var items = menuItems();
    if (p.repeat('up', 250, 120)) { A.menuSel = (A.menuSel + items.length - 1) % items.length; G.sfx('menu'); }
    if (p.repeat('down', 250, 120)) { A.menuSel = (A.menuSel + 1) % items.length; G.sfx('menu'); }
    var it = items[A.menuSel];
    if (p.pressed('a') || (p.pressed('start') && A.menu === 'over')) {
      G.sfx('ok');
      if (it === 'RESUME') A.menu = null;
      else if (it === 'RETRY') { A.menu = null; A.kos = 0; newBoard(); newCpu(1); A.phase = 'count'; A.countT = COUNT; A.swapT = null; }
      else if (it.indexOf('CHALLENGES') === 0) G.toggleChallenges();
      else if (it.indexOf('MY SIDE') === 0) swapSides();
      else if (it === 'PUZZLE SELECT') exit('select');
      else if (it === 'QUIT') exit('title');
      return;
    }
    if (A.menu === 'pause' && (p.pressed('start') || p.pressed('b'))) { A.menu = null; G.sfx('back'); }
  }
  function swapSides() { G.toggleSide(); }

  // ---------- drawing ----------
  function draw() {
    hooks.bg();
    var ctx = G.ctxRef(), mySide = SET.side, oppSide = 1 - mySide, me = A.me;
    me.track.draw(mySide * 160, HALF_Y);
    var ox = oppSide * 160, cx = ox + 80;
    var oppTrack = A.opp && (A.opp.kind === 'cpu' ? A.opp.track : A.opp.mirror && A.opp.mirror.track);
    if (oppTrack) oppTrack.draw(ox, HALF_Y);
    else if (A.opp && A.opp.kind === 'remote') G.text('CONNECTING...', cx, 100, G.PAL.grey, { align: 'center' });
    // top bar
    G.rect(0, 0, W, 15, G.PAL.ink);
    G.stripes(0, 14, W, 1, G.STRIPES, 0, 1);
    var myLabel = 'YOU ' + G.TRACKS[me.trackId].name;
    var oppLabel = !A.opp ? '' : A.opp.kind === 'cpu' ? 'CPU' + A.opp.level + ' ' + G.TRACKS[A.opp.id].name : A.opp.name + (A.opp.mirror ? ' ' + (G.TRACKS[A.opp.mirror.trackId] || { name: '' }).name : '');
    G.text(myLabel, mySide ? W - 4 : 4, 4, G.PAL.yellow, { font: 'small', align: mySide ? 'right' : 'left' });
    G.text(oppLabel, oppSide ? W - 4 : 4, 4, A.opp && A.opp.kind === 'remote' ? G.PAL.cyan : G.PAL.white, { font: 'small', align: oppSide ? 'right' : 'left' });
    if (A.ch) {
      var sc = A.ch.score, rounds = A.ch.round > 1 || sc[0] + sc[1] > 1;
      G.text(rounds ? sc[0] + '-' + sc[1] : 'VS', W / 2, 4, G.PAL.amber, { font: 'small', align: 'center' });
    } else G.text('KO ' + A.kos, W / 2, 4, G.PAL.amber, { font: 'small', align: 'center' });
    G.rect(159, HALF_Y, 2, H - HALF_Y, G.PAL.steelLo);
    // status line
    var status = !SET.challenges ? '' : A.net === 'none' ? (APP ? 'LOOKING FOR PLAYERS...' : 'NO LAN SERVER: SOLO') : A.net === 'connecting' ? 'CONNECTING...' : A.ch ? (A.ch.protect ? 'HALF GARBAGE (' + (PROTECT_PIECES - A.ch.protect.pieces) + ')' : '') : 'CHALLENGES ON';
    if (status) G.text(status, mySide * 160 + 80, 214, A.ch && A.ch.protect ? G.PAL.cyan : G.PAL.grey, { font: 'small', align: 'center' });
    // CPU changeover
    if (A.swapT != null && !A.ch) {
      ctx.globalAlpha = 0.6; G.rect(ox + 1, HALF_Y, 159, H - HALF_Y, '#000'); ctx.globalAlpha = 1;
      G.chrome(A.opp ? 'KO!' : 'NEXT', cx, 90, 2, 'center');
    }
    if (A.phase === 'count') {
      var n = Math.ceil(A.countT / 600);
      G.chrome(n > 3 ? 'READY' : n > 0 ? String(n) : 'GO!', mySide * 160 + 80, 96, 2, 'center');
    }
    if (A.ch && A.phase === 'frozen' && A.ch.won != null && A.ch.prompt) {
      G.chrome(A.ch.won ? 'WIN' : 'LOSE', mySide * 160 + 80, 70, 2, 'center', A.ch.won ? null : ['#9c8f70', '#5d6580']);
    }
    if (A.ch && A.ch.prompt) drawPrompt();
    if (A.bannerT > 0 && A.banner) { G.rect(0, 104, W, 18, '#000'); G.text(A.banner, W / 2, 109, G.PAL.amber, { align: 'center' }); }
    if (A.menu) drawMenu();
  }
  function drawPrompt() {
    var c = A.ch, lines = null, secs = Math.max(0, Math.ceil(c.promptT / 1000));
    if (c.prompt === 'offerRunback' && !c.answered) lines = ['RUN IT BACK?', 'A YES   B NO   ' + secs];
    else if (c.prompt === 'waitAnswer') lines = ['ASKED FOR A RUN BACK', 'WAITING FOR ' + c.name];
    else if (c.prompt === 'waitRunback') lines = [c.name + ' MAY ASK', 'FOR A RUN BACK...'];
    else if (c.prompt === 'ask' && !c.answered) lines = [c.asker + ' WANTS TO RUN IT BACK', 'A ACCEPT   B DECLINE   ' + secs];
    else if (c.prompt === 'decider') lines = ['1-1! TIE BREAKER NEXT'];
    else if (c.prompt === 'end') lines = [c.won ? 'YOU WIN THE CHALLENGE' : 'CHALLENGE LOST'];
    if (!lines) return;
    G.bevel(40, 140, 240, 14 + lines.length * 12, G.PAL.steel, G.PAL.steelHi, G.PAL.steelLo, '#000');
    lines.forEach(function (l, i) { G.text(l, W / 2, 147 + i * 12, i ? G.PAL.white : G.PAL.amber, { font: i ? 'small' : 'big', align: 'center' }); });
  }
  function drawMenu() {
    var items = menuItems(), h = items.length * 16 + 24, y0 = Math.round((H - h) / 2);
    var ctx = G.ctxRef();
    ctx.globalAlpha = 0.75; G.rect(0, 0, W, H, '#000'); ctx.globalAlpha = 1;
    G.bevel(80, y0, 160, h, G.PAL.steel, G.PAL.steelHi, G.PAL.steelLo, '#000');
    G.text(A.menu === 'pause' ? 'PAUSED' : 'GAME OVER  ' + A.kos + ' KO', W / 2, y0 + 6, G.PAL.amber, { align: 'center', shadow: '#000' });
    items.forEach(function (it, i) {
      var y = y0 + 22 + i * 16, on = i === A.menuSel;
      if (on) G.rect(86, y - 3, 148, 13, G.PAL.steelLo);
      G.text(it, W / 2, y, on ? G.PAL.amber : G.PAL.white, { align: 'center' });
    });
  }
})(globalThis.G = globalThis.G || {});
