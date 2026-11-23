// Crossmix Puzzle Arcade: title, puzzle select, matches, pause and after-match menus.
(function (G) {
  'use strict';

  G.TITLE = 'CROSSMIX';
  G.SUBTITLE = 'PUZZLE ARCADE';
  G.VERSION = 'v0.3';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  G.gfxInit(ctx);
  var W = 320, H = 224, HALF_Y = 18;

  var MODES = [
    { id: 'cpu', name: 'VERSUS CPU', desc: 'BEST OF 3 AGAINST THE COMPUTER' },
    { id: 'vs', name: 'VERSUS 2P', desc: 'BEST OF 3, PLAYER AGAINST PLAYER' },
    { id: 'survival', name: 'SURVIVAL', desc: 'BEAT CPU AFTER CPU. SCORE = KOS' },
    { id: 'side', name: 'SIDE BY SIDE', desc: 'NO ATTACKS. EITHER PLAYER CAN PAUSE' },
    { id: 'challenges', name: 'CHALLENGES', desc: 'SURVIVAL ON YOUR NETWORK: OTHERS CAN JUMP IN' },
    { id: 'myside', name: 'MY SIDE', desc: 'YOUR HALF OF THE SCREEN IN SURVIVAL' },
    { id: 'sound', name: 'SOUND', desc: 'PLACEHOLDER BLIPS' }
  ];

  var S = {
    screen: 'title', titleSel: 0, cpuLevel: 3, mode: 'cpu',
    picks: ['random', 'random'], selCur: [0, 0], ready: [false, false], joined: [true, false],
    sides: null, phase: null, phaseT: 0, menu: null, menuSel: 0, round: 1, kos: 0, t: 0
  };
  try { S.cpuLevel = +localStorage.getItem('crossmix-cpu') || 3; } catch (e) {}

  // ---------- puzzle select list ----------
  function selList() {
    var list = G.TRACK_ORDER.map(function (id) { return { id: id, name: G.TRACKS[id].name, ok: true }; });
    list.push({ id: 'random', name: 'RANDOM', ok: true });
    G.PLANNED.forEach(function (p) { if (!G.TRACKS[p.id]) list.push({ id: p.id, name: p.name, ok: false }); });
    return list;
  }
  function builtIds() { return G.TRACK_ORDER.slice(); }
  // forCPU: skip tracks whose CPU player isn't ready yet (Climb's CPU is still weak).
  function resolvePick(pick, forCPU) {
    if (pick !== 'random') return pick;
    var ids = builtIds().filter(function (id) { return !forCPU || !G.TRACKS[id].cpuWeak; });
    return ids[Math.floor(Math.random() * ids.length)];
  }

  function goTitle() { S.screen = 'title'; S.menu = null; }
  function goSelect() {
    S.screen = 'select'; S.menu = null;
    var list = selList();
    [0, 1].forEach(function (i) {
      var k = list.findIndex(function (e) { return e.id === S.picks[i]; });
      S.selCur[i] = k < 0 ? 0 : k; S.ready[i] = false;
    });
    S.joined = [true, S.mode !== 'side'];
    S.selFor = 0;   // in CPU and survival modes player 1 picks for both sides in turn
  }

  // ---------- matches ----------
  function newSide(i, pick, human, level) {
    return { i: i, pick: pick, id: resolvePick(pick, !human), human: human, cpuLevel: level, pad: human ? G.Input.humans[i] : new G.Pad(), wins: 0, track: null, active: true };
  }
  function makeTrack(side, sendOn, seed, race) {
    side.track = G.TRACKS[side.id].make({ seed: seed != null ? seed : (Math.random() * 4294967296) >>> 0, side: side.i, cpuLevel: side.human ? 0 : side.cpuLevel, sendOn: sendOn && !race, race: race });
  }
  // Climb vs Climb in Versus is a race: same stage, same pieces, no attacks.
  function isRace() { return (S.mode === 'cpu' || S.mode === 'vs') && S.sides[0].id === 'climb' && S.sides[1].id === 'climb'; }
  function link() {
    var a = S.sides[0], b = S.sides[1], sendOn = S.mode !== 'side' && !isRace();
    [a, b].forEach(function (s, i) {
      var o = S.sides[1 - i];
      if (!s.track) return;
      s.track.onSend(function (n) { if (sendOn && o.track && !o.track.dead && S.phase === 'play') o.track.receive(n); });
    });
  }
  function startMatch() {
    var m = S.mode;
    // Survival with CHALLENGES ON runs in net.js (LAN matchmaking in the background).
    if (m === 'survival' && G.Net && G.SETTINGS.challenges) {
      S.screen = 'net'; S.menu = null;
      G.Net.start(S.picks[0], { exit: goTitle, select: goSelect, bg: bg });
      return;
    }
    S.sides = [
      newSide(0, S.picks[0], true, 0),
      m === 'vs' || m === 'side' ? newSide(1, S.picks[1], true, 0) : newSide(1, m === 'survival' ? 'random' : S.picks[1], false, m === 'survival' ? 1 : S.cpuLevel)
    ];
    if (m === 'side' && !S.joined[1]) S.sides[1].active = false;
    S.kos = 0; S.round = 1; S.survT = 0;
    S.screen = 'match'; S.menu = null;
    startRound();
  }
  function startRound() {
    var sendOn = S.mode !== 'side', race = isRace(), seed = (Math.random() * 4294967296) >>> 0;
    S.sides.forEach(function (s) { if (s.active) makeTrack(s, sendOn, race ? seed : null, race); else s.track = null; });
    link();
    S.phase = 'count'; S.phaseT = 2000; S.lastCount = -1;
  }
  function nextSurvivor() {
    var s = S.sides[1];
    s.pick = 'random'; s.id = resolvePick('random', true); s.cpuLevel = Math.min(8, 1 + S.kos);
    s.pad = new G.Pad();
    makeTrack(s, true);
    // relink: rebuild send hooks for both sides
    S.sides[0].track.sendFns = [];
    link();
  }

  function openMenu(kind, by) {
    S.menu = kind; S.menuSel = 0; S.menuBy = by;
    G.sfx('ok');
  }
  function menuItems() {
    if (S.menu === 'pause') return ['RESUME', 'RETRY', 'PUZZLE SELECT', 'QUIT'];
    return ['RETRY', 'PUZZLE SELECT', 'QUIT'];
  }
  function menuChoose(item) {
    G.sfx('ok');
    if (item === 'RESUME') { S.menu = null; return; }
    if (item === 'RETRY') { startMatch(); return; }
    if (item === 'PUZZLE SELECT') { goSelect(); return; }
    if (item === 'QUIT') goTitle();
  }
  function updateMenu() {
    var items = menuItems();
    if (G.Input.any('repeat', 'up', 250, 120)) { S.menuSel = (S.menuSel + items.length - 1) % items.length; G.sfx('menu'); }
    if (G.Input.any('repeat', 'down', 250, 120)) { S.menuSel = (S.menuSel + 1) % items.length; G.sfx('menu'); }
    if (G.Input.any('pressed', 'a') || (S.menu === 'over' && G.Input.any('pressed', 'start'))) menuChoose(items[S.menuSel]);
    else if (S.menu === 'pause' && (G.Input.any('pressed', 'start') || G.Input.any('pressed', 'b'))) { S.menu = null; G.sfx('back'); }
  }

  function updateMatch(dt) {
    if (S.menu) { updateMenu(); return; }
    // Start pauses (any human, any mode). On an MVS cabinet there would be no pausing.
    for (var i = 0; i < 2; i++) {
      var sd = S.sides[i];
      if (sd.human && G.Input.humans[i].pressed('start') && S.phase !== 'over') {
        if (S.mode === 'side' && !sd.active) { joinSide(i); return; }
        if (sd.active) { openMenu('pause', i); return; }
      }
    }
    if (S.phase === 'count') {
      S.phaseT -= dt;
      var n = Math.ceil(S.phaseT / 600);
      if (n !== S.lastCount) { S.lastCount = n; G.sfx(n > 0 && n <= 3 ? 'count' : 'go'); }
      if (S.phaseT <= 0) S.phase = 'play';
      return;
    }
    if (S.phase === 'roundEnd') {
      S.phaseT -= dt;
      S.sides.forEach(function (s) { if (s.track) s.track.tickFlash(dt); });
      if (S.phaseT <= 0) {
        var w = S.roundWinner;
        if (w != null && S.sides[w].wins >= 2) { S.phase = 'over'; openMenu('over'); G.sfx('win'); }
        else { S.round++; startRound(); }
      }
      return;
    }
    if (S.phase === 'over') return;
    // Survival changeover: the survivor keeps playing as normal (a breather to clean up the
    // board); only the CPU side pauses while the next opponent comes in.
    if (S.phase === 'swap') {
      var sv = S.sides[0].track;
      sv.update(dt, S.sides[0].pad);
      if (sv.dead) { S.phase = 'over'; openMenu('over'); return; }
      S.phaseT -= dt;
      if (!S.swapped && S.phaseT <= 1500) { S.swapped = true; S.kos++; nextSurvivor(); G.sfx('ok'); }
      var n2 = Math.ceil(S.phaseT / 500);
      if (S.swapped && n2 !== S.lastCount && n2 <= 3) { S.lastCount = n2; G.sfx(n2 > 0 ? 'count' : 'go'); }
      if (S.phaseT <= 0) S.phase = 'play';
      return;
    }
    // play
    S.sides.forEach(function (s) { if (s.track) s.track.update(dt, s.pad); });
    var a = S.sides[0].track, b = S.sides[1].track;
    if (S.mode === 'side') {
      S.sides.forEach(function (s) {
        if (s.track && s.track.dead && s.human && (s.pad.pressed('a'))) { makeTrack(s, false); G.sfx('ok'); }
      });
      return;
    }
    if (S.mode === 'survival') {
      if (a.dead) { S.phase = 'over'; openMenu('over'); return; }
      if (b.dead) { S.phase = 'swap'; S.phaseT = 2800; S.swapped = false; S.lastCount = -1; G.sfx('win'); }
      return;
    }
    if (a.raceWon || b.raceWon) {
      S.roundWinner = a.raceWon && b.raceWon ? null : a.raceWon ? 0 : 1;
      if (S.roundWinner != null) S.sides[S.roundWinner].wins++;
      S.phase = 'roundEnd'; S.phaseT = 2800;
      return;
    }
    if (a.dead || b.dead) {
      S.roundWinner = a.dead && b.dead ? null : a.dead ? 1 : 0;
      if (S.roundWinner != null) S.sides[S.roundWinner].wins++;
      S.phase = 'roundEnd'; S.phaseT = 2200;
    }
  }
  function joinSide(i) {
    var s = S.sides[i];
    s.active = true; s.pick = 'random'; s.id = resolvePick('random');
    makeTrack(s, false); G.sfx('ok');
  }

  // ---------- title ----------
  function updateTitle() {
    if (G.Input.any('repeat', 'up', 250, 120)) { S.titleSel = (S.titleSel + MODES.length - 1) % MODES.length; G.sfx('menu'); }
    if (G.Input.any('repeat', 'down', 250, 120)) { S.titleSel = (S.titleSel + 1) % MODES.length; G.sfx('menu'); }
    var m = MODES[S.titleSel];
    if ((m.id === 'challenges' || m.id === 'myside') && (G.Input.any('pressed', 'left') || G.Input.any('pressed', 'right'))) {
      if (m.id === 'challenges') G.toggleChallenges(); else G.toggleSide();
      G.sfx('menu');
    }
    if (m.id === 'cpu') {
      var d = (G.Input.any('repeat', 'right', 250, 120) ? 1 : 0) - (G.Input.any('repeat', 'left', 250, 120) ? 1 : 0);
      if (d) { S.cpuLevel = Math.max(1, Math.min(8, S.cpuLevel + d)); G.sfx('menu'); try { localStorage.setItem('crossmix-cpu', S.cpuLevel); } catch (e) {} }
    }
    if (G.Input.any('pressed', 'a') || G.Input.any('pressed', 'start')) {
      if (m.id === 'sound') { G.setSound(!G.soundOn); G.sfx('ok'); return; }
      if (m.id === 'challenges') { G.toggleChallenges(); G.sfx('ok'); return; }
      if (m.id === 'myside') { G.toggleSide(); G.sfx('ok'); return; }
      S.mode = m.id; G.sfx('ok'); goSelect();
    }
  }

  // ---------- puzzle select ----------
  function updateSelect() {
    var list = selList(), m = S.mode;
    function moveCur(i, pad) {
      var d = (pad.repeat('down', 250, 110) ? 1 : 0) - (pad.repeat('up', 250, 110) ? 1 : 0);
      if (!d) return;
      var k = S.selCur[i];
      do { k = (k + d + list.length) % list.length; } while (!list[k].ok);
      S.selCur[i] = k; G.sfx('menu');
    }
    if (m === 'cpu' || m === 'survival') {
      var pad = G.Input.humans[0], i = S.selFor;
      if (pad.pressed('b') || G.Input.humans[0].pressed('select')) {
        if (i === 1) { S.selFor = 0; S.ready[0] = false; G.sfx('back'); } else { goTitle(); G.sfx('back'); }
        return;
      }
      moveCur(i, pad);
      if (pad.pressed('a') || pad.pressed('start')) {
        S.picks[i] = list[S.selCur[i]].id; S.ready[i] = true; G.sfx('ok');
        if (m === 'survival' || i === 1) startMatch(); else S.selFor = 1;
      }
      return;
    }
    // VS 2P / Side by Side: each player picks their own side.
    for (var p = 0; p < 2; p++) {
      var pd = G.Input.humans[p];
      if (!S.joined[p]) { if (pd.pressed('start') || pd.pressed('a')) { S.joined[p] = true; G.sfx('ok'); } continue; }
      if (S.ready[p]) { if (pd.pressed('b')) { S.ready[p] = false; G.sfx('back'); } continue; }
      if (pd.pressed('b') || pd.pressed('select')) {
        if (p === 1 && m === 'side') { S.joined[1] = false; G.sfx('back'); } else { goTitle(); G.sfx('back'); }
        return;
      }
      moveCur(p, pd);
      if (pd.pressed('a') || pd.pressed('start')) { S.picks[p] = list[S.selCur[p]].id; S.ready[p] = true; G.sfx('ok'); }
    }
    var allReady = (S.ready[0]) && (S.ready[1] || (m === 'side' && !S.joined[1]));
    if (allReady) startMatch();
  }

  // ---------- drawing ----------
  var STARS = []; (function () { var r = G.mulberry32(7); for (var i = 0; i < 70; i++) STARS.push([r() * W, r() * H, r()]); })();
  function bg() {
    G.rect(0, 0, W, H, G.PAL.black);
    STARS.forEach(function (s) { var tw = 0.4 + 0.6 * Math.abs(Math.sin(S.t / 900 + s[2] * 9)); ctx.globalAlpha = tw * 0.6; G.px(s[0], s[1], '#ffffff'); });
    ctx.globalAlpha = 1;
  }
  function drawTitle() {
    bg();
    G.stripes(0, 18, W, 3, G.STRIPES, 0, 1);
    G.chrome(G.TITLE, W / 2, 34, 3, 'center');
    G.text(G.SUBTITLE, W / 2, 62, G.PAL.beige, { align: 'center', shadow: '#000' });
    MODES.forEach(function (m, i) {
      var y = 80 + i * 13, on = i === S.titleSel;
      var label = m.name;
      if (m.id === 'cpu') label += '  < LV ' + S.cpuLevel + ' >';
      if (m.id === 'sound') label += '  ' + (G.soundOn ? 'ON' : 'OFF');
      if (m.id === 'challenges') label += '  ' + (G.SETTINGS.challenges ? 'ON' : 'OFF');
      if (m.id === 'myside') label += '  ' + (G.SETTINGS.side ? 'RIGHT' : 'LEFT');
      if (on) G.rect(60, y - 3, 200, 13, G.PAL.steel);
      G.text(label, W / 2, y, on ? G.PAL.amber : G.PAL.white, { align: 'center', shadow: '#000' });
    });
    G.text(MODES[S.titleSel].desc, W / 2, 178, G.PAL.grey, { font: 'small', align: 'center' });
    G.text('A / START SELECT', W / 2, 196, G.PAL.beigeLo, { font: 'small', align: 'center' });
    G.text(G.VERSION + ' PROTOTYPE', W - 4, 214, G.PAL.steelHi, { font: 'small', align: 'right' });
  }
  function drawSelect() {
    bg();
    var list = selList(), m = S.mode;
    G.text('PUZZLE SELECT', W / 2, 6, G.PAL.amber, { align: 'center', shadow: '#000' });
    G.rect(159, 18, 2, 190, G.PAL.steel);
    for (var side = 0; side < 2; side++) {
      var x0 = side * 160, cx = x0 + 80;
      var who = side === 0 ? '1P' : (m === 'cpu' || m === 'survival') ? 'CPU' : '2P';
      if (m === 'survival' && side === 1) {
        G.text('CPU', cx, 22, G.PAL.grey, { align: 'center' });
        G.text('RANDOM TRACK', cx, 90, G.PAL.grey, { font: 'small', align: 'center' });
        G.text('EVERY OPPONENT', cx, 98, G.PAL.grey, { font: 'small', align: 'center' });
        continue;
      }
      G.text(who, cx, 22, side ? G.PAL.cyan : G.PAL.yellow, { align: 'center' });
      if (!S.joined[side]) { G.text('PRESS START', cx, 100, (S.t >> 9) & 1 ? G.PAL.white : G.PAL.grey, { align: 'center' }); continue; }
      list.forEach(function (e, k) {
        var y = 38 + k * 13, on = S.selCur[side] === k;
        var active = (m === 'cpu' || m === 'survival') ? S.selFor === side : true;
        if (on) G.rect(x0 + 12, y - 3, 136, 12, S.ready[side] ? G.PAL.greenDim : (active ? G.PAL.steel : G.PAL.steelLo));
        var col = !e.ok ? G.PAL.steelHi : on ? (S.ready[side] ? G.PAL.green : G.PAL.amber) : G.PAL.white;
        G.text(e.name, cx, y, col, { font: e.ok ? 'big' : 'small', align: 'center' });
      });
      G.text(S.ready[side] ? 'READY!' : '', cx, 196, G.PAL.green, { align: 'center' });
    }
    var hint = (m === 'cpu' && S.selFor === 1) ? "PICK THE CPU'S PUZZLE" : 'GREY PUZZLES ARE COMING LATER';
    G.text(hint, W / 2, 212, G.PAL.grey, { font: 'small', align: 'center' });
  }
  function drawMatch() {
    bg();
    var sides = S.sides;
    sides.forEach(function (s, i) {
      var x = i * 160;
      if (s.track) s.track.draw(x, HALF_Y);
      else {
        G.text('2P', x + 80, 90, G.PAL.cyan, { align: 'center' });
        G.text('PRESS START', x + 80, 104, (S.t >> 9) & 1 ? G.PAL.white : G.PAL.grey, { align: 'center' });
      }
    });
    // top bar
    G.rect(0, 0, W, 15, G.PAL.ink);
    G.stripes(0, 14, W, 1, G.STRIPES, 0, 1);
    sides.forEach(function (s, i) {
      var name = s.track ? G.TRACKS[s.id].name : '';
      var who = s.human ? (i ? '2P' : '1P') : 'CPU' + s.cpuLevel;
      G.text(who + ' ' + name, i ? W - 4 : 4, 4, i ? G.PAL.cyan : G.PAL.yellow, { font: 'small', align: i ? 'right' : 'left' });
    });
    if (S.mode === 'cpu' || S.mode === 'vs') {
      for (var i = 0; i < 2; i++) for (var k = 0; k < 2; k++) {
        var px = W / 2 + (i ? 12 + k * 8 : -18 - k * 8);
        G.rect(px, 4, 6, 6, sides[i].wins > k ? G.PAL.amber : G.PAL.steelLo);
      }
      G.text(isRace() ? 'RACE' : 'R' + S.round, W / 2, 4, G.PAL.white, { font: 'small', align: 'center' });
    } else if (S.mode === 'survival') G.text('KO ' + S.kos, W / 2, 4, G.PAL.amber, { font: 'small', align: 'center' });
    G.rect(159, HALF_Y, 2, H - HALF_Y, G.PAL.steelLo);
    // overlays
    if (S.phase === 'count') {
      var n = Math.ceil(S.phaseT / 600);
      G.chrome(n > 3 ? 'READY' : n > 0 ? String(n) : 'GO!', W / 2, 96, 3, 'center');
    }
    if (S.phase === 'roundEnd' || S.phase === 'over') {
      if (S.mode === 'cpu' || S.mode === 'vs') {
        sides.forEach(function (s, i) {
          var won = S.roundWinner === i, txt = S.roundWinner == null ? 'DRAW' : won ? 'WIN' : 'LOSE';
          G.chrome(txt, i * 160 + 80, 80, 2, 'center', won ? null : ['#9c8f70', '#5d6580']);
        });
      }
    }
    if (S.mode === 'side') sides.forEach(function (s, i) {
      if (s.track && s.track.dead) {
        G.chrome('GAME OVER', i * 160 + 80, 80, 1, 'center');
        if (s.human) G.text('A TO RETRY', i * 160 + 80, 100, G.PAL.white, { font: 'small', align: 'center' });
      }
    });
    if (S.phase === 'swap') {
      ctx.globalAlpha = 0.6; G.rect(161, HALF_Y, 159, H - HALF_Y, '#000'); ctx.globalAlpha = 1;
      if (!S.swapped) G.chrome('KO!', 240, 90, 3, 'center');
      else {
        G.text('NEXT CHALLENGER', 240, 70, G.PAL.amber, { align: 'center', shadow: '#000' });
        G.text(G.TRACKS[sides[1].id].name + '  CPU LV ' + sides[1].cpuLevel, 240, 84, G.PAL.white, { font: 'small', align: 'center' });
        var cn = Math.ceil(S.phaseT / 500);
        G.chrome(cn > 0 ? String(cn) : 'GO!', 240, 104, 3, 'center');
      }
    }
    if (S.menu) drawMenu();
  }
  function drawMenu() {
    var items = menuItems(), h = items.length * 16 + 24, y0 = Math.round((H - h) / 2) + (S.menu === 'over' ? 30 : 0);
    ctx.globalAlpha = 0.75; G.rect(0, 0, W, H, '#000'); ctx.globalAlpha = 1;
    G.bevel(90, y0, 140, h, G.PAL.steel, G.PAL.steelHi, G.PAL.steelLo, '#000');
    var title = S.menu === 'pause' ? 'PAUSED' : S.mode === 'survival' ? S.kos + ' KO' : 'MATCH OVER';
    G.text(title, W / 2, y0 + 6, G.PAL.amber, { align: 'center', shadow: '#000' });
    items.forEach(function (it, i) {
      var y = y0 + 22 + i * 16, on = i === S.menuSel;
      if (on) G.rect(96, y - 3, 128, 13, G.PAL.steelLo);
      G.text(it, W / 2, y, on ? G.PAL.amber : G.PAL.white, { align: 'center' });
    });
    if (S.menu === 'over' && (S.mode === 'cpu' || S.mode === 'vs') && S.roundWinner != null) {
      var w = S.sides[S.roundWinner];
      G.text((w.human ? (w.i ? '2P' : '1P') : 'CPU') + ' WINS ' + S.sides[S.roundWinner].wins + '-' + S.sides[1 - S.roundWinner].wins, W / 2, y0 - 12, G.PAL.white, { align: 'center', shadow: '#000' });
    }
  }

  // ---------- loop ----------
  function resize() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    if (s >= 2) s = Math.floor(s);
    var w = Math.round(W * s), h = Math.round(H * s);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var scan = document.getElementById('scan');
    if (scan) { scan.style.width = w + 'px'; scan.style.height = h + 'px'; scan.style.backgroundSize = '100% ' + Math.max(2, Math.round(s)) + 'px'; }
  }
  window.addEventListener('resize', resize); resize();
  canvas.addEventListener('dblclick', function () { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); });

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(50, now - last); last = now; S.t += dt;
    G.Input.poll(dt);
    if (S.screen === 'title') { updateTitle(); drawTitle(); }
    else if (S.screen === 'select') { updateSelect(); if (S.screen === 'select') drawSelect(); }
    else if (S.screen === 'net') { G.Net.update(dt); if (S.screen === 'net') G.Net.draw(); }
    else { updateMatch(dt); if (S.screen === 'match') drawMatch(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  G.state = S;
})(globalThis.G = globalThis.G || {});
