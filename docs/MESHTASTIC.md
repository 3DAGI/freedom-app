# Meshtastic-Geräte direkt – Stand und Befunde (7.5)

Stand 08.10.2026, Spur A. **Für Spur B und den MENSCHEN:** Was über die
Funkstrecke bekannt ist, was gebaut wird und wer welche Dateien anfasst.

## Anlass

Der MENSCH fragte am 08.10., ob Freedom ohne Internet nur mit LoRa geht (eine
andere KI hatte mit Blick auf The Things Network verneint). Die Prüfung ergab:

- **The Things Network (LoRaWAN) passt wirklich nicht.** LoRaWAN ist ein Stern:
  Gerät → Gateway → Internet → Netzwerkserver. Geräte reden nicht direkt
  miteinander, jedes Gateway braucht selbst Internet, und die Fair-Use-Regeln
  erlauben rund 30 s Sendezeit je Tag. Fällt das Internet aus, fällt TTN mit.
- **Freedom braucht dafür kein Internet:** Phase 7 baut ein Mesh von Gerät zu
  Gerät – Umschläge in Rahmen zu 200 Byte, Nachfordern, Sendezeitkonto (7.1),
  SOL offline (7.2), KI kurz über ein Gateway (7.4).
- **Aber die Geräte von der Stange verstanden die App nicht.** Seit 7.4c1
  schickt die App rohe Rahmen mit zwei Byte Länge davor – über USB und über den
  Bluetooth-Dienst „Nordic UART“. Meshtastic, die verbreitete Firmware für
  LoRa-Geräte um 40 €, spricht über USB ein eigenes Protobuf-Format (Kopf
  `0x94 0xC3`) und über Bluetooth einen eigenen Dienst. Ein Meshtastic-Gerät
  verwarf unsere Rahmen still. Die Firmware „mit Längenpräfix“ aus 7.4 gab es
  nie. Mit echter Hardware getestet war nichts (GO-LIVE, Abschnitt 5).

**Entscheidung MENSCH 08.10.:** Spur A baut die Meshtastic-Anbindung selbst,
Variante (a) für den Kanal; die Befunde gehen über dieses Dokument an Spur B.

## Was die App mit Meshtastic tut

| Punkt | Festlegung | Beleg in der Firmware bzw. Bibliothek |
|---|---|---|
| Rahmung | Strom (USB, TCP): `0x94 0xC3`, Länge 2 Byte Big Endian, höchstens 512 Byte Protobuf. Bluetooth: je Merkmal eine ganze Nachricht ohne Kopf | `stream_interface.py`, `ble_interface.py` |
| Start | `ToRadio.want_config_id`; danach schickt das Gerät eigene Nummer, Einstellungen, Kanäle, `config_complete_id`, dann Pakete | `mesh_interface.py` (`_startConfig`) |
| Senden | `ToRadio.packet`: an alle (`0xFFFFFFFF`), Port `PRIVATE_APP` (256), Kanal „freedom“, `hop_limit` aus den LoRa-Einstellungen des Geräts, ohne Paket-Id | `Router.cpp`: ohne `want_ack` bleibt `hop_limit` 0 – das Paket ginge dann nur einen Sprung weit; `MeshService.cpp`: Id 0 → die Firmware vergibt eine |
| Größe | Unsere Rahmen (200 Byte) passen in ein Paket (höchstens 233 Byte Nutzlast) | `Constants.DATA_PAYLOAD_LEN` |
| Empfang | `FromRadio.packet` mit Port 256 auf dem Kanal „freedom“; der Inhalt ist ein Rahmen wie bisher (`parseFrame()`, `pruefeMeshInhalt()`) | `RoutingModule.cpp`: Rundrufe gehen an das verbundene Gerät |
| Weiterreichen | **Die Firmware flutet selbst** (Hop-Limit). Über Meshtastic reicht die App nichts weiter – sonst ginge jeder Rahmen mehrfach in die Luft | `Router.cpp` |
| Kanal (Variante a) | Zweiter Kanal „freedom“ neben dem Hauptkanal. Die Frequenz setzt der Hauptkanal; fremde Geräte im Standard „ALL“ leiten weiter, was sie nicht lesen können | `channel.proto` (SECONDARY), `config.proto` (`RebroadcastMode.ALL`) |
| Schlüssel des Kanals | SHA-256 von `freedomstack-meshtastic-kanal-v1`, steht im Code (`FREEDOM_KANAL`) – **kein Geheimnis**, er trennt nur unseren Verkehr vom Chat der anderen. Geschützt sind die Nachrichten durch ihre Umschläge (7.1) | `channel.proto`: 32 Byte = AES-256, Name unter 12 Byte |
| Kanal anlegen | Nur auf Klick und nach Rückfrage, per `AdminMessage.set_channel` an das eigene Gerät – lokal braucht das keinen Sitzungsschlüssel (außer `is_managed`) | `AdminModule.cpp` (`mp.from == 0`) |
| Region | Ein neues Gerät hat die Region `UNSET` und sendet nicht – die App sagt das und setzt sie nicht selbst (die Region ist Recht des Landes) | `config.proto` |

