/**
 * Build: freedom.html — eine einzige Datei (JS + CSS inline).
 *
 *   node build.mjs
 *
 * Ergebnis: dist/freedom.html + dist/manifest.json
 */
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

await mkdir(join(root, "dist"), { recursive: true });

// 1. JS bundeln (iife, browser)
const result = await build({
  entryPoints: [join(root, "src/shell/app.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  // globalName: macht die exports (boot) unter diesem Namen global verfuegbar
  globalName: "freedomApp",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
  // Node-Builtins durch Browser-Pendants ersetzen
  alias: {
    "node:crypto": join(root, "src/shell/shims/crypto.ts"),
    "node:fs/promises": join(root, "src/shell/shims/fs-promises.ts"),
    "node:child_process": join(root, "src/shell/shims/node-builtins.ts"),
    "node:util": join(root, "src/shell/shims/node-builtins.ts"),
    // turbo-sdk/arweave-mirror ziehen node-builtins — browser-shim
    "node:fs": join(root, "src/shell/shims/node-builtins.ts"),
    fs: join(root, "src/shell/shims/node-builtins.ts"),
    stream: join(root, "src/shell/shims/node-builtins.ts"),
    "node:stream": join(root, "src/shell/shims/node-builtins.ts"),
    path: join(root, "src/shell/shims/node-builtins.ts"),
    crypto: join(root, "src/shell/shims/crypto.ts"),
    // RS-lib ist CJS mit node-fs — browser nutzt reine GF(256)-Implementierung
    "wasm-reed-solomon-erasure": join(root, "src/shell/shims/reed-solomon.ts"),
  },
  // turbo-sdk NUR für node (arweave-mirror läuft nie im browser) — dynamischer
  // import bleibt external und wird im browser zu einem laufzeit-fehler, der
  // abgefangen wird (mirror ist opt-in via ARWEAVE_MIRROR=1, nur node).
  external: ["@ardrive/turbo-sdk"],
  logLevel: "warning",
});
const js = result.outputFiles[0].text;

// 2. CSS lesen
const css = await readFile(join(root, "src/shell/app.css"), "utf8");

// 2b. Polyfills fuer aeltere Browser + Node-Global-Shims
const polyfills = `
// Node-"process" gibt es im Browser nicht — Adapter lesen process.env.* zur
// Laufzeit (z. B. HTLC_PROGRAM_ID). Shim muss VOR dem Bundle laufen.
if (typeof process === "undefined") {
  var process = { env: {}, browser: true, version: "", versions: {}, nextTick: (fn)=>Promise.resolve().then(fn) };
}
// Buffer-Shim: Das Protokoll und @solana/web3.js erwarten einen ECHTEN Buffer.
//
// Die fruehere Fassung gab ein Fantasie-Objekt mit .__u8 zurueck. Das ueberlebt
// ein Buffer.from(x).toString('hex'), faellt aber ueberall dort um, wo eine
// Bibliothek den Wert als Uint8Array behandelt (slice, set, byteLength,
// Buffer.isBuffer, Uebergabe an WebCrypto oder an eine Transaktions-
// Serialisierung). Genau das ist der Grund, warum der Solana-Pfad im Browser
// bisher unzuverlaessig war.
//
// Jetzt: eine Klasse, die von Uint8Array ERBT. Damit ist jeder Buffer auch ein
// echtes Uint8Array und besteht alle Struktur-Pruefungen fremder Bibliotheken.
if (typeof globalThis.Buffer === "undefined") {
  const HEX = "0123456789abcdef";
  class FBuffer extends Uint8Array {
    static isBuffer(b) { return b instanceof FBuffer; }
    static alloc(n, fill = 0) { const b = new FBuffer(n); if (fill) b.fill(fill); return b; }
    static allocUnsafe(n) { return new FBuffer(n); }

    static from(data, enc) {
      if (typeof data === "string") {
        if (enc === "hex") {
          const clean = data.length % 2 ? "0" + data : data;
          const out = new FBuffer(clean.length / 2);
          for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
          return out;
        }
        if (enc === "base64") {
          const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
          const out = new FBuffer(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
        return new FBuffer(new TextEncoder().encode(data));
      }
      if (data instanceof ArrayBuffer) return new FBuffer(data);
      if (ArrayBuffer.isView(data)) {
        return new FBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
      if (Array.isArray(data)) return new FBuffer(data);
      throw new TypeError("Buffer.from: nicht unterstuetzter Typ");
    }

    static concat(list, total) {
      const len = total ?? list.reduce((s, b) => s + b.length, 0);
      const out = new FBuffer(len);
      let off = 0;
      for (const b of list) { out.set(b.subarray(0, Math.min(b.length, len - off)), off); off += b.length; if (off >= len) break; }
      return out;
    }

    toString(enc, start, end) {
      const view = this.subarray(start ?? 0, end ?? this.length);
      if (enc === "hex") { let s = ""; for (const b of view) s += HEX[b >> 4] + HEX[b & 15]; return s; }
      if (enc === "base64") { let s = ""; for (const b of view) s += String.fromCharCode(b); return btoa(s); }
      return new TextDecoder().decode(view);
    }

    // Buffer.slice kopiert nicht, es teilt den Speicher — wie subarray.
    slice(start, end) { return new FBuffer(this.buffer, this.byteOffset + (start ?? 0), (end ?? this.length) - (start ?? 0)); }
    equals(other) { return this.length === other.length && this.every((v, i) => v === other[i]); }
    readUInt8(o = 0) { return this[o]; }
    writeUInt8(v, o = 0) { this[o] = v & 0xff; return o + 1; }
    readUInt32LE(o = 0) { return (this[o] | (this[o+1]<<8) | (this[o+2]<<16)) + this[o+3]*0x1000000; }
    readUInt32BE(o = 0) { return this[o]*0x1000000 + ((this[o+1]<<16) | (this[o+2]<<8) | this[o+3]); }
    writeUInt32LE(v, o = 0) { this[o]=v&0xff; this[o+1]=(v>>>8)&0xff; this[o+2]=(v>>>16)&0xff; this[o+3]=(v>>>24)&0xff; return o+4; }
    writeUInt32BE(v, o = 0) { this[o]=(v>>>24)&0xff; this[o+1]=(v>>>16)&0xff; this[o+2]=(v>>>8)&0xff; this[o+3]=v&0xff; return o+4; }
  }
  globalThis.Buffer = FBuffer;
}
if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
if (!Array.prototype.at) Array.prototype.at = function(i){ i = Math.trunc(i) || 0; if (i<0) i += this.length; return this[i]; };
if (!String.prototype.replaceAll) String.prototype.replaceAll = function(a,b){ return this.split(a).join(b); };
`;

// 3. HTML-Template mit inline JS+CSS
let html = await readFile(join(root, "src/shell/index.html"), "utf8");
// Ersetzen per Funktion statt per String: Ein String als Ersatz wuerde
// Muster wie "$&" oder "$'" im Bundle als Sonderzeichen deuten.
html = html.replace("<!-- APP_CSS -->", () => `<style>\n${css}\n</style>`);
const scriptBody = `\n${polyfills}\n${js}\nwindow.freedomApp.boot();\n`;
html = html.replace("<!-- APP_JS -->", () => `<script>${scriptBody}</script>`);

// Content-Security-Policy (Schritt 0.3 im Ausbauplan).
// Nur genau dieses eine eingebettete Skript darf laufen – erkannt an seinem
// SHA-256-Hash. Eingeschleuste Skripte und Inline-Handler (onerror=…) werden
// damit blockiert, selbst wenn irgendwo ein Escaping fehlt. Verbindungen
// bleiben offen (Relays, RPC, LNURL, Blossom sind frei waehlbar); der Schutz
// liegt bei script-src.
{
  const { createHash: h } = await import("node:crypto");
  const scriptHash = h("sha256").update(scriptBody, "utf8").digest("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline' https:",
    "img-src https: data: blob:",
    "media-src https: data: blob:",
    "font-src https: data:",
    "connect-src https: http: wss: ws: data: blob:",
    "worker-src blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (!/<head[^>]*>/i.test(html)) throw new Error("build: kein <head> fuer die CSP gefunden");
  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${meta}`);
  if ((html.match(/<script[\s>]/gi) ?? []).length !== 1) {
    throw new Error("build: genau ein <script> erwartet – sonst deckt der CSP-Hash nicht alles ab");
  }
}

await writeFile(join(root, "dist/freedom.html"), html);
await writeFile(
  join(root, "dist/manifest.json"),
  await readFile(join(root, "src/shell/manifest.json"), "utf8"),
);

// Pruefsumme ausgeben: Sie gehoert in das signierte Release-Manifest, damit
// eine weitergereichte Kopie ueberpruefbar ist.
const { createHash } = await import("node:crypto");
const sha = createHash("sha256").update(html).digest("hex");
console.log(`dist/freedom.html (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`sha256: ${sha}`);
await (await import("node:fs/promises")).writeFile(
  "dist/freedom.html.sha256",
  `${sha}  freedom.html\n`,
);
