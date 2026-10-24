# Protokoll (`packages/protocol`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter
`packages/protocol/` gelesen wird. Hier steht, was man nur in den Protokollbausteinen
falsch macht – verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag
mit „Weitere Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue
Fallstricke dieses Bereichs unten anhängen.

## Fallstricke

- **Kopfgelder nur über `kopfgeld.ts`** (seit E10a, Kind 38061): zugesagt in
  sats und/oder SOL, gebaut nur über `baueKopfgeld()`, gelesen nur über
  `leseKopfgeld()`/`aktuelleKopfgelder()` – der Stand gilt je Geldgeber und
  Kennung, nie nach der Kennung allein (sonst meldet ein Fremder ein Kopfgeld
  als erledigt). Bezahlt wird direkt vom Geldgeber an den Erlediger – kein
  Topf, keine Runde, nichts verwahrt (38059/38060 nicht wiederverwenden).
- **OpenTimestamps nur über `ots.ts`** (seit B-17a, 5.10b): Beweise lesen und
  schreiben nur mit `leseOtsDatei()`/`leseOtsZeitstempel()` und
  `schreibeOtsDatei()`/`schreibeOtsZeitstempel()` – Format wie python-opentimestamps, Grenzen
  aus `OTS_GRENZEN`, Fehler nur als `OtsFehler`-Kennung (nie Text aus dem Beweis). Bündeln
  nur über `buendele()` (je Wert eine Zufallszahl wie der ots-Client – der Kalender lernt
  keinen Wert), Kalender-Antworten nur über `fuegeEin()`. Eine ausstehende Attestierung ist
  nur ein Versprechen; „in Bitcoin verankert“ heißt erst, dass der Endwert der Merkle-Wurzel
  des Blocks gleicht – nie aus dem Beweis allein behaupten. Testvektoren nur mit
  `scripts/ots-referenz.py` neu erzeugen; die LGPL-Beispieldateien der Referenz nicht ins Repo.
  Kalender (seit B-17b1, K5 A) nur über `stempele()`/`reicheNach()` (`ots-kalender.ts`): gefragt
  wird nur `OTS_KALENDER`, nie eine Adresse aus einem Beweis; ein Stempel braucht zwei Antworten.
  Anfragen ohne Content-Type – die Kalender erlauben jede Herkunft, beantworten aber keinen
  Preflight. NIP-03 (Kind 1040) nur über `baueOtsBeweis()` (nur Bitcoin, `nurBitcoin()`) und
  `leseOtsBeweis()`; eine Höhe darin ist ungeprüft, bis der Blockkopf passt (B-17b2).
  „Verankert“ (seit B-17b2, K4 A) nur über `pruefeVerankerung()` (`ots-bitcoin.ts`): Blockkopf
  von beiden Explorern aus `OTS_EXPLORER`, nur gleich gilt er, und er prüft sich selbst
  (`leseBlockkopf()`: Hash gleich dem genannten, Arbeit, Ziel des Hauptnetzes). Fehlt einer oder
  sind sie uneinig: keine Aussage – nie auf einen Explorer allein ausweichen. Gefragt nur bei
  Bedarf; die Explorer sehen IP und Höhe. Node-`fetch` nutzt den Agent-Proxy nur mit
  `NODE_USE_ENV_PROXY=1` (und `NODE_EXTRA_CA_CERTS`) – Live-Proben sonst „nicht-erreichbar“.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Agenten in Räumen nur über `agent-karte.ts`** (seit 11.3b1, `docs/PROTOCOL.md` 32): Karte (38090)
  nur über `baueAgentKarte()`/`raumAgentKarte()`, gelesen nur über `leseAgentKarte()`/`aktuelleAgentKarten()`
  bzw. `raumAgentKarten()` (streng, je Agent die neueste); Autor ist immer der Agent, nie sein Ersteller.
  Einen Besitzer nur über `besitzerBestaetigt()` zeigen – die Karte allein behauptet ihn nur. Die Rolle nur
  über `mitAgentRolle()` (Grundrechte, Rang 1), nie mit Moderieren oder Vergeben. In privaten Räumen Karte und
  Liste nur als innere Events – Leak-Regel `agent-raum-privat`. Keine Persona und keine Systemanweisung in
  die Karte (F4 A).
  Wann ein Agent antwortet (seit 11.3b2) nur über `sollAntworten()` und `AuftragsBremse` – Agentenketten
  nur mit Schalter des Raums, aus einem Budget und unter der Grenze, gezählt aus dem Raum (`kettenLaenge()`),
  nie aus einer Angabe des Agenten. Kontext nur über `agentKontext()` (nie andere Kanäle, Räume, DMs), der
  Verweis nur im versiegelten Kern (`auftragsVerweisTags()`), Gutschriften des Monatsbudgets nur über
  `naechsteStufe()` (kumulativ, eine Stufe über dem Verbrauchten).
  Entscheiden, Prompt und Antwort-Event (seit 11.3d1a) nur über `agent-raum.ts` – App und Knoten teilen
  `entscheide()`, `agentPromptMit()`, `agentAntwortEvent()`; den Schalter der Ketten nur über
  `definitionDesGruenders()` (`d` ist `space:<kennung>` – bis 11.3d1a suchte die App nach der Kennung allein
  und fand ihn nie).
  Gruppen-Ids von MDK haben 16 Byte (32 Zeichen Hex) – im Verweis (`auftragsVerweisTags()`) wie bei Meldungen
  32 bis 64 Zeichen; bis 11.3d2b verlangte er 64, und keine echte Gruppe passte. Neue Prüfungen für Gruppen-Ids
  mit einer echten Gruppe testen, nicht mit `"ab".repeat(32)`.
