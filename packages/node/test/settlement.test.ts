/**
 * Tests fuer die tatsaechliche Fee-Auszahlung.
 *
 * Der Schwerpunkt liegt auf den Faellen, in denen etwas schiefgeht: eine
 * Zahlung schlaegt fehl, ein Betrag ist zu klein, ein Ziel fehlt. Gerade dort
 * darf kein Geld verschwinden und der Kunde darf nicht bestraft werden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bech32 } from "@scure/base";
import {
  generateKeypair,
  OutboxPool,
  MemoryRelay,
  splitFeeV1,
  verifyFeeProof,
  KIND_FEE_PROOF,
  NostrEvent,
} from "@freedomstack/protocol";
import {
  settleJobFees,
  FeeAccumulator,
  LnurlPayer,
  Payer,
  MIN_PAYOUT_MSAT,
} from "../src/settlement.js";

const CLIENT_FEE = 25_000; // 2,5 % von 1.000.000 msat

/** Selbst signierte bolt11-Rechnung (Test) – Knoten mit Wegwerfschluessel. */
const KNOTEN_SK = secp256k1.utils.randomSecretKey();
function rechnung(msat: number, preimage: Uint8Array): string {
  const inBytes = (w: number[]) => {
    const out: number[] = []; let a = 0, b = 0;
    for (const x of w) { a = (a << 5) | x; b += 5; while (b >= 8) { b -= 8; out.push((a >> b) & 0xff); } }
    if (b > 0) out.push((a << (8 - b)) & 0xff);
    return Uint8Array.from(out);
  };
  const prefix = `lnbc${msat * 10}p`;
  const p = bech32.toWords(sha256(preimage));
  const woerter = [0, 0, 0, 0, 0, 0, 1, 1, Math.floor(p.length / 32), p.length % 32, ...p];
  const sig = secp256k1.sign(new Uint8Array([...new TextEncoder().encode(prefix), ...inBytes(woerter)]), KNOTEN_SK, { format: "recovered" });
  return bech32.encode(prefix, [...woerter, ...bech32.toWords(new Uint8Array([...sig.slice(1), sig[0]]))], false);
}

const TARGETS = {
  pool: { lud16: "pool@freedom.cash" },
  referral: { lud16: "ref@freedom.cash" },
  dev: { lud16: "dev@freedom.cash" },
};

/** Payer, der immer gelingt und Preimage samt bezahlter Rechnung liefert. */
class GoodPayer implements Payer {
  public paid: { lud16: string; msat: number }[] = [];
  async payToLightningAddress(lud16: string, amountMsat: number) {
    this.paid.push({ lud16, msat: amountMsat });
    const preimage = sha256(new TextEncoder().encode(lud16 + amountMsat));
    return { preimage: bytesToHex(preimage), paymentHash: bytesToHex(sha256(preimage)), bolt11: rechnung(amountMsat, preimage) };
  }
}

class FailingPayer implements Payer {
  constructor(private failOn: string) {}
  async payToLightningAddress(lud16: string, amountMsat: number) {
    if (lud16 === this.failOn) throw new Error("keine route zum empfaenger");
    const preimage = bytesToHex(sha256(new TextEncoder().encode(lud16)));
    return { preimage, paymentHash: bytesToHex(sha256(hexToBytes(preimage))) };
  }
}

function setup() {
  const pool = new OutboxPool([new MemoryRelay("mem://settle")], { minAcks: 1 });
  const provider = generateKeypair();
  const customer = generateKeypair();
  return { pool, provider, customer };
}

const base = (over: Record<string, unknown> = {}) => {
  const { pool, provider, customer } = setup();
  return {
    totalMsat: 1_000_000,
    resultEventId: "a".repeat(64),
    providerKeypair: provider,
    providerLud16: "provider@wallet.cash",
    customerPubkey: customer.pk,
    targets: TARGETS,
    clientFeeMsat: CLIENT_FEE,
    clientFeeRecipient: "client@freedom.cash",
    pool,
    ...over,
  };
};

