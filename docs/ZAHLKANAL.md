# Solana-Zahlkanal (Schritt 4.3)

Ein Kunde zahlt SOL einmal in einen Kanal ein und bezahlt danach jede
KI-Antwort mit einer **Gutschrift**: einer Signatur seines Sitzungsschlüssels
über den bisher geschuldeten Gesamtbetrag. Der Provider löst die letzte
Gutschrift auf der Kette ein (`settle`); das Programm zahlt ihm seinen Teil und
teilt den Rest fest auf die Empfänger des Gebührenmodells A+ auf – erzwungen
vom Programm, nicht von der App. Nach Ablauf holt der Kunde den Rest zurück.

Client: `packages/protocol/src/channel.ts`. Programm: `contracts/solana-channel/`.
Beide müssen genau diesem Dokument folgen; eine Änderung am Format ist ein
neues Programm (neue Version im Domain-Präfix).

## Programm-ID

Bis zum Devnet-Deploy (MENSCH) steht im Code ein **Platzhalter**: die 32 Bytes
von `freedomstack-channel-platzhalter` als Adresse. Zu ihr gibt es keinen
Schlüssel, niemand kann dort ein Programm ablegen. Beim Deploy erzeugt der
MENSCH das Programm-Schlüsselpaar und trägt die Adresse in `declare_id!`
(`contracts/solana-channel`) und in `KANAL_PROGRAMM_ID` (`channel.ts`) ein.

## Konto `Channel`

PDA mit den Seeds `["channel", customer, provider, nonce]` (`nonce` als u64
little-endian). Borsh nach dem 8-Byte-Diskriminator
(`sha256("account:Channel")[0..8]`):

| Feld | Typ | Bedeutung |
|---|---|---|
| customer | Pubkey | zahlt ein, bekommt nach Ablauf den Rest |
| provider | Pubkey | löst Gutschriften ein |
| session_key | Pubkey | Ed25519-Schlüssel, der Gutschriften signiert |
| nonce | u64 | unterscheidet Kanäle desselben Paars |
| deposited | u64 | eingezahlte Lamports (mit Aufstockungen) |
| settled | u64 | bereits ausgezahlter Gesamtbetrag |
| expiry | i64 | Unix-Sekunden; ab dann nur noch `refund` |
| fee_recipients | Vec<(Pubkey, u32 ppm)> | fest bei Eröffnung, höchstens 8 |
| bump | u8 | PDA-Bump |

Platz: 8 + 3·32 + 4·8 + 4 + 8·36 + 1 = **429 Bytes**.

## Anweisungen

Diskriminator jeweils `sha256("global:<name>")[0..8]`, danach die Argumente in
Borsh.

1. **`open(nonce: u64, amount: u64, expiry: i64, session_key: Pubkey, fee_recipients: Vec<FeeRecipient>)`**
   Konten: customer (Signer, schreibbar), provider, channel (PDA, neu),
   System-Programm. Bedingungen: `amount > 0`; `expiry` in der Zukunft;
   höchstens 8 Empfänger, jeder mit mindestens 1 ppm, zusammen höchstens
   **100.000 ppm (10 %)** – die Obergrenze aus 4.0 (`MAX_ANTEILE_PPM`); kein
   Empfänger ist der Kanal selbst. Überweist `amount` vom Kunden in den Kanal.
2. **`settle(cumulative_amount: u64)`**
   Konten: provider (Signer, schreibbar), channel (schreibbar),
   Instruktions-Sysvar; danach die Empfänger in der Reihenfolge von
   `fee_recipients` (schreibbar). Nur der Provider, nur **vor** `expiry`. Die
   Anweisung **direkt davor** ist eine des Ed25519-Programms mit genau einer
   Signatur, deren Offsets alle auf sie selbst zeigen (Index `0xFFFF`):
   Schlüssel = `session_key`, Nachricht = Gutschrift (unten). Auszahlbar ist
   `min(cumulative_amount, deposited) − settled`; ist das nicht mehr als 0,
   scheitert die Anweisung (eine ältere oder gleiche Gutschrift zahlt nichts).
3. **`refund()`**
   Konten: customer (Signer, schreibbar), channel (schreibbar). Nur der Kunde,
   nur **ab** `expiry`. Schließt das Konto: Rest und Miete an den Kunden.
4. **`top_up(amount: u64)`**
   Konten: customer (Signer, schreibbar), channel (schreibbar), System-Programm.
   Nur der Kunde, nur vor `expiry`, `amount > 0`.

## Gutschrift

Signiert wird genau diese Bytefolge (71 Bytes):

