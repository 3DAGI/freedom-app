# Bausteine der Oberfläche

Stand 16.10.2026 (Schritt C-56a, Oberflächen-Review). Drei Spuren bauen an derselben App. Damit das Design nicht auseinanderläuft, entsteht neue Oberfläche aus diesen Bausteinen. Eine eigene Variante gibt es nur mit Grund im Pull Request.

| Baustein | Klasse / Helfer | Regel |
|---|---|---|
| Knopf | `button` (sekundär), `.primaer`, `.ghost` | Satzschreibung, Breite nach Inhalt (C-42b); grün (`.primaer`) höchstens einmal je Ansicht |
| Chip | `.chip`, `chip(text, gedrueckt, klasse)` in `shell/ui.ts` | umschaltbar nur mit `aria-pressed`; Filter, Auswahl, Wort-Chips |
| Karte | `.card` | Radius `--r-lg`; eine Karte je Thema |
| Zeile | `.einst-zeile` in `.einst-gruppe` | Titel und ein Satz, rechts Schalter oder Auswahl; die ganze Erklärung unter `details.einst-mehr` |
| Schalter | `input.schalter` mit `role="switch"` | statt Häkchen in Einstellungen; nie vorab an, wo Zustimmung nötig ist |
| Blatt | `.ai-optionen` (am Handy unten) | Optionen zu einer Eingabe |
| Popover | `oeffneMenueAn()` in `shell/menue.ts` (`.menue-schwebend`) | Menüs zu einem Knopf, Tasten und Esc wie in `menue.ts` |
| Toast | `toast(text, fehler)` in `shell/ui.ts` | kurze Rückmeldung; Fehler zusätzlich dort, wo sie entstanden; Vorleser hören sie über `#toast-ansage`/`#toast-alarm` (C-59) – nie ein eigenes Element mit eigener Uhr |
| Leerer Zustand | `leererZustand(symbol, satz, aktion)` | ein Satz und der nächste Schritt (C-45) |
| Skelett | `.skelett`, `skelett(zeilen, beschriftung)`; für einen einzelnen Wert `ladend(ziel)` (C-59) | statt „lädt …“ und statt „—“, solange ein Wert unterwegs ist – „—“ heißt nur „kein Wert“; ohne Bewegung bei „weniger Bewegung“ |
| Avatar | `avatar(pk, zeichen)` | Farbe aus dem Schlüssel (C-44) |

Abstände, Radien und Farben kommen nur aus den Tokens in `app.css` (`--r-sm`, `--r`, `--r-lg`, `--surf2`, `--line2`, `--accent` …), je mit einem hellen Wert (C-57b). Übergänge nur über die Keyframes `fs-pop`, `fs-blatt`, `fs-blende` (C-59), kürzer als 0,2 s und bei „weniger Bewegung“ aus.
