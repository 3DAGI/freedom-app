# Entwurf: Sprache lokal – Sprachnachrichten als Text, Antworten vorlesen (B-38)

Stand 19.10.2026, Spur B. Sammlung B-38 (Anhang E): „Sprachnachrichten in Text, Antworten vorlesen – als Werkzeuge des
eigenen Knotens bzw. von ‚Dieses Gerät‘, Dienste wie ComfyUI“, frei nach B-31 (fertig mit #526). A-11 (09.10., MENSCH):
Transkribieren ist der erste Dienst über KI hinaus. Wie bei B-30 bis B-37 erst ein Entwurf mit Größen, Lizenzen und
Fragen; gebaut wird nach Freigabe.

## Ausgangslage

- **Sprachnachrichten gibt es seit C-7** (`sprachnachricht.ts`): Opus in WebM oder Ogg (Safari: MP4), 32 kbit/s,
  höchstens 120 s (rund 480 KB). Sie reisen wie jede Datei, Ende-zu-Ende-verschlüsselt (klein in der Nachricht, sonst
  über `uploadAnhang()`). Als Text gibt es sie nicht, vorgelesen wird nichts.
- **Die Wege der App:** „Dieses Gerät“ (`ki-lokal.ts`: nur Adressen dieses Rechners, erst auf Klick), „Mein Knoten“
  (versiegelt mit Besitzer-Nachweis, B-8/B-9) und das Netz (NIP-90, bezahlt). Werkzeuge des Knotens laufen seit B-31
  in seiner Sandbox (bubblewrap, ohne Netz).
- **NIP-90** kennt Aufträge für Text aus Medien (5000, „Text extraction“) und für Sprache aus Text (5250); `kinds.ts`
  nutzt bisher 5050 und die eigenen Knoten-Aufträge 5070–5081.

## Befunde

Gelesen am 19.10.2026 (PyPI, Tags auf GitHub, Dokumentation der Projekte). Hugging Face, Debian und die GitHub-API sind
aus der Entwicklungsumgebung gesperrt – was dort steht, ist unten als „nicht geprüft“ markiert.

| Programm | Fassung | Kann | Größe | Lizenz |
|---|---|---|---|---|
| **whisper.cpp** (`whisper-server`) | v1.9.5 | Sprache → Text, über 90 Sprachen, CPU, CUDA (GX10), Vulkan; HTTP-Server mit `/inference` (multipart `file`, `response_format`), `/load` | Programm wenige MB (aus den Quellen, CMake); Modelle: base 142 MiB, small 466 MiB, medium 1,5 GiB, large-v3-turbo 1,5 GiB, **large-v3-turbo-q5_0 547 MiB** | MIT; Modelle (Gewichte von OpenAI) MIT – nicht geprüft |
| **Piper** (`piper-tts`, jetzt `OHF-Voice/piper1-gpl`) | 1.8.0 | Text → Sprache, schnell, ohne GPU; HTTP-Server `python3 -m piper.http_server` (Port 5000, `POST /synthesize` mit JSON `text`, `voice` → WAV) | Paket 34 MB (bringt espeak-ng mit), dazu `onnxruntime` 1.31.0 (21–24 MB, MIT), je Stimme ein ONNX-Modell (nicht geprüft) | **GPL-3.0-or-later** (das alte `rhasspy/piper` war MIT); Stimmen: Lizenz je Stimme in ihrer Modellkarte – nicht geprüft |
| Browser: `speechSynthesis` | – | Text → Sprache mit den Stimmen des Systems | 0 | – |
| Browser: `SpeechRecognition` | – | Sprache → Text | 0 | – |

Weitere Befunde:

- **`whisper-server` sendet selbst `Access-Control-Allow-Origin: *`** (Quelltext `examples/server/server.cpp`). Die App kann
  einen whisper-server auf diesem Rechner also direkt ansprechen, wie Ollama unter „Dieses Gerät“ – anders als
  `atomic-agent serve` (B-30a wartet genau daran). Für Piper (Flask) ist nicht geprüft, ob es CORS sendet.
- **Eingaben:** `whisper-server` liest ohne `--convert` nur, was `read_audio_data()` kennt (WAV sicher; Opus in WebM
  nicht). Mit `--convert` ruft er **ffmpeg** auf fremde Dateien auf – die Projektseite selbst rät, ihn dann in einer
  Sandbox zu betreiben. Eine Grenze für die Größe hat er nicht (nur Zeitlimits). Der Browser kann jede eigene Aufnahme
  selbst dekodieren (`decodeAudioData`) und als 16-kHz-PCM schicken (32 KB je Sekunde, 120 s = 3,8 MB) – dann braucht der
  Knoten kein ffmpeg.
- **`SpeechRecognition` in Chrome schickt den Ton an Google** – nie benutzen. Auch bei `speechSynthesis` sind die
  Chrome-Stimmen „Google …“ Netzstimmen: der Text geht an Google. Stimmen mit `voice.localService === true` sprechen auf
  dem Gerät (MDN: `localService` ist `false` bei einem entfernten Dienst). Die App darf nur sie anbieten.
- **Piper ist seit dem Umzug GPL-3** (piper1-gpl bettet espeak-ng ein). Als eigenes Programm, das der Knoten nur über HTTP
  aufruft, ist das dieselbe Lage wie bei `kiwix-serve` (B-31b) und aria2c (B-29c2b): bloße Zusammenstellung, keine Folge
  für die EUPL des Knotens. In die App (`freedom.html`) kommt es nie.
- **Ubuntu 24.04 kennt kein whisper.cpp-Paket** (`apt-cache`); ob Debian (Bild `node:22-slim`) eines hat, ist hier
  nicht prüfbar. Sonst baut die CI `whisper-server` aus den Quellen, gepinnt und reproduzierbar wie die Tor-Brücken
  (B-33a) – für CUDA auf dem GX10 braucht der Bau das CUDA-Toolkit.
- **Größe der Nachricht:** Ein versiegelter Auftrag fasst 64 KB (NIP-44). Ton passt nicht hinein; er reist wie ein
  Anhang verschlüsselt über den Blob-Weg (`uploadAnhang()`), im Auftrag stehen nur Adresse und Schlüssel – nur im Kern.
  Für das Vorlesen gilt dasselbe in umgekehrter Richtung (WAV mit 22 kHz: rund 44 KB je Sekunde).

## Vorschläge

- **V1 – Nie Netzdienste des Browsers.** Kein `SpeechRecognition`; `speechSynthesis` nur mit Stimmen, die
  `localService` melden. Fehlt eine, sagt die App das, statt still eine Netzstimme zu nehmen.
- **V2 – Text aus Sprache: „Mein Knoten“ und „Dieses Gerät“.** Der eigene Knoten betreibt `whisper-server` in seiner
  Sandbox (ohne Netz, Modell nur lesbar), der Auftrag geht versiegelt mit Besitzer-Nachweis nur an ihn (eigenes Kind im
  Bereich der Knoten-Aufträge). „Dieses Gerät“ spricht einen whisper-server auf `127.0.0.1` an (`lokaleKiAdresse()`, erst
  auf Klick). Fremde Provider (NIP-90 5000, bezahlt) erst mit A-11.
- **V3 – Ton im Browser wandeln.** Die App dekodiert die Sprachnachricht selbst und schickt 16-kHz-PCM als WAV – kein
  ffmpeg im Knoten, keine fremden Container im Parser.
- **V4 – Modelle nur geprüft** (Regel „Modelle laden nur geprüft“, E9): Das Whisper-Modell kommt über ein Manifest
  (38057) mit Prüfsumme, gewählt wie heute (`vertrautesManifest()`), geladen auch von Hugging Face (B-29c1).
- **V5 – Vorlesen zuerst auf dem Gerät.** Ein Knopf „Vorlesen“ an Antworten und Nachrichten mit den lokalen Stimmen des
  Systems (V1). Piper auf dem eigenen Knoten erst, wenn die Stimmen des Geräts nicht reichen.
- **V6 – Nichts ins Log, nichts behalten.** Ton und Text sind Inhalt: Der Knoten schreibt keins davon ins Log und löscht
  beides nach der Antwort; im Status nur Zählungen (wie bei Kiwix).

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| SP-W1 | Wo wird Sprache zu Text? | **A** eigener Knoten und „Dieses Gerät“ · **B** nur eigener Knoten · **C** dazu fremde Provider (NIP-90 5000, bezahlt) | **A** – C mit A-11 später |
| SP-W2 | Vorlesen | **A** nur mit den lokalen Stimmen des Geräts · **B** dazu Piper auf dem eigenen Knoten · **C** nur Piper | **A** – sofort überall, kein neuer Dienst; B, wenn die Qualität nicht reicht |
| SP-W3 | Piper ist GPL-3 – als eigenes Programm im Knoten in Ordnung? (nur bei SP-W2 B oder C) | **A** ja, wie `kiwix-serve` und aria2c · **B** nein | **A** |
| SP-W4 | Vorgabe-Modell für Whisper | **A** base (142 MiB, schnell, mäßig für Deutsch) · **B** small (466 MiB) · **C** large-v3-turbo-q5_0 (547 MiB, deutlich besser, mit GPU) | **C** auf dem GX10, A als Rückfall ohne GPU; der Provider wählt per Umgebungsvariable |
| SP-W5 | Ton wandeln | **A** im Browser (16-kHz-PCM) · **B** ffmpeg im Knoten (in der Sandbox) | **A** – kleinere Angriffsfläche |
| SP-W6 | Whisper auch als MCP-Werkzeug für den Agenten (Tondateien im Projekt) | **A** später · **B** gleich mit | **A** |

## Entscheidungen vom 19.10.2026 (MENSCH)

SP-W1 **A** (eigener Knoten und „Dieses Gerät“; fremde Provider mit A-11), SP-W2 **A** (Vorlesen nur mit den lokalen
Stimmen des Geräts), SP-W3 **A** (Piper als eigenes Programm – wirkt erst, wenn Piper später doch kommt), SP-W4 **C**
(large-v3-turbo-q5_0 auf dem GX10, base ohne GPU), SP-W5 **A** (Ton im Browser wandeln), SP-W6 **A** (MCP später).
Damit ist B-38 frei; B-38a als Nächstes, B-38d entfällt vorerst. Quelle: Antwort des MENSCHEN im Chat von Spur B (19.10.2026): „Die offenen Entscheidungen alle nach deinen Empfehlungen.“

## Aufteilung (nach Freigabe, Empfehlungen)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-38a ✓ | Vorlesen auf dem Gerät: Knopf an den Antworten des Agenten, nur lokale Stimmen, Sprache passend, Smoke-Test mit Attrappe | ~150 |
| B-38b | Knoten: `whisper-server` (Paket oder Bau aus den Quellen), Modell über Manifest, in der Sandbox; versiegelter Auftrag an den eigenen Knoten, Ton über den Blob-Weg | ~350 – geteilt in b1–b3 |
| B-38b1 ✓ | Protokoll: Kind 5083, Ton als WAV in genau einer Form (`baueWav()`, `pruefeWav()`), Auftrag versiegelt mit Nachweis (`baueSpracheAuftrag()`), Antwort streng (`leseTranskript()`), `PROTOCOL.md` §43 | ~250 |
| B-38b2 ✓ | Knoten: `whisper-cli` je Auftrag in der Sandbox (ohne Netz, Modell nur lesbar), Ton aus dem Blob-Netz holen und prüfen, Antwort; Rolle `sprache` im Status | ~300 |
| B-38b3 | `whisper-cli` im Bild (Bau aus den Quellen, gepinnt), Modell über Manifest (V4), Vorgabe nach SP-W4 | ~250 – geteilt |
| B-38b3a ✓ | `scripts/whisper-bauen.sh` (v1.9.5, Commit geprüft, ohne OpenMP), Stufe im Docker-Bild (`WHISPER=1`, `docker-compose.sprache.yml`), CI baut es und prüft das echte Programm in der Sandbox | ~200 |
| B-38b3b | Modell geprüft laden: über ein Manifest (38057) wie andere Modelle (`npm run modell`), Vorgabe nach SP-W4 | ~500 – geteilt in b3b1–b3b3 |
| B-38b3b1 ✓ | Protokoll: Konvention `whisper:<name>` mit genau einer Datei `ggml-<name>.bin` aus `ggerganov/whisper.cpp` am Commit (`whisperQuelle()`), Stand von Hugging Face (`whisperStand()`), Adresse, Kennung `ggml` (`istGgml()`), Vorgabe | ~200 |
| B-38b3b2 ✓ | Knoten: `npm run modell -- --whisper [name] [--aus-hf]`, Laden und Prüfen im `ModellDienst` (nie im Angebot für KI), Selbstprüfung | ~300 |
| B-38b3b3 ✓ | Whisper nimmt das geprüfte Modell (ohne `WHISPER_MODELL`), Rolle `sprache` erst mit Modell, Docker ohne Pfad | ~150 |
| B-38c | App: „Als Text“ an Sprachnachrichten, Diktieren im Agenten – über den eigenen Knoten oder „Dieses Gerät“, Wandlung im Browser | ~300 – geteilt in c1–c3 |
| B-38c1 ✓ | „Als Text“ an Sprachnachrichten über den eigenen Knoten: Ton im Browser zu WAV (`ton-wandeln.ts`), Ton unter einem Sitzungsschlüssel, nur mit Rolle `sprache`, Smoke-Test „als_text“ | ~300 |
| B-38c2 ✓ | Diktieren im Agenten (Aufnahme → Text ins Eingabefeld, Sprache der App) | ~150 |
| B-38c3 ✓ | „Dieses Gerät“: ein whisper-server auf diesem Rechner (`lokaleKiAdresse()`, erst auf Klick) | ~200 |
| B-38d | (nur mit SP-W2 B/C – entfällt mit SP-W2 A vorerst) Piper auf dem eigenen Knoten | ~250 |

Live-Proben (Qualität auf Deutsch, Geschwindigkeit auf dem GX10) macht der MENSCH.

## Stand B-38a (19.10.2026)

- **`vorlesen.ts`** (ohne DOM): `waehleStimme()` nimmt nur Stimmen mit `localService === true` in der Sprache der App –
  unter ihnen die Vorgabe des Systems, sonst die erste; eine Netzstimme nie, auch nicht als Rückfall, eine andere Sprache
  auch nicht. `vorleseStuecke()` teilt den Text an Satzenden in Stücke bis 220 Zeichen (höchstens 8000 Zeichen).
  `Vorleser` liest immer nur einen Text, ein neuer oder `stopp()` bricht ab; die Stimmen wartet er bis 1,5 s ab
  (`voiceschanged`). `browserSprecher()` setzt jeder Äußerung ausdrücklich die lokale Stimme – ohne `voice` nähme der
  Browser seine Vorgabe, in Chrome eine Netzstimme; ohne `speechSynthesis` (Android-WebView) gibt es keinen Sprecher.
- **Oberfläche** (`shell/vorlesen-ui.ts`): „Vorlesen“ neben „Kopieren“ unter jeder Antwort des Agenten (`aria-pressed`,
  ein zweiter Klick hält an), Code-Blöcke als „Code ausgelassen.“. Ohne lokale Stimme ein Hinweis, kein Vorlesen.
- **Nicht in der App:** die Spracherkennung des Browsers – ein Test sucht danach in allen Quellen.
- **Offen:** Nachrichten im Chat vorlesen kommt mit B-38c (dort gibt es dann auch Sprachnachrichten als Text).

## Stand B-38b1 (22.10.2026)

- **Geteilt:** B-38b in drei Schritte (Tabelle oben) – Protokoll, Knoten, Bild. Zusammen wären es deutlich über 400 Zeilen.
- **Befund: `whisper-cli` statt `whisper-server`.** Die Sandbox des Knotens (VKb) hat kein Netz; ein `whisper-server` darin
  wäre vom Knoten aus nicht erreichbar (er kennt keinen Unix-Socket), einer außerhalb liefe ohne Sandbox. `whisper-cli` je
  Auftrag liest eine Datei und schreibt den Text in eine Datei – kein offener Port, nichts bleibt im Speicher. Das Modell
  lädt dafür je Auftrag neu (bei large-v3-turbo-q5_0 einige Sekunden; messen macht der MENSCH auf dem GX10).
- **Ton:** WAV in genau einer Form (`baueWav()`: 44 Byte Kopf, PCM, mono, 16 kHz, 16 Bit), höchstens 120 s; `pruefeWav()`
  nimmt nichts anderes (Kennungen `wav-form`, `wav-format`, `wav-leer`, `wav-lang`). So liest der Knoten nie einen fremden
  Container (SP-W5 A).
- **Auftrag** (5083, `baueSpracheAuftrag()`): versiegelt vom Sitzungsschlüssel an den gekoppelten Knoten, mit Nachweis,
  ohne Gebot; `i` nennt Blob, Manifest und Schlüssel des Tons und die Sprache (`de`, `en`, `auto`). **Antwort** (6083):
  Text bis 8000 Zeichen ohne Steuerzeichen und die Länge aus der WAV-Datei (`leseTranskript()`). `PROTOCOL.md` §43.
- **Ältere Knoten:** Ein Knoten vor B-38b2 läse 5083 als gewöhnlichen Auftrag – die App fragt nur, wenn der Status die
  Rolle `sprache` nennt (B-38c).

## Stand B-38b2 (22.10.2026)

- **`whisper.ts`** (Knoten): `whisperAusUmgebung()` – `WHISPER_MODELL` (absoluter Pfad zu einem ggml-Modell, sonst aus),
  `WHISPER_CLI` (Vorgabe `/usr/local/bin/whisper-cli`), `WHISPER_GPU`, `WHISPER_THREADS` (Vorgabe 4), `WHISPER_FRIST_SEK`
  (Vorgabe 600); ungültig heißt aus, mit Grund im Log. `Whisper.transkribiere()` schreibt den Ton in einen eigenen
  Arbeitsordner (0700, `/dev/shm`, wo es ihn gibt) und ruft `whisper-cli` über `fuehreAus()`: ohne Netz, Modell und Programm
  nur als einzelne Dateien lesbar (nie ein Ordner darüber), schreibbar nur der Arbeitsordner, Rechenzeit Frist mal Threads.
  Gelesen wird nur die Ausgabedatei (`lstat`, `O_NOFOLLOW`, höchstens 64 KB), Steuerzeichen und Farbfolgen fallen weg;
  danach ist der Ordner weg. Ein Auftrag zur Zeit (`sprache-belegt`).
- **Auftrag** (`handleSprache()` in `dvm-provider.ts`): nur versiegelt mit Nachweis; Ton über `holeVerschluesselt()`
  (`blob-holen.ts`, aus `repo-bundle.ts` herausgelöst – Repo-Bundles nutzen denselben Abruf), nur nach `pruefeWav()`, dann
  Whisper; Antwort versiegelt an den Sitzungsschlüssel. Abgelehnt nur mit Kennung (`SpracheAbgelehnt`, `SPRACHE_FAELLE`).
- **`main.ts`:** nur mit Modell und nur, wenn die Sandbox geht; Rolle `sprache` im Status (die App hat einen Text dafür).
- **Sandbox:** `fuehreAus()` nimmt eine eigene Rechenzeit (`rechenzeitSek`) – Whisper rechnet mit mehreren Threads, und
  `RLIMIT_CPU` zählt alle zusammen.
- **Noch offen:** `whisper-cli` und ein Modell im Bild (B-38b3); bis dahin legt der Betreiber beides selbst ab.

## Stand B-38b3a (22.10.2026)

- **Programm:** `scripts/whisper-bauen.sh <ziel>` holt whisper.cpp v1.9.5, prüft den Commit (`d1be6fde…`), baut nur
  `whisper-cli` – ggml statisch, ohne OpenMP, ohne Server, SDL und curl – und legt die Lizenz (MIT) dazu. Am Ende prüft es
  mit `ldd`, dass nur libc, libm, libstdc++ und libgcc gebraucht werden (in der Sandbox liegen sie unter `/usr`).
  `WHISPER_CUDA=1` baut für die GPU (CUDA-Toolkit nötig). Hier gemessen: 1:38 min, 3,4 MB.
- **Echt geprüft:** Das gebaute Programm lief über `Whisper.transkribiere()` in bubblewrap mit dem Testmodell des Projekts
  (`for-tests-ggml-tiny.bin`, Gewichte ohne Sinn) – Argumente angenommen, Ausgabedatei geschrieben, 1,5 s je Lauf; der Text
  ist leer, weil das Modell nichts gelernt hat. Ein echtes Modell lädt diese Umgebung nicht (Hugging Face gesperrt) – die
  Qualität misst der MENSCH.
- **CI:** Der Testjob baut `whisper-cli` (rund 2 min, Frist des Jobs jetzt 25 min) und führt `sprache-echt.test.ts` mit dem
  echten Programm in der Sandbox aus (`WHISPER_TEST_CLI`, `WHISPER_TEST_MODELL`); ohne die Variablen überspringt er sich.
- **Docker:** eigene Stufe `whisper-bau` (Compiler bleiben draußen), nur mit `WHISPER=1`; `docker-compose.sprache.yml` setzt
  es, die Variablen und die Regeln für die Sandbox (wie beim Vibecoden). Das Bild ist hier nicht gebaut (kein Docker-Dienst
  in der Entwicklungsumgebung) – das baut der MENSCH auf dem GX10.
- **Modell:** bis B-38b3b legt der Betreiber es selbst ab und vergleicht die SHA-1 aus `models/README.md` von whisper.cpp
  derselben Fassung (`docs/PROVIDER.md`, „Text aus Sprache“).

## Stand B-38b3b1 (22.10.2026)

- **Konvention** (`modell-whisper.ts`, `docs/PROTOCOL.md` §43): `model` = `whisper:<name>`, `upstream` =
  `hf:ggerganov/whisper.cpp@<Commit>`, genau eine Datei `ggml-<name>.bin` (höchstens 3,5 GB). Gewählt über
  `vertrautesManifest()` mit `whisperQuelle()` – dieselbe Regel wie für andere Modelle (eigenes vor Katalog, bei Streit keins).
- **Hugging Face:** das Repo, aus dem whisper.cpp selbst lädt (`models/download-ggml-model.sh` in v1.9.5). Festhalten liest
  die eine Datei mit LFS-Summe (`whisperStand()`); andere Dateien dort (`.en`-Modelle, Core-ML-Archive) bleiben draußen.
- **Kein Pickle:** `.bin` gilt nur auf diesem Weg (`WHISPER_DATEI`); die Datei muss mit `ggml` beginnen (`istGgml()`,
  gemessen am Testmodell von whisper.cpp: `6c 6d 67 67`). `HF_DATEI` bleibt ohne `.bin`.
- **Vorgabe** (`WHISPER_VORGABE`): mit GPU `large-v3-turbo-q5_0`, ohne `base`.

## Stand B-38b3b2 (22.10.2026)

- **Wunsch:** `npm run modell -- --whisper [name] [--aus-hf]` – ohne Namen die Vorgabe nach `WHISPER_GPU`. Im Stand heißt
  das Modell `whisper:<name>` (Quelle `whisper`), mit jedem KI-Antrieb – auch neben Ollama.
- **Laden** (`modell-whisper.ts` im Knoten, `ladeWhisperModell()` im `ModellDienst`): Manifest wie bei anderen Modellen,
  Vorprüfung am Commit (eine andere Datei dort: `whisper.anders`, nichts geladen), dann `ladeWhisperDatei()` – derselbe
  geprüfte Abruf wie für Hugging Face (`ladeGepruefteDatei()`: SHA-256 beim Laden, nie mehr Bytes, erst danach unter dem
  Namen) und die Kennung `ggml` (sonst gelöscht, `whisper.keinGgml`). Ziel `MODELL_ORDNER/whisper/ggml-<name>.bin`.
- **Gemerkt** mit dem Abdruck der Datei (`dateiAbdruck()`: Größe, Zeit, Inode, ohne Verweisen zu folgen); die Selbstprüfung
  sagt `modell.whisper` bzw. `modell.whisperVeraendert` – im Status an den Besitzer und in `npm run pruefen`.
- **Nie im Angebot für KI** (`imAngebot()` lässt Whisper aus).
- **Noch offen (B-38b3b3):** Whisper nimmt das geprüfte Modell von selbst; bis dahin zeigt `WHISPER_MODELL` darauf.

## Stand B-38b3b3 (22.10.2026)

- **Modell je Auftrag:** Ohne `WHISPER_MODELL` fragt `Whisper` vor jedem Auftrag `gepruefterWhisper()` – das zuletzt geprüfte
  Whisper-Modell, dessen Datei unverändert ist (`dateiAbdruck()`). Ein neu geprüftes Modell gilt ohne Neustart; eine
  veränderte Datei gilt nicht mehr (Ablehnung `sprache-whisper`, bevor die Sandbox startet). `WHISPER_MODELL` geht vor.
- **Rolle:** Der Status nennt `sprache` nur, wenn es ein Modell gibt (`Whisper.bereit()`) – die App fragt erst dann (§43).
- **Docker:** `docker-compose.sprache.yml` setzt keinen Pfad mehr; das Modell kommt über `npm run modell -- --whisper`.
- **B-38b fertig.** Als Nächstes B-38c (App: „Als Text“, Diktieren).

## Stand B-38c1 (23.10.2026)

- **Geteilt:** B-38c in drei Schritte (Tabelle oben) – „Als Text“ über den eigenen Knoten, Diktieren, „Dieses Gerät“.
- **Wandlung** (`ton-wandeln.ts`, ohne DOM): `browserDekoder()` dekodiert mit `decodeAudioData` eines Offline-Kontexts mit
  16 kHz – der Browser bringt den Ton dabei selbst auf die Rate, abgespielt wird nichts. `alsSpracheWav()` mischt die
  Kanäle (Mittelwert), wandelt in 16 Bit und baut `baueWav()`. Bis zu einer Sekunde über 120 s schneidet sie ab (der
  Kodierer hängt Millisekunden an); was länger ist, lehnt sie ab (`ton-lang`) – eine fremde Nachricht wird nie still
  gekürzt. Was der Browser nicht lesen kann (`ton-unlesbar`), fragt den Knoten gar nicht erst.
- **Auftrag** (`shell/sprache-text-ui.ts`): nur gekoppelt und nur, wenn der Status die Rolle `sprache` nennt (gemerkt für die
  Sitzung, ein Nein fragt erneut). Der Ton geht über den Weg zum Knoten (mit Haken nur über sein Relay) ins Blob-Netz,
  signiert mit dem frischen Sitzungsschlüssel des Auftrags – nie mit der eigenen Identität; danach 5083 versiegelt, Sprache
  `auto` (Kontakte sprechen jede Sprache). Ablehnungen mit Kennung zeigt die App mit eigenen Sätzen.
- **Oberfläche:** „Als Text“ unter jeder Sprachnachricht im Chat – Ton aus der Nachricht selbst (`data:`) und entschlüsselte
  Sprachnachrichten aus dem Blob-Netz; nie Ton von einer Adresse im Netz (das fragte einen fremden Server). Der Text steht
  nur als `textContent` darunter und wird nirgends gespeichert. Ohne Kopplung kein Knopf.
- **Smoke-Test „als_text“:** echte Aufnahme der Mikrofon-Attrappe (440 Hz), echtes `decodeAudioData` in Chromium; die
  Attrappe des Knotens (`scripts/sprache-probe.mts`) holt den Ton wie der Knoten, prüft ihn mit `pruefeWav()` und misst die
  Tonhöhe – 440 Hz heißt: richtig gewandelt. Ohne die Rolle geht kein Ton hinaus.
- **Grenze:** Mit `RELAY_BESCHRAENKT=1` nimmt das Relay des Knotens Stücke vom Sitzungsschlüssel nicht an – mit Haken „nur
  über meinen Knoten“ scheitert „Als Text“ dann mit einer Meldung. Die Stücke bleiben verschlüsselt auf den Relays liegen
  wie andere Anhänge; lesen kann sie nur, wer den Schlüssel aus dem Auftrag hat.

## Stand B-38c2 (23.10.2026)

- **Diktieren** (`shell/diktieren-ui.ts`): Mikrofon-Knopf neben „Senden“ im Agenten, nur gekoppelt und mit Mikrofon – geprüft
  beim Start und bei jedem Wechsel zum Agenten (die Kopplung kann neu sein). Dieselbe Aufnahme wie Sprachnachrichten
  (`SprachAufnahme`, höchstens 120 s, Mikrofon erst beim Klick, danach aus, im Hintergrund beendet). Der Text kommt über
  `textAusSprache()` vom eigenen Knoten, mit der Sprache der App (`de`/`en`) statt `auto`, und wird ans Eingabefeld angehängt –
  gesendet wird erst mit „Senden“. Stille fügt nichts ein. Die Aufnahme bleibt nur im Speicher.
- **Smoke-Test „als_text“** um das Diktat erweitert: echte Aufnahme der Mikrofon-Attrappe, die Rolle aus „Als Text“ ist für die
  Sitzung gemerkt – hinaus geht nur der Auftrag; im Feld steht danach „Bitte: Probe: 440 Hz, Sprache de“.

## Stand B-38c3 (23.10.2026)

- **„Dieses Gerät“** (`sprache-lokal.ts`, ohne DOM): ein `whisper-server` (whisper.cpp) auf diesem Rechner, nur Adressen aus
  `lokaleKiAdresse()`. Gelesen in whisper.cpp v1.9.5 (`examples/server/server.cpp`): `GET /health` (`{"status":"ok"}`, 503 solange
  das Modell lädt), `POST /inference` mit `file`, `language` und `response_format=json` → `{"text": …}`; CORS (`*`) sendet der
  Server selbst. Die App schickt die WAV-Datei aus `alsSpracheWav()` – der Server braucht kein `--convert` (kein ffmpeg).
  Antwort streng wie `leseTranskript()`; Fehler mit eigenen Sätzen, nie Text des Servers.
- **Erst auf Klick:** Einstellungen › Geräte, Karte „Text aus Sprache auf diesem Gerät“ – „prüfen und merken“ fragt `/health`
  (Vorgabe `http://127.0.0.1:8080`); gemerkt wird nur eine Adresse, die „bereit“ meldet (`freedom.sprache.lokal`, nicht geheim).
  „vergessen“ nimmt es zurück.
- **Vorrang:** Ist ein Server gemerkt, gehen „Als Text“ und Diktieren nur an ihn – der Ton verlässt den Rechner nicht, kein
  Blob-Stück, kein Umschlag. Sonst der eigene Knoten wie bisher. „Als Text“ und Diktieren gibt es mit einem der beiden.
- **Echt geprüft:** `whisper-server` v1.9.5, hier gebaut, mit dem Testmodell auf 127.0.0.1 – das Modul und der ganze Weg im
  Chromium (Aufnahme, Wandlung, CORS, `/inference`, Anzeige) laufen; der Text ist beim Testmodell leer. Im Smoke-Test
  („als_text_lokal“) spielt `whisper_attrappe()` den Server und misst die Tonhöhe.
- **B-38c fertig** – damit B-38 bis auf die Proben des MENSCHEN.

## Quellen

- PyPI: `piper-tts` 1.8.0 (Lizenz GPL-3.0-or-later, Startseite `OHF-voice/piper1-gpl`), `onnxruntime` 1.31.0 (MIT),
  `pywhispercpp` 1.5.1, `faster-whisper` 1.2.1 (beide MIT) – gelesen 19.10.2026.
- Tags `ggml-org/whisper.cpp` (`git ls-remote`, neueste v1.9.5) und `OHF-Voice/piper1-gpl` (v1.8.0).
- whisper.cpp: `models/README.md` (Größen), `examples/server/README.md` (Endpunkte, Sicherheitshinweis),
  `examples/server/server.cpp` (CORS-Kopfzeilen, keine Größengrenze).
- piper1-gpl: README (Lizenz), `docs/API_HTTP.md` (HTTP-Server).
- MDN: `SpeechSynthesisVoice.localService`.
