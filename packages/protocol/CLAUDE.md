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
- **Solana-Anweisungen nur als kit-`Instruction`** (seit A-21b1, `docs/KIT-PLAN.md`): neue Anweisungen über
  `@solana/kit` (`address()`, `AccountRole`, Konten über `konto()`), System-Anweisungen aus `@solana-program/system`
  (Unterschrift nur als Rolle über `createNoopSigner()`), Ed25519 nur über `ed25519Anweisung()` – web3.js bekommt sie
  nur über `alsWeb3()` (`kit-bruecke.ts`), bis A-21f die Brücke entfernt. Beide Pakete exakt gepinnt (kit 8.4.0,
  system 0.15.0). Die Bytes jeder Nachricht halten die Vektoren fest – ein neuer Weg, eine Nachricht zu bauen, braucht
  den Vergleich mit ihnen. `getProgramDerivedAddress()` ist asynchron; bis A-21f rechnet `kanalAdresse()` die PDA
  weiter synchron mit web3.js. Die App bekommt kit seit A-21b2 nur über `kit-bruecke.ts` (`AccountRole`, `Instruction`,
  `anweisung()`, `ueberweisungAnweisung()`) – dort weiterreichen, was sie braucht, nie eine eigene Abhängigkeit der App.

- **Einen Export entfernen heißt auch `contracts/` durchsuchen** (seit A-21b2): Die Validator-Tests
  (`contracts/solana-channel/tests/*.ts`) importieren direkt aus `packages/protocol/src`; `check-wiring.py` zählt sie
  nicht, und die Paket-Tests laufen ohne sie. Vor dem Entfernen `git grep -n <name>` über das ganze Repo (nicht nur
  `packages/`) und `npx tsc -p contracts/solana-channel/tsconfig.json` – A-21b2 entfernte `oeffneKanalIx()` & Co.,
  erst der CI-Job „Zahlkanal“ fand die Nutzer dort.
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