## Datenschutz – was Meshtastic dazu verrät

- **Gerätenummer im Kopf:** Jedes Meshtastic-Paket trägt offen die Nummer des
  sendenden Geräts (aus seiner Hardware-Adresse). Sie verrät nicht die
  Nostr-Identität, verbindet aber alle Pakete desselben Geräts – wer mithört,
  sieht „dieses Gerät sendet Freedom-Pakete“. Der Inhalt bleibt Umschlag (7.1).
- **Kanal erkennbar:** Der Schlüssel des Kanals ist öffentlich; wer ihn kennt,
  liest die Meshtastic-Schicht und sieht Port und Rahmen – also die Umschläge,
  wie über jede Funkstrecke (an wen die Post geht, steht im Umschlag).
- **Das Gerät funkt selbst:** Meshtastic sendet je nach Einstellung Name des
  Geräts und Position (bei GPS) auf dem Hauptkanal – unabhängig von Freedom.
  Die Texte der App sagen das und wo man es abschaltet.

Mit 7.5b – sobald die App Meshtastic nutzt – kommen die Aussage „mesh“ im
Bericht (Gerätenummer) und diese Texte.

## Sendezeit – ehrlich gerechnet

- Meshtastic sendet in Europa (Region `EU_868`) im Teilband 869,4–869,65 MHz;
  dort erlaubt das Recht 10 % Sendezeit, die Firmware hält das selbst ein
  (`RadioInterface.cpp`). Die App bucht weiter höchstens 1 % je Stunde
  (`Sendezeitkonto`) – vorsichtig, und das Band teilen wir mit allen
  Meshtastic-Nutzern in Reichweite. Ob die App mehr nutzen darf, ist eine
  Frage an den MENSCHEN (nicht dringend).
- Standard ist LongFast (SF 11, 250 kHz, CR 4/5): rund 134 Byte/s. Ein voller
  Rahmen kostet damit samt Meshtastic-Kopf rund 1,9 s Sendezeit. Die App
  rechnete mit 200 Byte/s, also 1,0 s je Rahmen – 7.5b nimmt die Rate aus den
  Einstellungen des Geräts, damit Schätzung und Konto stimmen.
- Jeder Sprung kostet dieselbe Zeit noch einmal – auf den Geräten, die
  weiterleiten, nicht auf unserem Konto.

## Schritte

| Schritt | Inhalt | Dateien |
|---|---|---|
| 7.5a | Protokoll: Meshtastic-Format ohne Abhängigkeit (`meshtastic.ts`), Prüfvektoren aus der offiziellen Python-Bibliothek (`scripts/meshtastic-referenz.py`, meshtastic 2.7.11), dieses Dokument | `protocol/src/meshtastic.ts` |
| 7.5b | App: Meshtastic über USB – Start, Kanal „freedom“ finden, Hop-Limit und Rate aus den Einstellungen, kein Weiterreichen über Meshtastic; der Weg mit Längenpräfix bleibt (eigene Firmware, TCP-Brücke); Bericht und Texte zum Datenschutz | `app/src/mesh-radio.ts`, `shell/tabs/mesh.ts` |
| 7.5c | App: Meshtastic über Bluetooth; Kanal „freedom“ anlegen (Rückfrage), Hinweis bei Region `UNSET` | dieselben |
| 7.5d | Knoten: Gateway direkt an ein Meshtastic-Gerät per TCP (Port 4403); Texte (FAQ, Mesh-Karte, GO-LIVE); Smoke-Test mit Meshtastic-Attrappe | `node/src/gateway-role.ts` |

**Für Spur B:** Bis 7.5d fertig ist, ändert Spur A die genannten Mesh-Dateien.
Bitte dort nichts parallel umbauen; Fragen und Funde gern als Zeile in diesem
Dokument. Am Rahmenformat (`mesh-transport.ts`) ändert 7.5 nichts.

## Quellen (geprüfter Stand)

- `meshtastic/protobufs` 95c5f8c1c4223bb27faa81417b90560037f8ad31 (03.10.2026)
- `meshtastic/python` 0a1835760c2437314a2d3544bbdd8b6fead559bc, PyPI `meshtastic` 2.7.11
- `meshtastic/firmware` 015d5b1231b471399f9c35eb7c34213d7a382c1d (08.10.2026)

## MENSCH

- Zwei Meshtastic-Geräte (Region EU_868) – nach 7.5b Nachrichten über USB, nach
  7.5c über Bluetooth testen, dann die SOL-Zahlung über Funk (GO-LIVE 5).
- Frage (nicht dringend): Darf die App über Meshtastic mehr als 1 % Sendezeit
  nutzen (bis zu den 10 % des Bands)?
