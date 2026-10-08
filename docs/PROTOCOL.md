# Freedom Protocol — Spezifikation v1.0

> **Dieser Text ist der Vertrag.** Nach dem Mainnet-Launch sind die hier
> beschriebenen Invarianten unveränderbar. Software darf sich ewig weiter-
> entwickeln — dieses Dokument nicht.

---

## 1. Kernversprechen (unveränderlich)

1. **Non-Custodial.** Kein Betreiber, kein Server, kein Unternehmen hält
   Guthaben oder Keys von Nutzern. Alle Zahlungen laufen direkt zwischen
   den Parteien (Lightning-Split, HTLC, direkte Transfers).
2. **Kein Token.** Es gibt keinen Freedom-Token, kein Pre-Mine, kein ICO.
   Das Protokoll wird nicht durch Spekulation finanziert, sondern durch
   die in §3 definierte Nutzungsgebühr.
3. **Zensurresistenz durch Architektur:** Multi-Relay, Mesh-Transport
   (FileRelay/USB), eigenes Relay pro Node optional, keine zentrale Instanz
   die Accounts sperren könnte.
4. **Offene Teilnahme:** Jeder kann Provider werden (Compute, Storage,
   Relay), jeder kann Client sein. Keine Erlaubnis nötig.

## 2. Krypto-Fundament (unveränderlich)

| Komponente | Spezifikation |
|---|---|
| Signaturen | Schnorr über secp256k1 (Nostr-Standard) |
| Identität | 32-Byte-Pubkey = Nutzer. Kein Account, kein Name nötig |
| DM-Verschlüsselung | NIP-44 (X25519 + ChaCha20-Poly1305) |
| Blob-Integrität | SHA-256 pro Shard + SHA-256 des Originals |
| Erasure Coding | Reed-Solomon über GF(256), 16 Daten + 8 Parity |
| Atomic Swaps | HTLC: Timelock-Ordnung `T_sol < T_lightning` (zwingend) |

## 3. Gebührenmodell A+ (fest voreingestellt)

Entscheidung 4.0 vom 26.09.2026, umgesetzt in Schritt 5.1. Regeln und
Begründung: `docs/GEBUEHREN-ENTSCHEIDUNG.md`. **Eine Quelle im Code:**
`protocol/src/aufteilung.ts`; CI prüft die Werte als Invariante.

Jede KI-Zahlung wird beim Zahlen fest aufgeteilt:

```
   Anteil  Empfänger                                              in ppm
   94 %    Provider                                              940.000
   2,0 %   Entwicklung (selbstverwahrte Adressen des Projekts)    20.000
   0,5 %   Prüfbudget – bleibt beim Kunden (seit P5b)              5.000
   1,5 %   Relays, über die der Auftrag lief (≤ 3, gleiche Teile) 15.000
   0,5 %   Werber des Kunden (aus dem Werbelink)                   5.000
   0,5 %   Werber des Providers (nennt sein Angebot)               5.000
   1 %     Hosting (Spiegel, von dem die App geladen wurde)       10.000
```

- **Direkt beim Zahlen, kein Topf.** Die App des Kunden zahlt jeden Anteil
  selbst an seinen Empfänger (`teileAuf()`); der Provider stellt nur seinen
  Anteil in Rechnung (`providerAnteilMsat()`). Niemand verwahrt fremdes Geld,
  nichts wird verteilt.
- **Nicht zuordenbar heißt: an den Provider.** Fehlt ein Empfänger mit Adresse
  für die Schiene der Zahlung, bleibt der Anteil beim Provider – nie ein Topf,
  nie die Entwicklung. Rundungsreste ebenso.
- **Deklaration im versiegelten Auftrag.** Welche Anteile die App selbst zahlt,
  steht im Tag `aufteilung` im Kern des Auftrags (`aufteilungTag()`). Der
  Provider prüft ihn vor dem Rechnen (`pruefeAufteilung()`): nur bekannte
  Anteile, jeder einmal, zusammen höchstens 10 %; ohne Tag stellt er den ganzen
  Betrag in Rechnung.
- **Prüfbudget (seit P5b, Entscheidung 05.10.2026).** Der Anteil `pruefung`
  hat keinen Empfänger: Die App behält ihn und zahlt daraus ihre Prüfrunden
  (`docs/FREEDOM-PRUEFUNG.md`). Er kam aus der Entwicklung (vorher 2,5 %).
- **Fassung im Angebot.** Ein Knoten nennt mit `["aufteilung", "2"]` im
  Angebot (38027), dass er so rechnet (`AUFTEILUNG_FASSUNG`). Nur dann
  deklariert die App `entwicklung` und `pruefung` – ältere Knoten lehnen
  unbekannte Anteile ab und rechneten die Entwicklung mit 2,5 %; bei ihnen
  bleiben beide Anteile beim Provider.
- **Kleine Beträge bündeln, ohne Verwahrung.** Lightning-Anteile unter
  100 sats je Empfänger sammelt die App des Zahlenden; bis dahin bleibt das
  Geld bei ihm.
- **Ändern nur mit signiertem Release** (5.2), vorher angekündigt.
- **Ehrlich:** Bei Lightning zahlt die App die Anteile – ein veränderter Client
  könnte sie weglassen. Bei SOL erzwingt es erst das Programm des Zahlkanals
  (4.3); bis dahin gehen SOL-Aufträge ganz an den Provider.
- **Keine Anteile auf** Zaps und Trinkgeld, Tausch (der LP nimmt die Gebühr
  seines Angebots), Relayer, Speicher und Prüfer – sie werden direkt bezahlt.

Beleg einer Zahlung ist die Wallet des Zahlenden: Lightning mit Preimage und
der vom Empfängerknoten signierten Rechnung (`preimageMatches()`,
`leseBolt11()`), Solana mit der Transaktion auf der Kette.

> **Historie.** Das Fee-Modell v1 (erst 5 %, dann 2,5 % Protokollgebühr mit
> Reward-Pool und Werbe-Pool; Entwicklungsanteil an eine wöchentlich
> rotierende Treasury-Adresse, Ankündigung Kind 38050; öffentlicher
> Gebühren-Beleg des Knotens, Kind 38051) wurde nie ausgezahlt. Es fiel mit
> 5.1.2 (Knoten zahlt nichts aus) bis 5.1.4c (Code entfernt). Aus ihm stammt
> eine Lehre, die bleibt: Die ppm-Werte standen um den Faktor 10 falsch im
> Code, während die Prozentangaben stimmten – deshalb gibt es genau eine
> Quelle und eine CI-Invariante, die gegen die Entscheidung prüft.

## 4. Event-Kinds (Registry v1)

Bestehende Kinds sind reserviert und semantisch eingefroren:

### Basis (NIP-Standard)
| Kind | Bedeutung |
|---|---|
| 0 | Profil (lud16, sol-Adresse, name) |
| 1 | Text-Note / Feed-Post (+ `imeta` für Media) |
| 4 | Verschlüsselte DM (NIP-44, p-Tag = Partner) |
| 42 | Community-Nachricht (h-Tag = Channel) |
| 9734 / 9735 | Zap-Request / Zap-Receipt (NIP-57) |
| 9736 | SOL-Trinkgeld-Beleg (Entwurf, `docs/NIP-SOL-TIP.md`; privat im Gift-Wrap) |
| 27235 | HTTP-Auth (NIP-98) |
| 30063 | Release eines Repos (NIP-51-Satz „Release artifact set“, §19, seit C-20h1) |

### DVM-Jobs (NIP-90; Result = Request + 1000)
| Kind | Bedeutung |
|---|---|
| 5050 | Text-Generierung |
| 5062 | Browser-Automation |
| 5070 | Bild-Generierung |
| 5071 | Video-Generierung |
| **5075** | Blob-Chunk-Fetch (Storage-Micro-Reward) |
| **5076** | Blob beim eigenen Knoten halten – nur versiegelt, nur mit Besitzer-Nachweis (§23) |
| **5077** | Status des eigenen Knotens – nur versiegelt, nur mit Besitzer-Nachweis, nur lesen (§24) |
| **5078** | Wecken: Push-Adresse beim eigenen Knoten an- oder abmelden – nur versiegelt, nur mit Besitzer-Nachweis (§25) |
| **5079** | Zugang zum TURN des eigenen Knotens – nur versiegelt, nur mit Besitzer-Nachweis (§26) |

