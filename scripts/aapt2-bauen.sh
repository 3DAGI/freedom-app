#!/usr/bin/env bash
# aapt2 aus den Quellen (VKh3, `docs/ANDROID-ENTWURF.md`, VKh-W2 A): Google liefert aapt2 nur für x86-64 (als Maven-Artefakt
# des Android-Plugins) – für ARM64 bauen wir es selbst, nie ein fertiges Programm von anderen. Debian 12 hat nur aapt2 aus
# Android 10, zu alt für compileSdk 36.
#
# Gebaut nach dem Rezept von Commit451/android-arm-build-tools (MIT: CMake statt Soong, für glibc und GCC 12 auf Debian 12,
# Commit fest) aus den Quellen von Android 17 (Tag android-17.0.0_r1, aapt2 der Build-Tools 37.0.0) – mit dem GCC des
# Rechners, für seinen Prozessor. Jedes Repo wird nach dem Holen gegen seinen Commit hier geprüft (`STAENDE`), bevor etwas
# davon läuft. Das Rezept holt dann nichts mehr selbst: Seine Liste (repos.json) muss genau unsere sein, sein
# `fetch_sources.py` findet jedes Repo am Tag vor und legt nur noch seine Ergänzungen und Patches an.
#
#   scripts/aapt2-bauen.sh <ziel>   baut <ziel>/aapt2 und legt die Lizenztexte nach <ziel>/aapt2-lizenzen/
#
# Gebaut wird wie im Docker-Bild auf Debian 12 (die CI tut dasselbe in node:22-bookworm-slim) mit den Paketen aus
# `AAPT2_BAU_PAKETE`; rund 6 GB Platz. Das Programm braucht danach nur glibc, libstdc++ und zlib aus /usr.
set -euo pipefail

AAPT2_FASSUNG=37.0.0
AOSP_TAG=android-17.0.0_r1
AOSP=https://android.googlesource.com
REZEPT=https://github.com/Commit451/android-arm-build-tools
REZEPT_COMMIT=be4bf8f404bee04ffbe92e221b1ab60846a3e681
AAPT2_BAU_PAKETE="ca-certificates git python3 build-essential cmake ninja-build bison flex gperf pkg-config zlib1g-dev"

# <pfad unter src/> <repo bei AOSP> <commit des Tags>
STAENDE="
abseil-cpp           platform/external/abseil-cpp            0000000000000000000000000000000000000000
adb                  platform/packages/modules/adb           0000000000000000000000000000000000000000
aidl                 platform/system/tools/aidl              0000000000000000000000000000000000000000
art                  platform/art                            0000000000000000000000000000000000000000
avb                  platform/external/avb                   0000000000000000000000000000000000000000
base                 platform/frameworks/base                0000000000000000000000000000000000000000
boringssl            platform/external/boringssl             0000000000000000000000000000000000000000
brotli               platform/external/brotli                0000000000000000000000000000000000000000
build                platform/build                          0000000000000000000000000000000000000000
core                 platform/system/core                    0000000000000000000000000000000000000000
dalvik               platform/dalvik                         0000000000000000000000000000000000000000
development          platform/development                    0000000000000000000000000000000000000000
e2fsprogs            platform/external/e2fsprogs             0000000000000000000000000000000000000000
expat                platform/external/expat                 0000000000000000000000000000000000000000
extras               platform/system/extras                  0000000000000000000000000000000000000000
f2fs-tools           platform/external/f2fs-tools            0000000000000000000000000000000000000000
fmtlib               platform/external/fmtlib                0000000000000000000000000000000000000000
googletest           platform/external/googletest            0000000000000000000000000000000000000000
incremental_delivery platform/system/incremental_delivery    0000000000000000000000000000000000000000
jsoncpp              platform/external/jsoncpp               0000000000000000000000000000000000000000
libbase              platform/system/libbase                 0000000000000000000000000000000000000000
libpng               platform/external/libpng                0000000000000000000000000000000000000000
libusb               platform/external/libusb                0000000000000000000000000000000000000000
libziparchive        platform/system/libziparchive           0000000000000000000000000000000000000000
logging              platform/system/logging                 0000000000000000000000000000000000000000
lz4                  platform/external/lz4                   0000000000000000000000000000000000000000
mdnsresponder        platform/external/mdnsresponder         0000000000000000000000000000000000000000
mkbootimg            platform/system/tools/mkbootimg         0000000000000000000000000000000000000000
native               platform/frameworks/native              0000000000000000000000000000000000000000
openscreen           platform/external/openscreen            0000000000000000000000000000000000000000
pcre                 platform/external/pcre                  0000000000000000000000000000000000000000
protobuf             platform/external/protobuf              0000000000000000000000000000000000000000
selinux              platform/external/selinux               0000000000000000000000000000000000000000
soong                platform/build/soong                    0000000000000000000000000000000000000000
sqlite               platform/external/sqlite                0000000000000000000000000000000000000000
tinyxml2             platform/external/tinyxml2              0000000000000000000000000000000000000000
unwinding            platform/system/unwinding               0000000000000000000000000000000000000000
zopfli               platform/external/zopfli                0000000000000000000000000000000000000000
zstd                 platform/external/zstd                  0000000000000000000000000000000000000000
"
# Was aapt2 enthält (aapt2.cmake des Rezepts) – je Repo ein Lizenztext, sonst Abbruch
GELINKT="base core libbase logging libziparchive incremental_delivery soong selinux protobuf abseil-cpp boringssl expat libpng pcre fmtlib"

