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
| 38020–38022 | frei geworden: Sitzung auf Kredit (Open/Payment/Close), fiel mit RM2c3, RM2c4a und RM2c4b (§38) – nicht wiederverwenden |
| 38027 | Provider-Capabilities (models, tools, storage, relay; Gratis-Start §30). Speicher: `["storage", <kapazität-bytes>, <msat-je-MB>, <bootstrap 0/1>, <gratis-bytes?>]` – der vierte Wert seit E9-2: bis zu dieser Größe einer Datei hält der Knoten gratis (ganze Zahl bis 2⁴⁰, sonst keine Angabe; `leseSpeicherGratis()`). Eine netzweite Gratis-Schwelle gibt es nicht |
| 38028 | Cluster-Angebot: Gerät als Hälfte eines Paars verfügbar (§36, seit E9-1 – vorher lag es auf 38026, dem Kurs-Ticker) |
| 38030 / 38031 | *nicht mehr belegt* (Mesh-Paket / Kurier-Zustellbeleg; nie angebunden, entfernt mit B-21 – über Mesh geht seit 7.1 nur der Umschlag) |
| 38040 / 38041 | Blob-Manifest / Blob-Chunk |
| 38042 | Git-Repo-Referenz |
| 38050 / 38051 | *nicht mehr belegt* (Treasury-Ankündigung bis 5.1.4a, Fee-Beweis des Knotens bis 5.1.4c) |
| 38052 | Werbe-Nennung, signiert vom Geworbenen (§15) |
| 38053 | *nicht mehr belegt* (Verteilungsbericht des Reward-Pools, bis 5.1.2) |
| 38059 / 38060 | *nicht mehr belegt* (Runde und Zuteilung aus einem Topf, nie veröffentlicht, entfernt mit E10 B am 04.10.2026) |
| 38061 | Kopfgeld für eine Aufgabe, meist ein Issue – in sats, SOL oder beiden (§29, `kopfgeld.ts`) |
| 38075 | Zusammenfassung des Rufs, nur als versiegelter Kern an Kontakte (§17) |
| 38076 | Code zum Eintippen: Kopplungscode des Knotens, verschlüsselt mit einem Schlüssel aus dem Code, Ablauf zehn Minuten (§35, seit VKf) |
| 38080 | Modellkatalog eines Kurators (NIP-51-Set: `d`, `title`, `description`, je Modell `["model", <kennung>, <notiz?>, <manifest-id?>]` – das vierte Feld seit E9-4: die Id eines Manifests 38057, nach dem Knoten laden, die dem Katalog folgen; `modell-katalog.ts`) |
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
Rolle hat, wie vor B-22). Ältere Räume ohne sie bleiben, wie sie sind. Wie
jedes Recht gilt sie im heutigen Stand: Fehlt sie, zählen auch frühere
Nachrichten von Leuten ohne Rolle nicht mehr; kehrt sie zurück, wieder.

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
| `rollen` | gestartete Rollen aus `ki`, `relay`, `speicher`, `gateway`, `zahlkanal`, `lnurl`, `lp`, `relayer`, `tor`, `app`, `turn` (seit B-13a), `code` (seit A-31 VKc1); unbekannte Kennungen (Kleinbuchstaben, z. B. `pruefer` älterer Knoten von P3b bis P5a) bleiben unbeachtet |
| `modelle` | angebotene Modelle, höchstens 50 Namen zu je höchstens 100 Zeichen, ohne Steuerzeichen |
| `auftraege` | `erledigt`, davon `gratis`, und `abgelehnt` seit dem Start |
| `abgerechnetMsat` | seit dem Start in Antworten verlangt (nicht unbedingt schon bezahlt) |
| `speicher` | `belegtBytes`, `quotaBytes` (0 = ohne Grenze), `gehalten` – oder `null` |
| `relay` | `events`, `verbindungen` – oder `null` |
| `weckSchluessel` | seit B-12a, darf fehlen: öffentlicher VAPID-Schlüssel des Knotens (P-256, unkomprimiert, base64url, 87 Zeichen) |
| `einrichtung` | seit B-11c, darf fehlen: Befunde der Selbstprüfung beim Start, höchstens 40, je `schiene` (`lightning`, `sol`), `stufe` (`ok`, `hinweis`, `fehler`), `fall` (`ln.…`/`sol.…`) und `werte` (höchstens 6, nur ganze Zahlen ab 0 oder Fehlernamen aus Buchstaben) |
| `modellPruefung` | seit E9-3b, darf fehlen: `befunde` (höchstens 30, je `name` des Modells wie bei `modelle`, `stufe`, `fall` (`modell.…`) und `werte` wie bei `einrichtung`) und `laeuft` (darf fehlen: `name`, `schritt` (`manifest`, `vorpruefung`, `laden`, `pruefen`), `seit`, beim Laden `geladen` und `gesamt` in Bytes). Ein eigenes Feld, nicht in `einrichtung` – ältere Apps übergehen es. Was der Leser abwiese, schickt der Knoten nicht. |

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

## 30. Gratis-Start im Angebot (Tag `gratis` in 38027, seit A-14a)

Entscheidung G1 vom 08.10.2026. Ein Kontingent je Person kann ein Knoten nicht
durchsetzen, ohne Anfragen zu verknüpfen: Schlüssel kosten nichts, und die App
wechselt sie je Unterhaltung. Deshalb verschenkt jeder Knoten ein Budget für
alle zusammen und nennt es im Angebot:

`["gratis", <Tokens am Tag>, <Tokens je Antwort>, <Bits>]`

