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

**Dazu (B-38c3, Befund im Smoke-Test):** Der Teil „als_text_lokal“ war in der CI zweimal rot (auf 4ee7c50d und 671d5a81,
`wait_for_function` nach 30 s; `main` grün, lokal grün, auch mit sechsfach gedrosselter CPU). Ursache in der App: Die offene
Unterhaltung zeichnet sich neu, sobald die eigenen Kopien hinaus sind (`loadChatMessages()` nach beiden Kopien) – mit ihr jeden
Abspieler. Kam „Als Text“ kurz davor, landete der Text in einem Element, das niemand mehr sah; ebenso bei jeder neuen Nachricht
in der offenen Unterhaltung. Jetzt merkt `TonTexte` (`app/src/ton-texte.ts`, nur im Speicher, höchstens 50) je Ton den Versuch, und
`mitAlsText(…, kennung)` (`shell/sprache-text-ui.ts`) zeigt ihn im neuen Abspieler weiter – fertig oder noch unterwegs; die Kennung
ist die `data:`-Adresse bzw. die Blob-Id (`shell/tabs/chat-anhaenge.ts`). **Tests:** app +1 (`sprache-lokal.test.ts`: je Ton, ein
neuer Klick ersetzt, begrenzt, nur im Speicher); der Smoke-Teil zeichnet die Unterhaltung nach dem Text neu (Klick auf die offene)
und erwartet denselben Text in einem neuen Element. Fallstrick in `packages/app/CLAUDE.md`.

**Dazu (CI, B-42):** Der Testjob auf 5ff15fd5 scheiterte vor den Tests mit Exit 100 im Schritt für Jupyter: Das Bild des Runners
(20261018) nennt `python3-tornado 6.4.0-1ubuntu0.5`, der Spiegel hat nur noch die neuere Fassung (404). Der Testjob lädt die
Paketliste jetzt vor dem ersten `apt-get install` neu (Schritt „Paketliste auffrischen“), die Pakete kommen weiter aus dem
Zwischenspeicher. Der Job für Hangover fiel schon bisher auf `apt-get update` zurück. Fallstrick in `scripts/CLAUDE.md`.

## Schritt VKk4f – GIMP im Bild: `main.xcf`, neu gestartet nach jeder Änderung

Spur B, `docs/VIBECODEN-ENTWURF.md` (VKk, Tabelle „MCP für gängige Programme“: GIMP), nach VKk4e.

- **`packages/node/src/bildstrom.ts`:** `bildBefehl()` erkennt `main.xcf` (nur eine echte Datei), wenn der Knoten GIMP hat – als Letztes,
  nach Web und `main.svg` (die Quelle eines Logos verdrängt keine Seite); XCF ist GIMPs eigenes Format, Strg+S im Bild speichert ohne
  Rückfrage dorthin. `gimpAusUmgebung()`: nur `/usr/bin/gimp`, `GIMP=aus` schaltet ab. `GIMP_START` schreibt die Vorlage
  `/etc/gimp/2.0/sessionrc` mit Ort 0,0 und der Größe des Bilds ins Home der Sandbox – ohne Fenstermanager läge das Fenster sonst bei
  200,100 mit 1024×768, über den Rand; Werkzeugkasten und Docks bleiben. Danach die Neustart-Schleife. `bildHinweise()` nennt
  `main.xcf` nach `main.svg` und den Befehl für Script-Fu im Terminal (ein anderes Bild mit `gimp-file-load` laden, mit `gimp-xcf-save`
  als `main.xcf` schreiben).
- **`packages/node/src/sandbox.ts`:** zusätzlich nur lesbar `/etc/gimp` – ohne scheitert schon der erste Start („User installation
  failed“), im Bild wie im Terminal.
- **`packages/node/src/main.ts`:** gibt GIMP an den Bildstrom und an die Hinweise; das Log sagt „Bilder in GIMP“ oder „ohne GIMP“.
- **Bild:** `ARG GIMP=0`, nur mit `VIBECODEN=1` und `GIMP=1`: GIMP 2.10 aus Debian, rund 250 MB (hier 210 MB, GTK 3 lag schon).
  **CI:** `gimp` (2.10.36 aus Ubuntu 24.04) im Testjob.
- Fallstrick im Knoten (dazu `/etc/gimp` im Eintrag zur Sandbox), `docs/PROVIDER.md`, `docs/PROTOCOL.md` (`code-bild-kein-programm`),
  Entwurf (Zeile und Tabelle), OFFEN (Probe am GX10, Zeile VKk), FORTSCHRITT, Stand-Zeile.

**Tests:** node +7 – `bildstrom.test.ts` +6: Erkennung (nur mit GIMP, `index.html` und `main.svg` gehen vor, ohne Browser zählt das Bild,
kein Verweis, kein Ordner), GIMP aus der Umgebung, Start mit Attrappe (`sessionrc` aus der Vorlage mit Ort 0,0 und der Größe des Bilds,
Werkzeugkasten und Docks bleiben; ohne Splash, neu nach einer Änderung, Ende mit dem Programm), Bildstrom (nichts weiter eingebunden,
ohne GIMP `code-bild-kein-programm`), der Echttest mit GIMP 2.10.36 (der Test wandelt wie der Agent ein Bild mit genau dem Befehl aus
den Hinweisen in `main.xcf`: grün im Bild, nach dem zweiten Umwandeln rot, Antwort nach 0,8 s; im Projekt nur `main.xcf`) und Script-Fu
im Terminal in der Sandbox. Gegenproben: ohne die Lage des Fensters rot (nur Grau an der Stelle des Bilds), ohne `/etc/gimp` rot (im Bild
wie im Terminal), ohne die Prüfung in der CI rot. Der VKk5-Test prüft `main.xcf` an seiner Stelle, `sandbox.test.ts` kennt `/etc/gimp`.
`docker-vibecoden.test.ts` +1: nur mit beiden Schaltern, Compose, CI.

## Schritt VKh-Entwurf – Android-Apps bauen und im Bild zeigen

Spur B, `docs/VIBECODEN-ENTWURF.md` (Zeile VKh, VK-W8 A: nach Web und Linux kommt Android). Nur Doku – gebaut wird nach Freigabe:
Jeder Weg bringt neue Abhängigkeiten, einer bräuchte Rechte, die keine Sandbox des Knotens hat, und der Bau der Apps einen neuen Weg
nach draußen.

**Neu:** `docs/ANDROID-ENTWURF.md`.
- **Ausgangslage:** Bildstrom mit zwei Sandboxen ohne Rechte, Spiegel der Brücke nur für npm und PyPI, GX10 ARM64 (KVM und `binder`
  ungeprüft), Werkbank (VKj) als Weg für x86-Programme.
- **Befunde:**
  - redroid braucht einen privilegierten Container und `binder_linux`.
  - Waydroid braucht dasselbe und dazu Wayland.
  - Cuttlefish ist eine VM über KVM, Hosts x86 und arm64, Bild über WebRTC oder VNC.
  - Den offiziellen Emulator gibt es für Linux ARM64 nur als Bau aus den Quellen (2020).
  - `aapt2` liefert Google nur für x86-64; ab AGP 9 holt Gradle es aus Maven.
  - Gradle braucht Maven – ein neuer Weg im Spiegel.
  - Das APK liefert die Vorschau (VKg1) heute schon aus.
- **Vorschlag:** erst bauen und das APK auf dem eigenen Handy installieren, dann Cuttlefish im Bild (nur mit KVM), redroid nicht.
- **Fragen:** VKh-W1–W4 mit Empfehlung (C dann A, A, A, A).
- **Aufteilung:** VKh1–VKh5.
- **Proben am GX10** (`/dev/kvm`, `binder`).

Dazu OFFEN 1.6, Zeile VKh und Probe „Android“ in 2.3, Zeile VKh im Entwurf, FORTSCHRITT, Stand.

**Tests:** keine (nur Doku); alle Prüfungen gelaufen.

