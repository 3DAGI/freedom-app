//! Tor in der Desktop-Hülle (6.1b1a, arti; freigegeben 07.10.2026).
//!
//! Mit „Tor“ startet die Hülle einen SOCKS5-Zugang auf 127.0.0.1 (Port vom System)
//! und gibt ihn ihrem eigenen Webview als Proxy (`proxy_url`) – so geht der gesamte
//! Verkehr der App (Relays, Solana-RPC, Downloads, .onion) über Tor. Hinter dem
//! Zugang steht arti (`TorClient::connect`). Fällt arti aus, scheitern die
//! Verbindungen – nie geht etwas still direkt hinaus.
//!
//! Der Zugang spricht nur das Nötige von SOCKS5 (RFC 1928): ohne Anmeldung (das
//! Webview kann keine), nur CONNECT, Namen werden nie hier aufgelöst, sondern als
//! Name an Tor gegeben (Adresstyp 3). Eine Grenze für gleichzeitige Verbindungen
//! und eine Frist für den Handschlag halten ihn klein.

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

/// Der Handschlag: Begrüßung (ohne Anmeldung), dann eine CONNECT-Anfrage.
/// `Err(Some(code))` heißt: mit diesem Code antworten, `Err(None)`: einfach schließen.
async fn handschlag<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> io::Result<Result<Ziel, Option<u8>>> {
    let mut kopf = [0u8; 2];
    s.read_exact(&mut kopf).await?;
    if kopf[0] != 5 || kopf[1] == 0 {
        return Ok(Err(None));
    }
    let mut methoden = vec![0u8; kopf[1] as usize];
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
                Ok(n) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_') => n,
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

/// Eine Verbindung bedienen: Handschlag, Ziel über `verbinden`, dann Daten in beide Richtungen.
pub async fn bediene<S: AsyncRead + AsyncWrite + Unpin>(mut kunde: S, verbinden: Verbinden) -> io::Result<()> {
    let ziel = match tokio::time::timeout(HANDSCHLAG, handschlag(&mut kunde)).await {
        Ok(Ok(Ok(z))) => z,
        Ok(Ok(Err(Some(c)))) => return kunde.write_all(&antwort(c)).await,
        Ok(Ok(Err(None))) | Ok(Err(_)) | Err(_) => return Ok(()),
    };
    match verbinden(ziel).await {
        Ok(mut weiter) => {
            kunde.write_all(&antwort(code::OK)).await?;
            tokio::io::copy_bidirectional(&mut kunde, &mut weiter).await.map(|_| ())
        }
        Err(e) => {
            let c = if e.kind() == io::ErrorKind::NotFound { code::NICHT_ERREICHBAR } else { code::FEHLER };
            kunde.write_all(&antwort(c)).await
        }
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
