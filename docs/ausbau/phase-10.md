# Phase 10 – Oberfläche (Spur C)

Rückmeldung des MENSCHEN (27.09.2026): Die Funktionen sind gebaut, die
Oberfläche ist es nicht. Diese Phase baut **nur Oberfläche** auf den
vorhandenen Bausteinen – Räume wie Discord, Repositories wie GitHub, eine
Karte der Abdeckung und eine Navigation, die auf Desktop und Handy je für sich
Sinn ergibt. Protokoll, Krypto, Zahlungen und Event-Formate bleiben, wie sie
sind; sonst gilt die STOPP-Regel aus `CLAUDE.md`.

Stand dieser Karte: **C.0, C.1a, C.1b, C.2a und C.2b1 fertig.** Der MENSCH hat den
Entwurf am 27.09.2026 freigegeben – E1–E8 wie vorgeschlagen (Abschnitt 10.3).
Nächster Schritt: C.2b2.

---

## 10.0 Bestandsaufnahme (C.0)

### Wie aufgenommen

- `node build.mjs`, dann `dist/freedom.html` in Chromium (Playwright) wie
  `scripts/smoke_test.py`: frisches Profil, `locale="de-DE"`, **jeder Zugriff
  nach außen gesperrt** (keine Relays, kein RPC). Merkphrase bestätigt,
  Einrichtung übersprungen; für die Ansichten die Onboarding-Leiste ausgeblendet
  (sonst am Desktop leer, B1). Neue Identität je Größe, Wegwerf-Schlüssel.
- Desktop 1280×800 und Mobil 390×844 (`is_mobile`, Touch), jede Seite und jeder
  Unter-Reiter. Zusätzlich 800×900 für die Sichtbarkeitsprüfung.
- Bilder in `docs/ausbau/bilder/c0/`:
  - `uebersicht-desktop.jpg` und `uebersicht-mobil.jpg` – alle 21 Ansichten je Größe;
  - `befund-desktop-leiste.jpg` – Befund B1;
  - `heute-raum-desktop.jpg`, `heute-repos-desktop.jpg`, `heute-karte-desktop.jpg` –
    die drei Bereiche, die neu entstehen.

  Der Sicherungsdialog beim Start ist nicht abgelegt: Er zeigt eine Merkphrase,
  auch wenn sie nur zum Wegwerfen war.

  Stand der Bilder: `main` nach 4.3d1. Die Karte „Zahlkanal“ unter
  „Liquidität“ (4.3d2) fehlt darin; die Tabellen unten sind nach 4.3d2 gezählt.

### Was es heute gibt – je Tab

Oberfläche in `packages/app/src/shell/index.html`, Umschalten mit
`switchTab()` (`shell/app.ts:463`), Unter-Reiter mit `wireSubtabs()`
(`shell/app.ts:443`). Pfade unten relativ zu `packages/app/src/`.

**Agent** (`#page-ai`, `index.html:50`) – links Seitenleiste, Mitte Chat, rechts Arbeitsbereich

| Funktion | Bedienelemente | Code |
|---|---|---|
| Neue Aufgabe, Verlauf | `#agent-new`, `#agent-history` | `shell/tabs/agent.ts:253` `neueAufgabe()`, `:213` `zeigeVerlaeufe()` |
| Prüfaufträge (als Prüfer) | `#pruefauftraege` | `shell/pruefauftraege-ui.ts:54` |
| eigene Reklamationen | `#reklamationen` | `shell/streitfall-ui.ts:49`, `:70`; reklamieren `agent.ts:1049` |
| Modelle im Netz, vorhalten, ankündigen | Unter-Reiter „Modelle“ | `shell/tabs/agent-netz.ts:27`, `:95`, `:65` |
| Modellkataloge (NIP-51) | `#kataloge-*` | `agent-netz.ts:162`, `:243` |
| Git-Bundles (38042) hochladen, laden | Unter-Reiter „Repos“, `#git-repo-*` | hochladen `shell/app.ts:748`, Liste `agent-netz.ts:266` |
| Repos nach NIP-34: ankündigen, Patch senden, annehmen/schließen/zurückziehen | `#nip34-*` | `shell/tabs/repos.ts:38`, `:141`; Zeilen `repo-ansicht.ts` |
| Gratis-Kontingent | `#nb-quota` | `shell/ui.ts:54` |
| Anfrage stellen (auch Rennen, Schwarm, Video) | `#ai-prompt`, `#ai-send` | `agent.ts:372`, `:444`, `:589`, `:631`, `:536` |
| Anhänge, Werkzeuge mit Preisen | `#attach-*`, `.tool-chip` | `agent.ts:1388`, `:1346`, `:1329` |
| Stufe, Modell, Gebot, Gebühr, Budget | `#ai-tier`, `#ai-model-btn`, `#ai-bid` | `agent.ts:141`, `:65`, `:289`, `:951` |
| Kopieren | `#copy-last`, `#copy-all` | `shell/app.ts` |
| Arbeitsbereich, Werkzeuge, Kosten | `.agent-panel` | `agent.ts:267` |
| Abrechnung je Antwort | Blase unter der Antwort | `agent.ts:1109`, `shell/ki-zahlung.ts` |

**Kommunikation** (`#page-comm`, `index.html:205`) – schon im Aufbau „Leiste, Kanäle, Verlauf, Mitglieder“

| Funktion | Bedienelemente | Code |
|---|---|---|
| Leiste: Direktnachrichten, Räume, anlegen, beitreten | `.comm-rail` | `shell/tabs/kommunikation.ts:87`, `:780`, `:791` |
| Direktnachrichten (NIP-17 bzw. MLS) | `#chat-list`, `#chat-thread`, `#chat-input` | `:995`, `:1440`, `:1537`, `:1618`, neu `:1625` |
| Namen für Kontakte | Klick auf den Namen | `:971` `setzePetname()` |
| Lokale Suche | `#chat-suche` | `shell/suche-ui.ts:57` |
| Anhänge, Ablauf (NIP-40) | `#chat-media-btn`, `#chat-ablauf` | `:679`, `:1078` |
| Zap | `#chat-zap` | `shell/app.ts:679`, `chat-zap.ts:31` |
| Post als Datei mitnehmen/einlesen (Mesh) | `#chat-mesh-*` | `shell/app.ts:697` |
| „Communities“ (offen, Kind 42 mit `h`) | `#chat-new-community` | `:1651`, Moderation `:1095` |
| Raum öffnen, Kanäle, Kanal | `#space-rail`, `#channel-list`, `#channel-thread` | `:110`, `:169`, `:211` |
| senden | `#space-msg` | `:398` |
| Raum anlegen (privat = MLS, offen = 34700/42) | `#space-create`, `#space-create-public` | `:434`; privat `shell/raum-mls.ts:57` |
| einladen (privat) | `#space-invite` | `:487`; `raum-mls.ts:91` |
| löschen, entfernen, melden (privat) | Knopf an der Nachricht | `:298`; `raum-mls.ts:133`, `:138`, `:146` |
| ausblenden, sperren (offen) | Knopf an der Nachricht | `:513` |
| Meldungen an Moderatoren | `#raum-meldungen` | `:327` |
| Mitglieder mit Rollen | `#member-list` | `:359` |
| Moderatoren ernennen | `#space-mods` | `:561`; privat `raum-mls.ts:122` |
| beitreten, Rauminfo | `#space-join`, `#space-info` | `:605` |

