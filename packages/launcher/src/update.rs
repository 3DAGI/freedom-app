//! Neue Oberfläche prüfen – in der Hülle selbst (6.1a3a, Entscheidung N2).
//!
//! Die App sucht ein Update über `suchUpdate()` und lädt die Datei; installiert
//! wird sie aber erst, wenn auch die Hülle zustimmt. Sonst könnte eine Lücke in der
//! Oberfläche eine eigene Fassung dauerhaft einsetzen. Die Hülle prüft deshalb selbst:
//!
//! - Belege sind Release-Manifeste (Kind 38054) mit stimmender Kennung (NIP-01) und
//!   gültiger Schnorr-Signatur (BIP-340, `k256`) von vertrauten Schlüsseln.
//! - k verschiedene vertraute Signierer bestätigen dieselbe Version: Versionsangabe
//!   und alle Dateien (Name, Prüfsumme, Größe) gleich; je Signierer zählt sein
//!   neuestes Manifest.
//! - Die Datei ist genau `freedom.html` dieser Version: Größe und SHA-256 stimmen.
//! - Als Zeitpunkt gilt der früheste der Signierer; nur was neuer ist als die
//!   laufende Fassung, darf sie ersetzen.
//!
//! Die Regeln sind dieselben wie in `packages/protocol/src/oberflaeche-update.ts`; die
//! gemeinsamen Prüffälle (`tests/vektoren.json`) halten beide Seiten gleich.
//! Vertraute Signierer und k kommen beim Bauen aus denselben Dateien wie in der App.

use k256::schnorr::{Signature, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

include!(concat!(env!("OUT_DIR"), "/vertrauen.rs"));

/// Die Datei der Oberfläche im Release-Manifest.
pub const DATEI: &str = "freedom.html";
/// Größte Datei – gleich `UPDATE_GRENZEN.bytes` im Protokoll.
pub const MAX_BYTES: u64 = 32 * 1024 * 1024;
/// Mehr Belege prüft die Hülle nicht (je Signierer genügt einer).
pub const MAX_BELEGE: usize = 16;
const KIND_RELEASE_MANIFEST: u32 = 38054;

/// Ein signiertes Nostr-Event, wie es die App übergibt.
#[derive(Debug, Clone, Deserialize)]
pub struct Ereignis {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u32,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

/// Was die Prüfung freigibt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Freigabe {
    pub version: String,
    pub sha256: String,
    pub released_at: u64,
}

/// Warum nicht – als feste Kennung, nie als Text aus den Belegen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fehler {
    KeinBeleg,
    ZuWenig,
    Abweichend,
    NichtNeuer,
    ZuGross,
}

impl Fehler {
    pub fn kennung(self) -> &'static str {
        match self {
            Fehler::KeinBeleg => "kein-beleg",
            Fehler::ZuWenig => "zu-wenig",
            Fehler::Abweichend => "abweichend",
            Fehler::NichtNeuer => "nicht-neuer",
            Fehler::ZuGross => "zu-gross",
        }
    }
}

/// Die vertrauten Signierer aus dem Bau, als Schlüssel.
pub fn vertraute() -> Vec<[u8; 32]> {
    VERTRAUT.iter().filter_map(|s| hex::<32>(s)).collect()
}

/// Hex in kleinen Buchstaben mit genau N Bytes – sonst nichts.
fn hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let b = s.as_bytes();
    if b.len() != 2 * N {
        return None;
    }
    let ziffer = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut aus = [0u8; N];
    for (i, paar) in b.chunks(2).enumerate() {
        aus[i] = ziffer(paar[0])? << 4 | ziffer(paar[1])?;
    }
    Some(aus)
}

pub fn sha256_hex(daten: &[u8]) -> String {
    Sha256::digest(daten).iter().map(|b| format!("{b:02x}")).collect()
}

/// Kennung nach NIP-01 und Signatur nach BIP-340.
pub fn echt(e: &Ereignis) -> bool {
    let (Some(id), Some(pk), Some(sig)) = (hex::<32>(&e.id), hex::<32>(&e.pubkey), hex::<64>(&e.sig)) else {
        return false;
    };
    let Ok(roh) = serde_json::to_string(&(0, &e.pubkey, e.created_at, e.kind, &e.tags, &e.content)) else {
        return false;
    };
    if Sha256::digest(roh.as_bytes()).as_slice() != id {
        return false;
    }
    let (Ok(schluessel), Ok(signatur)) = (VerifyingKey::from_bytes(&pk), Signature::try_from(&sig[..])) else {
        return false;
    };
    schluessel.verify_raw(&id, &signatur).is_ok()
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Artefakt {
    name: String,
    sha256: String,
    groesse: u64,
}

/// Version (Angabe + Dateien) → je Signierer (erstellt, released_at) seines neuesten Manifests.
type Gruppen = BTreeMap<(String, Vec<Artefakt>), BTreeMap<[u8; 32], (u64, u64)>>;

#[derive(Debug, Clone)]
struct Manifest {
    version: String,
    released_at: u64,
    artefakte: Vec<Artefakt>,
}

fn wert<'a>(e: &'a Ereignis, name: &str) -> Option<&'a str> {
    e.tags.iter().find(|t| t.first().map(String::as_str) == Some(name)).and_then(|t| t.get(1)).map(String::as_str)
}

