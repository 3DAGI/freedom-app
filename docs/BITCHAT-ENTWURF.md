# Entwurf: Bitchat in der Android-Hülle (B-36)

Stand 23.10.2026, Spur B. Sammlung B-36 (Anhang E): „Bitchat-Protokoll (Bluetooth-Mesh) in der
Android-Hülle: Handy zu Handy ohne Funkgerät, verbunden mit bestehenden Bitchat-Nutzern, Nostr als
Brücke – statt Briar.“ BC1 stand seit 09.10. auf B („erst nach einem Audit“); **am 23.10.2026 hat der
MENSCH auf A umgestellt** („ja, nach B-32, mit Grenze im Datenschutzbericht“). B-32 ist seit B-32d3b
fertig. Dieser Entwurf hält fest, was Bitchat heute ist und wie Freedom es nutzen würde. Er stellt vier
Fragen (BC-W1 bis BC-W4); gebaut wird erst nach Freigabe.

## Ausgangslage

- **Funk heute:** Meshtastic (7.5) und Reticulum mit RNode (B-32) brauchen ein LoRa-Gerät. Ohne Gerät
  bleibt nur die Datei (7.1).
- **Bitchat** verbindet Handys direkt über Bluetooth Low Energy (BLE): Jedes Gerät ist zugleich
  Central und Peripheral, Pakete werden kontrolliert geflutet (TTL 7), private Nachrichten laufen in
  Noise-Sitzungen. Gibt es Internet, geht es über Nostr weiter.
- **Die App im Browser kann das nicht:** Web Bluetooth kann nur Central sein, nie Peripheral (kein
  GATT-Server), und die WebView unter Android hat gar kein Web Bluetooth. Es geht nur in der
  Android-Hülle (6.1c1) mit eigenem Code für BLE.

## Befunde

| Punkt | Befund | Quelle |
|---|---|---|
| Lizenz iOS/macOS und Protokoll | **Gemeinfrei** (Unlicense) – Code und Whitepaper | `permissionlesstech/bitchat`, `LICENSE`, Stand 24.09.2026 (`5e9287f`) |
| Lizenz Android | **GPL-3.0 seit 28.02.2026** (vorher MIT; die README sagt noch „public domain“). Übernommener Code zöge die Hülle unter die GPL – STOPP-Regel. Die letzte MIT-Fassung ist acht Monate alt, ohne die Korrekturen seitdem | `permissionlesstech/bitchat-android`, Commit `fb2bb64` („change license from MIT to GPLv3“) |
| Audit | Im Januar 2026 hat Jack Dorsey eine Prüfung durch eine externe Firma gemeldet, Funde behoben. Bericht und Prüfer sind nicht veröffentlicht; im Repository steht dazu nichts. Die Lücke von Alex Radocea (Juli 2025: fremder Schlüssel als „Favorit“) ist laut 1.7.1 behoben (Noise-Sitzung an die Identität gebunden, Signierschlüssel beim ersten Kontakt festgehalten) | Altcoin Buzz 01/2026, Trail of Bits 07/2025, Release 1.7.1 |
| Kennung im Funk | Die Peer-ID (8 Byte) ist **fest**: SHA-256 des Noise-Schlüssels, gleich über Neustarts. Die Ankündigung trägt Name, Noise- und Signierschlüssel offen und bis zu zehn Nachbarn. Wer mithört, verfolgt ein Gerät über Orte und sieht, wer bei wem stand. Wechselnde Kennungen sind entworfen, aber nicht in Betrieb | `WHITEPAPER.md` §3, §8; `docs/PEER-ID-ROTATION.md` („nothing is wired into the shipping mesh“) |
| Dass Bitchat läuft | Ist nicht zu verbergen: feste Service-UUID im Klartext, ein Merkmal mit fester UUID | `docs/SERVICE-UUID-DETECTABILITY.md` |
| Weiterreichen | Gerichtete Pakete (`noiseEncrypted` 0x11 mit Empfänger, Handshakes, gerichtete Fragmente) reichen Bitchat-Geräte **immer** weiter, ohne Inhalt zu sehen (TTL − 1, 20–60 ms Versatz) | `RelayController.swift`, `BLEReceivePipeline.swift` |
| Nostr über das Mesh | Pakettyp `nostrCarrier` (0x28) trägt signierte Nostr-Events zu einem Gateway – aber nur öffentliche Geohash-Events (Kind 20000 mit `g`-Tag). Unsere Umschläge (1059) nimmt kein Bitchat-Gateway | `NostrCarrierPacket.swift`, `GatewayService.swift` |
| Nostr-Weg von Bitchat | Eigenes Format mit den Nummern von NIP-17/59, aber **nicht** NIP-17/44/59-kompatibel – nur Bitchat liest es | `WHITEPAPER.md` §5.3 |
| Paketgröße | Fragmente zu ~469 Byte, ganze Nachricht bis 1 MiB; Noise-Rahmen auf 256/512/1024/2048 Byte aufgefüllt, andere Typen nicht | `WHITEPAPER.md` §4.1, §4.4 |