**Währung** (`#page-wallet`, `index.html:298`)

| Funktion | Bedienelemente | Code |
|---|---|---|
| Guthaben sats/SOL, „Wallet verbinden“ | `#nav-balances` | `shell/ui.ts:61`, `shell/app.ts:659` |
| Lightning über NWC | `#nwc-*` | `shell/tabs/waehrung.ts:734`, `:790` |
| Solana-Wallet verbinden, Kurs | `#sol-connect`, `#kurs-info` | `waehrung.ts:664`, `shell/marktkurs.ts` |
| Eingebaute SOL-Wallet | `#solw-*` | `shell/eingebaute-wallet.ts:86`, `:251` |
| Ohne Internet zahlen (Nonce) | `#solo-*` | `shell/offline-zahlung.ts:14`, `:93` |
| Tauschen in beide Richtungen, einlösen, Preimage-Sicherung | Unter-Reiter „Tauschen“ | `waehrung.ts:39`, `:127`, `:374`, `:524`, `:599` |
| SOL beim Provider hinterlegen, zurückholen | Unter-Reiter „Liquidität“ | `waehrung.ts:817`, `:953` |
| SOL-Zahlkanal öffnen, offene Kanäle (seit 4.3d2) | „Liquidität“, `#kanal-*` | `shell/zahlkanal-ui.ts:32`, `:91` |

**Earn** (`#page-earn`, `index.html:406`)

| Funktion | Bedienelemente | Code |
|---|---|---|
| Einnahmen | Unter-Reiter „Übersicht“ | `shell/tabs/earn.ts:183` |
| App verbreiten (nur Text) | „Hosten“ | – |
| Werbelink, Nennungen | „Werben“ | `earn.ts:210`, `:231`, `:252` |
| Mitwirkende (38056) | „Werben“, zweite Karte | `earn.ts:18` |
| Abdeckung: Liste, eintragen, austragen | „Karte“, `#coverage-*` | `earn.ts:45`, `:90`, `:128`; verdrahtet `shell/tabs/settings.ts:735` |

**Profil** (`#page-profile`, `index.html:452`)

| Funktion | Bedienelemente | Code |
|---|---|---|
| Profilkarte, bearbeiten, teilen | `#profile-card`, `#pf-*` | `shell/tabs/profil.ts:56`, `:110`; teilen `shell/app.ts:800` |
| Vertrauensstufe (XP des Providers) | `#trust-*` | `earn.ts:150` |
| Abzeichen ansehen, vergeben | `#badge-*` | `profil.ts:204`, `:18` |
| Identität exportieren, importieren | `#nb-ident`, `#nb-import` | `shell/app.ts:319`, `:329` |

**Settings** (`#page-settings`, `index.html:512`) – eigene Seitenleiste mit sieben Bereichen

| Bereich | Inhalt | Code |
|---|---|---|
| Sicherheit | fünf Schritte; Tresor; Sicherung, Diebstahl, Widerruf; Nachfolge; Notfall-Löschung | `settings.ts:775`, `:144`, `:178`, `:249`, `:284`, `:34`; `shell/tresor.ts:327`; `shell/nachfolge-ui.ts:87`; `shell/notfall.ts:129` |
| Geräte | Geräte, Bunker (NIP-46) | `settings.ts:337`, `:380`, `:415`; `shell/bunker.ts:79` |
| Verbindung | Solana-Endpunkte, eigene Relays, Relay-Zugang kaufen | `shell/state.ts:202`; `settings.ts:1101`, `:1021` |
| Datenschutz | Netzmodus, .onion-Prüfung, Kontakte abgleichen, Verzögerung, Bericht, MLS-Selbsttest | `shell/datenschutz.ts:49`; `settings.ts:639`, `:646`, `:668`, `:689` |
| Gebühren | Aufteilung, fällige Anteile, Standard-Schiene | `settings.ts:969`, `:658` |
| Mesh | USB, Bluetooth, Datei, Warteschlange | `settings.ts:551`, `:753`, `:765` |
| Weitergeben | App exportieren, Echtheit prüfen | `settings.ts:813`, `:892` |
| Sprache | `#lang-btn-app` | `shell/app.ts:507` |

**Rahmen:** Kopfzeile nur mobil (Guthaben, Schlüssel, „Importieren“),
Navigation `.app-nav` (`index.html:691`: mobil unten, ab 1024 px als Leiste),
Hinweisleisten `#offline-hinweis`, `#onboarding-bar`, `#backup-warn`,
Einrichtung als Overlay (`shell/einrichtung-ui.ts`).

### Befunde

Nummeriert, damit die Teilschritte sie nennen können. „Gemessen“ heißt: mit
Playwright nachgeprüft (Sichtbarkeit und Maße der Elemente).

