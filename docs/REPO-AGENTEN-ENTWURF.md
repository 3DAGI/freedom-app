# Agenten an Raum-Repos – Entwurf (Schritt 11.5)

Stand 10.10.2026, Spur A (mit Spur B). **Freigegeben am 11.10.2026 (MENSCH)** – mit einer
Änderung bei W3: Der Agent soll Code ausführen können. Wie (Harness, Sandbox) ist noch in
Besprechung, ebenso die neue Frage W6 (Netz in der Sandbox). Abschnitt „Entscheidungen vom
11.10.2026“ am Ende; er gilt vor den Vorschlägen darüber.
Karte `docs/ausbau/phase-11.md`, Zeile 11.5:

> Agenten arbeiten an Raum-Repos – mit Git-Werkzeugen in der Sandbox (8.7)
> holen, ändern, als Patch in den Raum stellen; angenommen wird nur durch ein
> Mitglied mit Recht, nie von selbst.

Grundlage sind Agenten in Räumen (`docs/AGENTEN-RAUM-ENTWURF.md`, freigegeben
08.10.) und Repos in Räumen (11.4). Freizugeben sind die Vorschläge V1–V9 und
die Antworten auf die Fragen W1–W5 am Ende. „Wie vorgeschlagen“ genügt; jede
Frage lässt sich einzeln anders entscheiden.

## Was es heute gibt

| Baustein | Stand | Wo |
|---|---|---|
| Agent auf dem Knoten | beantwortet Erwähnungen in offenen und privaten Räumen, „wer fragt, zahlt“ (11.3d1–d2) | `node/src/knoten-agent.ts` |
| Agent auf dem Gerät | beantwortet Erwähnungen, der Ersteller zahlt (11.3c) | `app/src/shell/agenten-lauschen.ts` |
| Repos in Räumen | offen: Ankündigung mit Raum, Pfleger mit `repos_pflegen`; privat: alles innere Events der Gruppe (11.4) | `protocol/src/raum-repo.ts` |
| Code eines Repos | Git-Bundle, verschlüsselt im Blob-Netz; der Verweis (38042) trägt den Schlüssel – offen öffentlich, privat nur in der Gruppe | `protocol/src/git.ts`, `app/src/shell/tabs/repos.ts` |
| Bundle lesen | eigener Leser ohne Abhängigkeit und ohne DOM: Commits, Bäume, Dateien, Deltas, Suche; alles begrenzt (`BUNDLE_GRENZEN`), jedes Objekt nachgerechnet | `app/src/git-bundle.ts` |
| Patches | NIP-34 Kind 1617, höchstens 60 KB (`PATCH_MAX_BYTES`), Text aus `git format-patch`; angenommen zählt nur von Eigentümer oder Maintainer (`patchStatus()`) | `protocol/src/nip34.ts` |
| Werkzeuge im Knoten | Grenzen je Aufruf (`WERKZEUG_GRENZEN`), Netz nur über den SSRF-Wächter, Dateien nur im Workspace (8.7) | `node/src/tools.ts` |

### Befunde

1. **Agenten-Aufträge laufen heute ohne Werkzeuge.** Ein Auftrag mit Verweis
   und Werkzeugen wird abgelehnt (`agent-nur-text`, `dvm-provider.ts:1204`).
2. **Der Knoten führt Werkzeuge im Auftrag heute gar nicht aus.** `main.ts:375`
   übergibt keine `ToolRegistry`, die Tags `tool` einer Anfrage bleiben ohne
   Wirkung.
   - `file_io` hätte einen Ordner für alle Aufträge (`/tmp/freedom-workspace`,
     `tools.ts:285`). Was ein Auftrag schreibt, läge für den nächsten bereit
     und bliebe auf der Platte.
   - Für 11.5 taugt das nicht. Vor einer Verdrahtung müsste `file_io` je
     Auftrag trennen (neuer Punkt A-29 in der Sammlung).
