# Vibecoden auf dem eigenen Knoten – Entwurf (A-31)

Stand 14.10.2026 (nach VKc1), Spur A.

- **Wunsch MENSCH (11.10.):** Vom Seeker oder iPhone aus auf dem eigenen GX10
  vibecoden – beide per QR-Code verbunden, „ohne Vertrauensproblem“. Das ist
  der Anfang, bevor Fragen zu fremden Geräten (11.5: W3a, W6a, W7; RM2)
  entschieden werden.
- **Freigegeben 11.10. (MENSCH, „Ja“):** den Entwurf festhalten und mit VKa
  beginnen.
- **Entschieden:** VK-W2 bis VK-W5 am 13.10., VK-W1n und VK-W6 bis VK-W9 am
  14.10. (MENSCH: „Ja zu allen deinen Vorschlägen“) – Abschnitte „Entscheidungen
  vom 13.10.2026“ und „Entscheidungen vom 14.10.2026“; sie gelten vor den Fragen.

## Was es schon gibt

| Baustein | Stand | Wo |
|---|---|---|
| Koppeln per QR | `npm run koppeln` zeigt den Code im Terminal des Knotens; die App scannt ihn (Settings → Geräte → „Mein Knoten“), auch ohne `BarcodeDetector` (jsQR, A-20) | B-8, `kopplung.ts` |
| Besitzer erkennen | Geheimnis nur im Tresor; jede Anfrage trägt nur einen HMAC-Nachweis im versiegelten Kern; der Knoten prüft `istBesitzer()` | B-8 |
| Verbindung | Der Knoten verbindet sich selbst nach außen zu Relays – keine Portfreigabe. Handy und Knoten reden über Umschläge, die Relays nicht öffnen; mit Haken nur über das Relay des Knotens | B-9c |
| „Mein Knoten“ | Modell des Knotens in der Modellwahl (gratis, kein Ausweichen), Status, Wecken, Dateien halten, TURN | B-9, B-11, B-12, B-13 |
| Repos | Bundles, Code-Ansicht, Patches, Reviews, Releases in der App | 11.4, C-17, C-20 |

## Was fehlt

1. **Kein Agent, der codet.**
   - Der Knoten führt im laufenden Betrieb keine Werkzeuge aus: `main.ts:375`
     übergibt keine `ToolRegistry`.
   - Agenten-Aufträge sind nur Text.
   - Atomic Agent (B-30) ist frei, aber nicht eingebaut.
2. **Kein Projektordner** auf dem Knoten.
3. **Keine Sandbox** – 11.5s bzw. B-31 sind offen.
4. **Keine Vorschau** der gebauten App auf dem Handy.
5. **Keine Projektseite** in der App: Schritte, Freigaben, Diff, Rückgängig.

## Vorschläge

So sieht es aus Sicht des Besitzers aus:

1. Einmal koppeln.
2. In der App „Mein Knoten“ → „Projekte“ → „Neues Projekt“ wählen.
3. Schreiben, was gebaut werden soll.
4. Live zusehen, was der Agent tut, und Befehle freigeben, wenn gewünscht.
5. Unter „Vorschau“ die App auf dem Handy ausprobieren.
6. „Rückgängig“ setzt jeden Schritt zurück.
7. Ist das Projekt fertig: „Als Repo in einen Raum stellen“.

- **VK1 – Nur der Besitzer.**
  - Code-Aufträge nimmt der Knoten nur versiegelt und mit Nachweis an
    (`istBesitzer()`), wie Status, Halten und TURN. Aufträge Fremder lehnt er ab.
  - Der Code verlässt den Knoten nur zum Handy des Besitzers, versiegelt.
  - Das Modell läuft auf dem Knoten selbst; ein KI-Dienst im Internet ist ohnehin
    ausgeschlossen (`lokaleAntriebAdresse()`).
- **VK2 – Projekte auf dem Knoten.**
  - Je Projekt ein Ordner unter `~/.freedom/projekte/<name>` (0700), dauerhaft –
    es ist der Rechner des Besitzers (AG1 A: eigene Wege mit Gedächtnis).
  - Jeder Schritt des Agenten ist ein Commit. „Rückgängig“ geht damit schrittweise
    (VK-W2).
  - Ins Log kommen nur Zahlen und Kennungen, nie Code oder Befehle.
- **VK3 – Ablauf wie 11.5 (W3a), dazu Freigaben.**
  - Eine Aktion je Antwort des Modells, jeder Befehl in einer neuen Shell in der
    Sandbox, lineare Historie, Ausgabe gekürzt (über 10 000 Zeichen nur Anfang und
    Ende).
  - Modus „fragen“: Jeder Befehl wartet auf „Ja“ vom Handy.
  - Modus „frei“: Der Agent arbeitet im Projekt allein bis zum Ende oder zur Grenze.
  - Ein Ablauf für den eigenen Knoten und später für fremde (11.5c).
- **VK4 – Sandbox auch hier.**
  - Auch das eigene Modell kann sich irren oder Anweisungen aus einem Paket oder
    einer Seite folgen.
  - Schreibbar ist nur der Projektordner (Regeln wie im 11.5-Entwurf, Vorbild
    Codex).
  - Ohne bubblewrap gibt es kein Ausführen; der Agent sagt dann, warum.
  - Netz: Pakete holt der Knoten (W6a); dazu je Projekt der Schalter
    „Internet frei“ (VK-W4) – nie ins Heimnetz.
- **VK5 – Vorschau über die Relays (VK-W3).**
  - Der Knoten baut die App und schickt das Ergebnis versiegelt ans Handy
    (Grenze etwa 5 MB).
  - Die App zeigt es in einem abgeschotteten Rahmen (`sandbox` ohne
    `allow-same-origin`).
  - Das geht ohne eigene Domain und ohne Portfreigabe, auch unterwegs – aber nur für
    Web-Apps ohne eigenen Server.
