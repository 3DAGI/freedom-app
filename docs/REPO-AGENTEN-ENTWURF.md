# Agenten an Raum-Repos – Entwurf (Schritt 11.5)

Stand 10.10.2026, Spur A (mit Spur B). **Freigegeben am 11.10.2026 (MENSCH)** – mit einer
Änderung bei W3: Der Agent soll Code ausführen können. Wie (Harness, Sandbox) ist noch in
Besprechung; die Recherche dazu (alle Open-Source-Harnesses, Netz, private Räume) steht am
Ende, mit den Fragen W3a, W6a und W7. W6 ist B. Abschnitt „Entscheidungen vom 11.10.2026“
am Ende; er gilt vor den Vorschlägen darüber.
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
| W6 | **B** – „Sandbox mit Netzzugang wie geregelt“: nur lesend über den Knoten zu einer festen Liste von Registries; die Ausgestaltung (W6a) und private Räume (W7) unten sind noch zu bestätigen |

### Recherche zu W3: Harness (11.10.2026, in Besprechung)

Auftrag MENSCH: „alle verfügbaren Open-Source-Harnesses bedenken und recherchieren, welche
andere dafür verwenden“. Gesucht ist ein Ablauf, den der Knoten für Aufträge Fremder stabil
übernehmen kann.

**Was der Harness hier können muss:**

| Nr. | Kriterium | Warum |
|---|---|---|
| K1 | läuft ohne Bildschirm im Knoten, je Auftrag neu | Aufträge kommen aus dem Raum; niemand sitzt an der Tastatur |
| K2 | jeder Befehl lässt sich einzeln in unsere Sandbox schicken | die Grenze ist die Sandbox (Regeln unten), nicht der Harness |
| K3 | kein Gedächtnis, keine Zustandsdateien, keine eigenen Zugänge | AG1: Aufträge Fremder flüchtig; „Kein Klartext im Knoten“ |
| K4 | eigenes Modell des Knotens (Ollama, OpenAI-kompatibel), auch ohne Tool-Calling | nicht jedes lokale Modell beherrscht Tool-Calling |
| K5 | Lizenz MIT oder Apache-2.0 | EUPL-1.2; starkes Copyleft (GPL, AGPL) zöge das Ganze unter seine Lizenz |
| K6 | stabil: klein, verstanden, gepflegt, nicht im Umbau | „stabil kopieren“ (MENSCH) |

**Die Kandidaten.** Stand 11.10.2026. Sterne nach dem Vergleich von pinggy.io (29.08.2026),
sonst nach Angaben der Projekte.