3. **Im Bild des Knotens fehlt git.** `docker/node.Dockerfile` baut auf
   `node:22-slim`, und dort ist git nicht dabei.
4. **Der Kopf des Bundles steht nicht im Verweis.** Die App schreibt beim
   Hochladen `headSha: "local"` (`repos.ts:321`). Den Stand liest nur das
   Bundle selbst (`kopfCommit()`).
5. **Der Leser der App passt auch in den Knoten.** Er braucht nur
   `DecompressionStream` und `crypto.subtle`, beides hat Node 22. Er prüft
   fremde Bundles schon heute streng.
6. **Agentenketten auf dem Knoten erst mit Budget.** Ein Agent auf dem Knoten
   antwortet einem Agenten nur aus einem Budget (`entscheide()` mit
   `ausBudget: false`). Das Budget des Einladers (11.3d3) kommt erst nach dem
   Devnet-Upgrade (M-2). Bis dahin stimmen sich Agenten am Repo nicht über
   Ketten ab.

## Begriffe

- **Repo-Auftrag:** eine Erwähnung des Agenten, die auf ein Repo des Raums
  zeigt (V1). Er endet mit einem Patch oder mit einer Antwort, warum keiner
  entstand.
- **Arbeitskopie:** der Stand des Repos am Kopf des Bundles, im Speicher des
  Knotens, nur für diesen einen Auftrag (V3).
- **Pfleger:** wer im Raum `repos_pflegen` hat. Im privaten Raum haben Admins
  das Recht immer.

## V1 – Repo-Auftrag: Erwähnung mit Verweis aufs Repo

- **Form:** eine gewöhnliche Raum-Nachricht, die den Agenten erwähnt (wie
  11.3). Dazu kommt ein Tag `["a", "30617:<eigentümer>:<kennung>", "", "repo"]`.
  - Offen steht es an Kind 42, privat am inneren Event Kind 9.
  - Optional zeigt `["e", <issue>, "", "issue"]` auf ein Issue des Repos.
    Dann liest der Agent dessen Text und Kommentare mit.
- **Die App setzt das Tag**, wenn man von der Repo-Seite aus „Agent
  beauftragen“ wählt, oder wenn man im Raum schreibt und der Raum genau ein
  Repo hat.
- **Zum Raum gehören muss das Repo:**
  - offen bestätigt über `mitRaumRechten()` (`raumBestaetigt`);
  - privat über `raumReposPrivat()`, also angekündigt von einem Pfleger.
  - Ein fremdes Repo lehnt der Agent ab (`agent-repo-fremd`).
- **Die Auslöser-Regeln aus 11.3 bleiben:**
  - Schreibrecht des Fragenden;
  - Bremse je Absender;
  - jede Erwähnung höchstens einmal;
  - nie auf Agenten ohne Budget.

## V2 – Zuerst nur der Agent auf dem Knoten

- Den Agenten auf dem Gerät bedient zuerst nur Text (wie heute).
  - Der Baustein aus V3–V5 läuft ohne Node und ohne Platte. Er taugt später
    auch für die App, als eigener Schritt.
- Bezahlt wird beim Knoten wie heute: „wer fragt, zahlt“. Das Budget des
  Einladers folgt mit 11.3d3.

## V3 – Code holen: nur das Bundle aus dem Raum

- **Quelle ist nur der neueste Bundle-Verweis (38042) eines Pflegers dieses
  Repos:**
  - offen von Eigentümer oder Pfleger, signiert;
  - privat als inneres Event (`raumReposPrivat()`).
- **Nie über Klon-Adressen** (https, ssh, `rad:`). git würde dort am
  SSR-Wächter und an Tor vorbei ins Netz gehen.
- **Laden wie beim Halten (B-9b1):**
  - Manifest und Stücke nur vom Autor des Manifests, jedes Stück gegen seinen
    Hash;
  - dann mit dem Schlüssel aus dem Verweis entschlüsseln;
  - dann `leseBundle()` mit `BUNDLE_GRENZEN` (32 MB, 10 000 Objekte).
