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
