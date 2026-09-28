# Phase 8 – Restliche Bausteine fertigbauen

Jeder Baustein ist ein eigener Schritt nach der Definition of Done, in dieser
Reihenfolge.

| ID | Baustein | Stellen | Aufgabe | Fertig, wenn | MENSCH |
|---|---|---|---|---|---|
| 8.1 | Onboarding | `onboarding.ts` | Seed, Sicherung, Passkey oder Passphrase, Standard-Schiene, private Voreinstellungen | ein Test-Durchlauf ohne Hilfe unter fünf Minuten bleibt | mit einer fremden Person testen |
| 8.2 | Provider-Knoten | `packages/node`, Installer, `docker-compose.yml` | Auszahlung in beiden Schienen, Tor, eigener Empfang statt verwahrender Dienste | ein neuer Provider in unter 30 Minuten in beiden Schienen verdient | mit einem echten Provider testen |
| 8.3 | Liquiditätsgeber | `lp-daemon.ts` | Tests (bisher keine), beide Swap-Richtungen, eingeschränkte Macaroon | beide Richtungen auf Devnet und Testnet inklusive Ablauf laufen | Testnet-Knoten |
| 8.4 | Relay-Rolle | `relay-role.ts` | Tests, bezahlter Zugang in Sats oder SOL | ein Relay nachweislich für Zustellung bezahlt wird | – |
| 8.5 | Räume und Moderation | `spaces.ts`, `moderation.ts` | nach 2.3 fertigstellen; private Meldungen; keine öffentliche Sperrliste | ein Raum mit 50 Mitgliedern entfernt ein Mitglied und der Schlüsselwechsel greift | – |
| 8.6 | Geräte und Schlüsselwechsel | `devices.ts`, `key-rotation.ts` | NIP-46 und Geräteschlüssel in der Oberfläche; Mandat vorab | Gerät entziehen und Diebstahl-Wechsel einmal vollständig durchgespielt | zweites Gerät |
| 8.7 | Agent und Werkzeuge | `packages/node/src/tools.ts`, `url-guard.ts`, `local-tools.ts` | Ausführung beim Provider in einer Sandbox; Kosten je Werkzeug in beiden Schienen | jedes Werkzeug hat einen Sandbox- und einen SSRF-Test | – |
| 8.8 | Modelle | `model-registry.ts` | Kataloge als NIP-51-Listen (5.7), Preise in beiden Einheiten | zwei Kataloge abonnierbar und vergleichbar | – |
| 8.9 | Speicher | `storage-role.ts`, `blob.ts` | nur verschlüsselte Dateien, Bezahlung in beiden Schienen | Datei nach Ausfall zweier Speicherknoten wiederhergestellt | – |
| 8.10 | Repositories | `git.ts`, `git-contributors.ts` | Tests (bisher keine), NIP-34, Radicle-Spiegel | ein Patch über NIP-34 angenommen | – |
| 8.11 | Nachfolge | `succession.ts` | Anteile verschlüsselt per Gift-Wrap an die Vertrauten; Grenzen offen benennen | Nachfolge mit drei Testkonten durchgespielt | – |
| 8.12 | Zustandssicherung | `state-backup.ts` | MLS-Zustand bewusst ausnehmen (Forward Secrecy); neue Geräte treten neu bei | Wiederherstellung ohne Klartext auf Relays | – |
| 8.13 | Lokale Suche | `local-search.ts` | Index verschlüsselt in IndexedDB | 10.000 Nachrichten flüssig durchsuchbar, nichts im Klartext | – |
| 8.14 | Notfall-Löschung | `duress.ts` | rechtlicher Hinweis direkt in der Funktion | Löschen entfernt nachweislich alle lokalen Daten | – |
| 8.15 | Dashboard | `packages/website/dashboard.html` | nur Quittungen und freiwillige Angaben | keine Selbstauskünfte mehr | – |
| 8.16 | Übersetzungen | `i18n.ts` | alle acht Sprachen vollständig oder weniger Sprachen | ein Test findet keinen fehlenden oder rohen Schlüssel | Muttersprachler prüfen |

