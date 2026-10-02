# innerHTML-Audit

Erzeugt mit `python3 scripts/check_innerhtml.py packages/app/src --ausnahmen scripts/innerhtml-ausnahmen.txt --markdown` – nicht von Hand bearbeiten.

Geprüft wird jede Zuweisung an `innerHTML`/`outerHTML` und jedes `insertAdjacentHTML` in `.ts`-Dateien: jeder Teil der rechten Seite, der im HTML landen kann. Sicher ohne Eintrag sind Literale, Vergleiche, Negationen und Schutzfunktionen (`escapeHtml`, `ganzeZahl`, `Math.*`, `Number`, `icon`, `t`). Alle übrigen Stellen stehen unten mit Begründung aus `scripts/innerhtml-ausnahmen.txt`; Fremddaten gehören nie dorthin.

Nicht abgedeckt: andere Eingänge wie `href` oder `src`, die per Eigenschaft gesetzt werden – die muss man beim Hinzufügen selbst prüfen.

| Datei | Zeile | Ausdruck | Bewertung |
|---|---|---|---|
| `packages/app/src/shell/einrichtung-ui.ts` | 58 | `inhalt(seite)` | feste Seiten der Einrichtung aus diesem Modul (8.1b); Fremddaten darin nur über escapeHtml (Werber-Schlüssel, Datenschutz-Aussagen) |
| `packages/app/src/shell/tresor.ts` | 96 | `html` | dialog() ist modulintern; alle drei Aufrufer übergeben feste Templates, deren einzige Einsetzungen escapeHtml(t(…)) sind (8.16g1); Eingaben und Meldungen laufen über textContent |
| `packages/app/src/shell/ui.ts` | 129 | `(Zuweisung) markSvg(18)` | eigenes SVG mit fester Farbe |
| `packages/app/src/shell/ui.ts` | 131 | `(Zuweisung) markSvg(30)` | eigenes SVG mit fester Farbe |

4 Fundstellen, davon 0 unbewertet.
