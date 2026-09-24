#!/bin/bash
# scripts/interop/create-pr.sh - Commit + Push + PR für test/interop-2.1
# Usage: bash scripts/interop/create-pr.sh

set -e
cd "$(dirname "$0")/../.."

echo "=== Staging ==="
git add -A

echo "=== Committing ==="
if git diff --cached --quiet; then
    echo "Nothing to commit"
else
    git commit -m "2.1 Interop: ANLEITUNG-INTEROP.md + create-pr.sh"
fi

echo "=== Pushing ==="
git push --force-with-lease origin test/interop-2.1

echo "=== Creating PR ==="
gh pr create \
  --title "2.1 Interop: NIP-17 gegen nostr-tools (Testbericht)" \
  --body "## Bericht Interop 2.1

- Patch sauber übernommen (git am -3): ja
- Bibliothek (nip17-interop.test.ts): 5/5 grün
- Alle Tests: protocol 935/939 grün (1 Devnet HTLC OOM, erwartet, 3 skipped) · app 167 grün
- Oberfläche, lokales Relay: bestanden ✅ (ergebnis.json: alle true, bestanden: true)
- Oberfläche, öffentliche Relays: bestanden ✅ (damus.io, nos.lol, relay.primal.net)
- Aufgeräumt (/tmp/nip17-interop gelöscht): ✅" \
  --head test/interop-2.1 \
  --base main