| Harness | Lizenz, Sprache | Einbetten | Ausführen, Sandbox | Stand | K1–K6 |
|---|---|---|---|---|---|
| **mini-swe-agent** (SWE-bench-Team, Princeton/Stanford) | MIT, Python | Bibliothek (`DefaultAgent`), Kern rund 100 Zeilen | jeder Befehl ein eigener Prozess; Umgebungen lokal, Docker/Podman, Singularity, bubblewrap (experimentell) | Harness des offiziellen SWE-bench-Vergleichs „Bash only“; Nutzer laut Projekt Meta, NVIDIA, IBM, Essential AI, Nebius, Anyscale | alle – nachgebaut in TypeScript |
| SWE-agent | MIT, Python | CLI, GitHub Action | Docker | vom selben Team durch mini-swe-agent abgelöst | K6 ✗ |
| **Pi** (Mario Zechner, heute Earendil) | MIT, TypeScript | SDK (`createAgentSession`), RPC; Motor von OpenClaw | vier Werkzeuge (read, write, edit, bash), keine Sandbox, keine Rückfragen | 1.1.0; `pi-coding-agent` 23 MB entpackt, `pi-ai` zieht die SDKs von OpenAI, Google, Anthropic und AWS; Paketname 2026 gewechselt | K2 nur über eigene Werkzeuge, K6 ✗ |
| OpenCode (anomalyco, vormals sst) | MIT, TypeScript | Server und SDK; `/oc` im Issue → Zweig und PR in GitHub Actions | keine eigene Sandbox | rund 202 000 Sterne, sehr aktiv | K3 ✗ (eigene Zustandsordner, Erweiterungen, LSP), K6 ✗ (großes Produkt) |
| OpenHands | MIT (Kern), Python | Software Agent SDK 1.0, Agent-Server (REST, WebSocket) | Docker je Sitzung (Bild mit VS Code und VNC) | rund 85 000 Sterne | K1 ✓; Docker und Python im Knoten, K6 ✗ |
| Codex CLI (OpenAI) | Apache-2.0, Rust | `codex exec`, SDK | **beste eingebaute Sandbox:** bubblewrap und seccomp, Netz aus, Proxy-Brücke | rund 119 000 Sterne | K3 ✗ (`~/.codex`, Anmeldung), K6 ✗ (schnelle Versionen) – **Vorbild für unsere Sandbox** |
| Goose (Block, seit April 2026 Linux Foundation) | Apache-2.0, Rust | CLI, Server | keine eigene Sandbox | rund 54 000 Sterne | K2 ✗, K6 ✗ |
| Aider | Apache-2.0, Python | CLI | keine; arbeitet mit git | keine Commits seit 22.05.2026 | K6 ✗ |
| Cline, Kilo Code | Apache-2.0 bzw. MIT, TypeScript | VS-Code-Erweiterung, neu auch CLI und SDK | keine eigene | aktiv | K1 schwach, K6 ✗ |
| Roo Code | Apache-2.0 | – | – | archiviert am 15.05.2026 | ✗ |
| Gemini CLI, Qwen Code | Apache-2.0, TypeScript | CLI | Docker/Podman, macOS Seatbelt | Gemini CLI für die meisten am 18.06.2026 eingestellt; Qwen Code ist ein Fork davon | K6 ✗ |
| DeepSeek Harness | MIT | alles als Plugin | Sandbox als Plugin; Quellen widersprechen sich | Entwickler-Vorschau 0.1.2-alpha (13.08.2026), Brüche angekündigt | K6 ✗ |
| Grok Build (xAI) | Apache-2.0, Rust | CLI | nicht beschrieben | 1.0 am 07.08.2026 | K6 ✗ (zu neu) |
| Crush (Charm) | FSL-1.1-MIT | – | – | vor 1.0 | K5 ✗ (erst nach Jahren offen) |
| Plandex, Trae Agent | MIT | – | – | ruhen seit Okt. 2025 bzw. Feb. 2026 | K6 ✗ |
| smolagents (Hugging Face) | Apache-2.0, Python | Bibliothek | Code-Agenten mit E2B oder Docker | Baukasten für eigene Agenten, kein Coding-Harness | teils |
| Hermes Agent (Nous Research) | MIT, Python und Node | keine Bibliotheks-Schnittstelle | sieben Ausführungsorte | großes Produkt mit eigenem Gedächtnis (`~/.hermes`) | K3 ✗, K6 ✗ |
| Atomic Agent (B-30) | MIT, TypeScript | `atomic-agent serve` | Freigaben durch einen Menschen, keine Sandbox | „developer preview“ | für Fremde ✗ – bleibt für eigene Wege (AG1 A) |
| Shakespeare (Soapbox, Vibecoding auf Nostr im Browser) | AGPL-3.0 | Web-App | im Browser, kein fremder Prozess | aktiv | K5 ✗ – nur als Vorbild für Nostr und git |

**Was andere dafür verwenden:**
- **Modelle vergleichen:** Der offizielle SWE-bench-Vergleich „Bash only“ läuft mit
  mini-swe-agent – nur bash, „just a simple ReAct loop“, auf SWE-bench Verified. Das Projekt
  nennt über 74 % mit starken Modellen.
- **In ein Produkt einbetten:** OpenClaw nutzt Pi als Laufzeit (`createAgentSession` mit
  eigenen Werkzeugen).
