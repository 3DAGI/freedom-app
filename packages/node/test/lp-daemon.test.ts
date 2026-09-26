/**
 * Tests fuer den LP-Daemon.
 *
 * Er bewegt echtes Geld auf zwei Ketten. Der Schwerpunkt liegt deshalb auf den
 * Faellen, in denen er NICHT handeln darf — ein LP, der zu viel sperrt oder
 * eine unsichere Timelock-Ordnung akzeptiert, verliert seine Liquiditaet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool, MemoryRelay, generateKeypair, signEvent, buildEvent, getTag,
  LpOffer, hashlock, generatePreimage, toHex, parseLpOffer, KIND_LP_OFFER,
} from "@freedomstack/protocol";
import { LpDaemon, FixedRate, KIND_SWAP_REQUEST, KIND_SWAP_RESPONSE, VORAB_FRIST_SECS } from "../src/lp-daemon.js";

const LP = generateKeypair();
const KUNDE = generateKeypair();
const KUNDE_SOL = "So11111111111111111111111111111111111111112";

const angebot: Omit<LpOffer, "expiry"> = {
  offerId: "offer-1",
  pair: "LN-BTC/SOL",
  direction: "sell-sol",
  minSats: 1000,
  maxSats: 100_000,
  feePpm: 10_000,
  tSolSecs: 3600,
  lnCltvDeltaBlocks: 144,
};

/** Kette und Lightning als Mitschrift — hier soll nichts wirklich passieren. */
function adapter() {
  const locks: { swapId: string; amountLamports: number; recipient: string }[] = [];
  const invoices: { amountSats: number }[] = [];
  /** Vorab-Rechnungen (4.6d): Hash -> bezahlt? */
  const vorab = new Map<string, boolean>();
  return {
    locks, invoices, vorab,
    sol: {
      async lock(p: { swapId: string; amountLamports: number; recipient: string }) { locks.push(p); },
      async claim() { /* nicht im Test */ },
      async refund() { /* nicht im Test */ },
      async get() { return null; },
      async getRevealedPreimage() { return null; },
    },
    ln: {
      async createHoldInvoice(_h: Uint8Array, amountSats: number) {
        invoices.push({ amountSats });
        return "lnbc1test";
      },
      async payHoldInvoice() { /* nicht im Test */ },
      async createInvoice(amountSats: number) {
        const paymentHash = hashlock(generatePreimage());
        vorab.set(toHex(paymentHash), false);
        return { bolt11: `lnbcvorab${amountSats}`, paymentHash, amountSats };
      },
      async getInvoiceState(h: Uint8Array) { return vorab.get(toHex(h)) ? "SETTLED" as const : "OPEN" as const; },
      async settleHoldInvoice() { /* nicht im Test */ },
      async cancelHoldInvoice() { /* nicht im Test */ },
    },
  };
}

function setup(over: Partial<typeof angebot> = {}, maxLamportsPerSwap = 1_000_000_000, uhr?: { t: number }) {
  const pool = new OutboxPool([new MemoryRelay("mem://lp")], { minAcks: 1 });
  const a = adapter();
  const lp = new LpDaemon(
    { keypair: LP, offer: { ...angebot, ...over }, offerTtlSecs: 3600, maxLamportsPerSwap },
    pool, a.ln as never, a.sol as never, new FixedRate(100), uhr ? () => uhr.t : undefined,
  );
  return { pool, lp, a };
}

function anfrage(over: Record<string, string> = {}) {
  const pre = generatePreimage();
  const tags = [
    ["p", LP.pk],
    ["offer", over.offer ?? "offer-1"],
    ["amount_sats", over.amount_sats ?? "10000"],
    ["hashlock", over.hashlock ?? toHex(hashlock(pre))],
    ["solana_address", over.solana_address ?? KUNDE_SOL],
  ].filter((t) => over[t[0]] !== "");
  return signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, tags, ""), KUNDE.sk);
}

