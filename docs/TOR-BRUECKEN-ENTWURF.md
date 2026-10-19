# Entwurf: Tor mit Brücken in der Hülle (B-33)

Stand 15.10.2026, Spur B. Sammlung B-33 (Anhang E), Entscheidung PT1 A vom 09.10.2026: „Snowflake
und WebTunnel (obfs4 kommt mit lyrebird)“, Größe und Lizenz der Programme vor dem Einbau nennen.
Dieser Entwurf nennt sie – und einen Befund, der nach `CLAUDE.md` (STOPP: starkes Copyleft) eine
neue Frage braucht: **lyrebird enthält Code unter GPL-3.** Gebaut wird erst nach Freigabe.

## Ausgangslage

- Die Hülle (Desktop seit 6.1b1a, Android seit 6.1b2a) startet Tor über **arti** 0.46.0
  (`netz.rs`) und gibt dem Webview einen Zugang auf 127.0.0.1 (`tor.rs`). Brücken kennt sie nicht:
  Wo Tor gesperrt ist (Iran, Russland, China …), kommt arti nicht ins Netz.
- arti kann Brücken mit Pluggable Transports: Features `bridge-client` und `pt-client`
  (`tor-ptmgr`). Ein Transport ist **verwaltet** (arti startet ein Programm, `path`, `arguments`)
  oder **unverwaltet** (läuft schon auf einem lokalen Port, `proxy_addr`). Die Programme selbst
  bringt arti nicht mit.

## Befunde

Gebaut aus den Quellen über `proxy.golang.org` (Prüfsummen aus `sum.golang.org`), Go 1.24.7,
`CGO_ENABLED=0 -trimpath -ldflags="-s -w"`, linux/amd64; gepackt mit `gzip -9`.

| Programm | Version | Kann | Größe (gepackt) | Lizenz |
|---|---|---|---|---|
| `snowflake-client` | Snowflake 2.14.1 | Snowflake (WebRTC über freiwillige Proxys, Broker über Domain Fronting) | 16,8 MB (6,2 MB) | BSD-3-Clause; alle 56 Abhängigkeiten frei: BSD, MIT, Apache-2.0, CC0, 0BSD |
| WebTunnel-Client (`main/client`) | WebTunnel 0.0.7 | WebTunnel (sieht aus wie HTTPS zu einer Website) | 5,0 MB | MIT; Abhängigkeit goptlib CC0 |
| `lyrebird` | Stand 08.10.2026 (`362a60bb`) | obfs4, WebTunnel, Snowflake (seit 2025 eingebaut), meek | 17,8 MB (6,6 MB) | Datei `LICENSE`: BSD-2-Clause – **aber** `internal/x25519ell2` (Elligator 2, nötig für obfs4) und `transports/meeklite` stehen unter **GPL-3.0-or-later** (`LICENSE-GPL3.txt` im Repository). Das Programm als Ganzes ist damit GPL-3. Paketlisten (Alpine: „BSD-3-Clause“) nennen das nicht. |

Weitere Befunde:

- **Je Plattform** kommen die Programme einmal dazu: Linux x86_64 und arm64, Windows x86_64,
  Android arm64. Variante A (Snowflake + WebTunnel) sind rund 22 MB entpackt, etwa 8,5 MB im Paket.
- **Android:** Programme aus dem App-Ordner zu starten verbietet Android seit API 29 (W^X). Erlaubt
  ist es aus `nativeLibraryDir` – die Programme liegen dann als `lib<name>.so` im APK (so lief
  obfs4proxy früher in Tor Browser für Android). Snowflake baut für `android/arm64` ohne cgo nur mit
  `-ldflags=-checklinkname=0` (die Bibliothek `wlynxg/anet` greift auf Interna von `net` zu) –
  geprüft, 16,9 MB. WebTunnel baut ohne Zusatz (5,2 MB).
- **Brücken-Zeilen:** Snowflake bringt zwei feste Zeilen mit (`client/torrc`, Broker über ein CDN,
  STUN-Server) – dieselben nutzt Tor Browser. WebTunnel-Brücken gibt es nur einzeln
  (bridges.torproject.org, Telegram-Bot, E-Mail); eingebaute gibt es nicht.
- **Prüfen hier nicht möglich:** arti erreicht in dieser Umgebung kein Tor-Netz (wie bei 6.1b1a).
  Live-Proben macht der MENSCH, am besten aus einem Netz mit Sperre.

## Vorschläge

- **V1 – Bauen aus den Quellen in der CI**, nicht herunterladen: Go-Version fest, Module über
  `go.sum` der Projekte geprüft, `-trimpath -buildvcs=false`, ohne cgo – reproduzierbar wie die App
  (5.9a). Prüfsummen in `SHA256SUMS` des Laufs, Lizenztexte neben den Programmen im Paket.
- **V2 – Desktop:** Programme als Beigabe der Hülle (Tauri `externalBin`), arti startet sie als
  verwaltete Transporte. **Android:** als `lib<name>.so` in `jniLibs`, Pfad aus `nativeLibraryDir`
  (JNI wie `android_tor.rs`).