**Dazu (CI, B-42):** Der Testjob riss auf `main` (ac293899) und auf 0ebf2a9b seine Grenze von 25 Minuten, kurz vor dem Ende der
App-Tests. Ursache: Mit der frischen Paketliste (VKk4e) lädt apt jede neuere Fassung neu (Wine 223 s, LibreOffice 171 s, Blender
151 s statt je rund 20 s), und `actions/cache` speichert nur am Ende eines erfolgreichen Jobs – ein abgebrochener Lauf ließ den
nächsten wieder leer beginnen. Jetzt holt der Testjob den Zwischenspeicher nur (`actions/cache/restore`) und speichert ihn gleich
nach den Paketen (`actions/cache/save`, nur ohne genauen Treffer); die Grenze ist 35 Minuten. Fallstrick in `scripts/CLAUDE.md`.


## Schritt VKh1 – Maven über den Spiegel der Brücke

Spur B, `docs/ANDROID-ENTWURF.md`. Der MENSCH hat am 04.11. VKh-W1–W4 wie empfohlen entschieden: W1 C, danach A; W2 A; W3 A;
W4 A. Eingetragen im Entwurf (Abschnitt „Entscheidungen“) und in OFFEN (1.6 entfällt). Maven kommt zuerst, denn ohne Maven
lädt Gradle nicht einmal das Android-Plugin. Neue Teile: VKh2 JDK, Gradle und SDK im Bild, VKh3 `aapt2` für ARM64, VKh4
Cuttlefish nach der Probe am GX10; das Blob-Netz erst bei Bedarf.

- **`paket-spiegel.ts`:**
  - Neue Wege `/maven/google/…` (dl.google.com/dl/android/maven2) und `/maven/central/…` (repo.maven.apache.org/maven2).
  - Nur Archive, POMs, `.module`, `maven-metadata.xml` und ihre Prüfsummen und Signaturen (`MAVEN_DATEI`). Teile ohne `%`,
    `@` und `~`, mindestens drei Teile. Nichts wird umgeschrieben.
  - Je Datei bis 128 MB (`SPIEGEL_GRENZEN.bytesJe.maven`; `kotlin-compiler-embeddable` hat 58 MB); npm und PyPI wie bisher 50 MB.
  - Archive aller drei Registries gehen als Strom weiter (`leiteWeiter()`), mit Gegendruck der Sandbox, nie ganz im Speicher.
    Die Länge nur ohne `content-encoding`. Über der Grenze bricht die Verbindung ab.
- **`pakete.ts`:** `maven` in `PAKET_QUELLEN` (nur für den Spiegel; `PaketRegistry` bleibt npm und PyPI für Repo-Aufträge).
  `antwortOderFehlt()` liefert die ungelesene Antwort; `holeOderFehlt()` liest daraus wie bisher.
- **`hermes-motor.ts`:** Init-Skript für Gradle in `~/.gradle/init.d/freedom-spiegel.gradle`, vor jedem Lauf neu, nie durch einen
  Verweis.
  - Es lenkt `google()`, `mavenCentral()`, `gradlePluginPortal()` und dieselben Adressen von Hand auf den Spiegel.
  - Es setzt Google Maven und Maven Central vor die Plugin-Repositories – ohne eigene Liste fragte Gradle das Portal selbst.
  - `SOUL.md` nennt Gradle neben npm und pip.
- **`sandbox.ts`:** liest `/etc/java-17|21|25-openjdk` (`--ro-bind-try`). Das JDK von Debian und Ubuntu verweist für
  `java.security` dorthin; ohne bricht jede JVM ab, auch Gradle und auch im Terminal.
- **`modell-bruecke.ts`:** reicht `/maven/` an den Spiegel.
- Docs: PROVIDER (Gradle, wer was sieht), Fallstrick in `packages/node/CLAUDE.md` (dazu Java im Eintrag zur Sandbox), Entwurf,
  VIBECODEN-Entwurf, OFFEN, FORTSCHRITT, Stand.

**Tests** (`paket-spiegel.test.ts` +6, `sandbox.test.ts` angepasst):
- Ziele für Maven samt 19 Gegenbeispielen.
- Über die Brücke: POM unverändert, als Strom ohne Länge, gepackt ohne Länge, `HEAD`, 404, zu groß mit Länge (413) und im Strom
  (abgebrochen), 60 Stücke mit Gegendruck ohne Warnung.
- Motor: Init-Skript im Home, 0600, neu nach einer Änderung, kein Start bei einem Verweis statt `init.d`.
- Echttests mit Gradle 8.14.3 und Java 21 in der Sandbox ohne Netz:
  - Plugins nur über den Spiegel – Gradle nennt die Orte, die es fragte; das Portal zeigt auf Maven Central.
  - Gson von Maven Central gebaut und gestartet.
  - `androidx.annotation` von Google Maven – hier gesperrt, läuft in der CI. Der erste Lauf dort war rot: Gradle holte
    `annotation-jvm` über den Spiegel von Google, fand aber `kotlin-stdlib` nicht – das Testprojekt nannte nur `google()`.
    Wie ein Android-Projekt nennt es jetzt auch `mavenCentral()`.
- Gegenproben:
  - ohne `/etc/java-*` rot („Error loading java.security file“);
  - mit Init-Skript ohne Wirkung rot (Gradle fragt repo.maven.apache.org direkt);
  - ohne Grenze im Strom rot;
  - mit Zuhörern, die liegen bleiben, rot (`MaxListenersExceededWarning`).

## Schritt VKh2a – Gradle und JDK im Bild

Spur B, `docs/ANDROID-ENTWURF.md` (VKh-W1 C: erst bauen). VKh2 ist geteilt: a Gradle und JDK, b das Android-SDK samt APK.

- **`scripts/gradle-holen.sh`** (neu):
  - Holt Gradle 9.8.2, die offizielle Distribution, über https, auch nach der Weiterleitung zu GitHub.
  - Die SHA-256 steht fest im Skript. Ich habe sie aus dem geladenen Archiv gerechnet: downloads.gradle.org mit der Summe ist
    aus der Entwicklungsumgebung gesperrt. Die CI vergleicht die feste Summe bei jedem Lauf mit der von gradle.org.
  - Entpackt wird nur, was unter `gradle-9.8.2/` liegt, und erst nach der Prüfung. Debian 12 bringt nur Gradle 4.4, zu alt für
    das Android-Plugin.
- **Bild:**
  - Eigene Stufe `gradle-holen`: curl und unzip bleiben draußen. Ins Bild kommt der Ordner `/usr/local/lib/gradle` mit dem
    Verweis `/usr/local/bin/gradle`; dort sieht ihn die Sandbox ohne weiteren Ordner.
  - Das JDK 17 kommt aus Debian (`openjdk-17-jdk-headless`).
  - Beides nur mit `VIBECODEN=1` und `GRADLE=1` (`docker-compose.vibecoden.yml` reicht es durch), zusammen rund 420 MB.
  - Den Bau des Bilds macht der MENSCH: Debian ist von hier aus gesperrt. Die Stufe habe ich ohne Docker nachgestellt.
- **`hermes-motor.ts`:**
  - `gradleAusUmgebung()` sucht nur `/usr/local/bin/gradle`; `GRADLE=aus` schaltet ab.
  - Mit Gradle bekommt `SOUL.md` einen Absatz („`gradle`, nicht `./gradlew`“), auch ohne Bild.
  - Ohne Bild und ohne Gradle gibt es weiter kein `SOUL.md`.
- **`main.ts`:** gibt Gradle an den Motor und schreibt es ins Log.
- **CI:** Gradle aus dem Skript, im Zwischenspeicher. Die Echttests aus VKh1 bauen damit (`GRADLE_TEST`) statt mit dem Gradle des
  Runners.
- **Docs:** PROVIDER, Fallstrick in `packages/node/CLAUDE.md`, Entwurf (Aufteilung VKh2a/b), VIBECODEN-Entwurf, OFFEN (Zeile VKh,
  Probe „Vibecoden“), FORTSCHRITT, Stand.

**Tests:**
- `hermes-motor.test.ts` +2:
  - `SOUL.md` nur mit Gradle, mit Gradle und Bild, ohne beides.
  - Erkennung über einen Verweis; `GRADLE=aus`, Ordner und eigener Pfad zählen nicht.
- `docker-vibecoden.test.ts` +1: Skript, Stufe, JDK, Compose und CI samt Abgleich der Summe.
- Gegenproben, beide rot:
  - ohne `--proto-redir`;
  - ohne den Abgleich mit gradle.org.
