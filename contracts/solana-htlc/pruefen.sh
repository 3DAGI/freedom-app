#!/usr/bin/env bash
# HTLC (seit A-28a): Programm bauen und die Tests gegen einen lokalen Validator laufen lassen –
# mit dem Adapter aus packages/protocol (so, wie LP und Kunde ihn nutzen). Regeln: docs/SWAPS.md.
#
# Braucht Agave 3.1.10 im PATH (cargo-build-sbf, solana-test-validator) wie der Zahlkanal.
# Ohne die Werkzeuge:
#   bash contracts/solana-htlc/pruefen.sh --werkzeuge
# laedt sie nach $SOLANA_WERKZEUGE (Standard ~/.cache/freedom-solana).
# Kein Deploy: Das Programm verlaesst den Rechner nicht; Upgrade nur durch den MENSCHEN
# (docs/SOLANA-UPGRADE-AUTHORITY.md).
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
(cd programs/solana-htlc && cargo-build-sbf)
cd ../..
npx tsc -p contracts/solana-htlc/tsconfig.validator.json
# Zeitlimit je Test und Ende nach dem letzten – wie beim Zahlkanal haelt web3.js sonst den Prozess am Leben
HTLC_TESTS_PFLICHT=1 node --import tsx --test --test-timeout=180000 --test-force-exit contracts/solana-htlc/tests/*.test.ts
