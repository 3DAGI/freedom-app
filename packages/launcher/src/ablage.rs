//! Die installierte Oberfläche auf dem Gerät (6.1a3b).
//!
//! Im Datenverzeichnis der Hülle (`oberflaeche/`) liegen höchstens zwei Fassungen:
//! `aktuell.*` und `vorher.*` – je die Datei und ihr Stand (Version, Prüfsumme,
//! Zeitpunkt). Installiert wird in drei Schritten: erst `neu.*` vollständig
//! schreiben, dann `aktuell` → `vorher`, dann `neu` → `aktuell`. Geladen wird eine
//! Fassung nur, wenn ihre Datei zu ihrem Stand passt (SHA-256) – bricht ein
//! Schritt ab oder ändert jemand die Datei, gilt wieder die beigelegte.
//! Was hier liegt, hat vorher `update::pruefe()` freigegeben; die Ablage prüft
//! nur noch, dass Datei und Stand zusammengehören.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Version, Prüfsumme und Zeitpunkt einer installierten Fassung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stand {
    pub version: String,
    pub sha256: String,
    pub released_at: u64,
}

/// Was nach einem Rückfall gilt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rueckfall {
    /// Die vorige installierte Fassung ist wieder aktuell.
    Vorher(Stand),
    /// Es gab keine vorige – die beigelegte gilt wieder.
    Beigelegt,
}

pub struct Ablage {
    ordner: PathBuf,
}

fn sha256_hex(daten: &[u8]) -> String {
    Sha256::digest(daten).iter().map(|b| format!("{b:02x}")).collect()
}

fn schreibe(pfad: &Path, daten: &[u8]) -> io::Result<()> {
    let mut f = fs::File::create(pfad)?;
    f.write_all(daten)?;
    f.sync_all()
}

impl Ablage {
    pub fn neu(ordner: PathBuf) -> Self {
        Ablage { ordner }
    }

    fn pfad(&self, name: &str) -> PathBuf {
        self.ordner.join(name)
    }

    fn lies(&self, wer: &str) -> Option<(Vec<u8>, Stand)> {
        let stand: Stand = serde_json::from_slice(&fs::read(self.pfad(&format!("{wer}.json"))).ok()?).ok()?;
        let html = fs::read(self.pfad(&format!("{wer}.html"))).ok()?;
        (sha256_hex(&html) == stand.sha256).then_some((html, stand))
    }

    /// Die installierte Fassung – nur, wenn Datei und Stand zusammengehören.
    pub fn lade(&self) -> Option<(Vec<u8>, Stand)> {
        self.lies("aktuell")
    }

    /// Gibt es eine vorige Fassung, auf die man zurückgehen kann?
    pub fn hat_vorher(&self) -> bool {
        self.lies("vorher").is_some()
    }

