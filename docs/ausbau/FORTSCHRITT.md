# Fortschritt

Der Agent pflegt diese Liste nach jedem Schritt. Status: `offen`, `in Arbeit`,
`wartet auf MENSCH`, `teilweise`, `Code fertig`, `fertig`. Bei `fertig` den
Pull Request eintragen.

## Empfohlene Reihenfolge ab jetzt

1. **2.1 veröffentlichen:** Prüfungen grün, Pull Request offen – Merge (MENSCH danach: Interop-Test)
2. **0.H** instabilen Test reparieren – damit jede weitere Prüfung verlässlich ist
3. **0.B** innerHTML-Prüfung – Sicherheit
4. **1.4** Verdrahtungsprüfung erweitern
5. **1.0** `app.ts` aufteilen – macht alle weiteren Schritte kleiner und günstiger
6. **1.2**, **1.3**, Rest von **1.5**
7. **3.1** bis **3.4** – private KI-Aufträge, die größte offene Datenschutzlücke (braucht kein MLS)
8. **2.4**, **2.5**, dann **2.2a** (Entscheidung), **2.2b**, **2.3**
9. **4.0** (Entscheidung), dann Phase 4, Phase 5, 6, 7, 8, 9

MENSCH-Aufgaben aus Phase 0 (0.D, 0.E, 0.F-Teile, 0.G, 0.I) kann der Mensch
jederzeit parallel erledigen.

**Vor dem ersten Merge des Quellcodes nach `main` (MENSCH, 0.I):** unter
Settings → Pages die Quelle „GitHub Actions“ wählen und unter Settings →
General den Standard-Branch auf `main` stellen (bisher `master`, ein veralteter
Stand – neue Sitzungen würden sonst dort starten).

## Alle Schritte

