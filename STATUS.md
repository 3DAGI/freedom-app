# FreedomStack — Statusbericht

Entwicklungsprotokoll: nach jedem Schritt ein Abschnitt `## Schritt <ID> – <Titel>`
am Ende. Abgeschlossene Monate stehen in `docs/archiv/STATUS-<JJJJ-MM>.md`
(`python3 scripts/status-archiv.py`) – bis Oktober 2026; der Bericht vom 29.08.2026
(Abschnitte 1–97) steht in `docs/archiv/STATUS-2026-09.md`.

---

## Schritt 11.5d2a – Absagen eines Repo-Auftrags in eigenen Sätzen, Kennzeichen an Patches von Agenten

Spur A, nach `docs/REPO-AGENTEN-ENTWURF.md` (11.5d, Teil d2 in zwei Teilen). Lehnte der Knoten einen Repo-Auftrag ab,
zeigte die App bisher den allgemeinen Satz mit der Kennung („… antwortet hier nicht (agent-repo-bundle)“). Jetzt hat jede
der acht Kennungen ihren Satz (`ablehnungsText()`): Der Knoten arbeitet nicht an Repos, nur bezahlt, das Repo gehört nicht
zum Raum, das Bundle fehlt oder ist nicht vollständig, das Issue fehlt, privat ohne Modell auf dem eigenen Rechner, gerade
belegt, Modell oder Sandbox gescheitert. Patches, die ein Agent des Raums eingereicht hat, tragen in der Liste und auf ihrer
Seite das Kennzeichen „Agent“ (`PatchZeile.vonAgent` aus `patchZeilen()` mit `istAgent` des Raums, `agentMarke()`) – mit dem
Hinweis, den Vorschlag vor dem Annehmen zu lesen. Annehmen dürfen weiter nur Eigentümer und Maintainer.

**Offen:** 11.5d2b – die Antwort des Agenten im Raum aus `fall` und `pakete` in eigenen Sätzen, mit Weg zum Patch; 11.5d3 –
„Agent beauftragen“ im Raum selbst.

**Tests:** `app/test/repo-agent.test.ts` (+2) – die acht Kennungen aus Knoten und Protokoll gelesen, je ein eigener Satz mit
`{name}` in beiden Sprachen, Unbekanntes (auch „constructor“) beim allgemeinen; das Kennzeichen nur am Patch des Agenten,
ohne Agenten des Raums keins, die Aktionen bleiben gleich; verdrahtet in Liste und Seite. Gegenproben 8 von 8 rot.

## Schritt 11.5d2b – Antwort des Agenten im Raum in eigenen Sätzen, mit Weg zum Patch

Spur A, nach `docs/REPO-AGENTEN-ENTWURF.md` (11.5d, zweiter Teil von d2). Der Knoten schreibt nach einem Repo-Auftrag einen
festen deutschen Satz in den Raum und hängt Kennungen an (`fall`, den Patch als `["e", …, "mention"]`, seit 11.5c3
`pakete`). Bisher zeigte die App nur den Satz – auf Englisch blieb er deutsch, und zum Patch führte nichts. Jetzt liest sie
die Tags über `leseRepoAntwort()` (Protokoll, Gegenstück zu `repoAntwortTags()`: je Tag höchstens eines, Kennungen in
derselben Form, der Patch genau bei `repo.patch`) und nur bei Nachrichten von Agenten des Raums (offen die Karten mit Rolle,
privat die der Gruppe). Gezeigt wird ein eigener Satz je Kennung (`REPO_FALL_TEXT`, die zehn aus `REPO_TEXT` des Knotens),
fehlten die Pakete, ein Satz dazu; eine unbekannte Kennung lässt den Text, wie er ist. Mit Patch gibt es „Patch ansehen“:
gesucht nur unter den Repos dieses Raums (`reposVonRaum()`, notfalls einmal neu geladen), dann öffnet `oeffneRepo()` die
Repo-Seite gleich mit diesem Patch (`oeffnePatchBeimZeigen()`); sonst ein Hinweis.

**Damit ist 11.5d2 fertig.** **Offen:** 11.5d3 – „Agent beauftragen“ im Raum selbst.

**Tests:** `protocol/test/repo-auftrag.test.ts` (+1): hin und zurück offen und privat, eine gewöhnliche Antwort ist keine,
neun Formen, die der Knoten nie schreibt, sind keine. `app/test/repo-agent.test.ts` (+2): je Kennung des Knotens ein eigener
Satz in beiden Sprachen (aus dem Quelltext gelesen), Unbekanntes auch „constructor“ ergibt keinen; verdrahtet – nur Agenten
des Raums, der Satz statt des Textes, der Knopf nur mit Patch, der Patch nur unter den Repos des Raums. Gegenproben 11 von 11 rot.

## Schritt 11.5d3 – „Agent beauftragen“ auch im Raum

Spur A, nach `docs/REPO-AGENTEN-ENTWURF.md` (11.5d, letzter Teil). Statt des Repo-Tags von selbst, wenn der Raum genau ein
Repo hat (V1), gibt es den Auftrag ausdrücklich: Im Raum-Menü steht „Agent beauftragen“, sobald der Raum ein Repo hat
(`#space-repo-agent`, sichtbar über `zeigeRaumRepos()` – dieselbe Liste wie unter den Kanälen, nur mit Identität). Bei
einem Repo geht es gleich weiter, bei mehreren fragt `beauftrageAgentImRaum()` erst, an welchem; danach derselbe Weg wie
auf der Repo-Seite (`beauftrageAgentAmRepo()`: Agent, Aufgabe, Obergrenze, Preis, dann die Nachricht). Ob ein Agent da
ist, sagt der Dialog.

