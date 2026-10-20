#!/usr/bin/env bash
# Tor-Brücken für die Hülle (B-33a, Entscheidungen PT2 A, PT3 A, `docs/TOR-BRUECKEN-ENTWURF.md` V1): baut
# `snowflake-client` und den WebTunnel-Client aus den Quellen – nie herunterladen.
#
#   scripts/pt-bauen.sh <ziel>              baut alle Plattformen nach <ziel>/<plattform>/, dazu Lizenzen und SHA256SUMS
#   scripts/pt-bauen.sh --pruefen <ziel>    baut zweimal an zwei Pfaden – verschiedene Summen: Fehler (CI)
#
# Fest ist: Go (GO_FASSUNG, über GOTOOLCHAIN), die Module und ihre Abhängigkeiten (go.sum der Projekte, geprüft gegen
# sum.golang.org), ohne cgo (außer Android, unten), `-trimpath -buildvcs=false`, ohne Build-Id. Die Quellen kommen über proxy.golang.org
# (gitlab.torproject.org selbst ist aus der Entwicklungsumgebung gesperrt). Lizenzen: Snowflake BSD-3-Clause, WebTunnel
# MIT, Abhängigkeiten frei (BSD, MIT, Apache-2.0, CC0, 0BSD) – ihre Texte liegen je Plattform in `lizenzen/`.
#
# Android (B-33d) mit cgo: Ohne cgo fragt Go dort 127.0.0.1:53 nach Namen (es gibt kein /etc/resolv.conf; Go selbst:
# „DNS requests don't work on Android, so prefer the cgo resolver“) – Snowflake erreichte weder CDN noch STUN, WebTunnel
# nicht seine Domain. Mit cgo fragt das Programm das System (wie jede App). Dafür ein festes NDK (NDK_FASSUNG, gleich
# NDK_VERSION in launcher.yml; Ordner aus PT_NDK oder $ANDROID_HOME/ndk/<fassung>), API 24 wie die Hülle, Seiten bis
# 16 KB. Fehlt es, bricht der Bau ab – nie still ohne cgo.
set -euo pipefail

GO_FASSUNG=go1.24.7
PT=gitlab.torproject.org/tpo/anti-censorship/pluggable-transports
SNOWFLAKE="$PT/snowflake/v2@v2.14.1"
WEBTUNNEL="$PT/webtunnel@v0.0.7"
# Plattformen der Hülle: Linux (x86_64, arm64), Windows (x86_64), Android (arm64, B-33d)
# (PT_PLATTFORMEN wählt zum Ausprobieren weniger, etwa ohne NDK: "linux/amd64 windows/amd64")
read -ra PLATTFORMEN <<< "${PT_PLATTFORMEN:-linux/amd64 linux/arm64 windows/amd64 android/arm64}"
NDK_FASSUNG=27.3.13750724
NDK="${PT_NDK:-${ANDROID_HOME:-/fehlt}/ndk/$NDK_FASSUNG}"

MODUS=bauen
if [ "${1:-}" = "--pruefen" ]; then MODUS=pruefen; shift; fi
ZIEL="${1:?Ziel fehlt – scripts/pt-bauen.sh [--pruefen] <ziel>}"

# Das NDK nur in der festen Fassung – ein anderes ergäbe andere Bytes
if [[ " ${PLATTFORMEN[*]} " == *" android/"* ]]; then
  grep -Eq "^Pkg\.Revision *= *${NDK_FASSUNG//./\\.} *$" "$NDK/source.properties" 2>/dev/null \
    || { echo "Android braucht das NDK $NDK_FASSUNG (PT_NDK oder \$ANDROID_HOME/ndk/$NDK_FASSUNG) – nicht gefunden: $NDK" >&2; exit 1; }
fi

# Umgebung je Plattform: Android mit cgo über den Compiler des NDK, sonst ohne
cgo_umgebung() { # <goos>
  if [ "$1" = android ]; then
    echo "CGO_ENABLED=1 CC=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
  else
    echo "CGO_ENABLED=0"
  fi
}