- **Kopf nur aus dem Bundle:** `kopfCommit()`, nie `head` aus dem Verweis
  (Befund 4).
- **Arbeitskopie nur im Speicher:**
  - der Baum am Kopf als Pfad → Inhalt, nur gelesen, was das Modell braucht;
  - nie in eine Datei, nie ins Log;
  - nach dem Auftrag weg, auch wenn er scheitert.
  - Das folgt der Regel „Kein Klartext im Knoten“. Ein privater Raum bleibt
    damit so privat wie sein Chat beim Knoten-Agenten.

## V4 – Werkzeuge für das Modell: nur die Arbeitskopie

Das Modell arbeitet über Werkzeuge an der Arbeitskopie. Es bekommt keine
Shell, kein Netz und kein Geld. Je Repo-Auftrag gibt es nur diese:

| Werkzeug | Tut | Grenze |
|---|---|---|
| `repo_liste(pfad)` | Einträge eines Ordners | höchstens 500 Einträge |
| `repo_lesen(pfad, ab, bis)` | Zeilen einer Textdatei | Ausgabe wie `WERKZEUG_GRENZEN.ausgabeZeichen` (4000) |
| `repo_suchen(text)` | Fundstellen im Code (`sucheImCode()`) | `SUCHE_GRENZEN` |
| `repo_schreiben(pfad, inhalt)` | Datei ersetzen oder neu anlegen | 64 KB je Datei (`dateiBytes`) |
| `repo_loeschen(pfad)` | Datei entfernen | – |
| `fertig(betreff, beschreibung)` | Arbeit beenden – der Knoten baut den Patch | Betreff 200, Beschreibung 2000 Zeichen |

- **Pfade wie git sie zulässt:**
  - relativ, ohne `..`, ohne `.git` in jedem Teil, ohne Steuerzeichen.
- **Sonderfälle im Baum:**
  - Symlinks (Modus 120000) liest das Modell als Text des Links. Der Knoten
    folgt ihnen nie, und sie werden nie geschrieben.
  - Submodule (160000) bleiben unberührt.
  - Ausführbare Dateien behalten ihren Modus. Neue Dateien bekommen 100644.
- **Grenzen je Auftrag:**
  - höchstens 30 Werkzeug-Aufrufe und 10 Minuten;
  - Änderungen zusammen höchstens so groß, dass der Patch unter
    `PATCH_MAX_BYTES` (60 KB) bleibt;
  - die Obergrenze des Preises (W5).
  - Ist eine Grenze erreicht, endet der Auftrag ohne Patch, und der Agent
    sagt im Raum, welche.
- **Code wird nie ausgeführt.** Keine Tests, kein Build, kein Skript aus dem
  Repo (W3).
- **Fremder Text steuert das Modell.** Dateien und Issues können Anweisungen
  enthalten (Prompt Injection). Das Modell kann damit nur die Arbeitskopie
  dieses Auftrags ändern. Heraus kommt nur ein Patch, und den nimmt nur ein
  Mensch an (V6).

## V5 – Patch bauen und einreichen

- **Der Knoten baut den Patch, nicht das Modell.** Er schreibt einen Text
  in der Form von `git format-patch`, eine Änderung auf dem Kopf des Bundles:
  - `From <commit>`; der Commit wird aus Baum, Eltern, Autor und Text
    berechnet, wie git es tut;
  - `From:` ist der Agent (W4), `Date:` die Zeit des Auftrags, `Subject:` aus
    `fertig()`;
  - Unified Diff mit drei Zeilen Kontext, `index`-Zeilen mit den Hashes der
    Dateien.
- **Prüfen vor dem Senden:**
  - `lesePatchText()` muss ihn annehmen;
  - im Test zusätzlich `git apply --check` und `git am` gegen echte Repos.
    Byte-Vektoren wie bei QR und Meshtastic erzeugt dann ein Skript.
