// Crossmix LAN: finds or becomes the host on the home network, and runs the host's server.
// Only Rust's standard library is used, so it builds and tests anywhere.
//
// Finding a host (UDP port 47811):
// - Every copy asks "anyone hosting?" every second (broadcast, plus this PC's own address).
// - Hosts answer with their address, port, version and start time.
// - On launch a copy listens for ~2 s. No host of the same version -> it becomes the host.
// - If two copies end up hosting, the one started first wins and the other steps down.
// - If the host goes away, everyone looks again after a short random wait and one takes over.
//
// The host's server is a port of tools/lan-server.js: it serves the game files (so phones and
// tablets can join from a browser) and does challenge matchmaking over WebSocket.
use crate::json::{self, b, n, obj, s, Value};
use crate::ws;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const DISCOVERY_PORT: u16 = 47811;
const ASK_MS: u128 = 7000;      // how long a run-back question waits for an answer
const REPEAT_MS: u128 = 20000;  // the same two players aren't paired again this soon

pub type AssetFn = fn(&str) -> Option<&'static [u8]>;

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) }
fn log(msg: &str) { println!("[lan] {}", msg); }

// ============================================================================================
// Server: static files + WebSocket matchmaking
// ============================================================================================

enum Ev { Open(u64, TcpStream), Msg(u64, String), Pong(u64, Vec<u8>), Close(u64) }

pub struct Server { pub port: u16, stop: Arc<AtomicBool> }

impl Server {
    // Listen on the first free port from `port` up.
    pub fn start(port: u16, assets: AssetFn) -> std::io::Result<Server> {
        let mut last = None;
        for p in port..port + 20 {
            match TcpListener::bind(("0.0.0.0", p)) {
                Ok(l) => return Ok(Server::run(l, p, assets)),
                Err(e) => last = Some(e),
            }
        }
        Err(last.unwrap())
    }
    fn run(listener: TcpListener, port: u16, assets: AssetFn) -> Server {
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = channel::<Ev>();
        let ids = Arc::new(AtomicU64::new(1));
        listener.set_nonblocking(true).ok();
        let st = stop.clone();
        thread::spawn(move || {
            while !st.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((sock, _)) => {
                        sock.set_nonblocking(false).ok();
                        let (tx, ids, st2) = (tx.clone(), ids.clone(), st.clone());
                        thread::spawn(move || handle_conn(sock, tx, ids, assets, st2));
                    }
                    Err(_) => thread::sleep(Duration::from_millis(20)),
                }
            }
        });
        let st = stop.clone();
        thread::spawn(move || Hub::new().run(rx, st));
        Server { port, stop }
    }
    pub fn stop(&self) { self.stop.store(true, Ordering::Relaxed); }
}

