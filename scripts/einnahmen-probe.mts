// Einnahmen für Browser-Prüfungen (seit C-2): zwei Leistungs-Events (38010) eines Probe-Knotens – eines über
// Lightning, eines über Solana –, signiert mit einem Wegwerfschlüssel; nur für smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/einnahmen-probe.mts  ->  {"knoten": "<hex>", "events": [...]}
import { buildPerformanceEvent, generateKeypair, signEvent } from "../packages/protocol/src/index.ts";

const knoten = generateKeypair();
const jetzt = Math.floor(Date.now() / 1000);
const einnahme = (kette: "lightning" | "solana", msat: number, vor: number) => signEvent(buildPerformanceEvent({
  workerPubkey: knoten.pk, workType: "ai_job", units: 420, volumeMsat: msat, chain: kette, proofEventId: "e".repeat(63) + String(vor % 10), seasonId: "probe",
}, jetzt - vor), knoten.sk);
console.log(JSON.stringify({ knoten: knoten.pk, events: [einnahme("lightning", 21_000, 120), einnahme("solana", 1_500_000, 60)] }));
