#!/usr/bin/env bash
# aapt2 aus den Quellen (VKh3, `docs/ANDROID-ENTWURF.md`, VKh-W2 A): Google liefert aapt2 nur für x86-64 (als Maven-Artefakt
# des Android-Plugins) – für ARM64 bauen wir es selbst, nie ein fertiges Programm von anderen. Debian 12 hat nur aapt2 aus
# Android 10, zu alt für compileSdk 36.
#
# Gebaut nach dem Rezept von lzhiyong/android-sdk-tools (Apache-2.0: CMake statt Soong; Commit fest) mit dem Compiler des
# Rechners (`--toolchain host`, clang) und statisch gelinkt – in der Sandbox braucht es keine Bibliothek. Die Quellen kommen
# beim Tag platform-tools-<fassung> von android.googlesource.com (zlib von GitHub); jedes Repo wird nach dem Holen gegen
# seinen Commit hier geprüft (`STAENDE`), bevor etwas davon läuft. Das Rezept holt dann nichts mehr selbst: Seine Liste
# (repository.json) muss genau unsere sein, es findet alles vor und legt nur noch seine Patches an.
#
#   scripts/aapt2-bauen.sh <ziel>   baut <ziel>/aapt2 und legt die Lizenztexte nach <ziel>/aapt2-lizenzen/
#
# Braucht git, patch, python3, cmake, ninja, clang, bison, flex und go (BoringSSL); rund 5 GB Platz, 15–30 min.
set -euo pipefail

AAPT2_FASSUNG=35.0.2
AOSP_TAG="platform-tools-$AAPT2_FASSUNG"
AOSP=https://android.googlesource.com
REZEPT=https://github.com/lzhiyong/android-sdk-tools
REZEPT_COMMIT=fe637bf075f1b734b4b01d281f9f58899245ed92
ZLIB=https://github.com/madler/zlib
ZLIB_TAG=v1.3.1

# <pfad unter src/> <repo bei AOSP> <commit des Tags> – zlib: <pfad> <url> <commit>, Tag ZLIB_TAG
STAENDE="
abseil-cpp           platform/external/abseil-cpp            0000000000000000000000000000000000000000
adb                  platform/packages/modules/adb           0000000000000000000000000000000000000000
aidl                 platform/system/tools/aidl              0000000000000000000000000000000000000000
art                  platform/art                            0000000000000000000000000000000000000000
avb                  platform/external/avb                   0000000000000000000000000000000000000000
base                 platform/frameworks/base                723419df1a0769b63587722a8a0a0980f454ffd2
boringssl            platform/external/boringssl             0000000000000000000000000000000000000000
brotli               platform/external/brotli                0000000000000000000000000000000000000000
build                platform/build                          46581c7be3390d0ecd0a037e6e6ebc2893d5768a
core                 platform/system/core                    90e4908e776d2be9b26b87af649e63e4208cf085
dalvik               platform/dalvik                         c7e490537adfaa04030757014e590c1b442f748a
development          platform/development                    db0a64ff5d737accf45252d05f97320373edad34
e2fsprogs            platform/external/e2fsprogs             0000000000000000000000000000000000000000
expat                platform/external/expat                 20fd404393d65d2aff6dbc79dcbf4da6e68cabb2
extras               platform/system/extras                  0000000000000000000000000000000000000000
f2fs-tools           platform/external/f2fs-tools            0000000000000000000000000000000000000000
fmtlib               platform/external/fmtlib                0000000000000000000000000000000000000000
googletest           platform/external/googletest            0000000000000000000000000000000000000000
incremental_delivery platform/system/incremental_delivery    0000000000000000000000000000000000000000
jsoncpp              platform/external/jsoncpp               0000000000000000000000000000000000000000
libbase              platform/system/libbase                 0000000000000000000000000000000000000000
libpng               platform/external/libpng                3f98a222b00621de0815c70bcbee9f3d19434359
libusb               platform/external/libusb                0000000000000000000000000000000000000000
libziparchive        platform/system/libziparchive           0000000000000000000000000000000000000000
logging              platform/system/logging                 0000000000000000000000000000000000000000
lz4                  platform/external/lz4                   0000000000000000000000000000000000000000
mdnsresponder        platform/external/mdnsresponder         0000000000000000000000000000000000000000
mkbootimg            platform/system/tools/mkbootimg         0000000000000000000000000000000000000000
native               platform/frameworks/native              0000000000000000000000000000000000000000
openscreen           platform/external/openscreen            0000000000000000000000000000000000000000
pcre                 platform/external/pcre                  0000000000000000000000000000000000000000
protobuf             platform/external/protobuf              5b489930dd17777ea9173840faba912c2db1748a
selinux              platform/external/selinux               0000000000000000000000000000000000000000
soong                platform/build/soong                    0000000000000000000000000000000000000000
sqlite               platform/external/sqlite                f6e15f48aceb7421bbbb515a91076c1a7e12c14f
tinyxml2             platform/external/tinyxml2              0000000000000000000000000000000000000000
unwinding            platform/system/unwinding               0000000000000000000000000000000000000000
zlib                 $ZLIB                                   51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf
zopfli               platform/external/zopfli                0000000000000000000000000000000000000000
zstd                 platform/external/zstd                  0000000000000000000000000000000000000000
"
# Was aapt2 statisch enthält (aapt2.cmake des Rezepts) – je Repo ein Lizenztext, sonst Abbruch
GELINKT="base core libbase logging libziparchive incremental_delivery soong selinux protobuf abseil-cpp boringssl expat libpng pcre fmtlib zlib"

