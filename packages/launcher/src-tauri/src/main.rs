//! freedom-launcher: Tauri-Backend.
//!
//! Der Launcher ist eine duenne Huelle um den freedomstack-node Daemon:
//!   - prueft/installiert Ollama (nativ, GPU-Zugriff ohne Docker)
//!   - managed Daemon als Sidecar-Prozess (start/stop/status/logs)
//!   - haelt die Node-Config (lud16, Preis, LP-Modus) in einer JSON-Datei
//!
//! Kein Custody, keine Verwahrung: Der Daemon laeuft mit den Keys des Users,
//! die App liest nur Status. Updates kommen als signierte Releases (kein
//! Auto-Update-Server = kein Chokepoint).

use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[derive(Default)]
struct DaemonState {
    child: Option<Child>,
    logs: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct NodeConfig {
    lud16: String,
    secret_key_hex: String,
    price_per_ktoken_msat: u64,
    lp_enabled: bool,
    lnd_macaroon_path: String,
    ollama_model: String,
}

#[derive(Serialize)]
struct SystemStatus {
    ollama_installed: bool,
    ollama_running: bool,
    ollama_models: Vec<String>,
    daemon_running: bool,
    daemon_logs: Vec<String>,
    config_present: bool,
}

fn config_path() -> std::path::PathBuf {
    dirs_config().join("freedom-node.json")
}

fn dirs_config() -> std::path::PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config")
        });
    base.join("freedom")
}

fn load_config() -> Option<NodeConfig> {
    let p = config_path();
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

fn save_config(cfg: &NodeConfig) -> Result<(), String> {
    let dir = dirs_config();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(
        config_path(),
        serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn http_get(url: &str, timeout_ms: u64) -> Option<String> {
    // Minimaler HTTP-GET ohne zusaetzliche Crates: curl als Transport.
    let out = Command::new("curl")
        .args(["-s", "-m", &format!("{}", timeout_ms / 1000), url])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

#[tauri::command]
fn system_status(state: tauri::State<Mutex<DaemonState>>) -> SystemStatus {
    let ollama_installed = Command::new("ollama")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    let tags = http_get("http://localhost:11434/api/tags", 3000);
    let ollama_running = tags.is_some();
    let ollama_models: Vec<String> = tags
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| {
            v.get("models").map(|m| {
                m.as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|x| x.get("name").and_then(|n| n.as_str()).map(String::from))
                    .collect()
            })
        })
        .unwrap_or_default();

    let st = state.lock().unwrap();
    SystemStatus {
        ollama_installed,
        ollama_running,
        ollama_models,
        daemon_running: st.child.is_some(),
        daemon_logs: st.logs.clone(),
        config_present: load_config().is_some(),
    }
}

#[tauri::command]
fn start_daemon(
    state: tauri::State<Mutex<DaemonState>>,
    cfg: NodeConfig,
) -> Result<String, String> {
    save_config(&cfg)?;
    let mut st = state.lock().unwrap();
    if st.child.is_some() {
        return Err("Daemon laeuft bereits".into());
    }

    let mut cmd = Command::new("node");
    cmd.args(["--import", "tsx", "src/main.ts"])
        .current_dir(node_dir())
        .env("NODE_LUD16", &cfg.lud16)
        .env("NODE_SECRET_KEY", &cfg.secret_key_hex)
        .env(
            "PRICE_PER_K_TOKEN_MSAT",
            cfg.price_per_ktoken_msat.to_string(),
        )
        .env("OLLAMA_MODEL", &cfg.ollama_model)
        .env("POLL_INTERVAL_MS", "15000")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if cfg.lp_enabled {
        cmd.env("LP_ENABLED", "1")
            .env("LND_MACAROON", &cfg.lnd_macaroon_path)
            .env("LND_INSECURE_TLS", "1");
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Daemon-Start fehlgeschlagen: {e}"))?;
    st.child = Some(child);
    st.logs.push(format!(
        "[launcher] daemon gestartet (model {})",
        cfg.ollama_model
    ));
    Ok("gestartet".into())
}

#[tauri::command]
fn stop_daemon(state: tauri::State<Mutex<DaemonState>>) -> Result<String, String> {
    let mut st = state.lock().unwrap();
    if let Some(mut child) = st.child.take() {
        let _ = child.kill();
        let _ = child.wait();
        st.logs.push("[launcher] daemon gestoppt".into());
        return Ok("gestoppt".into());
    }
    Err("kein Daemon aktiv".into())
}

#[tauri::command]
fn generate_node_key() -> String {
    // secp256k1 nsec via openssl (vorhanden auf allen Zielsystemen)
    let out = Command::new("openssl")
        .args(["rand", "-hex", "32"])
        .output()
        .expect("openssl fehlt");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn node_dir() -> std::path::PathBuf {
    // Produktion: neben der Binary (resources). Entwicklung: ../../node.
    let exe = std::env::current_exe().unwrap_or_default();
    let bundled = exe
        .parent()
        .map(|p| p.join("freedomstack-node"))
        .unwrap_or_default();
    if bundled.join("src/main.ts").exists() {
        return bundled;
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../node")
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(DaemonState::default()))
        .invoke_handler(tauri::generate_handler![
            system_status,
            start_daemon,
            stop_daemon,
            generate_node_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running freedom launcher");
}
