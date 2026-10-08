//! Direkt oder über Tor (6.1b1a, Android seit 6.1b2a): die Wahl, der Start von arti,
//! die Kommandos.
//!
//! Die Wahl liegt in `netz.json` bei den Daten der Hülle und gilt ab dem nächsten
//! Start – der Proxy eines Webviews steht beim Bauen des Fensters fest (unter
//! Android setzt ihn `android_tor.rs`, bevor die App lädt). Mit „Tor“ bekommt das
//! Fenster immer einen Proxy, auch wenn arti nicht startet: Dann scheitern die
//! Verbindungen, statt still direkt hinauszugehen.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Deserialize)]
struct Datei {
    tor: bool,
}

/// Die gespeicherte Wahl – fehlt die Datei oder ist sie kaputt: direkt.
pub fn lies_wahl(datei: &Path) -> bool {
    std::fs::read(datei).ok().and_then(|d| serde_json::from_slice::<Datei>(&d).ok()).is_some_and(|d| d.tor)
}

/// Schreibt die Wahl – erst eine neue Datei ganz, dann umbenennen.
pub fn schreibe_wahl(datei: &Path, tor: bool) -> std::io::Result<()> {
    if let Some(ordner) = datei.parent() {
        std::fs::create_dir_all(ordner)?;
    }
    let neu = datei.with_extension("neu");
    std::fs::write(&neu, serde_json::to_vec(&Datei { tor }).map_err(std::io::Error::other)?)?;
    std::fs::rename(neu, datei)
}

/// Tor gibt es auf dem Desktop und unter Android (nicht unter iOS).
pub const TOR_MOEGLICH: bool = cfg!(any(desktop, target_os = "android"));

/// Zustand dieser Sitzung.
pub struct Netz {
    datei: Option<PathBuf>,
    /// Diese Sitzung läuft über Tor (der Proxy des Fensters).
    aktiv: bool,
    port: Option<u16>,
    bereit: Arc<AtomicBool>,
    fehler: Arc<Mutex<Option<&'static str>>>,
    /// Kann dieses Webview einen Proxy bekommen? Desktop immer, Android nur mit
    /// `PROXY_OVERRIDE` (androidx.webkit) – die Hülle prüft es beim Start.
    proxy_moeglich: Arc<AtomicBool>,
}

/// Was die App über das Netz der Hülle erfährt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetzStand {
    /// Diese Hülle kann Tor (Desktop).
    pub verfuegbar: bool,
    /// Gewählt – gilt ab dem nächsten Start.
    pub tor: bool,
    /// Diese Sitzung läuft über Tor.
    pub aktiv: bool,
    /// arti ist verbunden (Bootstrap fertig).
    pub bereit: bool,
    /// `start` (arti startet nicht), `bootstrap` (keine Verbindung ins Tor-Netz) oder
    /// `proxy` (das Webview nahm den Proxy nicht an – unter Android bleibt die App dann ungeladen).
    pub fehler: Option<&'static str>,
}

impl Netz {
    /// Liest die Wahl und startet – auf dem Desktop, wenn gewählt – Tor.
    pub fn starte<R: tauri::Runtime>(pfade: &tauri::path::PathResolver<R>) -> Self {
        let datei = pfade.app_data_dir().ok().map(|d| d.join("netz.json"));
        let gewaehlt = datei.as_deref().is_some_and(lies_wahl);
        let bereit = Arc::new(AtomicBool::new(false));
        let fehler = Arc::new(Mutex::new(None));
        let (aktiv, port) = if TOR_MOEGLICH && gewaehlt { (true, starte_tor(pfade, &bereit, &fehler)) } else { (false, None) };
        if aktiv && port.is_none() {
            *fehler.lock().unwrap() = Some("start");
        }
        Netz { datei, aktiv, port, bereit, fehler, proxy_moeglich: Arc::new(AtomicBool::new(cfg!(desktop))) }
    }