- **Magnet-Links nur über `leseMagnet()`** (seit B-29c2a, `modell-torrent.ts`): Magnete sind Fremdtext –
  nur die Kennung `btih`, Tracker (udp, http, https, wss) und Web-Seeds (https), nie lokale oder private Hosts,
  nie `xs`/`as`; weiter geht nur der neu gebaute `link`. Seeds einer Fassung nur über `magnetQuellen()` mit
  `inhaltsKennung()` (gleich für jeden Herausgeber derselben Dateien) – Vertrauen braucht die Wahl nicht, die
  Bytes prüft das Manifest. Eine Base32-Kennung im Test nur mit `base64.b32encode` erzeugen.
- **Solana-Vektoren nie neu erzeugen** (seit A-21a, `docs/KIT-PLAN.md`): `test/fixtures/solana-vektoren.json` hält
  die Nachrichten aller Transaktionen fest, wie web3.js v1 sie baut (Eingaben in `test/sol-vektoren-faelle.ts` und
  `app/test/sol-vektoren-faelle.ts`). Der Umbau auf `@solana/kit` (A-21b–f) muss dieselben Bytes liefern – scheitert
  ein Vektor, ist der Umbau falsch, nicht die Datei. Eine neue Transaktion bekommt einen neuen Fall samt Eintrag.
  `HTLC_PROGRAM_ID` in der Umgebung ändert die LP-Vektoren – die Tests laufen nur ohne.
- **Repo-Aufträge an Agenten nur über `repo-auftrag.ts`** (seit 11.5b, `docs/PROTOCOL.md` 33): das Tag
  `["a", <repo>, "", "repo"]` nur über `repoAuftragTags()`, gelesen nur über `leseRepoAuftrag()` (genau ein Repo,
  höchstens ein Issue); zum Raum gehört das Repo nur über `repoImOffenenRaum()`/`repoImPrivatenRaum()`. Agenten
  pflegen nie (V6): Wer Rechte oder Status eines Raum-Repos rechnet und den Raum kennt, gibt `istAgent` mit –
  `patchStatus()`, `mitRaumRechten()`, `raumReposPrivat()` (offen `istAgentIm()`, privat die Agent-Karten der
  Gruppe). Ohne `istAgent` zählt ein Agent mit `repos_pflegen` oder als Admin wie ein Mensch.
  Den Code für den Agenten (seit 11.5c2a) nur aus `neuesterBundleVerweis()` (Eigentümer oder Pfleger, `d` = Kennung, mit
  Schlüssel); die Antwort nennt Patch und Ausgang nur über `agentAntwortEvent(…, { patch, fall })` (`fall` nur `repo.…`), im privaten
  Raum (seit 11.5c2b) über `raumAgentAntwort(…, { patch, fall })` – beide über `repoAntwortTags()`, `patch` ist dort die Id des inneren Events.