```
"freedomstack-channel-v1"   23 Bytes, UTF-8
channel                     32 Bytes, Adresse des Kanal-PDA
cumulative_amount           u64 little-endian, Lamports insgesamt geschuldet
expiry                      i64 little-endian, wie im Konto
```

- Die Kanal-Adresse verhindert, dass eine Gutschrift in einem anderen Kanal
  gilt; der Ablauf, dass sie über ihn hinaus gilt.
- Gutschriften sind **kumulativ**: Jede neue ersetzt die alte. Der Provider
  braucht nur die höchste; der Kunde schuldet nie mehr, als er zuletzt
  signiert hat.
- Der Kunde schickt Gutschriften nur versiegelt mit der Anfrage (wie jede
  KI-Nachricht seit 3.1).

## Transport und Vorauszahlung

Die Gutschrift reist im versiegelten Kern der Anfrage (wie jede KI-Nachricht
seit 3.1), als Tags `["kanal", <Adresse>]` und
`["gutschrift", <Betrag>, <Ablauf>, <Signatur hex>]` (`gutschriftTags()`).

**Vorauszahlung bis zum Gebot:** Die Gutschrift einer Anfrage muss decken, was
der Provider schon abgerechnet hat, plus das Gebot dieser Anfrage in Lamports.
Der Kunde signiert also `max(letzte Gutschrift, abgerechnet + Gebot)`. Der
Provider arbeitet so nie ungedeckt; der Kunde riskiert höchstens den
Unterschied zwischen Gebot und Preis seines letzten Auftrags – denn eingelöst
wird die höchste Gutschrift. Ein knappes Gebot hält diesen Rest klein.

## Aufteilung beim Einlösen

`auszahlbar` wird so geteilt (ganzzahlig, abgerundet):

```
anteil_i  = auszahlbar · ppm_i / 1.000.000
provider  = auszahlbar − Σ anteil_i          (Rundungsreste an den Provider)
```

Ein Anteil geht stattdessen an den Provider, wenn das Empfängerkonto
ausführbar ist oder nach der Gutschrift unter der Mietbefreiung läge – sonst
könnte ein einziges leeres Empfängerkonto jede Abrechnung blockieren. Das ist
die Regel aus A+: nicht Zuordenbares an den Provider, nie ein Topf.

## Prüfung beim Provider (off-chain)

Vor der Arbeit: Kanal auf der Kette lesen (Provider = er selbst, Ablauf mit
Sicherheitsabstand in der Zukunft, Empfänger passen zur Deklaration im
Auftrag). Je Gutschrift: Signatur gültig für `session_key`, Kanal und Ablauf
stimmen, Betrag größer als die letzte und höchstens `deposited`. Eingelöst wird
rechtzeitig vor `expiry` – danach kann nur noch der Kunde zurückholen. Das
eigene Konto des Providers muss mietbefreit sein (er zahlt ohnehin die
Gebühr der Einlösung); sonst lehnt die Laufzeit eine kleine Auszahlung ab.

## Im Knoten (4.3c)

- Kanäle nur mit `ZAHLKANAL=1` und einem Solana-Schlüssel (`SOLANA_KEYPAIR`),
  dessen Adresse `NODE_SOL_ADDRESS` ist – sonst nähme der Knoten Gutschriften
  an, die er nie einlösen kann (`kanalKasseAusUmgebung()`).
- Das Angebot (38027) nennt dann `["kanal", <Adresse>, <Programm>]`.
- Eine Anfrage mit Gutschrift gilt nur versiegelt; mit A+-Deklaration wird sie
  abgelehnt (im Kanal teilt das Programm auf). Deckung: Gebot plus die
  angefragten Werkzeuge in Lamports. Abgerechnet wird wie beim Gebot –
  höchstens das Gebot, dazu die Werkzeuge; das Ergebnis nennt den Preis in
  Lamports (`amount_lamports`). Gebucht wird vor dem Versand der Antwort.
- Eingelöst wird alle fünf Minuten, was fällig ist (Schwelle, Vorlauf und
  Mindestlaufzeit per Umgebung einstellbar).