- **VK6 – Projekte-Seite in der App.**
  - Unter „Mein Knoten“: Projekte, Chat mit dem Agenten, Schritte mit Befehl und
    Ausgabe, Freigabe-Knöpfe, Diff (mit der vorhandenen Code- und Patch-Ansicht),
    Vorschau, Rückgängig.
  - Dazu „Als Repo in einen Raum stellen“ (Bundle hochladen wie 11.4) – der Übergang
    zu 11.5.
- **VK7 – Modell.** Ein Coding-Modell auf dem Knoten über Ollama, gewählt und
  geprüft wie heute (E9-Manifeste); keine Kosten.

**Seeker und iPhone:**
- **Beide:** die Web-App von GitHub Pages; Scannen auch ohne `BarcodeDetector`.
- **Seeker:** dazu die Android-Hülle (6.1c1). Deren Veröffentlichung braucht noch den
  APK-Schlüssel in den Secrets (MENSCH).
- **iPhone:** Wecken nur, wenn die App auf dem Home-Bildschirm liegt.

## Aufteilung

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| VKa | Protokoll: Code-Auftrag (5080: `liste`, `neu`, `auftrag`, `freigabe`, `stopp`), Schritte (7000, `partial`), Antworten (6080) – `docs/PROTOCOL.md` 34 | A | ~300 – **fertig** |
| VKb | Sandbox (= 11.5s): bubblewrap je Befehl, Grenzen, leere Umgebung, Selbstprüfung „Sandbox“ | B | ~250 |
| VKc | Knoten: Projekte, Ablauf mit Freigaben und Stopp, Commit je Schritt, nur für den Besitzer; Leak-Szenario | A | ~400, ggf. zwei Teile |
| VKd | Knoten und Protokoll: Bauen und Vorschau-Paket | A | ~300 |
| VKe | App: Projekte-Seite unter „Mein Knoten“ | C, Bausteine A | ~400 |
| VKf | App: „Als Repo in einen Raum stellen“ | A | ~200 |

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| VK-W1 | Welcher Harness? | A der eigene Ablauf (wie W3a) mit Freigaben · B Atomic Agent (B-30, „developer preview“) | **A** – ein Ablauf für eigene und fremde Knoten; Atomic Agent später als zweiter Motor |
| VK-W2 | Versionen im Projekt | A git ins Docker-Bild des Knotens (neue Abhängigkeit des Bilds, nur für eigene Projekte) · B eigener Commit-Schreiber aus 11.5a2 | **A** – Projekte sollen auch außerhalb von Freedom mit git funktionieren |
| VK-W3 | Vorschau | A über die Relays in die App (nur Web-Apps; die CSP braucht `frame-src blob:`) · B über die eigene Adresse des Knotens (auch Server-Apps; Domain oder `.onion` nötig) | **A** zuerst, B später |
| VK-W4 | Netz für eigene Projekte | A wie W6a (nur Pakete über den Knoten) · B dazu der Schalter „Internet frei“ je Projekt, nie ins Heimnetz | **B** – es ist der eigene Rechner, der Besitzer entscheidet |
| VK-W5 | Koppeln auch mit kurzem Code zum Abtippen? | A nur QR (der Code lässt sich heute auch einfügen) · B kurzer Code über ein PAKE-Verfahren (neue Kryptografie, neue Abhängigkeit) | **A** |

## Entscheidungen vom 13.10.2026 (MENSCH)

Dieser Abschnitt gilt vor den Fragen oben.

| Nr. | Entscheidung |
|---|---|
| VK-W1 | **offen** – Frage MENSCH: „Was spricht gegen Hermes Agent, wenn die Dienste des Nous Portals durch Freedom-Dienste ersetzt werden?“ Antwort und neuer Vorschlag unten (VK-W1n) |
| VK-W2 | **A** – git ins Docker-Bild des Knotens, nur für eigene Projekte |
| VK-W3 | **erweitert:** Live-Vorschau für APKs, Linux- und Windows-Programme und Web-Apps, „damit alles funktioniert“; dazu MCP für alle gängigen Programme (Unity, Blender …) – Recherche und Vorschlag unten |
| VK-W4 | **B** – dazu der Schalter „Internet frei“ je Projekt, nie ins Heimnetz |
| VK-W5 | **B** – auch ein Code zum Eintippen; Ausgestaltung unten (VK-W5n) |

## Recherche vom 13./14.10.2026

### Hermes Agent mit Freedom-Diensten statt Nous Portal (zu VK-W1)

**Was Hermes ist** (Nous Research, nach Repo und Doku):
- MIT, Python (3.14) mit Teilen in TypeScript, rund 253 000 Sterne und rund 52 000 Commits.
- Abhängigkeiten seit dem Wurm „Mini Shai-Hulud“ (Mai 2026) exakt gepinnt.
- Gedächtnis und Skills unter `~/.hermes`, selbst angelegt und verbessert.
- MCP-Client, Subagenten, Zeitpläne, Gateways zu Telegram, Signal & Co.
- Sieben Ausführungsorte (local, Docker, SSH, Singularity, Modal, Daytona, Vercel).
- Modelle über das Nous Portal, OpenRouter oder einen eigenen OpenAI-kompatiblen Endpunkt.
  Ollama auf dem GX10 geht (`http://localhost:11434/v1`). Die Kontextlänge stellt man an
  Ollama ein (`OLLAMA_CONTEXT_LENGTH`), nicht über die API.

**Was das Nous Portal liefert** – genau das wäre zu ersetzen:
- über 300 Modelle;
- ein „Tool Gateway“: Websuche, Bilder (FAL), Sprache (OpenAI-TTS), Cloud-Browser (Browser Use).

