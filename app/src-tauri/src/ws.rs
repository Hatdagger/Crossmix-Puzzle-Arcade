// Minimal WebSocket pieces (RFC 6455, text frames) and the SHA-1 + base64 its handshake needs.
use std::io::{Read, Write};
use std::net::TcpStream;

pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 { msg.push(0); }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 { w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]); }
        for i in 16..80 { w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1); }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for i in 0..80 {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(w[i]);
            e = d; d = c; c = b.rotate_left(30); b = a; a = t;
        }
        h[0] = h[0].wrapping_add(a); h[1] = h[1].wrapping_add(b); h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d); h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for i in 0..5 { out[i * 4..i * 4 + 4].copy_from_slice(&h[i].to_be_bytes()); }
    out
}

pub fn base64(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn accept_key(key: &str) -> String {
    let mut s = key.trim().to_string();
    s.push_str("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    base64(&sha1(s.as_bytes()))
}

pub fn write_frame(sock: &mut TcpStream, payload: &[u8], op: u8) -> std::io::Result<()> {
    let len = payload.len();
    let mut head = vec![0x80 | op];
    if len < 126 { head.push(len as u8); }
    else if len < 65536 { head.push(126); head.extend_from_slice(&(len as u16).to_be_bytes()); }
    else { head.push(127); head.extend_from_slice(&(len as u64).to_be_bytes()); }
    head.extend_from_slice(payload);
    sock.write_all(&head)
}

pub enum Frame { Text(String), Ping(Vec<u8>), Close }

// Reads whole messages (joins fragments). Returns None when the connection ends.
pub struct Reader { buf: Vec<u8>, frag: Vec<u8> }

impl Reader {
    pub fn new(start: Vec<u8>) -> Reader { Reader { buf: start, frag: Vec::new() } }
    pub fn next(&mut self, sock: &mut TcpStream) -> Option<Frame> {
        loop {
            if let Some((fr, used)) = self.parse() {
                self.buf.drain(..used);
                match fr {
                    Some(f) => return Some(f),
                    None => continue,   // a fragment; keep reading
                }
            }
            let mut tmp = [0u8; 8192];
            match sock.read(&mut tmp) {
                Ok(0) | Err(_) => return None,
                Ok(k) => self.buf.extend_from_slice(&tmp[..k]),
            }
        }
    }
    // Some((Some(frame) | None for a non-final fragment, bytes used)), or None if more bytes are needed.
    fn parse(&mut self) -> Option<(Option<Frame>, usize)> {
        let b = &self.buf;
        if b.len() < 2 { return None; }
        let fin = b[0] & 0x80 != 0;
        let op = b[0] & 0x0f;
        let masked = b[1] & 0x80 != 0;
        let mut len = (b[1] & 0x7f) as usize;
        let mut off = 2;
        if len == 126 { if b.len() < 4 { return None; } len = u16::from_be_bytes([b[2], b[3]]) as usize; off = 4; }
        else if len == 127 {
            if b.len() < 10 { return None; }
            let mut a = [0u8; 8]; a.copy_from_slice(&b[2..10]);
            len = u64::from_be_bytes(a) as usize; off = 10;
        }
        let mut mask = [0u8; 4];
        if masked { if b.len() < off + 4 { return None; } mask.copy_from_slice(&b[off..off + 4]); off += 4; }
        if b.len() < off + len { return None; }
        let mut payload = b[off..off + len].to_vec();
        if masked { for (i, x) in payload.iter_mut().enumerate() { *x ^= mask[i & 3]; } }
        let used = off + len;
        match op {
            0x8 => Some((Some(Frame::Close), used)),
            0x9 => Some((Some(Frame::Ping(payload)), used)),
            0x0 | 0x1 => {
                self.frag.extend_from_slice(&payload);
                if fin {
                    let text = String::from_utf8_lossy(&self.frag).to_string();
                    self.frag.clear();
                    Some((Some(Frame::Text(text)), used))
                } else { Some((None, used)) }
            }
            _ => Some((None, used)),   // pong and others: ignore
        }
    }
}