**Damit ist 11.5d fertig** – und mit ihm der App-Teil von 11.5 (Repo-Agenten).

**Tests:** `app/test/repo-agent.test.ts` (+1) – Menüpunkt mit Text-Schlüssel und versteckt, sichtbar nur mit Identität und
Repo, übergibt die Repos des Raums, ein Repo gleich, mehrere zur Wahl, die Wahl zählt, sendet selbst nichts. Smoke-Test
„raum“: der Menüpunkt ist im Probe-Raum da und meldet, dass kein Agent auf einem Knoten da ist; die Tastatur-Prüfung
des Raum-Menüs (C.2b2) wartet jetzt auf die Repos des Raums und kennt den neuen ersten Punkt. Angepasst: die Prüfung aus
C.2b2 in `raum-verlauf.test.ts` nennt den Satz der Repo-Antwort (weiter nur `textContent`). Gegenproben 5 von 5 rot.

## Schritt VKk2b – Notebooks ausführen: über das Terminal des Motors, mit dem Kernel der Distribution

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk), auf VKk2a (#614). Damit ist VKk2 fertig.

- **`packages/node/mcp/notebook_ausfuehren.py`** (neu, ausführbar, `#!/usr/bin/python3`): führt alle Code-Zellen in einem
  Kernel aus und speichert die Ausgaben ins Notebook – auch bis zu einer Zelle, die scheitert („stopped at cell N (Fehler)“,
  Exit 1). Nur die Schnittstelle von nbclient: `jupyter execute --inplace` kennt erst nbclient 0.10, Ubuntu 24.04 (CI) bringt
  0.8. Fest die Python der Distribution – im PATH der Sandbox steht `/usr/local/bin` vorn. Der Motor ruft es im Terminal auf:
  in seiner Sandbox, ohne Netz, im Modus „fragen“ nach der Rückfrage von Hermes; die Brücke selbst führt weiter nichts aus.
- **Brücke:** Mit `--ausfuehren=<pfad>` nennt `notebook_read` den Befehl (`werkzeuge()`); anderes auf der Befehlszeile heißt
  kein Start.
- **`src/mcp-katalog.ts`:** `notebooksAusfuehrbar()` (einmal je Prozess: nbclient und ein Kernel `python3` bei
  `/usr/bin/python3`), `jupyterMcp({ ausfuehren })`; ohne Kernel `mcp.jupyter-kernel-fehlt` im Log und in `npm run pruefen`.
- **Bild und CI:** `python3-ipykernel` und `python3-nbclient` aus Debian nur mit `VIBECODEN=1`; die CI installiert sie für
  den Echttest (Zwischenspeicher wie B-42).
- Fallstrick im Knoten (dazu die rohen Zeilentrenner aus VKk2a in `packages/node/CLAUDE.md` als ` `/` `), Provider-
  Anleitung, Entwurf, OFFEN, FORTSCHRITT, Stand-Zeile.

**Tests:** node +4 (`jupyter-ausfuehren.test.ts`): Befehl nur mit Kernel, Log sagt, was fehlt, Skript ausführbar mit der
Python der Distribution; die Brücke nimmt nur ein Skript mit absolutem Pfad; Pakete nur im Bild mit Vibecoden und in der CI;
echt in bubblewrap: 42 und π im Notebook, kein Netz, Halt bei `1/0` mit gespeicherten Ausgaben, nach der Korrektur laufen
alle Zellen, nbformat schreibt Byte für Byte wie die Brücke. Gegenprobe: ohne Speichern beim Fehler rot. Der Kiwix-Test
aus VKd2a, der genau „nichts fehlt“ erwartet, schaltet Jupyter ab.

## Schritt 11.5s4b – Speicher und Prozesse je Befehl zusammen: cgroups v2 mit eigenem Teilbaum

Spur B, `docs/REPO-AGENTEN-ENTWURF.md` (Aufteilung W3: 11.5s4b), nach 11.5s3 (4 GiB je Prozess) und 11.5s4a (1024 Prozesse je
Befehl über `ulimit`). MENSCH 01.11.: nächster Schritt der Spur.

- **`packages/node/src/cgroup.ts`** (neu): `richteCgroupsEin()` – nur mit reinem cgroups v2 und schreibbarer eigener Gruppe mit
  `memory` und `pids`; zieht alles aus der eigenen Gruppe nach `knoten` und schaltet die Controller für die Kinder ein.
  `CgroupVerwalter.neu()` legt je Befehl `befehl-<zufall>` an (`memory.max`, `memory.swap.max` 0, `pids.max`), `weg()` beendet
  den Rest (`cgroup.kill`) und räumt auf. `inCgroup()`: Der Befehl tritt selbst ein und wird dann zu bubblewrap.
- **`src/sandbox.ts`:** Befehle, Motor und Dienste starten über `starteBwrap()` – mit Teilbaum je in einer eigenen Gruppe
  (8 GiB, 1024 Prozesse zusammen, `SANDBOX_GRENZEN.speicherGesamtKiB`); ohne wie bisher. Die Warnung „läuft als root“ entfällt
  mit Gruppen (`pids.max` gilt auch für root).
- **`src/main.ts`:** einmal beim Start, vor den ersten Kindern; Log `[sandbox] …` (`CGROUP_TEXT`).
- **Installer:** `Delegate=memory pids` im Dienst `freedom-node`. Unter Docker bleibt es je Prozess.
- **CI:** eigener Schritt nach den Knoten-Tests – `systemd-run --scope -p Delegate=yes` als root mit `CGROUP_TEST_PFLICHT=1`.
- Fallstrick im Knoten, `docs/PROVIDER.md`, Entwurf, OFFEN (Zeile entfernt), FORTSCHRITT, Stand-Zeile.

**Tests:** node +5 (`sandbox-cgroup.test.ts`): eigene Gruppe nur aus reinem cgroups v2; einrichten erst umziehen, dann
einschalten, sonst nichts geändert (ohne Controller, ohne Delegation, cgroups v1, nur prüfen); je Befehl Grenzen, ohne Swap-Datei
keine, halbe Gruppe wieder weg, Aufräumen auch nach Verzögerung; die Sandbox tritt vor bubblewrap ein (derselbe Prozess), Dienste
ebenso, ohne bubblewrap „fehlt“ wie bisher; echt (nur mit Teilbaum, in der CI Pflicht): drei Prozesse zu je 150 MiB über
256 MiB zusammen – einer endet, ohne Gruppe laufen alle; als root höchstens 64 Prozesse; keine Gruppe bleibt liegen. Gegenprobe:
ohne Eintreten rot.

## Schritt VKk3a – Godot-Spiele im Bild: Godot in der Sandbox des Programms, das Release gegen SHA-512 geprüft

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: Godot), nach VKg2 (Bildstrom). Erster Schritt
für die grafischen Programme; die Referenz-Server für git und Dateien entfallen – Hermes bringt Werkzeuge für Dateien und das
Terminal mit, git läuft dort (Empfehlung, MENSCH 01.11.: offene Entscheidungen nach Empfehlung).

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt `project.godot` (eine echte Datei), wenn der Knoten Godot hat –
  nach `.freedom/start`, vor `main.py` und Web. `GODOT_START`: erst `--headless --import` wie der Editor (sonst fehlen Texturen
  und Klänge; dabei entsteht `.godot/`), dann wird die Shell zum Spiel. `godotArgumente()`: X11, `gl_compatibility` mit
  `opengl3` (Mesa in Software – die GPU bekommt nur die Bild-Sandbox), `Dummy` für den Ton, so groß wie das Bild.
  `godotAusUmgebung()`: `GODOT` (absoluter Pfad einer Datei, `aus`), sonst `/usr/local/bin/godot`. Das Programm sieht Godot als
  einzelne Datei nur lesbar unter `/freedom/godot`, die Bild-Sandbox nie.
