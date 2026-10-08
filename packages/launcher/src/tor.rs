//! Tor in der Hülle (6.1b1a Desktop, 6.1b2a Android; arti, freigegeben 07.10.2026).
//!
//! Mit „Tor“ startet die Hülle einen Zugang auf 127.0.0.1 (Port vom System) und gibt
//! ihn ihrem eigenen Webview als Proxy – so geht der gesamte Verkehr der App
//! (Relays, Solana-RPC, Downloads, .onion) über Tor. Hinter dem Zugang steht arti
//! (`TorClient::connect`). Fällt arti aus, scheitern die Verbindungen – nie geht
//! etwas still direkt hinaus.
//!
//! Der Zugang spricht zwei Sprachen, am ersten Byte erkannt: SOCKS5 (RFC 1928, Desktop)
//! und HTTP CONNECT (RFC 9110, Android – dort setzt die Hülle den Proxy über
//! androidx.webkit, und CONNECT reicht den Namen sicher weiter). Von beiden nur das
//! Nötige: ohne Anmeldung (das Webview kann keine), nur CONNECT, Namen werden nie
//! hier aufgelöst, sondern als Name an Tor gegeben. Eine Grenze für gleichzeitige
//! Verbindungen und eine Frist für den Handschlag halten ihn klein.

use std::future::Future;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;

/// Höchstens so viele Verbindungen gleichzeitig.
pub const MAX_VERBINDUNGEN: usize = 256;
/// So lange darf der Handschlag dauern.
pub const HANDSCHLAG: Duration = Duration::from_secs(10);

/// Wohin eine Verbindung gehen soll – Name (oder Adresse als Text) und Port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ziel {
    pub host: String,
    pub port: u16,
}

/// Ein Datenstrom in beide Richtungen.
pub trait Strom: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Strom for T {}

/// Wie eine Verbindung zum Ziel entsteht – in der Hülle über arti, in Tests eine Attrappe.
pub type Verbinden = Arc<dyn Fn(Ziel) -> Pin<Box<dyn Future<Output = io::Result<Box<dyn Strom>>> + Send>> + Send + Sync>;

/// Antwortcodes nach RFC 1928.
mod code {
    pub const OK: u8 = 0x00;
    pub const FEHLER: u8 = 0x01;
    pub const NICHT_ERREICHBAR: u8 = 0x04;
    pub const BEFEHL: u8 = 0x07;
    pub const ADRESSTYP: u8 = 0x08;
}

fn antwort(c: u8) -> [u8; 10] {
    [5, c, 0, 1, 0, 0, 0, 0, 0, 0]
}

/// Wie der Kunde fragt – SOCKS5 (Desktop) oder HTTP CONNECT (Android).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Art {
    Socks,
    Http,
}

/// Höchstens so lang darf der Kopf einer CONNECT-Anfrage sein.
const HTTP_KOPF_MAX: usize = 8192;

mod http {
    pub const OK: &[u8] = b"HTTP/1.1 200 Connection established\r\n\r\n";
    pub const SCHLECHT: &[u8] = b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
    pub const METHODE: &[u8] = b"HTTP/1.1 405 Method Not Allowed\r\nAllow: CONNECT\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
    pub const FEHLER: &[u8] = b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
}

