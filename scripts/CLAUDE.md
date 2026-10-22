# Skripte (`scripts`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter `scripts/`
gelesen wird. Hier steht, was man nur in den Skripten (Browser-Test, Installer) falsch
macht – verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag mit
„Weitere Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue Fallstricke
dieses Bereichs unten anhängen.

## Fallstricke

- **Uhr im Smoke-Test:** Playwrights frei laufende Uhr kann einen `fast_forward`
  verlieren; vorher `clock.pause_at(...)`. In Python liest `pause_at` eine Zahl als
  Sekunden – ein `datetime` übergeben.
- **Keine fest verdrahteten Relays** – Im Browser-Test ersetzt Playwrights `route_web_socket` `window.WebSocket` –
  tote Relays mit einer Hülle per `Object.defineProperty` nachstellen.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **Browser-Tests mit eigenen TLS-Hosts:** HTTPS und WSS laufen in dieser
  Umgebung über den Agent-Proxy, auch mit `--no-proxy-server`. Eigene Hosts nur mit
  `launch(proxy={"server": HTTPS_PROXY, "bypass": "relay.test,app.test"})` plus
  `--host-resolver-rules=MAP relay.test 127.0.0.1`; mit gesetztem Proxy schickt
  Playwright auch 127.0.0.1 über den Proxy (405) – die App dann unter `app.test`
  ausliefern. `pkill -f` nie mit einem Muster, das im eigenen Befehl steht.
- **Räume im Browser-Test nur mit der Relay-Attrappe** (seit C.2b2):
  `ProbeRelay` (`scripts/smoke_test.py`) beantwortet jede REQ aus dem
  Probe-Raum, den `scripts/raum-probe.mts` mit Wegwerfschlüsseln signiert –
  nie echte Relays, nie echte Schlüssel. Den eigenen Schlüssel liest die
  Attrappe aus der Abfrage der eigenen Relay-Listen (Kind 10002, ein Autor);
  die App zeigt ihn nirgends ganz. Der Raum erscheint erst im Raum-Modus
  (`setzeKommModus("space")`), mobil nur mit `.showing-channel`.
  Private Räume (seit C-12, Smoke „privatraum“): zwei Browser, je eine Attrappe
  mit gemeinsamer Ereignisliste (`rb.events = ra.events`), den eigenen Schlüssel
  erst nach `#/chat` (Abgleich des Posteingangs). MLS nur mit Tresor
  (`tresor_an()`); eine Einladung oder Meldung kommt erst mit dem nächsten Abgleich –
  im Test über `entsperre_neu()`, nicht über den Abruftakt (60 s). Den Namen eines
  privaten Raums kennt die Leiste erst, wenn er einmal offen war.
- **Provider-Einrichtung nur geprüft** – Im Installer Eingaben nur als
  Argumente an `node` geben, nie in den Code einsetzen; Schlüsseldateien mit
  `umask 077` anlegen.
  *(Weitere Teile: `packages/node/CLAUDE.md`.)*
- **Smoke-Test auch in der CI** (seit C-18): Job „Browser-Test (Smoke)“ in
  `ci.yml` – Python-Playwright fest auf 1.56.0 (lokal dieselbe Version),
  Chromium mit `--with-deps`. Rot dort heißt rot wie ein Unit-Test; eine neue
  Prüfung vorher lokal laufen lassen und nie auf feste Pausen bauen, wo sich
  auf einen Zustand warten lässt (`wait_for_function` mit Frist) – der Runner
  ist langsamer als die Sitzung.
  Kontrast erst messen, wenn Einblendungen fertig sind (`ANIMATIONEN_FERTIG`,
  `document.getAnimations()`): Seiten und Unterreiter blenden sich über `opacity`
  ein (`fs-in`), mitten darin maß „zugang“ 2,92:1 (P5c2, beim Einmergen von `main`).
  Nach einem Upload zeichnet `ladeNip34Repos()` die Repo-Seite erst später neu – bis dahin
  zeigt „Code“ das alte, schon gelesene Bundle ohne „Code laden“ (A-30: im vollen Lauf
  gelegentlich rot, mit vierfach gedrosselter CPU immer). Auf den Knopf warten, nie klicken
  und hoffen. Nachstellen lässt sich Langsamkeit mit CDP `Emulation.setCPUThrottlingRate`.
  Ebenso nach dem Speichern der Repo-Einstellungen (C-40): erst veröffentlichen, dann `neuLaden()` –
  auf den neuen Link warten, nie eine feste Pause (800 ms reichten im CI-Runner zweimal nicht).
  Ebenso nach „Patch senden“ im Raum (VKb): erst senden, dann neu laden – auf die Patch-Liste warten; 800 ms reichten
  nicht, als der Rechner nebenher Knoten-Tests rechnete. Den Smoke-Test nie neben anderen schweren Läufen starten.
