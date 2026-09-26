# Swaps zwischen Lightning und Solana

Stand 26.09.2026 (Schritt 4.6f). Atomar über denselben Hash: Wer das Preimage
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
  `<LP_OFFER_ID>-buy`). Es nennt – dort Pflicht – `["sol_address", …]` (das
  Konto des LP, Empfänger der Sperre) und `["lamports_per_sat", …]` (sein
  genauer Kurs; der Ticker ist gerundet). Der LP erneuert das Angebot, sobald
  die Hälfte seiner Gültigkeit um ist.
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

### In der App (4.6c)

Im Tab Währung → Tausch stehen die Angebote mit Richtung („SOL → sats“).
`startRueckSwap()` (`tabs/waehrung.ts`) plant mit `planeRueckSwap()`
(`rueck-swap.ts`), bevor irgendetwas gesperrt wird:

1. Betrag in sats; die Rechnung erstellt die verbundene Lightning-Wallet (NWC
   `make_invoice`), sonst fügt der Nutzer eine ein. Die App prüft Signatur und
   Betrag (`leseBolt11`). Das Preimage verlässt die Wallet nie.
2. Sperrbetrag `rueckSwapLamports()` mit Kurs und Gebühr aus dem Angebot;
   Frist `lnCltvDeltaBlocks · 20 min + 1 h + 30 min Puffer` – so nimmt der LP
   die Sperre auch nach Ablauf des Puffers mit vollem `cltv_limit` an. Mehr
   als eine Woche Sperre lehnt die App ab. Vor dem Sperren nennt ein Dialog
   Betrag, Gebühr und ab wann die SOL zurückkommen.
3. Die Sperre wird **zuerst gemerkt**, dann angelegt (`lockRueckSwap`,
   Vorabsimulation an).
4. Die Anfrage geht von einem Wegwerf-Schlüssel aus, nicht vom eigenen npub,
   und nennt keine SOL-Adresse. Die Rechnung steht darin noch offen – Lücke,
   die 4.9 schließt (im Datenschutzbericht benannt).
5. Die Antwort des LP wird nur als Anzeige genommen. Ob er wirklich
   eingelöst hat, sagt die Kette.

**Rückholen:** Der Rückhol-Wächter (`refund-watcher.ts`) läuft, sobald eine
Solana-Wallet verbunden ist, und holt fällige Sperren – Swaps und Deposits –
zurück. Vorher fragt er die Kette: Schon eingelöste oder nie angelegte Sperren
schließt er ohne Wallet-Dialog ab, und in einer Rückholung stehen nur die noch
offenen (eine eingelöste riss vorher die offene in derselben Transaktion mit).
Die gemerkten Sperren liegen mit Tresor im Tresor. Er läuft nur, solange die
App offen ist; bestätigt wird jede Rückholung in der Wallet.

## Gegen Blockaden

Wer sperrt, bindet Kapital – ein Angreifer könnte Swaps anstoßen und nie
abschließen:

- **Lightning → SOL (4.6d):** Der LP sperrt zuerst. Deshalb verlangt er vorab
  eine kleine, nicht erstattbare Gebühr, bevor er SOL sperrt, und hält T_sol
  kurz (Stunden, nicht Tage). Das Angebot nennt sie (`["vorab_sats", N]`,
  `LP_VORAB_SATS`, Standard 10, 0 = aus). Auf eine Anfrage antwortet der LP
  zuerst mit `["status", "VORAB"]`, `["vorab_sats", N]` und einer normalen
  Rechnung (10 Minuten gültig); erst wenn sie bezahlt ist, sperrt er und
  schickt die Hold-Invoice wie bisher. Unbezahlt verfällt die Anfrage. Die App
  zahlt nur Antworten des LP selbst, nur in der angekündigten Höhe (höchstens
  1000 sats), nur mit gültiger Rechnung über genau diesen Betrag – und nach
  Zustimmung, über die Zahlschiene. Die Gebühr mindert den Tausch nicht.