# Ein Programm eines Moduls bauen: `go install <modul>/<paket>@<version>` nimmt go.mod und go.sum des Moduls selbst
baue() { # <gopath> <goos> <goarch> <modul@version> <paket> <name> <ausgabe>
  local gp=$1 goos=$2 goarch=$3 modul=$4 paket=$5 name=$6 aus=$7 extra=""
  # Snowflake greift über wlynxg/anet auf Interna von net zu – unter Android nur so (Befund im Entwurf)
  if [ "$goos" = android ] && [ "$name" = snowflake-client ]; then extra="-checklinkname=0"; fi
  # Android lädt Programme mit 16-KB-Seiten nur, wenn die Abschnitte so ausgerichtet sind
  if [ "$goos" = android ]; then extra="$extra -extldflags=-Wl,-z,max-page-size=16384"; fi
  # shellcheck disable=SC2046 # die Zuweisungen aus cgo_umgebung() sind Wörter für env
  env $(cgo_umgebung "$goos") GOPATH="$gp" GOMODCACHE="$gp/mod" GOTOOLCHAIN="$GO_FASSUNG" GOFLAGS="-mod=mod" GOOS="$goos" \
    GOARCH="$goarch" GOPROXY="https://proxy.golang.org" GOSUMDB="sum.golang.org" \
    go install -trimpath -buildvcs=false -ldflags="-s -w -buildid= $extra" "${modul%@*}/$paket@${modul#*@}"
  local bin="$gp/bin/client"
  [ "$goos/$goarch" = "$(go env GOOS)/$(go env GOARCH)" ] || bin="$gp/bin/${goos}_${goarch}/client"
  [ "$goos" = windows ] && bin="$bin.exe"
  mkdir -p "$aus"
  cp "$bin" "$aus/$name$([ "$goos" = windows ] && echo .exe || true)"
  rm -f "$bin"
}

# Lizenztexte aller Module, die in ein Programm eingehen (`go list -deps` im Quellordner des Moduls)
lizenzen() { # <gopath> <goos> <goarch> <modul@version> <paket> <ausgabe>
  local gp=$1 goos=$2 goarch=$3 modul=$4 paket=$5 aus=$6 quelle
  # Pfade im Modul-Cache: Großbuchstaben als „!klein“ (wie Go sie ablegt)
  quelle="$gp/mod/$(echo "${modul%@*}" | sed 's/[A-Z]/!\L&/g')@${modul#*@}"
  local module
  # shellcheck disable=SC2046
  module="$(env $(cgo_umgebung "$goos") GOPATH="$gp" GOMODCACHE="$gp/mod" GOTOOLCHAIN="$GO_FASSUNG" GOFLAGS="-mod=mod" GOOS="$goos" \
    GOARCH="$goarch" go list -C "$quelle" -deps -f '{{if .Module}}{{.Module.Path}} {{.Module.Dir}}{{end}}' "./$paket" | sort -u)"
  while read -r pfad ordner; do
    local gefunden=0
    for datei in "$ordner"/LICENSE* "$ordner"/LICENCE* "$ordner"/COPYING* "$ordner"/NOTICE*; do
      [ -f "$datei" ] || continue
      mkdir -p "$aus/lizenzen/$pfad"
      # Im Modul-Cache sind Dateien nur lesbar – `cp` übernähme das, und das zweite Programm (gleiches Modul) scheiterte
      install -m 0644 "$datei" "$aus/lizenzen/$pfad/${datei##*/}"
      gefunden=1
    done
    # Ohne Lizenztext dürfen wir das Programm nicht weitergeben – dann lieber kein Bau
    [ "$gefunden" = 1 ] || { echo "kein Lizenztext: $pfad" >&2; exit 1; }
  done <<< "$module"
}

bauealles() { # <ziel> <gopath>
  local ziel=$1 gp=$2
  rm -rf "$ziel"
  for p in "${PLATTFORMEN[@]}"; do
    local goos=${p%/*} goarch=${p#*/} aus="$ziel/${p/\//-}"
    baue "$gp" "$goos" "$goarch" "$SNOWFLAKE" client snowflake-client "$aus"
    baue "$gp" "$goos" "$goarch" "$WEBTUNNEL" main/client webtunnel-client "$aus"
    lizenzen "$gp" "$goos" "$goarch" "$SNOWFLAKE" client "$aus"
    lizenzen "$gp" "$goos" "$goarch" "$WEBTUNNEL" main/client "$aus"
  done
  ( cd "$ziel" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sed 's#  \./#  #' > SHA256SUMS )
}

GP="$(mktemp -d)"
trap 'chmod -R u+w "$GP" 2>/dev/null; rm -rf "$GP"' EXIT
bauealles "$ZIEL" "$GP/a"
if [ "$MODUS" = pruefen ]; then
  bauealles "$GP/zwei" "$GP/b"
  if ! cmp -s "$ZIEL/SHA256SUMS" "$GP/zwei/SHA256SUMS"; then
    diff "$ZIEL/SHA256SUMS" "$GP/zwei/SHA256SUMS" || true
    echo "nicht reproduzierbar: zwei Builds, verschiedene Summen" >&2
    exit 1
  fi
  echo "reproduzierbar: zweimal dieselben Summen"
fi
grep -v '/lizenzen/' "$ZIEL/SHA256SUMS"
du -sh "$ZIEL"/* | sort -k2
