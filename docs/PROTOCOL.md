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

## 3. Fee-Modell v1 (unveränderlich)

> **Korrektur-Hinweis (bleibt als Warnung stehen).**
> Dieses Dokument schrieb bisher „5 % (5.000 ppm)". Die Prozentangaben waren
> richtig, die ppm-Werte um Faktor 10 zu klein — 5 % sind **50.000 ppm**. Der
> Code implementierte die falschen ppm und rechnete damit real mit 0,5 %;
> parallel behauptete die README 1 % und ein Node-Test 10.000 ppm.
>
> Behoben: es gibt genau eine Quelle, `PROTOCOL_FEE_PERCENT = 5` in
> `protocol-fee.ts`. Alle ppm-Werte und Anteile werden daraus abgeleitet, das
> Modul prüft sich beim Import selbst, und der Node-Test rechnet gegen die
> Konstanten statt gegen eingetippte Zahlen.

**Gesamt: 5 % (50.000 ppm)** jeder Job-Zahlung, aufgeteilt an der Quelle:

```
   Anteil an der Fee            in ppm der Zahlung
   50 %  Development-Treasury    25.000 ppm (2,5 %)
   40 %  Reward-Pool             20.000 ppm (2,0 %)
   10 %  Referral-Pool            5.000 ppm (0,5 %)
```

- Die Aufteilung erfolgt als getrennte Zahlungsziele (kein Zwischen-Wallet).
- Rundungsverlust geht immer zulasten der Fee, nie zulasten des Workers.
- **Eine Quelle im Code:** `PROTOCOL_FEE_PERCENT` in `protocol-fee.ts`.
- Änderung nach Launch = Fork mit neuem Namen.

**Noch nicht implementiert:** Die Aufteilung wird berechnet und geloggt, aber
nirgends ausgezahlt. Es gibt keinen Lightning-Multi-Output, keinen SOL-Transfer
an die Treasury und keinen Pool-Verteiler. Solange das so ist, kommt bei keinem
der drei Empfänger etwas an.

### Treasury (Development-Empfänger)

Der Empfänger des Development-Anteils ist ein **SOL-Pubkey**, der vor
Launch einmalig hardcoded wird und danach nie geändert werden kann.

Die tatsächliche Empfangsadresse **rotiert wöchentlich deterministisch:**

```
weekSeed(n)   = HMAC-SHA512(treasurySecret, "freedom-treasury-week-" + n)
weekWallet(n) = Ed25519-Pubkey(weekSeed(n)[0..31])    ← SOL-kompatibel
```

Eigenschaften:
- Adressen sind mit keiner Person verknüpfbar — nicht verschleiert, sondern
  **nie dagewesen**.
- Aus einer bekannten Wochen-Adresse lässt sich weder der Master noch eine
  andere Woche ableiten (einwegige HMAC-Ableitung).
- Der Treasury-Node publiziert wöchentlich das Announcement (**kind 38050**)
  signiert mit dem festen Treasury-Nostr-Key. Jeder kann es prüfen:
  Signatur gültig + Pubkey = hardcoded Treasury-Key → Adresse dieser Woche.
- Sweep zur Haupt-Wallet (Hardware, offline): automatisch bei Schwelle
  (100 sats Äquivalent). Die Haupt-Wallet taucht im Protokoll nirgends auf.

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
| 38011 | Reward-Payout-Nachweis |
| 38013 | Reward-Claim (Worker fordert Auszahlung an) |
| 38020–38022 | Sessions (Open/Payment/Close) |
| 38027 | Provider-Capabilities (models, tools, storage, relay) |
| 38030 / 38031 | Mesh-Packet / Delivery-Receipt |
| 38040 / 38041 | Blob-Manifest / Blob-Chunk |
| 38042 | Git-Repo-Referenz |
| **38050** | Treasury-Payout-Announcement (wöchentliche Adresse) |

**Regel:** Neue Features bekommen NEUE Kinds. Bestehende Kinds ändern ihre
Semantik nie. Ein Client, der ein unbekanntes Kind sieht, ignoriert es.

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