- **Auszahlung (4.5a):** Mit `NODE_SOL_PAYOUT` geht nach dem Einlösen, was
  sich auf dem Schlüssel des Knotens sammelt, gebündelt an diese eigene
  Adresse (ihr Schlüssel liegt nicht auf dem Knoten; `sol-auszahlung.ts`).
  Nur über der Schwelle (`KANAL_AUSZAHLUNG_SCHWELLE_LAMPORTS`, Standard
  0,1 SOL), höchstens einmal je Abstand (`KANAL_AUSZAHLUNG_ABSTAND_SEK`,
  Standard 24 h, auch nach einem Fehlversuch); die Rücklage
  (`KANAL_AUSZAHLUNG_RUECKLAGE_LAMPORTS`, Standard 0,01 SOL, mindestens
  0,001 SOL) bleibt für Miete und Gebühren. Nie an ein Programm, nie an die
  eigene Adresse, mit Vorabsimulation, ins Log nur Betrag und Fehlername.
  Laufen LP oder Relayer mit demselben `SOLANA_KEYPAIR`, bleibt sie aus –
  das Guthaben ist dann deren Liquidität. Das ist keine Verteilung an andere
  (5.1.2): Der Knoten bringt nur eigenes Geld vom heißen Schlüssel weg.
- **Grenze (Entscheidung 28.09.2026, Variante A):** eine Provider-Adresse je
  Knoten – keine frischen Adressen je Sitzung. Alle Kanäle eines Knotens und
  seine Auszahlungen sind auf der Kette miteinander verbunden.

## In der App (4.3d)

- **Kanal-Buch** (`app/src/zahlkanal.ts`, im Tresor unter `freedom.kanaele`,
  nie in der Sicherung): Kanal, Provider, Ablauf, Einlage, Sitzungsschlüssel,
  letzte Gutschrift, Summe der Preise, Anfragen ohne Antwort. Genutzt wird ein
  Kanal nur, solange er noch mindestens zwei Stunden läuft (der Knoten
  verlangt eine).
- **Gutschrift je Anfrage:** `max(letzte, Basis + Bedarf)`, höchstens die
  Einlage. Die Basis ist die Summe der Preise aus den Antworten
  (`amount_lamports`); fehlt zu einer Anfrage noch die Antwort, ist die Basis
  die letzte Gutschrift – der Provider kann gearbeitet und gebucht haben, und
  sonst deckte die nächste Gutschrift nicht, der Kanal hinge. Verlieren kann
  der Kunde so höchstens das Gebot einer Anfrage ohne Antwort.
- **Bedarf:** Gebot plus Werkzeuge (`hoechstMsat()`), umgerechnet mit dem Kurs
  aus dem Angebot des Providers – mit dem prüft der Knoten –, plus 2 %
  Spielraum für Kursbewegungen seit dem Angebot. Ohne Kurs im Angebot geht
  nichts hinaus.
- Die Gutschrift ersetzt die A+-Deklaration im Kern der Anfrage; nach der
  Antwort zahlt Lightning nichts, die App verbucht nur den Preis. Ob eine
  Anfrage über den Kanal lief, merkt sich die App auch im Speicher – ein
  gesperrter Tresor führt so nie zu einer zweiten Zahlung.
- Deckt der Kanal das Gebot nicht mehr, geht die Anfrage nicht hinaus – nie
  still über Lightning, wenn der Nutzer für diesen Provider einen Kanal hat.
- **Zurückholen:** Der Rückhol-Wächter kennt Kanäle als Sperre
  (`kind: "kanal"`, Referenz = Kanal-Adresse). Offen ist ein Kanal, solange sein
  Konto beim Programm liegt; nach Ablauf holt die verbundene Wallet mit
  `refund` Rest und Miete zurück. Gehört der Kanal einer anderen Wallet, geht
  keine Transaktion hinaus, die App nennt den Grund.
- **Öffnen** (4.3d2, Währung → Unterseite mit dem Deposit, `shell/zahlkanal-ui.ts`):
  nur mit verbundener Wallet und nur, wenn der Provider im Angebot einen Kanal
  bei genau diesem Programm nennt und das Programm auf der Kette liegt (bis zum
  Deploy nicht – dann öffnet die App keinen Kanal). Empfänger sind die Anteile
  nach A+ mit SOL-Adresse (`kanalEmpfaenger()`), nie Provider oder Kunde
  selbst. Erst Tresor, dann merken (Kanal-Buch, Sperre für den Wächter), dann
  einzahlen; scheitert die Einzahlung und zeigt die Kette keinen Kanal, fliegt
  er aus dem Kanal-Buch. Laufzeit 1, 7 oder 30 Tage. Aufstocken bietet die App
  nicht an – ein neuer Kanal tut es auch.
- Der Datenschutzbericht nennt als Grenze, was auf der Kette steht (Aussage
  „zahlkanal“).

## Nie

- `--final` oder Änderungen an Upgrade-Rechten durch den Agenten.
- Eine Gutschrift ohne Kanal-Adresse und Ablauf.
- Den Deposit mit zwei HTLCs (`sol-htlc.ts`, `sol-deposit.ts`) entfernen,
  bevor der Zahlkanal auf Devnet läuft.
