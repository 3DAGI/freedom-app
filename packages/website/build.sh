#!/usr/bin/env bash
# freedom website — build + hash + deploy-vorbereitung (IPFS/Arweave)
# Aufruf: bash packages/website/build.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1. App bauen =="
(cd ../app && node build.mjs)

echo "== 2. In Website kopieren =="
cp ../app/dist/freedom.html ./freedom.html
cp ../app/dist/manifest.json ./manifest.json

echo "== 3. Hashes berechnen =="
PWA_HASH=$(sha256sum freedom.html | awk '{print $1}')
sed -i "s|sha256: <span id=\"hash-pwa\">[^<]*</span>|sha256: <span id=\"hash-pwa\">${PWA_HASH}</span>|" index.html
echo "  freedom.html sha256: $PWA_HASH"

echo "== 4. Dateien =="
ls -la index.html freedom.html manifest.json css/style.css
du -h freedom.html | awk '{print "  freedom.html: "$1}'

echo ""
echo "Fertig. Nächste Schritte (dezentral deployen):"
echo "  IPFS:    ipfs add -r packages/website  -> CID + 'ipfs pin'"
echo "  Arweave: arkb deploy packages/website  (oder ardrive CLI)"
echo "  Tor:     siehe packages/website/onion-setup.md"
echo "  Lokal:   cd packages/website && python3 -m http.server 3600"