### Freedom-spezifisch (38xxx)
| Kind | Bedeutung |
|---|---|
| 38010 | Performance-Beleg (Worker, Season) |
| 38011 / 38012 | *nicht mehr belegt* (Reward-Payout-Nachweis, Saison mit Pool-Regeln; nie veröffentlicht, entfernt mit 5.1.4d) |
| 38013 | *nicht mehr belegt* (Reward-Claim, bis 5.1.4b) |
| 38020–38022 | Sessions (Open/Payment/Close) |
| 38027 | Provider-Capabilities (models, tools, storage, relay) |
| 38030 / 38031 | *nicht mehr belegt* (Mesh-Paket / Kurier-Zustellbeleg; nie angebunden, entfernt mit B-21 – über Mesh geht seit 7.1 nur der Umschlag) |
| 38040 / 38041 | Blob-Manifest / Blob-Chunk |
| 38042 | Git-Repo-Referenz |
| 38050 / 38051 | *nicht mehr belegt* (Treasury-Ankündigung bis 5.1.4a, Fee-Beweis des Knotens bis 5.1.4c) |
| 38052 | Werbe-Nennung, signiert vom Geworbenen (§15) |
| 38053 | *nicht mehr belegt* (Verteilungsbericht des Reward-Pools, bis 5.1.2) |
| 38059 / 38060 | *nicht mehr belegt* (Runde und Zuteilung aus einem Topf, nie veröffentlicht, entfernt mit E10 B am 04.10.2026) |
| 38061 | Kopfgeld für eine Aufgabe, meist ein Issue – in sats, SOL oder beiden (§29, `kopfgeld.ts`) |
| 38075 | Zusammenfassung des Rufs, nur als versiegelter Kern an Kontakte (§17) |
| 38080 | Modellkatalog eines Kurators (NIP-51-Set: `d`, `title`, `description`, je Modell `["model", <kennung>, <notiz?>]`; `modell-katalog.ts`) |
| 38081 | *nicht mehr belegt* (Messbericht eines Prüfers je Provider und Modell, P1b bis P5a; Prüfer entfielen mit der Entscheidung vom 05.10.2026, §28) |

**Regel:** Neue Features bekommen NEUE Kinds. Bestehende Kinds ändern ihre
Semantik nie; nicht mehr belegte werden nicht wiederverwendet – alte Events
liegen noch auf Relays. Ein Client, der ein unbekanntes Kind sieht, ignoriert es.

## 5. Tag-Konventionen

- Geldbeträge immer in **msat** (Milli-Satoshi), Tag-Name endet auf `_msat`.
- Zeit immer Unix-Sekunden (`created_at`).
- Pubkeys immer 64 Zeichen lowercase hex.
- Content-Adressierung: Tag `sha256` mit lowercase hex.
- Replaceable Events: `d`-Tag = Identifier (NIP-33-Stil).

## 6. Storage-Modell

- Dateien → Chunks (small: 64 KB, large: 1 MB ab 100 MB) → RS(16,8)-Shards
  → je ein Event (`38041`).
- Manifest (`38040`): enthält Shard-Hashliste, Klasse, Erasure-Parameter.
  Parameter reisen MIT dem Blob — alte Blobs bleiben immer lesbar.
- Rekonstruktion aus JEDEM beliebigen 16 von 24 Shards.
- Gratis-Schwelle dezentral: `min(1 GB, max(50 MB, Σ Seeder-Kapazität × 0,5%))`
- Escrow-leer ⇒ Degradation, nie Löschung (LRU-Verdrängung durch Seeder,
  beliebte Dateien überleben durch freiwilliges Seeding).

## 7. Git-Modell

- Repo-Version = `git bundle --all` → als Blob hochgeladen → Referenz-Event
  (`38042`, d-Tag = Repo-Name, replaceable).
- Clone = Bundle aus Chunk-Netz rekonstruieren → normales `git clone`.
- Standard öffentlich; privat via Verschlüsselung des Bundles vor Upload.

## 8. Governance

Es gibt keine. Änderungen an diesem Dokument nach Launch = Fork.
Erweiterungen (neue Kinds, neue Optionen) erfordern keine Genehmigung —
sie sind per Definition kompatibel, solange sie §1–§7 nicht verletzen.

---

*Freedom Protocol v1.0 — geschrieben bevor jemand abhängig war.*


## 10. Deposit-Sessions: On-Chain-Pflicht

Ein Deposit-Event (kind 30402) ist eine **Behauptung des Kunden**, kein Beleg —
der Kunde signiert es selbst. Provider MÜSSEN daher vor der ersten Abrechnung
gegen die Kette prüfen (`verifyDepositOnChain`):

- existiert das Verbrauchs-HTLC unter `spend_swap_id`?
- liegt mindestens `spend_lamports` darin?
- ist der Provider der Empfänger?
- läuft der Timelock lange genug (Default: mindestens 1 Stunde Rest)?
- wurde es bereits eingelöst oder zurückgeholt?

**Fehlende Prüfmöglichkeit ist kein Beweis für Deckung.** Ohne konfigurierte
Solana-Verbindung wird ein Deposit abgelehnt, nicht durchgewunken. Dasselbe gilt
für einen RPC-Ausfall: im Zweifel ungedeckt.

Ergebnisse werden 60 Sekunden zwischengespeichert (negative nur 15), damit ein
Chat mit zwanzig Nachrichten nicht zwanzig RPC-Abfragen auslöst und ein Kunde,
der gerade nachlegt, nicht minutenlang abgewiesen bleibt.

### Client-Seite: erst sperren, dann ankündigen

Die App baut die `initialize`-Instruktion selbst und lässt die verbundene
Wallet signieren — sie hält **nie** einen Solana-Secret-Key. Eine Web-App mit
Signierschlüssel wäre ein Verwahrer und würde die erste Invariante brechen.

Beide HTLCs (Verbrauch und Rest) entstehen in **einer** atomaren Transaktion.
Zwei getrennte Dialoge wären der Fehler: wer den zweiten abbricht, hätte Geld
beim Provider gesperrt und den Rest-Anteil ungeschützt.

Die Reihenfolge ist verbindlich: **Lock zuerst, Deposit-Event danach.** Kommt
das Event zuerst, steht eine Ankündigung auf den Relays, der nichts entspricht —
und scheitert die Signatur, gibt es keinen Weg, sie zurückzunehmen.

Das Preimage liegt in `localStorage` (nicht `sessionStorage`, das den
Tab-Schluss nicht überlebt). Dauerhaft sicher ist nur eine Sicherung durch den
Nutzer; ohne Preimage bleibt vor Ablauf des Timelocks kein Zugriff.

## 11. Änderung am HTLC-Programm (noch nicht deployed)

Zwei Korrekturen an `contracts/solana-htlc`, die **vor dem Deploy auf Devnet
getestet werden müssen** — hier wurde nur der Quelltext geändert, nicht
kompiliert:

**1. `preimage: [u8; 32]` statt `Vec<u8>`.** Ein unbegrenzter Vektor liess
Aufrufer beliebig grosse Daten schicken; die Längenprüfung musste der Hash
übernehmen. Wichtig für Clients: Borsh kodiert ein festes Array **ohne**
Längenpräfix, ein `Vec<u8>` **mit** vier Byte little-endian davor. Beide Seiten
wurden zusammen geändert (`swap-client.ts`, `solana-adapter.ts`); wer nur eine
ändert, bekommt eine abgelehnte Transaktion ohne verwertbare Fehlermeldung.

