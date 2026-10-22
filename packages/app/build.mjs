/**
 * Build: freedom.html — eine einzige Datei (JS + CSS inline).
 *
 *   node build.mjs
 *
 * Ergebnis: dist/freedom.html + dist/manifest.json, dazu dist/freedom-sw.js
 * (seit B-12c: Service Worker nur zum Wecken, eigene Datei neben der App).
 *
 *   FREEDOM_TMA=1 [FREEDOM_TMA_API=https://…] node build.mjs
 *
 * Mini-App für Telegram (`docs/MINI-APP-TMA.md`): nur dist/tma/index.html – der
 * Web-Build bleibt unberührt (bis TMA-1 überschrieb dieser Lauf dist/freedom.html).
 */
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

await mkdir(join(root, "dist"), { recursive: true });

// 0. MLS-Engine (Schritt 2.2b-b): Die .wasm.gz wird als Base64 ins Skript
// gebuendelt (Loader unten). Vorher pruefen, dass sie genau die ist, die
// packages/mls/bauen.sh reproduzierbar baut (SHA256SUMS) – sonst steckte eine
// Engine im Release, die niemand nachbauen kann.
{
  const { gunzipSync } = await import("node:zlib");
  const { createHash: h } = await import("node:crypto");
  const mls = join(root, "../mls/dist");
  const wasm = gunzipSync(await readFile(join(mls, "freedom_mls_bg.wasm.gz")));
  const soll = (await readFile(join(mls, "SHA256SUMS"), "utf8")).match(/^([0-9a-f]{64})\s+freedom_mls_bg\.wasm$/m)?.[1];
  const ist = h("sha256").update(wasm).digest("hex");
  if (!soll || ist !== soll) throw new Error(`build: MLS-WASM passt nicht zu SHA256SUMS (${ist})`);
}