- Gradle 9.8.2 läuft nur in der CI. Heruntergeladene Programme starten die Agenten hier nicht; lokal liefen die Echttests mit
  `/opt/gradle` (8.14.3).
- `SOUL.md` mit allen Hinweisen gegen die 28 Muster von Hermes 0.19: 0 Treffer (gelesen, nicht ausgeführt).

## Schritt VKh2b – Android-SDK im Bild, APKs über die Vorschau

Spur B, `docs/ANDROID-ENTWURF.md` (VKh-W1 C: erst bauen, laufen lassen auf dem eigenen Handy; VKh-W4 A: das APK über die Vorschau).

- **`scripts/android-sdk-holen.sh`** (neu):
  - Die Kommandozeilen-Werkzeuge von Google (15859902) in fester Fassung, gegen die SHA-256 von developer.android.com.
  - Danach über deren sdkmanager genau `platforms;android-36` und `build-tools;36.0.0`; deren Summen prüft sdkmanager selbst.
  - Das SDK steht unter dem Lizenzvertrag von Google: Ohne `ANDROID_SDK_LIZENZ=angenommen` bricht das Skript ab, bevor es etwas
    lädt. Den Wert setzt nie das Repo.
  - Befund beim Prüfen mit einer Attrappe: `yes | sdkmanager --licenses` endet unter `pipefail` mit 141 (SIGPIPE von `yes`) – das
    Skript bräche ab. Jetzt `{ yes || true; } |`; Gegenprobe rot.
- **Bild:**
  - Eigene Stufe `android-sdk-holen`, nur mit `VIBECODEN=1` und `ANDROID=1`; ohne `GRADLE=1` bricht sie ab.
  - curl, unzip, das JRE und sdkmanager bleiben draußen. Ins Bild kommt nur das SDK unter `/usr/lib/android-sdk`, rund 300 MB.
  - `docker-compose.vibecoden.yml` reicht `ANDROID` und `ANDROID_SDK_LIZENZ` durch (leer vorgegeben). Ein Bild mit SDK nicht
    weitergeben.
- **`hermes-motor.ts`:**
  - `androidSdkAusUmgebung()` nimmt nur `/usr/lib/android-sdk` mit Plattform und Build-Tools, nur auf x86-64 (`aapt2` aus Maven
    gibt es nur dafür – ARM64 mit VKh3); `ANDROID=aus` schaltet ab.
  - Mit Gradle und SDK bekommt `SOUL.md` den Absatz „Android apps“: `sdk.dir`, Plugin 9.5.0 (`ANDROID_PLUGIN_FASSUNG`),
    `gradle assembleDebug`, `build/` nicht in den Commit, das APK über die Vorschau aufs eigene Handy.
- **`main.ts`:** gibt das SDK an den Motor und schreibt es ins Log.
- **`vorschau.ts`:** liefert `.apk` als `application/vnd.android.package-archive` – so bietet der Browser des Handys die
  Installation an.
- **Docs:** PROVIDER, Fallstrick in `packages/node/CLAUDE.md`, Entwurf, VIBECODEN-Entwurf, OFFEN (Zeile VKh, neue Probe „APK“),
  FORTSCHRITT, Stand.

**Tests:**
- `hermes-motor.test.ts` +1: Erkennung (Plattform und Build-Tools, nur x64, Verweis, `ANDROID=aus`), Hinweis nur mit Gradle,
  nach Gradle, über den Motor in `SOUL.md`.
- `docker-vibecoden.test.ts` +1: Skript (Fassung, Summe, Lizenz vor dem ersten Abruf, https, genau zwei Pakete, `yes` ohne
  SIGPIPE-Abbruch), Stufe, Compose; die Lizenz setzen weder Bild noch Compose noch CI.
- `vorschau.test.ts`: Typ eines APK.
- `paket-spiegel.test.ts` +1, Echttest in der CI:
  - Gradle 9.8.2 baut mit dem Android-Plugin 9.5.0 in der Sandbox ohne Netz ein APK, mit dem SDK des Runners, nur lesbar.
  - Plugin und Bibliotheken kommen über den Spiegel.
  - Im APK liegen `AndroidManifest.xml` und `classes.dex`.
  - Hier überspringt er sich (kein SDK, Google gesperrt).
- Skript mit einer Attrappe für sdkmanager: ohne Annahme kein Abruf, sonst Lage unter `cmdline-tools/latest`, Lizenzen, genau
  die zwei Pakete.
- `SOUL.md` mit allen Hinweisen gegen die 28 Muster von Hermes 0.19: 0 Treffer.

## Schritt VKh3a – aapt2 aus den AOSP-Quellen

Spur B, `docs/ANDROID-ENTWURF.md` (VKh-W2 A: `aapt2` für ARM64 selbst aus den Quellen). VKh3 ist geteilt: a baut `aapt2` und
prüft es in der CI auf beiden Prozessoren, b bringt es ins Bild auf ARM64 und setzt den Umweg im Motor.

**Änderungen:**
- **`scripts/aapt2-bauen.sh`** (neu):
  - Quellen von Android 17 (`android-17.0.0_r1`, `aapt2` der Build-Tools 37.0.0), 39 Repos von android.googlesource.com;
    jedes wird nach dem Holen gegen seinen Commit im Skript geprüft (`STAENDE`), bevor etwas daraus läuft. Die Commits kamen
    aus der CI, auf beiden Prozessoren gleich geholt.
  - Rezept: Commit451/android-arm-build-tools (MIT, CMake statt Soong, für glibc und GCC 12 auf Debian 12), Commit fest.
    Seine Liste (`repos.json`) muss genau unsere sein; sein `fetch_sources.py` findet jedes Repo am Tag vor und legt nur seine
    Ergänzungen und Patches an – ein „cloned“ oder ein „!!“ in der Ausgabe bricht ab.
  - Gebaut mit dem GCC des Rechners, dynamisch nur gegen glibc, libstdc++ und zlib (`ldd`-Prüfung, ein Fehler von `ldd` bricht
    ab), danach `aapt2 version`. Lizenztexte der gelinkten Teile neben dem Programm, geprüft vor dem langen Bau.
  - Die Pakete zum Bauen stehen im Skript (`AAPT2_BAU_PAKETE`); die CI und später das Bild installieren genau diese.
- **CI** (`ci.yml`, Job „aapt2 aus den Quellen“, x86-64 und ARM64):
  - Gebaut wie im Bild in `node:22-bookworm-slim` (Debian 12, GCC 12), einmal je Fassung des Skripts, gleich danach im
    Zwischenspeicher.
  - Prüft in der Sandbox: `aapt2` übersetzt und verlinkt Ressourcen gegen `android.jar` (API 36 aus dem SDK des Runners, API 23
    aus Ubuntu, aus den Quellen gebaut). Auf x86-64 baut Gradle 9.8.2 mit dem Android-Plugin 9.5.0 ein APK über
    `android.aapt2FromMavenOverride` – nichts aus Maven.
- **Docs:** Fallstrick in `scripts/CLAUDE.md`, Entwurf (Korrektur: Debian hat `aapt2`, aber aus Android 10; Aufteilung
  VKh3a/b), VIBECODEN-Entwurf, OFFEN, FORTSCHRITT, Stand.

**Befunde:**
- Das Rezept von lzhiyong (der erste Versuch) baut nur für Android (bionic): mit glibc und dem Compiler des Rechners scheiterte
  es an Dutzenden Stellen – fehlende Includes (libc++ zieht sie mit, libstdc++ nicht), `sys/limits.h`, liblog für Geräte. Das
  Rezept von Commit451 ist dieselbe Idee, für glibc gemacht.
- android.googlesource.com ist aus der Entwicklungsumgebung gesperrt, der GitHub-Spiegel `aosp-mirror` hat nur einen Teil der
  Repos und nichts nach Android 16 – gebaut wird nur in der CI. Die Logik des Skripts lief hier gegen Attrappen (lokale Repos,
  Rezept mit kleinem CMake-Projekt); den Code des Rezepts startet die Entwicklungsumgebung nicht.
- `aapt2` aus Android 17 arbeitet mit dem Android-Plugin 9.5.0 und compileSdk 36 (APK in 50 s, Echttest in der CI).

