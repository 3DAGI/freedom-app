# Vorlagen für Claude Code

## Erste Aufgabe (zum Einfügen)

> Lies `CLAUDE.md`, `docs/ausbau/UEBERSICHT.md` und `docs/ausbau/FORTSCHRITT.md`.
> Aufgabe: Schritt 2.1 abschließen. Führe `npm ci` und alle Prüfbefehle aus
> `CLAUDE.md` aus (Smoke-Test nur, wenn Playwright installierbar ist). Sind alle
> grün, setze 2.1 in `FORTSCHRITT.md` auf „fertig – wartet auf Interop-Test
> (MENSCH)“, schreibe einen kurzen Abschnitt in `STATUS.md` und öffne einen Pull
> Request mit dem Bericht nach `docs/ausbau/VORLAGEN.md`. Ändere keinen Code.

## Nächster Schritt

> Lies `CLAUDE.md` und `docs/ausbau/FORTSCHRITT.md`. Nimm den nächsten Schritt
> aus der empfohlenen Reihenfolge und die passende Karte in `docs/ausbau/`. Nur
> dieser eine Schritt. Halte dich an die Definition of Done und die
> STOPP-Regeln in `CLAUDE.md`. Am Ende: `FORTSCHRITT.md` und `STATUS.md`
> aktualisieren, Pull Request mit dem Bericht.

## Nach einer MENSCH-Aufgabe

> Die MENSCH-Aufgabe zu Schritt <ID> ist erledigt: <Ergebnis, z. B.
> Entscheidung, Pubkey, Ausgabe von `solana program show`>. Trage das in
> `FORTSCHRITT.md` ein und schließe Schritt <ID> nach seiner Karte ab.

## Bericht (Beschreibung des Pull Requests)

```markdown
## Schritt <ID> – <Titel>

### Was geändert wurde
- `<Datei>`: <was und warum>

### Verdrahtet
- Aufruf in `<Datei>:<Zeile>`

### Prüfungen
| Prüfung | Ergebnis |
|---|---|
| protocol | x grün, y übersprungen, 0 rot (vorher: z) |
| node | … |
| app | … |
| check-wiring / check-website | … |
| check_innerhtml | … |
| Smoke-Test | bestanden / nicht möglich (Grund) |

### Offen / MENSCH
- [ ] …

### Annahmen und Risiken
- …
```

## Commit-Nachricht

```
<ID>: <kurze Beschreibung auf Deutsch>

Warum: <ein bis zwei Sätze>
Was: <Stichpunkte>
Tests: <neue Tests, Ergebnis>
```
