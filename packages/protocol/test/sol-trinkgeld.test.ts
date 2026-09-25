/**
 * Schritt 4.7: SOL-Trinkgeld-Beleg – Event, privat versiegelt, Pruefung
 * gegen die Kette (gefaelschte Signatur, falscher Betrag, falscher Empfaenger).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, LocalSigner, KIND_GIFT_WRAP, RpcPool } from "../src/index.js";
import { KIND_SOL_TRINKGELD } from "../src/kinds.js";
import {
  buildPrivateSolTrinkgeld, buildSolTrinkgeld, oeffnePrivatesSolTrinkgeld, parseSolTrinkgeld, pruefeSolUeberweisung, type SolTrinkgeld,
} from "../src/sol-trinkgeld.js";

const AN = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const VON = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SIG = "5".repeat(88);
const JETZT = 1_790_000_000;

function beleg(empfaenger: string, extra: Partial<SolTrinkgeld> = {}): SolTrinkgeld {
  return { empfaenger, signatur: SIG, lamports: 2_000_000, an: AN, kette: "solana:devnet", ...extra };
}

/** Antwort von getTransaction (jsonParsed) mit System-Ueberweisungen. */
function tx(ueberweisungen: Array<{ von?: string; an: string; lamports: number }>, err: unknown = null) {
  return {
    meta: { err },
    transaction: { message: { instructions: ueberweisungen.map((u) => ({
      program: "system", programId: "11111111111111111111111111111111",
      parsed: { type: "transfer", info: { source: u.von ?? VON, destination: u.an, lamports: u.lamports } },
    })) } },
  };
}

test("Beleg: Tags hin und zurueck; unpassende Angaben werden abgelehnt", () => {
  const ich = generateKeypair(), du = generateKeypair();
  const bezug = "ab".repeat(32);
  const ev = buildSolTrinkgeld(ich.pk, beleg(du.pk, { bezug, notiz: "Danke!" }), JETZT);
  assert.equal(ev.kind, KIND_SOL_TRINKGELD);
  assert.deepEqual(parseSolTrinkgeld(ev), { ...beleg(du.pk, { bezug, notiz: "Danke!" }), absender: ich.pk });
  for (const [falsch, fehler] of [
    [{ signatur: "x" }, /Transaktionssignatur/], [{ lamports: 0 }, /positive ganze Zahl/], [{ lamports: 1.5 }, /positive ganze Zahl/],
    [{ an: "kaputt" }, /SOL-Adresse/], [{ kette: "solana:erfunden" }, /Kette/], [{ bezug: "123" }, /Event-ID/],
    [{ notiz: "x".repeat(281) }, /280/], [{ empfaenger: "abc" }, /Pubkey/],
  ] as const) {
    assert.throws(() => buildSolTrinkgeld(ich.pk, beleg(du.pk, falsch as Partial<SolTrinkgeld>)), fehler);
  }
  // Manipuliertes Event: Betrag in Exponentschreibweise, fehlende Signatur
  const m = buildSolTrinkgeld(ich.pk, beleg(du.pk), JETZT);
  m.tags = m.tags.map((t) => (t[0] === "lamports" ? ["lamports", "2e6"] : t));
  assert.throws(() => parseSolTrinkgeld(m), /positive ganze Zahl/);
  const ohne = buildSolTrinkgeld(ich.pk, beleg(du.pk), JETZT);
  ohne.tags = ohne.tags.filter((t) => t[0] !== "sol_tx");
  assert.throws(() => parseSolTrinkgeld(ohne), /Transaktionssignatur/);
});

test("Privat: auf den Relays nur Umschlaege; Empfaenger und Absender oeffnen, Dritte nicht", async () => {
  const ich = new LocalSigner(generateKeypair().sk), du = new LocalSigner(generateKeypair().sk), dritter = new LocalSigner(generateKeypair().sk);
  const wraps = await buildPrivateSolTrinkgeld(beleg(du.publicKey(), { notiz: "für die Antwort" }), ich, JETZT);
  assert.equal(wraps.length, 2, "Empfaenger und eigene Kopie");
  for (const w of wraps) {
    assert.equal(w.kind, KIND_GIFT_WRAP);
    assert.ok(!JSON.stringify(w).includes(SIG) && !JSON.stringify(w).includes(AN), "Signatur und Adresse nur im Umschlag");
    assert.notEqual(w.pubkey, ich.publicKey());
  }
  const beimEmpfaenger = await oeffnePrivatesSolTrinkgeld(wraps.find((w) => w.tags.some((t) => t[1] === du.publicKey()))!, du);
  assert.equal(beimEmpfaenger?.absender, ich.publicKey());
  assert.equal(beimEmpfaenger?.lamports, 2_000_000);
  assert.equal(beimEmpfaenger?.notiz, "für die Antwort");
  assert.ok(await oeffnePrivatesSolTrinkgeld(wraps.find((w) => w.tags.some((t) => t[1] === ich.publicKey()))!, ich));
  assert.equal(await oeffnePrivatesSolTrinkgeld(wraps[0], dritter), null);
});

test("Kette: belegt nur mit Empfaenger und Betrag; gefaelschte Signatur und falscher Betrag fallen auf", () => {
  const erwartet = { an: AN, lamports: 2_000_000 };
  assert.deepEqual(pruefeSolUeberweisung(tx([{ an: AN, lamports: 2_000_000 }]), erwartet), { status: "belegt" });
  assert.deepEqual(pruefeSolUeberweisung(tx([{ an: AN, lamports: 1_500_000 }, { an: AN, lamports: 500_000 }]), erwartet), { status: "belegt" }, "zwei Teile");
  // Gefaelschte Signatur: Die Kette kennt die Transaktion nicht
  assert.equal(pruefeSolUeberweisung(null, erwartet).status, "unbestaetigt");
  // Falscher Betrag, falscher Empfaenger, gescheiterte Transaktion, fremder Absender
  assert.deepEqual(pruefeSolUeberweisung(tx([{ an: AN, lamports: 1_999_999 }]), erwartet), { status: "falsch", grund: "nur 1999999 statt 2000000 Lamports" });
  assert.equal(pruefeSolUeberweisung(tx([{ an: VON, lamports: 2_000_000 }]), erwartet).status, "falsch");
  assert.deepEqual(pruefeSolUeberweisung(tx([{ an: AN, lamports: 2_000_000 }], { InstructionError: [0, "Custom"] }), erwartet), { status: "falsch", grund: "Transaktion ist gescheitert" });
  assert.equal(pruefeSolUeberweisung(tx([{ an: AN, lamports: 2_000_000, von: AN }]), { ...erwartet, von: VON }).status, "falsch");
  // Andere Programme zaehlen nicht
  const fremd = tx([{ an: AN, lamports: 2_000_000 }]);
  (fremd.transaction.message.instructions[0] as { program: string }).program = "spl-token";
  assert.equal(pruefeSolUeberweisung(fremd, erwartet).status, "falsch");
});

test("RpcPool.getTransaction fragt jsonParsed mit Version 0 ab", async () => {
  const anfragen: unknown[] = [];
  const pool = new RpcPool([{ url: "https://a.example" }], {
    fetchImpl: (async (_u: string, init: { body: string }) => {
      anfragen.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
    }) as unknown as typeof fetch,
  });
  assert.equal(await pool.getTransaction(SIG), null);
  assert.deepEqual(anfragen[0], { jsonrpc: "2.0", id: 1, method: "getTransaction", params: [SIG, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] });
});
