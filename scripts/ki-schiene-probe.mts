// Kurs und bezahlter Provider für Browser-Prüfungen (12.4b): drei Kurs-Ticker (150 000 sats je SOL, drei Quellen)
// und ein Provider im Tarif Classic, der Umschläge liest – ohne Zahlkanal. Signiert mit Wegwerfschlüsseln; nur für
// smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/ki-schiene-probe.mts
//   ->  {"provider": "<hex>", "anbieter": [...], "kurs": [...]}
import { buildCapabilities, buildPriceTicker, generateKeypair, signEvent } from "../packages/protocol/src/index.ts";

const jetzt = Math.floor(Date.now() / 1000);
const provider = generateKeypair();
const anbieter = [
  signEvent(buildCapabilities({
    pubkey: provider.pk, tier: "classic", models: ["bezahl-modell:7b"], textRatePerKTokenMsat: 1500, currentlyFree: false, powBits: 8, tools: [],
  } as never, jetzt - 40), provider.sk),
];
const kurs = [149_000, 150_000, 151_000].map((satsPerUnit) => {
  const quelle = generateKeypair();
  return signEvent(buildPriceTicker({ pair: "SOL/BTC", satsPerUnit, publishedAt: jetzt - 60 }, quelle.pk), quelle.sk);
});
console.log(JSON.stringify({ provider: provider.pk, anbieter, kurs }));