// Mini-App (FREEDOM_TMA=1): eigener Build mit Telegram-SDK. Die Adresse des TMA-Servers
// (FREEDOM_TMA_API, nur https, nur Herkunft) kommt per `define` ins Skript – ein
// eigenes Inline-Skript dafür ließe die CSP nicht zu. Der Web-Build liest beides nie.
const TMA = process.env.FREEDOM_TMA === "1";
const TMA_API = (() => {
  const roh = TMA ? (process.env.FREEDOM_TMA_API ?? "").trim() : "";
  if (!roh) return "";
  const u = new URL(roh);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !["", "/"].includes(u.pathname)) {
    throw new Error("build: FREEDOM_TMA_API muss eine https-Herkunft ohne Pfad sein (z. B. https://knoten.example)");
  }
  return u.origin;
})();
/** Das SDK von Telegram – die einzige fremde Quelle, und nur im Mini-App-Build. */
const TELEGRAM_SDK = "https://telegram.org/js/telegram-web-app.js";

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
  define: {
    "process.env.NODE_ENV": '"production"',
    ...(TMA ? { "globalThis.FREEDOM_TMA": "true", "globalThis.FREEDOM_TMA_API": JSON.stringify(TMA_API) } : {}),
  },
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
  // MLS-Engine gzip-komprimiert als Base64-Text im einen Skript (mls-engine.ts)
  loader: { ".gz": "base64" },
  plugins: [{
    // Die wasm-bindgen-Huelle sucht die .wasm nur ohne uebergebene Bytes neben
    // sich (import.meta.url) – die App uebergibt sie immer. Im iife-Format gibt
    // es import.meta nicht: den toten Zweig ausdruecklich leeren statt warnen.
    name: "mls-ohne-import-meta",
    setup(b) {
      b.onLoad({ filter: /[\\/]mls[\\/]dist[\\/]freedom_mls\.js$/ }, async ({ path }) => {
        const quelle = await readFile(path, "utf8");
        if (quelle.split("import.meta.url").length !== 2) throw new Error("build: MLS-Huelle unerwartet (import.meta)");
        return { contents: quelle.replace("import.meta.url", "undefined"), loader: "js" };
      });
    },
  }, {
    // Gruppenanrufe (B-34c2): livekit-client vorab minifiziert – das Bundle der App ist es nicht,
    // und unminifiziert wüchse freedom.html um 1,4 MB statt etwa 0,6 MB (LK2 A nannte 0,6–0,9 MB).
    name: "livekit-klein",
    setup(b) {
      b.onResolve({ filter: /^livekit-client$/ }, () => ({ path: "livekit-client", namespace: "freedom-lk" }));
      b.onLoad({ filter: /^livekit-client$/, namespace: "freedom-lk" }, async () => {
        const lk = await build({
          stdin: { contents: 'export { BaseKeyProvider, Room, createKeyMaterialFromBuffer } from "livekit-client";', resolveDir: root, loader: "js" },
          bundle: true, format: "esm", platform: "browser", target: "es2020", minify: true, write: false, logLevel: "warning",
          define: { "process.env.NODE_ENV": '"production"' },
        });
        return { contents: lk.outputFiles[0].text, loader: "js", resolveDir: root };
      });
    },
  }, {
    // Reticulum (B-32b2): wie livekit-client vorab minifiziert, sonst wüchse freedom.html um gepackt etwa 160 KB statt
    // etwa 60 KB (W5: unter 150 KB). Alle Pfade in die Bibliothek führen auf EIN Modul – zwei Kopien von
    // `@reticulum/core` hätten getrennte Tabellen für Wege und Ziele (die Bibliothek warnt dann selbst).
    name: "reticulum-klein",
    setup(b) {
      b.onResolve({ filter: /^@reticulum\// }, () => ({ path: "reticulum", namespace: "freedom-ret" }));
      b.onLoad({ filter: /^reticulum$/, namespace: "freedom-ret" }, async () => {
        const ret = await build({
          stdin: {
            contents: [
              'export * from "@reticulum/core";',
              'export { RNodeWebSerialInterface } from "@reticulum/core/src/interfaces/rnode-webserial.js";',
              'export { LXMRouter } from "@reticulum/lxmf/src/router.js";',
              'export { Message } from "@reticulum/lxmf/src/message.js";',
            ].join("\n"),
            resolveDir: root, loader: "js",
          },
          bundle: true, format: "esm", platform: "browser", target: "es2020", minify: true, write: false, logLevel: "warning",
        });
        return { contents: ret.outputFiles[0].text, loader: "js", resolveDir: root };
      });
    },
  }, {
    // Gruppenanrufe (B-34c2): der E2EE-Worker von livekit-client als Text im einen Skript –
    // die App startet ihn aus einer blob:-Adresse (die CSP erlaubt solche Worker seit B-12c). Kein eigenes Netz,
    // keine zweite Datei; gebaut wie das Bundle (iife, minifiziert, bitgleich).
    name: "e2ee-worker",
    setup(b) {
      b.onResolve({ filter: /^freedom:e2ee-worker$/ }, () => ({ path: "e2ee-worker", namespace: "freedom" }));
      b.onLoad({ filter: /^e2ee-worker$/, namespace: "freedom" }, async () => {
        const w = await build({
          stdin: { contents: 'import "livekit-client/e2ee-worker";', resolveDir: root, loader: "js" },
          bundle: true, format: "iife", platform: "browser", target: "es2020", minify: true, write: false, logLevel: "warning",
        });
        return { contents: w.outputFiles[0].text, loader: "text" };
      });
    },
  }],
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

// Mini-App: das SDK von Telegram vor der App (Telegram verlangt es so), sonst nichts.
// TON Connect UI lädt der Build nicht – TON ist noch nicht verdrahtet (TMA-1).
html = html.replace("<!-- TMA_HEADER -->", () =>
  TMA ? `<script src="${TELEGRAM_SDK}"></script>\n  <meta name="telegram-app-name" content="freedom" />` : "");

// Content-Security-Policy (Schritt 0.3 im Ausbauplan).
// Nur genau dieses eine eingebettete Skript darf laufen – erkannt an seinem
// SHA-256-Hash. Eingeschleuste Skripte und Inline-Handler (onerror=…) werden
// damit blockiert, selbst wenn irgendwo ein Escaping fehlt. Verbindungen
// bleiben offen (Relays, RPC, LNURL, Blossom sind frei waehlbar); der Schutz
// liegt bei script-src.
// 'wasm-unsafe-eval' (seit 2.2b-b) erlaubt nur das Uebersetzen von WebAssembly
// (die MLS-Engine), kein eval(): Ohne ein erlaubtes Skript kann niemand WASM
// laden, und erlaubt ist weiter nur das eine per Hash.
{
  const { createHash: h } = await import("node:crypto");
  const scriptHash = h("sha256").update(scriptBody, "utf8").digest("base64");
  // Mini-App: zusätzlich genau die Datei des Telegram-SDK (nur dieser Pfad, nicht ganz
  // telegram.org). Der TMA-Server ist https und damit schon in connect-src.
  const scriptSrc = `'sha256-${scriptHash}' 'wasm-unsafe-eval'${TMA ? ` ${TELEGRAM_SDK}` : ""}`;
  const csp = [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'unsafe-inline' https:",
    "img-src https: data: blob:",
    "media-src https: data: blob:",
    "font-src https: data:",
    "connect-src https: http: wss: ws: data: blob:",
    // 'self' seit B-12c (W3 A): nur freedom-sw.js derselben Herkunft – aus demselben,
    // über pages.yml veröffentlichten und bitgleich nachgebauten Stand
    "worker-src blob: 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (!/<head[^>]*>/i.test(html)) throw new Error("build: kein <head> fuer die CSP gefunden");
  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${meta}`);
  // Genau ein eingebettetes Skript (der Hash deckt es); im Mini-App-Build dazu nur das SDK.
  const skripte = html.match(/<script[^>]*>/gi) ?? [];
  const fremde = skripte.filter((s) => s !== "<script>");
  if (skripte.length - fremde.length !== 1 || fremde.length !== (TMA ? 1 : 0) || (TMA && fremde[0] !== `<script src="${TELEGRAM_SDK}">`)) {
    throw new Error("build: genau ein eingebettetes <script> erwartet (Mini-App: dazu nur das Telegram-SDK) – sonst deckt die CSP nicht alles ab");
  }
}

if (TMA) {
  // Nur die Mini-App – Web-Build, Manifest und Weck-Worker bleiben, wie sie sind.
  const { createHash: h } = await import("node:crypto");
  await mkdir(join(root, "dist/tma"), { recursive: true });
  await writeFile(join(root, "dist/tma/index.html"), html);
  const tmaSha = h("sha256").update(html).digest("hex");
  await writeFile(join(root, "dist/tma/index.html.sha256"), `${tmaSha}  index.html\n`);
  console.log(`dist/tma/index.html (${(html.length / 1024).toFixed(0)} KB, API ${TMA_API || "gleiche Herkunft"}, sha256 ${tmaSha})`);
  process.exit(0);
}

await writeFile(join(root, "dist/freedom.html"), html);
await writeFile(
  join(root, "dist/manifest.json"),
  await readFile(join(root, "src/shell/manifest.json"), "utf8"),
);
// Service Worker nur zum Wecken (B-12c): eigene Datei, gleiche Regeln wie die App –
// nichts Zeit- oder Pfadabhängiges, damit der Build bitgleich bleibt (5.9).
const sw = await build({
  entryPoints: [join(root, "src/sw/freedom-sw.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  write: false,
});
const swJs = sw.outputFiles[0].text;
if (/\bimportScripts\b|addEventListener\("fetch"|\bcaches\b/.test(swJs)) throw new Error("build: der Weck-Worker darf nichts laden und nichts zwischenspeichern");
await writeFile(join(root, "dist/freedom-sw.js"), swJs);

// Pruefsumme ausgeben: Sie gehoert in das signierte Release-Manifest, damit
// eine weitergereichte Kopie ueberpruefbar ist.
const { createHash } = await import("node:crypto");
const sha = createHash("sha256").update(html).digest("hex");
console.log(`dist/freedom.html (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`sha256: ${sha}`);
const swSha = createHash("sha256").update(swJs).digest("hex");
console.log(`dist/freedom-sw.js (${(swJs.length / 1024).toFixed(1)} KB, sha256 ${swSha})`);
await (await import("node:fs/promises")).writeFile(
  "dist/freedom.html.sha256",
  `${sha}  freedom.html\n`,
);
await writeFile("dist/freedom-sw.js.sha256", `${swSha}  freedom-sw.js\n`);