/// Ein Name, wie er an Tor geht: nur Buchstaben, Ziffern, `.`, `-`, `_`.
fn sauberer_name(n: &str) -> bool {
    !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

/// Der SOCKS5-Handschlag nach dem ersten Byte (der Version): Begrüßung ohne
/// Anmeldung, dann eine CONNECT-Anfrage. `Err(Some(code))` heißt: mit diesem Code
/// antworten, `Err(None)`: einfach schließen.
async fn socks<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> io::Result<Result<Ziel, Option<u8>>> {
    let anzahl = s.read_u8().await?;
    if anzahl == 0 {
        return Ok(Err(None));
    }
    let mut methoden = vec![0u8; anzahl as usize];
    s.read_exact(&mut methoden).await?;
    if !methoden.contains(&0) {
        s.write_all(&[5, 0xFF]).await?;
        return Ok(Err(None));
    }
    s.write_all(&[5, 0]).await?;

    let mut anfrage = [0u8; 4];
    s.read_exact(&mut anfrage).await?;
    if anfrage[0] != 5 {
        return Ok(Err(None));
    }
    let host = match anfrage[3] {
        1 => {
            let mut a = [0u8; 4];
            s.read_exact(&mut a).await?;
            Ipv4Addr::from(a).to_string()
        }
        4 => {
            let mut a = [0u8; 16];
            s.read_exact(&mut a).await?;
            Ipv6Addr::from(a).to_string()
        }
        3 => {
            let mut n = [0u8; 1];
            s.read_exact(&mut n).await?;
            let mut name = vec![0u8; n[0] as usize];
            s.read_exact(&mut name).await?;
            match String::from_utf8(name) {
                Ok(n) if sauberer_name(&n) => n,
                _ => return Ok(Err(Some(code::ADRESSTYP))),
            }
        }
        _ => return Ok(Err(Some(code::ADRESSTYP))),
    };
    let mut port = [0u8; 2];
    s.read_exact(&mut port).await?;
    if anfrage[1] != 1 {
        return Ok(Err(Some(code::BEFEHL)));
    }
    let port = u16::from_be_bytes(port);
    if port == 0 {
        return Ok(Err(Some(code::FEHLER)));
    }
    Ok(Ok(Ziel { host, port }))
}

/// Liest den Kopf einer HTTP-Anfrage bis zur Leerzeile – Byte für Byte, damit
/// nichts von dem, was danach kommt (TLS), hier hängen bleibt.
async fn http_kopf<S: AsyncRead + Unpin>(s: &mut S, erstes: u8) -> io::Result<Option<String>> {
    let mut kopf = vec![erstes];
    while !kopf.ends_with(b"\r\n\r\n") {
        if kopf.len() >= HTTP_KOPF_MAX {
            return Ok(None);
        }
        kopf.push(s.read_u8().await?);
    }
    Ok(String::from_utf8(kopf).ok())
}

/// Das Ziel aus der ersten Zeile `CONNECT host:port HTTP/1.x` – sonst die Antwort, mit der geschlossen wird.
fn lies_connect(kopf: &str) -> Result<Ziel, &'static [u8]> {
    let zeile = kopf.split("\r\n").next().unwrap_or("");
    let mut teile = zeile.split(' ');
    let (Some(methode), Some(ziel), Some(fassung), None) = (teile.next(), teile.next(), teile.next(), teile.next()) else {
        return Err(http::SCHLECHT);
    };
    if !fassung.starts_with("HTTP/1.") {
        return Err(http::SCHLECHT);
    }
    if methode != "CONNECT" {
        return Err(http::METHODE);
    }
    let (host, port) = match ziel.strip_prefix('[') {
        Some(rest) => {
            let (v6, port) = rest.split_once("]:").ok_or(http::SCHLECHT)?;
            (v6.parse::<Ipv6Addr>().map_err(|_| http::SCHLECHT)?.to_string(), port)
        }
        None => {
            let (name, port) = ziel.rsplit_once(':').ok_or(http::SCHLECHT)?;
            if !sauberer_name(name) {
                return Err(http::SCHLECHT);
            }
            (name.to_string(), port)
        }
    };
    if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
        return Err(http::SCHLECHT);
    }
    match port.parse::<u16>() {
        Ok(port) if port != 0 => Ok(Ziel { host, port }),
        _ => Err(http::SCHLECHT),
    }
}

/// Der Handschlag in der Sprache, die das erste Byte nennt.
/// `Err(Some(antwort))` heißt: so antworten und schließen, `Err(None)`: einfach schließen.
async fn handschlag<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> io::Result<Result<(Art, Ziel), Option<Vec<u8>>>> {
    match s.read_u8().await? {
        5 => Ok(socks(s).await?.map(|z| (Art::Socks, z)).map_err(|c| c.map(|c| antwort(c).to_vec()))),
        erstes @ b'A'..=b'Z' => Ok(match http_kopf(s, erstes).await? {
            Some(kopf) => lies_connect(&kopf).map(|z| (Art::Http, z)).map_err(|a| Some(a.to_vec())),
            None => Err(Some(http::SCHLECHT.to_vec())),
        }),
        _ => Ok(Err(None)),
    }
}

