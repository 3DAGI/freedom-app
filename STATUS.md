# FreedomStack — Statusbericht

Entwicklungsprotokoll: nach jedem Schritt ein Abschnitt `## Schritt <ID> – <Titel>`
am Ende. Abgeschlossene Monate stehen in `docs/archiv/STATUS-<JJJJ-MM>.md`
(`python3 scripts/status-archiv.py`) – bis September 2026, samt dem Bericht vom
29.08.2026 (Abschnitte 1–97), in `docs/archiv/STATUS-2026-09.md`.

---

## Schritt C-20d – Verlauf einer Datei und Suche im Code

Spur C, Sammlung C-20 (Repos 1:1 wie GitHub, ohne neues Format). Bei GitHub
zeigt jede Datei ihren Verlauf, und im Repo lässt sich suchen. Beides geht
jetzt im Reiter „Code“ – aus dem geladenen Bundle, nur im Speicher.

**Was:**
- `git-bundle.ts`:
  - `dateiVerlauf()` geht die Commits entlang der ersten Eltern ab dem
    gewählten Stand und nimmt jeden auf, in dem sich die Kennung unter dem
    Pfad gegenüber den Eltern ändert – „neu“, „geändert“ oder „gelöscht“.
    Höchstens 100 Commits; `abgeschnitten`, wenn danach noch Verlauf käme
    oder die Eltern nicht im Bundle liegen (dann lässt sich nicht sagen, was
    der Commit tat).
  - `sucheImCode()` sucht Dateinamen und Zeilen aller Textdateien des Stands,
    Groß/klein egal, in der Reihenfolge des Reiters. Grenzen in
    `SUCHE_GRENZEN`: 5000 Dateien, 200 Treffer, 1 MB je Datei, Tiefe 32,
    Zeile gekürzt auf 300 Zeichen; Binäres zählt nicht; unter zwei Zeichen
    wird nicht gesucht.
- `shell/tabs/code-reiter.ts`:
  - Knopf „Verlauf“ an jeder Datei (`aria-expanded`): je Commit Betreff,
    Autor, Datum, Kennung und was mit der Datei geschah.
  - In jedem Ordner ein Suchfeld „Im Code suchen“: Treffer als
    „Pfad:Zeile“ mit der Zeile, ein Klick öffnet die Datei; die Treffer
    bleiben stehen, bis neu gesucht wird. Gesucht wird im gewählten Stand –
    wechselt der Zweig, sucht die App dort neu.
  - Offener Verlauf und Suche stehen nur im Speicher und fallen mit dem
    Bundle heraus.
- Texte (de und en), CSS.

**Verdrahtet:** `app/src/shell/tabs/code-reiter.ts` (`zeigeCode()` →
`verlaufListe()` → `dateiVerlauf()`; `zeigeCode()` → `suchFeld()` →
`sucheImCode()`).

**Tests:** app +3 in `test/git-bundle.test.ts` (Verlauf je Zweig in beiden
Probe-Bundles, nach `max` und am Rand des Bundles abgeschnitten; Suche nach
Namen und Zeilen, Groß/klein, Reihenfolge, zu kurz, keine Treffer, Grenze mit
300 passenden Zeilen, Binäres und Übergroßes nicht durchsucht; Verdrahtung).
Smoke „raum“ (Desktop und Handy): Im Zweig „entwurf“ zeigt der Verlauf der
README „Entwurf: neuer Titel – geändert“ und „Werkzeugkiste mit Anleitung –
neu“, der Fokus bleibt auf dem Knopf; die Suche nach „hammer“ findet
src/liste.txt:1 und README.md:5, der erste Treffer öffnet die Datei (Adresse
unverändert), zurück im Ordner stehen die Treffer noch, „x“ ergibt den Hinweis
auf zwei Zeichen. Keine Bilder: Verlauf und Suche erscheinen nur mit geladenem
Bundle, das die Bilder-Probe nicht hat.

Endstand: protocol 1140 (6 übersprungen) · node 272 (6 übersprungen, mit
Internet) · app 713 (+3) · mls 13 · Leak-Tests 68 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 (keine neue
Ausnahme) · Website ok · Smoke-Test bestanden (mit den neuen Prüfungen) ·
Website-Bau ok · reproduzierbarer Build ok. Knoten-Stand: unverändert.

## Schritt C-20e – Issues nach Label filtern

Spur C, Sammlung C-20 (Repos 1:1 wie GitHub, ohne neues Format). Issues
tragen seit C-17a Labels (`t`-Tags nach NIP-34), die App zeigte sie nur an.
Bei GitHub filtert ein Klick auf ein Label die Liste – das geht jetzt auch.

**Was:**
- `repo-ansicht.ts` (ohne DOM): `issueLabels()` – die Labels der Issues mit
  ihrer Zahl, häufigste zuerst, sonst nach Namen; `filtereIssues()` – nach
  offen/geschlossen und, wenn gewählt, nach Label.
- `shell/tabs/issues-reiter.ts`: in der Filterzeile die Auswahl „Nach Label
  filtern“ („Alle Labels“, „bug (1)“ …); Labels in der Liste und auf der Seite
  eines Issues sind Knöpfe, ein Klick zeigt die Liste mit genau diesem Label.
  Die Zahlen „offen (n)“/„geschlossen (n)“ folgen dem Filter. Ein Label, das es
  im Repo nicht gibt (Wechsel des Repos), gilt nicht; die Wahl steht nur im
  Speicher und fällt mit `vergissIssue()`.
- Texte (de und en), CSS.

Labels nachträglich ändern und Zuständige setzen sieht NIP-34 nicht vor – dafür
bräuchte es ein Format (etwa NIP-32, Kind 1985, mit derselben Regel wie beim
Status: Autorin, Eigentümer, Maintainer). Das entscheidet der MENSCH.

**Verdrahtet:** `app/src/shell/tabs/issues-reiter.ts` (`issuesReiter()` →
`issueLabels()`, `filtereIssues()`; `labels()` an Zeile und Seite).

**Tests:** app +2 in `test/issues-ansicht.test.ts` (Auswahl mit Zahl und
Reihenfolge, Filter nach Status und Label auch für geschlossene, unbekanntes
Label; Verdrahtung: Zahlen folgen dem Label, fremdes Label gilt nicht, Knöpfe
in Zeile und Seite, nichts in die Adresse). Smoke „raum“ (Desktop und Handy):
Die Auswahl zeigt „Alle Labels“, „bug (1)“, „wartung (1)“; „wartung“ lässt nur
„Säge stumpf“ stehen, die Knöpfe zählen „offen (1)“/„geschlossen (0)“, der
Fokus bleibt auf der Auswahl; ein Klick auf das Label „bug“ in der Zeile zeigt
nur „Hammer klemmt“ und stellt die Auswahl auf „bug“; „Alle Labels“ zeigt
wieder beide.
Bild: `docs/ausbau/bilder/c20e/desktop-issues-labels.jpg` (Filterzeile mit
„Alle Labels“, Label „bug“ als Knopf).

Endstand: protocol 1140 (6 übersprungen) · node 272 (6 übersprungen, mit
Internet) · app 715 (+2) · mls 13 · Leak-Tests 68 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 (keine neue
Ausnahme) · Website ok · Smoke-Test bestanden (mit den neuen Prüfungen) ·
Website-Bau ok · reproduzierbarer Build ok. Knoten-Stand: unverändert.

## Schritt C-20f – Benachrichtigungen: Neues seit dem letzten Blick

Spur C, Sammlung C-20 (Repos 1:1 wie GitHub, ohne neues Format). GitHub
meldet neue Issues, Patches und Kommentare in Repos, an denen man beteiligt
ist. Die App zeigt das jetzt in der Repo-Liste – berechnet aus dem, was sie
ohnehin lädt.

**Was:**
- `repo-neuigkeiten.ts` (neu, ohne DOM):
  - `beteiligt()`: Eigentümer, Maintainer oder Autor eines Issues, Patches
    oder Kommentars im Repo.
  - `neuigkeiten()`: Issues, Patches und Kommentare anderer nach dem letzten
    Blick – eigene Beiträge sind nie neu.
  - `leseGesehen()`/`gesehenAbgleichen()`: die gemerkte Liste (Unfug fällt
    heraus); neu beteiligte Repos beginnen „jetzt“, sonst wäre beim ersten Mal
    alles neu; was gerade nicht geladen ist, bleibt gemerkt (ein stummes Relay
    soll nichts vergessen machen); höchstens 500, die ältesten gehen zuerst.
- `shell/tabs/repos.ts`: „zuletzt gesehen“ je Repo nur im Tresor
  (`freedom.repos.gesehen` über `geheim`, in `GEHEIM_FEST`) – die Liste
  verrät, welche Repos man verfolgt. Karten tragen die Marke „n neu“ (Titel:
  Issues, Patches, Kommentare einzeln), der Filter „Neu“ zeigt nur diese
  Repos; das Öffnen eines Repos (Karte oder aus dem Raum) gilt als gesehen.
- `shell/index.html`: dritter Knopf „Neu“ im Filter der Liste; Texte, CSS.

Kein Abruf im Hintergrund: Die Liste lädt wie bisher beim Start und beim
Öffnen der Seite – ein eigener Takt für Benachrichtigungen fragte die Relays
regelmäßig nach den eigenen Repos und wäre ein neues Verkehrsmuster.

**Verdrahtet:** `app/src/shell/tabs/repos.ts` (`ladeJetzt()` →
`gesehenAbgleichen()`; `karte()` → `neuIn()` → `neuigkeiten()`; Klick auf die
Karte und `oeffneRepo()` → `gesehenJetzt()`).

**Tests:** app +4 in `test/repo-neuigkeiten.test.ts` (beteiligt oder nicht;
nur nach dem Blick und nur von anderen; gemerkte Liste mit Unfug, Abgleich ab
jetzt, nichts verloren, Grenze 500; Verdrahtung: nur `geheim`, nie
localStorage, Schlüssel in `GEHEIM_FEST`, gesehen an beiden Stellen, Filter
„Neu“). Smoke „raum“ (Desktop und Handy), am Ende: den Blick auf „werkzeug“
zurückgedreht und neu geladen – die Karte zeigt „3 neu“ (Issue von Bo, Patch
und Kommentar von Ada; eigene Beiträge zählen nicht), „meins“ und „raumrepo“
nichts; „Neu“ zeigt nur „werkzeug“; nach dem Öffnen ist nichts mehr neu
(„Nichts Neues in Repos, an denen du beteiligt bist.“), der Blick ist gemerkt.
Bild: `docs/ausbau/bilder/c20f/desktop-repos-filter.jpg` (Filter „Alle ·
Meine · Neu“; beim ersten Laden ist nichts neu – die Marke „n neu“ prüft der
Smoke-Test).

Eine Prüfung aus B-4 (`kontakt-pruefung.test.ts`) verlangt den Schlüssel
`freedom.kontakte.geprueft` als letzten Eintrag von `GEHEIM_FEST` – der neue
Schlüssel `freedom.repos.gesehen` steht deshalb davor; die eigene Prüfung
verlangt nur, dass er in der Liste steht.

Endstand: protocol 1140 (6 übersprungen) · node 272 (6 übersprungen, mit
Internet) · app 719 (+4) · mls 13 · Leak-Tests 68 grün + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 (keine neue
Ausnahme) · Website ok · Smoke-Test bestanden (mit den neuen Prüfungen) ·
Website-Bau ok · reproduzierbarer Build ok. Knoten-Stand: unverändert.

## Schritt C-1a – Dialoge statt prompt()/confirm() im Währung-Tab

Spur C, Sammlung C-1 (Browser-Dialoge nach `shell/dialog.ts`). Der
Währung-Tab fragte an 9 Stellen mit `prompt()` und `confirm()` – Fenster des
Browsers, ohne Prüfung der Eingabe, mobil schwer zu bedienen. Jetzt fragen
dieselben Stellen über `dialog()`/`bestaetige()`: Titel, Text, Feld, eigene
Beschriftung des Knopfs; Esc bricht ab.

**Was:**
- `shell/tabs/waehrung.ts`, alle 9 Stellen:
  - Tausch sats → SOL: Betrag (nur ganze sats), Warnung zum Adressverlauf als
    eigener Dialog („Bevor du tauschst“, Knopf „Trotzdem weiter“), dann die
    Empfangsadresse (Vorschlag wie bisher die frische Adresse der eingebauten
    Wallet, geprüft mit `isValidSolanaAddress()`), Knopf „Tausch anfragen“.
  - Vorab-Gebühr („Zahlen“), Einlösen über einen Relayer („Einlösen“).
  - Tausch SOL → sats: Betrag nur im Rahmen des Angebots (`minSats`–`maxSats`),
    Rechnung (wenn keine Wallet verbunden ist), Sperren – die Kurswarnung
    steht im selben Dialog über der Frage.
  - Deposit trotz Kurswarnung („Trotzdem hinterlegen“).
- `shell-logic.ts`: `ganzeSats()` – ganze sats über 0, nur Ziffern. Bisher
  nahm `Number()` auch `1e3`, `0x10` oder `1.5`.
- Reihenfolge und Folgen bleiben: abgebrochen geht nichts hinaus, gemerkt
  wird erst nach der Adresse und dem Tresor.

**Verdrahtet:** `app/src/shell/tabs/waehrung.ts` – `startSwap()` (Betrag
:133, Warnung :158, Adresse :175), `zahleVorab()` (:358),
`einloesenUeberRelayer()` (:474), `startRueckSwap()` (Betrag :549, Rechnung
:565, Sperren :582), `startDeposit()` (Kurswarnung :918); `ganzeSats()` aus
`shell-logic.ts`.

**Tests:** app +3 in `test/browser-dialoge.test.ts`: Browser-Dialoge nur noch
in den Dateien aus `NOCH_OFFEN` (je Datei die Zahl – sie darf nur sinken);
`ganzeSats()` mit `1e3`, `0x10`, `1,5`, `-5`, Leerzeichen, zu lang;
Verdrahtung des Währung-Tabs (Prüfungen im Dialog, Reihenfolge warnen →
Adresse → Tresor, Kurswarnung im selben Dialog, abgelehnt → nichts). Die
Reihenfolge-Tests in `swap-vorab.test.ts` (prüfen → fragen → zahlen) und
`rueck-swap.test.ts` (planen → fragen → merken → sperren) folgen dem Dialog;
der zweite prüft das Fragen jetzt mit. Smoke „waehrung“ (neu): drei
LP-Angebote aus `scripts/lp-probe.mts` (Wegwerfschlüssel) über die
Relay-Attrappe – ein veraltetes ist gesperrt; „tauschen“ → `1e3` meldet
„Ungültiger Betrag“, `10000` führt zur Warnung (0,010 SOL ist rund), dann zur
Adresse; `keine-adresse` meldet „Keine gültige Solana-Adresse“, Esc bricht ab:
keine Anfrage gesendet, kein Adressverlauf gemerkt, kein Browser-Dialog.
SOL → sats ohne Solana-Wallet öffnet keinen Dialog, nur den Hinweis.
Bilder: `docs/ausbau/bilder/c-1a/` (Betrag mit Fehler, Warnung, Adresse –
Desktop und Handy; der Ordner `c1a` gehört zu C.1a aus Phase 10).

C-1 ist geteilt: b `agent-netz.ts` und `kommunikation.ts`, c `settings.ts`
(seit dem Merge von #183 frei), d der Rest (Offline-Zahlung, Profil,
Nachfolge, Bunker, Zap, Zahlkanal, Prüfaufträge, Notfall, eingebaute Wallet,
`app.ts`); `agent.ts` erst nach B-9 (Spur B arbeitet dort).

Gesehen, nicht geändert: Die Warnung zum runden Betrag empfiehlt einen
Betrag in SOL, gefragt wird nach sats; die Knöpfe der Angebotsliste brechen
auf dem Handy in zwei Zeilen um („TAUS CHEN“). Beides war vorher so.

## Schritt C-1b – Dialoge in Agent-Netz und Kommunikation

Spur C, Sammlung C-1, Teil b. Weitere 10 Browser-Dialoge über
`shell/dialog.ts`; was zusammengehört, steht jetzt in einem Dialog statt in
zwei Fenstern nacheinander.

**Was:**
- `shell/tabs/agent-netz.ts` (alle 6 Stellen):
  - Modell ankündigen: Kennung und Dateien in einem Dialog, die Erklärung zu
    den Prüfsummen als Text darüber. Ohne eine Zeile mit Prüfsumme und Größe
    geht der Dialog nicht zu („Keine Zeile war brauchbar …“) – vorher kam der
    Hinweis erst danach als Toast, und die Eingabe war weg.
  - Modell vorhalten: Modell und Dateien in einem Dialog.
  - Katalog veröffentlichen: Titel und Modelle (je Zeile oder mit „;“), das
    Beispiel als Text; als Gerät wird wie bisher gar nicht erst gefragt.
- `shell/tabs/kommunikation.ts` (4 von 5 Stellen):
  - Neue Unterhaltung: npub oder Hex, geprüft im Dialog (falscher npub, zu
    kurz), Scannen auf Klick; „nostr:npub…“ aus QR-Codes anderer Apps und
    Großbuchstaben gehen.
  - Eigener Name (Rechtsklick in der Liste, `benenneKontakt()`): Name und
    „Auch veröffentlichen“ als Häkchen in einem Dialog. Vorher fragte ein
    zweites Fenster, und dort war „OK“ das Veröffentlichen; jetzt ist es aus,
    bis man es ankreuzt. Vorbelegt wird nur ein echter Name, nicht der
    gekürzte Schlüssel.
  - „trotzdem zeigen“ an einer ausgeblendeten Nachricht: als Hinweis-Dialog
    (nur Text) statt `alert()`.
  - Übrig: `newCommunity()` – das Anlegen von Communities fällt mit C-10 weg.

**Verdrahtet:** `agent-netz.ts:76` (`kuendigeModellAn()`), `:106`
(`haltevorModell()`), `:266` (`veroeffentlicheKatalog()`);
`kommunikation.ts:424` → `benenneKontakt()` (`:460`), `:977` (ausgeblendet),
`:1087` (`newDm()`).

**Tests:** app +2 in `test/browser-dialoge.test.ts` (Modelle und Kataloge:
Prüfungen im Dialog, erst fragen, dann signieren, als Gerät nicht fragen;
Kommunikation: nur noch `newCommunity()`, Häkchen statt zweitem Fenster,
nicht mit dem gekürzten Schlüssel vorbelegt, `nostr:` und Prüfung beim
Schlüssel); `NOCH_OFFEN` ohne `agent-netz.ts`, `kommunikation.ts` 5 → 1.
Smoke „kontakt“ (neu, mit `DialogSeite` – Hilfen aus „waehrung“ gemeinsam
genutzt): „npub1falsch“ meldet „Das ist kein gültiger npub.“, „abc“ den
Hinweis auf npub oder Hex; `nostr:` + 64 Zeichen in Großbuchstaben öffnet die
Unterhaltung; Rechtsklick → „Eigener Name“, Feld leer, Häkchen aus; „Ada“
ohne Häkchen → kein Event 38062; „Ada Lovelace“ mit Häkchen → genau eines
(je Id gezählt – der Pool sendet an jedes Relay). Kein Browser-Dialog.
Bilder: `docs/ausbau/bilder/c-1b/` (neue Nachricht mit Fehler, eigener Name,
Katalog).

Gesehen, nicht geändert: Eigene Namen stehen in `freedom.petnames` im
Klartext-`localStorage` – wie der Lesestand (C-14) ein Kandidat für `geheim`.

## Schritt C-1c – Dialoge in den Settings

Spur C, Sammlung C-1, Teil c. `settings.ts` ist seit dem Merge von #183
(Spur A) frei; alle 12 Browser-Dialoge dort laufen jetzt über
`shell/dialog.ts`.

**Was:**
- **Nachfolge einrichten:** Kontakte als Häkchen, weitere Schlüssel (npub
  oder Hex, durch Komma oder je Zeile) als Text; unter drei Vertrauten meldet
  sich der Dialog, statt nach dem Fenster einen Toast zu zeigen. Danach die
  Warnung wie bisher als eigene Bestätigung – erst dann wird der Schlüssel
  geteilt.
- **Diebstahl vorbeugen:** die Warnung als Bestätigung („Ersatzschlüssel
  erzeugen“).
- **Schlüssel widerrufen:** ein Dialog statt vier Fenstern – die Anleitung
  darüber, der gestohlene Schlüssel (vorbelegt mit dem eigenen), der private
  Ersatzschlüssel **verdeckt** (vorher stand er offen im `prompt()`), das
  Datum als Datumsfeld; „Widerrufen“ rot, Fokus zuerst auf Abbrechen. Die
  Prüfungen (Schlüssel, 64 Zeichen Hex, Datum) melden sich im Dialog; Hex wird
  weiter vor `fromHex()` geprüft, das Mandat danach.
- **Vollmacht entziehen:** Bestätigung mit Gefahr.
- **Für jemanden melden:** Schlüssel und Grund in einem Dialog; nur ein
  gültiger Schlüssel (vorher ging jeder Text in die Meldung).
- **Neue Version übernehmen** (beim Start, wenn fixiert) und **Relay-Zugang
  kaufen:** Bestätigungen – gezahlt wird wie bisher erst danach.
- `shell-logic.ts`:
  - `schluesselAusEingabe()` – npub (auch mit `nostr:`), Hex in jeder
    Schreibung, sonst leer; genutzt von Nachfolge, Widerruf, Melden und
    `newDm()` (C-1b, statt der eigenen Prüfung dort).
  - `fliesstext()` – die Sätze des Protokolls (`wechselWarnung()`,
    `widerrufAnleitung()`, `nachfolgeWarnung()`) sind für `alert()` hart
    umbrochen und brachen im Dialog mitten in der Zeile; zur Anzeige werden
    die Zeilen verbunden, Absätze, Aufzählungen und Nummern bleiben. Die
    Sätze selbst bleiben wortgleich mit dem Protokoll.

**Verdrahtet:** `settings.ts:97`/`:111` (`richteNachfolgeEin()`), `:348`
(`bereiteWechselVor()`), `:385` (`widerrufeSchluessel()`), `:532`
(`entzieheGeraet()`), `:551` (`meldeFuerAnderen()`), `:1090`
(`pruefeFixierungBeimStart()`), `:1195` (Relay-Kauf); `kommunikation.ts`
(`newDm()` → `schluesselAusEingabe()`).

**Tests:** app +3 in `test/browser-dialoge.test.ts`
(`schluesselAusEingabe()` mit npub, `nostr:`, Großbuchstaben, falscher
Prüfsumme, nsec, zu kurz/lang; Verdrahtung der Settings – fragen → warnen →
Schlüssel, verdeckt, Gefahr, erst bestätigen, dann zahlen; `fliesstext()`).
`NOCH_OFFEN` ohne `settings.ts`. Angepasst, weil der Aufruf jetzt anders
heißt: `release-fix.test.ts` (Bestätigung statt `confirm()`),
`dm-verdrahtung.test.ts` (`newDm()` über `schluesselAusEingabe()`, dessen
Fälle jetzt einzeln getestet sind). Smoke „einstellungen“ (neu): Widerruf –
Anleitung, Felder Text/Passwort/Datum, Fokus auf Abbrechen, „abc“ meldet
„Der Ersatzschlüssel muss 64 Zeichen hex sein“; Nachfolge mit zwei
Schlüsseln meldet „Mindestens drei Vertraute …“; Melden mit „npub1falsch“
meldet „Kein gültiger öffentlicher Schlüssel“; abgebrochen nichts gesendet,
kein Browser-Dialog. Bilder: `docs/ausbau/bilder/c-1c/` (Nachfolge mit
Kontakten, Widerruf mit Fehler).

## Schritt C-1d – Dialoge an den Geld-Stellen

Spur C, Sammlung C-1, Teil d: die 8 Browser-Dialoge, die vor einer Zahlung
oder einem Konto auf der Kette fragen, laufen jetzt über `shell/dialog.ts`.
Die Reihenfolge bleibt: erst fragen, dann anlegen oder zahlen; abgelehnt
geschieht nichts.

**Was:**
- `shell/offline-zahlung.ts`:
  - **Ohne Internet zahlen:** Adresse (auch per QR vom Empfänger) und Betrag
    in einem Dialog, beides geprüft (`isValidSolanaAddress()`,
    `solZuLamports()` – exakt, ohne Gleitkomma; vorher `Number(…) * 1e9`),
    Knopf „Signieren“.
  - **Nonce-Konto anlegen** (Kosten im Text) und **schließen** (Gefahr).
- `chat-zap.ts` – **Trinkgeld in SOL:** die öffentliche Adresse aus dem
  Profil nur nach der Warnung („Trotzdem dorthin“); eine eingegebene Adresse
  nur als gültige Solana-Adresse, auch per QR – vorher ging jeder Text an die
  Zahlschiene.
- `shell/zahlkanal-ui.ts` – **Zahlkanal:** „Einzahlen“ bestätigen, vor dem
  Merken und Einzahlen wie bisher.
- `shell/eingebaute-wallet.ts` – **eingebaute Wallet entfernen:** Gefahr,
  Fokus zuerst auf Abbrechen.

**Verdrahtet:** `offline-zahlung.ts:49` (anlegen), `:64` (schließen), `:74`
(`zahlen()`); `chat-zap.ts:201`/`:204` (`sendZap()`, SOL);
`zahlkanal-ui.ts:65` (`oeffneZahlkanal()`); `eingebaute-wallet.ts:246`
(`entfernen()`).

**Tests:** app +1 in `test/browser-dialoge.test.ts` (Adresse und Betrag im
Dialog geprüft, kein `* 1e9`, erst fragen, dann signieren; Nonce mit
Bestätigung, Schließen mit Gefahr; Trinkgeld: Warnung vor der Zahlung,
Adresse geprüft; Zahlkanal: bestätigt vor `kanalBuch.merke()`; Wallet
entfernen mit Gefahr). `NOCH_OFFEN` ohne die vier Dateien.
`trinkgeld-adresse.test.ts` folgt dem neuen Aufruf (Reihenfolge gemerkt →
anfragen → Profil nur mit Rückfrage bleibt geprüft). Smoke „waehrung“
erweitert: „Ohne Internet zahlen“ meldet „Keine gültige Solana-Adresse“ und
bei `1e3` „Ungültiger Betrag“; „Eingebaute Wallet“ entfernen hat den Fokus
zuerst auf Abbrechen; kein Browser-Dialog.

## Schritt B-2a – Repos nur auf diesem Gerät: Baustein und Ablage

Sammlung B-2, Entscheidung S1 (30.09., MENSCH): „B mit Wechsel“ – ein Repo
lässt sich auf „privat, nur dieses Gerät“ schalten (nichts auf Relays), später
auf „öffentlich“. Aufgeteilt, weil der ganze Schritt über 400 Zeilen braucht:
a Baustein und Ablage (dieser Schritt), b Oberfläche, c Wechsel.

**App (`lokale-repos.ts`, ohne DOM):** `LokaleRepos` hält die Liste
(`freedom.repos.lokal` in `geheim`, mit Tresor im Tresor) und die Bundles
zusammen. Gemerkt werden die Angaben der Ankündigung – geprüft wie beim
Ankündigen (`baueRepoAnkuendigung()`), ohne Raum (ein Raum ist öffentlich) –
und je Repo das neueste Bundle: verschlüsselt mit frischem Schlüssel
(`verschluesseleDatei()`, AES-GCM mit Prüfsumme), das Chiffrat in der
IndexedDB `freedom-repos`, der Schlüssel im Eintrag. Eine neue Version wird erst
abgelegt, dann gemerkt, dann die alte gelöscht – bricht etwas ab, bleibt die
bisherige lesbar. Gelesen wird streng (`leseLokaleRepos()`: Kaputtes fällt weg,
je Eigentümer und Kennung einmal), höchstens `LOKAL_MAX` (50) je Identität.
`lokaleKarten()` baut dieselben Karten wie im Netz, mit eigenem Schlüssel
(`lokal:…`) und dem Merkmal `lokal`, nur für die eigene Identität.
`shell/lokale-repos-ablage.ts`: die IndexedDB und `lokaleRepos` für die App.

**Nie auf Relays:** `freedom.repos.lokal` in `SICHERUNG_NIE` (die Sicherung geht
auf Relays), damit auch nicht im Export (B-6); `freedom-repos` in
`WIPE_DATENBANKEN`; der Schlüsselname in `GEHEIM_FEST`.

**Tests (+4, `app/test/lokale-repos.test.ts`):** anlegen, ablegen, lesen (kein
Klartext in Datenbank und Liste, kein Raum, eigene Karten, neue Version mit
frischem Schlüssel, Angaben ändern behält das Bundle); streng gelesen (zehn
kaputte und doppelte Einträge, verändertes Chiffrat wirft, fehlendes ist
nichts); Grenzen, Prüfung wie beim Ankündigen, Löschen samt Chiffrat; nie in
Sicherung und Export, im Tresor, in der Notfall-Löschung.

**Verdrahtet:** noch nicht in der Oberfläche – das ist B-2b.

Endstand (B-2a, 01.10.): protocol 1140 (6 übersprungen) · node 271 (7
übersprungen ohne Netz – mit Netz 272) · app 732 (+4) · mls 13 · Leak-Tests 68
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website ok · Smoke-Test bestanden. Knoten-Stand: unverändert.

## Schritt B-2b – Repos nur auf diesem Gerät: Oberfläche

Zweiter Teil von B-2 (Baustein in B-2a).

**App:**
- `shell/tabs/repos.ts`: „Repo ankündigen“ fragt immer „Wo“ – öffentlich (wie
  bisher zuerst), **nur dieses Gerät** oder ein privater Raum, in dem ich Repos
  pflege. Lokal wird nur gemerkt (`lokaleRepos.merke()`), ohne Rückfrage, und
  nichts geht hinaus. Neue Versionen lokal über `ladeBundleHoch(…, lokal)`:
  höchstens 32 MB (`BUNDLE_GRENZEN.bytes`), verschlüsselt abgelegt, vor jedem
  Blob-Netz. Die lokalen Karten kommen nach `mitIssues()` in die Liste (nie
  Issues eines öffentlichen Repos gleicher Kennung) und bleiben ohne Relays
  sichtbar. Marke „nur dieses Gerät“.
- `shell/tabs/repo-seite.ts`: Zeile „🔒 Nur auf diesem Gerät …“ mit „Vom Gerät
  löschen“ (rot, nach Rückfrage); Reiter nur Code, Commits und Einstellungen;
  Einstellungen speichern lokal, ohne Raum; „Bundle laden“ sichert das lokale
  Bundle als `.bundle`-Datei.
- `shell/tabs/code-reiter.ts` (Spur C, nur die Form): Code und Commits bekommen
  eine `BundleQuelle` (`id`, `hole()`, Hinweis) statt der Netz-Referenz –
  `netzQuelle()` für das Speichernetz, vom Gerät aus `quelleVon()`. Der Hinweis
  über „Code laden“ sagt, woher das Bundle kommt.
- Texte `repo.woLokal`, `repo.markeLokal`, `repo.imLokal`, `repo.lokal*`,
  `repo.codeLadenLokal`, `repo.neueVersionTextLokal` in beiden Sprachen.

**Tests:** +1 (`lokale-repos.test.ts`: Verdrahtung – „Wo“ mit dem Gerät, lokal vor
jedem Senden und mit `return`, vor dem Blob-Netz mit Grenze, nach `mitIssues()`,
ohne Relays sichtbar, Reiter, Einstellungen lokal ohne Raum). Angepasst, weil sie
die alte Form wörtlich lasen: `git-bundle.test.ts` (Code und Commits über die
Quelle), `repo-karten.test.ts` (Bundle laden über die Quelle),
`repo-einstellungen.test.ts`, `raum-repos-privat.test.ts` (`hochladen` mit
`lokal`, kein Raum für lokale Repos), `issues-ansicht.test.ts` (Reiter Issues nur im
Netz), `raum-repos-ui.test.ts` („Wo“ immer, aus dem Raum nie). Smoke „raum“
(Desktop): „nurhier“ über „Wo“ angelegt, Bundle abgelegt, README gelesen, in der
Datenbank nur Chiffrat, gelöscht – dabei kein Event 30617, 38040–38042.

**Verdrahtet:** `packages/app/src/shell/tabs/repos.ts` – `kuendigeAn()` →
`lokaleRepos.merke()`, `ladeBundleHoch()` → `lokaleRepos.legeBundleAb()`,
`ladeJetzt()` → `lokaleRepos.karten()`; `packages/app/src/shell/tabs/repo-seite.ts`
– `quelleVon()` → `lokaleRepos.holeBundle()`, `lokalZeile()` →
`lokaleRepos.entferne()`, `speichereEinstellungen()` → `lokaleRepos.merke()`.

Endstand (B-2b, 01.10.): protocol 1140 (6 übersprungen) · node 271 (7
übersprungen ohne Netz – mit Netz 272) · app 733 (+1) · mls 13 · Leak-Tests 68
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website ok · Smoke-Test bestanden (mit der Prüfung „Repo nur auf
diesem Gerät“). Knoten-Stand: unverändert.

## Schritt B-2c – Repos nur auf diesem Gerät: Wechsel auf „öffentlich“

Dritter Teil von B-2: der Wechsel aus S1 („später auf öffentlich“).

**App (`shell/tabs/repos.ts`, `repo-seite.ts`):** „Veröffentlichen“ in der Zeile
„🔒 Nur auf diesem Gerät“ ruft `veroeffentlicheLokal()`: nach Rückfrage – sie
sagt, dass die Ankündigung signiert hinausgeht, das Bundle verschlüsselt ins
Speichernetz (der Schlüssel steht öffentlich in der Referenz) und dass es sich
nicht zurücknehmen lässt; gibt es schon ein öffentliches Repo gleicher Kennung,
nennt sie, dass es ersetzt wird – geht die Ankündigung hinaus, dann das Bundle
über `ladeBundleHoch()` wie jede neue Version. Erst wenn beides draußen ist,
entfällt die Kopie auf dem Gerät (`lokaleRepos.entferne()`); scheitert etwas,
bleibt sie, und ein zweiter Versuch ersetzt die Ankündigung. Danach steht die
öffentliche Seite offen (mit Issues, Patches, Mitwirkenden). Texte
`repo.lokalVeroeffentlich*` in beiden Sprachen.

**Tests:** +1 (`lokale-repos.test.ts`: Reihenfolge Rückfrage → Ankündigung →
Bundle → Kopie weg, scheitert das Bundle, bleibt die Kopie, ersetztes Repo in der
Rückfrage, Knopf verdrahtet). Smoke „raum“ (Desktop): „nurhier“ samt Bundle
veröffentlicht – 30617 und 38042 gehen hinaus, die Liste auf dem Gerät ist leer,
die öffentliche Seite zeigt alle Reiter; gelöscht wird jetzt ein zweites lokales
Repo „weg“ (ohne ein Event ans Relay).

**Verdrahtet:** `packages/app/src/shell/tabs/repo-seite.ts` – `lokalZeile()` →
`h.veroeffentlichen`; `packages/app/src/shell/tabs/repos.ts` – `zeige()` →
`veroeffentlicheLokal()` → `publish()`, `ladeBundleHoch()`, `lokaleRepos.entferne()`.

Endstand (B-2c, 01.10.): protocol 1140 (6 übersprungen) · node 271 (7
übersprungen ohne Netz – mit Netz 272) · app 734 (+1) · mls 13 · Leak-Tests 68
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website ok · Smoke-Test bestanden (mit „veröffentlichen“ und
„löschen“). Knoten-Stand: unverändert.

## Schritt B-8a – Knoten mit Besitzer koppeln: Protokoll

Sammlung B-8, Entscheidung L1 (01.10., MENSCH): A – ein Kopplungsgeheimnis,
als QR, im Tresor, nur im versiegelten Kern an den eigenen Knoten. KI-Anfragen
kommen absichtlich von Wegwerf-Schlüsseln (3.1); ohne Kopplung behandelt der
Knoten seinen Besitzer wie jeden Fremden. Aufgeteilt: a Protokoll (dieser
Schritt), b Knoten, c App.

**Protokoll (`kopplung.ts`):** Kopplungscode
`freedom-kopplung:1:<knoten>:<geheimnis>` (`neueKopplung()` mit frischem
Geheimnis aus 32 Byte, `kopplungscode()`, `leseKopplungscode()` streng – auch
mit Leerraum aus dem Einfügen). Nachweis `["besitzer", HMAC-SHA256(geheimnis,
„freedomstack-besitzer-v1:<pubkey des Kerns>:<created_at>“)]` über
`mitBesitzerNachweis()` – nie das Geheimnis selbst, nur an den Knoten im
`p`-Tag (sonst `ProtokollFehler` „kopplung-fremd“), ein vorhandener wird
ersetzt. Prüfung `istBesitzer()`: genau ein Tag, Zeit höchstens 600 s von der
Uhr des Knotens, Vergleich in fester Zeit, eines von mehreren Geheimnissen.
Leak-Regel `besitzer-versiegelt`: offen nie. Format in `docs/PROTOCOL.md` 21;
Fehlertexte `pf.kopplung*` in der App.

**Tests:** protocol +4 (`kopplung.test.ts`: Code neu und streng gelesen;
Nachweis gebunden an Geheimnis, Sitzung und Zeit, nur an den gekoppelten
Knoten; Prüfung mit Fenster, falschem und neuem Geheimnis, veränderter Zeit,
anderer Sitzung, doppelt, kein Hex; versiegelt kein Nachweis sichtbar, der
Knoten liest ihn aus dem Umschlag, offen meldet ihn die Regel), die Prüfung
aller Leak-Regeln kennt die neue.

**Verdrahtet:** noch nicht – `neueKopplung` (Knoten, B-8b),
`leseKopplungscode` und `mitBesitzerNachweis` (App, B-8c) stehen bis dahin in
`scripts/wiring-ausnahmen.txt`.

Endstand (B-8a, 01.10.): protocol 1144 (+4, 6 übersprungen) · node 271 (7
übersprungen ohne Netz – mit Netz 272) · app 734 · mls 13 · Leak-Tests 68 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 (drei Ausnahmen mit Verweis
auf B-8b/B-8c) · innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden.
Knoten-Stand: unverändert.

## Schritt B-8b – Knoten mit Besitzer koppeln: Knoten

Zweiter Teil von B-8 (Protokoll in B-8a).

**Knoten:**
- `kopplung-datei.ts`: Das Geheimnis liegt in `~/.freedom/kopplung.json`
  (0600, erst in eine Hilfsdatei, dann umbenannt), gelesen nur zum eigenen
  Schlüssel und streng (`leseKopplung()`); `erneuereKopplung()` ersetzt es.
  `kopplungImTerminal()` zeichnet den Kopplungscode als QR – je Zeichen zwei
  Modulzeilen (Halbblöcke), schwarz auf weiß über ANSI-Farben, vier Module
  Ruhezone.
- `koppeln.ts` / `npm run koppeln`: mit derselben Umgebung wie der Knoten
  (`NODE_SECRET_KEY`), zeigt QR und Text, beim ersten Mal neu erzeugt;
  `-- --neu` erzeugt ein neues Geheimnis (bisher gekoppelte Geräte gelten nicht
  mehr als Besitzer). Ins Log kommt das Geheimnis nie.
- `dvm-provider.ts`: Konfiguration `besitzer` (Geheimnisse, je Anfrage frisch);
  eine versiegelte Anfrage mit gültigem Nachweis (`istBesitzer()`) läuft gratis
  – ohne Gebot, ohne Kontingent, auch in der Bootstrap-Phase. Eine offene
  Anfrage mit Nachweis wird abgelehnt, bevor gerechnet wird.
- `main.ts`: liest die Kopplung je Anfrage aus der Datei (ein neues Geheimnis
  gilt sofort), meldet beim Start `[kopplung] mit dem Besitzer gekoppelt` bzw.
  `nicht gekoppelt – npm run koppeln`.
- `docs/PROVIDER.md`: Abschnitt „Mit dem Besitzer koppeln“.
- `scripts/wiring-ausnahmen.txt`: `neueKopplung` fällt weg (jetzt verdrahtet).

**Tests (+4, `node/test/kopplung.test.ts`):** Datei (0600, streng, nur zum
eigenen Schlüssel, ein neues ersetzt das alte, Kaputtes ist kein Besitzer); QR
fürs Terminal (Größe, Ruhezone, Farben); der Besitzer rechnet gratis ohne Gebot
und ohne Gratis-Angebot, die Antwort geht versiegelt an die Sitzung – ohne
Nachweis, mit fremdem Geheimnis und nach dem Erneuern nicht; offen mit Nachweis
abgelehnt (Gegenprobe: dieselbe Anfrage ohne Nachweis läuft mit Gebot), das
Geheimnis nie im Log.

**Verdrahtet:** `packages/node/src/main.ts` → `leseKopplung()` in `besitzer`;
`packages/node/src/dvm-provider.ts` → `istBesitzer()`;
`packages/node/src/koppeln.ts` (`npm run koppeln`) → `erneuereKopplung()` →
`neueKopplung()`, `kopplungImTerminal()`.

Endstand (B-8b, 01.10.): protocol 1144 (6 übersprungen) · node 275 (+4, 7
übersprungen ohne Netz – mit Netz 276) · app 734 · mls 13 · Leak-Tests 68 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden. Knoten-Stand: **dieser Stand** (GX10).

**Nebenbei (CI):** Der MLS-Test „Nachricht: … kein Klartext“ scheiterte in der
CI einmal. Er suchte „4711“ im ganzen Event, und Id, Signatur und Schlüssel sind
Zufalls-Hex: Bei 3000 gesendeten Nachrichten stand „4711“ sechsmal zufällig
darin, der Klartext nie. Jetzt sucht er „Gruppe 4711“ mit Leerzeichen; das kann
weder in Hex noch in Base64 entstehen.

## Schritt C-1e – Dialoge: der Rest

Spur C, Sammlung C-1, Teil e: die letzten 10 Browser-Dialoge außerhalb von
`agent.ts`. Danach gibt es `prompt()`/`confirm()`/`alert()` nur noch in
`newCommunity()` (das Anlegen von Communities fällt mit C-10 weg) und in
`tabs/agent.ts` (5 Stellen – Spur B arbeitet dort mit B-9, danach).

**Was:**
- `tabs/profil.ts` – **Abzeichen vergeben:** jetzt wirklich ein Dialog, wie
  der Kommentar es seit jeher wollte („zwei getrennte Dialoge wären zwei
  Gelegenheiten zum Abbrechen“): Name, Empfänger (Kontakte als Häkchen oder
  Schlüssel – jetzt auch npub, vorher nur Hex) und Zweck; ohne gültigen
  Empfänger meldet sich der Dialog.
- `nachfolge-ui.ts` – **Meldung zur Nachfolge** (Begründung Pflicht, wird
  veröffentlicht) und **Anteil übergeben** (Gefahr – ein Anteil lässt sich
  nicht zurückholen).
- `bunker.ts` – **Bunker verbinden/abmelden:** bestätigt, bevor die
  Identität wechselt.
- `pruefauftraege-ui.ts` – **Urteil als Prüfer:** Begründung darf leer
  bleiben, Abbrechen sendet nichts.
- `notfall.ts` – **Hinweis nach der Notfall-Löschung**, wenn nicht alles weg
  ist: jetzt vor dem weiteren Start (vorher `alert()` per `setTimeout`, der
  Start lief daneben weiter).
- `app.ts` – **eigener Schlüssel ohne Zwischenablage:** Feld zum Ansehen mit
  „Kopieren“ statt `prompt()`.

**Verdrahtet:** `profil.ts:30` (`vergebeAbzeichen()`), `nachfolge-ui.ts:141`
(`melde()`), `:179` (`uebergib()`), `bunker.ts:97`/`:112`,
`pruefauftraege-ui.ts:88` (`urteile()`), `notfall.ts:78`
(`nachNotfallLoeschung()`), `app.ts:828` („Profil teilen“).

**Tests:** app +1 in `test/browser-dialoge.test.ts` (keine Browser-Dialoge
mehr in den sechs Dateien; Abzeichen mit `schluesselAusEingabe()` und
Prüfung im Dialog; Nachfolge Pflicht-Begründung, Übergabe mit Gefahr und erst
nach Bestätigung; Bunker bestätigt vor dem Wechsel; Urteil erst nach dem
Dialog; Notfall-Hinweis vor dem Start). `NOCH_OFFEN` nur noch `agent.ts` (5)
und `kommunikation.ts` (1). Smoke „einstellungen“ erweitert: „Anmelden per
Bunker (NIP-46)“ fragt vor dem Wechsel; „Abzeichen vergeben“ mit Name,
Empfänger, Zweck – „npub1falsch“ meldet „Kein gültiger Pubkey dabei“.

**Nebenbei (Spur B, Test):** Im vollen Lauf nach dem Einmergen von B-8b war
„B-6: hin und zurück … kein Klartext“ (`datenexport.test.ts`) einmal rot. Der
Test suchte „Alice“, „Bob“ und „Frage“ in der Datei – das Chiffrat ist Base64
(rund 900 Zeichen), und „Bob“ stand bei 400 nachgezählten Läufen einmal
zufällig darin, der Klartext nie. Wie B-8b beim MLS-Test: Die Probe-Daten
tragen jetzt Namen mit Leerzeichen („Alice Muster“, „Bob Beispiel“, „Frage zum
Wetter“), gesucht wird danach – ein Leerzeichen kommt in Base64 nicht vor.

## Schritt C-2 – Einnahmen je Kette

Spur C, Sammlung C-2, reine Anzeige. Die Einnahmenliste im Earn-Tab zeigte
für jedes Leistungs-Event (38010) „… sats“ – auch für Aufträge, die in SOL
bezahlt wurden (Zahlkanal, Deposit). Das Event nennt die Kette (`chain`).

**Was:**
- `preis-anzeige.ts`: `einnahmeText(volume_msat, chain, kurs)` – Lightning
  in sats, Solana in SOL. Das Event nennt den Wert nur in msat (der Knoten
  rechnet den SOL-Preis daraus); SOL steht deshalb mit „≈“ und dem Kurs von
  jetzt da, dahinter der Wert in sats. Ohne Kurs: „SOL, Wert … sats (kein
  Kurs)“ – kein erfundener SOL-Betrag. Nur ganze, nicht negative msat; sonst
  „—“ (vorher „NaN sats“, wenn das Tag fehlte).
- `tabs/earn.ts`: jede Zeile über `einnahmeText()`; den Kurs holt der Tab nur,
  wenn es SOL-Einnahmen gibt (`aktuellerKurs()`, sonst `aktualisiereKurs()`).
- Untertitel „Rechenzeit, Speicher und Relays gegen Sats oder SOL.“

**Verdrahtet:** `earn.ts:246` (Kurs nur bei SOL-Einnahmen), `:252`
(`loadEarnings()` → `einnahmeText()`); `preis-anzeige.ts:40`.

**Tests:** app +1 in `test/preis-anzeige.test.ts` (Lightning, ohne Kette,
Solana mit und ohne Kurs, gratis 0, Unfug aus dem Event – `—`, `1e3`, `-5`,
zu lang –, Englisch; Verdrahtung im Earn-Tab). `innerhtml-ausnahmen.txt`: die
Begründung der bestehenden Zeile für die Liste nennt jetzt
`escapeHtml(einnahmeText(...))` statt `Math.floor`. Smoke „einnahmen“ (neu):
zwei Leistungs-Events eines Probe-Knotens aus `scripts/einnahmen-probe.mts`
(Wegwerfschlüssel, über `freedom.earn.knoten` gewählt) – „21 sats“ und „SOL,
Wert 1.500 sats (kein Kurs)“; Untertitel mit „oder SOL“.

## Schritt C-3 – Dashboard: Preise in sats und SOL

Spur C, Sammlung C-3. Die Status-Seite der Website (`dashboard.html`) zeigte
je Angebot nur „sats je 1.000 Tokens“. SOL ist gleichwertig – der Preis steht
jetzt in beiden Einheiten.

**Was:**
- `website/js/dashboard-daten.js`:
  - `kursAus()`: der Kurs des Anbieters aus seinem Angebot (`kurs`-Tag
    „SOL/BTC“), geprüft wie `parseCapabilities()` (4.4) – nur eine ganze
    Zahl sats je SOL und eine bekannte Quelle, sonst keiner.
  - `lamportsAus()`: msat → Lamports wie `msatZuLamports()` (aufgerundet,
    1 SOL = Kurs · 1000 msat); jedes Angebot trägt `lamportsJe1k` (oder
    `null` ohne Kurs).
- `website/dashboard.html`: Spalte „Preis je 1.000 Tokens“ – „2 sats · ≈
  0,000013334 SOL“, ohne Kurs „2 sats · SOL: kein Kurs“; gratis bleibt
  „gratis“.
- Kein neuer Abruf und keine neue Art: `filter()` ist unverändert, der Kurs
  steht schon im Angebot (38027).

**Verdrahtet:** `dashboard-daten.js:46` (`kursAus()`), `:52` (`lamportsAus()`),
`:70` (`angebote()` → `lamportsJe1k`); `dashboard.html:202` (`renderProviders()`).

**Tests:** app +1 in `test/website-dashboard.test.ts`: mit Kurs aus dem
Angebot dieselbe Zahl wie `msatZuLamports()` (2000 msat bei 150.000 sats/SOL
→ 13.334 Lamports), ohne Kurs `null`, ein Kurs „1e5“ zählt nicht; drei
weitere Beträge gegen `msatZuLamports()`; die Seite zeigt beides und „SOL:
kein Kurs“. `check-website.py` ok.

## Schritt C-4 – Barrierefreiheit: Namen, Kontrast, Tastatur

Spur C, Sammlung C-4 (Tastatur, Fokusreihenfolge, Beschriftungen für
Screenreader, Kontrast; Prüfung im Smoke-Test).

**Bestandsaufnahme** (eigene Messung im Browser über alle neun Seiten und
jeden Unterreiter, Desktop und Handy, dazu `index.html` ohne Browser):
- 25 Bedienelemente ohne Namen für Vorleser: Eingabefelder nur mit
  Platzhalter (Agent, Chat, Deposit, Zahlkanal, NWC, Endpunkte, Knoten,
  Repo-Name, SOL-Adresse, Tageslimit, Gebot), Auswahlen (Stufe, Laufzeit,
  Video), Knöpfe nur mit Symbol oder Tooltip (Anhang, Senden, Zap, neue
  Community, Direktnachrichten), der Werbelink.
- Kontrast unter 4,5:1: Rot als Schrift (`.err`, Gefahr im Menü, entfernte
  Zeilen im Diff) 3,9:1; die Stufen-Beschriftung der Vertrauensleiste und der
  leere Kontostand im Seitenkopf – beide über `opacity` gedämpft – 2,9 bzw.
  3,6:1.
- Nur per Maus: die Identität in der Kopfzeile (Klick exportiert den
  Schlüssel).
- Fokusrahmen: die Vorgabe des Browsers bleibt für Knöpfe; `tabindex > 0`
  gibt es nicht.

**Was:**
- `index.html`: `data-i18n-aria` an allen 25 Stellen – wo es einen Platzhalter
  oder Tooltip gibt, derselbe Schlüssel; neu `agent.stufeAria`,
  `agent.anhaengenAria`, `komm.sendenAria`, `waehr.kanalLaufzeitAria`,
  `earn.werbelinkAria`.
- `app.css`: `--red-text` (#E35D5D, 5,2:1) für Rot als Schrift – die Fläche
  Rot (`--red`, z. B. „Löschen“ mit weißer Schrift) bleibt; Strich der
  Vertrauensleiste halb durchsichtig über `rgba`, nicht `opacity`; leerer
  Kontostand über `--text-muted` statt `opacity: .45`.
- Identität in der Kopfzeile: `role="button"`, `tabindex="0"`, Enter und
  Leertaste exportieren wie der Klick (`app.ts`). Als Knopf ist sie auch eine
  Berührfläche: mobil mindestens 40 px hoch (die Prüfung „mobil“ aus C.5a
  fand sie danach mit 14 px).

**Verdrahtet:** `app.ts` (`nbIdent` mit Tastatur), `index.html` (Namen, über
`applyI18n()` → `data-i18n-aria`), `app.css`.

**Tests:** app +3 in `test/zugang.test.ts`: kein Bedienelement in
`index.html` ohne Namen (die Prüfung selbst mit Platzhalter-Feld,
Symbol-Knopf und Tooltip-Auswahl als Negativfällen); Rot als Schrift und
nichts Lesbares über `opacity`; Identität per Tastatur, kein `tabindex > 0`.
Smoke „zugang“ (neu): auf jeder Seite und in jedem Unterreiter (Desktop) bzw.
jeder Seite (Handy) – Namen, Kontrast nach WCAG AA (Schrift über der Fläche,
auf der sie wirklich steht, samt Deckkraft der Vorfahren; deaktivierte
Elemente ausgenommen), nichts nur per Maus, kein `tabindex > 0`. Vor den
Änderungen fand er die Stellen oben, danach keine.

Nicht in dieser Prüfung: Dialoge und Räume mit Inhalt (die prüfen „dialog“
und „raum“ auf Tastatur und Fokus), Fokusreihenfolge über die ganze Seite.

## Schritt C-6a – innerHTML abbauen: kleine Dateien

**Warum:** In `scripts/innerhtml-ausnahmen.txt` standen 64 Stellen, an denen
HTML aus Vorlagen gebaut wird und eine Begründung sagt, warum es sicher ist
(Sammlung C-6). Jede davon hängt daran, dass niemand ein `escapeHtml()`
vergisst. Wo Fremddaten in Zeilen stehen, ist DOM mit `textContent` sicher
ohne Begründung. C-6 ist aufgeteilt: C-6a die kleinen Dateien, C-6b
`settings.ts`, `app.ts`, `ui.ts`, `state.ts`, C-6c `kommunikation.ts`,
`raeume.ts`; `agent.ts` erst nach B-9.

**Was:**
- `shell/ui.ts`: `el(tag, text?, klasse?)` – Element mit Text über
  `textContent` und Klasse.
- `agent-netz.ts`: Modell-Liste (Name und Quantisierung aus fremden
  Manifesten) als Zeilen aus `el()`.
- `earn.ts`: Einnahmen (Tags vom Relay), Ladetext und Fehler.
- `profil.ts`: Vorschau (Bild nur als `img.src`, Layout und Muster über
  `classList` aus der festen Auswahl nach `normalizeStyle()`), Stil-Auswahl
  über `new Option(…)`, Offenlegung, Abzeichen (Namen von Fremden).
- `waehrung.ts`: Befunde der Swap-Prüfung als Textknoten, je einer in einer
  Zeile.
- `chat-zap.ts`: der Betrag als Wert des Feldes, nicht in die Vorlage
  eingesetzt.
- `scripts/innerhtml-ausnahmen.txt`: 12 Zeilen fallen weg (64 → 52);
  `check_innerhtml.py --streng` meldete sie als veraltet.

**Verdrahtet:** dieselben Aufrufer wie vorher – `zeigeModelle()`
(`app.ts`, Start und Knopf), `loadEarnings()` (Earn-Tab),
`zeigeProfilVorschau()`/`zeigeAbzeichen()` (`switchTab("profile")`),
`pollSwapResponse()` (Swap), `openZapDialog()` (Chat).

**Tests:** app +5 in `test/dom-statt-html.test.ts` (fertige Dateien ohne
`innerHTML` und ohne Ausnahme, `el()` nur mit `textContent`, Fremddaten als
Text, Swap-Befunde und Zap-Betrag, Smoke verdrahtet); der Quelltext-Test aus
C-2 (`preis-anzeige.test.ts`) sucht die Einnahme jetzt im `el("span", …)`.
Smoke „fremdtext“ (neu): `scripts/fremdtext-probe.mts` signiert mit
Wegwerfschlüsseln ein Modell-Manifest, eine Einnahme und ein Abzeichen an
den eigenen Schlüssel, deren Felder `<img src=x onerror=…>` und `<b>`
tragen; dazu ein Profilentwurf mit demselben Text. Geprüft: der Text steht
wörtlich da, kein Element daraus, kein Skript lief. Gegenprobe: mit einer
Zeile wieder über `innerHTML` meldet er „2 Elemente“.

## Schritt C-6b – innerHTML abbauen: Settings, Start, RPC-Stand

**Warum:** Zweiter Teil von C-6 (Sammlung). Nach C-6a standen 52 Stellen in
`scripts/innerhtml-ausnahmen.txt`, davon 17 in `settings.ts`, `app.ts` und
`state.ts` – darunter Gerätenamen aus Vollmachten vom Relay und
Fehlermeldungen von RPC-Anbietern.

**Was:**
- `settings.ts`: Nachfolge-Stand, Geräte-Liste (Name als Text, Knopf
  „entziehen“ mit `dataset.pk`), Fähigkeiten ohne Internet,
  Mesh-Warteschlange, Prüfsumme nach dem Export, Echtheit der eigenen Datei –
  alles über `el()`; kein `innerHTML` und kein `escapeHtml` mehr in der Datei.
- `state.ts`: RPC-Stand je Endpunkt eine Zeile als Text.
- `app.ts`: Wörter der Merkphrase (`<li>` mit `textContent`) und die
  Abfragefelder (`dataset.pos`); der Rahmen des Dialogs bleibt eine feste
  Vorlage aus `t()`-Texten. Sicherungs-Warnung mit Knopf, Sprachmenü als
  Knöpfe.
- `scripts/innerhtml-ausnahmen.txt`: 17 Zeilen fallen weg (52 → 35).
  Es bleiben `ui.ts` (eigenes Logo-SVG, auch als Favicon gebraucht),
  `tresor.ts`/`einrichtung-ui.ts` (feste Vorlagen), `kommunikation.ts`/
  `raeume.ts` (C-6c) und `agent.ts` (nach B-9).

**Verdrahtet:** wie vorher – `zeigeNachfolge()` (`app.ts`, Start),
`zeigeGeraete()` (`switchTab("settings")`), `zeigeOfflineFaehigkeiten()`
(Auswahl der Strecke), `zeigeWarteschlange()` (alle 2 s), Export und
Echtheit (Knöpfe), RPC-Prüfung (`wireRpcSetting()`, Knopf „prüfen“),
`baueSicherungsDialog()` (neue Identität, in jedem Smoke-Lauf),
Sprachmenü (`#lang-btn`).

**Tests:** app +2 in `test/dom-statt-html.test.ts` (Settings und RPC-Stand;
Merkphrase, Warnung, Sprachmenü); `settings.ts` und `state.ts` stehen in
`FERTIG` (kein `innerHTML`, keine Ausnahme). Smoke „fremdtext“ prüft dazu
Geräte und Nachfolge (Text wie vorher), „ohne Internet“ (je Zeile ✓/✕) und
das Sprachmenü (Knöpfe, `type="button"`, aktiv; nach „EN“ alle drei Menüs).

Aufgefallen, nicht geändert: In einer eben angelegten Identität bleibt der
Nachfolge-Stand bis zum Neuladen leer – der Start fragt ihn ab, bevor die
Identität steht, und der Settings-Tab fragt ihn nicht neu ab. Der Smoke-Test
lädt dafür einmal neu.

## Schritt B-8c – Knoten mit Besitzer koppeln: App

Dritter Teil von B-8 (Protokoll in B-8a, Knoten in B-8b).

**App:**
- `shell/mein-knoten.ts`: Karte „Mein Knoten“ in Settings → Geräte. Der
  Kopplungscode aus `npm run koppeln` wird gescannt oder eingefügt – verdeckt,
  streng geprüft (`leseKopplungscode()`, ein falscher meldet sich im Dialog);
  ist schon ein anderer Knoten gekoppelt, ersetzt ihn der neue nur nach
  Rückfrage. Entkoppeln nach Rückfrage vergisst den Code auf diesem Gerät
  (ungültig für alle Geräte wird er nur mit `npm run koppeln -- --neu`). Der
  Code liegt nur in `geheim` (`freedom.knoten.kopplung`, in `GEHEIM_FEST`).
- `shell/tabs/agent.ts`, `buildJobEvent()`: an den gekoppelten Knoten
  (`kopplungFuer(ziel)`) der Nachweis im Kern vor dem Versiegeln
  (`mitBesitzerNachweis()`) – ohne Gebot, Anteile, Kanal und Sitzung, gemerkt
  mit höchstens 0 msat (eine Rechnung würde nicht bezahlt).
- `protocol/src/state-backup.ts`: `freedom.knoten.kopplung` in `SICHERUNG_NIE`
  (damit auch nicht im Export).
- Texte `set.knoten*` in beiden Sprachen; `docs/PROVIDER.md` nennt den Ort in
  der App; `scripts/wiring-ausnahmen.txt`: die letzten zwei Zeilen zu
  `kopplung.ts` fallen weg.

**Tests:** app +2 (`mein-knoten.test.ts`: nur auf dem Gerät – Tresor, nicht in
Sicherung und Export, nur `geheim`, nichts hinaus, nichts ins Log; Karte, Feld
verdeckt und scanbar, streng geprüft, Ersetzen nach Rückfrage, `kopplungFuer`
nur für genau diesen Knoten), Leak-Tests +1 (`leak/mein-knoten.test.ts`: nur der
Umschlag, Nachweis und Geheimnis nie offen, kein Prompt, Identität und
Sitzungsschlüssel verborgen, p-Tag nur der Knoten, keine Zahlungsdaten; der
Pfad in `buildJobEvent()` baut genau so). Angepasst, weil sie `buildJobEvent()`
wörtlich lasen: `ki-zahlung.test.ts`, `zahlkanal.test.ts`,
`leak/ki-anfrage.test.ts` – Deklaration und Gutschrift weiter vor dem Versiegeln,
für den eigenen Knoten keine. Smoke „einstellungen“: falscher Code meldet sich,
ein gültiger wird verdeckt eingegeben und gemerkt, Status „Gekoppelt mit …“,
entkoppeln – dabei geht nichts hinaus.

**Verdrahtet:** `packages/app/src/shell/app.ts` → `wireMeinKnoten()`;
`packages/app/src/shell/tabs/agent.ts` → `kopplungFuer()`, `mitBesitzerNachweis()`.

Endstand (B-8c, 01.10., nach dem Einmergen von `main` mit C-1e bis C-6b):
protocol 1144 (6 übersprungen) · node 275 (7 übersprungen ohne Netz – mit Netz
276) · app 749 (+2) · mls 13 · Leak-Tests 69 grün (+1) + 1 todo · 0 rot ·
check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 · Website ok ·
Smoke-Test bestanden. Knoten-Stand: B-8b (GX10).

## Schritt B-20a – Kanäle offener Räume durch Berechtigte: Protokoll

Sammlung B-20, entschieden am 01.10.2026 (MENSCH): ja, ein eigenes Event für
Kanäle, das Berechtigte signieren. Bis dahin änderte nur der Gründer die Kanäle
eines offenen Raums (34700 trägt seine Signatur); „kanaele_verwalten“ wirkte
nur privat. Aufgeteilt: a Protokoll, b App.

**Protokoll (`spaces.ts`):**
- Kind 34703 je Kanal: `d` = `kanal:<kennung>:<kanal>`, `space`, `a` = Adresse
  des Raums, dazu genau eines von `channel` (anlegen/ändern, Felder wie in
  34700) und `entfernt`. `baueRaumKanal()`, `baueKanalEntfernung()` bauen nur
  Gültiges (`ProtokollFehler` „raum-kanal“, Text `pf.raumKanal` in der App),
  `leseRaumKanal()` liest streng; ein Kanal im offenen Raum ist immer „offen“.
- `mitRaumKanaelen(zustand, events, jetzt)`: Kanal-Events nur an genau die
  Adresse des Raums; je Kanal gilt die neueste Aussage – die Definition des
  Gründers sagt etwas über die Kanäle, die sie nennt, zu ihrer Zeit, entfernt
  aber nicht, was sie nicht nennt. Von anderen nur mit „kanaele_verwalten“
  nach heutigem Stand (wie B-19 – ein zurückdatiertes Event eines Abgesetzten
  hilft nicht) und nur, wenn der Kanal vorher wie nachher nur Schreibrollen bis
  zum eigenen Rang nennt. Höchstens 100 neue Kanäle, nichts mehr als 600 s
  voraus (`KANAL_GRENZEN`) – sonst gewönne ein vordatiertes Event gegen jede
  spätere Änderung des Gründers. Verworfenes steht mit Grund in `ignored`.
- `raum-repo.ts`: `raumZustandFuer(adresse, events, jetzt?)` wendet
  `mitRaumKanaelen()` an – alle Aufrufer bekommen die Kanäle mit.
- `docs/PROTOCOL.md` Abschnitt 22.

**Tests (+2, `spaces.test.ts`):** Hin und zurück, Entfernen, Bauen nur von
Gültigem; zwölf Fälle fremder Daten ergeben `null` (falsches `d`, falsche Kennung,
fremde Adresse, ohne `a`, beides oder doppelt, „verschluesselt“, ohne Namen,
negative Position, zu viele Rollen, zu langes Thema, anderes Kind). Auswertung:
Moderator legt an, benennt um, öffnet einen Kanal seines Rangs; über ihm
(nur Admins) weder öffnen noch entfernen noch anlegen; Mitglied und Fremder
ohne Recht; Admin darf; älter als die Definition verliert; zu weit voraus
zählt nicht; Entfernen und Rückkehr über eine neuere Definition; abgesetzt
fallen seine Änderungen weg; fremde Adresse zählt nicht; Grenze 100.

**Verdrahtet:** `packages/protocol/src/raum-repo.ts` → `raumZustandFuer()` →
`mitRaumKanaelen()` → `leseRaumKanal()` (aufgerufen aus
`packages/app/src/shell/tabs/raeume.ts`, `oeffneRaum()`, und
`repo-ansicht.ts`). `baueRaumKanal()`/`baueKanalEntfernung()` stehen bis
B-20b in `scripts/wiring-ausnahmen.txt`.

Endstand (B-20a, 01.10.): protocol 1146 (+2, 6 übersprungen) · node 275 (7
übersprungen ohne Netz – mit Netz 276) · app 749 · mls 13 · Leak-Tests 69 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden. Knoten-Stand: unverändert.

## Schritt B-20b – Kanäle offener Räume durch Berechtigte: App

Zweiter Teil von B-20 (Protokoll in B-20a).

**App (`shell/tabs/raeume.ts`):**
- `oeffneRaum()` lädt mit der Struktur auch die Kanal-Events (Kind 34703);
  `raumZustandFuer()` nimmt sie nur an die Adresse des Raums.
- „Kanal anlegen“ im offenen Raum für alle mit „kanaele_verwalten“
  (`darfKanaele()`, der Gründer hat es immer), gesendet als Kanal-Event
  (`baueRaumKanal()`) – keine neue Definition mehr. Die Position folgt dem
  letzten Kanal (mit Kanälen anderer konnte die Zahl der Kanäle eine schon
  belegte Position sein).
- Neue offene Räume: die Rolle „mod“ hat `MOD_RECHTE`, also auch
  „kanaele_verwalten“ – wie privat, wo Moderatoren Kanäle anlegen.
- **Fund:** „Moderatoren ernennen“ veröffentlichte im offenen Raum die
  Moderatorenliste der Communities (34550). Die zählt in Räumen seit B-19
  nicht – Ernannte konnten weder moderieren noch (jetzt) Kanäle verwalten; das
  Feld „Regeln (erscheinen bei jedem Mitglied)“ wurde nirgends gezeigt. Jetzt
  vergibt der Gründer die Rolle „mod“ (34702): Ernannte bekommen sie zu ihren
  Rollen dazu, Abgesetzte verlieren nur sie; fehlen der Rolle in älteren
  Räumen Rechte aus `MOD_RECHTE`, legt er sie vorher neu fest. Schlüssel als
  npub oder Hex (`schluesselAusEingabe()`), die bisherigen stehen schon im
  Feld; der Dialog nennt, was Moderatoren dürfen (`raum.modRechte`). Das Feld
  „Regeln“ fällt weg (`komm.regeln`).

**Tests:** app +1 (`raum-kanal.test.ts`): Moderatoren ernennen über die Rolle
– keine Liste 34550, keine Regeln, nur der Gründer, npub/Hex geprüft, erst die
Rolle, dann die Zuweisungen; so gebaut moderiert der Ernannte und verwaltet
Kanäle, der Abgesetzte nicht mehr, eine ältere Rolle bekommt „kanaele_verwalten“.
Angepasst mit derselben Absicht: der Test „offen“ in `raum-kanal.test.ts`
(jetzt Kanal-Event von einem Moderator, ein Mitglied zählt nicht, die Abfrage
lädt 34703) und die Menü-Prüfung (Kanäle nach `darfKanaele()`);
`oeffentliche-raeume.test.ts` findet die Kennung jetzt in Rolle und Zuweisung
statt in der Liste 34550; `raum-repos.test.ts` (11.4a) findet „repos_pflegen“
der Moderatoren jetzt in `MOD_RECHTE`. Smoke „eigener Raum“: Der Gründer legt „Technik & Co“
an – ein Kanal-Event an die Adresse, nur eine Definition (keine zweite mehr);
die Pause für einen späteren Zeitstempel entfällt.

**Verdrahtet:** `packages/app/src/shell/tabs/raeume.ts` – `oeffneRaum()`
(Abfrage mit `KIND_RAUM_KANAL`), `legeKanalAn()` → `baueRaumKanal()`,
`zeigeRaumArt()` → `darfKanaele()`, `ernenneModeratoren()` →
`buildRoles()`/`buildRoleGrant()`. `baueKanalEntfernung()` bleibt bis B-20c
(ändern und entfernen) in `scripts/wiring-ausnahmen.txt`; `buildModeratorList()`
ruft die App nicht mehr auf und steht dort jetzt mit Begründung.

Endstand (B-20b, 01.10.): protocol 1146 (6 übersprungen) · node 275 (7
übersprungen ohne Netz – mit Netz 276) · app 750 (+1) · mls 13 · Leak-Tests 69
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0
· Website ok · Smoke-Test bestanden. Knoten-Stand: unverändert.

## Schritt B-9a – „Mein Knoten“ in der Modellwahl

Sammlung B-9 (Lokal 13.3), erster Teil; Zielbild aus Anhang B: „Wo rechnet die
KI? Netz / Mein Knoten / Dieses Gerät“. Aufgeteilt: a Modellwahl, b Speichern
bei meinem Knoten, c „Alles über meinen Knoten“ samt Weg nur über sein Relay.

**App:**
- `knoten-wahl.ts` (ohne DOM): Wahlwert `knoten:<modell>`, leer heißt das
  Modell, das der Knoten wählt (`knotenWahlwert()`, `knotenModellAus()`).
- `shell/tabs/agent.ts`:
  - `zeigeKnotenBereich()`: nur gekoppelt (`meineKopplung()`, B-8c) die
    Gruppe „Mein Knoten“ zwischen Netz und „Dieses Gerät“ – Modelle aus dem
    Angebot des Knotens (`angebotVon()`), ohne Angebot „Modell des Knotens“;
    nur DOM mit `textContent`. Gezeichnet nach dem Laden der Netz-Modelle und
    beim Öffnen der Wahl (auch gleich nach dem Koppeln).
  - `askAi()` → `frageMeinenKnoten()` nach Funk und Gerät, vor Kontingent und
    Netz: nur an den gekoppelten Knoten, Gebot 0, Nachweis über
    `buildJobEvent()` (`kopplungFuer()`), Rechenarbeit aus seinem Angebot; kein
    Ausweichen – lehnt er ab oder schweigt er (300 s), steht das im Verlauf.
  - `buildJobEvent(…, modell?)`: das Modell ohne „knoten:“; Knopf, Toast und
    Schätzung („gratis · mein Knoten“) kennen den neuen Wert.
- **Fund:** „Stopp“ wirkte nie – `askAi()` prüfte den Prompt vor dem
  Stopp-Fall, und nach dem Senden ist das Feld leer. Jetzt steht der Stopp-Fall
  davor (betrifft auch „Dieses Gerät“ und den Vergleich).

**Gesendet** wird wie jede Anfrage über die Relays des Pools – „nur über sein
Relay“ braucht Änderungen im Knoten (der Provider liest heute nur die Relays
aus `RELAYS`, die eigene Relay-Rolle liefert Umschläge nur an den angemeldeten
Empfänger, nicht an Sitzungsschlüssel) und kommt mit B-9c.

**Tests:** app +4 (`mein-knoten-wahl.test.ts`: Wahlwert; Reihenfolge in
`askAi()` samt Stopp vor der Prompt-Prüfung; `frageMeinenKnoten()` nur an den
Knoten, ohne Provider-Suche, Failover oder Zahlung, Ablehnung und Schweigen im
Verlauf; Gruppe nur gekoppelt, vor dem Gerät, nur Text). Angepasst:
`mein-knoten.test.ts` (der Import in `agent.ts` nennt jetzt mehr Namen) und
`ki-funk.test.ts` (7.4c3: zwischen Stopp-Fall und Funk steht jetzt die
Prüfung des Prompts – Funk geht weiter vor allem anderen).
Smoke „lokal“: koppeln über den Dialog, die Wahl zeigt „Netz · Mein Knoten ·
Dieses Gerät“, der Knopf „Modell des Knotens · mein Knoten“; die Frage geht als
genau ein Umschlag an den Knoten – kein Auftrag offen, kein Klartext –, „Stopp“
bricht ab („[abgebrochen]“).

**Verdrahtet:** `packages/app/src/shell/tabs/agent.ts` – `askAi()` →
`frageMeinenKnoten()` → `buildJobEvent()`; `refreshModelDropdown()` und
`setupModelPicker()` → `zeigeKnotenBereich()`.

Endstand (B-9a, 01.10.): protocol 1146 (6 übersprungen) · node 275 (7
übersprungen ohne Netz – mit Netz 276) · app 754 (+4) · mls 13 · Leak-Tests 69
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0
· Website ok · Smoke-Test bestanden (mit „Mein Knoten“ im Teil „lokal“).
Knoten-Stand: B-8b (GX10) – der Nachweis braucht ihn.

## Schritt B-20c – Kanäle ändern und entfernen

Dritter Teil von B-20 (Protokoll in B-20a, Anlegen in B-20b). Bisher ließen
sich Kanäle in keiner Raumart ändern oder entfernen.

**Protokoll (`spaces.ts`):** `darfKanalAendern(pk, vorher, nachher, zustand)` –
der Gründer immer, sonst nur mit „kanaele_verwalten“ und nur, wenn der Kanal
vorher wie nachher nur Schreibrollen bis zum eigenen Rang nennt. Dieselbe Regel
wie in `mitRaumKanaelen()`, das sie jetzt nutzt (die Gründe in `ignored` bleiben).

**App:**
- Raum-Menü „Diesen Kanal ändern“ (`#space-kanal-aendern`, nach denselben
  Rechten wie „Kanal anlegen“) → `aendereKanal()` für den offenen Kanal: Name,
  „nur Moderatoren schreiben“ (andere Schreibrollen bleiben) und „Kanal
  entfernen“ – Entfernen nach Rückfrage, nie den letzten Kanal.
- Privat: `aenderePrivatenKanal()` (`raum-mls.ts`) – eine neue Definition in
  die Gruppe, nur Admins, wie beim Anlegen.
- Offen: vorher `darfKanalAendern()` für alte und neue Fassung, sonst geht
  nichts hinaus („In diesen Kanal schreiben nur Höhere“); dann ein Kanal-Event
  (`baueRaumKanal()` bzw. `baueKanalEntfernung()`) an die Adresse des Raums.
- Texte `raum.kanalAendern*`, `raum.kanalEntfernen*`, `dlg.speichern`.
- `scripts/wiring-ausnahmen.txt`: `baueKanalEntfernung` fällt weg (verdrahtet).

**Grenze:** Kanal-Events sind ersetzbar je Autor und Kanal; zwei Fassungen
derselben Sekunde entscheidet die Id (wie bei Definitionen). Wer schneller als
einmal je Sekunde ändert, kann die vorige Fassung behalten – der Smoke-Test
lässt deshalb eine Sekunde dazwischen.

**Tests:** protocol +1 (`spaces.test.ts`: `darfKanalAendern()` – Moderator legt
an, benennt um, schränkt auf Moderatoren ein und entfernt bis zum eigenen
Rang; über ihm und mit unbekannter Rolle nie; ohne Recht nie, der Gründer
immer), app +2 (`raum-kanal.test.ts`: Verdrahtung – nur der offene Kanal,
offen vorher geprüft, kein `buildSpace`, nie den letzten, Rückfrage, andere
Schreibrollen bleiben, privat nur Admins; so gebaut zählt es – privat ändert und
entfernt nur ein Admin, offen benennt der Moderator um und entfernt). Smoke
„eigener Raum“: „Technik & Co“ umbenannt in „Technik“, dann nach Rückfrage
entfernt – je ein Kanal-Event (`channel` mit neuem Namen, `entfernt`), keine
zweite Definition.

**Verdrahtet:** `packages/app/src/shell/tabs/raeume.ts` – `wireSpacesTab()` →
`aendereKanal()` → `darfKanalAendern()`, `baueRaumKanal()`,
`baueKanalEntfernung()`, `aenderePrivatenKanal()`.

Endstand (B-20c, 01.10.): protocol 1147 (+1, 6 übersprungen) · node 275 (7
übersprungen ohne Netz – mit Netz 276) · app 756 (+2) · mls 13 · Leak-Tests 69
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0
· Website ok · Smoke-Test bestanden. Knoten-Stand: unverändert.

## Schritt B-10a – Der Knoten liefert die App aus

Sammlung B-10 (Lokal 13.4), Entscheidung L2 A: „ja, nur reproduzierbarer
Build mit Prüfsumme“. Erster Teil: der Knoten.

**Warum:** Die App von GitHub Pages läuft über https; von dort lassen Browser
keine Verbindung zu `ws://…` im Heimnetz zu – auch nicht zum Relay des eigenen
Knotens (Anhang B der Sammlung). Kommt die App vom Knoten, ist sie dort zu Hause.

**Knoten** (`node/src/app-auslieferung.ts`, `relay-role.ts`, `main.ts`):
- `APP_SHA256` schaltet ein, `APP_DATEI` nennt die Datei (Standard: der Build
  im eigenen Checkout, `../app/dist/freedom.html` vom Ordner des Knotens).
- `ladeApp()` liest die Datei beim Start und gibt sie nur mit genau dieser
  SHA-256 heraus (sonst ein Grund: keine Summe, nicht lesbar, zu groß, andere
  Summe). Im Log nur feste Texte (`APP_GRUND_TEXT`), nie Pfad oder Systemmeldung.
- Die Relay-Rolle bekommt nur das Ergebnis (`app`) und liefert es aus dem
  Speicher – eine spätere Änderung der Datei geht nie hinaus. Pfade `/` und
  `/freedom.html` (nicht mit `Accept: application/nostr+json` – das bleibt
  NIP-11), daneben `/freedom.html.sha256`; `GET` und `HEAD`, ETag = Summe
  (304 bei gleicher), `nosniff`, `no-referrer`, kein fremder Rahmen
  (`X-Frame-Options`, `frame-ancestors 'none'` – die übrige CSP steht in der
  Datei). Ohne `RELAY_ENABLED=1` nur ein Hinweis im Log.
- Gleicher Ursprung wie der Relay: im Heimnetz `http://<rechner>:7777/`, über
  den Onion-Dienst aus `docs/PROVIDER.md` (Port 80 → 7777) `http://<adresse>.onion/`.
- Installer: mit `APP_SHA256` (geprüft: 64 Hex-Zeichen, erst dann in die
  Umgebungsdatei) baut er die App im Checkout und sagt, ob die Summe passt.
- `docs/PROVIDER.md`: neuer Abschnitt „Die App vom eigenen Knoten (B-10)“.

**Fund (für B-10b):** Über http im Heimnetz ist die Seite kein sicherer
Kontext (geprüft im Browser: `isSecureContext` false, `crypto.subtle`
undefined). Damit fehlen Tresor, MLS-Zustand, die lokale Suche und das Lesen
von Git-Bundles; die Kamera ebenso. Die App startet und schreibt, sagt es aber
noch nicht – das Einrichten des Tresors scheitert mit einer unklaren Meldung.
B-10b macht das ehrlich. Sicher sind `.onion` im Tor Browser und `localhost`.
Außerdem kann im selben Netz jemand die Datei unterwegs verändern – die Grenze
steht in `docs/PROVIDER.md`.

**Tests:** node +5 (`app-auslieferung.test.ts`: `ladeApp()` nur mit der Summe,
feste Gründe; Umgebung, leere Werte, Pfade; der Relay liefert genau die
geprüfte Datei – auch nachdem sie auf der Platte geändert wurde –, Summe,
HEAD, 304, NIP-11 und WebSocket auf demselben Port; ohne App keine Seite;
Verdrahtung in `main.ts` und Installer).

**Verdrahtet:** `packages/node/src/main.ts` – `appAusUmgebung()` → `ladeApp()`
→ `new RelayRole({ …, app })`; `relay-role.ts` – `beantworte()` →
`istAppPfad()` → `liefereApp()` → `appKopfzeilen()`.

Endstand (B-10a, 01.10.): protocol 1147 (6 übersprungen) · node 280 (+5, 7
übersprungen ohne Netz – mit Netz 281) · app 756 · mls 13 · Leak-Tests 69 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden · im Browser: die echte `freedom.html` vom
Relay unter `http://knoten.test:<port>/` startet. Knoten-Stand: nur für die
App vom Knoten nötig (`APP_SHA256`), KI-Anfragen unberührt.

## Schritt B-10b – Ohne sicheren Kontext ehrlich

Sammlung B-10, zweiter Teil. Fund aus B-10a: Kommt die App über http im
Heimnetz vom eigenen Knoten, ist die Seite kein sicherer Kontext –
`isSecureContext` false, `crypto.subtle` undefined (im Browser geprüft). Die
App startete und schrieb, aber das Einrichten des Tresors scheiterte mit
einer fremden Meldung, das Lesen von Git-Bundles ebenso.

**App:**
- `verschluesselungMoeglich()` (neu, `sicherer-kontext.ts`, ohne DOM): sicherer
  Kontext und `crypto.subtle` mit `importKey` und `digest`.
- `richteTresorEin()` (`shell/tresor.ts`): ohne das ein Hinweis
  (`ein.tresorUnsicher`) statt des Passphrase-Dialogs – kein Tresor, damit
  keine Wallet und kein MLS; sicher über https, .onion im Tor Browser oder
  localhost. Nichts wird angelegt. Alle Wege zum Tresor gehen hier durch, auch
  `verlangeTresor()` vor Wallet und Swap (dann mit dessen Grund davor).
- Git-Bundles: `sha1()` (`git-bundle.ts`) wirft ohne `crypto.subtle`
  `BundleFehler("unsicher")`, angezeigt als `repo.bundleUnsicher`
  (`code-reiter.ts`) – klein in Dateien der Spur C.
- Was ohne sicheren Kontext still wegfällt, bleibt so: die lokale Suche nimmt
  dann keinen Index (wie bisher bei einem Fehler), MLS ist ohne Tresor ohnehin
  gesperrt (NIP-17), der Scanner zeigt ohne Kamera den Hinweis zum Einfügen.
- `docs/PROVIDER.md`: „Die App sagt das, wenn man den Tresor einrichten will.“

**Tests:** app +3 (`sicherer-kontext.test.ts`: die Prüfung mit allen Fällen,
auch dem im Browser gesehenen; der Hinweis kommt nach „schon eingerichtet“
und vor Dialog und `createVault()`, mit dem Grund des Verlangenden, der Text
nennt die sicheren Wege; Bundles ohne `crypto.subtle` → `unsicher`, mit wie
bisher). Smoke „unsicher“ (neu): Init-Skript nimmt `isSecureContext` und
`crypto.subtle` weg, Settings → Tresor einrichten zeigt den Hinweis statt des
Dialogs, danach kein Tresor (Merker und Blob fehlen).

**Verdrahtet:** `packages/app/src/shell/tresor.ts` – `richteTresorEin()` →
`verschluesselungMoeglich()` → `hinweis()`; `packages/app/src/git-bundle.ts` –
`sha1()` → `BundleFehler("unsicher")` → `code-reiter.ts` (`FEHLER`).

Endstand (B-10b, 01.10.): protocol 1147 (6 übersprungen) · node 280 (7
übersprungen ohne Netz – mit Netz 281) · app 759 (+3) · mls 13 · Leak-Tests 69
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0
· Website ok · Smoke-Test bestanden (mit „unsicher“). Knoten-Stand: unverändert.

## Schritt C-6c – innerHTML abbauen: Chat und Kanalliste

**Warum:** Dritter Teil von C-6 (Sammlung). Im Chat steht fast nur
Fremdtext: Namen, Nachrichten, Gerätenamen aus Vollmachten, Anhänge mit
Name, Typ und Adresse aus fremden Nachrichten. Bis hier hing das an 13
begründeten Ausnahmen und an `renderAttachment()`, das HTML-Text baute.

**Was:**
- `shell-logic.ts`: `anhangAnsicht()` statt `renderAttachment()` – eine
  Beschreibung (`hinweis`, `knopf` mit `daten`, `bild`/`video`/`audio`,
  `link`) statt HTML. Geprüft wird wie bisher: Schlüssel
  (`istDateiSchluessel()`), Schema (`isSafeAttachmentUrl()`, verschlüsselt nur
  https oder Blob-Netz), Art nach Typ; Chiffrat nie als Bild.
- `kommunikation.ts`: `anhangElement()` baut daraus Elemente nur mit
  Eigenschaften (`src`, `alt`, `href`, `relList`), `dataset` und Text;
  Chat-Liste, leerer Verlauf (mit Prüfstand), jede Blase (Text, Marken
  „alt“/MLS/„wartet“, Diebstahl-Warnung, Gerätename, Zap- und Zahlknopf) als
  DOM. Kein `innerHTML`, kein `escapeHtml` mehr in der Datei.
- `raeume.ts`: Kanalliste (Schloss, Name, Erwähnungen, Punkt) als DOM; die
  Datei hatte schon ein eigenes `el()`.
- `scripts/innerhtml-ausnahmen.txt`: 13 Zeilen fallen weg (35 → 22).

**Verdrahtet:** wie vorher – `loadChatList()`/`openConversation()`/
`loadChatMessages()` (Chat-Tab), `zeigeKanalliste()` (Raum öffnen);
`anhangElement()` aus `loadChatMessages()`; die Knöpfe verdrahtet weiter
`wireBlobButtons()` über `dataset`.

**Tests:** app +2 in `dom-statt-html.test.ts` (Anhänge nur über Eigenschaften
und `dataset`; Chat und Kanalliste als DOM); `kommunikation.ts` und
`raeume.ts` in `FERTIG`. Die neun Anhang-Tests in `shell-logic.test.ts`
prüfen jetzt `anhangAnsicht()` – dieselben Fälle (böser Name, `javascript:`,
Anführungszeichen in der Adresse, Medientypen, Blob-Knopf, leerer Name,
verschlüsselt mit Blob und Blossom, kaputter Schlüssel, `http:`, böser Typ);
statt „maskiert“ prüfen sie, dass der Wert unverändert Daten bleibt, die
Oberfläche setzt ihn nur als Eigenschaft (Quelltext-Test) und der Browser
zeigt ihn als Text (Smoke). Zahl gleich (34). `kontakt-pruefung.test.ts`
sucht den Prüfstand im DOM-Aufbau. Smoke „fremdtext“: `fremdtext-probe.mts`
baut eine versiegelte Direktnachricht (NIP-17) eines Fremden an den eigenen
Schlüssel – Text, ein Bild und eine verschlüsselte Datei mit bösem Typ, alle
mit `<img onerror>` im Namen; der Name des Kontakts kommt als Petname. Geprüft:
Name in der Liste, Text, `alt` des Bildes, Text und `data-mime` des Knopfs
wörtlich, kein `onclick`-Attribut, kein Element aus dem Fremdtext, Zap-Knopf da.

Aufgefallen: `el()` steht in neun Dateien als lokale Kopie (`raeume.ts`,
`repos.ts`, `notfall.ts` …) neben der aus `shell/ui.ts` – zusammenlegen wäre
ein eigener kleiner Schritt.

## Schritt C-14 – Lesestand im Tresor

**Warum:** `freedom.lastRead` hält je Kanal, wann man ihn zuletzt las – das
verrät Gewohnheiten und lag auch mit Tresor im Klartext in `localStorage`
(Sammlung C-14, Regel „Geheimnisse nur über `geheim`“).

**Dabei gefunden:** Gespeichert war der Stand als Liste von Paaren
(`JSON.stringify([...map])`). Die Regel der Zusammenführung (`spaetestes` in
`zustand-zusammenfuehren.ts`, B-5) mischt aber nur Objekte – beim Einlesen
einer Sicherung galt deshalb der Stand der Sicherung, und was nur auf dem
Gerät stand, war weg. Der Test zu B-5 nahm schon ein Objekt an.

**Was:**
- `lesestand.ts` (neu, ohne DOM): `leseLesestand()` liest das Objekt und die
  alte Liste von Paaren, Unbrauchbares fällt weg (Zeiten nur als ganze Zahl
  ≥ 0); `schreibeLesestand()` schreibt ein Objekt `{ kanal: sekunden }`.
- `raeume.ts`: `ladeLesestand()`/`merkeLesestand()` nur über `geheim`; ein
  Klartext-Stand von vorher wandert mit Tresor einmal hinein (erst in den
  Tresor, dann aus localStorage).
- `shell/tresor.ts`: `freedom.lastRead` in `GEHEIM_FEST` – beim Einrichten
  eines Tresors wandert er mit, die Sicherung liest ihn über `istGeheimnis()`.
- Kein Format auf dem Netz; die Sicherung (`state-backup.ts`) und die
  Notfall-Löschung (`duress.ts`) führen den Namen schon.

**Verdrahtet:** `ladeLesestand()` aus `wireSpacesTab()`, `merkeLesestand()`
aus `oeffneKanal()` (`shell/tabs/raeume.ts`); Sicherung und Export über
`istGeheimnis()` (`shell/tabs/settings.ts`).

**Tests:** app +4 in `test/lesestand.test.ts` (beide Formen, Unbrauchbares,
Zusammenführung je Kanal – und dass die alte Liste nicht gemischt wurde –,
verdrahtet: nur `geheim`, nie `localStorage.setItem`, im Tresor). Smoke „raum“:
nach dem Öffnen der Kanäle steht der Stand als Objekt mit Zeiten.

Aufgefallen, nicht geändert: Der Lesestand ist nach der Kanal-Kennung
gemerkt, nicht nach Raum – „allgemein“ in zwei Räumen teilt sich einen Stand.

## Schritt C-16 – Relay-Stand „verbunden“

**Warum:** Die Navigation zeigte „8 Relays im Pool“ – ehrlich, aber wenig
hilfreich: `WebSocketRelay` hielt den Verbindungsstand privat (E8, B5 aus
`phase-10.md`; Sammlung C-16). Spur A war einverstanden, einen lesenden Getter
ohne Formatänderung mit C-16 zu bauen (29.09.).

**Was:**
- `protocol/src/ws-relay.ts`: `get verbunden(): boolean` – offen heißt
  `readyState === WebSocket.OPEN`; nur lesend, sonst unverändert.
- `shell/ui.ts` (`aktualisiereNavStatus()`): zählt die Relays des Pools mit
  `verbunden === true`; Leiste `x/y`, Titel und „Mehr“ „x von y Relays
  verbunden“; der Punkt leuchtet nur mit offener Verbindung und Netz.
- `shell/app.ts`: der Takt der Anzeige 5 s statt 30 s – er liest nur den
  Speicher, kein Netz (die Regel „kein neues `setInterval` fürs Netz“ bleibt).
- Texte: `nav.relaysVerbunden` statt `nav.relaysImPool`, Titel
  „Relay-Verbindungen“.

**Verdrahtet:** `aktualisiereNavStatus()` beim Start, alle 5 s, bei
online/offline und beim Öffnen von „Mehr“ (`shell/app.ts`).

**Tests:** protocol +1 (`ws-relay.test.ts`: erst nach dem ersten Gebrauch
verbunden, nach `close()` nicht mehr, ein toter Port nie). app: der Test zu
C.1a („im Pool, nie verbunden“) heißt jetzt C-16 – beide Zahlen im Satz,
„verbunden“ nur aus dem Getter, der Punkt nur mit offener Verbindung (Zahl
gleich). Smoke „rahmen“ prüft die Form „x von y Relays verbunden“ (ohne
Relays: 0), „fremdtext“ mit der Relay-Attrappe mindestens eine offene
Verbindung, `x/y` in der Leiste und den leuchtenden Punkt.

## Schritt C-10 – Communities nach E3 b

**Warum:** Am 27.09. entschieden (E3 b), nie gebaut (B6): Neben „offener“ und
„privater Raum“ gab es als dritten Begriff die „Community“ – eine lokale
Unterhaltung mit zufälliger Kennung, Nachrichten als Kind 42 mit `h`-Tag,
angelegt über `prompt()` (Sammlung C-10).

**Was:**
- Keine neuen Communities: Knopf `#chat-new-community`, `newCommunity()` und
  die Texte `komm.neueCommunity`/`komm.communityName` fallen weg – damit auch
  das letzte `prompt()` in `kommunikation.ts` (`NOCH_OFFEN` in
  `browser-dialoge.test.ts` nennt nur noch `agent.ts`).
- Bestehende stehen als „Community (offen)“ in der Raum-Leiste
  (`zeigeRaumLeiste()`: 🏠 + Anfangsbuchstabe, Name im Titel und als
  `aria-label`, nur als Text), nicht mehr unter den Direktnachrichten
  (`loadChatList()` zeigt nur `dm`). Angetippt zeigt `oeffneCommunity()` den
  Verlauf wie bisher; der Hinweis darüber nennt sie „Community (offen)“ und
  verweist auf Räume.
- Kein Format ändert sich.

**Verdrahtet:** `zeigeRaumLeiste()` (`shell/tabs/raeume.ts`, beim Öffnen der
Seite Kommunikation) → `oeffneCommunity()` (`shell/tabs/kommunikation.ts`).

**Tests:** app +2 in `test/communities.test.ts` (kein Anlegen mehr; in der
Leiste statt unter den Direktnachrichten, auch ohne Räume, Texte in beiden
Sprachen); `browser-dialoge.test.ts`: `kommunikation.ts` ohne Browser-Dialog.
Smoke „fremdtext“: eine gemerkte Community (Name mit HTML) steht in der
Leiste, nicht in der Liste der Direktnachrichten, und öffnet ihren Verlauf.

## Schritt C-11 – MLS-Engine nie beim Start

**Warum:** Die Regel „die Engine lädt erst bei Bedarf, nie beim Start“ galt
nur ohne private Räume (Sammlung C-11, aus dem Code gelesen). Jetzt im
Browser gemessen: Mit Tresor und einem gemerkten privaten Raum übersetzte die
App beim Start WebAssembly – `wireSpacesTab()` öffnete den ersten Raum
(private stehen vorn) und glich ihn per MLS ab, `wireNip34()` las die Repos
privater Räume aus dem MLS-Verlauf.

**Was:**
- `raeume.ts`: Der Start öffnet einen ersten Raum nur, wenn er offen ist;
  private öffnen erst beim Antippen in der Leiste. Ist ein privater Raum
  abgeglichen (die Engine läuft), lädt er die Repo-Liste mit den privaten
  Repos nach.
- `repos.ts`: `ladeNip34Repos({ privat: true })` schaltet die Repos privater
  Räume zu (`mitPrivaten`), ohne bleiben sie außen vor; die Seite Repos ruft es
  mit (`shell/app.ts`).

**Verdrahtet:** `wireSpacesTab()` (Start), `oeffneRaum()` (Antippen in der
Leiste), `switchTab("repos")` → `ladeNip34Repos({ privat: true })`.

**Tests:** app +2 in `test/mls-start.test.ts`. Smoke „mls_start“ (neu): ein
frisches Profil, ein privater Raum gemerkt, Tresor eingerichtet (der Eintrag
wandert hinein), neu laden und entsperren – dann gezählt, wie oft WebAssembly
übersetzt wird: beim Start 0, nach dem Öffnen der Kommunikation 0, nach dem
Antippen des privaten Raums 1; ebenso nach dem Öffnen der Seite Repos 1. Auf
dem alten Stand meldete er beim Start 1.

## Schritt C-15 – Raum-Repos, Rest aus 11.4c

**Warum:** Drei Reste aus 11.4c (#195, Sammlung C-15): „Zum Raum“ öffnete
auch einen öffentlichen Raum, dem man nicht beigetreten ist, ohne dort einen
Weg zum Beitreten; „Wo“ beim Ankündigen bot nur private Räume an (öffentliche
mit `repos_pflegen` erst in den Einstellungen eines Repos); beim Start lud die
Repo-Liste zweimal, wenn der erste Raum öffentlich war (`wireNip34()` und
`merkeRaumAdresse()`).

**Was:**
- `raeume.ts`: Knopf „Diesem Raum beitreten“ (`#space-hier-beitreten`) – nur
  in offenen Räumen, die nicht in der Leiste stehen (`beigetreten()`: dieselbe
  Adresse oder eine bloße Kennung von vor B-7); er tritt über denselben Weg bei
  wie das Menü (`raumBeitreten()`, B-7) und zeichnet die Leiste neu.
- `repos.ts`: „Wo“ bietet zusätzlich beigetretene öffentliche Räume, in denen
  ich Repos pflegen darf (`meineRepoRaeume()`, wie in den Einstellungen); die
  Adresse wird zum Verweis (`raum`), die Rückfrage nennt den Raum.
- `repos.ts`: `wireNip34()` lädt nicht mehr beim Start – die Seite Repos
  (`ladeNip34Repos({ privat: true })`) und Räume (`merkeRaumAdresse()`) laden.
  Weniger Abfragen beim Start, keine doppelte.

**Verdrahtet:** `zeigeRaumArt()`/`wireSpacesTab()` (`shell/tabs/raeume.ts`),
`kuendigeAn()` (Knopf „Ankündigen“ auf der Seite Repos).

**Tests:** app +3 in `test/raum-repos-rest.test.ts`; der Test zu C-11 prüft
jetzt, dass `wireNip34()` gar nicht lädt. Smoke „raum“: beigetreten kein
Knopf; ohne Eintrag in der Leiste führt „Zum Raum“ in den Raum, der Knopf ist
da, Beitreten nimmt ihn genau einmal wieder auf.

## Schritt B-9b1 – Halten beim eigenen Knoten: Protokoll und Knoten

Sammlung B-9 (Lokal 13.5), Entscheidung L4 A (MENSCH 01.10.: „Ja zu allen
Empfehlungen“ – L4, L5, L6, W2, T2 jeweils A, eingetragen in der Sammlung).
Bisher holte die Speicher-Rolle verschlüsselte Stücke nur aus dem Strom der
Relays und verdrängte sie nach LRU; einen Besitzer kannte sie nicht.

**Protokoll** (`blob.ts`, `kinds.ts`, `docs/PROTOCOL.md` §23):
- Kind 5076 (`KIND_DVM_BLOB_HALTEN`), Antwort 6076.
- `baueHalteAuftrag()`: DVM-Kern mit Blob-Id (`i`), Manifest-Id
  (`param manifest`) und Besitzer-Nachweis (`mitBesitzerNachweis()`, B-8),
  versiegelt vom Sitzungsschlüssel an den gekoppelten Knoten.
- `halteManifest()`: Manifest streng lesen – `parseBlobManifest()` prüft
  nichts. Nur genau dieser Blob, nur verschlüsselt, stimmige Erasure-Angaben,
  jede Kennung 64 Hex-Zeichen; `noetig` = Daten-Stücke über alle Gruppen.
- `leseHalteAntwort()` / `halteAntwortText()`: Antwort in fester Form.

**Knoten:**
- `dvm-provider.ts` – `handleBlobHalten()`: nur aus einem Umschlag und mit
  Nachweis (`istBesitzer()`), sonst „Halten nur für den Besitzer“. Genau das
  genannte Manifest (ein fremdes mit derselben Blob-Id zählt nicht), nur
  Stücke von dessen Autor mit den Hashes daraus, aufgenommen über `nimmAuf()`
  (nur Verschlüsseltes, 8.9a). Antwort versiegelt.
- `storage-role.ts` – `nimmAuf(ev, { halten: true })`: gehaltene Stücke
  stehen in `gehalten.json` (0600, je Hash einmal), die LRU verdrängt sie nie;
  sie zählen zur Quota – darüber „Speicher voll“. Nach einem Neustart wieder
  gelesen; abgerufen werden sie wie alle über 5075.
- `docs/PROVIDER.md`: ein Absatz unter „Mit dem Besitzer koppeln“.

**Fund:** Leere Füllstücke eines Blobs haben alle denselben Hash; die
Ablage hält jeden Hash einmal. Gezählt wird in der Antwort je Stück (Index),
in `gehalten.json` je Hash.

**Tests:** protocol +3 (`blob-halten.test.ts`: versiegelt, Kern mit Blob,
Manifest und Nachweis, offen steht nichts davon; ungültige Kennungen gehen
nicht hinaus; `halteManifest()` mit allen Negativfällen; Antwort nur in fester
Form), node +4 (`blob-halten.test.ts`: der Besitzer lässt halten – alle
Stücke, versiegelte Antwort, nach dem Neustart noch da; die LRU verdrängt
gehaltene nie, andere schon; ohne Nachweis, offen, mit fremdem Geheimnis oder
fremdem Manifest gleicher Blob-Id hält der Knoten nichts, kein Stück des
Angreifers; unverschlüsselt nie, über die Quota nie).

**Verdrahtet:** `packages/node/src/dvm-provider.ts` – `handleJob()` →
`handleBlobHalten()` → `halteManifest()`, `StorageRole.nimmAuf(…, { halten })`,
`halteAntwortText()`. `baueHalteAuftrag()` und `leseHalteAntwort()` stehen bis
B-9b2 in `scripts/wiring-ausnahmen.txt`.

Endstand (B-9b1, 01.10.): protocol 1151 (+3, 6 übersprungen) · node 284 (+4, 7
übersprungen ohne Netz – mit Netz 285) · app 772 · mls 13 · Leak-Tests 69 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden. Knoten-Stand: für das Halten nötig (B-9b1,
mit `STORAGE_ENABLED=1`); KI-Anfragen unberührt.

## Schritt B-9b2 – Halten beim eigenen Knoten: App

Sammlung B-9, Entscheidung L4 A, zweiter Teil (b1: #252, Protokoll und Knoten).

**App:**
- Settings → Geräte → „Mein Knoten“: Haken „Meine Dateien bei meinem Knoten
  halten“ – nur gekoppelt zu sehen, Standard an, gemerkt als `1`/`0` in
  `freedom.knoten.halten` (`knoten-halten.ts`, `haltenAn()`; eine Einstellung,
  kein Geheimnis).
- `halteBeiMeinemKnoten()` (`shell/knoten-halten-ui.ts`): nur gekoppelt und mit
  Haken; frischer Sitzungsschlüssel, `baueHalteAuftrag()` an genau das
  Manifest, Rechenarbeit aus dem Angebot des Knotens bis 16 Bit (wie
  `MAX_POW_APP`). Gewartet wird höchstens 90 s auf die versiegelte Antwort zu
  genau diesem Auftrag (6076 oder Rückmeldung 7000); gezeigt nur als fester
  Text: alle Stücke, n von m, keins, antwortet nicht, lehnt ab (Grund gekürzt,
  nur als Text). Scheitert es, gilt der Upload trotzdem.
- Aufgerufen nach jedem verschlüsselten Upload: `ladeBundleHoch()`
  (`tabs/repos.ts`, nie für die Kopie nur auf dem Gerät) und Chat-Anhänge
  (`tabs/kommunikation.ts`, eine Zeile in einer Datei der Spur C).
  `uploadAnhang()` (`blob-client.ts`) nennt dafür die Manifest-Id.
- `scripts/wiring-ausnahmen.txt`: `baueHalteAuftrag` und `leseHalteAntwort`
  fallen weg (verdrahtet).
- Eigenes Modul `shell/knoten-halten-ui.ts` (Haken und Auftrag):
  `mein-knoten.ts` hält den Kopplungscode und schickt nichts hinaus – das
  prüft der Test aus B-8c (kein `localStorage`, kein `publish`); er blieb
  unverändert, `mein-knoten.ts` blendet nur die Zeile ein.

**Tests:** app +3 (`knoten-halten.test.ts`: Haken, Ergebnis, Grund; nur
gekoppelt und mit Haken, frischer Sitzungsschlüssel, genau das Manifest, nur
feste Texte, nur die Antwort zu diesem Auftrag; nach Bundles und Anhängen, nie
lokal), Leak-Tests +1 (`leak/mein-knoten.test.ts`: nur ein Umschlag, Blob,
Manifest und Nachweis nirgends offen, Identität verborgen). Smoke
„einstellungen“: gekoppelt erscheint der Haken (an), aus wird gemerkt,
entkoppelt verschwindet er.

**Verdrahtet:** `packages/app/src/shell/tabs/repos.ts` – `ladeBundleHoch()` →
`halteBeiMeinemKnoten()`; `packages/app/src/shell/tabs/kommunikation.ts` –
Anhang → `halteBeiMeinemKnoten()`; `packages/app/src/shell/knoten-halten-ui.ts` →
`baueHalteAuftrag()`, `leseHalteAntwort()`.

Endstand (B-9b2, 02.10.): protocol 1151 (6 übersprungen) · node 284 (7
übersprungen ohne Netz – mit Netz 285) · app 775 (+3) · mls 13 · Leak-Tests 70
grün (+1) + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website ok · Smoke-Test bestanden. Knoten-Stand: B-9b1 (#252) mit
`STORAGE_ENABLED=1`, sonst antwortet der Knoten „keine Speicher-Rolle“.

## Schritt B-9c1 – Alles über meinen Knoten: der Knoten liest sein eigenes Relay

Sammlung B-9c (Lokal 13.3/13.5), Entscheidung L5 A, erster Teil. Bisher las
der Provider nur `RELAYS` – über das Netz, ohne Anmeldung. Kam eine Anfrage
nur über das Relay des Knotens, sah er sie nicht; eine Verbindung zu sich selbst
sähe keine Umschläge (Anmeldepflicht seit 8.4c).

**Knoten** (`relay-role.ts`, `main.ts`):
- `aufnehmen()`: die Annahme eines Events, ausgelagert aus `nimmAn()` – Form,
  Größe, Signatur, Zugang (beschränkt), Ablauf (NIP-40), Platz; der Flutschutz
  je Schlüssel nur für Fremde. Über das Netz unverändert (dieselben Antworten).
- `alsRelay(ich)`: der Relay im eigenen Prozess als `Relay` für den Pool –
  lesen wie mit `ich` angemeldet (Umschläge nur an den Knoten), schreiben über
  `aufnehmen()`. Adresse ist die öffentliche (`RELAY_PUBLIC_URL`), sonst
  `intern://relay-rolle`.
- `main.ts`: nach dem Start `pool.removeRelay(intern.url)` und
  `pool.addRelay(intern)` – eine Verbindung zu sich selbst aus `RELAYS` ersetzt
  der Weg im Prozess.

**Folge:** Eine Anfrage, die nur über das Relay des Knotens kommt, erreicht den
Provider (KI, Halten, Abruf); seine Antwort liegt dort und geht nur an den
Sitzungsschlüssel, der sich dort anmeldet. Die App nutzt das ab B-9c2.

**Tests:** node +3 (`relay-intern.test.ts`: dieselben Regeln, Umschläge nur an
den Knoten, im Prozess geschrieben über das Netz lesbar, kaputte Signatur und
fehlender Zugang abgelehnt; Ende zu Ende nur über das Relay des Knotens – die
Anfrage kommt an, die Antwort bekommt nur der angemeldete Sitzungsschlüssel;
Verdrahtung in `main.ts`).

**Verdrahtet:** `packages/node/src/main.ts` – `relayRole.alsRelay(keypair.pk)`
→ `pool.addRelay()`; `relay-role.ts` – `nimmAn()` → `aufnehmen()`.

Endstand (B-9c1, 02.10.): protocol 1151 (6 übersprungen) · node 287 (+3, 7
übersprungen ohne Netz – mit Netz 288) · app 775 · mls 13 · Leak-Tests 70 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden. Knoten-Stand: für den Weg über das eigene
Relay nötig (B-9c1, mit `RELAY_ENABLED=1`); sonst unverändert.

## Schritt B-9c2 – Alles über meinen Knoten: die App

Sammlung B-9c (Lokal 13.3/13.5), Entscheidung L5 A, zweiter Teil. Seit B-9c1
liest der Knoten sein eigenes Relay im Prozess; die App schickte Aufträge an
ihn bisher über die Relays des Pools.

**App** (`knoten-weg.ts`, `shell/knoten-weg-ui.ts`):
- Haken „Alles über meinen Knoten“ in Settings → Geräte → „Mein Knoten“: nur
  gekoppelt sichtbar, Standard aus, gemerkt in `freedom.knoten.nurUeber`
  (eine Einstellung, kein Geheimnis).
- `knotenRelay()`: Kommt die App vom Knoten (B-10), gilt ihr eigener Ursprung,
  aber nur, wenn NIP-11 dort genau den Schlüssel des Knotens nennt. Sonst gilt
  seine NIP-65-Liste (Kind 10002): nur von ihm signiert, die neueste, das erste
  Relay mit öffentlicher Adresse, das nicht nur zum Lesen ist.
- `wegZumKnoten()`: Mit Haken entsteht eine eigene Verbindung zu diesem Relay.
  Dort meldet sich der Sitzungsschlüssel des Auftrags an (NIP-42), sonst
  nirgends. Ohne Relay liefert die Funktion `null`, und nichts geht hinaus.
  Ohne Haken läuft alles über den Pool wie bisher.
- KI an „Mein Knoten“ (`frageMeinenKnoten()`) und Halten
  (`halteBeiMeinemKnoten()`) senden und lesen über diesen Weg. Die Verbindung
  wird danach geschlossen.
- Antworten fragt der Weg nur für den Schlüssel des Auftrags ab
  (`sitzungPk`). Das Relay des Knotens liefert Umschläge nur, wenn jeder
  Schlüssel im Filter angemeldet ist. Mit mehreren Sitzungen wäre die Antwort
  sonst still ausgeblieben.

**Offen:** „Relays“ über den Knoten (B-9: „KI, Speicher, Relays“) ist nicht
eindeutig, deshalb Frage L7 in der Sammlung, Abschnitt 5. Bis dahin tut der
Haken genau das, was sein Text sagt: KI und Halten.

**Tests:** app +4 (`knoten-weg.test.ts`):
- Haken: Standard aus.
- Relay aus der Liste: nur vom Knoten, die neueste, keine privaten Adressen,
  keine reinen Lese-Relays.
- Eigener Ursprung nur mit dem Schlüssel des Knotens.
- Weg: ohne Relay nichts; Anmeldung mit `baueRelayAuth()` nur in `state.ts`
  und hier; KI und Halten nur über den Weg; Antworten nur für den Schlüssel
  des Auftrags; Texte in beiden Sprachen.

Angepasst wurden `mein-knoten-wahl.test.ts`, `knoten-halten.test.ts` und
`ki-antworten.test.ts` (Weg statt Pool, `privateAntworten()` mit `opts.quelle` –
weiter nur private Antworten). Der Smoke-Test prüft den Haken: gekoppelt sichtbar,
Standard aus, „an“ gemerkt, nach dem Entkoppeln weg.

Ende zu Ende ist der Weg im Knoten getestet (B-9c1, `relay-intern.test.ts`):
Anmeldung mit dem Sitzungsschlüssel, die Anfrage kommt nur über das Relay des
Knotens an, die Antwort nur an den angemeldeten Schlüssel.

**Verdrahtet:**
- `packages/app/src/shell/app.ts`: `wireKnotenWeg()` in `starte()`.
- `shell/tabs/agent.ts`: `frageMeinenKnoten()` → `wegZumKnoten()` →
  `weg.publish()` und `waitForAnswer(…, { quelle: weg })`.
- `shell/knoten-halten-ui.ts`: `halteBeiMeinemKnoten()` → `wegZumKnoten()`.
- `shell/mein-knoten.ts`: Zeile des Hakens.

Endstand (B-9c2, 02.10.): protocol 1151 (6 übersprungen) · node 287 (7
übersprungen ohne Netz – mit Netz 288) · app 779 (+4) · mls 13 · Leak-Tests 70
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website ok · Smoke-Test bestanden. Knoten-Stand: B-9c1 (#254) mit
`RELAY_ENABLED=1` und `RELAY_PUBLIC_URL` (oder die App vom Knoten); ohne
Haken unverändert.

## Schritt B-11a – Status meines Knotens: Protokoll und Knoten

Sammlung B-11 („Knoten aus der App verwalten“), Entscheidung L6 A: zuerst nur
lesen. Steuern (Modelle laden, Neustart, Einstellungen) wäre L6 B und eine
eigene Entscheidung.

**Protokoll** (`knoten-status.ts`, Kind 5077, `docs/PROTOCOL.md` 24):
- `baueStatusAuftrag()`: nur versiegelt vom Sitzungsschlüssel an den
  gekoppelten Knoten, mit Besitzer-Nachweis (B-8), ohne Gebot.
- `knotenStatusText()` schreibt die Antwort in fester Form, `leseKnotenStatus()`
  liest sie streng. Inhalt:
  - Fassung und Start;
  - gestartete Rollen als feste Kennungen (`STATUS_ROLLEN`);
  - angebotene Modelle (höchstens 50, ohne Steuerzeichen);
  - Aufträge seit dem Start (erledigt, gratis, abgelehnt);
  - abgerechnete msat;
  - Speicher und Relay.
- Unbekannte Felder bleiben unbeachtet, damit ein neuerer Knoten mehr melden
  kann (B-11c).

**Knoten** (`dvm-provider.ts`, `main.ts`):
- `handleKnotenStatus()` antwortet nur aus einem Umschlag mit `istBesitzer()`,
  versiegelt (6077). Nach außen gehen nur die festen Texte „Status nur für den
  Besitzer“ und „kein Status“.
- Der Provider zählt Aufträge im Speicher (`zaehle()`), Statusabfragen nicht.
  Den Speicher liest er aus der eigenen Speicher-Rolle.
- `main.ts` liefert Fassung (`package.json`), Start, Modelle (dieselben wie im
  Angebot, `angebotModelle()`) und Relay-Zahlen.
- Eine Rolle meldet `main.ts` erst, wenn sie gestartet ist
  (`statusRollen.add()`).
- Kein Text aus Aufträgen, keine Meldungen, keine Adressen.

**Tests:**
- protocol +3 (`knoten-status.test.ts`):
  - Auftrag versiegelt, mit Nachweis, offen steht nichts;
  - Antwort hin und zurück;
  - unbekannte Felder bleiben unbeachtet;
  - 32 kaputte Antworten ergeben null.
- node +4 (`knoten-status.test.ts`):
  - der Besitzer bekommt die Antwort versiegelt, mit Zählern (ein gratis
    erledigter, ein abgelehnter Auftrag), ohne den Text der Frage;
  - die Statusabfrage zählt nicht;
  - ohne Nachweis, mit fremdem Geheimnis oder offen: kein Status, feste
    Rückmeldung;
  - ohne Konfiguration „kein Status“;
  - in `main.ts` kommen die Rollen erst nach dem Start.

**Verdrahtet:**
- `packages/node/src/dvm-provider.ts`: `handleJob()` → `handleKnotenStatus()`;
  `pollOnce()` → `zaehle()`.
- `packages/node/src/main.ts`: `status:` in der Konfiguration des Providers,
  `statusRollen.add()` an jeder Rolle.
- Die App folgt mit B-11b.

Endstand (B-11a, 02.10.): protocol 1154 (+3, 6 übersprungen) · node 291 (+4,
7 übersprungen ohne Netz – mit Netz 292) · app 779 · mls 13 · Leak-Tests 70
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 (zwei Ausnahmen bis
B-11b) · innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden.
Knoten-Stand: für den Status nötig (B-11a); sonst unverändert.

## Schritt B-11b – Status meines Knotens: die App

Sammlung B-11, Entscheidung L6 A, zweiter Teil. Der Knoten beantwortet die
Statusabfrage seit B-11a (#256); jetzt fragt die App.

**App** (`knoten-status-ansicht.ts`, `shell/knoten-status-ui.ts`):
- Knopf „Status abfragen“ in Settings → Geräte → „Mein Knoten“: nur gekoppelt
  sichtbar, gefragt wird nur beim Klick, nie beim Start.
- `zeigeKnotenStatus()` fragt mit einem frischen Sitzungsschlüssel versiegelt
  und mit Nachweis (`baueStatusAuftrag()`). Der Weg ist der aus B-9c2
  (`wegZumKnoten()`): mit Haken nur über das Relay des Knotens, ohne Relay geht
  nichts hinaus.
- Die App wartet auf 6077 oder eine Rückmeldung. Gezeigt wird nur, was
  `leseKnotenStatus()` durchlässt.
- `statusZeilen()` bildet daraus Zeilen in der Sprache der App:
  - Fassung und Start;
  - Rollen, übersetzt aus festen Kennungen (`ROLLEN_TEXT`);
  - Modelle, wie gemeldet;
  - Aufträge;
  - Abgerechnetes in sats und SOL (`ausMsat()`, ohne Kurs kein SOL-Betrag);
  - Speicher und Relay.

  Die Zeilen kommen nur als Text in den DOM (`el()`).
- Nichts davon wird gemerkt. Entkoppelt bleibt keine alte Anzeige stehen.
- `scripts/wiring-ausnahmen.txt`: Die zwei Ausnahmen aus B-11a sind gestrichen,
  beide Exporte sind jetzt verdrahtet.

**Tests:** app +3 (`knoten-status.test.ts`):
- Zeilen auf Deutsch und Englisch: Rollen übersetzt, Modellnamen nur als Text,
  Beträge mit und ohne Kurs, leere Listen „keine“, ohne Speicher und Relay
  keine Zeile.
- Jede Rolle hat einen Text in beiden Sprachen.
- Verdrahtung: nur beim Klick, über den Weg, ohne Relay nichts, nur gelesener
  Status, kein `innerHTML`, `localStorage` oder Pool; nur gekoppelt sichtbar;
  `mein-knoten.ts` bleibt frei von `localStorage` und `publish`.

Der Smoke-Test prüft den Knopf: gekoppelt sichtbar, die Anzeige leer (gefragt
wird erst beim Klick), nach dem Entkoppeln weg.

**Verdrahtet:**
- `packages/app/src/shell/app.ts`: `wireKnotenStatus()` in `starte()`.
- `shell/knoten-status-ui.ts`: `zeigeKnotenStatus()` → `wegZumKnoten()` →
  `baueStatusAuftrag()` → `leseKnotenStatus()` → `statusZeilen()`.
- `shell/mein-knoten.ts`: Knopf nur bei Kopplung.

Endstand (B-11b, 02.10.): protocol 1154 (6 übersprungen) · node 291 (7
übersprungen ohne Netz – mit Netz 292) · app 782 (+3) · mls 13 · Leak-Tests 70
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 (Ausnahmen aus B-11a
gestrichen) · innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden.
Knoten-Stand: B-11a (#256) für den Status; sonst unverändert.

## Schritt B-11c – Status meines Knotens: Prüfung der Einrichtung

Sammlung B-11, Entscheidung L6 A, dritter Teil. Die Selbstprüfung (8.2a)
schrieb bisher nur deutsche Sätze mit Adressen ins Log. Für den Status an den
Besitzer braucht sie Kennungen.

**Knoten** (`einrichtung.ts`, `kanal-kasse.ts`, `main.ts`):
- Jeder Befund trägt jetzt eine Kennung (`fall`, z. B. `ln.ok`,
  `sol.wenigGuthaben`) – 27 Fälle.
- Werte (`werte`) sind nur Zahlen (sats, Lamports, HTTP-Status) und
  Fehlernamen. Der Satz fürs Log und `npm run pruefen` bleibt unverändert.
- `kanalKasseAusUmgebung()` nennt neben dem Satz `grund` eine Kennung
  (`KanalAusFall`), daraus wird `sol.kanal…`.
- `main.ts` merkt sich die Befunde vom Start. Der Status gibt sie mit
  (`einrichtung`), nur Kennung, Stufe und Werte.

**Protokoll** (`knoten-status.ts`, `docs/PROTOCOL.md` 24):
- `einrichtung` ist optional: Es fehlt, solange die Prüfung läuft, und bei
  Knoten vor B-11c.
- Ist es da, liest `leseKnotenStatus()` nur ganz richtige Befunde:
  - Schiene und Stufe aus festen Werten;
  - Kennung `ln.…` oder `sol.…`;
  - höchstens 6 Werte, nur ganze Zahlen ab 0 oder Fehlernamen aus Buchstaben.

  Keine Adresse passt durch.

**App** (`knoten-status-ansicht.ts`):
- `EINRICHTUNG_TEXT` hat je Kennung einen Text in beiden Sprachen.
- `befundZeile()` setzt Zeichen, Schiene und Text zusammen; Lamports zeigt sie
  als SOL.
- Eine unbekannte Kennung (neuerer Knoten) erscheint nur mit Kennung und
  Stufe.
- Fehlt die Prüfung, steht dort „noch nicht geprüft – oder der Knoten ist
  älter“ – nie ein erfundenes „alles gut“.

**Tests:**
- protocol +1 (`knoten-status.test.ts`): Befunde hin und zurück; ohne Prüfung
  kein Feld; 11 kaputte Fälle ergeben null, darunter eine Adresse als Wert, ein
  Satz als Kennung und eine Meldung als Fehlername.
- node +1 (`knoten-status.test.ts`): Befunde gehen mit. In
  `einrichtung.test.ts` kommen Kennungen und Werte je Fall dazu, ohne Adresse
  in den Werten. `kanal-kasse.test.ts`, `lnurl-server.test.ts` und
  `sol-auszahlung.test.ts` erwarten jetzt die Kennung, sonst unverändert.
- app +2 (`knoten-status.test.ts`):
  - Zeilen auf Deutsch und Englisch, SOL aus Lamports, Unbekanntes nur mit
    Kennung.
  - Jede Kennung des Knotens hat einen Text, gelesen aus dem Quelltext des
    Knotens, und keine ohne Knoten.

  Die Zeilenzahlen aus B-11b haben jetzt eine Zeile mehr (die Einrichtung).

**Verdrahtet:**
- `packages/node/src/main.ts`: `pruefeEinrichtung()` → `einrichtung = befunde`
  → `status: () => ({ …, einrichtung })`.
- `packages/app/src/knoten-status-ansicht.ts`: `statusZeilen()` →
  `befundZeile()` (aus `zeigeKnotenStatus()`, B-11b).

Endstand (B-11c, 02.10.): protocol 1155 (+1, 6 übersprungen) · node 292 (+1,
7 übersprungen ohne Netz – mit Netz 293) · app 784 (+2) · mls 13 · Leak-Tests
70 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng
Exit 0 · Website ok · Smoke-Test bestanden. Knoten-Stand: für die Einrichtung
im Status nötig (B-11c); ein älterer Knoten zeigt „noch nicht geprüft“.

## Schritt B-12a – Weckdienst: Anmeldung beim eigenen Knoten

Sammlung B-12 („Weckdienst“), Entscheidungen W1 A und W2 A, erster Teil. Ist
die App zu, soll der eigene Knoten den Browser wecken – ohne Inhalt, ohne
Absender. Dafür muss er wissen, wohin (Push-Adresse) und für wen (Schlüssel).

**Protokoll** (`wecken.ts`, Kind 5078, `docs/PROTOCOL.md` 25):
- `baueWeckAnmeldung()`: An- oder Abmeldung, nur versiegelt vom
  Sitzungsschlüssel an den gekoppelten Knoten, mit Besitzer-Nachweis.
- `pruefeWeckEndpunkt()`: nur https, öffentlicher Host, ohne Zugangsdaten,
  höchstens 1000 Zeichen.
- Beobachtet werden 1–20 Schlüssel (die Person, ihre Geräte).
- Der Knoten liest nur über `leseWeckAnmeldung()`: je Name genau ein Wert,
  nichts Unbekanntes.
- Antwort 6078 (`leseWeckAntwort()`).
- Der Status (5077) nennt den öffentlichen VAPID-Schlüssel des Knotens
  (`weckSchluessel`, optional, genau 87 Zeichen base64url).

**Knoten** (`wecken.ts`, `dvm-provider.ts`, `main.ts`):
- `ladeVapid()`: eigenes P-256-Schlüsselpaar mit `node:crypto`, beim ersten
  Start erzeugt (`~/.freedom/vapid.json`, 0600). Eine kaputte Datei bleibt
  liegen – dann gibt es keinen Weckdienst, nie einen neuen Schlüssel darüber.
- `WeckBuch`: Anmeldungen je Push-Adresse in `~/.freedom/wecken.json` (0600),
  höchstens 10. „an“ ersetzt dieselbe Adresse, „ab“ entfernt sie, `vergiss()`
  für abgelaufene (B-12b).
- `handleWecken()`: nur aus einem Umschlag mit `istBesitzer()`. Nach außen nur
  feste Texte; die Push-Adresse nie ins Log. Weck-Anmeldungen zählen wie
  Statusabfragen nicht als Aufträge.
- Geweckt wird erst ab B-12b.

**Neue Frage W3** (Sammlung, Abschnitt 5): Den Service Worker (B-12c) meldet die
App nur an, wenn die CSP `worker-src 'self'` erlaubt. CLAUDE.md verlangt, vorher
zu fragen. Vorschlag A.

**Tests:**
- protocol +4 (`wecken.test.ts`):
  - Anmeldung versiegelt mit Nachweis, offen weder Adresse noch Schlüssel;
  - Abmelden;
  - 14 ungültige Push-Adressen (http, lokal, privat auch als IPv4 in IPv6,
    `.local`, ohne Punkt, Zugangsdaten, Fragment, zu lang);
  - ungültige Anmeldungen gehen nicht hinaus, kaputte Kerne werden nicht
    gelesen;
  - Antwort und Weckschlüssel nur in fester Form, mit einem echten
    P-256-Schlüssel geprüft.
- node +5 (`wecken.test.ts`):
  - VAPID: 0600, derselbe nach dem Neustart, Signatur prüfbar, kaputt bleibt
    kaputt;
  - `WeckBuch`: ersetzen, entfernen, höchstens zehn, 0600, streng gelesen;
  - der Besitzer meldet an und ab, die Adresse steht nie im Log, der Status
    nennt den Schlüssel, Anmeldungen zählen nicht;
  - ohne Nachweis, mit fremdem Geheimnis oder ohne Buch keine Anmeldung;
  - Verdrahtung in `main.ts`.

**Verdrahtet:**
- `packages/node/src/main.ts`: `ladeVapid(vapidDatei())`,
  `new WeckBuch(weckDatei())` → `DvmProvider({ weckBuch })`,
  `weckSchluessel: vapid?.oeffentlich` im Status.
- `packages/node/src/dvm-provider.ts`: `handleJob()` → `handleWecken()`.
- Die App folgt mit B-12d. Bis dahin stehen `baueWeckAnmeldung` und
  `leseWeckAntwort` mit Begründung in `scripts/wiring-ausnahmen.txt`.

Endstand (B-12a, 02.10.): protocol 1159 (+4, 6 übersprungen) · node 297 (+5,
7 übersprungen ohne Netz – mit Netz 298) · app 784 · mls 13 · Leak-Tests 70
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 (zwei Ausnahmen bis
B-12d) · innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden.
Knoten-Stand: für Weck-Anmeldungen nötig (B-12a); sonst unverändert.

## Schritt B-12b – Weckdienst: der Knoten weckt

Sammlung B-12, Entscheidungen W1 A und W2 A, zweiter Teil. Seit B-12a nimmt
der Knoten Push-Adressen und Schlüssel seines Besitzers an; jetzt weckt er.

**Knoten** (`wecken.ts`, `relay-role.ts`, `main.ts`):
- `WeckDienst.pruefe()` läuft alle 30 s (`WECKEN_TAKT_MS`) und sucht Umschläge
  (1059) an die gemeldeten Schlüssel:
  - im eigenen Relay über `RelayRole.umschlaegeAn()` – nur Kennung, Zeit und
    Empfänger, nie der Inhalt; `alsRelay()` bleibt beim Schlüssel des Knotens;
  - außer mit `WECKEN_RELAYS=eigen` auch in den Relays des Pools.
- **Neu nach Kennung, nicht nach Zeit:** Umschläge sind bis zu zwei Tage
  zurückdatiert (NIP-59), also gilt ein Fenster von zwei Tagen und eine Stunde,
  dazu die gemerkten Kennungen. Was schon lag, als ein Schlüssel dazukam (auch
  beim Start), weckt nie.
- **Die Nachricht ist leer:** VAPID-Kopf (`vapidKopf()`, ES256 über
  `node:crypto`, `aud` = Ursprung der Adresse, 12 h), `TTL: 3600`,
  `Urgency: high`, `Topic: freedom` – wartende Weckrufe ersetzen sich.
- **Senden:** `sendePush()` erst nach `checkUrlSafe()` (kein privates Ziel),
  ohne Weiterleitung, 10 s Zeit.
- **Gebremst:** je Adresse höchstens einmal je Minute.
- **Abgelaufen:** 404 oder 410 → `vergiss()`.
- **Fehler** einer Adresse halten die anderen nicht auf.
- **Ins Log** nie Adresse oder Meldung, nur der Fehlername bzw. der HTTP-Status.
- `WECKEN_KONTAKT` ersetzt den Kontakt im Token (Standard: die Projektseite).

**Tests:** node +7 (`wecken-dienst.test.ts`):
- VAPID-Kopf mit dem öffentlichen Schlüssel prüfbar, Token-Inhalt und
  Kopfzeilen fest;
- neue Post weckt genau die passende Adresse, einmal, auch zurückdatiert; was
  schon da war, nicht;
- Bremse je Adresse; später gemeldete Schlüssel beginnen mit Grundstand; ohne
  Anmeldung keine Abfrage;
- 410 vergessen, Fehler halten die andere Adresse nicht auf, das Log ohne
  Adresse;
- `sendePush` nie an private Ziele;
- `umschlaegeAn()` ohne Inhalt, über den Pool weiter nicht sichtbar;
- Verdrahtung in `main.ts`.

**Verdrahtet:** `packages/node/src/main.ts`: `new WeckDienst({ buch, vapid,
abfrage: relayRole?.umschlaegeAn + pool.query })` → `setInterval(…pruefe(),
WECKEN_TAKT_MS)`, nur mit Schlüssel und Buch, nach dem Start des Relays.

Endstand (B-12b, 02.10.): protocol 1159 (6 übersprungen) · node 304 (+7, 7
übersprungen ohne Netz – mit Netz 305) · app 784 · mls 13 · Leak-Tests 70 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden. Knoten-Stand: für das Wecken nötig (B-12b);
geweckt wird erst, wenn die App anmeldet (B-12c/d, wartet auf W3).

## Schritt B-13a – Anrufe: TURN-Zugang beim eigenen Knoten

Sammlung B-13 („Anrufe“), Entscheidungen T1 A und T2 A, erster Teil. Anrufe
sollen nur über einen Vermittler (TURN) auf dem eigenen Knoten laufen – das
Gegenüber sieht nie die IP. Den Vermittler stellt coturn als eigener Dienst
(keine npm-Abhängigkeit); der Knoten vergibt nur kurzlebige Zugänge.

**Protokoll** (`turn-zugang.ts`, Kind 5079, `docs/PROTOCOL.md` 26):
- `baueTurnAnfrage()`: nur versiegelt vom Sitzungsschlüssel an den gekoppelten
  Knoten, mit Besitzer-Nachweis, ohne Gebot.
- `leseTurnZugang()` liest die Antwort (6079) streng:
  - 1–4 Adressen `turn:`/`turns:` (`istTurnUrl()`);
  - Nutzer `Ablauf:Zufall`, Passwort base64(HMAC-SHA1), 28 Zeichen;
  - Ablauf gleich dem im Nutzernamen, in der Zukunft, höchstens einen Tag
    entfernt.
- Status: neue Rolle `turn`. Unbekannte Rollen bleiben jetzt unbeachtet –
  bisher machte jede neue Rolle den Status für ältere Apps unlesbar.

**Knoten** (`turn.ts`, `dvm-provider.ts`, `main.ts`):
- `turnAusUmgebung()`: `TURN_URLS` (1–4), `TURN_SECRET` ab 32 Zeichen,
  `TURN_GUELTIG_SEK` (60 bis 86400, Standard 3600) – nie halb. Ein Geheimnis
  ohne Adresse ist ein Fehler, keine Wahl.
- `turnZugang()`: je Anfrage ein frischer Zugang nach TURN-REST, so wie coturn
  ihn mit `use-auth-secret` prüft.
- `handleTurn()`: nur aus einem Umschlag mit `istBesitzer()`, versiegelt. Nach
  außen nur feste Texte; der Zugang nie ins Log. Zählt nicht als Auftrag.
- Die Rolle `turn` meldet der Knoten nur mit gültiger Umgebung.

**Neue Frage T3** (Sammlung, Abschnitt 5): Wer angerufen wird und keinen eigenen
Knoten hat, hat keinen eigenen Vermittler. Vorschlag B: Die Anruferin gibt einen
kurzlebigen Zugang zu ihrem TURN mit, mit ehrlichem Hinweis vor dem Annehmen.

**Ein unsicherer Test behoben:** Zwei Tests (`turn-zugang.test.ts` neu,
`knoten-status.test.ts` aus B-11a) suchten die Nummer des Kinds („5079“,
„5077“) im Text des Umschlags. In den Hex-Feldern steht sie gelegentlich
zufällig; ein voller Lauf schlug so einmal an. Sie prüfen jetzt die Struktur
(`wrap.tags` nur `p`) – ein neuer Fallstrick in CLAUDE.md. Danach lief der Test
achtmal hintereinander grün.

**Tests:**
- protocol +2 (`turn-zugang.test.ts`): Anfrage versiegelt mit Nachweis; Zugang
  nur in der Form von TURN-REST, mit 18 kaputten Fällen, abgelaufen und mehr als
  ein Tag. In `knoten-status.test.ts` bleibt eine unbekannte Rolle unbeachtet.
- node +5 (`turn.test.ts`):
  - Umgebung nie halb;
  - Zugang wie coturn ihn prüft, je Anfrage neu;
  - der Besitzer bekommt ihn versiegelt, nie im Log, nicht als Auftrag gezählt,
    der Status nennt `turn`;
  - ohne Nachweis, mit fremdem Geheimnis oder ohne TURN kein Zugang;
  - Verdrahtung in `main.ts`.

**Verdrahtet:**
- `packages/node/src/main.ts`: `turnAusUmgebung(process.env)` →
  `DvmProvider({ turn })`, `statusRollen.add("turn")`.
- `packages/node/src/dvm-provider.ts`: `handleJob()` → `handleTurn()`.
- Die App folgt mit B-13d. Bis dahin stehen `baueTurnAnfrage` und
  `leseTurnZugang` mit Begründung in `scripts/wiring-ausnahmen.txt`.

Endstand (B-13a, 02.10.): protocol 1161 (+2, 6 übersprungen) · node 309 (+5,
7 übersprungen ohne Netz – mit Netz 310) · app 784 · mls 13 · Leak-Tests 70
grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 (zwei Ausnahmen bis
B-13d) · innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden.
Knoten-Stand: für TURN-Zugänge nötig (B-13a), dazu coturn (B-13b) und
`TURN_URLS`/`TURN_SECRET`; sonst unverändert.

## Schritt B-13b – Anrufe: coturn in Installer und Docker

Sammlung B-13, Entscheidung T2 A, zweiter Teil. Seit B-13a vergibt der Knoten
Zugänge nach TURN-REST; jetzt gibt es den Vermittler dazu – coturn als eigener
Dienst, keine npm-Abhängigkeit.

**`scripts/turn-einrichten.sh`** `<ziel> <öffentlicher-name> [--docker]` schreibt
die Datei für coturn mit 0600:
- **Nur TURN-REST:** `use-auth-secret`, das Geheimnis zufällig mit 64 Hex-Zeichen.
  Keine festen Nutzer, keine Konsole.
- **Nie in private Netze:** `denied-peer-ip` für alle privaten, lokalen und
  reservierten Bereiche, IPv4 und IPv6 – sonst wäre der TURN ein Weg ins
  Heimnetz.
- **Grenzen:** je Nutzer 4 Sitzungen, gesamt 40, je Sitzung 500 000 Byte/s
  (rund 4 Mbit/s).
- **Kein Protokoll:** Die IPs der Gesprächspartner gehören nicht auf die Platte.
- **Ausgabe:** `TURN_SECRET`/`TURN_URLS` für die Umgebung des Knotens, mit
  `--docker` auch `TURN_UID`/`TURN_GID`. Der Name wird geprüft; eine vorhandene
  Datei wird nie überschrieben.

**Installer** (`install-freedom.sh`):
- Optionaler Schritt „Anrufe“ (`TURN_NAME`, sonst eine Frage; leer: aus).
- coturn kommt aus dem Paket; dessen Dienst bleibt aus.
- Eigener Dienst `freedom-turn` als Nutzer mit `-c ~/.freedom/turnserver.conf`
  – das Geheimnis nie auf der Befehlszeile.
- `TURN_SECRET`/`TURN_URLS` in der Umgebungsdatei, dazu ein Hinweis auf die
  Ports.

**Docker** (`docker-compose.yml`):
- Profil „anrufe“ mit `coturn/coturn:4.18` (feste Version), Netz des Hosts, als
  Nutzer (die Datei hat 0600).
- `TURN_URLS`/`TURN_SECRET` für den Knoten.
- Kein `${…:?}`: Compose liest die ganze Datei auch ohne das Profil.

**`.gitignore`:** `turnserver.conf` und `.env` – beide tragen das Geheimnis.

**Tests:** node +3 (`turn-einrichten.test.ts`):
- Das Skript läuft wirklich: 0600, Pflichtzeilen, keine festen Nutzer, alle
  privaten Bereiche gesperrt.
- Seine Ausgabe nimmt `turnAusUmgebung()` an; überschrieben wird nie.
- Ungültige Namen (Leerzeichen, Befehle, `$`, zu lang) und Aufrufe gehen nicht
  durch; `--docker` nennt den Nutzer.
- Installer und Docker: der Name nur als Argument, das Geheimnis nie
  ausgegeben, feste Version, Profil, nie eingecheckt.

**Verdrahtet:**
- `scripts/install-freedom.sh` → `scripts/turn-einrichten.sh` →
  `freedom-turn.service` und `TURN_SECRET`/`TURN_URLS` in `node.env` →
  `turnAusUmgebung()` (B-13a).
- `docker-compose.yml`: Dienst `coturn` (Profil „anrufe“) und Umgebung des
  Knotens.

Endstand (B-13b, 02.10.): protocol 1161 (6 übersprungen) · node 312 (+3, 7
übersprungen ohne Netz – mit Netz 313) · app 784 · mls 13 · Leak-Tests 70 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 · innerHTML streng Exit 0 ·
Website ok · Smoke-Test bestanden. Knoten-Stand: unverändert; für Anrufe auf dem
GX10 den Installer erneut mit `TURN_NAME` laufen lassen (MENSCH, mit
`turnutils_uclient` prüfen).

## Schritt B-13c – Anrufe: Aufbau im versiegelten Umschlag

Sammlung B-13, Entscheidungen T1 A und T2 A, dritter Teil. Das Format, mit dem
sich zwei Apps zu einem Anruf (WebRTC) verabreden – ohne dass eine Adresse
hinausgeht.

**Protokoll** (`anruf.ts`, innen Kind 25040, `docs/PROTOCOL.md` 27):
- `baueAnrufNachricht()`: Angebot (mit `medien`, Ton immer, Video optional),
  Antwort, Kandidat und Ende (mit Grund).
  - Je Empfänger ein Umschlag: Person und Geräte, höchstens 20, doppelte nur
    einmal.
  - Offen nur `p` und `expiration` (fünf Minuten, NIP-40), kein Zeitversatz – ein
    Anruf ist jetzt oder nie.
- **Nur Relay:** Im SDP und in Kandidaten stehen nur Kandidaten vom Typ `relay`
  (`pruefeSdpNurRelay()`, `istRelayKandidat()`). Host-, srflx-, prflx- und
  mDNS-Kandidaten verrieten dem Gegenüber die eigene Adresse – sie gehen nie
  hinaus und werden nie gelesen, auch nicht über eine eingeschmuggelte zweite
  Zeile.
- **DTLS-Fingerabdruck SHA-256** ist Pflicht in Angebot und Antwort. Er bindet
  die verschlüsselten Medien an den Absender des Siegels – mit B-4 prüfbar.
- `oeffneAnrufNachricht()` nimmt nur Nachrichten an diesen Schlüssel an: nicht
  älter als fünf Minuten, nicht aus der Zukunft, mit passender Kennung im Tag.
- `neueAnrufKennung()`: 16 Byte Zufall.

**Sammlung:** B-11 steht jetzt auf `fertig` (nur lesen), B-9 auf „wartet auf
L7“.

**Tests:** protocol +3 (`anruf.test.ts`):
- Angebot an Person und Gerät: je ein Umschlag, offen nur Empfänger und Ablauf,
  ohne Zeitversatz; nur der Empfänger öffnet; älter als fünf Minuten oder aus
  der Zukunft gilt nicht. Antwort, Kandidat und Ende hin und zurück.
- Host, srflx, prflx, mDNS und TCP-Host gehen nie hinaus. Ohne SHA-256-
  Fingerabdruck auch nicht, zu lang nicht, eine zweite Zeile im Kandidaten
  nicht; dazu ungültige Medien, Gründe und Kennungen.
- Was ein anderer Client versiegelt, liest die App nur nach den Regeln: kein
  Host-Kandidat, Kennung passend, Empfänger im Kern, richtiges Kind.

**Verdrahtet:** noch nicht – die App ruft an ab B-13d (wartet auf T3). Bis dahin
stehen `baueAnrufNachricht`, `oeffneAnrufNachricht` und `neueAnrufKennung` mit
Begründung in `scripts/wiring-ausnahmen.txt`.

Endstand (B-13c, 02.10.): protocol 1164 (+3, 6 übersprungen) · node 312 (7
übersprungen ohne Netz – mit Netz 313) · app 784 · mls 13 · Leak-Tests 70 grün
+ 1 todo · 0 rot · check-wiring `--streng` Exit 0 (drei Ausnahmen bis B-13d) ·
innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden. Knoten-Stand:
unverändert.

## Schritt C-13 – Räume, Rest aus dem Entwurf C.2

**Warum:** Was der Entwurf C.2 (`phase-10.md`, „Räume“) vorsah und C.2a–d
nicht baute (Sammlung C-13):
- In der Raum-Leiste trugen offene Räume zwei Buchstaben, private ein
  Schloss. Ungelesenes sah man dort nicht, und jeder Knopf war ein eigener
  Tab-Halt.
- Im Verlauf fehlte die Linie „Neu“ am Lesestand.
- Wer nicht moderiert, sah im Mitglieder-Menü keinen Knopf, also auch keinen
  Weg, einem Mitglied zu schreiben.

**Was:**
- **Leiste** (`raeume.ts`):
  - Offene Räume zeigen 🌐 und den ersten Buchstaben. Vorleser hören
    „Offener Raum …“ bzw. „Privater Raum …“.
  - „Aktuell“ (`aria-current`) ist nur der Raum, der vor Augen steht.
    Bei den Direktnachrichten ist keiner aktuell; `setzeKommModus("dm")`
    zeichnet die Leiste neu.
  - Eine Community (C-10) ist aktuell, solange ihr Verlauf offen ist
    (`activeConversation`). Vorher setzte erst der Klick das Attribut, und
    das Neuzeichnen hätte es gelöscht – der Smoke-Test „fremdtext“ fand das.
  - Pfeiltasten, Pos1 und Ende wandern durch die Leiste; nur ein Knopf ist
    per Tab erreichbar (`railTabHalt()`, `railPfeile()`).
- **Punkt bei Ungelesenem** (`.rail-punkt`, Vorleser: „…, ungelesen“):
  - Er erscheint nur für Räume, die in dieser Sitzung geladen waren
    (`ungelesen`, nur im Speicher). Die App merkt ihn nach dem Laden der
    Kanalliste und beim Verlassen eines Raums.
  - Eine Abfrage aller eigenen Räume nennte sie alle auf einmal, und private
    Räume bräuchten die Engine. Beides ist ausgeschlossen (C-11).
- **Linie „Neu“:** Sie steht vor der ersten Gruppe mit einer fremden
  Nachricht nach dem Lesestand.
  - Maßgeblich ist der Lesestand beim Betreten des Kanals (`neuSeit`, ein
    Wert für den offenen Kanal; ein anderer Raum setzt ihn zurück, weil
    Kanäle zweier Räume gleich heißen können): Der Lesestand selbst springt
    beim Öffnen auf jetzt, die Linie bleibt beim Neuzeichnen. Gemerkt wird
    erst nach den Zeilen, die der Test zu C.2b2 wörtlich festhält.
  - War der Kanal nie gelesen, gibt es keine Linie. In Threads gibt es auch
    keine.
- **Mitglieder-Menü:** „Direktnachricht schreiben“ steht bei jedem Mitglied
  außer einem selbst. Es öffnet die Unterhaltung nach NIP-17 über
  `oeffneDirektnachricht()` (`kommunikation.ts`, aus `newDm()` gelöst).
  Die Rechte-Punkte folgen wie bisher (`rechteAktionen()`).

**Verdrahtet:** `zeigeRaumLeiste()`, `zeigeKanalliste()`, `oeffneKanal()`,
`zeigeMitglieder()` → `mitgliedAktionen()`, `wireSpacesTab()` (Pfeiltasten)
in `shell/tabs/raeume.ts`; `setzeKommModus()` in `shell/tabs/kommunikation.ts`.

**Tests:**
- app +5 in `test/raeume-rest.test.ts`.
- `raum-probe.mts` legt eine Nachricht im zweiten Kanal an, damit es
  Ungelesenes gibt.
- Smoke „raum“ auf Desktop und Handy:
  - Die Pille zeigt 🌐 und hat den richtigen Namen für Vorleser.
  - Vor Augen ist kein Punkt da, nach dem Wechsel zu den Direktnachrichten
    schon.
  - Es gibt einen Tab-Halt, und der Pfeil wandert.
  - Die Linie „Neu“ steht vor der richtigen Gruppe (Lesestand als
    Init-Skript).
  - Das Menü am Gründer beginnt mit „Direktnachricht schreiben“, und der
    Klick öffnet die neue Unterhaltung.
- Gewartet wird auf Zustände, nicht mit festen Pausen.
- Nachtrag beim Einmergen von `main`: Ein CI-Lauf auf #251 war im
  Smoke-Test „tresor“ rot (`daten_aus_tresor`). Der App-Code war derselbe
  wie im grünen Lauf davor (#262 änderte nur Installer und Knoten), und lokal
  blieb die Prüfung grün, auch mit sechsfach gedrosselter CPU. Ursache: Nach
  dem Entsperren wartete die Prüfung fest 1 s bzw. 500 ms. Jetzt wartet sie
  auf den Zustand (Identität, Chat-Liste und Verlauf, Frist 15 s); die
  Bedingung ist unverändert.

## Schritt C-8 – C.6a, reines Verschieben

**Warum:** Rest von B14 (Entscheidung E2, `phase-10.md`, Sammlung C-8). Der
Schritt wartete auf #183 (11.2a, Spur A), das `settings.ts` und `index.html`
änderte; #183 ist gemergt.
- Gebühren und Standard-Schiene standen in den Settings, gehören aber zum Geld.
- Der Reiter „Liquidität“ enthielt Deposit und Zahlkanal, keine Liquidität.
- „Modell vorhalten/ankündigen“ ist ein Beitrag ans Netz und stand beim Agenten.

**Was:**
- `index.html`:
  - Settings › Gebühren (Aufteilung, fällige Anteile, Standard-Schiene)
    steht wörtlich unter Währung › Zahlen (`wallet:pay`). Der Reiter
    „Gebühren“ in den Settings entfällt.
  - Der Reiter „Liquidität“ heißt „Hinterlegen“; sein Inhalt bleibt.
  - „Modell vorhalten“ und „Modell ankündigen“ stehen in einer eigenen Karte
    unter Verdienen › Hosten.
  - Kennungen und Verdrahtung bleiben (`wireGebuehrenKarte()`,
    `#standard-schiene`, `#models-seed`/`#models-publish` in `app.ts`).
- **Texte:**
  - Neu: `waehr.tabHinterlegen`, `waehr.tabZahlen`, `earn.modelleTitel` und
    `earn.modelleText`.
  - `waehr.tabLiquiditaet` und `set.tabGebuehren` nutzt nichts mehr; sie
    fallen weg (der i18n-Test verlangt das).
  - Wo Texte den alten Ort nannten, nennen sie den neuen: „unklare Zahlung“
    → Währung › Zahlen, die Modell-Liste → Verdienen › Hosten, der
    Untertitel der Währung, die FAQ der Website.

**Verdrahtet:** unverändert – `app.ts` verdrahtet die Knöpfe über ihre
Kennungen, `wireGebuehrenKarte()` (`settings.ts`) die Gebühren-Karte.

**Tests:**
- app +3 in `test/umzug-zahlen.test.ts`:
  - Reiter und Inhalt am neuen Ort.
  - Jede Kennung genau einmal.
  - Neue Texte in beiden Sprachen, FAQ.
- Smoke:
  - „waehrung“: Reiter Übersicht/Tauschen/Hinterlegen/Zahlen; unter Zahlen
    „Nichts gesammelt.“ und die Standard-Schiene.
  - Die Settings haben kein „fees“ mehr.
  - Verdienen › Hosten öffnet den Dialog „Modell vorhalten“.
  - „mobil“ misst `wallet:pay` und `earn:host`.
- Nebenbei (außerhalb von Spur C, klein): Beim vollen Lauf war
  `streitfall.test.ts` („5.6c: ein Pruefauftrag …“) einmal rot. Der Test
  baute dieselbe Reklamation zweimal und verglich die Ids; `buildDispute()`
  liest ohne Zeitangabe jedes Mal die Uhr. Sprang dazwischen die Sekunde um,
  unterschieden sich die Ids (Fallstrick „Fristen in Tests nur einmal aus der
  Uhr“). Nachgestellt mit einer Uhr, die je Aufruf 600 ms vorrückt: vorher
  rot, jetzt grün. Die Zeit kommt jetzt einmal aus der Uhr; die Prüfungen
  sind unverändert.

## Schritt C-7a – Sprachnachrichten: die Aufnahme

**Warum:** Sammlung C-7 („aufnehmen – Mikrofon nur auf Klick, danach aus –,
als verschlüsselter Anhang, abspielen“). Der ganze Schritt bräuchte rund 650
geänderte Zeilen, darum zwei Teile, wie bei C-17:
- **a** die Aufnahme ohne DOM,
- **b** Knopf, Anhang, Abspielen und Browser-Test.

**Was:** `packages/app/src/sprachnachricht.ts` (neu, ohne DOM):
- `SprachAufnahme` mit den Zuständen bereit, startet und nimmt auf:
  - `starte()` fragt das Mikrofon an.
  - `beende()` liefert die Aufnahme, `brichAb()` verwirft sie.
  - Endet die Aufnahme von selbst (Grenze, Gerät weg), kommt das Ergebnis
    über `beiEnde`.
- Nach jedem Ende sind alle Spuren gestoppt: beendet, verworfen, an der
  Grenze, bei einem Fehler, und auch, wenn die Erlaubnis erst nach dem
  Abbrechen kam.
- Mikrofon, Recorder und Uhr kommen von außen (`SprachUmgebung`).
- `SPRACH_GRENZEN`: 120 s, 32 kbit/s. Browser nehmen sonst 128 kbit/s; mit
  32 kbit/s reisen kurze Nachrichten in der verschlüsselten Nachricht selbst.
- Hilfen:
  - `waehleSprachFormat()`: Opus in WebM oder Ogg, sonst MP4 für Safari.
  - `sprachDateiname()`.
  - `istAudioTyp()`: nur `audio/<name>` mit Parametern – der Typ kommt aus
    fremder Nachricht.
  - `dauerText()`.

**Verdrahtet:** noch nicht – das bringt C-7b (Knopf im Chat), wie bei C-17a.

**Tests:** app +6 in `test/sprachnachricht.test.ts` (mit Attrappen für
Strom, Spur und Recorder):
- Format, Name, Dauer und Typprüfung.
- Beenden, Verwerfen und die Grenze.
- Verweigert oder kaputt.
- Abgebrochen, während der Browser noch fragt.

## Schritt C-7b – Sprachnachrichten: Knopf, Anhang, Abspielen

**Warum:** zweiter Teil von C-7; verdrahtet die Aufnahme aus C-7a.

**Was:**
- **Knopf** `#chat-voice-btn` (Mikrofon) neben „Anhängen“
  (`shell/sprachnachricht-ui.ts`):
  - Erst der Klick fragt das Mikrofon an. Während der Aufnahme zeigen
    `aria-pressed` und eine Zeile mit Laufzeit und Grenze, dass
    aufgenommen wird; dazu gibt es „verwerfen“.
  - Ein zweiter Klick beendet. Im Hintergrund beendet die App von selbst,
    beim Verlassen der Seite verwirft sie. Ohne Mikrofon-Schnittstelle gibt
    es den Knopf nicht.
- **Anhang:** Die Aufnahme ist ein Anhang über `handleChatFiles()`, derselbe
  Weg wie eine gewählte Datei (Regel „Anhänge nur verschlüsselt“).
  - Klein reist sie in der verschlüsselten Nachricht, sonst verschlüsselt
    über `uploadAnhang()`.
  - Gekoppelt hält sie der eigene Knoten (B-9b2).
  - Gesendet wird mit „Senden“; vorher lässt sie sich verwerfen.
  - `handleChatFiles()` nimmt dafür auch eine Liste von `File`.
- **Abspielen:**
  - Inline (`data:audio`) spielt der Verlauf direkt.
  - Ein verschlüsselter Ton heißt „🔒 ▶ … abspielen“. Nach dem Laden und
    Entschlüsseln steht dort ein Abspieler statt eines Downloads, nur mit
    geprüftem Typ (`istAudioTyp()`).
- **Texte** in beiden Sprachen, CSS mit `--red-text` für die laufende
  Aufnahme.

**Verdrahtet:** `wireSprachnachricht()` in `shell/app.ts` neben den Anhängen;
Abspielen in `wireBlobButtons()` (`kommunikation.ts`), Text in
`anhangAnsicht()` (`shell-logic.ts`).

**Tests:**
- app +2 in `test/sprachnachricht.test.ts`: Anzeige verschlüsselter Töne,
  Verdrahtung, Bitrate.
- Smoke „sprachnachricht“ (neu) mit einer Mikrofon-Attrappe (Oszillator),
  die zählt, wie oft die App fragt, und jede Spur merkt:
  - Vor dem Klick wird nicht gefragt.
  - Während der Aufnahme sind Name und Zeile richtig.
  - Nach dem Beenden und Verwerfen sind alle Spuren aus.
  - Der Anhang heißt `sprachnachricht.webm`, Verwerfen fügt nichts hinzu.
  - Nach dem Senden steht im eigenen Verlauf ein Abspieler mit
    `data:audio/webm`.
  - Hinaus gehen nur Umschläge (1059), ohne „audio/webm“ oder den Dateinamen im
    Klartext.

## Schritt C-12 – Privater Raum einmal vollständig im Browser

**Warum:** offen aus 10.4 (Sammlung C-12). Private Räume waren nur über
`gruppenRaum()`, Unit- und Leak-Tests geprüft; der Smoke-Test kannte nur den
offenen Probe-Raum.

**Was:** Smoke „privatraum“ (neu, rund 25 s): zwei Browser (Ada, Bo) hinter
derselben Relay-Attrappe, je mit Tresor und echter MLS-Engine.
- Bo öffnet eine Unterhaltung mit Ada und veröffentlicht dabei sein
  KeyPackage (30443).
- Ada legt „Probe privat“ an und lädt Bo mit seinem Schlüssel ein. Die
  Einladung geht versiegelt an seinen Posteingang (1059).
- Bo startet neu und entsperrt: Der Raum steht in seiner Leiste. Den Namen
  kennt er erst, wenn er ihn öffnet.
- Ada schreibt, Bo liest und antwortet im Thread, Ada sieht die Antwort.
- Bo meldet Adas Nachricht: Der Umschlag geht nur an Ada. Nach ihrem Start
  steht die Meldung im Raum (wer, über wen, Grund, Maßnahmen).
- Ada löscht Bos Antwort für alle (4891 in der Gruppe), bei Bo ist sie weg.
- Ada legt ein Repo im Raum an, Bo sieht es und schickt einen Patch, Ada
  sieht den Patch. Kein offenes 1617.
- Auf dem Relay steht nichts davon im Klartext: kein Raumname, kein Text,
  keine Repo-Kennung, kein Betreff. Kinds nur 445, 1059, 10002, 10050, 30443.

**Ohne Änderung an der App.** Neu in `smoke_test.py` (dazu app +1 in `test/privatraum-browser.test.ts`, der festhält, dass der Smoke-Test die Schritte geht und zählt):
- `tresor_an()` und `entsperre_neu()`.
- `DialogSeite(init=…)`.
- Zwei Attrappen mit gemeinsamer Ereignisliste, jede mit dem eigenen
  Schlüssel.

## Schritt C-1f – Browser-Dialoge: der Rest in `agent.ts`

**Warum:** Sammlung C-1. `agent.ts` war bis B-9 gesperrt (dieselbe Datei);
seit B-9 ist sie frei. Übrig waren fünf Browser-Dialoge, alle in der
Reklamation.
- Sie fragte nacheinander mit `confirm()`/`prompt()`: das Verfahren, den
  Grund als Nummer, den Prüfer als Nummer, das Material und die Notiz.
- Eine Tippnummer außerhalb der Liste ergab still „unbrauchbar“ bzw. keinen
  Prüfer.

**Was** (`shell/tabs/agent.ts`, `reklamiere()`; `waehlePruefer()` entfällt):
- **Zwei Dialoge über `shell/dialog.ts`:**
  - Zuerst das Verfahren als Fließtext (`fliesstext(disputeInfo())` – der
    Satz des Protokolls bleibt, wie er ist).
  - Dann ein Dialog mit dem Grund als Wahl (Texte aus `GRUND_TEXT`), dem
    Prüfer aus dem eigenen Netz (`netzPruefer()`, „niemand – nur der
    Provider“), einem Haken für Frage und Antwort und der Notiz.
- **Der Haken für Frage und Antwort** steht nur da, wenn es einen Prüfer
  geben kann und es Material gibt. Mitgeschickt wird nur mit Haken und
  gewähltem Prüfer.
- **Der Prüfer** kommt nur aus den Kandidaten; ein fremder Wert ergibt
  keinen.
- **Die Frist** prüft die App jetzt vor dem Ausfüllen, nicht danach.
- **Texte:** neu in beiden Sprachen; `agent.problem`, `agent.werPrueft` und
  `agent.materialMitschicken` (Nummernlisten) fallen weg.
- `NOCH_OFFEN` in `browser-dialoge.test.ts` ist leer: Keine Datei hat mehr
  Browser-Dialoge.

**Verdrahtet:** unverändert über den Knopf „Reklamieren“ unter einer Antwort
(`addUsageBubble()` → `reklamiere()`).

**Tests:**
- app +1 in `test/browser-dialoge.test.ts` (C-1f).
- Der Test zu 5.6b prüft dasselbe wie vorher an der neuen Stelle:
  Prüfer nur aus dem Netz, Material nur mit Zustimmung.
- Ohne eigenen Browser-Test: Die Reklamation braucht eine bezahlte
  Antwort; der Smoke-Test „dialog“ prüft die Dialoge selbst.

## Schritt C-6d1 – `innerHTML` abbauen: `agent.ts`, erster Teil

**Warum:** Sammlung C-6. `agent.ts` war bis B-9 gesperrt und hatte mit 18
die meisten Ausnahmen in `scripts/innerhtml-ausnahmen.txt`. Zwei Teile, damit
jeder unter 400 Zeilen bleibt:
- **d1:** Listen und kleine Bausteine.
- **d2:** die Blasen der Antworten samt Markdown, die Kosten und die
  Schritte.

**Was** (als DOM über `el()`, Text nur über `textContent`):
- **Modellwahl:** Die Karten aus den Angeboten der Provider zeigen Modellnamen
  nur als Text und als `dataset`. Das Werkzeug-Symbol ist ein Element.
- **Modell-Knopf:** Der Knopf mit dem gewählten Modell setzt Symbol plus Text.
- **Liste der Aufgaben:** Der Verlauf zeigt Titel aus eigenen Fragen als Text.
- **Rechte Spalte:** Werkzeuge und Kosten der Sitzung; Werkzeugnamen kommen
  vom Provider.
- **Fehler und Hinweise:** Die Fehler-Blase zeigt die Ursache als Text,
  ebenso der Hinweis zum Modellwechsel.
- **Bild-Vorschau:** Bei einem angehängten Bild ist `src` eine Eigenschaft.
- **Neue Helfer:** `iconEl()` (`icons.ts`) und `haekchenEl()` (`ui.ts`)
  machen Symbole aus der festen Tabelle zu Elementen. Nur sie setzen dafür
  noch HTML, und nur aus `icon()`/`markSvgCheck()`.
- **Ausnahmen:** 22 → 16 (davon `agent.ts` 18 → 12).

**Tests:**
- app +1 in `test/dom-statt-html.test.ts` (C-6d1).
- Der Test zu B-9a (Knopf „Mein Knoten“) prüft dasselbe an der DOM-Form.
- Smoke „fremdtext“: Die Probe trägt jetzt ein Angebot (38025) mit HTML im
  Modellnamen und einem Werkzeug. Geprüft wird:
  - Die Karte in der Modellwahl zeigt den Namen als Text, ohne Bild, mit
    Werkzeug-Symbol.
  - Nach der Wahl zeigt der Knopf denselben Text samt Symbol.
  - Es läuft kein Skript.

## Schritt C-6d2 – `innerHTML` abbauen: `agent.ts`, zweiter Teil

**Warum:** Sammlung C-6, Rest aus C-6d1. Die Antworten der Provider liefen
über `renderMarkdown()`: Text erst maskiert, dann per Ersetzen zu HTML-Text
gebaut und über `innerHTML` gesetzt. Das ging gut, solange jede Ersetzung
sauber war – eine Ausnahme je Stelle in `scripts/innerhtml-ausnahmen.txt`.

**Was** (als DOM über `el()`, Text nur über `textContent`):
- **Blasen:** `blasenGeruest()` baut Absender, Körper und Kosten-Zeile. Der
  Modellname kommt vom Provider und steht nur als Text da.
- **Antworten:** nur über `antwortDom()` (`shell/antwort-ui.ts`). Darunter
  liegt `markdownDom()` aus C-20a mit Zeilenumbrüchen: rohes HTML bleibt Text,
  Links nur https, Bilder werden nie geladen. Damit können Antworten jetzt
  auch Überschriften, Zitate, Tabellen und nummerierte Listen.
- **Code-Blöcke:** Kopf mit der Sprache aus dem Block (sonst „code“),
  Kopier-Knopf und Färbung. Der Knopf kopiert den rohen Code. Bisher wirkte er
  nur bei Antworten mit Tipp-Effekt; bei allen anderen (Funk, dieses Gerät)
  tat er nichts.
- **Färbung:** `codeTeile()` (`code-farbe.ts`, ohne DOM) zerlegt den Code in
  Stücke mit Art (Zeichenkette, Kommentar, Schlüsselwort, Zahl). Kein Muster
  reicht über ein Zeilenende; Zeilen über 500 Zeichen und Blöcke über 50.000
  Zeichen bleiben ungefärbt. Ohne diese Grenze braucht eine Zeile aus
  `"\"\"…` mit 20.000 Zeichen 200 ms, mit 50.000 über eine Sekunde – jeder
  Anfang einer offenen Zeichenkette sucht bis zum Zeilenende.
- **Kosten-Blase:** Werkzeuge, Zeilen und Aufteilung (`aufteilungZeilen()`
  liefert jetzt Elemente). Nebenbei behoben: Ein zweiter Klick-Handler
  ersetzte beim Aufklappen den ganzen Kopf durch „▾ Details · n sats“
  (Modell, Tokens und Haken waren weg), und `aria-expanded` stand verkehrt
  herum. Jetzt eine Klappe, der Pfeil dreht sich über `aria-expanded`; der
  Text „agent.details“ fällt weg.
- **Schritt-Leiste und Symbole:** als Elemente, Symbole über `iconEl()`.
- **Weg:** `renderMarkdown()`, `activateCodeBlocks()`, `highlightCode()`
  (`ui.ts`) und der Re-Export in `app.ts`.
- **Ausnahmen:** 16 → 4, `agent.ts` ohne `innerHTML` (in `FERTIG`). Es bleiben
  das Logo-SVG (`ui.ts`) und die festen Vorlagen in `tresor.ts` und
  `einrichtung-ui.ts`. `docs/INNERHTML-AUDIT.md` neu erzeugt (stand seit #79).

**Tests:**
- app +5: `test/code-farbe.test.ts` (Stücke ergeben den Code, Arten, Grenzen,
  böse Texte unter einer Sekunde) und C-6d2 in `test/dom-statt-html.test.ts`.
- Der Test zu 5.1.3 prüft die Aufteilung an der DOM-Form.
- Smoke „lokal“: Das Gerät antwortet einmal mit Markdown, HTML und einem
  Code-Block. Geprüft wird:
  - Kein `img`, kein `script`, kein `onerror` im DOM.
  - Das HTML steht als Text im Absatz.
  - Der Kopf zeigt „ts“, die Stücke sind gefärbt.
  - Der Kopier-Knopf meldet „kopiert“, in der Zwischenablage steht der rohe Code.

## Übergabe Spur B – 02.10.2026

Spur B hat alles gebaut, was ohne Entscheidung geht (bis B-13c, #263). Offen
sind nur noch Punkte nach den Entscheidungen W3 (B-12c/d), T3 (B-13d) und
L7 (B-9c3). Plan, Stand, MENSCH-Aufgaben und Arbeitsweise stehen in
`docs/ausbau/UEBERGABE-SPUR-B.md`. Kein Code geändert.

## Schritt B-9c3 – Relay meines Knotens übernehmen

**Warum:** B-9 versprach „Alles über meinen Knoten (KI, Speicher, Relays)“.
KI und Halten gehen seit B-9c2 mit Haken nur über sein Relay; offen war, was
„Relays“ heißt. Entscheidung L7 A (MENSCH, 02.10.): ein Knopf, der sein Relay
in den eigenen Satz übernimmt – Kontakte erreichen einen dann auch dort, die
übrigen Relays bleiben. Am selben Tag entschieden: W3 A (B-12c/d) und T3 B
(B-13d), eingetragen in der Sammlung.

**Was:**
- `satzMitKnotenRelay()` (`knoten-weg.ts`, ohne DOM): hängt das Relay an den
  eigenen Satz an. Nicht, wenn es schon drinsteht (nach Normalform), wenn es
  nicht taugt (Heimnetz-`ws://`, unverschlüsselt außer .onion) oder wenn es
  noch keinen eigenen Satz gibt – sonst wäre der Knoten der einzige
  Posteingang. Der ganze Satz läuft danach durch `pruefeRelayEingabe()`
  (höchstens acht).
- `taugtFuerSatz()` (`relay-satz.ts`): die Regel je Adresse aus
  `pruefeRelayEingabe()` als eigene Funktion – dort unverändert genutzt.
- Settings → Geräte → „Mein Knoten“: Knopf „Relay meines Knotens übernehmen“,
  nur gekoppelt sichtbar, als Gerät gesperrt (der Satz gehört der Person).
  Adresse über `knotenRelay()`; kommt die App im Heimnetz vom Knoten (B-10),
  taugt der Ursprung nicht – dann seine NIP-65-Liste. Nach Rückfrage (sie sagt
  ehrlich: wer die Listen liest, kann vermuten, dass der Knoten einem gehört)
  nur über `setzeEigeneRelays()`: NIP-65 und Posteingang veröffentlicht, erst
  dann gemerkt; danach in den Pool, das Feld in Settings → Relays zieht nach.

**Tests:** app +2 in `test/knoten-weg.test.ts` (Anhängen und alle
Negativfälle; Reihenfolge Gerät → Rückfrage → Veröffentlichen → Pool, kein
`setItem`/`publish` daneben, Sichtbarkeit, Texte in beiden Sprachen).
Smoke „einstellungen“ (Mein Knoten): Der Knopf ist nur gekoppelt sichtbar; ohne
bekanntes Relay des Knotens steht die Meldung da, es kommt keine Rückfrage, und
es geht keine Liste hinaus. Knoten-Stand: unverändert.

## Schritt B-12c – Weck-Worker als zweite Datei

**Warum:** Der eigene Knoten weckt seit B-12b per Web Push – leer, ohne Inhalt
und Absender. Ankommen kann ein Push im Browser nur bei einem Service Worker,
und der braucht eine eigene Datei neben freedom.html (W2 A). Entscheidung W3 A
(MENSCH, 02.10.): die CSP erlaubt Worker von derselben Herkunft
(`worker-src blob: 'self'`).

**Was:**
- `src/sw/freedom-sw.ts` → `dist/freedom-sw.js` (esbuild, eigener Lauf in
  `build.mjs`, 0,9 KB):
  - `push` → eine Meldung mit festem Text aus `texte/wecken.ts`, Tag
    `freedom-weck` – eine neue ersetzt die alte.
  - `notificationclick` → ein offenes Fenster der App nach vorn holen, sonst
    freedom.html neben dem Worker öffnen.
  - Die Sprache kommt aus `?sprache=` der eigenen Adresse (B-12d meldet so an),
    sonst aus der des Browsers.
  - Aus dem Push wird nichts gelesen. Kein Cache, kein `fetch`-Handler, kein
    `importScripts` – der Build bricht ab, wenn so etwas im Ergebnis steht.
- CSP: `worker-src blob: 'self'`; `script-src` bleibt beim Hash.
- `build-site.sh` legt die Datei neben freedom.html, samt `freedom-sw.js.sha256`.
- `repro-build.sh` gibt beide Summen aus, `--pruefen` vergleicht beide. Neu ist
  `--vergleiche-ordner <ordner>` für beide Dateien – `pages.yml` veröffentlicht
  nur damit. `--vergleiche <sha256>` bleibt für freedom.html (Release-Manifest).
- `publish-release.mjs`: Das Manifest nennt `freedom-sw.js` als zweites Artefakt.
- Die App meldet den Worker noch nicht an – das tut erst der Haken aus B-12d.
  `dist/freedom.html.sha256` bleibt unverändert (der Knoten liefert es aus, B-10).

**Tests:**
- app +4 in `test/weck-worker.test.ts`:
  - Worker: nur drei Ereignisse, nichts aus dem Push, kein Cache, kein `fetch`,
    nur der feste Text.
  - CSP, Build, Website, repro, Pages und Release führen die Datei mit.
  - Die App meldet noch nichts an.
- Smoke „weckworker“ (volles Chromium – die Headless-Shell verweigert Meldungen
  immer):
  - Beim Start ist kein Worker angemeldet.
  - `freedom-sw.js?sprache=de` lässt sich unter der CSP anmelden.
  - Ein Push mit Daten über CDP ergibt genau eine Meldung, mit festem deutschem
    Text und ohne die Daten.
  - Danach ist der Worker wieder abgemeldet.

Knoten-Stand: unverändert. Eine vom Knoten ausgelieferte App (B-10) hat den
Worker nicht – B-12d sagt das dort, statt zu scheitern.

## Schritt B-12d1 – Notfall-Löschung meldet Weck-Worker ab

**Warum:** B-12d gibt der App den Haken „Wecken“: Service Worker anmelden,
Push abonnieren, beim Knoten anmelden. Ein Service Worker und sein Push-Abo
liegen außerhalb von localStorage und IndexedDB – `loescheAllesLokal()`
erreichte sie nicht (Regel 8.14: erst die Löschung erweitern). Der Schritt ist
geteilt: d1 die Löschung, d2 der Haken samt Datenschutz-Aussage.

**Was:**
- `weckerAbmelden()` (`wecker-abmelden.ts`, ohne DOM): Für jeden Worker dieser
  Herkunft das Push-Abo kündigen und den Worker abmelden. Was nicht ging, kommt
  als `push`/`worker` zurück; das Übrige wird trotzdem versucht. Ohne sicheren
  Kontext gibt es keine Worker. Ohne Abo antwortet der Push-Dienst dem Knoten
  mit 410, und der vergisst die Adresse (B-12b).
- `notfall.ts`: vor `loescheAllesLokal()` und im zweiten Durchgang nach dem
  Neustart. Reste stehen in der Meldung wie nicht gelöschte Einträge.

**Tests:**
- app +2 in `test/notfall.test.ts`: Kündigen und Abmelden samt Negativfällen
  (Abo wirft, Abmelden scheitert oder wirft, Liste wirft, kein Worker-Zugang)
  und die Verdrahtung in beiden Durchgängen.
- Smoke „notfall“: Vor dem Löschen ist `freedom-sw.js` angemeldet, danach ist
  kein Worker mehr da. Gegenprobe: Ohne das Abmelden schlägt die Prüfung an
  (`worker=1`).

Knoten-Stand: unverändert.

## Schritt B-12d2 – Haken „Wecken“

**Warum:** Der letzte Teil von B-12 (W1 A, W2 A, W3 A). Die App kann sich jetzt
vom eigenen Knoten wecken lassen, wenn sie zu ist. Notfall-Löschung (d1) und
Weck-Worker (c) gab es schon.

**Was:**
- Settings → Geräte → „Mein Knoten“: Haken „Wecken“, nur gekoppelt sichtbar.
  Der Text am Haken sagt schon, dass der Push-Dienst des Browsers sieht, *wann*
  geweckt wird.
- **an** (`shell/wecken-ui.ts`, nur auf Klick), Schritt für Schritt:
  1. den Status des Knotens erfragen (`frageKnotenStatus()`, für seinen
     VAPID-Schlüssel – fehlt er, weckt der Knoten nicht);
  2. Erlaubnis für Meldungen;
  3. Weck-Worker anmelden (`freedom-sw.js?sprache=…`);
  4. Push abonnieren und die Adresse prüfen (`pruefeWeckEndpunkt()`);
  5. Anmeldung 5078 versiegelt mit Nachweis über `wegZumKnoten()` – Schlüssel
     sind Person und Geräte (`weckSchluesselFuer()`).

  Bestätigt der Knoten nicht – Schweigen, Ablehnung, Fehler, untaugliche
  Adresse –, wird alles lokal wieder abgemeldet; nichts bleibt halb an.
- **aus:** zuerst beim Knoten abmelden (`aktion: "ab"`, soweit er antwortet),
  dann Abo und Worker weg (`weckerAbmelden()`). Antwortet er nicht, vergisst er
  die Adresse beim nächsten Wecken (410).
- Gemerkt wird nichts: Der Haken zeigt, ob es ein Abo gibt (beim Start nur
  gelesen). Entkoppeln nimmt Wecken mit.
- Ohne sicheren Kontext (App vom Knoten über http) oder ohne Push sagt die App,
  dass es hier nicht geht. Fehlt der Worker in der Auslieferung (App vom Knoten,
  B-10), sagt sie, dass es nur über die Website geht.
- `frageKnotenStatus()` und `warteAufKnoten()` aus der Status-Abfrage
  herausgelöst; Status und Wecken teilen sie, das Verhalten des Status-Knopfs
  ist gleich.
- **Datenschutzbericht:** neue Grenze „wecken“. Der Push-Dienst des Browsers
  (Google, Mozilla, Apple) sieht, wann dein Knoten dich weckt – nicht was und
  von wem; die Push-Adresse geht nur versiegelt an den Knoten. Regel
  `besitzer-versiegelt`, Texte in beiden Sprachen.
- `wiring-ausnahmen.txt`: `baueWeckAnmeldung` und `leseWeckAntwort` gestrichen –
  jetzt verdrahtet.

**Tests:**
- app +4 in `test/wecken-app.test.ts`:
  - wann es geht; der VAPID-Schlüssel streng (Länge, 0x04, base64url);
  - die Schlüsselliste (Person zuerst, ohne Doppelte, Grenze);
  - Verdrahtung: Reihenfolge, dreimal Zurücknehmen, nur über den Weg, nichts
    gemerkt, erst Knoten dann lokal abmelden, Entkoppeln, Texte.
- Weitere App-Tests:
  - `weck-worker.test.ts`: `register` nur im Haken, mit der Sprache.
  - `notfall.test.ts`: `serviceWorker.register(` nur in `wecken-ui.ts`.
  - B-11b an der neuen Form.
- protocol +1 in `privacy-facts.test.ts`: die Grenze im Bericht und ein
  Szenario – die Anmeldung mit Push-Adresse und Schlüsseln zeigt nichts davon
  offen, nur der Knoten ist Empfänger.
- Smoke „einstellungen“: Der Haken ist gekoppelt sichtbar und ohne Abo aus. Mit
  „nur über meinen Knoten“ und ohne bekanntes Relay scheitert er sofort – Haken
  aus, kein Worker angemeldet, nichts gesendet.

Knoten-Stand: B-12a/b (Weckdienst, `RELAY_ENABLED`). Ohne ihn meldet die App
„Dein Knoten weckt nicht“.

## Schritt B-13d1 – Zugang im Anruf-Angebot, Leak-Regel

**Warum:** B-13d (Anrufe in der App) ist in drei Schritte geteilt: d1 Protokoll,
d2 Anruf-Logik, d3 Oberfläche mit Datenschutz-Aussage. Entscheidung T3 B
(MENSCH, 02.10.): Wer angerufen wird und keinen eigenen Knoten hat, bekommt im
versiegelten Angebot einen kurzlebigen Zugang zum TURN der Anruferin.

**Was:**
- `anruf.ts`: Das Angebot darf ein Feld `turn` tragen. Es wird beim Bauen und
  beim Öffnen geprüft (gültig zum jeweiligen Zeitpunkt, höchstens ein Tag) und
  steht nur im Kern. Ohne `turn` bleibt alles wie in B-13c.
- `pruefeTurnZugang()` (`turn-zugang.ts`): die Prüfung aus `leseTurnZugang()`
  für einen schon gelesenen Wert – beide nutzen sie.
- Leak-Regel `anruf-nur-relay` (`regelAnrufNurRelay()`): Kind 25040 nie offen
  gesendet; in den inneren Events (Mitschnitt vor dem Versiegeln) nur
  Relay-Kandidaten mit Fingerabdruck.
- `docs/PROTOCOL.md` §27 ergänzt (Zugang im Angebot, Leak-Regel).
- Die Datenschutz-Aussagen (Gegenüber sieht die IP nicht; ohne eigenen Knoten
  sieht der Knoten der Anruferin sie) kommen mit der Oberfläche in d3 – vorher
  gäbe es die Funktion nicht.

**Tests:** protocol +2:
- `anruf.test.ts`: Angebot mit Zugang, Zugang nie offen. Negativfälle:
  abgelaufen, über einen Tag, keine `turn:`-Adresse, Nutzer passt nicht zum
  Ablauf, falsches Passwort, kein Objekt, beim Öffnen abgelaufen. Dazu die
  Leak-Regel mit allen Fällen.
- `leak-rules.test.ts`: Der Regelname steht in `LEAK_REGELN`.

Knoten-Stand: unverändert.

## Schritt B-13d2 – Anrufe: Logik in der App

**Warum:** Zweiter Teil von B-13d (T1 A, T2 A, T3 B): Verbindung, Aufbau und
Empfang. Die Oberfläche folgt in d3.

**Was:**
- `anruf-ablauf.ts` (ohne DOM, ohne WebRTC):
  - `waehleVermittler()`: der eigene Vermittler zuerst, sonst der Zugang aus
    dem Angebot (`fremd` – T3 B), sonst keiner.
  - `iceServerAus()` macht aus dem Zugang einen `RTCIceServer`.
  - `nurRelaySdp()` und `sendbarerKandidat()`: hinaus nur Relay-Kandidaten,
    geprüft wie beim Empfänger.
  - Zustand nur über `naechsterZustand()`: klingelt/eingehend → verbindet →
    verbunden → beendet; Fristen `KLINGELN_SEK` (60) und `VERBINDEN_SEK` (30);
    Ende ist endgültig.
  - `eingehendesAngebot()`: nur von Kontakten, sonst still; läuft ein Anruf,
    „besetzt“ – Fremden nie eine Antwort.
- `shell/anruf.ts`:
  - `rufeAn()`: nur Kontakte, nur mit eigenem Vermittler – frischer Zugang über
    `eigenerTurnZugang()` (5079, über `wegZumKnoten()`). Der Zugang reist im
    Angebot mit.
  - `nimmAn()` (Vermittler nach `waehleVermittler()`), `legeAuf()`,
    `vergissAnruf()`; die Oberfläche hört über `beiAnruf()` zu.
  - `RTCPeerConnection` nur mit `iceTransportPolicy: "relay"`. Gesendet über
    `baueAnrufNachricht()` an Person und Geräte, an deren Posteingang
    (`veroeffentlicheDm()`), sofort – nicht verzögert wie Chat-Nachrichten.
  - Empfang über `alsAnruf()` am Ende der Kette in `oeffneUmschlag()`. Absender
    über `geraeteBuch.zuordnen()`: ein gültiges Gerät eines Kontakts zählt als
    der Kontakt. Während eines Anrufs kommen Antwort und Kandidaten über ein Abo
    an den eigenen Schlüssel, nur so lange wie der Anruf.
- `wiring-ausnahmen.txt`: fünf Ausnahmen aus B-13a/c gestrichen
  (`baueAnrufNachricht`, `neueAnrufKennung`, `oeffneAnrufNachricht`,
  `baueTurnAnfrage`, `leseTurnZugang`) – jetzt verdrahtet.

**Tests:**
- app +4 in `test/anruf-ablauf.test.ts`: Vermittler, nur Relay hinaus,
  Zustand mit Fristen und Negativfällen, eingehende Angebote nur von Kontakten.
- Leak +2 in `test/leak/anruf.test.ts`:
  - Aus einem gesammelten SDP mit Host- und srflx-Kandidaten geht nur Relay
    hinaus.
  - Versiegelt an Person und Gerät; die Regel `anruf-nur-relay` läuft mit den
    inneren Events.
  - Weder der Zugang noch eine eigene Adresse stehen offen; `publish` nur für
    die TURN-Anfrage.
- Die vier Tests, die die Kette in `oeffneUmschlag()` wörtlich prüfen, kennen
  das neue Glied `alsAnruf(w)`.

**Grenze bis d3:** Ohne Oberfläche ruft niemand an. Ein eingehendes Angebot
klingelt unsichtbar und endet nach 60 s mit „zeit“. Ein durchgehender Test mit
echtem TURN ist hier nicht möglich (MENSCH-Checkliste in d3).

Knoten-Stand: B-13a (TURN-Zugang 5079) und coturn (B-13b) für Anrufe.

## Schritt B-13d3 – Anrufe: Oberfläche und Datenschutz

**Warum:** Letzter Teil von B-13 (T1 A, T2 A, T3 B): Anrufen und Annehmen in
der App, ehrlich im Datenschutzbericht.

**Was:**
- `shell/anruf-ui.ts` (`wireAnrufe()`, aus `app.ts`):
  - Knöpfe „Anrufen“ und „Videoanruf“ im Kopf der Unterhaltung (`.chat-kopf`,
    neben „Zurück“) – in der Eingabezeile ist mobil kein Platz. Angerufen wird
    nur auf Klick und nur in 1:1; ohne eigenen Knoten nur der Hinweis.
  - Eine Leiste während des Anrufs (Region mit `aria-live`): wer, Phase, der
    Sicherheitscode (B-4, aus `sprichtFuer()`) mit Prüfstand, bei einem
    eingehenden Anruf ohne eigenen Vermittler **vor dem Annehmen** der Hinweis,
    dass der Knoten der anrufenden Person die IP sieht (T3 B). Hat keine Seite
    einen Vermittler, lässt sich nicht annehmen. Annehmen, Ablehnen, Auflegen,
    Schließen.
  - Medien nur als Ströme an `<audio>`/`<video>`; das eigene Bild stumm. Nur
    DOM mit Text.
- Datenschutzbericht: „anruf-ip“ (belegt, Regel `anruf-nur-relay`, Szenario:
  Angebot an Person und Gerät, nur Relay, versiegelt, ein Host-Kandidat geht
  nicht hinaus) und „anruf-vermittler“ (Grenze: der Vermittler sieht IP und
  Zeiten; ohne eigenen Knoten der Knoten der anrufenden Person; Umschläge eines
  Anrufs sind am kurzen Ablauf erkennbar). Texte in beiden Sprachen.
- `icons.ts`: Symbol `phone`; 27 Texte (`komm.anruf*`, `komm.videoanruf`, `komm.videoKnopf`) in `texte/kommunikation.ts`.
- `scripts/anruf-probe.mts`: ein Angebot eines Wegwerf-Kontakts für den
  Smoke-Test, dazu „oeffne“ für Umschläge der App an ihn.

**Tests:**
- protocol +1 (`privacy-facts.test.ts`: Grenze mit Grund, Text im Bericht;
  dazu das Szenario „anruf-ip“ im bestehenden Szenario-Test).
- app +4 (`test/anruf-ui.test.ts`): Knöpfe mit Namen, verdrahtet, nur auf
  Klick, nur 1:1; Leiste nur DOM, keine Medien oder Verbindung im UI-Modul,
  Hinweis vor „Annehmen“, Annehmen gesperrt ohne Weg; Texte in beiden
  Sprachen; Bericht wortgleich mit dem Protokoll.
- Smoke „anruf“: Knöpfe; Anrufen ohne Knoten fragt kein Mikrofon, baut keine
  Verbindung und sendet nichts; ein Angebot eines Kontakts klingelt nach dem
  Abgleich des Posteingangs mit Sicherheitscode und Hinweis; Ablehnen schickt
  genau ein versiegeltes „Ende“ (abgelehnt, geöffnet mit dem Schlüssel des
  Anrufers) – ohne Mikrofon, ohne Verbindung.

**Grenzen:**
- Ein eingehendes Angebot kommt mit dem Abgleich des Posteingangs (höchstens
  einmal je Minute) – bei 60 s Klingeln kann ein Anruf verpasst werden. Ein
  dauerndes Abo des Posteingangs änderte das Verkehrsmuster (6.4); eher über
  den Weckdienst (B-12) – nicht in diesem Schritt.
- Ein durchgehender Anruf mit echtem TURN war hier nicht möglich
  (MENSCH-Checkliste): zwei Geräte, je mit gekoppeltem Knoten und coturn;
  dann eines ohne Knoten (Hinweis, Anruf über den Knoten des Anrufers).

Knoten-Stand: B-13a (TURN-Zugang 5079) und coturn (B-13b) für Anrufe.

## Schritt C-6e – `innerHTML` abbauen: die letzten Ausnahmen

**Warum:** Sammlung C-6, Rest nach C-6d2. In `scripts/innerhtml-ausnahmen.txt`
standen noch vier Stellen: das Logo zweimal (`ui.ts`), die Tresor-Dialoge
(`tresor.ts`) und die Seiten der Einrichtung (`einrichtung-ui.ts`). Alle vier
setzten nur feste Texte, aber als HTML-Text mit eigener Begründung je Stelle.

**Was** (als DOM, Texte über `textContent`):
- **Logo und Häkchen:** `svgEl()` (`ui.ts`, nur für eigene Zeichen) baut
  SVG-Elemente mit `createElementNS`/`setAttribute`. Das Favicon kommt aus
  demselben Element über `XMLSerializer` – vorher wurde der SVG-Text mit
  `replace("<svg ", …)` um den Namensraum ergänzt. `markSvg()` und
  `markSvgCheck()` fallen weg.
- **Tresor-Dialoge** (einrichten, entsperren, neu beginnen): Die IDs bleiben,
  damit Handler und Smoke-Test unverändert greifen. Neu:
  - Die Felder für die Passphrase und das Feld für die Merkphrase tragen ihren
    Platzhalter auch als `aria-label`. Bisher hatten sie nur den Platzhalter;
    nach C-4 reicht der für Vorleser nicht.
  - `escapeHtml` fällt weg.
- **Einrichtung:** Die Seiten bestehen aus `knopf()`, `kasten()` und `leise()`.
  Das Aussehen bleibt gleich und kommt über `style.cssText` (CSSOM).
  - Häkchen gibt es nur über `kasten()` – es setzt nie `checked`.
  - Die Datenschutz-Zeilen sind Text mit `<br>` als Element.
- **Merkphrase:** Der Rahmen des Dialogs ist jetzt auch DOM (die Wörter und
  Felder waren es seit C-6b).
- **Symbole:** `data-icon` wird über `iconEl()` gesetzt.
- **Ausnahmen:** `scripts/innerhtml-ausnahmen.txt` ist leer (zu Beginn von
  C-6 waren es 63). `app.ts`, `ui.ts`, `tresor.ts` und `einrichtung-ui.ts`
  stehen in `FERTIG`.
- **Was bleibt:** `innerHTML` mit festen Texten über `escapeHtml(t(…))` und
  Symbolen aus `icon()`. Das nimmt `check_innerhtml.py` ohne Eintrag an.

**Tests:**
- app +1: C-6e in `test/dom-statt-html.test.ts`. Die Tests zu 8.1a/8.1b
  (Häkchen nicht vorausgewählt, „später bestätigen“) und C-6b prüfen dasselbe
  an der DOM-Form.
- Smoke „einrichtung“ (neu; bisher lief kein Browser-Test über die Seiten nach
  „Schutz“):
  - Logo als SVG-Element, Favicon aus demselben Zeichen mit Namensraum.
  - Sicherungsdialog: 12 Wörter, 3 Abfragefelder, vier Knöpfe.
  - Tresor-Dialog aus der Einrichtung: Felder mit Namen für Vorleser,
    „abbrechen“ führt weiter.
  - Alle Seiten mit ihren Knöpfen und „Schritt n von 5“.
  - „Privat“ mit Werber aus dem Werbelink: beide Häkchen aus, drei
    Verbindungsarten.
  - Danach steht die Wahl wie in den Settings: Schiene `solana`, Vorhaben
    `nutzen`, Zustimmung `0`, Seite `#/agent`.

## Schritt C-5a – Große Dateien aufteilen: `waehrung.ts`

**Warum:** Sammlung C-5. `waehrung.ts` war mit 1079 Zeilen eine der großen
Dateien. Entschieden am 02.10.2026 (MENSCH): je Datei ein Pull Request. Reine
Umzüge dürfen dafür über die 400-Zeilen-Grenze gehen – ein verschobener Block
zählt im Diff doppelt.

**Was** (wörtlich verschoben, keine Verhaltensänderung):
- `waehrung.ts` (337 Zeilen): Seite und Angebotsliste, Solana-Wallet
  (`htlcSigner()`, `connectSolana()`), Lightning über NWC.
- `tausch.ts` (551): Tausch sats → SOL, Einlösen über Relayer, Rückhol-Wächter,
  Gegenrichtung SOL → sats (4.6c), Sicherung der Preimages.
- `hinterlegen.ts` (226): Deposit und Zurückholen, Einzahlung in einen
  Zahlkanal, `geldVorgangLaeuft()`.
- **Einzige Codeänderung:** `export` für `startSwap`, `startRueckSwap`,
  `activeSwap` und `solWallet`. Die Module verwenden einander nur in
  Funktionen, nicht beim Laden. `activeSwap` bleibt eine lebende Bindung –
  `geldVorgangLaeuft()` liest es wie vorher.
- Ein Skript hat geprüft, dass die Blöcke wörtlich gleich sind (bis auf diese
  vier `export`).
- **Aufrufer:** `app.ts` und `zahlkanal-ui.ts` importieren aus dem neuen Ort.
- **Doku:** `docs/SWAPS.md` und die Kommentare in `tresor.ts` und
  `texte/waehrung.ts` nennen ihn ebenfalls.

**Tests:**
- 14 Tests lasen den Quelltext von `waehrung.ts`. Sie lesen jetzt die Datei,
  in der der Code steht. Wo ein Test den ganzen Tab meint, liest er alle drei
  Dateien:
  - „kein Browser-Dialog“ (C-1a) und „keine deutschen Protokolltexte“ (8.16e)
    gelten für jede der drei Dateien;
  - `tausch.ts` und `hinterlegen.ts` stehen in der Liste der fertig
    übersetzten Dateien.
- app +2 in `test/dateigroesse.test.ts` (neu):
  - Die aufgeteilten Dateien bleiben unter 700 Zeilen.
  - Tausch und Hinterlegen kommen aus ihren eigenen Modulen.

## Schritt C-5b – Große Dateien aufteilen: `kommunikation.ts`

**Warum:** Sammlung C-5, je Datei ein PR (MENSCH 02.10.2026). Die Sammlung
verlangt, das Aufteilen von `kommunikation.ts` vorher in FORTSCHRITT zu
vermerken. Das steht dort; keine andere Spur hatte einen offenen PR an der
Datei.

**Was** (wörtlich verschoben, keine Verhaltensänderung):
- `kommunikation.ts` (494 Zeilen, vorher 1186): Modus, Unterhaltungen,
  Chat-Liste, Ablauf, Verlauf, Senden, neue Direktnachricht, Communities.
- `chat-anhaenge.ts` (208): Anhänge inline, im Blob-Netz oder über Blossom,
  Zahlungsanforderungen, Knöpfe an Anhängen.
- `kontakte.ts` (237): private Kontaktliste (2.5b), Namen (Petnames),
  Schlüsselwechsel der Kontakte (8.6a).
- `posteingang.ts` (295): die Kette `oeffneUmschlag()` mit allen `als…()`,
  Verlauf einer Direktnachricht laden, Abgleich des Posteingangs,
  `veroeffentlicheDm()`, `geraeteBuch`.
- **Codeänderungen:**
  - `export` für alles, was ein anderes der vier Module braucht.
  - `chatAttachments = []` nach dem Senden wird zu `leereAnhaenge()`. Eine
    importierte Bindung kann nur ihr eigenes Modul neu zuweisen; die Wirkung
    ist dieselbe.
  - Ein Skript hat geprüft, dass sonst jede Zeile unverändert geblieben ist.
- **Aufrufer:** `app.ts`, `settings.ts` und `sprachnachricht-ui.ts` (Spur C)
  sowie `anruf.ts`, `wecken-ui.ts`, `mls-konto.ts`, `chat-zap.ts`,
  `nachfolge-ui.ts` und `streitfall-ui.ts` (andere Spuren) bekamen nur einen
  neuen Importpfad. Ebenso die Kommentare, die den Posteingang nannten
  (`pruefauftraege-ui.ts`, `raum-mls.ts`, `nachfolge-ui.ts`).

**Tests:**
- 24 Tests lasen Code, der umgezogen ist. Wo sie den ganzen Tab meinen, lesen
  sie jetzt alle vier Dateien. Die Kette der Umschläge (5.5c) prüft der Test
  in `posteingang.ts`.
- Jeder Ausschnitt zwischen zwei Funktionsnamen bleibt innerhalb einer Datei;
  ein Skript hat das geprüft.
- app +1: C-5b in `dateigroesse.test.ts`. Die vier Dateien stehen unter der
  Grenze von 700 Zeilen.
- Wo ein Test eine Liste von Dateien prüft, stehen die drei neuen Module mit
  drin. Damit verliert keine Prüfung durch den Umzug an Reichweite:
  - `FERTIG` (kein `innerHTML`),
  - keine alten Relays,
  - Texte nur über Schlüssel.

## Schritt C-5c – Große Dateien aufteilen: `settings.ts`

**Warum:** Sammlung C-5, je Datei ein PR (MENSCH 02.10.2026).

**Was** (wörtlich verschoben, keine Verhaltensänderung):
- `settings.ts` (477 Zeilen, vorher 1274): Sicherheitsstand, Nachfolge,
  Weitergeben und Echtheitsprüfung, Gebühren-Karte, Relays.
- `sicherung.ts` (449): verschlüsselte Sicherung des Zustands, Datenexport,
  Schlüsselwechsel und Widerruf, Geräte mit Vollmacht, Meldung für andere.
- `mesh.ts` (379): Mesh-Knoten, Warteschlange, SOL-Zahlungen ohne Internet
  einreichen, `sendeUeberFunk()`, `funkGeraetVerbunden()`.
- **Einzige Codeänderung:** `export` für Querverweise. Ein Skript hat geprüft,
  dass sonst jede Zeile unverändert ist; keine Bindung wird über Modulgrenzen
  neu zugewiesen.
- **Aufrufer:** `app.ts`, `agent.ts` (Funk) und `offline-zahlung.ts` bekamen
  nur einen neuen Importpfad.

**Tests:**
- 17 Tests und ein Leak-Test lasen umgezogenen Code. Wo sie die Settings
  meinen, lesen sie jetzt alle drei Dateien.
- Tests, die Dateien aufzählen, nennen die neuen Module mit:
  - „QR mit dem Gerätecode nur geheim“ – der Dialog steht jetzt in
    `sicherung.ts`; ohne den Eintrag hätte die Prüfung ihn still nicht mehr
    gesehen;
  - Texte nur über Schlüssel;
  - `FERTIG` (kein `innerHTML`).
- app +1: C-5c in `dateigroesse.test.ts`.

## Schritt C-5d – Große Dateien aufteilen: `agent.ts`

**Warum:** Sammlung C-5, je Datei ein PR (MENSCH 02.10.2026). `agent.ts`
war mit 1892 Zeilen die größte Datei.

**Was** (wörtlich verschoben, keine Verhaltensänderung):
- `agent.ts` (653 Zeilen): `askAi()`, Konsens, Auftrag bauen
  (`buildJobEvent()`), auf die Antwort warten und sie abrechnen
  (`waitForAnswer()`, `handleAnswer()`), KI über Funk, `frageMeinenKnoten()`,
  `frageAufDiesemGeraet()`.
- `modellwahl.ts` (288): Dropdown und Popover, Gruppe „Mein Knoten“,
  „Dieses Gerät“.
- `agent-verlauf.ts` (137): Aufgaben und Nachrichten auf diesem Gerät,
  rechte Spalte.
- `agent-wege.ts` (240): Failover, Race (Max), Schwarm, Video, private
  Antworten.
- `agent-anzeige.ts` (505): Gebühren- und Token-Vorschau, Fehler-Blase, Budget,
  Blasen, Kosten-Blase mit Reklamation, Schritt-Leiste und Orb.
- `agent-eingabe.ts` (124): Werkzeug-Knöpfe mit Preisen, leerer Zustand, Bild
  anhängen.
- **Einzige Codeänderung:** `export` für Querverweise. Ein Skript hat
  geprüft, dass sonst jede Zeile unverändert ist.
- **Bewusster Schnitt:** `frageMeinenKnoten()`, `frageAufDiesemGeraet()` und
  der Konsens bleiben in `agent.ts`. Sie setzen `jobAbort` neu, und eine
  importierte Bindung kann nur ihr eigenes Modul neu zuweisen.
- **Aufrufer:** `app.ts` und `hinterlegen.ts` bekamen nur einen neuen
  Importpfad.
- Damit ist Sammlung C-5 fertig. Keine Tab-Datei hat mehr als 700 Zeilen;
  `dateigroesse.test.ts` hält das fest.

**Tests:**
- 15 Tests und ein Leak-Test lasen umgezogenen Code. Wo sie den Agenten
  meinen, lesen sie jetzt alle sechs Dateien.
- Ein Ausschnitt (`askAi()` bis zur nächsten Funktion) endet jetzt an der
  nächsten Funktion in `agent.ts`. Er lief sonst über die Dateigrenze, weil
  `askWithFailover()` umgezogen ist.
- Listen von Dateien (`FERTIG`, Texte) nennen die neuen Module mit.
- app +1: C-5d in `dateigroesse.test.ts`. Es prüft auch, dass kein neues Modul
  `jobAbort` neu setzt.

## Schritt C-20g1 – Reviews an Patches: Zeilenkommentare und Bewertungen (Protokoll)

**Warum:** Sammlung C-20, Ziel „Repos 1:1 wie GitHub“. Reviews brauchen ein
Format; der MENSCH hat am 02.10.2026 entschieden, alle offenen Formate als
Vorschlag auszuarbeiten und umzusetzen, je Punkt ein Schritt.

**Was:**
- `protocol/src/review.ts` (neu): `baueZeilenKommentar()` – ein Kommentar nach
  NIP-22 (Kind 1111) am Patch mit `["zeile", pfad, seite, nummer]` (Seite `neu`
  oder `alt` für entfernte Zeilen); `baueBewertung()` – Kommentar direkt am
  Patch mit `["bewertung", "genehmigt" | "aenderungen"]`, Begründung darf leer
  sein. Andere Clients zeigen beides als gewöhnlichen Kommentar.
- Lesen streng: `leseZeilenbezug()` (Pfad ohne Steuerzeichen, höchstens 2000
  Zeichen, Zeile 1 bis 10 Mio., nur Ziffern), `zeilenKommentareZu()` (ältester
  zuerst), `leseBewertung()` (nur direkt am Patch: `E` = `e`, `K` = `k` = 1617),
  `bewertungenZu()` – je Person die neueste (gleiche Sekunde: die größere Id),
  die eigene des Patch-Autors zählt nicht, `maintainer` über `darfAnnehmen()`.
  `istReviewTeil()` für die Diskussion.
- Private Räume: `raumRepoZeilenKommentar()`, `raumRepoBewertung()`
  (`raum-repo.ts`) – nur innere Events.
- Format in `docs/PROTOCOL.md` (19, „Reviews an Patches“). Fehler mit Kennung
  (`review-zeile`, `review-patch`, `review-bewertung`) und Texten in beiden
  Sprachen (`pf.*`).
- Bewusst: Eine Bewertung ändert den Status eines Patches nie. Annehmen bleibt
  bei Eigentümer und Maintainern (`darfAnnehmen()`); die Bewertung ist eine
  Aussage, keine Freigabe.

**Tests:** protocol +6 (`review.test.ts`): Bau und Lesen, Negativfälle
(Zeile 0, Steuerzeichen, unbekannte Seite oder Bewertung, Bezug auf ein
Issue, Antwort statt direkt am Patch), neueste je Person, Autor zählt nicht,
privat als inneres Event samt Leak-Regel `raum-repo-privat`.

**Verdrahtet:** noch nicht in der App – das ist C-20g2 (Knöpfe an Diff-Zeilen,
Bewertung auf der Patch-Seite). `check-wiring.py --streng` führt die neuen
Exporte bis dahin als Ausnahme.

## Schritt C-20g2 – Reviews an Patches: Oberfläche

**Warum:** Sammlung C-20, zweiter Teil zu C-20g1 – das Format allein nützt
niemandem, solange die App es nicht zeigt und senden kann.

**Was:**
- `shell/tabs/review-ui.ts` (neu, `reviewAnsicht()`): über den Änderungen
  „Reviews“ mit Stand („1 genehmigt · 0 Änderungen erbeten“), je Person die
  neueste Bewertung mit Marke „Maintainer“ und Begründung (Markdown, nur DOM).
  Knöpfe „Genehmigen“ und „Änderungen erbitten“ – nicht für den Autor des
  Patches, seine Bewertung zählt nicht. „Änderungen erbitten“ verlangt eine
  Begründung, „Genehmigen“ nicht. Der Dialog sagt, dass eine Bewertung den
  Status nicht ändert, und wer mitliest.
- `patch-seite.ts`: „Zeilen kommentieren“ (aria-pressed) zeigt an jeder Zeile
  einen Knopf „+“ mit Namen für Vorleser („Kommentar an hammer.txt, Zeile 1“).
  Vorher ist er nicht da (`display: none`) – sonst stünde vor jeder Zeile ein
  Tab-Halt, und mobil wären alle Zeilen 40 px hoch. Neue und unveränderte
  Zeilen zählen nach der neuen Nummer, entfernte nach der alten.
- Kommentare an einer Zeile stehen als Faden darunter, mit „Antworten“
  (gleiche Zeile, Eltern ist der erste Kommentar des Fadens). Kommentare an
  Zeilen, die im Diff nicht stehen, sammelt ein Abschnitt unter den Dateien.
- `repo-ansicht.ts`: `mitIssues()` liefert `patchReviews` je Patch – aus
  denselben Daten wie die Kommentare, öffentlich und privat getrennt. Die
  Diskussion (`patchKommentare`) zeigt keine Review-Teile mehr; die
  Neuigkeiten (C-20f) zählen sie trotzdem mit.
- Senden öffentlich signiert (`baueZeilenKommentar()`, `baueBewertung()`),
  privat nur `sendeInRaum()` mit den Bausteinen aus `raum-repo.ts`.
- Die Ausnahmen aus C-20g1 in `wiring-ausnahmen.txt` sind gestrichen – alle
  Exporte sind jetzt verdrahtet.

**Tests:** app +3 (`review-ansicht.test.ts`): Reviews an der Karte getrennt
von der Diskussion, die eigene Bewertung der Autorin zählt nicht, nie über
die Grenze öffentlich/privat; Neuigkeiten; Verdrahtung. Eine Prüfung in
`issues-ansicht.test.ts` folgt dem neuen Ende der Patch-Seite. Smoke
(desktop und mobil): „+“ erst nach dem Schalter, mobil 40 px; Kommentar an
„scharf“ mit `["zeile", "hammer.txt", "neu", "1"]` unter der Zeile, nicht in
der Diskussion; „Genehmigen“ mit `["bewertung", "genehmigt"]`, oben mit
„Maintainer“, Status bleibt „angenommen“.

## Schritt C-20h1 – Releases von Repos (Protokoll)

**Warum:** Sammlung C-20, Format nach der Entscheidung des MENSCHEN vom
02.10.2026. GitHub kennt Releases: eine Version mit Notizen und Dateien.

**Was:**
- `protocol/src/repo-release.ts` (neu): Release als NIP-51-Satz „Release
  artifact set“ (Kind 30063), ersetzbar je Autor, `d` = `<kennung>@<version>`.
  `a` zeigt auf das Repo (30617) – es steht für die „Anwendung“ aus NIP-51.
  Tags: `version` (wie ein Git-Tag, kein `..`, höchstens 100), `title`
  (Pflicht, höchstens 200), optional `commit`, `blob` + `aes-gcm` (Bundle
  dieser Version), `vorab`. Der Inhalt sind die Notizen (Markdown, 64 KB).
- Bewusste Abweichung von NIP-51: das Bundle nicht als NIP-94-Datei (1063),
  sondern im Release selbst. Der Bundle-Verweis 38042 ist ersetzbar und zeigt
  immer auf das neueste Bundle; ein Release muss seine Version festhalten.
- Lesen streng (`leseRepoRelease()`: `d` muss zu `a` und `version` passen,
  ein kaputtes Bundle oder ein kaputter Commit fallen nur für sich heraus).
  `repoReleasesZu()`: nur Eigentümer und Maintainer, je Version die neueste
  Aussage; ein Rückzug (`baueRepoReleaseRueckzug()`, `["zurueckgezogen"]`)
  blendet die Version aus. `neuestesRepoRelease()`: das jüngste ohne `vorab`.
- Private Räume: `raumRepoRelease()`, `raumRepoReleaseRueckzug()`;
  `raumReposPrivat()` liefert `releases`. Die Leak-Regel `raum-repo-privat`
  kennt Kind 30063.
- Fehler mit Kennung (`release-repo`, `-version`, `-titel`, `-gross`,
  `-commit`, `-bundle`) und Texten in beiden Sprachen.
- Format in `docs/PROTOCOL.md` (19, „Releases“, und in der Tabelle der Kinds).

**Fund unterwegs:** Die Datei hieß zuerst `release.ts` – die gibt es schon
(Release-Manifest der App, 38054). Beim ersten Schreiben im Arbeitsbaum
überschrieben, vor jedem Commit aus git wiederhergestellt; das Format heißt
jetzt `repo-release.ts` mit eigenen Namen (`KIND_REPO_RELEASE`, …). Als
Fallstrick in `CLAUDE.md` vermerkt.

**Tests:** protocol +6 (`repo-release.test.ts`): Bau und Lesen, Negativfälle
(Version, Titel, Größe, Commit, Bundle, Repo), strenges Lesen fremder Events,
Liste (nur Pfleger, neueste je Version, Rückzug, Fremde ziehen nichts zurück,
neuestes ohne Vorab), privat als inneres Event, Leak-Regel.

**Verdrahtet:** noch nicht in der App – das ist C-20h2 (Reiter „Releases“);
bis dahin sechs begründete Ausnahmen in `wiring-ausnahmen.txt`.

**Nachtrag (Smoke „weckworker“, Code von Spur B, B-12c):** Lokal war der
Teil zweimal rot (keine Meldung nach dem Push), die CI grün. Gemessen: Ein
Push per CDP direkt nach der Aktivierung des Workers geht in Chromium
gelegentlich verloren (3 von 40). Mit einer Sekunde Abstand passierte es in 0
von 40 Läufen, ein zweiter Push zeigte die Meldung jedes Mal. Erlaubnis, Zustand
(`activated`) und Fehlerberichte des Workers waren dabei unauffällig. Der Worker
ist also nicht schuld. Die Prüfung stellt jetzt bis zu fünfmal zu, je mit Frist,
bis eine Meldung da ist – wartet also auf einen Zustand statt auf eine Pause.
Die Erwartung bleibt: genau eine Meldung mit festem Text, ohne Inhalt.
Danach 0 von 40 rot, 4 brauchten eine zweite Zustellung.

## Schritt C-20h2 – Releases von Repos: Oberfläche

**Warum:** Sammlung C-20, zweiter Teil zu C-20h1 (#286).

**Was:**
- `shell/tabs/releases-reiter.ts` (neu, `releasesReiter()`): je Release Titel,
  Version, „Neuestes“ (das jüngste ohne Vorab) bzw. „Vorabversion“, wer und
  wann, Commit, Notizen als Markdown (nur DOM). „Bundle dieser Version laden“
  holt das Chiffrat aus dem Blob-Netz und entschlüsselt mit dem Schlüssel aus
  dem Release – nicht aus dem ersetzbaren Verweis 38042.
- Eigentümer und Maintainer (`darfAnnehmen()`): „Neues Release“ im Dialog –
  Version (wie ein Git-Tag, eine vorhandene Version wird abgewiesen), Titel,
  Notizen, „aktuelles Bundle festhalten“ (nur wenn der Verweis einen Schlüssel
  trägt; mit vollem SHA-1 auch der Commit), „als Vorabversion“. „Zurückziehen“
  mit Rückfrage. Der Text sagt ehrlich, was bleibt: Wer das Bundle schon
  geladen hat, behält es.
- `repo-seite.ts`: Reiter „Releases (n)“ zwischen Patches und Mitwirkenden,
  nicht für Repos nur auf diesem Gerät.
- `repos.ts`: Releases nach Repo-Adresse laden wie Issues (`#a`);
  `repo-ansicht.ts`: `mitIssues()` hängt `releases` an – öffentlich nur an
  öffentliche Karten, privat nur aus ihrer Gruppe (`raumReposPrivat()` liefert
  sie seit C-20h1).
- Die sechs Ausnahmen aus C-20h1 in `wiring-ausnahmen.txt` sind gestrichen.

**Tests:** app +2 (`releases-ansicht.test.ts`): Releases an der Karte (nur
Pfleger, neuestes zuerst, nie über die Grenze öffentlich/privat), Verdrahtung.
Zwei ältere Prüfungen folgen dem neuen Aufruf von `mitIssues()` bzw. der
Reiterliste. Smoke (desktop und mobil): „Releases (0)“ leer, „Neues Release“
mit Tastatur, gesendet Kind 30063 mit `d`, `a`, `version`, `title` und den
Notizen, Karte mit „Neuestes“ und Markdown, „Releases (1)“; „Zurückziehen“
fragt nach, sendet `["zurueckgezogen"]`, danach wieder leer.

## Schritt C-20i1 – Labels ändern und Zuständige (Protokoll)

**Warum:** Sammlung C-20, Format nach der Entscheidung des MENSCHEN vom
02.10.2026. Labels stehen bisher nur als `t`-Tags im Issue selbst (C-20e
filtert danach); ändern und zuweisen ging nicht.

**Was:**
- `protocol/src/repo-labels.ts` (neu): Label-Event nach NIP-32 (Kind 1985) an
  genau einem Issue oder Patch (`e` = Id, `k` = 1621/1617). Namensraum `#t`
  für Labels (wie die `t`-Tags nach NIP-34) oder `freedomstack.zustaendig`
  für Zuständige – deren Werte sind Schlüssel als Hex, bewusst keine
  `p`-Tags, denn in 1985 wären das weitere Ziele.
- Bewusste Abweichung vom additiven NIP-32: Ein Event nennt den ganzen Stand
  seines Namensraums. Es zählt je Ziel und Namensraum die neueste Aussage
  von Eigentümer oder Maintainern (`labelStandZu()`, bei gleicher Sekunde die
  größere Id); ein Event ohne `l` entfernt alles. Ohne Aussage gelten die
  `t`-Tags des Issues. Andere Clients sehen gewöhnliche Labels.
- Lesen streng (`leseLabelStand()`): genau ein Namensraum, genau ein Ziel der
  richtigen Art, nur gültige Werte, höchstens 20 Labels bzw. 10 Zuständige;
  `l`-Tags anderer Namensräume zählen nicht.
- Private Räume: `raumRepoLabels()`; `raumReposPrivat()` liefert `labels`. Die
  Leak-Regel `raum-repo-privat` weist ein offenes 1985 zu einem inneren Issue
  oder Patch ab (wie Kommentare).
- Kind 1985 wertete bisher niemand aus. MDK merkt sich in Gruppen bei 1985 nur,
  ob der Absender Admin war – das stört nicht.
- Fehler mit Kennung (`label-ziel`, `-art`, `-zustaendig`, `-viele`; Labels
  selbst wie bisher `issue-label`) und Texten in beiden Sprachen. Format in
  `docs/PROTOCOL.md` (19).

**Tests:** protocol +4 (`repo-labels.test.ts`): Bau und Lesen, Negativfälle,
strenges Lesen fremder Events, Stand (neueste von Pflegern, Fremde zählen
nicht, Namensräume getrennt, leer entfernt), privat und Leak-Regel.

**Verdrahtet:** noch nicht in der App – das ist C-20i2; bis dahin vier
begründete Ausnahmen in `wiring-ausnahmen.txt`.

## Schritt C-20i2 – Labels ändern und Zuständige: Oberfläche

**Warum:** Sammlung C-20, zweiter Teil zu C-20i1 (#288).

**Was:**
- `shell/tabs/labels-ui.ts` (neu, `labelLeiste()`): „Zuständig: …“ bzw.
  „niemand“, auf Wunsch die Labels. Für Eigentümer und Maintainer gibt es
  „Labels bearbeiten“ (Dialog, mit Komma getrennt, vorbelegt, geprüft wie beim
  Anlegen) und „Zuständige wählen“ (Häkchen: Eigentümer, Maintainer, wer das
  Issue oder den Patch schrieb). Gesendet wird je Namensraum der ganze Stand
  (`baueLabelStand()`), öffentlich signiert, privat nur `sendeInRaum()`. Der
  Dialog sagt, wer es sieht.
- Issue-Seite: die Leiste unter der Kopfzeile (die Labels stehen dort schon
  seit C-20e). Patch-Seite: Labels und Zuständige unter dem Status
  (`PatchAnsicht.labels`, fehlt in der Vorschau).
- `repos.ts`: Label-Events nach Ziel laden (`#e`, wie die Kommentare).
  `repo-ansicht.ts`: `mitIssues()` setzt den Stand an die Issues – er ersetzt
  deren `t`-Tags, also folgt auch der Label-Filter aus C-20e – und als
  `patchLabels` an die Patches; öffentlich und privat getrennt.
- Die vier Ausnahmen aus C-20i1 in `wiring-ausnahmen.txt` sind gestrichen.

**Tests:** app +2 (`labels-ansicht.test.ts`): Stand ersetzt Labels, Zuständige,
Fremde zählen nicht, Label-Filter folgt, nie über die Grenze
öffentlich/privat; Verdrahtung. Smoke (desktop und mobil): an „Hammer
klemmt“ „Labels bearbeiten“ (vorbelegt „bug“, dazu „dringend“) und
„Zuständige wählen“ (drei Kandidaten, „Du“) – zwei Events 1985 mit dem ganzen
Stand je Namensraum, danach „bug“, „dringend“ und „Zuständig: Du“ auf der Seite.

## Schritt C-20j1 – Forks, Sterne und Beobachten (Protokoll)

**Warum:** Sammlung C-20, der letzte Punkt mit eigenem Format, nach der
Entscheidung des MENSCHEN vom 02.10.2026.

**Was:**
- Fork (`nip34.ts`): neues Feld `forkVon` in der Ankündigung →
  `["a", "30617:<eigentümer>:<kennung>", "", "fork"]`. Gelesen nur mit der
  Marke `fork` und nie auf die eigene Adresse; ein bloßes `a`-Tag ist kein
  Fork. Fehler `repo-fork`. `forksVon()` (`repo-sterne.ts`) sammelt die Forks.
- Stern (`repo-sterne.ts`): öffentlich, Reaktion nach NIP-25 (Kind 7, Inhalt
  `⭐`, genau ein `a` = Repo, `p` = Eigentümer, `k` = 30617). Zurück mit
  einer Löschung nach NIP-09 (Kind 5, `e` = Id des Sterns). `sterneZu()`
  zählt je Person den jüngsten Stern; einer, den sein Autor gelöscht hat,
  zählt nie – auch wenn ein Relay die Löschung nicht befolgt. Die Löschung
  eines anderen zählt nicht.
- Beobachten: privat. NIP-51-Liste „Git repositories“ (Kind 10018) nur mit
  privaten Einträgen: `beobachtungsInhalt()` liefert den Klartext
  `[["a", …], …]`, die App verschlüsselt ihn über den Signer (NIP-44 an sich
  selbst); `baueBeobachtungsListe()` nimmt nur das Chiffrat und hat keine
  offenen Tags. `leseBeobachtungsInhalt()` liest streng (höchstens 500).
  `eigeneBeobachtungsListe()` nimmt die jüngste eigene ohne offene Einträge.
  Darum gibt es – anders als bei GitHub – keine Zahl der Beobachter.
- Leak-Regel `raum-repo-privat` kennt jetzt Kind 7 und 10018: Ein Stern, ein
  offener Listeneintrag oder ein Fork (30617 mit Verweis) zu einem Repo eines
  privaten Raums ist ein Leck.
- `KIND_LOESCHUNG` gab es schon (`coverage.ts`) – mitgenutzt, nicht doppelt.
- Fehler mit Kennung (`repo-fork`, `stern-repo`, `beobachten-liste`) und
  Texten in beiden Sprachen. Format in `docs/PROTOCOL.md` (19).

**Tests:** protocol +4 (`repo-sterne.test.ts`): Fork (Marke, nie auf sich
selbst), Sterne (einer je Person, Löschung nur vom Autor, nur genau dieses
Repo, ein Like ist kein Stern), Beobachten (keine offenen Tags, strenges
Lesen), Leak-Regel.

**Verdrahtet:** noch nicht in der App – das ist C-20j2; bis dahin sieben
begründete Ausnahmen in `wiring-ausnahmen.txt`.

## Schritt C-20j2 – Sterne und Beobachten: Oberfläche

**Warum:** Sammlung C-20, Oberfläche zu C-20j1 (#290). Forks folgen in C-20j3.

**Was:**
- `shell/tabs/repo-sterne-ui.ts` (neu): unter dem Titel eines öffentlichen
  Repos „☆ Stern (n)“ bzw. „★ Stern entfernen (n)“ und „Beobachten“ bzw.
  „Nicht mehr beobachten“ (aria-pressed). Ohne Identität nur die Zahl.
- Stern: vergeben erst nach Rückfrage – öffentlich und signiert; der Text sagt
  auch, dass nicht jedes Relay eine Löschung befolgt. Zurücknehmen ohne
  Rückfrage (Löschung nach NIP-09).
- Beobachten: die eigene Liste (10018) wird vor jedem Schreiben frisch gelesen
  (`ladeBeobachtet(pool, true)` – scheitert die Abfrage oder das Entschlüsseln,
  etwa weil der Bunker nicht antwortet, wird nichts geschrieben; sonst
  überschriebe ein Gerät die Fassung eines anderen), über den Signer an sich
  selbst verschlüsselt und ohne offene Tags veröffentlicht. Die Menge liegt
  nur im Speicher.
- `repos.ts`: Sterne nach Repo-Adresse, ihre Löschungen nach Id, die eigene
  Liste nach Autor laden; `mitSternen()` (`repo-ansicht.ts`) nur an
  öffentliche Karten. In der Liste „⭐ n“ an der Karte.
- `repo-neuigkeiten.ts`: Beobachtete Repos melden Neues wie eigene (C-20f).
- Die sieben Ausnahmen aus C-20j1 in `wiring-ausnahmen.txt` sind gestrichen.

**Tests:** app +2 (`sterne-ansicht.test.ts`): Karte (eigener Stern, gelöschte
zählen nicht, nur öffentliche Repos), Neuigkeiten für beobachtete Repos;
Verdrahtung (Rückfrage, frisch lesen vor dem Schreiben, verschlüsselt, nichts im
localStorage). Smoke (desktop und mobil): Stern nach Rückfrage (Kind 7, `⭐`,
`a` = Repo), „★ Stern entfernen (1)“, zurück (eine Löschung mit `e` = Stern),
„Beobachten“ (eine Liste 10018, `tags` leer, die Adresse nicht im Inhalt).

## Schritt C-20j3 – Forks: Oberfläche

**Warum:** Sammlung C-20, der letzte Teil – Forks wie bei GitHub (Format aus
C-20j1, #290).

**Was:**
- `shell/tabs/fork-ui.ts` (neu, `forkZeile()`): auf der Seite eines
  öffentlichen Repos „Forks: n“ und „Forken“ (nicht für das eigene).
- Forken öffnet einen Dialog mit Kennung und Name, vorbelegt wie beim
  Original. Eine Kennung, die schon ein eigenes Repo trägt, wird abgewiesen –
  sonst ersetzte der Fork dessen Ankündigung (ersetzbar je Kennung).
  Veröffentlicht wird eine eigene Ankündigung mit `forkVon` (samt Beschreibung
  und erstem Commit). Trägt der Verweis des Originals einen Schlüssel, kommt
  ein eigener Verweis (38042) auf denselben Blob mit demselben Schlüssel dazu –
  nichts wird neu hochgeladen; der Schlüssel stand ohnehin öffentlich.
- Am Fork steht „Geforkt von … / …“ und – wenn das Original in der Liste
  steht – „Zum Original“ (über `oeffneRepo()`, gilt also wie jedes Öffnen als
  gesehen).
- `repos.ts`: Forks der geladenen Repos per `#a` mitladen (auch wenn sie
  nicht unter den neuesten Ankündigungen sind); `mitForks()`
  (`repo-ansicht.ts`) nur an öffentliche Karten. `RepoSeiteHilfe` hat dafür
  `zuRepo` und `eigeneKennungen`.

**Tests:** app +2 (`forks-ansicht.test.ts`): Karte (Zahl beim Original, Weg
zurück beim Fork, private zählen nicht, ohne Original kein Weg), Verdrahtung.
Eine Prüfung aus C-20j2 folgt dem Aufruf in `mitForks()`. Smoke (desktop und
mobil): „werkzeug“ forken (vorbelegt, Enter) – eine Ankündigung mit
`["a", <original>, "", "fork"]`, kein Bundle-Verweis (das Probe-Original hat
keinen Schlüssel), „Forks: 1“; der Fork zeigt „Geforkt von … / werkzeug“, kein
„Forken“, und „Zum Original“ führt zurück.

**Damit ist Sammlung C-20 fertig:** Repos wie GitHub mit Markdown, Zweigen
und Tags, Verlauf, Suche, Labels, Benachrichtigungen, Reviews, Releases,
Zuständigen, Sternen, Beobachten und Forks. Ohne Server bleiben Actions und
Pages (höchstens über Provider-Knoten mit Sandbox, Spur A/B).

## Schritt A-7r – Entscheidungen 04.10., „vergleichen“ zurückgenommen, Entwurf Freedom-Prüfung

Entscheidungen des MENSCHEN vom 04.10.2026 (Sammlung, Abschnitt 5):

| Frage | Entscheidung |
|---|---|
| E1 | A: frische Adresse, keine Verwahrung |
| E2 | A |
| E3 | A: der Zahlkanal ist vorab einzahlen, Treuhand, Rest zurück. Neu dazu Z1 A: `refund` nach Ablauf ohne Unterschrift des Kunden. Seed Vault erst in der nativen App. |
| E4 | A |
| E5 | aufgeteilt: Logik Spur A, Oberfläche Spur C |
| E7 | wie OpenRouter, mit automatischen Kontrollen statt Vergleichen für Kunden |
| E8 | B, dazu Aufstocken und Warnung |
| E9 | A |
| E10 | B |
| E11 | B jetzt, A nach dem Devnet-Deploy |

**Was:**
- **Haken „vergleichen“ (A-7) entfernt.** Der MENSCH will ihn nicht als
  Kundenfunktion und nicht auf der Agent-Seite. Raus sind:
  - `askKonsens()`, `konsensVorbereiten()`, `setupKonsens()` und `nachAnzeige` in
    `handleAnswer()` (`shell/tabs/agent.ts`);
  - das Label in `index.html` und die Texte `agent.konsens*`;
  - `app/src/konsens.ts` und `konsens.test.ts` (−4 Tests, Funktion entfernt);
  - im Test `ki-lokal.test.ts` die Grenze des Ausschnitts von `askAi()`, jetzt
    die nächste Funktion.
- **`consensus.ts` bleibt** als Baustein des Prüfers. Die fünf Ausnahmen in
  `wiring-ausnahmen.txt` sind mit dem neuen Grund zurück.
- **`docs/FREEDOM-PRUEFUNG.md` (neu):**
  - Recherche, wie OpenRouter prüft und auswählt (Testverkehr vor dem
    Freischalten, Verfügbarkeit in Stufen 95/80 %, Ausfall zurückstellen, 1/Preis²,
    Auto Exacto mit Neuen in der Mitte, öffentliche Kennzahlen).
  - Übertragung auf FreedomStack: eigene Messung nur auf dem Gerät; Prüfer als
    Rolle des Knotens mit synthetischen Prüffragen; Messbericht 38081;
    Auswahl in der App; Probezeit mit Grundtest.
  - Schritte P1–P4.
- **Sammlung:** E1–E11 entschieden, Z1 neu, A-1/A-6–A-10 nachgezogen.
- **FORTSCHRITT:** Reihenfolge der Spur A.
- **CLAUDE.md:** Fallstrick „Kein Vergleichen für Kunden“ statt der Regel aus
  A-7.
- **Whitepaper:** Prüfung „im Aufbau“ statt „gibt es“.

Endstand (A-7r, 04.10.): protocol 1188 (6 übersprungen) · node 313 (6
übersprungen, mit Netz) · app 842 (−4 `konsens.test.ts`, Funktion auf Wunsch
des MENSCHEN entfernt; +1 Test, dass der Haken nicht wiederkommt) · mls 13 ·
Leak-Tests 72 grün + 1 todo · 0 rot · check-wiring `--streng` Exit 0 (159
Ausnahmen) · innerHTML streng Exit 0 · Website ok · Smoke-Test bestanden.
Knoten-Stand: unverändert.

## Schritt Z1 – Zahlkanal: Rest nach Ablauf ohne Unterschrift des Kunden

Entscheidung 04.10.2026 (Z1 A, aus E3): Der Rest eines Kanals soll nach
Ablauf auch dann zurückkommen, wenn die Wallet des Kunden nicht unterschreiben
kann – nicht verbunden oder später eine Seed Vault in der nativen App. Geändert
vor dem Deploy, daher ohne neue Programmversion: Es gibt noch kein
veröffentlichtes Programm, dessen Verhalten sich ändern würde.

**Was:**
- **Programm** (`contracts/solana-channel/.../lib.rs`): `refund` hat als
  Kunden ein `UncheckedAccount` statt `Signer`.
  - `has_one = customer` bindet die Adresse an den Kunden aus dem Kanal.
  - `close = customer` schickt Rest und Miete nur dorthin.
  - Die Gebühr zahlt, wer die Transaktion bezahlt.
  - Unverändert: nur ab `expiry`; ein falscher Kunde scheitert mit
    `FalscherKunde`.
- **Client** (`protocol/src/channel.ts`): `erstatteKanalIx()` ohne
  Signer-Flag.
- **App** (`zahlkanal.ts`): `erstatteKanaele()` holt jeden abgelaufenen Kanal
  zurück, Empfänger ist der Kunde auf der Kette. Die Wallet der App zahlt nur
  die Gebühr, auch bei einem Kanal einer anderen Wallet; vorher brach die App
  dort mit „gehört einer anderen Wallet“ ab. Der Text dazu fällt weg.
- **`docs/ZAHLKANAL.md`, `CLAUDE.md`:** Regel nachgezogen.

**Tests:**
- Validator (`contracts/solana-channel/tests/kanal.test.ts`, lokal mit Agave
  3.1.10): 7/7. `refund` jetzt ohne Unterschrift des Kunden – mit dem alten
  Programm schlüge das fehl. Zurück kommt der volle Betrag, weil ein anderer
  die Gebühr zahlte.
- `channel.test.ts`: refund ohne Signer, top_up weiter mit.
- `zahlkanal.test.ts`: Kanal einer anderen Wallet wird an deren Adresse
  zurückgeholt.

**Verdrahtet:** `refund-watcher.ts` (`walletRefundRunner` → `erstatteKanaele()`).

**Prüfungen:**
- protocol 1188 grün (6 übersprungen), node 313 grün, app 842 grün, mls 13;
- Leak-Tests 72 grün + 1 todo; Zahlkanal 7/7 gegen den Validator;
- check-wiring `--streng` Exit 0, innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.

Die Zahl der Tests bleibt gleich: Die Fälle sind angepasst, nicht neu.

Knoten-Stand: unverändert. Der Knoten ruft `refund` nicht auf.
Programm-Stand: Der Devnet-Deploy (MENSCH) muss dieses Programm nehmen.

## Schritt 12.2 + 12.3 – SOL-Adressen für Werber und Relays

Entscheidungen 04.10.2026: E1 (frische Adresse, nichts verwahrt) und E2 A.
Bei Zahlungen per Zahlkanal fand `kanalEmpfaenger()` bisher nur die
Hosting-Adresse. Die Anteile von Werbern (2 × 0,5 %) und Relays (1,5 %) blieben
deshalb beim Provider. Jetzt kennen alle drei auch eine SOL-Adresse.

**12.2 – Werbelink mit SOL-Adresse (App):**
- `werbung.ts`: `werbeLink(basis, ref, lud16?, sol?)` hängt `&sol=` an, nur
  eine gültige Adresse.
- `werbeSolAdresse()` vergibt je Kette einmal eine frische Adresse aus der
  eingebauten Wallet und merkt sie unter `freedom.solWallet.werbelink`. Das ist
  das Präfix der Wallet, also im Tresor und nie in der Sicherung. Die
  Hauptadresse steht nie im Link.
- Die App des Geworbenen merkt die Adresse wie die Lightning-Adresse
  (`freedom.referrer.sol`, in der Sicherung): nur vom ersten Werber, nie
  überschrieben.
- Beim kurzen Namen (11.2b) gilt sie erst nach der Auflösung.
- `werberZahlziel()` liefert `{ lud16?, sol? }`.
- Earn-Tab (`earn.ts`, `ergaenzeWerbeSol()`): Der Link bekommt die Adresse,
  sobald die Wallet sie hat. Ohne eingebaute Wallet gibt es keine; der Text
  sagt, was der Link trägt.

**12.3 – Werber des Providers und Relays (Protokoll, Knoten, App):**
- Angebot 38027 mit `werber_sol` (`tiers.ts`, `werberSol`).
- Knoten: `PROVIDER_WERBER_SOL`, geprüft; ist sie ungültig, startet er nicht.
- App: `empfaengerFuer()` gibt dem Anteil `werber-provider` beide Adressen.
- Relays: `RelayZahlziele` liest aus dem signierten Profil des Betreibers
  neben `lud16` auch `sol` (`ausProfil()`, nur plausible Adressen).
- `docs/PROTOCOL.md`, `GO-LIVE.md` und FAQ sind nachgezogen.

**Tests:**
- app `werbung-sol.test.ts` (+7) und `relay-zahlziel.test.ts` (+1);
- protocol `werber-sol.test.ts` (+2);
- node `werber-sol.test.ts` (+1);
- drei Verdrahtungs-Regexe an die neue Link-Zeile angepasst.

**Verdrahtet:**
- `shell/tabs/earn.ts` (`updateReferralLink()` → `werbeLink(…, sol)`);
- `main.ts` (`buildCapabilities({ werberSol })`);
- `shell/ki-zahlung.ts` (`empfaengerFuer()` → `kanalEmpfaenger()`).

Knoten-Stand: für `werber_sol` im Angebot `main` ab diesem PR (optional; ohne
Variable ändert sich nichts).

**Prüfungen:**
- protocol 1190 grün (6 übersprungen; vorher 1188), node 314 grün (vorher 313), app 850 grün (vorher 842);
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0, innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.

## Schritt E8 – Zahlkanal aufstocken und Warnung, bevor er leer ist

Entscheidung 04.10.2026 (E8: Zahlkanal mit Aufstocken und Warnung). Der
Zahlkanal trägt lange Sitzungen (Agentic Coding) nur, wenn er sich auffüllen
lässt und rechtzeitig warnt. Bisher brach die Sitzung ab, sobald die Einlage
aufgebraucht war.

**Was:**
- **Aufstocken** (`shell/zahlkanal-ui.ts`, `stockeKanalAuf()`):
  - Knopf je Kanal, solange er noch mindestens `KANAL_NUTZBAR_SEK` läuft.
  - Geht nur mit der Wallet, die den Kanal eröffnet hat; der Betrag wird im
    Dialog in SOL eingegeben, gezahlt erst nach der Rückfrage.
  - Ablauf: `top_up` über `sendeMitWallet()`, die Einlage wächst erst nach
    der Bestätigung auf der Kette (`KanalBuch.aufgestockt()`).
- **Warnung** (`zahlkanal.ts`, `ki-zahlung.ts`):
  - Eine Gutschrift meldet `knapp`, wenn der Rest danach weniger als drei
    weitere Anfragen derselben Größe deckt (`KANAL_KNAPP_ANFRAGEN`).
  - Die App sagt es einmal je Kanal und Sitzung.
  - Der Hinweis beim erschöpften Kanal nennt das Aufstocken.
- **`docs/ZAHLKANAL.md`:** Aufstocken in der App.
- **`scripts/wiring-ausnahmen.txt`:** veraltete Ausnahme
  `channel.ts|stockeKanalAufIx` entfernt, jetzt verdrahtet.

**Tests:** `zahlkanal.test.ts` (+2): knapp und Aufstocken.

**Verdrahtet:**
- `shell/zahlkanal-ui.ts` (Knopf „Aufstocken“ → `stockeKanalAufIx()`);
- `shell/ki-zahlung.ts` (`kanalGutschrift()` → Hinweis `zahl.kanalKnapp`).

**Offen:** Die Hinterlegung für KI-Anfragen fällt erst nach dem
Devnet-Deploy weg – bis dahin ist sie der Weg ohne Kanal.

Knoten-Stand: unverändert. Der Knoten liest die Einlage neu, wenn eine
Gutschrift über der alten liegt (4.3c).

**Prüfungen:**
- protocol 1190 grün (6 übersprungen), node 314 grün, app 852 grün (vorher 850);
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0 (158 Ausnahmen, eine veraltete weniger), innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.

## Schritt P1a – Freedom-Prüfung: Stufen, Prüffragen, eigene Messung, Auswahl

Entscheidung E7 vom 04.10.2026: Provider werden automatisch geprüft, nach dem
Vorbild von OpenRouter (Entwurf `docs/FREEDOM-PRUEFUNG.md`). P1a bringt die
Bausteine ohne DOM und ohne Netz. Verdrahtet werden sie in P2a (App) und P3
(Prüfer im Knoten).

**Was** (`packages/protocol/src/pruefung.ts`):
- **Stufen** (`stufeAus()`, `PRUEF_GRENZEN`):
  - ab 95 % Erfolg normal, ab 80 % herabgestuft, darunter ausgefallen;
  - erst ab genug Anfragen (eigene 20, Prüfer 50) – davor „neu“.
- **Prüffragen** (`neuePruefFrage()`, `pruefeAntwort()`):
  - Arten: Rechnen, Umkehren, Zählen, Sortieren, JSON;
  - aus Vorlagen mit Zufall; die Antwort prüft Code, kein Sprachmodell;
  - großzügig bei der Hülle (Codeblock, Leerzeichen, Tausender-Trennzeichen),
    streng beim Inhalt.
- **Eigene Messung** (`merkeMesspunkt()`, `fasseMessungZusammen()`): die
  letzten 100 Punkte, Median der Zeit, Ausfall in den letzten 60 Sekunden.
- **Auswahl** (`ordneNachPruefung()`), in dieser Reihenfolge:
  - normale;
  - Neue, bekannte (mit Quittungen) vor unbekannten;
  - Ausreißer bei der Qualität;
  - Herabgestufte;
  - gerade ausgefallene;
  - ausgefallene.
  - In den ersten drei Gruppen zufällig, gewichtet mit 1/Preis² mal
    (1 + Vertrauen/100); dahinter fest nach Vertrauen und Preis.
- **`docs/FREEDOM-PRUEFUNG.md`:** P1 in P1a und P1b geteilt (je unter ~400
  Zeilen). Ergänzt: unter den Neuen stehen bekannte vor unbekannten. Ein
  Unbekannter wird erst durch Messung „normal“.
- **`scripts/wiring-ausnahmen.txt`:** sechs Exporte bis P2a/P3.

**Tests:** `pruefung.test.ts` (+6), darunter:
- Stufengrenzen;
- je Art die richtige Antwort besteht, eine fremde nicht;
- Hüllen;
- Fenster und Ausfall;
- Reihenfolge der Gruppen;
- Lastverteilung 4:1 bei halbem Preis, mit Vertrauen 2:1 – mit fester
  Zufallsfolge.

**Verdrahtet:** noch nicht – Bausteinschritt; P2a verdrahtet `ordneNachPruefung()`,
`fasseMessungZusammen()`, `merkeMesspunkt()`, `stufeAus()`.

**Prüfungen** (nach dem Einmergen von `main` mit B-13e und B-21):
- protocol 1166 grün (6 übersprungen; 1160 nach B-21 + 6), node 314, app 855;
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0, innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt B-13e – Anrufe sofort: Abo für Anrufe, drei Minuten klingeln

**Warum:** Entscheidung T4 A (04.10.2026). Ein Angebot sah die App erst beim
Abgleich des Posteingangs, also etwa jede Minute, die anrufende Seite klingelte
aber nur 60 s. Viele Anrufe wurden so verpasst.

**Was:**
- `anruf-ablauf.ts`:
  - `KLINGELN_SEK` 60 → 180. Das Angebot gilt 5 min, so kommt auch ein per
    „Wecken“ geöffneter Browser rechtzeitig.
  - `vielleichtAnruf()`: Vorfilter am offenen Umschlag. Durch kommt nur, was
    jetzt erstellt ist und höchstens 5 min Ablauf hat – so sehen die Umschläge
    eines Anrufs aus.
  - Chat-Umschläge sind zurückdatiert (6.4) oder laufen länger. Sie werden im
    Abo nicht entschlüsselt, das spart mit einem Bunker je Nachricht eine
    Anfrage an den Signer.
- `shell/anruf.ts`: `lauscheAufAnrufe()` ersetzt das Abo, das nur während
  eines Anrufs lief.
  - Ein Abo an den eigenen Schlüssel, je Schlüssel eines, solange die App offen
    ist.
  - Gestartet von `wireAnrufe()`. Im Abruftakt wird nur nachgesehen, ob es
    steht – eine eben erzeugte Identität kommt erst nach dem Start.
  - Das Ende eines Anrufs beendet das Abo nicht.
- Datenschutzbericht, Grenze „anruf-vermittler“: „Damit ein Anruf sofort
  klingelt, hält die App, solange sie offen ist, bei ihren Relays eine Abfrage
  nach Umschlägen an dich offen – die Relays sehen also, wann sie läuft.“
  (Deutsch und Englisch.)
- Smoke: Die Relay-Attrappe stellt neue Events an offene Abos zu
  (`ProbeRelay.zustellen()`).
  - Die Prüfung „anruf“ liefert das Angebot nur über das Abo, nicht über den
    Abgleich des Posteingangs.
  - Es klingelt 0,1 s nach dem Zustellen.

**Tests:**
- app +3:
  - drei Minuten Klingeln, kürzer als die Gültigkeit des Angebots;
  - der Vorfilter mit Negativfällen: Chat-Umschlag, verschwindende Nachricht,
    ohne Ablauf, abgelaufen, aus der Zukunft, kein Umschlag;
  - die Verdrahtung: ein Abo, nur 1059 an sich selbst, Vorfilter vor
    `alsAnruf()`, kein Ende mit dem Anruf.
- Der Satz im Bericht ist im Test zu „anruf-vermittler“ festgehalten.

Knoten-Stand: unverändert (B-13a TURN-Zugang, B-13b coturn).

## Schritt B-21 – Überholte Bausteine entfernen

**Warum:** Hinweis von Spur C in der Sammlung: Unverdrahtete Exporte sollen
angebunden oder entfernt werden. Für die überholten Bausteine aus Spur B hat
der MENSCH am 04.10.2026 entschieden: entfernen, samt Tests, auch die
Kurier-Belege aus `mesh.ts`.

**Was:**
- `protocol/src/merge.ts` ist weg: Mengen mit Zeitstempeln je Feld. Die
  gespeicherten Daten tragen keine Zeiten; zusammengeführt wird seit B-5 in
  der App (`zustand-zusammenfuehren.ts`).
- `protocol/src/mesh.ts` ist weg: offene Mesh-Pakete und Zustellbelege mit
  Kurier-Belohnung. Sie waren nie angebunden, und über Mesh geht seit 7.1 nur
  der Umschlag. Die Kinds 38030/38031 sind in `kinds.ts` und PROTOCOL.md als
  „nicht mehr belegt“ geführt und dürfen nicht wiederverwendet werden.
- `decrementTtl` (`mesh-transport.ts`) ist weg. Seit 7.1 reicht der Knoten die
  geprüfte ganze Nachricht weiter (`MeshQueue`, Sprungzahl − 1).
- Der allgemeine Ablauf in `state-backup.ts` ist weg (`expirationTag`,
  `checkExpiry`, `filterExpired`, `expiryWarning`, `EXPIRY_*`,
  `TAG_EXPIRATION`). Ablaufende Nachrichten laufen seit 2.5 über
  `private-dm.ts`.
- 17 Zeilen aus `scripts/wiring-ausnahmen.txt` gestrichen; Kommentare, die
  auf die entfernten Dateien verwiesen, angepasst.

**Tests:** protocol 1190 → 1160. Die 30 Tests der entfernten Bausteine fallen
mit ihnen weg: Zusammenführung 16, Mesh-Belege 4, Sprungzahl 1, Ablauf 9. Die
Testzahl sinkt also begründet – entfernt wurde, was entschieden war. Alle
anderen Prüfungen sind unverändert grün.

Knoten-Stand: unverändert.


## Schritt P1b – Messbericht eines Prüfers (Kind 38081)

Entscheidung E7 vom 04.10.2026, zweiter Teil der Bausteine. Ein Prüfer stellt
Providern synthetische Prüffragen und veröffentlicht je Provider und Modell
einen ersetzbaren Messbericht. Eine Rangliste gibt es nicht: Die Rangfolge
bildet jede App selbst (`ordneNachPruefung()`, P1a). Das neue Kind war mit E7
freigegeben (`docs/FREEDOM-PRUEFUNG.md`, Abschnitt 6).

**Was** (`packages/protocol/src/messbericht.ts`):
- `baueMessbericht()` (unsigniert, der Prüfer signiert).
  - Tags: `d` = `<provider>:<modell>`, `p`, `modell`, `zeitraum`,
    `anfragen` (Anfragen, Erfolge), `median_ms`, `tokens_s` (freiwillig),
    `treffer` (je Prüfart ein Tag), `stufe`.
  - Ablauf nach NIP-40, zwei Stunden (`BERICHT_GUELTIG_SEK`). Inhalt leer:
    keine Prüffragen, keine Antworten, nichts über Kunden.
- `leseMessbericht()` lehnt ab:
  - falsche Signatur und Ablauf;
  - Zahlen, die keine ganzen sind oder nicht zusammenpassen;
  - unbekannte Stufe, eine Prüfart doppelt, ein `d`, das nicht zu `p` und
    `modell` passt.
- Prüfarten, die der Leser nicht kennt (neuere Prüfer), zählen nicht.
- `trefferQuote()` über alle Arten.
- **`docs/PROTOCOL.md`:** Kind 38081 in der Tabelle und §28.
- **`scripts/wiring-ausnahmen.txt`:** drei Exporte bis P2b/P3.

**Tests:** `messbericht.test.ts` (+1, viele Fälle). Geprüft werden:
- Bauen, Signieren und Lesen;
- Fälschung nach dem Signieren;
- Ablauf, mehr Erfolge als Anfragen, falsches `d`, unbekannte Stufe,
  `1e3` als Zahl, negativer Durchsatz;
- mehr richtig als geprüft, eine Art doppelt;
- eine unbekannte Art wird übergangen;
- Unsinn beim Bauen.

**Verdrahtet:** noch nicht – Bausteinschritt; P2b liest Berichte in der App,
P3 baut sie im Knoten.

**Prüfungen:**
- protocol 1167 grün (6 übersprungen; vorher 1166), node 314, app 855;
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0, innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt P2a – Eigene Messung der Provider und Auswahl nach der Prüfung

Entscheidung E7 vom 04.10.2026 (`docs/FREEDOM-PRUEFUNG.md` 3.1, 3.3). Die App
misst die Provider selbst. Ausgewählt wird nach dem Vorbild von OpenRouter:
normale vorn, Neue in der Mitte, gerade Ausgefallene und schwache hinten.
Unter gleich Guten wählt sie zufällig, gewichtet mit 1/Preis². Bisher standen
ungeprüfte Provider immer ganz hinten (Score −1). Das verhinderte, was E7
will: Neue bekommen Verkehr, sobald sie sich bewähren.

**Was:**
- **`packages/app/src/messbuch.ts` (neu):** `MessBuch`.
  - Je Provider die letzten 100 Punkte, höchstens 200 Provider.
  - Streng gelesen, nur im Tresor (`freedom.messungen`).
  - `ergebnisDesLaufs()` wertet einen Lauf mit Failover und Hedging aus:
    - Antwort → Erfolg mit Zeit; kaputtes Ergebnis → Fehler;
    - verpasste Frist ohne spätere Antwort → Fehler;
    - wer noch in der Frist lief, zählt nicht.
- **`shell/messung.ts` (neu):** Buch über `geheim`; `merkeMessung()` – bei
  gesperrtem Tresor fehlt die Messung, sie wird nie offen abgelegt.
- **`shell/tabs/agent-wege.ts`:** `askWithFailover()` merkt Sendezeit und
  verpasste Fristen und schreibt nach der Antwort bzw. wenn alle versagten.
  Ablehnungen (oft Fehler des Nutzers: Gebot, Kanal) und Abbrüche zählen nicht.
- **`shell/tabs/agent.ts`:** `waitForAnswer()` kennzeichnet ein kaputtes
  Ergebnis (`kaputt`).
- **`matchmaking.ts`:**
  - `mitMessung()` hängt die Messung an.
  - `matchProviders()` stellt eigene Provider zuerst, dann gilt
    `ordneNachPruefung()`. Die Stufe kommt aus der eigenen Messung; ohne
    Messung ist ein Provider „neu“, bekannte (mit Quittungen) stehen vor
    unbekannten. Gewichtet wird mit 1/Preis² und dem Ruf.
  - Zufall über `sichererZufall()`, in Tests mit `zufall`.
- **`shell/state.ts`:** `findProviders()` liest die Messung frisch je Auswahl
  (der Angebots-Cache bleibt).
- **`shell/tresor.ts`, `protocol/src/state-backup.ts`:** `freedom.messungen`
  in `GEHEIM_FEST` und `SICHERUNG_NIE`.
- **`CLAUDE.md`:** Regel zur Auswahl und Messung; der Satz „ungeprüfte stehen
  hinten“ ist nachgezogen.
- **`scripts/wiring-ausnahmen.txt`:** vier P1a-Ausnahmen entfallen, jetzt
  verdrahtet.

**Tests:**
- `messbuch.test.ts` (+5): Buch, Grenzen, Lauf, Reihenfolge, Ablage und
  Verdrahtung.
- `quittungen.test.ts`: Die Abnahme aus 5.5b gilt weiter (bezahlt vor
  unbekannt, die Flut ändert nichts). Bei zwei Unbekannten entscheidet jetzt
  das Gewicht 1/Preis² statt des festen Preises; der Test gibt dafür eine
  feste Zufallszahl vor und prüft beide Richtungen.

**Verdrahtet:**
- `shell/tabs/agent-wege.ts` (`askWithFailover()` → `merkeMessung(ergebnisDesLaufs(…))`);
- `shell/state.ts` (`findProviders()` → `mitMessung()` → `matchProviders()` →
  `ordneNachPruefung()`).

**Prüfungen:**
- protocol 1167 grün (6 übersprungen), node 314, app 860 grün (vorher 855);
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0 (vier Ausnahmen weniger), innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.
- Im ersten Lauf war ein Test rot: B-4 erwartet `freedom.kontakte.geprueft`
  am Ende von `GEHEIM_FEST`. Behoben, indem der neue Eintrag davor steht;
  der Test ist unverändert.

Knoten-Stand: unverändert.

## Schritt E10a – Kopfgelder in sats und SOL mit Verweis aufs Issue, kein Topf

Entscheidung E10 B vom 04.10.2026: nur Kopfgelder, die jemand ausdrücklich
zahlt, direkt an den, der die Aufgabe erledigt – kein Topf, keine Runde. A+
kennt keinen Topf, und die Entwicklung bekommt ihre 2,5 % ohnehin
(`ENTWICKLUNG`). E10a bringt das Format, E10b die Zahlung per Klick in der App.

**Was:**
- **`packages/protocol/src/kopfgeld.ts`** (neu, ersetzt `contributor-funding.ts`),
  Kind 38061:
  - Zusage in sats (`amount_msat`), in SOL (`amount_lamports`) oder in beiden.
  - Verweis aufs Issue (`e`, 1621) und aufs Repo (`a`).
  - Stand: offen, vergeben, erledigt, zurückgezogen; `p` nur bei vergeben
    und erledigt, nie der Geldgeber selbst.
- **Bauen und lesen:** `baueKopfgeld()` und `leseKopfgeld()` (streng:
  Signatur, ganze Beträge über 0, `d` passend zur Kennung).
- **`aktuelleKopfgelder()`:** je Geldgeber und Kennung der neueste Stand.
  Bisher galt die Kennung allein, und ein Fremder hätte ein Kopfgeld als
  erledigt melden können.
  - Dazu `kopfgelderZuIssue()` und `offeneKopfgelder()`.
- **Entfernt:** Runden und Zuteilungen aus einem Topf (38059/38060, nie
  veröffentlicht, nie angebunden) samt `suggestAllocations()`. Die Kinds
  stehen in `docs/PROTOCOL.md` als „nicht mehr belegt“.
- **`docs/PROTOCOL.md`:** §29 Kopfgelder.
- **Website (`roadmap.html`):** Phase „Mitentwickler“ sagt jetzt, dass es
  keinen Topf und keine rückwirkenden Runden gibt.
- **`scripts/wiring-ausnahmen.txt`:** neun alte Zeilen raus, fünf neue bis
  E10b.

**Tests:**
- `kopfgeld.test.ts` (+5): Hin und zurück in beiden Währungen; Unsinn beim
  Bauen und Lesen; nur der Geldgeber ändert den Stand; Bezug zum Issue.
- `contributor-funding.test.ts` (−17) fällt mit dem Topf weg.
- protocol damit 1167 → 1155. Begründet, wie mit E10 B entschieden: Der Topf
  ist entfernt; die Tests der Kopfgelder sind neu und strenger.

**Verdrahtet:** noch nicht – Format; E10b zeigt Kopfgelder am Issue und zahlt
per Klick über die Zahlschienen.

**Prüfungen:**
- protocol 1155 grün (6 übersprungen; vorher 1167, begründet oben), node 314, app 860;
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0, innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt E11 – Relay-Zugang verlängern: Erinnerung und ein Klick mit Rückfrage

Entscheidung E11 B vom 04.10.2026: Verlängern per Erinnerung und einem Klick.
Die App zahlt dabei nie von selbst. Ein Abo über den Zahlkanal (E11 A) kommt
erst nach dem Devnet-Deploy, weil Relays dafür Gutschriften annehmen müssten –
ein neues Format.

**Was:**
- **`packages/app/src/relay-kauf.ts`:**
  - `Zugang` merkt die zuletzt genutzte Schiene. Bestätigt der Relay erst über
    „erneut prüfen“, ergibt sie sich aus dem offenen Kauf: nur SOL hat eine
    Signatur.
  - `faelligeVerlaengerungen()`: von drei Tagen vor bis eine Woche nach dem
    Ablauf, der baldigste zuerst.
  - `zuErinnern()`: einmal am Tag je Relay (`freedom.relays.erinnert`, kein
    Geheimnis).
  - `schieneZumVerlaengern()`: dieselbe Schiene wie zuletzt, wenn der Relay
    sie noch anbietet, sonst die angebotene.
- **`shell/tabs/settings.ts`, `index.html`, `texte/settings.ts`:**
  - Neuer Knopf „Verlängern“ in der Karte Relay-Zugang. Er erscheint nur, wenn
    ein Zugang fällig ist, und kauft über denselben Weg wie „kaufen“, also mit
    `bestaetige()` vorher.
  - Der Stand sagt „läuft am … ab“ bzw. „ist am … abgelaufen“.
  - Beim Start erinnert ein Hinweis einmal am Tag, nur aus dem Gemerkten –
    kein Netz und kein Geld.
- **`CLAUDE.md`:** Regel ergänzt.

**Tests:** `relay-verlaengern.test.ts` (+5) prüft:
- Fälligkeit und Grenzen;
- einmal am Tag, nach dem Verlängern nicht mehr;
- Wahl der Schiene;
- Schiene aus dem offenen Kauf;
- Verdrahtung: beim Start kein Netz und kein Kauf; „Verlängern“ ruft
  `kaufe()` mit Rückfrage auf.

**Verdrahtet:** `shell/tabs/settings.ts` (`wireRelayZugang()`, aufgerufen beim
Start aus `wireMeshTab()`): `zuErinnern()` und Knopf `relay-zugang-verlaengern`
→ `leseRelayPreise()` → `schieneZumVerlaengern()` → `kaufe()` →
`kaufeRelayZugang()`.

**Prüfungen:**
- protocol 1155 grün (6 übersprungen), node 314, app 865 grün (vorher 860);
- mls 13, Leak-Tests 72 grün + 1 todo;
- check-wiring `--streng` Exit 0, innerHTML streng Exit 0, Website ok;
- Smoke-Test bestanden (auch „mobil“ und „zugang“ mit dem neuen Knopf, der
  ohne fälligen Zugang verborgen bleibt).

Knoten-Stand: unverändert.

## Schritt E9 – Entwurf: Cluster-Pairing, Gratis-Schwelle, Modelle laden

Entscheidung E9 A vom 04.10.2026: alle drei Bausteine aus A-8 entwerfen
(eigene Vorlage). Gebaut wird erst nach der Freigabe; „Modelle laden“ baut
danach Spur B. Vorlage: `docs/E9-ENTWURF.md`.

**Befunde** (gelten für jede Wahl):
- **B1:** `cluster.ts` nutzt 38026 und 38027. Beide sind belegt: Kurs-Ticker
  und Provider-Angebot. Ein Paar-Ereignis läse jede App als kaputtes Angebot.
- **B2:** Die Bilanz rechnet noch mit 5 % „Protokollfee“, die es seit A+
  nicht mehr gibt.
- **B3:** Die Bilanz ist öffentlich: Wer bei wem mietet, gibt beim Matching
  Vorrang. Das widerspricht „nie eine öffentliche Rangliste“.
- **B4:** Die Gratis-Schwelle (`network-capacity.ts`) setzt niemand durch, und
  sie beruht auf Selbstauskunft.
- **B5:** Gemeint war „gratis“ bei KI, gebaut ist es für Speicher-Uploads.

**Vorschläge:**
- **V1 A:** Ein führender Knoten nach außen; er mietet den Partner und bezahlt
  ihn direkt. A+ ändert sich nicht. Das Angebot (neu 38028) ist öffentlich,
  die Absprache versiegelt, eine Bilanz gibt es nicht.
- **V2 A:** Keine netzweite Schwelle. Provider und Speicherknoten nennen ihre
  eigene im Angebot; `network-capacity.ts` entfällt.
- **V3 A:** Modelle aus der Ollama-Registry, sonst aus dem Blob-Netz.
  Prüfsummen stehen im Manifest 38057; vertraut wird nur dem eigenen Schlüssel
  oder abonnierten Kuratoren (38080 mit Manifest-Verweis). Ein Modell steht
  erst nach `verifyFile()` im Angebot.

Dazu Fragen F1–F6 und eine Aufteilung E9-1 bis E9-5.

**Prüfungen:** nur Doku. Alle Befehle grün und unverändert gegenüber `main`:
protocol 1155, node 314, app 865, mls 13, Leak 72 + 1 todo, check-wiring
Exit 0, innerHTML Exit 0, Website ok, Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt 12.4a – KI zahlt nach der Standard-Schiene

Entscheidung E3 A vom 04.10.2026 („Kanal anbieten, sonst nichts“), Logik
Spur A (E5). Die Standard-Schiene (Währung › Zahlen) galt bisher nur für Zaps
und Trinkgeld; KI zahlte immer per Lightning, auch mit SOL als Vorgabe.

**Was sich ändert:**
- Neu `packages/app/src/ki-zahlweg.ts`: `kiZahlweg()` – ein offener Kanal
  zahlt immer (wie seit 4.3d), sonst Lightning per Rechnung; mit SOL ohne
  Kanal „kanal-noetig“. `kiZiele()` lässt mit SOL nur Provider mit Kanal übrig,
  die Reihenfolge bleibt.
- `shell/ki-zahlung.ts`: `pruefeKiZahlweg()` und `zieleNachSchiene()` lesen
  Kanalbuch und Standard-Schiene; ohne Kanal der Fehler `zahl.kanalNoetig`
  (Kanal öffnen oder Lightning wählen) – nichts geht hinaus, nie still
  Lightning.
- Verdrahtet: `buildJobEvent()` prüft vor der Gutschrift
  (`shell/tabs/agent.ts:277`, nicht für den eigenen Knoten und nicht gratis);
  Failover nimmt nur erlaubte Ziele (`shell/tabs/agent-wege.ts:48`), ebenso Max
  (`agent-wege.ts:189`). Swarm scheitert über `buildJobEvent()` vor dem Senden.
- Text der Einstellung nennt jetzt auch KI (`set.schieneText`, de/en, auch im
  HTML).
- Unverändert: KI über Funk (braucht schon einen Kanal), „Mein Knoten“
  (gratis), KI auf diesem Gerät (keine Zahlung).

Offen in 12.4: das Gebot in der gewählten Einheit (12.4b) zusammen mit dem
Schalter „sats / SOL“ auf der Agent-Seite (Spur C); „Kanal anbieten“ als Knopf
im Fehler ebenso Oberfläche.

**Prüfungen:** app 868 grün (+3: `ki-zahlweg.test.ts` – Regeln, Ziele,
Verdrahtung), protocol 1155, node 314, mls 13, Leak 72 + 1 todo, Build,
check-wiring Exit 0, innerHTML Exit 0, Website ok, Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt P2b1 – Berichte gewählter Prüfer in der Auswahl

Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md` 3.3). P2b ist geteilt: P2b1
(dieser Schritt) rechnet die Messberichte gewählter Prüfer in die Auswahl ein,
P2b2 bringt die Wahl der Prüfer und die Anzeige auf der Seite Netz.

**Was sich ändert:**
- Protokoll `messbericht.ts`:
  - `FREEDOM_PRUEFER`: der Standard-Prüfer, leer bis MENSCH (wie
    `TRUSTED_SIGNERS`).
  - `messberichtFilter()`: alle Berichte holen, nie nach Prüfer filtern – ein
    Filter verriete den Relays, wem die App folgt (wie bei den Katalogen, 5.7).
  - `pruefStaende()`: je Provider der Stand aus den Berichten der gewählten
    Prüfer – je Prüfer, Provider und Modell der neueste gültige, Zahlen
    summiert, die Stufe aus den Zahlen neu gerechnet (nicht aus dem Bericht).
- Protokoll `pruefung.ts`: `stufeFuerAuswahl()` – die eigene Messung ab 20
  Anfragen geht vor, sonst die Prüfer ab 50 Prüffragen, sonst „neu“.
- App:
  - `pruefer-wahl.ts`: `gewaehltePruefer()` – Standard plus eigene Wahl
    (`freedom.pruefer`), höchstens zehn.
  - `matchmaking.ts`: `mitPruefung()`; `matchProviders()` nimmt Stufe und
    Qualität (Ausreißer nach hinten) aus den Berichten.
  - `shell/state.ts`: `findProviders()` holt die Berichte nur, wenn jemand
    gewählt ist, 5 Minuten Cache.
- Datenschutzbericht: neue Aussage „pruefung“ (belegt, Regel
  `kein-klartext`, Szenario in `privacy-facts.test.ts`). Sie sagt: Die
  Messung bleibt auf dem Gerät, Berichte werden ohne Filter geholt.
- `scripts/wiring-ausnahmen.txt`: `leseMessbericht` und `trefferQuote` sind
  jetzt verdrahtet, ihre Zeilen fallen weg.

**Verdrahtet:** `packages/app/src/shell/state.ts:168` (`findProviders()`),
`packages/app/src/matchmaking.ts:164`.

**Prüfungen:** protocol 1157 grün (+2), node 314, app 871 grün (+3,
`pruefer-wahl.test.ts`), mls 13, Leak 72 + 1 todo, check-wiring Exit 0,
innerHTML Exit 0, Website ok, Smoke-Test bestanden.

Knoten-Stand: unverändert. Solange `FREEDOM_PRUEFER` leer ist und niemand
einen Prüfer wählt (P2b2), fragt die App keine Berichte ab.

## Schritt P2b2 – Seite Netz › Prüfung, Prüfer wählen

Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md` 4): Nutzer sehen, wie
zuverlässig Provider antworten und woher die Zahl kommt, und wählen, welchen
Prüfern die App folgt.

**Was sich ändert:**
- `pruef-anzeige.ts` (neu, ohne DOM):
  - `pruefZeile()` liefert je Provider Stand, Verfügbarkeit in Prozent,
    Antwortzeit und Quelle (eigene Messung, Prüfer oder noch keine). Die Quelle
    folgt derselben Regel wie die Auswahl (`stufeFuerAuswahl()`).
  - `pruefZeilen()` sortiert nach Stand. Gezeigt wird nur auf dem Gerät; eine
    Rangliste veröffentlicht niemand.
- `pruefer-wahl.ts`: `folgePruefer()`, `entfolgePruefer()`, `eigenePruefer()`
  (höchstens zehn, nur Schlüssel).
- `shell/state.ts`: `providerMitStand()` – die bekannten Provider mit Messung
  und Prüfer-Stand; `findProviders()` nutzt sie.
- Neuer Unterreiter Netz › Prüfung (`shell/tabs/pruefung-ui.ts`, `index.html`):
  - nur DOM mit Text;
  - geladen erst beim Öffnen des Reiters oder auf „aktualisieren“, nie beim
    Start;
  - Prüfer folgen per npub oder Schlüssel (`schluesselAusEingabe()`).
- Sicherung: `freedom.pruefer` in `SICHERUNG_EINTRAEGE`, mit Regel zum
  Zusammenführen (Liste, höchstens zehn).
- Texte `pruef.*` (de/en) in `texte/karte.ts`. Der Smoke-Test „mobil“ misst den
  neuen Reiter, „zugang“ erfasst ihn von selbst.

**Verdrahtet:** `packages/app/src/shell/app.ts:843` (`wirePruefung()`),
`packages/app/src/shell/state.ts:163` (`providerMitStand()`).

**Prüfungen:** protocol 1157, node 314, app 874 grün (+3), mls 13, Leak 72 +
1 todo, check-wiring Exit 0, innerHTML Exit 0, Website ok, Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt P3a – Kern der Prüfer-Rolle im Knoten

Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md` 3.2). P3 ist geteilt:
- P3a (dieser Schritt): der Kern ohne Netz.
- P3b: Verdrahtung in `main.ts` (`PRUEFER=1`), Selbstprüfung, Status-Rolle.
- P3c: Budget für bezahlte Prüffragen. Das entscheidet der MENSCH, denn der
  Knoten zahlt seit 5.1.2 nichts aus. Bis dahin prüft der Prüfer nur Angebote,
  die gerade gratis sind – so steht es im Entwurf („ohne Budget prüft er nur
  Gratis-Angebote“).

**Was sich ändert:** neu `packages/node/src/pruefer-rolle.ts`.
- `PrueferPlan`:
  - nimmt nur Angebote mit `currentlyFree` und nie den eigenen Knoten, je
    Modell ein Ziel, höchstens 200;
  - Grundtest: 20 Prüffragen gleichmäßig in der ersten Stunde, danach etwa
    alle 5 Minuten ± 1 Minute;
  - was nicht mehr gratis angeboten wird, fällt weg.
- `bauePruefAuftrag()`:
  - die Prüffrage als versiegelte Anfrage (`buildPrivateJobRequest()`);
  - je Frage ein neuer Wegwerf-Schlüssel, Gebot 0, nur das Modell als
    Parameter, wie eine Gratis-Anfrage der App.
- `werteAntwortAus()`:
  - ein Ergebnis zählt als Erfolg und wird mit `pruefeAntwort()` geprüft;
  - eine Fehlermeldung oder keine Antwort bis zur Frist zählt als Ausfall;
  - ein Zwischenstand zählt noch nicht.
- `PrueferBuch`:
  - nur Zahlen im Speicher;
  - der Bericht für `baueMessbericht()` über die letzten 24 Stunden, die
    Stufe aus den Zahlen.
- `scripts/wiring-ausnahmen.txt`: Die Ausnahme für `pruefeAntwort` fällt weg,
  die Funktion ist jetzt im Knoten genutzt.

**Verdrahtet:** noch nicht. Der Kern ist ein Baustein für P3b, wie P1a und P1b
für P2.

**Prüfungen:** protocol 1157, node 319 grün (+5, `pruefer-rolle.test.ts`),
app 874, mls 13, Leak 72 + 1 todo, check-wiring Exit 0, innerHTML Exit 0,
Website ok, Smoke-Test bestanden.

Knoten-Stand: unverändert (die Rolle ist noch nicht eingeschaltet).

## Schritt P3b – Prüfer-Rolle im Netz (`PRUEFER=1`)

Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md` 3.2). P3a brachte den Kern ohne
Netz, dieser Schritt verdrahtet ihn im Knoten. Bezahlte Prüffragen bleiben bei
P3c (Budget, MENSCH).

**Was sich ändert:** neu `packages/node/src/pruefer-dienst.ts`.
- `PrueferDienst`, je Runde (5 s):
  - Angebote (38027) höchstens alle 15 min lesen – je Provider das neueste,
    nur frische (24 h), Rechenarbeit höchstens 16 Bit (sie läuft im Prozess),
    nie der eigene Knoten; antwortet kein Relay, bleibt der Plan;
  - Antworten abholen, nur aus Umschlägen an die Sitzungsschlüssel offener
    Fragen: Sie zählen nur vom gefragten Provider zur eigenen Anfrage. Keine
    Antwort bis zur Frist (120 s) ist ein Ausfall, aber nur, wenn ein Relay
    geantwortet hat;
  - fällige Prüffragen senden – Art zufällig (`sichererZufall()`), höchstens 5
    je Runde und 50 unterwegs; was kein Relay annimmt, zählt nicht;
  - Berichte (38081) alle 30 min, signiert mit dem Schlüssel des Knotens.
- `prueferAusUmgebung()`: der Satz fürs Log; `PRUEFER_BUDGET_MSAT` gilt als
  „noch nicht genutzt“.
- Status-Rolle `pruefer` (`STATUS_ROLLEN`, App `ROLLEN_TEXT`, Text
  `set.rollePruefer`). Ältere Apps übergehen unbekannte Rollen (seit B-13a).
- Die Selbstprüfung bekommt keinen Befund: Eine dritte Schiene ließe
  `leseBefund()` älterer Apps den ganzen Status abweisen.
- `scripts/wiring-ausnahmen.txt`: `baueMessbericht` und `neuePruefFrage` sind
  jetzt im Knoten genutzt, ihre Ausnahmen fallen weg.
- Doku: `docs/PROVIDER.md` (Abschnitt Prüfer), `docker-compose.yml`
  (`PRUEFER`), `docs/PROTOCOL.md` (Rollen), Entwurf (Schritt P3b, zwei Grenzen).

**Verdrahtet:** `packages/node/src/main.ts` – mit `PRUEFER=1`
`new PrueferDienst({ netz: pool, schluessel: keypair })` im Takt
`PRUEFER_NETZ.rundeMs`, dann `statusRollen.add("pruefer")`.

**Prüfungen:** protocol 1157, node 324 grün (+5, `pruefer-dienst.test.ts`, Ende
zu Ende mit einem echten `DvmProvider`), app 874, mls 13, Leak 72 + 1 todo,
check-wiring Exit 0, innerHTML Exit 0, Website ok, Smoke-Test bestanden.

Knoten-Stand: nur nötig, wer prüfen will (`PRUEFER=1`); ohne den Schalter
ändert sich nichts.

## Schritt P4 – Probezeit und Prüfer, FAQ, MENSCH-Checkliste

Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md`), letzter Schritt vor P3c
(Budget, MENSCH).

**Was sich ändert:**
- `PrueferBuch.bericht()` (`node/src/pruefer-rolle.ts`): Der Zeitraum endet mit
  der letzten Prüffrage, nicht mit „jetzt“. Endet das Gratis-Angebot, fällt das
  Ziel aus dem Plan, der Bericht geht aber bis zum Ende des Fensters (24 h)
  weiter hinaus – bisher mit einem Zeitraum bis eben.
- `website/faq.html`:
  - „Woran erkennt die App einen guten Provider?“ beschreibt die Auswahl seit
    P2a–P3b: eigene Messung, Prüfer, Reihenfolge, Lastverteilung, Quittungen.
    Bisher stand dort „steht aber hinten“ für Neue.
  - „Wie werde ich Provider?“ nennt Probezeit, Grundtest und `PRUEFER=1`.
  - Neu unter „Grenzen“: „Kann ein Provider Prüffragen erkennen …?“
- `scripts/check-website.py`: „steht aber hinten“ in `UNGEDECKT` –
  gegengetestet, die alte FAQ endet mit 1.
- `docs/FREEDOM-PRUEFUNG.md`: 3.4 (wie Probezeit, Gratis-Kontingent, Grundtest,
  die Schwelle 50 und das Fenster ineinandergreifen), Schritt P4, Abschnitt 8
  MENSCH-Checkliste.

**Im Code nachgesehen:** `isCurrentlyFree()` gilt auch nach der Probezeit,
solange der Knoten ein Gratis-Kontingent anbietet (Standard an). Ohne Budget
prüft ein Prüfer also die meisten Provider weiter. 50 Prüffragen sind nach
etwa dreieinhalb Stunden erreicht.

**Verdrahtet:** `bericht()` über `PrueferDienst.veroeffentliche()`
(`pruefer-dienst.ts`, seit P3b mit `PRUEFER=1` in `main.ts`); die FAQ prüft
`check-website.py` in CI und `pages.yml`.

**Prüfungen:** protocol 1157, node 324 (eine Zusicherung mehr in
`pruefer-rolle.test.ts`), app 874, mls 13, Leak 72 + 1 todo, check-wiring
Exit 0, innerHTML Exit 0, Website ok, Smoke-Test bestanden.

Knoten-Stand: nur für Prüfer-Knoten (Zeitraum der Berichte); für Provider
unverändert.

## Schritt 12.1 – Anzeigeeinheit und Standard-Schiene in allen Bereichen (Logik)

Phase 12 (Sammlung A-1), E5: Logik Spur A, Oberfläche Spur C. Zaps,
Trinkgeld (4.1c) und KI (12.4a) folgten der Standard-Schiene schon; offen
waren die Anzeige und Zahlungsanforderungen mit beiden Einheiten.

**Was sich ändert:**
- `anzeigeEinheit()` (`app/src/standard-schiene.ts`, `freedom.anzeigeEinheit`):
  eigene Wahl, sonst SOL bei SOL als Standard-Schiene, sonst jeder Betrag in
  seiner Einheit wie bisher – auch ohne `localStorage`.
- `ausMsat()`/`ausLamports()` (`preis-anzeige.ts`): die gewählte Einheit
  zuerst, Umgerechnetes mit „≈“, der genaue Betrag in Klammern dabei
  („≈ 0,00014 SOL (21 sats)“); ohne Kurs keine erfundene Zahl.
- Zahlungsanforderung mit beiden Einheiten: Vorauswahl nach der
  Standard-Schiene statt immer Lightning (`shell/anforderung-ui.ts`).
- `freedom.anzeigeEinheit` in `SICHERUNG_EINTRAEGE` (ein Wert, keine Regel).

**Verdrahtet:** jede Preisanzeige über `ausMsat()`/`ausLamports()`
(Modellwahl, Schätzung, Anteile, Netz-Tabelle, Werkzeugpreise, Knotenstatus,
Wallet-Guthaben, Trinkgeld, Anforderung). Die Auswahl der Anzeigeeinheit in
den Settings baut Spur C.

**Prüfungen:** protocol 1157, node 324, app 875 grün (+1, `preis-anzeige.test.ts`),
mls 13, Leak 72 + 1 todo, check-wiring Exit 0, innerHTML Exit 0, Website ok,
Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt P5a – Rückbau der Prüfer-Rolle (Entscheidung 05.10.2026)

Freedom-Prüfung (E7). Am 05.10.2026 hat der MENSCH P3c entschieden:
- **Keine Prüfer.** Stattdessen Pflicht-Prüfrunden: Die echte Anfrage geht
  an drei Provider statt an einen, ohne Schalter. Gewünscht war etwa jede 40.
  Zahlung; 0,5 % Budget reichen aber nur für etwa jede 400. (zwei weitere
  Antworten ≈ zwei Zahlungen) – Rückfrage offen.
  Ausgenommen sind nur Gerät, eigener Knoten und Funk.
- **Budget:** 0,5 % jeder Zahlung aus dem Anteil der Entwicklung
  (2,5 % → 2,0 %).
- **Beide Währungen**, je nachdem, womit der Nutzer zahlt.

Dazu kam eine Frage zum Datenschutz gegenüber Providern (D1 in `SAMMLUNG.md`).
Ein echtes TEE gibt es auf DGX Spark/GB10, Macs und Gaming-PCs nicht. Geplant
sind deshalb:
- zuerst Stufe 1 in der App (Platzhalter für persönliche Daten, Schlüssel je
  Unterhaltung);
- danach ein Entwurf „Versiegelter Provider-Modus“ (gemessener Start mit TPM).

**Was sich ändert:**
- **Entfernt:**
  - Prüfer-Rolle im Knoten (`pruefer-rolle.ts`, `pruefer-dienst.ts`,
    `PRUEFER`);
  - Messbericht 38081 (`messbericht.ts`, `FREEDOM_PRUEFER`);
  - Prüffragen und `stufeFuerAuswahl()` (`pruefung.ts`);
  - Prüfern folgen (`pruefer-wahl.ts`, `freedom.pruefer` samt Sicherung und
    Regel);
  - Status-Rolle `pruefer`.
- **Auswahl** und Netz › Prüfung nur aus der eigenen Messung.
- **Datenschutz-Aussage** „pruefung“ ohne Prüfer.
- **Website:** FAQ ohne Prüfer, Whitepaper nennt Prüfrunden als „im Aufbau“;
  `check-website.py` weist Aussagen über Prüfer ab.
- **Doku:** `FREEDOM-PRUEFUNG.md` neu nach der Entscheidung (P5a–P5d),
  `PROTOCOL.md` §28 „nicht mehr belegt“, `PROVIDER.md`.

**Verdrahtet:** `providerMitStand()` → `mitMessung()` → `matchProviders()`
(`stufe: p.messung?.stufe ?? "neu"`); `zeigePruefung()` → `pruefZeilen()`.

**Prüfungen:**
- protocol 1152 (−5) und node 314 (−10), weil die Karte Funktionen entfernt.
- app 872 (−6 Prüfer-Wahl, +3 `pruef-anzeige.test.ts`).
- mls 13, Leak 72 + 1 todo.
- check-wiring Exit 0, innerHTML Exit 0, Website ok (Gegentest mit alter FAQ:
  Exit 1).
- Smoke-Test bestanden.

Knoten-Stand: unverändert. Wer `PRUEFER=1` gesetzt hatte, entfernt den
Schalter.

## Schritt P5b – Aufteilung: Entwicklung 2,0 %, Prüfbudget 0,5 %

Entscheidung des MENSCHEN vom 05.10.2026 (P3c), Häufigkeit vom 06.10.2026:
„Jede 400. Antwort reicht. Antwort, nicht Zahlung.“ Die Entwicklung gibt
0,5 % ab. Daraus wird der neue Anteil `pruefung`: Er hat keinen Empfänger, die
App des Kunden behält ihn als Prüfbudget für die Prüfrunden (P5c, P5d).
Provider behalten 94 %.

**Was sich ändert:**
- **`aufteilung.ts`:**
  - `ANTEILE_PPM` jetzt mit Entwicklung 20.000 und Prüfung 5.000 ppm.
  - `AUFTEILUNG_FASSUNG = 2`.
  - `teileAuf()` liefert `pruefbudgetMsat`.
  - `zahlbareAnteile()` nennt Entwicklung und Prüfbudget nur bei Knoten ab
    Fassung 2.
  - `kanalEmpfaenger()` lässt das Prüfbudget aus, es bleibt bis P5d beim
    Provider.
- **Angebot (38027):** Tag `["aufteilung", "2"]` (`tiers.ts`). Der Knoten setzt
  ihn in `main.ts`.
- **App:**
  - `pruefbudget.ts` (`freedom.pruefbudget`, nur über `geheim`).
  - `empfaengerFuer()` übernimmt die Fassung aus dem Angebot.
  - `rechneAntwortAb()` verbucht das Budget.
  - Die Antwort zeigt „Prüfbudget – bleibt bei dir“, die Settings den Stand.
- **CI-Invariante, Texte und Doku:** App, Website (Startseite, FAQ,
  Whitepaper), `PROTOCOL.md`, `GEBUEHREN-ENTSCHEIDUNG.md`,
  `FREEDOM-PRUEFUNG.md`, `KONTEN.md`, `CLAUDE.md`. `check-website.py` weist
  „2,5 % Entwicklung“ ab.

**Verdrahtet:**
- `empfaengerFuer()` → `deklaration()`, also vor dem Versiegeln (`tabs/agent.ts`).
- `rechneAntwortAb()` → `pruefBudget.verbuche()` in `handleAnswer()`.
- Angebot mit Fassung aus `baueAngebot()` (`node/src/main.ts`).

**Prüfungen:**
- protocol 1155 (+3: Prüfbudget, ältere Knoten, Fassung im Angebot), node 314,
  app 875 (+3: Abrechnung mit Budget, `pruefbudget.test.ts`).
- mls 13, Leak 72 + 1 todo.
- check-wiring, innerHTML und Website ok. Gegentest Website: alte Texte Exit 1.
- CI-Invariante lokal ok.
- Smoke-Test bestanden.

Knoten-Stand: Knoten auf `main` bringen. Erst dann deklariert die App ihnen
Entwicklung und Prüfbudget; bis dahin bleiben beide beim Provider.

## Schritt NIP04-Test – „Dritter kann nicht lesen“ ohne Zufall

In der CI von P5b (#313) war `protocol/test/nwc.test.ts` einmal rot:
„NIP-04: Dritter kann nicht lesen“ meldete „Missing expected exception“.

**Ursache:**
- NIP-04 verschlüsselt mit AES-CBC.
- Mit falschem Schlüssel wirft meist die PKCS#7-Polsterprüfung.
- Liegt das zufällige letzte Byte auf `0x01`, ist das Polster gültig, und es
  kommt Unsinn heraus statt eines Fehlers.
- Lokal gemessen mit 4000 Läufen: 12-mal kein Fehler, nie der Klartext.

**Änderung:**
- Der Test prüft die Eigenschaft selbst: 50 fremde Schlüssel lesen nie den
  Klartext, mindestens einer wirft.
- Neuer Fallstrick in `CLAUDE.md` neben „In Zufallsdaten nie nach kurzen
  Zeichenfolgen suchen“.

**Prüfungen:** protocol 1155 grün (unverändert). Der Test lief 20-mal einzeln,
also mit 1000 falschen Schlüsseln, immer grün.

## Schritt P5c1 – Prüfrunden: Bausteine ohne Netz

Entscheidungen des MENSCHEN vom 05.10.2026 (P3c) und 06.10.2026 („Jede 400.
Antwort reicht. Antwort, nicht Zahlung.“). P5c ist in zwei Schritte geteilt,
weil einer deutlich über 400 Zeilen käme: P5c1 baut die Bausteine ohne Netz,
P5c2 verdrahtet sie mit Lightning.

**Was sich ändert:**
- **`pruefung.ts` (Protokoll):**
  - `Messpunkt.einig` – nur aus Prüfrunden: mit der Mehrheit einig oder
    Ausreißer; ohne Aussage fehlt das Feld.
  - `fasseMessungZusammen()` liefert `qualitaet` (Anteil „einig“) erst ab
    `PRUEF_GRENZEN.minVergleiche` = 3 Vergleichen.
- **`pruefbudget.ts`:**
  - Der Stand hat jetzt einen Zähler: `{ msat, antworten }`. Ein Stand aus
    P5b ohne Zähler beginnt bei 0.
  - `PRUEFRUNDE` = alle 400 Antworten, zwei zusätzliche Provider.
  - `zaehleAntwort()`, `faellig(bedarf)`, `beginneRunde(bedarf)`: Bedarf
    abziehen, Zähler auf 0; nie ins Minus.
- **`pruefrunde.ts` (neu, ohne DOM):**
  - `waehleZusatz()`: nie der gewählte Provider, nie eigene Knoten, keine
    doppelten; gleiches Modell zuerst, sonst zufällig aus `sichererZufall()`.
  - `werteRundeAus()` über `evaluateConsensus()`: Aussage nur bei
    Einstimmigkeit oder Mehrheit; bei Streit, doppelten Absendern oder
    weniger als zwei Antworten keine.
- **`messbuch.ts`:** liest `einig` nur als Wahrheitswert, sonst wird der
  Punkt verworfen.
- **`matchmaking.ts`:** gibt `qualitaet` an `ordneNachPruefung()` weiter –
  Ausreißer stehen hinten.
- **Doku:** `FREEDOM-PRUEFUNG.md` (P5c1/P5c2, Vergleich und Grenze),
  `CLAUDE.md`. `wiring-ausnahmen.txt`: `evaluateConsensus`,
  `normalizeAnswer`, `similarity` sind jetzt verwendet.

**Verdrahtet:**
- `providerMitStand()` → `mitMessung()` → `matchProviders()` reicht
  `qualitaet` an `ordneNachPruefung()` (`matchmaking.ts`).
- `MessBuch.staende()` → `fasseMessungZusammen()` liest `einig`.
- Zähler, Auswahl und Auswertung ruft erst P5c2 aus `askWithFailover()` –
  bis dahin gibt es keine Punkte mit `einig`, `qualitaet` bleibt leer.

**Grenze:** Übereinstimmung heißt nie „richtig“: Provider mit demselben
Basismodell teilen dessen Irrtümer. Der Vergleich über Wort-Ähnlichkeit
(Schwelle 0,6) findet bei offenen Fragen oft keine Mehrheit – dann zählt die
Runde nur für die Verfügbarkeit.

**Prüfungen:**
- protocol 1156 (+1: Qualität erst ab drei Vergleichen, Ausreißer hinten),
  node 314.
- app 880 (+5: Runde fällig und Start, Auswahl der zwei, Auswertung,
  Verdrahtung der Qualität, `einig` im Messbuch).
- mls 13, Leak 72 + 1 todo.
- check-wiring Exit 0, innerHTML Exit 0, Website ok.
- Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt B-17a – OpenTimestamps: Baustein (5.10b, Sammlung B-17)

5.10b war seit 26.09. zurückgestellt: Die Kalender waren aus der Umgebung
nicht erreichbar, und ohne echte `.ots`-Testvektoren ließ sich nicht prüfen,
ob Beweise zu anderen OTS-Werkzeugen passen. Am 04.10. freigegeben, seit
06.10. trägt die Umgebung die Kalender unter „Network access“.

**Was neu ist:** `packages/protocol/src/ots.ts` – ohne neue Abhängigkeit
(Hashes aus `@noble/hashes`):
- `leseOtsDatei()`/`schreibeOtsDatei()` (Detached Timestamp File, Version 1,
  nur SHA-256 – Event-Kennungen sind welche), `leseOtsZeitstempel()`/
  `schreibeOtsZeitstempel()` (Antworten der Kalender).
- Alle Operationen der Referenz (sha256, sha1, ripemd160, keccak256, reverse,
  hexlify, append, prepend), Attestierungen Bitcoin, ausstehend (Kalender-
  Adresse nur mit den Zeichen der Referenz) und unbekannt (bleibt erhalten).
  Reihenfolge beim Schreiben wie die Referenz – Ergebnis byte-gleich.
- Grenzen `OTS_GRENZEN` (4096 je Nachricht und Ergebnis, Tiefe 256, Knoten,
  Größe, Nutzlast, Adresse); Fehler nur als `OtsFehler`-Kennung.
- `buendele()`: viele Werte in einen Stempel wie der ots-Client – je Wert eine
  Zufallszahl, dann ein Merkle-Baum; die Dateien teilen sich die Knoten, was an
  der Spitze ankommt, steht in jeder. `fuegeEin()` übernimmt Antworten ohne
  Doppel. `attestierungenVon()` nennt je Attestierung den Wert, den sie
  bestätigt (bei Bitcoin: die erwartete Merkle-Wurzel des Blocks).

**Testvektoren:** echt, abgeholt am 06.10.: ein Zufallswert an vier Kalender
(alice, bob, a.pool, finney) und die Nachreichung eines alten Stempels bei
alice bis Bitcoin-Block 428648. `scripts/ots-referenz.py` rechnet alles mit
python-opentimestamps 0.4.5 nach und schreibt
`test/fixtures/ots-referenz.json` (dazu ein Bündel mit festen Zufallszahlen
und ein Baum mit allen Operationen). Gegenprobe außerhalb des Repos: die 11
Beispieldateien der Referenz (LGPL, darum nicht eingecheckt) liest `ots.ts`
und schreibt sie byte-gleich zurück, mit denselben Attestierungen.

**Verdrahtet:** noch nicht – Ausnahmen in `wiring-ausnahmen.txt` mit Grund.
Was gestempelt wird, wer stempelt, wo die Beweise liegen und wie „in Bitcoin
verankert“ geprüft wird, entscheidet der MENSCH (K1–K5, Sammlung Abschnitt 5);
danach B-17b.

**Prüfungen:** protocol 1163 grün (+7, `ots.test.ts`), 6 übersprungen; node 313
(7 übersprungen ohne Netz), app 880, mls 13, Leak 72 + 1 todo; Typprüfung
überall, Build, check-wiring Exit 0, innerHTML Exit 0, Website ok.

Knoten-Stand: unverändert.

## Schritt P5c2 – Prüfrunden mit Lightning verdrahtet

Etwa jede 400. Antwort geht die echte Anfrage zusätzlich an zwei andere
Provider (Entscheidungen 05. und 06.10.2026). Der Nutzer sieht nur die Antwort
seines Providers und einen kurzen Hinweis.

**Was sich ändert:**
- **`shell/pruefrunde-lauf.ts` (neu):**
  - `starteRunde()`: fällig nach `PRUEFRUNDE`; Bedarf zwei Höchstbeträge
    (Gebot plus Werkzeuge), vom Budget abgezogen. Zwei Provider aus
    `waehleZusatz()` – nie einer dieses Laufs, nie ein eigener Knoten
    (gekoppelt oder Allowlist), bis P5d keiner mit Zahlkanal. Keine zwei:
    keine Runde, die nächste Antwort versucht es wieder.
  - Die Kopien gehen über `buildJobEvent()` wie jede Anfrage. Die Antworten
    holt die App still ab und bezahlt sie wie jede andere
    (`rechneAntwortAb()`, Sitzung, Quittung).
  - Abschluss: `werteRundeAus()`, Punkte mit `einig` ins Messbuch
    (`mitEinig()`), Rest zurück ins Budget (`rueckgabeMsat()`).
  - `messeLauf()` zählt jede Antwort (nie den eigenen Knoten) und schließt die
    Runde ab; ohne Runde merkt es die Messung wie bisher.
- **`agent-wege.ts`:** `starteRunde()` nach dem ersten Senden, `messeLauf()`
  an allen drei Enden des Laufs. Max und Schwarm bleiben, wie sie sind.
- **`agent.ts`:** `waitForAnswer(…, { still: true })` zeigt keine Zwischenstände.
- **`pruefrunde.ts`:** `mitEinig()`, `rueckgabeMsat()`.
- **Datenschutz:** neue Grenze „pruefrunde“ (Regel `kunde-verborgen`, Szenario:
  drei Anfragen, drei Sitzungen, nichts verbindet sie offen), Texte in beiden
  Sprachen.
- **Website:** FAQ (Aufteilung, „Woran erkennt die App einen guten
  Provider?“) und Whitepaper.
- **Doku:** `FREEDOM-PRUEFUNG.md` (Ablauf), `PROTOCOL.md` §28, `CLAUDE.md`.

**Verdrahtet:**
- `askWithFailover()` (`shell/tabs/agent-wege.ts`) → `starteRunde()` bei
  `i === 0` und `messeLauf()` nach Antwort, Abbruch und Versagen.
- `messeLauf()` → `pruefBudget.zaehleAntwort()` und `abschluss()` bzw.
  `merkeMessung()`.

**Prüfungen:**
- protocol 1157 (+1: Grenze mit Szenario), node 314.
- app 882 (+2: `mitEinig()`/`rueckgabeMsat()`, Verdrahtung). Der Messbuch-Test
  sucht jetzt `messeLauf(runde, ergebnisDesLaufs(` statt `merkeMessung(`.
- mls 13, Leak 72 + 1 todo.
- check-wiring, innerHTML und Website ok.
- Smoke-Test bestanden.

**Beim Einmergen von `main` (B-17a):** Der Smoke-Test „zugang“ war einmal rot –
Kontrast 2,92:1 auf Währung › Tausch. Ursache: Unterreiter blenden sich über
`opacity` ein (`fs-in`, 0,18 s), gemessen wurde nach fester Pause von 300 ms und
mit der Deckkraft der Vorfahren – mitten in der Einblendung (2,92:1 entspricht
38 % Deckkraft). Die Prüfung wartet jetzt, bis keine endliche Animation mehr
läuft (`ANIMATIONEN_FERTIG`); gemessen wird weiter dasselbe, nur im Endzustand.

Knoten-Stand: unverändert. Die zusätzlichen Anfragen sind gewöhnliche
Anfragen.

## Schritt D1a – Platzhalter für persönliche Angaben in KI-Fragen

Datenschutz gegenüber Providern, Stufe 1 (Entscheidung des MENSCHEN vom
05.10.2026, Karte `docs/DATENSCHUTZ-PROVIDER.md` – neu in diesem Schritt). Der
Provider muss die Frage im Klartext rechnen; auf DGX Spark/GB10, Macs und
Gaming-PCs gibt es kein TEE. Die App ersetzt deshalb erkennbare persönliche
Angaben vorher durch Platzhalter.

**Was sich ändert:**
- **Protokoll, `platzhalter.ts` (neu, ohne DOM):** `ersetzeAngaben()` und
  `Zuordnung` (je Unterhaltung stabil: derselbe Wert ergibt denselben
  Platzhalter, `setzeEin()` setzt zurück). Erkannt werden E-Mail, Telefon
  (nicht mitten in einer Zifferngruppe), IBAN mit Prüfziffer, Karte mit Luhn,
  IPv4/IPv6, `npub`/`nsec`/`nprofile`, Lightning-Rechnungen und Namen aus dem
  Adressbuch (ab drei Zeichen, ganze Wörter). Kein Raten.
- **App, `shell/ki-platzhalter.ts` (neu):** `maskiere()`, `entmaskiere()`,
  `neueZuordnung()`, Zahl der ersetzten Stellen je Anfrage; Namen aus den
  Unterhaltungen und dem eigenen Profil. Gespeichert wird nur der Schalter
  `freedom.platzhalter` (Standard an).
- **Verdrahtet:** `buildJobEvent()` ersetzt Frage samt Verlauf und den
  Dateinamen eines Anhangs (nie beim eigenen Knoten); `sendeKiUeberFunk()`
  ebenso; `handleAnswer()` setzt zurück und zeigt unter der Antwort nur die
  Zahl; `neueAufgabe()`/`oeffneVerlauf()` beginnen eine neue Zuordnung.
- **Settings › Datenschutz:** Haken „Persönliche Angaben in KI-Fragen durch
  Platzhalter ersetzen“ mit Text, was erkannt wird und was nicht.
- **Datenschutz:** Grenze „ki-platzhalter“ (Regel `kein-klartext-prompt`),
  Szenario: der Provider öffnet den Umschlag und liest keine der Angaben.
- **Website:** Whitepaper (Abschnitt DVM) sagt, was der Provider liest und was
  die Platzhalter tun.
- **Sammlung:** offene Entscheidung P5d (Prüfrunden mit SOL).

**Prüfungen:**
- protocol 1169 (+5: Platzhalter 4, Grenze mit Szenario 1), node 314.
- app 886 (+4: Verdrahtung). `ki-kontext.test.ts` prüft die Zeile mit dem
  Verlauf jetzt in der Form mit Platzhaltern (`roh` → `maske` → `fullPrompt`).
- mls 13, Leak 72 + 1 todo.
- check-wiring, innerHTML und Website ok.
- Smoke-Test bestanden.

Knoten-Stand: unverändert. Der Provider bekommt nur anderen Text.

## Schritt D1c – Weniger Verlauf zu KI-Fragen

Datenschutz gegenüber Providern, Stufe 1 (Karte `docs/DATENSCHUTZ-PROVIDER.md`).
Der Knoten merkt sich nichts (3.3), die App schickt den Verlauf mit – und was
mitgeht, liest der Provider. D1b (Schlüssel je Unterhaltung) braucht vorher das
Begleichen offener Sitzungsbeträge und folgt danach.

**Was sich ändert:**
- **`ki-kontext.ts`:** `VERLAUF_UMFANG` mit drei Stufen – aus (nur die Frage),
  kurz (6 Nachrichten, 3 000 Zeichen, je Nachricht 1 000; neuer Standard),
  lang (12, 6 000, 1 500; der Umfang bis D1c). `kontextPraefix(msgs, umfang)`,
  `leseUmfang()` (Unbekanntes heißt kurz), `LS_VERLAUF` = `freedom.verlauf`.
- **`agent.ts`:** der Kontext mit dem gewählten Umfang.
- **Settings › Datenschutz:** Auswahl „Verlauf zu KI-Fragen mitschicken“ mit
  Text, was das kostet (Rückfragen werden schlechter verstanden).
- **Datenschutz:** Grenze „ki-verlauf“ – ohne Event-Regel wie „werbe-name“:
  Was der Provider nach dem Öffnen liest, sieht kein Mitschnitt; den Umfang
  prüft `ki-kontext.test.ts`.
- **Whitepaper:** ein Satz zum Verlauf.

**Verdrahtet:** `maybeInsertModelSwitchSummary()` (`shell/tabs/agent.ts`) →
`kontextPraefix(msgs, leseUmfang(localStorage.getItem(LS_VERLAUF)))`; die
Auswahl in `shell/tabs/mesh.ts` (`#ki-verlauf`).

**Prüfungen:**
- protocol 1170 grün, 6 übersprungen, 0 rot (vorher 1169);
- node 314 grün, 6 übersprungen;
- app 887 grün (vorher 886), Build ok;
- Leak 72 grün + 1 todo; mls 13 grün;
- check-wiring `--streng` Exit 0, check-website 5 Seiten ok, check_innerhtml Exit 0;
- Smoke-Test bestanden.

Knoten-Stand: unverändert. Der Provider bekommt nur weniger Text.

## Schritt 12.6 – Profil: SOL-Adresse öffentlich nur mit Häkchen

**Warum:** Phase 12 „Beide Währungen überall“ (Sammlung A-1, Anhang A: „Profil:
öffentliche Adresse – ✓ mit Häkchen für Lightning, ✗ kein SOL-Feld“); nach E5
(04.10.2026) baut Spur C die Oberfläche.

**Was:**
- Profil: Feld „SOL-Adresse“, Knopf „frische Adresse der eingebauten Wallet“
  (aus dem Vorrat über `frischeEmpfangsadresse()`, nie die Hauptadresse – wie
  der Werbelink nach E1 A; ohne eingebaute Wallet, mit Bunker oder leerem
  Vorrat ein Hinweis) und Häkchen „SOL-Adresse öffentlich zeigen“.
- `profil-sol.ts` (neu): `freedom.profil.solOeffentlich`, Standard aus – vorher
  gab es kein Feld, also nichts zu übernehmen. Gesichert wie das
  Lightning-Häkchen (`SICHERUNG_EINTRAEGE`).
- Einschalten erst nach einer Warnung (`bestaetige()`, Gefahr): die ganze
  Geschichte der Adresse auf der Kette, bleibt auf den Relays, für Trinkgeld
  unnötig (Kontakte fragen versiegelt, 4.9d), wenn doch, dann eine frische.
  Abgebrochen bleibt das Häkchen aus.
- `oeffentlichesProfil(meta, { lightning, sol })` (Protokoll): ohne
  `sol: true` gehen weder `sol` noch `chains` hinaus; die Reihenfolge der
  Felder bleibt. Eine ungültige Adresse wird nicht gespeichert.
- Offenlegung (live), Vorschau (◎ Adresse) und Datenschutzbericht folgen dem
  Häkchen. Der Befund „Solana-Adresse im Profil“ (kritisch) las bisher
  `freedom.solAddress` – einen Schlüssel, den nichts schrieb; jetzt Profil und
  Häkchen. Abhilfe-Text nennt das Häkchen. Die Aussage „sol-adresse“ nennt die
  Ausnahme („Einzige Ausnahme: dein Profil, wenn du sie dort ausdrücklich
  einschaltest“).
- Das Feld `sol` ist die bestehende Konvention: Trinkgeld nimmt es nur nach
  Warnung (4.9d), die Relay-Zahlziele lesen es aus dem Profil des Betreibers
  (12.3). Kein neues Format.

**Tests:** protocol +1 (`profile-badges.test.ts`: Häkchen unabhängig,
Reihenfolge, Offenlegung), Szenario „sol-adresse“ prüft zusätzlich das Profil
mit Gegenprobe; app +3 (`profil-sol.test.ts`); Leak +1 (`leak/profil.test.ts`:
ohne Häkchen keine SOL-Adresse, mit Häkchen genau die eingetragene). Smoke
(„einstellungen“): Offenlegung „bleibt auf dem Gerät“, Warnung, Esc lässt aus,
bestätigt an (Vorschau, Offenlegung), frische Adresse ohne Wallet meldet sich,
wieder aus – nichts veröffentlicht.

## Schritt 12.7a – Wallet: Senden

**Warum:** Phase 12 (Sammlung A-1, Anhang A: „Wallet: Senden – Lightning ✗,
SOL ohne Online-Senden“); nach E5 baut Spur C die Oberfläche. 12.7 kommt in
drei Teilen: a Senden, b Empfangen, c Verlauf.

**Was:**
- Knopf „Senden“ über den Karten in Währung › Übersicht
  (`shell/senden-ui.ts`, `wireSenden()` in `app.ts`).
- `senden.ts` (ohne DOM): `leseSendeZiel()` erkennt eine Rechnung (auch mit
  `lightning:`), eine Lightning-Adresse, eine Solana-Adresse und `solana:`
  nach Solana Pay (`amount`, `reference`; Token mit `spl-token` nicht). Daraus
  folgt die Schiene – nie die andere. Eine Rechnung ohne Betrag nimmt die App
  nicht. `geltenderBetrag()`: der Betrag des Ziels gilt; ein getippter, der
  ihm widerspricht, wird abgewiesen. `zielAnzeige()`: Adressen ganz (zum
  Vergleichen), Rechnungen gekürzt.
- Bestätigung mit dem Betrag in beiden Einheiten (`ausMsat()`/`ausLamports()`)
  und dem Ziel; bei SOL der Hinweis, dass die Überweisung samt
  Absenderadresse öffentlich auf der Kette steht. Dann
  `zahle(zahlschienen(), … zweck: "senden")` – mit `referenz`, wenn das Ziel
  eine nennt. Die eingebaute SOL-Wallet fragt über dem Tageslimit wie immer.
- Neuer `Zweck` „senden“ im Protokoll (`payment-rail.ts`) – nur zur
  Einordnung, ändert keine Prüfung.
- Ein Fehler oder unklarer Ausgang wird nie von selbst wiederholt; die
  Meldung sagt, erst in der Wallet nachzusehen.

**Tests:** app +7 (`senden.test.ts`: Rechnung mit/ohne Betrag, kaputte
Prüfsumme, Adressen, Solana Pay mit Betrag, Referenz, Token, zwei Referenzen,
kaputte Beträge, Unbekanntes, Beträge ohne Raten, Widerspruch,
Verdrahtung – erst bestätigen, dann ein Weg zum Geld). Smoke „waehrung“:
Prüfungen im Dialog, Bestätigung mit ganzer Adresse, ohne Wallet ehrlich
gescheitert („Keine Solana-Wallet verbunden“), nichts veröffentlicht.

## Schritt D1b1 – Abrechnung und Reklamation mit dem Schlüssel des Auftrags

Datenschutz gegenüber Providern, Stufe 1 (Karte `docs/DATENSCHUTZ-PROVIDER.md`).
D1b (neuer Schlüssel je Unterhaltung) ist wegen des Umfangs geteilt. D1b1
bereitet den Wechsel vor: Eine Antwort auf einen früheren Auftrag darf dem
Provider nie den neuen Schlüssel nennen, sonst verbände er beide. Ohne Wechsel
ändert sich nichts – es gibt je Provider weiter einen Schlüssel. D1b2 bringt den
Wechsel selbst, das Begleichen offener Beträge und die Grenze Zahlkanal.

**Was sich ändert:**
- **`ki-sitzung.ts`:** `merkeAuftrag(requestId, sitzung)`/`fuerAuftrag()` –
  welcher Sitzungsschlüssel welchen Auftrag stellte, nur aus dem eigenen
  Gedächtnis (höchstens `KI_AUFTRAEGE_MAX` = 1000). Den `p`-Tag im Ergebnis
  setzt der Provider selbst, `openPrivateJobResponse()` prüft ihn nicht – darauf
  baut die Zuordnung deshalb nicht. `schluesselHex()` gilt je
  Sitzungsschlüssel statt je Provider.
- **`session-client.ts`:** Sitzungen gehören zum Schlüssel:
  `activeFor(provider, kundePk)`, `jobTags(…, kundePk)`, `openSession(…, signer)`,
  `chargeForResult(…, kunde)` – verbucht und belegt in der Sitzung des
  Schlüssels, der den Auftrag stellte. Ohne Angabe gilt wie bisher der aktuelle.
- **Verdrahtet:** `buildJobEvent()` merkt den Auftrag vor dem Senden und fragt
  die Sitzung dieses Schlüssels; `handleAnswer()` und die Prüfrunden
  (`pruefrunde-lauf.ts`) rechnen mit `kiSitzungen.fuerAuftrag(r.requestId)` ab;
  die Reklamation (`reklamiere()`, `agent-anzeige.ts`) signiert mit dem Schlüssel
  des Auftrags und merkt dessen rohen Schlüssel – ohne ihn „ohne Bezug“.

**Tests:** neu `ki-auftrag-schluessel.test.ts` (3): Schlüssel je Auftrag
(begrenzt, nie geraten, roher Schlüssel je Sitzungsschlüssel), Sitzungen je
Schlüssel (späte Antwort auf einen alten Auftrag verbucht dort, der neue
Schlüssel erfährt den alten nie), Verdrahtung. Gleich streng angepasst:
`leak/reklamation.test.ts`, `leak/mein-knoten.test.ts`, `zahlkanal.test.ts`,
`ki-zahlung.test.ts`, `streitfall.test.ts`; in `session-client.test.ts` zwei
Clients mit festem statt je Aufruf neuem Schlüssel (so arbeitet `KiSitzungen`).

**Prüfungen:**
- protocol 1171 grün, 6 übersprungen, 0 rot (unverändert);
- node 314 grün, 6 übersprungen;
- app 900 grün nach dem Einmergen von main mit 12.7a (vorher 897), Build ok;
- Leak 73 grün + 1 todo; mls 13 grün;
- check-wiring `--streng` Exit 0, check-website 5 Seiten ok, check_innerhtml Exit 0;
- Smoke-Test bestanden.

## Schritt B-17b1 – OpenTimestamps: Kalender und NIP-03 (5.10b, Sammlung B-17)

Entschieden 06.10.2026 (MENSCH): K1–K4 jeweils A – die App stempelt eigene
Mandate und Quittungen, gebündelt im Abruftakt; der Beweis zum Mandat geht als
NIP-03 hinaus, der zur Quittung bleibt im Tresor; „in Bitcoin verankert“ prüft
die App bei Bedarf gegen zwei Explorer. K5 (Kalender) nannte der MENSCH nicht –
angenommen A, im Pull Request erneut gefragt. Zu K2/K4 die Frage „mit Tor egal?“:
ja, mit Tor (Tor Browser) sehen Kalender und Explorer nur den Ausgang; ohne Tor
die IP – der Bericht sagt beides (B-17b3).

**Was neu ist:**
- `ots-kalender.ts`: `OTS_KALENDER` (alice, bob, finney – zwei Betreiber),
  `stempele()` bündelt, schickt nur die Spitze an jeden Kalender und führt die
  Antworten zusammen; eine Antwort zählt nur mit dem Versprechen genau dieses
  Kalenders, unter zwei → `zu-wenige-kalender`. `reicheNach()` fragt
  ausstehende Versprechen nach – nur Kalender der Liste (eine fremde Adresse im
  Beweis wird nie gefragt), höchstens acht je Durchgang, 404 heißt „wartet“,
  mit Bitcoin im Beweis gar nicht mehr. Antworten begrenzt (10.000 Bytes wie
  die Referenz, 15 s), Fehler nur als Kennung.
- **Fund beim Prüfen der Kalender:** Sie erlauben jede Herkunft
  (`Access-Control-Allow-Origin: *`), beantworten aber keinen Preflight
  (OPTIONS → 404/501). Die Anfragen sind darum „einfach“: nur `Accept`, kein
  Content-Type – ein Test hält das fest.
- `ots-nip03.ts`: Kind 1040 nach NIP-03 (`e`, `k`, Base64) – gebaut nur mit
  Bitcoin-Attestierung über `nurBitcoin()` (ein Weg zur niedrigsten Höhe, keine
  Versprechen), gelesen streng (ein `e`, ein `k`, Base64 und Größe, die Datei
  beweist genau diese Kennung). Wer signiert hat, zählt nicht – „verankert“
  erst nach der Prüfung gegen den Blockkopf (B-17b2).

**Testvektoren:** Der Zufallswert aus B-17a, am 06.10. bei alice, bob und
finney gestempelt, ist bei alice noch am selben Tag in Bitcoin-Block 970158
angekommen (bob und finney: 404, „waiting for 6 confirmations“). Die echte
Nachreichung steht in `scripts/ots-referenz.py`; die Referenz rechnet
Stempeln (Bündel mit drei Kalender-Antworten), Nachreichen und den Beweis nur
mit Bitcoin nach – alles byte-gleich.

**Verdrahtet:** noch nicht – Ausnahmen mit Grund (B-17b3). B-17b2 (Blockkopf
von mempool.space und blockstream.info) braucht die Freigabe der beiden Hosts
unter „Network access“ (MENSCH) für einen echten Testvektor zu Block 970158.

**Prüfungen** (nach dem Einmergen von `main` mit P5c2, D1a, D1c, 12.6, 12.7a,
D1b1 und 12.7b): protocol 1176 grün (+5, `ots-kalender.test.ts`), 6 übersprungen;
node 313 (7 übersprungen ohne Netz), app 903, mls 13, Leak 73 + 1 todo;
Typprüfung überall, Build, check-wiring Exit 0, innerHTML Exit 0, Website ok,
Smoke-Test bestanden, build-site ok, reproduzierbar (zweimal dieselbe Summe).

Knoten-Stand: unverändert.

## Schritt 12.7b – Wallet: Empfangen

**Warum:** Phase 12 (Sammlung A-1, Anhang A: „Wallet: Empfangen“); zweiter
Teil von 12.7.

**Was:**
- Knopf „Empfangen“ neben „Senden“ (`shell/empfangen-ui.ts`, `wireEmpfangen()`).
  Dialog: womit (Lightning oder SOL, vorausgewählt nach der Standard-Schiene,
  12.1) und Betrag (für Lightning Pflicht, für SOL frei – leer wählt der
  Zahlende).
- Lightning: Rechnung der eigenen Wallet über NWC (`eigeneRechnung()`,
  Beschreibung leer). Ohne NWC ein Hinweis – die App stellt selbst keine
  Rechnungen aus (E4 A).
- SOL: `eigeneSolAdresse()` (`shell/zahlschienen.ts`, dort, wo Wallet-Zugriffe
  hingehören): aus der eingebauten Wallet eine frische Adresse aus dem Vorrat
  (nie die Hauptadresse, 4.9c); ohne eingebaute die der verbundenen Wallet –
  der Text sagt, dass an ihr alles hängt, was sie je empfing und sendete;
  Vorrat leer → Hinweis „Neue Adressen ableiten“, kein Ausweichen.
- Gezeigt als QR-Code und Text zum Kopieren (Dialogfelder `qr` und
  `nurlesen`). `empfangen.ts` (ohne DOM): `lightning:<rechnung>` bzw.
  `solana:<adresse>?amount=…` nach Solana Pay – „Senden“ (12.7a) liest beides
  zurück. Nichts geht an ein Relay, gemerkt wird nur die vergebene Adresse.

**Tests:** app +3 (`empfangen.test.ts`: Links und Rundweg mit
`leseSendeZiel()`, Reihenfolge frisch vor verbunden ohne Hauptadresse,
Verdrahtung ohne Relay und ohne Speichern). Smoke „waehrung“: ohne Betrag
meldet sich der Dialog, ohne NWC und ohne Solana-Wallet je ein Hinweis.

## Schritt D1b2 – Neuer Sitzungsschlüssel je Unterhaltung

Datenschutz gegenüber Providern, Stufe 1 (Karte `docs/DATENSCHUTZ-PROVIDER.md`),
nach D1b1. Bisher gab es je Provider einen Schlüssel für die ganze Sitzung der
Seite – ein Provider konnte alle Unterhaltungen eines Kunden verbinden. Jetzt
bekommt er für jede Unterhaltung einen neuen.

**Was sich ändert:**
- **`ki-sitzung.ts`:** `neueUnterhaltung()` – neue Schlüssel beim nächsten
  Auftrag, die bisherigen kommen zurück (zum Begleichen) und bleiben
  `ALT_HALTEN_MS` (30 Minuten) für späte Antworten (`mitPubkey()`).
  `pubkeysFuer(ids)` statt `pubkeys()`: Antworten fragt die App nur für die
  Schlüssel der gesuchten Aufträge ab – nie alte und neue in einer Abfrage.
  `aktuell(provider)` ohne anzulegen.
- **`session-client.ts`:** `offeneVon(kundePk)` und `begleiche(provider, kunde,
  wallet)` – offene ganze sats ab 1 sat mit dem alten Schlüssel, sonst wie
  `chargeForResult()` (gemeinsam `zahleFaellig()`: Rechnung zuerst, nie über
  das Budget, unklar nie von selbst, nie zwei Zahlungen zugleich); der Beleg
  (38022) vom selben Schlüssel, ohne neue Antwort (`units` 0, kein `e`).
- **`shell/ki-wechsel.ts` (neu):** `wechsleKiSchluessel()` (Wechsel, dann
  begleichen über `providerZahlung()`, Quittung über `quittungNachBegleichen()`)
  und `begleicheWennVerlassen()` für Antworten, die nach dem Wechsel an einen
  alten Schlüssel kommen.
- **Datenschutz:** Grenze „ki-unterhaltung“ – ohne Event-Regel wie
  „ki-verlauf“ (welcher Schlüssel je Unterhaltung, entscheidet die App; das
  prüft `ki-wechsel.test.ts`). Grund: Zahlkanal (fester Schlüssel), wieder
  geöffneter Verlauf, Zeitpunkte des Begleichens, Relay des Providers (IP ohne Tor).
- **Whitepaper:** ein Satz im Abschnitt DVM.

**Verdrahtet:** `neueAufgabe()` und `oeffneVerlauf()` (bei einer anderen
Unterhaltung, `shell/tabs/agent-verlauf.ts`) → `wechsleKiSchluessel()`;
`handleAnswer()` (`shell/tabs/agent.ts`) und `bezahle()`
(`shell/pruefrunde-lauf.ts`) → `begleicheWennVerlassen()` nach der Quittung;
`privateAntworten()` (`shell/tabs/agent-wege.ts`) → `kiSitzungen.pubkeysFuer(ids)`.

**Tests:** neu `ki-wechsel.test.ts` (3): neue Schlüssel je Unterhaltung, alte nur
bis zur Haltezeit, Abfrage nur je Auftrag; `begleiche()` (ab 1 sat, alter
Schlüssel, Beleg ohne neue Antwort, Rechnung gescheitert → nicht unklar,
unklar → nie von selbst); Verdrahtung. `privacy-facts.test.ts`: Grenze
„ki-unterhaltung“ mit allen vier Gründen, Liste ohne Event-Regel ergänzt.
Gleich streng angepasst: `knoten-weg.test.ts` (`pubkeysFuer(ids)` statt `pubkeys()`).

**Prüfungen:**
- protocol 1177 grün nach dem Einmergen von main mit B-17b1 (vorher 1176), 6 übersprungen, 0 rot;
- node 314 grün, 6 übersprungen;
- app 906 grün nach dem Einmergen von main mit 12.7b (vorher 903), Build ok;
- Leak 73 grün + 1 todo; mls 13 grün;
- check-wiring `--streng` Exit 0, check-website 5 Seiten ok, check_innerhtml Exit 0;
- Smoke-Test bestanden.

Knoten-Stand: unverändert. Der Knoten sieht nur mehr Sitzungsschlüssel.

## Schritt 12.7c – Wallet: Verlauf

**Warum:** Phase 12 (Sammlung A-1, Anhang A: „Wallet: Verlauf – ✗“); dritter
und letzter Teil von 12.7.

**Was:**
- `zahlungsbuch.ts` (ohne DOM): `merkeZahlung()` legt nach jeder Zahlung
  Zeit, Schiene, Zweck, Betrag, Ziel und Beleg (Preimage bzw. Signatur) ab,
  `leseZahlungen()` liest streng (Kaputtes und Fremdes fällt weg), höchstens
  `ZAHLUNGEN_MAX` = 500, neueste zuerst.
- `shell/zahlschienen.ts`: `zahlschienen()` hängt `mitBuch()` an jede Schiene
  – jede Zahlung über `zahle(zahlschienen(), …)` landet im Buch, erst nach dem
  Zahlen. Scheitert das Merken (Tresor gesperrt), gilt die Zahlung trotzdem.
- Gespeichert nur über `geheim` (`freedom.zahlungen`, in `GEHEIM_FEST`) – die
  Liste verrät, wen man wann bezahlt hat; nie in der Sicherung auf Relays
  (`SICHERUNG_NIE`), wohl im eigenen Datenexport (`EXPORT_ZUSAETZLICH`).
- Karte „Verlauf“ in Währung › Übersicht (`shell/verlauf-ui.ts`): das Buch
  beim Öffnen der Seite, ohne Netz. „Verlauf der Lightning-Wallet laden“ auf
  Klick: `lightningVerlauf()` fragt die eigene Wallet über NWC
  (`list_transactions`, NIP-47) – auch Eingänge; die Antwort sind Fremddaten,
  `leseWalletBuchungen()` nimmt nur Richtung, ganze msat, Zeit und eine
  gekürzte Beschreibung, gezeigt nur als Text.
- Der Text sagt, was stimmt: nur auf diesem Gerät, verschlüsselt erst mit
  eingerichtetem Tresor; Tausch, Zahlkanäle und Hinterlegung stehen in ihren
  Bereichen (sie zahlen nicht über `zahle()`).

**Bewusst nicht:** SOL-Eingänge von der Kette – das wären Abfragen je
eigener Adresse beim RPC-Anbieter; das Guthaben steht oben.

**Tests:** app +5 (`zahlungsbuch.test.ts`: merken mit Obergrenze, strenges
Lesen, nie Sicherung/wohl Export/Tresor, Wallet-Verlauf aus Fremddaten,
Verdrahtung – erst zahlen, dann merken, Fehler beim Merken stoppt nichts);
der Export-Test kennt den neuen Eintrag. Smoke „waehrung“: leerer Verlauf,
ohne NWC ein Hinweis.

**Damit ist 12.7 fertig** (a #322, b #324, c). Offen in Phase 12 für Spur C:
12.1 Auswahl der Anzeigeeinheit und 12.4 Schalter (nach 12.4b von Spur A).

## Schritt B-17b2 – OpenTimestamps: Prüfung gegen Bitcoin (5.10b, Sammlung B-17)

K5 entschied der MENSCH am 06.10. mit A (alice, bob, finney); seit demselben Tag
erlaubt die Umgebung mempool.space und blockstream.info.

**Was neu ist:** `ots-bitcoin.ts` (K4 A):
- `leseBlockkopf()` liest 80 Bytes und lässt den Kopf sich selbst prüfen: Hash
  (doppeltes SHA-256) nachgerechnet, Arbeit nach seinem Ziel, Ziel höchstens das
  des Hauptnetzes (Bits 0x1d00ffff) – ein gefälschter Kopf kostet Rechenarbeit.
- `pruefeVerankerung()` fragt je Bitcoin-Höhe im Beweis (aufsteigend, höchstens
  drei) beide Explorer aus `OTS_EXPLORER` (Esplora: Hash zur Höhe, dann der
  Kopf). Der Kopf gilt nur, wenn er zum genannten Hash passt und beide
  denselben liefern; fehlt einer → `nicht-erreichbar`, verschieden → `uneinig`
  (beides: keine Aussage), passt die Wurzel bei keiner Höhe → `falsche-wurzel`.
  Sonst Höhe, Zeit und Hash des Blocks. Anfragen „einfach“ (die Explorer
  erlauben jede Herkunft), ohne Zugangsdaten und Weiterleitung, begrenzt.
- `holeHoechstens()` (aus `ots-kalender.ts`) dient Kalendern und Explorern.

**Testvektoren:** der echte Kopf zu Block 970158 – von beiden Explorern gleich –
und der Genesis-Block, beide mit python-bitcoinlib nachgerechnet;
python-opentimestamps prüft den Beweis von B-17b1 gegen den Kopf
(`verify_against_blockheader`, Zeit 1791281192). **Live-Probe** (außerhalb der
Tests, mit beiden Explorern): der eigene Stempel von heute ist verankert in
Block 970158 (06.10.2026, 10:06:32 UTC), der alte aus B-17a in Block 428648.

**Fallstrick:** Node-`fetch` geht hier nur mit `NODE_USE_ENV_PROXY=1` (und
`NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`) über den Agent-Proxy – sonst
meldet jede Live-Probe „nicht-erreichbar“ (Python und curl nehmen den Proxy von
selbst).

**Verdrahtet:** noch nicht – Ausnahmen mit Grund (B-17b3: Prüfung bei Bedarf,
Schlüsselwechsel und Streit).

**Prüfungen** (nach dem Einmergen von `main` mit D1b2 und 12.7c): protocol 1182
grün (+5, `ots-bitcoin.test.ts`), 6 übersprungen; node 313 (7 übersprungen ohne
Netz), app 911, mls 13, Leak 73 + 1 todo; Typprüfung überall, Build, check-wiring Exit 0,
innerHTML Exit 0, Website ok, Smoke-Test bestanden, build-site ok, reproduzierbar.

Knoten-Stand: unverändert.

## Schritt 12.1 C – Auswahl der Anzeigeeinheit

**Warum:** Spur A hat in 12.1 die Logik gebaut (`anzeigeEinheit()`,
`freedom.anzeigeEinheit`); „die Auswahl baut Spur C“ (E5).

**Was:**
- Währung › Zahlen, im Kasten „Zahlen“ unter der Standard-Schiene: „Beträge
  zuerst zeigen in: automatisch · sats · SOL“ (`#anzeige-einheit`, verdrahtet
  in `tabs/mesh.ts` neben der Standard-Schiene).
- Gemerkt wird nur eine eigene Wahl („sats“ oder „sol“); „automatisch“
  entfernt sie – dann gilt `anzeigeEinheit()` wie bisher. Die Wahl reist mit
  der Sicherung (Eintrag seit 12.1).
- Der Text sagt, was es tut: nur die Anzeige; die andere Einheit mit „≈“ und
  dem Kurs von jetzt, der genaue Betrag immer dabei; ohne Kurs keine
  umgerechnete Zahl.

**Tests:** app +2 (`anzeige-einheit.test.ts`: Optionen und Ort, Sicherung,
Verdrahtung – nur sats/SOL gemerkt, sonst entfernt). Smoke „waehrung“:
Vorbelegung leer, „SOL“, „sats“, zurück zu „automatisch“ entfernt die Wahl.

## Schritt B-17b3a – OpenTimestamps: Die App stempelt Mandate und Quittungen (5.10b, Sammlung B-17)

Entscheidungen K1–K5 A (MENSCH 06.10.2026). Erster Teil der Anbindung; die
Prüfung von Mandaten der Kontakte gegen Bitcoin folgt in B-17b3b.

**Was neu ist:**
- `zeitanker.ts` (ohne DOM): `ZeitankerBuch` (`freedom.zeitanker` in `geheim`,
  höchstens 500, streng gelesen), `quittungsDigest()` (SHA-256 über die Felder
  in fester Reihenfolge, ohne den Stand – der wechselt zu „belegt“) und
  `zeitankerTakt()`: offene Werte bündeln und stempeln (bis 64 je Schlag),
  Beweise ab einer Stunde nachreichen (bis 8 je Schlag; eine Abfrage je Adresse
  über `mitGedaechtnis()`, Beweise eines Bündels teilen sich die Versprechen),
  verankerte Mandate als Kind 1040 veröffentlichen. Fehler warten auf den
  nächsten Schlag.
- `shell/zeitanker-takt.ts`: `ankereMandat()` nach dem Veröffentlichen in
  „Schlüsselwechsel vorbereiten“ (`tabs/sicherung.ts`), `ankereQuittung()`
  nach jedem `quittungsBuch.lege()` (`shell/quittungen.ts`, Lightning und
  Zahlkanal), `zeitankerSchlag()` im Abruftakt (`app.ts`, jeder 20. Schlag,
  etwa alle zehn Minuten) – ohne offene Anker kein Netz; als Gerät kein 1040.
- Der Beweis zur Quittung bleibt auf dem Gerät (K3 A); `freedom.zeitanker` in
  `SICHERUNG_NIE`, im Export neben den Quittungen.
- Datenschutzbericht: Grenze „zeitanker“ (deutsch und englisch) – die Kalender
  sehen IP und Zeitpunkt, nie wofür; mit Tor nur den Ausgang.

**Verdrahtet:** `shell/tabs/sicherung.ts` (`ankereMandat(mandat)` nach
`publish`), `shell/quittungen.ts` (zweimal `ankereQuittung`), `shell/app.ts`
(`abrufTakt.melde("zeitanker", …, 20)`); elf Ausnahmen in
`wiring-ausnahmen.txt` fielen weg, offen bleiben `leseOtsBeweis`,
`leseBlockkopf`, `pruefeVerankerung` (B-17b3b).

**Tests:** `app/test/zeitanker.test.ts` mit den echten Antworten aus der
Referenz – vormerken, stempeln, nach einer Stunde Block 970158 nachreichen,
1040 mit genau dem Weg zu Bitcoin; Quittung nie hinaus, als Gerät kein 1040,
Fehler ohne Verlust, eine Abfrage je Adresse; Verdrahtung im Quelltext.

**Prüfungen:** protocol 1183 grün (+1, Aussage „zeitanker“), 6 übersprungen; node
313 (7 übersprungen ohne Netz), app 919 (+6, `zeitanker.test.ts`), mls 13, Leak
73 + 1 todo; Typprüfung überall, Build, check-wiring Exit 0 (11 Ausnahmen
weniger), innerHTML Exit 0, Website ok, Smoke-Test bestanden, build-site ok,
reproduzierbar.

Knoten-Stand: unverändert.

## Schritt B-17b3b – OpenTimestamps: Mandate von Kontakten gegen Bitcoin (5.10b, Sammlung B-17)

Letzter Teil von B-17 (K1 A: „ein Anker belegt das frühe Mandat auch gegenüber
Kontakten, die es spät sehen“; K4 A: Prüfung nur bei Bedarf, über zwei Explorer).

**Was neu ist:**
- `merkeMandate(…, anker)` (`key-rotation.ts`): `anker` nennt je Mandat die
  geprüfte Blockzeit. Kommen mehrere zugleich zum ersten Mal, gewinnt das früher
  verankerte vor jedem unverankerten – erst ohne Anker der Zeitstempel. Ein
  gemerktes Mandat löst nur ein verankertes ab, das mehr als
  `ANKER_SPIELRAUM_SEK` (zwei Stunden, die Blockzeit setzt der Miner) früher
  liegt als alles, was das gemerkte belegt (sein Anker, sonst „gesehen“); der
  Anker des gemerkten selbst wird festgehalten und hebt die Latte. Ein Dieb
  verankert erst nach dem Diebstahl – zu spät.
- `mandat-anker.ts` (ohne DOM): `streitigeMandate()` – nur alte Schlüssel mit
  mehr als einem Nachfolger (in Mandaten oder gemerkt); `ankerZeiten()` – nur
  Kind 1040, die genau eines dieser Mandate beweisen (Kennung und Art), je
  Mandat die niedrigste Höhe, höchstens vier Prüfungen je Durchgang; geprüft
  gemerkt je Beweis, „keine Aussage“ nie.
- `ankerFuerStreit()` (`shell/zeitanker-takt.ts`) in `aktualisiereSchluessel()`
  (`tabs/kontakte.ts`): ohne Streit kein Netz; sonst die 1040 zu den
  streitigen Mandaten (`#e`) und `pruefeVerankerung()` gegen beide Explorer.
- `leseGemerkt()` liest den Anker mit (streng); Datenschutz „zeitanker“ nennt
  jetzt auch die Explorer (deutsch und englisch).

**Verdrahtet:** `tabs/kontakte.ts` (`ankerFuerStreit(pool, mandate, gemerkt)` →
`pruefeKontakte(…, anker)`); die letzten drei OTS-Ausnahmen in
`wiring-ausnahmen.txt` entfallen – B-17 ist damit ganz im echten Pfad.

**Tests:** `key-rotation.test.ts` (+3: zugleich gesehen, spät gesehen mit
Spielraum, Dieb verankert zu spät), `mandat-anker.test.ts` (+5: Streit nur bei
mehreren Nachfolgern; der echte Beweis zu Block 970158 über
`pruefeVerankerung()` mit den Köpfen aus der Referenz; fremde Kennung, falsche
Art, unlesbar, „uneinig“ nie gemerkt, Grenze; der Dieb zuerst gesehen, das echte
früher verankert → echter Nachfolger; Verdrahtung).

Ein bestehender Test (`schluessel-status.test.ts`, 8.6a) prüfte den Aufruf von
`pruefeKontakte()` wörtlich – er prüft jetzt den neuen mit Anker (mehr, nicht weniger).

**Prüfungen:** protocol 1186 grün (+3), 6 übersprungen; node 313 (7 übersprungen
ohne Netz), app 924 (+5), mls 13, Leak 73 + 1 todo; Typprüfung überall, Build,
check-wiring Exit 0 (keine OTS-Ausnahme mehr), innerHTML Exit 0, Website ok,
Smoke-Test bestanden, build-site ok, reproduzierbar.

Knoten-Stand: unverändert.

## Schritt D2 – Privat-Schalter je Unterhaltung

Datenschutz gegenüber Providern, Stufe 2 (Karte `docs/DATENSCHUTZ-PROVIDER.md`).
Wer eine Unterhaltung niemandem sonst zeigen will, stellt sie auf „privat“:
Dann fragt die App nur das Modell auf diesem Gerät (B-1) oder den eigenen
Knoten (B-9a) – nie einen fremden Provider.

**Was sich ändert:**
- **`ki-privat.ts` (neu, ohne DOM):** `kiWeg()` (Funk vor Gerät vor Knoten vor
  Netz, wie `askAi()` entscheidet) und `wegErlaubt(privat, weg)` – privat nur
  „geraet“ und „knoten“.
- **`askAi()`:** vor jedem Weg die Sperre – privat und Funk oder Netz: Hinweis
  „Diese Unterhaltung ist privat …“, nichts geht hinaus, nie still ausweichen.
  Damit sind auch Max, Schwarm und Prüfrunden gesperrt (alle hinter dem Netz-Weg),
  ebenso „Erneut“ (geht über `askAi()`).
- **Agent:** Haken „privat“ (`#ai-privat`) neben der Modellwahl, mit Titel und
  Vorleser-Namen. Er gehört zur Unterhaltung: `privat` im Verlauf (Tresor),
  beim Öffnen gesetzt, eine neue Aufgabe beginnt offen, geändert wird er mit der
  Unterhaltung gemerkt (`wirePrivat()`, `app.ts`).
- **Whitepaper:** ein Satz im Abschnitt DVM.

**Verdrahtet:** `askAi()` (`shell/tabs/agent.ts`) → `wegErlaubt(privatGewaehlt(),
kiWeg(…))`; `wirePrivat()` in `shell/app.ts`; Haken in `shell/index.html`.

**Tests:** neu `ki-privat.test.ts` (3): Wege und Erlaubnis, die Sperre steht vor
jedem Weg und vor allem, was sendet, der Haken je Unterhaltung samt Texten.
Smoke-Test „lokal“: privat mit der Wahl Netz – kein Umschlag, kein Auftrag, keine
Frage an localhost, die Frage bleibt im Feld, Hinweis im Toast; privat mit
„Dieses Gerät“ – die Frage geht wie bisher ans Gerät. Gegenprobe: ohne Sperre
wird die Prüfung rot (Frage gesendet, Feld leer). Gleich streng angepasst:
`ki-funk.test.ts` (zwischen Prompt und Funk steht genau die Privat-Sperre).

**Prüfungen** (nach dem Einmergen von main mit 12.7c, 12.1 C, B-17b2, B-17b3a–b):
- protocol 1186 grün, 6 übersprungen, 0 rot (unverändert);
- node 314 grün, 6 übersprungen;
- app 927 grün (vorher 924), Build ok;
- Leak 73 grün + 1 todo; mls 13 grün;
- check-wiring `--streng` Exit 0, check-website 5 Seiten ok, check_innerhtml Exit 0;
- Smoke-Test bestanden (mit der neuen Prüfung „privat“ in „lokal“).

Knoten-Stand: unverändert.

## Schritt D3-Entwurf – Versiegelter Provider-Modus (zur Freigabe)

Datenschutz gegenüber Providern, Stufe 3 (Karte `docs/DATENSCHUTZ-PROVIDER.md`,
Abschnitt 4). Nur ein Entwurf: `docs/D3-ENTWURF.md` – am Code ändert sich nichts.

**Inhalt:** Was es heute gibt (reproduzierbarer Build nur der App, Release-Manifest,
Klartext-Regel nur für den eigenen Code); Bedrohungsmodell – was ein TPM-Beleg
leistet (Software-Mitschnitt erkennen, mit an die PCR gebundenem Schlüssel keine
spätere Entschlüsselung) und was nicht (physischer Zugriff auf Speicher und GPU,
Angriffe auf das TPM, Fehler im Image, Macs); Ablauf (Image mit UKI und dm-verity,
gemessener Start, PCR 7 und 11, Schlüssel und AK im TPM, versiegelter Beleg mit
Zufallszahl und Provider-Schlüssel, Prüfung gegen das Release-Manifest);
Vorschläge V1–V7 mit Empfehlung, Fragen F1–F5 (F1/F2: TPM und Secure Boot am
GX10 messen), Schritte D3a–D3f nach der Freigabe. Offene Entscheidung D3 in der
Sammlung (Abschnitt 5).

**Prüfungen:** Nur Doku – `check-website.py` (5 Seiten ok), `check-wiring.py
--streng` Exit 0; Tests unverändert (protocol 1186, node 314, app 927, Leak 73
+ 1 todo).

## Schritt C-21 – Installer-Adresse und Beispiel-Wallet

Befund beim Gegenlesen einer externen Analyse (07.10.2026, Sammlung C-21): Der
Befehl zum Einrichten eines Providers zeigte auf `freedomstack.io/install.sh` –
in `onboarding.ts` (`providerNextStep()`, derzeit nicht in der Oberfläche
verdrahtet), README, `docs/PROVIDER.md` und im Kopf des Installers. Die Domain
gehört nicht zum Projekt: DNS meldet NXDOMAIN. Wer sie registriert, hätte jedem,
der den Befehl kopiert, beliebigen Code untergeschoben. Den Installer
veröffentlichte bisher auch niemand. Dazu nannten Beispiele für die
Lightning-Adresse eines Providers `wallet.cash` – einen verwahrenden Dienst,
obwohl der Knoten seit 8.2b selbst Rechnungen ausstellen kann.

**Geändert:**
- `scripts/build-site.sh` legt den Installer als `install.sh` mit
  `install.sh.sha256` neben die App – aus demselben Stand, über `pages.yml`.
- `onboarding.ts`: `INSTALLER_URL` (`https://3dagi.github.io/freedom-app/install.sh`),
  der Befehl ohne Beispieladresse – der Installer fragt sie ab und bricht ohne
  sie ab.
- Installer (Kopf, Fehlermeldung, Status-Adresse), README, `docs/PROVIDER.md`,
  START (Befehl), `docker-compose.yml`, Kommentar in `node/src/main.ts`, FAQ und
  Startseite der Website: `provider@knoten.example.org` wie in `docs/PROVIDER.md`;
  im Profil der Platzhalter `du@example.com` (RFC 2606).
- `check-website.py`: `FREMDE_ADRESSEN` auf allen Website-Seiten und in
  README, `docs/PROVIDER.md`, `docker-compose.yml`, Installer.
- Tests: `onboarding.test.ts` prüft Befehl und Herkunft des Installers (statt
  `NODE_LUD16` im Befehl) und dass der Code der App keine der beiden Adressen
  enthält (+1). Gegenprobe: mit dem alten Befehl schlagen beide an; mit dem alten
  README meldet `check-website.py` beide Adressen.

Entscheidungen vom 07.10.2026 in der Sammlung (Abschnitt 5): N1 Aufräumen durch
Spur C (C-22), N2 Native Apps jetzt mit Tauri 2 (C-23 = 6.1), LIZ Lizenz offen.

**Prüfungen:**
- protocol 1186 grün, 6 übersprungen, 0 rot (unverändert);
- node 314 grün, 6 übersprungen;
- app 928 grün (vorher 927), Build ok;
- Leak 73 grün + 1 todo; mls 13 grün;
- check-wiring `--streng` Exit 0, check-website 5 Seiten und 4 Einstiegsdateien ok,
  check_innerhtml Exit 0;
- repro-build reproduzierbar; build-site Exit 0, `install.sh.sha256` gleich der
  Summe von `scripts/install-freedom.sh`;
- Smoke-Test bestanden.

Knoten-Stand: unverändert (nur ein Kommentar in `main.ts`).

## Schritt C-22a – Aufräumen: Wurzel und Doku

Sammlung C-22, entschieden 07.10.2026 (N1). Nur Dokumente – am Code ändert sich
ein Kommentar in `shell/app.ts` (Verweis auf die offene Frage RM1 statt auf die
archivierte Roadmap).

**Archiviert** (`git mv` nach `docs/archiv/`, Übersicht mit „was es war, was
heute gilt“ in `docs/archiv/README.md`): `ANFANGEN.md`, `START-HIER.md`,
`START.md`, `AGENT_HANDOFF.md`, `CHANGELOG-OPUS.md`, `ABSCHLUSSPRUEFUNG.md`,
`LUECKEN.md`, `docs/ANALYSIS.md`, `docs/PROJECT-PLAN.md`, `docs/UI-UPGRADE.md`,
`docs/ROADMAP.md`, `docs/Whitepaper.md`, `docs/dApp-Konzept.md`,
`docs/Techstack-Resistenz.md`, `docs/Master-Whitepaper.md`. Die Verweise darauf
(`phase-0.md`, `UEBERSICHT.md`, Sammlung Anhang C) zeigen ins Archiv.

**Gelöscht:** `yarn.lock` der Wurzel (kam mit 2.2b-c2 hinein; die CI und alle
Befehle nutzen `npm ci`, `contracts/solana-htlc` hat ein eigenes),
`docs/INNERHTML-AUDIT.md` (von `check_innerhtml.py --markdown` erzeugt, seit C-6e
ohne Fundstelle).

**README neu:** Was es ist, Adresse von App und Website, Aufbau mit allen
Paketen, Provider werden (Installer von Pages, aus dem Repo oder Docker),
Gebühren nach Modell A+ wie im Whitepaper der Website, Grundsätze – ehrlich: die
Solana-Programme haben noch Upgrade-Rechte –, Entwickeln, Stand. Keine
Testzahlen mehr: Sie veralteten mit jedem Schritt (das alte README nannte 901 /
158 / 153 und 2,5 % Protokollgebühr); die Zahlen stehen in `CLAUDE.md`.

**Offene Fragen:** R1 (Wallet-Pflicht) und R2 (Sitzungs-Budget auf Kredit,
`defaultBudgetSats: 100`) der alten Roadmap stehen ungeprüft als RM1 und RM2 in
der Sammlung (Abschnitt 5). Die Lizenz-Frage aus C-21 heißt LIZ – „L1“ und „R1“
waren schon vergeben (Spur B).

`GO-LIVE.md` bleibt die eine Checkliste und verweist auf `docs/archiv/START.md`
für Kanäle, Konten und Wortwahl. `docs/mls-spike/` bleibt (Beleg für
`docs/MLS-ENTSCHEIDUNG.md`).

**Prüfungen:** protocol 1186 grün (6 übersprungen), node 314 grün (6
übersprungen), app 928 grün, Leak 73 grün + 1 todo, mls 13 grün – unverändert;
check-wiring `--streng` Exit 0, check-website 5 Seiten und 4 Einstiegsdateien ok
(auch das neue README), check_innerhtml Exit 0, repro-build reproduzierbar,
build-site Exit 0, Smoke-Test bestanden.

## Schritt C-22c – Aufräumen: Code-Reste

Sammlung C-22, entschieden 07.10.2026 (N1). Nur Entfernen und Verschieben –
kein Verhalten der App, des Knotens oder der Website ändert sich.

**Entfernt:**
- `packages/launcher/` – Tauri-Prototyp für den Provider-Knoten aus der Zeit
  vor 5.1 (Lightning-Adresse und Preis in einer JSON-Datei, der geheime
  Schlüssel des Knotens als Klartext darin). Nie in der CI gebaut, nirgends
  verlinkt außer als „geplant“ auf der Website. 6.1a (C-23) legt
  `packages/launcher/` nach der Karte neu an – als Hülle der App, nicht des
  Knotens; der Eintrag für `target/` in `.gitignore` bleibt dafür.
- `packages/website/gated-server.py` – Passwort-Riegel für die Zeit vor GitHub
  Pages – samt CI-Schritt „Gate-Server-Syntax prüfen“.
- `packages/website/build.sh` – alter Build, der die App in den Website-Ordner
  kopierte; veröffentlicht wird seit 0.I nur über `scripts/build-site.sh`. Der
  Eintrag für die Kopie in `.gitignore` fällt mit.
- `agent/patch/freedomstack-interop-2.1.patch` (in 2.1 eingespielt) und
  `scripts/interop/create-pr.sh` (einmaliger Helfer dazu).

**Ins Archiv:** `agent/ANLEITUNG-INTEROP.md` (der Interop-Test aus 2.1; die
Werkzeuge `scripts/interop/nip17-bot.mjs` und `nip17_ui_test.py` bleiben) und
`packages/website/DEPLOY.md` als `docs/archiv/website-DEPLOY.md` (Handanleitung
für IPFS, Tor, ENS mit lokalen Pfaden – heute Spiegel-Job und `docs/KONTEN.md`).

**Gefunden:** Wer beim Einstieg „Rechner vermieten“ wählt, liest „Ein Befehl
richtet alles ein“ – Earn zeigt aber keinen Befehl, und `providerNextStep()`
ist nirgends verdrahtet. Nicht hier behoben (das wäre Oberfläche, kein
Aufräumen), sondern als C-24 in der Sammlung.

Offen bleibt auf der Website die Karte „freedom launcher – geplant“; sie wird
mit 6.1a an die Entscheidung N2 angepasst.

**Prüfungen:** protocol 1186 grün (6 übersprungen), node 314 grün (6
übersprungen), app 928 grün, Leak 73 grün + 1 todo, mls 13 grün – unverändert;
check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0,
`ci.yml` gültig (YAML), repro-build reproduzierbar, build-site Exit 0,
Smoke-Test bestanden.

## Schritt C-24 – Provider werden: der Befehl in der App

Sammlung C-24, gefunden bei C-22c (07.10.2026). Wer beim Einstieg „Rechner
vermieten“ wählte, las „Ein Befehl richtet alles ein“ und landete mit
„Anleitung“ in der Übersicht von Earn – dort stand kein Befehl.
`providerNextStep()` (`onboarding.ts`) hätte einen geliefert, war aber nirgends
verdrahtet.

**Neu:** Earn › Hosten beginnt mit der Karte „Eigenen Knoten betreiben“
(`index.html`, `#knoten-betreiben`): was ein Knoten tut (KI-Aufträge gegen sats
oder SOL, Speicher und Relay), dass ein Befehl Ollama, Modell, Dienst,
Lightning-Adresse und auf Wunsch die SOL-Auszahlung einrichtet (so tut es
`scripts/install-freedom.sh`), „ohne GPU lohnt es sich kaum“, der Befehl in
einem Feld nur zum Lesen mit „Kopieren“ und der Weg über einen eigenen
Checkout und `docs/PROVIDER.md` (dort auch Docker). Der Befehl kommt nur aus
`providerBefehl()` – `bash <(curl -fsSL ${INSTALLER_URL})`, die Adresse aus
C-21; im HTML steht keine Adresse. Verdrahtet über `setupKnotenKarte()`
(`shell/tabs/earn.ts`) beim Start (`shell/app.ts`, neben `setupReferral()`).
Der Einstieg „Rechner vermieten“ öffnet jetzt Earn › Hosten.

**Entfernt:** `providerNextStep()` samt `ProviderCheck` und acht Texten
`ein.prov*` – nie aufgerufen. Was die Funktion prüfen sollte (Ollama da?
Lightning-Adresse?), prüft der Installer selbst: Er installiert Ollama und
bricht ohne Lightning-Adresse ab. Ihre vier Tests sind durch fünf ersetzt:
Befehl und Herkunft, keine Beispieladresse im Befehl, Karte in Hosten (Feld
nur lesbar, Name für Vorleser, keine Adresse im HTML), Einstieg führt nach
Hosten, GPU-Hinweis in beiden Sprachen. Der Smoke-Test („umzug“) kopiert den
Befehl und prüft Wert, Unterreiter und Toast.

Nebenbei gefunden: Die Karte hieß zuerst `#knoten-karte` – die Kennung trägt
schon die Karte „Mein Knoten“ in den Settings. Ein neuer Test in
`zugang.test.ts` hält jede Kennung in `index.html` einmalig.

**Prüfungen:** protocol 1186 grün (6 übersprungen), node 314 grün (6
übersprungen), app 930 grün (vier alte Tests weg, sechs neue), Leak 73 grün +
1 todo, mls 13 grün; check-wiring `--streng` Exit 0, check-website ok,
check_innerhtml Exit 0, repro-build reproduzierbar, build-site Exit 0,
Smoke-Test bestanden. Der erste Lauf fand einen roten App-Test
(`eigene-adresse.test.ts`: `wireEigeneAdresse()` direkt nach `setupReferral()`) –
`setupKnotenKarte()` steht jetzt davor, der Test blieb unverändert.

## Schritt 6.1a1 – Desktop-Hülle

Sammlung C-23, Entscheidung N2 (07.10.2026): native Apps jetzt, Desktop zuerst,
Tauri 2 als neue Abhängigkeit freigegeben. 6.1a ist aufgeteilt (Karte
`phase-6.md`): a1 Hülle, a2 Update der Oberfläche prüfen, a3 Update installieren,
a4 Pakete und Selbst-Update der Hülle.

**Neu: `packages/launcher`** (Tauri 2.12, WebKitGTK 4.1 unter Linux, WebView2
unter Windows):
- `build.rs` legt `packages/app/dist/freedom.html` bei und bricht ohne sie ab.
- `oberflaeche.rs` liefert sie über ein eigenes Schema aus: `freedom://localhost/`,
  unter Windows `http://freedom.localhost/`. Es ist immer derselbe Ursprung, denn
  localStorage, IndexedDB und damit Tresor und Verläufe hängen am Ursprung. Ein
  späteres Update der Oberfläche (a3) muss deshalb unter derselben Adresse liegen.
- Ausgeliefert werden nur `/` und `/freedom.html`, alles andere ergibt 404, auch
  `freedom-spiegel.json`. Die Hülle ist kein Spiegel; der Hosting-Anteil geht wie
  bei jeder Kopie ohne Zahlziel an den Provider.
- `darf_navigieren()` lässt das Fenster nur im eigenen Ursprung navigieren, dazu
  Blob-Adressen dieses Ursprungs für Downloads. Neue Fenster werden abgelehnt.
  Ein fremder Link ersetzt die App also nie; öffnen lässt er sich vorerst auch
  nicht.
- Die Oberfläche bekommt keine Tauri-Rechte (keine Capabilities).
- `window.__FREEDOM_NATIVE__ = { huelle: "desktop", fassung }`, unveränderlich,
  per Skript vor jeder Seite.
- Tests (Rust, 6): Auslieferung, 404 für alles andere (auch `..`), beigelegte
  Datei ist die gebaute App mit CSP, Navigation (eigener Ursprung ja; fremde,
  `file:`, `data:`, `javascript:`, fremde Blobs und die Form der anderen Plattform
  nein), Kennung, Adresse.

**Unter Xvfb geprüft:**
- Die App startet in der Hülle, erzeugt eine Identität und verbindet Relays (8/8).
- Eine Prüf-Einblendung, nur lokal und nicht eingecheckt, zeigte
  `isSecureContext = true` und `crypto.subtle` vorhanden, Ursprung
  `freedom://localhost`, localStorage und IndexedDB gehen.
- Das Test-Profil samt Wegwerf-Schlüssel ist danach gelöscht.

**Symbole:** `scripts/launcher-symbole.py` rechnet das Logo aus dem Manifest
der Website Pixel für Pixel nach. Das geht ohne Bildbibliothek, und dieselbe
Eingabe ergibt immer dieselben Dateien. Mit `--pruefen` vergleicht das Skript
nur; das tut auch die CI.

**CI:** `launcher.yml` testet und baut die Release-Fassung unter Ubuntu 24.04
und Windows. Der Job läuft bei Änderungen an Hülle, App oder Protokoll.

**Website:**
- Die Karten „freedom launcher (Linux)“ und „(Windows / macOS)“ beschrieben
  einen Provider-Installer, den es so nie geben wird. Sie sind ersetzt durch
  „FreedomStack Desktop (Linux, Windows) – in Arbeit“ mit dem geplanten
  Update-Weg.
- Die Provider-Karte „Desktop (1-Klick)“ heißt jetzt „Linux (ein Befehl)“ und
  zeigt den Installer-Befehl aus C-21/C-24, in allen acht Sprachen der Website.

**Offen:**
- Fremde Links im System-Browser öffnen (nach Rückfrage); das braucht das
  Opener-Plugin von Tauri.
- Downloads (Export der App, Sicherung) in der Hülle testen (MENSCH, auf
  Geräten).
- Push-Wecker (Service Worker) gibt es im eigenen Schema voraussichtlich nicht.
- Für a3 die Prüfung der Signaturen in Rust: eine weitere Abhängigkeit (`k256`),
  wird vorher gefragt.

**Prüfungen:**
- launcher: 6 Rust-Tests grün; Release-Bau unter Linux ok (11,4 MB mit
  beigelegter App); Symbole passen.
- protocol 1186 grün (6 übersprungen), node 314 grün (6 übersprungen), app 930
  grün, Leak 73 grün + 1 todo, mls 13 grün – unverändert.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1a2 – Update der Oberfläche prüfen

Teil a2 von 6.1a (Sammlung C-23). Die Desktop-Hülle soll ihre Oberfläche nur
gegen eine Version tauschen, die mindestens k vertraute Signierer bestätigen
und die neuer ist als die laufende. Dieser Schritt baut die Prüfung;
installiert wird mit a3.

**Neu `protocol/src/oberflaeche-update.ts`:**
- `suchUpdate(events, vertraut, laufend, k)` prüft so:
  - Es zählen nur Release-Manifeste (Kind 38054) von vertrauten Schlüsseln mit
    gültiger Signatur. Geprüft wird selbst, nicht dem Relay-Pool geglaubt.
  - Gleich ist eine Version nur, wenn Versionsangabe und alle Dateien (Name,
    Prüfsumme, Größe) übereinstimmen. Sortiert wird nach Bytes, nicht nach
    Sprache, damit die Hülle in Rust dasselbe rechnet.
  - Quellen und Notizen dürfen je Signierer abweichen.
  - Je Signierer zählt nur sein neuestes Manifest einer Version.
  - Als Zeitpunkt einer Version gilt der früheste der Signierer. Einer allein
    kann sie nicht neuer machen.
  - Angeboten wird nur, was neuer ist als die laufende Fassung. Deren Zeitpunkt
    kommt aus ihrer eigenen Bestätigung oder von der Hülle.
  - Quellen nur über https ohne Zugangsdaten.
  - Grenzen in `UPDATE_GRENZEN`: Zahl der Manifeste, Dateigröße, Zahl der
    Quellen.
  - Ergebnis ist ein Angebot (Version, Zeitpunkt, Prüfsumme, Größe, Quellen,
    je Signierer ein Beleg) oder ein Fall: `kein-manifest`, `zu-wenig` (mit der
    Zahl der Bestätigungen) oder `aktuell`.
- `pruefeDatei(angebot, daten)`: Größe, dann Prüfsumme.

**In der App:**
- Settings › Echtheit nennt „Neuere Version“ nur noch über `suchUpdate()`.
  Bisher kam der Hinweis aus `latestRelease()`, das auch eine ältere Version
  „neuer“ nannte, sobald ein eigener Bau lief.
- `ladeManifestEvents()` (`release-signierer.ts`) liefert die signierten Events,
  `manifesteAus()` die lesbaren Manifeste daraus.
- `latestRelease()` und `pruefeDatei()` stehen begründet in
  `wiring-ausnahmen.txt`; `pruefeDatei()` wird mit a3 verdrahtet.

**Tests:**
- 14 neue im Protokoll:
  - Angebot mit Belegen; ein Signierer allein, fremde Signierer, gefälschte und
    untergeschobene Signatur.
  - Uneinige Signierer, wenn sich Datei, Version oder Dateienliste
    unterscheiden.
  - Quellen werden zusammengeführt (nur https).
  - `aktuell`; nie eine ältere Version, auch wenn ein Relay nur die alte zeigt;
    der früheste Zeitpunkt zählt; je Signierer das neueste Manifest.
  - Kaputte Angaben, Grenzen, k = 3, `pruefeDatei()`.
- Ein neuer Test in der App für das Laden der Events.
- Zwei Verdrahtungstests (`release-fix.test.ts`, `eigene-adresse.test.ts`)
  prüfen den neuen Pfad statt des alten Wortlauts. Neu verlangen sie, dass
  `latestRelease()` dort nicht mehr steht.

**Nebenbei, Spur B, klein:** `mesh-radio.test.ts` war im ersten vollen Lauf
rot. „Knoten reicht fremde Pakete weiter“ wartete eine feste Pause von 50 ms
auf das Weiterreichen, das im Takt sendet. Unter Last war die Pause zu kurz –
derselbe Fallstrick wie in 11.1b.
- Unter künstlicher Last nachgestellt: die alte Fassung ist in 3 von 5 Läufen
  rot, die neue in 5 von 5 grün.
- Behoben mit `bisGesendet()` (warten bis zur Zahl, höchstens 2 s), ebenso
  „Dasselbe Paket wird nicht zweimal weitergereicht“. Dort folgt danach noch
  die kurze Pause, in der ein zweites Senden käme.
- Tests, die „nichts gesendet“ prüfen, behalten die Pause: Last kann sie nicht
  rot machen.

**Prüfungen:**
- protocol 1200 grün (6 übersprungen, +14), node 314 grün (6 übersprungen),
  app 931 grün (+1; im zweiten Lauf mit dem behobenen Mesh-Test), Leak 73 grün
  + 1 todo, mls 13 grün.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1a4a – Pakete der Desktop-Hülle in der CI

Teil a4 von 6.1a (Sammlung C-23), aufgeteilt in a4a und a4b. a4a bringt Pakete
zum Testen auf Geräten. a4b ist das Selbst-Update der Hülle; dafür braucht es
einen Signierschlüssel (MENSCH).

**CI (`launcher.yml`):**
- Nach Tests und Release-Bau baut der Job mit `tauri-cli` 2 die Pakete:
  - Linux: `.deb` (5,1 MB; hängt an `libwebkit2gtk-4.1-0` und `libgtk-3-0`)
    und AppImage (80 MB, WebKitGTK eingepackt).
  - Windows: NSIS-Installer für den eigenen Benutzer, ohne
    Administratorrechte.
- `tauri-cli` ist das Bauwerkzeug von Tauri 2 (freigegeben mit N2) und liegt
  im Zwischenspeicher.
- Abgelegt wird alles mit `SHA256SUMS` als Artefakt des Laufs (14 Tage). Das
  ist **kein Release**: unsigniert (Windows warnt über SmartScreen), nirgends
  verlinkt. Die Website sagt weiter „Pakete folgen“.

**`tauri.conf.json`:** Kurzbeschreibung, Beschreibung, Kategorie, `publisher`
(sonst stand „github“ als Maintainer im `.deb`), NSIS `installMode:
currentUser`.

**Lokal geprüft:**
- `cargo tauri build --bundles deb,appimage` baut beide Pakete.
- Im `.deb` stehen Abhängigkeiten, Symbole und Desktop-Eintrag.
- Die AppImage startet unter Xvfb (`APPIMAGE_EXTRACT_AND_RUN=1`) und zeigt
  die App. Das Test-Profil ist danach gelöscht.

**Offen:**
- Der Windows-Installer ist nur in der CI gebaut. Testen auf Geräten:
  MENSCH.
- Der AppImage-Bau lädt linuxdeploy und dessen Plugin von GitHub. Tauri pinnt
  das Plugin nicht („continuous“). Für Releases (a4b) prüfen oder selbst
  pinnen.

**Prüfungen:**
- launcher: 6 Rust-Tests grün; Pakete lokal gebaut (deb, AppImage).
- protocol 1200 grün (6 übersprungen), node 314 grün (6 übersprungen), app 931
  grün, Leak 73 grün + 1 todo, mls 13 grün – unverändert.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.
- `launcher.yml` ist gültiges YAML.

## Schritt 6.1a3a – Update der Oberfläche: Prüfung in der Hülle

Teil a3 von 6.1a (Sammlung C-23), aufgeteilt in drei Schritte:
- **a3a** (dieser Schritt): Prüfung in Rust.
- **a3b**: Ablage und Auslieferung der installierten Fassung, die alte bleibt
  als Rückfall.
- **a3c**: Knopf „Installieren“ in der App.

`k256` hat der MENSCH am 07.10.2026 freigegeben.

**Warum in der Hülle:** Die App findet ein Update über `suchUpdate()` und lädt die
Datei. Würde die Hülle der Oberfläche glauben, könnte eine Lücke in der
Oberfläche eine eigene Fassung dauerhaft einsetzen. Deshalb prüft die Hülle
dieselben Belege noch einmal selbst.

**Neu `packages/launcher/src/update.rs`:** `pruefe(html, belege, vertraut, k,
laufend_seit)` prüft:
- die Kennung nach NIP-01 – `serde_json` serialisiert wie `JSON.stringify`;
- die Schnorr-Signatur nach BIP-340 (`k256` 0.13.4, `verify_raw` über die
  Kennung);
- dass nur vertraute Schlüssel zählen;
- dass k Signierer dieselbe Version bestätigen – Versionsangabe und alle Dateien
  gleich, je Signierer sein neuestes Manifest;
- dass die Datei genau `freedom.html` dieser Version ist (Größe, SHA-256);
- als Zeitpunkt den frühesten der Signierer und nur Neueres als die laufende
  Fassung.

Fehler gibt es nur als Kennung: `kein-beleg`, `zu-wenig`, `abweichend`,
`nicht-neuer`, `zu-gross`. Zahlen und Namen liest die Hülle im Zweifel strenger
als das Protokoll – sie lehnt dann ab, nimmt aber nie mehr an.

**Eine Liste:** `build.rs` liest `TRUSTED_SIGNERS` aus
`packages/app/src/release-signierer.ts` und `RELEASE_MIN_SIGNATUREN` aus
`packages/protocol/src/release.ts` (k muss mindestens 2 sein). Es gibt keine
zweite Liste in Rust, die auseinanderlaufen könnte.

**Gemeinsame Prüffälle:**
- `scripts/oberflaeche-vektoren.mts` erzeugt `packages/launcher/tests/vektoren.json`.
  Die Datei enthält 13 Fälle mit Wegwerfschlüsseln – nur öffentliche Schlüssel
  und signierte Events.
- Fälle: ok; Sonderzeichen in der Kennung (Steuerzeichen, Anführungszeichen,
  Emoji, U+2028); frühester Zeitpunkt; ein Signierer; derselbe Signierer zweimal;
  ein fremder Signierer; gefälschte Prüfsumme; ein untergeschobenes Manifest;
  Uneinigkeit über Version und Dateien; eine andere Datei; nicht neuer; keine
  Belege.
- Rust (`update.rs`) und Protokoll (`oberflaeche-vektoren.test.ts`) entscheiden
  alle Fälle gleich.

**Neue Pakete in `Cargo.lock`:** `k256` mit dem RustCrypto-Unterbau (`base16ct`,
`base64ct`, `const-oid`, `crypto-bigint`, `der`, `ecdsa`, `elliptic-curve`, `ff`,
`group`, `pkcs8`, `rand_core`, `sec1`, `signature`, `spki`, `subtle`, `zeroize`) –
dieselben stehen schon in `packages/mls/Cargo.lock`. `sha2`, `serde` und
`serde_json` waren über Tauri schon da.

**Aufgerufen** wird `pruefe()` ab a3b; bis dahin nur aus den Tests.

**Prüfungen:**
- launcher: 14 Rust-Tests grün (+8), `cargo clippy --all-targets` ohne Warnung.
- protocol 1214 grün (6 übersprungen, +14), node 314 grün (6 übersprungen), app
  931 grün, Leak 73 grün + 1 todo, mls 13 grün.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1a3b – Update der Oberfläche: Ablage und Auslieferung in der Hülle

Teil a3 von 6.1a (Sammlung C-23). Seit a3a prüft die Hülle ein Update selbst;
jetzt legt sie eine freigegebene Fassung ab und liefert sie aus. Der Knopf in der
App folgt mit a3c.

**Neu `packages/launcher/src/ablage.rs`:** Im Datenverzeichnis der Hülle
(`oberflaeche/`) liegen höchstens zwei Fassungen, `aktuell.*` und `vorher.*` – je
Datei und Stand (Version, SHA-256, Zeitpunkt).
- Installiert wird in drei Schritten: `neu.*` vollständig schreiben (mit
  `sync_all`), dann `aktuell` → `vorher`, dann `neu` → `aktuell` (der Stand
  zuletzt).
- Geladen wird eine Fassung nur, wenn ihre Datei zu ihrem Stand passt. Bricht ein
  Schritt ab oder ändert jemand die Datei, gilt wieder die beigelegte.

**Neu `packages/launcher/src/installation.rs`:**
- Beim Start gilt die installierte Fassung – aber nur, wenn sie neuer ist als die
  beigelegte. Bringt ein Update der Hülle eine neuere Oberfläche mit, gilt diese.
- `oberflaeche_stand`: Quelle (beigelegt/installiert), Version, Prüfsumme,
  Zeitpunkt, ob mit `--oberflaeche=beigelegt` gestartet, ob es eine vorige gibt.
- `oberflaeche_installieren(html, belege)`: nur nach `update::pruefe()` mit den
  vertrauten Signierern und k aus dem Bau; neuer als die laufende **und** als die
  abgelegte Fassung. Ohne diese zweite Grenze hätte eine mit
  `--oberflaeche=beigelegt` gestartete Sitzung die installierte durch eine ältere
  ersetzen können (ein Test hält das, mit altem Code rot). Danach liefert die
  Hülle die neue Fassung sofort aus (ab dem nächsten Laden der Seite).
- Zurück nur über den Start, nie aus der App: `--oberflaeche=vorher` macht die
  vorige installierte Fassung dauerhaft wieder aktuell, `--oberflaeche=beigelegt`
  startet diesmal mit der beigelegten. Ein Kommando dafür gibt es bewusst nicht –
  sonst könnte eine Lücke in der Oberfläche auf eine ältere, verwundbare Fassung
  zurückschalten.
- Den Zeitpunkt der beigelegten Fassung setzt ein Release-Bau über
  `FREEDOM_RELEASED_AT`; ohne ist er 0.

**Rechte:** `build.rs` nennt die zwei Kommandos im App-Manifest
(`tauri_build::AppManifest`), `capabilities/oberflaeche.json` erlaubt genau diese
dem Fenster `haupt`. Unter Xvfb mit einer nur lokalen Probe geprüft (nicht
eingecheckt): Aus `freedom://localhost` antworten beide Kommandos
(`oberflaeche_installieren` ohne Belege mit `kein-beleg`), `plugin:window|title`
und `plugin:app|version` weist Tauri ab („not allowed“). Die von Tauri erzeugten
Dateien unter `permissions/autogenerated/` stehen in `.gitignore`.

**Prüfungen:**
- launcher: 24 Rust-Tests grün (+10: Ablage 5, Installation 5),
  `cargo clippy --all-targets` ohne Warnung.
- protocol 1214 grün (6 übersprungen), node 314 grün (6 übersprungen), app 931
  grün, Leak 73 grün + 1 todo, mls 13 grün – unverändert, der Schritt ändert nur
  die Hülle.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1a3c – Update der Oberfläche: Knopf „Installieren“ in der App

Teil a3 von 6.1a (Sammlung C-23), der letzte. Seit a3b legt die Desktop-Hülle eine
geprüfte Fassung ab; jetzt bietet die App sie an.

**Neu `packages/app/src/shell/oberflaeche-huelle.ts`:**
- `huellenAufruf()`: die Hülle nur, wenn `__FREEDOM_NATIVE__.huelle` „desktop“ ist
  **und** Tauri einen Aufruf bietet – Tauri allein ist nicht diese Hülle. Aufgerufen
  mit dem Objekt der Hülle als `this` (wie bei `fetch` nie als Methode gespeichert).
- `leseHuellenStand()`: die Antwort auf `oberflaeche_stand` streng gelesen (Quelle,
  Version in der Form des Protokolls, Prüfsumme als 64 Hex klein, Zeitpunkt als
  ganze Zahl ≥ 0, zwei Wahrheitswerte) – sonst nichts.
- `ladeOberflaeche()`: Quelle für Quelle aus dem Angebot (höchstens
  `UPDATE_GRENZEN.quellen`), ohne Zugangsdaten und Referrer, gelesen höchstens bis
  zur angebotenen Größe; genommen nur, was `pruefeDatei()` durchlässt.
- `alsText()`: UTF-8 streng, ein BOM bleibt – die Hülle bekommt genau dieselben
  Bytes, über die das Manifest die Prüfsumme nennt.
- `uebergibHuelle()`: prüft die Datei noch einmal, gibt sie mit den Belegen des
  Angebots an `oberflaeche_installieren`; Fehler der Hülle nur als Kennung
  (`INSTALL_FEHLER_TEXT`), alles andere „unbekannt“. Fremdes und Kaputtes erreicht
  die Hülle nie.

**Settings › Echtheit (`tabs/settings.ts`):**
- In der Hülle: welche Fassung läuft (beigelegt oder installiert mit Version),
  „diesmal mit der beigelegten gestartet“ und, wenn es eine vorige gibt, der
  Rückweg über `--oberflaeche=vorher`.
- Bei einem Angebot der Knopf „Version … installieren“: laden und prüfen, dann
  `bestaetige()` (Größe, Zahl der Signierer, Datum, Rückweg), dann übergeben, dann
  `hinweis()` und neu laden. Ein Test hält die Reihenfolge fest.
- `suchUpdate()` bekommt in der Hülle deren Zeitpunkt der laufenden Fassung (0 =
  unbekannt, dann wie bisher aus der Bestätigung).
- Die Prüfsumme der eigenen Datei kommt in der Hülle aus `oberflaeche_stand`.

**Befund unter Xvfb:** In der Hülle scheiterte die Echtheitsprüfung mit „Load
failed“. Ursache ist die CSP der App: `connect-src` nennt `https:` und `http:`, nicht
das eigene Schema `freedom:` – ein `fetch(location.href)` ist dort verboten (ein
Listener für `securitypolicyviolation` zeigte es; die CORS-Anmeldung des Schemas in
WebKitGTK änderte nichts). Unter Windows (`http://freedom.localhost/`) ist es gedeckt.
Die Prüfsumme der Hülle ist ohnehin genauer – sie ist über die ausgelieferten Bytes
gerechnet. Der Selbst-Export (Weitergeben) bleibt in der Hülle unter Linux kaputt:
`'self'` in `connect-src` wäre eine CSP-Änderung, also Entscheidung H1 für den
MENSCHEN.

**Unter Xvfb geprüft** (nur lokale Probe, nicht eingecheckt):
- Settings › Echtheit in der echten App zeigt in der Hülle „Desktop app: interface
  as bundled.“ (Sprache des Webviews).
- Mit den Wegwerfschlüsseln der Prüffälle als vorübergehend vertraute Signierer
  (nur im lokalen Bau): `oberflaeche_installieren` liefert „Fassung 2“ nach dem
  Neuladen und nach einem Neustart; eine fremde Datei wird abgewiesen
  (`abweichend`); `--oberflaeche=beigelegt` und `--oberflaeche=vorher` wie
  beschrieben. Ein Download von GitHub Pages aus `freedom://localhost` geht (CORS).

**Prüfungen:**
- app: 937 grün (+6: Hülle erkennen, Stand lesen, laden, Text, Übergabe,
  Verdrahtung); der Verdrahtungstest aus 6.1a2 prüft den neuen Aufruf von
  `suchUpdate()`.
- protocol 1214 grün (6 übersprungen), node 314 grün (6 übersprungen), Leak 73
  grün + 1 todo, mls 13 grün, launcher 24 grün (unverändert).
- check-wiring `--streng` Exit 0 – `pruefeDatei` ist jetzt verdrahtet, seine
  Ausnahme ist raus (zuerst Exit 1: „veraltete Ausnahme“); check-website ok,
  check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1c1 – Android-App: APK zum Testen

Teil c von 6.1 (Sammlung C-23, Entscheidung N2): dieselbe Hülle wie auf dem Desktop
als Android-App. Der MENSCH hat am 07.10.2026 Android nach a3 und vor Tor (b) gewählt.

**Hülle (`packages/launcher`):**
- Die Hülle steht jetzt in `src/lib.rs` (`run()` mit `mobile_entry_point`); `main.rs`
  startet sie auf dem Desktop. `Cargo.toml` baut dafür auch eine Bibliothek
  (`freedom_launcher_lib`, wie Tauri es für Mobilgeräte verlangt).
- Paketname `io.github.threedagi.freedom` nur für Android (`tauri.android.conf.json`):
  Ein Teil eines Android-Pakets darf nicht mit einer Ziffer beginnen. Der Desktop
  behält `io.github.3dagi.freedom` – dort hängen Datenverzeichnis und Speicher des
  Webviews daran.
- Schema wie unter Windows `http://freedom.localhost/` (`HTTP_FORM`);
  `__FREEDOM_NATIVE__.huelle` ist dort „android“ (`HUELLE`).
- Android kennt keine Startargumente. Die Ablage liegt deshalb im Cache der App
  (`ablageordner()`): „Cache leeren“ in den Einstellungen führt zur beigelegten
  Fassung zurück; Tresor und Verläufe liegen bei den Daten des Webviews und bleiben.

**App:** `huellenArt()` erkennt Desktop und Android; die Settings nennen den
Rückweg je Hülle (`rueckwegText()`: Desktop `--oberflaeche=vorher`, Android „Cache
leeren“), die Texte sagen „diese App“ statt „Desktop-App“.

**Symbole:** `scripts/launcher-symbole.py --android` schreibt `ic_launcher`,
`ic_launcher_round` und `ic_launcher_foreground` in fünf Dichten aus dem Logo, ohne
Bildbibliothek – Tauri setzt sonst sein eigenes Logo ein. `--pruefen` prüft wie
bisher nur die eingecheckten Desktop-Symbole (unverändert bitgleich).

**CI (`launcher.yml`, Job „Android-APK bauen (Test)“):** Java 17, NDK r27d
(27.3.13750724), `cargo tauri android init --ci` (das Projekt `gen/android` wird
nicht eingecheckt), Symbole, `cargo tauri android build --apk --target aarch64`, dann
`zipalign` und `apksigner` mit einem Wegwerf-Schlüssel, der nur in diesem Lauf
entsteht (Passwort aus `/dev/urandom`, nirgends ausgegeben, danach gelöscht). Artefakt
`freedom-android` mit `freedom-android-arm64-test.apk` und `SHA256SUMS`, 14 Tage –
kein Release. Ein Update von einem Lauf zum nächsten geht nur nach dem
Deinstallieren (anderer Schlüssel); einen festen Schlüssel legt der MENSCH an (c2).

**Lokal gebaut:** Android-SDK (Plattform 36, Build-Tools 35, NDK r27d) in der
Sitzung; das APK (13,6 MB, arm64) mit `aapt2` geprüft: Paket
`io.github.threedagi.freedom`, Name „FreedomStack“, nur die Erlaubnis `INTERNET`
(dazu die interne für dynamische Empfänger), Symbol aus dem Logo; Signatur mit
`apksigner verify` geprüft. Einen Emulator gibt es hier nicht (kein KVM) – das APK
auf einem Gerät testen ist eine MENSCH-Aufgabe. Maven Central antwortete über den
Proxy mit 429; lokal half ein Gradle-Init-Skript mit Googles Spiegel (nicht im Repo).

**Website:** Karte „FreedomStack als App (Linux, Windows, Android)“ – Testpakete
baut die CI, Pakete zum Herunterladen folgen mit dem ersten signierten Release.

**Prüfungen:**
- launcher: 26 grün (+2: Kennung je Plattform, HTTP-Form), `cargo clippy
  --all-targets` ohne Warnung.
- app 938 grün (+1: Rückweg je Hülle), Leak 73 grün + 1 todo, protocol 1214 grün
  (6 übersprungen), node 314 grün (6 übersprungen), mls 13 grün.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 7.5a – Meshtastic-Geräte direkt: Format im Protokoll

**Anlass (MENSCH 08.10.):** Die Frage, ob Freedom ohne Internet nur mit LoRa geht.
LoRaWAN/The Things Network passt tatsächlich nicht (Stern über Internet, Fair Use
rund 30 s Sendezeit am Tag). Das Mesh aus Phase 7 braucht kein Internet – aber seit
7.4c1 schickte die App rohe Rahmen mit Längenpräfix über USB und den Bluetooth-Dienst
„Nordic UART“. Meshtastic, die verbreitete Firmware der LoRa-Geräte um 40 €, spricht
ein eigenes Protobuf-Format und verwarf die Rahmen still; die „Firmware mit
Längenpräfix“ aus 7.4 gab es nie. Entscheidung: Spur A baut die Anbindung (7.5a–d),
Kanal nach Variante (a); die Befunde gehen über `docs/MESHTASTIC.md` an Spur B.

**Protokoll (`meshtastic.ts`, ohne Abhängigkeit):**
- `baueKonfigAnfrage(id)` (`ToRadio.want_config_id`), `baueFunkPaket()`
  (`ToRadio.packet`: an alle, Port `PRIVATE_APP` 256, Kanal, Hop-Limit, ohne
  Paket-Id – die vergibt die Firmware; ohne `want_ack` bliebe ein Hop-Limit 0
  bei 0, das Paket ginge nur einen Sprung weit).
- `mitMeshtasticKopf()` und `MeshtasticStrom` für USB und TCP: `0x94 0xC3` plus
  Länge, höchstens 512 Byte; Text aus dem Debug-Log der Firmware wird
  übergangen, eine zu große Länge setzt neu auf (wie die Python-Bibliothek).
- `leseVomGeraet()`: Paket (Absender, Empfänger, Kanal, Port, Nutzlast als
  Kopie), eigene Nummer, LoRa-Einstellungen (Region, Hop-Limit, Senden, Preset),
  Kanal (Index 0–7, Name, Schlüssel, Rolle), Ende der Einstellungen,
  Warteschlange, Neustart; Unbekanntes wird übersprungen (auch fixed64), bei
  Oneof gilt das letzte Feld, Kaputtes ergibt `null`, nie eine Ausnahme.
- `FREEDOM_KANAL`: „freedom“, Schlüssel SHA-256 von
  `freedomstack-meshtastic-kanal-v1` – öffentlich, trennt nur den Verkehr.

**Referenz:** `scripts/meshtastic-referenz.py` erzeugt mit der offiziellen
Python-Bibliothek meshtastic 2.7.11 `test/fixtures/meshtastic-referenz.json`: 7
Nachrichten an das Gerät (Byte für Byte), 13 vom Gerät mit Feldern, die der Leser
überspringen muss. Firmware-Verhalten (Hop-Limit, Paket-Id, Zustellung von
Rundrufen, lokale Admin-Nachrichten, EU_868 mit 10 % im Teilband 869,4–869,65 MHz)
aus dem Quelltext belegt, Stände in `docs/MESHTASTIC.md`. Gegenprobe: sechs
absichtlich eingebaute Fehler (Kanal-Index, Neuaufsetzen, Feldnummer, Oneof,
Längengrenze, Zahl mit elf Byte) macht je ein Test rot.

**Doku:** `docs/MESHTASTIC.md` (Befunde, Festlegungen, Sendezeit ehrlich
gerechnet – LongFast rund 134 Byte/s, ein voller Rahmen rund 1,9 s statt der
gebuchten 1,0 s, behoben in 7.5b), Karte `phase-7.md` 7.5, FORTSCHRITT mit Hinweis in
der Zeile von Spur B, GO-LIVE (Geräte mit Meshtastic-Firmware, App ab 7.5b).
Verdrahtet wird mit 7.5b (Ausnahmen in `wiring-ausnahmen.txt` mit diesem Verweis).

**Prüfungen:** protocol 1222 grün (+8, 6 übersprungen), node 314 grün (6
übersprungen), app 938 grün, Leak 73 grün + 1 todo, mls 13 grün; check-wiring
`--streng` Exit 0 (0 offen), check-website ok, check_innerhtml Exit 0;
repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 7.5b – Meshtastic-Geräte direkt: USB in der App

**Strecke (`meshtastic-strecke.ts`, aus `connectSerial()`):**
`erkenneSerielleStrecke()` weckt das Gerät (32 × `0xC3` wie die Python-Bibliothek)
und fragt nach den Einstellungen (`want_config`), alle 2 s erneut – ein ESP32
startet beim Öffnen des Ports oft neu. Antwortet in 10 s nichts, was nur
Meshtastic schickt (eigene Nummer, LoRa, Kanal), bleibt der Weg mit Längenpräfix
aus 7.4c1; was bis dahin kam, wird dafür gelesen. Mit Meshtastic:
- Kanal „freedom“ nur mit unserem Schlüssel (ein gleichnamiger mit anderem
  Schlüssel gilt als fremd – die anderen läsen ihn nicht).
- Senden: `baueFunkPaket()` auf diesem Kanal, Hop-Limit des Geräts (ohne Angabe 3
  wie `HOP_RELIABLE`); ohne Kanal geht nichts hinaus.
- Empfangen: nur Port 256 auf diesem Kanal; Text und andere Kanäle nicht.
- Nach einem Neustart des Geräts fragt die App erneut.
- `leitetSelbstWeiter` und `sendezeit` (`meshtasticSendezeit()`: Formel von
  Semtech mit Präambel 16, Meshtastic-Kopf und Datenhülle; Presets wie
  `modemPresetToParams()` der Firmware, eigene Funkwerte wie LongSlow).

**Funkknoten:** Über eine Strecke mit `leitetSelbstWeiter` reicht er nichts
weiter (Meshtastic flutet selbst – sonst ginge jeder Rahmen doppelt in die
Luft); Sendezeit, Wartezeit und Takt nimmt er von der Strecke
(`sendezeitFuer()`), sonst wie bisher 200 Byte/s.

**Oberfläche und Texte:** In der Mesh-Karte nach dem Verbinden die Hinweise aus
`meshtasticHinweise()`: Kanal fehlt (mit Name und öffentlichem Schlüssel zum
Abtippen in der Meshtastic-App) oder fremd, Region nicht gesetzt, Senden aus.
Neue Grenze „mesh-geraet“ im Datenschutzbericht (offene Gerätenummer, Name und
Position je nach Einstellung, öffentlicher Kanal). Gemessen: Eine kurze
Direktnachricht ist als Umschlag rund 1,7 KB (10 Rahmen) und braucht mit
LongFast rund 18 s Sendezeit – bei 1 % etwa zwei je Stunde. „Drei bis vier“
(App, Protokoll-Satz, FAQ, Whitepaper) beruhte auf angenommenen 200 Byte/s und
ist korrigiert.

**Tests:** `app/test/meshtastic-strecke.test.ts` (neu, 6) mit einer
Geräte-Attrappe aus den Referenz-Nachrichten: Erkennung, Senden und Empfangen nur
auf dem Kanal, Neustart, Hop-Limit 3, ohne Kanal nichts hinaus, Hinweise,
Rückfall auf Längenpräfix samt schon Empfangenem, kein Weiterreichen, Dauer nach
der Sendezeit der Strecke, Verdrahtung. Protokoll: Sendezeit gegen eine eigene
Rechnung, verankert an zwei veröffentlichten Werten (56,6 ms und 1318,9 ms);
Grenze „mesh-geraet“. Gegenprobe: neun absichtlich eingebaute Fehler macht je
ein Test rot.

**Prüfungen:** protocol 1224 grün (+2, 6 übersprungen), node 314 grün (6
übersprungen), app 944 grün (+6), Leak 73 grün + 1 todo, mls 13 grün;
check-wiring `--streng` Exit 0 (0 offen, fünf Ausnahmen aus 7.5a gestrichen),
check-website ok, check_innerhtml Exit 0; repro-build reproduzierbar, build-site
Exit 0, Smoke-Test bestanden.

## Schritt 7.5c – Meshtastic-Geräte direkt: Bluetooth und Kanal anlegen

**Bluetooth:** `connectBluetooth()` fragt nach Nordic UART oder dem Dienst von
Meshtastic und nimmt Meshtastic, wenn das Gerät ihn hat (`meshtasticBluetooth()`).
Wie die Python-Bibliothek: `ToRadio` ohne Kopf an „zum Gerät“ (mit Antwort),
„vom Gerät“ lesen, bis es leer ist – nach jedem Schreiben und bei „Meldung“ –,
ohne zwei Lesevorgänge zugleich. Antwortet das Gerät in 15 s nicht, trennt die
App und sagt es.

**Eine Sitzung für beide Wege (`MeshtasticSitzung`):** Einstellungen lesen,
senden, empfangen, Kanal anlegen. Kanäle einer Abfrage gelten erst ab „Ende der
Einstellungen“ (`uebernimm()`): Bis dahin gilt der alte Stand – sonst ginge ein
Rahmen verloren, den der Knoten während eines Neustarts des Geräts sendet; ein am
Gerät gelöschter Kanal gilt danach nicht mehr.

**Kanal anlegen:** `baueKanalAnlegen()` (Protokoll) –
`AdminMessage.set_channel` an die eigene Nummer, Port `ADMIN_APP`, mit
`want_response` und `want_ack` wie `writeChannel()` der Python-Bibliothek; zwei
Vektoren aus der Referenz. In der Mesh-Karte ein Knopf, nur wenn der Kanal
fehlt, und nur nach `bestaetige()` (Text: zweiter Kanal, Hauptkanal bleibt, ein
fremder „freedom“ wird ersetzt, Schlüssel öffentlich). Platz: der eines
„freedom“ mit fremdem Schlüssel, sonst der erste freie (1–7); ohne Platz geht
nichts an das Gerät. Danach fragt die App neu – erst die Einstellungen des
Geräts belegen den Kanal.

**Tests:** `app/test/meshtastic-geraet.test.ts` (neu, 5) mit einer Attrappe, die
wie ein Gerät antwortet (Einstellungen auf `want_config`, `set_channel` an sich
selbst, USB und Bluetooth): anlegen über USB und Bluetooth, fremden ersetzen,
kein Platz, gelöschter Kanal nach Neustart, Lesen bis leer, stummes Gerät,
Verdrahtung (Dienstwahl, Rückfrage vor dem Anlegen). Gegenprobe: neun
absichtlich eingebaute Fehler macht je ein Test rot.

**Prüfungen:** protocol 1225 grün (+1, 6 übersprungen), node 314 grün (6
übersprungen), app 949 grün (+5), Leak 73 grün + 1 todo, mls 13 grün;
check-wiring `--streng` Exit 0 (0 offen), check-website ok, check_innerhtml
Exit 0; repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt B-22 – Öffentliche Räume: Wer beitritt, schreibt mit

Entscheidung MENSCH 08.10.2026 nach dem Nutzertest (Befund R-8): Wer einem
öffentlichen Raum beitritt, schreibt in den Kanälen, die das erlauben – wie
„@everyone“ bei Discord. Bis hier hatte ein Beigetretener keine Rolle und damit
kein Recht „schreiben“, auch nicht in #allgemein; die Gründerin erfuhr nichts
vom Beitritt, und der Hinweis sagte nicht, wie man schreiben darf.

**Was neu ist:**
- `JEDER_ROLLE` („jeder“) und `JEDER_RECHTE` (lesen, schreiben, Threads) in
  `spaces.ts`: Nennt die Rollenliste des Gründers (34701) die Rolle, gilt sie für
  jeden, ohne Zuweisung (`permissionsOf()`); nur ihre Grundrechte zählen –
  Moderieren, Rollen vergeben, Kanäle verwalten und Repos pflegen gibt es weiter
  nur über eine zugewiesene Rolle mit Rang. `canWriteTo()`: Kanäle ohne
  Schreibrollen und Kanäle, die `jeder` nennen; #ankündigungen (`mod`) bleibt bei
  den Moderatoren. Eine Rollenliste mit `jeder` von jemand anderem zählt wie bisher nicht.
- App (`shell/tabs/raeume.ts`): neue offene Räume mit der Rolle für alle;
  Menüpunkt „Wer im Raum schreiben darf“ (`#space-schreiben`, nur der Gründer eines
  offenen Raums) → `stelleSchreibrechtEin()`: „Alle, die beitreten“ oder „Nur wer
  eine Rolle hat“, veröffentlicht eine neue Rollenliste, die übrigen Rollen
  bleiben. Ohne die Rolle sagt der Hinweis im Kanal jetzt, dass der Gründer den
  Raum für alle öffnen kann (`raum.nurMitRolle`); die Warnung beim Anlegen nennt
  das Mitschreiben. Ältere Räume bleiben, wie sie sind, bis der Gründer umschaltet.

**Verdrahtet:** `legeRaumAn()` (Rollenliste mit `JEDER_ROLLE`), `zeigeRaumArt()`
(`#space-schreiben`), `stelleSchreibrechtEin()` über `wireSpacesTab()`,
`oeffneKanal()` (Hinweis mit `JEDER_ROLLE`); `permissionsOf()`/`canWriteTo()` im
echten Pfad jeder Schreibprüfung offener Räume.

**Tests:** `spaces.test.ts` (+2: Beigetretene schreiben im offenen Kanal, nicht in
#ankündigungen, ausdrücklich genannte Rolle, zurückgeschaltet wieder zu; nur
Grundrechte – kein Moderieren, Vergeben, Verwalten, keine Selbst-Zuweisung,
Ausblenden zählt nicht mit Gegenprobe, fremde Rollenliste zählt nicht),
`app/test/raum-jeder.test.ts` (+5: Raum wie die App ihn anlegt über
`raumZustandFuer()`, Kanal-Event eines Beigetretenen zählt nicht, zurückgeschaltet
und ältere Räume, frühere Nachrichten beim Ab- und Wiedereinschalten, Verdrahtung,
Texte).

**Rechte gelten, wie sie jetzt sind:** Schaltet der Gründer ab, verschwinden
auch frühere Nachrichten von Leuten ohne Rolle aus der Ansicht (wie bei jedem
entzogenen Recht seit B-19/B-20); schaltet er wieder ein, sind sie zurück. Der
Dialog sagt das vorher (`raum.schreibenText`) – bei Discord blieben sie stehen,
das bräuchte hier eine Geschichte der Rollenlisten.

**Fund beim Prüfen im Browser (klein, Oberfläche, Spur C genannt):** Am Handy
ging ein Tipp auf „Senden“ beim Tippen ins Leere – in Chat, Räumen und beim
Agenten. Gemessen: `mousedown` auf dem Knopf (y 786), der Fokus wechselt, die
untere Leiste kehrt zurück (`body.tippt`), der Knopf rutscht 48 px nach oben,
`mouseup` trifft einen Knopf der Leiste, der Klick geht an `#app`. Das erklärt
Befund C-13 des Nutzertests (Carol konnte nicht senden). `navigation.ts`: unter
1024 px nimmt ein Tipp auf einen Knopf beim Tippen dem Feld den Fokus nicht
(`mousedown` abgefangen) – der Klick kommt an, die Tastatur bleibt offen. Neue
Prüfung „Senden beim Tippen“ im Smoke-Test „mobil“ (hoch und quer); ohne die
Änderung rot (hoch: Klick an ein DIV, quer: Fokus verloren), mit ihr grün.

**Doku:** `docs/PROTOCOL.md` §22 (Rolle für alle), CLAUDE.md (Fallstricke Offene
Räume, Mobil), FORTSCHRITT (Spur B), Sammlung (B-22, O1; dazu G1 und A-14 für Spur A).

**Prüfungen** (nach dem Einmergen von `main` mit 7.5b/7.5c): protocol 1227 grün
(+2, 6 übersprungen), node 313 (7 übersprungen ohne Netz, mit Netz 314), app 954
(+5), Leak 73 + 1 todo, mls 13; Typprüfung überall, Build, check-wiring
`--streng` Exit 0, check-website ok, check_innerhtml Exit 0, Smoke-Test bestanden
(mit „Senden beim Tippen“), build-site Exit 0.

Knoten-Stand: unverändert.

## Schritt 6.1b1a – Tor in der Desktop-Hülle

Teil b von 6.1 (Sammlung C-23). Der MENSCH hat am 07.10.2026 arti freigegeben (TOR1 A:
Desktop zuerst, Android später). Gemessen vorher: rund +5 MB, 237 neue Rust-Pakete (44
aus dem Tor-Projekt), C-Code (SQLite, liblzma, ring), MIT/Apache-2.0.

**Neu `packages/launcher/src/tor.rs`:** ein SOCKS5-Zugang nach RFC 1928, nur das Nötige:
- ohne Anmeldung (das Webview kann keine), nur CONNECT; BIND und UDP werden abgelehnt;
- Namen gehen als Name an Tor (Adresstyp 3) und werden nie hier aufgelöst; nur saubere
  Namen (Buchstaben, Ziffern, `.-_`), Port 0 abgelehnt;
- höchstens 256 Verbindungen zugleich, Handschlag mit Frist (10 s), nur von 127.0.0.1;
- dahinter eine Verbindungsfunktion: in der Hülle arti (`TorClient::connect`), in den
  Tests eine Attrappe.

**Neu `packages/launcher/src/netz.rs`:**
- Die Wahl Direkt/Tor liegt in `netz.json` bei den Daten der Hülle; fehlt die Datei oder
  ist sie kaputt: direkt. Geschrieben wird erst eine neue Datei, dann umbenannt.
- Mit „Tor“ startet die Hülle arti (Zustand unter `tor/` bei den Daten, Konsens im Cache)
  und den Zugang auf einem Port vom System; das Fenster bekommt ihn als Proxy
  (`socks5://127.0.0.1:<port>`). Startet nichts, bekommt das Fenster trotzdem einen Proxy
  (Port 1) – dann scheitern die Verbindungen, nie geht etwas still direkt hinaus.
- rustls (über arti) braucht einen Krypto-Anbieter, den das Programm festlegt: `ring`
  (stand schon im Lock). Ohne ihn brach die Hülle mit „Tor“ beim Start ab – unter Xvfb
  gefunden. Ein Fehler in arti reißt die Hülle seitdem nicht mehr (`catch_unwind`).
- Kommandos `netz_stand` (verfügbar, gewählt, aktiv, bereit, Fehler als Kennung) und
  `netz_setzen(tor, neustart)` – im App-Manifest und in der Capability. Der Schalter in
  der App folgt mit b1b.
- Nur Desktop: arti steht in `Cargo.toml` nur für Ziele außer Android/iOS; das
  Android-APK wird nicht größer.

**Unter Xvfb geprüft (nur lokale Probe, nicht eingecheckt):**
- Mit `strace -f -Y -e trace=connect` (WebKit-Sandbox dafür aus): Der Netzwerkprozess von
  WebKit verband sich nur mit `127.0.0.1:<Port des Zugangs>` – keine anderen Verbindungen,
  keine DNS-Anfragen, kein UDP. Nach außen verbanden sich nur Threads von arti, zu
  Tor-Relays (ORPorts 9001, 443, auch 53 als TCP).
- Ins Tor-Netz kam arti hier nicht: auch nach 240 s (Release-Bau) nicht „bereit“, auch
  ein arti-Programm allein nicht in 150 s. Die Umgebung lässt die Relay-Verbindungen
  beginnen, aber nicht zu Ende kommen. Den Echtheitstest (`check.torproject.org` meldet
  `IsTor: true`) macht der MENSCH auf einem Gerät.

**Prüfungen:**
- launcher: 34 grün (+8: SOCKS5 6, Netz 2), `cargo clippy --all-targets` ohne Warnung,
  auch für `aarch64-linux-android` (ohne arti).
- protocol 1214 grün (6 übersprungen), node 314 grün (6 übersprungen), app 938 grün,
  Leak 73 grün + 1 todo, mls 13 grün – unverändert, der Schritt ändert nur die Hülle.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1b1b – Tor in der Desktop-App: der Schalter

Teil b von 6.1 (Sammlung C-23, TOR1 A). Seit b1a kann die Desktop-Hülle den Verkehr der
App über Tor leiten; jetzt gibt es den Schalter dafür.

**Neu `packages/app/src/shell/netz-huelle.ts`:**
- `leseNetzStand()` liest die Antwort auf `netz_stand` streng; `netzStand()` nur in der Hülle.
- `netzZeilen()` sagt, wie diese Sitzung läuft – verbunden, verbindet („bis dahin geht
  nichts hinaus“), startet nicht oder erreicht das Tor-Netz nicht („es geht nichts
  hinaus“), direkt („Relays und Dienste sehen deine IP-Adresse“) – und was ab dem
  nächsten Start gilt.
- `setzeTor()` ruft `netz_setzen` mit Neustart; `wireHuellenTor()` zeigt den Schalter nur
  in der Desktop-Hülle mit `verfuegbar` und schaltet nur nach `bestaetige()` um
  (langsamer, Anrufe nicht über Tor, Neustart); scheitert das Speichern, bleibt alles,
  wie es war.

**Settings › Datenschutz:** unter „Verbindung“ der Block „Tor in dieser App: der gesamte
Verkehr über Tor (Desktop)“ – verborgen, bis die Hülle ihn zeigt. „.onion-Relays
bevorzugen“ und die Erklärung der IP-Prüfung sagen jetzt „über Tor (Tor Browser oder Tor
in der Desktop-App)“ statt nur Tor Browser. Datenschutzbericht und Fakten bleiben: Sie
raten schon „Native App oder Tor Browser“, und „verborgen“ meldet weiter nur die
geprüfte .onion-Verbindung (6.2).

**Unter Xvfb in der echten Hülle (nur lokale Probe):** Der Block ist sichtbar, steht auf
„Direkt“; Haken setzen öffnet die Rückfrage, „Neu starten“ speichert `{"tor":true}` in
`netz.json`. Nach dem Neustart steht der Haken, der Stand lautet „Tor: verbindet … bis
dahin geht nichts hinaus.“ (ins Tor-Netz kommt arti hier nicht, siehe 6.1b1a).

**Website:** Die Karte „FreedomStack als App“ nennt Tor auf dem Desktop (langsamer,
Anrufe nicht).

**Prüfungen:**
- app 953 grün (+4: Stand lesen, nur in der Hülle, Texte je Lage, Verdrahtung).
- Leak 73 grün + 1 todo, protocol 1225 grün (6 übersprungen), node 314 grün (6
  übersprungen), mls 13 grün, launcher 34 grün (unverändert).
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1b2a – Tor in der Android-App: die Hülle

Teil b2 von 6.1 (Sammlung C-23, TOR1 A: arti freigegeben 07.10.2026, Desktop zuerst,
Android danach). Seit 6.1b1 geht der Verkehr der Desktop-App auf Wunsch über Tor; jetzt
kann es die Android-Hülle auch.

**arti unter Android:** dieselben Abhängigkeiten wie auf dem Desktop, jetzt für alle
Ziele außer iOS (`Cargo.toml`). arti prüft die Rechte der Ordner über den App-Daten; unter
Android gehören sie dem System (Gruppe schreibbar) – dort ist die Prüfung aus, es schützt
die Sandbox je App (`netz.rs`).

**Der Proxy (`src/android_tor.rs`):** wry setzt unter Android keinen Proxy. androidx.webkit
kann es (`ProxyController`, Merkmal `PROXY_OVERRIDE`, seit WebView 72) – für alle WebViews
der App. Die Hülle ruft es über JNI auf (`jni` 0.21 steckt schon in wry, jetzt direkt
genannt), ohne eigene Java-Klassen: Klassen aus androidx über `find_class()` (Lader der
Activity), Ausführer und Zusage aus der Java-Bibliothek (`FutureTask` um einen leeren
`Thread`); gewartet wird in einem eigenen Thread, höchstens 15 s.

**Nichts vor dem Proxy:** Mit „Tor“ öffnet das Fenster erst eine feste Warteseite der Hülle
(`/tor`, `oberflaeche.rs`: ohne Skript, ohne Bild, CSP `default-src 'none'`, beide
Sprachen) und navigiert erst zur App, wenn androidx.webkit meldet, dass der Proxy gilt.
Kann das WebView keinen Proxy oder läuft die Frist ab, bleibt die Warteseite, der Stand
sagt `proxy` – nie lädt die App dann direkt. Ihr Link „Direkt verbinden“ (`/tor/direkt`,
nur per Klick, nur unter Android) wählt direkt und schließt die App. Ohne Tor prüft die
Hülle beim Start nur, ob ein Proxy ginge (`netz_stand.verfuegbar`; `netz_setzen` lehnt Tor
sonst ab).

**HTTP CONNECT (`tor.rs`):** Der Zugang erkennt am ersten Byte SOCKS5 (Desktop) oder HTTP
(Android). Von HTTP nur `CONNECT host:port HTTP/1.x`: Name als Name an Tor (dieselben
Zeichen wie bei SOCKS5), IPv4 und IPv6 in Klammern, Port 1–65535 nur als Ziffern; andere
Methoden 405 (kein `GET http://…` – nichts geht als Klartext weiter), Kaputtes 400, Kopf
höchstens 8 KB, Byte für Byte gelesen (was danach kommt, geht unverändert durch).
Scheitert Tor: 502. `socks://` hätte Chromium als SOCKS4 gelesen und Namen selbst
aufgelöst – deshalb CONNECT.

**R8:** Der Release-Build entfernt Klassen, die nur JNI ruft – im ersten APK fehlten
`ProxyController`, `ProxyConfig$Builder` und `WebViewFeature` (die App wäre mit Tor auf der
Warteseite geblieben). `packages/launcher/proguard-tor.pro` hält androidx.webkit; die CI
(`launcher.yml`) kopiert die Datei nach `tauri android init` und prüft danach, dass die drei
Klassen im APK stehen. Die Signaturen der JNI-Aufrufe stimmen mit `dexdump` überein.

**Neu starten:** Eine Android-App kann sich nicht selbst neu starten – dort schließt sie
sich (`neu_starten()`), beim nächsten Antippen gilt die neue Wahl. Desktop unverändert.

**Grenzen:** Auf einem Gerät ist das noch nicht geprüft – es gibt hier keinen Emulator
(kein KVM). Den Test mit `https://check.torproject.org/api/ip` macht der MENSCH. Der
Schalter in der App folgt mit 6.1b2b (bis dahin bleibt er unter Android verborgen).

**Prüfungen:**
- launcher 41 grün (+7: HTTP CONNECT ×4, Proxy-Regel und Stand `proxy`, Warteseite, Ausweg),
  clippy `--all-targets -D warnings` sauber.
- Android-APK lokal gebaut (`cargo tauri android build --apk --target aarch64`, ohne
  Warnung, 21,5 MB statt 13,6 MB); androidx.webkit-Klassen im APK, JNI-Signaturen gegen
  `dexdump` geprüft.
- Desktop unter Xvfb mit Tor und `strace`: WebKit verbindet sich nur mit dem eigenen Zugang.
- protocol 1227 grün (6 übersprungen), node 314 grün (6 übersprungen), app 958 grün,
  Leak 73 grün + 1 todo, mls 13 grün – unverändert, der Schritt ändert nur die Hülle.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt 6.1b2b – Tor in der Android-App: der Schalter

Teil b2 von 6.1 (Sammlung C-23, TOR1 A). Seit 6.1b2a kann die Android-Hülle den Verkehr
der App über Tor leiten; jetzt zeigt die App dort auch den Schalter.

**`shell/netz-huelle.ts`:** `wireHuellenTor()` zeigt den Block in jeder Hülle
(`huellenArt()`), weiter nur, wenn die Hülle Tor kann (`netz_stand.verfuegbar` – unter
Android nur mit `PROXY_OVERRIDE` im WebView, im Browser nie). Neu `torRueckfrage()`: Die
Rückfrage sagt je Hülle, was passiert – Desktop „Die App startet neu …“ mit „Neu starten“,
Android „Die App schließt sich. Öffnest du sie wieder, …“ mit „App schließen“ (eine
Android-App kann sich nicht selbst neu starten, 6.1b2a). `leseNetzStand()` kennt den
Fehler `proxy` (das WebView nahm den Zugang nicht an), `netzZeilen()` erklärt ihn.

**Texte:** „Tor in dieser App“ ohne „(Desktop)“; die Erklärung sagt „Umschalten braucht
einen Neustart der App“; „.onion-Relays bevorzugen“ nennt „Tor Browser oder Tor in der App
– Desktop und Android“. Website-Karte „FreedomStack als App“: Tor auf dem Desktop und unter
Android (langsamer, Anrufe nicht).

**Grenzen:** Auf einem Gerät ist das noch nicht geprüft (kein Emulator hier, kein KVM) –
den Test mit `https://check.torproject.org/api/ip` macht der MENSCH.

**Prüfungen:**
- app 959 grün (+1: Rückfrage je Hülle; dazu „proxy“ im Stand und im Text, Verdrahtung
  ohne „nur Desktop“).
- protocol 1227 grün (6 übersprungen), node 314 grün (6 übersprungen), Leak 73 grün +
  1 todo, mls 13 grün, launcher 41 grün (unverändert).
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.
- repro-build reproduzierbar, build-site Exit 0, Smoke-Test bestanden.

## Schritt C-25 – Repo-Auftritt: Banner in der README

Wunsch des MENSCHEN (08.10.2026): Das Repo soll auf den ersten Blick zeigen, worum es geht.
Von drei Entwürfen (Hero, drei Säulen, Social Preview; je Deutsch und Englisch) gewählt:
**Hero, Englisch**.

**Banner (`docs/bilder/banner.png`, 2560×800):** im Stil der Website – Hintergrund #050505,
Akzent #7BC80A, Monospace, Marke „[■] FREEDOM“ wie in der Navigation. Links die Aussage der
Startseite („Message. Use AI. Pay — without an operator.“) mit Unterzeile und Chips
(Lightning, Solana, Nostr, Non-custodial, Open source), rechts das Agent-Fenster mit der
Demo-Szene der Startseite, dahinter dasselbe Partikel-Netz wie im Website-Hero, fest
gewürfelt. Erzeugt mit `scripts/banner.py` (Python-Playwright wie der Smoke-Test, Chromium,
doppelte Auflösung; `--sprache de` für eine deutsche Fassung) – kein Teil der App und des
reproduzierbaren Builds.

**README:** Banner oben (mit Alternativtext), die Zeile zur Hülle sagt jetzt „Linux, Windows
und Android, auf Wunsch über Tor“.

**About-Feld:** Der GitHub-Zugang dieser Sitzung darf Repo-Einstellungen nicht ändern
(„Repository settings writes are not permitted through this proxy“). Beschreibung, Website
und Topics trägt der MENSCH ein; die Werte stehen im Pull Request.

**Offen:** Der Chip „Open source“ (wie auf der Website) gilt streng erst mit einer Lizenz
(Entscheidung LIZ) – ändert sie sich, Banner mit `scripts/banner.py` neu erzeugen.

## Schritt 6.1b3 – Hülle: ein Fehler in arti reißt die App nicht

Gefunden beim Durchsehen von 6.1b1a: Um den Start von arti steht seitdem ein `catch_unwind`
(„ein Fehler in arti reißt die Hülle nicht“). Das Release-Profil der Hülle hatte aber
`panic = "abort"` aus Tauris Vorlage. Damit wirkt `catch_unwind` nicht, und ein Panik in arti
beendete die App, bei gewähltem Tor bei jedem Start. Unter Android ginge es zurück auf
„direkt“ nur über „Daten löschen“, und dann wären Tresor und Verläufe weg. Die Tests merkten
nichts: Tests wickeln immer ab.

**`packages/launcher/Cargo.toml`:** kein `panic = "abort"` mehr im Release, Begründung als
Kommentar.

**`packages/launcher/src/netz.rs`:**
- `melde_ende()`: Das Verbinden mit dem Tor-Netz läuft in einer eigenen Aufgabe. Fehler oder
  Panik ergeben den Stand „bootstrap“; vorher blieb er nach einem Panik auf „verbindet …“
  stehen.
- Ein Panik in einer einzelnen Verbindung trifft nur deren Aufgabe.
- `#[cfg(panic = "abort")] compile_error!(…)`: Der Build bricht ab, wenn die Einstellung
  zurückkommt (auch über `RUSTFLAGS`). Lokal mit einem Probe-Crate geprüft.

**Größe:** Abwickeln kostet Tabellen. Das Android-APK (aarch64, lokal) wächst von 21,5 auf
23,6 MB, die Bibliothek darin von 19,9 auf 22,0 MB. Das ist der Preis dafür, dass ein Fehler in
Tor die App nicht sperrt.

**Prüfungen:**
- launcher 43 grün (+2: Panik beim Verbinden wird „bootstrap“, Release-Profil ohne `panic`);
  clippy sauber.
- APK lokal gebaut, ohne Rust-Warnung.
- check-wiring `--streng` Exit 0, check-website ok, check_innerhtml Exit 0.

## Schritt 7.5d – Meshtastic: Gateway im Knoten per TCP, Smoke-Test

**Knoten:** `FUNK_GATEWAY=meshtastic:host[:4403]` verbindet das Funk-Gateway
direkt mit einem Meshtastic-Gerät mit WLAN (`meshtasticTcp()` in
`gateway-role.ts`, Port 4403 wie die Python-Bibliothek). Es nutzt dieselbe
`MeshtasticSitzung` wie die App, mit Strom `0x94 0xC3`. Je Verbindung fragt es
das Gerät neu und verbindet nach einer Trennung neu. Ohne Kanal „freedom“ geht
nichts hinaus. Was am Gerät fehlt (Kanal samt öffentlichem Schlüssel zum
Abtippen, Region, Senden), steht nur im Log (`meshtasticBefunde()`, Fehler nur
mit Namen); der Knoten legt nichts an. `FUNK_GATEWAY=host:port` bleibt die
TCP-Brücke mit Längenpräfix. Die Gateway-Rolle nimmt Sendezeit, Wartezeit und
Takt von der Strecke (`zeit()`), sonst wie bisher 200 Byte/s.

**Ehrlich nachgerechnet:** Eine KI-Antwort mit 500 Zeichen ist als Umschlag
rund 2,9 KB, also 16 Rahmen. Mit LongFast braucht sie rund 30 s Sendezeit,
nicht „gut 15 s“ (angenommene 200 Byte/s). Bei 1 % schafft ein Gateway damit
etwa eine Antwort je Stunde statt zwei. Korrigiert in:
- Protokoll-Satz `offlineCapabilities()` und App-Fassung.
- Gateway-Karte und Hinweis im Agenten (beide Sprachen).
- FAQ und `CLAUDE.md`.

Der Test in `mesh-sync.test.ts` rechnet jetzt je Rahmen mit
`meshtasticSendezeit()`.

**Doku:**
- `docs/PROVIDER.md`: neuer Abschnitt „Funk-Gateway“.
- `docker-compose.yml`: nennt `FUNK_GATEWAY`.
- GO-LIVE, `docs/MESHTASTIC.md` (Gateway-Zeile, Schritte, Spur B frei).
- Karte 7.5d ✓, FORTSCHRITT (PR-Links 7.5a–c, Hinweis an Spur B: Dateien wieder frei).

**Tests:**
- `node/test/gateway-meshtastic.test.ts` (neu, 3) gegen einen TCP-Server, der wie ein Gerät antwortet. Geprüft wird:
  - Einstellungen, Senden auf Kanal 1, Empfangen nur dort.
  - Sendezeit des Presets.
  - Neu fragen nach Trennung; nach dem Schließen wirft Senden.
  - Ohne Kanal: das Log mit Schlüssel, und nichts geht hinaus.
  - Befunde zu Region und Senden; Adressen.
  - Die Gateway-Rolle bucht und taktet nach der Sendezeit der Strecke.
- Smoke-Test „meshtastic“: Eine Web-Serial-Attrappe antwortet mit Bytes aus der Referenz. Geprüft wird:
  - Erkannt, Hinweis samt Schlüssel, Knopf sichtbar.
  - Abbrechen in der Rückfrage schickt nichts.
  - „Anlegen“ schickt genau `set_channel` aus der Referenz, danach ist der Hinweis weg.
  - Keine Browser-Dialoge.

Gegenprobe: Sechs absichtlich eingebaute Fehler im Gateway macht je ein Test rot. Das sind:
- Sendezeit ohne Strecke.
- Nicht fragen.
- Nicht neu verbinden.
- Keine Befunde.
- Senden ohne Verbindung.
- Andere Port-Grenze.

Im Smoke-Test: Anlegen ohne Rückfrage.

## Schritt 6.1c2a – Downloads: Release von Hand, Website, Linux arm64

Wunsch des MENSCHEN (08.10.2026): Downloads für Linux, Windows und das Handy auf der
Website. Entscheidung dazu: Android nur mit **festem Schlüssel** (den legt der MENSCH an);
bis dahin bietet die Website Linux und Windows an, Android „folgt“. Desktop als
unsignierte Vorschau – freigegeben mit dieser Entscheidung.

**`.github/workflows/launcher.yml`:**
- Linux auch für arm64 (`ubuntu-24.04-arm`, z. B. für NVIDIA DGX Spark). Artefakte und
  Cache tragen jetzt die Architektur im Namen. Fehlt Rust im Abbild, kommt es über
  rustup.
- Der Android-Job legt zusätzlich das unsignierte APK ab – für den festen Schlüssel
  im Release.
- Neuer Job „veroeffentlichen“: nur über „Run workflow“ mit Haken und nur auf `main`
  (wie der Spiegel). Er hängt an allen Bau-Jobs und prüft die Pakete gegen deren
  `SHA256SUMS`. Danach benennt er sie fest (`freedom-linux-x64.AppImage` … `freedom-windows-x64-setup.exe`),
  signiert das APK mit dem festen Schlüssel aus den Secrets und legt das Release
  `app-v<version>-<lauf>` mit `SHA256SUMS` und ehrlichen Notizen an.
- Die Secrets liest nur dieser eine Schritt, das Passwort geht über `env:` an
  `apksigner` und nie auf die Befehlszeile. v4-Signatur aus, sonst läge eine
  `.idsig` im Release.
- Fehlen die Secrets, kommt das Release ohne APK – nie mit dem Wegwerf-Schlüssel.
  Mit dem ginge jedes Update nur nach dem Deinstallieren, und Tresor und Verläufe
  wären weg.

**Website (`#downloads`):** je eine Zeile für Linux (AppImage/.deb, x64/arm64), Windows
(Installer, Hinweis auf die SmartScreen-Warnung) und Android (folgt mit dem festen
Schlüssel). Dazu: neue Versionen über die alte installieren, Daten bleiben;
`SHA256SUMS` und alle Versionen verlinkt. Mobil brechen die Knöpfe um.

**`scripts/check-website.py`:** Download-Links nur unter
`github.com/3DAGI/freedom-app/releases/latest/download/` und nur mit Namen, die der Job
erzeugt. Die Namen liest das Skript aus `launcher.yml`, sonst zeigte die Seite auf eine
Datei, die es nie gibt. Geprüft mit drei falschen Links (falscher Name, fremdes Repo,
Test-APK): alle abgewiesen.

**Lokal geprüft:** die drei Skripte des Jobs mit nachgebauten Artefakten.
- Namen und Summen stimmen.
- Ohne Secrets: Warnung, kein APK.
- Mit einem Wegwerf-Schlüssel nur für die Probe: APK signiert und geprüft,
  Schlüsseldatei danach gelöscht.
- Die Notizen nennen den Fingerabdruck des Zertifikats.

Website gebaut und auf Desktop und Handy angesehen.

**Gefunden, nicht Teil des Schritts:** Die Startseite ist auf dem Handy (390 px) 479 px
breit – schon auf `main`, nicht durch diesen Schritt.

**Offen:** Den festen Schlüssel legt der MENSCH an (Anleitung in
`packages/launcher/README.md`). Danach ein Release von Hand, dann zeigt die Website
Android. Für Linux und Windows muss das erste Release laufen, sobald das hier gemergt
ist – bis dahin führen die Links ins Leere.

## Schritt 11.3a, E9, D3 – Entscheidungen vom 08.10.2026 eingetragen

Spur A, nur Doku. Der MENSCH hat am 08.10. drei Entwürfe freigegeben. Damit die
anderen Spuren daran arbeiten können, stehen die Entscheidungen jetzt in den
Entwürfen, in `FORTSCHRITT.md` (Spur A, Hinweise an B und C) und in der Sammlung.

**11.3a Agenten in Räumen** (`docs/AGENTEN-RAUM-ENTWURF.md`, neuer Abschnitt
„Entscheidungen vom 08.10.2026“):
- **F1 A, F4 A, F6 A.**
- **F2: Monatsbudget mit Pfand.** Der Einlader zahlt in einen Zahlkanal zum Knoten
  ein (30 Tage). Gutschriften gehen in Stufen hinaus, Standard 10 % des Budgets.
  Nach Ablauf kommt der Rest von selbst zurück (`refund`, Z1). Neu eingezahlt wird
  nur auf Klick. Nur SOL, erst nach dem Devnet-Deploy; mit sats zahlt die App des
  Einladers je Antwort, solange sie offen ist.
- **F5: Agentenketten mit Schalter** (Wunsch MENSCH: Agenten sollen sich beim
  gemeinsamen Arbeiten abstimmen). Standard aus. Jede Kette beginnt bei einem
  Menschen, Grenze 10 (höchstens 50) Agenten-Antworten bis zur nächsten Nachricht
  eines Menschen. Agenten antworten Agenten nur aus einem Budget – Knoten zahlen
  nichts.
- **F3 B** (nachgereicht am 08.10.): Agenten auf dem Gerät zahlt, wer sie anlegt.
  Ein Grund mehr für B: Mit F4 A kennt nur das Gerät des Erstellers die Persona.
- **Seit dem Entwurf geändert (gilt beim Bau):**
  - B-22: Jeder in offenen Räumen kann erwähnen.
  - D1c: Kontext nach `VERLAUF_UMFANG`.
  - D1b2: Sitzungsschlüssel je Agent und Raum.
  - 12.4a: Mit SOL zahlt KI nur über einen Kanal.

**E9** (`docs/E9-ENTWURF.md`): wie vorgeschlagen (V1–V3 A, F1–F6 ja).
- Den KI-Teil von E9-2 (Gratis-Werte im Angebot) baut schon A-14 (G1); E9-2
  macht nur den Speicher.
- E9-3 „Modelle laden“ gehört Spur B und kann sofort beginnen, mit Manifesten vom
  eigenen Schlüssel.
- E9-5 erst mit zwei Geräten.

**D3** (`docs/D3-ENTWURF.md`, Nachtrag):
- Freigegeben: V1 und V3–V6 A, F3–F5 wie vorgeschlagen.
- Gemessen am GX10: Secure Boot an, kein TPM, kein EK-Zertifikat. Damit gibt es
  dort kein Siegel. D3 ruht und ist später optional (MENSCH) – nur auf Wunsch
  und mit einem Testgerät mit TPM 2.0.
- Zwei Korrekturen am eigenen Entwurf, neu vorzulegen:
  - V2: PCR 7 ist je Hersteller verschieden – nur PCR 11 fest, PCR 7 über das
    Startprotokoll.
  - V7: Ein Update kostete den Schlüssel – Wege (a) bis (c), Tendenz (b) Übergabe
    per Mandat.
- `docs/DATENSCHUTZ-PROVIDER.md` nennt den GX10 nicht mehr als Gerät für das
  Siegel.

**Prüfungen:** nur Doku – `check-website.py` und `check-wiring.py --streng`
gelaufen (Exit 0). Kein Code, keine Tests geändert. Knoten-Stand: unverändert.

## Schritt A-14a – Gratis-Start: Knoten und Protokoll

Spur A, Entscheidung G1 vom 08.10.2026 (Nutzertest, Befund A-1). Die Vorgabe
„Classic“ schickte ein Gebot, und neue Knoten lehnten es in der Bootstrap-Phase
ab. Für private Anfragen gab es kein Kontingent: Mit „Free“ war es unbegrenzt
gratis, nur mit 12 Bit Rechenarbeit. A-14 ist geteilt: a Knoten und Protokoll
(hier), b App.

**Protokoll (`gratis.ts`, neu):**
- `GRATIS_VORGABE`: 100 000 Tokens am Tag, 2 000 je Antwort, 16 Bit.
- Tag `["gratis", <Tag>, <je Antwort>, <Bits>]` im Angebot 38027 (`tiers.ts`),
  gebaut mit `gratisTag()`, gelesen streng mit `leseGratisTag()`.
- `gratisAusUmgebung()` liest `GRATIS_TOKENS_TAG` (0 = aus),
  `GRATIS_TOKENS_JE_ANTWORT` und `GRATIS_POW_BITS`. Ein unbrauchbarer Wert
  ergibt einen Grund.
- Kennung `GRATIS_LEER` = `gratis-leer`.
- `docs/PROTOCOL.md` §30.

**Knoten (`dvm-provider.ts`, `inference.ts`, `main.ts`):**
- Budget je Tag (UTC) für alle zusammen (`gratisRest()`). Es zählt Frage und
  Antwort aus der eigenen Abrechnung und liegt nur im Speicher.
- Eine Gratis-Antwort hat höchstens `tokensJeAntwort` und läuft ohne Werkzeuge
  des Modells (`ohneWerkzeuge`). Sonst ruft Ollama selbst Werkzeuge auf, bis zu
  fünf Runden, jede wieder mit `maxTokens`.
- Werkzeuge und Schwarm gibt es gratis nicht.
- Private Gratis-Anfragen müssen die Bits aus dem Angebot tragen. Die
  Rechenarbeit jedes Umschlags merkt sich der Knoten beim Öffnen.
- Ist das Budget leer, lehnt er mit `GratisLeer` ab; die Rückmeldung trägt
  `["fall", "gratis-leer"]`. „Gerade gratis“ (`free`) ist dann aus.
- In der Bootstrap-Phase bedient er Gebote gratis, nach derselben Regel.
  Gutschriften und Sitzungen lehnt er dort weiter ab, weil eine Gutschrift auch
  später gälte.
- `main.ts`: Bei ungültigen Werten startet der Knoten nicht. Die Werte stehen
  im Log und im Angebot. Ohne `gratis` in der Konfiguration gilt die alte Regel.

**Doku:**
- `docs/PROVIDER.md`, Abschnitt „Gratis-Start“.
- `docker-compose.yml`: `GRATIS_*`, leer heißt Vorgabe.
- `docs/FREEDOM-PRUEFUNG.md` 3.4: Probezeit.
- `CLAUDE.md`: Regel und Stand.

**Tests:**
- `node/test/gratis-budget.test.ts` (+6):
  - Grenze je Antwort und keine Werkzeuge.
  - Budget mit Frage und Antwort; `gratis-leer` versiegelt; am nächsten Tag
    wieder voll.
  - Zu wenig Bits (ein Umschlag mit sicher zu wenig – die Rechenarbeit ist
    „mindestens“).
  - Werkzeuge und Schwarm.
  - Bezahlte Anfragen unverändert.
  - Bootstrap mit Gebot.
  - Versiegelte Antwort.
- `protocol/test/gratis.test.ts` (+4): Vorgabe, hin und zurück auch über das
  Angebot, zwölf fremde Unsinnsfälle, Umgebung.
- `bootstrap.test.ts`: Ein Gebot in der Bootstrap-Phase wird jetzt gratis
  beantwortet statt abgelehnt. Das ist von G1 verlangt, kein Abschwächen –
  der Test prüft die neue Regel genauso streng.

**Prüfungen:**
- protocol 1231 grün (+4), 6 übersprungen; node 323 grün (+6), 6 übersprungen;
  app 959.
- Leak 73 + 1 todo; mls 13.
- check-wiring `--streng`, check-website und innerHTML streng: Exit 0.

**Knoten-Stand:** Der GX10 braucht diesen Stand, aber erst zusammen mit A-14b.
Die Live-App schickt Gratis-Fragen noch mit 12 Bit; ein aktualisierter Knoten
lehnte sie bis dahin ab.

## Schritt 6.1d – Kamera und Mikrofon in der Hülle

Gefunden bei der Frage, ob man mit dem Handy den eigenen Knoten koppeln kann: In der
Android-App ging die Kamera nicht. Damit ging auch kein QR-Scan für den Kopplungscode, kein
Mikrofon für Sprachnachrichten und kein Anruf. Unter Linux war es genauso.

**Ursachen:**
- **Android:** Im Manifest aus Tauris Vorlage steht nur `INTERNET`. Android lehnt eine
  Anfrage nach Rechten ab, die das Manifest nicht nennt – bevor der Nutzer gefragt wird.
- **Linux:** WebKitGTK lehnt Kamera und Mikrofon still ab, wenn niemand die Anfrage
  beantwortet. Eine Nachfrage gibt es dort nicht.
- **Windows:** WebView2 fragt selbst nach. Das ging schon.

**Neu `packages/launcher/src/erlaubnis.rs`:**
- Antwort auf jede Anfrage des Webviews (`on_permission_request` in `lib.rs`), nur für die
  eigene Oberfläche (`darf_navigieren()`); fremde Seiten bekommen nichts.
- Kamera und Mikrofon: unter Linux erlaubt, sonst `Default` – Windows und Android fragen
  selbst nach.
- Alles andere bleibt, wie das Webview es hält: Standort, Meldungen, Bildschirm.
- Die App fragt Kamera und Mikrofon ohnehin nur auf Klick an.

**Neu `scripts/android-rechte.py`:**
- Trägt nach `tauri android init` genau `CAMERA`, `RECORD_AUDIO` und
  `MODIFY_AUDIO_SETTINGS` ins Manifest ein, dazu Kamera und Mikrofon als nicht nötige
  Hardware. So behalten Geräte ohne Kamera die App.
- Läuft auch ein zweites Mal ohne Änderung durch; `--pruefen` prüft nur.

**`launcher.yml`:** ruft das Skript und prüft danach im APK mit `aapt2 dump permissions`,
dass die drei Rechte drin sind.

**Grenze:** Den QR-Code erkennt die App über `BarcodeDetector`. WebKitGTK kennt ihn nicht,
das Android-WebView je nach Gerät. Dann bleibt der Hinweis zum Einfügen – auch für den
Kopplungscode. Gerätetest: MENSCH.

**Prüfungen:**
- launcher 45 grün (+2: Kamera und Mikrofon für die eigene Oberfläche, fremde Seiten
  bekommen nichts); clippy sauber.
- Skript: vorher „fehlt“ (Exit 1), danach vollständig (Exit 0), zweiter Lauf ohne
  Änderung, XML gültig.
- APK lokal mit den neuen Rechten gebaut (siehe Pull Request).

## Schritt C-26 – Website mobil: Befehle scrollen im Kasten

Gefunden bei 6.1c2a: Die Startseite war auf dem Handy 479 px breit statt 390. Man konnte
sie seitlich schieben.

**Ursache:** Die Befehle zum Kopieren im Abschnitt „Rechenzeit vermieten“ stehen in
`pre.mono`. Sie brechen nicht um, und ein Rasterfeld darf nicht schmaler werden als sein
Inhalt (`min-width: auto`). So schob der längste Befehl die ganze Seite breiter. Auf dem
Desktop liefen die Befehle über den schwarzen Kasten hinaus.

**`packages/website/css/style.css`:**
- `pre.mono { overflow-x: auto; }`: Befehle bleiben eine Zeile und scrollen im Kasten.
  Beim Kopieren kommt der Befehl so heraus, wie er dasteht.
- `.grid > * { min-width: 0; }`: Rasterfelder dürfen schmaler werden als ihr Inhalt.

**Geprüft:**
- Alle fünf Seiten (Start, FAQ, Roadmap, Whitepaper, Status) bei 360 und 390 px gebaut
  und gemessen: keine Seite breiter als der Bildschirm (vorher Start 479 px).
- Abschnitt auf Handy und Desktop angesehen.
- check-website ok.

## Schritt A-14b1 – Gratis-Start: Gratis-Fragen der App passend zum Knoten

Spur A, G1 vom 08.10.2026. Mit A-14a verlangt der Knoten für Gratis-Fragen die
Bits aus seinem Gratis-Angebot (Vorgabe 16) und lehnt mit `gratis-leer` ab,
wenn sein Budget verbraucht ist. Die App schickte Gratis-Fragen noch mit 12 Bit,
und zwar an jeden Provider. Den Wert `free` aus dem Angebot las sie nicht.

**App:**
- `gratis-kontingent.ts` (neu):
  - Kontingent je Gerät: 20 Antworten oder 20 000 Tokens am Tag (UTC), was
    zuerst erreicht ist (`GeraeteKontingent`, streng gelesen).
  - Tokens zählt `tokensDerAntwort()` aus der bereinigten Abrechnung, je
    Antwort begrenzt.
  - Die Rechenarbeit liefert `powFuerAnfrage()`.
  - `gratisKandidaten()`: nur Provider mit `free` und machbaren Bits. Knoten vor
    A-14a ohne Tag `gratis` bleiben dabei.
- `shell/gratis-start.ts` (neu):
  - `geraeteKontingent` liegt in `geheim`, der Schlüssel steht in
    `GEHEIM_FEST`, nie in der Sicherung.
  - Dazu `gratisJeProvider` und `zaehleGratisAntwort()`.
- `agent.ts`:
  - `privatFaehig()` merkt sich die Gratis-Angebote.
  - `buildJobEvent()` rechnet bei Gebot 0 die Bits aus dem Gratis-Angebot,
    beim eigenen Knoten nicht.
  - `askAi()` prüft vor dem Senden das Kontingent: Ist es aufgebraucht, geht
    nichts hinaus, ein Hinweis erscheint, und die Einstiegsleiste fragt nach
    der Wallet.
  - `waitForAnswer()` liefert die Kennung `fall` der Ablehnung.
- `agent-wege.ts`:
  - Gratis-Fragen gehen nur an Gratis-Anbieter.
  - Bei `gratis-leer` ein eigener Hinweis, dann der nächste Provider. Sind alle
    leer oder bietet keiner gratis an, sagt die App genau das.
  - Gezählt wird nach der Antwort.
- **Texte:** de/en `agent.gratisGeraetLeer` („Fairness-Regel, keine Sperre“),
  `agent.gratisLeer`, `agent.gratisLeerProvider` und `agent.keinGratisProvider`.
  Einstieg (`ein.losGratis`) und FAQ nennen die 20 Antworten je Gerät.

**Tests:** `gratis-kontingent.test.ts` (+7) prüft:
- Vorgabe, strenges Lesen und nächster Tag;
- 20 Antworten bzw. vorher 20 000 Tokens;
- Tokens aus der Abrechnung;
- Auswahl und Bits;
- die Verdrahtung: Prüfung vor dem Senden, Bits nie beim eigenen Knoten,
  Kennung am Tag, gezählt nach der Antwort;
- nur in `geheim`, nicht in der Sicherung.

`kontakt-pruefung.test.ts` erwartet `freedom.kontakte.geprueft` als letzten
Eintrag von `GEHEIM_FEST` – der neue Schlüssel steht deshalb davor.

**Prüfungen:**
- app 966 grün (+7); protocol 1231 und node 323 unverändert.
- Leak 73 + 1 todo, mls 13.
- check-wiring `--streng`, check-website und innerHTML streng: Exit 0.

**Knoten-Stand:** Ab jetzt darf der GX10 auf `main` (A-14a): Die App schickt
Gratis-Fragen mit den verlangten Bits. Offen bleibt A-14b2: Tarif „Automatisch“
als Vorgabe und eine Rückfrage vor dem ersten Bezahlen.

## Schritt A-14b2 – Gratis-Start: Tarif „Automatisch“, Rückfrage vor dem ersten Bezahlen

Spur A, G1 vom 08.10.2026: Die App hat den Tarif „Automatisch“, und er ist die
Vorgabe. Bezahlt wird nie still: vorher einmal fragen. Damit ist A-14 im Code fertig.

**App:**
- **`gratis-kontingent.ts`:**
  - `waehleAuto()` (ohne DOM, getestet) entscheidet:
    - gratis, solange das Gerät Kontingent hat und ein Gratis-Anbieter da ist;
    - sonst bezahlt, das erste Mal nur nach Rückfrage;
    - ohne Wallet nie.
  - `tierFuerListe()` sorgt dafür, dass die Modell-Liste unter „Automatisch“ alles
    zeigt, was gratis geht und darüber.
- **`shell/gratis-start.ts`:**
  - `merkeGratisLeer()`/`gratisAnbieter()`: Wer heute `gratis-leer` gemeldet hat,
    bekommt bis morgen (UTC) keine Gratis-Frage. Sein Angebot sagt es erst mit der
    nächsten Erneuerung, sonst liefe „Automatisch“ immer wieder in dieselbe Absage.
  - Die Zustimmung zum Bezahlen steht in `freedom.gratis.bezahlenOk` und gilt nur
    auf diesem Gerät.
- **`shell/zahlschienen.ts`:** `eineSchieneDa()` prüft, ob eine Schiene zahlen
  kann.
- **`agent.ts` `askAi()`:**
  - „Automatisch“ wird vor dem Kontingent und vor dem Senden entschieden.
  - Ohne Wallet: Hinweis, Frage nach der Wallet, nichts geht hinaus.
  - Erstes Bezahlen: Rückfrage `bestaetige()` mit dem Gebot in der Anzeigeeinheit.
    Abgelehnt heißt: nichts geht hinaus, die Frage bleibt im Feld.
  - Über Funk heißt „Automatisch“ nur gratis.
- **`index.html`:** `auto` ist die Vorgabe, `classic` nicht mehr.
- **Texte (de/en):** `tierAuto`, `agent.autoTitel`, `agent.autoFrage*`,
  `agent.autoOk`, `agent.autoWallet*`. Die FAQ nennt die Rückfrage.

**Tests:**
- `gratis-kontingent.test.ts` (+2):
  - Entscheidungstabelle;
  - Verdrahtung: Vorgabe, entschieden vor Kontingent und Senden, erst gefragt
    dann gemerkt, abgelehnt heißt nichts hinaus, Funk nur gratis, leere Provider
    gemerkt.
- Die b1-Prüfung erwartet jetzt `gratisAnbieter()` (baut auf `gratisKandidaten()` auf).
- **Smoke-Test „gratis_auto“ (neu):** Vorgabe `auto`. Ohne Gratis-Anbieter und ohne
  Wallet kommt der Hinweis, die Frage bleibt im Feld, es gibt keinen Dialog und
  nichts geht ans Relay.
- **Gegenprobe:** Mit „Rückfrage auch ohne Wallet“ wird der Smoke-Test rot
  (Dialog statt Hinweis).

**Prüfungen:**
- app 968 grün (+2); protocol 1231 und node 323 unverändert.
- Leak 73 + 1 todo, mls 13.
- check-wiring `--streng`, check-website und innerHTML streng: Exit 0.
- Smoke bestanden.

**Auslegung:** „einmal fragen“ heißt einmal je Gerät. Danach zahlt „Automatisch“
nach dem Gratis-Anteil ohne neue Rückfrage, mit Gebot und Tageslimit der Wallet
wie bisher. Wer nur gratis will, wählt „Free“.

## Schritt E9-3a – Modelle laden im Knoten: Manifest, Prüfung, Angebot

Freigabe des MENSCHEN vom 08.10.2026: E9 wie vorgeschlagen (V1–V3 A, F1–F6 ja).
Für E9-3 heißt das: sofort beginnen, mit Manifesten vom eigenen Schlüssel;
Kuratoren über Kataloge kommen mit E9-4 (Spur A). Aufgeteilt: E9-3a lädt, prüft
und bietet an; E9-3b bringt die Selbstprüfung mit eigenen Kennungen und den
Fortschritt im Status des eigenen Knotens (B-11).

**Protokoll** (`modell-ollama.ts`):
- `leseOllamaName()`: Namen wie bei Ollama (`name:tag`, `ns/name:tag`, ohne Tag
  `latest`); ein Host davor (`hf.co/…`) gilt nicht. Dazu `registryAdresse()`.
- `ollamaQuelle()`: nur `upstream` = `ollama:<derselbe Name wie model>`.
- `ollamaDateien()`: Dateien aus dem Manifest der Registry (Docker-Format v2) –
  Schichten und Konfiguration, benannt `sha256-<hex>`.
- `pruefeSchichten()`: genau die Dateien des Manifests – jede über
  `verifyFile()`, Größe gleich, keine fremde, keine fehlende.
- `vertrautesManifest()`: nur eigener Schlüssel und vertraute Kuratoren (bis
  E9-4 keine), je Schlüssel das neueste, das eigene geht vor, bei Streit keine Wahl.

**Knoten** (`modell-laden.ts`, verdrahtet in `main.ts`):
- `npm run modell -- <name>` merkt nur vor (`~/.freedom/modell-wunsch.json`, 0600).
  Ohne Namen zeigt es den Stand. Es verbindet sich mit keinem Relay –
  Verbindungen entstehen nur in `main.ts` (Tor, 8.2c).
- Mit `--aus-registry` hält der Knoten fest, was die Registry jetzt nennt: Er
  signiert daraus ein eigenes Manifest und veröffentlicht es über den Pool
  (`festhalten()`). Spätere Ladevorgänge prüfen dagegen; eine neue Fassung in
  der Registry braucht ein neues Festhalten.
- `ModellDienst` sieht einmal je Minute nach und arbeitet einen Wunsch nach dem
  anderen ab:
  1. Manifest über die Relays des Knotens (oder eben festgehalten), gewählt
     mit `vertrautesManifest()`.
  2. Passt das Modell in den Speicher (`fitsOnDevice()`, `MODELL_SPEICHER_GB`)?
  3. Vorprüfung gegen `registry.ollama.ai`: nennt sie andere Dateien, wird nichts
     geladen.
  4. Ollama lädt (`/api/pull`); Ollama prüft jede Schicht gegen ihre Summe.
  5. `pruefeSchichten()` gegen die Schichten, die Ollama gemeldet hat.
  6. Gemerkt mit dem Fingerabdruck aus `/api/tags` (`~/.freedom/modelle.json`,
     0600).
- Angebot: `PROVIDER_MODELS` wie bisher, dazu die geprüften – nur, solange Ollama
  unter dem Namen denselben Fingerabdruck nennt (`imAngebot()` bei jedem
  Angebot). Kam ein Modell dazu, gleich ein neues Angebot.
- Der Provider nimmt Modelle aus `cfg.modelle()`. Bisher las er nur
  `PROVIDER_MODELS` – ein geprüftes Modell wäre sonst zwar angeboten, aber
  nicht genutzt worden.
- Ins Log nur Name und Kennung (`fall`); von Ollama nur der Fehlername.

Zuerst hatte ich daneben eine Liste vertrauter Herausgeber (`MODELL_HERAUSGEBER`)
gebaut. Die Freigabe vom 08.10. sieht Kuratoren nur über Kataloge vor (E9-4) –
die Liste ist wieder draußen, eine zweite Vertrauensquelle gibt es nicht.

**Im echten Knoten geprüft** (`main.ts` mit eigenem Relay, Ollama-Attrappe mit
`/api/pull` als NDJSON wie Ollama; `registry.ollama.ai` ist aus dieser Umgebung
nicht erreichbar, für den Lauf lieferte ein vorgeladenes Skript ein
Registry-Manifest):
1. Nur das Manifest eines Kurators: `nicht angeboten (manifest.keins)`, kein
   Download; `npm run modell` nennt den Weg mit `--aus-registry`.
2. `--aus-registry`: einmal die Registry gefragt, eigenes Manifest am Relay
   (3 Dateien, Schlüssel des Knotens), Ollama lädt, geprüft; das neue Angebot
   (38027) nennt `basis:1` und `qwen2.5:0.5b`.
3. Erneut ohne `--aus-registry`: gegen das Festgehaltene geprüft und geladen.
4. Registry nennt eine andere Modell-Schicht: `nicht angeboten (registry.anders)`,
   kein Download; die geprüfte Fassung bleibt im Angebot.

Eine Live-Probe gegen die echte Registry und ein echtes Ollama macht der MENSCH.

**Prüfungen** (nach dem Einmergen von A-14a): protocol 1237 grün (+6, 6 übersprungen),
node 333 grün (+11, ohne Netz 7 übersprungen; mit Netz 334), app 959 grün, Leak 73 grün
+ 1 todo, mls 13 grün;
check-wiring `--streng` Exit 0 (zwei Ausnahmen entfernt: `verifyFile`, `fitsOnDevice`),
check-website ok, check_innerhtml Exit 0, Smoke-Test bestanden, build-site Exit 0.

Knoten-Stand: neu (E9-3a). Ohne Update bleibt alles wie bisher – `npm run modell`
gibt es dann noch nicht.

## Schritt A-14b3 – Gratis-Start: Rückfrage vor dem Bezahlen jeden Tag

Spur A, Entscheidung MENSCH vom 09.10.2026 zur offenen Frage aus A-14b2: „Man hat
jeden Tag wieder den Wechsel von gratis auf zu zahlen – natürlich jeden Tag, wenn
es passiert.“ Bisher galt die Zustimmung im Tarif „Automatisch“ einmal je Gerät,
jetzt nur für den Tag (UTC) – wie das Kontingent je Gerät.

**App:**
- `gratis-kontingent.ts`:
  - `zustimmungGilt()` gilt nur für den heutigen Tag. Was anderes gespeichert ist,
    auch die frühere „1“, gilt nicht.
  - `zustimmungFuer()` liefert den Tag, der gemerkt wird.
- `shell/gratis-start.ts`: `autoZugestimmt()`/`merkeAutoZustimmung()` lesen und
  merken nur darüber.
- Texte (de/en): „Gefragt wird heute nur dieses eine Mal, morgen wieder beim
  Wechsel“; ohne Wallet: „bevor sie bezahlt, fragt die App einmal am Tag“. Die FAQ
  sagt „jeden Tag“.

**Tests:** `gratis-kontingent.test.ts` (+1) prüft:
- später am selben Tag gilt die Zustimmung, am nächsten Tag nicht;
- `null`, „1“ und ein anderer Tag gelten nicht;
- gelesen und gemerkt wird nur über die beiden Funktionen.

**Prüfungen:** app 969 grün (+1); protocol, node, Leak, mls, Skripte, Build und
Smoke wie im Pull Request.

## Schritt B-23 – Knoten nur mit eigenem Relay hört live mit (Nutzertest, K-1)

Auftrag des MENSCHEN vom 09.10.2026: die Befunde aus dem Nutzertest vom 08.10.
als Schritte anlegen und abarbeiten. Die Sammlung hat dafür Anhang D mit allen
Befunden und einem Vorschlag, welche Spur sie übernimmt. Spur B bekommt
B-23 bis B-28; die übrigen übernehmen Spur A und Spur C in ihre Abschnitte
(Regel „Ergänzen“ – neue Punkte nur im eigenen Abschnitt).

**Befund K-1:** `RelayRole.alsRelay()` (B-9c1) hatte `publish` und `query`, aber
kein `subscribe`. Ein Knoten, der nur sein eigenes Relay nutzt, meldete
„Kein Relay unterstuetzt Dauer-Abos“ und lief im Abfrage-Betrieb – jede
KI-Anfrage wartete bis zum nächsten Takt (Standard 15 s).

**Knoten** (`relay-role.ts`):
- `alsRelay()` bekommt `subscribe`: erst die gespeicherten Treffer, dann
  `onEose`, danach jedes neue Event – wie ein REQ über das Netz.
- Dieselben Regeln: ein Filter auf Umschläge an andere wirft
  `auth-required` (wie `CLOSED`), geliefert wird nur, was `darfAusliefern()`
  erlaubt.
- `verteile()` stellt nach den WebSocket-Abos auch die Abos im Prozess zu, per
  Mikrotask: Wer im Abo selbst veröffentlicht, landet nicht mitten im
  Durchlauf; ein Fehler des Empfängers bleibt dort.
- `stop()` leert die Abos.

**Im echten Knoten geprüft** (`main.ts`, `RELAYS` = nur die eigene Adresse,
Ollama-Attrappe, Gratis-Anfrage über das Relay mit Wegwerfschlüsseln):

| | Log | Antwort nach |
|---|---|---|
| vorher | „Kein Relay unterstuetzt Dauer-Abos … Abfrage-Betrieb“ | 12 235 ms |
| mit B-23 | „Dauer-Abo aktiv — Jobs kommen ohne Verzoegerung an“ | 326 ms |

**Tests** (`relay-intern.test.ts`, +3; ohne die Änderung alle drei rot):
- Abo: erst Gespeichertes, dann Neues über das Netz und aus dem Prozess;
  keine fremden Umschläge, keine doppelten, nach dem Beenden nichts mehr.
- Regeln: Umschläge an andere sind nicht zu abonnieren; ein werfender
  Empfänger hält weder den Relay noch andere Abos auf.
- Provider: `subscribeJobs()` gelingt nur mit dem eigenen Relay, die Anfrage
  kommt ohne `pollOnce()` an.

Knoten-Stand: neu (B-23). Ohne Update läuft ein Knoten nur mit eigenem Relay
weiter im Abfrage-Betrieb.

## Schritt Übergaben 09.10. – Arbeit für Spur B und C, C-22b freigegeben

Spur A, nur Doku. B und C hatten nichts mehr in ihrer Spur und warteten auf
Spur A. Der MENSCH hat am 09.10. diese Übergaben und C-22b freigegeben.

Am selben Tag kam der Nutzertest von Spur B dazu (B-23, Anhang D der Sammlung).
Die Reihenfolge berücksichtigt ihn: Befunde aus dem Test zuerst.

**An Spur B** (nach E9-3b und B-24 bis B-28, in dieser Reihenfolge):
- E9-4: Katalog 38080 mit Verweis aufs Manifest; damit kommen Kuratoren in
  `vertrautesManifest()`.
- E9-2: nur Speicher, als vierter Wert im `storage`-Tag; `network-capacity.ts`
  fällt weg.
- E9-1: `cluster.ts` aufräumen.
- Danach 11.3d (Agent auf dem Knoten), sobald 11.3b gemergt ist.
- Regeln in `docs/E9-ENTWURF.md`, neuer Abschnitt „Übergabe vom 09.10.2026“;
  `phase-11.md` nennt bei 11.3d jetzt Spur B.

**An Spur C:**
- Zuerst der schwere Befund C-1/C-13 (Senden am Handy außerhalb).
- Dann C-22b. Regeln in der Sammlung bei C-22: nur verschieben, die Wurzel
  behält, was jede Sitzung braucht; `STATUS.md` je Monat ins Archiv.
- Dann die übrigen Befunde mit Spur C aus Anhang D, als eigene C-Punkte.
- C-27 (neu in der Sammlung): Anzeige des Gratis-Starts – Kontingent des Geräts
  und Gratis-Anbieter. A-14 hatte keine Anzeige gebaut.
- E10b: Kopfgeld per Klick (Regeln in der Sammlung bei A-9).
- 12.4b samt Schalter (Regeln bei A-1). E5 ist dafür geändert: hier baut Spur C
  Logik und Oberfläche.
- Danach 11.3e.

**Spur A:** übernimmt aus dem Nutzertest A-15 „Chat empfängt live“ (C-12, C-6) und
A-16 „Weniger Verbindungen“ (N-1) – beide zuerst. Dann 11.3b – das gibt
11.3d (B) und 11.3e (C) frei –, dann 11.3c.

**Während C-22b offen ist:** Neue Fallstricke kommen wie bisher unten in
`CLAUDE.md`. Wer danach `main` einmergt, trägt sie in die Datei des Bereichs um.
Kein Skript und keine CI liest `CLAUDE.md` oder `STATUS.md` (geprüft mit `grep`).

**Prüfungen:** nur Doku – `check-website.py` und `check-wiring.py --streng`
(Exit 0). Kein Code, keine Tests geändert. Knoten-Stand: unverändert.

## Schritt C-22b – `CLAUDE.md` je Bereich, `STATUS.md` je Monat

Spur C, Sammlung C-22 b, freigegeben 09.10.2026 (MENSCH). Regeln bei C-22: nur
verschieben, nichts umformulieren, nichts weglassen.

**`CLAUDE.md`:** In der Wurzel bleibt, was jede Sitzung braucht (Projekt, Aufbau,
Befehle, Stand, Arbeitsweise, drei Agenten, Definition of Done, STOPP, Verboten)
und die Fallstricke, die mehrere Pakete betreffen. Was man nur in einem Bereich
falsch macht, steht jetzt in der `CLAUDE.md` dieses Bereichs. Claude Code lädt sie,
sobald eine Datei darin gelesen wird:

| Datei | Einträge |
|---|---|
| `CLAUDE.md` (Wurzel) | 48 |
| `packages/app/CLAUDE.md` | 56 |
| `packages/node/CLAUDE.md` | 13 |
| `packages/protocol/CLAUDE.md` | 2 |
| `packages/mls/CLAUDE.md` | 1 |
| `packages/launcher/CLAUDE.md` | 1 |
| `packages/website/CLAUDE.md` | 2 |
| `contracts/CLAUDE.md` | 2 |
| `scripts/CLAUDE.md` | 7 |

- **Teilen:** Lange Einträge sind über Wochen gewachsen – etwa „Knoten mit Besitzer
  koppeln“ mit 144 Zeilen. Sie sind an Sätzen geteilt, die nur ein Paket betreffen
  („In der App (seit B-8c) …“, „Im Knoten (seit B-8b) …“). Jeder Teil trägt den
  Titel und nennt die anderen Teile („Weitere Teile“).
- **Geprüft:** Jedes Wort der alten Fallstricke steht genau so oft in den neuen
  Dateien. Dazu kommen nur die Hinweise auf die anderen Teile. Je Eintrag ergeben
  die Teile aneinandergereiht wörtlich den alten Text.
- **Größe:** Die Wurzel ist von 115 KB auf 50 KB geschrumpft. Damit lädt jede
  Sitzung weniger als die Hälfte; App-Arbeit lädt zusätzlich 51 KB.
- **Regel 4 der drei Agenten:** Neue Fallstricke kommen unten in die Datei ihres
  Bereichs, solche für mehrere Pakete unten in die Wurzel. Landet einer beim
  Einmergen im Konflikt unten in der Wurzel, kommt er in die Datei seines Bereichs.

**`STATUS.md`:** Abgeschlossene Monate stehen jetzt in `docs/archiv/STATUS-<JJJJ-MM>.md`.

- September ist verschoben: 256 Abschnitte samt dem Bericht vom 29.08.2026, nach
  `docs/archiv/STATUS-2026-09.md`. Die Geschichte des Repositorys beginnt am
  20.09., also gehört alles davor zu September.
- `STATUS.md` behält den Oktober und schrumpft von 1,06 MB auf 0,36 MB. Neue
  Abschnitte kommen wie bisher ans Ende.
- Neu `scripts/status-archiv.py`: datiert jeden Abschnitt nach dem Commit seiner
  Überschrift (`git blame`, UTC) und hängt abgeschlossene Monate an die Datei ihres
  Monats.
  - `--pruefen` zeigt nur, was fällig ist; `--monat` ist zum Ausprobieren.
  - Ein flacher Klon wird abgewiesen: Dort stünde jede alte Zeile auf dem Datum
    des Klon-Rands.
- Wer im neuen Monat den ersten Abschnitt anhängt, ruft das Skript vorher
  (Regel 4).
- Geprüft: Archiv und neue `STATUS.md` ergeben aneinandergereiht wörtlich die alten
  Abschnitte. `--pruefen` meldet heute „nichts fällig“; mit `--monat 2026-11` wären
  es 146 Abschnitte aus dem Oktober.

Verweise nachgezogen: README, `docs/ausbau/UEBERSICHT.md`, `phase-1.md`
(Abschnitte 52–55 jetzt im Archiv), Übersicht `docs/archiv/README.md`.