**Tests:**
- `paket-spiegel.test.ts` +2:
  - `aapt2` in der Sandbox ohne Netz: Version, `compile`, `link` gegen jedes vorhandene `android.jar`, `dump badging` liest das
    Label; mit `AAPT2_TEST_PFLICHT=1` rot statt übersprungen.
  - APK mit dem eigenen `aapt2` (`AAPT2_APK_PFLICHT=1` auf x86-64): Gradle holt `aapt2` nicht aus Maven. Gegenprobe im Test aus
    VKh2b: ohne Umweg liegt es im Cache von Gradle.
- `docker-vibecoden.test.ts` +1: Fassung, Tag, Rezept, 39 Commits ohne Platzhalter, Reihenfolge (prüfen vor dem Rezept),
  Abbruch bei „cloned“/„!!“, `ldd` laut, Lizenztexte vor dem Bau, kein curl; CI-Job mit beiden Prozessoren, Zwischenspeicher,
  Bau in `node:22-bookworm-slim` mit den Paketen aus dem Skript, Pflicht-Variablen.
- Skript gegen Attrappen: richtig; falscher Commit; Rezept mit anderer Liste; Patch passt nicht („!!“); fremde Bibliothek
  (libcrypt); fehlende Lizenztexte (alle auf einmal); Apache-2.0 ohne eigenen Text nur mit Kennzeichen.

## Schritt VKh3b – aapt2 im Bild auf ARM64, der Motor setzt den Umweg

Spur B, `docs/ANDROID-ENTWURF.md` (VKh-W2 A), nach VKh3a. Damit baut der Agent APKs auch auf dem GX10.

**Änderungen:**
- **Bild** (`docker/node.Dockerfile`): Stufe `aapt2-bauen` in `node:22-bookworm-slim`, nur mit `VIBECODEN=1`, `ANDROID=1` und auf
  arm64. Sie installiert genau die Pakete aus `scripts/aapt2-bauen.sh` (`AAPT2_BAU_PAKETE`, wie der CI-Job) und baut; ins Bild
  kommen nur `/usr/local/bin/aapt2` und die Lizenztexte unter `/usr/local/share/doc/aapt2/`. Auf amd64 bleibt die Stufe leer – dort
  nimmt das Android-Plugin `aapt2` aus Maven.
- **`hermes-motor.ts`:**
  - `aapt2AusUmgebung()` sucht nur `/usr/local/bin/aapt2` (`AAPT2_ORTE`), `ANDROID=aus` schaltet ab.
  - `androidSdkAusUmgebung()` nimmt das SDK außer auf x86-64 jetzt mit `aapt2` aus den Quellen an.
  - Mit `aapt2` schreibt der Motor vor jedem Lauf `~/.gradle/gradle.properties` (`gradleEigenschaften()`:
    `android.aapt2FromMavenOverride`, nur ASCII) über `schreibeInsHeim()`; ohne `aapt2` löscht er die Datei – erst nach dem
    Init-Skript, das `.gradle` als echten Ordner prüft.
  - `SOUL.md` sagt dann, woher `aapt2` kommt und dass eigene Einstellungen in die `gradle.properties` des Projekts gehören.
- **`main.ts`:** gibt `aapt2` an den Motor, wenn es das SDK gibt; das Log nennt es.
- **Docs:** PROVIDER (Android auf ARM64), Fallstrick in `packages/node/CLAUDE.md`, Entwurf, VIBECODEN-Entwurf, OFFEN (Zeile VKh,
  Probe „APK“ jetzt auch am GX10), FORTSCHRITT, Stand.

**Tests:**
- `hermes-motor.test.ts` +1: Erkennung (Datei, Verweis, kein Ordner, `ANDROID=aus`), SDK auf ARM64 nur mit `aapt2`, die Datei
  für Gradle (genau der Umweg, nur ASCII), der Hinweis nur mit `aapt2`; über den Motor: Datei im Home mit 0600, `SOUL.md` mit
  dem Absatz, ein Verweis an ihrer Stelle wird ersetzt und nie verfolgt, ohne `aapt2` keine Datei. Gegenprobe: ohne das
  Löschen rot.
- `docker-vibecoden.test.ts` +1: Stufe, Bedingung (arm64), Pakete aus dem Skript, Programm und Lizenztexte, `COPY`.
- `paket-spiegel.test.ts`: der APK-Echttest mit dem eigenen `aapt2` schreibt jetzt genau die Datei des Motors ins Home von
  Gradle (`gradleEigenschaften()`), statt den Umweg ins Projekt zu legen.
- Die Shell der Stufe unter `dash` nachgestellt: auf amd64 baut sie nichts, auf arm64 installiert sie die Pakete aus dem Skript
  und baut. `docker buildx build --check`: keine Warnungen.
- `SOUL.md` mit allen Hinweisen, Gradle und Android mit `aapt2` gegen die 28 Muster von Hermes 0.19: 0 Treffer.

## Schritt VKk4g – QGIS im Bild

Spur B, VKk („weitere grafische Programme“, `docs/VIBECODEN-ENTWURF.md`), nach VKk4f. Karten sind ein neues Gebiet; das Projekt
baut der Agent als Text oder mit PyQGIS, die Ebenen liegen als Dateien daneben.

**Änderungen:**
- **`bildstrom.ts`:**
  - `qgisAusUmgebung()` sucht nur `/usr/bin/qgis` (`QGIS_ORTE`), `QGIS=aus` schaltet ab.
  - `bildBefehl()` zeigt `main.qgs`, sonst `main.qgz` (`QGIS_DATEIEN`, nur echte Dateien) – nach Web, `main.svg` und `main.xcf`:
    Das Projekt hinter einer Web-Karte verdrängt die Seite nicht.
  - `QGIS_START`: ohne Download fehlender Schriften (`fonts/downloadMissingFonts=false` im Home der Sandbox), dazu ein Skript beim
    Start (`--code`), das das Fenster auf 0,0 und genau die Größe des Bilds setzt – in Bildern unter rund 1000 Pixeln Breite ohne
    Statusleiste. Neustart nach jeder Änderung über `neustartSchleife()`.
  - `bildHinweise()` nennt `main.qgs`/`main.qgz`, die Standardansicht (ohne öffnet die Karte leer) und die Befehle im Terminal:
    PyQGIS mit dem Python der Distribution und `qgis_process`, beide mit `QT_QPA_PLATFORM=offscreen`.
- **`main.ts`:** gibt QGIS an den Bildstrom und die Hinweise, das Log nennt es.
- **Bild:** `ARG QGIS=0`, nur mit `VIBECODEN=1` und `QGIS=1`: QGIS aus Debian (3.22, GPL-2.0+), mit GDAL, PROJ und PyQGIS bis zu
  900 MB (hier, ohne die schon installierten Teile, 920 MB mit 115 Paketen); Compose reicht `QGIS` durch.
- **CI:** Schritt „QGIS fuer den Bild-Test“ im Testjob (Paket der Distribution, 3.34 in Ubuntu 24.04), über den Zwischenspeicher.
- **Docs:** PROVIDER (Karten), PROTOCOL (`code-bild-kein-programm`), Fallstrick in `packages/node/CLAUDE.md`, VIBECODEN-Entwurf
  (Tabelle, VKk), OFFEN (VKk, Probe „Vibecoden“ mit `QGIS=1` und einer Karte), FORTSCHRITT, Stand.

**Befunde:**
- QGIS liest seine Argumente selbst: `-geometry` setzt Qt zwar um, QGIS hält es aber zusätzlich für Dateien („Invalid Data
  Source“). Maximiert und Vollbild in `UI/geometry` übergeht Qt ohne Fenstermanager, eine normale Größe verkleinert es um eine
  Titelleiste (20 Pixel) und verschiebt das Fenster – darum das Skript mit `setGeometry()`. Den Ausschnitt der Karte passt QGIS
  bei der neuen Größe selbst neu ein (gemessen bei 1024 und 640 Pixeln, mit und ohne vorab geschriebene Größe gleich).
- Die Statusleiste allein braucht 1011 Pixel (Koordinate, Maßstab, Lupe, Drehung, KBS); in einem schmaleren Bild bleibt das
  Fenster so breit, und die Karte ragt über den Rand. Ohne sie sind es 446 Pixel. Die Mindestbreite gilt erst nach
  `layout().activate()` – sonst bleibt `setGeometry()` bei 1011.