Alles über ein Abo mit OAuth-Anmeldung.

**Der Schlüssel ist ACP.** Hermes spricht das Agent Client Protocol (`hermes acp`, JSON-RPC über
stdio). Der Client sieht darüber:
- jedes Werkzeug, jeden Diff und jeden Befehl;
- Freigaben mit „einmal, für die Sitzung, immer, ablehnen“ – ohne Antwort nach 300 s
  abgelehnt;
- Gedanken und Antwort als Strom.

Der Client kann MCP-Server je Sitzung mitgeben. Das passt fast eins zu eins auf VKa:
Werkzeug-Aufruf → Schritt `befehl`, Freigabe-Anfrage → `wartet` und `freigabe`, Abbruch → `stopp`.
ACP sprechen auch Goose, Gemini CLI, Qwen Code, Cline und andere. Der Knoten als ACP-Client kann
den Motor also tauschen.

**Freedom statt Nous Portal:**

| Portal | Freedom |
|---|---|
| Modelle | das Modell auf dem GX10 (eigener Endpunkt), später Freedom-Provider über einen Endpunkt im Knoten, bezahlt wie heute |
| Websuche | Such-Werkzeug des Knotens (8.7) als MCP |
| Bilder | ComfyUI auf dem GX10 oder Freedom-Provider (5070) als MCP |
| Sprache | Piper und whisper.cpp (B-38) als MCP |
| Browser | Playwright-MCP (Microsoft, Apache-2.0) in der Sandbox |
| dazu | Kiwix ohne Netz (B-31), die Programme unten |

Diese MCP-Server gibt der Knoten Hermes über ACP je Sitzung mit. Hermes braucht dann kein Portal
und keinen eigenen Schlüssel. *(Seit VKd1: über `config.yaml`, die der Knoten vor jedem Lauf neu schreibt – also
ebenfalls je Lauf. Über `session/new` ginge es nur, wenn Hermes `mcpCapabilities.http` ankündigte; 0.19 tut das nicht.)*

**Was dagegen spricht, und was wir dagegen tun:**

| Punkt | Gegenmittel |
|---|---|
| Groß und schnell bewegt (52 000 Commits, über 5 000 offene Issues und PRs); Python 3.14, Node, ripgrep, FFmpeg | eine geprüfte Fassung pinnen und selbst ins Bild des Knotens bauen. Nie `curl … \| bash` von nousresearch.com (Regel aus C-21); Updates nur bewusst |
| Eigene Netzwege: Portal-Login, `skills.sh`, Übernahme fremder Anmeldungen (Codex, Claude Code) | `auth.adopt_external_logins: false`, kein Portal; Hermes läuft ganz in unserer Sandbox und erreicht nur das Modell und die freigegebenen MCP-Server |
| Freigaben: Modus „smart“ fragt ein zweites Modell; in Docker und Co. prüft Hermes gar nicht („der Container ist die Grenze“); `local` läuft direkt auf dem Rechner | Hermes mit `local` **in** bubblewrap (die Grenze ist unsere), Freigaben `manual` über ACP an den Knopf in der App; Modus „frei“ = „für die Sitzung erlauben“ |
| Telemetrie nicht dokumentiert | vor dem Einbau im Code prüfen; die Sandbox lässt ohnehin nichts hinaus |
| Gedächtnis und Skills auf der Platte | für eigene Projekte erlaubt (AG1 A), ein `~/.hermes` je Projekt. Für Aufträge Fremder (11.5) nie – dort bleibt der flüchtige eigene Ablauf |
| Ausgerichtet auf große Modelle; lokale Modelle brauchen Tool-Calling und langen Kontext | Modell mit Tool-Calling wählen (E9-Manifeste), Kontext auf mindestens 64 000 stellen |

**Ergebnis:** Gegen Hermes spricht nichts Grundsätzliches, wenn er gepinnt, abgeschottet und über
ACP angebunden ist. Daraus wird der neue Vorschlag VK-W1n.

### Live-Vorschau für alles (zu VK-W3)

**Der GX10 ist ARM64** (NVIDIA GB10: Grace-CPU und Blackwell-GPU, DGX OS auf Ubuntu-Basis). Er hat
einen Video-Kodierer (NVENC der 9. Generation: H.264, HEVC, AV1). Ein virtueller 4K-Bildschirm
mit NVENC läuft dort nachweislich (Sunshine, Community-Projekt). Was daraus folgt:

| Ziel | Auf dem GX10 | Wie |
|---|---|---|
| Web-Apps | ✓ | statisch über die Relays in die App (wie VK5) oder live: Chromium im virtuellen Bildschirm, gestreamt – dann auch mit eigenem Server |
| Linux-Programme (GTK, Qt, Electron, Godot-Spiele) | ✓ | virtueller Bildschirm (Wayland/X) in der Sandbox, gestreamt |
| Android-Apps | ✓ ausführen, △ bauen | **redroid** (Android bis 16 im Container, auch arm64; braucht das Kernel-Modul binder – auf DGX OS prüfen, das Projekt ruht seit Mitte 2025), Bild über **scrcpy** (Apache-2.0). Bauen: Gradle läuft, aber Googles Build-Werkzeuge (`aapt2`) gibt es nur für x86-64 – Community-Bau für arm64 (`lzhiyong/android-sdk-tools`, Apache-2.0) oder Emulation mit FEX |
| Windows-Programme | △ | Wine; x86-Programme über **Hangover** (Wine mit FEX oder Box64, LGPL-2.1; 11.0 vom Januar 2026) – viele laufen, nicht alle |
| Unity, Unreal, DaVinci Resolve, Ableton | ✗ | Editoren gibt es nicht für Linux ARM64 (Unity: Linux nur x64; Unreal: Editor nicht auf ARM64; Resolve: Linux nur x86; Ableton: kein Linux) → Werkbank (unten) |
| iOS | ✗ | nur mit einem Mac → Werkbank |