fn content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "html" => "text/html", "js" => "text/javascript", "css" => "text/css", "png" => "image/png",
        "json" => "application/json", "md" => "text/plain", "ogg" => "audio/ogg", "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn handle_conn(mut sock: TcpStream, tx: Sender<Ev>, ids: Arc<AtomicU64>, assets: AssetFn, stop: Arc<AtomicBool>) {
    // read the request head
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let head_end;
    sock.set_read_timeout(Some(Duration::from_secs(10))).ok();
    loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") { head_end = p + 4; break; }
        if buf.len() > 16384 { return; }
        match sock.read(&mut tmp) { Ok(0) | Err(_) => return, Ok(k) => buf.extend_from_slice(&tmp[..k]) }
    }
    sock.set_read_timeout(None).ok();
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let rest = buf[head_end..].to_vec();
    let mut lines = head.split("\r\n");
    let req = lines.next().unwrap_or("");
    let mut parts = req.split(' ');
    let _method = parts.next();
    let raw_path = parts.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or("/").to_string();
    let mut key = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            if k.trim().eq_ignore_ascii_case("sec-websocket-key") { key = Some(v.trim().to_string()); }
        }
    }
    if path == "/ws" {
        let key = match key { Some(k) => k, None => return };
        let resp = format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n", ws::accept_key(&key));
        if sock.write_all(resp.as_bytes()).is_err() { return; }
        sock.set_nodelay(true).ok();
        let id = ids.fetch_add(1, Ordering::Relaxed);
        let writer = match sock.try_clone() { Ok(w) => w, Err(_) => return };
        if tx.send(Ev::Open(id, writer)).is_err() { return; }
        let mut rd = ws::Reader::new(rest);
        loop {
            if stop.load(Ordering::Relaxed) { break; }
            match rd.next(&mut sock) {
                Some(ws::Frame::Text(t)) => { if tx.send(Ev::Msg(id, t)).is_err() { break; } }
                Some(ws::Frame::Ping(p)) => { let _ = tx.send(Ev::Pong(id, p)); }
                Some(ws::Frame::Close) | None => break,
            }
        }
        let _ = tx.send(Ev::Close(id));
        let _ = sock.shutdown(std::net::Shutdown::Both);
        return;
    }
    // static files
    let mut p = percent_decode(&path);
    if p == "/" { p = "/index.html".to_string(); }
    let body = if p.contains("..") { None } else { assets(p.trim_start_matches('/')) };
    let resp = match body {
        Some(data) => {
            let mut r = format!("HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n", content_type(&p), data.len()).into_bytes();
            r.extend_from_slice(data);
            r
        }
        None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found".to_vec(),
    };
    let _ = sock.write_all(&resp);
    let _ = sock.flush();
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ---------- players and challenges (same rules as tools/lan-server.js) ----------
struct Board { track: String, seed: u32, log: Vec<Value> }
struct Client {
    w: TcpStream, name: String, avail: bool, since: u128, winner: bool,
    board: Option<Board>, mid: Option<u64>, last: HashMap<u64, u128>,
}
#[derive(PartialEq, Clone, Copy)]
enum Phase { Play, Offer, Ask, Between, Done }
#[derive(Clone, Copy)]
enum Timer { Decline, Decider, Finish(u64) }
struct Match { p: [u64; 2], score: [i64; 2], round: i64, phase: Phase, loser: u64, timer: Option<(u128, Timer)> }

struct Hub { clients: HashMap<u64, Client>, order: Vec<u64>, matches: HashMap<u64, Match>, next_mid: u64 }

fn to_u32(v: &Value) -> u32 {
    let x = v.num();
    if !x.is_finite() { return 0; }
    (x.trunc() as i128).rem_euclid(1i128 << 32) as u32
}
fn to_i32(v: &Value) -> i64 { to_u32(v) as i32 as i64 }

impl Hub {
    fn new() -> Hub { Hub { clients: HashMap::new(), order: Vec::new(), matches: HashMap::new(), next_mid: 1 } }

    fn run(mut self, rx: Receiver<Ev>, stop: Arc<AtomicBool>) {
        let mut next_mm = Instant::now();
        loop {
            if stop.load(Ordering::Relaxed) {
                for c in self.clients.values() { let _ = c.w.shutdown(std::net::Shutdown::Both); }
                return;
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Ev::Open(id, w)) => {
                    self.clients.insert(id, Client { w, name: "PLAYER".into(), avail: false, since: 0, winner: false, board: None, mid: None, last: HashMap::new() });
                    self.order.push(id);
                }
                Ok(Ev::Msg(id, text)) => {
                    match json::parse(&text) { Some(m) => self.on_message(id, &m), None => log("bad message") }
                }
                Ok(Ev::Pong(id, p)) => { if let Some(c) = self.clients.get_mut(&id) { let _ = ws::write_frame(&mut c.w, &p, 0xA); } }
                Ok(Ev::Close(id)) => self.remove(id),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            self.timers();
            if Instant::now() >= next_mm { next_mm = Instant::now() + Duration::from_millis(400); self.matchmake(); }
        }
    }

    fn send(&mut self, id: u64, msg: Value) {
        if let Some(c) = self.clients.get_mut(&id) { let _ = ws::write_frame(&mut c.w, msg.to_json().as_bytes(), 0x1); }
    }
    fn name(&self, id: u64) -> String { self.clients.get(&id).map(|c| c.name.clone()).unwrap_or_default() }
    fn opp(m: &Match, id: u64) -> u64 { if m.p[0] == id { m.p[1] } else { m.p[0] } }

