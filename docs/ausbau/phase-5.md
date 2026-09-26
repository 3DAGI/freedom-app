# Phase 5 – Offen und dezentral

---

## 5.1 Gebührenmodell umsetzen

- **Voraussetzung:** Entscheidung 4.0.
- **Bei Option A:**
  1. `protocol-fee.ts`: Protokollgebühr 0; Konstanten, Tests und CI-Invarianten anpassen.
  2. `referral.ts`, `referral-graph.ts`, `pool-distributor.ts`, `treasury.ts`,
     `treasury-sweep.ts`, `reward-claim.ts`, `rewards.ts` und die Bonuslogik in
     `scarcity.ts` entfernen oder in „gesponserte Pools“ (5.1b) überführen.
  3. Werben-Tab → „Einladen“ mit Gratis-Kontingent; Rangliste und XP aus
     Selbstauskunft entfernen.
  4. App-Gebühr: Empfänger selbstverwahrt (eigener `lnurl-server.ts` bzw.
     SOL-Adresse), Wert offen deklariert.
  5. Texte in App und Website anpassen.
- **Abnahme:** `grep -rn "walletofsatoshi\|TREASURY_\|SET_BEFORE_MAINNET" packages/`
  ist leer; keine Adresse im Code empfängt Geld Dritter; entfernte Tests sind im
  Bericht einzeln begründet.

## 5.1b Gesponserte Pools (Solana-Programm)

- **Stellen:** neu `contracts/sponsored-pool/`.
- **Vorgehen:** Ein Sponsor legt Betrag, Regeln (als Text-Hash) und einen
  Prüfschlüssel fest. Auszahlungen nur mit Signatur dieses Prüfschlüssels; nach
  Ablauf holt der Sponsor den Rest zurück. Die App zeigt Pools mit ihren Regeln an.
- **Abnahme:** anchor-Tests für alle Pfade. **MENSCH:** Devnet-Deploy.

---

## 5.2 Releases k-von-n signiert – CODE FERTIG (26.09.2026)

> Umsetzung: Nostr-Events tragen je eine Signatur – „mehrere Signaturen über dieselbe Nutzlast“ heißt deshalb: jeder Signierer veröffentlicht sein Manifest, die App zählt verschiedene vertrauenswürdige Signierer je Nutzlast (`nutzlast()` = Version + Dateien). Offen nur MENSCH: Schlüssel und `TRUSTED_SIGNERS`.

- **Stellen:** `packages/protocol/src/release.ts`, `scripts/publish-release.mjs`,
  `TRUSTED_SIGNERS`, Echtheitsprüfung in der App.
- **Vorgehen:** Ein Manifest trägt mehrere Signaturen über dieselbe Nutzlast; die
  App verlangt k gültige Signaturen aus `TRUSTED_SIGNERS` (k als Konstante, etwa
  2); Updates nur nach Bestätigung durch den Nutzer; Version fixierbar.
- **Abnahme:** Tests: eine Signatur → abgelehnt; zwei → akzeptiert; fremde
  Signaturen zählen nicht.
- **MENSCH:** zweite und dritte Person bzw. Gerät für Signierschlüssel.

## 5.3 Hosting-Spiegel

- **Vorgehen:** `scripts/mirror/` mit Skripten für Codeberg Pages, IPFS (CID
  berechnen, Pinning), Arweave, Blossom/Nostr und Torrent (Magnet-Link). Das
  Manifest listet alle Quellen; die Startseite zeigt sie.
- **MENSCH:** Konten und Schlüssel für die Dienste.

## 5.4 Relays: Outbox-Modell

- **Stellen:** `outbox.ts`, `relay-discovery.ts`, Start-Liste der App,
  `packages/node/src/relay-role.ts`.
- **Vorgehen:** NIP-65-Relaylisten lesen und schreiben; an eigene Schreib-Relays
  veröffentlichen, von den Schreib-Relays der Kontakte lesen. Start-Liste mit
  mindestens acht Relays verschiedener Betreiber inklusive .onion, rotierend.
  Relay-Rolle des Knotens mit NIP-42 und bezahltem Zugang in Sats oder SOL.
- **Abnahme:** Test: Die App funktioniert, wenn die drei heutigen Start-Relays
  nicht erreichbar sind.

## 5.5 Reputation aus Quittungen

- **Stellen:** `performance.ts`, `tiers.ts`, `wot.ts`, Rangliste.
- **Vorgehen:** Eine Quittung signiert der Kunde (Sitzungsschlüssel), mit
  Zahlungsnachweis (Preimage plus bolt11 bzw. Kanal-Abrechnung). Leistung zählt
  nur aus Quittungen. Vertrauen subjektiv ab den eigenen Kontakten des Nutzers –
  die Wurzel ist der Nutzer, nicht das Projekt. Ranglisten nur opt-in.
- **Abnahme:** Test: gefälschte Leistungs-Events ohne Quittung ändern Stufe und
  Rang nicht.

## 5.6 Streitfall-Prüfer subjektiv

- **Stellen:** `disputes-relays.ts`.
- **Vorgehen:** Den Prüfer wählt der Nutzer aus seinem Netz; das Urteil gilt nur
  zwischen den Beteiligten; keine globale Zulassung.

## 5.7 Modellkataloge als NIP-51-Listen

- **Stellen:** `model-registry.ts`, Reiter „Modelle“.
- **Vorgehen:** Ein Katalog ist die NIP-51-Liste eines Kurators; Nutzer
  abonnieren mehrere; keine feste Vorauswahl durch das Projekt.

## 5.8 RPC-Vielfalt

- **Stellen:** `rpc-pool.ts`.
- **Vorgehen:** mindestens vier Anbieter; eigener Endpunkt zuerst; Stichprobe
  (Kontostand, letzter Blockhash) gegen einen zweiten Anbieter, Abweichung → Warnung.

## 5.9 Programme und Quellcode

- **Vorgehen:** `docs/SOLANA-UPGRADE-AUTHORITY.md` – Anleitung für eine
  Squads-Mehrfachsignatur mit Zeitverzögerung (MENSCH führt aus).
  Reproduzierbarer Build `scripts/repro-build.sh` (feste Node-Version, `npm ci`,
  feste Zeitstempel); zwei Builds → dieselbe Summe, geprüft in der CI.
  NIP-34-Spiegel über `git.ts` und eine Radicle-Anleitung.
- **MENSCH:** Repository öffentlich, Squads einrichten.

## 5.10 Zeitanker und Abdeckungskarte

- **Vorgehen:** OpenTimestamps für geld- und namensrelevante Events (Beleg-Hashes
  gebündelt). Abdeckungseinträge (`coverage.ts`) mit einem Wegwerfschlüssel je
  Eintrag; Einwilligungstext ergänzen: Einträge sind auf Relays einzeln sichtbar.
