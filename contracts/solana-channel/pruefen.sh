#!/usr/bin/env bash
# Zahlkanal (Schritt 4.3b): Programm bauen und die Tests gegen einen lokalen
# Validator laufen lassen. Format: docs/ZAHLKANAL.md.
#
# Braucht Agave 3.1.10 im PATH (cargo-build-sbf, solana-test-validator) –
# aeltere scheitern an der Lock-Datei (edition2024). Ohne die Werkzeuge:
#   bash contracts/solana-channel/pruefen.sh --werkzeuge
# laedt sie nach $SOLANA_WERKZEUGE (Standard ~/.cache/freedom-solana).
set -euo pipefail
cd "$(dirname "$0")"
AGAVE=v3.1.10
ZIEL="${SOLANA_WERKZEUGE:-$HOME/.cache/freedom-solana}/$AGAVE"

if [ "${1:-}" = "--werkzeuge" ]; then
  if [ ! -x "$ZIEL/solana-release/bin/cargo-build-sbf" ]; then
    mkdir -p "$ZIEL"
    curl -sSfL "https://github.com/anza-xyz/agave/releases/download/$AGAVE/solana-release-x86_64-unknown-linux-gnu.tar.bz2" \
      | tar xj -C "$ZIEL"
  fi
  export PATH="$ZIEL/solana-release/bin:$PATH"
fi

cargo-build-sbf --version
(cd programs/solana-channel && cargo-build-sbf)
# Die Tests starten den Validator selbst (freier Port, eigener Ledger) und
# nutzen den Client aus packages/protocol/src/channel.ts.
cd ../..
npx tsc -p contracts/solana-channel/tsconfig.json
# Zeitlimit je Test und Ende nach dem letzten: Ein Websocket von web3.js, der neu
# verbindet, haelt den Prozess sonst am Leben (so lief der CI-Job von 4.3c1 bis
# zu seinem Limit), und ein toter Validator laesst web3.js endlos warten.
KANAL_TESTS_PFLICHT=1 node --import tsx --test --test-timeout=180000 --test-force-exit contracts/solana-channel/tests/*.test.ts
