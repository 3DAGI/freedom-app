//! Welche Oberfläche die Hülle ausliefert, und was die App daran ändern darf (6.1a3b).
//!
//! Beim Start gilt die installierte Fassung (`ablage.rs`), sonst die beigelegte.
//! Die App darf genau zwei Kommandos rufen (Capability `oberflaeche`):
//! - `oberflaeche_stand` – was läuft gerade;
//! - `oberflaeche_installieren` – nur, was `update::pruefe()` freigibt: k
//!   vertraute Signierer, genau diese Datei, neuer als die laufende Fassung.
//!
//! Zurück geht es nur über den Start, nie aus der Oberfläche: Sonst könnte eine
//! Lücke in ihr auf eine ältere, verwundbare Fassung zurückschalten.
//! `--oberflaeche=vorher` macht die vorige installierte Fassung wieder aktuell,
//! `--oberflaeche=beigelegt` startet diesmal mit der beigelegten.
//! Android kennt keine Startargumente (6.1c): Dort liegt die Ablage im Cache der
//! App – „Cache leeren“ in den Einstellungen des Systems führt zur beigelegten
//! Fassung zurück, ohne Tresor und Verläufe (die liegen bei den Daten des Webviews).

use crate::ablage::{Ablage, Stand};
use crate::{oberflaeche, update};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// Zeitpunkt der beigelegten Fassung – setzt ein Release-Bau (`FREEDOM_RELEASED_AT`),
/// sonst 0: dann gilt jede bestätigte Fassung als neuer.
pub const BEIGELEGT_SEIT: u64 = match option_env!("FREEDOM_RELEASED_AT") {
    Some(s) => zahl(s),
    None => 0,
};

const fn zahl(s: &str) -> u64 {
    let b = s.as_bytes();
    assert!(!b.is_empty() && b.len() <= 15, "FREEDOM_RELEASED_AT: Unix-Sekunden");
    let (mut i, mut n) = (0, 0u64);
    while i < b.len() {
        assert!(b[i].is_ascii_digit(), "FREEDOM_RELEASED_AT: nur Ziffern");
        n = n * 10 + (b[i] - b'0') as u64;
        i += 1;
    }
    n
}

/// Wo installierte Fassungen liegen: Desktop bei den Daten der Hülle, Android im
/// Cache (der Rückweg dort); ohne Ordner gilt nur die beigelegte.
pub fn ablageordner<R: tauri::Runtime>(pfade: &tauri::path::PathResolver<R>) -> Option<PathBuf> {
    let basis = if cfg!(target_os = "android") { pfade.app_cache_dir() } else { pfade.app_data_dir() };
    basis.ok().map(|d| d.join("oberflaeche"))
}

/// Wie die Hülle diesmal startet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Startwahl {
    Normal,
    /// `--oberflaeche=vorher`: die vorige installierte Fassung wird wieder aktuell.
    Vorher,
    /// `--oberflaeche=beigelegt`: diesmal die beigelegte, an der Ablage ändert sich nichts.
    Beigelegt,
}

impl Startwahl {
    pub fn aus(argumente: impl IntoIterator<Item = String>) -> Self {
        let mut wahl = Startwahl::Normal;
        for a in argumente {
            match a.as_str() {
                "--oberflaeche=vorher" => wahl = Startwahl::Vorher,
                "--oberflaeche=beigelegt" => wahl = Startwahl::Beigelegt,
                _ => {}
            }
        }
        wahl
    }
}

struct Laufend {
    html: Arc<Vec<u8>>,
    stand: Option<Stand>,
}

pub struct Oberflaeche {
    ablage: Option<Ablage>,
    nur_beigelegt: bool,
    beigelegt_seit: u64,
    laufend: RwLock<Laufend>,
}

