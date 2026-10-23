# Knoten (`packages/node`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter
`packages/node/` gelesen wird. Hier steht, was man nur im Knoten falsch macht –
verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag mit „Weitere
Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue Fallstricke dieses
Bereichs unten anhängen.

## Fallstricke

- **Kein Klartext im Knoten** (seit 3.3): Prompts und Antworten nie loggen (nur
  mit `klartextProtokoll`/`LOG_KLARTEXT=1`), nie in Dateien, nicht über die
  Antwort hinaus im Speicher halten – auch nicht als Gesprächsverlauf; den
  Kontext bringt die App (`kontextPraefix()`). Fehlermeldungen können Fremdtext
  tragen (URL mit Suchanfrage) – dann nur den Fehlernamen loggen.
  `node/test/klartext.test.ts` prüft das.
- **Gebühren nur über `aufteilung.ts`** – Einzige Ausnahme seit 4.5a: Der Knoten bringt **eigenes** Geld vom heißen
  Schlüssel an die eigene Adresse `NODE_SOL_PAYOUT` (`SolAuszahlung`, über
  der Schwelle, einmal je Abstand, Rücklage für Miete bleibt) – nie an andere,
  nie neben LP oder Relayer mit demselben `SOLANA_KEYPAIR` (deren Liquidität).
  Ebenso seit RM2b3 den eigenen Erlös des Cashu-Pfands an die eigene `NODE_LUD16` (`PfandKasse.zahleAus()`
  mit `rechnungVon()`) – nie an eine andere Adresse.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **Zahlkanal nur nach `docs/ZAHLKANAL.md`** – Kanäle nimmt der Knoten nur
  mit `ZAHLKANAL=1` und einem Schlüssel passend zu `NODE_SOL_ADDRESS`
  (`kanalKasseAusUmgebung()`); eine Gutschrift in einer offenen Anfrage wird
  abgelehnt.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `contracts/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
- **Mesh nur verschlüsselt** – Das Gateway im Knoten (seit 7.4b2, `gateway-role.ts`, `FUNK_GATEWAY`) hat
  denselben Schlüssel wie der Provider: an ihn Versiegeltes ist nur dann eine
  Weiterleitung, wenn der Kern Kind 25030 ist – alles andere geht ins Netz.
  Zurück nur über `GatewayBuch` (Post ab dem Auftrag, `ab`) und die
  Warteschlange mit Sendezeitkonto; eine Antwort mit 500 Zeichen kostet mit
  Meshtastic LongFast rund 30 s Sendezeit (16 Rahmen, seit 7.5d gerechnet) – etwa
  eine je Stunde.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **Werkzeuge nur in den Grenzen** (seit 8.7): Ausführung nur über
  `ToolRegistry.run` (Eingabe-, Zeit-, Ausgabegrenze aus `WERKZEUG_GRENZEN`),
  Netz nur über `safeFetch` + `leseBegrenzt`. Private Adressen nur mit
  `isPrivateAddress()` aus dem Protokoll prüfen – `new URL` schreibt
  IPv4-in-IPv6 als Hex (`[::ffff:7f00:1]`), eine Suche nach Punkten übersieht das.
  `file_io` je Auftrag (seit A-29): Der Provider gibt die Id der Anfrage als `auftrag` mit
  (`parseToolCalls()`), `FileIoExecutor` arbeitet dann nur in `<workspace>/<auftrag>` (0700),
  und nach den Werkzeugen löscht `ToolRegistry.vergiss()` den Ordner – auch wenn ein Werkzeug
  scheitert. Ein neuer Aufrufer gibt immer einen Auftrag mit; ohne teilten sich alle einen Ordner.
- **LP nur mit eingeschränkter Macaroon und mit Ablage** (seit 8.3a): Der
  Knoten startet den LP nur nach `pruefeLpMacaroon()` (genau `invoices:*`,
  `offchain:*`, optional `info:read`). Hinrichtung: erst ablegen
  (`hinSpeicher`), dann sperren; nach der Frist zuerst die SOL zurückholen,
  dann die Hold-Invoice abbrechen – nie umgekehrt. Fristen aus `this.jetzt()`.
- **Relay-Rolle nur nach den Regeln aus `relay-zugang.ts`** – Zugang nur über
  `RelayKasse` (seit 8.4b): bezahlt heißt, der eigene LND meldet die Rechnung
  beglichen bzw. die Kette zeigt die Überweisung mit der Referenz des Angebots
  (`pruefeSolUeberweisung(…, { referenz })`); eine Signatur löst nur ein
  Angebot ein; nach außen nur `KasseFehler`-Texte.
  Der Knoten liest und schreibt im eigenen Relay (seit B-9c1, L5 A) nur über
  `RelayRole.alsRelay()` – im Prozess, als mit seinem Schlüssel angemeldet,
  geschrieben über `aufnehmen()` wie über das Netz; `main.ts` ersetzt damit eine
  Verbindung zu sich selbst aus `RELAYS`. Keine zweite Annahme-Logik daneben.
  Seit B-23 auch mit Dauer-Abo (`subscribe`): erst Gespeichertes, dann jedes neue
  Event aus `verteile()` nach `darfAusliefern()`, zugestellt erst nach dem Annehmen
  (Mikrotask) – ohne lief ein Knoten nur mit eigenem Relay im Abfragetakt (bis 15 s).
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **Provider-Einrichtung nur geprüft** (seit 8.2a): Was ein Provider zum
  Verdienen braucht, prüft `pruefeEinrichtung()` (`node/src/einrichtung.ts`) –
  beim Start ins Log (`[einrichtung]`) und über `npm run pruefen` (Installer,
  Docker). Neue Voraussetzungen dort ergänzen, nicht nur im Installer; nach
  außen nur eigene Texte und Fehlernamen.
  Leere Werte aus der Umgebungsdatei (`SOLANA_RPC_URL=`)
  mit `||` behandeln, nicht mit `??`.
  Eigener Lightning-Empfang (seit 8.2b) nur über `LnurlDienst`
  (`lnurl-server.ts`): LND nur mit einer Macaroon für Rechnungen
  (`pruefeRelayMacaroon()`), Rechnung mit `createLnurlInvoice()` (Hash der
  Metadaten, LUD-06), Beträge nur als ganze msat im Bereich, Bremse je Minute,
  nach außen feste Texte. Kein Backend bei einem verwahrenden Dienst (Blink fiel
  mit 8.2b).
  Tor (seit 8.2c): Relay-Verbindungen des Knotens entstehen nur an einer Stelle
  (`main.ts`, `new WebSocketRelay(url, { verbinde })` mit `torWebSocket()`) – keine
  weitere ohne `verbinde`, ein Test zählt das. SOCKS5 nur mit Namen
  (Adresstyp 3), nie lokal auflösen; ungültiges `TOR_SOCKS` → kein Start.
  *(Weitere Teile: `scripts/CLAUDE.md`.)*
- **Flutschutz im Relay nur über `FLUTSCHUTZ`** (seit B-3, `relay-role.ts`):
  Grenzen je Verbindung (Events, Abfragen und Anmeldungen, offene Abos), je
  Schlüssel (gespeicherte Events, mit Zugang das Zehnfache) und für die Zahl der
  Verbindungen – über den `RateLimiter` aus `antispam.ts`, Fenster eine Minute,
  nach außen nur feste Texte nach NIP-01 (`rate-limited:`, `error:`), zu viele
  Verbindungen schließt der Relay mit 1013. Die Grenzen müssen einen Upload in
  Stücken durchlassen (Test mit 200 Stücken) – nie so eng, dass Anhänge und
  Bundles scheitern. Umschläge (1059) kommen von Wegwerf-Schlüsseln: sie bremst
  nur die Grenze je Verbindung. Zählstände vergisst `aufraeumen()`.
- **Knoten mit Besitzer koppeln nur über `kopplung.ts`** – Im Knoten (seit B-8b) liegt das Geheimnis nur in
  `~/.freedom/kopplung.json` (0600, `kopplung-datei.ts`), erzeugt und gezeigt
  nur über `npm run koppeln` (QR fürs Terminal mit `kopplungImTerminal()`),
  nie ins Log; der Provider liest es je Anfrage (`besitzer` in der
  Konfiguration) und rechnet den Besitzer gratis, ohne Gebot und Kontingent –
  eine offene Anfrage mit Nachweis lehnt er ab.
  Geweckt wird (seit B-12b) nur über `WeckDienst`: leer, mit `vapidKopf()`
  (ES256, `node:crypto`, `Topic`, TTL) und `sendePush()` (`checkUrlSafe()`,
  keine Weiterleitung); neu ist ein Umschlag nach Kennung, nicht nach Zeit –
  Umschläge sind bis zu zwei Tage zurückdatiert –, und was schon lag, als ein
  Schlüssel dazukam, weckt nie. Im eigenen Relay nur über `umschlaegeAn()`
  (Kennung, Zeit, Empfänger, nie Inhalt) – `alsRelay()` bleibt beim
  Knotenschlüssel. 404/410 → `vergiss()`; ins Log nie Adresse oder Meldung.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **App vom Knoten nur mit Prüfsumme** (seit B-10a, `node/src/app-auslieferung.ts`):
  Die Relay-Rolle liefert freedom.html nur als Ergebnis von `ladeApp()` aus –
  die Summe gibt der Betreiber vor (`APP_SHA256`), nie aus der Datei
  übernehmen; geprüft beim Start, danach nur aus dem Speicher (kein `readFile`
  beim Ausliefern). Mit `Accept: application/nostr+json` bleibt `/` NIP-11.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **Meshtastic nur über `meshtastic.ts`** – Im Knoten (seit 7.5d) nur über `meshtasticTcp()` (`FUNK_GATEWAY=meshtastic:host[:4403]`):
  dieselbe `MeshtasticSitzung`, je Verbindung neu gefragt; was fehlt, nur ins Log
  (`meshtasticBefunde()`, Fehler nur mit Namen) – der Knoten legt nie einen Kanal an. Die
  Gateway-Rolle rechnet Sendezeit, Wartezeit und Takt nur über `zeit()` (Strecke, sonst
  200 Byte/s).
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`, `scripts/CLAUDE.md`.)*
- **Modelle laden nur geprüft** – Geladen wird nur
  im laufenden Knoten über `ModellDienst` (`node/src/modell-laden.ts`) – `npm run modell` merkt nur
  den Wunsch vor (`modell-wunsch.json`) und verbindet sich mit keinem Relay (Tor, 8.2c). Ins
  Angebot kommt ein Modell nur nach `pruefeSchichten()` gegen die Schichten, die Ollama gemeldet
  hat, und nur solange `/api/tags` denselben Fingerabdruck nennt (`imAngebot()` bei jedem
  Angebot); `PROVIDER_MODELS` bleibt daneben. Der Provider nimmt Modelle nur aus `cfg.modelle()`.
  Nach außen und ins Log nur Kennung (`fall`), Zahlen, Fehlernamen, Modellnamen – nie Text aus
  Ollama oder der Registry. Die Registry ist aus dieser Umgebung nicht erreichbar – Live-Proben
  macht der MENSCH. Wie ein Modell steht (seit E9-3b), sagt nur `pruefeModelle()`
  (`modell-pruefung.ts`): Kennungen `modell.…`, Sätze nur in `MODELL_TEXT` (auch für `npm run modell`),
  die App hat je Kennung einen Text (`MODELL_TEXT` in `knoten-status-ansicht.ts`, ein Test vergleicht).
  Ein neuer Ausgang von `ladeModell()` braucht dort einen Eintrag (`modellFall()`). Im Status geht es
  als eigenes Feld `modellPruefung` hinaus, nie in `einrichtung` – sonst läse eine ältere App den
  ganzen Status nicht mehr.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