- **V3 – Nur auf Wunsch:** Brücken sind ein Schalter neben „Tor“; ohne ihn bleibt alles wie heute.
  Nie still von Brücke auf direktes Tor oder von Tor auf direkt wechseln.
- **V4 – Eingefügte Zeilen nur geprüft:** Form, Transport aus der Liste, Fingerabdruck 40 Hex,
  Adresse und Parameter ohne Steuerzeichen – sonst lehnt die Hülle ab. Zeilen bleiben im Ordner der
  Hülle, nie im Webview-Speicher.
- **V5 – Ehrliche Texte:** Snowflake ist langsam und braucht WebRTC zu freiwilligen Proxys (die
  sehen die eigene IP, nicht das Ziel); Brücken verbergen, *dass* man Tor nutzt, nicht vor jedem
  Netzbetreiber gleich gut.

## Fragen an den MENSCHEN

| Frage | Optionen | Empfehlung |
|---|---|---|
| **PT2** – Welche Programme? (Befund: lyrebird ist in Teilen GPL-3) | **A** `snowflake-client` und WebTunnel-Client – beide frei lizenziert, kein obfs4 · **B** lyrebird als eigenes Programm neben der Hülle (getrennte Programme, die nur über die PT-Schnittstelle reden, gelten üblicherweise als bloße Zusammenstellung; Pflichten: GPL-Text und Quelltext-Angebot beilegen) – mit obfs4 und meek · **C** eigenes kleines Go-Programm aus Snowflake-Bibliothek und WebTunnel (frei, etwa 17 MB, aber Go-Code im Projekt) | **A** – deckt PT1 A ganz ab (Snowflake und WebTunnel), keine Copyleft-Frage, kein Go-Code bei uns. obfs4 war nur „kommt mit“. |
| **PT3** – Woher kommen Brücken? | **A** Snowflake mit den eingebauten Zeilen, WebTunnel (und weitere Snowflake-Zeilen) zum Einfügen · **B** dazu Moat (Brücken aus der Hülle über den Dienst von BridgeDB holen) | **A** – Moat später, wenn A trägt |

## Entscheidungen vom 18.10.2026 (MENSCH)

PT2 **A** (`snowflake-client` und WebTunnel-Client, kein lyrebird, kein obfs4), PT3 **A** (Snowflake mit den eingebauten Zeilen, WebTunnel und weitere Snowflake-Zeilen zum Einfügen; Moat später). Damit ist B-33 frei; B-33a als Nächstes. Quelle: Entscheidungsvorlage Spur B (Seite „Entscheidungen Spur B“, 18.10.2026), Antworten ohne Notizen.

## Aufteilung (nach Freigabe, Variante A)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-33a ✓ | CI baut `snowflake-client` und WebTunnel-Client je Plattform (V1), Prüfsummen, Lizenzen, Größe im Lauf – `scripts/pt-bauen.sh`, Workflow „Tor-Brücken“ | ~150 |
| B-33b1 ✓ | Hülle Desktop: arti mit `pt-client`, Brücken in der Wahl-Datei, eingebaute Snowflake-Zeilen, Prüfung eingefügter Zeilen (V4), Tests mit Attrappe – `bruecken.rs` | ~300 |
| B-33b2 ✓ | Pakete: `launcher.yml` baut die Programme der eigenen Plattform (`pt-bauen.sh`) und legt sie bei (Tauri `externalBin` als `freedom-snowflake`, `freedom-webtunnel`, Lizenztexte), Prüfung im Paket | ~100 |
| B-33c ✓ | Oberfläche: Schalter „Tor über Brücke“, Zeilen einfügen (auch per QR), ehrliche Texte (V5) | ~200 |
| B-33d | Android: Programme als `lib<name>.so`, Start aus `nativeLibraryDir` | ~150 |

## Stand B-33a (19.10.2026)

- **Bau:** `scripts/pt-bauen.sh` baut beide Programme mit `go install <modul>/<paket>@<version>` – go.mod und go.sum der
  Projekte gelten unverändert, geprüft gegen sum.golang.org. Go 1.24.7 (`GOTOOLCHAIN`), ohne cgo, `-trimpath
  -buildvcs=false`, ohne Build-Id; Snowflake für Android mit `-checklinkname=0`. `--pruefen` baut zweimal an zwei
  Pfaden und vergleicht die Summen – reproduzierbar (lokal und im Workflow „Tor-Brücken“, Artefakt `tor-bruecken`,
  14 Tage).
- **Lizenzen:** Je Plattform liegen in `lizenzen/` die Texte jedes Moduls, das in ein Programm eingeht (`go list -deps`,
  31 Module samt NOTICE-Dateien); fehlt einem Modul der Text, bricht der Bau ab.
- **Größe** (entpackt, mit gzip -9):