**Ergebnis:** Bitchat-Code können wir für Android nicht übernehmen (GPL). Was trägt, ist das
**Protokoll**: gemeinfrei und gut beschrieben, mit Tests im Swift-Code, aus denen sich Vektoren
gewinnen lassen. Über Bitchat-Geräte hinweg erreichen sich Freedom-Geräte nur gerichtet – über
Noise-Sitzungen, die Bitchat ungelesen weiterreicht.

## Vorschläge

- **V1 – Eigene Umsetzung des Protokolls in der Hülle**, nach Whitepaper und gemeinfreiem Swift-Code:
  Paketformat, Fragmente, Fluten mit Doppel-Erkennung und TTL, Ankündigung, Noise `XX`
  (Curve25519, ChaCha20-Poly1305, SHA-256) in Rust; BLE (Central, Peripheral, MTU, Scannen) in Kotlin,
  beim Bau ins erzeugte Android-Projekt gelegt (wie die Brücken in B-33d). Vektoren aus den Tests des
  Swift-Codes, festgehalten mit Commit und Prüfsumme. Kein Code aus `bitchat-android`.
- **V2 – Nur Umschläge, nur zwischen Freedom-Geräten:** Über Bitchat geht, was durch
  `pruefeMeshInhalt()` geht (Umschläge 1059, signierte Solana-Transaktionen), und nur in einer
  Noise-Sitzung mit einem Freedom-Gerät, als eigener Nutzlast-Typ. Bitchat-Geräte dazwischen reichen
  weiter; Freedom reicht ihre Pakete ebenso weiter (sonst trüge Freedom nichts zum Netz bei). Kein
  öffentlicher Chat im Klartext (BC-W2).
- **V3 – Freedom-Geräte finden sich über Kontakte:** Wie die Reticulum-Adresse (B-32c1, Kind 38082)
  geht der Noise-Schlüssel des Geräts nur versiegelt an Kontakte, nur mit Zustimmung. Kein eigenes
  Merkmal in der Ankündigung – das verriete jedem im Funk „hier läuft Freedom“ und könnte mit künftigen
  Bitchat-Bits kollidieren (BC-W3).
- **V4 – Eigene Identität je Gerät** (wie RN2 A): nie aus dem Nostr-Schlüssel abgeleitet, im Tresor;
  der Name in der Ankündigung leer bzw. neutral. Die feste Kennung, die offenen Schlüssel und die
  Nachbarliste kommen als Grenze „bitchat“ in den Datenschutzbericht (BC-W4).
- **V5 – Ehrliche Texte:** App und Bericht sagen nicht „auditiert“, solange kein Bericht öffentlich ist.
  Geschützt sind unsere Inhalte durch die Umschläge, nicht durch Bitchat.

## Fragen an den MENSCHEN

