# MLS-Baustein (`packages/mls`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter `packages/mls/`
gelesen wird. Hier steht, was man nur im MLS-Baustein falsch macht – verschoben aus
der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag mit „Weitere Teile“ geht in
der Wurzel oder einem anderen Bereich weiter. Neue Fallstricke dieses Bereichs unten
anhängen.

## Fallstricke

- **MLS-Baustein** (seit 2.2b-a, `packages/mls`): `dist/` nie von Hand ändern –
  nur mit `bash packages/mls/bauen.sh` (fester MDK-Stand, `mdk.patch`,
  `Cargo.lock`); die CI baut nach und vergleicht (`mls.yml`). Die Engine sieht
  den Identitätsschlüssel nie: `beweisBruecke()` signiert nur den
  Marmot-Kontobeweis (Kind 450), `signerBruecke()` nur Siegel (Kind 13) der
  eigenen Identität. Der Zustand (`zustand()`, Megabytes) nur verschlüsselt
  ablegen. Aufrufe eines Kontos nicht verschränken – ein zweiter während eines
  laufenden wird mit „MLS beschäftigt“ abgewiesen.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
