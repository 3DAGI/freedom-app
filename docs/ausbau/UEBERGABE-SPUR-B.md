# Übergabe Spur B (Mesh und Bausteine) – Stand 02.10.2026

Für den nächsten Agenten in Spur B. Zuerst `CLAUDE.md`, dann diese Datei,
dann `docs/neuordnung/SAMMLUNG.md` (Zeilen B-1 bis B-20, Abschnitt 5 = offene
Entscheidungen). Spur B zuletzt: #263 (B-13c), diese Übergabe #264; `main`
ist seither durch Spur C weiter. Kein weiterer PR von Spur B ist offen.

## 1. Was fertig ist

| Punkt | Stand | PRs |
|---|---|---|
| B-1 bis B-8, B-10, B-15, B-19, B-20 | fertig | siehe FORTSCHRITT |
| B-9 „Mein Knoten“ | a, b1–b2, c1–c3 fertig (c3 nach L7 A) | #240, #252–#255, #272 |
| B-11 Knoten verwalten (nur lesen, L6 A) | a–c fertig (Status 5077, App, Einrichtung) | #256–#258 |
| B-12 Weckdienst (W1 A, W2 A, W3 A) | a–b fertig (Anmeldung 5078, Knoten weckt); **c–d offen** | #259, #260 |
| B-13 Anrufe (T1 A, T2 A, T3 B) | a–c fertig (TURN-Zugang 5079, coturn, Anruf-Aufbau 25040); **d offen** | #261–#263 |
| B-14 | entfällt (I1 B) | – |
| B-16 / B-17 / B-18 | später / wartet (Kalender) / wartet (Deploy Zahlkanal, MENSCH) | – |

Zahlen auf `main`:
- protocol 1164 (6 übersprungen)
- node 312 (7 übersprungen ohne Netz, mit Netz 313)
- app 808 (Stand #271 – Spur C zählt weiter, maßgeblich ist die Zeile „Stand …“ in CLAUDE.md)
- mls 13
- Leak 70 + 1 todo

Die Zeile „Stand …“ in CLAUDE.md ist aktuell.

## 2. Entschieden 02.10.2026 (MENSCH): W3 A, T3 B, L7 A – was zu bauen ist

**W3 → B-12c, B-12d** (A: `worker-src blob: 'self'` in der CSP von `packages/app/build.mjs`).

- **B-12c:**
  - Zweite Datei `dist/freedom-sw.js` aus `build.mjs`, nur Wecken: `push` → `showNotification` mit festem Text ohne Inhalt, `notificationclick` → App öffnen; kein Cache, kein `fetch`-Handler.
  - Mitziehen:
    - `scripts/build-site.sh` (kopieren, Prüfsumme);
    - `scripts/repro-build.sh` (beide Dateien vergleichen);
    - `.github/workflows/pages.yml` (Vergleich);
    - `scripts/publish-release.mjs` (Artefakt).
  - Der Spiegel braucht sie nicht.
  - Smoke-Test: Anmeldung auf `localhost`.
- **B-12d:**
  - **Haken in „Mein Knoten“:** nur gekoppelt und nur in sicherem Kontext (`verschluesselungMoeglich()`). Beim Klick:
    1. `Notification.requestPermission()`;
    2. `navigator.serviceWorker.register("freedom-sw.js")`;
    3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: status.weckSchluessel })` – den Schlüssel liefert die Statusabfrage (B-11);
    4. `baueWeckAnmeldung()` über `wegZumKnoten()` mit den Schlüsseln aus `sprichtFuer()` und `geraeteBuch.alle()`.
  - **Abmelden:** `aktion: "ab"`.
  - **Notfall-Löschung:** `loescheAllesLokal()` erweitern – Service Worker abmelden, Abo kündigen (Regel 8.14).
  - **Datenschutzbericht:** neue Aussage „Wecken“ (der Push-Dienst sieht, *dass* geweckt wird). Sie gehört nach `privacy-facts.ts` mit Szenario in `privacy-facts.test.ts` und braucht Texte in `datenschutz-bericht.ts`.
  - **Ausnahmen streichen:** `wecken.ts|baueWeckAnmeldung` und `|leseWeckAntwort` aus `scripts/wiring-ausnahmen.txt`.

**T3 → B-13d** (B: Die Anruferin gibt einen kurzlebigen Zugang zu ihrem TURN im versiegelten Angebot mit; die App warnt vor dem Annehmen).

- `anruf.ts` bekommt im Angebot ein optionales Feld `turn` (Form wie `leseTurnZugang()`). Das ist ein Format-Zusatz, also in `docs/PROTOCOL.md` §27 nachtragen.
- **App:**
  - `baueTurnAnfrage()` über `wegZumKnoten()` → `RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" })`.
  - Angebot, Antwort und Kandidaten über `baueAnrufNachricht()` an `sprichtFuer()` plus Geräte; empfangen über `oeffneAnrufNachricht()` am Ende der Kette in `oeffneUmschlag()`.
  - Nur Kontakte; Fingerabdruck und Sicherheitscode (B-4) anzeigen.