## 8.16 Übersetzungen – Aufteilung

> **Entschieden 27.09.2026 (MENSCH): Variante B.** Deutsch und Englisch
> vollständig, alle Texte über Schlüssel; die sechs übrigen Sprachen fallen
> weg. In Teilschritten, je Bereich einer; `app/test/i18n.test.ts` zählt den
> rohen Text je Bereich und Datei (`i18n-offen.ts`) – fertige stehen auf 0.

- **8.16a – FERTIG:** Grundlage – nur `de`/`en`, Texte je Bereich in
  `app/src/texte/*.ts` (jeder Schlüssel mit beiden Sprachen, sonst meldet es
  der Compiler), `t()` mit Werten, `data-i18n-title`/`-aria`, Sprache aus der
  gespeicherten Wahl (nur, wenn es sie noch gibt) oder dem Browser; Tests für
  fehlende, unbenutzte und rohe Texte; Rahmen (Kopfzeile, Navigation, Start)
  fertig; das nie gezeigte Wallet-Gate entfernt; Smoke-Test prüft beide Sprachen.
- **8.16b – FERTIG:** Zählung im Code – `rohtexteImCode()` liest
  String-Literale samt verschachtelter Vorlagen; `app/test/i18n-offen.ts`
  hält je Bereich und je Datei, wie viel roher Text noch offen ist (neue
  Dateien: 0); `gebietsschema()` für Zahlen und Daten; ein Sprachwechsel
  zeichnet den offenen Tab neu.
- **Neu geplant (Messung 27.09.2026):** Es sind rund 1.300 Texte (1.069 im Code
  in 68 Dateien, 308 in `index.html`), nicht wie geschätzt 400–500. Mit der
  Grenze von etwa 400 geänderten Zeilen je Schritt heißt das rund zwölf statt
  sechs Teilschritte:
  - **8.16c – FERTIG:** Kommunikation (Seite, `tabs/kommunikation.ts`): rund
    130 Schlüssel `komm.*`; Daten eines öffentlichen Raums tragen `// kein UI-Text`.
  - **8.16d1 – FERTIG:** Agent – Seite (samt Modelle, Kataloge, Repos) und
    `tabs/agent.ts` über `agent.*`; eigene Meldungen als `EigeneMeldung`, damit
    `explainError()` sie nicht nach deutschen Mustern umdeutet; Beispiel-Prompts
    in der Sprache der Oberfläche.