| Frage | A (Empfehlung) | B | C |
|---|---|---|---|
| **BC-W1** Umsetzung | Eigene Umsetzung nach Whitepaper und gemeinfreiem Swift-Code (Rust + Kotlin), Vektoren aus dessen Tests | `bitchat-android` in der letzten MIT-Fassung (27.02.2026) übernehmen – veraltet, ohne Korrekturen seitdem | Eigenes BLE-Format ohne Bitchat – keine Verbindung zu Bitchat-Geräten |
| **BC-W2** Was geht über Bitchat | Nur Umschläge zwischen Freedom-Geräten, in Noise-Sitzungen; Bitchat-Pakete reicht Freedom weiter | Dazu Chat mit Bitchat-Nutzern (privat über Noise, öffentlich im Klartext) – öffentlicher Chat bräche „Mesh nur verschlüsselt“ | – |
| **BC-W3** Wie sich Freedom-Geräte finden | Schlüssel versiegelt an Kontakte, mit Zustimmung (wie 38082) | Eigenes Bit in der Ankündigung – jeder im Funk sieht „Freedom“ | – |
| **BC-W4** Identität im Funk | Eine je Gerät, im Tresor; Grenze im Bericht | Neu bei jedem Start – nicht über Tage verfolgbar, aber Kontakte brauchen jedes Mal den neuen Schlüssel (nur mit Internet) | – |

## Aufteilung (nach Freigabe, Vorschlag)

- **B-36a – Protokoll in Rust:** Paket, Fragmente, Ankündigung, Doppel-Erkennung, Noise `XX`, Vektoren.
  Neue Abhängigkeit für Noise: `snow` (Apache-2.0 oder MIT) – Größe und Pflege vor dem Bau nennen.
