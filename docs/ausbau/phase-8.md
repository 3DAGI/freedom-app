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
