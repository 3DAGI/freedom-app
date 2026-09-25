/**
 * Tests fuer den Fee-Beweis.
 *
 * Der Beweis ist nur so viel wert wie seine Faelschungsresistenz. Deshalb
 * pruefen die Tests vor allem die Angriffe: manipulierte Betraege, fehlende
 * legs, falsches Preimage, fremde Treasury-Adresse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import { splitFeeV1 } from "../src/protocol-fee.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  buildFeeProof,
  parseFeeProof,
  verifyFeeProof,
  verifyFeeProofMitKette,
  feeLegsFor,
  preimageMatches,
  KIND_FEE_PROOF,
} from "../src/fee-proof.js";
import { rechnung } from "./bolt11-hilfe.js";

const RECIPIENTS = {
  worker: "provider@wallet.cash",
  dev: "treasury@freedom.cash",
  pool: "pool@freedom.cash",
  referral: "ref@freedom.cash",
};

/**
 * Der Verifier kennt die Client-Gebuehr nicht von sich aus — sie steht im
 * Job-Event des Clients, nicht im Protokoll. Deshalb wird sie hier
 * mitgegeben, genau wie es ein echter Pruefer taete.
 */
function verifyFeeProofWithClient(ev: Parameters<typeof verifyFeeProof>[0], opts: Record<string, unknown> = {}) {
  const total = Number(ev.tags.find((t) => t[0] === "total_msat")?.[1] ?? "0");
  return verifyFeeProof(ev, { clientFeeMsat: clientFeeOf(total), ...opts });
}

/** Client-Gebuehr der Referenz-App: 2,5 %. */
const clientFeeOf = (total: number): number => Math.floor(total * 0.025);
const CLIENT_FEE_MSAT = clientFeeOf(1_000_000);

function proofEvent(totalMsat: number, mutate?: (legs: ReturnType<typeof feeLegsFor>) => void) {
  const provider = generateKeypair();
  const customer = generateKeypair();
  const legs = feeLegsFor(totalMsat, RECIPIENTS, "lightning", Math.floor(totalMsat * 0.025));
  mutate?.(legs);
  const unsigned = buildFeeProof({
    resultEventId: "a".repeat(64),
    providerPubkey: provider.pk,
    customerPubkey: customer.pk,
    totalMsat,
    legs,
    treasuryWeek: 2810,
  });
  return signEvent(unsigned, provider.sk);
}

test("Fee-Beweis: korrekter Split wird als korrekt erkannt", () => {
  const v = verifyFeeProofWithClient(proofEvent(100_000));
  assert.equal(v.signatureValid, true);
  assert.equal(v.sumsMatch, true);
  assert.equal(v.amountsMatch, true);
  assert.equal(v.ok, true);
  assert.equal(v.legs.length, 4);
});

test("Fee-Beweis: Betraege entsprechen exakt 5% mit 50/40/10", () => {
  const total = 1_000_000;
  const v = verifyFeeProofWithClient(proofEvent(total));
  const byLeg = Object.fromEntries(v.legs.map((l) => [l.leg, l.amountMsat]));
  const s = splitFeeV1(total);

  assert.equal(byLeg.client, CLIENT_FEE_MSAT);
  assert.equal(byLeg.pool, s.poolMsat);
  assert.equal(byLeg.referral, s.referralMsat);
  // Der Worker bekommt jetzt weniger als workerMsat: Die Client-Gebuehr geht
  // von SEINEM Anteil ab, nicht von Pool oder Referral. Das ist Absicht — die
  // Netz-Anteile duerfen von einer Client-Entscheidung nicht geschmaelert werden.
  assert.equal(byLeg.worker, s.workerMsat - CLIENT_FEE_MSAT);
  // Protokollfee 2,5 % = 25.000 msat: 20.000 Pool + 5.000 Referral. Der
  // Client-Anteil kommt getrennt obendrauf und ist KEINE Protokollfee.
  assert.equal(byLeg.pool + byLeg.referral, 25_000);
});

test("Fee-Beweis: kein msat verschwindet", () => {
  for (const total of [1, 7, 999, 1000, 123_457, 10_000_000]) {
    const v = verifyFeeProofWithClient(proofEvent(total));
    const sum = v.legs.reduce((s, l) => s + l.amountMsat, 0);
    assert.equal(sum, total, `Summe stimmt nicht bei ${total} msat`);
  }
});

