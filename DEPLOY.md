# Devnet Deployment Info — 0.C + 1.1

## HTLC-Programm (seit 13.10.2026, Schritt 0.G)
- **Program ID**: FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD
- **Upgrade Authority**: FsUyQBHzW1dKEaj7MRBEh4UadqbbTAdgdcrfoTdTP3rA
- **Cluster**: Devnet
- **Deployed**: 2026-10-13 (Commit 731923b), Programmdaten `BmQPDFXWvUAseUBwyte6CxwPi6LHfNFUsSu5T9uLPwdg` (217,461 Bytes)
- **Geprüft 14.10.2026**: ausführbar, Upgrade-Recht wie oben; eine Simulation von `refund`
  endet mit 3012 (Konto fehlt), nicht mit 4100 – `declare_id!` passt. Ob die Binary bitgleich
  aus dem Quelltext entsteht, ist nicht geprüft.
- **Abgelöst**: `3UmRRrMySUbPwRfV4x7c1A6ah94K7SQt3dDH2uqqdeZ8` (24.09.2026, lehnt jeden Aufruf ab, 4100;
  gleiches Upgrade-Recht – schließen gibt die Miete zurück) und `B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk`
  (Code vom Juli, Upgrade-Recht `8DhKPv…`).

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