- **Einreichen:**
  - offen `bauePatch()`, signiert vom Agenten (Kind 1617);
  - privat `raumRepoPatch()` als inneres Event über `KnotenMls.sende()`, nie
    offen.
- **Antwort im Raum:** eine Antwort auf die Erwähnung (wie 11.3), die den
  Patch nennt (`["e", <patch>, "", "mention"]`). Im privaten Raum ist das die
  Id des inneren Events.
- **Keine Änderung, Grenze erreicht oder Patch zu groß:** Es gibt nur die
  Antwort im Raum, mit Grund, und keinen Patch.

## V6 – Annehmen nur durch Menschen mit Recht, nie von selbst

- **Agenten nehmen nie an:**
  - `patchStatus()` zählt „angenommen“ (1631) nicht von einem Schlüssel, der
    im Raum eine Agent-Karte hat;
  - das gilt auch, wenn er `repos_pflegen` hätte oder im privaten Raum Admin
    wäre (neuer Parameter `istAgent`, wie bei `entscheide()`).
  - `raumReposPrivat()` zählt Agenten nicht als Pfleger. Ein Agent kündigt
    also auch keine Repos an und lädt keine Bundles hoch.
- **Der Agent setzt keinen Status,** auch nicht an seinen eigenen Patches.
  Zurückziehen und als Entwurf markieren bleiben bei Menschen mit Recht.
- **Der Knoten spielt nichts ein.** Das Modul baut nie einen Bundle-Verweis
  (38042) und nie einen Status. Ein Test prüft den Quelltext darauf.
- **Die App zeigt Patches von Agenten mit Kennzeichen,** wie Agenten im Raum
  (11.3e). Annehmen bleibt `darfAnnehmen()` für Menschen.

## V7 – Agenten stimmen sich ab (F5), sobald es Budgets gibt

- Ein Agent kann einen anderen im Raum erwähnen, etwa „@Prüfer, schau dir
  meinen Patch an“. Das unterliegt den Regeln der Agentenketten (Schalter,
  Grenze, gezählt aus dem Raum).
- **Auf dem Knoten erst mit 11.3d3** (Befund 6): Ohne Budget des Einladers
  antwortet ein Knoten-Agent keinem Agenten.
- **Reviews durch Agenten:** Zeilenkommentare und Bewertungen (C-20g1) sind
  ein eigener späterer Schritt. Eine Bewertung ändert ohnehin nie den Status.

## V8 – Datenschutz

- **Belegt (mit Szenario):** Im privaten Raum gehen Repo-Auftrag, Patch und
  Antwort nur als innere Events hinaus. Das deckt die Leak-Regel
  `raum-repo-privat`, mit den Ids der inneren Events.
- **Grenze „agent-knoten-privat“ erweitern:** Ein Agent auf dem Knoten liest
  im privaten Raum auch die Repos. Den Code hält er nur für den Auftrag im
  Speicher.
- **Offene Räume:** Der Patch eines Agenten ist öffentlich und signiert, wie
  jeder Patch. Der Auftrag an den Knoten bleibt versiegelt.
- Neue Aussagen nur mit Szenario in `privacy-facts.test.ts`.