- **„Erwähnung im Issue → Patch“, wie bei uns:** OpenCode (`/oc`, läuft in GitHub Actions,
  öffnet einen PR), OpenHands (Resolver, SDK mit Docker), Codex Cloud, GitHub Copilot Coding
  Agent. Alle arbeiten in einer Wegwerf-Umgebung je Auftrag. Codex und Copilot sperren das
  Netz bis auf eine Liste (W6 unten).
- **Wie viel der Harness ausmacht:** Eine Studie (Juli 2026) ließ Goose, OpenCode und
  OpenHands-SDK mit denselben offenen Modellen auf Terminal-Bench laufen. Die Lösungsquote
  unterschied sich um 0 bis 8 Prozentpunkte, die Tokens je gelöster Aufgabe bis zum
  Vierzigfachen. Ein Knoten, der nach Tokens abrechnet (W5), braucht also vor allem einen
  schlanken Ablauf.

**Ergebnis: Vorschlag wie bisher, jetzt begründet – den Ablauf von mini-swe-agent in
TypeScript nachbauen.**
- Nur er erfüllt K1–K6 ganz. Der Kern ist klein genug, um ihn vollständig zu verstehen. Er
  ist der Maßstab, an dem Modelle gemessen werden, und es entsteht keine Abhängigkeit, die
  sich unter uns ändert.
- **Übernommen (gelesen im Quelltext, 11.10.):**
  - eine Aktion je Antwort, als Codeblock im Text (wie Fassung 1.x – geht auch mit lokalen
    Modellen ohne Tool-Calling);
  - lineare Historie, jeder Befehl in einer neuen Shell;
  - lange Ausgaben gekürzt: über 10 000 Zeichen nur Anfang und Ende je 5 000;
  - Ende mit `echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`, allein im Befehl;
  - höchstens drei Formfehler hintereinander;
  - die Anweisungen an das Modell, mit dem MIT-Hinweis des Projekts.
- **Anders als dort:**
  - Am Ende gibt das Modell keinen Diff aus; den Patch baut der Knoten aus dem Arbeitsordner (V5).
  - Grenzen nach Schritten, Zeit und der Obergrenze des Preises (W5) statt nach Dollar.
  - Die Sandbox ist unsere (unten). Die bubblewrap-Umgebung von mini-swe-agent ist als
    experimentell markiert, teilt das Netz des Rechners (kein `--unshare-net`) und bindet
    ganz `/etc` ein. Als Grenze für Fremde taugt sie nicht.
- **Zweite Wahl: Pi als Bibliothek**, falls später Werkzeuge wie `edit` nötig werden.
  TypeScript und MIT, aber ein großer Abhängigkeitsbaum und Umbau in diesem Jahr. Neu prüfen,
  wenn 11.5c läuft.
- **Vorbild für die Sandbox: Codex CLI** (nächster Abschnitt) – als Regelwerk, nicht als
  Programm im Knoten.

### Vorschlag zu W3: Regeln fürs Ausführen

- **Nur in bubblewrap, nach dem Vorbild von Codex.** Codex startet unter Linux jeden Befehl
  in bubblewrap:
  - die Wurzel nur lesbar;
  - schreibbar nur die Arbeitsordner, darin `.git` wieder nur lesbar;
  - eigene Namensräume für Nutzer, Prozesse und – ohne Proxy – Netz;
  - ein frisches `/proc`;
  - danach `PR_SET_NO_NEW_PRIVS` und ein seccomp-Filter, der Netz-Aufrufe und `io_uring` sperrt.

  Für uns heißt das je Befehl:
  - `--unshare-all` (Nutzer, Prozesse, Netz, IPC, Hostname, cgroup), `--die-with-parent`,
    `--new-session`, `--cap-drop ALL`;
  - nur lesbar: `/usr`, `/bin`, `/lib`, `/lib64` und die Werkzeuge des Bilds. Aus `/etc` nur,
    was Programme brauchen (etwa ein `passwd` mit einem Nutzer), nicht das ganze `/etc` wie bei
    mini-swe-agent;
  - schreibbar nur der Arbeitsordner; `/tmp` als tmpfs; `/proc` und `/dev` neu;
  - die Umgebung leer (`--clearenv`) bis auf `PATH`, `HOME` und `LANG`; keine Variable des Knotens;
  - seccomp wie bei Codex als zweite Stufe in 11.5s, wenn es ohne neue Abhängigkeit geht;
    sonst ein eigener Schritt.
  - Das Home des Knotens und `~/.freedom` (Schlüssel, Kopplung, Kasse) sind nicht sichtbar.
  - Dieselbe Sandbox nutzt B-31 (MCP, MC1: ausführende Werkzeuge nur in bubblewrap) – ein
    Baustein für beide.