test("Settlement: alle drei Fee-Anteile werden tatsaechlich gezahlt", async () => {
  const payer = new GoodPayer();
  const r = await settleJobFees({ ...base(), payer } as Parameters<typeof settleJobFees>[0]);

  assert.equal(r.legs.length, 3);
  assert.ok(r.legs.every((l) => l.paid), "keine Teilzahlung darf offen bleiben");
  assert.equal(r.unsettledMsat, 0);
  assert.equal(payer.paid.length, 3);

  const s = splitFeeV1(1_000_000);
  const byAddr = Object.fromEntries(payer.paid.map((p) => [p.lud16, p.msat]));
  assert.equal(byAddr["client@freedom.cash"], CLIENT_FEE, "Client-Gebuehr statt Dev-Anteil");
  assert.equal(byAddr["pool@freedom.cash"], s.poolMsat);
  assert.equal(byAddr["ref@freedom.cash"], s.referralMsat);
});

test("Settlement: der veroeffentlichte Beweis ist gueltig und belegt", async () => {
  const args = base();
  const r = await settleJobFees({ ...args, payer: new GoodPayer() } as Parameters<typeof settleJobFees>[0]);
  assert.ok(r.proofEventId, "Beweis muss veroeffentlicht werden");

  const events = await (args.pool as OutboxPool).query({ kinds: [KIND_FEE_PROOF], limit: 5 });
  assert.equal(events.length, 1);

  const v = verifyFeeProof(events[0] as NostrEvent, { clientFeeMsat: CLIENT_FEE });
  assert.equal(v.signatureValid, true);
  assert.equal(v.amountsMatch, true);
  assert.equal(v.sumsMatch, true);
  assert.equal(v.ok, true);
  // Seit 4.8: Preimage und Rechnung liegen bei, die Zahlung an den Knoten ist
  // belegt. Die Empfaenger sind aber Lightning-Adressen ohne Knotenangabe –
  // bei Verwahrdiensten teilen sich viele einen Knoten. Deshalb ehrlich
  // „angekuendigt“, nicht „belegt“ (bis 4.8 zaehlte hier ein Preimage allein).
  const fee = v.legs.filter((l) => l.leg !== "worker");
  assert.equal(fee.length, 3);
  assert.ok(fee.every((l) => l.status === "announced" && /Zahlung an Knoten .* belegt/.test(l.detail)), JSON.stringify(fee));
});

test("Settlement: fehlgeschlagene Zahlung blockiert den Job nicht", async () => {
  const r = await settleJobFees({
    ...base(),
    payer: new FailingPayer("pool@freedom.cash"),
  } as Parameters<typeof settleJobFees>[0]);

  const pool = r.legs.find((l) => l.leg === "pool")!;
  assert.equal(pool.paid, false);
  assert.match(pool.error!, /keine route/);
  // Die anderen beiden gehen trotzdem durch — der Kunde bekommt sein Ergebnis.
  assert.equal(r.legs.filter((l) => l.paid).length, 2);
  assert.equal(r.unsettledMsat, splitFeeV1(1_000_000).poolMsat);
  assert.ok(r.proofEventId, "auch ein unvollstaendiges Settlement wird offengelegt");
});

test("Settlement: Beweis zeigt offene Zahlung ehrlich als 'angekuendigt'", async () => {
  const args = base();
  await settleJobFees({
    ...args, payer: new FailingPayer("ref@freedom.cash"),
  } as Parameters<typeof settleJobFees>[0]);

  const [ev] = await (args.pool as OutboxPool).query({ kinds: [KIND_FEE_PROOF], limit: 1 });
  const v = verifyFeeProof(ev as NostrEvent, { clientFeeMsat: CLIENT_FEE });
  const ref = v.legs.find((l) => l.leg === "referral")!;
  assert.equal(ref.status, "announced", "ohne Preimage darf nichts als bewiesen gelten");
});