test("Angebot wird veroeffentlicht und ist auffindbar", async () => {
  const { pool, lp } = setup();
  const id = await lp.publishOffer();
  assert.ok(id);
  const evs = await pool.query({ authors: [LP.pk], limit: 10 });
  assert.ok(evs.some((e) => e.id === id));
});

test("Gueltige Anfrage: SOL gesperrt, Rechnung gestellt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage());
  const sessions = await lp.pollOnce();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].phase, "INVOICE_CREATED");
  // Reihenfolge ist wichtig: erst sperren, dann die Rechnung stellen. Anders
  // herum koennte der Kunde zahlen, bevor etwas gedeckt ist.
  assert.equal(a.locks.length, 1);
  assert.equal(a.locks[0].recipient, KUNDE_SOL);
  assert.equal(a.locks[0].amountLamports, 10_000 * 100);
  assert.equal(a.invoices.length, 1);
});

test("Angebot wird vor Ablauf erneuert – sonst verschwaende der LP nach offerTtlSecs aus der App", async () => {
  const { pool, lp } = setup();
  const t0 = 1_790_000_000;
  await lp.publishOffer(t0);
  assert.equal(await lp.erneuereAngebot(t0 + 1799), undefined, "vor der Haelfte der Gueltigkeit nicht");
  const neu = await lp.erneuereAngebot(t0 + 1800);
  assert.ok(neu);
  const ev = (await pool.query({ authors: [LP.pk], limit: 10 })).find((e) => e.id === neu)!;
  assert.equal(ev.tags.find((t) => t[0] === "expiry")?.[1], String(t0 + 1800 + 3600));
  assert.equal(await lp.erneuereAngebot(t0 + 1801), undefined, "danach wieder erst zur Haelfte");
});

test("Fremdes Angebot wird nicht bedient", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ offer: "offer-von-jemand-anderem" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0, "es darf NICHTS gesperrt werden");
});

test("Betrag ueber dem Angebot wird abgelehnt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ amount_sats: "999999" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Betrag unter dem Mindestwert wird abgelehnt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ amount_sats: "10" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Liquiditaetsdeckel greift VOR dem Sperren", async () => {
  // Der Deckel ist der Schutz davor, dass ein einzelner Swap die gesamte
  // Liquiditaet bindet.
  const { pool, lp, a } = setup({}, 100_000);
  await pool.publish(anfrage({ amount_sats: "10000" })); // 1.000.000 lamports
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Unsichere Timelock-Ordnung verhindert jede Geldbewegung", async () => {
  // T_sol muss deutlich vor der Lightning-Frist enden. Sonst kann der Kunde
  // SOL einloesen, nachdem die Zahlung zurueckgelaufen ist — der LP verliert.
  const { pool, lp, a } = setup({ tSolSecs: 86_400 * 30, lnCltvDeltaBlocks: 6 });
  await pool.publish(anfrage());
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0, "nicht sperren, wenn die Ordnung unsicher ist");
});

test("Unvollstaendige Anfrage wird abgelehnt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ hashlock: "" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Hashlock mit falscher Form wird abgelehnt, bevor etwas gesperrt wird", async () => {
  // fromHex() schnitt still ab, das Sperren fuellte mit Nullen auf: SOL laege
  // unter einem Hash, dessen Preimage niemand kennt, bis zur Frist fest (0.J).
  const gueltig = toHex(hashlock(generatePreimage()));
  for (const h of ["ab", gueltig.slice(0, 62), gueltig + "<b>x</b>", "zz" + gueltig.slice(2)]) {
    const { pool, lp, a } = setup();
    await pool.publish(anfrage({ hashlock: h }));
    assert.equal((await lp.pollOnce()).length, 0, `Hashlock ${JSON.stringify(h)} bedient`);
    assert.equal(a.locks.length, 0, "es darf NICHTS gesperrt werden");
  }
});