| Nr. | Schwere | Befund | Ursache | Teilschritt |
|---|---|---|---|---|
| B1 | hoch | **Desktop: Solange die Onboarding-Leiste sichtbar ist, ist die App leer.** Gemessen: `main` hat die Breite 0, die Navigation steht rechts. Das trifft jeden neuen Nutzer am Desktop, bis er „Später“ wählt (Bild `befund-desktop-leiste.jpg`). Spur A sah dasselbe in 4.3d2 (Währungs-Seite 28 px breit). | `#app` ist ab 1024 px eine Flex-Zeile; die Leiste ist dort ein Geschwister von `main` und nimmt die Breite. `#app > nav { order: 0 }` (`app.css:401`) überstimmt `.app-nav { order: -1 }` (`app.css:931`). | C.1a |
| B2 | hoch | **Mobil (unter 860 px) sind Verlauf, Modelle, Kataloge, Repos, Prüfaufträge, Reklamationen und das Gratis-Kontingent nicht erreichbar.** Arbeitsbereich, Werkzeuge und Kosten erst ab 1200 px. | `app.css:1059–1060` blenden `.agent-panel` und `.agent-side` aus, ohne anderen Weg dorthin. | C.1a |
| B3 | hoch | **Unter 1100 px fehlt die Mitgliederliste – und mit ihr die Meldungen an Moderatoren** (`#raum-meldungen` steht in `.member-col`). Ein Moderator am Handy sieht keine Meldung. | `app.css:1093` | C.2d |
| B4 | mittel | Mobil ist die Sprachwahl der App nicht erreichbar (nur auf dem Startbild). | `.settings-lang` in der waagrechten Leiste nicht sichtbar | C.1a |
| B5 | mittel | Die Navigation zeigt „8“ mit grünem Punkt und dem Titel „Relays verbunden“ – auch ganz ohne Netz. Gezählt wird die Größe des Pools, nicht die Verbindungen. Nicht ehrlich (Definition of Done 5). | `shell/ui.ts:145–158` | C.1a |
| B6 | mittel | Drei Arten von Gruppen: „Communities“ (Knopf in der Liste der Direktnachrichten, offen, Kind 42 mit `h`), offene Räume (34700 + 42) und private Räume (MLS). Die Community ist öffentlich, ohne dass es dort steht. | `kommunikation.ts:1651` | E3 |
| B7 | mittel | Räume werden über `prompt()`/`confirm()`/`alert()` bedient (21 Stellen in `kommunikation.ts`): Moderation „1 oder 2“ (`:306`), Einladen per Nummer aus einer Liste (`:492`), Moderatoren als Nummern mit Komma (`:573`), Meldegrund als getipptes englisches Wort (`:311`). | – | C.2b |
| B8 | mittel | **„n Antworten“ an einer Nachricht tut nichts** – der Knopf hat keinen Handler; Threads sind nicht zu öffnen, Antworten nicht zu schreiben. Das Protokoll kann beides (`raumNachricht({ threadRoot, replyTo })`, `buildThreads()`), `sendePrivat()` reicht es nur nicht durch (`raum-mls.ts:83`). | `kommunikation.ts:239` | C.2c |
| B9 | mittel | Im Raum stehen gekürzte Schlüssel statt Namen (`kommunikation.ts:254`, `:370`, `:391`), obwohl Namen für Kontakte bekannt sind (`kontaktName()`). | – | C.2b |
| B10 | mittel | Repos in zwei getrennten Listen unter „Agent“: Git-Bundles (38042) und NIP-34 – ohne Verbindung. Patches ohne Diff, der Commit beim Annehmen per `prompt()` (`repos.ts:112`). Beim Hochladen steht im Bundle-Verweis immer `head: local`, `branch: main` (`app.ts:770`). | – | C.3 |
| B11 | klein | Rohe Texte am Bundle-Upload: „publiziere …“, „… publiziert“, „git-fehler“ (`app.ts:765`, `:774`, `:777`), „⇩ bundle“ (`agent-netz.ts:286`). `rohtexteImCode()` erkennt einzelne klein geschriebene Wörter nicht. | – | C.3a |
| B12 | mittel | Keine Karte: eine Liste mit höchstens 15 Gebieten (`earn.ts:69`). Eigene Einträge tragen `region: ""` (`earn.ts:112`), die Liste zeigt dann „?“. | – | C.4a |
| B13 | mittel | Der eigene Standort liegt **genau** und im Klartext in `localStorage` (`freedom.coverage.cell`, `earn.ts:107`) – auch mit Tresor. Gebraucht wird nur die Zelle. | – | E6 |
| B14 | mittel | Anordnung: Repos und Modelle unter „Agent“; Mesh unter „Settings“, Zahlen ohne Netz unter „Währung“, Post als Datei in der Liste der Direktnachrichten; Karte unter „Earn“; Mitwirkende unter „Earn › Werben“; Vertrauensstufe des Providers im Profil; Gebühren und Standard-Schiene in den Settings; der Reiter „Liquidität“ enthält das Hinterlegen beim Provider und seit 4.3d2 den Zahlkanal, keine Liquidität. | – | C.1b, C.6 |
| B15 | klein | Mobil wird „Kommunikation“ in der unteren Leiste zu „KOMMUN…“ gekürzt. | – | C.1a |
| B16 | klein | Nach jeder KI-Antwort verdrahtet `handleAnswer()` Knöpfe erneut (`agent.ts:877–894`, wie schon `app.ts:826–848`) – harmlos, aber überflüssig. | Datei der Spur A | später (nach 4.3d) |
| B17 | klein | Rauminfo und der Titel der Vertraulichkeit zeigen den deutschen Satz aus `privacyInfo()` auch in der englischen Oberfläche (`kommunikation.ts:228`, `:641`). | 8.16g2b2 (Spur B) hat den Satz nicht übernommen | C.2b2 |

---

## 10.1 Entwurf

### Grundsätze

1. **Eine Aufgabe, ein Ort.** Jede Funktion steht an genau einer Stelle; wo
   eine andere Seite sie braucht, verweist sie dorthin (Link statt Kopie).
2. **Desktop und Mobil je für sich.** Desktop: Leiste links, Seiten mit
   Spalten. Mobil: untere Leiste, eine Ebene zur Zeit, Unterseiten mit
   Zurück-Knopf – nichts nur ausblenden, ohne einen anderen Weg zu bieten.
3. **Aufbau wie Discord bzw. GitHub, Aussehen eigen.** Grün (`--accent`), dunkel,
   eigene Symbole aus `icons.ts`; keine fremden Logos, Namen oder Markenfarben.
4. **Bestehendes bleibt verdrahtet.** Umziehen heißt DOM-Blöcke verschieben,
   IDs bleiben – `einrichtung-ui.ts` löst die Handler der Settings über ihre IDs
   aus (Fallstrick „Einrichtung setzt über die Bedienelemente der Settings“).
   Reines Verschieben immer getrennt von inhaltlichen Änderungen.
5. **Dialoge statt `prompt()`.** Ein gemeinsamer Baustein `shell/dialog.ts`
   (DOM und `textContent`, `role="dialog"`, `aria-modal`, Fokus bleibt im
   Dialog, Esc schließt, Fokus kehrt zurück). Die heutigen Einzel-Dialoge
   (`tresor.ts:90`, `eingebaute-wallet.ts:61` …) bleiben, bis ihr Bereich dran ist.
6. **Keine Anwesenheit, keine neuen Metadaten.** Kein „online“, kein
   „schreibt gerade“, keine Lesebestätigungen – der Lesestand bleibt lokal
   (`kommunikation.ts:41`).
