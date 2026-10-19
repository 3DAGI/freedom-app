//! Direkt oder über Tor (6.1b1a, Android seit 6.1b2a): die Wahl, der Start von arti,
//! die Kommandos.
//!
//! Die Wahl liegt in `netz.json` bei den Daten der Hülle und gilt ab dem nächsten
//! Start – der Proxy eines Webviews steht beim Bauen des Fensters fest (unter
//! Android setzt ihn `android_tor.rs`, bevor die App lädt). Mit „Tor“ bekommt das
//! Fenster immer einen Proxy, auch wenn arti nicht startet: Dann scheitern die
//! Verbindungen, statt still direkt hinauszugehen. Mit Brücken (B-33b, `bruecken.rs`) geht
//! arti nur über sie ins Tor-Netz – fehlt ein Programm oder gilt eine Zeile nicht, startet
//! arti nicht (nie still ohne Brücke).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Die Wahl in `netz.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wahl {
    pub tor: bool,
    /// Tor über Brücken (B-33b) – ohne eigene Zeilen die eingebauten von Snowflake.
    #[serde(default)]
    pub bruecken: bool,
    /// Eigene Brücken-Zeilen, geprüft (`bruecken::pruefe_zeilen()`) – sie bleiben nur in dieser Datei.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub zeilen: Vec<String>,
}

/// Die gespeicherte Wahl – fehlt die Datei oder ist sie kaputt: direkt.
pub fn lies_wahl(datei: &Path) -> Wahl {
    std::fs::read(datei).ok().and_then(|d| serde_json::from_slice::<Wahl>(&d).ok()).unwrap_or_default()
}

/// Schreibt die Wahl – erst eine neue Datei ganz, dann umbenennen.
pub fn schreibe_wahl(datei: &Path, wahl: &Wahl) -> std::io::Result<()> {
    if let Some(ordner) = datei.parent() {
        std::fs::create_dir_all(ordner)?;
    }
    let neu = datei.with_extension("neu");
    std::fs::write(&neu, serde_json::to_vec(wahl).map_err(std::io::Error::other)?)?;
    std::fs::rename(neu, datei)
}

/// Tor gibt es auf dem Desktop und unter Android (nicht unter iOS).
pub const TOR_MOEGLICH: bool = cfg!(any(desktop, target_os = "android"));

/// Zustand dieser Sitzung.
pub struct Netz {
    datei: Option<PathBuf>,
    /// Diese Sitzung läuft über Tor (der Proxy des Fensters).
    aktiv: bool,
    /// … und über Brücken.
    bruecken_aktiv: bool,
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
    /// `start` (arti startet nicht), `bootstrap` (keine Verbindung ins Tor-Netz),
    /// `proxy` (das Webview nahm den Proxy nicht an – unter Android bleibt die App dann ungeladen)
    /// oder `bruecke` (Brücken gewählt, aber ein Programm fehlt oder eine Zeile gilt nicht).
    pub fehler: Option<&'static str>,
    /// Brücken gewählt – gilt ab dem nächsten Start (B-33b).
    pub bruecken: bool,
    /// Diese Sitzung läuft über Brücken.
    pub bruecken_aktiv: bool,
    /// Die Programme der Brücken liegen bei (Desktop).
    pub bruecken_moeglich: bool,
    /// So viele eigene Zeilen sind gemerkt (die Zeilen selbst bleiben in der Hülle).
    pub eigene_zeilen: usize,
}

impl Netz {
    /// Liest die Wahl und startet – auf dem Desktop, wenn gewählt – Tor.
    pub fn starte<R: tauri::Runtime>(pfade: &tauri::path::PathResolver<R>) -> Self {
        let datei = pfade.app_data_dir().ok().map(|d| d.join("netz.json"));
        let wahl = datei.as_deref().map(lies_wahl).unwrap_or_default();
        let bereit = Arc::new(AtomicBool::new(false));
        let fehler = Arc::new(Mutex::new(None));
        let aktiv = TOR_MOEGLICH && wahl.tor;
        let bruecken = (aktiv && wahl.bruecken).then(|| crate::bruecken::zeilen_fuer(&wahl.zeilen));
        let port = match &bruecken {
            Some(Err(_)) => {
                *fehler.lock().unwrap() = Some("bruecke");
                None
            }
            _ if aktiv => starte_tor(pfade, &bereit, &fehler, bruecken.and_then(Result::ok)),
            _ => None,
        };
        if aktiv && port.is_none() {
            fehler.lock().unwrap().get_or_insert("start");
        }
        let bruecken_aktiv = aktiv && wahl.bruecken;
        Netz { datei, aktiv, bruecken_aktiv, port, bereit, fehler, proxy_moeglich: Arc::new(AtomicBool::new(cfg!(desktop))) }
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
        let wahl = self.datei.as_deref().map(lies_wahl).unwrap_or_default();
        NetzStand {
            verfuegbar: TOR_MOEGLICH && self.proxy_moeglich.load(Ordering::SeqCst),
            tor: wahl.tor,
            aktiv: self.aktiv,
            bereit: self.aktiv && self.bereit.load(Ordering::SeqCst),
            fehler: if self.aktiv { *self.fehler.lock().unwrap() } else { None },
            bruecken: wahl.bruecken,
            bruecken_aktiv: self.bruecken_aktiv,
            bruecken_moeglich: TOR_MOEGLICH && crate::bruecken::moeglich(),
            eigene_zeilen: wahl.zeilen.len(),
        }
    }
}