- **B-36b – BLE in Kotlin:** Central und Peripheral, MTU, Scannen mit Pausen (Akku), Rechte im Manifest
  (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`); Test im Emulator geht nicht – Probe
  mit zwei Handys (MENSCH).
- **B-36c – App:** Bitchat als Weg wie die RNode (Senden über die Warteschlange, Empfang wie Funk),
  Schlüssel an Kontakte, Grenze „bitchat“ im Bericht, Smoke-Test mit Attrappe.
- **B-36d – Probe** mit zwei Android-Handys und einem Bitchat-Gerät dazwischen (MENSCH).

## Vor dem Bau zu prüfen

- Ob Bitchat-Geräte gerichtete Pakete von Absendern weiterreichen, deren Ankündigung sie nicht geprüft
  haben – sonst muss Freedom sich erst ankündigen, bevor es etwas sendet.
- Ob ein unbekannter Nutzlast-Typ in der Noise-Sitzung beim Empfänger eine Fehlermeldung zurückschickt
  (dann einen Typ wählen, den Bitchat nie vergibt, und das beim Projekt anfragen).
- Akku: Bitchat scannt mit Pausen; Freedom übernimmt die Werte aus dem Swift-Code.

## Entscheidungen vom 23.10.2026 (MENSCH)

BC-W1 bis BC-W4: jeweils **A** – eigene Umsetzung, nur Umschläge zwischen Freedom-Geräten, Finden über Kontakte, eine
Identität je Gerät mit Grenze im Bericht.

## Stand B-36a1 (23.10.2026)

- **Paketformat im Protokoll** (`bitchat-paket.ts`, `docs/PROTOCOL.md` §45): Kopf in Fassung 1 und 2, Polster, Signierdaten
  und Ed25519, Peer-ID – Byte für Byte wie bitchat-android. Die Referenz enthält schon Ankündigungen und Fragmente.
- **TypeScript statt Rust:** Die Bausteine für Noise (X25519, ChaCha20-Poly1305, SHA-256) und Ed25519 liegen mit `@noble/…`
  schon im Protokoll – keine neue Abhängigkeit (kein `snow`), Tests in Node wie bei Reticulum. Kotlin in der Hülle reicht
  ab B-36b nur Bytes zwischen Bluetooth und der App weiter.
- **Vektoren:** `scripts/bitchat-referenz.sh` lädt kotlinc (feste Prüfsumme) und bitchat-android am Commit `dfc67da`, übersetzt
  dessen Kodierer mit Attrappen für Android und schreibt `protocol/test/fixtures/bitchat-referenz.json`. Ins Repository kommen
  nur die Bytes, kein Code. Swift ließ sich hier nicht laden (der Proxy sperrt swift.org).
- **Befund Packen:** Bitchat signiert über eine neue Kodierung und packt dabei Nutzlasten ab 100 Byte (raw deflate, nicht
  eindeutig). Freedom packt nie, die Ankündigung bleibt unter 100 Byte – sonst prüfte ein Bitchat-Gerät gegen andere Bytes.
- **Weiter (geteilt, je unter 400 Zeilen):** B-36a2 Ankündigung und Fragmente (zerlegen, zusammensetzen mit Grenzen);
  B-36a3 Noise `XX` (`Noise_XX_25519_ChaChaPoly_SHA256`, Vektoren aus der Noise-Spezifikation); B-36a4 Fluten
  (Doppel-Erkennung, TTL, Weiterreichen); dann b (Bluetooth in Kotlin), c (App), d (Probe, MENSCH).

## Stand B-36a2 (23.10.2026)

- **Ankündigung:** `baueBitchatAnkuendigung()` nur mit Name, Noise- und Signierschlüssel – unter 100 Byte, ohne Nachbarn und
  Fähigkeiten (BC-W3 A); `leseBitchatAnkuendigung()` liest auch, was Bitchat-Geräte mehr senden. Gegen die Referenz geprüft.
- **Fragmente:** Nutzlast wie `FragmentPayload`, `zerlegeBitchat()` in höchstens 256 Teile (mehr nimmt bitchat-android nicht
  an), `BitchatZusammensetzer` mit dessen Grenzen (64 Sätze, 1 MiB je Satz, 4 MiB insgesamt, 30 s) – je Absender getrennt,
  heraus mit TTL 0.
- **Weiter:** B-36a3 Noise `XX`, B-36a4 Fluten.

## Stand B-36a3 (23.10.2026)

- **Noise XX** (`bitchat-noise.ts`, `docs/PROTOCOL.md` §45): Handshake und Split nach der Spezifikation mit `@noble/…` –
  Byte für Byte wie die Vektoren von cacophony und snow (`protocol/test/fixtures/noise-xx-vektoren.json`, aus dem gemeinfreien
  Bitchat-Repository).
- **Transport wie Bitchat** (`BitchatTransport`): Nonce als 4 Byte vorn, Ersetzungsfenster 1024, Grenze 2^32 − 1 – nach dem
  gemeinfreien Swift-Code (`NoiseCipherState`, `useExtractedNonce`).
- **Befund beim Test:** Scheitert ein Handshake-Schritt mitten in der Nachricht, ist der Zustand halb fortgeschrieben – ein
  zweiter Versuch scheiterte still mit falschem Grund. Jetzt ist der Handshake danach `abgebrochen`, wie es Noise verlangt.
- **Weiter:** B-36a4 Fluten (Doppel-Erkennung, TTL, Weiterreichen), dann b (Bluetooth in Kotlin), c (App), d (Probe, MENSCH).

## Stand B-36a4 (23.10.2026)

- **Fluten** (`bitchat-mesh.ts`, `docs/PROTOCOL.md` §45): Doppeltes erkennen wie `BLEIngressLinkRegistry.messageID`
  (`BitchatDoppel`, 1000 Kennungen, 5 Minuten) und weiterreichen wie `RelayController.decide` (`bitchatWeiterreichen()`) –
  Fall für Fall aus dem gemeinfreien Swift-Code; der Versatz kommt aus einem Zufall, den Tests festlegen.
- **Roh weiterreichen** (`mitBitchatTtl()`): nur das TTL-Byte ändert sich – Signatur, Polster und gepackte Nutzlast anderer
  bleiben, wie sie kamen (die Signatur schließt die TTL aus).
- **Je Verbindung** (`bitchatFuerVerbindung()`): Bitchat schreibt und meldet je Wert genau ein ganzes Paket und zerlegt
  vorher, was nicht in die Grenze der Verbindung passt (MTU − 3; `fragmentChunkSize(forLinkLimit:)`); bitchat-android liest
  jeden Wert für sich. `zerlegeBitchat()` nimmt dafür eine Grenze und zerlegt Noise-Pakete gepolstert. Die Hülle setzt keine
  Stücke zusammen und verteilt kein Paket auf zwei Werte.
- **Damit sind die Bausteine im Protokoll fertig** (a1–a4). Weiter: b – Bluetooth in Kotlin in der Hülle, geteilt, weil die
  Klasse allein über 400 Zeilen hätte: b1 Peripheral (Dienst und Merkmal von Bitchat anbieten, Schreiben annehmen, melden),
  b2 Central (suchen mit Pausen, verbinden, Meldungen abonnieren, schreiben), b3 Brücke Rust ↔ App (JNI, Kommandos der
  Hülle); c – App, d – Probe (MENSCH).

## Stand B-36b1 (24.10.2026)

- **Peripheral in Kotlin** (`packages/launcher/android/FreedomBitchat.kt`, eigene Umsetzung nach `BLEService.swift`): Dienst
  und Merkmal von Bitchat anbieten (Werbung ohne Gerätenamen), Schreiben annehmen (auch lange Schreibvorgänge, fortlaufend bis
  512 Byte), an Abonnenten melden – je Verbindung immer nur ein Wert zugleich. Nur Werte weiterreichen: Werte über der Grenze
  lehnt `sende()` ab. Rechte erst auf Klick (`starte()`); der Stand nennt keine Adressen, Verbindungen heißen `p1`, `p2` ….
- **Ins APK** über `scripts/android-bitchat.py` (Klasse, Rechte, Keep-Regel) – die CI prüft Klasse, Methoden und Rechte im
  fertigen APK; der Selbsttest des Skripts (`scripts/test_android_bitchat.py`) läuft in `ci.yml`. Bluetooth selbst prüft
  erst die Probe mit Geräten (B-36d); lokal übersetzt kotlinc 2.2.20 die Klasse gegen Android 14 ohne Warnung.
- **Weiter:** b2 Central (suchen mit Pausen, verbinden, abonnieren, schreiben), b3 Brücke Rust ↔ App.

## Stand B-36b2 (24.10.2026)

- **Central in Kotlin** (dieselbe Klasse, nach `BLEService.swift` und den Werten aus `TransportConfig.swift`): sucht nur nach
  dem Dienst von Bitchat (Filter), bei bis zu zwei eigenen Verbindungen ständig, ab drei 5 s an und 10 s aus. Höchstens sechs
  Verbindungen als Central; wer in 8 s nicht bereit ist, wird getrennt und 120 s in Ruhe gelassen – nur Geräte, die nie
  bereit wurden; wer schon verbunden war und geht, darf gleich wieder. Nach dem Verbinden: MTU 517 erbitten, Dienst suchen,
  Meldungen abonnieren (CCCD), erst dann bereit; geschrieben wird ohne Antwort, je Verbindung ein Wert zugleich.
- **Ohne Werbung weiter nutzbar:** Kann das Gerät keinen Dienst anbieten, meldet der Stand `werbung: nicht-moeglich`, und
  Freedom verbindet sich nur selbst (früher hieß das `kein-anbieten` und Bluetooth blieb aus).
- **Verbindungen als Central heißen `z1`, `z2` …** – wie beim Peripheral ohne Adressen fremder Geräte.
- **Weiter:** b3 Brücke Rust ↔ App.

## Quellen

- `permissionlesstech/bitchat` (Unlicense), Commit `5e9287f` vom 24.09.2026: `WHITEPAPER.md` (Fassung 2.0),
  `SECURITY.md`, `docs/PEER-ID-ROTATION.md`, `docs/SERVICE-UUID-DETECTABILITY.md`, `MessageType.swift`,
  `RelayController.swift`, `NostrCarrierPacket.swift`, `GatewayService.swift`, `PeerCapabilities.swift`
- `permissionlesstech/bitchat-android`, Commit `fb2bb64` vom 28.02.2026 (Lizenzwechsel MIT → GPL-3.0)
- TechCrunch, 09.07.2025: „not been tested for security“ – https://techcrunch.com/2025/07/09/jack-dorsey-says-his-secure-new-bitchat-app-has-not-been-tested-for-security
- Trail of Bits, 18.07.2025 – https://blog.trailofbits.com/2025/07/18/building-secure-messaging-is-hard-a-nuanced-take-on-the-bitchat-security-debate/
- Release 1.7.1 – https://newreleases.io/project/github/permissionlesstech/bitchat/release/v1.7.1
- Altcoin Buzz, 01/2026 (Audit gemeldet) – https://www.altcoinbuzz.io/cryptocurrency-news/bitchat-expands-offline-messaging-with-media-and-privacy/