7. **Adressen ohne Kennungen.** Die Seite steht in der Adresse (`#/raeume`,
   `#/repos`), nie eine Kennung (Kontakt, Raum, Repo, Patch) – auch nicht in
   `history.state`. Der Browserverlauf ist ein Speicher, den die
   Notfall-Löschung nicht leeren kann (Fallstrick „Lokale Daten nur mit
   Präfix“). Was offen ist, hält die App im Speicher; Zurück führt eine Ebene
   hinauf.

### Seiten und was wohin kommt

| Seite | Inhalt | kommt aus | Datei heute |
|---|---|---|---|
| **Agent** | Chat, Verlauf, Arbeitsbereich; Unterseiten „Modelle“ (Modelle, Kataloge) und „Reklamationen“ (eigene, Prüfaufträge) | Agent | `agent.ts` (Spur A), `agent-netz.ts`, `streitfall-ui.ts`, `pruefauftraege-ui.ts` |
| **Kommunikation** | Leiste mit Direktnachrichten und Räumen, Kanäle, Verlauf, Mitglieder | Kommunikation | `kommunikation.ts`, neu `tabs/raeume.ts` |
| **Repos** (neu) | Liste, Repo-Seite, Patches als Pull Requests, Mitwirkende | Agent › Repos, Earn › Werben (Mitwirkende) | `repos.ts`, `agent-netz.ts:266`, `earn.ts:18` |
| **Währung** | Übersicht, Tauschen, Hinterlegen, Ohne Internet, Zahlen (Standard-Schiene, Aufteilung, Anteile) | Währung, Settings › Gebühren | `waehrung.ts` (Spur A), `settings.ts:969` |
| **Netz** (neu) | Abdeckungskarte, Mesh (Funk, Bluetooth, Datei, Warteschlange) | Earn › Karte, Settings › Mesh | `earn.ts:45`, `settings.ts:551` |
| **Verdienen** (heute „Earn“) | Einnahmen, Vertrauensstufe, Hosten, Werben | Earn, Profil (Vertrauensstufe) | `earn.ts` |
| **Profil** | Profil, Abzeichen, Identität | Profil | `profil.ts` |
| **Settings** | Sicherheit, Geräte, Verbindung, Datenschutz, Weitergeben, Sprache | Settings | `settings.ts` |

Umzüge, die Dateien der Spur A berühren (Währung › Zahlen, Agent), kommen erst
nach 4.3d (Teilschritt C.6).

### Desktop (ab 1024 px)

```
+--------+-------------------------------------------------------------+
| [F]    |  Seite, z. B. Kommunikation:                                |
|--------|  +-----+------------+-----------------------+-------------+ |
| Agent  |  | DM  | Raum    v  | # allgemein   Suche M | MODERATOREN | |
| Komm.  |  |-----|------------|-----------------------|   Ana       | |
| Repos  |  | R1  | # allgemein| Ana  10:02            | MITGLIEDER  | |
| Währung|  | R2  | # ankündig.|  Hallo zusammen       |   Ben       | |
| Verdie.|  | [+] | * intern   |  > Antwort an Ana     |   Cem       | |
| Netz   |  |     |            |  [Nachricht ...]      |             | |
|        |  +-----+------------+-----------------------+-------------+ |
| Profil |                                                             |
| Setting|                                                             |
| * 8    |                                                             |
+--------+-------------------------------------------------------------+
  * = Schloss (privat) bzw. Relay-Stand, M = Mitglieder ein/aus
```

- Leiste 72 px wie heute, Symbole mit Beschriftung; oben die Arbeitsseiten,
  unten Profil (eigenes Bild), Settings und der Relay-Stand.
- Hinweisleisten (Onboarding, Sicherung, offline) liegen **über dem Inhalt der
  Seite**, nicht neben ihm (B1).
- Agent: Seitenleiste mit Reitern wie heute; das rechte Feld ab 1200 px.

### Mobil (unter 1024 px, geprüft bei 390 px)

```
+----------------------------+    +----------------------------+
| [F] FREEDOM   120 sats (o) |    | < Mehr                     |
|----------------------------|    |----------------------------|
|                            |    | Repos                    > |
|  Seite                     |    | Netz: Karte und Mesh     > |
|  (eine Ebene zur Zeit)     |    | Verdienen                > |
|                            |    | Profil                   > |
|                            |    | Settings                 > |
|----------------------------|    | Sprache: DE              > |
| Agent  Chat  Währung  Mehr |    | * 8 Relays im Pool         |
+----------------------------+    +----------------------------+
  (o) = eigenes Bild, führt zum Profil
```

- Untere Leiste mit vier Zielen: **Agent · Chat · Währung · Mehr** (E1).
  „Chat“ ist ein eigener kurzer Text für die Leiste (B15); der Titel der Seite
  bleibt „Kommunikation“.
- Kopfzeile: Logo, Guthaben (führt zu „Währung“), eigenes Bild (führt zum
  Profil). „Importieren“ verschwindet aus der Kopfzeile – es steht im Profil.
- „Mehr“ ist eine Seite mit Zeilen; jede öffnet eine Unterseite mit „‹ Zurück“.
- Agent mobil: oben zwei Knöpfe „Verlauf“ und „Modelle“, die die heutige
  Seitenleiste als Unterseite öffnen (B2); „Reklamationen“ darin.
- Kommunikation mobil wie Discord: Leiste + Kanäle → Kanal (Vollbild) →
  Mitglieder bzw. Thread als Unterseite (B3).

### Räume (Discord-Aufbau) – C.2

Heute steht das Gerüst (Leiste, Kanäle, Verlauf, Mitglieder; Bild
`heute-raum-desktop.jpg`), die Bedienung fehlt.

- **Leiste:** Direktnachrichten oben, darunter die Räume als runde Knöpfe mit
  Anfangsbuchstaben; privat mit Schloss, offen mit Weltkugel; ein Punkt bei
  Ungelesenem. Darunter „Raum anlegen“ und „Raum beitreten“. Pfeiltasten
  bewegen den Fokus in der Leiste (ein Tab-Halt, `aria-current`).
- **Kanalspalte:** Kopf mit Raumname und Menü ▾: Einladen, Kanal anlegen,
  Moderatoren, Rauminfo und Datenschutz (Text aus `privacyInfo()` im Dialog
  statt `alert()`). Einträge je nach Recht: privat entscheidet
  `raum.admins`, offen `can(…, "moderieren" | "rollen_vergeben")`.
  Kanäle mit `#` (offen) bzw. Schloss, Erwähnungen als Zahl, sonst ein Punkt
  (`unreadBadges()`).