- **Der Systemprompt sagt nur, was stimmt** (seit B-27, Nutzertest A-7): gebaut nur über
  `systemPrompt()` (`inference.ts`) – die Werkzeuge genau der Anfrage (aus `getTools()`, mit
  `ohneWerkzeuge` keine), das heutige Datum (UTC); nie ein fester Knoten („GX10“), nie ein
  erfundener Wissensstand. Ein neues Werkzeug kommt über `getTools()` von selbst in den Prompt.
- **Schlüssel des Knotens nur über `ladeKnotenSchluessel()`** (seit B-40, `knoten-schluessel.ts`,
  Lauf 2 des lokalen Agenten): `NODE_SECRET_KEY` streng (64 Zeichen Hex, sonst kein Start), sonst
  `~/.freedom/node-key` (dieselbe Datei wie der Installer, 0600, nur der Knoten legt sie an – `npm run
  koppeln` nie). Eine defekte Datei nie ersetzen; ins Log nur Quelle und pubkey – bis B-40 schrieb der
  Knoten den geheimen Schlüssel ins Log und erzeugte ohne Variable bei jedem Start einen neuen (unter
  Docker immer).
- **Angeboten heißt ausgeliefert** (seit B-41, Lauf 2 des lokalen Agenten): Ohne angebotenen
  Modellwunsch antwortet der Provider mit dem ersten Modell aus `cfg.modelle()` – nie mit
  `OLLAMA_MODEL` des Backends, das nicht im Angebot steht. Ins Angebot kommt aus
  `PROVIDER_MODELS` nur, was Ollama bei jedem Erneuern unter genau dem Namen nennt
  (`nurBeiOllama()`, ohne Tag „:latest“); bliebe nichts, bleibt die Liste (nie still vom Netz),
  das Log nennt, was fehlt.
- **KI-Antrieb nur über `antriebAusUmgebung()`** (seit B-29a, `ki-antrieb.ts`): `KI_ANTRIEB=ollama`
  (Vorgabe, `OLLAMA_URL`) oder `openai` (vLLM, SGLang, TensorFold; `KI_URL` mit `/v1`). `KI_URL` nur
  über `lokaleAntriebAdresse()` – dieser Rechner oder das Heimnetz, ohne Zugangsdaten; ein Dienst im
  Internet wäre ein Dritter, der die Fragen liest. Ungültig → kein Start, nie still auf Ollama
  ausweichen. `KI_SCHLUESSEL` nur als Bearer an den Dienst (`antriebKopf()`), nie ins Log; Fehler des
  Dienstes nur mit Status, nie mit seinem Text. Aufrufe nur über `rufe()` in `OllamaBackend` – Ollama und
  OpenAI-kompatibel geben dieselbe Form zurück; die Antwort eines Werkzeugs trägt OpenAI-kompatibel die
  `tool_call_id` (`werkzeugRunde()`). Modelle kennt der Knoten über `antriebModelle()` (`/v1/models`
  ohne Fingerabdruck) – geprüft laden (`ModellDienst`) geht nur mit Ollama; `pruefeModelle(…, antrieb)`
  sagt das mit eigenen Kennungen, nie „geprüft“ für einen anderen Antrieb.
  Gemessen wird (seit B-29b) nur über `npm run messen` (`messung.ts`): derselbe Antrieb und Weg wie
  echte Anfragen (`complete()` mit `ohneWerkzeuge`), feste Übungsfragen, höchstens N zugleich
  (`missStufe()`), Fehler nur mit Namen, Antworten nie ausgeben. Tokens je Sekunde nur, wenn der
  Antrieb sie für jede Anfrage nennt – sonst „–“, nie hochrechnen.
- **Agent auf dem Knoten nur über `knoten-agent.ts`** (seit 11.3d1a, offene Räume, „wer fragt, zahlt“):
  `KNOTEN_AGENT=1` über `agentAusUmgebung()` (ungültig → kein Start), eigener Schlüssel nur über
  `ladeKnotenSchluessel(undefined, agentSchluesselDatei(), …)` – nie der des Knotens. Ein Auftrag mit Verweis
  (`leseAuftragsVerweis()`) nur aus einem Umschlag; geprüft über `KnotenAgent.pruefe()` nach der Zahlungsprüfung
  und vor dem Rechnen (`entscheide()` mit `ausBudget: false`), gerechnet nur `agentAuftrag.prompt` – nie die
  Eingabe des Auftrags, sonst ließe sich der Agent unter einer fremden Erwähnung alles sagen. Erst die Antwort im
  Raum (`antworte()`), dann das Ergebnis an den Fragenden; scheitert das Rechnen, gibt `gib()` die Erwähnung frei.
  Jede Erwähnung höchstens einmal (`agent-beantwortet.json`, nur Ids). Ablehnungen nur als `AgentAbgelehnt`
  mit `fall` – nie Text aus dem Raum oder von Relays.