test("Settlement: ohne Payer wird gerechnet und offengelegt, nicht stillgeschwiegen", async () => {
  const r = await settleJobFees(base() as Parameters<typeof settleJobFees>[0]);
  assert.equal(r.unsettledMsat, CLIENT_FEE + splitFeeV1(1_000_000).poolMsat + splitFeeV1(1_000_000).referralMsat);
  assert.ok(r.legs.every((l) => !l.paid));
  assert.ok(r.proofEventId);
});

// --------------------------------------------------------- Kleinbetraege

test("Kleinbetraege: unter der Schwelle wird gesammelt statt gezahlt", async () => {
  const acc = new FeeAccumulator();
  const payer = new GoodPayer();
  // 1200 msat Job -> 5% = 60 msat Fee, davon 6 msat Referral.
  // Eine Lightning-Zahlung ueber 6 msat ist unmoeglich (Minimum 1 sat).
  const r = await settleJobFees({
    ...base({ totalMsat: 1200 }), payer, accumulator: acc,
    clientFeeMsat: 30, // 2,5 % von 1200 msat
  } as Parameters<typeof settleJobFees>[0]);

  assert.equal(payer.paid.length, 0, "keine Mikrozahlung ausloesen");
  assert.ok(r.legs.every((l) => /Auszahlungsschwelle/.test(l.error ?? "")));
  assert.ok(acc.totalPending() > 0, "die Betraege muessen erhalten bleiben");
});

test("Kleinbetraege: nach genug Jobs wird die Summe ausgezahlt", async () => {
  const acc = new FeeAccumulator();
  const payer = new GoodPayer();
  // Pro Job 25.000 msat Dev-Anteil bei 500.000 msat Umsatz -> sofort ueber der
  // Schwelle. Referral 2.500 msat -> braucht vier Jobs fuer 10.000 msat.
  for (let i = 0; i < 4; i++) {
    await settleJobFees({
      ...base({ totalMsat: 500_000 }), payer, accumulator: acc,
    } as Parameters<typeof settleJobFees>[0]);
  }
  const refZahlungen = payer.paid.filter((p) => p.lud16 === "ref@freedom.cash");
  assert.equal(refZahlungen.length, 1, "genau einmal, als die Schwelle erreicht war");
  assert.equal(refZahlungen[0].msat, 10_000, "die gesammelte Summe, kein Bruchteil");
});

test("Kleinbetraege: nichts geht verloren, wenn die Zahlung scheitert", async () => {
  const acc = new FeeAccumulator();
  await settleJobFees({
    ...base({ totalMsat: 1_000_000 }),
    payer: new FailingPayer("pool@freedom.cash"),
    accumulator: acc,
  } as Parameters<typeof settleJobFees>[0]);

  // Der gescheiterte Betrag muss zurueck in die Ruecklage, nicht verschwinden.
  assert.equal(acc.pending("pool:pool@freedom.cash"), splitFeeV1(1_000_000).poolMsat);
});

test("Kleinbetraege: Schwelle ist wirtschaftlich sinnvoll gewaehlt", () => {
  // Unter 1 sat ist eine Lightning-Zahlung technisch unmoeglich; 10 sats geben
  // Luft fuer die Routing-Gebuehr.
  assert.ok(MIN_PAYOUT_MSAT >= 1000);
});

