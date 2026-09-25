# Swaps zwischen Lightning und Solana

Stand 25.09.2026 (Schritt 4.6). Atomar über denselben Hash: Wer das Preimage
kennt, kann auf beiden Seiten einlösen; läuft eine Frist ab, geht das Geld an
den zurück, der gesperrt hat. Niemand verwahrt fremdes Geld.

## Richtung 1: Lightning → SOL (besteht)

1. Der Kunde erzeugt das Preimage R und schickt nur H = SHA256(R) an den LP.
2. Der LP sperrt SOL im HTLC (Hashlock H, Frist T_sol, Empfänger = Kunde).
3. Der LP stellt eine Hold-Invoice mit Payment-Hash H aus; der Kunde zahlt,
   die Zahlung bleibt in der Schwebe.
4. Der Kunde löst die SOL ein und legt dabei R offen.
5. Der LP liest R von der Kette und rechnet die Hold-Invoice ab.

**Fristregel:** Lightning muss **länger** laufen als Solana – sonst könnte der
Kunde R erst nach Ablauf der Lightning-Frist offenlegen:
`T_lightning (Blöcke · 10 min) ≥ T_sol + 1 h` (`validateTimelockOrdering`).

**Einlösen:** nur bis `T_sol − 10 Minuten` (`claimAllowed()`), mit
Vorabsimulation – **nie `skipPreflight`**: Eine gescheiterte Einlösung legt R
auf der Kette offen, der LP könnte abrechnen, und der Kunde stünde ohne SOL da.

## Richtung 2: SOL → Lightning (neu, 4.6)

1. Die Wallet des Kunden erstellt eine normale Rechnung über die sats. R
   bleibt in der Wallet; bekannt ist nur H.
2. Der Kunde sperrt SOL im HTLC (Hashlock H, Frist T_sol, Empfänger = LP).
3. Der LP prüft die Sperre auf der Kette – Empfänger, Betrag, Hashlock gleich
   dem Hash der Rechnung, nicht abgeschlossen, Frist lang genug – und die
   Rechnung (Signatur, Betrag, Hash; `leseBolt11`, `pruefeRueckSwapSperre`).
4. Der LP zahlt die Rechnung mit **`cltv_limit`** und erfährt dabei R.
5. Mit R löst der LP die SOL ein – wieder nur bis `T_sol − 10 Minuten`.

**Fristregel (umgekehrt):** Hier muss Lightning **vor** Solana enden. Sonst
hält der Kunde R zurück, bis T_sol vorbei ist, holt seine SOL zurück *und*
nimmt die Lightning-Zahlung an. Weil langsame Blöcke die Lightning-Frist
verlängern, rechnen wir mit 20 Minuten je Block:
`cltv_limit · 20 min + 1 h ≤ T_sol` (`validateReverseTimelock`,
`maxCltvLimitFuer`). Dann gilt immer eines: R kommt vor Ablauf der
Lightning-Frist (und der LP hat noch mindestens eine Stunde zum Einlösen),
oder die Zahlung scheitert und der LP behält seine sats.

**Fehlerfälle ohne Verlust** (`packages/protocol/test/swap-umgekehrt.test.ts`):
LP zahlt nicht → Kunde holt nach T_sol zurück; Kunde hält R zurück → Zahlung
läuft ab, LP behält sats, Kunde holt SOL; falscher Hashlock, zu wenig,
fremder Empfänger, zu kurze Frist → LP zahlt gar nicht erst.

## Gegen Blockaden (geplant: 4.6b)

Wer sperrt, bindet Kapital – ein Angreifer könnte Swaps anstoßen und nie
abschließen:

- **Lightning → SOL:** Der LP sperrt zuerst. Er verlangt vorab eine kleine,
  nicht erstattbare Gebühr (eigene kleine Rechnung), bevor er SOL sperrt, und
  hält T_sol kurz (Stunden, nicht Tage).
- **SOL → Lightning:** Der Kunde sperrt zuerst; das Risiko des LP ist eine
  Hold-Zahlung, die bis zum `cltv_limit` hängt. Kleines `cltv_limit`, eine
  Obergrenze gleichzeitiger Zahlungen je Kunde und ein Aufschlag im Kurs
  begrenzen das.

## Für Nutzer ohne SOL (geplant: 4.6c)

Einlösen kostet eine Transaktionsgebühr. Wer noch kein SOL hat, kann es nicht
bezahlen. Lösung: ein Relayer als `feePayer`; der Empfänger signiert weiterhin
selbst, der Relayer kann nichts umleiten. Vor dem Einlösen prüfen, ob das
Zielkonto die Mindestmiete (rent-exempt) erreicht – sonst scheitert die
Überweisung.

## LP-Daemon: eingeschränkte Macaroon

Der LP-Daemon braucht nur Rechnungen und Zahlungen – **nie
`admin.macaroon`**. Eine passende Macaroon backen:

```bash
lncli bakemacaroon --save_to=freedom-lp.macaroon \
  info:read invoices:read invoices:write offchain:read offchain:write
```

`invoices:*` erlaubt Hold-Invoices (anlegen, abrechnen, abbrechen),
`offchain:*` Zahlungen samt `cltv_limit`. Kein `onchain`, keine `peers`,
kein `macaroon`: Wer den Daemon übernimmt, kann weder On-Chain-Geld bewegen
noch Kanäle schließen noch sich weitere Rechte backen. Die Datei gehört nur
dem Nutzer, unter dem der Daemon läuft (`chmod 600`).
