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
- **Zwei Designs** (seit C-57c): Die Website folgt dem Gerät (`prefers-color-scheme`), dieselben Werte wie die App.
  Jede Farbe nur als Token in `:root` UND im hellen Block von `css/style.css` – nie fest im übrigen CSS, im
  `<style>` einer Seite oder in `style="…"`. `check-website.py` (`farben_pruefen()`) meldet das samt Kontrast unter
  4,5:1 in beiden Designs; was beide teilen (Schatten, Fensterpunkte), steht in `FARBEN_BEIDE`.
- **Bild der App nur echt** (seit C-58a): Die Startseite zeigt die Agent-Seite aus dem Build, je Sprache und Design
  (`bilder/app-<de|en>-<dunkel|hell>.png`, 1200×760) – nie eine nachgestellte Szene oder ein Mock-up. Ändert sich die
  Agent-Seite sichtbar, `python3 scripts/website-bilder.py packages/app/dist packages/website/bilder` und die Bilder
  mitcommiten; `check-website.py` (`bilder_pruefen()`) prüft Größe, Alternativtext in beiden Sprachen und dass
  `build-site.sh` den Ordner auslegt. Die Vertrauenszeile nennt nur, was belegt ist, je mit Verweis auf den Beleg.