    /// Der Proxy fürs Fenster (Desktop, SOCKS5): mit Tor immer einer – startet nichts, einer, der nie antwortet.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn proxy(&self) -> Option<tauri::Url> {
        self.aktiv.then(|| format!("socks5://127.0.0.1:{}", self.port.unwrap_or(1)).parse().expect("Proxy-Adresse"))
    }

    /// Die Regel für androidx.webkit (`ProxyConfig`): derselbe Zugang über HTTP CONNECT –
    /// so geht jeder Name als Name hinaus, nie über eine Auflösung im Webview.
    pub fn proxy_regel(&self) -> Option<String> {
        self.aktiv.then(|| format!("http://127.0.0.1:{}", self.port.unwrap_or(1)))
    }

    /// Ob das Webview einen Proxy annehmen kann (Android, aus `android_tor.rs`).
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub fn proxy_moeglich(&self, ja: bool) {
        self.proxy_moeglich.store(ja, Ordering::SeqCst);
    }

    /// Das Webview nahm den Proxy nicht an – mit Tor lädt die App dann nicht.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub fn proxy_gescheitert(&self) {
        *self.fehler.lock().unwrap() = Some("proxy");
    }

    pub fn stand(&self) -> NetzStand {
        NetzStand {
            verfuegbar: TOR_MOEGLICH && self.proxy_moeglich.load(Ordering::SeqCst),
            tor: self.datei.as_deref().is_some_and(lies_wahl),
            aktiv: self.aktiv,
            bereit: self.aktiv && self.bereit.load(Ordering::SeqCst),
            fehler: if self.aktiv { *self.fehler.lock().unwrap() } else { None },
        }
    }
}

/// Startet Tor und meldet den Port des Zugangs.
#[cfg(any(desktop, target_os = "android"))]
fn starte_tor<R: tauri::Runtime>(pfade: &tauri::path::PathResolver<R>, bereit: &Arc<AtomicBool>, fehler: &Arc<Mutex<Option<&'static str>>>) -> Option<u16> {
    let zustand = pfade.app_data_dir().ok()?.join("tor");
    let cache = pfade.app_cache_dir().ok()?.join("tor");
    tor_start::starte(zustand, cache, bereit.clone(), fehler.clone()).ok()
}

#[cfg(not(any(desktop, target_os = "android")))]
fn starte_tor<R: tauri::Runtime>(_: &tauri::path::PathResolver<R>, _: &Arc<AtomicBool>, _: &Arc<Mutex<Option<&'static str>>>) -> Option<u16> {
    None
}

#[tauri::command]
pub fn netz_stand(n: tauri::State<'_, Netz>) -> NetzStand {
    n.stand()
}

/// Speichert die Wahl; mit `neustart` startet die Hülle gleich neu (der Proxy gilt ab dem Start).
#[tauri::command]
pub fn netz_setzen<R: tauri::Runtime>(app: tauri::AppHandle<R>, n: tauri::State<'_, Netz>, tor: bool, neustart: bool) -> Result<NetzStand, String> {
    if tor && !n.stand().verfuegbar {
        return Err("nicht-verfuegbar".into());
    }
    let Some(datei) = &n.datei else { return Err("keine-ablage".into()) };
    schreibe_wahl(datei, tor).map_err(|_| "ablage".to_string())?;
    if neustart {
        neu_starten(&app);
    }
    Ok(n.stand())
}

/// Der Ausweg der Warteseite (Android): direkt wählen und schließen – nur auf Klick.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn direkt_und_neu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> ! {
    use tauri::Manager;
    if let Some(datei) = app.try_state::<Netz>().and_then(|n| n.datei.clone()) {
        let _ = schreibe_wahl(&datei, false);
    }
    neu_starten(app);
}

/// Damit die Wahl gilt: Der Desktop startet die Hülle neu. Android startet keinen Prozess
/// aus sich selbst – dort endet die App und öffnet sich beim nächsten Antippen neu.
fn neu_starten<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> ! {
    if cfg!(target_os = "android") {
        std::process::exit(0)
    }
    app.restart()
}

