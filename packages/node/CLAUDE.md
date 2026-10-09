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
