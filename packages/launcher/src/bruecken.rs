//! Tor über Brücken (B-33b, Entscheidungen PT2 A, PT3 A, `docs/TOR-BRUECKEN-ENTWURF.md`): Snowflake und
//! WebTunnel. Eingebaut sind nur die Zeilen von Snowflake; eigene Zeilen (WebTunnel, weitere Snowflake) gelten nur
//! nach `pruefe_zeile()` (V4) und liegen nur in `netz.json` bei den Daten der Hülle – nie im Speicher des Webviews.
//! Die Programme (gebaut von `scripts/pt-bauen.sh`) liegen neben der Hülle; arti startet sie selbst (verwaltete
//! Transporte) und schickt jede Verbindung ins Tor-Netz durch sie.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

/// Transporte, die die Hülle kennt, mit dem Namen des beigelegten Programms – eigene Namen, damit ein Paket der
/// Hülle nie mit `snowflake-client` aus dem System zusammenstößt.
pub const TRANSPORTE: [(&str, &str); 2] = [("snowflake", "freedom-snowflake"), ("webtunnel", "freedom-webtunnel")];

/// Höchstens so viele eigene Zeilen, jede höchstens so lang, mit höchstens so vielen Parametern.
pub const ZEILEN_HOECHST: usize = 16;
pub const ZEICHEN_HOECHST: usize = 2048;
const PARAMETER_HOECHST: usize = 16;

/// Snowflake 2.14.1 (`client/torrc`) – dieselben Zeilen wie im Tor Browser. Die Adressen sind Platzhalter, den Weg
/// findet `snowflake-client` über den Broker (`url`, getarnt hinter `fronts`).
pub const SNOWFLAKE_EINGEBAUT: [&str; 2] = [
    "snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://1098762253.rsc.cdn77.org/ fronts=www.cdn77.com,www.phpmyadmin.net ice=stun:stun.antisip.com:3478,stun:stun.epygi.com:3478,stun:stun.uls.co.za:3478,stun:stun.voipgate.com:3478,stun:stun.mixvoip.com:3478,stun:stun.nextcloud.com:3478,stun:stun.bethesda.net:3478,stun:stun.nextcloud.com:443 utls-imitate=hellorandomizedalpn",
    "snowflake 192.0.2.4:80 8838024498816A039FCBBAB14E6F40A0843051FA fingerprint=8838024498816A039FCBBAB14E6F40A0843051FA url=https://1098762253.rsc.cdn77.org/ fronts=www.cdn77.com,www.phpmyadmin.net ice=stun:stun.antisip.com:3478,stun:stun.epygi.com:3478,stun:stun.uls.co.za:3478,stun:stun.voipgate.com:3478,stun:stun.mixvoip.com:3478,stun:stun.nextcloud.com:3478,stun:stun.bethesda.net:3478,stun:stun.nextcloud.com:443 utls-imitate=hellorandomizedalpn",
];

/// Warum eine Zeile nicht gilt – als Kennung für die Oberfläche (`kennung()`), nie mit Text aus der Zeile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZeilenFehler {
    Leer,
    ZuLang,
    ZuViele,
    Zeichen,
    Transport,
    Adresse,
    Fingerabdruck,
    Parameter,
    Arti,
}

impl ZeilenFehler {
    pub fn kennung(self) -> &'static str {
        match self {
            ZeilenFehler::Leer => "leer",
            ZeilenFehler::ZuLang => "zu-lang",
            ZeilenFehler::ZuViele => "zu-viele",
            ZeilenFehler::Zeichen => "zeichen",
            ZeilenFehler::Transport => "transport",
            ZeilenFehler::Adresse => "adresse",
            ZeilenFehler::Fingerabdruck => "fingerabdruck",
            ZeilenFehler::Parameter => "parameter",
            ZeilenFehler::Arti => "arti",
        }
    }
}