- **`src/main.ts`:** Godot an den Bildstrom; das Log sagt „Godot-Projekte“ oder „ohne Godot“.
- **`scripts/godot-holen.sh`** (neu): Godot 4.7.2 als offizielles Release für x86_64 und arm64, SHA-512 fest im Skript (aus
  `SHA512-SUMS.txt`), Lizenztexte ebenso; nur https, erst geprüft, dann unter dem Namen, aus dem Archiv nur die eine Datei.
- **Bild:** eigene Stufe `godot-holen` (curl und unzip bleiben draußen), nur mit `VIBECODEN=1`; Mesa und die X-Bibliotheken,
  die Godot lädt, in der Paketliste für Vibecoden.
- **CI:** das Release im Zwischenspeicher (Schlüssel nach dem Skript), geprüft bei jedem Lauf, `GODOT_TEST` für den Echttest.
- Fallstricke im Knoten und in den Skripten, `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf, OFFEN,
  FORTSCHRITT, Stand-Zeile.

**Tests:** node +6 – `bildstrom.test.ts` +5: `project.godot` nur mit Godot, nach dem eigenen Startbefehl, vor `main.py` und
Web, kein Verweis, kein Ordner, das Spiel und nie der Editor; Godot aus der Umgebung (aus, relativ, nicht in Normalform, Ordner,
falscher Pfad – kein Ausweichen, leer wie nicht gesetzt); der Start mit einem Godot als Attrappe: erst Import, dann `exec`
(dieselbe Prozessnummer), auch wenn der Import scheitert; im Bildstrom die eine Datei nur für das Programm, ohne GPU, nie für die
Bild-Sandbox, ohne Godot `code-bild-kein-programm`; Ende zu Ende mit echtem Godot (nur mit `GODOT_TEST`, in der CI): ein Spiel
mit grüner Fläche im Bild über den TURN, ein Klick über den Datenkanal macht sie rot, `.godot/` angelegt.
`docker-vibecoden.test.ts` +1: Fassung und vier Summen im Skript, nur https, erst prüfen, eine Datei; Stufe nur mit Vibecoden,
Mesa nur im großen Bild, CI mit Zwischenspeicher und `GODOT_TEST`. Gegenprobe: ohne `exec` rot. Godot selbst lief hier nicht –
den Agenten ist das Starten heruntergeladener Programme verwehrt; das Skript (laden, prüfen, auspacken, Zwischenspeicher,
kaputtes Archiv neu laden) lief hier.

## Schritt VKi1 – Windows-Programme im Bild: `main.exe` in Wine, das Programm erst nach der Antwort

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKi), nach VKg2 (Bildstrom). Erster Teil: x86_64; auf ARM64 (GX10) laufen x86-Programme erst
mit Hangover (VKi2).

- **`packages/node/src/bildstrom.ts`:**
  - `bildBefehl()` erkennt `main.exe` (eine echte Datei), wenn der Knoten Wine hat – nach `.freedom/start`, Godot und `main.py`,
    vor Web. `wineBefehl()`: Wine auf einer eigenen Arbeitsfläche so groß wie das Bild (ohne Fenstermanager hätten Fenster sonst
    keine Rahmen), Präfix im Home der Sandbox (tmpfs, rund 10 s je Start, nie im Projekt), ohne Mono, Gecko und Menü.
  - `wineAusUmgebung()`: nur Wine der Distribution unter `/usr` (`WINE_ORTE`), `WINE=aus` schaltet ab – kein eigener Pfad, Wine
    sind viele Dateien.
  - **Das Programm startet erst nach der Antwort der Bild-Sandbox**, nicht schon, wenn der Bildschirm steht: Wine hielt die
    Antwort beim Anlegen des Präfixes sonst auf (gemessen 11,7 s statt 0,7 s, die Frist ist 20 s). Das gilt für alle Programme;
    ohne Antwort startet keins.
- **`src/main.ts`:** Wine an den Bildstrom; das Log sagt „Windows-Programme in Wine“ oder „ohne Wine“.
- **Bild:** `ARG WINE=0` – nur mit `VIBECODEN=1` und `WINE=1` (`docker-compose.vibecoden.yml` reicht es durch) und nur auf amd64:
  `wine wine64` und mingw-w64 für C und C++ zum Bauen im Terminal des Motors, zusammen rund 1,2 GB; auf arm64 ein Hinweis auf VKi2.
- **CI:** `wine64` und `gcc-mingw-w64-x86-64` im Testjob (Zwischenspeicher wie B-42).
- **Test-Empfänger:** `frist` in `fixtures/bild/empfaenger.py` (Vorgabe 40 s) – Wine braucht mit dem Präfix länger.
- Fallstrick im Knoten (auch: das Präfix nie ohne Bildschirm vorab anlegen – im Bildstrom erschien das Programm dann nie),
  `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf, OFFEN, FORTSCHRITT, Stand-Zeile.