**2. `close = initiator` bei claim und refund.** Der Swap-PDA wurde nie
geschlossen, die Mietbefreiung blieb dauerhaft gebunden — rund 0,0016 SOL
Verlust je Swap, getragen vom Initiator. `claim` nimmt dafür ein zusätzliches
Konto `initiator` entgegen (nicht signierend, wird gegen `swap.initiator`
geprüft).

**Folge für Prüfungen:** Nach Abschluss existiert das Konto nicht mehr. Ein
Leser bekommt dann `undefined` statt `claimed: true`. `verifyDepositOnChain`
und `verifyCounterpartyLock` behandeln das bereits als „nicht gedeckt" und
lehnen ab — das ist die sichere Richtung. Ein geschlossener PDA lässt sich mit
derselben `swap_id` neu anlegen; da beide Prüfungen Betrag, Hashlock und
Empfänger vergleichen, bringt das einem Angreifer nichts.


## 12. Zustellung: Abos statt Abfrage-Schleife

Der Provider fragte alle 15 Sekunden nach neuen Jobs. Das sind bis zu 15
Sekunden, bevor ein Job überhaupt **gesehen** wird — bei einem Chat der
Unterschied zwischen „antwortet" und „hängt".

`OutboxPool.subscribe()` hält stattdessen ein Abo über alle Relays, die es
können. Dedupliziert über Relays hinweg, mit derselben Signaturprüfung wie
`query()`: ein bösartiges Relay darf auch über ein Abo nichts unterschieben.

**Abfragen laufen weiter.** Auch mit aktivem Abo pollt der Knoten im
Hintergrund — ein kurzer Verbindungsabriss kann Events verschlucken, und ein
Job, der niemandem auffällt, sieht aus wie kein Job. Die Dedupe-Prüfung
verhindert Doppelarbeit.

**`autoReconnect` ist jetzt implementiert.** Die Option war deklariert und tat
nichts — ein totes Versprechen in der Schnittstelle. Nach einem Abriss wird mit
wachsendem Abstand (1 s bis 60 s) neu verbunden und **jedes Abo erneut
angemeldet**. Ohne das wäre die Verbindung zwar wieder da, es käme aber nichts
mehr an: der Fehlerzustand, der wie Normalbetrieb aussieht.

### Publish schlägt nicht mehr still fehl

`publish()` gab bei vollständigem Fehlschlag ein `ok: false` zurück, das **kein
einziger Aufrufer** geprüft hat. Ein Job-Ergebnis, ein Fee-Beweis oder eine
Zahlungsankündigung verschwand damit spurlos.

- **Gar kein Relay akzeptiert** → `PublishError` mit vollständigem Bericht.
- **Teilerfolg** (unter `minAcks`) → kein Abbruch, aber `onPublishFailure`.
  Das Event ist zugestellt, nur dünner verteilt als gewünscht.
- `throwOnTotalFailure: false` nur, wenn der Aufrufer den Bericht selbst
  auswertet — sonst ist man wieder beim stillen Verschwinden.


## 13. Anreize ohne eigenen Token

Wer Belohnungen aus Token-Inflation zahlt, kann breit gießen. Wer aus echten
Einnahmen zahlt, hat genau so viel, wie eingenommen wurde. Seit dem
Gebührenmodell A+ (§3) sammelt das Protokoll dafür nichts: Jeder, der einen
Auftrag trägt, bekommt seinen Anteil beim Zahlen direkt. Kein Topf und keine
Verteilung – also nichts, was jemand halten, schätzen oder falsch verteilen
könnte.

### Werben – eine Ebene je Seite (`werbung.ts`)

- Der Werbelink trägt Schlüssel und Lightning-Adresse des Werbers
  (`?ref=<pk>&ln=<lud16>`), seit 12.2 auch eine SOL-Adresse (`&sol=<adresse>`,
  eine frische aus der eingebauten Wallet, je Kette einmal vergeben). Die App des Geworbenen merkt sich den ersten Werber
  und zahlt ihm 0,5 % jeder KI-Zahlung – ohne öffentliche Nennung; ein
  späterer Link verdrängt ihn nicht.
- Den Werber eines Providers nennt dessen Angebot (38027: `werber` mit
  Lightning-Adresse, seit 12.3 `werber_sol` mit SOL-Adresse); die App des Kunden
  zahlt ihm 0,5 % der Aufträge dieses Providers – per Zahlkanal teilt das
  Programm den Anteil an die SOL-Adresse zu. Relays bekommen ihren Anteil an
  die Adressen aus dem signierten Profil ihres Betreibers (`lud16`, `sol`).
- **Keine Stufen, keine zweite Ebene.** Stufen hingen an gezählten „aktiven
  Geworbenen“ – Selbstauskunft, also fälschbar; eine zweite Ebene bräuchte
  öffentliche Werbebeziehungen, die es nur mit Zustimmung gibt (§15).
- Der Anteil gehört zur festen Aufteilung. Für den Geworbenen ändert sich
  nichts; fehlt ein Werber, bekommt den Anteil der Provider.
- Selbstwerbung lässt sich nicht verhindern, ist aber harmlos: Wer sich selbst
  wirbt, spart 0,5 %.

**Es gibt keinen Cent fürs Anwerben.** Ein System, in dem der Verdienst
hauptsächlich aus dem Anwerben stammt, ist ein Schneeballsystem und in
Österreich verboten (§ 168a StGB, UWG Anh. Z14). Vergütet wird ausschließlich
ein Anteil an echtem Umsatz: Wer hundert Leute wirbt, die nie etwas bezahlen,
verdient exakt null. Kein Eintrittsgeld, kein Kaufzwang, keine käufliche
Position.

### Regionen (`scarcity.ts`)

Der zwanzigste Knoten in Mitteleuropa bringt dem Netz fast nichts; der erste
in einer unversorgten Region entscheidet für alle dortigen Nutzer, ob das Netz
überhaupt benutzbar ist. `whereIsCapacityNeeded()` zeigt, wo Provider fehlen –
aus Leistungsnachweisen, `unknown` zählt nie. Einen Aufschlag gibt es dafür
nicht mehr: Der Knappheitsbonus wäre aus einem Topf gezahlt worden und fiel mit
5.1.4a. Anreize für Randregionen sollen gesponserte Pools bringen (5.1b), mit
offenen Regeln und ohne Verwahrer.

### Aufgaben (`quests.ts`)

Nur für im Protokoll nachweisbare Beiträge (Leistungsnachweise an Kalendertagen)
und nur als Abzeichen – ohne Topf keine Prämien (5.1.4c). Was einen externen
Prüfer bräuchte, vergibt jemand von Hand (`BADGE_ONLY_TASKS`).

### Kein Staking

Bei einem eigenen Token ist Staking ein selbst emittierter Lockup. Bei fremdem
Geld ist es **Verwahrung** — und Verwahrung von Nutzervermögen steht wörtlich
auf der Liste der Merkmale, die gegen die Dezentralitäts-Ausnahme sprechen.
Schwächerer Anreiz, größtes Risiko: fällt weg.

Escrow bleibt, weil es das Gegenteil ist: Das Geld liegt in einem HTLC, das
niemand kontrolliert, und fließt nach Ablauf automatisch zurück.

## 14. Automatischer Rückfluss (`refund-watcher.ts`)

Der Timelock garantiert, dass niemand Geld dauerhaft einbehält — er gibt es
aber nicht von selbst zurück. `refund` muss jemand aufrufen. Der häufigste Weg,
auf dem Nutzer hier Geld verlieren, ist deshalb nicht Betrug, sondern Vergessen.

Der Watcher merkt sich jede offene Sperre lokal, prüft **sofort beim Start**
(wer die App nach zwei Tagen öffnet, soll nicht auf das nächste Intervall
warten) und danach alle fünf Minuten.

Er holt nichts vor Ablauf zurück — diese Wartezeit ist die Absicherung, die den
Gegenüber ohne Vertrauen arbeiten lässt, und die UI erklärt das auch so. Nach
fünf Fehlversuchen wird eingestellt: Ein dauerhaft scheiternder Versuch heißt
meist, dass die Gegenseite bereits eingelöst hat, und jeder weitere kostet nur
Gebühren.