/// Was die App über die laufende Fassung erfährt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandAntwort {
    /// `beigelegt` oder `installiert`.
    pub quelle: &'static str,
    pub version: Option<String>,
    pub sha256: String,
    pub released_at: u64,
    /// Diesmal mit `--oberflaeche=beigelegt` gestartet.
    pub nur_beigelegt: bool,
    /// Es gibt eine vorige installierte Fassung (`--oberflaeche=vorher` hätte ein Ziel).
    pub vorher: bool,
}

impl Oberflaeche {
    pub fn starte(ordner: Option<PathBuf>, wahl: Startwahl) -> Self {
        Self::starte_seit(ordner, wahl, BEIGELEGT_SEIT)
    }

    /// Wie `starte()`, mit dem Zeitpunkt der beigelegten Fassung (in Tests frei wählbar).
    fn starte_seit(ordner: Option<PathBuf>, wahl: Startwahl, beigelegt_seit: u64) -> Self {
        let ablage = ordner.map(Ablage::neu);
        if let (Startwahl::Vorher, Some(a)) = (wahl, &ablage) {
            let _ = a.rueckfall();
        }
        let geladen = match (wahl, &ablage) {
            (Startwahl::Beigelegt, _) | (_, None) => None,
            (_, Some(a)) => a.lade(),
        };
        // Bringt eine neuere Hülle eine neuere Oberfläche mit, gilt die beigelegte.
        let laufend = match geladen.filter(|(_, stand)| stand.released_at > beigelegt_seit) {
            Some((html, stand)) => Laufend { html: Arc::new(html), stand: Some(stand) },
            None => Laufend { html: Arc::new(oberflaeche::BEIGELEGT.to_vec()), stand: None },
        };
        Oberflaeche { ablage, nur_beigelegt: wahl == Startwahl::Beigelegt, beigelegt_seit, laufend: RwLock::new(laufend) }
    }

    /// Die auszuliefernde Datei.
    pub fn html(&self) -> Arc<Vec<u8>> {
        self.laufend.read().map(|l| l.html.clone()).unwrap_or_else(|_| Arc::new(oberflaeche::BEIGELEGT.to_vec()))
    }

    pub fn stand(&self) -> StandAntwort {
        let l = self.laufend.read().expect("Stand lesbar");
        let sha256 = match &l.stand {
            Some(s) => s.sha256.clone(),
            None => update::sha256_hex(oberflaeche::BEIGELEGT),
        };
        StandAntwort {
            quelle: if l.stand.is_some() { "installiert" } else { "beigelegt" },
            version: l.stand.as_ref().map(|s| s.version.clone()),
            sha256,
            released_at: l.stand.as_ref().map_or(self.beigelegt_seit, |s| s.released_at),
            nur_beigelegt: self.nur_beigelegt,
            vorher: self.ablage.as_ref().is_some_and(Ablage::hat_vorher),
        }
    }

    /// Prüft und installiert; die neue Fassung gilt ab dem nächsten Laden der Seite.
    pub fn installiere(&self, html: &[u8], belege: &[update::Ereignis], vertraut: &[[u8; 32]], k: usize) -> Result<StandAntwort, &'static str> {
        let Some(ablage) = &self.ablage else { return Err("keine-ablage") };
        // Nie älter als die laufende – und nie älter als die abgelegte: Auch in einer mit
        // `--oberflaeche=beigelegt` gestarteten Sitzung ersetzt nichts Älteres die installierte.
        let seit = self.stand().released_at.max(ablage.lade().map_or(0, |(_, s)| s.released_at));
        let frei = update::pruefe(html, belege, vertraut, k, seit).map_err(update::Fehler::kennung)?;
        let stand = Stand { version: frei.version, sha256: frei.sha256, released_at: frei.released_at };
        ablage.installiere(html, &stand).map_err(|_| "ablage")?;
        if !self.nur_beigelegt {
            *self.laufend.write().map_err(|_| "ablage")? = Laufend { html: Arc::new(html.to_vec()), stand: Some(stand) };
        }
        Ok(self.stand())
    }
}

#[tauri::command]
pub fn oberflaeche_stand(o: tauri::State<'_, Oberflaeche>) -> StandAntwort {
    o.stand()
}