- **Solana-Anweisungen nur als kit-`Instruction`** (seit A-21b1, `docs/KIT-PLAN.md`): neue Anweisungen über
  `@solana/kit` (`address()`, `AccountRole`, Konten über `konto()`), System-Anweisungen aus `@solana-program/system`
  (Unterschrift nur als Rolle über `createNoopSigner()`), Ed25519 nur über `ed25519Anweisung()` – web3.js bekommt sie
  nur über `alsWeb3()` (`kit-bruecke.ts`), bis A-21f die Brücke entfernt. Beide Pakete exakt gepinnt (kit 8.4.0,
  system 0.15.0). Die Bytes jeder Nachricht halten die Vektoren fest – ein neuer Weg, eine Nachricht zu bauen, braucht
  den Vergleich mit ihnen. `getProgramDerivedAddress()` ist asynchron; bis A-21f rechnet `kanalAdresse()` die PDA
  weiter synchron mit web3.js. Die App bekommt kit seit A-21b2 nur über `kit-bruecke.ts` (`AccountRole`, `Instruction`,
  `anweisung()`, `ueberweisungAnweisung()`) – dort weiterreichen, was sie braucht, nie eine eigene Abhängigkeit der App.

- **Einen Export entfernen heißt auch `contracts/` durchsuchen** (seit A-21b2): Die Validator-Tests
  (`contracts/solana-channel/tests/*.ts`, seit A-28a `contracts/solana-htlc/tests/*.ts`, seit A-12a1
  `contracts/squads/tests/*.ts`) importieren direkt aus `packages/protocol/src`; `check-wiring.py` zählt sie nicht, und
  die Paket-Tests laufen ohne sie. Vor dem Entfernen `git grep -n <name>` über das ganze Repo (nicht nur `packages/`) und
  `npx tsc -p contracts/solana-channel/tsconfig.json` (beim HTLC `contracts/solana-htlc/tsconfig.validator.json`, bei der
  Kasse `contracts/squads/tsconfig.json`) – A-21b2 entfernte `oeffneKanalIx()` & Co., erst der CI-Job „Zahlkanal“ fand
  die Nutzer dort.
- **Solana lesen nur über `poolRpc()`** (seit A-21c, `kit-rpc.ts`): kit fragt die Kette nur über den `RpcPool`
  (`poolTransport()` → `pool.call()`), nie über `createSolanaRpc(url)` oder eine neue `Connection` zum Lesen – sonst fallen
  Ausweichen, eigene Endpunkte zuerst und die Stichprobe (5.8) weg. Die App nimmt `solRpc()` (`shell/state.ts`, der
  gemeinsame Pool), der Knoten `poolRpc(new RpcPool(…))`. Konten über `leseKonto()`/`leseProgrammKonten()` (Adressen per
  `address()` geprüft); was der RPC liefert, prüft der Aufrufer trotzdem (Eigentümer, Diskriminator, Länge). Daten einer
  Anweisung nur nach dem Format des Programms lesen: `claim` nimmt `[u8; 32]` ohne Längenpräfix – bis A-21c suchte
  `getRevealedPreimage()` vier Byte Länge und fand das Preimage nie. Im Test die Kette als JSON-RPC-Attrappe hinter einem
  echten Pool (`fetchImpl`), nicht als Objekt mit passenden Methoden – sonst prüft der Test kit und Pool nicht mit.
- **Cluster-Pairing nur nach E9-1** (`cluster.ts`, `docs/PROTOCOL.md` §36): das Angebot auf Kind 38028 (nie wieder 38026
  oder 38027 – Kurs-Ticker und Provider-Angebot), gelesen streng über `parseClusterOffer()`; die Absprache zweier Knoten nur
  versiegelt über `baueClusterAbsprache()`/`oeffneClusterAbsprache()` (innen 25050). Kein öffentliches Paar-Event, keine
  Bilanz, kein Vorrang daraus, keine Protokollgebühr – der Kunde zahlt nur den führenden Knoten nach A+.