/// Eine Verbindung bedienen: Handschlag, Ziel über `verbinden`, dann Daten in beide Richtungen.
pub async fn bediene<S: AsyncRead + AsyncWrite + Unpin>(mut kunde: S, verbinden: Verbinden) -> io::Result<()> {
    let (art, ziel) = match tokio::time::timeout(HANDSCHLAG, handschlag(&mut kunde)).await {
        Ok(Ok(Ok(z))) => z,
        Ok(Ok(Err(Some(a)))) => return kunde.write_all(&a).await,
        Ok(Ok(Err(None))) | Ok(Err(_)) | Err(_) => return Ok(()),
    };
    match verbinden(ziel).await {
        Ok(mut weiter) => {
            let ok = antwort(code::OK);
            kunde.write_all(if art == Art::Socks { &ok } else { http::OK }).await?;
            tokio::io::copy_bidirectional(&mut kunde, &mut weiter).await.map(|_| ())
        }
        Err(e) => match art {
            Art::Socks => {
                let c = if e.kind() == io::ErrorKind::NotFound { code::NICHT_ERREICHBAR } else { code::FEHLER };
                kunde.write_all(&antwort(c)).await
            }
            Art::Http => kunde.write_all(http::FEHLER).await,
        },
    }
}

/// Nimmt Verbindungen an (nur von diesem Rechner) und bedient sie – höchstens `MAX_VERBINDUNGEN` zugleich.
pub async fn diene(lauscher: TcpListener, verbinden: Verbinden) {
    let grenze = Arc::new(Semaphore::new(MAX_VERBINDUNGEN));
    loop {
        let Ok((strom, von)) = lauscher.accept().await else { continue };
        if !von.ip().is_loopback() {
            continue;
        }
        let Ok(erlaubnis) = grenze.clone().try_acquire_owned() else { continue };
        let verbinden = verbinden.clone();
        tokio::spawn(async move {
            let _erlaubnis = erlaubnis;
            let _ = bediene(strom, verbinden).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tokio::io::duplex;

    /// Attrappe: merkt sich jedes Ziel und liefert einen Echo-Strom.
    fn echo(gesehen: Arc<Mutex<Vec<Ziel>>>) -> Verbinden {
        Arc::new(move |z: Ziel| {
            let gesehen = gesehen.clone();
            Box::pin(async move {
                gesehen.lock().unwrap().push(z);
                let (a, mut b) = duplex(1024);
                tokio::spawn(async move {
                    let mut puffer = [0u8; 64];
                    while let Ok(n) = b.read(&mut puffer).await {
                        if n == 0 || b.write_all(&puffer[..n]).await.is_err() {
                            break;
                        }
                    }
                });
                Ok(Box::new(a) as Box<dyn Strom>)
            })
        })
    }

    fn scheitert(art: io::ErrorKind) -> Verbinden {
        Arc::new(move |_z: Ziel| Box::pin(async move { Err::<Box<dyn Strom>, _>(io::Error::from(art)) }))
    }

    async fn sprich(verbinden: Verbinden, senden: &[u8], lesen: usize) -> Vec<u8> {
        let (mut kunde, zugang) = duplex(4096);
        tokio::spawn(bediene(zugang, verbinden));
        kunde.write_all(senden).await.unwrap();
        let mut aus = vec![0u8; lesen];
        let mut n = 0;
        while n < lesen {
            match kunde.read(&mut aus[n..]).await {
                Ok(0) | Err(_) => break,
                Ok(k) => n += k,
            }
        }
        aus.truncate(n);
        aus
    }

    fn connect_name(name: &str, port: u16) -> Vec<u8> {
        let mut v = vec![5, 1, 0, 5, 1, 0, 3, name.len() as u8];
        v.extend_from_slice(name.as_bytes());
        v.extend_from_slice(&port.to_be_bytes());
        v
    }

    #[tokio::test]
    async fn name_geht_als_name_an_tor_und_daten_fliessen() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        let mut senden = connect_name("relay.example.onion", 443);
        senden.extend_from_slice(b"hallo");
        let aus = sprich(echo(gesehen.clone()), &senden, 2 + 10 + 5).await;
        assert_eq!(&aus[..2], &[5, 0], "ohne Anmeldung");
        assert_eq!(&aus[2..12], &antwort(code::OK));
        assert_eq!(&aus[12..], b"hallo");
        assert_eq!(*gesehen.lock().unwrap(), vec![Ziel { host: "relay.example.onion".into(), port: 443 }]);
    }

    #[tokio::test]
    async fn adressen_bleiben_adressen() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        let v4 = [5, 1, 0, 5, 1, 0, 1, 93, 184, 216, 34, 0, 80];
        assert_eq!(&sprich(echo(gesehen.clone()), &v4, 12).await[2..], &antwort(code::OK));
        let mut v6 = vec![5, 1, 0, 5, 1, 0, 4];
        v6.extend_from_slice(&"2001:db8::1".parse::<Ipv6Addr>().unwrap().octets());
        v6.extend_from_slice(&443u16.to_be_bytes());
        assert_eq!(&sprich(echo(gesehen.clone()), &v6, 12).await[2..], &antwort(code::OK));
        let g = gesehen.lock().unwrap();
        assert_eq!(g[0], Ziel { host: "93.184.216.34".into(), port: 80 });
        assert_eq!(g[1], Ziel { host: "2001:db8::1".into(), port: 443 });
    }

    #[tokio::test]
    async fn ohne_methode_ohne_anmeldung_wird_abgelehnt() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        // nur Benutzername/Passwort angeboten
        assert_eq!(sprich(echo(gesehen.clone()), &[5, 1, 2], 4).await, vec![5, 0xFF]);
        // falsche Version: einfach zu
        assert!(sprich(echo(gesehen.clone()), &[4, 1, 0], 4).await.is_empty());
        assert!(gesehen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn nur_connect_und_nur_saubere_namen() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        // BIND (2) und UDP ASSOCIATE (3) gibt es nicht
        for befehl in [2u8, 3] {
            let mut v = connect_name("example.org", 80);
            v[4] = befehl;
            assert_eq!(&sprich(echo(gesehen.clone()), &v, 12).await[2..], &antwort(code::BEFEHL));
        }
        // Name mit Leerzeichen oder Steuerzeichen, leerer Name, unbekannter Adresstyp
        for name in ["a b.org", "x\u{0}.org", ""] {
            assert_eq!(&sprich(echo(gesehen.clone()), &connect_name(name, 80), 12).await[2..], &antwort(code::ADRESSTYP), "{name:?}");
        }
        assert_eq!(&sprich(echo(gesehen.clone()), &[5, 1, 0, 5, 1, 0, 9], 12).await[2..], &antwort(code::ADRESSTYP));
        // Port 0
        assert_eq!(&sprich(echo(gesehen.clone()), &connect_name("example.org", 0), 12).await[2..], &antwort(code::FEHLER));
        assert!(gesehen.lock().unwrap().is_empty(), "nichts davon erreicht Tor");
    }

    #[tokio::test]
    async fn scheitert_tor_scheitert_die_verbindung() {
        let aus = sprich(scheitert(io::ErrorKind::NotFound), &connect_name("example.org", 443), 12).await;
        assert_eq!(&aus[2..], &antwort(code::NICHT_ERREICHBAR));
        let aus = sprich(scheitert(io::ErrorKind::Other), &connect_name("example.org", 443), 12).await;
        assert_eq!(&aus[2..], &antwort(code::FEHLER));
    }

    fn connect_http(ziel: &str) -> Vec<u8> {
        format!("CONNECT {ziel} HTTP/1.1\r\nHost: {ziel}\r\nProxy-Connection: keep-alive\r\n\r\n").into_bytes()
    }

    #[tokio::test]
    async fn http_connect_name_geht_als_name_an_tor_und_daten_fliessen() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        let mut senden = connect_http("relay.example.onion:443");
        senden.extend_from_slice(b"hallo");
        let aus = sprich(echo(gesehen.clone()), &senden, http::OK.len() + 5).await;
        assert_eq!(&aus[..http::OK.len()], http::OK);
        assert_eq!(&aus[http::OK.len()..], b"hallo", "was nach dem Kopf kommt (TLS), geht weiter");
        assert_eq!(*gesehen.lock().unwrap(), vec![Ziel { host: "relay.example.onion".into(), port: 443 }]);
    }

    #[tokio::test]
    async fn http_connect_adressen_bleiben_adressen() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        for ziel in ["93.184.216.34:80", "[2001:db8::1]:443"] {
            assert_eq!(sprich(echo(gesehen.clone()), &connect_http(ziel), http::OK.len()).await, http::OK, "{ziel}");
        }
        let g = gesehen.lock().unwrap();
        assert_eq!(g[0], Ziel { host: "93.184.216.34".into(), port: 80 });
        assert_eq!(g[1], Ziel { host: "2001:db8::1".into(), port: 443 });
    }

    #[tokio::test]
    async fn http_nur_connect_und_nur_saubere_ziele() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        // Andere Methoden leitet der Zugang nie weiter – auch kein GET an eine http-Adresse
        for anfrage in ["GET http://example.org/ HTTP/1.1\r\n\r\n", "POST / HTTP/1.1\r\n\r\n"] {
            assert_eq!(sprich(echo(gesehen.clone()), anfrage.as_bytes(), 200).await, http::METHODE, "{anfrage:?}");
        }
        for anfrage in [
            "CONNECT example.org HTTP/1.1\r\n\r\n",
            "CONNECT example.org:0 HTTP/1.1\r\n\r\n",
            "CONNECT example.org:+443 HTTP/1.1\r\n\r\n",
            "CONNECT example.org:65536 HTTP/1.1\r\n\r\n",
            "CONNECT exa%6dple.org:443 HTTP/1.1\r\n\r\n",
            "CONNECT :443 HTTP/1.1\r\n\r\n",
            "CONNECT [::1:443 HTTP/1.1\r\n\r\n",
            "CONNECT [kein-v6]:443 HTTP/1.1\r\n\r\n",
            "CONNECT a b.org:80 HTTP/1.1\r\n\r\n",
            "CONNECT example.org:443 FTP/1.0\r\n\r\n",
            "CONNECT example.org:443\r\n\r\n",
        ] {
            assert_eq!(sprich(echo(gesehen.clone()), anfrage.as_bytes(), 200).await, http::SCHLECHT, "{anfrage:?}");
        }
        // Ein Kopf ohne Ende wird nicht beliebig lang
        let lang = format!("CONNECT example.org:443 HTTP/1.1\r\nX: {}", "a".repeat(HTTP_KOPF_MAX));
        assert_eq!(sprich(echo(gesehen.clone()), lang.as_bytes(), 200).await, http::SCHLECHT);
        // Weder SOCKS5 noch HTTP (etwa TLS direkt): einfach zu
        assert!(sprich(echo(gesehen.clone()), &[0x16, 3, 1], 10).await.is_empty());
        assert!(gesehen.lock().unwrap().is_empty(), "nichts davon erreicht Tor");
    }

    #[tokio::test]
    async fn http_scheitert_tor_scheitert_die_verbindung() {
        for art in [io::ErrorKind::NotFound, io::ErrorKind::Other] {
            assert_eq!(sprich(scheitert(art), &connect_http("example.org:443"), 200).await, http::FEHLER);
        }
    }

    #[tokio::test]
    async fn ueber_tcp_nur_von_diesem_rechner() {
        let gesehen = Arc::new(Mutex::new(Vec::new()));
        let lauscher = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = lauscher.local_addr().unwrap();
        assert!(adresse.ip().is_loopback());
        tokio::spawn(diene(lauscher, echo(gesehen.clone())));
        let mut s = tokio::net::TcpStream::connect(adresse).await.unwrap();
        let mut senden = connect_name("example.org", 443);
        senden.extend_from_slice(b"ping");
        s.write_all(&senden).await.unwrap();
        let mut aus = [0u8; 16];
        s.read_exact(&mut aus).await.unwrap();
        assert_eq!(&aus[12..], b"ping");
        assert_eq!(gesehen.lock().unwrap()[0].host, "example.org");
    }
}