/// Startet Tor (mit Brücken, wenn `bruecken` Zeilen nennt) und meldet den Port des Zugangs.
#[cfg(any(desktop, target_os = "android"))]
fn starte_tor<R: tauri::Runtime>(
    pfade: &tauri::path::PathResolver<R>,
    bereit: &Arc<AtomicBool>,
    fehler: &Arc<Mutex<Option<&'static str>>>,
    bruecken: Option<Vec<String>>,
) -> Option<u16> {
    let zustand = pfade.app_data_dir().ok()?.join("tor");
    let cache = pfade.app_cache_dir().ok()?.join("tor");
    tor_start::starte(zustand, cache, bereit.clone(), fehler.clone(), bruecken).ok()
}

#[cfg(not(any(desktop, target_os = "android")))]
fn starte_tor<R: tauri::Runtime>(_: &tauri::path::PathResolver<R>, _: &Arc<AtomicBool>, _: &Arc<Mutex<Option<&'static str>>>, _: Option<Vec<String>>) -> Option<u16> {
    None
}

#[tauri::command]
pub fn netz_stand(n: tauri::State<'_, Netz>) -> NetzStand {
    n.stand()
}

/// Speichert die Wahl; mit `neustart` startet die Hülle gleich neu (der Proxy gilt ab dem Start).
/// `bruecken` und `zeilen` (B-33b) bleiben, wie sie sind, wenn sie fehlen; eigene Zeilen gelten nur alle
/// zusammen (Fehler `zeile:<stelle>:<kennung>`), eine leere Liste heißt: die eingebauten.
#[tauri::command]
pub fn netz_setzen<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    n: tauri::State<'_, Netz>,
    tor: bool,
    neustart: bool,
    bruecken: Option<bool>,
    zeilen: Option<Vec<String>>,
) -> Result<NetzStand, String> {
    let stand = n.stand();
    if tor && !stand.verfuegbar {
        return Err("nicht-verfuegbar".into());
    }
    let Some(datei) = &n.datei else { return Err("keine-ablage".into()) };
    let wahl = neue_wahl(lies_wahl(datei), tor, bruecken, zeilen, stand.bruecken_moeglich)?;
    schreibe_wahl(datei, &wahl).map_err(|_| "ablage".to_string())?;
    if neustart {
        neu_starten(&app);
    }
    Ok(n.stand())
}

/// Die neue Wahl aus der alten – Brücken nur, wenn ihre Programme beiliegen.
fn neue_wahl(alt: Wahl, tor: bool, bruecken: Option<bool>, zeilen: Option<Vec<String>>, moeglich: bool) -> Result<Wahl, String> {
    let mut wahl = Wahl { tor, ..alt };
    if let Some(z) = zeilen {
        wahl.zeilen = crate::bruecken::pruefe_zeilen(&z).map_err(|(i, f)| format!("zeile:{i}:{}", f.kennung()))?;
    }
    if let Some(b) = bruecken {
        if b && !moeglich {
            return Err("bruecken-fehlen".into());
        }
        wahl.bruecken = b;
    }
    Ok(wahl)
}

