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
abseil-cpp           platform/external/abseil-cpp            474258796bcf112de75a1f89d022ba80b6d0b746
adb                  platform/packages/modules/adb           9084198a2d4b0f6a0f174260fb42da33485b684d
aidl                 platform/system/tools/aidl              9a94664f74536bf28010207fd1804b04c6435e2c
art                  platform/art                            b753cf97923c3695338d21466fa14c57b480a59a
avb                  platform/external/avb                   ba2dec4b035b0a3b61c5f8f8a74d86bcd450b1ee
base                 platform/frameworks/base                94b4c163b7dfe5ce3607f7bb8456f9573f7de57d
boringssl            platform/external/boringssl             0cd1f6a94b670e6b61af95a06e71e690ae8e3262
brotli               platform/external/brotli                a927860e79169483cd0ae4f8ad52937bd2c6d377
build                platform/build                          5ce6f787337d0223710bf7d4a16dbe6d2a35f777
core                 platform/system/core                    545d2487e38192a2ce25040897ced877cf6b4f53
dalvik               platform/dalvik                         5013071e756f89aa2cea97b437af12aacb8d4485
development          platform/development                    4dafd114fab3c3d9543a5aff0ad097f479915176
e2fsprogs            platform/external/e2fsprogs             3eb17241db7cd4408cc1bce9d25b602465ace8ff
expat                platform/external/expat                 9cc7a1ca765061a58e196f101fc601d23845c89a
extras               platform/system/extras                  1289e9b3f282909eec6e80414e14dcc207bda439
f2fs-tools           platform/external/f2fs-tools            c64468cb6397fb63bded0f549438b472f7e7cf88
fmtlib               platform/external/fmtlib                e3bef0ad2e9d4ea38ba3b4b2b59e0514f7025fed
googletest           platform/external/googletest            9bcfc87429e9a9e02ccf2b8424b748f05c4842a5
incremental_delivery platform/system/incremental_delivery    6b853f9e5703a8c90648f82850a3a01d9763e619
jsoncpp              platform/external/jsoncpp               97cca484243e0dadc1da054e63823a5ce7478e54
libbase              platform/system/libbase                 fef4173e19d97cd4b4fc09a06bccbf800d0d3937
libpng               platform/external/libpng                f3997b4b299d808f122ab1d999556d57abf5540d
libusb               platform/external/libusb                70460fc2b43c3948f9caae1fd4eacd2d666a872b
libziparchive        platform/system/libziparchive           bdd41f9c99400f241363b035eb64ad3d5f063c82
logging              platform/system/logging                 d35ba620451b28512f46ebb5421f783fd77968d5
lz4                  platform/external/lz4                   734e07032602e9a72fcc9701028b0aee45147fcd
mdnsresponder        platform/external/mdnsresponder         3e0189c4d3be5272398b1ea6ad2f223a973d0ea2
mkbootimg            platform/system/tools/mkbootimg         4a27dd13adf9846e12d585d6fe99a375ebb58396
native               platform/frameworks/native              ae266dcb706d083868578cfedce381ef44488a07
openscreen           platform/external/openscreen            3f982cf4871df8771c9d4abe6e9a6f8d829b2736
pcre                 platform/external/pcre                  0198d28487954eb6dff5e2d086b3a635a4aa6e26
protobuf             platform/external/protobuf              db06feae31e2a10ffc7ddaccd9e285ff7c13c0ab
selinux              platform/external/selinux               a8c5e74f85f869bf236a01ba24181b78f5e39a52
soong                platform/build/soong                    6722dd8833db7482df1a2543ca3fcf67ddf0f7b1
sqlite               platform/external/sqlite                7961228217942c86f2b0bd2ae4115d00e157fc0b
tinyxml2             platform/external/tinyxml2              33ba115074c80a720826efffab1937d5b355c3b8
unwinding            platform/system/unwinding               31327c70da147fdc069598c4a5fd075aea8d3312
zopfli               platform/external/zopfli                eef2dd4266802ab1b7f26cb72cb1fc9b8ed3f55b
zstd                 platform/external/zstd                  3c0442c12d0f0b612a8869754a3fdf22bf16ef33
"
# Was aapt2 enthält (aapt2.cmake des Rezepts) – je Eintrag ein Lizenztext (in system/core, logging und incremental_delivery
# liegen sie nur in den Ordnern der Bibliotheken, libselinux und libsepol haben verschiedene Lizenzen), sonst Abbruch
GELINKT="base core/libcutils libbase logging/liblog libziparchive incremental_delivery/incfs soong/licenses selinux/libselinux selinux/libsepol protobuf abseil-cpp boringssl expat libpng pcre fmtlib"

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

