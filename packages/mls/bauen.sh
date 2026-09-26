#!/usr/bin/env bash
# Baut den MLS-Baustein (Schritt 2.2b): MDK auf festem Stand + mdk.patch +
# unsere Crate (crate/) → WASM. Ergebnis in dist/: freedom_mls.js (Glue),
# freedom_mls.d.ts, freedom_mls_bg.wasm.gz und SHA256SUMS (über die
# unkomprimierte WASM-Datei – gzip-Ausgaben unterscheiden sich je Version).
#
# Reproduzierbar: fester MDK-Stand, eingecheckte Cargo.lock, Rust aus MDKs
# rust-toolchain.toml, wasm-bindgen 0.2.129, feste Pfade (remap-path-prefix).
# Die CI baut nach und vergleicht (.github/workflows/mls.yml).
#
#   bash bauen.sh            # baut und schreibt dist/
#   bash bauen.sh --pruefen  # baut und vergleicht mit dist/, schreibt nichts
#   MLS_LOCK_ERNEUERN=1 bash bauen.sh   # nach einem neuen MDK_REV: Cargo.lock neu
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
MDK_REV=a19feca49b42d5d9c86b31707f5797123d5349c2
MDK_QUELLE="${MDK_QUELLE:-https://github.com/marmot-protocol/mdk}"
BAU="${MLS_BAU:-/tmp/freedom-mls-bau}"
WASM_BINDGEN_VERSION=0.2.129

if [ "$(wasm-bindgen --version 2>/dev/null)" != "wasm-bindgen $WASM_BINDGEN_VERSION" ]; then
  echo "wasm-bindgen $WASM_BINDGEN_VERSION fehlt: cargo install wasm-bindgen-cli --version $WASM_BINDGEN_VERSION --locked" >&2
  exit 1
fi

if [ ! -d "$BAU/mdk/.git" ]; then
  rm -rf "$BAU/mdk"; mkdir -p "$BAU"
  git clone --quiet "$MDK_QUELLE" "$BAU/mdk"
fi
cd "$BAU/mdk"
git cat-file -e "$MDK_REV^{commit}" 2>/dev/null || git fetch --quiet origin "$MDK_REV"
git checkout --quiet --force "$MDK_REV"
git clean -fdq -e target
git apply "$HIER/mdk.patch"
cp -r "$HIER/crate" crates/freedom-mls
cp "$HIER/Cargo.lock" Cargo.lock

RUST_VERSION="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)"
rustup toolchain install "$RUST_VERSION" --profile minimal --target wasm32-unknown-unknown >/dev/null
export RUSTUP_TOOLCHAIN="$RUST_VERSION"
export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
export RUSTFLAGS="--remap-path-prefix=$BAU=/bau --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$(rustc --print sysroot)=/rust"
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z CARGO_PROFILE_RELEASE_LTO=true CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
  CARGO_PROFILE_RELEASE_STRIP=true CARGO_PROFILE_RELEASE_PANIC=abort CARGO_PROFILE_RELEASE_DEBUG=false \
  CARGO_PROFILE_RELEASE_INCREMENTAL=false
if [ "${MLS_LOCK_ERNEUERN:-}" = "1" ]; then
  cargo build --release --target wasm32-unknown-unknown -p freedom-mls
  cp Cargo.lock "$HIER/Cargo.lock"
else
  cargo build --locked --release --target wasm32-unknown-unknown -p freedom-mls
fi
rm -rf "$BAU/pkg"
wasm-bindgen --target web --out-dir "$BAU/pkg" target/wasm32-unknown-unknown/release/freedom_mls.wasm

cd "$BAU/pkg"
sha256sum freedom_mls.js freedom_mls.d.ts freedom_mls_bg.wasm > SHA256SUMS
if [ "${1:-}" = "--pruefen" ]; then
  (cd "$HIER/dist" && gzip -dc freedom_mls_bg.wasm.gz > "$BAU/eingecheckt.wasm")
  cp "$HIER/dist/freedom_mls.js" "$HIER/dist/freedom_mls.d.ts" "$BAU/"
  (cd "$BAU" && sed 's/freedom_mls_bg.wasm$/eingecheckt.wasm/' "$BAU/pkg/SHA256SUMS" | sha256sum -c -) || {
    echo "Nachbau weicht von dist/ ab" >&2; exit 1; }
  diff -q "$BAU/pkg/SHA256SUMS" "$HIER/dist/SHA256SUMS"
  echo "Nachbau stimmt mit dist/ überein."
else
  mkdir -p "$HIER/dist"
  cp freedom_mls.js freedom_mls.d.ts SHA256SUMS "$HIER/dist/"
  gzip -9 -n -c freedom_mls_bg.wasm > "$HIER/dist/freedom_mls_bg.wasm.gz"
  cat SHA256SUMS
fi