- **Ohne Sandbox kein Ausführen.** Fehlt `bwrap` oder sind Nutzer-Namensräume gesperrt
  (Docker-Seccomp, AppArmor ab Ubuntu 24.04 – beides kennt auch Codex), sagt die
  Selbstprüfung das. Der Agent arbeitet dann wie in V4: nur lesen und schreiben. Nie direkt
  auf dem Rechner.
- **Arbeitsordner im Arbeitsspeicher.** Je Auftrag ein Ordner auf einem tmpfs (0700), darin
  der Stand am Kopf des Bundles. Nach dem Auftrag wird er gelöscht, auch wenn er scheitert.
  So bleibt „Kein Klartext im Knoten“: nichts auf der Platte.
- **Grenzen** (Vorgabe, der Betreiber kann sie senken):
  - 60 s je Befehl; bei Ablauf wird die ganze Prozessgruppe beendet, wie bei mini-swe-agent;
  - 30 min und 50 Schritte je Auftrag;
  - 512 MB im Arbeitsordner; Speicher und Prozesse je Befehl begrenzt.
  - Die Ausgabe je Befehl geht gekürzt an das Modell zurück.
- **Netz:** Die Sandbox selbst bleibt ohne Netz. Pakete holt der Knoten vorher (W6, unten).
- **Werkzeuge in der Sandbox:** was das Bild des Knotens mitbringt (Node.js, npm, Python,
  die Shell). git braucht es nicht; den Patch baut der Knoten (V5).
- **Fremder Text steuert jetzt echten Code.** Die Grenze ist die Sandbox: Darin liegen keine
  Geheimnisse des Knotens, hinaus geht nur der Patch, und den nimmt nur ein Mensch an (V6).
- **Kosten:** Gerechnet wird nach Tokens bis zur Obergrenze (W5). Die Rechenzeit der Sandbox
  trägt der Betreiber; ein eigener Preis dafür ist ein späterer Schritt.

### W6: Netz in der Sandbox

**Freigegeben 11.10.2026 (MENSCH): B** – „Sandbox mit Netzzugang wie geregelt“: nur lesend,
über den Knoten, zu einer festen Liste von Paket-Registries. Die Ausgestaltung unten ist neu
und bitte zu bestätigen.

**Wie andere es machen** (recherchiert 11.10.):

| | Netz beim Arbeiten | Liste | Sonst |
|---|---|---|---|
| Codex Cloud | aus (Vorgabe); das Setup-Skript läuft vorher mit Netz | „Common dependencies“: github.com, npmjs.com, pypi.org, pythonhosted.org, crates.io, maven.org u. a. | wählbar: nur GET, HEAD, OPTIONS |
| GitHub Copilot Coding Agent | Firewall an (Vorgabe) | empfohlene Liste: Paket-Registries von zwölf Sprachen, Pakete des Betriebssystems, Container | gilt nur für Prozesse aus dem Bash-Werkzeug |
| Codex CLI | aus (`workspace-write`) | über eine Proxy-Brücke in den Namensraum | seccomp sperrt Netz-Aufrufe, wenn kein Proxy da ist |
| Anthropic `sandbox-runtime` (Apache-2.0) | nur über einen Proxy (HTTP, SOCKS5) | `allowedDomains`, sonst alles gesperrt | bubblewrap unter Linux |