- Ohne `downloadMissingFonts=false` will QGIS 3.34 beim ersten Start „Open Sans“ laden und meldet das Scheitern über der Karte.
  Der Schlüssel steht nur als UTF-16 in `libqgis_core` (`strings -el`); `download-missing` wirkt nicht.
- Ein mit PyQGIS geschriebenes Projekt ohne Standardansicht öffnet mit leerer Karte – der Befehl in den Hinweisen setzt sie.
- Beim Speichern legt QGIS `main.qgs~` (die alte Fassung) und `main_attachments.zip` (eine Stil-Datenbank) neben das Projekt;
  beim Öffnen legt es nichts an. Im Terminal brechen `qgis_process` und PyQGIS ohne Bildschirm ab, mit
  `QT_QPA_PLATFORM=offscreen` laufen sie. Ubuntu bringt für QGIS kein AppArmor-Profil mit (anders als für LibreOffice).

**Tests:**
- `bildstrom.test.ts` +6:
  - Karten: `main.qgs` vor `main.qgz`, nur mit QGIS, auch ohne Browser; `index.html` und `main.xcf` gehen vor; Verweis und Ordner
    zählen nicht.
  - Erkennung: nur die Orte unter `/usr`, `QGIS=aus`, kein eigener Pfad, ein Ordner ist kein QGIS.
  - Start mit Attrappe: Argumente (`--nologo --code … main.qgs`), `QGIS3.ini` genau ohne Download, das Skript Zeile für Zeile;
    Neustart nach der Änderung.
  - Bildstrom: in der Sandbox des Programms, nur der Socket des Bildschirms; ohne QGIS kein Programm.
  - Ende zu Ende (QGIS 3.34, bubblewrap, Xvfb, coturn): erst grün, der Test baut die Karte mit dem Befehl aus den Hinweisen rot
    neu, das Bild wird rot; im Projekt nur, was QGIS beim Speichern selbst anlegt. Gegenprobe: ohne das Skript beim Start misst
    der Test bei 640 Pixeln nur Weiß.
  - Terminal: beide Befehle aus den Hinweisen in der Sandbox – Projekt mit relativem Pfad und Standardansicht, ein Puffer
    mit `qgis_process`.
- `bildstrom.test.ts` (VKk5): Reihenfolge der Hinweise und von `bildBefehl()` mit `main.qgs` am Ende.
- `docker-vibecoden.test.ts` +1: `ARG QGIS`, nur mit `QGIS=1`, Compose, nicht im Standard, die CI installiert es.
- `SOUL.md` mit allen Hinweisen gegen die 28 Muster von Hermes 0.19: 0 Treffer.

## Schritt VKk4h – Videos im Bild: Shotcut und melt

Spur B, VKk („weitere grafische Programme“, MENSCH 06.11.: „Shotcut und melt nehmen, danach MuseScore“), nach VKk4g. Videos sind ein
neues Gebiet: Der Agent schreibt das Projekt als MLT-XML (das Format von Shotcut), die Clips liegen als Dateien daneben.

**Änderungen:**
- **`bildstrom.ts`:**
  - `meltAusUmgebung()` und `shotcutAusUmgebung()` suchen nur `/usr/bin/melt` und `/usr/bin/shotcut`; `SHOTCUT=aus` schaltet beide ab.
  - `bildBefehl()` zeigt `main.mlt` (nur echte Datei, nur mit melt) nach Web, `main.svg`, `main.xcf` und `main.qgs`.
  - `videoBefehl()`: ab `SHOTCUT_MINDEST` (1024×700) Shotcut mit Player und Zeitleiste in Bildgröße (`--qwindowgeometry`), darunter melt
    mit `sdl2` in Bildgröße und `-repeat` als Schleife.
  - `SHOTCUT_START` und `MELT_START`: Ton als Attrappe (`SDL_AUDIODRIVER=dummy`), bei Shotcut ohne Aktualisierungsfrage und ohne alte
    Zwischenstände; Neustart nach jeder Änderung über `neustartSchleife()` – die nimmt seit VKk4h auch Argumente hinter der Datei.
  - `bildHinweise()` nennt `main.mlt`, das Format (Tractor mit der Kennung `shotcut`), wann Shotcut und wann melt, und das Rendern mit
    melt im Terminal.
- **`main.ts`:** gibt melt und Shotcut an den Bildstrom und die Hinweise, das Log nennt sie.
- **Bild:** `ARG SHOTCUT=0`, nur mit `VIBECODEN=1` und `SHOTCUT=1`: Shotcut und melt aus Debian (Shotcut GPL-3.0+, MLT LGPL-2.1+); hier
  150 MB (Qt 6 lag teils schon). Compose reicht `SHOTCUT` durch.
- **CI:** Schritt „Shotcut und melt fuer den Bild-Test“ im Testjob (Ubuntu 24.04: Shotcut 24.02, MLT 7.22), über den Zwischenspeicher.
  Zeitlimit des Testjobs 50 statt 35 Minuten: Ein Lauf auf einem PR liest nur den Zwischenspeicher von main und seinen eigenen – im
  ersten Lauf auf dem PR kamen Shotcut und melt in 20,5 Minuten vom Spiegel (im Lauf auf dem Branch aus dem Speicher in 11 s), der Job
  endete mitten in den Tests von mls (Knoten und App grün).
- **Docs:** PROVIDER (Videos), PROTOCOL (`code-bild-kein-programm`), Fallstrick in `packages/node/CLAUDE.md`, VIBECODEN-Entwurf (Tabelle,
  VKk), OFFEN (VKk, Probe „Vibecoden“ mit `SHOTCUT=1` und einem Video), FORTSCHRITT, Stand.

**Befunde:**
- Shotcut braucht mindestens 1000×642 Pixel (gemessen mit 24.04): `--qwindowgeometry` wirkt erst darüber (1024×768 genau), `--fullscreen`
  setzt Qt ohne Fenstermanager nicht um, kleinere Symbole sparen nur 30 Pixel, mit `--QT_SCALE_FACTOR 0.64` zeichnet es nur Bruchstücke.
  Am Handy (rund 700 Pixel breit) zeigt das Bild deshalb melt.
- Ohne Ton (SDL findet kein PulseAudio) zeigt der Player von Shotcut kein Bild; mit `SDL_AUDIODRIVER=dummy` spielt er ab. melt zeigt
  das Bild auch ohne, meldet aber Fehler von ALSA.
- Ein Projekt öffnet Shotcut nur mit der Kennung `shotcut` am Tractor in der Zeitleiste, sonst als Clip im Player. Beim Prüfen legt es
  kurz `shotcut-XXXX.mlt` neben die Datei und löscht sie wieder; beim Speichern (Strg+S per XTest) entsteht nichts daneben.
- Nach einem harten Ende fragte Shotcut beim nächsten Start nach der Wiederherstellung (`autosave` im Home) – das Skript löscht sie.
- melt wiederholt mit `eof=loop` nicht (gemessen mit zwei Farben nacheinander), mit `-repeat` hinter der Datei schon.
- Der Player zeigt Farben im eingeschränkten Bereich (aus `#00c000` wird 0,162,0) – der Echttest prüft Bereiche, nicht Werte.

**Tests:**
- `bildstrom.test.ts` +7:
  - Videos: nur mit melt, nach Web und `main.qgs`; Shotcut genau ab `SHOTCUT_MINDEST`, darunter in Breite oder Höhe melt, ohne Shotcut
    immer melt; Verweis und Ordner zählen nicht.
  - Erkennung: nur die Orte unter `/usr`, `SHOTCUT=aus` für beide, kein eigener Pfad.
  - Start mit Attrappe, je für Shotcut und melt: Argumente, Ton als Attrappe, Zwischenstände nur bei Shotcut gelöscht, Neustart.
  - Bildstrom: in der Sandbox des Programms, nur der Socket des Bildschirms; im großen Bild Shotcut, im kleinen melt; ohne melt kein Programm.
  - Ende zu Ende mit Shotcut (1024×768) und mit melt (640×480): erst grün, der Test schreibt das Video rot neu, das Bild wird rot; im
    Projekt nur `main.mlt`. Gegenprobe: Shotcut ohne `SDL_AUDIODRIVER=dummy` – nur Grau.
  - Terminal: der Befehl aus den Hinweisen rendert in der Sandbox ein MP4.