**Tests:** node +7 – `bildstrom.test.ts` +6: `main.exe` nur mit Wine, nach `main.py` und Godot, vor Web, kein Verweis, kein Ordner;
der Befehl (Präfix im Home, nie im Projekt, ohne Mono, Gecko, Menü, Arbeitsfläche in Bildgröße); Wine nur aus `/usr`, `aus`, kein
eigener Pfad; im Bildstrom nichts weiter eingebunden, ohne Wine `code-bild-kein-programm`; das Programm erst nach der Antwort,
ohne Antwort keins (Gegenprobe mit der alten Reihenfolge rot); Ende zu Ende mit echtem Wine 9.0 und einem mit mingw-w64 gebauten
Programm: grüne Fläche über den TURN, ein Klick macht sie rot, Antwort nach 0,6–0,9 s (fünf Läufe), das Projekt bleibt ohne
Präfix. `docker-vibecoden.test.ts` +1: Wine und mingw-w64 nur mit beiden Schaltern und nur auf amd64, Compose reicht `WINE`
durch, der Standard bleibt ohne, die CI installiert beides.

## Schritt VKi2 – Windows-Programme auf ARM64: Hangover im Bild, Echttest auf einem ARM64-Runner

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKi), nach VKi1. Damit ist VKi fertig: `main.exe` läuft im Bild auch auf dem GX10.

- **`scripts/hangover-holen.sh`** (neu): Hangover 11.16 (AndreRH/hangover) für Ubuntu 24.04 (`noble`) und Debian 12 (`bookworm`),
  SHA-256 je Archiv fest im Skript (das Projekt veröffentlicht keine – beim ersten Laden selbst gerechnet), nur https, nur auf
  ARM64; aus dem Archiv nur die vier Pakete (Wine, FEX für x86_64 über ARM64EC, FEX und box64 für 32 Bit) – ohne DXVK.
- **Bild:** Stufe `hangover-holen` (nur mit `VIBECODEN=1`, `WINE=1`, arm64), installiert im Hauptbild über `RUN --mount` – das
  Archiv liegt in keiner Schicht; dazu mingw-w64 wie auf amd64. Rund 3 GB. `docker buildx build --check`: keine Warnungen.
- **CI:** eigener Job „Windows-Programme auf ARM64 (Hangover)“ auf `ubuntu-24.04-arm` – Sandbox, Bildstrom, mingw-w64, Hangover
  aus dem Skript (Zwischenspeicher), dann die VKi-Tests mit `WINE_TEST_PFLICHT` (fehlt etwas, ist der Echttest rot).
- **Code:** Hangover bringt sein Wine unter `/usr/bin/wine` (in `WINE_ORTE`), die Emulatoren wählt es selbst
  (`libarm64ecfex.dll` steht in seinem `ntdll`, `wowbox64.dll` in `wow64` – nachgesehen in den Paketen). Im ersten Lauf des Jobs
  blieb das Bild schwarz: In der Sandbox endete FEX mit `c000001d` (unerlaubter Befehl). Die Diagnose (`test/fixtures/wine/
  diagnose.mts`, im Job nur bei Fehlern) trennte die Fälle – ohne Sandbox grün, mit deren Speichergrenze grün, in der Sandbox
  schwarz, in der Sandbox mit `/sys/devices/system/cpu` grün: Ohne den Ordner erkennen FEX und box64 die Merkmale des Prozessors
  falsch. `wineLesbar()` gibt ihn der Sandbox des Programms auf ARM64 nur lesbar und nur für Wine.
- **Bild ohne MIT-SHM:** Auch mit dem Ordner blieb der Echttest schwarz, obwohl Wine in der Diagnose zeichnete. Der
  Unterschied: Dort lief Xvfb außerhalb der Sandbox, im Bildstrom läuft er in der Bild-Sandbox mit eigenem IPC-Namensraum.
  Hängt das Programm ein Stück gemeinsamen Speichers an (MIT-SHM), hängt Xvfb das mit derselben Nummer in *seinem* Namensraum an
  – ximagesrc hat dort die Nummern 1 und 2 mit Rechten 1777. Lokal mit einem kleinen C-Programm nachgestellt: Stück 1 „hängt“,
  das Bild bleibt schwarz; ohne MIT-SHM grün. Das erklärt auch das offene Rätsel aus VKi1 (Präfix ohne Bildschirm: andere
  Nummern), und es war ein Weg in den Speicher der Bild-Sandbox. `freedom_bild.py` startet Xvfb jetzt mit
  `-extension MIT-SHM`; ximagesrc braucht dann `remote=true` – ohne SHM liefert es sonst nur Schwarz (GStreamer 1.24).
