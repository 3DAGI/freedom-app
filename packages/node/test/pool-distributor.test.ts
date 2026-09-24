/**
 * Tests fuer den Reward-Pool-Verteiler.
 *
 * Hier wird fremdes Geld bewegt. Der Schwerpunkt liegt deshalb auf den drei
 * Faellen, in denen ein Fehler richtig teuer waere: doppelte Auszahlung,
 * Ueberschreitung des Topfes, und eine Verteilung ohne Aufzeichnung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool, MemoryRelay, generateKeypair, signEvent,
  buildPerformanceEvent, NostrEvent,
} from "@freedomstack/protocol";
import {
  PoolDistributor, verifyDistributionReport, epochNumber, KIND_POOL_DISTRIBUTION,
} from "../src/pool-distributor.js";
import { Payer } from "../src/settlement.js";

const EPOCH = 7 * 24 * 3600;
/** Fest in einer abgeschlossenen Epoche, damit die Rechnung reproduzierbar ist. */
const NOW = 100 * EPOCH + 3600;
// NOW liegt in Epoche 100, verteilt wird die abgeschlossene Epoche 99.
const LETZTE_EPOCHE = 99;

class TestPayer implements Payer {
  public gezahlt: { lud16: string; msat: number }[] = [];
  constructor(private failOn?: string) {}
  async payToLightningAddress(lud16: string, amountMsat: number) {
    if (lud16 === this.failOn) throw new Error("keine route");
    this.gezahlt.push({ lud16, msat: amountMsat });
    return { preimage: "aa".repeat(32), paymentHash: "bb".repeat(32) };
  }
}

function perf(worker: { pk: string; sk: Uint8Array }, region: string, createdAt: number, msat = 100_000) {
  const ev = buildPerformanceEvent({
    workerPubkey: worker.pk, workType: "ai_job", units: 100,
    volumeMsat: msat, chain: "lightning", seasonId: "s",
  }, createdAt);
  ev.tags.push(["region", region]);
  return signEvent(ev, worker.sk);
}

async function setup(opts: { failOn?: string } = {}) {
  const pool = new OutboxPool([new MemoryRelay("mem://pool")], { minAcks: 1 });
  const betreiber = generateKeypair();
  const payer = new TestPayer(opts.failOn);
  const dist = new PoolDistributor(
    { keypair: betreiber, epochSeconds: EPOCH, minTrust: 0, minJobs: 1 },
    pool, payer,
  );
  return { pool, betreiber, payer, dist };
}

/** Provider mit Nachweisen in der abgeschlossenen Epoche. */
async function fuelle(pool: OutboxPool, n: number, region = "af") {
  const kps = Array.from({ length: n }, () => generateKeypair());
  const lud16 = new Map<string, string>();
  for (const kp of kps) {
    for (let i = 0; i < 5; i++) {
      await pool.publish(perf(kp, region, LETZTE_EPOCHE * EPOCH + 100 + i));
    }
    lud16.set(kp.pk, `${kp.pk.slice(0, 6)}@w.cash`);
  }
  return { kps, lud16 };
}

// ------------------------------------------------------------- Epochen

test("Epochen: die LAUFENDE Woche wird nie verteilt", () => {
  // Sonst bekaemen Provider, die spaeter in der Woche arbeiten, systematisch
  // nichts.
  assert.equal(epochNumber(NOW, EPOCH), 100);
});

test("Faelligkeit: erst wenn eine Epoche abgeschlossen ist", async () => {
  const { dist } = await setup();
  assert.equal(dist.isDue(NOW), true);
});

test("Doppelte Auszahlung wird verhindert", async () => {
  const { pool, dist, payer } = await setup();
  const { lud16 } = await fuelle(pool, 3);

  const erst = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.ok(erst.distributedMsat > 0);
  const anzahl = payer.gezahlt.length;

  // Der teuerste denkbare Fehler in diesem Modul: ein Verteiler, der nach
  // einem Neustart von vorn beginnt und den Pool erneut leert.
  const zweit = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.match(zweit.skipped ?? "", /bereits verteilt/);
  assert.equal(payer.gezahlt.length, anzahl, "keine zweite Zahlung");
});