## V9 – Aufteilung des Baus

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| 11.5a1 | Bundle-Leser von `app/src/git-bundle.ts` ins Protokoll (die App nimmt ihn von dort, ohne Änderung im Verhalten); Arbeitskopie im Speicher mit den Pfad-Regeln aus V4 | B | ~250 |
| 11.5a2 | Patch-Schreiber: Diff (Myers, drei Zeilen Kontext), Objekt-Hashes, Text wie `git format-patch`; Tests gegen git (`apply --check`, `am`) und Byte-Vektoren | B | ~350 |
| 11.5b | Protokoll: Repo-Tag in der Erwähnung, Prüfung „Repo gehört zum Raum“, `patchStatus()` ohne Agenten, Werkzeug-Beschreibungen aus V4, `docs/PROTOCOL.md` 33 | A | ~250 |
| 11.5c | Knoten: Bundle holen (V3), Werkzeug-Schleife nur für Repo-Aufträge, Grenzen, Patch einreichen, Antwort im Raum, Leak-Szenario | A | ~400, ggf. zwei Teile |
| 11.5d | App: „Agent beauftragen“ auf der Repo-Seite und im Raum (Tag, Preis vorher), Kennzeichen an Patches von Agenten | A (Oberfläche mit C) | ~250 |
| später | Agent auf dem Gerät mit demselben Baustein; Reviews durch Agenten; Ketten nach 11.3d3 | A | – |

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| W1 | Womit arbeitet der Knoten am Code? | A git als Programm im Knoten: ein eigener Prozess je Auftrag mit fester Umgebung (keine Konfiguration, keine Hooks, keine Submodule, keine Symlinks), Arbeitsordner auf der Platte, git ins Docker-Bild (neue Abhängigkeit des Bildes) · B eigener Leser und Schreiber in TypeScript (V3–V5), nur im Speicher | **B** – keine neue Abhängigkeit, kein fremdes Programm auf fremden Daten, nichts auf der Platte, später auch in der App nutzbar. Kostet rund 350 Zeilen für Diff und Patch |
| W2 | Wer darf einen Agenten am Repo beauftragen? | A jedes Mitglied mit Schreibrecht im Raum, es zahlt selbst · B nur Pfleger (`repos_pflegen`) | **A** – Patches darf ohnehin jedes Mitglied einreichen; annehmen nur Pfleger. In offenen Räumen (B-22) heißt das: jeder, der beitritt – er zahlt selbst |
| W3 | Darf der Agent Code ausführen (Tests, Build)? | A nein, in 11.5 nur lesen und schreiben · B ja, in einem Container je Auftrag (eigener Schritt mit dem Installer, eigene Entscheidung) | **A** – fremder Code braucht echte Isolation des Betriebssystems; die gehört zum Installer (8.2) |
| W4 | Wer steht im Commit als Autor? | A der Agent: `<Name aus der Karte> <agent-<16 Zeichen des Schlüssels>@agent.invalid>` (`.invalid` ist reserviert, RFC 2606) · B der Fragende als Autor, der Agent als Committer | **A** – die Adresse ist ehrlich keine; der Name des Fragenden käme sonst in die Geschichte des Repos, ohne dass er es signiert hat |
| W5 | Wie wird ein Repo-Auftrag bezahlt? | A wie heute das Gebot: der Fragende bestätigt vorher eine Obergrenze, der Knoten rechnet nach Tokens bis höchstens dahin und hört dort auf · B fester Preis je Repo-Auftrag im Angebot des Knotens | **A** – Repo-Aufträge brauchen mehrere Runden; eine Obergrenze schützt den Fragenden, ohne einen Preis zu erfinden |

## Neuer Punkt für die Sammlung

- **A-29:** `file_io` je Auftrag trennen (Befund 2), bevor es verdrahtet wird.
  Heute ist es nicht verdrahtet und wirkt also nicht. **Erledigt 10.10.** – je
  Auftrag ein eigener Ordner, nach den Werkzeugen gelöscht.

## Entscheidungen vom 11.10.2026 (MENSCH)

Dieser Abschnitt gilt vor den Vorschlägen oben.

