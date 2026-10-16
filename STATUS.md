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

## Schritt C-28 – Chat-Eingabe am Handy

Spur C, schwerer Befund C-1/C-13 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).
Die übrigen Befunde mit Spur C stehen jetzt als C-29 bis C-39 in der Sammlung, die Nummern
sind in Anhang D nachgetragen.

**Befund, im Browser nachgestellt** (neuer Smoke „composer“, offene Direktnachricht):

| Größe | Textfeld | Ablauf-Auswahl | „Senden“ rechts bei | `main` läuft über |
|---|---|---|---|---|
| Desktop 1280 | 22 px | 876 px | 1559 px | 279 px |
| Handy hoch 390 | 22 px | 370 px | 669 px | 279 px |
| Handy quer 844 | 22 px | 512 px | 1123 px | 279 px |

**Ursache:** Die Ablauf-Auswahl `#chat-ablauf` (nur bei Direktnachrichten sichtbar) erbt
aus der Grundregel `input, textarea, select { width: 100% }` die volle Breite. Im
Composer darf seit 8.16 kein Kind schrumpfen (`.chat-composer > * { flex-shrink: 0 }`).
Damit nahm die Auswahl die ganze Zeile, und das Textfeld (`min-width: 0`) blieb mit 22 px
übrig.

**`app.css`:**
- `.chat-composer select { width: auto; margin-bottom: 0; }`: Die Auswahl ist so breit wie
  ihr Text (115 px).
- Unter 1024 px bricht die Reihe um. Oben stehen Feld und „Senden“ (`order`), darunter die
  Werkzeuge (Anhang, Sprachnachricht, Ablauf, Zap, Prüfen).

**Danach:**

| Größe | Textfeld | Laufleiste | `main` | außerhalb | Flächen unter 40 px |
|---|---|---|---|---|---|
| Desktop | 494 px | 0 | 0 | – | – |
| Handy hoch | 310 px | 0 | 0 | – | – |
| Handy quer | 452 px | 0 | 0 | – | – |

Bildschirmfotos auf Handy und Desktop angesehen: Feld und Senden in einer Zeile, die
Werkzeuge darunter.

**Smoke „composer“** (neu, `DialogSeite` kann jetzt Größe und Touch): öffnet eine
Direktnachricht. Er misst keine waagrechte Laufleiste, kein Überlauf von `main`, kein Teil
der Eingabe außerhalb, das Feld mindestens 300 px (Desktop) bzw. 200 px (Handy), am Handy
jede Fläche ab 40 px. Vor dem Fix rot, danach grün.

Fallstrick in `packages/app/CLAUDE.md`: Formularfelder in einer Reihe nur mit eigener Breite.

## Schritt A-15a – Post kommt sofort (Nutzertest, Befund C-12)

Spur A. Im Nutzertest erschienen neue Direktnachrichten erst nach 89 s: Sie kamen nur
mit dem Abgleich des Posteingangs, und der läuft höchstens einmal je Minute. Das Abo
für Anrufe (B-13e) half nicht. Es fragt „ab jetzt“ (`since`), und Chat-Umschläge sind
bis zu zwei Tage zurückdatiert (NIP-59) – ein Relay schickt sie diesem Abo nie.
A-15 ist geteilt: a NIP-17 (hier), b MLS in der offenen Unterhaltung.

**Was:**
- **`app/src/post-live.ts`** (neu):
  - `postFilter()`: Umschläge an den eigenen Schlüssel, ohne `since`, `limit: 1` – was
    schon liegt, holt der Abgleich.
  - `LivePost.nimm()`: gleich öffnen nur, was noch nicht geöffnet ist, keine Anrufe
    (`vielleichtAnruf()` – die haben ihr Abo) und höchstens 30 je Minute. Wer den
    Schlüssel flutet, bekommt nicht je Umschlag eine Entschlüsselung (mit Bunker je
    eine Anfrage); der Rest kommt wie bisher mit dem Abgleich.
- **`shell/tabs/posteingang.ts`:**
  - `ordneEin()`: der Rumpf der Schleife des Abgleichs, unverändert herausgezogen. Er
    sagt zusätzlich, ob der Umschlag neu geöffnet wurde und für wen.
  - `lauscheAufPost()`: das Abo, je Schlüssel eines, gestartet am Ende jedes
    Abgleichs. Was beim Start schon lag, ist dann geöffnet, und die MLS-Engine lädt
    nicht früher als bisher.
  - `nimmLivePost()`: über `ordneEin()`, dieselbe Kette wie der Abgleich. Dann Liste
    nachführen; ist die Unterhaltung offen, lädt sie nach.
- **Datenschutzbericht** („anruf-vermittler“, beide Sprachen): „Damit ein Anruf sofort
  klingelt und Nachrichten sofort ankommen, hält die App … Abfragen … offen“. Die
  Relays sahen schon vorher, wann die App läuft; der Satz nennt jetzt beide Abos.

**Verdrahtet:** `shell/tabs/posteingang.ts` – `syncDmInbox()` endet mit
`void lauscheAufPost()`; das Abo ruft `nimmLivePost()` → `ordneEin()` →
`oeffneUmschlag()`.

**Tests:**
- `post-live.test.ts` (+4):
  - Filter ohne `since`;
  - zurückdatierter Umschlag ja, schon geöffneter nicht, Anruf nicht, anderes Kind nicht;
  - Grenze je Minute;
  - Verdrahtung, und das Abo für Anrufe bleibt „ab jetzt“.
- `privacy-facts.test.ts`: prüft den neuen Satz wörtlich (vorher den alten) – Zahl
  gleich.
- **Smoke „post_live“** (neu, `scripts/dm-probe.mts`): Unterhaltung offen, Abo offen,
  eine Nachricht eines Wegwerf-Schlüssels über `ProbeRelay.zustellen()`. Sie steht nach
  0,1 s im Chat; ohne das Abo (Gegenprobe) nach 15 s nicht.

## Schritt A-15b – MLS in der offenen Unterhaltung sofort (Befund C-6)

Spur A, Fortsetzung von A-15a. Über MLS kam im Nutzertest eine Antwort bei offener
Unterhaltung erst nach etwa 55 s. Gruppennachrichten (Kind 445) gehen an die Relays
der Gruppe, nicht an den Posteingang – das Abo für Post sieht sie nicht. Der Abgleich
holt sie höchstens einmal je Minute.

**Was:**
- **`OutboxPool.subscribeAn()`** (Protokoll): ein Abo nur an den genannten Relays des
  Pools, wie `publishAn()`, mit derselben Prüfung wie `subscribe()` (Signatur, je Event
  einmal). Ein Filter mit `#h` nennt die Gruppe so keinem anderen Relay.
  `subscribe()` ruft dieselbe innere Funktion und verhält sich wie bisher.
- **`abonniereAn()`** (`shell/state.ts`): Relays des Pools über dessen Verbindung, andere
  über je eine eigene, die `stopp` schließt. Weiter geht nur gültig Signiertes.
- **`mlsGruppenAbo()`** (`shell/mls-konto.ts`): Filter der Gruppe aus `gruppenAbos()`
  mit `limit: 1` und ihre Relays; null ohne Konto (Bunker, ohne Tresor).
- **`shell/gruppe-live.ts`** (neu): `lauscheAufGruppe()` hält für die offene
  Unterhaltung ein Abo an den Relays ihrer Gruppe; eine andere Unterhaltung beendet es.
  Ein Treffer stößt nur an, empfangen wird über `mlsAbgleichen([gruppe])` wie beim
  Abgleich.
- **`Nachziehen`** (`post-live.ts`): Nie zwei Läufe zugleich (die Engine weist einen
  zweiten ab); was währenddessen kommt, gibt genau einen weiteren, frühestens 2 s
  danach. So bremst sich auch ein Relay, das Treffer flutet.
- **`kommunikation.ts`:** `loadChatMessages()` der offenen Unterhaltung ruft
  `lauscheAufGruppe()` – auch wenn sie erst jetzt eine Gruppe hat. `zeigeNeuesMls()`
  ist dieselbe Anzeige wie nach der Wartezeit (`mlsBeiNeuem`).
- Die Engine lädt dadurch nicht früher. Eine Unterhaltung mit Gruppe lädt sie beim
  Öffnen ohnehin (`mlsVerlauf()`).

**Verdrahtet:** `shell/tabs/kommunikation.ts` `loadChatMessages()` →
`lauscheAufGruppe()` → `mlsGruppenAbo()` und `abonniereAn()` → `pool.subscribeAn()`; ein
Treffer → `Nachziehen` → `mlsAbgleichen()` → `zeigeNeuesMls()`.

**Tests:**
- `outbox.test.ts` (+1): nur die genannten Relays, Gefälschtes nie, doppelt einmal,
  ohne Treffer kein Fehler, `subscribe()` unverändert.
- `post-live.test.ts` (+2): `Nachziehen` – nie zwei zugleich, genau einer nachgezogen,
  ein Anstoß in der Pause gibt keinen dritten (der Test fand das im ersten Entwurf),
  Fehler halten nichts auf; Verdrahtung.
- Ein Browser-Test mit zwei Geräten und MLS-1:1 fehlt. Die Verdrahtung prüfen
  Quelltext-Tests; der Rest ist der Abgleich, den der Smoke-Test „privatraum“ mit echter
  Engine schon fährt.

**Prüfungen (A-15a und A-15b):**
- protocol 1238 grün (6 übersprungen, +1), node 337 (6 übersprungen), app 975 (+6);
- Leak-Tests 73 grün + 1 todo;
- check-wiring `--streng`, check-website, innerHTML streng: alle Exit 0;
- Build, Smoke-Test bestanden (mit „post_live“, je nach a und nach b ganz gelaufen).

Knoten-Stand: unverändert – nur App und `OutboxPool` (Protokoll).

## Schritt B-24 – Warntext zum Zeitanker (Nutzertest, T-1)

Der Dialog „Diebstahl vorbeugen“ (Settings › Sicherheit, Schritt 3) endete mit
„… kann auf eine zurückdatierte des Diebs hereinfallen – bis es Zeitzeugen
gibt.“ Zeitzeugen gibt es nicht. Seit B-17b3 wird das eigene Mandat in Bitcoin
verankert (`ankereMandat()`, gestempelt im Abruftakt), und bei Streit schlägt
ein verankertes Mandat jedes unverankerte (`merkeMandate(…, anker)`).

**Neu:** „… hereinfallen – es sei denn, deine Erklärung ist dann schon in
Bitcoin verankert. Das erledigt die App von selbst, solange sie offen ist; nach
dem Erzeugen dauert es einige Stunden.“ Englisch entsprechend.

**Geändert:**
- `protocol/src/key-rotation.ts` (`rotationWarning()`) samt Kopfkommentar.
- `app/src/texte/protokollsaetze.ts` (`ps.wechselWarnung`, de wortgleich zum
  Protokoll – `i18n.test.ts` vergleicht).

**Tests:** `key-rotation.test.ts` +1 – keine Zeitzeugen mehr, der Anker, „solange
sie offen ist“, „einige Stunden“; die Gleichheit von App und Protokoll prüft
`i18n.test.ts` wie bisher.

Knoten-Stand: nicht betroffen.

## Schritt B-25 – Offene Räume zeigen Neues von selbst (Nutzertest, R-9)

Im Nutzertest sah Alice Carols Nachricht im offenen Raum erst, nachdem sie den
Raum erneut geöffnet hatte. Private Räume gleicht der Abruftakt ab (2.3b);
offene Räume luden nur beim Öffnen.

**App** (`shell/tabs/raeume.ts`):
- `lauscheImRaum()`: Nach dem Laden eines offenen Raums ein Abo auf seine
  Nachrichten (42, `#space`) und Maßnahmen (34551/34552, `#h`) – ab jetzt
  (`since`), denn was schon da war, hat `oeffneRaum()` geladen.
  - Nur für den gewählten Raum: je Raum ein Abo, ein zweiter Aufruf öffnet keins.
  - Ein Event zählt nur, solange dieser Raum offen ist, nie in einem privaten,
    nie doppelt (nach Kennung).
- `beendeLiveAbo()` beim Wechsel des Raums, vor dem ersten `await` – kein Event
  des alten Raums danach. Ein Abo, das erst nach dem Wechsel zustande kam, wird
  gleich beendet; ging keins, versucht das nächste Öffnen es neu.
- `zeichneLiveNeu()`: den Kanal nur neu zeichnen, wenn man ihn sieht – sonst
  spränge der Lesestand auf jetzt; sonst nur die Kanalliste (Punkte für Neues).
- Kein Abfragetakt dafür (6.4).

**Tests:**
- `app/test/raum-live.test.ts` (+3): Filter und `since`, nur offen und nach dem
  Laden, beendet beim Wechsel, ein Abo je Raum, Neuzeichnen nur sichtbar.
- Smoke-Test „raum“ (desktop, `live`): `scripts/raum-probe.mts` liefert eine
  Nachricht von jetzt; `ProbeRelay.zustellen()` schickt sie an die offenen Abos,
  der Verlauf zeigt sie ohne erneutes Öffnen. Ohne die Änderung:
  `zugestellt: 0, angezeigt: False` (Gegenprobe).

Knoten-Stand: nicht betroffen.

## Schritt A-16 – Weniger Verbindungen (Nutzertest, Befund N-1)

Spur A. Im Nutzertest öffnete die App mit Tresor und MLS je rund 140 WebSockets in
45 Minuten. `frageAn()` baute je Abfrage und Adresse eine neue Verbindung auf und
schloss sie danach – auch für Relays, die der Pool ohnehin offen hielt. Das traf vor
allem den Abgleich der MLS-Gruppen (jede Minute je Gruppe) und Leser nach NIP-65.

**Was:**
- **`OutboxPool.queryAn()`** (Protokoll): fragt nur die genannten Relays des Pools,
  über dessen Verbindung, geprüft wie `query()`. `queryMitBericht()` nutzt dieselbe
  innere Funktion und verhält sich wie bisher.
- **`app/src/neben-verbindungen.ts`** (neu), `Nebenverbindungen` für Relays außerhalb
  des Pools:
  - je Identität und Adresse eine Verbindung, wiederverwendet;
  - nach zwei Minuten ohne Gebrauch zu, nie während sie gebraucht wird;
  - höchstens acht – darüber geht die am längsten ungenutzte.
- **`shell/state.ts`:** `teileZiele()` trennt Relays des Pools von den übrigen.
  - `frageAn()`: Relays des Pools über `queryAn()`, die übrigen über Nebenverbindungen.
    Neu: weiter geht nur gültig Signiertes, auch von fremden Relays – vorher prüfte
    erst der Aufrufer (Outbox-Leser) oder niemand (MLS-Abgleich).
  - `veroeffentlicheAn()` (Posteingänge) und `abonniereAn()` (A-15b) ebenso.
- Angemeldet wird wie bisher nur auf Verlangen (`relayVerbindung()`, NIP-42). Eine
  Verbindung des Pools, die schon angemeldet ist, trägt jetzt auch Abfragen an die
  Relays einer MLS-Gruppe. Das Relay sieht dieselbe IP zur selben Zeit ohnehin;
  `veroeffentlicheAn()` hielt es seit 5.4 schon so.

**Verdrahtet:** `shell/state.ts` – `frageAn()` (MLS über `mls-konto.ts`, Outbox-Leser
`outbox-lesen.ts`), `veroeffentlicheAn()` (Direktnachrichten, Einladungen),
`abonniereAn()` (`gruppe-live.ts`).

**Tests:**
- `outbox.test.ts` (+1): `queryAn()` fragt nur die genannten, Gefälschtes nie, doppelt
  einmal.
- `neben-verbindungen.test.ts` (+5): wiederverwendet; je Identität eigene; Ruhezeit und
  Rücksetzen; Grenze nur über Ungenutzte; `mit()` gibt auch bei Fehlern zurück;
  Verdrahtung, und keine Wegwerf-Verbindung je Aufruf mehr.
- `post-live.test.ts`: der Verdrahtungstest aus A-15b liest die neue Schreibweise von
  `abonniereAn()` – dieselbe Aussage, Zahl gleich.

**Prüfungen:**
- protocol 1239 grün (6 übersprungen, +1), node 337 (6 übersprungen), app 980 (+5);
- Leak-Tests 73 grün + 1 todo;
- check-wiring `--streng`, check-website, innerHTML streng: alle Exit 0;
- Build reproduzierbar, Smoke-Test bestanden (privater Raum mit echter Engine über
  `frageAn()`/`queryAn()`, „post_live“).

Knoten-Stand: unverändert – nur App und `OutboxPool` (Protokoll).

## Schritt B-26 – Raum anlegen ohne Umweg (Nutzertest, R-6 und R-5)

Im Nutzertest konnte Carol (Handy, ohne Tresor) gar keinen Raum anlegen:
- **R-6:** „+“ in der Leiste legte nur private Räume an, „öffentlichen Raum
  anlegen“ stand nur im Menü eines offenen Raums – das es erst in einem Raum gibt.
- **R-5:** Privat ohne Tresor kam der Hinweis erst nach dem Namen, der Name war
  dann weg, und einen Weg zum Tresor gab es nicht.

**App** (`shell/tabs/raeume.ts`):
- `waehleRaumArt()` an „+“ (`#rail-create`): erst „Welcher Raum?“ – privat oder
  öffentlich. Ohne Tresor ist öffentlich vorgewählt; der Hinweis bei privat sagt,
  dass die App den Tresor gleich anbietet (mit Bunker nennt er den Grund). Danach
  fragt `legeRaumAn()` den Namen wie aus dem Raum-Menü – mit Hinweis.
- `privatMoeglich()` in `legeRaumAn()` vor dem Namen (für „+“ und das Menü):
  ohne Tresor erst sagen und `richteTresorEin()` anbieten – der Name kommt erst
  danach, so geht keiner verloren. Mit Bunker oder ohne Identität lässt es sich
  hier nicht beheben: dann nur der Grund.
- `legeRaumAn(oeffentlich = false)` bleibt sonst, wie es war – zwei Tests (Leak
  „private Räume sind der Standard“, C.2b1 „ohne Namen nichts angelegt“) prüfen
  es wörtlich und sind unverändert grün.
- `kommunikation.ts` (Spur C, eine Zeile): „+“ leitet nicht mehr an
  `#space-create` weiter, `raeume.ts` verdrahtet es selbst.

**Tests:**
- `app/test/raum-anlegen.test.ts` (+2): Verdrahtung an genau einer Stelle, die
  Wahl ohne Namen (nie zweimal gefragt), `privatMoeglich()` vor dem Namen, nur der
  fehlende Tresor ist zu beheben.
- Smoke-Test „raum_anlegen“ (neu): ohne Tresor und ohne Raum öffentlich
  vorgewählt; privat → „Tresor einrichten“, abgebrochen entsteht nichts;
  öffentlich → der gewohnte Dialog mit Namen → angelegt, die Adresse gleich da;
  kein Browser-Dialog.
- Smoke-Test „raum“ unverändert grün: Das Raum-Menü öffnet ohne Tresor jetzt das
  Tresor-Angebot, mit demselben Titel „Raum anlegen (privat)“.

Knoten-Stand: nicht betroffen.

## Schritt B-27 – Systemprompt des Knotens sagt nur, was stimmt (Nutzertest, A-7)

Der Systemprompt (`node/src/inference.ts`) galt für jeden Provider, sagte aber
„Du laeuffst auf EINEM Provider-Knoten (GX10)“, nannte web_search, image_gen und
video_gen auch bei Anfragen ohne Werkzeuge (Gratis-Antworten seit A-14a) und
behauptete für jedes Modell einen „Knowledge-Cutoff Ende 2024“. Dazu nannte er
Streaming-Sats mit Kind 38020, das es nicht gibt.

**Knoten** (`inference.ts`):
- `systemPrompt({ werkzeuge, heute })`: die Werkzeuge genau dieser Anfrage (aus
  `getTools()`, mit `ohneWerkzeuge` keine – dann „keine Werkzeuge“), das heutige
  Datum (UTC); kein fester Knoten, kein erfundener Wissensstand. Den Hinweis auf
  die Websuche gibt es nur, wenn sie da ist.
- `complete()` baut den Prompt nach den Werkzeugen, die es Ollama schickt.

**Tests** (`node/test/systemprompt.test.ts`, +3): kein GX10, kein Wissensstand,
das Datum; nur die Werkzeuge der Anfrage; an Ollama geht der Prompt passend zu
den übergebenen Werkzeugen (mit und ohne). Das Datum wird vor und nach dem
Aufruf gelesen – springt dazwischen der Tag, gilt jedes von beiden.

**Offen (Befund am Rand):** image_gen und video_gen liefern Links auf
`localhost:8188` (ComfyUI des Knotens) – ein Kunde kann sie nicht öffnen. Der
Prompt nennt sie weiter, weil sie angeboten werden; ob sie ins Angebot gehören,
ist ein eigener Punkt.

Knoten-Stand: neu (B-27) – ohne Update antwortet ein Knoten wie bisher.

## Schritt B-28 – Ersatzschlüssel nicht im Klartext (Nutzertest, T-2)

„Diebstahl vorbeugen“ (Settings › Sicherheit, Schritt 3) speicherte den
Ersatzschlüssel nur als Klartext-Datei `freedom-ersatzschluessel.txt`.

**App:**
- `ersatz-datei.ts` (neu):
  - `baueErsatzDatei()`: mit Passphrase ein JSON (`art`, `version`, der
    öffentliche Schlüssel offen – er steht ohnehin im Mandat –, das Chiffrat im
    Format des Tresors über `verschluesseleMitPassphrase()`), sonst der Klartext
    wie bisher.
  - `leseErsatz()`: 64 Zeichen Hex wie bisher oder die Datei mit ihrer
    Passphrase; eine falsche Passphrase wirft, Fremdes gibt `null`.
- `shell/tabs/sicherung.ts`:
  - `bereiteWechselVor()` fragt nach der Warnung und **bevor** ein Schlüssel oder
    Mandat entsteht nach einer Passphrase (zweimal, Mindestlänge des Tresors;
    leer: Klartext). Ohne `crypto.subtle` (http im Heimnetz, B-10) nur Klartext.
  - `widerrufeSchluessel()` nimmt im Feld des Ersatzschlüssels auch den Inhalt
    der verschlüsselten Datei, dazu ein Feld für ihre Passphrase; gelesen über
    `leseErsatz()` vor `fromHex()`.
- Texte de/en (`set.ersatzPass…`, `set.ersatzFrage`/`set.ersatzHex` erweitert).

**Tests** (`app/test/ersatz-datei.test.ts`, +3): ohne Passphrase Klartext, mit
Passphrase kein privater Schlüssel in der Datei, zu kurze abgewiesen; Widerruf
aus Hex und aus der Datei, falsche Passphrase und Fremdes abgewiesen;
Verdrahtung (Frage vor `generateKeypair()`, nur mit `verschluesselungMoeglich()`,
`leseErsatz()` vor `fromHex()`). Die bestehenden Tests zu beiden Dialogen
(`browser-dialoge`, `schluessel-status`) bleiben unverändert grün.

**Smoke-Test** („einstellungen“): Der Widerruf hat ein Feld mehr (Passphrase),
die Meldung zu ungültiger Eingabe nennt die Datei; neu geprüft werden der Inhalt
einer verschlüsselten Datei ohne Passphrase (Meldung im Dialog) und „Diebstahl
vorbeugen“ – nach der Warnung die Frage nach der Passphrase (zwei verdeckte
Felder, zu kurz meldet sich), abgebrochen geht nichts hinaus. Der erste volle
Lauf war hier rot: die alte Prüfung erwartete drei Felder.

Knoten-Stand: nicht betroffen.

## Schritt 11.3b – Agenten in Räumen: Protokoll (b1 und b2)

Spur A, nach dem Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` (freigegeben 08.10.:
F1, F4, F6 A; F2 Monatsbudget mit Pfand; F3 B; F5 Agentenketten mit Schalter).
Nur Protokoll – Gerät (11.3c, Spur A), Knoten (11.3d, Spur B) und Oberfläche
(11.3e, Spur C) bauen darauf. Format in `docs/PROTOCOL.md` 32.

**b1 – Karte, Besitzer, Rolle (`protocol/src/agent-karte.ts`):**
- Karte (Kind 38090, `d` = `karte`): Autor ist der Agent, Inhalt leer.
  - Name, Beschreibung, Betrieb (`knoten`/`geraet`), Bezahlung
    (`fragender`/`einlader`), optional Besitzer, Provider, Modell.
  - Keine Persona, keine Systemanweisung (F4 A).
  - Streng gelesen: jedes Feld einmal, bekannte Werte, Grenzen, keine
    Steuerzeichen; je Agent die neueste.
- Besitzer nur bestätigt (F1 A): NIP-51-Liste des Besitzers (Kind 30000, `d` =
  `freedom-agenten`); es zählt seine neueste. Eine Liste ohne den Agenten
  widerruft.
- Rolle `agent` (F6 A): lesen, schreiben, Threads, Rang 1. `mitAgentRolle()` nimmt
  ihr jedes weitere Recht – geprüft mit `can()` in einem offenen Raum.
- Private Räume: Karte und Liste nur als innere Events (`raumAgentKarte()`,
  `raumAgentenListe()`, `raumAgentKarten()`, `raumListenEvents()`).
- Leak-Regel `agent-raum-privat`: keine Karte, keine Liste mit dem Agenten und keine
  Nachricht von oder an ihn offen; KeyPackages (443) erlaubt.

**b2 – wann ein Agent antwortet (`protocol/src/agent-auftrag.ts`):**
- Auslöser (`sollAntworten()`): nur bei Erwähnung, nie die eigene Nachricht, nur
  mit Schreibrecht im Kanal.
- Agentenketten (F5):
  - Schalter `["agentenketten", <1–50>]` in der Raum-Definition, ohne Tag aus.
  - Antworten nur aus einem Budget.
  - `kettenLaenge()` zählt rückwärts über die Antworten bis zum ersten Menschen;
    sie endet an fehlenden Gliedern und an Kreisen.
- Bremse: 3 Aufträge je Absender und Minute (`AuftragsBremse`, `RateLimiter`).
- Kontext (`agentKontext()`): nur Kanal bzw. Thread samt Anfang, nur davor, in den
  Grenzen des Fragenden; andere Agenten gekennzeichnet.
- Verweis im Kern: `agent-raum` (Adresse oder Gruppe) und `agent-erwaehnung`,
  streng gelesen.
- Antwort: Kind 42 bzw. inneres Event Art 9, mit `root`/`reply`/`mention`,
  höchstens 4000 Zeichen.
- Monatsbudget (F2): `budgetStufe()` (Standard 10 %) und `naechsteStufe()` –
  kumulativ eine Stufe über dem Verbrauchten, nie über dem Budget.

**Verdrahtet:** noch nicht – nur Protokoll. Die Exporte stehen bis 11.3c/11.3d in
`scripts/wiring-ausnahmen.txt`. Die Aussagen im Datenschutzbericht kommen mit
11.3c: Erst dann gibt es Agenten in der App, und ein Szenario mit echter Engine.

**Tests:**
- `agent-karte.test.ts` (+5): Karte, strenges Lesen, Besitzer, Rolle samt `can()`,
  Leak-Regel.
- `agent-auftrag.test.ts` (+7): Auslöser, Ketten, Schalter, Bremse, Kontext,
  Verweis und Antwort, Budget.
- Der Sammeltest der Leak-Regeln kennt die neue Regel.

**Prüfungen:**
- protocol 1252 grün (6 übersprungen, +12), node 337, app 983;
- Leak-Tests 73 grün + 1 todo;
- check-wiring `--streng`, check-website, innerHTML streng: alle Exit 0;
- Build reproduzierbar, Smoke-Test bestanden.

Knoten-Stand: unverändert.

## Schritt 4.3e – Programm-ID des Devnet-Deploys (Zahlkanal)

Der MENSCH hat das Zahlkanal-Programm am 09.10.2026 auf Devnet gelegt
(`F9P2PeyySkeQL4d1KAtHjtnVBqzjW3dqbfubY1PChW2m`, Bericht des lokalen Agenten
„ZAHLKANAL-DEPLOY-09-10-2026.md“). Gebaut war die Binary noch mit
`declare_id!` des Platzhalters (`7tukwi…`). Anchor 0.30.1 vergleicht diese ID
bei jedem Aufruf mit der Adresse, an der das Programm liegt – eine Simulation
gegen Devnet endet deshalb für jede Anweisung mit
`Custom 4100` („AnchorError … DeclaredProgramIdMismatch … The declared program
id does not match the actual program id“). Das Programm ist ausführbar, nimmt
aber nichts an; die Annahme im Bericht, die alte ID sei nur irreführend, trifft
für Anchor nicht zu. Dieselbe Simulation zeigt dasselbe beim HTLC an `3UmRR…`
(Schritt 0.G); `B6W19U…` (die ID im Code) nimmt dort Aufrufe an.

**Geändert:**

- `contracts/solana-channel`: `declare_id!` und `Anchor.toml` auf `F9P2…`,
  README mit den Befehlen für das Upgrade (MENSCH) und dem Vergleich danach.
- `packages/protocol/src/channel.ts`: `KANAL_PROGRAMM_ID = "F9P2…"`, Kommentar
  ohne Platzhalter.
- `channel.test.ts`: statt der Platzhalter-Bytes prüft der Test, dass die ID
  kanonisch ist und dass `declare_id!` und `Anchor.toml` genau sie tragen
  (Gegenprobe: eine geänderte `declare_id!` macht ihn rot).
  `tiers.test.ts`: Testvektor mit der neuen ID.
- Doku: `docs/ZAHLKANAL.md`, `docs/SOLANA-UPGRADE-AUTHORITY.md` (beide
  Programme mit dem geprüften Stand, Checkliste), `phase-4.md` (4.3e),
  SAMMLUNG M-1/M-2, Regeln in `CLAUDE.md` und `contracts/CLAUDE.md`.

Alle übrigen Stellen nutzen die Konstante (durchgesehen: Knoten `kanal-kasse.ts`,
`einrichtung.ts`, `main.ts`; App `zahlkanal.ts`, `zahlkanal-ui.ts`,
`verdienst.ts`, `verdienst-ui.ts` samt Tests) – kein weiteres Literal.

**Prüfungen:** `pruefen.sh --werkzeuge` (Agave 3.1.10): Programm gebaut, 7 von 7
Tests gegen den Validator grün – das Programm liegt dort an `F9P2…`, die Kasse
des Knotens löst gegen es ein. Protokoll, Knoten, App, Leak, MLS, Build,
Wiring, Website, innerHTML, Smoke, Site, Repro wie unten im Pull Request.
Anzahl der Tests unverändert (eine Prüfung ersetzt).

**MENSCH:** Upgrade an `F9P2…` mit der Binary aus diesem Stand (README des
Programms), danach eine Simulation, die nicht mehr mit 4100 endet; dann ein
KI-Auftrag über den Kanal. Bis zum Upgrade scheitert jeder Kanal-Aufruf in der
Vorabsimulation – es fließt kein Geld.

## Schritt 11.3c1 – Agenten auf dem Gerät: Buch, Anlegen, Einladen (offene Räume)

Erster Teil von 11.3c (Karte `phase-11.md`, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`,
freigegeben 08.10.). 11.3c ist geteilt, weil es mehr als 400 Zeilen braucht:
c1 Buch und Einladen, c2 Erwähnungen in offenen Räumen beantworten, c3 private
Räume mit eigenem MLS-Konto.

**Neu:**

- `packages/app/src/agenten-buch.ts` (ohne DOM): Agenten dieses Geräts mit eigenem
  Schlüssel (nie die Identität), Name, Beschreibung, Persona (nur hier, F4 A),
  Modell; je Raum ein Budget in Monat und Tag (UTC) in der Einheit der Schiene (msat
  oder Lamports). `reicht()` vor dem Auftrag, `buche()` nach der Antwort, neuer Tag
  bzw. Monat beginnt neu, eine andere Einheit auch; `meldeEinmal()` je Zeitraum.
  Streng gelesen: Ein Schlüssel, der nicht zum Agenten passt, ein kaputtes Budget,
  Doppeltes und Unsinn fallen weg. Grenzen: 20 Agenten, 50 Räume je Agent, Persona
  4000 Zeichen.
- `packages/app/src/shell/agenten.ts`: `legeGeraeteAgentAn()` (erst der Tresor),
  `ladeAgentInOffenenRaum()` (Recht `rollen_vergeben`; Rolle `agent` fehlt oder hat
  zu viele Rechte → nur der Gründer legt sie über `mitAgentRolle()` an; Budget,
  Zuweisung 34702, Karte 38090 vom Agenten mit Besitzer, Liste 30000 des Besitzers
  nur mit Agenten offener Räume – Agenten anderer Geräte bleiben darin; Pflicht-Hinweis
  im ersten beschreibbaren Kanal, ohne Erwähnung), `entferneAgentAusOffenemRaum()`.
  Als Gerät nie (Karte und Liste nennten sonst das Gerät als Besitzer).
- `freedom.agenten` im Tresor (`GEHEIM_FEST`) und in `SICHERUNG_NIE`; Texte
  `agentRaum.*` (de, en).

**Verdrahtet:** noch nicht im Ablauf der App – Aufrufer sind 11.3c2 (Antworten,
`agentenBuch`) und 11.3e (Oberfläche „Agent hinzufügen“, Spur C). Die
Protokoll-Bausteine `baueAgentKarte`, `baueAgentenListe`, `mitAgentRolle`,
`agentKarteTags`, `agentRolle`, `agentenListeTags` sind damit aus
`wiring-ausnahmen.txt` heraus.

**Prüfungen:** protocol 1252 grün (6 übersprungen), node 340, app 994 (+6), Leak 73 + 1 todo, mls 13; tsc überall, Build, Wiring (0 offen, Exit 0), Website, innerHTML, Smoke, Site, Repro grün.

## Schritt 11.3c2 – Agenten auf dem Gerät beantworten Erwähnungen (offene Räume)

Zweiter Teil von 11.3c (Karte `phase-11.md`, Entwurf P3–P5, F3 B, F5).

**Neu:**

- `packages/app/src/agent-antwort.ts` (ohne Netz und DOM): `entscheide()` – die
  Regeln aus 11.3b (`sollAntworten()`, `AuftragsBremse`) mit dem Stand des Raums:
  Schreibrecht je Kanal (auch der Agent selbst), Agenten an der Rolle `agent`,
  Agentenketten nur mit dem Schalter in der Definition des Gründers, Antworten
  immer aus dem Budget des Erstellers. `agentPrompt()` – Persona, Verlauf nur des
  Kanals bzw. Threads bis zur Erwähnung (Umfang aus `VERLAUF_UMFANG`), Absender als
  „Person 1“, „Agent 1“, der Agent als „Du“ – nie Schlüssel oder Namen.
  `agentAntwortEvent()`/`agentHinweisEvent()` (Kind 42 des Agenten, Antwort auf die
  Erwähnung, Fragender erwähnt, höchstens 4000 Zeichen; Hinweis ohne Erwähnung).
  `AgentSitzungen` – Sitzungsschlüssel je Agent und Raum (D1b2).
- `packages/app/src/shell/agenten-lauschen.ts`: `starteGeraeteAgenten()` – ein Abo
  ab jetzt auf Nachrichten an die Agenten dieses Geräts (nie als Gerät, nur mit
  offenem Raum im Buch), neu nur bei Änderung. Je Agent eine Erwähnung nach der
  anderen: Stand und Verlauf des Raums laden, entscheiden, Provider in der Einheit
  des Budgets wählen (msat nur über Lightning, Lamports nur mit Zahlkanal), Gebot
  100 sats gegen `reicht()`, sonst einmal je Zeitraum „Budget aufgebraucht“ im
  Raum. Auftrag wie jeder andere versiegelt vom Sitzungsschlüssel, A+ über
  `ki-zahlung.ts` (Deklaration oder Gutschrift), Platzhalter je Auftrag
  (`maskiereEinzeln()`), kein Verweis auf den Raum. Antwort nur an diesen Schlüssel
  abgefragt, bezahlt (Kanal: Preis verbuchen; Lightning: Abrechnung, Sitzung,
  Anteile), höchstens das Gebot verbucht, Antwort vom Agenten signiert.
- `shell/app.ts`: gestartet mit der App, im Abruftakt geprüft; `shell/agenten.ts`
  setzt das Abo nach Einladen und Entfernen neu auf. Texte `agentRaum.budget*`.

**Verdrahtet:** `shell/app.ts` (`void starteGeraeteAgenten();` nach `wireAnrufe()`,
`abrufTakt.melde("agenten", …)`); Smoke „agent_abo“: Mit einem Agenten im Buch hält
die App nach dem Start ein Abo auf 42 mit `#p` des Agenten und `since`.

**Grenzen:** Ein Agent fragt nur einen Provider je Erwähnung (kein Failover) und
schweigt bei Ablehnung oder nach 3 Minuten. Quittungen (5.5b) legt er nicht an –
die Rangfolge der Provider bleibt bei den eigenen Fragen. Private Räume folgen mit
11.3c3 (eigenes MLS-Konto, Aussage im Bericht).

Die Bausteine `AuftragsBremse`, `agentKontext`, `ausRaumEvent`, `kettenLaenge`,
`kuerzeAgentAntwort`, `leseAgentenketten`, `sollAntworten` sind damit aus
`wiring-ausnahmen.txt` heraus.

**Prüfungen:** protocol 1252 grün (6 übersprungen), node 340, app 1004 (+10),
Leak 73 + 1 todo, mls 13; tsc überall, Build, Wiring (0 offen, Exit 0), Website,
innerHTML, Smoke (neu „agent_abo“: 8 Abos, eines je Relay, mit `since`), Site,
Repro grün.

## Schritt Anhang E – Integrationen erprobter Projekte (Sammlung)

Auf Wunsch des MENSCHEN geprüft, wo spezialisierte Projekte in ihrem Gebiet
weiter sind als unsere eigenen Umsetzungen (Vorlage „FreedomStack – Offgrid /
Anti-Zensur“ und eigene Recherche). MENSCH 09.10.: „Ja zu allen Vorschlägen“,
dazu Cashu, Atomic Agent und TensorFold.

**Sammlung** (`docs/neuordnung/SAMMLUNG.md`):
- Abschnitt 2: B-29 bis B-39 (KI-Antrieb wählbar mit vLLM/SGLang/TensorFold,
  Atomic Agent, MCP mit Kiwix, Reticulum, Pluggable Transports, LiveKit,
  Negentropy, Bitchat, MeshCore, whisper.cpp/Piper, Iroh-Blobs).
- Abschnitt 5: Entscheidungen AG1, MC1, RN1, RN2, PT1, LK1, NG1, BC1 (Spur B)
  und – als Vorschlag für Spur A – E4b (eingebaute Lightning-Wallet: Breez SDK
  Spark, Cashu nur ehrlich als verwahrt), FR1 (FROSTR), SH1 (Shamir von Privy).
- Anhang E: alle Projekte mit Nutzen, Weg, vorgeschlagener Spur und Nummer;
  was nicht übernommen wird und warum.

**FORTSCHRITT:** Zeile Spur B nennt B-29 bis B-39; Vorschlag, B-29 direkt nach
E9-3b zu bauen.

**Dazu Anhang F** (Lauf 2 des lokalen Agenten, 50 Nutzer mit echtem Provider):
jeder Befund am Code nachgeprüft. Spur B: B-40 (ohne `NODE_SECRET_KEY` bei
jedem Start ein neuer Schlüssel, der geheime im Log; Docker immer) und B-41
(angekündigtes und ausgeliefertes Modell können auseinanderfallen). Für Spur A:
toter Provider gewählt (L2-1), Rückfall erst nach 5 min statt nach 20 s (L2-2),
netzweite Ausfall-Kenntnis nur dezentral (L2-3).

Kein Code geändert; Knoten-Stand: nicht betroffen.

## Schritt B-40 – Stabile Knoten-Identität, kein Schlüssel im Log (Lauf 2, L2-5)

Lauf 2 des lokalen Agenten fand zwei Starts desselben Knotens mit zwei
verschiedenen pubkeys. Nachgeprüft: Ohne `NODE_SECRET_KEY` erzeugte
`loadKeypair()` (`main.ts`) bei jedem Start einen neuen Schlüssel und schrieb den
geheimen ins Log. `docker-compose.yml` reichte die Variable nicht durch und
versprach, das Volume `~/.freedom` erhalte die Identität – unter Docker kostete
also jeder Neustart Ruf, Zahlkanäle und Kopplung. Der Installer legt
`~/.freedom/node-key` an und setzt die Variable – nur dort ging es gut.

**Knoten:**
- `knoten-schluessel.ts` (neu): `ladeKnotenSchluessel(umgebung, datei, { anlegen })`
  – `NODE_SECRET_KEY` streng (64 Zeichen Hex; leer gilt als nicht gesetzt),
  sonst `~/.freedom/node-key` (`knotenSchluesselDatei()`, dieselbe wie der
  Installer); fehlt sie, mit `anlegen` neu (0600, Ordner 0700, `wx` – nie eine
  Datei ersetzen). Eine defekte Datei startet nicht und wird nie überschrieben;
  Fehler nur als `SchluesselFehler` mit festem Text.
- `main.ts`: `loadKeypair()` nur noch darüber; ins Log Quelle und pubkey, beim
  ersten Mal der Hinweis, die Datei zu sichern. Ungenutzte Importe raus.
- `koppeln.ts`: derselbe Schlüssel (`anlegen: false` – `npm run koppeln` legt nie
  einen an).
- `docker-compose.yml`: `NODE_SECRET_KEY: "${NODE_SECRET_KEY:-}"`, Kommentar zum
  Volume ehrlich.

**Tests** (`node/test/knoten-schluessel.test.ts`, +4): angelegt mit 0600, danach
derselbe Schlüssel, leer heißt Datei; Umgebung vor Datei, streng (kürzer, `0x`,
fremdes Zeichen, länger); defekte Datei nie ersetzt, Fehlertext ohne Inhalt,
`koppeln` legt nie an; Verdrahtung (beide Aufrufe, kein `generateKeypair()` in
`main.ts`, Logzeilen ohne geheimen Schlüssel, Compose reicht durch).
Zusätzlich echt gestartet (ohne Ollama, Abbruch danach): zweimal derselbe pubkey,
`npm run koppeln` nennt ihn im Kopplungscode, ohne Datei bricht es mit Text ab.

Knoten-Stand: neu nötig, damit die Identität Neustarts überlebt (GX10: die
Variable ist dort gesetzt – unverändert).

## Schritt B-41 – Angebotenes Modell = ausgeliefertes Modell (Lauf 2, L2-4)

Lauf 2 des lokalen Agenten setzte nur `PROVIDER_MODELS=qwen3.8:27b`; der Knoten
kündigte Qwen an und antwortete mit Nemotron. Nachgeprüft: Nennt eine Anfrage
kein angebotenes Modell, gab `dvm-provider.ts` kein Modell weiter, und das
Backend nahm `OLLAMA_MODEL` (Vorgabe Nemotron). Ebenso stand im Angebot, was in
`PROVIDER_MODELS` steht, auch wenn Ollama es nicht hat – jeder Auftrag dafür
scheitert (wie in L2-1 ein toter Provider).

**Knoten:**
- `dvm-provider.ts`: ohne angebotenen Wunsch das erste Modell aus
  `cfg.modelle()` – nie ein Modell außerhalb des Angebots.
- `modell-laden.ts`: `nurBeiOllama(angeboten, ollama)` – nur Modelle, die Ollama
  unter genau dem Namen nennt (ohne Tag wie Ollama selbst `:latest`); bliebe
  nichts, bleibt die Liste (nie still vom Netz).
- `main.ts`: `angebotModelle()` darüber; `baueAngebot()` fragt `/api/tags` bei
  jedem Erneuern (ohne Antwort keine Aussage); ins Log einmal je Änderung, was
  fehlt, und ein `OLLAMA_MODEL` außerhalb des Angebots.

Die Selbstprüfung (`einrichtung.ts`, Schienen Lightning und SOL) bleibt
unverändert – Modelle sind keine Schiene; die Meldung steht im Log.

**Tests** (`node/test/angebot-modell.test.ts`, +3): ohne Wunsch, mit fremdem
und mit angebotenem Wunsch (Besitzer-Auftrag über den Umschlag; ohne die
Änderung zweimal das Standardmodell – Gegenprobe rot); `nurBeiOllama()` mit Tag,
ohne Tag, nichts übrig, leer; Verdrahtung (erst Ollama fragen, dann anbieten).
Angepasst an die neue Regel (nicht abgeschwächt): zwei Tests aus E9-3a
(`modell-laden.test.ts`) erwarteten für einen fremden Wunsch das Standardmodell
(`undefined`) und die Zeilen in `baueAngebot()` direkt hintereinander – jetzt das
erste angebotene Modell und die Abfrage bei Ollama dazwischen.

Knoten-Stand: neu nötig, damit Angebot und Antwort übereinstimmen.

## Schritt C-29 – Senden wartet auf Anhänge

Spur C, Befund C-7 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

**Befund, im Browser nachgestellt** (neuer Smoke „anhang_senden“): Eine Datei über 32 KB
geht verschlüsselt ins Blob-Netz und braucht dafür einige Zeit. Wer in dieser Zeit „Senden“
drückt, schickte den Text allein hinaus. Der Anhang kam erst danach in `chatAttachments` an
und hing dann an der nächsten Nachricht, auch an eine, die gar nicht ihm galt. Gemessen:
zwei Nachrichten, die erste ohne Anhang.

**`anhang-warte.ts`** (neu, ohne DOM): `AnhangWarte` merkt sich laufende Uploads (`merke()`)
und zählt sie (`anzahl`). `alleFertig()` wartet auf alle, auch auf solche, die währenddessen
dazukommen, und meldet, ob jeder gelang.

**`chat-anhaenge.ts`:** `handleChatFiles()` meldet jeden Upload bei `anhangWarte` an.
`ladeAnhaenge()` liefert `false`, wenn eine Datei scheiterte (der Toast bleibt wie bisher).
`zeigeAnhangListe()` zeigt die vorgemerkten Anhänge unter dem Feld.

**`kommunikation.ts`**, `sendChatMessage()`: Läuft ein Upload, wartet Senden, bevor es Text
und Anhänge liest.
- Während des Wartens: Knopf gesperrt (`aria-busy`), Feld nur lesbar, Hinweis „Wird gesendet,
  sobald der Anhang hochgeladen ist …“. Ein zweites Senden wird nicht angenommen.
- Danach gehen Text und Anhang zusammen in einer Nachricht hinaus.
- Scheitert ein Upload, geht nichts hinaus. Der Text bleibt im Feld, ein Hinweis sagt es, und
  unter dem Feld steht wieder, was vorgemerkt ist.
- Wechselt die Unterhaltung, während der Anhang lädt, geht ebenfalls nichts hinaus.

**Tests:** `anhang-warte.test.ts` (6): Zählung, Warten auf später Dazugekommenes, Fehlschlag,
Verdrahtung (erst warten, dann lesen; ohne Erfolg nichts senden). Smoke „anhang_senden“
(40 KB, sofort Senden): Während des Wartens sind Knopf und Feld gesperrt und der Hinweis
steht da. Danach gibt es genau eine Nachricht mit Text und Anhang, Feld und Liste sind leer.
Vor dem Fix rot (zwei Nachrichten), danach grün.

Fallstrick in `packages/app/CLAUDE.md`: Anhänge im Chat nur über `handleChatFiles()`.

**Prüfungen:** protocol 1252 grün (6 übersprungen), node 340, app 1010 (+6), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt Entscheidungen 09.10. – Anhang E, Spur A, H1 (MENSCH)

Der MENSCH hat die 19 offenen Entscheidungen „alle wie empfohlen außer LIZ“
entschieden. Eingetragen in `docs/neuordnung/SAMMLUNG.md`:

- **Spur B (Abschnitt 5):** AG1 A, MC1 A, RN1 wie empfohlen (im Entwurf zu B-32),
  RN2 A, PT1 A, LK1 A, NG1 B, BC1 B. Damit sind B-30 bis B-35 frei (B-32 zuerst
  als Entwurf); B-36 wartet auf ein Audit von Bitchat.
- **Spur A:** E4b D, FR1 A, SH1 A, P5d B (nach M-2), RM2 B. A-11 später, zuerst
  Transkribieren; A-12 ohne eigenes Programm, Squads anbinden; A-13 nach Audit und
  Mainnet. L2-3 (Anhang F): erst B (L2-1, L2-2), A später. Umsetzen muss Spur A.
- **Spur C:** H1 A (`'self'` in `connect-src`).
- **LIZ bleibt offen.** Der MENSCH schlägt GPL-3.0 mit Zusatzbedingungen nach
  Abschnitt 7 vor (Marken; österreichisches Recht, Gerichtsstand Wien). Die
  Markenklausel ist dort vorgesehen, Rechtswahl und Gerichtsstand nicht. Neu als
  Option E: EUPL-1.2, die beides von sich aus regelt. Der Wortlaut liegt beim
  MENSCHEN.

Nur Doku, kein Code.

## Schritt C-30 – Ungelesenes in Direktnachrichten

Spur C, Befund C-11 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung): Nichts zeigte an,
dass eine Nachricht da war – kein Fettdruck, kein Zähler in der Liste oder in der Navigation.

**`ungelesen.ts`** (neu, ohne DOM): Je Unterhaltung zählen zwei Zeitpunkte – `eingang` (die
neueste Nachricht vom Gegenüber) und `gelesen` (wann man sie zuletzt vor Augen hatte).
Ungelesen ist, was neuer ist als gelesen. Der Zähler zeigt ab 100 „99+“. Gespeicherte
Unterhaltungen von vorher gelten bis zu ihrer letzten Nachricht als gelesen
(`ergaenzeGelesen()`) – sonst stünde nach dem Update alles als neu da.

**`posteingang.ts`, `ordneEin()`** (seit A-15a der gemeinsame Weg für Abgleich und Abo):
Nur was das Gegenüber schrieb, setzt `eingang` – eigene Kopien von anderen Geräten zählen
nicht. Neue Unterhaltungen beginnen mit `gelesen: 0`. Nach dem Abgleich und nach Post aus
dem Abo gilt die offene Unterhaltung als gelesen (`markiereGelesen()`).

**`kommunikation.ts`:**
- „Vor Augen“ heißt: offen, Seite Kommunikation mit den Direktnachrichten, Fenster sichtbar,
  am Handy der Verlauf statt der Liste.
- Gelesen wird beim Öffnen, beim Zurückkommen auf die Seite (`loadChatList()`) und wenn das
  Fenster wieder sichtbar wird (`visibilitychange`). Mobil öffnet `openConversation()` den
  Verlauf jetzt selbst (`thread-open`), bevor der Lesestand zählt.
- In der Liste: Name fett und eine Marke „neu“. An „Chat“ in der Navigation und an den
  Direktnachrichten der Raum-Leiste eine Zahl; Vorleser hören „1 Unterhaltung mit neuen
  Nachrichten“.

**Tests:** `ungelesen.test.ts` (4): Regeln, Zähler, alte Unterhaltungen, Verdrahtung. Smoke
„fremdtext“ erweitert: Die versiegelte Nachricht eines Fremden steht fett mit „neu“ und der
Zahl 1 an „Chat“ da und ist nach dem Öffnen gelesen. Vor dem Fix rot.

**Prüfungen:** protocol 1252 grün (6 übersprungen), node 347, app 1014 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 11.3c3a – Agenten auf dem Gerät in privaten Räumen: eigenes MLS-Konto, Einladen

Dritter Teil von 11.3c (Entwurf P1, P2, P4, P6). 11.3c3 ist geteilt: c3a Konto und
Einladen, c3b Erwähnungen in privaten Räumen beantworten.

**Neu:**

- `packages/app/src/shell/agent-mls.ts`: `agentKonto()` – ein eigenes MLS-Konto je Agent
  (sein Schlüssel, eigener Kontobeweis, Zustand verschlüsselt in der IndexedDB
  `freedom-agenten-mls`, je Agent ein Eintrag, an ihn gebunden; Schlüssel des Zustands wie beim
  eigenen Konto im Tresor). `ladeAgentInPrivatenRaum()` – nur als Admin der Gruppe, nie als
  Gerät: KeyPackage auf dem Gerät erzeugen und sichern, über `mlsLadeAgentEin()` einladen,
  danach Raumstand, Budget, Karte (vom Agenten), Liste des Besitzers (alle seine Agenten in
  diesem Raum) und Pflicht-Hinweis – alles nur als innere Events. `entferneAgentAusPrivatemRaum()`.
- `shell/mls-konto.ts`: `mlsLadeAgentEin()` – wie `mlsLadeEin()`, aber das KeyPackage kommt vom
  Gerät, und die Einladung reicht ein eigenes Netz direkt an das Konto des Agenten; nur der
  Commit geht an die Relays der Gruppe.
- `shell/raum-mls.ts`: `sendeRaumstand()` aus `ladeInPrivatenRaum()` herausgelöst (auch für Agenten).
- `vault.ts`: `IndexedDbSpeicher` mit Eintrag je Schlüssel (Standard wie bisher „blob“);
  `duress.ts`: `freedom-agenten-mls` in `WIPE_DATENBANKEN`.
- Datenschutzbericht: „agent-raum“ (belegt, Regel `agent-raum-privat`, Szenario mit echter
  Engine: lokale Einladung, Karte, Liste, Erwähnung, Antwort – keine Einladung an ein Relay,
  kein Klartext, nur Gruppen-Nachrichten) und „agent-geraet“ (Grenze: der Provider liest den
  Verlauf des Kanals bis zur Erwähnung, auch was andere schrieben – nur mit Pseudonymen, ohne
  Raum), Texte de/en.

**Verdrahtet:** `raumAgentKarte`, `raumAgentenListe` sind damit aus `wiring-ausnahmen.txt`
heraus. Aufrufer von `ladeAgentInPrivatenRaum()` ist die Oberfläche (11.3e, Spur C);
beantwortet wird ab 11.3c3b.

**Prüfungen:** protocol 1252 grün (6 übersprungen), node 347, app 1013 (+3), Leak 73 + 1 todo;
mls 13; tsc ×3, Build, `check-wiring --streng` (0 offen), `check-website`, `check_innerhtml --streng`,
Smoke-Test, Website-Bau und reproduzierbarer Build grün.

## Schritt 11.3c3b – Agenten auf dem Gerät beantworten Erwähnungen in privaten Räumen

Letzter Teil von 11.3c – **11.3c Code fertig** (offene und private Räume).

**Neu:**

- `shell/agent-mls.ts`: Verlauf je Agent (verschlüsselt wie sein Zustand, Eintrag
  `verlauf:<agent>`); `agentAbgleichen()` holt die Nachrichten einer Gruppe in ihrer
  Reihenfolge – auch Commits, wer einen auslässt, liest danach nichts mehr – und legt sie
  vor dem Zustand in den Verlauf; zurückgehaltene Nachrichten nach einem Commit kommen
  später in den Verlauf. `agentRaum()` baut den Raum aus diesem Verlauf (Raumstand,
  Agenten an ihren Karten, Definition eines Admins für den Schalter der Agentenketten).
  `agentSendet()` schreibt als Agent in die Gruppe und gleich in seinen Verlauf; die
  Karte beim Einladen geht seitdem auch darüber.
- `shell/agenten-lauschen.ts`: `setzePrivatAuf()` – je Agent und Gruppe ein Abo an die
  Relays der Gruppe (`abonniereAn`, `limit: 1`), vorher nachholen ohne zu antworten,
  danach über `Nachziehen` nur Neues: Nachrichten nach dem Abo, die den Agenten
  erwähnen. `beantwortePrivat()` entscheidet mit dem Raum aus seinem Verlauf und
  antwortet als inneres Event (`raumAgentAntwort()`), den Hinweis „Budget aufgebraucht“
  ohne Erwähnung. Auftrag und Bezahlung teilen offene und private Räume
  (`frageUndZahle()`, aus 11.3c2 herausgelöst – unverändert).
- `agent-antwort.ts`: `entscheide()` nimmt wahlweise eine eigene Erkennung der Agenten
  (privat: Karten statt Rolle).
- `shell/app.ts`: Der Abruftakt prüft offene und private Räume (`agentenImTakt`); der Start
  nur offene – die MLS-Engine lädt nie beim Start. Nach dem Einladen in einen privaten
  Raum setzt `ladeAgentInPrivatenRaum()` die Abos gleich neu auf.

**Verdrahtet:** `shell/app.ts` (`abrufTakt.melde("agenten", agentenImTakt, 2)`),
`shell/agent-mls.ts` (nach Einladen und Entfernen). Damit sind `raumAgentAntwort` und
`raumAgentKarten` aus `wiring-ausnahmen.txt` heraus.

**Grenzen:** Nachrichten, die die Engine nach einem Commit zurückhält, kommen in den
Verlauf, werden aber nicht beantwortet. Mentions, während die App zu war, beantwortet
der Agent nicht (er holt sie nur nach).

**Prüfungen:** protocol 1252 grün (6 übersprungen), node 347, app 1019 (+2), Leak 73 + 1 todo;
mls 13; tsc ×3, Build, `check-wiring --streng` (0 offen), `check-website`, `check_innerhtml --streng`,
Smoke-Test, Website-Bau und reproduzierbarer Build grün.

## Schritt LIZ – Lizenz EUPL-1.2

Entscheidung des MENSCHEN vom 09.10.2026: **EUPL-1.2** (Option E). Copyleft auch über
das Netz, Namen und Marken nicht lizenziert (Art. 5), Recht und Gericht am Sitz des
Lizenzgebers (Art. 14, 15), amtlich auch auf Deutsch (Art. 13).

**Neu:**
- **`LICENSE`:** der englische Text von choosealicense (GitHub erkennt die Lizenz
  daran). Der Wortlaut ist gleich dem der SPDX-Liste; verglichen ohne Leerraum und
  Strichformen.
- **Lizenzfelder:** `"license": "EUPL-1.2"` in der Wurzel und in `app`, `mls`, `node`,
  `protocol`. Die Sperrdatei ist mit `npm install --package-lock-only` nachgezogen; ihr
  Diff enthält nur diese fünf Zeilen.
- **README:** Abschnitt „Lizenz“ mit dem Hinweis „Licensed under the EUPL“ und den
  Kernpunkten. Link zu allen Sprachfassungen bei Joinup; den Link kennt choosealicense,
  hier ist er nicht abrufbar (Proxy).
- **FAQ:** „Der Code ist quelloffen (Lizenz EUPL-1.2)“.
- **`CLAUDE.md`:**
  - STOPP-Punkt „neue Abhängigkeit“: jetzt auch mit Lizenz.
  - Fallstrick „Lizenz EUPL-1.2“.

**Abhängigkeiten:** Fast alle npm-Pakete stehen unter MIT, Apache, BSD oder ISC. In
`freedom.html` steckt `rpc-websockets` (über `@solana/web3.js`) unter LGPL-3.0. Die LGPL
steht im Anhang der EUPL, das passt.

**Zwei Funde im Spiegel-Skript:** `@ardrive/turbo-sdk` zieht zwei Pakete mit:
- `arweave-stream-tx` steht unter GPL-3.0.
- `@metamask/sdk` steht unter einer eigenen Lizenz von ConsenSys („All rights reserved“),
  über `x402` → `wagmi`.

Beide sind nicht in `freedom.html` (`turbo-sdk` ist im Build `external`) und nicht im
Knoten; sie laufen nur in `scripts/mirror/spiegeln.mts` im Release-Job. Wandert
`turbo-sdk` je in App oder Knoten, vorher prüfen.

**Nicht geändert:**
- **`packages/mls/crate`:** erbt `license` aus dem MDK-Arbeitsbereich (MIT).
- **Hülle und Solana-Programme:** tragen keine Angabe.
- Für jede Änderung dort gelten die Prüfungen des Bereichs (`bauen.sh --pruefen`,
  `cargo test`, `pruefen.sh`). Die Datei `LICENSE` in der Wurzel gilt für alles.

**Test:** `protocol/test/lizenz.test.ts` (+2):
- Prüfsumme von `LICENSE`, mit Gegenprobe.
- Jedes Paket und die Sperrdatei nennen EUPL-1.2.
- README mit Hinweis.

## Schritt L2-1, L2-2 – Frische Angebote vorn, Rückfall nach 20 s Stille (Lauf 2, Anhang F)

Befunde aus Lauf 2 des lokalen Agenten (Sammlung Anhang F); entschieden 09.10.2026
(MENSCH, L2-3): erst diese beiden, die netzweite Ausfall-Kenntnis später.

**L2-1 – ein toter Provider wurde gewählt:**

- `protocol/src/pruefung.ts`: `ANGEBOT_TAKT_SEK` (30 min, auch der Takt des Knotens in
  `main.ts`), `PRUEF_GRENZEN.veraltetSek` (zwei Takte plus fünf Minuten),
  `angebotVeraltet()`; `ordneNachPruefung()` stellt veraltete Angebote hinter alle
  frischen (auch hinter Herabgestufte), vor die gemessen Ausgefallenen.
- `app/src/matchmaking.ts`: je Provider nur das neueste Angebot; `matchProviders()`
  rechnet „veraltet“ je Auswahl mit der Uhr (der Angebots-Cache altert mit), eigene
  Provider unter sich frische vor veralteten; `jetzt` für Tests.

**L2-2 – Rückfall erst nach 5 min:**

- Knoten (`dvm-provider.ts`): `meldeBearbeitung()` – „processing“ (7000, versiegelt), sobald
  ein Auftrag angenommen ist: nach allen Ablehnungen, vor Werkzeugen und Rechnen, über
  Funk nie.
- App (`tabs/agent.ts`): `waitForAnswer()` liest Ergebnisse vor Rückmeldungen – bis hier
  hielt jede Rückmeldung (auch ein Zwischenstand) ein fertiges Ergebnis bis zur Frist auf;
  eine Ablehnung zählt vor Zwischenständen; „processing“ heißt warten; `stummNachMs`:
  ohne Lebenszeichen zurück.
- App (`tabs/agent-wege.ts`): nach `HEDGE_AFTER_MS` (20 s) ohne Lebenszeichen bekommt der
  nächste den Auftrag zusätzlich – nur wenn es einen gibt und nie mit Gutschrift im
  Zahlkanal (`perKanal()`); das letzte Ziel wartet mindestens bis zur Frist des ersten.

**Verdrahtet:** `shell/state.ts` (`findProviders()` → `matchProviders()`),
`shell/tabs/agent-wege.ts` (`askWithFailover()`), `node/src/dvm-provider.ts`
(`handleJob()`), `node/src/main.ts` (`CAPS_REFRESH_MS`).

**Knoten-Stand:** Ohne das Update schickt ein Knoten kein „processing“ – die App fragt
dann nach 20 s zusätzlich den nächsten (seine Antwort zählt weiter). Der GX10 auf `main`.

**Prüfungen:** protocol 1253 grün (+1, 6 übersprungen), node 350 (+3), app 1027 (+8; ein
Quelltext-Test folgt dem neuen Namen `fb`), Leak 73 + 1 todo; mls 13; tsc ×3, Build,
`check-wiring --streng` (0 offen), `check-website`, `check_innerhtml --streng`, Smoke-Test,
Website-Bau und reproduzierbarer Build grün.

## Schritt E9-3b – Modelle in der Selbstprüfung und im Status des eigenen Knotens

Zweiter Teil von E9-3 (Entwurf `docs/E9-ENTWURF.md`, V3 A, Freigabe 08.10.):
`pruefeEinrichtung()` sollte ungeprüfte Modelle mit eigener Kennung melden (wie B-11c), und den
Fortschritt beim Laden sieht der Besitzer über den Status des eigenen Knotens (B-11).

**Knoten:**
- **`modell-pruefung.ts` (neu):** `pruefeModelle()` liefert je Modell eine Kennung:
  - `modell.geprueft`: gegen das Manifest geprüft, Fingerabdruck bei Ollama gleich – mit
    Dateien und Bytes.
  - `modell.ungeprueft`: aus `PROVIDER_MODELS` angeboten, ohne Prüfung gegen ein Manifest.
  - `modell.veraendert`: Ollama hat unter dem Namen inzwischen etwas anderes.
  - `modell.fehltBeiOllama`: nicht bei Ollama, nicht im Angebot.
  - `modell.fehltImAngebot`: Ollama kennt keins – die Liste bleibt im Angebot (B-41), Aufträge
    scheitern.
  - `modell.ollamaStumm`: Ollama antwortete nicht, keine Aussage.
  - `modell.wartet`: gewünscht, noch nicht dran.
  - Das letzte gescheiterte Laden je Name, aus der Kennung von `ladeModell()` abgeleitet
    (`modellFall()`: `passt.nicht` → `modell.passtNicht`). Ein älteres Scheitern zählt nicht,
    wenn derselbe Name wieder gewünscht ist.
- **Sätze:** nur in `MODELL_TEXT`. `npm run modell` nimmt dieselben; seine eigene Tabelle fiel weg.
- **`npm run pruefen`:** zeigt die Modelle nach Lightning und SOL. Der Exit-Code hängt wie bisher
  nur an Lightning und SOL.
- **`main.ts`:**
  - Der Status an den Besitzer (5077) trägt `modellPruefung`: Befunde und was gerade lädt (aus
    `modelle.json`).
  - Ollama wird einmal je Angebot gefragt; Namen und Fingerabdrücke kommen aus derselben Antwort
    (`ollamaStand`).
  - Angebot und Status lesen `PROVIDER_MODELS` über `providerModelle()`.

**Protokoll** (`knoten-status.ts`, `docs/PROTOCOL.md` §24):
- **Neues Feld:** `modellPruefung` mit `befunde` (höchstens 30: Name, Stufe, `modell.…`, Werte
  wie bei `einrichtung`) und `laeuft` (Name, Schritt, seit, beim Laden Bytes).
- **Eigenes Feld, nicht in `einrichtung`:** Eine App vor E9-3b läse sonst den ganzen Status nicht
  mehr, sie übergeht das neue Feld.
- **Nichts Unlesbares:** `knotenStatusText()` schickt nichts, was `leseKnotenStatus()` abwiese.
  Ein Modellname aus der Umgebung mit Steuerzeichen fällt weg, statt den Status unlesbar zu
  machen.

**App** (`knoten-status-ansicht.ts`):
- **Anzeige unter „Einrichtung“:** „Modelle (Prüfung gegen das Manifest)“ mit einer Zeile je
  Modell (`modellZeile()`) und dem Fortschritt (`ladenZeile()`, Schritt, Anteil höchstens
  100 %).
- **Ältere Knoten:** Bei einem Knoten vor E9-3b steht das ehrlich da.
- **Texte:** je Kennung ein Text in beiden Sprachen (`MODELL_TEXT`). Ein Test vergleicht die
  Kennungen mit dem Knoten.

**Echt gestartet:** `npm run pruefen` gegen eine Ollama-Attrappe (`/api/tags`) mit gemerktem
Stand und Wünschen in einem frischen `HOME`. Die Ausgabe nennt:
- geprüft,
- verändert (anderer Fingerabdruck),
- ungeprüft (`nemotron-3.5-lightning` → `:latest`),
- fehlt bei Ollama,
- wartet,
- „braucht etwa 48 GB, das Gerät hat 32 GB“.

**Tests:**
- **protocol** `knoten-status.test.ts` (+2): Hin und zurück; alles Kaputte ist null; der
  Schreiber lässt Unlesbares weg.
- **node** `modell-pruefung.test.ts` (+7):
  - jede Kennung;
  - jeder Ausgang von `ladeModell()` hat einen Satz;
  - Weg durch den Provider (Antwort an den Besitzer, Name mit Steuerzeichen fällt weg);
  - Verdrahtung.
- **app** `knoten-status.test.ts` (+2): Zeilen, Fortschritt, Kennungen gleich denen des Knotens.
- **Angepasst, nicht abgeschwächt** (B-11b/c): Zwei Tests zählten die Zeilen der Anzeige. Dazu
  kommt die Zeile zu den Modellen; geprüft wird sie jetzt mit.

**Prüfungen:** protocol 1257 grün (+2, 6 übersprungen), node 356 grün (+7, ohne Netz 7
übersprungen; mit Netz 357), app 1029 (+2), Leak 73 + 1 todo, mls 13; tsc überall, Build,
`check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test, Website-Bau grün.

Knoten-Stand: `main` mit E9-3b, damit die App die Modelle im Status zeigt. Ohne Update steht dort
„dieser Knoten meldet keine Prüfung“.

## Schritt B-29a – KI-Antrieb wählbar (OpenAI-kompatibel: vLLM, SGLang, TensorFold)

Erster Teil von B-29 (Sammlung, Anhang E). Der Knoten sprach nur Ollama. Ollama arbeitet
gleichzeitige Anfragen von Haus aus nacheinander ab; vLLM, SGLang und TensorFold bündeln sie.
B-29 ist dreigeteilt:
- **B-29a (dieser Schritt):** Antrieb wählbar.
- **B-29b:** Messskript – dasselbe Modell, Durchsatz bei einer und bei N gleichzeitigen Anfragen.
- **B-29c:** Gewichte außerhalb von Ollama gegen das Manifest prüfen.

TensorFold ist OpenAI-kompatibel, die Sammlung hatte „prüfen“ vermerkt.

**Knoten:**
- **`ki-antrieb.ts` (neu):** `antriebAusUmgebung()` wählt über `KI_ANTRIEB`:
  - `ollama` (Vorgabe): `OLLAMA_URL` wie bisher.
  - `openai`: `KI_URL` mit `/v1` (Vorgabe vLLM `http://127.0.0.1:8000/v1`), optional
    `KI_SCHLUESSEL` als Bearer.
- **`KI_URL` nur dieser Rechner oder das Heimnetz** (`lokaleAntriebAdresse()`): localhost, private
  Adresse, Name ohne Punkt (Docker-Dienst), `.local`/`.lan`/`.internal`/`.home.arpa`; ohne
  Zugangsdaten. Ein Dienst im Internet wäre ein Dritter, der die Fragen der Kunden liest.
  Ungültig → der Knoten startet nicht, nie still Ollama.
- **`inference.ts`:** Alle Aufrufe (Werkzeug-Schleife, Swarm, Richter, Strom) gehen über `rufe()`.
  - Ollama: `/api/chat` wie bisher.
  - OpenAI-kompatibel: `/chat/completions` mit `max_tokens`. Werkzeug-Argumente kommen als
    JSON-Text, die Antwort des Werkzeugs trägt `tool_call_id` (`werkzeugRunde()`).
  - Fehler des Dienstes nur mit Status, nie mit seinem Text (der kann die Frage enthalten).
  - Der Strom kommt in einem Stück, ohne Denkspur wie bei Ollama.
  - Systemprompt, Werkzeuge und `ohneWerkzeuge` sind für beide gleich.
- **Modelle:** `antriebModelle()` fragt `/v1/models`, nur Kennungen (begrenzt, ohne
  Steuerzeichen) und ohne Fingerabdruck. Ins Angebot kommt aus `PROVIDER_MODELS`, was der Antrieb
  nennt (B-41 wie bisher).
- **Geprüft laden** (`ModellDienst`) geht nur mit Ollama. Mit einem anderen Antrieb:
  - wartet der Takt, und das Log sagt es;
  - nennt `pruefeModelle(…, antrieb)` eigene Kennungen: `modell.nurOllama`,
    `modell.ungeprueftAntrieb`, `modell.fehltBeimAntrieb`, `modell.antriebKenntKeins`,
    `modell.antriebStumm`, `modell.ladenNurOllama`;
  - heißt nie etwas „geprüft“.
- **`npm run pruefen`:** fragt den gewählten Antrieb. Bei ungültiger Einstellung zeigt es
  „✗ KI-Antrieb: …“ und endet mit 1.

**App:** je neue Kennung ein Text in beiden Sprachen (`knoten-status-ansicht.ts`,
`texte/settings.ts`). Der Test aus E9-3b vergleicht die Kennungen mit dem Knoten.

**Doku:**
- `docs/PROVIDER.md` (Abschnitt „KI-Antrieb“, mit den Schaltern für Werkzeug-Aufrufe bei vLLM und
  SGLang).
- `docker-compose.yml` reicht `KI_ANTRIEB`, `KI_URL`, `KI_SCHLUESSEL` durch.
- Fallstrick in `packages/node/CLAUDE.md`.
- Sammlung (B-29 geteilt), FORTSCHRITT.

**Echt gestartet:** `npm run pruefen` gegen eine OpenAI-Attrappe (`/v1/models`) in einem frischen
`HOME`, mit Schlüssel:
- Das bekannte Modell erscheint als „angeboten, aber nicht gegen ein Manifest geprüft … mit diesem
  KI-Antrieb geht das noch nicht“.
- Das unbekannte Modell erscheint als „der KI-Antrieb (KI_URL) kennt das Modell nicht“.
- Die Attrappe bekam den Schlüssel; in der Ausgabe steht er nicht.
- Mit `KI_URL=https://api.example.com/v1`: „✗ KI-Antrieb: KI_URL muss auf diesen Rechner oder ins
  Heimnetz zeigen …“, Exit 1.

Der erste Lauf zeigte bei OpenAI noch den Rat „npm run modell -- <name> --aus-registry“, der dort
nicht hilft. Daher gibt es jetzt die eigene Kennung `modell.ungeprueftAntrieb`.

**Tests:**
- **node** `ki-antrieb.test.ts` (+9):
  - Adressregeln;
  - Wahl aus der Umgebung;
  - Anfrage mit Systemprompt, Werkzeugen, Grenze, Schlüssel;
  - `ohneWerkzeuge`;
  - Werkzeug-Runde mit `tool_call_id`;
  - Fehler ohne Text des Dienstes;
  - Strom ohne Denkspur;
  - Modellliste;
  - Selbstprüfung mit OpenAI;
  - Verdrahtung (kein Schlüssel in Log-Zeilen).
- **Angepasst, nicht abgeschwächt:**
  - `modell-laden.test.ts` und `modell-pruefung.test.ts` erwarten den Aufruf über
    `antriebModelle(antrieb)`.
  - `angebot-modell.test.ts` prüft jetzt, dass die gesuchte Stelle gefunden wird. Vorher wäre ein
    `indexOf` von -1 still durchgegangen.

**Prüfungen:** Alle Befehle aus CLAUDE.md auf `01a6fc1` (`main` c6bc12c + B-29a), `GESAMT fail=0`: protocol 1257 grün (6 übersprungen), node 365 grün (+9, ohne Netz 7 übersprungen; mit Netz 366), app 1029, Leak 73 + 1 todo, mls 13; tsc überall, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test, Website-Bau grün.

Knoten-Stand: kein Update nötig – ohne `KI_ANTRIEB` arbeitet der Knoten wie bisher mit Ollama.

## Schritt B-29b – Messskript für den KI-Antrieb

Zweiter Teil von B-29 (Sammlung, Anhang E): Welcher Antrieb auf dem GX10 läuft (Ollama, vLLM,
SGLang, TensorFold), entscheidet eine Messung (MENSCH, M-7). Gemessen wird dasselbe Modell bei
einer und bei N gleichzeitigen Anfragen.

**Knoten:**
- **`messung.ts` (neu):**
  - `leseMessWunsch()`: Aufruf geprüft – höchstens 8 Stufen von 1 bis 64, 1 bis 512 Anfragen,
    16 bis 4096 Tokens; sonst ein Grund.
  - `missStufe()`: höchstens N Anfragen zugleich, bis alle gestellt sind. Feste, wechselnde
    Übungsfragen über `complete()` mit `ohneWerkzeuge` – derselbe Weg wie echte Anfragen, ohne
    Websuche. Fehler nur mit Namen.
  - `werteAus()`: Tokens je Sekunde über die Wanduhr, Antworten je Minute, Median und p95.
    Tokens je Sekunde nur, wenn der Antrieb sie für jede Anfrage nennt – sonst „–“, nie
    hochrechnen.
  - `messTabelle()`: der Faktor gegenüber der ersten Stufe, über Tokens oder (wenn nicht alle sie
    haben) über Antworten je Minute, nie gemischt.
- **`npm run messen` (`messen.ts`):**
  - nimmt den Antrieb wie der Knoten (`antriebAusUmgebung()`) und das Modell aus `--modell` oder
    das erste aus `PROVIDER_MODELS`;
  - wärmt mit einer Anfrage auf, die nicht zählt;
  - zeigt Antworten nie;
  - bei Ollama mit dem Hinweis auf `OLLAMA_NUM_PARALLEL`;
  - Exit 1 bei ungültigem Aufruf, ungültigem oder stummem Antrieb, gescheitertem Aufwärmen.

**Doku:** `docs/PROVIDER.md` (Abschnitt „Welcher Antrieb? Messen“), Fallstrick in
`packages/node/CLAUDE.md`, Sammlung und FORTSCHRITT (B-29b ✓).

**Echt gestartet:** `npm run messen -- --gleichzeitig 1,4,8 --tokens 100` gegen zwei
OpenAI-Attrappen mit 200 ms je Antwort:

| gleichzeitig | nacheinander (wie Ollama ab Werk) | bündelnd (wie vLLM) |
|---|---|---|
| 1 | Faktor 1,00, Median 0,20 s | Faktor 1,00, Median 0,20 s |
| 4 | Faktor 1,01, Median 0,80 s | Faktor 3,91, Median 0,21 s |
| 8 | Faktor 1,01, Median 1,61 s | Faktor 7,88, Median 0,21 s |

Jeweils Exit 1 mit eigenem Satz bei:
- falschem Modell („Aufwärmen gescheitert (Error) – stimmt der Modellname beim Antrieb?“);
- `--gleichzeitig 0`;
- einer Adresse im Internet;
- einem nicht erreichbaren Antrieb.

**Tests:** node `messung.test.ts` (+6):
- Aufruf (Vorgaben, Sortierung, zwölf ungültige Fälle);
- höchstens N zugleich, ohne Werkzeuge, mit Modell und Grenze, Fragen wechseln;
- Fehler nur mit Namen;
- Auswertung (Wanduhr, Median, p95, ohne Tokens keine Zahl, Faktor nie gemischt);
- durch den echten Antrieb (OpenAI-kompatibel und Ollama);
- Verdrahtung (keine Antworten, kein Schlüssel auf dem Bildschirm).

**Prüfungen:** Alle Befehle aus CLAUDE.md auf `88874ee` (`main` 25bbb19 + B-29b), `GESAMT fail=0`: protocol 1257 grün (6 übersprungen), node 371 grün (+6, ohne Netz 7 übersprungen; mit Netz 372), app 1029, Leak 73 + 1 todo, mls 13; tsc überall, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test, Website-Bau grün.

Knoten-Stand: kein Update nötig – das Skript läuft am Knoten, wenn der MENSCH misst.

## Schritt 11.3d1a – Agent auf dem Knoten: offene Räume, „wer fragt, zahlt“

Erster Teil von 11.3d (Karte `phase-11.md`, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P4, P5, F5; an
Spur B übergeben 09.10.). 11.3d ist geteilt:
- **d1a (dieser Schritt):** der Knoten, offene Räume, „wer fragt, zahlt“.
- **d1b:** die App zeigt den Preis und schickt den Auftrag mit Verweis.
- **d2:** private Räume mit einem MLS-Konto im Knoten.
- **d3:** Budget des Einladers (Pfand im Zahlkanal), nach M-2.

**Protokoll** (`agent-raum.ts`, neu):
- Aus der App (`agent-antwort.ts`, 11.3c2a) hierher gezogen: `entscheide()` (neu mit `ausBudget`),
  `istAgentIm()`, `darfSchreibenIm()`, `agentAntwortEvent()`, `agentHinweisEvent()` und der Prompt als
  `agentPromptMit()` mit festen Grenzen. App und Knoten entscheiden so mit denselben Regeln.
- Die App behält ihre Schnittstelle; `agentPrompt()` nimmt die Grenzen aus `VERLAUF_UMFANG`.
- **Neu: `definitionDesGruenders()`.** Die Definition hat `d` = `space:<kennung>`. Die App suchte bis
  hier nach `d` = `<kennung>` und fand den Schalter der Agentenketten nie, Ketten blieben in offenen
  Räumen immer aus. Behoben in `shell/agenten-lauschen.ts` (Spur A, eine Zeile).

**Knoten** (`knoten-agent.ts`, neu):
- **Einstellung:** `KNOTEN_AGENT=1` mit `AGENT_NAME` (Pflicht), `AGENT_ABOUT`, `AGENT_PERSONA`,
  `AGENT_MODELL`, `AGENT_BESITZER`; ungültig → kein Start.
- **Schlüssel:** eigener in `~/.freedom/agent-key` (0600, über `ladeKnotenSchluessel()`), nie der des
  Knotens (geprüft).
- **Karte** (38090, Knoten, „wer fragt“, `provider` = der Knoten) beim Start und mit jedem Erneuern
  des Angebots; die Persona steht nicht darin.
- **Auftrag** (`dvm-provider.ts`):
  - Ein Verweis (`leseAuftragsVerweis()`) nur aus einem Umschlag.
  - `KnotenAgent.pruefe()` nach der Zahlungsprüfung, vor dem Rechnen. Die Erwähnung muss es im Raum
    geben (signiert, Kind 42, Kennung), mit dem Stand des Raums und `entscheide()` mit
    `ausBudget: false` – nie auf Agenten.
  - Gerechnet wird nur Persona, Verlauf und Erwähnung aus dem Raum, nie die Eingabe des Auftrags.
  - Erst die Antwort im Raum (Kind 42 vom Agenten), dann das Ergebnis versiegelt an den Fragenden.
  - Scheitert das Rechnen, ist die Erwähnung wieder frei.
- **Einmal:** Jede Erwähnung beantwortet er höchstens einmal (`agent-beantwortet.json`, nur Ids, 0600).
- **Ablehnungen:** vor dem Rechnen als `AgentAbgelehnt` mit `["fall", …]` in der Rückmeldung – nie mit
  Text aus dem Raum oder von Relays.

**Doku:**
- `docs/PROVIDER.md` (Abschnitt „Agent auf dem Knoten“), `docs/PROTOCOL.md` §32 (Prüfung, Kennungen).
- Fallstricke in `packages/node`, `packages/protocol`, `packages/app`.
- Karte `phase-11.md` (11.3d geteilt), FORTSCHRITT, `docker-compose.yml`.

**Echt gestartet:** der Knoten mit eigenem Relay (`RELAY_ENABLED=1`), Agent an, OpenAI-Attrappe als
Antrieb (B-29a). Ein Skript spielt Raum, Rollen, Erwähnung und einen versiegelten, bezahlten Auftrag
über `ws://` durch:
- Die Karte ist da („Lektor, knoten, fragender, provider = der Knoten“).
- Die Antwort steht im Raum vom Agenten (`space`, `h`, `e` … `reply` auf die Erwähnung, `p` … `mention`
  des Fragenden).
- Ein zweiter bezahlter Auftrag für dieselbe Erwähnung bringt keine zweite Antwort; im Log steht nur
  „agent-schon-beantwortet“.
- Kein Klartext im Log; `agent-key` und `agent-beantwortet.json` mit 0600.

**Tests:**
- **protocol** `agent-raum.test.ts` (+2): Definition des Gründers (`space:<kennung>`, nur vom Gründer,
  die neueste); „wer fragt, zahlt“ nie auf Agenten; Prompt mit festen Grenzen.
- **node** `knoten-agent.test.ts` (+7):
  - Einstellung;
  - Karte;
  - der ganze Weg durch den Provider (Prompt aus dem Raum statt der Eingabe, Antwort im Raum und
    versiegelt, bezahlt, kein Klartext im Log);
  - einmal, auch nach einem Neustart;
  - Ablehnungen mit Kennung;
  - offen abgelehnt;
  - Verdrahtung.
- **app:** unverändert grün (die Bausteine kommen jetzt aus dem Protokoll).

**Prüfungen:** Alle Befehle aus CLAUDE.md auf `d87e0d0` (`main` cf3c89a + 11.3d1a): protocol 1259 grün (+2, 6 übersprungen), app 1029, Leak 73 + 1 todo, mls 13; tsc überall, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test, Website-Bau grün. Knoten im ersten Lauf 376 grün, 2 rot: Die Verdrahtungstests aus B-12a und B-13a lesen „keypair, weckBuch, turn,“ zusammenhängend, und `agent: knotenAgent` stand dazwischen – jetzt dahinter (Tests unverändert); danach node 378 grün (+7, ohne Netz 7 übersprungen; mit Netz 379), `check-wiring --streng` Exit 0.

Knoten-Stand: `main` mit 11.3d1a, nur wer einen Agenten auf dem Knoten will (`KNOTEN_AGENT=1`); sonst
kein Update nötig.

## Schritt 11.3d1b1 – Agenten per „@Name“ erwähnen

Erster Teil von 11.3d1b (App), geteilt: **d1b1** Erwähnen per Name, **d1b2** der bezahlte Auftrag an
einen Agenten auf dem Knoten (Preis, Verweis, Datenschutz). Anlass: Die App setzte in Räumen eine
Erwähnung nur beim Antworten (erwähnt wird der Autor). Einen Agenten, der noch nichts geschrieben
hatte, konnte niemand ansprechen – weder auf dem Gerät (11.3c) noch auf dem Knoten (11.3d1a).

**Protokoll** (`agent-raum.ts`):
- `erwaehnteAgenten(text, karten)`:
  - „@Name“ als ganzes Wort, ohne Groß- und Kleinschreibung;
  - nur aus den gegebenen Karten, nie aus dem Text allein;
  - höchstens fünf (`AT_ERWAEHNUNGEN`), in der Reihenfolge des Textes;
  - teilen sich zwei Agenten einen Namen, erwähnt sie keinen – nie den falschen.

**App** (`shell/tabs/raeume.ts`, Spur C, klein gehalten):
- **Offener Raum:** Beim Öffnen lädt die App die Karten der Mitglieder mit der Rolle `agent`
  (`agentKartenIm()`, `aktuelleAgentKarten()`).
- **Privater Raum:** Karten der Gruppe (`raumAgentKarten()`).
- **Beim Senden** kommen die erwähnten Agenten in den Bezug, offen als `p` … `mention`, privat im
  inneren Event. Die Sendezeilen selbst bleiben, wie der Leak-Test und der Test aus 11.4c sie lesen.
- Das gilt für Agenten auf dem Gerät wie auf dem Knoten. Ein Agent auf dem Knoten antwortet erst mit
  d1b2, wenn jemand den Auftrag bezahlt.

**Doku:** `docs/PROTOCOL.md` §32, Fallstrick in `packages/app/CLAUDE.md`, Karte `phase-11.md`,
FORTSCHRITT.

**Tests:**
- **protocol** `agent-raum.test.ts` (+1): 13 Fälle (Satzende, Klammern, zwei Namen, Mail-Adresse,
  Wortteil, doppelter Name, Sonderzeichen im Namen), höchstens fünf, ohne Karten niemand.
- **app** `agent-antwort.test.ts` (+1): Verdrahtung – Karten offen und privat, Erwähnungen in den
  Bezug, beide Sendewege.
- **Angepasst, nicht abgeschwächt** (`raum-thread.test.ts`, C.2c): `bezug` ist jetzt `let` mit Typ;
  der Test prüft weiter, dass er aus `antwortBezug()` kommt.

**Erster Prüflauf:** drei rote Prüfungen, alle durch eigene Änderungen.
- Der Test aus 11.4c und der Leak-Test „private Räume senden über MLS“ lesen die Zeilen in
  `raeume.ts` wörtlich. Meine erste Fassung hatte dort eine eigene Variable `erwaehnt`. Jetzt laufen
  die Erwähnungen über `bezug`, und beide Tests sind unverändert grün.
- `check-wiring --streng`: Zwei Ausnahmen waren veraltet (`aktuelleAgentKarten`, `leseAgentKarte`
  sind jetzt verdrahtet), sie sind entfernt.

**Prüfungen:** Alle Befehle aus CLAUDE.md auf `fe2c85b` (`main` b223939 + 11.3d1b1), `GESAMT fail=0`: protocol 1260 grün (+1, 6 übersprungen), node 378 grün (ohne Netz 7 übersprungen; mit Netz 379), app 1030 (+1), Leak 73 + 1 todo, mls 13; tsc überall, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test, Website-Bau grün.

Knoten-Stand: kein Update nötig.

## Schritt 11.3d1b2 – Agenten auf dem Knoten fragen: Preis, Auftrag, Verweis

Zweiter Teil von 11.3d1b (App), nach d1b1 („@Name“). Seit 11.3d1a beantwortet ein Agent auf dem Knoten
eine Erwähnung nur, wenn ihm jemand einen bezahlten, versiegelten Auftrag mit Verweis schickt („wer
fragt, zahlt“). Diesen Auftrag schickt jetzt die App.

**App:**
- **`knoten-agent-wahl.ts` (neu, ohne DOM):**
  - `zuBezahlen()`: nur erwähnte Agenten, deren Karte `knoten`, `fragender` und den Knoten (`provider`)
    nennt; in der Reihenfolge der Erwähnungen, jeder einmal, nie man selbst.
  - `ablehnungsText()`: ein Text je Kennung aus PROTOCOL §32, Unbekanntes mit der Kennung – nie Text
    vom Knoten.
- **`shell/knoten-agent-fragen.ts` (neu):** `frageKnotenAgenten()` nach dem Senden im offenen Raum.
  - Je Agent prüft die App zuerst den Knoten: Er braucht ein Angebot für versiegelte Aufträge
    (`privatFaehig()`).
  - Danach den Zahlweg: Mit SOL geht es nur mit Zahlkanal; mit Lightning braucht es eine Wallet und eine
    Adresse des Knotens.
  - Erst dann zeigt sie den Preis: höchstens 100 sats wie bei Agenten auf dem Gerät, dazu die Rate aus
    dem Angebot, in sats und SOL.
  - Ohne Bestätigung geht nichts hinaus.
- **`shell/bezahlter-auftrag.ts` (neu):** der Auftrag.
  - Versiegelt von einem frischen Sitzungsschlüssel je Frage.
  - Im Kern eine feste Eingabe und der Verweis (`auftragsVerweisTags()`: Adresse des Raums, Id der
    Erwähnung).
  - Bezahlt wie jede KI-Anfrage: Lightning nach A+, höchstens das Gebot, oder eine Gutschrift im
    Zahlkanal.
  - Ablehnungen kommen nur mit ihrer Kennung zurück.
  - Derselbe Weg wie `frageUndZahle()` in `agenten-lauschen.ts` (11.3c, Spur A). Dort ist er mit dem
    Budget des Erstellers verflochten und bleibt unverändert.
- **Kein zweiter Versuch von selbst:** Im Zahlkanal bliebe die Gutschrift der ersten Anfrage offen, die
  zweite läge ein Gebot höher.
- **`shell/tabs/raeume.ts` (Spur C, klein gehalten):**
  - Die Karten im offenen Raum tragen jetzt `betrieb`, `bezahlung`, `provider`, `modell`.
  - Nach `publish(ev)` ruft der offene Weg `frageKnotenAgenten()` auf; der private Weg ruft es nie auf
    (Gruppen kommen mit 11.3d2).

**Datenschutz:** neue Grenze „agent-knoten“ (Protokoll, Bericht in beiden Sprachen):
- Der Knoten kann den Auftrag der öffentlichen Nachricht zuordnen.
- Über einen Zahlkanal kann er so auch deine anderen Anfragen über diesen Kanal zuordnen.
- Die Antwort steht öffentlich im Raum.
- Relays sehen nur den Umschlag.

**Doku:**
- `docs/PROTOCOL.md` §32 und `docs/PROVIDER.md` („Fragen“; „Noch nicht“ ohne d1b).
- Fallstrick in `packages/app/CLAUDE.md`.
- Karte `phase-11.md`, FORTSCHRITT.

**Tests:**
- **app** `knoten-agent-fragen.test.ts` (+4):
  - Auswahl, mit Gerät, Einlader, ohne Knoten, sich selbst, Reihenfolge und Dopplung.
  - Der Verweis steht nur im versiegelten Kern: außen nur `p`, die Id nicht im Chiffrat. Der Knoten
    liest den Verweis, Absender ist der Sitzungsschlüssel.
  - Jede Kennung aus dem Quelltext des Knotens hat einen Text in beiden Sprachen mit `{name}`, die
    Preistexte nennen Preis und Rate.
  - Verdrahtung:
    - nur offen und erst nach dem Senden;
    - Zahlweg und Wallet vor dem Preis, Bestätigung vor dem Auftrag;
    - frischer Schlüssel, feste Eingabe, Verweis nur in `extraTags`;
    - nur der Umschlag geht hinaus, das Gebot ist vorher gemerkt, abgerechnet über `rechneAntwortAb()`.
- **protocol** `privacy-facts.test.ts`: „agent-knoten“ in der Liste der Aussagen ohne Leak-Regel; was der
  Knoten nach dem Öffnen liest, sieht kein Mitschnitt.

**Prüfungen:**
- protocol 1260 grün (6 übersprungen); node 378 grün (7 übersprungen – der Live-Abruf in
  `tools.test.ts` ohne Netz, 385 wie vorher); app 1034 grün (vorher 1030); mls 13 grün;
  Leak-Tests 73 grün + 1 `todo` (unverändert).
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und
  `build-site.sh`: grün.
- Erster Lauf: `check-wiring --streng` rot – die Ausnahme für `auftragsVerweisTags` war veraltet
  (jetzt verdrahtet). Sie ist entfernt.

**MENSCH (Geld, Devnet/Testnet):** einen Knoten mit `KNOTEN_AGENT=1` in einen offenen Raum holen
(Rolle `agent`), ihn mit „@Name“ erwähnen, den Preis bestätigen.
- Mit Lightning-Testnet-Wallet: Antwort im Raum, Zahlung höchstens 100 sats.
- Mit Zahlkanal auf Devnet: Gutschrift höchstens 100 sats zum Kurs des Knotens.
- Ein zweites „Fragen“ zur selben Nachricht: „schon beantwortet“, nichts bezahlt.

Knoten-Stand: `main` mit 11.3d1a – wer einen Agenten auf dem Knoten betreibt, hat ihn schon; sonst kein
Update nötig.

## Schritt 11.3d2a – Agent auf dem Knoten tritt privaten Räumen bei

Erster Teil von 11.3d2 (private Räume), geteilt:
- **d2a (dieser Schritt):** das MLS-Konto im Knoten.
- **d2b:** antworten in privaten Räumen.
- **d2c:** die App lädt Knoten-Agenten ein und bezahlt Fragen.

**MENSCH 10.10.2026:**
- Schalter `besitzer|alle`.
- Raumstand verschlüsselt auf der Platte, Chat nur im Speicher.

**Knoten:**
- **`knoten-mls.ts` (neu):** eigenes MLS-Konto mit dem Schlüssel des Agenten (nie dem des Knotens). Die
  Engine kommt aus `@freedomstack/mls`, der Kontobeweis über `signiereId()`.
  - **Veröffentlicht:** Relay-Listen (10002, 10050) und ein KeyPackage (30443, fester Platz, neu nach jedem
    Beitritt).
  - **Einladungen** nur mit `AGENT_PRIVAT`:
    - `besitzer` – nur von `AGENT_BESITZER`;
    - `alle` – von jedem;
    - höchstens 20 Gruppen.
  - **Nach dem Beitritt** die Karte als inneres Event (Knoten, „wer fragt, zahlt“).
  - **Abgleich** alle 15 Sekunden: Einladungen, dann je Gruppe alle Nachrichten in ihrer Reihenfolge.
    Was die Engine zurückhält, kommt mit `fortschreiten()`; was sie dabei sendet, geht an die Gruppe.
  - **Auf der Platte nur verschlüsselt** (AES-256-GCM wie `MlsZustand` der App, alles 0600):
    - `agent-mls.json` (Schlüssel, Platz) – beschädigt heißt kein Start, nie ersetzt;
    - `agent-mls.zustand`;
    - `agent-mls.raumstand` (Definition, Rollen, Zuweisungen, Karten, Agentenlisten).
  - **Chat** nur im Speicher, je Gruppe die letzten 50.
  - **Fremde Relays** einer Gruppe nur `wss://`, plausibel und geprüft (ohne Tor `checkUrlSafe()`),
    höchstens 10.
- **`main.ts`:**
  - Relays entstehen weiter an einer Stelle (`relayAn`, über Tor wie alle).
  - Einladungen im eigenen Relay liest der Agent über `alsRelay(agent)` – als Knoten angemeldet sähe er
    keine Umschläge an sich.
  - Ins Log nur Kennungen und Zahlen. Ein leerer Posteingang (kein öffentliches Relay) wird gesagt.
- **Docker-Image** mit `packages/mls` (Quelle und gebaute Engine).

**Befund:** Die Engine (MDK) behält verarbeitete Nachrichten in ihrem Zustand und stellt sie nach einem
Neustart erneut zu, wenn die Relays sie noch haben.
- Der Knoten legt keinen eigenen Chat-Verlauf an. Die Engine behält ihn aber wie bei jedem Mitglied in
  ihrem verschlüsselten Zustand.
- Datenschutzaussage, `PROVIDER.md` und Fallstrick sagen das so.
- Für 11.3d2b: Ein erneut zugestelltes „neu“ heißt nicht „unbeantwortet“.

**Datenschutz:** neue Grenze „agent-knoten-privat“ (Protokoll, Bericht in beiden Sprachen) – der Knoten
liest alles im Raum mit, was er wie ablegt, und dass der Betreiber den Schalter setzen muss.

**Protokoll:** `signiereId()` (BIP-340 über eine fertige Kennung) für Brücken, die nur die Kennung reichen.

**Doku:**
- `docs/PROVIDER.md` (private Räume, Dateien, Sicherung).
- `docs/PROTOCOL.md` §32.
- Fallstrick in `packages/node/CLAUDE.md` – Ausnahme von „Kein Klartext im Knoten“, nur hier.
- Karte `phase-11.md`, FORTSCHRITT, `docker-compose.yml` (`AGENT_PRIVAT`).

**Echt gestartet:**
- **Aufbau:** der Knoten mit eigenem Relay (`ws://127.0.0.1`), `KNOTEN_AGENT=1`, `AGENT_PRIVAT=alle`,
  OpenAI-Attrappe. Ein Gründer-Skript (wie die App, echte Engine, über WebSocket) holt das KeyPackage des
  Agenten, gründet einen privaten Raum, lädt ihn ein und sendet Raumstand und eine Erwähnung.
- **Ergebnis:**
  - Im Log nur „[agent] privatem Raum beigetreten (1 Gruppen)“.
  - Der Gründer liest die Karte des Agenten in der Gruppe („Lektor, knoten, fragender“, vom Agenten,
    `provider` gesetzt).
  - Die Dateien sind 0600 (Zustand 3,6 MB).
  - Der Probetext steht weder im Log noch in einer Datei.
- **Befund:** Der Posteingang (10050) war leer – nur `127.0.0.1` in `RELAYS`, das ist kein brauchbarer
  Posteingang. Das sagt der Knoten jetzt im Log.

**Tests:**
- **node** `knoten-mls.test.ts` (+7), mit der echten Engine und einem Gründer wie in der App:
  - Listen und KeyPackage;
  - Einladung annehmen, Karte beim Gründer;
  - Raumstand und Chat;
  - Ablage verschlüsselt (0600, kein Klartext), Neustart, beschädigte Schlüsseldatei;
  - Schalter `besitzer` und Grenze;
  - fremde Relays;
  - Posteingang im eigenen Relay;
  - `AGENT_PRIVAT`;
  - Verdrahtung.
- **protocol** `event.test.ts` (+1): `signiereId()`.
- **Angepasst, nicht abgeschwächt** (`tor.test.ts`): Die Fabrik heißt jetzt `relayAn`. Der Test prüft
  weiter, dass es genau eine Stelle mit `new WebSocketRelay(` gibt und dass `RELAYS` über sie verbunden
  wird.

**Prüfungen:**
- protocol 1261 grün (6 übersprungen, vorher 1260); node 385 grün (7 übersprungen – der Live-Abruf in
  `tools.test.ts` ohne Netz; vorher 378 + 7); app 1034 grün; mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und `build-site.sh`:
  grün.

**MENSCH:** Am GX10 mit `AGENT_PRIVAT=besitzer` und `AGENT_BESITZER` starten; die Dateien
`~/.freedom/agent-mls.*` mit `agent-key` sichern.

Knoten-Stand: `main` mit 11.3d2a, nur wer private Räume für den Agenten will (`AGENT_PRIVAT`); sonst kein
Update nötig. Das Docker-Image enthält jetzt `packages/mls`.

## Schritt 11.3d2b – Agent auf dem Knoten antwortet in privaten Räumen

Zweiter Teil von 11.3d2. Seit 11.3d2a ist der Agent Mitglied privater Räume (`AGENT_PRIVAT`); jetzt
antwortet er dort wie im offenen Raum. Er antwortet nur auf einen bezahlten, versiegelten Auftrag mit
Verweis („wer fragt, zahlt“).

**Knoten** (`knoten-agent.ts`):
- **`pruefePrivat()`:** ein Verweis mit Gruppen-Id statt Adresse.
  - Nur Gruppen, in denen der Agent Mitglied ist (`nutzePrivat()` mit dem Konto aus 11.3d2a); sonst
    `agent-privat`.
  - Der Raum kommt aus dem, was der Agent als Mitglied liest (`gruppenRaum()` mit Admins und
    Mitgliedern aus MLS). Die Definition gilt nur von einem Admin, Agenten erkennt er an ihrer Karte.
  - Entschieden wird mit `entscheide()` und `ausBudget: false`, wie im offenen Raum.
  - Fehlt die Erwähnung im Gelesenen, gleicht er einmal ab.
- **Gerechnet** werden nur Persona, Verlauf und Erwähnung aus der Gruppe, nie die Eingabe des Auftrags.
- **Antwort:** als inneres Event der Gruppe (`raumAgentAntwort()` über `KnotenMls.sende()`), nie offen.
  Dieselbe Antwort geht versiegelt an den Fragenden.
- **Jede Erwähnung höchstens einmal.** Die Ablehnungen tragen dieselben Kennungen wie im offenen Raum.

**Protokoll (Befund):**
- MDK vergibt Gruppen-Ids mit 16 Byte (32 Zeichen Hex). Der Verweis (`auftragsVerweisTags()`, 11.3b2)
  verlangte 64 Zeichen – keine echte Gruppe passte.
- Jetzt gilt wie bei Meldungen: 32 bis 64 Zeichen.
- Gefunden im echten Lauf, nicht von den Tests: Die nahmen `"ee".repeat(32)`.

**Doku:**
- `docs/PROTOCOL.md` §32 (Verweis mit Gruppe, Antwort in privaten Räumen) und `docs/PROVIDER.md`.
- Fallstricke in `packages/node/CLAUDE.md` und `packages/protocol/CLAUDE.md`.
- Karte `phase-11.md`, FORTSCHRITT.

**Echt gestartet:**
- **Aufbau:** Knoten mit eigenem Relay, `AGENT_PRIVAT=alle`, OpenAI-Attrappe. Das Gründer-Skript (echte
  Engine, WebSocket):
  - gründet einen privaten Raum mit dem Agenten;
  - schreibt einen Satz und, eine Sekunde später, die Erwähnung;
  - schickt einen versiegelten Auftrag mit der Gruppe im Verweis.
- **Ergebnis:**
  - Die Antwort steht in der Gruppe vom Agenten (`h` allgemein, `e` … `reply` auf die Erwähnung, `p` …
    `mention` des Fragenden).
  - Kein Kind 42 im Relay.
  - Das Ergebnis ist versiegelt beim Fragenden – abholbar nur angemeldet als der Sitzungsschlüssel, denn
    das Relay des Knotens gibt Umschläge nur so heraus.
  - Kein Klartext im Log.

**Tests:**
- **node** `knoten-agent-privat.test.ts` (+3), mit echter Engine, Gründer wie in der App und Provider wie
  im Knoten:
  - der ganze Weg: Prompt aus der Gruppe, Antwort als inneres Event, versiegelt an den Fragenden, nichts
    offen, kein Klartext im Log, einmal;
  - Ablehnungen: fremde Gruppe, unbekannte Erwähnung, Kanal ohne Schreibrecht des Agenten;
  - Verdrahtung.
- **protocol** `agent-auftrag.test.ts`: Gruppen-Id von MDK (32 Zeichen) und vier ungültige Formen.
- **Unverändert grün:** `knoten-agent.test.ts` (der Fall `agent-privat` ohne Konto gilt weiter).

**Prüfungen:**
- protocol 1261 grün (6 übersprungen); node 388 grün (7 übersprungen – der Live-Abruf in `tools.test.ts` ohne
  Netz; vorher 385); app 1034 grün; mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und `build-site.sh`:
  grün.

Knoten-Stand: `main` mit 11.3d2b, nur mit `AGENT_PRIVAT`; sonst kein Update nötig.

## Schritt SH1 – Nachfolge mit der auditierten Shamir-Bibliothek

Entschieden 09.10.2026 (MENSCH, SH1 A): neue Fassung der Anteile, alte bleiben lesbar.

**Neu:**

- Abhängigkeit `shamir-secret-sharing` 0.0.4 (Privy, Apache-2.0, ohne Abhängigkeiten,
  85 KB entpackt, rund 13 KB Code; geprüft von Cure53 und Zellic), exakt gepinnt im Protokoll.
- `protocol/src/succession.ts`: `teileGeheimnis()` (Fassung 2, async; kopiert das Geheimnis
  und nullt die Kopie – die Bibliothek nimmt kein `Buffer`), `setzeGeheimnisZusammen()` (beide
  Fassungen, nie gemischt), `ANTEIL_FASSUNG`; `splitSecret()`/`combineShares()` bleiben als
  Fassung 1 (Lesen alter Anteile, Tests).
- `protocol/src/nachfolge-anteile.ts`: Anteil (38077) und Übergabe (38079) tragen
  `["fassung", "2"]`; ohne Tag Fassung 1, eine unbekannte Fassung wird abgelehnt;
  `setzeNachfolgeZusammen()` ist async und setzt je Teilung mit der richtigen Fassung zusammen.
- App: `richteNachfolgeEin()` (`tabs/settings.ts`) teilt über `teileGeheimnis()`,
  `setzeZusammen()` (`nachfolge-ui.ts`) wartet; Texte für `teile-fassungen` und
  `geheimnis-leer` (de/en); Whitepaper nennt die geprüfte Bibliothek.
- Sammlung: Spur A übernimmt Anhang E (A-17 bis A-23), A-12 angelegt (Squads, Entwurf
  zuerst), RM2 geprüft (B1 Vorauszahlung oder B2 keine Sitzungen auf Kredit – Frage an den
  MENSCHEN).

**Verdrahtet:** `shell/tabs/settings.ts` (`teileGeheimnis()`), `shell/nachfolge-ui.ts`
(`setzeNachfolgeZusammen()` → `setzeGeheimnisZusammen()`); `splitSecret` mit Begründung in
`wiring-ausnahmen.txt` (nur noch Tests).

**Prüfungen:** protocol 1266 grün (+5, 6 übersprungen; mit `main` bis 11.3d2b), node 389, app 1034,
Leak 73 + 1 todo; mls 13; tsc ×3, Build, `check-wiring --streng` (0 offen, `splitSecret` begründet),
`check-website`, `check_innerhtml --streng`, Smoke-Test, Website-Bau und reproduzierbarer Build
grün.
## Schritt 11.3d2c – Knoten-Agenten in privaten Räumen einladen und fragen (App)

Dritter Teil von 11.3d2 – damit sind private Räume fertig:
- **d2a:** Der Agent auf dem Knoten ist Mitglied.
- **d2b:** Er antwortet auf bezahlte Aufträge.
- **d2c (dieser Schritt):** Die App fragt jetzt auch in privaten Räumen. Lädt jemand einen Agenten ein,
  der auf einem Knoten läuft, sagt sie vorher und im Raum, dass der Knoten alles mitliest (Entwurf P2).

**App:**
- **`shell/mls-konto.ts` (Spur A, klein):** `mlsSendeEventId()` liefert die Id des inneren Events. Bei
  allen Mitgliedern ist sie dieselbe; die MLS-Nachrichten-Id kennt der Absender nicht.
  `mlsSendeEvent()` bleibt und ruft sie.
- **`shell/raum-mls.ts`:** `sendePrivat()` liefert diese Id statt `true`.
- **`shell/tabs/raeume.ts` (Spur C, klein):**
  - Im privaten Raum nach dem Senden `frageKnotenAgenten()` mit der Gruppe als `raum` und der Id als
    Erwähnung. Die Karten kommen aus der Gruppe (`raumAgentKarten()`).
  - **`ladeEin()`:**
    - Nennt die Karte des Eingeladenen `knoten` (`knotenAgentKarte()`), erst eine Warnung mit
      `bestaetige()`: der Knoten liest alles mit, Antworten bezahlt, wer fragt. Abgelehnt heißt nicht
      eingeladen.
    - Nach der Einladung der Pflicht-Hinweis als inneres Event im ersten Kanal
      (`meldeKnotenAgentImRaum()`).
- **Datenschutz:** Die Aussage „agent-knoten“ gilt für beide Raumarten, im Protokoll und in beiden
  Sprachen:
  - Die Antwort steht im offenen Raum öffentlich, im privaten für die Mitglieder.
  - Im privaten liest der Knoten Erwähnung und Verlauf als Mitglied mit.

**Doku:**
- `docs/PROTOCOL.md` §32 und `docs/PROVIDER.md`.
- Fallstrick in `packages/app/CLAUDE.md`.
- Karte `phase-11.md` (d2 fertig), FORTSCHRITT.

**Tests:**
- **app** `knoten-agent-fragen.test.ts` (+1):
  - im privaten Zweig zuerst `sendePrivat()`, nur bei Erfolg die Frage mit Gruppe und Id, die Karten der
    Gruppe;
  - Einladen erst nach der Warnung, der Hinweis nur nach der Einladung und nur als inneres Event;
  - nur Agenten auf einem Knoten;
  - Texte in beiden Sprachen.
- **app** `mls-konto.test.ts` (+1, echte Engine): Die Id aus `mlsSendeEventId()` ist dieselbe, die der
  Empfänger als `inneres` sieht; ohne Gruppe `null`.
- **Angepasst, nicht abgeschwächt** (`leak/raum.test.ts`): Der private Zweig sendet weiter zuerst über
  `sendePrivat()`, jetzt als `const gesendet = …`. `sendePrivat()` geht über `mlsSendeEventId()`; neu
  geprüft, dass diese nur über MLS sendet und `mlsSendeEvent()` sie ruft.

**Prüfungen:**
- protocol 1261 grün (6 übersprungen); node 388 grün (7 übersprungen – der Live-Abruf in `tools.test.ts` ohne
  Netz); app 1036 grün (vorher 1034); mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test (mit privatem Raum) und
  `build-site.sh`: grün.

**MENSCH (Geld, Devnet/Testnet):** einen Knoten mit `AGENT_PRIVAT` in einen privaten Raum einladen
(Warnung, Hinweis im Raum), ihn mit „@Name“ erwähnen und den Preis bestätigen. Erwartet:
- die Antwort in der Gruppe;
- Zahlung höchstens 100 sats (Lightning-Testnet bzw. Gutschrift im Zahlkanal auf Devnet).

Knoten-Stand: `main` mit 11.3d2b, nur mit `AGENT_PRIVAT`; sonst kein Update nötig.


## Schritt A-20 – QR-Scannen auch in Firefox und Safari; A-17-Entwurf

Sammlung A-20 (Anhang E). Bis hier erkannte nur der Browser QR-Codes (`BarcodeDetector`, nur
Chromium); Firefox und Safari zeigten nur den Hinweis zum Einfügen.

**Neu:**

- Abhängigkeit `jsqr` 1.4.0 (Apache-2.0, ohne Abhängigkeiten), exakt gepinnt in der App;
  `freedom.html` wächst um 345 KB (die App ist unminifiziert, rund 58 KB gzip). Ohne Worker –
  ein Worker passt nicht in die eine Datei.
- `shell/qr-ui.ts`: `leseQrAusBild()` (jsQR, beide Helligkeiten), `JsQrErkenner` (Bild auf
  `SCAN_BREITE_MAX` = 640 px verkleinert), `waehleErkenner()` – `BarcodeDetector`, wo es ihn
  gibt, sonst jsQR; `kannScannen()` braucht nur noch die Kamera-Schnittstelle. Das Bild bleibt
  im Gerät.
- Smoke-Test („qr“): Gerät C ohne `BarcodeDetector` – die Kamera-Attrappe zeichnet den echten
  QR-Pfad des Gerätecodes, jsQR liest ihn ins Feld, die Kamera ist danach aus.
- Regel „QR-Codes nur über `shell/qr-ui.ts`“ in der Wurzel-`CLAUDE.md` angepasst.
- **A-17-Entwurf** (`docs/E4B-ENTWURF.md`): eingebaute Lightning-Wallet nach E4b D – Befunde
  (Breez SDK Spark 0.26.1: MIT, WASM 5,1 MB gzip, API-Schlüssel für Mainnet; cashu-ts 4.11.0),
  Vorschläge V1–V6, Fragen W1–W5 an den MENSCHEN. Kein Code.

**Verdrahtet:** `shell/qr-ui.ts:207` (`waehleErkenner()` im Klick von `scanKnopf()`);
`leseQrAusBild()` über `JsQrErkenner`.

**Prüfungen:** protocol 1266, node 389 (je 6 übersprungen), app 1038 grün (+2; mit `main` bis 11.3d2c), Leak 73 + 1 todo; mls 13;
tsc ×3, Build, `check-wiring --streng` (0 offen), `check-website`, `check_innerhtml --streng`, Smoke-Test
(mit jsQR ohne `BarcodeDetector`), Website-Bau und reproduzierbarer Build grün.

## Schritt A-12-Entwurf, A-23, A-22, A-21-Plan – Kasse über Squads; Vergleiche Outbox und Boltz; Plan für kit

Entschieden 09.10.2026 (MENSCH): kein eigenes Programm, Squads anbinden. `docs/KASSE-ENTWURF.md`
legt fest, wie; kein Code.

- Befunde, auf der Kette abgefragt: Squads v4 (`SQDS4ep…`) ist auf Mainnet unveränderlich (keine
  Upgrade-Berechtigung), auf Devnet upgradebar und ein anderer Stand (andere Prüfsumme);
  Gebühr fürs Anlegen auf beiden Netzen 0, änderbar durch Squads. SDK `@sqds/multisig` 2.1.4 (MIT)
  für den Browser gebündelt 772 KB ohne web3.js, an web3.js v1 gebunden; Programm AGPL-3.0,
  nur aufgerufen.
- Vorschläge V1–V7: eigene Anweisungen nach der IDL statt SDK, getestet gegen beide Programme im
  Validator; ohne Verwalter; Recht „kasse“ erlaubt, die Kette entscheidet; frische Adresse je
  Raum und Mitglied; Grenze „raum-kasse“ im Bericht; Stimmen nur auf der Kette; nur SOL, nur
  Devnet bis M-8, Teilschritte A-12a–e.
- Fragen W1–W5 an den MENSCHEN.
- A-23 (`docs/OUTBOX-VERGLEICH.md`): `outboxPlan()` neben NDK 3.0.3, Welshman 0.8.16 und
  applesauce 6.2.0 (Quelltext gelesen). Befunde als neue Punkte: A-24 alle Autoren abdecken
  (gierig, Pool zählt mit, erst jeder Autor ein Relay), A-25 keine fremden `ws://`, A-26 kaputte Relays
  eine Viertelstunde aussetzen. Indexer-Relays bewusst nicht (verrieten den Kreis der Kontakte).
- A-22 (`docs/BOLTZ-VERGLEICH.md`): Ablauf des LP neben dem Boltz-Backend (Lifecycle-Doku).
  Zwei Entscheidungen für den MENSCHEN: A-27 Reihenfolge in Richtung 1 wie Boltz (erst zahlt der
  Kunde in die Hold-Invoice, dann sperrt der LP – ohne Vorab-Gebühr; Vorschlag: so lassen), A-28
  Rückgabe vor Ablauf in Richtung 2 (neue Anweisung im HTLC-Programm; Vorschlag: ja, mit 0.G).
- A-21-Plan (`docs/KIT-PLAN.md`): web3.js v1 belegt rund 760 KB des Bundles (esbuild-Metafile),
  `@solana/kit` 8.4.0 mit `@solana-program/system` für dieselben Aufgaben 228 KB. Teilschritte
  A-21a–f (erst Byte-Vektoren je Transaktion, dann Protokoll, RPC über den `RpcPool`, Signieren über
  `@noble/curves`, Knoten, Aufräumen); Fragen W1–W3 an den MENSCHEN.

**Prüfungen:** nur Dokumente – protocol 1266, node 389 (je 6 übersprungen), app 1038 grün (unverändert),
Leak 73 + 1 todo; mls 13; tsc ×3, Build, `check-wiring --streng`, `check-website`,
`check_innerhtml --streng`, Smoke-Test, Website-Bau und reproduzierbarer Build grün.

## Schritt A-24, A-25, A-26 – Outbox: alle Autoren, kein fremdes `ws://`, gescheiterte Relays aussetzen

Befunde aus dem Vergleich A-23 (`docs/OUTBOX-VERGLEICH.md`).

- **A-24** (`protocol/src/relay-start.ts`): `outboxPlan()` wählt gierig in Stufen – jeder Autor
  erst ein Relay, dann das zweite, bis `OUTBOX_JE_AUTOR` (drei); immer das Relay, das die meisten
  Autoren der Stufe erreicht, höchstens acht. Neu `imPool`: Relays des Pools zählen für ihre Autoren
  mit und belegen keinen Platz (bis hier belegten sie einen der acht und wurden erst danach
  gestrichen). Bis hier nahm der Plan die acht meistgenannten – wer nur auf seltenen Relays schrieb,
  fiel je nach Alphabet heraus.
- **A-25**: fremde Relays nur über `wss://`; `ws://…onion` nur mit `onion` (die App: Seite über
  .onion). Aus https blockte der Browser `ws://` ohnehin, in der Hülle ging es unverschlüsselt.
- **A-26** (`app/src/neben-verbindungen.ts`): scheitert eine Nebenverbindung in `mit()`, ist die
  Adresse eine Viertelstunde ausgesetzt (`ausgesetzt()`, nur im Speicher, ein Erfolg hebt es auf);
  `OutboxLeser` reicht Pool, Aussetzer und .onion an den Plan.

**Verdrahtet:** `app/src/outbox-lesen.ts` (`outboxPlan(…, { imPool, onion, aussetzen })`),
`app/src/shell/state.ts` (`new OutboxLeser({ …, ausgesetzt: () => neben.ausgesetzt(), onion })`).

**Prüfungen:** protocol 1269 (+3), node 389 (je 6 übersprungen), app 1040 grün (+2), Leak 73 + 1 todo;
mls 13; tsc ×3, Build, `check-wiring --streng` (0 offen), `check-website`, `check_innerhtml --streng`,
Website-Bau und reproduzierbarer Build grün. Smoke-Test: im ersten Lauf rot im Abschnitt „raum“
(Zeitüberschreitung beim Warten auf `#code-ref-wahl`, Code-Reiter eines Repos), in drei weiteren
Läufen bestanden; Ursache offen. Der Outbox-Plan bleibt im Smoke-Test vor und nach der Änderung
leer: Die einzige NIP-65-Liste dort ist die eigene, und deren Schreib-Relays stehen im Pool.

## Schritt 11.5-Entwurf – Agenten an Raum-Repos

Entwurf `docs/REPO-AGENTEN-ENTWURF.md` (Spur A, mit Spur B; wartet auf Freigabe). Agenten holen den
Code eines Raum-Repos, ändern ihn und stellen einen Patch in den Raum; annehmen nur Menschen mit Recht.

- **Befunde:** Agenten-Aufträge laufen heute ohne Werkzeuge (`agent-nur-text`); der Knoten führt
  Werkzeuge im Auftrag gar nicht aus (`main.ts` ohne `ToolRegistry`), `file_io` hätte einen Ordner
  für alle Aufträge (neu A-29 in der Sammlung); im Docker-Bild fehlt git; der Kopf eines Bundles steht
  nur im Bundle (`headSha: "local"`); der Bundle-Leser der App passt auch in den Knoten; Agentenketten
  auf dem Knoten erst mit dem Budget des Einladers (11.3d3, nach M-2).
- **Vorschläge V1–V9:** Repo-Auftrag als Erwähnung mit Tag aufs Repo; zuerst nur der Agent auf dem
  Knoten; Code nur aus dem Bundle des Raums, Arbeitskopie nur im Speicher; sechs Werkzeuge nur an der
  Arbeitskopie (kein Netz, keine Shell, kein Ausführen); der Knoten baut und prüft den Patch und
  reicht ihn ein (offen 1617 vom Agenten, privat als inneres Event); `patchStatus()` zählt „angenommen“
  nie von Agenten; Aufteilung 11.5a1–d.
- **Fragen W1–W5:** git als Programm oder eigener Leser und Schreiber (Empfehlung: eigener, im
  Speicher); wer beauftragen darf; Code ausführen; Autor im Commit; Obergrenze des Preises.

**Prüfungen:** nur Dokumente – protocol 1269, node 389 (je 6 übersprungen), app 1040 grün
(unverändert), Leak 73 + 1 todo; mls 13; tsc ×3, Build, `check-wiring --streng`, `check-website`,
`check_innerhtml --streng`, Smoke-Test, Website-Bau und reproduzierbarer Build grün.

## Schritt A-29 – `file_io` je Auftrag getrennt

Befund aus dem 11.5-Entwurf: Alle Aufträge teilten sich den Ordner von `file_io`
(`/tmp/freedom-workspace`) – was einer schrieb, lag für den nächsten bereit und blieb auf der Platte.
Heute nicht wirksam, weil `main.ts` keine `ToolRegistry` übergibt; getrennt, bevor jemand es verdrahtet.

- `node/src/tools.ts`: `ToolCall.auftrag` (64 Zeichen Hex); `FileIoExecutor` arbeitet dann nur in
  `<workspace>/<auftrag>` (0700, beim ersten Gebrauch angelegt), eine ungültige Id wird abgelehnt.
  `vergiss()` am Werkzeug und `ToolRegistry.vergiss()` löschen den Ordner (Fehler nur als Name ins Log).
- `node/src/dvm-provider.ts`: `parseToolCalls()` gibt die Id der Anfrage mit; nach den Werkzeugen
  löscht der Provider den Ordner (`finally`, auch wenn ein Werkzeug scheitert) – das Ergebnis steht
  schon im Kontext.
- Tests: node +1 (`tools.test.ts`: zwei Aufträge sehen sich nicht, auch nicht über `../`, der
  Workspace selbst nicht, ungültige Id, Aufräumen je Auftrag); `sol-price.test.ts` prüft zusätzlich,
  dass nach einem Auftrag mit `file_io` kein Ordner liegen bleibt (ohne das Aufräumen rot – gegengeprüft).

**Verdrahtet:** `node/src/dvm-provider.ts` (`parseToolCalls()` mit `auftrag: request.id`,
`this.toolRegistry.vergiss(request.id)` nach der Werkzeug-Schleife).

**Prüfungen:** protocol 1269, node 390 (+1; je 6 übersprungen), app 1040 grün, Leak 73 + 1 todo; mls 13;
tsc ×3, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Website-Bau und
reproduzierbarer Build grün (`freedom.html` bitgleich mit 11.5-Entwurf). Smoke-Test: rot im Abschnitt
„raum“ (`#code-ref-wahl`, derselbe Wackler wie bei A-24 bis A-26); der Abschnitt allein 12 von 12 grün –
die App ist unverändert, Ursache wird gesucht.

## Schritt A-30 – Smoke-Test „raum“: auf „Code laden“ warten

Der Smoke-Test war bei A-24 bis A-26 und bei A-29 je einmal rot im Abschnitt „raum“
(`TimeoutError … waiting for locator("#code-ref-wahl")`), allein 12 von 12 grün.

- **Ursache:** Nach dem zweiten Upload („kiste.bundle“) wartete der Test, bis das Event beim
  Relay war, plus 300 + 200 ms, und klickte dann auf „Code laden“. `ladeNip34Repos()` zeichnet die
  Repo-Seite aber erst danach neu; bis dahin zeigt „Code“ das alte, schon gelesene Bundle – ohne
  Knopf. Der Klick ging ins Leere, nach dem Neuzeichnen stand „Code laden“ für das neue Bundle da,
  ungeklickt. Belegt mit vierfach gedrosselter CPU (CDP `Emulation.setCPUThrottlingRate`): 2 von 2
  rot, Zustand beim Timeout: Reiter „Code“ aktiv, „Code laden“ da und bedienbar, kein Inhalt.
- **Korrektur** (`scripts/smoke_test.py`, Bereich Spur C): nach dem Upload auf den Knopf warten
  (`wait_for_function`, 15 s), dann klicken – keine feste Pause mehr. Mit Korrektur lief der Schritt
  auch vierfach gedrosselt durch; mit doppelter Drosselung ohne und mit Korrektur keine Befunde am
  Code-Reiter (andere Stellen wurden bei Drosselung rot – im normalen Lauf und in der CI nie).
- Fallstrick in `scripts/CLAUDE.md` („Smoke-Test auch in der CI“).

**Prüfungen:** protocol 1269, node 390 (je 6 übersprungen), app 1040 grün (unverändert), Leak 73 + 1 todo;
mls 13; tsc ×3, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test
(voller Lauf, mit Korrektur), Website-Bau und reproduzierbarer Build grün.

## Schritt Entscheidungen 11.10. – 11.5, A-12, A-17, A-21, A-27, A-28, 0.G

Nur Dokumente. Entscheidungen des MENSCHEN vom 11.10.2026 eingetragen:

- **11.5** (`docs/REPO-AGENTEN-ENTWURF.md`): freigegeben; W1 B, W2 A, W4 A, W5 A. W3 geändert: Der
  Agent soll Code ausführen können (Vibecoding). Mit welchem Harness und in welcher Sandbox, ist in
  Besprechung – Vorschlag Spur A im Entwurf (Ablauf von mini-swe-agent, in TypeScript nachgebaut,
  jeder Befehl in bubblewrap), dazu die neue Frage W6 (Netz in der Sandbox).
- **A-12** (`docs/KASSE-ENTWURF.md`): freigegeben; W2 geändert – beim Anlegen wählbar: „Gründer
  entscheidet“ oder „Mehrheit“ (DAO).
- **A-17** (`docs/E4B-ENTWURF.md`), **A-21** (`docs/KIT-PLAN.md`): wie vorgeschlagen.
- **A-27:** so lassen. **A-28:** ja, zusammen mit 0.G. **0.G (M-1):** A – bei `B6W19U…` bleiben,
  vorausgesetzt, das Upgrade-Recht liegt beim MENSCHEN. **M-6:** erst die Texte der App, dann die
  Website auf Englisch.
- **RM2:** B1 und B2 passen nicht – „einmal zahlen, viele Nachrichten“ bleibt; in Besprechung.

**Prüfungen:** nur Dokumente – protocol 1269, node 390 (je 6 übersprungen), app 1040 grün (unverändert),
Leak 73 + 1 todo; mls 13; tsc ×3, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`,
Smoke-Test, Website-Bau und reproduzierbarer Build grün.

## Schritt 11.5-Recherche und RM2-Entwurf – Harness, Netz, private Räume; Lightning wie der Zahlkanal

Nur Dokumente. Auftrag MENSCH 11.10.: „Alle drei offenen Punkte ausführlichst recherchieren.“

- **Harness (W3, `docs/REPO-AGENTEN-ENTWURF.md`):**
  - 22 Open-Source-Harnesses verglichen, nach sechs Kriterien (K1–K6): ohne Bildschirm,
    jeder Befehl in unsere Sandbox, kein Gedächtnis, eigenes Modell auch ohne Tool-Calling,
    MIT/Apache, stabil.
  - Dazu, wer was nutzt:
    - SWE-bench „Bash only“ läuft mit mini-swe-agent;
    - OpenClaw nutzt Pi;
    - OpenCode, OpenHands, Codex Cloud und Copilot machen „Erwähnung → Patch“.
  - Eine Studie (Juli 2026) zeigt: Der Harness ändert die Lösungsquote kaum (0–8 Punkte),
    die Tokens bis zum Vierzigfachen.
  - Vorschlag (Frage W3a): den Ablauf von mini-swe-agent in TypeScript nachbauen. Den
    Quelltext haben wir gelesen. Die bubblewrap-Umgebung von mini-swe-agent taugt nicht als
    Grenze: Sie teilt das Netz und bindet ganz `/etc` ein. Die Sandbox nach dem Vorbild von
    Codex CLI: bubblewrap, Namensräume, seccomp als zweite Stufe.
- **Netz (W6 B, freigegeben 11.10.):**
  - Vorbilder: Codex Cloud (Netz aus, Liste, nur GET), Copilot (Firewall mit Liste der
    Registries), sandbox-runtime (Proxy mit erlaubten Domains).
  - Ausgestaltung (Frage W6a): Die Sandbox bleibt ohne Netz. Der Knoten holt vorher nur
    Pakete aus der Sperrdatei, mit Prüfsumme, von einer festen Liste. Ein neues Paket nur in
    offenen Räumen und nur über ein Werkzeug des Knotens. Install-Skripte laufen nie.
- **Private Räume (Frage W7):**
  - P1: nur Agenten, die schon Mitglied sind; der Schlüssel kommt aus dem inneren Event.
  - P2: nur mit dem Modell auf demselben Rechner (wie D2).
  - P3: ohne Netz; Pakete nur, wenn der Raum es einschaltet.
  - P4: nichts auf Platte oder Log.
  - P5: auf dem Gerät nur ohne Ausführen.
- **RM2 (`docs/RM2-ENTWURF.md`):**
  - Lightning-Gegenstück zum Zahlkanal: der Cashu-Pfand. Einmal bei einer Mint laden. Je
    Fenster Token mit Sperre auf den Provider, Frist und Rückweg (NUT-11), mit DLEQ (NUT-12).
    Je Anfrage im versiegelten Kern übergeben. Der Provider prüft ohne Mint und löst vor der
    Frist ein; der Rest bleibt beim Kunden. Kein Kredit.
  - Verworfen:
    - Guthaben beim Knoten (Routstr, verstößt gegen 5.1.2);
    - L402 und Hold-Rechnungen (brauchen einen eigenen LND wie B1);
    - ein eigener Lightning-Kanal.
  - Der Spilman-Kanal für Cashu (NUT-Entwurf, Alpha) kommt später als Fassung 2.
  - Fragen W1–W5. W5 berührt E4b V3 („Cashu nie Vorgabe“).

**Prüfungen:** nur Dokumente – protocol 1269, node 390 (je 6 übersprungen), app 1040 grün (unverändert),
Leak 73 + 1 todo; mls 13; tsc ×3, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`,
Smoke-Test, Website-Bau und reproduzierbarer Build grün.

## Schritt VKa – Vibecoden auf dem eigenen Knoten: Entwurf und Protokoll

Wunsch MENSCH 11.10.: zuerst vom Seeker oder iPhone aus auf dem eigenen GX10 vibecoden – gekoppelt
per QR, ohne Vertrauensproblem –, bevor Fragen zu fremden Geräten entschieden werden. Freigegeben
(„Ja“): den Entwurf festhalten und mit VKa beginnen.

- **Entwurf** `docs/VIBECODEN-ENTWURF.md` (A-31):
  - Bestand: Koppeln, Besitzer-Nachweis, Verbindung ohne Portfreigabe und „Mein Knoten“ sind fertig.
  - Es fehlen Agent mit Werkzeugen, Projektordner, Sandbox, Vorschau und Projektseite.
  - Vorschläge VK1–VK7, Aufteilung VKa–VKf, Fragen VK-W1–W5: Harness, git, Vorschau, Netz, Kurzcode.
- **VKa** (`protocol/src/knoten-code.ts`, Kind 5080, `docs/PROTOCOL.md` 34):
  - Code-Auftrag nur versiegelt mit Besitzer-Nachweis (`baueCodeAuftrag()`), Aktionen `liste`,
    `neu`, `auftrag` (Modus `fragen`/`frei`), `freigabe`, `stopp`.
  - Der Knoten liest streng (`leseCodeAuftrag()`): je Parameter genau einer, keine fremden.
  - Schritte als Rückmeldung 7000 `partial` (`codeSchrittText()`/`leseCodeSchritt()`: Befehl mit
    Gedanke und „wartet“, Ausgabe mit Rückgabewert).
  - Antworten 6080 je Aktion (`codeAntwortText()`/`leseCodeAntwort()`).
  - Projektnamen taugen als Ordnername.
  - Tests: protocol +7.
  - Verdrahtet erst mit VKc (Knoten) und VKe (App) – sieben Ausnahmen in
    `scripts/wiring-ausnahmen.txt` mit diesem Grund.

**Prüfungen:** protocol 1276 (+7), node 390 (je 6 übersprungen), app 1040 grün, Leak 73 + 1 todo; mls 13;
tsc ×3, Build, `check-wiring --streng`, `check-website`, `check_innerhtml --streng`, Smoke-Test,
Website-Bau und reproduzierbarer Build grün.

## Schritt B-29c1a – Gewichte von Hugging Face: Bausteine

Spur B, erster Teil von B-29c („Gewichte außerhalb von Ollama gegen das Manifest prüfen“).

**Quellen (MENSCH 12.10.2026):** Gewichte kommen aus Freedom selbst, dazu Pirate Face
und Hugging Face als Quellen für neue Modelle.

**Befund:** Einen Modell-Ordner im dezentralen Git gibt es nicht.
- Git-Bundles sind auf 32 MB begrenzt.
- Das Blob-Netz verteilt Stücke als Nostr-Events, für Gigabytes ungeeignet: ein 7B-Modell
  wären rund 23.000 Events.
- Es gibt Manifest 38057 (mit freiem `blobId`) und 38058 „ich halte vor“, aber keinen Weg
  für die Bytes.

Pirate Face ist ein Torrent-Index für offene Modelle von Hugging Face (Apache-2.0 und MIT,
mit deren SHA-256). Aus dieser Umgebung nicht erreichbar, Angaben aus Berichten. Plan und
Fragen T1/T2 in `docs/E9-ENTWURF.md`, Abschnitt „Quellen für Gewichte“.

**Protokoll** (`modell-hf.ts`, neu):
- **`leseHfName()`:** `org/repo` nach den Regeln von Hugging Face.
- **Adressen:**
  - `hfStandAdresse()`: Stand je Commit oder Zweig mit `blobs=true`.
  - `hfDateiAdresse()`: Dateien nur am Commit, nur erlaubte Namen.
- **`hfStand()`:**
  - Commit und je Datei Größe, Git-Kennung und – nur bei LFS – SHA-256.
  - Nur `HF_DATEI`: safetensors, Konfiguration und Tokenizer, oberste Ebene. Pickle, Python
    und Unterordner bleiben draußen.
  - Ohne `config.json` und safetensors: `hf.ohneGewichte`.
- **`hfQuelle()`:** `upstream` = `hf:<Kennung>@<Commit>`, nie ein Zweig.
- **Prüfen:**
  - `pruefeDateien()`: je Name dieselbe Summe und Größe.
  - `vorpruefeHf()`: Namen, Größen, LFS-Summen vor dem Laden.
- **`vertrautesManifest()`** nimmt die Quelle als Funktion (Vorgabe Ollama) – dieselben Regeln
  für beide.

**Knoten** (`modell-hf.ts`, neu):
- **`holeHfStand()`:** ohne Weiterleitung, höchstens 2 MB, Fehler nur mit Namen.
- **`halteHfFest()`:**
  - Große Dateien mit der Summe von Hugging Face.
  - Kleine erst geladen und gegen ihre Git-Kennung geprüft (`gitKennung()`, wie
    `git hash-object`), dann selbst gerechnet.
- **`ladeHfDatei()`:**
  - SHA-256 beim Laden, nie mehr Bytes als angekündigt.
  - Erst nach der Prüfung unter dem Namen (vorher `.teil`); liegt die Datei schon richtig da,
    wird nichts geladen.
  - Keine Weiterleitung von https zu http; Abbruch nach `HF_STILL_MS` ohne neue Bytes.

**Noch nicht verdrahtet:** Der Knoten lädt damit erst mit B-29c1b (Ordner, Angebot, `npm run
modell -- … --aus-hf`, Status). Bis dahin stehen vier Exporte mit diesem Grund in
`scripts/wiring-ausnahmen.txt`.

**Doku:**
- `docs/PROTOCOL.md` §31 („Laden von Hugging Face“) und `docs/E9-ENTWURF.md`.
- Fallstrick in `packages/node/CLAUDE.md`.
- FORTSCHRITT, Sammlung (B-29).

**Tests:**
- **protocol** `modell-hf.test.ts` (+8): Namen; Adressen; Stand mit echten Formen und
  kaputten; Quelle; Wahl mit `hfQuelle`; Dateiprüfung; Vorprüfung.
- **node** `modell-hf.test.ts` (+6), gegen eine Attrappe von Hugging Face auf 127.0.0.1 mit
  LFS-Weiterleitung:
  - Git-Kennung; Stand und Fehler (401, 403, 404, 500, kaputt, zu groß) ohne fremden Text;
  - Festhalten, auch mit falschen Bytes;
  - Laden, zweites Mal nichts;
  - falsche, zu viele und zu wenige Bytes, stehende Leitung: kein Bruchstück;
  - Namen, Commit, https → http.

**Prüfungen:**
- protocol 1284 grün (6 übersprungen, vorher 1276 nach dem Einmergen von `main` mit VKa); node 395 grün (7
  übersprungen – der Live-Abruf in `tools.test.ts` ohne Netz; vorher 390); app 1040 grün; mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und `build-site.sh`: grün.

**MENSCH (Live-Probe, Hugging Face ist von hier nicht erreichbar):** mit einem kleinen,
offenen Modell (z. B. `Qwen/Qwen2.5-0.5B-Instruct`)
`https://huggingface.co/api/models/Qwen/Qwen2.5-0.5B-Instruct/revision/main?blobs=true` abrufen.
Erwartet:
- `sha` und `siblings` mit `lfs.sha256` für `model.safetensors`;
- `blobId` für die kleinen Dateien.

Knoten-Stand: kein Update nötig (noch nicht verdrahtet).

## Schritt B-29c1b – Der Knoten lädt Modelle von Hugging Face

Spur B, zweiter Teil von B-29c. Mit einem OpenAI-kompatiblen Antrieb (vLLM, SGLang, TensorFold)
lädt der Knoten Modelle jetzt geprüft von Hugging Face in einen Ordner, aus dem der Antrieb sie liest.

**Entscheidung (MENSCH 12.10.2026):** „Pirate Face auch integrieren, welche Torrent-Option besser
ist, entscheidest du, und alles mit dem dezentralen Freedom-Dateisystem verbinden.“
- Torrent über **aria2c** als eigenes Programm (JSON-RPC nur auf 127.0.0.1). WebTorrent hätte
  hunderte npm-Pakete in den Knoten gebracht.
- „Ich halte vor“ (38058) bekommt einen Magnet-Link.
- Begründung und Schritte in `docs/E9-ENTWURF.md`. Dieser Schritt ist der Weg über Hugging Face;
  Torrent folgt mit B-29c2a–c.

**Knoten:**
- **`modell-laden.ts`:**
  - `ladeHfModell()`: Manifest wie bei Ollama über `vertrautesManifest()`, mit `hfQuelle()`
    (bis E9-4 nur der eigene Schlüssel).
  - Vorprüfung am Commit des Manifests; jede Datei über `ladeHfDatei()`.
  - Danach der ganze Ordner gegen das Manifest: keine fremde Datei (`datei.fremd`), denn vLLM liest
    alle safetensors des Ordners.
  - Gemerkt mit `ordnerAbdruck()`: Name, Größe, Zeit je Eintrag, liest keine Bytes.
  - Wünsche tragen `quelle: "hf"`. Der Dienst lädt nur Wünsche seiner Quelle.
  - `imAngebot()`: ein Modell von Hugging Face nur, solange `/v1/models` den Namen nennt und der
    Ordner unverändert ist.
  - Das Festhalten nennt Herkunft (`hf:<org/repo>@<commit>`) und Lizenz.
- **`main.ts`:**
  - Hilfen für Hugging Face nur ohne Ollama.
  - `MODELL_ORDNER` (Vorgabe `~/.freedom/modelle`).
  - Der Lade-Takt läuft jetzt mit beiden Antrieben.
- **`npm run modell -- <org/repo> --aus-hf`:** mit `KI_ANTRIEB=openai`; ein Ollama-Name wird dort
  abgewiesen.
- **Selbstprüfung (`pruefeModelle()`):** neue Kennungen:
  - `modell.ordnerVeraendert`, `modell.nurAntrieb`, `modell.ladenNurAntrieb`;
  - `modell.hf…`, `modell.datei…`.
  - Die Texte zu Registry und Quelle sind jetzt für beide Quellen formuliert.
- **App:** Texte für jede neue Kennung (Deutsch und Englisch). Die Schritte heißen neutral („lädt“,
  „Dateien prüfen“).
- **Doku:**
  - `docs/PROVIDER.md` (Abschnitt Hugging Face mit `vllm serve … --served-model-name`).
  - `docker-compose.yml` (`MODELL_ORDNER`).
  - Fallstrick in `packages/node/CLAUDE.md`.
  - FORTSCHRITT, Sammlung, E9-Entwurf.

**Echt gestartet:**
- Knoten mit `KI_ANTRIEB=openai` und einer Antriebs-Attrappe; im Log steht, wohin geladen wird.
- `npm run modell -- Qwen/Qwen2.5-0.5B-Instruct --aus-hf` merkt den Wunsch (`quelle: "hf"`); ein
  Ollama-Name wird dort abgewiesen.
- Der Knoten versucht es. Ohne Netz zeigt `npm run modell`: „Hugging Face war nicht zu befragen
  (TypeError) – nichts festgehalten, nichts geladen“.

**Tests:**
- **node** `modell-hf-laden.test.ts` (+7), mit echten Bausteinen aus `modell-hf.ts` gegen eine
  Attrappe von Hugging Face:
  - der ganze Weg; Festhalten mit Herkunft und Lizenz;
  - Ablehnungen: fremdes Manifest, Ollama-Quelle, andere Größe am Commit, falsche Summe,
    falsche Bytes, fremde Datei im Ordner;
  - Dienst: im Angebot, raus ohne Namen beim Antrieb, raus nach einer Änderung am Ordner;
  - Ollama-Knoten und HF-Wünsche; Wunsch und Stand; Selbstprüfung.
- **Angepasst, nicht abgeschwächt:** Verdrahtungstests in `ki-antrieb.test.ts`,
  `modell-laden.test.ts`, `modell-pruefung.test.ts` prüfen jetzt die neue Verdrahtung (Hilfen für
  Hugging Face nur ohne Ollama, Takt immer, Herkunft beim Festhalten, Ordner in der
  Selbstprüfung). `knoten-status.test.ts` prüft die neutralen Schritttexte.
- **Verdrahtet:** Die vier Ausnahmen aus B-29c1a sind aus `scripts/wiring-ausnahmen.txt` raus.

**Prüfungen:**
- protocol 1284 grün (6 übersprungen); node 402 grün (7 übersprungen – der Live-Abruf in
  `tools.test.ts` ohne Netz; vorher 395); app 1040 grün; mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und `build-site.sh`: grün.

**MENSCH (Live, Hugging Face und vLLM sind von hier nicht erreichbar):**
1. Am Knoten mit `KI_ANTRIEB=openai`: `npm run modell -- Qwen/Qwen2.5-0.5B-Instruct --aus-hf`.
2. Nach dem Laden `vllm serve ~/.freedom/modelle/Qwen/Qwen2.5-0.5B-Instruct --served-model-name Qwen/Qwen2.5-0.5B-Instruct`.

Erwartet:
- `npm run modell` zeigt ✓;
- das Angebot nennt das Modell;
- eine Änderung im Ordner nimmt es heraus.

Knoten-Stand: `main` mit B-29c1b, nur für `KI_ANTRIEB=openai`; mit Ollama kein Update nötig.

## Schritt B-29c2a – Magnet-Links und Inhalts-Kennung im Protokoll

Spur B, dritter Teil von B-29c. Entscheidung des MENSCHEN vom 12.10.2026: aria2c, Pirate Face,
alles mit dem dezentralen Freedom-Dateisystem verbinden.

Beschreibung und Vertrauen bleiben bei Nostr; die Bytes reisen über BitTorrent. Dieser Schritt
legt fest, wie Knoten sich darüber verständigen.

**Protokoll** (`modell-torrent.ts`, neu; `model-registry.ts`):
- **„Ich halte vor“ (38058)** trägt zwei Tags mehr: `["magnet", …]` und `["inhalt", …]`. Ältere
  Meldungen bleiben gültig.
- **`leseMagnet()`:** Magnete sind Fremdtext und werden streng gelesen.
  - Genau eine Kennung `btih` (Hex oder Base32); eine v2-Kennung daneben bleibt unbeachtet.
  - Tracker nur udp/http/https/wss, Web-Seeds nur https, nie lokale oder private Hosts, begrenzt.
  - `dn`, `xs`, `as` fallen weg; weiter geht nur der neu gebaute Link.
- **`inhaltsKennung()`:** SHA-256 über die sortierten `<sha256>:<größe>` der Dateien. Gleich für
  jeden Herausgeber derselben Dateien – bis E9-4 signiert jeder Knoten sein eigenes Manifest.
- **`magnetQuellen()`:** Seeds derselben Fassung:
  - nur gültig signiert, höchstens 14 Tage alt, je Knoten die neueste;
  - je Torrent einmal, die meistgemeldeten zuerst;
  - Vertrauen braucht es nicht, die Bytes prüft das Manifest.

**Noch nicht verdrahtet:** Der Knoten nutzt die Bausteine mit B-29c2b (aria2) und B-29c2c (Quellen,
Bekanntgabe). Bis dahin stehen drei Ausnahmen mit diesem Grund in `scripts/wiring-ausnahmen.txt`.

**Doku:**
- `docs/PROTOCOL.md` §31 („Über BitTorrent im eigenen Netz“).
- Fallstrick in `packages/protocol/CLAUDE.md`.
- E9-Entwurf, FORTSCHRITT.

**Tests:** protocol `modell-torrent.test.ts` (+5):
- Magnet mit Hex, Base32 und Hybrid; Ablehnungen (lokale und private Hosts, fremde Schemata,
  zwei Kennungen, Übergröße, Grenzen);
- Inhalts-Kennung;
- 38058 mit und ohne Magnet;
- Quellen: Fassung, Modell, Alter, Signatur, neueste je Knoten, Reihenfolge.

**Prüfungen:**
- protocol 1289 grün (6 übersprungen, vorher 1284); node 402 grün (7 übersprungen, unverändert); app 1040 grün;
  mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und `build-site.sh`: grün.

Knoten-Stand: kein Update nötig (nur Protokoll).

## Schritt B-29c2b – aria2 im Knoten: Freedom-Torrent, holen und prüfen, teilen

Spur B, vierter Teil von B-29c. Der Torrent-Client wurde am 12.10.2026 im Auftrag des MENSCHEN
gewählt: **aria2c**, als eigenes Programm. Es ist bewährt, sparsam bei Gigabyte-Dateien und kann
Magnet, DHT, Tracker und Web-Seeds. Es kommt keine npm-Abhängigkeit dazu; die Lizenz ist GPL-2.0+,
als getrennter Prozess ohne Folge für die EUPL.

**Knoten:**
- **`torrent.ts`** – der **Freedom-Torrent** einer Fassung:
  - Bencode ohne Abhängigkeit.
  - Name, Dateien und Stückgröße folgen nur aus dem Manifest, die Stücke aus den geprüften Bytes.
  - Jeder Knoten mit denselben Bytes baut denselben Torrent (dieselbe `infohash`), gleich woher er
    das Modell hat.
  - Name = Commit bei Hugging Face, dazu dessen Web-Seed (BEP-19). Beim Bauen wird jede SHA-256
    geprüft.
- **`aria2.ts`:**
  - `starteAria2()`: JSON-RPC nur auf 127.0.0.1; das Geheimnis ist je Start neu und steht nur in
    `aria2.conf` (0600), nicht auf der Befehlszeile.
  - Seeding ohne Ende; Upload-Grenze `TORRENT_HOCHLADEN_KBS`; Einstieg ins DHT
    (`TORRENT_DHT_EINSTIEG`); eigene Tracker (`TORRENT_TRACKER`, geprüft wie in Magneten).
  - `Aria2` gibt Fehler nur als Kennung mit Code weiter.
- **`modell-schwarm.ts`:**
  - `holeUndTeile()`:
    - Metadaten holen (pausiert), nur die Dateien des Manifests wählen.
    - Schon Geprüftes als Verweis vorlegen.
    - Laden, jede SHA-256 prüfen; erst dann als Verweis in den Modellordner, danach weiter teilen.
    - Falsches löscht die Ablage.
  - `teileModell()`: den Freedom-Torrent aus dem geprüften Ordner teilen, nie doppelt.
- **CI:** installiert aria2c, damit die Schwarm-Tests laufen statt sich zu überspringen.

**Noch nicht verdrahtet:** `main.ts` startet aria2c und nutzt den Schwarm erst mit B-29c2c (Quellen,
Bekanntgabe, Docker, Installer). Das liegt fertig und getestet bereit.

**Tests:** node `modell-schwarm.test.ts` (+8):
- Bencode und Stückgrößen; Freedom-Torrent gleich bei zwei Knoten, `aria2c -S` liest dieselbe
  Kennung; eine abweichende Datei wirft.
- Auswahl im Torrent; Umgebung und Konfiguration (Geheimnis nur in der Datei, DHT-Einstieg,
  Tracker); Fehler von aria2 ohne Text.
- **Mit echtem aria2c,** zwei Knoten und einem Tracker auf 127.0.0.1:
  - B holt über den Magnet und teilt weiter;
  - eine falsche Fassung kommt nie in den Modellordner;
  - wer die Dateien schon hat, lädt nichts und teilt sofort.

**Prüfungen:**
- protocol 1289 grün (6 übersprungen); node 410 grün (7 übersprungen – der Live-Abruf in `tools.test.ts` ohne
  Netz; vorher 402); app 1040 grün; mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test und `build-site.sh`: grün.

Knoten-Stand: kein Update nötig (noch nicht verdrahtet).

## Schritt B-29c2c – Schwarm verdrahtet: Freedom-Knoten, Pirate Face, Hugging Face

Spur B, letzter Teil von B-29c. Damit ist die Entscheidung des MENSCHEN vom 12.10.2026 umgesetzt:
Gewichte kommen aus Freedom selbst, Pirate Face und Hugging Face sind Quellen, alles verbunden mit
dem dezentralen Freedom-Dateisystem.

**Knoten:**
- **`main.ts`:**
  - aria2c nur mit `TORRENT=1` und `KI_ANTRIEB=openai`; ungültige Werte → kein Start.
  - Schwarm-Hilfen für den Lader.
  - „Ich halte vor“ (38058) mit Magnet und Inhalts-Kennung, vom Schlüssel des Knotens.
  - Beim Start werden unveränderte geprüfte Ordner wieder geteilt; täglich wird nur neu gemeldet.
  - aria2c endet mit dem Knoten.
- **`modell-laden.ts`:** `ladeHfModell()` holt in dieser Reihenfolge:
  1. von Freedom-Knoten (`magnetQuellen()`);
  2. über den Magnet aus dem Wunsch (`--magnet`, etwa von Pirate Face);
  3. von Hugging Face direkt.

  Danach teilt und meldet es; ein Fehler dabei hält das geprüfte Modell nicht auf. Der Stand merkt
  sich die Kennung des Torrents.
- **`npm run modell -- <org/repo> --magnet "<link>"`:** nur gültige Magnete, nur für Hugging Face.
- **Docker:** aria2 im Image. In `docker-compose.yml` stehen `TORRENT`, `TORRENT_PORT` und
  `TORRENT_HOCHLADEN_KBS`; der Port ist nicht von selbst offen.
- **Installer:** aria2 nur mit `TORRENT=1`, dazu der Hinweis auf Port und IP; `TORRENT` steht in
  der Umgebungsdatei (Vorgabe 0).
- **Doku:**
  - `docs/PROVIDER.md` („Im Schwarm“), ehrlich: Wer teilt, zeigt seine IP im Schwarm; deshalb
    ist `TORRENT` aus, bis man es einschaltet.
  - Fallstrick in `packages/node/CLAUDE.md`.
  - E9-Entwurf, Sammlung, FORTSCHRITT.

**Echt gestartet:** Knoten mit `KI_ANTRIEB=openai`, `TORRENT=1` und einer Antriebs-Attrappe:
- „[schwarm] aria2c läuft …“;
- `aria2.conf` 0600, kein Geheimnis im Log;
- nach dem Ende des Knotens läuft kein aria2c mehr.

**Tests:**
- **node** `modell-hf-laden.test.ts` (+3):
  - erst Netz, dann Pirate Face; ist einer erfolgreich, lädt Hugging Face nichts; geteilt;
  - alle Magnete scheitern → Hugging Face; ein Fehler beim Teilen hält nichts auf;
  - Wunsch mit Magnet.
- **node** `modell-schwarm-verdrahtet.test.ts` (+1): Verdrahtung in `main.ts`, Lader, CLI, Docker.
- Die letzte Ausnahme (`magnetQuellen`) ist aus `scripts/wiring-ausnahmen.txt` raus.

**Prüfungen:**
- protocol 1289 grün (6 übersprungen); node 414 grün (7 übersprungen – der Live-Abruf in `tools.test.ts` ohne
  Netz; vorher 410); app 1040 grün; mls 13 grün; Leak-Tests 73 grün + 1 `todo`.
- Build, `check-wiring --streng`, `check-website`, `check_innerhtml`, Smoke-Test, `build-site.sh`,
  `docker compose config` und `bash -n` für den Installer: grün.

**MENSCH (Live – Hugging Face, Pirate Face und das DHT sind von hier nicht erreichbar):**
1. Knoten A und B, beide mit `KI_ANTRIEB=openai` und `TORRENT=1`, Port freigegeben.
2. A: `npm run modell -- Qwen/Qwen2.5-0.5B-Instruct --aus-hf`.
3. B: dasselbe ohne `--aus-hf`, nachdem B das Manifest von A als eigenes festgehalten hat – oder
   mit `--aus-hf`.

Erwartet:
- B holt aus dem Schwarm von A;
- das Log von B zeigt kein Laden von Hugging Face.

Mit einem Magnet von pirateface.co zusätzlich `--magnet "<link>"` versuchen.

Knoten-Stand: `main` mit B-29c2c, nur für `KI_ANTRIEB=openai` mit `TORRENT=1`; sonst kein Update nötig.

## Schritt C-31 – Agent-Verlauf folgt dem Ende

Spur C, Befund A-4 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung): Der Agent-Chat
scrollte nicht mit. `stickToBottom()` maß erst nach dem Anhängen einer Blase, ob man unten
war – jede Blase über 80 px galt als „hochgescrollt“, und die Antwort lief unten aus dem Bild.
Weiches Scrollen (`scrollIntoView({ behavior: "smooth" })`) verfälschte zudem die nächste
Messung, solange die Animation lief.

**`agent-anzeige.ts`:** Ob die Ansicht folgt, entscheidet das Scrollen des Nutzers (Horcher
am Verlauf: unten heißt höchstens 80 px vom Ende). Gefolgt wird sofort
(`scrollTop = scrollHeight`), alle Aufrufe ohne weiche Animation. Die eigene Frage holt die
Ansicht ans Ende zurück (`folgeWieder()`), ebenso ein geöffneter Verlauf (`agent-verlauf.ts`).

**Tests:** `agent-folgen.test.ts` (3). Smoke „agent_folgen“: Ein langer gemerkter Verlauf
(12 Nachrichten) öffnet am Ende; wer hochscrollt, bleibt oben. Vorher lag das Ende 4584 px
unter dem sichtbaren Teil.

**Prüfungen** (nach dem Einmergen von `main` bis B-29c2c): protocol 1289 grün, node 412 (ohne Netz),
app 1043 (+3), Leak 73 + 1 todo; tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-32 – Agent-Kleinigkeiten

Spur C, Befunde A-3, E-6, A-5, A-6, A-8 und N-2 aus dem Nutzertest vom 08.10. (Anhang D der
Sammlung).

| Befund | Vorher | Jetzt |
|---|---|---|
| A-3, E-6 | Jeder Werkzeug-Knopf: „5 sats (SOL: kein Kurs)“ | ohne Kurs nur „5 sats“ (`knopfPreis()`); dass der Kurs fehlt, sagt der Tooltip |
| A-5 | „erneut“ nach einem Fehler: die Frage stand zweimal im Verlauf und ging zweimal im Kontext mit | die alte Frage und die Fehlerblase weichen, auch im gespeicherten Verlauf (`vergissLetzteFrage()`) |
| A-6 | Wechsel-Notiz „Modell gewechselt zu free – … (1 Nachrichten)“ | „Free“ aus der Wahl (Text vor „ — “), „1 Nachricht“; auch in der Liste der Verläufe |
| A-8 | Während der Tipp-Animation roher Text mit „##“ und „**“ | Markdown schon beim Tippen (`antwortDom()`), höchstens etwa 200 Schritte |
| N-2 | „Mein Knoten“ unter den Modellen des Netzes, außer Sicht | oben in der Wahl, dann „Dieses Gerät“, dann das Netz |

**Tests:** `agent-kleinigkeiten.test.ts` (6); drei Formtests auf die neue Form angepasst
(`ki-kontext`, `mein-knoten-wahl`, `dom-statt-html`). Smoke „agent_klein“: Werkzeug-Knöpfe ohne
„kein Kurs“, „erneut“ mit genau einer Frage und „1 Nachricht“. Vorher rot (zwei Fragen,
„2 Nachrichten“, „kein Kurs“ auf jedem Knopf). Smoke „lokal“: Gruppen in der Reihenfolge
„Mein Knoten“, „Dieses Gerät“, „Netz“, die eigene Gruppe ohne Scrollen sichtbar.

**Prüfungen:** protocol 1289 grün, node 412 (ohne Netz), app 1049 (+6), Leak 73 + 1 todo; tsc überall,
Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-33 – Namen statt Schlüssel, Anfrage endet mit der Antwort

Spur C, Befunde C-8, C-2, R-2 und G-4 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung):
Veröffentlichte Namen erschienen nirgends (Liste, Raum, Umfrage, Repo zeigten den gekürzten
Schlüssel, das runde Zeichen „2“ oder „A“), und „Anfrage · …“ blieb, auch nachdem man geantwortet
und den Kontakt geprüft hatte.

**`kontakt-name.ts`** (neu, ohne DOM): Profilname aus Kind 0 (`display_name`, sonst `name`;
nur Text, höchstens 40 Zeichen, ohne unsichtbare Zeichen und gemischte Schriften, über
`inspectName()`), je Schlüssel das neueste Profil. Ein selbst gewählter Name ist eine Behauptung
(`naming.ts`): Er steht mit „~“ davor, wie bei Messengern für Namen, die nicht aus dem eigenen
Adressbuch kommen. Ein eigener Name gilt ohne Zeichen. „Anfrage“ ist ein Merkmal der Unterhaltung
(`anfrage`), nicht mehr Teil des Namens; alte Namen „Anfrage · …“ erkennt die App in beiden
Sprachen.

**Verdrahtet:**
- `kontakte.ts`, `loeseNamenAuf()`: Profile der Kontakte über `frageBeiAutoren()` (Kind 0, höchstens
  alle zehn Minuten), als `profil` an der Unterhaltung gemerkt. Den Satz „so nennen ihn n deiner
  Kontakte“ baut die App selbst (`komm.nameBekannt`, wortgleich mit `displayWithSource()`).
- `posteingang.ts`: Neue Unterhaltungen von Fremden tragen `anfrage: true`.
- Die Anfrage endet mit der ersten Antwort (`sendChatMessage()` → `nimmAnfrageAn()`), der Prüfung des
  Sicherheitscodes (`app.ts`) oder einem eigenen Namen.
- Raum, Umfrage und Repo (`kontaktName()`) zeigen den Namen ohne „Anfrage“.

**Tests:** `kontakt-name.test.ts` (7); vier Formtests auf die neue Form angepasst. Smoke
„kontaktname“ (`scripts/kontaktname-probe.mts`): Ein Fremder mit Profil schreibt – „Anfrage ·
~Ada <b>Probe</b>“ (HTML als Text), Zeichen „A“; nach der Antwort „~Ada <b>Probe</b>“. Vorher:
„0339c65d…0046“.

**Prüfungen:** protocol 1289 grün, node 412 (ohne Netz), app 1056 (+7), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-34 – Chat-Kleinigkeiten

Spur C, Befunde C-3, C-4, C-5 und C-9 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

| Befund | Vorher | Jetzt |
|---|---|---|
| C-3 | Eingabe- und Anrufzeile auch ohne gewählte Unterhaltung | erst mit einer Unterhaltung (`ohne-unterhaltung` an `.chat-main`, schon im HTML) |
| C-4 | „⇪ ⇩“ im Kopf der Liste, nur mit Tooltip | „⋯“ öffnet ein Menü mit „Post … als Datei mitnehmen“ und „Mitgebrachte Post einlesen“ (`oeffneMenueAn()`); die alten Knöpfe bleiben unsichtbar als Ziel |
| C-5 | Zap-Knopf in fremden Nachrichten: Grundregel für Knöpfe, 159–340 px breiter Balken; die Nachricht ohne Blase | Knopf so breit wie sein Zeichen (am Handy 40 px), Nachrichten anderer als Blase – nur im Chat, der Agent bleibt ohne |
| C-9 | Sicherheitscode im einzeiligen Feld, 7 von 12 Gruppen sichtbar | Lesefelder im Dialog mehrzeilig (`dlg-nurlesen`, bis vier Zeilen) – der Code steht ganz da |

**Tests:** `chat-klein.test.ts` (4). Smoke „chat_klein“ (Fremder aus `kontaktname-probe.mts`):
ohne Unterhaltung keine Eingabe, kein Anruf, keine Pfeile; das Menü mit zwei Punkten; mit
Unterhaltung alles da; fremde Nachricht als Blase, Zap-Knopf 21 px; Sicherheitscode zwölf Gruppen
ohne Scrollen. Vorher alle fünf rot.

**Prüfungen:** protocol 1289 grün, node 412 (ohne Netz), app 1060 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-35 – Räume: Einladung, Umfrage, Mitglieder, Kanalkopf

Spur C, Befunde R-1, R-3, R-4 und R-7 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

| Befund | Vorher | Jetzt |
|---|---|---|
| R-1 | Einladung in einen privaten Raum als „🔒P“ ohne Absender | Name aus der Gruppe (`mlsEinladungAnnehmen()` liefert ihn mit) und Absender gleich in der Leiste: „Probe privat – Einladung von …“, bis der Raum einmal offen war (nur in dieser Sitzung) |
| R-3 | Umfrage „von <eigener Schlüssel>“, Antworten in Großbuchstaben, die führende Antwort auch für Nichtwähler gefüllt | „von Du“ (`nameVon`), Antworten wie geschrieben, Balken erst nach der eigenen Stimme oder am Ende |
| R-4 | Mitgliedernamen mit „…“ abgeschnitten | ganze Namen, umgebrochen; in offenen Räumen dazu Profilnamen („~Name“). Privat nicht: die Abfrage nennte den Relays die Gruppe |
| R-7 | Am Handy „offen — jeder kann mitlesen“ Silbe für Silbe untereinander | in eigener Zeile unter dem Kanalnamen |

**Tests:** `raeume-klein.test.ts` (4); drei Formtests angepasst (`mls-konto` mit Name,
`planung-ansicht`, `raeume-privat`). Smoke „privatraum“: Bo sieht vor dem Öffnen „Privater Raum
Probe privat – Einladung von …“ (vorher „Privater Raum privater Raum“). Smoke „raum“: die Art des
Kanals in einer Zeile, Desktop und Handy (vorher am Handy vier Zeilen).

**Prüfungen:** protocol 1289 grün, node 412 (ohne Netz), app 1064 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt OFFEN – alles Offene auf einen Blick

Spur B, Wunsch MENSCH (12.10.: „Liste von allen offenen Punkten der gesamten Roadmap und
allen fehlenden Entscheidungen“, 13.10.: „in der Repo eintragen, sodass alle Agents es sehen
können“). Nur Doku, kein Code.

- **Neu `docs/ausbau/OFFEN.md`:** zusammengetragen aus `FORTSCHRITT.md`, der Sammlung
  (Abschnitte 2–6, Anhänge D–F) und den Entwürfen (`REPO-AGENTEN`, `VIBECODEN`, `RM2`, `E9`,
  `D3`, `KASSE`, `E4B`, `KIT-PLAN`, `MIXNET`, `phase-9.md`). Vier Teile:
  1. offene Entscheidungen des MENSCHEN – W3a, W6a, W7 (11.5), VK-W1–W5 (Vibecoden), RM2 W1–W5,
     die Bestätigung zu 0.G (Upgrade-Recht `8DhKPv…`) und wer den Agenten-Teil von Phase 9 baut;
     dazu, was ohne Termin zurückgestellt ist;
  2. Aufgaben des MENSCHEN – zuerst die, die Bauschritte aufhalten (M-2 Zahlkanal-Upgrade hält
     sechs auf), dann Konten und Einrichtung, Tests mit echten Geräten, Phase 9;
  3. offene Bauschritte je Spur mit Stand (`frei` oder `nach …`).
  Die Datei verweist nur; bei Widerspruch gilt die Quelle.
- **Pflege:** Wer einen Punkt fertigstellt, löscht seine Zeile dort im selben PR; Entscheidungen
  trägt ein, wer die Antwort bekommt. `CLAUDE.md` (Aufbau, Arbeitsweise 1 und 5),
  `FORTSCHRITT.md` (Kopf) und die Sammlung (Kopf) zeigen auf die Datei.
- **Befund dabei:** In `FORTSCHRITT.md` steht 0.G noch als „offen – Entscheidung A/B“, obwohl am
  11.10. entschieden (Zeile von Spur A, nicht geändert).

**Prüfungen:** nur Doku – `check-wiring.py --streng` und `check-website.py` grün.

## Schritt C-36 – Repos: ein Weg zum Anlegen, eine Rückfrage

Spur C, Befunde G-1, G-2, G-3 und G-5 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

| Befund | Vorher | Jetzt |
|---|---|---|
| G-1 | Zwei Wege zum Anlegen: „Repo ankündigen“ und „Repo-Name + ⇪ Bundle publizieren“ | nur „Repo ankündigen“; den Code lädt man danach auf der Repo-Seite hoch (Einstellungen › Neue Version) – die Meldung nach dem Ankündigen sagt es |
| G-2 | Erst der Dialog, dann eine zweite Rückfrage mit demselben Titel | eine: was geschieht, steht im Dialog (alle vier „Wo“; aus dem Raum mit seinem Namen) |
| G-3 | „Mitwirkende“ des Projekts auch unter einer offenen Repo-Seite – neben deren eigenem Reiter | nur bei der Liste |
| G-5 | In „Wo“ der private Raum nur mit Namen („Werkstatt“) | „Werkstatt (privater Raum)“ wie „… (öffentlicher Raum)“ |

**Tests:** `repos-klein.test.ts` (4); vier Formtests angepasst. Smoke „raum“: Ankündigen mit einer
Rückfrage (öffentlich und im Raum), Mitwirkende des Projekts bei offener Repo-Seite ausgeblendet,
kein Bundle-Knopf in der Liste; „privatraum“: Repo im privaten Raum mit einer Rückfrage.

**Prüfungen:** protocol 1289 grün, node 412 (ohne Netz), app 1068 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-37 – Profil: Karte „Identität“, Teilen als npub

Spur C, Befunde P-1, P-2 und P-3 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

| Befund | Vorher | Jetzt |
|---|---|---|
| P-1 | Unter den Abzeichen eine lose Zeile „…197f [Importieren]“ ohne Überschrift | Karte „Identität“ mit einem Satz: der Klick auf den Schlüssel kopiert den privaten (nur zum Sichern), „Importieren“ ersetzt die Identität |
| P-2 | „Teilen“ kopierte den Schlüssel als Hex | als npub – derselbe Schlüssel, unter dem „Profil speichern“ das Profil veröffentlicht; ohne Zwischenablage zeigt der Dialog den npub |
| P-3 | Der Name im Profilkopf (ohne Namen der gekürzte Schlüssel) in Großbuchstaben – `.card h3` | wie geschrieben (`.profile-text h3` mit `text-transform: none`) |

**Tests:** `profil-klein.test.ts` (3); ein Formtest angepasst (`browser-dialoge.test.ts`, der
Dialog zeigt den npub). Neuer Smoke „profil_klein“ (Zwischenablage als Attrappe): vorher alle drei
Befunde rot (Hex kopiert, `uppercase`, keine Überschrift), jetzt grün.

**Prüfungen:** protocol 1289 grün, node 412 (ohne Netz), app 1071 (+3), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-38a – Währung und Settings: Kopf, Häkchen, Balken, Texte

Spur C, Befunde W-1, W-2 und X-1 bis X-4 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).
V-1 (Verdienen ohne eigenen Knoten) folgt als C-38b.

| Befund | Vorher | Jetzt |
|---|---|---|
| W-1 | Kopf der Seite Währung „Sats 100“ – las sich wie Guthaben, war der Rest des Sitzungsbudgets; daneben „SOL —“ | „KI-Budget 100 sats“, der Tooltip sagt: eine Obergrenze der laufenden Sitzung, kein Guthaben, gezahlt wird aus der Wallet. Die SOL-Zeile ist weg: Sie las `freedom.escrow.lamports`, das seit der Übernahme (0.I) nichts mehr schreibt – sie zeigte immer „—“ |
| W-2 | Kurs-Hinweis, „Nicht verbunden“ und „Verbinden“ ohne Abstand | je 8 px dazwischen |
| X-1 | Sätze an Häkchen in Großbuchstaben (die Regel für kurze Etiketten `label { text-transform: uppercase }`) | Etiketten mit Häkchen oder Auswahlknopf wie geschrieben (`label:has(input[type=checkbox])`) |
| X-2 | Der Balken über den fünf Schritten füllte sich von links nach der Zahl der erledigten | jeder Teil gehört zu seinem Schritt |
| X-3 | „Zwei der fünf Schritte gehen nur vorher.“ | „Alle fünf helfen nur, wenn sie vor einem Verlust oder Diebstahl des Geräts eingerichtet sind.“ |
| X-4 | „erneut prüfen“, bevor je geprüft wurde; „Letzte Sicherung vor 0 Tag(en)“ | „jetzt prüfen“; „Letzte Sicherung heute“ (ebenso „Heute etwas veröffentlicht.“ beim Zustand eines Repos) |

**Andere Spur:** `protocol/src/state-backup.ts` und `git-contributors.ts` sagen am selben Tag
ebenfalls „heute“ – die App bildet die Sätze neu, ein Test hält beide wortgleich (je eine Zeile,
dazu je ein Testfall im Protokoll).

**Tests:** `geld-settings-klein.test.ts` (4); im Protokoll `state-backup.test.ts` (+1) und ein Fall
mehr in `git-contributors.test.ts`; `i18n.test.ts` vergleicht App und Protokoll jetzt auch für
„heute“. Neuer Smoke „geld_settings_klein“: vorher alle sechs Prüfungen rot (Kopf „Sats“/„SOL“,
`uppercase`, 0 px, Balken `[1,1,0,0,0]` statt `[1,0,0,1,0]`, alter Satz, „erneut prüfen“), jetzt
grün; „waehrung“, „einstellungen“, „zugang“, „sprache“, „mobil“ weiter grün.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1075 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-38b – Verdienen ohne Knoten

Spur C, Befund V-1 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

**Vorher:** Ohne Knoten unter dem Schlüssel sprach die Übersicht von „Dein Knoten nimmt keine
Zahlkanäle an … (ZAHLKANAL=1 und NODE_SOL_ADDRESS setzen)“ und „Dein Knoten hat eine SOL-Adresse …“ –
Anweisungen für Betreiber an jemanden, der keinen Knoten hat.

**Jetzt:** Findet die App unter dem Schlüssel kein Angebot (`angebotVon()`), steht oben ein Hinweis:
kein Knoten unter diesem Schlüssel, Einnahmen erst mit einem; läuft der eigene unter einem anderen
Schlüssel, oben eintragen. Ein Knopf „Knoten einrichten“ führt nach Verdienen › Hosten. Der SOL-Teil
(Zahlkanäle, Hinweis für Betreiber) fällt dann weg; mit Angebot bleibt alles wie bisher, auch der
Hinweis auf `ZAHLKANAL=1` für Knoten ohne Zahlkanal. Der Lightning-Teil bleibt – er zeigt, was ein
Knoten unter dem Schlüssel früher gemeldet hat.

**Tests:** `verdienen-ohne-knoten.test.ts` (2). Neuer Smoke „ohne_knoten“: Hinweis sichtbar, SOL-Teil
weg, kein `ZAHLKANAL`/`NODE_SOL_ADDRESS` und kein „Dein Knoten hat/nimmt“ auf der Seite, der Knopf
öffnet Hosten – vorher rot (kein Hinweis), jetzt grün; „einnahmen“ und „rahmen“ weiter grün.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1077 (+2), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-39a – Einrichtung: die Leiste folgt der Wahl

Spur C, Befunde E-1 und E-7 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung). E-2 bis E-5
(Abstände, Knopfbreiten, Overlays als Dialog) folgen als C-39b.

| Befund | Vorher | Jetzt |
|---|---|---|
| E-1 | Neben Merkphrase und Einrichtung stand oben die Onboarding-Leiste: „Du brauchst nichts einzurichten“ | Während der Einrichtung keine Leiste. `zeigeEinrichtung()` blendet sie aus, `zeigeOnboarding()` zeichnet sie nicht, solange `einrichtungLaeuft()`. Geprüft wird erst nach dem Laden der Bausteine, weil ein Aufruf vom Start schon vor der Einrichtung begonnen haben kann. Danach zeigt die Einrichtung die Leiste wie bisher |
| E-7 | „Nachrichten schreiben“ öffnete zwar die Nachrichten, die Leiste blieb aber bei „Stell einfach eine Frage – Zur KI“ | Die Wahl zählt ab dem ersten Schritt. Bei „Nachrichten schreiben“ heißt der Schritt „Schreib jemandem“ (Unterhaltung mit +, Schlüssel teilen über Profil › Teilen) mit dem Knopf „Zu den Nachrichten“. Bei „Rechner vermieten“ kommt gleich die Anleitung zum Knoten. Die erste gesendete Nachricht zählt wie die erste KI-Antwort als erste Nutzung, danach fragt die Leiste nach der Sicherung |

**Tests:** `einrichtung-leiste.test.ts` (3). Neuer Smoke-Test „einrichtung_wahl“:
- Die Leiste ist bei Merkphrase und allen vier Seiten weg.
- Nach „Nachrichten schreiben“ ist man in den Nachrichten, die Leiste zeigt „Schreib jemandem“, und ihr Knopf führt von der KI aus zurück in die Nachrichten.
- Gegenprobe gegen den alten Code: rot (Leiste überall sichtbar, „Stell einfach eine Frage“, Knopf nach `#/agent`). Mit der Änderung grün; „einrichtung“ bleibt grün.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1080 (+3), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-39b – Eigene Overlays als Dialog, Abstände

Spur C, Befunde E-2 bis E-5 aus dem Nutzertest vom 08.10. (Anhang D der Sammlung).

| Befund | Vorher | Jetzt |
|---|---|---|
| E-2, E-3 | Einrichtung: Knöpfe verschieden breit, mal neben-, mal untereinander, Text dicht am Titel; Merkphrase: „Bestätigen“ und „später“ ohne Abstand | Einrichtung: Knöpfe einer Seite untereinander und gleich breit (`.ein-knoepfe`, 8 px), Absätze mit Zeilenabstand; Merkphrase: beide Knöpfe nebeneinander mit 8 px |
| E-4, E-5 | Die eigenen Overlays (Merkphrase, Einrichtung, Tresor, eingebaute Wallet, Notfall) ohne `role="dialog"`/`aria-modal`, die App dahinter bedienbar | `alsModal()` (`dialog.ts`): Rolle, `aria-modal`, benannt nach dem Titel (die Einrichtung je Seite), Fokus im Dialog, `#app` `inert` – frei, sobald die Hülle aus dem Dokument ist, gleich auf welchem Weg (`MutationObserver`) |

Nebenbei: Die Sperre der App zählt jetzt alle offenen Dialoge (`sperreApp()`), frei erst nach dem
letzten. Bis hierher merkte sich jeder Dialog den Stand vor ihm – schloss der erste zuerst, blieb die
App gesperrt.

**Tests:** `overlay-dialog.test.ts` (4); ein Formtest angepasst (`dom-statt-html.test.ts`: Knöpfe der
Einrichtung über eine Klasse statt `style`, weiter ohne HTML-Text). Neuer Smoke „overlay_dialog“
(Desktop und Handy): Merkphrase und zwei Seiten der Einrichtung als Dialog mit Titel und Fokus, App
`inert`, danach frei; Knöpfe gleich breit mit 8 px Abstand. „einrichtung“, „einrichtung_wahl“,
„tresor“, „sperre“, „loeschen“, „dialog“, „zugang“, „mobil“, „waehrung“ weiter grün.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1084 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-27 – Gratis-Start sichtbar

Spur C, Übergabe von Spur A (09.10., MENSCH): A-14 hat keine Anzeige gebaut.

**Neu:**
- Unter der Eingabe des Agenten steht, was heute auf diesem Gerät gratis noch geht: „Gratis heute: noch 15 von 20 Antworten, 18.766 von 20.000 Tokens“, aufgebraucht „Gratis für heute aufgebraucht – morgen wieder, oder mit einer Wallet weiter“.
- Der Tooltip nennt es eine Fairness-Regel je Gerät, keine Sperre, gezählt nur auf dem Gerät; jeder Provider hat dazu sein eigenes Budget.
- Die Zeile steht nur in den Tarifen „Automatisch“ und „Free“. Sie kommt nur aus `geraeteKontingent` (`kontingentRest()`) und erscheint neu beim Öffnen des Agenten, beim Wechsel des Tarifs und nach jeder Gratis-Antwort (`zeigeGratisStand()`, `shell/gratis-start.ts`). Nichts wird neu gezählt, nichts geht ins Netz, nichts wird gemerkt.
- In der Modellwahl trägt ein Modell „gratis“ (Tooltip „n Provider bieten es heute gratis an“) nur, wenn ein Provider aus `gratisAnbieter()` es anbietet – dieselbe Auswahl wie beim Fragen.

**Tests:** `gratis-anzeige.test.ts` (3). Neuer Smoke-Test „gratis_anzeige“ mit zwei Angeboten aus `scripts/gratis-probe.mts`, eines gratis, eines nur bezahlt:
- frisch 20 von 20,
- nach 5 Antworten und 1 234 Tokens 15 von 20 und 18.766,
- in „Classic“ verborgen,
- „gratis“ nur am Gratis-Modell.

Vorher rot (die Zeile fehlte), jetzt grün.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1087 (+3), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt E10b1 – Kopfgelder am Issue: zeigen, aussetzen, vergeben

Spur C, übergeben von Spur A (09.10., MENSCH; Sammlung A-9, Entscheidung E10 B). Das Format
(38061, `kopfgeld.ts`) gab es seit E10a; jetzt hat es eine Oberfläche. Bezahlen per Klick folgt als
E10b2.

**Neu – `shell/tabs/kopfgeld-ui.ts`:** Auf der Seite eines öffentlichen Issues steht eine Karte
„Kopfgelder“.
- Sie lädt die Kopfgelder selbst (38061 mit `#e` = Issue). Den Stand nimmt sie nur aus
  `kopfgelderZuIssue()` – je Geldgeber und Kennung das neueste.
- Jede Zeile zeigt Betrag (nur die zugesagten Währungen, nichts umgerechnet), Stand, Aufgabe und
  Geldgeber.
- „Kopfgeld aussetzen“ fragt Aufgabe (vorbelegt mit dem Titel des Issues), Beschreibung und einen
  Betrag in sats, in SOL oder in beiden. Der Hinweis sagt ehrlich: öffentlich und signiert; zugesagt
  und selbst gezahlt, direkt an die Person, die es erledigt; nichts verwahrt, nichts von selbst gezahlt.
- Den Stand setzt nur der Geldgeber (`signiere()`):
  - vergeben an Autorin oder Kommentierende, nie an sich selbst,
  - als erledigt markieren, wieder öffnen, zurückziehen.
- Andere sehen nur den Stand.
- Nicht im privaten Raum (dort gibt es keinen Baustein) und nicht bei Repos nur auf diesem Gerät.

`wiring-ausnahmen.txt`: `baueKopfgeld`, `kopfgelderZuIssue`, `leseKopfgeld` und `aktuelleKopfgelder`
sind jetzt verdrahtet. `offeneKopfgelder` bleibt ausgenommen.

**Tests:** `kopfgeld-ui.test.ts` (3). Neuer Smoke-Test „kopfgeld“ mit Repo, Issue, Kommentar und
fremdem Kopfgeld aus `scripts/kopfgeld-probe.mts`:
- Das fremde Kopfgeld steht ohne Knöpfe da.
- Ein eigenes wird ausgesetzt: 500 sats + 0,01 SOL, ein 38061 mit `e`, `a`, `amount_msat`,
  `amount_lamports`, `status` offen.
- Es wird an die vorgewählte Autorin vergeben (`p`); danach stehen „Als erledigt markieren“,
  „Wieder öffnen“ und „Zurückziehen“ da.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1090 (+3), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt E10b2 – Kopfgeld per Klick bezahlen

Spur C, zweiter Teil von E10b (Sammlung A-9, Entscheidung E10 B).

**Neu:**
- **`kopfgeld-zahlung.ts`** (ohne DOM): `bezahleKopfgeld()` zahlt je zugesagter Währung genau
  einmal, über die Zahlschienen (`zahle()`, neuer Zweck „kopfgeld“).
  - Was schon bezahlt ist, merkt sich das Gerät (`freedom.kopfgeld.bezahlt` in `geheim`, je
    Geldgeber, Kennung und Empfänger). Scheitert die zweite Währung, zahlt ein neuer Klick nur sie.
    Von selbst wird nie wiederholt.
  - Ziele nur aus vorhandenen Quellen:
    - Lightning über die Adresse im Profil – die Schiene holt die Rechnung und prüft ihren Betrag.
    - Ohne Adresse versiegelt erfragt (`frageRechnungAn()`, nur ganze sats).
    - SOL über die gemerkte oder versiegelt erfragte Adresse (`frageAdresseAn()`).
    - Die öffentliche SOL-Adresse aus dem Profil nur nach Warnung.
    - Keine Eingabe von Hand – eine neue Quelle nur nach Rückfrage beim MENSCHEN.
- **`kopfgeld-ui.ts`:** Am eigenen, vergebenen Kopfgeld gibt es den Knopf „Bezahlen …“.
  - Einmal bestätigen; der Dialog nennt Betrag (nur der noch offene Teil) und Person.
  - Danach steht das Kopfgeld auf „erledigt“.
  - Ein Fehlschlag sagt, was schon bezahlt ist, und lässt den Stand auf „vergeben“.
- **Andere Spur:** `payment-rail.ts` (Protokoll) kennt den Zweck „kopfgeld“ (eine Zeile). Das
  Zahlungsbuch zeigt ihn als „Kopfgeld“.

**Tests:** `kopfgeld-zahlung.test.ts` (6):
- Lightning-Adresse; versiegelt; ganze sats.
- Teil-Fehlschlag ohne Doppelzahlung.
- SOL aus dem Profil nur nach Warnung.
- Nur vergebene Kopfgelder.
- Verdrahtung.

Smoke-Test „kopfgeld“ erweitert: Bezahlen ohne Wallet scheitert laut. Danach geht kein „erledigt“
hinaus, und der Knopf ist wieder frei.

**MENSCH (Devnet/Testnet):** einmal mit echter Test-Wallet bezahlen – Lightning an eine Adresse,
SOL an eine versiegelt erfragte Adresse – und den Eintrag „Kopfgeld“ im Zahlungsbuch sehen.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1096 (+6), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 12.4b – Schalter „sats / SOL“ beim Gebot

Spur C, Sammlung A-1 (12.4 mit 12.4b, von Spur A übernommen 09.10., MENSCH; E5 dafür geändert).

**Neu:**
- **`ki-schiene.ts`** (ohne DOM): `kiSchiene()` ist die Schiene für KI – die eigene Wahl
  (`freedom.ki.schiene`), sonst die Standard-Schiene wie seit 12.4a.
  - `gebotInSats()`: Gebot aus dem Feld in ganzen sats. SOL nur über `kurs.ts` umgerechnet;
    ohne Kurs kein Gebot. Abgerundet, damit das Gebot nie mehr wird als eingetippt. Was keinen
    ganzen sat ergibt, ist kein Gebot (0 hieße gratis).
  - `gebotAlsText()`: Gebot in sats für das Feld in der gewählten Einheit, hin und zurück gleich.
- **`shell/tabs/agent-gebot.ts`:** Das Gebot steht jetzt sichtbar beim Tarif, mit dem Schalter
  „sats / SOL“ daneben.
  - Ausgeblendet im Tarif „Free“ und für dieses Gerät oder den eigenen Knoten.
  - Umschalten rechnet das Gebot um. Mit SOL steht die Vorgabe (100 sats) nie als SOL im Feld –
    erst leer, mit Kurs umgerechnet.
- **`askAi()`:** Bezahltes geht nur mit gültigem Gebot hinaus – vor der Rückfrage in
  „Automatisch“, vor Funk und vor dem Netz. Ohne Kurs sagt die App es, nichts gesendet. Die
  Rückfrage nennt das Gebot zuerst in der gewählten Einheit.
- **`ki-zahlung.ts`:** Zahlweg und Ziele nach `kiSchiene()`. Mit SOL ohne Kanal wirft die App
  `KanalNoetig` mit dem Provider. Die Fehlerblase bietet dafür „Kanal anbieten“ an: Währung ›
  Hinterlegen, der Provider ist eingetragen, der Betrag dran. Dort öffnet `oeffneZahlkanal()`
  den Kanal. Nie still über Lightning (E3 A).
- **Andere Spur:** `knoten-agent-fragen.ts` (11.3d1b2, Spur B) zahlt Fragen an Agenten auf
  einem Knoten ebenfalls nach `kiSchiene()` – eine Zeile.
- **Texte:** „Gebot“ statt „Gebot (sats)“. „Kanal nötig“ und die Standard-Schiene in den Settings
  nennen den Schalter.

**Tests:** `ki-schiene.test.ts` (7):
- Wahl vor Standard-Schiene, ohne Speicher.
- Gebot in sats; Gebot in SOL nur mit Kurs, nie mehr als eingetippt; hin und zurück.
- Verdrahtung.

Angepasst: `ki-zahlweg.test.ts` und `ki-funk.test.ts` – dieselben Prüfungen auf die neue Form.

Smoke „ki_schiene“ mit Kurs und Provider aus `scripts/ki-schiene-probe.mts`:
- Gebot in „Automatisch“ sichtbar, in „Free“ nicht.
- SOL ohne Kurs: Feld leer, nichts gesendet.
- Mit Kurs 0,000666667 SOL für 100 sats, hin und zurück gleich.
- Ohne Kanal: Fehlerblase mit „Kanal anbieten“, kein Umschlag gesendet; der Knopf führt nach
  Hinterlegen mit Provider und Fokus auf dem Betrag.

Gegenprobe: Ohne die Sperre vor dem Netz ist der Smoke rot.

**MENSCH (Devnet):** einmal mit SOL und offenem Kanal eine KI-Frage bezahlen und das Gebot in
SOL sehen.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1103 (+7), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 11.3e1 – Agent hinzufügen im Raum

Spur C, erster Teil von 11.3e (Karte `phase-11.md`, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P2, P4, P5,
F3 B). Die Bausteine kommen aus 11.3c (Spur A) – hier die Oberfläche dazu.

**Neu:**
- **Raum-Menü „Agent hinzufügen“** (`raeume.ts`, `agentZiel()`): nur als Hauptidentität (Agenten
  gehören der Person, 8.6c); im privaten Raum als Moderator, im offenen mit dem Recht
  „rollen_vergeben“.
- **`shell/raum-agenten-ui.ts`:**
  - Erst der Tresor – Schlüssel, Anweisung und Budget liegen nur dort.
  - Dann wählen: einen neuen Agenten anlegen oder einen dieses Geräts, der noch nicht im Raum ist.
  - Neu: Name, Beschreibung (öffentlich), Anweisung (bleibt im Tresor, geht versiegelt an den
    Provider), Modell – in den Grenzen des Buchs.
  - Budget je Monat und Tag in sats oder SOL. Die Einheit ist vorgewählt nach der Schiene für KI
    (12.4b). Die Beträge sind leer vorbelegt, damit nie eine sats-Zahl als SOL hinausgeht.
  - Der Dialog sagt vorher, was gilt: Der Agent antwortet nur, solange die App offen ist, und du
    bezahlst jede Antwort – auch für Fragen anderer, im offenen Raum von jedem, der beitritt (B-22).
    Mit SOL zahlt er nur über einen Zahlkanal.
  - Eingeladen wird über `ladeAgentInOffenenRaum()` bzw. `ladeAgentInPrivatenRaum()`. Beide
    schreiben den Pflicht-Hinweis in den Raum.
- **`raum-agent-budget.ts`** (ohne DOM): `leseBudgetEingabe()` – sats als ganze Zahl, SOL über
  `solZuLamports()`, die Tagesgrenze nie über dem Monat.

**Tests:** `raum-agenten-ui.test.ts` (4):
- Budget in sats und in SOL, auch Unfug.
- Ablauf: Tresor zuerst, nur Agenten ohne diesen Raum, Budget leer vorbelegt.
- Verdrahtung: Menüpunkt nur, wer darf.

Smoke „raum_agent“: eigener offener Raum mit Tresor, neuer Agent „Helfer“. Das Budget meldet „Tag über
Monat“. Danach im Netz:
- Rolle `agent` (nur lesen, schreiben, Threads), Zuweisung, Karte vom Agenten mit Besitzer;
- die Liste des Besitzers und der Pflicht-Hinweis;
- nichts offen in localStorage.

Er steht mit der Rolle „Agent“ in der Mitgliederliste; ein zweites Mal steht er nicht zur Wahl.
Smoke „raum“ angepasst: Im Probe-Raum ist der Test-Nutzer „mod“ mit „rollen_vergeben“, also steht
„Agent hinzufügen“ im Raum-Menü vorn; die Tastatur-Prüfung erwartet das und geht einen Pfeil weiter
zum selben Dialog wie bisher.
Stabil in 6 Läufen; im Test liegt eine Sekunde zwischen dem Anlegen des Raums und dem Agenten.
Die neue Rollenliste ersetzt die vom Anlegen, und in derselben Sekunde entschiede die Id (Fallstrick
B-20c). Für Menschen mit drei Dialogen dazwischen ist das kein Fall.

**Offen (11.3e2 ff.):**
- Kennzeichen und Menü der Agenten in der Mitgliederliste (Budget ändern, aus dem Raum nehmen).
- Schalter „Agenten sprechen Agenten an“.
- Einstellungen im Überblick.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1107 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 11.3e2 – Agenten in der Mitgliederliste

Spur C, zweiter Teil von 11.3e (Karte `phase-11.md`, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P1, P4, P5).

**Neu:**
- **Mitgliederliste** (`raeume.ts`, `zeigeMitglieder()`):
  - Agenten heißen wie in ihrer Karte, nur als Text: offen aus den Karten der Mitglieder mit Rolle
    `agent` (11.3d1b1), privat aus der Gruppe.
  - Sie tragen das Kennzeichen „Agent“ (`agentKennzeichen()`). Der Tooltip sagt, wo der Agent läuft:
    - auf dem Gerät seines Erstellers – antwortet nur, solange dessen App offen ist;
    - auf einem Knoten – der Knoten liest alles mit.
  - Er sagt auch, wer zahlt: wer ihn eingeladen hat, oder wer fragt.
  - Die Rolle `agent` steht nicht noch einmal daneben.
- **Menü eines eigenen Agenten** (`eigeneAgentAktionen()`), nur für Agenten dieses Geräts mit Budget
  im Raum:
  - „Budget ändern …“ in seiner Einheit. Der Dialog zeigt, was im Monat und heute verbraucht ist. Für
    die andere Einheit: herausnehmen und neu hinzufügen – sonst begänne der Verbrauch still neu.
  - „Aus dem Raum nehmen“: offen die Rolle entziehen, privat ein Commit. Das Budget fällt weg; der
    Agent bleibt auf dem Gerät und steht danach wieder zur Wahl.
- **Fremde Agenten** bekommen keine Direktnachricht im Menü (ein Agent liest keine), nur was ich im
  Raum darf.
- `raum-agent-budget.ts`: `budgetText()`, `verbraucht()` (nur der laufende Monat und Tag, UTC).

**Tests:** `raum-agenten-ui.test.ts` +2 (Budget als Text hin und zurück, Verbrauch nur im laufenden
Zeitraum, Verdrahtung). `raum-mitglieder.test.ts` angepasst: Name und Menü heißen nach der Karte.

Smoke „raum_agent“ erweitert:
- Zeile „Helfer“ mit „Agent“ und Tooltip.
- Menü mit „Budget ändern …“ und „Aus dem Raum nehmen“.
- Budget-Dialog mit „sats“, 100, 50 und „0 sats verbraucht“; gespeichert.
- Herausnehmen schickt eine Zuweisung ohne Rollen. Danach ist das Kennzeichen weg, und er steht wieder
  zur Wahl.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1109 (+2), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 11.3e3 – Agenten sprechen Agenten an

Spur C, dritter Teil von 11.3e (Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`, „Agentenketten“, F5 B mit
Schalter; Protokoll seit 11.3b2, ausgewertet seit 11.3c2/11.3d).

**Neu:**
- **Raum-Menü „Agenten sprechen Agenten an …“** (`shell/raum-ketten-ui.ts`): offen für den Gründer,
  privat für Moderatoren, nur als Hauptidentität. Standard aus.
  - An mit Grenze 1–50 (Vorgabe 10).
  - Der Dialog sagt, was gilt:
    - Jede Kette beginnt bei einem Menschen und endet nach der Grenze.
    - Jede Antwort kostet aus dem Budget dessen, der den Agenten eingeladen hat.
    - Agenten, bei denen der Fragende zahlt, antworten Agenten nie.
- **Offen:** eine neue Definition des Gründers (34700) mit `agentenkettenTag()`.
  - Sie entsteht aus seiner neuesten Definition (`definitionDesGruenders()`).
  - Sie ist nie in derselben Sekunde wie die vorige – sonst entschiede die Id (Fallstrick B-20c).
- **Privat:** `setzePrivateKetten()` schickt eine neue Definition in die Gruppe, nur als Moderator.
- **Der Schalter bleibt** (`raum-ketten.ts`, `mitKetten()`, `privateDefinition()`).
  - Raumstand nach einer Einladung, Kanal anlegen und Kanal ändern schreiben die Definition neu
    (`definitionMitKetten()` in `raum-mls.ts`) und nehmen den Schalter mit.
  - Vorher hätten sie ihn still ausgeschaltet.
- `agentenkettenTag` ist jetzt verdrahtet – die Ausnahme in `wiring-ausnahmen.txt` fällt weg.

**Tests:** `raum-ketten.test.ts` (4):
- an, ändern, aus;
- Grenze;
- neueste Definition eines Admins;
- Verdrahtung.

`raum-kanal.test.ts` angepasst: Kanal anlegen und ändern bauen jetzt über `definitionMitKetten()`.

Smoke „raum_agent“ erweitert:
- Der Gründer schaltet an (Grenze 12). Die neue Definition trägt `agentenketten` 12 und ist neuer als
  die vorige.
- Der Dialog zeigt danach „an“ und 12.
- Wieder aus: eine neuere Definition ohne Tag; der Name bleibt.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1113 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 11.3e4 – Agent auf einem Knoten aufnehmen

Spur C, vierter Teil von 11.3e (Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P2, P4; Knoten seit 11.3d, Spur B).
Bisher ging das nur im privaten Raum über „einladen“ mit dem Schlüssel (11.3d2c). Im offenen Raum gab
es keinen Weg, einem Agenten auf einem Knoten die Rolle `agent` zu geben – ohne sie antwortet er dort
nicht.

**Neu:**
- **„Agent hinzufügen“ fragt jetzt immer zuerst, welcher Agent:** ein neuer auf diesem Gerät, einer
  dieses Geräts, oder „Agent auf einem Knoten“.
  - Der Tresor ist nur noch für Agenten auf dem Gerät nötig – vor dem Anlegen.
  - Ohne Tresor stehen keine vorhandenen zur Wahl.
- **Agent auf einem Knoten** (`knotenAgentAufnehmen()` in `raum-agenten-ui.ts`):
  - Schlüssel als npub oder Hex, auch gescannt.
  - Die App nimmt ihn nur mit einer Karte vom Agenten, die „knoten“ sagt (`knotenAgentKarte()`).
  - Vorher die Warnung aus 11.3d2c: Der Knoten liest alles im Raum mit, wer fragt, zahlt.
  - Offen: `nimmKnotenAgentAuf()` (`agenten.ts`, Spur A, klein) – die Rolle `agent` zuweisen und der
    Pflicht-Hinweis im Raum. Karte, Budget und Liste gehören dem Knoten.
  - Privat: einladen wie einen Menschen (`ladeInPrivatenRaum()`) und der Hinweis
    (`meldeKnotenAgentImRaum()`).
- **`agenten.ts`:** Die Prüfung der Rolle `agent` (fehlt sie oder trägt sie mehr, legt sie nur der
  Gründer an) steht jetzt in `sichereAgentRolle()` – für beide Wege dieselbe.

**Tests:**
- `raum-agenten-ui.test.ts` +1: Karte nötig, Warnung vorher, offen die Rolle, privat einladen, kein
  Budget und keine Karte von uns.
- Ablauf-Test angepasst: Tresor erst vor dem Gerät.
- `agenten-buch.test.ts` (11.3c1) auf `sichereAgentRolle()` angepasst.

Smoke „raum_agent“ erweitert, mit einer Karte „Rechner“ aus `scripts/knoten-agent-probe.mts`:
- Erste Wahl: „Neuen Agenten anlegen“ und „Agent auf einem Knoten“; nach dem Herausnehmen auch
  „Helfer“.
- Schlüssel eingeben, Warnung bestätigen. Danach: Zuweisung mit Rolle `agent`, Pflicht-Hinweis
  „Agent Rechner läuft auf einem Knoten“, „Rechner“ mit Kennzeichen „auf einem Knoten · wer fragt,
  zahlt“ in der Mitgliederliste.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1114 (+1), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-40 – Smoke „raum“: Repo-Einstellungen warten auf die neue Seite

Spur C, Befund aus der CI: Der Browser-Test war auf zwei Zwischenständen rot (#420 und #429). Derselbe Code war
auf dem nächsten Stand grün. Ein roter Test gilt nie als Zufall – also nachgesehen.

**Ursache:** In „raum“ (desktop, C.3a2) speichert der Test die Repo-Einstellungen und wartete danach fest 800 ms.
Die App veröffentlicht erst und zeichnet die Seite dann mit `neuLaden()` neu. Im langsameren CI-Runner war die
Ankündigung schon gesendet, die Seite zeigte aber noch keinen Link – Meldung „Einstellungen gespeichert … [] True“.
Nachgestellt ohne Pause: lokal derselbe Fehler, auf Desktop und Handy.

**Jetzt:** Der Test wartet auf den neuen Link (`.repo-web a`, Frist 8 s) statt auf eine feste Pause. Ohne jede
Pause grün. Ein Satz dazu bei der Fallstrick-Regel aus A-30 in `scripts/CLAUDE.md`.

Kein App-Code geändert.

**Prüfungen:** protocol 1290 grün, node 412 (ohne Netz), app 1114 (+0), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt VK-Recherche – Hermes über ACP, Live-Vorschau, MCP-Katalog, Kurzcode

Nur Dokumente (`docs/VIBECODEN-ENTWURF.md`).

**Entscheidungen 13.10. (MENSCH):**
- VK-W2 A (git ins Bild);
- VK-W4 B (Schalter „Internet frei“);
- VK-W5 B (auch ein Code zum Eintippen);
- VK-W3 erweitert: Live-Vorschau für APK, Linux, Windows und Web, dazu MCP für gängige Programme.
- Zu VK-W1 fragte der MENSCH, was gegen Hermes mit Freedom-Diensten statt Nous Portal spricht.

**Befunde:**
- **Hermes:**
  - MIT, sehr groß und schnell bewegt, Abhängigkeiten exakt gepinnt.
  - Spricht ACP: Werkzeuge, Diffs, Befehle und Freigaben als Strom, MCP-Server je Sitzung. Das
    passt auf VKa.
  - Das Portal (Modelle und Tool Gateway: Suche, Bilder, Sprache, Browser) lässt sich durch das
    eigene Modell und Freedom-MCP ersetzen.
  - Gegenmittel: gepinnt bauen statt `curl | bash`, fremde Anmeldungen aus, `local` in unserer
    Sandbox mit Freigaben `manual`, Telemetrie vorher prüfen, Gedächtnis nur für eigene
    Projekte.
- **GX10:**
  - ist ARM64 (GB10), hat NVENC;
  - Unity, Unreal, Resolve und Ableton laufen dort nicht → Werkbank-Knoten (weitere eigene
    Rechner per QR);
  - Android über redroid mit scrcpy, `aapt2` nur über einen Community-Bau oder FEX;
  - Windows über Wine und Hangover.
- **Vorschau** wie ein Anruf (WebRTC über den eigenen TURN, versiegelter Aufbau, Eingaben über
  einen Datenkanal).
- **MCP-Katalog** mit Lizenzen aus den Repos (Godot, Unity, Unreal, Blender, FreeCAD, KiCad,
  OpenSCAD, GIMP, Inkscape, Krita, OBS, Resolve, Ableton, LibreOffice, Jupyter, QGIS,
  Playwright, Chrome DevTools, mobile-mcp, ComfyUI, Home Assistant, Referenz-Server).
- **Kurzcode K1:** zwölf Zeichen (60 Bit) mit PBKDF2 wie der Tresor, ohne neue Kryptografie.
  PAKE (K2) später.

**Fragen an den MENSCHEN:** VK-W1n (Empfehlung C: ACP mit Hermes als erstem Motor), VK-W6
(`@agentclientprotocol/sdk`), VK-W7 (Werkbank), VK-W8 (Reihenfolge der Vorschau), VK-W9 (K1).
Neue Aufteilung VKb–VKl.

**Prüfungen:** nur Dokumente – siehe Pull Request.

## Schritt VKc1 – Projekte auf dem eigenen Knoten

Spur A, erster Teil von VKc aus der neuen Aufteilung (Entwurf `docs/VIBECODEN-ENTWURF.md`; VK-W2 A,
entschieden 13.10.). Der Knoten legt Projekte an und listet sie auf – nur für den gekoppelten Besitzer.
Den Agenten, der darin arbeitet, bringt VKc2 (wartet auf VK-W1n und VK-W6).

**Neu:**
- **`node/src/projekte.ts`** (`ProjektAblage`):
  - Je Projekt ein Ordner in `~/.freedom/projekte` (0700) mit eigenem git, Zweig `main`, ohne Vorlagen.
  - Nur Namen nach `istProjektName()` und nur echte Ordner; Verweisen folgt der Knoten nicht.
  - Höchstens 100 Projekte. „Schritte“ sind die Commits, „geändert“ ist die Zeit des letzten Commits,
    ohne Commit die Zeit des Ordners.
  - git nur ohne Shell, mit leerer Umgebung und ausdrücklichem Repository. Feste Einstellungen gehen jeder
    Datei vor: kein fsmonitor, keine Hooks, keine Signaturprüfung beim Lesen. Ab VKc2 schreibt ein Agent
    im Projekt; eine `.git/config` von dort führt nichts aus (Gegenprobe im Test).
- **Einschalten** mit `VIBECODEN=1` (`projekteAusUmgebung()`); ein anderer Wert hält den Start an. Ohne
  git bleibt es aus. An ist es nur mit Rolle `code` im Status.
- **`dvm-provider.ts`, `handleCode()`:** Kind 5080 nur aus einem Umschlag mit Nachweis (`istBesitzer()`),
  gelesen über `leseCodeAuftrag()`, Antwort 6080 versiegelt (`codeAntwortText()`).
  - `liste` und `neu` gehen.
  - `auftrag`, `freigabe` und `stopp` lehnt der Knoten bis VKc2 mit der Kennung `code-ohne-motor` ab.
  - Weitere Kennungen: `code-aus`, `code-zu-viele`, `code-git`, `code-ablage`.
  - Zählt nicht als Auftrag. Ins Log kommen nur Zahlen; Fehler des Dateisystems tragen den Pfad, sie gehen
    nur als `code-ablage` hinaus.
  - Bis VKc1 ging ein versiegelter 5080 des Besitzers als KI-Frage durch.
- **Status:** neue Rolle `code` (`STATUS_ROLLEN`, App-Text „Projekte zum Vibecoden“, klein in Spur B/C).
- **Docker-Bild:** mit git. `docker-compose.yml` hat `VIBECODEN`.
- **Doku:** `docs/PROTOCOL.md` 34 (Ablehnungen, `neu` ändert Vorhandenes nicht), 24 (Rolle), `docs/PROVIDER.md`.
- **`docs/ausbau/OFFEN.md`:** entschiedene VK-Fragen raus. Neu sind VK-W1n und VK-W6 bis VK-W9 sowie die
  Zeilen der Spur A nach der neuen Aufteilung (VKc2, VKc3, VKd, VKf, VKj, VKl).
- Drei Ausnahmen in `wiring-ausnahmen.txt` fallen weg; `codeSchrittText` wartet auf VKc2.

**Tests:** `node/test/projekte.test.ts` +9:
- Umgebung; Anlegen und Auflisten; Namen, Verweise und Dateien; Grenze 100; ohne git.
- Die Konfiguration im Projekt (mit Gegenprobe).
- Der Besitzer über den Provider: versiegelt, kein Name im Log, zählt nicht.
- Fremde, ohne Ablage, Lauf ohne Motor (Kennungen).
- `main.ts` und Docker-Bild.
- `protocol/test/knoten-status.test.ts`: zwölf Rollen.

**Prüfungen:** protocol 1290 grün, node 443 (+9, 9 übersprungen), app 1114, mls 13, Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke, build-site, repro-build grün.

## Schritt A-21a – Solana-Vektoren: die Bytes jeder Transaktion festgehalten

Spur A, erster Teilschritt von A-21 (`docs/KIT-PLAN.md`, freigegeben 11.10.: A-21a und A-21b vor A-12a).
Bevor web3.js v1 durch `@solana/kit` ersetzt wird, hält ein Test die Nachricht jeder Transaktion fest,
die App, Protokoll und Knoten heute bauen. Jeder spätere Schritt muss dieselben Bytes liefern. Keine
neue Abhängigkeit.

**Neu:**
- **`protocol/test/fixtures/solana-vektoren.json`:** 17 Nachrichten (base64), erzeugt mit web3.js 1.98.4.
  Feste Schlüssel aus Seeds, fester Blockhash, Frist weit in der Zukunft. Die Datei wird nie neu erzeugt.
  - **Protokoll und Knoten** (`protocol/test/sol-vektoren-faelle.ts`, 10):
    - Zahlkanal: öffnen, aufstocken, einlösen mit Ed25519, erstatten.
    - Nonce-Konto: anlegen, schließen; Überweisung ohne Internet.
    - LP-Adapter (HTLC): sperren, einlösen, zurückholen – über eine Attrappe der Verbindung, die wie
      web3.js signiert.
  - **App** (`app/test/sol-vektoren-faelle.ts`, 9):
    - HTLC: Deposit mit zwei Sperren, Gegenrichtung, einlösen, zurückholen.
    - Einlösung über einen Relayer mit Erstattung.
    - Zahlkanal öffnen und aufstocken über `sendeMitWallet()` – Byte für Byte gleich wie im Protokoll.
    - Überweisung und Trinkgeld, mit und ohne Referenz.
    - Verbindung und Wallet sind Attrappen; die Wallet signiert mit einem festen Schlüssel.
- **`sol-transfer.ts`:** `buildSolTransfer()` nimmt optional eine Verbindung (nur für den Blockhash).
  Ohne sie gilt wie bisher die beste aus dem Pool. Die Schiene ruft unverändert mit vier Werten.
- **Fallstrick** in `packages/protocol/CLAUDE.md`: Vektoren nie neu erzeugen; `HTLC_PROGRAM_ID` in der
  Umgebung ändert die LP-Vektoren, der Test sagt das.

**Tests:**
- protocol +3: alle Fälle gleich dem Vektor, keiner fehlt oder ist zu viel; zweimal gebaut, dieselben Bytes;
  Blockhash und Zahler je Vektor, Ed25519-Anweisung mit dem Sitzungsschlüssel, der Gutschrift und einer
  gültigen Signatur.
- app +3: alle Fälle gleich; Zahlkanal gleich wie im Protokoll; zweimal dieselben Bytes.
- Gegenprobe: Mit einer anderen HTLC-Programm-ID scheitern die LP-Vektoren.

**Prüfungen:** protocol 1293 (+3), node 443 (9 übersprungen), app 1117 (+3), mls 13, Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke, build-site, repro-build grün.

## Schritt 11.5b – Repo-Aufträge: Tag in der Erwähnung, Agenten pflegen nie

Spur A, Protokoll-Schritt aus `docs/REPO-AGENTEN-ENTWURF.md` (V1 und V6, freigegeben 11.10.; im neuen
Zuschnitt nach W3 unverändert). Hängt an keiner offenen Frage: Harness (W3a) und private Räume (W7)
betreffen erst 11.5c und 11.5d.

**Neu:**
- **`protocol/src/repo-auftrag.ts`** (`docs/PROTOCOL.md` 33):
  - Der Repo-Auftrag ist eine Erwähnung des Agenten mit `["a", "30617:<eigentümer>:<kennung>", "", "repo"]`,
    optional `["e", <issue>, "", "issue"]`. Bauen mit `repoAuftragTags()`, lesen mit `leseRepoAuftrag()`:
    genau ein Repo, höchstens ein Issue, sonst kein Auftrag.
  - **Zum Raum gehören:**
    - offen über `repoImOffenenRaum()`: die neueste Ankündigung verweist auf genau diesen Raum, ihr
      Eigentümer hat `repos_pflegen` (`mitRaumRechten()`) und ist kein Agent;
    - privat über `repoImPrivatenRaum()`: von einem Pfleger der Gruppe angekündigt.
    - Sonst gilt `agent-repo-fremd`.
- **Agenten pflegen nie (V6)**, über den neuen optionalen Parameter `istAgent`:
  - `patchStatus()`: Status-Events von Agenten zählen nie, auch nicht als Maintainer, auch nicht am
    eigenen Patch.
  - `mitRaumRechten()`: Agenten sind keine Pfleger; ein von einem Agenten angekündigtes Repo gehört nicht
    zum Raum.
  - `raumReposPrivat()`: Agenten pflegen nicht, auch als Admin.
- **App** (`repo-ansicht.ts`, `shell/raum-repos.ts`):
  - Repo-Karten offener Räume erkennen Agenten an der Rolle `agent` (`istAgentIm()`), private an ihrer
    Karte in der Gruppe (`raumAgentKarten()` → `PrivateRepos.agenten`).
  - Die Annahme eines Agenten zeigt die App also nie als angenommen.
- Vier Ausnahmen in `wiring-ausnahmen.txt`: Den Auftrag liest erst der Knoten (11.5c), das Tag setzt erst
  die App (11.5d).
- **Fallstrick** in `packages/protocol/CLAUDE.md`.

**Tests:**
- protocol +4 (`repo-auftrag.test.ts`):
  - Tags: Hin- und Rückweg; fremde `a`- und `e`-Tags zählen nicht; zwei Repos oder zwei Issues ergeben
    keinen Auftrag.
  - Offener Raum mit einem Agenten, der sogar `repos_pflegen` hat; neueste Ankündigung.
  - `patchStatus()` mit Agent als Pfleger und als Autor.
  - Privater Raum mit einem Agenten als Admin.
  - Jeweils die Gegenprobe ohne `istAgent`.
- app +2: Karte im offenen und im privaten Raum (mit Gegenprobe), Verdrahtung.

**Prüfungen:** protocol 1297 (+4), node 443 (9 übersprungen), app 1119 (+2), mls 13, Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke, build-site, repro-build grün.


## Schritt Entscheidungen 14.10. – Vibecoden, Repo-Agenten, RM2, kit, Cashu

Nur Doku, Spur A. Der MENSCH am 14.10.2026: „Ja zu allen deinen Vorschlägen für die offenen
Entscheidungen.“

**Eingetragen** (je ein Abschnitt „Entscheidungen vom 14.10.2026“, gilt vor den Fragen):
- `docs/VIBECODEN-ENTWURF.md`:
  - VK-W1n C – der Knoten ist ACP-Client, Hermes der erste Motor (gepinnt, Sandbox, Freedom-MCP
    statt Nous Portal);
  - VK-W6 ja – `@agentclientprotocol/sdk` 1.8.0 (Apache-2.0);
  - VK-W7 A (Werkbank-Knoten), VK-W8 A (erst Web und Linux), VK-W9 K1 (zwölf Zeichen, PBKDF2).
- `docs/REPO-AGENTEN-ENTWURF.md`: W3a A (Ablauf wie mini-swe-agent in TypeScript), W6a wie
  vorgeschlagen, W7 A (nur Mitglieds-Agenten mit Modell auf demselben Rechner).
- `docs/RM2-ENTWURF.md`: V1–V9 und W1–W5 wie vorgeschlagen; Bau nach A-17c.
- `docs/KIT-PLAN.md`: A-21b in zwei Teilen (b1 Protokoll mit Brücke zu web3.js, b2 App),
  `@solana/kit` exakt 8.4.0 (8.5.0 erschien am 13.10.).
- `docs/E4B-ENTWURF.md`: V3 mit RM2 W5 geändert, A-17c frei.

**Übersichten:**
- `OFFEN.md`: die Fragen in 1.1 und 1.2 gelöscht (Abschnitte neu nummeriert).
- Neuer Stand: VKc2, VKf, VKj, 11.5n, A-21b1/b2 und A-17c frei; RM2a–c nach A-17c; 11.5c nach
  Spur B (11.5s, 11.5a).
- `FORTSCHRITT.md` (Zeile Spur A) und `SAMMLUNG.md` (A-17, A-21, A-31, RM2) nachgezogen.

**Als Nächstes:** die Commits des lokalen Agenten zur Telegram-Mini-App prüfen und reparieren
(Wunsch MENSCH 14.10.), dann A-21b1.

## Schritt TMA-1 – Mini-App für Telegram repariert: eigener Build, Signatur nur an den Server

Spur A, Wunsch MENSCH 14.10.2026: „repariere die tma-commits, das war mein lokaler agent, wusste
nicht dass er das repo ändert, mach es richtig damit alles gut funktioniert.“ Die Commits d6e8e71,
840cada, ac1315b und e548286 kamen am 13./14.10. ohne Pull Request auf `main`.

**Befunde:**
- Mit `FREEDOM_TMA_API` hätte `build-site.sh` die Telegram-Fassung als `freedom.html` veröffentlicht,
  und `repro-build.sh` hätte jede Veröffentlichung gestoppt. Zusätzlich änderte die Variable die CSP des
  Web-Builds. Heute ist sie nicht gesetzt (`/tma/` liefert 404, die Live-App enthält kein `telegram.org`).
- Ein globaler fetch-Patch hängte die Telegram-Signatur (ID, Name, Benutzername) an jeden Aufruf
  derselben Herkunft, auf Pages also an GitHub.
- Das Inline-Skript mit der API-Adresse ließ die CSP nicht zu – Betrieb B erreichte den Server nie.
- Die CSP öffnete ganz `telegram.org`, `'self'` und den API-Host für Skripte. TON Connect UI kam
  ungenutzt vom Knoten. Das „Icon“ war eine SVG-Datei mit der Aufschrift „SW“.
- Stars und TON sind nicht verdrahtet: Nichts in der App ruft sie auf, gebuchte Sterne kaufen nichts.

**Repariert:**
- `build.mjs`: `FREEDOM_TMA=1` schreibt nur `dist/tma/index.html` (+ `.sha256`). Flag und Adresse
  (`FREEDOM_TMA_API`, nur https-Herkunft, sonst Abbruch) kommen per `define` ins Skript. Die CSP
  erlaubt zusätzlich nur `https://telegram.org/js/telegram-web-app.js`; der Build prüft, dass außer dem
  eingebetteten Skript nur dieses eine geladen wird.
- `tma.ts`: kein globaler Patch mehr, `tmaFetch()` nur für `/tma/…` an den Server. Die Brücke wirkt
  nur im Mini-App-Build; `boot()` lädt sie sonst nicht.
- `stars-checkout.ts`, `ton-connect.ts`: über `tmaFetch()`/`tmaApiBasis()`, Sprache der App, kein
  `Math.random`; im Kopf als „nicht verdrahtet“ markiert.
- `build-site.sh` legt `/tma/` aus `dist/tma/` an. `repro-build.sh` baut mit `FREEDOM_TMA_API` auch die
  Mini-App nach, und `pages.yml` gibt dem Nachbau dieselbe Adresse.
- Knoten: `/` liefert `tma/index.html` aus dem App-Dist, nicht mehr `freedom.html`.
- Doku: `docs/MINI-APP-TMA.md` (Stand, Fragen T1–T5), Fallstrick in `packages/app/CLAUDE.md`,
  `OFFEN.md` 1.0.

**Tests:**
- app +4 (`tma.test.ts`):
  - Web-Build ohne Brücke.
  - Signatur nur über `tmaFetch()`, `fetch` unverändert.
  - Echter Mini-App-Build: Web-Build unberührt, zwei Skripte, CSP, `define`, falsche Adressen.
  - Website und Pages.
- node +1: `/` liefert die Mini-App.

**Offen:** T1–T5 (MENSCH). Danach TMA-2: Knoten-Teil – feste Fehlertexte, keine Telegram-IDs im
Log, Dateien 0600, Grenzen; dazu die Programm-ID des HTLC (`FVb19s…`, 731923b) in der Doku.

## Schritt TMA-2 – Mini-App im Knoten nach den Regeln, HTLC an `FVb19s…` dokumentiert

Spur A, zweiter Teil der Reparatur (Wunsch MENSCH 14.10.).

**Knoten (`tma-server.ts`, `stars-server.ts`, `tma-kommentar.ts`, `main.ts`):**
- **Umgebung streng über `tmaAusUmgebung()`:** Bot-Token mit Form, TON-Adresse, Port; `TELEGRAM_API_BASE`
  nur https oder dieser Rechner. Ungültig → kein Start.
  - TON nur mit `TON_DEPOT_ADDRESS`. Bis hier fiel der Knoten auf `NODE_SOL_ADDRESS` zurück, also auf eine
    Solana-Adresse als Ziel für TON.
  - Host `127.0.0.1` statt `0.0.0.0`.
- **Nach außen feste Texte** (`antworte()`), nie Meldungen der Bot-API oder von Fehlern. Zu große Anfragen
  (über 4 KB) → 413, kaputtes JSON → 400.
- **Ins Log keine Telegram-IDs, `charge_id`, Kommentare oder Transaktionskennungen**, nur Zahlen und
  Fehlernamen.
- **Dateien:** `~/.freedom/tma` 0700, die Dateien darin 0600 (Telegram-IDs und Zahlungskennungen).
- **Zahlungen:**
  - Jede Zahlung nur einmal je `charge_id`.
  - Vor dem Bezahlen nur Sterne, ein bekannter Auftrag und genau sein Preis (`preCheckoutPasst()`).
  - Die Nonce im TON-Kommentar aus `randomBytes`; Auftrag und Betrag im TON-Auftrag geprüft.
- **Icon:** ein echtes PNG mit 180 × 180 Pixeln (vorher SVG mit der Aufschrift „SW“).

**HTLC-Programm-ID (731923b, 0.G):**
- Der lokale Agent des MENSCHEN hat am 13.10. neu an `FVb19s…` deployt. Upgrade-Recht ist `FsUyQ…`,
  wie beim Zahlkanal.
- Geprüft am 14.10. per RPC und Simulation: ausführbar, Upgrade-Recht `FsUyQ…`. `refund` endet mit 3012
  (Konto fehlt), nicht mit 4100 – `declare_id!` passt.
- Nachgezogen:
  - `CLAUDE.md` (Fallstrick), `contracts/CLAUDE.md`;
  - `DEPLOY.md`, `docs/SOLANA-UPGRADE-AUTHORITY.md` (Checkliste);
  - `phase-0.md`, FORTSCHRITT 0.G, OFFEN (M-1, A-28), Sammlung M-1.
- Offen bleiben:
  - `3UmRR…` schließen; das gibt die Miete zurück.
  - A-28 als Upgrade an `FVb19s…`.

**Nebenbei (Smoke „raum“ rot in der CI dieses PRs, App unverändert):** Wurden Repo-Einstellungen in derselben
Sekunde gespeichert wie das Repo angelegt, hatten beide Ankündigungen (30617) dasselbe `created_at`. Die App nahm dann die
zuerst gelesene, Relays nach NIP-01 die mit der kleineren Id – die Änderung ging zufällig verloren. C-40 hatte nur länger
gewartet. Jetzt bekommt die neue Fassung eine spätere Sekunde (`zeitNachDer()`, Karte kennt `ankuendigungZeit`), und
`repoZeilen()` entscheidet gleiche Sekunden nach NIP-01 (kleinere Id). Code von Spur C, klein gehalten; Fallstrick in
`packages/app/CLAUDE.md`; app +1 Test (mit Gegenprobe).

**Tests:** node +4 (`tma-reparatur.test.ts`):
- Umgebung (sechs Fälle und Gegenproben).
- `preCheckoutPasst()` und Nonce.
- Doppelte Zustellung einmal gebucht, Log ohne ID und Kennung, Dateirechte. Gegenprobe ohne Schutz: rot.
- Feste Texte, 413, TON ohne Adresse 503, ungültige TON-Aufträge 400.

## Schritt A-21b1 – Zahlkanal und Überweisung ohne Internet als `@solana/kit`-Anweisungen

Spur A, `docs/KIT-PLAN.md` (freigegeben 11.10., Teilung und kit 8.4.0 am 14.10.).

**Neue Abhängigkeiten** (Protokoll, exakt gepinnt):
- `@solana/kit` 8.4.0 (MIT) und `@solana-program/system` 0.15.0 (Apache-2.0).
- Dazu kommen 43 Unterpakete `@solana/*` (MIT) sowie `commander`, `ws` und `undici-types` (MIT).
- Rund 75 MB installiert, solange die Pakete doppelt neben den 2.x-Paketen von web3.js liegen (bis A-21f).
- Das App-Bundle wächst im Übergang um 138 KB (8310 → 8448 KB).

**Code:**
- `kit-bruecke.ts`:
  - `alsWeb3()` macht aus einer kit-Anweisung eine web3.js-Anweisung (vier Rollen).
  - `konto()` baut ein Konto.
  - `ed25519Anweisung()` ist von Hand gebaut, Byte für Byte wie `Ed25519Program`.
  - Feste Adressen: System-Programm, Ed25519, Sysvar der Anweisungen.
- `channel.ts`:
  - `oeffneKanalAnweisung()`, `rechneKanalAbAnweisungen()`, `erstatteKanalAnweisung()` und
    `stockeKanalAufAnweisung()` liefern kit-`Instruction`.
  - Die bisherigen `…Ix` entstehen daraus über `alsWeb3()`; die Aufrufer in App und Knoten bleiben
    unverändert.
- `sol-offline.ts`: Nonce anlegen, schließen und weiterschalten sowie die Überweisung kommen aus
  `@solana-program/system`. Die Unterschrift steht nur als Rolle drin (`createNoopSigner()`).
- **Unverändert:** Die PDA (`kanalAdresse()`) rechnet weiter web3.js, weil kit sie asynchron rechnet;
  ebenso das Lesen in `pruefeOfflineUeberweisung()`. Beides ändert A-21f.
- **Fallstrick** in `packages/protocol/CLAUDE.md`.

**Tests:**
- protocol +3 (`kit-bruecke.test.ts`):
  - Rollen und Daten der Brücke.
  - Ed25519 gegen web3.js bei vier Nachrichtenlängen, dazu falsche Längen.
  - Rollen der Kanal-Anweisungen, darunter „erstatten“ ohne Unterschrift (Z1).
- Alle 17 Vektoren aus A-21a gleich (Protokoll 10, App 9).
- Vorab geprüft: kit selbst ergibt beim Zusammensetzen der Nachricht dieselben Bytes wie web3.js (Probe
  mit den vier Kanal-Fällen).

## Schritt A-21b2 – HTLC, Relayer-Einlösung, Überweisung und Zahlkanal der App als `@solana/kit`-Anweisungen

Spur A, `docs/KIT-PLAN.md` (A-21b in zwei Teilen, MENSCH 14.10.). Keine neue Abhängigkeit.

**Code:**
- `kit-bruecke.ts` (Protokoll, jetzt im Index):
  - `anweisung()` baut eine Anweisung aus Adressen als Text (jede geprüft).
  - `ueberweisungAnweisung()` kommt aus `@solana-program/system`; die Referenz nach Solana Pay hängt nur lesend an.
  - `AccountRole` und `type Instruction` reicht sie an die App weiter.
- **Warum nicht kit direkt in der App:** Eine eigene Abhängigkeit legte eine zweite Kopie von kit 8.4.0 neben
  die des Protokolls – im Wurzelordner liegt kit 5.x für andere Pakete. Das wären rund 2300 Zeilen mehr in
  `package-lock.json`, und das Bundle trüge beide Kopien. Ausprobiert und verworfen.
- **App:**
  - `buildLockInstruction()`, `buildRefundInstruction()` (`sol-htlc.ts`) und `buildClaimInstruction()`
    (`swap-client.ts`) liefern kit-`Instruction`. Die PDA kommt aus `swapAddress()` – vorher dreimal gerechnet.
  - `baueRelayEinloesung()` (Einlösung und Erstattung) und `buildSolTransfer()` (mit Referenz) nutzen
    `ueberweisungAnweisung()`.
  - `planeKanal()`, `sendeMitWallet()` und `erstatteKanaele()` (`zahlkanal.ts`) sowie das Aufstocken
    (`zahlkanal-ui.ts`) arbeiten mit kit-Anweisungen.
  - Die Transaktion baut bis A-21d web3.js (`alsWeb3()`).
- **Protokoll:**
  - `oeffneKanalIx()`, `erstatteKanalIx()` und `stockeKanalAufIx()` fielen weg; nur die App nutzte sie.
  - Der Knoten nutzt bis A-21e weiter `rechneKanalAbIxs()`.
  - `solReferenz()` (`relay-zugang.ts`) kodiert über `getAddressDecoder()` statt `PublicKey`.
- **Unverändert:**
  - Die HTLC-PDA rechnet weiter web3.js. kits `getProgramDerivedAddress()` braucht `crypto.subtle`
    (geprüft in `@solana/addresses`), und das fehlt der App über http im Heimnetz.
  - Das Lesen eines Relay-Auftrags (`pruefeRelayAuftrag()`: Transaktion, Signaturen) gehört zu A-21d.
- **Fallstricke:** `packages/app/CLAUDE.md` (kit nur über das Protokoll), Ergänzung in `packages/protocol/CLAUDE.md`.

**Tests:**
- protocol +3 (`kit-bruecke.test.ts`):
  - Überweisung gegen `SystemProgram.transfer` mit und ohne Referenz.
  - `anweisung()` mit falschen Adressen.
  - `solReferenz()` gegen `PublicKey`.
- app gleich (1124):
  - Die Tests der Anweisungen prüfen Rollen statt der zwei Schalter, zusätzlich die PDA-Adresse.
  - Sperren mit kaputter Adresse wird abgelehnt.
  - Die Verdrahtung der Referenz liegt jetzt in `ueberweisungAnweisung()`.
- Alle 17 Vektoren aus A-21a unverändert (Protokoll 10, App 9).
- Bundle 8448 → 8449 KB.
- Nachtrag nach dem ersten CI-Lauf: Die Validator-Tests (`contracts/solana-channel/tests/kanal.test.ts`)
  importierten die entfernten `…Ix` – die Suche davor deckte `contracts/` nicht ab. Sie bauen die
  web3.js-Fassung jetzt selbst über `alsWeb3()` (dieselben Bytes); Fallstrick in `packages/protocol/CLAUDE.md`.

## Schritt VKc2 – Der Knoten als ACP-Client: Schritte, Freigaben, Stopp, Commit je Schritt

Spur A, `docs/VIBECODEN-ENTWURF.md` (VK-W1n C, VK-W6 ja – MENSCH 14.10.).

**Neue Abhängigkeit** (Knoten, exakt gepinnt, freigegeben als VK-W6):
- `@agentclientprotocol/sdk` 1.8.0 (Apache-2.0, 6,1 MB entpackt).
- Die Peer-Abhängigkeit `zod` (`^3.25 || ^4`) erfüllt das vorhandene `zod` 3.25.76 – in `package-lock.json`
  kommt genau ein Paket dazu.
- 1.8.0 ist vom 09.10.2026, also fünf Tage alt (beim kit galten zwei Wochen als Vorsicht, keine Regel). Sie trägt
  eine SLSA-Provenienz aus dem Repo `agentclientprotocol/typescript-sdk` (npm-Attestierung) – freigegeben ist genau
  diese Fassung.

**Code:**
- `code-motor.ts` (neu):
  - `CodeLaeufe` startet, gibt frei und stoppt Läufe – je Projekt einer, auf dem Knoten höchstens drei
    (`code-belegt`).
  - Der Knoten spricht ACP über `client()` – ohne Datei- und Terminal-Fähigkeiten, der Motor arbeitet selbst, in
    der Sandbox.
  - Abbildung auf VKa: Werkzeug-Aufruf → `befehl`, sein Ende → `ausgabe` (gekürzt auf 10 000 Zeichen, Anfang
    und Ende), Freigabe-Anfrage → `befehl` mit `wartet`; `freigabe` wählt „einmal erlauben/ablehnen“, nie „immer“,
    ohne Antwort nach 300 s „nein“; `stopp` → `session/cancel`, nach 10 s wird der Motor beendet.
  - Grenzen: 60 min, 200 Schritte (`grenze`).
  - `prozessMotor()`: der Motor als Prozess, ACP über stdin/stdout, ohne Shell, Umgebung leer bis auf `PATH`,
    `HOME` (der Projektordner) und `LANG`, stderr verworfen.
- `projekte.ts`: `ort()` und `sichere()` – ein Commit `Schritt <nr>`, wenn sich etwas geändert hat.
- `dvm-provider.ts`: `auftrag` startet den Lauf im Hintergrund und antwortet sofort – sonst hinge im
  Abfrage-Betrieb jede Freigabe hinter ihrem Lauf. Schritte (7000, `partial`) und Ergebnis (6080) gehen in einer
  Kette, versiegelt an den Sitzungsschlüssel des Auftrags. `freigabe` und `stopp` antworten mit `ok`.
- **Nicht in `main.ts`:** Der Motor startet erst mit der Sandbox (VK4) – VKb (Spur B) baut sie, VKc3 setzt Hermes
  hinein und gibt `main.ts` die `MotorStart` (`CODE_MOTOR`, `prozessMotor()` mit der Sandbox davor, `.git` darin
  nur lesbar). Bis dahin lehnt der Knoten Läufe wie bisher mit `code-ohne-motor` ab.
- `docs/PROTOCOL.md` 34: Ablauf eines Laufs, `code-belegt`. Die Reihenfolge der Umschläge sagt nichts
  (NIP-59): Die App ordnet nach `nr`, ein Schritt wartet bis zu seiner `ausgabe`.
- Fallstrick in `packages/node/CLAUDE.md`; Ausnahme `codeSchrittText` aus `wiring-ausnahmen.txt` (jetzt verdrahtet).

**Gefunden beim Bauen:**
- Die Handler des SDK laufen nicht streng nacheinander: Eine Freigabe-Anfrage konnte vor dem Werkzeug-Aufruf
  ankommen, und der Befehl hieß dann nur „werkzeug“. Die Updates verarbeitet jetzt der Handler synchron, und die
  Freigabe wartet einen Takt.
- `stopp` aus der Meldung heraus fand die Freigabe noch nicht – sie wird jetzt erst eingetragen, dann gemeldet.
- Uhren mit `unref()` ließen die Ereignisschleife leerlaufen, und der Test brach ab.
- Der Test las die Schritte in der Reihenfolge des Relays, die wegen der zufälligen Zeitstempel zufällig ist (2 von
  15 Läufen rot). Er vergleicht jetzt nach `nr` und `art`; danach 40 von 40 grün.

**Tests:** node +6 (`code-motor.test.ts`):
- frei;
- fragen (ja, nein, Frist);
- Stopp, belegt, Grenze, Fehler ohne Text im Log;
- Kürzen;
- Motor als Prozess (Attrappe über stdio, keine Variable des Knotens);
- Weg durch den Knoten (versiegelt, nie offen, nichts im Log).

## Schritt A-21c – Lesen über `@solana/kit` auf dem RpcPool

Spur A, `docs/KIT-PLAN.md` (W1–W3 freigegeben 11.10., MENSCH). Keine neue Abhängigkeit.

**Gebaut:**
- `protocol/src/kit-rpc.ts`:
  - `poolTransport()`/`poolRpc()`: kit baut die Anfragen und liest die Antworten, gesendet wird nur über
    `RpcPool.call()` – mit Ausweichen, Sperrfrist und eigenen Endpunkten zuerst.
  - Ein Fehler der Kette bleibt beim ersten Endpunkt und kommt als `SolanaError` mit Code zurück (der Pool reicht
    dafür `data` weiter). Ist kein Endpunkt erreichbar, bleibt es `rpc-unerreichbar`.
  - BigInt aus kit geht als Zahl hinaus; größere als 2^53 hält kit vorher an.
  - Die Leser `leseKonto()`, `leseProgrammKonten()` und `leseGuthaben()` prüfen jede Adresse mit `address()`.
- `solana-adapter.ts`:
  - `get()` und `getRevealedPreimage()` lesen über kit; `reader(rpc)` statt `reader(conn)`.
  - Der Adapter mit Schlüssel (LP) liest über einen Pool aus seiner URL und schreibt bis A-21e weiter über web3.js.
  - Eine Sperre ist nur ein Konto des HTLC-Programms.
- `deposit-verify.ts`: `verifyDepositOnChain(deposit, rpc)`. Der Knoten (`dvm-provider.ts`) baut den Zugang
  synchron aus `solanaRpcUrl` (`solRpc` statt `solConnection`).
- App (`solRpc()` in `shell/state.ts`, der gemeinsame Pool mit `verteilen`) liest damit:
  - Kanäle des Knotens, Guthaben und das Kanal-Programm im Verdienen-Tab;
  - `programmBereit()` beim Öffnen eines Kanals;
  - die Prüfung der Gegenseite im Tausch;
  - offene Sperren im Rückhol-Wächter (`walletRefundRunner(conn, wallet, rpc)`).
  Der Verdienen-Tab baut keine `Connection` mehr.
- Noch über web3.js, weil sie die Verbindung mit Schreibpfaden teilen: `kanalAufKette()` und die Zahlschienen
  (A-21d), die Lesestellen des Knotens (A-21e).

**Behoben:** `getRevealedPreimage()` las vier Byte Länge vor dem Preimage. Seit 0.I nimmt `claim` aber ein festes
`[u8; 32]` ohne Präfix, also fand die Funktion das Preimage nie. Folge: Der LP hätte nach einer Einlösung die
Hold-Invoice nicht abgerechnet. Nach deren Ablauf hätte der Kunde SOL und sats gehabt (Devnet; der Schutz aus 8.3
brach nur nicht ab). Jetzt gilt:
- genau Sighash plus 32 Byte;
- nur Anweisungen des HTLC-Programms;
- der LP prüft wie bisher gegen den Hashlock.

**Größe:** Bundle 8 654 058 → 8 697 829 Byte (+44 KB, RPC-Schicht von kit) bis A-21f.

**Tests:**
- protocol +5: `kit-rpc.test.ts`;
- `solana-lesen.test.ts` geht den ganzen Weg und prüft das Preimage samt alter Form und fremdem Programm;
- app +2: `sperren-lesen.test.ts`;
- `verdienst`/`zahlkanal` gegen eine JSON-RPC-Attrappe hinter einem echten Pool;
- node unverändert.

Vektoren unverändert.

## Schritt VKf – Kopplung mit Code zum Eintippen

Spur A, `docs/VIBECODEN-ENTWURF.md` (K1, VK-W9 – MENSCH 14.10.). Keine neue Abhängigkeit, keine neue
Kryptografie: PBKDF2-SHA256 (WebCrypto, sonst `@noble/hashes`) und NIP-44 v2.

**Gebaut:**
- Protokoll `kurzcode.ts`:
  - Code: zwölf Zeichen Crockford-Base32 in drei Vierern (60 Bit), gelesen wie abgetippt (I/L → 1, O → 0).
  - `kurzcodeAbleitung()`: 600 000 Runden, 64 Byte – 32 als NIP-44-Schlüssel, 32 als Suchkennung.
  - Event 38076 (`baueKurzcodeEvent()`): `d` = Kennung, Ablauf zehn Minuten (NIP-40), Inhalt der Kopplungscode
    verschlüsselt. `leseKurzcodeEvent()` koppelt nur mit gültiger Signatur, Kennung und Frist, entschlüsselbar und
    mit dem Autor als Knoten. `baueKurzcodeLoeschung()` (NIP-09).
  - `dm.ts`: NIP-44 auch mit fertigem Schlüssel (`nip44MitSchluessel()`/`nip44OeffnenMitSchluessel()`) – dieselbe
    Verschlüsselung, `encryptDM()`/`decryptDM()` nutzen sie.
  - `baueStatusAuftrag(…, { kurzcode })`: die Kennung im versiegelten Kern.
- Knoten:
  - `npm run koppeln -- --code` schreibt nur `~/.freedom/kurzcode.json` (0600) und zeigt den Code.
  - `KurzcodeDienst` (alle 5 s in `main.ts`) veröffentlicht das Event und löscht es samt Datei, wenn der Code
    eingelöst, ersetzt oder abgelaufen ist.
  - Eingelöst wird nur aus der Statusabfrage nach `istBesitzer()`. Ins Log nur feste Texte.
- App: Der Dialog „Mein Knoten koppeln“ nimmt beide Codes.
  - Beim Code zum Eintippen sucht `kopplungAusKurzcode()` am Pool und an der Startliste und koppelt.
  - Danach löst die Statusabfrage den Code ein.
- Doku: `PROTOCOL.md` §35, `PROVIDER.md`, Fallstrick in der Wurzel-`CLAUDE.md`.

**Bewusst anders als im Entwurf:** „Gefunden über einen Hash des Codes“ – ein schneller Hash hätte die
600 000 Runden umgangen. Bei 2^60 Codes wären das mit viel Rechenleistung Tage gewesen, und das Geheimnis gilt
über die zehn Minuten hinaus. Die Kennung kommt deshalb aus derselben PBKDF2-Rechnung wie der Schlüssel.

**Tests:**
- protocol +4: `kurzcode.test.ts` – Form, Ableitung WebCrypto = noble, Event mit allen Negativfällen, Tag nur
  versiegelt;
- node +4: `kurzcode.test.ts` – Datei, Dienst (veröffentlichen, einlösen, ablaufen, ersetzen, Log), Einlösen nur
  für den Besitzer, Verdrahtung;
- app +2: `kurzcode-kopplung.test.ts`; der Verdrahtungstest B-8c nennt beide Codes.
## Schritt E9-4 – Kataloge geben Manifeste frei

Spur B, aus `docs/E9-ENTWURF.md` (V3 A, freigegeben 08.10.2026; übergeben an Spur B 09.10.). Bis
hierhin lud ein Knoten ein Modell nur nach dem eigenen Manifest – Kuratoren sollten über Kataloge
dazukommen, ohne voreingestellten und ohne Liste vertrauter Schlüssel daneben.

- **Protokoll** (`modell-katalog.ts`): ein Katalog-Eintrag kann das Manifest nennen –
  `["model", <kennung>, <notiz>, <manifest-id>]`, ein viertes Feld, das ältere Leser übergehen
  (`KatalogEintrag.manifest`, gebaut nur als Event-Id, sonst `ProtokollFehler("katalog-manifest")`,
  gelesen streng – ein kaputtes Feld fällt weg, der Eintrag bleibt). `katalogFreigaben()` nennt je
  Modell die Ids aus den Katalogen; `vergleicheKataloge()` sagt je Katalog, ob er eins nennt.
- **Wahl** (`vertrautesManifest()`): statt einer Menge vertrauter Schlüssel (sie war immer leer) eine
  Menge freigegebener Manifest-Ids. Es zählen das eigene (das neueste) und genau die freigegebenen –
  ein späteres, anderes Manifest desselben Kurators nicht. Das eigene geht vor; nennen freigegebene
  verschiedene Dateien, keine Wahl (`manifest.uneinig`).
- **Knoten** (`modell-kataloge.ts`, neu): `MODELL_KATALOGE` (Adressen, höchstens 20, ungültig → kein
  Start), `holeKataloge()` (nach den Kuratoren gefragt, nur gültig signiert, je Adresse der neueste,
  nur abonnierte), `KatalogFreigaben` (frisch für zehn Minuten; ohne Antwort keine Freigaben). Der
  Lader bekommt `freigaben()` statt `vertraut` und sucht die freigegebenen Ids mit
  (`manifeste(name, ids)`). `npm run modell` nennt die Manifest-Id geprüfter Modelle – für den Katalog.
- **App:** In der Katalog-Tabelle steht „✓ Prüfsummen“, wo der Kurator ein Manifest nennt, darunter
  ehrlich, was das heißt (geprüft wird am Knoten, nicht in der App). Beim eigenen Katalog geht die Id
  ans Ende der Zeile (`leseKatalogEingabe()`). Die App holt Kataloge weiter alle, ohne Filter (5.7).
- **Texte:** „kein Manifest“ nennt jetzt auch die Kataloge (Knoten und App). Doku: PROTOCOL (38080, §31),
  PROVIDER („Kataloge, denen der Knoten folgt“), E9-Entwurf, `docker-compose.yml` (`MODELL_KATALOGE`),
  Fallstrick in `packages/node/CLAUDE.md`, Regel „Modelle laden nur geprüft“ in der Wurzel.
- **Grenze, ehrlich:** Der Knoten fragt seine Relays nach den Katalogen der Kuratoren – sie sehen, wem
  er folgt (die App holt alle). Steht in PROVIDER.md.

**Tests:** Protokoll `modell-katalog.test.ts` (+2: viertes Feld, Freigaben und Vergleich),
`modell-ollama.test.ts` (Wahl über Freigaben statt Schlüssel, umgestellt); Knoten
`modell-kataloge.test.ts` (4, neu: Umgebung, Holen, Freigaben mit Frist, Verdrahtung),
`modell-laden.test.ts` (+1: Freigabe greift, anderes Manifest desselben Kurators nicht, eigenes vor,
stumme Relays), `modell-hf-laden.test.ts` (Freigabe auch für Hugging Face); App
`modell-kataloge.test.ts` (Manifest-Id am Zeilenende).

Knoten-Stand: für Kataloge neu nötig (`MODELL_KATALOGE`); ohne die Variable verhält sich der Knoten
wie bisher.

## Schritt E9-2 – Speicher gratis nur bis zur genannten Grenze

Spur B, aus `docs/E9-ENTWURF.md` (V2 A, freigegeben 08.10.2026; übergeben 09.10.). Den KI-Teil
(Tag `gratis`) hatte A-14 gebaut; hier bleibt nur der Speicher.

- **Protokoll** (`tiers.ts`): vierter Wert im `storage`-Tag – bis zu welcher Größe einer Datei
  der Knoten gratis hält (`gratisBytes`). Gebaut und gelesen nur über `leseSpeicherGratis()`
  (ganze Zahl ohne führende Nullen, höchstens `SPEICHER_GRATIS_MAX` = 1 TiB, sonst keine Angabe).
  `pruefeSpeicherStueck()` nennt die Größe der ganzen Datei (`groesse`).
- **Weg:** `network-capacity.ts` (netzweite Schwelle aus der Summe aller Kapazitäten, mit
  Sybil-Schwäche: dieselbe Pubkey zählte mehrfach) samt Export, Wiring-Ausnahmen und seinen sieben
  Tests – Entscheidung V2 A: wer Kosten trägt, entscheidet selbst.
- **Knoten:** `STORAGE_GRATIS_MB` über `speicherGratisAusUmgebung()` (ganze MB bis 1 TiB, ungültig →
  kein Start); beide Speicher-Rollen in `main.ts` und das Angebot bekommen dieselbe Zahl.
  `StorageRole.nimmAuf()` lehnt Stücke größerer Dateien ab („größer als gratis“) – nie die des
  Besitzers (`halten`). Ohne Variable wie bisher.
- **App:** `speicherKnoten(…, groesse)` fragt beim Abruf fehlender Stücke nur Knoten, deren Grenze
  die Datei fasst (je Schlüssel das neueste Angebot; ohne Angabe wie bisher); `blob-client.ts`
  übergibt `manifest.sizeBytes`.
- **Doku:** PROTOCOL (38027, `storage`), PROVIDER („Gratis-Grenze“), E9-Entwurf,
  `docker-compose.yml` (`STORAGE_GRATIS_MB`), Fallstrick in `packages/node/CLAUDE.md`.

**Tests:** Protokoll `speicher-gratis.test.ts` (3, neu), `wot-capacity.test.ts` (−8 mit der
Netzkapazität: sieben zur Schwelle und das Lesen über `extractStorageCaps()` – das Lesen prüft
jetzt `speicher-gratis.test.ts` über `parseCapabilities()`); Knoten `speicher-gratis.test.ts` (3, neu);
App `speicher-abruf.test.ts` (+1).

Knoten-Stand: für die Grenze neu nötig; ohne `STORAGE_GRATIS_MB` wie bisher.

## Schritt E9-1 – Cluster-Pairing aufgeräumt

Spur B, aus `docs/E9-ENTWURF.md` (V1 A, freigegeben 08.10.2026; übergeben 09.10.). Betrieben wird
ein Paar erst mit zwei Geräten (E9-5, MENSCH); hier nur, was vor jeder Anbindung stimmen muss.

- **B1 Kinds:** Das Angebot lag auf 38026 (Kurs-Ticker), das Paar-Event auf 38027 (Provider-Angebot) –
  jede App hätte ein Paar-Event als kaputtes Provider-Angebot gelesen. Jetzt Angebot 38028
  (`KIND_CLUSTER_OFFER`), gelesen streng über `parseClusterOffer()` (Zahlen nicht negativ, Region
  `[a-z0-9-]`, Zeitfenster nicht leer).
- **B2/B3 Gebühr und Bilanz:** `computeReciprocity()`, `hoursNeededToRent()` (5 % „Protokollfee“, die es
  seit A+ nicht gibt), `buildPairedEvent()` und der Vorrang aus der Bilanz im Matching sind weg –
  eine öffentliche Bilanz wäre eine Rangliste und verriete Geschäftsbeziehungen. Gewichtung im
  Matching: Verbindung 0,35, Laufzeit 0,25, Vertrauen 0,25, Preis 0,15.
- **Absprache versiegelt:** `baueClusterAbsprache()`/`oeffneClusterAbsprache()` – innen Kind 25050 (Modell,
  Zeitfenster, sats je Stunde, optional Bezug als Bestätigung), nur im Umschlag (NIP-59) an den Partner;
  offen steht nur der Empfänger.
- **Doku:** PROTOCOL (38028 in der Tabelle, §36), E9-Entwurf, Fallstrick in `packages/protocol/CLAUDE.md`;
  Wiring-Ausnahmen mit neuem Grund (Betrieb erst E9-5).

**Tests:** `cluster.test.ts` – vier zur Bilanz und Gebühr entfernt (der Baustein fiel weg), drei neu
(Kind, strenges Lesen, versiegelte Absprache). Protokoll 1309 → 1308.

Knoten-Stand: unverändert (nur Protokoll).

## Schritt C-Review – Oberflächen-Review: Karten C-41 bis C-59

Auf Wunsch des MENSCHEN hat Spur C die ganze Oberfläche (alle Seiten und Unterreiter, Desktop
und Handy) und die Website aufgenommen, mit den besten Apps je Bereich verglichen und bewertet
(App 5,1 von 10, Website 4,9) – Ergebnis und Soll-Bilder in `docs/ausbau/OBERFLAECHE-REVIEW.md`.
Der MENSCH: „Setze alle diese Punkte um.“ Daraus die Karten C-41 bis C-59 (Sammlung, Abschnitt 3):
sofort (C-41 privater Schlüssel per Klick im Profil – Sicherheit, zuerst; C-42 Schrift und Knöpfe;
C-43 Führungsleiste; C-44 Avatare; C-45 leere Zustände; C-46 Agent-Kleinigkeiten; C-47 Namen;
C-48 Website-Navigation), mittel (C-49 bis C-55) und größer (C-56 bis C-59). Neu in `OFFEN.md`:
Entscheidung OR1 (Inter einbetten oder Systemschrift – C-42 baut ohne Einbetten) und der kurze
Nutzertest als Aufgabe des MENSCHEN. Nur Doku, kein Code.

## Schritt C-41 – Privater Schlüssel nur nach Warnung

Aus dem Oberflächen-Review (15.10.2026, Sicherheit): Im Profil kopierte ein Klick auf die kurze Kennung den *privaten* Schlüssel – auf einem Element, das wie die öffentliche Kennung aussieht. Ohne Zwischenablage stand er sogar als Meldung unten im Bild (`toast(hex)`).

- `shell/identitaet-ui.ts` (neu):
  - `kopiereKennung()` kopiert die öffentliche Kennung als npub. Ohne Zwischenablage zeigt sie die Kennung zum Markieren im Dialog. Der Klick auf `#nb-ident` (auch per Tastatur) und „Teilen“ im Profil gehen beide über diesen Weg.
  - `zeigePrivatenSchluessel()` fragt zuerst mit `bestaetige(… gefahr: true)` und der Warnung „Wer diesen Schlüssel hat, ist für alle anderen du …“. Erst danach leiht sie den Schlüssel über `mitRohemSchluessel()` und zeigt ihn als nsec nur im Dialog (Lesefeld mit „Kopieren“).
  - Der Schlüssel erscheint nie als Meldung, wird nie gespeichert und landet nie von selbst in der Zwischenablage. Mit Bunker gibt es ihn nicht.
- Die Karte „Identität“ bekommt den Knopf „Privaten Schlüssel zeigen“. Der Satz darüber sagt jetzt, was der Klick tut. Die Reihe bricht am Handy um.
- „Importieren“ ersetzt eine vorhandene Identität nur nach Rückfrage („Identität ersetzen?“, rot). Ohne Sicherung wäre sie danach weg.
- Tests:
  - `identitaet-ui.test.ts`: Klick, Warnung vor dem Schlüssel, nichts gespeichert, Rückfrage beim Import, Texte.
  - Angepasst: `browser-dialoge`, `profil-klein` und `zugang`. Sie prüfen jetzt `kopiereKennung()` statt `exportIdentity`.
  - Smoke „profil_klein“: Der Klick ergibt einen npub. Vor der Warnung steht kein nsec im Dialog, danach ein gültiger. Er steht weder im Speicher noch in einer Meldung noch in der Zwischenablage.
  - Smoke „qr“: Der Import auf dem neuen Gerät bestätigt die Rückfrage.

**Prüfungen:** protocol 1309 grün, node 466 (ohne Netz), app 1133 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-47 – Einheitliche Seitennamen: Chats und Wallet

Aus dem Oberflächen-Review (15.10.2026):
- Dieselbe Seite hieß am Desktop „Kommunikation“ und am Handy „Chat“. Dafür gab es eine zweite, kurze Beschriftung.
- Das Wallet hieß „Währung“.
- Wegen des langen Worts stand die Navigation am Desktop in 8–9 px.

Jetzt heißen die Seiten überall gleich:
- „Chats“ und „Wallet“ – neue Schlüssel `nav.chats` und `nav.wallet` (E2). Die alten (`navComm`, `navWallet`, `nav.chatKurz`) nutzte nichts mehr, sie sind entfernt.
- Der Seitentitel des Wallets heißt ebenso.
- Die Navigation steht in 11 px. Die Kurzform am Handy samt ihrer CSS-Regel entfällt.
- Vier Texte, die den Weg nennen („unter Währung › Zahlen“, „Währung › Hinterlegen“), sagen jetzt „Wallet ›“. Die FAQ der Website sagt ebenso „Wallet → Zahlen“ und „Wallet → Lightning“.

Tests:
- `umzug-zahlen.test.ts`: prüft die neuen Wege „Wallet › Zahlen“ und „Wallet → Zahlen“.
- `i18n.test.ts`: prüft die Sprache an „Mehr/More“ statt am alten Namen; die Liste der Schlüssel in der Navigation ist neu.
- Smoke „sprache“: liest die Sprache an „Verdienen/Earn“ ab – „Chats“ heißt in beiden Sprachen gleich.
- Smoke „rahmen“: Die untere Leiste am Handy zeigt „Chats“ und „Wallet“ ganz.

**Prüfungen:** protocol 1309 grün, node 466 (ohne Netz), app 1133 (+0), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt VKb – Sandbox mit bubblewrap (= 11.5s)

Spur B, aus `docs/VIBECODEN-ENTWURF.md` (VK4, VKb) und `docs/REPO-AGENTEN-ENTWURF.md` („Vorschlag zu W3:
Regeln fürs Ausführen“, Vorbild Codex unter Linux). Code führt der Knoten nur in bubblewrap aus – je
Befehl (11.5c) oder als ganzer Motor eines Code-Laufs (VKc3).

- **`node/src/sandbox.ts`:** `sandboxArgumente()` – eigene Namensräume (`--unshare-all`,
  `--unshare-user`), endet mit dem Knoten, eigene Sitzung, keine Fähigkeiten, leere Umgebung bis auf
  `PATH`, `HOME`, `LANG`; nur lesbar `/usr` (Verweise wie `/bin` → `usr/bin` als Verweis), aus `/etc`
  nur ein eigenes `passwd`, `group`, `hosts`, dazu nur lesbar `/etc/alternatives` und `/etc/ld.so.cache` (sonst startet
  `python3` nicht – unter Debian ein Verweis dorthin); schreibbar nur `/arbeit` (darin `.git` nur lesbar),
  `/tmp` als tmpfs mit 512 MB, Home ein tmpfs oder ein eigener Ordner; danach die Wurzel selbst nur
  lesbar (`--remount-ro /`). Kein Netz; GPU nur auf Wunsch.
- **Ausführen:** `fuehreAus()` mit `ulimit` (Rechenzeit, Dateigröße, offene Dateien – je Grenze ein
  Aufruf, dash nimmt nur eine), 60 s je Befehl, danach endet die ganze Prozessgruppe; Ausgabe gekürzt
  wie im Code-Lauf (`kuerzeAusgabe()`). `sandboxMotor()` ist die `MotorStart` für VKc3 (stderr
  verworfen). Ohne bubblewrap oder ohne Nutzer-Namensräume läuft nichts – `pruefeSandbox()` sagt
  `sandbox.fehlt` bzw. `sandbox.namensraum`, feste Sätze in `SANDBOX_TEXT`.
- **Verdrahtet:** `main.ts` prüft die Sandbox beim Start, sobald Vibecoden an ist (`[code] Sandbox …`),
  `npm run pruefen` mit `VIBECODEN=1` ebenso. Den Motor startet erst VKc3 darin – die Sandbox hat
  kein Netz, das Modell erreicht er nur über eine Brücke, die VKc3 baut.
- **Bild und CI:** bubblewrap im Docker-Bild (unter Docker sperrt das Standard-Seccomp meist
  Nutzer-Namensräume – Frage in `OFFEN.md` 1.1); die CI installiert bubblewrap und gibt im
  Wegwerf-Runner Nutzer-Namensräume frei, damit die Tests laufen statt sich zu überspringen.
- **Noch nicht:** Arbeitsspeicher je Befehl und seccomp (Netz-Aufrufe, `io_uring`) – 11.5s2.
- **Smoke-Test „raum“:** Nach „Patch senden“ wartete er 800 ms fest und las dann die Liste – unter Last war sie noch
  leer (lokal rot, während nebenher Knoten-Tests liefen). Jetzt wartet er auf die Liste (Frist 10 s), wie die anderen
  Stellen dort; Fallstrick in `scripts/CLAUDE.md`. Klein in einer Datei aller Spuren.
- **Doku:** PROVIDER („Sandbox“), Entwürfe, OFFEN (VKb raus, 11.5s2 neu, VKc3 und 11.5c frei bzw.
  nach 11.5a), Fallstrick in `packages/node/CLAUDE.md`.

**Tests:** Knoten `sandbox.test.ts` (7, neu): Argumente, feste Sätze, ohne bubblewrap kein Ausführen;
mit echtem bubblewrap leere Umgebung, Nutzer 1000, nur `lo`, Grenzen, `NoNewPrivs`, schreibbar nur der
Arbeitsordner, `.git`, `/usr`, `/etc` und die Wurzel nur lesbar, Dateien des Knotens unsichtbar,
Exit-Code, Kürzung, Zeitgrenze samt Kind im Hintergrund, Motor über stdin/stdout mit eigenem Home.

Knoten-Stand: für die Selbstprüfung neu; ohne `VIBECODEN=1` ändert sich nichts.

## Schritt C-42a – Schrift ohne Serifen, Satzschreibung

Aus dem Oberflächen-Review (15.10.2026): Fast alles stand in Monospace, und 64 % der Schriftgrößen in `app.css` waren höchstens 12 px. Hinweise standen in 10 px, Etiketten und Kartentitel in Großbuchstaben. Zur Schrift gehört auch C-42b (Knöpfe).

- **Grundschrift** (`html, body`): `--font-body` (Inter, wenn installiert, sonst die Systemschrift) in 15 px. Aus der Regel des „Typografie-Hybrids“ fallen Überschriften, `.mono-sm`, `.who` und `.tool-chip` heraus. Monospace bleibt für `.mono`, `code`, `pre`, Beträge und Schlüssel. Fließtext, der noch eigene Monospace-Angaben hatte, steht jetzt in der Grundschrift: Hinweis unter den Beispielen, Wechsel des Modells, Schritte und Kontingent.
- **Hinweise** (`.mono-sm`, rund 390 Stellen): 13 px statt 10 px, ohne Umbruch mitten im Wort.
- **Normale Schreibung** statt Großbuchstaben: Etiketten (13 px), Kartentitel (15 px, Schriftfarbe), Kopf der Direktnachrichten, Absender im Agenten, Gruppen des Verlaufs und der Modellwahl, Titel der rechten Spalte, Hinweis auf der Startseite. Großbuchstaben bleiben nur für kleine Marken (Stufe, Sprache des Codeblocks, Tabellenköpfe der Rangliste, „Neu“).
- **Untergrenze:** 8–9 px werden 11 px, 10–11 px werden 12 px. Das gilt in `app.css`, für ein Feld in `index.html` und für fünf Stellen im Code. Die Navigation steht seit C-47 in 11 px.
- Inter wird nicht eingebettet: Das wäre eine neue Abhängigkeit, Entscheidung OR1 in `OFFEN.md`.

Tests:
- Angepasst: `geld-settings-klein` (Etiketten nie mehr in Großbuchstaben) und `profil-klein` (Kartentitel 15 px in normaler Schreibung).
- Smoke „zugang“ (Kontrast), „mobil“ (Laufleisten, Flächen ab 40 px, Text in Knöpfen), „rahmen“ und „composer“ sind grün. Alle 74 Seiten wurden neu aufgenommen und durchgesehen.

**Prüfungen:** protocol 1309 grün, node 466 (ohne Netz), app 1133 (+0), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt 11.5a1 – Bundle-Leser im Protokoll, Arbeitskopie

Spur B, aus `docs/REPO-AGENTEN-ENTWURF.md` (V3, V4, W1 B, W3a A). Der Knoten braucht für Repo-Aufträge (11.5c)
denselben Leser wie die App und daraus einen Arbeitsordner, in dem der Agent in der Sandbox (VKb) arbeitet.

- **Leser ins Protokoll:** `git-bundle.ts` von `packages/app/src/` nach `packages/protocol/src/` (unverändert bis auf
  den Kopfkommentar), aus `index.ts` exportiert; die App (`code-reiter.ts`, `repos.ts`) nimmt ihn aus
  `@freedomstack/protocol` – ohne Änderung im Verhalten. Die Tests des Lesers und die Probe-Bundles ziehen mit
  (`protocol/test/git-bundle.test.ts`, `protocol/test/fixtures/probe-*.bundle`); die vier Tests der Verdrahtung im
  Reiter „Code“ bleiben in der App (`app/test/code-reiter.test.ts`). Der Smoke-Test liest die Bundles vom neuen Ort.
- **Arbeitskopie (`protocol/src/arbeitskopie.ts`):** `arbeitskopie(bundle, commit?)` – der Baum am Kopf als Dateien
  (`datei`, `ausfuehrbar`, `verweis` mit dem Ziel als Inhalt) samt Kennung aus dem Baum, Submodule nur als Pfad
  und Commit (für den Patch, 11.5a2). `istRepoPfad()` nach V4; jeder
  Name einmal je Ordner; `ARBEITSKOPIE_GRENZEN` (20 000 Dateien, 256 MB, Tiefe 32, Verweis 1 KB) je Stelle im Baum.
- **Arbeitsordner (`node/src/arbeitskopie.ts`):** `neuerArbeitsordner()` in `/dev/shm` (sonst Temp), 0700, `weg()`;
  `schreibeArbeitskopie()` nur in einen leeren, echten Ordner, `O_EXCL | O_NOFOLLOW`, Verweise zuletzt.
- **Verdrahtet:** der Leser im Reiter „Code“ der App wie bisher (`code-reiter.ts`); `arbeitskopie()` ruft erst 11.5c
  (Spur A) – Ausnahme in `scripts/wiring-ausnahmen.txt` mit diesem Grund.
- **Doku:** Entwurf (11.5a1 fertig), OFFEN (11.5a2 offen, 11.5c nur noch danach), Fallstricke in
  `packages/protocol/CLAUDE.md` und `packages/node/CLAUDE.md`, Verweis in `packages/app/CLAUDE.md`.

**Tests:** Protokoll `arbeitskopie.test.ts` (5, neu): Pfad-Regeln, echtes Bundle von git (Modi, Verweis, Submodul
gleich `git ls-tree`), Probe-Bundle, feindliche Bäume (`.git` in jeder Schreibweise, doppelte Namen, fehlende
Objekte, kaputte Verweise), Grenzen (Fächer aus demselben Ordner, Bytes, Tiefe); `git-bundle.test.ts` (9, aus der App
verschoben). Knoten `arbeitskopie.test.ts` (4, neu, einer mit echtem bubblewrap). App: neun Tests des Lesers ins
Protokoll verschoben (vier bleiben), sonst unverändert – zusammen steigt die Zahl um 9.

Knoten-Stand: unverändert (Bausteine, noch kein Aufruf im Knoten).

## Schritt 11.5a2a – Patch-Schreiber im Protokoll

Spur B, aus `docs/REPO-AGENTEN-ENTWURF.md` (V5, W1 B). 11.5a2 ist geteilt: a2a der Patch-Schreiber im Protokoll,
a2b das Lesen des Arbeitsordners im Knoten (`lstat`, `.gitignore`) – zusammen wären es deutlich über 400 Zeilen.

- **`protocol/src/patch-schreiber.ts`:** `schreibePatch(alt, neu, angaben)` – die Dateien nach dem Auftrag gegen die
  Arbeitskopie am Kopf (11.5a1). Myers-Diff je Datei (`zeilenDiff()`, höchstens 4000 Schritte), Abschnitte mit drei
  Zeilen Kontext wie git, `\ No newline at end of file`, volle Kennungen in `index`, Pfade gequotet wie git
  (`core.quotePath`); Datei ↔ Verweis als Löschen und Anlegen, Modus allein als `old mode`/`new mode`.
- **Commit wie git:** Bäume aus allen Dateien (Submodule aus der Arbeitskopie unverändert), Eltern = Kopf, Autor =
  Committer, Nachricht so, wie `git am` sie aus der Mail liest; Kopf mit RFC 2047 und `8bit`, wo Nicht-ASCII steht.
- **Kein Patch, nur ein Fall:** `patch.keine-aenderung`, `patch.binaer` (Nullbyte oder kein UTF-8), `patch.gross`
  (über `PATCH_MAX_BYTES` oder zu viele Schritte), `patch.angaben` (Name, Mail, Betreff, Zeit, Pfade). Was
  herauskommt, nimmt `lesePatchText()` an.
- **Verdrahtet:** erst in 11.5c (Spur A) nach 11.5a2b – Ausnahmen in `scripts/wiring-ausnahmen.txt` mit Grund.
- **Doku:** Entwurf (11.5a2 geteilt), OFFEN (11.5a2b), FORTSCHRITT, Fallstrick in `packages/protocol/CLAUDE.md`.

**Tests:** Protokoll `patch-schreiber.test.ts` (5, neu): Diff minimal und vollständig; ein Repo mit Ordnern, Umlauten
im Pfad, BOM, Datei ohne Zeilenende, ausführbar, Verweis, Submodul, leerer Datei – `git apply --check` nimmt den Patch,
`git am` ergibt dieselbe Kennung und dieselbe Nachricht; böse Betreffe und Beschreibungen; Artwechsel und nur Modus;
alle Fälle ohne Patch. Dazu vorab 3000 Zufallsfälle gegen eine LCS-Rechnung (beide Seiten zurückgewonnen, minimal).

Knoten-Stand: unverändert (Baustein im Protokoll).

## Schritt 11.5a2b – Arbeitsordner lesen, .gitignore wie git

Spur B, zweiter Teil von 11.5a2 (`docs/REPO-AGENTEN-ENTWURF.md` V5). Nach dem Auftrag liest der Knoten, was der Agent
in der Sandbox hinterlassen hat – ohne git (W1 B: kein fremdes Programm auf fremden Daten, `.git/config` stammt dann
vom Agenten) und ohne Verweisen zu folgen.

- **`leseArbeitsordner(ordner, alt)`** (`node/src/arbeitskopie.ts`): nur `lstat`, Dateien mit `O_NOFOLLOW`,
  ausführbar aus dem Modus, Verweise als ihr Text (auch einer auf `/etc/passwd` oder `~/.freedom` bleibt Text),
  Sonderdateien fallen weg; `.git` in jeder Schreibweise und Submodule betritt er nie. Grenzen wie die Arbeitskopie,
  sonst `patch.gross`; Unlesbares oder ein Ordner, der ein Verweis ist: `patch.ordner` (neuer Fall) – nie ein halber Stand.
- **`.gitignore` (`protocol/src/gitignore.ts`):** `leseIgnore()` und `istIgnoriert()` nach gitignore(5) – Kommentar,
  `!`, nur Ordner, verankert, `*`, `?`, `[…]`, `**`, Escapes; tiefere Dateien gelten unter ihrem Ordner und gehen vor;
  begrenzt (1000 Regeln, 1000 Zeichen). Ein ignorierter Ordner wird nicht betreten (`node_modules`, `dist`), außer git
  kennt Dateien darin – bekannte Dateien bleiben wie bei git immer drin.
- **Verdrahtet:** erst in 11.5c (Spur A): Arbeitsordner → `leseArbeitsordner()` → `schreibePatch()`. Damit sind die
  Bausteine von Spur B für 11.5c fertig (Sandbox, Arbeitskopie, Patch).
- **Doku:** Entwurf, OFFEN (11.5c frei), FORTSCHRITT, Fallstrick in `packages/node/CLAUDE.md`.

**Tests:** Knoten `arbeitskopie.test.ts` (+4): `.gitignore` gegen `git add -A`/`git ls-files` auf einem Ordner mit
allen Regelarten; bekannte Dateien bleiben, `.git`, Submodule, FIFO nie, Verweise als Text; Grenzen und Unlesbares;
Ende zu Ende – Bundle, Arbeitsordner, Änderungen wie von einem Agenten (bauen, `git init` mit fsmonitor, Verweis nach
draußen), Patch, `git am` ergibt denselben Commit, nichts Ignoriertes und kein Inhalt hinter dem Verweis im Patch.
Protokoll `gitignore.test.ts` (2, neu).

Knoten-Stand: unverändert (Bausteine, noch kein Aufruf im Knoten).

## Schritt B-35a – Negentropy im Protokoll (NIP-77)

Spur B, Sammlung B-35 (Anhang E, NG1 B, 09.10.: eigene Umsetzung mit Vektoren aus der Referenz). Mit wenig Daten
herausfinden, welche Events der anderen Seite fehlen – Grundlage für den Abgleich zwischen eigenem Relay und anderen,
nach Funkstille und über Gateways. B-35 ist geteilt: a Kern im Protokoll, b Relay-Rolle (`NEG-OPEN`), c Abgleich.

- **`protocol/src/negentropy.ts`:** `NegSpeicher` (Einträge Zeit + Id, sortiert, keine doppelten, Fingerabdruck
  als SHA-256 über die Summe der Ids mod 2^256 und die Anzahl), `Negentropy` (`beginne()`, `abgleich()`): Bereiche mit
  kürzesten Grenzen, Überspringen, Fingerabdruck, Id-Liste, 16 Teile ab 32 Einträgen, Rahmengröße ab 4096 Byte; die
  beginnende Seite sammelt `habe` und `brauche`, die andere antwortet. Nachrichten von außen begrenzt (`NEG_GRENZEN`),
  Fehler nur als `NegFehler` mit Kennung.
- **Vektoren aus der Referenz:** `scripts/negentropy-referenz.mjs` lädt die JS-Referenz von Doug Hoyte (MIT) an einem
  festen Commit, prüft die Prüfsumme, führt sie in einer VM nur mit `crypto` aus und spielt sieben Abgleiche durch (leer,
  gleich, klein, einseitig, groß über mehrere Runden, gleiche Zeiten, Rahmen 4096 mit 20 Nachrichten); die Datei hält nur
  Startwerte, Längen und SHA-256 (10 KB).
- **Verdrahtet:** mit B-35b (Relay-Rolle) – Ausnahmen in `scripts/wiring-ausnahmen.txt` mit Grund.
- **Doku:** `PROTOCOL.md` §37, Sammlung, OFFEN, FORTSCHRITT, Fallstricke in `packages/protocol/CLAUDE.md` und
  `scripts/CLAUDE.md` (Namen in `check-wiring.py`).

**Tests:** Protokoll `negentropy.test.ts` (3, neu): alle Nachrichten und Ergebnisse wie die Referenz; 40 Zufallsabgleiche
gegen die Mengenlehre, mit und ohne Rahmen; feindliche Nachrichten (Hex, Längen, Varints, Modus, Fassung, Id-Listen).

Knoten-Stand: unverändert (Baustein im Protokoll).

## Schritt B-35b – Abgleich (NIP-77) in der Relay-Rolle

Spur B, Sammlung B-35 (NG1 B). Der Relay des Knotens beantwortet `NEG-OPEN`, `NEG-MSG` und `NEG-CLOSE` mit dem Kern aus
B-35a – andere Relays und Clients können mit ihm abgleichen, statt alles neu zu laden.

- **`relay-role.ts`:** je Verbindung offene Abgleiche (`abgleiche`); `NEG-OPEN` legt den Stand fest – nur Events, die
  `darfAusliefern()` dieser Verbindung auch per `REQ` zeigen würde, abgelaufene (NIP-40) nicht; ein Filter auf Umschläge
  ohne Anmeldung ergibt `blocked: … auth-required`. Grenzen: `NEG_RELAY` (50 000 Events, Rahmen 60 000 Byte), offene
  Abgleiche zählen wie Abos (`abosJeVerbindung`), jede Nachricht wie eine Abfrage. Fehler nur als `NEG-ERR` mit festen
  Texten (`blocked:`, `closed:`, `error:` samt Kennung aus `NegFehler`).
- **NIP-11:** `supported_nips` nennt 77 (`baueRelayInfo()`, Test angepasst).
- **Verdrahtet:** `relay-role.ts` `handleMessage()` → `abgleich()` – die Ausnahmen für `negentropy.ts` sind raus.
- **Doku:** `PROTOCOL.md` §37, Sammlung, OFFEN (offen nur c), FORTSCHRITT, Fallstrick in `packages/node/CLAUDE.md`.

**Tests:** Knoten `relay-negentropy.test.ts` (3, neu, echter WebSocket): Abgleich in beide Richtungen über mehrere Runden
mit Rahmen, Filter wirkt; Umschläge nur für den angemeldeten Empfänger (fremd `blocked`, ohne Kind still weg, als Bob nur
seine); Fehler und Grenzen (unbekannte Kennung, kaputte Nachricht, kein Filter, zu lange Kennung, geschlossen, zu viele
offene). Protokoll `relay-zugang.test.ts`: NIP-11 mit 77.

Knoten-Stand: neu nötig für den Abgleich; ältere Knoten antworten auf `NEG-OPEN` mit `NOTICE` (unbekannter Typ).

## Schritt 11.5s2 – seccomp in der Sandbox

Spur B, aus `docs/REPO-AGENTEN-ENTWURF.md` („Vorschlag zu W3“: seccomp wie bei Codex als zweite Stufe, ohne neue
Abhängigkeit). Die Sandbox (VKb) hat schon kein Netz und keine Fähigkeiten; der Filter nimmt dazu, was den Kern
angreifbar macht und kein Werkzeug braucht.

- **`node/src/seccomp.ts`:** `seccompFilter(arch)` baut einen cBPF-Filter mit einem kleinen eigenen Assembler (Marken,
  Sprungweiten geprüft): Architektur prüfen (sonst töten), x32 auf x86_64 sperren, `EPERM` für `io_uring_*`, `keyctl`,
  `add_key`, `request_key`, `bpf`, `perf_event_open`, `userfaultfd`, `kexec_*`, Module, `open_by_handle_at`, `unshare`,
  `setns`, Einhängen (`mount`, `umount2`, `pivot_root`, neue Mount-API), `swapon`/`swapoff`, `reboot`; `clone` mit
  `CLONE_NEW*` gesperrt, `clone3` mit `ENOSYS`. Nur x86_64 und arm64, sonst kein Filter.
- **`sandbox.ts`:** der Filter als Datei im eigenen `/etc`-Ordner, offen als `stdio[3]`, `--seccomp 3` – für Befehle und
  den Motor; `pruefeSandbox()` meldet `seccomp` und unterscheidet `sandbox.seccomp` (geht nur ohne Filter).
- **Noch nicht:** Speicher je Befehl → 11.5s3 (`ulimit -v` bricht Node und WASM).
- **Doku:** Entwurf, OFFEN (11.5s3), FORTSCHRITT, PROVIDER, Fallstrick in `packages/node/CLAUDE.md`.

**Tests:** Knoten `seccomp.test.ts` (3, neu): Aufbau je Architektur (Architektur zuerst, töten am Ende, Sprünge im
Programm, x32 nur auf x86_64); mit echtem bubblewrap und Python: `io_uring_setup`, `keyctl`, `bpf`, `perf_event_open`,
`userfaultfd` ergeben `EPERM`, Threads und Kindprozesse laufen; `unshare -U` scheitert in der Sandbox.
`sandbox.test.ts` angepasst (Selbstprüfung mit `seccomp`).

Knoten-Stand: neu für den Filter; ohne `VIBECODEN=1` ändert sich nichts.

## Schritt 11.5s3 – Speicher je Befehl in der Sandbox

Spur B, aus `docs/REPO-AGENTEN-ENTWURF.md` (11.5s3). Bisher begrenzte die Sandbox Zeit, Dateigröße und offene
Dateien, aber nicht den Arbeitsspeicher – ein Befehl konnte den Rechner des Providers in den Speichermangel treiben.

- **`ulimit -d` statt cgroups:** `RLIMIT_DATA` zählt seit Linux 4.7 privaten, beschreibbaren Speicher (Heap und
  `mmap`), nicht reservierten Adressraum – Node und WASM reservieren viel und belegen wenig, `ulimit -v` bräche sie.
  cgroups v2 brauchen ein Nutzer-systemd oder Rechte, die unter Docker meist fehlen; die Grenze je Prozess geht überall.
- **`sandbox.ts`:** `SANDBOX_GRENZEN.speicherKiB` (4 GiB) in `mitGrenzen()`; der Motor (`sandboxMotor()`) läuft jetzt
  auch über `mitGrenzen(…, false)` – Dateigröße, offene Dateien, Speicher, aber keine Rechenzeit (er läuft so lange wie
  der Auftrag). Seine Befehle erben die Grenzen.
- **Noch nicht:** alle Prozesse eines Befehls zusammen → 11.5s4 (cgroups v2, wo es sie gibt; später, nachrangig).
- **Doku:** Entwurf, OFFEN (11.5s4 statt 11.5s3), FORTSCHRITT, PROVIDER, Fallstrick in `packages/node/CLAUDE.md`.

**Tests:** Knoten `sandbox.test.ts` (1 neu, 1 erweitert): Grenzen samt `ulimit -d`; mit echtem bubblewrap und Python
scheitert ein Puffer über der Grenze mit `MemoryError`, 64 MB gehen; der Motor sieht Speichergrenze, aber keine
Rechenzeitgrenze.

## Schritt VKl1 – Projekt als verschlüsseltes Bundle ins Blob-Netz

Spur A, `docs/VIBECODEN-ENTWURF.md` (VKl „Als Repo in einen Raum stellen“, Teil 1: Knoten). Keine neue
Abhängigkeit, kein neues Event-Format: Code-Auftrag 5080 (VKa) mit einer Aktion mehr, Blobs wie 8.9a,
Datei-Verschlüsselung wie Anhänge.

**Gebaut:**
- Protokoll `knoten-code.ts`: Aktion `bundle` (Parameter `projekt`), Antwort mit `blob`, `manifest`, `schluessel`
  (`DateiSchluessel`, genau vier Felder) und `bytes` (1 bis `CODE_GRENZEN.bundle` = 32 MB); jede andere Form
  liest `leseCodeAntwort()` nicht.
- Knoten:
  - `ProjektAblage.bundle()`: `git bundle create --all` über `git()` in eine Datei mit Punkt neben den Projekten,
    danach immer gelöscht; ohne Commit `code-leer`, über 32 MB `code-zu-gross`.
  - `bundleInsBlobNetz()` im Provider: verschlüsselt (`verschluesseleDatei()`), `buildBlob(…, { verschluesselt: true })`,
    signiert mit einem **Wegwerfschlüssel** (nie dem des Knotens – der Blob verriete sonst, wessen Knoten das Repo
    baute), die Stücke hält der Knoten selbst (`nimmAuf(…, { halten: true })`), veröffentlicht über den Pool. Den
    Schlüssel bekommt nur der Besitzer in der versiegelten Antwort.
- Doku: `PROTOCOL.md` §34 (Aktion, Fälle, Absatz Bundle), Fallstrick in `packages/node/CLAUDE.md`.

**Tests:**
- protocol ±0: `knoten-code.test.ts` – Bundle hin und zurück, sechs kaputte Antworten (in bestehenden Fällen);
- node +2: `projekt-bundle.test.ts` – `code-leer`, Bundle mit `main`, keine Datei bleibt liegen; der ganze Weg mit
  Wegwerfschlüssel ≠ Knotenschlüssel, Stücke gehalten, Schlüssel nicht öffentlich, zusammengesetzt und entschlüsselt
  das Bundle, Projektname nie im Log.

**Offen:** VKl2 (App: Projekt und Raum wählen, Ankündigung und Bundle-Verweis in den Raum).

## Schritt B-32-Entwurf – Reticulum als zweiter Funkweg

Spur B, Sammlung B-32 (RN1: im Entwurf prüfen, RN2 A). Nur Doku, kein Code.

- **`docs/RETICULUM-ENTWURF.md`:** Befunde zu reticulum-js – `@reticulum/core` 0.9.8 unter EUPL-1.2 (wie Freedom), ohne
  Abhängigkeiten, im Browser lauffähig, RNode über WebSerial, LXMF als eigenes Paket, Releases fast täglich, noch ohne
  Routing für andere; die Python-Referenz steht seit April 2025 unter einer eigenen Lizenz mit Schadens- und KI-Klausel –
  Freedom bindet sie nicht ein. Ergebnis RN1: Bibliothek. Vorschläge V1–V6 (nur Umschläge, Identität je Gerät im Tresor,
  Sendezeit, Adresse nur für Kontakte, Zustellen über den eigenen Knoten, Gateway nach der App), Fragen W1–W5,
  Aufteilung B-32a–d.
- **B-31:** Größe der MCP-Abhängigkeit vor dem Einbau genannt (MC1): `@modelcontextprotocol/sdk` 1.32.1 = 95 Pakete,
  29 MB, ohne Copyleft; Vorschlag eigener schlanker Client – Frage in `OFFEN.md` 1.0b.
- **Doku:** OFFEN (1.0b mit beiden Fragen, B-31 und B-32 wartend), Sammlung, FORTSCHRITT.

**Tests:** keine (nur Doku).

## Schritt B-30-Entwurf – Atomic Agent als Agent-Harness

Spur B, Sammlung B-30 (AG1 A, 09.10.). Nur Doku, kein Code – der Befund passt nicht zur Annahme der Sammlung.

- **`docs/ATOMIC-AGENT-ENTWURF.md`:** Atomic Agent (MIT) braucht Node ≥ 25.7 (der Knoten läuft auf 22), spricht kein ACP
  (nur OpenAI-kompatibles `serve` und ein eigenes NDJSON-Sidecar), bringt viele Netzwege mit (Composio, Postfach,
  Telegram, Skills aus ClawHub) und hat **Analyse (PostHog) und Absturzberichte (Sentry) standardmäßig an**. Seit VK-W1n C
  ist Hermes über ACP der Motor des Knotens. Vorschlag: nicht als Motor im Knoten, sondern als lokaler OpenAI-Server unter
  „Dieses Gerät“, mit ehrlichem Hinweis; Fragen W1–W4, Aufteilung B-30a.
- **Doku:** OFFEN (1.0b, B-30 wartet), Sammlung, FORTSCHRITT.

**Tests:** keine (nur Doku).

## Schritt B-33-Entwurf – Tor mit Brücken in der Hülle

Spur B, Sammlung B-33 (PT1 A: Snowflake und WebTunnel, Größe und Lizenz vor dem Einbau nennen). Nur Doku:
`docs/TOR-BRUECKEN-ENTWURF.md`.

- **Gemessen:** aus den Quellen gebaut (Go 1.24.7, ohne cgo, `-trimpath -s -w`): `snowflake-client` 2.14.1
  16,8 MB (gepackt 6,2 MB), WebTunnel-Client 0.0.7 5,0 MB, lyrebird 17,8 MB (6,6 MB). Android arm64 geht für
  Snowflake nur mit `-checklinkname=0`.
- **Lizenzen:** Snowflake BSD-3-Clause (alle 56 Abhängigkeiten frei), WebTunnel MIT, goptlib CC0. **lyrebird:**
  `LICENSE` sagt BSD-2-Clause, aber `internal/x25519ell2` (obfs4) und `transports/meeklite` stehen unter
  GPL-3.0-or-later – das Programm als Ganzes ist GPL-3. Nach der STOPP-Regel (starkes Copyleft) eine Frage.
- **Vorschläge V1–V5:** aus den Quellen in der CI bauen, Desktop als Beigabe der Hülle und Android als
  `lib<name>.so` (W^X), Brücken nur auf Wunsch, eingefügte Zeilen nur geprüft, ehrliche Texte.
- **Fragen:** PT2 (welche Programme – Empfehlung A: Snowflake und WebTunnel, kein lyrebird), PT3 (woher Brücken –
  Empfehlung A: eingebaute Snowflake-Zeilen, WebTunnel zum Einfügen). Aufteilung B-33a–d nach Freigabe.
- **Doku:** OFFEN (1.0b, Spur B), Sammlung, FORTSCHRITT.

**Tests:** keine (nur Doku).

## Schritt B-34-Entwurf – Gruppenanrufe über LiveKit

Spur B, Sammlung B-34 (LK1 A: nur in privaten Räumen, Schlüssel aus MLS). Nur Doku: `docs/GRUPPENANRUF-ENTWURF.md`.

- **Gemessen:** `livekit-server` 1.13.10 (Apache-2.0, Docker 43,7 MB amd64 / 41,5 MB arm64); `livekit-client`
  2.22.4 (Apache-2.0, 15 Pakete ohne Copyleft) bringt 561 KB minifiziert und einen E2EE-Worker von 294 KB –
  `freedom.html` wüchse von 8,7 MB um etwa 8 bis 10 %.
- **Befunde:** Zugang nur mit JWT des Servers (das Geheimnis bleibt beim Knoten); E2EE über einen Schlüssel der
  App, der SFU sieht Metadaten und IPs; `packages/mls` gibt kein Exporter-Geheimnis heraus; die CSP erlaubt den
  Worker schon (`worker-src blob:`).
- **Vorschläge V1–V5:** Dienst wie coturn, Zugänge nur versiegelt und je Teilnehmer, Schlüssel je Epoche, IP nur
  bewusst zeigen (eigener TURN oder Warnung), ehrliche Texte.
- **Fragen:** LK2 (Client ins Bundle), LK3 (Schlüssel aus dem MLS-Exporter oder vom Gastgeber), LK4 (IP der
  Teilnehmer) – Empfehlung jeweils A. Aufteilung B-34a–d nach Freigabe.
- **Doku:** OFFEN (1.0b, Spur B), Sammlung, FORTSCHRITT.

**Tests:** keine (nur Doku).

## Schritt B-37-Entwurf – MeshCore als zweites LoRa-Format

Spur B, Sammlung B-37 (nachrangig). Nur Doku: `docs/MESHCORE-ENTWURF.md`.

- **Befunde:** Companion-Schnittstelle (Fassung 3) über USB (1 Byte Richtung, 2 Byte Länge LE), Bluetooth
  (Nordic UART) oder TCP; Gruppen-Datagramme über `SendChannelData` (62) mit 16-Bit-Datentyp, Empfang
  `ChannelDataRecv` (27); Versuchsbereich `FF00`–`FFFF`, feste Bereiche nur über einen Pull Request beim
  Projekt; höchstens 184 Byte je Paket – unsere Rahmen (200 Byte) passen nicht. Firmware und `meshcore.js`
  stehen unter MIT; Freedom bräuchte nur das Format.
- **Vorschläge V1–V4:** Format ohne Abhängigkeit mit Vektoren aus `meshcore.js`, Rahmengröße je Strecke
  (`fragment()` mit Größe, nie mischen), nur Gruppen-Datagramme auf „freedom“, Sendezeitkonto.
- **Fragen:** MCO-W1 (Datentyp beantragen – MENSCH), MCO-W2 (jetzt oder erst mit Gerät vor Ort – Empfehlung B).
- **Doku:** OFFEN (1.0b, Spur B), Sammlung, FORTSCHRITT.

**Tests:** keine (nur Doku).

## Schritt VKl2 – „Als Repo in einen Raum stellen“ aus „Mein Knoten“

Spur A, `docs/VIBECODEN-ENTWURF.md` (VKl, Teil 2: App). Keine neue Abhängigkeit, kein neues Event-Format: Code-Aufträge
(5080) wie VKa, Ankündigung und Bundle-Verweis wie jedes Repo (11.4). Damit ist VKl fertig.

**Gebaut:**
- `shell/knoten-code-ui.ts` (neu):
  - „Projekte“ in der Karte „Mein Knoten“ (nur gekoppelt, nur auf Klick) fragt den Knoten versiegelt nach der Liste
    (`frageKnotenCode()`: frischer Sitzungsschlüssel, `wegZumKnoten()`, gelesen nur über `leseCodeAntwort()`).
  - Je Projekt eine Zeile (Name, Schritte, letzte Änderung) und „Als Repo in einen Raum stellen“.
  - `holeBundleVomKnoten()`: Aktion `bundle`, danach muss das Manifest an den eigenen Relays liegen – sonst fänden es
    die im Raum auch nicht, und nichts wird angekündigt.
- `tabs/repos.ts`: `stelleKnotenProjektEin()` → `kuendigeAn(…, ausKnoten)`: derselbe Dialog (Kennung vorbelegt, Wo:
  öffentlich, offener oder privater Raum – nie „nur dieses Gerät“), private Räume frisch aus MLS. Erst das Bundle,
  dann Ankündigung und Verweis (`bundleVerweis()`); scheitert das Bundle, geht nichts hinaus. Privat nur `sendeInRaum()`.
- `knoten-projekte.ts` (neu, ohne DOM): Zeilen, Bundle-Verweis, Ablehnungen nur über die Kennung des Knotens
  (`CODE_FALL_TEXT`, ein Test vergleicht mit `CodeAbgelehnt` im Knoten) – nie Text vom Knoten.
- `warteAufKnoten()` gibt bei einer Ablehnung zusätzlich die Kennung `fall` zurück.
- Texte in beiden Sprachen, `wiring-ausnahmen.txt`: `baueCodeAuftrag` und `leseCodeAntwort` sind verdrahtet,
  Fallstrick in `packages/app/CLAUDE.md`.

**Tests:** app +4 (`knoten-projekte.test.ts`): Kennungen gleich denen des Knotens, Ablehnung nur über die Kennung
(auch `toString` nicht), Zeile und Verweis, Verdrahtung (versiegelt über den Weg, Manifest geprüft, erst Bundle, dann
Ankündigung, privat nur in die Gruppe, nie „nur dieses Gerät“). Bestehende Quelltext-Tests bleiben unverändert bis auf
die Zeile mit dem Hinweis (`raum-repos-ui.test.ts`).

Knoten-Stand: mit VKl1 (Code-Aktion `bundle`).

## Schritt 11.5n – Pakete holen

Spur A, `docs/REPO-AGENTEN-ENTWURF.md` (W6 B, W6a „So“, entschieden 14.10.). Keine neue Abhängigkeit, kein neues
Event-Format. Bausteine für den Ablauf aus 11.5c – dort ruft der Knoten sie auf.

**Gebaut:**
- `node/src/pakete.ts` (neu):
  - `leseNpmSperre()`: `package-lock.json` Fassung 2/3, jedes installierte Paket mit `resolved` von der Liste und
    `integrity` sha512. Verweise, Bündel, Arbeitsbereiche und Pakete anderer Plattformen (`os`, `cpu`, `libc` wie bei
    npm) bleiben weg. Fremde Quelle oder fehlende Prüfsumme → die ganze Datei abgelehnt.
  - `lesePipAnforderungen()`: `requirements.txt` wie pip – `name==version`, danach nur `--hash=sha256:…`; andere
    Optionen (`--index-url`, `-e`, `-r`) und Bereiche lehnen die Datei ab.
  - `passendeDateien()`: von einer PyPI-Version nur, was die Sandbox braucht – ein reines Rad, sonst Linux/glibc mit
    Prozessor und Python-Fassung (auch `abi3`), sonst das Quellarchiv. Sonst hätte etwa numpy dutzende Räder geholt.
  - `holeAusSperre()` und `paketHolen()` (neues Paket mit fester Version, höchstens 20 je Auftrag): nur GET von
    `PAKET_QUELLEN`, ohne Weiterleitung, über `safeFetch()`; mit Tor (`tor` muss der Aufrufer nennen) nur über
    `torGet()`. Prüfsumme vor dem Ablegen; npm nach Inhalt wie im Cache von npm, PyPI unter dem Dateinamen;
    `O_EXCL`, `O_NOFOLLOW`, 0600. Grenzen: 500 Pakete, 200 MiB zusammen, 50 MiB je Archiv, zehn Minuten.
  - Nach außen nur `PaketAbgelehnt.fall`.
- `node/src/tor.ts`: `torGet()` – ein GET über https durch den SOCKS5-Proxy, Name beim Proxy, ohne Weiterleitung.
- **Befund:** `npm install --package-lock-only --offline` (Entwurf) braucht die Metadaten im Cache, nicht nur die
  Archive. `paketHolen()` gibt deshalb Adresse und Prüfsumme in der Form der Sperrdatei zurück; die Zeilen schreibt der
  Agent selbst (Entwurf ergänzt).
- **Doku:** Fallstrick in `packages/node/CLAUDE.md`, FORTSCHRITT, OFFEN (11.5n gestrichen), Entwurf, Stand-Zeile.

**Tests:** node +11 (`pakete.test.ts`):
- beide Sperrdateien mit Negativfällen;
- Wahl der Räder;
- Ablage nach Inhalt (auch bei zwei sha512), 0600, nichts doppelt;
- falsche Prüfsumme, Netz, Weiterleitung, Größe, Zeit, Verweis an der Zielstelle – nichts abgelegt, nur die Kennung;
- PyPI-Name nach PEP 503, Dateien fremder Hosts übergangen;
- `paketHolen()` mit Namen und Versionen;
- mit Tor nur über den Proxy (Adresstyp 3);
- `npm ci --offline --ignore-scripts` und `pip install --no-index --require-hashes` installieren aus dem Zwischenspeicher.

Knoten-Stand: unverändert (noch nicht aufgerufen; 11.5c).

## Schritt C-42b – Drei Knopf-Arten in Satzschreibung

Aus dem Oberflächen-Review (15.10.2026), zweiter Teil von C-42. Bis jetzt war jeder Knopf ohne eigene Klasse grün, stand in Großbuchstaben und nahm die volle Breite ein. So wirkte jeder Knopf wie die Hauptaktion, und auf einer Seite standen oft drei bis sechs davon.

- **Grundform** (`button`): sekundär, also Fläche (`--surf2`) mit Rand (`--line2`). 14 px, Gewicht 600, in Satzschreibung, Breite nach Inhalt, Radius `--r`.
- **Primär** (grün): nur `.send-btn`, `.btn-primary`, die neue Klasse `.primaer` und „OK“ im Dialog, je Ansicht höchstens einmal. Gefährliche Aktionen bleiben rot (`.dlg-gefahr`).
- **Ghost:** nur mit Rand.
- Beschriftungen, die klein beginnen („mehr“, „kopieren“, „später“), bekommen einen großen ersten Buchstaben über `button::first-letter`. Bis jetzt standen sie in Großbuchstaben.
- **Radien als Tokens:** `--r-sm` 8 (Felder), `--r` 10 (Knöpfe), `--r-lg` 14 (Karten). Bis jetzt waren es 2–4 px.
- Felder in 14 px statt 13 px.

Tests: Die Unit-Tests sind unverändert grün. Grün sind auch die Smoke-Teile „zugang“ (Kontrast und Namen), „mobil“ (Flächen ab 40 px, Text in Knöpfen), „rahmen“, „composer“ und „dialog“. Alle Seiten wurden neu aufgenommen und durchgesehen.

**Prüfungen:** protocol 1332 grün, node 501 (ohne Netz), app 1128 (+0), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt A-17c – Cashu-Baustein

Spur A, `docs/E4B-ENTWURF.md` (V2, V3 geändert mit RM2 W5 A, W4: 10.000 sat; A-17c freigegeben 14.10.). Neue
Abhängigkeit `@cashu/cashu-ts` 4.11.0 (MIT oder Apache-2.0, freigegeben mit A-17c), nur in der App. Kein Event-Format.

**Gebaut:**
- `app/src/cashu-topf.ts` (neu, ohne DOM) – `CashuTopf`:
  - **Mint wählen** (`waehleMint()`): Adresse nur über `pruefeMintAdresse()` (https, keine Zugangsdaten, nicht im
    Heimnetz; `.onion` auch über http); nur Mints mit NUT-11, NUT-12 und Laden in sat; wechseln nur mit leerem Topf.
  - **Laden** (NUT-04): `ladeAnfrage()` prüft die Rechnung der Mint auf genau den Betrag (`leseBolt11()`); bezahlt der
    Aufrufer über die Zahlschienen, dann `abholen()`. Abgelaufene Ladungen zählen nicht mehr.
  - **Senden** (`sende()`): Tausch bei der Mint, Wechselgeld bleibt; mit `an` gesperrt auf den Schlüssel des Empfängers
    (NUT-11), die Gebühr fürs Einlösen trägt der Absender.
  - **Empfangen** (`empfange()`): nur Token der eigenen Mint mit DLEQ (NUT-12), nicht auf einen fremden Schlüssel
    gesperrt. Ohne Netz (`pruefeOhneNetz()`, `nimmOhneNetz()`): nur genau auf den eigenen Schlüssel gesperrt, ohne Frist
    und ohne Rückgabe-Schlüssel, geprüft gegen die gemerkten Schlüssel der Mint; Doppeltes zählt einmal; eingelöst mit
    `einloesen()`.
  - Höchstens 10.000 sat: Guthaben, gesperrt Empfangenes und offene Ladungen zusammen.
  - **Absturzsicher:** eigene Token aus einem Seed (NUT-13), Zähler im Tresor. Jeder Tausch merkt vorher Zähler und
    Einsatz (`laufend`); `nachholen()` leitet nur den Zählerbereich dieses Tauschs neu ab (NUT-09) und prüft den
    Einsatz – nie ab Zähler 0, sonst kämen früher gesendete Token zurück.
  - Nur im Tresor (`freedom.cashu`, `GEHEIM_FEST`, `SICHERUNG_NIE`, nie im Export); ohne offenen Tresor schreibt er
    nichts. Nach außen nur `CashuFehler.fall`.
- `scripts/check-wiring.py` (Zahlwege): `@cashu/cashu-ts` nur in `cashu-topf.ts`.
- `scripts/cashu-testmint.sh` + `cashu-testmint.txt`: Nutshell 0.21.0 mit FakeWallet auf 127.0.0.1, alle Versionen fest;
  die CI startet sie vor den App-Tests (`CASHU_TEST_MINT`).
- **Doku:** Fallstrick in `packages/app/CLAUDE.md`, Befehl in `CLAUDE.md`, FORTSCHRITT, OFFEN (A-17c gestrichen, RM2a–c
  frei), Entwurf, Stand-Zeile.

**Tests:** app +9 (`cashu-topf.test.ts`, 6 davon gegen die Mint – ohne `CASHU_TEST_MINT` übersprungen):
- Adressen der Mint;
- nie in Sicherung oder Export;
- ohne Stand kein Empfangsschlüssel;
- Laden mit Höchstbetrag und Tresor-Pflicht;
- Senden und Empfangen: doppelt Ausgegebenes, fremde Mint, fehlende DLEQ;
- gesperrt auf einen Schlüssel – nur er löst ein, ohne Netz einmal;
- ohne Netz nie Ungesperrtes;
- Absturz mitten im Senden und beim Abholen: genau dieser Stand kommt zurück, ein früher gesendetes Token nicht.

Knoten-Stand: unverändert. Noch ohne Oberfläche und ohne Aufrufer – den bringt RM2c (mit der Grenze „cashu-verwahrt“ im
Bericht).

## Schritt RM2a – Cashu-Pfand im Protokoll

Spur A, `docs/RM2-ENTWURF.md` (V1–V3, W1 A, entschieden 14.10.). Keine neue Abhängigkeit (`@noble/curves` und
`@noble/hashes` sind schon im Protokoll). Neues Format, wie der Entwurf es verlangt (V7): Tags im Kern der Anfrage und im
Angebot (§38).

**Gebaut:**
- `protocol/src/pfand.ts` (neu):
  - `hashZuKurve()` (NUT-00), `hashE()` und `pruefeDleq()` (NUT-12, Prüfung des Empfängers) mit `@noble/curves`.
  - `pfandTags()`/`lesePfandTags()`: genau ein `["pfand", Mint, Token als JSON]` im versiegelten Kern, streng gelesen
    (höchstens 64 Token, Form je Feld, sonst `pfand-form`).
  - `pruefePfand()` ohne Mint – Mint in der Liste, Schlüssel der Mint bekannt, Beweis, Sperre genau auf den
    Pfand-Schlüssel, Frist mindestens 15 Minuten weg, Rückweg, nichts doppelt; gilt ein Teil nicht, gilt keiner.
  - `cashuAngebotTags()`/`leseCashuAngebot()`: `cashu_mint` (höchstens 5) und `cashu_pfand` (Schlüssel, Fassung 1) im
    Angebot; `buildCapabilities()`/`parseCapabilities()` tragen `cashu`.
- Leak-Regel `keine-zahlungsdaten` kennt `pfand`.
- `docs/PROTOCOL.md` §38, Fallstrick in `CLAUDE.md`, `wiring-ausnahmen.txt` (Aufrufer mit RM2b und RM2c).

**Tests:** protocol +7 (`pfand.test.ts`):
- hash_to_curve (NUT-00), hash_e und Beweis eines Tokens (NUT-12) gegen die Testvektoren der Spezifikation, jede
  Abweichung fällt auf;
- `pruefePfand()` mit echten gesperrten Token einer Mint im Test (blind signiert, mit Beweis) und jede Abweichung mit
  ihrer Kennung;
- Tags hin und zurück, Kaputtes wirft;
- Angebot hin und zurück, fremde Angaben streng;
- Leak-Regel: Pfand offen fällt auf, Angebot nicht.

Knoten-Stand: unverändert (noch nicht aufgerufen; RM2b).

## Schritt RM2b1 – Pfand-Kasse im Knoten

Spur A, `docs/RM2-ENTWURF.md` (V1, V3, V5, V6; W1 A, entschieden 14.10.). RM2b aufgeteilt wie der Zahlkanal (4.3c1/4.3c2):
RM2b1 die Kasse, RM2b2 das Verdrahten. Neue Abhängigkeit im Knoten wie im Entwurf freigegeben: `@cashu/cashu-ts` 4.11.0
(MIT oder Apache-2.0, schon in der App seit A-17c – die Sperrdatei bekommt nur den Eintrag des Knotens).

**Gebaut:**
- `node/src/pfand-kasse.ts` (neu), `PfandKasse`:
  - `ladeMints()`: Selbstprüfung je Mint (NUT-11, NUT-12, Schlüssel in sat), Schlüssel gemerkt fürs Prüfen ohne Mint;
    unerreichbar → die gemerkten bleiben. Ein unbekanntes Keyset holt die Kasse höchstens einmal je Minute neu.
  - `nimmAn(pfand, sitzung, bedarfMsat)`: `pruefePfand()`, dann Deckung wie die KanalKasse – übergeben mindestens
    abgerechnet plus Bedarf, je Sitzungsschlüssel der Anfrage, netto (Nennwert minus Gebühr der Mint je Token, NUT-02).
    Ohne Deckung bleibt alles, wie es war; ohne neue Token wird gegen das Übergebene gerechnet.
  - `verbuche()`: höchstens bis zum Übergebenen.
  - `loeseFaelligeEin()`: eine Einlösung zur Zeit, je Mint gesammelt (Frist im Vorlauf von 30 Minuten oder 1000 sat
    offen), ohne Beweis (V5), spätestens zehn Minuten vor der Frist – was näher liegt, gehört dem Rückweg.
  - Absturzsicher wie der Cashu-Topf (A-17c): eigene Token aus einem Seed (NUT-13), Zähler in der Datei, vor jedem Tausch
    „laufend“ gemerkt; scheitert er, auch ohne Antwort der Mint, holt der nächste Lauf genau diesen Zählerbereich zurück
    (NUT-09) und prüft die eingesetzten Token.
  - `pfandSpeicher()`: eine Datei, 0600, über eine Zwischendatei; kaputt → kein Start.
- Protokoll: eine leere Token-Liste heißt „gegen das schon Übergebene rechnen“ (`lesePfandTags()`, `pruefePfand()` ohne
  Frist), §38.
- CI: die Test-Mint startet vor den Knoten-Tests.

**Tests:** node +6 (`pfand-kasse.test.ts`; 4 gegen die Mint), protocol unverändert 7 (`pfand.test.ts` um die leere Liste
erweitert):
- Datei 0600, Neustart behält den Schlüssel, kaputt → kein Start; Mint ohne Netz;
- Deckung netto, je Sitzung, nie doppelt – auch nach einem Neustart, ohne Beweis gemerkt, fremde Sperre abgelehnt;
- Einlösen gesammelt vor der Frist, eine Einlösung zur Zeit, zu spät nie;
- Abbruch nach der Antwort der Mint: der nächste Lauf holt genau diesen Tausch, nichts doppelt;
- die Mint hält die Frist ein (V3): vorher kein Rückweg, danach schon.

Knoten-Stand: unverändert (noch nicht verdrahtet; RM2b2).

## Schritt RM2b2 – Pfand im Provider verdrahtet

Spur A, `docs/RM2-ENTWURF.md` (V1, V4; W1 A). Teil 2 von RM2b; Mint-Abrufe über Tor und die Auszahlung des Erlöses
kommen mit RM2b3 (neu in V9).

**Gebaut:**
- `dvm-provider.ts`: `lesePfandTags()` im versiegelten Kern; Pfand nur aus einem Umschlag, nur mit Kasse, nicht in der
  Bootstrap-Phase, nie neben einer Gutschrift, Gebot mindestens `minBidMsat`. Gedeckt sein muss der Anteil des Providers an
  Gebot und Werkzeugen (`providerAnteilMsat()`, V4 – die übrigen Anteile zahlt die App nach der Antwort); abgerechnet wie ein
  Gebot (höchstens das Gebot plus Werkzeuge), gebucht vor der Antwort der Anteil des Providers – auch im Schwarm-Modus.
- `pfand-kasse.ts`: `pfandKasseAusUmgebung()` (`PFAND=1`, `PFAND_MINTS` – https oder .onion, höchstens fünf; ungültig oder mit
  `TOR_SOCKS` → kein Start) und `pfandOrt()` (`~/.freedom/pfand.json`).
- `main.ts`: Kasse aus der Umgebung, Selbstprüfung der Mints beim Start (ohne den Start aufzuhalten) und stündlich, Einlösen
  alle fünf Minuten (ins Log nur Mint, Betrag, Fehlername), im Angebot `cashu` mit den geprüften Mints und dem Pfand-Schlüssel.
- `docker-compose.yml`, Installer: `PFAND`, `PFAND_MINTS` (aus).
- `check-wiring.py`: Namen nach dem Spread `...` zählen als Aufruf (bis jetzt galt `cashuAngebotTags()` als nicht verdrahtet,
  obwohl `buildCapabilities()` es ruft); Selbsttest mit `nachSpread`. Die beiden letzten Knoten-Ausnahmen für `pfand.ts` sind raus.

**Tests:** node +3 (`pfand-auftrag.test.ts` 2: gedeckt mit A+-Deklaration, ohne neue Token, nichts offen; ungedeckt, offen,
ohne Kasse, neben einer Gutschrift, Gebot zu niedrig, kaputte Form; `pfand-kasse.test.ts` +1: Umgebung mit 9 ungültigen
Fällen). Ein Weg mit echten Token über den Provider geht hier nicht: die Test-Mint läuft auf http://127.0.0.1, der Provider
nimmt nur https/.onion – die echten Token prüft `pfand-kasse.test.ts`.

Knoten-Stand: Wer `PFAND=1` setzen will, braucht diesen Stand; ohne `PFAND` ändert sich nichts.

## Schritt C-43 – Führung als Karte auf ihrer Seite

Aus dem Oberflächen-Review (15.10.2026). Bis jetzt stand der nächste Schritt („Stell einfach eine Frage“, „Sichere deine Wörter“ …) als Leiste über jeder Seite: am Desktop 66 px, und der Text lief unter den Knopf. Am Handy kamen 50 px zum Kopf dazu. Auf dem Wallet stand „Zur KI“, in den Repos „Zu den Nachrichten“.

- **Eine Seite je Schritt** (`hinweisSeite()`, `onboarding.ts`):
  - „los“ steht beim Agenten.
  - „los-chat“ steht in den Chats, oben in der Liste.
  - Die Anleitung zum Knoten steht unter Verdienen.
  - Sichern, Tresor und Wallet gelten für alle. Sie stehen auf der Seite, die man in der Einrichtung gewählt hat (Agent, Chats oder Verdienen): Dort arbeitet man, dort sieht man sie, bis der Schritt erledigt oder auf „später“ gestellt ist.
  - Die Sicherungs-Erinnerung (8.1a) steht daneben.
- **Als Karte**: Titel, der ganze Text und die Knöpfe untereinander. Die Hauptaktion ist grün (`.primaer`, C-42b), „Später“ ist ein Ghost-Knopf. „mehr/weniger“ fällt weg, weil die Karte nur noch auf einer Seite steht. Am Handy war der Text bis jetzt zugeklappt.
- **Kein Knopf, der nur hinführt**: Bei „los“ und „los-chat“ fällt der Knopf weg („Zur KI“, „Zu den Nachrichten“), weil die Karte schon dort steht. Die Anleitung öffnet weiter den Reiter „Hosten“.
- **Desktop-Raster**: Zwischen Leiste und Seite steht nur noch der Offline-Hinweis (zwei Zeilen statt vier).

Den Gratis-Stand als Chip im Kopf des Agenten übernimmt C-49 (Agent-Eingabe). Dort wird die Zeile darunter ohnehin neu gebaut.

Tests:
- Ein neuer Unit-Test prüft `hinweisSeite()` für jeden Schritt und jede Wahl (mit Gegenfällen) und prüft, dass Schritte ohne eigenen Knopf auskommen.
- Die Tests aus 8.1a, C.1a, C.5b und C-39a sind auf die Karte umgestellt.
- Smoke-Teile:
  - „rahmen“: Die Karte steht am Desktop in der Seite des Agenten und nicht in den Chats.
  - „einrichtung_wahl“: Nach „Nachrichten schreiben“ steht die Karte in den Chats, ohne Knopf, und nicht beim Agenten.
  - „mobil“: Hochkant und quer ist der Text ganz lesbar, die Karte hält den Rand und ist höchstens knapp halb so hoch wie der Bildschirm. In den Chats steht keine.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1138 (+1), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-44 – Avatare: Buchstabe im Kreis, Farbe aus dem Schlüssel

Aus dem Oberflächen-Review (15.10.2026). Personen ohne Bild sahen alle gleich aus:
- In der Chat-Liste stand ein grüner Kreis mit dem ersten Zeichen des Namens oder, ohne Namen, des Schlüssels.
- Im Raum-Verlauf und bei den Mitgliedern stand gar kein Zeichen.
- Im Kopf der Unterhaltung stand nicht einmal der Name.

- **`avatar.ts`**:
  - `avatarFarbe()` wählt eine von acht Farben aus den ersten zwei Hex-Zeichen des Schlüssels. Ohne gültigen Schlüssel ist es die erste.
  - `personInitiale()` liefert den ersten Buchstaben des Namens, nach Zeichen gezählt (Emoji bleiben ganz), ohne „~“. Ohne eigenen Namen steht „?“ statt eines Zeichens aus dem Schlüssel; die Farbe unterscheidet die Personen trotzdem.
  - `kontaktInitiale()` nutzt sie mit.
- **`avatar()`** (`shell/ui.ts`) baut einen Kreis nur aus Text, mit `data-farbe` und `aria-hidden` (für Vorleser zählt der Name daneben). Er erscheint in:
  - der Chat-Liste (32 px);
  - dem neuen Kopf der Unterhaltung (`#chat-partner`: Zeichen und Name; er wird mit der Liste neu gezeichnet und folgt so Umbenennen und Profilnamen);
  - dem Raum-Verlauf (36 px links neben jeder Gruppe);
  - den Mitgliedern.
  Das eigene Zeichen kommt aus dem eigenen Profilnamen (`eigeneInitiale()`, wie in der Kopfzeile).
- **Kopfzeile und Profil** nutzen dieselben Farben: `header .ident[data-farbe]::before` und `.profile-avatar-fallback[data-farbe]`. Der Rand der Profil-Vorschau bleibt im gewählten Akzent.
- Nie ein Bild aus dem Netz (Regel aus C.5a).

Die acht Farben stehen nur in `app.css`. Ein Test liest sie dort und rechnet den Kontrast zu Weiß nach WCAG: Jede liegt bei mindestens 4,5:1 (die niedrigste bei etwa 5:1).

Tests:
- Neu ist `avatar.test.ts`:
  - Farbe gleich für denselben Schlüssel, alle acht verteilt, kaputte Schlüssel ergeben 0;
  - Buchstabe nur aus dem Namen, Gegenfälle ergeben „?“;
  - Kontrast jeder Farbe;
  - die Verdrahtung.
- `kontakt-name.test.ts` erwartet ohne Namen jetzt „?“ statt einer Ziffer aus dem Schlüssel; das ist eine gewollte Änderung.
- Der Smoke-Teil „kontaktname“ prüft zusätzlich die Farbe aus dem Schlüssel und Zeichen und Namen im Kopf der Unterhaltung.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1142 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-45 – Leere Zustände mit Symbol, Satz und nächstem Schritt

Aus dem Oberflächen-Review (15.10.2026). Leere Listen zeigten bis jetzt einen grauen Satz ohne Weg weiter, oft mit Fachwort:
- „Noch keine Unterhaltungen. Mit + beginnst du eine.“
- „Noch keine Repos nach NIP-34 …“
- „keine LP-Angebote gefunden“

- **`leererZustand()`** (`shell/ui.ts`) zeigt ein Symbol im Kreis, einen Satz als Text und höchstens einen Knopf, die Hauptaktion (`.primaer`, C-42b). Kein HTML.
- **Chat-Liste**: „Noch keine Unterhaltungen. Schreib jemandem – Ende-zu-Ende-verschlüsselt, ohne Telefonnummer.“ Dazu „Neue Unterhaltung“; der Knopf öffnet denselben Dialog wie „＋“.
- **Repos**, drei Fälle:
  - Ohne Repos: „Repo ankündigen“.
  - Wenn die Suche nichts findet: „Suche leeren“ (leert das Feld und zeigt die Liste wieder).
  - Unter „Neu“ ohne Neuigkeiten: „Alle zeigen“.
  Der Text nennt statt „NIP-34“ die Clients, die die Repos auch sehen.
- **Tauschen**: „Auf deinen Relays bietet gerade niemand einen Tausch an. Angebote kommen und gehen – such später noch einmal.“ Dazu „Noch einmal suchen“, das das Wallet neu lädt. Die Angebote liest die App weiter nur von den eigenen Relays; der Satz sagt genau das.

Verdienen („Noch keine Einnahmen“) baut C-54 ohnehin um. Dort kommt der leere Zustand mit der Übersicht.

Tests:
- Neu ist `leer-zustand.test.ts`:
  - der Baustein (nur Text, höchstens ein Knopf);
  - die Verdrahtung an allen fünf Stellen samt Gegenprobe;
  - Klartext ohne „NIP-34“, „LP“ und „mit +“ in beiden Sprachen.
- Smoke-Teile:
  - „einrichtung_wahl“: Die leere Chat-Liste zeigt Symbol, Satz und Knopf, und der Knopf öffnet den Dialog.
  - „repos“: Die leere Suche zeigt Satz und „Suche leeren“, und der Knopf bringt die Liste zurück.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1145 (+3), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-46 – Agent-Kleinigkeiten: Kopieren je Antwort, ehrlicher Untertitel

Aus dem Oberflächen-Review (15.10.2026), vier Kleinigkeiten auf der Agent-Seite:
- **Kopieren**: Unter der Eingabe stand eine eigene Knopfreihe „Letzte kopieren · Alle kopieren“. Jetzt steht „Kopieren“ (Symbol und Wort) leise unter jeder Antwort, nicht unter den eigenen Fragen. Kopiert wird nur der Text der Antwort. Wenn der Browser die Zwischenablage nicht freigibt, sagt die Meldung das, statt „keine Antwort“. „Alle kopieren“ steht im Arbeitsbereich unter „Unterhaltung“. Eine Reihe weniger um die Eingabe; C-49 baut sie ganz um.
- **Untertitel**: Bis jetzt stand dort „Stell eine Frage. Du zahlst pro Anfrage.“, über einer Karte, die „kostet kein Geld“ sagte. Jetzt: „Stell eine Frage. Bis zu 20 Antworten am Tag sind gratis, solange Provider es anbieten – danach zahlst du je Anfrage.“ Ein Test hält die Zahl gleich mit `GERAET_GRATIS`.
- **Beispiele** stehen ohne Anführungszeichen und „…“, in Satzschreibung.
- **„Modell wählen · Werkzeuge anhängen“** fällt weg. Das war Text, der wie ein Knopf aussah, die Knöpfe stehen direkt darunter.
- **„Auto (schnellste)“** ist seit C-42b kein zweiter grüner Knopf neben „Senden“ mehr, sondern die Grundform. Ein Test hält fest, dass er keine grüne Klasse trägt.

Tests:
- `agent-kleinigkeiten.test.ts` hat zwei neue Tests:
  - Kopieren nur unter Antworten und nur Text, „Alle kopieren“ im Arbeitsbereich, keine Reihe mehr;
  - der Untertitel nennt die Zahl aus dem Kontingent in beiden Sprachen, Beispiele ohne Anführungszeichen, kein Schein-Knopf.
- Der Smoke-Teil „agent_folgen“ prüft zusätzlich: sechs Antworten mit „Kopieren“, keine Frage mit; der Klick kopiert die letzte Antwort (Attrappe der Zwischenablage); „Alle kopieren“ steht im Arbeitsbereich.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1147 (+2), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-48 – Website: eine Navigation, Menü-Knopf am Handy, Text ohne Serifen

Aus dem Oberflächen-Review (15.10.2026). Die Startseite hatte eine andere Navigation als die Unterseiten: Dort fehlten Downloads, dafür stand „Start“. Am Handy brach die Navigation zweizeilig um, in 10 px Großbuchstaben. Der ganze Text stand in Monospace.

- **Eine Navigation** auf allen fünf Seiten: App, Downloads, Status, Whitepaper, Roadmap, FAQ, Code. Das Logo führt überall zur Startseite. Die eigene Seite ist als `aria-current="page"` markiert und grün. Die Sprachauswahl bleibt auf der Startseite, weil nur sie übersetzt ist. Die Unterseiten gibt es nur auf Deutsch, und eine Auswahl dort verspräche etwas anderes.
- **Menü-Knopf am Handy** (bis 760 px): „Menü“ klappt die Links als Liste mit etwa 50 px hohen Zeilen auf (`js/nav.js`, `aria-expanded`, Escape schließt, ein Link schließt). Ohne Skript bleibt die Navigation offen sichtbar; versteckt wird sie erst, wenn das Skript läuft (`mit-skript`).
- **Schrift**:
  - Text ohne Serifen (`--font-body`, Systemschrift wie die App seit C-42a; Inter einzubetten bleibt Entscheidung OR1);
  - Monospace nur für Code, Befehle und das Terminal-Fenster (`--font-mono`);
  - Fließtext 16 px, kleinste Schrift 12 px (vorher 10–11 px), Karten-Text 14 px;
  - Knöpfe in Satzschreibung mit Radius 10 px wie in der App.
- Das Aussehen der Startseite und des Dashboards (Hero, Bild der App, Kacheln) bleibt C-58.

Tests:
- `check-website.py` prüft neu (`navigation_pruefen()`):
  - dieselben Ziele auf allen Seiten;
  - Menü-Knopf mit `aria-controls` und `js/nav.js`;
  - die eigene Seite als `aria-current`;
  - Fließtext ohne Monospace.
- Gegenprobe: Eine FAQ-Seite ohne „Roadmap“ und ohne `aria-current` ergibt zwei Fehler, Ende mit 1.
- Bildschirmfotos (1280 und 390 px, Menü offen): keine waagrechte Laufleiste, Schrift ohne Serifen.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1147 (+0), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-49a – Agent-Eingabe als Pille, Werkzeuge im Menü „+“

Aus dem Oberflächen-Review (15.10.2026), erster Teil von C-49. Um die Eingabe des Agenten standen fünf Bedienreihen: Werkzeug-Chips mit Preisen über dem Feld, Anhang-Knopf, Textfeld mit „Senden“, darunter Stufe, Modell, Gebot, „privat“ und Stände. Am Handy belegte das 410 von 844 px.

- **Eine Pille**: oben das Textfeld ohne eigenen Rahmen, darunter eine Leiste mit:
  - „+“;
  - den gewählten Werkzeugen als Chips;
  - dem Modell (`#ai-model-btn`, jetzt in der Pille, das Popover öffnet nach rechts);
  - „Senden“.
- **„+“** öffnet „Anhängen“ (Bild, Datei, Audio, Video, Kamera) und „Werkzeuge“ (Web, Browser, Bild, Video, je mit Preis rechts) in einem Menü. Es hat `aria-expanded`/`aria-controls`, Escape schließt das Menü und gibt den Fokus zurück. Ein Klick im Menü schließt es nicht (mehrere Werkzeuge nacheinander), ein Anhang schon.
- **Gewählte Werkzeuge** stehen als Chip „Web ×“ in der Pille (`zeigeWerkzeugAuswahl()`). Das „×“ klickt den Knopf im Menü, so bleibt `selectedTools` an einer Stelle.
- „Auto (schnellste)“ beginnt groß. `::first-letter` griff nicht, weil ein Symbol vor dem Text steht.
- Die Werkzeug-Reihe zum Wischen am Handy (C.5a) fällt weg, weil die Werkzeuge im Menü untereinander stehen.

Stufe, Gebot und „privat“ wandern mit C-49b ins Popover, der Gratis-Stand mit C-49c in einen Chip.

Tests:
- Neu ist `agent-pille.test.ts`: die Reihenfolge in der Pille, die vier Werkzeuge im Menü, `aria-*`, und die Chips, deren „×“ den Menü-Knopf klickt, ohne `selectedTools` und ohne HTML.
- Der Smoke-Teil „agent_klein“:
  - liest die Preise jetzt `attached` statt sichtbar;
  - prüft zusätzlich: „+“ öffnet das Menü (vier Werkzeuge, `aria-expanded`), „Web“ ergibt den Chip „Web×“ und das Menü bleibt offen, „×“ nimmt das Werkzeug zurück, Escape schließt.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1149 (+2), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-49b – Stufe und Bezahlung als Popover, am Handy als Blatt

Aus dem Oberflächen-Review (15.10.2026), zweiter Teil von C-49. Stufe, Gebot mit Einheit, „privat“ und „über Funk“ standen als eigene Reihe unter der Eingabe.

- **Popover „Stufe und Bezahlung“**: Ein Knopf (Zahnrad) in der Pille neben dem Modell öffnet die vier Felder untereinander (`aria-expanded`/`aria-controls`). Escape und ein Klick daneben schließen es. Die Felder selbst (`#ai-tier`, `#bid-wrap`, `#ai-privat`, `#ai-funk`) und ihre Logik bleiben, wie sie waren.
- **Am Handy ein Blatt von unten**, mit runden Ecken oben.
- **Unter der Eingabe** steht nur noch der Stand: Vorschau der Kosten und Budget der Sitzung.
- **„Privat“ und „Über Funk“ bleiben sichtbar**: Ist der Haken gesetzt, steht eine Marke in der Pille und der Knopf wird grün. Das ist nur CSS (`:has`) und folgt deshalb auch dem Haken, den eine geöffnete Unterhaltung setzt (D2).
- Die Eingabe am Handy ist jetzt 260 px hoch statt 410 px; der Smoke-Test hält sie unter 300 px (quer unter 240 px).

Tests:
- `agent-pille.test.ts`:
  - alle Felder im Popover, unter der Eingabe nur der Stand;
  - die Marken-Regel und das Blatt am Handy;
  - `setupOptionen()` verdrahtet.
- Smoke-Teile:
  - „agent_klein“: Das Popover öffnet sich (Stufe und „privat“ sichtbar, `aria-expanded`), „privat“ zeigt die Marke, Escape schließt.
  - „mobil“: Die Höhe der Eingabe hochkant und quer.
  - „ki_schiene“, „lokal“ und „gratis_auto“: unverändert grün (sie bedienen die Felder im Popover).

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1150 (+1), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-49c – Gratis-Stand als Chip, rechte Spalte nur auf Klick

Aus dem Oberflächen-Review (15.10.2026), letzter Teil von C-49 (mit dem Punkt aus C-43).

- **Gratis-Stand als Chip** in der Pille: „20/20 gratis“, aufgebraucht „Gratis aufgebraucht“. Der ganze Satz („Gratis heute: noch 20 von 20 Antworten, 20.000 von 20.000 Tokens“) steht samt Fairness-Regel im Tooltip und als `aria-label` für Vorleser. Bis jetzt war es eine eigene Zeile unter der Eingabe. Der Stand kommt weiter nur aus dem Kontingent dieses Geräts (`zeigeGratisStand()`, C-27).
- **Rechte Spalte am Desktop nur auf Klick**: Arbeitsbereich, Werkzeuge, Kosten und „Alle kopieren“ waren meist leer und kosteten 300 px. Jetzt öffnet „Arbeitsbereich“ oben rechts über dem Gespräch die Spalte (`aria-expanded`). Der Browser merkt die Wahl in `freedom.agent.panel`, nur als Bequemlichkeit; ohne Speicher bleibt sie zu. Unter 1200 px bleibt sie die eigene Ebene aus C.6b.

Tests:
- `gratis-anzeige.test.ts` hat einen neuen Test: Chip kurz, Satz im Tooltip und als `aria-label`, in der Pille.
- `agent-pille.test.ts` hat einen neuen Test: Spalte nur auf Klick, gemerkt mit Ausweg ohne Speicher.
- Smoke-Teile:
  - „gratis_anzeige“: Chip, Tooltip und `aria-label`, frisch und verbraucht.
  - „agent_folgen“: Die Spalte ist zu, öffnet und schließt per Knopf, gemerkt als 1/0.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1152 (+2), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-50a – Wallet: Kontostand oben und vier Aktionen

Aus dem Oberflächen-Review (15.10.2026), erster Teil von C-50. Bis jetzt stand oben auf der Wallet-Übersicht kein Kontostand. Es gab nur zwei grüne Knöpfe und darunter je Karte einen eigenen Stand.

- **„Gesamt“** oben (`gesamtStand()`, `wallet-gesamt.ts`, ohne DOM):
  - Lightning (msat) und Solana (Lamports: Browser-Wallet und eingebaute Wallet) werden zusammengezählt, in der Anzeigeeinheit (12.1), die andere Einheit darunter.
  - Eine Summe gibt es nur mit Kurs (Regel aus 4.4). Ohne Kurs stehen beide Beträge getrennt da, mit „ohne Kurs keine Summe“.
  - Ein Konto, dessen Stand gerade nicht abrufbar ist, macht die Summe „unvollständig“ und wird nie als 0 gezählt.
  - Ohne Konto steht keine Null, sondern „Noch keine Wallet verbunden.“
- **Woher die Stände kommen**: Von dort, wo die App sie ohnehin holt (`merkeStand()` in `connectNwc()`, `connectSolana()`, `zeigeEingebauteWallet()`). Es gibt keinen zusätzlichen Abruf, nichts wird gemerkt.
- **Vier Aktionen**: Empfangen (die Hauptaktion, grün), Senden, Tauschen, Hinterlegen, als Symbol mit Beschriftung. Tauschen und Hinterlegen öffnen ihren Reiter.

Tests:
- Neu ist `wallet-gesamt.test.ts`:
  - ohne Konto `null`;
  - Summe in sats und in SOL mit Kurs;
  - ohne Kurs getrennt (auch nur ein Konto);
  - unbekannt ergibt „unvollständig“;
  - die Verdrahtung, ohne Abruf und ohne Speicher.
- `senden.test.ts` und `empfangen.test.ts` erwarten das neue Markup.
- Der Smoke-Teil „waehrung“ prüft „—“, den Hinweis, die vier Knöpfe und dass „Tauschen“ den Reiter öffnet.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1157 (+5), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-50b – Wallet: Konten als Zeilen mit Stand, Verbindung dahinter

Aus dem Oberflächen-Review (15.10.2026), zweiter Teil von C-50. Auf der Übersicht standen NWC-Feld, Häkchen, eigenes Relay, „Verbinden“, die eingebaute Wallet und das Nonce-Konto offen untereinander. „Wallet verbinden“ stand dreimal da.

- **Konten als Zeilen**: Lightning und Solana zeigen je Symbol, Zustand und Stand. Bei Solana ist das die Summe aus Browser-Wallet und eingebauter Wallet (aus `merkeStand()`), ohne Stand „—“.
- **„Verbindung“** (`<details>`) enthält NWC-Feld, Häkchen und eigenes Relay bzw. Kurs, Solana verbinden, die eingebaute Wallet und „Ohne Internet zahlen“. Offen ist sie nur ohne Konto: Verbunden oder eingerichtet geht sie zu, getrennt wieder auf.
- **Kopf der Seite** ohne „KI-Budget“ und „Wallet verbinden“. Das KI-Budget ist eine eigene kleine Karte unter den Konten (dieselbe Anzeige, `#nb-sats`). „Wallet verbinden“ steht nur noch an der Lightning-Verbindung. Der Text „+ SOL hinterlegen“, den der Kopf-Knopf zeigte, entfällt mit ihm.

Tests:
- `wallet-gesamt.test.ts` hat einen neuen Test:
  - Zeilen mit Stand, „Verbindung“ offen;
  - die Felder darin;
  - zu bei verbunden, offen bei getrennt;
  - „Wallet verbinden“ genau einmal;
  - die KI-Budget-Karte.
- `i18n.test.ts` prüft, dass der Kopf-Knopf weg ist.
- Der Smoke-Teil „waehrung“ prüft: ohne Wallet beide „Verbindung“ offen, „Wallet verbinden“ einmal sichtbar, Solana „—“.
- „geld_settings_klein“ (KI-Budget, Häkchen, Abstände) ist unverändert grün.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1158 (+1), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-50c – Wallet: Einrichtung als Assistent ohne Konto

Aus dem Oberflächen-Review (15.10.2026), letzter Teil von C-50. Ohne Konto stand auf der Übersicht nur das NWC-Feld. Wer neu war, fand nicht, dass es eine eingebaute Wallet gibt.

- **„Wallet einrichten“** erscheint nur ohne Konto (`gesamtStand()` ist `null`) und bietet drei Wege als Zeilen:
  - **Eingebaute Wallet** (empfohlen): SOL aus den 12 Wörtern, nur im Tresor. Der Weg klickt „Einrichten“; mit Bunker gibt es ihn nicht.
  - **Lightning-Wallet verbinden**: öffnet die Verbindung und setzt den Cursor ins NWC-Feld.
  - **Solana-Wallet verbinden**: verbindet die Browser-Wallet wie „Verbinden“.
- Jeder Weg führt zu dem, was es schon gibt; dahinter ist nichts Neues.
- Darüber steht, dass KI auch ohne Wallet geht (20 Antworten am Tag gratis), darunter „FreedomStack verwahrt nie dein Geld.“

Tests:
- `wallet-gesamt.test.ts` hat einen neuen Test:
  - drei Wege, der eingebaute hervorgehoben;
  - jeder führt zum bestehenden Knopf;
  - nur ohne Konto;
  - der eingebaute nicht mit Bunker;
  - die eingebaute Wallet verspricht keine sats.
- Der Smoke-Teil „waehrung“ prüft drei sichtbare Wege; „Lightning“ öffnet die Verbindung, der Fokus steht im Feld.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1159 (+1), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-51 – Tauschformular: günstigstes Angebot vorgewählt, „Du zahlst / Du bekommst“

Aus dem Oberflächen-Review (15.10.2026). Bisher zeigte „Tauschen“ nur die Liste der LP-Angebote. Gebühren, Grenzen und Richtung musste man dort selbst vergleichen.

- **Formular über der Liste:**
  - Richtung „sats → SOL“ / „SOL → sats“ und ein Betrag auf der Lightning-Seite.
  - Darunter: „Du zahlst“, „Du bekommst“, Kurs, Gebühr, Frist, Grenzen und Anbieter.
  - Dazu der Satz „atomar“ aus `docs/SWAPS.md`.
- **Vorgewählt** ist das günstigste gültige Angebot der Richtung (`bestesAngebot()` in `tausch-wahl.ts`):
  - es darf nicht abgelaufen sein und muss Umschläge lesen (4.9b);
  - Gebühr, Grenzen und Frist müssen rechenbare Zahlen sein, denn `parseLpOffer()` prüft sie nicht;
  - bei gleicher Gebühr gewinnt das größere Angebot.
- **Ehrliche Beträge:**
  - SOL → sats ist genau: derselbe `rueckSwapLamports()` wie beim Sperren, Kurs aus `lamports_per_sat`.
  - sats → SOL ist nur mit Marktkurs geschätzt (≈). Ohne Kurs steht „nennt der Anbieter vor dem Zahlen“.
  - Die nicht erstattbare Vorab-Gebühr (4.6d) steht bei der Gebühr.
- **„tauschen“** ruft denselben Ablauf wie die Liste (`startSwap()`/`startRueckSwap()`). Der Betrag steht im Dialog vorbelegt; der Dialog fragt weiter, nichts geht ungefragt hinaus.
- **„Alle Angebote“** steht aufklappbar darunter. Mit Angeboten ist die Liste zu; ohne steht dort der leere Zustand aus C-45.

Tests:
- Neu: `tausch-wahl.test.ts` mit 9 Tests:
  - Auswahl, Ausschlüsse und Gleichstand;
  - genauer Betrag in der Gegenrichtung, Schätzung nur mit Kurs;
  - Grenzen, Vorab-Gebühr, Kurs und Frist;
  - Verdrahtung.
- Der Smoke-Teil „waehrung“ prüft:
  - das Formular ist sichtbar und die Liste zu;
  - in beiden Richtungen das vorgewählte Angebot (das unversiegelte nie) mit allen Zeilen;
  - einen zu kleinen Betrag;
  - „tauschen“ öffnet den Dialog mit dem Betrag.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1168 (+9), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-52a – Chat-Liste: Zeile mit Vorschau und Zeit

Aus dem Oberflächen-Review (15.10.2026), erster Teil von C-52. In der Liste stand je Unterhaltung nur der Name. Was zuletzt kam und wann, sah man erst nach dem Öffnen.

- **Zwei Zeilen je Unterhaltung:**
  - oben Name und Zeit (heute die Uhrzeit, gestern „gestern“, bis sechs Tage zurück der Wochentag, sonst das Datum);
  - darunter die neueste Nachricht und „neu“;
  - eigene Nachrichten mit „Du:“.
- **Anhänge ohne Text** stehen als ihre Art da („Sprachnachricht“, „Bild“, „Anhang (2)“), nie mit Adresse.
- **Die Vorschau lebt nur im Speicher dieser Sitzung** (`chat-zeile.ts`). Sie entsteht aus dem, was die App ohnehin öffnet:
  - Abgleich des Posteingangs;
  - MLS-Verlauf auf dem Gerät;
  - Senden;
  - geöffneter Verlauf.
- Gespeichert wird sie nie, auch nicht im Tresor. Mit dem Neuladen (Sperren, Identität wechseln) ist sie weg. Mit Ablauf (NIP-40) gilt sie nur bis dahin.
- Ungelesen bleibt eine Marke („neu“) und kein Zähler: Der Lesestand aus C-30 kennt nur einen Zeitpunkt.

Tests:
- Neu: `chat-zeile.test.ts` mit 5 Tests:
  - Text, Kürzen und Anhänge;
  - die neueste gewinnt;
  - Ablauf;
  - Zeitformen;
  - Verdrahtung, und dass nichts gespeichert wird.
- Die Smoke-Teile prüfen:
  - „fremdtext“: die Vorschau als Text, nie als HTML, mit Uhrzeit;
  - „kontaktname“: „Du: …“ nach dem Senden, und der Text steht nirgends in localStorage.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1173 (+5), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-52b – Chat-Liste: Filter, Räume in der Liste, „Neu“ am Handy

Aus dem Oberflächen-Review (15.10.2026), zweiter Teil von C-52. Bisher standen Räume nur in der Leiste. Am Handy kostete die Leiste 60 px, und Filter gab es keine.

- **Filter** Alle · Direkt · Räume · Ungelesen (Knöpfe mit `aria-pressed`), je mit eigenem leeren Zustand:
  - Räume: „Raum anlegen“;
  - Ungelesen: „Alles gelesen.“
- **Räume und Communities stehen unter den Direktnachrichten.**
  - Sie kommen aus derselben Quelle wie die Leiste (`raeumeFuerListe()`).
  - Namen stehen nur als Text da, mit Art bzw. Einladung und „neu“.
  - Ein Raum öffnet sich wie aus der Leiste.
- **Am Handy** steht die Leiste nur noch im Raum, zum Wechseln und zurück. In der Liste ersetzen sie die Zeilen.
- **„Neu“** schwebt unten rechts. Es bietet Neue Unterhaltung, Raum anlegen und Raum beitreten – dieselben Knöpfe wie bisher.
- Filter und Räume stehen in `tabs/chat-liste.ts`; `kommunikation.ts` bleibt unter 700 Zeilen.

Tests:
- Neu: `chat-filter.test.ts` mit 4 Tests.
- Angepasst wurden `communities`, `raeume-rest`, `leer-zustand`, `raum-anlegen` und `dateigroesse`.
- Neuer Smoke-Teil „chat_liste“ (Desktop und Handy):
  - alle vier Filter;
  - ein Raum öffnet sich und markiert seine Pille;
  - am Handy keine Leiste in der Liste, „Neu“ im Bild mit drei Wegen, im Raum die Leiste.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1177 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-53a – Einstellungen › Verbindung: Relays als Liste mit Stand

Aus dem Oberflächen-Review (15.10.2026), erster Teil von C-53. Der eigene Relay-Satz war ein leeres Textfeld (eine Adresse je Zeile). Ob ein Relay verbunden ist, sah man nicht.

- **Je Relay eine Zeile:**
  - Punkt und Stand aus dem Pool: verbunden, nicht verbunden, noch nicht benutzt;
  - „Entfernen“;
  - darunter ein Feld „Hinzufügen“, das die Adresse wie bisher über `pruefeRelayEingabe()` prüft.
- **Geändert wird ein Entwurf.** „Veröffentlichen“ ist erst dann an und geht weiter nur über `setzeEigeneRelays()`: erst beide Listen, dann merken, dann in den Pool. Als Gerät nur sichtbar.
- Den Satz liest die Seite beim Öffnen neu, solange nichts geändert ist. Die App legt ihn beim ersten Verbinden an.
- Die ganze Erklärung steht unter „Mehr dazu“.
- **Solana-Endpunkte und Relay-Zugang** stehen unter „Erweitert“. Die Erinnerung an einen ablaufenden Zugang klappt es auf.
- Neues Modul `shell/relay-liste-ui.ts`. `knoten-weg-ui.ts` zeigt einen übernommenen Satz über `zeigeRelaySatz()`.

Tests:
- `relay-satz.test.ts` (5.4b2) liest das neue Modul, mit denselben Zusicherungen.
- Neuer Smoke-Teil „relay_liste“:
  - Liste gleich dem Satz;
  - Stand je Zeile;
  - eine falsche Adresse wird abgewiesen;
  - Hinzufügen schaltet „Veröffentlichen“ frei, Entfernen stellt den Satz wieder her;
  - „Erweitert“ ist zu;
  - Veröffentlichen sendet 10002/10050 und merkt den Satz.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1177 (+0), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-53b – Einstellungen › Datenschutz: gruppierte Zeilen mit Schaltern

Aus dem Oberflächen-Review (15.10.2026), zweiter Teil von C-53. Datenschutz war eine Textwand aus Häkchen und Absätzen.

- **Drei Gruppen** wie in iOS: Netz, Daten und Kontakte, Nachrichten und KI.
- **Jede Zeile** hat einen Titel und einen Satz, rechts einen Schalter (`role=switch`) oder eine Auswahl. Ein Klick auf die Zeile schaltet.
- **Die ganze Erklärung steht wörtlich unter „Mehr dazu“.** Die kurzen Sätze nennen die Grenzen: Anrufe gehen nicht über Tor; die Verzögerung verbirgt die IP-Adresse nicht; was mitgeht, liest der Provider.
- „Was sichtbar ist“ (der Bericht) steht als eigene Karte darunter.
- Ids und Verdrahtung bleiben unverändert.

Tests:
- Neu: `einstellungen-zeilen.test.ts` mit 4 Tests: Gruppen, Schalter, Erklärungen wörtlich, Grenzen in den kurzen Sätzen.
- Angepasst wurden `ki-platzhalter`, `netz-huelle`, `ruf-teilen` und der Leak-Test `kontakte` (weiter nicht vorab angehakt).
- Neuer Smoke-Teil „einst_zeilen“ (Desktop und Handy):
  - drei Gruppen, Schalter mit Namen aus der Zeile;
  - Zeilen ab 48 px, „Mehr dazu“ zu;
  - der Klick auf den Titel schaltet und wird gemerkt;
  - am Handy läuft nichts seitlich über.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1181 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.

## Schritt C-54 – Verdienen als Übersicht: Checkliste ohne Knoten, Kacheln mit Knoten

Aus dem Oberflächen-Review (15.10.2026). Die erste Karte unter Verdienen verlangte „Dein Knoten: npub oder Hex“, auch von allen, die keinen Knoten haben.

- **Ohne Knoten** (kein Angebot unter dem Schlüssel) steht eine Checkliste da: Knoten installieren (führt nach Hosten), mit dieser App koppeln (derselbe Dialog wie in Settings › Geräte; gekoppelt: „Gekoppelt.“), Auszahlung festlegen. Keine Umgebungsvariablen (Nutzertest V-1). Das Feld für einen Schlüssel steht unter „Anderer Knoten“.
- **Mit Knoten** stehen Kacheln da: Stand (Angebot aktiv), heute, 30 Tage, Aufträge (30 Tage) – aus den Leistungs-Events, die der Knoten selbst meldet (`verdienst-kacheln.ts`), mit dem Satz „Wie dein Knoten es meldet – Kunden zählen nur ihre eigenen Quittungen.“ SOL nur mit Kurs als SOL.
- **Gekoppelt** gilt der gekoppelte Knoten, solange kein anderer eingetragen ist.
- **Vertrauensstufe mit Ziel:** „Noch n XP bis Classic/Pro.“

Tests: neu `verdienst-kacheln.test.ts` (4: heute/30 Tage je Kette, Fremddaten nur ganze msat, Text, Verdrahtung); `verdienen-ohne-knoten.test.ts` angepasst (Checkliste, „Anderer Knoten“, keine Umgebungsvariablen). Smoke-Teil „ohne_knoten“: drei Schritte, keine Kacheln, Feld zugeklappt; „einnahmen“ unverändert grün.

**Prüfungen:** protocol 1339 grün, node 506 (ohne Netz), app 1185 (+4), Leak 73 + 1 todo;
tsc überall, Build, Wiring (Exit 0), Website, innerHTML, Smoke grün.
