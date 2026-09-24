/**
 * Einloesen nur mit Sicherheitsabstand vor dem Fristende (Schritt 0.C).
 *
 * Seit das HTLC-Programm Einloesungen nach Ablauf ablehnt, darf die App nicht
 * mehr knapp vor Fristende einloesen: Eine abgelehnte Transaktion, die in einen
 * Block gelangt, legt das Preimage trotzdem offen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_SAFETY_MARGIN_SECS,
  claimAllowed,
  claimSwap,
  describeHtlcError,
  nextStep,
} from "../src/swap-client.js";

const NOW = 1_800_000_000;

test("einloesen erlaubt, solange mehr als der Sicherheitsabstand bleibt", () => {
  assert.equal(claimAllowed(NOW + CLAIM_SAFETY_MARGIN_SECS + 1, NOW).ok, true);
  assert.equal(claimAllowed(NOW + 3600, NOW).ok, true);
});

test("einloesen verboten innerhalb des Sicherheitsabstands und nach Ablauf", () => {
  for (const rest of [CLAIM_SAFETY_MARGIN_SECS, 300, 1, 0, -60]) {
    const r = claimAllowed(NOW + rest, NOW);
    assert.equal(r.ok, false, `rest=${rest}`);
    assert.match(r.reason ?? "", /Lightning-Zahlung läuft von selbst zurück/);
  }
});

test("ohne bekannte Frist wird nicht eingeloest", () => {
  assert.equal(claimAllowed(0, NOW).ok, false);
  assert.equal(claimAllowed(Number.NaN, NOW).ok, false);
});

test("claimSwap bricht vor jeder Netzwerkaktion ab, wenn es zu knapp ist", async () => {
  const falle = new Proxy({}, { get() { throw new Error("darf nicht aufgerufen werden"); } });
  await assert.rejects(
    claimSwap({
      connection: falle as never,
      wallet: falle as never,
      swapId: "00".repeat(32),
      preimage: new Uint8Array(32),
      initiator: "11111111111111111111111111111111",
      timelockUnix: Math.floor(Date.now() / 1000) + 120,
    }),
    /zu knapp/,
  );
});

test("Programmfehler werden verstaendlich uebersetzt", () => {
  assert.match(describeHtlcError({ InstructionError: [0, { Custom: 6007 }] }) ?? "", /Frist abgelaufen/);
  assert.match(describeHtlcError(new Error("custom program error: 0x1777")) ?? "", /Frist abgelaufen/);
  assert.match(describeHtlcError({ InstructionError: [0, { Custom: 6003 }] }) ?? "", /Preimage/);
  assert.equal(describeHtlcError({ InstructionError: [0, { Custom: 1 }] }), undefined);
  assert.equal(describeHtlcError("irgendwas"), undefined);
});

test("nextStep warnt rechtzeitig und raet knapp vor Ablauf vom Einloesen ab", () => {
  const zustand = (rest: number) => ({ phase: "bezahlt", solTimelockUnix: NOW + rest, message: "" }) as never;
  assert.match(nextStep(zustand(300), NOW), /zu knapp/);
  assert.match(nextStep(zustand(CLAIM_SAFETY_MARGIN_SECS + 300), NOW), /Jetzt einlösen/);
  assert.match(nextStep(zustand(7200), NOW), /Jetzt die SOL einlösen/);
});