- **Agent in privaten Räumen nur über `knoten-mls.ts`** (seit 11.3d2a, MENSCH 10.10.2026): nur mit
  `AGENT_PRIVAT` (`besitzer` – nur Einladungen von `AGENT_BESITZER`, `alle`), höchstens
  `KNOTEN_MLS_GRENZEN.gruppen`; eigenes MLS-Konto mit dem Schlüssel des Agenten, Kontobeweis über
  `signiereId()`. Ausnahme von „Kein Klartext im Knoten“, nur hier: Chat privater Räume hält der Knoten
  im Speicher (je Gruppe die letzten 50), nie in einer eigenen Datei, nie im Log; auf die Platte nur
  MLS-Zustand und Raumstand (`STRUKTUR`), verschlüsselt wie `MlsZustand` der App (`MlsAblage`,
  AES-256-GCM, Schlüssel in `agent-mls.json`, alles 0600) – eine beschädigte Schlüsseldatei heißt kein
  Start, nie ersetzen. Die Engine behält Verarbeitetes in ihrem Zustand und stellt es nach einem
  Neustart erneut zu: nie aus „neu“ im Abgleich schließen, dass etwas unbeantwortet ist. Fremde Relays
  einer Gruppe nur `wss://`, plausibel, über `pruefeRelay` (ohne Tor `checkUrlSafe()`) und nur über
  die Fabrik `relayAn` aus `main.ts` – die einzige Stelle mit `new WebSocketRelay(` (Test in
  `tor.test.ts`). Aufrufe des Kontos nur über `exklusiv()`. Test-Relays brauchen `wss://`-Adressen –
  MDK lehnt andere Schemata beim Gründen ab.
  Antworten in privaten Räumen (seit 11.3d2b) nur über `KnotenAgent.pruefePrivat()` – nur Gruppen, in
  denen der Agent Mitglied ist (`nutzePrivat()` nur mit dem Konto aus `AGENT_PRIVAT`), der Raum aus
  `gruppenRaum()` mit Admins und Mitgliedern aus MLS, Agenten an ihrer Karte, die Antwort nur als inneres
  Event (`raumAgentAntwort()` über `KnotenMls.sende()`) – nie offen. Fehlt die Erwähnung, einmal abgleichen.
  Der Kontext nimmt nur Nachrichten vor der Erwähnung; die Engine stempelt in Sekunden – im Test eine
  Sekunde dazwischen.
- **Gewichte von Hugging Face nur über `modell-hf.ts`** (seit B-29c1a, Quellen MENSCH 12.10.2026):
  Stand nur am Commit (`hfStand()`, `upstream` = `hf:<Kennung>@<Commit>`, nie ein Zweig), Dateien
  nur aus `HF_DATEI` – safetensors, Konfiguration, Tokenizer, oberste Ebene; nie Pickle (`.bin`,
  `.pt`), nie Python. Hugging Face nennt SHA-256 nur für LFS; kleine Dateien tragen nur die
  Git-Kennung (SHA-1) – nie als Summe ins Manifest, erst laden, `gitKennung()` vergleichen, dann
  selbst rechnen (`halteHfFest()`). Geladen nur über `ladeHfDatei()`: SHA-256 beim Laden, nie mehr
  Bytes als im Manifest, unter dem Namen erst nach der Prüfung (vorher `.teil`), Weiterleitungen nie
  von https zu http, ohne neue Bytes Abbruch nach `HF_STILL_MS`. Fehler nur mit Namen
  (`HfGesperrt`, `DateiAnders` …), nie Text von Hugging Face. Hugging Face ist aus dieser Umgebung
  nicht erreichbar – Tests gegen eine Attrappe auf 127.0.0.1, Live-Proben macht der MENSCH.
  Im Knoten (seit B-29c1b) nur über `ladeHfModell()` und nur mit einem OpenAI-kompatiblen Antrieb
  (`hf` in den `LaderHilfen` setzt `main.ts` nur ohne Ollama): Wünsche tragen `quelle: "hf"`, der
  Dienst lädt nur Wünsche seiner Quelle. Ins Angebot nur, solange `/v1/models` den Namen nennt und
  `ordnerAbdruck()` (Name, Größe, Zeit je Eintrag – liest keine Bytes) dem gemerkten gleicht; im Ordner
  nichts, was nicht im Manifest steht (`datei.fremd`) – vLLM liest alle safetensors des Ordners.
- **Modelle im Schwarm nur über aria2c und `modell-schwarm.ts`** (seit B-29c2b, MENSCH 12.10.2026): aria2c nur aus
  `starteAria2()` – JSON-RPC nur auf 127.0.0.1, das Geheimnis je Start neu und nur in `aria2.conf` (0600), nie auf
  der Befehlszeile (`ps`), nie ins Log; Fehler nur als `Aria2Fehler` mit Code. Laden nur über `holeUndTeile()`: nur
  die Dateien des Manifests (`waehleDateien()`: Name in der obersten oder zweiten Ebene, Größe gleich), jede mit
  SHA-256 geprüft, bevor sie in den Modellordner kommt (Verweis, nicht Kopie); Falsches löscht die Ablage. Teilen nur
  den Freedom-Torrent aus dem geprüften Ordner (`baueModellTorrent()`: Name = Commit, Dateien sortiert, Stückgröße aus
  `stueckGroesse()` – nie ändern, sonst teilen Knoten derselben Bytes verschiedene Schwärme). Ohne Einstieg
  (`dht-entry-point`) findet ein neuer Knoten im DHT niemanden. Tests mit echtem aria2c brauchen einen Tracker auf
  127.0.0.1 und Magnete ohne `leseMagnet()` (es weist lokale Tracker zu Recht ab); die CI installiert aria2.
  Verdrahtet (seit B-29c2c) nur in `main.ts`: aria2c nur mit `TORRENT=1` und `KI_ANTRIEB=openai` (Ollama hält seine
  Gewichte selbst), endet mit dem Knoten (`process.on("exit")`). `ladeHfModell()` fragt erst `schwarm.quellen()`
  (38058 über `magnetQuellen()`), dann den Magnet aus dem Wunsch (`--magnet`, etwa Pirate Face), dann Hugging Face;
  geteilt und gemeldet (38058 mit Magnet und `inhaltsKennung()`) wird nach jeder bestandenen Prüfung und beim Start
  für unveränderte Ordner – täglich nur neu gemeldet, nicht neu gelesen. Ein Fehler beim Teilen hält ein geprüftes
  Modell nie auf. Den Schwarm-Port öffnet `docker-compose.yml` nicht von selbst.
