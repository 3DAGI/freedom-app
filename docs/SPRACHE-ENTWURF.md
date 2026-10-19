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
| B-38a | Vorlesen auf dem Gerät: Knopf an Antworten und Nachrichten, nur lokale Stimmen, Sprache passend, Smoke-Test mit Attrappe | ~150 |
| B-38b | Knoten: `whisper-server` (Paket oder Bau aus den Quellen), Modell über Manifest, in der Sandbox; versiegelter Auftrag an den eigenen Knoten, Ton über den Blob-Weg | ~350 |
| B-38c | App: „Als Text“ an Sprachnachrichten, Diktieren im Agenten – über den eigenen Knoten oder „Dieses Gerät“, Wandlung im Browser | ~300 |
| B-38d | (nur mit SP-W2 B/C – entfällt mit SP-W2 A vorerst) Piper auf dem eigenen Knoten | ~250 |

Live-Proben (Qualität auf Deutsch, Geschwindigkeit auf dem GX10) macht der MENSCH.

## Quellen

- PyPI: `piper-tts` 1.8.0 (Lizenz GPL-3.0-or-later, Startseite `OHF-voice/piper1-gpl`), `onnxruntime` 1.31.0 (MIT),
  `pywhispercpp` 1.5.1, `faster-whisper` 1.2.1 (beide MIT) – gelesen 19.10.2026.
- Tags `ggml-org/whisper.cpp` (`git ls-remote`, neueste v1.9.5) und `OHF-Voice/piper1-gpl` (v1.8.0).
- whisper.cpp: `models/README.md` (Größen), `examples/server/README.md` (Endpunkte, Sicherheitshinweis),
  `examples/server/server.cpp` (CORS-Kopfzeilen, keine Größengrenze).
- piper1-gpl: README (Lizenz), `docs/API_HTTP.md` (HTTP-Server).
- MDN: `SpeechSynthesisVoice.localService`.
