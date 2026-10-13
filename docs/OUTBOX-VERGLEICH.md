# Relay-Auswahl im Outbox-Modell – Vergleich (A-23)

Stand 10.10.2026, Spur A. Sammlung A-23 (Anhang E): Wie wählen NDK, Welshman und applesauce
die Relays, an denen sie nach den Events bestimmter Autoren fragen? Und was folgt daraus für
`outboxPlan()` (`protocol/src/relay-start.ts`, 5.4b) und `OutboxLeser`
(`app/src/outbox-lesen.ts`)? Nur ein Vergleich. Was zu tun ist, steht als eigene Punkte in der
Sammlung (A-24, A-25, A-26).

## Wie Freedom heute wählt

1. Die NIP-65-Listen (10002) der Autoren kommen aus dem eigenen Pool und bleiben zehn Minuten im
   Speicher. Nur gültig signierte zählen, je Autor die neueste.
2. `outboxPlan()` nimmt je Autor höchstens die ersten drei Schreib-Relays (`OUTBOX_JE_AUTOR`).
   Es zählt je Relay die Autoren und nimmt die acht mit den meisten (`OUTBOX_MAX_RELAYS`); bei
   Gleichstand entscheidet die Adresse.
3. `OutboxLeser.frage()` streicht danach die Relays, die schon im Pool sind (die fragt der Pool),
   und fragt die übrigen einzeln über Nebenverbindungen (A-16).
4. Autoren ohne Liste fragt nur der Pool.

## Die drei Bibliotheken (Quelltext gelesen am 10.10.2026)

| | NDK 3.0.3 | Welshman (`@welshman/router` 0.8.16) | applesauce (`applesauce-core` 6.2.0) |
|---|---|---|---|
| Ziel je Autor | **2 Relays je Autor** (`relayGoalPerAuthor`) | keins; Gewicht je Relay | `maxRelaysPerUser` – ein Autor fällt aus der Rechnung, sobald so viele seiner Relays gewählt sind |
| Auswahl | Je Autor zuerst Relays, mit denen schon eine Verbindung besteht, dann Relays, die schon für andere gewählt sind, dann die beliebtesten seiner Liste | Summe der Gewichte je Relay, Wertung `Qualität · (1 + ln Gewicht) · Zufall`, die besten `limit` (Vorgabe 3) | **Gierige Mengenüberdeckung:** immer das Relay, das die meisten *noch nicht abgedeckten* Autoren erreicht, bis `maxConnections` |
| Obergrenze Verbindungen | keine | `limit` je Abfrage | `maxConnections` |
| Bestehende Verbindungen | bevorzugt | nicht eigens | nicht eigens |
| Unsichere Adressen | – | `ws://` (außer .onion), .onion und lokale nur auf Wunsch | – (eigene Filter `removeBlacklistedRelays`) |
| Ohne Liste | Relays des Pools | Rückfall auf Standard-Relays, wenn nichts übrig bleibt | `setFallbackRelays` |
| Qualität | – | `getRelayQuality()` (Fehler der Verbindung) | über eine eigene `score`-Funktion |
| Listen holen | aus Cache und Pool, eigene „outbox relays“ möglich | **Indexer-Relays** für 0, 3, 10002, 10050 | über den Event-Speicher |

Alle drei stehen unter MIT. Keine wird eingebunden; es geht nur um den Ablauf.

## Befunde

- **B1 – Abdeckung (→ A-24).** Freedom zählt Autoren je Relay einmal und nimmt die acht
  meistgenannten. Wer nur auf seltenen Relays schreibt, fällt heraus, auch wenn ein Platz für ihn
  reichte. Beispiel: Fünf Autoren teilen zwei Relays, fünf andere haben je drei eigene. Freedom
  wählt die zwei geteilten und sechs der seltenen nach der Reihenfolge der Adressen. Welche der
  fünf anderen dabei sind, entscheidet das Alphabet, im ungünstigen Fall nur zwei. Die gierige
  Überdeckung von applesauce erreicht mit denselben acht Plätzen alle zehn. Dazu kommt: Relays aus dem Pool belegen in `outboxPlan()` einen der acht Plätze und
  werden erst danach gestrichen. Es öffnen sich also weniger als acht fremde Relays, und Autoren,
  die der Pool schon abdeckt, verdrängen andere. NDK rechnet bestehende Verbindungen zuerst an.
  **Vorschlag:** `outboxPlan()` bekommt die Adressen des Pools. Was der Pool abdeckt, zählt als
  abgedeckt und belegt keinen Platz. Danach wählt es gierig in Stufen: jeder Autor erst ein Relay,
  dann das zweite, bis zum Ziel (heute drei, `OUTBOX_JE_AUTOR`), höchstens acht fremde Relays.
  *Umgesetzt mit A-24.*
- **B2 – `ws://` fremder Relays (→ A-25).** `schreibRelays()` lässt `ws://` durch. Aus der
  Pages-Fassung (https) blockt der Browser solche Verbindungen (gemischte Inhalte); sie kosten nur
  einen Platz. In der Hülle gingen sie unverschlüsselt hinaus, und jeder auf dem Weg sähe, nach
  welchen Autoren die App fragt. Welshman lässt `ws://` außer .onion nur auf Wunsch zu.
  **Vorschlag:** Für fremde Relays im Outbox-Plan nur `wss://` nehmen, dazu `ws://…onion`, wenn
  der Weg über Tor geht. Eigene Relays (Satz, Knoten im Heimnetz) bleiben, wie sie sind. *Umgesetzt
  mit A-25.*
- **B3 – Kaputte Relays (→ A-26).** Ein fremdes Relay, das nicht antwortet, fragt Freedom bei der
  nächsten Abfrage wieder, und es kostet wieder einen Platz. Welshman wertet nach Qualität.
  **Vorschlag:** Nebenverbindungen merken sich Fehlschläge nur im Speicher, eine Viertelstunde
  lang. So lange plant `outboxPlan()` das Relay nicht ein. Keine Rangliste, nichts gespeichert. *Umgesetzt
  mit A-26.*
- **B4 – Indexer: bewusst nicht.** Welshman holt Listen (0, 3, 10002, 10050) von Indexer-Relays
  wie purplepag.es. So findet es Listen, die im eigenen Pool fehlen. Ein Indexer erführe aber,
  wessen Listen man sucht, also den Kreis der Kontakte. Freedom liest Listen weiter nur im Pool
  (eigener Satz plus wechselnd weitere aus der Startliste). Kein neuer Punkt; ändern nur mit
  Entscheidung.
- **B5 – Posteingang: gleich.** Umschläge (1059) gehen bei Welshman wie bei Freedom an die
  Posteingangs-Relays (10050) des Empfängers (`veroeffentlicheAn()`). Kein Punkt.
- **Zufall:** Welshman mischt Zufall in die Wertung, um die Last zu verteilen. Bei Freedom
  wechseln die weiteren Relays des Pools schon (`poolRelays()`). Die Auswahl im Outbox-Plan darf
  fest bleiben, damit Tests ohne Zufall auskommen. Kein Punkt.

## Quellen

Quelltext aus npm: `@nostr-dev-kit/ndk` 3.0.3 (`src/outbox/index.ts`,
`src/outbox/relay-ranking.ts`, `src/outbox/read/with-authors.ts`), `@welshman/router` 0.8.16
(`dist/index.js`), `applesauce-core` 6.2.0 (`dist/helpers/relay-selection.js`).
