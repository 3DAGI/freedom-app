/**
 * Schritt 8.2b: Lightning-Adresse beim eigenen Knoten. Geprüft wird: nur der
 * eigene Name, Beträge im Bereich, Beschreibung = Hash der Metadaten, keine
 * Meldungen von LND nach außen, eine Bremse gegen Rechnungsfluten, nur eine
 * Macaroon für Rechnungen – und dass die Selbstprüfung aus 8.2a den Server
 * über HTTP als gute Lightning-Adresse erkennt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { generatePreimage } from "@freedomstack/protocol";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";
import { pruefeLightning } from "../src/einrichtung.js";
import { LnurlDienst, lnurlAusUmgebung, lnurlMetadaten, starteLnurlServer, type LnurlKonfig } from "../src/lnurl-server.js";

const K: LnurlKonfig = { basisUrl: "https://knoten.test", name: "provider", domain: "knoten.test", minMsat: 1_000, maxMsat: 100_000_000, proMinute: 3 };
const knoten = knotenSchluessel();

function quelle(p: { wirft?: Error } = {}) {
  const auftraege: { msat: number; hash: string }[] = [];
  return {
    auftraege,
    rechnung: async (msat: number, hash: Uint8Array) => {
      if (p.wirft) throw p.wirft;
      auftraege.push({ msat, hash: Buffer.from(hash).toString("hex") });
      return rechnung(knoten, `lnbc${msat / 100}n`, generatePreimage());
    },
  };
}

test("Parameter nur für den eigenen Namen, Rechnung mit Hash der Metadaten", async () => {
  const q = quelle();
  const d = new LnurlDienst(K, q);
  const p = await d.antworte("/.well-known/lnurlp/provider", new URLSearchParams());
  assert.equal(p.status, 200);
  assert.deepEqual(p.body, {
    tag: "payRequest", callback: "https://knoten.test/lnurlp/provider/rechnung",
    minSendable: 1_000, maxSendable: 100_000_000, metadata: lnurlMetadaten(K),
  });
  assert.equal("commentAllowed" in p.body, false, "keine Kommentare – nichts zu speichern");
  assert.equal((await d.antworte("/.well-known/lnurlp/jemand", new URLSearchParams())).status, 404);
  const r = await d.antworte("/lnurlp/provider/rechnung", new URLSearchParams({ amount: "2500" }));
  assert.equal(r.status, 200);
  assert.match(String(r.body.pr), /^lnbc25n1/);
  assert.deepEqual(q.auftraege, [{ msat: 2_500, hash: createHash("sha256").update(lnurlMetadaten(K)).digest("hex") }]);
  assert.deepEqual(JSON.parse(lnurlMetadaten(K)), [["text/plain", "FreedomStack-Provider provider@knoten.test"], ["text/identifier", "provider@knoten.test"]]);
});

test("Beträge nur im Bereich, Bremse je Minute, nie Meldungen von LND", async () => {
  let uhr = 1_000_000;
  const q = quelle();
  const d = new LnurlDienst(K, q, () => uhr);
  const frage = (amount: string) => d.antworte("/lnurlp/provider/rechnung", new URLSearchParams({ amount }));
  for (const a of ["999", "100000001", "abc", "", "1.5e3", "0x10000", " 1000", "-1000"]) assert.equal((await frage(a)).status, 400, a);
  assert.equal(q.auftraege.length, 0);
  for (let i = 0; i < 3; i++) assert.equal((await frage("1000")).status, 200);
  assert.equal((await frage("1000")).status, 429, "höchstens 3 je Minute");
  uhr += 60_001;
  assert.equal((await frage("1000")).status, 200, "nach einer Minute wieder");
  const kaputt = new LnurlDienst(K, quelle({ wirft: new Error("rpc error: macaroon 0201… an 10.0.0.7 abgelehnt") }));
  const f = await kaputt.antworte("/lnurlp/provider/rechnung", new URLSearchParams({ amount: "1000" }));
  assert.deepEqual(f, { status: 502, body: { status: "ERROR", reason: "Rechnung gerade nicht möglich" } });
});

test("Einrichtung: nur https, gültiger Name, nur eine Macaroon für Rechnungen, kein Blink", async () => {
  const varint = (n: number): number[] => { const o: number[] = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
  const pb = (nr: number, d: number[]) => [...varint(nr * 8 + 2), ...varint(d.length), ...d];
  const s = (t: string) => [...new TextEncoder().encode(t)];
  const mac = (ops: Record<string, string[]>) => {
    const id = [3, ...pb(1, Array(16).fill(7)), ...pb(2, [0x30]), ...Object.entries(ops).flatMap(([e, a]) => pb(3, [...pb(1, s(e)), ...a.flatMap((x) => pb(2, s(x)))]))];
    return Buffer.from([2, 1, ...varint(3), ...s("lnd"), 2, ...varint(id.length), ...id, 0, 0, 6, 32, ...Array(32).fill(9)]).toString("hex");
  };
  const rechnungen = mac({ invoices: ["read", "write"] });
  const lade = async (p: string) => ({ gut: rechnungen, admin: mac({ invoices: ["read", "write"], offchain: ["read", "write"], onchain: ["write"] }) } as Record<string, string>)[p] ?? Promise.reject(Object.assign(new Error("ENOENT /home/x"), { name: "FehltError" }));
  const basis = { LNURL_BASE_URL: "https://knoten.test", LNURL_LND_MACAROON: "gut" };
  const gut = await lnurlAusUmgebung(basis, lade);
  assert.ok("konfig" in gut);
  assert.deepEqual(gut.konfig, { basisUrl: "https://knoten.test", name: "provider", domain: "knoten.test", minMsat: 1_000, maxMsat: 100_000_000, proMinute: 30 });
  const grund = async (env: Record<string, string>) => { const r = await lnurlAusUmgebung({ ...basis, ...env }, lade); return "grund" in r ? r.grund : "ok"; };
  assert.match(await grund({ LNURL_BASE_URL: "http://knoten.test" }), /https/);
  assert.match(await grund({ LNURL_BASE_URL: "https://knoten.test/pfad" }), /https:\/\/<domain>/);
  assert.match(await grund({ LNURL_BASE_URL: "" }), /LNURL_BASE_URL fehlt/);
  assert.match(await grund({ LNURL_NAME: "Name mit Leerzeichen" }), /LNURL_NAME/);
  assert.match(await grund({ LNURL_LND_MACAROON: "admin" }), /zu viel: offchain:read, offchain:write, onchain:write/);
  assert.match(await grund({ LNURL_LND_MACAROON: "fehlt" }), /nicht lesbar \(FehltError\)$/, "nur der Fehlername, kein Pfad");
  assert.match(await grund({ LNURL_BACKEND: "blink" }), /gibt es nicht mehr/);
  assert.match(await grund({ LNURL_MAX_MSAT: "10", LNURL_MIN_MSAT: "1000" }), /ungültig/);
  assert.match(await grund({ LND_REST: "https://fremd.example:8080", LND_INSECURE_TLS: "1" }), /^LND_REST: .*lokale/);
});

test("Durchstich: Die Selbstprüfung (8.2a) erkennt den Server über HTTP als gute Lightning-Adresse", async () => {
  const server = starteLnurlServer(new LnurlDienst(K, quelle()), 0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    // Der Reverse-Proxy: https://knoten.test/… → http://127.0.0.1:<port>/…
    const holen = async (url: string) => {
      const u = new URL(url);
      const r = await fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`);
      return { status: r.status, cors: r.headers.get("access-control-allow-origin"), json: await r.json() };
    };
    const b = await pruefeLightning("provider@knoten.test", holen);
    assert.deepEqual(b, [{ schiene: "lightning", stufe: "ok", fall: "ln.ok", werte: { min: 1, max: 100000 }, text: "provider@knoten.test stellt Rechnungen aus (1 bis 100000 sats)" }]);
    const post = await fetch(`http://127.0.0.1:${port}/.well-known/lnurlp/provider`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("content-type"), "application/json");
  } finally {
    server.close();
  }
});

test("verdrahtet in main.ts: nur mit LNURL_ENABLED=1, Macaroon über loadMacaroonHex, Warnung bei fremdem NODE_LUD16", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /if \(process\.env\.LNURL_ENABLED === "1"\) \{\n\s+const \{ LnurlDienst, lnurlAusUmgebung, starteLnurlServer \} = await import\("\.\/lnurl-server\.js"\);/);
  assert.match(main, /lnurlAusUmgebung\(process\.env, loadMacaroonHex\)/);
  assert.match(main, /if \(lud16\.toLowerCase\(\) !== eigene\) console\.warn/);
  assert.doesNotMatch(main, /BLINK_API_KEY|BlinkBackend/);
});
