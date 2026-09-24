/**
 * Ausfuehrbare Demo des Lightning<->Solana Atomic Swaps.
 *   npm run demo
 *
 * Zeigt drei Dinge live:
 *   1) LP-Orderbook ueber Nostr (Angebot bauen, matchen)
 *   2) Happy Path: beide Seiten settlen atomar
 *   3) Refund Path: Nutzer loest nicht ein -> niemand verliert Geld
 */
import { runSwap, SwapConfig } from "../src/swap.js";
import { MockLightning, MockSolana } from "../src/mocks.js";
import { buildLpOffer, parseLpOffer, offerMatches, LpOffer } from "../src/nostr-order.js";

function hr() { console.log("-".repeat(64)); }

async function main() {
  // ---------------------------------------------------------------
  // 1) LP veroeffentlicht ein Angebot als Nostr-Event; Nutzer matcht.
  // ---------------------------------------------------------------
  hr(); console.log("1) LP-ORDERBOOK UEBER NOSTR");
  const offer: LpOffer = {
    offerId: "ln-sol-1", pair: "LN-BTC/SOL", direction: "sell-sol",
    minSats: 10_000, maxSats: 5_000_000, feePpm: 3000,
    tSolSecs: 600, lnCltvDeltaBlocks: 12, expiry: 2_000_000_000, note: "demo LP",
  };
  const _kp = (await import("../src/event.js")).generateKeypair();
  const ev = buildLpOffer(offer, _kp.pk);
  console.log("   LP-Event (kind", ev.kind + "):", JSON.stringify(ev.tags));
  const parsed = parseLpOffer(ev);
  const wants = { pair: "LN-BTC/SOL", direction: "sell-sol" as const, amountSats: 100_000, now: Math.floor(Date.now()/1000) };
  console.log("   Nutzer sucht 100k sats -> SOL. Match:", offerMatches(parsed, wants));

  const cfg = (now: () => number): SwapConfig => ({
    swapId: "swap-demo", amountSats: 100_000, amountLamports: 500_000_000,
    userSolanaAddress: "User111", lpSolanaAddress: "LP111",
    tSolSecs: parsed.tSolSecs, lnCltvDeltaBlocks: parsed.lnCltvDeltaBlocks, now,
  });

  // ---------------------------------------------------------------
  // 2) Happy Path
  // ---------------------------------------------------------------
  hr(); console.log("2) HAPPY PATH");
  {
    let t = 1_700_000_000; const now = () => t;
    const ln = new MockLightning(100_000);
    const sol = new MockSolana(500_000_000, now);
    console.log(`   Start  -> Nutzer: ${ln.userSats} sats, ${sol.userLamports} lamports | LP: ${ln.lpSats} sats, ${sol.lpLamports} lamports`);
    const res = await runSwap(ln, sol, cfg(now), true);
    for (const l of res.log) console.log("   " + l);
    console.log(`   Ende   -> Nutzer: ${ln.userSats} sats, ${sol.userLamports} lamports | LP: ${ln.lpSats} sats, ${sol.lpLamports} lamports`);
    console.log("   Ergebnis:", res.phase);
  }

  // ---------------------------------------------------------------
  // 3) Refund Path (Nutzer loest nicht ein)
  // ---------------------------------------------------------------
  hr(); console.log("3) REFUND PATH (Nutzer loest nicht ein)");
  {
    let t = 1_700_000_000; const now = () => t;
    const ln = new MockLightning(100_000);
    const sol = new MockSolana(500_000_000, now);
    console.log(`   Start  -> Nutzer: ${ln.userSats} sats, ${sol.userLamports} lamports | LP: ${ln.lpSats} sats, ${sol.lpLamports} lamports`);
    const c = cfg(now);
    c.advanceClockForRefund = () => { t = 1_700_000_000 + 601; };
    const res = await runSwap(ln, sol, c, false);
    for (const l of res.log) console.log("   " + l);
    console.log(`   Ende   -> Nutzer: ${ln.userSats} sats, ${sol.userLamports} lamports | LP: ${ln.lpSats} sats, ${sol.lpLamports} lamports`);
    console.log("   Ergebnis:", res.phase, "(alle Salden wie am Anfang)");
  }
  hr();
}

main().catch((e) => { console.error(e); process.exit(1); });
