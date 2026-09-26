/**
 * Schritt 8.3: Ablauf der Hinrichtung (sats -> SOL). Loest der Kunde bis zur
 * Frist nicht ein, holt der LP seine SOL zurueck und bricht danach die
 * Hold-Invoice ab; hat er eingeloest, wird abgerechnet – auch nach einem
 * Neustart des LP. Niemand verliert Geld.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryRelay, MockLightning, MockSolana, OutboxPool, buildEvent, generateKeypair, generatePreimage, hashlock, signEvent, toHex,
  type LpOffer,
} from "@freedomstack/protocol";
import { FixedRate, KIND_SWAP_REQUEST, LpDaemon, RUECKHOL_PUFFER_SECS, hinSpeicher } from "../src/lp-daemon.js";

const LP = generateKeypair();
const KUNDE = generateKeypair();
const KUNDE_SOL = "So11111111111111111111111111111111111111112";
const T_SOL = 3600;
const angebot: Omit<LpOffer, "expiry"> = {
  offerId: "offer-ablauf", pair: "LN-BTC/SOL", direction: "sell-sol", minSats: 1000, maxSats: 100_000, feePpm: 10_000, tSolSecs: T_SOL, lnCltvDeltaBlocks: 144,
};
const SATS = 10_000;
const LAMPORTS = SATS * 100;

function aufbau(dir: string, uhr: { t: number }, pool = new OutboxPool([new MemoryRelay(`mem://ablauf-${Math.random()}`)], { minAcks: 1 })) {
  const sol = new MockSolana(1_000_000_000, () => uhr.t);
  const ln = new MockLightning(1_000_000);
  const neu = (s = sol, l = ln) => new LpDaemon(
    { keypair: LP, offer: angebot, offerTtlSecs: 3600, maxLamportsPerSwap: 1_000_000_000, hinSpeicher: hinSpeicher(join(dir, "lp-hin.json")) },
    pool, l, s, new FixedRate(100), () => uhr.t,
  );
  return { pool, sol, ln, lp: neu(), neu };
}

async function anfrage(pool: OutboxPool, uhr: { t: number }) {
  const R = generatePreimage();
  const ev = signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [
    ["p", LP.pk], ["offer", angebot.offerId], ["amount_sats", String(SATS)], ["hashlock", toHex(hashlock(R))], ["solana_address", KUNDE_SOL],
  ], "", uhr.t), KUNDE.sk);
  await pool.publish(ev);
  return { R, id: ev.id };
}

function mitTemp(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-ablauf-"));
    try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}

test("8.3: Kunde zahlt nie – nach der Frist SOL zurueck, Rechnung abgebrochen, Frist aus der Uhr des LP", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, ln, lp } = aufbau(dir, uhr);
  const { R } = await anfrage(pool, uhr);
  const [s] = await lp.pollOnce(uhr.t) as { phase: string; swapId: string; timelockUnix: number }[];
  assert.equal(s!.phase, "INVOICE_CREATED");
  assert.equal(s!.timelockUnix, uhr.t + T_SOL);
  assert.equal(sol.lpLamports, 1_000_000_000 - LAMPORTS);

  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS - 1;
  assert.deepEqual(await lp.holeAbgelaufeneZurueck(), [], "vor Frist plus Puffer nichts");
  uhr.t += 1;
  const [z] = await lp.holeAbgelaufeneZurueck();
  assert.equal(z!.phase, "REFUNDED");
  assert.equal(sol.lpLamports, 1_000_000_000, "SOL wieder beim LP");
  assert.equal(await ln.getInvoiceState(hashlock(R)), "CANCELED");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "lp-hin.json"), "utf8")), [], "erledigt faellt aus der Ablage");
  assert.deepEqual(await lp.holeAbgelaufeneZurueck(), [], "nur einmal");
}));

test("8.3: Kunde zahlt, loest aber nie ein – beide bekommen ihr Geld zurueck, Abbruch erst nach der Rueckholung", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, ln, lp } = aufbau(dir, uhr);
  const { R } = await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  await ln.payHoldInvoice(`lnmock:${toHex(hashlock(R))}`);
  assert.equal(ln.userSats, 1_000_000 - SATS);
  const reihenfolge: string[] = [];
  const refund = sol.refund.bind(sol); sol.refund = async (id) => { reihenfolge.push("refund"); await refund(id); };
  const cancel = ln.cancelHoldInvoice.bind(ln); ln.cancelHoldInvoice = async (h) => { reihenfolge.push("cancel"); await cancel(h); };
  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS;
  await lp.holeAbgelaufeneZurueck();
  assert.deepEqual(reihenfolge, ["refund", "cancel"], "sonst koennte der Kunde nach dem Abbruch noch einloesen");
  assert.equal(ln.userSats, 1_000_000, "sats des Kunden zurueck");
  assert.equal(ln.lpSats, 0);
  assert.equal(sol.lpLamports, 1_000_000_000);
}));

test("8.3: Kunde hat eingeloest, der LP war aus – nach der Frist wird abgerechnet, nicht zurueckgeholt", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, ln, lp } = aufbau(dir, uhr);
  const { R, id } = await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  await ln.payHoldInvoice(`lnmock:${toHex(hashlock(R))}`);
  await sol.claim(`swap-${id.slice(0, 16)}`, R);
  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS + 3600;
  const [z] = await lp.holeAbgelaufeneZurueck();
  assert.equal(z!.phase, "SETTLED");
  assert.equal(ln.lpSats, SATS, "sats beim LP");
  assert.equal(sol.userLamports, LAMPORTS, "SOL beim Kunden");
}));

test("8.3: Neustart – ein neuer Prozess kennt die Sperre aus der Ablage und holt sie zurueck", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, ln, lp, neu } = aufbau(dir, uhr);
  await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  const zweiter = neu(sol, ln);
  assert.equal(zweiter.activeSessions().length, 1, "aus der Datei geladen");
  assert.deepEqual(await zweiter.pollOnce(uhr.t), [], "dieselbe Anfrage wird nicht noch einmal bedient");
  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS;
  const [z] = await zweiter.holeAbgelaufeneZurueck();
  assert.equal(z!.phase, "REFUNDED");
  assert.equal(sol.lpLamports, 1_000_000_000);
}));

test("8.3: Sperre ohne Rechnung und Absturz vor der Sperre – beides wird nach der Frist aufgeraeumt", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, ln, lp } = aufbau(dir, uhr);
  ln.createHoldInvoice = async () => { throw new Error("LND nicht erreichbar"); };
  await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  const abgelegt = JSON.parse(readFileSync(join(dir, "lp-hin.json"), "utf8")) as { phase: string }[];
  assert.deepEqual(abgelegt.map((s) => s.phase), ["SOL_LOCKED"], "gesperrt, ohne Rechnung – aber nicht vergessen");

  // Zweiter Fall: Die Sperre selbst scheitert – abgelegt war die Sitzung schon (SPERRT)
  const lock = sol.lock.bind(sol);
  sol.lock = async () => { throw new Error("RPC weg"); };
  await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  sol.lock = lock;
  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS;
  const z = await lp.holeAbgelaufeneZurueck();
  assert.deepEqual(z.map((s) => s.phase).sort(), ["FAILED", "REFUNDED"]);
  assert.equal(sol.lpLamports, 1_000_000_000);
}));

test("8.3: Sperre geschlossen, Preimage (noch) nicht lesbar – nie abbrechen, spaeter abrechnen oder nach der Rechnung aufgeben", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, ln, lp } = aufbau(dir, uhr);
  const { R, id } = await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  await ln.payHoldInvoice(`lnmock:${toHex(hashlock(R))}`);
  await sol.claim(`swap-${id.slice(0, 16)}`, R);
  // Wie beim echten Programm: nach dem Einloesen ist das Konto geschlossen, das Preimage erst spaeter lesbar
  const lesbar = sol.getRevealedPreimage.bind(sol);
  let sichtbar = false;
  sol.get = async () => undefined;
  sol.getRevealedPreimage = async (x) => (sichtbar ? lesbar(x) : undefined);
  const refund = sol.refund.bind(sol);
  sol.refund = async (x) => { assert.fail(`kein Rueckholen: ${x}`); await refund(x); };
  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS;
  assert.deepEqual(await lp.holeAbgelaufeneZurueck(), []);
  assert.equal(await ln.getInvoiceState(hashlock(R)), "ACCEPTED", "nicht abgebrochen – sonst verloere der LP die sats");
  sichtbar = true;
  const [z] = await lp.holeAbgelaufeneZurueck();
  assert.equal(z!.phase, "SETTLED");
  assert.equal(ln.lpSats, SATS);
}));

test("8.3: Rueckholung scheitert einmal (Kette nicht erreichbar) – naechste Runde erneut", mitTemp(async (dir) => {
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const { pool, sol, lp } = aufbau(dir, uhr);
  await anfrage(pool, uhr);
  await lp.pollOnce(uhr.t);
  const refund = sol.refund.bind(sol);
  let einmal = true;
  sol.refund = async (id) => { if (einmal) { einmal = false; throw new Error("RPC weg"); } await refund(id); };
  uhr.t += T_SOL + RUECKHOL_PUFFER_SECS;
  assert.deepEqual(await lp.holeAbgelaufeneZurueck(), []);
  assert.equal(lp.activeSessions()[0]!.phase, "INVOICE_CREATED", "bleibt offen");
  const [z] = await lp.holeAbgelaufeneZurueck();
  assert.equal(z!.phase, "REFUNDED");
}));

test("8.3: Verdrahtung – main.ts prueft die Macaroon, legt die Hinrichtung ab und holt nach Ablauf zurueck", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const macaroonOk = pruefeLpMacaroon\(macaroonHex\);\s*if \(!macaroonOk\.ok\) \{[\s\S]{0,200}process\.exit\(1\);/, "nie admin.macaroon");
  assert.doesNotMatch(main, /Pfad zum admin\.macaroon/);
  assert.match(main, /hinSpeicher: direction === "sell-sol" \? hinSpeicher\(join\(process\.env\.HOME \?\? "\.", "\.freedom", "lp-hin\.json"\)\) : undefined,/);
  assert.match(main, /for \(const s of await lp\.holeAbgelaufeneZurueck\(\)\)/);
});