ZIEL="${1:?Ziel fehlt – scripts/aapt2-bauen.sh <ziel>}"
case "$(uname -m)" in
  x86_64) ARCH=x86_64 ;;
  aarch64 | arm64) ARCH=aarch64 ;;
  *) echo "aapt2: Prozessor $(uname -m) nicht vorgesehen – Abbruch" >&2; exit 1 ;;
esac

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

# <ordner> <url> <ref> – nur die eine Fassung, ohne Verlauf; gibt den Commit aus
hole() {
  local versuch
  git init -q "$1" || return 1
  for versuch in 1 2 3; do
    git -C "$1" fetch -q --depth 1 "$2" "$3" && break
    [ "$versuch" = 3 ] && return 1
    sleep $((versuch * 5))
  done
  git -C "$1" -c advice.detachedHead=false checkout -q FETCH_HEAD || return 1
  git -C "$1" rev-parse HEAD
}

stand="$(hole "$ARBEIT/rezept" "$REZEPT" "$REZEPT_COMMIT")" || { echo "aapt2: Rezept $REZEPT_COMMIT nicht geholt – Abbruch" >&2; exit 1; }
[ "$stand" = "$REZEPT_COMMIT" ] || { echo "aapt2: Rezept zeigt auf $stand statt $REZEPT_COMMIT – Abbruch" >&2; exit 1; }

# Alle Repos holen und prüfen – jede Abweichung nennen, dann abbrechen
falsch=0
pfade=""
while read -r pfad repo commit; do
  [ -n "$pfad" ] || continue
  pfade="$pfade$pfad"$'\n'
  if [ "$pfad" = zlib ]; then url="$repo"; ref="refs/tags/$ZLIB_TAG"; else url="$AOSP/$repo"; ref="refs/tags/$AOSP_TAG"; fi
  if ! stand="$(hole "$ARBEIT/rezept/src/$pfad" "$url" "$ref")"; then
    echo "aapt2: $pfad nicht geholt ($url $ref)" >&2
    falsch=1
  elif [ "$stand" != "$commit" ]; then
    echo "aapt2: $pfad zeigt auf $stand statt $commit" >&2
    falsch=1
  fi
done <<< "$STAENDE"
[ "$falsch" = 0 ] || { echo "aapt2: Quellen nicht wie erwartet – Abbruch" >&2; exit 1; }

# Das Rezept darf nichts holen, was hier nicht geprüft ist: seine Liste muss genau unsere sein
liste="$(python3 -I -c 'import json, sys; print("\n".join(sorted(r["path"].removeprefix("src/") for r in json.load(open(sys.argv[1])))))' "$ARBEIT/rezept/repository.json")"
[ "$liste" = "$(printf '%s' "$pfade" | LC_ALL=C sort)" ] || { echo "aapt2: repository.json des Rezepts nennt andere Repos – Abbruch" >&2; exit 1; }
find "$ARBEIT/rezept/src" -mindepth 2 -maxdepth 2 -name .git -type d -exec rm -rf {} +

# get_source.py findet alles vor (überspringt jedes Repo) und legt nur die Patches an; build.py baut protoc, dann aapt2
( cd "$ARBEIT/rezept" && python3 -I get_source.py --tags "$AOSP_TAG" --jobs 1 ) > "$ARBEIT/quellen.log"
grep -q "already exists, skip" "$ARBEIT/quellen.log" && ! grep -q "^cloned " "$ARBEIT/quellen.log" \
  || { cat "$ARBEIT/quellen.log" >&2; echo "aapt2: das Rezept hat selbst geholt – Abbruch" >&2; exit 1; }
( cd "$ARBEIT/rezept" && python3 -I build.py --toolchain host --cc clang --cxx clang++ --arch "$ARCH" --link static \
    --build "$ARBEIT/bau" --target aapt2 --jobs "$(nproc)" ) > "$ARBEIT/bau.log" 2>&1 \
  || { tail -n 80 "$ARBEIT/bau.log" >&2; echo "aapt2: Bau gescheitert" >&2; exit 1; }

PROGRAMM="$ARBEIT/bau/bin/build-tools/aapt2"
# statisch: kein Interpreter, keine Bibliothek – sonst liefe es in der Sandbox nicht überall
if readelf -l "$PROGRAMM" | grep -q "program interpreter" || readelf -d "$PROGRAMM" | grep -q NEEDED; then
  echo "aapt2 ist nicht statisch gelinkt – Abbruch" >&2
  exit 1
fi
"$PROGRAMM" version > "$ARBEIT/fassung.txt" 2>&1 || { cat "$ARBEIT/fassung.txt" >&2; exit 1; }

mkdir -p "$ZIEL/aapt2-lizenzen"
install -m 0755 "$PROGRAMM" "$ZIEL/aapt2"
install -m 0644 "$ARBEIT/rezept/LICENSE.txt" "$ZIEL/aapt2-lizenzen/android-sdk-tools"
for repo in $GELINKT; do
  text=""
  for name in NOTICE LICENSE LICENSE.txt LICENSE.md LICENSE.rst LICENCE COPYING; do
    [ -f "$ARBEIT/rezept/src/$repo/$name" ] && { text="$ARBEIT/rezept/src/$repo/$name"; break; }
  done
  [ -n "$text" ] || { echo "aapt2: Lizenztext von $repo fehlt – Abbruch" >&2; exit 1; }
  install -m 0644 "$text" "$ZIEL/aapt2-lizenzen/$repo"
done
echo "aapt2 $AAPT2_FASSUNG ($(head -n 1 "$ARBEIT/fassung.txt")) nach $ZIEL"
