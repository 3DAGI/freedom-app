#!/usr/bin/env bash
# Hangover für Windows-Programme auf ARM64 (VKi2, `docs/VIBECODEN-ENTWURF.md` VKi): Wine mit FEX (x86_64 über ARM64EC) und
# box64 (32 Bit) – das Release von AndreRH/hangover in fester Fassung. Das Projekt veröffentlicht keine Prüfsummen; die SHA-256
# stehen hier fest (beim ersten Laden selbst gerechnet), geladen wird nur, was genau so aussieht.
#
#   scripts/hangover-holen.sh <ziel> <noble|bookworm>   legt die vier Pakete in <ziel> ab (für `apt-get install <ziel>/*.deb`)
#
# noble: Ubuntu 24.04 (DGX OS, CI), bookworm: Debian 12 (Docker-Bild). Nur auf ARM64 – auf x86_64 ist Wine der Distribution
# richtig (VKi1). Liegt das Archiv mit richtiger Summe schon in <ziel> (Zwischenspeicher der CI), wird es nicht neu geladen.
# Hangover und Wine stehen unter LGPL-2.1+, FEX und box64 unter MIT – eigene Programme, nur in der Sandbox des Projekts.
set -euo pipefail

HANGOVER_FASSUNG=11.16
QUELLE="https://github.com/AndreRH/hangover/releases/download/hangover-$HANGOVER_FASSUNG"
declare -A ARCHIV=(
  [noble]="hangover_${HANGOVER_FASSUNG}_ubuntu2404_noble_arm64.tar"
  [bookworm]="hangover_${HANGOVER_FASSUNG}_debian12_bookworm_arm64.tar"
)
declare -A SUMME=(
  [noble]=94611dad2b23978d35825a018c81b3947caaec174aa04c052849d37bc6a39e72
  [bookworm]=dd7373202a168b7200cc36627a25b588511f3783756c2661bf4c022be8380aa8
)
# nur diese – DXVK (Direct3D über Vulkan) braucht eine GPU, die der Code des Projekts nie bekommt
PAKETE=(hangover-wine hangover-libarm64ecfex hangover-libwow64fex hangover-wowbox64)

ZIEL="${1:?Ziel fehlt – scripts/hangover-holen.sh <ziel> <noble|bookworm>}"
DIST="${2:?Distribution fehlt – noble oder bookworm}"
[ -n "${ARCHIV[$DIST]:-}" ] || { echo "Hangover: Distribution $DIST unbekannt (noble oder bookworm)" >&2; exit 1; }
case "$(uname -m)" in
  aarch64 | arm64) ;;
  *) echo "Hangover: nur für ARM64 – auf $(uname -m) Wine der Distribution nehmen (VKi1)" >&2; exit 1 ;;
esac

stimmt() { [ -f "$1" ] && echo "$2  $1" | sha256sum -c --status -; }
mkdir -p "$ZIEL"
tar_datei="$ZIEL/${ARCHIV[$DIST]}"
if ! stimmt "$tar_datei" "${SUMME[$DIST]}"; then
  rm -f "$tar_datei" "$tar_datei.teil"
  curl -fsSL --retry 3 --proto '=https' --tlsv1.2 -o "$tar_datei.teil" "$QUELLE/${ARCHIV[$DIST]}"
  stimmt "$tar_datei.teil" "${SUMME[$DIST]}" || { rm -f "$tar_datei.teil"; echo "Hangover: Summe stimmt nicht – Abbruch" >&2; exit 1; }
  mv "$tar_datei.teil" "$tar_datei"
fi
# aus dem Archiv nur die genannten Pakete, nur flache Namen – nie entpacken, wohin es will
rm -f "$ZIEL"/*.deb
for p in "${PAKETE[@]}"; do
  name="$(tar -tf "$tar_datei" | grep -E "^${p}_[0-9][^/]*_arm64\.deb$" | head -1)"
  [ -n "$name" ] || { echo "Hangover: $p fehlt im Archiv – Abbruch" >&2; exit 1; }
  tar -xOf "$tar_datei" "$name" > "$ZIEL/$name"
done
echo "Hangover $HANGOVER_FASSUNG ($DIST) geprüft: ${#PAKETE[@]} Pakete in $ZIEL"
