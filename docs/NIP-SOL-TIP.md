# NIP-Entwurf: SOL-Trinkgeld mit Beleg

`draft` `optional` – Stand 25.09.2026 (Schritt 4.7), Kind **9736** vorläufig.

## Wozu

NIP-57 regelt Lightning-Zaps: Die Quittung schreibt der Lightning-Server des
Empfängers, das Preimage belegt die Zahlung. Für Überweisungen auf Solana gibt
es kein Gegenstück. Eine SOL-Überweisung ist aber selbst öffentlich prüfbar –
es fehlt nur die Verbindung zwischen Überweisung und Nostr-Identität. Dieser
Entwurf liefert sie: Der Zahler schickt einen Beleg mit der Signatur der
Transaktion; jeder, der den Beleg sieht, kann ihn gegen die Kette prüfen.

## Event

```json
{
  "kind": 9736,
  "pubkey": "<Zahler>",
  "content": "<optionale Notiz, höchstens 280 Zeichen>",
  "tags": [
    ["p", "<Empfänger-Pubkey>"],
    ["sol_tx", "<Transaktionssignatur, base58>"],
    ["lamports", "<Betrag, ganze Zahl>"],
    ["sol_to", "<SOL-Adresse des Empfängers>"],
    ["chain", "solana:mainnet" | "solana:devnet" | "solana:testnet"],
    ["e", "<Event-ID, für die es das Trinkgeld gab>"]
  ]
}
```

`e` ist optional, alle anderen Tags sind Pflicht. `lamports` ist eine ganze
Zahl ohne Exponent. Clients lehnen Belege mit ungültigen Angaben ab.

## Adresse erfragen (4.9d)

Statt die Adresse aus dem öffentlichen Profil (Feld `sol` in Kind 0) zu lesen,
fragt der Geber versiegelt (NIP-59) beim Empfänger an; dessen Client antwortet
ebenso versiegelt mit einer Adresse **nur für diesen Geber**:

```
Anfrage  innen Kind 25020, von der Identität des Gebers an die des Empfängers
         tags: ["p", <empfänger>], ["kette", "solana:mainnet"|"solana:devnet"|…]
Antwort  innen Kind 25021, vom Empfänger zurück
         tags: ["e", <id der anfrage>], ["p", <geber>], ["sol_address", <adresse>], ["kette", …]
```

- Der Empfänger antwortet nur bekannten Kontakten und nur auf Anfragen der
  letzten 15 Minuten; jeder Kontakt bekommt eine eigene, stabile Adresse (so
  kann niemand seinen Vorrat leeren, und keine zwei Kontakte sehen dieselbe).
- Der Geber nimmt nur die Antwort des gefragten Empfängers zu seiner Anfrage
  und merkt sich die Adresse.
- Kommt keine Antwort (Empfänger offline, ohne eingebaute Wallet), darf ein
  Client auf das Profilfeld zurückgreifen – nur nach deutlicher Warnung: jedes
  Trinkgeld dorthin ist öffentlich mit dem Empfänger verknüpft.

## Zustellen

**Standard: privat.** Der Beleg ist der Kern eines Gift-Wraps (NIP-59,
Kind 1059) – je ein Umschlag an den Empfänger und an den Zahler selbst (eigene
Kopie, wie NIP-17). Auf den Relays stehen dann weder Betrag noch Adresse noch
Transaktion, und niemand sieht, wer wem ein Trinkgeld gab.

**Öffentlich nur auf Wunsch.** Ein signiertes Kind 9736 auf Relays verknüpft
Nostr-Identität, SOL-Adresse und Transaktion für jeden sichtbar und dauerhaft.
Clients fragen vorher ausdrücklich.

## Prüfen

Ein Beleg ist eine Behauptung. **Belegt** ist ein Trinkgeld erst, wenn die
Transaktion auf der genannten Kette

1. existiert und erfolgreich war (`meta.err` ist `null`),
2. System-Überweisungen an `sol_to` enthält, deren Summe mindestens `lamports`
   beträgt.

Sonst ist der Beleg **unbestätigt** (Transaktion noch nicht gefunden – etwa
eine erfundene Signatur) oder **falsch** (gescheitert, anderer Empfänger,
weniger Geld). Clients zählen dieselbe Transaktion nur einmal.

Die Adresse des Zahlers steht nicht im Beleg: Sie ist aus der Transaktion
ablesbar, gehört aber nicht zwingend zur Nostr-Identität. Der Beleg beweist,
dass jemand an diese Adresse gezahlt hat und der Zahler das behauptet – nicht,
dass das Geld aus der Wallet des Zahlers kam.

## Umsetzung in FreedomStack

- `packages/protocol/src/sol-trinkgeld.ts`: `buildSolTrinkgeld`,
  `parseSolTrinkgeld`, `buildPrivateSolTrinkgeld`,
  `oeffnePrivatesSolTrinkgeld`, `pruefeSolUeberweisung`.
- `RpcPool.getTransaction()` lädt die Transaktion (`jsonParsed`).
- Tests: `packages/protocol/test/sol-trinkgeld.test.ts`.
