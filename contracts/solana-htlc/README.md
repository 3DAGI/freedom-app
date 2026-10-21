# solana-htlc

HTLC-Programm (Anchor) für die Swaps Lightning ↔ SOL. Regeln und Ablauf stehen
in [`docs/SWAPS.md`](../../docs/SWAPS.md); den Adapter für LP und Kunde enthält
`packages/protocol/src/solana-adapter.ts`.

Anweisungen: `lock` (sperren), `claim` (einlösen mit dem Preimage, nur der
Empfänger), `refund` (nach Ablauf zurück an den Initiator, darf jeder) und seit
A-28a `zurueckgeben` (vor Ablauf zurück an den Initiator, nur der Empfänger).

## Bauen und testen

```bash
bash contracts/solana-htlc/pruefen.sh              # Agave 3.1.10 im PATH
bash contracts/solana-htlc/pruefen.sh --werkzeuge  # lädt Agave 3.1.10 vorher
```

`pruefen.sh` baut das Programm mit `cargo-build-sbf` (platform-tools v1.52) und
lässt `tests/htlc.test.ts` gegen einen lokalen `solana-test-validator` laufen –
mit dem Adapter aus dem Protokoll, so wie LP und Kunde ihn nutzen. Dieselben
Tests laufen in der CI (`.github/workflows/htlc.yml`), sobald sich Programm,
Adapter oder `docs/SWAPS.md` ändern; überspringen gilt dort als Fehler.
`tests/solana-htlc.ts` ist der ältere Anchor-Test (`anchor test`) und läuft
nirgends mit.

## Programm-ID und Upgrade

Devnet `FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD` (seit 13.10.2026, 0.G). Sie
steht in `declare_id!`, in `Anchor.toml` und im Adapter (`HTLC_PROGRAMM_ID`).
Anchor prüft sie bei jedem Aufruf: Eine Binary mit einer anderen `declare_id!`
lehnt an dieser Adresse alles ab (4100). Die ID ändert sich nur zusammen mit
einem Deploy durch den MENSCHEN.

Deploy und Upgrade macht nur der MENSCH mit dem Schlüssel, der das Upgrade-Recht
hält, aus genau dem gemergten Stand – Schritte in
[`docs/SOLANA-UPGRADE-AUTHORITY.md`](../../docs/SOLANA-UPGRADE-AUTHORITY.md).
Für A-28 (Devnet):

```bash
bash contracts/solana-htlc/pruefen.sh --werkzeuge   # baut und testet
solana program deploy --url devnet \
  --program-id FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD \
  --upgrade-authority <Schlüsseldatei des Upgrade-Rechts> \
  contracts/solana-htlc/target/deploy/solana_htlc.so
solana program dump --url devnet FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD /tmp/htlc.so
sha256sum /tmp/htlc.so contracts/solana-htlc/target/deploy/solana_htlc.so   # gleich
```

Bis dahin lehnt das Programm an `FVb19s…` die Anweisung `zurueckgeben` ab (101,
`InstructionFallbackNotFound`); `lock`, `claim` und `refund` sind unverändert.

Nie `--final`: Danach wäre jeder Fehler im Programm endgültig. Vorher kämen
Audits, eine lange Testphase und ein Bug-Bounty (`GO-LIVE.md`).

## Sicherheitshinweise

- Die Fristen ordnet der Ablauf, nicht das Programm: In Richtung SOL → Lightning
  muss Lightning vor Solana enden (`validateReverseTimelock()`, `docs/SWAPS.md`).
- Neue Fehler-Varianten nur ans Ende des Enums – die Codes dürfen sich nicht
  verschieben (`contracts/CLAUDE.md`).
