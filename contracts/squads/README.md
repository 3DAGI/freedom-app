# Kasse über Squads v4 (A-12)

Hier liegen nur Tests. Squads v4 (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`) ist
ein fremdes Programm unter AGPL-3.0. Sein Code und seine Binärdatei kommen nicht ins Repo.
Den Baustein, der es aufruft, enthält `packages/protocol/src/kasse.ts`. Die Anweisungen sind nach der IDL
gebaut, ohne SDK (Entscheidung W1 B in [`docs/KASSE-ENTWURF.md`](../../docs/KASSE-ENTWURF.md)).

```bash
bash contracts/squads/pruefen.sh              # Agave 3.1.10 im PATH
bash contracts/squads/pruefen.sh --werkzeuge  # lädt Agave 3.1.10 vorher
```

`pruefen.sh` holt das Programm von Mainnet und von Devnet mit `solana program dump` nach
`~/.cache/freedom-solana/squads/`. Es nimmt es nur mit der Prüfsumme, die im Skript steht.
Danach lässt es `tests/kasse.test.ts` gegen beide laufen, je in einem lokalen
`solana-test-validator` – Anlegen (A-12a1) und Auszahlen (A-12a2): vorschlagen, abstimmen,
ausführen, abschließen. Das Programm auf Mainnet ist unveränderlich; das auf Devnet kann
Squads ändern. Dann scheitert die Prüfung, bis jemand den neuen Stand angesehen und die Summe
bewusst geändert hat. Die Einstellungen des Programms (Gebühr, Schatzamt) legt der Test selbst
an, mit einer Gebühr über 0 – so prüft er auch das Schatzamt.

Dieselben Tests laufen in der CI (`.github/workflows/kasse.yml`), sobald sich der Baustein oder
die Tests ändern; Überspringen gilt dort als Fehler. Kein Deploy, keine Transaktion auf einem
echten Netz.