- **Verlauf:** Nachrichten nach Absender und Zeit gruppiert (wer in wenigen
  Minuten mehrfach schreibt, erscheint einmal), Name aus `kontaktName()`, sonst
  gekürzter Schlüssel. Trennlinie „Neu“ am lokalen Lesestand.
  An jeder Nachricht (bei Mausberührung **und** bei Tastaturfokus) ein kleines
  Menü: **Antworten**, **Thread**, **Löschen** (eigene), **Moderieren** bzw.
  **Melden**. Dieselben Wege wie heute: privat `loescheImRaum()`,
  `entferneAusRaum()`, `meldeImRaum()`; offen `moderiere()` – nie öffentliche
  Sperr-Events für private Räume.
- **Antworten und Threads:** „Antworten“ zeigt über dem Eingabefeld „Antwort
  an …“ mit ×; gesendet wird mit `replyTo` (und `threadRoot` der Wurzel). Im
  Verlauf steht über der Antwort eine Zeile mit dem Anfang der beantworteten
  Nachricht. „Thread“ öffnet rechts eine Spalte (mobil eine Unterseite) mit
  `buildThreads()`; dort schreibt man in den Faden. Offene Räume über
  `buildChannelMessage({ threadRoot, replyTo })`, private über
  `raumNachricht()` – `sendePrivat()` bekommt dafür zwei freiwillige Felder
  (nur App, das Format gibt es schon).
- **Mitglieder:** nach Rolle gruppiert – Moderatoren, eigene Rollen,
  Mitglieder; je Zeile ein Menü: zum Moderator machen bzw. zurücknehmen
  (`setzeModeratoren()`, ein Commit), entfernen (`entferneAusRaum()`), Rolle
  vergeben (offen: `buildRoleGrant()`), Direktnachricht schreiben. Meldungen
  stehen oben in der Spalte, nur für Moderatoren, nur aus dem Speicher.
- **Dialoge statt `prompt()`:**
  - Einladen: Kontakte mit Suche und Häkchen, dazu ein Feld für npub/hex;
    Ergebnis je Person über `einladungsText()`.
  - Moderatoren: Mitglieder mit Häkchen.
  - Moderieren: „Nachricht löschen“ oder „Person entfernen“; offen mit Pflichtfeld Begründung.
  - Melden: Gründe aus `MELDE_GRUENDE` als Auswahl mit Text, dazu eine Notiz.
  - Anlegen: Name, privat/offen mit dem Hinweis für offen.
  - Beitreten: Kennung.
- **Kanal anlegen:** privat `raumDefinition()` mit der erweiterten Kanalliste
  (nur Admins), offen `buildSpace()` erneut (nur der Gründer) – vorhandene
  Bausteine, kein neues Format.
- **Grenzen, die sichtbar bleiben:** Hinweis „Öffentlicher Raum – jeder kann
  mitlesen“ über jedem offenen Raum; Einladen nur privat.

### Repositories (GitHub-Aufbau) – C.3

Heute zwei Listen unter „Agent“ (Bild `heute-repos-desktop.jpg`).

- **Eigene Seite „Repos“** mit Suche (nur lokal gefiltert) und den Reitern
  „Alle“ und „Meine“. Je Repo eine Karte: Name, Eigentümer (Name aus den
  Kontakten, sonst gekürzt), Beschreibung, offene Patches, letzte Aktivität,
  Marke „Bundle“, wenn es einen Bundle-Verweis gibt.
- **Ein Repo = Ankündigung (30617) + Bundle-Verweis (38042)** desselben
  Eigentümers mit derselben Kennung (`d`) – nur in der Anzeige verbunden, kein
  neues Event.
- **Repo-Seite:** Kopf „Eigentümer / Name“, Beschreibung, Maintainer; rechts
  „Klonen“ mit den Adressen zum Kopieren und „Bundle laden“ (wie heute, nur
  verschlüsselt geladen und lokal entschlüsselt). Reiter:
  - **Code:** README und Dateibaum aus dem Bundle – nur mit dem Bundle-Leser
    (E4). Ohne ihn: Klon-Befehle und „Bundle laden“ mit dem Satz, dass die App
    Bundles nicht selbst liest.
  - **Patches** (= Pull Requests): offen / angenommen / geschlossen mit Zahlen,
    je Zeile Betreff, Autor, Zeit, Status.
  - **Commits:** aus dem Bundle (E4); ohne Leser die angenommenen Patches mit
    den Commits aus ihrem Status (`applied-as-commits`).
  - **Mitwirkende:** die heutige Liste aus Earn (38056) samt Bus-Faktor (`earn.ts:18`).
  - **Einstellungen** (nur Eigentümer): Name, Beschreibung, Klon- und
    Web-Adressen, Maintainer, erster Commit – alles Felder, die
    `baueRepoAnkuendigung()` schon kennt. „Neue Version hochladen“ (Bundle)
    zieht aus dem Agent hierher.
- **Patch-Seite (Pull Request):** Betreff, Status als Marke, Autor, Zeit,
  Commit; Reiter „Änderungen“ mit Dateiliste (+/−), Abschnitten (`@@`),
  Zeilennummern, hinzugefügt/entfernt farbig und mit Zeichen (+/−), nicht nur
  mit Farbe. Gelesen wird der Text aus `git format-patch` durch einen
  **Diff-Leser ohne DOM** (neu, App, mit Tests auch gegen feindliche Eingaben);
  gezeichnet nur über `textContent`. „Als Datei laden“ für `git am`.
- **Aktionen:** Maintainer: **Annehmen** (Dialog mit optionalem Commit),
  **Schließen**, **Wieder öffnen**, **Als Entwurf** – alle über `baueStatus()`
  mit den vier Status, die es gibt, und dem Feld `notiz` für eine Begründung.
  Autor: **Zurückziehen**, **Wieder öffnen** (was `patchStatus()` ihm erlaubt). Neuer Patch:
  Datei wählen → Vorschau mit dem Diff-Leser → senden (`bauePatch()`).
- **Ehrlich:** Ankündigungen, Patches und Status sind öffentlich und signiert –
  der Satz dazu (`agent.nip34Text1/2`) steht auf der Repo-Seite.

### Abdeckungskarte – C.4

Heute eine Liste (Bild `heute-karte-desktop.jpg`).

- **Selbst gezeichnet als SVG**, keine Kacheln, kein Skript von außen:
  Plattkarte (Länge → x, Breite → y), Gradnetz alle 30° (fein alle 10° beim
  Zoomen). Welt-Umrisse nur fest eingebettet (E5).
