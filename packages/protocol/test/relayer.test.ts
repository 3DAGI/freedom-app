/**
 * Schritt 4.6e: Relayer fuer Einloesungen ohne eigenes SOL. Der Relayer
 * signiert als Gebuehrenzahler mit – geprueft wird vor allem, wann er es NICHT
 * darf: Jede andere Transaktion koennte sein Guthaben anders verwenden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  KIND_RELAYER_ANGEBOT, MIETE_LEERES_KONTO, buildRelayAntwort, buildRelayAuftrag, buildRelayerAngebot, mieteReicht,
  oeffneRelayAntwort, oeffneRelayAuftrag, parseRelayerAngebot, pruefeRelayAuftrag,
} from "../src/relayer.js";
import { HTLC_PROGRAMM_ID } from "../src/solana-adapter.js";
import { LocalSigner } from "../src/signer.js";
import { generateKeypair } from "../src/event.js";

const PROGRAMM = new PublicKey(HTLC_PROGRAMM_ID);
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const [kunde, relayer, lp, fremd] = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
const erwartet = { relayer: relayer.publicKey.toBase58(), programmId: HTLC_PROGRAMM_ID, erstattungMin: 10_000 };

function einloesung(empfaenger = kunde.publicKey, disc = "claim") {
  return new TransactionInstruction({
    programId: PROGRAMM,
    keys: [
      { pubkey: empfaenger, isSigner: true, isWritable: true },
      { pubkey: lp.publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([createHash("sha256").update(`global:${disc}`).digest().subarray(0, 8), Buffer.alloc(32, 7)]),
  });
}
const erstattung = (lamports = 10_000, an = relayer.publicKey, von = kunde.publicKey) => SystemProgram.transfer({ fromPubkey: von, toPubkey: an, lamports });

function auftrag(o: { ixs?: TransactionInstruction[]; zahler?: PublicKey; signierer?: Keypair[]; nachher?: (tx: Transaction) => void } = {}): Uint8Array {
  const tx = new Transaction().add(...(o.ixs ?? [einloesung(), erstattung()]));
  tx.feePayer = o.zahler ?? relayer.publicKey;
  tx.recentBlockhash = BLOCKHASH;
  for (const k of o.signierer ?? [kunde]) tx.partialSign(k);
  o.nachher?.(tx);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}

test("Gueltiger Auftrag: Einloesung, dann Erstattung an den Relayer, Kunde hat signiert", () => {
  assert.deepEqual(pruefeRelayAuftrag(auftrag(), erwartet), { ok: true, empfaenger: kunde.publicKey.toBase58(), erstattung: 10_000 });
});

test("Pruefung laeuft auch ohne BigInt-Methoden des Buffers (wie im Browser, wo die App sich selbst prueft)", () => {
  const proto = Buffer.prototype as unknown as Record<string, unknown>;
  const weg = ["readBigUInt64LE", "readBigInt64LE", "readBigUint64LE"].map((n) => [n, proto[n]] as const);
  for (const [n] of weg) delete proto[n];
  try {
    assert.deepEqual(pruefeRelayAuftrag(auftrag(), erwartet), { ok: true, empfaenger: kunde.publicKey.toBase58(), erstattung: 10_000 });
  } finally {
    for (const [n, f] of weg) if (f) proto[n] = f;
  }
});

test("Relayer signiert NICHT mit, wenn …", () => {
  const faelle: Array<[RegExp, Uint8Array]> = [
    [/keine lesbare/, new Uint8Array([1, 2, 3])],
    [/nicht Gebuehrenzahler/, auftrag({ zahler: kunde.publicKey })],
    [/sonst nichts/, auftrag({ ixs: [einloesung(), erstattung(), erstattung(5_000_000, fremd.publicKey)] })],
    [/sonst nichts/, auftrag({ ixs: [einloesung()] })],
    [/keine Einloesung beim HTLC/, auftrag({ ixs: [erstattung(), erstattung()] })],
    [/keine Einloesung/, auftrag({ ixs: [einloesung(kunde.publicKey, "refund"), erstattung()] })],
    [/Relayer-Konto in der Einloesung/, auftrag({ ixs: [einloesung(relayer.publicKey), erstattung(10_000, relayer.publicKey, relayer.publicKey)], signierer: [] })],
    [/nicht vom Empfaenger an den Relayer/, auftrag({ ixs: [einloesung(), erstattung(10_000, fremd.publicKey)] })],
    [/unter 10000/, auftrag({ ixs: [einloesung(), erstattung(9_999)] })],
    [/nicht signiert/, auftrag({ signierer: [] })],
    // Nach dem Signieren veraendert (Betrag der Erstattung): Signatur passt nicht mehr
    [/ungueltig/, auftrag({ nachher: (tx) => { tx.instructions[1].data.writeBigUInt64LE(20_000n, 4); } })],
  ];
  for (const [grund, roh] of faelle) {
    const r = pruefeRelayAuftrag(roh, erwartet);
    assert.equal(r.ok, false, String(grund));
    assert.match((r as { grund: string }).grund, grund);
  }
});

test("Angebot: SOL-Konto, Erstattung, Kette – sonst ungueltig", () => {
  const a = { solAdresse: relayer.publicKey.toBase58(), erstattungLamports: 10_000, kette: "solana:devnet" };
  const ev = buildRelayerAngebot(a, "aa".repeat(32), 1_790_000_000);
  assert.equal(ev.kind, KIND_RELAYER_ANGEBOT);
  assert.deepEqual(parseRelayerAngebot(ev), a);
  for (const [tag, wert, grund] of [["sol_address", "<x>", /sol_address/], ["erstattung_lamports", "-1", /erstattung/], ["kette", "ethereum", /kette/]] as const) {
    const kaputt = { ...ev, tags: ev.tags.map((t) => (t[0] === tag ? [tag, wert] : t)) };
    assert.throws(() => parseRelayerAngebot(kaputt), grund);
  }
});

test("Auftrag und Antwort versiegelt: nur der Relayer oeffnet, nur seine Antwort zum eigenen Auftrag zaehlt", async () => {
  const k = new LocalSigner(generateKeypair().sk);
  const r = new LocalSigner(generateKeypair().sk);
  const f = new LocalSigner(generateKeypair().sk);
  const roh = auftrag();
  const { wrap, auftragId } = await buildRelayAuftrag({ tx: roh, kunde: k, relayerPk: r.publicKey() });
  assert.equal(wrap.kind, 1059);
  assert.ok(!wrap.content.includes(Buffer.from(roh).toString("base64").slice(0, 40)), "die Transaktion (mit Preimage) steht nicht offen im Umschlag");
  assert.equal(await oeffneRelayAuftrag(wrap, f), null, "ein Fremder kann nicht oeffnen");
  const o = await oeffneRelayAuftrag(wrap, r);
  assert.deepEqual(o && { ...o, tx: Buffer.from(o.tx).toString("hex") }, { kunde: k.publicKey(), auftragId, tx: Buffer.from(roh).toString("hex") });

  const sig = "5".repeat(88);
  const antwort = await buildRelayAntwort({ relayer: r, kundePk: k.publicKey(), auftragId, status: "GESENDET", signatur: sig });
  assert.deepEqual(await oeffneRelayAntwort(antwort, k, { relayerPk: r.publicKey(), auftragId }), { status: "GESENDET", signatur: sig, grund: "" });
  assert.equal(await oeffneRelayAntwort(antwort, k, { relayerPk: f.publicKey(), auftragId }), null, "von einem anderen Relayer");
  assert.equal(await oeffneRelayAntwort(antwort, k, { relayerPk: r.publicKey(), auftragId: "00".repeat(32) }), null, "zu einem anderen Auftrag");
  const falsch = await buildRelayAntwort({ relayer: f, kundePk: k.publicKey(), auftragId, status: "GESENDET", signatur: sig });
  assert.equal(await oeffneRelayAntwort(falsch, k, { relayerPk: r.publicKey(), auftragId }), null, "ein Fremder gibt sich als Relayer aus");
});

test("Mindestmiete: ein neues Konto muss nach Einloesung und Erstattung mindestens die Miete halten", () => {
  assert.equal(mieteReicht({ guthabenVorher: 0, eingeloest: 1_000_000, erstattung: 10_000 }), true);
  assert.equal(mieteReicht({ guthabenVorher: 0, eingeloest: MIETE_LEERES_KONTO + 9_999, erstattung: 10_000 }), false);
  assert.equal(mieteReicht({ guthabenVorher: 2_000_000, eingeloest: 50_000, erstattung: 10_000 }), true, "bestehendes Konto");
});
