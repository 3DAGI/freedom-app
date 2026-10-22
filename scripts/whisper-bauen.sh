#!/usr/bin/env bash
# whisper-cli für Text aus Sprache (B-38b3, SP-W1 A, `docs/SPRACHE-ENTWURF.md`): aus den Quellen in fester Fassung bauen –
# nie ein fertiges Programm herunterladen. whisper.cpp steht unter MIT; der Text liegt neben dem Programm.
#
#   scripts/whisper-bauen.sh <ziel>                baut <ziel>/whisper-cli und legt <ziel>/whisper.cpp-LICENSE dazu
#   scripts/whisper-bauen.sh <ziel> --testmodell   dazu <ziel>/for-tests-ggml-tiny.bin aus dem Repo (Gewichte ohne Sinn –
#                                                  nur für den Test mit echtem Programm, WHISPER_TEST_CLI)
#   WHISPER_CUDA=1 scripts/whisper-bauen.sh <ziel> mit CUDA (GX10; braucht das CUDA-Toolkit, nvcc im PATH)
#
# Fest ist: Fassung und Commit (geprüft nach dem Holen), ggml statisch, ohne OpenMP (das Programm braucht dann nur
# libc und libstdc++ – in der Sandbox liegen sie unter /usr), ohne Server, ohne SDL und curl. Gebaut wird für den
# Prozessor, auf dem es läuft (ggml-Vorgabe) – das Bild baut der Betreiber auf seinem Rechner.
set -euo pipefail

WHISPER_FASSUNG=v1.9.5
WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
QUELLE=https://github.com/ggml-org/whisper.cpp

ZIEL="${1:?Ziel fehlt – scripts/whisper-bauen.sh <ziel> [--testmodell]}"
TESTMODELL=0
[ "${2:-}" = "--testmodell" ] && TESTMODELL=1

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$WHISPER_FASSUNG" "$QUELLE" "$ARBEIT/whisper.cpp"
STAND="$(git -C "$ARBEIT/whisper.cpp" rev-parse HEAD)"
[ "$STAND" = "$WHISPER_COMMIT" ] || { echo "whisper.cpp $WHISPER_FASSUNG zeigt auf $STAND statt $WHISPER_COMMIT – Abbruch" >&2; exit 1; }

CUDA=OFF
[ "${WHISPER_CUDA:-0}" = "1" ] && CUDA=ON
cmake -S "$ARBEIT/whisper.cpp" -B "$ARBEIT/bau" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF \
  -DGGML_CUDA="$CUDA" -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF > "$ARBEIT/cmake.log"
cmake --build "$ARBEIT/bau" --target whisper-cli -j "$(nproc)" > "$ARBEIT/bau.log"

mkdir -p "$ZIEL"
install -m 0755 "$ARBEIT/bau/bin/whisper-cli" "$ZIEL/whisper-cli"
install -m 0644 "$ARBEIT/whisper.cpp/LICENSE" "$ZIEL/whisper.cpp-LICENSE"
[ "$TESTMODELL" = "1" ] && install -m 0644 "$ARBEIT/whisper.cpp/models/for-tests-ggml-tiny.bin" "$ZIEL/for-tests-ggml-tiny.bin"
# Nur libc, libstdc++, libm, libgcc – sonst liefe es in der Sandbox (nur /usr und die Wurzel lesbar) nicht überall
if ldd "$ZIEL/whisper-cli" | grep -vqE 'linux-vdso|ld-linux|lib(c|m|stdc\+\+|gcc_s)\.so|lib(cuda|cudart|cublas|cublasLt)\.so'; then
  echo "whisper-cli braucht weitere Bibliotheken:" >&2
  ldd "$ZIEL/whisper-cli" >&2
  exit 1
fi
echo "whisper-cli $WHISPER_FASSUNG ($WHISPER_COMMIT) nach $ZIEL"
