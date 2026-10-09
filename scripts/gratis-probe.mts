// Gratis-Angebote für Browser-Prüfungen (C-27): ein Provider, der heute gratis anbietet (Tag `gratis`, A-14a), und einer,
// der nur gegen Bezahlung antwortet – signiert mit Wegwerfschlüsseln; nur für smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/gratis-probe.mts
//   ->  {"gratis": "<hex>", "bezahlt": "<hex>", "events": [...]}
import { buildCapabilities, generateKeypair, signEvent } from "../packages/protocol/src/index.ts";

const jetzt = Math.floor(Date.now() / 1000);
const gratis = generateKeypair();
const bezahlt = generateKeypair();
const events = [
  signEvent(buildCapabilities({
    pubkey: gratis.pk, tier: "free", models: ["gratis-modell:7b"], textRatePerKTokenMsat: 1500, currentlyFree: true, powBits: 8, tools: [],
    gratis: { tokensProTag: 100_000, tokensJeAntwort: 2_000, powBits: 16 },
  } as never, jetzt - 40), gratis.sk),
  signEvent(buildCapabilities({
    pubkey: bezahlt.pk, tier: "classic", models: ["bezahl-modell:7b"], textRatePerKTokenMsat: 1500, currentlyFree: false, tools: [],
  } as never, jetzt - 40), bezahlt.sk),
];
console.log(JSON.stringify({ gratis: gratis.pk, bezahlt: bezahlt.pk, events }));