- Fallstricke im Knoten und in den Skripten, `docs/PROVIDER.md`, Entwurf, OFFEN (VKi-Zeile weg, Probe am GX10 unter 2.3),
  FORTSCHRITT, Stand-Zeile.

**Tests:** node +2 – `bildstrom.test.ts` +1: die Angaben zum Prozessor nur auf ARM64, nur für Wine, nie für die Bild-Sandbox
(der Test aus VKi1 nennt seine Architektur jetzt selbst); der Echttest mit dem Testprogramm prüft, dass der Bildschirm kein
MIT-SHM anbietet (Gegenprobe mit MIT-SHM: rot);
`docker-vibecoden.test.ts` +1 (Fassung, Summen, nur https, nur die vier Pakete, nur ARM64); der Test zu Bild und
CI aus VKi1 prüft jetzt beide Wege (amd64 Wine, arm64 Hangover über den Mount, nie per `COPY`) und den ARM64-Job. Der Echttest
im Bildstrom ist in diesem Job Pflicht (`WINE_TEST_PFLICHT`, sonst überspringt er sich ohne Wine oder mingw-w64). Hier lief das
Skript mit einer Attrappe für `uname` (Archiv prüfen, vier Pakete, falsche Distribution, x86_64 abgelehnt); Hangover selbst läuft
nur auf ARM64.

## Schritt VKk4a – OpenSCAD im Bild: `main.scad` mit Editor und Vorschau, neu geladen nach jeder Änderung

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: OpenSCAD), nach VKi. Das kleinste der grafischen
Programme und das für einen Agenten passendste: Das Modell ist Text.

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt `main.scad` (nur eine echte Datei), wenn der Knoten OpenSCAD hat –
  nach `main.exe`, vor Web. `openscadAusUmgebung()`: nur das Paket der Distribution unter `/usr` (`OPENSCAD_ORTE`), `OPENSCAD=aus`
  schaltet ab. `OPENSCAD_START` schreibt die Einstellungen ins Home der Sandbox (tmpfs) – Fenster so groß wie das Bild, ohne
  Customizer und Fehlerliste, „Automatic Reload and Preview“ – und wird dann zu OpenSCAD (`exec`). Wine und OpenSCAD suchen ihr
  Programm über denselben Helfer (`ersteDatei()`).
- **`packages/node/src/main.ts`:** gibt OpenSCAD an den Bildstrom; das Log sagt „OpenSCAD-Modelle“ oder „ohne OpenSCAD“.
- **Bild:** `openscad` aus Debian mit `VIBECODEN=1` (GPL-2.0+, eigenes Programm, nur in den Sandboxen). **CI:** `openscad` im
  Testjob, der Echttest läuft dort.
- **Test-Empfänger:** `stelle` – wo er die Farbe misst (links steht bei OpenSCAD der Editor).
- Fallstrick im Knoten, `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf, OFFEN, FORTSCHRITT, Stand-Zeile.

**Tests:** node +6 – `bildstrom.test.ts` +5: Erkennung (nur mit OpenSCAD, `main.py` und `main.exe` gehen vor, Web danach, kein
Verweis, kein Ordner), OpenSCAD aus der Umgebung, Start mit Attrappe (Einstellungen Byte für Byte, dann `exec` mit derselben
Prozessnummer), Bildstrom (nichts weiter eingebunden, keine GPU, ohne OpenSCAD `code-bild-kein-programm`); dazu der Echttest mit
OpenSCAD 2021.01: grüne Platte im Bild, der Test ändert `main.scad` wie der Agent, das Bild wird rot (Antwort nach 0,6–1,0 s, vier
Läufe ohne Fehler); im Projekt liegt danach nur `main.scad`. Gegenprobe ohne `autoReload`: rot – OpenSCAD zeigt dann nur den
Hintergrund. `docker-vibecoden.test.ts` +1: OpenSCAD nur im großen Bild, dort, wo der Knoten es sucht, und in der CI. Im Terminal
der Sandbox geprüft: STL geht, PNG endet ohne Bildschirm mit einem Speicherfehler – die Doku verspricht nur Modelle.

## Schritt B-43 – Docker-Bild fest auf Debian 12: `node:22-bookworm-slim` in jeder Stufe

Spur B, gefunden nach VKk4a beim Vergleich der Paketfassungen für weitere Programme im Bild.

- **`docker/node.Dockerfile`:** alle vier Stufen (`whisper-bau`, `godot-holen`, `hangover-holen`, Knoten) von `node:22-slim` auf
  `node:22-bookworm-slim`. Heute ist das dasselbe Bild (gleicher Digest auf `mirror.gcr.io`, 02.11.), aber `node:22-slim` wandert
  mit der nächsten Debian-Fassung mit – die Pakete des Bilds sind für Debian 12 gewählt, Hangover holt das Paket für `bookworm`,
  und auf Debian 13 schlüge der Bau mit `WINE=1` auf arm64 fehl oder liefe mit fremden Bibliotheken.
- Fallstrick im Knoten („Vibecoden unter Docker“), FORTSCHRITT, Stand-Zeile.

**Tests:** node +1 – `docker-vibecoden.test.ts`: jede Stufe `node:22-bookworm-slim`, Hangover für `bookworm`, `.nvmrc` mit
derselben Hauptversion; die Tests aus B-38b3 und VKk3a/VKi2 lesen die neuen Zeilen. Gegenprobe mit einer Stufe auf
`node:22-slim`: rot. `docker buildx build --check`: keine Warnungen.

## Schritt VKk4b – KiCad im Bild: `main.kicad_sch` im Schaltplan-Editor, neu gestartet nach jeder Änderung

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: KiCad), nach VKk4a und B-43.

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt `main.kicad_sch` (nur eine echte Datei), wenn der Knoten KiCad hat –
  nach `main.scad`, vor Web. `kicadAusUmgebung()`: nur eeschema der Distribution unter `/usr` (`KICAD_ORTE`), `KICAD=aus` schaltet ab.
  `KICAD_START` legt die Einstellungen ins Home der Sandbox (für KiCad 6 bis 9, Bibliothekstabellen aus der Distribution, wo es sie
  gibt) – sonst zeigt KiCad beim ersten Start nur einen Willkommensdialog. KiCad lädt eine geänderte Datei nicht von selbst: Das
  Skript startet den Editor neu, sobald sich Zeit oder Größe geändert haben und die Datei eine Sekunde ruhig ist (rund 2 s); überhört
  er das Ende, nach drei Sekunden hart. Endet er von selbst, endet das Programm. Die Sperrdatei löscht das Skript vor jedem Start.
- **`packages/node/src/main.ts`:** gibt KiCad an den Bildstrom; das Log sagt „Schaltpläne in KiCad“ oder „ohne KiCad“.
- **Bild:** `ARG KICAD=0`, nur mit `VIBECODEN=1` und `KICAD=1` (`docker-compose.vibecoden.yml` reicht es durch): KiCad mit Symbolen
  und Footprints aus `bookworm-backports` (Debian 12 selbst hat nur KiCad 6 ohne `kicad-cli`), rund 700 MB; die Quelle steht nur für
  diesen Schritt in `sources.list.d`. **CI:** `kicad` (7.0 aus Ubuntu 24.04) im Testjob, der Echttest läuft dort.
- Fallstrick im Knoten, `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf, OFFEN, FORTSCHRITT, Stand-Zeile.