| Nr. | Entscheidung |
|---|---|
| V1–V9 | wie vorgeschlagen – außer dem, was W3 ändert: Arbeitskopie (V3), Werkzeuge (V4), Aufteilung (V9); dafür gilt der Vorschlag unten, sobald er besprochen ist |
| W1 | **B** – eigener Leser und Schreiber, kein git im Knoten; wo die Arbeitskopie liegt, hängt an W3 |
| W2 | **A** – jedes Mitglied mit Schreibrecht, es zahlt selbst |
| W3 | **Der Agent führt Code aus** – Wunsch MENSCH: „Agent muss coden können, damit Vibecoding möglich ist.“ Mit welchem Harness und in welcher Sandbox: **in Besprechung** (Vorschlag Spur A unten) |
| W4 | **A** – der Agent als Autor, Adresse unter `.invalid` |
| W5 | **A** – Obergrenze vorher bestätigen |

### Vorschlag zu W3: Harness (in Besprechung)

Verglichen am 11.10.2026 nach den Angaben der Projekte selbst:

| | Atomic Agent (B-30) | Hermes Agent (Nous Research) | mini-swe-agent (SWE-bench-Team) |
|---|---|---|---|
| Sprache, Lizenz | TypeScript, MIT | Python und Node, MIT | Python, MIT |
| Umfang | „Developer preview“, „APIs, commands, config, and behavior are still moving“ | großes Produkt (rund 51 000 Commits), eigene Gateways, keine Bibliotheks-Schnittstelle | Kern rund 100 Zeilen: ein Werkzeug (bash), lineare Historie |
| Ausführen | Shell mit Freigabe durch einen Menschen; keine Sandbox des Betriebssystems, Befehle erben die Umgebung samt `.env` | sieben Ausführungsorte (lokal, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox) | jeder Befehl ein eigener Prozess (`subprocess.run`), Umgebungen lokal, Docker/Podman, Singularity/Apptainer, bubblewrap |
| Gedächtnis | dauerhaft in `~/.atomic-agent` | dauerhaft in `~/.hermes`, lernt aus Verläufen | keines |

- **Vorschlag: mini-swe-agent als Vorlage, nachgebaut in TypeScript im Knoten.**
  - Der Kern ist klein genug, um ihn ganz zu verstehen und stabil zu übernehmen. Es entsteht
    keine Abhängigkeit, die sich unter uns ändert.
  - Weil jeder Befehl ein eigener Prozess ist, läuft jeder einzeln in der Sandbox. Eine
    Shell, die zwischen Befehlen weiterlebt, gibt es nicht.
  - Ohne Gedächtnis passt er zur Regel für Aufträge Fremder (AG1: flüchtig, Arbeitsordner je
    Auftrag, danach gelöscht).
  - Übernommene Texte (Anweisungen an das Modell) tragen den MIT-Hinweis des Projekts.
- **Atomic Agent** bleibt für die eigenen Wege (B-30, AG1 A: Dieses Gerät, Mein Knoten). Für
  Fremde taugt er nicht: Seine Freigaben setzen einen Menschen an der Tastatur voraus, und
  er hat keine Sandbox des Betriebssystems.
- **Hermes Agent** ist ein ganzes Produkt mit eigenem dauerhaftem Gedächtnis und ohne
  Bibliotheks-Schnittstelle. Ihn einzubinden hieße, ein zweites Agenten-System neben dem
  Knoten zu betreiben – nicht stabil zu übernehmen.

### Vorschlag zu W3: Regeln fürs Ausführen

- **Nur in bubblewrap.** Jeder Befehl läuft in `bwrap` mit eigenen Namensräumen (Nutzer,
  Prozesse, Netz, IPC, Hostname), `--die-with-parent`, `--new-session`.
  - Schreibbar ist nur der Arbeitsordner des Auftrags. System-Verzeichnisse sind nur lesbar,
    das Home des Knotens und `~/.freedom` (Schlüssel, Kopplung, Kasse) sind nicht sichtbar.
  - Die Umgebung ist leer bis auf `PATH` und `HOME`; keine Variable des Knotens kommt hinein.
  - Dieselbe Sandbox nutzt B-31 (MCP, MC1: ausführende Werkzeuge nur in bubblewrap) – ein
    Baustein für beide.
