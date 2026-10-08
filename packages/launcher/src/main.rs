//! FreedomStack als Desktop-App (6.1a) – der Start; die Hülle steht in `lib.rs`,
//! damit Android (6.1c) dieselbe nutzt.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    freedom_launcher_lib::run()
}