- `bildstrom.test.ts` (VKk5): Reihenfolge der Hinweise und von `bildBefehl()` mit `main.mlt` am Ende.
- `docker-vibecoden.test.ts` +1: `ARG SHOTCUT`, nur mit `SHOTCUT=1`, Compose, nicht im Standard, die CI installiert beide.
- `SOUL.md` mit allen Hinweisen gegen die 28 Muster von Hermes 0.19: 0 Treffer.

## Schritt VKk4i – Partituren im Bild: MuseScore

Spur B, VKk (MENSCH 06.11.: „Shotcut und melt nehmen, danach MuseScore und dann restlichen code“), nach VKk4h. Der Agent schreibt die
Musik als MusicXML (oder gleich als `main.mscx`), MuseScore 3 zeigt die Partitur im Bild und gibt im Terminal PDF, MIDI und WAV aus.

**Änderungen:**
- **`bildstrom.ts`:**
  - `musescoreAusUmgebung()` sucht nur `/usr/bin/mscore3`; `MUSESCORE=aus` schaltet ab.
  - `bildBefehl()` zeigt eine Partitur aus `MUSESCORE_DATEIEN` (`main.mscx` vor `main.mscz`, nur echte Datei, nur mit MuseScore) nach Web,
    `main.svg`, `main.xcf`, `main.qgs` und `main.mlt`.
  - `MUSESCORE_START` schreibt `MuseScore3.ini` ins Home der Sandbox: ohne Assistenten des ersten Starts, Startcenter, Touren und Suche nach
    Aktualisierungen; unter `MUSESCORE_INSPEKTOR_AB` (1024 Pixel) ohne Inspektor. Das Fenster in Bildgröße (`--qwindowgeometry`); Neustart
    nach jeder Änderung über `neustartSchleife()`, vorher die alte Sitzung gelöscht.
  - `bildHinweise()` nennt `main.mscx`, das Umwandeln aus MusicXML und das Ausgeben als PDF, MIDI, MusicXML und WAV im Terminal (mit
    `QT_QPA_PLATFORM=offscreen`).
- **`main.ts`:** gibt MuseScore an den Bildstrom und die Hinweise, das Log nennt es.
- **Bild:** `ARG MUSESCORE=0`, nur mit `VIBECODEN=1` und `MUSESCORE=1`: `musescore3` aus Debian (GPL-2.0, Klangbibliothek MIT), rund 100 MB.
  Compose reicht `MUSESCORE` durch.
- **CI:** Schritt „MuseScore fuer den Bild-Test“ im Testjob (Ubuntu 24.04: MuseScore 3.2.3), über den Zwischenspeicher.
- **Docs:** PROVIDER (Partituren), PROTOCOL (`code-bild-kein-programm`), Fallstrick in `packages/node/CLAUDE.md`, VIBECODEN-Entwurf
  (Tabelle, VKk), OFFEN (VKk, Probe „Vibecoden“ mit `MUSESCORE=1` und einer Partitur), FORTSCHRITT, Stand.

**Befunde:**
- Beim ersten Start zeigt MuseScore einen Assistenten (Sprache, Tastatur, Vorlieben) über der Partitur – mit `startup\firstStart=false`
  in `MuseScore3.ini` nicht.
- Ohne Fenstermanager öffnet MuseScore mindestens 1024×768; mit `--qwindowgeometry` passt es auch in 640×480. Bei 640 Pixeln ließen
  Paletten und Inspektor den Noten rund 260 Pixel – ohne Inspektor 470.
- Nach dem Ende mit SIGTERM (so beendet die Schleife) fragte MuseScore beim nächsten Start „The previous session quit unexpectedly.
  Restore session?“ – nach `kill -9` nicht, die Sitzungsdatei entsteht erst später. Das Skript löscht sie vor jedem Start.
- Speichert jemand im Bild (Strg+S per XTest), legt MuseScore 3.2 `.main.mscx,` als Sicherung daneben; eine Einstellung dafür gibt es in
  3.2 nicht.
- Im Terminal geht alles nur mit `QT_QPA_PLATFORM=offscreen` (sonst Abbruch, Exit 134): MusicXML → `main.mscx` (die Warnung „no
  instrument found for part“ ist harmlos), PDF, MIDI, MusicXML, WAV (mit der Klangbibliothek der Distribution), MP3, PNG (je Seite eine
  Datei). PNG steht nicht in den Hinweisen – der Test der Hinweise weist jedes `.png` ab.

**Tests:**
- `bildstrom.test.ts` +6:
  - Partituren: `main.mscx` vor `main.mscz`, nur mit MuseScore, nach Web und `main.mlt`; Verweis und Ordner zählen nicht.
  - Erkennung: nur `/usr/bin/mscore3`, `MUSESCORE=aus`, kein eigener Pfad.
  - Start mit Attrappe (1024 und 1023 Pixel): Argumente, die Einstellungen, ohne Inspektor nur im schmalen Bild, die alte Sitzung vor
    jedem Start gelöscht, Neustart nach der Änderung.
  - Bildstrom: in der Sandbox des Programms, nur der Socket des Bildschirms; ohne MuseScore kein Programm.
  - Ende zu Ende im schmalen Bild (640×480, bubblewrap, Xvfb, coturn): erst grün, der Test schreibt die Partitur rot neu, das Bild wird
    rot; im Projekt nur `main.mscx`. Gemessen im Rahmen des Titels dort, wo sonst der Inspektor stünde. Gegenproben von Hand: mit
    `firstStart=true` nur Grau (der Assistent), mit Inspektor nur Grau.
  - Terminal: die Befehle aus den Hinweisen wandeln MusicXML in der Sandbox in `main.mscx` (vier Noten) und geben ein PDF aus.
- `bildstrom.test.ts` (VKk5): Reihenfolge der Hinweise und von `bildBefehl()` mit `main.mscx` am Ende.
- `docker-vibecoden.test.ts` +1: `ARG MUSESCORE`, nur mit `MUSESCORE=1`, Compose, nicht im Standard, die CI installiert es.

## Schritt RM2d – KI-Guthaben: Cashu-Topf auf der Wallet-Seite

Spur C (`docs/RM2-ENTWURF.md` V9), gebaut von Spur B nach MENSCH 06.11. („danach MuseScore und dann restlichen code“).
Seit RM2c3 gibt es keine Sitzung auf Kredit mehr; Kopf und Seitenleiste zeigten „—“, und für den Cashu-Topf gab es keine
Oberfläche – niemand konnte eine Mint wählen oder laden, der Pfand blieb ungenutzt.

**Änderungen:**
- **`app/src/ki-guthaben.ts`** (neu, ohne DOM): `guthabenStand()` (Mint, Host, frei, im Pfand, offene Ladungen, Gebühr je
  Token), `ladeGuthaben()` (Rechnung der Mint, über die Schienen zahlen, abholen – ohne Antwort der Mint bleibt die Ladung
  offen, nie ein zweites Mal gezahlt), `holeOffene()`, `CASHU_TEXT` und `cashuFehlerText()` (je Kennung ein Satz).
- **`app/src/shell/ki-guthaben-ui.ts`** (neu): Karte „KI-Guthaben“ auf der Wallet-Seite (statt „KI-Budget“) mit „Mint wählen“,
  „Guthaben laden“ und „Offene Ladung abholen“; vorher der Tresor, vor dem Zahlen eine Rückfrage mit Mint und Gebühr.
- **Kopf und Seitenleiste:** `ui.ts` zeigt das Guthaben über `setzeKiGuthabenAnzeige()` (ohne Mint „— sats“ – im Kopf ein Knopf,
  mobil mindestens 40 px); der Titel bleibt übersetzt, „verwahrt von <Mint>“ steht auf der Karte.
- **`app/src/cashu-topf.ts`** (Spur A, klein): `CASHU_FAELLE` als Liste, `offeneLadungen()`, `gebuehrPpk()`.
- **Zweck „cashu“** im Protokoll (`payment-rail.ts`), im Zahlungsbuch und im Verlauf („KI-Guthaben geladen“).
- **Smoke-Test:** die Wallet-Seite erwartet die Karte „KI-Guthaben“ (ohne Mint „—“, Laden gesperrt).
- **Docs:** Fallstrick in `packages/app/CLAUDE.md`, RM2-Entwurf (RM2 fertig), OFFEN (RM2d raus, Probe „Geld“ mit KI-Guthaben),
  FORTSCHRITT, Stand.