    fn remove(&mut self, id: u64) {
        let c = match self.clients.remove(&id) { Some(c) => c, None => return };
        self.order.retain(|x| *x != id);
        log(&format!("{} left", c.name));
        if let Some(mid) = c.mid {
            if let Some(m) = self.matches.get(&mid) { let o = Hub::opp(m, id); self.finish_match(mid, o, "LEFT", Some(id)); }
        }
    }

    fn on_message(&mut self, id: u64, msg: &Value) {
        let mid = match self.clients.get(&id) { Some(c) => c.mid, None => return };
        match msg.get("t").str() {
            "hello" => {
                let raw = match msg.get("name") { Value::Str(x) => x.clone(), Value::Num(x) => x.clone(), _ => String::new() };
                let clean: String = raw.to_uppercase().chars().filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == ' ').take(10).collect();
                let clean = clean.trim().to_string();
                let name = if clean.is_empty() { format!("PLAYER {}", id) } else { clean };
                self.clients.get_mut(&id).unwrap().name = name.clone();
                self.send(id, obj(vec![("t", s("welcome")), ("id", n(id as i64)), ("name", s(&name))]));
                log(&format!("{} connected", name));
            }
            "avail" => {
                let c = self.clients.get_mut(&id).unwrap();
                let on = msg.get("on").truthy();
                if on && !c.avail { c.since = now_ms(); }
                c.avail = on;
                if !c.avail { c.winner = false; }
            }
            "board" => {
                let board = Board { track: match msg.get("track") { Value::Str(x) => x.clone(), Value::Null => "undefined".into(), v => v.to_json() }, seed: to_u32(msg.get("seed")), log: Vec::new() };
                let (track, seed) = (board.track.clone(), board.seed);
                self.clients.get_mut(&id).unwrap().board = Some(board);
                if let Some(mid) = mid {
                    let o = Hub::opp(&self.matches[&mid], id);
                    self.send(o, obj(vec![("t", s("oboard")), ("track", s(&track)), ("seed", n(seed as i64))]));
                }
            }
            "f" => {
                let frames = match msg.get("frames") { Value::Arr(a) => a.clone(), _ => return };
                let start = match msg.get("start") { Value::Num(_) => msg.get("start").num(), _ => return };
                {
                    let c = self.clients.get_mut(&id).unwrap();
                    let board = match c.board.as_mut() { Some(b) => b, None => return };
                    if start != board.log.len() as f64 { return; }
                    board.log.extend(frames.iter().cloned());
                }
                if let Some(mid) = mid {
                    let o = Hub::opp(&self.matches[&mid], id);
                    self.send(o, obj(vec![("t", s("of")), ("start", msg.get("start").clone()), ("frames", Value::Arr(frames))]));
                }
            }
            "atk" => {
                if let Some(mid) = mid {
                    let m = &self.matches[&mid];
                    if m.phase == Phase::Play { let o = Hub::opp(m, id); self.send(o, obj(vec![("t", s("atk")), ("n", n(to_i32(msg.get("n"))))])); }
                }
            }
            "dead" => {
                if let Some(mid) = mid {
                    let m = &self.matches[&mid];
                    if m.phase == Phase::Play { let o = Hub::opp(m, id); self.round_over(mid, o); }
                }
            }
            "runback" => {
                if let Some(mid) = mid {
                    let m = self.matches.get_mut(&mid).unwrap();
                    if m.phase == Phase::Offer && m.loser == id {
                        m.phase = Phase::Ask;
                        m.timer = Some((now_ms() + ASK_MS, Timer::Decline));
                        let o = Hub::opp(m, id);
                        let nm = self.name(id);
                        self.send(o, obj(vec![("t", s("askRunback")), ("name", s(&nm))]));
                    }
                }
            }
            "noRunback" => {
                if let Some(mid) = mid {
                    let m = self.matches.get_mut(&mid).unwrap();
                    if m.phase == Phase::Offer && m.loser == id { m.timer = None; self.decline(mid); }
                }
            }
            "accept" => {
                if let Some(mid) = mid {
                    let m = self.matches.get_mut(&mid).unwrap();
                    if m.phase != Phase::Ask || m.loser == id { return; }
                    m.timer = None;
                    if msg.get("yes").truthy() { self.next_round(mid, false); } else { self.decline(mid); }
                }
            }
            _ => {}
        }
    }

    fn matchmake(&mut self) {
        let mut free: Vec<u64> = self.order.iter().cloned().filter(|id| {
            let c = &self.clients[id];
            c.avail && c.mid.is_none() && c.board.is_some()
        }).collect();
        if free.len() < 2 { return; }
        // the last winner goes first, then whoever has waited longest
        free.sort_by(|a, b| {
            let (ca, cb) = (&self.clients[a], &self.clients[b]);
            (cb.winner as i32).cmp(&(ca.winner as i32)).then(ca.since.cmp(&cb.since))
        });
        let a = free[0];
        let now = now_ms();
        let mut pick = free[1..].iter().cloned().find(|x| {
            match self.clients[&a].last.get(x) { Some(t) if *t != 0 && now - *t < REPEAT_MS => false, _ => true }
        });
        if pick.is_none() && free.len() == 2 { pick = Some(free[1]); }   // only two around: let them play again
        if let Some(bb) = pick { self.start_match(a, bb); }
    }

    fn start_match(&mut self, a: u64, bb: u64) {
        let (ca, cb) = (&self.clients[&a], &self.clients[&bb]);
        let host = if ca.winner { a } else if cb.winner { bb } else if ca.since <= cb.since { a } else { bb };
        let join = if host == a { bb } else { a };
        let mid = self.next_mid; self.next_mid += 1;
        self.matches.insert(mid, Match { p: [host, join], score: [0, 0], round: 1, phase: Phase::Play, loser: 0, timer: None });
        for id in [host, join] {
            let c = self.clients.get_mut(&id).unwrap();
            c.mid = Some(mid); c.avail = false; c.winner = false;
        }
        let (hn, jn) = (self.name(host), self.name(join));
        log(&format!("challenge: {} joins {}", jn, hn));
        let sc = Value::Arr(vec![n(0), n(0)]);
        self.send(host, obj(vec![("t", s("match")), ("role", s("host")), ("opp", obj(vec![("id", n(join as i64)), ("name", s(&jn))])), ("score", sc.clone()), ("round", n(1))]));
        self.send(join, obj(vec![("t", s("match")), ("role", s("join")), ("opp", obj(vec![("id", n(host as i64)), ("name", s(&hn))])), ("score", sc), ("round", n(1))]));
        // give the joiner the host's whole board so far, so they can replay it
        let (track, seed, log_v) = {
            let bd = self.clients[&host].board.as_ref().unwrap();
            (bd.track.clone(), bd.seed, bd.log.clone())
        };
        self.send(join, obj(vec![("t", s("oboard")), ("track", s(&track)), ("seed", n(seed as i64))]));
        if !log_v.is_empty() { self.send(join, obj(vec![("t", s("of")), ("start", n(0)), ("frames", Value::Arr(log_v))])); }
    }

    fn round_end_msgs(&mut self, mid: u64, winner: u64, next: &dyn Fn(u64) -> &'static str) {
        let m = &self.matches[&mid];
        let (p, score) = (m.p, m.score);
        for (i, id) in p.iter().enumerate() {
            let msg = obj(vec![("t", s("roundEnd")), ("won", b(*id == winner)), ("score", Value::Arr(vec![n(score[i]), n(score[1 - i])])), ("next", s(next(*id)))]);
            self.send(*id, msg);
        }
    }

    fn round_over(&mut self, mid: u64, winner: u64) {
        let now = now_ms();
        let (round, score) = {
            let m = self.matches.get_mut(&mid).unwrap();
            let w = if m.p[0] == winner { 0 } else { 1 };
            m.score[w] += 1;
            m.loser = Hub::opp(m, winner);
            (m.round, m.score)
        };
        // after round 2 at 1-1 the decider is automatic
        if round == 2 && score[0] == 1 && score[1] == 1 {
            { let m = self.matches.get_mut(&mid).unwrap(); m.phase = Phase::Between; m.timer = Some((now + 2500, Timer::Decider)); }
            self.round_end_msgs(mid, winner, &|_| "decider");
            return;
        }
        if round == 1 {
            // single round unless the loser asks to run it back and the winner accepts
            { let m = self.matches.get_mut(&mid).unwrap(); m.phase = Phase::Offer; m.timer = Some((now + ASK_MS, Timer::Decline)); }
            self.round_end_msgs(mid, winner, &move |id| if id == winner { "waitRunback" } else { "offerRunback" });
            return;
        }
        { let m = self.matches.get_mut(&mid).unwrap(); m.phase = Phase::Done; m.timer = Some((now + 2500, Timer::Finish(winner))); }
        self.round_end_msgs(mid, winner, &|_| "end");
    }

    fn decline(&mut self, mid: u64) {
        let m = match self.matches.get_mut(&mid) { Some(m) => m, None => return };
        if m.phase != Phase::Offer && m.phase != Phase::Ask { return; }
        m.phase = Phase::Done;
        let w = Hub::opp(m, m.loser);
        self.finish_match(mid, w, "", None);
    }

    // Round 2: the loser's board resets, the winner keeps theirs. Round 3 (tie-break): both reset.
    fn next_round(&mut self, mid: u64, decider: bool) {
        let (p, score, round, loser) = {
            let m = self.matches.get_mut(&mid).unwrap();
            m.round += 1; m.phase = Phase::Play;
            (m.p, m.score, m.round, m.loser)
        };
        for (i, id) in p.iter().enumerate() {
            let msg = obj(vec![("t", s("nextRound")), ("round", n(round)), ("score", Value::Arr(vec![n(score[i]), n(score[1 - i])])), ("resetMe", b(decider || *id == loser)), ("decider", b(decider))]);
            self.send(*id, msg);
        }
    }

    fn finish_match(&mut self, mid: u64, winner: u64, why: &str, gone: Option<u64>) {
        let m = match self.matches.remove(&mid) { Some(m) => m, None => return };
        let loser = Hub::opp(&m, winner);
        let now = now_ms();
        for id in m.p { if let Some(c) = self.clients.get_mut(&id) { c.mid = None; } }
        if let Some(c) = self.clients.get_mut(&winner) { c.last.insert(loser, now); c.winner = true; }
        if let Some(c) = self.clients.get_mut(&loser) { c.last.insert(winner, now); }
        let _ = gone;
        log(&format!("challenge over: {} wins{}", self.name(winner), if why.is_empty() { String::new() } else { format!(" ({})", why) }));
        self.send(winner, obj(vec![("t", s("matchEnd")), ("won", b(true)), ("why", s(why))]));
        self.send(loser, obj(vec![("t", s("matchEnd")), ("won", b(false)), ("why", s(why))]));
    }

    fn timers(&mut self) {
        let now = now_ms();
        let due: Vec<(u64, Timer)> = self.matches.iter_mut().filter_map(|(id, m)| {
            match m.timer { Some((t, k)) if t <= now => { m.timer = None; Some((*id, k)) } _ => None }
        }).collect();
        for (mid, k) in due {
            match k {
                Timer::Decline => self.decline(mid),
                Timer::Decider => self.next_round(mid, true),
                Timer::Finish(w) => self.finish_match(mid, w, "", None),
            }
        }
    }
}

