# FreedomStack – Übersicht

## Was es ist

FreedomStack ist ein Protokoll mit Referenz-App für drei Dinge ohne Betreiber:
**Nachrichten** über Nostr, **Zahlungen** über Lightning (Sats) und Solana (SOL)
und **KI-Anfragen**, die Provider gegen Bezahlung ausführen (NIP-90).

| Teil | Was er tut |
|---|---|
| Web-App (`packages/app`) | eine HTML-Datei: Agent/KI, Kommunikation (DMs, Räume), Währung (Wallets, Swaps), Earn, Profil, Settings |
| Protokoll (`packages/protocol`) | über 75 Module: Nostr, DVM, NIP-44/NIP-17, HTLC, Gebühren, Mesh, Nachfolge u. v. m. |
| Knoten (`packages/node`) | Provider-Daemon: KI-Aufträge, Abrechnung, Liquidität für Swaps, Relay- und Speicherrolle |
| Solana-Programm (`contracts/solana-htlc`) | Hash-Zeitschloss für Swaps Lightning ↔ SOL und SOL-Deposits |
| Website (`packages/website`) | Startseite, Whitepaper, FAQ, Roadmap, Dashboard – live unter https://3dagi.github.io/freedom-app/ |

## Die vier Ziele des Ausbaus

1. **Sats und SOL gleichwertig** – in jeder Funktion, in der Geld fließt.
2. **Offen und dezentral** – keine Stelle, die allein entscheidet, verwahrt oder abschaltet.
3. **Ende-zu-Ende-verschlüsselt** – Nachrichten, Anfragen und alle Metadaten über Zahlungen.
4. **Schritt für Schritt fertig** – verdrahtet, getestet, geprüft (siehe `CLAUDE.md`).

## Ehrliche Grenzen – gehören in App und Website

- **Blockchain-Einträge bleiben öffentlich.** Verschlüsseln lässt sich alles
  *über* eine Zahlung (Rechnung, Beleg, Zuordnung zur Identität); die Zahlung
  selbst lässt sich nur unverknüpfbar machen.
- **Der KI-Provider muss den Prompt lesen**, um zu rechnen. Mehr Schutz geht nur
  mit vertraulicher Hardware und Attestierung.
- **Die IP-Adresse** schützt nur eine Netzwerkschicht wie Tor – eine Web-App
  kann das nicht selbst herstellen, eine native App schon (Phase 6).
- **Keine Verschleierung von Zahlungen** (Mixer): Datenschutz ja, Verschleierung
  nein – wegen AMLR Art. 79.

## Der bisherige Weg

| Wann | Was |
|---|---|
| Juli bis September 2026 | Aufbau in vielen Arbeitsrunden mit Claude; Protokoll in `STATUS.md` |
| 20.09.2026 | erste Veröffentlichung auf GitHub Pages |
| 23.09.2026 | drei Prüfberichte (Kritische Analyse, Zweitgutachten, Gesamtbericht) und daraus der Ausbauplan |
| 24.09.2026 | **Phase 0** live: XSS geschlossen, Content-Security-Policy, ehrliche Texte, Prüfsumme; HTLC-Einlösefrist im Programmcode |
| 24.09.2026 | **0.C + 1.1** live: Einlösen nur mit 10 Minuten Sicherheitsabstand; Solana-Ableitung nach SLIP-10 |
| 24.09.2026 | **2.1** live: Direktnachrichten nach NIP-17, Siegelprüfung, Leak-Regeln, Datenschutzbericht nur mit belegten Aussagen |
| 24.09.2026 | **0.I** Quellcode öffentlich in `3dagi/freedom-app`; die Seite veröffentlicht nur noch `.github/workflows/pages.yml`, und nur mit grünen Tests |

Wichtigste Befunde der Prüfungen, die noch offen sind: KI-Prompts stehen im
Klartext auf den Relays (Schritt 3.1); der Reward-Pool ist zentral verwaltet
und beruht auf Selbstauskünften (Entscheidung 4.0, Umsetzung 5.1); der
Gebührenbeweis prüft keine Empfänger (4.8); Tor/Mixnetz ist nur eine
Relay-Sortierung (6.x); Rangliste aus Selbstauskunft (5.5).

## Wo was steht

| Datei | Inhalt |
|---|---|
| `STATUS.md` | vollständiges Entwicklungsprotokoll, neueste Abschnitte am Ende |
| `DEPLOY.md` | Devnet-Deploy und Website-Prüfsumme |
| `GO-LIVE.md` | ursprünglicher Go-Live-Plan |
| `docs/SCHLUESSEL.md` | alle Ableitungspfade |
| `docs/ausbau/FORTSCHRITT.md` | Stand aller Schritte |
| `docs/ausbau/phase-*.md` | Aufgabenkarten |