// ------------------------------------------------------------- Topf

test("Der Topf wird nie ueberschritten", async () => {
  const { pool, dist } = await setup();
  const { lud16 } = await fuelle(pool, 20);
  const r = await dist.distribute({ poolMsat: 50_000, lud16Of: lud16, nowSecs: NOW });
  const summe = r.payouts.reduce((s, p) => s + p.msat, 0);
  assert.ok(summe <= 50_000, `${summe} > 50.000`);
});

test("Zu kleiner Topf wird angespart statt in Gebuehren verbrannt", async () => {
  const { pool, dist } = await setup();
  const { lud16 } = await fuelle(pool, 2);
  const r = await dist.distribute({ poolMsat: 500, lud16Of: lud16, nowSecs: NOW });
  assert.match(r.skipped ?? "", /angespart/);
  assert.equal(r.carryOverMsat, 500, "der Betrag bleibt im Pool");
});

test("Uebertrag summiert sich ueber Epochen, statt zum Betreiber zu gehen", async () => {
  const { pool, dist } = await setup();
  const { lud16 } = await fuelle(pool, 2);

  await dist.distribute({ poolMsat: 500, lud16Of: lud16, nowSecs: NOW });
  assert.equal(dist.currentState.carryOverMsat, 500);

  // Naechste Epoche: der alte Uebertrag steht zusaetzlich zur Verfuegung.
  const r = await dist.distribute({ poolMsat: 400, lud16Of: lud16, nowSecs: NOW + EPOCH });
  assert.equal(r.carryOverMsat, 900, "nichts geht unterwegs verloren");
  assert.equal(dist.currentState.carryOverMsat, 900);
});

test("Nicht ausgezahlte Betraege bleiben im Pool", async () => {
  const { pool, dist } = await setup();
  const { kps, lud16 } = await fuelle(pool, 3);
  // Einem Provider die Adresse vorenthalten.
  lud16.delete(kps[0].pk);

  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  const offen = r.payouts.filter((p) => !p.paid);
  assert.ok(offen.length >= 1);
  assert.match(offen[0].error ?? "", /Lightning-Adresse/);
  assert.ok(r.carryOverMsat > 0, "was nicht ankam, bleibt im Topf");
});

test("Gescheiterte Zahlung blockiert die anderen nicht", async () => {
  const { pool } = await setup();
  const { kps, lud16 } = await fuelle(pool, 3);
  const kaputt = lud16.get(kps[0].pk)!;

  const betreiber = generateKeypair();
  const payer = new TestPayer(kaputt);
  const dist = new PoolDistributor(
    { keypair: betreiber, epochSeconds: EPOCH, minTrust: 0, minJobs: 1 }, pool, payer,
  );
  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.ok(r.payouts.some((p) => p.paid), "die anderen gehen durch");
  assert.ok(r.payouts.some((p) => !p.paid));
});

// ------------------------------------------------------------- Auswahl

test("Ohne Jobs kein Anteil", async () => {
  const { pool, dist } = await setup();
  const { lud16 } = await fuelle(pool, 2);
  // Ein Provider ohne jeden Nachweis taucht gar nicht erst auf.
  const fremd = generateKeypair();
  lud16.set(fremd.pk, "fremd@w.cash");

  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.ok(!r.payouts.some((p) => p.pubkey === fremd.pk));
});

test("Nachweise aus einer anderen Epoche zaehlen nicht", async () => {
  const { pool, dist } = await setup();
  const kp = generateKeypair();
  // Vier Epochen alt.
  for (let i = 0; i < 5; i++) await pool.publish(perf(kp, "af", (LETZTE_EPOCHE - 4) * EPOCH + i));
  const lud16 = new Map([[kp.pk, "a@w.cash"]]);

  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.equal(r.payouts.length, 0, "jede Epoche rechnet nur ihre eigene Arbeit ab");
});

