# Phase 5 – Offen und dezentral

---

## 5.1 Gebührenmodell umsetzen

- **Voraussetzung:** Entscheidung 4.0 – **entschieden: A+** (26.09.2026). Feste
  Aufteilung direkt beim Zahlen: 94 % Provider, 2,5 % Entwicklung, 1,5 % Relays,
  0,5 % Werber des Kunden, 0,5 % Werber des Providers, 1 % Hosting (Regeln in
  `docs/GEBUEHREN-ENTSCHEIDUNG.md`). Die Protokollgebühr wird zu dieser
  Aufteilung; Pool, feste Werbe-Adresse, Werbe-Stufen, Treasury und Sweep
  fallen weg; **das Werben bleibt** (eine Ebene je Seite, direkt bezahlt); die
  App-Gebühr geht im Entwicklungsanteil auf. Punkt 3 unten gilt entsprechend:
  Werben-Tab zeigt Werbelink und echten Verdienst statt Stufen.
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
- **Aufteilung (27.09.2026, mehr als 400 Zeilen):** Heute zahlt der Kunde dem
  Provider alles, und dessen Knoten zahlt Pool, Werbe-Pool und App-Gebühr aus
  (`settlement.ts`). Bei A+ zahlt die App des Kunden jeden Anteil selbst; der
  Provider stellt nur seinen in Rechnung.
  - **5.1.1 – FERTIG:** Protokoll-Baustein `aufteilung.ts`: feste Anteile
    (CI-Invariante), `teileAuf()` (nicht Zuordenbares und Rundungsreste an den
    Provider, Relays höchstens drei zu gleichen Teilen, SOL vorerst ganz an den
    Provider – bis 4.3), Deklaration im versiegelten Auftrag
    (`aufteilungTag()`), Prüfung beim Provider (`pruefeAufteilung()`, höchstens
    10 %) und derselbe Rechnungsbetrag auf beiden Seiten (`providerAnteilMsat()`).
  - **5.1.2 – FERTIG:** Knoten: Rechnung nur über den eigenen Anteil (Deklaration
    geprüft); ohne Deklaration der ganze Betrag; keine Auszahlungen an Pool und
    Werbe-Pool mehr (`pool-distributor.ts`, Werbe-Adresse der Konfiguration);
    Angebot nennt den Werber des Providers.
  - **5.1.3 App:** zahlt die Anteile direkt über die Schienen, unter 100 sats je
    Empfänger gebündelt (bleibt bis dahin beim Kunden); Werbelink trägt die
    Zahladressen des Werbers; Relays mit Zahladresse (NIP-11 → Profil); die
    App-Gebühr (`client-fee.ts`) geht im Entwicklungsanteil auf. Aufgeteilt:
    - **5.1.3a – FERTIG:** Zahlung im echten Pfad (`shell/ki-zahlung.ts`):
      Provider-Anteil an die Lightning-Adresse aus dem Angebot, übrige Anteile
      über die Kasse (`anteile-kasse.ts`), Deklaration im Kern, höchstens das
      Gebot, erst Rechnung dann Geld, unklar nie wiederholt; App-Gebühr
      entfernt, Entwicklung ohne Adresse bis MENSCH (`ENTWICKLUNG`); Texte.
    - **5.1.3b – FERTIG:** Werber des Kunden (Werbelink `?ref=<pk>&ln=<lud16>`,
      gemerkt ohne öffentliche Nennung, `werbung.ts`) und Relays des Pools, über
      die der Auftrag geht (NIP-11 `pubkey` → Profil `lud16`, höchstens drei,
      `relay-zahlziel.ts`).
  - **5.1.4 Aufräumen:** `protocol-fee.ts` (Pool/Werbe-Pool), `referral-graph.ts`,
    `treasury*.ts`, `reward-claim.ts`, `rewards.ts`, Bonuslogik in
    `scarcity.ts`; Werben-Tab → „Einladen“; Texte in App und Website. Abnahme
    wie oben. Aufgeteilt:
    - **5.1.4a – FERTIG:** Protokoll + Knoten: `treasury*.ts`,
      `arweave-mirror.ts`, `rewards.ts`, `client-fee.ts`, Bonuslogik in
      `scarcity.ts`, Treasury-Konstanten; Sweep und Spiegel im Knoten; alte
      App-Kopie `packages/website/freedom.html`. Abnahme-Suche leer.
    - **5.1.4b – FERTIG:** Earn-Tab: Belohnungsantrag, Rangliste, Werbe-Stufen
      und Rechner raus; `referral.ts`, `referral-graph.ts` (Nennung →
      `werbe-nennung.ts`), `reward-claim.ts`. Werben zeigt Link, Zählung der
      Nennungen und dass der Verdienst in der eigenen Wallet ankommt (Karte:
      „Werbelink und echten Verdienst statt Stufen“ – den Verdienst kennt nur
      die Wallet).
    - **5.1.4c:** `protocol-fee.ts` (samt CI-Schritt „Fee-Konstanten“ und
      Knoten-Test), `fee-proof.ts` (`preimageMatches` bleibt), Aufgaben-Topf
      und Aufgaben aus Gebühren-Belegen in `quests.ts`; Website (auch
      Dashboard-Stufen), PROTOCOL.md §3/§16.

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

