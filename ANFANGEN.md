# FreedomStack

**1.216 Tests, alle grün** — Protokoll 901 · Knoten 158 · App 157

## Womit anfangen

`START.md` — der Weg bis zu den ersten Nutzern, mit Befehlen und Adressen.

| Datei | Wofür |
|---|---|
| `GO-LIVE.md` | Checkliste, Abschnitt 0 zuerst |
| `ABSCHLUSSPRUEFUNG.md` | Stand vor dem Start |
| `STATUS.md` | Entwicklungsverlauf mit Begründungen |
| `README.md` | Technische Übersicht |

Die fertige App: `dist/freedom.html` — eine Datei, rund 2 MB.

## Prüfen

```bash
npm install --workspaces --include-workspace-root
cd packages/protocol && npm test && cd ../..
cd packages/node     && npm test && cd ../..
cd packages/app      && npm test && cd ../..
python3 scripts/check-wiring.py
python3 scripts/check-website.py
```

Ist hier etwas rot, erst das klären.

## Vor dem Start

1. **Anchor auf Devnet, dann Mainnet** — Programm und Client zusammen.
2. **`TRUSTED_SIGNERS`** in `packages/app/src/shell/app.ts` setzen.
3. **AMLR-Frage an den Anwalt** — ist die Firma ein CASP? Frist 10. Juli 2027.
