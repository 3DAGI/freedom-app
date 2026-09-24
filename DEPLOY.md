# Devnet Deployment Info — 0.C + 1.1

## HTLC-SolangProgramm (unveraendert von Phase 0)
- **Program ID**: 3UmRRrMySUbPwRfV4x7c1A6ah94K7SQt3dDH2uqqdeZ8
- **Upgrade Authority**: FsUyQBHzW1dKEaj7MRBEh4UadqbbTAdgdcrfoTdTP3rA
- **Cluster**: Devnet
- **Zuletzt deployed**: 2026-09-24 (Slot 503410699)
- **Binary**: target/deploy/solana_htlc.so (217,416 Bytes)
- **TimelockExpired Check**: Phase 0 (claim nur vor Ablauf) — unveraendert

## Website
- **URL**: https://3dagi.github.io/freedom-app/
- **SHA256 freedom.html**: 1ba63a9ac2779061668ef5b098d9d173e5d053cb5ab10f35021952f40099a5f7

## SLIP-10 Key Derivation (1.1)
- **Path**: m/44'/501'/0'/0' (Phantom-kompatibel)
- **Tested against**: Official SLIP-10 test vectors (derivation.test.ts)
- **Phantom verification**: Siehe ANLEITUNG-0C-1.1.md Schritt 5

## Build notes
- `anchor build` fehlschlaegt: proc-macro2 1.0.107 vs anchor-syn 0.30.1 (umgebungsbedingt)
- Workaround: `cargo-build-sbf` mit Solana BPF Toolchain (1.89.0-sbpf-solana-v1.53)
- Programmlogik unveraendert -- das 0C-1.1-Patch aendert nur die App und Protokoll-Module