Ein Reward-Pool, der aus Token-Inflation gespeist wird, kann breit gießen. Ein
Pool aus echten Einnahmen hat exakt so viel, wie eingenommen wurde. Daraus
folgt: **gezielt zahlen statt gleich verteilen.**

### Knappheitsbonus (`scarcity.ts`)

Der zwanzigste Knoten in Mitteleuropa bringt dem Netz fast nichts; der erste in
einer unversorgten Region entscheidet für alle dortigen Nutzer, ob das Netz
überhaupt benutzbar ist. Der Multiplikator steigt quadratisch, je weniger
Provider eine Region hat — der Sprung von 0 auf 1 wiegt schwerer als der von
4 auf 5.

Der Stoßzeiten-Aufschlag hängt an der **gemessenen Auslastung**, nicht an der
Uhrzeit: In einem weltweiten Netz ist „abends" für jede Zeitzone etwas anderes.

Drei Eigenschaften sind nicht verhandelbar:

- **Der Topf wird nie überschritten.** Bei Überzeichnung wird anteilig gekürzt,
  nicht abgeschnitten — sonst gingen zufällig die hinten Einsortierten leer aus.
- **Der Bonus knüpft an nachgewiesene Arbeit an**, nicht an Anwesenheit. Sonst
  wäre das Anmelden in einer leeren Region die günstigste Einnahmequelle im Netz.
- **`unknown` bekommt nie einen Bonus.** Sonst wäre das Weglassen der
  Regionsangabe die billigste Art, ihn zu kassieren.

### Referral (`referral.ts`) — dauerhaft

**Der Werber verdient an jedem Job seiner Geworbenen, ohne Enddatum.** Dazu
Ebene 2: auch an den Geworbenen seiner Geworbenen.

Entscheidend ist, **woher** das Geld kommt. Ein ewiger Anteil, der zusätzlich
vom Provider abgezogen wird, würde ihn dauerhaft teurer machen als einen
nicht geworbenen — das hätte irgendwann jemand gemerkt und für unfair gehalten.
Deshalb kommt das Budget aus `FEE_REFERRAL_PPM`, also aus der Fee, die ohnehin
anfällt. Für den Provider ändert sich nichts. Ist kein Werber eingetragen,
fällt der Anteil in den Reward-Pool zurück, nicht an den Provider.

Damit ist eine dauerhafte Vergütung nebenwirkungsfrei: Es gibt keine Kosten,
die mit der Zeit wachsen.

**Stufen** (3 / 10 / 25 / 50 aktive Geworbene) erhöhen den Anteil bis auf das
Doppelte — aber **innerhalb** des Budgets. Ein höherer Rang verschiebt zulasten
von Ebene 2, er vergrößert den Topf nicht. Sonst würden erfolgreiche Werber
irgendwann den Reward-Pool leerziehen. „Aktiv" heißt: hat in den letzten 30
Tagen gearbeitet — Karteileichen bringen nichts.

**Warum genau zwei Ebenen.** Ein System mit unbegrenzten Ebenen, in dem der
Verdienst hauptsächlich aus dem Anwerben stammt, ist ein Schneeballsystem und
in Österreich verboten (§ 168a StGB, UWG Anh. Z14). Die Linie, die dieses
System klar auf der richtigen Seite hält: **Es gibt keinen Cent fürs Anwerben.**
Vergütet wird ausschließlich ein Anteil an echtem Umsatz aus echter
Rechenarbeit. Wer hundert Leute wirbt, die nie einen Job liefern, verdient
exakt null — dafür gibt es einen eigenen Test. Kein Eintrittsgeld, kein
Kaufzwang, keine käufliche Position.

Auszahlungen erst ab 10 sats. Das ist Mechanik, keine Kürzung: Lightning kann
darunter nicht zahlen, und alles Aufgelaufene wird später vollständig
ausgezahlt.

**Korrigiert:** `splitProviderPayment()` rechnete mit fest verdrahteten 1 %,
während `protocol-fee.ts` 5 % vorgibt — zwei konkurrierende Wahrheiten, von
denen eine nirgends aufgerufen wurde. Jetzt aus der einen Quelle.

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


