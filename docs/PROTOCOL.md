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
   2,5 %   Entwicklung (selbstverwahrte Adressen des Projekts)    25.000
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

### DVM-Jobs (NIP-90; Result = Request + 1000)
| Kind | Bedeutung |
|---|---|
| 5050 | Text-Generierung |
| 5062 | Browser-Automation |
| 5070 | Bild-Generierung |
| 5071 | Video-Generierung |
| **5075** | Blob-Chunk-Fetch (Storage-Micro-Reward) |

### Freedom-spezifisch (38xxx)
| Kind | Bedeutung |
|---|---|
| 38010 | Performance-Beleg (Worker, Season) |
| 38011 / 38012 | *nicht mehr belegt* (Reward-Payout-Nachweis, Saison mit Pool-Regeln; nie veröffentlicht, entfernt mit 5.1.4d) |
| 38013 | *nicht mehr belegt* (Reward-Claim, bis 5.1.4b) |
| 38020–38022 | Sessions (Open/Payment/Close) |
| 38027 | Provider-Capabilities (models, tools, storage, relay) |
| 38030 / 38031 | Mesh-Packet / Delivery-Receipt |
| 38040 / 38041 | Blob-Manifest / Blob-Chunk |
| 38042 | Git-Repo-Referenz |
| 38050 / 38051 | *nicht mehr belegt* (Treasury-Ankündigung bis 5.1.4a, Fee-Beweis des Knotens bis 5.1.4c) |
| 38052 | Werbe-Nennung, signiert vom Geworbenen (§15) |
| 38053 | *nicht mehr belegt* (Verteilungsbericht des Reward-Pools, bis 5.1.2) |
| 38080 | Modellkatalog eines Kurators (NIP-51-Set: `d`, `title`, `description`, je Modell `["model", <kennung>, <notiz?>]`; `modell-katalog.ts`) |

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
  (`?ref=<pk>&ln=<lud16>`). Die App des Geworbenen merkt sich den ersten Werber
  und zahlt ihm 0,5 % jeder KI-Zahlung – ohne öffentliche Nennung; ein
  späterer Link verdrängt ihn nicht.
- Den Werber eines Providers nennt dessen Angebot (38027); die App des Kunden
  zahlt ihm 0,5 % der Aufträge dieses Providers.
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