test("Dieselbe Anfrage wird nur einmal bedient", async () => {
  // Ohne diese Pruefung wuerde ein wiederholt geliefertes Event zweimal
  // Liquiditaet binden.
  const { pool, lp, a } = setup();
  await pool.publish(anfrage());
  await lp.pollOnce();
  await lp.pollOnce();
  assert.equal(a.locks.length, 1);
});

test("Anfragen an andere LPs werden ignoriert", async () => {
  const { pool, lp, a } = setup();
  const fremd = generateKeypair();
  await pool.publish(signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [
    ["p", fremd.pk], ["offer", "offer-1"], ["amount_sats", "10000"],
    ["hashlock", toHex(hashlock(generatePreimage()))], ["solana_address", KUNDE_SOL],
  ], ""), KUNDE.sk));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Ein fehlgeschlagener Request blockiert die anderen nicht", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ amount_sats: "999999" }));
  await pool.publish(anfrage());
  const sessions = await lp.pollOnce();
  assert.equal(sessions.length, 1, "die gueltige Anfrage geht durch");
  assert.equal(a.locks.length, 1);
});

// ------------------------------------------------ Vorab-Gebuehr (4.6d)

test("Vorab-Gebuehr: erst eine kleine Rechnung, gesperrt wird erst nach der Zahlung", async () => {
  const { pool, lp, a } = setup({ vorabSats: 10 });
  const anf = anfrage();
  await pool.publish(anf);
  const [s1] = await lp.pollOnce();
  assert.equal(s1.phase, "VORAB");
  assert.equal(a.locks.length, 0, "vor der Zahlung wird NICHTS gesperrt");
  const [vorab] = await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [anf.id] });
  assert.equal(getTag(vorab, "status"), "VORAB");
  assert.equal(getTag(vorab, "vorab_sats"), "10");
  assert.equal(vorab.content, "lnbcvorab10");
  assert.equal(getTag(vorab, "swap_id"), undefined, "noch keine Sperre, keine Swap-ID");

  assert.equal((await lp.pollOnce()).length, 0, "unbezahlt: weiter warten");
  for (const k of a.vorab.keys()) a.vorab.set(k, true); // Kunde zahlt
  const [s2] = await lp.pollOnce();
  assert.equal(s2.phase, "INVOICE_CREATED");
  assert.equal(a.locks.length, 1);
  assert.equal(a.locks[0].amountLamports, 10_000 * 100, "die Vorab-Gebuehr mindert den Tausch nicht");
  assert.equal(a.invoices.length, 1);
  const antworten = await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [anf.id] });
  assert.ok(antworten.some((e) => getTag(e, "swap_id")), "jetzt die Hold-Invoice mit Swap-ID");
  assert.equal((await lp.pollOnce()).length, 0, "nur einmal gesperrt");
  assert.equal(a.locks.length, 1);
});

test("Vorab-Gebuehr: unbezahlt nach der Frist verworfen – auch eine spaete Zahlung sperrt nichts mehr", async () => {
  const uhr = { t: 1_790_000_000 };
  const { pool, lp, a } = setup({ vorabSats: 10 }, 1_000_000_000, uhr);
  await pool.publish(anfrage());
  const [s] = await lp.pollOnce();
  uhr.t += VORAB_FRIST_SECS;
  await lp.pollOnce();
  assert.equal(s.phase, "FAILED");
  for (const k of a.vorab.keys()) a.vorab.set(k, true);
  await lp.pollOnce();
  assert.equal(a.locks.length, 0);
});

test("Vorab-Gebuehr steht im Angebot; ohne sie sperrt der LP wie bisher sofort", async () => {
  const { pool, lp } = setup({ vorabSats: 10 });
  await lp.publishOffer();
  const [ev] = await pool.query({ kinds: [KIND_LP_OFFER], authors: [LP.pk] });
  assert.equal(parseLpOffer(ev).vorabSats, 10);
  const ohne = setup();
  await ohne.pool.publish(anfrage());
  assert.equal((await ohne.lp.pollOnce())[0].phase, "INVOICE_CREATED");
  assert.equal(ohne.a.vorab.size, 0);
});