/// arti hinter dem Zugang (Desktop und Android).
#[cfg(any(desktop, target_os = "android"))]
mod tor_start {
    use crate::tor::{self, Strom, Verbinden, Ziel};
    use arti_client::{TorClient, TorClientConfig};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    /// Bindet den Zugang (Port vom System), startet arti und meldet den Port.
    pub fn starte(zustand: PathBuf, cache: PathBuf, bereit: Arc<AtomicBool>, fehler: Arc<Mutex<Option<&'static str>>>) -> std::io::Result<u16> {
        let lauscher = std::net::TcpListener::bind("127.0.0.1:0")?;
        lauscher.set_nonblocking(true)?;
        let port = lauscher.local_addr()?.port();
        // arti nimmt den Krypto-Anbieter, den das Programm festlegt (schon festgelegt: auch gut)
        let _ = rustls::crypto::ring::default_provider().install_default();
        // Ein Fehler in arti darf die Hülle nicht reißen – dann scheitern nur die Verbindungen
        let client = std::panic::catch_unwind(|| {
            tauri::async_runtime::block_on(async move {
                let mut cfg = arti_client::config::TorClientConfigBuilder::from_directories(zustand, cache);
                // Unter Android gehören die Ordner über den App-Daten dem System (Gruppe
                // schreibbar) – arti lehnte sie ab. Dort schützt die Sandbox je App.
                if cfg!(target_os = "android") {
                    cfg.storage().permissions().dangerously_trust_everyone();
                }
                let cfg: TorClientConfig = cfg.build().ok()?;
                TorClient::builder().config(cfg).create_unbootstrapped().ok()
            })
        })
        .ok()
        .flatten();
        let verbinden: Verbinden = match client {
            Some(client) => {
                let c = client.clone();
                let fehler = fehler.clone();
                tauri::async_runtime::spawn(async move {
                    match c.bootstrap().await {
                        Ok(()) => bereit.store(true, Ordering::SeqCst),
                        Err(_) => *fehler.lock().unwrap() = Some("bootstrap"),
                    }
                });
                Arc::new(move |z: Ziel| {
                    let c = client.clone();
                    Box::pin(async move {
                        let strom = c.connect((z.host.as_str(), z.port)).await.map_err(|_| std::io::Error::other("tor"))?;
                        Ok(Box::new(strom) as Box<dyn Strom>)
                    })
                })
            }
            None => {
                *fehler.lock().unwrap() = Some("start");
                Arc::new(|_z: Ziel| Box::pin(async { Err::<Box<dyn Strom>, _>(std::io::Error::other("tor")) }))
            }
        };
        tauri::async_runtime::spawn(async move {
            if let Ok(l) = tokio::net::TcpListener::from_std(lauscher) {
                tor::diene(l, verbinden).await;
            }
        });
        Ok(port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ordner(name: &str) -> PathBuf {
        let o = std::env::temp_dir().join(format!("freedom-netz-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&o);
        o
    }

    #[test]
    fn ohne_datei_direkt_und_die_wahl_bleibt() {
        let d = ordner("wahl").join("netz.json");
        assert!(!lies_wahl(&d));
        schreibe_wahl(&d, true).unwrap();
        assert!(lies_wahl(&d));
        schreibe_wahl(&d, false).unwrap();
        assert!(!lies_wahl(&d));
        std::fs::write(&d, b"{kaputt").unwrap();
        assert!(!lies_wahl(&d), "kaputt heißt direkt – die Wahl zeigt die App, nichts geht still über Tor verloren");
        std::fs::remove_dir_all(d.parent().unwrap()).unwrap();
    }

    fn netz(aktiv: bool, port: Option<u16>, fehler: Option<&'static str>, proxy_moeglich: bool) -> Netz {
        Netz {
            datei: None,
            aktiv,
            port,
            bereit: Arc::new(AtomicBool::new(true)),
            fehler: Arc::new(Mutex::new(fehler)),
            proxy_moeglich: Arc::new(AtomicBool::new(proxy_moeglich)),
        }
    }

    #[test]
    fn mit_tor_immer_ein_proxy_auch_wenn_nichts_startet() {
        let n = netz(true, None, Some("start"), true);
        n.bereit.store(false, Ordering::SeqCst);
        assert_eq!(n.proxy().unwrap().as_str(), "socks5://127.0.0.1:1");
        assert_eq!(n.proxy_regel().as_deref(), Some("http://127.0.0.1:1"), "Android: derselbe tote Zugang");
        let s = n.stand();
        assert_eq!((s.aktiv, s.bereit, s.fehler), (true, false, Some("start")));
        let n = Netz { port: Some(40123), ..n };
        assert_eq!(n.proxy().unwrap().as_str(), "socks5://127.0.0.1:40123");
        assert_eq!(n.proxy_regel().as_deref(), Some("http://127.0.0.1:40123"));
        let direkt = netz(false, None, Some("start"), true);
        assert_eq!((direkt.proxy(), direkt.proxy_regel()), (None, None));
        assert_eq!((direkt.stand().bereit, direkt.stand().fehler), (false, None));
    }

    #[test]
    fn ohne_proxy_im_webview_kein_tor_und_der_fehler_wird_gesagt() {
        let n = netz(true, Some(40123), None, false);
        assert!(!n.stand().verfuegbar, "Android ohne PROXY_OVERRIDE: kein Schalter");
        n.proxy_moeglich(true);
        assert_eq!(n.stand().verfuegbar, TOR_MOEGLICH);
        n.proxy_gescheitert();
        assert_eq!(n.stand().fehler, Some("proxy"));
        // Direkt bleibt still – ein alter Fehler zählt dort nicht
        let direkt = netz(false, None, Some("proxy"), true);
        assert_eq!(direkt.stand().fehler, None);
    }
}