- **Ohne Sandbox kein Ausführen.** Fehlt `bwrap` oder sind Nutzer-Namensräume gesperrt
  (Docker-Seccomp, AppArmor ab Ubuntu 24.04), sagt die Selbstprüfung das. Der Agent
  arbeitet dann wie in V4 – nur lesen und schreiben. Nie direkt auf dem Rechner.
- **Arbeitsordner im Arbeitsspeicher.** Je Auftrag ein Ordner auf einem tmpfs (0700), darin
  der Stand am Kopf des Bundles. Nach dem Auftrag wird er gelöscht, auch wenn er scheitert.
  So bleibt „Kein Klartext im Knoten“: nichts auf der Platte.
- **Grenzen (Vorgabe, der Betreiber kann sie senken):** 60 s je Befehl, 30 min und
  50 Schritte je Auftrag, 512 MB im Arbeitsordner, Speicher und Prozesse je Befehl begrenzt.
  Die Ausgabe je Befehl geht gekürzt an das Modell zurück.
- **Netz:** im ersten Bau keines (eigener Netz-Namensraum ohne Verbindung) – siehe W6.
- **Werkzeuge in der Sandbox:** was das Bild des Knotens mitbringt (Node.js, npm ohne Netz,
  die Shell). git braucht es nicht, den Patch baut der Knoten (V5).
- **Fremder Text steuert jetzt echten Code.** Die Grenze ist die Sandbox: Darin liegen keine
  Geheimnisse des Knotens, hinaus geht nur der Patch, und den nimmt nur ein Mensch an (V6).
- **Kosten:** Gerechnet wird nach Tokens bis zur Obergrenze (W5). Die Rechenzeit der Sandbox
  trägt der Betreiber; ein eigener Preis dafür ist ein späterer Schritt.

### Vorschlag zu W3: Aufteilung (ersetzt V9, sobald W3 geklärt ist)

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| 11.5s | Sandbox-Baustein (`bwrap`, Grenzen, leere Umgebung, tmpfs-Ordner) und Selbstprüfung „Sandbox“ – gemeinsam mit B-31 | B | ~250 |
| 11.5a1 | Bundle-Leser ins Protokoll; Arbeitskopie: Baum am Kopf in den Arbeitsordner, Pfad-Regeln aus V4 | B | ~250 |
| 11.5a2 | Patch-Schreiber: Arbeitsordner gegen den Kopf des Bundles, Text wie `git format-patch`, Tests gegen git | B | ~350 |
| 11.5b | Protokoll: Repo-Tag in der Erwähnung, „Repo gehört zum Raum“, `patchStatus()` ohne Agenten, `docs/PROTOCOL.md` 33 | A | ~250 |
| 11.5c | Knoten: Ablauf wie mini-swe-agent (ein Werkzeug bash, jeder Befehl in der Sandbox), Bundle holen, Patch einreichen, Antwort im Raum | A | ~400, ggf. zwei Teile |
| 11.5d | App: „Agent beauftragen“, Obergrenze, Kennzeichen an Patches von Agenten | A (Oberfläche mit C) | ~250 |

### Neue Frage

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| W6 | Darf Code in der Sandbox ins Netz (etwa `npm install`)? | A nie – nur, was im Repo und im Bild des Knotens liegt · B nur lesend (GET) über einen Proxy des Knotens zu einer festen Liste von Paket-Registries (npm, PyPI), begrenzt · C frei | **B** – Vibecoding ohne Pakete ist eng. Frei (C) erreichte fremder Code vom Knoten aus jede Adresse, auch das Heimnetz, und der Betreiber trüge das. Nur lesend, damit niemand den Code eines privaten Raums über `npm publish` hinausträgt. Bis zur Antwort baut 11.5 A |

Quellen (11.10.2026): [atomic-agent](https://github.com/AtomicBot-ai/atomic-agent),
[hermes-agent](https://github.com/NousResearch/hermes-agent),
[mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent).