## 15. Werbe-Nennung (kind 38052)

Wer will, nennt seinen Werber öffentlich: Der **Geworbene** veröffentlicht einen
signierten Claim (kind 38052, `d`-Tag `referral`) – in der App nur mit seiner
Zustimmung (Einrichtung). Seit A+ hängt daran kein Geld: Bezahlt wird das
Werben direkt beim Zahlen (§13). Die Nennung wird nur gezählt
(`werbe-nennung.ts`, `zaehleNennungen()`).

**Warum der Geworbene und nicht der Werber.** Könnte ein Werber die Beziehung
behaupten, würde er die Pubkeys aller erfolgreichen Provider eintragen. Nur
gültig signierte Angaben zählen; Selbstwerbung wird verworfen.

**Die früheste Angabe zählt, nicht die neueste.** Das Event ist ersetzbar –
würde die jüngste Fassung gelten, könnte jemand seinen Werber nachträglich
austauschen oder dazu gedrängt werden.

Keine zweite Ebene, keine Kette, keine Stufen: Der Graph dahinter (Kreise,
Ketten, „aktive“ Geworbene) fiel mit 5.1.4b.


## 16. Reward-Pool-Verteiler (kind 38053) – entfernt

Mit dem Gebührenmodell A+ gibt es keinen Pool, also auch keinen Verteiler:
`pool-distributor.ts` und der Verteilungsbericht (38053) fielen mit 5.1.2, der
Knoten zahlt seitdem nichts aus. `POOL_DISTRIBUTOR`, `FEE_POOL_LUD16` und
`FEE_REFERRAL_LUD16` liest er nicht mehr, er warnt nur, wenn sie noch gesetzt
sind. Die Lehre des alten Verteilers bleibt für jede künftige Verteilung, etwa
gesponserte Pools (5.1b): Nur abgeschlossene Epochen, der verfügbare Betrag
wird nie geschätzt, der Zustand überlebt Neustarts, und über jede Verteilung
gibt es eine Aufzeichnung – auch über gescheiterte Zahlungen.

## 17. Quittungen und Ruf (kind 38075, `quittung.ts`, seit 5.5)

Leistung zählt nur, wo bezahlt wurde. Eine **Quittung** legt die App selbst an,
wenn sie einen Provider bezahlt hat; sie liegt nur im Tresor und geht nie auf
ein Relay:

- **Lightning:** bezahlte Rechnung und Preimage (`lightningQuittung()`).
  „Belegt“ nur, wenn die Rechnung vom angekündigten Knoten des Providers
  signiert ist (4.8) – bei einer Lightning-Adresse „angekündigt“.
- **Zahlkanal:** Preis aus der Antwort und die Gutschrift, die ihn deckte
  (`kanalQuittung()`); „belegt“ erst, wenn die Kette mindestens bis zu dieser
  Gutschrift ausgezahlt zeigt (`kanalBelegt()`).

Ohne Nachweis keine Quittung. Der **Ruf** eines Providers (`berechneRuf()`)
kommt nur aus eigenen Quittungen (belegt zählt 1, angekündigt ½) und aus
Zusammenfassungen der eigenen Kontakte (je Kontakt die neueste, zur Hälfte,
höchstens 100 Aufträge je Provider); Reklamationen ziehen ab. Leistungs-Events
(38010) und andere Selbstauskünfte zählen nicht. Eine öffentliche Rangliste
gibt es nicht.

**Zusammenfassung (38075)** – nur als Kern im Umschlag (NIP-59), je Kontakt
ein Umschlag (`baueRufUmschlaege()`), geöffnet nur von Kontakten
(`oeffneRufUmschlag()`):

| Feld | Inhalt |
|---|---|
| `pubkey` | eigene Identität (Kontakte kennen sie ohnehin) |
| `content` | leer |
| Tag `provider` | je Provider eine Zeile: `["provider", <pk>, <aufträge>, <belegt>, <umfang_msat>, <umfang_lamports>, <reklamationen>]`, ganze Zahlen, höchstens 50 Zeilen |

Relays sehen nur, dass Kontakte Post bekommen – nicht von wem, nicht über
welchen Provider.


## 18. Repos in öffentlichen Räumen (NIP-34 mit Raum, `raum-repo.ts`, seit 11.4a)

Eine Repo-Ankündigung (Kind 30617, NIP-34) kann auf einen **öffentlichen**
Raum verweisen – mit der Adresse seiner Definition (Kind 34700, d-Tag
`space:<kennung>`):

| Tag | Inhalt |
|---|---|
| `a` | `34700:<besitzer>:space:<kennung>` (`raumAdresse()`); Kennung aus Buchstaben, Ziffern, `. _ -`, höchstens 64 |

Rechte kommen aus den Raum-Rollen (Kind 34701/34702): Das neue Recht
**`repos_pflegen`** erlaubt, Repos des Raums zu pflegen (ankündigen, Patches
annehmen, als Entwurf markieren, schließen). Der Besitzer hat es immer.

- **Zum Raum gehört ein Repo nur**, wenn sein Eigentümer im Raum
  `repos_pflegen` hat – sonst könnte jeder sein Repo einem fremden Raum
  zuschreiben (`mitRaumRechten()` → `raumBestaetigt`).
- **Dann pflegen es alle mit `repos_pflegen`** wie eingetragene Maintainer:
  `darfAnnehmen()` und `patchStatus()` zählen ihre Status-Events (1630–1633).
  Es gilt der Raum, wie er jetzt Rechte vergibt – wem das Recht entzogen
  wird, dessen Status zählen nicht mehr.
- **Der Raum-Zustand** entsteht nur aus der Definition, die der Besitzer aus
  der Adresse signiert hat (`raumZustandFuer()`); eine gleichnamige
  Definition eines anderen ist ein anderer Raum.

Wie alle Rechte in Räumen ist das eine Regel, die jeder Client selbst
auswertet. Andere NIP-34-Clients sehen ein gewöhnliches Repo mit einem
zusätzlichen `a`-Tag.

### Private Räume (MLS, seit 11.4b)

In privaten Räumen sind alle Repo-Events **innere Events der MLS-Gruppe**
(`raumRepoAnkuendigung()`, `raumRepoBundle()`, `raumRepoPatch()`,
`raumRepoStatus()`), jeweils mit `["space", <raum>]` vorn – nie offen
(Leak-Regel `raum-repo-privat`):

| Art | Inhalt |
|---|---|
| 30617 | Ankündigung wie oben, ohne `a`-Verweis auf einen öffentlichen Raum |
| 38042 | Bundle-Verweis samt `["aes-gcm", key, nonce, ox]` – öffentlich stünde der Schlüssel offen (8.9b), hier nur für Mitglieder |
| 1617 | Patch (Text aus `git format-patch`), `a` = `30617:<ankündigender>:<kennung>` |
| 1630–1633 | Status, `e` = Id des inneren Patch-Events |

Den Absender belegt MLS. `raumReposPrivat()` liest daraus die Repos:
Ankündigungen und Bundles zählen nur von Pflegern (Admins der Gruppe oder
`repos_pflegen`), je Autor und Kennung die neueste; Maintainer sind alle
Pfleger; Patches von jedem Mitglied. Relays sehen nur Kind 445,
Speicherknoten nur das verschlüsselte Bundle.

## 19. Issues und Kommentare in Repos (NIP-34, NIP-22, seit C-17a)

Wie bei GitHub gibt es zu jedem Repo Issues und unter Issues und Patches eine
Diskussion. Beides sind Standard-Events anderer Clients – kein eigenes Format.

**Issue** (Kind 1621, NIP-34, `baueIssue()`/`leseIssue()` in `nip34.ts`):

| Tag | Inhalt |
|---|---|
| `a` | `30617:<eigentümer>:<kennung>` – das Repo |
| `p` | Eigentümer des Repos |
| `subject` | Betreff, Pflicht, höchstens 200 Zeichen |
| `t` | Labels, je eines ohne Leerzeichen und Komma, höchstens 40 Zeichen |

