# Übergabe Spur B (Mesh und Bausteine) – Stand 02.10.2026

Für den nächsten Agenten in Spur B. Zuerst `CLAUDE.md`, dann diese Datei,
dann `docs/neuordnung/SAMMLUNG.md` (Zeilen B-1 bis B-20, Abschnitt 5 = offene
Entscheidungen). Spur B zuletzt: B-13d3 (Anrufe: Oberfläche) – damit sind alle
entschiedenen Punkte der Spur fertig. Offen ist nur, was auf den MENSCHEN oder
Spur A wartet (Abschnitt 3).

## 1. Was fertig ist

| Punkt | Stand | PRs |
|---|---|---|
| B-1 bis B-8, B-10, B-15, B-19, B-20 | fertig | siehe FORTSCHRITT |
| B-9 „Mein Knoten“ | a, b1–b2, c1–c3 fertig (c3 nach L7 A) | #240, #252–#255, #272 |
| B-11 Knoten verwalten (nur lesen, L6 A) | a–c fertig (Status 5077, App, Einrichtung) | #256–#258 |
| B-12 Weckdienst (W1 A, W2 A, W3 A) | fertig (Anmeldung 5078, Knoten weckt, Weck-Worker `freedom-sw.js`, Notfall-Löschung, Haken „Wecken“) | #259, #260, #273–#275 |
| B-13 Anrufe (T1 A, T2 A, T3 B, T4 A) | fertig (TURN-Zugang 5079, coturn, Anruf-Aufbau 25040, `turn` im Angebot, Logik `shell/anruf.ts`, Oberfläche `shell/anruf-ui.ts`, Datenschutz „anruf-ip“/„anruf-vermittler“; e: Abo für Anrufe, 3 min klingeln) | #261–#263, #276–#278, #297 |
| B-14 | entfällt (I1 B) | – |
| B-16 / B-17 / B-18 | später / nach Freigabe der Kalender bauen (04.10.) / wartet (Deploy Zahlkanal, MENSCH) | – |
| B-21 Überholtes entfernen (04.10.) | fertig: `merge.ts`, `mesh.ts` (38030/38031 nicht mehr belegt), `decrementTtl`, Ablauf in `state-backup.ts` | #298 |
| Phase 12 (E5, 04.10.) | Logik Spur A, Oberfläche Spur C – nicht Spur B | – |

Zahlen auf `main`:
- protocol 1160 (6 übersprungen)
- node 312 (7 übersprungen ohne Netz, mit Netz 313)
- app 855 (Spur C zählt weiter, maßgeblich ist die Zeile „Stand …“ in CLAUDE.md)
- mls 13
- Leak 72 + 1 todo

Die Zeile „Stand …“ in CLAUDE.md ist aktuell.

## 2. Entschieden 02.10.2026 (MENSCH): W3 A, T3 B, L7 A – was zu bauen ist

**W3 → B-12c, B-12d** (A: `worker-src blob: 'self'` in der CSP von `packages/app/build.mjs`).

- **B-12c (fertig):**
  - Zweite Datei `dist/freedom-sw.js` aus `build.mjs`, nur Wecken: `push` → `showNotification` mit festem Text ohne Inhalt, `notificationclick` → App öffnen; kein Cache, kein `fetch`-Handler.
  - Mitziehen:
    - `scripts/build-site.sh` (kopieren, Prüfsumme);
    - `scripts/repro-build.sh` (beide Dateien vergleichen);
    - `.github/workflows/pages.yml` (Vergleich);
    - `scripts/publish-release.mjs` (Artefakt).
  - Der Spiegel braucht sie nicht.
  - Smoke-Test: Anmeldung auf `localhost`.
  - Umgesetzt mit `--vergleiche-ordner` (repro) und der Sprache aus `?sprache=` der Worker-Adresse.
  - Vom Knoten ausgeliefert (B-10) fehlt der Worker – B-12d muss das ehrlich sagen (oder `app-auslieferung.ts` liefert ihn mit Summe mit).
