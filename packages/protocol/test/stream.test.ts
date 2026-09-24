/**
 * Streaming-Sats Tests: Session-Open, Zahlungs-Belege, Ledger-Pruefung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  OutboxPool,
  MemoryRelay,
  buildSessionOpen,
  parseSessionOpen,
  buildSessionPayment,
  parseSessionPayment,
  checkSessionLedger,
  amountDue,
  KIND_SESSION_OPEN,
  KIND_SESSION_PAYMENT,
} from "../src/index.js";

function makeSession(customer: ReturnType<typeof generateKeypair>, provider: ReturnType<typeof generateKeypair>) {
  const now = Math.floor(Date.now() / 1000);
  return {
    params: {
      customerPubkey: customer.pk,
      providerPubkey: provider.pk,
      sessionId: "sess-test-1",
      maxTotalMsat: 100_000,
      maxRatePerKTokenMsat: 1000,
      settleEveryMsat: 10_000,
      ttlSecs: 3600,
    },
    now,
  };
}

test("Session-Open: bauen, signieren, parsen (Roundtrip)", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const { params, now } = makeSession(customer, provider);
  const ev = signEvent(buildSessionOpen(params, now), customer.sk);
  const parsed = parseSessionOpen(ev);
  assert.equal(parsed.sessionId, "sess-test-1");
  assert.equal(parsed.maxTotalMsat, 100_000);
  assert.equal(parsed.settleEveryMsat, 10_000);
  assert.equal(parsed.expiration, now + 3600);
  assert.equal(parsed.customerPubkey, customer.pk);
  assert.equal(parsed.providerPubkey, provider.pk);
});

test("Zahlungs-Belege: seq, kumulierter Betrag, Referenzen", () => {
  const customer = generateKeypair();
  const ev = signEvent(
    buildSessionPayment({
      customerPubkey: customer.pk,
      sessionId: "sess-test-1",
      seq: 3,
      cumulativeMsat: 27_000,
      unitsSinceLast: 9000,
      refEventId: "abc123",
      paymentRef: "payhash456",
    }),
    customer.sk,
  );
  const p = parseSessionPayment(ev);
  assert.equal(p.seq, 3);
  assert.equal(p.cumulativeMsat, 27_000);
  assert.equal(p.unitsSinceLast, 9000);
  assert.equal(p.refEventId, "abc123");
  assert.equal(p.paymentRef, "payhash456");
});

test("Ledger: gesunde Session ist ok, Summen stimmen", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const { params, now } = makeSession(customer, provider);
  const open = parseSessionOpen(buildSessionOpen(params, now));
  const payments = [1, 2, 3].map((seq) =>
    parseSessionPayment(
      buildSessionPayment({
        customerPubkey: customer.pk,
        sessionId: open.sessionId,
        seq,
        cumulativeMsat: seq * 10_000,
        unitsSinceLast: 10_000,
      }),
    ),
  );
  const check = checkSessionLedger({ open, payments }, now);
  assert.ok(check.ok, check.problems.join(", "));
  assert.equal(check.totalPaidMsat, 30_000);
  // Faelliges Delta des letzten Belegs
  assert.equal(amountDue(payments), 10_000);
});

test("Ledger: seq-Luecke wird erkannt (Betrugsverdacht)", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const { params, now } = makeSession(customer, provider);
  const open = parseSessionOpen(buildSessionOpen(params, now));
  const payments = [1, 3].map((seq) =>
    parseSessionPayment(
      buildSessionPayment({
        customerPubkey: customer.pk,
        sessionId: open.sessionId,
        seq,
        cumulativeMsat: seq * 10_000,
        unitsSinceLast: 10_000,
      }),
    ),
  );
  const check = checkSessionLedger({ open, payments }, now);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("Luecke")));
});

test("Ledger: Budget-Ueberschreitung und Ablauf werden erkannt", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const { params, now } = makeSession(customer, provider);
  const open = parseSessionOpen(buildSessionOpen(params, now));
  const payments = [
    parseSessionPayment(
      buildSessionPayment({
        customerPubkey: customer.pk,
        sessionId: open.sessionId,
        seq: 1,
        cumulativeMsat: 200_000, // > maxTotalMsat
        unitsSinceLast: 200_000,
      }),
    ),
  ];
  const over = checkSessionLedger({ open, payments }, now);
  assert.equal(over.ok, false);
  assert.ok(over.problems.some((p) => p.includes("Budget")));

  const expired = checkSessionLedger({ open, payments: [] }, now + 7200);
  assert.equal(expired.ok, false);
  assert.ok(expired.problems.some((p) => p.includes("abgelaufen")));
});

test("Ledger: Beleg von fremdem Kunden wird erkannt", () => {
  const customer = generateKeypair();
  const stranger = generateKeypair();
  const provider = generateKeypair();
  const { params, now } = makeSession(customer, provider);
  const open = parseSessionOpen(buildSessionOpen(params, now));
  const payments = [
    parseSessionPayment(
      buildSessionPayment({
        customerPubkey: stranger.pk, // falscher Autor
        sessionId: open.sessionId,
        seq: 1,
        cumulativeMsat: 5000,
        unitsSinceLast: 5000,
      }),
    ),
  ];
  const check = checkSessionLedger({ open, payments }, now);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("fremdem Kunden")));
});

test("Session-Flow ueber Relay: Open publizieren, Provider liest, Belege fliessen", async () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://stream")], { minAcks: 1 });
  const { params, now } = makeSession(customer, provider);

  // Kunde eroeffnet Session
  await pool.publish(signEvent(buildSessionOpen(params, now), customer.sk));

  // Provider sieht offene Sessions fuer sich
  const opens = await pool.query({ kinds: [KIND_SESSION_OPEN], "#p": [provider.pk] });
  assert.equal(opens.length, 1);
  const session = parseSessionOpen(opens[0]);
  assert.equal(session.sessionId, "sess-test-1");

  // Kunde streamt Belege (3 Antworten je 5000 msat)
  for (let seq = 1; seq <= 3; seq++) {
    await pool.publish(
      signEvent(
        buildSessionPayment({
          customerPubkey: customer.pk,
          sessionId: session.sessionId,
          seq,
          cumulativeMsat: seq * 5000,
          unitsSinceLast: 5000,
          paymentRef: `ph-${seq}`,
        }),
        customer.sk,
      ),
    );
  }

  // Provider prueft Buchhaltung vom Relay
  const belege = await pool.query({ kinds: [KIND_SESSION_PAYMENT] });
  const check = checkSessionLedger({
    open: session,
    payments: belege.map(parseSessionPayment),
  }, now);
  assert.ok(check.ok, check.problems.join(", "));
  assert.equal(check.totalPaidMsat, 15_000);
});
