#!/usr/bin/env bash
# Tor-Brücken in die Hülle legen (B-33b2, `docs/TOR-BRUECKEN-ENTWURF.md` V2): nimmt die Programme der eigenen Plattform
# aus einem Bau von `scripts/pt-bauen.sh` – nur, was dessen SHA256SUMS nennt, und nur unverändert – und legt sie so ab,
# wie Tauri Beigaben erwartet (`externalBin`: `binaries/<name>-<ziel-tripel>`), mit den festen Namen aus `bruecken.rs`
# und den Lizenztexten. Gebaut wird danach mit `cargo tauri build --config tauri.bruecken.conf.json`.
#
#   scripts/pt-beilegen.sh <bau-ordner> <hülle-ordner> [<ziel-tripel>]   (ohne Tripel: das von rustc)
set -euo pipefail

BAU="${1:?Bau-Ordner fehlt – scripts/pt-beilegen.sh <bau-ordner> <hülle-ordner> [<ziel-tripel>]}"
HUELLE="${2:?Hülle-Ordner fehlt}"
TRIPEL="${3:-$(rustc -vV | sed -n 's/^host: //p')}"

case "$TRIPEL" in
  x86_64-unknown-linux-gnu) P=linux-amd64 ;;
  aarch64-unknown-linux-gnu) P=linux-arm64 ;;
  x86_64-pc-windows-msvc) P=windows-amd64 ;;
  *) echo "keine Tor-Brücken für $TRIPEL" >&2; exit 1 ;;
esac
ENDUNG=""
[ "$P" = windows-amd64 ] && ENDUNG=.exe

# Prüfsummen der Plattform aus dem Bau – fehlt eine Datei oder weicht sie ab, wird nichts beigelegt
( cd "$BAU" && grep "  $P/" SHA256SUMS > "$P.sums" && sha256sum -c --quiet "$P.sums" && rm "$P.sums" )

rm -rf "$HUELLE/binaries" "$HUELLE/bruecken-lizenzen"
mkdir -p "$HUELLE/binaries"
for n in snowflake webtunnel; do
  install -m 0755 "$BAU/$P/$n-client$ENDUNG" "$HUELLE/binaries/freedom-$n-$TRIPEL$ENDUNG"
done
cp -R "$BAU/$P/lizenzen" "$HUELLE/bruecken-lizenzen"
( cd "$HUELLE" && sha256sum binaries/* )
