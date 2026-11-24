// Crossmix LAN server: serves the game and does challenge matchmaking. Plain Node, nothing to install.
//   node tools/lan-server.js [port]        (default port 8080)
// Everyone on the same network opens the address it prints, turns CHALLENGES ON and plays SURVIVAL.
//
// How it works:
// - Everyone plays their own Survival against CPUs. Players with challenges on are matched in the
//   background: whoever has been waiting longest gets the next open spot; the winner of the last
//   challenge goes first.
// - The host keeps their board; the challenger's board clears and counts in. One round.
// - The loser can ask to run it back; if the winner accepts, round 2. If that ties it 1-1, round 3
//   starts with both boards cleared. Max 3 rounds.
// - Winner stays on (back to CPUs until the next challenger); the loser starts a fresh Survival.
//
// Netplay: each browser runs its own board and streams its button presses (plus the attacks it
// received) frame by frame. The server keeps each board's log and relays it to the opponent,
// whose browser replays it on a copy of that board (same seed). Attacks go player to player.
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');

var PORT = +process.argv[2] || 8080;
var ROOT = path.join(__dirname, '..');
var TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
var ASK_MS = 7000;          // how long a run-back question waits for an answer
var REPEAT_MS = 20000;      // the same two players aren't paired again this soon (unless no one else is around)

// ---------- static files ----------
var server = http.createServer(function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  var file = path.normalize(path.join(ROOT, url));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- minimal WebSocket (RFC 6455, text frames) ----------
server.on('upgrade', function (req, sock) {
  if (req.url.split('?')[0] !== '/ws') { sock.destroy(); return; }
  var key = req.headers['sec-websocket-key'];
  var accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  var client = addClient(sock), buf = Buffer.alloc(0), frag = '';
  sock.on('data', function (d) {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      var fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80, len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      var mask = null;
      if (masked) { if (buf.length < off + 4) return; mask = buf.slice(off, off + 4); off += 4; }
      if (buf.length < off + len) return;
      var payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (mask) for (var i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op === 0x8) { sock.end(); return; }
      if (op === 0x9) { sendFrame(sock, payload, 0xA); continue; }
      if (op === 0x1 || op === 0x0) {
        frag += payload.toString('utf8');
        if (fin) { var text = frag; frag = ''; try { onMessage(client, JSON.parse(text)); } catch (e) { console.log('bad message', e.message); } }
      }
    }
  });
  sock.on('close', function () { removeClient(client); });
  sock.on('error', function () { removeClient(client); });
});
function sendFrame(sock, payload, op) {
  var len = payload.length, head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | (op || 0x1);
  try { sock.write(Buffer.concat([head, payload])); } catch (e) {}
}
function send(c, msg) { if (c && c.alive) sendFrame(c.sock, Buffer.from(JSON.stringify(msg))); }

// ---------- players ----------
// c.avail: opted in and free to be matched (playing solo, not paused or game over)
// c.board: { track, seed, log[] } the board this player is playing right now
var clients = [], nextId = 1;

function addClient(sock) { var c = { id: nextId++, sock: sock, alive: true, name: 'PLAYER', avail: false, since: 0, board: null, match: null, last: {} }; clients.push(c); return c; }
function removeClient(c) {
  if (!c.alive) return;
  c.alive = false;
  clients.splice(clients.indexOf(c), 1);
  console.log(c.name + ' left');
  if (c.match) { var m = c.match, o = opp(m, c); finishMatch(m, o, 'LEFT'); }
}
function opp(m, c) { return m.p[0] === c ? m.p[1] : m.p[0]; }
function idx(m, c) { return m.p.indexOf(c); }

function onMessage(c, msg) {
  switch (msg.t) {
    case 'hello':
      var name = String(msg.name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 10).trim();
      c.name = name || 'PLAYER ' + c.id;
      send(c, { t: 'welcome', id: c.id, name: c.name });
      console.log(c.name + ' connected');
      return;
    case 'avail':
      if (msg.on && !c.avail) c.since = Date.now();
      c.avail = !!msg.on;
      if (c.avail) c.winner = !!c.winner; else c.winner = false;
      return;
    case 'board':
      c.board = { track: String(msg.track), seed: msg.seed >>> 0, log: [] };
      if (c.match) send(opp(c.match, c), { t: 'oboard', track: c.board.track, seed: c.board.seed });
      return;
    case 'f':
      if (!c.board || msg.start !== c.board.log.length) return;
      Array.prototype.push.apply(c.board.log, msg.frames);
      if (c.match) send(opp(c.match, c), { t: 'of', start: msg.start, frames: msg.frames });
      return;
    case 'atk':
      if (c.match && c.match.phase === 'play') send(opp(c.match, c), { t: 'atk', n: msg.n | 0 });
      return;
    case 'dead':
      if (c.match && c.match.phase === 'play') roundOver(c.match, opp(c.match, c));
      return;
    case 'runback':
      var m = c.match;
      if (m && m.phase === 'offer' && m.loser === c) {
        m.phase = 'ask'; clearTimeout(m.timer);
        send(opp(m, c), { t: 'askRunback', name: c.name });
        m.timer = setTimeout(function () { decline(m); }, ASK_MS);
      } else if (m && m.phase === 'offer') { /* only the loser can ask */ }
      return;
    case 'noRunback':
      if (c.match && c.match.phase === 'offer' && c.match.loser === c) { clearTimeout(c.match.timer); decline(c.match); }
      return;
    case 'accept':
      var m2 = c.match;
      if (!m2 || m2.phase !== 'ask' || m2.loser === c) return;
      clearTimeout(m2.timer);
      if (msg.yes) nextRound(m2, false); else decline(m2);
      return;
  }
}

