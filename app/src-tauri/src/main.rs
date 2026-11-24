// Crossmix Puzzle Arcade app: the game in a window, plus automatic LAN play.
// On launch it looks for a Crossmix host on the home network and joins it, or becomes the host.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod json;
mod lan;
mod ws;

use std::sync::{Arc, Mutex};

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

struct LanState(Arc<Mutex<lan::Status>>);

// The game polls this: "role|where to connect|join address (host) or host address (client)".
#[tauri::command]
fn lan_state(state: tauri::State<LanState>) -> String {
    let s = state.0.lock().unwrap().clone();
    match s.role {
        lan::Role::Host => format!("host|{}|{}", s.ws.unwrap_or_default(), s.join_url.unwrap_or_default()),
        lan::Role::Client => format!("client|{}|{}", s.ws.unwrap_or_default(), s.host_name.unwrap_or_default()),
        lan::Role::Searching => "searching||".to_string(),
    }
}

fn main() {
    let l = lan::Lan::start(env!("CARGO_PKG_VERSION").to_string(), 8080, asset, Box::new(|_| {}));
    tauri::Builder::default()
        .manage(LanState(l.status.clone()))
        .invoke_handler(tauri::generate_handler![lan_state])
        .run(tauri::generate_context!())
        .expect("error while running Crossmix");
}
