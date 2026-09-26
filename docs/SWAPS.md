# Swaps zwischen Lightning und Solana

Stand 26.09.2026 (Schritt 4.6b). Atomar über denselben Hash: Wer das Preimage
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

### Ablauf mit dem LP-Daemon (4.6b)

- **Angebot:** Kind 38001 mit `direction = buy-sol` (`LP_DIRECTION=buy-sol`
  oder `beide`; bei `beide` trägt das Angebot der Gegenrichtung die ID
  `<LP_OFFER_ID>-buy`).
- **Sperre:** Swap-ID ist `rueckSwapId(bolt11)` = SHA-256 der Rechnung (hex).
  Die Sperre legt sich so auf genau diese Rechnung fest: Wer sie auf der Kette
  sieht, kennt zwar H, kann dem LP aber keine eigene Rechnung mit H
  unterschieben (die Zahlung hinge sonst bis zum `cltv_limit`, und der echte
  Kunde bekäme „schon bearbeitet“).
- **Betrag:** `rueckSwapLamports(sats, Kurs des LP, fee_ppm)` – Wert der sats
  plus Gebühr, ganzzahlig aufgerundet. App und LP rechnen mit dieser einen
  Funktion; in Fließkomma läge das Ergebnis manchmal um ein Lamport daneben.
- **Anfrage** (Kind 25001, `p` = LP): `["offer", …]`, `["bolt11", …]`. Das
  SOL-Konto des Kunden ist der Initiator der Sperre – er muss es nicht nennen.
  Die Anfrage erst senden, wenn die Sperre bestätigt ist; kommt sie früher,
  prüft der LP sie noch 10 Minuten lang bei jedem Durchlauf erneut.
- **Antwort** (Kind 25002, `e` = Anfrage): `["status", …]` mit `EINGELOEST`,
  `GESCHEITERT`, `ZU_SPAET` oder `ABGELEHNT` (dann steht der Grund im Inhalt).
  Bei allem außer `EINGELOEST` holt der Kunde seine SOL nach T_sol zurück.
  Öffentlich stehen nur feste Texte des LP, nie Meldungen von LND.
- **`cltv_limit`** = kleinstes von `lnCltvDeltaBlocks` des Angebots und
  `maxCltvLimitFuer(T_sol − jetzt)`.
- **Neustart:** Der LP speichert jede Sitzung, **bevor** er zahlt
  (`~/.freedom/lp-rueck.json`, nur für den Nutzer lesbar, über eine
  Zwischendatei geschrieben). Nach einem Neustart oder Verbindungsabbruch
  fragt `nachholen()` LND nach dem Stand (`/v2/router/track`): erfolgreich →
  Preimage übernehmen und einlösen; gescheitert → abschließen; nie angekommen
  und Frist vorbei → abschließen. Gezahlt wird nie ein zweites Mal.

## Gegen Blockaden

Wer sperrt, bindet Kapital – ein Angreifer könnte Swaps anstoßen und nie
abschließen:

- **Lightning → SOL (geplant: 4.6d):** Der LP sperrt zuerst. Er verlangt
  vorab eine kleine, nicht erstattbare Gebühr (eigene kleine Rechnung), bevor
  er SOL sperrt, und hält T_sol kurz (Stunden, nicht Tage).
- **SOL → Lightning (4.6b):** Der Kunde sperrt zuerst; das Risiko des LP ist
  eine Zahlung, die bis zum `cltv_limit` hängt. Begrenzt durch: `cltv_limit`
  aus der Frist der Sperre (nie länger), höchstens `LP_MAX_OFFENE_ZAHLUNGEN`
  (Standard 3) Zahlungen gleichzeitig in der Schwebe – eine Grenze je Kunde
  wäre wirkungslos, weil jeder beliebig viele Schlüssel erzeugen kann – und
  die Gebühr `fee_ppm` im Sperrbetrag.

## Für Nutzer ohne SOL (geplant: 4.6e)

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
`offchain:*` Zahlungen samt `cltv_limit` und das Nachschlagen ihres Stands. Kein `onchain`, keine `peers`,
kein `macaroon`: Wer den Daemon übernimmt, kann weder On-Chain-Geld bewegen
noch Kanäle schließen noch sich weitere Rechte backen. Die Datei gehört nur
dem Nutzer, unter dem der Daemon läuft (`chmod 600`).

Einstellungen der Gegenrichtung: `LP_DIRECTION` (`sell-sol` | `buy-sol` |
`beide`), `LP_MAX_OFFENE_ZAHLUNGEN`, `LP_CLTV_DELTA` (Obergrenze für
`cltv_limit`), `LP_LAMPORTS_PER_SAT`, `LP_FEE_PPM`. Das SOL-Konto des LP ist
das aus `SOLANA_KEYPAIR` (nur mit `LP_SOL_MOCK=1` aus `LP_SOL_ADDRESS`).