/// Nur Ziffern, ohne führende Null, höchstens 15 Stellen (sicher in JavaScript).
fn zahl(s: &str) -> Option<u64> {
    if s.is_empty() || s.len() > 15 || !s.bytes().all(|b| b.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0')) {
        return None;
    }
    s.parse().ok()
}

/// Wie `parseReleaseManifest()` und `gueltig()` im Protokoll – im Zweifel strenger.
fn lese_manifest(e: &Ereignis) -> Option<Manifest> {
    let version = wert(e, "version")?;
    let version_ok = (1..=32).contains(&version.len())
        && version.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && version.bytes().all(|b| b.is_ascii_alphanumeric() || b"+.-".contains(&b));
    if !version_ok {
        return None;
    }
    let released_at = match wert(e, "released_at") {
        Some(s) => zahl(s)?,
        None => e.created_at,
    };
    if released_at == 0 {
        return None;
    }
    let mut artefakte = Vec::new();
    for t in e.tags.iter().filter(|t| t.first().map(String::as_str) == Some("artifact") && t.len() >= 3) {
        let sha = t[2].to_ascii_lowercase();
        if hex::<32>(&sha).is_none() {
            continue; // wie im Protokoll: ohne gültige Prüfsumme kein Artefakt
        }
        let name = t[1].clone();
        let name_ok = (1..=64).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
        let groesse = t.get(3).and_then(|s| zahl(s)).unwrap_or(0);
        if !name_ok || groesse == 0 || groesse > MAX_BYTES || artefakte.iter().any(|a: &Artefakt| a.name == name) {
            return None;
        }
        artefakte.push(Artefakt { name, sha256: sha, groesse });
    }
    if !artefakte.iter().any(|a| a.name == DATEI) {
        return None;
    }
    artefakte.sort();
    Some(Manifest { version: version.to_string(), released_at, artefakte })
}

