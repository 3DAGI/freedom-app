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
- **Meshtastic nur über `meshtastic.ts`** – Im Smoke-Test („meshtastic“) spielt eine Web-Serial-Attrappe das Gerät mit
  Bytes aus der Referenz.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`, `packages/node/CLAUDE.md`.)*
