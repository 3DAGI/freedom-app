# Solana-Zahlkanal (Schritt 4.3)

Anchor-Programm für den Zahlkanal. Das Format (Konto, Anweisungen, Gutschrift,
Aufteilung) steht in [`docs/ZAHLKANAL.md`](../../docs/ZAHLKANAL.md); der Client
ist `packages/protocol/src/channel.ts`. Beide folgen dem Dokument.

```bash
bash contracts/solana-channel/pruefen.sh              # Agave 3.1.10 im PATH
bash contracts/solana-channel/pruefen.sh --werkzeuge  # lädt Agave 3.1.10 vorher
```

`pruefen.sh` baut das Programm mit `cargo-build-sbf` (platform-tools v1.52,
Rust 1.89) und lässt `tests/kanal.test.ts` gegen einen lokalen
`solana-test-validator` laufen – dieselben Tests laufen in der CI
(`.github/workflows/zahlkanal.yml`), sobald sich Programm oder Client ändern.

**Programm-ID:** bis zum Devnet-Deploy ein Platzhalter ohne Schlüssel
(`7tukwiJ8cKiWPmkhH2seJycWebHuZy1XLXEZYAMLB5Dj` = die 32 Bytes von
„freedomstack-channel-platzhalter“). Beim Deploy (MENSCH) das
Programm-Schlüsselpaar erzeugen, die Adresse in `declare_id!` und in
`KANAL_PROGRAMM_ID` eintragen, neu bauen und die Tests laufen lassen.

**Nie** durch den Agenten: Deploy, `--final`, Upgrade-Rechte ändern.