// ---------- matchmaking ----------
setInterval(function () {
  var free = clients.filter(function (c) { return c.avail && !c.match && c.board; });
  if (free.length < 2) return;
  // the last winner goes first, then whoever has waited longest
  free.sort(function (a, b) { return (b.winner - a.winner) || (a.since - b.since); });
  var a = free[0], now = Date.now();
  var b = free.slice(1).find(function (x) { return !(a.last[x.id] && now - a.last[x.id] < REPEAT_MS); });
  if (!b) b = free.length === 2 ? free[1] : null;   // only two people around: let them play again
  if (!b) return;
  startMatch(a, b);
}, 400);

// The host keeps their board: the winner of the last challenge, else whoever has the older board.
function startMatch(a, b) {
  var host = a.winner ? a : b.winner ? b : (a.since <= b.since ? a : b), join = host === a ? b : a;
  var m = { p: [host, join], score: [0, 0], round: 1, phase: 'play' };
  host.match = join.match = m;
  host.avail = join.avail = false; host.winner = join.winner = false;
  console.log('challenge: ' + join.name + ' joins ' + host.name);
  // the joiner starts a new board (they send 'board' themselves); the host keeps theirs
  send(host, { t: 'match', role: 'host', opp: { id: join.id, name: join.name }, score: [0, 0], round: 1 });
  send(join, { t: 'match', role: 'join', opp: { id: host.id, name: host.name }, score: [0, 0], round: 1 });
  // give the joiner the host's whole board so far, so they can replay it
  send(join, { t: 'oboard', track: host.board.track, seed: host.board.seed });
  if (host.board.log.length) send(join, { t: 'of', start: 0, frames: host.board.log });
}
function roundOver(m, winner) {
  var w = idx(m, winner), loser = opp(m, winner);
  m.score[w]++;
  m.loser = loser;
  var over = m.round >= 3 || m.score[w] >= 2 || (m.round === 2 && m.score[w] === 2);
  // after round 2 at 1-1 the decider is automatic
  if (m.round === 2 && m.score[0] === 1 && m.score[1] === 1) {
    m.phase = 'between';
    m.p.forEach(function (p, i) { send(p, { t: 'roundEnd', won: p === winner, score: [m.score[i], m.score[1 - i]], next: 'decider' }); });
    m.timer = setTimeout(function () { nextRound(m, true); }, 2500);
    return;
  }
  if (m.round === 1) {
    // single round unless the loser asks to run it back and the winner accepts
    m.phase = 'offer';
    m.p.forEach(function (p, i) { send(p, { t: 'roundEnd', won: p === winner, score: [m.score[i], m.score[1 - i]], next: p === winner ? 'waitRunback' : 'offerRunback' }); });
    m.timer = setTimeout(function () { decline(m); }, ASK_MS);
    return;
  }
  m.phase = 'done';
  m.p.forEach(function (p, i) { send(p, { t: 'roundEnd', won: p === winner, score: [m.score[i], m.score[1 - i]], next: 'end' }); });
  m.timer = setTimeout(function () { finishMatch(m, winner, ''); }, 2500);
}
function decline(m) {
  if (m.phase !== 'offer' && m.phase !== 'ask') return;
  m.phase = 'done';
  finishMatch(m, opp(m, m.loser), '');
}
// Round 2: the loser's board resets, the winner keeps theirs. Round 3 (tie-break): both reset.
function nextRound(m, decider) {
  m.round++;
  m.phase = 'play';
  m.p.forEach(function (p, i) {
    send(p, { t: 'nextRound', round: m.round, score: [m.score[i], m.score[1 - i]], resetMe: decider || p === m.loser, decider: decider });
  });
}
function finishMatch(m, winner, why) {
  clearTimeout(m.timer);
  var loser = opp(m, winner);
  m.p.forEach(function (p) { p.match = null; });
  winner.last[loser.id] = loser.last[winner.id] = Date.now();
  winner.winner = true;
  console.log('challenge over: ' + winner.name + ' wins' + (why ? ' (' + why + ')' : ''));
  send(winner, { t: 'matchEnd', won: true, why: why });
  send(loser, { t: 'matchEnd', won: false, why: why });
}

// ---------- start ----------
// Run directly (node tools/lan-server.js) it prints the addresses to open. The Crossmix app
// starts it itself through start()/stop() and finds it on the network on its own.
function printAddresses(port) {
  console.log('Crossmix LAN server is running. On each PC on this network, open:');
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (k) {
    nets[k].forEach(function (n) { if (n.family === 'IPv4' && !n.internal) console.log('   http://' + n.address + ':' + port + '/'); });
  });
  console.log('   (on this PC: http://localhost:' + port + '/)');
  console.log('Then set CHALLENGES ON and play SURVIVAL. Close this window to stop the server.');
}
if (require.main === module) {
  server.listen(PORT, function () { printAddresses(PORT); });
} else {
  module.exports = {
    // Listen on the first free port from `port` up; cb(err, port).
    start: function (port, root, cb) {
      if (root) ROOT = root;
      var tries = 0;
      function attempt(p) {
        server.once('error', function (e) { if (e.code === 'EADDRINUSE' && ++tries < 20) attempt(p + 1); else cb(e); });
        server.listen(p, function () { server.removeAllListeners('error'); cb(null, p); });
      }
      attempt(port);
    },
    stop: function () {
      clients.slice().forEach(function (c) { try { c.sock.destroy(); } catch (e) {} });
      try { server.close(); } catch (e) {}
    },
    players: function () { return clients.length; }
  };
}