- **Arbeitskopie nur über `arbeitskopie()`** (seit 11.5a1, `arbeitskopie.ts`): der Baum am Kopf nur aus dem Bundle
  (`kopfCommit()`, nie `head` aus dem Verweis), jeder Pfad nach `istRepoPfad()` (kein `..`, kein `.git` in keiner
  Schreibweise, keine Steuerzeichen), jeder Name einmal je Ordner, Grenzen je Stelle im Baum (`ARBEITSKOPIE_GRENZEN` –
  derselbe Ordner an vielen Stellen wären sonst Millionen Dateien aus wenigen Objekten). Fehlt ein Objekt, gibt es keine
  Arbeitskopie (`BundleFehler("kaputt")`), nie eine halbe. Den Bundle-Leser hat seit 11.5a1 das Protokoll – die App
  nimmt ihn von dort, die Probe-Bundles liegen in `protocol/test/fixtures/`.
- **Patches von Agenten nur über `schreibePatch()`** (seit 11.5a2a, `patch-schreiber.ts`): der Knoten baut den Patch,
  nie das Modell. Der Commit in der ersten Zeile wird wie bei git gerechnet (Bäume, Submodule unverändert, Autor =
  Committer, Nachricht so, wie `git am` sie liest) – ein Test wendet jeden Fall mit `git am --committer-date-is-author-date`
  an und vergleicht die Kennung; ändert sich die Form (Kopf, Betreff, Beschreibung), muss dieser Test grün bleiben.
  Betreff ohne `[…]`/`Re:`-Vorspann, Beschreibung ohne Zeilen, die git als Trenner, Diff oder Mbox liest (eingerückt).
  Binär, kein UTF-8 oder über `PATCH_MAX_BYTES` gibt es keinen Patch, nur den Fall. Text mit `TextDecoder` nur mit
  `ignoreBOM: true` – sonst fällt ein BOM still weg und der Patch passt nicht mehr (`alsText()` aus `git-bundle.ts`
  entfernt es, für die Anzeige richtig). Im Test heißt der Committer wie der Autor – `git am` nimmt ihn aus der Umgebung.
- **Negentropy nur über `negentropy.ts`** (seit B-35a, NIP-77, NG1 B): eigene Umsetzung, Byte für Byte wie die Referenz
  von hoytech – die Vektoren (`test/fixtures/negentropy-referenz.json`: Startwerte der Mengen, je Nachricht Länge und
  SHA-256) nur mit `scripts/negentropy-referenz.mjs` neu erzeugen (Referenz auf Commit und Prüfsumme gepinnt, in einer VM nur
  mit `crypto`). Der Port in nostr-tools (`nip77`) ist keine Referenz für die antwortende Seite – sie antwortet nie mit
  einer Id-Liste. Nachrichten von außen nur in `NEG_GRENZEN`, Fehler nur als `NegFehler` mit Kennung.
  Mit einem Relay (seit B-35c) nur über `WebSocketRelay.abgleiche()` bzw. `OutboxPool.abgleicheAn()`: je Abgleich eine
  neue `Negentropy` (sie merkt sich, wer begann – nach der Anmeldung neu beginnen), höchstens `NEG_CLIENT.runden`,
  `NEG-CLOSE` auch nach Fehlern. Ein Relay ohne NIP-77 antwortet oft gar nicht – das ist `neg.zeit`, kein Fehler des
  Relays (die App setzt ihn dafür nicht aus).
