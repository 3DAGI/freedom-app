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