- **Meshtastic nur über `meshtastic.ts`** – Im Smoke-Test („meshtastic“) spielt eine Web-Serial-Attrappe das Gerät mit
  Bytes aus der Referenz. Die RNode (seit B-32b4, Teil „rnode“) spielt `RNODE_ATTRAPPE` – KISS wie `test/rnode-attrappe.ts`;
  sie zählt Datenrahmen, und „die App funkt von sich aus nichts“ heißt dort: 0 nach dem Verbinden.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`, `packages/node/CLAUDE.md`.)*
- **`check-wiring.py` ordnet Rümpfe nach Namen** (gefunden in B-35a): Deklarationen auf oberster Ebene zählen über alle
  Protokolldateien unter ihrem Namen. Ein privater Helfer mit dem Namen eines verdrahteten in einer anderen Datei (`Leser`
  gibt es in `ots.ts`, `meshtastic.ts`, `lnd-macaroon.ts`) macht alles „verdrahtet“, was er benutzt – die Ausnahme gilt dann
  als veraltet. Private Helfer eindeutig benennen (`NegLeser`). Ebenso zählt jeder Bezeichner in `scripts/` als Aufruf:
  Namen einer fremden Referenz dort über Zeichenketten ansprechen (`modul.exports["Negentropy"]`).
- **`check-wiring.py` und der Spread** (seit RM2b2): `BEZEICHNER` überging Namen nach einem Punkt – auch nach `...`. Ein
  Export, der nur als `...name(…)` aufgerufen wird (`tags.push(...cashuAngebotTags(c))`), galt als nicht verdrahtet. Der
  Selbsttest (`test_check_wiring.py`, `nachSpread`) hält das fest; `konfig.eigenschaft` bleibt eine Eigenschaft.
- **Stil-Abdruck** (seit C-56b, Smoke-Teil „stil_abdruck“): je Seite und Größe die Stile der Bausteine aus
  `docs/ausbau/BAUSTEINE.md`, verglichen mit `scripts/stil-soll.json`. Ändert sich das Design gewollt,
  `STIL_NEU=1 python3 scripts/smoke_test.py packages/app/dist` und die Datei mitcommiten, im Pull Request nennen;
  `BILDER=<ordner>` legt Bildschirmfotos zum Ansehen ab. Gemessen wird nur, was das CSS festlegt – Bildschirmfotos
  hingen von den Schriften des Rechners ab und wären in der CI rot, ohne dass sich etwas änderte.
  Seit C-57b je Design: dunkel ohne Vorsilbe, hell mit „hell/“.
- **Playwright meldet „hell“** (seit C-57b): Ohne `color_scheme` sieht die App im Smoke-Test das helle Design –
  wie jedes helle Gerät. Was ein Design braucht, setzt es ausdrücklich (`DialogSeite(…, farbschema="dark")`);
  „zugang“ und „stil_abdruck“ laufen in beiden.

- **Playwrights Uhr springt zurück** (gefunden in C-57c): Läuft die Uhr nach `clock.install()` in Echtzeit, kann ein
  Durchlauf der Timer, der vor `pause_at()` begann, nach einem `fast_forward()` enden und die Uhr auf seine alte Zeit
  zurücksetzen (`_advanceNow()` ohne Sperre) – der Timer, auf den man wartet, läuft dann nicht. Uhr vor der Handlung
  anhalten, die Startzeit in derselben Aufgabe messen (`() => { const t = Date.now(); …click(); return t; }`) und bis zu
  einer festen Zeit der Seite vorstellen, mit Nachsehen (`uhr_bis()` im Smoke-Teil „qr“) – nie nur Dauern addieren.
- **`WebSocketRoute.close()` nie im Handler von `route_web_socket`** (gefunden in B-34d): In der synchronen API wartet
  `close()` auf eine Antwort (anders als `send()`) – im Handler aufgerufen, hält es den ganzen Test an, ohne Fehler und
  ohne dass eine Frist greift. Eine Verbindung, die gleich scheitern soll, im Browser nachstellen: eine Hülle um
  `window.WebSocket` per `Object.defineProperty` (Getter und Setter – Playwright setzt seine eigene Fassung danach), wie
  `GRUPPENANRUF_ZAEHLER` für den SFU.
- **Tor-Brücken nur aus den Quellen** (seit B-33a, `pt-bauen.sh`): `snowflake-client` und WebTunnel-Client nur über
  `go install <modul>/<paket>@<version>` – go.mod und go.sum der Projekte gelten, nie ein eigenes go.mod mit `go get`
  (MVS könnte andere Fassungen wählen), nie Programme herunterladen. Go nur über `GO_FASSUNG` (`GOTOOLCHAIN`) und
  `setup-go` mit derselben Zahl; ändern nur zusammen und mit `--pruefen`. Mit `GOBIN` baut Go nicht für andere
  Plattformen – die Programme liegen dann unter `$GOPATH/bin/<os>_<arch>/`. Der Modul-Cache ist nur lesbar: vor dem
  Löschen `chmod -R u+w`, Dateien daraus nur mit `install -m 0644` kopieren – `cp` übernimmt den Schreibschutz, und das
  zweite Programm mit demselben Modul scheitert (CI rot, als root lokal nicht zu sehen; prüfen mit
  `setpriv --reuid=65534`). Ohne Lizenztext eines Moduls bricht der Bau ab.
  Android (seit B-33d) nur mit cgo gegen das NDK `NDK_FASSUNG` (gleich `NDK_VERSION` in `launcher.yml` und der Fassung in
  `tor-bruecken.yml` – ein Test der Hülle vergleicht): Ohne cgo fragt Go unter Android 127.0.0.1:53 (kein
  `/etc/resolv.conf`), und keine Brücke fände ihr Ziel – der Bau läuft trotzdem durch, man sieht es nur auf dem Gerät.
  Abschnitte mit `-z max-page-size=16384` (16-KB-Seiten). Ohne NDK bricht der Bau ab; zum Ausprobieren ohne NDK
  `PT_PLATTFORMEN="linux/amd64 windows/amd64"`. dl.google.com ist aus der Entwicklungsumgebung gesperrt – den Android-Bau
  zeigt erst die CI.
- **Im Browser-Test auf jedes Ergebnis einzeln warten** (seit VKg1b, Teil „projekt“): Antworten des Knotens kommen als
  Umschläge in beliebiger Reihenfolge (NIP-59) – wer nur auf den Abschluss wartet und danach die Ausgabe des Schritts liest,
  liest gelegentlich `null`. Vor jedem `evaluate` auf genau die Elemente warten, die es liest. Kommt ein Element trotz Warten nie (A-32:
  `.projekt-ausgabe summary`), liegt der Fehler in der App – dort suchen (`folgeLauf()` gab beim Ergebnis zurück, bevor es
  die Ausgabe derselben Abfrage verarbeitet hatte), nie die Frist verlängern.
