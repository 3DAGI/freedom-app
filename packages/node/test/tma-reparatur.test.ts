/**
 * TMA-2: Mini-App im Knoten nach den Regeln des Projekts – Umgebung streng (ungültig → kein
 * Start, TON nur mit eigener Adresse), nach außen nur feste Texte, ins Log keine Telegram-IDs
 * und Zahlungskennungen, Dateien 0600, Anfragen begrenzt, jede Zahlung nur einmal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preCheckoutPasst, TMA_GRENZEN, TmaServer, tmaAusUmgebung } from "../src/tma-server.js";
import { auftragsKommentar } from "../src/tma-kommentar.js";

const TOKEN = "5550001234:TEST-TOKEN-abcXYZ-0123456789abcdef";
const TON = "EQ" + "A".repeat(46);
const OPTS = { statisch: "/x/app/dist", daten: "/x/daten" };

test("TMA-2: Umgebung – ohne FREEDOM_TMA nichts, ungültig kein Start, TON nur mit eigener Adresse", () => {
  assert.equal(tmaAusUmgebung({}, OPTS), null);
  const ok = tmaAusUmgebung({ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, NODE_SOL_ADDRESS: "So11111111111111111111111111111111111111112" }, OPTS);
  assert.equal(ok?.cfg?.tonDepot, "", "nie die Solana-Adresse als Ziel für TON");
  assert.equal(ok?.cfg?.host, "127.0.0.1", "nur dieser Rechner, nach außen über einen Tunnel");
  assert.equal(ok?.cfg?.port, 3601);
  assert.equal(tmaAusUmgebung({ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, TON_DEPOT_ADDRESS: TON }, OPTS)?.cfg?.tonDepot, TON);
  assert.equal(tmaAusUmgebung({ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, TON_DEPOT_ADDRESS: `0:${"ab".repeat(32)}` }, OPTS)?.cfg?.tonDepot, `0:${"ab".repeat(32)}`);
  for (const [env, warum] of [
    [{ FREEDOM_TMA: "1" }, "ohne Token"],
    [{ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: "abc" }, "Token ohne Form"],
    [{ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, TON_DEPOT_ADDRESS: "So11111111111111111111111111111111111111112" }, "Solana-Adresse als TON"],
    [{ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, TMA_PORT: "70000" }, "Port"],
    [{ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: "http://boese.example" }, "Bot-API über http"],
  ] as const) {
    assert.ok(tmaAusUmgebung(env, OPTS)?.grund, warum);
  }
  assert.ok(tmaAusUmgebung({ FREEDOM_TMA: "1", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: "http://127.0.0.1:9" }, OPTS)?.cfg, "Attrappe auf diesem Rechner");
});

test("TMA-2: vor dem Bezahlen nur Sterne, bekannter Auftrag, genau sein Preis; Nonce nicht erratbar", () => {
  assert.equal(preCheckoutPasst({ currency: "XTR", invoice_payload: "ki-basis:ab12", total_amount: 25 }), true);
  for (const pcq of [
    { currency: "XTR", invoice_payload: "ki-basis:ab12", total_amount: 1 },
    { currency: "USD", invoice_payload: "ki-basis:ab12", total_amount: 25 },
    { currency: "XTR", invoice_payload: "erfunden:ab12", total_amount: 25 },
    { currency: "XTR", total_amount: 25 },
  ]) assert.equal(preCheckoutPasst(pcq), false, JSON.stringify(pcq));
  const k = auftragsKommentar("ki-basis");
  assert.match(k, /^freedom:ki-basis:[0-9a-f]{16}$/);
  assert.notEqual(auftragsKommentar("ki-basis"), k);
});

/** Attrappe der Bot-API: liefert einmal die vorgegebenen Updates, scheitert auf Wunsch mit Text. */
async function bot(updates: unknown[], scheitert = false) {
  let geliefert = false;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const methode = (req.url ?? "").split("/").pop() ?? "";
      const ok = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
      if (methode === "createInvoiceLink") {
        if (scheitert) return res.end(JSON.stringify({ ok: false, description: "GEHEIM-TEXT-DER-BOT-API" }));
        return ok("https://t.me/$LINK");
      }
      if (methode === "getUpdates") {
        if (geliefert) return setTimeout(() => ok([]), 50);
        geliefert = true;
        return ok(updates);
      }
      ok(true);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, stop: () => new Promise<void>((r) => server.close(() => r())) };
}

function initData(id: number): string {
  const p = new URLSearchParams({ user: JSON.stringify({ id, first_name: "T" }), auth_date: String(Math.floor(Date.now() / 1000)) });
  const paare = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  p.set("hash", createHmac("sha256", secret).update(paare.join("\n")).digest("hex"));
  return p.toString();
}