- **Nur, was `buildCoverage()` ausgibt:** Zellen über der k-Schwelle, je Zelle
  ein Rechteck in der Größe ihrer Ebene (`LAYER_CELL_DEGREES`) an der
  Südwest-Ecke aus `toCell()`. Nie einzelne Einträge, keine rohen Events, keine
  Zahl unter der Schwelle; bei Funk und Bluetooth nur die Stufe (wenige,
  mehrere, viele), wie die Liste heute.
- **Ebenen** als Schalter (Provider im Netz, Funk, Bluetooth) mit Legende;
  jede Ebene mit eigener Farbe **und** eigenem Muster (Schraffur), damit es
  auch ohne Farbsehen geht.
- **Bedienung:** Ziehen und Mausrad bzw. zwei Finger; Tastatur: Pfeile
  verschieben, `+`/`−` zoomen, `0` zurück; Tab springt durch die Zellen im
  Ausschnitt; Enter zeigt die Angaben der Zelle (Ebene, Gebiet, Stufe). Daneben
  bleibt die Liste als gleichwertige Ansicht („Karte | Liste“).
- **Eigener Standort** nur, wenn der Nutzer ihn freigegeben hat (wie heute nur
  auf Wunsch), nur lokal gezeichnet: die eigene Zelle umrandet, kein Punkt.
  Darüber die Antwort aus `coverageAt()`.
- **Verborgene Zellen:** Satz „n Gebiete unter der Schwelle nicht gezeigt“ wie
  heute (`earn.verborgen`), und der Hinweis, dass die Schwelle nur die Anzeige
  schützt (Fallstrick „Abdeckungskarte nur mit Wegwerfschlüssel“).

### Gemeinsames

- **Texte:** neue Bereiche `texte/navigation.ts` (`nav.*`), `texte/raeume.ts`
  (`raum.*`), `texte/repos.ts` (`repos.*`), `texte/karte.ts` (`karte.*`) – je
  `de` und `en`. Bestehende Schlüssel wiederverwenden, nie umbenennen;
  `i18n.test.ts` bleibt überall bei 0 rohen Texten.
- **Neue Module** (je mit Tests ohne DOM, wo Logik drin ist):
  `shell/navigation.ts` (Seiten, Adresse, Zurück), `shell/dialog.ts`,
  `shell/tabs/raeume.ts` (Raum-Teil aus `kommunikation.ts`),
  `shell/tabs/repo-seite.ts`, `diff-ansicht.ts` (Diff-Leser),
  `karte-ansicht.ts` (Projektion, Zellen → Rechtecke, Zoom-Rechnung),
  `shell/tabs/karte.ts`.
- **innerHTML:** Neue Ansichten bauen mit DOM und `textContent`; wo HTML nötig
  ist (SVG-Gerüst, feste Symbole), nur feste Texte oder `escapeHtml()`/
  `ganzeZahl()` – `check_innerhtml.py --streng` bleibt bei 0.
- **Barrierefreiheit:** Leisten als `nav` mit `aria-label`
  (`data-i18n-aria`), `aria-current="page"`, sichtbarer Fokus, Pfeiltasten in
  Leisten und Listen, Dialoge wie oben, Menüs mit `aria-haspopup`/`aria-expanded`,
  Schaltflächen mindestens 40×40 px mobil, `prefers-reduced-motion` beachten.
- **Screenshots:** ein Skript `scripts/screenshots.py` (kommt mit C.1a, Vorgehen
  wie in 10.0 „Wie aufgenommen“, nicht in der CI) nimmt jede Ansicht in Desktop und
  Mobil auf – jeder Teilschritt prüft damit selbst und legt im Pull Request
  dar, was sich geändert hat. Ziel nie ein Git-Checkout außer
  `docs/ausbau/bilder/`; nie den Sicherungsdialog ablegen (Merkphrase).
- **Smoke-Test:** Selektoren nachziehen, wenn Knöpfe umziehen – die
  `data-tab`-Knöpfe bleiben (`switchTab()` nimmt weiter die alten Namen), keine
  Prüfung fällt weg. Neu je Teilschritt eine Prüfung der Sichtbarkeit (Desktop
  und Mobil): Jede Seite und Unterseite ist über Knöpfe erreichbar (B1–B3 nie
  wieder).

---

## 10.2 Teilschritte

Je höchstens etwa 400 geänderte Zeilen, reines Verschieben getrennt. Jeder
Schritt nach der Definition of Done, mit Screenshots Desktop und Mobil im
Pull Request. Dateien der Spur A (`waehrung.ts`, `agent.ts`, `ki-zahlung.ts`,
`refund-watcher.ts`, `zahlkanal-ui.ts`) kommen erst mit C.6 dran. 4.3d ist seit
#142 fertig; vor C.6 mit Spur A abstimmen, was ihr nächster Schritt berührt.

