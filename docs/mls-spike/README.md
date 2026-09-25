# MLS-Spike (Schritt 2.2a)

Wegwerf-Code zur Entscheidung in [`docs/MLS-ENTSCHEIDUNG.md`](../MLS-ENTSCHEIDUNG.md).
Nicht in die App gebündelt, kein Workspace-Paket, keine Abhängigkeit im Repo – deshalb
liegt er unter `docs/` statt `packages/`: Als Paket unter `packages/*` käme ts-mls ins
Lockfile des ganzen Repos.

## ts-mls (`ts-mls/spike.mts`)

In einem leeren Ordner außerhalb des Repos:

```bash
npm init -y && npm install ts-mls@1.6.4 @noble/hashes @noble/curves @noble/ciphers esbuild
npx tsx spike.mts
npx esbuild spike.mts --bundle --minify --format=esm --platform=browser --outfile=out/spike.js
```

Ergebnis (25.09.2026): Bob liest „Hallo Bob“; nach dem Entfernen scheitert das
Entschlüsseln. Nachricht 326 Byte, 74 ms. Bündel 214 KB, 67 KB gzip.

## OpenMLS per WASM (`openmls-wasm/`)

Derselbe OpenMLS-Fork, den MDK festnagelt, mit einer kleinen wasm-bindgen-Hülle –
die Untergrenze dessen, was MDK im Browser braucht.

```bash
rustup target add wasm32-unknown-unknown   # Toolchain aus rust-toolchain.toml (1.97.1)
cargo build --release --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
wasm-bindgen --target web --out-dir pkg-web target/wasm32-unknown-unknown/release/mls_wasm_spike.wasm
python3 csp-probe.py   # Chromium mit und ohne 'wasm-unsafe-eval'
```

Ergebnis (25.09.2026): Bob liest „Hallo Bob“; nach dem Entfernen liest er nichts
mehr („Message epoch differs“). WASM 1,43 MB, 456 KB gzip, 47 ms. Ohne
`'wasm-unsafe-eval'`: `CompileError … Refused to compile or instantiate WebAssembly`.

## MDK selbst

```bash
git clone --depth 1 https://github.com/marmot-protocol/mdk && cd mdk
rustup target add wasm32-unknown-unknown
CC_wasm32_unknown_unknown=clang cargo build --locked --release --target wasm32-unknown-unknown \
  -p cgka-traits -p cgka-engine -p transport-nostr-peeler
```

Baut in 81 s („compile-only“-Grenze laut MDK-README). Ein Browser-`StorageProvider`
fehlt: MDK hat nur SQLite/SQLCipher.