- **Transaktionen nur über `kit-transaktion.ts`** (seit A-21d1, `docs/KIT-PLAN.md`): bauen mit `baueTransaktion()` (Blockhash
  samt `letzteHoehe` oder Durable Nonce – kit setzt das Weiterschalten selbst an den Anfang, nie zusätzlich von Hand),
  signieren nur mit `signiereMit()` (`@noble/curves`, liefert `null` für eine Adresse, die die Nachricht nicht verlangt; eine
  neue Transaktion statt Änderung). Der Schlüssel dort hat 32 Byte – `Keypair.secretKey` von web3.js hat 64 (Schlüssel und
  Adresse), im Test `secretKey.slice(0, 32)`; den Schlüssel hält und nullt der Aufrufer, ein frischer für ein neues Konto nur
  über `neuerKontoSchluessel()`. `messageBytes` ist für kit nur lesbar – `@noble/curves` und `Buffer` bekommen
  `Uint8Array.from(…)`. Gelesen wird nur über `leseNachricht()` (legacy, Rollen aus dem Kopf), geschickt die Bytes aus
  `alsDraht()`.
- **Gegenproben mit Zufall nie an einem einzigen Fall** (gefunden 19.10.2026, `succession.test.ts`): „Diese Bytes mit der
  falschen Rechnung ergeben nicht das Geheimnis“ hing an einem zufälligen Dreier – ob er passt, hängt nur an den x-Werten
  der Bibliothek, für alle Bytes zugleich: etwa jeder 250. Lauf passte (in der CI rot). Was nur „meistens“ gilt, über alle
  Möglichkeiten prüfen (hier: nicht alle zehn Dreier) und die Rate einmal messen, bevor man sich auf sie verlässt.
- **Senden und Bestätigen nur über `kit-rpc.ts`** (seit A-21d3a): `sendeTransaktion()` schickt immer mit Vorabsimulation
  (nie `skipPreflight`), bestätigt wird nur über `warteAufBestaetigung()` – sie fragt nach, bis „confirmed“, und gibt den
  Fehler der Kette zurück (`null` heißt gelungen), statt zu werfen; über der letzten Blockhöhe ohne Bestätigung wirft sie
  `tx-abgelaufen` (nur für Blockhash, nie für Durable Nonce). kit liefert Zahlen in Fehlern als BigInt – `JSON.stringify()`
  wirft dann; als Text nur über `txFehlerText()`. Lehnt die Vorabsimulation ab, wirft kit einen `SolanaError` (-32002), der
  Fehler des Programms steht in `cause` (`context.code`), und der Pool reicht ihn nicht an den nächsten Endpunkt.
  Senden und Nachfragen einer Transaktion nur über `RpcPool.einVorgang()` (App: `solRpc({ einVorgang: true })`): Mit
  `verteilen` zieht der Pool je Anfrage neu – sonst sähen alle Anbieter die Signatur samt IP (4.9).
  Programmfehler (seit A-21d3b) nur über `programmFehlerCode()` – `typeof x === "number"` übersieht kits BigInt, und
  in der Vorabsimulation steht der Code nur in `cause`. Den Stand einer fremden Signatur nur über
  `leseSignaturStand()` (prüft die Form, bevor gefragt wird).
  Mit dem eigenen Schlüssel (Knoten, seit A-21e1) nur über `sendeMitSchluessel()` – bauen, signieren, senden, bestätigen;
  es wirft, wenn die Kette ablehnt (die Kasse gibt nur den Fehlernamen weiter). Schlüsseldateien von solana-keygen nur über
  `ladeSolanaSchluessel()` bzw. `solSchluesselAus()`: 64 Byte, der öffentliche Teil muss zum geheimen passen, zurück kommen
  der geheime Teil (32 Byte, hält der Aufrufer) und die Adresse – nie das ganze Array weiterreichen.
  Der HTLC-Adapter (`AnchorSolanaHtlc`) nimmt seit A-21e2 einen solchen `schluessel` und sendet über
  `sendeMitSchluessel()`; ein Relayer signiert fremde Transaktionen nur über `ausDraht()` → `signiereMit()` →
  `alsDraht()` (dieselbe Nachricht, die `pruefeRelayAuftrag()` gelesen hat). Die LP-Vektoren entstehen aus einer
  JSON-RPC-Attrappe hinter dem Pool (`sol-vektoren-faelle.ts`) – nie wieder eine Attrappe von `Connection`.
