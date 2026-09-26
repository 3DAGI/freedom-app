/**
 * `@freedomstack/mls/wasm`: die Engine als `.wasm.gz` – nur im Bundle der App
 * (esbuild, Loader `base64`), dort ein Base64-Text. Node lädt sie nicht; Tests
 * lesen `dist/freedom_mls_bg.wasm.gz` selbst.
 */
declare const wasmGzBase64: string;
export default wasmGzBase64;