## 5.3 Hosting-Spiegel – CODE FERTIG (27.09.2026)

> Umsetzung: a Platzhalter, Quellen, Hosting-Anteil; b Torrent, IPFS-CID, Job `spiegel` in `pages.yml` (nur beim Release); c Blossom, Arweave, Codeberg. Offen nur MENSCH: Konten und Secrets nach `docs/KONTEN.md`.

> **Entschieden 27.09.2026 (MENSCH):** Die Konten legt der MENSCH an – Liste mit
> Vorschlägen in `docs/KONTEN.md`; bis dahin Platzhalter (`PLATZHALTER:…`), die
> der Code wie „nicht gesetzt“ behandelt. Geteilt: **5.3a** Platzhalter,
> Quellen auf der Startseite, Hosting-Anteil aus `freedom-spiegel.json`;
> **5.3b** Torrent (Webseed), IPFS (CID selbst gerechnet, Pinata) und CI-Job
> (nur beim Release, überspringt fehlende Konten); **5.3c** Blossom, Arweave,
> Codeberg im selben Job.

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
- **Aufteilung (26.09.2026):**
  - **5.4a – FERTIG:** Startliste mit acht Relays verschiedener Betreiber
    (`protocol/src/relay-start.ts`, per NIP-11 geprüft); jeder Nutzer bekommt
    einen festen Satz (vier zufällige), veröffentlicht als NIP-65-Liste
    (Kind 10002) und Posteingang (Kind 10050) – die veröffentlichte Liste gilt,
    so bleiben alle Geräte einer Identität beim selben Satz; je Sitzung drei
    weitere wechselnd; Direktnachrichten nur an den Posteingang des
    Empfängers; Knoten, Releases und Dashboard auf der ganzen Startliste.
    Abnahme im Browser: damus, nos.lol, nostr.band tot → Listen, DMs in beide
    Richtungen und KI-Anfrage an einen echten Knoten gehen.
  - **5.4b:** Lesen bei den Schreib-Relays der Kontakte (Outbox beim Lesen:
    Profile, Räume, Kontaktlisten); eigener Satz in den Settings sichtbar und
    änderbar. Danach kann der wechselnde Teil kleiner werden. Geteilt:
    - **b1 – FERTIG:** Outbox beim Lesen – `outboxPlan()` (Protokoll: je Autor
      seine Schreib-Relays aus der geprüften NIP-65-Liste, gebündelt, höchstens
      drei je Autor und acht insgesamt), `OutboxLeser` (App, Listen zehn Minuten
      gemerkt, fremde Relays nur mit gültiger Signatur und gefragtem Autor).
      Gelesen so: Schlüsselwechsel-Mandate der Kontakte, Geräte-Vollmachten,
      Posteingänge (Kind 10050), das Profil beim Zap. Kontaktlisten anderer
      liest die App nicht; Räume sind Spur B (2.3).
    - **b2 – FERTIG:** eigener Satz in den Settings (Verbindung → „Nostr-Relays
      (dein Satz)“) sichtbar und änderbar: Eingabe geprüft (nur wss://,
      unverschlüsselt nur .onion, kein lokales Netz, höchstens acht, einer
      taugt als Posteingang), dann NIP-65-Liste und Posteingang weit neu
      veröffentlicht, erst danach gemerkt und gleich in den Pool genommen;
      als Gerät nur lesbar. Der wechselnde Teil bleibt bei drei: Er dient
      dem Finden der Listen anderer, und die Outbox (b1) liest nur bei
      Autoren mit bekannter Liste.
  - **5.4c (mit 8.4, seit 27.09. Spur B):** Relay-Rolle des Knotens mit NIP-42
    und bezahltem Zugang in Sats oder SOL. Geteilt:
    - **8.4a – FERTIG:** Relay als Posteingang – NIP-42, Umschläge nur an den
      angemeldeten Empfänger (einstellbar, beschränkt immer), Zugang aus einem
      Zugangsbuch (nur von und an Schlüssel mit Zugang), ersetzbare/flüchtige
      Events, `limit`, NIP-40, NIP-11 mit dem Schlüssel des Betreibers.
    - **8.4b – FERTIG:** Zugang kaufen – Sats über eine Rechnung des eigenen
      LND (nur `invoices`-Rechte), SOL an die Adresse des Betreibers mit einer
      Referenz nach Solana Pay, auf der Kette geprüft; Preise in NIP-11; Events
      überdauern einen Neustart.
    - **8.4c – FERTIG:** App – anmelden nur auf Verlangen und nur bei eigenen
      Relays und solchen mit gekauftem Zugang (nie mit einem Sitzungsschlüssel),
      Zugang über die Zahlschienen kaufen (SOL mit Referenz), Abnahme im
      Browser: ein Relay wird nachweislich für die Zustellung bezahlt.
  - **.onion:** Kein Betreiber der Startliste veröffentlicht eine
    .onion-Adresse, die sich prüfen ließ. MENSCH: eine geprüfte .onion-Adresse
    (etwa den Relay des GX10 als Hidden Service) – dann kommt sie in die Liste.

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
