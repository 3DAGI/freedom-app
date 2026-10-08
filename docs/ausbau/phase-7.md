# Phase 7 – Offline und Mesh

## 7.1 Nur verschlüsselte Pakete über Funk

- **Stellen:** `mesh-transport.ts`, `mesh-sync.ts`, `mesh.ts`,
  `packages/app/src/mesh-radio.ts`, `mesh-transfer.ts`, `offline-queue.ts`.
- **Vorgehen:** Transportiert werden nur Gift-Wraps, MLS-Nachrichten und signierte
  Transaktionen. Paketköpfe ohne npub des Absenders. Sendezeit-Budget im Planer
  (EU 868 MHz: häufig 1 % Duty Cycle).
- **Abnahme:** Test: Mitgeschnittene Pakete enthalten weder npub noch Klartext.

## 7.2 SOL-Zahlungen ohne Internet (Durable Nonces)

- **Vorgehen:**
  1. Nonce-Konto online anlegen; Kosten vorher anzeigen.
  2. Offline-Transaktion mit `advanceNonceAccount` als erster Anweisung; der
     Blockhash ist der gespeicherte Nonce-Wert.
  3. Übertragung als Datei oder über Funk; ein Gateway mit Internet reicht ein.
  4. Zahlkanal-Gutschriften (4.3) funktionieren offline ohnehin.
- **Abnahme:** Test am lokalen Validator: Die Transaktion ist nach mehr als zwei
  Minuten noch gültig.
- **MENSCH:** Test mit zwei Meshtastic-Geräten (GO-LIVE, Abschnitt 5).

## 7.3 Sats ohne Internet

- **Vorgehen:** In der App klar sagen: „Offline: Nachrichten und SOL. Sats, sobald
  wieder Netz da ist.“ Ecash (Cashu) nur nach ausdrücklicher MENSCH-Entscheidung –
  es hängt an verwahrenden Mints.

## 7.4 KI über ein Funk-Gateway

- **Stellen:** `packages/node/src/offline-node.ts`, Gateway-Rolle.
- **Vorgehen:** Das Gateway nimmt verschlüsselte Funkanfragen an, leitet sie an
  einen Provider weiter und kürzt die Antwort (höchstens 500 Zeichen, komprimiert).
  Bezahlt wird per Zahlkanal-Gutschrift.
- **Abnahme:** Test mit simuliertem Funkkanal (Paketgröße, Verzögerung, Verlust).
- **Entschieden (MENSCH 26.09.):** Der Provider kürzt auf Wunsch (Parameter im
  versiegelten Auftrag) auf 500 Zeichen ohne Zwischenstände – Ende-zu-Ende
  bleibt; das Gateway reicht nur Umschläge weiter und kennt nur den
  Sitzungsschlüssel; der Knoten hängt über eine TCP-Brücke (Längenpräfix,
  z. B. socat/ser2net) am Funkgerät, keine neue Abhängigkeit.