**Tests:** node +6 – `bildstrom.test.ts` +5: Erkennung (nur mit KiCad, `main.scad` geht vor, Web danach, kein Verweis, kein Ordner),
KiCad aus der Umgebung, das Startskript mit Attrappe (Einstellungen für 6 bis 9, alte Sperrdatei weg, Neustart nach einer Änderung
erst nach drei Sekunden hart, weil die Attrappe das Ende überhört, Ende mit dem Editor), Bildstrom (nichts weiter eingebunden, keine
GPU, ohne KiCad `code-bild-kein-programm`); dazu der Echttest mit KiCad 7.0.11: eine grüne Fläche im Schaltplan kommt im Bild an, der
Test ändert die Datei wie der Agent, das Bild wird rot (Antwort nach 0,6–0,9 s, drei Läufe ohne Fehler). Gegenprobe ohne Neustart:
rot – das Bild bleibt grün. `docker-vibecoden.test.ts` +1: KiCad nur mit beiden Schaltern, aus den Backports, die Quelle danach weg,
Compose und CI. Im Terminal der Sandbox geprüft: `kicad-cli sch export svg` und `netlist` gehen ohne Bildschirm; `sch erc` kennt
KiCad 7 noch nicht.

## Schritt VKk5 – Der Motor kennt das Bild: `SOUL.md` im Home von Hermes

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk), nach VKk4b. Bis hierher erfuhr der Agent nicht, welche Datei das Bild startet – er
nannte ein Modell vielleicht `zahnrad.scad`, und das Bild fand nichts; nur die App nannte Nutzern `.freedom/start`.

- **`packages/node/src/bildstrom.ts`:** `bildHinweise()` – welche Datei das Bild startet, in der Reihenfolge von `bildBefehl()` und
  nur mit den Programmen, die der Knoten hat; dazu, was im Terminal geht (STL aus OpenSCAD, Exporte aus `kicad-cli`). Englisch wie
  die Anweisungen in `repo-lauf.ts`.
- **`packages/node/src/hermes-motor.ts`:** `hermesSeele()` (die Rolle vorn – Hermes nimmt `SOUL.md` als Identität statt der
  eigenen) und `hermesMotor({ bild })`: schreibt `.hermes/SOUL.md` vor jedem Start ins Home des Projekts, ohne Bild löscht er sie.
- **`packages/node/src/main.ts`:** baut die Hinweise mit dem Bildstrom aus denselben Programmen und gibt sie dem Motor.
- Nachgesehen im Quelltext von Hermes 0.19 (das gepinnte Rad, SHA-256 geprüft, nur gelesen): `load_soul_md()` liest
  `~/.hermes/SOUL.md`, die ACP-Sitzung überspringt Kontextdateien nicht; der Text trifft keines der 28 Muster der Prüfung auf
  Prompt-Injection (Bereich „context“).
- Fallstrick im Knoten, `docs/PROVIDER.md`, Entwurf, OFFEN, FORTSCHRITT, Stand-Zeile.

**Tests:** node +2 – `bildstrom.test.ts`: nur die Programme des Knotens; alle Dateien genannt und in der Reihenfolge, in der
`bildBefehl()` sie wählt (je Stufe ein Projekt mit allen Dateien ab dort); keine Bilder aus dem Terminal. `hermes-motor.test.ts`:
`SOUL.md` mit Rolle und Hinweisen im Home (0600), nie durch einen Verweis, nie im Projekt; ohne Bild gelöscht. Gegenproben:
`main.exe` hinter Web genannt – rot; ohne Löschen – rot.

