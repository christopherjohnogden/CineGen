#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;

#[tauri::command]
fn engine_invoke(command: serde_json::Value) -> serde_json::Value {
    // Native bridge placeholder for v1.1 Rust engine wiring.
    // Frontend falls back to the in-app mock engine until this bridge is implemented.
    json!({
        "ok": false,
        "error": format!(
            "native engine bridge not wired for command {}",
            command
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown")
        )
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![engine_invoke])
        .run(tauri::generate_context!())
        .expect("error while running CineGen desktop application");
}
