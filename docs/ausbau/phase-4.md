# Phase 4 – Solana gleichwertig zu Sats

Jede Funktion, in der Geld fließt, bietet beide Schienen mit gleichem Komfort.

| Funktion | Sats heute | SOL – zu bauen |
|---|---|---|
| KI-Anfragen bezahlen | Lightning pro Anfrage, Hold-Invoice-Sitzungen | Zahlkanal-Programm (4.3) |
| Verdienen als Provider | Lightning-Adresse | SOL-Auszahlung, frische Adressen (4.5) |
| Trinkgeld | Zaps (NIP-57) | SOL-Trinkgeld-Beleg (4.7) |
| App-Gebühr | Lightning-Adresse | im Zahlkanal on-chain erzwungen |
| Swaps | Lightning → SOL | beide Richtungen (4.6) |
| Geräte-Budget | NWC mit Limit | Limit der eingebauten Wallet bzw. des Sitzungsschlüssels |
| Belege prüfen | Preimage | Transaktion mit Empfängerprüfung (4.8) |

---

## 4.0 Entscheidung Gebührenmodell – MENSCH (vor 4.3) – VORLAGE FERTIG (25.09.2026)

> Vorlage mit Ist-Stand, Optionen A und B, betroffenen Dateien, Folgen für den Zahlkanal, AMLR-Angriffsfläche und Einnahmen: [`docs/GEBUEHREN-ENTSCHEIDUNG.md`](../GEBUEHREN-ENTSCHEIDUNG.md). Wartet auf die Entscheidung.

- **Du:** `docs/GEBUEHREN-ENTSCHEIDUNG.md` vorbereiten mit zwei Optionen:
  - **A (empfohlen):** Protokollgebühr 0 %; App-Gebühr freiwillig, offen
    deklariert, an einen selbstverwahrten Empfänger; Anreize über gesponserte
    Pools; Relays werden direkt bezahlt; Werben ohne Provision.
  - **B:** Pool behalten, aber offen als zentral verwaltete Belohnung – nur in
    SOL, Programm-Tresor mit Mehrfachsignatur, veröffentlichte Regeln und Berichte.
  - Je Option: betroffene Dateien, Folgen für das Zahlkanal-Programm, Folgen für
    die CASP-Frage nach AMLR, Einnahmen.
- Dann STOPP. **MENSCH:** entscheiden.

---

## 4.1 PaymentRail-Schnittstelle – CODE FERTIG BIS AUF AGENT-BEZAHLUNG (25.09.2026)

> Aufgeteilt: a Schnittstelle und Schienen ✓ (`protocol/payment-rail.ts`: Typen, `railFuerZiel`, `pruefeAnfrage`, `waehleRail` ohne stille Umleitung, `zahle`, Beträge in beiden Einheiten; `app/src/rails.ts`: `LightningRail` mit NWC, WebLN und Lightning-Adresse per LNURL – die Rechnung muss genau den gewollten Betrag nennen –, Beleg per Preimage gegen den bolt11-Hash; `SolanaRail` mit der verbundenen Wallet, Beleg nur mit RPC-Prüfung); b Zap und Wallet-Tab auf die Schienen ✓ (dabei drei Fehler im Zap behoben und toten Wallet-Code entfernt); c „Standard-Schiene“ und Prüfung „keine direkten Wallet-Aufrufe außerhalb der Rails“ ✓. **Agent-Bezahlung und Verdienen:** Die Karte nimmt an, es gäbe schon Zahlungen, die man umstellt. Die App bezahlt KI-Aufträge heute aber nicht (nur Belege, `chargeForResult()` ohne Wallet), der Knoten stellt keine Rechnungen aus, und „Verdienen“ hat keine Zahlfunktion. Das wird eine neue Geldfunktion (Knoten stellt Rechnungen aus bzw. SOL-Zahlkanal 4.3) – MENSCH-Frage.

- **Stellen:** neu `packages/protocol/src/payment-rail.ts`; `lightning-wallet.ts`,
  `sol-transfer.ts`, `sol-htlc.ts`, `session-client.ts`, `chat-zap.ts`,
  Agent-Bezahlung, Verdienen.
- **Vorgehen:**
  1. `interface PaymentRail { id: "lightning" | "solana"; quote(betrag); pay(anfrage);
     verify(beleg); refund?(ref); balance?() }`
  2. `LightningRail` (NWC/WebLN) und `SolanaRail` (Wallet-Adapter oder eingebaute Wallet).
  3. Alle Geldfunktionen auf die Schnittstelle umstellen; Einstellung
     „Standard-Schiene“, pro Zahlung änderbar.
  4. Beträge immer in beiden Einheiten (Kurs aus 4.4; bis dahin der letzte LP-Kurs).
- **Abnahme:** `check-wiring.py --streng` findet außerhalb der Rails keine
  direkten Aufrufe der Wallet-Module; Tests laufen jede Geldfunktion mit beiden
  Rails (Mocks) durch.

