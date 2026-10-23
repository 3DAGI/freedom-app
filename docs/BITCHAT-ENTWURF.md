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

## Quellen

- `permissionlesstech/bitchat` (Unlicense), Commit `5e9287f` vom 24.09.2026: `WHITEPAPER.md` (Fassung 2.0),
  `SECURITY.md`, `docs/PEER-ID-ROTATION.md`, `docs/SERVICE-UUID-DETECTABILITY.md`, `MessageType.swift`,
  `RelayController.swift`, `NostrCarrierPacket.swift`, `GatewayService.swift`, `PeerCapabilities.swift`
- `permissionlesstech/bitchat-android`, Commit `fb2bb64` vom 28.02.2026 (Lizenzwechsel MIT → GPL-3.0)
- TechCrunch, 09.07.2025: „not been tested for security“ – https://techcrunch.com/2025/07/09/jack-dorsey-says-his-secure-new-bitchat-app-has-not-been-tested-for-security
- Trail of Bits, 18.07.2025 – https://blog.trailofbits.com/2025/07/18/building-secure-messaging-is-hard-a-nuanced-take-on-the-bitchat-security-debate/
- Release 1.7.1 – https://newreleases.io/project/github/permissionlesstech/bitchat/release/v1.7.1
- Altcoin Buzz, 01/2026 (Audit gemeldet) – https://www.altcoinbuzz.io/cryptocurrency-news/bitchat-expands-offline-messaging-with-media-and-privacy/
