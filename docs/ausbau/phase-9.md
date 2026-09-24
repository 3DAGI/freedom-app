# Phase 9 – Audit und Mainnet

Hier arbeitest du vor allem zu; entscheiden und ausführen tut der Mensch.

## 9.1 Audit-Vorbereitung

- **Du:** `docs/BEDROHUNGSMODELL.md` (wer greift wie an, was schützt wogegen, was
  bewusst nicht), Audit-Umfang je Programm und Modul, eingefrorener Stand (Git-Tag),
  Testabdeckung, bekannte Grenzen.
- **MENSCH:** Auditoren beauftragen – beide Solana-Programme, die MLS-Integration
  (falls ts-mls), Tresor, Ableitungen, Gift-Wrap-Pfad.

## 9.2 Öffentliche Devnet-Beta und Bug-Bounty

- **Du:** `SECURITY.md` mit verschlüsseltem Meldeweg, Umfang und Regeln.
- **MENSCH:** Beträge festlegen (Sats und SOL), Beta ankündigen.

## 9.3 Mainnet-Deploy

- **Du:** Deploy-Skripte und Checklisten; Überwachung (Kontostände, Fehlerraten);
  Rücknahmeplan.
- **MENSCH:** Deploy mit Squads-Mehrfachsignatur und Zeitverzögerung als
  Upgrade-Recht; nach der angekündigten Frist ohne Befund `--final`.

## 9.4 Rechtliches

- **MENSCH:** CASP-Einordnung nach AMLR (Frist 10. Juli 2027), steuerliche
  Erfassung der App-Gebühr, Impressum.
- **Du:** AI-Act-Transparenz nach Art. 50 umsetzen: Hinweis im Chat, dass ein
  KI-System antwortet; C2PA-Metadaten bei erzeugten Bildern und Videos.

## 9.5 Release 1.0

- k-von-n signiert (5.2), über alle Spiegel verteilt (5.3), reproduzierbar gebaut
  (5.9), Prüfsumme an drei Orten.
- **Abnahme:** Ein fremder Nutzer lädt die App, prüft ihre Echtheit, bezahlt in
  Sats und in SOL und schreibt privat – und der Datenschutzbericht behauptet
  nichts, was kein Leak-Test belegt.
