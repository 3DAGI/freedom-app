# Ablauf des Liquiditätsgebers neben Boltz – Vergleich (A-22)

Stand 10.10.2026, Spur A. Sammlung A-22 (Anhang E): Boltz tauscht seit Jahren Lightning gegen
Bitcoin (und Liquid, Rootstock), ohne fremdes Geld zu verwahren. Was macht es anders als der
Ablauf in `docs/SWAPS.md` (LP-Daemon `node/src/lp-daemon.ts`, App `swap-client.ts`,
`tabs/tausch.ts`)? Nur ein Vergleich. Was zu tun ist, steht als eigene Punkte in der Sammlung
(A-27, A-28).

Begriffe: Bei Boltz ist der „Reverse Swap“ Lightning → Kette, bei uns Richtung 1 (Lightning →
SOL). Der „Normal Submarine Swap“ ist Kette → Lightning, bei uns Richtung 2 (SOL → Lightning).

## Die Abläufe nebeneinander

| | Boltz | Freedom |
|---|---|---|
| **Richtung 1** (Lightning → Kette): Reihenfolge | Erst zahlt der Kunde die Hold-Invoice (die Zahlung hängt), **dann** sperrt Boltz auf der Kette (`transaction.mempool`). Kann Boltz nicht sperren, bricht es die Zahlung ab (`transaction.failed`), der Kunde zahlt nichts. | Erst sperrt der LP SOL, dann stellt er die Hold-Invoice. Die App gibt das Zahlen erst frei, wenn die Sperre auf der Kette passt (`verifyCounterpartyLock`). Gegen Blockaden verlangt der LP vorher eine kleine Gebühr (`vorab_sats`, 4.6d). |
| Richtung 1: Frist der Rechnung | Die Rechnung läuft nach der Hälfte der Swap-Frist ab, damit nach dem Zahlen Zeit zum Einlösen bleibt. | Die App zahlt nur mit genug Restzeit auf der Kette (`solFristKnapp`) und nur, wenn Lightning um mindestens 30 Minuten länger läuft als die Sperre (`minGap`). |
| Richtung 1: nicht eingelöst | Boltz holt seine Sperre nach Ablauf zurück (`transaction.refunded`). | Ebenso, und erst danach bricht der LP die Hold-Invoice ab (Reihenfolge Pflicht, `holeAbgelaufeneZurueck()`). |
| **Richtung 2** (Kette → Lightning): Prüfung der Sperre | Eine Bestätigung (Null-Bestätigung nur bei kleinen Beträgen und ausgewählten Paaren). | Bestätigung „confirmed“ (`SolanaAdapter`); Empfänger, Betrag, Hashlock, Frist und Rechnung geprüft (`pruefeRueckSwapSperre`). |
| Richtung 2: Zahlung scheitert | `invoice.failedToPay` – Boltz **signiert sofort eine Rückgabe** (kooperativ, MuSig2 über den Taproot-Schlüssel); der Kunde muss nicht bis zum Ablauf warten. | `GESCHEITERT` – der Kunde holt seine SOL erst nach `T_sol` zurück (Stunden). Das HTLC-Programm kennt keine Rückgabe vor Ablauf. |
| Richtung 2: falscher Betrag | `transaction.lockupFailed`, danach Rückgabe wie oben. | `ABGELEHNT`, Rückholen nach `T_sol`. |
| Statusmeldungen | fein gestuft, über WebSocket; der Kunde soll trotzdem selbst prüfen. | wenige feste Texte (`EINGELOEST`, `GESCHEITERT`, `ZU_SPAET`, `ABGELEHNT`, `VORAB`), versiegelt; es zählt nur die Kette. |
| Rückholen durch den Kunden | Boltz überwacht Rückgaben der Kunden nicht. | Der Rückhol-Wächter der App holt fällige Sperren zurück, solange sie offen ist. |
| Neustart des Gebers | – (Dienst) | Sitzungen werden vor dem Zahlen bzw. Sperren gespeichert; nach einem Neustart fragt der LP LND nach dem Stand und zahlt nie ein zweites Mal. |

## Befunde

- **B1 – Reihenfolge in Richtung 1 (→ A-27, Entscheidung).** Bei Boltz bindet der Geber kein
  Kapital, bevor der Kunde gezahlt hat. Die Zahlung hängt dabei nur, und ohne Preimage kann
  Boltz nicht abrechnen. Deshalb braucht Boltz keine Vorab-Gebühr. Bei uns sperrt der LP zuerst,
  daher die Vorab-Gebühr (4.6d): eine zweite Zahlung, ein zweiter Schritt für den Kunden.
  Umgedreht hinge das Risiko einer Blockade beim Kunden: Ein LP, der nie sperrt, hielte dessen
  sats bis zum Ende der Hold-Invoice fest (Geld geht nicht verloren). Außerdem fiele unsere
  Regel „erst zahlen, wenn die Gegenleistung auf der Kette liegt“. Dafür ändern sich Ablauf und
  Nachrichten zwischen App und LP (STOPP-Punkt „Event-Formate“). **Frage an den MENSCHEN:**
  bleiben (Vorab-Gebühr, der Kunde prüft vor dem Zahlen) oder wie Boltz (keine Vorab-Gebühr,
  der Kunde zahlt zuerst in eine Hold-Invoice)? Vorschlag Spur A: bleiben. Die Prüfung vor dem
  Zahlen ist einfacher zu erklären, und die Vorab-Gebühr ist klein (Standard 10 sats).
- **B2 – Rückgabe vor Ablauf in Richtung 2 (→ A-28, Entscheidung).** Scheitert die Zahlung des
  LP, wartet der Kunde bei uns bis `T_sol`, oft Stunden. Bei Boltz gibt der Geber sofort frei.
  Dafür bräuchte das HTLC-Programm eine Anweisung „zurückgeben“, die nur der Empfänger (der LP)
  signiert und die das Geld nur an den Sperrenden zurückgibt. Das ist eine Programmänderung mit
  Upgrade (und die Programm-ID ist noch ungeklärt, 0.G): **nur mit Entscheidung des MENSCHEN.**
  Vorschlag Spur A: ja, aber erst zusammen mit der Klärung von 0.G. Bis dahin bleibt Rückholen
  nach Ablauf.
- **Gleich oder besser:** Frist der Rechnung (bei uns geprüft statt verkürzt), Rückholen nach
  Ablauf in der richtigen Reihenfolge, Prüfung der Sperre vor dem Zahlen (Richtung 2),
  Wiederanlauf ohne doppelte Zahlung, Rückhol-Wächter beim Kunden. Kein Punkt.
- **Nicht übertragbar:** Null-Bestätigung (Solana bestätigt in Sekunden), RBF (gibt es auf Solana
  nicht), Claim-Covenants (Liquid).

## Quellen

Boltz-Backend, Doku „Swap Lifecycle“ (`docs/lifecycle.md` im Repository
`BoltzExchange/boltz-backend`, gelesen am 10.10.2026); `docs/SWAPS.md` und der Code von
LP-Daemon und App.