test("Fee-Beweis: aufgeblaehter Worker-Anteil fliegt auf", () => {
  // Angriff: Provider behaelt mehr und kuerzt den Pool.
  const ev = proofEvent(100_000, (legs) => {
    legs[0].amountMsat += 2000; // worker
    legs[2].amountMsat -= 2000; // pool
  });
  const v = verifyFeeProofWithClient(ev);
  assert.equal(v.ok, false);
  assert.equal(v.amountsMatch, false);
  assert.equal(v.sumsMatch, true, "Summe stimmt — genau deshalb reicht Summenpruefung nicht");
  assert.match(v.summary, /fehlerhaft/);
});

test("Fee-Beweis: weggelassener Referral-Anteil faellt auf", () => {
  const ev = proofEvent(100_000, (legs) => {
    legs.splice(3, 1); // referral raus
  });
  const v = verifyFeeProofWithClient(ev);
  assert.equal(v.ok, false);
  assert.match(v.summary, /Unvollstaendig|Unvollständig|fehlen/);
});

test("Fee-Beweis: manipuliertes Event faellt an der Signatur auf", () => {
  const ev = proofEvent(100_000);
  const tampered = { ...ev, tags: ev.tags.map((t) => (t[0] === "leg" && t[1] === "client" ? ["leg", "client", "1", "angreifer@evil", "lightning", "", "", ""] : t)) };
  const v = verifyFeeProof(tampered as typeof ev);
  assert.equal(v.signatureValid, false);
  assert.equal(v.ok, false);
  assert.match(v.summary, /Signatur/);
});

test("Fee-Beweis: Preimage ohne Rechnung belegt nicht, an wen gezahlt wurde (4.8)", () => {
  // Bis 4.8 galt das als „belegt“ – ein Preimage passt aber zu jeder Zahlung
  // mit diesem Hash, auch zu einer an sich selbst.
  const preimage = "11".repeat(32);
  const hash = bytesToHex(sha256(Uint8Array.from(Buffer.from(preimage, "hex"))));

  const ev = proofEvent(100_000, (legs) => {
    legs.find((l) => l.leg === "client")!.paymentHash = hash;
    legs.find((l) => l.leg === "client")!.preimage = preimage;
  });
  const v = verifyFeeProofWithClient(ev);
  const dev = v.legs.find((l) => l.leg === "client")!;
  assert.equal(dev.status, "announced");
  assert.match(dev.detail, /nicht, an wen/);
});

/** Lightning-Leg mit Rechnung eines Knotens: Empfaenger als Knoten oder Adresse. */
function mitRechnung(opts: { empfaengerIstKnoten: boolean; fremderKnoten?: boolean; betragDaneben?: boolean; preimageDaneben?: boolean }) {
  const sk = secp256k1.utils.randomSecretKey();
  const knoten = bytesToHex(secp256k1.getPublicKey(opts.fremderKnoten ? secp256k1.utils.randomSecretKey() : sk, true));
  const pre = new Uint8Array(32).fill(9);
  return proofEvent(100_000, (legs) => {
    const l = legs.find((x) => x.leg === "pool")!;
    const msat = opts.betragDaneben ? l.amountMsat + 1000 : l.amountMsat;
    l.bolt11 = rechnung(sk, `lnbc${msat * 10}p`, pre);
    l.preimage = bytesToHex(opts.preimageDaneben ? new Uint8Array(32).fill(8) : pre);
    if (opts.empfaengerIstKnoten) l.recipient = knoten;
  });
}

test("Fee-Beweis (4.8) Lightning: richtiger Empfaengerknoten belegt, falscher ungueltig, Adresse nur angekuendigt", () => {
  const pool = (ev: ReturnType<typeof proofEvent>) => verifyFeeProofWithClient(ev).legs.find((l) => l.leg === "pool")!;
  const richtig = pool(mitRechnung({ empfaengerIstKnoten: true }));
  assert.equal(richtig.status, "settled");
  assert.match(richtig.detail, /angekündigten Knoten/);
  const falsch = pool(mitRechnung({ empfaengerIstKnoten: true, fremderKnoten: true }));
  assert.equal(falsch.status, "invalid");
  assert.match(falsch.detail, /nicht vom angekündigten Empfänger/);
  const adresse = pool(mitRechnung({ empfaengerIstKnoten: false }));
  assert.equal(adresse.status, "announced");
  assert.match(adresse.detail, /Verwahrdiensten/);
  assert.equal(pool(mitRechnung({ empfaengerIstKnoten: true, betragDaneben: true })).status, "invalid");
  assert.equal(pool(mitRechnung({ empfaengerIstKnoten: true, preimageDaneben: true })).status, "invalid");
  // Rechnung und Beleg sind signiert: bolt11 und Lamports kommen durch parse
  const ev = mitRechnung({ empfaengerIstKnoten: true });
  assert.ok(parseFeeProof(ev).legs.find((l) => l.leg === "pool")!.bolt11?.startsWith("lnbc"));
});

