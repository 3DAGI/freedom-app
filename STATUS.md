# FreedomStack — Statusbericht

Stand: 29. August 2026. Alle Zahlen in diesem Bericht sind gemessen, nicht
geschätzt: Die Testzahlen stammen aus einem vollständigen Lauf, die
Zeilenzahlen aus `wc -l`, und jede Aussage über Funktionsfähigkeit ist unten
danach getrennt, ob sie belegt oder nur plausibel ist.

---

## 1. Die wichtigste Aussage zuerst

**Das System läuft noch nicht.** Es ist gebaut, abgesichert und in sich
konsistent — aber es hat noch nie echtes Geld über echte Infrastruktur bewegt.

Wer von hier aus „es funktioniert" sagt, überspringt genau die Stelle, an der
Software dieser Art normalerweise überrascht. Grüne Tests belegen, dass der
Code das tut, was in den Tests beschrieben ist. Sie belegen nicht, dass die
Annahmen über LND, Solana und fremde Relays stimmen.

| Was | Belegt? |
|---|---|
| Protokoll-Logik, Kryptografie, Fee-Rechnung | ✅ 431 Tests |
| NIP-44-Interoperabilität | ✅ offizieller Referenzvektor |
| Erasure-Coding Browser ↔ Node | ✅ bitidentische Shards |
| Lightning-Zahlung mit echtem LND | ❌ 3 Tests übersprungen |
| HTLC auf Solana (lock/claim/refund) | ❌ 2 Tests übersprungen |
| Geändertes Anchor-Programm | ❌ nicht kompiliert, nicht deployed |
| Ein vollständiger Job mit echtem Geld | ❌ nie stattgefunden |
| LP-Daemon, Relay-Rolle, Storage-Rolle, Arweave | ❌ keine Tests |

---

## 2. Was das Projekt ist

Ein betreiberloses Protokoll für Kommunikation und KI-Compute, aufgebaut auf
einer Trennung, die das Ganze trägt: **Koordination über Nostr, Settlement über
Lightning und Solana.** Kein eigener Konsens, kein eigener Token, keine
Instanz, die abschalten kann.

Vier Pakete, zusammen ~18.000 Zeilen TypeScript:

| Paket | Rolle | Tests |
|---|---|---|
| `protocol/` | 46 Module: Nostr-Events, DVM-Jobs, Zaps, HTLC, PoW, Web-of-Trust, Fee, Konsens, Cluster, NWC, Knappheit, Referral | 252 |
| `node/` | Provider-Daemon: Inferenz, Settlement, Pool-Verteiler, SSRF-Schutz, optional LP-/Relay-/Storage-Rolle | 81 |
| `app/` | Single-File-PWA (1.520 KB), 8 Sprachen, Chat + Wallet + Agent + Verdienen | 98 |
| `contracts/solana-htlc/` | Anchor-Programm: initialize / claim / refund | 3 (nicht ausgeführt) |

Dazu: Website mit Live-Dashboard, Ein-Zeiler-Installer, GitHub-Actions-CI.

---

## 3. Ausgangslage und was daran falsch war

Die erste Analyse fand fünf rote Tests, die unbemerkt eingecheckt worden waren,
und mehrere Fehler, die keine Tests hatten.

### Sicherheit

| Problem | Wirkung |
|---|---|
| „Toleranter Modus" bei Sessions | Eine **erfundene Session-ID** reichte für unbegrenzte kostenlose Inferenz |
| DM-Verschlüsselung | secp256k1-Keys durch X25519 geschickt → beide Seiten leiteten verschiedene Secrets ab, **jede DM war unlesbar**, auch für den Empfänger |
| XSS im Wallet-Tab | `onclick="startSwap('${offerId}')"` mit Daten aus fremden Relays → Nostr-Secret-Key aus `localStorage` abziehbar |
| SSRF im Browser-Tool | Jede URL wurde abgerufen: Ollama, LND-REST, Router-Oberfläche, Cloud-Metadaten (`169.254.169.254`) |
| Datei-Sandbox | Präfix-Kollision: `/tmp/ws-evil` passierte die Basis `/tmp/ws` |
| SOL-Deposit | Nur Event-Konsistenz geprüft — der Kunde signiert das Event selbst, ein **beliebiger Betrag war behauptbar** |
| Gate-Server | Kein Rate-Limit, lieferte `.bak` und `.py` mit aus |

### Geld

| Problem | Wirkung |
|---|---|
| Fee-Konstante | `5_000 ppm` war als „5 %" bezeichnet — das sind **0,5 %**. README behauptete 1 %, ein Test 10.000 ppm. Drei Werte |
| Zweites Fee-Modell | `splitProviderPayment()` rechnete mit hartkodierten 1 % |
| Fee-Auszahlung | Wurde berechnet, geloggt — **und nie gezahlt**. Kein Multi-Output, kein Transfer, kein Verteiler |
| Treasury-Sweep | Leitete sein Keypair aus dem **öffentlichen** Schlüssel ab und konnte nie Geld bewegen. Adresse als Hex an eine base58-API |
| Bootstrap-Phase | `PROVIDER_SINCE` bei jedem Start neu gesetzt → ein täglich neu startender Provider blieb **dauerhaft** im Gratismodus |
| Swap-Client | Endete nach Anzeige der Invoice. Kein Claim, kein Refund. Preimage in `sessionStorage` — Tab zu, Geld weg |
| Referral | 0,5 % von 5 % = 0,01 sat pro Job. Unter jeder Wahrnehmungsschwelle und unter der Lightning-Mindestzahlung |

### Warum es niemand bemerkte

Die Tests wurden nicht automatisch ausgeführt. Das war die Ursache — nicht
Nachlässigkeit.

---

## 4. Was jetzt gebaut ist

### Sicherheit

- **Session-Prüfung**: Rückfall nur auf das *gemessene* Free-Tier-Kontingent.
- **`dm.ts` neu**: echtes NIP-44 v2 — ECDH über secp256k1, HKDF, ChaCha20,
  HMAC über Nonce+Ciphertext, längenverbergendes Padding. Gegen den offiziellen
  Referenzvektor geprüft, also nachweislich interoperabel.
- **`url-guard.ts`**: DNS-Auflösung, private Bereiche gesperrt, Prüfung bei
  *jeder* Weiterleitung. Eine reine Namensprüfung hätte nicht gereicht — ein
  Angreifer lässt einen öffentlichen Namen auf 127.0.0.1 zeigen.
- **`deposit-verify.ts`**: On-Chain-Prüfung. Fehlende Prüfmöglichkeit gilt als
  *ungedeckt*, nicht als in Ordnung.
- **XSS und Sandbox** behoben, Gate-Server gehärtet.

### Geld

- **`settlement.ts`**: Der Provider zahlt nach jedem Job aus seinem eigenen
  Erlös an drei getrennte Ziele. Kleinbeträge werden gesammelt (0,5 % Referral
  auf 1.200 msat sind 6 msat — Lightning kann darunter nicht zahlen).
- **`fee-proof.ts`** (kind 38051): signierter Beweis, mit
  `verifyFeeProof()` nachrechenbar. Lightning ohne Preimage gilt ehrlich als
  *angekündigt*, nicht als *belegt* — Lightning hat kein öffentliches Ledger,
  und ein Beweis, der seine Grenzen verschweigt, ist keiner.
- **Fee auf 5 %** aus einer Quelle abgeleitet, mit Selbstprüfung beim Import.
- **`sol-htlc.ts`**: Lock im Browser, beide HTLCs in *einer* atomaren
  Transaktion. Die App hält nie einen Solana-Key.
- **`swap-client.ts`**: prüft die Gegenleistung, bevor der Zahl-Link freigegeben
  wird. Erzwingt `T_sol < T_lightning`.
- **`refund-watcher.ts`**: holt fällige Sperren automatisch zurück.

### Anreize (ohne eigenen Token)

Der strukturelle Unterschied zu Systemen wie Pearl: Wer Rewards aus
Token-Inflation zahlt, kann breit gießen. Wer sie aus echten Einnahmen zahlt,
hat exakt so viel wie er einnimmt — und muss **gezielt** zahlen.

- **`scarcity.ts`**: Bonus nach unterversorgter Region und *gemessener*
  Auslastung (nicht nach Uhrzeit — in einem weltweiten Netz ist „abends" für
  jede Zeitzone etwas anderes). Quadratische Kurve: der Sprung von 0 auf 1
  Provider wiegt schwerer als der von 4 auf 5.
- **`referral.ts`**: dauerhaft, zwei Ebenen, fünf Stufen. Bezahlt **aus der
  Protokollfee**, nicht zusätzlich vom Provider — deshalb kann es ewig laufen,
  ohne dass ein geworbener Provider teurer wird als ein nicht geworbener.
- **`referral-graph.ts`** (kind 38052): Der *Geworbene* signiert die Beziehung.
  Umgekehrt würde ein Werber die Pubkeys aller erfolgreichen Provider eintragen.
  Früheste Angabe gewinnt, Kreise werden aufgelöst.
- **`pool-distributor.ts`** (kind 38053): rechnet, zahlt, veröffentlicht einen
  nachprüfbaren Bericht. Opt-in, idempotent, Topf nie überschritten.

Nicht gebaut: **Staking**. Bei fremdem Geld wäre es Verwahrung — und Verwahrung
von Nutzervermögen steht auf der Liste der Merkmale, die gegen die
Dezentralitäts-Ausnahme sprechen.

### Neue Fähigkeiten

- **`consensus.ts`**: Redundanz-Konsens für wichtige Jobs. Meldet nie
  „verifiziert" — bei gleichem Basismodell teilen Provider auch dessen Irrtümer.
  Was erkannt wird, ist *Abweichung*.
- **`cluster.ts`**: Zwei-Geräte-Paare. Speicher- und KV-Cache-Rechnung,
  Leistungsschätzung mit Modusempfehlung, Partner-Matching, Reziprozität.
- **`nwc.ts` + `nip04.ts`**: Lightning auf *jedem* Gerät über die eigenen
  Relays. WebLN gibt es nur als Desktop-Extension; auf iOS existiert es nicht.
- **`solana-connect.ts`**: injizierter Provider, Android/Seeker, Universal Link.
- **Buffer-Polyfill**: erbt von `Uint8Array` statt ein Fantasie-Objekt zu sein.
- **Dashboard**: liest direkt von den Relays, kein Backend. Provider, Jobs,
  Fee-Beweise, „wo Kapazität fehlt", Werber-Rangliste.
- **Installer**: prüft Ollama, fragt Auszahlungsadresse und Region ab, härtet
  die systemd-Unit, verifiziert am Ende über die Quota-API.
- **CI**: Tests, Typen, Build, Installer- und Gate-Server-Syntax,
  Fee-Invarianten, Geheimnis-Scan, Dashboard-Skript.

---

## 5. Zahlen

| Paket | Tests vorher | jetzt | übersprungen (live) |
|---|---|---|---|
| protocol | 74 | **252** | 5 (LND, Devnet) |
| node | 35, davon 5 rot | **81** | 7 (Ollama, ComfyUI) |
| app | 1 | **98** | 0 |
| **Summe** | **110** | **431** | 12 |

52 Testdateien. `tsc` sauber in allen drei Paketen. App-Build: 1.520 KB.

---

## 6. Zwei Studien

### WAN-Sharding

Das mitgelieferte Studienpaket kam zu 1,4 tok/s bei 24-Wege-Sharding. Zwei
Terme fehlten im Simulator: **Bandbreite** und **Prefill**.

Der Prefill-Transfer fällt *pro Hop* an. Bei 8k Kontext über 1 Gbit sind das
0,94 s — bei 16 Hops 15 s, bei 40-Mbit-Heimanschlüssen 394 s TTFT.

Dazu ein logischer Bruch: **Racing und Voting schließen sich aus.** Der
Simulator nimmt `min()` — der schnellste Worker liefert, die anderen Ergebnisse
werden nie angesehen. Der p95-Gewinn entsteht genau dadurch, dass nicht
verglichen wird. Voting bräuchte `max()`:

| Modus | TTFT p95 | tok/s |
|---|---|---|
| N=1 | 12,40 s | 4,37 |
| N=3 Racing | 7,55 s | 6,20 |
| N=3 Voting | **15,41 s** | **3,20** |

Redundanz kauft **Verfügbarkeit**, nicht Verifikation. Verifikation gehört auf
Job-Ebene — dort sitzt `consensus.ts`.

Der vorgeschlagene exakte Token-Vergleich hätte zusätzlich ehrliche Provider
bestraft: Greedy-Decoding ist auf heterogener Hardware nicht bit-exakt, und ein
einziger abweichender Token entkoppelt autoregressiv den Rest. Bei realistischen
1e-3 Flip-Wahrscheinlichkeit wären ~40 % der ehrlichen Provider bei einer
500-Token-Antwort als Abweichler markiert worden.

### Zwei-Spark-Paare

K=2 statt K=16 ist der Bereich, in dem das Verfahren funktioniert:

| Kontext | 1 Hop (1 Gbit) | 16 Hops |
|---|---|---|
| 8k | 0,94 s | 15,0 s |
| 32k | 3,8 s | 60,1 s |

In 2×128 GB passen Modelle bis ~400B (MoE, Q4) mit vollem Kontext; bei
MLA-Cache kostet 256k nur 18 GB. 670B passt auch bei Q3 nicht — dafür braucht
es ein drittes Gerät.

Wichtig: **Pipeline-Parallelismus macht bei Batch 1 kein Token schneller.** Er
kauft Kapazität, nicht Tempo. Bei zwei Knoten mit schneller Verbindung wird
Tensor-Parallelismus möglich (~1,6×).

Zur Wirtschaftlichkeit: Wer 48 h mieten will, muss ~50,5 h vermieten
(Fee-Asymmetrie: verdienen bringt 95 %, mieten kostet 100 %). Fünf Arbeitstage
à acht Stunden reichen **nicht** — das Gerät muss auch nachts vermietet sein.

---

## 7. Offen

### Blocker

1. **Devnet-Test und Deploy des HTLC-Programms.** `[u8; 32]` statt `Vec<u8>`
   und `close = initiator` existieren nur im Quelltext. Borsh kodiert ein
   festes Array **ohne** Längenpräfix — altes Programm plus neuer Client passt
   nicht zusammen. Beides muss in *einem* Schritt raus.
2. **Der erste echte Sat.** Ein Provider, ein Client, ein Job, echtes LND,
   danach den Fee-Beweis prüfen.

### Vor Mainnet

3. **Anchor-Upgrade-Authority** auf `none` setzen.
4. **AI-Act-Transparenz** (Art. 50, seit 2. August 2026 in Kraft): Hinweis im
   Chat, dass mit einem KI-System interagiert wird; C2PA-Metadaten bei
   `image_gen`/`video_gen`. Billig und erledigt eine bestehende Pflicht.
5. **Steuerliche Erfassung** der Fee-Zuflüsse ab dem ersten Sat. Die
   Fee-Beweis-Events sind bereits eine signierte, zeitgestempelte Aufzeichnung.

### Ohne Tests

6. LP-Daemon, Relay-Rolle, Storage-Rolle, Arweave-Mirror.
7. `shell/app.ts` bleibt DOM-verwoben. Der Weg ist weiter extrahieren, nicht
   ein Browser-Testframework aufsetzen.

### Bewusst nicht gebaut

8. **Mesh ohne Internet.** Strategisch das stärkste Argument — aber es ergibt
   erst Sinn, wenn die Zahlungsschicht nachweislich funktioniert. Machbar:
   Nostr-Events (signiertes JSON), Solana-Transaktionen (≤1.232 Bytes, mit
   Durable Nonces), Ecash-Token als Zeichenkette. Nicht machbar:
   KI-Inferenz über LoRa.
9. **Antwort-Polling in der App** (3 s) — funktioniert, hat komplexe
   Zwischenzustände, deren Umbau mehr riskiert als gewinnt.

---

## 8. Einschätzung

**Technisch überdurchschnittlich.** Echte Schnorr-Signaturen statt Attrappen,
Multi-Relay mit Zensur-Audit, bitidentische Erasure-Shards — Details, die
jemand baut, der es ernst meint.

**Die Kommunikationsseite ist strategisch stärker als die Compute-Seite.** Der
KI-Markt konkurriert gegen Anbieter, bei deren Preisen ein Heimbetreiber seinen
Strom nicht bezahlt; Dezentralität ist für die meisten Nutzer kein Kaufgrund.
Ein Nostr-Client mit funktionierendem NIP-44, Communities und Zahlungen auf
jedem Gerät hat dagegen eine Nutzerschaft, die heute sucht.

**Die überzeugendste Geschichte ist die, die noch nicht gebaut ist:**
Kommunikation und Zahlungen, die weiterlaufen, wenn Netz und Strom ausfallen.
Das versteht ein Katastrophenschützer, ein Segler und ein Journalist in einem
autoritären Land sofort. „Dezentrale KI-Inferenz" versteht ein Publikum, das
ohnehin überzeugt ist.

**Was ich am meisten schätze:** Der öffentliche Feed wurde gestrichen, weil ein
unmoderierter globaler Stream zwangsläufig Inhalte transportiert, für die es
keine Handhabe gibt. Eine Entscheidung gegen das eigene Ideal und für
Verantwortung. Solche Entscheidungen bestimmen, ob ein Projekt in fünf Jahren
noch existiert.

**Was offen bleibt:** Ein Netz für unzensierbare KI-Compute wird für Dinge
genutzt werden, die euch nicht gefallen. Das ist keine Frage der Technik,
sondern eine, die vor dem Launch beantwortet sein sollte — nicht danach.


---

## 9. Die Fee eleganter lösen

### Das Problem in einem Satz

Eine Protokollfee mit festem Empfänger macht euch zum identifizierbaren
Betreiber — und ein Protokoll mit Betreiber ist genau das, was ihr nicht bauen
wolltet. Es ist zugleich die Stelle mit der größten regulatorischen Angriffsfläche.

### Was andere tun

Nous Research erzielt Einnahmen über cloud-gehostete Stufen zu 20 bis 200
Dollar pro Monat — nicht über das offene Modell selbst. Das Muster ist
verbreitet: Die stärksten Modelle 2026 sind Managed Hosting, Open Core mit
klarer Bezahlgrenze, Premium-Support und sektorspezifische Pakete. Bezahlt wird
für **Bequemlichkeit, Verantwortung und Betrieb**, nicht für Code.

### Umgesetzt: Fee von der Protokoll- in die Client-Schicht verschoben

Das Protokoll bekommt **keinen** privilegierten Empfänger. Die Fee wandert in
den Client — eure App nimmt sie, sichtbar und abschaltbar durch Nutzung eines
anderen Clients.

Dieselbe Einnahme, aber vier Dinge ändern sich grundlegend:

1. **Das Protokoll wird wirklich neutral und forkbar.** Genau das macht
   „unabschaltbar" wahr statt behauptet. Wenn eure Fee nicht entfernt werden
   *kann*, seid ihr der Betreiber.
2. **Regulatorisch sauber.** Ihr seid kein Intermediär im Protokoll, sondern
   ein österreichisches Softwareunternehmen, das für eine Leistung — die App —
   ein Entgelt nimmt. Normale Firma, normale Pflichten.
3. **Ehrlich gegenüber Nutzern.** Eine sichtbare Client-Gebühr, die man
   umgehen kann, ist etwas anderes als eine unvermeidbare Protokollsteuer.
4. **Der Reward-Pool bleibt im Protokoll** und wird nicht mehr von eurem Anteil
   verwässert — das stärkt die Anreize für alle anderen.

Der Einwand liegt auf der Hand: Ein Fork kann die Fee entfernen. Das ist der
Punkt. Wer forkt, muss die App selbst bauen, hosten, warten und supporten. In
der Praxis tut das fast niemand — und dass es *möglich* ist, ist genau die
Eigenschaft, die euer Versprechen glaubwürdig macht.

### Zusätzlich, für die Glaubwürdigkeit

Verdient **wie alle anderen**: als Provider, als Relay, als LP für Swaps. Kein
privilegierter Zugang, nur bessere Ausführung. Das ist die einzige
Einnahmequelle, die keinerlei Angriffsfläche bietet — und die überzeugendste
Antwort auf „wer verdient hier eigentlich?".

### Was das konkret hieße

| Schicht | Vorher | Jetzt |
|---|---|---|
| Protokollfee | 5 %, fester Empfänger | **2,5 %**, nur Pool (2,0 %) + Referral (0,5 %) |
| Client-Gebühr | – | **2,5 %**, `client_fee`-Tag, abschaltbar, max. 10 % |
| Hosting/Support | – | offen — monatliche Stufen, vorkonfigurierte Hardware |
| Eigene Nodes | – | offen — verdient wie jeder andere Provider |

Gesamt für den Nutzer unverändert 5 %. Provider und Werber bekommen absolut
dieselben Beträge wie vorher. Eine CI-Invariante prüft ab jetzt, dass im
Protokoll nie wieder ein fester Dev-Anteil auftaucht — und dass die
Client-Gebühr Pool und Referral nicht schmälern kann.

---

## 10. Viralität ohne Spekulations-Schwungrad

Reward-Pools, die mit Volumen wachsen, sind richtig — aber sie sind ein
**Verteilungs**-, kein **Wachstums**-Mechanismus. Der Topf ist nur groß, wenn
ihr bereits erfolgreich seid. Er startet nichts.

Fünf Ergänzungen, die tatsächlich anschieben:

**1. Befristete Anschub-Finanzierung aus dem eigenen Anteil.** Die einzige
Form von „Emission", die ohne Token möglich ist. Zwölf Monate, danach Ende, und
das offen kommuniziert.

**2. Nachfrage subventionieren, nicht Angebot.** Gegen die Intuition, aber in
einem zweiseitigen Markt richtig: Nutzer ziehen Provider an, Provider ohne
Nutzer wandern ab. Der Free-Tier ist wertvoller als jeder Provider-Bonus.

**3. Gesponserte Pools — der stärkste Hebel.** Jeder kann einen Reward-Pool
für eine Region, ein Modell oder eine Fähigkeit finanzieren. Ein Unternehmen,
das Abdeckung in Südostasien braucht, zahlt dafür. Ein Modellhersteller
finanziert einen Pool für Provider, die sein Modell fahren. Das bringt
**externes Geld ins Netz, ohne Token** — und es ist ein Mechanismus, den es so
nirgends gibt.

**4. Knappheit ist der Werbetext.** „Region Afrika: 0 Provider, Vergütung
×3,00" ist ein konkretes, nachprüfbares Angebot. Das steht bereits im
Dashboard und ist überzeugender als jeder Slogan.

**5. Signierte Beitragsnachweise.** „Erster Knoten in Region X",
„1.000. Provider" — portabel, öffentlich prüfbar, kostenlos. Status wirkt in
Infrastruktur-Communities erfahrungsgemäß stärker als kleine Geldbeträge.

**Und der eigentliche Grund zum Wechseln:** Wenn eure Provider Hardware haben,
deren Anschaffung bereits bezahlt ist, könnt ihr bei gleichem Modell billiger
sein als OpenRouter. Das ist ein rationaler Grund ohne jede Ideologie — und
rationale Gründe skalieren besser als Überzeugungen.

---

## 11. Zielbild: Discord + Replit + GitHub + OpenRouter + Wallet

Die Vision ist eine App, die fünf Dinge dezentral ersetzt. Ehrlicher Stand je
Baustein:

| Baustein | Vorbild | Stand |
|---|---|---|
| Communities | Discord | Grundlage da (kind 42, Kanäle, Medien) — **fehlt: Rollen, Rechte, Threads, Sprache, Moderation, Präsenz** |
| Code-Zusammenarbeit | GitHub | `git.ts` vorhanden, ungetestet, keine Oberfläche |
| Ausführung | Replit | **nicht vorhanden** — bräuchte Sandbox-Ausführung bei Providern |
| Modell-Zugang | OpenRouter | vorhanden und funktionsfähig |
| Wallet & Swap | – | vorhanden, Zahlung noch nie live |

Realistisch ist das keine Roadmap für Monate, sondern für Jahre. Die
Reihenfolge, die ich empfehle: **Communities zuerst** (größter Nutzen je
Aufwand, bestehende Nutzerschaft), Code und Ausführung zuletzt — beides ist
ohne Sandbox-Sicherheit gefährlich, und Sandbox-Sicherheit ist ein eigenes
Projekt.


## 12. Mesh und Abdeckungskarte

### Transport (`mesh-transport.ts`)

`mesh.ts` beschrieb, **was** transportiert wird — nicht **wie**. Über eine
Funkstrecke passt kein Nostr-Event: LoRa trägt 200 bis 250 Byte, ein signiertes
Event hat 500 bis 2000. Ohne Zerlegung war der ganze Mesh-Zweig eine
Absichtserklärung.

Gebaut: kompakte Binärrahmen (12 Byte Kopf statt JSON), Zerlegung und
Wiederzusammenbau mit Inhaltsprüfung, Store-and-Forward mit Sprungbegrenzung
und Dublettenerkennung, Vorrang-Warteschlange. 27 Tests.

Zwei Dinge, die ohne Test unbemerkt geblieben wären:

**Ohne Dublettenerkennung wird aus jeder Nachricht eine Lawine.** Jeder Knoten
sendet an alle, die wieder an alle — bei Funk mit gemeinsamem Kanal legt das
das Netz in Sekunden still.

**Fragments zweier Nachrichten dürfen nicht zusammenlaufen.** Sonst käme etwas
heraus, das niemand geschrieben hat, mit kaputter Signatur und ohne
erkennbaren Grund. Die Kennung ist deshalb der Hash des Inhalts und wird nach
dem Zusammenbau geprüft.

**Was über Funk geht:** Nostr-Events, Solana-Transaktionen (≤1.232 Byte, mit
Durable Nonce), Ecash-Token. **Was nicht:** Lightning (braucht mehrere Runden)
und KI-Inferenz (eine 500-Token-Antwort dauert Stunden). Das gehört nicht
versprochen.

### Abdeckungskarte (`coverage.ts`)

Die Karte ist wertvoll — sie beantwortet „funktioniert das bei mir?" und ist
für die Ausfall-Geschichte das entscheidende Bild. Aber sie hat eine
Schattenseite, die „teilanonym" nicht löst:

**Eine Karte von Funkknoten ist eine Karte von Menschen, die Funktechnik
besitzen und zensurresistente Infrastruktur betreiben.** Genau in den Regimen,
in denen das Projekt am meisten Sinn ergibt, ist sie eine Zielliste. Ein Punkt
mit genug Genauigkeit ist ein Haushalt.

Deshalb zwei verschiedene Modelle statt einem:

| | Online-Provider | Funkknoten |
|---|---|---|
| Zellgröße | ~200 km | ~55 km |
| Sichtbar ab | 1 Knoten | **3 Knoten** |
| Begründung | IP ohnehin sichtbar | physischer Standort, teils strafbar |

Dazu: Anzahl nur in Stufen („wenige/mehrere/viele"), kein Verlauf,
ausdrückliches Opt-in, zu genaue Meldungen werden **verworfen** statt gerundet
übernommen — sonst könnte ein manipulierter Client heimlich genauer melden.

Und die unbequeme Ehrlichkeit, die auch im Zustimmungstext steht: Eine Karte,
die zeigt, wo Funk funktioniert, zeigt auch, wo er *nicht* funktioniert. Für
jemanden, der eine Abschaltung plant, ist das nützlich. Der Nutzen überwiegt
meiner Einschätzung nach — aber es ist ein Tausch, kein Gewinn.

### Geräte-Anbindung (`mesh-radio.ts`)

Drei Wege, bewusst in dieser Reihenfolge: serielle Verbindung (USB, am
zuverlässigsten), Bluetooth (bequemer, auf iOS im Browser nicht verfügbar),
und Datei beziehungsweise QR.

Der Datei-Weg ist **nicht der Notnagel**, sondern die Ebene, die das
Versprechen einlösbar macht: „funktioniert ohne Internet" darf nicht bedeuten
„funktioniert, wenn du die richtige Hardware gekauft hast". Für die Schicht
darüber sind beide Wege identisch — ein eigener Test prüft genau das.

Die Rahmen sind absichtlich rohe Bytes ohne Annahmen über das Medium. Ein
Meshtastic-Gerät, ein selbstgebauter Knoten oder ein USB-Stick transportieren
dieselben Bytes. Alles andere hätte das Projekt an eine Hardware gebunden —
und damit an deren Hersteller.

**Weiterreichen ist nicht optional.** Ein Netz, in dem jeder nur sendet und
empfängt, aber nichts durchreicht, hat die Reichweite eines einzelnen Geräts.

Im Mesh-Tab: Verbindungsart, Warteschlange mit Restdauer, Datei-Aus- und
Eingabe, Abdeckungsliste und der Zustimmungsdialog vor dem Eintragen.


## 13. Onboarding

### Die Reihenfolge ist die Entscheidung

Ein Kunde brauchte eine Lightning-Wallet, ein Provider eine
Ollama-Installation — beides Hürden, an denen Menschen abbrechen, bevor sie
wissen, ob sich das lohnt. Und der Free-Tier, der genau dafür gedacht war, war
eingebaut und **unsichtbar**.

`onboarding.ts` zeigt immer genau **einen** nächsten Schritt. Eine Liste von
acht offenen Punkten schreckt ab, obwohl man sieben davon nie braucht.

| Zustand | Nächster Schritt |
|---|---|
| noch nichts gemacht | „Stell einfach eine Frage" — **nicht** Wallet, **nicht** Sicherung |
| erste Nutzung erfolgt | Merkphrase sichern (als Warnung) |
| gesichert, Gratis übrig | Wallet erwähnen, nicht drängen |
| Gratis leer | Wallet verbinden (nicht überspringbar) |
| Absicht „verdienen" | Provider-Anleitung mit kopierbarem Befehl |

Zwei Regeln, die dahinterstehen: **Erst benutzen, dann einrichten** — wer
zuerst nach einer Wallet fragt, verliert die Leute, die noch nicht überzeugt
sind. Und **Sichern erst nach der ersten Nutzung** — vorher hat der Nutzer
nichts zu verlieren, und die Warnung wäre Lärm.

Ein Test prüft, dass es für jede der 16 Zustandskombinationen mal vier
Absichten immer genau einen sinnvollen Schritt gibt. Ein anderer prüft, dass
die Werbetexte keine Begriffe wie „unzensierbar" oder „für immer" enthalten —
sie machen Behörden aufmerksam und ziehen Nutzer an, die man nicht will.

### Container-Paket

`docker-compose.yml` bringt Ollama mit. Ein Befehl, keine Systemänderung,
`docker compose down` entfernt alles rückstandsfrei.

- **Ollama ist nicht nach außen offen.** Ein offener Inferenz-Endpunkt im
  Internet ist eine Einladung.
- **Das Modell wird vorab geladen.** Sonst wartet der erste Kunde minutenlang
  auf einen Download, den er für Rechenzeit hält.
- **Zustand liegt in einem Volume.** Ohne das erzeugt jeder Neustart einen
  neuen Schlüssel — Reputation weg, Gratisphase zurück auf Anfang.
- **Ohne `NODE_LUD16` startet nichts.** Ein Provider, dessen Einnahmen
  nirgendwo ankommen, ist schlimmer als einer, der gar nicht startet.
- Playwright wird nicht installiert (~300 MB). Wer Browser-Automatisierung
  braucht, baut ein eigenes Image.

Die CI prüft das compose-File mit — ein kaputtes fällt sonst erst dem ersten
Provider auf, also genau dem, den es abholen sollte.


## 14. Fee-Beweis in der Oberfläche

Unter jeder bezahlten Antwort steht jetzt „diese Zahlung prüfen". Der Beweis
war gebaut und unsichtbar — dabei ist er das einzige Merkmal, das ein zentraler
Anbieter prinzipiell nicht bieten kann.

Die Anzeige unterscheidet **belegt** von **angekündigt**. Lightning hat kein
öffentliches Ledger; ohne Preimage ist eine Zahlung rechnerisch korrekt, aber
nicht beweisbar. Ein Knopf, der „alles in Ordnung" sagt, obwohl er es nicht
wissen kann, wäre schlechter als gar keiner — und beim ersten kritischen
Nachfragen ein Bumerang.

Fehlt der Beleg ganz, steht das ebenfalls da: Provider veröffentlichen ihn nach
der Abrechnung, und wenn er dauerhaft fehlt, hat der Provider die Fee nicht
abgeführt.

## 15. Community-Moderation

Der öffentliche Feed wurde gestrichen, weil ein unmoderierter globaler Stream
zwangsläufig Inhalte transportiert, für die es keine Handhabe gibt. Communities
haben dasselbe Problem eine Ebene tiefer — es verschwindet nicht dadurch, dass
die Gruppe kleiner ist.

**Was Moderation hier ist:** ein Filter beim Empfänger. Der Gründer benennt
Moderatoren (kind 34550), diese veröffentlichen signierte Ausblend- und
Sperrlisten (34551/34552), Clients wenden sie an — für **diese** Community und
für keine andere.

**Was sie nicht ist:** Löschen. Niemand kann ein Event von den Relays
entfernen; wer behauptet, er könne es, lügt. Das steht in der Auskunft, die
jeder Client anzeigen kann, nicht im Kleingedruckten.

Vier Eigenschaften, die das vertretbar machen:

- **Abschaltbar.** Jeder Nutzer kann die Moderation seiner Community
  ausschalten und sieht dann alles. Das ist der Unterschied zwischen einer
  Hausordnung und einer Zensur: Die eine gilt, weil man dazugehören will.
- **Nur benannte Moderatoren.** Ohne diese Prüfung wäre „Moderation" ein
  Werkzeug für genau die Leute, gegen die sie helfen soll.
- **Platzhalter statt spurlosem Entfernen.** Eine Lücke, die man sieht, ist
  Moderation. Eine, die man nicht sieht, ist Manipulation. Mit einem Knopf
  „trotzdem zeigen".
- **Keine netzweite Sperrliste.** Eine Liste, die für alle Communities gilt,
  wäre genau die zentrale Instanz, die das Projekt nicht haben will — und der
  erste Ort, an dem jemand Druck ausüben würde.

Ein Detail mit Begründung: Bei Moderatorenlisten gewinnt die **neueste**
Fassung, anders als beim Referral-Graph, wo die früheste zählt. Dort geht es um
eine Zuordnung, die nicht nachträglich änderbar sein darf; hier um eine
Vollmacht, die der Gründer entziehen können muss.


## 16. Namen, Nachfolge, Modelle, Beiträge

### Namensschicht (`naming.ts`)

Ohne Namen ist das System bei mehr als fünfzig Nutzern unbedienbar — und das
ist kein Komfortthema: Wenn man niemanden wiedererkennt, gibt es kein soziales
Netz, sondern eine Sammlung von Schlüsseln.

Es gibt bewusst **keinen globalen Namensraum**. Ein Name kann sicher,
dezentral oder menschenlesbar sein; alle drei zugleich braucht eine Instanz,
die vergibt — und die ist der wirksamste Zensurpunkt im Internet. NIP-05 hängt
an Domains und erbt das Problem vollständig.

Drei Ebenen, und die Reihenfolge ist die Botschaft:

1. **Eigene Namen.** Du vergibst sie, niemand kann sie dir nehmen.
2. **Namen aus dem Bekanntenkreis.** Nur von Leuten, denen du vertraust —
   sonst könnte jeder eine Namenslawine erzeugen und jemanden umbenennen.
3. **Selbstbezeichnung.** Eine Behauptung, mehr nicht.

Die Anzeige trägt die Herkunft mit: „Max (so nennen ihn 4 deiner Kontakte)"
statt bloß „Max". Der teuerste Fehler in solchen Systemen ist nicht der
gestohlene Schlüssel, sondern die Zahlung an den falschen Max — deshalb warnt
`checkImpersonation()` vor ähnlichen Namen, inklusive der Ziffern-Tricks
(`A1ice` für `Alice`).

Gemischte Schriftsysteme werden **markiert, nicht abgelehnt**: Ablehnen würde
Menschen ausschließen, die ihre eigene Sprache benutzen.

### Nachfolge (`succession.ts`)

Heute gilt: Schlüssel weg, alles weg. Für eure Zielgruppe ist das keine
theoretische Frage — ein Journalist wird verhaftet, ein Provider stirbt,
jemand verliert auf der Flucht sein Gerät.

Shamir-Aufteilung über GF(256): k von n Vertrauten setzen den Schlüssel
zusammen. Unter der Schwelle ist über das Geheimnis **mathematisch nichts**
bekannt, nicht bloß „schwer zu berechnen".

Drei Schutzstufen, die zusammen wirken:

- **Inaktivitätsfrist** — der Auslöser greift erst nach Monaten ohne
  Lebenszeichen.
- **Schwelle** — ein Einzelner reicht nie; Schwelle 1 wird abgelehnt.
- **Wartezeit** — nach Erreichen der Schwelle vergehen weitere Wochen, und
  **ein einziges Lebenszeichen bricht alles ab**. Das ist der eigentliche
  Schutz gegen Absprache.

Die Grenze steht im Hinweistext, nicht im Kleingedruckten: Sprechen sich genug
Vertraute ab, können sie übernehmen. Dagegen hilft keine Technik, nur die
Auswahl — „wähle Menschen, die sich nicht kennen; eine Familie zählt als
einer."

**Ein Fehler, den der Test gefunden hat:** Meine erste Fassung nutzte Generator
3 mit dem Polynom 0x11d. Diese Kombination erreicht nur 51 der 255 Feldwerte,
wodurch verschiedene Anteile zusammenfielen — das Geheimnis wäre aus weniger
Teilen rekonstruierbar gewesen als vorgesehen. Behoben, und das Modul prüft die
Tabelle jetzt beim Laden selbst.

### Modell-Katalog (`model-registry.ts`)

Gewichte über das eigene Blob-Netz statt über HuggingFace — dieselbe
Abhängigkeit wie bei Relays und RPC, nur unbemerkt. Signierte Manifeste mit
Prüfsummen je Datei, Teilbestände erlaubt.

Der wichtige Fall: **zwanzig Seeder, denen allen dieselbe Datei fehlt.** Eine
reine Seeder-Zählung meldet „bestens", das Modell ist trotzdem nicht ladbar.

Modell-agnostisch, ohne Kuratierung: Der Katalog sagt, ob die Bytes die
angekündigten sind — nicht, ob ein Modell gut, sicher oder legal ist.

### Beitragsvergütung (`contributor-funding.ts`)

**Rückwirkende Runden statt Bezahlung je Beitrag.** Sobald Geld an einer
zählbaren Größe hängt, wird diese Größe optimiert: viele kleine Commits statt
weniger guter. Wer nach Zeilen bezahlt, bekommt Zeilen — und bezahlte Beiträge
verdrängen freiwillige.

Niemand weiß vorher, was seine Änderung wert sein wird, also gibt es nichts zu
optimieren. Der Vorschlag gewichtet **aktive Tage** und sagt ausdrücklich von
sich, dass er keine Bewertung ersetzt. Dazu Kopfgelder für vorher beschriebene
Aufgaben — der Fall, in dem eine feste Zusage richtig ist.

Jede Runde ist öffentlich nachrechenbar: Selbstzuteilung, Doppelzuteilung und
Überziehung des Topfes fallen auf.


## 17. Die verbliebenen Lücken geschlossen

### Oberflächen

Nachfolge, Modell-Katalog und Mitwirkenden-Ansicht sind im Verdienen-Tab. Die
Namensauflösung läuft im Chat: Rechtsklick auf eine Unterhaltung vergibt einen
eigenen Namen, die Liste zeigt die Herkunft mit und markiert Verwechslungen.

Beim Einrichten der Nachfolge werden die Shamir-Teile **lokal erzeugt und als
Datei ausgegeben** — sie über das Netz zu verteilen wäre bequemer und würde den
ganzen Zweck aufheben: Wer die Übertragung mitliest, hat sie alle.

### Tests für die vier ungetesteten Rollen

**Relay-Rolle** (9 Tests) gegen echte WebSockets auf echten Ports. Ein Relay,
das nur im Testdouble funktioniert, trägt nichts bei. Geprüft: manipulierte
Signaturen werden abgelehnt, zu große Events auch, Müll bringt es nicht zum
Absturz, und getrennte Verbindungen räumen ihre Abos auf — sonst wächst die
Liste, bis der Knoten steht.

**Storage-Rolle** (9 Tests) gegen echte Dateien. Der interessante Befund: Die
Quote **verdrängt**, sie lehnt nicht ab — und das ist richtig, ein Seeder soll
neue Daten annehmen können. Mein erster Test erwartete eine Ablehnung; die
Erwartung war falsch, nicht der Code.

**LP-Daemon** (11 Tests). Schwerpunkt auf den Fällen, in denen er *nicht*
handeln darf: fremdes Angebot, Betrag außerhalb, Liquiditätsdeckel, und vor
allem unsichere Timelock-Ordnung. In jedem dieser Fälle wird geprüft, dass
**nichts gesperrt** wurde — ein LP, der erst sperrt und dann merkt, dass die
Ordnung unsicher ist, hat sein Geld schon riskiert.

**Arweave-Spiegel** (5 Tests). Ohne Netz ist der Upload nicht prüfbar, wohl
aber der Fehlerfall, der im Betrieb unbemerkt bliebe: Ein Spiegel, der ohne
Zugangsdaten einfach nichts tut, sieht im Log aus wie Erfolg.


## 18. Dauerbetrieb und Aufgaben

### Entleeren statt Abschalten (`lifecycle.ts`)

Nicht die Ausfallzeit tut weh, sondern der Neustart **mitten im Job**. Zwei
Sekunden Ausfall merkt niemand — ein abgeschnittener Job kostet den Kunden
Geld oder Wartezeit, und einmal reicht, damit er beim nächsten Mal woanders
hingeht.

Ablauf: keine neuen Jobs mehr annehmen und das dem Netz melden, laufende zu
Ende bringen, dann beenden. Mit Obergrenze — ein Update, das an einem
hängenden Job nie durchkommt, ist schlimmer als eines mit Ausfall.

Auf Provider-Hardware funktioniert das gut, **weil Ollama getrennt läuft**:
Der teure Teil ist das Modell im Grafikspeicher (Minuten), nicht der
Knotenprozess (Sekunden).

Beim Update: Prüfsumme gegen das signierte Manifest **vor** der Installation,
Sicherung davor, Rückrollen bei Fehlschlag, und wenn auch der Rückweg
scheitert, steht der Pfad der Sicherung in der Meldung.

**24 Stunden Mindestalter** für ein Release. Wer sofort aktualisiert, ist der
Erste, den ein fehlerhaftes Release trifft — und bei einem gestohlenen
Signierschlüssel der Erste, den es erwischt.

### Aufgaben (`quests.ts`)

Nur **im Protokoll nachweisbare** Aufgaben tragen Geld. Alles, was einen
externen Prüfer bräuchte — „folge uns auf X" —, ist ein Abzeichen ohne
Auszahlung. Die Trennlinie steht sichtbar im Code, damit niemand später
versehentlich einen Betrag daran hängt.

Der Grund ist nicht Prinzipienreiterei: Ein externer Prüfer wäre eine zentrale
Stelle, eine Abhängigkeit von der API eines Anbieters, gegen den das Projekt
antritt, und ein Farming-Loch — Wegwerf-Konten kosten fast nichts, die
Auszahlung echte Sats.

**Selbstgeschäfte zählen nicht.** „1.000 sats ausgeben" ließe sich sonst
trivial melken: an den eigenen Provider zahlen und die Prämie kassieren.

| Aufgabe | Belohnung |
|---|---|
| Zugang gesichert | Abzeichen |
| Erster bezahlter Job | 500 sats |
| 1.000 sats umgesetzt | 1.000 sats |
| Eine Woche Provider | 3.000 sats |
| Modell gesichert | 4.000 sats (wiederholbar) |
| Relay betrieben | 5.000 sats |
| Drei aktive Geworbene | 5.000 sats |
| **Ein Monat Provider** | **15.000 sats** |

Höchstens **29.500 sats** je Teilnehmer aus den einmaligen Aufgaben — und
dafür muss jemand einen Monat lang liefern.

**Speisung: prozentual, mit Boden und Deckel.** 40 % des Reward-Pools fließen
in Aufgaben, der Topf wächst also mit dem Umsatz. Dazu ein Anschub-Boden aus
dem Entwickler-Anteil, weil ein Prozentsatz von fast nichts fast nichts ist —
genau dann, wenn Anreize am wichtigsten sind. Und ein harter Deckel je Epoche
als einzige Sicherung gegen Farmen.

Die unbequeme Rechnung steht als Funktion zur Verfügung und gehört gekannt:

| Monatsumsatz | Teilnehmer aus dem Umsatz gedeckt |
|---|---|
| 1 Mio sats | 0 |
| 10 Mio sats | 2 |
| 100 Mio sats | 27 |

Alles darunter zahlt die Anschubfinanzierung — also ihr. Der Boden von 2 Mio
sats je Epoche deckt rund 67 Teilnehmer; das ist eine Investition, kein
Ertrag des Netzes, und sollte befristet sein.


## 19. Räume: Kanäle, Rollen, Threads (`spaces.ts`)

Die Community-Schicht, die als Einstieg dienen soll. 23 Tests.

**Rechte sind Regeln, die jeder Client auswertet** — aus signierten
Ereignissen, nicht aus einer Serverentscheidung. Daraus folgt eine Grenze, die
ausgesprochen gehört: **Ein Leserecht ist keine Verschlüsselung.** Was
durchgesetzt wird, ist die Ordnung unter denen, die mitspielen wollen.
Schreibrechte dagegen wirken: Eine Nachricht von jemandem ohne Recht
erscheint in keinem regeltreuen Client — sie steht zwar auf dem Relay, aber
nirgends im Kanal.

**Die Rangprüfung ist der Kern.** Eine Rollenzuweisung zählt nur, wenn der
Zuweisende `rollen_vergeben` hat **und** einen höheren Rang als die vergebene
Rolle. Ohne sie macht sich ein Moderator selbst zum Besitzer — der häufigste
Fehler in Rechtesystemen, und er hat einen eigenen Test.

Zuweisungen wirken in zeitlicher Reihenfolge, damit ein frisch Berechtigter
weitergeben kann — aber erst danach.

**Ungelesenes und Lesestand bleiben lokal.** Sie zu veröffentlichen würde
verraten, wann jemand online war und was er liest. Erwähnungen stehen oben:
Sie sind der Grund, warum jemand die App öffnet.

**Vertraulichkeit wird nicht beschönigt.** Bei einem offenen Kanal steht da,
dass jeder mitlesen kann und die Rechte nur das Schreiben regeln. Bei einem
verschlüsselten steht die unbequeme Grenze dabei: Wer den Raum verlässt,
behält den Schlüssel für alles, was er vorher gesehen hat — erst ein
Schlüsselwechsel sperrt ihn aus, und der erreicht nur, wer danach online kommt.

**Nicht gebaut: Sprachkanäle.** Sie brauchen einen SFU, und ein SFU ist ein
Server — genau die Zentralisierung, gegen die das Projekt gebaut ist.

**Offen zu entscheiden: Push-Nachrichten.** Auf iOS geht das nur über Apples
Server. Ein Chat, bei dem Nachrichten erst beim Öffnen ankommen, verliert
Nutzer schneller als jedes fehlende Feature. Entweder ein Dienst, der nur
„da ist was" sendet — ohne Inhalt, ohne Absender —, oder die ehrliche Ansage,
dass es keine gibt.


## 20. Räume-Oberfläche und Aufräumen

### Die Räume-Ansicht

Vier Spalten wie gewohnt: Räume, Kanäle, Verlauf, Mitglieder. Auf schmalen
Geräten fallen die äußeren weg — ein Vierspalter auf 390 px wäre unbedienbar,
und die Mitgliederliste ist die am wenigsten gebrauchte.

Zwei Entscheidungen, die den Unterschied machen:

**Ungelesenes ist ein Punkt, Erwähnungen sind eine Zahl.** Eine Zahl neben
jedem Kanal ist Lärm; eine Erwähnung ist der Grund, warum jemand die App
öffnet. Der Lesestand bleibt lokal — ihn zu veröffentlichen würde verraten,
wann jemand online war und was er liest.

**Wer nicht schreiben darf, bekommt den Grund statt eines toten Feldes.**
Ein Eingabefeld, das nichts tut, ist die schlechteste Form von Rechteanzeige.

Die Vertraulichkeit steht neben dem Kanalnamen: „offen — jeder kann mitlesen"
ist nicht schön, aber wahr, und es ist die Stelle, an der ein Missverständnis
am teuersten wäre.

### Der Verdienen-Tab

13 Karten auf einer Ebene — das war über Runden hinweg entstanden, weil jede
neue Funktion dort landete. Der Aufbau bildete ab, wie das System gebaut
wurde, nicht wonach jemand sucht.

| Tab | vorher | jetzt |
|---|---|---|
| Verdienen → **Ich** | 13 | 3 sichtbar, 4 eingeklappt |
| Mesh → **Netz** | 3 | 5 sichtbar, 3 eingeklappt |
| Wallet | 4 | 5 |

Netzinfrastruktur (Modelle, Endpunkte) ist zu **Netz** gewandert, die
Gebührenerklärung zu **Wallet** — sie gehört zum Geld, nicht zum Verdienen.
Projektbezogenes (Mitwirkende, Rangliste, Code) liegt eingeklappt: erreichbar,
aber nicht gleichberechtigt neben dem, was den Betrieb betrifft.

**Nichts ist weggefallen.** Jede Karte bleibt erreichbar — sie steht nur dort,
wo jemand sie sucht.


## 21. Profil, Abzeichen, Aussehen

### Drei Stellen, an denen ein Profil gefährlich ist

**Das Bild.** Eine fremde URL, die der Client lädt, verrät die IP-Adresse des
Betrachters an den, der sie gesetzt hat. Für ein Projekt, dessen Nutzer teils
in Ländern sitzen, wo das zählt, ist das kein Schönheitsfehler.
`freedom-blob:` ist deshalb der bevorzugte Fall; eine fremde https-Adresse
wird zugelassen, aber ausdrücklich als das gekennzeichnet, was sie ist.
`javascript:`, `data:text/html` und Steuerzeichen-Tricks fallen weg.

**Die Beschreibung.** Freitext, den jeder Client anzeigt — unsichtbare Zeichen
raus, Länge begrenzt.

**Das Aussehen.** Ließe man freies CSS oder freie Farbwerte zu, bestimmte ein
fremdes Profil, was im Browser des Betrachters gerendert wird. Es gibt deshalb
nur eine feste Auswahl: sechs Farben, drei Anordnungen, vier Muster. Was nicht
in der Liste steht, fällt auf die Voreinstellung zurück statt durchgereicht zu
werden.

### Offenlegung beim Tippen

`profileDisclosure()` schreibt live mit, was ein Profil preisgibt — während
der Nutzer tippt, nicht nachdem er gespeichert hat. Der Punkt, an den am
wenigsten gedacht wird, steht ausdrücklich dabei: Eine Solana-Adresse im
Profil veröffentlicht die gesamte Historie dieser Adresse.

Ein leeres Profil wird nicht als Versäumnis dargestellt, sondern als
gültige Wahl.

### Abzeichen mit Herkunft

Drei Sorten, getrennt angezeigt:

- **verdient** — aus Protokoll-Ereignissen abgeleitet, jeder kann nachrechnen.
  Die einzige Sorte, die ohne Vertrauen gilt.
- **verliehen** — wert genau so viel wie der Ruf des Ausstellers.
- **selbst** — wird gezeigt, aber als solche beschriftet: „sagt nichts über
  irgendetwas aus." Verstecken wäre bevormundend, gleich aussehen lassen
  irreführend.

Nur der Aussteller selbst kann sein Abzeichen verleihen. Der Test dazu
modelliert den echten Angriff: eine **gültig signierte** Verleihung, deren
Verweis auf eine fremde Definition zeigt. Meine erste Fassung des Tests baute
ein Ereignis mit kaputter Signatur — das hätte schon der Pool abgefangen und
die Prüfung im Modul nie belegt.


## 22. Website vervollständigt

Vier Seiten, alle mit den bestehenden Farb- und Schrifttokens statt eines
zweiten Stils:

| Seite | Inhalt |
|---|---|
| `dashboard.html` | Live-Stand, liest direkt von den Relays — kein Backend |
| `whitepaper.html` | Aufbau, alle Protokollteile, Gebühren, Invarianten, Grenzen |
| `roadmap.html` | Sechs Phasen mit Meilensteinen, was belegt ist und was nicht |
| `faq.html` | 23 Fragen in sechs Gruppen |

**Die unbequemen Fragen stehen drin, nicht daneben.** Die FAQ endet mit der
Gruppe „Grenzen und Risiken": Was funktioniert heute noch nicht, was wenn ihr
aufhört, kann das Netz missbraucht werden, ist das legal. Diese Fragen werden
ohnehin gestellt — sie selbst zu beantworten ist besser, als sie jemand anderem
zu überlassen.

Bei der Missbrauchsfrage steht wörtlich: „Was wir nicht tun: so tun, als hätten
wir das gelöst."

Das Whitepaper hat einen eigenen Abschnitt **Grenzen** — Metadaten,
client-seitige Regeln, Lightning ohne öffentliches Ledger, Missbrauch. Und die
Roadmap beginnt mit dem Hinweis, dass das System noch nie echtes Geld bewegt
hat, statt damit zu enden.

`scripts/check-website.py` prüft in der CI: geschlossene Tags, existierende
interne Links, Titel und Beschreibung je Seite. Statische Seiten haben keinen
Build — ein toter Link fällt sonst erst dem ersten Besucher auf, also genau
dem, den die Seite abholen soll.


## 23. Alles ohne Internet

### Der Bestandsabgleich (`mesh-sync.ts`)

Treffen sich zwei Geräte über Funk, weiß keines, was das andere hat. Alles zu
senden ist unmöglich — ein Megabyte dauert über LoRa mehr als eine Stunde.
Nichts zu senden ist nutzlos.

Ein **Bloom-Filter** löst das: Eine Liste von 1.000 Ereignis-Kennungen wäre
32 KB, der Filter über dieselbe Menge braucht 1 KB. Er irrt sich nur in eine
Richtung — er behauptet gelegentlich, etwas zu haben, das er nicht hat. Die
Folge ist, dass ein Ereignis beim ersten Treffen ausgelassen und beim nächsten
nachgereicht wird. Das ist der richtige Fehler: später statt nie, und niemals
falscher Inhalt.

### Was über welche Strecke geht

Die Durchsätze liegen drei Größenordnungen auseinander. Eine Strecke zu wählen,
ohne die Größe zu kennen, lässt einen Nutzer vier Stunden auf etwas warten, das
er per Stick in Sekunden bekommen hätte.

| | LoRa (200 B/s) | Bluetooth (20 KB/s) | Datei |
|---|---|---|---|
| Nachrichten, Räume | ✓ | ✓ | ✓ |
| Solana-Zahlungen | ✓ | ✓ | ✓ |
| Profile, Namen, Abzeichen | ✓ | ✓ | ✓ |
| Code (Git) | ✕ | ✓ | ✓ |
| Modellgewichte | ✕ | ✕ | ✓ |
| Lightning | ✕ | ✕ | ✕ |
| KI-Anfragen | ✕ | ✕ | ✕ |

Lightning braucht mehrere Runden Austausch — das überlebt keine
Offline-Strecke. Eine KI-Antwort mit 500 Wörtern bräuchte über Funk Stunden.
Beides steht so in `offlineCapabilities()`, damit Oberfläche und Dokumentation
dasselbe sagen: Ein Versprechen, das an zwei Stellen verschieden lautet, wird
an der schwächeren geglaubt.

**Die Reihenfolge ist die eigentliche Entscheidung.** Erst fällt weg, was über
diese Strecke nicht geht, dann wird nach Dringlichkeit gefüllt, bis das
Zeitbudget erschöpft ist. Andersherum würde ein Git-Bündel die dringende
Nachricht verdrängen — dafür gibt es einen eigenen Test.

Bei großen Brocken sagt `blobFeasibility()` nie nur „geht nicht", sondern nennt
die Strecke, über die es geht. „Geht nicht" allein lässt den Nutzer ratlos
zurück.

### Bluetooth (`mesh-radio.ts`)

Nordic-UART über Web Bluetooth — den Dienst spricht praktisch jedes LoRa-Gerät
mit BLE. Hundertmal mehr Durchsatz als Funk, damit werden Git-Bündel möglich.
Rahmen werden in BLE-Häppchen zerlegt; ein zu großer Schreibvorgang wird still
verworfen, und die Nachricht fehlte ohne Hinweis.

Auf iOS gibt es Web Bluetooth im Browser **nicht**. Das ist eine Entscheidung
von Apple, keine Lücke bei uns — deshalb bleibt der Datei-Weg die Ebene, auf
die sich jeder verlassen kann.

### Drei Ebenen auf der Karte

`mesh` war eine Sammelkategorie und ist jetzt aufgeteilt. LoRa reicht Kilometer
und trägt Text, Bluetooth reicht Meter und trägt Dateien — wer beides
zusammenwirft, zeigt „Abdeckung vorhanden" und meint etwas, das dem Nutzer
nicht hilft.

| Ebene | Zellgröße | Sichtbar ab |
|---|---|---|
| Provider | ~200 km | 1 |
| LoRa | ~55 km | 3 |
| Bluetooth | ~110 km | 3 |

**Bluetooth wird gröber angezeigt als LoRa, nicht feiner.** Die Reichweite
beträgt Meter; eine feine Zelle wäre praktisch eine Adresse. Die Karte sagt
„hier gibt es Leute mit Bluetooth-Geräten", nicht wo.

Die Standortabfrage nennt zusätzlich die **größte Lücke**: Ohne Funk hilft der
beste Provider nichts, wenn das Netz weg ist.


## 24. Die Lücken aus der Analyse

### Ein Sicherheitsfehler, den erst der Test sichtbar gemacht hat

`lnd-adapter.ts` setzte im Konstruktor `NODE_TLS_REJECT_UNAUTHORIZED = "0"`,
wenn jemand ein selbstsigniertes Zertifikat für seine lokale LND-Instanz
erlauben wollte. Das schaltet die Zertifikatsprüfung für den **gesamten
Prozess** ab — auch für Solana-RPC, Relays und Modell-Downloads. Ein Betreiber,
der eine bequeme Einstellung für sein Heimnetz setzt, macht damit unsichtbar
und dauerhaft sein ganzes System angreifbar.

Jetzt gilt die Ausnahme nur für die eine Verbindung, und sie wird abgelehnt,
wenn die Adresse nicht lokal ist: Ein selbstsigniertes Zertifikat auf einer
fremden Adresse ist nicht zu unterscheiden von einem Angriff.

15 Tests für das Modul, das bisher keinen hatte und echtes Geld bewegt.

### NIP-98 angeschlossen statt gelöscht

`http-auth.ts` war 89 Zeilen, die niemand importierte. Der Grund dafür war
nicht, dass es überflüssig ist — die Storage-Rolle hatte schlicht **gar keine
Authentifizierung**. Jetzt prüft der Knoten jeden schreibenden Zugriff.

Dazu eine nicht-werfende Variante: In einem HTTP-Handler wird ein ungefangener
Wurf zu Status 500, obwohl „falsche Zugangsdaten" ein 401 ist. Der Unterschied
ist nicht kosmetisch — ein 500 sagt einem Angreifer, dass er etwas
Unerwartetes ausgelöst hat.

### Sechs fehlende Wege, jetzt vier davon gebaut

Modell ankündigen, Modell vorhalten, Abzeichen definieren und verleihen. Ohne
die ersten beiden wäre der Katalog für immer leer geblieben — das Protokoll
konnte Manifeste lesen, aber niemand konnte eines erzeugen.

Offen bleiben Kopfgeld und Beitragsmeldung. Beide gehören zur Phase, in der
Mitentwickler dazukommen, und die ist laut Roadmap die letzte.

### Ein Nebenbefund

Mein `import("undici")` im LND-Adapter landete im Browser-Bundle und ließ den
App-Build mit 58 Fehlern scheitern. Das Protokollpaket wird von Node **und**
Browser importiert; ein Node-Modul darin muss zur Laufzeit aufgelöst werden,
sonst zieht der Bundler Dutzende Node-Abhängigkeiten mit. Behoben, indem der
Modulname zur Laufzeit gebildet wird.


## 25. Die letzten Lücken

### Zwei Fehler, die erst das Testschreiben sichtbar gemacht hat

**Die Speicherangabe wurde verworfen.** `buildCapabilities()` schrieb den
`storage`-Tag, `parseCapabilities()` las ihn nicht zurück. Wer damit ein
Speicherangebot prüfte, sah nichts — obwohl es im Event stand. Verdeckt wurde
das dadurch, dass `network-capacity.ts` den Tag direkt liest und deshalb nie
betroffen war. Behoben.

**Die Kapazitätsrechnung zählt dieselbe Pubkey mehrfach.** Ein Einzelner kann
durch wiederholtes Ankündigen die Gratis-Schwelle für alle anheben. Der
harte Deckel begrenzt den Schaden, beseitigt ihn aber nicht. Der Test hält
den Zustand ausdrücklich fest, damit die Annahme nicht unbemerkt weiterlebt.

### Was die Tests über das System verraten haben

Mehrfach lag der Fehler in meiner Erwartung, nicht im Code — und die
Begründungen waren aufschlussreich:

- **Leeres Netz gibt 0 Gratis-Speicher, nicht ein Mindestkontingent.** Anders
  als beim Gratis-Tier für Inferenz wäre ein Mindestbetrag hier ein gebrochenes
  Versprechen: Speicher, den niemand anbietet, kann man nicht verschenken.
- **Vertrauen kommt aus Swap-Attestierungen, nicht aus Kontaktlisten.** Ein
  Kontakt kostet nichts, ein abgewickelter Swap schon — deshalb ist der Graph
  gegen Sybils belastbar.
- **Stufen sind Reputation, keine Hardwareklassen.** Ein neuer Provider mit
  starker Maschine fängt unten an, sonst wäre die Stufe mit Geld kaufbar.

### Provider ohne Internet (`offline-node.ts`)

Die verbliebene Lücke aus der Analyse. Der Knoten führt jetzt einen
Datei-Ordner als vollwertiges Relay mit: Fällt das Netz aus, arbeitet er
weiter; kommt es zurück, wird nachgereicht. Derselbe Ordner lässt sich per
Stick weitergeben oder über Funk abgleichen.

Zwei Entscheidungen darin:

**Ein Ergebnis, das nur im Ordner liegt, gilt nicht als zugestellt.** Für den
Kunden wäre das dasselbe wie keine Antwort — also bleibt es in der
Warteschlange, bis ein Relay es angenommen hat.

**Der Puffer ist begrenzt.** Ein unbegrenzter füllt die Platte und beendet den
Knoten; dann ist gar nichts mehr zugestellt.

Live-Inferenz über Funk bleibt unmöglich. Was geht, ist der zeitversetzte
Betrieb: Auftrag per Stick hin, Antwort denselben Weg zurück. Für einen Ort
ohne Internet ist das der Unterschied zwischen „gar nichts" und „morgen".

### Stand

**939 Tests.** Von den ursprünglich elf ungetesteten Protokollmodulen sind
noch `adapters` (reine Schnittstellendefinition), `mesh` und `treasury-sweep`
offen — letzteres nur über Devnet sinnvoll prüfbar.


## 26. Schlüsselwechsel nach Diebstahl (`key-rotation.ts`)

Die Nachfolge löst „Schlüssel verloren". Für **„Schlüssel gestohlen"** gab es
nichts — und das ist der schlimmere Fall: Wer deinen Schlüssel hat, ist du, für
immer, ohne Widerspruchsmöglichkeit.

Das Schwierige daran: Der Dieb kann dieselben Ereignisse veröffentlichen wie du,
auch einen Widerruf. Aus Sicht der Relays sind beide identisch, und der Dieb
merkt es zuerst.

**Die Lösung ist Vorbereitung statt Reaktion.** Ein Mandat wird im Voraus
signiert, solange der Schlüssel noch sicher ist, und getrennt aufbewahrt. Das
*früheste* Mandat gewinnt — derselbe Gedanke wie beim Referral-Graphen: Wo zwei
widersprüchliche Aussagen möglich sind, entscheidet nicht die lauteste, sondern
die älteste.

Zwei Entscheidungen im Detail:

**Ereignisse vor der Kompromittierung bleiben gültig.** Alles nachträglich für
ungültig zu erklären würde die gesamte Vorgeschichte einer Person löschen —
auch die Belege, auf die sich andere gestützt haben.

**Ein Widerruf ohne Mandat zählt nicht.** Sonst könnte jeder jeden für ungültig
erklären.

Die Warnung nennt beide Grenzen: Wer nicht vorsorgt, kann nach einem Diebstahl
nichts mehr tun — und ein Widerruf holt die Ereignisse des Diebs nicht zurück,
er markiert sie nur als unglaubwürdig.

17 Tests.

## 27. Lückenanalyse

`LUECKEN.md`: systematische Durchsicht mit 15 Punkten in drei Dringlichkeits-
stufen, je mit Begründung, Bauanleitung und Aufwandsschätzung.

Der gravierendste Befund neben dem Schlüsselwechsel: **Zeitstempel sind
fälschbar, und vier bestehende Mechanismen hängen daran** — Referral-Graph
(früheste gewinnt), Schlüsselwechsel (frühestes Mandat), Moderatorenliste
(neueste gewinnt) und die Aufgaben (aktive Tage). Der Aufgaben-Angriff ist
trivial: Ein Provider erzeugt dreißig „Tage" in einer Minute und kassiert bis
zu 29.500 sats je Wegwerf-Identität.


## 28. Stufe A abgearbeitet

### Zeitstempel (`timestamps.ts`)

Der billigste Angriff im System war: dreißig Leistungsnachweise auf dreißig
Kalendertage setzen, sie in einer Minute erzeugen, Monatsprämie kassieren,
Identität wegwerfen, wiederholen.

Drei Stufen: **Plausibilität** (Zukunft und Vor-dem-Schlüssel), **Relay-Zeugen**
(ein Relay veröffentlicht periodisch, welche Ereignisse es gesehen hat — wer
zurückdatiert, kann keinen Zeugen vorweisen) und die **Eingangszeit** als lokale
Beobachtung, die der Absender nicht fälschen kann.

Der letzte Punkt schließt den Aufgaben-Angriff: Dreißig Kalendertage, deren
Ereignisse alle binnen einer Minute eingingen, werden nicht anerkannt.

Wichtig für die Reihenfolge-Mechanismen: **Bezeugtes schlägt Unbezeugtes**,
auch wenn es später datiert. Sonst wäre eine unbelegte Behauptung stärker als
ein Beleg — und genau darauf zielt Rückdatierung.

### Spamschutz (`antispam.ts`)

Drei Mittel: gestaffelter Rechennachweis (für Bekannte keiner, für Fremde eine
Sekunde, bei Wiederholung wachsend), Vertrauensfilter und Ratenbegrenzung je
Absender.

**Der zweite Posteingang ist der Kern.** Nichts wird gelöscht, nichts gemeldet —
Unbekanntes liegt nur nicht im Hauptposteingang. Für jemanden, der Hinweise von
Fremden bekommt, wäre ein löschender Filter das Gegenteil von hilfreich. Und
der Filter ist abschaltbar: Einer, den man nicht umgehen kann, ist eine Zensur
mit anderem Namen.

Die Ratenbegrenzung zählt je Pubkey statt je IP. Eine IP-Sperre trifft alle
hinter demselben Anschluss — in manchen Ländern ein ganzes Mobilfunknetz.

### Sicherung und Ablauf (`state-backup.ts`)

Der Sicherungsschlüssel wird aus der Merkphrase **abgeleitet**, ist aber nicht
der Identitätsschlüssel. Denselben zum Signieren und Verschlüsseln zu nutzen
ist ein Fehler, den man nicht rückgängig machen kann.

Beim Ablauf ist die Benennung wichtiger als die Funktion: Die Sicherung ist
eine **Garantie**, der Ablauf eine **Bitte**. Der Warntext sagt wörtlich
„schreib nichts, dessen Bekanntwerden dich gefährden würde — auch nicht mit
Ablauf."

### Geschenkumschlag (`gift-wrap.ts`)

NIP-59: Ein Relay sieht nur noch einen Wegwerfschlüssel, nicht den Absender.
Zwei Nachrichten derselben Person sehen unverbunden aus, und der Zeitstempel
wird bis zu zwei Tage verschoben.

Der innere Kern bleibt **unsigniert** — das ist der Unterschied zwischen „nur
der Empfänger weiß, dass ich es war" und „der Empfänger kann jedem beweisen,
dass ich es war". Für eine Quelle ist das der Unterschied zwischen
Vertraulichkeit und einem unterschriebenen Geständnis.

Die Grenze steht in der Auskunft: Der Empfänger bleibt im Klartext, sonst
könnte er seine Post nicht finden. Das vollständig zu verbergen bräuchte ein
Mixnetz.


## 29. Stufe B abgearbeitet

### Mehrere Geräte (`devices.ts`)

Bisher musste man den privaten Schlüssel kopieren — genau das, was man Nutzern
abgewöhnen will. Jetzt hat jedes Gerät einen eigenen Schlüssel, den die
Hauptidentität beglaubigt.

Gewählt gegen NIP-46, und zwar bewusst: Dort bleibt der Schlüssel auf einem
Gerät und andere fragen nach Unterschriften — sauber, aber das Hauptgerät muss
erreichbar sein. Für ein System, das ohne Internet funktionieren soll, fällt
das aus.

Der Preis ist ehrlich benannt: Ein Gerätschlüssel ist vollwertig, und der
Entzug erreicht nur, wer ihn sieht. Deshalb sind Vollmachten **eingeschränkt
und befristet** — die Voreinstellung schließt Zahlungen und Identitätsrechte
aus, weil das die Grenze ist, an der ein verlorenes Gerät von ärgerlich zu
teuer wird.

Was vor dem Entzug entstand, bleibt gültig. Sonst löscht ein verlorenes Handy
die gesamte Vorgeschichte — auch die Nachrichten, auf die andere geantwortet
haben.

### Streitfall (`disputes-relays.ts`)

Bei Swaps liegt das Geld in einem HTLC mit Frist, bei Rechenaufträgen gab es
keinen Rückweg. Die Asymmetrie fiel jedem auf, der beides benutzt.

Kein Schiedsrichter: Ein zweiter Provider bearbeitet dieselbe Anfrage. Sein
Urteil zählt nur, wenn er weder Kunde noch beschuldigter Provider ist.

Zwei Entscheidungen, die das Verfahren erst tragfähig machen:

**Ohne Prüfer bleibt die Zahlung beim Provider.** Im Zweifel gegen den
Reklamierenden — sonst wäre jede Reklamation ein kostenloser Auftrag, und das
Verfahren selbst wäre der Angriff.

**Bei Gleichstand wird geteilt, nicht gewürfelt.** Bei kreativen Aufgaben gibt
es kein „richtig".

Die Frist beträgt eine Stunde. Länger würde die Einnahmen des Providers binden
und ihn erpressbar machen.

### Relay-Vergütung

Provider verdienten, Werber verdienten, Relays trugen die gesamte Koordination
und bekamen nichts — derselbe Fehler, den das Projekt bei Providern vermieden
hat, eine Ebene tiefer und bisher unbemerkt.

**15 % des Reward-Pools**, gewichtet nach verschiedenen Clients statt nach
zugestellten Ereignissen: Ereignisse kann ein Relay selbst erzeugen, Clients
sind Schlüssel, die jemand benutzen muss.

Gedämpft mit der Wurzel — hundertfache Reichweite bringt das Zehnfache, nicht
das Hundertfache. Eine Handvoll großer Relays wäre genau die Zentralisierung,
die das Protokoll vermeiden soll.


## 30. Stufe C abgearbeitet

### Verschlüsselte Kanäle (`group-crypto.ts`)

Epochen statt MLS-Baum: Jede Epoche hat einen Schlüssel, der für jedes
Mitglied einzeln verschlüsselt veröffentlicht wird. Tritt jemand aus, beginnt
eine neue Epoche, und der neue Schlüssel geht nur an die Verbliebenen. Bei
Gruppen bis etwa hundert Mitgliedern ist das praktisch gleichwertig zu MLS und
Wochen weniger Arbeit.

Drei Grenzen stehen in der Auskunft, nicht im Kleingedruckten: Wer austritt,
behält die Vergangenheit; ein Wechsel erreicht nur Anwesende; die
Mitgliederliste ist öffentlich.

Ein Detail mit eigenem Test: Der Verteiler könnte einer Person einen **anderen**
Schlüssel geben als dem Rest und damit ihre Nachrichten aussortieren. Die
angekündigte Schlüsselkennung deckt das auf.

### Zusammenführung (`merge.ts`)

„Letzter Schreibvorgang gewinnt" auf Objektebene verliert alles, was das
andere Gerät geändert hat. Auf **Feldebene** verliert es nur, was beide
geändert haben — und das ist selten.

Grabsteine sorgen dafür, dass Entferntes nicht zurückkommt. Bei Gleichstand
gewinnt das Entfernen: Jemanden versehentlich auszuschließen lässt sich
rückgängig machen, ihn versehentlich drinzulassen nicht.

Echte Konflikte werden **gemeldet**. Stillschweigend zu überschreiben ist der
Fehler, den die meisten Systeme machen — der Nutzer merkt es Wochen später und
kann die Änderung dann nicht mehr rekonstruieren.

### Notfall-Löschung (`duress.ts`)

Die Aufklärung nennt die **Gefahr zuerst**, und ein Test prüft genau das: Das
Wort „SCHADEN" muss im Text vor dem Wort „hilft" stehen. Diese Funktion kann
ihrem Nutzer schaden — in vielen Ländern ist das Vernichten von Beweismitteln
strafbar, und die Software ist quelloffen, also ist die Existenz der Funktion
öffentlich bekannt.

Der Text endet mit dem Rat, sie in den meisten Fällen **nicht** zu benutzen.

Gelöscht wird alles mit dem Präfix `freedom.`, nicht nur eine Liste: Eine
Liste veraltet, ein Präfix nicht — und ein vergessener Eintrag wäre genau der,
der jemanden verrät.

### Suche (`local-search.ts`)

Lokal, und das ist die dezentrale Antwort. Ein verteilter Suchindex wäre
technisch möglich und sicherheitstechnisch eine Katastrophe: Wer Suchanfragen
beantwortet, erfährt, wonach jemand sucht — oft mehr wert als der Inhalt.

Invertierter Index mit UND-Verknüpfung, Ausschnitten, Filtern und
Wortvorschlägen. 5.000 Nachrichten bleiben unter 20 MB, die Suche unter einer
halben Sekunde.

**Ein Fehler, den der Test gefunden hat:** Unbekannte Begriffe wurden
herausgefiltert statt die Suche leer zu machen — „vertrag gibtesnicht" fand
damit alle Verträge. Ein stilles ODER, wo der Nutzer UND meinte.

### Tor (`relay-discovery.ts`)

`.onion`-Erkennung und drei Einstellungen. Bei „nur Tor" wird ausdrücklich
gesagt, wenn keine Relays übrig bleiben — ein Client ohne Relays sieht sonst
aus wie ein kaputtes Programm.

### C6 bewusst nicht gebaut

Ein Einsatz, den ein Provider bei Fehlverhalten verliert, braucht eine
Instanz, die über Fehlverhalten entscheidet. Genau die soll es nicht geben.
Der Streitfall (B2) deckt den konkreten Schaden ab, ohne eine solche Instanz
einzuführen — alles darüber hinaus wäre ein Gericht mit anderem Namen.


## 31. Datenschutz-Selbstauskunft (`privacy-audit.ts`)

Anlass war die Frage, ob ein Mixnetz nötig ist oder das System „ohnehin
anonym" sei. Die zweite Annahme ist falsch, und statt das nur zu sagen, gibt
es jetzt ein Modul, das für jede Konfiguration ausrechnet, **wer was sieht**.

**Drei Schichten, die unabhängig voneinander lecken:**

| Schicht | Stand |
|---|---|
| Inhalt — was gesagt wird | stark (NIP-44, Umschlag, Gruppenschlüssel) |
| Netz — wer von wo verbindet | schwach: jedes Relay sieht die IP |
| Kette — was bezahlt wird | am schwächsten, und meist übersehen |

Mit Vorgabewerten und aktiven Swaps kommt der Bericht auf **0 von 100** und
sagt wörtlich „Du bist NICHT anonym." Das ist beabsichtigt: Ein System, das
sich selbst gute Noten gibt, ist als Auskunft wertlos.

`mixnetImpact()` beantwortet die Ausgangsfrage direkt und nennt beide Seiten —
zwei Dinge, die ein Mixnetz behebt, und fünf, die es nicht behebt.

Ein Test hält die wichtigste Eigenschaft fest: **Auch in der bestmöglichen
Konfiguration darf das Wort „anonym" nicht in der Überschrift stehen.** Kette
und Empfänger bleiben sichtbar, und eine Zeile, die das Gegenteil behauptet,
wäre die gefährlichste im ganzen System.


## 32. Adressen für Swaps (`swap-privacy.ts`)

Die beschlossene Reihenfolge war: Tor einschalten, frische Adressen erzwingen,
die dritte Zahlungsschicht vertagen. Beide ersten Punkte sind umgesetzt.

**Frische Adresse je Swap**, aus dem Hauptschlüssel abgeleitet. Der Nutzer muss
nichts zusätzlich sichern — die Merkphrase bringt jede Adresse zurück. Eine
zufällige Adresse wäre ebenso privat und müsste einzeln gesichert werden; genau
daran scheitern solche Verfahren in der Praxis.

**Die zweite Maßnahme ist wichtiger als die erste.** Runde Beträge verbinden
frische Adressen wieder: Wer dreimal exakt 0,5 SOL bewegt, hat drei Adressen
und ein Muster. Die Prüfung schlägt einen Zuschlag von bis zu 0,3 % vor — genug
zum Unterscheiden, zu wenig zum Ärgern.

**Und die Grenze steht daneben:** Zeitkorrelation bleibt. Zwei Swaps dicht
hintereinander lassen sich verbinden, auch bei frischen Adressen. Dagegen hilft
nur Warten.

Die Prüfung läuft **vor** dem Swap im Dialog, nicht als Bericht danach. Ein
Hinweis, der erst kommt, wenn die Transaktion in der Kette steht, ist wertlos.

## 33. Datenschutzbericht in der Oberfläche

Der Bericht liest die tatsächlichen Einstellungen aus, statt eine
Musterkonfiguration zu bewerten — einer, der nicht die eigene Lage beschreibt,
wird nicht gelesen. Dazu eine Umschaltung für die Verbindungsart, die bei Tor
die `.onion`-Relays tatsächlich nach vorn holt und die Reihenfolge merkt. Eine
Einstellung, die nur eine Beschriftung ändert, wäre schlimmer als keine.

## 34. AMLR auf der Go-Live-Liste

Verordnung (EU) 2024/1624, Artikel 79, anwendbar ab 10. Juli 2027: Anbietern
von Kryptowerte-Dienstleistungen ist der Umgang mit anonymitätsverstärkenden
Kryptowährungen untersagt. Artikel 2 Nummer 25 erfasst ausdrücklich auch Werte
mit **optionaler** Verschleierung.

Für das Projekt ist nicht entscheidend, ob Monero legal ist — Besitz und
Selbstverwahrung bleiben erlaubt —, sondern **ob die Firma ein CASP im Sinne
der Verordnung ist**. Das ist eine Anwaltsfrage und steht jetzt in Abschnitt 0
der Go-Live-Liste, wo sie vor allem anderen geklärt gehört.


## 35. Neuordnung der App, Logo 09, Textbereinigung

### Aufbau

Sechs Tabs in dieser Reihenfolge: **Agent · Kommunikation · Währung · Earn ·
Profil · Settings.** Farben, Schriften und Radien sind unverändert — geprüft
durch Abgleich: Der neue CSS-Block führt keinen einzigen neuen Farbwert ein.

Die Desktop-Seitenleiste ist 72 px schmal (Symbol über Beschriftung), damit
Kommunikation Discords Aufbau tragen kann: Server-Leiste, Kanäle, Chat,
Mitglieder. Mobil zeigt Kommunikation wie Discord immer nur eine Ebene.

**Agent:** Verlauf links (neu, lokal gespeichert, höchstens 40 Aufgaben),
Gespräch in der Mitte, rechts Arbeitsbereich, benutzte Werkzeuge und Kosten
dieser Sitzung — nur aus echten Daten. Modelle und Repositories als Reiter.

**Settings:** Sicherheit als Vier-Schritte-Liste mit Fortschritt; der Zähler
steht gelb neben dem Menüpunkt, solange etwas fehlt.

Alle 155 Funktions-IDs sind erhalten; die Blöcke wurden verschoben, nicht neu
geschrieben. Deshalb läuft die bestehende Verdrahtung unverändert.

### Behobene Fehler, die beim Umbau auftauchten

- Das Onboarding klickte einen Tab `agent`, den es nie gab.
- Sieben Übersetzungsschlüssel fehlten und erschienen roh (`tierClassic` …).
- Schlüsselwechsel und Nachfolge setzten keinen Vermerk — der
  Sicherheitszähler hätte sie nie gezählt.
- `.mono-sm` brach Fließtext mitten im Wort um.
- Der Zap-Knopf drückte das Eingabefeld im Chat auf wenige Pixel zusammen.

### Falsche Versprechen entfernt

- **Werben: „5 %" statt tatsächlich 0,5 %.** In allen acht Sprachen. In den
  sechs, die ich nicht sicher übersetzen kann, sind die Einträge gelöscht und
  fallen auf die korrigierte englische Fassung zurück.
- **„Hoste die App — 2 %"**: Diesen Mechanismus gibt es nicht mehr — er existierte
  nur als Text. Jetzt steht dort, dass Verbreiten nicht vergütet wird.
- „Das unzensierbare KI- & Nachrichten-Netzwerk" ersetzt durch
  „Nachrichten, Zahlungen und KI ohne Betreiber".

### Ton

Alle sichtbaren Absätze einmal ganz gelesen und neu gefasst: kurz, sachlich,
ohne Merksätze. Gemischtes Deutsch-Englisch („Pay per job … non-custodial")
ist raus.

### Geprüft im Browser

Alle sechs Tabs und alle Unter-Reiter angeklickt, auf Deutsch, Desktop und
Telefon. Null Programmfehler.


## 36. Website veröffentlichen

`scripts/build-site.sh` stellt einen sauberen Ordner zusammen: Startseite,
Unterseiten, Stil, Manifest, frisch gebaute App mit Prüfsumme, `.nojekyll`,
lesbare Dateirechte. Interne Dateien bleiben draußen — `DEPLOY.md` enthielt
einen lokalen Pfad mit Benutzernamen.

`.github/workflows/pages.yml` macht dasselbe automatisch bei jedem Push und
veröffentlicht nur, wenn die Tests grün sind.

**Geprüft:** Der Ordner wurde unter einem Unterpfad ausgeliefert, wie GitHub
Pages es tut. Alle Seiten, Stylesheet, Manifest und Prüfsumme laden, „App
öffnen" öffnet die App, keine fehlende Datei.

### Auf der Startseite korrigiert

- **„Die 5%-Protokollfee ist hardcoded (2,5% Development / …)"** beschreibt die
  alte Struktur mit Entwickleranteil, den die CI heute als Invariante verbietet.
  Jetzt: 2,5 % Protokoll (2,0 % Pool, 0,5 % Werber), dazu 2,5 % App-Gebühr,
  abschaltbar.
- **„Contracts keyless (kein Upgrade-Authority)"** — das Programm ist nicht
  einmal auf Mainnet, und die Authority bleibt nach dem Deploy zunächst bei
  euch. Jetzt: „wird nach einer Testphase unveränderlich gemacht".
- „unzensierbar" an fünf Stellen, „überlebt jeden Einzelnen — inklusive der
  Gründer", gemischtes Deutsch-Englisch.

### Zwei bestehende Fehler dabei gefunden

- `data-i18n-html` wurde nirgends verarbeitet: Der Untertitel der Startseite war
  nie übersetzbar, englische Besucher sahen ihn auf Deutsch.
- Die Sprachrückfall-Regel griff nur je Sprache, nicht je Eintrag.

Dazu: Manifest mit Zeichen 09 statt des alten „F", ohne das erfundene
Bildschirmfoto; alle Seiten mit Favicon.


## 37. Werkzeug-Karten nachgebessert

Beim Umbau hatte ich nur den Rahmen der Karte gestaltet und den Inhalt
stehen lassen: `▸ details · 6 sats` mit einer kleingeschriebenen Liste
(`modell`, `provider`, `tokens`, `session gesamt`). Weder das Kartenbild aus
dem Entwurf noch der gewünschte Ton.

Jetzt: Kopfzeile mit Haken, Modellname und Kosten; darunter **jedes Werkzeug
als eigene Zeile** mit Haken und Preis; dann die Details mit sauberen
Bezeichnungen und die Sitzungssumme hervorgehoben. Der Pfeil dreht sich beim
Aufklappen.

Die Karte erscheint weiterhin nur nach einer bezahlten Antwort — sie zeigt
echte Daten und erfindet nichts.

### Zwei weitere Korrekturen

- **Umbruchpunkte gesenkt:** Der Arbeitsbereich rechts verschwand unter
  1280 px, also genau auf einem 1280er-Laptop. Jetzt 1200 px, die
  Verlaufsspalte bei 860 px.
- **Prüfsumme auf der Startseite:** Dort stand ein fest eingetragener alter
  Wert, der nicht zur ausgelieferten Datei passte. `build-site.sh` trägt jetzt
  den echten Wert ein und bricht ab, wenn das Feld fehlt.

## 38. Ausbauplan, Phase 0 – Sicherheit sofort

Umgesetzt auf dem Stand des Archivs vom 22.09.2026 (eine Version vor dem
aktuellen Devnet-Stand). Als Patch auf den neuesten Stand übertragen.

| Schritt | Änderung | Belegt durch |
|---|---|---|
| 0.1 XSS | `sanitizeUsage()` in `dvm.ts` prüft das usage-Tag eines Providers gegen ein festes Schema; `ganzeZahl()` setzt Token-Zahlen nie ungeprüft in innerHTML. | 7 neue Tests (`dvm-usage.test.ts`) |
| 0.2 HTLC-Frist | `claim` nur vor Ablauf (`TimelockExpired`, als letzte Fehlervariante) | neuer Anchor-Test |
| 0.3 CSP | `build.mjs` setzt eine CSP mit dem SHA-256 des einzigen Skripts; Build bricht ab bei zweitem `<script>` | Headless-Chromium: App startet ohne Fehler, Inline-Handler blockiert |
| 0.4 Beschriftung | Datenschutzbericht: kein Gift-Wrap, keine verborgene IP; KI-Anfragen als öffentlich markiert; Hinweis vor erster KI-Anfrage; DM-Beschriftung korrigiert | Build enthält keine alten Vorgaben mehr |
| 0.5 Prüfsumme | `build-site.sh` setzt die Summe auch in `index.html` ein und bricht ab, wenn das Feld fehlt | Summe auf Startseite = `freedom.html.sha256` |

**Offen aus Phase 0:**
- HTLC-Änderung in die aktuelle Devnet-Fassung übernehmen, bauen, Tests auf Validator.
- Signierschlüssel erzeugen, `TRUSTED_SIGNERS` setzen.
- App mit CSP einmal mit Wallet-Erweiterungen (Phantom, Alby) im Browser prüfen.

**Endstand:** protocol 909 grün (3 übersprungen), 1 rot (Devnet-HTLC-Simulation, läuft auf Validator) · node 160 grün (5 übersprungen) · app 157 grün · 0 rot · Smoke-Test bestanden · check-wiring + check-website ok.


## 39. Einlösen mit Sicherheitsabstand, Solana-Ableitung (Schritte 0.C und 1.1)

**0.C – Einlösen nur mit Sicherheitsabstand.** Seit das HTLC-Programm
Einlösungen nach Ablauf ablehnt, darf die App nicht mehr knapp vor Fristende
einlösen: Eine abgelehnte Transaktion, die trotzdem in einen Block gelangt, legt
das Preimage offen – der Liquiditätsgeber könnte dann die Lightning-Zahlung
einziehen und die SOL zurückholen. `claimAllowed()` erlaubt das Einlösen nur,
solange mehr als zehn Minuten bleiben. `claimSwap()` prüft das vor dem Signieren
und noch einmal direkt vor dem Senden; die Vorabsimulation bleibt ausdrücklich
an. `nextStep()` drängt in den letzten zehn Minuten nicht mehr zum Einlösen,
sondern rät ab. Fehler des Programms übersetzt `describeHtlcError()`. Die aktive
Swap-Sitzung merkt sich dafür die SOL-Frist.

**1.1 – Solana-Schlüssel aus der Merkphrase.** `derivation.ts` leitet nach
SLIP-10 (Ed25519) ab: `m/44'/501'/n'/0'`, kompatibel zu Phantom und Solflare,
geprüft gegen die offiziellen SLIP-0010-Testvektoren. Noch nicht in der
Oberfläche verdrahtet – das folgt mit der eingebauten Wallet (Schritt 4.2).
Pfadübersicht in `docs/SCHLUESSEL.md`.

**Angepasste Tests:** Drei bestehende Tests in `swap-client.test.ts` folgen dem
neuen, strengeren Verhalten (Frist ist Pflichtparameter; in den letzten zehn
Minuten wird abgeraten statt gedrängt).

Endstand: protocol 917 grün (5 übersprungen) · node 158 grün (7 übersprungen) ·
app 163 grün · 0 rot · Smoke-Test bestanden.

**Offen (MENSCH):** HTLC-Programm auf Devnet aktualisieren; eine Test-Phrase in
Phantom gegen `deriveSolanaKey(seed, 0)` abgleichen.


## 40. Private Direktnachrichten nach NIP-17 (Schritt 2.1) und Leak-Tests (Schritt 1.5, erster Teil)

- **Senden:** Direktnachrichten gehen nur noch nach NIP-17 raus – Kind 14 im
  Siegel (Kind 13) im Umschlag (Kind 1059), an den Posteingang des Empfängers
  (Kind 10050, falls veröffentlicht) und als Kopie an sich selbst. Relays sehen
  weder Inhalt noch Absender. Kind 4 wird nie mehr gesendet.
- **Lesen:** Umschläge an mich werden geöffnet und der Unterhaltung zugeordnet.
  Ältere Kind-4-Nachrichten bleiben lesbar und sind als „alt“ markiert – und
  zwar nur noch die zwischen genau beiden Beteiligten (vorher erschienen auch
  Nachrichten des Partners an Dritte, unlesbar).
- **Posteingang:** Neue Absender erscheinen als „Anfrage“ in der Liste; die
  eigene Kind-10050-Liste wird einmal veröffentlicht.
- **Neue DM:** npub wird umgewandelt, die Eingabe geprüft (vorher scheiterte
  npub beim Senden).
- **Sicherheit:** `giftUnwrap()` prüft jetzt die Signatur des Siegels, wie
  NIP-59 es verlangt; vorher wurde nur der Absender verglichen.
- **Datenschutzbericht:** Die Aussagen kommen aus `privacy-facts.ts`. „Belegt“
  darf nur stehen, was ein Leak-Szenario prüft – das erzwingt
  `test/privacy-facts.test.ts`. Offene Punkte nennen den Schritt, der sie schließt.
- **Leak-Regeln** (`leak-rules.ts`): kein Kind 4, kein Klartext, der echte
  Absender nie als Autor, p-Tags nur an Beteiligte. Dazu ein Verdrahtungstest
  in der App (`test/dm-verdrahtung.test.ts`), der genau die frühere Lücke
  abdeckt: gebaut, getestet, aber nicht im Sendepfad.
- **Grenze:** NIP-44 hat keine Forward Secrecy – die kommt mit MLS (Schritt 2.2b).

Endstand: protocol 929 grün (5 übersprungen) · node 158 grün (7 übersprungen) ·
app 167 grün · Smoke-Test bestanden.

**Nebenbefund:** `node/test/sol-deposit-job.test.ts` („Provider verarbeitet Job
gegen Deposit“) ist unabhängig von diesem Schritt instabil – auf dem Stand davor
in 1 von 8 Läufen rot. Gehört repariert (Zeitabhängigkeit im Test).

**Offen (MENSCH):** Nachricht mit einem anderen NIP-17-Client hin und zurück
(etwa Amethyst oder 0xchat); Abgleich der Solana-Programm-ID (siehe Anleitung).


## 41. Quellcode ins Repository, Schritt 2.1 abgeschlossen

**Quellcode liegt jetzt in `3dagi/freedom-app`** (Weg A aus `START-HIER.md`):
Der vollständige Stand kommt in den Branch `main`, ab dann baut
`.github/workflows/pages.yml` die Seite – nur mit grünen Tests. Die bisher von
Hand hochgeladenen Build-Dateien im Wurzelverzeichnis bleiben vorerst liegen:
Solange die Pages-Quelle noch „Branch“ ist, hält das die Seite erreichbar. Sie
werden entfernt, sobald die erste Veröffentlichung über Actions live ist.

**Zwei Befunde, die GitHub Actions sofort rot gemacht hätten:**

- `protocol/test/solana-devnet.test.ts` übersprang die Live-Tests nur, wenn
  Devnet nicht erreichbar war. In GitHub Actions ist Devnet erreichbar, aber es
  gibt kein Wallet – beide Tests scheiterten an `~/.config/solana/id.json`.
  Jetzt wird auch ohne Wallet übersprungen; mit Wallet-Datei laufen sie wie
  bisher (gegengeprüft). Die Prüfungen selbst sind unverändert.
- Die Fee-Invariante in `ci.yml` importierte noch `FEE_DEV_PPM` und rechnete mit
  `devMsat` – beides gibt es seit der Umschichtung des Entwickleranteils in die
  Client-Schicht nicht mehr. Sie prüft jetzt den heutigen Aufbau (Pool +
  Referral = Protokollfee, nichts geht verloren) und schlägt an, sobald wieder
  ein fester Entwickleranteil im Protokoll auftaucht (Negativprobe gemacht).

**2.1 abgeschlossen:** Alle Prüfungen grün, der Schritt wird mit diesem Merge
veröffentlicht. Code von 2.1 unverändert.

Endstand: protocol 929 grün (5 übersprungen) · node 159 grün (6 übersprungen –
der Netz-Test in `tools.test.ts` läuft mit Internet mit) · app 167 grün · 0 rot
· check-wiring, check-website ok · check_innerhtml 66 unbewertete Fundstellen
(Schritt 0.B) · Smoke-Test bestanden · alle übrigen CI-Schritte lokal
nachgespielt.

**Offen (MENSCH):** Pages-Quelle „GitHub Actions“ und Standard-Branch `main`
vor dem Merge (0.I); danach Interop-Test der Direktnachrichten (2.1).


## 42. Veröffentlichung über GitHub Actions abgeschlossen (Schritt 0.I)

Nach dem Merge von #1 hat `.github/workflows/pages.yml` die Seite zum ersten
Mal selbst veröffentlicht. **Live geprüft:**

- CI und `pages` auf `main` grün.
- Prüfsumme an allen drei Stellen gleich: ausgelieferte `freedom.html`,
  `freedom.html.sha256` und Startseite – `ef5a0aec…`. Derselbe Wert wie im
  lokalen Build; der Build ist also reproduzierbar.
- Alle Seiten, Stylesheet und Manifest laden. Ausgeliefert wird nur der
  Website-Ordner: Quellcode, `README.md`, `CLAUDE.md` liefern 404.
- Standard-Branch ist `main` – neue Sitzungen starten auf dem aktuellen Stand.

**Aufgeräumt:** Die zehn von Hand hochgeladenen Build-Dateien im
Wurzelverzeichnis (`index.html`, `freedom.html`, `freedom.html.sha256`,
`dashboard.html`, `faq.html`, `roadmap.html`, `whitepaper.html`,
`manifest.json`, `css/style.css`, `.nojekyll`) sind entfernt. Nichts im
Repository verweist auf sie; die Seite entsteht aus `packages/website` und dem
App-Build. `DEPLOY.md` nennt die neue Prüfsumme und den einzigen
Veröffentlichungsweg; `UEBERSICHT.md` führt 2.1 als live.

Endstand: unverändert, keine Codeänderung (Zahlen im Bericht des Pull Requests).


## 43. Instabilen Knoten-Test repariert (Schritt 0.H)

**Symptom:** `node/test/sol-deposit-job.test.ts`, „Provider verarbeitet Job
gegen Deposit, bietet SOL-Zahlung an“, war in 2 von 40 Läufen rot:
`pollOnce()` verarbeitete 0 statt 1 Job. Protokoll des Providers dabei:
„Das Event nennt einen späteren Timelock (…062) als die Kette (…061).“

**Ursache – im Test, nicht im Code:** Der Test berechnete die Frist zweimal
aus der Uhr (`Math.floor(Date.now() / 1000) + 7200`): einmal für die simulierte
Kette, einmal für das Deposit-Event. Dazwischen liegen Schlüsselerzeugung und
Provider-Aufbau. Sprang in dieser Zeit die Sekunde um, versprach das Event eine
Sekunde mehr, als das HTLC hergab – und `verifyDepositOnChain()` lehnte ab.
Das ist gewollt: Ein Event darf keine längere Frist versprechen als die Kette
(`protocol/src/deposit-verify.ts`). Der Code bleibt unverändert.

**Belegt:** Mit erzwungenem Sekundenwechsel zwischen beiden Berechnungen war der
alte Test 5 von 5 Mal rot, der korrigierte 5 von 5 Mal grün (Wegwerf-Kopie,
nicht eingecheckt).

**Behoben:** Eine Frist-Konstante für Kette und Event. Neuer Negativtest auf
Provider-Ebene: Ein Event mit nur einer Sekunde mehr Frist als die Kette wird
abgelehnt, und es entsteht kein Ergebnis – genau der Fall, den der alte Test
zufällig mitprüfte, jetzt mit Absicht. `CLAUDE.md`: Ausnahme „instabiler Test
einmal wiederholen“ gestrichen, stattdessen die Regel „Fristen in Tests nur
einmal aus der Uhr berechnen“.

**Läufe:** 20 am Stück nach der Karte grün, dazu 100 weitere grün (vorher
etwa jeder 20. rot).

Endstand: protocol 929 grün (5 übersprungen) · node 160 grün (6 übersprungen;
+1 neuer Negativtest) · app 167 grün · 0 rot · check-wiring, check-website ok ·
Smoke-Test bestanden · App-Build unverändert (`ef5a0aec…`).


## 44. innerHTML-Prüfung (Schritt 0.B)

**Das Prüfskript sah nur einen Teil.** `scripts/check_innerhtml.py` las nach
`innerHTML =` nur die erste Vorlage. Per `+` angehängte Vorlagen, beide Zweige
einer Bedingung und Vorlagen in `.map()`-Rückgaben blieben ungeprüft –
„0 Fundstellen“ hätte also nichts bedeutet. Jetzt zerlegt es die ganze rechte
Seite in die Teile, die im HTML landen können (Verkettung, `? :`, `||`, `??`,
`&&`, verschachtelte Vorlagen), überspringt Kommentare und zählt Vergleiche und
Negationen als sicher. `pkShort()` gilt nicht mehr als sicher – es maskiert
nicht. Eine Ausnahme deckt genau eine Stelle ab; ein zweites `${cls}` in
derselben Datei wird wieder gemeldet. Selbsttest `scripts/test_check_innerhtml.py`
(6 Fälle; gegen das alte Skript scheitern 5).

**Ergebnis:** 66 Fundstellen vorher, mit dem neuen Skript 116. 12 Stellen
abgesichert, 100 in `scripts/innerhtml-ausnahmen.txt` begründet (eigene
Konstanten, lokal gezählte Zahlen, `Math.*`, schon maskierte Teile). Audit:
`docs/INNERHTML-AUDIT.md`. CI (`ci.yml`) und Veröffentlichung (`pages.yml`)
prüfen streng.

**Abgesichert – von außen erreichbar:**
- **Modellname des Providers** (`usage.model`, Ankündigungen) stand roh in der
  Absenderzeile (`addAiMessage`, `addAiMessageStreaming`) und kam beim
  Wiederherstellen eines Verlaufs erneut roh ins HTML. `sanitizeUsage()` entfernt
  nur Steuerzeichen. Im Browser nachgewiesen: In der veröffentlichten Version
  wird ein `<img>` im Modellnamen zu einem echten Element, jetzt zu Text. Die CSP
  verhinderte Skripte, nicht eingeschleustes HTML.
- **Unterhaltungs-ID im Attribut** `data-cid` der Chat-Liste und **Name im
  Zap-Dialog**: Bei einer DM-Anfrage ist das der Absenderschlüssel aus dem
  Siegel. Über den Befund unten vermutlich von jedem Fremden erreichbar (nicht
  Ende-zu-Ende nachgestellt).
- Schlüssel in der Repo-Liste (`pkShort` ohne Maskierung).

**Abgesichert – Härtung:** Zahlen aus dem eigenen Nachfolgeplan (`ganzeZahl`),
`work_type`/`units` aus eigenen Leistungs-Events, zwei Fehlermeldungen,
Modellstufe, `meta`, Dateiname und Daten-URL der Anhang-Vorschau; `zeile()` in
der Kosten-Blase maskiert jetzt selbst.

**Neuer Befund, nicht behoben (Schritt 0.J):** `verifyEvent()` akzeptiert ein
Event, dessen `pubkey` aus 64 gültigen Hex-Zeichen plus angehängtem Text
besteht – `Buffer.from(h, "hex")` schneidet still ab, die Signatur prüft gegen
den echten Schlüssel. Mit einem Wegwerf-Skript nachgewiesen. Die Lösung liegt im
Signaturpfad; nach der STOPP-Regel nur mit Freigabe. Karte in `phase-0.md`.

**Smoke-Test erweitert:** ein gespeicherter Verlauf mit HTML im Modellnamen und
in `meta` wird geöffnet; bestanden nur, wenn beides als Text erscheint. Die
veröffentlichte Version fällt damit durch, der neue Build besteht.

Endstand: protocol 929 grün (5 übersprungen) · node 160 grün (6 übersprungen) ·
app 167 grün · 0 rot · Selbsttest Prüfskript 6 grün · innerHTML streng: 0
unbewertet · check-wiring, check-website ok · Smoke-Test bestanden.


### 2.1 Interop: NIP-17 gegen nostr-tools (Branch test/interop-2.1)

Patch freedomstack-interop-2.1.patch via git am -3 ✅

| Check | Ergebnis |
|-------|----------|
| Interop library | 5/5 grün ✅ |
| Protocol tests | 935/939 grün (1 Devnet-OOM, 3 skipped) ✅ |
| App tests | 167/167 grün ✅ |
| UI-Test lokales Relay | bestanden ✅ |
| UI-Test public Relays | bestanden ✅ |


## 45. Event-Felder streng prüfen (Schritt 0.J)

**Freigabe:** 24.09.2026 (Änderung im Signaturpfad, STOPP-Regel).

**Befund aus 0.B:** `verifyEvent()` dekodierte `pubkey`, `id` und `sig` mit
`fromHex()` = `Buffer.from(h, "hex")`, das beim ersten ungültigen Zeichen still
abbricht. Ein Event mit `pubkey` aus 64 Hex-Zeichen plus angehängtem Text bestand
die Prüfung; der Text lief bis in die Oberfläche mit.

**Jetzt:** `hasValidEventShape()` prüft vor allem anderen die Form nach NIP-01:
`id` und `pubkey` genau 64 kleine Hex-Zeichen, `sig` genau 128, `created_at` und
`kind` ganze Zahlen ≥ 0, `tags` ein Array aus Arrays von Zeichenketten, `content`
eine Zeichenkette. Alle Signaturprüfungen laufen über `verifyEvent()`: Relay-Pool
der App, Relay-Rolle des Knotens, Gift-Wrap-Siegel, HTTP-Auth, Datei-Relay,
Gebührenbeleg.

**Weitere `fromHex()`-Aufrufe mit Fremddaten geprüft:**
- **LP-Daemon, Hashlock aus der Swap-Anfrage:** Ein zu kurzer Wert wurde still
  gekürzt, und das Sperren füllte mit Nullen auf. Der LP sperrte SOL unter einem
  Hash, dessen Preimage niemand kennt, bis zur Frist. Mit einem Test
  nachgestellt: Hashlock `"ab"` wurde bedient. Jetzt wird vor jeder Geldbewegung
  genau 32 Byte hex verlangt.
- **Zap-Quittung (Preimage):** harmlos – angehängter Text an einer echten
  Preimage verschafft nichts, eine gekürzte passt nicht zum Hash; alles in
  `try/catch`. Unverändert.
- **PoW (`countLeadingZeroBits`):** sieht nur Events, die `verifyEvent()` schon
  geprüft hat. Unverändert.
- Übrige Aufrufe dekodieren eigene Schlüssel aus Speicher, Eingabe oder Umgebung.

**Tests:** 13 neue in `protocol/test/event.test.ts` – zehn Formfehler, jeder so
signiert, wie ein Angreifer es kann, mit Kontrolle, dass die reine Kryptografie
ihn annähme; dazu gültige Events, Nicht-Objekte und der echte Pfad über
`OutboxPool.query()`. Ohne die neue Prüfung scheitern alle zehn Ablehnungen und
der Pool-Test. 1 neuer in `node/test/lp-daemon.test.ts` (vier falsche
Hashlock-Formen); ohne die Prüfung wird `"ab"` bedient.

Endstand: protocol 947 grün (5 übersprungen; vorher 934) · node 161 grün (6
übersprungen; vorher 160) · app 167 grün · 0 rot · innerHTML streng 0 unbewertet ·
check-wiring, check-website ok · Smoke-Test bestanden.


## 46. Verdrahtungsprüfung erweitert (Schritt 1.4)

**Vorher** prüfte `scripts/check-wiring.py` nur `build*`-Exporte und zählte jedes
Vorkommen des Namens – auch in Kommentaren, Strings und als Eigenschaft
(`giftWrap: true`). **Jetzt** prüft es jede exportierte Funktion und Klasse im
Protokoll. „Verdrahtet“ heißt: von App, Knoten oder Skripten aus erreichbar –
direkt oder über eine Kette von Protokoll-Funktionen, die selbst erreichbar
sind. Kommentare, Strings, `obj.name` und `name:` zählen nicht. Ausnahmen stehen
mit Begründung in `scripts/wiring-ausnahmen.txt`; `--streng` (CI) scheitert an
unbegründeten und an veralteten Ausnahmen. Laufzeit 0,3 s. Selbsttest
`scripts/test_check_wiring.py` (4 Fälle).

**Abnahme – Hilfszweig mit nachgebildetem Stand vor 2.1** (Branch
`hilfszweig/vor-2.1`, nur lokal: `private-dm.ts` entfernt, die App-Aufrufe
abgeklemmt – der echte Stand vor 2.1 liegt nicht im Repository):

    gift-wrap.ts: giftUnwrap, giftWrap, shouldWrap, wrapDisclosure, wrapInfo

Die alte Prüfung meldet auf demselben Stand „Verdrahtung ok — 75 Bausteine“.

**Bestandsaufnahme:** 427 Exporte, 253 verdrahtet, **174 nicht** (57 Module).
Jede Zeile der Ausnahmeliste nennt den Schritt im Ausbauplan, der die
Verdrahtung bringt. Auffällig, weil es Schutzfunktionen sind:
- `antispam.ts` (`RateLimiter` u. a.): Spam- und Flutschutz ist weder im Relay
  des Knotens noch in der App eingebunden.
- `parseProfileSafe()`: gebaut für fremde Profile; App liest fremde Profile mit
  `parseProfile()`, das bei kaputten Daten wirft (`chat-zap.ts`, `app.ts`).
- `assertProtocolFeeConfigured()`: die Prüfung vor Mainnet-Betrieb ruft niemand.
- `verifyZapPayment()`, `feeLegsFor()`: Belegprüfungen ohne Aufrufer (4.8).
- `runSwap()`: der Referenz-Ablauf läuft nur in Tests; die App nutzt `swap-client.ts`.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 167 grün · 0 rot · Selbsttests: Verdrahtung 4, innerHTML 6 · check-wiring
`--streng` 0 offen · check-website ok · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.


## 47. `app.ts` aufteilen, Teil a: `state.ts` und `ui.ts` (Schritt 1.0) – dazu ein Nachtrag zu 1.4

**Plan für 1.0** in fünf Pull Requests, jeweils nur Verschiebungen: a `state.ts`
und `ui.ts`; b Kommunikation; c Agent; d Währung und Earn; e Profil, Settings,
Datenschutz. `boot()` und `switchTab()` (ruft alle Tabs auf) bleiben in `app.ts`.

**Teil a:** 38 Deklarationen verschoben – `state.ts` (Konstanten, `state`,
Provider-Suche, Relay- und RPC-Pool, Session-Client) und `ui.ts` (`$`, `toast`,
Zeiten, Seitenleiste, Logo, Markdown). `app.ts`: 5.816 → 5.402 Zeilen. Eine
Variable zieht immer mit dem Code um, der sie schreibt: `wireRpcSetting` steht
deshalb in `state.ts`, weil es `rpcPool` zurücksetzt; `lastProviderModel` bleibt
bis Teil c in `app.ts`. `escapeHtml`/`pkShort` bleiben in `shell-logic.ts` (dort
getestet), `icon` in `icons.ts`. `app.ts` exportiert `activateCodeBlocks` weiter,
damit `window.freedomApp` gleich bleibt.

**Nur Verschiebungen – belegt:** Jede der 225 Deklarationen des alten `app.ts`
steht wörtlich in genau einer Datei; 25 haben ein `export` bekommen; keine neue.
Alle nichtleeren Zeilen außer den Importen sind als Menge identisch. Sieben
Importe waren schon vorher unbenutzt (`tsc --noUnusedLocals`) und fallen weg.
Klicktest aller 6 Tabs und 17 Unter-Reiter im Browser: veröffentlichte und neue
Fassung ohne Skriptfehler.

**Nachtrag zu 1.4:** `check-wiring.py` las Backticks in einem Regex-Literal
(`/`([^`\n]+)`/g` in `renderMarkdown`) als Template-String und überlas den Rest
der Datei. Das fiel auf, weil `renderMarkdown` nach `ui.ts` zog und sich dadurch
das Ergebnis änderte. Jetzt erkennt die Prüfung Regex-Literale (Selbsttest ergänzt,
ohne die Erkennung scheitern 3 Fälle). Folge: `buildGitRepoRef` ist verdrahtet
(war fälschlich ausgenommen), `search`/`tokenize` aus `local-search.ts` nicht
(galten fälschlich als benutzt). `offerMatches` war nur über einen unbenutzten
Import „verdrahtet“, der in Teil a wegfiel – jetzt begründet ausgenommen.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 167 grün · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 48. `app.ts` aufteilen, Teil b: Kommunikation (Schritt 1.0)

**Teil b:** 46 Deklarationen nach `shell/tabs/kommunikation.ts` (1.003 Zeilen):
Räume mit Kanälen und Moderation, Anhänge (inline, Blob-Netz, Blossom), das
Umschalten zwischen Direktnachrichten und Raum, der Chat-Tab mit NIP-17-DMs und
Communities. `app.ts`: 5.402 → 4.419 Zeilen. `boot()` liest `conversations` und
`activeConversation` nur, schreibt sie nie – deshalb konnten beide mit dem Code,
der sie schreibt, umziehen. `loadTrust` (Earn) und `wireSubtabs` (alle Tabs)
bleiben in `app.ts`.

**Nur Verschiebungen – belegt:** Alle 225 Deklarationen stehen wörtlich in genau
einer Datei; 11 haben ein `export` bekommen; keine neue. Als Menge unterscheiden
sich die Zeilen nur in vier dynamischen Importpfaden, die im Unterordner eine
Ebene länger sind (`../blob-client.js` → `../../blob-client.js`). 17
innerHTML-Ausnahmen tragen jetzt den neuen Dateinamen, Begründungen unverändert.

**Test angepasst, nicht abgeschwächt:** `dm-verdrahtung.test.ts` las nur
`app.ts`. Er liest jetzt die ganze Shell – die Prüfung „nirgends ein Kind-4-Event“
deckt damit mehr ab als vorher. Gegenprobe: ein eingeschleustes Kind-4-Event in
`kommunikation.ts` und ein umbenanntes `buildPrivateDm` machen je einen Test rot.

**Klicktest Kommunikation (neu, im Scratchpad):** Community und DM anlegen, Chat
öffnen, mobil zurück, DM-Modus, Raum beitreten – veröffentlichte und neue Fassung
mit gleichem Ergebnis, ohne Skriptfehler.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 167 grün · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 49. `app.ts` aufteilen, Teil c: Agent (Schritt 1.0)

**Teil c:** 62 Deklarationen in zwei Dateien. `shell/tabs/agent.ts` (1.380 Zeilen):
Aufträge stellen (`askAi`, Ausfallsicherung, Race, Schwarm, Video), Antworten,
Belege, Reklamation, Zahlungsprüfung, Tipp-Anzeige, Modellwahl, lokaler Verlauf,
Werkzeug-Chips und Anhang. `shell/tabs/agent-netz.ts` (162 Zeilen): die
Unter-Reiter „Modelle“ und „Repos“. Die Teilung ist nötig, weil `agent.ts` mit
beiden bei rund 1.530 Zeilen läge – über der Grenze der Karte. `app.ts`:
4.419 → 2.927 Zeilen. `lastProviderModel` ist mit `handleAnswer` umgezogen, das
die Variable schreibt.

**Import-Kreis mit `app.ts`:** `handleAnswer` ruft Nachfolge, Onboarding,
Abzeichen und Mitwirkende auf, eine Fehlermeldung `switchTab("wallet")`. Diese
Funktionen liegen (noch) in `app.ts`. Harmlos, weil nur zur Laufzeit aufgerufen:
Auf Modulebene ruft `agent.ts` nichts aus `app.ts` auf, und `boot()` läuft erst,
wenn das ganze Bündel geladen ist (`build.mjs`: `window.freedomApp.boot()` am
Ende). Mit Teil d und e fallen alle bis auf `switchTab` weg; `switchTab` ruft
jeden Tab auf und bleibt in `app.ts`.

**Nur Verschiebungen – belegt:** Alle 225 Deklarationen wörtlich in genau einer
Datei; 22 haben ein `export` bekommen; keine neue. Als Menge unterscheiden sich
die Zeilen nur in einem dynamischen Importpfad (`../blob-client.js` →
`../../blob-client.js`). 28 innerHTML-Ausnahmen tragen den neuen Dateinamen,
Begründungen unverändert.

**Klicktest Agent (neu, im Scratchpad):** Beispiel übernehmen, Modellmenü,
Werkzeug-Chips, Modelle und Repos laden, Senden ohne Netz, neue Aufgabe und
Verlauf – veröffentlichte und neue Fassung mit gleichem Ergebnis, ohne
Skriptfehler.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 167 grün · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 50. `app.ts` aufteilen, Teil d: Währung und Earn (Schritt 1.0)

**Teil d:** 31 Deklarationen. `shell/tabs/waehrung.ts` (763 Zeilen): Guthaben,
Tausch sats ↔ SOL mit Einlösen und Swap-Sicherung, Solana-Wallet, Lightning über
NWC, SOL-Deposits mit Rückforderung, `addZapButton`. `shell/tabs/earn.ts` (432
Zeilen): Einnahmen, Vertrauensstufe (`loadTrust`), Rangliste, Belohnungen,
Mitwirkende, Abdeckungskarte, Werben. `app.ts`: 2.927 → 1.763 Zeilen.
`ladeAbdeckung`/`trageAbdeckungEin` stehen in `earn.ts`, weil ihre Oberfläche im
Earn-Reiter „Karte“ liegt; `wireMeshTab` (Settings) ruft sie von dort auf.
`agent.ts` holt `zeigeMitwirkende` jetzt aus `earn.ts` statt aus `app.ts` – der
Import-Kreis mit `app.ts` ist damit um einen Namen kleiner.

**Nur Verschiebungen – belegt:** Alle 225 Deklarationen wörtlich in genau einer
Datei; 20 haben ein `export` bekommen; keine neue. Als Menge unterscheiden sich
die Zeilen nur in acht dynamischen Importpfaden (`../swap-client.js`,
`../solana-connect.js`, `../sol-htlc.js`, `../lightning-wallet.js` → eine Ebene
länger). 26 innerHTML-Ausnahmen tragen den neuen Dateinamen.

**Klicktest Währung/Earn (neu, im Scratchpad, ohne Netz und ohne Geld):** alle
Unter-Reiter, Aktualisieren, NWC mit kaputter URI, Solana verbinden, Swap-Sicherung
und Einlösen, Deposit starten und zurückfordern, Werben, Belohnung anfordern,
Abdeckung – Texte und Meldungen gesammelt. Ein erster Vergleich zeigte eine
Meldung nur in der alten Fassung. Ursache war die Wartezeit des Tests, nicht der
Code: Auch die alte Fassung zeigte sie nur in einem von drei Läufen. Mit 8 s
Wartezeit liefern beide Fassungen in drei Läufen jeweils dasselbe Ergebnis.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 167 grün · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 51. `app.ts` aufteilen, Teil e: Profil, Settings, Datenschutz – 1.0 Code fertig

**Teil e:** 30 Deklarationen. `shell/tabs/profil.ts` (213 Zeilen): Profil,
Vorschau, Abzeichen. `shell/tabs/settings.ts` (725 Zeilen): Nachfolge,
verschlüsselte Sicherung, Schlüsselwechsel, Geräte, Mesh, Sicherheitsstand,
Gebühren, App-Export und Echtheitsprüfung (`TRUSTED_SIGNERS`).
`shell/datenschutz.ts` (69 Zeilen): `zeigeDatenschutz` und `DMS_GIFT_WRAPPED`.
`app.ts`: 1.763 → 792 Zeilen. In `app.ts` bleiben `boot()`, `switchTab()`,
`wireSubtabs()`, Identität (Erzeugen, Sicherungsdialog, Export/Import),
Onboarding, Sprache und Kopierknöpfe. `agent.ts` holt Nachfolge und Abzeichen
jetzt aus `settings.ts`/`profil.ts`; aus `app.ts` importiert es nur noch
`switchTab` und `zeigeOnboarding`.

**Nur Verschiebungen – belegt:** Alle 225 Deklarationen wörtlich in genau einer
Datei; 11 haben ein `export` bekommen; keine neue. Als Menge unterscheiden sich
die Zeilen nur in acht Importpfaden (`../mesh-radio.js`, `../identity.js` → eine
Ebene länger). 14 innerHTML-Ausnahmen tragen den neuen Dateinamen.

**Anleitungen nachgezogen:** `START.md`, `GO-LIVE.md`, `ANFANGEN.md` und die
Karte 0.D nennen für `TRUSTED_SIGNERS` jetzt `tabs/settings.ts`;
`agent/ANLEITUNG-INTEROP.md` sucht `buildPrivateDm` in `tabs/kommunikation.ts`
(seit Teil b dort – dort hätte die Vorabprüfung sonst fälschlich „0 = STOPP“
gemeldet); `README.md` nennt die Shell statt nur `app.ts`.

**Klicktest Profil/Settings (neu, im Scratchpad):** Profil bearbeiten und
speichern, Abzeichen, alle sieben Settings-Reiter, Sicherung, Schlüsselwechsel,
Nachfolge, Gerät hinzufügen, RPC-Prüfung, Gebühr speichern, Mesh, App-Export,
Echtheitsprüfung, Netzmodus – dazu der vollständige Text des
Datenschutzberichts. Ein Lauf zeigte beim Status der Echtheitsprüfung einen
Unterschied; auch hier war es die Wartezeit des Tests (Relay-Abfrage ohne Netz).
Mit 8 s Wartezeit liefern alte und neue Fassung in drei Läufen dasselbe Ergebnis.
Die Klicktests für Kommunikation, Agent und Währung/Earn laufen auf dem Endstand
ebenfalls gleich.

**1.0 insgesamt:** `app.ts` 5.816 → 792 Zeilen in fünf Pull Requests (#8–#12);
größte Datei `tabs/agent.ts` mit 1.376 Zeilen, keine über 1.500. Jeder Teil
belegt: nur Verschiebungen. Offen ist nur die MENSCH-Aufgabe der Karte: einmal
alle Tabs im Browser anklicken, auf Desktop und Handy.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 167 grün · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 52. Tresor, Teil a: `vault.ts` (Schritt 1.2)

**Aufteilung von 1.2** (zusammen deutlich über 400 Zeilen): a Tresor-Baustein
mit Tests (dieser Teil) · b Start-Dialog (anlegen, entsperren, „Passphrase
vergessen“ über die 12 Wörter) und der private Schlüssel `freedom.nsec` mit
geprüfter Migration, dazu ein Speicher-Scan im Smoke-Test · c weitere
Geheimnisse (NWC-URI, Swap-Geheimnisse, Chats, Agent- und Swap-Verlauf) ·
d automatische Sperre nach 15 Minuten (einstellbar), Passkey mit PRF optional.

**Teil a:** `packages/app/src/vault.ts` nach der Karte – `createVault`,
`unlock`, `lock`, `get`, `set` (dazu `delete`, `keys`, `vaultExists`).
PBKDF2-SHA256 mit 600.000 Iterationen und 16 Byte Salt, AES-GCM 256 mit neuer
12-Byte-IV bei jedem Schreiben, ein Blob in IndexedDB. Der Kopf ist AAD. Nur
WebCrypto, keine neue Abhängigkeit, kein WASM. Über die Karte hinaus, jeweils
begründet: weniger als 600.000 Iterationen im Kopf werden abgelehnt, bevor
abgeleitet wird (kein Herabstufen); `createVault` überschreibt nie einen
vorhandenen Tresor; Passphrase mindestens 8 Zeichen und NFC-normalisiert;
Schreibvorgänge laufen nacheinander.

**Tests (12, neu in `app/test/vault.test.ts`):** Rundreise, falsche
Passphrase, manipulierter Geheimtext und Tag, manipulierter Kopf, Herabstufen
(gezählt: 0 Ableitungen), kaputte Blobs, Speicher-Scan (kein Schlüssel, keine
NWC-URI, kein Schlüsselname, keine Passphrase im Blob), neue IV je Schreiben,
gesperrt, Anlegen, gleichzeitiges Schreiben, NFC. Gegenproben: ohne
Mindest-Iterationen, mit fester IV, mit Überschreiben, ohne NFC und mit
ungeordnetem Schreiben wird jeweils ein Test rot.

**Noch nicht verdrahtet** – das ist Teil b. Die Oberfläche und die Texte der App
ändern sich in Teil a nicht.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 179 grün (+12) · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 53. Tresor, Teil b: verdrahtet – Einrichten, Entsperren, „vergessen“ (Schritt 1.2)

**Entscheidung (24.09.2026, im Chat):** erst benutzen, dann einrichten. Die
Karte verlangt „Entsperr-Dialog beim Start“ und die Migration „beim ersten
Start“; die Führung (`zeigeOnboarding`) fragt aber ausdrücklich erst nach der
ersten Nutzung. Umgesetzt: Der Tresor ist Schritt 5 der Sicherheitsliste und der
Schritt „tresor“ der Führung (nach der Sicherung, vor Wallet und Verdienen –
Wallet-Zugänge kommen in Teil c in den Tresor). Wer ihn eingerichtet hat,
entsperrt bei jedem Start. „Spätestens vor Geld-Geheimnissen verlangt“ kommt mit
Teil c, wenn NWC, Swaps und Deposits in den Tresor wandern.

**Neu `shell/tresor.ts`:**
- `boot()` entsperrt zuerst, wenn es einen Tresor gibt (Merker `freedom.vault`
  oder – falls localStorage geleert wurde – der Blob in IndexedDB); erst danach
  startet die App wie bisher (`starte()`). Vor dem Entsperren ist die Seite leer.
- Einrichten: Passphrase zweimal, mindestens 8 Zeichen. `freedom.nsec` wandert
  mit `uebernehme()` (neu in `vault.ts`) hinein: setzen, den Tresor neu
  entschlüsseln, vergleichen, erst dann den Klartext löschen. Scheitert etwas,
  wird der neue Tresor gelöscht und alles bleibt wie vorher. Ohne Schlüssel in
  localStorage wird nichts eingerichtet (sonst entstünde beim nächsten Start eine
  neue Identität).
- „Passphrase vergessen?“: 12 Wörter oder nsec über `importIdentity()`, neue
  Passphrase; der alte Tresor wird gelöscht, ein neuer angelegt. Wer alle zwölf
  Wörter eintippt, gilt als gesichert.
- Schlüssel lesen/schreiben (`ladeSchluessel`/`speichereSchluessel`): aus dem
  Tresor, wenn es einen gibt, sonst wie bisher aus localStorage.

**Weitere Änderungen:** `identity.ts`/`backupStatus()` zählt den Schlüssel im
Tresor als vorhanden (sonst verschwände die Sicherungswarnung); Sicherheitsliste
jetzt 5 Schritte („Zwei der fünf Schritte gehen nur vorher.“); `docs/SCHLUESSEL.md`
um die Aufbewahrung ergänzt. Die Dialoge setzen nur feste Texte per innerHTML
(eine begründete Ausnahme), Eingaben und Meldungen über textContent.

**Tests:** app 179 → 185 – `uebernehme()` (Rundreise; scheitert die Kontrolle,
bleibt der Klartext), `backupStatus()` mit Tresor (Gegenprobe: alter Code rot),
Führung: Tresor erst nach erster Nutzung und Sicherung, vor Wallet und
Verdienen. **Smoke-Test** um den ganzen Ablauf erweitert: Merkphrase bestätigen,
Tresor einrichten, Speicher-Scan (Schlüssel weder in localStorage noch im Blob),
neu laden (gesperrt, ohne Identität), falsche und richtige Passphrase, „vergessen“
mit den 12 Wörtern – dieselbe Identität. Gegenprobe: ohne Übernahme scheitern
Speicher-Scan und Identitätsvergleich. Klicktests: ohne Tresor unverändert bis auf
die fünfte Stufe der Sicherheitsliste.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 185 grün (+6) · 0 rot · check-wiring `--streng` 0 offen (176 begründet) ·
innerHTML streng 0 unbewertet (101 begründet) · Smoke-Test bestanden (mit Tresor).

## 54. Tresor, Teil c: alle Geheimnisse im Tresor, Pflicht vor Geld (Schritt 1.2)

**Neu `geheimSpeicher()` in `vault.ts`**, in der App als `geheim`
(`shell/tresor.ts`): Mit Tresor liest und schreibt er dort, ohne Tresor wie
bisher in localStorage. Ist der Tresor eingerichtet, aber nicht offen, weicht er
nie auf localStorage aus – Lesen liefert nichts, Schreiben scheitert laut.

**Umgestellt auf `geheim`:** Wallet-Verbindung `freedom.nwc.uri`
(`waehrung.ts`), Preimages von Swaps (`swap-client.ts`, jetzt mit einsetzbarem
Speicher; `saveSwapSecret`/`forgetSwapSecret` awaitbar – erst wenn das Preimage
liegt, geht es weiter) und Deposits (`freedom.htlc.*`), Unterhaltungen
(`kommunikation.ts`), Agent-Verlauf (`agent.ts`), Swap-Adressverlauf (auch im
Datenschutzbericht). Beim Einrichten wandern alle diese Werte geprüft mit
(`geheimnisse()`).

**Tresor-Pflicht vor Geld-Geheimnissen** (Entscheidung zu 1.2):
`verlangeTresor()` vor dem Speichern einer NEUEN Wallet-Verbindung (erst nach
dem Einlesen der URI, damit eine kaputte URI ihren eigenen Fehler zeigt), vor dem
Speichern von Adressverlauf und Preimage beim Tausch, vor dem Sperren beim
Deposit – jeweils nach den günstigen Prüfungen (Wallet verbunden, Betrag,
Provider). Der Dialog nennt den Grund. Wer abbricht, verbindet nicht bzw. startet
nichts. Eine schon gespeicherte Verbindung verbindet sich weiter still neu.
Nach gelungenem Einlösen bzw. Zurückholen darf das Aufräumen des Geheimnisses
den Erfolg nicht als Fehler melden.

**Tests:** app 185 → 189 – Geheimspeicher ohne Tresor, mit offenem und mit
gesperrtem Tresor (kein Ausweichen); Preimage-Ablage mit eingesetztem Speicher
(nichts in localStorage, Verlauf zählt nicht als Preimage). **Smoke-Test:**
Altbestand aus sechs Geheimnissen vor dem Einrichten; danach steht keiner der
Werte und keiner der Namen in localStorage oder im Blob; nach dem Entsperren
sind Chat und Verlauf wieder da; ohne Tresor wird eine neue NWC-Verbindung nicht
gespeichert, der Dialog nennt die Wallet-Verbindung. Gegenproben: ohne
Übernahme der Chats scheitern Scan und Anzeige; ohne Pflicht scheitert die
Pflichtprüfung. Klicktests unverändert gleich der veröffentlichten Fassung.
`CLAUDE.md`: neuer Fallstrick „Geheimnisse nur über `geheim`“.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 189 grün (+4) · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng
0 unbewertet · Smoke-Test bestanden (Tresor mit allen Geheimnissen, Pflicht vor NWC).

## 55. Tresor, Teil d: automatische Sperre – 1.2 Code fertig (Schritt 1.2)

**Automatische Sperre** (Karte 1.2, Schritt 3): nach 15 Minuten ohne Eingabe
(Tippen, Klicken, Scrollen, Berühren), einstellbar unter Settings → Sicherheit →
Tresor (0 = nie), dazu „jetzt sperren“. Gesperrt wird durch Neuladen – das
räumt jeden entschlüsselten Wert aus dem Speicher der Seite, danach fragt der
Start wieder nach der Passphrase. Nie gesperrt wird, während ein Tausch, ein
Deposit (`geldVorgangLaeuft()`, neu in `waehrung.ts`) oder ein KI-Auftrag läuft
– mitten hinein zu sperren könnte Geld festhalten. Die Entscheidung steckt in
der reinen Funktion `sollSperren()` (`vault.ts`), die Einstellung liest
`sperrMinuten()`; die Karte in den Settings ist nur mit Tresor sichtbar.

**Tests:** app 189 → 192 – Schwelle (15 min − 1 ms offen, 15 min gesperrt),
0 = nie, gesperrt bleibt gesperrt, laufender Geldvorgang, Einstellung mit
Unsinn. **Smoke-Test** mit gesteuerter Uhr: nach 14 Minuten offen, nach 16
gesperrt, während eines Auftrags auch nach 40 Minuten offen, mit 0 auch nach 3
Stunden offen. Gegenprobe: ohne `starteAutoSperre()` fällt der Smoke-Test durch.

**Instabilität im Test – Ursache gefunden, nicht weggewiesen:** Der erste
Entwurf fiel in etwa einem von fünf vollen Smoke-Läufen durch. Messung im
Fehlerfall: `Date.now()` stand 300 ms nach `fast_forward("14:00")` wieder beim
Ausgangswert – Playwrights frei laufende Uhr hatte den Sprung verloren. Mehr
Wartezeit änderte nichts (widerlegte Vermutung „verpasster Takt“). Abhilfe: Uhr
nach dem Einrichten anhalten (`pause_at`). Dabei zweiter Fund: Die Python-API
liest eine Zahl als Sekunden (die Uhr sprang Jahrtausende vor und sperrte schon
nach 14 Minuten) – jetzt mit `datetime`. Danach 10 von 10 vollen Läufen grün.
Beides steht als Fallstrick in `CLAUDE.md`.

**Passkey (Karte 1.2, Schritt 2, optional):** zurückgestellt. Er bräuchte
Schlüssel-Umhüllung (zweiter Weg zum selben Datenschlüssel) und damit ein neues
Tresor-Format; Headless-Tests mit PRF sind aufwendig. Nichts in App oder Texten
behauptet einen Passkey.

**1.2 insgesamt (Code fertig):** Tresor mit AES-GCM 256 und PBKDF2-SHA256
600.000; alle Geheimnisse der Karten-Suche liegen mit Tresor nur verschlüsselt
in IndexedDB; Einrichten nach der ersten Nutzung (Entscheidung), Entsperren beim
Start, „Passphrase vergessen“ über die 12 Wörter, Pflicht vor Geld-Geheimnissen,
automatische Sperre. Offen (MENSCH): Entsperren auf Handy und Desktop, „vergessen“
mit echten 12 Wörtern, Swap und Deposit einmal auf Devnet.

Endstand: protocol 947 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 192 grün (+3) · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng
0 unbewertet · Smoke-Test 10/10 bestanden (Tresor, Pflicht, Sperre).

## 56. Signer-Schnittstelle, Teil a: `signer.ts` und `LocalSigner` (Schritt 1.3)

**Entscheidung (24.09.2026, im Chat):** Die Karte verlangt einen `Nip46Signer`
„aus vorhandenen Teilen in `devices.ts`“ – dort gibt es keine: `devices.ts` hat
sich bewusst gegen NIP-46 entschieden (eigene Gerätschlüssel, offline). Auf
Nachfrage: „passend entscheiden, ohne viel am Plan zu ändern“. Also bleibt es bei
der Karte: `Nip46Signer` wird neu nach dem NIP-46-Standard gebaut (Teil b), der
Verweis auf `devices.ts` war ungenau.

**Aufteilung von 1.3:** a Schnittstelle und `LocalSigner` (dieser Teil) · b
`Nip46Signer` · c… Aufrufer modulweise umstellen, bis `keypair.sk` nur noch im
`LocalSigner` steht (heute 46 Stellen in 11 Dateien).

**Teil a:** neu `packages/protocol/src/signer.ts` – `Signer` (publicKey,
signEvent, nip44Encrypt, nip44Decrypt), `SolanaSigner` (publicKey,
signTransaction), `LocalSigner`. Der Schlüssel steckt in einem privaten
Klassenfeld und ist eine Kopie; `toJSON()` zeigt nur den Pubkey. Fremde Pubkeys
werden vor jeder NIP-44-Rechnung auf genau 64 Hex-Zeichen geprüft; ein Event mit
fremdem pubkey wird nicht signiert. In der App: `state.signer` und
`setzeIdentitaet(sk)` (`shell/state.ts`) – die drei Stellen in `app.ts`, die bisher
`state.keypair` direkt setzten, gehen jetzt darüber; Schlüssel und Signer
entstehen immer gemeinsam.

**Tests:** protocol 947 → 955 – gleiche Event-ID wie `signEvent`, fremdes Event
abgelehnt, NIP-44 in beide Richtungen kompatibel mit `encryptDM`/`decryptDM`,
Manipulation und falscher Peer scheitern, sechs ungültige Pubkeys abgelehnt, der
Schlüssel taucht in keiner Darstellung auf (JSON, Spread, Einträge, String),
Kopie statt Referenz, falsche Schlüssellänge.

Endstand: protocol 955 grün (5 übersprungen) · node 161 grün (6 übersprungen) ·
app 192 grün · 0 rot · check-wiring `--streng` 0 offen (252 verdrahtet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 57. Signer-Schnittstelle, Teil b: `Nip46Signer` (Schritt 1.3)

Neu `packages/protocol/src/nip46.ts` nach dem NIP-46-Standard – eigenständig,
`devices.ts` hat dafür keine Teile (siehe Abschnitt 56). `parseBunkerUri()`
liest `bunker://<signer-pubkey>?relay=wss://…&secret=…` streng (64 Hex-Zeichen,
nur wss://-Relays). Der `Nip46Signer` erzeugt einen Wegwerf-Schlüssel (als
`LocalSigner`), schickt Anfragen als Kind 24133 an den Signer, Inhalt
NIP-44-verschlüsselt ({id, method, params}), und fragt die Antwort über
`publish`/`query` ab – das passt zum `OutboxPool` der App.

**Dem Signer nicht blind glauben:** Antworten zählen nur vom Signer-Pubkey, mit
gültiger Signatur, entschlüsselbar und mit passender id. Ein signiertes Event
muss genau das angefragte sein (kind, Inhalt, Tags, Zeit, Nutzer-Pubkey) und
gültig signiert. `auth_url` wird mit der Adresse gemeldet, nichts wird
automatisch geöffnet. Fremde Pubkeys werden vor NIP-44 geprüft; ein Event mit
fremdem pubkey geht gar nicht erst an den Signer.

**Tests (9, Test-Bunker im Speicher, das Test-Relay liefert wie ein böswilliges
Relay alles):** verbinden mit Secret, signieren, NIP-44 in beide Richtungen
kompatibel mit direkt verschlüsselten Nachrichten; Relays sehen weder Methode
noch Inhalt; ein Bunker, der etwas anderes signiert, wird entlarvt; fremder
Absender, falsche id und Schweigen enden in „Keine Antwort“; Ablehnung,
Freigabe-Adresse und falsches Secret werden gemeldet; strenges Lesen der
Adresse; der Wegwerf-Schlüssel taucht in keiner Darstellung auf. Gegenproben:
ohne Ereignis-Vergleich, ohne id-Prüfung und ohne pubkey-Prüfung wird jeweils
ein Test rot. Ohne die ausdrückliche Absenderprüfung bleibt alles grün – eine
Antwort von fremdem Absender lässt sich mit dem Signer-Schlüssel ohnehin nicht
entschlüsseln (MAC); die Prüfung ist eine zusätzliche Sicherung.

**Verdrahtung:** Anmelden per Bunker in der Oberfläche erst, wenn alle Aufrufer
den Signer nutzen – bis dahin begründet in `scripts/wiring-ausnahmen.txt`
(`Nip46Signer`, `parseBunkerUri`).

Endstand: protocol 964 grün (+9, 5 übersprungen) · node 161 grün · app 192
grün · 0 rot · check-wiring `--streng` 0 offen (178 begründet) · innerHTML
streng 0 unbewertet · Smoke-Test bestanden.

## 58. Signer-Schnittstelle, Teil c: Signieren über den Signer (Schritt 1.3)

**Aufteilung (verfeinert):** c reine Signier-Stellen (dieser Teil) · d
NIP-17-DMs über den Signer · e Stellen, die den rohen Schlüssel wirklich
brauchen (Sicherung, Nachfolge, Swap-Adressen, Export), ausdrücklich über den
`LocalSigner`; `sk` fällt aus `state.keypair` · f Anmelden per Bunker.

**Teil c:** `signiere(ev)` in `shell/state.ts` signiert über `state.signer`.
32 Stellen der Form `signEvent(X, state.keypair.sk)` / `se(X, …)` in den Tabs
und `app.ts` sind per Skript (Klammern gezählt, nur genau diese Form)
umgeschrieben; die Typprüfung hat jede Stelle außerhalb von `async` gemeldet –
dafür ist `buildJobEvent` (Agent) jetzt `async`, das Rennen mehrerer Provider
nutzt `Promise.all`. `SessionClient` bekommt statt `keypair` einen `signer`
(zwei Stellen), die SDK-Klassen in `client.ts` ebenso (zwei Stellen);
`chat-zap.ts` signiert über `signiere` (eine Stelle). Nur die dadurch
unbenutzten Importe (`signEvent`, `signEvent: se`, `toHex`, `schnorr`) sind
entfernt, ältere unbenutzte bleiben.

**Fehler nebenbei behoben:** `chat-zap.ts` las Absender und Schlüssel aus
`window.state` – das gab es nie (der Name `state` ist dort der Zustand des
Dialogs). Ein Zap brach deshalb beim Bau der Zap-Anfrage ab. Jetzt kommt der
App-Zustand als `appState` aus `shell/state.ts`.

**Zahlen:** `grep -rn "keypair.sk" packages/app/src | wc -l` 46 → 9; übrig sind
nur Stellen, die den rohen Schlüssel wirklich brauchen oder die DMs (Teil d/e).

**Tests:** app 192 → 194 – `SessionClient` signiert über den Signer (gültige
Signatur, richtiger Pubkey) und trägt den Schlüssel in keiner Darstellung (vorher
stand er als Zahlenobjekt `"sk":{"0":…}` darin). Klicktests Kommunikation,
Agent (Senden ohne Netz), Währung/Earn und Settings: gleich wie die
veröffentlichte Fassung.

Endstand: protocol 964 grün (5 übersprungen) · node 161 grün · app 194 grün
(+2) · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 59. Signer-Schnittstelle, Teil d: NIP-17 über den Signer (Schritt 1.3)

**Protokoll:** `giftWrapMitSigner` und `giftUnwrapMitSigner` (`gift-wrap.ts`)
versiegeln bzw. öffnen über einen `Signer` – Siegel verschlüsseln und signieren,
Umschlag und Siegel entschlüsseln; der Wegwerf-Schlüssel des Umschlags bleibt
lokal. Die bisherigen `giftWrap`/`giftUnwrap` mit rohem Schlüssel sind dünne
Hüllen darum (mit `LocalSigner`), sodass die vorhandenen Gift-Wrap-, NIP-17-
und Interop-Tests den neuen Kern prüfen. `buildPrivateDm` nimmt zusätzlich
`{ signer }`, `openPrivateDm(wrap, signer)` zusätzlich zu `(wrap, sk, pk)`; die
Namen bleiben, damit `dm-verdrahtung.test.ts` (prüft auf `buildPrivateDm(`)
unverändert gilt. Neu geprüft: Schlüssel und Pubkey müssen zusammenpassen
(vorher wurde ein unpassender Pubkey still übernommen). Reihenfolge der
Zeitversätze (Siegel, dann Umschlag) ist unverändert.

**App:** `kommunikation.ts` sendet und öffnet DMs über `state.signer`
(`keypair.sk` 9 → 7). `giftWrap`/`giftUnwrap` sind begründet ausgenommen – die
App nutzt die Signer-Varianten, die Hüllen tragen die Tests.

**Tests:** protocol 964 → 968 – Siegel über einen zählenden Signer (genau
zweimal verschlüsseln und signieren je DM), Öffnen über den Signer, in beide
Richtungen kompatibel, Carol liest nicht mit; Schlüssel/Pubkey passen nicht →
abgelehnt; **DM über den Test-Bunker** (NIP-46) hin und zurück, ganz ohne
lokalen Schlüssel. Browser: DM senden ohne Netz – alte und neue Fassung bauen
die Umschläge und melden nach 6–7 s dasselbe („Kein Relay hat das Event
angenommen“); ein erster Unterschied lag an zu kurzer Wartezeit im Test.

Endstand: protocol 968 grün (+4, 5 übersprungen) · node 161 grün · app 194
grün · 0 rot · check-wiring `--streng` 0 offen (180 begründet) · innerHTML
streng 0 unbewertet · Smoke-Test bestanden.

## 60. Signer-Schnittstelle, Teil e: der rohe Schlüssel nur noch im Signer (Schritt 1.3)

**Protokoll:** `LocalSigner.mitSchluessel(fn)` ist der einzige Weg an den
rohen Schlüssel – für das, was nur mit ihm geht. `fn` bekommt eine Kopie, die
danach genullt wird; nur synchron, denn bei einem Promise wäre die Kopie beim
Weiterlaufen schon gelöscht. Ein entfernter Signer kann das grundsätzlich
nicht, darum steht es nicht in der Schnittstelle `Signer`.

**App:** `state.keypair` hält nur noch `{ pk }`; der Schlüssel steckt allein im
`LocalSigner`. `mitRohemSchluessel(wofuer, fn)` (`shell/state.ts`) leiht ihn
und sagt mit einem Bunker klar ab („… geht nur mit dem Schlüssel auf diesem
Gerät“). Umgestellt: Nachfolge (Shamir-Teile und Hash in einem Aufruf),
Zustandssicherung und Wiederherstellung (`deriveBackupKey`), frische
Swap-Adresse (`deriveSwapAddress`), Sicherungsdatei und Export. `keypair.sk`
7 → 0. Dabei gefunden: vier Stellen, die den Schlüssel verdeckt nutzten, weil
sie `state.keypair` als Ganzes weitergaben – der Blob-Upload (Anhänge und
Git-Bundles; `uploadBlob` nimmt jetzt einen `Signer`), das Lesen alter
Kind-4-DMs (jetzt `signer.nip44Decrypt`, dieselbe Rechnung) und das
Veröffentlichen der DM-Relay-Liste (jetzt `signiere`). Der Zähler aus 1.3c
(46 → 9) hatte sie nicht erfasst.

**Fund (nicht behoben, bei 8.1 vermerkt):** `#onboarding-bar` und
`#backup-warn` stehen in keinem HTML – die Onboarding-Leiste und die
Sicherungs-Erinnerung erscheinen nie. Die Sicherheitsliste in den Settings
funktioniert.

**Tests:** protocol 968 → 971 (Kopie wird genullt, Änderungen an ihr treffen
den Signer nicht, asynchrone Rechnung und Fehler – Kopie trotzdem genullt);
app 194 → 200 (`rohschluessel.test.ts`: kein `keypair.sk` in `src/`, Zustand
nur mit Pubkey, `mitRohemSchluessel` rechnet lokal und sagt mit entferntem
Signer ab, ohne `fn` aufzurufen; `uploadBlob` signiert jeden Chunk und das
Manifest über den Signer, bei Absage geht nichts ins Netz). Browser: Export
kopiert genau den gespeicherten Schlüssel, die Sicherungsdatei enthält ihn
als nsec (dekodiert verglichen).

Endstand: protocol 971 grün (+3, 5 übersprungen) · node 161 grün · app 200
grün · 0 rot · check-wiring `--streng` 0 offen (180 begründet) · innerHTML
streng 0 unbewertet · Smoke-Test bestanden.

## 61. Signer-Schnittstelle, Teil f: Anmelden per Bunker – 1.3 Code fertig

**Protokoll:** `Nip46Signer` nimmt mit `nutzer` (und demselben `clientSk`) eine
frühere Sitzung ohne neues `connect()` wieder auf; ein ungültiger Pubkey wird
abgelehnt.

**App:** Neu `shell/bunker.ts` mit der Karte „Anmelden per Bunker (NIP-46)“
unter Settings → Geräte. `bunker://`-Adresse eingeben → `connect` über einen
eigenen Pool zu den Relays des Bunkers → die Sitzung (Signer-Pubkey, Relays,
Client-Schlüssel, Nutzer) liegt über `geheim` unter `freedom.bunker`, mit
Tresor verschlüsselt (`geheimnisse()` ergänzt). Das `secret` der Adresse wird
nicht gespeichert. Danach lädt die App neu; `loadOrCreateIdentity()` nimmt die
Sitzung vor dem lokalen Schlüssel auf – ohne Netz. Der Schlüssel auf dem Gerät
bleibt liegen, „abmelden“ löscht die Sitzung und bringt ihn zurück. Während ein
Tausch, ein Deposit oder ein Auftrag läuft, wird nicht gewechselt.

Mit Bunker gibt es keinen rohen Schlüssel (`mitBunker()`): „jetzt sichern“,
„wiederherstellen“ und Nachfolge „einrichten“ sind gesperrt (die
Sicherheitsliste sagt warum), Sicherungsdatei und Export melden „geht nur im
Signer“, Import verlangt erst das Abmelden, der Swap fragt ohne Vorschlag einer
abgeleiteten Adresse.

**Fund, behoben:** „jetzt sichern“, „wiederherstellen“, „Diebstahl vorbeugen“,
„Schlüssel widerrufen“, „Gerät hinzufügen“ und „für jemand anderen melden“
wurden erst am Ende von `richteNachfolgeEin()` verdrahtet – so stand es schon in
der Übergabe. Ohne eingerichtete Nachfolge taten die Knöpfe nichts, auch die
Schritte 2 und 3 der Sicherheitsliste liefen ins Leere. Jetzt verdrahtet
`wireSicherheitsKnoepfe()` sie beim Start.

**Tests:** protocol 971 → 972 (Sitzung wieder aufnehmen); app 200 → 206
(`bunker.test.ts`: verbinden speichert weder Secret noch Nutzer-Schlüssel,
Aufnehmen ohne zweites `connect`, Signieren über den Bunker, kein roher
Schlüssel; falsches Secret speichert nichts; sechs kaputte Sitzungen werden
nicht aufgenommen; abmelden; Verdrahtung). Browser-Durchlauf mit nachgebildetem
Relay (Playwright `route_web_socket`) und einem Test-Bunker aus dem
Protokoll-Code: falsches Secret abgelehnt, Anmeldung, nach dem Neuladen die
Identität des Bunkers, gesperrte Knöpfe mit Begründung, Lebenszeichen über den
Bunker signiert, abmelden → wieder die lokale Identität. `Nip46Signer` und
`parseBunkerUri` sind verdrahtet – ihre Ausnahmen sind entfernt.

Endstand: protocol 972 grün (+1, 5 übersprungen) · node 161 grün · app 206
grün · 0 rot · check-wiring `--streng` 0 offen (178 begründet) · innerHTML
streng 0 unbewertet · Smoke-Test bestanden.

## 62. Leak-Tests, Teil a: Aufzeichnung, Regeln, erste App-Szenarien (Schritt 1.5)

**Regeln** (`protocol/src/leak-rules.ts`), je mit Treffer- und
Nicht-Treffer-Test in `test/leak-rules.test.ts`: kein Klartext-Prompt in
Anfragen (Kind 5000–5999), Kunden-Schlüssel weder Autor noch p-Tag, keine
bolt11 (klein und groß, kurze Wörter wie „lnbc1abc“ zählen nicht), keine
SOL-Adresse des Nutzers, jede SOL-Zahlung an eine frische Adresse, Anhänge nur
verschlüsselt (drei Ausschnitte der Datei als Hex und Base64). `LEAK_REGELN`
nennt alle Regeln mit ihrer Aussage; ein Test prüft, dass jede Regel unter
einem Namen daraus meldet.

**Aufzeichnung** (`app/test/leak/aufzeichnung.ts`): ein Relay mit derselben
Schnittstelle wie der Pool der App (`publish`, `query`, `subscribe`), das jedes
gesendete Event festhält; `aufzeichnung()` liefert einen `OutboxPool` darauf.

**Szenarien** (`app/test/leak/`): DM senden (NIP-17 über den Signer – alle
Regeln grün), Datei anhängen (der echte `uploadBlob`), KI-Anfrage (der echte
`SessionClient` plus die Anfrage wie in `buildJobEvent()`, mit und ohne
Sitzung). Heute verletzt und als `todo` markiert: Anhänge im Klartext (2.4),
Klartext-Prompt (3.1), Kunden-Schlüssel in Job-Events (3.1). Ein
Verdrahtungstest je Szenario prüft, dass die App genau diesen Weg nimmt.
`npm run test:leak` läuft als eigener Schritt in der CI. Nebenbei: `uploadBlob`
nimmt den Pool jetzt mit `NostrEvent` statt `unknown` getypt.

Endstand: protocol 978 grün (+6, 5 übersprungen) · node 161 grün · app 206
grün · Leak-Tests 9 grün + 3 todo · 0 rot · check-wiring `--streng` 0 offen
(184 begründet) · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 63. Leak-Tests, Teil b: alle App-Szenarien, Aussagen mit Regel – 1.5 Code fertig

**Szenarien** (`app/test/leak/`), je mit Verdrahtungstest gegen den Weg der App:
- **Raum-Nachricht:** Kanal eines Raums (`buildChannelMessage`) und
  Community-Chat (Kind 42) – Klartext, `todo` 2.3.
- **Swap starten:** Anfrage Kind 25001 wie in `startSwap()` – keine Rechnung,
  aber die SOL-Empfangsadresse offen neben dem npub, `todo` 4.9.
- **Profil speichern:** Felder wie `sammeln()` – keine SOL-Adresse, keine
  Rechnung (das Formular fragt keine Chain-Adresse ab; lud16 ist gewollt
  öffentlich).
- **Abdeckung eintragen:** `toCell()` vor dem Senden – weder die genaue
  Position noch vier Nachkommastellen im Event, für Funk und Bluetooth.
- **SOL-Zahlung:** zwei Deposits mit dem echten `lockDeposit()` an einer
  **Aufzeichnungs-RPC** (`aufzeichnungsRpc()`: Blockhash, Senden, Bestätigen –
  hält jede Transaktion samt Gebührenzahler fest), dazu die Ankündigung per
  Nostr. Die Wallet-Adresse steht in keinem Nostr-Event; beide Zahlungen kommen
  aber von derselben Adresse, `todo` 4.9.

**Aussagen** (`privacy-facts.ts`): jede verweist mit `regel` auf ihre Regel aus
`LEAK_REGELN`; ohne Regel nur Forward Secrecy und IP-Adresse, die kein
Event-Mitschnitt prüfen kann – ein Test hält genau diese Liste fest. Neu belegt
(mit Szenario in `privacy-facts.test.ts`): „Abdeckungskarte: Nur die gerundete
Zelle verlässt das Gerät, nie der genaue Standort.“ Neu als bekannte Lücken:
KI-Anfragen verraten, wer fragt (3.1); SOL-Adresse in öffentlichen Events und
wiederverwendete Zahladresse (4.9). Der Bericht in der App zeigt sie (im Browser
geprüft). Nebenbei: Der Detailtext der Prompt-Regel hatte einen doppelten
Doppelpunkt.

Endstand: protocol 979 grün (+1, 5 übersprungen) · node 161 grün · app 206
grün · Leak-Tests 21 grün + 6 todo · 0 rot · check-wiring `--streng` 0 offen
(184 begründet) · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 64. Verschlüsselte Job-Anfragen, Teil a: Protokoll (Schritt 3.1)

Aufteilung von 3.1: **a** Protokoll (hier), **b** Knoten (Umschläge abonnieren,
öffnen, Rechenarbeit statt Kontingent), **c** App (Sitzungsschlüssel,
Anfragen im Umschlag, Leak-Regeln grün, `hinweisKiOeffentlich()` weg).

**`protocol/src/private-job.ts`:** `buildPrivateJobRequest()` packt eine
gewöhnliche Anfrage (Kind 5xxx) als Kern in einen Umschlag (NIP-59) an den
Provider – versiegelt vom Sitzungsschlüssel des Kunden, nicht von seiner
Identität. Relays sehen einen Wegwerf-Autor, den p-Tag des Providers und
Chiffrat. Der Umschlag bekommt keinen Zeitversatz (der Provider abonniert nur
die jüngste Zeit; die Empfangszeit sieht das Relay ohnehin) und auf Wunsch
Rechenarbeit (NIP-13, höchstens 24 Bits). `openPrivateJobRequest()` prüft
Günstiges zuerst – Form, p-Tag, Signatur, Rechenarbeit – und entschlüsselt erst
danach; den Kern baut es aus den bekannten Feldern mit Typprüfung neu auf, die
ID rechnet es selbst aus.

**`gift-wrap.ts`:** Option `powBits` – der Umschlag wird vor der Signatur mit
dem Wegwerf-Schlüssel gemined. Ohne die Option (DMs) ändert sich nichts.

**`tiers.ts`:** Das Angebot (Kind 38027) kann `["pow", "<bits>"]` tragen;
beim Lesen zählen nur ganze Zahlen 0–24, alles andere wird ignoriert.

**Tests:** protocol 979 → 985 (`private-job.test.ts`: Provider öffnet genau die
Anfrage, ID stimmt, Autor = Sitzungsschlüssel; Leak-Regeln auf dem Umschlag –
kein Prompt, weder Identität noch Sitzungsschlüssel als Autor oder p-Tag;
fremder Provider und umgelenkter p-Tag scheitern ohne Entschlüsseln;
Rechenarbeit verlangt/geleistet/zu wenig; kein Job, fremder Schlüssel,
kaputter Kern, offenes Event; `pow`-Tag hin und zurück, sechs fremde Werte
ignoriert). Bis 3.1b/3.1c sind die zwei Funktionen begründet ausgenommen.

Endstand: protocol 985 grün (+6, 5 übersprungen) · node 161 grün · app 206
grün · Leak-Tests 21 grün + 6 todo · 0 rot · check-wiring `--streng` 0 offen
(186 begründet) · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 65. Verschlüsselte Job-Anfragen, Teil b: Knoten (Schritt 3.1)

**`node/src/dvm-provider.ts`:** Der Knoten abonniert zusätzlich Umschläge
(Kind 1059) mit seinem p-Tag und fragt sie in `pollOnce()` ab. `handlePrivate()`
öffnet sie mit `openPrivateJobRequest()` – Form, Empfänger, Signatur und
Rechenarbeit werden geprüft, bevor entschlüsselt oder gerechnet wird – und
arbeitet die Anfrage wie bisher ab. Das Ergebnis verweist auf die ID der
Anfrage und geht an den Sitzungsschlüssel (die Antwort selbst ist bis 3.2
noch offen). Dieselbe Anfrage in einem zweiten Umschlag zählt nicht doppelt.
Gratis: Für private Anfragen gibt es kein Kontingent je Schlüssel mehr – der
Schlüssel wechselt je Sitzung, jede Anfrage hat die verlangte Rechenarbeit
geleistet; gratis läuft sie, wenn der Provider überhaupt gratis anbietet
(`gratisErlaubt()`). Offene Anfragen behalten in der Übergangszeit ihr
Kontingent. Absagen (Kind 7000) gehen über das neue `meldeFehler()`, das auch
der offene Weg nutzt.

**`node/src/main.ts`:** `PRIVATE_POW_BITS` (Standard 12, gekappt auf 0–24)
steht im Angebot. Das Angebot baut jetzt eine Funktion für Start und
Erneuern – **Fund, behoben:** Beim Erneuern alle 30 Minuten fehlte bisher die
Speicherangabe; ein Provider mit Speicherrolle verlor sie nach einer halben
Stunde aus seinem Angebot.

**Warum 12 Bits:** gemessen je Umschlag auf einem PC 8 Bits 5 ms, 12 Bits
64 ms, 14 Bits 0,3 s, 16 Bits 1,1 s – auf einem Handy ein Mehrfaches. Für
jede Chat-Nachricht wären 16 Bits zu langsam; der Provider kann erhöhen.

**Tests:** node 161 → 166 (`private-jobs.test.ts`: geöffnet und abgearbeitet,
Ergebnis mit e-Tag der Anfrage und p-Tag des Sitzungsschlüssels; fremder
Empfänger und zu wenig Rechenarbeit verworfen, ohne zu rechnen; drei private
Anfragen gratis ohne Kontingent, offene behalten es; ohne Gratis-Angebot
Absage per Kind 7000 an den Sitzungsschlüssel; derselbe Umschlag und dieselbe
Anfrage neu verpackt zählen einmal). `openPrivateJobRequest` und
`eventDifficulty` sind verdrahtet, ihre Ausnahmen entfernt.

Endstand: protocol 985 grün · node 166 grün (+5, 6 übersprungen) · app 206
grün · Leak-Tests 21 grün + 6 todo · 0 rot · check-wiring `--streng` 0 offen
· innerHTML streng 0 unbewertet · Smoke-Test (App unverändert) bestanden.

## 66. Verschlüsselte Job-Anfragen, Teil c: App – 3.1 Code fertig

**Sitzungsschlüssel** (`app/src/ki-sitzung.ts`): je Provider ein zufälliger
Schlüssel, nicht aus dem Seed, nur im Speicher der Seite. `SessionClient` nimmt
statt eines Signers `signerFuer(provider)`; Sitzung (38021), Belege (38022),
Anfragen und Reklamation (`reklamiere()`) signiert der Sitzungsschlüssel. Zwei
Provider sehen nicht denselben Schlüssel, keiner die Identität. Die Sitzungs-ID
trug bisher die ersten 8 Zeichen der Identität – jetzt die des
Sitzungsschlüssels.

**Anfragen** (`tabs/agent.ts`): `buildJobEvent()` baut die Anfrage wie bisher,
aber mit dem Sitzungsschlüssel als Autor, und gibt den Umschlag aus
`buildPrivateJobRequest()` mit der Rechenarbeit aus dem Angebot zurück. Gesendet
wird nur der Umschlag; Ergebnisse findet die App wie bisher über den e-Tag.
Nur Provider, deren Angebot `pow` nennt (höchstens 16 Bits), kommen in Frage;
einen offenen Bid-Job an alle gibt es nicht mehr – ohne passenden Provider sagt
die App „Kein Provider für private Anfragen gefunden – die Knoten brauchen
mindestens Stand 3.1“ (und `explainError()` deutet das nicht mehr als Timeout).
Race und Swarm legen ihre Tags in den Kern. **Fund, behoben:** Swarm hängte
`["swarm","1"]` nach der Signatur an – die Anfrage war ungültig signiert.

**Entfernt:** `hinweisKiOeffentlich()` (Karte, Schritt 5) und die
Kontingent-Abfrage `refreshQuota()` beim Provider – sie schickte den eigenen
Pubkey in der URL an dessen HTTP-API und ist ohne Kontingent je Schlüssel
gegenstandslos.

**Datenschutzbericht:** „KI-Anfragen sind für Relays nicht lesbar“ und „…
verraten nicht, wer fragt – der Provider sieht nur einen Schlüssel je Sitzung“
sind belegt (Szenario in `privacy-facts.test.ts`); neu als Lücke: „KI-Antworten
sind für Relays nicht lesbar“ (3.2).

**Tests:** app 206 → 207 (`session-client.test.ts`: je Provider eigener
Schlüssel, nie die Identität); Leak-Tests 21 + 6 todo → 23 + 4 todo – die
beiden 3.1-Regeln sind grün, das Szenario folgt dem neuen Weg samt
Verdrahtungstest. **E2E im Browser:** die gebaute App schickt über eine
Relay-Nachbildung eine Anfrage an einen echten `DvmProvider` (Node,
Bootstrap = gratis, 8 Bits): genau ein Umschlag mit Nonce, der Provider sieht
den Prompt, die Antwort erscheint im Chat; kein Event der App enthält den
Prompt, keine offene Anfrage, die Identität steht in keinem KI-Event (nur
Umschlag, Sitzung, Beleg). Mit einem Provider ohne `pow` sendet die App nichts
und nennt den Grund.

Endstand: protocol 985 grün · node 166 grün · app 207 grün · Leak-Tests 23
grün + 4 todo · 0 rot · check-wiring `--streng` 0 offen (183 begründet) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 67. Verschlüsselte Antworten, Teil a: Protokoll (Schritt 3.2)

3.1 ist live: Die veröffentlichte App (`8e3e9efa…`) entspricht dem Build von
`main` nach #27; der Provider-Knoten lief laut MENSCH schon mit ≥ 3.1b.

Aufteilung von 3.2 – wegen der automatischen Veröffentlichung in dieser
Reihenfolge, damit die Live-App nie bricht: **a** Protokoll (hier), **b** App
liest private **und** offene Antworten, **c** Knoten versiegelt Antworten für
private Anfragen, **d** Sitzung und Belege privat.

**`private-job.ts`:** `buildPrivateJobResponse()` packt ein Ergebnis (Kind
6xxx, mit Betrag, Rechnung, SOL-Adresse, usage) oder eine Rückmeldung (7000)
als Kern in einen Umschlag an den Sitzungsschlüssel, versiegelt vom Provider;
nur Antworten, nur vom Provider selbst. `openPrivateJobResponse()` prüft
Empfänger, Signatur und Form, bevor es entschlüsselt, und baut den Kern streng
neu auf.

**Regel `keine-zahlungsdaten`** (`leak-rules.ts`): kein Zahlungs-Tag (amount,
amount_lamports, solana_address, bid, usage, max_total_msat,
max_rate_per_ktoken_msat, settle_every_msat, cumulative_msat, units, payment)
und keine Rechnung in öffentlichen Events. Das Leistungs-Event des Providers
(volume_msat, ohne Kunden) zählt nicht dazu. Neue offene Aussage „ki-zahlung“
(3.2); im KI-Szenario sichtbar als `todo`: Sitzung (38021) und Beleg (38022)
der App tragen heute Beträge offen.

**Fund (nicht behoben, für 3.2c vorgemerkt):** Der Knoten hängt `bootstrap` und
`region` erst nach dem Minen an das Leistungs-Event (38010) – die ID ändert
sich, die Rechenarbeit gilt nicht mehr.

**Tests:** protocol 985 → 989 (private Antworten: kommt unverändert an, Relays
sehen weder Antwort noch Betrag noch Rechnung, Rückmeldung ebenso, fremde
Sitzung, fremder Autor, Anfrage statt Antwort; Regel mit sieben Fällen,
Rechnung im Inhalt, Leistungs-Event und Umschlag unberührt); Leak-Tests 23
grün + 5 todo.

Endstand: protocol 989 grün (+4) · node 166 · app 207 · Leak-Tests 23 grün +
5 todo · 0 rot · check-wiring `--streng` 0 offen (186 begründet) · innerHTML
streng 0 unbewertet · Smoke-Test bestanden.

## 68. Verschlüsselte Antworten, Teil b: App liest private Antworten (Schritt 3.2)

**`app/src/ki-antworten.ts`:** `oeffneAntworten()` öffnet Umschläge an die
Sitzungsschlüssel dieser Seite (`KiSitzungen.pubkeys()`/`mitPubkey()`) und gibt
Ergebnisse (6xxx) und Rückmeldungen (7000) zu den gesuchten Anfragen wie
offene Events zurück – neueste zuerst, geöffnete Umschläge gemerkt (auch
ungültige), damit nicht bei jeder Abfrage neu entschlüsselt wird. Die Echtheit
belegt das Siegel des Providers; Autor ist der Provider aus dem Siegel.

**`tabs/agent.ts`:** `waitForAnswer()` fragt zusätzlich Umschläge an die
Sitzungsschlüssel ab (`privateAntworten()`), Rückmeldungen und Ergebnisse
laufen in dieselben Wege wie offene – Warten, Failover, Hedging;
`askRace()` ebenso. Offene Antworten gelten weiter: Knoten bis 3.2b antworten
offen, ab 3.2c versiegelt – die Live-App versteht beides, bevor der Knoten
umstellt.

**Tests:** app 207 → 211 (`ki-antworten.test.ts`: Ergebnis und Rückmeldung zur
gesuchten Anfrage, Hedging mit zwei Anfragen; fremde Sitzung, beschädigter
Umschlag, Anfrage statt Antwort bleiben draußen und werden als ungültig
gemerkt; Reihenfolge und Cache; Verdrahtung in `waitForAnswer()`/`askRace()`).
**E2E im Browser** mit dem echten `DvmProvider`: einmal antwortet er offen
(heutiger Knoten), einmal nur versiegelt (3.2c nachgestellt) – beide Male
erscheint die Antwort samt Nutzungsanzeige, kein Prompt offen, keine
Identität in KI-Events.

Endstand: protocol 989 · node 166 · app 211 grün (+4) · Leak-Tests 23 grün +
5 todo · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0
unbewertet · Smoke-Test bestanden.

## 69. Verschlüsselte Antworten, Teil c: Knoten versiegelt (Schritt 3.2)

**`node/src/dvm-provider.ts`:** neue `antworte(ev, request, privat)` – auf
private Anfragen geht die Antwort als Kern im Umschlag an den
Sitzungsschlüssel (`buildPrivateJobResponse`), auf offene wie bisher offen.
Umgestellt: Ergebnis, Swarm-Ergebnis, Blob-Abruf (5075), Fortschritt (7000
progress) und Absage (`meldeFehler`, jetzt mit `privat`). Die ID des
Ergebnisses im Umschlag ist dieselbe wie vorher – Beleg und Leistungs-Event
verweisen weiter darauf.

**Fund, behoben:** `bootstrap` und `region` kamen nach dem Minen an das
Leistungs-Event (38010); die ID änderte sich, die Rechenarbeit galt nicht
mehr. Jetzt erst alle Tags, dann minen. Die Regel `keine-zahlungsdaten` nimmt
Kind 38010 ausdrücklich aus (dessen `units` sind Menge ohne Kunden).

**Reihenfolge:** Die App liest versiegelte Antworten seit 3.2b. Knoten erst
aktualisieren, wenn 3.2b veröffentlicht ist (MENSCH).

**Tests:** node 166 → 168 (`private-jobs.test.ts`: Antwort versiegelt, nichts
offen – kein Ergebnis, keine Zahlungsdaten auf dem Relay –, beim Kunden
geöffnet mit Ausgabe, e-/p-Tag und derselben Beleg-ID; Absage versiegelt;
neu: offene Anfrage bekommt weiter eine offene Antwort; neu: 38010 behält mit
`bootstrap`/`region` seine Rechenarbeit). Zwei Tests aus 3.1b prüften die
Antwort offen – sie prüfen jetzt versiegelt und zusätzlich, dass nichts offen
erscheint. **E2E im Browser** mit dem echten Knoten-Code: kein offenes
Ergebnis im Netz, ein Umschlag an die Sitzung, Antwort in der App.

Endstand: protocol 989 · node 168 grün (+2) · app 211 · Leak-Tests 23 grün + 5
todo · 0 rot · check-wiring `--streng` 0 offen (184 begründet) · innerHTML
streng 0 unbewertet · Smoke-Test (App unverändert gegenüber 3.2b) bestanden.

## 70. Verschlüsselte Belege, Teil d: Knoten nimmt versiegelte Sitzung und Belege an (Schritt 3.2)

3.2b ist live (Prüfsumme `c2eb93f4…` = lokaler Build von `main` nach #29), 3.2c
gemergt. Der Knoten sucht Sitzung (38021) und Belege (38022) bisher auf den
Relays – er muss versiegelte **erst verstehen**, bevor die App sie so schickt.
Deshalb: d Knoten (hier) → MENSCH: Knoten aktualisieren → e App.

**Protokoll (`private-job.ts`):** `buildPrivateSessionEvent()` versiegelt
Sitzungseröffnung oder Beleg vom Sitzungsschlüssel an den Provider (mit
Rechenarbeit – der Knoten prüft sie vor jedem Entschlüsseln).
`openPrivateKundenEvent()` öffnet Anfragen **und** Sitzungs-Events;
`openPrivateJobRequest()` bleibt der Öffner nur für Anfragen (gemeinsamer Kern
`oeffneVomKunden()`).

**Knoten (`dvm-provider.ts`):** `handlePrivate()` = `oeffnePrivat()` +
`bearbeitePrivat()`. Sitzungs-Events werden je Kunde und Sitzungs-ID im
Speicher gemerkt (`merkeSitzungsEvent()`, höchstens 5000, die erste Eröffnung
gilt, Belege ohne Doppelte); `validateSession()` prüft sie vor dem Relay, die
Buchhaltung (`checkSessionLedger`) ist dieselbe. Offene Sitzungen gelten
weiter. `pollOnce()` öffnet erst alle Umschläge eines Durchgangs und arbeitet
dann – sonst hing es an der Reihenfolge der Relay-Antwort, ob eine Anfrage ihre
Sitzung findet (einzeln grün, im Verbund rot: so gefunden).

**Tests:** protocol 989 → 991 (versiegelte Sitzung und Beleg: Provider öffnet,
Relays sehen keine Beträge, Nur-Anfragen-Öffner lehnt ab; falsches Kind,
fremder Schlüssel, DM an den Provider); node 168 → 170 (versiegelte Sitzung:
Job ohne Gebot wird über die Sitzung abgerechnet, nichts offen; fremde und
ausgeschöpfte Sitzung → Absage, nichts gerechnet), dreimal hintereinander grün.

Endstand: protocol 991 · node 170 · app 211 · Leak-Tests 23 grün + 5 todo · 0
rot · check-wiring `--streng` 0 offen (186 begründet) · innerHTML streng 0
unbewertet · Smoke-Test bestanden.

## 71. Verschlüsselte Belege, Teil e: App versiegelt Sitzung und Belege – 3.2 Code fertig

**`session-client.ts`:** Sitzungseröffnung und Belege gehen nur noch versiegelt
an den Provider (`versiegeltSenden()` → `buildPrivateSessionEvent`), mit der
Rechenarbeit aus dem Angebot (`powFuer`, aus `powJeProvider` – jetzt zentral in
`shell/state.ts`). Budget, Rate und bezahlte Summen stehen in keinem
öffentlichen Event mehr; auch der Sitzungsschlüssel zeigt sich nirgends.

**`tabs/agent.ts`:** `waitForAnswer()` und `askRace()` nehmen nur noch
versiegelte Antworten – auf eine private Anfrage antwortet ein Knoten ab 3.2c
nie offen; eine offene „Antwort“ wäre untergeschoben. `KIND_DVM_RESULT` in
`state.ts` war danach unbenutzt und ist entfernt.

**Datenschutzbericht:** belegt „KI-Antworten sind für Relays nicht lesbar“ und
„Anfragen, Antworten, Sitzungen und Belege deiner KI-Nutzung zeigen Relays
keine Beträge, Rechnungen oder Adressen“ (Szenario: eine ganze private Runde –
Sitzung, Anfrage, Antwort mit Rechnung, Beleg). Neu offen: „Reklamationen sind
nicht öffentlich“ (3.4) – `buildDispute` trägt `amount_msat`, die Regel kennt
das Tag jetzt.

**Tests:** app bleibt 211 – drei Tests prüften den alten Weg (offene Sitzung,
offene Antworten) und prüfen jetzt versiegelt, mit Öffnen durch den Provider,
Rechenarbeit und fremdem Schlüssel; Leak-Tests 23 + 5 todo → 24 + 4 todo (die
3.2-Regel ist grün). **E2E im Browser** mit dem echten Knoten-Code: zwei
Anfragen, die zweite über die versiegelte Sitzung – der Knoten findet sie und
rechnet 7 msat darüber ab; von der App geht nur Kind 1059 ins Netz, kein Prompt
offen, keine Identität, kein offenes Ergebnis.

**Veröffentlichung (MENSCH):** Erst Knoten auf ≥ 3.2d, dann diesen PR mergen –
sonst findet ein älterer Knoten die versiegelte Sitzung nicht, und die App
wartet vergeblich auf offene Antworten.

Endstand: protocol 991 · node 170 · app 211 · Leak-Tests 24 grün + 4 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 72. Provider-Seite: kein Klartext im Knoten – 3.3 Code fertig

**Knoten (`dvm-provider.ts`, `inference.ts`, `main.ts`):** Nach einem Job
stehen Prompt und Antwort nirgends mehr – weder im Log noch in einer Datei noch
im Speicher. Bisher lagen sie an drei Stellen:
- `main.ts` schrieb zu jedem Job die ersten 120 Zeichen der Antwort ins Log
  (`outputPreview`). Die Vorschau ist jetzt leer, außer der Betreiber setzt
  `LOG_KLARTEXT=1` (Fehlersuche; der Knoten warnt beim Start).
- `OllamaBackend` loggte die ersten 100 Zeichen der Antwort und bei
  gescheiterter Websuche die Fehlermeldung – bei Playwright samt URL mit der
  Suchanfrage aus dem Prompt. Jetzt: nur die Länge bzw. der Fehlername.
- Der Knoten führte je Sitzung einen Gesprächsverlauf (bis 40 Prompts und
  Antworten im Klartext, im RAM, ohne Ablauf). Er ist entfernt.

**App (`ki-kontext.ts`, `tabs/agent.ts`):** Den Zusammenhang bringt jetzt die
App mit: `kontextPraefix()` setzt die letzten Nachrichten des aktuellen
Verlaufs (höchstens 12 bzw. 6000 Zeichen) vor den Prompt – versiegelt mit ihm.
Bisher tat sie das nur beim Modellwechsel (8 Blasen, 800 Zeichen). Nebeneffekt:
Der Kontext bleibt beim Wechsel des Providers erhalten, und eine neue Aufgabe
beginnt wirklich ohne alten Verlauf (der Knoten mischte bisher alle Aufgaben
einer Sitzung).

**`tee`:** zurückgestellt. Ohne Prüfung eines Attestierungsnachweises zeigt die
App nie „vertraulich (attestiert)“ – das hält die Karte ein. Eine echte Prüfung
braucht eine MENSCH-Entscheidung (welche TEE, welche Wurzelzertifikate) und
vermutlich eine neue Abhängigkeit.

**Tests:** node 170 → 175 (neu `klartext.test.ts`: Abnahme mit versiegelter
Sitzung und Anfrage – Prompt und Antwort weder im mitgeschnittenen Log noch in
einer Datei im Arbeitsverzeichnis noch irgendwo im Knoten-Objekt; kein Verlauf
vom Knoten; Schalter; `OllamaBackend` mit nachgebautem Ollama und Websuche;
keine Schreib-APIs im Job-Pfad). Gegenprobe: auf dem alten Code sind 4 der 5
rot. `live-chat.test.ts` prüfte den wachsenden Verlauf – die Funktion entfällt
laut Karte, der Test prüft jetzt das Gegenteil (Anzahl gleich);
`session-jobs.test.ts` prüft die Antwort im Ergebnis statt in der Vorschau.
app 211 → 215 (`ki-kontext.test.ts`). **E2E im Browser** mit dem echten
Knoten-Code: zwei Anfragen über die versiegelte Sitzung; die zweite bringt
„Du: … / KI: …“ als Kontext mit, der Knoten gibt dem Modell keinen eigenen
Verlauf; von der App geht nur Kind 1059 ins Netz.

**Veröffentlichung (MENSCH):** Nach dem Merge den Knoten auf `main` bringen.
Die Reihenfolge passt: Die App ist mit dem Merge live, der Knoten folgt. Ein
alter Knoten mit der neuen App ist harmlos, der Kontext steht dann doppelt im
Prompt. Seit heute gilt: PRs werden gemergt, sobald CI grün ist, auch wenn die
App einen neueren Knoten braucht. Der MENSCH aktualisiert den GX10-Knoten
danach (CLAUDE.md, Arbeitsweise Punkt 7). #32 (3.2e) ist so gemergt worden.

Endstand: protocol 991 · node 175 · app 215 · Leak-Tests 24 grün + 4 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 73. Verlauf und Reklamationen privat – 3.4 Code fertig

**Verlauf:** Der KI-Verlauf liegt seit 1.2c nur im Tresor (`geheim`,
`freedom.agentHistory`, in `geheimnisse()` eingetragen). Neu prüft das der
Leak-Test mit: Lesen und Schreiben nur über `geheim`, nie direkt in
`localStorage`.

**Reklamationen:** Bisher ging eine Reklamation offen als Kind 38072 hinaus –
mit Auftrag, Grund, Betrag und einer Notiz, die die App ausdrücklich als
„öffentlich“ abfragte. Jetzt:
- `protocol/private-job.ts`: `buildPrivateDispute()` versiegelt sie vom
  Sitzungsschlüssel, je ein Umschlag an den Provider und an einen Prüfer
  (höchstens 2 Empfänger, Rechenarbeit laut Angebot des Empfängers). Der
  Provider muss dabei sein, und wer reklamiert, prüft nicht selbst.
  `openPrivateKundenEvent()` nimmt Reklamationen an – auch beim Prüfer.
- App: `reklamiere()` fragt nach einem Prüfer. Zur Wahl stehen die bekannten
  Provider außer dem beschuldigten (`prueferKandidaten()` in `state.ts`), nur
  solche, die Umschläge lesen. Leer heißt: nur an den Provider.
- Knoten: `meldeReklamation()` loggt Auftrag, Grund und Betrag – als
  „gegen diesen Knoten“ oder „zur Nachprüfung“ –, nie die Notiz (3.3).

**Ehrlicher Text:** Der Infotext versprach, dass ein zweiter Provider
nachprüft und die Zahlung zurückfließt. Das gibt es im Code nicht (Streitfall-
Prüfer: Schritt 5.6). Jetzt steht dort, dass die Reklamation benachrichtigt
und keine Erstattung von selbst folgt.

**Datenschutzbericht:** belegt „Reklamationen sind nicht öffentlich – sie
gehen versiegelt an den Provider und einen Prüfer deiner Wahl.“ Szenario:
Reklamation an Provider und Prüfer, weder Betrag noch Grund noch Notiz noch
Sitzung sichtbar.

**Fund:** `klartext.test.ts` (3.3, #33) war in etwa einem von sieben Läufen
rot. Zwei Anfragen derselben Sekunde verarbeitet `pollOnce()` in keiner festen
Reihenfolge, der Test nahm aber eine an. Er prüft jetzt ohne Reihenfolge; 40
Läufe am Stück grün, die ganze Knoten-Suite dreimal.

**Tests:** protocol 991 → 993 (Reklamation versiegelt/Fehlerfälle), node
175 → 176, app 215, Leak-Tests 24 → 28 grün + 4 todo (`reklamation.test.ts`:
Abnahme – nur Umschläge, kein Betrag/Grund/Notiz, weder Identität noch
Sitzung, p-Tags nur Provider und Prüfer, beide lesen sie vollständig,
Verdrahtung). **E2E im Browser** mit zwei echten Knoten: zwei Anfragen, dann
„Reklamieren“ → Prüfer-Auswahl zeigt den zweiten Knoten → von der App gehen
nur Umschläge an genau diese beiden; beide Knoten melden die Reklamation,
keiner loggt die Notiz.

**Knoten-Stand:** Ein Knoten vor 3.4 verwirft die Umschläge („Weder Anfrage
noch Sitzungs-Event“) – die Reklamation erreicht ihn dann nicht. Der MENSCH
bringt den GX10-Knoten ohnehin auf `main`.

Endstand: protocol 993 · node 176 · app 215 · Leak-Tests 28 grün + 4 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 74. Verschlüsselte Anhänge, Teil a: Protokoll-Baustein (Schritt 2.4)

Bisher gingen Chat-Anhänge über 80 KB im Klartext ins Blob-Netz (Chunks als
Hex) oder zu einem Blossom-Server, dazu Name und Typ im öffentlichen Manifest –
auch wenn die Direktnachricht selbst verschlüsselt war.

**`protocol/src/datei-krypto.ts`:** `verschluesseleDatei()` – AES-256-GCM
(`@noble/ciphers`, schon Abhängigkeit) mit frischem Schlüssel und frischer
Nonce je Datei, wie NIP-17 Kind 15 mit `aes-gcm`. Zurück kommen das Chiffrat
und ein `DateiSchluessel` (Schlüssel, Nonce, `ox` = SHA-256 des Klartexts), der
nur in die verschlüsselte Nachricht gehört. `entschluesseleDatei()` prüft den
GCM-Tag und danach den Hash; `istDateiSchluessel()` prüft Schlüssel aus fremden
Nachrichten streng (Längen, Kleinbuchstaben-Hex).

**Aufteilung:** a (dieser Teil) Baustein und Abnahme-Tests; b verdrahtet die
App: Upload nur als Chiffrat (Blob-Netz und Blossom), Schlüssel in der
Nachricht, Download entschlüsselt; dort wird die Leak-Regel im App-Szenario
grün und die Aussage „Anhänge liegen verschlüsselt“ belegt.

**Tests:** protocol 993 → 998 (Rundreise, frische Schlüssel, Manipulation /
falscher Schlüssel / falscher Hash, strenge Form fremder Schlüssel, Upload ≠
Klartext über das echte `buildBlob` samt Gegenprobe).

Endstand: protocol 998 · node 176 · app 215 · Leak-Tests 28 grün + 4 todo · 0
rot · check-wiring `--streng` 0 offen (3 neue Ausnahmen bis 2.4b).

## 75. Verschlüsselte Anhänge, Teil b: App – 2.4 Code fertig

**Upload (`blob-client.ts`, `tabs/kommunikation.ts`):** `uploadAnhang()`
verschlüsselt mit `verschluesseleDatei()` und lädt nur das Chiffrat ins
Blob-Netz, mit leerem Namen und Typ `application/octet-stream` im Manifest.
Der Blossom-Ausweg lädt ebenso nur Chiffrat hoch. Der Schlüssel steht im
Anhang (`enc`) – in der DM im verschlüsselten Body, in Räumen im imeta-Tag mit
den Feldnamen von NIP-17 Kind 15. Räume sind bis 2.3 offen, der Schlüssel dort
also so öffentlich wie der Text.

**Download:** `renderAttachment()` zeigt verschlüsselte Anhänge als 🔒-Knopf
– der Schlüssel aus fremder Nachricht wird erst geprüft (`istDateiSchluessel`,
sonst „ungültiger Schlüssel“), nur `freedom-blob:` oder `https:`. Der Knopf
holt das Chiffrat, öffnet es mit `oeffneAnhang()` (GCM-Tag und Hash) und
bietet die Datei mit Name und Typ aus der Nachricht zum Speichern an. Nie als
`<img>`-Quelle.

**Zwei alte Fehler, beim Test gefunden:**
- `downloadBlob()` verglich den Hex-Inhalt eines Chunks mit seinem Hash statt
  den Hash des Inhalts. Kein Chunk vom Relay wurde je angenommen – Empfänger
  konnten große Anhänge nie laden, nur der Absender aus seinem Cache. Jetzt
  gegen den Hash im Manifest geprüft; ohne IndexedDB (privates Fenster) liest
  der Cache einfach nichts, statt den Download abzubrechen.
- Anhänge bis 80 KB reisten inline als data-URL in der DM. Base64 macht ein
  Drittel mehr, NIP-44 erlaubt höchstens 65.535 Byte – DMs mit Anhängen ab
  etwa 48 KB scheiterten beim Senden. Die Grenze liegt jetzt bei 32 KB,
  darüber geht es verschlüsselt ins Blob-Netz.

**Git-Bundle:** bleibt mit Absicht öffentlich (`uploadBlob`), es ist eine
Veröffentlichung.

**Datenschutzbericht:** belegt „Anhänge liegen verschlüsselt auf den
Speicher-Servern – öffnen kann sie nur, wer die Nachricht lesen kann.“
Szenario: verschlüsselte Datei über das echte `buildBlob`.

**Tests:** app 215 → 219 (Darstellung mit geprüftem Schlüssel, feindliche
Namen/Typen/Schemata, imeta hin und zurück, DM-Body), Leak-Tests 28 + 4 todo
→ 30 + 3 todo (Anhang: nur Chiffrat, weder Name noch Typ; Empfänger lädt und
öffnet, Manipulation fällt auf; Verdrahtung). **E2E mit zwei Browsern:** Alice
schickt Bob per DM eine 50-KB-Datei; Bob sieht „🔒 geheimer-befund.pdf“, lädt
und bekommt sie byte-genau; im Netz stehen weder Name noch Typ noch Klartext.

Endstand: protocol 998 · node 176 · app 219 · Leak-Tests 30 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 76. Metadaten minimieren, Teil a: Ablauf nach NIP-40, Bericht, Wache (Schritt 2.5)

**Ablauf (`protocol/private-dm.ts`, `gift-wrap.ts`):** `buildPrivateDm()`
nimmt `ablaufSecs` (60 s bis 1 Jahr). Der Ablauf steht exakt im
verschlüsselten Inhalt – die App des Empfängers blendet die Nachricht danach
aus (`dmAbgelaufen()`). Auf beiden Umschlägen steht er als `expiration`, damit
Relays löschen, aber je Umschlag zufällig bis zu einer Dauer später
(höchstens das NIP-59-Zeitfenster von 2 Tagen): Ein exakter Ablauf verriete
sonst den Sendezeitpunkt (Ablauf minus Dauer) und machte den Zeitversatz der
Umschläge wirkungslos. Fremde, kaputte Ablaufwerte im Inhalt zählen nicht.

**App:** Neben dem Anhang-Knopf wählt ⏱ den Ablauf je DM-Unterhaltung (aus,
1 Stunde, 1 Tag, 7 Tage, 30 Tage), gespeichert mit der Unterhaltung im
Tresor. Beim Einschalten: „Löschen ist eine Bitte an die Relays – wer sie
schon hat, behält sie.“ `ladeDmNachrichten()` zeigt Abgelaufenes nicht mehr.
Räume sind bis 2.3 offen und bekommen den Ablauf mit ihnen.

**Datenschutzbericht:** vorweg die Zeile „Kurz: Inhalt, Absender: verborgen;
IP-Adresse: sichtbar ohne Tor“ (`kurzfassung()`). „Aufbewahrung“ hing an einer
Einstellung `freedom.expiry`, die es nie gab; jetzt gilt sie nur als erledigt,
wenn jede DM-Unterhaltung abläuft.

**Lesebestätigungen, Tippanzeige, Reaktionen, Kontaktliste:** Die App hat
keine davon, die Unterhaltungen liegen nur lokal im Tresor. Eine Wache im
Leak-Test verhindert, dass sie offen hinzukommen. Die optionale private
Kontaktliste (NIP-51, Standard aus) folgt in Teil b.

**Tests:** protocol 998 → 1002 (Ablauf im Inhalt und auf den Umschlägen,
Streuung, Grenzen und Müll, Kurzfassung), app 219, Leak-Tests 30 → 33 grün +
3 todo (`metadaten.test.ts`). **E2E im Browser:** Alice stellt „1 Tag“ ein und
schreibt Bob; die Umschläge laufen nach 25,5 bzw. 38,2 Stunden ab, sonst tragen
sie nur `p`; Bob liest die Nachricht; mit der Uhr 25 Stunden weiter ist sie
bei ihm ausgeblendet; die Einstellung übersteht das Neuladen.

Endstand: protocol 1002 · node 176 · app 219 · Leak-Tests 33 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 77. Metadaten minimieren, Teil b: private Kontaktliste – 2.5 Code fertig

**Ausgangslage:** Die Unterhaltungen liegen nur lokal im Tresor; eine
Kontaktliste veröffentlicht die App nicht. Wer mehrere Geräte nutzt, hatte
also keinen Abgleich.

**`protocol/kontaktliste.ts`:** `buildPrivateKontaktliste()` baut eine
NIP-51-Liste (Kind 30000, `d` = `freedom-kontakte`), alle Einträge als
NIP-44-Chiffrat an den eigenen Schlüssel – kein p-Tag offen. Über den Signer,
also auch mit Bunker. `oeffnePrivateKontaktliste()` liest nur die eigene
Liste, lehnt offene Einträge ab, sortiert kaputte, doppelte und fremde
Einträge aus (höchstens 1000, Namen höchstens 100 Zeichen).

**App:** Schalter in Settings → Datenschutz, Standard aus. Beim Einschalten
holt `kontakteEinschalten()` zuerst die vorhandene Liste und führt sie mit den
eigenen Unterhaltungen zusammen, erst dann wird gesichert. Scheitert das
Laden, bleibt der Schalter aus. `sichereKontakte()` sendet nur, wenn sich die
Kontaktmenge ändert – nicht bei jeder Nachricht, sonst verriete die Liste,
wann jemand schreibt – und erst, wenn der Stand der Relays in dieser Sitzung
geladen ist. Beim Ausschalten ersetzt eine leere Liste die alte. Der Abgleich
führt zusammen; eine auf einem Gerät gelöschte Unterhaltung kommt vom anderen
zurück.

**Fund beim Test:** In der ersten Fassung hätte ein zweites Gerät beim
Einschalten sofort seine leere Liste veröffentlicht und damit die Kontakte
des ersten überschrieben. Die Reihenfolge „erst laden, dann sichern“ und die
Sperre ohne geladenen Stand verhindern das; der Verdrahtungstest hält die
Reihenfolge fest.

**Datenschutzbericht:** belegt „Deine Kontaktliste veröffentlicht die App
nicht – auf Wunsch liegt sie verschlüsselt auf den Relays.“ Szenario: Liste
ohne Klartext und ohne p-Tag.

**Tests:** protocol 1002 → 1005, Leak-Tests 33 → 35 grün + 3 todo
(`kontakte.test.ts`). **E2E mit zwei Geräten derselben Identität:** Standard
aus, ohne Schalter keine Liste; Gerät 1 sichert (auf dem Netz nur `d`);
Gerät 2 schaltet ein, übernimmt den Kontakt und sendet keine neue Liste;
Ausschalten auf Gerät 1 leert sie.

Endstand: protocol 1005 · node 176 · app 219 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 78. MLS: Spike und Entscheidungsvorlage (Schritt 2.2a) – wartet auf MENSCH

**Vorlage:** `docs/MLS-ENTSCHEIDUNG.md` mit Tabelle und Empfehlung; Spike-Quellen
und Anleitung unter `docs/mls-spike/` (bewusst kein Paket unter `packages/*`,
sonst käme ts-mls ins Lockfile des Repos).

**Neu seit der Karte:** Marmot ist neu gefasst (`marmot-protocol/marmot`,
„adopted“). Die MIPs sind veraltet; der Gruppenzustand liegt in
MLS-`app_data_dictionary`-Komponenten aus dem Extensions-Draft, KeyPackages
brauchen `last_resort_key_package` und `app_data_update`. MDK 0.10.4 setzt das
auf einem festgenagelten OpenMLS-Fork um.

**Gemessen:**
- ts-mls 1.6.4 (MIT, laut README ohne Audit): zwei Mitglieder, Nachricht,
  Entfernen laufen; Bündel 214 KB (67 KB gzip); kennt den Extensions-Draft
  nicht – die Marmot-Schicht wäre selbst zu schreiben.
- OpenMLS-Kern aus dem MDK-Fork als WASM mit wasm-bindgen: läuft in Node und
  in Chromium (Bob liest, nach dem Entfernen nicht mehr); 1,43 MB WASM
  (456 KB gzip). Ohne `'wasm-unsafe-eval'` verweigert Chromium das Modul.
- MDK-Kernbausteine bauen für wasm32 (81 s), aber einen Browser-Speicher gibt
  es nicht – nur SQLite/SQLCipher; `StorageProvider` umfasst 16 Teil-Traits
  mit rund 140 Methoden.

**Empfehlung:** A – MDK per WASM (Interop mit White Noise, Marmot-Logik
fertig), mit den Kosten CSP-Änderung, Rust in CI, eigener Browser-Speicher,
App grob doppelt so groß (oder WASM nachladen und das Ein-Datei-Prinzip
aufgeben). **STOPP: Die Entscheidung trifft der MENSCH.** 2.2b und 2.3 warten
darauf.

## 79. Gebührenmodell: Entscheidungsvorlage (Schritt 4.0) – wartet auf MENSCH

`docs/GEBUEHREN-ENTSCHEIDUNG.md`: Ist-Stand aus dem Code (Protokollfee 2,5 %
als Invariante, Abführung an Lightning-Adressen aus der Knoten-Umgebung,
Pool-Wallet auf einem Knoten mit `POOL_DISTRIBUTOR=1`, Verteilung nach
Selbstauskünften, Treasury-Code noch vorhanden, App-Gebühr 2,5 % offen und
abschaltbar), dazu Option A (0 %) und B (Pool offen als zentral verwaltete
Belohnung, nur SOL, Multisig) mit betroffenen Dateien, Folgen für den
Zahlkanal (4.3), AMLR-Angriffsfläche (ausdrücklich kein Rechtsrat) und
Einnahmen. **STOPP: Die Entscheidung trifft der MENSCH.** 4.3 wartet darauf;
4.1 (PaymentRail) hängt nicht daran.

## 80. PaymentRail, Teil a: Schnittstelle und Schienen (Schritt 4.1)

**`protocol/src/payment-rail.ts`:** `PaymentRail` (verfügbar, quote, pay,
verify, optional refund/balance), `Zahlanfrage` (Ziel, Betrag in der Einheit
der Schiene, Zweck), `Beleg` (Preimage bzw. Signatur, bei Lightning die
bezahlte Rechnung). `railFuerZiel()` erkennt Rechnung, Lightning-Adresse und
Solana-Adresse; `pruefeAnfrage()` verlangt die Einheit der Schiene und einen
positiven ganzzahligen Betrag; `waehleRail()` nimmt die passende, verbundene
Schiene und leitet **nie still** auf die andere um – das wäre eine Zahlung in
einer Währung, die der Nutzer nicht gewählt hat; `inBeidenEinheiten()` für die
Anzeige mit Kurs (4.4).

**`app/src/rails.ts`:** `LightningRail` zahlt über NWC, sonst WebLN; für
Lightning-Adressen holt sie die Rechnung per LNURL-pay (nur https-Callback,
Grenzen des Empfängers) und zahlt nur, wenn die Rechnung genau den gewollten
Betrag nennt – ein fremder Server könnte sonst mehr abbuchen. Der Beleg prüft
sich am Payment-Hash der Rechnung (bolt11 selbst dekodiert). `SolanaRail`
lässt die verbundene Wallet die gebaute Überweisung signieren und prüft die
Signaturform; einen Beleg bestätigt sie nur mit RPC-Prüfung, sonst gilt er als
nicht prüfbar (die volle Empfängerprüfung ist 4.8).

**Tests:** protocol 1005 → 1009, app 219 → 224 (Testvektor aus BOLT 11,
selbst gebaute Rechnungen mit bekanntem Hash, NWC/WebLN/LNURL-Attrappen,
teurere Rechnung vom Server, Grenzen, http-Callback, Solana mit und ohne
RPC-Prüfung, Selbstüberweisung, kaputte Signatur). Verdrahtet wird in 4.1b/c;
bis dahin 4 begründete Ausnahmen.

Endstand: protocol 1009 · node 176 · app 224 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen.

## 81. PaymentRail, Teil b: Zap über die Schienen, toter Wallet-Code entfernt (Schritt 4.1)

**`shell/zahlschienen.ts`:** baut beide Schienen aus dem Zustand der App –
Lightning über NWC oder WebLN, Solana über die im Wallet-Tab verbundene Wallet
(`verbundeneSolanaWallet()`): kann sie selbst senden, tut sie es, sonst
signiert sie und die App sendet über den RPC-Pool (`solRpcUrl()`, aus
`sol-transfer.ts` herausgelöst; `buildSolTransfer` rechnet jetzt in Lamports).

**Chat-Zap (`chat-zap.ts`, `zap-zahlung.ts`):** holt die Rechnung per LNURL
mit dem Zap-Request und zahlt mit `zahle(zahlschienen(), …)`; das
SOL-Trinkgeld ebenso über die Solana-Schiene. Drei alte Fehler dabei:
- Der Dialog griff auf `window.ensurePool` und `window.solWallet` zu – beide
  gab es nie; Lightning- und SOL-Zap brachen ab.
- Der Zap-Request (Kind 9734) ging **unsigniert** an den LNURL-Server.
- Die App veröffentlichte selbst eine „Quittung“ (Kind 9735) mit Rechnung und
  Preimage unter der eigenen Identität – nicht NIP-57 (die schreibt der
  Server des Empfängers) und ein Leck; entfallen.

**Entfernt, weil tot:** `lightning-wallet.ts` (nur noch vom alten Zap
benutzt), `offline-queue.ts` (wurde gefüllt, nie abgearbeitet, und legte
Preimages im Klartext in localStorage ab – alte Einträge löscht die App beim
Start), `addZapButton` und `payInvoiceAnyDevice` in `waehrung.ts` (nie
aufgerufen). Ausnahmen bereinigt; `buildZapReceipt` begründet ausgenommen.

**Tests:** app 224 → 228 (`zap-zahlung.test.ts`: LNURL mit Zap-Request,
Empfänger ohne Zaps, http-Callback, teurere Rechnung wird nicht gezahlt,
SOL-Adresse aus dem Profil, Verdrahtung). **E2E im Browser:** Alice zappt Bob
10 sats aus dem Chat – WebLN zahlt genau die Rechnung von Bobs LNURL-Server,
der Zap-Request ist signiert, keine Quittung und keine Rechnung im Netz.

Endstand: protocol 1009 · node 176 · app 228 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 82. PaymentRail, Teil c: Standard-Schiene und Zahlwege-Prüfung (Schritt 4.1)

**Standard-Schiene:** Settings → Gebühren → „Zahlen“: Lightning (sats) oder
Solana (SOL), Standard Lightning (`standard-schiene.ts`). Der Zap-Dialog
übernimmt sie als Vorgabe (Betrag, Einheit, Schiene); je Zahlung änderbar, die
Einheit folgt der gewählten Schiene. Die App zahlt nie still in der anderen
Währung (`waehleRail`).

**Zahlwege-Prüfung (Abnahme der Karte):** `check-wiring.py --streng` meldet
jeden Wallet-Zugriff (`payInvoice`, `sendPayment`, `signAndSendTransaction`,
`buildSolTransfer`, `sendRawTransaction`, `keysend`) außerhalb der erlaubten
Dateien – `rails.ts` und `shell/zahlschienen.ts`; begründet ausgenommen sind
die Treuhand-Programme (HTLC-Deposit, Swap: eigene Anweisungen, keine
Überweisung) und der nie benutzte Keysend der Sitzung. Selbsttest in
`scripts/test_check_wiring.py` (erlaubt, Kommentar, Verstoß).

**Karte passt nicht zum Code (MENSCH-Frage):** „Agent-Bezahlung“ und
„Verdienen“ auf die Schiene umstellen setzt voraus, dass es dort Zahlungen
gibt. Die App bezahlt KI-Aufträge heute nicht – `chargeForResult()` wird ohne
Wallet aufgerufen, es bleibt bei versiegelten Belegen –, der Knoten stellt
keine Rechnungen aus, und „Verdienen“ hat in der App keine Zahlfunktion. Eine
echte KI-Bezahlung ist eine neue Geldfunktion: Knoten stellt Rechnungen aus
(Lightning, braucht LND/NWC am Knoten) oder SOL-Zahlkanal (4.3, nach 4.0).
Vorschlag im PR.

**Tests:** app 228 → 230, Selbsttest check-wiring 4 → 5. Zap-E2E erneut
bestanden (Vorgabe Lightning).

Endstand: protocol 1009 · node 176 · app 230 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen, 0 Wallet-Zugriffe außerhalb der Schienen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 83. SOL-Wallet, Teil a: Tageslimit und eingebaute Wallet (Schritt 4.2)

**Tageslimit (`protocol/src/ausgabe-limit.ts`):** reine Funktion wie das
Budget einer NWC-Verbindung – `pruefeTageslimit(verlauf, betrag, limit, jetzt)`
zählt die Ausgaben der letzten 24 Stunden (rollend: ein Kalendertag ließe
sich um Mitternacht zweimal ausschöpfen). Über dem Limit ist eine Zahlung
nicht verboten, sie braucht eine ausdrückliche Bestätigung; Limit 0 heißt:
jede Zahlung fragt.

**Eingebaute Wallet (`app/src/sol-wallet.ts`):** für alle ohne Browser-Wallet.
Der Schlüssel entsteht per SLIP-10 aus den 12 Wörtern auf Phantoms Pfad
(Schritt 1.1) – nur wenn die Wörter zur eigenen Identität gehören. Der Test
prüft die Adresse, die Phantom für die öffentliche Testphrase zeigt. Die App
speichert die Wörter nicht; liegen bleibt nur der abgeleitete Schlüssel, über
`geheim` (neuer Name in `geheimnisse()`). Signiert wird synchron mit einer
frischen Kopie, die danach genullt wird – ohne `Buffer.from`, das kleine Werte
in einen gemeinsamen Pool legt. Die Wallet signiert nur Transaktionen, die
ihre Adresse als Signierer verlangen.

**Freigabe-Haken:** `SolanaRail.pay()` fragt vor dem Bauen `freigabe()` –
die eingebaute Wallet prüft dort das Tageslimit (Standard 0,1 SOL) und fragt
darüber mit einem Dialog nach (`shell/eingebaute-wallet.ts`, Beträge und
Adresse per `textContent`). Gezählt wird ab der Freigabe; scheitert die
Zahlung danach, zählt sie trotzdem – das Limit irrt zur Nachfrage hin.
Abgelehnt: nichts gebaut, nichts gesendet.

**Verdrahtung:** `zahlschienen.ts` nimmt die verbundene Wallet, sonst die
eingebaute (eingerichtet, Tresor offen, kein Bunker – mit Bunker gehören die
12 Wörter nicht auf das Gerät). `check-wiring.py` prüft zusätzlich: roh
signiert nur `sol-wallet.ts`, die benutzbare eingebaute Wallet holt nur die
Schiene. Die SLIP-10-Ableitung aus 1.1 ist damit verdrahtet – ihre sechs
Ausnahmen in `wiring-ausnahmen.txt` sind entfernt (`slip10PublicKey` bleibt
unbenutzt). Einrichten kann man die Wallet erst mit Teil b (Oberfläche) – bis
dahin ändert sich für Nutzer nichts.

**Tests:** protocol 1009 → 1012 (`ausgabe-limit.test.ts`), app 230 → 234
(`sol-wallet.test.ts`: Phantom-Adresse, fremde und ungültige Wörter, gesperrter
Tresor, Signatur gleich der von web3.js, fremde Transaktion abgelehnt, Limit
mit Nachfrage/Ablehnung/Fenster/ungültigen Werten, Schiene ohne Freigabe baut
nichts).

Endstand: protocol 1012 · node 176 · app 234 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen, 0 Wallet-Zugriffe außerhalb der Schienen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 84. SOL-Wallet, Teil b: Oberfläche der eingebauten Wallet (Schritt 4.2)

**Wallet-Tab → Solana → „Eingebaute Wallet“** (`shell/eingebaute-wallet.ts`):
einrichten verlangt zuerst den Tresor (`verlangeTresor`), dann die 12 Wörter
einmal; das Feld wird danach geleert. Angezeigt werden die Adresse zum
Empfangen (kopierbar), das Guthaben, das Tageslimit in SOL (speicherbar) und
„von diesem Gerät entfernen“ (das Guthaben bleibt auf der Kette, die Wörter
stellen die Wallet wieder her). Mit Bunker ist der Abschnitt gesperrt – mit
Hinweis auf eine externe Wallet. Der Text sagt ehrlich, dass die eingebaute
Wallet Zaps und Trinkgeld zahlt; Tausch und Deposit brauchen vorerst eine
verbundene Wallet. FAQ: „Brauche ich Phantom oder eine andere Solana-Wallet?“

**Alter Fehler behoben (`protocol/src/rpc-pool.ts`):** Der Pool speicherte
`fetch` und rief es als Methode auf – im Browser „Illegal invocation“. Damit
scheiterte in der App jede Pool-Abfrage: Guthaben (auch externer Wallets),
die RPC-Prüfung in den Settings, `solRpcUrl()`. Node stört das nicht, deshalb
waren alle Tests grün. Jetzt ein Pfeil um `fetch`; Regressionstest, der das
Browser-Verhalten nachstellt (vorher rot, jetzt grün). Fallstrick in CLAUDE.md.

**E2E im Browser** (Relay und Solana-RPC gemockt, öffentliche Testphrase):
Tresor einrichten → fremde Wörter abgelehnt („gehören nicht zu deiner
Identität“) → Adresse `HAgk14…` wie in Phantom, Guthaben 2 SOL → weder Wörter
noch Schlüssel in localStorage → Limit 0,001 SOL → Zap 0,0005 SOL ohne Dialog
gesendet → Zap 0,002 SOL: Dialog (Betrag, schon gesendet 0,0005 SOL),
abgelehnt → „nicht freigegeben – nichts gesendet“, keine Transaktion;
bestätigt → gesendet → beide Transaktionen gültig signiert, von `HAgk14…` an
Bobs Adresse aus seinem Profil, 500.000 und 2.000.000 Lamports → Neuladen,
Tresor entsperren → Wallet und Limit noch da.

**Tests:** protocol 1012 → 1013 (RpcPool ohne `fetchImpl`), app 234 → 235
(Verdrahtung des Abschnitts).

Endstand: protocol 1013 · node 176 · app 235 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen, 0 Wallet-Zugriffe außerhalb der Schienen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden · Website gebaut.

## 85. SOL-Wallet, Teil c: externe Wallets über den Wallet Standard (Schritt 4.2)

**Wallet Standard ohne Abhängigkeit (`app/src/wallet-standard.ts`):** Die
meisten Browser-Wallets (Backpack, Solflare, Phantom …) melden sich heute über
den Wallet Standard an. Das Protokoll sind zwei Ereignisse – die App ruft
„app-ready“ mit einer Registrierung aus, später ladende Wallets rufen
„register-wallet“ –, dafür lohnt kein Paket. Genommen werden nur Wallets mit
einer Solana-Kette und einer Signierfunktion; `alsAnbieter()` macht daraus die
Form, die der Rest der App kennt, und bietet nur an, was die Wallet kann.

**Verbinden (`solana-connect.ts`, `tabs/waehrung.ts`):** Wallet Standard vor
dem alten `window.solana`. Mehrere Wallets → Auswahl als Knöpfe (Namen per
`textContent`); gemerkt wird nur der Name (kein Geheimnis), still
wiederverbunden nur mit dieser Wallet – ohne gemerkte kein stilles Popup. Die
Kette folgt dem eingestellten RPC (`ketteAusRpc`: Devnet/Testnet am Namen,
sonst Mainnet); kann die Wallet sie nicht, sagt die App das. Die
Zahlwege-Prüfung erlaubt `signAndSendTransaction` im Adapter begründet –
aufgerufen wird er nur von der Schiene.

**E2E im Browser:** zwei Test-Wallets nach dem Wallet Standard, RPC auf Devnet
gestellt → beim Start keine Verbindung (nichts gemerkt) → Verbinden zeigt beide
zur Auswahl → „Testwallet Zwei“ verbunden → Zap 0,003 SOL an Bob: die Wallet
bekommt `solana:devnet`, ihr Konto und eine Überweisung von ihrer Adresse an
Bobs Adresse über 3.000.000 Lamports, kein Limit-Dialog (externe Wallets fragen
selbst) → Neuladen: still mit genau dieser Wallet verbunden. Der E2E der
eingebauten Wallet (§84) läuft unverändert grün.

**Mobile Wallet Adapter (MENSCH-Frage):** Nativ auf Android/Seeker bräuchte es
`@solana-mobile/wallet-standard-mobile` (0.6.0, 1,1 MB entpackt, zieht das
MWA-Protokoll und `@solana/kit` nach). Es meldet MWA als Standard-Wallet an –
der Code aus diesem Schritt nähme sie ohne Umbau. Bis dahin: Deeplink in den
Wallet-Browser oder die eingebaute Wallet.

**Tests:** app 235 → 240 (`wallet-standard.test.ts`: Anmeldung in beide
Richtungen, fremde Ketten und Wallets ohne Signierfunktion ausgefiltert,
kaputte Anmeldung stört nicht, Kette aus dem RPC, Signieren mit richtiger Kette
und echter Signatur, falsche Kette und kaputte Signatur abgelehnt, nur
angebotene Funktionen, Auswahl, stilles Verbinden nur mit gemerkter Wallet).

Endstand: protocol 1013 · node 176 · app 240 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen, 0 Wallet-Zugriffe außerhalb der Schienen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## 86. Preise und Kurse, Teil a: Marktkurs und Umrechnung im Knoten (Schritt 4.4)

**Marktkurs (`protocol/src/kurs.ts`):** Median der Kurs-Events (Kind 38026),
aber **eine Stimme je Absender** (sein jüngster Kurs) – der alte
`medianPrice()` zählte jedes Event, wer zehn schickte, bekam zehn Stimmen.
Nur frische (1 h), plausible Kurse. Warnungen: weniger als drei Quellen,
Quellen mehr als 10 % auseinander, ein Referenzkurs (etwa der eines Anbieters)
mehr als 10 % neben dem Markt. Umrechnung msat ↔ Lamports ganzzahlig mit
BigInt, aufgerundet. `medianPrice` bleibt (acht Tests), ist aber begründet als
abgelöst ausgenommen.

**Angebot:** Kind 38025 trägt optional `["kurs", "SOL/BTC", <sats pro SOL>,
"manuell"|"markt"]` – „eine Einheit plus Kursquelle“ nach der Karte; gelesen
wird nur eine ganze Zahl und eine bekannte Quelle.

**Zwei alte Fehler im Knoten (`dvm-provider.ts`):**
- `lamportsPerMsat()` rechnete `1e9 / (Kurs · 1000 · 1000)` – eine Tausend zu
  viel. Richtig: 1 SOL = 1e9 Lamports = Kurs · 1000 msat. SOL-Preise waren
  damit 1000× zu niedrig, und der Deckel des Kunden (Lamports je 1k Tokens)
  griff nie. Die Tests hatten die falsche Formel festgeschrieben (2 sats bei
  150.000 sats/SOL = „14 Lamports“ statt 13.334) – ihre Erwartungen sind
  korrigiert und damit strenger.
- Ohne Kurs galt still 0,2 Lamports/msat (5 Mio. sats pro SOL). Jetzt: ohne
  Kurs kein SOL-Preis; ein Deposit-Auftrag wird vor dem Rechnen mit Grund
  abgelehnt („Kein SOL-Kurs …“), keine Rechenzeit verschenkt.

**Kurse veröffentlichen:** Bisher veröffentlichte niemand Kurs-Events – der
Knoten rief `cycle()` ohne Kurse auf. Jetzt veröffentlicht ein LP seinen
Tauschkurs (`LP_LAMPORTS_PER_SAT` → sats pro SOL); das Angebot des Anbieters
trägt den Kurs, mit dem er rechnet.

**Knoten-Stand:** Mit dem Update rechnet der GX10-Knoten SOL-Preise richtig
und lehnt SOL-Deposits ohne Kurs ab (`SOL_PRICE_SATS` setzen, bis LPs Kurse
veröffentlichen).

**Tests:** protocol 1013 → 1018 (`kurs.test.ts`: Median je Absender,
Frische/Unsinn, Warnungen, Umrechnung inkl. großer Beträge, Angebot mit
Kurs), node 176 → 179 (ohne Kurs abgelehnt ohne Rechenzeit, Deckel greift mit
richtigem Kurs, Verdrahtung LP-Kurs und Angebot).

Endstand: protocol 1018 · node 179 · app 240 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 87. Preise und Kurse, Teil b: beide Einheiten in der App (Schritt 4.4)

**Marktkurs in der App (`shell/marktkurs.ts`):** holt die Kurs-Events, bildet
den Median je Absender (`marktKurs()` aus 4.4a) und hält ihn zehn Minuten.
Die Kurszeile im Wallet-Tab nennt Kurs und Quellen; Warnungen (zu wenige
Quellen, Streuung) stehen sichtbar dabei, ohne Kurs-Events steht dort „SOL-Preise
nicht verfügbar“.

**Beide Einheiten (`preis-anzeige.ts`):** Modellwahl („~1 sats ≈ 0,000006452 SOL
/1k tokens“), Kostenschätzung, Gebot, Zap-Dialog (live in die jeweils andere
Einheit) und das Guthaben der eingebauten Wallet. Vorher rechnete die App mit
festen 150.000 sats/SOL; jetzt ohne Kurs ehrlich „(SOL: kein Kurs)“.

**Deposit-Deckel:** Lamports je 1k Tokens aus dem Preis des Anbieters und dem
Marktkurs, plus 10 % Spielraum – vorher fest 1000, mit der seit 4.4a richtigen
Umrechnung weit unter jedem Preis. Ohne Kurs oder ohne Angebot des Anbieters
kein Deposit („der Preis in SOL wäre geraten“). Rechnet der Anbieter mit einem
Kurs mehr als 10 % neben dem Markt, fragt die App mit beiden Kursen nach.
Nebenbei: Das Betragsfeld des Deposits hieß „lamports“, gelesen wurde SOL –
Platzhalter korrigiert.

**E2E im Browser:** Kurs-Events von drei Absendern plus einem „lauten“, der
zehnmal 900.000 schickt → Kurszeile „1 SOL ≈ 155.000 sats (Median aus 4
Quellen) ⚠ Kursquellen weichen bis 481 % voneinander ab“; Modellkarte,
Schätzung und Zap in beiden Einheiten; Deposit bei einem Anbieter mit
5.000.000 sats/SOL → Rückfrage mit beiden Kursen, abgelehnt → weder Tresor
noch Signatur. Ohne Kurs-Events: Warnung und „(SOL: kein Kurs)“. Die E2Es
der Wallets (§84, §85) laufen weiter grün.

**Tests:** app 240 → 244 (`preis-anzeige.test.ts`: Formate beider Richtungen,
ohne Kurs, Kurszeile mit Warnungen, Deposit-Deckel, Anbieterkurs-Warnung,
Verdrahtung ohne festen Kurs).

Endstand: protocol 1018 · node 179 · app 244 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 88. SOL-Trinkgeld, Teil a: Beleg-Event und Prüfung gegen die Kette (Schritt 4.7)

**Warum:** Für Lightning gibt es NIP-57; für SOL gab es nichts – die App
überwies und zeigte „gesendet“, der Empfänger erfuhr nichts.

**Beleg (`protocol/src/sol-trinkgeld.ts`, Entwurf `docs/NIP-SOL-TIP.md`):**
Kind 9736 (vorläufig, in `kinds.ts` und `docs/PROTOCOL.md` eingetragen) mit
`p`, `sol_tx` (Signatur), `lamports`, `sol_to` (Empfängeradresse), `chain`,
optional `e` (Bezug) und einer Notiz bis 280 Zeichen. Gelesen wird streng:
ganze Zahl ohne Exponent, base58 in fester Länge, bekannte Kette.

**Privat zuerst:** `buildPrivateSolTrinkgeld` versiegelt den Beleg als Kern
eines Gift-Wraps – an den Empfänger und als eigene Kopie. Auf den Relays steht
nur Kind 1059; Signatur und Adresse nur im Umschlag. Öffentlich wird er nur auf
ausdrücklichen Wunsch (App, Teil b).

**Prüfung gegen die Kette:** `pruefeSolUeberweisung` liest die Transaktion
(`RpcPool.getTransaction`, `jsonParsed`): erfolgreich, und die
System-Überweisungen an die genannte Adresse ergeben mindestens den Betrag →
„belegt“. Unbekannte Transaktion (etwa eine erfundene Signatur) →
„unbestätigt“; gescheitert, anderer Empfänger, weniger Geld, fremdes Programm →
„falsch“. Das ist zugleich der Solana-Teil von 4.8.

**4.5 zurückgestellt:** Der Knoten löst heute kein SOL-Deposit ein, frische
Empfangsadressen bräuchten einen Knoten-Seed – beides erst sinnvoll mit dem
Zahlkanal 4.3, der auf die Entscheidung 4.0 wartet.

**Tests:** protocol 1018 → 1022 (`sol-trinkgeld.test.ts`: Tags und
Ablehnungen, manipulierte Events, Umschläge nur für Empfänger und Absender,
Kettenprüfung mit gefälschter Signatur, falschem Betrag und Empfänger,
gescheiterter Transaktion, `getTransaction`-Aufruf). Die fünf neuen Funktionen
sind bis 4.7b begründet ausgenommen.

Endstand: protocol 1022 · node 179 · app 244 · Leak-Tests 35 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 89. SOL-Trinkgeld, Teil b: Beleg senden, empfangen, prüfen (Schritt 4.7)

**Senden (`trinkgeld-beleg.ts`, aufgerufen aus `chat-zap.ts`):** Nach einem
SOL-Trinkgeld geht der Beleg aus 4.7a versiegelt an den Empfänger und als
eigene Kopie. Der Zap-Dialog zeigt bei Solana die Wahl „Beleg öffentlich“ –
nicht vorausgewählt, mit dem Hinweis, dass das Identität, Betrag, Adresse und
Transaktion für alle sichtbar verknüpft. Scheitert der Beleg, sagt die Meldung,
dass das Geld trotzdem unterwegs ist.

**Empfangen (`tabs/kommunikation.ts`):** `oeffneUmschlag()` erkennt nach der
DM auch einen Trinkgeld-Beleg; er erscheint in der Unterhaltung (beide Kopien
eine Zeile) als „◎ Trinkgeld 0,002 SOL ≈ … · wird geprüft …“. Die Prüfung gegen
die Kette (`solTransaktion()` über den RPC-Pool) läuft im Hintergrund und
zeichnet die offene Unterhaltung danach neu: „belegt ✓“, „unbestätigt (…)“ oder
„falsch: …“. Ein Beleg für eine andere Kette als die eingestellte bleibt
unbestätigt; Fehler der RPC nennen nur den Fehlernamen. Der Zeitpunkt kommt aus
dem Kern, nicht aus dem verschleierten Umschlag.

**Datenschutz:** Aussage „sol-trinkgeld“ belegt (Szenario in
`privacy-facts.test.ts`: keine Adresse, keine Signatur, kein Betrag, keine Notiz,
kein Absender auf den Relays); Leak-Szenario `test/leak/trinkgeld.test.ts` über
den echten Versand der App.

**E2E im Browser (zwei Nutzer, externe Test-Wallet, RPC gemockt):** Alice
schickt Bob 0,002 SOL (Kette bestätigt), 0,003 SOL (Kette zeigt nur 1.000
Lamports) und 0,003 SOL öffentlich → die Wahl „öffentlich“ erscheint nur bei
Solana; vor dem Haken kein Kind 9736 auf den Relays, danach genau eines von
Alice; in den Umschlägen weder Adresse noch Signatur. Bob sieht „belegt ✓“,
„falsch: nur 1000 statt 3000000 Lamports“, „belegt ✓“. Der DM-E2E mit Ablauf
(2.5a) läuft unverändert grün.

**Tests:** app 244 → 248 (`trinkgeld-beleg.test.ts`), Leak-Tests 35 → 36;
protocol bleibt 1022 (Szenario in bestehender Schleife, `zeit` ergänzt).

Endstand: protocol 1022 · node 179 · app 248 · Leak-Tests 36 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 90. Belege mit Empfängerprüfung (Schritt 4.8)

**Zwei Lücken im Fee-Beweis:** Eine Lightning-Teilzahlung galt als „belegt“,
sobald ein Preimage zu einem Payment-Hash passte – ein Provider konnte dafür
jede eigene Zahlung vorlegen. Eine Solana-Teilzahlung galt als „belegt“, sobald
*irgendeine* Transaktionssignatur beilag; geprüft wurde nichts.

**bolt11 (`protocol/src/bolt11.ts`):** liest Rechnungen und prüft die Signatur –
aus ihr folgt der Knoten des Empfängers (oder, wenn die Rechnung ihn im Feld
`n` nennt, wird er geprüft). Der Test rechnet aus dem Vektor der BOLT-11-
Spezifikation genau deren Knoten `03e7156a…` zurück; ein geänderter Betrag im
Präfix ergibt einen anderen Knoten (der Betrag ist mitsigniert).

**Fee-Beweis (`fee-proof.ts`):** je Teilzahlung zusätzlich `bolt11` und
`lamports` (angehängt, alte Leser ignorieren sie). Lightning: „belegt“ nur mit
Preimage, Rechnung vom angekündigten Knoten und passendem Betrag; Rechnung
eines anderen Knotens → ungültig; Empfänger ist eine Lightning-Adresse → nur
„angekündigt“ (Verwahrdienste teilen sich Knoten; die Begründung nennt den
Knoten, an den gezahlt wurde); Preimage ohne Rechnung → „angekündigt“.
Solana: `verifyFeeProofMitKette` lädt die Transaktion – belegt nur, wenn sie
mindestens die angekündigten Lamports an den angekündigten Empfänger
überweist; anderer Empfänger oder weniger → ungültig, unbekannt → angekündigt.

**Knoten (`settlement.ts`):** `LnurlPayer` liest die Rechnung vor dem Zahlen
und zahlt nur, wenn sie genau den gewollten Betrag nennt (vorher ungeprüft –
ein LNURL-Server hätte eine teurere unterschieben können); der Hash kommt aus
der signierten Rechnung, das Preimage muss dazu passen; die Rechnung wandert
in den Beleg. Die Abrechnung zahlt an Lightning-Adressen – ihre Teile sind
damit ehrlich „angekündigt, Zahlung an Knoten … belegt“.

**App:** „Zahlung prüfen“ prüft mit der Kette (`solTransaktion`) und zeigt je
Teilzahlung die Begründung; die Erklärung zu „angekündigt“ und die FAQ sagen
jetzt, was „belegt“ heißt.

**Tests:** drei Tests schrieben die alte, zu großzügige Regel fest (Preimage
allein, Signatur allein, „3× belegt“ bei Lightning-Adressen) – die Karte
verlangt die strengere, ihre Erwartungen sind entsprechend. protocol 1022 →
1025 (`bolt11.test.ts`, Fee-Beweis richtiger/falscher Empfänger auf beiden
Schienen), node 179 → 180 (LNURL: teurere und kaputte Rechnung nicht bezahlt,
falsches Preimage fällt auf), app 248 → 249 (Verdrahtung).

Endstand: protocol 1025 · node 180 · app 249 · Leak-Tests 36 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 91. Swaps in beide Richtungen, Teil a: Gegenrichtung im Protokoll (Schritt 4.6)

**Die Gegenrichtung (SOL → Lightning):** Die Wallet des Kunden erstellt eine
Rechnung (R bleibt dort), der Kunde sperrt SOL mit deren Hash für den LP, der
LP prüft Sperre und Rechnung, zahlt und löst mit dem Preimage aus der Zahlung
die SOL ein.

**Fristregel umgekehrt (`timelock.ts`):** In der Hinrichtung muss Lightning
länger laufen als Solana. Hier muss es **vor** Solana enden – sonst hält der
Kunde R zurück, holt nach T_sol seine SOL zurück und nimmt trotzdem die
Lightning-Zahlung an. Weil langsame Blöcke die Frist verlängern, rechnet
`validateReverseTimelock` mit 20 Minuten je Block: `cltv_limit · 20 min + 1 h ≤
T_sol`; `maxCltvLimitFuer` liefert das größte passende Limit.

**Adapter und Mocks:** `createInvoice` (Kunde) und `payInvoice(bolt11,
cltvLimit)` (LP), optional; `MockLightning` kann beides und einen Kunden
simulieren, der R zurückhält.

**Prüfung des LP (`pruefeRueckSwapSperre`)** als eigene Funktion – genau das tut
der LP-Daemon in 4.6b mit echter Kette und Rechnung: Empfänger, Betrag,
Hashlock gleich Rechnungshash, nicht abgeschlossen, Frist lang genug.

**Simulation `runReverseSwap`** mit Fehlerpfaden ohne Verlust: LP zahlt nicht,
Kunde hält R zurück, falscher Hashlock, zu kurze Frist.

**`docs/SWAPS.md`:** beide Richtungen, Fristregeln, Einlösen nur bis T_sol −
10 min ohne `skipPreflight`, Blockadeschutz (Vorab-Gebühr, kurze Fristen),
Relayer für Nutzer ohne SOL, eingeschränkte Macaroon für den LP-Daemon
(`lncli bakemacaroon … info:read invoices:read invoices:write offchain:read
offchain:write`, nie `admin.macaroon`).

**Tests:** protocol 1025 → 1030 (`swap-umgekehrt.test.ts`). Die vier neuen
Exporte sind bis 4.6b/c begründet ausgenommen.

Endstand: protocol 1030 · node 180 · app 249 · Leak-Tests 36 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 92. Swaps in beide Richtungen, Teil b: LP-Daemon in der Gegenrichtung (Schritt 4.6)

**Gegenrichtung im Daemon (`lp-daemon.ts`, Angebot `buy-sol`):** Der Kunde
sperrt SOL für den LP und schickt nur Angebot und Rechnung. Der LP liest die
Rechnung (`leseBolt11` – Signatur, ganzer sats-Betrag im Angebot), findet die
Sperre unter `rueckSwapId(bolt11)`, prüft sie mit `pruefeRueckSwapSperre`
(Empfänger = eigenes SOL-Konto, Betrag = `rueckSwapLamports`, Hashlock =
Rechnungshash, Frist) und zahlt über LND mit `cltv_limit` = kleinstes von
Angebot und `maxCltvLimitFuer(T_sol − jetzt)`. Mit dem Preimage löst er ein –
nur bis T_sol − 10 min, sonst `ZU_SPAET`.

**Swap-ID = SHA-256 der Rechnung:** Wer die Sperre auf der Kette sieht, kennt
H. Ohne diese Bindung könnte er dem LP eine eigene Rechnung mit H schicken –
der LP zahlte, die Zahlung hinge bis zum `cltv_limit`, und der echte Kunde
bekäme „schon bearbeitet“. Test „Vorwegnahme“.

**Sperrbetrag ganzzahlig (`rueckSwapLamports`):** In Fließkomma ergibt 1000 sats
· 0,1 Lamport/sat · 10 % Gebühr 111 statt 110 – App und LP lägen ein Lamport
auseinander, und der LP zahlte nie. Jetzt BigInt, eine Funktion für beide.

**Kein Preimage verlieren:** Sitzung wird **vor** dem Zahlen gespeichert
(`rueckSpeicher`, `~/.freedom/lp-rueck.json`, 0600, über Zwischendatei). Bricht
die Verbindung zu LND ab oder startet der Daemon neu, fragt er den Stand ab
(`LndLightningAdapter.zahlungsstand`, `/v2/router/track`): erfolgreich →
Preimage (geprüft gegen den Hash) übernehmen und einlösen; gescheitert oder nie
angekommen und Frist vorbei → abschließen. Eine hier laufende Zahlung wird nicht
nachgeschlagen; gezahlt wird nie ein zweites Mal.

**Blockadeschutz der Gegenrichtung:** höchstens `LP_MAX_OFFENE_ZAHLUNGEN`
(Standard 3) Zahlungen gleichzeitig in der Schwebe; `cltv_limit` nie länger als
die Sperre erlaubt. Die Vorab-Gebühr der Hinrichtung ändert deren Ablauf (LP +
App) und ist jetzt eigener Schritt 4.6d.

**Antworten:** Status `EINGELOEST`, `GESCHEITERT`, `ZU_SPAET`, `ABGELEHNT` – nur
mit festen eigenen Texten; Meldungen von LND (Routen, Guthaben) bleiben beim LP.
Kommt eine Anfrage vor der bestätigten Sperre, prüft der LP sie 10 Minuten lang
bei jedem Durchlauf erneut. Fremde Rechnungen landen nicht im Log (die
bech32-Bibliothek zitiert sie in ihren Fehlermeldungen).

**LND-Adapter:** `payInvoice(bolt11, cltvLimit)` mit `cltv_limit` (ohne
gültiges Limit geht nichts raus), `zahlungsstand()` (liest nur den ersten
vollständigen Eintrag des Stroms; „payment isn't initiated“ = unbekannt, ein
Rechtefehler bleibt ein Fehler). Das Preimage liefert `lnrpc.Payment` als
Hex-Text – bisher wurde es als base64 gelesen; `preimageAusLnd` nimmt beides
und besteht auf 32 Byte.

**Angebot:** Die Gegenrichtung braucht beim Kunden das SOL-Konto des LP und
dessen genauen Kurs – beides stand in keinem Event. Das LP-Angebot (Kind 38001)
trägt jetzt optional `sol_address` und `lamports_per_sat`, bei `buy-sol`
Pflicht (`parseLpOffer` lehnt sonst ab). Nebenbefund: Das Angebot wurde nur
beim Start veröffentlicht (Gültigkeit 2 h) und nie erneuert, obwohl der
Kommentar es sagte – nach zwei Stunden verschwand jeder LP aus der App.
`erneuereAngebot()` veröffentlicht zur Hälfte der Gültigkeit neu.

**Verdrahtung (`main.ts`):** `LP_DIRECTION=sell-sol|buy-sol|beide` (ein Daemon
je Richtung), SOL-Konto des LP = Schlüssel aus `SOLANA_KEYPAIR`, Speicher,
`lp.erneuereAngebot()` und `lp.nachholen()` in der Schleife. Drei 4.6a-Ausnahmen der Verdrahtungsprüfung
entfallen (jetzt verdrahtet).

**Tests:** protocol 1030 → 1037 (`lnd-adapter.test.ts` +5,
`swap-umgekehrt.test.ts` +1, `nostr-order.test.ts` +1), node 180 → 199
(`lp-daemon.test.ts` +1 Erneuerung; `lp-rueck.test.ts`, 18 Tests: Erfolg,
Angebot mit Konto und Kurs, `cltv_limit` aus der Frist, acht Ablehnungsgründe je mit Antwort
(fremdes Angebot still), Anfrage vor der Sperre,
kaputte Rechnung, Vorwegnahme, doppelte Rechnung, Scheitern, zu spät,
Verbindungsabbruch, falsches Preimage von LND, Neustart, nie angekommen,
Blockadeschutz, Dateispeicher 0600, Verdrahtung).

Endstand: protocol 1037 · node 199 · app 249 · Leak-Tests 36 grün + 3 todo · 0
rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 93. Swaps in beide Richtungen, Teil c: SOL → sats in der App, Rückholen (Schritt 4.6)

**Angebotsliste:** Zeilen per DOM und `textContent` statt `innerHTML` (zwei
Ausnahmen weniger), mit Richtung („SOL → sats“ / „sats → SOL“). Die Gebühr
stand als `feePpm / 100` Prozent da – 3000 ppm (0,30 %) hießen „30.0%“.

**Ablauf SOL → sats (`rueck-swap.ts`, `startRueckSwap()`):** planen, bevor
etwas gesperrt wird (`planeRueckSwap`: Angebot mit Konto und Kurs, Betrag im
Rahmen, Rechnung mit genau diesem Betrag, Frist = `lnCltvDeltaBlocks` · 20 min
+ 1 h + 30 min Puffer, höchstens eine Woche). Die Rechnung erstellt die
NWC-Wallet (sonst einfügen); ihr Preimage bleibt dort. Dialog mit Betrag,
Gebühr, Kurswarnung gegen den Markt und Rückgabezeitpunkt. Dann: Sperre
merken → `lockRueckSwap` → Anfrage vom Wegwerf-Schlüssel (nicht npub, keine
SOL-Adresse) → Antwort des LP anzeigen. `ZU_SPAET` heißt: Der LP hat gezahlt –
der Text sagt das, statt „nicht getauscht“ zu behaupten.

**Rückhol-Wächter verdrahtet:** `refund-watcher.ts` gab es seit Langem, aber
nichts rief ihn auf – FAQ und Whitepaper versprachen trotzdem ein
automatisches Zurückholen. Jetzt startet er, sobald eine Solana-Wallet
verbunden ist; gemerkt werden Rück-Swaps und Deposits, jeweils **vor** dem
Sperren. Vor jeder Rückholung fragt er die Kette (`offen()`): eingelöste oder
nie angelegte Sperren ohne Wallet-Dialog abschließen, sonst nur die offenen in
die Transaktion (vorher riss eine eingelöste die offene mit). Ablage über
`setzeSperrSpeicher(geheim)`, beim Einrichten des Tresors wandert
`freedom.pending.*` mit hinein. FAQ und Whitepaper sagen jetzt, was gilt: Die
App holt zurück, solange sie offen und die Wallet verbunden ist.

**Zwei Fehler, die erst der Browser zeigte** (E2E mit Wallet-Standard-Wallet,
nachgebildeten Relays und RPC):
- Wallet-Standard-Wallets (4.2c) haben kein `publicKey`-Feld; `solWallet.provider`
  wurde direkt als Signierer übergeben – Einlösen, Deposit, Deposit-Rückholung
  brachen mit „reading 'toBase58'“ ab. Jetzt `htlcSigner()` mit der Adresse aus
  der Verbindung, an allen fünf Stellen.
- `AnchorSolanaHtlc.get()` las Frist und Betrag mit `readBigInt64LE`, das dem
  Buffer-Polyfill im Browser fehlt – jede Prüfung einer Sperre in der App
  scheiterte, auch die der Hinrichtung vor dem Bezahlen. Jetzt `DataView`;
  Regressionstest entfernt die Methoden wie im Browser.

**Datenschutz:** Die Anfrage der Gegenrichtung trägt die Rechnung offen (der LP
liest nur offene Anfragen). Neues Leak-Szenario `test/leak/rueck-swap.test.ts`:
nicht vom npub, keine SOL-Adresse (grün), keine Rechnung (`todo` 4.9); im
Bericht als offene Aussage „Beim Tausch SOL → sats sehen Relays deine
Lightning-Rechnung nicht (4.9)“.

**Tests:** protocol 1037 → 1038 (`solana-lesen.test.ts`), app 249 → 260
(`rueck-swap.test.ts` 6, `sol-htlc.test.ts` +2, `refund-watcher.test.ts` +3),
Leak-Tests 36 → 37 grün, `todo` 3 → 4. Browser-E2E: Wächter holt eine fällige
Sperre zurück, Angebot mit Richtung und 1,00 %, Sperre mit richtigem Programm,
Kunde, LP, PDA, Hashlock und 1.010.000 Lamports, Anfrage vom Wegwerf-Schlüssel,
„Fertig: 10000 sats“; Regression Wallet Standard (4.2c) grün.

Endstand: protocol 1038 · node 199 · app 260 · Leak-Tests 37 grün + 4 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 94. Swaps in beide Richtungen, Teil d: Vorab-Gebühr der Hinrichtung (Schritt 4.6)

**Warum:** In der Hinrichtung (sats → SOL) sperrt der LP zuerst. Wer Anfragen
schickt und nie bezahlt, bindet seine Liquidität bis T_sol – für nichts als
die eigenen Relay-Events.

**LP (`lp-daemon.ts`):** Nennt das Angebot `vorab_sats` (`LP_VORAB_SATS`,
Standard 10, 0 = aus), antwortet der LP auf eine gültige Anfrage zuerst mit
`["status", "VORAB"]`, `["vorab_sats", N]` und einer normalen Rechnung
(`LndLightningAdapter.createInvoice`, 10 Minuten gültig). Bei jedem Durchlauf
sieht er nach (`vorabPruefen`): bezahlt → jetzt sperren und die Hold-Invoice
stellen (`sperreUndStelle`, der Teil von `handleRequest` ab dem Sperren);
unbezahlt nach `VORAB_FRIST_SECS` → verwerfen, auch eine spätere Zahlung
sperrt nichts mehr. Scheitert das Sperren nach der Zahlung, antwortet er
`ABGELEHNT`. Die Gebühr mindert den Tausch nicht.

**App (`tabs/waehrung.ts`, `swap-client.ts`):** `pollSwapResponse` liest nur
noch Antworten des LP selbst (`authors: [lpPubkey]`) – bisher las es jede
Antwort auf die Anfrage, also hätte auch ein Fremder eine „Vorab-Rechnung“
schicken können. `pruefeVorab()`: nur wenn das Angebot die Gebühr nannte, genau
in dieser Höhe, höchstens 1000 sats, Rechnung gültig signiert und über genau
diesen Betrag. Dann Dialog, dann `zahle(zahlschienen(), …)` mit Zweck `swap`.
`ABGELEHNT` wird angezeigt.

**Browser-E2E** (WebLN nachgebildet, Relays und RPC nachgebildet): Angebot
„sats → SOL · 0.30 %“, Tresor eingerichtet, Anfrage, Dialog „vorab 10 sats“,
bezahlt wird genau die Rechnung des LP – die eines Fremden nicht –, danach
Hold-Invoice, Sperrprüfung auf der Kette „Geprüft“, Zahl-Link frei. Damit lief
die Hinrichtung erstmals ganz im Browser, einschließlich des `DataView`-Fixes
aus 4.6c.

**Tests:** protocol 1038 → 1040 (`nostr-order` +1, `lnd-adapter` +1), node
199 → 202 (`lp-daemon` +3: erst Rechnung, dann Sperre; Frist; Angebot), app
260 → 263 (`swap-vorab.test.ts`).

Endstand: protocol 1040 · node 202 · app 263 · Leak-Tests 37 grün + 4 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 95. Swaps in beide Richtungen, Teil e: Relayer für Nutzer ohne SOL (Schritt 4.6)

**Problem:** Wer per Lightning SOL kauft, hat oft noch keins – und kann die
Gebühr der Einlösung nicht zahlen. Ein Relayer zahlt sie als `feePayer`, der
Empfänger signiert weiterhin selbst (das Programm verlangt nur seine
Signatur). Die Signatur deckt alle Anweisungen: Der Relayer kann nichts
umleiten, nur ablehnen. Er bekommt seine Auslagen in derselben Transaktion
zurück.

**Protokoll (`relayer.ts`):** Angebot Kind 38032 (`sol_address`,
`erstattung_lamports`, `kette`); Auftrag und Antwort versiegelt (NIP-59, innen
25010/25011, ohne Zeitversatz), weil die Transaktion das Preimage trägt.
`pruefeRelayAuftrag` lässt nur durch: Einlösung beim HTLC-Programm, danach
Erstattung vom Empfänger an den Relayer (mindestens sein Satz), Relayer nur
Gebührenzahler und in keiner Einlösung, Empfänger hat gültig signiert – eine
nach dem Signieren veränderte Erstattung fällt an der Signatur auf.
`mieteReicht` prüft die Mindestmiete des Empfängerkontos. `HTLC_PROGRAMM_ID`
wird exportiert (Wert unverändert).

**Knoten (`relayer-dienst.ts`, `main.ts`):** `RELAYER_ENABLED=1` veröffentlicht
das Angebot und arbeitet Aufträge in der Schleife ab: prüfen, mitsignieren,
mit Vorabsimulation senden (nie `skipPreflight`), Grenze je Stunde. Ins Log
nur Status und Fehlername – Fehlermeldungen der Kette können die Transaktion
zitieren.

**Risiko, offen benannt (`docs/SWAPS.md`):** Der Relayer kennt das Preimage vor
der Einlösung. Die App (4.6f) nimmt deshalb nie den LP selbst und versucht
rechtzeitig den nächsten Relayer.

**Tests:** protocol 1040 → 1045 (`relayer.test.ts`: gültiger Auftrag, elf
Ablehnungsgründe, Angebot, versiegelte Antwort nur vom richtigen Relayer zum
eigenen Auftrag, Mindestmiete), node 202 → 209 (`relayer-dienst.test.ts`:
mitsigniert und gesendet, ungültig abgelehnt, Grenze, kein Preimage im Log,
fremde Umschläge liegen lassen, Angebot, Verdrahtung).

Endstand: protocol 1045 · node 209 · app 263 · Leak-Tests 37 grün + 4 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 96. Swaps in beide Richtungen, Teil f: Einlösen über Relayer in der App (Schritt 4.6 – Code fertig)

**Ablauf (`relay-einloesung.ts`, `einloesenUeberRelayer()` in `tabs/waehrung.ts`):**
Beim Einlösen fragt die App das Guthaben der Wallet. Unter 10.000 Lamports
sucht sie Relayer-Angebote (Kind 38032) derselben Kette, je Schlüssel das
neueste, günstigster zuerst, Erstattung höchstens 50.000 Lamports – und nie den
LP dieses Swaps, weder über seinen Nostr-Schlüssel noch über sein SOL-Konto
(er bekäme sonst das Preimage vor der Einlösung). Mindestmiete prüfen, einmal
zustimmen lassen, Einlösung + Erstattung bauen, die Wallet signiert, die App
prüft den Auftrag selbst mit `pruefeRelayAuftrag` (sonst legte ein abgelehnter
Auftrag das Preimage umsonst offen), versiegelt ihn vom Wegwerf-Schlüssel.
Erledigt ist es erst, wenn die Kette die Signatur bestätigt; bei Ablehnung
sofort, sonst nach 90 s der nächste Relayer – nur mit mehr als 15 Minuten bis
`T_sol`. `activeSwap` kennt dafür jetzt LP und Betrag.

**Fehler, den erst der Browser zeigte:** `pruefeRelayAuftrag` las die
Erstattung mit `readBigUInt64LE` – im Buffer-Polyfill nicht vorhanden, die
Selbstprüfung der App scheiterte still. Jetzt `DataView`; Test entfernt die
Methoden wie im Browser. CLAUDE.md: gilt auch für Protokoll-Code, den die App lädt.

**Browser-E2E:** sats → SOL mit leerer Wallet bis zur Einlösung: Dialog „Ein
Relayer zahlt sie“, genau ein versiegelter Auftrag an den richtigen Relayer –
der LP, der ebenfalls ein Relayer-Angebot hatte, bekam keinen –, Auftrag besteht
die Relayer-Prüfung (Einlösung + 10.000 Lamports), nach dem Mitsignieren
vollständig signiert, Preimage passt zum Hashlock, „Eingeloest“.

**4.6 im Code fertig:** a Protokoll der Gegenrichtung, b LP-Daemon, c App
SOL → sats und Rückhol-Wächter, d Vorab-Gebühr, e Relayer (Protokoll + Knoten),
f Einlösen über Relayer. Offen bleiben MENSCH-Aufgaben (Devnet + Polar,
Relayer betreiben) und die Rechnung in der offenen Anfrage (4.9).

**Tests:** protocol 1045 → 1046, app 263 → 268 (`relay-einloesung.test.ts`).

Endstand: protocol 1046 · node 209 · app 268 · Leak-Tests 37 grün + 4 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## 97. Releases k von n (Schritt 5.2)

**k von n (`release.ts`):** Eine Datei gilt erst als echt, wenn
`RELEASE_MIN_SIGNATUREN` (2) verschiedene Signierer aus `TRUSTED_SIGNERS`
dieselbe Nutzlast bestätigen. Nostr-Events tragen je eine Signatur; „mehrere
Signaturen über dieselbe Nutzlast“ heißt deshalb: jeder Signierer
veröffentlicht sein Manifest (Kind 38054), die App zählt je `nutzlast()`
(Version + Dateien mit Prüfsumme, sortiert) die verschiedenen
vertrauenswürdigen Signierer. Fremde Signaturen zählen nicht, derselbe
Signierer nur einmal; Quellen und Notizen dürfen je Signierer abweichen. Mit
nur einer Signatur: „erst von 1 von 2 Signierern bestätigt“. `latestRelease`
kündigt nur Versionen mit k Signaturen an – sonst könnte ein einzelner
gestohlener Schlüssel ein „Update“ melden.

**Version fixierbar:** GitHub Pages liefert bei jedem Laden still die neueste
Datei aus. Nach einer bestandenen Prüfung kann der Nutzer die Version fixieren
(Settings → Weitergeben); beim Start vergleicht die App die laufende Datei
(`pruefeFixierung`): bestätigte neue Version → Rückfrage, ob übernehmen;
unbestätigte → deutliche Warnung. Ohne Fixierung passiert nichts. Im Browser
geprüft (lokaler HTTP-Server): Warnung erscheint, ohne Fixierung still.

**Skript:** `publish-release.mjs` zeigt den Nutzlast-Hash, damit die Signierer
abgleichen können, und erklärt k von n. **FAQ** sagt dasselbe – und ehrlich,
dass die Prüfung „nicht prüfbar“ meldet, solange `TRUSTED_SIGNERS` leer ist.

**Tests:** protocol 1046 → 1051 (`release.test.ts` +5: eine Signatur → nicht
echt, zwei → echt; fremde und doppelte zählen nicht; nur gleiche Nutzlast;
keine Ankündigung mit einer Signatur; Fixierung). Vier bestehende Tests
belegen „echt“ jetzt mit zwei Signierern statt einem – die Karte verlangt,
dass eine einzelne Signatur nicht mehr reicht; ihre Aussage ist unverändert.
app 268 → 269 (Verdrahtung).

Endstand: protocol 1051 · node 209 · app 269 · Leak-Tests 37 grün + 4 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## Schritt 4.9a – Swap-Anfragen und -Antworten versiegelt (Protokoll + Knoten)

**Entscheidungen 26.09.2026 (MENSCH):** 4.9 Variante A (frische
Empfangsadressen, Trinkgeld-Adresse versiegelt auf Anfrage, Profilfeld optional
mit Warnung – gesendete Zahlungen von frischen Adressen sind nicht Teil davon,
weil das Auffüllen die Adressen auf der Kette wieder verknüpft); 2.2a MLS: A
(MDK per WASM); 4.1c: KI-Aufträge bezahlen – ja, nach 4.0; 4.2c Mobile Wallet
Adapter: später mit 6.1. 4.0 ist noch in Diskussion (Vorschlag „A+“: feste
Aufteilung direkt beim Zahlen an alle Beteiligten, kein Topf). Neue
Konvention seit „Zwei Spuren“: Abschnitte ohne laufende Nummer.

4.9 ist über 400 Zeilen und in fünf Teile geteilt (Karte). **a** schließt die
Lücke auf der Leitung, die alle Swaps offen ließen: Anfrage (Kind 25001) und
Antwort (25002) standen offen auf den Relays – die SOL-Empfangsadresse neben
dem npub, in der Gegenrichtung die Rechnung, in jeder Antwort Swap-ID und
Rechnung des LP (über die Swap-ID findet jeder die Sperre und ihren Empfänger).

**Protokoll:** `swap-versiegelt.ts` – derselbe Kern im Umschlag (NIP-59) von
einem Wegwerf-Schlüssel an den LP (`versiegleSwapAnfrage`/`oeffneSwapAnfrage`),
die Antwort ebenso zurück (`versiegleSwapAntwort`/`oeffneSwapAntwort`: nur vom
erwarteten LP, nur zur eigenen Anfrage). Ohne Zeitversatz – der LP liest die
letzte Stunde. Kerne werden streng geprüft (Kind, Absender = Siegel, Tags nur
Texte, Inhalt ≤ 5000 Zeichen). Angebot: `["versiegelt", "1"]`.

**Knoten:** Der LP-Daemon liest zusätzlich Umschläge an seinen Schlüssel, öffnet
jeden nur einmal (Zwischenspeicher zwei Stunden) und bearbeitet den Kern wie
eine offene Anfrage; geantwortet wird so, wie gefragt wurde – auch VORAB,
Ablehnungen und Stände der Gegenrichtung. Versiegelte Sitzungen der
Gegenrichtung bleiben es nach einem Neustart (`versiegelt` im Speicher). Offene
Anfragen gehen für ältere Apps weiter. Der KI-Teil desselben Knotens meldet
Swap-Umschläge im Log als „verworfen“ (keine Rechenarbeit) – harmlos.

**Tests:** protocol 1051 → 1056 (`swap-versiegelt.test.ts` 4: nur der LP
öffnet, kein Klartext im Umschlag, fremde Kerne → null, Antwort nur vom LP zur
eigenen Anfrage; `nostr-order.test.ts` +1), node 209 → 214
(`lp-versiegelt.test.ts` 5: Angebot, Hinrichtung, Vorab, fremde Umschläge,
Gegenrichtung samt Ablehnung – in keinem Fall steht Adresse, Rechnung oder
Swap-ID offen). Die App-Seite folgt in 4.9b; bis dahin zwei begründete
Ausnahmen in `wiring-ausnahmen.txt`.

Endstand: protocol 1056 · node 214 · app 269 · Leak-Tests 37 grün + 4 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## Schritt 4.9b – Die App tauscht nur noch im Umschlag

Die App-Seite zu 4.9a. Bis hierhin sendete die Hinrichtung (sats → SOL) ihre
Anfrage **vom eigenen npub** mit der SOL-Empfangsadresse offen auf die Relays;
die Gegenrichtung sendete schon vom Wegwerf-Schlüssel, aber mit der Rechnung;
beide lasen offene Antworten mit Swap-ID und Rechnung des LP.

**Neu:** `swap-umschlag.ts` (ohne DOM) – `hinAnfrage()` und `rueckAnfrage()`
versiegeln die Anfrage von einem neuen Wegwerf-Schlüssel je Swap an den LP,
`swapAntworten()` öffnet nur Umschläge an diesen Schlüssel, nur vom LP und nur
zu dieser Anfrage (offene Antworten zählen nicht mehr), `liestUmschlaege()`
prüft das Angebot. In `waehrung.ts`: `startSwap()`/`pollSwapResponse()` und
`startRueckSwap()`/`warteAufRueckAntwort()` darauf umgestellt; die
Angebotsliste zeigt LPs ohne `["versiegelt", "1"]` als „veraltet“ (Knopf aus)
– ihnen ginge die Anfrage offen zu. Entfernt, weil tot: `baueRueckAnfrage`,
`KIND_RUECK_*`, `KIND_SWAP_REQUEST/RESPONSE` in der App; die zwei
Verdrahtungs-Ausnahmen aus 4.9a sind wieder weg.

**Datenschutz:** Leak-`todo` „Swap: keine SOL-Adresse“ und „Tausch SOL → sats:
keine Rechnung“ sind normale Tests und grün, neu „Swap: nicht vom eigenen npub“
und die Verdrahtung der Gegenrichtung. Aussagen „sol-adresse“ (mit ehrlichem
Zusatz: ein ausdrücklich öffentlicher Trinkgeld-Beleg führt über die Kette zur
Adresse) und „swap-rechnung“ sind belegt – Szenario in `privacy-facts.test.ts`
mit beiden Richtungen und Antworten.

**Browser-E2E** (Playwright, nachgebildete Relays/RPC, LP öffnet die Umschläge):
Hinrichtung mit Vorab-Gebühr bis „Geprüft“ – versiegelte Anfrage, nur die
Rechnung des LP bezahlt, eine fremde versiegelte „Vorab-Rechnung“ nicht, der
veraltete LP nicht anfragbar, und auf den Relays weder SOL-Adresse noch
Vorab-/Hold-Rechnung noch Swap-ID noch npub in Swap-Events; Gegenrichtung bis
„Fertig: 10000 sats“ samt Rückhol-Wächter, keine offene Anfrage, Rechnung nie
sichtbar; Einlösen über Relayer (4.6f) weiter grün – an den LP geht genau ein
Umschlag, die Swap-Anfrage, nie der Relay-Auftrag.

**Tests:** app 269 → 273 (`swap-umschlag.test.ts` 4), Leak-Tests 37 + 4 todo →
41 + 2 todo (übrig: Räume 2.3, frische Absenderadresse 4.9).

**Knoten-Stand:** Die App fragt nur LPs ab 4.9a an – der GX10-LP muss auf `main`.

Endstand: protocol 1056 · node 214 · app 273 · Leak-Tests 41 grün + 2 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## Schritt 4.9c – Frische Empfangsadressen der eingebauten Wallet

Entscheidung 4.9 A verlangt frische **Empfangs**adressen. Bis hierhin gab es
sie nur dem Anschein nach: `startSwap()` schlug „eine frische Adresse Nummer n“
vor, zeigte aber nur ihren Fingerabdruck (HKDF aus dem Nostr-Schlüssel) – die
Adresse selbst sah niemand, und einlösen hätte die App dorthin nicht können.

**Wallet (`sol-wallet.ts`):** Beim Einrichten leitet sie außer der Hauptadresse
einen Vorrat von 20 frischen Adressen ab – Phantoms Konten 1–20 aus denselben
Wörtern (SLIP-10, wie 1.1). Die Wörter bleiben ungespeichert, deshalb ein
Vorrat statt Ableitung bei Bedarf; `vorratErgaenzen()` leitet mit den Wörtern
die nächsten ab (auch für Wallets von vor 4.9c) und prüft, dass sie dieselbe
Wallet ergeben. `frischeAdresse()` vergibt, bevor die Adresse herausgeht.
`signiere()` signiert für jede eigene Adresse, die die Transaktion verlangt.
`waehleAbsender()` zahlt von einer einzelnen Adresse, die allein reicht und
danach leer oder mietfrei ist – nie zusammenlegen. Ablage unter
`freedom.solWallet.vorrat` (fällt unter das Tresor-Präfix).

**App:** Tausch sats → SOL schlägt eine frische Adresse vor (vorbelegt, sonst
die verbundene Wallet); Einlösen nur mit dem Schlüssel der Empfangsadresse –
verbundene oder eingebaute Wallet (`eingebauterHtlcSigner`), ohne SOL über
einen Relayer (4.6f). Vorher versuchte es die App mit jeder verbundenen
Wallet, auch wenn die Adresse eine andere war. Solana-Schiene: `absender()`
wählt die Adresse (`rails.ts`, `zahlschienen.ts`). Wallet-Tab: Guthaben über
alle Adressen („auf N Adressen verteilt“), Vorrat, „frische Adresse“
(kopieren) und „neue ableiten“. FAQ und Hinweistext angepasst.

**Browser-E2E:** eingebaute Wallet eingerichtet (Tresor, 12 Wörter) → Tausch
schlägt `Hh8Qw…` vor (Phantoms Konto 1) → versiegelte Anfrage → Sperre an diese
Adresse → Einlösen über den Relayer, signiert mit ihrem Schlüssel → „Eingelöst“,
Vorrat 20 → 19; keine eigene Adresse offen auf den Relays.

**Tests:** app 273 → 279 (`sol-wallet-frisch.test.ts` 6), Leak-Tests 41 → 43
(`leak/sol-empfang.test.ts`: jeder Tausch an eine frische Adresse). Die alte
HKDF-Ableitung (`deriveSwapAddress`, `addressFingerprint`) ist in der App nicht
mehr in Gebrauch – begründete Ausnahme in `wiring-ausnahmen.txt`.

Endstand: protocol 1056 · node 214 · app 279 · Leak-Tests 43 grün + 2 todo ·
0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## Schritt 7.1a – Mesh nur verschlüsselt, Teil a: Regel, Sendezeit, Planer

Funk hört jeder in Reichweite mit, und ein Sender lässt sich anpeilen. Bisher
durfte über Mesh alles: Kind-4-DMs, Raumnachrichten im Klartext, Profile – jedes
mit dem Schlüssel des Absenders –, dazu Klartext- und Ecash-Pakete. Das verrät,
wer wo sendet.

**Eine Regel (`mesh-transport.ts`):** `pruefeMeshInhalt(nutzlast, art, {
eigeneSchluessel })` lässt nur zu: einen Umschlag nach NIP-59 (Kind 1059, gültig
signiert, Inhalt in der Form von NIP-44 v2, genau ein Empfänger, sonst nur
Ablauf und Rechenarbeit – jedes weitere Tag könnte Klartext tragen), eine
vollständig signierte Solana-Transaktion (`pruefeSolanaTx`: Legacy und v0, jede
verlangte Signatur mit ed25519 gegen Konto und Nachricht geprüft, höchstens
1.232 Byte) und die Bestandsmeldung des Abgleichs (nur Filter-Bits). Klartext
und Ecash nie – ein Ecash-Token ist Bargeld für jeden, der mithört. Beim Senden
darf kein eigener Schlüssel im Paket stehen, auch nicht als Empfänger: die
eigene Kopie einer DM verriete über Funk, wem das Gerät gehört. Knoten reichen
Klartext- und Ecash-Rahmen nicht mehr weiter (`ForwardingCache`).

**Sendezeit:** `Sendezeitkonto` – EU 868 MHz, 1 % je Stunde (ETSI EN 300 220),
gleitendes Fenster; `wartezeit()` sagt, wie lange das Gerät schweigen muss,
`dauer()` schätzt ehrlich (über dem Budget hundertmal langsamer). Der Planer
(`planSync`) füllt über Funk nur bis zur freien Sendezeit (Standard 36 s ≈ 7 KB,
also wenige Umschläge) und zählt die Rahmenköpfe mit (`luftBytes`).

**Planer nur mit Umschlägen:** Profile, Räume (bis 2.3), Code, Gewichte,
offene Zahlungsbelege und Kind 4 nennt der Plan mit Grund, sendet sie aber
nicht – über keine Strecke.

**Leak-Regel** `mesh-verschluesselt`: Schlüssel des Nutzers als Hex, npub oder
32 Byte roh, dazu Klartext, in Rahmen und zusammengesetzten Nutzlasten. Aussage
„mesh“ steht als offen im Bericht, bis die App sie in 7.1b einhält.

**Aufteilung:** a (dieser Teil) Protokoll; b verdrahtet die App (Funkknoten
prüft beim Senden und Empfangen und hält die Sendezeit ein, Bluetooth-Funkgeräte
zählen als Funk, Chat-Export nur mit Umschlägen und ohne npub, ehrliche Texte in
App und Website, Abnahmetest mit Mitschnitt). MLS-Nachrichten kommen mit 2.2b
dazu. `offline-queue.ts` aus der Karte gibt es seit 4.1b nicht mehr.

**Tests:** protocol 1051 → 1064 (Regel: Umschlag ja, eigene Kopie nein, offene
Kinds/Klartext/Ecash nein, Zusatz-Tag/verändert/Klartext-Inhalt nein,
Bestandsmeldung; Solana signiert/unsigniert/verfälscht/zu groß, v0; keine
Weitergabe von Klartext; Sendezeitkonto, Dauer, Luft-Byte; Planer: nur
Umschläge, Zusatz-Tags, 1 % Sendezeit, Rahmenköpfe, großer Umschlag verdrängt
keine kleinen; Leak-Regel). Bestehende Tests zu Planer, Weiterleitung und
Abgleich (Protokoll, App, Knoten) belegen dasselbe jetzt mit Umschlägen statt
Kind 4 bzw. mit verschlüsselter Paketart; drei sagen jetzt das Gegenteil, weil
die Karte die Funktion entfernt: Code und Profile gehen über keine Mesh-Strecke
mehr, und nur die Umschlag-Klasse hat Strecken. node 208 (+ 7 übersprungen; eine Live-Prüfung
überspringt sich ohne Netz – Gesamtzahl 215 unverändert), app 269.

Endstand (nach dem Einmergen von 4.9a–c): protocol 1069 · node 213 (+ 7
übersprungen ohne Netz) · app 279 · Leak-Tests 43 grün + 2 todo · 0 rot ·
check-wiring `--streng` 0 offen (3 neue Ausnahmen bis 7.1b) · innerHTML streng 0
unbewertet · Smoke-Test bestanden.

## Schritt 4.9d – Trinkgeld-Adresse versiegelt anfragen

Bis hierhin las das SOL-Trinkgeld die Adresse aus dem öffentlichen Profil
(`sol` in Kind 0): jedes Trinkgeld war für jeden mit dem Empfänger verknüpft,
und alle landeten auf derselben Adresse. Entscheidung 4.9 A: nur noch
versiegelt auf Anfrage, das Profilfeld optional mit Warnung.

**Protokoll:** `trinkgeld-adresse.ts` – Anfrage (Kind 25020, von der Identität
des Gebers) und Antwort (25021, mit `sol_address` und `kette`), beide im
Umschlag ohne Zeitversatz; der Geber nimmt nur die Antwort des gefragten
Empfängers zu seiner Anfrage; streng gelesen (Kette, Adresse, Kern).

**App (`trinkgeld-adresse.ts`):** Geber – gemerkte Adresse dieses Empfängers,
sonst versiegelt anfragen und bis 75 s warten (Status im Zap-Dialog); ohne
Antwort das Profilfeld nur nach deutlicher Rückfrage, sonst Eingabe.
Empfänger – `kommunikation.ts` erkennt Anfragen im Posteingang
(`alsAdressAnfrage`) und antwortet nur bekannten Kontakten, nur auf Anfragen
der letzten 15 Minuten, mit einer eigenen, stabilen Adresse je Kontakt aus dem
Vorrat der eingebauten Wallet (4.9c) – so leert niemand den Vorrat, und keine
zwei Kontakte sehen dieselbe. Der Posteingang wird jetzt jede Minute
abgeglichen, solange die App offen ist (vorher nur beim Öffnen der Chatliste).

**Browser-E2E mit zwei Browsern:** Bob richtet die eingebaute Wallet ein und
lässt die App offen; Alice gibt 0,002 SOL Trinkgeld – ihre App fragt
versiegelt, Bobs App antwortet mit seinem Konto 1 (`Hh8Qw…`), Alice zahlt
dorthin; das zweite Trinkgeld braucht keine neue Anfrage (gemerkt); Bob sieht
beide Belege „belegt ✓“ – geprüft gegen die frische Adresse, nicht gegen die
im Profil; die Adresse steht nie offen auf den Relays; Bobs Vorrat 20 → 19.

**Tests:** protocol 1056 → 1058 (`trinkgeld-adresse.test.ts` 2; Szenario
„sol-trinkgeld-adresse“ belegt), app 279 → 282 (`trinkgeld-adresse.test.ts` 3),
Leak-Tests 43 → 44. Ein Verdrahtungstest aus 4.7b prüft die Zeile jetzt samt
Adress-Anfrage (gleiche Aussage).

Endstand (nach dem Einmergen von 7.1a): protocol 1071 · node 214 · app 282 ·
Leak-Tests 44 grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 7.1b – Mesh nur verschlüsselt, Teil b: App – 7.1 Code fertig

**Funkknoten (`mesh-radio.ts`):** `MeshNode.enqueue()` prüft mit
`pruefeMeshInhalt()` und dem eigenen Schlüssel (`setEigeneSchluessel`, aus
`state.keypair` in Settings → Mesh) – Offenes, Klartext, Ecash und die eigene
DM-Kopie werfen. Beim Empfang kommt nur Geprüftes bei der App an. **Fund:** Bis
hier reichte der Knoten jeden Rahmen der Art „Nostr“ sofort und ungeprüft
weiter – fremder Klartext ging so über das eigene Funkgerät, am Sendezeitkonto
vorbei. Jetzt erst die ganze, geprüfte Nachricht, über die Warteschlange, mit
Sprungzahl − 1 und nie mit eigenem Schlüssel (Post an mich funkt mein Gerät
nicht weiter). Preis: Ein Knoten, dem ein Rahmen fehlt, hilft bei dieser
Nachricht nicht mehr weiter. Eigene Nachrichten, die als Echo zurückkommen,
gehen nicht noch einmal raus.

**Sendezeit:** Über Funk bucht der Knoten jeden Rahmen im `Sendezeitkonto` und
schweigt, wenn 1 % je Stunde verbraucht sind; die Oberfläche zeigt „Sendezeit
aufgebraucht – weiter in etwa N min“, die Dauer-Schätzung rechnet die Grenze
mit. **Fund:** Ein Funkgerät per Bluetooth galt als eigene Strecke mit 20 KB/s –
es sendet aber über LoRa; jetzt zählt es als Funk.

**Chat → ⇪ (`mesh-transfer.ts`, `app.ts`):** nimmt die Umschläge an den
Kontakt mit, die die Relays haben (auch die eigenen), als Datei ohne Absender
im Kopf (Version 2, neutraler Dateiname). Vorher: Kind-4-DMs bzw.
Raumnachrichten im Klartext und `exportedBy` = eigener npub. Räume lehnt der
Knopf bis 2.3 ab. ⇩ gibt nur geprüfte Umschläge ans Netz und nennt, wie viel
Unverschlüsseltes abgelehnt wurde (auch aus alten Dateien).

**Ehrliche Texte:** Mesh-Karte (nur Umschläge, 1 % Sendezeit ≈ drei bis vier
kurze Nachrichten je Stunde – gemessen: ein kurzer DM-Umschlag hat 1,6–1,8 KB
in der Luft), „Was geht ohne Internet?“ (Räume, Profile, Code, Gewichte: nein;
Solana-Zahlungen: Transport steht, offline signieren erst mit 7.2 – vorher
„✓“), FAQ und Whitepaper (Ecash stand dort als „ja“ – nie gebaut). Beim Empfang
einer Solana-Transaktion sagt die App jetzt, dass sie sie noch nicht einreicht
(vorher „wird beim nächsten Netzkontakt eingereicht“ – geschah nie). „Als
Datei ausgeben“ sagt, wenn es nichts zu senden gibt.

**Abnahme (`app/test/leak/mesh.test.ts`):** mitgeschnitten am Transport des
echten `MeshNode` und in der Chat-Datei: DM an Bob, Abgleich aus gemischtem
Bestand, Datei – weder Alices Schlüssel (Hex, npub, roh; in Rahmen und
zusammengesetzt) noch Klartext; Gegenprobe: dieselbe Regel findet Alice in
allem, was bis 7.1 gesendet werden konnte. Aussage „mesh“ belegt (Szenario im
Protokoll).

**Tests:** app 279 → 285 (Funkknoten: Ablehnung, eigene Kopie, Sendezeit über
USB und Bluetooth, Empfang, nur Geprüftes weiter; bestehende Tests senden jetzt
Umschläge statt Rohtext), Leak-Tests 43 → 46; protocol 1069 (Auskunft ersetzt:
über keine Strecke geht Offenes). `decrementTtl` ist ungenutzt (Ausnahme mit
Grund); die Kurier-Pakete aus `mesh.ts` bleiben unverdrahtet – Kurier-Belohnung
ist Geld ohne Karte.

Endstand (nach dem Einmergen von 4.9d): protocol 1071 · node 213 (+ 7
übersprungen ohne Netz) · app 288 · Leak-Tests 47 grün + 2 todo · 0 rot ·
check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet · Smoke-Test
bestanden.

## Schritt 7.3 – Sats ohne Internet: ehrliche Hinweise

Bisher sagte die App nirgends, was ohne Netz geht. Eine Zahlung offline hing an
NWC, bis die Zeit ablief, oder endete mit einem Netzfehler.

**Hinweis oben:** `wireOfflineHinweis()` (`shell/ui.ts`, aus `boot()`) zeigt
unter der Kopfzeile, sobald der Browser offline meldet: „Offline: Nachrichten
gehen verschlüsselt über Funk oder per Datei (Settings → Mesh). Sats und SOL,
sobald wieder Netz da ist.“ – ein Text aus dem Protokoll (`OFFLINE_HINWEIS`),
verschwindet mit dem Netz. `navigator.onLine === false` heißt sicher offline;
`true` kann lügen (WLAN ohne Internet) – dann scheitert eine Zahlung wie bisher
am Netz.

**Zahlen:** `PaymentRail.online()` (optional, beide Schienen der App über
`netzDa()`); `waehleRail()` lehnt offline **vor** der Wallet-Frage ab –
Lightning: „Sats gehen erst wieder, wenn Netz da ist – Lightning braucht
mehrere Runden Austausch“; SOL: „offline signieren kommt mit 7.2“. Gilt für
jede Geldfunktion, die über `zahle()` geht (Zap, Trinkgeld, Vorab-Gebühr).

**Karte vs. Code:** Die Karte nennt „Offline: Nachrichten und SOL“ – SOL offline
gibt es erst mit 7.2 (Durable Nonces); bis dahin sagt der Hinweis ehrlich „Sats
und SOL, sobald wieder Netz da ist“, 7.2 ergänzt ihn. Ecash (Cashu) ist nicht
gebaut – nur nach MENSCH-Entscheidung, es hängt an verwahrenden Mints. FAQ
ergänzt. Im Browser geprüft (Playwright, Netz ab und wieder an): Hinweis
erscheint und verschwindet, keine Seitenfehler.

**Tests:** protocol +1 (offline: Absage je Schiene vor der Wallet-Frage, nichts
gezahlt; mit Netz wie bisher; Hinweistext), app +1 (beide Schienen fragen das
Netz).

Endstand: protocol 1072 · node 213 (+ 7 übersprungen ohne Netz) · app 289 ·
Leak-Tests 47 grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 4.9e – Betragsrauschen, verteilte RPC-Anfragen, ehrliche Grenzen (4.9 im Code fertig)

**Betragsrauschen:** Runde SOL-Trinkgelder (Vielfache von 0,01 SOL) gehen
leicht erhöht hinaus – höchstens +0,3 %, nur nach oben (`checkAmount` aus
`swap-privacy.ts`, das bisher nur der Tausch nutzte). Standard an, im
Zap-Dialog abwählbar. Beleg und Kette nennen den tatsächlichen Betrag.
Browser: 0,01 SOL → 10.024.710 Lamports, 0,003 SOL unverändert, Bob sieht
„0,01002471 SOL · belegt ✓“.

**RPC-Anfragen verteilt:** `RpcPool` nahm bisher immer den schnellsten
Anbieter – der sah damit jede Adresse, die die App abfragt, samt IP. Neu
`verteilen: true` (in der App an allen drei Stellen): eigene Endpunkte bleiben
vorn (keine fremde Partei), die fremden kommen in zufälliger Reihenfolge,
Ausfälle weiter nach hinten. Der Knoten bleibt beim schnellsten.

**Datenschutzbericht:** neuer Status „grenze“ mit Grund. „Jede SOL-Zahlung
geht von einer frischen Adresse aus“ war als offene Lücke für 4.9 gelistet –
nach Entscheidung A wird sie nicht geschlossen (eine frische Absenderadresse
müsste aus einer bestehenden aufgefüllt werden, das verknüpft beide). Jetzt:
„Gesendete SOL-Zahlungen kommen nicht von frischen Adressen …“ unter
„Bewusste Grenzen“, samt Grund; neu belegt „sol-empfang“ (Empfang an frischen
Adressen). Das Leak-`todo` benennt die Grenze statt eines Schritts.

**4.9 im Code fertig** (a–e): Swaps versiegelt, frische Empfangsadressen,
Trinkgeld-Adresse versiegelt, Rauschen, verteilte Abfragen. Abnahme: keine
SOL-Adresse in öffentlichen Events (grün), keine wiederverwendete Adresse beim
Empfang (grün), beim Senden als Grenze benannt.

**Tests:** protocol 1071 → 1073 (`rpc-pool.test.ts` +1, `privacy-facts.test.ts`
+1 „Grenzen nennen ihren Grund“; Szenario „sol-empfang“), app 282 → 284
(`solana-privat.test.ts`).

Endstand (nach dem Einmergen von 7.1b und 7.3): protocol 1074 · node 214 · app 291 ·
Leak-Tests 47 grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden. Verteil-Test ohne
Timing-Abhängigkeit (die erste Fassung hing an der gemessenen Latenz und war
in der CI rot).

## Schritt 7.4 – KI über Funk-Gateway: zurückgestellt (MENSCH 26.09.2026)

Vor dem Bau drei STOPP-Gründe, dem MENSCHEN vorgelegt: (1) Die Karte lässt das
Gateway die Antwort kürzen – Antworten sind seit 3.2 Ende-zu-Ende verschlüsselt,
das Gateway kann sie nicht lesen. **Entscheidung:** Der Provider kürzt auf
Wunsch (Parameter im versiegelten Auftrag, 500 Zeichen, keine Zwischenstände);
das Gateway reicht nur Umschläge weiter und kennt nur den Sitzungsschlüssel.
(2) Bezahlt werden soll per Zahlkanal-Gutschrift – den Zahlkanal (4.3) gibt es
nicht, er wartet auf 4.0. **Entscheidung:** 7.4 zurückstellen, bis 4.3 da ist.
(3) Anbindung des Knotens ans Funkgerät. **Entscheidung:** TCP-Brücke mit
Längenpräfix (socat/ser2net), keine neue Abhängigkeit. Spur B macht mit 7.2
weiter.

## Schritt 7.2a – SOL ohne Internet, Teil a: Durable Nonces im Protokoll

Eine Solana-Transaktion lebt mit ihrem Blockhash nur rund 150 Blöcke (etwa eine
Minute) – zu kurz für Funk oder Stick. **`protocol/src/sol-offline.ts`:**
`nonceKontoKosten()` (Miete für 80 Byte vom RPC, bleibt im Konto; dazu zwei
Signaturen) für die Anzeige vor dem Anlegen; `baueNonceKontoAnlegen()`
(Konto erzeugen und als Nonce einrichten, Zahler = Autorität; signieren Zahler
und das neue Konto); `leseNonceKonto()` (80 Byte, eingerichtet, per DataView –
kein Buffer-BigInt im Browser); `baueOfflineUeberweisung()` (erste Anweisung
`AdvanceNonceAccount`, dann die Überweisung, der Nonce-Wert statt des
Blockhashs – braucht kein Netz); `pruefeOfflineUeberweisung()` für Gateway und
Empfänger (genau diese zwei Anweisungen, Zahler = Autorität = Gebührenzahler,
alle Signaturen gültig; ob der Wert noch aktuell ist, weiß erst die Kette). Eine
solche Überweisung hat rund 300 Byte – zwei Funkpakete – und besteht
`pruefeMeshInhalt()`.

**Abnahme** (`sol-offline-validator.test.ts`): am lokalen Validator Nonce-Konto
anlegen, Offline-Überweisung signieren, warten, bis mehr als zwei Minuten um
sind **und** ein normaler Blockhash abgelaufen ist (die Vergleichstransaktion
wird abgelehnt), dann einreichen (mit Vorabsimulation) – kommt an; ein zweites
Mal nicht, der Wert ist verbraucht. Läuft nur mit `solana-test-validator`; hier
und in der CI gibt es keinen, der Test wird übersprungen (wie die Devnet-Tests).

**Aufteilung:** a Protokoll (dieser Teil); b App: Wallet-Karte (Kosten zeigen,
anlegen, Wert auffrischen, offline zahlen), Senden über Funk oder Datei,
Einreichen durch ein Gerät mit Netz, ehrliche Texte.

**Tests:** protocol 1072 → 1078 (+6: Kosten, Anlegen, Lesen, Offline-Überweisung
samt Mesh-Regel, Negativfälle beim Bauen und Prüfen) + 1 übersprungen (Validator).

Endstand (nach dem Einmergen von 4.9e): protocol 1080 (+ 6 übersprungen) ·
node 213 (+ 7 übersprungen ohne Netz) · app 291 · Leak-Tests 47 grün + 2 todo ·
0 rot · check-wiring `--streng` 0 offen (5 neue Ausnahmen bis 7.2b) ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 5.4a – Startliste und eigener Relay-Satz

**Ausgangslage:** App, Knoten, Release-Skript und Dashboard hingen an drei fest
verdrahteten Relays (damus, nos.lol, nostr.band). Beim Bau dieses Schritts war
relay.nostr.band nicht erreichbar – ein Drittel fehlte, ohne dass es jemand
merkte. Direktnachrichten gingen zusätzlich an alle eigenen Relays.

**Startliste** (`protocol/src/relay-start.ts`): acht Relays von acht
Betreibern, per NIP-11 geprüft (damus, nos.lol, Primal, nostr.mom, 0xtr,
offchain.pub, Wellorder, bitcoiner.social). relay.snort.social fiel heraus
(nur im Speicher), relay.nostr.band ebenso. Keine .onion-Adresse – kein
Betreiber veröffentlicht eine, die sich prüfen ließ (MENSCH-Punkt).

**Eigener Satz:** Neue Nutzer bekommen vier zufällige Relays der Liste –
die Last verteilt sich, kein Betreiber sieht alle. Die App veröffentlicht den
Satz als NIP-65-Liste (Kind 10002) und Posteingang (Kind 10050), gestreut an
den Pool und die ganze Startliste (`veroeffentlicheWeit`), dort sucht sie
jeder. Die veröffentlichte Liste gilt: Ein zweites Gerät derselben Identität
übernimmt sie, statt neu zu würfeln; „keine Liste“ zählt nur, wenn mindestens
zwei Relays antworteten (`OutboxPool.queryMitBericht`). Wer von vor 5.4 kommt,
behält seinen alten Posteingang und bekommt zwei neue dazu. Scheitert das
Veröffentlichen, wird nichts gemerkt – beim nächsten Abgleich wieder.

**Sitzung:** Pool = eigener Satz + drei weitere der Liste in wechselnder
Auswahl + gemerkte Funde (`poolRelays`); beim allerersten Start die ganze
Liste. Zwei Nutzer teilen so immer mindestens sechs Relays, auch ohne die
Listen des anderen zu lesen (Test mit 50 Zufallspaaren). Lesen bei den
Schreib-Relays der Kontakte folgt mit 5.4b – dann kann der wechselnde Teil
kleiner werden.

**Direktnachrichten:** nur noch an den Posteingang des Empfängers (NIP-17,
`veroeffentlicheAn` über `OutboxPool.publishAn` – Relays des Pools mit ihrer
Verbindung, andere kurz und danach geschlossen; vorher blieben diese
Verbindungen offen), die eigene Kopie ebenso an den eigenen. Ohne Liste oder
wenn kein Posteingang annimmt: die eigenen Relays wie bisher.

**Knoten, Releases, Dashboard:** ohne eigene Einstellung die ganze Startliste
(`RELAYS_DEFAULT = startUrls()`, `RELEASE_RELAYS`, `dashboard.html`) – so
überschneidet sich jede App-Sitzung mit dem Knoten. Zap-Anfragen nennen den
eigenen Satz statt der drei alten.

**Abnahme im Browser** (Playwright, jeder Relay-Host mit eigenem Speicher wie
im echten Netz; damus, nos.lol, nostr.band lehnen die Verbindung ab): beide
Nutzer veröffentlichen ihre Listen auf allen erreichbaren Startrelays;
Direktnachricht Alice → Bob und zurück kommt an, der Umschlag an Bob liegt nur
auf seinen erreichbaren Posteingangs-Relays; nach einem Neustart verbindet
sich Alice mit sieben Relays (eigene vier + drei) und bekommt die Antwort
eines echten `DvmProvider`, der wie ohne `RELAYS` auf der Startliste
veröffentlicht. Zweimal mit verschiedenen Zufallssätzen gelaufen.

**Tests:** protocol 1074 → 1083 (`relay-start.test.ts` 9: Vielfalt, Satz,
Sitzung, Überschneidung, Geräte, Altbestand, `publishAn`/`queryMitBericht`),
app 291 → 300 (`relay-satz.test.ts` 9: Pool, Abgleich neu/zweites
Gerät/Altbestand/zu wenige Antworten/Veröffentlichen gescheitert,
Verdrahtung in `state.ts`, `kommunikation.ts`, `chat-zap.ts`, Knoten,
Release-Skript, Dashboard).

**MENSCH:** Am GX10 `RELAYS` nicht setzen (dann die Startliste) oder um die
Startliste ergänzen – mit den drei alten hängt der Knoten nur an damus und
nos.lol; fallen die aus, findet ihn keine App mehr. Eine geprüfte
.onion-Adresse für die Liste.

Endstand (nach dem Einmergen von 7.2a): protocol 1089 · node 214 · app 300 ·
Leak-Tests 47 grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen ·
innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 7.2b – SOL ohne Internet, Teil b: App – 7.2 Code fertig

**Wallet-Tab, eingebaute Wallet → „Ohne Internet zahlen“** (`shell/offline-zahlung.ts`):
Mit Netz legt die App ein Nonce-Konto an (Kosten vorher im Dialog: Miete, die im
Konto bleibt, plus Gebühr), frischt den Wert auf oder schließt das Konto (die
Miete geht zurück an die Wallet – `baueNonceKontoSchliessen`, neu im Protokoll).
Ohne Netz: Adresse und Betrag eingeben, die Wallet signiert mit dem abgelegten
Wert (`sol-offline-zahlung.ts`: Tageslimit wie jede Zahlung, darüber Dialog;
Unfug wird vor der Freigabe abgelehnt und zählt nicht), der Wert gilt danach als
verbraucht. Gesendet wird über ein verbundenes Funkgerät (`sendeUeberFunk`,
Vorrang „Zahlung“), sonst als `.meshpkt`-Datei. Nur die eingebaute Wallet zahlt
offline – externe Wallets brauchen zum Signieren oft selbst Netz.

**Gateway:** Empfängt ein Gerät mit Netz eine Offline-Zahlung (Funk oder Settings
→ Mesh → „Datei einlesen“), prüft es sie (`pruefeOfflineUeberweisung`) und
reicht sie mit Vorabsimulation ein (`reicheSolOfflineEin`); ohne Netz hält es sie
im Speicher und reicht ein, sobald Netz da ist. Weitergereicht hat der
Funkknoten sie ohnehin. Netz-Funktionen stehen in `shell/zahlschienen.ts` – dem
einzigen Ort für `sendRawTransaction` und die eingebaute Wallet (Zahlwege-Prüfung).

**Texte:** Offline-Hinweis („SOL mit vorbereitetem Nonce-Konto“), „Was geht ohne
Internet?“ (Solana-Zahlungen ✓), Mesh-Karte, FAQ, Whitepaper; Aussage „mesh“
genauer: Nachrichten nur als Umschläge; eine Offline-SOL-Zahlung zeigt – wie
später auf der Kette – Adressen und Betrag (auch in der Wallet-Karte gesagt).

**Browser-E2E** (Playwright, vorgetäuschter Solana-RPC und -WebSocket): Wallet
einrichten → Nonce-Konto anlegen (Kosten-Dialog, Transaktion gesendet, Wert
gelesen) → Netz ab → Hinweis oben → offline zahlen (289 Byte, als Datei) → Wert
verbraucht → zweites Gerät liest die Datei ein → reicht genau diese Transaktion
ein; keine Seitenfehler.

**Tests:** protocol +1 (Konto schließen), app +5 (Offline-Zahlung: signiert,
geprüft, verbraucht; Tageslimit abgelehnt → nichts; Ablehnung vor der Freigabe;
strenge Ablage; Bündel), Leak-Tests +1 (Offline-SOL über Funk ohne
Nostr-Schlüssel und Nachrichtentext).

Endstand (nach dem Einmergen von 5.4a): protocol 1090 (+ 6 übersprungen, davon
der Validator-Test) · node 213 (+ 7 übersprungen ohne Netz) · app 305 ·
Leak-Tests 48 grün + 2 todo · 0 rot ·
check-wiring `--streng` 0 offen · innerHTML streng 0 unbewertet · Smoke-Test
bestanden · Browser-E2E bestanden.

## Schritt 8.10a – Repositories, Teil a: NIP-34 im Protokoll

Bisher kannte die App nur eigene Repo-Verweise (Kind 38042, Bundle im
Blob-Netz) – keine Patches, keine Annahme, nichts, was andere Nostr-Clients
lesen. **`protocol/src/nip34.ts`** nach NIP-34: Repo-Ankündigung (30617:
Kennung, Name, Beschreibung, Klon-Adressen – auch ein Radicle-Spiegel
`rad:…` –, Web, erster Commit „euc“, Maintainer; streng gelesen, ungültige
Adressen und Schlüssel fallen heraus), Patch (1617: nur Text aus
`git format-patch`, adressiert an das Repo, benachrichtigt den Eigentümer,
höchstens 60 KB; Commit und Betreff aus dem Patch selbst), Status (1630 offen,
1631 angenommen samt `applied-as-commits`, 1632 geschlossen, 1633 Entwurf).
`patchStatus()`: „angenommen“ zählt nur vom Eigentümer oder einem
eingetragenen Maintainer – nicht vom Autor, nicht von Fremden –, sonst der
neueste gültige Status von Autor oder Maintainer; ohne Status offen.

**Fund beim Test mit echtem git:** `git format-patch` kodiert Umlaute im
Betreff nach RFC 2047 (`=?UTF-8?q?…?=`) und bricht lange Betreffe um – der
Betreff wird jetzt dekodiert (q und b, Folgezeilen).

**Abnahme** („ein Patch über NIP-34 angenommen“, `nip34.test.ts`): echtes git
in einem Temp-Ordner – Eigentümer-Repo, Klon mit einer Änderung,
`git format-patch`; über ein Relay: ankündigen, Patch einreichen, der
Maintainer liest ihn **nur aus dem Event**, spielt ihn mit `git am` ein und
setzt „angenommen“ mit dem neuen Commit; `patchStatus()` sagt „angenommen“.

Öffentlich mit Absicht: Code, Patches und Annahmen sind gemeinsame Arbeit und
signiert. **Radicle:** Das Repo kündigt seinen Spiegel als Klon-Adresse an;
spiegeln tut der Betreiber mit `rad` (MENSCH). Die Karte nannte „Tests bisher
keine“ – `git-contributors.test.ts` und `git-e2e.test.ts` gab es schon.

**Aufteilung:** a (dieser Teil) Protokoll und Abnahme; b App:
Repositories-Karte mit NIP-34 (ankündigen, Patch senden, Patches mit Status,
annehmen/schließen als Maintainer).

**Tests:** protocol +6 (Ankündigung, Unfug, Patch-Text, RFC 2047, Status-Regeln,
Abnahme mit git).

Endstand: protocol 1096 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 305 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (9 neue Ausnahmen bis 8.10b) · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## Schritt 8.10b – Repositories, Teil b: NIP-34 in der App – 8.10 Code fertig

**Agent → Repositories → „Zusammenarbeit (NIP-34)“** (`shell/tabs/repos.ts`,
Ansichtslogik in `repo-ansicht.ts`): Repo ankündigen (Kennung, Klon-Adressen –
auch ein Radicle-Spiegel `rad:…`), je Repo „Patch senden“ (Datei aus
`git format-patch -1`, geprüft, Rückfrage „öffentlich und mit deinem Schlüssel
signiert“), Patches mit Status; Eigentümer und Maintainer nehmen an (optional
mit dem eingespielten Commit) oder schließen, der Autor zieht seinen Patch
zurück, Fremde sehen keine Knöpfe. Je Eigentümer und Kennung gilt die neueste
Ankündigung. Die Liste wird per DOM und `textContent` gebaut – Namen,
Betreffe und Adressen kommen von Fremden, nichts davon geht durch `innerHTML`.
Die Karte sagte „Funktioniert auch offline“ – seit 7.1 gehen Repos nicht über
Mesh; gestrichen.

**Browser-E2E** (zwei Geräte, vorgetäuschtes Nostr-Relay über
`route_web_socket`): A kündigt „demo“ mit HTTPS- und Radicle-Adresse an, B
sendet einen echten `git format-patch` (Betreff mit Umlaut, RFC 2047), A sieht
ihn mit „annehmen/schließen“, nimmt an, beide sehen „angenommen ✓“, B hat
keine Knöpfe mehr; keine Seitenfehler.

**Tests:** app +2 (Repos: neueste Ankündigung, Unfug fällt heraus; Patches:
Rechte je Rolle, nur dieses Repo, entschieden heißt keine Knöpfe).

Endstand: protocol 1096 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 307 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden · Browser-E2E
bestanden.

## Schritt 8.13 – Lokale Suche

**Kommunikation → Suchfeld über der Unterhaltungsliste** (`shell/suche-ui.ts`,
Index in `suche.ts` auf `local-search.ts`): Aufgenommen wird, was die App
ohnehin entschlüsselt und zeigt – Direktnachrichten (NIP-17, ältere Kind 4) und
Community-Nachrichten, je Kennung einmal, ausgeblendete (Moderation) und nicht
entschlüsselbare nicht (`tabs/kommunikation.ts:1092`). Tippen zeigt Treffer
statt der Liste; ein Treffer öffnet seine Unterhaltung
(`tabs/kommunikation.ts:574`, `wireKommunikation()` aus `app.ts:690`). Treffer
werden per DOM und `textContent` gezeigt – der Text kommt von Fremden.

**Gespeichert nur verschlüsselt:** Mit Tresor liegt der Index als ein
AES-GCM-256-Blob in IndexedDB „freedom-suche“ (`suche-ui.ts:24`), der Schlüssel
im Tresor (`freedom.suche.schluessel`, auch in `geheimnisse()`). Ohne Tresor
lebt der Index nur im Speicher bis zum Neuladen – ein Schlüssel im Klartext
daneben wäre keine Verschlüsselung. Gespeichert werden die Dokumente, die
Wortliste entsteht beim Laden neu, in Abschnitten (Oberfläche bleibt
bedienbar); gespeichert wird verzögert (2 s) statt je Nachricht. Ablaufende
Direktnachrichten (NIP-40, 2.5) verschwinden mit ihrem Ablauf auch aus dem
Index. Passt der Schlüssel nicht (alter Index), wird neu aufgebaut.

**Abnahme** (`app/test/suche.test.ts`): 10.000 Nachrichten – Aufbau ~0,1 s, je
Suche ~0,6 ms (Grenze 16 ms, ein Bildschirmbild), Speichern + Laden ~0,4 s in
über 40 Abschnitten; im gespeicherten Blob weder Wörter noch Schlüssel noch
Unterhaltungs-Kennung; falscher Schlüssel liest nichts.

**Browser-E2E** (zwei Geräte, vorgetäuschtes Relay): B richtet den Tresor ein,
A schreibt B „Laborbefund Beratungsstelle Bahnhof“ (am Relay nur Umschläge),
B öffnet die Anfrage, findet sie über das Suchfeld, der Treffer öffnet die
Unterhaltung; nach Neustart mit stummem Relay findet B sie aus dem
gespeicherten Index. Klartext-Scan über alle IndexedDB-Datenbanken und
localStorage: auf B (mit Tresor) und A (ohne Tresor, keine Such-Datenbank)
nichts; keine Seitenfehler.

**Grenzen, ehrlich:** Gesucht wird nur in Nachrichten, die auf diesem Gerät
schon geöffnet wurden (so sagt es auch die Leer-Meldung). Raum-Nachrichten
(Kanäle) sind nicht im Index; der Such-Knopf in Räumen hatte schon vorher
keine Funktion und hat weiter keine. Die Notfall-Löschung (8.14) muss den Index
mit löschen (`sucheVergessen()`).

**Tests:** app +6 (Rundreise, kein Klartext/falscher Schlüssel, Ablauf, ohne
Tresor, Vergessen, Abnahme 10.000).

Endstand: protocol 1096 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 313 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (6 Ausnahmen weniger) · innerHTML streng 0 unbewertet · Smoke-Test
bestanden · Browser-E2E bestanden.

## Schritt 8.14 – Notfall-Löschung

**Settings → Sicherheit → „Notfall-Löschung“** (`shell/notfall.ts`, Knopf aus
`app.ts:534`): Vorher steht `wipeConfirmation()` – was gelöscht wird, keine
Wiederherstellung, ohne Merkphrase kein Zurück, Geld in laufenden
Tauschvorgängen kann verloren sein, und der **rechtliche Hinweis** (in vielen
Ländern ist das Vernichten von Beweismitteln strafbar, etwa während eines
Verfahrens oder einer Durchsuchung; keine Rechtsberatung); läuft gerade ein
Tausch oder Deposit, eine Warnung dazu. Gelöscht wird erst nach Eintippen von
LÖSCHEN. Der Dialog ist per DOM gebaut.

**Was gelöscht wird** (`loescheAllesLokal()` in `duress.ts`): localStorage und
sessionStorage mit dem Präfix `freedom.`, jede IndexedDB-Datenbank, deren Name
mit `freedom` beginnt (Tresor, Suchindex, Blob-Speicher – auch künftige), dazu
die bekannten aus `WIPE_DATENBANKEN`, falls der Browser keine Liste liefert.
Danach **nachgeprüft**: Was noch da ist oder nicht gelöscht werden konnte
(blockierte Datenbank), wird benannt. Fremde Schlüssel und Datenbanken
derselben Herkunft (github.io) bleiben. `WIPE_TARGETS` nannte Schlüssel, die es
nicht gibt (`freedom.sk`, `freedom.conversations`) – jetzt die echten.

**Nichts schreibt zurück:** Die App startet sofort neu (`location.reload()`);
der Suchindex hält vorher sein verzögertes Speichern an (`sucheVergessen()`,
startet die Suche dafür nicht erst). Ohne Tresor landete sonst, was noch im
Speicher ist (Unterhaltungen), im Klartext in localStorage. Ein Merker in
sessionStorage lässt den Start ein **zweites Mal löschen, vor allem anderen**
(`app.ts:502`), dann zeigt die leere App das Ergebnis; fehlt etwas, sagt eine
Meldung was.

**Wächter** (`app/test/notfall.test.ts`): Im Quelltext von App und Protokoll
trägt jeder Schlüssel für localStorage, sessionStorage und Tresor das Präfix
`freedom.`, jede Datenbank steht in `WIPE_DATENBANKEN`; Cache Storage, OPFS,
Cookies, WebSQL und Service Worker kommen nicht vor. Gegenprobe: ein Schlüssel
„lang“ und eine Datenbank „fremd-db“ lassen den Test scheitern.

**Nachweis im Smoke-Test** (`scripts/smoke_test.py`, Befehlsliste): frisches
Profil mit Geheimnissen, Sitzungsdaten, Blob-Speicher, Suchindex, einer
künftigen Datenbank und Tresor; der Hinweis steht vorher, der Knopf ist bis
„LÖSCHEN“ gesperrt; danach enthalten localStorage, sessionStorage und IndexedDB
weder Schlüssel noch Probedaten, nur der neu angelegte leere Tresor-Speicher
bleibt, die App startet leer mit neuer Identität und ohne Passphrase-Abfrage.

**Grenzen, ehrlich:** Relays erreicht die Löschung nicht (steht im Text).
Die **Zwangsphrase** (`checkUnlock`, `duressWarning`: eine zweite Passphrase,
die beim Entsperren still löscht) ist nicht eingebaut – die Karte verlangt nur
die Löschung, und ob die Funktion angeboten wird, ist eine MENSCH-Entscheidung
(sie kann ihrem Nutzer schaden; ein gespeicherter Prüfwert verriete, dass es
eine gibt). Was der Browser selbst hält (Verlauf, Cache der Seite), löscht die
App nicht.

**Tests:** protocol +4 (Löschen und Nachprüfen, Benennen, ohne Liste der
Datenbanken, rechtlicher Hinweis), app +4 (Präfix aller Schlüssel, Datenbanken,
keine unbekannte Speicherart, Verdrahtung); Smoke-Test +1 Szenario.

Endstand: protocol 1100 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 317 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (2 Ausnahmen weniger) · innerHTML streng 0 unbewertet · Smoke-Test
bestanden (mit Notfall-Löschung).

## Schritt 8.11a – Nachfolge, Teil a: Anteile versiegelt im Protokoll

**Vorher:** Beim Einrichten lud die App alle Anteile als **eine Textdatei**
herunter – wer die Datei hatte, hatte den Schlüssel, und die Weitergabe blieb
dem Nutzer überlassen. Zusammensetzen konnte die App gar nicht
(`combineShares`, `verifyRecovered` ohne Oberfläche).

**Neu** (`nachfolge-anteile.ts`): Jeder Anteil geht im Umschlag (NIP-59) an
genau seinen Vertrauten – innen Kind 38077 mit Index, Schwelle, Anzahl,
Prüfsumme des Plans und der Kennung der Zerlegung („teilung“). Ist der Plan
freigegeben, fragt ein Vertrauter als Sammler die anderen versiegelt an (38078);
die geben ihren Anteil versiegelt an ihn (38079). `darfUebergeben()` lässt das
nur zu, wenn der Plan beide als Vertraute nennt, der Anteil zum Plan passt und
`evaluateSuccession()` „freigegeben“ sagt – ein Lebenszeichen des Besitzers
sperrt wieder. `setzeNachfolgeZusammen()` mischt keine Anteile verschiedener
Zerlegungen (richtet der Besitzer neu ein, passen alte nicht mehr) und gibt
den Schlüssel nur mit passender Prüfsumme heraus. Übergaben von
Nicht-Vertrauten und Unfug (Index 0, Schwelle 1, kein Hex) fallen heraus.
Kinds 38077–38079 kommen nur innen im Umschlag vor.

**Durchgespielt** (`nachfolge-anteile.test.ts`, Besitzer und drei Vertraute,
2 von 3): Jeder öffnet genau seinen Anteil; im Öffentlichen (Plan, Umschläge,
Anfrage, Übergabe) steht kein Anteil und kein Schlüssel, der Besitzer ist nicht
Autor der Umschläge; übergeben erst nach Frist, Schwelle und Wartezeit, nicht
an Fremde oder sich selbst; B sammelt von C und hat danach genau den Schlüssel
des Besitzers.

**Grenzen, benannt:** Der Plan ist öffentlich – wer die Vertrauten sind, sieht
jeder (neue Aussage „nachfolge-plan“ als Grenze mit Grund; auch im Hinweistext
`successionWarning()`). Genug Vertraute, die sich absprechen, können
übernehmen; eine veränderte App muss die Freigabe nicht abwarten. Relays sehen,
dass Vertraute Post bekommen. Die Aussage „nachfolge-anteile“ steht als offen
(8.11b) – die App versiegelt noch nicht.

**Aufteilung:** a (dieser Teil) Protokoll; b App: Einrichten ohne
Klartext-Datei, Ansicht für Vertraute, Anfrage und Übergabe, Zusammensetzen,
Browser-E2E mit drei Testkonten.

**Tests:** protocol +5 (Öffnen und kein Klartext, Freigaberegeln, Nachfolge
durchgespielt, Teilungen und Fremde, Unfug) und eine Zusicherung mehr im
Hinweistext-Test.

Endstand: protocol 1105 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 317 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (9 neue Ausnahmen bis 8.11b) · innerHTML streng 0 unbewertet ·
Smoke-Test bestanden.

## Schritt 8.11b – Nachfolge, Teil b: in der App – 8.11 Code fertig

**Besitzer** (Settings → Sicherheit → „Nachfolge & Wiederherstellung“ →
einrichten, `richteNachfolgeEin()`): Vertraute als npub oder hex, mindestens
drei, nicht man selbst; nach dem Hinweistext (jetzt mit „der Plan ist
öffentlich“) geht jeder Teil **versiegelt an genau seinen Vertrauten**
(`baueAnteilUmschlag`, an dessen Posteingang, `settings.ts:96`), danach werden
die Teile im Speicher genullt und der Plan veröffentlicht. Die Datei mit allen
Teilen gibt es nicht mehr.

**Vertraute** (`nachfolge.ts` ohne DOM, Oberfläche `shell/nachfolge-ui.ts`):
Der Posteingang ordnet Umschläge ein (`kommunikation.ts:894`) – eigener
Anteil, Anfrage eines anderen Vertrauten, Übergabe (nur wenn man selbst
angefragt hat). Gehalten wird im Tresor (`freedom.nachfolge`), ohne Tresor nur
im Speicher; dann sagt die Ansicht, dass der Anteil nur auf den Relays liegt.
„Du bist Vertrauter für …“ (`settings.ts:25`) zeigt je Besitzer Teil und Stand
des Plans und bietet an: melden (einmal – danach „gemeldet“), nach der Freigabe
Anteile anfordern (versiegelt an die anderen Vertrauten), eine Anfrage
beantworten („übergeben“ nur, wenn `darfUebergeben()` zustimmt, nach Rückfrage,
sonst steht der Grund da) und zusammensetzen – der Schlüssel wird mit der
Prüfsumme des Plans geprüft und als Datei gegeben (mit Hinweis zum Import),
die Kopie im Speicher danach genullt. Liste per DOM und `textContent`.
Lesen-Ändern-Schreiben des Stands läuft nacheinander, damit parallele
Abgleiche nichts verlieren.

**Browser-E2E** (vier Konten, vorgetäuschtes Relay, gesteuerte Uhr): A richtet
mit B, C, D ein – keine Datei, drei Umschläge, Plan öffentlich; B und C
(mit Tresor) sehen ihren Teil; nach 181 Tagen melden beide; nach 213 Tagen ist
freigegeben, B fordert an, C sieht die Anfrage und übergibt, B hat 2 von 2 und
setzt zusammen – die Datei enthält genau A's Schlüssel. Am Relay: A's Schlüssel
nirgends, Kinds 38077–38079 nie offen, zwei öffentliche Meldungen;
localStorage von B ohne Nachfolge-Daten; keine Seitenfehler.

**Fund behoben:** Geht die Uhr eines Vertrauten etwas nach, zeigte der Stand
„Lebenszeichen vor -1 Tagen“ – `evaluateSuccession()` zählt jetzt ab 0.

**Texte:** Karte in den Settings, FAQ und Whitepaper nennen die Versiegelung
und dass öffentlich ist, wer die Vertrauten sind. Aussage „nachfolge-anteile“
jetzt belegt (Szenario: Plan, Umschläge, Anfrage, Übergabe ohne Anteil und
Schlüssel).

**Grenzen, ehrlich:** Vertraute brauchen FreedomStack (andere Clients
ignorieren die Umschläge). Wer zusammensetzt, bekommt den Schlüssel als Datei
und importiert ihn selbst – eine Übernahme in der laufenden App gibt es nicht.
Der Plan und die Meldungen sind öffentlich (Grenze „nachfolge-plan“).

**Tests:** app +4 (Umschläge einordnen, Stand lesen, Ansicht vor/nach
Freigabe, Verdrahtung), protocol +1 (keine negativen Tage); der
Verdrahtungstest der Posteingangs-Kette (`trinkgeld-beleg.test.ts`) nennt jetzt
auch `alsNachfolge`.

Endstand: protocol 1106 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 321 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (11 Ausnahmen weniger) · innerHTML streng 0 unbewertet · Smoke-Test
bestanden · Browser-E2E bestanden.

## Schritt 8.12 – Zustandssicherung

**Fund:** `sammleZustand()` nahm jeden `freedom.*`-Eintrag aus localStorage mit
und ließ nur Namen auf `.sk`, `.identity` oder `.secret` weg. Der Schlüssel
heißt aber `freedom.nsec` – er ging mit, ohne Tresor ebenso NWC-Zugang,
Swap-Preimages und die eingebaute SOL-Wallet (verschlüsselt, aber mit einem
Schlüssel, der aus demselben Geheimnis abgeleitet ist – der Kommentar im Code
wollte genau das verhindern). Mit Tresor fehlte dafür das Wichtigste: Die
Unterhaltungen liegen dann im Tresor und kamen gar nicht in die Sicherung.
Zurückgeholt wurde jeder Eintrag ungefiltert in localStorage – auch Geheimes
im Klartext neben einem Tresor.

**Jetzt** (`state-backup.ts`): eine feste Liste `SICHERUNG_EINTRAEGE`
(Unterhaltungen, Räume, Lesestände, eigene Namen, Profil-Entwurf, Sprache,
Relays, zwei Einstellungen, Moderation je Community) statt eines Präfixes – ein
neuer Eintrag ist erst gesichert, wenn er dort steht. `SICHERUNG_NIE` schließt
zusätzlich aus: Schlüssel, Bunker, Wallet-Zugänge, Swaps, Sperren, SOL-Wallet,
Tresor, Suchschlüssel, Nachfolge-Anteile, Notfall-Merker und
**Gruppenschlüssel (MLS, Epochen)** – Forward Secrecy hieße sonst nur „bis zur
nächsten Sicherung“; ein neues Gerät tritt Räumen neu bei. Die App liest jeden
Wert aus seinem Speicher (`istGeheimnis()` in `tresor.ts`, dieselbe Liste wie
`geheimnisse()`, `settings.ts:162`) und schreibt beim Zurückholen nur
Gefiltertes (`filtereWiederherstellung()`, `settings.ts:220`) – Geheimes in den
Tresor, anderes in localStorage (`settings.ts:223`). Eine alte Sicherung mit
Schlüssel stellt ihn nicht wieder her. Über 60 KB lehnt die Sicherung klar ab,
statt am Rand von NIP-44 zu scheitern. Der Hinweistext nennt, was nie darin ist.

**Browser-E2E** (zwei Geräte, vorgetäuschtes Relay): Gerät 1 mit Tresor, einer
Unterhaltung, Raum und Namen sichert – am Relay eine Sicherung (30078), weder
Schlüssel noch Name noch Raum noch Partner im Klartext. Gerät 2 importiert die
Identität, richtet einen Tresor ein und holt zurück: gleiche Identität,
Unterhaltung wieder in der Liste (im Tresor, nicht in localStorage), Räume und
Namen da, kein Schlüssel im Klartext in localStorage; keine Seitenfehler.

**Datenschutz:** neue Aussage „zustand-sicherung“ (belegt, Szenario: Gerät mit
Schlüssel, Zugängen, Swap und Gruppenschlüssel – im Event nichts davon im
Klartext).

**Nebenbei:** Der Bunker-Test pinnte die Liste der Geheimnisse unter ihrem alten
Namen (`const fest = …`); sie heißt jetzt `GEHEIM_FEST` und wird von
`geheimnisse()` und `istGeheimnis()` geteilt – der Test prüft dasselbe.
Die Ablauf-Funktionen in `state-backup.ts` bleiben ohne Oberfläche:
Direktnachrichten haben ihren Ablauf seit 2.5 über `private-dm.ts`.

**Tests:** protocol +4 (feste Liste, Wiederherstellung ohne Klartext, alte
Sicherung mit Schlüssel, Größe), app +3 (Sichern, Zurückholen, Tresor-Einträge).

Endstand: protocol 1110 (+ 6 übersprungen) · node 213 (+ 7 übersprungen ohne
Netz) · app 324 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden · Browser-E2E
bestanden.

## Schritt 8.9a – Speicher, Teil a: nur Verschlüsseltes, Abruf von Knoten

**Entscheidung MENSCH (26.09.2026):** 8.9 in Teilen. a (dieser Teil) Protokoll
und Knoten; b App; **c Bezahlung in sats und SOL wartet wie 7.4 auf den
Zahlkanal 4.3** – je Stück (um 10 msat) wäre eine SOL-Überweisung teurer als das
Stück. Öffentliche Git-Bundles werden in b verschlüsselt hochgeladen, der
Schlüssel steht öffentlich in der Repo-Ankündigung – Knoten halten dann auch
dort nur Chiffrat. Geprüft wird per Kennzeichen und Zufallstest.

**Vorher:** Knoten nahmen jedes Stück aus dem Relay-Feed auf, wandelten Hex
ungeprüft (`parseInt` auf Fremddaten) und prüften den Hash nicht gegen das
Tag. Ein Abruf-Auftrag (5075) hätte das Stück als Hex im Ergebnis geliefert –
64 KB Stück, 128 KB Hex: in keinem Umschlag möglich, nur offen. Die App nutzte
Knoten gar nicht.

**Protokoll** (`blob.ts`): `buildBlob(…, { verschluesselt: true })` setzt
`["verschluesselt", "1"]` an Manifest und Stücke (`encrypted` im Manifest); jedes
Stück nennt jetzt Größe und Erasure-Parameter. `pruefeSpeicherStueck()`:
Kennzeichen, Form (Zahlen, Hex fester Länge), Hash, Füllung hinter der
Nutzlänge nur Nullen (`nutzLaenge()`: Daten-Stück k deckt [k·C, (k+1)·C),
Parität so lang wie das längste Daten-Stück ihrer Gruppe), und der Datenbereich
sieht wie Zufall aus (`wirktZufaellig()`: Chi-Quadrat über die
Byte-Häufigkeiten, Grenze 400 bei Mittel 255; unter 1 KB die Zahl verschiedener
Bytewerte). Das fängt Text und Rohdaten – auch in Paritäts-Stücken –, nicht
komprimierte Medien; so steht es im Modul und im Whitepaper.
`baueStueckAbruf()`: versiegelter Auftrag 5075 vom Sitzungsschlüssel.

**Knoten:** Aufnahme nur über `StorageRole.nimmAuf()` (`main.ts:437`), dazu das
signierte Event ohne Inhalt (`<blob>.<index>.json`). Ein Abruf läuft vor der
Zahlungsprüfung (`dvm-provider.ts:735`), setzt das Event aus .json und .bin
wieder zusammen (ID geprüft), veröffentlicht es erneut und antwortet
„veroeffentlicht“ – versiegelt, wenn der Abruf es war; nicht Gehaltenes wird
abgesagt. Betrag 0 bis 8.9c.

**Abnahme** (`node/test/speicher-ausfall.test.ts`): eine verschlüsselte Datei
(~190 KB, 24 Stücke), vier Knoten mit je 12 Stücken reihum, das Relay hat nur
das Manifest. Für **jedes der sechs Paare** fallen zwei Knoten aus; die Kundin
fragt die übrigen versiegelt ab, sie veröffentlichen ihre Stücke erneut, die
Datei wird zusammengesetzt und entschlüsselt. Abruf und Antwort erscheinen nie
offen. Ein einzelner Knoten mit 12 Stücken reicht nicht; Klartext (mit und ohne
Kennzeichen) nimmt ein Knoten nicht auf.

**Knoten-Stand:** Speicherknoten (`STORAGE_ENABLED=1`) brauchen `main` nach
diesem Merge; KI-Aufträge sind nicht betroffen.

**Tests:** protocol +5 (Kennzeichen und Prüfung, Klartext abgelehnt,
Manipulation, Nutzlänge und Zufallstest, versiegelter Abruf), node +3
(Abnahme für alle Paare, ein Knoten reicht nicht, Klartext abgelehnt).

Endstand: protocol 1115 (+ 6 übersprungen) · node 216 (+ 7 übersprungen ohne
Netz) · app 324 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (1 Ausnahme bis 8.9b) · innerHTML streng 0 unbewertet · Smoke-Test
bestanden.

## Schritt 8.9b – Speicher, Teil b: in der App

**Hochladen:** Chat-Anhänge gehen gekennzeichnet ins Blob-Netz
(`uploadAnhang` → `uploadBlob(…, { verschluesselt: true })`,
`blob-client.ts:115`) – nur solche Stücke halten Speicherknoten (8.9a).

**Laden mit Speicherknoten** (`speicher-abruf.ts`, `blob-client.ts:189`):
Findet die App auf den Relays zu wenige Stücke einer verschlüsselten Datei,
nimmt sie bis zu vier Speicherknoten aus deren Angeboten (mit Speicher-Rolle,
höchstens 24 Stunden alt, je Schlüssel das neueste), fragt jeden je fehlendem
Stück versiegelt an – von einem frischen Sitzungsschlüssel je Download, mit
der Rechenarbeit, die der Knoten verlangt – und liest danach bis zu zwölf
Sekunden lang erneut vom Relay; jedes Stück wird gegen das Manifest geprüft.
Unverschlüsselte (ältere) Blobs fragen keine Knoten an. Fund beim Bauen: die
Veröffentlichen-Methode des Pools wurde ungebunden weitergereicht (`this`
fehlte) – jetzt als Pfeilfunktion, ein Test hätte es sonst erst im Browser
gezeigt.

**Git-Bundles** (Entscheidung MENSCH 26.09.2026): verschlüsselt hochgeladen
(`app.ts:665`), der Schlüssel steht öffentlich in der Referenz 38042
(`["aes-gcm", key, nonce, ox]`, `git.ts`); beim Laden entschlüsselt die App mit
ihm (`agent-netz.ts:146`). Lesen kann weiter jeder, Speicherknoten halten nur
Chiffrat. Ältere Referenzen ohne Schlüssel bleiben lesbar (Klartext-Bundle).
Der Leak-Test „Git-Bundle offen“ hielt die alte Entscheidung fest; er prüft
jetzt die neue: `uploadAnhang` für das Bundle, Schlüssel in der Referenz, kein
`uploadBlob` mehr in `app.ts`.

**Browser-E2E** (vorgetäuschtes Relay, echtes `git bundle`): Gerät 1
veröffentlicht – alle Stücke gekennzeichnet, Referenz mit Schlüssel, weder
Dateiinhalt noch Bundle-Bytes im Klartext am Relay; Gerät 2 lädt das Bundle
herunter, byte-gleich; keine Seitenfehler.

**Datenschutz:** neue Aussage „speicher-abruf“ (belegt: Abrufe verraten weder
Identität noch Datei).

**Tests:** protocol +2 (Referenz mit Schlüssel, alte/kaputte Schlüssel), app +3
(Knotenwahl, Download über Knoten, Unverschlüsseltes fragt keine Knoten).

Endstand: protocol 1117 (+ 6 übersprungen) · node 216 (+ 7 übersprungen ohne
Netz) · app 327 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (2 Ausnahmen weniger) · innerHTML streng 0 unbewertet · Smoke-Test
bestanden · Browser-E2E bestanden.

## Schritt 8.7 – Agent und Werkzeuge

**Sandbox je Werkzeug im Knoten** (`tools.ts`, aufgerufen aus
`dvm-provider.ts:810` über `ToolRegistry.run`, `tools.ts:276`): zu lange
Eingaben (über 2.000 Zeichen) werden abgelehnt – gekürzt schriebe file_io still
eine halbe Datei –, jede Ausführung hat ein Zeitlimit (20 s, Bild/Video 10 min),
die Ausgabe an den Kunden ist gekürzt. Netz nur über `safeFetch`
(SSRF-Wächter, auch bei Weiterleitungen) und `leseBegrenzt` (höchstens 1 MB,
danach wird die Verbindung geschlossen). web_search nur zu
api.duckduckgo.com – die Suchanfrage ist Text und wählt kein Ziel;
browser_use nur Text (kein Bild, kein Archiv); file_io nicht über Symlinks aus
dem Workspace hinaus (echter Pfad gegen echten Workspace, Symlinks abgelehnt),
Dateien höchstens 64 KB, im Ergebnis nur der Pfad im Workspace statt des
absoluten Pfads beim Betreiber; Bild und Video nur über das vom Betreiber
konfigurierte ComfyUI, im Ergebnis Dateinamen statt der internen Adresse
(`http://127.0.0.1:8188/view?…`).

**Fund – SSRF-Lücke:** `new URL("http://[::ffff:127.0.0.1]/")` liefert den Host
`[::ffff:7f00:1]`. `isPrivateIPv6` suchte nur eine eingebettete IPv4 mit
Punkten und hielt die Hex-Form für öffentlich – ein Fremder hätte über
browser_use Ollama, LND-REST oder die Cloud-Metadaten erreicht. Jetzt wird
IPv6 vollständig gelesen (acht Gruppen): mapped, compatible, NAT64 (64:ff9b::),
6to4 (2002::), Multicast; unklare Formen gelten als privat. Die Prüfung liegt
seit 8.7 im Protokoll (`adressbereich.ts`), der Knoten reicht sie weiter, die
App nutzt dieselbe.

**Lokale Werkzeuge der App** (`local-tools.ts:91`, eigener Browser als
Fallback): browser_use nur zu öffentlichen http(s)-Zielen – ohne Zugangsdaten
in der URL, ohne localhost/.local/.internal, ohne private Adressen –, ohne
Cookies, ohne Weiterleitungen (deren Ziel ließe sich im Browser nicht vorher
prüfen), nur Text, höchstens 1 MB. Grenze: Im Browser lässt sich ein Name
nicht auflösen – ein öffentlicher Name auf eine private Adresse fällt dort
nicht auf (CORS verhindert meist das Lesen).

**Kosten je Werkzeug in sats und SOL** (`werkzeug-preise.ts`,
`agent.ts:95`/`:1391`): an jedem Werkzeug-Knopf der günstigste angebotene
Preis, sonst der Richtpreis, in beiden Einheiten über den Marktkurs; ohne Kurs
„SOL: kein Kurs“. Bezahlt wird wie bisher über den Auftrag.

**Abnahme – je Werkzeug ein Sandbox- und ein SSRF-Test**
(`node/test/werkzeug-sandbox.test.ts`, ohne Netz: Auflösung austauschbar,
`fetch` ersetzt, lokaler ComfyUI-Ersatz): web_search (fester Host, privat
aufgelöst abgelehnt / riesige und hängende Antworten), file_io (Symlinks,
Größen, nur Dateien / URL als Pfad nie abgerufen), browser_use (privat,
Metadaten, IPv6-Loopback, Weiterleitung nach innen, Zugangsdaten / nur Text,
begrenzt, Skripte weg), image_gen und video_gen (Eingabe wählt kein Ziel,
keine interne Adresse im Ergebnis / zu langer Prompt abgelehnt, Video höchstens
10 s und 720p, Zeitlimit bei stummem ComfyUI). Dazu Regressionstest für die
Lücke und App-Tests für die lokalen Werkzeuge.

**Grenze, ehrlich:** Werkzeuge laufen im Knotenprozess, nicht in einem eigenen
Prozess mit eigenen Rechten. Nodes Rechte-Modell (`--permission`) funktioniert
mit Node 22, braucht mit tsx aber `--allow-worker`, und das hebelt es aus.
Isolation auf Betriebssystem-Ebene (systemd, Container, kein Zugang zu
privaten Netzen) gehört zum Installer (8.2).

**Tests:** node +9 (acht Sandbox/SSRF, ein Regressionstest), app +5 (vier lokale
Werkzeuge, Preise).

Endstand: protocol 1117 (+ 6 übersprungen) · node 225 (+ 7 übersprungen ohne
Netz) · app 332 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 8.6a – Geräte und Schlüsselwechsel, Teil a: Diebstahl-Wechsel

**Entscheidungen MENSCH (26.09.2026):** Das Mandat wird nicht mehr ersetzbar,
die Apps der Kontakte merken sich das erste Mandat, das sie sehen. Geräte:
Absender versiegeln an jedes Gerät des Empfängers (Teile b und c).

**Fund, zweifach:** (1) Das Mandat (38067) hatte den festen d-Tag „rotation“ –
ein ersetzbares Event. Ein Dieb mit dem alten Schlüssel konnte es auf den
Relays durch sein eigenes ersetzen. (2) „Das früheste Mandat gewinnt“
vertraute dem `created_at`, das der Absender selbst setzt – ein Dieb konnte
seines zurückdatieren. Dazu wertete keine App Widerrufe aus: Der vorbereitete
Wechsel hatte bei Kontakten keine Wirkung.

**Protokoll** (`key-rotation.ts`): Mandate haben eine eigene Adresse je
Nachfolger (`rotation:<neu>`), ein zweites ersetzt das erste nicht mehr.
`merkeMandate()` merkt je altem Schlüssel das zuerst gesehene Mandat;
`resolveKey(…, { gemerkt })` nimmt dieses statt des ältesten Zeitstempels –
auch wenn die Relays es inzwischen nicht mehr liefern. Der Hinweistext nennt
die Grenze: Wer das Mandat vor dem Diebstahl nie gesehen hat, kann auf ein
zurückdatiertes hereinfallen, bis es Zeitzeugen gibt (5.10).

**App:** Beim Abgleich des Posteingangs (`kommunikation.ts:1038`) lädt die App
Mandate und Widerrufe ihrer Kontakte, merkt neue Mandate (`freedom.mandate`,
Tresor und Sicherung) und leitet den Stand ab (`schluessel-status.ts`).
Gestohlene, abgelöste oder streitige Schlüssel bekommen ein ⚠ in der Liste
und einen Hinweis über dem Verlauf (`kommunikation.ts:1085`) mit „zum neuen
Schlüssel wechseln“ – die Unterhaltung geht mit dem Nachfolger weiter, die alte
bleibt markiert stehen. Nachrichten des alten Schlüssels nach dem gemeldeten
Diebstahl tragen „⚠ vielleicht nicht von dieser Person“ (`:1183`, statisches
Markup, begründete innerHTML-Ausnahme). Der Widerruf in den Settings
(`settings.ts:278`) prüft die Eingaben – der Ersatzschlüssel war ungeprüft an
`fromHex` gegangen – und sendet nur, wenn ein Mandat genau diesen Ersatz nennt;
der rohe Schlüssel wird danach genullt.

**Browser-E2E** (drei Geräte, vorgetäuschtes Relay): A bereitet vor (Mandat
mit eigener Adresse, Ersatzschlüssel als Datei), B legt A als Kontakt an und
merkt das Mandat. Ein Dieb stellt mit A's Schlüssel ein auf 2020
zurückdatiertes Mandat auf sich aus, widerruft selbst und schreibt B „Bitte
schick mir sofort 0,5 SOL“. A widerruft mit dem Ersatzschlüssel (Diebstahl seit
gestern). B sieht ⚠ und den Hinweis „gilt als gestohlen“, der Wechsel zeigt
den **echten** Nachfolger, die Geld-Nachricht ist markiert; B wechselt und
schreibt dem neuen Schlüssel, A2 (neues Gerät mit Ersatzschlüssel) empfängt
es. Keine Seitenfehler.

**Aufteilung:** a (dieser Teil) Schlüsselwechsel; b Geräte im Protokoll und
beim Senden (an jedes Gerät versiegeln); c Geräte in der App (Anmelden als
Gerät, Entzug), E2E mit zwei Geräten. MENSCH: einmal mit einem echten zweiten
Gerät.

**Tests:** protocol +5 (eigene Adresse, zurückdatiert, merken, Gedächtnis ohne
Relay, Hinweistext), app +3 (Stand und Markierung, Gedächtnis streng,
Verdrahtung).

Endstand: protocol 1122 (+ 6 übersprungen) · node 225 (+ 7 übersprungen ohne
Netz) · app 335 · Leak-Tests 48 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (4 Ausnahmen weniger) · innerHTML streng 0 unbewertet · Smoke-Test
bestanden · Browser-E2E bestanden.

## Schritt 8.6b – Geräte und Schlüsselwechsel, Teil b: an jedes Gerät versiegeln

**Entscheidung MENSCH (26.09.2026):** Absender versiegeln an jedes Gerät des
Empfängers. Bisher konnte ein Gerät (eigener Schlüssel mit Vollmacht 38070)
keine Direktnachricht lesen – alle Umschläge gingen nur an die Hauptidentität.
Schrieb ein Gerät, sahen Kontakte einen fremden Schlüssel.

**Protokoll:** `buildPrivateDm(…, { weitereEmpfaenger })` versiegelt dieselbe
Nachricht zusätzlich je Schlüssel in einem eigenen Umschlag (mit eigenem
Zeitversatz, auch beim Ablauf); im Inneren bleibt `p` die Person. Doppelte,
eigene und ungültige Schlüssel fallen weg. `openPrivateDm(…, { auchFuer })`
liest auch für weitere Schlüssel – die Hauptidentität für ihre Geräte, ein
Gerät für seine Person. `geraete-post.ts`: `nachrichtenGeraete()` (aktive
Vollmachten mit „nachrichten“), `alleGeraete()` (auch entzogene – was sie
vorher schrieben, bleibt lesbar), `absenderPerson()` (wer steckt hinter einem
Absender). Nach einem Entzug gilt ein Gerät nicht mehr als die Person; was
„vorher“ datiert ist, gilt, trägt aber `entzogen` – der Zeitstempel ist nur
behauptet. Da jeder für jeden Schlüssel eine Vollmacht ausstellen kann, gewinnt
bei mehreren Eigentümern der eine Kontakt, sonst keiner.

**App:** `geraete-buch.ts` lädt Vollmachten und Entzüge je Person höchstens
einmal pro Minute (nach eigenem Ausstellen oder Entziehen sofort,
`settings.ts:382`, `:404`). Senden (`kommunikation.ts:1256`, `:1261`): Kopien
an die Geräte des Kontakts und die eigenen, zugestellt am Posteingang der
Person. Öffnen (`:893`, `:895`): Kopien eigener Geräte erscheinen als „du · von
deinem Gerät …“, Nachrichten von Geräten eines Kontakts in dessen Unterhaltung
als „über Gerät …“ (Autor und ⚡ die Person); nach dem Entzug steht die
Nachricht unter dem Geräteschlüssel mit ⚠. Der Gerätename kommt aus der
Vollmacht (Fremddaten) und geht nur durch `escapeHtml` ins HTML (`:1206`,
begründete Ausnahme). Der Entzugsdialog nennt die Grenzen.

**Datenschutz:** neue Aussagen „geraete-kopien“ (belegt, Szenario: vier
Umschläge ohne Klartext, Absender verborgen, p nur Personen und Geräte) und
„geraete-vollmacht“ (Grenze: Vollmachten sind öffentlich; der Posteingang sieht
Umschläge an Person und Geräte gleichzeitig ankommen – wer das nicht will,
nutzt NIP-46). Leak-Test „DM an Personen mit Geräten“.

**Browser-E2E** (vorgetäuschtes Relay, Geräte als Skript – die App als Gerät
folgt mit c): O und K legen je ein Gerät über die Settings an. K schreibt O:
je ein Umschlag an O, K, Os Handy, Ks Tablet; das Handy liest ihn. Das Handy
antwortet K, das Tablet schreibt O. Bei O: „du · von deinem Gerät „Handy““ und
Ks Tablet-Nachricht in Ks Unterhaltung, keine neue Anfrage. Bei K: die
Handy-Antwort unter Os Schlüssel, ⚡ an O. O entzieht das Handy: die nächste
Nachricht geht nicht mehr ans Handy; was der Dieb danach mit dem Handy
schreibt, landet bei K als eigene Anfrage mit „⚠ … Vollmacht entzogen“, nicht
bei O; bei O steht es mit „⚠ … nach dem Entzug – nicht von dir“, die frühere
Handy-Antwort mit „Zeitpunkt nicht belegt“. Keine Seitenfehler.

**Grenzen:** Nur Chat-Nachrichten gehen an Geräte – Trinkgeld-Belege,
Adress-Anfragen und Nachfolge-Anteile weiter nur an die Person. Ein Entzug
wirkt bei Kontakten, sobald sie ihn sehen (höchstens eine Minute nach dem
Abgleich). Anmelden als Gerät in der App ist Teil c.

**Tests:** protocol +5 (Kopien und Ziele, Öffnen als Gerät, Antwort des
Geräts, Entzug, fremde Vollmacht), app +4 (Buch und Frische, Zuordnung, Entzug
und fremde Vollmacht, Verdrahtung), Leak +1.

Endstand: protocol 1127 (+ 6 übersprungen) · node 225 (+ 7 übersprungen ohne
Netz) · app 339 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen (1 Ausnahme weniger: `checkDeviceEvent` jetzt verdrahtet) · innerHTML
streng 0 unbewertet · Smoke-Test bestanden · Browser-E2E bestanden.

## Schritt 8.6c – Geräte und Schlüsselwechsel, Teil c: die App als Gerät

**Gerätecode:** Beim Ausstellen einer Vollmacht zeigt die App statt des
rohen Schlüssels einen Gerätecode `freedom-geraet:<person>:<geräteschlüssel>`
(`geraete-modus.ts`; `settings.ts:406`, danach wird die Kopie des Schlüssels
genullt). „Identität importieren“ nimmt ihn an (`app.ts:277`), merkt die Person
in `freedom.geraet.person` und meldet sich beim Start wieder als Gerät an
(`app.ts:129`). Ein gewöhnlicher Import beendet den Gerätemodus. Die Person
steht im Code und kommt nicht aus einer Vollmacht vom Relay: Vollmachten kann
jeder für jeden Schlüssel ausstellen – ein Fremder soll ein Gerät nicht still
an sich binden.

**Als Gerät:**
- `sprichtFuer()` und `alsGeraet()` (`state.ts`).
- Keine eigenen Relay-Listen; stattdessen kommen die Posteingangs-Relays der
  Person in den Pool (`state.ts:290`, `:311`). Dorthin stellen Kontakte die
  Kopien für Geräte zu (8.6b).
- Beim Öffnen liest die App für die Person und ihre Geräte mit
  (`kommunikation.ts:894`). Eigene Nachrichten, die der Person und die der
  anderen Geräte erscheinen als „du“ (`:1168`).
- Senden nur mit gültiger Vollmacht mit „nachrichten“ (`:1252`); die Kopie
  geht an die Person und ihre Geräte, zugestellt an ihrem Posteingang.
- Settings → Geräte zeigt den Stand der eigenen Vollmacht (`settings.ts:342`).
  „Gerät hinzufügen“, „Schlüsselwechsel vorbereiten“ und „Nachfolge
  einrichten“ sind gesperrt (`nurHauptidentitaet()`, `:67`, `:247`, `:380`) –
  sie gehören der Hauptidentität.

**Browser-E2E** (drei Apps, vorgetäuschtes Relay):
1. O stellt eine Vollmacht „Handy“ aus.
2. D importiert den Gerätecode und ist danach als Handy angemeldet: Settings
   zeigen „spricht für O · Aktiv“, „Gerät hinzufügen“ ist ausgeblendet, der
   Schlüsselwechsel ist gesperrt.
3. K schreibt O. D liest mit und antwortet: je zwei Umschläge an O, K und das
   Handy. D veröffentlicht keine eigenen Listen.
4. K sieht die Antwort unter Os Schlüssel mit „über Gerät „Handy““, ohne neue
   Anfrage. O sieht „du · von deinem Gerät „Handy““.
5. O entzieht das Handy:
   - D zeigt „Entzogen am …“.
   - Ein Sendeversuch bricht mit Hinweis ab, ohne ein Event.
   - Ks nächste Nachricht geht nicht mehr ans Handy.
6. Keine Seitenfehler.

Zusätzlich liefen das 8.6b-E2E (Geräte als Skript, Dieb nach dem Entzug) und
das 8.6a-E2E (Diebstahl-Wechsel) erneut durch. Damit ist die Karte erfüllt:
„Gerät entziehen und Diebstahl-Wechsel einmal vollständig durchgespielt“.

**Grenzen:**
- Als Gerät nur Direktnachrichten. Räume, Zahlungen, Profil und Sicherung laufen
  unter dem Geräteschlüssel wie eine eigene Identität – wie vor 8.6c.
- Beim ersten Start nach dem Import liest das Gerät den Posteingang, sobald
  die Liste der Person geladen ist.
- MENSCH: einmal mit einem echten zweiten Gerät durchspielen.

**Tests:** app +4 (Gerätecode, Stand der Vollmacht, Zuordnung auf dem Gerät,
Verdrahtung und Sperren).

Endstand: protocol 1127 (+ 6 übersprungen) · node 225 (+ 7 übersprungen ohne
Netz) · app 343 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden · drei
Browser-E2E bestanden.

## Schritt 8.1a – Onboarding, Teil a: Sicherung und Führung, die stimmen

**Entscheidungen MENSCH (26.09.2026):**
- Nur Passphrase. Ein Passkey (Tresor per WebAuthn-PRF) wäre ein neuer
  Krypto-Pfad und wird ein eigener späterer Schritt.
- Die Merkphrase darf „später“ bestätigt werden; die Leiste mahnt.

**Funde:**
- `#onboarding-bar` und `#backup-warn` fehlten im HTML (bekannt seit 1.3e).
  Führung und Sicherungs-Erinnerung erschienen deshalb nie.
- Der Gratis-Zähler `freedom.freeLeft` wurde nirgends gesetzt und stand immer
  auf 10 („Noch 10 Gratis-Anfragen übrig“).
- Die Import-Aufforderung nannte „Merkphrase, nsec1…“, angenommen wurde nur Hex.

**Sicherung:**
- Eine neue Identität legt ihre Merkphrase bis zur Bestätigung in den
  Geheimspeicher (`app.ts:150`, `LS_MERKPHRASE`). Mit Tresor liegt sie dort
  verschlüsselt; die Notfall-Löschung erfasst sie; in eine Zustandssicherung
  kommt sie nie (`SICHERUNG_NIE`).
- Der Dialog hat „später bestätigen“ (`:191`). Nach der Bestätigung wird die
  Merkphrase gelöscht (`:226`).
- „Merkphrase anzeigen“ in Leiste oder Erinnerung zeigt dieselben Wörter erneut
  (`:281`). Liegt sie nicht mehr auf dem Gerät, heißt der Knopf ehrlich
  „Sicherungsdatei speichern“.

**Führung:**
- Beide Elemente stehen im HTML (`index.html:58`).
- Die Erinnerung erscheint erst nach der ersten Nutzung und nicht doppelt zur
  Leiste (`:264`); wer die Leiste wegklickt, behält sie.
- „Wallet verbinden“ wird erst dringend, wenn ein Provider eine Gratis-Anfrage
  ablehnt (`agent.ts:354` → `merkeGratisAbgelehnt()`, `app.ts:379`).
- Texte: Im Gratis-Tarif kostet eine Anfrage kein Geld, solange Provider ihn
  anbieten; das Gerät rechnet dafür kurz. Bezahlt wird in Sats oder SOL.

**Import:**
- Der Import nimmt jetzt Merkphrase, nsec, Hex und Gerätecode
  (`identity.importIdentity`, `app.ts:322`). Ein npub bekommt eine klare Meldung.
- Wer die Merkphrase eingibt, gilt als gesichert. Nach einem Import ohne
  Merkphrase verspricht die App keine Wörter mehr (`markOhneMnemonic()`).

**Browser-E2E** (frische Profile, ohne Netz nach außen):
1. Neuer Nutzer wählt „später“: Die Wörter liegen im Geheimspeicher, die Leiste
   sagt „Stell einfach eine Frage“, keine Mahnung.
2. Nach der ersten Nutzung sagt die Leiste „Sichere deinen Zugang · Merkphrase
   anzeigen“. Wegklicken lässt die Erinnerung stehen.
3. „jetzt sichern“ zeigt dieselben zwölf Wörter; nach der Bestätigung sind sie
   gelöscht, der nächste Schritt ist der Tresor.
4. Import per Merkphrase und per Hex in frischen Profilen ergibt dieselbe
   Identität; npub wird mit Meldung abgelehnt.
5. Mit Tresor liegt weder Schlüssel noch Merkphrase offen in localStorage.
6. Keine Seitenfehler.

Das 8.6c-E2E (Gerätecode-Import) lief erneut durch.

**Tests:** app +7 (Merkphrase im Geheimspeicher und nie in der Sicherung, HTML,
Leiste ohne Zähler, Import, Texte ohne Zähler, Sicherung je nach Merkphrase).

Endstand: protocol 1127 (+ 6 übersprungen) · node 225 (+ 7 übersprungen ohne
Netz) · app 350 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden · Browser-E2E
bestanden.

## Schritt 4.0 – Entscheidung Gebührenmodell: A+ (und 2.2b: WASM eingebettet)

**4.0 (MENSCH, 26.09.2026): A+** – feste Aufteilung direkt beim Zahlen, kein
Topf. Die Quote hat der MENSCH dem Agenten übertragen („einmalig, für eine
effektive und stabile Entwicklung“): je KI-Auftrag **95 % Provider, 3 %
Entwicklung, 2 % Relays**, die ihn getragen haben. Zusammen 5 % wie bisher
(2,5 % Protokoll + 2,5 % App), Kunden und Provider merken keinen Unterschied
im Betrag – nur geht das Geld jetzt direkt an Arbeit statt in einen Topf.
Regeln: nicht zuordenbar → Provider; Lightning-Anteile unter 100 sats sammelt
die App des Zahlenden (keine Verwahrung); Obergrenze 10 %; Entwicklungsanteil
voreingestellt an, abschaltbar; keine Anteile auf Zaps, Trinkgeld, Tausch,
Relayer, Speicher, Prüfer; keine Werbeprovision; Sonderanreize über
gesponserte Pools (5.1b). Vollständig in `docs/GEBUEHREN-ENTSCHEIDUNG.md`;
Karten 4.0 und 5.1 angepasst. Code folgt mit 5.1 (Aufteilung, Rückbau von
Pool, Werben, Treasury) und 4.3 (Zahlkanal).

**2.2b (MENSCH, 26.09.2026):** MDK als WASM **eingebettet** – die App bleibt
eine Datei (etwa 2,2 → 4,1 MB). Eingetragen in `docs/MLS-ENTSCHEIDUNG.md`.

**MENSCH vor 5.1 live:** Empfänger-Adressen der Entwicklung (Lightning über
einen eigenen Knoten, SOL-Mehrfachsignatur).

## Schritt 8.1b – Onboarding, Teil b: Einrichtung statt Willkommenskarte

**Vorher:** Beim ersten Start kamen zwei Überlagerungen zugleich: der
Merkphrasen-Dialog und eine Willkommenskarte mit drei Schritten („Verbinden“,
„AI testen: 3 Gratis-Antworten“, „Zap senden: 1 sat an Provider“). Deren Knopf
„Starten“ schloss nur die Karte.

**Einrichtung** (`einrichtung.ts` ohne DOM, `shell/einrichtung-ui.ts`), in der
Reihenfolge der Karte:
1. Merkphrase und Sicherung (Dialog aus 8.1a, „später“ möglich).
2. Schutz: Passphrase für den Tresor.
3. Standard-Schiene: sats oder SOL.
4. Private Voreinstellungen:
   - Verbindung.
   - Kontakte-Abgleich (Standard aus).
   - Werber, nur wenn jemand über einen Link kam (Standard aus).
   - Die Datenschutz-Sätze stehen wörtlich aus `PRIVACY_FACTS`: drei belegte,
     die IP-Adresse als „noch nicht“.
5. Vorhaben (KI, Nachrichten, Rechner vermieten): Die App öffnet den passenden
   Reiter; die Onboarding-Leiste richtet sich danach.

Verhalten:
- Jede Seite ist überspringbar, „Einrichtung überspringen“ beendet sie.
- Der Tresor-Schritt entfällt, wenn schon einer da ist oder die Anmeldung per
  Bunker läuft.
- Bricht jemand ab und lädt neu, geht es weiter (`app.ts:564`), ohne die
  Merkphrase erneut aufzudrängen (Stand „laeuft“).
- Der Sicherungsdialog öffnet sich nie zweimal übereinander (`:168`).
- Einstellungen setzt die Einrichtung über die Bedienelemente der Settings
  (`einrichtung-ui.ts:126`, `:133`). Deren Handler sortieren bei Tor die Relays
  und sichern die Kontaktliste – dasselbe wie dort.

**Fund:** Wer über einen Werbe-Link (`?ref=`) kam, veröffentlichte beim zweiten
Start ungefragt die Werbebeziehung – eine öffentliche Verknüpfung zweier
Schlüssel. Jetzt nur mit Zustimmung (`earn.ts:424`, `darfWerberNennen()`);
die Werben-Karte sagt es auch.

**Verdrahtet:**
- Eine neue Identität startet die Einrichtung (`app.ts:156` → `:253`).
- Die Willkommenskarte samt Stilen ist entfernt.

**Browser-E2E** (vorgetäuschtes Relay, Werbe-Link):
- **Durchlauf mit Zustimmung und ohne:**
  - Folge sichern → schutz → zahlen → privat → los.
  - Kontakte und Werber nicht vorausgewählt, der Satz zur IP-Adresse steht da.
  - Tresor eingerichtet, Schiene SOL, Tor bevorzugt, auch in den Settings.
  - Vorhaben „Nachrichten“ öffnet den Chat.
  - Ein Werbe-Event gibt es nur mit Zustimmung, auch nach dem Neustart; die
    Einrichtung erscheint nicht wieder.
  - Nötig sind 6 Klicks und 6–7 Eingaben (drei Wörter, zweimal die Passphrase,
    Verbindung, gegebenenfalls Werber).
- **Überspringen:** Die Einrichtung ist sofort weg, die Leiste führt weiter.
- Keine Seitenfehler.
- Die E2Es aus 8.1a und 8.6c liefen erneut durch. Das 8.1a-E2E fand dabei die
  zwei Fehler, die jetzt behoben sind: die Merkphrase beim Fortsetzen erneut,
  und zwei Dialoge übereinander.

**MENSCH:** Die Karte ist erfüllt, wenn ein Test-Durchlauf ohne Hilfe unter
fünf Minuten bleibt. Automatisch dauert er 2,5 s. Ein Mensch braucht vor allem
Zeit, um zwölf Wörter aufzuschreiben – mit einer fremden Person testen.

**Tests:** app +5 (Seiten und Reihenfolge, einmal und Fortsetzen,
Werber-Zustimmung samt Kartentext, Datenschutz wörtlich, Verdrahtung).

Endstand: protocol 1127 (+ 6 übersprungen) · node 225 (+ 7 übersprungen ohne
Netz) · app 355 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden · Browser-E2E
bestanden.

## Schritt 4.0 – Korrektur: Werbeanteil und Hosting (MENSCH, 26.09.2026)

Die erste Fassung von A+ (95 % Provider, 3 % Entwicklung, 2 % Relays, „keine
Werbeprovision“) ließ das Werben weg – ein Fehler beim Eintragen: Die
Entscheidung betraf nur „nichts verwahren“, belohnt werden sollen **alle
Teile sofort**. Der B-Agent hatte die Fassung gelesen, aber keinen Code
geändert (8.1b machte nur die öffentliche Werbebeziehung zustimmungspflichtig –
Datenschutz, bleibt richtig).

**Stand im Code (bis 5.1):** 2,5 % je Auftrag, davon 0,5 % Werben – aber der
Knoten zahlt es an **eine** feste Adresse aus seiner Konfiguration
(`FEE_REFERRAL_LUD16`, standardmäßig leer); beim tatsächlichen Werber kommt
nichts an. Stufen und zweite Ebene werden nur angezeigt; Hosting-Anteil (2 %)
und Funk-Bonus (10 %) stehen als Konstanten da und werden nirgends benutzt.

**Neue Aufteilung (vom MENSCH bestätigt):** je KI-Auftrag 94 % Provider,
2,5 % Entwicklung, 1,5 % Relays, 0,5 % Werber des Kunden, 0,5 % Werber des
Providers, 1 % Hosting (App-Spiegel) – direkt beim Zahlen an jeden, nicht
zuordenbar → Provider, alles fest voreingestellt, Werben eine Ebene je Seite
ohne Stufen. Einzelheiten in `docs/GEBUEHREN-ENTSCHEIDUNG.md`; Karten 4.0 und
5.1 angepasst.

**2.2b:** „eingebettet“ mit den gemessenen Zahlen bestätigt (App etwa 6,3 MB
statt der geschätzten 4,1 MB).

## Schritt 8.3a – Liquiditätsgeber, Teil a: Macaroon geprüft, Ablauf der Hinrichtung

**Karte veraltet:** Sie nennt „Tests (bisher keine)“. Seit 4.6/4.9 gibt es
Tests für Hinrichtung, Gegenrichtung und versiegelte Anfragen; beide
Richtungen laufen.

**Fund, dreifach, in der Hinrichtung (sats → SOL):**
1. Löste der Kunde bis zur Frist nicht ein, holte der LP seine SOL nie zurück
   – `refund()` wurde nirgends aufgerufen, die Hold-Invoice blieb stehen.
2. Die Sitzungen lagen nur im Speicher: Ein Neustart vergaß jede Sperre.
3. Die Frist kam aus `Date.now()` statt aus der Uhr des Daemons.

Die Anleitung für eine eingeschränkte Macaroon stand schon in `docs/SWAPS.md`;
geprüft wurde nichts, die Fehlermeldung verlangte sogar „Pfad zum
admin.macaroon“.

**Macaroon** (`protocol/src/lnd-macaroon.ts`):
- `macaroonRechte()` liest die Rechte ohne LND aus der Macaroon: Binärformat
  v2, darin die LND-Kennung (Version 3 + Protobuf `ops`).
- `pruefeLpMacaroon()` lässt genau `invoices:read/write` und
  `offchain:read/write` zu (`info:read` darf dabei sein) und nennt, was zu viel
  ist oder fehlt.
- Der Knoten startet den LP nur damit (`main.ts:464`); mit admin.macaroon
  bricht er ab.
- Der falsche Kommentar im LND-Adapter („settle braucht admin“) ist berichtigt.

**Ablauf der Hinrichtung** (`lp-daemon.ts`):
- Jede Sitzung wird abgelegt, **bevor** gesperrt wird: `SPERRT`, dann
  `SOL_LOCKED`, dann `INVOICE_CREATED`, mit Swap-ID, Frist und Empfänger. Die
  Ablage ist `~/.freedom/lp-hin.json`, nur für den Nutzer lesbar (`main.ts:524`).
- `holeAbgelaufeneZurueck()` (`:473`, in der Hauptschleife `main.ts:793`)
  läuft nach der Frist plus zwei Minuten Puffer:
  - Hat der Kunde eingelöst, wird abgerechnet, auch wenn der LP zwischendurch
    aus war.
  - Sonst holt der LP eine offene Sperre zurück und bricht **danach** die
    Hold-Invoice ab; eine bezahlte geht so an den Kunden zurück. Ein früher
    Abbruch hätte dem Kunden die SOL geschenkt.
  - Eine Sperre ohne Rechnung wird ebenso zurückgeholt; eine gescheiterte
    Sperre gilt als `FAILED`.
  - Ist die Sperre eingelöst oder ihr Konto schon geschlossen, das Preimage
    aber noch nicht lesbar, bricht er nie ab. Beim echten Programm schließt das
    Einlösen das Konto; ein Abbruch hätte dem Kunden SOL und sats gelassen. Er
    sucht weiter und gibt erst nach dem Ende der Hold-Invoice auf.
  - Fehler (Kette nicht erreichbar) versucht er in der nächsten Runde erneut.

**Tests:** protocol +4 (Rechte lesen, admin abgelehnt, jedes Recht zu viel oder
fehlend, Unlesbares), node +8:
- nie bezahlt;
- bezahlt, nicht eingelöst (Reihenfolge Rückholen vor Abbrechen, beide
  bekommen ihr Geld);
- eingelöst während der LP aus war;
- Neustart;
- Sperre ohne Rechnung und gescheiterte Sperre;
- Konto geschlossen, Preimage erst später lesbar – nie abgebrochen;
- Rückholung scheitert einmal;
- Verdrahtung.

**Offen (8.3b):** Abnahme-Lauf gegen echtes Devnet und Testnet in beiden
Richtungen inklusive Ablauf. MENSCH: Testnet-Knoten.

Endstand: protocol 1131 (+ 6 übersprungen) · node 233 (+ 7 übersprungen ohne
Netz) · app 355 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 8.3b – Liquiditätsgeber, Teil b: Abnahme-Lauf beide Richtungen mit Ablauf

Die Karte ist erfüllt, wenn beide Richtungen auf Devnet und Testnet
einschließlich Ablauf laufen. Dafür gibt es jetzt einen Lauf, der genau das
prüft. Mit Mocks läuft er im Test, gegen echte Netze startet ihn der MENSCH.

**Lauf** (`node/src/lp-abnahme.ts`): Die vier Fälle laufen mit eigenen Adaptern
für LP und Kunde, über dieselben Schnittstellen wie der Knoten.
- `hin`: Der LP sperrt und stellt die Hold-Invoice; der Kunde zahlt, löst mit R
  ein, und der LP rechnet ab.
- `hin-ablauf`: Der Kunde zahlt, löst aber nicht ein. Nach der Frist holt der LP
  zurück und bricht die Rechnung ab.
- `rueck`: Der Kunde sperrt unter dem Hash seiner Rechnung, der LP zahlt und löst
  ein.
- `rueck-ablauf`: Die Rechnung ist abgebrochen, die Zahlung scheitert, und der
  LP löst nicht ein. Der Kunde holt nach seiner Frist zurück.

Jeder Fall prüft das Ergebnis auf der Kette und bei Lightning. Ein Fehler endet
nur in seinem Fall.

**Echter Lauf** (`node/src/lp-abnahme-lauf.ts`, `npm run lp-abnahme`):
- Die Einstellungen kommen aus der Umgebung; was fehlt, wird genannt.
- Nie Mainnet: Die Solana-Adresse muss Devnet, Testnet oder lokal sein, und eine
  Probe-Rechnung des Kunden muss Testnet, Signet oder Regtest sein.
- Der LP nutzt wie im Betrieb nur eine eingeschränkte Macaroon.
- Die Gegenrichtung sperrt wie die App (`cltv · 20 min + 1,5 h`, mit 144
  Blöcken rund 49 h).
- Die Anleitung steht in `docs/SWAPS.md` („Abnahme-Lauf“).

**Tests:** node +5. Alle vier Fälle bestehen mit Mocks. Die Abnahme meldet
Fehler, und ein Fall stoppt die anderen nicht. Unsichere Fristen fallen auf,
bevor Geld bewegt wird. Nie Mainnet, fehlende Angaben werden genannt. Nur
Testnet-Rechnungen, eingeschränkte Macaroon, npm-Skript.

**MENSCH:** zwei LND-Knoten im Testnet, zwei Devnet-Konten, Programm-ID (0.G),
den Lauf ausführen und das Ergebnis im PR oder in `FORTSCHRITT.md` eintragen.

Endstand: protocol 1131 (+ 6 übersprungen) · node 238 (+ 7 übersprungen ohne
Netz) · app 355 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 2.2b-a – MLS-Baustein: MDK als WASM

**Ergebnis:** `packages/mls` – die Marmot-Engine von MDK (`cgka-engine`) samt
MDKs eigenem Speicher (`storage-sqlite`) und Nostr-Teil
(`transport-nostr-peeler`) läuft als WASM in Node und Chromium (dort unter der
strengen CSP mit `'wasm-unsafe-eval'`, gzip-komprimiert eingebettet und mit
`DecompressionStream` entpackt – geprüft mit einer Probeseite).

**Vorprüfung:** MDK bietet im Browser nur eine „compile-only“-Grenze ohne
Speicher. Statt rund 80 Speicher-Methoden selbst zu schreiben: SQLite als WASM
(`sqlite-wasm-rs` über rusqlite) mit MDKs eigenem Speicher, die Datenbank im
Speicher, Export/Import als Bytes für den Tresor. Dafür zwei kleine Patches an
MDK (`mdk.patch`): gebündeltes SQLite statt SQLCipher, `std::time` →
`web_time`; dazu `in_memory_from_bytes()`/`export_bytes()`. `nostr` braucht im
Browser einen Zeitgeber (`universal-time`) – steht in der Crate.

**Crate** (`crate/src/lib.rs`, wasm-bindgen): `MlsKonto` mit
`keyPackageEvent` (Kind 30443 wie MDKs App: d, mls_protocol_version, i,
Ciphersuite, Extensions, Proposals, App-Komponenten), `gruppeAnlegen` (mit
Nostr-Routing-Komponente: zufällige Gruppen-Id und Relays),
`beitreten`, `senden`, `einladen`, `entfernen`, `bestaetigt`/`gescheitert`,
`empfangen` (Kind 445 und 1059), `wartezeit`/`fortschreiten` (Konvergenz),
`mitglieder`, `gruppen`, `epoche`, `zustand`. Fähigkeiten wie MDKs App, damit
White-Noise-Gruppen unsere KeyPackages annehmen. Zwei Aufrufe eines Kontos
werden nie verschränkt.

**Schlüssel:** Die Engine sieht den Identitätsschlüssel nie. Der Kontobeweis
(Kind 450) wird in der App synchron signiert – `beweisBruecke()` prüft vorher
Art, Autor, d-Tag und Text; Siegel der Einladungen gehen über den Signer der
App – `signerBruecke()` signiert nur Kind 13 der eigenen Identität.

**Reproduzierbar:** `bauen.sh` holt MDK auf festem Stand, wendet den Patch an,
baut mit MDKs Rust-Version, `--locked`, festen Pfaden (remap) und
wasm-bindgen 0.2.129. Zweimal in verschiedenen Verzeichnissen gebaut:
bitgleich. Die CI baut bei Änderungen an `packages/mls` nach und vergleicht
(`.github/workflows/mls.yml`); die normalen Tests nutzen die eingecheckte
WASM (`dist/`, 3,0 MB gzip).

**Tests** (`packages/mls/test/mls.test.ts`, 9, neu in der CI): KeyPackage
(Tags, fremd signiert abgelehnt), Gruppe (Einladungen einzeln im Umschlag,
nicht von der Identität), Nachricht (Kind 445 von Wegwerf-Schlüsseln, nur
h-Tag, kein Klartext, Wiederholung ignoriert), Entfernen (entferntes Mitglied
liest nach dem Commit nichts mehr), Hinzufügen (neues Mitglied liest keine
alten Nachrichten), Reihenfolge (Nachricht vor ihrem Commit wird
zurückgehalten und danach zugestellt), Zustand (Export, Neuladen,
weiterschreiben), Manipulation (veränderte oder falsch signierte Events
abgewiesen), Brücken (signieren nur Kind 450 bzw. 13 der eigenen Identität).

**Noch nicht in der App** – Einbau (b), Nostr-Anbindung und Zustand im Tresor
(c), 1:1 als MLS-Gruppe (d), Geräte (e) folgen; Aufteilung in `phase-2.md`.

Endstand (nach dem Einmergen von 8.3b): protocol 1131 · node 239 · app 355 ·
mls 9 (neu) · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0
unbewertet · Smoke-Test bestanden · Nachbau bitgleich.

## Schritt 5.8 – RPC-Vielfalt: Stichprobe gegen einen zweiten Anbieter

**Karte zum Teil schon erfüllt:** Vier Anbieter verschiedener Betreiber
(Solana Labs, PublicNode, dRPC, Ankr) und eigener Endpunkt zuerst gab es
schon; seit 4.9 verteilt der Pool die Anfragen der App. Der Test der
Voreinstellung verlangt jetzt mindestens vier Betreiber statt drei. Es fehlte
die Stichprobe – der Kopfkommentar sagte sogar „kein Vergleich der Antworten“.

**Stichprobe** (`protocol/src/rpc-pool.ts:263`, `RpcPool.stichprobe()`):
- Zwei Endpunkte verschiedener Betreiber (grob: die letzten zwei Namensteile),
  der erste in der üblichen Reihenfolge – der eigene Knoten zuerst.
- Netz: Genesis-Hash beider gleich? Sonst Warnung „verschiedene Ketten“
  (Mainnet/Devnet/Testnet benannt), weiter wird nicht verglichen.
- Letzter Blockhash in beide Richtungen: A nennt seinen (finalized), B prüft
  ihn mit `isBlockhashValid` ab dem Stand von A (`minContextSlot`) – und
  umgekehrt. So wird jeder der beiden einmal geprüft.
- Kontostand (nur mit `konto`): bei beiden; weichen die Werte ab, zweimal ab
  dem höheren Stand wiederholen – eine echte Änderung dazwischen ist kein
  Befund, eine bleibende Abweichung schon.
- Widerspruch → `warnungen`; was sich nicht vergleichen ließ (tot, hinkt
  hinterher `-32016`, unbrauchbare Antwort, nur ein Betreiber) → `hinweise`.
  Fremde Antworten werden vor dem Vergleich auf Form geprüft (Base58-Hash,
  ganze Zahlen). Die Ausfallhistorie des Pools bleibt unberührt.
- Ein Aufruf an genau einen Endpunkt steht jetzt in `anfrage()`; `call()`
  nutzt ihn und verhält sich wie vorher.

**App** (`app/src/rpc-stichprobe.ts`):
- Settings → Verbindung → „erreichbarkeit prüfen“ (`shell/state.ts:230`):
  nach der Erreichbarkeit die Stichprobe ohne Adresse – verrät nichts über den
  Nutzer; Zeile grün (stimmt überein), rot (Widerspruch) oder neutral (nicht
  möglich).
- Eingebaute Wallet (`shell/eingebaute-wallet.ts:120`): nach dem Guthaben
  höchstens alle zehn Minuten eine zufällige eigene Adresse
  (`stichprobenKonto`) – je Stichprobe nur eine, damit kein Anbieter mehrere
  zusammen sieht; nur ein Widerspruch wird gezeigt (`#solw-rpc`, Hinweis).
- Anzeige nur über `textContent`; der Text in den Settings nennt die
  Stichprobe.

**Browser-Prüfung** (gefälschte Endpunkte im Playwright-Netz): eigener
Endpunkt + Voreinstellung ehrlich → „Stichprobe eigener Knoten ↔ Ankr:
letzter Blockhash stimmt überein.“; eigener Endpunkt im Devnet → rote Zeile
„eigener Knoten (Devnet) und PublicNode (Mainnet) hängen an verschiedenen
Ketten“. Keine Seitenfehler.

**Tests:** protocol +6 (übereinstimmend, falscher Blockhash je Seite, falscher
Kontostand und Änderung dazwischen, anderes Netz, nicht Vergleichbares,
Ausfallhistorie unberührt; Voreinstellung ≥ 4 Betreiber), app +4 (Takt und
Adresswahl, Texte, Warnung aus einem echten Pool, Verdrahtung).

**Offen, bewusst:** Der Knoten prüft Deposits mit einer festen URL
(`SOLANA_RPC_URL` oder `bestUrl()`); eine Stichprobe dort wäre ein eigener
kleiner Schritt. Die Stichprobe fängt einen Anbieter, der plump lügt – nicht
einen, der nur bei der Stichprobe schweigt oder ehrlich antwortet.

Endstand: protocol 1137 (+ 6 übersprungen) · node 238 (+ 7 übersprungen ohne
Netz) · app 359 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring `--streng`
0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 2.2b-b – MLS-Engine in der App

**Ergebnis:** Die MLS-Engine aus 2.2b-a steckt in `freedom.html`. Sie wird
erst gestartet, wenn sie gebraucht wird. Unter der echten CSP läuft sie im
Browser. Für Nachrichten wird sie noch nicht genutzt; das kommt mit c und d.

**Einbau** (`packages/app/build.mjs`):
- esbuild bündelt `@freedomstack/mls/wasm` (die `.wasm.gz`, 3,0 MB) als
  Base64-Text ins eine Skript (Loader `base64`). Dieses Skript deckt der
  CSP-Hash ab. Nachgeladen wird nichts, und es gibt weiter genau ein `<script>`.
- `script-src` enthält jetzt zusätzlich `'wasm-unsafe-eval'`. Damit ist nur
  das Übersetzen von WebAssembly erlaubt, kein `eval()`. Laden kann WASM nur ein
  Skript, das schon laufen darf.
- Vor dem Bündeln prüft der Build, dass die entpackte WASM zu
  `packages/mls/dist/SHA256SUMS` passt. Sonst bricht er ab: Ins Release kommt
  nur die Engine, die `bauen.sh` reproduzierbar baut.
- Die wasm-bindgen-Hülle sucht die `.wasm` ohne übergebene Bytes über
  `import.meta.url`. Im iife-Format gibt es das nicht. Ein kleines Build-Plugin
  leert diesen toten Zweig ausdrücklich, statt ihn zu verschweigen, und bricht
  ab, wenn sich die Hülle ändert.

**Laden** (`packages/app/src/mls-engine.ts`, neu):
- `mlsEngine()` dekodiert den Text beim ersten Aufruf. Es entpackt ihn mit
  `DecompressionStream` und startet die Engine asynchron (`starteMls()`, neu im
  Baustein). Chrome übersetzt große Module nicht synchron im Hauptthread.
- Ein Fehlschlag wird nicht gemerkt: Der nächste Aufruf versucht es neu.
- Fehlen `DecompressionStream` oder WebAssembly, kommt eine klare Meldung.
- Blockiert die CSP (ein Browser ohne `'wasm-unsafe-eval'`), kommt nur der
  Fehlername, nie Fremdtext.

**Verdrahtet:** Settings → Datenschutz → „Gruppenverschlüsselung (MLS)“ →
Selbsttest (`packages/app/src/shell/tabs/settings.ts`, `wireMeshTab`, beim
Start verdrahtet).
- `mlsSelbsttest()` legt ohne Netz und ohne die eigene Identität zwei
  Wegwerf-Konten im Speicher an.
- Ablauf: KeyPackage, Gruppe, Einladung, eine Nachricht. Geprüft wird, dass
  das Event den Text nicht enthält und dass Empfänger und Absender stimmen.
- Das Ergebnis ist ein fester Text (`textContent`).
- Der Kartentext sagt ehrlich: eingebaut, in Chats noch nicht genutzt,
  Direktnachrichten weiter über NIP-17.
- Wozu: Man sieht auf echten Geräten (Safari, Firefox, Android), ob die Engine
  dort läuft, bevor 2.2b-d Chats darauf stellt.

**Größe:** `freedom.html` 2.409 → 6.351 KB (von MENSCH bestätigt: „etwa 6,3 MB“).

**Tests:**
- `app/test/mls-engine.test.ts`, 4 neu:
  - Entpacken ergibt bitgleich die WASM; kein gzip ergibt einen Fehler.
  - Ohne Engine scheitert der Selbsttest mit festem Text, ohne Fremdtext.
  - Nach einem Fehlschlag gibt es einen neuen Versuch; danach nie ein zweites
    Laden.
  - Der Selbsttest besteht.
- Smoke-Test, neuer Teil `mls`:
  - `script-src` hat `'wasm-unsafe-eval'` und kein `'unsafe-eval'`.
  - Beim Start wird kein WebAssembly übersetzt; gezählt werden alle
    WebAssembly-Einstiege.
  - Nach dem Klick auf „Selbsttest“ im gebauten `freedom.html` (ohne Netz):
    „bestanden“, keine CSP-Verletzung, keine Skriptfehler.
- Gegenprobe: dasselbe `freedom.html` ohne `'wasm-unsafe-eval'` →
  `script-src`-Verletzung, „gescheitert: Die MLS-Engine startet in diesem
  Browser nicht.“, Smoke-Test rot.

**Nebenbei:**
- In `MLS-ENTSCHEIDUNG.md` stand „WASM 6,5 MB“. Richtig sind 7,6 MB
  (7.567.621 Byte), gzip 3,0 MB.
- Ein zufällig roter Test aus Spur B (8.9a), klein behoben: In
  `protocol/test/blob-speicher.test.ts` („manipulierte Stücke fallen heraus“)
  ersetzte der Test das erste Byte des Chiffrats durch `ff`. Begann das
  zufällige Chiffrat schon mit `ff`, war das keine Änderung: Das Stück bestand
  die Prüfung, und der Test war rot (etwa 1 von 256 Läufen, so in der CI dieses
  Schritts). Nachgestellt: Bei `ff` am Anfang ergab die alte Manipulation
  `ok: true`. Jetzt wird bei `ff` am Anfang `00` eingesetzt. Die Prüfung
  selbst ist unverändert.

Endstand: protocol 1131 · node 239 · app 359 (+4) · mls 9 · Leak-Tests 49
grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden (mit MLS-Teil).

## Schritt 5.7a – Modellkataloge, Teil a: NIP-51-Liste eines Kurators (mit 8.8)

**Aufteilung:** 5.7 und 8.8 zusammen wären rund 660 geänderte Zeilen. Teil a
bringt das Protokoll, Teil b die App (Abos, Vergleich, Modell-Dropdown,
Website).

**Karte:** „Ein Katalog ist die NIP-51-Liste eines Kurators; Nutzer abonnieren
mehrere; keine feste Vorauswahl durch das Projekt.“ 8.8: „Preise in beiden
Einheiten; zwei Kataloge abonnierbar und vergleichbar.“ Bisher gab es nur den
Katalog der Manifeste (`model-registry.ts`, Gewichte und Seeder), keine
Empfehlungen.

**Format** (`protocol/src/modell-katalog.ts`, Kind 38080, neu in
`docs/PROTOCOL.md`):
- NIP-51-Set, ersetzbar über `d`: `title`, `description`, je Modell
  `["model", <kennung>, <notiz?>]`, Inhalt leer. Ein eigenes Kind, damit
  Kataloge liest, wer Kataloge sucht; das Kind war in keinem Branch belegt.
- Die Modell-Kennung ist die, die Provider in ihren Fähigkeiten nennen
  (Ollama-Namen) oder die im Manifest steht; verglichen wird ohne Rücksicht
  auf Groß- und Kleinschreibung.

**Bauen und lesen:**
- `baueModellKatalog()` wirft bei Unbrauchbarem, statt es still zu
  veröffentlichen: Kennung, Titel 1–80, Beschreibung ≤ 280, Notiz ≤ 140,
  höchstens 200 Modelle, keine doppelten (auch nicht in anderer Schreibweise).
- `leseModellKatalog()` liest fremde streng: ungültige Einträge fallen weg,
  Texte werden gekürzt, Steuer- und Richtungszeichen entfernt; ein leerer
  Katalog ist erlaubt (der Kurator hat ihn geleert). Die Signatur prüft wie
  immer `verifyEvent()` im Pool.
- `neuesteKataloge()`: je Adresse der neueste, bei Gleichstand die kleinere ID
  (NIP-01) – unabhängig von der Reihenfolge.

**Vergleich (8.8):**
- `modellAngebote()`: je Modell, wie viele Provider es anbieten, und der
  günstigste Preis je 1.000 Tokens (msat) aus den Fähigkeiten; ein Provider
  zählt einmal, ein Preis ohne Zahl nicht.
- `vergleicheKataloge()`: je Modell, in welchen Katalogen es steht (mit den
  Notizen), Provider und Preis; dazu „gemeinsam“ und „nur in“. Sortiert nach
  Zahl der Kataloge, dann Providern – nie nach einer Vorliebe des Projekts.
  Die App zeigt den Preis in sats und SOL (Teil b).

**Tests:** protocol +6 (bauen/lesen, Bauen wirft, streng lesen mit Müll,
neuester je Adresse mit Gleichstand, Angebote, zwei Kataloge vergleichen).
Bis Teil b stehen die neuen Funktionen begründet in
`scripts/wiring-ausnahmen.txt`.

Endstand: protocol 1143 (+ 6 übersprungen) · node 238 (+ 7 übersprungen ohne
Netz) · app 363 · mls 9 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring
`--streng` 0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 5.7b – Modellkataloge, Teil b: in der App abonnieren und vergleichen (mit 8.8)

**Oberfläche** (Agent → Modelle → „Modellkataloge“, `shell/tabs/agent-netz.ts`,
Logik in `app/src/modell-kataloge.ts`):
- Voreingestellt ist kein Katalog. Die App holt alle Kataloge
  (`{kinds:[38080], limit:500}`, ohne Filter nach Kurator) und wählt selbst –
  die Relays erfahren nicht, welche abonniert sind.
- „Gefundene Kataloge“ mit „abonnieren“; abonnierte mit „abbestellen“.
  Höchstens 20 Abos, gespeichert als `freedom.kataloge` (Präfix für die
  Notfall-Löschung, in `SICHERUNG_EINTRAEGE` – ein neues Gerät übernimmt sie).
- Vergleich der abonnierten als Tabelle: je Katalog ✓ (Notiz des Kurators als
  Titel), Zahl der Provider, günstigster Preis je 1.000 Tokens in sats und SOL
  (`ausMsat()` mit dem Marktkurs; ohne Kurs „SOL: kein Kurs“), dazu
  „Gemeinsam: n · nur in „…“: m“. Modelle ohne Angebot heißen „kein Angebot“.
- „eigenen Katalog veröffentlichen“: Titel und Modelle (durch „;“ getrennt,
  Notiz dahinter) per Abfrage; gleicher Titel ersetzt den alten (`d` aus dem
  Titel). Als Gerät gesperrt – der Katalog gehört der Person.
- Alles über `textContent` – Kataloge sind Fremddaten; keine neue
  HTML-Zuweisung.

**Modell-Dropdown** (`shell/tabs/agent.ts:88`): statt „nemotron zuerst“
(eine feste Vorliebe des Projekts) stehen Modelle aus abonnierten Katalogen
vorn, dann nach Zahl der Provider; die Karte nennt „in 2 Katalogen“. Ohne Abo
zählt nur die Zahl der Provider.

**Verdrahtet:** Laden beim Start und „aktualisieren“ in `shell/app.ts:837`
und `:844` (danach wird das Dropdown neu geordnet), Veröffentlichen `:839`.
**Fund dabei:** Dieselben Knöpfe wurden auch in `askAi()` nach jeder
KI-Antwort erneut verdrahtet (Rest der Aufteilung aus 1.0) – die Kataloge
hängen nur am Start, nicht dort.

**Nebenbei (8.8):** „Modelle im Netz“ nennt gefährdete Modelle zuerst
(`modelsAtRisk`) – die Liste ist nach Seedern sortiert und schnitt sie sonst ab.
`fitsOnDevice` und `verifyFile` gehören zum Laden von Gewichten beim Provider,
das es noch nicht gibt; ihre Ausnahme ist so begründet. Das Whitepaper nennt die
Kataloge.

**Browser-Prüfung** (drei Konten, Test-Relay, zwei Provider, zwei Kurse):
Kurator A und B veröffentlichen je einen Katalog; C findet beide, abonniert,
sieht „Gemeinsam: 1 · nur in „Zum Programmieren“: 1 · nur in „Klein &
schnell“: 1“ und Preise wie „0,9 sats ≈ 0,000005961 SOL“; im Dropdown rückt
mistral:7b („in 1 Katalog“) vor llama3.2:3b; nach Neuladen sind die Abos da,
„abbestellen“ entfernt einen; die Relays sahen nur `{kinds:[38080], limit:500}`.
Keine Seitenfehler.

**Tests:** app +4 (Abos, Eingabe und Kennung, Rang, Verdrahtung ohne
Vorauswahl und ohne Kurator-Filter).

Endstand: protocol 1143 (+ 6 übersprungen) · node 238 (+ 7 übersprungen ohne
Netz) · app 367 · mls 9 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring
`--streng` 0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 5.6a – Streitfall-Prüfer subjektiv, Teil a: nur der genannte Prüfer, Urteil versiegelt

**Karte:** „Den Prüfer wählt der Nutzer aus seinem Netz; das Urteil gilt nur
zwischen den Beteiligten; keine globale Zulassung.“ Zwei Teile: a Protokoll
und Knoten, b App (Prüfer aus dem eigenen Netz, Prüfauftrag beantworten,
Urteil anzeigen).

**Fund:** Ein Urteil (Kind 38073) konnte bisher niemand abgeben –
`buildResolution()` war unbenutzt. `resolveDispute()` hätte jedes Urteil eines
Nicht-Beteiligten gezählt; einschränken ließ es sich nur über
`eligibleReviewers`, eine globale Zulassung. Die App bot Prüfer aus einer
globalen Rangliste der Provider an.

**Protokoll** (`disputes-relays.ts`, `private-job.ts`):
- Die Reklamation nennt den Prüfer (`["pruefer", pk]`). `buildDispute()`
  prüft ihn (64 Zeichen hex, nie Kunde oder Provider), `parseDispute()` liest
  fremde Tags streng. `buildPrivateDispute()` verlangt, dass jeder genannte
  Prüfer die Reklamation auch bekommt.
- `resolveDispute()` zählt nur Urteile der genannten Prüfer – keiner genannt,
  urteilt niemand; ein Prüfer, eine Stimme (sein jüngstes Urteil). Die Option
  `eligibleReviewers` ist entfernt. „Gar keine Antwort“ braucht weiter keinen
  Prüfer.
- Frage und Antwort nur mit Zustimmung und nur in der Kopie für den Prüfer
  (`materialFuerPruefer`, je höchstens 8.000 Zeichen – NIP-44 fasst 64 KB);
  der Provider sieht, wer prüft, bekommt das Material aber nicht noch einmal.
  Direkt in der Reklamation ist es abgelehnt.
- Das Urteil geht versiegelt nur an den Sitzungsschlüssel des Kunden (wie jede
  KI-Antwort) und den Provider: `buildPrivateUrteil()` (mit der Rechenarbeit
  aus dem Angebot des Providers), `openPrivateUrteil()`.

**Knoten** (`dvm-provider.ts`): nimmt das Urteil über den Kunden-Öffner an
(mit Rechenarbeit) und loggt nur Auftrag, Ergebnis, Betrag und Prüfer, nie die
Begründung. Eine Rückzahlung löst es nicht aus – das entscheidet der
Betreiber.

**App (klein):** `reklamiere()` nennt den gewählten Prüfer schon in der
Reklamation (`tabs/agent.ts`); die Wahl aus dem eigenen Netz kommt in b.

**Tests:** protocol +6 (nur der genannte Prüfer; eine Stimme; Prüfer in der
Reklamation geprüft; Material nur für den Prüfer; Urteil versiegelt und
entscheidend; falsche Eingaben), die alten Mehrheits-Tests nennen ihre Prüfer
jetzt in der Reklamation; der Test „Nur zugelassene Prüfer zählen“ ist durch
„Nur der genannte Prüfer zählt“ ersetzt (die Karte verlangt keine globale
Zulassung); Szenario „ki-reklamation“ prüft auch Material und Urteil. node +1
(Urteil ins Log ohne Begründung, ohne Rechenarbeit verworfen).

Endstand: protocol 1148 (+ 6 übersprungen) · node 239 (+ 7 übersprungen ohne
Netz) · app 367 · mls 9 · Leak-Tests 49 grün + 2 todo · 0 rot · check-wiring
`--streng` 0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 5.6b – Streitfall-Prüfer subjektiv, Teil b: der Kunde wählt aus seinem Netz

**Aufteilung:** Der App-Teil kommt in zwei Stücken: b die Seite des Kunden
(wählen, schicken, Urteil empfangen), c die Seite des Prüfers (Prüfaufträge
beantworten).

**Prüfer aus dem eigenen Netz** (`app/src/streitfall.ts`,
`shell/streitfall-ui.ts`, `tabs/agent.ts:1037`):
- `prueferAusNetz()`: Kontakte (Direktnachrichten) und eigene Provider
  (Allowlist), ohne die Beteiligten und ohne einen selbst, höchstens neun.
- Die globale Rangliste `prueferKandidaten()` ist entfernt. Ohne Netz geht die
  Reklamation nur an den Provider; die App sagt, wer prüfen kann.

**Reklamieren** (`reklamiere()`, `tabs/agent.ts:1060`):
- Die Reklamation nennt den Prüfer.
- Frage und Antwort gehen nur nach Nachfrage mit und nur in der Kopie für den
  Prüfer. Die Frage reicht `handleAnswer()` an die Kosten-Blase weiter, nur im
  Speicher.
- Zustellung (`stelleZu()`): an Kontakte über ihren Posteingang (NIP-17, wie
  Direktnachrichten), an eigene Provider über den Pool (mit deren
  Rechenarbeit).
- Die Reklamation samt Sitzungsschlüssel merkt sich die App nur im Tresor
  (`freedom.reklamationen`, 30 Tage, nie in der Zustandssicherung). So ist
  das Urteil auch nach einem Neustart lesbar; die Sitzungen selbst beginnen
  nach dem Neuladen weiter neu (`KiSitzungen.schluesselHex()` gibt den Schlüssel
  nur dafür heraus).

**Urteil empfangen** (`pruefeUrteile()`, beim Start und alle zwei Minuten,
solange eines offen ist, `shell/app.ts:846`): Umschläge nur an die
Sitzungsschlüssel der offenen Reklamationen, geöffnet mit
`openPrivateUrteil()`; es zählt nur das Urteil des genannten Prüfers
(`resolveDispute()`). Karte „Deine Reklamationen“ (Agent → Aufgaben):
„Anna gibt dir recht – 21 sats zurück. Das gilt nur zwischen dir und dem
Provider; erstatten muss er selbst.“

**Texte:** Datenschutz-Satz „ki-reklamation“ sagt „ein Prüfer aus deinem
Netz“, der Hinweis vor dem Reklamieren (`disputeInfo()`) nennt Kontakt oder
eigenen Provider, „gilt nur zwischen dir und dem Provider“ und „nicht von
selbst“.

**Browser-Prüfung:** Reklamation mit Sitzungsschlüssel im Speicher, zwei
versiegelte Urteile auf dem Test-Relay – eines vom genannten Prüfer
(„erstattet“), eines von einem Fremden („bestätigt“). Die Karte zeigt das des
Prüfers, auch nach Neuladen; die Relays sahen nur `{kinds:[1059], "#p":[<Sitzung>]}`.
Keine Seitenfehler.

**Tests:** app +4 (Prüfer nur aus dem Netz; Reklamationen streng gelesen, 30
Tage; Sitzungsschlüssel öffnet das Urteil nach Neustart, ein Fremder zählt
nicht; Verdrahtung) und +1 Leak-Szenario (Material für den Prüfer: Relays
sehen nichts, der Provider bekommt es nicht). Die Verdrahtungs-Prüfung in
`leak/reklamation.test.ts` prüft jetzt den neuen Weg (genannter Prüfer,
Material, Zustellung).

Endstand: protocol 1148 (+ 6 übersprungen) · node 239 (+ 7 übersprungen ohne
Netz) · app 371 · mls 9 · Leak-Tests 50 grün + 2 todo · 0 rot · check-wiring
`--streng` 0 offen · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 5.6c – Streitfall-Prüfer subjektiv, Teil c: der Prüfer urteilt

**Prüfaufträge** (`shell/pruefauftraege-ui.ts`, Logik in `app/src/streitfall.ts`):
- Der Posteingang reicht Umschläge, die keine Direktnachricht sind, an
  `alsPruefauftrag()` weiter – nach Trinkgeld, Adress-Anfrage und Nachfolge,
  aus dem schon geöffneten Abgleich (`tabs/kommunikation.ts`), also ohne
  zweiten Posteingang. Es zählt nur eine Reklamation, die mich als Prüfer
  nennt (`pruefauftragAus()`).
- Karte „Prüfaufträge“ (Agent → Aufgaben): Grund, Betrag, Provider, Notiz und –
  wenn der Kunde zugestimmt hat – Frage und Antwort zum Aufklappen. Der Kunde
  bleibt anonym (Sitzungsschlüssel).
- Vier Urteile: Kunde hat recht, Provider hat recht, teilen, kann ich nicht
  beurteilen – mit kurzer Begründung. Die Erstattung rechnet
  `erstattungFuer()` wie `resolveDispute()`. Das Urteil geht versiegelt an den
  Sitzungsschlüssel des Kunden und an den Provider (mit der Rechenarbeit aus
  dessen Angebot) – sonst an niemanden.
- Der Inhalt bleibt nur im Speicher (Klartext aus einem fremden Auftrag);
  nach dem Neuladen holt ihn der Posteingang wieder. Gemerkt werden nur die
  IDs beantworteter Aufträge (`freedom.pruefungen.erledigt`).
- Als Gerät gesperrt: Der Auftrag nennt die Person, nicht das Gerät.

**Texte:** Der Datenschutz-Satz „ki-reklamation“ nennt jetzt auch das
versiegelte Urteil („sein Urteil geht ebenso versiegelt nur an dich und den
Provider“); das Szenario prüft es seit 5.6a.

**Browser-Prüfung** (zwei Browser, Test-Relay): Eine versiegelte Reklamation
nennt B als Prüfer, mit Frage und Antwort. B sieht den Prüfauftrag („Antwort
unbrauchbar · 21 sats“, Notiz, Frage und Antwort) und urteilt „Kunde hat
recht“. Auf dem Relay landen Umschläge nur an den Sitzungsschlüssel und den
Provider, ohne Klartext; lokal liegt nichts vom Inhalt; nach dem Neuladen ist
der Auftrag erledigt. A (mit der gemerkten Reklamation) sieht „Bernd gibt dir
recht – 21 sats zurück“. Keine Seitenfehler.

**Fund:** Die CI von #96 war rot: `check-wiring.py --streng` meldet eine
veraltete Ausnahme (`resolveDispute`, seit 5.6b verdrahtet) und endet mit 1,
obwohl die Zusammenfassung „0 offen“ sagt – lokal war nur die letzte Zeile
gelesen worden. Behoben in #96, Fallstrick in CLAUDE.md. Hier ebenso:
`buildResolution` ist verdrahtet, seine Ausnahme entfernt; die übrigen drei
betreffen nur noch die Relay-Rolle (8.4).

**Tests:** app +3 (Prüfauftrag nur, wenn er mich nennt; Erstattung und
erledigte IDs; Verdrahtung – Inhalt nur im Speicher, Urteil an Sitzung und
Provider). Die Verdrahtungs-Prüfung des Trinkgeld-Belegs (4.7b) kennt die
längere Kette im Posteingang.

Endstand: protocol 1148 (+ 6 übersprungen) · node 239 (+ 7 übersprungen ohne
Netz) · app 374 · mls 9 · Leak-Tests 50 grün + 2 todo · 0 rot · check-wiring
`--streng` 0 offen, Exit 0 · innerHTML streng 0 unbewertet · Smoke-Test bestanden.

## Schritt 2.2b-c1 – MLS-Konto: Zustand verschlüsselt, KeyPackages, Routing

**Aufteilung:** 2.2b-c war für einen Schritt zu groß (über 400 Zeilen). Deshalb
zwei Teile (`phase-2.md`):
- c1: das Konto (dieser Schritt).
- c2: Einladungen und Gruppennachrichten über Nostr.

Wie 2.2b-a ist c1 ein Baustein: getestet, aber noch nicht in der Oberfläche.
Verdrahtet wird er mit c2 und d (1:1 in der Oberfläche).

**Zustand verschlüsselt** (`packages/app/src/mls-speicher.ts`, neu):
- Der MLS-Zustand ist MDKs SQLite-Datenbank, Megabytes groß. Er liegt in einer
  eigenen IndexedDB `freedom-mls`, verschlüsselt mit AES-256-GCM (neuer IV je
  Sicherung, AAD mit Version).
- Nicht im Tresor-Blob selbst: Der wird bei jeder Änderung ganz neu
  verschlüsselt.
- Der Schlüssel (`freedom.mls.schluessel`) liegt in `geheim`:
  - mit Tresor im Tresor (steht in `GEHEIM_FEST`);
  - ohne Tresor wie die übrigen Geheimnisse in localStorage.
- Ein gesperrter Tresor legt keinen neuen Schlüssel an und weicht nicht auf
  localStorage aus.
- Ist der Zustand beschädigt oder mit anderem Schlüssel verschlüsselt, gibt es
  einen Fehler, keinen stillen Neuanfang.
- Gleichzeitige Sicherungen laufen nacheinander; der zuletzt übergebene Stand
  gewinnt.
- `freedom-mls` steht in `WIPE_DATENBANKEN` (Notfall-Löschung, Code der
  Spur B, eine Zeile). Die Sicherung schließt `freedom.mls…` schon aus
  (`SICHERUNG_NIE`).

**KeyPackages nach Marmot** (`packages/app/src/mls-keypackage.ts`, neu):
- Platz (d-Tag): einmal 32 Zufallsbytes, bleibt für dieses Gerät; nie aus
  Schlüsseln abgeleitet.
- Form (`kpGueltig`):
  - Kind 30443 vom angegebenen Autor, gültig signiert;
  - `d` und `i` je genau einmal, 64 Hex;
  - Version `1.0`;
  - jede Id-Liste genau ein Tag, nicht leer, ohne Doppelte, Form `0x` plus
    vier Hex-Ziffern klein;
  - Ciphersuite `0x0001`, Komponente `0x8009` (Kontobeweis);
  - Inhalt Base64.
- Auswahl (`waehleKeyPackages`): je Platz das neueste, bei gleicher Zeit die
  kleinere Id. Dann das neueste zuerst, bei Gleichstand das kleinere `i`.
- Erneuern: wenn keins veröffentlicht ist, nach 30 Tagen (erlaubt sind höchstens
  84), nach Verbrauch durch eine Einladung (`kpVerbraucht`) oder bei einem
  Zeitstempel aus der Zukunft.
- Veröffentlichen (`veroeffentlicheKeyPackage`): erst den Zustand sichern, dann
  senden. Nimmt kein Relay an, gibt es einen Fehler, und nichts wird gemerkt.
- Suchen (`sucheKeyPackages`): die NIP-65-Liste des Kontakts lesen, dann an
  deren Schreib-Relays Kind 30443 abfragen.

**Routing aus der Engine:**
- Ein dritter kleiner Patch an MDK (`mdk.patch`, +10 Zeilen): Der neue
  `Engine::nostr_routing()` macht das Routing einer lebenden Gruppe lesbar,
  also die Gruppen-Id des `h`-Tags und ihre Relays. MDK führt es sonst nur
  intern.
- Crate `routing()`, TypeScript `Mls.routing()`. Die WASM ist neu gebaut; ein
  Nachbau in einem zweiten Verzeichnis ist bitgleich.

**Nebenbei:** Der Test `schluessel-status.test.ts` (Spur B, 8.6a) prüft
wörtlich `"freedom.mandate"]`, also dass der Eintrag in `GEHEIM_FEST` der
letzte ist. Der neue Eintrag steht deshalb davor; der Test ist unverändert.

**Tests:**
- `app/test/mls-speicher.test.ts`, 6 neu:
  - Schlüssel einmal erzeugt;
  - mit Tresor im Tresor, gesperrt kein neuer;
  - verschlüsselt und ohne Klartext;
  - verändert oder fremd ergibt einen Fehler;
  - der letzte Stand gewinnt;
  - echter Engine-Zustand nach Laden weiter Mitglied.
- `app/test/mls-keypackage.test.ts`, 7 neu:
  - Platz;
  - Form des Engine-KeyPackages;
  - zehn abgelehnte Formen;
  - Auswahl;
  - Erneuern;
  - Veröffentlichen (Reihenfolge, Fehlschlag);
  - Ende zu Ende über das Aufzeichnungs-Relay: Bob sichert verschlüsselt und
    veröffentlicht; Alice findet das KeyPackage nur an Bobs Schreib-Relays und
    lädt ein; Bob tritt nach dem Neuladen aus dem gesicherten Zustand bei und
    liest mit.
- `mls/test/mls.test.ts`, 1 neu: Routing – `h` der Nachrichten, Relays, bei
  allen Mitgliedern gleich, unbekannte Gruppe abgewiesen.

Endstand (nach dem Einmergen von 5.7b und 5.6a–c): protocol 1148 · node 240 ·
app 387 (+13) · mls 10 (+1) · Leak-Tests 50 grün + 2 todo · 0 rot · check-wiring `--streng` 0 offen · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden (mit MLS-Teil) ·
Nachbau bitgleich.

## Schritt 2.2b-c2 – MLS über Nostr: Einladungen, Gruppennachrichten, Leak-Regel

**Ergebnis:** Der zweite Teil von 2.2b-c. `packages/app/src/mls-nostr.ts`
(neu) bringt MLS-Gruppen über Nostr zum Laufen, nach dem Nostr-Transport von
Marmot. Wie c1 ist das ein Baustein; in die Oberfläche kommt er mit d.

**Senden:**
- `gruendeGruppe()`: Gruppe anlegen, Zustand sichern, Einladungen zustellen.
  Jede Einladung (Kind 1059) geht nur an den Posteingang (Kind 10050) ihres
  Empfängers. Ohne Posteingang wird sie als „nicht zugestellt“ gemeldet, statt
  sie irgendwohin zu senden.
- `sendeInGruppe()`: Nachricht (Kind 445) nur an die Relays der Gruppe
  (`mls.routing()`). Vorher wird gesichert.
- `aendereGruppe()` (einladen oder entfernen):
  - Das Routing wird vor dem Commit festgehalten; der Commit geht an die
    Relays der alten Epoche.
  - Erst wenn ein Relay ihn annimmt, wird er bestätigt, und erst dann gehen
    Einladungen hinaus.
  - Nimmt kein Relay an, ist er gescheitert: niemand wird eingeladen, die
    Epoche bleibt.
- `schreiteFort()`: Nach einem Commit hält die Engine Nachrichten bis zur
  Wartezeit zurück. `schreiteFort()` stellt sie danach zu. Was die Engine
  dabei selbst sendet, geht an die Gruppen-Relays.

**Empfangen:**
- `gruppenAbos()`: je Gruppe Kind 445 mit `#h` an ihren Relays.
- `empfangeGruppe()`: meldet die `wartezeit` je Gruppe und sichert nach jeder
  Änderung.
- `oeffneEinladung()`: nur ein Umschlag an mich mit Kind 444 darin, genau
  einem `e`- und einem `relays`-Tag. Der Absender kommt aus dem Siegel.
  NIP-17-Nachrichten und fremde Umschläge ergeben `null`.
- `nimmEinladungAn()`: beitreten, das eigene KeyPackage gilt als verbraucht
  (wird neu veröffentlicht), sichern.

**Leak-Regel `mls-gruppe`** (`protocol/src/leak-rules.ts`, in `LEAK_REGELN`),
für Kind 445:
- genau ein `h` mit 64 Hex, das nicht die MLS-Gruppen-Id ist;
- sonst höchstens `expiration`;
- nie eine Identität als Autor, kein Schlüssel zweimal, keine Identität im
  Inhalt.

Szenario `app/test/leak/mls.test.ts`: KeyPackages, Gründen, zwei Nachrichten,
Einladen, Entfernen, eine Nachricht. Über alles, was irgendein Relay bekam:
- kein Klartext und kein Gruppenname, kein Kind 4;
- `mls-gruppe` eingehalten;
- 445 nur an die Gruppen-Relays;
- Umschläge nicht von einer Identität, `p` nur an Eingeladene, nur an deren
  Posteingang;
- offen sind nur Kinds 445, 1059 und 30443. Das KeyPackage trägt die
  Identität mit Absicht, sonst fände es niemand (Marmot).

Gegenprobe: Das später eingeladene Mitglied liest die letzte Nachricht. Die
Aufzeichnung ist also echt und kein leerer Datenstrom.

**Zufällig rote Tests vermieden:** `MemoryRelay.query()` sortiert nach
Sekunden, neueste zuerst. Commit und Nachricht in verschiedenen Sekunden
tauschten sonst die Reihenfolge. Die Tests nehmen die Reihenfolge deshalb aus
dem Senden und prüfen das Abo getrennt (Fallstrick in `CLAUDE.md`).

**Nebenbei:** `yarn.lock` nennt jetzt `@freedomstack/mls` als Abhängigkeit der
App (seit 2.2b-b in `package.json`, in `yarn.lock` fehlte sie).

**Tests:**
- `app/test/mls-nostr.test.ts`, 6 neu: Gründen, Einladung erkennen und
  annehmen, Nachricht, Einladen, Einladen scheitert, Entfernen samt
  nachgereichter Nachricht.
- `app/test/leak/mls.test.ts`, 4 neu.
- `protocol/test/leak-rules.test.ts`: 1 neu, dazu `mls-gruppe` in der
  Namensprüfung.

Endstand: protocol 1149 (+1) · node 240 · app 393 (+6) · mls 10 · Leak-Tests
54 grün (+4) + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML
streng 0 unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 2.2b-d1 – MLS in der App: Konto und Empfang

**Aufteilung:** 2.2b-d (1:1 als MLS-Gruppe) ist geteilt (`phase-2.md`):
- d1: Konto und Empfang (dieser Schritt).
- d2: Senden – 1:1 standardmäßig über MLS, NIP-17 als Rückfall.

In d1 wird noch per NIP-17 gesendet. Empfangen kann die App MLS schon, zum
Beispiel von White Noise.

**Konto** (`packages/app/src/shell/mls-konto.ts`, neu):
- `mlsKonto()` lädt Engine, Zustand und Verlauf dieses Geräts.
- Beide sind verschlüsselt und an die Identität gebunden: Die Identität steht
  in den Zusatzdaten von AES-GCM (`MlsZustand(…, bindung)`).
- Der Import einer anderen Identität läuft ohne Neuladen. Ihr Stand wird nie
  unter der neuen Identität geladen, sondern verworfen – samt KeyPackage-Platz
  und KeyPackage. Derselbe d-Tag unter zwei Identitäten verbände beide.
- Den Kontobeweis signiert das Konto über `mitRohemSchluessel("MLS-Kontobeweis")`.
  Die Kopie des Schlüssels wird danach genullt.
- Gesperrt (`mlsGesperrt()`):
  - mit Bunker (NIP-46), weil der Beweis synchron signiert werden muss;
  - als Gerät (8.6c), bis 2.2b-e.
- Speicher und Netz werden hineingereicht (`MlsUmgebung`). In der App sind das
  IndexedDB, `frageAn()` und `veroeffentlicheAn()`/`posteingangVon()`, in den
  Tests RAM und Aufzeichnungs-Relays.

**Wann die Engine lädt** – nie beim Start (der Smoke-Test zählt weiter 0
übersetzte WebAssembly-Module), sondern nur in diesen Fällen:
- `mlsErreichbar()` beim Öffnen einer 1:1-Unterhaltung, wenn das KeyPackage
  fehlt oder fällig ist. Veröffentlicht wird an die eigenen Relays (5.4a).
- Bei einer Einladung eines Kontakts.
- Im Abgleich, wenn eine Unterhaltung eine MLS-Gruppe hat.

**Empfang** (`tabs/kommunikation.ts`):
- Umschläge, die keine DM sind, prüft `syncDmInbox()` einmal je Sitzung auf
  eine MLS-Einladung (`alsMlsEinladung`).
  - Angenommen wird nur von einem Kontakt.
  - Ist die Gruppe eine 1:1-Gruppe mit ihm, gehört sie zu dessen Unterhaltung
    (`mls`, eine neuere ersetzt die alte). Gruppen zu mehreren zeigt erst 2.3.
  - Jede Einladung wird nur einmal bearbeitet (`freedom.mls.einladungen`).
    Sonst lüde jeder Start die Engine erneut.
- `mlsAbgleichen()` holt Kind 445 an den Relays der Gruppe (`frageAn()`, neu in
  `state.ts`, kurze eigene Verbindungen).
  - Neue Nachrichten gehen zuerst in den Verlauf (`merken`, neu in
    `empfangeGruppe`/`schreiteFort`), der Zustand wird einmal am Ende gesichert.
  - Warum diese Reihenfolge: Eine MLS-Nachricht lässt sich nur einmal
    entschlüsseln. Geht dazwischen etwas verloren, stellt die Engine sie erneut
    zu, und der Verlauf nimmt jede Id nur einmal.
  - Nach der Wartezeit stellt `schreiteFort()` zurückgehaltene Nachrichten zu
    und zeichnet die offene Unterhaltung neu.
- Im Chat stehen Nachrichten aus dem Verlauf mit „· MLS“, nur die zwischen
  beiden.

**Verlauf** (`MlsVerlauf`, eigene IndexedDB `freedom-mls-verlauf`, in
`WIPE_DATENBANKEN`): je Gruppe höchstens 1000 Nachrichten, je Id einmal, nach
Zeit sortiert. Ein beschädigter Verlauf ergibt einen Fehler.

**Nebenbei:**
- `posteingangVon()` liegt jetzt in `state.ts` und wird von DM und MLS
  gemeinsam genutzt. Es nimmt nur noch Listen des gefragten Autors.
- Die Kette in `oeffneUmschlag()` prüfen zwei Tests wörtlich (5.6c, 4.7b).
  Die MLS-Prüfung hängt deshalb daneben im Abgleich, nicht in der Kette
  (Fallstrick in `CLAUDE.md`).

**Tests:**
- `app/test/mls-konto.test.ts`, 5 neu:
  - gesperrt mit Bunker und als Gerät;
  - KeyPackage nur mit eigenen Relays, nur an diese, danach nicht fällig;
  - Einladung eines Kontakts: 1:1 angenommen, nicht zweimal, zwei Nachrichten
    abgeholt, beim zweiten Abgleich nichts doppelt, beides verschlüsselt
    abgelegt;
  - Gruppe zu dritt: keine Unterhaltung;
  - andere Identität verwirft Stand, Platz und KeyPackage.
- `mls-speicher.test.ts` +2: Bindung, Verlauf.
- `mls-nostr.test.ts` +1: erst merken, dann sichern.
- `mls-verdrahtung.test.ts`, 3 neu:
  - KeyPackage nur beim Öffnen einer 1:1-Unterhaltung;
  - Einladungen nur aus Nicht-DMs und nur von Kontakten;
  - gesperrt mit Bunker und als Gerät, roher Schlüssel nur für den Kontobeweis.

Endstand: protocol 1149 · node 240 · app 404 (+11) · mls 10 · Leak-Tests 54
grün + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden (beim Start 0
WebAssembly übersetzt).

## Schritt 2.2b-d2 – 1:1 über MLS, NIP-17 als Rückfall

**Ergebnis:** 1:1-Nachrichten gehen jetzt standardmäßig über MLS, wenn der
Kontakt es kann. Sonst gehen sie per NIP-17 wie bisher. Damit ist 2.2b-d fertig;
offen bleibt 2.2b-e (mehrere Geräte als eigene Mitglieder).

**Senden** (`sendChatMessage()` → `sendeUeberMls()` → `mlsSendeAn()` in
`shell/mls-konto.ts`):
- Hat die Unterhaltung eine Gruppe, geht die Nachricht dorthin.
- Sonst sucht die App das KeyPackage des Kontakts an dessen NIP-65-Relays und
  gründet eine Gruppe. Die Einladung geht an seinen Posteingang, die Gruppe
  liest an den eigenen Relays.
- Die Nachricht geht an die Relays der Gruppe. Die eigene kommt beim Senden in
  den Verlauf, weil MLS eigene Nachrichten nicht zurück entschlüsselt.
- Rückfall auf NIP-17:
  - der Kontakt hat kein KeyPackage;
  - keine eigenen Relays;
  - die Einladung ist nicht zustellbar;
  - kein Relay nimmt an;
  - die Unterhaltung hat einen Ablauf (2.5; den trägt MLS hier nicht);
  - mit Bunker oder als Gerät.
- Anhänge reisen wie bei NIP-17 im verschlüsselten Inhalt.

**Einladungen von Fremden:** Sie werden jetzt wie deren NIP-17-Nachrichten zur
„Anfrage“. In d1 wurden sie übergangen; mit d2 ginge sonst die erste Nachricht
eines neuen Kontakts verloren.

**Ehrliche Texte:**
- Die Unterhaltung sagt, wie sie verschlüsselt ist (`dmHinweis()`):
  - über MLS mit Vorwärtsgeheimnis;
  - per NIP-17, und dass die nächste Nachricht über MLS geht, sobald der
    Kontakt es kann;
  - mit Ablauf bleibt es bei NIP-17;
  - mit Bunker oder als Gerät geht MLS nicht.
- Die MLS-Karte in den Settings sagt dasselbe.

**Datenschutzbericht** (`protocol/src/privacy-facts.ts`):
- Neu belegt: „dm-mls“. Direktnachrichten an Kontakte, die MLS können, laufen
  über MLS; Relays sehen eine zufällige Gruppen-Id und je Nachricht einen neuen
  Schlüssel.
  - Das Szenario in `privacy-facts.test.ts` nutzt die echte Engine.
  - Sie wird dynamisch geladen, weil `packages/mls` außerhalb von `rootDir`
    liegt.
  - Dafür ist `@freedomstack/mls` jetzt devDependency des Protokoll-Pakets
    (Workspace, nichts Neues geladen).
- „dm-forward-secrecy“ ist jetzt eine Grenze statt offen: Forward Secrecy nur
  über MLS, im Rückfall per NIP-17 nicht, mit Grund.
- Die Grenze steht in der Liste hinter der SOL-Grenze. Der Berichtstest prüft
  wörtlich deren Stelle; er prüft jetzt auch die beiden neuen Sätze.

**Tests:**
- `mls-konto.test.ts` +1: ohne KeyPackage null. Mit KeyPackage:
  - die Gruppe wird gegründet, die Einladung geht an den Posteingang;
  - genau eine Nachricht geht an die Gruppen-Relays;
  - die eigene steht im Verlauf, die Gruppe wird wiederverwendet;
  - der Kontakt liest beide.
- `mls-verdrahtung.test.ts` +2:
  - Senden erst über MLS, der NIP-17-Pfad bleibt Rückfall;
  - mit Ablauf, Bunker oder als Gerät nie MLS;
  - ehrlicher Hinweis;
  - Einladung von Fremden wird zur Anfrage.
- `privacy-facts.test.ts`: Szenario „dm-mls“ und zwei neue Prüfungen des
  Berichtstexts.

Endstand: protocol 1149 · node 240 · app 407 (+3) · mls 10 · Leak-Tests 54
grün + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden (beim Start 0
WebAssembly übersetzt).

## Schritt 5.10a – Abdeckungskarte: Wegwerfschlüssel je Eintrag, Ablauf, Austragen

**Aufteilung:** 5.10 hat zwei unabhängige Teile – a die Abdeckungskarte, b
Zeitanker (OpenTimestamps) für geld- und namensrelevante Events.

**Fund:** Ein Eintrag in die Abdeckungskarte war mit der Identität signiert
(`signiere(buildCoverageAnnouncement({ pubkey: state.keypair.pk, … }))`). Die
k-Schwelle schützte nur die Anzeige in der App – wer die Relays las, sah
„diese Person hat Funk in dieser Zelle“. Die Einwilligung versprach „kein
Verlauf“ und „jederzeit widerrufbar“; beides war nicht umgesetzt.

**Protokoll** (`coverage.ts`):
- `baueCoverageEintrag()`: je Eintrag ein neuer Wegwerfschlüssel, Ablauf nach
  NIP-40 in 7 Tagen (`COVERAGE_GUELTIG_SECS`) – ein neuer Eintrag ist mit dem
  alten nicht verknüpft.
- `baueCoverageWiderruf()`: Löschwunsch nach NIP-09, vom Wegwerfschlüssel
  des Eintrags.
- `buildCoverage()` blendet Abgelaufenes aus, auch wenn ein Relay es noch hält.
- `coverageConsentText()` sagt für jede Ebene: Wegwerfschlüssel, 7 Tage, und
  „Auf den Relays ist jeder Eintrag einzeln sichtbar. Die Schwelle von 3
  Knoten gilt nur für die Anzeige in der App“.

**App** (`tabs/earn.ts`, `tabs/settings.ts`, Karte „Abdeckung“):
- „selbst eintragen“: erst die Einwilligung, dann ein früherer Eintrag
  widerrufen, dann der neue mit Wegwerfschlüssel; den Schlüssel (für den
  Widerruf) nur im Tresor (`freedom.coverage.eintrag`, nie in der
  Zustandssicherung).
- Neu: „austragen“ – Widerruf vom Wegwerfschlüssel, danach ist er vergessen.
- Der Kartentext nennt Wegwerfschlüssel, Ablauf und die Sichtbarkeit auf den
  Relays.

**Datenschutz:** neue Aussage „abdeckung-schluessel“ (belegt, Regel
„autor-verborgen“) mit Szenario: Einträge und Widerruf nie von der
Identität, verschiedene Schlüssel je Eintrag, jeder mit Ablauf.

**Browser-Prüfung** (Standort gesetzt, Test-Relay): Die Einwilligung nennt
die Sichtbarkeit auf den Relays; der Eintrag trägt einen Wegwerfschlüssel,
nicht die Identität, mit Ablauf und gerundeter Zelle (`48.00,11.50`); der
Tresor-Eintrag passt zur ID; „austragen“ sendet Kind 5 vom selben Schlüssel
und vergisst ihn. Keine Seitenfehler.

**Tests:** protocol +3 (Wegwerfschlüssel und Ablauf, Widerruf, Einwilligung)
und Szenario „abdeckung-schluessel“; app +1 (Verdrahtung). Das Leak-Szenario
„Abdeckung eintragen“ (1.5) prüft jetzt den neuen Weg und zusätzlich, dass
die Identität nicht Autor ist – seine Verdrahtungs-Prüfung verlangte wörtlich
den Aufruf mit der Identität, den dieser Schritt abschafft.

Endstand (nach dem Einmergen von 2.2b-e2): protocol 1152 (+ 6 übersprungen) ·
node 239 (+ 7 übersprungen ohne Netz) · app 419 · mls 11 · Leak-Tests 54 grün
+ 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 2.2b-d3 – Mit Geräten bleibt es bei NIP-17; Entscheidung 2.2b-e vorgelegt

**Lücke aus 2.2b-d2, behoben:**
- Wer Geräte nutzt (8.6), bekam bisher jede Nachricht auch auf jedem Gerät: Die
  App versiegelt je Gerät eine eigene NIP-17-Kopie (8.6b).
- In einer MLS-Gruppe sind Geräte (bis 2.2b-e) nicht. Seit d2 hätte ein Gerät
  deshalb MLS-Nachrichten nicht bekommen, weder vom Kontakt noch die eigenen.
- Jetzt prüft `sendeUeberMls()` vor jedem MLS-Versuch die Geräte beider Seiten
  (`geraeteBuch.kopienFuer()`). Hat eine Seite Geräte oder ist das nicht zu
  klären (offline), geht die Nachricht per NIP-17 an alle Geräte.
- Die Hinweise in der Unterhaltung und die Grenze „Forward Secrecy“ im
  Datenschutzbericht nennen Geräte jetzt mit.

**Entscheidung 2.2b-e (MENSCH)**, Vorlage in `phase-2.md`:
- Marmot bindet ein Blatt über den Kontobeweis (Kind 450) und das KeyPackage
  (Kind 30443) an ein Konto. Beides signiert der Kontoschlüssel, den ein Gerät
  nicht hat.
- Marmots Mehrgeräte-Verfahren ist noch ein Entwurf.
- Die Möglichkeiten:
  - **A:** Geräte als eigene Mitglieder unter ihrem Geräteschlüssel, zugeordnet
    über die Vollmacht wie 8.6b (Empfehlung).
  - **B:** Geräte als weitere Blätter der Person; das Hauptgerät signiert für
    sie.
  - **C:** vorerst nicht; mit Geräten bleibt es bei NIP-17 (heutiger Stand).

**Tests:** `mls-verdrahtung.test.ts` +1. Geräte werden vor jedem MLS-Versuch
geprüft; ein Fehler beim Prüfen zählt wie Geräte.

Endstand: protocol 1149 · node 240 · app 408 (+1) · mls 10 · Leak-Tests 54
grün + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 2.2b-e1 – MLS nur mit Tresor, beide Seiten Admin, Geräte mit eigenem Konto

**Entscheidungen vom 26.09.2026 (MENSCH):**
- 2.2b-e: **A** – Geräte werden eigene Mitglieder unter ihrem Geräteschlüssel.
- MLS verlangt einen Tresor.

Geteilt in e1 (hier) und e2 (Gruppen mit Geräten, danach entfällt d3).

**MLS nur mit Tresor** (`shell/mls-konto.ts`):
- `mlsGesperrt()` meldet ohne Tresor „nur mit Tresor – richte ihn in den
  Settings unter Sicherheit ein“. Ohne Tresor gibt es weder Engine noch
  KeyPackage, Einladungen bleiben liegen, gesendet wird per NIP-17.
- Der Hinweis in der Unterhaltung nennt den Grund. Hat die Unterhaltung schon
  eine MLS-Gruppe (seit d2 ohne Tresor möglich), sagt er dazu: Was der Kontakt
  darüber schickt, liest die App erst, wenn MLS wieder geht – solange die
  Relays es halten. Beim Einrichten wandert der Schlüssel des Zustands in den
  Tresor (`GEHEIM_FEST` seit c1), der Zustand bleibt.
- Die Umgebung (`MlsUmgebung`) bekommt `geheim`, damit Tests mit einem echten
  Tresor laufen.

**Beide Seiten Admin:**
- In MDK dürfen nur Admins einladen und entfernen. Ohne Angabe ist nur der
  Gründer Admin – dann könnte der Kontakt nie seine Geräte aufnehmen oder
  entzogene entfernen.
- Crate: `gruppeAnlegen(…, admins)` und `einladen(…, admins)` reichen
  `initial_admins` an MDK durch (MDK prüft: nur Mitglieder). Neu ist
  `admins(gruppe)`. Mitglieds-Ids werden streng geprüft (32 Byte), auch beim
  Entfernen. `dist/` neu gebaut (`bauen.sh`).
- `gruendeGruppe`/`aendereGruppe` (`mls-nostr.ts`) nehmen `admins` optional;
  ohne Angabe wie bisher nur der Gründer. Räume (2.3, Spur B) entscheiden
  selbst.
- `mlsSendeAn()` gründet 1:1-Gruppen mit dem Kontakt als Admin.

**Als Gerät ein eigenes Konto:**
- `mlsGesperrt()` sperrt Geräte nicht mehr. Das Konto ist der
  Geräteschlüssel (der Kontobeweis signiert mit ihm).
- Geräte haben keine eigene Relay-Liste. KeyPackage (und später eigene
  Gruppen) gehen an die Schreib-Relays der Person aus deren NIP-65-Liste
  (`schreibRelaysVon()`, aus `sucheKeyPackages()` herausgezogen). Ohne diese
  Liste: kein KeyPackage.
- Bis e2 schreibt ein Gerät weiter per NIP-17 (d3: die Person hat Geräte).

**Nebenbei behoben:** Nach einem Wechsel der Identität ohne Neuladen galt das
gemerkte KeyPackage der alten Identität noch als frisch – die neue hätte bis zu
30 Tage keins veröffentlicht. `mlsErreichbar()` vergleicht jetzt die Identität.

**Texte:** Settings-Karte (nur mit Tresor, mit Geräten NIP-17), Hinweis in der
Unterhaltung, Grenze „Forward Secrecy“ im Datenschutzbericht (ohne Tresor statt
„als Gerät“).

**Tests:**
- mls +1: Admins – ohne Angabe nur der Gründer (ein Mitglied kann dann nicht
  einladen); als Admin gegründet lädt ein Mitglied sein Gerät ein und entfernt
  es; Admin muss Mitglied sein; ungültige Id → Fehler.
- `mls-konto.test.ts`: ohne Tresor gesperrt (kein Konto, kein KeyPackage, kein
  Senden), mit Bunker gesperrt, als Gerät nicht; neu: als Gerät KeyPackage nur
  an die Schreib-Relays der Person, ohne deren Liste keins, fällig trotz
  KeyPackage der vorigen Identität.
- `mls-verdrahtung.test.ts`: Tresor-Sperre statt Geräte-Sperre; neu: 1:1-Gruppen
  mit dem Kontakt als Admin.

Endstand: protocol 1149 · node 240 · app 410 (+2) · mls 11 (+1) · Leak-Tests
54 grün + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden (MLS-Selbsttest mit der
neu gebauten Engine).

## Schritt 2.2b-e2 – Gruppen mit Geräten; d3 entfällt

Zweiter Teil der Entscheidung 2.2b-e (A): Geräte sind eigene Mitglieder der
1:1-Gruppe. Damit ist 2.2b im Code fertig.

**Wer Mitglied ist** (`packages/app/src/mls-geraete.ts`, neu, ohne DOM):
- `sollMitglieder()`: beide Personen und ihre Geräte mit gültiger Vollmacht
  („nachrichten“, nicht entzogen – `geraeteBuch.kopienFuer()` wie NIP-17 seit
  8.6b), je Mitglied die Person.
- `abgleich()`: wer fehlt, wer nicht hineingehört (entzogen oder fremd).
- `partnerDerGruppe()`: Eine Gruppe ist 1:1, wenn alle übrigen Mitglieder
  einer Person gehören – nach deren eigenen Vollmachten. Der Einladende zählt
  nicht; ein Fremder kann sich nicht als Gerät eines Kontakts ausgeben.

**Senden** (`mlsSendeAn()`, `shell/mls-konto.ts`):
- Gründen mit allen Soll-Mitgliedern, alle Admin. Für jedes Mitglied braucht
  es ein KeyPackage (Geräte: an den Schreib-Relays ihrer Person,
  `sucheKeyPackages({ listeVon })`) und einen Posteingang. Fehlt eins: NIP-17.
- Einladungen an Geräte gehen an den Posteingang ihrer Person – Geräte lesen
  dort mit (8.6b).
- Vor jedem Senden in eine bestehende Gruppe `gleicheAb()`: entzogene und
  fremde Mitglieder entfernen, fehlende einladen (als Admin). Geht das nicht
  (Gerät ohne KeyPackage, nicht Admin, kein Relay nimmt an), geht die
  Nachricht per NIP-17 an jedes Gerät; die Gruppe bleibt der Unterhaltung.
- Mitglied ist nur, wer seine Einladung bekam: Nicht zugestellte werden gleich
  wieder entfernt und beim nächsten Senden neu eingeladen.
- Als Gerät ohne gültige Vollmacht nie über MLS (und per NIP-17 sperrt der
  Chat wie seit 8.6c).
- Ergebnis jetzt `{ gruppe?, gesendet }` – der Chat merkt sich die Gruppe auch,
  wenn diese Nachricht per NIP-17 ging.

**Empfangen:**
- `mlsEinladungAnnehmen()` gibt Gruppe und Partner zurück; der Chat legt die
  Gruppe in die Unterhaltung mit dem Partner (nicht mit dem Einladenden – das
  kann ein Gerät sein).
- MLS-Nachrichten im Chat laufen durch `ordneDmZu()` wie NIP-17-Kopien:
  eigene Geräte als „du“, Geräte des Kontakts unter seinem Namen mit
  Gerätehinweis, nach einem Entzug mit Warnung.

**d3 entfällt:** `sendeUeberMls()` prüft Geräte nicht mehr pauschal – die
Gruppe enthält sie.

**Texte:** Hinweis in der Unterhaltung, Settings-Karte, Grenze
„Forward Secrecy“ (per NIP-17 nur noch, wenn ein Gerät nicht in die Gruppe
kommt).

**Grenze:** Gruppen, die eine andere Marmot-App ohne dich als Admin gründete,
lassen sich nicht um deine Geräte erweitern – dann geht deine Nachricht per
NIP-17. Andere Marmot-Apps (White Noise) sehen Geräte als eigene Mitglieder.

**Tests:**
- `mls-geraete.test.ts` +4: Soll, Abgleich, Partner (auch als Gerät und mit
  entzogenen), keine 1:1 (zu dritt, fremd, ohne mich, Fremder behauptet
  Kontakt als Gerät).
- `mls-konto.test.ts` +3 mit echter Engine:
  - Gründen mit Geräten beider Seiten: alle Admin, Einladungen der Geräte am
    Posteingang der Person, nur an das Gerät adressiert, von einem
    Wegwerf-Schlüssel; jedes Gerät liest.
  - Entzug entfernt das Gerät vor der nächsten Nachricht (liest nichts mehr);
    ein neues Gerät wird eingeladen und liest ab seinem Beitritt; ein Gerät
    ohne KeyPackage → NIP-17, Gruppe unverändert.
  - Einladung mit Geräten → Unterhaltung mit der Person; mit Fremdem → keine.
- `mls-verdrahtung.test.ts`: d3-Test ersetzt (Abgleich vor dem Senden, keine
  pauschale Geräte-Sperre, Posteingang der Person, Partner aus den
  Mitgliedern), neu: Zuordnung über `ordneDmZu`.

Endstand: protocol 1149 · node 240 · app 418 (+8) · mls 11 · Leak-Tests 54
grün + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 5.4b1 – Outbox beim Lesen

Bisher las die App alles im eigenen Pool: eigener Satz, wechselnde Relays der
Startliste, gemerkte Funde. Einen Kontakt, der ganz andere Relays nutzt, sah
sie nur, wenn seine Events zufällig auch dort lagen. Jetzt liest sie, was
Kontakte selbst schreiben, auch dort, wo sie es laut NIP-65 hinschreiben.

**Protokoll** (`relay-start.ts`): `outboxPlan(listen, autoren)`:
- je Autor die Schreib-Relays seiner neuesten gültigen NIP-65-Liste
  (Signatur und Autor geprüft – sonst könnte jeder die Leser eines Kontakts
  umleiten), höchstens `OUTBOX_JE_AUTOR` = 3;
- gebündelt je Relay, die Relays mit den meisten Autoren zuerst, höchstens
  `OUTBOX_MAX_RELAYS` = 8;
- Autoren ohne Liste fehlen im Plan – für sie bleibt der Pool.

**App** (`outbox-lesen.ts`, neu; `frageBeiAutoren()` in `shell/state.ts`):
- fragt den Pool wie bisher und dazu die Relays aus dem Plan, die nicht schon
  im Pool sind, über kurze eigene Verbindungen (`frageAn()`);
- NIP-65-Listen der Autoren bleiben zehn Minuten gemerkt; nur gültige; offline
  wird nichts gemerkt;
- von fremden Relays zählt nur, was gültig signiert ist und von einem der
  gefragten Autoren stammt (`WebSocketRelay` prüft Signaturen nicht selbst);
- ein toter Relay kostet nur seine Antwort.

**Verdrahtet:**
- Schlüsselwechsel-Mandate der Kontakte (`aktualisiereSchluessel()`);
- Geräte-Vollmachten einer Person (`geraeteBuch`, Abfragen mit `authors`;
  „wer hat dieses Gerät bevollmächtigt“ mit `#p` bleibt im Pool);
- Posteingänge (Kind 10050, `posteingangVon()`) – für DMs und
  MLS-Einladungen;
- das Profil beim Zap (Lightning-Adresse); das neueste gilt, nicht das erste.

Nicht betroffen: Kontaktlisten anderer liest die App nicht; Räume gehören zu
Spur B (2.3); KeyPackages lasen schon seit 2.2b-c1 an den Schreib-Relays.

**Offen (b2):** eigener Satz in den Settings sichtbar und änderbar; danach
prüfen, ob der wechselnde Teil (heute drei) kleiner werden kann.

**Tests:**
- protocol +2: Plan (Schreib- statt Lese-Relays, neueste Liste, ohne Liste
  nicht, Fälschung mit fremdem Autor oder kaputter Signatur ignoriert, Listen
  Nicht-Gesuchter ignoriert), Grenzen (drei je Autor, acht insgesamt, die
  breitesten zuerst).
- app +4 (`outbox-lesen.test.ts`): Profil nur am Schreib-Relay gefunden,
  Pool-Relays nicht doppelt gefragt; ein böses Relay schiebt nichts unter;
  Listen zehn Minuten gemerkt, ohne Liste nur Pool, toter Relay stört nicht;
  Verdrahtung.

Endstand: protocol 1151 (+2) · node 240 · app 422 (+4) · mls 11 · Leak-Tests
54 grün + 2 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 6.2 – Ehrlicher PWA-Modus: „IP verborgen“ nur mit erreichbarem .onion-Relay

**Vorher:** Der Datenschutzbericht rechnete immer mit der direkten
Verbindung. Wer „.onion-Relays bevorzugen“ gewählt hatte, bekam den
Pauschalsatz „das kann die App nicht prüfen“ – auch im Tor Browser, wo es
stimmte, und in jedem anderen Browser, wo die Einstellung nichts bewirkt.

**Prüfung** (`packages/app/src/onion-pruefung.ts`): Eine Web-App kann Tor
nicht herstellen, aber versuchen, ein .onion-Relay zu erreichen. Das gelingt
nur, wenn der Browser über Tor läuft; gängige Browser lösen .onion-Namen gar
nicht erst auf (RFC 7686). Scheitert es, kann auch nur das Relay aus sein –
der Bericht sagt darum „läuft wohl nicht über Tor (oder die geprüften Relays
sind gerade aus)“. `pruefeOnion()` versucht bis zu drei .onion-Relays
zugleich (eingetragenes zuerst, dann eigener Satz und entdeckte Relays), mit
10 Sekunden Zeitlimit, und schließt jede Verbindung wieder. Ergebnis:
„erreichbar“, „nicht-erreichbar“ oder „keine-onion“ (nichts zu prüfen).

**Aussage** (`privacy-facts.ts`): `ipFaktFuer()` ersetzt die Aussage „ip“ für
diese Sitzung. Erreichbar: „IP-Adresse verborgen …“ unter „In dieser Sitzung
geprüft“ (neuer Status „geprueft“, nie in der festen Liste), mit der Grenze:
Wer nur .onion-Adressen über Tor leitet, zeigt anderen Relays seine IP
weiter. Sonst bleibt die Lücke offen (jetzt Ausbauplan 6.1) mit „Native App
oder Tor Browser nutzen“ bzw. „Prüfen ging nicht: Die App kennt kein
.onion-Relay“.

**Bericht** (`shell/datenschutz.ts`): prüft beim Öffnen (einmal je Liste der
Kandidaten, „erneut prüfen“ prüft neu) und rechnet nur bei „erreichbar“ mit
Tor (`network: "tor"`). Beim Start prüft die App nichts mehr – der
Bericht entsteht erst im Settings-Tab. „Mixnetz“ kann sie nicht prüfen und
sagt das. Neues Feld „.onion-Relay zum Prüfen“ (`freedom.onion.pruefrelay`,
öffentlich wie jede Relay-Adresse, nur für die Prüfung).

**Browser-Prüfung** (gebaute App, Test-Relays):
- „Tor Browser“ (.onion-Verbindung geht auf): „✓ IP-Adresse verborgen“,
  Bewertung „Relays sehen einen Tor-Ausgang“, Kurzfassung „hinter Tor“.
- Ohne Tor (.onion geht ins echte Netz und scheitert): „○ Noch nicht … –
  Diese Sitzung erreicht kein .onion-Relay … Native App oder Tor Browser
  nutzen“, Bewertung kritisch.
- Kein .onion-Relay bekannt: „Prüfen ging nicht …“, kein Versuch.
- In keinem Fall ein .onion-Versuch beim Start; keine Seitenfehler.

**Tests:** protocol +3 (feste Liste ohne „geprueft“, beide Fälle im Text);
app +6 (erreichbar, nicht erreichbar, Zeitlimit, keine Kandidaten,
Kandidatenwahl, Verdrahtung).

**Nebenbei:** FORTSCHRITT 5.10 – a mit PR-Link, b (OpenTimestamps)
zurückgestellt: Die Kalender-Server sind aus der Arbeitsumgebung nicht
erreichbar, und ohne echte `.ots`-Testvektoren lässt sich die
Zusammenarbeit mit anderen OTS-Werkzeugen nicht prüfen.

Endstand: protocol 1155 (+3, + 6 übersprungen) · node 239 (+ 7 übersprungen
ohne Netz) · app 425 (+6) · mls 11 · Leak-Tests 54 grün + 2 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 2.3a – Räume als MLS-Gruppen: Baustein

**Aufteilung:** 2.3 braucht weit mehr als 400 Zeilen. a ist der Baustein
(MLS-Crate, Raum-Logik, Engine-Test mit 50 Mitgliedern), b die Räume in der
App (privat als Standard, öffentlich nur ausdrücklich mit Hinweis), c die
Moderation zusammen mit 8.5.

**MLS-Baustein** (`packages/mls`, Code von Spur A – klein gehalten):
- Bis hier konnte die Crate nur Chat-Text senden (Kind 9 ohne Tags) und gab
  andere Arten beim Empfang gar nicht weiter. Marmot trägt in jeder
  Nachricht ein inneres Event mit Art und Tags; das reicht die Crate jetzt
  durch: `sendenEvent(gruppe, art, tags, text)`, beim Empfang `art` und
  `tags`.
- `adminsSetzen(gruppe, admins)`: Admins per Commit neu setzen – so werden
  Moderatoren ernannt und abgesetzt („Rollen über MLS-Proposals“). Nur ein
  Admin darf das; MDK prüft, dass alle Genannten Mitglied sind.
- `admin`: ob der Absender beim Senden Admin war – von MLS belegt. MDK stellt
  das nur für Moderations-Arten fest (4891 Löschen, 1985); sonst fehlt es,
  und es zählt, wer heute Admin ist.
- Der 1:1-Chat nimmt nur Art 9 in den Verlauf (`nurChat`), sonst stünden
  Raum-Events als Zeilen darin.
- `dist/` neu gebaut mit `bauen.sh`; vorher bestätigt, dass der Nachbau des
  alten Stands bitgleich ist.

**Raum-Logik** (`protocol/src/raum-gruppe.ts`): Ein privater Raum ist eine
MLS-Gruppe; Definition (Kanäle), Rollenliste, Zuweisungen, Nachrichten und
Löschungen sind innere Events. `gruppenRaum()` baut daraus den Zustand, mit
dem die Auswertung aus `spaces.ts` weiter gilt (`can`, `canWriteTo`,
`buildThreads`):
- Moderatoren sind die Admins der Gruppe – sie haben alle Rechte.
- Definition und Rollenliste zählen nur von Admins; die neueste gilt.
- Zuweisungen von Admins, sonst nur mit `rollen_vergeben` unter dem eigenen
  Rang; eine leere schaltet stumm.
- Mitglieder ohne Zuweisung: Rolle „mitglied“ bzw. lesen, schreiben, Threads.
- Löschen: Admin jede Nachricht (4891, Admin-Stand von MLS belegt), jeder die
  eigene (5).
- Schreibrecht je Nachricht nach heutiger Rollenlage.
- Alle Mitglieder lesen alle Kanäle – ein Kanal ordnet, er verschlüsselt
  nicht eigens (ein Kanal nur für wenige wäre eine eigene Gruppe).

**Engine-Test** (`packages/mls/test/raeume.test.ts`, echte MDK-Engine):
- 50 Mitglieder (Gründer, ein Moderator als Admin, 48 weitere): Kanäle und
  Rollenliste kommen bei allen mit Art und Tags an; die Definition eines
  Mitglieds zählt nicht.
- Ein Mitglied darf weder entfernen noch Admins setzen.
- Der Moderator entfernt ein Mitglied: neue Epoche, 49 Mitglieder; die
  nächste Nachricht lesen alle außer dem Entfernten.
- Moderator ernennen per `adminsSetzen`; sein Löschen (4891) kommt mit
  belegtem Admin-Stand an. Ein Mitglied kann 4891 gar nicht erst senden –
  MDK lehnt es schon beim Senden ab.
- Innere Events: Art prüft der Wrapper, Tags kommen unverändert an, Relays
  sehen nur Kind 445 ohne Klartext.

**Tests:** protocol +6 (`raum-gruppe.test.ts`: Definition nur von Admins,
Moderatoren = Admins, Zuweisungen mit Rang und Stummschalten, Schreibrecht
je Nachricht auch nach Absetzung, Löschen, Bausteine); mls +2; app: der
Abgleich eines 1:1-Chats nimmt ein Raum-Event nicht in den Verlauf
(bestehender Test erweitert, ohne den Filter rot).

Endstand: protocol 1161 (+6, + 6 übersprungen) · node 239 (+ 7 übersprungen
ohne Netz) · app 425 · mls 13 (+2) · Leak-Tests 54 grün + 2 todo · 0 rot ·
check-wiring `--streng` Exit 0 (6 neue Ausnahmen „2.3b“) · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden · `bauen.sh
--pruefen` vor der Änderung bitgleich, danach `dist/` neu gebaut.

## Schritt 2.3b – Private Räume in der App, öffentlich nur ausdrücklich

**Vorher:** Räume waren offen (Kind 42 mit Kanal-Tags): Jeder konnte mitlesen,
auch ohne die App. Die Aussage „Räume sind Ende-zu-Ende-verschlüsselt“ stand
als Lücke im Bericht, der Leak-Test als `todo`.

**Jetzt** (`shell/raum-mls.ts`, `tabs/kommunikation.ts`):
- „Raum anlegen (privat)“ gründet eine MLS-Gruppe nur mit mir (mit Namen),
  dann Kanäle und Rollen als innere Events. MLS gibt es nur mit Tresor –
  ohne ihn sagt die App das.
- „öffentlichen Raum anlegen“ ist ein eigener Knopf mit Warnung; über offenen
  Räumen steht sichtbar „Öffentlicher Raum – jeder kann mitlesen …“.
- „einladen“ (nur Moderatoren): Kontakt wählen, KeyPackage suchen, Einladung
  versiegelt an seinen Posteingang; danach den Raumstand (Definition, Rollen,
  Zuweisungen) erneut – Neue lesen nichts von vor ihrem Eintritt.
- Eine Einladung in eine benannte Gruppe wird ein Raum in der Raumleiste –
  auch zu zweit. Vorher wäre ein Raum zu zweit als 1:1-Chat gebucht worden und
  hätte die Unterhaltung mit dem Einladenden ersetzt (in der Browser-Prüfung
  gefunden). Die Crate kann dafür den Gruppennamen lesen (`name()`).
- Öffnen gleicht die Gruppe ab und baut den Raum über `gruppenRaum()`; ein
  offener privater Raum wird alle 30 s abgeglichen. Senden verschlüsselt in
  die Gruppe, das Eigene gleich in den Verlauf.
- Moderatoren ernennen: per Commit (`setzeModeratoren` → `adminsSetzen`), nie
  als öffentliches Event. Der alte Moderationsknopf erscheint in privaten
  Räumen nicht – er schriebe öffentliche Sperr-Events (Löschen und Entfernen
  über MLS folgen in 2.3c).
- Die Liste privater Räume liegt nur im Tresor (`freedom.raeume.privat`), nie
  in `freedom.spaces`; Raumnamen nur als `textContent` (die Raumleiste baut
  jetzt ohne `innerHTML`).

**MLS-Baustein** (klein, Code von Spur A): die Id des inneren Events
(`inneres`) beim Empfang und beim Senden – bei allen gleich, damit Antworten
und Löschen dieselbe Nachricht meinen (die MLS-Nachrichten-Id kennt der
Absender nicht); `name(gruppe)`. Der Verlauf nimmt alle Arten auf, der
1:1-Chat zeigt und zählt nur Chat; Steuer-Events (Kanäle, Rollen) verdrängt
die Grenze von 1000 Nachrichten nicht.

**Datenschutz:** Aussage „raeume“ jetzt belegt (Regel „mls-gruppe“, Szenario
mit der echten Engine); öffentliche Räume und Communities stehen in der
Aussage als das, was sie sind. Leak-Test „Privater Raum“: nur Kind 445 und
Umschläge, weder Text noch Name noch Kanal.

**Website:** FAQ (Räume standardmäßig privat; über Funk gehen Räume weiter
nicht), Whitepaper (Abschnitt Räume), Roadmap (Entscheidung „Verschlüsselte
Kanäle“).

**Browser-Prüfung** (zwei Nutzer, gemeinsames Test-Relay, Tresor):
- A legt einen privaten Raum an und lädt B ein. B bekommt die Einladung beim
  Abgleich des Posteingangs, sieht den Namen „Werkstatt E2E“ und die Kanäle
  und liest A's Nachricht. B antwortet, A liest die Antwort.
- B sieht A als Moderator und sich selbst („du“); „einladen“ sieht B nicht.
- Auf den Relays kein Klartext (Text, Raumname, Kanäle); nur Kinds 445, 1059,
  10002, 10050, 30443; keine 445-Nachricht von einer Identität.
- Öffentlicher Raum: erst die Warnung, dann Hinweis über dem Raum sichtbar;
  er liegt, wie angekündigt, offen auf den Relays (34700).

**Tests:** app +5 (Raum-Grundfunktionen mit der echten Engine inkl. Raum zu
zweit; Verdrahtung: Tresor-Liste, Einladung → Raum, Raumstand nach dem
Einladen, Moderatoren per Commit, Hinweis und `textContent`); Leak +1 (aus
`todo`); Szenario „raeume“. Zwei bestehende Tests an die neue Bedeutung
angepasst (Einladung in eine Gruppe zu mehreren: statt `null` jetzt
`partner: null`, also ein Raum) – ihre Prüfungen sind dabei genauer geworden.

Endstand: protocol 1161 (+ 6 übersprungen) · node 239 (+ 7 übersprungen ohne
Netz) · app 430 (+5) · mls 13 · Leak-Tests 55 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden · `bauen.sh --pruefen` bitgleich.

## Schritt 2.3c mit 8.5 – Moderation privater Räume, private Meldungen

**Vorher (nach 2.3b):** In privaten Räumen war der Moderationsknopf
ausgeblendet – er hätte öffentliche Ausblend- und Sperr-Events geschrieben.
Löschen, Entfernen und Melden gab es dort nicht. `group-crypto.ts`
(Epochenschlüssel für Kanäle) war nie verdrahtet; die Karte ersetzt es durch
MLS.

**Jetzt:**
- **Aktionen an jeder Nachricht** (`raumAktion()`): die eigene löschen
  (Kind 5); als Moderator für alle löschen (4891 – MDK lehnt das für
  Nicht-Admins schon beim Senden ab) oder den Absender entfernen (Commit,
  neuer Schlüssel); alle anderen melden.
- **Melden (8.5):** `baueRaumMeldung()` (protocol) – eine Meldung nach NIP-56
  (Kind 1984, Grund, Notiz), je Moderator ein eigener Umschlag an seinen
  Posteingang, nie in die Gruppe. Relays sehen nur Umschläge; die anderen
  Mitglieder erfahren nichts. `oeffneRaumMeldung()` nimmt nur echte Meldungen
  an.
- **Beim Moderator:** Der Posteingang reicht Meldungen zu eigenen privaten
  Räumen an `alsRaumMeldung()`. Sie bleiben nur im Speicher und stehen unter
  den Mitgliedern mit „löschen“, „entfernen“ und „erledigt“. Erledigte Ids
  liegen im Tresor.
- **Keine öffentliche Sperrliste:** Entfernen ist ein MLS-Commit, kein
  Event. Die Moderation offener Communities (Kind 34550–34552) bleibt, wie
  sie war – öffentlich wie die Communities selbst.
- **`group-crypto.ts` entfernt** samt 20 Tests und 10 Wiring-Ausnahmen:
  Verschlüsselte Kanäle macht jetzt MLS (2.3a/b). Die Protokoll-Tests sinken
  deshalb von 1161 auf 1143 (+2 für Meldungen).
- `privacyInfo()` für verschlüsselte Kanäle beschreibt MLS: Entfernen wechselt
  den Schlüssel, Neue lesen nur ab ihrem Eintritt.

**Datenschutz:** neue Aussage „raum-meldung“ (belegt, Regel
„autor-verborgen“, Szenario: je Moderator ein Umschlag, Melder nie Autor,
kein Klartext, p-Tags nur an Moderatoren).

**Website:** Whitepaper (Moderation privater Räume; „Client-seitige Regeln“
nennt, dass nur das Entfernen für alle wirkt), Roadmap, FAQ.

**Browser-Prüfung** (zwei Nutzer, wie 2.3b, weitergeführt):
- B meldet A's Nachricht: genau ein Umschlag (1059) mit einem p-Tag, kein
  Klartext.
- A sieht die Meldung nach dem Abgleich des Posteingangs und löscht die
  Nachricht; auch bei B ist sie weg.
- A entfernt B: danach ist A allein, und B liest A's nächste Nachricht nicht.
- Kein offenes Moderations-Event (34550–34552, 1984) auf den Relays; keine
  Seitenfehler.

**Tests:** protocol +2 (Meldung: je Moderator ein Umschlag, nie an sich
selbst, kein Klartext; nur der Moderator öffnet sie, eine DM ist keine
Meldung, ungültige Angaben scheitern), −20 (`group-crypto.ts`); app +2
(Verdrahtung Moderation und Meldungen), der Raum-Test entfernt jetzt auch
(`mlsEntferne`, danach liest der Entfernte nichts). Zwei Tests der
Posteingangs-Kette um `alsRaumMeldung` erweitert.

Endstand: protocol 1143 (−18, + 6 übersprungen) · node 239 (+ 7 übersprungen
ohne Netz) · app 432 (+2) · mls 13 · Leak-Tests 55 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 5.4b2 – Eigener Relay-Satz in den Settings

Der eigene Satz (seit 5.4a zufällig aus der Startliste, als NIP-65-Liste und
Posteingang veröffentlicht) war bisher unsichtbar. Jetzt steht er in den
Settings unter Verbindung → „Nostr-Relays (dein Satz)“ und lässt sich ändern.

**Prüfen** (`pruefeRelayEingabe()`, `relay-satz.ts`):
- Adressen je Zeile, durch Komma oder Leerraum; normalisiert, ohne Doppelte;
- jede plausibel und verschlüsselt: `wss://`, unverschlüsselt nur `.onion`
  (dort verschlüsselt Tor); kein lokales Netz;
- eine bis acht (`MAX_EIGENE`, wie `ladeEigeneRelays()`); mindestens eine
  taugt als Posteingang;
- Fehler als feste Texte, angezeigt per `textContent`.

**Ändern** (`setzeEigeneRelays()`):
- erst die NIP-65-Liste, dann den Posteingang (Kind 10050) weit
  veröffentlichen (Pool und ganze Startliste, dort sucht sie jeder);
- erst danach merken – kommt eine Liste nirgends an, gilt der alte Satz weiter;
  stand die NIP-65-Liste schon, übernimmt der nächste Abgleich sie
  (`eigeneListenAbgleichen()` liest die veröffentlichte) und veröffentlicht
  den Posteingang nach;
- die neuen Relays gleich in den Pool (`nimmInPool()`, aus
  `posteingangDerPerson()` herausgezogen), damit Nachrichten an den neuen
  Posteingang ohne Neustart ankommen;
- ein zweites Gerät derselben Identität übernimmt den neuen Satz beim
  nächsten Abgleich, statt neu zu würfeln.

**Als Gerät** nur lesbar – der Satz gehört der Person (8.6c).

**Der wechselnde Teil bleibt bei drei:** Er dient dem Finden der Listen
anderer (wer eine NIP-65-Liste hat, streut sie über die Startliste). Die
Outbox beim Lesen (b1) hilft nur bei Autoren, deren Liste man schon kennt.

**Tests:** app +3 (`relay-satz.test.ts`):
- Eingabe: Trennzeichen, Normalisieren, Doppelte, `.onion`; abgewiesen: leer,
  kein Relay-Schema, `ws://` ohne .onion, lokales Netz, nur .onion (kein
  Posteingang), mehr als acht;
- Ändern: scheitert die erste oder zweite Liste, bleibt der alte Satz; sonst
  beide Listen veröffentlicht und gemerkt; ein zweites Gerät übernimmt ihn;
- Verdrahtung: Karte, als Gerät nur lesbar, erst veröffentlichen, dann in den
  Pool, kein `innerHTML`.

Endstand: protocol 1145 · node 240 · app 439 (+3) · mls 13 · Leak-Tests 55
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 5.1.1 – Gebührenmodell A+: Protokoll-Baustein

Entscheidung 4.0 (A+, 26.09.2026): Eine KI-Zahlung wird beim Zahlen fest
aufgeteilt – 94 % Provider, 2,5 % Entwicklung, 1,5 % Relays, 0,5 % Werber des
Kunden, 0,5 % Werber des Providers, 1 % Hosting. Kein Topf, niemand verwahrt
fremdes Geld.

**Heute** zahlt der Kunde dem Provider alles; dessen Knoten zahlt Pool,
Werbe-Pool und App-Gebühr aus und veröffentlicht einen Gebühren-Beleg
(`settlement.ts`). **Bei A+** zahlt die App des Kunden jeden Anteil selbst,
der Provider stellt nur seinen in Rechnung. Das ändert Knoten, App und Belege
zugleich – darum vier Teile (`phase-5.md`): 5.1.1 Protokoll (hier), 5.1.2
Knoten, 5.1.3 App, 5.1.4 Aufräumen.

**`packages/protocol/src/aufteilung.ts`** (neu):
- `PROVIDER_PPM`, `ANTEILE_PPM` – fest; Selbstprüfung beim Import (Summe 100 %,
  ohne Provider höchstens 10 %) und neue CI-Invariante „Aufteilung A+“
  (`ci.yml`, neben der alten, die mit 5.1.2/5.1.4 geht).
- `adresseFuer()`: Lightning nur als Lightning-Adresse ohne lokalen Host, SOL
  nur Base58; den Betrag der Rechnung prüft die Zahlung selbst (4.8).
- `zahlbareAnteile()` / `teileAuf()`: nur Anteile mit Empfänger auf der Schiene
  der Zahlung; nicht Zuordenbares bleibt beim Provider, nie bei der
  Entwicklung; jeder Anteil abgerundet, Reste beim Provider; Relays höchstens
  drei, ohne Doppelte, zu gleichen Teilen, der Rest an den ersten; keine
  Null-Zahlungen. **SOL vorerst ganz an den Provider** – die Aufteilung
  erzwingt dort erst das Programm des Zahlkanals (4.3); einzelne
  SOL-Überweisungen je Anteil verbänden die Adresse des Kunden mit allen
  Empfängern.
- Deklaration im versiegelten Auftrag: `aufteilungTag()` nennt die Anteile, die
  die App selbst zahlt; der Provider prüft mit `pruefeAufteilung()` (bekannt,
  jeder einmal, höchstens 10 %, Werber des Providers nur, wenn sein Angebot
  einen nennt) und stellt `providerAnteilMsat()` in Rechnung – derselbe Betrag,
  den die App berechnet. Ohne Tag: der ganze Betrag.

Noch nicht verdrahtet: Ausnahmen in `wiring-ausnahmen.txt` nennen 5.1.2/5.1.3.

**Tests:** protocol +7 (`aufteilung.test.ts`): feste Werte; alle Empfänger
bekannt (exakte Beträge, drei Relays); Summe bei jedem Betrag, nie unter 94 %,
keine Null-Zahlungen, Relay-Rest; nicht Zuordenbares (fehlend, ungültig,
lokal) an den Provider; SOL ganz an den Provider; Deklaration → derselbe
Rechnungsbetrag; abgelehnte Deklarationen.

Endstand: protocol 1152 (+7) · node 240 · app 439 · mls 13 · Leak-Tests 55
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · CI-Invariante lokal
ausgeführt.

## Schritt 5.1.2 – Gebührenmodell A+: Knoten

**Befund beim Lesen:** Die App bezahlt KI-Aufträge heute nicht – sie legt nur
Belege an (`chargeForResult()` ohne Wallet, bekannt seit 4.1, Entscheidung
26.09.: „Agent-Bezahlung ja, nach 4.0 – erst Lightning je Auftrag“). Der Knoten
zahlte trotzdem nach jedem Auftrag aus eigener Tasche Pool, Werbe-Pool und
App-Gebühr aus (an standardmäßig leere Adressen) und veröffentlichte einen
Gebühren-Beleg (38051) mit Betrag und Sitzungsschlüssel. 5.1.2 und 5.1.3 bauen
darum die echte Bezahlung je Auftrag gleich nach A+.

**Knoten (`dvm-provider.ts`):**
- Die Deklaration im Auftrag (`["aufteilung", …]`, 5.1.1) wird geprüft, bevor
  gerechnet wird (`pruefeAufteilung()`): unbekannt, doppelt, mehrfach oder
  „Werber des Providers“ ohne Werber im Angebot → abgelehnt, mit Rückmeldung
  (Kind 7000, fester Text). Auf SOL keine Deklaration – dort teilt erst der
  Zahlkanal (4.3) auf, sonst zahlte der Kunde doppelt.
- `ProcessedJob` nennt `providerMsat` (= `providerAnteilMsat()`, derselbe Betrag,
  den die App rechnet) und die deklarierten Anteile; SOL-Aufträge ganz an den
  Provider. Das Ergebnis (6050) nennt weiter den ganzen Preis.
- Die Client-Gebühr (`clientFeeFor`) liest der Knoten nicht mehr – sie geht im
  Entwicklungsanteil auf.

**Nichts mehr auszahlen (`main.ts`):**
- `settlement.ts` und `pool-distributor.ts` entfernt, mit ihren Tests (je 16):
  Die Karte streicht Pool-Verteiler und Werbe-Pool; die Auszahlung aus der
  Tasche des Providers entfällt, weil die App jeden Anteil selbst zahlt. Damit
  fällt auch der öffentliche Gebühren-Beleg (38051) weg.
- Alte Umgebungsvariablen (`FEE_POOL_LUD16`, `FEE_REFERRAL_LUD16`,
  `POOL_DISTRIBUTOR`) lösen eine Warnung aus, statt still zu wirken.

**Angebot (38027, `tiers.ts`):** `lud16` (dorthin zahlt die App den Anteil des
Providers) und `werber` (Lightning-Adresse seines Werbers, 0,5 %); beim Bauen
und Lesen nur plausible Lightning-Adressen. Der Knoten liest `NODE_LUD16`
(jetzt geprüft) und neu `PROVIDER_WERBER_LUD16`.

**Doku:** PROTOCOL.md §3 und §16 als abgelöst markiert (Neufassung mit 5.1.4),
GO-LIVE.md 3.3 ohne Pool.

**Texte der App:** folgen mit 5.1.3 (die App zahlt dann die Anteile). Bis der
GX10-Knoten aktualisiert ist, zahlt der Live-Knoten noch nach dem alten Modell –
die heutigen Texte bleiben bis dahin zutreffend.

**Tests:**
- node −31: `settlement.test.ts` und `pool-distributor.test.ts` (32) entfernt
  (Karte 5.1 Punkt 2; der Knoten zahlt nichts mehr aus); neu +1: Aufteilung im
  Knoten – Provider-Anteil 94,5 % bei vier deklarierten Anteilen, derselbe Wert
  wie `providerAnteilMsat()`; abgelehnt ohne zu rechnen (Werber ohne Angebot,
  unbekannter Anteil) mit Rückmeldung; mit Werber im Angebot 99,5 %. Der
  Job-Loop-Test prüft statt des alten Fee-Splits den Provider-Anteil.
- protocol +1: Angebot mit Lightning-Adresse und Werber, fremde Angaben geprüft.
- check-wiring: drei Funktionen aus `aufteilung.ts` verdrahtet (Ausnahmen raus);
  neu ausgenommen, was nur der Pool-Verteiler nutzte (Knappheitsbonus, WoT) und
  was mit 5.1.3/5.1.4 fällt (Client-Gebühr lesen, Gebühren-Beleg bauen).

Endstand: protocol 1153 (+1) · node 209 (−31, begründet) · app 439 · mls 13 ·
Leak-Tests 55 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng 0 unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 8.4a – Relay-Rolle als Posteingang: NIP-42, Zugang, NIP-11

Von Spur A übernommen (27.09.2026, zusammen mit 5.4c, 6.4, 8.16 mit 0.F,
ggf. 5.3). 8.4 geteilt (mehr als 400 Zeilen): **a** Relay als Posteingang,
**b** Zugang kaufen in Sats oder SOL, **c** App.

**Vorher:** Der Relay des Knotens nahm alles an und gab alles heraus – auch
jeden Umschlag an jeden, der danach fragte. Ersetzbare Events (Relay-Listen,
Posteingänge) lagen in jeder Fassung, `limit` galt nicht (bis zu 5000 der
ältesten), flüchtige Events (NIP-46) wurden gespeichert, `expiration` nicht
beachtet. Abos hingen nur an ihrer Id: Benutzten zwei Clients dieselbe
(„s1“), bekam nur noch der zweite Events.

**Jetzt** (`protocol/src/relay-zugang.ts`, `node/src/relay-role.ts`):
- **NIP-42:** jede Verbindung bekommt eine Challenge; `pruefeRelayAuth()`
  nimmt nur Kind 22242 mit gültiger Signatur, derselben Challenge, dem Host
  dieses Relays (`RELAY_PUBLIC_URL` oder der Host der Verbindung) und einer
  Zeit im Fenster (±10 min). Mit `RELAY_PUBLIC_URL` gilt nur deren Host,
  nicht der Host-Kopf der Verbindung – sonst könnte ein fremder Relay unsere
  Challenge an seinen Nutzer durchreichen und sich als Mittelsmann anmelden.
- **Umschläge nur an Angemeldete** (`RELAY_UMSCHLAEGE_NUR_ANGEMELDET=1`,
  beschränkt immer): Kind 1059 nur an Verbindungen, die als ein Empfänger (`p`)
  angemeldet sind – gespeichert wie live; fragt ein Filter danach, antwortet
  der Relay `CLOSED auth-required:`. Standard aus, bis die App sich anmeldet
  (8.4c) – sonst läsen Nutzer ihre Post hier nicht mehr.
- **Zugang** (`RELAY_BESCHRAENKT=1`): nur Events von Schlüsseln mit Zugang
  oder an sie (`p`) – der Posteingang eines Zahlenden bleibt für Umschläge von
  Wegwerf-Schlüsseln erreichbar. Zugangsbuch `~/.freedom/relay-zugang.json`
  (verlängert ab dem laufenden Ende), dauerhaft der Betreiber und
  `RELAY_ZUGANG`. Bezahlt wird ab 8.4b.
- **Aufbewahrung:** ersetzbare und adressierbare Events nur in der neuesten
  Fassung (NIP-01), flüchtige nur weitergereicht, `limit` mit den neuesten
  zuerst, Abgelaufenes (NIP-40) weder angenommen noch ausgeliefert und alle
  zehn Minuten entfernt, sonst nach `RELAY_RETENTION_DAYS` ab Eingang (die
  neueste Fassung ersetzbarer Events bleibt).
- **NIP-11** auf demselben Port (CORS offen): Schlüssel des Betreibers – für
  5.1 (Spur A) die Zahladresse über sein Profil –, NIPs 1, 11, 40, 42, Grenzen,
  ob beschränkt und ob Umschläge geschützt sind.

**Verdrahtet:** `node/src/main.ts` (Relay-Rolle mit Zugangsbuch, Schlüssel,
öffentlicher Adresse); `docker-compose.yml` mit den neuen Schaltern.

Nebenbei: WebSocket-Nachrichten höchstens doppelt so groß wie ein Event
(vorher bis 100 MB), Schreiben des Zugangsbuchs nacheinander.

**Tests:** protocol +5 (Anmeldung mit acht Fehlfällen, Annahme mit Zugang,
Ausliefern und Nachfragen, Aufbewahrung, NIP-11); node +9 gegen einen echten
WebSocket (Anmeldung, Mittelsmann über den Host-Kopf, Umschläge nur an Bob – auch live, nicht an Carol,
nicht an ein offenes Abo –, beschränkt samt Ablauf des Zugangs, Zugangsbuch
in der Datei samt zwei Zahlungen zugleich, ersetzbar/flüchtig/limit, NIP-40 und Aufbewahrung, gleiche
Abo-Ids, NIP-11). Die bestehenden Relay-Tests überspringen die Challenge.

Endstand: protocol 1158 (+5, mit 5.1.1/5.1.2 von Spur A; 6 übersprungen) · node 217 (+9;
5.1.2 entfernte 40, 7 übersprungen ohne Netz) · app 439 (nach dem Einmergen von 5.4b2, 5.1.1 und 5.1.2) · mls 13 · Leak-Tests 55 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 8.4b – Relay-Zugang kaufen in Sats oder SOL

**Jetzt** (`node/src/relay-kasse.ts`, `POST /zugang` auf dem Relay-Port):
- **Sats:** eine Rechnung des eigenen LND. Die Macaroon darf nur Rechnungen
  (`pruefeRelayMacaroon()`: `invoices:read`/`write`, `info:read` erlaubt) –
  wer den Relay übernimmt, zahlt nichts aus. Bezahlt ist erst, was der eigene
  Knoten als beglichen meldet.
- **SOL:** an `RELAY_SOL_ADRESSE`, mit einer Referenz nach Solana Pay
  (`solReferenz()`, 32 Zufallsbytes als Adresse). Bezahlt ist erst, was die
  Kette zeigt: Überweisung an den Betreiber, Betrag, Erfolg und die Referenz
  des Angebots als Konto (`pruefeSolUeberweisung(…, { referenz })`). Eine
  Überweisung, die zwei Referenzen nennt, löst nur ein Angebot ein
  (eingelöste Signaturen gemerkt, auch über einen Neustart).
- Nie in einer Schiene, die nicht eingerichtet ist („Dieser Relay nimmt kein
  SOL“ statt still Sats); höchstens drei offene Angebote je Schlüssel.
- Angebote werden abgelegt, bevor sie herausgehen – wer während eines
  Neustarts zahlt, bekommt den Zugang trotzdem. Zwei Prüfungen zugleich
  gewähren ihn genau einmal.
- Nach außen nur feste Texte (`KasseFehler`), nie Meldungen von LND oder vom
  RPC; ein Fehler beim Kaufen beendet den Knoten nicht.
- NIP-11 nennt Preise je Schiene (`fees.subscription` in msat und Lamports)
  und die Kaufadresse (`payments_url`).
- **Events überdauern einen Neustart:** jede Minute und beim Beenden in
  `~/.freedom/relay-events.json`, beim Laden geprüft (gefälschte Einträge
  verworfen); über `RELAY_MAX_EVENTS` lehnt der Relay ab statt still zu
  verdrängen.

**Abnahme** (Knoten-Test, echter WebSocket, LND und Kette als Stub):
- Ein Umschlag an Bob wird abgewiesen, solange Bob keinen Zugang hat.
- Bob kauft mit Sats; bis zur Zahlung heißt es „Noch nicht bezahlt“.
- Danach wird derselbe Umschlag angenommen und nur an den angemeldeten Bob
  ausgeliefert. Alice bekommt `CLOSED auth-required`.

Echte Zahlungen (Testnet-Sats, Devnet-SOL) sind MENSCH-Aufgabe.

**Verdrahtet:** `node/src/main.ts` (Kasse mit LND-Rechnungen und Kette,
`RELAY_PREIS_SATS`, `RELAY_PREIS_LAMPORTS`, `RELAY_SOL_ADRESSE`,
`RELAY_LND_MACAROON`, `RELAY_ZUGANG_TAGE`, `RELAY_MAX_EVENTS`; Relay beim
Beenden gestoppt, damit die Events abgelegt werden); `docker-compose.yml`.
`LndLightningAdapter.createInvoice()` nimmt Notiz und Gültigkeit (der LP
bleibt beim alten Text).

**Tests:** protocol +3 (Relay-Macaroon, NIP-11 mit Preisen, Referenz);
node +7 (Sats, SOL mit fünf Fehlfällen und doppelter Referenz, keine fremde
Schiene, Neustart, gleichzeitige Prüfungen, Abnahme über den Relay, Events
über einen Neustart samt Fälschung und vollem Relay).

Endstand: protocol 1161 (+3, 6 übersprungen) · node 224 (+7, 7 übersprungen
ohne Netz) · app 439 · mls 13 · Leak-Tests 55 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 5.1.3a – Gebührenmodell A+: Die App zahlt

**Aufteilung von 5.1.3** (mehr als 400 Zeilen): 5.1.3a die Zahlung selbst,
5.1.3b Werber des Kunden (Werbelink mit Lightning-Adresse) und Relays (NIP-11 →
Profil). Hosting folgt mit dem Spiegel-Verzeichnis (5.3).

**Bezahlen im echten Pfad (`shell/ki-zahlung.ts`, `tabs/agent.ts`):**
- Beim Senden hält `buildJobEvent()` die Empfänger fest (`empfaengerFuer()`:
  Entwicklung, Werber des Providers aus dem Angebot) und legt die Deklaration
  (`aufteilungTag()`) vor dem Versiegeln in den Kern; `merkeAnfrage()` merkt
  Empfänger und Höchstbetrag je Anfrage.
- Bei der Antwort rechnet `rechneAntwortAb()` → `rechneAb()` mit denselben
  Empfängern (derselbe Provider-Anteil wie `providerAnteilMsat()` im Knoten) und
  höchstens das Gebot plus Werkzeuge nach Preisliste (`hoechstMsat()`) – ohne
  gemerkte Anfrage nichts. Verlangt ein Provider mehr, sagt es die App.
- Den Anteil des Providers zahlt der Session-Client an die Lightning-Adresse aus
  dem Angebot (5.1.2), sobald das Fenster (20 sats) erreicht ist, in ganzen
  sats und nie über das Budget der Sitzung. Keysend gibt es nicht mehr – nie
  benutzt, weil die App nie eine Wallet übergab.
- Die übrigen Anteile sammelt die Kasse (`anteile-kasse.ts`, Stand in `geheim`
  unter `freedom.anteile`) und zahlt sie ab 100 sats je Empfänger.
- **Nie doppelt:** erst die Rechnung holen und ihren Betrag prüfen (scheitert
  das, ist nichts gezahlt), dann zahlen. Scheitert das Zahlen, ist der Ausgang
  unklar: Die Sitzung zahlt dann nicht mehr von selbst, die Kasse legt den
  Betrag unter „unklar“ ab; der Nutzer klärt ihn in den Settings („kam an“ /
  „kam nicht an“). Zwei Antworten zugleich zahlen dieselbe Schuld nicht zweimal.
- Gezahlt wird nur über `zahle(zahlschienen(), …)` (Zweck `job` bzw. `gebuehr`).

**Entwicklung:** `ENTWICKLUNG` (Protokoll) ist leer, bis der MENSCH
selbstverwahrte Adressen nennt – ihr Anteil bleibt so lange beim Provider. Die
App-Gebühr (`freedomstack@walletofsatoshi.com`, abschaltbar) ist entfernt; sie
geht im Entwicklungsanteil auf.

**Texte:** Settings → Gebühren zeigt die feste Aufteilung, was heute tatsächlich
bezahlt wird, den Stand der Kasse und dass der Server hinter einer
Lightning-Adresse beim Holen der Rechnung IP und Betrag sieht. Die Vorschau unter
dem Gebot und die Blase unter jeder Antwort zeigen die Aufteilung A+ statt
Pool/Protokoll und statt „Zahlung prüfen“ (den Gebühren-Beleg des Knotens gibt
es seit 5.1.2 nicht mehr – die alte Anzeige hätte „nicht abgeführt“ behauptet).
Werben-Karte und Einrichtung ohne „Protokollgebühr“ und zweite Ebene. Der
Race-Modus versprach Zahlungen an Verlierer, die nie geschahen – jetzt: „bezahlt
wird die schnellste Antwort“.

**Knoten-Stand:** Der Provider muss 5.1.2 laufen (`NODE_LUD16` gesetzt), sonst
nennt sein Angebot keine Lightning-Adresse, und die App legt wie bisher nur
Belege an. Ein alter Knoten ignoriert die Deklaration und rechnet den ganzen
Betrag.

**Tests:**
- app +8 (447): `anteile-kasse.test.ts` (+4: gleicher Provider-Anteil wie der
  Knoten, Gebot als Obergrenze, Bündeln und ganze sats, unklar nie wiederholt,
  Klären, parallele Läufe, Unlesbares), `ki-zahlung.test.ts` (+3: Höchstbetrag,
  Verdrahtung, keine App-Gebühr/kein Keysend/keine Verwahrer-Adresse),
  `session-client.test.ts` (+1: Fenster, ganze sats, Budget, unklar, parallel).
  Ersetzt: der Test zu „Zahlung prüfen“ am Beleg des Knotens (4.8) durch einen
  zur Anzeige der Aufteilung – die Funktion entfällt, weil der Knoten seit 5.1.2
  keinen Beleg mehr veröffentlicht.
- Leak +2 (57): Deklaration nur im versiegelten Kern; bezahlte Belege zeigen
  offen weder Preimage noch Rechnung.
- protocol +1 (1154): `ENTWICKLUNG` eingefroren, keine Verwahrer-Adresse, leer →
  Anteil beim Provider.
- check-wiring: Keysend-Regel verschärft (nirgends erlaubt); `teileAuf`,
  `zahlbareAnteile`, `aufteilungTag` verdrahtet; ausgenommen bis 5.1.4, was die
  App nicht mehr nutzt (Client-Gebühr, Gebühren-Beleg, alte Aufteilung).

Endstand (nach Einmergen von main mit 8.4a/b): protocol 1162 (+1) · node 225 ·
app 447 (+8) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng 0 unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 5.1.3b – Gebührenmodell A+: Werber des Kunden und Relays

**Werber des Kunden (`werbung.ts`, `tabs/earn.ts`):** Der Werbelink trägt neben
dem Schlüssel die Lightning-Adresse aus dem eigenen Profil
(`?ref=<pk>&ln=<lud16>`, nur plausible Adressen). Die App des Geworbenen merkt
beides (`merkeWerber()`): Der erste Werber bleibt, ein fremder Link verdrängt
ihn nicht und schiebt keine Adresse unter; die Adresse gilt nur vom selben
Werber und wird nicht überschrieben. `werberZahlziel()` liefert sie für die
Aufteilung – nie an sich selbst. Öffentlich nennen bleibt freiwillig (8.1b) und
zählt nur für die Statistik; gezahlt wird ohne Nennung. Werber und Adresse
stehen in `SICHERUNG_EINTRAEGE`, damit ein neues Gerät weiter zahlt.

**Relays (`relay-zahlziel.ts`):** Der Auftrag geht über den Pool
(`pool.publish`); dessen Relays bekommen 1,5 %, höchstens drei, in der
Reihenfolge des Pools (eigener Satz vorn). Der Betreiber kommt aus der
Selbstauskunft (NIP-11 `pubkey`, nur wss, nie .onion, 5 s, höchstens 100 KB),
die Adresse aus seinem Profil (Signatur geprüft, das neueste zählt). Gelernt
wird im Hintergrund beim ersten Auftrag und gemerkt
(`freedom.relays.zahlziele`, ein Tag, nach Fehlschlag eine Stunde); beim Senden
zählt nur Bekanntes, nichts hält einen Auftrag auf. Einen eigenen NIP-11-Leser
statt eines gemeinsamen, weil Spur B mit 8.4c die App-Seite des Relay-Zugangs
baut – keine Überschneidung im Code.

**Texte:** Gebühren-Karte (wer heute tatsächlich bekommt), Werben-Karte (Link
mit Adresse; ältere Links ohne Adresse zahlen nichts), Hinweis unter dem
Werbelink, Vorschau unter dem Gebot („Provider mind. 94 %, Anteile höchstens
6 %“).

**Tests:** app +6 (453): `werbung.test.ts` (+3: Link, erster Werber, keine
untergeschobene Adresse, nie an sich selbst, in der Sicherung),
`relay-zahlziel.test.ts` (+3: nur wss, Betreiber und Adresse in
Pool-Reihenfolge, Fälschung und lokale Hosts zählen nicht, gemerkt einen Tag
bzw. eine Stunde, parallele Läufe, Profile offline). Verdrahtungstest
erweitert.

Endstand: protocol 1162 · node 225 · app 453 (+6) · mls 13 · Leak-Tests 57
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng 0
unbewertet · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 8.4c – Relay-Zugang in der App: anmelden und kaufen

**Anmelden (NIP-42)** – `WebSocketRelay` (`protocol/src/ws-relay.ts`):
- Verlangt ein Relay eine Anmeldung (`auth-required:` bei `CLOSED` oder `OK`),
  holt die Verbindung über `anmelden` ein signiertes Anmelde-Event.
- Danach sendet sie die abgewiesene Anfrage bzw. das Event einmal erneut.
- Einmal je Verbindung, nie von selbst. Liefert `anmelden` null, enden die
  Wartenden sofort statt in der Zeitgrenze.
- In der App (`shell/state.ts`, `relayVerbindung()`) nur bei eigenen Relays und
  solchen mit gekauftem Zugang (`darfAnmelden()`), über `signiere()`.
- Nie mit einem Sitzungsschlüssel – das verbände KI-Sitzung und Identität.

**Kaufen** – Settings → Verbindung → „Relay-Zugang kaufen“ (`relay-kauf.ts`):
- Der Preis kommt aus NIP-11. Die Kaufadresse gilt nur, wenn sie beim Relay
  selbst liegt; eine fremde bekäme Schlüssel und Geld.
- Das Angebot wird vor dem Zahlen geprüft: eigener Schlüssel, angekündigter
  Preis, Rechnung auf genau diesen Betrag.
- Gezahlt wird über die Zahlschienen. Bei SOL steht die Referenz nach Solana
  Pay als zusätzliches Konto im Transfer (`Zahlanfrage.referenz`, `buildSolTransfer`).
- Das Angebot ist gemerkt, bevor gezahlt wird. Bestätigt der Relay nicht
  sofort, lässt es sich später erneut prüfen.
- Ein Hinweis vor dem Kauf sagt, was der Betreiber sieht.

**Knoten:** Umschläge standardmäßig nur an angemeldete Empfänger
(`RELAY_UMSCHLAEGE_NUR_ANGEMELDET=0` schaltet ab).

**Datenschutz:**
- „relay-anmeldung“ belegt: neue Regel „anmeldung-nicht-offen“; das Szenario
  prüft, dass die App sich nur auf Verlangen und genau einmal anmeldet und die
  Anmeldung nie veröffentlicht.
- „relay-zugang“ als Grenze: Kaufen verrät dem Betreiber Schlüssel und IP,
  mit SOL auch die Absenderadresse.

**Website:** FAQ, Whitepaper („Relays werden direkt bezahlt“), Roadmap.

**Browser-Abnahme** (`scratchpad/relay_kauf_e2e.py`):
- **Aufbau:** echte Relay-Rolle, beschränkt und mit Kasse, TLS davor als
  `wss://relay.test`. Alle anderen Relays ersetzt ein Test-Relay, das
  Umschläge verwirft – Post kommt also nur über den Knoten.
- **Vor dem Kauf:** Bob nimmt den Relay in seinen Satz. Alice schreibt ihm –
  der Relay nimmt nichts an.
- **Kauf:** Bob fragt den Preis ab (30 Tage 1.000 sats, SOL-Knopf versteckt)
  und kauft mit Sats (WebLN-Attrappe): „Bezahlt – Zugang bis 27.10.2026“.
- **Nach dem Kauf:** Alice schreibt erneut – angenommen. Bob liest nur diese
  Nachricht, nicht die erste.
- Bob hat sich einmal angemeldet, Alice nie. Keine Seitenfehler. Nach dem Einmergen von 5.1.3a/b
  erneut bestanden.

**Beobachtet (Spur A, klein):** Veröffentlicht die App den eigenen Satz in
derselben Sekunde wie die automatische Liste, tragen beide Kind-10050-Events
dieselbe Zeit, und `posteingangVon()` nimmt irgendeine. Im Test umgangen
(zwei Sekunden warten); nach NIP-01 gewönne die kleinere Id.

**Tests:**
- protocol +1: Regel „anmeldung-nicht-offen“; dazu das Szenario im
  bestehenden Test.
- node +3: Client gegen die echte Relay-Rolle – nur auf Verlangen, einmal je
  Verbindung, Dauer-Abo; null bzw. fremder Schlüssel; Schreiben erst nach
  Anmeldung.
- app +5: NIP-11-Preise, Angebot prüfen, Kauf mit SOL samt Reihenfolge,
  Referenz in der Solana-Schiene, Verdrahtung.
- Der Verdrahtungstest aus 8.6c prüft jetzt `relayVerbindung(url, …)` statt
  `new WebSocketRelay(url, …)`.

Endstand (nach dem Einmergen von 5.1.3a/b): protocol 1163 (+1, 6 übersprungen) ·
node 227 (+3, 7 übersprungen ohne Netz) · app 458 (+5) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 6.4 – Verkehrsmuster: Kopien einzeln verzögert, Abrufe im Takt

Von Spur A übernommen (27.09.2026).

**Vorher:** Eine Direktnachricht ging als zwei bis vier Umschläge im selben
Augenblick hinaus (an den Empfänger, an sich selbst, an Geräte). Jeder trägt
einen Wegwerf-Schlüssel, aber ein Relay, das Posteingang beider Seiten ist, sah
zwei Umschläge gleichzeitig ankommen – und damit, wer mit wem schreibt.
Abfragen liefen in festen Rastern (60 s Posteingang, 30 s Räume, 120 s Urteile),
an denen man die App erkennt. FAQ und Whitepaper sagten dazu, Relays sähen,
welche Schlüssel miteinander schreiben – seit NIP-17 (2.1) stimmt das nicht
mehr, verschwiegen aber den Zeitpunkt.

**Jetzt:**
- **Protokoll `verkehr.ts`:**
  - `sichererZufall()` aus `crypto.getRandomValues`.
  - `zufallsVerzoegerung()` und `mitZufall()`.
  - `AbrufTakt`: gebündelte Abrufe, je Schlag ein neuer Zufallsabstand, `jedenNten`, Fehler einzeln geschluckt.
- **App `shell/versand.ts`:** jede Kopie mit eigener Verzögerung
  (`versendeVerzoegert()`), Standard bis 30 s. Einstellbar in Settings →
  Datenschutz: aus, 5 s, 30 s, 2 min.
- **Anzeige:** Im eigenen Verlauf steht die Nachricht sofort mit „· wird
  gesendet“, bis beide Kopien hinaus sind. Sie verschwindet aus der Liste
  „unterwegs“, sobald die eigene Kopie vom Relay zurück ist (Abgleich über die
  Id des inneren Events).
- **Verlassen der Seite:** Beim Verlassen (`pagehide`, Tab versteckt) geht alles
  Wartende sofort hinaus – lieber ein Muster als eine verlorene Nachricht.
  Scheitert ein verzögerter Versand, sagt es ein Hinweis.
- **Abruftakt:** etwa 30 s, 15–45 s mit Zufall. Private Räume jeden Schlag,
  Posteingang jeden zweiten, Urteile jeden vierten.
- **MLS** (445) bleibt sofort: ein Event je Nachricht, keine Kopien.
- **Mixnetz:** bewertet in `docs/MIXNET.md`. Nym geht im Browser nur über einen
  Exit, bräuchte weiteres WASM (CSP) und kostet NYM-Token – nicht jetzt. Später
  in den nativen Apps (6.1) neben Tor prüfen. Deckverkehr nicht ohne Absprache
  mit Relay-Betreibern.

**Datenschutz:** Aussage „versand-einzeln“ belegt (neue Regel
„kopien-entkoppelt“: zwei Umschläge innerhalb einer Sekunde sind ein Verstoß).
Szenario: dieselbe Funktion wie die App, fester Zufall. Ohne Verzögerung
meldet die Regel alle Kopien.

**Website:** FAQ („Kann jemand sehen, mit wem ich schreibe?“) und Whitepaper
(Grenzen: Metadaten) sagen jetzt, was verborgen ist und was bleibt.

**Browser-Prüfung** (`scratchpad/verkehr_e2e.py`, zwei Nutzer, Test-Relay mit
Ankunftszeiten):
- Standard 30 s.
- Die Nachricht steht sofort mit „wird gesendet“ im Verlauf; der Hinweis ist
  danach weg.
- Die zwei Kopien kamen 4,8 s und 16,5 s nach dem Senden an (11,7 s Abstand).
- Bob liest die Nachricht.
- Mit 2 min Verzögerung und verstecktem Tab gingen beide Kopien binnen 3 s
  hinaus.
- Keine Seitenfehler.

**Tests:**
- protocol +4: Zufallsverzögerung, Abstand, Takt, Regel.
- app +3: Einstellung, verzögerter Versand mit Zeitgeber-Attrappe, Verdrahtung.
- Drei Verdrahtungstests prüfen jetzt den verzögerten Versand bzw. den Abruftakt
  statt `await veroeffentlicheDm(…)` und `setInterval(…, 60_000)`: 8.6c,
  5.4a (Spur A), 4.9d. Ihre Absicht ist dieselbe: Kopien an die Person bzw.
  nur an den Posteingang, Posteingang etwa jede Minute.

Endstand: protocol 1167 (+4, 6 übersprungen) · node 227 (7 übersprungen ohne
Netz) · app 461 (+3) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 5.3a – Spiegel: Platzhalter, Quellen, Hosting-Anteil

Entscheidung MENSCH (27.09.2026): Die Konten legt der MENSCH an; bis dahin
Platzhalter, die sich einfach ersetzen lassen. 5.3 geteilt: **a** Platzhalter,
Quellen, Hosting-Anteil; **b** Upload-Skripte und CI-Job.

**Kontenliste** (`docs/KONTEN.md`): alle Konten, Wallets und Schlüssel, auf
die der Code wartet, je mit Zweck, Stelle im Code, Vorschlag zum Anlegen und
was zurückkommt. Nur öffentliche Werte gehen an den Agenten; Geheimes in die
GitHub-Secrets bzw. auf den GX10.

Die Einträge:
- **Spiegel:** Codeberg, IPFS, Arweave, Blossom, Torrent, .onion.
- **Hosting-Adressen**, **Release-Signierer**, **Entwicklung** (Spur A).
- **Test-Wallets**, **Relay-Domain** und **Radicle**.

**Platzhalter:** Werte beginnen mit `PLATZHALTER:`; `istPlatzhalter()` lässt
sie wie „nicht gesetzt“ gelten.
- `spiegel/quellen.json`: offizielle Adresse, Codeberg, .onion, Radicle.
- `spiegel/freedom-spiegel.json`: Hosting-Zahlziel, Lightning und SOL.

**Hosting-Anteil** (1 %, Entscheidung 4.0, Aufteilung von Spur A):
- Jede Auslieferung legt `freedom-spiegel.json` neben freedom.html.
- Die App liest die Datei von ihrer eigenen Herkunft (`hostingZahlziel()`,
  einmal je Sitzung) – dort ablegen kann nur der Betreiber des Spiegels. So
  bekommt jeder Spiegel seinen Anteil, ohne dass jemand eine Liste pflegt.
- Nur gültige Adressen zählen (`leseSpiegelDatei()` über `adresseFuer()`:
  Lightning-Adresse ohne lokalen Host, SOL-Adresse).
- Ohne Datei, lokal geöffnet oder mit Platzhaltern bleibt der Anteil beim
  Provider.
- `ki-zahlung.ts` (Spur A, eine Zeile) nimmt `hosting` in die Empfänger.

**Quellen:**
- `leseQuellen()` prüft die Form je Art (https, *.codeberg.page, v3-.onion,
  rad:, ipfs://, ar://, Blossom-Hash, Magnet).
- Die Startseite zeigt gesetzte Quellen und offene als „noch nicht
  eingerichtet“ (`build-site.sh`). Vorher stand dort „Alle Builds auch über
  IPFS/Arweave/Tor erreichbar“ – das stimmte nie.
- `publish-release.mjs` nimmt ohne `RELEASE_SOURCES` die gesetzten Quellen
  (vorher fest `freedomstack.io`).
- Der Build legt `freedom-spiegel.json` neben die App.

**App-Text:** Earn → „App verbreiten“ sagte „Eine Vergütung gibt es dafür
nicht“ – jetzt: mit `freedom-spiegel.json` 1 % jeder KI-Zahlung über die
eigene Kopie (Deutsch und Englisch).

**Tests:**
- protocol +4: Platzhalter, Spiegel-Datei, Quellen, die echten Dateien in
  `spiegel/` – jedes Feld Platzhalter oder gültig, damit ein Tippfehler beim
  Ersetzen auffällt.
- app +2: Zahlziel von der eigenen Herkunft, einmal je Sitzung, Platzhalter
  zählt nicht; Verdrahtung in Aufteilung, Build und Startseite.

Endstand: protocol 1171 (+4, 6 übersprungen) · node 227 (7 übersprungen ohne
Netz) · app 463 (+2) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 5.3b – Spiegel: Torrent, IPFS, CI-Job

5.3 ist dreigeteilt, damit jeder Teil unter etwa 400 Zeilen bleibt: **b**
Torrent, IPFS und der CI-Job; **c** Blossom, Arweave und Codeberg im selben Job.

**Torrent** (`baueTorrent()`, `protocol/src/spiegel-upload.ts`):
- `.torrent` für freedom.html; die Auslieferung selbst ist der Webseed
  (BEP 19). Laden geht so auch ohne Seeder.
- Der Magnet-Link nennt die .torrent-Datei (`xs`), weil ein Webseed allein
  keine Metadaten liefert.
- Ohne Zeitstempel und Programmnamen: Dieselbe Datei an derselben Adresse
  ergibt immer denselben Torrent.
- Der Infohash ist gegen create-torrent/parse-torrent geprüft.
- Jeder Bau legt `freedom.torrent` neben die App (`build-site.sh` mit
  `SPIEGEL_BASIS_URL` aus `actions/configure-pages`). Der Magnet-Link steht
  auf der Startseite.

**IPFS** (`ipfsCid()`):
- Der CID wird selbst gerechnet, wie `ipfs add --cid-version=1`: rohe Blätter
  zu 256 KiB, darüber UnixFS-Knoten (dag-pb), ausgeglichen, höchstens 174
  Verweise.
- Acht Fälle gleichen die Referenz ipfs-unixfs-importer (Kubo-Voreinstellungen):
  leere Datei, ein Blatt, zwei Ebenen, mehr als 174 Verweise.
- Wer den CID nachrechnet, braucht dem Pinning-Dienst nicht zu glauben.

**CI-Job `spiegel`** (`pages.yml`):
- Er läuft nur beim Release (*Run workflow* → „spiegeln“), nach dem Deploy,
  mit der eben veröffentlichten Seite. Bei jedem Push wäre es zu teuer
  (Arweave kostet je Upload).
- `scripts/mirror/spiegeln.mts` heftet die Datei bei Pinata an und übernimmt
  den CID nur, wenn Pinata denselben meldet – sonst wird der Job rot.
- Fehlt ein Secret, wird der Spiegel übersprungen, mit Grund.
- Meldungen der Dienste gibt der Job nie aus, nur den Status.
- Die Zusammenfassung nennt den Befehl für den GX10 (`ipfs pin add <cid>`).
- Das Ergebnis (`spiegel-ergebnis.json`) ist ein Artefakt.

**Release-Manifest:** `publish-release.mjs` nimmt mit `SPIEGEL_ERGEBNIS` die
Quellen des Laufs dazu (`quellenAusErgebnis()`), aber nur, wenn die Prüfsumme
zur selbst gebauten Datei passt, und nur in gültiger Form.

**Weitere Änderungen:**
- `check-wiring.py` zählt jetzt auch `.mts`-Skripte als Aufrufer (+1 Selbsttest).
- `leseQuellen()` nimmt auch CIDs einzelner Blätter (`bafk…`).
- `docs/KONTEN.md` beschreibt, wie ein Release gespiegelt wird.

Endstand: protocol 1176 (+5, 6 übersprungen) · node 227 (7 übersprungen ohne
Netz) · app 463 · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring
`--streng` Exit 0 (Selbsttest 6) · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden · `build-site.sh` mit `SPIEGEL_BASIS_URL`:
`freedom.torrent` + Magnet auf der Startseite.

## Schritt 5.3c – Spiegel: Blossom, Arweave, Codeberg

Der Job `spiegel` (`pages.yml`, nur beim Release) lädt jetzt zu allen Spiegeln
hoch. 5.3 ist damit im Code fertig; offen sind nur die Konten (MENSCH,
`docs/KONTEN.md`).

**Blossom** (A4):
- Eigener Spiegel-Schlüssel (`SPIEGEL_NSEC`, nsec oder Hex).
- Je Server eine Anmeldung nach BUD-02 nur für diese Datei (`blossomAuth()`):
  Kind 24242, `x` = Prüfsumme, zehn Minuten gültig; Kopf über `blossomKopf()`.
- Übernommen wird nur eine Beschreibung mit derselben Prüfsumme und einer
  https-Adresse in Quellen-Form (`blossomQuelle()`).
- Server kommen aus der Variable `BLOSSOM_SERVER` (nicht geheim), nur https.

**Arweave** (A3): über das vorhandene `@ardrive/turbo-sdk`, mit den Tags
Content-Type, App-Name und SHA-256. Der Test lief gegen einen Turbo-Ersatz:
Das SDK schickt das signierte Datenobjekt an `/v1/tx/arweave`, die Datei steht
darin am Ende.

**Codeberg** (A1):
- Die ganze Seite geht als Branch `pages`, erzwungen, ein Commit.
- Nutzer und Repository stehen in der Adresse aus `spiegel/quellen.json` –
  solange dort ein Platzhalter steht, wird Codeberg übersprungen.
- Das Token steht nur in der Umgebung von git (`GIT_CONFIG_*`), nie auf der
  Befehlszeile; ein Fehler gibt nur einen festen Text aus.

**Upload-Skript** `spiegeln.mts`, je Spiegel eine Funktion:
- Feste Texte nur über `Meldung`, sonst nur der Fehlername.
- Ein gescheiterter Spiegel färbt den Job rot; die anderen laufen weiter.

**Tests** (+2):
- Blossom-Bausteine.
- Das Skript gegen Ersatz-Dienste:
  - Der Blossom-Ersatz prüft die Anmeldung wie ein Server: Signatur, Kind,
    `x` = Prüfsumme des Körpers, Ablauf. Ein zweiter meldet eine falsche
    Prüfsumme – nicht übernommen, Job rot.
  - Der Turbo-Ersatz nimmt das Datenobjekt mit der Datei an.
  - Für Codeberg dient ein leeres git-Repository: Die Seite liegt im Branch
    `pages`.
  - Kein Geheimnis (nsec, Hex, JWK, Token, Basic-Kopf) steht in Ausgabe oder
    Ergebnis.
  - Kaputte Eingaben ergeben feste Texte.

Endstand: protocol 1178 (+2, 6 übersprungen) · node 227 (7 übersprungen ohne
Netz) · app 463 · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring
`--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5 Seiten ok ·
Smoke-Test bestanden.

## Schritt 8.16a – Übersetzungen: Grundlage und Rahmen

Entscheidung MENSCH (27.09.2026): Variante B – Deutsch und Englisch
vollständig, die sechs übrigen Sprachen fallen weg. 8.16 kommt in sechs
Teilschritten (Karte `phase-8.md`); dies ist der erste.

**Grundlage** (`app/src/i18n.ts`):
- Nur noch `de` und `en`; die Wörterbücher für es, fr, it, pt, zh und ja sind
  entfernt. Sie deckten rund 30 Texte ab, der Rest der Oberfläche war ohnehin
  deutsch.
- Die Texte stehen je Bereich in `app/src/texte/*.ts` (Rahmen, Agent,
  Kommunikation, Earn, Profil). Jeder Schlüssel trägt `{ de, en }` – fehlt
  eine Sprache, meldet es der Compiler. Weniger Konflikte mit Spur A, weil
  jeder Bereich eine eigene Datei hat.
- `t(schlüssel, werte)` setzt `{name}` ein. Unbekannte Schlüssel erscheinen
  sichtbar als sie selbst.
- `applyI18n()` setzt auch `data-i18n-title` und `data-i18n-aria`.
- Sprache beim Start: die gespeicherte Wahl, wenn es sie noch gibt
  (`gespeicherteSprache()` – ein bis 8.16 gewähltes „fr“ gilt nicht mehr),
  sonst die des Browsers (Deutsch → de, alles andere → en).
  `<html lang>` folgt.
- Zehn Schlüssel, die nirgends benutzt wurden, sind entfernt.

**Rahmen:**
- Kopfzeile (Tooltips), Navigation (sechs Tabs), Relay-Anzeige und Startbild
  laufen über Schlüssel.
- Das Wallet-Gate ist entfernt (HTML, Verdrahtung, CSS). Es wurde seit dem
  Wegfall des Logins nie gezeigt, trug eine doppelte `id="hero-gl"` und Texte,
  die `applyI18n()` wegen der Logos gar nicht übersetzen konnte.

**Tests** (`app/test/i18n.test.ts`, +6):
- Nur de/en; jeder Text in beiden Sprachen, nicht leer, mit denselben
  Platzhaltern, in genau einem Bereich.
- `t()` samt Werten; Spracherkennung und gespeicherte Wahl.
- Jeder Schlüssel aus `index.html` und jedes `t("…")` existiert, jeder Text
  wird benutzt.
- Rohtext-Suche (`test/i18n-rohtext.ts`, mit Negativprobe): Textknoten ohne
  `data-i18n` und Attribute ohne `data-i18n-*`, Eigennamen und Einheiten
  ausgenommen, je Bereich gezählt.
- `OFFEN`: der Rahmen steht auf 0. Offene Tabs dürfen nur sinken – Agent 60,
  Kommunikation 41, Währung 39, Earn 27, Profil 23, Settings 118.

**Smoke-Test:**
- Alle Kontexte laufen mit `locale="de-DE"`, weil die Prüfungen deutsche
  Texte lesen.
- Neue Prüfung „sprache“:
  - deutscher Browser → „Kommunikation“, „Guthaben“;
  - englischer Browser → „Chat“, „Balance“;
  - gespeichertes „fr“ → Englisch, gespeichertes „de“ → Deutsch.

## Schritt 8.16b – Übersetzungen: Zählung im Code

Grundlage für die Übersetzung der Texte, die der Code zeichnet.

**Rohtext im Code** (`app/test/i18n-rohtext.ts`, `rohtexteImCode()`):
- Die Suche liest String-Literale samt verschachtelter Vorlagen (`${…}`).
- Als Text zählt: zwei Wörter, ein Umlaut, ein großgeschriebenes Wort,
  Text mit „…“; in HTML-Vorlagen der Text zwischen den Tags und
  `title`/`placeholder`/`aria-label`.
- Nicht gezählt werden:
  - Selektoren, Speicher-Schlüssel, Imports, Konsole;
  - Klassennamen, Tastennamen, HTTP-Kopfzeilen;
  - Zeilen mit `// kein UI-Text` (Daten, die so gesendet oder gespeichert
    werden).
- Negativprobe im Test.

**Tabelle** (`app/test/i18n-offen.ts`):
- `OFFEN_HTML` je Bereich und `OFFEN_CODE` je Datei, relativ zu `src/`.
- Eine Datei, die dort fehlt, muss 0 haben – auch jede neue, auch von Spur A.
- Offene Zahlen dürfen nur sinken; eine gestrichene Datei meldet der Test.

**Messung:** 1.069 Texte in 68 Dateien plus 308 in `index.html` – rund
1.300 statt der geschätzten 400–500. Mit der Grenze von etwa 400 geänderten
Zeilen je Schritt werden es etwa zwölf Teilschritte (a–l, Karte
`phase-8.md`) statt sechs.

**Dazu:**
- `gebietsschema()` (`i18n.ts`): `de-DE` bzw. `en-US` für Zahlen und Daten –
  die Teilschritte ersetzen damit das feste `"de-DE"`.
- Ein Sprachwechsel zeichnet den offenen Tab neu (`switchTab()`), damit auch
  vom Code gezeichnete Texte folgen.

**Tests** (`i18n.test.ts`, +3):
- Suche im Code (Probe mit 15 Zeilen).
- Zählung im Code je Datei.
- `gebietsschema()` und Neuzeichnen beim Sprachwechsel.
- Verdrahtet: die Uhrzeit der Raumnachrichten (`tabs/kommunikation.ts`) nutzt
  schon `gebietsschema()`.

Endstand: protocol 1178 (6 übersprungen) · node 227 (7 übersprungen ohne
Netz) · app 472 (+3) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden.

## Schritt 8.16c – Übersetzungen: Kommunikation

**Fertig: Kommunikation.** Seite (`index.html`) und Code
(`tabs/kommunikation.ts`) stehen auf 0 rohen Texten; die Datei ist aus
`OFFEN_CODE` gestrichen.

**Seite:** Leiste, Direktnachrichten, Ablauf-Auswahl, Räume und Mitglieder
laufen über Schlüssel, ebenso Tooltips und aria-Beschriftungen.
- „New message“/„New community“ waren im deutschen Standard englisch – jetzt
  in beiden Sprachen richtig.
- `#space-name` trägt seinen Platzhalter in einem eigenen `<span>`, damit ein
  Sprachwechsel den gezeigten Raumnamen nicht überschreibt.

**Code:** Räume, Moderation und Meldungen, Einladungen, Direktnachrichten,
Hinweise zur Verschlüsselung (NIP-17/MLS), Anhänge, Schlüsselwechsel und
Dialoge laufen über Schlüssel.
- Rund 130 Schlüssel `komm.*` in `texte/kommunikation.ts`. Werte werden
  eingesetzt (`{n}`, `{name}`, `{grund}` …), statt Sätze zusammenzukleben;
  Einzahl und Mehrzahl haben eigene Schlüssel.
- Daten eines öffentlichen Raums (Kanal- und Rollennamen, die veröffentlicht
  werden) tragen `// kein UI-Text`.
- Die Markierung „(alter Schlüssel)“ steht im gespeicherten Namen einer
  Unterhaltung. Sie wird in beiden Sprachen erkannt (`ALT_MARKE`), auch nach
  einem Sprachwechsel.
- Die Namen „Anfrage · …“ entstehen in der Sprache, die beim Eintreffen gilt.
- Texte in HTML-Vorlagen laufen über `escapeHtml(t(…))`.

**Tests:**
- +1 in `i18n.test.ts`: Kommunikation fertig; Markierung in beiden Sprachen;
  Einzahl, Mehrzahl und Werte.
- Drei ältere Tests prüfen Schlüssel und Text am neuen Ort (nicht schwächer):
  - `mls-verdrahtung`: MLS-Hinweis, „Anfrage“;
  - `raeume-privat`: Hinweis „Öffentlicher Raum“;
  - `leak/raum`: Warnung vor öffentlichen Räumen.
- innerHTML-Ausnahmeliste: Die Faden-Vorlage ist angepasst (Variable `faden`
  statt `t`, das jetzt die Übersetzung ist); zwei Einträge entfallen, weil die
  Zahlen jetzt in `escapeHtml(t(…))` stehen.
- Die Smoke-Prüfung „sprache“ liest zusätzlich den Zurück-Knopf des Chats
  („‹ Zurück“/„‹ Back“).

## Schritt 5.1.4a – Gebührenmodell A+: Protokoll und Knoten aufgeräumt

5.1.4 ist geteilt (mehr als 400 Zeilen): **a** Protokoll und Knoten, **b** App
und Texte (Werben-Tab, `referral*.ts`, `reward-claim.ts`, `protocol-fee.ts`,
`fee-proof.ts`, Website, PROTOCOL.md). `protocol-fee.ts` und `fee-proof.ts`
bleiben bis b stehen: Die Werbe-Stufen der App rechnen noch mit der alten
Protokollgebühr, und die Aufgabe „erster Job“ (Abzeichen) liest Gebühren-Belege.

**Entfernt (nichts im echten Pfad nutzte sie noch):**
- `treasury.ts`, `treasury-sweep.ts`, `arweave-mirror.ts`: wöchentliche
  Entwickler-Adressen, Sweep zur Haupt-Wallet, Arweave-Spiegel der Ansage
  (Kind 38050); im Knoten der Sweep und der Spiegel. Alte Variablen
  (`SWEEP_TARGET_WALLET`, `ARWEAVE_MIRROR`) lösen eine Warnung aus.
- `rewards.ts`: Pool, Rangliste nach Punkten, anteilige Ausschüttung.
- `client-fee.ts`: App-Gebühr – geht seit 5.1.3 im Entwicklungsanteil auf.
- `scarcity.ts`: Knappheitsbonus, Stoßzeit-Faktor, Topf-Verteilung. Die
  Regionen (`computeRegionStats`, `normalizeRegion`, `whereIsCapacityNeeded`
  jetzt mit „fehlen bis Ziel“ statt Bonus-Faktor) bleiben für die
  Abdeckungskarte.
- `protocol-fee.ts`: Treasury-Schlüssel und die Platzhalter-Adresse bei einem
  Verwahrer (`SET_BEFORE_MAINNET@…`).
- `packages/website/freedom.html`: eine alte App-Kopie aus der Übergabe;
  veröffentlicht wurde sie nie (`build-site.sh` nimmt den Build). Jetzt in
  `.gitignore`; `check-website.py` prüft den Link gegen den Build.
- Launcher: Platzhalter ohne Verwahrer-Adresse.
- Gebühren-Karte: Hosting geht seit 5.3a an den Spiegel (`freedom-spiegel.json`)
  – „Hosting folgt“ stimmte nicht mehr.
- Demo `run-full.ts`: Schritt 5 zeigt die Aufteilung A+; Rangliste und
  Ausschüttung entfallen.

**Abnahme der Karte:** `grep -rn "walletofsatoshi\|TREASURY_\|SET_BEFORE_MAINNET"
packages/` ist leer (auch im Build). Tests, die das Fehlen prüfen, schreiben das
Muster mit Zeichenklasse.

**Tests (entfernt, je mit ihrer Funktion):** protocol −49 – Treasury 9, Arweave 5,
Knappheitsbonus 15 (die 5 Regionstests bleiben, die Empfehlung prüft jetzt
„fehlen“), Pool/Rangliste 5 (`value-layer`), App-Gebühr 15 (`pricing-clientfee`,
die Preistests bleiben); node −1 (App-Gebühr gedeckelt).

Endstand (nach Einmergen von main mit 5.3 und 8.16): protocol 1129 (−49,
begründet) · node 227 (−1, begründet) · app 473 · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng 0 unbewertet · Website 5 Seiten ok · Smoke-Test bestanden ·
Demo `demo:full` läuft.

## Schritt 8.16d1 – Übersetzungen: Agent (Seite und agent.ts)

**Fertig:** Die Agent-Seite in `index.html` – Aufgaben, Prüfaufträge,
Reklamationen, Modelle, Kataloge, Repos, Eingabe, Werkzeuge, Arbeitsbereich –
und `tabs/agent.ts` stehen auf 0 rohen Texten. Rund 150 Schlüssel `agent.*`
in `texte/agent.ts`.

**Einzelheiten:**
- **Eigene Meldungen:**
  - `EigeneMeldung` kennzeichnet Fehler, die die App selbst schon übersetzt
    wirft (kein Provider, Max, Swarm, kein privater Provider).
  - `explainError()` gibt sie unverändert weiter.
  - Die übrigen Muster für technische Meldungen stehen jetzt als Regexe da,
    nicht als Texte.
- **Beispiel-Prompts:** Die Knöpfe tragen `data-prompt-key` – der gesendete
  Prompt folgt der Sprache, nicht nur die Beschriftung.
- **Werkzeug- und Anhangknöpfe:** Die Beschriftung steht in einem eigenen
  `<span data-i18n>` neben dem Symbol; der Preis (`.tool-preis`) bleibt
  daneben.
- **Listen, die der Code füllt:** Der Platzhalter „lade …“ steht in einem
  `<span>` und wird beim Füllen ersetzt, nicht beim Sprachwechsel
  überschrieben.
- **Anteile einer Antwort:** `ANTEIL_NAME` verweist auf Schlüssel.
  `satText()` rechnet mit `gebietsschema()`.
- **Geändert bei der Gelegenheit:**
  - „copy last/copy all“ und „Ask the network…“ standen im deutschen Standard
    englisch.
  - Nach einem Auftrag hieß der Sendeknopf „Anfragen“ statt wie vorher
    „Senden“ – jetzt überall derselbe Schlüssel.
- **Kein UI-Text:**
  - `"no keypair"` wird nur zugeordnet.
  - `pruefer.art === "eigener Provider"` vergleicht einen Wert aus
    `streitfall.ts`, der mit 8.16d2 eine Kennung bekommt.
  - `" je Aufruf"` ist die Trennmarke der Werkzeugpreise (8.16d2).
- **Rohtext-Suche:** Text in `<code>` (Befehle) und „HD“ zählen nicht.
- **Neuzeichnen:** Der Browser-Test zeigte, dass Verlauf und Budget nach
  einem Sprachwechsel in der alten Sprache blieben. `switchTab("ai")` zeichnet
  beide jetzt beim Öffnen neu.
- **innerHTML-Ausnahmeliste:** Fünf Einträge für `agent.ts` sind an die neuen
  Ausdrücke angepasst, fünf entfallen, weil die Werte jetzt in
  `escapeHtml(…)` stehen.

**Tests:**
- +1 in `i18n.test.ts`: Agent fertig; `EigeneMeldung`; Beispiel-Prompts über
  Schlüssel; Englisch mit Werten.
- Der Test „jeder Text wird benutzt“ kennt `data-prompt-key`.
- Zwei ältere Tests prüfen den Schlüssel am neuen Ort (nicht schwächer):
  - `preis-anzeige`: Schätzung;
  - `zahlung-pruefen`: Aufteilung, der Text „kein Empfänger – beim Provider“
    im Wörterbuch.
- Die Smoke-Prüfung „sprache“ liest zusätzlich „Neue Aufgabe“/„New task“.

Endstand: protocol 1178 (6 übersprungen) · node 227 (7 übersprungen ohne
Netz) · app 474 (+1) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden (inkl. „sprache“ mit dem Agent) · im
Browser: Agent und Kommunikation in Englisch, nach dem Wechsel in Deutsch.

## Schritt 5.1.4b – Gebührenmodell A+: Earn-Tab ohne Topf und Stufen

5.1.4 dreigeteilt: a Protokoll und Knoten (#126), **b Earn-Tab und Werben**, c
Gebühren-Beleg, alte Protokollgebühr, Aufgaben-Topf, Website, PROTOCOL.md.

**Earn-Tab (`tabs/earn.ts`, `index.html`, `app.ts`):**
- „Belohnungen abholen“ entfernt: Der Antrag (Kind 38013) forderte eine
  Auszahlung aus einem Pool an, den es seit A+ nicht gibt – niemand zahlte.
- „Rangliste“ im Werben-Tab entfernt: Sie rechnete aus Selbstauskünften
  (38010) Ränge und Stufen (Karte 5.1 Punkt 3).
- Werbe-Stufen („Bronze“ …) und der Rechner „Was wäre wenn …“ entfernt. Der
  Werben-Tab zeigt den Link, wie viele Geworbene dich öffentlich nennen, und
  dass der Verdienst direkt in der eigenen Lightning-Wallet ankommt – die App
  erfährt ihn nicht.
- Die Vertrauensstufe im Profil bleibt: Sie entspricht der Reputation, nach
  der die App Provider auswählt (5.5, bei Spur B zurückgestellt).

**Protokoll:** `referral.ts` (Stufen, Topf-Anteile, Hochrechnung),
`referral-graph.ts` (zweite Ebene, Kette, Übersicht) und `reward-claim.ts`
entfernt, dazu `KIND_REWARD_CLAIM`. Die Nennung (Kind 38052) bleibt in
`werbe-nennung.ts`: bauen, lesen und `zaehleNennungen()` – nur gültig
signierte Angaben, je Geworbenem die früheste, keine Selbstwerbung.

**Ausnahmelisten:** Verdrahtung – 8 veraltete Einträge raus; `payoutAddress`
(`profile.ts`) war nie aufgerufen: Bis jetzt zählte eine gleichnamige Variable
im Belohnungsantrag als Aufruf, jetzt steht es ehrlich als Ausnahme da.
innerHTML – 8 Einträge der entfernten Rangliste und Stufen raus.

**Tests:** protocol −39: entfernt `referral.test.ts` (22) und
`referral-graph.test.ts` (17) mit ihren Modulen, 3 Tests zum Belohnungsantrag
(`ticker-claim-relay`); neu `werbe-nennung.test.ts` (+3: Roundtrip und Unsinn,
früheste Angabe je Geworbenem, Fälschungen zählen nicht). app +1: Earn-Tab ohne
Antrag, Rangliste, Stufen, Rechner; Zählung verdrahtet.

Endstand: protocol 1090 (−39, begründet) · node 227 · app 474 (+1) · mls 13 ·
Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 5.1.4c – Gebührenmodell A+: Gebühren-Beleg, alte Protokollgebühr, Aufgaben-Topf

5.1.4c war mit den Texten zusammen über 400 Zeilen – geteilt: **c Code**,
d Texte (Website samt Dashboard, PROTOCOL.md §3/§13/§15/§16).

**Gebühren-Beleg (`fee-proof.ts`, Kind 38051) entfernt:** Der Knoten
veröffentlicht seit 5.1.2 keinen, die App prüft seit 5.1.3 keinen. Wer wem
zahlte, belegt heute die eigene Wallet: Lightning über Preimage und die vom
Empfängerknoten signierte Rechnung, Solana über die Kette
(`pruefeSolUeberweisung()`, Trinkgeld-Belege und Relay-Kasse). `preimageMatches()`
lebt weiter in `bolt11.ts` – `rails.ts` belegt damit Lightning-Zahlungen.
Kinds 38050/38051 sind in `kinds.ts` als „nicht wiederverwenden“ vermerkt.

**Alte Protokollgebühr (`protocol-fee.ts`) entfernt:** 2,5 % als Pool und
Werbe-Pool – abgelöst durch `aufteilung.ts`. Mit ihr fallen der CI-Schritt
„Fee-Konstanten sind in sich stimmig“ (die Aufteilung A+ prüft ihr eigener
Schritt) und der Knoten-Test „Fee-Konstanten“.

**Aufgaben (`quests.ts`) nur noch Abzeichen:** Topf, Anschub, Deckel,
Tragfähigkeit und Auszahlungsentscheidung (`questBudgetFor`, `sustainability`,
`decidePayout`, `maxCostPerParticipant`, `QUEST_SHARE_OF_POOL_PERCENT`,
`BOOTSTRAP_FLOOR_MSAT`, `HARD_CAP_PER_EPOCH_MSAT`) entfernt, ebenso
`rewardMsat` im Katalog: Mit A+ gibt es keinen Pool, aus dem Prämien kämen.
Die Aufgaben „Erster bezahlter Job“ und „1.000 sats umgesetzt“ lasen die
Gebühren-Belege – entfernt. Das Profil (`tabs/profil.ts`) fragt 38051 nicht
mehr ab; verdiente Abzeichen kommen weiter aus den Leistungsnachweisen.

**Ausnahmeliste Verdrahtung:** 10 Einträge raus (fee-proof 5, protocol-fee 1,
quests 4).

**Tests:** protocol −34: `fee-proof.test.ts` (16) mit dem Modul, davon
`preimageMatches` nach `bolt11.test.ts` verschoben und um den positiven Fall
erweitert (+1); `quests.test.ts` −19 (Prämien-Staffel, Topf, Anschub, Deckel,
Tragfähigkeit, Auszahlung, die vier Umsatz-Tests aus Gebühren-Belegen); der
Test „Sicherung ist die erste Aufgabe“ prüft jetzt zusätzlich, dass keine
Aufgabe einen Betrag trägt und der Topf nicht zurückkehrt. node −1 (alte
Fee-Konstanten). app +1: Profil ohne 38051.

Endstand: protocol 1056 (−34, begründet) · node 226 (−1, begründet) · app 475
(+1) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring `--streng`
Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 5.1.4d – Gebührenmodell A+: Texte und letzte Reste

Letzter Teil von 5.1 (c Code, **d Texte**). Damit ist 5.1 im Code fertig;
offen bleibt nur MENSCH: Adressen der Entwicklung (`ENTWICKLUNG`) und der
Testnet-Test der Zahlung.

**Website:**
- Startseite (de/en): Die Aufteilung 94 / 2,5 / 1,5 / 0,5 / 0,5 / 1 ersetzt
  „2,5 % Protokoll, 2,5 % App, abschaltbar“.
- FAQ:
  - Kosten nach A+, mit dem Hinweis, dass die Entwicklung noch keine Adresse
    hat und SOL bis zum Zahlkanal ganz an den Provider geht;
  - „Woher weiß ich, wohin mein Geld geht?“ statt Fee-Beweis;
  - Reward-Pool gibt es nicht mehr;
  - Verdienen ohne Knappheitsbonus, Aufgaben nur als Abzeichen;
  - Werben: eine Ebene je Seite über den Werbelink;
  - Entwicklungsanteil statt abschaltbarer App-Gebühr.
- Whitepaper: Anreize, Gebühren-Tabelle, Begründung und Invariante 6 („nicht
  Zuordenbares an den Provider, nie an die Entwicklung“ – geprüft von
  `aufteilung.test.ts`).
- Roadmap: Beleg-Prüfung durch Aufteilung ersetzt; Gebühren als entschieden
  eingetragen.
- Dashboard:
  - Die Werber-Rangliste mit Stufen wird zur bloßen Zählung der Nennungen
    (früheste je Geworbenem, wie `zaehleNennungen()`).
  - Der Vergütungsfaktor der Regionen wird zu „fehlen bis 5“ (wie
    `whereIsCapacityNeeded()`).
  - Der Fee-Beweis-Zähler ist entfernt.
  - Die Anmerkung sagt jetzt, dass Zahlungen nur die Beteiligten sehen und
    dass die Seite keine Signaturen prüft.
  - Im Browser gegen einen nachgestellten Relay geprüft: keine Fehler.

**`check-website.py`:** Die neue Liste `VERALTET` weist Aussagen des alten
Modells ab (Protokollfee, App-Gebühr, Reward-Pool-Anteil, Fee-Beweis,
„bis zum Dreifachen“, Stufen-Code). Gegen die alten Seiten gelaufen: 12
Treffer; gegen die neuen: 0.

**PROTOCOL.md:**
- §3 beschreibt A+: Anteile in ppm, Regeln, Deklaration, Bündeln, Grenzen.
  Das Fee-Modell v1 ist als Historie vermerkt, samt der Lehre aus dem
  ppm-Fehler.
- §4: 38011/38012, 38013, 38050/38051 und 38053 als nicht mehr belegt,
  38052 neu eingetragen; nicht mehr belegte Arten werden nicht
  wiederverwendet.
- §13: Werben eine Ebene je Seite, Regionen ohne Aufschlag, Aufgaben als
  Abzeichen.
- §15: Werbe-Nennung statt Graph.
- §16: Verteiler entfernt; die Lehren bleiben für gesponserte Pools.

**Letzte Reste im Code:** `buildSeasonDef` (Saison mit Pool-Regeln, 38012)
und `buildRewardPayout` (Ausschüttungsnachweis, 38011) in `performance.ts`
entfernt. Beide waren nie verdrahtet und ohne Tests. Die Verdrahtungs-
Ausnahmen gehen um 2 Einträge zurück.

Endstand: protocol 1056 · node 226 · app 475 · mls 13 · Leak-Tests 57 grün +
1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website 5 Seiten ok (mit Prüfung auf veraltete Aussagen) · Website-Bau ok ·
Smoke-Test bestanden.

## Schritt 4.3a – Solana-Zahlkanal: Format und Client

4.3 ist geteilt (mehr als 400 Zeilen): **a Format und Client**, b Programm mit
Tests gegen den Validator, c Knoten, d App.

**Format (`docs/ZAHLKANAL.md`):**
- Konto `Channel`: PDA aus `["channel", Kunde, Provider, nonce]`, 429 Bytes,
  höchstens 8 Empfänger.
- Anweisungen `open`, `settle` (Ed25519-Anweisung direkt davor, alle Offsets
  auf sie selbst), `refund` (ab Ablauf, schließt das Konto) und `top_up`.
- Gutschrift, 71 Bytes: Präfix `freedomstack-channel-v1`, Kanal-Adresse,
  Betrag (u64 LE), Ablauf (i64 LE). Die Gutschriften sind kumulativ.
- Aufteilung on-chain: abgerundet, der Rest geht an den Provider. Ergänzt
  gegenüber der Karte: Ist ein Empfängerkonto ausführbar oder bliebe es unter
  der Mietbefreiung, geht dessen Anteil an den Provider. Sonst könnte ein
  leeres Konto jede Abrechnung blockieren (A+: nicht Zuordenbares an den
  Provider).

**Client (`packages/protocol/src/channel.ts`):**
- `kanalAdresse()`, `gutschriftNachricht()`, `neuerSitzungsSchluessel()`,
  `signiereGutschrift()`.
- `pruefeGutschrift()`: Kanal, Ablauf, Signatur, steigend, höchstens die
  Einlage.
- `pruefeKanalEmpfaenger()`: höchstens 8, je mindestens 1 ppm, zusammen
  höchstens 10 % wie `MAX_ANTEILE_PPM`.
- Anweisungen `oeffneKanalIx()`, `rechneKanalAbIxs()` (Ed25519 plus settle),
  `erstatteKanalIx()`, `stockeKanalAufIx()`.
- `leseKanal()` und `teileKanalZahlung()`.
- Läuft im Browser: `DataView`, `@noble` (schon Abhängigkeit), keine
  Node-Module.
- Programm-ID: ein Platzhalter aus den 32 Bytes von
  „freedomstack-channel-platzhalter“. Zu dieser Adresse gibt es keinen
  Schlüssel; den echten trägt der MENSCH beim Deploy ein.

**Werkzeug für 4.3b geprüft:**
- Agave 1.18 (cargo 1.75) und 3.0 (cargo 1.84) scheitern an der Lock-Datei
  des HTLC-Programms (edition2024).
- Agave 3.1.10 (platform-tools v1.52, Rust 1.89) baut es: 220 KB, deployt
  waren 217 KB mit v1.53.
- `solana-test-validator` läuft in der Umgebung und lädt das Programm.

**Ausnahmen Verdrahtung:** 12 Exporte von `channel.ts`, bis 4.3c/d.

**Tests:** protocol +8 (`channel.test.ts`):
- Format mit festen Bytes;
- PDA;
- Gutschrift: gültig, sowie Replay aus einem anderen Kanal (auch
  umetikettiert), gleicher oder niedrigerer Betrag, über der Einlage, anderer
  Ablauf, fremder Schlüssel und kaputte Signatur;
- `open` nach Borsh, mit Empfänger-Grenzen;
- `settle` mit Ed25519-Offsets und Konten-Reihenfolge;
- `refund` und `top_up`;
- Konto lesen, samt abgelehnten fremden und kaputten Konten;
- Aufteilung auf den Lamport.

Endstand: protocol 1064 (+8) · node 226 · app 475 · mls 13 · Leak-Tests 57
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 4.3b – Solana-Zahlkanal: Programm und Tests gegen den Validator

**Programm (`contracts/solana-channel/`, Anchor 0.30.1):**
- `open`:
  - Einlage vom Kunden in den Kanal-PDA.
  - Prüft Betrag > 0, Ablauf in der Zukunft, höchstens 8 Empfänger mit je
    ≥ 1 ppm und zusammen ≤ 10 %, und dass kein Empfänger der Kanal selbst ist.
- `settle`:
  - Nur der Provider, nur vor Ablauf.
  - Die Ed25519-Anweisung direkt davor wird über das Instruktions-Sysvar
    gelesen: genau eine Signatur, alle Offsets auf sich selbst, Schlüssel =
    Sitzungsschlüssel, Nachricht = Gutschrift. Die Signatur selbst verwirft
    die Laufzeit.
  - Ausgezahlt wird `min(Gutschrift, Einlage) − ausgezahlt`. Die Empfänger
    kommen in der Reihenfolge des Kanals und müssen schreibbar sein; sonst
    behielte der Provider ihren Anteil.
  - Den Anteil eines ausführbaren oder leeren Kontos, das unter der
    Mietbefreiung bliebe, bekommt der Provider.
- `refund`: nur der Kunde, ab Ablauf; schließt das Konto (Rest und Miete an
  den Kunden).
- `top_up`: nur der Kunde, vor Ablauf.
- Fehler-Enum `KanalFehler`: neue Varianten nur ans Ende.
- Programm-ID: Platzhalter aus 4.3a.

**Tests (`tests/kanal.test.ts`, 6 gegen `solana-test-validator`, mit dem
Client `channel.ts`):**
1. `open`: Konto nach Format. Zu hohe Anteile, Betrag 0 und ein Ablauf in
   der Vergangenheit scheitern am Programm selbst (am Client vorbei).
2. Mehrere Gutschriften, `settle` mit der letzten: Aufteilung auf den
   Lamport. Das leere Empfängerkonto bekommt nichts, sein Anteil geht an den
   Provider. Alle Gebühren zahlt ein eigenes Konto, damit die Beträge
   Lamport-genau bleiben.
3. Gleiche und niedrigere Gutschrift scheitern; eine höhere zahlt nur die
   Differenz. Falsche oder fehlende Empfänger scheitern.
4. Diese Fälle scheitern jeweils:
   - falsche Signatur;
   - gültig signiert von einem fremden Schlüssel;
   - ohne Ed25519-Anweisung;
   - Replay einer Gutschrift aus einem zweiten Kanal mit demselben
     Sitzungsschlüssel;
   - fremder Provider.
5. `top_up`: Die Einlage steigt. Eine Gutschrift über der Einlage zahlt nur
   bis zur Einlage; `top_up` durch Fremde scheitert.
6. `refund` vor Ablauf scheitert, `settle` nach Ablauf scheitert, `refund`
   durch Fremde scheitert. `refund` danach gibt Einlage und Miete zurück; das
   Konto ist geschlossen.

**Ausführen:**
- `contracts/solana-channel/pruefen.sh` baut mit `cargo-build-sbf`, prüft
  die Typen und lässt die Tests laufen. `--werkzeuge` lädt vorher
  Agave 3.1.10.
- Ohne Validator überspringen die Tests mit Grund. Mit
  `KANAL_TESTS_PFLICHT=1` (`pruefen.sh`, CI) ist Überspringen ein Fehler –
  gegengeprüft.
- CI: `.github/workflows/zahlkanal.yml`, nur bei Änderungen an Programm,
  Client oder Format, mit Zwischenspeicher für die Werkzeuge.
- Lokal: Bau 58 s, Tests 14 s, alle 6 grün.

**Gelernt:**
- Die Websocket-Bestätigungen des Validators laufen auf RPC-Port + 1; der
  Faucet gehört woandershin.
- Ed25519 signiert deterministisch: Dieselbe Gutschrift zweimal ist dieselbe
  Transaktion, und web3.js wartet dann auf einen neuen Blockhash. Ein eigenes
  Rechenlimit je Versuch macht sie verschieden.
- Ein leeres Provider-Konto lehnt kleine Auszahlungen ab (Mietbefreiung);
  steht jetzt in `docs/ZAHLKANAL.md`.

Endstand: protocol 1064 · node 226 · app 475 · mls 13 · Zahlkanal 6 (neu,
gegen Validator) · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring
`--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten ok ·
Smoke-Test bestanden.

## Schritt 8.16e – Übersetzungen: Agent-Rest, Währung, Zahlwege und Swaps

**Fertig:** Der erste größere Schritt (MENSCH 27.09.: größere Pull Requests
für die Übersetzung erlaubt). Auf 0 rohen Texten stehen:
- die Währung-Seite in `index.html`;
- 29 Dateien: Agent-Rest (`agent-netz.ts`, Streitfall, Prüfaufträge,
  Werkzeugpreise, Kataloge, KI-Zahlung), Währung (`tabs/waehrung.ts`,
  eingebaute Wallet, offline zahlen, Zahlschienen) und alle Zahlwege und Swaps
  (`swap-client.ts`, `sol-htlc.ts`, `rueck-swap.ts`, `rails.ts`,
  `sol-wallet.ts`, `solana-connect.ts`, `wallet-standard.ts`, Zap-Dialog,
  Belege, Preise, RPC-Stichprobe, Relay-Kauf, Rückhol-Wächter …).

Neu sind die Bereiche `texte/waehrung.ts` (`waehr.*`, rund 170 Schlüssel) und
`texte/zahlung.ts` (`zahl.*`, rund 190); `texte/agent.ts` wächst um rund 75.

**Einzelheiten:**
- **Deutsche Sätze aus dem Protokoll:** Die App zeigte fertige Texte des
  Protokolls an. Jetzt bildet sie diese aus den Feldern neu:
  - Verfügbarkeit der Modelle über `modellNotiz()` aus Seedern und fehlenden
    Dateien, wie `buildRegistry()` bewertet;
  - Reklamationsgründe über `GRUND_TEXT` statt `DISPUTE_LABEL`;
  - Kurswarnungen aus Quellen und Streuung (weicht ihre Zahl ab, gelten die
    des Protokolls – keine Warnung geht verloren);
  - der Zahlungshinweis aus `isMobile`/`webln`;
  - die Prüfung vor dem Tausch über `tauschPruefung()` mit denselben
    Einzelprüfungen (`checkReuse`, `checkAmount`, `checkTiming`).
    `swapPrivacyCheck()` steht dafür mit Begründung in
    `wiring-ausnahmen.txt`.
- **Prüfer hat eine Art:** `Pruefer.art` ist `kontakt` oder `provider`
  (vorher der Text „eigener Provider“). Angezeigt wird die Art über
  `PRUEFER_ART`; der Vergleich in `agent.ts` braucht kein `// kein UI-Text`
  mehr. Die Werkzeugpreise liefern den Preis am Knopf direkt, ohne
  Trennmarke „ je Aufruf“.
- **Knöpfe, deren Text der Code ändert** („Verbunden“, „+ SOL hinterlegen“),
  tragen den neuen Schlüssel in `data-i18n` – ein Sprachwechsel setzt sie
  nicht zurück.
- **Zahlen und Zeiten mit `gebietsschema()`:** Swap-Fristen, Deposit,
  Gebühr in Prozent, Lightning-Guthaben, Offline-Nonce.
- **Geändert bei der Gelegenheit:**
  - „deposit“/„refund“, „provider pubkey (auto)“ und „SOL address“ standen im
    deutschen Standard englisch.
  - Umlaute in Swap-Meldungen („Pruefe“, „einloesen“) sind korrigiert.
  - „Nicht verbunden“ unter Solana blieb nach dem Verbinden stehen – jetzt
    verborgen.
  - Die Nachfrage zur öffentlichen SOL-Adresse spricht von „dieser Person“.
- **Kein UI-Text:**
  - der Verlaufs-Präfix für das Modell (`ki-kontext.ts`) – er geht ans
    Modell;
  - die Rechnungsbeschreibung „FreedomStack: Tausch SOL → sats“;
  - die Notiz „Relay-Zugang“ einer Zahlanfrage.
- **Noch unverändert (8.16g):** Gründe, die Prüfungen des Protokolls liefern
  und die App in einen übersetzten Satz einsetzt (z. B.
  `validateReverseTimelock`, `pruefeSolUeberweisung`, Hinweise der
  RPC-Stichprobe).
- **innerHTML-Ausnahmeliste:** Drei Einträge für `waehrung.ts` entfallen.
  Die Werte stehen jetzt in `escapeHtml(…)` bzw. gehen über `textContent`.

**Tests:**
- +1 in `i18n.test.ts`:
  - alle 29 Dateien fertig und ohne `"de-DE"`;
  - keine deutschen Protokolltexte mehr in der Anzeige;
  - Modellnotiz, Reklamation, Prüfer-Art, Tausch-Prüfung, HTLC-Fehler, nächster
    Schritt, Kurszeile (auch Rückfall), Preise und Werkzeugpreis auf Englisch;
  - Zahlenformat auf Deutsch.
- 23 ältere Testdateien prüfen Meldungen weiter wörtlich auf Deutsch. Sie
  stellen dafür `setLang("de")` ein – nicht schwächer.
- Sechs Quelltext-Prüfungen suchen den Schlüssel an der neuen Stelle
  (Kataloge, Stichprobe ×2, Rück-Swap ×2, eingebaute Wallet); der
  Prüfer-Test erwartet die Art `provider`.
- Die Smoke-Prüfung „sprache“ liest zusätzlich den Deposit-Knopf
  („hinterlegen“/„deposit“).

Endstand: protocol 1064 (6 übersprungen) · node 225 (7 übersprungen ohne
Netz) · app 477 (+1) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden (inkl. „sprache“ mit dem Deposit-Knopf) ·
im Browser: Währung-Seite samt Meldungen aus dem Code in Englisch, nach dem
Wechsel in Deutsch, ohne Seitenfehler.

## Schritt 8.16f – Übersetzungen: Earn, Profil, Settings

**Fertig:** Earn, Profil und Settings – Seiten, `tabs/earn.ts`, `tabs/profil.ts`,
`tabs/settings.ts`, `tabs/repos.ts` und `repo-ansicht.ts` – stehen auf 0 rohen
Texten. Damit ist **ganz `index.html` fertig** (alle Bereiche 0). Neu ist der
Bereich `texte/settings.ts` (`set.*`, rund 220 Schlüssel); `texte/earn.ts` und
`texte/profil.ts` wachsen um die Seiten, Repos (`repo.*`) und die
Protokoll-Sätze.

**Einzelheiten:**
- **Sätze des Protokolls (`protokoll-texte.ts`, neu, ohne DOM):**
  - Die App bildet diese Sätze aus den Feldern in der Sprache der Oberfläche
    nach:
    - Repo-Zustand (`healthNote`) und Verteilung der Arbeit (`busFactor`);
    - Ebenen, Zellenstufen, „Abdeckung hier“ und die Einwilligung vor dem
      Eintragen (`coverageConsentText`);
    - Profil-Offenlegung und Bildwarnung;
    - Titel, Beschreibung und Stand der Aufgaben;
    - Herkunft der Abzeichen.
  - Ein Test vergleicht jede deutsche Fassung wortgleich mit dem Protokoll –
    jeder Client zeigt dieselbe Warnung.
  - `badgeSourceLabel`, `coverageConsentText` und `profileDisclosure` stehen
    als deutsche Referenz in `wiring-ausnahmen.txt`.
- **Protokoll (klein, andere Spur berührt):** `QuestProgress` hat einen
  Zählerstand `zaehler: { ist, soll }`. So bildet die Oberfläche „7 von 7
  Tagen.“ in ihrer Sprache. Das Feld ist nur zusätzlich, kein Event-Format;
  der Test in `quests.test.ts` ist erweitert.
- **Profil:**
  - Die Warnfarbe der Offenlegung hängt am Befund (fremder Server), nicht mehr
    am Text „IP-Adresse“.
  - Stilwerte (`messing`, `schlicht` …) gehen weiter so ins Profil; angezeigt
    werden sie über Schlüssel.
  - Vertrauensstufe: Die Startwerte „0 XP · 0 jobs · free“ stehen als „—“, bis
    der Code sie füllt.
- **Settings:**
  - Reiter, Überschriften, Karten, Knöpfe, Platzhalter und `aria-label` gehen
    über `data-i18n`.
  - Der Sprachknopf zeigt beim Start das Kürzel; im HTML steht ein neutrales
    „🌐 ▾“ mit Beschriftung.
  - Gerätestatus über `GERAET_STATUS`.
  - Die Ersatzschlüssel-Datei kommt in der Sprache der Oberfläche.
  - `"de-DE"` ist durch `gebietsschema()` ersetzt.
- **Rohtext-Suche:**
  - Klassenlisten als Argument (`el("div", t, "mono-sm muted")`) und
    Selektoren mit Typparameter (`querySelectorAll<HTMLElement>(…)`) zählen
    nicht mehr.
  - Im HTML gelten Adress-Schemata (`wss://…`, `bunker://…`) und „Bluetooth“
    als Eigennamen.
  - Beides steht in der Probe des Tests.
  - Dadurch sanken auch offene Dateien (`shell-logic.ts`, `app.ts`,
    `nachfolge-ui.ts`, `notfall.ts`, `mesh-transfer.ts`).
- **Neuzeichnen:** Der Browser-Test zeigte, dass „Abdeckung hier“, die
  Profil-Offenlegung und die Stilnamen nach einem Sprachwechsel in der alten
  Sprache blieben.
  - Das Öffnen von Profil zeichnet sie jetzt neu (`zeigeProfilTexte()`).
  - Earn lädt die Abdeckung neu; der Standort-Hinweis steht sofort da, ohne
    auf die Relays zu warten.
- **Noch unverändert (8.16g):** Die Sätze des Protokolls in Settings –
  Nachfolge-Stand und -Warnung, `backupInfo`, Schlüsselwechsel, Gerätewarnung,
  Echtheit und Fixierung, Offline-Fähigkeiten, Tor-Reihenfolge – und die
  Meldungen der Bausteine `mesh-radio.ts`, `mls-engine.ts`, `relay-satz.ts`
  und `geraete-modus.ts`.
- **innerHTML-Ausnahmeliste:**
  - Fünf Einträge sind an die neuen Ausdrücke angepasst.
  - Sechs entfallen, weil die Werte jetzt in `escapeHtml(t(…))` stehen.

**Tests:**
- +1 in `i18n.test.ts`:
  - Earn, Profil und Settings fertig, alle Bereiche von `index.html` auf 0;
  - keine deutschen Protokoll-Sätze mehr in der Anzeige;
  - jede nachgebildete deutsche Fassung wortgleich mit dem Protokoll;
  - Englisch mit Werten.
- Vier ältere Tests suchen die neue Stelle (nicht schwächer):
  - `abdeckung`: Einwilligung über `abdeckungEinwilligung`;
  - `versand`: Option mit Attribut;
  - `einrichtung`: Werben-Text;
  - `geraete-modus`: Gerätecode.
- Die Smoke-Prüfung „sprache“ liest zusätzlich die Überschrift
  „Sicherheit“/„Security“.

Endstand: protocol 1064 (6 übersprungen) · node 225 (7 übersprungen ohne
Netz) · app 478 (+1) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden (inkl. „sprache“ mit Settings) · im Browser:
Earn, Profil und Settings in Englisch, nach dem Wechsel in Deutsch – samt
Abdeckung, Offenlegung und Stilnamen –, ohne Seitenfehler.

## Schritt 4.3c1 – Solana-Zahlkanal: Kasse des Knotens

4.3c ist geteilt: **c1 Kasse** (dieser Schritt), c2 Verdrahtung in
`dvm-provider.ts` und `main.ts`.

**Transport und Vorauszahlung (`docs/ZAHLKANAL.md`, `channel.ts`):**
- Die Gutschrift reist als Tags `["kanal", …]` und `["gutschrift", Betrag,
  Ablauf, Signatur]` im versiegelten Kern der Anfrage (`gutschriftTags()`,
  `leseGutschriftTags()`).
- Sie muss decken, was schon abgerechnet ist, plus das Gebot dieser Anfrage.
  Der Provider arbeitet so nie ungedeckt.
- Der Kunde riskiert höchstens Gebot minus Preis des letzten Auftrags, denn
  eingelöst wird die höchste Gutschrift. Das steht im Dokument.

**Kasse (`packages/node/src/kanal-kasse.ts`):**
- `nimmAn()`:
  - Kanal auf der Kette: Konto des Kanal-Programms, Provider = eigene
    Adresse, mindestens 1 h Laufzeit.
  - Neu gelesen wird nur, wenn der Kanal unbekannt ist oder die Gutschrift
    über der bekannten Einlage liegt (Aufstockung).
  - Gutschrift über `pruefeGutschrift()`; dieselbe noch einmal ist erlaubt.
  - Deckung: abgerechnet + Gebot.
- `verbuche()`: höchstens bis zur Gutschrift.
- `loeseFaelligeEin()`:
  - Eingelöst wird ab 0,01 SOL offen oder 30 Minuten vor Ablauf, mit
    Ed25519-Anweisung und Empfängern.
  - Fehler nur als Name.
  - Abgelaufene Kanäle fallen weg und werden gemeldet, wenn Geld offen war.
- Stand in einer Datei (Zwischendatei, 0600).
- Doppeltes Einlösen ist unmöglich: Das Programm lehnt eine gleiche
  Gutschrift ab.

**Tests:**
- node +6 (`kanal-kasse.test.ts`): Konto-Prüfungen, Gutschrift und Deckung,
  Aufstockung, Einlösen (Schwelle, Vorlauf, nie zweimal), Fehler und Ablauf,
  Neustart aus der Datei.
- protocol +1 (Tags hin und zurück, kaputte Form).
- Zahlkanal +1 gegen den Validator: Die Kasse des Knotens nimmt an, bucht
  und löst gegen das Programm ein, Lamport-genau (97,5 % Provider, 2,5 %
  Werber), nicht zweimal. Eine fremde Kasse lehnt ab.
- Die CI (`zahlkanal.yml`) läuft jetzt auch bei Änderungen an der Kasse.
- Nachtrag: Nach dem Einmergen von `main` lief der CI-Job bis zu seinem
  Limit (45 Min). Das Log zeigt: alle 7 Tests grün, danach verband sich der
  Websocket der Bestätigungen einmal je Sekunde neu (`ws error:
  ECONNREFUSED`, 2.620-mal). `close()` hielt ihn nicht an, weil er gerade neu
  verband oder web3.js ihn für ein offenes Abo wieder aufbaute
  (`max_reconnects: Infinity`). Jetzt: `setAutoReconnect(false)` vor
  `close()`, dazu `--test-force-exit` und ein Zeitlimit je Test in
  `pruefen.sh`. Gleich mit geschlossen: Stirbt der Validator mitten im Lauf,
  wartete web3.js endlos auf Bestätigungen (`getBlockHeight` scheitert und
  zählt als -1). Jetzt scheitern die Tests sofort, mit dem Ende von
  `validator.log` (`solangeValidator()`). Gegenprobe: Validator nach 5, 7 und
  9 s beendet – der Lauf endet nach 5–10 s rot, mit Grund.

Endstand: protocol 1065 (+1) · node 232 (+6) · app 475 · mls 13 ·
Zahlkanal 7 (+1, gegen Validator) · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten
ok · Smoke-Test bestanden.

## Schritt 8.16g1 – Übersetzungen: Einstieg und Dialoge

**Fertig:** Einstieg und Dialoge stehen auf 0 rohen Texten, neuer Bereich
`texte/einstieg.ts` (`ein.*`, rund 230 Schlüssel). Dazu gehören:
- Führung (`onboarding.ts`) und Start, Sicherungsdialog, Import, Menü (`app.ts`);
- Identität (`identity.ts`) und Tresor (`tresor.ts`, `vault.ts`);
- Nachfolge als Vertrauter (`nachfolge-ui.ts`, `nachfolge.ts`);
- Notfall-Löschung, Bunker, Einrichtung beim ersten Start;
- Zustand und UI-Hilfen (`state.ts`, `ui.ts`, `shell-logic.ts`);
- Geräte (`geraete-buch.ts`, `geraete-modus.ts`), eigener Relay-Satz,
  Versand und lokale Suche.

Offen bleiben 13 Dateien für 8.16g2 (Datenschutzbericht, Mesh, MLS,
Werkzeuge, Shims) und die Sätze des Protokolls, die die App noch unverändert
zeigt.

**Einzelheiten:**
- **Notfall-Löschung:**
  - Die Rückfrage mit dem rechtlichen Hinweis bildet `protokoll-texte.ts`
    nach (`loeschRueckfrage()`). Ein Test hält die deutsche Fassung
    wortgleich mit `wipeConfirmation()`; die steht als deutsche Referenz in
    `wiring-ausnahmen.txt`.
  - Bestätigt wird mit LÖSCHEN (auch LOESCHEN) oder – wie der englische
    Platzhalter sagt – DELETE.
- **Ehrliche Texte:**
  - Die alte Meldung beim Export eines Raums („Räume sind noch nicht
    verschlüsselt (2.3)“) stimmte seit 2.3 nicht mehr. Jetzt: Räume gehen
    (noch) nicht als Datei oder über Funk, nur 1:1-Unterhaltungen.
  - Der Satz „In unterversorgten Regionen gibt es einen Aufschlag“
    (`pitchFor("verdienen")`) stimmte seit 5.1.4 nicht mehr – den
    Knappheitsbonus gibt es nicht. Jetzt: Wo erst wenige Provider arbeiten,
    hilft ein neuer Knoten am meisten (so zählt es `scarcity.ts`).
- **Zahlen und Zeiten:** `fmtSats()`, `fmtSol()`, `ago()` und die Trefferliste
  der Suche nehmen `gebietsschema()` statt `"de-DE"`.
- **Sprachwechsel:** Die Onboarding-Leiste zeichnet sich nach einem Wechsel
  neu, wie der offene Tab.
- **Sprache vor dem Entsperren (vom Smoke-Test gefunden):** `setLang()` lief
  erst in `starte()`, also nach dem Entsperr-Dialog und der Meldung nach einer
  Notfall-Löschung. Beide wären immer englisch gewesen; die Smoke-Prüfungen
  „tresor“ und „notfall“ warteten vergeblich auf „falsch“. Jetzt setzt
  `boot()` die Sprache zuerst; ein Test hält die Reihenfolge fest.
- **Code-Blöcke** in Antworten: „kopieren“/„kopiert“ in der Sprache der
  Oberfläche.
- **Namen lokaler Variablen:** Wo ein lokales `t` die Übersetzung verdeckt
  hätte (`toast()`, Relay-Eingabe, Gerätecode, Suchindex, RPC-Prüfung),
  heißt es jetzt anders.
- **innerHTML:** Der Sicherungsdialog setzt die Nummer der abgefragten Wörter
  über `escapeHtml(t(…))` – eine Ausnahme weniger. Die Begründung für die
  Tresor-Dialoge nennt die neuen Einsetzungen (nur `escapeHtml(t(…))`).
- **Noch unverändert (8.16g2):** Gründe aus Prüfungen des Protokolls, die
  in fertigen Dateien durchgereicht werden: `isPlausibleRelayUrl` (Relay-Satz),
  `darfUebergeben` und `evaluateSuccession` (Nachfolge), `absenderPerson` und
  `listDevices().message` (Geräte).
  Ebenso `OFFLINE_HINWEIS` und die Datenschutz-Aussagen in der Einrichtung
  (`datenschutzKurz()` aus `PRIVACY_FACTS`).

**Tests:**
- +1 in `i18n.test.ts`:
  - alle 19 Dateien fertig, kein `"de-DE"`;
  - die Rückfrage vor dem Löschen deutsch wortgleich, englisch übersetzt;
  - Bestätigungswort, Onboarding-Leiste beim Sprachwechsel;
  - `boot()` setzt die Sprache vor dem Entsperren.
- +1 in `shell-logic.test.ts`: Ein böser Dateiname in der Meldung über einen
  abgelehnten Link wird maskiert.
- Deutsch gesetzt (`setLang("de")`), weil sie Meldungen wörtlich prüfen:
  - `identity`, `vault`, `mls-speicher`, `shell-logic`;
  - `geraete-buch`, `geraete-modus`, `relay-satz`;
  - `bunker`, `onboarding`, `rohschluessel`, `suche`.
- Zwei ältere Tests suchen die neue Stelle (nicht schwächer):
  - `rpc-stichprobe`: Variable `probe`;
  - `einrichtung`: Importfrage über `t("ein.importFrage")`. Dazu prüft der
    Test, dass die Frage in beiden Sprachen alle vier Formen nennt.
- Die Smoke-Prüfung „sprache“ liest zusätzlich den Titel des
  Sicherungsdialogs („Deine Wiederherstellungs-Phrase“/„Your recovery
  phrase“).
- +1 in `onboarding.test.ts`: Der Pitch verspricht keinen Aufschlag oder
  Bonus (Deutsch und Englisch).

Endstand: protocol 1064 (6 übersprungen) · node 225 (7 übersprungen ohne
Netz) · app 481 (+3) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden (inkl. „sprache“ mit Sicherungsdialog,
„tresor“, „notfall“) · im Browser: Sicherungsdialog, Einrichtung und
Onboarding-Leiste in Deutsch und Englisch, nach einem Sprachwechsel folgt die
Leiste, ohne Seitenfehler.

## Schritt 8.16g2a – Übersetzungen: übrige Bausteine, Zählung streng

**Fertig:** Die letzten 13 Dateien mit rohem Text stehen auf 0, neuer Bereich
`texte/bausteine.ts` (`bau.*`, 56 Schlüssel). Das sind:
- lokale Werkzeuge (`local-tools.ts`);
- Mesh (`mesh-radio.ts`, `mesh-transfer.ts`): Wege zum Gerät, Namen der
  Transporte, Warteschlange, Protokollzeilen;
- MLS (`mls-engine.ts` samt Selbsttest, `mls-keypackage.ts`,
  `mls-speicher.ts`, `mls-nostr.ts`, `shell/mls-konto.ts`);
- private Räume (`shell/raum-mls.ts`);
- die eigenen Hinweise im Datenschutzbericht (`shell/datenschutz.ts`);
- die Shims.

**Damit ist die Zählung streng:** kein roher Text in `index.html` und in
keiner Datei des Codes. Die Tabelle der offenen Stellen
(`test/i18n-offen.ts`) ist gelöscht.

**Einzelheiten:**
- **Kennungen bleiben Daten:**
  - `mlsLadeEin()` gibt weiter „kein Admin“, „kein KeyPackage“, „nicht
    zugestellt“ zurück (Typ `EinladungsErgebnis`). `ladeInPrivatenRaum()`
    meldet „ohne Raumstand“ statt eines deutschen Satzes.
  - Angezeigt wird über `einladungsText()`. Eine Fehlermeldung, die keine
    Kennung ist, bleibt, wie sie ist.
- **Selbsttest der MLS-Engine:** Er erkannte fehlende Browser-Fähigkeiten an
  `startsWith("Dieser Browser")` – auf Englisch wäre das still falsch
  gewesen. Jetzt gibt es eine eigene Fehlerart `BrowserKannNicht`.
- **Daten mit `// kein UI-Text`:**
  - Kanal- und Rollennamen privater Räume (wie bei offenen Räumen seit
    8.16c);
  - Anweisung an das Modell und der Werkzeug-Kontext (`local-tools.ts`);
  - die Kennung „Ignored“ der Engine;
  - Name und Probe des Selbsttests.
- **Shims:** Ihre Meldungen sind Programmierfehler, die im Browser nie
  auftreten. Sie tragen `// kein UI-Text`.
- **Sprachwechsel:** Der Hinweis zum Weg ans Funkgerät (Settings → Mesh) stand
  nur einmal beim Start da. Jetzt setzt ihn `zeigeMeshWeg()` beim Öffnen der
  Settings neu.
- **Noch unverändert (8.16g2b):** Sätze und Gründe des Protokolls.
  - Datenschutzbericht: `privacyReport()`, `privacyFactsText()`,
    `datenschutzKurz()`.
  - Mesh: `planSync().note`, `pruefeMeshInhalt().grund`.
  - Prüfungen und die Sätze in Settings, wie in 8.16g1 aufgezählt.

**Tests:**
- `i18n.test.ts`:
  - die beiden Zähltests sind streng (überall 0, keine Tabelle); die
    Schritt-Tests prüfen je Datei direkt `rohtexteImCode(…) = 0`;
  - +1 für 8.16g2a: Einladungstext (Kennung → Anzeige, Fehlermeldung
    bleibt), `BrowserKannNicht` statt Textvergleich, Transport-Hinweise
    (auch beim Öffnen der Settings), Werkzeug-Gründe und Selbsttest auf
    Englisch.
- Deutsch gesetzt (`setLang("de")`), weil sie Meldungen wörtlich prüfen:
  `local-tools`, `mls-engine`, `mls-keypackage`, `mls-konto`.
- Ältere Tests suchen die neue Stelle (nicht schwächer):
  - `local-tools`: „verfügbar“ mit Umlaut;
  - `mls-verdrahtung`: `return t("bau.mlsTresor")`.

Endstand: protocol 1064 (6 übersprungen) · node 225 (7 übersprungen ohne
Netz) · app 482 (+1) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden · im Browser: Settings in Englisch und
Deutsch – Weg ans Funkgerät (folgt dem Sprachwechsel), MLS-Selbsttest
„passed“/„bestanden“ – ohne Seitenfehler; der Text des Datenschutzberichts
ist noch deutsch (8.16g2b).

## Schritt 4.3c2 – Solana-Zahlkanal: im Knoten verdrahtet

**Knoten (`dvm-provider.ts`):**
- Eine Anfrage mit `["kanal", …]` und `["gutschrift", …]` wird nur
  versiegelt angenommen, nie offen.
- Abgelehnt wird sie in folgenden Fällen:
  - ohne Kasse;
  - in der Bootstrap-Phase;
  - ohne SOL-Kurs;
  - mit A+-Deklaration – im Kanal teilt das Programm auf, sonst würde doppelt
    gezahlt;
  - mit einem Gebot unter dem Mindestgebot.
- Deckung: Gebot plus Höchstkosten der angefragten Werkzeuge in Lamports,
  über `KanalKasse.nimmAn()`.
- Abgerechnet wird wie beim Gebot, höchstens das Gebot plus Werkzeuge (auch
  im Swarm-Pfad).
- Der Preis wird in Lamports gebucht, bevor die Antwort hinausgeht.
- `providerMsat` ist der Teil nach den Empfängern des Kanals.

**Protokoll:**
- Das Ergebnis trägt `amount_lamports` auch ohne `solana_address`, denn im
  Kanal ist schon bezahlt.
- Das Angebot (`tiers.ts`) nennt `["kanal", Adresse, Programm]`; fremde
  Angaben gelten nur mit zwei gültigen Solana-Adressen.

**Start (`main.ts`, `kanalKasseAusUmgebung()`):**
- Nur mit `ZAHLKANAL=1` und einem Schlüssel aus `SOLANA_KEYPAIR`, der zu
  `NODE_SOL_ADDRESS` passt. Sonst nähme der Knoten Gutschriften an, die er
  nie einlösen kann.
- Die Datei liegt unter `~/.freedom/kanaele.json`.
- Eingelöst wird alle 5 Minuten mit Vorabsimulation, nie zwei Durchgänge
  zugleich; ins Log kommen nur Kanal, Betrag und Fehlername.
- Schwelle, Vorlauf und Mindestlaufzeit sind per Umgebung einstellbar.
- `docker-compose.yml` nennt die Einstellungen.
- Solange das Programm nicht deployt ist, gehört kein Konto dem Platzhalter,
  also nimmt der Knoten keine Kanäle an.

**Tests:**
- node +3:
  - Kanal-Auftrag gedeckt: Preis unter dem Gebot, Provider-Teil 488 von 500,
    5.000 Lamports gebucht, Antwort versiegelt mit `amount_lamports`,
    nichts offen; eine zweite Anfrage ungedeckt, danach mit höherer
    Gutschrift wieder gedeckt.
  - Ungedeckt, offen, ohne Kasse, mit Deklaration, Gebot zu niedrig, über
    der Einlage, kaputte Signatur: jeweils nichts gerechnet und nichts
    gebucht.
  - Setup aus der Umgebung (aus, Adresse fehlt, Schlüssel fehlt, passt
    nicht, passt) und die Verdrahtung in `main.ts`.
- protocol +1: Angebot mit Kanal, Unsinn fällt weg.
- Verdrahtungs-Ausnahmen `leseGutschriftTags` und `teileKanalZahlung` raus.

Endstand: protocol 1066 (+1) · node 235 (+3) · app 483 · mls 13 · Zahlkanal 7
(gegen Validator) · Leak-Tests 57 grün + 1 todo · 0 rot · check-wiring
`--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten ok ·
Smoke-Test bestanden.

## Schritt 8.16g2b1 – Übersetzungen: Datenschutzbericht

**Fertig:** Der Datenschutzbericht (Settings → Datenschutz) und die Seite
„privat“ der Einrichtung stehen in der Sprache der Oberfläche. Neu sind der
Bereich `texte/datenschutz.ts` (`ds.*`, 102 Schlüssel) und
`app/src/datenschutz-bericht.ts` (ohne DOM). Das Protokoll bewertet weiter:
- `auditPrivacy()` liefert Befunde und Reihenfolge,
- `summarizePrivacy()` Punktzahl und Zählung,
- `faktenDieserSitzung()` die Aussagen.

Die App bildet die Sätze über Kennungen:
- `berichtText()` wie `privacyReport()`,
- `faktenText()` wie `privacyFactsText()`,
- `faktAussage()` für einzelne Aussagen (auch in `datenschutzKurz()`).

**Einzelheiten:**
- **Protokoll (klein, andere Spur berührt):**
  - `PrivacyFinding` hat eine feste Kennung `id` je Befund und Fassung,
    17 Stück, z. B. `ip-klar`, `ip-tor`, `ip-mixnet`. Das Feld ist nur
    zusätzlich, kein Event-Format.
  - Die deutschen Sätze in `privacy-audit.ts` haben echte Umlaute statt
    „ae/oe/ue“ („Größter Gewinn“ statt „Groesster Gewinn“). Die Tests dort
    ließen beide Schreibweisen schon zu.
- **Wortgleich:** Ein Test vergleicht die deutsche Fassung
  - des Berichts für alle 1.536 Kombinationen der Einstellungen,
  - der Aussagen für jedes Ergebnis der .onion-Prüfung.

  Jede Kennung aus dem Protokoll muss einen Text haben, sonst ist der Test
  rot. Eine unbekannte Kennung zeigt zur Laufzeit die deutschen Sätze des
  Protokolls statt nichts.
- `privacyReport`, `kurzfassung` und `privacyFactsText` stehen als deutsche
  Referenz in `wiring-ausnahmen.txt`.
- **CLAUDE.md, Fallstrick „Datenschutzbericht“:** Eine neue Aussage oder ein
  neuer Befund braucht einen Text in `datenschutz-bericht.ts`.

**Tests:**
- +1 in `i18n.test.ts`:
  - deutsch wortgleich (Bericht und Aussagen);
  - jede Kennung mit Text, alle 17 Fassungen der Befunde gesehen;
  - Englisch: Kopf, Befund, größter Gewinn, Lücke mit Hinweis, Grenze,
    geprüfte IP, kein deutscher Buchstabe.
- `einrichtung`: Deutsch gesetzt (die Seite „privat“ prüft wortgleich).
- `onion-pruefung`: sucht die neue Stelle (`faktenText(tor)`, darin
  `faktenDieserSitzung(tor)`) – nicht schwächer.

Endstand: protocol 1064 (6 übersprungen) · node 225 (7 übersprungen ohne
Netz) · app 483 (+1) · mls 13 · Leak-Tests 57 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng 0 unbewertet · Website 5
Seiten ok · Smoke-Test bestanden · im Browser: Datenschutzbericht und die
Seite „privat“ der Einrichtung in Englisch und Deutsch, ohne Seitenfehler.

## Schritt 4.3d1 – Solana-Zahlkanal: Gutschriften und Rückholen in der App

4.3d ist geteilt, damit die App nie einen Kanal öffnen lässt, den sie noch
nicht nutzt: **d1** Logik und Verdrahtung (dieser Schritt, ohne neue
Oberfläche), **d2** Öffnen, Übersicht, Texte und Datenschutz-Aussage.

**Kanal-Buch (`app/src/zahlkanal.ts`):**
- Im Tresor unter `freedom.kanaele` (in `GEHEIM_FEST`), nie in der Sicherung
  (`SICHERUNG_NIE`): Kanal, Provider, Ablauf, Einlage, Sitzungsschlüssel,
  letzte Gutschrift, Summe der Preise, Anfragen ohne Antwort.
- Gutschrift je Anfrage: `max(letzte, Basis + Bedarf)`, höchstens die Einlage.
  - Die Basis ist die Summe der Preise aus den Antworten.
  - Fehlt zu einer Anfrage die Antwort, ist die Basis die letzte Gutschrift.
    Sonst deckte die nächste nicht, wenn der Provider gebucht hat, und der
    Kanal hinge. Verlieren kann der Kunde höchstens das Gebot einer Anfrage
    ohne Antwort.
  - Bedarf: Gebot plus Werkzeuge zum Kurs aus dem Angebot des Providers (mit
    dem prüft der Knoten), plus 2 % Spielraum.
  - Genutzt wird ein Kanal nur mit mindestens zwei Stunden Restlaufzeit.
- Antwort: Preis (`amount_lamports`) verbucht, höchstens bis zur letzten
  Gutschrift; ohne gültigen Preis zählt die ganze Gutschrift.

**Verdrahtung:**
- `buildJobEvent()` (`shell/tabs/agent.ts`):
  - Mit Kanal zum Provider trägt die Anfrage die Gutschrift statt der
    Deklaration, vor dem Versiegeln, und keine Sitzungs-Tags.
  - Gemerkt wird sie, bevor die Anfrage hinausgeht.
  - Deckt der Kanal nicht oder fehlt der Kurs, geht nichts hinaus – nie still
    über Lightning.
- `handleAnswer()`: Antworten über den Kanal zahlt Lightning nicht; die App
  verbucht nur den Preis. Ob eine Anfrage über den Kanal lief, steht auch im
  Speicher (`perKanal()`), damit ein gesperrter Tresor keine zweite Zahlung
  auslöst.
- Rückhol-Wächter (`refund-watcher.ts`): Sperren der Art `kanal`.
  - Offen ist ein Kanal, solange sein Konto beim Programm liegt.
  - `refund` mit der verbundenen Wallet als Kunde, mit Vorabsimulation.
  - Kanäle einer anderen Wallet: keine Transaktion, Grund genannt.
- Leak-Regel `keine-zahlungsdaten` kennt jetzt das Tag `gutschrift`.
- `check-wiring.py`: Der Zahlkanal darf wie HTLC und Swap eigene Anweisungen
  senden (Treuhand, keine Überweisung). Drei Ausnahmen raus
  (`erstatteKanalIx`, `gutschriftTags`, `signiereGutschrift` sind verdrahtet).

**Tests:**
- app +10 (`zahlkanal.test.ts`):
  - Bedarf (Rundung, Spielraum);
  - Gutschrift erst Bedarf, dann Preis + Bedarf, nie unter der letzten; jede
    Gutschrift so geprüft wie im Knoten (`pruefeGutschrift`);
  - ohne Antwort vorsichtig; Preis fehlt, zu hoch oder negativ;
  - kein Kanal, fremder Provider, zu kurz, erschöpft;
  - kaputte Einträge;
  - Rückholen gegen eine nachgestellte Kette (offen, fremdes Programm, fremde
    Wallet), der Wächter reicht die Art weiter;
  - Verdrahtung in `agent.ts`, `ki-zahlung.ts`, Tresor und Sicherung.
- Leak +1: Anfrage mit Gutschrift nur als Umschlag, weder Kanal noch Signatur
  offen; Gegenprobe: offen meldet die Regel die Gutschrift.
- Zwei Verdrahtungstests nachgezogen (Deklaration oder Gutschrift vor dem
  Versiegeln; Gedächtnis im Tresor) – sie prüfen dasselbe wie vorher.

Endstand: protocol 1066 · node 235 · app 493 (+10) · mls 13 · Zahlkanal 7 ·
Leak-Tests 58 grün (+1) + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 4.3d2 – Solana-Zahlkanal: Kanal öffnen in der App

Mit diesem Schritt ist 4.3 im Code fertig. Offen ist nur der MENSCH-Teil:
Devnet-Deploy des Programms, dann ein KI-Auftrag über den Kanal.

**Öffnen (`shell/zahlkanal-ui.ts`, Karte „Zahlkanal (SOL)“ im Währungs-Tab
neben dem Deposit):**
- Nur mit verbundener Wallet. Nur, wenn der Provider im Angebot einen Kanal bei
  genau diesem Programm nennt und das Programm auf der Kette liegt – bis zum
  Deploy also nie.
- Empfänger: die Anteile nach A+ mit SOL-Adresse (`kanalEmpfaenger()` in
  `aufteilung.ts`), Relays wie bei Lightning höchstens drei, doppelte
  Adressen zusammengefasst, Provider und Kunde selbst nie.
- Reihenfolge: Tresor → Kanal-Buch (Sitzungsschlüssel) → Sperre für den
  Wächter → Einzahlung (`planeKanal()`, `sendeMitWallet()`, mit
  Vorabsimulation). Scheitert die Einzahlung und zeigt die Kette keinen Kanal,
  fliegt er aus dem Kanal-Buch – sonst trügen weitere Anfragen Gutschriften
  für einen Kanal, den es nicht gibt.
- Die Rückfrage nennt Betrag, Provider, Sperrfrist, die Zahl der Empfänger und
  dass Kanal, Einlage und Einlösungen öffentlich auf der Kette stehen.
- Übersicht: je Kanal Einlage, was noch frei ist, Ablauf; seit 30 Tagen
  abgelaufene fallen weg. Nur über `textContent`.
- Während der Einzahlung sperrt der Tresor nicht (`geldVorgangLaeuft()`).
- Laufzeit 1, 7 oder 30 Tage. Aufstocken bietet die App nicht an.

**Datenschutzbericht:** neue Grenze „zahlkanal“ – auf der Kette stehen die
zahlende SOL-Adresse, die des Providers, Einlage, Ablauf, Empfänger und jede
Einlösung; die Gutschriften reisen nur versiegelt (Regel
`keine-zahlungsdaten`). Texte in Deutsch und Englisch.

**Tests:**
- protocol +1: `kanalEmpfaenger()` (nur SOL-Adressen, Relays, doppelte,
  Provider und Kunde nie).
- app +4:
  - Plan nach `docs/ZAHLKANAL.md` (Adresse, Anweisung, der gemerkte
    Schlüssel signiert, was das Programm prüft);
  - Ablehnungen (Betrag 0, zu kurz, über 10 %);
  - Programm bereit nur ausführbar; Aufräumen;
  - Verdrahtung und Reihenfolge in `zahlkanal-ui.ts`, `app.ts`, `index.html`.
- Verdrahtungs-Ausnahmen: vier raus (`kanalAdresse`, `neuerSitzungsSchluessel`,
  `oeffneKanalIx`, `pruefeKanalEmpfaenger`); `stockeKanalAufIx` bleibt mit
  neuer Begründung.

**Website:** FAQ und Whitepaper sagten „SOL-Aufträge gehen ganz an den
Provider, bis der Zahlkanal aufteilt“. Jetzt steht dort, dass über einen
SOL-Zahlkanal das Programm auf der Kette aufteilt, und dass es gebaut, aber
noch nicht veröffentlicht ist.

**Befund für Spur C:** Im Browser liegt auf dem Desktop nach dem ersten Start
die ganze Währungs-Seite rechts außerhalb des Bildes (28 px breit) – auf
`main` genauso, unabhängig von diesem Schritt. Auf dem Handy passt sie.

Endstand: protocol 1067 (+1) · node 235 · app 497 (+4) · mls 13 · Zahlkanal 7 ·
Leak-Tests 58 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt C.0 – Oberfläche: Bestandsaufnahme und Entwurf

**Fertig (nur Dokumente, kein Code):** Neue dritte Spur C (Oberfläche). Die
Karte `docs/ausbau/phase-10.md` hält fest, was es heute gibt, was dabei
auffällt und wie Räume, Repositories, die Abdeckungskarte und die Navigation
aussehen sollen. Code entsteht erst nach der Freigabe durch den MENSCHEN.

**Einzelheiten:**
- **Bestandsaufnahme:** jede Funktion der sechs Tabs mit Bedienelement und
  Ort im Code (Datei:Zeile). Dazu Screenshots aus `dist/freedom.html` mit
  Playwright:
  - frisches Profil, `de-DE`, ohne Netz;
  - Desktop 1280×800 und Mobil 390×844, alle 21 Ansichten;
  - abgelegt in `docs/ausbau/bilder/c0/` als zwei Übersichten und vier
    Einzelbilder, rund 0,6 MB. Der Sicherungsdialog ist nicht dabei (Merkphrase).
- **Befunde B1–B17**, gemessen (Sichtbarkeit und Maße der Elemente), u. a.:
  - B1: Am Desktop nimmt die Onboarding-Leiste die ganze Breite, `main` hat
    die Breite 0, die Navigation steht rechts (`app.css:401` überstimmt
    `app.css:931`). Das trifft jeden neuen Nutzer, bis er „Später“ wählt.
  - B2: Unter 860 px sind Verlauf, Modelle, Kataloge, Repos, Prüfaufträge,
    Reklamationen und das Kontingent nicht erreichbar (`app.css:1060`).
  - B3: Unter 1100 px fehlen die Mitglieder und mit ihnen die Meldungen an
    Moderatoren (`app.css:1093`).
  - B5: „Relays verbunden“ zählt den Pool, nicht die Verbindungen – auch ohne
    Netz grün.
  - B8: „n Antworten“ im Raum hat keinen Handler; Antworten und Threads gibt
    es im Protokoll, in der Oberfläche nicht.
  - B13: Der eigene Standort liegt genau und im Klartext in `localStorage`.
- **Entwurf:** Seiten Agent, Kommunikation, Repos (neu), Währung, Netz (neu:
  Karte und Mesh), Verdienen, Profil, Settings. Desktop mit Leiste links, mobil
  untere Leiste „Agent · Chat · Währung · Mehr“. Die Adresse nennt nur die
  Seite, nie eine Kennung – den Browserverlauf leert die Notfall-Löschung nicht.
  Räume wie Discord (Menüs, Dialoge statt `prompt()`, Antworten, Threads,
  Mitglieder mit Rollen), Repos wie GitHub (Repo-Seite, Patches als Pull
  Requests mit Diff, Aktionen der Maintainer), Karte als eigenes SVG nur aus
  `buildCoverage()`.
- **Teilschritte** C.1a bis C.6, je höchstens etwa 400 Zeilen; Dateien der
  Spur A erst nach 4.3d (C.6).
- **Fragen E1–E8** an den MENSCHEN, je mit Vorschlag – **entschieden
  27.09.2026: alle Vorschläge angenommen**, u. a.:
  - untere Leiste mit vier Zielen;
  - Communities nicht mehr neu anlegen;
  - Git-Bundles in der App lesen (neuer Baustein ohne Abhängigkeit);
  - eingebettete Küstenlinien (gemeinfrei, höchstens 40 KB);
  - Standort nur gerundet speichern.
- **Geteilte Dateien, klein:**
  - `CLAUDE.md`: „Zwei Agenten parallel“ → „Drei Agenten parallel“, mit den
    drei Spuren und dem Verweis auf den Abschnitt „Spuren“;
  - `FORTSCHRITT.md`: Überschrift „Spuren“, Zeile „C – Oberfläche“ in der
    Spur-Tabelle, Zeile C.0 in „Alle Schritte“.

Endstand nach dem Einmergen von `main` (4.3d2), kein eigener Code: protocol
1067 (6 übersprungen) · node 235 (6 übersprungen, mit Netz) · app 497 · mls 13 ·
Leak-Tests 58 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt C.1a – Oberfläche: Rahmen und Navigation

**Fertig:** Der Rahmen der App ordnet Desktop und Handy je für sich (Karte
`phase-10.md`, Entwurf freigegeben mit E1–E8). Behoben sind B1, B2, B4, B5 und
B15 aus der Bestandsaufnahme.

**Einzelheiten:**
- **Desktop (B1):** `#app` ist ab 1024 px ein Raster statt einer Flex-Zeile.
  - Die Leiste steht links über die volle Höhe.
  - Hinweisleisten (offline, Onboarding, Sicherung) stehen über der Seite.
  - Vorher nahm die Onboarding-Leiste die ganze Breite, `main` hatte die
    Breite 0 und die Leiste stand rechts. Das traf jeden neuen Nutzer, Spur A
    sah es in 4.3d2 an der Währungs-Seite.
  - Profil, Settings und der Relay-Stand stehen unten in der Leiste.
- **Mobil (E1, B15):**
  - Unten stehen nur noch Agent · Chat · Währung · Mehr; „Chat“ ist eine
    eigene kurze Beschriftung.
  - „Mehr“ ist eine neue Seite: Verdienen, Profil, Settings, Sprache (B4 –
    vorher mobil unerreichbar) und der Relay-Stand. Solange eine dieser Seiten
    offen ist, ist „Mehr“ hervorgehoben.
- **Agent mobil (B2):** Oben stehen „Verlauf“ und „Modelle“. Sie öffnen die
  Seitenleiste als eigene Ebene, mit „‹ Zurück“. Damit sind Aufgaben,
  Modelle, Kataloge, Repos, Prüfaufträge, Reklamationen und das Kontingent
  erreichbar. Eine gewählte Aufgabe führt zurück ins Gespräch. `agent.ts`
  (Spur A) ist dafür nicht angefasst – nur `index.html`, CSS und
  `navigation.ts`.
- **`shell/navigation.ts` (neu):**
  - Seiten ↔ Adresse (`#/chat`, `#/agent/verlauf`) über `zielAusAdresse()`
    und `adresseFuer()`. Nie eine Kennung, auch nicht in `history.state` –
    den Browserverlauf leert die Notfall-Löschung nicht.
  - Zurück und Vor über `popstate`. Die App startet mit der Seite aus der
    Adresse.
  - `seiteGezeigt()` am Ende von `switchTab()` zieht Adresse, „Mehr“ und
    `aria-current` nach.
- **Kopfzeile mobil:**
  - Das Guthaben führt zur Währung, der gekürzte Schlüssel zum Profil – beides
    auch per Tastatur.
  - „Importieren“ und der Export des geheimen Schlüssels per Klick sind aus
    der Kopfzeile verschwunden; beides geht im Profil wie bisher.
- **Relay-Stand (B5, E8):**
  - Er zeigt „8 Relays im Pool“ statt „Relays verbunden“ – verbunden zählt die
    App nicht.
  - Der Punkt leuchtet nur, solange der Browser Netz meldet, und folgt
    `online`/`offline`.
  - Ohne Pool zeigt er „—“ statt des rohen Worts „offline“.
- **Texte:**
  - Neuer Bereich `texte/navigation.ts` (`nav.*`).
  - In `rahmen.ts` (Spur B, klein) sind nur Werte geändert: `navEarn` heißt
    auf Deutsch „Verdienen“ (E2), `relaysTitle` „Relays im Pool“.
  - `identTitle` fällt weg.
  - Neues Symbol `menu` in `icons.ts`.
- **Werkzeug:** `scripts/screenshots.py` nimmt jede Ansicht über ihre
  Adresse auf, in Desktop und Mobil. Es ist nicht in der CI und nimmt den
  Sicherungsdialog nie auf.

**Tests:**
- +6 in `app/test/navigation.test.ts`:
  - Adresse hin und zurück;
  - keine Kennung in der Adresse – Hex, npub, Unterpfade und Unbekanntes
    gelten nicht;
  - jede Seite mit Knopf und Bereich, mobil der Rest unter „Mehr“;
  - verdrahtet in `switchTab()` und beim Start;
  - Raster ab 1024 px;
  - Relay-Stand ohne „verbunden“.
- Smoke-Test „rahmen“, Desktop und Mobil ab dem ersten Start:
  - Desktop: `main` 1208 px breit neben der Leiste bei x = 0, die
    Onboarding-Leiste darüber; Adresse und Zurück; Titel „im Pool“.
  - Mobil: vier Ziele unten, Verlauf/Zurück/Modelle des Agenten, „Mehr“ mit
    Sprache und Relay-Stand, Settings erreichbar.

Endstand: protocol 1067 (6 übersprungen) · node 235 (6 übersprungen, mit
Netz) · app 503 (+6) · mls 13 · Leak-Tests 58 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten
ok · Smoke-Test bestanden (mit „rahmen“) · im Browser: alle Seiten in Desktop
1280×800 und Mobil 390×844 per `scripts/screenshots.py` durchgesehen, ohne
Seitenfehler.

## Schritt C.1b – Oberfläche: Seiten Repos und Netz

**Fertig:** Reines Verschieben nach dem Entwurf (`phase-10.md`, E2). Jede
Funktion steht an einem Ort, der zu ihr passt. Alle IDs bleiben gleich, damit
die bestehende Verdrahtung unverändert greift – auch `einrichtung-ui.ts`, das
Handler über IDs auslöst.

**Einzelheiten:**
- **Neue Seite „Repos“** (`#/repos`): Repositories (Bundles und NIP-34) aus
  Agent › Repos, Mitwirkende aus Verdienen › Werben.
- **Neue Seite „Netz“** (`#/netz`) mit zwei Reitern: Karte (Abdeckung, aus
  Verdienen › Karte) und Mesh (Funk, Bluetooth, Datei, Warteschlange, aus
  Settings › Mesh).
- **Vertrauensstufe** (XP des Providers) vom Profil nach Verdienen › Übersicht.
  Das Profil zeigt die Abzeichen in voller Breite.
- **Navigation:**
  - Desktop: Agent, Kommunikation, Repos, Währung, Verdienen, Netz; unten
    Profil und Settings.
  - Mobil: Repos und Netz unter „Mehr“ (`UNTER_MEHR`).
- **`switchTab()`:** Die Aufrufe folgen den Blöcken – „Netz“ lädt Abdeckung und
  Mesh-Hinweis; „Settings“ und „Profil“ laden sie nicht mehr.
- **Texte:**
  - Vorhandene Schlüssel wiederverwendet (`agent.tabRepos`,
    `agent.repositories`, `earn.tabKarte`, `set.tabMesh`); neu nur `nav.netz`
    und `nav.netzUntertitel`.
  - Wo ein Text den alten Ort nannte, steht jetzt „Netz → Mesh“:
    `waehr.alsDateiGespeichert` (de/en) und `OFFLINE_HINWEIS` im Protokoll –
    ein Wort, andere Spur.
  - Der Kommentar in `leak/mesh.test.ts` nennt ebenfalls den neuen Ort.
- **`i18n.test.ts`** (Spur B, zwei Zeilen): Die Prüfung, dass Karte und
  Mesh-Hinweis beim Öffnen neu gezeichnet werden, zeigt jetzt auf die Seite
  „Netz“ statt auf Earn und Settings – gleich streng.

**Tests:**
- +1 in `navigation.test.ts`: Jeder verschobene Block steht genau einmal, auf
  seiner neuen Seite; die alten Reiter sind weg; „Netz“ lädt Karte und Mesh.
- Smoke-Test „rahmen“: Die Leiste zeigt am Desktop die acht Seiten, mobil „Mehr“
  fünf Ziele. Auf Repos, Netz (Karte und Mesh) und Verdienen sind die
  verschobenen Inhalte sichtbar. Die Prüfung schlug im ersten Lauf an der
  eigenen Reihenfolge fehl (Mesh-Reiter geklickt, während „Verdienen“ offen
  war) – korrigiert, danach bestanden.

Endstand: protocol 1067 (6 übersprungen) · node 235 (6 übersprungen, mit
Netz) · app 504 (+1) · mls 13 · Leak-Tests 58 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten
ok · Smoke-Test bestanden (mit „rahmen“) · im Browser: alle 16 Ansichten in
Desktop und Mobil per `scripts/screenshots.py` durchgesehen, ohne
Seitenfehler.

## Schritt C.2a – Oberfläche: Räume in eigene Datei

**Fertig:** Reines Verschieben (E7). Der Raum-Teil aus
`shell/tabs/kommunikation.ts` steht jetzt in `shell/tabs/raeume.ts`: offene und
private Räume, Leiste, Kanäle, Verlauf, Mitglieder, Moderation, Meldungen,
Anlegen, Beitreten, Einladen – bisher Zeilen 34–647.
`kommunikation.ts` hat noch 1.036 statt 1.659 Zeilen.

**Einzelheiten:**
- **Wörtlich:** Ein Vergleich Zeichen für Zeichen bestätigt, dass Raum-Teil und
  Rest unverändert sind. Einzige Ausnahme: `kontaktName` ist jetzt exportiert,
  weil die Einladung in eine MLS-Gruppe (Rest) es braucht.
- **Importe:** Nur die Namen, die jetzt allein der Raum-Teil braucht, sind aus
  `kommunikation.ts` herausgenommen. Sonst ist dort nichts umformatiert.
  - `raeume.ts` holt `conversations` aus `kommunikation.ts`;
    `kommunikation.ts` holt `kontaktName` und `zeigeRaumLeiste` aus
    `raeume.ts`.
  - Das ist ein Kreis, aber nur in Funktionsrümpfen genutzt – für ES-Module
    und esbuild unkritisch.
  - `app.ts` holt `wireSpacesTab` und `zeigeRaumLeiste` aus `raeume.ts`.
- **`scripts/innerhtml-ausnahmen.txt`:** Die neun Stellen des Raum-Teils stehen
  unter `raeume.ts`, mit denselben Begründungen.
- **Tests, die Raum-Code im Quelltext suchen,** lesen jetzt `raeume.ts`: in
  `raeume-privat`, `i18n` (Uhrzeit im Raum, Gebietsschema, Einladungstext),
  `versand` (Abruftakt der Räume) und `leak/raum`. Die Prüfungen sind gleich
  streng; wo es um die ganze Kommunikation geht (kein `"de-DE"`, 0 roher Text),
  prüfen sie beide Dateien.
- **`dialog.ts`** rückt nach C.2b, wo er zum ersten Mal benutzt wird – sonst
  wäre er in C.2a nicht verdrahtet (Definition of Done 1).
- **CLAUDE.md:** `raeume.ts` im Aufbau.

**Tests:** +1 in `raeume-privat.test.ts`: Die Raum-Funktionen stehen in
`raeume.ts` und nicht mehr in `kommunikation.ts`; `app.ts` und
`kommunikation.ts` holen sie von dort.

Endstand: protocol 1067 (6 übersprungen) · node 235 (6 übersprungen, mit
Netz) · app 505 (+1) · mls 13 · Leak-Tests 58 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten
ok · Smoke-Test bestanden (mit „rahmen“).

## Schritt 8.16g2b2 – Übersetzungen: Sätze des Protokolls in Settings und im Chat

**Fertig:** Die deutschen Sätze des Protokolls in Settings und im Chat stehen
in der Sprache der Oberfläche. Neu ist der Bereich
`texte/protokollsaetze.ts` (`ps.*`, 74 Schlüssel); die Funktionen stehen in
`protokoll-texte.ts`:
- **Nachfolge:** `nachfolgeWarnung()` (Rückfrage beim Einrichten),
  `nachfolgeStand()` (Stand in Settings und in der Ansicht als Vertrauter).
- **Sicherung:**
  - `sicherungInfo()` – Info mit letzter Sicherung;
  - `sicherungGebaut()` – nach dem Sichern;
  - `wiederherstellungText()` – Ergebnis der Wiederherstellung.
- **Schlüsselwechsel:**
  - `wechselWarnung()`, `widerrufAnleitung()`;
  - `schluesselText()` – Stand eines Kontakts, im Chat als ⚠ mit Hinweis.
- **Geräte:**
  - `geraetWarnung()` mit `rechtName()` – Rückfrage vor einer Vollmacht;
  - `geraetStatusText()` – auch in „Als Gerät angemeldet“.
- **Echtheit:** `echtheitText()`, `fixierungText()` (Settings und Rückfrage
  beim Start), `weitergabeText()` (Begleittext der weitergegebenen Datei).
- **Ohne Internet:** `offlineHinweis()`, `offlineFaehigkeiten()` mit
  `wegName()`.
- **Tor:** `torText()` – Reihenfolge beim Umschalten der Verbindung.

Ein Test hält jede deutsche Fassung wortgleich mit dem Protokoll: jeder Stand
der Nachfolge, jeder Fall von Sicherung, Schlüsselkette, Gerät, Echtheit und
Fixierung, alle Wege, alle Tor-Einstellungen.

**Einzelheiten:**
- **Protokoll (klein, andere Spur berührt):** zusätzliche Felder, damit die App
  den Fall erkennt statt am deutschen Text:
  - `KeyState.streit` („kreis“/„zu-lang“) und `.vorbereitet`;
  - `RestoreResult.fehler` und `.version`;
  - `VerifyResult.fall`, `.bestaetigt` und `.noetig`.

  Nur zusätzliche Felder, kein Event-Format. Die Tor-Sätze haben echte
  Umlaute („über“, „Rückfall“).
- **Ehrlicher Text:** Die Offline-Fähigkeiten sagten zu Räumen noch „Noch
  nicht verschlüsselt (2.3)“. Jetzt: private Räume sind verschlüsselt (MLS),
  gehen aber (noch) nicht über Mesh – MLS-Gruppennachrichten sind keine
  Umschläge, `pruefeMeshInhalt()` lässt sie nicht durch.
- **Schärfere Rohtext-Suche** (`test/i18n-rohtext.ts`): Sie findet jetzt auch
  - ein Wort mit Doppelpunkt vor Text oder einer Einsetzung
    („verbunden: …“, „modell: auto“),
  - Text mit „…“ („publiziere … (3 KB)…“).

  Schemata („https:“) und Kennungen (`eigen:${id}`) bleiben außen vor. Die
  Probe im Test enthält beide Fälle.
- **Übersehene Stellen:** Die schärfere Suche fand acht, alle übersetzt:
  - Protokollzeilen des Funkknotens: „verbunden“, „verworfen“;
  - Git-Bündel veröffentlichen: „publiziere“, „publiziert“, „git-fehler“;
  - Modellwahl: „modell: …“;
  - Fehler beim Anhang-Laden: „blob: …“.
- In `wiring-ausnahmen.txt` stehen sieben weitere deutsche Referenzen.
- **Grenze:** Der Offline-Hinweis oben wird beim Start gesetzt; nach einem
  Sprachwechsel folgt er beim nächsten Wechsel zwischen online und offline.
- **Nach dem Einmergen von `main` (C.1b, C.2a):** Mesh steht jetzt auf der
  Seite „Netz“ – der Offline-Hinweis nennt wie `OFFLINE_HINWEIS` „Netz → Mesh“
  („Network → Mesh“). Die Räume stehen in `tabs/raeume.ts`; die Übersetzungen
  dieses Schritts betrafen dort nichts.
- **Noch unverändert (8.16g2b3):** Gründe aus Prüfungen des Protokolls
  (siehe `phase-8.md`).

**Tests:**
- +1 in `i18n.test.ts`: alle Fälle deutsch wortgleich, Englisch mit Stichproben
  und ohne deutschen Buchstaben, Stellen im Code.
- Die Probe der Rohtext-Suche hat fünf neue Zeilen (drei Funde, zwei
  Nicht-Funde).
- `release-fix`: sucht die neue Stelle (`fixierungText(…)`) – nicht
  schwächer.

Endstand (nach dem Einmergen von `main`): protocol 1067 (6 übersprungen) ·
node 235 (6 übersprungen, mit Netz; ohne Netz 234 + 7) · app 506 (+1) · mls 13 ·
Leak-Tests 58 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden · im
Browser: Sicherung, Offline-Fähigkeiten und Echtheitsprüfung in Englisch und
Deutsch, ohne Seitenfehler.

## Schritt 8.16g2b3a – Übersetzungen: Gründe aus Prüfungen (Geld und Netz)

**Fertig:** Die Gründe, mit denen Prüfungen des Protokolls etwas ablehnen,
stehen in der Sprache der Oberfläche. 8.16g2b3 ist geteilt (rund 90 Sätze):
**a** Geld und Netz (dieser Schritt), **b** Mesh und Vertrauen.

- **Protokoll (klein, berührt andere Spuren):** Die Prüfungen liefern neben
  dem deutschen `grund` eine Kennung `fall` und die Zahlen dazu. Nur
  zusätzliche Felder – kein Event-Format, keine Prüfregel geändert:
  - Fristen (`TimelockCheck.fall`, `.mindestSecs`);
  - Relay-Auftrag (`RelayFehler`, `.erstattung`, `.mindest`);
  - Solana-Transaktion und Mesh-Inhalt (`SolanaTxFehler`, `MeshFehler`,
    `.bytes`, `.signatur`, `.signaturen`);
  - Offline-Überweisung (`OfflineFehler`);
  - Überweisung auf der Kette (`SolFehler`, `.lamports`, `.erwartet`);
  - RPC-Stichprobe (`StichprobeErgebnis.befunde` und `.luecken`; „unerwartete
    Antwort“ als eigene Fehlerklasse statt am Text erkannt).

  Die deutschen Sätze in `timelock.ts` und `relayer.ts` haben echte Umlaute
  („größer“, „Blöcke“, „Einlösung“, „Gebührenzahler“); die Tests dort suchen
  die neue Schreibweise und prüfen zusätzlich die Kennungen.
- **App:** neuer Bereich `app/src/texte/pruefgruende.ts` (`pg.*`, 53 Schlüssel,
  je `de` und `en`); `protokoll-texte.ts` bildet die Gründe neu: `fristGrund`,
  `relayGrund`, `offlineGrund`, `meshGrund`, `solGrund`, `stichprobeBefund`,
  `stichprobeLuecke`. Verdrahtet in `rueck-swap.ts`, `sol-offline-zahlung.ts`,
  `shell/zahlschienen.ts`, `mesh-radio.ts` (Senden und Verwerfen),
  `relay-einloesung.ts`, `trinkgeld-beleg.ts`, `rpc-stichprobe.ts`; der
  Rückholwächter sagt „unbekannt“ in der Sprache der Oberfläche.
- Gründe, die die App selbst bildet (ohne `fall`), bleiben, wie sie sind –
  sie sind schon übersetzt. Was ein Relayer in seiner Ablehnung schickt, ist
  dessen Text und bleibt es.
- `claimAllowed` stand schon in der App und war übersetzt.
- **Noch offen (8.16g2b3b):** Mesh-Planung (`planSync().note`,
  `meshFeasibility().note`, `SYNC_POLICY` – dort steht noch „Räume sind noch
  nicht verschlüsselt (2.3)“), Nachfolge (`darfUebergeben`), Geräte
  (`absenderPerson`), Reklamation (`disputeWindowOpen`, `resolveDispute`),
  Relay-Adressen (`isPlausibleRelayUrl`), Moderationsgrund-Vorgabe. Danach:
  Fehlermeldungen, die das Protokoll wirft.

**Tests:**
- +1 in `i18n.test.ts`:
  - Fristen mit echten Aufrufen deutsch wortgleich;
  - jede Kennung aus dem Quelltext des Protokolls (Relayer 12, offline 9,
    Mesh 13, Kette 6) hat einen Text und stimmt deutsch mit dem Satz dort
    überein;
  - die Stichprobe in sieben Läufen gegen ein kleines Netz: Befunde und Lücken
    wortgleich mit `warnungen` und `hinweise`;
  - Englisch mit Stichproben und ohne deutschen Buchstaben;
  - die Stellen im Code.
- Protokoll: die Tests von Relayer, Offline-Überweisung, Mesh-Inhalt,
  Fristen, Rück-Swap, SOL-Beleg und Stichprobe prüfen zusätzlich die
  Kennungen und Zahlen.
- Zwei App-Tests prüfen die Gründe wörtlich auf Deutsch: `mesh-radio` setzt
  dafür Deutsch und prüft zusätzlich die englische Fassung;
  `relay-einloesung` sucht „Empfänger“ statt „Empfaenger“.

Endstand: protocol 1067 (6 übersprungen) · node 235 (6 übersprungen, mit
Netz; ohne Netz 234 + 7) · app 507 (+1) · mls 13 · Leak-Tests 58 grün + 1
todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 8.16g2b3b – Übersetzungen: Gründe aus Prüfungen (Mesh und Vertrauen)

**Fertig:** Der zweite Teil der Gründe aus Prüfungen steht in der Sprache der
Oberfläche. Damit zeigt die App keine fertigen deutschen Sätze aus Prüfungen
des Protokolls mehr.

- **Protokoll (klein, berührt andere Spuren):** zusätzliche Kennung `fall`
  neben dem deutschen Grund, dazu die Werte:
  - Relay-Adresse (`isPlausibleRelayUrl`: `RelayUrlFehler`, `.schema`, `.host`);
  - Geräteprüfung (`checkDeviceEvent`: `GeraetePruefFall`, `.recht`) und
    Zuordnung eines Absenders (`absenderPerson`: dazu „eigener-schluessel“,
    „uneindeutig“);
  - Übergabe in der Nachfolge (`darfUebergeben`: `UebergabeFehler`, `.stand`
    mit dem Stand der Nachfolge);
  - Funk (`meshFeasibility`: „zu-gross“, „lang“, „ok“).

  Nur zusätzliche Felder – kein Event-Format, keine Prüfregel geändert.
- **Ehrlicher Text:** `SYNC_POLICY` sagte zu Räumen noch „Räume sind noch
  nicht verschlüsselt (2.3) – bis dahin nicht über Mesh.“ Jetzt: Öffentliche
  Räume tragen den Schlüssel des Autors, private (MLS) gehen (noch) nicht
  über Mesh – nur Umschläge.
- **App:** 30 weitere Schlüssel in `texte/pruefgruende.ts`; neue Funktionen in
  `protokoll-texte.ts`: `relayUrlGrund`, `geraetGrund`, `uebergabeGrund`,
  `funkText`, `syncNotiz` (aus den Feldern von `planSync()` und
  `falsePositiveRate()`), `reklamationsFrist` (aus `disputeWindowOpen()`).
  Verdrahtet in `relay-satz.ts`, `shell/nachfolge-ui.ts`, `geraete-buch.ts`,
  `mesh-radio.ts`, `shell/tabs/agent.ts`. Eine Moderation ohne Grund zeigt
  „ohne Grund“ statt „ausgeblendet“ (vorher: „[ausgeblendet: ausgeblendet]“).
- Nicht angezeigt und deshalb unverändert deutsch im Protokoll: übersprungene
  Gründe von `planSync()` (nur die Zusammenfassung erscheint, im Protokoll
  des Funkknotens) und `resolveDispute().message`.
- **Danach offen (8.16):** Fehlermeldungen, die das Protokoll wirft und die
  die App über `(e as Error).message` zeigt; 8.16h mit 0.F (Website).

**Tests:**
- +1 in `i18n.test.ts`: Relay-Adressen (alle sieben Fälle), Funk, Abgleich
  (auch mit ungenauem Bestand), Reklamationsfrist und die Übergabe „noch
  nicht freigegeben“ mit echten Aufrufen deutsch wortgleich; jede Kennung der
  Geräteprüfung (9) und der Übergabe (5) aus dem Quelltext des Protokolls mit
  Text; Englisch mit Stichproben und ohne deutschen Buchstaben; die Stellen im
  Code.
- +1 in `relay-discovery.test.ts`: jede Kennung einer abgelehnten Adresse.
- Protokoll: Geräte, Zuordnung, Nachfolge und Funk prüfen zusätzlich die
  Kennungen; `mesh-sync` prüft den neuen, ehrlichen Satz zu Räumen (und dass
  der alte weg ist).
- `mesh-radio`: der Test zu großer Nachrichten setzt Deutsch und prüft
  zusätzlich Englisch.

Endstand: protocol 1068 (+1, 6 übersprungen) · node 235 (6 übersprungen, mit
Netz; ohne Netz 234 + 7) · app 508 (+1) · mls 13 · Leak-Tests 58 grün + 1
todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website 5 Seiten ok · Smoke-Test bestanden.

## Schritt 8.16h – Website an den Code angeglichen (mit 0.F)

**Fertig:** Die Website sagt, was der Code tut (Karte 0.F). Geändert:

- **Startseite:**
  - Sprachwahl nur Deutsch und Englisch – wie die App seit 8.16a (acht
    Sprachen standen noch zur Wahl).
  - Code-Links auf allen Seiten aufs Repository statt auf github.com.
  - „Der Code … liegt an mehreren Orten“ stimmte nicht: Die Bezugsquellen aus
    5.3 sind noch Platzhalter. Jetzt: weitere Bezugsquellen sind vorbereitet.
  - Downloads: Launcher für Linux, Windows und macOS als „geplant“, ohne die
    interne Notiz zum GX10; der Desktop-Knoten ebenso „geplant“.
  - Knoten-Anleitung: echtes Repository, `npm ci` im Wurzelverzeichnis (die
    Pakete sind Workspaces), Hinweis auf den beim ersten Start erzeugten
    Schlüssel. LP-Modus mit einer gebackenen, eingeschränkten Macaroon wie in
    `docs/SWAPS.md` – mit `admin.macaroon`, wie es dort stand, startet der
    LP seit 8.3 gar nicht.
  - „Drei Einnahmen“: jetzt die drei, die der Knoten im Code kennt –
    KI-Aufträge (94 %), Swap-Liquidität (LP-Gebühr), bezahlter Relay-Zugang
    (8.4b). Vorher stand dort als dritte „das Netz wächst“.
  - Verdienen-Tab: Er zeigt die Leistungs-Events des eigenen Schlüssels –
    die des Knotens nur, wenn App und Knoten denselben Schlüssel nutzen.
- **Whitepaper:** „Der Kern in drei Sätzen“ (es sind sechs) → „Der Kern in
  Kürze“; „Das Solana-Programm ist unveränderlich“ → „wird unveränderlich
  gemacht“ (bis zum Ende der Testphase gibt es eine Upgrade-Autorität);
  KI-Antwort über Funk nachgerechnet.
- **FAQ:** Unveränderlichkeit wie im Whitepaper.
- **KI über Funk, nachgerechnet:** Eine Antwort mit 500 Tokens braucht als
  Umschlag rund 32 s Sendezeit – fast das ganze Budget einer Stunde (36 s bei
  1 %), mit 500 Wörtern rund 46 s. „Stunden bei 500 Tokens“ (Whitepaper) und
  „500 Wörter … Stunden“ (Protokoll, App) waren zu viel. Jetzt: „mehr als eine
  Stunde Sendezeit – dazu kommen Auftrag und Bezahlung“; ein Protokolltest
  rechnet es mit `luftBytes()` nach.
- **Prüfung:** `check-website.py` weist die alten Aussagen ab (`UNGEDECKT`,
  neben `VERALTET`); gegen die alten Seiten meldet es 13 Stellen.
- Schon richtig und belegt: „Reputation ist öffentlich nachprüfbar“
  (Leistungs-Events 38010 mit Rechenarbeit), Solana per Datei mit Durable
  Nonce, Werben ohne Stufen (5.1.4d), „Davon gehen …“, kein Topf.
- **Offen (MENSCH):** Firmenname und Impressum (Fußzeile „Kein
  Unternehmen“), Marketing-Entwürfe; die Frage, ob die Website außer der
  Startseite auch auf Englisch kommen soll.
- **Nächster Schritt (8.16i):** Fehlermeldungen, die das Protokoll wirft.

**Tests:**
- +1 in `protocol/test/mesh-sync.test.ts`: 500 Wörter als Umschlag brauchen
  mehr als die Sendezeit einer Stunde, aber nicht Stunden; der Satz sagt das.
- Der Wortgleich-Test der App (8.16g2b2) hält den neuen Satz deutsch gleich
  mit dem Protokoll.

Endstand: protocol 1069 (+1, 6 übersprungen) · node 235 (6 übersprungen, mit
Netz; ohne Netz 234 + 7) · app 508 · mls 13 · Leak-Tests 58 grün + 1 todo · 0
rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5
Seiten ok · Smoke-Test bestanden · Website gebaut · im Browser: Startseite mit
Englisch und Deutsch, ein spanischer Browser bekommt Englisch, keine
Seitenfehler.

## Schritt 8.16i1 – Übersetzungen: Fehlermeldungen des Protokolls (Geld und Netz)

**Fertig:** Fehler des Protokolls, die Nutzer beim Zahlen und im Netz sehen,
stehen in der Sprache der Oberfläche.

- **Gemessen:** rund 270 deutsche Fehlermeldungen in 72 Dateien des
  Protokolls, 234 davon in Dateien, die die App nutzt. Die meisten sind
  Parser fremder Events („kein …-Kind“) oder Schutzprüfungen, die die
  Oberfläche nie erreichen – sie bleiben, wie sie sind. Übersetzt wird, was
  Nutzer sehen können.
- **Grundlage:**
  - Protokoll: `ProtokollFehler(kennung, meldung, werte)` in
    `protocol/src/fehler.ts`. Die Meldung bleibt deutsch – Knoten, Logs und
    Tests lesen sie wie bisher.
  - App: `fehlerText(e)` (`protokoll-texte.ts`) übersetzt Fehler mit
    bekannter Kennung und lässt alles andere unverändert; neuer Bereich
    `texte/fehler.ts` (`pf.*`, 46 Schlüssel).
  - Alle 106 Anzeigestellen in 29 Dateien zeigen Fehler jetzt über
    `fehlerText(e)` statt `(e as Error).message`.
  - `explainError()` (Agent) deutet Fehler mit Kennung nicht mehr nach
    Mustern um – sie sind genauer als „Relay-Problem“.
- **Geld und Netz (46 Kennungen):**
  - „Kein Solana-Endpunkt erreichbar“ (RpcPool);
  - Lightning-Rechnung (`leseBolt11`, acht Fälle);
  - NWC: Adresse (vier Fälle), nicht unterstützte Funktion, kein Relay,
    Zeitüberschreitung und die Fehler des Wallets (`nwcKennung()` zu
    `explainNwcError()`; unbekannte zeigen die Meldung des Wallets);
  - Zahlschienen: Ziel, Einheit, Referenz, unbekanntes Ziel, keine Schiene,
    offline (die Sätze aus `offlineZahlText()`), keine Wallet verbunden;
  - Beträge und Tageslimit, Zahlkanal-Betrag;
  - SOL ohne Internet (Nonce-Konto nicht eingerichtet, an sich selbst, andere
    Adresse);
  - Rück-Swap (Betrag, Kurs, Gebühr), SOL-Trinkgeld (Betrag, Adresse,
    Notiz), Zustandssicherung zu groß.
- **Noch offen (8.16i2):** Identität und Inhalte – Bunker, Repos,
  Modellkataloge, Kontaktliste, Nachfolge, Geräte, Schlüsselwechsel,
  Werbung, Räume, verschlüsselte Dateien, Direktnachrichten, Trinkgeld-Adresse.

**Tests:**
- +1 in `i18n.test.ts`:
  - kein `(e as Error).message` mehr im Code;
  - jede Kennung aus dem Quelltext des Protokolls (dazu die sieben
    Wallet-Fehler und „offline“ je Schiene) hat einen Text, der deutsch zur
    Meldung passt;
  - mit echten Aufrufen wortgleich: Rechnung, NWC-Adresse, Rück-Swap,
    Tageslimit, RPC unerreichbar, jeder Wallet-Fehler, offline je Schiene;
  - Fehler ohne Kennung bleiben unverändert;
  - Englisch mit Stichproben und ohne deutschen Buchstaben.
- +2 in `protocol/test/fehler.test.ts`: Kennung gesetzt und deutsche Meldung
  unverändert – Eingaben (Rechnung, NWC, Rück-Swap, Limit, Einheit) sowie
  Netz und Wallet (offline, keine Wallet, keine Schiene, RPC, Wallet-Fehler).

Endstand: protocol 1071 (+2, 6 übersprungen) · node 235 (6 übersprungen, mit
Netz; ohne Netz 234 + 7) · app 509 (+1) · mls 13 · Leak-Tests 58 grün + 1 todo
· 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5
Seiten ok · Smoke-Test bestanden · im Browser: eine falsche NWC-Adresse meldet
englisch „Not an NWC connection …“, deutsch „Keine NWC-Verbindung …“, keine
Seitenfehler.

## Schritt 8.16i2 – Übersetzungen: Fehlermeldungen des Protokolls (Identität und Inhalte)

**Fertig:** Der zweite Teil der Fehlermeldungen, die Nutzer sehen können,
steht in der Sprache der Oberfläche. Damit ist der Code-Teil von 8.16 fertig.

- **Protokoll (klein, berührt andere Spuren):** `ProtokollFehler` mit
  Kennung statt `Error` an 46 Stellen, die deutsche Meldung unverändert:
  - Bunker (NIP-46): Adresse (drei Fälle), Antworten des Signers (Pubkey,
    kein Event, anderes Event, Freigabe mit und ohne Adresse, Ablehnung,
    keine gültige Antwort, keine Antwort);
  - Repos und Patches (NIP-34): Kennung, Klon-Adresse, Maintainer, erster
    Commit, Patch zu groß, kein `git format-patch`, ohne Betreff, ohne
    Änderung, Commit;
  - Modellkataloge: Kennung, Titel, Beschreibung, Zahl der Modelle,
    Modell-Kennung, doppelt, Notiz;
  - Kontaktliste: höchstens N, nicht lesbar, beschädigt;
  - Nachfolge: Schwelle, zu wenige/zu viele/doppelte Teile, verschiedene
    Längen, Anteile zusammensetzen (zu wenige, passen nicht);
  - Geräte (selbst bevollmächtigen, ohne Rechte), Schlüsselwechsel (derselbe
    Schlüssel), Selbstwerbung, „kein Moderator außer dir“, verschlüsselte
    Dateien (Schlüssel, beschädigt, Hash).
- Schutzprüfungen, deren Eingaben die App vorher prüft (Ablauf einer
  Direktnachricht, Trinkgeld-Adresse, Pubkeys), und Parser fremder Events
  bleiben einfache Fehler – die Oberfläche erreichen sie nicht.
- **App:** 46 weitere Schlüssel in `texte/fehler.ts` (jetzt 92), Einträge in
  `FEHLER`. Die Anzeigestellen zeigen sie seit 8.16i1 über `fehlerText(e)`.
- **Stand 8.16:** Code-Teil fertig. Offen nur MENSCH: Durchsicht der
  englischen Texte; ob die Website ganz auf Englisch kommt.

**Tests:**
- +1 in `i18n.test.ts`: 14 echte Aufrufe (Bunker, Repo, Patch, Katalog,
  Nachfolge, Gerät, Schlüsselwechsel, Werbung, Datei) werfen die erwartete
  Kennung, deutsch wortgleich; Englisch mit Stichproben und ohne deutschen
  Buchstaben.
- Der Test aus 8.16i1 prüft jetzt auch diese Kennungen aus dem Quelltext des
  Protokolls (Text vorhanden, deutsch passend).

Endstand: protocol 1071 (6 übersprungen) · node 235 (6 übersprungen, mit Netz;
ohne Netz 234 + 7) · app 510 (+1) · mls 13 · Leak-Tests 58 grün + 1 todo · 0 rot
· check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten
ok · Smoke-Test bestanden · im Browser: eine ungültige Bunker-Adresse meldet
englisch „Not connected: Not a valid bunker:// address“, deutsch „Nicht
verbunden: Keine gültige bunker://-Adresse“, keine Seitenfehler.

## Schritt 7.4a – KI über ein Funk-Gateway: Protokoll und Provider

**Fertig:** Die Bausteine, mit denen eine KI-Anfrage ohne Internet über Funk
zu einem Gateway mit Netz geht und eine kurze Antwort zurückkommt. 7.4 war
zurückgestellt (MENSCH 26.09.), bis der Zahlkanal (4.3) steht – der ist im
Code fertig. Aufgeteilt: **a** Protokoll und Provider (dieser Schritt),
**b** Gateway-Rolle im Knoten, **c** App.

- **Protokoll `funk-gateway.ts`:**
  - Kurze Antwort auf Wunsch: `kurzParam()` setzt `["param","max_zeichen","<n>"]`
    in den versiegelten Auftrag (höchstens 500); `leseKurzWunsch()` liest ihn
    (Unbrauchbares heißt: wie immer); `kuerzeAntwort()` kürzt nach
    Codepunkten, gekürzt endet mit „…“.
  - Weiterleitungsauftrag (Kind 25030): versiegelt an das Gateway, Autor ist
    der Sitzungsschlüssel, Ablauf höchstens 1 h (auch am Umschlag, NIP-40) –
    `baueWeiterleitung()`/`oeffneWeiterleitung()`. Das Gateway erfährt nur den
    Sitzungsschlüssel; die Signatur zeigt, dass der Auftraggeber ihn hält.
  - `GatewayBuch`: zurück über Funk nur Umschläge an gemerkte, laufende
    Sitzungen, höchstens drei je Sitzung, keiner doppelt, höchstens 50
    Sitzungen zugleich.
- **Provider (`dvm-provider.ts`):** Mit `max_zeichen` bittet er das Modell um
  Kürze, kürzt das Ergebnis hart (auch im Schwarm-Modus) und schickt keine
  Zwischenstände (Kind 7000) – jede Rückmeldung kostete Sendezeit. Ohne den
  Parameter bleibt alles wie bisher.
- `offline-node.ts`: Der Kommentar „500 Tokens bräuchte Stunden“ stimmt jetzt
  mit der Rechnung aus 8.16h überein.
- `wiring-ausnahmen.txt`: vier Bausteine, die 7.4b (Gateway) und 7.4c (App)
  verdrahten.

**Tests:**
- +4 in `protocol/test/funk-gateway.test.ts`:
  - Parameter gedeckelt, Unbrauchbares ignoriert, Kürzen ohne halbes Emoji;
  - Weiterleitung: geht als Umschlag über Mesh, Sitzung nur im Kern, fremdes
    Gateway, abgelaufen und über 1 h abgelehnt;
  - Gateway-Buch: fremde Sitzung, kein Umschlag, doppelt, mehr als drei,
    abgelaufen, Buch voll;
  - **Abnahme auf Protokollebene:** Auftrag und Weiterleitung über einen
    simulierten Funkkanal (Pakete ≤ 200 Byte, Verzögerung – Reihenfolge
    umgedreht –, Verlust mit gezieltem Nachfordern, Dubletten) ans Gateway,
    ins Netz zum Provider, kurze Antwort versiegelt an die Sitzung, über das
    Buch und den Funkkanal zurück; die Antwort passt in die Sendezeit einer
    Stunde und öffnet nur mit dem Sitzungsschlüssel.
- +2 in `node/test/funk-kurz.test.ts`: mit `max_zeichen` höchstens 500 Zeichen,
  erkennbar gekürzt, keine Zwischenstände, Bitte um Kürze im Prompt; ohne ihn
  wie bisher (ganze Antwort, ein Zwischenstand).

Endstand: protocol 1075 (+4, 6 übersprungen) · node 237 (+2, 6 übersprungen,
mit Netz; ohne Netz 236 + 7) · app 510 · mls 13 · Leak-Tests 58 grün + 1 todo ·
0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5
Seiten ok · Smoke-Test bestanden. Knoten-Stand: Das Kürzen braucht den
Provider-Knoten auf diesem `main` – ältere Knoten übergehen `max_zeichen` und
antworten wie bisher (nichts bricht, nur lang).

## Schritt 7.4b1 – Fehlende Rahmen nachfordern (Protokoll und Funkknoten der App)

**Warum:** Über Funk geht jeder zwanzigste Rahmen verloren. Eine Antwort aus
elf Rahmen käme ohne Nachforderung fast jedes zweite Mal gar nicht an – für
das Funk-Gateway (7.4b2) und für Chat über Funk gleichermaßen. 7.4b ist
aufgeteilt: b1 die Nachforderung (dieser Schritt), b2 die Gateway-Rolle im
Knoten; so bleibt jeder Teil unter 400 Zeilen.

**Was:**
- **Protokoll (`mesh-transport.ts`):**
  - Nachforderung als eigene Nutzlast (37 Byte: „N“, Kennung der Nachricht,
    Bitfeld der fehlenden Nummern) – `baueNachforderung()`/`leseNachforderung()`.
    Sie trägt nur, was ohnehin in jedem Rahmenkopf steht; `pruefeMeshInhalt()`
    erkennt sie als Art „nachforderung“ (nur als Nostr-Art, Bit 255 gesetzt
    heißt Müll).
  - Empfänger: `Reassembler.faelligeNachforderungen()` – nach 20 s ohne neuen
    Rahmen, höchstens dreimal je Nachricht, die Ruhe davor verdreifacht sich
    (die Gegenseite wartet vielleicht nur auf ihre Sendezeit); ein doppelter
    Rahmen zählt nicht als Fortschritt.
  - Sender: `Sendegedaechtnis` (20 Nachrichten, 1 h, höchstens zweimal je
    Nachricht, `kennt()`), nachgesendet über `MeshQueue.enqueueFrames()` – mit
    Vorrang und Sendezeit wie alles andere.
  - Der Kopfkommentar sagt jetzt, was seit 7.4 über Funk geht (kurze
    KI-Antwort über ein Gateway), statt „KI-Inferenz gar nicht“.
- **App (`mesh-radio.ts`):** Der Funkknoten merkt, was er sendet und
  weiterreicht, beantwortet Nachforderungen aus dem Gedächtnis, reicht fremde
  weiter (eigene, schon zweimal nachgesendete nicht) und fordert über Funk alle
  10 s fällige Lücken nach (`nachfordern()`); der Datei-Weg hat keinen Rückweg
  und fordert nicht. Eine Nachforderung ist keine Nachricht – sie erreicht
  `onMessage` nie (sonst meldete die App „Paket unlesbar“). Zwei Texte
  (`bau.nachforderung`, `bau.nachgesendet`) in beiden Sprachen.

**Tests:**
- +5 in `protocol/test/mesh-nachforderung.test.ts`: Form und Grenzen
  (Kennung, leere Liste, Nummer 255, falsche Länge/Marke, Bit 255, nicht mit
  dem Bestand verwechselt); Zeitplan des Empfängers (Ruhe, dreifacher
  Abstand, neuer Rahmen setzt zurück, doppelter nicht, höchstens dreimal);
  Gedächtnis (unbekannt, Nummer außerhalb, höchstens zweimal, älter als eine
  Stunde, älteste fällt heraus, Kopie unabhängig von der Warteschlange);
  Vorrang nachgesendeter Rahmen; Ende zu Ende über einen verlustreichen Kanal
  (zwei Rahmen verloren, Nachforderung zerlegt zurück, nachgesendet, Inhalt
  passt zur Kennung).
- +2 in `app/test/mesh-radio.test.ts`: zwei Funkknoten, zwei Rahmen gehen
  verloren – genau die zwei kommen nach, die Nachricht einmal an, die
  Nachforderung nie als Nachricht; nur Eigenes, höchstens zweimal, Fremdes
  weitergereicht (mit verringerter Sprungzahl), ohne Gerät keine
  Nachforderung.
- +1 Leak-Test (`leak/mesh.test.ts`): Lücke nachfordern und nachsenden – im
  Mitschnitt beider Seiten weder Alices noch Bobs Schlüssel noch Klartext.

Endstand: protocol 1080 (+5, 6 übersprungen) · node 237 (6 übersprungen, mit
Netz; ohne Netz 236 + 7) · app 512 (+2) · mls 13 · Leak-Tests 59 grün (+1) +
1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website 5 Seiten ok · Smoke-Test bestanden. Knoten-Stand: unverändert (nur
Protokoll und App).

## Schritt 7.4b2 – Funk-Gateway im Knoten

**Warum:** Mit 7.4a (Protokoll, Provider kürzt) und 7.4b1 (Nachforderung)
fehlte noch der Knoten, der am Funkgerät hängt: Er nimmt versiegelte
KI-Aufträge aus dem Funk an, reicht sie ins Netz und funkt die Antwort
zurück – ohne Inhalt, Identität oder Bezahlung zu sehen.

**Was:**
- **Knoten (`gateway-role.ts`, neu):**
  - TCP-Brücke zum Funkgerät (`FUNK_GATEWAY=host:port`, z. B. ser2net oder
    socat): je Rahmen zwei Byte Länge, dann der Rahmen; eine unmögliche Länge
    heißt „Strom verschoben“ – ein Byte weiter suchen. Nach einer Trennung
    verbindet sie alle 30 s neu; ein Rahmen, der nicht hinausging, kommt
    zurück in die Warteschlange. Keine neue Abhängigkeit.
  - `GatewayRolle`: setzt Rahmen zusammen, prüft mit `pruefeMeshInhalt()`,
    beantwortet Nachforderungen aus dem Gedächtnis, fordert Lücken nach
    (7.4b1). Ein Umschlag an den Knoten ist nur dann ein Weiterleitungsauftrag,
    wenn der Kern Kind 25030 ist – er bleibt beim Gateway (auch ungültig).
    Alles andere, auch ein Auftrag an den Provider auf demselben Knoten
    (gleicher Schlüssel), geht ins Netz. Post an gemerkte Sitzungen holt es
    alle 5 s und funkt sie über die Warteschlange mit Sendezeitkonto zurück.
    Ins Log nur feste Sätze und Fehlernamen.
  - `main.ts`: startet die Rolle mit `FUNK_GATEWAY`; das Angebot trägt dann
    `["funk","gateway"]` (`tiers.ts`, `funkGateway`), damit die App (7.4c) das
    Gateway wählen kann, solange sie Netz hat.
- **Protokoll:**
  - `Weiterleitung.ab` (Erstellzeit des Auftrags): `GatewayBuch.zurueck()`
    funkt keine Post von vor dem Auftrag (10 min Uhr-Toleranz) – sonst gingen
    bei einer wiederverwendeten Sitzung alte Antworten statt der neuen hinaus.
    Ein neuerer Auftrag derselben Sitzung bringt neue drei Umschläge; schon
    Gefunktes bleibt gefunkt, ein wiederholt gefunkter älterer ändert nichts.
  - `Reassembler`: Eine späte Dublette nach dem Zusammensetzen legt keine Lücke
    an, die nachgefordert würde – fand die Abnahme (sie kostete Sendezeit).
- `wiring-ausnahmen.txt`: `GatewayBuch` und `oeffneWeiterleitung` sind jetzt
  verdrahtet (Zeilen entfernt).

**Ehrlich zur Sendezeit:** Eine Antwort mit 500 Zeichen ist als Umschlag
(zweimal verschlüsselt, Base64) rund 3 KB, also etwa 15 s Sendezeit – ein
Gateway schafft rund zwei Antworten je Stunde. Das sagt die App in 7.4c.

**Tests:**
- +4 in `node/test/gateway-role.test.ts`:
  - **Abnahme gegen den echten `DvmProvider`:** Weiterleitung und Auftrag über
    einen simulierten Funkkanal (Rahmen ≤ 200 Byte, verdrehte Reihenfolge, ein
    Rahmen fehlt, eine Dublette), das Gateway fordert genau die Lücke nach,
    nur der Auftrag geht ins Netz (die Weiterleitung nie), der Provider
    antwortet gekürzt ohne Zwischenstände, das Gateway funkt zurück (ein
    Rahmen fehlt, die Kundin fordert nach), die Antwort öffnet nur mit dem
    Sitzungsschlüssel; Sendezeit des Gateways 5–18 s; kein zweites Mal.
  - Nur gemerkte Sitzungen und nur Neues: ohne Weiterleitung nichts,
    Weiterleitung an ein anderes Gateway geht als gewöhnlicher Umschlag ins
    Netz, Post von vor einer Stunde und fremde Post bleiben, Klartext kommt
    nicht ins Netz.
  - Sendezeit bei viel Post: in keinem Stundenfenster mehr als 36 s.
  - TCP-Brücke: Längenpräfix, zerstückelter Strom, verschobene Bytes, Rahmen
    in beide Richtungen gegen einen echten TCP-Server, Senden nach dem
    Schließen scheitert, Adresse ohne Port abgelehnt.
- +1 in `protocol/test/funk-gateway.test.ts`: Angebot mit und ohne Gateway,
  fremder Wert zählt nicht; Gateway-Buch um `ab` und neue Aufträge erweitert.
- `mesh-nachforderung.test.ts`: späte Dublette ist keine Lücke.

Endstand: protocol 1081 (+1, 6 übersprungen) · node 241 (+4, 6 übersprungen,
mit Netz; ohne Netz 240 + 7) · app 512 · mls 13 · Leak-Tests 59 grün + 1 todo ·
0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5
Seiten ok · Smoke-Test bestanden. Danach nur Fehlerbehandlung im Knoten
nachgeschärft (`.catch` an der Brücke und den Takten) – node erneut 240 + 7,
tsc und check-wiring erneut grün. Knoten-Stand: Wer ein Funk-Gateway betreibt,
braucht den Knoten auf diesem `main` und `FUNK_GATEWAY=host:port`; ohne die
Variable ändert sich nichts.

## Schritt 7.4c1 – Gerätestrecken der App mit Längenpräfix

**Warum:** Für KI über Funk (7.4c) muss die Antwort über das Funkgerät zurück
in die App. Dabei zeigten sich zwei alte Lücken: Über USB schrieb die App
rohe Rahmen und las nie – eine Antwort kam gar nicht an. Über Bluetooth
zerlegte sie Rahmen in 180-Byte-Häppchen ohne Grenze, und beim Empfang galt
jedes Häppchen als Rahmen – ein Rahmen über 180 Byte (fast jeder) war nie
lesbar. 7.4c ist deshalb dreigeteilt: c1 die Strecken (dieser Schritt), c2 die
App-Logik, c3 die Oberfläche.

**Was:**
- **Protokoll:** `mitLaenge()`/`LaengenRahmen` (zwei Byte Länge je Rahmen,
  Big Endian; unmögliche Länge → ein Byte weiter suchen) aus der TCP-Brücke
  des Knotens (7.4b2) nach `mesh-transport.ts` gezogen – App und Knoten
  sprechen dasselbe mit dem Funkgerät.
- **App (`mesh-radio.ts`):**
  - `serielleStrecke()`: sendet mit Längenpräfix und liest den Strom, wenn ein
    Empfänger angegeben ist (`connectSerial(baud, onFrame)`; Settings geben
    jetzt `receive` mit); beim Trennen endet das Lesen.
  - `bluetoothStrecke()`: sendet den Rahmen samt Länge in BLE-Häppchen und
    setzt eingehende Häppchen über `LaengenRahmen` wieder zu Rahmen zusammen.
  - Beide ohne Gerät testbar (Port bzw. Merkmale übergeben).
- **Knoten:** `gateway-role.ts` nimmt die Bausteine aus dem Protokoll (keine
  Änderung im Verhalten).

**Achtung Funkgerät:** Die Firmware am anderen Ende der USB- bzw.
Bluetooth-Strecke muss denselben Längenpräfix sprechen wie die Brücke des
Knotens (Entscheidung 7.4: „TCP-Brücke mit Längenpräfix“). Ein Gerät, das rohe
Rahmen erwartete, gab es in der App nie mit Rückweg.

**Tests:**
- +2 in `app/test/mesh-radio.test.ts`: USB – ein Umschlag aus einem Strom in
  ungleichen Häppchen (Grenzen im Längenfeld und im Rahmen) kommt vollständig
  im Funkknoten an, gesendet wird mit Länge vorn, zu große Rahmen abgelehnt,
  Trennen beendet das Lesen, ohne Empfänger wird nicht gelesen; Bluetooth –
  Häppchen (20/180/5 Byte) ergeben wieder die Nachricht, gesendet wird in
  Häppchen ≤ 180 Byte, die zusammen genau Länge + Rahmen sind, Trennen trennt.
- Der Test der TCP-Brücke (`node/test/gateway-role.test.ts`) prüft dieselben
  Bausteine jetzt aus dem Protokoll.

Endstand: protocol 1081 (6 übersprungen) · node 241 (6 übersprungen, mit
Netz; ohne Netz 240 + 7) · app 514 (+2) · mls 13 · Leak-Tests 59 grün + 1 todo ·
0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5
Seiten ok · Smoke-Test bestanden. Knoten-Stand: unverändert im Verhalten.

## Schritt 7.4c2 – KI über Funk in der App: Logik

**Warum:** Mit Gateway (7.4b2) und Gerätestrecken (7.4c1) fehlte die App
selbst: Sie muss offline wissen, welches Gateway sie nutzt, den Auftrag so
bauen, dass er über Funk bezahlt werden kann, und die Antwort erkennen, wenn
sie über Funk ankommt. Die Oberfläche (Gateway wählen, „über Funk senden“)
folgt in 7.4c3.

**Was:**
- **`ki-funk.ts` (neu, ohne Zustand):**
  - `funkGatewayAus()`: aus einem Angebot mit `["funk","gateway"]` nur, was
    offline nötig ist (Schlüssel, Rechenarbeit, Kurs, Stand); mehr
    Rechenarbeit als 16 Bit (wie im Agenten) → keines. `leseFunkGateway()`
    verwirft Unbrauchbares, ein kaputter Kurs fällt weg (dann nur gratis).
  - `baueFunkAuftrag()`: Auftrag mit `kurzParam()`, Tarif (gratis bei Gebot
    0) und Zahl-Tags im versiegelten Kern, dazu die Weiterleitung für eine
    Stunde – beide vom Sitzungsschlüssel.
  - `FunkAuftraege`: offene Funk-Aufträge nur im Speicher; ein Ergebnis
    schließt, eine Rückmeldung (Ablehnung) lässt offen; Fremdes, Doppeltes
    und nach der Stunde Eintreffendes zählt nicht.
- **`shell/ki-ueber-funk.ts` (neu):** Gateway merken/vergessen (Tresor,
  `freedom.funk.gateway` in `GEHEIM_FEST` – welches Gateway jemand über Funk
  nutzt, verrät ungefähr, wo er ist); `sendeKiUeberFunk()`: bezahlt nur per
  Zahlkanal-Gutschrift zum Kurs aus dem gemerkten Angebot oder gar nicht
  (Gebot 0) – ohne Kanal bricht eine bezahlte Anfrage mit klarem Text ab, nie
  still Lightning; erst Gutschrift und Anfrage merken, dann Weiterleitung und
  Auftrag über den Funkknoten; `nimmFunkAntwort()`.
- **`ki-zahlung.ts`:** `kanalGutschrift()` nimmt einen gemerkten Kurs – ohne
  Netz gibt es keine Angebote.
- **Settings (Funkknoten):** Ein Umschlag aus dem Funk geht zuerst an
  `nimmFunkAntwort()`; nur was keine Funk-Antwort ist, wird weiterverteilt.
- **Agent:** `setupFunkAntworten()` (aus `app.ts`) zeigt das Ergebnis mit
  „über Funk · auf „…““ (die Antwort kommt oft Minuten später); über den Kanal
  wird nur der Preis verbucht, Lightning zahlt hier nie; eine Ablehnung
  erscheint als Hinweis.
- Sechs Texte (`agent.funk*`) in beiden Sprachen.
- `wiring-ausnahmen.txt`: `baueWeiterleitung` und `kurzParam` sind jetzt
  verdrahtet (Zeilen entfernt).

**Tests:**
- +4 in `app/test/ki-funk.test.ts`: Gateway nur aus Angebot mit Funk-Rolle
  und zumutbarer Rechenarbeit, Lesen verwirft Unbrauchbares; Weiterleitung und
  Auftrag gehen über Mesh (nur Umschläge, weder Identität noch Klartext noch
  Sitzungsschlüssel offen), das Gateway erfährt nur die Sitzung, der Provider
  den kurzen Auftrag mit Gutschrift im Kern, gratis ohne Gebot; Antwort aus dem
  Funk (Rückmeldung lässt offen, Ergebnis schließt, doppelt, fremde Sitzung,
  fremder Auftrag, kein Umschlag, nach der Stunde); verdrahtet (Funk-Antwort
  vor dem Weiterverteilen, kein Lightning im Funk-Pfad, erst merken dann
  senden, Gateway im Tresor, Kurs aus dem gemerkten Angebot).

Endstand: protocol 1081 (6 übersprungen) · node 241 (6 übersprungen, mit
Netz; ohne Netz 240 + 7) · app 518 (+4) · mls 13 · Leak-Tests 59 grün + 1 todo ·
0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5
Seiten ok · Smoke-Test bestanden. Knoten-Stand: für den Funk-Pfad ein Knoten
ab 7.4b2 mit `FUNK_GATEWAY`; sonst unverändert.

## Schritt 7.4c3 – KI über Funk: Oberfläche und ehrliche Texte

**Warum:** Mit 7.4c2 konnte die App über Funk fragen und Antworten zeigen – es
fehlte der Weg für den Menschen: ein Gateway wählen, solange Netz da ist, und
„über Funk“ fragen. Und überall stand noch „KI geht über Funk nicht“.

**Was:**
- **Seite Netz → Mesh, Karte „KI über Funk“** (`shell/funk-gateway-ui.ts`,
  aus `app.ts` nach `wireMeshTab()`): Gateways suchen (Angebote mit
  `["funk","gateway"]`), eines merken oder vergessen; der Stand nennt das
  Gateway, das Datum des Angebots und – ohne SOL-Kurs – „über Funk nur
  gratis“. Alles Fremde nur über `textContent`.
- **Agent:** „über Funk“ (`#ai-funk`) erscheint nur mit gemerktem Gateway.
  Gewählt, geht die Frage über `frageUeberFunk()`: erst prüfen, dass ein
  Funkgerät verbunden ist (`funkGeraetVerbunden()`, neu in Settings – sonst
  wäre eine Gutschrift gemerkt, die nie hinausgeht), dann `sendeKiUeberFunk()`
  mit Vorrang „Nachricht“ (`sendeUeberFunk()` hat dafür einen Parameter;
  Offline-SOL bleibt „Zahlung“). Nur die Frage reist – kein Verlauf als
  Kontext, jedes Byte kostet Sendezeit. Im Verlauf steht, wie es weitergeht:
  Antwort in einigen Minuten, nur solange die App offen bleibt, rund zwei je
  Stunde und Gateway.
- **Ehrliche Texte:**
  - Protokoll `offlineCapabilities()`: „KI-Anfragen“ gehen über Funk (ein
    Gateway), nicht per Datei oder Bluetooth von Gerät zu Gerät – mit Dauer,
    Grenze und Bezahlung; die App bildet den Satz in beiden Sprachen neu
    (`ps.ofKiText`, wortgleich geprüft).
  - Mesh-Text der Seite Netz: „Lightning geht so nicht; KI nur kurz über ein
    Funk-Gateway (unten).“
  - FAQ der Website: statt „KI-Anfragen auch nicht“ die kurze Anfrage über ein
    Gateway, was das Gateway sieht und dass eine lange Antwort über Funk mehr
    als eine Stunde Sendezeit bräuchte.
- 12 Texte der Karte, 4 im Agenten, beide Sprachen.

**Tests:**
- +1 in `app/test/ki-funk.test.ts` (verdrahtet): Wahl versteckt bis zum
  Gateway, Karte auf der Seite Netz, `wireFunkGateway()` aus `app.ts`, kein
  `innerHTML`, „über Funk“ vor dem Start eines normalen Auftrags, erst das
  Gerät prüfen, dann senden, kein Verlauf als Kontext, Vorrang als Parameter.
- `protocol/test/mesh-sync.test.ts`: Die Rechnung „500 Wörter brauchen mehr
  als eine Stunde“ bleibt; neu gerechnet wird eine Antwort mit 500 Zeichen als
  Umschlag (gut 15 s, zwei passen in eine Stunde). Der Test „Auskunft sagt bei
  jeder Strecke dasselbe über Lightning und KI“ prüft jetzt: Lightning nie, KI
  nur über Funk, überall derselbe Satz – die Karte 7.4 ändert genau diese
  Fähigkeit.
- Smoke-Test „rahmen“: die Karte ist auf der Seite Netz sichtbar, sagt „Kein
  Gateway gemerkt.“, und die Wahl im Agenten ist versteckt.
- Im Browser (de und en): Gateway gemerkt → Stand „Gemerkt: …, Angebot vom
  21.9.2026. Ohne SOL-Kurs – über Funk nur gratis.“, die Wahl erscheint;
  gesendet ohne Funkgerät → „Kein Funkgerät verbunden (Seite Netz → Mesh).“ im
  Verlauf; vergessen → Wahl weg, Eintrag gelöscht; keine Seitenfehler.

Endstand: protocol 1081 (6 übersprungen; zwei Tests geändert, weil die
Fähigkeit sich ändert) · node 241 (6 übersprungen, mit Netz; ohne Netz 240 + 7) ·
app 519 (+1) · mls 13 · Leak-Tests 59 grün + 1 todo · 0 rot · check-wiring
`--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test
bestanden (mit „funk“) · Browser-Probe auf dem letzten Stand (de/en) wie oben.
Damit ist 7.4 im Code fertig. Knoten-Stand: Gateway-Knoten ab 7.4b2 mit
`FUNK_GATEWAY`; ohne ihn bietet die Seite Netz kein Gateway an.

## Schritt C.2b1 – Oberfläche: Dialoge statt prompt() in Räumen

**Fertig:** C.2b ist geteilt (zusammen rund 700 Zeilen). C.2b1 bringt den
gemeinsamen Baustein `shell/dialog.ts` und ersetzt alle 16 `prompt()`,
`confirm()` und `alert()` in `shell/tabs/raeume.ts` (B7). Namen im Verlauf,
Gruppierung und Menüs folgen mit C.2b2.

**Einzelheiten:**
- **`dialog()`** baut nur mit DOM und `textContent` – Namen und Kennungen von
  anderen landen nie als HTML.
  - Barrierefrei: `role="dialog"`, `aria-modal`, `aria-labelledby`; der Rest
    der App ist solange `inert`.
  - Tastatur: Der Fokus bleibt im Dialog (Tab läuft im Kreis, `focusin` holt
    ihn zurück), Esc bricht ab, Enter bestätigt (mehrzeilig Strg+Enter).
    Danach kehrt der Fokus zum auslösenden Knopf zurück. Bei Löschen,
    Entfernen, Sperren steht er zuerst auf „Abbrechen“.
  - Felder: Text, mehrzeilig, Wahl, Mehrfachwahl, Nur-Lesen mit „Kopieren“.
    Pflichtfelder und Prüfungen melden sich im Dialog, statt ihn zu schließen
    (`pruefeWerte()`, rein).
  - Mobil erscheint er als Blatt von unten.
- **Räume:**
  - Einladen: Kontakt als Wahl oder Schlüssel (hex); nur ein gültiger
    Schlüssel schließt den Dialog.
  - Moderatoren: privat Häkchen je Mitglied (Admins vorgewählt; allein im Raum
    ein Hinweis statt eines leeren Dialogs); offen Schlüssel und Regeln in
    einem Dialog, jeder Schlüssel geprüft (früher fielen falsche still weg).
  - Moderieren: privat „für alle löschen“ oder „entfernen“; offen „ausblenden“
    oder „sperren“ samt Begründung in einem Dialog (früher: „Abbrechen =
    sperren“).
  - Melden: die sieben Gründe als Wahl mit Text; gesendet wird wie bisher die
    Kennung.
  - Anlegen: Hinweis und Name in einem Dialog; die Kennung eines offenen Raums
    zum Kopieren.
  - Beitreten: Kennung als Pflichtfeld.
  - Rauminfo: `privacyInfo()` im Dialog. Der Satz ist noch Deutsch – 8.16g2b2
    (Spur B) hat ihn nicht übernommen; C.2b2 bildet ihn in der App neu (B17).
- **Texte:** neu `texte/dialog.ts` (`dlg.*`) und `texte/raeume.ts` (`raum.*`);
  vorhandene Schlüssel dienen als Titel und Beschriftungen. Sieben Schlüssel
  der alten Eingabezeilen fallen weg: `komm.ausblendenOderSperren`,
  `moderierenWahl`, `meldenGrund`, `unbekannterGrund`, `einladenListe`,
  `werModerator`, `moderatorMarke`.
- **Nicht geändert:** Protokoll, Event-Formate, Moderationsbausteine; es
  gehen dieselben Events hinaus wie vorher. `moderiere()` sperrt den Absender
  über `buildBan(…, autor, …)` wie zuvor über `dataset.pk`. Der bisher
  unerreichbare Zweig „Rolle vergeben“ fragt ebenfalls per Dialog; einen Knopf
  bekommt er mit C.2d.
- **Screenshots:** `scripts/screenshots.py` nimmt jetzt auch Dialoge auf
  (vierter Eintrag: der Knopf, der ihn öffnet). Abgelegt in
  `docs/ausbau/bilder/c2b1/`: Beitreten und „öffentlich anlegen“ am Desktop,
  Anlegen und „öffentlich anlegen“ am Handy.

**Tests:**
- +6 in `dialog.test.ts`: Pflichtfelder, Wahl nur aus den Optionen, Prüfung
  über Felder, Aufbau ohne HTML, keine `prompt`/`confirm`/`alert` in
  `raeume.ts`, Meldegründe in beiden Sprachen.
- `leak/raum.test.ts`: Der Hinweis „öffentlich“ steht im Dialog, in dem der
  Name eingegeben wird; ohne Namen wird nichts angelegt (vorher: `confirm`).
- Smoke-Test „dialog“ (Desktop und Handy): per Enter öffnen, leer bestätigen
  meldet „Bitte ausfüllen“, Tab bleibt im Dialog, Esc schließt, Fokus zurück,
  `inert` wieder aus.

Endstand (nach dem Einmergen von `main` mit 7.4c3): protocol 1081 (6
übersprungen) · node 241 (6 übersprungen, mit Netz) · app 525 (+6) · mls 13 ·
Leak-Tests 59 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 · Website 5 Seiten ok · Smoke-Test bestanden (mit
„rahmen“ und „dialog“).

## Schritt 4.5a – Knoten: Auszahlung an die eigene Adresse

**Warum:** Seit 4.3c löst der Knoten Zahlkanal-Gutschriften mit seinem
Solana-Schlüssel ein – einem heißen Schlüssel auf dem Gerät. Was er verdient,
blieb dort liegen. Die Karte 4.5 wollte dazu frische Empfangsadressen je
Sitzung aus einem Knoten-Seed; der Zahlkanal bindet aber jeden Kanal an eine
Provider-Adresse (Seeds `["channel", customer, provider, nonce]`), frische
Adressen hießen je Adresse ein eigener Kanal und eine eigene Einlage.
**Entscheidung MENSCH 28.09.2026: Variante A** – eine Provider-Adresse je
Knoten, gebündelt an die eigene Auszahlungsadresse; die Grenze kommt in den
Datenschutzbericht (4.5b).

**Was:**
- **`node/src/sol-auszahlung.ts`** (`SolAuszahlung`): Guthaben minus Rücklage;
  nur über der Schwelle, höchstens einmal je Abstand – ein Versuch zählt auch,
  wenn er scheitert (kein Hämmern auf den RPC). Nie an ein Programm (Konto
  `executable`), nie an die eigene Adresse, Rücklage mindestens 0,001 SOL
  (Mietbefreiung 890.880 Lamports plus Gebühren). Ergebnis: Betrag und
  Signatur oder Betrag und Fehlername – nie Meldungen des RPC.
- **Standards:** Schwelle 0,1 SOL, Rücklage 0,01 SOL, Abstand 24 h; per
  Umgebung `KANAL_AUSZAHLUNG_SCHWELLE_LAMPORTS`, `…_RUECKLAGE_LAMPORTS`,
  `…_ABSTAND_SEK` (auch in `docker-compose.yml`).
- **Einrichtung** (`kanalKasseAusUmgebung()`): nur mit `NODE_SOL_PAYOUT`
  (gültige Adresse, nicht die eigene). Ist sie ungültig, läuft die Kasse
  trotzdem, nur ohne Auszahlung. **Aus neben LP oder Relayer:** beide laden
  denselben `SOLANA_KEYPAIR` – dessen Guthaben ist dann ihre Liquidität und
  darf nicht weg (LP nur mit `LP_SOL_MOCK=1` ausgenommen, der nutzt den
  Schlüssel nicht). Gesendet wird mit Vorabsimulation
  (`sendAndConfirmTransaction`, kein `skipPreflight`).
- **Verdrahtet:** `node/src/main.ts` – im Einlöse-Takt (alle fünf Minuten)
  nach `kanalKasse.loeseFaelligeEin()`: `await auszahlung?.pruefe()`; ins Log
  nur Betrag und Fehlername. Beim Start steht im Log, ob und wohin
  ausgezahlt wird oder warum nicht.
- **Keine Verteilung:** Der Knoten zahlt weiter nichts an andere aus (5.1.2).
  Er bringt nur eigenes Geld vom heißen Schlüssel weg; CLAUDE.md nennt das
  als einzige Ausnahme.
- **Doku:** `docs/ZAHLKANAL.md` (Im Knoten: Auszahlung, Grenze „eine Adresse
  je Knoten“), Karte 4.5 (Entscheidung, Aufteilung a/b), FORTSCHRITT (5.9 und
  6.3 aus der Zeile von Spur A – übergeben an Spur B, 28.09.).

**Tests:** +4 in `node/test/sol-auszahlung.test.ts`:
- unter der Schwelle nichts, darüber alles über der Rücklage – eine
  System-Überweisung an genau die eigene Adresse;
- höchstens einmal je Abstand, auch nach einem Fehlversuch; nach außen nur
  der Fehlername (die Meldung mit einer IP-Adresse erscheint nicht);
- nie an ein Programm, nie an sich selbst, keine Rücklage unter der
  Mietbefreiung, keine winzige Schwelle;
- Einrichtung: ohne `NODE_SOL_PAYOUT` aus, ungültig → Kasse läuft ohne,
  neben LP oder Relayer aus, mit Mock-LP an; in `main.ts` erst einlösen,
  dann auszahlen.

**Knoten-Stand:** Nur wer `ZAHLKANAL=1` und `NODE_SOL_PAYOUT` setzt, bekommt
die Auszahlung; ein Update des GX10 ist nicht nötig, bis das Kanal-Programm
deployt ist (MENSCH).

Außerdem `node/test/kanal-kasse.test.ts`: Der Verdrahtungstest aus 4.3c2
prüfte die Zeile in `main.ts` wörtlich; er lässt jetzt weitere Felder nach
`grund: kanalGrund` zu und prüft sonst dasselbe.

Endstand: protocol 1081 (6 übersprungen) · node 245 (+4; 6 übersprungen,
mit Netz) · app 525 · mls 13 · Leak-Tests 59 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website 5 Seiten
ok · Smoke-Test bestanden. Zahlkanal-Tests gegen den Validator nicht lokal
(Programm und `channel.ts` unverändert; die CI führt sie aus).

## Schritt C.2b2 – Oberfläche: Raum-Verlauf mit Namen, Aktionen, Raum-Menü

**Fertig:** Der Verlauf eines Raums steht gruppiert und mit Namen da, jede
Nachricht hat ihre Aktionen als Werkzeugleiste, der Raum hat ein Menü ▾. Die
Rauminfo spricht die Sprache der Oberfläche (B9, B17). Der neue Browser-Test
mit einem Probe-Raum fand zwei Fehler, die dieser Schritt mit behebt (B18,
B19).

**Einzelheiten:**
- **Verlauf** (`shell/tabs/raeume.ts`, `raum-verlauf.ts`):
  - Nachrichten desselben Absenders stehen unter einem Kopf, solange zwischen
    zweien höchstens fünf Minuten liegen und derselbe Tag ist.
    `gruppiereVerlauf()` ist rein; ein rückwärts laufender Zeitstempel beginnt
    eine neue Gruppe.
  - Zwischen den Tagen steht das Datum (`gebietsschema()`).
  - Namen über `kontaktName()`, die eigenen als „Du“; der volle Schlüssel
    steht im Titel des Namens.
  - Gebaut nur mit DOM und `textContent`. Die vier innerHTML-Ausnahmen des
    alten Verlaufs sind gestrichen.
- **Aktionen je Nachricht:** eine Werkzeugleiste mit denselben Wegen wie
  bisher (`moderiere()` im offenen, `raumAktion()` im privaten Raum).
  - Sichtbar beim Zeigen und mit dem Fokus; Tab erreicht die Knöpfe.
  - Mobil nach Antippen der Nachricht: Die Zeile nimmt den Fokus
    (`tabIndex = -1`), steht aber nicht in der Tab-Reihenfolge.
- **Raum-Menü ▾** (`shell/menue.ts`, `wireMenue()`):
  - Tastatur nach Menü-Muster: Pfeile, Pos1/Ende, Esc gibt den Fokus zurück,
    Tab oder ein Klick daneben schließt.
  - Die Knöpfe Einladen, Moderatoren, Beitreten und Anlegen stehen jetzt im
    Menü und behalten ihre IDs; die Leiste links (`rail-join`,
    `rail-create`) löst sie weiter aus.
  - Ein gewählter Punkt schließt das Menü in der Erfassungsphase, bevor sein
    Dialog öffnet – so kehrt der Fokus danach zum Menüknopf zurück.
- **Mitglieder und Meldungen:** Namen statt gekürzter Schlüssel; der
  Meldegrund steht als Text. Nur bekannte Kennungen werden übersetzt, Fremdes
  bleibt, wie es ist.
- **B17:** `kanalVertraulichkeit()` in `protokoll-texte.ts` (kleine Ergänzung
  in einer Datei der Spur B), auf Deutsch wortgleich mit `privacyInfo()`.
  - Die App ruft `privacyInfo()` nicht mehr auf.
  - Neue Zeile in `scripts/wiring-ausnahmen.txt` wie bei den anderen
    deutschen Referenzsätzen.
- **B19:** Beitreten und Anlegen wechseln gleich in den Raum.
  `setzeKommModus()` ist dafür aus `kommunikation.ts` exportiert. Vorher
  blieb der Chat bei den Direktnachrichten, bis man das Symbol des Raums
  antippte.
- **B18:** Bis 900 px zeigte ein Raum nie seine Nachrichten – `.channel-main`
  war ausgeblendet, `.showing-channel` setzte kein Code.
  - Jetzt ist ein geöffneter Kanal dort eine eigene Ebene.
  - „‹“ (`#channel-zurueck`) führt zur Kanalliste, der Fokus landet auf dem
    offenen Kanal.
  - Mitglieder und Thread als Ebenen bleiben bei C.2d.
- **Probe-Raum für Browser-Tests:**
  - `scripts/raum-probe.mts` signiert einen offenen Raum mit Wegwerfschlüsseln:
    zwei Kanäle, Rollen, fünf Nachrichten über zwei Tage, eine davon mit
    `<img onerror>`. Der eigene Schlüssel wird Moderator.
  - `ProbeRelay` in `smoke_test.py` beantwortet damit jede REQ;
    `screenshots.py` nutzt dieselbe Attrappe.
- **Screenshots** (`docs/ausbau/bilder/c2b2/`):
  - Desktop: Verlauf mit Datum, Gruppen und Namen, die Werkzeugleiste an
    einer Nachricht; das offene Raum-Menü.
  - Handy: Kanal als eigene Ebene mit „‹“, Aktionen nach Antippen; die
    Kanalliste mit dem offenen Menü.
- **CLAUDE.md:** Fallstrick „Räume im Browser-Test nur mit der
  Relay-Attrappe“.

**Tests:**
- +6 in `raum-verlauf.test.ts`:
  - Gruppen nach Absender und Abstand, Tag und rückwärts laufende Zeit;
  - Rauminfo wortgleich auf Deutsch, übersetzt auf Englisch;
  - Verlauf ohne `innerHTML` und `pkShort`, mit Namen und Werkzeugleiste;
  - Beitreten und Anlegen zeigen den Raum, mobile Ebene;
  - das Raum-Menü mit IDs und Tastatur.
- Smoke-Test „raum“ auf Desktop und Handy, siehe oben.

Endstand (nach dem Einmergen von `main` mit 4.5a): protocol 1081 (6
übersprungen) · node 245 (6 übersprungen, mit Netz) · app 531 (+6) · mls 13 ·
Leak-Tests 59 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 ·
innerHTML streng Exit 0 (70 Ausnahmen, 4 weniger) · Website 5 Seiten ok · Smoke-Test bestanden (mit „rahmen“, „dialog“
und „raum“).