test("Ruecklage: ueberlebt einen Neustart", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "freedom-settle-"));
  const path = join(dir, "fees.json");
  try {
    const a = new FeeAccumulator(path);
    a.add("pool:x", 4000);
    await a.save();

    const b = new FeeAccumulator(path);
    await b.load();
    assert.equal(b.pending("pool:x"), 4000, "offene Fee darf ein Neustart nicht loeschen");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- Ziele

test("Kein Dev-Ziel mehr im Protokoll", async () => {
  // Der Entwickler-Anteil kommt aus der Client-Deklaration im Job-Event.
  // Gaebe es hier wieder eine ableitbare Protokoll-Adresse, waere die
  // Umschichtung rueckgaengig gemacht — und der Betreiber zurueck.
  const mod = await import("../src/settlement.js") as Record<string, unknown>;
  assert.equal("devTarget" in mod, false);

  const protokoll = await import("@freedomstack/protocol") as Record<string, unknown>;
  assert.equal("TREASURY_SOL_PUBKEY" in protokoll, false, "keine verankerte Adresse mehr");
});

test("Client-Gebuehr ohne Empfaenger wird nicht gezahlt", async () => {
  // Ohne deklarierten Empfaenger gibt es niemanden, der sie erzwingt — der
  // Betrag bleibt beim Provider.
  const payer = new GoodPayer();
  const r = await settleJobFees({
    ...base(), payer, clientFeeMsat: 0, clientFeeRecipient: undefined,
  } as Parameters<typeof settleJobFees>[0]);
  assert.ok(!r.legs.some((l) => l.leg === "client"));
});

// ------------------------------------------------------------- LNURL

test("LNURL-Payer: holt Rechnung und leitet Preimage samt Hash zurueck", async () => {
  const preimage = "ab".repeat(32);
  const fakeFetch = (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes("/.well-known/lnurlp/")) {
      return new Response(JSON.stringify({ callback: "https://w.cash/cb", minSendable: 1000, maxSendable: 1e9 }));
    }
    return new Response(JSON.stringify({ pr: rechnung(25_000, hexToBytes(preimage)) }));
  }) as unknown as typeof fetch;

  const payer = new LnurlPayer(async () => ({ preimage }), fakeFetch);
  const r = await payer.payToLightningAddress("pool@w.cash", 25_000, "test");

  assert.equal(r.preimage, preimage);
  // Der Hash kommt aus der signierten Rechnung, das Preimage passt dazu.
  assert.equal(r.paymentHash, bytesToHex(sha256(hexToBytes(preimage))));
  assert.ok(r.bolt11.startsWith("lnbc250000p"), "bezahlte Rechnung fuer den Beleg");
});

test("LNURL-Payer (4.8): teurere oder kaputte Rechnung wird nicht bezahlt, falsches Preimage faellt auf", async () => {
  const preimage = "ab".repeat(32);
  let pr = rechnung(2_500_000, hexToBytes(preimage)); // hundertmal so teuer
  const fakeFetch = (async (url: string | URL) => url.toString().includes("/.well-known/lnurlp/")
    ? new Response(JSON.stringify({ callback: "https://w.cash/cb", minSendable: 1000, maxSendable: 1e9 }))
    : new Response(JSON.stringify({ pr }))) as unknown as typeof fetch;
  let bezahlt = 0;
  const payer = new LnurlPayer(async () => { bezahlt++; return { preimage }; }, fakeFetch);
  await assert.rejects(() => payer.payToLightningAddress("pool@w.cash", 25_000, "t"), /nicht bezahlt/);
  pr = "lnbc1kaputt";
  await assert.rejects(() => payer.payToLightningAddress("pool@w.cash", 25_000, "t"));
  assert.equal(bezahlt, 0, "nichts bezahlt");
  pr = rechnung(25_000, hexToBytes("cd".repeat(32)));
  await assert.rejects(() => payer.payToLightningAddress("pool@w.cash", 25_000, "t"), /Preimage passt nicht/);
});

test("LNURL-Payer: Betrag ausserhalb der Grenzen des Empfaengers", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ callback: "https://w.cash/cb", minSendable: 100_000, maxSendable: 1e9 }))
  ) as unknown as typeof fetch;
  const payer = new LnurlPayer(async () => ({ preimage: "00" }), fakeFetch);
  await assert.rejects(() => payer.payToLightningAddress("a@b.c", 1000, "x"), /Minimum/);
});

test("LNURL-Payer: kaputte Adresse wird sauber abgelehnt", async () => {
  const payer = new LnurlPayer(async () => ({ preimage: "00" }));
  await assert.rejects(() => payer.payToLightningAddress("keinAt", 1000, "x"), /ungültige Lightning-Adresse/);
});
