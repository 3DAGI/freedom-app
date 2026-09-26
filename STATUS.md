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