## 15. Referral-Graph (kind 38052)

Der Werber lag bisher nur in `localStorage` und war für das Netz unsichtbar —
Stufen zeigten immer „Starter", eine Auszahlung wäre nur auf Zuruf möglich
gewesen. Jetzt veröffentlicht der **Geworbene** einen signierten Claim
(kind 38052, `d`-Tag `referral`).

**Warum der Geworbene und nicht der Werber.** Könnte ein Werber die Beziehung
behaupten, würde er die Pubkeys aller erfolgreichen Provider eintragen.
Umgekehrt hat der Geworbene keinen Anreiz zu lügen: Er gewinnt nichts dabei,
und die Vergütung kommt aus der Protokollfee, nicht aus seiner Tasche.

**Die früheste Angabe zählt, nicht die neueste.** Das Event ist ersetzbar —
würde die jüngste Fassung gelten, könnte ein Provider seinen Werber
nachträglich austauschen oder dazu gedrängt werden.

**Kreise werden aufgelöst.** A wirbt B, B wirbt A wäre eine Kette, in der beide
unbegrenzt aneinander verdienen, ohne dass jemand hinzukommt. Der Graph wird in
zeitlicher Reihenfolge aufgebaut und gegen die bereits akzeptierten Kanten
geprüft: Nur die schließende Kante fällt weg. Prüfte man alle Angaben auf
einmal, würden beide Seiten verworfen — und ein Angreifer könnte eine fremde,
gültige Beziehung zerstören, indem er einfach die Gegenrichtung behauptet.

**„Aktiv" wird gemessen, nicht behauptet:** Ein Geworbener zählt nur, wenn er
in den letzten 30 Tagen einen Leistungsnachweis veröffentlicht hat.

Der ganze Graph ist aus öffentlichen, signierten Ereignissen aufgebaut und
damit von jedem unabhängig nachrechenbar. Für ein System, das Geld verteilt,
ist das die Mindestanforderung.


## 16. Reward-Pool-Verteiler (kind 38053)

40 % der Fee gehen in den Reward-Pool. `settlement.ts` zahlt sie an die
Pool-Adresse — danach lagen sie dort. Der Knappheitsbonus rechnete aus, wer wie
viel bekommen sollte, und niemand führte es aus.

Einmal je Epoche (Standard: eine Woche) wird verteilt und ein signierter
Bericht veröffentlicht, den jeder mit `verifyDistributionReport()` nachrechnen
kann.

**Ausdrückliches opt-in** (`POOL_DISTRIBUTOR=1`). Nur der Knoten, der die
Pool-Wallet hält, darf verteilen. Würde jeder Provider verteilen, gäbe es für
dieselbe Epoche mehrere widersprüchliche Berichte — und im schlimmsten Fall
mehrfache Auszahlungen aus einem Topf, der nur einmal gefüllt ist.

**Nur abgeschlossene Epochen.** Die laufende Woche wird nie verteilt, sonst
bekämen Provider, die später in der Woche arbeiten, systematisch nichts.

**Der verfügbare Betrag wird nicht geschätzt.** `POOL_BALANCE_MSAT` muss gesetzt
sein; ohne den Wert wird nicht verteilt. Ein Verteiler, der mehr zusagt als
vorhanden ist, produziert Forderungen, die niemand einlösen kann.

**Zustand überlebt Neustarts.** Ein Verteiler, der nach einem Neustart von vorn
beginnt, leert den Pool an die zuletzt Aktiven — der teuerste denkbare Fehler in
diesem Modul. Dafür gibt es einen eigenen Test mit echtem Dateiwechsel.

**Kleine Töpfe werden angespart**, statt in Routing-Gebühren aufzugehen. Was
nicht ausgezahlt werden konnte (fehlende Lightning-Adresse, fehlgeschlagene
Zahlung), bleibt im Topf und wandert in die nächste Epoche — es fällt nicht dem
Betreiber zu.

**Der Bericht erscheint auch bei gescheiterten Zahlungen.** Eine Verteilung, über
die es keine Aufzeichnung gibt, ist von einer Unterschlagung nicht zu
unterscheiden.