- **B-12d (fertig: d1 #274, d2 #275):**
  - **Haken in „Mein Knoten“:** nur gekoppelt und nur in sicherem Kontext (`verschluesselungMoeglich()`). Beim Klick:
    1. `Notification.requestPermission()`;
    2. `navigator.serviceWorker.register("freedom-sw.js?sprache=" + getLang())`;
    3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: status.weckSchluessel })` – den Schlüssel liefert die Statusabfrage (B-11);
    4. `baueWeckAnmeldung()` über `wegZumKnoten()` mit den Schlüsseln aus `sprichtFuer()` und `geraeteBuch.alle()`.
  - **Abmelden:** `aktion: "ab"`.
  - **Notfall-Löschung (fertig, B-12d1):** `weckerAbmelden()` kündigt Abos und meldet Worker ab. In d2 den Test „keine Speicherart“ (`notfall.test.ts`) so ändern, dass `serviceWorker.register(` nur im neuen Modul steht.
  - **Datenschutzbericht:** neue Aussage „Wecken“ (der Push-Dienst sieht, *dass* geweckt wird). Sie gehört nach `privacy-facts.ts` mit Szenario in `privacy-facts.test.ts` und braucht Texte in `datenschutz-bericht.ts`.
  - **Ausnahmen streichen:** `wecken.ts|baueWeckAnmeldung` und `|leseWeckAntwort` aus `scripts/wiring-ausnahmen.txt`.

**T3 → B-13d** (B: Die Anruferin gibt einen kurzlebigen Zugang zu ihrem TURN im versiegelten Angebot mit; die App warnt vor dem Annehmen).

- **d1 (fertig):** `anruf.ts` hat im Angebot ein optionales Feld `turn` (Form wie `leseTurnZugang()`). Das ist ein Format-Zusatz, also in `docs/PROTOCOL.md` §27 nachtragen.
- **App:**
  - `baueTurnAnfrage()` über `wegZumKnoten()` → `RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" })`.
  - Angebot, Antwort und Kandidaten über `baueAnrufNachricht()` an `sprichtFuer()` plus Geräte; empfangen über `oeffneAnrufNachricht()` am Ende der Kette in `oeffneUmschlag()`.
  - Nur Kontakte; Fingerabdruck und Sicherheitscode (B-4) anzeigen.
- **Leak-Regel „anruf-nur-relay“** über die inneren Events, dazu ein Test in `app/test/leak/`.
- **Ausnahmen (erledigt in d2):** `anruf.ts|…` (3) und `turn-zugang.ts|…` (2) gestrichen.
- **d3 (fertig):** Knöpfe im Kopf der Unterhaltung (nur 1:1), Leiste mit Sicherheitscode (B-4) und Hinweis bei `fremderVermittler` vor dem Annehmen, Auflegen, Audio-/Video-Elemente; Datenschutz „anruf-ip“ (belegt) und „anruf-vermittler“ (Grenze). Smoke „anruf“ mit einem Browser und `scripts/anruf-probe.mts` statt eines zweiten Browsers (Signalweg bis „Ende“; Medien brauchen echten TURN).

**L7 → B-9c3 (fertig)** (A): ein Knopf „Relay meines Knotens übernehmen“ – das Relay aus `knotenRelay()` (`shell/knoten-weg-ui.ts`) über `setzeEigeneRelays()` als Schreib-Relay und Posteingang übernehmen; beide Listen veröffentlichen.

## 3. Was der MENSCH sonst tun muss

- GX10 auf `main` bringen. Benötigt:
  - `RELAY_ENABLED=1` und `RELAY_PUBLIC_URL` – „Alles über meinen Knoten“, Wecken;
  - `STORAGE_ENABLED=1` – Halten;
  - `APP_SHA256` – App vom Knoten.
- Anrufe: Installer mit `TURN_NAME=<öffentlicher-name>` erneut laufen lassen. Freigeben UDP/TCP 3478 und UDP 49160–49200, prüfen mit `turnutils_uclient`. coturn war in der Sitzung nicht erreichbar, also ungetestet.
- Anrufe durchgehend prüfen (MENSCH-Checkliste): zwei Geräte mit je gekoppeltem Knoten und coturn – Ton und Bild; dann eines ohne Knoten – Hinweis vor dem Annehmen, Anruf über den Knoten des Anrufers.
- Offen in Spur B nur noch: B-16 (später), B-17 ✓ (K1–K5 A entschieden 06.10.; a, b1, b2, b3a, b3b), B-18 (wartet auf den Deploy des Zahlkanals) und 11.5 (mit Spur A nach 11.3).
- Anrufe verpasst (T4): entschieden 04.10. A – Abo für Anrufe, solange die App offen ist, und 3 min Klingeln (B-13e).
- B-17: Kalender seit 06.10. erreichbar; B-17a ✓ (Baustein `ots.ts`). K1–K5 A (MENSCH 06.10.). B-17b1 ✓ (`ots-kalender.ts`: stempeln, nachreichen; `ots-nip03.ts`: Kind 1040), B-17b2 ✓ (`ots-bitcoin.ts`: Prüfung gegen den Blockkopf zweier Explorer). B-17b3a ✓ (`zeitanker.ts`, `shell/zeitanker-takt.ts`: App stempelt Mandate und Quittungen, NIP-03 zum Mandat). B-17b3b ✓ (`mandat-anker.ts`, `ankerFuerStreit()` in `aktualisiereSchluessel()`): bei Streit um einen Nachfolger entscheidet der geprüfte Anker. B-17 ist fertig.

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
