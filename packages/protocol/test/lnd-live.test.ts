/**
 * LIVE-Integrationstest: Atomic Swap Lightning <-> Solana mit echtem LND.
 *
 * Setup (extern, siehe scripts/): Regtest bitcoind + zwei LND-Nodes
 * (LP auf :18080, User auf :28080) mit bestaetigtem Channel.
 *
 * Was der Test beweist:
 *   1. createHoldInvoice auf der LP-Node erzeugt eine echte BOLT11-Invoice
 *   2. User zahlt sie -> Zustand ACCEPTED (in flight, nicht abgerechnet)
 *   3. Solana-Seite (Mock): claim legt Preimage offen
 *   4. settleHoldInvoice mit der Preimage -> LP hat die sats (SETTLED)
 *   5. Refund-Pfad: cancelHoldInvoice -> User bekommt sats zurueck (CANCELED)
 *
 * Wird uebersprungen, wenn LND nicht laeuft (CI ohne Regtest-Setup).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LndLightningAdapter,
  MockSolana,
  runSwap,
  generatePreimage,
  hashlock,
} from "../src/index.js";

const LP_REST = process.env.LND_LP_REST ?? "https://127.0.0.1:18080";
const USER_REST = process.env.LND_USER_REST ?? "https://127.0.0.1:28080";
const LP_MAC_PATH =
  process.env.LND_LP_MAC ??
  `${process.env.HOME}/lightning/lnd-data/chain/bitcoin/regtest/admin.macaroon`;
const USER_MAC_PATH =
  process.env.LND_USER_MAC ??
  `${process.env.HOME}/lightning/lnd-user-data/chain/bitcoin/regtest/admin.macaroon`;

async function lndAlive(restUrl: string, macPath: string): Promise<boolean> {
  try {
    const mac = (await readFile(macPath)).toString("hex");
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const res = await fetch(`${restUrl}/v1/getinfo`, {
      headers: { "Grpc-Metadata-macaroon": mac },
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

test("LIVE: Atomic Swap mit echtem LND (Hold-Invoice settle)", async (t) => {
  if (!(await lndAlive(LP_REST, LP_MAC_PATH)) || !(await lndAlive(USER_REST, USER_MAC_PATH))) {
    t.skip("LND-Regtest laeuft nicht (LP :18080 / User :28080)");
    return;
  }

  const lpMac = (await readFile(LP_MAC_PATH)).toString("hex");
  const userMac = (await readFile(USER_MAC_PATH)).toString("hex");

  // LP-Seite: erstellt Hold-Invoices, settlet/cancelt
  const lpSide = new LndLightningAdapter({
    restUrl: LP_REST,
    macaroonHex: lpMac,
    allowInsecureTls: true,
  });
  // User-Seite: zahlt die Invoice
  const userSide = new LndLightningAdapter({
    restUrl: USER_REST,
    macaroonHex: userMac,
    allowInsecureTls: true,
  });

  // Kombinierter Adapter: LP-Operationen + User-Pay (in Produktion zwei Nodes).
  // Race-Condition: Nach payHoldInvoice ist die Invoice erst nach kurzer Zeit
  // ACCEPTED — settle/cancel duerfen erst dann laufen. Deshalb waitForState
  // als Uebergangswaerter dazwischen.
  const ln = {
    createHoldInvoice: (h: Uint8Array, s: number, c: number) =>
      lpSide.createHoldInvoice(h, s, c),
    payHoldInvoice: async (b: string) => {
      await userSide.payHoldInvoice(b);
    },
    getInvoiceState: (h: Uint8Array) => lpSide.getInvoiceState(h),
    settleHoldInvoice: (p: Uint8Array) => lpSide.settleHoldInvoice(p),
    cancelHoldInvoice: (h: Uint8Array) => lpSide.cancelHoldInvoice(h),
  };

  const sol = new MockSolana(1_000_000_000);

  // Vor dem Swap: Payment-State-Übergang im runSwap-Flow beachten.
  // Wir patchen settle, sodass es auf ACCEPTED wartet (Produktion: LP pollt sowieso).
  const origSettle = ln.settleHoldInvoice;
  ln.settleHoldInvoice = async (p: Uint8Array) => {
    const H = hashlock(p);
    for (let i = 0; i < 50; i++) {
      const st = await lpSide.getInvoiceState(H);
      if (st === "ACCEPTED") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return origSettle(p);
  };

  // ---- Happy Path: kompletter Swap mit echtem Lightning ----
  const result = await runSwap(ln, sol, {
    swapId: "live-swap-1",
    amountSats: 10_000,
    amountLamports: 50_000_000,
    userSolanaAddress: "user-sol-addr",
    lpSolanaAddress: "lp-sol-addr",
    tSolSecs: 600,
    lnCltvDeltaBlocks: 40,
  });

  for (const line of result.log) console.log("  ", line);
  assert.equal(result.phase, "DONE", result.log.join("\n"));
  assert.ok(result.preimageHex);

  // Zustand auf der echten LP-Node verifizieren: Invoice muss SETTLED sein.
  const H = hashlock(new Uint8Array(Buffer.from(result.preimageHex!, "hex")));
  const realState = await lpSide.getInvoiceState(H);
  assert.equal(realState, "SETTLED", "Invoice auf LP-Node ist abgerechnet");
});

test("LIVE: Refund-Pfad — cancelHoldInvoice gibt sats zurueck", async (t) => {
  if (!(await lndAlive(LP_REST, LP_MAC_PATH)) || !(await lndAlive(USER_REST, USER_MAC_PATH))) {
    t.skip("LND-Regtest laeuft nicht");
    return;
  }
  const lpMac = (await readFile(LP_MAC_PATH)).toString("hex");
  const userMac = (await readFile(USER_MAC_PATH)).toString("hex");
  const lpSide = new LndLightningAdapter({ restUrl: LP_REST, macaroonHex: lpMac, allowInsecureTls: true });
  const userSide = new LndLightningAdapter({ restUrl: USER_REST, macaroonHex: userMac, allowInsecureTls: true });

  // Manuell: Hold-Invoice erstellen, zahlen, nicht einloesen, canceln
  const preimage = generatePreimage();
  const H = hashlock(preimage);
  const invoice = await lpSide.createHoldInvoice(H, 5000, 40);
  await userSide.payHoldInvoice(invoice.bolt11);

  // Warten bis ACCEPTED (Payment-Propagation dauert einen Moment)
  let state = "OPEN";
  for (let i = 0; i < 50 && state !== "ACCEPTED"; i++) {
    state = await lpSide.getInvoiceState(H);
    if (state !== "ACCEPTED") await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(state, "ACCEPTED", "Zahlung haengt in flight");

  await lpSide.cancelHoldInvoice(H);
  state = await lpSide.getInvoiceState(H);
  assert.equal(state, "CANCELED", "Invoice gecancelt -> sats zurueck an User");
});

test("LIVE: Keysend — spontane Zahlung ohne Invoice (Streaming-Sats-Transport)", async (t) => {
  if (!(await lndAlive(LP_REST, LP_MAC_PATH)) || !(await lndAlive(USER_REST, USER_MAC_PATH))) {
    t.skip("LND-Regtest laeuft nicht");
    return;
  }
  const userMac = (await readFile(USER_MAC_PATH)).toString("hex");
  const lpMac = (await readFile(LP_MAC_PATH)).toString("hex");
  const userSide = new LndLightningAdapter({ restUrl: USER_REST, macaroonHex: userMac, allowInsecureTls: true });

  // LP-Pubkey ueber dessen REST holen
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const info = (await (
    await fetch(`${LP_REST}/v1/getinfo`, { headers: { "Grpc-Metadata-macaroon": lpMac } })
  ).json()) as { identity_pubkey: string };

  const hash = await userSide.keysend(info.identity_pubkey, 21_000);
  assert.ok(hash.length > 0, "Keysend erfolgreich, Payment-Hash als Beleg");
  console.log("  keysend 21 sats -> hash", hash.slice(0, 16));
});