// ============================================================================================
// Finding the host
// ============================================================================================

#[derive(Clone, Debug, PartialEq)]
pub enum Role { Searching, Host, Client }

#[derive(Clone, Debug)]
pub struct Status {
    pub role: Role,
    pub ws: Option<String>,        // where this copy's game should connect
    pub join_url: Option<String>,  // for phones/tablets: open this in a browser (when hosting)
    pub host_name: Option<String>, // the host's address, when joined
}

struct Peer { addr: IpAddr, port: u16, started: u128, id: u64, seen: Instant }

pub struct Lan {
    pub status: Arc<Mutex<Status>>,
}

pub fn local_ip() -> Ipv4Addr {
    // Asking the OS which address it would use to reach the internet sends no packets.
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(SocketAddr::V4(a)) = sock.local_addr() { return *a.ip(); }
        }
    }
    Ipv4Addr::LOCALHOST
}

fn rand_u64() -> u64 {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) as u64;
    let mut x = t ^ (std::process::id() as u64).rotate_left(32) ^ 0x9E3779B97F4A7C15;
    x ^= x >> 33; x = x.wrapping_mul(0xff51afd7ed558ccd); x ^= x >> 33; x = x.wrapping_mul(0xc4ceb9fe1a85ec53); x ^= x >> 33;
    x
}

