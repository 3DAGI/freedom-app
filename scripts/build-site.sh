#!/usr/bin/env bash
# Baut den veroeffentlichbaren Website-Ordner.
#
# Nur oeffentliche Dateien: Startseite, Unterseiten, Stil, Manifest und die
# App. Interne Dateien (build.sh, gated-server.py, DEPLOY.md) bleiben draussen —
# DEPLOY.md enthaelt lokale Pfade, die niemanden etwas angehen.
#
# Die App kommt immer frisch aus dem Build, mit passender Pruefsumme daneben.
#
#   scripts/build-site.sh          -> ./site
#   scripts/build-site.sh /pfad    -> /pfad
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/site}"
W="$ROOT/packages/website"

( cd "$ROOT/packages/app" && node build.mjs >/dev/null )

rm -rf "$OUT"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cp "$W"/index.html "$W"/dashboard.html "$W"/faq.html "$W"/roadmap.html "$W"/whitepaper.html "$OUT"/
cp "$W"/manifest.json "$OUT"/
cp -r "$W"/css "$OUT"/
cp -r "$W"/js "$OUT"/
cp "$ROOT/packages/app/dist/freedom.html" "$OUT"/freedom.html
SUM="$(cd "$OUT" && sha256sum freedom.html | cut -d' ' -f1)"
echo "$SUM" > "$OUT/freedom.html.sha256"
# Weck-Worker (B-12c): neben freedom.html, sonst deckt worker-src 'self' ihn nicht
cp "$ROOT/packages/app/dist/freedom-sw.js" "$OUT"/freedom-sw.js
(cd "$OUT" && sha256sum freedom-sw.js | cut -d' ' -f1) > "$OUT/freedom-sw.js.sha256"

# Die Pruefsumme auch in die Startseite schreiben. Vorher stand dort ein fest
# eingetragener alter Wert — wer ihn nachrechnete, bekam einen Widerspruch.
python3 - "$OUT/index.html" "$SUM" <<'PYEOF'
import re, sys
p, summe = sys.argv[1], sys.argv[2]
s = open(p, encoding="utf-8").read()
neu, n = re.subn(r'(<span id="hash-pwa">)[0-9a-f]*(</span>)', r"\g<1>" + summe + r"\g<2>", s)
assert n == 1, f"Pruefsummen-Feld nicht gefunden ({n} Treffer) — Abbruch"
open(p, "w", encoding="utf-8").write(neu)
PYEOF

# Spiegel (5.3): wohin der Hosting-Anteil dieser Auslieferung geht – neben freedom.html.
cp "$ROOT/spiegel/freedom-spiegel.json" "$OUT"/freedom-spiegel.json
# Torrent (5.3b) mit dieser Auslieferung als Webseed – nur mit bekannter Adresse (pages.yml setzt sie).
if [ -n "${SPIEGEL_BASIS_URL:-}" ]; then
  (cd "$ROOT" && npx --no-install tsx scripts/mirror/torrent.mts "$OUT" "$SPIEGEL_BASIS_URL" >/dev/null)
fi
# Bezugsquellen in die Startseite – nur gesetzte, offene ehrlich als offen.
QUELLEN="$(cd "$ROOT" && npx --no-install tsx scripts/spiegel-quellen.mts "$OUT")"
python3 - "$OUT/index.html" "$QUELLEN" <<'PYEOF'
import html, json, re, sys
p, q = sys.argv[1], json.loads(sys.argv[2])
namen = {"offiziell": "Offizielle Adresse", "codeberg": "Codeberg Pages", "onion": "Tor (.onion)", "radicle": "Code (Radicle)",
         "ipfs": "IPFS", "arweave": "Arweave", "blossom": "Blossom", "torrent": "Torrent (Magnet)"}
zeilen = [f'<li>{html.escape(namen[x["art"]])}: <span class="mono">{html.escape(x["url"])}</span></li>' for x in q["gesetzt"]]
zeilen += [f'<li>{html.escape(namen[a])}: <span class="muted">noch nicht eingerichtet</span></li>' for a in q["offen"]]
zeilen.append('<li><span class="muted">IPFS, Arweave und Blossom kommen je Release dazu, sobald die Konten eingerichtet sind – die Adressen stehen dann im signierten Release-Manifest.</span></li>')
s = open(p, encoding="utf-8").read()
neu, n = re.subn(r"<!-- QUELLEN -->.*?<!-- /QUELLEN -->", "<!-- QUELLEN -->\n        " + "\n        ".join(zeilen) + "\n      <!-- /QUELLEN -->", s, flags=re.S)
assert n == 1, f"Quellen-Feld nicht gefunden ({n} Treffer) — Abbruch"
open(p, "w", encoding="utf-8").write(neu)
PYEOF

# GitHub Pages verarbeitet Seiten sonst mit Jekyll — unnoetig und langsamer.
touch "$OUT"/.nojekyll

# Lesbar fuer jeden Webserver — sonst liefert nginx einzelne Seiten mit 403.
chmod -R a+rX "$OUT"

echo "Fertig: $OUT"
echo "App-Pruefsumme: $(cat "$OUT"/freedom.html.sha256)"
