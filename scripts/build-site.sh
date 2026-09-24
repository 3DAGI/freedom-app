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
cp "$W"/index.html "$W"/dashboard.html "$W"/faq.html "$W"/roadmap.html "$W"/whitepaper.html "$OUT"/
cp "$W"/manifest.json "$OUT"/
cp -r "$W"/css "$OUT"/
cp "$ROOT/packages/app/dist/freedom.html" "$OUT"/freedom.html
SUM="$(cd "$OUT" && sha256sum freedom.html | cut -d' ' -f1)"
echo "$SUM" > "$OUT/freedom.html.sha256"

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

# GitHub Pages verarbeitet Seiten sonst mit Jekyll — unnoetig und langsamer.
touch "$OUT"/.nojekyll

# Lesbar fuer jeden Webserver — sonst liefert nginx einzelne Seiten mit 403.
chmod -R a+rX "$OUT"

echo "Fertig: $OUT"
echo "App-Pruefsumme: $(cat "$OUT"/freedom.html.sha256)"