- **SOL → Lightning (4.6b):** Der Kunde sperrt zuerst; das Risiko des LP ist
  eine Zahlung, die bis zum `cltv_limit` hängt. Begrenzt durch: `cltv_limit`
  aus der Frist der Sperre (nie länger), höchstens `LP_MAX_OFFENE_ZAHLUNGEN`
  (Standard 3) Zahlungen gleichzeitig in der Schwebe – eine Grenze je Kunde
  wäre wirkungslos, weil jeder beliebig viele Schlüssel erzeugen kann – und
  die Gebühr `fee_ppm` im Sperrbetrag.

## Für Nutzer ohne SOL: Relayer (4.6e Protokoll + Knoten, 4.6f App)

Einlösen kostet eine Transaktionsgebühr. Wer per Lightning SOL kauft, hat oft
noch keins. Ein **Relayer** zahlt sie als `feePayer`; der Empfänger signiert
die Einlösung weiterhin selbst. Die Signatur deckt alle Anweisungen – der
Relayer kann nichts umleiten, nur ablehnen. Seine Auslagen bekommt er in
**derselben** Transaktion zurück (Überweisung vom Empfänger an ihn, nach der
Einlösung, atomar).

- **Angebot:** Kind 38032 (ersetzbar, `d = relayer`): `sol_address`,
  `erstattung_lamports`, `kette`. Knoten: `RELAYER_ENABLED=1`,
  `RELAYER_ERSTATTUNG` (Standard 10.000 Lamports), `RELAYER_MAX_PRO_STUNDE`
  (Standard 30), Schlüssel aus `SOLANA_KEYPAIR` – er braucht etwas SOL.
- **Auftrag:** versiegelt (NIP-59) an den Relayer, innen Kind 25010 mit der
  teilsignierten Transaktion. Sie trägt das Preimage – offen auf den Relays
  könnte es der LP lesen, bevor die Einlösung auf der Kette ist.
- **Prüfung vor dem Mitsignieren** (`pruefeRelayAuftrag`): genau eine
  Einlösung beim HTLC-Programm, danach genau eine Erstattung vom Empfänger an
  den Relayer (mindestens sein Satz), Relayer nur Gebührenzahler und in keiner
  Einlösung, Empfänger hat gültig signiert. Alles andere wird abgelehnt – sonst
  könnte ein Auftrag das Guthaben des Relayers anders verwenden.
- **Senden** mit Vorabsimulation, nie `skipPreflight`; Grenze je Stunde. Ins
  Log nur Status und Fehlername.
- **Antwort:** versiegelt, innen Kind 25011, `status` GESENDET (mit
  `signatur`) oder ABGELEHNT (mit Grund).
- **Mindestmiete:** Ein neues Empfängerkonto muss nach Einlösung und
  Erstattung mindestens 890.880 Lamports halten (`mieteReicht`), sonst lehnt
  die Kette die ganze Transaktion ab – die App prüft das vorher (4.6f).

**In der App (4.6f):** Reicht das Guthaben nicht für die Gebühr (unter
10.000 Lamports), sucht die App Relayer-Angebote derselben Kette – nie den LP
dieses Swaps (weder seinen Schlüssel noch sein SOL-Konto), Erstattung höchstens
50.000 Lamports, günstigster zuerst. Sie prüft die Mindestmiete, fragt einmal
nach Zustimmung, lässt die Wallet Einlösung und Erstattung signieren, prüft den
Auftrag selbst mit derselben Regel wie der Relayer und schickt ihn versiegelt
von einem Wegwerf-Schlüssel. Als erledigt gilt erst die Bestätigung auf der
Kette; lehnt ein Relayer ab oder bleibt es aus, kommt der nächste – nur,
solange bis `T_sol` noch mehr als 15 Minuten bleiben.

**Risiko, offen benannt:** Der Relayer kennt das Preimage, bevor die Einlösung
auf der Kette ist. Hält er sie zurück und gibt R dem LP, könnte der LP die
Lightning-Zahlung abrechnen und nach Ablauf die SOL zurückholen. Deshalb nimmt
die App (4.6f) nie den LP selbst als Relayer, versucht bei ausbleibender
Einlösung rechtzeitig den nächsten und hält die Frist `T_sol − 10 min` ein.

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