- **Aufteilung:**
  - **7.4a – FERTIG:** Protokoll `funk-gateway.ts`: `kurzParam()` /
    `leseKurzWunsch()` (`["param","max_zeichen","<n>"]`, höchstens 500),
    `kuerzeAntwort()`; versiegelter Weiterleitungsauftrag (Kind 25030, Autor =
    Sitzungsschlüssel, Ablauf höchstens 1 h, auch am Umschlag) –
    `baueWeiterleitung()`/`oeffneWeiterleitung()`; `GatewayBuch` (nur Umschläge
    an gemerkte, laufende Sitzungen, höchstens 3 je Sitzung, keine doppelt,
    höchstens 50 Sitzungen). Der Provider kürzt, bittet das Modell um Kürze und
    schickt keine Zwischenstände. Abnahme auf Protokollebene: Auftrag und
    Weiterleitung über einen simulierten Funkkanal (Pakete ≤ 200 Byte,
    Verzögerung, Verlust mit gezieltem Nachfordern, Dubletten), Antwort zurück,
    in der Sendezeit einer Stunde.
  - **7.4b1 – FERTIG:** Fehlende Rahmen nachfordern, im Protokoll und im
    Funkknoten der App (beide Richtungen, auch zwischen zwei Apps):
    Nachforderung als eigene Nutzlast (`baueNachforderung()`/
    `leseNachforderung()`: „N“, Kennung, Bitfeld – nichts, was nicht ohnehin in
    jedem Rahmenkopf steht), von `pruefeMeshInhalt()` als Art „nachforderung“
    erkannt; der Empfänger fordert nach 20 s Ruhe nach, höchstens dreimal mit
    dreifachem Abstand (`Reassembler.faelligeNachforderungen()`); der Sender
    sendet nur aus dem `Sendegedaechtnis` nach (20 Nachrichten, 1 h, höchstens
    zweimal je Nachricht) und über die Warteschlange mit Sendezeit
    (`MeshQueue.enqueueFrames()`); Fremdes reicht ein Knoten weiter.
  - **7.4b2 – FERTIG:** Gateway-Rolle im Knoten (`gateway-role.ts`,
    `FUNK_GATEWAY=host:port`) – TCP-Brücke zum Funkgerät (zwei Byte Länge je
    Rahmen, neu verbinden nach Trennung), Umschläge aus dem Funk ins Netz
    (Weiterleitungen nie; ein Auftrag an den Provider auf demselben Knoten
    schon), Post an gemerkte Sitzungen über die Warteschlange mit
    Sendezeitkonto zurück, Nachfordern mit den Bausteinen aus 7.4b1; Post von
    vor dem Auftrag bleibt im Netz (`ab` der Weiterleitung, 10 min Toleranz);
    das Angebot nennt das Gateway (`["funk","gateway"]`). Abnahme mit
    simuliertem Funkkanal gegen den echten `DvmProvider`. Ehrlich: eine
    Antwort mit 500 Zeichen ist als Umschlag rund 3 KB, also etwa 15 s
    Sendezeit – ein Gateway schafft rund zwei Antworten je Stunde.
  - **7.4c1 – FERTIG:** Gerätestrecken der App mit Längenpräfix wie die
    Brücke des Knotens (`mitLaenge()`/`LaengenRahmen`, aus dem Knoten ins
    Protokoll gezogen): USB liest jetzt (bis dahin kam über USB keine Antwort
    an), Bluetooth setzt aus BLE-Häppchen wieder Rahmen zusammen (bis dahin war
    ein Rahmen über 180 Byte nie lesbar). `serielleStrecke()`/
    `bluetoothStrecke()` testbar ohne Gerät.
  - **7.4c2 – FERTIG:** App-Logik – Bausteine ohne Zustand in `ki-funk.ts`
    (`funkGatewayAus()`/`leseFunkGateway()`, `baueFunkAuftrag()`,
    `FunkAuftraege`), Zustand und Wege in `shell/ki-ueber-funk.ts`: Gateway
    aus dem Angebot mit `["funk","gateway"]` merken (im Tresor,
    `freedom.funk.gateway`), Auftrag mit `kurzParam()` und
    Zahlkanal-Gutschrift zum gemerkten Kurs (ohne Kanal nur gratis – Lightning
    geht ohne Netz nicht, nie still ausweichen), erst merken, dann Weiterleitung
    und Auftrag senden; Antwort aus dem Funk wird vor dem Weiterverteilen
    geöffnet und im Agenten gezeigt (über den Kanal nur der Preis verbucht).
  - **7.4c3 – FERTIG:** Oberfläche – Seite Netz → Mesh: Karte „KI über
    Funk“ (Gateways suchen, eines merken oder vergessen, `funk-gateway-ui.ts`);
    im Agenten „über Funk“ nur mit gemerktem Gateway, gesendet wird nur die
    Frage (kein Verlauf als Kontext), erst nach der Prüfung, dass ein
    Funkgerät verbunden ist. Ehrliche Texte in App, Protokoll
    (`offlineCapabilities()`: KI über Funk ja, per Datei und Bluetooth von
    Gerät zu Gerät nein) und FAQ: höchstens 500 Zeichen, rund zwei Antworten je
    Stunde und Gateway, bezahlt nur über einen Zahlkanal oder gratis, die
    Antwort nur, solange die App offen bleibt. Smoke-Test „rahmen“ prüft die
    Karte.

## 7.5 Meshtastic-Geräte direkt (Wunsch MENSCH 08.10.2026, Spur A)

- **Anlass:** Die App sprach seit 7.4c1 rohe Rahmen mit Längenpräfix – ein
  Meshtastic-Gerät von der Stange verwarf sie still; die Firmware „mit
  Längenpräfix“ gab es nie. Befunde, Festlegungen und Quellen:
  `docs/MESHTASTIC.md` (zugleich die Information an Spur B).