---

## 4.2 SOL-Wallet: extern und eingebaut

> Aufgeteilt: a Kern ✓ (Tageslimit als reine Funktion, rollende 24 Stunden; eingebaute Wallet `sol-wallet.ts`: Schlüssel aus den 12 Wörtern der Identität, nur im Tresor, synchron signiert und genullt; Freigabe-Haken der Solana-Schiene; verbundene Wallet vor eingebauter, mit Bunker gesperrt); b Oberfläche im Wallet-Tab (einrichten, Adresse zum Empfangen, Guthaben, Limit, entfernen) mit E2E ✓ (dabei `RpcPool` im Browser repariert); c externe Wallets über Wallet Standard (ohne neue Abhängigkeit) – Mobile Wallet Adapter bräuchte `@solana-mobile/wallet-adapter-mobile` → vorher MENSCH fragen.

- **Stellen:** `packages/app/src/solana-connect.ts`, neu `packages/app/src/sol-wallet.ts`.
- **Vorgehen:**
  1. Extern: Wallet Standard (Browser-Erweiterungen), Mobile Wallet Adapter
     (Android und Seeker), Deeplinks für iOS (Phantom, Solflare).
  2. Eingebaut: `deriveSolana(seed, 0)` aus 1.1, Schlüssel im Tresor, Tageslimit
     wie beim NWC-Budget, Bestätigungsdialog oberhalb des Limits.
- **Abnahme:** Tests für Signieren und Limit.
- **MENSCH:** auf Devnet mit beiden Wegen senden und empfangen; die eingebaute
  Wallet in Phantom importieren.

---

## 4.3 Solana-Zahlkanal (neues Anchor-Programm)

- **Voraussetzung:** 4.0 entschieden, 4.1 fertig.
- **Stellen:** neu `contracts/solana-channel/`; Client
  `packages/protocol/src/channel.ts`; Knoten `settlement.ts` und `dvm-provider.ts`.
- **Konto `Channel`** (PDA, Seeds `["channel", customer, provider, nonce]`):
  customer, provider, session_key (Ed25519-Pubkey), deposited, settled, expiry,
  fee_recipients (Liste Adresse + Anteil in ppm, fest bei Eröffnung), bump.
- **Anweisungen:**
  1. `open(nonce, amount, expiry, session_key, fee_recipients)`: Kunde zahlt ein;
     expiry liegt in der Zukunft; Summe der Anteile höchstens die Obergrenze aus 4.0.
  2. `settle(cumulative_amount)`: nur der Provider, nur vor expiry. In derselben
     Transaktion steht davor eine Anweisung des Ed25519-Programms, die die
     Gutschrift mit session_key signiert; prüfen über das Instruktions-Sysvar.
     Auszahlbar ist `cumulative_amount − settled`, höchstens `deposited − settled`.
     Aufteilung auf Provider und fee_recipients on-chain.
  3. `refund()`: nur der Kunde, nur nach expiry; Rest zurück, Konto schließen
     (Miete an den Kunden).
  4. `top_up(amount)`: optional.
- **Gutschrift-Format** in `docs/ZAHLKANAL.md` festlegen: Domain-Präfix
  `freedomstack-channel-v1`, Kanal-Adresse, cumulative_amount (u64 LE), expiry
  (i64 LE). Signiert wird genau diese Bytefolge.
- **Tests (anchor):** open; mehrere Gutschriften; settle; zweites settle mit
  niedrigerem Betrag scheitert; settle nach expiry scheitert; falsche Signatur
  scheitert; Gutschrift eines anderen Kanals (Replay) scheitert; refund vor
  expiry scheitert, danach klappt er; Aufteilung stimmt auf den Lamport.
- **Client und Knoten:** Gutschriften mit dem Sitzungsschlüssel signieren und
  verschlüsselt mit der Anfrage schicken. Der Knoten prüft jede Gutschrift
  off-chain (Signatur, Betrag ≤ Einlage, Monotonie) und rechnet vor expiry mit
  Sicherheitsabstand ab.
- **Danach:** Deposit mit zwei HTLCs (`sol-htlc.ts` Verbrauchs- und Rest-HTLC,
  `sol-deposit.ts`) erst entfernen, wenn der Zahlkanal auf Devnet läuft.
- **Nie:** `--final`.
- **MENSCH:** Devnet-Deploy (neue Program-ID), dann ein vollständiger KI-Auftrag
  mit SOL auf Devnet.

---

## 4.4 Preise und Kurse

- **Stellen:** `pricing.ts`, `price-ticker.ts`, Angebote in `dvm-provider.ts`, Anzeige.
- **Vorgehen:** Das Angebot enthält Preise in msat und in Lamports – oder in einer
  Einheit plus Kursquelle. Kurs = Median der Kurs-Events mehrerer
  Liquiditätsgeber; optional Plausibilitätsabgleich mit einem On-Chain-Orakel
  (nur lesen). Abweichung über einem Schwellwert → sichtbare Warnung.