ZIEL="${1:?Ziel fehlt – scripts/aapt2-bauen.sh <ziel>}"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
R="$ARBEIT/rezept"

# <ordner> <url> <ref> [<refspec>] – nur die eine Fassung, ohne Verlauf; gibt den Commit aus
hole() {
  local versuch
  git init -q "$1" || return 1
  for versuch in 1 2 3; do
    git -C "$1" fetch -q --depth 1 "$2" "${4:-$3}" && break
    [ "$versuch" = 3 ] && return 1
    sleep $((versuch * 5))
  done
  git -C "$1" -c advice.detachedHead=false checkout -q FETCH_HEAD || return 1
  git -C "$1" rev-parse HEAD
}

stand="$(hole "$R" "$REZEPT" "$REZEPT_COMMIT")" || { echo "aapt2: Rezept $REZEPT_COMMIT nicht geholt – Abbruch" >&2; exit 1; }
[ "$stand" = "$REZEPT_COMMIT" ] || { echo "aapt2: Rezept zeigt auf $stand statt $REZEPT_COMMIT – Abbruch" >&2; exit 1; }

# Alle Repos holen (samt Tag, den fetch_sources.py sucht) und prüfen – jede Abweichung nennen, dann abbrechen
falsch=0
pfade=""
while read -r pfad repo commit; do
  [ -n "$pfad" ] || continue
  pfade="$pfade$pfad"$'\n'
  if ! stand="$(hole "$R/src/$pfad" "$AOSP/$repo" "" "+refs/tags/$AOSP_TAG:refs/tags/$AOSP_TAG")"; then
    echo "aapt2: $pfad nicht geholt ($AOSP/$repo $AOSP_TAG)" >&2
    falsch=1
  elif [ "$stand" != "$commit" ]; then
    echo "aapt2: $pfad zeigt auf $stand statt $commit" >&2
    falsch=1
  fi
done <<< "$STAENDE"
[ "$falsch" = 0 ] || { echo "aapt2: Quellen nicht wie erwartet – Abbruch" >&2; exit 1; }

# Das Rezept darf nichts holen, was hier nicht geprüft ist: seine Liste muss genau unsere sein
liste="$(python3 -I -c 'import json, sys; print("\n".join(sorted(r["path"].removeprefix("src/") for r in json.load(open(sys.argv[1])))))' "$R/repos.json")"
[ "$liste" = "$(printf '%s' "$pfade" | LC_ALL=C sort)" ] || { echo "aapt2: repos.json des Rezepts nennt andere Repos – Abbruch" >&2; exit 1; }