/// Der Ausweg der Warteseite (Android): direkt wählen und schließen – nur auf Klick.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn direkt_und_neu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> ! {
    use tauri::Manager;
    if let Some(datei) = app.try_state::<Netz>().and_then(|n| n.datei.clone()) {
        let wahl = Wahl { tor: false, ..lies_wahl(&datei) };
        let _ = schreibe_wahl(&datei, &wahl);
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

    /// Bindet den Zugang (Port vom System), startet arti – mit `bruecken` nur über sie – und meldet den Port.
    pub fn starte(
        zustand: PathBuf,
        cache: PathBuf,
        bereit: Arc<AtomicBool>,
        fehler: Arc<Mutex<Option<&'static str>>>,
        bruecken: Option<Vec<String>>,
    ) -> std::io::Result<u16> {
        let lauscher = std::net::TcpListener::bind("127.0.0.1:0")?;
        lauscher.set_nonblocking(true)?;
        let port = lauscher.local_addr()?.port();
        // arti nimmt den Krypto-Anbieter, den das Programm festlegt (schon festgelegt: auch gut)
        let _ = rustls::crypto::ring::default_provider().install_default();
        // Ein Fehler in arti darf die Hülle nicht reißen – dann scheitern nur die Verbindungen
        let fehler_bruecke = fehler.clone();
        let client = std::panic::catch_unwind(move || {
            tauri::async_runtime::block_on(async move {
                let mut cfg = arti_client::config::TorClientConfigBuilder::from_directories(zustand, cache);
                // Unter Android gehören die Ordner über den App-Daten dem System (Gruppe
                // schreibbar) – arti lehnte sie ab. Dort schützt die Sandbox je App.
                if cfg!(target_os = "android") {
                    cfg.storage().permissions().dangerously_trust_everyone();
                }
                if let Some(zeilen) = &bruecken {
                    if crate::bruecken::konfiguriere(&mut cfg, zeilen, crate::bruecken::programm).is_err() {
                        *fehler_bruecke.lock().unwrap() = Some("bruecke");
                        return None;
                    }
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
                melde_ende(tauri::async_runtime::spawn(async move { c.bootstrap().await }), bereit, fehler.clone());
                Arc::new(move |z: Ziel| {
                    let c = client.clone();
                    Box::pin(async move {
                        let strom = c.connect((z.host.as_str(), z.port)).await.map_err(|_| std::io::Error::other("tor"))?;
                        Ok(Box::new(strom) as Box<dyn Strom>)
                    })
                })
            }
            None => {
                fehler.lock().unwrap().get_or_insert("start");
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

    /// Meldet das Ende des Verbindens (eigene Aufgabe): bereit – sonst „bootstrap“, auch
    /// nach einem Panik in arti.
    pub(super) fn melde_ende<E: Send + 'static>(
        lauf: tauri::async_runtime::JoinHandle<Result<(), E>>,
        bereit: Arc<AtomicBool>,
        fehler: Arc<Mutex<Option<&'static str>>>,
    ) {
        tauri::async_runtime::spawn(async move {
            match lauf.await {
                Ok(Ok(())) => bereit.store(true, Ordering::SeqCst),
                _ => *fehler.lock().unwrap() = Some("bootstrap"),
            }
        });
    }
}

// `catch_unwind` und `melde_ende()` fangen einen Fehler in arti nur mit Abwickeln
#[cfg(panic = "abort")]
compile_error!("Die Hülle braucht panic = \"unwind\" – sonst reißt ein Fehler in arti die App (netz.rs)");

#[cfg(test)]
mod tests {
    use super::*;

    fn ordner(name: &str) -> PathBuf {
        let o = std::env::temp_dir().join(format!("freedom-netz-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&o);
        o
    }

    fn tor(tor: bool) -> Wahl {
        Wahl { tor, ..Wahl::default() }
    }

    #[test]
    fn ohne_datei_direkt_und_die_wahl_bleibt() {
        let d = ordner("wahl").join("netz.json");
        assert_eq!(lies_wahl(&d), tor(false));
        schreibe_wahl(&d, &tor(true)).unwrap();
        assert_eq!(lies_wahl(&d), tor(true));
        schreibe_wahl(&d, &tor(false)).unwrap();
        assert_eq!(lies_wahl(&d), tor(false));
        std::fs::write(&d, b"{kaputt").unwrap();
        assert_eq!(lies_wahl(&d), tor(false), "kaputt heißt direkt – die Wahl zeigt die App, nichts geht still über Tor verloren");
        std::fs::remove_dir_all(d.parent().unwrap()).unwrap();
    }

    #[test]
    fn brueckenwahl_in_derselben_datei_alte_bleibt_lesbar() {
        let d = ordner("bruecken").join("netz.json");
        std::fs::create_dir_all(d.parent().unwrap()).unwrap();
        std::fs::write(&d, br#"{"tor":true}"#).unwrap();
        assert_eq!(lies_wahl(&d), tor(true), "netz.json vor B-33b");
        let w = Wahl { tor: true, bruecken: true, zeilen: vec![crate::bruecken::SNOWFLAKE_EINGEBAUT[0].into()] };
        schreibe_wahl(&d, &w).unwrap();
        assert_eq!(lies_wahl(&d), w);
        schreibe_wahl(&d, &tor(true)).unwrap();
        assert_eq!(std::fs::read_to_string(&d).unwrap(), r#"{"tor":true,"bruecken":false}"#, "ohne Zeilen keine leere Liste");
        std::fs::remove_dir_all(d.parent().unwrap()).unwrap();
    }

    #[test]
    fn neue_wahl_brueckenzeilen_nur_geprueft_und_nur_mit_programmen() {
        let alt = Wahl { tor: true, bruecken: true, zeilen: vec![crate::bruecken::SNOWFLAKE_EINGEBAUT[1].into()] };
        // Ohne Angaben zu Brücken bleibt deren Wahl – auch beim Ausweg „direkt“
        assert_eq!(neue_wahl(alt.clone(), false, None, None, false), Ok(Wahl { tor: false, ..alt.clone() }));
        assert_eq!(neue_wahl(alt.clone(), true, Some(true), None, false), Err("bruecken-fehlen".into()));
        assert_eq!(neue_wahl(alt.clone(), true, Some(false), None, false).map(|w| w.bruecken), Ok(false), "abschalten geht immer");
        let eingefuegt = vec![format!("Bridge {}", crate::bruecken::SNOWFLAKE_EINGEBAUT[0]), "webtunnel 192.0.2.9:443 kurz".into()];
        assert_eq!(neue_wahl(alt.clone(), true, Some(true), Some(eingefuegt), true), Err("zeile:1:fingerabdruck".into()));
        let w = neue_wahl(alt.clone(), true, Some(true), Some(vec![format!("Bridge {}", crate::bruecken::SNOWFLAKE_EINGEBAUT[0])]), true).unwrap();
        assert_eq!(w.zeilen, vec![crate::bruecken::SNOWFLAKE_EINGEBAUT[0].to_string()], "in fester Form gemerkt");
        assert_eq!(neue_wahl(w, true, None, Some(vec![]), true).map(|w| w.zeilen.len()), Ok(0), "leer: wieder die eingebauten");
    }

    fn netz(aktiv: bool, port: Option<u16>, fehler: Option<&'static str>, proxy_moeglich: bool) -> Netz {
        Netz {
            datei: None,
            aktiv,
            bruecken_aktiv: false,
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

    /// Wartet mit Frist, bis Tor bereit ist oder einen Fehler meldet.
    fn ende_von<E: Send + 'static>(lauf: tauri::async_runtime::JoinHandle<Result<(), E>>) -> (bool, Option<&'static str>) {
        let (bereit, fehler) = (Arc::new(AtomicBool::new(false)), Arc::new(Mutex::new(None)));
        tor_start::melde_ende(lauf, bereit.clone(), fehler.clone());
        let frist = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !bereit.load(Ordering::SeqCst) && fehler.lock().unwrap().is_none() && std::time::Instant::now() < frist {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let f = *fehler.lock().unwrap();
        (bereit.load(Ordering::SeqCst), f)
    }

    #[test]
    fn ein_panik_beim_verbinden_ist_ein_fehler_und_reisst_die_huelle_nicht() {
        assert_eq!(ende_von(tauri::async_runtime::spawn(async { Ok::<(), ()>(()) })), (true, None));
        assert_eq!(ende_von(tauri::async_runtime::spawn(async { Err::<(), ()>(()) })), (false, Some("bootstrap")));
        let panik = tauri::async_runtime::spawn(async {
            if std::hint::black_box(true) {
                panic!("Panik in arti (gewollt im Test)");
            }
            Ok::<(), ()>(())
        });
        assert_eq!(ende_von(panik), (false, Some("bootstrap")));
    }

    #[test]
    fn das_release_wickelt_ab() {
        // Mit `panic = "abort"` wären `catch_unwind` und `melde_ende()` wirkungslos
        let profil = include_str!("../Cargo.toml").split("[profile.release]").nth(1).expect("Profil fehlt");
        let profil = profil.split("\n[").next().unwrap_or("");
        assert!(!profil.lines().any(|z| z.trim_start().starts_with("panic")), "panic im Release-Profil");
    }
}
