#!/usr/bin/env bash
# Godot für Spiele im Bild (VKk3a, `docs/VIBECODEN-ENTWURF.md` VKk): das offizielle Release in fester Fassung holen und
# gegen SHA-512 prüfen – die Summen stehen hier fest (aus SHA512-SUMS.txt des Releases), nie zur Laufzeit gelesen. Aus den
# Quellen zu bauen dauerte rund eine Stunde je Prozessor; der Editor (MIT) ist ein eigenes Programm, das der Knoten nur in
# der Sandbox des Projekts startet. Die Fassung ohne .NET – C#-Projekte laufen damit nicht.
#
#   scripts/godot-holen.sh <ziel>   legt <ziel>/godot (0755), <ziel>/LICENSE.txt und <ziel>/COPYRIGHT.txt an
#
# Liegt das Archiv mit richtiger Summe schon in <ziel> (Zwischenspeicher der CI), wird es nicht neu geladen.
set -euo pipefail

GODOT_FASSUNG=4.7.2-stable
QUELLE="https://github.com/godotengine/godot/releases/download/$GODOT_FASSUNG"
TEXTE="https://raw.githubusercontent.com/godotengine/godot/$GODOT_FASSUNG"
declare -A SUMME=(
  [x86_64]=9aa00f7a605200940bce3027a567b782f49bd8e940dd06ae9e987bd65aee1b1467edd56ed84fcdcbdd44354bf613bdbb4e5d2913e925850368e150c59ed54c65
  [arm64]=dd59918da086bd49bde2f5450b5e567ff8650cbde9abbd7b8f4ca1197ff8c609baa38834666d032deafb47099078d7822279e2a0e06e5665745468f26533e7e2
  [LICENSE.txt]=a76a1bc7c6651bf9e3d6c738c2d5b1568142177c5177a29f7e6a55a0429afb4dc80bfbb3e2552803fcd3c05b2e7a1099d125030717e0ab5a31a19b6bf3cd21a7
  [COPYRIGHT.txt]=265ab84cd535e76bea262212bceb22fad705bfb336f99aa634db2df4453bacadcf0f4eb0b0483fb7dbbbd27f0ae6b0e3f03082616cb18f5818a1303f06f95246
)

ZIEL="${1:?Ziel fehlt – scripts/godot-holen.sh <ziel>}"
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x86_64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "Godot: für $(uname -m) gibt es kein Release – Abbruch" >&2; exit 1 ;;
esac

# stimmt <datei> mit <summe>? (sha512sum -c, ohne Ausgabe)
stimmt() { [ -f "$1" ] && echo "$2  $1" | sha512sum -c --status -; }
# <adresse> nach <datei> holen, erst unter dem Namen, wenn die Summe stimmt
hole() {
  stimmt "$2" "$3" && return 0
  rm -f "$2" "$2.teil"
  curl -fsSL --retry 3 --proto '=https' --tlsv1.2 -o "$2.teil" "$1"
  stimmt "$2.teil" "$3" || { rm -f "$2.teil"; echo "Godot: Summe von $(basename "$2") stimmt nicht – Abbruch" >&2; exit 1; }
  mv "$2.teil" "$2"
}

mkdir -p "$ZIEL"
ARCHIV="Godot_v${GODOT_FASSUNG}_linux.$ARCH.zip"
hole "$QUELLE/$ARCHIV" "$ZIEL/$ARCHIV" "${SUMME[$ARCH]}"
for t in LICENSE.txt COPYRIGHT.txt; do hole "$TEXTE/$t" "$ZIEL/$t" "${SUMME[$t]}"; done
# nur genau die eine Datei aus dem Archiv – nie entpacken, wohin es will
unzip -p "$ZIEL/$ARCHIV" "Godot_v${GODOT_FASSUNG}_linux.$ARCH" > "$ZIEL/godot.teil"
chmod 0755 "$ZIEL/godot.teil"
mv "$ZIEL/godot.teil" "$ZIEL/godot"
echo "Godot $GODOT_FASSUNG ($ARCH) geprüft: $ZIEL/godot"