## Schritt VKk4c – Blender im Bild: `main.blend`, neu gestartet nach jeder Änderung

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: Blender), nach VKk5.

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt `main.blend` (nur eine echte Datei), wenn der Knoten Blender hat –
  nach `main.kicad_sch`, vor Web. `blenderAusUmgebung()`: nur das Paket der Distribution unter `/usr` (`BLENDER_ORTE`),
  `BLENDER=aus` schaltet ab. `BLENDER_START` speichert erst ohne Bildschirm die Einstellungen ins Home der Sandbox, ohne
  Begrüßung, dann startet es Blender nach jeder Änderung neu. Die Schleife dafür teilen Blender und KiCad jetzt
  (`neustartSchleife()`); KiCads Verhalten bleibt (seine Tests unverändert grün). `bildHinweise()` nennt `main.blend` und den Bau
  im Terminal (`blender -b --python …`, gespeichert mit `save_as_mainfile()`).
- **`packages/node/src/main.ts`:** gibt Blender an den Bildstrom und an die Hinweise; das Log sagt „Szenen in Blender“ oder
  „ohne Blender“.
- **Bild:** `ARG BLENDER=0`, nur mit `VIBECODEN=1` und `BLENDER=1` (`docker-compose.vibecoden.yml` reicht es durch): Blender aus
  Debian, rund 400 MB. **CI:** `blender` (4.0.2 aus Ubuntu 24.04) im Testjob, der Echttest läuft dort.
- Fallstrick im Knoten, `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf (Zeile und Tabelle), OFFEN,
  FORTSCHRITT, Stand-Zeile.

**Tests:** node +6 – `bildstrom.test.ts` +5: Erkennung (nur mit Blender, `main.kicad_sch` geht vor, Web danach, kein Verweis,
kein Ordner), Blender aus der Umgebung, Start mit Attrappe (erst die Einstellungen mit `-b` und ohne Begrüßung, dann Blender, neu
nach einer Änderung, die Einstellungen nur einmal, Ende mit dem Programm), Bildstrom (nichts weiter eingebunden, keine GPU, ohne
Blender `code-bild-kein-programm`); dazu der Echttest mit Blender 4.0.2: der Test baut die Szene wie der Agent mit
`blender -b --python`, eine grüne Fläche kommt im Bild an, nach dem Neubau ist sie rot (Antwort nach 0,6–0,7 s, drei Läufe ohne
Fehler); im Projekt liegen danach nur `main.blend` und Blenders Sicherung `main.blend1`. Gegenproben: ohne die Einstellungen rot
(der Dialog deckt die Szene zu), ohne Neustart rot (das Bild bleibt grün). Der VKk5-Test prüft `main.blend` an seiner Stelle in den
Hinweisen. `docker-vibecoden.test.ts` +1: Blender nur mit beiden Schaltern, Compose und CI.


## Schritt VKk4d – LibreOffice im Bild: Dokumente, neu gestartet nach jeder Änderung

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: LibreOffice), nach VKk4c.

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt ein Dokument, wenn der Knoten LibreOffice hat – nach `main.blend`,
  vor Web, die erste echte Datei aus `LIBREOFFICE_DATEIEN` (OpenDocument `main.odt`/`.ods`/`.odp`/`.odg`, dasselbe als flaches XML
  `main.fodt` …, dann `main.docx`/`.xlsx`/`.pptx`). `libreofficeAusUmgebung()`: nur `/usr/bin/soffice`, `LIBREOFFICE=aus` schaltet
  ab. `LIBREOFFICE_START` schreibt die Einstellungen ins Home der Sandbox – ohne Tipp des Tages, `UseLocking` aus (sonst läge
  `.~lock.main.odt#` im Projekt; `UseDocumentOOoLockFile` allein reichte nicht) –, zeichnet über X11 und startet mit `--norestore`
  nach jeder Änderung neu (`neustartSchleife()`, jetzt mit Argumenten vor der Datei). `bildHinweise()` nennt die Dateien und die
  Umwandlung im Terminal.
- **Umweg zum Bildschirm (`X11_UMWEG`):** In der CI blieb das Bild schwarz, LibreOffice meldete „Can't open display“ – ohne
  Sandbox ging es nach 2 s, KiCad und Blender gingen in derselben Sandbox. Die Diagnose fand es: Ubuntu bringt für LibreOffice
  AppArmor-Profile mit (`complain`), `soffice.bin` trägt in der Sandbox das von `oosplash`, und unter einem Profil scheitert das
  Verbinden mit dem Socket von Xvfb („disconnected path“, `EACCES`, auch in `complain`) – der Socket entstand in einem anderen
  Mount-Namensraum. Das träfe jeden Ubuntu-Rechner mit LibreOffice. `LIBREOFFICE_START` startet deshalb vorher einen Umweg in
  Python (ohne Profil): Er lauscht auf der abstrakten Adresse `@/tmp/.X11-unix/X<n>` in der Sandbox (libxcb versucht sie zuerst,
  sie hat keinen Pfad) und reicht an den Socket weiter. Hier im Container gibt es kein AppArmor; gezeigt: Mit nur dem Umweg und
  ohne Socket unter `/tmp/.X11-unix` zeigt LibreOffice das Dokument, ohne Umweg bleibt es schwarz.
- **`packages/node/src/sandbox.ts`:** nur lesbar dazu `/etc/fonts` und `/etc/libreoffice`. Unter Debian und Ubuntu ist
  `/usr/lib/libreoffice/share/registry` ein Verweis nach `/etc/libreoffice` – ohne startet LibreOffice in der Sandbox nicht. Ohne
  `/etc/fonts` findet Fontconfig keine Konfiguration, Programme zeichnen mit Ersatzschrift (gilt für alle Programme im Bild).
- **`packages/node/src/main.ts`:** gibt LibreOffice an den Bildstrom und an die Hinweise; das Log sagt „Dokumente in LibreOffice“
  oder „ohne LibreOffice“.
