# Fortschritt

Der Agent pflegt diese Liste nach jedem Schritt. Status: `offen`, `in Arbeit`,
`wartet auf MENSCH`, `teilweise`, `Code fertig`, `fertig`. Bei `fertig` den
Pull Request eintragen.

## Empfohlene Reihenfolge ab jetzt

1. ~~2.1 veröffentlichen~~ – live seit 24.09.; Interop-Test ✅ (5/5 lib, UI lokal + public)
2. ~~**0.H** instabilen Test reparieren~~ – erledigt
3. ~~**0.B** innerHTML-Prüfung~~ – erledigt
4. ~~**0.J** Event-Felder streng prüfen~~ – erledigt
5. ~~**1.4** Verdrahtungsprüfung erweitern~~ – erledigt
6. ~~**1.0** `app.ts` aufteilen~~ – Code fertig in fünf Teilen (a–e); offen nur MENSCH: alle Tabs anklicken, Desktop und Handy
7. ~~**1.2**~~ Code fertig (a–d; Passkey optional zurückgestellt; MENSCH: Handy/Desktop, Devnet), dann **1.3** in Arbeit (a Signer + LocalSigner ✓, b Nip46Signer, c… Aufrufer umstellen), Rest von **1.5**
8. **3.1** bis **3.4** – private KI-Aufträge, die größte offene Datenschutzlücke (braucht kein MLS)
9. **2.4**, **2.5**, dann **2.2a** (Entscheidung), **2.2b**, **2.3**
10. **4.0** (Entscheidung), dann Phase 4, Phase 5, 6, 7, 8, 9

MENSCH-Aufgaben aus Phase 0 (0.D, 0.E, 0.F-Teile, 0.G) kann der Mensch
jederzeit parallel erledigen.

## Alle Schritte

| ID | Schritt | Status | Pull Request | Notiz |
|---|---|---|---|---|
| 0.A | Phase-0-Patch (XSS, CSP, Texte, Prüfsumme, HTLC-Frist im Code) | fertig |  | live seit 24.09. |
| 0.B | innerHTML-Prüfung und CI-Schritt | fertig | [#4](https://github.com/3DAGI/freedom-app/pull/4) | Prüfskript liest jetzt die ganze rechte Seite; 12 Stellen abgesichert, 100 begründet; CI und `pages.yml` streng |
| 0.C | Einlösen mit Sicherheitsabstand (Client) | fertig |  | live seit 24.09. |
| 0.D | Signierte Releases | offen |  | MENSCH: Signierschlüssel |
| 0.E | Wallet-Erweiterungen unter CSP | offen |  | MENSCH |
| 0.F | Texte angleichen | offen |  | MENSCH: Firmenname, Marketing-Entwürfe |
| 0.G | Solana-Programm-ID abgleichen | offen |  | MENSCH: Entscheidung A/B |
| 0.H | Instabilen Knoten-Test reparieren | fertig | [#3](https://github.com/3DAGI/freedom-app/pull/3) | Ursache: Frist zweimal aus der Uhr berechnet; 120 Läufe am Stück grün |
| 0.I | Veröffentlichung über GitHub Actions | fertig | [#1](https://github.com/3DAGI/freedom-app/pull/1), [#2](https://github.com/3DAGI/freedom-app/pull/2) | live seit 24.09. über `pages.yml`; Prüfsumme Datei = `freedom.html.sha256` = Startseite; Standard-Branch `main` |
| 0.J | Event-Felder streng prüfen | fertig | [#6](https://github.com/3DAGI/freedom-app/pull/6) | Freigabe 24.09.; `verifyEvent()` prüft die Form nach NIP-01; dazu Hashlock-Prüfung im LP-Daemon |
| 1.0 | app.ts aufteilen | Code fertig | [#8](https://github.com/3DAGI/freedom-app/pull/8) (a), [#9](https://github.com/3DAGI/freedom-app/pull/9) (b), [#10](https://github.com/3DAGI/freedom-app/pull/10) (c), [#11](https://github.com/3DAGI/freedom-app/pull/11) (d), #12 (e) | `app.ts` 5.816 → 792 Zeilen; `state.ts`, `ui.ts`, `datenschutz.ts`, `tabs/` (kommunikation, agent, agent-netz, waehrung, earn, profil, settings); größte Datei `agent.ts` 1.376 Zeilen; MENSCH: alle Tabs anklicken, Desktop und Handy |
| 1.1 | Ein Seed, getrennte Schlüssel (SLIP-10) | fertig |  | Baustein; MENSCH: Phantom-Abgleich; Verdrahtung mit 4.2 |
| 1.2 | Verschlüsselter Speicher | Code fertig | [#13](https://github.com/3DAGI/freedom-app/pull/13) (a), [#14](https://github.com/3DAGI/freedom-app/pull/14) (b), [#15](https://github.com/3DAGI/freedom-app/pull/15) (c), #16 (d) | `vault.ts` (AES-GCM 256, PBKDF2-SHA256 600.000, IndexedDB); Entscheidung „erst benutzen, dann einrichten“ (24.09.): Sicherheitsliste Schritt 5 + Führung, Entsperren beim Start, „Passphrase vergessen“; alle Geheimnisse (Schlüssel, NWC, Preimages, Chats, Verläufe) geprüft übernommen; Tresor-Pflicht vor Wallet/Swap/Deposit; automatische Sperre 15 Min (einstellbar, nie während Geldvorgang/Auftrag); Smoke-Test mit Speicher-Scan und gesteuerter Uhr. Passkey (optional) zurückgestellt. MENSCH: Entsperren auf Handy/Desktop, „vergessen“ mit 12 Wörtern, Swap/Deposit auf Devnet |
| 1.3 | Signer-Schnittstelle | in Arbeit | #17 (a) | a: `protocol/src/signer.ts` (Signer, SolanaSigner, LocalSigner), `state.signer` bei jeder Identität; Entscheidung 24.09.: Nip46Signer neu nach NIP-46 (Karte nannte `devices.ts`, dort gibt es keine Teile); b Nip46Signer, c… Aufrufer umstellen (`keypair.sk` heute 46 Stellen in 11 Dateien) |
| 1.4 | Verdrahtungsprüfung erweitern | fertig | [#7](https://github.com/3DAGI/freedom-app/pull/7), [#8](https://github.com/3DAGI/freedom-app/pull/8) | alle Exporte, Erreichbarkeit aus App/Knoten; Nachtrag in #8: Regex-Literale; 176 von 427 nicht verdrahtet, begründet in `scripts/wiring-ausnahmen.txt` |
| 1.5 | Leak-Tests | teilweise |  | Regeln + Fakten + DM-Szenarien fertig; App-Szenarien offen |
| 2.1 | NIP-17-Direktnachrichten | ✅ fertig + Interop-Test bestanden | [#1](https://github.com/3DAGI/freedom-app/pull/1) | 5/5 lib, UI lokal + public Relays grün |
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