Der Inhalt ist der Text (höchstens 30 KB). **Status** mit denselben Arten wie
bei Patches: 1630 offen, 1631 erledigt, 1632 geschlossen (`e` = Id des Issues,
`baueIssueStatus()`); 1633 gibt es für Issues nicht. Es gilt der neueste Status
der Autorin, des Eigentümers oder eines Maintainers (`issueStatus()`) – Status
anderer zählen nicht; ohne Status ist ein Issue offen.

**Kommentar** (Kind 1111, NIP-22, `kommentar.ts`) an einem Issue (1621) oder
Patch (1617):

| Tag | Inhalt |
|---|---|
| `E`, `K`, `P` | Wurzel: Id, Art und Autor des Issues bzw. Patches |
| `e`, `k`, `p` | worauf geantwortet wird: die Wurzel selbst oder ein Kommentar (Art 1111) |

Der Inhalt ist der Text (höchstens 20 KB). Gelesen wird streng
(`leseKommentar()`): nur an Issues und Patches, Bezüge als 64-stellige
Hex-Werte, sonst fällt der Kommentar heraus.

**In privaten Räumen** (wie 11.4b) sind Issue, Status und Kommentar nur innere
Events der MLS-Gruppe (`raumRepoIssue()`, `raumRepoIssueStatus()`,
`raumRepoKommentar()`), jeweils mit `["space", <raum>]` vorn; die Bezüge eines
Kommentars sind die Ids der inneren Events. `raumReposPrivat()` liefert sie als
`issues` und `kommentare`. Die Leak-Regel `raum-repo-privat` weist offene
Issues zum Repo und offene Kommentare zu inneren Issues und Patches ab.

**Reviews an Patches** (seit C-20g1, `review.ts`; Vorschlag nach der
Entscheidung des MENSCHEN vom 02.10.2026, alle Formate aus C-20 auszuarbeiten).
Wie ein Review bei GitHub: Kommentare an einzelnen Zeilen des Diffs und eine
Bewertung. Beides ist ein Kommentar nach NIP-22 (Kind 1111, Tags wie oben) am
Patch mit **einem Tag mehr** – andere Clients zeigen es als gewöhnlichen
Kommentar.

| Tag | Inhalt |
|---|---|
| `zeile` | `<pfad>`, `<seite>`, `<nummer>` – Kommentar an einer Zeile: Pfad nach dem Diff (ohne `a/`/`b/`, höchstens 2.000 Zeichen, keine Steuerzeichen), Seite `neu` (Zeilennummer nach der Änderung) oder `alt` (davor, für entfernte Zeilen), Nummer 1 bis 10.000.000 ohne führende Null |
| `bewertung` | `genehmigt` oder `aenderungen` – nur direkt am Patch (`E` = `e`, `K` = `k` = 1617); der Inhalt ist die Begründung und darf leer sein |

Ein Zeilenkommentar darf wie jeder Kommentar antworten (`e` = Kommentar); er
trägt dann denselben Zeilenbezug. Gelesen wird streng
(`zeilenKommentareZu()`, `leseBewertung()`): ein kaputter Bezug oder eine
unbekannte Bewertung fällt heraus. Es zählt je Person die neueste Bewertung
(bei gleicher Sekunde die größere Id); die eigene Bewertung des Patch-Autors
zählt nicht (`bewertungenZu()`), Bewertungen von Eigentümer und Maintainern
sind als solche markiert. Annehmen bleibt eine Sache des Status (1631) –
eine Bewertung nimmt nichts an. In privaten Räumen nur als innere Events
(`raumRepoZeilenKommentar()`, `raumRepoBewertung()`); die Leak-Regel
`raum-repo-privat` weist sie offen ab wie jeden Kommentar zu einem inneren
Patch.

**Releases** (seit C-20h1, `repo-release.ts`; Vorschlag nach derselben
Entscheidung). Wie ein Release bei GitHub: eine Version mit Titel, Notizen und
auf Wunsch dem Bundle genau dieser Version. Format ist der NIP-51-Satz
„Release artifact set“ (Kind 30063), ersetzbar je Autor:

| Tag | Inhalt |
|---|---|
| `d` | `<repo-kennung>@<version>` |
| `a` | `30617:<eigentümer>:<kennung>` – das Repo; es steht für die „Anwendung“ aus NIP-51 |
| `p` | Eigentümer des Repos |
| `version` | wie ein Git-Tag: Buchstabe oder Ziffer, dann auch `. _ + - /`, kein `..`, höchstens 100 Zeichen |
| `title` | Titel, Pflicht, höchstens 200 Zeichen, keine Steuerzeichen |
| `commit` | SHA-1 des Commits (optional) |
| `blob`, `aes-gcm` | Bundle dieser Version (optional): Manifest-Id und öffentlicher Schlüssel `[key, nonce, ox]` wie im Bundle-Verweis 38042 |
| `vorab` | Vorabversion (ohne Wert, optional) |
| `zurueckgezogen` | Rückzug: ersetzt das eigene Release dieser Version, ohne Titel und Inhalt |

Der Inhalt sind die Notizen (Markdown, höchstens 64 KB). Abweichend von NIP-51
steht das Bundle nicht als NIP-94-Datei (1063, `e`), sondern im Release selbst:
Der Bundle-Verweis 38042 ist ersetzbar und zeigt immer auf das neueste Bundle,
ein Release hält seine Version fest. Es zählen nur Releases von Eigentümer und
Maintainern (`repoReleasesZu()`), je Version die neueste Aussage (bei gleicher
Sekunde die größere Id); ist sie ein Rückzug, fehlt die Version. Das neueste
Release ist das jüngste ohne `vorab` (`neuestesRepoRelease()`). Nicht zu
verwechseln mit dem Release-Manifest der App (38054, `release.ts`). In privaten
Räumen nur als inneres Event (`raumRepoRelease()`, `raumRepoReleaseRueckzug()`;
`raumReposPrivat()` liefert `releases`); die Leak-Regel `raum-repo-privat`
weist ein offenes Release eines solchen Repos ab.

**Labels ändern und Zuständige** (seit C-20i1, `repo-labels.ts`; Vorschlag nach
derselben Entscheidung). Wie bei GitHub setzen Eigentümer und Maintainer
nachträglich Labels und weisen Personen zu – als Label-Event nach NIP-32
(Kind 1985) an genau einem Issue oder Patch:

| Tag | Inhalt |
|---|---|
| `L` | genau ein Namensraum: `#t` (Labels, wie die `t`-Tags eines Issues) oder `freedomstack.zustaendig` (Zuständige) |
| `l` | je Wert einer, mit dem Namensraum als drittem Feld: Label (ohne Leerzeichen und Komma, höchstens 40 Zeichen, höchstens 20) bzw. Schlüssel als Hex (höchstens 10) |
| `e` | das Ziel: Id des Issues oder Patches – genau eines |
| `k` | Art des Ziels: `1621` oder `1617` |

Zuständige stehen bewusst nicht als `p`-Tags im Event: In 1985 wären das
weitere Ziele. Abweichend vom additiven NIP-32 nennt ein Event den **ganzen
Stand** seines Namensraums: Es zählt je Ziel und Namensraum die neueste
Aussage von Eigentümer oder Maintainern (`labelStandZu()`, bei gleicher Sekunde
die größere Id); ein Event ohne `l` entfernt alle. Ohne Aussage gelten die
`t`-Tags des Issues. Andere Clients sehen die Labels als gewöhnliche Labels
nach NIP-32. In privaten Räumen nur als inneres Event (`raumRepoLabels()`;
`raumReposPrivat()` liefert `labels`); die Leak-Regel `raum-repo-privat` weist
ein offenes Label-Event zu einem inneren Issue oder Patch ab.

**Forks, Sterne und Beobachten** (seit C-20j1, `nip34.ts`, `repo-sterne.ts`;
Vorschlag nach derselben Entscheidung).