# fetch_sources.py findet jedes Repo am Tag vor (klont nichts) und legt Ergänzungen und Patches an – ein „!!“ heißt, etwas
# davon fehlt oder passt nicht mehr
AOSP_BRANCH="$AOSP_TAG" SRC_DIR="$R/src" REPOS_JSON="$R/repos.json" PATCH_DIR="$R/patches" JOBS=1 \
  python3 -I "$R/scripts/fetch_sources.py" > "$ARBEIT/quellen.log" 2>&1 || { cat "$ARBEIT/quellen.log" >&2; exit 1; }
if grep -q ": cloned$" "$ARBEIT/quellen.log" || grep -q "!!" "$ARBEIT/quellen.log" \
  || [ "$(grep -c "already cloned (ref matches)" "$ARBEIT/quellen.log")" != "$(printf '%s' "$pfade" | wc -l)" ]; then
  cat "$ARBEIT/quellen.log" >&2
  echo "aapt2: das Rezept hat selbst geholt oder nicht alles angelegt – Abbruch" >&2
  exit 1
fi

# protoc für diesen Rechner, dann aapt2 – mit -k 0 nennt ein gescheiterter Bau alle Fehler auf einmal
N="$(nproc)"
{
  cmake -S "$R/src/protobuf" -B "$ARBEIT/protoc" -G Ninja -DCMAKE_BUILD_TYPE=Release -Dprotobuf_BUILD_TESTS=OFF \
    -Dprotobuf_BUILD_EXAMPLES=OFF -DABSL_PROPAGATE_CXX_STD=ON
  cmake --build "$ARBEIT/protoc" -j "$N" --target protoc
  protoc="$(find "$ARBEIT/protoc" -type f -name protoc -perm -u+x | head -n 1)"
  [ -n "$protoc" ] || protoc="$(find "$ARBEIT/protoc" -type f -name 'protoc-[0-9]*' -perm -u+x | head -n 1)"
  cmake -S "$R" -B "$ARBEIT/bau" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ \
    -DPROTOC_PATH="$protoc"
  cmake --build "$ARBEIT/bau" -j "$N" --target aapt2 -- -k 0
} > "$ARBEIT/bau.log" 2>&1 || {
  grep -E "error:|Error |undefined reference|CMake Error" "$ARBEIT/bau.log" | sort -u | head -n 60 >&2 || true
  tail -n 30 "$ARBEIT/bau.log" >&2
  echo "aapt2: Bau gescheitert" >&2
  exit 1
}

PROGRAMM="$ARBEIT/bau/bin/build-tools/aapt2"
# Nur glibc, libstdc++ und zlib – in der Sandbox liegen sie unter /usr; alles andere ist hineingelinkt
if ldd "$PROGRAMM" | grep -vqE 'linux-vdso|ld-linux|lib(c|m|dl|rt|pthread|stdc\+\+|gcc_s|z)\.so'; then
  echo "aapt2 braucht weitere Bibliotheken:" >&2
  ldd "$PROGRAMM" >&2
  exit 1
fi
"$PROGRAMM" version > "$ARBEIT/fassung.txt" 2>&1 || { cat "$ARBEIT/fassung.txt" >&2; exit 1; }

mkdir -p "$ZIEL/aapt2-lizenzen"
install -m 0755 "$PROGRAMM" "$ZIEL/aapt2"
strip "$ZIEL/aapt2"
install -m 0644 "$R/LICENSE" "$ZIEL/aapt2-lizenzen/android-arm-build-tools"
for repo in $GELINKT; do
  text=""
  for name in NOTICE LICENSE LICENSE.txt LICENSE.md LICENSE.rst LICENCE COPYING; do
    [ -f "$R/src/$repo/$name" ] && { text="$R/src/$repo/$name"; break; }
  done
  [ -n "$text" ] || { echo "aapt2: Lizenztext von $repo fehlt – Abbruch" >&2; exit 1; }
  install -m 0644 "$text" "$ZIEL/aapt2-lizenzen/$repo"
done
echo "aapt2 $AAPT2_FASSUNG ($(head -n 1 "$ARBEIT/fassung.txt")) nach $ZIEL"