    /// Legt eine freigegebene Fassung ab; die bisherige wird zur vorigen.
    pub fn installiere(&self, html: &[u8], stand: &Stand) -> io::Result<()> {
        if sha256_hex(html) != stand.sha256 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "Datei passt nicht zum Stand"));
        }
        fs::create_dir_all(&self.ordner)?;
        schreibe(&self.pfad("neu.html"), html)?;
        schreibe(&self.pfad("neu.json"), &serde_json::to_vec(stand).map_err(io::Error::other)?)?;
        if self.lade().is_some() {
            for endung in ["html", "json"] {
                fs::rename(self.pfad(&format!("aktuell.{endung}")), self.pfad(&format!("vorher.{endung}")))?;
            }
        }
        // Stand zuletzt: Bis er da ist, passt `aktuell` nicht zusammen und gilt nicht.
        fs::rename(self.pfad("neu.html"), self.pfad("aktuell.html"))?;
        fs::rename(self.pfad("neu.json"), self.pfad("aktuell.json"))
    }

    /// Zurück zur vorigen Fassung – oder zur beigelegten, wenn es keine gibt.
    pub fn rueckfall(&self) -> io::Result<Rueckfall> {
        let _ = fs::remove_file(self.pfad("aktuell.json"));
        let _ = fs::remove_file(self.pfad("aktuell.html"));
        let Some((_, stand)) = self.lies("vorher") else {
            return Ok(Rueckfall::Beigelegt);
        };
        fs::rename(self.pfad("vorher.html"), self.pfad("aktuell.html"))?;
        fs::rename(self.pfad("vorher.json"), self.pfad("aktuell.json"))?;
        Ok(Rueckfall::Vorher(stand))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ordner(name: &str) -> PathBuf {
        let o = std::env::temp_dir().join(format!("freedom-ablage-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&o);
        o
    }

    fn stand(html: &[u8], version: &str, zeit: u64) -> Stand {
        Stand { version: version.into(), sha256: sha256_hex(html), released_at: zeit }
    }

    #[test]
    fn leer_gilt_die_beigelegte() {
        let a = Ablage::neu(ordner("leer"));
        assert!(a.lade().is_none());
        assert!(!a.hat_vorher());
        assert_eq!(a.rueckfall().unwrap(), Rueckfall::Beigelegt);
    }

    #[test]
    fn installieren_und_wieder_zurueck() {
        let o = ordner("zurueck");
        let a = Ablage::neu(o.clone());
        a.installiere(b"<p>2</p>", &stand(b"<p>2</p>", "2.0.0", 2000)).unwrap();
        assert_eq!(a.lade().unwrap().1.version, "2.0.0");
        assert!(!a.hat_vorher());
        a.installiere(b"<p>3</p>", &stand(b"<p>3</p>", "3.0.0", 3000)).unwrap();
        let (html, s) = a.lade().unwrap();
        assert_eq!((html.as_slice(), s.version.as_str()), (&b"<p>3</p>"[..], "3.0.0"));
        assert!(a.hat_vorher());
        assert_eq!(a.rueckfall().unwrap(), Rueckfall::Vorher(stand(b"<p>2</p>", "2.0.0", 2000)));
        assert_eq!(a.lade().unwrap().1.version, "2.0.0");
        assert_eq!(a.rueckfall().unwrap(), Rueckfall::Beigelegt);
        assert!(a.lade().is_none());
        assert!(!o.join("neu.html").exists() && !o.join("neu.json").exists());
        fs::remove_dir_all(o).unwrap();
    }

    #[test]
    fn veraenderte_datei_gilt_nicht() {
        let o = ordner("veraendert");
        let a = Ablage::neu(o.clone());
        a.installiere(b"<p>2</p>", &stand(b"<p>2</p>", "2.0.0", 2000)).unwrap();
        fs::write(o.join("aktuell.html"), b"<p>2</p><script>x</script>").unwrap();
        assert!(a.lade().is_none(), "Datei und Stand passen nicht mehr – die beigelegte gilt");
        fs::remove_dir_all(o).unwrap();
    }

    #[test]
    fn abgebrochene_installation_gilt_nicht() {
        let o = ordner("abgebrochen");
        let a = Ablage::neu(o.clone());
        a.installiere(b"<p>2</p>", &stand(b"<p>2</p>", "2.0.0", 2000)).unwrap();
        // Nach dem Verschieben der Datei, vor dem Stand: alte json, neue html
        fs::write(o.join("aktuell.html"), b"<p>3</p>").unwrap();
        assert!(a.lade().is_none());
        fs::remove_dir_all(o).unwrap();
    }

    #[test]
    fn falscher_stand_wird_nicht_abgelegt() {
        let o = ordner("falsch");
        let a = Ablage::neu(o.clone());
        assert!(a.installiere(b"<p>2</p>", &stand(b"<p>anders</p>", "2.0.0", 2000)).is_err());
        assert!(a.lade().is_none());
        let _ = fs::remove_dir_all(o);
    }
}
