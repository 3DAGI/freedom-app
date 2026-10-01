# Sammlung für die Neuordnung

Stand 29.09.2026, `main` bei `dc53ed1`. Angelegt von Spur B, ergänzt von Spur C.

**Zweck:** alle offenen und empfohlenen Punkte an **einer** Stelle – als
Grundlage, wenn Spur A wieder arbeitet und der MENSCH eine neue Roadmap baut.
Die älteren Listen im Repo (README, START, LUECKEN, ROADMAP …) widersprechen
sich teils; sie werden später aufgeräumt (Anhang C). Bis dahin ändert diese
Sammlung keine von ihnen.

**Solange Spur A pausiert,** arbeiten Spur B und Spur C Punkte mit Status
`frei` aus ihrem eigenen Abschnitt ab – ohne Spur A zu stören und ohne
aufeinander zu warten.

---

## 1. Regeln dieser Sammlung

**Status**

| Status | heißt |
|---|---|
| `frei` | ohne Entscheidung sofort bearbeitbar – nur von der genannten Spur |
| `Entscheidung` | erst nach der Wahl des MENSCHEN (Abschnitt 5) |
| `wartet` | hängt an etwas außerhalb der Spur (Deploy, fremder PR, Dienst) – steht dabei |
| `MENSCH` | nur der MENSCH (Abschnitt 6) |
| `fertig (#PR)` | erledigt – die Zeile bleibt für die Neuordnung stehen |

**Unabhängigkeit**

1. Jeder Punkt gehört **ganz** einer Spur – samt Oberfläche, Texten und Tests.
   Kein Punkt wird mitten in der Arbeit an eine andere Spur übergeben.
2. Braucht ein Punkt Code einer anderen Spur, bleibt die Änderung klein und
   steht im Pull Request (CLAUDE.md, „Drei Agenten“, Regel 1).
3. Während Spur A pausiert:
   - keine Punkte aus Abschnitt 4 anfangen;
   - `app/src/shell/tabs/settings.ts` und `app/src/shell/index.html` nur
     minimal ändern – Spur As offener PR #183 ändert beide;
   - den Geld-Kern nicht ändern: `protocol/src/aufteilung.ts`,
     `app/src/shell/ki-zahlung.ts`, `app/src/zahlkanal.ts`,
     `app/src/shell/zahlkanal-ui.ts`, `app/src/rails.ts`,
     `app/src/shell/zahlschienen.ts`, `app/src/anteile-kasse.ts`.
4. **Reviere während der Pause** – die jeweils andere Spur ändert dort nur
   Kleinigkeiten und nennt sie im PR:

   | Spur B | Spur C |
   |---|---|
   | `shell/tabs/agent.ts` (Modellwahl), `local-tools.ts`, Räume im Protokoll (`spaces.ts`, `raum-*.ts`), Knoten (`relay-role.ts`, `storage-role.ts`, `main.ts`), `blob-client.ts`, Zustandssicherung | `shell/tabs/waehrung.ts`, `shell/tabs/kommunikation.ts` (außer einem Knopf für B-4), `shell/tabs/agent-netz.ts`, `shell/tabs/earn.ts`, `shell/tabs/profil.ts`, `shell/offline-zahlung.ts`, `app.css`, Website |

**Ergänzen**

- Neue Punkte ans Ende des **eigenen** Abschnitts, mit der nächsten freien
  Nummer. Fremde Zeilen nicht ändern; den Status ändert nur, wer den Punkt
  bearbeitet.
- Diese Sammlung ist keine Karte: Arbeitsweise, Definition of Done und STOPP
  aus `CLAUDE.md` gelten unverändert. Bis zur Neuordnung werden Punkte wie
  bisher in `docs/ausbau/FORTSCHRITT.md` (eigene Zeile) und `STATUS.md`
  eingetragen – mit ihrer Nummer (z. B. „B-1“).

---

## 2. Spur B – Mesh und Bausteine

Reihenfolge: erst die freien Punkte von oben nach unten.