- **Abnahme:** Tests für Median, Umrechnung und Warnung; jede Preisanzeige zeigt
  beide Einheiten.

---

## 4.5 Verdienen in SOL

- **Stellen:** `packages/node/src/main.ts`, `settlement.ts`, `dvm-provider.ts`,
  Verdienen-Tab, `scripts/install-freedom.sh`.
- **Vorgehen:** Knoten-Einstellung `NODE_SOL_PAYOUT` (Hauptadresse) plus frische
  Empfangsadressen je Sitzung aus dem Knoten-Seed (SLIP-10, Index hochzählen,
  Zustand speichern). Adressen gehen nur verschlüsselt an den Kunden.
  Zusammenführen optional, zeitversetzt und mit Warnung. Verdienen-Tab: Einnahmen
  je Schiene, offene Kanäle, Fristen.
- **Abnahme:** Tests.
- **MENSCH:** auf Devnet einen Provider nur in SOL verdienen und abheben lassen.

---

## 4.6 Swaps in beide Richtungen

- **Stellen:** `swap.ts`, `timelock.ts`, `packages/app/src/swap-client.ts`,
  `packages/node/src/lp-daemon.ts`, `refund-watcher.ts`, HTLC-Programm.
- **Vorgehen:**
  1. **Lightning → SOL (besteht):** Einlösen nur bis `T_sol − 10 Minuten`;
     `skipPreflight` nie – eine gescheiterte Einlösung auf der Kette macht das
     Preimage öffentlich.
  2. **SOL → Lightning (neu):** Die Wallet des Kunden erzeugt eine Rechnung; der
     Kunde sperrt SOL mit deren Payment-Hash (Empfänger LP, Frist T_sol). Der LP
     bezahlt die Rechnung mit einem `cltv_limit`, sodass jede Lightning-Frist
     sicher vor T_sol endet, erfährt das Preimage und löst damit die SOL ein.
     Regel: Lightning-Frist + Sicherheitsabstand < T_sol. `timelock.ts` um diese
     Richtung erweitern und testen.
  3. **Gegen Blockaden:** kleine Vorab-Gebühr, bevor der LP sperrt; kurze Fristen,
     begründet in `docs/SWAPS.md`.
  4. **Für Nutzer ohne SOL:** Einlösung mit separatem Fee-Payer (Relayer), der
     Empfänger signiert weiterhin; Mindestmiete des Zielkontos prüfen.
  5. **LP-Daemon** mit eingeschränkter Macaroon (nur Rechnungen und Zahlungen),
     nie `admin.macaroon`; Anleitung mit `lncli bakemacaroon` in `docs/SWAPS.md`.
- **Abnahme:** Tests beider Richtungen inklusive Ablauf und Rückzahlung.
- **MENSCH:** Devnet plus Lightning-Testnet (etwa Polar).

---

## 4.7 SOL-Trinkgeld

- **Stellen:** `packages/app/src/chat-zap.ts`, `packages/protocol/src/zap.ts`.
- **Vorgehen:** Beleg-Event mit Transaktionssignatur, Betrag und Bezug; als
  NIP-Entwurf in `docs/NIP-SOL-TIP.md`. Privat per Gift-Wrap an den Empfänger,
  öffentlich nur auf Wunsch. Prüfung gegen die Kette (Empfänger und Betrag).
- **Abnahme:** Tests mit gefälschter Signatur und falschem Betrag.

---

## 4.8 Belege mit Empfängerprüfung

- **Stellen:** `packages/protocol/src/fee-proof.ts` (`verifyFeeProof`),
  `packages/node/src/settlement.ts`, „Zahlung prüfen“ in der App.
- **Vorgehen:**
  1. **Solana:** Transaktion laden, Empfänger und Beträge gegen die angekündigten
     Empfänger prüfen.
  2. **Lightning:** vollständige bolt11 in den Beleg; deren Signatur prüfen
     (Empfängerknoten), `sha256(preimage) == payment_hash`, Empfängerknoten gegen
     den angekündigten Knoten. Bei verwahrenden Diensten mit gemeinsamem Knoten:
     Status „angekündigt“, nie „belegt“.
- **Abnahme:** Tests: falscher Empfänger → ungültig (beide Schienen), richtiger
  Empfänger → belegt.

---

## 4.9 Privatsphäre auf Solana

- **Vorgehen:** frische Adresse je Sitzung, Swap und Zahlung überall
  (`deriveSolana(seed, n)` über die Rails); keine SOL-Adresse mehr im Profil (Feld
  entfernen, alte Einträge beim nächsten Speichern löschen); Betragsrauschen aus
  `swap-privacy.ts` für alle SOL-Zahlungen; der RPC-Pool verteilt Anfragen.
- **Abnahme:** Leak-Regeln „keine Verknüpfung von npub und SOL-Adresse in
  öffentlichen Events“ und „keine wiederverwendete Adresse“ grün.
