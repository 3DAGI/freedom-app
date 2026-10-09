# Website (`packages/website`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter
`packages/website/` gelesen wird. Hier steht, was man nur auf der Website falsch macht
– verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag mit „Weitere
Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue Fallstricke dieses
Bereichs unten anhängen.

## Fallstricke

- **Ruf nur aus Quittungen** – Die Status-Seite der
  Website (seit 8.15) wertet nur über `website/js/dashboard-daten.js` aus:
  Angebote nach Erneuerung, Kataloge, Abdeckung über der Schwelle,
  Nennungen als Summe – nie 38010, nie 38075, keine Rangliste
  (`check-website.py` prüft das). Preise dort (seit C-3) in sats und SOL, SOL
  nur aus dem Kurs im Angebot (`lamportsAus()` wie `msatZuLamports()`).
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
- **Kein Vergleichen für Kunden** – Die FAQ der Website beschreibt Auswahl und Probezeit
  wie der Code; `check-website.py` weist „steht aber hinten“ und Aussagen über
  Prüfer (Messbericht, `PRUEFER=1`, Prüfern folgen) ab.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
