//! FreedomStack als Desktop-App (6.1a, Entscheidung N2 vom 07.10.2026).
//!
//! Eine Hülle um freedom.html: ein Fenster mit dem System-Webview (WebKitGTK unter
//! Linux, WebView2 unter Windows), die App kommt über das eigene Schema aus
//! `oberflaeche.rs`. Die Hülle selbst spricht mit niemandem im Netz – das tut nur
//! die App, mit denselben Regeln wie im Browser. Eine neuere Oberfläche installiert
//! die Hülle seit 6.1a3b nur nach eigener Prüfung (`installation.rs`, `update.rs`);
//! die App darf dafür genau zwei Kommandos rufen (`capabilities/oberflaeche.json`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ablage;
mod installation;
mod oberflaeche;
mod update;

use installation::{Oberflaeche, Startwahl};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("freedom", |ctx, anfrage| match ctx.app_handle().try_state::<Oberflaeche>() {
            Some(o) => oberflaeche::antwort(anfrage.uri().path(), &o.html()),
            None => oberflaeche::antwort(anfrage.uri().path(), oberflaeche::BEIGELEGT),
        })
        .invoke_handler(tauri::generate_handler![installation::oberflaeche_stand, installation::oberflaeche_installieren])
        .setup(|app| {
            // Installierte Fassungen liegen im Datenverzeichnis der Hülle; ohne eines gilt nur die beigelegte.
            let ordner = app.path().app_data_dir().ok().map(|d| d.join("oberflaeche"));
            app.manage(Oberflaeche::starte(ordner, Startwahl::aus(std::env::args())));
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