test("Fee-Beweis: falsches Preimage wird nicht durchgewunken", () => {
  const ev = proofEvent(100_000, (legs) => {
    legs.find((l) => l.leg === "client")!.paymentHash = "ab".repeat(32);
    legs.find((l) => l.leg === "client")!.preimage = "cd".repeat(32);
  });
  const v = verifyFeeProofWithClient(ev);
  assert.equal(v.legs.find((l) => l.leg === "client")!.status, "invalid");
  assert.equal(v.ok, false);
});

test("Fee-Beweis: Lightning ohne Preimage bleibt ehrlich 'nur angekuendigt'", () => {
  const v = verifyFeeProofWithClient(proofEvent(100_000));
  assert.ok(v.legs.every((l) => l.status === "announced"));
  assert.equal(v.ok, true, "korrekt gerechnet ist es trotzdem");
  assert.match(v.summary, /nur angekündigt|angekündigt/);
  // Die Grenze muss im Klartext stehen, nicht im Kleingedruckten.
  assert.match(v.legs[0].detail, /kein öffentliches Ledger/);
});

test("Fee-Beweis (4.8) Solana: belegt erst mit der Kette – richtiger Empfaenger ja, falscher nein", async () => {
  const AN = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
  const ev = proofEvent(100_000, (legs) => {
    const l = legs.find((x) => x.leg === "client")!;
    l.chain = "solana";
    l.recipient = AN;
    l.txSignature = "5xY".padEnd(88, "z");
    l.lamports = 16_667;
  });
  // Ohne Kette: nur angekuendigt (bis 4.8 hiess eine blosse Signatur „belegt“)
  assert.equal(verifyFeeProofWithClient(ev).legs.find((l) => l.leg === "client")!.status, "announced");
  const tx = (an: string, lamports: number) => ({ meta: { err: null }, transaction: { message: { instructions: [
    { program: "system", parsed: { type: "transfer", info: { source: "x", destination: an, lamports } } }] } } });
  const opts = { clientFeeMsat: clientFeeOf(100_000) };
  const client = async (lade: () => Promise<unknown>) => (await verifyFeeProofMitKette(ev, opts, lade)).legs.find((l) => l.leg === "client")!;
  assert.equal((await client(async () => tx(AN, 16_667))).status, "settled");
  const falsch = await verifyFeeProofMitKette(ev, opts, async () => tx("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", 16_667));
  assert.equal(falsch.legs.find((l) => l.leg === "client")!.status, "invalid");
  assert.equal(falsch.ok, false, "falscher Empfaenger macht den Beleg ungueltig");
  assert.equal((await client(async () => tx(AN, 100))).status, "invalid");
  assert.equal((await client(async () => null)).status, "announced", "Kette kennt die Signatur nicht");
  assert.match((await client(async () => { throw new TypeError("x"); })).detail, /nicht erreichbar \(TypeError\)/);
});

test("Fee-Beweis: fremde Treasury-Adresse wird erkannt", () => {
  const ev = proofEvent(100_000);
  const ok = verifyFeeProofWithClient(ev, { announcedTreasuryAddress: RECIPIENTS.dev });
  const bad = verifyFeeProofWithClient(ev, { announcedTreasuryAddress: "jemand@anderes.cash" });

  assert.equal(ok.treasuryMatches, true);
  assert.equal(ok.ok, true);
  assert.equal(bad.treasuryMatches, false);
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /andere Adresse/);
});

test("Fee-Beweis: ohne Announcement ist die Treasury 'nicht pruefbar', nicht 'falsch'", () => {
  const v = verifyFeeProofWithClient(proofEvent(100_000));
  assert.equal(v.treasuryMatches, null);
  assert.equal(v.ok, true, "nicht pruefbar darf nicht als Fehler gelten");
});

test("Fee-Beweis: Roundtrip build -> parse", () => {
  const ev = proofEvent(250_000);
  const p = parseFeeProof(ev);
  assert.equal(ev.kind, KIND_FEE_PROOF);
  assert.equal(p.totalMsat, 250_000);
  assert.equal(p.treasuryWeek, 2810);
  assert.equal(p.legs.length, 4);
  assert.equal(p.legs.find((l) => l.leg === "client")!.recipient, RECIPIENTS.dev);
});

test("preimageMatches: robust gegen Muell-Eingaben", () => {
  assert.equal(preimageMatches("nichthex", "auchnicht"), false);
  assert.equal(preimageMatches("", ""), false);
});

test("Fee-Beweis: falscher Kind wird abgelehnt", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 1, [], "kein beweis"), kp.sk);
  assert.throws(() => parseFeeProof(ev), /kein fee-proof/);
});
