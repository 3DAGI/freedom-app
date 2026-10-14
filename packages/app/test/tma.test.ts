/**
 * Mini-App für Telegram (TMA-1, `docs/MINI-APP-TMA.md`): eigener Build in `dist/tma/`,
 * der Web-Build bleibt unberührt; die Signatur (`initData`) geht nur über `tmaFetch()`
 * an den TMA-Server – kein globaler fetch-Patch mehr.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inTelegram, initDataRaw, startTelegramShell, tmaFetch } from "../src/shell/tma.js";

const app = fileURLToPath(new URL("..", import.meta.url));
const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const wurzel = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

/** Ein Telegram-Objekt wie im WebView, dazu ein mitschreibendes fetch. */
function umgebung(tma: boolean, api = "") {
  const g = globalThis as Record<string, unknown>;
  const vorher = { fetch: g.fetch, Telegram: g.Telegram, FREEDOM_TMA: g.FREEDOM_TMA, FREEDOM_TMA_API: g.FREEDOM_TMA_API };
  const aufrufe: { url: string; auth: string | null }[] = [];
  let bereit = 0;
  g.Telegram = { WebApp: { initData: "user=%7B%22id%22%3A42%7D&hash=ab", ready: () => bereit++, expand: () => {} } };
  g.FREEDOM_TMA = tma ? true : undefined;
  g.FREEDOM_TMA_API = tma ? api : undefined;
  const meinFetch = async (u: unknown, init?: RequestInit) => {
    aufrufe.push({ url: String(u), auth: new Headers(init?.headers).get("authorization") });
    return new Response("{}");
  };
  g.fetch = meinFetch;
  return {
    aufrufe, meinFetch, bereit: () => bereit,
    zurueck: () => { for (const [k, v] of Object.entries(vorher)) g[k] = v; },
  };
}

test("TMA-1: im Web-Build tut die Brücke nichts – auch nicht mit einem Telegram-Objekt", () => {
  const u = umgebung(false);
  try {
    assert.equal(inTelegram(), false);
    assert.equal(initDataRaw(), "");
    startTelegramShell();
    assert.equal(u.bereit(), 0, "kein ready()");
    assert.match(lies("src/shell/app.ts"), /if \(globalThis\.FREEDOM_TMA !== true\) return;\n {2}import\("\.\/tma\.js"\)/, "der Start lädt die Brücke nur im Mini-App-Build");
  } finally { u.zurueck(); }
});

