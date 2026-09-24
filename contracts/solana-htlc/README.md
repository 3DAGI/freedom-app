# solana-htlc

Immutable HTLC-Programm (Anchor) fuer den Lightning ↔ Solana Atomic Swap.

## Status
Vollstaendiger Referenzcode. **In diesem Repo-Bau nicht kompiliert**, da die
Solana/Anchor-Toolchain nicht Teil der Umgebung war. Lokal bauen:

## Build & Test
```bash
# Toolchain (einmalig)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

# im contracts/solana-htlc:
anchor build
anchor test          # startet lokalen Validator + tests/solana-htlc.ts
```

## Deploy + Immutabilitaet (keyless)
```bash
anchor deploy --provider.cluster mainnet
# Danach das Programm UNVERAENDERLICH machen (Upgrade-Authority entfernen):
solana program set-upgrade-authority <PROGRAM_ID> --final
```
Nach `--final` ist das Programm nicht mehr aenderbar. Deshalb **vorher**:
mehrere unabhaengige Audits, langes Testnet, Bug-Bounty, ggf. formale Verifikation.
Bei immutable Code ist jeder Bug endgueltig.

## Sicherheitshinweise
- Lamport-Buchhaltung und Rent-Exemption des Swap-PDA vor Produktion pruefen.
- SPL-Token-Variante: Vault als PDA-Token-Account, Bewegung per `token::transfer` CPI.
- Timelock-Ordnung ist Sache der Swap-Orchestrierung: die Solana-Frist MUSS
  kuerzer sein als die Lightning-Frist (siehe packages/swap-core/src/timelock.ts).