| Feld | Bedeutung |
|---|---|
| Tokens am Tag | so viel rechnet der Knoten je Tag (UTC) gratis, Frage samt Verlauf und Antwort aus seiner eigenen Abrechnung; Vorgabe 100 000 |
| Tokens je Antwort | höchstens so lang wird eine Gratis-Antwort – der Knoten begrenzt beim Modell; Vorgabe 2 000 |
| Bits | Rechenarbeit (NIP-13) des Umschlags einer Gratis-Anfrage ohne Gebot – mehr als `pow` für bezahlte; Vorgabe 16 |

- Gratis gibt es ohne Werkzeuge und ohne Schwarm, beides sprengte die Grenze je
  Antwort.
- Ist das Budget verbraucht, sagt die Rückmeldung (7000, `status` `error`) das
  mit dem Tag `["fall", "gratis-leer"]` – die App erkennt den Fall daran, nicht
  am Text. `["free", "0"]` im Angebot heißt dann: heute nichts mehr gratis.
- In der Bootstrap-Phase (erste 24 Stunden) bedient der Knoten auch Gebote
  gratis, nach derselben Regel; Gutschriften (Zahlkanal) und Sitzungen lehnt er
  dort weiter ab – eine Gutschrift gälte auch später.
- Gebaut und gelesen nur über `gratisTag()`/`leseGratisTag()` (`gratis.ts`):
  drei ganze Zahlen im Bereich, sonst keine Angabe. Ohne den Tag verschenkt ein
  Knoten nichts nach dieser Regel.
- Wie viel ein Gerät gratis fragt, zählt die App selbst (A-14b) – eine
  Fairness-Regel, keine Sperre.

## 31. Modell-Manifest und Laden über Ollama (Kind 38057, seit E9-3a)

Ein Manifest beschreibt ein Modell samt Prüfsummen (`model-registry.ts`).
Ersetzbar je Autor und `d`. Jeder kann eines veröffentlichen; wem ein Knoten
glaubt, entscheidet sein Betreiber (V3 A aus `docs/E9-ENTWURF.md`, freigegeben
08.10.2026): dem eigenen Schlüssel und – seit E9-4 – genau den Manifesten, die
Modellkataloge nennen, denen er folgt (38080, viertes Feld im `model`-Tag;
`MODELL_KATALOGE` im Knoten).

| Tag | Inhalt |
|---|---|
| `d` | `model:<name>` |
| `model` | Name; bei Ollama der Name dort, mit Tag (`qwen2.5:0.5b`) |
| `name` | Anzeigename |
| `bytes` | Summe der Dateigrößen |
| `file` | je Datei: Name, SHA-256 (hex), Größe in Byte, Blob-Kennung im eigenen Netz (leer erlaubt) |
| `upstream` | Herkunft; für Ollama `ollama:<derselbe Name>` |
| `quant`, `params_b`, `license` | freiwillig |

**Laden über Ollama:**
- **Dateinamen:** Jede Datei heißt wie ihr Blob bei Ollama (`sha256-<hex>`).
  Dazu gehören alle Schichten und die Konfiguration aus dem Manifest der
  Registry (Docker-Format v2); `ollamaDateien()` baut diese Liste.
- **Manifest wählen:** Der Knoten wählt eines über `vertrautesManifest()`.
  - Es zählen nur das eigene Manifest (das neueste) und Manifeste, deren Id
    ein abonnierter Katalog nennt (`katalogFreigaben()`) – kein Schlüssel
    gibt allein etwas frei.
  - Das eigene geht vor.
  - Sonst müssen alle freigegebenen dieselben Dateien nennen; bei Streit
    wählt er keines.
- **Eigenes Manifest:** `npm run modell -- <name> --aus-registry`. Der Knoten
  signiert, was die Registry jetzt nennt, und veröffentlicht es. Später geladen
  wird gegen dieses Manifest; eine neue Fassung in der Registry braucht ein
  neues Festhalten.
- **Prüfen:** Geprüft wird vor dem Laden gegen die Registry und danach gegen
  die Schichten, die Ollama gemeldet hat (`pruefeSchichten()`: jede über
  `verifyFile()`, Größe gleich, keine fremde, keine fehlende).
- **Grenze der Prüfung:** Ollama prüft die Bytes jeder Schicht gegen ihre
  Summe. Der Knoten prüft, dass es die Summen des Manifests sind.

**Laden von Hugging Face** (seit B-29c1a, Quelle entschieden vom MENSCHEN am
12.10.2026; für Antriebe außer Ollama, die ein Modell aus einem Ordner lesen):
- **Name und Herkunft:** `model` ist die Kennung bei Hugging Face
  (`Qwen/Qwen2.5-7B-Instruct`), so nennt der Antrieb das Modell
  (`--served-model-name`). `upstream` ist `hf:<Kennung>@<Commit>` mit 40
  Zeichen Hex – nie ein Zweig, der sich ändern kann (`hfQuelle()`).
- **Dateien:** Jede heißt wie im Repo, nur aus der obersten Ebene und nur
  `.safetensors`, Konfiguration und Tokenizer (`HF_DATEI`: `.json`, `.model`,
  `.txt`, `.tiktoken`, `.jinja`). Pickle (`.bin`, `.pt`) und Python nie – beides
  kann beim Laden Code ausführen. Ohne `config.json` und safetensors kein Modell.
- **Festhalten:** Hugging Face nennt je Commit (`/api/models/<Kennung>/revision/<rev>?blobs=true`)
  für große Dateien (LFS) die SHA-256, für kleine nur die Git-Kennung (SHA-1
  über `blob <Länge>\0` und Inhalt). Wer festhält, lädt die kleinen, prüft
  ihre Git-Kennung und rechnet die SHA-256 selbst.