- **Kasse nur über `kasse.ts`** (seit A-12a1, `docs/KASSE-ENTWURF.md`): Squads v4 ohne SDK (W1 B) – Anweisungen nach der IDL
  2.1.0, Konten selbst gelesen (`leseKassenStand()`, `leseProgrammEinstellungen()`, Diskriminator und Länge geprüft, nur Konten
  von `SQUADS_PROGRAMM_ID`). Angelegt wird nur über `kasseAnlegenAnweisung()`: `config_authority` immer leer (V2), Mitglieder und
  Schwelle nur aus `kassenMitglieder()` (W2), Zeitschloss nur 0, 1 h oder 24 h (W3), Miete zurück in den Tresor, das Schatzamt aus
  den Einstellungen des Programms. Die Art einer Kasse nur über `kassenArt()` aus dem Stand auf der Kette, nie aus dem Raum. Die
  Vektoren „kasse-…“ rechnet das SDK von Squads (`@sqds/multisig`, nur außerhalb des Repos), nie `kasse.ts` selbst.
  Auszahlen (seit A-12a2) nur über `auszahlungVorschlagenAnweisungen()`, `abstimmenAnweisung()`, `ausfuehrenAnweisung()`,
  `abschliessenAnweisung()`; ausgeführt nur mit der `Auszahlung` aus `leseAuszahlung()` (Empfänger und Betrag von der Kette, V6).
  Die Nachricht hat zwei Formate: beim Anlegen das kompakte von Squads (Längen u8/u16, `auszahlungsNachricht()`), im Konto
  Borsh (Längen u32) – nie das eine mit dem Leser des anderen lesen. Eine Transaktion anderer Form ist keine Auszahlung (`null`).
  Im Raum (seit A-12b1, `raum-kasse.ts`, `docs/PROTOCOL.md` §42) steht die Kasse nur als Tag `kasse` in der Definition (offen die
  des Gründers, privat die eines Admins) – wer die Definition neu schreibt, gibt sie mit. Wer welche Adresse hat, nur über
  `kassenAdressenOffen()`/`kassenAdressenPrivat()` (Kind 34704, Nachweis: die Adresse signiert Ort und Schlüssel, eine doppelt genannte
  Adresse gilt für keinen), privat nur als inneres Event (`raumKassenAdresse()`); Abweichungen nur über `kassenAbweichungen()` – es
  zählt die Kette. `KASSEN_RECHT` (Bits bei Squads) ist nicht `RAUM_KASSEN_RECHT` (Recht im Raum).
  Die Transaktion zum Anlegen (seit A-12b2b) nur über `baueKasseAnlegen()`: frischer Create-Key, unterschreibt dort und wird
  genullt – er geht nie an die App. Miete nur nach `kassenKontoGroesse()` (der Validator-Test vergleicht sie mit der Länge des
  Kontos). Wer nur auf einer Kette handeln darf, baut seinen Pool aus `endpunkteImNetz()` (Genesis-Hash je Endpunkt) und ohne
  eingebaute Endpunkte (`new RpcPool([], …)`) – `new RpcPool()` ohne Liste nimmt `DEFAULT_MAINNET_RPCS`.
  Was mit einem Vorschlag geht (seit A-12c1), sagt nur `vorschlagsSchritte()` – die Regeln von Squads v4, im Validator in jedem
  Stand gegen beide Programme geprüft; eine neue Regel braucht dort einen Fall. Die Miete eines Vorschlags rechnet nur
  `auszahlungKontoGroessen()` (Validator vergleicht die Länge); ein anderer Zahler der Miete nur über `mietZahler` (Vektor
  „kasse-vorschlagen-mietzahler“ aus dem SDK). Ausführen und abschließen dürfen in eine Transaktion (Vektor
  „kasse-ausfuehren-abschliessen“) – das Programm sieht den Status „ausgeführt“ schon in der zweiten Anweisung.
  Konfiguration ändern (seit A-12a3) nur über `konfigurationVorschlagenAnweisungen()` mit Änderungen aus `kassenAenderungen()` (die
  Art bleibt), ausführen über `konfigurationAusfuehrenAnweisung()` (mit `mietZahler` – das Konto wächst um zehn Plätze auf einmal,
  `kassenKontoGroesseNach()`), abschließen über `konfigurationAbschliessenAnweisung()` – nie die Anweisungen der Auszahlung: Unter
  derselben Adresse steht eine VaultTransaction oder eine ConfigTransaction, gelesen nur über `leseVorschlaege()` (Diskriminator).
  Eine veraltete Änderung führt das Programm nicht mehr aus (eine Auszahlung schon); es prüft die Wartezeit vor dem Veralten
  (6021 vor 6007) – im Test Veralten ohne Wartezeit prüfen.
  Einen einzelnen Vorschlag (seit A-12d1) nur über `leseVorgang()` lesen – er unterscheidet Auszahlung und Änderung wie die Liste; die
  Miete einer Änderung nur über `konfigurationKontoGroessen()` (Kopf 85 plus Borsh-Länge jeder Änderung, der Validator vergleicht).
  Änderungen von der Kette können aus einem anderen Programm stammen: Ob die Kasse danach ihre Art behält, sagt nur `behaeltArt()` (false
  auch, wo das Programm ablehnte) – `kassenAenderungen()` gilt nur für Änderungen, die die App selbst zusammenstellt.