/// Eine eingefügte Zeile: `[Bridge] <transport> <adresse:port> <fingerabdruck> [schlüssel=wert …]` – Transport aus
/// `TRANSPORTE`, Adresse als IP mit Port, Fingerabdruck 40 Hex, nur sichtbare ASCII-Zeichen und Leerzeichen. Gibt sie
/// in fester Form zurück (ohne „Bridge“, einfache Leerzeichen), so wie arti sie liest.
pub fn pruefe_zeile(zeile: &str) -> Result<String, ZeilenFehler> {
    let z = zeile.trim();
    if z.is_empty() {
        return Err(ZeilenFehler::Leer);
    }
    if z.len() > ZEICHEN_HOECHST {
        return Err(ZeilenFehler::ZuLang);
    }
    if !z.bytes().all(|b| b == b' ' || b.is_ascii_graphic()) {
        return Err(ZeilenFehler::Zeichen);
    }
    let mut teile = z.split(' ').filter(|t| !t.is_empty()).peekable();
    if teile.peek().is_some_and(|t| t.eq_ignore_ascii_case("bridge")) {
        teile.next();
    }
    let transport = teile.next().ok_or(ZeilenFehler::Leer)?;
    if !TRANSPORTE.iter().any(|(t, _)| *t == transport) {
        return Err(ZeilenFehler::Transport);
    }
    let adresse = teile.next().ok_or(ZeilenFehler::Adresse)?;
    adresse.parse::<SocketAddr>().map_err(|_| ZeilenFehler::Adresse)?;
    let fingerabdruck = teile.next().ok_or(ZeilenFehler::Fingerabdruck)?;
    if fingerabdruck.len() != 40 || !fingerabdruck.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ZeilenFehler::Fingerabdruck);
    }
    let parameter: Vec<&str> = teile.collect();
    let gut = |p: &&str| {
        p.split_once('=').is_some_and(|(k, v)| !k.is_empty() && !v.is_empty() && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
    };
    if parameter.len() > PARAMETER_HOECHST || !parameter.iter().all(gut) {
        return Err(ZeilenFehler::Parameter);
    }
    let fest = [transport, adresse, fingerabdruck].into_iter().chain(parameter).collect::<Vec<_>>().join(" ");
    #[cfg(any(desktop, target_os = "android"))]
    fest.parse::<arti_client::config::BridgeConfigBuilder>().map_err(|_| ZeilenFehler::Arti)?;
    Ok(fest)
}

/// Eigene Zeilen prüfen – alle oder keine; der Fehler nennt die Stelle (ab 0).
pub fn pruefe_zeilen(zeilen: &[String]) -> Result<Vec<String>, (usize, ZeilenFehler)> {
    if zeilen.len() > ZEILEN_HOECHST {
        return Err((ZEILEN_HOECHST, ZeilenFehler::ZuViele));
    }
    zeilen.iter().enumerate().map(|(i, z)| pruefe_zeile(z).map_err(|f| (i, f))).collect()
}

/// Die Zeilen dieser Sitzung: die eigenen, sonst die eingebauten von Snowflake.
pub fn zeilen_fuer(eigene: &[String]) -> Result<Vec<String>, (usize, ZeilenFehler)> {
    if eigene.is_empty() {
        Ok(SNOWFLAKE_EINGEBAUT.iter().map(|z| z.to_string()).collect())
    } else {
        pruefe_zeilen(eigene)
    }
}

/// Der Dateiname eines Programms: Desktop wie in `TRANSPORTE`, unter Android als Bibliothek
/// (`libfreedom_snowflake.so`) – nur so legt Android es beim Installieren in `nativeLibraryDir`, und nur
/// von dort darf eine App ein Programm starten (B-33d, `docs/TOR-BRUECKEN-ENTWURF.md` V2).
pub fn dateiname(name: &str, android: bool) -> String {
    if android {
        format!("lib{}.so", name.replace('-', "_"))
    } else {
        format!("{name}{}", std::env::consts::EXE_SUFFIX)
    }
}

/// Das Programm eines Transports in diesem Ordner – nur eine Datei mit dem festen Namen.
pub fn programm_in(ordner: &Path, transport: &str, android: bool) -> Option<PathBuf> {
    let (_, name) = TRANSPORTE.iter().find(|(t, _)| *t == transport)?;
    let pfad = ordner.join(dateiname(name, android));
    pfad.is_file().then_some(pfad)
}

/// Der Ordner, aus dem Android die eigene Bibliothek der Hülle geladen hat (`nativeLibraryDir`), aus
/// `/proc/self/maps` – ohne JNI, also schon beim Start von Tor, vor dem Fenster. Liegt die Bibliothek
/// nur im APK (`base.apk!/lib/…`, nicht entpackt), gibt es keinen Ordner: dann auch keine Brücken.
pub fn bibliotheksordner(maps: &str) -> Option<PathBuf> {
    maps.lines().find_map(|zeile| {
        let pfad = zeile.split_whitespace().nth(5)?;
        (pfad.starts_with('/') && !pfad.contains('!') && pfad.ends_with("/libfreedom_launcher_lib.so"))
            .then(|| Path::new(pfad).parent().map(Path::to_path_buf))
            .flatten()
    })
}