- **Prüfen:** vor dem Laden gegen den Stand am Commit des Manifests
  (`vorpruefeHf()`: Namen, Größen, LFS-Summen), danach jede Datei beim Laden
  (SHA-256, nie mehr Bytes als angekündigt) und der Ordner als Ganzes
  (`pruefeDateien()`: je Name dieselbe Summe und Größe, keine fremde, keine
  fehlende).

**Über BitTorrent im eigenen Netz** (seit B-29c2a, MENSCH 12.10.2026: aria2c,
Pirate Face, verbunden mit dem dezentralen Freedom-Dateisystem):
- **„Ich halte vor“ (38058)** nennt zwei Tags mehr: `["magnet", <Magnet-Link>]`
  und `["inhalt", <Inhalts-Kennung>]`. Ältere Meldungen ohne beides bleiben
  gültig.
- **Inhalts-Kennung** (`inhaltsKennung()`): SHA-256 über die sortierten Zeilen
  `<sha256>:<größe>` der Dateien eines Manifests. Sie ist für jeden
  Herausgeber gleich, der dieselben Dateien festhält – so finden Knoten Seeds
  zu ihrer Fassung, auch wenn jeder sein eigenes Manifest signiert.
- **Magnet-Link** (`leseMagnet()`):
  - genau eine Kennung `xt=urn:btih:` (Hex oder Base32); eine v2-Kennung
    daneben bleibt unbeachtet;
  - Tracker nur `udp`, `http`, `https`, `wss`, Web-Seeds nur `https`, nie
    lokale oder private Hosts, höchstens 10 bzw. 5;
  - alles andere (`dn`, `xs`, `as` …) fällt weg; weitergegeben wird nur der
    neu gebaute Link.
- **Quellen** (`magnetQuellen()`): Meldungen mit gültiger Signatur, demselben
  Modell, derselben Inhalts-Kennung und gültigem Magnet, höchstens 14 Tage alt;
  je Knoten die neueste; die meistgemeldeten Torrents zuerst.
  - Vertrauen braucht es dafür nicht: Die Bytes prüft das Manifest, gleich
    woher sie kommen.
  - BitTorrent v1 prüft nur SHA-1-Stücke, der Knoten danach die SHA-256 jeder
    Datei.