**Die Strecke zum Handy:**
- **Bild:** wie ein Anruf (B-13), nur ohne Ton. WebRTC, Medien nur über den eigenen TURN,
  Aufbau versiegelt wie `baueAnrufNachricht()`, kodiert mit NVENC. Kein offener Port, keine
  fremde Domain.
- **Eingaben zurück:** Tippen, Wischen, Tastatur über einen Datenkanal derselben Verbindung.
- **Bausteine:** GStreamer `webrtcbin` (LGPL, eigener Prozess). Als Vorlage dienen Selkies
  (MPL-2.0, sucht Betreuer) und neko (Apache-2.0).

**Werkbank-Knoten** – für alles, was auf ARM64 nicht läuft:
- Weitere eigene Rechner (ein Windows- oder x86-Linux-PC, ein Mac) werden per QR gekoppelt wie
  der GX10.
- Dort laufen Unity, Unreal, Resolve, Android Studio oder Xcode samt ihren MCP-Servern.
- Der Agent auf dem GX10 bedient sie über MCP, versiegelt über Freedom. Die Vorschau kommt von
  dort aufs Handy.
- Der GX10 bleibt das Gehirn, die Werkbank liefert die Hände. Ohne Werkbank sagt der Agent
  ehrlich, was auf dem GX10 nicht geht.

### MCP für gängige Programme (zu VK-W3; Wunsch MENSCH 14.10.: „alle MCPs und gängigen SOTA-Programme, die zusätzlich passen“)

Lizenzen aus den Repos gelesen (14.10.); „?“ heißt: noch zu prüfen. ARM64 bezieht sich auf den GX10.

| Bereich | Programm | MCP-Server | Lizenz | ARM64 |
|---|---|---|---|---|
| Spiele | Godot | `Coding-Solo/godot-mcp` | MIT | ✓ (offizieller arm64-Editor) |
| | Unity | `CoplayDev/unity-mcp` | MIT | ✗ → Werkbank |
| | Unreal | `chongdashu/unreal-mcp` | ? | ✗ → Werkbank |
| 3D | Blender | offiziell (Blender Lab, seit April 2026, Blender ab 5.1) oder `ahujasid/blender-mcp` | ? / MIT | △ (Pakete der Distribution, offizielle arm64-Builds unklar) |
| CAD | FreeCAD | `neka-nat/freecad-mcp` | MIT | ✓ |
| | OpenSCAD | `RobertCoop/openscad-mcp` u. a. | ? | ✓ |
| Elektronik | KiCad | `oaslananka/kicad-mcp-pro` | MIT | ✓ |
| 2D | GIMP | `maorcc/gimp-mcp` | ? | ✓ |
| | Inkscape | `grumpydevorg/inkscape-mcps` | ? | ✓ |
| | Krita | mehrere, keiner klar führend | ? | ✓ |
| Video/Ton | OBS Studio | `obs-studio-mcp` (PyPI) | MIT | ✓ |
| | DaVinci Resolve | Community-Server | ? | ✗ → Werkbank |
| | Ableton Live | `ahujasid/ableton-mcp` | MIT | ✗ → Werkbank |
| Büro/Daten | LibreOffice | mehrere (`mcp-libre` …) | ? | ✓ |
| | Jupyter | `datalayer/jupyter-mcp-server` | BSD-3 | ✓ |
| | QGIS | `jjsantos01/qgis_mcp` | ? | ✓ |
| Web/Test | Browser | Playwright MCP (Microsoft) | Apache-2.0 | ✓ |
| | Chrome | Chrome DevTools MCP (Google) | Apache-2.0 | ✓ |
| Mobil | Android (adb) | `mobile-next/mobile-mcp` | Apache-2.0 | ✓ mit redroid |
| KI-Medien | ComfyUI | Community-Server | ? | ✓ (CUDA) |
| Zuhause | Home Assistant | eingebaut seit 2025.2 | Apache-2.0 | ✓ |
| Entwicklung | git, Dateien, Datenbanken | Referenz-Server (`modelcontextprotocol/servers`, MIT → Apache-2.0) | MIT/Apache | ✓ |
| Wissen | Kiwix | B-31 | – | ✓ |

**Regeln für MCP** (MC1 A gilt weiter):
- Jeder Server läuft hinter der `ToolRegistry` und mit seinem Programm in der Sandbox des
  Projekts.
- Grafische Programme bekommen den virtuellen Bildschirm und die GPU (`/dev/dri`,
  `/dev/nvidia*`) eingebunden. Sonst nichts vom Rechner.
- Server, die beliebigen Code im Programm ausführen (Blender, QGIS, Unity), gelten wie Befehle:
  Freigabe im Modus „fragen“.
- Aufgenommen wird nur ein Server mit offener Lizenz ohne starkes Copyleft im eigenen Code. Das
  Programm selbst darf GPL sein (eigener Prozess, nur aufgerufen).
- Jeder Server wird gepinnt und im PR mit Name, Zweck, Größe und Lizenz genannt.

### Code zum Eintippen (VK-W5 B)

- **K1 – ohne neue Kryptografie** (Vorschlag):
  - `npm run koppeln -- --code` zeigt einen Code aus zwölf Zeichen (Crockford-Base32, drei
    Vierer: `7KQ2-9XMB-4TRP`, 60 Bit), gültig zehn Minuten.
  - Der Knoten legt für diese Zeit ein Event mit Ablauf (NIP-40) auf die Relays, signiert mit
    seinem Schlüssel. Es trägt den Kopplungscode, verschlüsselt mit einem Schlüssel aus dem
    Code (PBKDF2-SHA256 mit 600 000 Runden, wie der Tresor – keine neue Bibliothek). Gefunden
    wird es über einen Hash des Codes.
  - Die App tippt den Code, findet das Event, prüft die Signatur, entschlüsselt und koppelt wie
    mit dem QR.
  - Danach bestätigt sie versiegelt; der Knoten löscht das Event (NIP-09), und der Code verfällt.
  - **Sicherheit:** Wer das Event mitliest, müsste 2^60 Codes durch je 600 000 Runden PBKDF2
    rechnen – nicht machbar in zehn Minuten oder Jahren.