| ID | Inhalt | Dateien (Schätzung) | behebt | hängt an |
|---|---|---|---|---|
| **C.1a** | Rahmen: `navigation.ts` (Seiten, Adresse ohne Kennungen, Zurück), Leiste links repariert, untere Leiste mit „Mehr“, Hinweisleisten über dem Inhalt, Sprache mobil, ehrlicher Relay-Stand („im Pool“ statt „verbunden“, E8), Agent mobil mit „Verlauf“/„Modelle“, `scripts/screenshots.py`, Smoke: Erreichbarkeit | `index.html`, `app.css`, `app.ts` (klein), `ui.ts:145`, neu `navigation.ts`, `texte/navigation.ts`, Tests (~380) | B1, B2, B4, B5, B15 | C.0 (E1, E2, E8 entschieden) |
| **C.1b** | Seiten umziehen, **reines Verschieben**: neue Seiten „Repos“ (Repo-Karten aus Agent, Mitwirkende aus Earn) und „Netz“ (Karte aus Earn, Mesh aus Settings); Vertrauensstufe zu „Verdienen“; Aufrufe in `switchTab()` mitziehen | `index.html`, `app.ts` (Sammelstelle, klein), Smoke-Selektoren (~250) | B14 (teilweise) | C.1a |
| **C.2a** | **reines Verschieben** des Raum-Teils aus `kommunikation.ts` (`:34–648`) nach `tabs/raeume.ts`, wörtlich | ~600 verschoben, ~100 neu | – | C.1a; Größe freigegeben (E7) |
| **C.2b1** | `dialog.ts`; Dialoge statt `prompt()`/`confirm()`/`alert()` für Einladen, Moderatoren, Moderieren, Melden, Anlegen, Beitreten, Rauminfo; Smoke: Dialog per Tastatur | `dialog.ts`, `raeume.ts`, `app.css`, `texte/dialog.ts`, `texte/raeume.ts`, Tests (~400 mit Tests) | B7 | C.2a |
| **C.2b2** | Verlauf gruppiert mit Namen (`kontaktName()`), Menü an Nachrichten (Zeigen und Fokus), Raum-Menü ▾; Rauminfo in der Sprache der Oberfläche (`privacyInfo()` in `protokoll-texte.ts` neu gebildet, Wortgleich-Test) | `raeume.ts`, `app.css`, `index.html`, `protokoll-texte.ts` (klein, Spur B), Tests (~300) | B9, B17 | C.2b1 |
| **C.2c** | Antworten und Threads: Zeile „Antwort an …“, Thread-Spalte bzw. Unterseite, `sendePrivat()` mit `replyTo`/`threadRoot`, offen über `buildChannelMessage()`; Test: Antwort kommt in privaten und offenen Räumen mit Verweis an | `raeume.ts`, `raum-mls.ts`, Tests (~300) | B8 | C.2b |
| **C.2d** | Mitglieder mit Rollen und Menü, Meldungen auch mobil, Kanal anlegen, mobile Ebenen (Kanal → Mitglieder, Thread) | `raeume.ts`, `app.css`, Tests (~350) | B3 | C.2c |
| **C.3a** | Repo-Liste und Repo-Seite: 30617 + 38042 verbunden, Klonen, Bundle hoch- und herunterladen, Einstellungen des Eigentümers, Mitwirkende; Texte über Schlüssel | `repo-seite.ts`, `repos.ts`, `agent-netz.ts:266`, `app.ts:748` (zieht um), `texte/repos.ts`, Tests (~400) | B10, B11 | C.1b |
| **C.3b** | Patch-Seite: Diff-Leser (ohne DOM, Tests mit feindlichen Eingaben), Diff-Ansicht, Status-Dialoge (annehmen, schließen, wieder öffnen, Entwurf, zurückziehen), Patch mit Vorschau senden | `diff-ansicht.ts`, `repo-seite.ts`, Tests (~400) | B10 | C.3a |
| **C.3c** | *(E4: ja)* Bundle-Leser (Git-Bundle v2/v3, Packfile, `DecompressionStream`, Deltas; Grenzen für Größe, Objektzahl, Tiefe) und die Reiter „Code“ (README, Dateibaum) und „Commits“ | c1 Leser + Tests (~350), c2 Ansicht (~250) | B10 | C.3b |
| **C.4a** | Karte als SVG: Projektion, Gradnetz, Zellen nach Ebene, Schalter, Legende, Zoom und Verschieben mit Maus, Touch und Tastatur, Angaben je Zelle, „Karte / Liste“ | `karte-ansicht.ts` (ohne DOM, Tests: nur Zellen über k, keine Einträge), `tabs/karte.ts`, `texte/karte.ts` (~400) | B12 | C.1b |
| **C.4b** | *(E5, E6: ja)* Umrisse eingebettet (höchstens 40 KB); eigene Zelle umrandet; Standort nur gerundet gespeichert | Daten + ~150 | B13 | C.4a |
| **C.5** | Feinschliff Mobil: Berührflächen, Safe-Area, Querformat, Kürzungen, Tastatur über dem Eingabefeld, einheitliche Abstände; Durchgang aller Seiten mit Screenshots | `app.css`, `index.html` (~300) | Rest | C.2–C.4 |
| **C.6** | *nach 4.3d (Spur A, fertig seit #142) und Absprache:* a **reines Verschieben** – Settings › Gebühren (Aufteilung, Anteile, Standard-Schiene) → Währung › Zahlen; „Liquidität“ heißt „Hinterlegen“ (Deposit und Zahlkanal; neuer Schlüssel für die Beschriftung); Modell vorhalten/ankündigen → Verdienen; b Agent: doppelte Verdrahtung (B16), rechtes Feld auch unter 1200 px als Unterseite | a ~250, b ~200 | B14, B16 | 4.3d |

Reihenfolge: C.1a → C.1b → C.2a–d → C.3a–c → C.4a–b → C.5 → C.6.

**C.1a – fertig (27.09.2026).** Wie oben, mit diesen Abweichungen:
- Kopfzeile mobil: statt des eigenen Bildes vorerst der gekürzte Schlüssel als
  Knopf zum Profil (das Bild kommt mit C.5); das Guthaben führt zur Währung.
  Den geheimen Schlüssel exportiert die Kopfzeile nicht mehr per Klick – das
  geht im Profil wie bisher.
- „Zurück“ von Verdienen, Profil und Settings: über „Mehr“ in der Leiste (dort
  hervorgehoben) oder die Zurück-Taste; einen eigenen Knopf hat nur die
  Seitenleiste des Agenten.
- Relay-Stand (E8): „8 Relays im Pool“; der Punkt leuchtet nur, solange der
  Browser Netz meldet.
- Beschriftungen: `navEarn` heißt auf Deutsch „Verdienen“, `relaysTitle`
  „Relays im Pool“ (Werte geändert, Schlüssel bleiben); `identTitle` fällt weg.
- `scripts/screenshots.py` nimmt jede Ansicht über ihre Adresse auf (`#/…`).

**C.1b – fertig (27.09.2026).** Reines Verschieben, IDs unverändert:
- neue Seite **Repos** (`#/repos`): Repositories (Bundles und NIP-34) aus
  Agent › Repos, Mitwirkende aus Verdienen › Werben;
- neue Seite **Netz** (`#/netz`) mit den Reitern Karte (aus Verdienen › Karte)
  und Mesh (aus Settings › Mesh);
- Vertrauensstufe aus dem Profil nach Verdienen › Übersicht; das Profil zeigt
  die Abzeichen jetzt in voller Breite.
- Die Beschriftungen nutzen vorhandene Schlüssel (`agent.tabRepos`,
  `agent.repositories`, `earn.tabKarte`, `set.tabMesh`); neu nur `nav.netz`
  und `nav.netzUntertitel`.
- Texte, die den alten Ort nannten („Settings → Mesh“), sagen jetzt „Netz →
  Mesh“: `waehr.alsDateiGespeichert` und `OFFLINE_HINWEIS` im Protokoll (ein
  Wort, andere Spur).
- Offen bleibt aus B14 nur, was Dateien der Spur A berührt (C.6).

**C.2a – fertig (27.09.2026).** Nur das wörtliche Verschieben: der Raum-Teil
aus `kommunikation.ts` (Zeilen 34–647) nach `shell/tabs/raeume.ts`, Zeichen für
Zeichen gleich; nur `kontaktName` ist jetzt exportiert (der Rest braucht es).
`dialog.ts` rückt nach C.2b, wo er zum ersten Mal benutzt wird – sonst wäre er
in C.2a nicht verdrahtet. Tests, die Raum-Code im Quelltext suchen, lesen jetzt
`raeume.ts`, gleich streng; die neun innerHTML-Ausnahmen des Raum-Teils ziehen
mit um. C.1a zuerst, weil B1 jeden neuen Nutzer am Desktop trifft
und B2 halbe Seiten am Handy unerreichbar macht.

**C.2b1 – fertig (27.09.2026).** C.2b ist geteilt (sonst ~700 Zeilen): C.2b1
bringt `shell/dialog.ts` und ersetzt alle 16 `prompt()`/`confirm()`/`alert()`
in `raeume.ts`; Namen, Gruppierung und Menüs folgen mit C.2b2.
- `dialog()` baut nur mit DOM und `textContent` (`role="dialog"`,
  `aria-modal`, Titel als Beschriftung, der Rest der App `inert`); Fokus
  bleibt drin, Esc bricht ab, Enter bestätigt (mehrzeilig Strg+Enter), der
  Fokus kehrt zurück. Pflichtfelder und Prüfungen melden sich im Dialog
  (`pruefeWerte()`, rein und getestet). Mobil als Blatt von unten.
- Einladen: Kontakt als Wahl oder Schlüssel (hex), nur ein gültiger Schlüssel
  schließt den Dialog. Moderatoren privat: Häkchen je Mitglied (Admins
  vorgewählt); offen: Schlüssel und Regeln in einem Dialog, jeder Schlüssel
  geprüft. Moderieren privat: löschen oder entfernen als Wahl; offen:
  ausblenden oder sperren samt Begründung in einem Dialog. Melden: die sieben
  Gründe des Protokolls als Wahl mit Text (gesendet wird die Kennung). Anlegen:
  Hinweis und Name in einem Dialog; die Kennung eines offenen Raums zum
  Kopieren. Rauminfo: `privacyInfo()` im Dialog – noch Deutsch: 8.16g2b2
  (Spur B) hat diesen Satz nicht übernommen, C.2b2 bildet ihn in der App neu
  (B17).
- Neue Texte unter `dlg.*` (`texte/dialog.ts`) und `raum.*` (`texte/raeume.ts`);
  vorhandene Schlüssel dienen als Titel und Beschriftungen. Sieben Schlüssel
  der alten Eingabezeilen fallen weg (Nummernlisten, „Abbrechen = sperren“,
  getippter Grund).
- Der unerreichbare Zweig „Rolle vergeben“ in `moderiere()` fragt jetzt auch
  per Dialog; einen Knopf bekommt er mit C.2d.

---

## 10.3 Fragen an den MENSCH – entschieden

> **Entschieden 27.09.2026 (MENSCH):** alle acht Vorschläge angenommen (E1–E8
> wie in der rechten Spalte).

| Nr. | Frage | Vorschlag = Entscheidung |
|---|---|---|
| E1 | Untere Leiste mobil: vier Ziele (Agent · Chat · Währung · Mehr, Profil über das Bild oben) oder fünf (dazu Repos)? | **vier** – drei Kernfunktionen des Projekts plus „Mehr“ |
| E2 | Seitennamen: „Earn“ → „Verdienen“ (en „Earn“), neue Seiten „Repos“ und „Netz“, „Liquidität“ → „Hinterlegen“? Neue Beschriftungen bekommen neue Schlüssel; die alten bleiben, bis nichts sie mehr nutzt. | ja |
| E3 | „Communities“ (offen, Kind 42 mit `h`, ohne Hinweis auf „öffentlich“): (a) lassen, (b) keine neuen mehr anlegen, bestehende als „Community (offen)“ in der Raum-Leiste zeigen, (c) ganz entfernen? | **(b)** – kein Format ändert sich, der dritte Begriff verschwindet |
| E4 | Git-Bundles in der App lesen (README, Dateibaum, Commits)? Neuer Baustein ohne neue Abhängigkeit (`DecompressionStream` des Browsers), aber neuer Code für fremde Binärdaten – mit Grenzen und Tests gegen feindliche Bundles. Ohne ihn zeigt „Code“ nur Klon-Befehle und den Download. | **ja**, als eigener Schritt C.3c |
| E5 | Karte: (a) nur Gradnetz und Zellen, (b) dazu vereinfachte Küstenlinien eingebettet (Natural Earth 1:110m, gemeinfrei, stark vereinfacht, höchstens 40 KB in `freedom.html`)? | **(b)** – ohne Umrisse ist eine Weltkarte kaum lesbar |
| E6 | Standort (B13): statt der genauen Koordinaten nur auf 0,5° abgerundet speichern? Das reicht für alle drei Ebenen: Die feinste (Funk) hat 0,5°-Zellen, `coverageAt()` braucht nicht mehr. Kleine Änderung an `earn.ts:107`, nicht nur Oberfläche. | ja, in C.4b |
| E7 | C.2a verschiebt rund 600 Zeilen wörtlich (wie 1.0) – über der 400-Zeilen-Grenze, aber ohne Änderung der Logik. In Ordnung? | ja |
| E8 | Relay-Stand (B5): Die Zahl der **verbundenen** Relays kennt die App nicht – `WebSocketRelay` (`protocol/src/ws-relay.ts`) hält die Verbindung privat. Reicht „8 Relays im Pool“, oder soll das Protokoll einen lesenden Zugriff `verbunden` bekommen (klein, andere Spur, kein Format)? | erst „im Pool“ (C.1a), Getter später mit Spur A abstimmen |

## 10.4 Fertig, wenn

- Jede Funktion aus 10.0 ist auf Desktop **und** Mobil über Knöpfe erreichbar
  (Smoke-Test prüft es), B1–B17 sind behoben oder begründet offen.
- Räume: Antworten, Threads, Einladen, Moderieren, Melden und Mitglieder ohne
  `prompt()`; ein privater und ein offener Raum einmal vollständig durchgespielt.
- Repos: ein Patch vom Einreichen über die Diff-Ansicht bis zur Annahme in der
  App.
- Karte: zeigt nie eine Zelle unter der Schwelle (Test), lädt nichts von außen
  (Smoke-Test zählt Anfragen), bedienbar ohne Maus.
- **MENSCH:** alle Seiten am echten Handy und am Desktop durchklicken.