/// Das Programm neben der Hülle: Desktop neben dem eigenen Programm (Tauri legt Beigaben dorthin),
/// Android im Ordner der eigenen Bibliothek.
pub fn programm(transport: &str) -> Option<PathBuf> {
    if cfg!(target_os = "android") {
        let maps = std::fs::read_to_string("/proc/self/maps").ok()?;
        return programm_in(&bibliotheksordner(&maps)?, transport, true);
    }
    programm_in(std::env::current_exe().ok()?.parent()?, transport, false)
}

/// Brücken gehen nur, wenn alle Programme beiliegen.
pub fn moeglich() -> bool {
    TRANSPORTE.iter().all(|(t, _)| programm(t).is_some())
}

/// Trägt die Brücken in die Einstellungen von arti ein – nur mit Brücken, nie direkt ins Tor-Netz. Je genutztem
/// Transport ein verwaltetes Programm; fehlt eines, gilt nichts (die Hülle startet arti dann nicht).
#[cfg(any(desktop, target_os = "android"))]
pub fn konfiguriere(
    cfg: &mut arti_client::config::TorClientConfigBuilder,
    zeilen: &[String],
    programm: impl Fn(&str) -> Option<PathBuf>,
) -> Result<(), ()> {
    use arti_client::config::pt::TransportConfigBuilder;
    use arti_client::config::{BoolOrAuto, BridgeConfigBuilder, CfgPath};
    if zeilen.is_empty() {
        return Err(());
    }
    let mut genutzt: Vec<&str> = Vec::new();
    for z in zeilen {
        let bruecke: BridgeConfigBuilder = z.parse().map_err(|_| ())?;
        let transport = z.split(' ').next().unwrap_or_default();
        if !genutzt.contains(&transport) {
            genutzt.push(transport);
        }
        cfg.bridges().bridges().push(bruecke);
    }
    for transport in genutzt {
        let pfad = programm(transport).ok_or(())?;
        let mut t = TransportConfigBuilder::default();
        t.protocols(vec![transport.parse().map_err(|_| ())?]).path(CfgPath::new_literal(pfad));
        cfg.bridges().transports().push(t);
    }
    cfg.bridges().enabled(BoolOrAuto::Explicit(true));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WEBTUNNEL: &str = "webtunnel [2001:db8:3b2c:1a7e:58f2:b9a1:6e3d:c004]:443 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF01 url=https://bruecke.example.org/a1b2c3 ver=0.0.1";

    #[test]
    fn eingebaute_zeilen_sind_gueltig_und_in_fester_form() {
        for z in SNOWFLAKE_EINGEBAUT {
            assert_eq!(pruefe_zeile(z).as_deref(), Ok(z));
        }
        assert_eq!(zeilen_fuer(&[]).unwrap(), SNOWFLAKE_EINGEBAUT.to_vec(), "ohne eigene Zeilen: Snowflake");
    }

    #[test]
    fn eingebaute_zeilen_gehoeren_zur_gebauten_fassung() {
        let skript = include_str!("../../../scripts/pt-bauen.sh");
        assert!(skript.contains("snowflake/v2@v2.14.1"), "neue Snowflake-Fassung: die Zeilen aus deren client/torrc übernehmen");
    }

    #[test]
    fn eingefuegte_zeilen_werden_geprueft() {
        let mit_bridge = format!("  Bridge   {WEBTUNNEL}\r\n");
        assert_eq!(pruefe_zeile(&mit_bridge).as_deref(), Ok(WEBTUNNEL), "„Bridge“, Leerzeichen und Zeilenende fallen weg");
        let falsch = |z: &str| pruefe_zeile(z).unwrap_err();
        assert_eq!(falsch("   "), ZeilenFehler::Leer);
        assert_eq!(falsch("Bridge"), ZeilenFehler::Leer);
        assert_eq!(falsch(&format!("{WEBTUNNEL} x={}", "a".repeat(ZEICHEN_HOECHST))), ZeilenFehler::ZuLang);
        assert_eq!(falsch(&WEBTUNNEL.replace(' ', "\t")), ZeilenFehler::Zeichen, "Tabulator ist ein Steuerzeichen");
        assert_eq!(falsch(&format!("{WEBTUNNEL} x=ä")), ZeilenFehler::Zeichen);
        assert_eq!(falsch(&format!("{WEBTUNNEL} x=a\u{7}")), ZeilenFehler::Zeichen);
        assert_eq!(falsch(&WEBTUNNEL.replace("webtunnel", "obfs4")), ZeilenFehler::Transport, "obfs4 bringt die Hülle nicht mit (PT2 A)");
        assert_eq!(falsch(&WEBTUNNEL.replace("webtunnel", "WebTunnel")), ZeilenFehler::Transport);
        assert_eq!(falsch("192.0.2.3:443 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF01"), ZeilenFehler::Transport, "ohne Transport: direkt – nie");
        assert_eq!(falsch("webtunnel bruecke.example.org:443 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF01"), ZeilenFehler::Adresse);
        assert_eq!(falsch("webtunnel 192.0.2.3 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF01"), ZeilenFehler::Adresse);
        assert_eq!(falsch("webtunnel 192.0.2.3:443"), ZeilenFehler::Fingerabdruck);
        assert_eq!(falsch("webtunnel 192.0.2.3:443 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF0"), ZeilenFehler::Fingerabdruck);
        assert_eq!(falsch("webtunnel 192.0.2.3:443 G04AA0C0F1E2D3C4B5A6978869504132ABCDEF01"), ZeilenFehler::Fingerabdruck);
        assert_eq!(falsch(&format!("{WEBTUNNEL} ohne-wert")), ZeilenFehler::Parameter);
        assert_eq!(falsch(&format!("{WEBTUNNEL} =a")), ZeilenFehler::Parameter);
        assert_eq!(falsch(&format!("{WEBTUNNEL} x=")), ZeilenFehler::Parameter);
        assert_eq!(falsch(&format!("{WEBTUNNEL} a;b=c")), ZeilenFehler::Parameter, "Schlüssel nur aus Buchstaben, Ziffern, - und _");
        let viele = (0..=PARAMETER_HOECHST).map(|i| format!("p{i}=1")).collect::<Vec<_>>().join(" ");
        assert_eq!(falsch(&format!("webtunnel 192.0.2.3:443 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF01 {viele}")), ZeilenFehler::Parameter);
    }

    #[test]
    fn alle_oder_keine_und_hoechstens_sechzehn() {
        let gut = vec![WEBTUNNEL.to_string(), SNOWFLAKE_EINGEBAUT[0].to_string()];
        assert_eq!(pruefe_zeilen(&gut).unwrap().len(), 2);
        let schlecht = vec![WEBTUNNEL.to_string(), "webtunnel kaputt".to_string()];
        assert_eq!(pruefe_zeilen(&schlecht), Err((1, ZeilenFehler::Adresse)));
        assert_eq!(zeilen_fuer(&schlecht), Err((1, ZeilenFehler::Adresse)), "kaputte eigene Zeilen: nie still Snowflake");
        let zu_viele = vec![WEBTUNNEL.to_string(); ZEILEN_HOECHST + 1];
        assert_eq!(pruefe_zeilen(&zu_viele), Err((ZEILEN_HOECHST, ZeilenFehler::ZuViele)));
        assert_eq!(ZeilenFehler::Fingerabdruck.kennung(), "fingerabdruck");
    }

    #[test]
    fn die_pakete_legen_genau_diese_programme_bei() {
        let cfg: serde_json::Value = serde_json::from_str(include_str!("../tauri.bruecken.conf.json")).unwrap();
        let beigelegt: Vec<&str> = cfg["bundle"]["externalBin"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        let erwartet: Vec<String> = TRANSPORTE.iter().map(|(_, name)| format!("binaries/{name}")).collect();
        assert_eq!(beigelegt, erwartet, "tauri.bruecken.conf.json und TRANSPORTE nennen dieselben Programme");
        let skript = include_str!("../../../scripts/pt-beilegen.sh");
        assert!(skript.contains("binaries/freedom-$n-$TRIPEL$ENDUNG") && skript.contains("for n in snowflake webtunnel"));
        assert!(skript.contains("jniLibs/arm64-v8a/libfreedom_$n.so"), "Android: dieselben Namen wie dateiname()");
        assert!(include_str!("../../../scripts/android-bruecken.py").contains(r#"["libfreedom_snowflake.so", "libfreedom_webtunnel.so"]"#));
        assert_eq!(TRANSPORTE.iter().map(|(_, n)| dateiname(n, true)).collect::<Vec<_>>(), ["libfreedom_snowflake.so", "libfreedom_webtunnel.so"]);
    }

    #[test]
    fn android_programme_mit_demselben_ndk_wie_das_apk() {
        // cgo unter Android (DNS) – die Programme und das APK bauen gegen dieselbe Fassung des NDK
        let skript = include_str!("../../../scripts/pt-bauen.sh");
        let fassung = skript.lines().find_map(|z| z.strip_prefix("NDK_FASSUNG=")).expect("NDK_FASSUNG fehlt in pt-bauen.sh");
        assert!(include_str!("../../../.github/workflows/launcher.yml").contains(&format!("NDK_VERSION: \"{fassung}\"")));
        assert!(include_str!("../../../.github/workflows/tor-bruecken.yml").contains(&format!("\"ndk;{fassung}\"")));
        assert!(skript.contains("CGO_ENABLED=1 CC=$NDK/") && skript.contains("max-page-size=16384"));
    }

    #[test]
    fn programme_nur_mit_festem_namen_im_ordner() {
        let o = std::env::temp_dir().join(format!("freedom-bruecken-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&o);
        std::fs::create_dir_all(o.join(format!("freedom-webtunnel{}", std::env::consts::EXE_SUFFIX))).unwrap();
        assert_eq!(programm_in(&o, "snowflake", false), None);
        assert_eq!(programm_in(&o, "webtunnel", false), None, "ein Ordner ist kein Programm");
        let p = o.join(format!("freedom-snowflake{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&p, b"").unwrap();
        assert_eq!(programm_in(&o, "snowflake", false), Some(p));
        assert_eq!(programm_in(&o, "obfs4", false), None);
        assert_eq!(programm_in(&o, "snowflake", true), None, "Android sucht nur den Namen als Bibliothek");
        let a = o.join("libfreedom_snowflake.so");
        std::fs::write(&a, b"").unwrap();
        assert_eq!(programm_in(&o, "snowflake", true), Some(a));
        std::fs::remove_dir_all(&o).unwrap();
    }

    #[test]
    fn android_namen_und_ordner_der_eigenen_bibliothek() {
        assert_eq!(dateiname("freedom-snowflake", true), "libfreedom_snowflake.so");
        assert_eq!(dateiname("freedom-webtunnel", true), "libfreedom_webtunnel.so");
        let lib = "/data/app/~~x==/io.github.threedagi.freedom-y==/lib/arm64";
        let maps = format!(
            "6f00000000-6f00010000 r--p 00000000 fd:05 123 /system/lib64/libc.so\n\
             7a00000000-7a00100000 r-xp 00000000 fd:05 456 {lib}/libfreedom_launcher_lib.so\n\
             7b00000000-7b00001000 rw-p 00000000 00:00 0\n"
        );
        assert_eq!(bibliotheksordner(&maps), Some(PathBuf::from(lib)));
        let im_apk = "7a00000000-7a00100000 r-xp 00000000 fd:05 456 /data/app/x/base.apk!/lib/arm64-v8a/libfreedom_launcher_lib.so\n";
        assert_eq!(bibliotheksordner(im_apk), None, "nicht entpackt: kein Ordner, keine Brücken");
        assert_eq!(bibliotheksordner("7a00000000-7a00100000 r-xp 00000000 fd:05 456 /x/libfreedom_launcher_lib.so.alt\n"), None);
        assert_eq!(bibliotheksordner(""), None);
    }

    #[cfg(desktop)]
    #[test]
    fn arti_nimmt_brueckenzeilen_und_programme_an() {
        use arti_client::config::TorClientConfigBuilder;
        let o = std::env::temp_dir().join(format!("freedom-bruecken-cfg-{}", std::process::id()));
        let neu = || TorClientConfigBuilder::from_directories(o.join("zustand"), o.join("cache"));
        let da = |t: &str| Some(PathBuf::from(format!("/opt/freedom/{t}")));
        let mut cfg = neu();
        konfiguriere(&mut cfg, &zeilen_fuer(&[]).unwrap(), da).unwrap();
        cfg.build().expect("eingebaute Snowflake-Zeilen");
        let mut cfg = neu();
        konfiguriere(&mut cfg, &[WEBTUNNEL.to_string(), SNOWFLAKE_EINGEBAUT[1].to_string()], da).unwrap();
        cfg.build().expect("WebTunnel und Snowflake");
        // Fehlt das Programm eines genutzten Transports oder gibt es keine Zeilen, gilt nichts
        assert_eq!(konfiguriere(&mut neu(), &[WEBTUNNEL.to_string()], |t| (t == "snowflake").then(|| PathBuf::from("/x"))), Err(()));
        assert_eq!(konfiguriere(&mut neu(), &[], da), Err(()));
    }

    /// Eine Attrappe von `freedom-snowflake`: meldet sich nach der PT-Spezifikation und zeigt auf den Port des Tests –
    /// dort muss arti ankommen, mit Adresse und Parametern der Brücke.
    #[cfg(all(desktop, unix))]
    #[test]
    fn arti_startet_das_programm_und_geht_durch_die_bruecke() {
        use arti_client::config::TorClientConfigBuilder;
        use arti_client::{TorClient, TorClientConfig};
        use std::os::unix::fs::PermissionsExt;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let o = std::env::temp_dir().join(format!("freedom-bruecken-pt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&o);
        std::fs::create_dir_all(&o).unwrap();
        tauri::async_runtime::block_on(async move {
            let socks = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = socks.local_addr().unwrap().port();
            let skript = o.join("freedom-snowflake");
            std::fs::write(
                &skript,
                format!(
                    "#!/bin/sh\nprintf '%s %s\\n' \"$TOR_PT_MANAGED_TRANSPORT_VER\" \"$TOR_PT_CLIENT_TRANSPORTS\" > \"$0.umgebung\"\n\
                     echo 'VERSION 1'\necho 'CMETHOD snowflake socks5 127.0.0.1:{port}'\necho 'CMETHODS DONE'\n\
                     while kill -0 \"$PPID\" 2>/dev/null; do sleep 1; done\n"
                ),
            )
            .unwrap();
            std::fs::set_permissions(&skript, std::fs::Permissions::from_mode(0o755)).unwrap();
            let mut cfg = TorClientConfigBuilder::from_directories(o.join("zustand"), o.join("cache"));
            cfg.storage().permissions().dangerously_trust_everyone(); // Ordner unter /tmp
            let s = skript.clone();
            konfiguriere(&mut cfg, &zeilen_fuer(&[]).unwrap(), move |t| (t == "snowflake").then(|| s.clone())).unwrap();
            let cfg: TorClientConfig = cfg.build().unwrap();
            let client = TorClient::builder().config(cfg).create_unbootstrapped().unwrap();
            let c = client.clone();
            tauri::async_runtime::spawn(async move { c.bootstrap().await });
            let (mut v, _) = tokio::time::timeout(std::time::Duration::from_secs(60), socks.accept()).await.expect("arti kommt nicht").unwrap();
            // SOCKS5 mit Anmeldung: darin stehen die Parameter der Zeile (PT-Spezifikation, Abschnitt 3.5)
            let mut kopf = [0u8; 2];
            v.read_exact(&mut kopf).await.unwrap();
            let mut methoden = vec![0u8; kopf[1] as usize];
            v.read_exact(&mut methoden).await.unwrap();
            assert_eq!(kopf[0], 5);
            assert!(methoden.contains(&2), "Parameter brauchen die Anmeldung mit Name und Kennwort");
            v.write_all(&[5, 2]).await.unwrap();
            let mut l = [0u8; 2];
            v.read_exact(&mut l).await.unwrap();
            let mut name = vec![0u8; l[1] as usize];
            v.read_exact(&mut name).await.unwrap();
            let mut pl = [0u8; 1];
            v.read_exact(&mut pl).await.unwrap();
            let mut kennwort = vec![0u8; pl[0] as usize];
            v.read_exact(&mut kennwort).await.unwrap();
            v.write_all(&[1, 0]).await.unwrap();
            let parameter = String::from_utf8([name, kennwort].concat()).unwrap();
            assert!(parameter.contains("url=https://1098762253.rsc.cdn77.org/"), "{parameter}");
            assert!(parameter.contains("fronts=www.cdn77.com,www.phpmyadmin.net"), "{parameter}");
            let mut anfrage = [0u8; 10];
            v.read_exact(&mut anfrage).await.unwrap();
            assert_eq!(anfrage[..4], [5, 1, 0, 1], "CONNECT an eine IPv4-Adresse");
            let ziel = (std::net::Ipv4Addr::new(anfrage[4], anfrage[5], anfrage[6], anfrage[7]), u16::from_be_bytes([anfrage[8], anfrage[9]]));
            assert!(ziel == ("192.0.2.3".parse().unwrap(), 80) || ziel == ("192.0.2.4".parse().unwrap(), 80), "{ziel:?}");
            let umgebung = std::fs::read_to_string(o.join("freedom-snowflake.umgebung")).unwrap();
            assert_eq!(umgebung.trim(), "1 snowflake");
            drop(client);
        });
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join(format!("freedom-bruecken-pt-{}", std::process::id())));
    }
}