- **K2 – kurzer Code mit 6–8 Ziffern über ein PAKE-Verfahren** (CPace über ristretto255, wie in
  libsodium): Raten ginge nur online, ein Versuch je Code. `@noble/curves` hat ristretto255
  schon, eine fertige JS-Bibliothek für CPace gibt es nicht. Wir würden Kryptografie selbst
  bauen – später und nur mit Prüfung.

### Neue Aufteilung (ersetzt VKc–VKf oben)

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| VKb | Sandbox (= 11.5s): bubblewrap je Befehl bzw. für den ganzen Motor, Grenzen, GPU und Bildschirm nur auf Wunsch | B | ~250 – **fertig** (`node/src/sandbox.ts`: `fuehreAus()` je Befehl, `sandboxMotor()` für den Motor, `pruefeSandbox()` beim Start und in `npm run pruefen`; Arbeitsspeicher und seccomp noch nicht – 11.5s2; unter Docker sperrt das Standard-Seccomp Nutzer-Namensräume – seit VKc3b über `docker-compose.vibecoden.yml` gelöst); den Bildschirm bringt VKg |
| VKc1 | Knoten: Projekte (`~/.freedom/projekte`, git je Projekt), Code-Aufträge annehmen (5080), nur für den Besitzer | A | ~300 – **fertig** (`liste`, `neu`; ein Lauf bis VKc2 mit `code-ohne-motor` abgelehnt) |
| VKc2 | Knoten: ACP-Client (`@agentclientprotocol/sdk`, neue Abhängigkeit) – Schritte, Freigaben, Stopp auf VKa abbilden; Motor tauschbar | A | ~350 – **fertig** (`code-motor.ts`: Lauf im Hintergrund, Commit je Schritt; gestartet wird der Motor erst mit der Sandbox in VKc3, bis dahin `code-ohne-motor`) |
| VKc3 | Hermes gepinnt ins Bild, eigene Konfiguration (eigener Endpunkt, `manual`, kein Portal, keine fremden Anmeldungen), `~/.hermes` je Projekt, in der Sandbox | A + B | ~250 – **VKc3a fertig** (`hermes-motor.ts`, `modell-bruecke.ts`, `motor/freedom_motor.py`: Brücke über einen Unix-Socket, Konfiguration je Projekt in `~/.freedom/hermes/<projekt>`, `main.ts`); **VKc3b fertig** (Hermes 0.19.0 im Bild mit `VIBECODEN=1`, Sandbox unter Docker über `docker-compose.vibecoden.yml`) |
| VKd | Freedom-MCP im Knoten: Suche, Bilder, Sprache, Browser, Kiwix – je Sitzung über ACP | A + B | ~300 – **VKd1 fertig** (`freedom-mcp.ts`: Websuche und Seite lesen als MCP-Server hinter der Brücke, `POST /mcp`; Hermes findet ihn über `config.yaml`, nicht über `session/new` – Hermes 0.19 kündigt MCP über HTTP in `initialize` nicht an; Netz-Werkzeuge fragen nicht vorher); **VKd1b fertig** (18.10., VKd-W1: wie Claude – `read_page` liest nur Adressen aus dem Auftrag und aus Ergebnissen von `web_search`, `LeseFreigaben`); **VKd3 fertig** (18.10., VK4/W6a „Pakete holt der Knoten“: npm und PyPI über die Brücke, `paket-spiegel.ts` – nur die feste Liste der Registries, Adressen in Paketlisten und Index auf die Brücke umgeschrieben; gemessen: `npm install vite vue` und `vite build` in der Sandbox ohne Netz, 11 s); VKd2: Bilder, Sprache, Kiwix, Seiten-Bedienung |
| VKe | App: Projekte-Seite (Chat, Schritte, Freigabe, Diff, Rückgängig) | C, Bausteine A | ~400 – **VKe1 fertig** (`knoten-projekt-ui.ts`, `knoten-lauf.ts`: Auftrag, Schritte live, Ja/Nein, Stopp, Abschluss); **VKe2a fertig** (Code-Aktionen `verlauf`, `diff`, `zurueck` im Knoten, `PROTOCOL.md` §34); **VKe2b fertig** (Verlauf, Änderungen über `zeigePatch()`, „hierher zurück“ nach Rückfrage) – VKe fertig, die Vorschau gehört zu VKg |
| VKf | Kopplung mit Code zum Eintippen (K1) | A | ~250 – **fertig** (`kurzcode.ts`, Kind 38076, `npm run koppeln -- --code`, `PROTOCOL.md` §35) |
| VKg | Live-Vorschau: virtueller Bildschirm, NVENC, WebRTC über den eigenen TURN, Eingaben zurück (Web und Linux) | B + A | ~400 je Teil – entschieden 18.10. (unten): **VKg1** Vorschau wie Replit über eigene Adresse des Knotens (a Server und Code-Aktion, b App, c Dev-Server aus der Sandbox) – **VKg1a fertig** (`vorschau.ts`: eigener Port, Zeichen je Projekt, Cookie, nur Dateien im Projekt; Code-Aktion `vorschau`, `VORSCHAU_URL`), **VKg1b fertig** (Knopf „Vorschau“ auf dem Blatt des Projekts, neuer Tab; in der Hülle Adresse und QR), **VKg1c fertig** (Dev-Server: `npm run dev` in der Sandbox, Rückweg über einen Socket, die Vorschau leitet weiter samt WebSocket; gemessen mit Vite: erste Seite nach 1,5 s, Hot Reload nach 45 ms ohne Neuladen) – VKg1 fertig; **VKg2** Bildstrom für Programme ohne Web (Teile unten: a1 Tunnel, a2 Bild, a3 Eingaben, b App, c Docker und NVENC) – **VKg2a1 fertig** (`turn-tunnel.ts`: die Sandbox erreicht den TURN nur über einen Socket des Knotens, der nur eine UDP-Allokation zu den Relay-Adressen der App durchlässt), **VKg2a2 fertig** (`bildstrom.ts`, `motor/freedom_bild.py`: Programm und Bild in zwei Sandboxen, Code-Aktionen `bild` und `bild-ende`; gemessen: Antwort nach rund 1 s, 30 Bilder je Sekunde), **VKg2a3 fertig** (Eingaben aus dem Datenkanal über XTest). Die Vorschau über die Relays (VK5) liefe nicht – ein `blob:`-Rahmen erbt die CSP der App, Chromium verweigert seine Skripte (gemessen 17.10.) |
| VKh | Android: redroid und scrcpy in der Sandbox, APKs bauen (arm64-`aapt2` oder FEX) | B | ~300 |
| VKi | Windows: Wine und Hangover | B | ~200 |
| VKj | Werkbank-Knoten: weitere eigene Rechner als MCP-Träger, Vorschau von dort | A + B | ~400 |
| VKk | MCP-Katalog: Programme und Server aus der Tabelle, je einer pro PR, gepinnt | B | je ~100 – **VKk1 fertig** (`mcp-katalog.ts`: der Browser – Playwright MCP aus `playwright-core` 1.62.1, das der Knoten schon hatte, exakt gepinnt; Chromium aus Debian im Bild mit `VIBECODEN=1`; als Kind von Hermes in dessen Sandbox, ohne Netz; Werkzeuge nur aus `PLAYWRIGHT_WERKZEUGE`, ohne `browser_run_code_unsafe`) |
| VKl | „Als Repo in einen Raum stellen“ | A | ~200 – **fertig** (VKl1 Knoten: Code-Aktion `bundle`, `PROTOCOL.md` §34; VKl2 App: „Mein Knoten“ › Projekte) |

