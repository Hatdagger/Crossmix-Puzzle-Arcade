// Tiny JSON reader/writer, just enough for the LAN messages (no outside libraries).
// Numbers keep their original text so relayed frames come out exactly as they went in.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(String),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, k: &str) -> &Value {
        if let Value::Obj(v) = self {
            for (key, val) in v {
                if key == k {
                    return val;
                }
            }
        }
        &Value::Null
    }
    pub fn str(&self) -> &str {
        if let Value::Str(s) = self { s } else { "" }
    }
    pub fn num(&self) -> f64 {
        match self {
            Value::Num(s) => s.parse().unwrap_or(0.0),
            Value::Bool(true) => 1.0,
            _ => 0.0,
        }
    }
    // JavaScript-style truthiness (what the Node server's !!x did)
    pub fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(s) => s.parse::<f64>().map(|n| n != 0.0 && !n.is_nan()).unwrap_or(false),
            Value::Str(s) => !s.is_empty(),
            _ => true,
        }
    }
    pub fn to_json(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }
    fn write(&self, out: &mut String) {
        match self {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Num(s) => out.push_str(s),
            Value::Str(s) => write_str(s, out),
            Value::Arr(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 { out.push(','); }
                    v.write(out);
                }
                out.push(']');
            }
            Value::Obj(o) => {
                out.push('{');
                for (i, (k, v)) in o.iter().enumerate() {
                    if i > 0 { out.push(','); }
                    write_str(k, out);
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_str(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

// Builders for outgoing messages.
pub fn obj(pairs: Vec<(&str, Value)>) -> Value {
    Value::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
pub fn s(x: &str) -> Value { Value::Str(x.to_string()) }
pub fn n(x: i64) -> Value { Value::Num(x.to_string()) }
pub fn b(x: bool) -> Value { Value::Bool(x) }

pub fn parse(text: &str) -> Option<Value> {
    let mut p = Parser { b: text.as_bytes(), i: 0 };
    let v = p.value()?;
    p.ws();
    if p.i == p.b.len() { Some(v) } else { None }
}

struct Parser<'a> { b: &'a [u8], i: usize }

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && (self.b[self.i] as char).is_ascii_whitespace() { self.i += 1; }
    }
    fn value(&mut self) -> Option<Value> {
        self.ws();
        let c = *self.b.get(self.i)?;
        match c {
            b'{' => {
                self.i += 1;
                let mut o = Vec::new();
                self.ws();
                if self.b.get(self.i) == Some(&b'}') { self.i += 1; return Some(Value::Obj(o)); }
                loop {
                    self.ws();
                    let k = self.string()?;
                    self.ws();
                    if self.b.get(self.i) != Some(&b':') { return None; }
                    self.i += 1;
                    let v = self.value()?;
                    o.push((k, v));
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => { self.i += 1; return Some(Value::Obj(o)); }
                        _ => return None,
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.b.get(self.i) == Some(&b']') { self.i += 1; return Some(Value::Arr(a)); }
                loop {
                    a.push(self.value()?);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => { self.i += 1; return Some(Value::Arr(a)); }
                        _ => return None,
                    }
                }
            }
            b'"' => Some(Value::Str(self.string()?)),
            b't' => self.lit("true", Value::Bool(true)),
            b'f' => self.lit("false", Value::Bool(false)),
            b'n' => self.lit("null", Value::Null),
            _ => {
                let st = self.i;
                while self.i < self.b.len() && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') { self.i += 1; }
                if st == self.i { return None; }
                let t = std::str::from_utf8(&self.b[st..self.i]).ok()?;
                t.parse::<f64>().ok()?;
                Some(Value::Num(t.to_string()))
            }
        }
    }
    fn lit(&mut self, w: &str, v: Value) -> Option<Value> {
        if self.b[self.i..].starts_with(w.as_bytes()) { self.i += w.len(); Some(v) } else { None }
    }
    fn string(&mut self) -> Option<String> {
        if self.b.get(self.i) != Some(&b'"') { return None; }
        self.i += 1;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.b.get(self.i)?;
            self.i += 1;
            match c {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let e = *self.b.get(self.i)?;
                    self.i += 1;
                    match e {
                        b'"' => out.push(b'"'), b'\\' => out.push(b'\\'), b'/' => out.push(b'/'),
                        b'b' => out.push(8), b'f' => out.push(12), b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'), b't' => out.push(b'\t'),
                        b'u' => {
                            let h = std::str::from_utf8(self.b.get(self.i..self.i + 4)?).ok()?;
                            self.i += 4;
                            let mut cp = u32::from_str_radix(h, 16).ok()?;
                            if (0xD800..0xDC00).contains(&cp) && self.b.get(self.i..self.i + 2) == Some(b"\\u") {
                                let h2 = std::str::from_utf8(self.b.get(self.i + 2..self.i + 6)?).ok()?;
                                let lo = u32::from_str_radix(h2, 16).ok()?;
                                self.i += 6;
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo.wrapping_sub(0xDC00) & 0x3FF);
                            }
                            let ch = char::from_u32(cp).unwrap_or('?');
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        _ => return None,
                    }
                }
                _ => out.push(c),
            }
        }
    }
}
