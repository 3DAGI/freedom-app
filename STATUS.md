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

