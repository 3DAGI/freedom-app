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

**Programm-ID:** Devnet `F9P2PeyySkeQL4d1KAtHjtnVBqzjW3dqbfubY1PChW2m` (Deploy durch den MENSCHEN am
09.10.2026). Sie steht in `declare_id!`, in `Anchor.toml` und in
`KANAL_PROGRAMM_ID` – `channel.test.ts` vergleicht alle drei. Anchor prüft
sie bei jedem Aufruf: Ein Programm, das mit einer anderen `declare_id!`
gebaut wurde, lehnt an dieser Adresse alles ab (Fehler 4100,
`DeclaredProgramIdMismatch`). Deshalb gilt: das Programm an der Adresse nur
mit einer Binary ersetzen, die aus diesem Stand gebaut ist – und die ID nur
zusammen mit einem Deploy oder Upgrade ändern (beides MENSCH).

**Upgrade (MENSCH, Devnet):** aus genau dem gemergten Stand bauen, dann mit dem
Schlüssel, der das Upgrade-Recht hält (`docs/SOLANA-UPGRADE-AUTHORITY.md`):

```bash
bash contracts/solana-channel/pruefen.sh --werkzeuge   # baut und testet
solana program deploy --url devnet \
  --program-id F9P2PeyySkeQL4d1KAtHjtnVBqzjW3dqbfubY1PChW2m \
  --upgrade-authority <Schlüsseldatei des Upgrade-Rechts> \
  contracts/solana-channel/target/deploy/solana_channel.so
solana program dump --url devnet F9P2PeyySkeQL4d1KAtHjtnVBqzjW3dqbfubY1PChW2m /tmp/kanal.so
sha256sum /tmp/kanal.so contracts/solana-channel/target/deploy/solana_channel.so   # gleich
```

Die Prüfsumme hängt vom Rechner ab (Pfade landen in der Binary) – verglichen
wird die eigene Build-Datei mit dem, was danach auf der Kette liegt.

**Nie** durch den Agenten: Deploy, `--final`, Upgrade-Rechte ändern.
