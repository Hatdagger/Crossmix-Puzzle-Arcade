// Embeds the game files (../dist) into the program, so the host can serve them to phones and
// tablets that join from a browser. (The app's own window gets them from Tauri.)
use std::{env, fs, path::Path};

fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, String)>) {
    let mut entries: Vec<_> = fs::read_dir(dir).map(|r| r.flatten().collect()).unwrap_or_default();
    entries.sort_by_key(|e| e.path());
    for e in entries {
        let p = e.path();
        if p.is_dir() { walk(&p, base, out); continue; }
        let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
        out.push((rel, fs::canonicalize(&p).unwrap().to_string_lossy().to_string()));
    }
}

fn main() {
    let dist = Path::new("../dist");
    println!("cargo:rerun-if-changed=../dist");
    let mut files = Vec::new();
    walk(dist, dist, &mut files);
    let mut code = String::from("pub fn asset(p: &str) -> Option<&'static [u8]> {\n    match p {\n");
    for (rel, abs) in &files {
        code.push_str(&format!("        {:?} => Some(include_bytes!({:?})),\n", rel, abs));
    }
    code.push_str("        _ => None,\n    }\n}\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("assets.rs"), code).unwrap();
    tauri_build::build()
}
