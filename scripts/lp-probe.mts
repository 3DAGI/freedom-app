// LP-Angebote für Browser-Prüfungen (seit C-1a): zwei Angebote sats → SOL und eines SOL → sats, signiert
// mit Wegwerfschlüsseln – nur für smoke_test.py, nie für ein echtes Relay. Eines liest keine Umschläge
// (ohne „versiegelt“) – die App fragt es nicht an.
// Aufruf: npx tsx scripts/lp-probe.mts  ->  {"events": [...]}
import { buildLpOffer, generateKeypair, signEvent } from "../packages/protocol/src/index.ts";

const jetzt = Math.floor(Date.now() / 1000);
const basis = { pair: "LN-BTC/SOL", feePpm: 3000, tSolSecs: 7200, lnCltvDeltaBlocks: 144, expiry: jetzt + 86_400 };
const [hin, alt, rueck] = [generateKeypair(), generateKeypair(), generateKeypair()];
const events = [
  signEvent(buildLpOffer({ ...basis, offerId: "probe-hin", direction: "sell-sol", minSats: 1000, maxSats: 50_000, versiegelt: true }, hin.pk, jetzt - 60), hin.sk),
  signEvent(buildLpOffer({ ...basis, offerId: "probe-alt", direction: "sell-sol", minSats: 1000, maxSats: 50_000 }, alt.pk, jetzt - 60), alt.sk),
  signEvent(buildLpOffer({
    ...basis, offerId: "probe-rueck", direction: "buy-sol", minSats: 2000, maxSats: 20_000, versiegelt: true,
    solAddress: "11111111111111111111111111111111", lamportsPerSat: 1000,
  }, rueck.pk, jetzt - 60), rueck.sk),
];
console.log(JSON.stringify({ events }));