- **Größere Schritte (MENSCH 27.09.2026):** Für die Übersetzung sind größere
  Pull Requests erlaubt – je Bereich einer statt je rund 400 Zeilen:
  - **8.16e – FERTIG:** Agent-Rest (`agent-netz.ts`, Streitfall, Prüfaufträge,
    Werkzeugpreise, Kataloge), Währung (Seite, `tabs/waehrung.ts`, eingebaute
    Wallet, offline zahlen, Zahlschienen) und alle Zahlwege und Swaps
    (`swap-client.ts`, `sol-htlc.ts`, `rueck-swap.ts`, `rails.ts`,
    `sol-wallet.ts`, Zap-Dialog, Belege, Preise, RPC-Stichprobe …) über
    `agent.*`, `waehr.*` und `zahl.*`. Deutsche Sätze des Protokolls
    (Verfügbarkeit der Modelle, Reklamationsgründe, Kurswarnungen,
    Zahlungshinweis, Prüfung vor dem Tausch) bildet die App aus den Feldern
    neu; der Prüfer hat eine Art (`kontakt`/`provider`), keinen Text.
  - **8.16f – FERTIG:** Earn, Profil und Settings (Seiten, `tabs/earn.ts`,
    `tabs/profil.ts`, `tabs/settings.ts`, `tabs/repos.ts`) – damit steht ganz
    `index.html` auf 0. Sätze des Protokolls zu Repo-Zustand, Abdeckung
    (Ebenen, „hier“, Einwilligung), Profil-Offenlegung, Bildwarnung, Aufgaben
    und Abzeichen bildet `protokoll-texte.ts` nach; ein Test hält die deutsche
    Fassung wortgleich mit dem Protokoll. `QuestProgress` hat dafür einen
    Zählerstand (`zaehler`).
  - **8.16g1 – FERTIG:** Einstieg und Dialoge über `ein.*` (`texte/einstieg.ts`):
    Führung (`onboarding.ts`), Start und Sicherung (`app.ts`), Identität,
    Tresor (`tresor.ts`, `vault.ts`), Nachfolge als Vertrauter, Notfall-Löschung,
    Bunker, Einrichtung, Zustand und UI-Hilfen (`state.ts`, `ui.ts`,
    `shell-logic.ts` samt Zeitangaben und Zahlen über `gebietsschema()`),
    Geräte, eigener Relay-Satz, Versand und Suche. Die Rückfrage vor der
    Notfall-Löschung bildet `protokoll-texte.ts` nach (`loeschRueckfrage()`,
    deutsch wortgleich mit `wipeConfirmation()`); bestätigt wird mit LÖSCHEN
    oder DELETE. Die Onboarding-Leiste folgt einem Sprachwechsel.
  - **8.16g2a – FERTIG:** übrige Bausteine über `bau.*` (`texte/bausteine.ts`):
    lokale Werkzeuge, Mesh (Funk, Bluetooth, Datei), MLS (Engine, Selbsttest,
    KeyPackage, Speicher, Konto), private Räume und die eigenen Hinweise im
    Datenschutzbericht; Shims tragen `// kein UI-Text` (Programmierfehler).
    Damit steht alles auf 0 und die Zählung ist streng – `i18n-offen.ts`
    entfällt. Kennungen einer Einladung bleiben Daten, die Anzeige übersetzt
    sie (`einladungsText()`); der Selbsttest erkennt fehlende
    Browser-Fähigkeiten an `BrowserKannNicht`, nicht am deutschen Text.
  - **8.16g2b1 – FERTIG:** Datenschutzbericht in der Sprache der Oberfläche
    (`datenschutz-bericht.ts`, Bereich `ds.*`): Befunde über eine feste
    Kennung (`PrivacyFinding.id`, neu im Protokoll), Aussagen über ihre
    Kennung; `berichtText()`, `faktenText()`, `faktAussage()` (auch für die
    Seite „privat“ der Einrichtung). Deutsch wortgleich mit
    `privacyReport()`/`privacyFactsText()` für alle Einstellungen und jedes
    Ergebnis der .onion-Prüfung; die deutschen Sätze des Berichts haben
    echte Umlaute.
  - **8.16g2b2 – FERTIG:** Sätze des Protokolls in Settings und im Chat über
    `protokoll-texte.ts` (Bereich `ps.*`): Nachfolge (Rückfrage, Stand),
    Sicherung (Info, gesichert, wiederhergestellt), Schlüsselwechsel
    (Rückfrage, Anleitung, Stand eines Kontakts), Geräte (Rückfrage, Rechte,
    Stand), Echtheit und Fixierung, Weitergabe, ohne Internet (Hinweis,
    Fähigkeiten, Wege), Tor-Reihenfolge. Das Protokoll liefert dafür
    zusätzliche Felder (`KeyState.streit`/`vorbereitet`,
    `RestoreResult.fehler`/`version`, `VerifyResult.fall`/`bestaetigt`/`noetig`);
    die Räume-Zeile der Offline-Fähigkeiten stimmt wieder (seit 2.3
    verschlüsselt, aber nicht über Mesh). Die Rohtext-Suche findet jetzt auch
    „Wort: …“ vor einer Einsetzung und Text mit „…“ – so kamen acht
    übersehene Stellen ans Licht (Mesh-Protokollzeilen, Git-Bündel, Modellwahl,
    Anhang-Fehler).
  - **8.16g2b3:** Gründe aus Prüfungen des Protokolls, die die App noch
    unverändert zeigt – rund 90 Sätze, deshalb geteilt:
    - **8.16g2b3a – FERTIG:** Geld und Netz. Die Prüfungen liefern zusätzlich
      eine Kennung `fall` (samt Zahlen), die App bildet daraus den Text
      (`protokoll-texte.ts`, Bereich `pg.*`): Fristen
      (`validateReverseTimelock`, `validateTimelockOrdering`), Relay-Auftrag
      (`pruefeRelayAuftrag`), Offline-Überweisung (`pruefeOfflineUeberweisung`
      samt `pruefeSolanaTx`), Mesh-Inhalt (`pruefeMeshInhalt`), Überweisung
      auf der Kette (`pruefeSolUeberweisung`), RPC-Stichprobe
      (`StichprobeErgebnis.befunde`/`luecken`). `claimAllowed` war schon
      übersetzt (App-Code).
    - **8.16g2b3b – FERTIG:** Mesh und Vertrauen. Kennung `fall` für
      Relay-Adressen (`isPlausibleRelayUrl`), Geräteprüfung
      (`checkDeviceEvent`, `absenderPerson`, samt Recht), Übergabe in der
      Nachfolge (`darfUebergeben`, samt Stand) und Funk (`meshFeasibility`);
      Abgleich (`planSync().note`) und Reklamationsfrist
      (`disputeWindowOpen`) bildet die App aus den Feldern; ausgeblendet ohne
      Grund heißt „ohne Grund“. `SYNC_POLICY` sagt zu Räumen jetzt die
      Wahrheit (private verschlüsselt, aber nicht über Mesh). Übersprungene
      Gründe von `planSync()` und `resolveDispute().message` zeigt die App
      nicht – sie bleiben deutsch im Protokoll.
    - Gründe, die ein Relayer selbst schickt, bleiben dessen Text.
  - **8.16h – FERTIG:** mit 0.F – Texte der Website an den Code angeglichen
    (Karte `phase-0.md`, 0.F): Sprachwahl der Startseite nur Deutsch und
    Englisch; Code-Links aufs Repository; Downloads und 1-Klick-Launcher als
    „geplant“; interne GX10-Notizen weg; Knoten-Anleitung mit echtem
    Repository, `npm ci` und eingeschränkter Macaroon (mit `admin.macaroon`
    startet der LP seit 8.3 nicht); die drei Einnahmen, die der Knoten kennt
    (KI-Aufträge, LP-Gebühr, Relay-Zugang); weitere Bezugsquellen „vorbereitet“
    statt „an mehreren Orten“ (5.3: noch Platzhalter); „Das Solana-Programm
    wird unveränderlich gemacht“; „Der Kern in Kürze“; KI über Funk gut eine
    Stunde Sendezeit statt „Stunden“ (nachgerechnet, auch in App und
    Protokoll). `check-website.py` weist die alten Aussagen ab (`UNGEDECKT`).
  - **8.16i:** Fehlermeldungen, die das Protokoll wirft und die App über
    `(e as Error).message` zeigt (z. B. „Kein Solana-Endpunkt erreichbar“) –
    rund 270 deutsche Sätze in 72 Dateien, nur ein Teil erreicht die
    Oberfläche; erst messen, dann je Bereich.
  - **Offen (MENSCH):** Die Website ist außer der Startseite (Kopf, Merkmale)
    nur deutsch – soll sie ganz auf Englisch kommen? Durchsicht der englischen
    Texte durch eine Muttersprachlerin oder einen Muttersprachler.