# Lizenztexte gleich nach dem Holen, vor dem langen Bau – fehlt einer, alle fehlenden auf einmal nennen
mkdir -p "$ARBEIT/lizenzen"
fehlt=""
for eintrag in $GELINKT; do
  text=""
  for name in NOTICE LICENSE LICENSE.txt LICENSE.md LICENSE.rst LICENCE COPYING; do
    [ -f "$R/src/$eintrag/$name" ] && { text="$R/src/$eintrag/$name"; break; }
  done
  # Apache-2.0 ohne eigenen Text (libziparchive – Android.bp nennt nur die Lizenz „Android-Apache-2.0“ aus build/soong):
  # der Text aus frameworks/base
  if [ -z "$text" ] && { [ -f "$R/src/$eintrag/MODULE_LICENSE_APACHE2" ] \
    || grep -qsE '"(SPDX-license-identifier-Apache-2\.0|Android-Apache-2\.0)"' "$R/src/$eintrag/Android.bp"; }; then
    text="$R/src/base/NOTICE"
  fi
  if [ -n "$text" ]; then
    install -m 0644 "$text" "$ARBEIT/lizenzen/${eintrag//\//-}"
  else
    fehlt="$fehlt $eintrag"
    find "$R/src/$eintrag" -maxdepth 2 -type f \( -iname 'notice*' -o -iname 'licen[cs]e*' -o -iname 'copying*' \) >&2 || true
    grep -s -i "licen" "$R/src/$eintrag/Android.bp" | head -n 5 >&2 || true
  fi
done
[ -z "$fehlt" ] || { echo "aapt2: Lizenztext fehlt für$fehlt – Abbruch" >&2; exit 1; }

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

# wo das Rezept es ablegt, sucht es selbst unter bin/ – genau ein Programm dieses Namens
PROGRAMM="$(find "$ARBEIT/bau/bin" -type f -name aapt2 -perm -u+x)"
[ -n "$PROGRAMM" ] && [ "$(printf '%s\n' "$PROGRAMM" | wc -l)" = 1 ] \
  || { echo "aapt2: kein eindeutiges Programm unter bau/bin – Abbruch" >&2; find "$ARBEIT/bau/bin" -type f >&2 || true; exit 1; }
# Nur glibc, libstdc++ und zlib – in der Sandbox liegen sie unter /usr; alles andere ist hineingelinkt
bibliotheken="$(ldd "$PROGRAMM")" || { echo "aapt2: ldd scheitert – Abbruch" >&2; exit 1; }
if printf '%s\n' "$bibliotheken" | grep -vqE 'linux-vdso|ld-linux|lib(c|m|dl|rt|pthread|stdc\+\+|gcc_s|z)\.so'; then
  echo "aapt2 braucht weitere Bibliotheken:" >&2
  printf '%s\n' "$bibliotheken" >&2
  exit 1
fi
"$PROGRAMM" version > "$ARBEIT/fassung.txt" 2>&1 || { cat "$ARBEIT/fassung.txt" >&2; exit 1; }

mkdir -p "$ZIEL/aapt2-lizenzen"
install -m 0755 "$PROGRAMM" "$ZIEL/aapt2"
strip "$ZIEL/aapt2"
install -m 0644 "$R/LICENSE" "$ZIEL/aapt2-lizenzen/android-arm-build-tools"
install -m 0644 "$ARBEIT"/lizenzen/* "$ZIEL/aapt2-lizenzen/"
echo "aapt2 $AAPT2_FASSUNG ($(head -n 1 "$ARBEIT/fassung.txt")) nach $ZIEL"