**Befunde:**
- Die Karte behauptet nicht selbst, was die Mint sieht – das sagt die Grenze „cashu-pfand“ im Bericht, die Karte verweist darauf.
- Die Test-Mint läuft hier nicht (Python-Pakete von außen); der Test gegen sie läuft in der CI.
- Im ersten Smoke-Lauf rot: „mobil“ (im Kopf „—“ allein war am Handy 20 px breit) und „sprache“ (der Titel des Kopfs muss
  übersetzt bleiben); `geld-settings-klein.test.ts` und `wallet-gesamt.test.ts` hielten die Karte „KI-Budget“ fest und prüfen
  jetzt die Karte „KI-Guthaben“.

**Tests:**
- `ki-guthaben.test.ts` +5: Stand ohne und mit Mint; Laden in der richtigen Reihenfolge (Rechnung, zahlen, abholen), offen
  ohne Antwort, nie zweimal gezahlt, nie gezahlt bei falscher Rechnung; offene Ladungen abholen; je Kennung ein Text in beiden
  Sprachen; gegen die Test-Mint (`CASHU_TEST_MINT`): laden über `ladeGuthaben()`, offene Ladung beim Zahlen, Gebühr wie `/v1/keysets`.

## Schritt 11.5c4 – Pakete für Agenten im privaten Raum: Schalter eines Moderators, nur die Sperrdatei

Spur A (`docs/REPO-AGENTEN-ENTWURF.md` P3), gebaut von Spur B nach MENSCH 06.11. („dann restlichen code“). Bis hier holte der
Knoten für Repo-Aufträge aus privaten Räumen nie Pakete – auch nicht, wenn der Raum es wollte; ein Agent konnte dort ohne
`npm ci` oder `pip install` kaum testen.

**Änderungen:**
- **Format** (`protocol/src/repo-auftrag.ts`, `docs/PROTOCOL.md` §33): `["repo_pakete", "sperrdatei"]` in der geltenden
  Definition des privaten Raums (die neueste eines Admins, derselbe Ort wie `agentenketten`), `mitRepoPaketen()` und
  `leseRepoPakete()` – genau ein Tag mit genau diesem Wert, sonst aus; Vorgabe aus. Offen gilt das Tag nicht.
- **Knoten** (`knoten-agent.ts`, `repo-lauf.ts`): `pruefePrivat()` liest den Schalter, `bearbeiteRepoAuftrag()` holt dann die
  Pakete der Sperrdatei (`nurSperre`) – ohne `hole` gibt es kein `paket_holen`, die Zeile geht als Befehl in die Sandbox, und
  die Aufgabe sagt „No other packages can be added“.
- **App:** Menüpunkt „Pakete für Agenten holen …“ (`shell/raum-pakete-ui.ts`) nur im privaten Raum, nur für Moderatoren, nie als
  Gerät; der Dialog nennt, was die Registry sieht. Wer die Definition neu schreibt (Kanäle, Raumstand, Kasse, Agentenketten),
  nimmt beide Schalter mit (`mitSchaltern()` in `raum-ketten.ts`).
- **Datenschutz:** Die Grenze „agent-knoten-privat“ nennt es: nur mit Schalter, nur die Sperrdatei; die Registry sieht
  Paketnamen und die IP des Knotens (über Tor nicht die IP), nie Code.
- **Docs:** PROTOCOL §33, Entwurf (11.5c fertig), Fallstrick in `packages/node/CLAUDE.md`, OFFEN (11.5c4 raus, Probe „Repo-Agent“ neu), FORTSCHRITT, Stand.

**Befunde:**
- `setzePrivateKetten()` schrieb die Definition frisch mit nur den Ketten – ein zweiter Schalter wäre beim Umschalten der Ketten
  still weg gewesen. Seit 11.5c4 laufen alle Stellen über `mitSchaltern()`; ein Test hält fest, dass `mitKetten(` in
  `raum-mls.ts` nicht mehr vorkommt.

**Tests:**
- protocol +1 (`repo-auftrag.test.ts`: Vorgabe aus, an nur mit genau einem Tag und Wert, aus entfernt nur den Schalter).
- node +2: `repo-auftrag-privat.test.ts` (mit bubblewrap, echte MDK-Engine: Schalter an → die Registry wird nur nach dem
  Paket der Sperrdatei gefragt, `/pakete` eingebunden, `paket_holen` endet mit 127 in der Sandbox, die Antwort trägt
  `pakete`; Gegenprobe ohne die neue Bedingung rot), `repo-pakete.test.ts` (mit bubblewrap: `nurSperre` holt die Sperrdatei,
  nie das Paket aus `paket_holen`); dazu im Ablauf-Test ohne `hole` kein `paket_holen`.
- app +1 (`raum-ketten.test.ts`: `mitSchaltern()` überträgt beide, `neu` ändert genau einen); Verdrahtung in `raum-ketten.test.ts`
  und `raum-kasse.test.ts` (fünf Stellen über `definitionMitKetten()`).

## Schritt A-28b – Swap SOL → Lightning: Rückgabe vor Ablauf im LP und in der App

Spur A (`docs/BOLTZ-VERGLEICH.md` B2, Entscheidung 11.10. „A-28 ja mit 0.G“), gebaut von Spur B nach MENSCH 06.11. („dann
restlichen code“). Scheiterte die Zahlung des LP, wartete der Kunde bis T_sol auf seine SOL – oft Stunden. Das Programm kennt
`zurueckgeben` seit A-28a; jetzt ruft der LP es, und die App sagt es.

**Änderungen:**
- **LP** (`node/src/lp-daemon.ts`): `gibZurueck()` nach `zahleUndLoeseEin()` und in `nachholen()` – nur, wenn LND die
  Zahlung sicher als gescheitert meldet (`sicherGescheitert` aus `zahlungsstand()`), nie ohne Auskunft, bei „läuft“ oder
  „unbekannt“; nur vor T_sol, einmal je Sitzung (`zurueckgegeben` im Speicher). Die Antwort bleibt `GESCHEITERT`, dazu
  `["zurueckgegeben", "1"]` und der Text „Zahlung gescheitert – SOL zurückgegeben“. Lehnt das Programm ab (vor dem Upgrade an
  `FVb19s…`), bleibt alles wie bisher; ins Log nur der Fehlername.
- **App:** `leseRueckAntwort()` liest das Tag (nur neben `GESCHEITERT`, nur „1“); `rueckText(…, geschlossen)` sagt „schon
  zurückgegeben“ nur, wenn die Kette die Sperre nicht mehr offen zeigt; `schliesseWennZu()` (`refund-watcher.ts`) schließt die
  gemerkte Sperre dann gleich ab, ohne Transaktion – sonst stünde sie bis T_sol in der Liste.
- **Format:** Der Status bleibt `GESCHEITERT` (ältere Apps lesen ihn weiter und holen nach T_sol zurück – der Wächter findet
  die Sperre geschlossen und schließt ohne Transaktion ab), das Tag ist neu (`docs/SWAPS.md`).
- **Docs:** SWAPS (Antwort, Rückgabe), Upgrade-Liste, Fallstrick „Swaps“ in der Wurzel, OFFEN (A-28b raus), FORTSCHRITT, Stand.

**Befunde:**
- Ohne `zahlungsstand` setzte der LP schon immer `GESCHEITERT` („ohne Auskunft: gescheitert“) – das ist kein sicheres
  Scheitern; dort gibt er nie zurück. Darum die eigene Marke `sicherGescheitert` statt der Phase allein.

**Tests:**
- node +4 (`lp-rueck.test.ts`): sicher gescheitert → genau eine Rückgabe an den Initiator, Kunde sofort wieder voll, Antwort mit
  Tag, nach einem Neustart nichts doppelt; ohne Auskunft, „läuft“, „unbekannt“ nie; Programm lehnt ab → Antwort wie bisher, SOL
  bleiben gesperrt, ins Log nur der Fehlername; nach einem Neustart sicher gescheitert → zurückgegeben. Gegenprobe ohne
  `sicherGescheitert`: rot.