### Neue Fragen

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| VK-W1n | Wie arbeitet der Agent auf dem eigenen Knoten? | A eigener Ablauf (wie 11.5) · B Hermes direkt · C Knoten als ACP-Client: Hermes als erster Motor (gepinnt, in der Sandbox, Freedom-MCP statt Portal), weitere ACP-Motoren tauschbar; für Aufträge Fremder (11.5) bleibt der flüchtige eigene Ablauf | **C** |
| VK-W6 | Neue Abhängigkeit `@agentclientprotocol/sdk` 1.8.0 (Apache-2.0, 6,1 MB entpackt, keine weiteren) für den Knoten | ja · nein | **ja** |
| VK-W7 | Werkbank-Knoten für Programme, die auf ARM64 nicht laufen (Unity, Unreal, Resolve, Ableton, Xcode) | A ja, weitere eigene Rechner per QR · B nur, was auf dem GX10 läuft | **A** |
| VK-W8 | Reihenfolge der Vorschau-Ziele | A Web und Linux zuerst, dann Android, dann Windows · B andere Reihenfolge | **A** |
| VK-W9 | Code zum Eintippen | K1 zwölf Zeichen ohne neue Kryptografie · K2 sechs bis acht Ziffern mit PAKE | **K1** jetzt, K2 später |

