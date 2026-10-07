//! FreedomStack als Desktop-App (6.1a, Entscheidung N2 vom 07.10.2026).
//!
//! Eine Hülle um freedom.html: ein Fenster mit dem System-Webview (WebKitGTK unter
//! Linux, WebView2 unter Windows), die App kommt über das eigene Schema aus
//! `oberflaeche.rs`. Die Hülle selbst spricht mit niemandem im Netz – das tut nur
//! die App, mit denselben Regeln wie im Browser. Selbst-Update der Oberfläche
//! (geprüft über das Release-Manifest, k von n) folgt mit 6.1a2/6.1a3.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod oberflaeche;

use tauri::webview::NewWindowResponse;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("freedom", |_ctx, anfrage| oberflaeche::antwort(anfrage.uri().path(), oberflaeche::BEIGELEGT))
        .setup(|app| {
            WebviewWindowBuilder::new(app, "haupt", WebviewUrl::CustomProtocol(oberflaeche::adresse().parse()?))
                .title("FreedomStack")
                .inner_size(1200.0, 800.0)
                .min_inner_size(360.0, 560.0)
                .initialization_script(oberflaeche::kennung_skript())
                .on_navigation(oberflaeche::darf_navigieren)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("FreedomStack startet nicht");
}
