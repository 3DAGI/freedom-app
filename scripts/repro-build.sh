#!/usr/bin/env bash
# Reproduzierbarer Build (Schritt 5.9): freedom.html aus einem Commit – jeder
# kann nachbauen und bekommt dieselbe SHA-256 wie im Release-Manifest.
#
#   scripts/repro-build.sh [commit]                     baut, gibt die SHA-256 aus
#   scripts/repro-build.sh --pruefen [commit]           baut zweimal an zwei Pfaden – verschiedene Summen: Fehler (CI)
#   scripts/repro-build.sh --vergleiche <sha256> [commit]  baut und vergleicht (z. B. mit dem Release-Manifest)
#
# Fest ist: der Quelltext (ein frischer Arbeitsbaum des Commits – nichts aus dem
# eigenen Checkout, kein node_modules), die Abhängigkeiten (`npm ci` nach
# package-lock.json), die Node-Hauptversion (.nvmrc), Zeitzone, Sprache und
# Zeitstempel (SOURCE_DATE_EPOCH = Zeit des Commits). Die MLS-Engine liegt
# gebaut in packages/mls/dist; ob sie zum Quelltext passt, prüft
# `packages/mls/bauen.sh --pruefen` (mls.yml), build.mjs nimmt sie nur mit
# passender SHA256SUMS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODUS=bauen
SOLL=""
case "${1:-}" in
  --pruefen) MODUS=pruefen; shift ;;
  --vergleiche)
    MODUS=vergleiche
    SOLL="${2:-}"
    [[ "$SOLL" =~ ^[0-9a-f]{64}$ ]] || { echo "Aufruf: --vergleiche <sha256, 64 Hex-Zeichen> [commit]" >&2; exit 2; }
    shift 2 ;;
  -*) echo "Unbekannte Option: $1" >&2; exit 2 ;;
esac
COMMIT="$(git -C "$ROOT" rev-parse --verify "${1:-HEAD}^{commit}")"

NODE_SOLL="$(tr -d '[:space:]' < "$ROOT/.nvmrc")"
NODE_IST="$(node -p 'process.versions.node')"
if [ "${NODE_IST%%.*}" != "$NODE_SOLL" ]; then
  echo "Node $NODE_IST – gebaut wird mit Node $NODE_SOLL (.nvmrc). Etwa: nvm use" >&2
  exit 2
fi

export TZ=UTC LC_ALL=C LANG=C
export SOURCE_DATE_EPOCH="$(git -C "$ROOT" log -1 --format=%ct "$COMMIT")"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false

ARBEIT="$(mktemp -d)"
BAEUME=(a zweiter/pfad/b)
aufraeumen() {
  for b in "${BAEUME[@]}"; do
    [ -d "$ARBEIT/$b" ] && git -C "$ROOT" worktree remove --force "$ARBEIT/$b" >/dev/null 2>&1 || true
  done
  rm -rf "$ARBEIT"
  git -C "$ROOT" worktree prune
}
trap aufraeumen EXIT

# Ein frischer Arbeitsbaum des Commits, npm ci, Build – ausgegeben wird nur die Summe.
baue() {
  local ziel="$ARBEIT/$1"
  mkdir -p "$(dirname "$ziel")"
  git -C "$ROOT" worktree add -q --detach "$ziel" "$COMMIT"
  (cd "$ziel" && npm ci --silent >/dev/null) || { echo "npm ci gescheitert ($1)" >&2; return 1; }
  (cd "$ziel/packages/app" && node build.mjs >/dev/null) || { echo "Build gescheitert ($1)" >&2; return 1; }
  sha256sum "$ziel/packages/app/dist/freedom.html" | cut -d' ' -f1
}

echo "Commit ${COMMIT:0:12} · Node $NODE_IST · SOURCE_DATE_EPOCH $SOURCE_DATE_EPOCH"
A="$(baue a)"
echo "freedom.html  $A"
case "$MODUS" in
  pruefen)
    # Zweiter Build an einem anderen, tieferen Pfad – absolute Pfade dürfen nicht ins Ergebnis
    B="$(baue zweiter/pfad/b)"
    echo "zweiter Build $B"
    [ "$A" = "$B" ] || { echo "NICHT reproduzierbar: zwei Builds, zwei Summen" >&2; exit 1; }
    echo "reproduzierbar: zweimal dieselbe Summe" ;;
  vergleiche)
    [ "$A" = "$SOLL" ] || { echo "ANDERS als erwartet ($SOLL)" >&2; exit 1; }
    echo "gleich: die erwartete Summe" ;;
esac
