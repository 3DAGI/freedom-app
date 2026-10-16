#!/usr/bin/env bash
# Cashu-Mint fuer die Tests des Cashu-Topfs (A-17c): Nutshell mit FakeWallet auf 127.0.0.1 –
# die Mint bezahlt jede ihrer Rechnungen selbst, kein Lightning, kein Geld. Versionen fest
# (scripts/cashu-testmint.txt). Gibt die Adresse aus; die Tests lesen sie aus CASHU_TEST_MINT.
#   bash scripts/cashu-testmint.sh [ordner]      # Ordner wird angelegt, Vorgabe: $RUNNER_TEMP oder /tmp
set -euo pipefail
ORT="${1:-${RUNNER_TEMP:-/tmp}/cashu-testmint}"
PORT="${CASHU_TEST_PORT:-3338}"
HIER="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ORT/daten"
[ -x "$ORT/venv/bin/mint" ] || {
  python3 -m venv "$ORT/venv"
  "$ORT/venv/bin/pip" install -q --disable-pip-version-check -r "$HIER/cashu-testmint.txt"
}
# Schluessel der Mint je Start neu – nur fuer diesen Lauf
SCHLUESSEL="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
MINT_BACKEND_BOLT11_SAT=FakeWallet MINT_LISTEN_HOST=127.0.0.1 MINT_LISTEN_PORT="$PORT" MINT_PRIVATE_KEY="$SCHLUESSEL" \
  MINT_DATABASE="$ORT/daten/db" FAKEWALLET_DELAY_PAYMENT=false nohup "$ORT/venv/bin/mint" > "$ORT/mint.log" 2>&1 &
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/v1/info" > /dev/null; then echo "http://127.0.0.1:$PORT"; exit 0; fi
  sleep 1
done
echo "Mint startet nicht:" >&2
tail -20 "$ORT/mint.log" >&2
exit 1