Codex nennt als Risiken: Prompt Injection, Abfluss von Code und Geheimnissen, Schadcode in
Abhängigkeiten, Lizenzen. Dazu kommt npm: Version 12 schaltet Install-Skripte standardmäßig
ab. Schadcode, der erst beim Importieren läuft, hält das nicht auf (so im Juli 2026 bei
AsyncAPI). Also: Pakete holen und Code ausführen trennen – ausgeführt wird nur ohne Netz.

**Vorschlag: zwei Phasen; die Sandbox selbst bleibt ohne Netz.**
1. **Pakete holen – der Knoten, bevor der Agent beginnt:**
   - Er liest die Sperrdatei im Arbeitsordner: `package-lock.json` (Fassung 2 und 3) und
     `requirements.txt` nur mit `--hash`.
   - Er lädt nur die Archive, die dort stehen, per GET und nur von `registry.npmjs.org`,
     `pypi.org` und `files.pythonhosted.org`. Das geht über den SSRF-Wächter (8.7) und über
     Tor, wenn eingestellt.
   - Jede Prüfsumme wird geprüft (`integrity` mit sha512, `--hash` mit sha256). Ohne
     Prüfsumme gibt es kein Paket.
   - Grenzen (Vorgabe): 500 Pakete, 200 MB zusammen, Größe je Archiv, Zeit.
   - Ablage in einem Zwischenspeicher je Auftrag (tmpfs), danach gelöscht.
2. **Arbeiten – die Sandbox, ohne Netz:**
   - Der Zwischenspeicher ist nur lesbar eingebunden.
   - Installiert wird mit `npm ci --offline --ignore-scripts` bzw.
     `pip install --no-index --find-links`.
   - Install-Skripte laufen nie. Native Erweiterungen, die beim Installieren bauen
     (node-gyp), gehen damit nicht – das sagt der Agent im Raum.
3. **Ein neues Paket – nur in offenen Räumen:**
   - Werkzeug `paket_holen(registry, name, version)`. Der Knoten führt es aus, nicht die Sandbox.
   - Metadaten und Archiv per GET von der Liste; der Name nach den Regeln der Registry
     geprüft; die Version fest, kein Bereich.
   - Höchstens 20 je Auftrag.
   - Danach schreibt der Agent die Sperrdatei in der Sandbox offline
     (`npm install --package-lock-only --offline`).
- **Warum so:**
  - Code in der Sandbox erreicht keine Adresse, weder das Internet noch das Heimnetz des Betreibers.
  - Hinaus geht nur ein GET des Knotens nach Paketen, die eine Sperrdatei mit Prüfsumme
    nennt oder die der Agent mit Namen und Version anfragt.
  - Es gibt kein POST, also auch kein `npm publish`.
- **Rest-Risiko, ehrlich:** Ein Agent unter fremdem Einfluss könnte über die Wahl von
  Paketnamen einzelne Bits nach außen geben, über die öffentliche Download-Zählung der
  Registry. Im offenen Raum ist der Code ohnehin öffentlich. Im privaten Raum gibt es deshalb
  Schritt 3 nicht (unten).
- **Andere Sprachen** (crates.io, Go-Proxy …) kommen später, je mit einer Zeile in der Liste
  und einem Leser für ihre Sperrdatei.

### Private Räume (Vorschlag)

Auftrag MENSCH: „Mit git auf Freedom sowieso öffentlich, bei privat schauen, wie am besten
gemacht.“

- **Offene Repos sind öffentlich:** Ihr Bundle-Schlüssel steht im öffentlichen Verweis (38042).
  Ein Knoten, der daran arbeitet, sieht nichts, was nicht jeder sehen kann.
- **Private Repos sind so geheim wie der Chat des Raums.**