test("TMA-1: die Signatur geht nur über tmaFetch an den TMA-Server – fetch bleibt unverändert", async () => {
  const u = umgebung(true, "https://knoten.example");
  try {
    assert.equal(inTelegram(), true);
    startTelegramShell();
    assert.equal(u.bereit(), 1);
    assert.equal(globalThis.fetch, u.meinFetch, "kein globaler Patch");
    await fetch("https://3dagi.github.io/freedom-app/freedom-spiegel.json");
    await tmaFetch("/tma/stars/status");
    assert.deepEqual(u.aufrufe, [
      { url: "https://3dagi.github.io/freedom-app/freedom-spiegel.json", auth: null },
      { url: "https://knoten.example/tma/stars/status", auth: "tma user=%7B%22id%22%3A42%7D&hash=ab" },
    ]);
    await assert.rejects(tmaFetch("https://andere.example/tma/x"), /nur Pfade unter \/tma\//);
    await assert.rejects(tmaFetch("/freedom.html"), /nur Pfade unter \/tma\//);
    assert.equal(u.aufrufe.length, 2);
    // Ohne Adresse: dieselbe Herkunft wie die App (Betrieb A, der Knoten liefert beides)
    (globalThis as Record<string, unknown>).FREEDOM_TMA_API = "";
    await tmaFetch("/tma/ton/invoice", { method: "POST" });
    assert.equal(u.aufrufe[2]!.url, "/tma/ton/invoice");
  } finally { u.zurueck(); }
  for (const datei of ["src/shell/tma.ts", "src/shell/stars-checkout.ts", "src/shell/ton-connect.ts"]) {
    const code = lies(datei);
    assert.doesNotMatch(code, /globalThis\.fetch\s*=/, `${datei}: fetch nie ersetzen`);
    assert.doesNotMatch(code, /Math\.random/, `${datei}: Zufall nie aus Math.random`);
  }
});

test("TMA-1: der Mini-App-Build schreibt nur dist/tma/ – mit dem SDK als einziger fremder Quelle", () => {
  const web = `${app}dist/freedom.html`;
  const summe = () => (existsSync(web) ? createHash("sha256").update(readFileSync(web)).digest("hex") : "");
  const vorher = summe();
  const env = { ...process.env, FREEDOM_TMA: "1", FREEDOM_TMA_API: "https://knoten.example/" };
  execFileSync(process.execPath, ["build.mjs"], { cwd: app, env, stdio: "pipe" });
  assert.equal(summe(), vorher, "der Web-Build bleibt unberührt");
  const html = readFileSync(`${app}dist/tma/index.html`, "utf8");
  assert.deepEqual(html.match(/<script[^>]*>/g), ['<script src="https://telegram.org/js/telegram-web-app.js">', "<script>"]);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)![1]!;
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+' 'wasm-unsafe-eval' https:\/\/telegram\.org\/js\/telegram-web-app\.js;/, "nur genau diese Datei, nicht ganz telegram.org");
  assert.doesNotMatch(csp, /'self'[^;]*;\s*style-src|'unsafe-inline'[^;]*;\s*style-src/, "kein 'self', kein unsafe-inline für Skripte");
  assert.ok(html.includes('"https://knoten.example"'), "die Adresse des TMA-Servers steckt im Skript (define)");
  assert.doesNotMatch(html, /globalThis\.FREEDOM_TMA/, "beide Werte sind ersetzt");
  assert.doesNotMatch(html, /tonconnect-ui/, "TON Connect UI lädt der Build nicht (TON nicht verdrahtet)");
  assert.equal(readFileSync(`${app}dist/tma/index.html.sha256`, "utf8"), `${createHash("sha256").update(html).digest("hex")}  index.html\n`);
  for (const falsch of ["http://knoten.example", "https://knoten.example/api", "https://a:b@knoten.example"]) {
    assert.throws(() => execFileSync(process.execPath, ["build.mjs"], { cwd: app, env: { ...env, FREEDOM_TMA_API: falsch }, stdio: "pipe" }),
      /FREEDOM_TMA_API muss eine https-Herkunft/, falsch);
  }
});

test("TMA-1: Website und Pages veröffentlichen /tma/ nur nachgebaut, freedom.html bleibt der Web-Build", () => {
  const site = wurzel("scripts/build-site.sh");
  assert.match(site, /cp "\$ROOT\/packages\/app\/dist\/tma\/index\.html" "\$OUT\/tma\/index\.html"/);
  assert.doesNotMatch(site, /dist\/freedom\.html" "\$OUT\/tma/, "nie die Datei des Web-Builds als Mini-App");
  const repro = wurzel("scripts/repro-build.sh");
  assert.match(repro, /FREEDOM_TMA=1 node build\.mjs/);
  assert.match(repro, /\$ORDNER\/tma\/index\.html ohne FREEDOM_TMA_API/);
  const pages = wurzel(".github/workflows/pages.yml");
  assert.match(pages, /env:\n {10}FREEDOM_TMA_API: \$\{\{ vars\.FREEDOM_TMA_API \}\}\n {8}run: bash scripts\/repro-build\.sh --vergleiche-ordner site/, "der Nachbau kennt dieselbe Adresse");
  const b = lies("build.mjs");
  assert.match(b, /const TMA_API = \(\(\) => \{\n {2}const roh = TMA \?/, "der Web-Build liest FREEDOM_TMA_API nie");
});