- **Fork:** eine eigene Ankündigung (30617) des Forkenden mit
  `["a", "30617:<eigentümer>:<kennung>", "", "fork"]` – gelesen nur mit der
  Marke `fork` und nie mit der eigenen Adresse (`forkVon`, `forksVon()`). Wie
  bei NIP-34 üblich trägt ein Fork denselben ersten Commit (`r` mit `euc`).
- **Stern:** öffentlich, eine Reaktion nach NIP-25 (Kind 7, Inhalt `⭐`) mit
  genau einem `a` = Repo, dazu `p` = Eigentümer und `k` = `30617`.
  Zurücknehmen mit einer Löschung nach NIP-09 (Kind 5, `e` = Id des Sterns,
  `k` = `7`). Gezählt wird je Person höchstens ein Stern; ein Stern, den sein
  Autor gelöscht hat, zählt nicht – auch wenn ein Relay die Löschung nicht
  befolgt (`sterneZu()`).
- **Beobachten:** privat – eine NIP-51-Liste „Git repositories“ (Kind 10018)
  **nur mit privaten Einträgen**: Der Inhalt ist `[["a", <adresse>], …]`,
  mit dem eigenen Schlüssel nach NIP-44 verschlüsselt; offene Tags gibt es
  nicht (`baueBeobachtungsListe()`, `leseBeobachtungsInhalt()`, höchstens 500).
  Anders als bei GitHub gibt es darum keine Zahl der Beobachter.

In privaten Räumen gibt es Sterne und Forks nicht offen; die Leak-Regel
`raum-repo-privat` weist einen Stern (7), einen offenen Listeneintrag (10018)
und einen Fork (30617 mit Verweis) zu einem Repo eines privaten Raums ab.

## 20. Umfragen und Termine in privaten Räumen (NIP-88, NIP-52, seit B-15a)

Standard-Events anderer Clients, kein eigenes Format – aber nur als innere
Events der MLS-Gruppe (`raum-planung.ts`), jeweils mit `["space", <raum>]` vorn;
Relays sehen Kind 445. Bezüge sind die Ids der inneren Events, wer schrieb,
belegt MLS.

**Umfrage** (Kind 1068, NIP-88, `raumUmfrage()`): Inhalt ist die Frage
(höchstens 500 Zeichen).

| Tag | Inhalt |
|---|---|
| `h` | Kanal |
| `option` | `<id>`, `<text>` – 2 bis 20 Antworten, je höchstens 100 Zeichen, Ids „0“, „1“, … |
| `polltype` | `singlechoice` oder `multiplechoice` |
| `endsAt` | optional: Ende als Unix-Zeit |

**Stimme** (Kind 1018, `raumStimme()`): `e` = Id der Umfrage, je gewählter
Antwort `["response", <id>]`. Es zählt je Mitglied die letzte Stimme vor
`endsAt`; bei einfacher Wahl nur die erste bekannte Antwort, unbekannte fallen
weg (`raumUmfragen()`).

**Termin** (NIP-52, `raumTermin()`): Kind 31923 mit Uhrzeit (`start`, `end`
als Unix-Zeit, optional `start_tzid`) oder Kind 31922 ganztägig (`start`,
`end` als JJJJ-MM-TT); dazu `h` (Kanal), `d` (zufällig, 32 Hex-Zeichen),
`title` (Pflicht, höchstens 200 Zeichen), optional `location` (200); die
Beschreibung als Inhalt (2.000). `end` liegt nie vor `start`.

**Antwort** (Kind 31925, `raumTerminAntwort()`): `e` = Id des Termins,
`a` = `<art>:<autor>:<d>`, `d` (zufällig), `status` = `accepted`, `declined`
oder `tentative`. Es zählt je Mitglied die letzte (`raumTermine()`).

Umfrage und Termin zählen nur von jemandem, der in den Kanal schreiben darf
(wie Nachrichten, `canWriteTo()`). Löschen wie bei Nachrichten: Kind 5 vom
Autor, 4891 von einem Admin (`gruppenRaum()` nennt Gelöschtes seit B-15a in
`geloescht`).

## 21. Knoten mit Besitzer koppeln (seit B-8a)

KI-Anfragen kommen von Wegwerf-Schlüsseln (3.1); der Knoten erkennt seinen
Besitzer nur an einem Kopplungsgeheimnis (Entscheidung L1 A, `kopplung.ts`).

**Kopplungscode** (als Text und QR): `freedom-kopplung:1:<knoten>:<geheimnis>`
– Schlüssel des Knotens und 32 Byte Geheimnis, beides 64 Hex-Zeichen klein.
Der Knoten erzeugt das Geheimnis (`neueKopplung()`); ein neues ersetzt das
alte, so widerruft der Besitzer alle bisher gekoppelten Geräte.

**Nachweis** im Kern einer Anfrage an den eigenen Knoten (`mitBesitzerNachweis()`,
vor dem Versiegeln):

| Tag | Inhalt |
|---|---|
| `besitzer` | HMAC-SHA256 mit dem Geheimnis über `freedomstack-besitzer-v1:<pubkey des Kerns>:<created_at>`, hex |

Nie das Geheimnis selbst, nur an den Knoten im `p`-Tag. Der Knoten prüft ihn
nur in Anfragen aus einem Umschlag (`istBesitzer()`): genau ein Tag, die Zeit
höchstens 600 s von seiner Uhr entfernt, Vergleich in fester Zeit. Offen steht
der Tag nie (Leak-Regel `besitzer-versiegelt`).

## 22. Kanäle offener Räume (Kind 34703, seit B-20a)

Bis B-20 änderte nur der Gründer die Kanäle eines offenen Raums – die
Definition (34700) trägt seine Signatur. Seit B-20 (Entscheidung 01.10.2026)
schreiben auch Berechtigte ein eigenes Event je Kanal (`spaces.ts`):

| Tag | Inhalt |
|---|---|
| `d` | `kanal:<kennung>:<kanal>` |
| `space` | Kennung des Raums |
| `a` | Adresse des Raums, `34700:<gründer>:space:<kennung>` (`raumAdresse()`) |
| `channel` | `<kanal>`, `<name>`, `offen`, `<position>`, `<schreibrollen>` (durch senkrechten Strich getrennt, wie in 34700), `<thema>` – anlegen oder ändern (`baueRaumKanal()`) |
| `entfernt` | `<kanal>` – statt `channel`: Kanal entfernen (`baueKanalEntfernung()`) |

Genau einer von `channel` und `entfernt`; Kanal-Kennung aus Buchstaben,
Ziffern, `. _ -` (höchstens 64), Name höchstens 100 Zeichen, Thema 500,
höchstens 20 Schreibrollen. Ein Kanal im offenen Raum ist immer `offen` –
jeder liest mit (`leseRaumKanal()` nimmt nichts anderes an).

**Auswertung** (`mitRaumKanaelen()`, aus `raumZustandFuer()`): Es zählen nur
Events an genau die Adresse des Raums. Je Kanal gilt die neueste Aussage; die
Definition des Gründers sagt zu ihrer Zeit etwas über jeden Kanal, den sie
nennt – was sie nicht nennt, entfernt sie nicht. Vom Gründer zählt jedes
Event, von anderen nur, wenn

- der Autor heute „kanaele_verwalten“ hat (wie bei der Moderation, B-19:
  Wird ihm das Recht entzogen, fallen seine Änderungen weg, auch
  zurückdatierte), und
- der Kanal vorher wie nachher nur Schreibrollen bis zu seinem Rang nennt –
  einen Kanal, in den nur Höhere schreiben, öffnet oder entfernt er nicht.

Neue Kanäle zählen höchstens bis 100 je Raum; Events, die mehr als 600 s in
der Zukunft liegen, gar nicht (`KANAL_GRENZEN`) – sonst gewönne ein
vordatiertes Event gegen jede spätere Änderung, auch die des Gründers.