**Wo Code eines privaten Repos hinausgelangen könnte:**
1. an das Modell – läuft es nicht auf dem Knoten selbst, liest ein Dritter den Code mit;
2. auf die Platte oder ins Log des Knotens;
3. über das Netz aus der Sandbox (Schadcode, Prompt Injection);
4. über das Holen der Pakete (Paketnamen, Zeitpunkte, IP des Knotens);
5. über den Patch und die Antwort.

**Wie andere es machen:**
- Copilot, Codex Cloud und OpenHands Cloud arbeiten an privaten Repos in der Cloud des
  Anbieters. Man vertraut ihm per Vertrag.
- Auf fremder Hardware schützt technisch nur vertrauliches Rechnen (TEE). Dafür liegt
  `docs/D3-ENTWURF.md` (freigegeben 08.10., ruht – der GX10 hat kein TPM).
- Shakespeare arbeitet im Browser; den Code sieht dort nur der gewählte KI-Anbieter.

**Vorschlag P1–P5:**
- **P1 – Nur Agenten, die schon Mitglied sind.**
  - Ein Agent im privaten Raum liest den Raum ohnehin (Grenze „agent-knoten-privat“).
  - Den Schlüssel des Bundles liest er aus dem inneren Event (38042 in der Gruppe), wie
    jedes Mitglied.
  - Kein Schlüssel reist in einem Auftrag, und kein Knoten außerhalb der Gruppe bekommt Code.
  - Der Betreiber muss private Räume zulassen (`AGENT_PRIVAT`); empfohlen ist `besitzer`.
- **P2 – Nur mit dem Modell auf demselben Rechner.**
  - Repo-Aufträge aus privaten Räumen nimmt der Knoten nur an, wenn sein Modell auf demselben
    Rechner läuft: `OLLAMA_URL` auf localhost, geprüft wie `lokaleKiAdresse()`.
  - Nie an andere Provider oder einen Dienst im Netz.
  - Sonst antwortet der Agent im Raum mit Grund und arbeitet nicht.
  - Das entspricht D2 („privat“: nur Gerät oder eigener Knoten).
- **P3 – Ohne Netz; Pakete nur aus der Sperrdatei und nur, wenn der Raum es will.**
  - Phase 1 (Pakete holen) läuft nur, wenn ein Admin es im Raum einschaltet; Vorgabe aus.
  - Die Registry sieht dann Paketnamen und die IP des Knotens, nie Code.
  - `paket_holen` gibt es im privaten Raum nicht.
- **P4 – Nichts auf der Platte, nichts im Log.**
  - Arbeitsordner und Zwischenspeicher liegen im tmpfs und werden nach dem Auftrag gelöscht.
  - Das Log enthält nur Zahlen und feste Kennungen.
  - Patch und Antwort gehen nur als innere Events hinaus (`raumRepoPatch()`); das deckt die
    Leak-Regel `raum-repo-privat`.
- **P5 – Agent auf dem Gerät.**
  - Im Browser gibt es keine Sandbox für fremde Prozesse. Dort arbeitet er wie in V4: lesen
    und schreiben, nichts ausführen.
  - Ausführen auf dem Gerät erst in der Hülle (6.1, Tauri) mit derselben Sandbox – ein
    eigener späterer Schritt.
- **Später:** Versiegelte Provider (D3) könnten private Repos auch auf fremden Knoten bearbeiten.

