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
- **Veröffentlichung**: nur über `.github/workflows/pages.yml` (bei jedem Merge nach `main`, nur mit grünen Tests)
- **SHA256 freedom.html**: ef5a0aec4a9e88268c066d0391cfe1c58efc63d59abb60084ece7e73f60695dc (Stand 24.09., nach 2.1;
  der aktuelle Wert steht immer in `freedom.html.sha256` und auf der Startseite)

## SLIP-10 Key Derivation (1.1)
- **Path**: m/44'/501'/0'/0' (Phantom-kompatibel)
- **Tested against**: Official SLIP-10 test vectors (derivation.test.ts)
- **Phantom verification**: Siehe ANLEITUNG-0C-1.1.md Schritt 5

## Build notes
- `anchor build` fehlschlaegt: proc-macro2 1.0.107 vs anchor-syn 0.30.1 (umgebungsbedingt)
- Workaround: `cargo-build-sbf` mit Solana BPF Toolchain (1.89.0-sbpf-solana-v1.53)
- Programmlogik unveraendert -- das 0C-1.1-Patch aendert nur die App und Protokoll-Module