Quellen (13./14.10.2026):
- **Hermes:** [hermes-agent](https://github.com/NousResearch/hermes-agent),
  [ACP in Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp),
  [Sicherheit](https://hermes-agent.nousresearch.com/docs/user-guide/security),
  [Konfiguration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration),
  [Ollama-Integration](https://docs.ollama.com/integrations/hermes),
  [`pyproject.toml`](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/pyproject.toml).
- **ACP:** [ACP](https://agentclientprotocol.com/overview/introduction),
  [TypeScript-SDK](https://agentclientprotocol.com/libraries/typescript).
- **GX10:** [ASUS-FAQ GX10](https://www.asus.com/in/support/FAQ/1056142/),
  [heise zum GB10](https://heise.de/-10624970),
  [Sunshine auf DGX Spark](https://github.com/seanGSISG/dgx-spark-sunshine-setup).
- **Programme auf ARM64:** [Unity-Systemanforderungen](https://docs.unity3d.com/Manual/system-requirements.html),
  [Unreal auf Linux ARM64 (Anfrage)](https://forums.unrealengine.com/t/feature-request-official-unreal-editor-linux-arm64-aarch64-support-for-nvidia-dgx-spark-gb10/2731250),
  [Godot 4.5.1](https://godotengine.org/download/archive/4.5.1-stable/),
  [Android-SDK-Werkzeuge arm64](https://github.com/lzhiyong/android-sdk-tools),
  [Hangover 11.0](https://phoronix.com/news/Hangover-11.0-Released).
- **Vorschau:** [redroid](https://github.com/zhouziyang/redroid-doc),
  [Selkies](https://github.com/selkies-project/selkies).
- **MCP:** [Spiel-Engines](https://www.strayspark.studio/blog/unreal-vs-blender-vs-godot-mcp-comparison-2026),
  [Blender offiziell](https://www.strayspark.studio/blog/official-blender-mcp-server-comparison-2026),
  [CAD](https://chatforest.com/reviews/cad-3d-modeling-mcp-servers/),
  [KiCad/OpenSCAD](https://github.com/oaslananka/kicad-mcp-pro),
  [GIMP/Inkscape](https://github.com/RaphaDevx/K-Creative-Cloud),
  [OBS](https://pypi.org/project/obs-studio-mcp/),
  [QGIS](https://glama.ai/mcp/servers/jjsantos01/qgis_mcp),
  [LibreOffice](https://github.com/jwingnut/mcp-libre),
  [Jupyter](https://github.com/datalayer/jupyter-mcp-server),
  [Home Assistant](https://raspberry.tips/en/smart-home/home-assistant-mcp-server-ai-setup).
- **PAKE:** [CPace (Go)](https://pkg.go.dev/filippo.io/cpace),
  [CPace (libsodium)](https://github-redirect.dependabot.com/jedisct1/cpace).

## Entscheidungen vom 14.10.2026 (MENSCH)

„Ja zu allen deinen Vorschlägen für die offenen Entscheidungen.“ Dieser Abschnitt gilt vor
den neuen Fragen oben.

| Nr. | Entscheidung |
|---|---|
| VK-W1n | **C** – der Knoten ist ACP-Client; Hermes ist der erste Motor (gepinnt, in der Sandbox, Freedom-MCP statt Nous Portal), weitere ACP-Motoren tauschbar. Aufträge Fremder (11.5) behalten den flüchtigen eigenen Ablauf |
| VK-W6 | **Ja** – `@agentclientprotocol/sdk` 1.8.0 (Apache-2.0, 6,1 MB entpackt, keine weiteren Abhängigkeiten) im Knoten, exakt gepinnt |
| VK-W7 | **A** – Werkbank-Knoten: weitere eigene Rechner per QR für Programme ohne ARM64 |
| VK-W8 | **A** – Vorschau erst für Web und Linux, dann Android, dann Windows |
| VK-W9 | **K1** – zwölf Zeichen ohne neue Kryptografie, gestreckt mit PBKDF2 wie der Tresor; K2 (PAKE) später |

Damit sind VKc2 (ACP-Client), VKf (Kurzcode) und VKj (Werkbank-Knoten) frei; VKc3 und VKd
folgen nach VKc2 und der Sandbox (VKb, Spur B).

**Seit VKb (15.10.2026):** Die Sandbox hat kein Netz. Den Endpunkt des Modells und die
MCP-Server erreicht der Motor darin nur über eine Brücke, die VKc3 baut (wie die Proxy-Brücke
von Codex: ein Unix-Socket in die Sandbox, dahinter nur das Modell) – nie, indem die Sandbox
das Netz des Rechners teilt.

## Entscheidungen vom 18.10.2026 (MENSCH)

| Nr. | Entscheidung |
|---|---|
| VKd-W1 | **Wie Claude und OpenAI, ohne Fragen** („Wie macht Claude und OpenAI das? Mach es genauso, ohne fragen.“) |
| VKg-W1 | **Wie Replit** („schnelles Live-Rendern in Originalqualität, direkt spielbar/durchklickbar“) – die Vorschau über eine eigene Adresse des Knotens; der Bildstrom bleibt für Programme ohne Web |
| VKg-W2 | **Ja** – GStreamer `webrtcbin`, virtueller Bildschirm und Chromium ins Bild, nur mit `VIBECODEN=1` |

**VKd-W1 – so machen es die anderen (gelesen 18.10.):**
- **Claude** (`web_fetch`): Claude baut keine Adressen selbst. Abgerufen wird nur, was in der
  Nachricht des Nutzers steht oder aus Suchergebnissen kommt. Links aus abgerufenen Seiten
  zählen seit Juli 2026 nicht mehr. Gefragt wird nicht.
- **OpenAI:** ChatGPT ruft eine Adresse ohne Rückfrage nur ab, wenn ein unabhängiger Index sie
  schon kennt, also öffentlich. Codex arbeitet mit einer Liste erlaubter Domains, nur GET, HEAD
  und OPTIONS.

Freedom macht es wie Claude (**VKd1b**): `read_page` liest nur Adressen aus dem Text des
Auftrags und aus Ergebnissen von `web_search` (`LeseFreigaben` in `freedom-mcp.ts`).
- Eine selbst gebaute Adresse lehnt der Knoten ab, ebenso einen Link aus einer gelesenen Seite.
  Eine Seite kann den Agenten also nicht dazu bringen, Inhalt des Projekts in eine Adresse zu
  packen.
- Gefragt wird nicht.
- Die Suchanfrage bleibt frei, wie bei Claude und OpenAI. Was darin steht, sieht die
  Suchmaschine; `PROVIDER.md` sagt das.

**VKg-W1 – Vorschau wie Replit.** Replit zeigt die laufende App über eine eigene Adresse, im
Browser echt gerendert und sofort neu nach jeder Änderung; dazu gibt es „im neuen Tab öffnen“.
Übertragen auf den Knoten:
- **VKg1a (Knoten):** ein Vorschau-Server auf eigenem Port, also eigenem Ursprung.
  - Nie auf dem Port von Relay und App: Sonst teilte die Vorschau den Ursprung mit freedom.html
    und käme an deren Speicher.
  - Im Pfad steht ein Zufallszeichen je Projekt. Der Besitzer bekommt es nur versiegelt, über
    die Code-Aktion `vorschau`.
  - Ausgeliefert werden die Dateien des Projekts, live und nur lesend: kein `.git`, keine
    Symlinks hinaus, `nosniff`, `no-store`, kein Referrer.
  - Nach außen gilt die Adresse aus `VORSCHAU_URL`: Heimnetz, eine Domain mit https oder `.onion`.
    Über http im Heimnetz kann mitlesen, wer im selben Netz ist – die Texte sagen das.
- **VKg1b (App):** ein Knopf „Vorschau“ auf dem Blatt des Projekts. Er öffnet die Adresse im
  neuen Tab (`noopener`). Die CSP der App ändert sich nicht.
- **VKg1c (Knoten):** Dev-Server aus der Sandbox (Vite, `npm run dev` …) für Hot Reload.
  - Die Sandbox bleibt ohne Netz.
  - Der Server lauscht dort auf einem Unix-Socket.
  - Der Vorschau-Server reicht Anfragen und WebSocket dorthin weiter.
- **VKg2:** Bildstrom für Programme ohne Web (Linux, später Android und Windows) und für
  unterwegs ohne Adresse.
  - Virtueller Bildschirm, GStreamer `webrtcbin`, NVENC auf dem GX10 (sonst Kodierung in
    Software), über den eigenen TURN (B-13).
  - Nur mit `VIBECODEN=1`.
  - **Gemessen 20.10.** (Ubuntu 24.04, GStreamer 1.24, coturn 4.6, Chromium): `xeyes` auf Xvfb
    1280×720 in bubblewrap ohne Netz, `webrtcbin` mit `ice-transport-policy=relay`, TURN über TCP
    durch den Tunnel des Knotens; Chromium mit `iceTransportPolicy: "relay"` über UDP. Erstes Bild
    1,45 s nach dem Angebot, danach 30 Bilder je Sekunde.
  - Zwei Befunde: In der Sandbox gibt es nur `lo`, und libnice lässt Loopback aus – ohne
    `add-local-ip-address 127.0.0.1` am ICE-Agenten sammelt `webrtcbin` gar nichts. Chromium meldet
    das Ende der Sammlung oft erst nach Sekunden; die App wartet nur, bis ein Relay-Kandidat da ist.
  - Teile:
    - **VKg2a1 (Knoten, fertig):** Tunnel zum TURN (`turn-tunnel.ts`). Ein Zugang zum TURN ist
      sonst ein Weg ins Internet (UDP) – auch für den Code des Projekts, der in derselben Sandbox
      läuft. Der Knoten liest mit: nur Binding, Allocate mit UDP, Refresh, CreatePermission,
      ChannelBind, Send und ChannelData, Gegenstellen nur die Relay-Adressen aus dem Angebot der App;
      TCP-Allokationen (RFC 6062) nie.
    - **VKg2a2 (Knoten, fertig):** zwei Sandboxen ohne Netz. In der einen `motor/freedom_bild.py`
      (Xvfb und `webrtcbin`, den TURN nur durch den Tunnel), in der anderen das Programm des
      Projekts (`.freedom/start`, sonst `main.py`); gemeinsam haben sie nur den Socket des
      Bildschirms. So kommt der Code des Projekts nie an den Zugang zum TURN, nie an den Tunnel und
      nie an die Ausgabe, aus der der Knoten die Antwort an die App liest – eine untergeschobene
      Antwort ließe die App sonst einen fremden Rechner anrufen und trüge Daten in ICE-Feldern
      hinaus. Code-Aktionen `bild` (Angebot rein, Antwort raus, beide nur mit Relay-Kandidaten) und
      `bild-ende`. Eine Web-Seite in Chromium ins Bild kommt mit VKg2c.
    - **VKg2a3 (Knoten, fertig):** Eingaben aus dem Datenkanal über XTest (Maus, Berührung, Rad,
      Tasten, auch Zeichen ohne Taste; Format in `PROTOCOL.md` §34) – nur an den eigenen Bildschirm.
    - **VKg2b (App):** Knopf „Bild“ auf dem Blatt des Projekts, Verbindung nur über den eigenen
      TURN (5079), Maus, Berührung und Tasten über den Datenkanal.
    - **VKg2c:** Pakete im Docker-Bild (nur `VIBECODEN=1`), NVENC auf dem GX10, Messung.
  - Befund für Spur B (B-13b): Liegt der TURN hinter NAT, sind seine Relay-Adressen privat, und
    `denied-peer-ip` sperrt Relay zu Relay auf demselben TURN – Anrufe zweier Geräte über denselben
    TURN und der Bildstrom. Vorschlag: `allowed-peer-ip=<eigene Relay-Adresse>` und `no-tcp-relay`
    (coturn erlaubt sonst TCP-Allokationen nach RFC 6062) in `turn-einrichten.sh`; prüft der MENSCH
    mit dem GX10.

**Sandbox auf anderen Geräten** (Frage MENSCH 18.10.: „Freedom soll ja nicht nur auf DGX Spark
laufen“):
- Die Sandbox (`sandbox.ts`, bubblewrap) ist nicht an den GX10 gebunden. Sie läuft auf jedem
  Linux, das Nutzer-Namensräume erlaubt: x86-64 und ARM64, Raspberry Pi (64 Bit), Server und
  Docker (`docker-compose.vibecoden.yml`).
- Ubuntu ab 24.04 kann Nutzer-Namensräume per AppArmor sperren
  (`kernel.apparmor_restrict_unprivileged_userns`). `pruefeSandbox()` sagt beim Start, ob die
  Sandbox geht.
- Unter Windows und macOS läuft der Knoten in Docker Desktop (WSL2 bzw. eine Linux-VM), darin
  dieselbe Sandbox.
- An den GX10 gebunden ist nur NVENC (VKg2).
- SPACE (perplexityai) passt nicht. Es braucht Kubernetes, Postgres und privilegiertes Docker
  und läuft nur auf x86-64.
- Später, für Aufträge Fremder (11.5), wäre gVisor (`runsc`, Apache-2.0, x86-64 und ARM64, ohne
  KVM) eine zweite Art in `sandbox.ts`. Es hat einen eigenen Kernel im Nutzerraum. Das ist eine
  neue Abhängigkeit und damit eine eigene Frage, wenn 11.5c sie braucht.