/// Darf `html` die laufende Fassung (erschienen `laufend_seit`) ersetzen?
pub fn pruefe(html: &[u8], belege: &[Ereignis], vertraut: &[[u8; 32]], k: usize, laufend_seit: u64) -> Result<Freigabe, Fehler> {
    if belege.is_empty() {
        return Err(Fehler::KeinBeleg);
    }
    if html.len() as u64 > MAX_BYTES {
        return Err(Fehler::ZuGross);
    }
    // Je Version (Angabe + Dateien) und Signierer das neueste Manifest
    let mut gruppen: Gruppen = BTreeMap::new();
    for e in belege.iter().take(MAX_BELEGE) {
        let Some(pk) = hex::<32>(&e.pubkey) else { continue };
        if e.kind != KIND_RELEASE_MANIFEST || !vertraut.contains(&pk) || !echt(e) {
            continue;
        }
        let Some(m) = lese_manifest(e) else { continue };
        let je = gruppen.entry((m.version.clone(), m.artefakte.clone())).or_default();
        if je.get(&pk).is_none_or(|(erstellt, _)| e.created_at > *erstellt) {
            je.insert(pk, (e.created_at, m.released_at));
        }
    }
    let bestaetigt: Vec<_> = gruppen.iter().filter(|(_, je)| je.len() >= k).collect();
    if bestaetigt.is_empty() {
        return Err(Fehler::ZuWenig);
    }
    let sha = sha256_hex(html);
    let Some(((version, artefakte), je)) = bestaetigt.into_iter().find(|((_, a), _)| a.iter().any(|x| x.name == DATEI && x.sha256 == sha)) else {
        return Err(Fehler::Abweichend);
    };
    let datei = artefakte.iter().find(|a| a.name == DATEI).expect("geprüft");
    if datei.groesse != html.len() as u64 {
        return Err(Fehler::Abweichend);
    }
    let zeit = je.values().map(|(_, r)| *r).min().expect("mindestens k");
    if zeit <= laufend_seit {
        return Err(Fehler::NichtNeuer);
    }
    Ok(Freigabe { version: version.clone(), sha256: sha, released_at: zeit })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Vektoren {
        vertraut: Vec<String>,
        k: usize,
        faelle: Vec<Fall>,
    }
    #[derive(Deserialize)]
    struct Fall {
        name: String,
        html: String,
        laufend_seit: u64,
        belege: Vec<Ereignis>,
        erwartet: Erwartet,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "lowercase")]
    enum Erwartet {
        Ok { version: String, released_at: u64 },
        Fehler(String),
    }

    fn vektoren() -> Vektoren {
        serde_json::from_str(include_str!("../tests/vektoren.json")).expect("vektoren.json lesbar")
    }

    #[test]
    fn gemeinsame_prueffaelle_wie_im_protokoll() {
        let v = vektoren();
        let vertraut: Vec<[u8; 32]> = v.vertraut.iter().map(|s| hex::<32>(s).unwrap()).collect();
        assert!(v.faelle.len() >= 10);
        for f in &v.faelle {
            let r = pruefe(f.html.as_bytes(), &f.belege, &vertraut, v.k, f.laufend_seit);
            match &f.erwartet {
                Erwartet::Ok { version, released_at } => {
                    let frei = r.unwrap_or_else(|e| panic!("{}: {}", f.name, e.kennung()));
                    assert_eq!(&frei.version, version, "{}", f.name);
                    assert_eq!(frei.released_at, *released_at, "{}", f.name);
                    assert_eq!(frei.sha256, sha256_hex(f.html.as_bytes()), "{}", f.name);
                }
                Erwartet::Fehler(kennung) => assert_eq!(r.map_err(Fehler::kennung), Err(kennung.as_str()), "{}", f.name),
            }
        }
    }

    #[test]
    fn kennung_nach_nip01_auch_mit_sonderzeichen() {
        // Der Fall mit Steuerzeichen, Anführungszeichen, Emoji und U+2028 in Notiz und Inhalt
        let v = vektoren();
        let f = v.faelle.iter().find(|f| f.name.starts_with("Notizen")).unwrap();
        assert!(f.belege.iter().any(|e| e.content.contains('\u{1}') && e.content.contains('\u{2028}')));
        assert!(f.belege.iter().all(echt));
    }

    #[test]
    fn falsche_signatur_oder_kennung_ist_nicht_echt() {
        let v = vektoren();
        let echt_ = v.faelle[0].belege[0].clone();
        assert!(echt(&echt_));
        let mut e = echt_.clone();
        e.content.push('x');
        assert!(!echt(&e), "Inhalt geändert");
        let mut e = echt_.clone();
        e.sig = v.faelle[0].belege[1].sig.clone();
        assert!(!echt(&e), "Signatur eines anderen Events");
        let mut e = echt_.clone();
        e.id = e.id.to_uppercase();
        assert!(!echt(&e), "Kennung in Großbuchstaben");
        let mut e = echt_;
        e.pubkey = "00".repeat(32);
        assert!(!echt(&e), "kein Punkt auf der Kurve");
    }

    #[test]
    fn hex_nur_klein_und_genau_lang() {
        assert_eq!(hex::<2>("0aff"), Some([0x0a, 0xff]));
        for falsch in ["0AFF", "0af", "0aff00", "0agg", ""] {
            assert_eq!(hex::<2>(falsch), None, "{falsch}");
        }
    }

    #[test]
    fn zahlen_nur_als_ziffern() {
        assert_eq!(zahl("2000"), Some(2000));
        for falsch in ["", "02000", "2e3", " 2000", "-1", "1234567890123456", "0x10"] {
            assert_eq!(zahl(falsch), None, "{falsch}");
        }
    }

    #[test]
    fn zu_grosse_datei_wird_nicht_geprueft() {
        let v = vektoren();
        let gross = vec![b'x'; (MAX_BYTES + 1) as usize];
        let vertraut: Vec<[u8; 32]> = v.vertraut.iter().map(|s| hex::<32>(s).unwrap()).collect();
        assert_eq!(pruefe(&gross, &v.faelle[0].belege, &vertraut, 2, 0), Err(Fehler::ZuGross));
    }

    #[test]
    fn ohne_vertraute_signierer_wird_nichts_installiert() {
        let v = vektoren();
        assert_eq!(pruefe(v.faelle[0].html.as_bytes(), &v.faelle[0].belege, &[], 2, 0), Err(Fehler::ZuWenig));
    }

    #[test]
    fn vertrauen_kommt_aus_der_app() {
        // Seit 6.1a3a liest build.rs TRUSTED_SIGNERS und RELEASE_MIN_SIGNATUREN aus den Quellen der App
        const { assert!(K >= 2) };
        assert_eq!(vertraute().len(), VERTRAUT.len(), "jeder Eintrag ist ein Schlüssel");
        let quelle = include_str!("../../app/src/release-signierer.ts");
        for s in VERTRAUT {
            assert!(quelle.contains(s));
        }
        assert!(include_str!("../../protocol/src/release.ts").contains(&format!("export const RELEASE_MIN_SIGNATUREN = {K};")));
    }
}