## 32. Agenten in Räumen – Karte, Besitzer, Rolle (Kind 38090, seit 11.3b1)

Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`, freigegeben 08.10.2026 (F1 A, F4 A, F6 A).
Ein Agent hat einen eigenen Schlüssel, nie die Identität seines Erstellers.

**Karte** (Kind 38090), ersetzbar je Autor und `d`; Autor ist der Agent, Inhalt leer:

| Tag | Inhalt |
|---|---|
| `d` | `karte` |
| `name` | Anzeigename, höchstens 64 Zeichen |
| `about` | Beschreibung, höchstens 500 Zeichen, freiwillig |
| `betrieb` | `knoten` oder `geraet` – wo der Schlüssel liegt und wer antwortet |
| `bezahlung` | `fragender` oder `einlader` – wer eine Antwort bezahlt |
| `p` | `<besitzer>`, `""`, `besitzer` – behauptet, zählt nur bestätigt; nie der Agent selbst |
| `provider` | Schlüssel des Providers, der rechnet; freiwillig |
| `modell` | gewünschtes Modell, freiwillig |

Jedes Feld höchstens einmal; unbekannte Werte, Steuerzeichen oder ein Inhalt
machen die Karte ungültig. Keine Persona und keine Systemanweisung – die hält
der Gastgeber (F4 A).

**Bestätigung des Besitzers** (F1 A): eine NIP-51-Liste (Kind 30000, `d` =
`freedom-agenten`) vom Besitzer, je Agent ein `p`, höchstens 100. Ein Besitzer
gilt nur, wenn seine neueste Liste den Agenten nennt (`besitzerBestaetigt()`).
Eine neue Liste ohne ihn widerruft.

**Rolle** `agent` in offenen Räumen (F6 A, `mitAgentRolle()`): lesen, schreiben,
Threads, Rang 1. Steht sie mit mehr Rechten in der Rollenliste, gilt sie nur mit
diesen drei – ein Agent moderiert nie. Zugewiesen wird sie wie jede Rolle (34702).

**Private Räume:** Karte und Liste nur als innere Events der Gruppe
(`raumAgentKarte()`, `raumAgentenListe()`, gelesen über `raumAgentKarten()` und
`raumListenEvents()`); den Absender belegt MLS. Leak-Regel `agent-raum-privat`:
keine Karte, keine Liste mit dem Agenten und keine Nachricht von oder an ihn offen.
KeyPackages (443) darf er offen haben – sonst lädt ihn niemand ein.

**Wann ein Agent antwortet** (seit 11.3b2, `agent-auftrag.ts`, P3, F5):
- Nur auf eine Nachricht, die ihn erwähnt (`p` … `mention`), von einem Mitglied mit
  Schreibrecht im Kanal, nie auf eigene (`sollAntworten()`).
- Je Absender höchstens 3 Aufträge je Minute, auch für Agenten (`AuftragsBremse`).
- **Agentenketten:** Schreibt ein Agent, antwortet ein anderer nur, wenn der Raum es
  erlaubt – Tag `["agentenketten", <grenze>]` in der Definition (offen 34700 vom
  Gründer, privat im Raumstand), Grenze 1 bis 50, ohne Tag aus. Dazu müssen seine
  Antworten aus einem Budget kommen. Gezählt wird rückwärts über `e` … `reply` bis
  zum ersten Menschen (`kettenLaenge()`); erreicht die Kette die Grenze, antwortet
  dort kein Agent mehr.
- **Kontext:** nur der Kanal der Erwähnung, im Thread nur der Thread samt Anfang,
  ohne Thread nur Nachrichten ohne Thread, nur davor, in den Grenzen des Fragenden
  (`agentKontext()`); andere Agenten gekennzeichnet.
- **Verweis im Auftrag** an einen Knoten-Agenten, nur im versiegelten Kern:
  `["agent-raum", <Adresse des offenen Raums oder Gruppe>]` (Gruppe: 32 bis 64 Zeichen Hex –
  MDK vergibt 16 Byte; bis 11.3d2b nahm der Baustein nur 64 und keine echte Gruppe),
  `["agent-erwaehnung", <Id>]`.
- **Agent auf dem Knoten** (seit 11.3d1a, offene Räume, „wer fragt, zahlt“): Der
  Knoten nimmt den Verweis nur aus einem Umschlag, prüft die Erwähnung mit dem
  Stand des Raums (`entscheide()` mit `ausBudget: false`, die Definition nur über
  `definitionDesGruenders()`, `d` = `space:<kennung>`) und rechnet nur Persona,
  Verlauf und Erwähnung aus dem Raum – nie die Eingabe des Auftrags. Jede Erwähnung
  beantwortet er höchstens einmal. Abgelehnt wird vor dem Rechnen, als Rückmeldung
  (7000, `error`) mit `["fall", <kennung>]`: `agent-nur-versiegelt`, `agent-keiner`,
  `agent-privat` (Gruppen erst mit 11.3d2), `agent-nur-text`, `agent-schon-beantwortet`,
  `agent-keine-erwaehnung`, `agent-kein-raum`, `agent-raum-nicht-erreichbar`,
  `agent-nicht-veroeffentlicht` und `agent-<grund>` aus `entscheide()`
  (`agent-kein-schreibrecht`, `agent-ohne-budget` …).
- **Agent auf dem Knoten in privaten Räumen** (seit 11.3d2a): eigenes MLS-Konto
  des Agenten (Schlüssel des Agenten, nie der des Knotens). Er veröffentlicht
  Kind 10002 und 10050 mit den Relays des Knotens und ein KeyPackage (30443,
  fester d-Tag, neu nach jedem Beitritt). Einladungen (Kind 444 im Umschlag)
  nimmt er nur nach dem Schalter des Betreibers an (`besitzer`: nur vom
  Besitzer, `alle`), höchstens 20 Gruppen. Danach sendet er seine Karte als
  inneres Event. Antworten (seit 11.3d2b) nur auf einen bezahlten Auftrag mit der
  Gruppe im Verweis: dieselben Regeln (`entscheide()` mit `ausBudget: false`), der
  Raum aus dem, was er als Mitglied liest (`gruppenRaum()`), die Antwort als
  inneres Event (Art 9, `raumAgentAntwort()`). Ablehnung `agent-privat`, wenn er
  nicht Mitglied der Gruppe ist oder der Knoten keine privaten Räume zulässt.
  Die App (seit 11.3d2c) fragt wie im offenen Raum, mit der Gruppe und der Id des
  inneren Events im Verweis; lädt jemand einen Agenten ein, dessen Karte `knoten`
  nennt, warnt sie vorher und schreibt danach den Pflicht-Hinweis in den ersten
  Kanal („der Knoten liest alles in diesem Raum mit“).
- **„@Name“** (seit 11.3d1b1): Die App setzt `p` … `mention` für Agenten, deren Name
  im Text als ganzes Wort nach „@“ steht – ohne Groß/klein, nur Agenten des Raums
  (offen: Mitglieder mit der Rolle `agent` und gültiger Karte; privat: Karten der
  Gruppe), höchstens fünf; teilen sich zwei Agenten einen Namen, erwähnt sie keinen
  (`erwaehnteAgenten()`).
- **Fragen an einen Agenten auf dem Knoten** (seit 11.3d1b2): Nach dem Senden im
  offenen Raum zeigt die App für jeden erwähnten Agenten, dessen Karte `betrieb`
  `knoten`, `bezahlung` `fragender` und `provider` nennt, den Preis (Gebot
  höchstens 100 sats wie bei Agenten auf dem Gerät) und schickt erst nach der
  Bestätigung einen versiegelten Auftrag an den Knoten: von einem frischen
  Sitzungsschlüssel, mit fester Eingabe und dem Verweis im Kern, bezahlt wie jede
  KI-Anfrage (Lightning nach A+ oder Gutschrift im Zahlkanal). Grenze
  „agent-knoten“ im Datenschutzbericht.
- **Antwort:** offen Kind 42 mit `h`, `e` … `root` (im Thread), `e` … `reply` auf
  die Erwähnung und `p` … `mention` des Fragenden; privat dasselbe als inneres Event
  (Art 9). Höchstens 4000 Zeichen.
- **Monatsbudget (F2):** Gutschriften im Zahlkanal sind kumulativ. Die nächste
  liegt eine Stufe (Standard 10 % des Budgets) über dem Verbrauchten, nie über dem
  Budget (`naechsteStufe()`). Ohne Arbeit löst der Knoten so höchstens eine Stufe
  ein.

## 33. Repo-Aufträge an Agenten in Räumen (seit 11.5b)

Entwurf `docs/REPO-AGENTEN-ENTWURF.md` (V1, V6). Ein Repo-Auftrag ist eine
Erwähnung des Agenten (§32, wie jede Frage im Raum), die auf ein Repo des Raums
zeigt. Offen steht das an der Raum-Nachricht (Kind 42), privat am inneren Event
(Kind 9) der Gruppe.

| Tag | Bedeutung |
|---|---|
| `["a", "30617:<eigentümer>:<kennung>", "", "repo"]` | das Repo – genau eines (`repoAuftragTags()`, `leseRepoAuftrag()`) |
| `["e", <issue>, "", "issue"]` | optional ein Issue des Repos (offen das Event, privat das innere Event) |

- **Zum Raum gehören:** Offen verweist die neueste Ankündigung des Repos auf genau
  diesen Raum, und ihr Eigentümer hat dort `repos_pflegen` (`repoImOffenenRaum()`
  über `mitRaumRechten()`). Privat hat ein Pfleger der Gruppe es angekündigt
  (`repoImPrivatenRaum()` über `raumReposPrivat()`). Sonst lehnt der Agent mit der
  Kennung `agent-repo-fremd` ab.
- **Agenten pflegen nie** (V6): Wer im Raum ein Agent ist (offen die Rolle `agent`,
  `istAgentIm()`; privat eine Agent-Karte in der Gruppe), zählt nicht als Pfleger –
  auch mit `repos_pflegen` oder als Admin. Ein Repo, das ein Agent angekündigt hat,
  gehört nicht zum Raum. Status-Events (1630–1633) von Agenten zählen nie, auch nicht
  am eigenen Patch (`patchStatus(…, istAgent)`). Annehmen bleibt `darfAnnehmen()`
  für Menschen mit Recht.

## 34. Vibecoden auf dem eigenen Knoten (Kind 5080, seit A-31)

Entwurf `docs/VIBECODEN-ENTWURF.md` (VKa). Abschnitt 33 gilt Repo-Aufträgen an
Agenten in Räumen (11.5b). Der gekoppelte Besitzer gibt seinem Knoten vom Handy
aus Aufträge an Projekte auf dem Knoten. Fremde bekommen nie Zugang.

**Kern** (DVM-Anfrage, nur versiegelt vom Sitzungsschlüssel an den gekoppelten
Knoten, `baueCodeAuftrag()`): `i` = `code`, `bid` = 0, `p` = Schlüssel des
Knotens, `besitzer` = Nachweis nach §21. Dazu `param`-Tags, je Name genau einer,
keine anderen (gelesen nur mit `leseCodeAuftrag()`):

| `aktion` | weitere Parameter | Antwort (6080) |
|---|---|---|
| `liste` | – | `projekte`: höchstens 100 × `{ name, schritte, geaendert }` |
| `neu` | `projekt` | `projekt` |
| `auftrag` | `projekt`, `text` (1–8000 Zeichen), `modus` (`fragen` oder `frei`) | `ende`, `schritte`, `abschluss` (höchstens 4000 Zeichen) – erst am Ende des Laufs |
| `freigabe` | `lauf` (Id des Auftrags, 64 Hex), `schritt` (1–200), `antwort` (`ja` oder `nein`) | `ok` |
| `bundle` (seit VKl) | `projekt` | `blob`, `manifest` (Id des Manifest-Events, 64 Hex), `schluessel` (`alg`, `key`, `nonce`, `ox` wie bei Anhängen, §2.4), `bytes` (1 bis 32 MiB) |
| `stopp` | `lauf` | `ok` |

- **Projektname:** `[a-z0-9][a-z0-9-]{0,39}` – zugleich der Name seines Ordners
  auf dem Knoten, ohne Punkt und Schrägstrich.
- **`ende`:** `fertig`, `grenze`, `gestoppt`, `abgelehnt`, `fehler` – feste
  Kennungen, die App bildet den Text.

**Schritte eines Laufs** (Rückmeldung 7000 mit `status` = `partial`, `e` = Id des
Auftrags, versiegelt an seinen Sitzungsschlüssel). Inhalt JSON, gelesen nur mit
`leseCodeSchritt()`:

| `art` | Felder |
|---|---|
| `befehl` | `nr` (1–200), `gedanke` (höchstens 2000 Zeichen), `befehl` (1–2000 Zeichen), `wartet` (im Modus `fragen` bis zur Freigabe) |
| `ausgabe` | `nr`, `ausgabe` (höchstens 10 000 Zeichen, darüber gekürzt), `code` (−1 bei Zeitablauf, sonst 0–255), `gekuerzt` |

Der Knoten antwortet nur aus einem Umschlag mit gültigem Nachweis
(`istBesitzer()`). Projekte, Befehle und Ausgaben reisen nur versiegelt
zwischen dem Besitzer und seinem Knoten; ins Log kommen nur Zahlen und
Kennungen.

**Ablauf eines Laufs** (seit VKc2, Motor über ACP – Agent Client Protocol):
- `auftrag` startet den Lauf im Hintergrund; das Ergebnis (6080) kommt erst an
  seinem Ende. Je Projekt läuft höchstens ein Lauf, auf dem Knoten höchstens drei.
- Jeder Werkzeug-Aufruf des Motors ist ein Schritt: erst `befehl`, nach seinem Ende
  `ausgabe`. Nennt der Motor keinen Rückgabewert, ist `code` 0 bei Erfolg und 1
  bei Fehlschlag. Ein Schritt mit Änderungen im Projekt wird ein Commit
  `Schritt <nr>`.
- Im Modus `fragen` kommt der `befehl` eines Schritts, der auf Freigabe wartet, mit
  `wartet` – auch ein zweites Mal, wenn er zuvor ohne kam. Ein Schritt wartet,
  solange zu seiner `nr` ein `befehl` mit `wartet` und noch keine `ausgabe`
  vorliegt. Die Reihenfolge der Umschläge sagt nichts (Zeitstempel nach NIP-59):
  die App ordnet nach `nr`, `befehl` vor `ausgabe`.
- `freigabe` wählt beim Motor „einmal erlauben“ bzw. „einmal ablehnen“, nie „immer“.
  Ohne Antwort nach 60 s gilt „nein“ (wie Hermes über ACP). Im Modus `frei` erlaubt der
  Knoten jeden Befehl einzeln selbst.
- Wann ein Schritt wartet, entscheidet der Motor: Hermes (seit VKc3) fragt vor jeder
  Änderung an Dateien und vor Befehlen, die er für riskant hält – nicht vor jedem Befehl.
  Eine Freigabe kann ein eigener Schritt sein, ohne `ausgabe`.
- `stopp` bricht den Lauf ab (`gestoppt`); nach 60 min bricht der Knoten selbst ab
  (`grenze`), ebenso nach 200 Schritten.
- `freigabe` und `stopp` antworten `ok: false`, wenn der Schritt nicht wartet bzw.
  der Lauf nicht (mehr) läuft.

**Ablehnungen** (seit VKc1): Rückmeldung 7000 mit `status` = `error` und
`["fall", <kennung>]`, versiegelt wie die Antwort. Die App erkennt den Fall am
Tag, nie am Text:

| `fall` | Bedeutung |
|---|---|
| `code-aus` | Vibecoden ist auf dem Knoten aus (`VIBECODEN=1` fehlt, oder git fehlt) |
| `code-ohne-motor` | `auftrag`, `freigabe`, `stopp`: der Knoten hat keinen Motor – er startet ihn nur in der Sandbox (VKb, VKc3) |
| `code-belegt` | `auftrag`: in diesem Projekt läuft schon ein Lauf, oder auf dem Knoten laufen schon drei |
| `code-zu-viele` | `neu`: schon 100 Projekte |
| `code-git` | `neu`: git konnte das Projekt nicht anlegen; `bundle`: git konnte das Bundle nicht bauen |
| `code-ablage` | der Ordner der Projekte ist nicht lesbar oder nicht beschreibbar |
| `code-leer` | `bundle`: das Projekt hat noch keinen Commit |
| `code-zu-gross` | `bundle`: das Bundle wäre größer als 32 MiB |

`neu` mit einem vorhandenen Namen ändert nichts und antwortet wie beim Anlegen.
Den Status-Eintrag `code` (§24) meldet ein Knoten nur, wenn Vibecoden an ist.

**Bundle** (seit VKl): Der Knoten erzeugt `git bundle create … --all`, verschlüsselt es wie einen
Anhang (AES-GCM, `verschluesseleDatei()`) und legt Manifest (38040) und Stücke (38041, `verschluesselt`)
ins Blob-Netz – signiert von einem **Wegwerfschlüssel**, nie vom Schlüssel des Knotens: Sonst verbände
ein Repo im Raum den Besitzer mit seinem Knoten. Mit Speicher-Rolle hält der Knoten die Stücke selbst
(ohne Verdrängung, wie §B-9b). Den Schlüssel zum Blob bekommt nur der Besitzer, versiegelt in der Antwort;
die App stellt das Repo damit in einen Raum (VKl2).

## 35. Code zum Eintippen (Kind 38076, seit VKf)

Koppeln ohne Kamera (K1 aus `docs/VIBECODEN-ENTWURF.md`, VK-W9). `npm run koppeln -- --code` zeigt
zwölf Zeichen Crockford-Base32 in drei Vierern (`7KQ2-9XMB-4TRP`, 60 Bit), gültig zehn Minuten; das
Skript legt nur `~/.freedom/kurzcode.json` an (0600) und verbindet sich mit keinem Relay.

**Ableitung** (`kurzcodeAbleitung()`): PBKDF2-SHA256 über die zwölf Zeichen (ohne Striche), Salz
`freedomstack-kurzcode-v1`, 600 000 Runden, 64 Byte. Die ersten 32 Byte sind der Schlüssel für
NIP-44 v2 (als Gesprächsschlüssel, ohne ECDH), die letzten 32 Byte – als Hex – die Suchkennung.

**Event des Knotens** (`baueKurzcodeEvent()`, signiert mit dem Schlüssel des Knotens):

```
kind 38076, pubkey = Knoten
tags: ["d", <Suchkennung>], ["expiration", <Frist>]
content: NIP-44(Schlüssel aus dem Code, "freedom-kopplung:1:<knoten>:<geheimnis>")
```

Die App sucht `{"kinds": [38076], "#d": [<Suchkennung>]}` am eigenen Pool und an der Startliste und
nimmt nur, was `leseKurzcodeEvent()` durchlässt: gültige Signatur, passende Kennung, Frist nicht
vorbei und höchstens zehn Minuten nach `created_at`, entschlüsselbar und der Knoten im Kopplungscode
gleich dem Autor. Eingelöst wird der Code mit der Statusabfrage (§ B-11a, 5077): im versiegelten Kern
`["kurzcode", <Suchkennung>]`; der Knoten prüft zuerst den Nachweis des Besitzers und löscht dann das
Event (NIP-09: `e`, `a` = `38076:<knoten>:<Suchkennung>`, `k`) samt Datei – ebenso nach der Frist.

**Was Relays sehen:** dass dieser Knoten einen Code zum Koppeln veröffentlicht hat, und wann. Nicht
den Code, nicht das Geheimnis, nicht wer koppelt. Wer das Event mitliest, muss für jeden der 2^60
Codes 600 000 Runden rechnen – auch, um es überhaupt einem Code zuzuordnen.

## 36. Cluster-Pairing: Angebot offen, Absprache versiegelt (Kind 38028, innen 25050, seit E9-1)

Zwei Geräte rechnen ein großes Modell gemeinsam (K = 2). Nach V1 A aus
`docs/E9-ENTWURF.md` (freigegeben 08.10.2026) sieht der Kunde nur den
**führenden Knoten**: Er zahlt nur ihn (A+ wie jede KI-Antwort), und der
haftet für die Antwort. Den Partner mietet der führende Knoten selbst und
bezahlt ihn direkt, außerhalb des Protokolls.

**Angebot (Kind 38028, ersetzbar je `d`):** `["d", "cluster:<region>"]`,
`["mem_gb", …]`, `["mem_bw", …]` (GB/s), `["uplink", …]` (Mbit/s),
`["region", …]` (`[a-z0-9-]`, höchstens 32), `["rtt", …]` (ms),
`["rate", …]` (sats je Stunde), `["window", <von>, <bis>]`, optional
`["direct_link", "1"]`. Gelesen nur über `parseClusterOffer()` – Zahlen nicht
negativ, Zeitfenster nicht leer, sonst ungültig.

**Absprache (innen Kind 25050, nur im Umschlag nach NIP-59 an den Partner):**
`["p", <partner>]`, `["model", <name>]`, `["window", <von>, <bis>]`,
`["rate", <sats je Stunde>]`, optional `["e", <Id der Absprache>]` als
Bestätigung. Gebaut und gelesen nur über `baueClusterAbsprache()` und
`oeffneClusterAbsprache()`.

- Kein öffentliches Paar-Ereignis und keine Bilanz daraus: Wer bei wem
  mietet, verrät Geschäftsbeziehungen, und eine Bilanz mit Vorrang wäre eine
  öffentliche Rangliste. Das alte Paar-Event (bis E9-1 auf 38027, dem Kind des
  Provider-Angebots) und die „Reziprozität“ mit 5 % Protokollgebühr fielen weg.
- Betrieben wird ein Paar erst mit zwei Geräten (E9-5); bis dahin sind es
  Bausteine.

## 37. Abgleich mit Negentropy (NIP-77, seit B-35a)

Zwei Seiten finden heraus, welche Events der anderen fehlen, ohne alle Ids zu schicken – nach einer Zeit
ohne Netz, zwischen dem eigenen Relay und anderen, über ein Funk-Gateway. Verfahren und Nachrichten wie
[NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md) und die Referenz von Doug Hoyte, Fassung 1
(`0x61`); eigene Umsetzung in `negentropy.ts` (Entscheidung NG1 B), Byte für Byte gleich der Referenz
(Vektoren aus `scripts/negentropy-referenz.mjs`, Referenz gepinnt auf Commit und Prüfsumme).

- **Einträge:** je Event Zeit (`created_at`) und Id, sortiert nach Zeit, dann Id; keine doppelten.
- **Nachricht:** Fassung, dann Bereiche bis zu einer oberen Grenze (Zeit als Abstand + 1, `0` = unendlich;
  kürzester Id-Präfix, der zwei Nachbarn trennt) mit Überspringen (0), Fingerabdruck (1: SHA-256 über die
  Summe der Ids mod 2^256, little-endian, und die Anzahl als Varint – 16 Byte) oder Id-Liste (2). Ab 32
  Einträgen teilt eine Seite einen Bereich in 16. Zahlen sind Varints mit der höchsten Stelle zuerst.
- **Rollen:** Wer beginnt (`beginne()`), sammelt `habe` und `brauche`; die andere Seite antwortet nur. Mit
  Rahmengröße (ab 4096 Byte) bricht eine Antwort vorher ab und nennt für den Rest einen Fingerabdruck.
- **Grenzen** (`NEG_GRENZEN`): Nachricht höchstens 512 KB, Id-Liste höchstens 100 000 Ids, Varints bis 2^53;
  Unpassendes ergibt `NegFehler` mit Kennung (`neg.format`, `neg.gross`, `neg.fassung`), nie Text aus der Nachricht.
- **Relay-Rolle (seit B-35b):** `NEG-OPEN` (Kennung, ein Filter, erste Nachricht) legt den Stand fest – nur Events,
  die `darfAusliefern()` der Verbindung auch per `REQ` zeigen würde (Umschläge nur an den angemeldeten Empfänger; ein
  Filter auf Umschläge ohne Anmeldung ergibt `blocked: … auth-required`). Höchstens 50 000 Events je Abgleich, Rahmen
  60 000 Byte, offene Abgleiche zählen wie Abos, jede Nachricht wie eine Abfrage. `NEG-ERR` nur mit festen Texten
  (`blocked:`, `closed:`, `error:`); NIP-11 nennt 77.
- **Noch nicht:** der Abgleich nach Funkstille (B-35c: eigenes Relay mit anderen, Gateway).

## 38. Cashu-Pfand für Lightning-Sitzungen (seit RM2a)

Der Zahlkanal für Lightning (`docs/RM2-ENTWURF.md`, entschieden 14.10.2026): Die App sperrt kleine
Cashu-Token auf den Pfand-Schlüssel des Providers und übergibt je Anfrage die nächsten. Der Provider prüft
sie ohne Mint und löst sie vor der Frist ein. Rechnungen nach [NUT-00](https://cashubtc.github.io/nuts/00/)
(hash_to_curve), [NUT-11](https://cashubtc.github.io/nuts/11/) (P2PK) und
[NUT-12](https://cashubtc.github.io/nuts/12/) (DLEQ), geprüft gegen deren Testvektoren (`pfand.ts`).

- **Im Angebot (38027):** `["cashu_mint", <url>]` je Mint, die der Provider annimmt (höchstens 5; https,
  `.onion` auch über http, ohne Zugangsdaten und ohne `/` am Ende), dazu `["cashu_pfand", <Schlüssel>, <Fassung>]`
  – der Pfand-Schlüssel komprimiert (33 Byte hex), nicht der Schlüssel des Knotens; Fassung 1. Ohne beides gibt es
  kein Pfand; die App fragt dann mit Gebot je Auftrag. Unbrauchbare Angaben gelten als keine.
- **Im versiegelten Kern der Anfrage:** genau ein `["pfand", <Mint>, <Token als JSON>]`. Ein Token ist ein Proof
  nach NUT-00 (`id`, `amount`, `secret`, `C`) mit Beweis nach NUT-12 (`dleq`: `e`, `s`, `r`); höchstens 64 je
  Anfrage, das Geheimnis höchstens 1024 Zeichen. Eine leere Liste `[]` (seit RM2b1) heißt: keine neuen Token, gerechnet
  wird gegen das schon Übergebene. Nie offen – die Leak-Regel `keine-zahlungsdaten` kennt `pfand`.
- **Prüfung beim Provider (`pruefePfand()`), ohne Mint:**
  - die Mint steht in seiner Liste (`pfand-mint`);
  - Keyset und Betrag kennt er aus den Schlüsseln der Mint, nur in sat (`pfand-mint-schluessel`);
  - der Beweis stimmt gegen diesen Schlüssel (`pfand-dleq`);
  - das Geheimnis ist eine P2PK-Sperre genau auf seinen Pfand-Schlüssel – keine weiteren Schlüssel (`pubkeys`),
    eine Unterschrift, `SIG_INPUTS` (`pfand-sperre`);
  - `locktime` mindestens 15 Minuten weg – eingelöst wird bis zehn Minuten davor (`pfand-frist`);
  - ein Rückweg (`refund`) für die App (`pfand-rueckweg`);
  - kein Token doppelt, auch nicht schon angenommen (`pfand-doppelt`).
  Gilt ein Teil nicht, gilt keiner. Zurück der Betrag und die früheste Frist.
- **Im Knoten (seit RM2b1):** `PfandKasse` (`node/src/pfand-kasse.ts`) – Deckung je Sitzungsschlüssel der Anfrage, netto
  (Nennwert minus Gebühr der Mint je Token, NUT-02), gesehene Geheimnisse und angenommene Token in einer Datei (0600),
  eingelöst gesammelt je Mint ohne Beweis, spätestens zehn Minuten vor der Frist.
- **Im Provider (seit RM2b2):** nur mit `PFAND=1` und `PFAND_MINTS`. Gedeckt sein muss der Anteil des Providers an
  Gebot und Werkzeugen (A+, RM2 V4) – die übrigen Anteile zahlt die App nach der Antwort; gebucht wird vor der Antwort
  der Anteil des Providers am Preis. Ein Pfand neben einer Gutschrift (§ Zahlkanal) lehnt er ab. Das Angebot nennt nur
  Mints, deren Schlüssel die Kasse kennt.
- **Über Tor und Auszahlung (seit RM2b3):** Mit `TOR_SOCKS` gehen alle Anfragen an die Mints durch Tor. Der Erlös geht je Mint
  ab 1000 sat an die eigene Lightning-Adresse (`NODE_LUD16`, NUT-05) – die Rechnung über genau den Betrag, der Rest nach
  Gebühr und Vorbehalt fürs Routing bleibt als Wechselgeld.
- **In der App (seit RM2c1/RM2c2):** Der Cashu-Topf sperrt Fenster (mindestens 20 sat, Frist eine Stunde, klein gestückelt,
  frischer Rückweg je Fenster) auf den Pfand-Schlüssel und übergibt je Anfrage, bis die Deckung reicht – dieselbe Rechnung wie
  der Knoten. Nur ohne Zahlkanal, nicht an den eigenen Knoten, nicht im Max-Modus, nicht in Prüfrunden; nennt das Angebot die
  Mint des Topfs nicht oder reicht der Topf nicht, geht die Anfrage wie bisher. Nach der Antwort bucht die App den Anteil des
  Providers, Lightning zahlt ihn nicht. Nach der Frist holt sie zurück, was der Provider nicht einlöste.
- **Ohne Sitzung auf Kredit (seit RM2c3):** Die App eröffnet keine Sitzung (38021) mehr und schickt keine Belege (38022).
  Ohne Pfand und Zahlkanal trägt jede Anfrage ihr Gebot, und die App zahlt den Anteil des Providers nach jeder Antwort, sobald
  ganze sats fällig sind – Kredit höchstens eine Antwort; der Rest unter einem sat wartet auf die nächste Antwort desselben
  Sitzungsschlüssels oder auf das Begleichen beim Wechsel der Unterhaltung. Seit RM2c4a nimmt auch der Knoten keine Sitzung
  und keine Belege mehr an: Ein Auftrag mit `session`, hinter dem keine SOL-Hinterlegung steht (bis E8), wird abgesagt
  („bitte mit Gebot fragen“) oder nach G1 gratis bedient – nie mehr auf Kredit. Seit RM2c4b gibt es die Bausteine dafür nicht
  mehr (`stream.ts`, `buildPrivateSessionEvent()`); `openPrivateKundenEvent()` nimmt versiegelte Sitzungen und Belege nicht
  mehr an.
- **Noch nicht:** „Guthaben laden“ und die Wahl der Mint bringt RM2d (Oberfläche).