- **Leak-Regel „anruf-nur-relay“** über die inneren Events, dazu ein Test in `app/test/leak/`.
- **Ausnahmen streichen:** `anruf.ts|…` (3) und `turn-zugang.ts|…` (2) aus `wiring-ausnahmen.txt`.

**L7 → B-9c3 (fertig)** (A): ein Knopf „Relay meines Knotens übernehmen“ – das Relay aus `knotenRelay()` (`shell/knoten-weg-ui.ts`) über `setzeEigeneRelays()` als Schreib-Relay und Posteingang übernehmen; beide Listen veröffentlichen.

## 3. Was der MENSCH sonst tun muss

- GX10 auf `main` bringen. Benötigt:
  - `RELAY_ENABLED=1` und `RELAY_PUBLIC_URL` – „Alles über meinen Knoten“, Wecken;
  - `STORAGE_ENABLED=1` – Halten;
  - `APP_SHA256` – App vom Knoten.
- Anrufe: Installer mit `TURN_NAME=<öffentlicher-name>` erneut laufen lassen. Freigeben UDP/TCP 3478 und UDP 49160–49200, prüfen mit `turnutils_uclient`. coturn war in der Sitzung nicht erreichbar, also ungetestet.

## 4. Arbeitsweise, die sich bewährt hat (und Fallen)

- Ein Schritt = ein PR auf `claude/<branch>`. Vor dem Merge `main` holen; gemergt wird mit Merge-Commit, sobald CI grün ist.
- Neues Event-Format nur, wenn die Entscheidung es nennt. Exporte, die erst ein späterer Schritt verdrahtet, mit Begründung in `scripts/wiring-ausnahmen.txt` – und im Folgeschritt wieder streichen (`--streng` meldet veraltete).
- **Arbeitsbäume:** `git worktree add` im Scratchpad. Darin `node_modules` als **eigenes Verzeichnis** mit Links auf die Einträge des Haupt-Checkouts, aber `@freedomstack/*` → `../../packages/*` des Arbeitsbaums. Ein Link auf das ganze `node_modules` lädt sonst das Protokoll des Haupt-Checkouts.
  - **Nie `git add -A` auf Paketordner:** So kam am 02.10. ein Symlink `packages/node/node_modules` ins Repo, und CI scheiterte an `ENOTDIR`. `.gitignore` fängt das seit #254 ab.
  - Vor `git worktree remove` die Links löschen.
- **Übertragen** als Patch (`git diff` ohne `node_modules`) und mit `git apply --3way` auf `main`. Danach mit `git diff HEAD` prüfen, dass der Diff gleich dem geprüften ist.
- Neue Fallstricke stehen am Ende von CLAUDE.md, u. a.:
  - nie kurze Zeichenfolgen in Zufallsdaten suchen;
  - kein `${…:?}` in `docker-compose.yml`;
  - Umschläge sind bis zu zwei Tage zurückdatiert.
