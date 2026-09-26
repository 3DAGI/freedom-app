/**
 * Schritt 4.6e: Relayer-Dienst im Knoten. Er zahlt mit echtem SOL die
 * Gebuehr – geprueft wird, dass er nur gueltige Einloesungen mitsigniert,
 * sich an seine Grenze haelt und kein Preimage ins Log schreibt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  OutboxPool, MemoryRelay, LocalSigner, generateKeypair, HTLC_PROGRAMM_ID, KIND_RELAYER_ANGEBOT,
  buildRelayAuftrag, oeffneRelayAntwort, parseRelayerAngebot, giftWrapMitSigner,
} from "@freedomstack/protocol";
import { RelayerDienst } from "../src/relayer-dienst.js";

const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const PREIMAGE = Buffer.alloc(32, 0x5a);

function aufbau(o: { max?: number; senden?: (roh: Uint8Array) => Promise<string> } = {}) {
  const pool = new OutboxPool([new MemoryRelay("mem://relayer")], { minAcks: 1 });
  const knoten = new LocalSigner(generateKeypair().sk);
  const sol = Keypair.generate();
  const gesendet: Uint8Array[] = [];
  const dienst = new RelayerDienst(
    { signer: knoten, solKeypair: sol, programmId: HTLC_PROGRAMM_ID, erstattungLamports: 10_000, kette: "solana:devnet", maxProStunde: o.max ?? 5 },
    pool, o.senden ?? (async (roh) => { gesendet.push(roh); return "5".repeat(88); }),
  );
  return { pool, knoten, sol, dienst, gesendet };
}

/** Kunde: Einloesung + Erstattung, als Empfaenger signiert, Relayer als Gebuehrenzahler. */
function einloesung(relayerSol: PublicKey, kunde: Keypair, erstattung = 10_000): Uint8Array {
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: new PublicKey(HTLC_PROGRAMM_ID),
      keys: [
        { pubkey: kunde.publicKey, isSigner: true, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([createHash("sha256").update("global:claim").digest().subarray(0, 8), PREIMAGE]),
    }),
    SystemProgram.transfer({ fromPubkey: kunde.publicKey, toPubkey: relayerSol, lamports: erstattung }),
  );
  tx.feePayer = relayerSol;
  tx.recentBlockhash = BLOCKHASH;
  tx.partialSign(kunde);
  return tx.serialize({ requireAllSignatures: false });
}

async function sende(a: ReturnType<typeof aufbau>, roh: Uint8Array) {
  const kunde = new LocalSigner(generateKeypair().sk);
  const { wrap, auftragId } = await buildRelayAuftrag({ tx: roh, kunde, relayerPk: a.knoten.publicKey() });
  await a.pool.publish(wrap);
  return { kunde, auftragId };
}

async function antwort(a: ReturnType<typeof aufbau>, k: { kunde: LocalSigner; auftragId: string }) {
  for (const w of await a.pool.query({ kinds: [1059], "#p": [k.kunde.publicKey()] })) {
    const r = await oeffneRelayAntwort(w, k.kunde, { relayerPk: a.knoten.publicKey(), auftragId: k.auftragId });
    if (r) return r;
  }
  return undefined;
}

test("Gueltige Einloesung: mitsigniert, gesendet, Kunde bekommt die Signatur versiegelt", async () => {
  const a = aufbau();
  const k = await sende(a, einloesung(a.sol.publicKey, Keypair.generate()));
  assert.deepEqual(await a.dienst.pollOnce(), [{ status: "GESENDET" }]);
  assert.equal(a.gesendet.length, 1);
  const tx = Transaction.from(a.gesendet[0]);
  assert.equal(tx.verifySignatures(), true, "Kunde und Relayer haben signiert");
  assert.equal(tx.feePayer?.toBase58(), a.sol.publicKey.toBase58());
  assert.deepEqual(await antwort(a, k), { status: "GESENDET", signatur: "5".repeat(88), grund: "" });
  assert.deepEqual(await a.dienst.pollOnce(), [], "derselbe Auftrag nur einmal");
});

test("Ungueltiger Auftrag: nichts gesendet, Kunde erfaehrt den Grund", async () => {
  const a = aufbau();
  const k = await sende(a, einloesung(a.sol.publicKey, Keypair.generate(), 9_999));
  const [r] = await a.dienst.pollOnce();
  assert.equal(r.status, "ABGELEHNT");
  assert.equal(a.gesendet.length, 0);
  assert.match((await antwort(a, k))!.grund, /unter 10000/);
});

test("Grenze je Stunde schuetzt das Guthaben", async () => {
  const a = aufbau({ max: 1 });
  await sende(a, einloesung(a.sol.publicKey, Keypair.generate()));
  await sende(a, einloesung(a.sol.publicKey, Keypair.generate()));
  const r = await a.dienst.pollOnce();
  assert.deepEqual(r.map((x) => x.status).sort(), ["ABGELEHNT", "GESENDET"]);
  assert.equal(a.gesendet.length, 1);
});

test("Kette lehnt ab: nur der Fehlername ins Log, nie die Transaktion mit dem Preimage", async () => {
  const log: string[] = [];
  const orig = console.error;
  console.error = (...x: unknown[]) => { log.push(x.map(String).join(" ")); };
  try {
    const a = aufbau({ senden: async (roh) => { throw new Error(`Simulation failed: ${Buffer.from(roh).toString("base64")}`); } });
    const k = await sende(a, einloesung(a.sol.publicKey, Keypair.generate()));
    assert.deepEqual(await a.dienst.pollOnce(), [{ status: "ABGELEHNT", grund: "Einlösung von der Kette abgelehnt (Vorabsimulation)" }]);
    assert.equal((await antwort(a, k))!.status, "ABGELEHNT");
  } finally {
    console.error = orig;
  }
  assert.equal(log.length, 1);
  assert.ok(!log[0].includes(PREIMAGE.toString("base64").slice(0, 20)) && !log[0].includes("Simulation failed"), log[0]);
});

test("Andere Umschlaege an den Knoten laesst der Relayer liegen", async () => {
  const a = aufbau();
  const fremd = new LocalSigner(generateKeypair().sk);
  await a.pool.publish(await giftWrapMitSigner({ pubkey: fremd.publicKey(), kind: 14, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hallo" }, fremd, a.knoten.publicKey()));
  assert.deepEqual(await a.dienst.pollOnce(), []);
});

test("Angebot: SOL-Konto, Erstattung, Kette", async () => {
  const a = aufbau();
  await a.dienst.veroeffentlicheAngebot();
  const [ev] = await a.pool.query({ kinds: [KIND_RELAYER_ANGEBOT] });
  assert.deepEqual(parseRelayerAngebot(ev), { solAdresse: a.sol.publicKey.toBase58(), erstattungLamports: 10_000, kette: "solana:devnet" });
});

test("Verdrahtung (4.6e): main.ts startet den Relayer mit Vorabsimulation und fragt ihn in der Schleife", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /process\.env\.RELAYER_ENABLED === "1"/);
  assert.match(main, /sendRawTransaction\(roh, \{ skipPreflight: false, preflightCommitment: "confirmed" \}\)/);
  assert.match(main, /await relayer\.veroeffentlicheAngebot\(\)/);
  assert.match(main, /for \(const r of await relayer\.pollOnce\(\)\)/);
});
