//! Die Oberfläche der Hülle (6.1a1): freedom.html, beigelegt beim Bauen.
//!
//! Ausgeliefert wird sie über ein eigenes Schema (`freedom://localhost/`, unter
//! Windows `http://freedom.localhost/`) – immer derselbe Ursprung, damit Tresor,
//! Schlüssel und Verläufe im Speicher des Webviews bleiben, wenn später eine
//! neuere Fassung die beigelegte ersetzt (6.1a3). Nur die App selbst wird
//! ausgeliefert; jeder andere Pfad ist 404 – die Hülle ist kein Spiegel und
//! liefert auch keine `freedom-spiegel.json` (der Hosting-Anteil geht dann an den
//! Provider, wie bei jeder Kopie ohne Zahlziel).

use tauri::http::{header, Response, StatusCode};
use tauri::Url;

/// Die beim Bauen beigelegte App (`packages/app/dist/freedom.html`).
pub const BEIGELEGT: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../app/dist/freedom.html"));

/// Antwort des Schemas auf einen Pfad: die App unter `/` und `/freedom.html`, sonst 404.
pub fn antwort(pfad: &str, html: &[u8]) -> Response<Vec<u8>> {
    let gebaut = match pfad {
        "/" | "" | "/freedom.html" => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .body(html.to_vec()),
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Vec::new()),
    };
    gebaut.unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Unter Windows und Android erwartet das Webview eigene Schemata als
/// `http://<schema>.localhost` (Tauri), unter Linux als `<schema>://localhost`.
const HTTP_FORM: bool = cfg!(any(windows, target_os = "android"));

/// Woran die App die Hülle erkennt (`__FREEDOM_NATIVE__.huelle`).
pub const HUELLE: &str = if cfg!(target_os = "android") { "android" } else { "desktop" };

/// Wohin das Fenster navigieren darf: nur der eigene Ursprung – und Blob-Adressen
/// dieses Ursprungs (Downloads wie der Export der App). Ein Link auf eine fremde
/// Seite ersetzt die App also nie; neue Fenster lehnt `main.rs` ganz ab.
pub fn darf_navigieren(url: &Url) -> bool {
    let eigen = |u: &Url| match (u.scheme(), u.host_str()) {
        ("freedom", Some("localhost")) => !HTTP_FORM,
        ("http", Some("freedom.localhost")) => HTTP_FORM,
        _ => false,
    };
    if url.scheme() == "blob" {
        return Url::parse(url.path()).map(|innen| eigen(&innen)).unwrap_or(false);
    }
    eigen(url)
}

/// Woran die App erkennt, dass sie in der Hülle läuft – als Skript vor jeder Seite.
pub fn kennung_skript() -> String {
    format!(
        "Object.defineProperty(window, \"__FREEDOM_NATIVE__\", {{ value: Object.freeze({{ huelle: \"{HUELLE}\", fassung: \"{}\" }}), writable: false, configurable: false }});",
        env!("CARGO_PKG_VERSION")
    )
}

/// Die Adresse der Oberfläche – je Plattform die Form, die das Webview für eigene Schemata erwartet.
pub fn adresse() -> &'static str {
    if HTTP_FORM {
        "http://freedom.localhost/"
    } else {
        "freedom://localhost/"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liefert_die_app_unter_wurzel_und_dateiname() {
        for pfad in ["/", "", "/freedom.html"] {
            let r = antwort(pfad, b"<!doctype html>");
            assert_eq!(r.status(), StatusCode::OK, "{pfad}");
            assert_eq!(r.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
            assert_eq!(r.headers()[header::CACHE_CONTROL], "no-store");
            assert_eq!(r.body(), b"<!doctype html>");
        }
    }

    #[test]
    fn sonst_nichts_auch_keine_pfade_nach_oben() {
        for pfad in ["/freedom-spiegel.json", "/freedom-sw.js", "/../etc/passwd", "/%2e%2e/geheim", "/freedom.html/x", "/index.html"] {
            let r = antwort(pfad, b"<!doctype html>");
            assert_eq!(r.status(), StatusCode::NOT_FOUND, "{pfad}");
            assert!(r.body().is_empty(), "{pfad}");
        }
    }

    #[test]
    fn beigelegt_ist_die_gebaute_app() {
        let anfang = std::str::from_utf8(&BEIGELEGT[..BEIGELEGT.len().min(512)]).unwrap_or("");
        assert!(anfang.to_ascii_lowercase().starts_with("<!doctype html>"), "freedom.html beginnt mit dem Doctype");
        assert!(BEIGELEGT.windows(29).any(|w| w == b"Content-Security-Policy\" cont"), "CSP der App ist dabei");
    }

    #[test]
    fn kennung_ist_unveraenderlich_und_nennt_die_fassung() {
        let s = kennung_skript();
        assert!(s.contains("__FREEDOM_NATIVE__"));
        assert!(s.contains("writable: false") && s.contains("configurable: false"));
        assert!(s.contains(env!("CARGO_PKG_VERSION")));
        // Die App unterscheidet Desktop und Android am Feld `huelle` (6.1c) – genau diese zwei
        assert!(s.contains(&format!("huelle: \"{HUELLE}\"")));
        assert_eq!(HUELLE, if cfg!(target_os = "android") { "android" } else { "desktop" });
    }

    #[test]
    fn android_und_windows_nutzen_die_http_form() {
        assert_eq!(HTTP_FORM, cfg!(any(windows, target_os = "android")));
        assert_eq!(adresse(), if HTTP_FORM { "http://freedom.localhost/" } else { "freedom://localhost/" });
    }

    #[test]
    fn navigiert_nur_im_eigenen_ursprung() {
        let u = |s: &str| Url::parse(s).unwrap();
        let eigen = adresse();
        assert!(darf_navigieren(&u(eigen)));
        assert!(darf_navigieren(&u(&format!("{eigen}#/chat"))));
        assert!(darf_navigieren(&u(&format!("blob:{}abc-123", eigen))));
        for fremd in [
            "https://example.org/",
            "http://localhost/",
            "file:///etc/passwd",
            "freedom://anderer/",
            "http://freedom.localhost.example.org/",
            "blob:https://example.org/abc",
            "data:text/html,<p>x</p>",
            "javascript:alert(1)",
        ] {
            assert!(!darf_navigieren(&u(fremd)), "{fremd}");
        }
        // Die Form der jeweils anderen Plattform gilt hier nicht
        let andere = if HTTP_FORM { "freedom://localhost/" } else { "http://freedom.localhost/" };
        assert!(!darf_navigieren(&u(andere)));
    }

    #[test]
    fn adresse_ist_ein_eigener_ursprung() {
        let a = adresse();
        assert!(a == "freedom://localhost/" || a == "http://freedom.localhost/");
    }
}