- **Text aus Sprache nur über `sprache-auftrag.ts`** (seit B-38b1, SP-W1 A, SP-W5 A, `docs/PROTOCOL.md` §43): Ton nur als WAV
  in genau der Form aus `baueWav()` (44 Byte Kopf, PCM, mono, 16 kHz, 16 Bit, höchstens 120 s) – `pruefeWav()` nimmt nichts
  anderes an, nie einen weiteren Container „zur Sicherheit“ dazu (der Knoten gäbe ihn sonst dem Modell). Der Auftrag (5083) nur
  über `baueSpracheAuftrag()`: versiegelt, mit Nachweis, ohne Gebot; der Schlüssel des Tons steht nur im Kern. Antworten nur über
  `leseTranskript()`. Zahlen in WAV nur über `DataView` mit Kleinendian (Regel „Kein `readBigInt64LE` im Browser“ gilt auch hier).
- **Whisper-Modelle nur über `modell-whisper.ts`** (seit B-38b3b1, V4, `docs/PROTOCOL.md` §43): ein Manifest mit `model`
  `whisper:<name>`, `upstream` `hf:ggerganov/whisper.cpp@<Commit>` und genau einer Datei `ggml-<name>.bin` – gewählt nur über
  `vertrautesManifest(…, whisperQuelle)`, nie über `hfQuelle()`. `.bin` gilt nur hier (`WHISPER_DATEI`) und nur mit der
  Kennung `ggml` am Anfang (`istGgml()`); `HF_DATEI` bekommt nie `.bin` dazu – dort wäre es Pickle. Der Stand von Hugging Face
  nur über `whisperStand()` (die eine Datei, nur mit LFS-Summe), geladen nur `whisperDateiAdresse()` (am Commit, nur dieses Repo).
- **Reticulum-Bausteine nur hier** (seit B-32d1, RN-W8 A, RN-W10 A): Regionen, Grenzen und Sendezeit in `funk-region.ts`,
  Identität und LXMF-Umschlag in `reticulum-umschlag.ts`, der Kern über der RNode in `reticulum-kern.ts` – App und Knoten
  (B-32d2) nehmen sie von hier, nie eine zweite Fassung. Die Bibliothek nur dynamisch laden (`import("@reticulum/…")`); ein
  App-Test zählt die Dateien, in denen der Name `@reticulum/` steht, und prüft, dass keine ihn statisch importiert – also auch
  im Kommentar nicht nennen. Jeder Pfad, den das Protokoll lädt, muss im Modul „reticulum-klein“ in `app/build.mjs` stehen.
  Die Typen der LXMF-Unterpfade kommen aus `reticulum-typen.d.ts` über `/// <reference path>` – App und Knoten übersetzen
  die Quellen des Protokolls mit, ohne die Referenz fänden sie die Deklaration nicht. Das Konto (`Sendezeitkonto`) gibt der
  Aufrufer mit: eines je Gerät und Sitzung.