**Rolle für alle** (seit B-22, Entscheidung 08.10.2026 – wie „@everyone“ bei
Discord): Nennt die Rollenliste des Gründers (34701) eine Rolle mit der Kennung
`jeder` (`JEDER_ROLLE`), gilt sie für jeden, auch ohne Zuweisung (34702). Davon
zählen nur `lesen`, `schreiben` und `threads` (`JEDER_RECHTE`) – Moderieren,
Rollen vergeben, Kanäle verwalten und Repos pflegen gibt es nur über eine
zugewiesene Rolle mit Rang. Wer nur sie hat, schreibt in Kanälen ohne
Schreibrollen und in Kanälen, die `jeder` nennen; #ankündigungen (`mod`) bleibt
bei den Moderatoren. Neue offene Räume legt die App mit ihr an; der Gründer
nimmt sie mit einer neuen Rollenliste wieder heraus (dann schreibt nur, wer eine
Rolle hat, wie vor B-22). Ältere Räume ohne sie bleiben, wie sie sind.

## 23. Halten beim eigenen Knoten (Kind 5076, seit B-9b)

Entscheidung L4 A: Der Besitzer lässt einen verschlüsselten Blob von seinem
Knoten dauerhaft halten. Hochgeladen wird wie bisher (§6, nur Chiffrat);
der Auftrag sagt nur, *welchen* Blob der Knoten holen und behalten soll.

**Kern** (DVM-Anfrage, nur versiegelt vom Sitzungsschlüssel an den gekoppelten
Knoten, `baueHalteAuftrag()`):

| Tag | Inhalt |
|---|---|
| `i` | Blob-Id (64 Hex-Zeichen) |
| `param` | `manifest`, Id des Manifests (38040) – nur dieses zählt |
| `p` | Schlüssel des Knotens |
| `besitzer` | Nachweis nach §21 |

Der Knoten bearbeitet ihn nur aus einem Umschlag und nur mit gültigem
Nachweis. Er holt genau das genannte Manifest – verschlüsselt, dieselbe
Blob-Id im Inhalt, Erasure-Angaben stimmig (`halteManifest()`) – und nur
Stücke von dessen Autor mit den Hashes aus dem Manifest. Gehaltene Stücke
verdrängt er nie; sie zählen zur Quota, darüber nimmt er keine an.

**Antwort** (6076, versiegelt an den Sitzungsschlüssel): Inhalt
`{"gehalten": n, "noetig": d, "gesamt": t}` – gehaltene Stücke, Daten-Stücke
über alle Gruppen, alle Stücke (`leseHalteAntwort()`, sonst nichts anzeigen).
Abgerufen werden gehaltene Stücke wie alle über 5075.

## 24. Status des eigenen Knotens (Kind 5077, seit B-11a)

Entscheidung L6 A: Der Besitzer sieht, wie es seinem Knoten geht – nur lesen.
Steuern (Modelle laden, Neustart, Einstellungen) gehört nicht dazu.

**Kern** (DVM-Anfrage, nur versiegelt vom Sitzungsschlüssel an den gekoppelten
Knoten, `baueStatusAuftrag()`): `i` = `status`, `bid` = 0, `p` = Schlüssel
des Knotens, `besitzer` = Nachweis nach §21. Der Knoten bearbeitet sie nur aus
einem Umschlag und nur mit gültigem Nachweis; Statusabfragen zählen nicht als
Aufträge.

**Antwort** (6077, versiegelt an den Sitzungsschlüssel), Inhalt als JSON
(`knotenStatusText()`, gelesen nur mit `leseKnotenStatus()`):

| Feld | Inhalt |
|---|---|
| `fassung` | Fassung des Knotens, 1–32 Zeichen `0-9A-Za-z.+-` |
| `seit` | Start des Prozesses, Unix-Sekunden |
| `rollen` | gestartete Rollen aus `ki`, `relay`, `speicher`, `gateway`, `zahlkanal`, `lnurl`, `lp`, `relayer`, `tor`, `app`, `turn` (seit B-13a); unbekannte Kennungen (Kleinbuchstaben, z. B. `pruefer` älterer Knoten von P3b bis P5a) bleiben unbeachtet |
| `modelle` | angebotene Modelle, höchstens 50 Namen zu je höchstens 100 Zeichen, ohne Steuerzeichen |
| `auftraege` | `erledigt`, davon `gratis`, und `abgelehnt` seit dem Start |
| `abgerechnetMsat` | seit dem Start in Antworten verlangt (nicht unbedingt schon bezahlt) |
| `speicher` | `belegtBytes`, `quotaBytes` (0 = ohne Grenze), `gehalten` – oder `null` |
| `relay` | `events`, `verbindungen` – oder `null` |
| `weckSchluessel` | seit B-12a, darf fehlen: öffentlicher VAPID-Schlüssel des Knotens (P-256, unkomprimiert, base64url, 87 Zeichen) |
| `einrichtung` | seit B-11c, darf fehlen: Befunde der Selbstprüfung beim Start, höchstens 40, je `schiene` (`lightning`, `sol`), `stufe` (`ok`, `hinweis`, `fehler`), `fall` (`ln.…`/`sol.…`) und `werte` (höchstens 6, nur ganze Zahlen ab 0 oder Fehlernamen aus Buchstaben) |

Unbekannte Felder bleiben unbeachtet, damit ein neuerer Knoten mehr melden
kann; bekannte müssen stimmen, sonst zeigt die App nichts. Kein Text aus
Aufträgen, keine Meldungen, keine Adressen.

## 25. Wecken über den eigenen Knoten (Kind 5078, seit B-12a)

Entscheidungen W1 A und W2 A: Ist die App zu, weckt der eigene Knoten den
Browser per Web Push – ohne Inhalt, ohne Absender, nur mit VAPID (RFC 8030,
RFC 8292). Der Push-Dienst des Browserherstellers sieht, *dass* geweckt wird,
nicht was.

**Kern** (DVM-Anfrage, nur versiegelt vom Sitzungsschlüssel an den gekoppelten
Knoten, `baueWeckAnmeldung()`): `i` = `wecken`, `bid` = 0, `p` = Schlüssel des
Knotens, `besitzer` = Nachweis nach §21, dazu als `param`:

| Name | Inhalt |
|---|---|
| `aktion` | `an` (ersetzt eine frühere Anmeldung derselben Adresse) oder `ab` – genau einmal |
| `endpunkt` | Push-Adresse aus `PushSubscription.endpoint`: https, öffentlicher Host, ohne Zugangsdaten, höchstens 1000 Zeichen – genau einmal |
| `schluessel` | je ein Schlüssel, dessen Post weckt (die Person, ihre Geräte), 1–20; beim Abmelden keiner |

Andere Namen machen die Anmeldung ungültig (`leseWeckAnmeldung()`). Der Knoten
nimmt sie nur aus einem Umschlag mit gültigem Nachweis an und hält höchstens 10
Adressen. Die Push-Adresse ist ein Zugang zu einem Browser: Sie steht nur im
Kern, nie offen und nie im Log des Knotens.

**Antwort** (6078, versiegelt an den Sitzungsschlüssel): `{"aktion": "an"|"ab",
"schluessel": n}` – wie viele Schlüssel der Knoten für diese Adresse beobachtet,
nach dem Abmelden 0 (`leseWeckAntwort()`). Den öffentlichen VAPID-Schlüssel nennt
der Status (§24, `weckSchluessel`); ohne ihn kann die App kein Abo anlegen.

**Wecken** (seit B-12b): Liegt ein neuer Umschlag an einen gemeldeten Schlüssel,
schickt der Knoten an die passende Push-Adresse eine leere Nachricht (RFC 8030)
mit `Authorization: vapid t=<ES256-Token>, k=<weckSchluessel>` (RFC 8292, `aud`
= Ursprung der Adresse, 12 Stunden gültig), `TTL: 3600`, `Urgency: high` und
`Topic: freedom` – kein Inhalt, kein Absender. Neu heißt: nach Kennung noch nicht
gesehen (Umschläge sind bis zu zwei Tage zurückdatiert, NIP-59); höchstens
ein Weckruf je Adresse und Minute.