| Nr. | Punkt | Status | Dateien, Hinweise |
|---|---|---|---|
| B-1 | **KI „Dieses Gerät“ in der Modellwahl** (Lokal-Modus, Anhang B): Oben in der Modellwahl „Wo rechnet die KI? Netz / Dieses Gerät“. Direkt an Ollama oder llama.cpp auf `localhost` – `localInfer()`/`localOllamaUp()` aus `local-tools.ts` endlich anbinden, Modelle aus `/api/tags`. Kein Relay, keine Zahlung; nicht erreichbar → klare Meldung, nie still ins Netz. Hinweis auf `OLLAMA_ORIGINS`. Neue Datenschutz-Aussage „Frage verlässt das Gerät nicht“ mit Szenario. | `fertig` (#207) | `agent.ts` (Modellwahl), `local-tools.ts`, neu `shell/ki-lokal.ts`, `texte/agent.ts`, `privacy-facts` |
| B-2 | **Speicher „nur dieses Gerät“:** Beim Hochladen von Git-Bundles und Anhängen „Netz / nur dieses Gerät“ – im zweiten Fall bleiben die Stücke im Browserspeicher, dazu Export als `.bundle`-Datei. Ehrlicher Text: Andere erreichen das Repo dann nicht. | `fertig` – S1 entschieden 30.09.: „privat, nur dieses Gerät“ (nichts auf Relays), später „öffentlich“. Aufgeteilt (über 400 Zeilen): **a fertig** (#226, Baustein und Ablage: `lokale-repos.ts`, IndexedDB `freedom-repos`, Liste im Tresor), **b fertig** (#227, Oberfläche: „Wo: nur dieses Gerät“, Code lesen, neue Version, Sichern als `.bundle`, Löschen), **c fertig** (#228, Wechsel auf „öffentlich“: Ankündigung und Bundle hinaus, erst dann entfällt die Kopie) | `lokale-repos.ts`, `shell/lokale-repos-ablage.ts`, „Wo“-Auswahl in `repos.ts` |
| B-3 | **Flutschutz im Relay des Knotens:** `antispam.ts` (RateLimiter) ist gebaut, aber nicht verdrahtet (`scripts/wiring-ausnahmen.txt`). Je Verbindung und je Schlüssel begrenzen, feste Texte nach außen. | `fertig` (#209) | `node/src/relay-role.ts`, `antispam.ts` |
| B-4 | **Kontakt prüfen:** Sicherheitscode aus beiden Schlüsseln und QR-Vergleich (QR-Bausteine seit 11.1), Ergebnis „geprüft“ je Kontakt im Tresor. Für MLS prüfen, ob MDK einen Gruppen-Authenticator liefert. | `fertig` (#210) – der MLS-Baustein gibt keinen Gruppen-Authenticator heraus (Crate neu bauen = eigener Schritt); für 1:1 genügt der Code aus den Identitätsschlüsseln | neues Protokoll-Modul, `shell/qr-ui.ts`, ein Knopf im Chat |
| B-5 | **Zusammenführen nach Offline-Bearbeitung:** `merge.ts` ist gebaut, aber nicht angebunden – die Zustandssicherung überschreibt heute. | `fertig` (#212) – ohne `merge.ts`: die gespeicherten Daten tragen keine Zeit je Feld, deshalb Vereinigung je Eintrag (`zustand-zusammenfuehren.ts`) | Zustandssicherung (8.12), `merge.ts` |
| B-6 | **Datenexport** als Gegenstück zur Notfall-Löschung: Kontakte, Chats, Räume, Repos, Belege als verschlüsseltes Archiv; Schlüssel nie. Inhalt im PR auflisten. | `fertig` (#211) – Repos stehen nicht auf dem Gerät (Relays, Blob-Netz, kommen mit dem Schlüssel zurück), private Räume nicht (Gruppenschlüssel; ein neues Gerät tritt neu bei) | Tresor, Sicherung (8.12/8.14) |
| B-7 | **B20 – offene Räume lassen sich übernehmen:** `buildSpaceState()` macht den Autor der neuesten Definition (34700) zum Gründer, egal wer ihn schreibt. | `fertig` (#215) – E6 A: gemerkt und geteilt wird die Adresse (`34700:<gründer>:space:<kennung>`), der Raum nur über `raumZustandFuer()`; eine bloße Kennung bindet die App nur eindeutig (`gruenderZurKennung()`) | `spaces.ts`, `raeume.ts` |
| B-8 | **Knoten mit Besitzer koppeln** (Lokal 13.2): Kopplungscode als QR; Aufträge des Besitzers an den eigenen Knoten gratis, ohne Kontingent. | `in Arbeit` – L1 entschieden 01.10.: A (Kopplungsgeheimnis). Aufgeteilt: **a fertig** (#229, Protokoll: `kopplung.ts`, Kopplungscode, Nachweis im versiegelten Kern, Leak-Regel `besitzer-versiegelt`), **b fertig** (#230, Knoten: Geheimnis in `~/.freedom/kopplung.json`, `npm run koppeln` mit QR im Terminal, Besitzer gratis ohne Gebot und Kontingent), c App (koppeln, Nachweis senden) | Knoten, `qr-ui.ts` |
| B-9 | **„Mein Knoten“ in der Modellwahl und beim Speichern** (Lokal 13.3 und 13.5): nur dieser Knoten, über sein Relay, kein Ausweichen; Knopf „Alles über meinen Knoten“ (KI, Speicher, Relays). Eigene Oberfläche gehört dazu. | `wartet` auf B-8 (dieselbe Spur) | `agent.ts`, `relay-satz.ts`, `speicher-abruf.ts` |
| B-10 | **Knoten liefert die App aus** (Lokal 13.4): http im Heimnetz, gleicher Ursprung wie das Relay, auch als .onion – nur ein reproduzierbarer Build mit Prüfsumme (Echtheit 5.2). | `frei` – L2 entschieden 01.10.: A | Knoten, `build.mjs` nur lesend |
| B-11 | **Knoten aus der App verwalten:** Status, Modelle, Einnahmen, Neustart – versiegelt, nur vom gekoppelten Besitzer, nie Klartext aus Aufträgen. | `wartet` auf B-8, Umfang: `Entscheidung` | Knoten, neues Modul in der App |
| B-12 | **Weckdienst:** über neue Nachrichten informiert werden, wenn die App zu ist – der eigene Knoten beobachtet den Posteingang (1059 an mich) und weckt per Web Push, ohne Inhalt und Absender. | `wartet` auf B-8 – W1 entschieden 01.10.: A | Service Worker → `loescheAllesLokal()` erweitern (Regel 8.14) |
| B-13 | **Anrufe (Sprache/Video):** WebRTC, Verbindungsaufbau versiegelt über NIP-17, Medien über einen Vermittler (TURN) auf dem eigenen Knoten. | `wartet` auf B-8 – T1 entschieden: A; TURN im Knoten: Abhängigkeit vorher fragen | neu |
| B-14 | **Mehrere Identitäten** (privat, Arbeit, anonym) mit getrennten Tresoren, Relays und Wallets. | `entfällt` – I1 entschieden: B | `shell/app.ts`, Tresor |
| B-15 | **Umfragen und Termine in Räumen** (NIP-88, NIP-52) als innere Events privater Räume. | `fertig` – a Protokoll (#216, `raum-planung.ts`), b Oberfläche (#217, `shell/raum-planung-ui.ts`) – R1 entschieden: A | `raum-gruppe.ts` |
| B-16 | **Modelle im Browser** (WebGPU) als dritte Option neben „Dieses Gerät“. | `später` – L3 entschieden 01.10.: A (eigener Punkt, nicht jetzt) | neue Abhängigkeit → STOPP |
| B-17 | **5.10b OpenTimestamps** (zurückgestellt). | `wartet` – Kalender nicht erreichbar, keine Testvektoren | `timestamps.ts` |
| B-18 | **8.9c Speicher bezahlen** in sats und SOL. | `wartet` – Deploy des Zahlkanals (MENSCH) | `storage-role.ts`, `speicher-abruf.ts` |
| B-19 | **Moderation in offenen Räumen wirkt nicht** (Fund aus B-7): Ausblenden und Sperren (34551/34552, `buildHide()`/`buildBan()`) gehen hinaus, aber die Kanal-Ansicht wendet sie nicht an. Moderatoren sind dort, wer im Raum-Zustand `moderieren` hat (nicht die Liste 34550 der Communities). | `fertig` (#218) – `raumModeration()`: nur Moderatoren des Raums, nur gegen Niedrigere; die Lücke bleibt als Zeile sichtbar | `raeume.ts`, `moderation.ts`, `spaces.ts` |
| B-20 | **Kanäle in offenen Räumen durch Moderatoren** (aus E6: „wie Discord“): Heute ändert nur der Gründer die Definition (34700 trägt seine Signatur); `kanaele_verwalten` wirkt deshalb nur privat. Braucht ein eigenes Event für Kanäle, das Berechtigte signieren. | `frei` – entschieden 01.10. (MENSCH): ja, eigenes Event für Kanäle, das Berechtigte signieren | `spaces.ts` |

---

## 3. Spur C – Oberfläche

| Nr. | Punkt | Status | Dateien, Hinweise |
|---|---|---|---|
| C-1 | **Browser-Dialoge nach `shell/dialog.ts`:** rund 55 Stellen mit `confirm`/`prompt`/`alert` – u. a. `waehrung.ts` (9), `agent-netz.ts` (6), `kommunikation.ts` (5), `offline-zahlung.ts` (4), `profil.ts` (3), `nachfolge-ui.ts`, `bunker.ts`, `chat-zap.ts`. `settings.ts` ist seit dem Merge von PR #183 frei; `agent.ts` erst nach B-9 (dieselbe Datei). | `frei` – **C-1a fertig** (`waehrung.ts`, 9 Stellen), **C-1b fertig** (`agent-netz.ts` 6, `kommunikation.ts` 4 – `newCommunity()` fällt mit C-10), **C-1c fertig** (`settings.ts`, 12), **C-1d fertig** (Geld-Stellen: Offline-Zahlung, Trinkgeld, Zahlkanal, eingebaute Wallet – 8); **C-1e fertig** (der Rest: Profil, Nachfolge, Bunker, Prüfaufträge, Notfall, `app.ts` – 10); offen nur noch `agent.ts` (5, nach B-9) und `newCommunity()` (fällt mit C-10). `app/test/browser-dialoge.test.ts` führt die offenen Stellen je Datei | Regel „Dialoge nur über `shell/dialog.ts`“ |
| C-2 | **Einnahmen je Kette:** Die Einnahmenliste im Earn-Tab zeigt immer „… sats“ (`earn.ts:246`), auch für SOL-Aufträge – das Event nennt die Kette (`chain`). In der Einheit ihrer Kette zeigen (beide über `preis-anzeige.ts`); Untertitel „gegen Sats“ → „gegen Sats oder SOL“. Reine Anzeige. | `fertig` (C-2, Einnahmen über `einnahmeText()`) | `earn.ts`, `texte/earn.ts` |
| C-3 | **Dashboard der Website:** Preise in sats und SOL, SOL aus dem Kurs im Angebot; ohne Kurs kein SOL-Preis erfinden. | `frei` | `packages/website/js/dashboard-daten.js`, `scripts/check-website.py` |
| C-4 | **Barrierefreiheit:** Tastatur, Fokusreihenfolge, Beschriftungen für Screenreader, Kontrast; Prüfung im Smoke-Test. | `frei` | `app.css`, `index.html` nur minimal |
| C-5 | **Große Dateien aufteilen:** `waehrung.ts` (1047 Zeilen), `kommunikation.ts` (1068). `settings.ts` (1180) erst nach PR #183, `agent.ts` (1470) erst nach B-1/B-9. Vor dem Aufteilen von `kommunikation.ts` in FORTSCHRITT vermerken (B-4 hängt dort einen Knopf ein). | `frei` | reine Umzüge, keine Verhaltensänderung |
| C-6 | **`innerHTML` abbauen:** 63 Ausnahmen in `scripts/innerhtml-ausnahmen.txt`; in den Dateien des eigenen Reviers auf DOM mit `textContent` umbauen. | `frei` | `check_innerhtml.py` |
| C-7 | **Sprachnachrichten:** aufnehmen (Mikrofon nur auf Klick, danach aus), als verschlüsselter Anhang über `uploadAnhang()`, abspielen. | `frei` | `kommunikation.ts`, Regel „Anhänge nur verschlüsselt“ |
| C-8 | **C.6a – reines Verschieben** (Rest von B14, Entscheidung E2 aus `phase-10.md`): Settings › Gebühren (Aufteilung, Anteile, Standard-Schiene) → Währung › Zahlen; der Reiter „Liquidität“ heißt „Hinterlegen“ (Deposit und Zahlkanal; neuer Schlüssel für die Beschriftung, der alte bleibt, bis nichts ihn nutzt); „Modell vorhalten/ankündigen“ → Verdienen. (Teil b, der Agent, ist mit C.6b #193 fertig.) | `wartet` auf PR #183 (Spur A) | `settings.ts`, `waehrung.ts`, `earn.ts`, `index.html` |
| C-9 | **11.3e Oberfläche: Agenten in Räumen.** | `wartet` auf 11.3 (Spur A) | |

**Ergänzungen Spur C** – hier anhängen (C-10, C-11, …):

| Nr. | Punkt | Status | Dateien, Hinweise |
|---|---|---|---|
| C-10 | **Communities nach E3 (b)** – am 27.09. entschieden, nie gebaut (B6): keine neuen Communities mehr anlegen (Knopf `#chat-new-community`, `newCommunity()`), bestehende als „Community (offen)“ in der Raum-Leiste statt in der Liste der Direktnachrichten. Kein Format ändert sich, der dritte Begriff neben „offener“ und „privater Raum“ verschwindet. | `frei` | `kommunikation.ts`, `raeume.ts`, `index.html` (ein Knopf), `texte/kommunikation.ts` |
| C-11 | **MLS-Engine lädt beim Start, sobald es private Räume gibt** (aus dem Code gelesen, nicht im Browser gemessen): `wireSpacesTab()` öffnet beim Start den ersten Raum – private stehen vorn –, `oeffneRaum()` ruft `mlsAbgleichen()`; seit 11.4b2 zusätzlich `wireNip34()` → `ladeNip34Repos()` → `privateRaumRepos()` → `mlsKonto()`. Die Regel „lädt … erst bei Bedarf, nie beim Start“ (CLAUDE.md, MLS-Baustein) gilt damit nur ohne private Räume; der Smoke-Test zählt nur ohne sie. Erst beim Öffnen der Seite Kommunikation bzw. Repos laden, Smoke-Szenario mit privatem Raum dazu. | `frei` | `raeume.ts` (Ende von `wireSpacesTab()`), `repos.ts` (`wireNip34()`), `shell/raum-repos.ts` |
| C-12 | **Privaten Raum einmal vollständig im Browser** (offen aus `phase-10.md` 10.4): anlegen, einladen (zweiter Browser-Kontext), Nachricht, Thread, Moderation, Meldung, Repo anlegen und Patch im privaten Raum (11.4b2/11.4c) – mit echter MLS-Engine und der Relay-Attrappe (445, KeyPackages, Einladungen 1059). Heute nur über `gruppenRaum()`, Unit- und Leak-Tests geprüft; der Smoke-Test kennt nur den offenen Probe-Raum. | `frei` | `scripts/smoke_test.py`, `scripts/raum-probe.mts` |
| C-13 | **Räume – Rest aus dem Entwurf C.2** (`phase-10.md`, „Räume“): Raum-Leiste mit Punkt bei Ungelesenem, offene Räume mit eigenem Kennzeichen (heute zwei Buchstaben, privat ein Schloss), Pfeiltasten in der Leiste mit einem Tab-Halt; Trennlinie „Neu“ am Lesestand im Verlauf; „Direktnachricht schreiben“ im Mitglieder-Menü (heute nur Moderationspunkte – wer nicht moderiert, sieht an Mitgliedern keinen Knopf). | `frei` | `raeume.ts`, `app.css` |
| C-14 | **Lesestand im Klartext:** `freedom.lastRead` (Kanal-Kennungen mit Zeiten) liegt auch mit Tresor in `localStorage` und verrät, wann jemand welchen Kanal las. Prüfen, ob er über `geheim` gehört (Regel „Geheimnisse nur über `geheim`“), dann `geheimnisse()` ergänzen. | `frei` | `raeume.ts` (`ladeLesestand()`, `merkeLesestand()`), `shell/tresor.ts` |
| C-15 | **Raum-Repos, Rest aus 11.4c** (#195): „Zum Raum“ öffnet auch einen öffentlichen Raum, dem man nicht beigetreten ist, ohne ihn in die Leiste aufzunehmen – dort „Raum beitreten“ anbieten; „Wo“ beim Ankündigen auf der Seite Repos bietet nur private Räume an, öffentliche mit `repos_pflegen` erst in den Einstellungen – beide anbieten; beim Start lädt die Repo-Liste bis zu zweimal, wenn der erste Raum öffentlich ist. | `frei` | `repos.ts`, `raeume.ts` |
| C-16 | **Relay-Stand „verbunden“** (E8, B5 aus `phase-10.md`): Die Navigation zeigt ehrlich „8 Relays im Pool“, weil `WebSocketRelay` den Verbindungsstand privat hält. Ein lesender Getter (klein, kein Format), dann die Zahl der verbundenen zeigen. | `frei` – Spur A ist einverstanden (29.09.): der Getter in `ws-relay.ts` gehört mit zu C-16, nur lesend, ohne Formatänderung | `protocol/src/ws-relay.ts`, `shell/ui.ts` |
| C-17 | **Issues und Kommentare für Repos** („Repos wie GitHub“): NIP-34 kennt Issues (Kind 1621), NIP-22 Kommentare (1111) – weder Protokoll noch App können sie. Reiter „Issues“ und Kommentare an Patches; in privaten Räumen nur als innere Events wie 11.4b. **Entschieden 29.09.2026 (MENSCH): ja – Ziel ist Repos 1:1 wie GitHub.** Aufgeteilt: C-17a Protokoll-Bausteine (Issue, Kommentar, Status für Issues, privat als innere Events; Format in `docs/PROTOCOL.md`), C-17b Reiter „Issues“ (Liste offen/geschlossen, neues Issue, Issue-Seite mit Kommentaren, schließen/wieder öffnen), C-17c Kommentare an Patches. | `fertig` (#199, #200, #201) | `nip34.ts`, `raum-repo.ts`, `repo-seite.ts`, neu `issues-reiter.ts`, `diskussion.ts` – **a bis c fertig**; weiter mit C-20 |
| C-18 | **Smoke-Test in der CI:** Die Browser-Prüfungen (rahmen, dialog, raum, karte, qr, mobil; mehrere Minuten je Lauf) laufen nur lokal bei den Agenten – `.github/workflows/ci.yml` startet keinen Browser. Ein Rückschritt in der Oberfläche fällt so erst beim nächsten lokalen Lauf auf. Aufnehmen braucht Python-Playwright und Chromium im Runner. **Entschieden 29.09.2026 (MENSCH): ja, wenn möglich** – eigener Job „Browser-Test (Smoke)“, Playwright 1.56.0 fest. Erster Lauf in CI grün (alle Teile, rund 4 min). | `fertig (#198)` | `ci.yml`, `scripts/smoke_test.py` |
| C-19 | **Am echten Gerät durchklicken** (offen aus 10.4): alle Seiten am Handy (iOS Safari, Android Chrome) und am Desktop. Safe-Area (Kerbe), Tastatur über dem Eingabefeld (`interactive-widget`), Querformat und die Kamera beim QR-Scannen stellt Chromium im Test nicht echt nach. | `MENSCH` | Vergleichsbilder: `docs/ausbau/bilder/c5b`, `c6b`, `114c` |
| C-20 | **Repos 1:1 wie GitHub – was nach C-17 noch fehlt** (Ziel des MENSCHEN, 29.09.2026). Ohne neues Format, nur aus dem Bundle bzw. vorhandenen Events: Zweige und Tags aus dem Bundle wählen (heute nur der Stand von HEAD); Verlauf einer Datei; Suche im Code (lokal im geladenen Bundle); README als Markdown dargestellt (nur DOM, nie `innerHTML`); Labels und Zuständige an Issues und Patches (`t`- und `p`-Tags nach NIP-34); Benachrichtigungen über neue Issues, Patches und Kommentare in eigenen und beobachteten Repos. Mit neuem oder offenem Format – je Punkt im PR vorschlagen: Reviews mit Kommentaren an Diff-Zeilen und „genehmigt / Änderungen erbeten“; Releases (Tag mit Bundle); Forks (eigene Ankündigung mit Verweis auf das Original); Sterne und Beobachten. Nicht ohne Server: Actions (CI-Läufe) und Pages – höchstens über Provider-Knoten mit Sandbox (8.7), dann Spur A/B. | `frei` (ohne Format) / `Entscheidung` (Format) | `git-bundle.ts`, `code-reiter.ts`, `repo-seite.ts`, `nip34.ts` – **C-20a fertig** (Markdown für README, Issues, Kommentare: `markdown.ts`, `shell/markdown-ui.ts`), **C-20b fertig** (Tabellen, Verweise auf Dateien im Repo, Markdown-Dateien als Vorschau), **C-20c fertig** (Zweig oder Tag wählen), **C-20d fertig** (Verlauf einer Datei, Suche im Code), **C-20e fertig** (Issues nach Label filtern; Labels ändern und Zuständige brauchen NIP-32 – `Entscheidung`), **C-20f fertig** (Benachrichtigungen: Neues seit dem letzten Blick); offen bleibt, was ein Format braucht (Reviews, Releases, Forks, Sterne, Labels ändern, Zuständige) |

**Hinweise von Spur C für die Neuordnung** – die ersten beiden betreffen
andere Spuren und stehen deshalb hier, nicht in deren Abschnitten:

- **Nicht verdrahtete Bausteine:** `scripts/wiring-ausnahmen.txt` führt 158
  begründet ausgenommene Exporte (605 Exporte, 447 verdrahtet). B-3, B-5,
  A-7 bis A-9 nennen einige davon. Für die Neuordnung die Liste einmal ganz
  durchgehen: je Eintrag anbinden (mit eigenem Punkt) oder entfernen.
- **B-7 / E6 und die Raum-Repos:** Seit 11.4c zeigt ein öffentlicher Raum nur
  Repos, deren Adresse zu der Definition passt, die die App anzeigt. Mit
  E6 A (Raum nur über seine Adresse) würde auch „Zum Raum“ genau den Raum der
  Adresse öffnen – heute öffnet `geheZuRaum()` über die Kennung.
- **Zu C-1:** Außer den dort genannten Dateien nutzen auch `shell/app.ts`
  (Schlüssel zeigen per `prompt()`) und `shell/notfall.ts` (`alert()` nach der
  Notfall-Löschung) noch Browser-Dialoge.

---

## 4. Spur A – Netz, Geld, Vertrauen (für die Neuordnung, nicht während der Pause)

| Nr. | Punkt | Status |
|---|---|---|
| A-1 | **Phase 12 „Beide Währungen überall“** (Anhang A): 12.1 Standard-Schiene für alle Bereiche plus Anzeigeeinheit · 12.2 Werbelink mit `sol=` · 12.3 SOL-Adressen für Werber des Providers und Relays · 12.4 KI-Schalter „sats / SOL“, Gebot in gewählter Einheit, ohne Kanal → Kanal anbieten · 12.6 Profil: SOL-Adresse öffentlich nur mit Häkchen · 12.7 Wallet „Senden / Empfangen / Verlauf“. (12.5 ist C-2, 12.8 ist C-3.) | `Entscheidung` E1–E5 |
| A-2 | PR #183 fertigstellen; danach 11.2a (Werbelink mit eigener Domain), 11.2b (kurzer Name, NIP-05). | `fertig` (#183, #205) |
| A-3 | 11.3a–d Agenten in Räumen (Entwurf, Freigabe MENSCH, Protokoll, Gerät, Knoten); 11.5 mit Spur B danach. | `Entscheidung` – Entwurf fertig (`docs/AGENTEN-RAUM-ENTWURF.md`, Fragen F1–F6) |
| A-4 | **Veraltete Aussagen im Code:** `tiers.ts` („38010 beweist das Tier“ – gilt seit 5.5 nicht mehr), Kommentare zum Knappheitsbonus in `node/src/dvm-provider.ts` (fiel mit 5.1.4a). | `fertig` (#205, mit 11.2b; dazu Kopf von `dvm-provider.ts` nach A+ und die Bootstrap-Kommentare – Frage dazu: E7) |
| A-5 | **Zahlung im Chat anfordern** – versiegelt, mit Rechnung oder Adresse, in beiden Währungen. | `fertig` (#213) |
| A-6 | **Belege exportieren** (CSV, nur lokal) und **Quittung für SOL-Hinterlegungen** (HTLC) – heute zählen nur Lightning und Kanal. | Export `fertig` (PR folgt); Quittung für Hinterlegungen: `Entscheidung` E8 – die Hinterlegung wird nie abgerechnet |
| A-7 | **Redundanz-Konsens** (`consensus.ts`, nicht angebunden): dieselbe Frage an 2–3 Provider, Abweichung zeigen – kostet mehrfach, daher Geld-Spur. | `fertig` (#214) – Haken „vergleichen“ je Frage, Standard aus, Kosten vorher bestätigt |
| A-8 | Nicht angebundene Knoten-Bausteine: Cluster-Pairing (`cluster.ts`), Gratis-Schwelle (`network-capacity.ts`), Modelle laden (`model-registry.ts`). | `Entscheidung` E9 |
| A-9 | **Vergütung von Mitwirkenden** (`contributor-funding.ts`, ohne Oberfläche) – in beiden Währungen. | `Entscheidung` E10 |
| A-10 | **Abos:** Relay-Zugang und Speicher automatisch verlängern, über den Zahlkanal mit Obergrenze. | `Entscheidung` E11 |
| A-11 | **Allgemeiner Dienste-Markt** über KI hinaus (Übersetzen, Transkribieren, Rendern): heute sind Angebot und Preis (je 1k Tokens) auf KI zugeschnitten. | `Entscheidung` |
| A-12 | **Gemeinsame Kasse für Räume** (Mehrfachsignatur für SOL) – neues Programm, braucht Audit. | `Entscheidung` |
| A-13 | **Handel zwischen Menschen mit Treuhand** (Sperre wie beim Tausch, Prüfer aus dem eigenen Netz). | `Entscheidung` |

---

## 5. Offene Entscheidungen (MENSCH)

Empfehlung jeweils von Spur B; Begründungen zu E1–E6 standen in der
Entscheidungsvorlage vom 28.09.2026 und sind hier gekürzt.

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| E1 | Welche SOL-Adresse trägt der Werbelink? | A frische aus dem Vorrat · B Hauptadresse · C keine | A (mit Fremd-Wallet B nur nach Warnung) |
| E2 | Event-Format für SOL-Anteile erweitern? (STOPP-Punkt) | A SOL-Tag im Angebot 38027 (`PROVIDER_WERBER_SOL`) + Relay-Adresse aus dem signierten Profil · B Relay-Adresse aus NIP-11 · C nicht | A |
| E3 | KI mit SOL ohne Zahlkanal? | A Kanal anbieten, sonst nichts · B Überweisung je Antwort · C automatisch Lightning | A (C verstößt gegen „nie still ausweichen“) |
| E4 | Eingebaute Lightning-Wallet? | A nein, NWC + Anleitung · B Knoten im Browser (LDK/Breez) · C Cashu | A |
| E5 | Wer baut Phase 12? | A Spur B · B Spur A · C geteilt | nach der Neuordnung |
| E6 | B20: Welche Regel gilt für offene Räume? | A Raum nur über seine Adresse `34700:<besitzer>:space:<kennung>`, nur Definitionen des Besitzers (wie `raumZustandFuer()`) · B zuerst gesehene Definition merken | A – **entschieden 30.09.2026 (MENSCH): A** – offene Räume wie Communities bei Discord (Gründer, Moderatoren, Rollen, Rechte), wie private, nur öffentlich; B-7 |
| L1 | Wie erkennt der Knoten seinen Besitzer? KI-Anfragen kommen absichtlich von Wegwerf-Schlüsseln. | A Kopplungsgeheimnis (QR, im Tresor, nur im versiegelten Kern an den eigenen Knoten) · B Signatur der Identität (neues Tag, STOPP-Punkt) | A – **entschieden 01.10.2026 (MENSCH): A**; B-8 |
| L2 | Darf der Knoten die App ausliefern? | A ja, nur reproduzierbarer Build mit Prüfsumme · B nein | A – **entschieden 01.10.2026 (MENSCH): A**; B-10 |
| L3 | Modelle direkt im Browser (WebGPU)? | A später, eigener Punkt · B jetzt | A – **entschieden 01.10.2026 (MENSCH): A**; B-16 später |
| W1 | Weckdienst per Web Push? Der Push-Dienst des Browserherstellers sieht, *dass* geweckt wird (nicht was). | A ja, über den eigenen Knoten, ohne Inhalt, mit ehrlichem Text · B nein | A – Rückfrage 30.09. beantwortet: nicht nur iOS; native Apps gibt es noch nicht (6.1), bis dahin ist Web Push für jede geschlossene Web-App der einzige Weckweg; auf iOS auch nativ nur über Apple (APNs), native Android- und Desktop-Apps könnten eine eigene Verbindung zum Knoten halten. Baubar erst nach L1 – **entschieden 01.10.2026 (MENSCH): A**; B-12 nach B-8 |
| T1 | Anrufe? WebRTC verrät ohne Vermittler die IP. | A ja, nur über TURN des eigenen Knotens · B nicht jetzt | B – **entschieden 30.09.2026 (MENSCH überlässt Spur B): A** – Ende-zu-Ende (WebRTC verschlüsselt Medien immer, DTLS-SRTP; Fingerabdruck im versiegelten NIP-17-Umschlag, mit B-4 prüfbar), nur über TURN des eigenen Knotens (`iceTransportPolicy: "relay"`, keine IP ans Gegenüber); nach L1, TURN-Abhängigkeit vorher fragen |
| I1 | Mehrere Identitäten auf einem Gerät? | A ja, streng getrennt · B nein | A, nach B-1 bis B-6 – **entschieden 30.09.2026 (MENSCH): B** – nicht nötig; Botschwärme brauchen die Funktion nicht (Schlüssel erzeugt jedes Skript), Trennung privat/Arbeit über getrennte Browser-Profile |
| R1 | Umfragen und Termine (NIP-88, NIP-52) als innere Events privater Räume? | A ja · B nein | A – **entschieden 30.09.2026 (MENSCH): A**; B-15 |
| E7 | Bootstrap-Phase des Knotens (erste 24 h nur gratis): Seit 5.5 entsteht Ruf nur aus Quittungen bezahlter Aufträge – die Gratis-Phase bringt keinen Ruf mehr, sie zeigt nur, dass der Knoten läuft, und hält ihn einen Tag vom Verdienen ab. (Spur A, aus A-4) | A behalten · B streichen (neue Knoten verdienen sofort) · C freiwillig (Schalter beim Einrichten) | C |
| E8 | SOL-Hinterlegung (Deposit, `sol-deposit.ts`): Sperren und Zurückholen gibt es, die Abrechnung nicht – `buildSolDepositSettle()` ruft weder App noch Knoten, der Provider bekommt aus einer Hinterlegung nie Geld. Eine Quittung dafür (A-6) setzt die Abrechnung voraus. Seit 4.3 zahlt der Zahlkanal SOL je Antwort. (Spur A, aus A-6) | A Abrechnung bauen (Knoten legt den Verbrauch offen, App gibt das Preimage des Verbrauchs-HTLC frei, Quittung „belegt“ mit der Einlösung auf der Kette) · B Hinterlegung für KI entfernen, nur noch Zahlkanal · C so lassen | B |
| E9 | A-8, drei Bausteine ohne Anbindung: **Cluster-Pairing** (zwei Knoten rechnen ein großes Modell gemeinsam – wer bezahlt wen, wer haftet für die Antwort?), **Gratis-Schwelle** aus der Netzkapazität (wie viel darf ein Provider verschenken, ohne dass es das Preisgefüge nach A+ verzerrt?), **Modelle laden** mit Prüfsumme (`model-registry.ts`: welche Quellen, wer signiert die Summen?). (Spur A) | A alle drei entwerfen (eigene Vorlage) · B nur „Modelle laden“ (klar umrissen, Quelle Ollama + Prüfsumme aus einem Katalog 38080) · C entfernen | B – die beiden anderen berühren das Geldmodell |
| E10 | A-9: `contributor-funding.ts` verteilt rückwirkend einen **Topf** – A+ kennt keinen Topf, und die Entwicklung bekommt schon 2,5 % jeder Zahlung (`ENTWICKLUNG`). (Spur A) | A Runden aus dem Entwicklungs-Anteil (wer verteilt, ist dann der Empfänger von `ENTWICKLUNG`) · B nur Kopfgelder, die jemand ausdrücklich zahlt (Zahlung direkt an den Mitwirkenden, kein Topf) · C entfernen | B |
| E11 | A-10: Abos über den Zahlkanal setzen voraus, dass Relays und Speicherknoten Gutschriften annehmen – heute nimmt nur der KI-Provider welche (`KanalKasse`), die Relay-Kasse kennt nur Rechnung und Überweisung (8.4b). Das ist ein neues Format. (Spur A) | A Zahlkanal für Relays und Speicher (neues Format, eigene Karte) · B Verlängern per Erinnerung + ein Klick (keine automatische Zahlung) · C nicht | B – kein neues Format, nie Geld ohne Klick |
| S1 | B-2: Was heißt ein Repo „nur auf diesem Gerät“? (Spur B, aus B-2) | A Bundle nur im Browserspeicher, Ankündigung geht trotzdem hinaus (andere sehen das Repo, laden es aber nicht) · B das ganze Repo bleibt lokal (eigene lokale Liste, nichts auf Relays – neue Speicherstelle, Notfall-Löschung erweitern) · C nicht bauen: eigener Speicher über „Mein Knoten“ (B-9), mitnehmen über den Export (B-6) | C – **entschieden 30.09.2026 (MENSCH): B mit Wechsel** – Repo auf „privat, nur dieses Gerät“ schaltbar (nichts auf Relays), später auf „öffentlich, dezentral gespeichert“; B-2 |

---

## 6. Nur der MENSCH

| Nr. | Punkt |
|---|---|
| M-1 | **0.G** Programm-ID abgleichen (Code `B6W19U…`, laut `DEPLOY.md` deployt `3UmRR…`). |
| M-2 | **Deploy des Zahlkanals** (`KANAL_PROGRAMM_ID` ist ein Platzhalter) – ohne M-1 und M-2 keine KI-Zahlung mit SOL. |
| M-3 | Adressen der Entwicklung (`ENTWICKLUNG` in `aufteilung.ts`), Testnet-Test der Zahlung (aus 5.1). |
| M-4 | Konten der Spiegel (`docs/KONTEN.md`, 5.3). |
| M-5 | **0.D** signierte Releases (erst dann schützt die Echtheitsprüfung aus 5.2 wirklich) · **0.E** Wallet-Erweiterungen unter CSP · **5.1b** gesponserte Pools (Devnet-Deploy). |
| M-6 | 8.16: Durchsicht der englischen Texte; Website auf Englisch? |
| M-7 | GX10-Knoten auf den aktuellen `main` bringen. |
| M-8 | **9.1–9.5** Audit, Devnet-Beta mit Bug-Bounty, Mainnet, Rechtliches und AI-Act, Release 1.0 · **6.1** native Apps mit Tor. |

---

## Anhang A – Befund: Sats und SOL (28.09.2026)

Die App hat einen Schalter („Standard-Schiene“, `standard-schiene.ts`) – er
gilt nur für Zaps und Trinkgeld.

| Funktion | Sats | SOL | Lücke |
|---|---|---|---|
| Werber-Anteil des Kunden (0,5 %) | ✓ Link mit `ln=` | ✗ | kein `sol=` im Werbelink (`werbung.ts`) |
| Werber-Anteil des Providers (0,5 %) | ✓ | ✗ | Angebot nennt nur `PROVIDER_WERBER_LUD16` (`node/src/main.ts`) |
| Relay-Anteil (1,5 %) | ✓ | ✗ | nur `lud16` aus dem Betreiberprofil (`relay-zahlziel.ts`) |
| Entwicklung (2,5 %) | leer | leer | M-3 |
| Hosting (1 %) | ✓ | ✓ | – |
| KI bezahlen | ✓ | ✓ nur Kanal | kein Schalter; mit Kanal SOL, sonst Lightning; Gebot immer in sats |
| KI-Sitzung, Anteile-Kasse (Anzeige) | ✓ | teilweise | Anzeige nur in sats |
| Einnahmenliste (Earn) | ✓ | ✗ | C-2 |
| Profil: öffentliche Adresse | ✓ mit Häkchen | ✗ | kein SOL-Feld |
| Zaps / Trinkgeld, versiegelt anfragen, Relay-Zugang, Tausch | ✓ | ✓ | – |
| Wallet: Senden, Empfangen, Verlauf | ✗ | teilweise | Lightning nur verbinden; SOL ohne Online-Senden und Verlauf |
| Eingebaute Wallet | ✗ (NWC) | ✓ | E4 |
| Ohne Internet zahlen / KI über Funk | Hinweise / ✗ | ✓ / ✓ | grundsätzlich |
| Speicher bezahlen (8.9c) | offen | offen | B-18 |
| Reklamation, Dashboard der Website | ✓ | ✗ | Anzeige nur in sats (C-3) |

**Folge:** Bei einer KI-Zahlung per Zahlkanal findet `kanalEmpfaenger()` nur
SOL-Adressen – heute höchstens die des Hostings. Nach der Regel „nicht
zuordenbar → Provider“ bekommt der Provider fast alles; wer mit SOL zahlt,
bringt seinem Werber und den Relays nichts.

## Anhang B – Befund: Lokal-Modus (29.09.2026)

- `local-tools.ts`: Browser → Ollama direkt (`localInfer`, `localOllamaUp`)
  ist gebaut und getestet, aber nirgends in der App angebunden (→ B-1).
- Eigener Provider: `freedom.allowlist`, gesetzt nur über `?provider=` bzw.
  `?pk=` (`shell/app.ts`). Er wird bevorzugt, läuft aber über fremde Relays
  und wird bezahlt.
- Der Knoten kann Provider, Relay (`RELAY_ENABLED`) und Speicher
  (`STORAGE_ENABLED`) zugleich sein; er kennt keinen Besitzer (→ B-8).
- Git-Bundles und Anhänge gehen als verschlüsselte Stücke an die Relays,
  Speicherknoten holen sie dort ab; eigene Uploads bleiben im Browserspeicher.
- **Hürde:** Die App läuft über https. Von dort erlauben Browser
  unverschlüsselte Verbindungen nur zu `localhost`, nicht zu `ws://…` im
  Heimnetz – deshalb B-10 (Knoten liefert die App aus) oder ein Zertifikat.

Zielbild: In der Modellwahl „Wo rechnet die KI? Netz / Mein Knoten / Dieses
Gerät“, beim Speichern „Netz / Mein Knoten / nur dieses Gerät“, dazu „Alles
über meinen Knoten“. Keine eigene Seite.

## Anhang C – Listen, die beim Aufräumen zusammengeführt werden

Diese Dateien enthalten eigene Listen, Pläne oder Stände; sie wurden zuletzt
meist am 24.09. geändert und widersprechen sich oder dem Code teilweise.

| Datei | Inhalt |
|---|---|
| `README.md` | Projektbeschreibung mit Funktionsliste |
| `START-HIER.md`, `START.md`, `ANFANGEN.md` | drei Einstiege |
| `AGENT_HANDOFF.md`, `CHANGELOG-OPUS.md` | alte Übergabe und Änderungsliste |
| `LUECKEN.md` | „Was dem Protokoll noch fehlt“ – nennt z. B. Spamschutz (A3) und Zusammenführung (C2) „gebaut“; die Bausteine gibt es, verdrahtet sind sie nicht (→ B-3, B-5) |
| `GO-LIVE.md`, `ABSCHLUSSPRUEFUNG.md` | Startlisten |
| `docs/ROADMAP.md`, `docs/PROJECT-PLAN.md`, `docs/ANALYSIS.md`, `docs/UI-UPGRADE.md` | ältere Pläne und Analysen |
| `docs/ausbau/UEBERSICHT.md`, `docs/ausbau/FORTSCHRITT.md`, `STATUS.md` | aktueller Ausbauplan und Protokoll – gelten bis zur Neuordnung weiter |
| `packages/website/roadmap.html` | öffentliche Roadmap |