- **Projekte zum Vibecoden nur über `projekte.ts`** (seit A-31 VKc1, VK-W2 A): nur mit `VIBECODEN=1`
  (`projekteAusUmgebung()`, ungültig → kein Start) und nur, wenn `pruefe()` git findet – sonst keine Rolle
  „code“. Ordner nur unter `~/.freedom/projekte` (0700), Namen nur nach `istProjektName()`, nur echte Ordner
  (`lstat`, Verweisen folgt der Knoten nie). git nur über `ProjektAblage.git()`: `execFile` ohne Shell, leere
  Umgebung (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CEILING_DIRECTORIES`), das Repository
  ausdrücklich (`--git-dir`), feste `-c` vor jeder Datei (`GIT_FEST`: kein fsmonitor, keine Hooks, keine
  Signaturprüfung beim Lesen) – ab VKc2 schreibt ein Agent im Projekt, `.git/config` ist dann fremd: `git log`
  mit `log.showSignature` und `gpg.program` aus dem Projekt führte sonst ein Programm aus (Gegenprobe in
  `projekte.test.ts`). Neue git-Befehle nur über `git()` und mit Blick darauf, was sie aus der Konfiguration
  ausführen. Projektnamen sind Inhalt: Fehler des Dateisystems (tragen den Pfad) nur als `code-ablage`
  hinaus und ins Log, `outputPreview` nur mit Zahlen.
  Ein Projekt verlässt den Knoten (seit VKl) nur als Bundle über `ProjektAblage.bundle()` (git über `git()`, Datei
  mit Punkt neben den Projekten, danach gelöscht) und nur verschlüsselt ins Blob-Netz unter einem
  **Wegwerfschlüssel** (`bundleInsBlobNetz()`) – nie unter dem Schlüssel des Knotens, der Blob läge sonst neben
  seinem Angebot und verriete, wessen Knoten das Repo baute. Den Schlüssel bekommt nur der Besitzer versiegelt.
- **Mini-App für Telegram nur über `tmaAusUmgebung()`** (seit TMA-2, `tma-server.ts`, `docs/MINI-APP-TMA.md`): nur mit
  `FREEDOM_TMA=1` und gültigem Bot-Token (ungültig → kein Start), Host `127.0.0.1`, TON nur mit eigener
  `TON_DEPOT_ADDRESS` – nie eine Adresse einer anderen Kette als Rückfall (bis TMA-2 `NODE_SOL_ADDRESS`).
  Antworten nur über `antworte()` mit festen Texten; ins Log nie Telegram-IDs, `charge_id`, Kommentare oder
  Transaktionskennungen – nur Zahlen und Fehlernamen (`fehlerName()`); `~/.freedom/tma` 0700, Dateien 0600.
  Gebucht wird eine Zahlung nur einmal je `charge_id`, angenommen vor dem Bezahlen nur über `preCheckoutPasst()`
  (Sterne, bekannter Auftrag, genau sein Preis). `/` liefert nur `dist/tma/index.html`, nie den Web-Build.
- **Code-Läufe nur über `CodeLaeufe` und einen ACP-Motor** (seit VKc2, `code-motor.ts`, VK-W1n C): Der Knoten ist
  ACP-Client (`@agentclientprotocol/sdk` 1.8.0, exakt gepinnt; `client()`, nicht das veraltete `ClientSideConnection`),
  ohne Datei- und Terminal-Fähigkeiten – der Motor arbeitet selbst, in der Sandbox. Gestartet nur über eine `MotorStart`
  aus `main.ts`, und die gibt es nur mit Sandbox (VK4; VKb, VKc3) – nie `prozessMotor()` direkt auf dem Rechner. Die
  Sandbox bindet `.git` nur lesbar ein: Die Commits (`sichere()`) laufen im Knoten, ein Filter oder fsmonitor in
  `.git/config` liefe dort. Ein `auftrag` läuft im Hintergrund – `handleCode` wartet nie auf sein Ende, sonst hinge im
  Abfrage-Betrieb (`pollOnce`) jede Freigabe hinter ihrem Lauf. Schritte und Ergebnis gehen in einer Kette, versiegelt an
  den Sitzungsschlüssel; Updates verarbeitet der `onNotification`-Handler synchron, Commits nacheinander (zwei `git add`
  zugleich scheitern am Index), und die Freigabe-Anfrage wartet einen Takt (`takt()`), bis der Werkzeug-Aufruf davor
  verarbeitet ist – die Handler des SDK laufen nicht streng nacheinander. Eine Freigabe erst eintragen, dann melden: Ein
  `stopp` kann aus der Meldung heraus kommen. „fragen“ wählt nur „einmal erlauben“, nie „immer“. Die Uhren eines Laufs
  nicht mit `unref()` – sie halten den Knoten wach, solange er läuft, und enden mit ihm. Schritte aus dem Relay nie nach
  Ankunft ordnen: Umschläge tragen zufällige Zeitstempel (NIP-59) – es zählen `nr` und `art`.
- **Manifeste von Kuratoren nur über abonnierte Kataloge** (seit E9-4, `modell-kataloge.ts`): Welchen Katalogen der
  Knoten folgt, sagt nur `MODELL_KATALOGE` (`katalogeAusUmgebung()`, ungültig → kein Start, höchstens 20); gelesen nur
  gültig signiert und je Adresse der neueste (`holeKataloge()`), frei wird nur die Id im vierten Feld eines Eintrags
  (`KatalogFreigaben.fuer()` → `vertrautesManifest()`) – nie ein Schlüssel allein, nie ein anderes Manifest desselben
  Kurators. Antworten die Relays nicht, gibt es keine Freigaben (nie die von gestern). Den Lader erreichen Freigaben nur
  über `LaderHilfen.freigaben()`; `manifeste()` holt die freigegebenen Ids mit.
- **Speicher gratis nur bis zur genannten Grenze** (seit E9-2, V2 A): `STORAGE_GRATIS_MB` nur über
  `speicherGratisAusUmgebung()` (ungültig → kein Start), dieselbe Zahl für beide Speicher-Rollen in `main.ts` und das
  Angebot (vierter Wert im `storage`-Tag, `leseSpeicherGratis()`). `nimmAuf()` lehnt Stücke größerer Dateien ab
  (Größe aus `pruefeSpeicherStueck()`), nie die des Besitzers (`halten`). Eine netzweite Schwelle gibt es nicht mehr –
  `network-capacity.ts` nicht wieder einführen.
- **Code nur in der Sandbox** (seit VKb = 11.5s, `sandbox.ts`): Befehle nur über `fuehreAus()`, ein Motor nur über
  `sandboxMotor()` – nie `spawn` eines fremden oder vom Modell gewählten Befehls daneben, nie `prozessMotor()` allein.
  bubblewrap mit allen Namensräumen (`--unshare-all` und `--unshare-user`, kein Netz), leere Umgebung, nur lesbar
  `/usr` und die Wurzel (`--remount-ro /` zuletzt – sonst ist die tmpfs-Wurzel samt `/etc` schreibbar), aus `/etc`
  nur die drei eigenen Dateien und nur lesbar `/etc/alternatives` und `/etc/ld.so.cache` (ohne sie startet etwa
  `python3` nicht – unter Debian ein Verweis dorthin), schreibbar nur `/arbeit` mit `.git` nur lesbar. `ulimit` je Grenze ein Aufruf –
  dash nimmt nur eine. Geht bubblewrap nicht (`pruefeSandbox()`), läuft nichts; Sätze nur aus `SANDBOX_TEXT`.
  Tests mit echtem bubblewrap überspringen sich nur, wenn die Prüfung scheitert – die CI gibt Nutzer-Namensräume frei.
- **Arbeitsordner nur über `arbeitskopie.ts`** (seit 11.5a1): je Repo-Auftrag `neuerArbeitsordner()` (0700, in
  `/dev/shm`, wo es ihn gibt), geschrieben nur mit `schreibeArbeitskopie()` – nur in einen leeren, echten Ordner, jede
  Datei neu (`O_EXCL`, `O_NOFOLLOW`), Verweise zuletzt. Nach dem Auftrag `weg()`, auch wenn er scheitert. Liest der
  Knoten den Ordner danach (Patch, 11.5a2), nur mit `lstat` und Verweise als Text – der Agent legt in der Sandbox
  Verweise auf alles an, auch auf `~/.freedom`; wer ihnen folgt, packt den Schlüssel des Knotens in den Patch.
  Gelesen wird der Ordner nach dem Auftrag nur über `leseArbeitsordner()` (seit 11.5a2b): `lstat`, Dateien mit
  `O_NOFOLLOW`, Verweise als Text, `.git` und Submodule nie betreten, Ignoriertes nach `.gitignore` wie git
  (`istIgnoriert()` – ein ignorierter Ordner wird nicht betreten, außer git kennt Dateien darin). Ein Test vergleicht
  mit `git ls-files`; neue Regeln für `.gitignore` nur mit diesem Vergleich.
- **Abgleich (NIP-77) nur wie ein REQ** (seit B-35b, `relay-role.ts`): `NEG-OPEN` nimmt nur Events, die
  `darfAusliefern()` der Verbindung zeigen würde, und lehnt Filter auf Umschläge ohne Anmeldung ab
  (`brauchtAnmeldung()`) – ein Fingerabdruck verriete sonst, welche Umschläge an wen dort liegen. Offene Abgleiche zählen
  wie Abos, jede Nachricht wie eine Abfrage, höchstens `NEG_RELAY.events`; `NEG-ERR` nur mit festen Texten.
- **seccomp nur über `seccompFilter()`** (seit 11.5s2, `seccomp.ts`): cBPF ohne libseccomp, über `--seccomp 3` (Datei als
  `stdio[3]`, nach dem Lauf geschlossen). Zuerst die Architektur prüfen (sonst töten), auf x86_64 die x32-Aufrufe sperren;
  gesperrte Aufrufe ergeben `EPERM`, `clone3` `ENOSYS` (die C-Bibliothek nimmt dann `clone`, dessen Flags der Filter sieht).
  Nummern je Architektur aus den Kernel-Headern – nie von x86_64 auf arm64 übertragen. Netz-Aufrufe bleiben erlaubt:
  ohne Netz-Namensraum erreichen sie nur `lo`, und die Brücke zum Modell (VKc3) braucht sie. Speicher je Befehl nie mit
  `ulimit -v` – das bricht Node und WASM (sie reservieren viel Adressraum, ohne ihn zu belegen); seit 11.5s3 `ulimit -d`
  (`SANDBOX_GRENZEN.speicherKiB`, zählt seit Linux 4.7 nur privaten beschreibbaren Speicher). Der Motor bekommt alle
  Grenzen außer der Rechenzeit (`mitGrenzen(…, false)`) – er läuft so lange wie der Auftrag.
- **Prozesse je Befehl nur in der Sandbox begrenzen** (seit 11.5s4a, `SANDBOX_GRENZEN.prozesse`): `RLIMIT_NPROC` zählt
  seit Linux 5.14 je Nutzer-Namensraum – gesetzt in der Sandbox gilt es für alle Prozesse und Threads des Befehls, die des
  Knotens zählen nicht mit; nie vor `bwrap` setzen. Der Name des Schalters hängt an der Shell: bash und zsh `ulimit -u`,
  dash `ulimit -p` (bei bash ist `-p` die Pipe-Größe, nur lesbar – der Aufruf scheitert und mit `&&` liefe nichts), daher
  `{ ulimit -u N 2>/dev/null || ulimit -p N; }` (geschweifte Klammern, keine Subshell). Für den globalen root zählt der
  Kern keine Prozesse (`INIT_USER`) – der Container der Agenten läuft als root, dort überspringt sich der Test mit der
  Fork-Bombe; geprüft wurde er als `nobody` (`setpriv --reuid=65534 …`), die CI läuft ohne root. `pruefeSandbox()`
  meldet `root`, das Log warnt.
- **Pakete nur über `pakete.ts`** (seit 11.5n, W6a „So“): Die Sandbox bleibt ohne Netz, Pakete holt der Knoten vorher –
  nur aus `package-lock.json` (Fassung 2/3, `integrity` sha512) und `requirements.txt` mit `--hash=sha256` (`holeAusSperre()`)
  oder mit Namen und fester Version (`paketHolen()`, höchstens 20 je Auftrag, nur offene Räume – das prüft der Aufrufer).
  Nur GET von `PAKET_QUELLEN` (genau diese Hosts, https, ohne Port), ohne Weiterleitung; fehlt einem Paket die Prüfsumme
  oder kommt es von woanders, ist die ganze Sperrdatei abgelehnt. `tor` muss der Aufrufer nennen (`torAusUmgebung()`,
  sonst `null`) – mit Tor geht jeder Abruf über `torGet()`, nie direkt. Abgelegt erst nach der Prüfung (`O_EXCL`,
  `O_NOFOLLOW`, 0600): npm nach Inhalt (`npm/_cacache/content-v2/sha512/…`, wie der Cache von npm – so installiert
  `npm ci --offline --ignore-scripts --cache <ziel>/npm`), PyPI unter dem Dateinamen für `pip install --no-index
  --find-links`. Nie alle Räder einer Version holen – nur `passendeDateien()` (rein, sonst Linux/glibc, Prozessor,
  Python-Fassung, sonst Quellarchiv); npm-Pakete anderer Plattformen (`os`, `cpu`, `libc`) bleiben weg wie bei npm. Nach
  außen und ins Log nur `PaketAbgelehnt.fall` – Paketnamen verraten, woran gearbeitet wird.
  Im Repo-Auftrag (seit 11.5c3) nur über `bearbeiteRepo(…, { paketHolen })` und nur in offenen Räumen (`!a.gruppe` in
  `bearbeiteRepoAuftrag()`, `tor` aus `main.ts`): die Sperrdateien aus der Arbeitskopie im Speicher (`sperreAus()`, nie vom
  Ordner – dort könnte ein Verweis liegen), der Zwischenspeicher ein eigener Ordner im tmpfs, nur lesbar als `/pakete`
  (`nurLesbar`), danach `weg()`. npm braucht dann `npm_config_logs_dir` außerhalb des Caches. `paket_holen` erkennt nur
  `repoLauf()` (genau eine Zeile) und führt `paketHolen()` im Knoten aus – nie ein Werkzeug, das die Sandbox selbst aufruft;
  zum Modell nur Adresse und Prüfsumme oder die Kennung. Scheitert das Holen, läuft der Auftrag ohne Pakete (`pakete` im
  Ergebnis, Tag `pakete` in der Antwort).
- **Cashu-Pfand im Knoten nur über `PfandKasse`** (seit RM2b1, `pfand-kasse.ts`, `docs/PROTOCOL.md` §38): angenommen nur
  über `nimmAn()` – `pruefePfand()` gegen die gemerkten Schlüssel der Mints aus `ladeMints()` (nur Mints mit NUT-11, NUT-12
  und Schlüsseln in sat), Deckung je Sitzungsschlüssel der Anfrage (signiert, nie ein Schlüssel aus den Tags) und netto:
  Nennwert minus `input_fee_ppk` je Token (ppk sind msat). Ohne Deckung bleibt der Stand, wie er war; eine leere Liste legt
  kein Konto an. Alles in einer Datei (`pfandSpeicher()`, 0600, über eine Zwischendatei; kaputt → kein Start, nie
  ersetzen) – Pfand-Schlüssel, Seed, Token, gesehene Geheimnisse bis zur Frist, Konten, Erlös. Eingelöst nur über
  `loeseFaelligeEin()`: eine zur Zeit, je Mint gesammelt, ohne Beweis (V5), spätestens `PFAND_LETZTER_VERSUCH_SEK` vor der
  Frist – danach gehört das Token dem Rückweg des Kunden. Eigene Token nur aus dem Seed (NUT-13) mit Zählern in der Datei;
  scheitert ein Tausch (auch ohne Antwort), holt der nächste Lauf genau dessen Zählerbereich zurück (NUT-09) und prüft die
  eingesetzten Token – nie ab Zähler 0. Die Test-Mint verlangt 0,1 sat je Token: Beträge im Test aus den Token rechnen,
  nie fest.
  Im Provider (seit RM2b2) nur mit `pfandKasseAusUmgebung()` (`PFAND=1`, `PFAND_MINTS` wie im Angebot; ungültig → kein
  Start): Pfand nur aus einem Umschlag, nie neben einer Gutschrift, Deckung und Buchung nur als Anteil des Providers
  (`providerAnteilMsat()`), gebucht vor der Antwort. Mit `TOR_SOCKS` (seit RM2b3) jede Anfrage an eine Mint nur über
  `cashuUeberTor()` (`torAnfrage()`, Option `anfrage` der Kasse) – nie cashu-ts mit `fetch` daneben, sonst sähe die Mint
  die IP; ohne Proxy kein Start. Über den Provider geht nur eine Mint mit https oder .onion (`lesePfandTags()`) – im Test
  heißt die Test-Mint `http://….onion:<port>`, und die SOCKS-Attrappe (`test/socks-attrappe.ts`) führt den Namen nach
  127.0.0.1. Ausgezahlt wird nur über `zahleAus()` (NUT-05, ab `PFAND_AUSZAHLUNG_SCHWELLE_SAT`, Rechnung über genau den
  Betrag, abgesichert wie ein Tausch: `laufend` mit `woher: "erloes"`, eine noch unterwegs befindliche Zahlung (`PENDING`)
  hält `laufend` fest).
- **Keine Sitzung auf Kredit** (seit RM2c4a, `docs/RM2-ENTWURF.md` V7, RM2 B): Der Knoten bedient Aufträge nur mit Gebot,
  Gutschrift (Zahlkanal), Pfand (Cashu), SOL-Hinterlegung (`session` auf eine 38023, bis E8), als Besitzer oder gratis nach
  G1 – nie über eine Sitzung (38021) mit Budget ohne Deckung. Versiegelte Sitzungen und Belege (38021/38022) verwirft
  `oeffnePrivat()`; ein Auftrag mit `session` ohne Hinterlegung bekommt die Absage „bitte mit Gebot fragen“. Nicht
  wieder einführen: Schlüssel kosten nichts, jeder neue bekäme wieder Kredit.
- **Der Motor nur über `hermesMotor()` und die Brücke** (seit VKc3a, `hermes-motor.ts`, `modell-bruecke.ts`): Hermes läuft
  nur in der Sandbox (`sandboxMotor()`); sein venv (`HERMES_ORDNER`), das Startskript `motor/freedom_motor.py` und der
  Ordner des Sockets kommen nur lesbar hinein (`nurLesbar`, nie unter `/arbeit`). Das Modell erreicht er nur über
  `oeffneModellBruecke()` – genau `GET /v1/models` und `POST /v1/chat/completions` des eigenen Antriebs, der Schlüssel
  erst dort, Kopfzeilen aus der Sandbox nie weiter, nach außen feste Texte; nie der Sandbox das Netz geben. `config.yaml`
  schreibt der Knoten vor jedem Start neu ins Home des Projekts (`~/.freedom/hermes/<projekt>`, nie ins Repo) – nur in
  echte Ordner und ohne Verweisen zu folgen (`O_NOFOLLOW` nach dem Löschen): Das Home ist in der Sandbox schreibbar,
  ein Verweis auf `~/.freedom/node-key` ließe den Knoten sonst außerhalb schreiben. Den Projektordner sieht der Motor
  als `/arbeit` (`MotorVerbindung.ort` für `session/new`). Hermes fragt über ACP vor Änderungen an Dateien und vor
  riskanten Befehlen, mit eigener Kennung (`perm-check-N`, `edit-approval-N`) und nach 60 s abgelehnt – nie „jeder
  Befehl wartet“ versprechen. Hermes selbst läuft in dieser Umgebung nicht (Fremdcode); Tests ersetzen ihn hinter
  demselben Startskript, den Echttest macht der MENSCH.
- **Vibecoden unter Docker nur über `docker-compose.vibecoden.yml`** (seit VKc3b): Hermes kommt nur mit `VIBECODEN=1`
  ins Bild (`ARG`), nur aus `docker/hermes-requirements.txt` (`--require-hashes --only-binary :all: --no-deps`; neu
  erzeugen nur mit dem Befehl in `docker/hermes.in`). Die Sandbox braucht im Container das Profil
  `docker/seccomp-vibecoden.json` (Standard von Docker plus eine Regel am Ende: `clone`, `unshare`, `mount`, `umount2`,
  `pivot_root`, `setns`, `sethostname` – ohne `sethostname` scheitert bubblewrap an `--hostname`), dazu
  `systempaths=unconfined` (sonst „Can't mount proc“) und `apparmor=unconfined` (docker-default verbietet `mount`). Nie in
  `docker-compose.yml` selbst – der Standard bleibt bei den Regeln von Docker (`docker-vibecoden.test.ts`). In dieser
  Umgebung baut ein Bild nur mit dem Zertifikat des Proxys (`--build-context`, nicht im Repo) und dem Basisbild von
  `mirror.gcr.io` (Docker Hub antwortet mit 429).
- **`kill()` nur mit pid** (seit VKc3b): Scheitert `spawn` (Programm fehlt), hält Node bis zum Ereignis „error“ noch
  den Griff, und `kind.kill()` schickt `kill()` an eine nie gesetzte pid. Steht dort 0 oder -1, geht SIGTERM an die
  ganze Gruppe bzw. jeden Prozess des Nutzers – so endete in der CI zweimal der Runner („received a shutdown signal“),
  ohne einen roten Test. Vor jedem `kill()` `lebt(kind)` (`code-motor.ts`) bzw. `kind.pid !== undefined`. Tests, die einen fehlenden
  Motor beenden, zählen `kill()` ohne pid (`killOhnePid()` in `hermes-motor.test.ts`), statt ihn zu senden.
- **Freedom-MCP nur über die Brücke** (seit VKd1, `freedom-mcp.ts`): Werkzeuge des Knotens bekommt der Motor nur als
  MCP-Server hinter `oeffneModellBruecke(…, { mcp })` – genau `POST /mcp`, eine JSON-RPC-Nachricht, Antwort als JSON
  (Benachrichtigungen 202, GET und DELETE 405, ohne `Mcp-Session-Id` – sonst öffnete der Client von Hermes einen
  GET-Strom), höchstens `BRUECKE_GRENZEN.mcpBytes`. Ausgeführt nur über `ToolRegistry.run` (Grenzen, `safeFetch`);
  Fehler eines Werkzeugs nur mit dem Fehlernamen ins Ergebnis, nie ins Log – Suchanfragen und Adressen sind Inhalt des
  Projekts. Hermes findet den Server über `mcp_servers` in `config.yaml`, nicht über `session/new` (Hermes 0.19 kündigt
  `mcpCapabilities.http` nicht an). Die Sandbox bleibt ohne Netz; Hermes fragt vor MCP-Aufrufen nicht (VKd-W1, wie
  Claude). Deshalb liest `read_page` seit VKd1b nur Adressen, die `LeseFreigaben.darf()` kennt: aus dem Auftrag
  (`CodeLaeufe` → `beimAuftrag`) und aus Ergebnissen von `web_search` – nie aus gelesenen Seiten, sonst baute eine Seite
  dem Agenten die Adresse zum Hinausschleusen. Ein neues Werkzeug, das Adressen abruft, gehört hinter dieselbe Prüfung.
- **Verlauf, Diff und Zurück nur über `ProjektAblage`** (seit VKe2a, `PROTOCOL.md` §34): Ein Commit aus einem Auftrag
  gilt nur nach `eigenerCommit()` – `istCommit()`, `cat-file -t` ist `commit`, und er führt zu `HEAD` (`merge-base
  --is-ancestor`); sonst `code-commit`, nie Text von git. Der Diff nur über `git format-patch` mit `--no-ext-diff
  --no-textconv` (Diff-Programme und Umwandlungen kämen aus dem Projekt) und gekürzt nach JSON-Länge (`CODE_GRENZEN.diff`
  – der Umschlag fasst 65 535 Byte, Sonderzeichen werden länger). „Zurück“ setzt nie zurück: `read-tree -u --reset` und ein
  neuer Commit „Zurück auf <kurz>“, damit auch das Zurück sich zurücknehmen lässt – und nie, solange im Projekt ein Lauf
  geht (`CodeLaeufe.laeuftIn()`, sonst `code-belegt`).
- **Vorschau nur über `VorschauServer`** (seit VKg1a, `vorschau.ts`, `PROTOCOL.md` §34): eigener Port (`VORSCHAU_PORT`), nie
  der von Relay und App – sonst teilte die Vorschau den Ursprung mit freedom.html. Zugang nur über das Zeichen je Projekt
  (32 Zufallsbyte, `adresse()`, nur versiegelt an den Besitzer) und danach das Cookie; die Weiterleitung nie auf `//host`
  oder `/\host`. Dateien nur über `finde()`: kein Name mit Punkt am Anfang, jeder Teil des Pfads mit `lstat` (ein Verweis
  heißt „gibt es nicht“), geöffnet mit `O_NOFOLLOW | O_NONBLOCK` (ein FIFO hielte den Server an), unter Linux danach der
  echte Ort über `/proc/self/fd` – der Agent schreibt im Projekt und könnte zwischen `lstat` und `open` tauschen. Im Test
  Pfade mit `node:http` schicken, nie mit `fetch`: Der glättet `..`, `%2e%2e` und Rückstriche, bevor sie ankommen.
- **MCP-Server für den Motor nur über `mcp-katalog.ts`** (seit VKk1, `docs/VIBECODEN-ENTWURF.md` VKk): Hermes startet
  sie selbst, als Kind in seiner Sandbox (`hermesMotor({ mcp })` → `mcp_servers` in `config.yaml`) – nie ein Server im
  Knoten oder daneben. Was ein Server braucht, kommt nur lesbar hinein (`McpServer.nurLesbar`, unter `/usr` schon
  sichtbar) – nie die Wurzel, das Home oder ein Ordner darüber (`OrdnerZuWeit`: ein `MCP_BROWSER=~/chrome` bände sonst
  `~/.freedom` mit dem Schlüssel ein), Werkzeuge nur aus seiner Liste zum Erlauben (`tools.include`) – nie eines, das beliebigen Code im Server
  ausführt (`browser_run_code_unsafe`). Die Liste gilt für die gepinnte Fassung (`playwright` exakt 1.62.1); der echte
  Test vergleicht sie mit `tools/list` – eine neue Fassung bringt neue Werkzeuge erst nach einem Blick darauf. Der Browser
  ist Playwright MCP aus `playwright-core` (`lib/entry/mcp.js`, kein `@playwright/mcp` daneben): `--headless --isolated
  --no-sandbox` (Chromium dürfte in unserer Sandbox keine Namensräume anlegen), `--output-dir` im tmpfs (sonst landen
  Bildschirmfotos im Commit), nie `--caps`, `--port` oder `--allow-unrestricted-file-access`. Snapshots nennen Elemente
  mit Präfix (`ref=f49e3`), `browser_click` nimmt sie als `target`. Kiwix (seit VKd2a) bekommt der Motor nur mit den
  ZIM-Dateien aus `mcp.json` (`McpServerEinstellung.zim`, schon von `mcpAusDatei()` geprüft) und der Brücke aus B-31b –
  keine zweite Liste, `MCP_KIWIX` kennt nur `aus`; die Werkzeuge kommen aus `WERKZEUGE` der Brücke, nie abgeschrieben.
- **MCP-Server für das Modell nur über `mcp-client.ts`** (seit B-31a, MC1-Größe B): eigener Client ohne SDK – keine
  Abhängigkeit dafür einführen. Server nur aus `~/.freedom/mcp.json` (`mcpAusDatei()`), gestartet nur über
  `starteMcpServer()` in `sandboxMotor()` – nie ein Server außerhalb der Sandbox, nie mit Netz. Eingebunden wird nur
  lesbar und nie die Wurzel, das Home, ein Ordner darüber oder `~/.freedom` (`zuWeit()`, auch der Ordner des Programms
  außerhalb von `/usr`, auch hinter Verweisen – `realpath`). Namen fürs Modell höchstens 64 Zeichen
  (OpenAI-kompatibel). Das Modell erreicht sie nur über `McpWerkzeuge` (`OllamaBackend.mcp`): Namen
  `mcp__<server>__<werkzeug>`, Grenzen aus `WERKZEUG_GRENZEN`, Fehler nur als feste Texte – nie Text des Servers außer
  dem Ergebnis selbst, nie Ein- oder Ausgaben ins Log. Die Server des Motors (Hermes, VKk) sind ein anderer Weg
  (`mcp-katalog.ts`).
- **Gruppenanrufe nur über `livekit.ts`** (seit B-34a, LK2–LK4 A): Der SFU ist `livekit-server` als eigener Dienst
  (Profil „livekit“, Datei nur aus `scripts/livekit-einrichten.sh`: 0600, Signal nur auf 127.0.0.1, kein eigener TURN,
  kein Redis, Protokoll ab `warn`) – keine npm-Abhängigkeit, das JWT rechnet `livekitToken()` mit `node:crypto` (HS256,
  `iss` = API-Schlüssel, `sub` = zufällige Kennung, `video` nur für diesen Raum, nie Verwaltungsrechte). Zugänge nur mit
  `livekitAusUmgebung()` (nie halb) und nur an den Besitzer aus einem Umschlag (5081, `istBesitzer()`), je Anfrage frische
  Kennungen, höchstens `LIVEKIT_GRENZEN.teilnehmer`; Geheimnis und Zugänge nie ins Log. Wie bei TURN zählen sie nicht als
  Aufträge (`zaehle()`). Eine neue Rolle im Status braucht einen Text in `ROLLEN_TEXT` der App.
- **Kiwix nur über die eigene Brücke** (seit B-31b, `mcp/kiwix-bruecke.mjs`): in `mcp.json` nur `"kiwix": [ZIM-Dateien]` –
  der Knoten setzt Brücke und `kiwix-serve` (`KIWIX_SERVE`, Debian `kiwix-tools`, GPL-3.0+, eigenes Programm) selbst ein,
  nur in der Sandbox (`starteMcpServer()`), ZIM-Ordner nur lesbar und nie zu weit (`zuWeit()`). Die Brücke ist reines
  JavaScript ohne Pakete (läuft ohne tsx), schreibt nie nach stderr, gibt `kiwix-serve` keine Ausgabe, startet ihn nur auf
  127.0.0.1 mit `--blockexternal` und `--attachToProcess`; gelesen wird nur ein Pfad aus der Suche (`istArtikelPfad()`),
  Umleitungen nur auf denselben Ursprung. Ihre stdout ist der MCP-Kanal – nie etwas anderes dorthin schreiben. Fehlt das
  Programm, wirft `starteMcpServer()` `ProgrammFehlt` (`braucht`). Tests bauen das ZIM mit `zimwriterfs` (`zim-tools`).
- **Signalverbindung zum Gruppenanruf nur über `SignalWeiterleitung`** (seit B-34e1, LK5 A, `signal-weiterleitung.ts`,
  `docs/PROTOCOL.md` §41): Zeichen nur über `vergib()` aus `handleSignal()` (5082, aus einem Umschlag, `istBesitzer()`),
  nur im Speicher, höchstens bis zum Ablauf der Einladung und einen Tag. Der Relay gibt nur `/signal/…` an `weiter()` –
  alles andere bleibt Nostr (`WebSocketServer` mit `noServer`, eigener `upgrade`-Handler; mit `server` lehnte `ws` fremde
  Pfade mit 400 ab). Zum SFU nur über `verbinde` aus `main.ts` (mit Tor `torWsVerbindung()`, sonst `direktVerbinden` nach
  `pruefeZiel` mit `checkUrlSafe()`) – nie ein zweites `new WebSocket(` in der Datei, ein Test zählt. Weiter gehen nur
  Pfad und Anfrage, nie Kopfzeilen des Browsers; abgelehnt nur mit festem Status, nie Text vom SFU. Was der SFU gleich
  nach dem Öffnen schickt, kommt vor dem Browser an (`resume` läuft per `nextTick` vor der Fortsetzung nach `await`) –
  `oeffne()` hebt es auf, bis `verbinde()` es zustellt. Die Anfrage trägt den Zugang zum Anruf: Adressen nie ins Log.
- **Pakete nur über den Spiegel der Brücke** (seit VKd3, `paket-spiegel.ts`): npm und pip im Motor finden die Registry nur über
  `.npmrc` und `pip.conf` im Home (`paketKonfiguration()`, geschrieben wie `config.yaml` über `schreibeInsHeim()` – nie durch
  einen Verweis). Der Spiegel nimmt nur `GET`/`HEAD` auf `/npm/…` und `/pypi/simple|files/…` (`spiegelZiel()`), holt nur über
  `holeOderFehlt()` von `PAKET_QUELLEN` und schreibt Adressen in Paketlisten und Index auf die Brücke um (`aufDieBruecke()`),
  Archive nie. Ein neuer Weg nach draußen kommt nie als weiterer Pfad an die Brücke, sondern als eigene Entscheidung (VK-W4 B,
  „Internet frei“). Node liegt in der Sandbox nur, wenn es unter `/usr` liegt (Docker-Bild: `/usr/local`) – im Test mit
  `/opt/node22` dieses zusätzlich nur lesbar einbinden.
- **Dev-Server der Vorschau nur über `DevServer`** (seit VKg1c, `dev-server.ts`): Gestartet wird nur `npm run dev` aus einer
  echten `package.json` (`devBefehl()`), nur über `sandboxDienst()` (ohne Netz, ohne Grenze der Rechenzeit, Ausgabe nirgends
  hin) und nur, wenn die Sandbox geht. Erreicht wird er nur über `freedom_motor.py --zurueck` an einem Socket in einem Ordner,
  den der Knoten anlegt und nur dieser Sandbox schreibbar gibt (`schreibbar`) – nie ein Socket im Home oder im Projekt, dort
  könnte der Agent einen Verweis auf einen fremden Socket legen. Die Vorschau leitet mit `devKopf()` weiter (Host und Origin
  `localhost:5173`, sonst lässt Vite nichts durch, ohne das eigene Cookie) und ohne Agent (`agent: false` – ein Pool hielte
  Verbindungen offen). WebSocket: Sockets des HTTP-Servers bleiben halb offen; endet eine Seite, beide beenden – sonst
  wartet `close()` ewig (so hing der erste Test).
- **TURN für die Sandbox nur über `turn-tunnel.ts`** (seit VKg2a1): Die Sandbox bekommt einen Zugang zum TURN nur zusammen
  mit dem Tunnel (`oeffneTurnTunnel()`, Socket in einem eigenen Ordner) – nie Netz und nie den TURN direkt. Ein Zugang ist
  sonst ein Weg ins Internet (UDP), auch für den Code des Projekts, der ihn in derselben Sandbox lesen kann. Der Filter lässt
  nur eine UDP-Allokation durch und Gegenstellen nur aus `relayAdressen()` des Angebots der App; neue STUN-Methoden nur mit
  Blick darauf, wohin sie vermitteln. ChannelData mit Nummern bis 0x7FFF: coturn vergibt sie wie RFC 5766, nicht nur bis
  0x4FFF wie RFC 8656 – so verlor der erste Test mit `turnutils_uclient` alle Pakete.
- **Bildstrom nur über `BildStrom`** (seit VKg2a2, `bildstrom.ts`): zwei Sandboxen – das Bild (`motor/freedom_bild.py`,
  `mitEinAusgabe`, Tunnel aus `turn-tunnel.ts`) und das Programm des Projekts (`bildBefehl()`, ohne Ein- und Ausgabe);
  gemeinsam nur der Ordner mit dem Socket des Bildschirms (`/tmp/.X11-unix`). Nie das Programm in der Bild-Sandbox
  starten: Es könnte den Zugang zum TURN lesen oder eine Antwort an die App unterschieben (andere Gegenstelle, Daten in
  ICE-Feldern). stdin der Bild-Sandbox bleibt offen – `end()` beendet das Bild sofort (so hing der erste Ende-zu-Ende-Test).
  PyGObject: den ICE-Agenten (`get_property("ice-agent")`) in einer Liste halten, sonst gibt die Hülle ihn frei; die Antwort
  eines Promise samt Wert in Namen halten, bevor man ihn weitergibt. In der Sandbox gibt es nur `lo`: ohne
  `add-local-ip-address 127.0.0.1` sammelt libnice nichts.
  Eingaben (seit VKg2a3) nur über `Eingabe` in `freedom_bild.py`: XTest an den eigenen Bildschirm, feste Nachrichten
  (`PROTOCOL.md` §34), begrenzt – nie etwas aus dem Datenkanal an eine Shell, eine Datei oder den Knoten.
  Web-Projekte (seit VKg2c1) zeigt nur Chromium in der Sandbox des Programms (`bildBefehl(…, web)`, `browserArgumente()`):
  ohne eigene Sandbox, Profil in `/tmp`, der Dev-Server über `WEB_DEV_START` dort selbst – nie ein Weg aus der Sandbox zum
  Dev-Server der Vorschau. Den Browser liest nur `browserLesbar()` ein (wie beim Motor, nie Home oder Wurzel). Im Test die
  Farbe nie in der Bildmitte messen – dort steht der Zeiger von Xvfb; und nie eine feste Pause nach den Eingaben (bis
  VKg2c1 endete der Empfänger nach 2 s, unter Last kamen die Tasten später an): warten, bis sie wirken, mit Frist.
  Kodiert wird (seit VKg2c2) nur im Format und mit der Nummer aus dem Angebot (`formate()`, `pipeline_text()` in
  `freedom_bild.py`) – nie eine feste Nummer: Firefox nennt VP8 120, bis VKg2c2 kam dort kein Bild an. H.264 nur über
  NVENC (`nvh264enc`), nie in Software (openh264 scheitert auf Ubuntu 24.04, x264 ist GPL). Die GPU bekommt nur die
  Bild-Sandbox (`gpu` in `BildStrom`), nie das Programm oder der Motor.
- **Repo-Aufträge nur über `repo-lauf.ts`** (seit 11.5c1, W3a A): der Ablauf nach mini-swe-agent – je Antwort genau ein
  ```bash-Block, jeder Befehl in einer neuen bash über `fuehreAus()` (nie eine Shell, die Zustand hält), fertig nur mit
  `ENDE_MARKE` als erster Zeile und Exit 0; Grenzen nach Schritten, Zeit (je Befehl nur die Restzeit) und Tokens. Den Patch
  baut der Knoten (`bearbeiteRepo()` → `leseArbeitsordner()` → `schreibePatch()`), nie das Modell; ohne „fertig“ keiner.
  Die Unterhaltung bleibt im Speicher und endet mit dem Aufruf – nie ins Log, auch keine Befehle. Die Anweisungen an das
  Modell bleiben englisch wie bei mini-swe-agent (daran wurden die Modelle gemessen); der MIT-Hinweis im Kopf der Datei
  bleibt stehen. `fuehreAus()` behält bei langer Ausgabe Anfang und Ende (`kuerzeAusgabe()` zeigt beide) – nie nur den Anfang
  sammeln, sonst fehlt dem Modell die Zusammenfassung eines Testlaufs.
- **Repo-Aufträge im Knoten-Agenten nur über `KnotenAgent`** (seit 11.5c2a, offene Räume): erkannt nur in `pruefe()`
  (`leseRepoAuftrag()` an der Erwähnung, `repoImOffenenRaum()`, Bundle-Verweis nur über `neuesterBundleVerweis()`), Code nur
  über `holeRepoBundle()` (Stücke vom Autor des Manifests, Chiffrat = Blob-Id, nie Klon-Adressen), gearbeitet nur in
  `bearbeiteRepoAuftrag()` → `bearbeiteRepo()` mit `gespraech()` des Antriebs – nie `complete()` (eigener Systemprompt,
  Werkzeuge). Nur mit `AGENT_REPO=1` und `repo` aus `main.ts` nach `pruefeSandbox()`; nur bezahlt oder vom Besitzer, Tokens bis
  zum Gebot. Scheitern Bundle, Modell oder Sandbox, wirft er `AgentAbgelehnt` – dann zahlt der Fragende nichts. Private Räume
  prüft `pruefePrivat()` seit 11.5c2b über `privatesRepo()` (P1–P4): nur mit `modellLokal` (`lokaleKiAdresse()` der Adresse des
  Antriebs in `main.ts`), Repo über `repoImPrivatenRaum()`, Verweis nur aus `raumReposPrivat()` – nie ein offener 38042; Patch nur
  über `raumRepoPatch()` in die Gruppe (`reicheEin()`), die Antwort über `raumAgentAntwort(…, repo)`. `MemoryRelay` beachtet
  `authors`: Prüfungen gegen Relays, die Filter übergehen, mit einem eigenen `query`, sonst prüft der Test nichts.
- **Text aus Sprache nur über `Whisper`** (seit B-38b2, `whisper.ts`, SP-W1 A): `whisper-cli` nur über
  `Whisper.transkribiere()` → `fuehreAus()` – nie `spawn` daneben, nie ein `whisper-server` (in der Sandbox ohne Netz wäre er
  nicht erreichbar, außerhalb liefe er ohne). Modell und Programm nur als einzelne Dateien nur lesbar einbinden – nie ihren
  Ordner (ein `WHISPER_CLI=~/whisper-cli` bände sonst das Home samt `~/.freedom` ein). Den Text nur aus der Ausgabedatei
  (`lstat`, `O_NOFOLLOW`, begrenzt) – der Prozess darin könnte dort einen Verweis anlegen. Den Ton nur über
  `holeVerschluesselt()` (genau das Manifest aus dem Auftrag) und nur nach `pruefeWav()`; Ton und Text nie ins Log, der
  Arbeitsordner ist nach jedem Auftrag weg. Ablehnungen nur als `SpracheAbgelehnt` mit `fall` aus `SPRACHE_FAELLE`.
  `RLIMIT_CPU` zählt alle Threads zusammen – Whisper bekommt `rechenzeitSek` = Frist mal Threads, sonst endet ein langer
  Ton mit SIGXCPU.
- **Das Whisper-Modell nur über `modell-whisper.ts`** (seit B-38b3b2): gewünscht über `npm run modell -- --whisper`, geladen
  nur im `ModellDienst` über `ladeWhisperModell()` → `ladeWhisperDatei()` – derselbe geprüfte Abruf wie für Hugging Face
  (`ladeGepruefteDatei()`), dazu die Kennung `ggml` am Anfang (sonst löschen). Mit jedem Antrieb (`whisper` in den
  `LaderHilfen`, nicht an `hf` gebunden); im Stand mit `datei` und `abdruck` (`dateiAbdruck()`, nie einem Verweis folgen).
  Ein Whisper-Modell steht nie im Angebot für KI – `imAngebot()` und `pruefeModelle()` behandeln es vor allen anderen.
  Das Modell (seit B-38b3b3): ohne `WHISPER_MODELL` je Auftrag über `gepruefterWhisper()` (zuletzt geprüft, Datei unverändert) –
  nie einmal beim Start merken, sonst gälte eine veränderte Datei weiter. Die Rolle `sprache` im Status nur mit
  `Whisper.bereit()`.