## 26. Zugang zum TURN des eigenen Knotens (Kind 5079, seit B-13a)

Entscheidungen T1 A und T2 A: Anrufe laufen nur über einen Vermittler (TURN,
RFC 8656) auf dem eigenen Knoten – das Gegenüber sieht nie die IP. Den
Vermittler stellt coturn als eigener Dienst; der Knoten vergibt nur zeitlich
begrenzte Zugänge nach TURN-REST.

**Kern** (DVM-Anfrage, nur versiegelt vom Sitzungsschlüssel an den gekoppelten
Knoten, `baueTurnAnfrage()`): `i` = `turn`, `bid` = 0, `p` = Schlüssel des
Knotens, `besitzer` = Nachweis nach §21. Der Knoten antwortet nur aus einem
Umschlag mit gültigem Nachweis; Zugänge zählen nicht als Aufträge.

**Antwort** (6079, versiegelt an den Sitzungsschlüssel), gelesen nur mit
`leseTurnZugang()`:

| Feld | Inhalt |
|---|---|
| `urls` | 1–4 Adressen `turn:`/`turns:host[:port][?transport=udp|tcp]` (RFC 7065) |
| `nutzer` | `<Ablauf>:<Zufall>` – Ablauf in Unix-Sekunden, Zufall 8–64 Zeichen base64url |
| `passwort` | base64(HMAC-SHA1(`TURN_SECRET`, `nutzer`)), 28 Zeichen – so prüft coturn mit `use-auth-secret` |
| `bis` | Ablauf, gleich der Zahl im Nutzernamen; in der Zukunft, höchstens einen Tag entfernt |

Der Zugang ist ein Geheimnis: nur versiegelt, nie offen, nie im Log, nicht
über seinen Ablauf hinaus gemerkt.

## 27. Anruf-Aufbau im Umschlag (innen Kind 25040, seit B-13c)

Entscheidungen T1 A und T2 A: Angebot, Antwort, Kandidaten und Ende eines Anrufs
(WebRTC) reisen nur versiegelt (NIP-59), je Empfänger ein Umschlag – an die
Person und ihre Geräte (`baueAnrufNachricht()`, höchstens 20). Der Umschlag
trägt offen nur `p` und `expiration` (fünf Minuten, NIP-40), keinen Zeitversatz:
Ein Anruf ist jetzt oder nie.

**Kern:** Kind 25040, Tags `["p", <Empfänger>]`, `["anruf", <Kennung>]`, Inhalt JSON:

| `typ` | Felder |
|---|---|
| `angebot` | `anruf` (32 Hex), `sdp`, `medien` (`["audio"]` oder `["audio","video"]`) |
| `antwort` | `anruf`, `sdp` |
| `kandidat` | `anruf`, `kandidat` (`candidate`, `sdpMid`, `sdpMLineIndex`) |
| `ende` | `anruf`, `grund` (`aufgelegt`, `abgelehnt`, `besetzt`, `zeit`, `fehler`) |

**Nur über den Vermittler:**
- Gesprochen wird nur über den TURN des eigenen Knotens (§26,
  `iceTransportPolicy: "relay"`).
- Im SDP und in Kandidaten stehen nur Kandidaten vom Typ `relay`
  (`pruefeSdpNurRelay()`, `istRelayKandidat()`). Host-, srflx-, prflx- und
  mDNS-Kandidaten verrieten dem Gegenüber die eigene Adresse – sie gehen nie
  hinaus und werden nie gelesen.
- Angebot und Antwort tragen einen DTLS-Fingerabdruck (SHA-256). Er bindet die
  verschlüsselten Medien an den Absender des Siegels.
- `oeffneAnrufNachricht()` nimmt nur Nachrichten an diesen Schlüssel, nicht
  älter als fünf Minuten, mit passender Kennung im Tag.

**Zugang im Angebot** (seit B-13d1, Entscheidung T3 B): Wer angerufen wird und
keinen eigenen Knoten hat, hat keinen eigenen Vermittler. Das Angebot darf
deshalb ein Feld `turn` tragen:
- Form wie die Antwort aus §26: `urls`, `nutzer`, `passwort`, `bis`.
- Geprüft mit `pruefeTurnZugang()`, wie bei `leseTurnZugang()`: gültig beim
  Bauen und beim Öffnen, höchstens einen Tag.
- Mit ihm verbindet sich die Angerufene über den TURN der Anruferin. Dann
  sieht deren Knoten die IP-Adresse der Angerufenen; die App sagt das vor dem
  Annehmen.
- Der Zugang ist ein Geheimnis – er steht nur im versiegelten Kern.
- In Antwort, Kandidat und Ende gibt es kein `turn`.

**Leak-Regel `anruf-nur-relay`** (`regelAnrufNurRelay()`):
- Kind 25040 steht nie in einem gesendeten Event.
- In den inneren Events (Mitschnitt vor dem Versiegeln) stehen nur
  Relay-Kandidaten mit Fingerabdruck.

## 28. Messbericht der Freedom-Prüfung (Kind 38081) – nicht mehr belegt

Von P1b bis P5a veröffentlichten Prüfer-Knoten hier Messwerte je Provider und
Modell, aus eigenen synthetischen Prüffragen. Mit der Entscheidung vom
05.10.2026 fielen Prüfer, Prüffragen und Berichte weg: Geprüft wird in
Prüfrunden – die App schickt etwa jede 400. Antwort die echte Anfrage an drei
Provider statt an einen, bezahlt aus dem Prüfbudget (seit P5c2 mit Lightning,
über Zahlkanäle ab P5d; `docs/FREEDOM-PRUEFUNG.md`). Apps werten 38081 nicht mehr
aus; das Kind wird nicht wiederverwendet.

**Stufen** (`PRUEF_GRENZEN`, `stufeAus()`) gelten weiter für die eigene Messung
der App: erst ab 20 eigenen Anfragen, davor `neu`. Ab 95 % Erfolg `normal`, ab
80 % `herabgestuft`, darunter `ausgefallen`. Ein Ausfall in den letzten
60 Sekunden stellt einen Provider nach hinten. Eine Rangliste gibt es nicht –
die Rangfolge bildet jede App selbst (`ordneNachPruefung()`).

## 29. Kopfgelder (Kind 38061, Entscheidung E10 B)

Jemand beschreibt eine Aufgabe und sagt einen Betrag zu; wer sie erledigt,
bekommt ihn direkt vom Geldgeber. Kein Topf, keine Runde, niemand verwahrt
etwas – A+ kennt keinen Topf (§3). Ersetzbar je Autor und `d`: Den Stand
setzt nur der Geldgeber.

| Tag | Inhalt |
|---|---|
| `d` | `bounty:<kennung>` |
| `bounty` | Kennung (Buchstaben, Ziffern, `._-`, höchstens 64) |
| `title` | Titel (höchstens 200 Zeichen) |
| `amount_msat` | Zusage in Lightning (msat) – mindestens eine der beiden Zusagen |
| `amount_lamports` | Zusage in SOL (Lamports) |
| `status` | `offen`, `vergeben`, `erledigt`, `zurueckgezogen` |
| `p` | bei `vergeben` und `erledigt`: an wen (nie der Geldgeber selbst) |
| `e` | das Issue (Id des Events 1621, §19) – freiwillig |
| `a` | das Repo (`30617:<besitzer>:<kennung>`) – freiwillig |

Inhalt: die Beschreibung (höchstens 8.000 Zeichen). Gebaut nur über
`baueKopfgeld()`, gelesen nur über `leseKopfgeld()` (Signatur, ganze Beträge
über 0, bekannter Stand, `p` genau bei vergeben und erledigt, `d` passend zur
Kennung). Den Stand liefert `aktuelleKopfgelder()` – je Geldgeber und Kennung
der neueste; ein Fremder kann ein Kopfgeld nicht als erledigt melden, er legt
höchstens ein eigenes an. Zum Issue: `kopfgelderZuIssue()`.