| Plattform | `snowflake-client` | WebTunnel-Client |
|---|---|---|
| Linux x86_64 | 16,8 MB (6,2 MB) | 5,0 MB (2,1 MB) |
| Linux arm64 | 15,1 MB (5,6 MB) | 4,8 MB (1,9 MB) |
| Windows x86_64 | 17,2 MB (6,3 MB) | 5,2 MB (2,1 MB) |
| Android arm64 | 16,9 MB (5,9 MB) | 5,2 MB (2,0 MB) |

  Je Paket der Hülle kommen damit rund 22 MB entpackt (etwa 8 MB gepackt) dazu – wie im Entwurf geschätzt.

## Stand B-33b1 (19.10.2026)

- **arti:** Feature `pt-client` (bringt `bridge-client` mit). Neu im Bau ist nur die Crate `tor-ptmgr` 0.46.0 – vom
  Tor-Projekt wie arti, MIT oder Apache-2.0, rund 2400 Zeilen Rust.
- **Hülle:** `bruecken.rs` prüft Zeilen (V4), kennt die eingebauten Snowflake-Zeilen und sucht die Programme neben dem
  eigenen Programm (`freedom-snowflake`, `freedom-webtunnel`). `netz.json` trägt `bruecken` und `zeilen`; `netz_setzen`
  nimmt beides, `netz_stand` nennt `bruecken`, `bruecken_aktiv`, `bruecken_moeglich` und die Zahl der eigenen Zeilen.
  Mit Brücken startet arti nur mit ihnen; fehlt ein Programm oder gilt eine Zeile nicht, gar nicht (`fehler: "bruecke"`).
- **Geprüft:** Ein Test startet arti mit einer Attrappe des Programms – arti startet sie nach der PT-Spezifikation und
  verbindet sich über ihren SOCKS-Zugang mit Adresse und Parametern der Brücke (`url`, `fronts`).
- **Offen:** beilegen (B-33b2), Oberfläche (B-33c), Android (B-33d), Live-Test (MENSCH).

## Stand B-33b2 (19.10.2026)

- **Pakete:** `launcher.yml` baut die Programme einmal aus den Quellen (Job „bruecken“, `pt-bauen.sh`); jeder Job der
  Matrix legt die seiner Plattform über `scripts/pt-beilegen.sh` bei – nur, was `SHA256SUMS` nennt, unverändert, als
  `binaries/freedom-<name>-<ziel-tripel>` für Tauris `externalBin`, dazu die Lizenztexte als Ressource
  (`bruecken-lizenzen/`). Gebaut wird mit `--config tauri.bruecken.conf.json`; danach vergleicht die CI die Programme in
  deb, AppImage und NSIS-Installer Byte für Byte mit dem Bau.
- **Ohne Brücken** baut die Hülle wie bisher (`cargo test`, `cargo build` brauchen die Programme nicht).
- **Gemessen mit dem gebauten deb** (Xvfb, `strace -f -e trace=execve,connect`, `{"tor":true,"bruecken":true}`): die Hülle
  startet `usr/bin/freedom-snowflake` neben sich; hinaus geht nur dieses Programm – DNS-Anfragen an den Resolver des
  Systems (Broker-Front, STUN) –, Hülle, arti und Fenster nur zu 127.0.0.1. Für V5 heißt das: Wer das DNS des Rechners
  sieht, sieht die Namen von CDN und STUN-Servern, nicht Tor – wie beim Tor Browser.
- **Offen:** Oberfläche (B-33c), Android (B-33d), Live-Test (MENSCH, mit einem Paket aus dem Lauf).

## Stand B-33c (19.10.2026)

- **Oberfläche** (Settings › Datenschutz, `shell/netz-huelle.ts`): unter „Tor in dieser App“ der Schalter „Über eine
  Brücke – wo Tor gesperrt ist“ und „Eigene Brücken“, nur wenn die Hülle `brueckenMoeglich` meldet (Desktop mit den
  Programmen). Der Schalter fragt erst (mit Brücke auch Tor, Neustart); eigene Zeilen gehen per Textfeld oder QR-Code
  (auch in der Form von bridges.torproject.org) nur an `netz_setzen` – die App merkt sie nie. Fehler der Hülle
  (`zeile:<stelle>:<kennung>`) zeigt sie als eigenen Text mit Zeilennummer; der Dialog bleibt mit dem Text offen.
- **Texte (V5):** langsamer; Brücken verbergen, dass man Tor nutzt, nicht vor jedem Netzbetreiber gleich gut;
  Snowflake: freiwillige Proxys sehen die IP-Adresse, nicht, was man tut, und der Rechner fragt sein DNS nach CDN und
  STUN-Servern (gemessen in B-33b2); geht die Brücke nicht, geht nichts hinaus.
- **Offen:** Android (B-33d), Live-Test (MENSCH).

## Quellen

- Go-Module: `gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/{snowflake/v2@v2.14.1,
  webtunnel@v0.0.7, lyrebird@v0.0.0-20261008205628-362a60bb4e3f, goptlib@v1.6.0}` über
  `proxy.golang.org` (gitlab.torproject.org ist aus dieser Umgebung gesperrt).
- arti: Features `bridge-client`, `pt-client` von `arti-client` 0.46.0 (crates.io);
  `tor_ptmgr::config::TransportConfig` (`path`, `arguments`, `proxy_addr`).