| ID | Schritt | Status | Pull Request | Notiz |
|---|---|---|---|---|
| 0.A | Phase-0-Patch (XSS, CSP, Texte, Prüfsumme, HTLC-Frist im Code) | fertig |  | live seit 24.09. |
| 0.B | innerHTML-Prüfung und CI-Schritt | offen |  |  |
| 0.C | Einlösen mit Sicherheitsabstand (Client) | fertig |  | live seit 24.09. |
| 0.D | Signierte Releases | offen |  | MENSCH: Signierschlüssel |
| 0.E | Wallet-Erweiterungen unter CSP | offen |  | MENSCH |
| 0.F | Texte angleichen | offen |  | MENSCH: Firmenname, Marketing-Entwürfe |
| 0.G | Solana-Programm-ID abgleichen | offen |  | MENSCH: Entscheidung A/B |
| 0.H | Instabilen Knoten-Test reparieren | offen |  |  |
| 0.I | Veröffentlichung über GitHub Actions | wartet auf MENSCH |  | Quellcode im Repository (mit 2.1); MENSCH: Pages-Quelle „GitHub Actions“, Standard-Branch `main`; danach Agent: Live-Prüfsumme, alte Build-Dateien im Wurzelverzeichnis entfernen |
| 1.0 | app.ts aufteilen | offen |  | früh erledigen – spart bei allen späteren Schritten |
| 1.1 | Ein Seed, getrennte Schlüssel (SLIP-10) | fertig |  | Baustein; MENSCH: Phantom-Abgleich; Verdrahtung mit 4.2 |
| 1.2 | Verschlüsselter Speicher | offen |  |  |
| 1.3 | Signer-Schnittstelle | offen |  |  |
| 1.4 | Verdrahtungsprüfung erweitern | offen |  |  |
| 1.5 | Leak-Tests | teilweise |  | Regeln + Fakten + DM-Szenarien fertig; App-Szenarien offen |
| 2.1 | NIP-17-Direktnachrichten | fertig – wartet auf Interop-Test (MENSCH) |  | Prüfungen am 24.09. grün; MENSCH: Interop-Test mit Amethyst oder 0xchat |
| 2.2a | MLS: Entscheidung und Spike | offen |  | MENSCH: Entscheidung |
| 2.2b | MLS nach Marmot | offen |  | MENSCH: White Noise |
| 2.3 | Räume als MLS-Gruppen | offen |  |  |
| 2.4 | Verschlüsselte Anhänge | offen |  |  |
| 2.5 | Metadaten minimieren | offen |  |  |
| 3.1 | Verschlüsselte Job-Anfragen | offen |  | größte offene Datenschutzlücke |
| 3.2 | Verschlüsselte Antworten und Belege | offen |  |  |
| 3.3 | Provider-Seite | offen |  |  |
| 3.4 | Verlauf und Reklamationen privat | offen |  |  |
| 4.0 | Entscheidung Gebührenmodell | offen |  | MENSCH: Entscheidung |
| 4.1 | PaymentRail-Schnittstelle | offen |  |  |
| 4.2 | SOL-Wallet extern und eingebaut | offen |  | MENSCH: Devnet |
| 4.3 | Solana-Zahlkanal | offen |  | MENSCH: Devnet-Deploy |
| 4.4 | Preise und Kurse | offen |  |  |
| 4.5 | Verdienen in SOL | offen |  | MENSCH: Devnet |
| 4.6 | Swaps in beide Richtungen | offen |  | MENSCH: Devnet, Testnet |
| 4.7 | SOL-Trinkgeld | offen |  |  |
| 4.8 | Belege mit Empfängerprüfung | offen |  |  |
| 4.9 | Privatsphäre auf Solana | offen |  |  |
| 5.1 | Gebührenmodell umsetzen | offen |  |  |
| 5.1b | Gesponserte Pools | offen |  | MENSCH: Devnet-Deploy |
| 5.2 | Releases k-von-n | offen |  | MENSCH: Signierer |
| 5.3 | Hosting-Spiegel | offen |  | MENSCH: Konten |
| 5.4 | Relays: Outbox-Modell | offen |  |  |
| 5.5 | Reputation aus Quittungen | offen |  |  |
| 5.6 | Streitfall-Prüfer subjektiv | offen |  |  |
| 5.7 | Modellkataloge NIP-51 | offen |  |  |
| 5.8 | RPC-Vielfalt | offen |  |  |
| 5.9 | Programme und Quellcode | offen |  | MENSCH: Squads, Repository |
| 5.10 | Zeitanker und Abdeckungskarte | offen |  |  |
| 6.1 | Native Apps mit Tor | offen |  | MENSCH: Geräte |
| 6.2 | Ehrlicher PWA-Modus | offen |  |  |
| 6.3 | Lightning privat | offen |  |  |
| 6.4 | Verkehrsmuster | offen |  |  |
| 7.1 | Mesh nur verschlüsselt | offen |  |  |
| 7.2 | SOL offline (Durable Nonces) | offen |  | MENSCH: Funkgeräte |
| 7.3 | Sats offline – Hinweise | offen |  |  |
| 7.4 | KI über Funk-Gateway | offen |  |  |
| 8.1 | Onboarding | offen |  |  |
| 8.2 | Provider-Knoten | offen |  |  |
| 8.3 | Liquiditätsgeber | offen |  |  |
| 8.4 | Relay-Rolle | offen |  |  |
| 8.5 | Räume und Moderation | offen |  |  |
| 8.6 | Geräte und Schlüsselwechsel | offen |  |  |
| 8.7 | Agent und Werkzeuge | offen |  |  |
| 8.8 | Modelle | offen |  |  |
| 8.9 | Speicher | offen |  |  |
| 8.10 | Repositories | offen |  |  |
| 8.11 | Nachfolge | offen |  |  |
| 8.12 | Zustandssicherung | offen |  |  |
| 8.13 | Lokale Suche | offen |  |  |
| 8.14 | Notfall-Löschung | offen |  |  |
| 8.15 | Dashboard | offen |  |  |
| 8.16 | Übersetzungen | offen |  |  |
| 9.1 | Audit-Vorbereitung | offen |  | MENSCH: Auditoren |
| 9.2 | Devnet-Beta und Bug-Bounty | offen |  | MENSCH |
| 9.3 | Mainnet-Deploy | offen |  | MENSCH |
| 9.4 | Rechtliches und AI-Act-Hinweise | offen |  | MENSCH |
| 9.5 | Release 1.0 | offen |  | MENSCH |