- **Bitchat nur über `bitchat-paket.ts`** (seit B-36a1, BC-W1–W4 A, `docs/PROTOCOL.md` §45): eigene Umsetzung nach dem
  gemeinfreien Whitepaper – nie Code aus bitchat-android (GPL-3.0 seit 28.02.2026). Die Vektoren
  (`test/fixtures/bitchat-referenz.json`) nur mit `scripts/bitchat-referenz.sh` neu erzeugen (kotlinc und Commit gepinnt; der
  GPL-Code wird nur ausgeführt). Freedom packt nie: Bitchat signiert über eine neue Kodierung und packt dabei Nutzlasten ab
  100 Byte selbst – eine gepackte Fassung sähe anders aus als unsere, die Signatur gälte nicht. Eine Ankündigung ab 100 Byte
  signiert `signiereBitchat()` darum nie (ohne Nachbarn und Fähigkeiten bleibt sie darunter), über gepackte Nutzlast prüft
  `pruefeBitchatSignatur()` nie. Signiert wird mit TTL 0 und aufgefüllt (`bitchatSignierDaten()`), wie `toBinaryDataForSigning()`.
  Fragmente (seit B-36a2) höchstens 256 je Paket – mehr nimmt bitchat-android nicht an (das Format erlaubte 65 535);
  zusammengesetzt nur über `BitchatZusammensetzer` (Grenzen aus `BITCHAT_ZUSAMMENSETZEN`), das Ganze mit TTL 0: Weitergereicht
  werden die Fragmente, nie das zusammengesetzte Paket.
  Noise (seit B-36a3) nur über `bitchat-noise.ts`: der Handshake (`NoiseXX`) gegen die Vektoren von cacophony und snow – eine
  Änderung, die einen Vektor rot macht, ist falsch; der Transport nur über `BitchatTransport` (Nonce vorn, Fenster 1024). Ein
  gescheiterter Schritt beendet den Handshake (`abgebrochen`) – nie denselben weiterverwenden, sein Zustand ist halb
  fortgeschrieben.
  Fluten (seit B-36a4) nur über `bitchat-mesh.ts`: Doppeltes über `BitchatDoppel`, ob und mit welcher TTL über
  `bitchatWeiterreichen()` (Regeln von `RelayController`, im Test mit festem `zufall`), weitergereicht nur roh über
  `mitBitchatTtl()` – nie neu kodieren: Gepackte Nutzlast anderer entpackt Freedom nie, und eine neue Kodierung änderte die
  Bytes, über die geprüft wird. Über Bluetooth nur, was `bitchatFuerVerbindung()` liefert: je Wert ein ganzes Paket in der
  Grenze der Verbindung – bitchat-android setzt keine Stücke zusammen, ein geteiltes Paket ginge verloren.
  Zwischen Freedom-Kontakten (seit B-36c1, BC-W2 A, BC-W3 A) nur über `bitchat-kontakt.ts`: Noise- und Signier-Schlüssel nur
  versiegelt an Kontakte (`baueBitchatSchluesselUmschlaege()`, Kind 38083, je Kontakt ein Umschlag), gelesen nur über
  `oeffneBitchatSchluesselUmschlag()` – nie ein Merkmal in der Ankündigung, das „Freedom“ verriete. In der Noise-Sitzung nur
  der Typ `0xF0` mit genau einem Umschlag (`bitchatUmschlagKlartext()`/`leseBitchatUmschlag()`, beide über
  `pruefeMeshInhalt()`) – nie einen Typ, den Bitchat vergibt (0x01–0x09, 0x10–0x12, 0x20, 0x21), nie Klartext, keine
  Transaktionen.
  Ein Gerät im Netz (seit B-36c2a1) nur über `BitchatKnoten` – ohne Ein- und Ausgabe, Zeit und Zufall gibt der Aufrufer mit
  (Tests ein ganzes Netz ohne Bluetooth). Kontakte nur an einer gültig signierten Ankündigung mit BEIDEN Schlüsseln aus 38083
  (ein bekannter Noise-Schlüssel mit fremdem Signier-Schlüssel ist nicht der Kontakt). Weiterreichen in eine kleinere Grenze nur
  über `zerlegeBitchatRoh()` – die rohen Bytes, nie `zerlegeBitchat()` auf ein neu kodiertes Paket.
