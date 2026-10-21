#!/usr/bin/env bash
# Kasse über Squads v4 (A-12, docs/KASSE-ENTWURF.md): die Tests gegen das echte Programm – das
# unveränderliche von Mainnet und das von Devnet, je in einem lokalen Validator. Vom Programm liegt
# nichts im Repo (AGPL-3.0): pruefen.sh holt beide mit `solana program dump` und nimmt sie nur mit
# der Prüfsumme unten. Ändert Squads das Programm auf Devnet, scheitert die Prüfung – dann den
# neuen Stand ansehen und die Summe bewusst ändern.
#
# Braucht Agave 3.1.10 im PATH (solana, solana-test-validator) wie Zahlkanal und HTLC. Ohne die Werkzeuge:
#   bash contracts/squads/pruefen.sh --werkzeuge
# laedt sie nach $SOLANA_WERKZEUGE (Standard ~/.cache/freedom-solana). Kein Deploy, keine Transaktion
# auf einem echten Netz – gelesen wird dort nur das Programm.
set -euo pipefail
cd "$(dirname "$0")"
AGAVE=v3.1.10
WERKZEUGE="${SOLANA_WERKZEUGE:-$HOME/.cache/freedom-solana}"
ZIEL="$WERKZEUGE/$AGAVE"
SQUADS=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
# Mainnet: unveraenderlich seit Slot 302 582 236; Devnet: Stand vom 21.10.2026 (Slot 446 638 068 laut Entwurf)
SUMME_MAINNET=dec8d3e0fae58c7c8f2416e5f67c25e673f047afd6dd2bba4a47e0b29a01d34c
SUMME_DEVNET=97fb2a5c08e5df5e862d8354ac5b97d3587117f98c4457754ca12e30bef0664d

if [ "${1:-}" = "--werkzeuge" ]; then
  if [ ! -x "$ZIEL/solana-release/bin/solana-test-validator" ]; then
    mkdir -p "$ZIEL"
    curl -sSfL "https://github.com/anza-xyz/agave/releases/download/$AGAVE/solana-release-x86_64-unknown-linux-gnu.tar.bz2" \
      | tar xj -C "$ZIEL"
  fi
  export PATH="$ZIEL/solana-release/bin:$PATH"
fi

ABLAGE="$WERKZEUGE/squads"
mkdir -p "$ABLAGE"
hole() { # <netz> <rpc> <summe>
  local datei="$ABLAGE/squads-$1-$3.so"
  if [ ! -f "$datei" ]; then
    solana program dump -u "$2" "$SQUADS" "$datei.neu" > /dev/null
    mv "$datei.neu" "$datei"
  fi
  if ! echo "$3  $datei" | sha256sum -c --quiet -; then
    echo "Squads auf $1 hat eine andere Pruefsumme als erwartet – nicht verwendet" >&2
    rm -f "$datei"
    exit 1
  fi
  echo "$datei"
}
SQUADS_SO_MAINNET="$(hole mainnet https://api.mainnet-beta.solana.com "$SUMME_MAINNET")"
SQUADS_SO_DEVNET="$(hole devnet https://api.devnet.solana.com "$SUMME_DEVNET")"
export SQUADS_SO_MAINNET SQUADS_SO_DEVNET

cd ../..
npx tsc -p contracts/squads/tsconfig.json
# Zeitlimit je Test und Ende nach dem letzten – wie bei Zahlkanal und HTLC
SQUADS_TESTS_PFLICHT=1 node --import tsx --test --test-timeout=180000 --test-force-exit contracts/squads/tests/*.test.ts
