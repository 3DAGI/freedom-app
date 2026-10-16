# Entwurf: MeshCore als zweites LoRa-Format (B-37)

Stand 15.10.2026, Spur B. Sammlung B-37 (Anhang E, nachrangig): „Repeater und Room Server halten
Nachrichten; spricht nicht mit Meshtastic. Wie 7.5: Format ohne Abhängigkeit, Vektoren aus der
Referenz.“ Dieser Entwurf hält fest, wie Freedom MeshCore-Geräte ansprechen würde. Er stellt zwei
Fragen; gebaut wird erst nach Freigabe.

## Ausgangslage

- **Meshtastic** (7.5, `docs/MESHTASTIC.md`): Die App spricht das Protobuf-Format der Firmware über USB
  und Bluetooth. Sie sendet Rahmen (`mesh-transport.ts`: 12 Byte Kopf, höchstens 200 Byte) als Paket an
  alle auf dem Kanal „freedom“, und die Firmware flutet.
- **MeshCore** ist eine zweite verbreitete LoRa-Firmware. Sie flutet nicht blind: Repeater leiten nach
  Pfaden weiter, und Room Server halten Nachrichten für Abwesende. Ein Gerät läuft entweder mit
  Meshtastic oder mit MeshCore. Beide sprechen nicht miteinander.

## Befunde

| Punkt | Befund | Quelle |
|---|---|---|
| Schnittstelle | „Companion Radio Protocol“ (Fassung 3) über USB, Bluetooth (Nordic-UART-Dienst `6E400001-…`) oder TCP. Über USB hat jeder Rahmen 1 Byte Richtung (`<` App → Gerät, `>` Gerät → App) und 2 Byte Länge (Little Endian); über Bluetooth ist ein Merkmal ein Rahmen | `@liamcottle/meshcore.js` 1.15.0 (`constants.js`, `connection.js`) |
| Senden an eine Gruppe | `SendChannelData` (62): Kanal-Index, Pfad, **Datentyp (16 Bit)**, Nutzlast. Empfang: `ChannelDataRecv` (27) mit SNR, Kanal, Pfadlänge, Datentyp, Länge, Daten | ebenda |
| Datentyp | Die 16 Bit sagen, für welche Anwendung ein Gruppen-Datagramm ist. `FF00`–`FFFF` ist für Entwicklung und Versuche. Einen festen Bereich bekommt man nur über einen Pull Request beim MeshCore-Projekt | Doku „Number Allocations“ |
| Größe | Ein Paket hat höchstens **184 Byte** Nutzlast (`MAX_PACKET_PAYLOAD`). Davon gehen Kanal-Kennung, MAC und Verschlüsselung (AES-128 in Blöcken) ab. **Unsere Rahmen (200 Byte) passen nicht** – für MeshCore braucht es kleinere | Doku „Packet Format“ |
| Kanal | Kanäle haben einen Namen und ein Geheimnis von 16 Byte (`SetChannel`). Wie bei Meshtastic wäre unseres öffentlich und kein Schutz. Geschützt sind die Umschläge | `connection.js` |
| Lizenzen | Firmware: MIT; `meshcore.js`: MIT (Liam Cottle), Abhängigkeiten `serialport` und `@noble/curves` – Freedom bräuchte nur das Format, keine Abhängigkeit | npm, `LICENSE` |
| Room Server | Hält Text-Nachrichten für eingeloggte Nutzer (`SendLogin`). Ob er auch Datagramme hält, ist offen – vor dem Bau gegen die Firmware prüfen | Doku |

## Vorschläge

- **V1 – Format ohne Abhängigkeit**, wie 7.5: `meshcore.ts` im Protokoll baut und liest Rahmen der
  Companion-Schnittstelle. Vektoren erzeugt ein Skript mit `meshcore.js` in fester Version (Prüfsumme der
  Datei, wie `scripts/negentropy-referenz.mjs`).
- **V2 – Rahmen kleiner nur für diese Strecke:** Eine eigene Größe für MeshCore (unter 184 Byte, genau
  aus der Firmware) ändert die Umschläge nicht; `fragment()` bekommt die Größe als Angabe, der Empfang
  prüft die Kennung der ganzen Nachricht wie bisher. Rahmen einer Nachricht nie über Strecken mit
  verschiedener Größe mischen – Nachforderungen zählen nach Index. Ein Test zeigt beides.
- **V3 – Nur Gruppen-Datagramme** auf dem Kanal „freedom“, Datentyp aus dem eigenen Bereich (W1). Die
  Firmware leitet weiter, die App reicht über MeshCore nichts weiter (wie 7.5b).
- **V4 – Sendezeit** über das bestehende `Sendezeitkonto`. Die Region setzt die App nie selbst.

## Fragen an den MENSCHEN

| Frage | Optionen | Empfehlung |
|---|---|---|
| **MCO-W1** – Datentyp | **A** der MENSCH beantragt beim MeshCore-Projekt einen festen Bereich (Pull Request dort); bis dahin `FF00`–`FFFF` · **B** dauerhaft im Versuchsbereich `FF00`–`FFFF` | **A** – im Versuchsbereich kollidieren wir mit anderen Versuchen |
| **MCO-W2** – Wann bauen? | **A** jetzt, nach 7.5 als Vorlage · **B** erst, wenn ein Nutzer vor Ort MeshCore hat (dann mit echtem Gerät testen) | **B** – ohne Gerät bliebe es ungeprüft wie 7.4 vor 7.5 |

## Aufteilung (nach Freigabe)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-37a | `meshcore.ts`: Rahmen der Companion-Schnittstelle, Vektoren aus `meshcore.js`, Rahmengröße je Strecke (V2) | ~300 |
| B-37b | App: Gerät über USB und Bluetooth, Kanal „freedom“ einrichten, senden und empfangen über die Warteschlange | ~300 |
| B-37c | Live-Probe mit zwei Geräten (MENSCH) | – |

## Quellen

- `@liamcottle/meshcore.js` 1.15.0 (npm, MIT) – Quelltext gelesen.
- MeshCore-Doku „Packet Format“ und „Number Allocations“ (docs.meshcore.io; aus dieser Umgebung nicht
  erreichbar, Inhalt über die Suche).