### Vorschlag zu W3: Aufteilung (ersetzt V9, sobald W3 geklärt ist)

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| 11.5s | Sandbox-Baustein (`bwrap` wie oben, Grenzen, leere Umgebung, tmpfs-Ordner) und Selbstprüfung „Sandbox“ – gemeinsam mit B-31 | B | ~250 |
| 11.5a1 | Bundle-Leser ins Protokoll; Arbeitskopie: Baum am Kopf in den Arbeitsordner, Pfad-Regeln aus V4 | B | ~250 |
| 11.5a2 | Patch-Schreiber: Arbeitsordner gegen den Kopf des Bundles, Text wie `git format-patch`, Tests gegen git | B | ~350 |
| 11.5b | Protokoll: Repo-Tag in der Erwähnung, „Repo gehört zum Raum“, `patchStatus()` ohne Agenten, `docs/PROTOCOL.md` 33 | A | ~250 – **fertig** (14.10.: `repo-auftrag.ts`; `istAgent` an `patchStatus()`, `mitRaumRechten()`, `raumReposPrivat()`, Repo-Karten der App) |
| 11.5n | Pakete holen (W6): Sperrdateien lesen (npm, PyPI), Archive mit Prüfsumme nur von der Liste, Zwischenspeicher; `paket_holen` nur in offenen Räumen; Schalter im privaten Raum | A | ~300 |
| 11.5c | Knoten: Ablauf wie mini-swe-agent (eine Aktion je Antwort, jeder Befehl in der Sandbox), Bundle holen, P1–P4, Patch einreichen, Antwort im Raum | A | ~400, ggf. zwei Teile |
| 11.5d | App: „Agent beauftragen“, Obergrenze, Kennzeichen an Patches von Agenten, Schalter „Pakete holen“ im privaten Raum | A (Oberfläche mit C) | ~250 |

### Fragen dazu

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| W3a | Welcher Harness? | A Ablauf von mini-swe-agent, nachgebaut in TypeScript · B Pi als Bibliothek · C Codex CLI als Programm im Knoten · D OpenHands mit Docker | **A** – erfüllt als Einziger K1–K6; Codex dient als Vorbild für die Sandbox |
| W6a | Ausgestaltung von W6 B | wie oben: Pakete holt der Knoten (Sperrdatei mit Prüfsumme, feste Liste, nur GET), die Sandbox bleibt ohne Netz, neue Pakete nur in offenen Räumen | so |
| W7 | Wer darf an Code privater Räume arbeiten? | A nur Agenten, die Mitglied sind, mit Modell auf demselben Rechner (P1–P5) · B dazu fremde Knoten nach Hinweis im Raum · C in privaten Räumen keine Repo-Aufträge | **A** – der Code bleibt in der Gruppe und auf dem Rechner des Agenten; das passt zu D2 |

Quellen (11.10.2026):
- Harnesses: [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) (Quelltext von
  `agents/default.py`, `environments/extra/bubblewrap.py`, `config/default.yaml`),
  [SWE-bench Bash Only](https://www.swebench.com/bash-only.html),
  [Pi auf npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) und
  [Armin Ronacher über Pi und OpenClaw](https://mitsuhiko.spicytakes.org/post/2026-01-31-pi),
  [OpenCode GitHub](https://opencode.ai/docs/github/),
  [OpenHands Agent Server](https://docs.openhands.dev/sdk/guides/agent-server/overview),
  [Vergleich pinggy.io](https://pinggy.io/blog/best_open_source_cli_coding_agents/),
  [Vergleich (Gist)](https://gist.github.com/asermax/4fb2be4f6f1fc0d6be1e3966b6e2bb91),
  [Studie „Scaffold Effect“](https://arxiv.org/abs/2607.22585),
  [DeepSeek Harness](https://thenewstack.io/deepseek-harness-open-source-plugins/),
  [Shakespeare](https://alternativeto.net/software/shakespeare/about),
  [atomic-agent](https://github.com/AtomicBot-ai/atomic-agent),
  [hermes-agent](https://github.com/NousResearch/hermes-agent).
- Sandbox und Netz: [Codex Linux-Sandbox](https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/README.md),
  [Codex Cloud: Internetzugang](https://learn.chatgpt.com/docs/cloud/internet-access),
  [Copilot: Firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall),
  [Anthropic sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime),
  [npm 12 ohne Install-Skripte](https://thehackernews.com/search/label/CI),
  [npm-Angriffe 2026](https://www.pkgpulse.com/guides/npm-security-landscape-supply-chain-attacks-2026).