- **Entschieden (MENSCH 08.10.):** Spur A baut es; Kanal nach Variante (a) –
  zweiter Kanal „freedom“ neben dem Hauptkanal, Schlüssel öffentlich im Code.
- **Abnahme:** Format Byte für Byte gegen die offizielle Python-Bibliothek
  (meshtastic 2.7.11); Strecken mit einer Geräte-Attrappe, die Meshtastic
  spricht; MENSCH: zwei echte Geräte (GO-LIVE 5).
- **Aufteilung:**
  - **7.5a – FERTIG:** Protokoll `meshtastic.ts` ohne Abhängigkeit:
    `baueKonfigAnfrage()`, `baueFunkPaket()` (an alle, Port `PRIVATE_APP`,
    Kanal, Hop-Limit, ohne Paket-Id), `mitMeshtasticKopf()`/`MeshtasticStrom`
    (Strom mit `0x94 0xC3`, Debug-Text der Firmware übergangen, neu aufsetzen
    über 512 Byte), `leseVomGeraet()` (Paket, eigene Nummer, LoRa-Einstellungen,
    Kanal, Ende der Einstellungen, Warteschlange, Neustart; Unbekanntes
    übersprungen, Kaputtes `null`), `FREEDOM_KANAL`. Prüfvektoren mit
    `scripts/meshtastic-referenz.py`.
  - **7.5b – FERTIG:** App über USB (`meshtastic-strecke.ts`,
    `erkenneSerielleStrecke()` aus `connectSerial()`): weckt und fragt das Gerät
    (`want_config`, alle 2 s erneut – ein ESP32 startet beim Öffnen neu), nimmt
    Kanal „freedom“ nur mit unserem Schlüssel, Hop-Limit aus den Einstellungen
    (ohne Angabe 3), Sendezeit je Rahmen aus dem Preset (`meshtasticSendezeit()`,
    eigene Funkwerte wie LongSlow); empfangen nur Port 256 auf diesem Kanal;
    nach einem Neustart neu gefragt. Antwortet in 10 s nichts Meshtastisches,
    bleibt der Weg mit Längenpräfix (auch für schon Empfangenes). Der Funkknoten
    reicht über Meshtastic nichts weiter (`leitetSelbstWeiter`) und bucht die
    Sendezeit der Strecke. Mesh-Karte: Hinweise zu Kanal (mit öffentlichem
    Schlüssel zum Abtippen), Region und Senden; neue Grenze „mesh-geraet“ im
    Bericht. Ehrlich gerechnet: eine kurze Nachricht (Umschlag rund 1,7 KB,
    10 Rahmen) braucht mit LongFast rund 18 s – bei 1 % etwa zwei je Stunde
    statt „drei bis vier“ (App, Protokoll, FAQ, Whitepaper korrigiert).
  - **7.5c – FERTIG:** App über Bluetooth (`meshtasticBluetooth()` aus
    `connectBluetooth()`: Meshtastic-Dienst, sonst Nordic UART wie bisher) –
    `ToRadio` ohne Kopf an „zum Gerät“, „vom Gerät“ lesen bis leer, nach jedem
    Schreiben und bei „Meldung“; ein Gerät, das nicht antwortet, wird getrennt.
    USB und Bluetooth teilen sich `MeshtasticSitzung`; Kanäle gelten erst ab
    „Ende der Einstellungen“ (sonst ginge beim Neustart des Geräts ein Rahmen
    verloren, und ein gelöschter Kanal bliebe in Gebrauch). Kanal „freedom“
    anlegen (`baueKanalAnlegen()`, `AdminMessage.set_channel` an das eigene
    Gerät, wie `writeChannel()` der Python-Bibliothek, Vektor aus der Referenz)
    nur über den Knopf in der Mesh-Karte und nach `bestaetige()`: auf dem Platz
    eines „freedom“ mit fremdem Schlüssel, sonst dem ersten freien (1–7) – der
    Hauptkanal bleibt; ohne Platz nichts. Danach neu gefragt. Hinweis bei
    Region `UNSET` seit 7.5b; die Region setzt die App nie.
  - **7.5d:** Gateway des Knotens direkt an ein Meshtastic-Gerät per TCP
    (Port 4403); Texte (FAQ, Mesh-Karte, GO-LIVE); Smoke-Test mit Attrappe.
