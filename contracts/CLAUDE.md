# Solana-Programme (`contracts`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter `contracts/`
gelesen wird. Hier steht, was man nur in den Solana-Programmen falsch macht –
verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag mit „Weitere
Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue Fallstricke dieses
Bereichs unten anhängen.

## Fallstricke

- **Anchor-Fehler-Enum:** neue Varianten nur ANS ENDE – Fehlercodes dürfen sich nicht verschieben.
- **Zahlkanal nur nach `docs/ZAHLKANAL.md`** – Bauen und
  testen nur mit `contracts/solana-channel/pruefen.sh` (Agave 3.1.10,
  platform-tools v1.52; ältere scheitern an der Lock-Datei); die CI
  (`zahlkanal.yml`) tut dasselbe, Überspringen gilt dort als Fehler. In
  Validator-Tests Ed25519 deterministisch: dieselbe Gutschrift zweimal ist
  dieselbe Transaktion – mit eigenem Rechenlimit je Versuch unterscheiden.
  Auf Bestätigungen nur über `solangeValidator()` warten: Stirbt der
  Validator, wartet web3.js sonst endlos (`getBlockHeight` zählt als -1).
  Den Websocket am Ende mit `setAutoReconnect(false)` schließen – sonst
  verbindet er endlos neu, und der Job läuft bis zu seinem Limit.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
- **`declare_id!` ist die Adresse auf der Kette** (seit 4.3e): Anchor vergleicht
  sie bei jedem Aufruf mit der Adresse, an der das Programm liegt – eine Binary
  mit einer anderen ID lehnt dort alles ab (4100, `DeclaredProgramIdMismatch`).
  „Ausführbar“ (`ausfuehrbar()`, `programmBereit()`) sagt darüber nichts; ob ein
  Deploy taugt, zeigt nur eine Simulation. So lag der Zahlkanal am 09.10.2026 auf
  Devnet und nahm keinen Aufruf an, ebenso der HTLC an `3UmRR…`. Erst die ID
  eintragen, dann bauen, dann deployen – nie umgekehrt.
