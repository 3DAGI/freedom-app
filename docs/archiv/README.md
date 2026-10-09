# Archiv – nicht als heutigen Stand lesen

Diese Dateien beschreiben frühere Stände, Pläne und Analysen (Juli bis
September 2026). Sie bleiben zum Nachlesen, widersprechen dem Code aber an
vielen Stellen – etwa beim Gebührenmodell, bei den Sprachen der App oder bei
der Zahl der Tests. Verschoben mit C-22a und C-22c (Aufräumen, entschieden
07.10.2026).

Was heute gilt: `README.md`, `CLAUDE.md`, `docs/ausbau/` (Fortschritt und
Karten), `docs/neuordnung/SAMMLUNG.md` (Entscheidungen), `docs/PROTOCOL.md`
und die Website (`packages/website`).

| Datei | Was es war | Heute stattdessen |
|---|---|---|
| `AGENT_HANDOFF.md` | Übergabe an einen lokalen Agenten (Stand Juli 2026, war schon als veraltet markiert) | `CLAUDE.md`, `docs/ausbau/FORTSCHRITT.md` |
| `CHANGELOG-OPUS.md` | Änderungsliste früher Arbeitsrunden | `STATUS.md` |
| `ABSCHLUSSPRUEFUNG.md` | Durchsicht vor dem Start (26.09.2026) | `docs/ausbau/FORTSCHRITT.md`, `scripts/check-wiring.py` |
| `ANFANGEN.md`, `START-HIER.md` | Einstiege mit alten Zahlen | `README.md` |
| `START.md` | Weg zu den ersten Nutzern: Kanäle, Konten, Wortwahl | `GO-LIVE.md` (Checkliste); Kanäle und Worte nur hier |
| `LUECKEN.md` | „Was dem Protokoll noch fehlt“ – alles gebaut oder entschieden | `docs/neuordnung/SAMMLUNG.md` |
| `ANALYSIS.md`, `PROJECT-PLAN.md`, `UI-UPGRADE.md` | Analysen und Pläne vom August 2026 (u. a. acht Sprachen) | `docs/ausbau/` |
| `Whitepaper.md`, `dApp-Konzept.md`, `Techstack-Resistenz.md`, `Master-Whitepaper.md` | Konzeptpapiere (Juli 2026, altes Gebührenmodell) | Whitepaper der Website (`packages/website/whitepaper.html`) |
| `ANLEITUNG-INTEROP.md` | Anleitung zum NIP-17-Interop-Test aus 2.1 (bestanden, #1) – die Werkzeuge `scripts/interop/nip17-bot.mjs` und `nip17_ui_test.py` bleiben | `docs/ausbau/FORTSCHRITT.md` (2.1) |
| `website-DEPLOY.md` | Handanleitung für IPFS, Tor und ENS mit lokalen Pfaden (aus `packages/website/`) | Spiegel-Job in `pages.yml` (5.3), `docs/KONTEN.md` |
| `STATUS-2026-09.md` | Entwicklungsprotokoll bis September 2026, beginnt mit dem Bericht vom 29.08.2026 (verschoben mit C-22b) | `STATUS.md` (laufender Monat); weitere Monate verschiebt `scripts/status-archiv.py` hierher |
| `ROADMAP.md` | Offene Produktfragen R1–R3 | R1 und R2 als RM1 und RM2 in `docs/neuordnung/SAMMLUNG.md` (Abschnitt 5); R3 ist erledigt (Repository öffentlich, README, CI) bis auf die Lizenz (LIZ) |