#[tauri::command]
pub async fn oberflaeche_installieren(o: tauri::State<'_, Oberflaeche>, html: String, belege: Vec<update::Ereignis>) -> Result<StandAntwort, String> {
    o.installiere(html.as_bytes(), &belege, &update::vertraute(), update::K).map_err(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Vektoren {
        vertraut: Vec<String>,
        faelle: Vec<Fall>,
    }
    #[derive(Deserialize)]
    struct Fall {
        html: String,
        belege: Vec<update::Ereignis>,
    }

    fn ordner(name: &str) -> PathBuf {
        let o = std::env::temp_dir().join(format!("freedom-installation-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&o);
        o
    }

    fn vektoren() -> (Vec<[u8; 32]>, Vec<Fall>) {
        let v: Vektoren = serde_json::from_str(include_str!("../tests/vektoren.json")).unwrap();
        let vertraut = v.vertraut.iter().map(|s| {
            let mut k = [0u8; 32];
            for (i, b) in k.iter_mut().enumerate() {
                *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
            }
            k
        });
        (vertraut.collect(), v.faelle)
    }

    #[test]
    fn ablage_auf_android_im_cache() {
        // Android hat keine Startargumente: Der Rückweg ist „Cache leeren“ (6.1c)
        let quelle = include_str!("installation.rs");
        assert!(quelle.contains("if cfg!(target_os = \"android\") { pfade.app_cache_dir() } else { pfade.app_data_dir() }"));
    }

    #[test]
    fn startwahl_aus_den_argumenten() {
        let a = |v: &[&str]| Startwahl::aus(v.iter().map(|s| s.to_string()));
        assert_eq!(a(&["freedom-launcher"]), Startwahl::Normal);
        assert_eq!(a(&["x", "--oberflaeche=vorher"]), Startwahl::Vorher);
        assert_eq!(a(&["x", "--oberflaeche=beigelegt"]), Startwahl::Beigelegt);
        assert_eq!(a(&["x", "--oberflaeche=irgendwas"]), Startwahl::Normal);
    }

    #[test]
    fn ohne_ablage_die_beigelegte() {
        let o = Oberflaeche::starte(None, Startwahl::Normal);
        let s = o.stand();
        assert_eq!((s.quelle, s.version, s.released_at), ("beigelegt", None, BEIGELEGT_SEIT));
        assert_eq!(s.sha256, update::sha256_hex(oberflaeche::BEIGELEGT));
        assert_eq!(o.html().as_slice(), oberflaeche::BEIGELEGT);
    }

    #[test]
    fn installieren_nur_was_die_pruefung_freigibt_und_nur_neueres() {
        let (vertraut, faelle) = vektoren();
        let d = ordner("freigabe");
        let o = Oberflaeche::starte(Some(d.clone()), Startwahl::Normal);
        // Ohne vertraute Signierer: nichts
        assert_eq!(o.installiere(faelle[0].html.as_bytes(), &faelle[0].belege, &[], 2), Err("zu-wenig"));
        // Mit den Signierern der Prüffälle: Fassung 2.0.0, ab sofort ausgeliefert
        let s = o.installiere(faelle[0].html.as_bytes(), &faelle[0].belege, &vertraut, 2).unwrap();
        assert_eq!((s.quelle, s.version.as_deref(), s.released_at), ("installiert", Some("2.0.0"), 2000));
        assert_eq!(o.html().as_slice(), faelle[0].html.as_bytes());
        // Dieselbe noch einmal: nicht neuer
        assert_eq!(o.installiere(faelle[0].html.as_bytes(), &faelle[0].belege, &vertraut, 2), Err("nicht-neuer"));
        // Nach einem Neustart läuft die installierte
        let neu = Oberflaeche::starte(Some(d.clone()), Startwahl::Normal);
        assert_eq!(neu.stand().version.as_deref(), Some("2.0.0"));
        assert!(!neu.stand().vorher, "vor 2.0.0 lief die beigelegte – keine vorige installierte");
        // Mit --oberflaeche=beigelegt diesmal die beigelegte, die Ablage bleibt
        let beigelegt = Oberflaeche::starte(Some(d.clone()), Startwahl::Beigelegt);
        assert_eq!((beigelegt.stand().quelle, beigelegt.stand().nur_beigelegt), ("beigelegt", true));
        assert_eq!(Oberflaeche::starte(Some(d.clone()), Startwahl::Normal).stand().version.as_deref(), Some("2.0.0"));
        // Auch dann nichts, was älter ist als die abgelegte Fassung (2000)
        assert_eq!(beigelegt.installiere(faelle[0].html.as_bytes(), &faelle[0].belege, &vertraut, 2), Err("nicht-neuer"));
        // Während einer mit --oberflaeche=beigelegt gestarteten Sitzung installiert: abgelegt,
        // ausgeliefert wird weiter die beigelegte (Prüffall 3: dieselbe Datei, Zeitpunkt 2500)
        let s = beigelegt.installiere(faelle[2].html.as_bytes(), &faelle[2].belege, &vertraut, 2).unwrap();
        assert_eq!((s.quelle, s.vorher), ("beigelegt", true));
        assert_eq!(beigelegt.html().as_slice(), oberflaeche::BEIGELEGT);
        // Mit --oberflaeche=vorher: die Fassung von 2000 ist wieder aktuell, dauerhaft
        let zurueck = Oberflaeche::starte(Some(d.clone()), Startwahl::Vorher);
        assert_eq!((zurueck.stand().quelle, zurueck.stand().released_at, zurueck.stand().vorher), ("installiert", 2000, false));
        assert_eq!(Oberflaeche::starte(Some(d.clone()), Startwahl::Normal).stand().released_at, 2000);
        // Noch einmal --oberflaeche=vorher: keine vorige – also wieder die beigelegte, dauerhaft
        assert_eq!(Oberflaeche::starte(Some(d.clone()), Startwahl::Vorher).stand().quelle, "beigelegt");
        assert_eq!(Oberflaeche::starte(Some(d.clone()), Startwahl::Normal).stand().quelle, "beigelegt");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn neuere_beigelegte_schlaegt_aeltere_installierte() {
        let (vertraut, faelle) = vektoren();
        let d = ordner("neuere-huelle");
        Oberflaeche::starte_seit(Some(d.clone()), Startwahl::Normal, 0).installiere(faelle[0].html.as_bytes(), &faelle[0].belege, &vertraut, 2).unwrap();
        // Die Hülle wurde aktualisiert; ihre Oberfläche ist von 3000, die installierte von 2000
        let o = Oberflaeche::starte_seit(Some(d.clone()), Startwahl::Normal, 3000);
        assert_eq!((o.stand().quelle, o.stand().released_at), ("beigelegt", 3000));
        assert_eq!(o.html().as_slice(), oberflaeche::BEIGELEGT);
        // und nichts Älteres als die beigelegte wird installiert (Prüffall 3: 2500)
        assert_eq!(o.installiere(faelle[2].html.as_bytes(), &faelle[2].belege, &vertraut, 2), Err("nicht-neuer"));
        // Mit einer Hülle von 1500 gilt wieder die installierte
        assert_eq!(Oberflaeche::starte_seit(Some(d.clone()), Startwahl::Normal, 1500).stand().released_at, 2000);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn fremde_datei_wird_nicht_installiert() {
        let (vertraut, faelle) = vektoren();
        let d = ordner("fremd");
        let o = Oberflaeche::starte(Some(d.clone()), Startwahl::Normal);
        assert_eq!(o.installiere(b"<script>steal()</script>", &faelle[0].belege, &vertraut, 2), Err("abweichend"));
        assert_eq!(o.stand().quelle, "beigelegt");
        assert!(!d.join("aktuell.html").exists());
        let _ = std::fs::remove_dir_all(d);
    }
}