impl Lan {
    // version: only copies of the same version play together.
    // on_change: called whenever where-to-connect changes.
    pub fn start(version: String, game_port: u16, assets: AssetFn, on_change: Box<dyn Fn(&Status) + Send>) -> Lan {
        let status = Arc::new(Mutex::new(Status { role: Role::Searching, ws: None, join_url: None, host_name: None }));
        let st = status.clone();
        thread::spawn(move || run_discovery(version, game_port, assets, st, on_change));
        Lan { status }
    }
}

fn run_discovery(version: String, game_port: u16, assets: AssetFn, status: Arc<Mutex<Status>>, on_change: Box<dyn Fn(&Status) + Send>) {
    let my_id = rand_u64();
    let started = now_ms();
    // Several copies on one PC can't all own the discovery port; the others still find hosts by
    // asking, and grab the port as soon as it's free again.
    let first = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).or_else(|_| UdpSocket::bind("0.0.0.0:0")).expect("udp");
    first.set_broadcast(true).ok();
    first.set_read_timeout(Some(Duration::from_millis(100))).ok();
    let sock = Arc::new(Mutex::new(first));
    let peers: Arc<Mutex<HashMap<u64, Peer>>> = Arc::new(Mutex::new(HashMap::new()));
    let hosting: Arc<Mutex<Option<Server>>> = Arc::new(Mutex::new(None));

    // listener
    {
        let shared = sock.clone();
        let (peers, hosting, version) = (peers.clone(), hosting.clone(), version.clone());
        thread::spawn(move || {
            let mut buf = [0u8; 512];
            let mut cur = shared.lock().unwrap().try_clone().expect("udp clone");
            let mut last_try = Instant::now();
            loop {
                if last_try.elapsed() >= Duration::from_secs(2) && cur.local_addr().map(|a| a.port()).unwrap_or(0) != DISCOVERY_PORT {
                    last_try = Instant::now();
                    if let Ok(nsock) = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
                        nsock.set_broadcast(true).ok();
                        nsock.set_read_timeout(Some(Duration::from_millis(100))).ok();
                        if let Ok(c) = nsock.try_clone() { cur = c; *shared.lock().unwrap() = nsock; log("now listening on the discovery port"); }
                    }
                }
                let (k, from) = match cur.recv_from(&mut buf) { Ok(x) => x, Err(_) => continue };
                let text = String::from_utf8_lossy(&buf[..k]).to_string(); 
                let f: Vec<&str> = text.split_whitespace().collect();
                if f.len() >= 3 && f[0] == "CMX1" && f[1] == "WHO" && f[2] == version {
                    if let Some(sv) = hosting.lock().unwrap().as_ref() {
                        let msg = format!("CMX1 HOST {} {} {} {}", version, my_id, started, sv.port);
                        let _ = cur.send_to(msg.as_bytes(), from);
                    }
                } else if f.len() >= 6 && f[0] == "CMX1" && f[1] == "HOST" && f[2] == version {
                    let id: u64 = f[3].parse().unwrap_or(0);
                    if id == my_id { continue; }
                    let p = Peer { addr: from.ip(), port: f[5].parse().unwrap_or(0), started: f[4].parse().unwrap_or(0), id, seen: Instant::now() };
                    // Two hosts: the one started first tells the other directly, so it steps down
                    // even if it can't hear our answers (two copies on one PC share the port).
                    if let Some(sv) = hosting.lock().unwrap().as_ref() {
                        if (started, my_id) < (p.started, p.id) {
                            let msg = format!("CMX1 HOST {} {} {} {}", version, my_id, started, sv.port);
                            let _ = cur.send_to(msg.as_bytes(), from);
                        }
                    }
                    let mut pm = peers.lock().unwrap();
                    // prefer a LAN address over loopback for the same host
                    if let Some(old) = pm.get(&id) { if !old.addr.is_loopback() && p.addr.is_loopback() { let mut o = Peer { seen: Instant::now(), ..p }; o.addr = old.addr; pm.insert(id, o); continue; } }
                    pm.insert(id, p);
                }
            }
        });
    }

    let lan = local_ip();
    let bcast = { let o = lan.octets(); Ipv4Addr::new(o[0], o[1], o[2], 255) };
    let ask = |sock: &UdpSocket| {
        let msg = format!("CMX1 WHO {}", version);
        for to in [Ipv4Addr::BROADCAST, bcast, Ipv4Addr::LOCALHOST, lan] {
            let _ = sock.send_to(msg.as_bytes(), (to, DISCOVERY_PORT));
        }
    };

    let mut role = Role::Searching;
    let mut search_until = Instant::now() + Duration::from_millis(1800 + rand_u64() % 700);
    let mut last_ask = Instant::now() - Duration::from_secs(5);
    let mut last_status: Option<(Role, Option<String>)> = None;
    loop {
        if last_ask.elapsed() >= Duration::from_millis(if role == Role::Searching { 300 } else { 1000 }) { ask(&sock.lock().unwrap()); last_ask = Instant::now(); }
        // forget hosts not heard from for a while
        peers.lock().unwrap().retain(|_, p| p.seen.elapsed() < Duration::from_millis(4000));
        let best = {
            let pm = peers.lock().unwrap();
            pm.values().min_by(|a, b| a.started.cmp(&b.started).then(a.id.cmp(&b.id))).map(|p| (p.addr, p.port, p.started, p.id))
        };
        match role {
            Role::Searching => {
                if let Some(_) = best { role = Role::Client; }
                else if Instant::now() >= search_until {
                    match Server::start(game_port, assets) {
                        Ok(sv) => { log(&format!("hosting on port {}", sv.port)); *hosting.lock().unwrap() = Some(sv); role = Role::Host; }
                        Err(e) => { log(&format!("can't host: {}", e)); search_until = Instant::now() + Duration::from_secs(3); }
                    }
                }
            }
            Role::Host => {
                // someone who started earlier is hosting too: step down and join them
                if let Some((_, _, st, id)) = best {
                    if (st, id) < (started, my_id) {
                        log("another host started first; joining it");
                        if let Some(sv) = hosting.lock().unwrap().take() { sv.stop(); }
                        role = Role::Client;
                    }
                }
            }
            Role::Client => {
                if best.is_none() {
                    log("host gone; looking again");
                    role = Role::Searching;
                    search_until = Instant::now() + Duration::from_millis(1200 + rand_u64() % 1500);
                }
            }
        }
        let st = match role {
            Role::Host => {
                let port = hosting.lock().unwrap().as_ref().map(|s| s.port).unwrap_or(game_port);
                Status { role: Role::Host, ws: Some(format!("ws://127.0.0.1:{}/ws", port)), join_url: Some(format!("http://{}:{}/", lan, port)), host_name: None }
            }
            Role::Client => {
                let (addr, port, _, _) = best.unwrap();
                Status { role: Role::Client, ws: Some(format!("ws://{}:{}/ws", addr, port)), join_url: None, host_name: Some(format!("{}", addr)) }
            }
            Role::Searching => Status { role: Role::Searching, ws: None, join_url: None, host_name: None },
        };
        let key = (st.role.clone(), st.ws.clone());
        if last_status.as_ref() != Some(&key) {
            last_status = Some(key);
            *status.lock().unwrap() = st.clone();
            on_change(&st);
        }
        thread::sleep(Duration::from_millis(100));
    }
}
