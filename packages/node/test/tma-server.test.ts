/**
 * TmaServer über HTTP ansprechen — Routen, Auth, Stars, TON.
 * Echter Server auf Port 0 (zufällig), echte HMAC-Signaturen gegen einen
 * Test-Bot-Token. Die Bot-API wird über TELEGRAM_API_BASE auf einen
 * lokalen Fake-Server umgebogen (kein globales fetch-Patching nötig).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { TmaServer } from "../src/tma-server.js";

const BOT_TOKEN = "5550001234:TEST-TOKEN-abcXYZ";
const DEPOT = "EQTestDepotAddressForFreedom1234567890abcdefghijklmnopqrstuvwx";

/** Signiert initData wie Telegram es täte. */
function initData(felder: Record<string, string>): string {
  const p = new URLSearchParams(felder);
  const paare: string[] = [];
  for (const [k, v] of p.entries()) if (k !== "hash") paare.push(`${k}=${v}`);
  paare.sort();
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  p.set("hash", createHmac("sha256", secret).update(paare.join("\n")).digest("hex"));
  return p.toString();
}

const GÜLTIG = initData({
  user: JSON.stringify({ id: 42, first_name: "Test" }),
  auth_date: String(Math.floor(Date.now() / 1000)),
});

/** Fake Telegram-Bot-API: REST-Stil (POST /bot<token>/<methode>). */
function fakeBot(): Promise<{ url: string; links: string[]; stop: () => Promise<void> }> {
  const links: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const antworte = (result: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, result })); };
      const methode = (req.url ?? "").split("/").pop() ?? "";
      if (methode === "createInvoiceLink") {
        links.push("x");
        antworte(`https://t.me/$TESTLINK${links.length}`);
      } else if (methode === "getUpdates") {
        antworte([]);
      } else {
        antworte(true);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        links,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

interface TestServer {
  tma: TmaServer;
  basis: string;
  bot: { url: string; links: string[]; stop: () => Promise<void> };
  /** Server + Fake-Bot stoppen und TELEGRAM_API_BASE zurücksetzen. */
  stop: () => Promise<void>;
}

async function starteServer(): Promise<TestServer> {
  const bot = await fakeBot();
  const alt = process.env.TELEGRAM_API_BASE;
  process.env.TELEGRAM_API_BASE = bot.url;

  const tma = new TmaServer({
    botToken: BOT_TOKEN,
    tonDepot: DEPOT,
    port: 0,
    host: "127.0.0.1",
    statisch: "/tmp/freedom-app/packages/app/dist",
    daten: "/tmp/freedom-tma-test",
  });
  tma.start();
  const port: number = await new Promise((resolve) => {
    const iv = setInterval(() => {
      const s = (tma as unknown as { server?: { address: () => unknown } }).server;
      const a = s?.address();
      if (a && typeof a === "object" && "port" in a) { clearInterval(iv); resolve((a as { port: number }).port); }
    }, 20);
    setTimeout(() => { clearInterval(iv); resolve(3601); }, 3000);
  });
  const stop = async (): Promise<void> => {
    if (alt === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = alt;
    await tma.stop();
    await bot.stop();
  };
  return { tma, basis: `http://127.0.0.1:${port}`, bot, stop };
}

async function json(r: Response): Promise<Record<string, unknown>> { return await r.json() as Record<string, unknown>; }

test("ohne Signatur → 401", async () => {
  const { basis, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/stars/status`);
    assert.equal(r.status, 401);
  } finally {
    await stop();
  }
});

test("falsche Signatur → 401", async () => {
  const { basis, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/stars/status`, { headers: { authorization: "tma user=%7B%22id%22%3A1%7D&auth_date=1&hash=00" } });
    assert.equal(r.status, 401);
  } finally {
    await stop();
  }
});

test("gültige Signatur → Stars-Status (Guthaben 0)", async () => {
  const { basis, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/stars/status`, { headers: { authorization: `tma ${GÜLTIG}` } });
    assert.equal(r.status, 200);
    const j = await json(r);
    assert.equal(j.balance, 0);
  } finally {
    await stop();
  }
});

test("Stars-Rechnung → Link (Preis aus Server-Tabelle)", async () => {
  const { basis, bot, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/stars/invoice`, {
      method: "POST",
      headers: { authorization: `tma ${GÜLTIG}`, "content-type": "application/json" },
      body: JSON.stringify({ auftrag: "ki-basis", stars: 999 }), // 999 wird ignoriert!
    });
    assert.equal(r.status, 200);
    const j = await json(r);
    assert.equal(j.stars, 25);           // Server-Preis, nicht 999
    assert.ok(String(j.link).startsWith("https://t.me/$"));
    assert.equal(bot.links.length, 1);
  } finally {
    await stop();
  }
});

test("TON-Rechnung → Depot + eindeutiger Kommentar", async () => {
  const { basis, bot, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/ton/invoice`, {
      method: "POST",
      headers: { authorization: `tma ${GÜLTIG}`, "content-type": "application/json" },
      body: JSON.stringify({ auftrag: "ki-basis", nano: "1000000000" }),
    });
    assert.equal(r.status, 200);
    const j = await json(r);
    assert.equal(j.an, DEPOT);
    assert.match(String(j.kommentar), /^freedom:ki-basis:[a-z0-9]+$/);
    // Status: noch nicht bezahlt
    const s = await fetch(`${basis}/tma/ton/status/${encodeURIComponent(String(j.kommentar))}`, { headers: { authorization: `tma ${GÜLTIG}` } });
    assert.equal(s.status, 200);
    assert.equal((await json(s)).bezahlt, false);
  } finally {
    await stop();
  }
});

test("unbekannter Auftrag → 400 (kein Preis, kein Bot-Aufruf)", async () => {
  const { basis, bot, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/stars/invoice`, {
      method: "POST",
      headers: { authorization: `tma ${GÜLTIG}`, "content-type": "application/json" },
      body: JSON.stringify({ auftrag: "GIBTS-NICHT", stars: 1 }),
    });
    assert.equal(r.status, 400);
    assert.equal(bot.links.length, 0); // kein createInvoiceLink verschwendet
  } finally {
    await stop();
  }
});

test("Manifest wird ausgeliefert", async () => {
  const { basis, stop } = await starteServer();
  try {
    const r = await fetch(`${basis}/tma/tonconnect-manifest.json`);
    assert.equal(r.status, 200);
    const j = await json(r);
    assert.equal(j.name, "FREEDOM");
    assert.ok(String(j.url).startsWith("http"));
  } finally {
    await stop();
  }
});