- app +2 (`refund-watcher.test.ts`: abgeschlossen nur, wenn die Kette sie nicht offen zeigt; `rueck-swap.test.ts`: verdrahtet),
  dazu Antwort und Text in den bestehenden Tests.

## Schritt VKk4j – Gemälde im Bild: main.kra und OpenRaster in Krita

Spur B (`docs/VIBECODEN-ENTWURF.md` VKk, Tabelle „MCP für gängige Programme“), nach MENSCH 06.11. („dann restlichen code“) –
weitere grafische Programme waren unter OFFEN frei, Krita stand dort als Erstes.

**Änderungen:**
- **`node/src/bildstrom.ts`:** `KRITA_ORTE`, `kritaAusUmgebung()`, `KRITA_DATEIEN` (`main.kra` vor `main.ora`), `KRITA_START` und
  `kritaBefehl()` – `kritarc` ohne automatisches Sichern und ohne Sicherungsdatei ins Home der Sandbox, das Fenster in Bildgröße über
  `--qwindowgeometry`, Neustart nach jeder Änderung über `neustartSchleife()`; in `bildBefehl()` nach der Partitur, in `bildHinweise()`
  an derselben Stelle (OpenRaster für den Agenten beschrieben, kein Befehl im Terminal), `BildStrom` mit `krita`.
- **`node/src/main.ts`:** `kritaAusUmgebung(process.env)` für Bild und Hinweise, im Log „Gemälde in Krita“.
- **Docker:** `ARG KRITA=0`, `krita` nur mit `VIBECODEN=1` und `KRITA=1`; `docker-compose.vibecoden.yml` reicht es durch.
- **CI:** Schritt „Krita fuer den Bild-Test“ (`xvfb-run -a krita --version` – Krita braucht auch dafür einen Bildschirm).
- **Docs:** PROVIDER, PROTOCOL (`code-bild-kein-programm`), VIBECODEN-ENTWURF (Krita in der Tabelle, VKk4j fertig), OFFEN (VKk, Probe
  „Vibecoden“ mit `KRITA=1`), FORTSCHRITT, Fallstrick in `packages/node/CLAUDE.md`, Stand.

**Befunde:**
- Krita legt nach einer Änderung im Bild `main.kra-autosave.kra` neben die Datei (mit `AutoSaveInterval=10` nach 30 s gemessen) und beim
  Speichern `main.kra~` – mit `AutoSaveInterval=0` und `CreateBackupFile=false` nichts (Strich per XTest, Strg+S; Gegenprobe ohne).
- Krita nimmt `QT_QPA_PLATFORM=offscreen` nicht – auch `--export` und `--version` brechen ohne Bildschirm ab. Darum verspricht der
  Hinweis keinen Befehl im Terminal; der Agent schreibt OpenRaster selbst. Krita öffnet es auch ohne `mergedimage.png` und Vorschau.
- Im Bild von 640×480 bekommt die Leinwand knapp die Hälfte der Breite (Farbwähler und Ebenen rechts) – die Docker auszublenden hieße
  auch die Werkzeuge auszublenden, darum bleibt es so.

**Tests:**
- node +7: `bildstrom.test.ts` +6 – Reihenfolge und Dateien, Umgebung, Start mit Attrappe (`kritarc`, Größe, Neustart), Bildstrom
  (nichts weiter eingebunden), Ende zu Ende mit echtem Krita in der Sandbox: ein ORA, wie der Agent es nach den Hinweisen schreibt, im
  kleinen Bild (grün, neu geschrieben rot, sonst nichts im Projekt) und `main.kra` im großen Bild; `docker-vibecoden.test.ts` +1.
  Dazu im Test der Hinweise (VKk5) `main.kra` in der Reihenfolge.

## Schritt VKk4k – CAD-Zeichnungen im Bild: main.dxf in LibreCAD

Spur B (`docs/VIBECODEN-ENTWURF.md` VKk, Tabelle „MCP für gängige Programme“), nach MENSCH 06.11. („dann restlichen code“) –
weitere grafische Programme waren unter OFFEN frei. FreeCAD fehlt in Ubuntu 24.04 (die CI könnte es nicht prüfen); LibreCAD deckt
2D-CAD ab, und DXF kann der Agent als Text schreiben.

**Änderungen:**
- **`node/src/bildstrom.ts`:** `LIBRECAD_ORTE`, `librecadAusUmgebung()`, `LIBRECAD_DOCKS_AB`, `LIBRECAD_START` und `librecadBefehl()` –
  `LibreCAD.conf` ins Home der Sandbox (ohne Dialog des ersten Starts, ohne automatisches Sichern und Sicherungsdatei, Zeichnung beim
  Öffnen eingepasst,
  unter 1024×768 ohne die Docks rechts), das Fenster in Bildgröße über `--qwindowgeometry`, Neustart nach jeder Änderung über
  `neustartSchleife()`; in `bildBefehl()` nach dem Gemälde, in `bildHinweise()` an derselben Stelle (DXF als Text, PDF im Terminal),
  `BildStrom` mit `librecad`.
- **`node/src/main.ts`:** `librecadAusUmgebung(process.env)` für Bild und Hinweise, im Log „CAD-Zeichnungen in LibreCAD“.
- **Docker:** `ARG LIBRECAD=0`, `librecad` nur mit `VIBECODEN=1` und `LIBRECAD=1`; `docker-compose.vibecoden.yml` reicht es durch.
- **CI:** Schritt „LibreCAD fuer den Bild-Test“ (`QT_QPA_PLATFORM=offscreen librecad dxf2pdf --version`).
- **Docs:** PROVIDER, PROTOCOL (`code-bild-kein-programm`), VIBECODEN-ENTWURF (LibreCAD in der Tabelle, VKk4k fertig), OFFEN (VKk,
  Probe „Vibecoden“ mit `LIBRECAD=1`), FORTSCHRITT, Fallstrick in `packages/node/CLAUDE.md`, Stand.

**Befunde:**
- Im frischen Home zeigt LibreCAD erst einen Dialog (Einheit, Sprache) – mit `[Startup] FirstLoad=0` nicht.
- Nach einer Änderung im Bild legt LibreCAD `#main.dxf` neben die Datei (mit `AutoSaveTime=1` nach einer Minute gemessen) – mit
  `[Defaults] AutoBackupDocument=0` nichts (Gegenprobe gleichzeitig, gleich lang). Beim Speichern legt es `main.dxf~` daneben, auch
  mit dieser Einstellung: `RS_Graphic::save()` (Quelltext 2.2.0.2) liest `AutoBackupDocument` ohne Gruppe – mit `[General]
  AutoBackupDocument=0` dazu nichts (Strich per XTest, Strg+S; Gegenprobe ohne die Zeile: `main.dxf~`).
- Ohne `AutoZoomDrawing=1` zeigt LibreCAD eine Zeichnung in fester Größe – eine Fläche von 400 mm ragte im großen wie im kleinen Bild
  über den Rand; mit ihr passt sie samt Linie, Kreis, Bogen und Text.
- Mit den Docks rechts ist das Fenster mindestens 525×717 Pixel groß und ragte im Bild von 640×480 unten hinaus; `RightDockArea=0`
  blendet sie aus (`MainWindowX::toggleRightDockArea()`), dann passt es ab 300×270.
- Im Terminal geht `librecad dxf2pdf` mit `QT_QPA_PLATFORM=offscreen` ohne Bildschirm; `dxf2png` gibt es in 2.2 nicht.

**Tests:**
- node +8: `bildstrom.test.ts` +7 – Reihenfolge, Dateien und Docks nach Größe, Umgebung, Start mit Attrappe (`LibreCAD.conf` im
  großen und kleinen Bild, Größe, Neustart), Bildstrom (nichts weiter eingebunden), Ende zu Ende mit echtem LibreCAD in der Sandbox:
  eine Zeichnung, wie der Agent sie nach den Hinweisen schreibt, im kleinen Bild (grün, neu geschrieben rot, sonst nichts im Projekt)
  und im großen Bild mit Docks (blau); im Terminal der Befehl aus den Hinweisen in der Sandbox (PDF, sonst nichts);
  `docker-vibecoden.test.ts` +1. Dazu im Test der Hinweise (VKk5) `main.dxf` in der Reihenfolge.