test("Probelauf zahlt nichts und merkt sich nichts", async () => {
  const { pool, dist, payer } = await setup();
  const { lud16 } = await fuelle(pool, 3);

  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW, dryRun: true });
  assert.equal(payer.gezahlt.length, 0);
  assert.equal(dist.currentState.lastEpoch, 0, "ein Probelauf darf keine Epoche verbrauchen");
  assert.ok(r.payouts.length > 0, "aber er zeigt, was passieren wuerde");
});

// ------------------------------------------------------------- Bericht

test("Bericht wird veroeffentlicht und ist stimmig", async () => {
  const { pool, dist } = await setup();
  const { lud16 } = await fuelle(pool, 3);
  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.ok(r.reportEventId);

  const [ev] = await pool.query({ kinds: [KIND_POOL_DISTRIBUTION], limit: 1 });
  const v = verifyDistributionReport(ev as NostrEvent);
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.equal(v.distributedMsat, r.distributedMsat);
});

test("Bericht erscheint auch, wenn Zahlungen scheitern", async () => {
  // Eine Verteilung ohne Aufzeichnung ist von einer Unterschlagung nicht zu
  // unterscheiden.
  const { pool } = await setup();
  const { kps, lud16 } = await fuelle(pool, 2);
  const betreiber = generateKeypair();
  const dist = new PoolDistributor(
    { keypair: betreiber, epochSeconds: EPOCH, minTrust: 0, minJobs: 1 },
    pool, new TestPayer(lud16.get(kps[0].pk)),
  );
  const r = await dist.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
  assert.ok(r.reportEventId, "auch ein unvollstaendiges Ergebnis wird offengelegt");
});

test("Bericht: manipulierte Summen fallen auf", () => {
  const kp = generateKeypair();
  const gefaelscht = signEvent({
    pubkey: kp.pk, kind: KIND_POOL_DISTRIBUTION, created_at: NOW, content: "",
    tags: [
      ["d", "pool:1"], ["epoch", "1"],
      ["pool_msat", "1000"], ["distributed_msat", "5000"], ["carry_msat", "0"],
      ["payout", "a".repeat(64), "5000", "paid"],
    ],
  } as never, kp.sk);

  const v = verifyDistributionReport(gefaelscht);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /mehr verteilt als vorhanden/.test(p)));
});

test("Bericht: Einzelposten muessen die Summe ergeben", () => {
  const kp = generateKeypair();
  const ev = signEvent({
    pubkey: kp.pk, kind: KIND_POOL_DISTRIBUTION, created_at: NOW, content: "",
    tags: [
      ["epoch", "1"], ["pool_msat", "1000"],
      ["distributed_msat", "900"], ["carry_msat", "100"],
      ["payout", "a".repeat(64), "400", "paid"], // fehlt 500
    ],
  } as never, kp.sk);

  const v = verifyDistributionReport(ev);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /Einzelposten/.test(p)));
});

// ------------------------------------------------------------- Zustand

test("Zustand ueberlebt einen Neustart", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "freedom-pool-"));
  const statePath = join(dir, "pool.json");

  try {
    const pool = new OutboxPool([new MemoryRelay("mem://p2")], { minAcks: 1 });
    const { lud16 } = await fuelle(pool, 3);
    const kp = generateKeypair();

    const a = new PoolDistributor(
      { keypair: kp, epochSeconds: EPOCH, statePath, minTrust: 0, minJobs: 1 },
      pool, new TestPayer(),
    );
    await a.load();
    await a.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });

    // Neustart: derselbe Zustand, keine zweite Auszahlung.
    const payerB = new TestPayer();
    const b = new PoolDistributor(
      { keypair: kp, epochSeconds: EPOCH, statePath, minTrust: 0, minJobs: 1 },
      pool, payerB,
    );
    await b.load();
    const r = await b.distribute({ poolMsat: 1_000_000, lud16Of: lud16, nowSecs: NOW });
    assert.match(r.skipped ?? "", /bereits verteilt/);
    assert.equal(payerB.gezahlt.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