async function mitServer(updates: unknown[], fn: (basis: string, daten: string, log: string[]) => Promise<void>, opts: { tonDepot?: string; scheitert?: boolean } = {}) {
  const b = await bot(updates, opts.scheitert);
  const alt = process.env.TELEGRAM_API_BASE;
  process.env.TELEGRAM_API_BASE = b.url;
  const daten = join(mkdtempSync(join(tmpdir(), "tma-")), "daten");
  const log: string[] = [];
  const orig = { log: console.log, warn: console.warn };
  console.log = (...a: unknown[]) => { log.push(a.join(" ")); };
  console.warn = (...a: unknown[]) => { log.push(a.join(" ")); };
  const tma = new TmaServer({ botToken: TOKEN, tonDepot: opts.tonDepot ?? "", port: 0, host: "127.0.0.1", statisch: daten, daten });
  try {
    tma.start();
    const s = (tma as unknown as { server: http.Server }).server;
    await new Promise<void>((r) => (s.listening ? r() : s.once("listening", () => r())));
    await fn(`http://127.0.0.1:${(s.address() as { port: number }).port}`, daten, log);
  } finally {
    await tma.stop();
    await b.stop();
    console.log = orig.log;
    console.warn = orig.warn;
    if (alt === undefined) delete process.env.TELEGRAM_API_BASE; else process.env.TELEGRAM_API_BASE = alt;
  }
}

test("TMA-2: jede Zahlung nur einmal, ins Log keine Telegram-ID und keine Zahlungskennung, Dateien 0600", async () => {
  const zahlung = { update_id: 7, message: { from: { id: 987654321 }, successful_payment: { telegram_payment_charge_id: "CHARGE-XYZ-123", total_amount: 25, invoice_payload: "ki-basis:ab12" } } };
  await mitServer([zahlung, { ...zahlung, update_id: 8 }], async (basis, daten, log) => {
    let stand: { balance?: number } = {};
    for (let i = 0; i < 100 && !stand.balance; i++) {
      await new Promise((r) => setTimeout(r, 20));
      stand = await (await fetch(`${basis}/tma/stars/status`, { headers: { authorization: `tma ${initData(987654321)}` } })).json() as { balance?: number };
    }
    assert.equal(stand.balance, 25, "zweimal zugestellt, einmal gebucht");
    const alles = log.join("\n");
    assert.ok(log.some((z) => z.includes("Stars gutgeschrieben: 25")));
    assert.doesNotMatch(alles, /987654321|CHARGE-XYZ-123|ab12/, "keine ID, keine Kennung im Log");
    // Gespeichert wird nach dem Buchen – bis beide Dateien da sind warten, mit Frist (nie feste Pause)
    const dateien = ["tma-stars.json", "tma-ton.json"].map((f) => join(daten, f));
    for (const frist = Date.now() + 5000; !dateien.every((f) => existsSync(f)) && Date.now() < frist;) await new Promise((r) => setTimeout(r, 20));
    assert.equal(statSync(daten).mode & 0o777, 0o700);
    for (const f of dateien) assert.equal(statSync(f).mode & 0o777, 0o600, f);
  });
});

test("TMA-2: nach außen feste Texte, Anfragen begrenzt, TON ohne Adresse aus", async () => {
  await mitServer([], async (basis, _d, log) => {
    const auth = { authorization: `tma ${initData(42)}`, "content-type": "application/json" };
    const r = await fetch(`${basis}/tma/stars/invoice`, { method: "POST", headers: auth, body: JSON.stringify({ auftrag: "ki-basis" }) });
    assert.equal(r.status, 502);
    const text = await r.text();
    assert.doesNotMatch(text + log.join("\n"), /GEHEIM-TEXT/, "nie Text der Bot-API");
    const gross = await fetch(`${basis}/tma/stars/invoice`, { method: "POST", headers: auth, body: JSON.stringify({ auftrag: "x".repeat(TMA_GRENZEN.koerperBytes) }) }).catch(() => undefined);
    assert.ok(!gross || gross.status === 413, "zu große Anfrage abgelehnt");
    const ton = await fetch(`${basis}/tma/ton/invoice`, { method: "POST", headers: auth, body: JSON.stringify({ auftrag: "ki-basis", nano: "1000" }) });
    assert.equal(ton.status, 503, "ohne TON_DEPOT_ADDRESS kein TON");
    const kaputt = await fetch(`${basis}/tma/stars/invoice`, { method: "POST", headers: auth, body: "{kein json" });
    assert.equal(kaputt.status, 400);
    assert.deepEqual(await kaputt.json(), { error: "kein JSON" });
  }, { scheitert: true });
  await mitServer([], async (basis) => {
    const auth = { authorization: `tma ${initData(42)}`, "content-type": "application/json" };
    for (const body of [{ auftrag: "a:b", nano: "1" }, { auftrag: "ki-basis", nano: "0" }, { auftrag: "ki-basis", nano: "1".repeat(25) }]) {
      const r = await fetch(`${basis}/tma/ton/invoice`, { method: "POST", headers: auth, body: JSON.stringify(body) });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const ok = await fetch(`${basis}/tma/ton/invoice`, { method: "POST", headers: auth, body: JSON.stringify({ auftrag: "ki-basis", nano: "1000" }) });
    assert.equal((await ok.json() as { an: string }).an, TON);
  }, { tonDepot: TON });
});
