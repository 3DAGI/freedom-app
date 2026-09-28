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
  - **7.4b2:** Gateway-Rolle im Knoten – TCP-Brücke zum Funkgerät
    (Längenpräfix), Umschläge aus dem Funk ins Netz, Post an gemerkte
    Sitzungen über die Warteschlange mit Sendezeitkonto zurück, Nachfordern mit
    den Bausteinen aus 7.4b1; Abnahme mit simuliertem Funkkanal gegen den
    echten `DvmProvider`.
  - **7.4c:** App – KI-Anfrage über Mesh (Gateway wählen, Auftrag mit
    `kurzParam()` und Zahlkanal-Gutschrift, Weiterleitung), Antwort aus dem
    Mesh öffnen und zeigen; ehrliche Texte zu Dauer und Kosten.