- **Bild:** `ARG LIBREOFFICE=0`, nur mit `VIBECODEN=1` und `LIBREOFFICE=1`: Writer, Calc, Impress und Draw aus Debian, rund 400 MB.
  **CI:** dieselben vier Pakete (24.2 aus Ubuntu 24.04) im Testjob. Dazu schreiben die Node-Tests einen zweiten Bericht (spec)
  in eine Datei; bei Rot nennt ein Schritt danach die roten Tests am Ende des Logs – das Log hat über 27 000 Zeilen, und die
  Werkzeuge der Agenten lesen nur die letzten 5000 (so blieb der erste rote Lauf dieses Schritts unlesbar). Bei Fehlern startet
  danach `test/fixtures/libreoffice/diagnose.mts` (Fenster, Farbe, AppArmor-Profile, Meldungen des Kernels zu AppArmor).
- Fallstrick im Knoten (dazu die Sandbox), `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf, OFFEN (die
  Proben am GX10 nennen jetzt alle Programme im Bild), FORTSCHRITT, Stand-Zeile.

**Tests:** node +8 – `bildstrom.test.ts` +7: der Umweg mit echtem Xvfb in der Sandbox (über die abstrakte Adresse nimmt der
Bildschirm die Begrüßung an, ohne Umweg gibt es die Adresse dort nicht, `ECONNREFUSED`), Erkennung (nur mit LibreOffice, die Reihenfolge aller elf Namen, `main.blend` geht vor,
Web danach, ein Verweis oder Ordner zählt nicht – dann die nächste echte Datei), LibreOffice aus der Umgebung, Start mit Attrappe
(X11, `--norestore`, beide Einstellungen, neu nach einer Änderung, Ende mit dem Programm), Bildstrom (nichts weiter eingebunden,
ohne LibreOffice `code-bild-kein-programm`), der Echttest mit LibreOffice 24.2: `main.fodt` mit grüner Seite kommt im Bild an,
nach dem Neuschreiben rot (Antwort nach 0,7–3,3 s, drei Läufe ohne Fehler), im Projekt liegt währenddessen und danach nur
`main.fodt`; dazu die Umwandlung im Terminal in der Sandbox (PDF, ODT, DOCX, ohne Fehler von Fontconfig). Gegenproben: ohne
`UseLocking` rot (Sperrdatei im Projekt), ohne Neustart rot (das Bild bleibt grün), ohne `/etc/libreoffice` rot (Bild schwarz,
Umwandlung scheitert), ohne `/etc/fonts` rot (Fontconfig). `docker-vibecoden.test.ts` +1: nur mit beiden Schaltern, Compose, die
CI mit denselben Paketen (Gegenproben: ein Paket weniger in der CI, LibreOffice im Grundbild – beide rot). `sandbox.test.ts`: die
zwei Ordner in der Liste aus `/etc`. Der VKk5-Test prüft `main.odt` an seiner Stelle und alle elf Namen in den Hinweisen.

## Schritt VKk4e – Inkscape im Bild: `main.svg`, neu gestartet nach jeder Änderung

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: Inkscape), nach VKk4d.

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt `main.svg` (nur eine echte Datei), wenn der Knoten Inkscape hat –
  als Letztes, **nach** Web: Ein Logo `main.svg` in einem Web-Projekt soll die Seite nicht verdrängen; ohne Browser zählt die
  Zeichnung. `inkscapeAusUmgebung()`: nur `/usr/bin/inkscape`, `INKSCAPE=aus` schaltet ab. `INKSCAPE_START` ist die Neustart-Schleife
  allein – mit einer Datei startet Inkscape ohne Begrüßung und legt nichts neben sie; ein AppArmor-Profil bringt Ubuntu für Inkscape
  nicht mit. `bildHinweise()` nennt `main.svg` nach den Web-Projekten und den Export im Terminal (`inkscape --export-type=pdf`).
- **`packages/node/src/main.ts`:** gibt Inkscape an den Bildstrom und an die Hinweise; das Log sagt „Zeichnungen in Inkscape“ oder
  „ohne Inkscape“.
- **Bild:** `ARG INKSCAPE=0`, nur mit `VIBECODEN=1` und `INKSCAPE=1`: Inkscape aus Debian, rund 200 MB (hier, wo GTK schon lag, 116 MB).
  **CI:** `inkscape` (1.2.2 aus Ubuntu 24.04) im Testjob.
- Fallstrick im Knoten, `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`), Entwurf (Zeile und Tabelle), OFFEN (Probe
  am GX10), FORTSCHRITT, Stand-Zeile.

**Tests:** node +7 – `bildstrom.test.ts` +6: Erkennung (nur mit Inkscape, Dev-Server und `index.html` gehen vor, ohne Browser zählt
die Zeichnung, kein Verweis, kein Ordner), Inkscape aus der Umgebung, Start mit Attrappe (die Datei, neu nach einer Änderung, Ende
mit dem Programm), Bildstrom (nichts weiter eingebunden, ohne Inkscape `code-bild-kein-programm`), der Echttest mit Inkscape 1.2.2
(grüne Fläche im Bild, nach dem Neuschreiben rot, Antwort nach 1,1 s; im Projekt nur `main.svg`) und der Export als PDF im Terminal
in der Sandbox. Gegenproben: ohne Neustart rot (das Bild bleibt grün), `main.svg` vor Web rot (Erkennung und Reihenfolge der
Hinweise). Der VKk5-Test prüft `main.svg` an seiner Stelle. `docker-vibecoden.test.ts` +1: nur mit beiden Schaltern, Compose, CI
(Gegenprobe ohne die Prüfung in der CI: rot).
